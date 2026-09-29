'use strict';
/**
 * relecturas.js — La cola que le rehace el texto a cada toma cerrada.
 *
 * Es el segundo de los dos ciclos de una grabación, y la separación entre los
 * dos es lo que protege el transcript. El de señales (`grabacion.js`) corre
 * seguido con un modelo liviano y su texto es descartable: solo sirve para saber
 * si alguien dijo "3, 2, 1" o "Pausa", y de eso solo se le cree la hora. Este
 * corre una vez por toma, al cerrarla, con el modelo grande, y ESE texto es el
 * que queda.
 *
 * Está en su archivo porque es una máquina con estado propio: una fila, una
 * pasada en vuelo, y la regla de que nunca haya dos. Lo llaman el ciclo de
 * señales, los cambios a mano y el cierre de la sesión, o sea los tres sitios
 * donde una toma puede quedar con el texto viejo.
 */

const espejo = require('./espejo');
const oirToma = require('./oir-toma');
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
    // `rehaciendo` guarda la promesa de la pasada en curso, y no un booleano:
    // `terminar` la espera, para no soltar la sesión con tomas a medio releer.
    if (!sesion.rehaciendo) sesion.rehaciendo = atenderCola(sesion);
}

async function atenderCola(sesion) {
    try {
        while (sesion.viva && sesion.cola.length) {
            await rehacer(sesion, sesion.cola.shift());
        }
    } finally {
        if (sesion.viva) sesion.rehaciendo = null;
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
        if (toma.outProvisional && leido.palabras && leido.palabras.length) {
            const ultima = leido.palabras[leido.palabras.length - 1];
            const fin = (ultima.hasta != null ? ultima.hasta : ultima.t) + CIERRE_TRAS_PALABRA_MS;
            if (fin < toma.outMs && fin > toma.inMs) {
                toma.outMs = fin;
                const todas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
                Object.assign(toma, vivo.repartir(todas, toma));
            }
        }
        delete toma.outProvisional;
        // La orilla de la derecha son segundos que, en el momento de cerrar la
        // toma, todavía se están grabando: nace vacía por fuerza. Queda anotado
        // para volver a buscarla cuando el audio la alcance (`releerOrillas`).
        toma.orillaCorta = espejo.grabadoHastaMs(sesion) < toma.outMs + oirToma.ORILLA_MS;

        // Sin palabras es la toma que no se pudo releer con ningún modelo
        // (`engine/insistir.js`). Se escribe la marca y se para acá: lo que la
        // toma tiene es el texto del ciclo de señales, que está declarado
        // descartable, y medir la lengua o buscarle una "Pausa" adentro sería
        // sacar conclusiones de un texto del que no se cree ni una palabra.
        //
        // La marca se guarda igual, y es lo único que importa de este renglón: la
        // toma queda dicha y regenerable en vez de quedar callada. Y `orillaCorta`
        // se recalcula ARRIBA aunque no haya texto, porque es un dato del audio y
        // no del texto: si la toma acaba de cerrar, `releerOrillas` la vuelve a
        // encolar cuando el audio la alcance y eso le regala otra ronda entera de
        // intentos, con la máquina quizás en otro estado. Es gratis y es la única
        // segunda chance automática que tiene.
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

/**
 * Vuelve a la cola las tomas cuya orilla derecha ya tiene audio detrás.
 *
 * Una toma se relee apenas cierra, y en ese instante lo que viene después no
 * existe todavía: es lo que se está grabando. Así que sale con la orilla derecha
 * en una palabra, y el OUT se puede mover hacia adelante eso y nada más. Doce
 * segundos después el audio ya está, y una segunda lectura la completa.
 *
 * La segunda lectura no vuelve a pedir una tercera: para entonces el audio pasa
 * de sobra el final de la orilla y `orillaCorta` queda en falso.
 */
function releerOrillas(sesion) {
    const hasta = espejo.grabadoHastaMs(sesion);
    for (const toma of sesion.estado.tomas) {
        if (!toma.orillaCorta || toma.outMs == null) continue;
        if (hasta < toma.outMs + oirToma.ORILLA_MS) continue;
        toma.orillaCorta = false;
        encolar(sesion, toma.id);
    }
}

module.exports = { encolar, avisador, releerOrillas };
