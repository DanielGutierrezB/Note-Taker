'use strict';
/**
 * reporte.js — El botón «Report»: un .zip en Descargas para arreglar un problema.
 *
 * Lo pidió el editor: que quien encuentre un fallo apriete un botón y mande un
 * archivo, sin tener que explicar ni buscar nada. El diario solo no alcanzaba:
 * el vídeo de la semana que salió con la voz robótica se pudo explicar recién
 * mirando el espectro del audio, el micrófono elegido y los relojes del WAV, y
 * nada de eso estaba en el diario. Así que el reporte junta:
 *
 *   · el diario entero, en texto y en crudo (`registro.js`);
 *   · el sistema: versiones, macOS, el modelo, el disco libre y los permisos;
 *   · los ajustes y las herramientas que encontró la app;
 *   · lo que ve la ventana: los micrófonos, las cámaras y la pantalla abierta;
 *   · las últimas grabaciones: el sidecar de cada una y la ficha de sus audios
 *     y vídeos (`ffprobe`: códec, tasa, canales, duración), sin los archivos;
 *   · los reportes de cuelgue que macOS haya guardado de la app.
 *
 * **Sin audio ni vídeo.** Pesan gigas y son de la clase. La ficha técnica de
 * cada archivo es lo que se mira primero, y si hace falta el archivo, se pide.
 *
 * **Un pedazo que falla no tumba el reporte.** Se apunta qué faltó y por qué en
 * el LEEME, y lo demás sale igual: el reporte es justamente para cuando algo
 * anda mal.
 *
 * No sabe de Electron: lo que solo sabe el proceso principal —las versiones, las
 * pantallas, los permisos— se lo pasa quien llama. Así se prueba entero con
 * `node tests/run.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const registro = require('./registro');
const workspace = require('./workspace');

/** Cuántas grabaciones van: la que falló suele ser la última, y las de antes sirven para comparar. */
const CUANTAS_GRABACIONES = 3;

/** Los cuelgues de macOS que van: los de las últimas dos semanas, y no más de cinco. */
const DIAS_DE_CUELGUES = 14;
const CUANTOS_CUELGUES = 5;

/** Lo que se espera a ffprobe por archivo. Un disco externo dormido tarda en contestar. */
const SONDEO_MS = 10000;

/** Hasta qué nivel se guardan los objetos del reporte: los ajustes tienen seis. */
const HONDO = 8;

const MEDIOS = new Set(['.wav', '.mp4', '.mov', '.m4a', '.webm', '.mp3']);

const pad = n => String(n).padStart(2, '0');

/**
 * Un archivo oculto no es una grabación. En un disco que no es de macOS —un
 * exFAT, que es como vienen los externos— cada archivo tiene al lado su
 * `._nombre` con los metadatos, y con el mismo final que el sidecar.
 */
const oculto = nombre => nombre.startsWith('.');

