'use strict';
/**
 * captura.js — El audio que entra, escrito a disco mientras entra.
 *
 * La ventana abre el dispositivo (es la única que puede: `getUserMedia` vive en
 * el navegador) y manda el PCM para acá. Este archivo solo escribe, y escribe de
 * la forma más aburrida posible a propósito: un WAV de 16 bits, sin buffers
 * grandes ni compresión, porque lo que se está grabando no se puede repetir.
 *
 * **La cabecera se reescribe en cada pedazo.** Un WAV declara en sus primeros 44
 * bytes cuánto mide, y eso no se sabe hasta cerrarlo. Si la app se cayera con la
 * cabecera en cero, el archivo tendría el audio adentro y ningún programa lo
 * abriría.
 *
 * Se hacía cada tres segundos, que parecía suficiente y no lo era: el ciclo de
 * señales pide justo los últimos segundos de audio, y ffmpeg le cree a la
 * cabecera, así que pedía un tramo que el archivo todavía declaraba inexistente y
 * se llevaba un WAV vacío. Whisper sobre un WAV vacío termina bien y no escribe
 * nada, y lo que se veía era "no dejó un JSON legible" cada pocos segundos —con
 * las señales de ese tramo perdidas—. Lo encontró `tools/simular-grabacion.js`
 * pasándole el Live-Mix de una clase de verdad.
 *
 * Escribirla siempre son 44 bytes más por pedazo, unas doce veces por segundo.
 * No se nota, y a cambio el archivo es legible en todo momento y por cualquiera.
 *
 * **Una sesión, un archivo.** Parar de escuchar y seguir abre otro WAV en vez de
 * dejar un hueco de silencio adentro de uno: el hueco sería mentira —el reloj de
 * pared siguió andando pero el archivo no— y cualquier tiempo medido sobre él
 * quedaría corrido de ahí en adelante. Los tiempos viven en la hora del día
 * (`notas-vivo.js`), no en la posición dentro del archivo.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const paths = require('./paths');
const registro = require('./registro');
const workspace = require('./workspace');

const BITS = 16;

const sesiones = new Map();
/**
 * El número del último WAV abierto en este proceso.
 *
 * Vuelve a cero con cada arranque, así que no alcanza para nombrar: al reanudar
 * después de reabrir la app, el `-1.wav` ya está en el disco con la primera
 * mitad de la clase. `abrir` salta los que ya existen.
 */
let proxima = 0;

function cabecera(bytesDeDatos, sampleRate, canales) {
    const buf = Buffer.alloc(44);
    const bloque = canales * BITS / 8;
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + bytesDeDatos, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);            // PCM sin comprimir
    buf.writeUInt16LE(canales, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * bloque, 28);
    buf.writeUInt16LE(bloque, 32);
    buf.writeUInt16LE(BITS, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(bytesDeDatos, 40);
    return buf;
}

/**
 * Abre una sesión de escucha.
 *
 * @param {object} params { dir, nombre, sampleRate, canales, desdeMs }
 * @returns {{id:number, archivo:string, desdeMs:number}}
 */
function abrir(params) {
    const p = params || {};
    const dir = p.dir;
    if (!dir) throw new Error('Falta la carpeta donde escribir el audio.');
    workspace.ensureDir(dir);

    const sampleRate = Math.round(p.sampleRate || 48000);
    const canales = Math.max(1, Math.min(2, Math.round(p.canales || 1)));
    const base = workspace.safeName(p.nombre || 'escucha');

    // Con `wx` y no con `w`: abrir un archivo que ya existe lo truncaría, y lo
    // que hay adentro es audio de una clase que no se puede volver a grabar.
    let id;
    let archivo;
    let fd;
    for (;;) {
        id = ++proxima;
        archivo = path.join(dir, `${base}-${id}.wav`);
        try {
            fd = fs.openSync(archivo, 'wx');
            break;
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
        }
    }
    try {
        fs.writeSync(fd, cabecera(0, sampleRate, canales), 0, 44, 0);
    } catch (err) {
        try { fs.closeSync(fd); } catch (e) { /* ya estaba cerrado */ }
        throw err;
    }

    const sesion = {
        id,
        archivo,
        fd,
        sampleRate,
        canales,
        bytes: 0,
        desdeMs: Number(p.desdeMs) || Date.now(),
        hastaMs: null
    };
    sesiones.set(id, sesion);
    return { id, archivo, desdeMs: sesion.desdeMs, sampleRate, canales };
}

