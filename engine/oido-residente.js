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

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const idiomas = require('./idiomas');
const paths = require('./paths');
const registro = require('./registro');
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

/**
 * Cuántos arranques seguidos pueden vencer el plazo antes de dejar de
 * intentar en esta sesión. Un modelo que no carga en un minuto no va a cargar
 * en el siguiente, y cada intento es otro gigabyte y medio a la GPU mientras
 * se graba. El ciclo sigue con `whisper-cli`, como sin servidor.
 */
const ARRANQUES_FALLIDOS_MAX = 2;
let arranquesFallidos = 0;

/**
 * Dónde se anota el pid del servidor vivo.
 *
 * Si la app se cae —no se cierra: se cae—, nadie corre `apagar` ni el `exit`
 * del proceso, y el servidor queda huérfano con el modelo cargado. Con el pid
 * anotado, la app que arranca después lo encuentra y lo apaga
 * (`limpiarHuerfano`). `NT_RESIDENTE_PID` lo desvía, para las pruebas.
 */
function archivoDelPid() {
    return process.env.NT_RESIDENTE_PID
        || path.join(os.homedir(), 'Library', 'Application Support', 'Note Taker', 'whisper-server.pid');
}

function anotarPid(pid) {
    try {
        fs.mkdirSync(path.dirname(archivoDelPid()), { recursive: true });
        fs.writeFileSync(archivoDelPid(), String(pid));
    } catch (e) { /* sin el archivo, solo se pierde la limpieza de después de una caída */ }
}

function borrarPid(pid) {
    try {
        if (fs.readFileSync(archivoDelPid(), 'utf8').trim() === String(pid)) fs.rmSync(archivoDelPid());
    } catch (e) { /* no estaba */ }
}

/**
 * Apaga el servidor que dejó una app que se cayó, si sigue vivo.
 *
 * Se mira que el proceso sea de verdad un `whisper-server` antes de tocarlo:
 * un pid viejo puede haber quedado en manos de cualquier otro proceso.
 *
 * @returns {number|null} el pid que se apagó, o null
 */
function limpiarHuerfano() {
    let pid;
    try {
        pid = Number(fs.readFileSync(archivoDelPid(), 'utf8').trim());
        fs.rmSync(archivoDelPid());
    } catch (e) {
        return null;
    }
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return null;
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    const comm = String(r.stdout || '').trim();
    if (!comm || path.basename(comm) !== 'whisper-server') return null;
    try {
        process.kill(pid, 'SIGTERM');
        return pid;
    } catch (e) {
        return null;
    }
}