/** `NoteTaker-reporte-20261023-174201`: la fecha en el nombre, para que dos no se pisen. */
function nombreDelReporte(cuando) {
    const d = new Date(cuando || Date.now());
    return `NoteTaker-reporte-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
        + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Las grabaciones más nuevas de esas carpetas, de la más reciente para atrás.
 *
 * Se buscan los sidecars, que es de donde cuelga todo lo demás: en la carpeta
 * misma —un curso, donde están todas las clases— y en cada `Grabación-…` de
 * adentro, que es como guarda el vídeo de la semana.
 *
 * @param {string[]} carpetas
 * @param {number} [cuantas]
 * @returns {object[]} lo que devuelve `workspace.sesionDelSidecar`
 */
function ultimasGrabaciones(carpetas, cuantas) {
    const vistos = new Map();
    for (const carpeta of (carpetas || []).filter(Boolean)) {
        const bases = [carpeta];
        try {
            for (const n of fs.readdirSync(carpeta)) {
                if (workspace.esCarpetaDeGrabacion(n)) bases.push(path.join(carpeta, n));
            }
        } catch (e) {
            continue;
        }
        for (const base of bases) {
            let nombres = [];
            try { nombres = fs.readdirSync(workspace.datosDir(base)); } catch (e) { continue; }
            for (const n of nombres.filter(x => !oculto(x) && x.endsWith(workspace.SUFIJO_SIDECAR))) {
                const json = path.join(workspace.datosDir(base), n);
                try { vistos.set(json, fs.statSync(json).mtimeMs); } catch (e) { /* se fue mientras se miraba */ }
            }
        }
    }
    return [...vistos.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, cuantas || CUANTAS_GRABACIONES)
        .map(([json]) => workspace.sesionDelSidecar(json));
}

/**
 * Los audios y vídeos de una grabación: los de su carpeta de audio, los de la
 * de vídeo y el vídeo ya cortado, que va suelto en la carpeta. Solo los suyos:
 * en un curso la carpeta de audio tiene los WAV de todas las clases, y se
 * reconocen por llamarse como la sesión seguida de un guion o un punto. Por
 * prefijo a secas, la clase 1 se llevaba los audios de la 10, la 11 y la 12.
 */
function mediosDe(sesion) {
    const salida = [];
    for (const dir of [workspace.audioDir(sesion.base), workspace.videoDir(sesion.base), sesion.base]) {
        let nombres = [];
        try { nombres = fs.readdirSync(dir); } catch (e) { continue; }
        for (const n of nombres) {
            const suyo = n.startsWith(`${sesion.nombre}-`) || n.startsWith(`${sesion.nombre}.`);
            if (!oculto(n) && suyo && MEDIOS.has(path.extname(n).toLowerCase())) salida.push(path.join(dir, n));
        }
    }
    return salida;
}

/** La ficha de un archivo según ffprobe: sus pistas y su duración, y cuánto pesa. */
function sondear(ffprobe, archivo) {
    return new Promise(resolve => {
        let bytes = null;
        try { bytes = fs.statSync(archivo).size; } catch (e) { /* lo dice ffprobe */ }
        execFile(ffprobe, [
            '-v', 'error', '-of', 'json',
            '-show_entries', 'format=duration,bit_rate,format_name:stream=index,codec_type,codec_name,'
                + 'sample_rate,channels,width,height,r_frame_rate,avg_frame_rate,duration,start_time,bit_rate,nb_frames',
            archivo
        ], { timeout: SONDEO_MS, maxBuffer: 1 << 20 }, (err, stdout) => {
            const archivoCorto = path.basename(archivo);
            if (err) return resolve({ archivo: archivoCorto, bytes, error: err.message });
            try {
                resolve({ archivo: archivoCorto, bytes, ...JSON.parse(stdout) });
            } catch (e) {
                resolve({ archivo: archivoCorto, bytes, error: 'ffprobe no devolvió JSON' });
            }
        });
    });
}

/** Los reportes de cuelgue de macOS de esta app: los `.ips` con su nombre. */
function cuelguesDe(dir, nombres, ahora) {
    let archivos = [];
    try { archivos = fs.readdirSync(dir); } catch (e) { return []; }
    const desde = (ahora || Date.now()) - DIAS_DE_CUELGUES * 24 * 3600 * 1000;
    return archivos
        .filter(n => nombres.some(x => n.startsWith(x)) && /\.(ips|crash|diag)$/.test(n))
        .map(n => {
            const ruta = path.join(dir, n);
            try { return { ruta, mtimeMs: fs.statSync(ruta).mtimeMs }; } catch (e) { return null; }
        })
        .filter(x => x && x.mtimeMs >= desde)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, CUANTOS_CUELGUES)
        .map(x => x.ruta);
}

/** El .zip, con `ditto` como lo haría el Finder: se abre con un doble clic en cualquier Mac. */
function comprimir(carpeta, zip) {
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', carpeta, zip],
            { timeout: 60000 }, err => (err ? reject(err) : resolve(zip)));
    });
}

function leeme(nombre, cabecera, partes, faltan) {
    return [
        `# ${nombre}`,
        '',
        `Note Taker ${cabecera.version || '?'} · ${new Date().toString()}`,
        '',
        'Lo que hace falta para entender un problema de la app. Mandalo entero tal cual:',
        'no lleva audio ni vídeo, ni la clave de Anthropic, y las rutas van sin el nombre',
        'de usuario. Sí lleva el texto de las últimas grabaciones (en sus sidecars), que',
        'es con lo que se ve qué pasó con cada toma.',
        '',
        '## Qué hay',
        '',
        ...partes.map(p => `- \`${p.archivo}\` — ${p.que}`),
        '',
        ...(faltan.length ? ['## Qué no se pudo juntar', '', ...faltan.map(f => `- ${f}`), ''] : [])
    ].join('\n');
}

/**
 * Arma el reporte y lo deja en `dir`.
 *
 * @param {object} p
 * @param {string} p.dir dónde dejar el .zip: Descargas
 * @param {object} p.cabecera versión y plataforma, para el diario en texto
 * @param {object} [p.sistema] lo que sabe el proceso principal de la Mac
 * @param {object} [p.ajustes] los ajustes tal como están
 * @param {object} [p.herramientas] lo que encontró la app y lo que le falta
 * @param {object} [p.ventana] lo que ve la ventana
 * @param {object} [p.grabando] el resumen de la grabación en curso, si hay una
 * @param {string[]} [p.carpetas] dónde buscar las últimas grabaciones
 * @param {string} [p.ffprobe] la ruta de ffprobe; sin ella, sin fichas
 * @param {string} [p.cuelgues] la carpeta de reportes de cuelgue de macOS
 * @param {string[]} [p.nombresDeLaApp] cómo se llaman sus cuelgues
 * @returns {Promise<{ok: boolean, archivo?: string, partes?: string[], faltan?: string[], error?: string}>}
 */
