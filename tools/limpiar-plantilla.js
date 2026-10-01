#!/usr/bin/env node
'use strict';
/**
 * tools/limpiar-plantilla.js — Convierte un proyecto de Premiere cualquiera en
 * una plantilla que se puede empaquetar: con los ejemplares de los que se clona,
 * y sin nada del curso con el que se armó.
 *
 *   node tools/limpiar-plantilla.js ~/Movies/Render/PRUEBA-D-efecto.prproj /tmp/Plantilla.prproj
 *
 * La plantilla hay que sacarla de un proyecto real porque los ejemplares los
 * escribe Premiere y no se pueden inventar (ver `prproj-moldes.js`). Pero un
 * proyecto real trae además la clase con la que se armó, y eso no puede viajar
 * en el instalador: las rutas del material de un curso ajeno, los nombres de los
 * archivos y —lo que más pesa— la transcripción de lo que se dijo en esa clase,
 * que son 1,4 de los 1,8 MB del proyecto del que salió esta.
 *
 * Nada de eso llega al `.prproj` que genera la app, porque el Taller descuelga y
 * poda la plantilla entera (`podarLaPlantilla`). El problema es el otro archivo:
 * la plantilla misma, que sí se instala en cada Mac.
 *
 * Lo que queda adentro después de esto son las piezas y sus medidas: las
 * secuencias, los cortes, los clips maestros y los medios, apuntando a rutas que
 * no existen en ninguna máquina. Que no existan está bien: de los medios se
 * copia la forma, y la ruta la escribe el generador con el WAV de cada clase.
 */

const fs = require('fs');
const path = require('path');

const prproj = require('../engine/prproj');
const { quitarDeLista } = require('../engine/prproj-secuencia');

/** Dónde dicen vivir los medios de la plantilla. No existe, y no hace falta. */
const CARPETA = '/Users/Shared/Note Taker/Plantilla';

/**
 * Saca la transcripción de la clase con la que se armó la plantilla.
 *
 * Son dos objetos por medio: el `TranscriptClip`, que cuelga de la lista de
 * clips del clip maestro, y el documento con el texto en base64. Se quita
 * primero la entrada de la lista —si no, `guardar` se niega, que es justo lo que
 * tiene que hacer con una referencia que no lleva a ningún lado— y recién
 * después se borran los objetos.
 *
 * Un clip maestro sin transcripción es una forma que Premiere escribe todo el
 * tiempo: la tiene cualquier archivo recién importado al que nadie le pasó el
 * reconocimiento de voz.
 */
function sacarTranscripciones(p) {
    let fuera = 0;
    for (const k of p.porClase('TranscriptClip')) {
        for (const quien of p.quienReferencia(k)) {
            quitarDeLista(p, quien, 'Clips', 'Clip', [k]);
        }
        p.borrar(k);
        fuera++;
    }
    for (const k of p.porClase('ExternallyProvidedTranscriptDocument')) {
        if (!p.quienReferencia(k).length) { p.borrar(k); fuera++; }
    }
    return fuera;
}

/**
 * Las rutas absolutas que hay en el archivo, de la más larga a la más corta.
 *
 * De la más larga primero porque se reemplazan como texto y unas contienen a
 * otras: la carpeta de un proyecto reciente es el prefijo de la ruta del
 * proyecto, y reemplazarla antes dejaría la otra a medio cambiar.
 */
