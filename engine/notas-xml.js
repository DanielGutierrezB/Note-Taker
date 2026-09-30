'use strict';
/**
 * notas-xml.js — Las notas de rodaje, escritas como las lee Premiere.
 *
 * Del otro lado de la pared está `notas-vivo.js`, que decide qué es una toma y
 * qué es una claqueta escuchando al profesor. Acá no se decide nada de eso: se
 * toma ese estado y se lo convierte en el archivo que el editor importa. Están
 * separados porque cambian por motivos distintos —uno cuando el profesor cambia
 * cómo abre una toma, el otro cuando cambia el formato— y porque conviene que
 * las convenciones del formato estén todas juntas y en un solo sitio.
 *
 * **Dos relojes, y acá se cruzan.** El estado lleva la HORA DEL DÍA de todo, que
 * es lo que permite que el audio y las notas midan con la misma regla. El XML va
 * en CUADROS desde el cero, que es el momento de "Iniciar grabación". Esta es la
 * única traducción entre los dos, y por eso también se escribe el sidecar: ahí
 * queda la hora del día de cada palabra, que es lo que deja depurar una duda de
 * sincronía con números en vez de con memoria.
 *
 * ── Qué lleva el XML, y por qué son las dos cosas ────────────────────────
 *
 * **El audio de la sesión en A1, y los marcadores por duplicado.** Class Cut
 * escribía una secuencia vacía con marcadores y nada más, porque allá el
 * material venía de un Rodecaster que ya había grabado su propio audio. Acá la
 * app ES la que graba el audio, y eso cambia lo que conviene entregar:
 *
 * - **A1 lleva el WAV** que la app grabó, en su offset contra el cero. Con él
 *   el editor sincroniza las cámaras por forma de onda o con la sincronía
 *   automática de Premiere, en vez de alinear a ojo contra un marcador.
 * - **Los marcadores van en la secuencia Y en el clip.** El de secuencia es con
 *   el que se salta de toma en toma en el timeline. El de clip viaja con el
 *   WAV: si el editor lo mueve, lo mete en un multicámara o lo lleva a otra
 *   secuencia, las notas se van con él. Los dos dicen lo mismo y ninguno
 *   reemplaza al otro (ver `clipItemXml` en `fcp-xml.js`).
 *
 * **La convención de los pares se mantiene.** El marcador de entrada dura 300
 * cuadros y el de salida no dura nada pero escribe su `out` con el MISMO número
 * que su `in`, no con el -1 del formato. Es lo que escribe la herramienta del
 * director de contenido y es cómo el parser de Class Cut empareja los pares, así
 * que una clase grabada acá todavía puede pasar por aquel pipeline de corte.
 */

const ajustar = require('./ajustar-corte');
const vivo = require('./notas-vivo');
const { xmlSafe, rateFor, sequenceXml, toFrames } = require('./fcp-xml');

/** El tamaño de la secuencia que se declara. */
const ANCHO = 1920;
const ALTO = 1080;

/** Blanco, el de las claquetas y el de los comentarios sobre el texto. */
const BLANCO = 4294967295;

/**
 * Cuánto dura el marcador de entrada, en SEGUNDOS.
 *
 * Diez, que a 30 cuadros son los 300 de Class Cut. Va en segundos y no en
 * cuadros porque acá el fps lo elige el editor: a 25 los mismos 300 cuadros
 * serían doce segundos, y lo que tiene que quedar igual es cuánto dura el
 * marcador en la pantalla, no cuántos cuadros ocupa.
 */
const SEGUNDOS_DEL_MARCADOR_IN = 10;

/**
 * La firma que dice de dónde salió este XML.
 *
 * Va como comentario y no como etiqueta para no inventar nada en un formato que
 * no es nuestro: Premiere y Resolve la ignoran, y un parser la lee. Y viaja con
 * el archivo, que es el punto: si alguien lo copia a otra carpeta, la firma va
 * con él.
 */