/**
 * Escribe un pedazo de PCM.
 *
 * Llega en 16 bits ya convertido por la ventana: el `AudioWorklet` entrega coma
 * flotante y pasarla así por el puente duplicaría el tráfico para escribir la
 * mitad. La conversión es una multiplicación, y allá el dato ya está en la mano.
 *
 * @param {number} id
 * @param {Buffer|Uint8Array} pcm
 * @returns {{bytes:number, segundos:number}}
 */
function escribir(id, pcm) {
    const s = sesiones.get(id);
    if (!s) throw new Error(`No hay sesión de captura ${id}.`);
    const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm.buffer || pcm);
    if (buf.length) {
        const donde = 44 + s.bytes;
        // **El lugar del pedazo se cuenta aunque no se haya podido escribir.**
        // Si no, el siguiente caía donde iba este y todo lo de después quedaba
        // corrido contra la cámara. Así queda un hueco en silencio del tamaño
        // de lo que se perdió, en su sitio, y el error sale igual para que
        // quien escribe lo diga.
        s.bytes += buf.length;
        fs.writeSync(s.fd, buf, 0, buf.length, donde);
        fs.writeSync(s.fd, cabecera(s.bytes, s.sampleRate, s.canales), 0, 44, 0);
        asegurar(s);
    }
    return { bytes: s.bytes, segundos: segundosDe(s) };
}

/**
 * Cada cuánto se le pide al sistema que el WAV quede de verdad en el disco.
 *
 * Escribir deja los datos en la memoria del sistema; un corte de luz se lleva
 * lo que no bajó. Cinco segundos es lo que se arriesga, contra pedírselo con
 * cada pedazo, que haría esperar al disco doce veces por segundo.
 */
const ASEGURAR_CADA_MS = 5000;

function asegurar(s) {
    const ahora = Date.now();
    if (ahora - (s.aseguradoMs || 0) < ASEGURAR_CADA_MS) return;
    s.aseguradoMs = ahora;
    fs.fsyncSync(s.fd);
}

function segundosDe(s) {
    return s.bytes / (s.sampleRate * s.canales * BITS / 8);
}

/**
 * Cierra la sesión dejando la cabecera con el tamaño real.
 *
 * **Siempre suelta la sesión, aunque la cabecera no se pueda escribir.** Antes
 * el error salía antes de soltarla: el archivo quedaba cerrado y la sesión en
 * la lista, así que cada «Terminar» siguiente volvía a escribir sobre un
 * archivo cerrado y volvía a fallar. El audio ya está en el disco —la cabecera
 * se escribe con cada pedazo—, así que lo que se pierde es a lo sumo el último
 * tamaño, y el error vuelve en `error` para que quien cierra lo diga.
 */
function cerrar(id, hastaMs) {
    const s = sesiones.get(id);
    if (!s) return null;
    sesiones.delete(id);
    let error = null;
    try {
        // Si el último pedazo no se pudo escribir, el archivo es más corto que
        // lo que cuenta `bytes`: se completa con silencio, que es donde iba ese
        // pedazo, y así la cabecera dice lo que el archivo tiene.
        if (fs.fstatSync(s.fd).size < 44 + s.bytes) fs.ftruncateSync(s.fd, 44 + s.bytes);
        fs.writeSync(s.fd, cabecera(s.bytes, s.sampleRate, s.canales), 0, 44, 0);
    } catch (err) {
        error = err.message;
    }
    try { fs.closeSync(s.fd); } catch (e) { /* ya estaba cerrado */ }
    s.hastaMs = Number(hastaMs) || Date.now();
    const salida = resumen(s);
    if (error) salida.error = error;
    return salida;
}

function resumen(s) {
    return {
        id: s.id,
        archivo: s.archivo,
        desdeMs: s.desdeMs,
        hastaMs: s.hastaMs,
        sampleRate: s.sampleRate,
        canales: s.canales,
        segundos: Math.round(segundosDe(s) * 100) / 100
    };
}

/** Cierra lo que haya quedado abierto, con la cabecera al día: es lo de salir. */
function cerrarTodo() {
    return [...sesiones.keys()].map(id => cerrar(id));
}

/**
 * Dónde cae un momento del reloj de pared dentro de una sesión.
 *
 * @returns {number|null} segundos desde el principio del archivo, o null si ese
 *   momento no está en esta sesión
 */