async function armar(p) {
    const nombre = nombreDelReporte();
    let trabajo = null;
    try {
        trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-reporte-'));
        const raiz = path.join(trabajo, nombre);
        fs.mkdirSync(raiz);
        const partes = [];
        const faltan = [];

        // Cada pedazo se arma y se escribe por su cuenta: si uno falla, se dice
        // en el LEEME y los demás salen igual.
        const poner = (archivo, que, armarlo) => {
            try {
                const contenido = armarlo();
                const destino = path.join(raiz, archivo);
                fs.mkdirSync(path.dirname(destino), { recursive: true });
                fs.writeFileSync(destino, typeof contenido === 'string' ? contenido : `${JSON.stringify(contenido, null, 2)}\n`);
                partes.push({ archivo, que });
            } catch (e) {
                faltan.push(`${archivo}: ${e.message}`);
            }
        };
        // Lo que se copia de afuera —un sidecar, un cuelgue de macOS— trae rutas
        // enteras con el nombre de usuario: viaja como texto, con la carpeta de
        // usuario cambiada por `~`, que es lo que promete el LEEME.
        const copiar = (origen, archivo, que) => poner(archivo, que, () => sinCasa(fs.readFileSync(origen, 'utf8')));

        // El diario primero, con lo pendiente ya en disco: lo último que pasó es
        // lo que se venía a mirar. Ya está saneado: se sanea al anotar.
        const lineas = (() => {
            registro.volcar();
            const guardadas = registro.leerDelDisco();
            return guardadas.length ? guardadas : registro.todo();
        })();
        poner('diario.md', 'el diario de todas las corridas, para leer', () => registro.texto(p.cabecera || {}, lineas));
        poner('diario.ndjson', 'el mismo diario, una línea JSON por evento',
            () => `${lineas.map(l => JSON.stringify(l)).join('\n')}\n`);

        poner('sistema.json', 'la Mac, las versiones y los permisos', () => registro.sanear(p.sistema || {}, 0, HONDO));
        poner('ajustes.json', 'los ajustes de la app, sin secretos', () => registro.sanear(p.ajustes || {}, 0, HONDO));
        poner('herramientas.json', 'qué herramientas y modelos encontró la app', () => registro.sanear(p.herramientas || {}, 0, HONDO));
        poner('ventana.json', 'lo que ve la ventana: pantalla, micrófonos y cámaras', () => registro.sanear(p.ventana || {}, 0, HONDO));
        if (p.grabando) poner('grabando.json', 'la grabación que estaba en curso', () => registro.sanear(p.grabando));

        let sesiones = [];
        try { sesiones = ultimasGrabaciones(p.carpetas); } catch (e) { faltan.push(`las grabaciones: ${e.message}`); }
        for (const sesion of sesiones) {
            const dir = `grabaciones/${sesion.nombre}`;
            copiar(sesion.json, `${dir}/${path.basename(sesion.json)}`, 'el sidecar: tomas, relojes y texto');
            if (!p.ffprobe) continue;
            const fichas = [];
            for (const m of mediosDe(sesion)) fichas.push(await sondear(p.ffprobe, m));
            poner(`${dir}/medios.json`, 'la ficha de cada audio y vídeo (ffprobe)', () => registro.sanear(fichas, 0, HONDO));
        }

        for (const c of cuelguesDe(p.cuelgues, p.nombresDeLaApp || [], Date.now())) {
            copiar(c, `cuelgues/${path.basename(c)}`, 'un reporte de cuelgue de macOS');
        }

        poner('LEEME.md', 'qué es cada cosa', () => leeme(nombre, p.cabecera || {}, partes, faltan));

        const zip = path.join(p.dir, `${nombre}.zip`);
        fs.mkdirSync(p.dir, { recursive: true });
        await comprimir(raiz, zip);
        return { ok: true, archivo: zip, partes: partes.map(x => x.archivo), faltan };
    } catch (e) {
        return { ok: false, error: `No pude armar el reporte: ${e.message}` };
    } finally {
        if (trabajo) fs.rmSync(trabajo, { recursive: true, force: true });
    }
}

/** Un texto con la carpeta de usuario cambiada por `~`. */
function sinCasa(texto) {
    const casa = os.homedir();
    return casa && casa.length > 3 ? texto.split(casa).join('~') : texto;
}

module.exports = {
    CUANTAS_GRABACIONES,
    armar, nombreDelReporte, ultimasGrabaciones, mediosDe, sondear, cuelguesDe
};
