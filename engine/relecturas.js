'use strict';
/**
 * relecturas.js — La cola que le rehace el texto a cada toma cerrada.
 *
 * Es el segundo de los dos ciclos de una grabación, y la separación entre los
 * dos es lo que protege el transcript. El de señales (`grabacion.js`) corre
 * seguido y su texto es descartable: solo sirve para saber si alguien dijo
 * "3, 2, 1" o "Pausa", y de eso solo se le cree la hora. Este corre una vez por
 * toma, al cerrarla, y ESE texto es el que queda.
 *
 * **Los dos usan el modelo grande, y la diferencia no es el modelo: es qué audio
 * se le da y qué se le cree.** El ciclo de señales lo consulta por el servidor
 * residente (`oido-residente.js`, que arranca con `paths.whisperModel()`), que
 * tiene el modelo ya cargado y contesta una ventana de seis segundos en menos de
 * un segundo; el modelo chico quedó como respaldo para cuando el servidor no
 * está listo (ver `liviano` en `oir.js`). Acá se le pasa la toma entera, de una,
 * y se guarda lo que diga palabra por palabra.
 *
 * Está en su archivo porque es una máquina con estado propio: una fila, una
 * pasada en vuelo, y la regla de que nunca haya dos. Lo llaman el ciclo de
 * señales, los cambios a mano y el cierre de la sesión, o sea los tres sitios
 * donde una toma puede quedar con el texto viejo.
 */

const espejo = require('./espejo');
const oirToma = require('./oir-toma');
const registro = require('./registro');
const vivo = require('./notas-vivo');

/**
 * Rehace el texto de una toma cerrada, con el modelo grande y de una sola pasada.
 *
 * Es lo que hace que el transcript sea bueno: una toma entera tiene frases
 * completas, así que Whisper puntúa bien, y al no pegar pedazos no hay palabras
 * cortadas ni tiempos que se pisen. El texto del ciclo de señales se descarta
 * entero — de él solo se usó la hora de las señales.
 *
 * Y se vuelve a buscar señales adentro: si el ciclo liviano no oyó una "Pausa",
 * acá aparece, y la toma se puede partir. Dos oportunidades para cada señal.
 *
 * **De una a la vez.** Se encola en vez de largarse a correr: el ciclo de señales
 * ya tiene un Whisper andando cada tres segundos, y sumarle uno por cada toma que
 * se cierra pone dos modelos grandes a pelearse la GPU. Los dos tardan el doble y
 * el que importa es el del ciclo, porque de ese salen las tomas siguientes. Una
 * toma cerrada, en cambio, puede esperar: nadie va a mirar su texto en los
 * próximos segundos.
 */
/** Aire después de la última palabra cuando el OUT se acerca a ella. */
const CIERRE_TRAS_PALABRA_MS = 200;

function encolar(sesion, id) {
    if (!sesion || !sesion.viva) return;
    // Una toma que ya espera no se encola dos veces: arrastrar un borde tres
    // veces seguidas pedía tres relecturas iguales, una detrás de otra, y cada
    // una es cargar el modelo grande. La que espera va a leer los bordes que
    // haya cuando le toque, que son los últimos.
    if (sesion.cola.includes(id)) return;
    sesion.cola.push(id);
    atender(sesion);
}

/**
 * ¿Ya hay audio detrás del OUT de esta toma?
 *
 * **Una toma no se lee cortada en seco, y esto es lo que lo impide.** Al cerrar
 * con el botón, el WAV termina justo en el OUT: `oir-toma.leer` recorta contra
 * el final del archivo, así que Whisper recibe un audio que se corta a mitad de
 * frase, y en ese borde pierde las últimas palabras o escribe las frases que
 * tiene aprendidas de los subtítulos. Medido sobre la grabación del 13/10,
 * releyendo la MISMA toma de las dos maneras:
 *
 *   cortado en el OUT   …PROMP Research «¡Suscríbete al canal!»   (y nada detrás)
 *   con su orilla       …PROMP Research.  │ buenísimo Alejo Alejo mientras tanto…
 *
 * Y no es solo texto de más: la toma se cerraba EN esa palabra inventada
 * (`outProvisional`, abajo), así que lo dicho de verdad quedaba fuera de la
 * toma y el transcript parecía retomar más adelante. Por eso la espera no es
 * una mejora del texto: es lo que hace que el OUT caiga donde se habló.
 *
 * Con la sesión terminando no se espera: el audio ya se cerró y la orilla no va
 * a llegar nunca, así que se lee con lo que haya, que es mejor que no leer.
 */
