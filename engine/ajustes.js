'use strict';
/**
 * ajustes.js — Las preferencias del editor, guardadas fuera de la carpeta.
 *
 * Viven en `~/Library/Application Support/Note Taker/ajustes.json` y no junto a
 * un curso: a cuántos cuadros va la secuencia y por qué entrada llega el audio
 * son decisiones de la máquina y del editor, no de la clase que se esté
 * grabando. Y no en el `localStorage` de la ventana, porque las herramientas de
 * línea de comandos (`tools/simular-grabacion.js`) tienen que escribir el XML
 * con EXACTAMENTE los mismos cuadros que la app: simular con otro fps sería
 * simular otro producto.
 *
 * La escritura es atómica (temporal + rename): un cierre a mitad de guardado no
 * puede dejar el JSON por la mitad.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Los cuadros por segundo que se pueden elegir.
 *
 * Son los de la secuencia a la que va el XML, no los del audio: un WAV no tiene
 * cuadros. El editor elige el de su timeline y con eso todos los marcadores
 * caen donde tienen que caer. Los tres NTSC llevan `ntsc TRUE` en el XML y de
 * eso se encarga `fcp-xml.rateFor`; acá solo se guarda el número.
 */
const FPS_POSIBLES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

/**
 * Cuántas carpetas se recuerdan.
 *
 * Seis, y el tope se aplica al SANEAR: quien agregue una séptima no tiene que
 * acordarse de recortar, y un archivo escrito a mano con cuarenta tampoco puede
 * llenar la pantalla. Caerse de la lista no pierde nada —la carpeta sigue en el
 * disco y el botón de siempre la vuelve a traer—, así que el costo de quedarse
 * corto es un viaje al selector y el de pasarse es una pantalla ilegible todos
 * los días.
 */
const RECIENTES = 6;

const DEFAULTS = {
    version: 1,
    /**
     * Dónde caen las sesiones. `carpeta` es la que está en uso —donde cae la
     * próxima— y `carpetas` todas las que se usaron alguna vez, la activa
     * primero. Una carpeta es un curso: la lista de sesiones se agrupa por ellas.
     */
    carpeta: null,
    carpetas: [],
    /** El nombre del curso, que es la primera mitad del nombre de la sesión. */
    curso: '',
    /** A cuántos cuadros va la secuencia del editor. */
    fps: 30,
    /**
     * En qué idioma habla la clase. Va a `whisper-cli -l`, y se fija en vez de
     * detectarse porque detectar cuesta una pasada y en una clase en vivo el
     * idioma no cambia a la mitad.
     */
    idioma: 'es',
    /**
     * La entrada de audio elegida la última vez, por su nombre y no por su id.
     *
     * El id que da `enumerateDevices` cambia entre arranques de la app, así que
     * guardarlo sería guardar algo que mañana no apunta a nada. El nombre
     * ("BlackHole 2ch") sobrevive a desenchufar y volver a enchufar, que es
     * exactamente lo que pasa con una interfaz de audio.
     */
    dispositivo: null,
    /** Si se abre la vista de cámara al entrar a una sesión. */
    camara: false,
    /**
     * La última configuración del menú de «Generar .prproj»: cuántas capturas y
     * qué capturas componen cada vista. Cada carpeta guarda la suya
     * (`prproj-carpeta.leerConfig`); esta es el punto de partida de una carpeta
     * que todavía no tiene ninguna.
     */
    prproj: null
};

/**
 * La configuración del .prproj con la forma de siempre, o null si no sirve.
 *
 * Acá solo se mira la forma: que las claves parezcan siglas de vista y que los
 * números sean capturas que existen. Qué significa cada cosa —el orden es el
 * apilado, una vista sin capturas vuelve a la 1— lo decide
 * `prproj-carpeta.normalizar`, que es quien la usa.
 *
 * Una vista puede estar guardada como lista pelada (la forma de las primeras
 * versiones, donde dos capturas siempre eran una anidación) o como objeto con
 * `capturas`, `unidas` y `siempre`. Las dos se dejan pasar con la forma nueva;
 * sin `siempre` escrito no se inventa la lista, y entonces `normalizar` pone la
 * de siempre: todas puestas en todas las tomas.
 */
