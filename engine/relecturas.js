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
 * el que importa es el del ciclo, porque de ese salen las tomas siguientes.
 *
 * Lo que la cola NO puede hacer es demorar a la toma que el editor acaba de
 * cerrar: esa la tiene delante. Por eso la espera de `hayOrilla` es corta y el
 * contexto largo llega después, en una pasada aparte que no relee la toma
 * (`completarOrilla`) — ahí sí es verdad que nadie está mirando.
 */
/** Aire después de la última palabra cuando el OUT se acerca a ella. */
const CIERRE_TRAS_PALABRA_MS = 200;

function encolar(sesion, id) {
    if (!sesion || !sesion.viva) return;
    // Una toma que ya espera no se encola dos veces: arrastrar un borde tres
    // veces seguidas pedía tres relecturas iguales, una detrás de otra, y cada
    // una es cargar el modelo grande. La que espera va a leer los bordes que
    // haya cuando le toque, que son los últimos.
    //
    // Pero la cola se despierta igual: la toma puede estar esperando su orilla
    // larga y el gesto que la vuelve a encolar —un Cmd-Z que le repuso el
    // texto— la deja pidiendo otra vez la lectura entera, que no espera.
    if (!sesion.cola.includes(id)) sesion.cola.push(id);
    atender(sesion);
}

/**
 * Cuánta orilla derecha querría esta toma: hasta la vecina, o la de siempre.
 *
 * Es la MISMA cuenta que hace `oir-toma.leer` para recortar el audio, y se
 * llama desde acá para que la espera y la lectura no puedan discrepar. Cuando
 * discrepaban, una toma pegada a la siguiente —las dos mitades de una división—
 * esperaba doce segundos de audio que la lectura después ni iba a pedir.
 */
function quiereDerecha(sesion, toma) {
    return oirToma.orillaDerecha(toma, sesion.estado.tomas);
}

/**
 * Con cuánta orilla derecha quedó leída esta toma, o null si todavía no.
 *
 * La marca lleva el OUT con el que se leyó, así que mover un borde la invalida
 * sola: la toma vuelve a ser "sin leer" y su relectura vuelve a entrar por la
 * espera corta, que es lo que el editor está esperando cuando arrastra.
 */
function leidaCon(toma) {
    const r = toma.releida;
    return r && r.inMs === toma.inMs && r.outMs === toma.outMs ? r.orillaMs : null;
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
 * **Pero eso se arregla con dos segundos, no con doce** (ver `ORILLA_MINIMA_MS`,
 * que trae la medición). Los doce son cuánto contexto se GUARDA, que es otra
 * cosa y no hace falta tenerla para leer: la primera pasada espera el mínimo y
 * deja el texto bueno enseguida, y la orilla larga la completa después una
 * segunda pasada corta (`completarOrilla`), cuando ya nadie está mirando esa
 * toma. Eso es justo el reparto que este archivo venía razonando al revés: la
 * frase "una toma cerrada puede esperar" vale para la segunda pasada, no para
 * la primera, porque el editor acaba de cerrarla y la tiene delante.
 *
 * Con la sesión terminando no se espera: el audio ya se cerró y la orilla no va
 * a llegar nunca, así que se lee con lo que haya, que es mejor que no leer.
 */
function hayOrilla(sesion, toma) {
    if (sesion.terminando) return true;
    return espejo.grabadoHastaMs(sesion) >= toma.outMs + pideAhora(sesion, toma);
}

function pideAhora(sesion, toma) {
    const quiere = quiereDerecha(sesion, toma);
    // La primera pasada se conforma con el mínimo; la segunda es justamente la
    // que viene a buscar el resto, así que espera a que esté entero.
    return leidaCon(toma) == null ? Math.min(quiere, oirToma.ORILLA_MINIMA_MS) : quiere;
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
            await pasada(sesion, id);
        }
    } finally {
        if (sesion.viva) sesion.rehaciendo = null;
        listo();
    }
}

/**
 * Qué le toca a esta toma: la lectura entera, o solo completarle la orilla.
 *
 * Lo decide la toma y no la cola, que es lo que deja la cola siendo una lista
 * de ids: `releida` dice con qué OUT y con cuánta orilla quedó leída, así que
 * una toma sin esa marca —o con el OUT movido desde entonces— pide la lectura
 * entera, y una ya leída corta solo pide el contexto que le faltó.
 */
async function pasada(sesion, id) {
    const toma = sesion.estado.tomas.find(t => t.id === id);
    if (!toma || toma.inMs == null || toma.outMs == null) return;
    if (leidaCon(toma) == null) return rehacer(sesion, id);
    return completarOrilla(sesion, toma);
}