function hayOrilla(sesion, toma) {
    if (sesion.terminando) return true;
    return espejo.grabadoHastaMs(sesion) >= toma.outMs + oirToma.ORILLA_MS;
}

/** La primera de la cola que ya se puede leer, o null si todas esperan. */
function siguiente(sesion) {
    for (const id of sesion.cola) {
        const toma = sesion.estado.tomas.find(t => t.id === id);
        // Una toma que se fue —descartada— o que se reabrió sale de la cola sin
        // leerse: `rehacer` ya lo comprueba, pero acá además destraba la cola.
        if (!toma || toma.inMs == null || toma.outMs == null) return id;
        if (hayOrilla(sesion, toma)) return id;
    }
    return null;
}

/**
 * Pone la cola a andar, si no lo está ya.
 *
 * Lo llama el ciclo de señales en cada pasada, que es lo que recoge a las tomas
 * que estaban esperando su orilla: cuando el audio las alcanza, la pasada
 * siguiente las lee.
 */
function atender(sesion) {
    if (!sesion || !sesion.viva) return;
    if (!sesion.rehaciendo && sesion.cola.length) atenderCola(sesion);
}

async function atenderCola(sesion) {
    // **La promesa se guarda acá adentro y no en quien llama**, que es el mismo
    // patrón de `s.pasada` en el ciclo de señales. No es estilo: esta pasada
    // puede terminar SIN esperar a nadie —cuando todas las tomas de la cola
    // están esperando su orilla—, y entonces el `finally` de abajo corre antes
    // de que una asignación de afuera guardara la promesa. Así quedaba una
    // promesa ya resuelta en `rehaciendo`, `atender` no volvía a arrancar nunca
    // y las tomas se quedaban en la cola hasta el final de la clase.
    //
    // `rehaciendo` es la promesa y no un booleano porque `terminar` la espera,
    // para no soltar la sesión con tomas a medio releer.
    let listo;
    sesion.rehaciendo = new Promise(r => { listo = r; });
    try {
        while (sesion.viva) {
            const id = siguiente(sesion);
            // Nada que leer todavía: las que quedan esperan su orilla. La cola
            // se suelta y la próxima pasada del ciclo vuelve a mirar.
            if (id == null) return;
            sesion.cola = sesion.cola.filter(x => x !== id);
            await rehacer(sesion, id);
        }
    } finally {
        if (sesion.viva) sesion.rehaciendo = null;
        listo();
    }
}

