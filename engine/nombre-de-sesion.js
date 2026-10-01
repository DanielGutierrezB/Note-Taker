'use strict';
/**
 * nombre-de-sesion.js — Cómo se llama el XML de una sesión.
 *
 *   el-curso_2026-09-29_10-15-00
 *
 * Están las dos mitades acá —armarlo y leerlo— porque son la misma convención y
 * viven en puntas opuestas de la app: lo escribe `grabacion.js` cuando arranca
 * una grabación y lo lee `sesiones-grabadas.js` al listar la carpeta. Con la
 * convención partida en dos archivos, cambiar el formato obliga a acordarse del
 * otro, y el que se olvida no falla: lee mal, que es peor.
 *
 * **Sin número de clase.** Acá una sesión es una clase en vivo entera y de
 * corrido, así que no hay nada que numerar: lo que la identifica es cuándo
 * empezó. Numerarlas obligaría a llevar la cuenta —y a preguntarle al editor un
 * número mientras el profesor espera— para no ganar nada, porque el orden ya lo
 * da la fecha.
 *
 * **La hora va en el reloj de la pared, no en UTC.** Es contra esa hora que el
 * editor empareja los archivos de cámara, que traen la hora local de su reloj
 * en su fecha de creación. El instante exacto igual queda guardado: el sidecar
 * de al lado lleva `ceroISO` (ver `notas-xml.sidecar`).
 *
 * **La hora es la de "Iniciar grabación"**, que es cuando arranca el WAV y el
 * cero del XML.
 */

const workspace = require('./workspace');

/** Un nombre nuestro: el curso, la fecha y la hora. */
const NOMBRE = /^(.*?)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/;

function dos(n) {
    return String(n).padStart(2, '0');
}

/**
 * El curso, como cabe en un nombre de archivo.
 *
 * Sale de lo que el editor escribió o del nombre de la carpeta, así que puede
 * traer cualquier cosa: espacios, tildes, barras.
 */
function cursoEnElNombre(curso) {
    return workspace.safeName(curso || 'clase')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'clase';
}

/**
 * El nombre que el editor le pone delante a una sesión, como cabe en un archivo.
 *
 * **Se respeta como se escribió**, al revés que el curso: el curso se vuelve
 * `curso-jev` porque es la parte que la app arma sola y tiene que ordenarse igual
 * en todas las clases, pero esto lo escribió una persona para reconocer la clase
 * de un vistazo —«Clase 3 Física»— y pasarlo a minúsculas con guiones le borraría
 * justo eso. Solo se saca lo que un nombre de archivo no aguanta.
 */
function prefijoEnElNombre(prefijo) {
    return String(prefijo == null ? '' : prefijo)
        .replace(/[/\\:]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s._]+|[\s_]+$/g, '');
}

/**
 * @param {object} params { curso, cuandoMs, prefijo } — `prefijo` va delante
 *   del nombre de siempre, separado por `_`; vacío, el nombre es el de siempre
 * @returns {string} el nombre, sin extensión
 */
function armar(params) {
    const p = params || {};
    const cuando = new Date(p.cuandoMs != null ? p.cuandoMs : Date.now());
    const fecha = `${cuando.getFullYear()}-${dos(cuando.getMonth() + 1)}-${dos(cuando.getDate())}`;
    const hora = `${dos(cuando.getHours())}-${dos(cuando.getMinutes())}-${dos(cuando.getSeconds())}`;
    const base = `${cursoEnElNombre(p.curso)}_${fecha}_${hora}`;
    const prefijo = prefijoEnElNombre(p.prefijo);
    return prefijo ? `${prefijo}_${base}` : base;
}

/**
 * Lo que dice un nombre.
 *
 * @param {string} nombre con o sin ".xml"
 * @returns {{curso:string, cuandoMs:number}|null}
 */
function leer(nombre) {
    const limpio = String(nombre == null ? '' : nombre).replace(/\.xml$/i, '');
    const m = limpio.match(NOMBRE);
    if (!m) return null;
    const [, curso, y, mo, d, hh, mm, ss] = m;
    return {
        curso,
        // Sin `Z` ni desfase: se interpreta en la zona de esta máquina, que es
        // la misma en la que se escribió.
        cuandoMs: new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`).getTime()
    };
}

module.exports = { armar, leer, cursoEnElNombre, prefijoEnElNombre };
