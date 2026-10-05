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
 * `Video` es de los brutos del modo semanal: la cámara y la pantalla tal como
 * salieron de la grabación, sin cortar. Van al lado del audio porque son lo
 * mismo que el audio —material que se grabó y no se puede repetir— y van con
 * mayúscula por lo mismo que `Audio`. Lo que la persona se lleva es el MP4
 * cortado, que queda arriba, en la raíz de su carpeta; esto es de dónde salió.
 */
const VIDEO_DIR = 'Video';

/**
 * Cómo termina el archivo con la hora del día, que es lo que hace visible a una
 * sesión: la lista se arma buscando este sufijo (`sesiones-grabadas.js`).
 */
const SUFIJO_SIDECAR = '_notas-en-vivo.json';

/**
 * En el modo semanal, UNA CARPETA POR GRABACIÓN.
 *
 *   <la carpeta que eligió>/
 *     Grabación-2026-10-05_10-27-28/
 *       semana_2026-10-05_10-27-28.mp4     el vídeo, que es lo que se lleva
 *       xml/...                            de dónde salió: los brutos y los datos
 *     Grabación-2026-10-05_18-04-11/
 *       ...
 *
 * Y no todo junto en la carpeta elegida, que es como estaba. La diferencia es
 * quién se tiene que acordar: con una carpeta por grabación, mover, mandar o
 * borrar una es mover, mandar o borrar una carpeta; sin ella, hay que saber que
 * el vídeo está arriba, la cámara y la pantalla en `xml/Video`, el audio en
 * `xml/Audio` y la hora del día en `xml/Datos`, y juntar cinco archivos de
 * cuatro sitios sin olvidarse de ninguno.
 *
 * En el modo de clase NO: ahí la carpeta es un curso con muchas clases, el XML
 * de cada una se importa a mano desde `xml/`, y las fotos y el audio se
 * comparten entre todas. Partirlo por clase rompería justamente eso.
 *
 * La carpeta lleva la fecha y la hora del CERO de la grabación, el mismo
 * instante con el que se nombran los archivos de adentro (`nombre-de-sesion.sello`),
 * así que la carpeta y lo que contiene dicen siempre lo mismo.
 */
const CARPETA_GRABACION = 'Grabación';

/**
 * @param {string} casa la carpeta que eligió la persona
 * @param {string} sello la fecha y la hora, de `nombre-de-sesion.sello`
 */
function carpetaDeGrabacion(casa, sello) {
    return path.join(casa, `${CARPETA_GRABACION}-${sello}`);
}

/** Si una carpeta tiene la forma de las que hace el modo semanal. */
function esCarpetaDeGrabacion(nombre) {
    return String(nombre || '').startsWith(`${CARPETA_GRABACION}-`);
}

function xmlDir(base) {
    return path.join(base, XML_DIR);
}

function audioDir(base) {
    return path.join(xmlDir(base), AUDIO_DIR);
}

function datosDir(base) {
    return path.join(xmlDir(base), DATOS_DIR);
}

function videoDir(base) {
    return path.join(xmlDir(base), VIDEO_DIR);
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
 */
function writeAtomic(filePath, contents) {
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, filePath);
    return filePath;
}

function writeJson(filePath, value) {
    return writeAtomic(filePath, JSON.stringify(value, null, 2));
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
    VIDEO_DIR,
    SUFIJO_SIDECAR,
    CARPETA_GRABACION,
    carpetaDeGrabacion,
    esCarpetaDeGrabacion,
    xmlDir,
    audioDir,
    datosDir,
    videoDir,
    referenciasDir,
    archivosDeSesion,
    sesionDelSidecar,
    dentroDe,
    safeName,
    ensureDir,
    writeAtomic,
    writeJson,
    readJson,
    canWrite,
    fingerprint,
    sameFingerprint
};
