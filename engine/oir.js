'use strict';
/**
 * oir.js — Transcribir un pedazo de lo que se está capturando.
 *
 * Dos usos distintos y un solo camino: recortar el WAV con ffmpeg y pasarle el
 * recorte a `whisper-cli` (`transcribe.runWhisper`). No hay transcripción en
 * streaming acá, y es una decisión:
 *
 * **Por qué por pedazos y no en continuo.** Whisper en streaming va escribiendo
 * y corrigiendo lo que ya escribió, y de ahí no sale un transcript con tiempos
 * confiables por palabra. Medido con nuestro binario sobre material real, un
 * recorte tarda 1,14 s si trae 10 s de audio y 1,25 s si trae 20: casi todo es
 * cargar el modelo, así que el largo no importa. Y lo que de verdad permite
 * hacerlo así es que **la latencia no perjudica la precisión**: cuando el
 * profesor dice "Pausa", el OUT se pone en el timecode de esa palabra, no en el
 * momento en que la herramienta se enteró. Con una clase de tres horas eso es lo
 * único que mantiene los tiempos cerrados de punta a punta.
 *
 * **Los dos ciclos.** El de señales corre seguido con un modelo liviano y su
 * texto se tira: solo sirve para ver si alguien dijo "3, 2, 1", "Pausa" o
 * "claqueta". El de toma corre una vez, al cerrar, con el modelo grande, y ESE
 * texto es el que queda. Así el transcript nunca se arma de pedazos pegados, que
 * es de donde salen las palabras cortadas y los tiempos que no cierran.
 */

const paths = require('./paths');
const captura = require('./captura');
const transcribe = require('./transcribe');

/**
 * Palabras de Whisper → palabras con hora del día.
 *
 * `desdeSec` es qué momento del archivo quedó en el segundo 0 del recorte, y
 * `sesion.desdeMs` a qué hora del día empezó ese archivo. Con los dos, el
 * `start` de cada palabra se convierte en una hora, que es el reloj con el que
 * trabaja todo lo demás.
 *
 * Se usa `dtw` cuando viene: es la alineación contra el espectrograma, o sea
 * contra el sonido, y cae más cerca de donde la palabra suena que el `start`
 * crudo del modelo.
 */
function aHoraDelDia(words, sesion, desdeSec) {
    const base = sesion.desdeMs + desdeSec * 1000;
    return (words || []).map(w => {
        const seg = w.dtw != null ? w.dtw : w.start;
        return {
            t: Math.round(base + seg * 1000),
            texto: w.text,
            // El final también, que es lo que deja saber si una palabra se comió
            // un silencio, y de donde sale el OUT de una toma (`finDeToma`).
            hasta: Math.round(base + (w.end != null ? w.end : seg) * 1000)
        };
    });
}

/**
 * Escucha un tramo del reloj de pared y devuelve lo que se dijo.
 *
 * @param {object} params
 *   sesion    la sesión de captura (de `captura.abrir`), con `archivo` y `desdeMs`
 *   desdeMs   hora del día donde empieza lo que hay que oír
 *   hastaMs   hora del día donde termina
 *   liviano   true para el ciclo de señales
 *   idioma    el de la clase, de Ajustes
 *   modelo    con qué leer el tramo grande, si no es el de siempre. Lo usa la
 *             política de reintento cuando el sistema se lleva a whisper-cli y
 *             hay que bajar un escalón (`engine/insistir.js`); sin él manda
 *             `paths.whisperModel`, que es lo que pasa en toda toma que sale bien
 * @returns {Promise<{palabras:Array, colapsadas:number}|null>}
 */
async function escuchar(params) {
    const p = params || {};
    if (!p.sesion) return null;

    const recortado = captura.recorte({
        sesion: p.sesion,
        desdeMs: p.desdeMs,
        hastaMs: p.hastaMs
    });
    if (!recortado) return null;

    try {
        const opciones = { language: p.idioma || 'es' };
        // El liviano, si está. La búsqueda es la misma que muestra Diagnóstico
        // (`paths.modeloLiviano`), así que no pueden discrepar. Si no hay, el
        // ciclo cae al modelo de siempre: peor —un segundo cada tres en vez de un
        // décimo— pero funciona, y no se baja nada solo: bajar un modelo a mitad
        // de una grabación es lo último que uno quiere.
        const liviano = p.liviano ? paths.modeloLiviano() : null;
        if (liviano && liviano.path) opciones.model = liviano;
        // Y el escalón de abajo, cuando la pasada grande ya se murió con el bueno
        // y quien la pide decidió bajar (`engine/oir-toma.js`). Va con la misma
        // regla que el liviano —tiene que venir con ruta— porque caer al de
        // siempre en silencio dejaría a la toma marcada como degradada mintiendo.
        if (!p.liviano && p.modelo && p.modelo.path) opciones.model = p.modelo;

        const salida = await transcribe.runWhisper(recortado.archivo, opciones);

        // Whisper rellena los silencios con repeticiones y con créditos de
        // subtítulos aprendidos de memoria: sobre un tramo donde nadie hablaba
        // llegó a escribir "Andrea Oroz Sincronización" cuarenta y cinco veces.
        // Una toma abierta sobre un silencio es exactamente la situación que lo
        // dispara, así que la defensa va también acá y no solo en post.
        const limpias = transcribe.collapseLoops(salida.words || []);

        return {
            palabras: aHoraDelDia(limpias.words, p.sesion, recortado.desdeSec),
            colapsadas: limpias.removed
        };
    } finally {
        captura.tirar(recortado);
    }
}

module.exports = {
    aHoraDelDia,
    escuchar
};
