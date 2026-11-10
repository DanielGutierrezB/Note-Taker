'use strict';
/**
 * workspace.js — Dónde escribe Note Taker, que es en un solo lugar.
 *
 * Todo lo que produce una sesión cae en la carpeta que eligió el editor,
 * repartido en `xml/`. La forma de esa carpeta se decide acá y en ningún otro
 * archivo: la ruta la arman cuatro módulos y un `path.join` suelto en cualquiera
 * de ellos escribe donde nadie va a buscar.
 *
 * Se escribe siempre a un temporal y se renombra: si la app se cierra a mitad,
 * lo que queda en disco es lo de antes y no medio archivo que el editor
 * importaría sin sospechar nada. Eso importa más acá que en cualquier otra app:
 * lo que se está grabando no se puede repetir.
 */

const fs = require('fs');
const path = require('path');

/**
 * Cómo se reparte la carpeta que el editor eligió.
 *
 *   <la carpeta>/
 *     xml/
 *       Clase_de_React_2026-09-29_10-15-00.xml   lo que se importa en Premiere
 *       Audio/                                    el WAV de la sesión
 *       Datos/                                    el archivo con la hora del día
 *       Referencias/                              la foto del OUT de cada toma
 *
 * Lo único que el editor abre a mano es el XML, así que los XML quedan juntos y
 * a la vista y lo demás baja un piso.
 *
 * `Audio` va con mayúscula porque es como se llaman las carpetas de audio que el
 * editor abre todo el día, y `Datos` la sigue. Se llama `Datos` y no `Notas`
 * porque las notas SON el XML: esto es lo que la app se guarda para sí misma, y
 * el nombre tiene que decir "acá no hay nada que importar".
 *
 * `Referencias` es la excepción a eso: son las fotos que el editor sí abre —y
 * manda— y por eso tienen carpeta propia con su nombre en castellano, una
 * subcarpeta por clase, y no se mezclan con los datos de la app.
 */
const XML_DIR = 'xml';
const AUDIO_DIR = 'Audio';
const DATOS_DIR = 'Datos';
const REFERENCIAS_DIR = 'Referencias';

/**
 * Cómo termina el archivo con la hora del día, que es lo que hace visible a una
 * sesión: la lista se arma buscando este sufijo (`sesiones-grabadas.js`).
 */
const SUFIJO_SIDECAR = '_notas-en-vivo.json';

function xmlDir(base) {
    return path.join(base, XML_DIR);
}

function audioDir(base) {
    return path.join(xmlDir(base), AUDIO_DIR);
}

function datosDir(base) {
    return path.join(xmlDir(base), DATOS_DIR);
}

/**
 * Las carpetas donde puede haber sesiones, dada una que eligió la persona.
 *
 * La carpeta misma, que es donde escribe la app —un curso con muchas clases
 * compartiendo `xml/`—, y un piso más abajo, que es donde quedaron las
 * grabaciones de cuando cada una tenía su carpeta. Mirar el piso de abajo es lo
 * que hace que **lo que ya está en el disco no desaparezca de la app**: una
 * lista que no lo mirara las escondería sin borrarlas, que es la peor de las
 * dos cosas.
 *
 * Se mira cualquier subcarpeta y no solo las que se llaman `Grabación-...`:
 * renombrar una carpeta es lo primero que hace cualquiera, y no es razón para
 * que la app deje de verla. Lo que la hace una grabación es tener el archivo con
 * la hora del día adentro, no cómo se llame.
 */
function carpetasConSesiones(dir) {
    const sitios = [dir];
    let hijos = [];
    try {
        hijos = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return sitios; // una carpeta que no está no tiene subcarpetas
    }
    for (const h of hijos) {
        // `xml` es la de esta misma carpeta, ya contada: entrar dentro buscaría
        // `xml/xml/Datos`.
        if (!h.isDirectory() || h.name === XML_DIR) continue;
        sitios.push(path.join(dir, h.name));
    }
    return sitios;
}

/** Las fotos de referencia van en una subcarpeta por clase, con su nombre. */
function referenciasDir(base, nombre) {
    const dir = path.join(xmlDir(base), REFERENCIAS_DIR);
    return nombre == null ? dir : path.join(dir, nombre);
}

/**
 * Dónde van el XML y el archivo con la hora del día de una sesión.
 *
 * `nombre` llega limpio de quien lo arma (`safeName`) o tal cual del disco
 * cuando se está releyendo una sesión que ya existe. No se limpia acá a
 * propósito: sobre un nombre que salió de `readdir`, cambiarle un caracter
 * apuntaría a un archivo que no está.
 */