/** Los servidores vivos de este proceso, para apagarlos si la app sale sin `apagar`. */
const vivos = new Set();
process.once('exit', () => {
    for (const hijo of vivos) { try { hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ } }
});

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
                // El de arranque es solo el de por defecto: cada pedido manda
                // su `language`, y es ese el que vale (medido: con el servidor
                // levantado en `es`, un pedido en `auto` detectó el inglés). Por
                // eso cambiar de idioma —o de modo— no obliga a relevantarlo.
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
            const hijo = este.hijo;
            vivos.add(hijo);
            if (hijo.pid) anotarPid(hijo.pid);
            hijo.on('exit', (codigo, senal) => {
                vivos.delete(hijo);
                if (hijo.pid) borrarPid(hijo.pid);
                // Que se muera solo, con el modelo cargado, no se veía en ningún
                // lado: el ciclo pasaba a whisper-cli y el texto en vivo se
                // atrasaba sin que quedara rastro de por qué.
                if (servidor === este && este.listo) {
                    registro.anotar('main', 'residente.se-cayo', { codigo, senal: senal || null });
                }
                este.listo = false;
                if (servidor === este) servidor = null;
            });
            const hasta = Date.now() + (o.arranqueMaxMs || ARRANQUE_MAX_MS);
            while (Date.now() < hasta && servidor === este) {
                try {
                    const r = await fetch(`http://127.0.0.1:${este.puerto}/`, { signal: AbortSignal.timeout(1000) });
                    if (r.ok) { este.listo = true; arranquesFallidos = 0; return true; }
                } catch (e) { /* todavía cargando */ }
                await espera(250);
            }
            // No contestó a tiempo: se tira, en vez de dejarlo vivo y colgado
            // con el modelo a medio cargar, que además impedía volver a intentar.
            if (servidor === este) {
                arranquesFallidos++;
                registro.anotar('main', 'residente.no-arranco', { veces: arranquesFallidos, modelo: modelo.name || null });
                apagarServidor();
                if (arranquesFallidos >= ARRANQUES_FALLIDOS_MAX) ultimasOpciones = null;
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
 * Qué idioma suena, medido aparte de transcribir y en dos pasos.
 *
 * **Medir costaba casi lo mismo que transcribir**: el servidor volvía a pasar
 * el audio por el codificador con el contexto entero —treinta segundos, aunque
 * la ventana sea de seis—, y una pasada que medía tardaba 653 ms contra 355.
 * Una de cada tres pasadas del vivo mide.
 *
 * Ahora la medida es un pedido aparte que no transcribe nada (`duration` de
 * 100 ms: `whisper_full` sale antes de la primera ventana) y que le da al
 * codificador solo el contexto que la ventana ocupa (`audio_ctx`): 68 ms. Con
 * el contexto corto se equivoca un poco más —en 12 de 319 ventanas dijo otro
 * idioma que la medida entera, casi siempre inglés sobre español con términos
 * en inglés—, así que **a la barata solo se le cree cuando dice el idioma que
 * se viene oyendo**, que es lo de casi siempre. Si dice otro, se mide de nuevo
 * con el contexto entero, que es la medida de antes, y vale esa.
 *
 * Medido el 11/11 sobre cinco clases y tres audios en inglés, por la lógica de
 * verdad (`enAutomatico` + `anotarOido`): 227 medidas, las mismas 227
 * decisiones y los cambios de idioma en el mismo segundo que con la medida
 * entera, a 103 ms de promedio en vez de 305. El contexto justo (sin margen)
 * no sirve: con 6 s de contexto para 6 s de audio los pesos se corren, y con
 * la mitad dijo inglés sobre español claro.
 *
 * @param {function(number): Promise<{oido:string|null, pesos:object|null}>} pedir
 *   mide con ese contexto, en cuadros de 20 ms; 0 es el entero
 * @param {string} idioma el que se le pidió a la pasada, que es el que se viene oyendo
 * @param {number} segundos cuánto dura la ventana
 */
async function idiomaEnDosPasos(pedir, idioma, segundos) {
    const corto = contextoPara(segundos);
    if (corto) {
        const barata = await pedir(corto);
        if (barata.oido === idioma) return barata;
    }
    return pedir(0);
}

/** Lo que no se transcribe en un pedido de solo medir: el mínimo que `whisper_full` acepta. */
const SOLO_MEDIR_MS = 100;
/** El contexto entero del codificador, y el margen que se le deja a la ventana: dos segundos. */
const CONTEXTO_ENTERO = 1500;
const MARGEN_DE_CONTEXTO = 100;

/** El contexto para una ventana de tantos segundos, o 0 si ya da lo mismo que el entero. */
function contextoPara(segundos) {
    if (!(segundos > 0)) return 0;
    const cuadros = Math.ceil(segundos * 50) + MARGEN_DE_CONTEXTO;
    return cuadros < CONTEXTO_ENTERO ? cuadros : 0;
}

/** Cuánto dura un WAV de los de `captura.recorte`: 16 kHz, mono, 16 bits. */
const segundosDelRecorte = bytes => Math.max(0, bytes - 44) / 32000;

/** Un pedido de solo medir: sin transcripción, y con el contexto que se diga. */
async function medirIdioma(este, audio, idioma, contexto) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'pedazo.wav');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('temperature_inc', '0');
    // Con un idioma puesto y no `auto`: con `auto`, `whisper_full` detecta por
    // su cuenta antes de salir, y eso es otra pasada entera por el codificador.
    form.append('language', idioma);
    form.append('duration', String(SOLO_MEDIR_MS));
    if (contexto) form.append('audio_ctx', String(contexto));
    const r = await fetch(`http://127.0.0.1:${este.puerto}/inference`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(PASADA_MAX_MS)
    });
    if (!r.ok) throw new Error(`whisper-server contestó ${r.status}`);
    const dicho = await r.json();
    return { oido: idiomas.normalizar(dicho.detected_language), pesos: dicho.language_probabilities || null };
}