const FIRMA = '<!-- note-taker: notas-en-vivo v2 -->';

/**
 * Hora del día → segundos desde el cero.
 *
 * Nunca baja de cero: una palabra dicha antes de apretar "Iniciar" iría a un
 * tiempo negativo, que en cuadros es un marcador sin posición.
 */
function aSegundos(paredMs, ceroMs) {
    return Math.max(0, (Number(paredMs) - Number(ceroMs)) / 1000);
}

/**
 * Hora del día → cuadro del XML.
 *
 * Se expone porque es la traducción que las pruebas fijan y la que la pantalla
 * usa para dibujar el timecode: el número que el editor lee tiene que ser el
 * mismo que el que se escribe.
 */
function aCuadros(paredMs, ceroMs, fps) {
    return toFrames(aSegundos(paredMs, ceroMs), fps || 30);
}

/**
 * De qué color va el marcador de esta vista en Premiere.
 *
 * El del MARCADOR, que no es el que la vista tiene en la pantalla: una toma de
 * `R` se ve rosa mientras se graba y llega naranja a la secuencia, a propósito
 * (el por qué está en `VISTAS`, en `notas-vivo.js`).
 */
function colorDeVista(nombre) {
    const v = vivo.VISTAS.find(x => x.nombre === nombre);
    return v ? v.colorDeMarcador : vivo.VISTAS[0].colorDeMarcador;
}

/**
 * El comentario de una claqueta.
 *
 * Lleva tres cosas y las tres se usan: el número, con el que el editor la
 * nombra y la busca en su pizarra; la hora del día, que es lo que deja
 * emparejarla con la fecha de creación de un archivo de cámara cuando la
 * sincronía por onda no alcanza; y la frase que se oyó, que suele traer el
 * número dicho ("claqueta 4, clase 4") y confirma que es la que se cree.
 *
 * La primera dice además que es la de referencia. Es la que el editor
 * correlaciona primero para saber si en Premiere hay uno o varios archivos, así
 * que tiene que distinguirse de un vistazo entre siete marcadores blancos.
 */
function comentarioDeClaqueta(claqueta, esReferencia) {
    const partes = [`Claqueta ${claqueta.n}`];
    if (esReferencia) partes.push('referencia de sincronía');
    if (claqueta.paredMs) partes.push(horaDelDia(claqueta.paredMs));
    if (!claqueta.confirmada) partes.push('sin confirmar');
    if (vivo.limpio(claqueta.frase)) partes.push(`«${vivo.limpio(claqueta.frase)}»`);
    return partes.join(' · ');
}

