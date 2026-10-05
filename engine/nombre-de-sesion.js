'use strict';
/**
 * nombre-de-sesion.js — Cómo se llama el XML de una sesión.
 *
 *   01_el-curso_2026-09-29_10-15-00
 *   01_V2_el-curso_2026-09-29_14-40-00
 *
 * Están las dos mitades acá —armarlo y leerlo— porque son la misma convención y
 * viven en puntas opuestas de la app: lo escribe `grabacion.js` cuando arranca
 * una grabación y lo lee `sesiones-grabadas.js` al listar la carpeta. Con la
 * convención partida en dos archivos, cambiar el formato obliga a acordarse del
 * otro, y el que se olvida no falla: lee mal, que es peor.
 *
 * **El número de clase va primero.** Un curso son las clases 01, 02, 03… y ese
 * número es cómo se las nombra al hablar de ellas: «en la 04 expliqué los
 * hooks». La fecha ordena igual de bien, pero no se puede decir en voz alta ni
 * buscar en el Finder. Lo sugiere la app —el más alto que haya en la carpeta,
 * más uno— así que no hay cuenta que llevar, y se puede cambiar.
 *
 * **Y si el número se repite, la segunda es V2.** Volver a grabar la clase 01
 * pasa de verdad: se cortó el Zoom, se volvió a dar, se grabó dos veces el
 * mismo tema. Las dos son la 01, y lo que las distingue es cuál es la segunda
 * toma de esa clase. `01` no lleva `V1`: la gran mayoría de las clases se
 * graban una sola vez y un `V1` en todas sería ruido en todas para decir algo
 * de unas pocas.
 *
 * Es el mismo sitio del nombre donde antes iba un nombre libre que se escribía
 * a mano —«Clase 3 Física»— y que no se llegó a usar nunca. Dos cosas peleando
 * por el frente del nombre eran una de más: el número es lo que se pedía, y
 * ordena, que el texto libre no hacía.
 *
 * **La hora va en el reloj de la pared, no en UTC.** Es contra esa hora que el
 * editor empareja los archivos de cámara, que traen la hora local de su reloj
 * en su fecha de creación. El instante exacto igual queda guardado: el sidecar
 * de al lado lleva `ceroISO` (ver `notas-xml.sidecar`).
 *
 * **La hora es la de "Iniciar grabación"**, que es cuando arranca el WAV y el
 * cero del XML.
 */

const path = require('path');

const workspace = require('./workspace');

/**
 * Un nombre nuestro: el número de clase, el curso, la fecha y la hora.
 *
 * El número y la versión son opcionales porque las clases grabadas antes de que
 * existieran no los tienen, y tienen que seguir leyéndose: una sesión que no se
 * puede leer no se puede abrir ni renombrar ni regenerar.
 *
 * El curso va con `.*?` y no con algo más estrecho porque ahí puede haber
 * cualquier cosa, incluidos guiones bajos. La parte opcional de adelante pide
 * `\d{2,}_`, o sea dígitos seguidos de `_`: un curso que empiece con números
 * —`2609_Claude_Code` da `2609-claude-code`— no la activa, porque después de
 * los dígitos viene un guión y no un `_`. Y un curso que SEA un número (`01`)
 * tampoco se come la fecha: el motor retrocede cuando lo que queda detrás no
 * cuadra.
 */
const NOMBRE = /^(?:(\d{2,})_(?:V(\d+)_)?)?(.*?)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/;

/**
 * Desde qué vez se escribe la marca: la primera no lleva.
 *
 * **Se llama `vez` y no `version` a propósito.** El sidecar ya tiene un campo
 * `version`, que es la versión del FORMATO del archivo, y llamar igual a las dos
 * cosas puso las dos claves en el mismo objeto: la de clase pisaba la del
 * formato, así que una clase 01 dejaba el sidecar diciendo que era de la
 * versión 1 del formato en vez de la 2. Un sidecar que miente sobre su propio
 * formato se lee mal para siempre, y en silencio.
 *
 * `vez` además es lo que se dice: «la vez número 2 que se graba esa clase».
 */
const PRIMERA_VEZ = 1;

function dos(n) {
    return String(n).padStart(2, '0');
}

/**
 * El curso, como cabe en un nombre de archivo.
 *
 * Sale del nombre de la carpeta, así que puede traer cualquier cosa: espacios,
 * tildes, barras, emoji.
 */
function cursoEnElNombre(curso) {
    return workspace.safeName(curso || 'clase')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'clase';
}