/**
 * Transcribe un WAV de 16 kHz mono (el de `captura.recorte`).
 *
 * **Y dice qué idioma oyó, aunque se le haya pedido uno**: es lo que deja que
 * «Automático» pida el idioma que viene oyendo —que es rápido— sin dejar de
 * mirar si cambió, y que con el idioma puesto a mano la barra avise que suena
 * otro. Con un idioma pedido se mide aparte y barato (`idiomaEnDosPasos`); con
 * `auto` lo contesta el mismo pedido, que igual tiene que detectar para
 * transcribir, y eso pasa solo hasta que el idioma se asienta.
 *
 * Una medida que falla no tira la pasada: el texto ya está, y el idioma se
 * vuelve a medir en la que sigue.
 *
 * @param {object} [opciones] `medirIdioma` (sí, salvo `false`), `reintentos`
 *   (no, salvo `true`) y `medidaEntera` (la medida de antes, en el mismo
 *   pedido): los compara `tools/banco-pasada.js`
 * @returns {Promise<{words:Array, model:string, oido:string|null, pesos:object}>}
 *   tira si el servidor no está o falla: quien llama cae al respaldo
 */
async function transcribir(wavPath, idioma, opciones) {
    if (!listo()) throw new Error('whisper-server no está listo');
    const o = opciones || {};
    const medir = o.medirIdioma !== false;
    const aparte = medir && !o.medidaEntera && Boolean(idioma) && idioma !== 'auto';
    const este = servidor;
    const audio = fs.readFileSync(wavPath);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'pedazo.wav');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    // Sin reintentos a más temperatura: con el de fábrica (0,2) una ventana
    // difícil se decodificaba hasta seis veces, y en vivo eso es una pasada que
    // llega tarde. La relectura de la toma, que sí puede esperar, va por
    // `whisper-cli` con los suyos.
    if (!o.reintentos) form.append('temperature_inc', '0');
    // Los pesos de cada idioma en este mismo pedido vuelven a pasar el audio
    // por el codificador con el contexto entero: solo con `auto` o si se pide.
    if (!medir || aparte) form.append('no_language_probabilities', 'true');
    if (idioma) form.append('language', idioma);
    const r = await fetch(`http://127.0.0.1:${este.puerto}/inference`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(PASADA_MAX_MS)
    });
    if (!r.ok) throw new Error(`whisper-server contestó ${r.status}`);
    const dicho = await r.json();
    fallas = 0;
    // El que DETECTÓ, no el que se usó: con el idioma forzado los dos
    // difieren, y es justo ahí donde saberlo sirve. Sin medir, con `auto` el
    // que se usó es el detectado; con uno pedido, no se sabe.
    let medido = {
        oido: medir
            ? idiomas.normalizar(dicho.detected_language)
            : (idioma === 'auto' ? idiomas.normalizar(dicho.language) : null),
        pesos: dicho.language_probabilities || null
    };
    if (aparte) {
        try {
            medido = await idiomaEnDosPasos(
                contexto => medirIdioma(este, audio, idioma, contexto), idioma, segundosDelRecorte(audio.length));
        } catch (err) {
            medido = { oido: null, pesos: null };
            registro.anotar('main', 'residente.no-midio', { error: err.message });
        }
    }
    return { words: palabrasDe(dicho), model: este.modelo.name, oido: medido.oido, pesos: medido.pesos };
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
    arranquesFallidos = 0;
    apagarServidor();
}

function apagarServidor() {
    const este = servidor;
    servidor = null;
    if (este && este.hijo) {
        try { este.hijo.kill('SIGTERM'); } catch (e) { /* ya se fue */ }
    }
}

module.exports = {
    arrancar, asegurar, listo, modelo, transcribir, fallo, apagar, palabrasDe, limpiarHuerfano,
    idiomaEnDosPasos, contextoPara
};