function horaDelDia(ms) {
    const d = new Date(Number(ms));
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Los marcadores, en orden y en segundos desde el cero.
 *
 * Se devuelven en segundos y no en cuadros porque los escribe `fcp-xml`, que es
 * quien conoce la fracción exacta de cada fps (`rateFor`): redondear acá y
 * volver a redondear allá es la manera de que un 29.97 quede un cuadro corrido.
 *
 * Van en pares y el par se decide POR DURACIÓN, no por el texto: el de entrada
 * dura y el de salida no. Es lo que mira el parser de Class Cut para
 * clasificarlos, y escribirlo al revés partiría cada bloque en dos.
 */
/** Cómo se llama una toma en el XML y en la pantalla: el mismo texto en los dos. */
function nombreDeToma(toma) {
    return `Toma ${toma.id}`;
}

function marcadores(estado) {
    const cero = estado.ceroMs;
    if (cero == null) return [];
    const seg = ms => aSegundos(ms, cero);
    const salida = [];

    const claquetas = estado.claquetas || [];
    for (const claqueta of claquetas) {
        if (claqueta.ms == null) continue;
        const s = seg(claqueta.ms);
        salida.push({
            name: `Claqueta ${claqueta.n}`,
            comment: comentarioDeClaqueta(claqueta, claqueta === claquetas[0]),
            startSec: s,
            color: BLANCO,
            puntoComoIn: true
        });
    }

    for (const toma of vivo.tomasQueQuedan(estado)) {
        const vista = vivo.vistaLeida(toma.vista) || vivo.VISTA_POR_DEFECTO;
        const color = colorDeVista(vista);
        // **Los bordes van AJUSTADOS a la onda y el resto no.** El IN y el OUT
        // son lo único por lo que alguien corta, y venían de las marcas de
        // palabra de Whisper, que se corren unas décimas y dejaban el corte en
        // el medio de una sílaba. `ajustar-corte` los corrió al silencio más
        // cercano; cuando no había ninguno decente, o cuando no hay audio,
        // devuelve el mismo tiempo. Las claquetas y los comentarios sobre el
        // texto se quedan donde están, y el por qué está allá.
        const entra = seg(ajustar.inAjustado(toma));
        const sale = seg(ajustar.outAjustado(toma));

        // **El nombre lleva el número de la toma.** En la línea de tiempo de
        // Premiere el editor ve «Toma 1 · PV», «Toma 2 · PV», y con eso se da
        // cuenta de un golpe de vista si hay tomas intermedias —una que se
        // desactivó deja su número sin usar— sin tener que abrir cada
        // comentario. La vista va detrás del separador, que es de donde la lee
        // `vivo.vistaLeida` al volver a entrar el XML.
        salida.push({
            name: `${nombreDeToma(toma)} · ${vista}`,
            comment: vivo.comentarioDeEntrada(toma),
            startSec: entra,
            endSec: entra + SEGUNDOS_DEL_MARCADOR_IN,
            color
        });
        salida.push({
            name: `${nombreDeToma(toma)} · OUT`,
            comment: `OUT: ${vivo.cueDeSalida(toma)}`,
            startSec: sale,
            color,
            puntoComoIn: true
        });

        // Los comentarios sobre un pedazo del texto, en blanco para
        // distinguirlos de los de la toma.
        for (const c of toma.comentarios || []) {
            if (c.desdeMs == null) continue;
            const desde = seg(c.desdeMs);
            const hasta = c.hastaMs != null ? seg(c.hastaMs) : desde;
            salida.push({
                name: 'Nota',
                comment: vivo.limpio(c.comentario),
                startSec: desde,
                endSec: hasta > desde ? hasta : undefined,
                color: BLANCO,
                puntoComoIn: true
            });
        }
    }

    salida.sort((a, b) => a.startSec - b.startSec);
    return salida;
}

/**
 * Los mismos marcadores, pero medidos DESDE EL ARRANQUE DE UN WAV.
 *
 * Es la única diferencia entre los dos juegos: el de secuencia mide desde el
 * cero y el de clip desde el principio del archivo. Cuando hay un solo WAV y
 * arrancó con el cero son el mismo número; cuando el dispositivo se cayó y se
 * reabrió, el segundo WAV empieza más tarde y sus marcadores tienen que restar
 * ese offset o caerían fuera del clip.
 *
 * Los que no caen dentro de ese WAV se dejan afuera: son de otro archivo.
 */
function marcadoresDelClip(marcas, wav, ceroMs) {
    const offset = aSegundos(wav.desdeMs, ceroMs);
    const dura = wav.segundos || 0;
    return marcas
        .map(m => ({
            ...m,
            startSec: m.startSec - offset,
            endSec: m.endSec != null ? m.endSec - offset : undefined
        }))
        .filter(m => m.startSec >= 0 && m.startSec <= dura)
        // Un marcador que empieza dentro del clip y termina después se recorta:
        // más allá del final del archivo no hay dónde ponerlo.
        .map(m => (m.endSec != null && m.endSec > dura ? { ...m, endSec: dura } : m));
}

/**
 * Los WAV de la sesión como clips de A1, cada uno en su offset.
 *
 * Son varios cuando el dispositivo se cayó y se reabrió, y esa es exactamente
 * la razón de que la posición salga de `desdeMs` y no de encadenarlos: entre un
 * WAV y el siguiente hay un hueco real —los segundos que el audio no se grabó—
 * y pegarlos uno detrás del otro correría todo lo que viene después.
 */
function clipsDeAudio(estado) {
    const marcas = marcadores(estado);
    return (estado.sesiones || [])
        .filter(s => s && s.archivo && s.segundos > 0)
        .map(wav => {
            const suyos = marcadoresDelClip(marcas, wav, estado.ceroMs);
            return {
                source: {
                    path: wav.archivo,
                    name: wav.archivo.split('/').pop(),
                    durationSec: wav.segundos,
                    audioOnly: true,
                    channels: wav.canales || 1,
                    sampleRate: wav.sampleRate || 48000,
                    bits: 16,
                    // Los mismos marcadores, también en el clip maestro del bin:
                    // ahí son marcadores DEL ARCHIVO y se ven al abrir el WAV en
                    // el monitor de origen, y lo siguen con él a cualquier
                    // secuencia (ver `binClipXml` en `fcp-xml.js`).
                    marcadores: suyos
                },
                startSec: aSegundos(wav.desdeMs, estado.ceroMs),
                endSec: aSegundos(wav.desdeMs, estado.ceroMs) + wav.segundos,
                sourceInSec: 0,
                marcadores: suyos
            };
        });
}

/**
 * Hasta dónde llega la secuencia.
 *
 * El XML declara una duración y Premiere la usa: una secuencia más corta que su
 * último marcador lo muestra fuera de la línea de tiempo. Se toma lo más tardío
 * que haya —el final del audio o el último marcador— con un minuto de cola.
 */
function duracionEnSegundos(marcas, clips) {
    const ultimaMarca = marcas.reduce((n, m) => Math.max(n, m.endSec != null ? m.endSec : m.startSec), 0);
    const ultimoClip = clips.reduce((n, c) => Math.max(n, c.endSec), 0);
    return Math.max(ultimaMarca, ultimoClip) + 60;
}

/**
 * El XML de notas: una secuencia con el audio en A1 y los marcadores.
 *
 * Sin audio grabado todavía —los primeros segundos de una sesión, antes de que
 * el WAV tenga nada— sale igual, como secuencia con marcadores y sin clips. Es
 * lo que hace que el archivo sea legible en todo momento, que es la misma razón
 * por la que la cabecera del WAV se reescribe en cada pedazo (`captura.js`).
 */
function xmlDeNotas(estado) {
    const fps = estado.fps || 30;
    const nombre = estado.secuencia || 'notas';
    const marcas = marcadores(estado);
    const clips = clipsDeAudio(estado);

    const cuerpo = sequenceXml({
        name: nombre,
        binName: nombre,
        fps,
        width: ANCHO,
        height: ALTO,
        videoTracks: [],
        audioTracks: clips.length ? [clips] : [],
        markers: marcas,
        durationSec: duracionEnSegundos(marcas, clips)
    });

    // La firma va detrás del DOCTYPE, que es donde un comentario no molesta a
    // ningún parser y donde queda a la vista al abrir el archivo.
    return cuerpo.replace('<!DOCTYPE xmeml>', `<!DOCTYPE xmeml>\n${FIRMA}`);
}

/**
 * Lo que se guarda al lado del XML: la hora del día de todo.
 *
 * El XML lleva cuadros porque es lo que Premiere entiende, y los cuadros son
 * relativos al cero. Esto lleva la hora del día de cada palabra y de cada borde,
 * que es lo que hace imposible solapar dos tomas y lo que deja depurar cualquier
 * duda de sincronía con números en vez de con memoria.
 */
/** Una palabra como se guarda: la hora del día y lo que se dijo, nada más. */
function palabraDelArchivo(w) {
    return { t: w.t, texto: w.texto };
}

function sidecar(estado) {
    const fps = estado.fps || 30;
    return {
        version: 2,
        secuencia: estado.secuencia || null,
        curso: estado.curso || null,
        fps,
        // Cómo se escribe ese fps en el XML, resuelto: es lo que deja leer un
        // sidecar y saber si la secuencia era NTSC sin volver a hacer la cuenta.
        rate: rateFor(fps),
        idioma: estado.idioma || null,
        ceroMs: estado.ceroMs || null,
        ceroISO: estado.ceroMs ? new Date(estado.ceroMs).toISOString() : null,
        // Cuándo se apretó Terminar. Sin esto, una sesión terminada y una que
        // quedó abierta porque la app se fue al piso se ven iguales, y la
        // segunda es la única que se puede reanudar.
        terminada: estado.terminada || null,
        claquetas: (estado.claquetas || []).map(c => ({
            ...c,
            msISO: c.ms ? new Date(c.ms).toISOString() : null,
            paredISO: c.paredMs ? new Date(c.paredMs).toISOString() : null
        })),
        dispositivo: estado.dispositivo || null,
        sesiones: estado.sesiones || [],
        tomas: (estado.tomas || []).map(t => ({
            id: t.id,
            vista: t.vista,
            comentario: t.comentario || '',
            descartada: Boolean(t.descartada),
            cerradaSola: Boolean(t.cerradaSola),
            cuenta: t.cuenta || '',
            inMs: t.inMs,
            outMs: t.outMs,
            inISO: t.inMs ? new Date(t.inMs).toISOString() : null,
            outISO: t.outMs ? new Date(t.outMs).toISOString() : null,
            // A qué silencio se corrieron esos bordes para el XML, y contra qué
            // se calculó. Va al sidecar por dos motivos: "Rehacer XML" escribe
            // el MISMO corte aunque el WAV ya no esté en el disco, y un corte
            // que salió raro se puede auditar sin volver a analizar el audio
            // (`porQueIn`/`porQueOut` dicen si se movió, si ya estaba en
            // silencio o si no había hueco). Los tiempos de arriba siguen
            // siendo los que el editor marcó: eso no se pisa nunca.
            ajuste: t.ajuste || null,
            palabras: (t.palabras || []).map(palabraDelArchivo),
            // Qué le pasó a la relectura de esta toma, cuando le pasó algo
            // (`engine/insistir.js`). Va al sidecar y no solo a la pantalla
            // porque es justamente el dato que se necesita DESPUÉS: la toma que
            // quedó leída con un modelo peor —o sin releer— es la que alguien va
            // a querer regenerar con calma, y viviendo solo en memoria se
            // perdería al cerrar la app, que es cuando termina un día de rodaje.
            relectura: t.relectura || null,
            // Lo que se dijo pegado a cada borde. Se guarda para que mover un IN
            // o un OUT en una sesión ya cerrada se siga haciendo mirando el
            // texto, sin tener que releer el audio para saber qué hay del otro
            // lado.
            antes: (t.antes || []).map(palabraDelArchivo),
            despues: (t.despues || []).map(palabraDelArchivo),
            comentarios: t.comentarios || []
        }))
    };
}

/**
 * Un sidecar recién leído del disco, hablado como se habla hoy.
 *
 * La puerta de entrada del formato es una sola, igual que la de salida, y por el
 * mismo motivo: si cada quien tradujera por su cuenta, listar una sesión y
 * editarla darían nombres de vista distintos para la misma toma.
 */
function estadoLeido(estado) {
    if (!estado) return estado;
    return {
        ...estado,
        claquetas: estado.claquetas || [],
        proximaClaqueta: (estado.claquetas || []).length,
        tomas: (estado.tomas || []).map(t => ({ ...t, vista: vivo.vistaLeida(t.vista) }))
    };
}

module.exports = {
    nombreDeToma,
    BLANCO,
    FIRMA,
    SEGUNDOS_DEL_MARCADOR_IN,
    aSegundos,
    aCuadros,
    colorDeVista,
    comentarioDeClaqueta,
    marcadores,
    marcadoresDelClip,
    clipsDeAudio,
    xmlDeNotas,
    sidecar,
    estadoLeido
};