function rutasDe(texto) {
    const rutas = new Set(texto.match(/\/(?:Users|Volumes)\/[^<>"]*/g) || []);
    return [...rutas].sort((a, b) => b.length - a.length);
}

/** `video-1.mp4`, `audio-3.wav`: el tipo se adivina por la extensión y ya. */
function nombreNeutro(ruta, n) {
    const ext = path.extname(ruta);
    const tipo = /\.(mp4|mov|mxf|avi)$/i.test(ext) ? 'video'
        : /\.(wav|aif|aiff|mp3|m4a)$/i.test(ext) ? 'audio'
            : 'archivo';
    return `${tipo}-${n}${ext}`;
}

/**
 * Cambia cada ruta y cada nombre de archivo por uno neutro, en todo el texto.
 *
 * Se trabaja sobre el texto entero y no objeto por objeto porque las rutas
 * aparecen en sitios muy distintos —el medio, su archivo de picos, los ajustes
 * de exportación, la lista de proyectos recientes— y no hay una lista de dónde
 * puede haber una. Lo que sí se sabe es cómo se ve una.
 *
 * Después de las rutas van los nombres sueltos: el clip maestro y el ítem del
 * panel se llaman como el archivo, pero sin la carpeta. Los nombres van en una
 * vuelta aparte y después de todas las rutas, y no mezclados: el nombre de un
 * medio está adentro de la ruta de su archivo de picos, así que cambiarlo antes
 * deja esa ruta medio cambiada y ya sin forma de reconocerla entera.
 */
function neutralizar(texto) {
    const rutas = rutasDe(texto);
    const deRuta = [];
    const deNombre = new Map();
    const yaNombrados = new Map();
    let n = 0;

    for (const ruta of rutas) {
        const base = path.basename(ruta);
        // El archivo de picos de un medio se llama como el medio más un sufijo,
        // así que comparte su número: que el par se siga viendo como un par.
        const hermano = [...yaNombrados.keys()].find(b => base.startsWith(b));
        const nuevo = hermano
            ? base.replace(hermano, path.parse(yaNombrados.get(hermano)).name)
            : nombreNeutro(ruta, ++n);
        if (!hermano) yaNombrados.set(base, nuevo);
        deRuta.push([ruta, `${CARPETA}/${nuevo}`]);
        if (base !== nuevo) {
            deNombre.set(base, nuevo);
            const stem = path.parse(base).name;
            if (stem && stem !== base) deNombre.set(stem, path.parse(nuevo).name);
        }
    }

    // Los nombres también de más largo a más corto, y por lo mismo: el nombre
    // sin extensión es prefijo del nombre con extensión.
    const nombres = [...deNombre.entries()].sort((a, b) => b[0].length - a[0].length);
    let salida = texto;
    for (const [viejo, nuevo] of deRuta.concat(nombres)) salida = salida.split(viejo).join(nuevo);
    // El proyecto se llama como el archivo del que salió, y eso también se ve.
    salida = salida.replace(/<Name>[^<]*\.prproj<\/Name>/g, '<Name>Plantilla.prproj</Name>');
    return { texto: salida, rutas: rutas.length };
}

function main() {
    const origen = process.argv[2];
    const destino = process.argv[3];
    if (!origen || !destino || !fs.existsSync(origen)) {
        console.log('Uso: node tools/limpiar-plantilla.js <origen.prproj> <salida.prproj>');
        process.exit(1);
    }

    const p = prproj.Proyecto.leer(origen);
    const antes = Buffer.byteLength(p.texto(), 'utf8');
    const fuera = sacarTranscripciones(p);
    const { texto, rutas } = neutralizar(p.texto());

    const limpio = new prproj.Proyecto(texto);
    const r = limpio.guardar(destino);

    const quedan = rutasDe(limpio.texto()).filter(x => !x.startsWith(CARPETA));
    console.log(`De ${origen}`);
    console.log(`  ${fuera} objeto(s) de transcripción fuera`);
    console.log(`  ${rutas} ruta(s) cambiadas por ${CARPETA}/`);
    console.log(`  ${Math.round(antes / 1024)} KB de XML → ${Math.round(r.bytesXml / 1024)} KB`);
    if (quedan.length) {
        console.log(`  ! quedaron rutas sin cambiar:\n    ${quedan.slice(0, 5).join('\n    ')}`);
        process.exit(1);
    }
    console.log(`  → ${destino}`);
}

if (require.main === module) main();

module.exports = { CARPETA, sacarTranscripciones, neutralizar, rutasDe };