function saneada(prproj) {
    if (!prproj || typeof prproj !== 'object') return null;
    const capturas = Math.max(1, Math.min(20, Math.floor(Number(prproj.capturas) || 1)));
    const vistas = {};
    for (const [vista, guardada] of Object.entries(prproj.vistas || {})) {
        const bruta = Array.isArray(guardada) ? { capturas: guardada } : guardada;
        if (!/^[A-Z0-9]{1,4}$/.test(vista) || !bruta || !Array.isArray(bruta.capturas)) continue;
        const suyas = bruta.capturas.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= capturas);
        vistas[vista] = { capturas: suyas, unidas: bruta.unidas !== false };
        if (Array.isArray(bruta.siempre)) {
            vistas[vista].siempre = suyas.filter(id => bruta.siempre.includes(id));
        }
    }
    return { capturas, vistas };
}

function archivo() {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Note Taker', 'ajustes.json');
}

/** Un objeto con TODAS las claves, venga lo que venga del disco. */
function sanear(crudo) {
    const c = crudo || {};
    const carpeta = (typeof c.carpeta === 'string' && c.carpeta) || null;
    // La activa siempre está en la lista y va primera: es el invariante que hace
    // que "elegir carpeta" sea guardar una sola clave, y que quitar una carpeta
    // de la lista no pueda dejar la activa afuera.
    const recordadas = (Array.isArray(c.carpetas) ? c.carpetas : [])
        .filter(d => typeof d === 'string' && d && d !== carpeta);
    return {
        version: DEFAULTS.version,
        carpeta,
        carpetas: (carpeta ? [carpeta] : [])
            .concat([...new Set(recordadas)])
            .slice(0, RECIENTES),
        curso: typeof c.curso === 'string' ? c.curso.trim() : '',
        // Un fps que no está en la lista no se puede escribir bien en el XML
        // —haría falta saber si lleva `ntsc`—, así que se cae al de fábrica en
        // vez de arrastrar un número que después nadie sabe de dónde salió.
        fps: FPS_POSIBLES.includes(Number(c.fps)) ? Number(c.fps) : DEFAULTS.fps,
        idioma: (typeof c.idioma === 'string' && /^[a-z]{2}$/.test(c.idioma))
            ? c.idioma : DEFAULTS.idioma,
        dispositivo: (typeof c.dispositivo === 'string' && c.dispositivo) || null,
        camara: Boolean(c.camara),
        prproj: saneada(c.prproj)
    };
}

function leer() {
    try {
        return sanear(JSON.parse(fs.readFileSync(archivo(), 'utf8')));
    } catch (err) {
        // Sin archivo o con un archivo roto se arranca con lo de fábrica: unos
        // ajustes ilegibles no pueden dejar sin grabar.
        return sanear(null);
    }
}

function guardar(datos) {
    const limpio = sanear(datos);
    const destino = archivo();
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const temporal = `${destino}.tmp-${process.pid}`;
    fs.writeFileSync(temporal, `${JSON.stringify(limpio, null, 2)}\n`);
    fs.renameSync(temporal, destino);
    return limpio;
}

/**
 * Anota que se usó una carpeta, primera de la lista y como la activa.
 *
 * Volver a una que ya estaba NO la duplica: la sube. La lista se ordena por lo
 * último que se usó y no por lo primero que se agregó, que es lo que hace que el
 * curso de esta semana esté siempre arriba y que el tope eche al que hace más
 * que nadie toca.
 *
 * Se relee de disco en vez de recibir la lista: entre que la ventana leyó y
 * escribe pudo guardar otra pantalla, y `guardar` sanea, así que el recorte al
 * tope pasa una sola vez y en un solo sitio.
 */
function recordarCarpeta(ruta) {
    if (typeof ruta !== 'string' || !ruta) return leer();
    const antes = leer();
    return guardar({ ...antes, carpeta: ruta, carpetas: antes.carpetas });
}

module.exports = {
    leer, guardar, recordarCarpeta,
    sanear, archivo, DEFAULTS, RECIENTES, FPS_POSIBLES
};
