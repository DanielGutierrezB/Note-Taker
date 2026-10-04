'use strict';
/**
 * video-crudo.js — Los dos vídeos del modo semanal, escritos mientras entran.
 *
 * Hermano de `captura.js` y con el mismo reparto de trabajo: la ventana es la
 * única que puede abrir una cámara o una pantalla —`getUserMedia` y
 * `getDisplayMedia` viven en el navegador— y manda los pedazos para acá; este
 * archivo solo los pega al final del archivo, en orden, sin mirar lo que traen.
 *
 * **No se remuxea nada al cerrar.** Chromium entrega un MP4 fragmentado con
 * H.264 dentro, y pegar los pedazos tal como llegan da un archivo que ffmpeg
 * abre, busca y recorta al fotograma. Está medido: de nueve segundos grabados
 * así salieron 270 fotogramas a 29,97 constantes y un recorte exacto al
 * milisegundo pedido.
 *
 * **La hora del archivo es la de llamar a `start()`, no la de `onstart`.** Esto
 * importa más que nada de acá, porque es lo que alinea los tres relojes —el
 * audio, la cámara y la pantalla— y un error acá corre el corte entero. Medido
 * con un vídeo sintético que cambia de color cada segundo: el primer fotograma
 * cae a 43 ms de la llamada a `start()`, mientras que el aviso `onstart` llega
 * 294 ms tarde en un grabador y 339 ms en el otro. O sea que `onstart` no sirve
 * de reloj ni para uno solo, y mucho menos para cuadrar dos entre sí.
 *
 * Por eso `empezoMs` llega desde la ventana —que es quien llama a `start()`— y
 * no se toma acá: el viaje por el puente IPC es lo que se estaría midiendo.
 */

const fs = require('fs');
const path = require('path');

const workspace = require('./workspace');

/** Lo que puede grabar el modo semanal. Cada cual va a su archivo. */
const CUALES = ['camara', 'pantalla'];

/** La extensión según lo que la ventana haya podido grabar. */
const EXTENSIONES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

const abiertos = new Map();
let proximo = 0;

function extensionDe(tipo) {
    const base = String(tipo || '').split(';')[0].trim().toLowerCase();
    return EXTENSIONES[base] || 'mp4';
}

/**
 * Abre un archivo para uno de los dos vídeos.
 *
 * @param {object} params { dir, nombre, cual, tipo, empezoMs }
 * @returns {{id:number, cual:string, archivo:string, empezoMs:number}}
 */
function abrir(params) {
    const p = params || {};
    if (!p.dir) throw new Error('Falta la carpeta donde escribir el vídeo.');
    const cual = String(p.cual || '');
    if (!CUALES.includes(cual)) throw new Error(`No sé grabar «${cual}».`);
    workspace.ensureDir(p.dir);

    const id = ++proximo;
    const archivo = path.join(p.dir,
        `${workspace.safeName(p.nombre || 'video')}-${cual}.${extensionDe(p.tipo)}`);
    const fd = fs.openSync(archivo, 'w');

    const crudo = {
        id,
        cual,
        archivo,
        fd,
        tipo: String(p.tipo || 'video/mp4'),
        bytes: 0,
        trozos: 0,
        empezoMs: Number(p.empezoMs) || Date.now(),
        cerradoMs: null
    };
    abiertos.set(id, crudo);
    return { id, cual, archivo, empezoMs: crudo.empezoMs, tipo: crudo.tipo };
}

/**
 * Pega un pedazo al final.
 *
 * Los pedazos de `MediaRecorder` son del tamaño que él quiera —medidos: de 50 kB
 * a 400 kB— y tienen que quedar en el orden en que salieron, porque el primero
 * trae la cabecera del archivo y los demás no valen nada sin ella. Por eso se
 * escribe sincrónicamente y por posición, igual que el WAV: dos escrituras
 * sueltas a la vez dejarían el archivo entrelazado y no habría forma de saberlo
 * hasta intentar abrirlo.
 */
function escribir(id, trozo) {
    const c = abiertos.get(id);
    if (!c) throw new Error(`No hay vídeo ${id} abierto.`);
    const buf = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo.buffer || trozo);
    if (buf.length) {
        fs.writeSync(c.fd, buf, 0, buf.length, c.bytes);
        c.bytes += buf.length;
        c.trozos++;
    }
    return { bytes: c.bytes, trozos: c.trozos };
}

/** Cierra el archivo y devuelve con qué se quedó. */
function cerrar(id, cerradoMs) {
    const c = abiertos.get(id);
    if (!c) return null;
    try { fs.closeSync(c.fd); } catch (e) { /* ya estaba cerrado */ }
    c.cerradoMs = Number(cerradoMs) || Date.now();
    abiertos.delete(id);
    return resumen(c);
}

function resumen(c) {
    return {
        cual: c.cual,
        archivo: c.archivo,
        tipo: c.tipo,
        empezoMs: c.empezoMs,
        cerradoMs: c.cerradoMs,
        bytes: c.bytes,
        trozos: c.trozos,
        // Lo que durará en el disco según el reloj de pared. No es la duración
        // del archivo —eso lo dice ffprobe— pero sirve para saber si lo que se
        // grabó llega hasta donde termina la última toma.
        segundos: Math.round((c.cerradoMs - c.empezoMs) / 10) / 100
    };
}

/** Lo que esté abierto, cerrado. Es lo de salir de la app a mitad de camino. */
function cerrarTodo() {
    return [...abiertos.keys()].map(id => cerrar(id)).filter(Boolean);
}

/** Si lo que se grabó llega a cubrir ese momento del reloj de pared. */
function cubre(video, paredMs) {
    if (!video || video.empezoMs == null) return false;
    const ms = Number(paredMs);
    if (!(ms >= video.empezoMs)) return false;
    return video.cerradoMs == null || ms <= video.cerradoMs;
}

/** Dónde cae ese momento del reloj de pared dentro del archivo, en segundos. */
function posicionDe(video, paredMs) {
    if (!video || video.empezoMs == null) return null;
    return (Number(paredMs) - video.empezoMs) / 1000;
}

function de(videos, cual) {
    return (videos || []).find(v => v && v.cual === cual) || null;
}

module.exports = {
    CUALES,
    extensionDe,
    abrir,
    escribir,
    cerrar,
    cerrarTodo,
    cubre,
    posicionDe,
    de
};