/** Lo que se lee de más a la izquierda del OUT al completar la orilla. */
const SOLAPE_DE_ORILLA_MS = 1500;

/**
 * La segunda pasada: le completa a una toma ya leída el contexto de su derecha.
 *
 * **No vuelve a leer la toma**, y eso es todo el punto. Releerla entera sería
 * cargar el modelo grande por segunda vez para reescribir un texto que ya está
 * bien —y este archivo evita eso a propósito, ver `encolar`—; acá se lee solo el
 * tramo de después del OUT, que son doce segundos de audio y menos de dos de
 * trabajo. `palabras` no se toca: el texto que el editor ya está leyendo no se
 * mueve.
 *
 * Se arranca un poco antes del OUT y se tira lo que caiga delante: así la
 * primera palabra de la orilla entra entera en vez de empezar cortada, que es el
 * mismo cuidado que tiene la lectura grande con sus dos bordes.
 */
async function completarOrilla(sesion, toma) {
    const quiere = quiereDerecha(sesion, toma);
    const bordes = { inMs: toma.inMs, outMs: toma.outMs };
    // La marca queda puesta ANTES de leer y con la orilla entera, salga lo que
    // salga: dice "a esta toma ya se le pidió su contexto", que es distinto de
    // "lo tiene". Puesta después, una lectura que se muere dejaría a la toma
    // declarando que todavía le falta, y la siguiente que la encolara —mover un
    // borde y volverlo a su sitio, por ejemplo— pediría la misma orilla otra vez.
    toma.releida = { ...bordes, orillaMs: quiere };
    try {
        const oido = await oirToma.tramo(espejo.archivosDeLaSesion(sesion),
            bordes.outMs - SOLAPE_DE_ORILLA_MS, bordes.outMs + quiere, false, sesion.estado.idioma);
        if (!sesion.viva || !sesion.estado.tomas.includes(toma)) return;
        // El editor pudo mover un borde mientras se leía: entonces esta orilla
        // es de un corte que ya no existe, y el gesto dejó encolada la relectura
        // entera. Se tira, que es más barato que pensarla.
        if (toma.inMs !== bordes.inMs || toma.outMs !== bordes.outMs) return;
        if (!oido || !oido.palabras) return;
        toma.despues = oido.palabras.filter(w => w.t >= bordes.outMs);
        registro.anotar('main', 'relectura.orilla', {
            toma: toma.id, pideMs: Math.round(quiere), palabras: toma.despues.length
        });
        espejo.fijar(sesion);
    } catch (err) {
        // Sin orilla la toma se queda con el contexto corto de la primera
        // pasada, que es texto bueno y poco: peor que completarla, mejor que
        // cualquier cosa que se pueda hacer acá.
        registro.anotar('main', 'relectura.orilla-fallo', { toma: toma.id, detalle: err.message });
    }
}

