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

const idiomas = require('./idiomas');

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
    /**
     * La forma del archivo. Sube cuando algo guardado tiene que leerse distinto
     * de como se escribió: en la 2, el `es` que era de fábrica pasa a `auto`
     * (ver `idioma` en `sanear`). Es una sola marca para todas las migraciones,
     * en vez de un campo por cada una que se queda en el archivo para siempre.
     */
    version: 2,
    /**
     * Dónde caen las sesiones. `carpeta` es la que está en uso —donde cae la
     * próxima— y `carpetas` todas las que se usaron alguna vez, la activa
     * primero. Una carpeta es un curso: la lista de sesiones se agrupa por ellas.
     */
    carpeta: null,
    carpetas: [],
    /** A cuántos cuadros va la secuencia del editor. */
    fps: 30,
    /**
     * En qué idioma habla la clase. Va a `whisper-cli -l`.
     *
     * **`auto`, y antes era `es`.** El motivo de que estuviera fijo era el
     * precio: detectar costaba 400 ms más por pasada —1200 contra 790— y una
     * clase es de un idioma de punta a punta, así que se pagaba todo el rato
     * por una pregunta cuya respuesta no cambiaba.
     *
     * Ese precio ya no se paga. `whisper-server` contesta qué idioma detectó
     * en TODAS las pasadas, también cuando se le pide uno puesto, así que
     * «Automático» pregunta de verdad una sola vez y después oye el que viene
     * oyendo —rápido— sin dejar de vigilar (ver `quePedir` en `idiomas.js`).
     *
     * Y lo que inclinó la balanza es lo que cuesta equivocarse. Con el idioma
     * equivocado Whisper no se queda corto: TRADUCE. Medido el 20/10 sobre dos
     * clases reales, audio en inglés pedido en español salió «¿Qué es el skill
     * prompt que se ha añadido?». Una clase entera traducida no se arregla
     * mirando; `auto` acertó en las 18 ventanas probadas.
     *
     * Entre español e inglés y nada más, por lo que explica `engine/idiomas.js`.
     * El portugués se elige a mano.
     */
    idioma: 'auto',
    /**
     * La entrada de audio elegida la última vez, por su nombre y no por su id.
     *
     * El id que da `enumerateDevices` cambia entre arranques de la app, así que
     * guardarlo sería guardar algo que mañana no apunta a nada. El nombre
     * ("BlackHole 2ch") sobrevive a desenchufar y volver a enchufar, que es
     * exactamente lo que pasa con una interfaz de audio.
     */
    dispositivo: null,
    /**
     * La cámara de la que sale la foto del OUT de cada toma, por su nombre.
     *
     * Se guarda el NOMBRE y no el `deviceId` por lo mismo que la entrada de
     * audio: el id lo inventa el navegador y cambia, y el nombre es lo que la
     * persona eligió —«OBS Virtual Camera»— y lo que va a volver a elegir.
     *
     * `null` es «ninguna», que es como la app funcionaba antes de que esto
     * existiera: sin cámara elegida no se saca ninguna foto y no cambia nada.
     */
    camara: null,
    /**
     * La última configuración del menú de «Generar .prproj»: cuántas capturas y
     * qué capturas componen cada vista. Cada carpeta guarda la suya
     * (`prproj-carpeta.leerConfig`); esta es el punto de partida de una carpeta
     * que todavía no tiene ninguna.
     */
    prproj: null
};

/**
 * Uno de los idiomas que la app oye, o lo de fábrica.
 *
 * La lista es corta a propósito y el porqué está en `engine/idiomas.js`: un
 * idioma de más no es una opción más, es una manera nueva de que una clase
 * salga traducida. Antes se aceptaba cualquier par de letras, y con eso un
 * «fr» escrito a mano en el archivo llegaba al `-l` de `whisper-server` —que
 * con un idioma que no entiende no arranca, y sin servidor no hay ni «3, 2, 1»
 * ni transcript.
 */
function idiomaSano(valor, deFabrica) {
    return idiomas.esElegible(valor) ? valor : deFabrica;
}

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

