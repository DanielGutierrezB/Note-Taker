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
     * En qué idioma habla la clase. Va a `whisper-cli -l`.
     *
     * Fijo y no `auto` porque una clase es de un idioma de punta a punta, y
     * detectar cuesta: medido contra el residente, 790 ms la pasada con el
     * idioma puesto y 1200 ms con `auto`, o sea 400 ms más de atraso para el
     * «3, 2, 1» en una pantalla donde el idioma no va a cambiar nunca.
     *
     * `auto` existe igual, para quien dé una clase en dos idiomas, y es lo de
     * fábrica del vídeo semanal (ver `semanal.idioma`): ahí el idioma SÍ cambia
     * a la mitad, que es justo lo que pasó la primera vez que alguien se grabó
     * explicando la semana en inglés con el español clavado.
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
    prproj: null,
    /**
     * En qué modo abre la app.
     *
     * `clase` es tomar notas de un rodaje en vivo y dejarle el XML al editor, o
     * sea todo lo que había hasta ahora. `semanal` es grabarse explicando lo que
     * se hizo en la semana y salir con un MP4 cortado: otra pantalla, otra
     * carpeta y ningún XML que nadie vaya a abrir.
     *
     * Es un ajuste y no un botón en la barra a propósito: una persona usa uno de
     * los dos y no los va alternando. El editor lo deja en `clase` y no vuelve a
     * verlo; en la empresa se pone en `semanal` el primer día.
     */
    modo: 'clase',
    /**
     * Lo del modo semanal, aparte de lo del modo de clase.
     *
     * La carpeta es otra a propósito: así la lista de clases del editor no se
     * llena de vídeos de la semana, y la carpeta de un curso no se llena de
     * MP4. Lo que se comparte son la cámara y el micrófono, que son de la
     * máquina y no del modo.
     *
     * Y el idioma es otro, y de fábrica `auto`: una clase es de un idioma, pero
     * una persona contando su semana se pasa al inglés a mitad de frase. Los
     * 400 ms que cuesta detectar se pagan acá y no allá, y acá no duelen: la
     * toma también se abre con Enter.
     */
    semanal: { carpeta: null, idioma: 'auto' }
};

/** Los dos modos. Cualquier otra cosa escrita en el archivo es `clase`. */
const MODOS = ['clase', 'semanal'];

/**
 * Un idioma que Whisper pueda recibir, o lo de fábrica.
 *
 * Dos letras es un código de idioma y `auto` es «detectalo vos». Lo que no sea
 * ni una cosa ni la otra se cae a lo de fábrica en vez de llegar a la línea de
 * comandos de `whisper-server`, que con un `-l` que no entiende no arranca — y
 * sin servidor no hay ni «3, 2, 1» ni transcript.
 */
function idiomaSano(valor, deFabrica) {
    return typeof valor === 'string' && (valor === 'auto' || /^[a-z]{2}$/.test(valor))
        ? valor : deFabrica;
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
        idioma: idiomaSano(c.idioma, DEFAULTS.idioma),
        dispositivo: (typeof c.dispositivo === 'string' && c.dispositivo) || null,
        // Lo que haya guardado que no sea un nombre —el `false` de la versión en
        // la que esto era un sí o un no— se lee como «ninguna».
        camara: (typeof c.camara === 'string' && c.camara) || null,
        prproj: saneada(c.prproj),
        // Un modo que no existe se lee como `clase`: es el que no graba vídeo ni
        // exporta nada, o sea el que menos sorprende a quien abra la app.
        modo: MODOS.includes(c.modo) ? c.modo : DEFAULTS.modo,
        semanal: {
            carpeta: (c.semanal && typeof c.semanal.carpeta === 'string' && c.semanal.carpeta) || null,
            idioma: idiomaSano(c.semanal && c.semanal.idioma, DEFAULTS.semanal.idioma)
        }
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

/**
 * Lo que había con un parche encima, entrando UN nivel.
 *
 * Cada pantalla guarda solo lo suyo, así que lo que llega es un pedazo: el fps,
 * o la carpeta, o el idioma. Pegado por arriba, un pedazo de `semanal` borraba
 * el resto de `semanal`: quien guardaba la carpeta del vídeo mandaba
 * `{semanal:{carpeta}}` y con eso se llevaba el idioma de al lado, porque el
 * objeto nuevo reemplazaba al viejo entero y `sanear` le ponía el de fábrica.
 *
 * Un nivel y no más: los ajustes son llanos salvo `semanal` y `prproj`, y
 * fusionar en profundidad haría imposible vaciar algo. Un `null` reemplaza —es
 * como se limpia un campo—, igual que un array: solo se fusionan dos objetos.
 */
function conParche(previos, parche) {
    const llano = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
    const salida = { ...previos };
    for (const [clave, valor] of Object.entries(parche || {})) {
        salida[clave] = llano(valor) && llano(previos && previos[clave])
            ? { ...previos[clave], ...valor }
            : valor;
    }
    return salida;
}

module.exports = {
    leer, guardar, recordarCarpeta, conParche,
    sanear, archivo, DEFAULTS, RECIENTES, FPS_POSIBLES, MODOS
};