async function rehacer(sesion, id) {
    const toma = sesion.estado.tomas.find(t => t.id === id);
    if (!toma || toma.inMs == null || toma.outMs == null) return;

    try {
        const leido = await oirToma.leer(espejo.archivosDeLaSesion(sesion), toma,
            { idioma: sesion.estado.idioma });
        if (!sesion.viva || !leido) return;
        // Mientras se leía, la toma pudo irse (descartada) o reabrirse: sin OUT,
        // `repartir` mandaba todo el texto a `despues` y la toma quedaba vacía.
        if (!sesion.estado.tomas.includes(toma) || toma.outMs == null) return;

        Object.assign(toma, leido);
        // El OUT que puso el botón o Terminar es donde llegó el audio, con el
        // silencio del atraso incluido: se acerca a la última palabra de verdad,
        // que ahora sí se conoce entera.
        //
        // **Solo con audio detrás del OUT.** Sin orilla, la última palabra de la
        // lectura es justamente la que Whisper se inventó en el corte seco (ver
        // `hayOrilla`), y acercar el OUT hasta ahí es cerrar la toma en una
        // palabra que nadie dijo. Con la cola esperando esto se cumple siempre
        // salvo al terminar la clase, y ahí el OUT se queda donde estaba, que es
        // donde llegó el audio: sobra silencio, pero no falta nada hablado.
        const orillaMs = Math.max(0, espejo.grabadoHastaMs(sesion) - toma.outMs);
        // Con cuánta orilla se leyó, que es lo que explica un final raro: una
        // toma leída con la orilla en cero se leyó cortada en seco, y eso ya no
        // debería pasar salvo en la última de la clase (ver `hayOrilla`).
        registro.anotar('main', 'relectura.leida', {
            toma: toma.id,
            orillaMs: Math.round(orillaMs),
            pideMs: oirToma.ORILLA_MS,
            palabras: (leido.palabras || []).length,
            terminando: Boolean(sesion.terminando)
        });
        const conOrilla = orillaMs >= oirToma.ORILLA_MS;
        if (conOrilla && toma.outProvisional && leido.palabras && leido.palabras.length) {
            const ultima = leido.palabras[leido.palabras.length - 1];
            const fin = (ultima.hasta != null ? ultima.hasta : ultima.t) + CIERRE_TRAS_PALABRA_MS;
            if (fin < toma.outMs && fin > toma.inMs) {
                toma.outMs = fin;
                const todas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
                Object.assign(toma, vivo.repartir(todas, toma));
            }
        }
        delete toma.outProvisional;

        // Sin palabras es la toma que no se pudo releer con ningún modelo
        // (`engine/insistir.js`). Se escribe la marca y se para acá: lo que la
        // toma tiene es el texto del ciclo de señales, que está declarado
        // descartable, y medir la lengua o buscarle una "Pausa" adentro sería
        // sacar conclusiones de un texto del que no se cree ni una palabra.
        //
        // La marca se guarda igual, y es lo único que importa de este renglón: la
        // toma queda dicha y regenerable en vez de quedar callada.
        if (!leido.palabras) {
            espejo.fijar(sesion);
            return;
        }

        // Señales que el ciclo liviano no oyó. No se parte la toma sola: se avisa,
        // porque partir es una decisión de contenido y acá el editor está mirando.
        // Se busca solo ADENTRO: una "Pausa" que cae en una orilla es de la toma
        // de al lado o de nadie, y avisarla acá mandaría a cortar donde no va.
        const dentro = vivo.senales(toma.palabras).filter(s => s.tipo === 'cierra');
        toma.pausaAdentro = dentro.length ? toma.palabras[dentro[0].desde].t : null;

        // Y las claquetas que el ciclo liviano no oyó. Es la segunda
        // oportunidad de la tercera puerta: el modelo grande escribe
        // "claqueta" donde el liviano escribió cualquier otra cosa, y una
        // claqueta que se pierde es una marca de sincronía menos para el
        // editor. Entran por `anotarClaqueta`, así que la que ya esté anotada
        // a menos de cinco segundos se funde en vez de duplicarse.
        // Igual que en vivo: solo con un aplauso cerca (`claquetaDicha`).
        for (const s of vivo.senales(toma.palabras).filter(x => x.tipo === 'claqueta')) {
            vivo.claquetaDicha(sesion.estado, toma.palabras[s.desde].t,
                (toma.palabras.slice(Math.max(0, s.desde - 2), s.desde + 4) || [])
                    .map(w => w.texto).join(' ').trim());
        }

        espejo.fijar(sesion);
    } catch (err) {
        // Lo que llega acá ya no es un whisper-cli que se murió —eso lo atiende
        // `oirToma.leer` y termina en la marca de la toma, sin cartel— sino un
        // bug de este archivo. Ahí sí va el aviso: no hay nada escrito en
        // ninguna toma que lo cuente.
        if (sesion.viva) sesion.avisar({ tipo: 'error', mensaje: err.message });
    }
}

/**
 * Una medida de toma que acaba de cambiar: se escribe y se dibuja.
 *
 * Se llama varias veces por toma —al salir a preguntar, y otra vez con lo que
 * conteste— porque el panel tiene que poder decir "estoy midiendo" y después el
 * resultado. Cuesta dos escrituras de unos kilobytes, que es lo mismo que cuesta
 * cualquier otro cambio de esta sesión (`espejo.escribir`).
 *
 * Va como fábrica y no como función suelta porque quien la recibe —`medir-toma`—
 * la llama minutos después, cuando el proveedor conteste: para entonces la sesión
 * puede haberse cerrado, y `espejo.fijar` es el que sabe no escribir sobre una
 * sesión que ya no está.
 */
function avisador(sesion) {
    return () => { espejo.fijar(sesion); };
}

module.exports = { encolar, atender, avisador, hayOrilla };