/**
 * El curso de una carpeta: su nombre, y nada más.
 *
 * **Nadie lo escribe.** Antes había un campo para ponerle nombre al curso, en
 * Ajustes y al lado de la carpeta. Se fue: «el nombre del curso debe sí o sí ser
 * siempre el slug que es el nombre de la carpeta». Un nombre que se escribe
 * aparte es un nombre que se escribe UNA vez y después miente —quien cambiaba de
 * carpeta seguía grabando clases con el nombre del curso anterior—, mientras que
 * la carpeta se elige cada vez y se ve en la pantalla.
 *
 * Y está acá y no en cada pantalla porque es una decisión y no un formato.
 * Estaba tomada en tres sitios —la pantalla de la carpeta, la lista de
 * verificación y el motor al arrancar—, y tres copias querían decir que el
 * nombre que la pantalla mostraba de ejemplo podía dejar de ser el que la
 * grabación iba a escribir, que no se nota hasta que ya está en el disco.
 */
function cursoPorDefecto(dir) {
    return String(dir || '').split(path.sep).filter(Boolean).pop() || 'clase';
}

/**
 * El número de clase, como se escribe: `1` → `01`, `12` → `12`, `100` → `100`.
 *
 * Dos dígitos porque un curso tiene decenas de clases y no cientos, y porque
 * `01` ordena bien al lado de `02` y de `10`, que es justo lo que `1` y `2` y
 * `10` no hacen en ninguna lista de archivos. Pasados los 99 se escribe entero
 * en vez de truncarlo: un curso de 120 clases es raro, pero perderle el número
 * a la 100 por raro sería un error silencioso en el nombre de un archivo.
 *
 * @param {number|string} numero
 * @returns {string|null} null si no es un número de clase: no hay número, y el
 *   nombre queda como el de siempre en vez de llevar un `00` inventado.
 */
function numeroEnElNombre(numero) {
    if (numero == null || numero === '') return null;
    const n = Math.floor(Number(String(numero).trim()));
    if (!Number.isFinite(n) || n < 1) return null;
    return String(n).padStart(2, '0');
}

/**
 * La fecha y la hora, como se escriben en un nombre: `2026-10-05_10-27-28`.
 *
 * Está aparte porque lo usan dos cosas que TIENEN que coincidir: el nombre de
 * los archivos de la sesión y el de la carpeta que los contiene en el modo
 * semanal. Son el mismo instante —el cero de la grabación— y si se formatearan
 * en dos sitios podrían separarse por un segundo justo al cruzar el minuto, y
 * entonces la carpeta diría una hora y los archivos de adentro otra.
 *
 * Sin `Z` ni desfase: es la hora de esta máquina, que es la que la persona
 * reconoce. `leer` la vuelve a interpretar igual.
 */
function sello(cuandoMs) {
    const cuando = new Date(cuandoMs != null ? cuandoMs : Date.now());
    const fecha = `${cuando.getFullYear()}-${dos(cuando.getMonth() + 1)}-${dos(cuando.getDate())}`;
    const hora = `${dos(cuando.getHours())}-${dos(cuando.getMinutes())}-${dos(cuando.getSeconds())}`;
    return `${fecha}_${hora}`;
}

/**
 * @param {object} params { curso, cuandoMs, numero, vez }
 *   `numero` es la clase (1 → `01`) y va delante de todo; sin número, el nombre
 *   es el de siempre. `vez` solo se escribe desde la 2 (`V2`), y sin número no
 *   se escribe nunca: una vez es la segunda toma de UNA clase, así que sin clase
 *   que numerar no hay de qué ser la segunda.
 * @returns {string} el nombre, sin extensión
 */
function armar(params) {
    const p = params || {};
    const base = `${cursoEnElNombre(p.curso)}_${sello(p.cuandoMs)}`;
    const numero = numeroEnElNombre(p.numero);
    if (!numero) return base;
    const v = Math.floor(Number(p.vez) || PRIMERA_VEZ);
    return v > PRIMERA_VEZ ? `${numero}_V${v}_${base}` : `${numero}_${base}`;
}

/**
 * Lo que dice un nombre.
 *
 * `numero` vuelve como número y no como texto: es con lo que se compara para
 * saber cuál sigue, y `'01' + 1` no es 2. `vez` es siempre al menos 1, también
 * cuando el nombre no la dice, así que el que la lee no tiene que acordarse de
 * que la primera va implícita.
 *
 * @param {string} nombre con o sin ".xml"
 * @returns {{curso:string, cuandoMs:number, numero:number|null, vez:number}|null}
 */
function leer(nombre) {
    const limpio = String(nombre == null ? '' : nombre).replace(/\.xml$/i, '');
    const m = limpio.match(NOMBRE);
    if (!m) return null;
    const [, numero, vez, curso, y, mo, d, hh, mm, ss] = m;
    return {
        curso,
        numero: numero ? Number(numero) : null,
        vez: vez ? Number(vez) : PRIMERA_VEZ,
        // Sin `Z` ni desfase: se interpreta en la zona de esta máquina, que es
        // la misma en la que se escribió.
        cuandoMs: new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`).getTime()
    };
}

module.exports = {
    PRIMERA_VEZ, armar, sello, leer, cursoEnElNombre, cursoPorDefecto, numeroEnElNombre
};
