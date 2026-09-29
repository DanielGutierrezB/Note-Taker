'use strict';
/**
 * oido-residente.js — whisper-server con el modelo grande cargado, para el
 * texto en vivo.
 *
 * El ciclo de señales relanzaba `whisper-cli` en cada pasada, y cada vez eso es
 * leer el modelo del disco y armarlo en la GPU antes de oír nada. Por eso se oía
 * con el modelo chico: con el grande cada pasada costaba casi un segundo. Medido
 * en esta app sobre el audio de Zoom de una prueba real, pedazos de 6 s en una
 * M3 Max:
 *
 *   whisper-cli + small           0,76 s   «Esto inicia el primera tomo»
 *   whisper-cli + large-v3-turbo  0,96 s   «esto inicia la primera toma»
 *   whisper-server + turbo        0,54 s   «esto inicia la primera toma»
 *
 * O sea que dejarlo cargado hace que el modelo bueno salga MÁS rápido que el
 * malo relanzado, y el texto en vivo pasa a ser el que se puede leer.
 *
 * Es un respaldo, no un reemplazo: si no hay `whisper-server`, si no arranca o
 * si se cae a mitad de clase, `oir.escuchar` vuelve a `whisper-cli` con el
 * liviano como antes, y la clase sigue. La relectura de cada toma cerrada no
 * pasa por acá: esa sigue siendo `whisper-cli` con alineación DTW, que es lo que
 * da los tiempos por palabra del XML.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');

const paths = require('./paths');
const transcribe = require('./transcribe');

/** Cuánto se espera a que el modelo termine de cargar antes de darlo por perdido. */
const ARRANQUE_MAX_MS = 60000;

/** Una pasada que tarda más que esto es un servidor trabado, no uno lento. */
const PASADA_MAX_MS = 15000;

let servidor = null;

/**
 * Cuántas pasadas seguidas pueden fallar antes de tirar el servidor y volver a
 * levantarlo, y cuánto se espera entre dos arranques. Un servidor trabado hacía
 * esperar los quince segundos de `PASADA_MAX_MS` en CADA pasada, y uno que se
 * caía no se volvía a levantar en toda la clase.
 */
const FALLAS_PARA_REINICIAR = 3;
const ENTRE_ARRANQUES_MS = 20000;
let fallas = 0;
let ultimoArranque = 0;
let ultimasOpciones = null;

function puertoLibre() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

const espera = ms => new Promise(r => setTimeout(r, ms));

/**
 * Levanta el servidor, si no hay uno ya. No espera a que termine de cargar: la
 * sesión arranca igual y el ciclo usa el respaldo hasta que `listo()` diga que sí.
 *
 * @param {object} [opciones] { idioma, modelo: {path,name}, bin }
 */