function archivosDeSesion(base, nombre) {
    return {
        xml: path.join(xmlDir(base), `${nombre}.xml`),
        json: path.join(datosDir(base), `${nombre}${SUFIJO_SIDECAR}`),
        referencias: referenciasDir(base, nombre)
    };
}

/**
 * De vuelta: a partir del archivo con la hora del día, dónde está el resto.
 *
 * Hace falta porque una sesión ya grabada se abre y se edita pasando ese archivo
 * y nada más (renombrar, borrar, regenerar, reanudar): del sidecar cuelga todo
 * lo demás.
 */
function sesionDelSidecar(json) {
    const dir = path.dirname(json);
    const nombre = path.basename(json, SUFIJO_SIDECAR);
    const enSuSitio = path.basename(dir) === DATOS_DIR
        && path.basename(path.dirname(dir)) === XML_DIR;
    const base = enSuSitio ? path.dirname(path.dirname(dir)) : dir;
    return {
        base,
        nombre,
        xml: enSuSitio
            ? path.join(xmlDir(base), `${nombre}.xml`)
            : path.join(base, `${nombre}.xml`),
        json,
        audio: audioDir(base),
        referencias: referenciasDir(base, nombre)
    };
}

/**
 * Si una ruta cae de verdad adentro de una carpeta.
 *
 * `safeName` ya deja los nombres sin barras y sin puntos al principio, así que
 * lo de acá no debería hacer falta nunca. Está igual, y se usa antes de cada
 * escritura y de cada borrado, porque el nombre de la sesión lo tipea el editor
 * y viaja por el puente: entre "no debería" y "no puede" hay un `path.resolve`,
 * y del otro lado hay archivos que se borran.
 *
 * Se compara resuelto y con el separador pegado: sin él, `/tmp/notas-viejas`
 * pasaría por estar adentro de `/tmp/notas`.
 */
function dentroDe(base, ruta) {
    const raiz = path.resolve(base);
    const donde = path.resolve(ruta);
    return donde === raiz || donde.startsWith(raiz + path.sep);
}

/** El nombre de la sesión va a ser un nombre de archivo: se limpia lo que no puede. */
function safeName(name) {
    return String(name == null ? '' : name)
        .replace(/[/\\:]/g, '-')
        .replace(/^\.+/, '')
        .trim() || 'sin-nombre';
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Escritura atómica: primero un temporal al lado (mismo volumen, para que el
 * rename sea instantáneo y no una copia), después el rename.
 *
 * Con `asegurar`, el temporal se asegura en el disco antes del rename. Sin eso,
 * un corte de luz justo después podía dejar el nombre apuntando a un archivo
 * que todavía no había bajado: vacío o a medias, en lugar del de antes. Cuesta
 * unos 5 ms para el archivo de notas de una clase de tres horas, así que se
 * pide para lo que no se puede rehacer y no para todo.
 *
 * Con `conservarAnterior`, el que había queda al lado como `.anterior`: es lo
 * que se lee si el nuevo resultara roto (`leerSidecar`).
 */
function writeAtomic(filePath, contents, opciones) {
    const o = opciones || {};
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeSync(fd, contents);
        if (o.asegurar) fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    if (o.conservarAnterior && fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, `${filePath}${ANTERIOR}`);
    }
    fs.renameSync(tmp, filePath);
    return filePath;
}

/** Cómo termina la copia del archivo de antes, que se guarda al reemplazarlo. */
const ANTERIOR = '.anterior';

function writeJson(filePath, value, opciones) {
    const sangria = opciones && opciones.compacto ? 0 : 2;
    return writeAtomic(filePath, JSON.stringify(value, null, sangria), opciones);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function canWrite(dir) {
    try {
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Huella del archivo de origen: con esto se decide si lo que se guardó sobre él
 * sigue valiendo. Si el WAV cambió de tamaño o de fecha, lo que se calculó ya no
 * describe este audio.
 */
function fingerprint(filePath) {
    try {
        const st = fs.statSync(filePath);
        return { path: filePath, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch (e) {
        return null;
    }
}

function sameFingerprint(a, b) {
    if (!a || !b) return false;
    return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

module.exports = {
    XML_DIR,
    AUDIO_DIR,
    DATOS_DIR,
    REFERENCIAS_DIR,
    SUFIJO_SIDECAR,
    xmlDir,
    audioDir,
    datosDir,
    carpetasConSesiones,
    referenciasDir,
    archivosDeSesion,
    sesionDelSidecar,
    dentroDe,
    safeName,
    ensureDir,
    ANTERIOR,
    writeAtomic,
    writeJson,
    readJson,
    canWrite,
    fingerprint,
    sameFingerprint
};