/**
 * Dónde viven los ajustes.
 *
 * `NT_AJUSTES` lo desvía a otro archivo, y existe por una sola razón: los
 * guiones de prueba (`--guion=` en `dev-shot.js`) usan una carpeta en `/tmp` y
 * los dispositivos falsos de Chromium, y eso no puede escribirse encima de la
 * configuración de quien trabaja con la app.
 *
 * Antes se arreglaba leyendo los ajustes al empezar y devolviéndolos en un
 * `finally`. Eso tapa el caso bueno y falla justo en el malo: un `kill` —o
 * cerrar la ventana, o que Electron no salga y haya que matarlo— se salta el
 * `finally` y deja el micrófono apuntando a `Fake Default Audio Input` y la
 * carpeta a un `/tmp` que ya no existe. Medido: pasó. Un archivo aparte no se
 * puede corromper porque no se toca.
 */
function archivo() {
    return process.env.NT_AJUSTES
        || path.join(os.homedir(), 'Library', 'Application Support', 'Note Taker', 'ajustes.json');
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
        // Acá vivía `curso`, el nombre que iba delante del de cada clase. Ya no:
        // el curso ES la carpeta, así que su nombre sale del de ella
        // (`nombre-de-sesion.cursoPorDefecto`) y no se guarda. Guardado era un
        // valor suelto que se escribía una vez y después mentía: quien elegía
        // otra carpeta seguía grabando clases con el nombre del curso anterior,
        // y el ajuste no se veía desde la pantalla donde eso pasaba.
        //
        // Como `sanear` rearma el objeto entero, el que ya esté en el disco se
        // cae solo al guardar, sin migración que escribir.

        // Un fps que no está en la lista no se puede escribir bien en el XML
        // —haría falta saber si lleva `ntsc`—, así que se cae al de fábrica en
        // vez de arrastrar un número que después nadie sabe de dónde salió.
        fps: FPS_POSIBLES.includes(Number(c.fps)) ? Number(c.fps) : DEFAULTS.fps,
        // Hasta la versión 2 el de fábrica era `es`, y todo el mundo lo tiene
        // escrito lo haya elegido o no, porque `guardar` escribe el archivo
        // entero. Ese pasa a `auto` una vez. Lo que alguien eligió distinto se
        // queda como está: un `pt` pasado a `auto` le traduciría la clase, que
        // `auto` oye solo español o inglés. Y un `es` elegido después de la 2
        // también se queda, porque para entonces el archivo dice 2.
        idioma: (Number(c.version) || 1) < 2 && c.idioma === 'es'
            ? 'auto'
            : idiomaSano(c.idioma, DEFAULTS.idioma),
        dispositivo: (typeof c.dispositivo === 'string' && c.dispositivo) || null,
        // Lo que haya guardado que no sea un nombre —el `false` de la versión en
        // la que esto era un sí o un no— se lee como «ninguna».
        camara: (typeof c.camara === 'string' && c.camara) || null,
        prproj: saneada(c.prproj)
    };
}

/**
 * Dónde quedó la copia de un archivo de ajustes que no se pudo leer, si hubo uno.
 *
 * Unos ajustes ilegibles se leen como los de fábrica —no pueden dejar sin
 * grabar—, y el próximo guardado escribe encima. Sin la copia, eso borraba en
 * silencio el fps, la carpeta y la cámara de quien usaba la app: la secuencia
 * seguía a 23,976 y los marcadores salían a 30.
 */
let rescatado = null;

function leer() {
    let texto;
    try {
        texto = fs.readFileSync(archivo(), 'utf8');
    } catch (err) {
        return sanear(null);
    }
    try {
        return sanear(JSON.parse(texto));
    } catch (err) {
        rescatar(texto);
        return sanear(null);
    }
}

/** Guarda aparte el archivo roto, una vez, antes de que nadie escriba encima. */
function rescatar(texto) {
    if (rescatado) return;
    const copia = `${archivo()}.ilegible-${Date.now()}`;
    try {
        fs.writeFileSync(copia, texto);
        rescatado = copia;
    } catch (e) {
        rescatado = null;
    }
}

/** Qué decirle a la persona si sus ajustes no se pudieron leer, o null. */
function aviso() {
    if (!rescatado) return null;
    return 'Los ajustes no se podían leer y volvieron a los de fábrica: revisá los cuadros '
        + `por segundo y la carpeta. El archivo de antes quedó en ${rescatado}.`;
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
    leer, guardar, recordarCarpeta, aviso, dondeViven: archivo,
    sanear, archivo, DEFAULTS, RECIENTES, FPS_POSIBLES
};