function posicionDe(sesion, paredMs) {
    if (!sesion || sesion.desdeMs == null) return null;
    const seg = (Number(paredMs) - sesion.desdeMs) / 1000;
    if (seg < 0) return null;
    const total = sesion.segundos != null ? sesion.segundos : Infinity;
    if (seg > total + 0.5) return null;
    return seg;
}

/**
 * De varias sesiones de captura, la que tiene grabado ese momento.
 *
 * Una clase puede quedar en más de un archivo —parar y seguir abre otro WAV— y
 * una toma vive en uno solo. Sirve tanto para la grabación en curso (con el
 * archivo abierto) como para volver a leer una clase terminada desde lo que
 * quedó en el disco.
 *
 * @param {Array} sesiones como las deja `cerrar` o como está la abierta
 * @returns {object|null}
 */
function laQueContiene(sesiones, paredMs) {
    return (sesiones || []).find(s => posicionDe(s, paredMs) != null) || null;
}

/**
 * Corta un pedazo del audio capturado y lo deja como lo quiere Whisper.
 *
 * 16 kHz mono, que es lo que el motor ya usa en post: Whisper acepta cualquier
 * cosa y la convierte por dentro, pero tarda cuatro veces más (medido en
 * `transcribe.js`).
 *
 * @param {object} params { sesion, desdeMs, hastaMs, margenSec }
 * @returns {{archivo:string, desdeSec:number}|null}
 */
function recorte(params) {
    const p = params || {};
    if (!p.sesion) return null;

    const margen = p.margenSec || 0;
    const desde = posicionDe(p.sesion, p.desdeMs);
    const hasta = posicionDe(p.sesion, p.hastaMs);
    if (desde == null || hasta == null || hasta <= desde) return null;

    const ini = Math.max(0, desde - margen);
    const dur = (hasta - ini) + margen;
    const destino = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'notetaker-vivo-')), 'toma.wav');

    // Las pasadas del vivo, acá; una toma entera para releer, con ffmpeg: diez
    // minutos filtrados en JavaScript pararían el proceso más que lanzarlo.
    const enLaApp = !p.conFfmpeg && dur <= RECORTE_EN_LA_APP_MAX_SEC;
    if (enLaApp && recorteEnLaApp(p.sesion.archivo, ini, dur, destino)) return { archivo: destino, desdeSec: ini };
    const ffmpeg = paths.ffmpeg();
    if (!ffmpeg.path) {
        tirar({ archivo: destino });
        return null;
    }

    const r = spawnSync(ffmpeg.path, [
        '-v', 'error', '-y',
        '-ss', String(ini),
        '-t', String(dur),
        '-i', p.sesion.archivo,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        destino
    ], { encoding: 'utf8' });

    if (r.status !== 0 || !fs.existsSync(destino)) {
        // Sin esto el ciclo en vivo se quedaba sin oír ese tramo y no lo decía
        // en ningún lado. De a uno cada treinta segundos: si falla, falla en
        // cada pasada.
        const ahora = Date.now();
        if (ahora - ultimoRecorteFallido > 30000) {
            ultimoRecorteFallido = ahora;
            registro.anotar('main', 'captura.recorte-falla', {
                estado: r.status, error: r.error ? r.error.message : String(r.stderr || '').slice(0, 300)
            });
        }
        tirar({ archivo: destino });
        return null;
    }
    // `desdeSec` es qué momento del archivo quedó en el segundo 0 del recorte:
    // sin eso, los tiempos que devuelve Whisper no se pueden llevar a la hora del
    // día y todo el reloj se cae.
    return { archivo: destino, desdeSec: ini };
}

let ultimoRecorteFallido = 0;

/**
 * El mismo recorte, hecho acá: 16 kHz mono, sin lanzar ffmpeg.
 *
 * El ciclo recorta una vez por segundo, y ffmpeg se lanzaba con `spawnSync`:
 * 53 ms de mediana con el proceso principal parado —el mismo que escribe el
 * audio— en cada pasada. Los WAV de la app son siempre los que escribe este
 * archivo (PCM de 16 bits, uno o dos canales, cabecera de 44 bytes), y a 48 kHz
 * bajar a 16 es quedarse con una muestra de cada tres después de un pasabajos.
 * Lo que no tenga esa forma, o una tasa que no sea múltiplo de 16 kHz, vuelve
 * a ffmpeg: contesta false y quien llama sigue por ahí.
 *
 * El filtro es un seno cardinal con ventana de Blackman, cortado en el 90 % de
 * la mitad de 16 kHz. Comparado con ffmpeg (`tools/banco-pasada.js --recorte`,
 * 40 ventanas de una clase de 141 min): la onda es la misma —correlación
 * 0,9999, y la de ffmpeg corrida 17 muestras, un milisegundo—, tarda 9 ms en vez
 * de 53, y Whisper lee lo mismo salvo puntuación y mayúsculas en 8 de 40.
 */