function arrancar(opciones) {
    if (servidor) return servidor.cargando;
    const o = opciones || {};
    ultimasOpciones = o;
    ultimoArranque = Date.now();
    fallas = 0;
    const bin = o.bin || paths.whisperServer().path;
    const modelo = o.modelo || paths.whisperModel();
    if (!bin || !modelo || !modelo.path) return Promise.resolve(false);

    const este = { hijo: null, puerto: null, listo: false, modelo, cargando: null, idioma: o.idioma || 'es' };
    servidor = este;
    este.cargando = (async () => {
        try {
            este.puerto = await puertoLibre();
            este.hijo = spawn(bin, [
                '-m', modelo.path,
                '--host', '127.0.0.1',
                '--port', String(este.puerto),
                '-l', este.idioma,
                // Sin arrastrar el texto de una pasada a la siguiente, por lo
                // mismo que en `transcribe.runWhisper`: el prompt trabado repite.
                '-mc', '0',
                // Los ruidos (golpes, risas) sin tokens de texto: sobre un pedazo
                // de toc-toc, whisper-cli escribía «Gracias.» seis veces.
                '-sns',
                // La alineación contra el sonido, igual que la relectura. Son
                // estos tiempos los que ponen el IN de «3, 2, 1» y el OUT de
                // «Pausa»: sin DTW caían hasta medio segundo corridos, y la
                // relectura, que sí lo usa, después ponía las palabras en otro
                // lado que el borde. Cuesta 0,15 s por pasada (0,69 contra 0,54).
                ...dtw(modelo)
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            este.hijo.stderr.on('data', () => {});
            // Que no quede vivo con el gigabyte y medio del modelo si la app se
            // va sin pasar por `apagar`.
            process.once('exit', () => { try { este.hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ } });
            este.hijo.on('exit', () => {
                este.listo = false;
                if (servidor === este) servidor = null;
            });
            const hasta = Date.now() + ARRANQUE_MAX_MS;
            while (Date.now() < hasta && servidor === este) {
                try {
                    const r = await fetch(`http://127.0.0.1:${este.puerto}/`, { signal: AbortSignal.timeout(1000) });
                    if (r.ok) { este.listo = true; return true; }
                } catch (e) { /* todavía cargando */ }
                await espera(250);
            }
            return false;
        } catch (e) {
            return false;
        }
    })();
    return este.cargando;
}

/** `-nfa -dtw <preset>` si el modelo tiene preset: con flash attention, DTW no corre. */
function dtw(modelo) {
    const preset = transcribe.DTW_POR_MODELO[modelo.name];
    return preset ? ['-nfa', '-dtw', preset] : [];
}

/**
 * Que haya un servidor, si alguna vez se pidió uno: si se cayó, se vuelve a
 * levantar, sin más de un intento cada `ENTRE_ARRANQUES_MS`. Lo llama cada
 * pasada del ciclo; mientras tanto se oye por whisper-cli.
 */
function asegurar(opciones) {
    if (servidor || !ultimasOpciones) return;
    if (Date.now() - ultimoArranque < ENTRE_ARRANQUES_MS) return;
    arrancar({ ...ultimasOpciones, ...(opciones || {}) });
}

function listo() {
    return Boolean(servidor && servidor.listo);
}

/** Con qué modelo oye, para decirlo en Diagnóstico y en el registro. */
function modelo() {
    return servidor && servidor.listo ? servidor.modelo.name : null;
}

/**
 * Las piezas de `verbose_json` → palabras `{start, end, text}`.
 *
 * El servidor las da por TOKEN y no por palabra: «inicia» llega como « in» +
 * «icia». Un pedazo que empieza con espacio abre una palabra nueva, y el que no
 * se pega a la anterior, que es como el modelo las escribió. Los signos de
 * puntuación llegan igual, pegados, y así quedan en la palabra de al lado.
 */
function palabrasDe(respuesta) {
    const out = [];
    for (const seg of (respuesta && respuesta.segments) || []) {
        for (const w of seg.words || []) {
            const pieza = String(w.word == null ? '' : w.word);
            if (!pieza.trim() || /^\s*\[.*\]\s*$/.test(pieza)) continue;
            const ultima = out[out.length - 1];
            // `t_dtw` viene en centésimas y en -1 cuando no se pudo ubicar, igual
            // que en el JSON de whisper-cli (`dtwDelSegmento` en transcribe.js).
            // De la palabra vale el de su primera pieza que traiga dato.
            const dtwSec = typeof w.t_dtw === 'number' && w.t_dtw >= 0 ? w.t_dtw / 100 : null;
            if (ultima && !/^\s/.test(pieza)) {
                ultima.text += pieza;
                ultima.end = Math.max(ultima.end, w.end);
                if (ultima.dtw == null && dtwSec != null) ultima.dtw = dtwSec;
                continue;
            }
            const palabra = { start: w.start, end: Math.max(w.end, w.start), text: pieza.trim() };
            if (dtwSec != null) palabra.dtw = dtwSec;
            out.push(palabra);
        }
    }
    return out;
}

/**
 * Transcribe un WAV de 16 kHz mono (el de `captura.recorte`).
 *
 * @returns {Promise<{words:Array, model:string}>} tira si el servidor no está o
 *   falla: quien llama cae al respaldo
 */
async function transcribir(wavPath, idioma) {
    if (!listo()) throw new Error('whisper-server no está listo');
    const este = servidor;
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'pedazo.wav');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (idioma) form.append('language', idioma);
    const r = await fetch(`http://127.0.0.1:${este.puerto}/inference`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(PASADA_MAX_MS)
    });
    if (!r.ok) throw new Error(`whisper-server contestó ${r.status}`);
    const salida = { words: palabrasDe(await r.json()), model: este.modelo.name };
    fallas = 0;
    return salida;
}

/** Una pasada que falló. A la tercera seguida, el servidor se tira y se rearma. */
function fallo() {
    fallas++;
    if (fallas < FALLAS_PARA_REINICIAR || !servidor) return;
    const opciones = ultimasOpciones;
    apagarServidor();
    ultimasOpciones = opciones;
    ultimoArranque = 0;
}

/** Al terminar la sesión: se apaga y no se vuelve a levantar solo. */
function apagar() {
    ultimasOpciones = null;
    apagarServidor();
}

function apagarServidor() {
    const este = servidor;
    servidor = null;
    if (este && este.hijo) {
        try { este.hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ }
    }
}

module.exports = { arrancar, asegurar, listo, modelo, transcribir, fallo, apagar, palabrasDe };