async function rehacer(sesion, id) {
    const toma = sesion.estado.tomas.find(t => t.id === id);
    if (!toma || toma.inMs == null || toma.outMs == null) return;

    // Con qué bordes se va a leer, y hasta dónde llegaba el audio al empezar. Se
    // guardan porque leer tarda —modelo grande, toma entera— y el editor sigue
    // trabajando mientras tanto; lo grabado se mira ACÁ y no al volver porque al
    // volver ya creció lo que tardó la lectura, y entonces la orilla con la que
    // se leyó de verdad se contaba de más.
    const seLeyoCon = { inMs: toma.inMs, outMs: toma.outMs, grabadoMs: espejo.grabadoHastaMs(sesion) };
    const quiere = quiereDerecha(sesion, toma);

    try {
        // Con las tomas: de ahí sale hasta dónde llega la orilla de cada lado,
        // que es lo que deja el tramo entre dos tomas escrito en las dos y no
        // solo en las sueltas, que no se guardan (ver `orillaIzquierda`).
        const leido = await oirToma.leer(espejo.archivosDeLaSesion(sesion), toma,
            { idioma: sesion.estado.idioma, tomas: sesion.estado.tomas });
        if (!sesion.viva || !leido) return;
        // Mientras se leía, la toma pudo irse (descartada) o reabrirse: sin OUT,
        // `repartir` mandaba todo el texto a `despues` y la toma quedaba vacía.
        if (!sesion.estado.tomas.includes(toma) || toma.outMs == null) return;

        // **Y el editor pudo mover un borde mientras se leía**, que es lo que
        // hacía desaparecer texto: la lectura reparte por los bordes que había
        // al empezar, así que pisaba el reparto bueno con uno viejo. Con el IN
        // corrido hacia atrás a mitad de lectura, las palabras que el gesto
        // acababa de meter en la toma se iban otra vez a la orilla y el texto
        // volvía a empezar donde ya no empieza la línea azul — y no volvían
        // hasta que terminara la relectura siguiente, que es medio minuto más.
        //
        // Las palabras son las mismas y el tramo leído es más ancho que la
        // toma, así que no hay que releer nada: alcanza con volver a repartirlas
        // por los bordes de AHORA. Eso deja el texto bueno y el borde del editor,
        // que es lo que estaba mirando cuando lo movió.
        const comoSeLeyo = toma.inMs === seLeyoCon.inMs && toma.outMs === seLeyoCon.outMs;
        Object.assign(toma, leido);
        if (!comoSeLeyo && leido.palabras) {
            const todas = (leido.antes || []).concat(leido.palabras, leido.despues || []);
            Object.assign(toma, vivo.repartir(todas, toma));
        }
        // El texto nuevo manda sobre el colchón: lo que el ciclo dejó suelto en
        // este tramo —porque la toma estaba desactivada cuando lo oyó— ahora
        // está escrito acá, y suelto además se veía dos veces.
        if (leido.palabras) vivo.limpiarSueltas(sesion.estado, []);
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
        //
        // **La orilla que CABÍA en la lectura, no la que hay ahora.** Son dos
        // números distintos y el de antes era el segundo: lo grabado crece
        // mientras Whisper trabaja, así que una toma leída cortada en seco podía
        // declarar quince segundos de orilla y habilitar el acercamiento de
        // abajo. Lo que la lectura recibió es lo que había al empezar, y tampoco
        // más de lo que iba a pedir (`quiere`, que se achica contra la vecina).
        const orillaMs = Math.max(0, Math.min(quiere, seLeyoCon.grabadoMs - seLeyoCon.outMs));
        // Con cuánta orilla se leyó, que es lo que explica un final raro: una
        // toma leída con la orilla en cero se leyó cortada en seco, y eso ya no
        // debería pasar salvo en la última de la clase (ver `hayOrilla`).
        registro.anotar('main', 'relectura.leida', {
            toma: toma.id,
            orillaMs: Math.round(orillaMs),
            pideMs: Math.round(quiere),
            minimaMs: oirToma.ORILLA_MINIMA_MS,
            palabras: (leido.palabras || []).length,
            terminando: Boolean(sesion.terminando)
        });
        // Tampoco se acerca el OUT si el editor lo movió mientras se leía: ese
        // OUT ya no es el que puso el botón, es el que eligió alguien mirando.
        const conOrilla = orillaMs >= oirToma.ORILLA_MINIMA_MS;
        if (comoSeLeyo && conOrilla && toma.outProvisional && leido.palabras && leido.palabras.length) {
            const ultima = leido.palabras[leido.palabras.length - 1];
            const fin = (ultima.hasta != null ? ultima.hasta : ultima.t) + CIERRE_TRAS_PALABRA_MS;
            if (fin < toma.outMs && fin > toma.inMs) {
                toma.outMs = fin;
                const todas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
                Object.assign(toma, vivo.repartir(todas, toma));
            }
        }
        delete toma.outProvisional;

        // Con qué bordes y con cuánta orilla derecha quedó esta toma. De acá
        // salen las dos decisiones de la segunda pasada: si hace falta, y
        // cuánto esperar para ella.
        //
        // **Solo si se leyó con los bordes de ahora.** Si el editor movió uno a
        // mitad de lectura, el gesto ya encoló la relectura entera, y dejar la
        // marca puesta la convertiría en una pasada de orilla: la toma se
        // quedaría con el texto del reparto viejo y nadie volvería a leerla.
        if (comoSeLeyo) {
            // Acercar el OUT le suma a la orilla lo mismo que le quitó a la toma:
            // el audio leído llega igual de lejos, solo que el borde se corrió.
            const yaTiene = orillaMs + Math.max(0, seLeyoCon.outMs - toma.outMs);
            toma.releida = { inMs: toma.inMs, outMs: toma.outMs, orillaMs: yaTiene };
            // Y si le faltó contexto a la derecha, se encola la segunda pasada.
            // No al terminar: ahí el audio ya se cerró, esa orilla no va a
            // llegar nunca y la toma se encolaría sola hasta el final.
            if (!sesion.terminando && yaTiene < quiereDerecha(sesion, toma)) encolar(sesion, toma.id);
        }

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