const SALIDA_HZ = 16000;
const RECORTE_EN_LA_APP_MAX_SEC = 20;
const filtros = new Map();

function filtroPara(factor) {
    if (filtros.has(factor)) return filtros.get(factor);
    const n = 24 * factor + 1;
    const medio = (n - 1) / 2;
    const corte = 0.45 / factor;
    const h = new Float64Array(n);
    let suma = 0;
    for (let i = 0; i < n; i++) {
        const x = i - medio;
        const sinc = x === 0 ? 2 * corte : Math.sin(2 * Math.PI * corte * x) / (Math.PI * x);
        const ventana = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
        h[i] = sinc * ventana;
        suma += h[i];
    }
    for (let i = 0; i < n; i++) h[i] /= suma;
    filtros.set(factor, h);
    return h;
}

function formaDe(fd) {
    const h = Buffer.alloc(44);
    if (fs.readSync(fd, h, 0, 44, 0) < 44) return null;
    if (h.toString('ascii', 0, 4) !== 'RIFF' || h.toString('ascii', 8, 12) !== 'WAVE') return null;
    if (h.toString('ascii', 12, 16) !== 'fmt ' || h.toString('ascii', 36, 40) !== 'data') return null;
    const formato = h.readUInt16LE(20);
    const canales = h.readUInt16LE(22);
    const tasa = h.readUInt32LE(24);
    const bits = h.readUInt16LE(34);
    if (formato !== 1 || bits !== 16 || canales < 1 || canales > 2) return null;
    if (tasa % SALIDA_HZ !== 0 || tasa / SALIDA_HZ > 6) return null;
    return { canales, tasa };
}

function recorteEnLaApp(archivo, iniSec, durSec, destino) {
    let fd;
    try {
        fd = fs.openSync(archivo, 'r');
        const forma = formaDe(fd);
        if (!forma) return false;
        const factor = forma.tasa / SALIDA_HZ;
        const h = filtroPara(factor);
        const medio = (h.length - 1) / 2;
        const porCuadro = forma.canales * 2;
        // Lo que hay escrito, por el tamaño y no por la cabecera: el archivo de
        // la clase en curso crece mientras se lee.
        const cuadros = Math.floor((fs.fstatSync(fd).size - 44) / porCuadro);
        const salen = Math.max(0, Math.round(durSec * SALIDA_HZ));
        const primero = Math.round(iniSec * forma.tasa) - medio;
        const largo = salen * factor + 2 * medio;
        const desde = Math.max(0, primero);
        const hasta = Math.min(cuadros, primero + largo);
        const crudo = Buffer.alloc(Math.max(0, hasta - desde) * porCuadro);
        if (crudo.length) fs.readSync(fd, crudo, 0, crudo.length, 44 + desde * porCuadro);
        // A mono y con ceros donde el archivo no llega, para que el filtro no
        // tenga que preguntar en cada muestra.
        const x = new Float64Array(largo);
        for (let i = desde; i < hasta; i++) {
            const o = (i - desde) * porCuadro;
            x[i - primero] = forma.canales === 2
                ? (crudo.readInt16LE(o) + crudo.readInt16LE(o + 2)) / 2
                : crudo.readInt16LE(o);
        }
        const salida = Buffer.alloc(salen * 2);
        for (let k = 0; k < salen; k++) {
            const base = k * factor;
            let y = 0;
            for (let j = 0; j < h.length; j++) y += h[j] * x[base + j];
            salida.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y))), k * 2);
        }
        fs.writeFileSync(destino, Buffer.concat([cabecera(salida.length, SALIDA_HZ, 1), salida]));
        return true;
    } catch (e) {
        return false;
    } finally {
        if (fd != null) fs.closeSync(fd);
    }
}

function tirar(recortado) {
    if (!recortado || !recortado.archivo) return;
    try {
        fs.rmSync(path.dirname(recortado.archivo), { recursive: true, force: true });
    } catch (e) { /* da igual */ }
}

module.exports = {
    cabecera,
    abrir,
    escribir,
    cerrar,
    cerrarTodo,
    posicionDe,
    laQueContiene,
    recorte,
    recorteEnLaApp,
    tirar
};
