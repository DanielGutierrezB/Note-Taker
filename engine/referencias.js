'use strict';
/**
 * referencias.js — La foto de la pantalla en el instante del OUT.
 *
 * Lo que el editor pidió, dicho por él: «cada toma pueda tener de referencia una
 * imagen del OUT. Esto lo usan los CDs cuando graban para ver cómo estaba la
 * pantalla del profesor cuando pararon en la toma anterior». Sale de la cámara
 * que esté elegida en Ajustes —la señal del Rodecaster entrando por USB, o un
 * NDI puesto en una cámara virtual—, la saca la ventana (`src/js/grabar/ojo.js`,
 * que es donde vive el vídeo) y este archivo solo la pone en el disco.
 *
 * **No va al XML.** Es una ayuda para la persona que graba, no material para
 * Premiere: el XML tiene que seguir siendo exactamente el mismo con o sin
 * cámara elegida, así que acá no se toca ni el sidecar ni las notas. La foto de
 * la toma 3 es `xml/Referencias/<clase>/toma-3.jpg` y se encuentra por su
 * nombre, sin ningún índice que pueda quedar desfasado del disco.
 *
 * **Una foto por toma, la del momento en que se puso el OUT.** No se vuelve a
 * sacar: si después el editor corre el OUT, la foto sigue siendo la del momento
 * en que la clase paró, que es lo que se estaba guardando. Por eso `guardar` no
 * pisa una que ya esté.
 */

const fs = require('fs');
const path = require('path');

const workspace = require('./workspace');

/** JPEG y no PNG: es una foto de vídeo, y pesa diez veces menos. */
const EXT = '.jpg';

/** Lo más grande que se acepta de la ventana, por si algo manda cualquier cosa. */
const TOPE_BYTES = 8 * 1024 * 1024;

/** El nombre del archivo de una toma, dentro de la carpeta de su clase. */
function nombreDeToma(toma) {
    const n = Number(toma);
    if (!Number.isInteger(n) || n < 1) throw new Error('Esa no es una toma.');
    return `toma-${n}${EXT}`;
}

/**
 * Dónde va la foto de una toma.
 *
 * El nombre de la clase se limpia como en todas partes (`safeName`) y además se
 * comprueba que la ruta caiga de verdad adentro de la carpeta: el nombre viaja
 * por el puente desde la ventana, y del otro lado hay un `writeFile`.
 */
function archivoDeToma(carpeta, secuencia, toma) {
    if (!carpeta) throw new Error('Falta la carpeta del curso.');
    const dir = workspace.referenciasDir(carpeta, workspace.safeName(secuencia));
    const ruta = path.join(dir, nombreDeToma(toma));
    if (!workspace.dentroDe(carpeta, ruta)) throw new Error('Esa foto cae fuera de la carpeta.');
    return ruta;
}

/**
 * Guarda la foto de una toma, si no tenía.
 *
 * @param {object} p { carpeta, secuencia, toma, bytes }
 * @returns {{ruta: string, toma: number, nueva: boolean}}
 */
function guardar(p) {
    const o = p || {};
    const ruta = archivoDeToma(o.carpeta, o.secuencia, o.toma);
    const bytes = Buffer.isBuffer(o.bytes) ? o.bytes : Buffer.from(o.bytes || []);
    if (!bytes.length) throw new Error('La foto llegó vacía.');
    if (bytes.length > TOPE_BYTES) throw new Error('Esa foto pesa demasiado para ser un fotograma.');

    if (fs.existsSync(ruta)) return { ruta, toma: Number(o.toma), nueva: false };
    workspace.ensureDir(path.dirname(ruta));
    // Atómica como todo lo que esta app escribe: a mitad de una clase, media
    // foto en el disco sería una miniatura rota en el bloque de la toma.
    workspace.writeAtomic(ruta, bytes);
    return { ruta, toma: Number(o.toma), nueva: true };
}

/**
 * Las fotos que tiene una clase, por número de toma.
 *
 * Se lee el disco y no una lista guardada: las fotos las borra cualquiera desde
 * el Finder, y una lista diría que están.
 *
 * @returns {{toma: number, ruta: string}[]}
 */
function listar(carpeta, secuencia) {
    if (!carpeta) return [];
    const dir = workspace.referenciasDir(carpeta, workspace.safeName(secuencia));
    let nombres;
    try {
        nombres = fs.readdirSync(dir);
    } catch (e) {
        return [];
    }
    return nombres
        .map(n => ({ n, m: /^toma-(\d+)\.jpg$/i.exec(n) }))
        .filter(x => x.m)
        .map(x => ({ toma: Number(x.m[1]), ruta: path.join(dir, x.n) }))
        .sort((a, b) => a.toma - b.toma);
}

/** Si una ruta es una de estas fotos: lo que se mira antes de abrirla o copiarla. */
function esDeAca(ruta) {
    if (!ruta || path.extname(ruta).toLowerCase() !== EXT) return false;
    const abuela = path.basename(path.dirname(path.dirname(ruta)));
    return abuela === workspace.REFERENCIAS_DIR && /^toma-\d+\.jpg$/i.test(path.basename(ruta));
}

/**
 * Las fotos se van con su clase cuando la clase se renombra.
 *
 * Es la carpeta entera la que se mueve, con el nombre nuevo. Si ya hubiera una
 * con ese nombre no se toca nada: renombrar se está negando igual más arriba
 * (`sesiones-grabadas.renombrar`) cuando el destino existe.
 *
 * @returns {number} cuántas fotos quedaron en el sitio nuevo
 */
function mover(carpeta, deNombre, aNombre) {
    const de = workspace.referenciasDir(carpeta, workspace.safeName(deNombre));
    const a = workspace.referenciasDir(carpeta, workspace.safeName(aNombre));
    if (de === a || !fs.existsSync(de) || fs.existsSync(a)) return 0;
    if (!workspace.dentroDe(carpeta, a)) throw new Error('Ese nombre se sale de la carpeta.');
    workspace.ensureDir(path.dirname(a));
    fs.renameSync(de, a);
    return listar(carpeta, aNombre).length;
}

/**
 * Y se van con la clase cuando la clase se borra.
 *
 * @returns {number} cuántas se borraron
 */
function borrar(carpeta, secuencia) {
    const dir = workspace.referenciasDir(carpeta, workspace.safeName(secuencia));
    if (!workspace.dentroDe(carpeta, dir)) return 0;
    const cuantas = listar(carpeta, secuencia).length;
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        return 0;
    }
    return cuantas;
}

module.exports = {
    EXT,
    TOPE_BYTES,
    nombreDeToma,
    archivoDeToma,
    guardar,
    listar,
    esDeAca,
    mover,
    borrar
};
