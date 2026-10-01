'use strict';
/**
 * prproj-carpeta.js — El proyecto de Premiere de una carpeta entera.
 *
 * El editor, con las clases ya grabadas: un botón que le arme el proyecto con
 * las capturas listas para sincronizar y cada clase ya precortada. Lo que pidió,
 * dicho por él:
 *
 *   · «agregar capturas» —Capture 1, Capture 2, Capture 3— y que cada una sea
 *     una anidación con el marcador de todas las claquetas;
 *   · que todas las capturas tengan dentro el audio del XML, completo y sin
 *     cortar, para sincronizar ahí;
 *   · que las capturas después de la primera lleven la anidación de la Captura 1
 *     en A1, para sincronizarse contra ese audio desde donde esté;
 *   · elegir qué capturas componen cada vista, incluso si una vista es la unión
 *     de dos, para que la herramienta sepa qué activar y qué anidar;
 *   · y en la secuencia ya cortada, A1 el audio de la Captura 1 y A2 el audio de
 *     referencia de las notas.
 *
 * **Por qué precortar SOBRE anidaciones.** Las capturas se sueltan y se
 * sincronizan una vez, adentro de su anidación, y todos los cortes de todas las
 * clases son ventanas a esa misma línea de tiempo. Es la misma idea que los
 * nidos de Class Cut (`prproj-nidos.js`), con la diferencia de que acá las
 * anidaciones se entregan vacías de vídeo: Note Taker no tiene las cámaras,
 * tiene el audio y los cortes.
 *
 * Está partido en dos mitades a propósito. `planear` es pura: decide franjas,
 * qué fuente le toca a cada toma y dónde cae cada corte y cada marcador, y se
 * prueba sin plantilla. `generar` traduce ese plan a llamadas del `Taller`, que
 * es lo que sabe del formato.
 */

const fs = require('fs');
const path = require('path');

const prproj = require('./prproj');
const { Taller, loQueFalta } = require('./prproj-secuencia');
const nidos = require('./prproj-nidos');
const vivo = require('./notas-vivo');
const notasXml = require('./notas-xml');
const ajustar = require('./ajustar-corte');
const sesionesGrabadas = require('./sesiones-grabadas');
const workspace = require('./workspace');

/** Los bins del panel, numerados para que Premiere los ordene así. */
const BIN_CAPTURAS = '01 Capturas';
const BIN_PRECORTADAS = '02 Precortadas';
const BIN_AUDIO = '03 Audio de referencia';

/**
 * Y los que el proyecto deja vacíos, que son del editor.
 *
 * Los tres primeros los llena esta app; estos tres son donde va lo que llega
 * después —el material que manda el profesor, las composiciones, los gráficos
 * y las pistas— y existen desde el principio para que el proyecto se vea igual
 * en todos los cursos y nadie tenga que acordarse de crearlos ni de cómo se
 * llamaban. Premiere guarda un bin vacío sin lista de ítems, así que no cuesta
 * nada tenerlos.
 */
const BINS_DEL_EDITOR = ['04 Material', '05 Comps', '06 Assets'];

/** El audio de referencia, en el panel y en la línea de tiempo. */
const ETIQUETA_DE_REFERENCIA = 'Caribbean';

/**
 * Un color por anidación, para poder leer la precortada de un vistazo.
 *
 * Cada anidación —cada captura y cada vista compuesta— se pinta de un color, y
 * sus clips llevan ese mismo color donde aparezcan: en su pista de la
 * precortada, adentro de otra anidación y en la fila del panel. Así una franja
 * de color dice qué se está viendo sin leer el nombre del clip.
 *
 * **Son cuatro y no ocho porque son los que se pueden pintar enteros.** Un
 * color de Premiere va dos veces en el archivo —el nombre y el entero cacheado
 * al lado— y de la paleta solo hay cinco enteros medidos (ver `ETIQUETAS` en
 * `prproj-moldes.js`); el quinto, el caribe, es el del audio de referencia, que
 * ya significa otra cosa. Con más de cuatro anidaciones los colores se repiten:
 * repetir el quinto es menos malo que inventar un número y que el clip salga de
 * un color en el panel y de otro en la línea de tiempo.
 */
const COLORES_DE_ANIDACION = ['Cerulean', 'Rose', 'Iris', 'Forest'];

/** Blanco, el de las claquetas en el XML (`notas-xml.BLANCO`). */
const COLOR_DE_CLAQUETA = notasXml.BLANCO;

/** Turquesa, el de las notas sobre el texto en el XML (`notas-xml.TURQUESA`). */
const COLOR_DE_NOTA = notasXml.TURQUESA;

/** El nombre de una captura sola. */
function nombreDeCaptura(id) {
    return `Captura ${id}`;
}

/**
 * Una fuente es una captura sola o un grupo; su clave son los ids con `+`.
 *
 * **Los ids van de abajo hacia arriba, como las pistas de Premiere**, y el
 * orden es parte de la clave: `1+2` y `2+1` son dos grupos distintos —la misma
 * pareja apilada al revés— y una carpeta puede necesitar los dos: la cámara en
 * recuadro sobre la pantalla en una vista, y al revés en otra.
 */
function claveDeFuente(ids) {
    return ids.join('+');
}

/** «Captura 2 sobre Captura 1» para `[1, 2]`: se nombra desde la que tapa. */
function nombreDeFuente(ids) {
    return ids.slice().reverse().map(nombreDeCaptura).join(' sobre ');
}

/**
 * La anidación de una vista compuesta se llama como la vista: `PV`, `R`, `X2`.
 *
 * No como su composición. En la precortada, el clip de esa pista lleva el
 * nombre de la anidación, y lo que hace falta leer ahí es qué plano es, no de
 * qué capturas está hecho: eso se decide una vez en el menú y después estorba.
 * La composición sigue nombrada en los avisos, que es donde importa.
 *
 * Dos vistas pueden compartir una anidación —la misma pareja apilada igual— y
 * entonces lleva los dos nombres: es una sola secuencia y esconder que la
 * comparten haría que tocar el encuadre de una cambiara la otra sin avisar.
 */
function nombreDeAnidacion(vistas) {
    const orden = vivo.VISTAS.map(v => v.nombre);
    return vistas.slice()
        .sort((a, b) => {
            const ia = orden.indexOf(a);
            const ib = orden.indexOf(b);
            return (ia === -1 ? orden.length : ia) - (ib === -1 ? orden.length : ib) || (a < b ? -1 : 1);
        })
        .join(' y ');
}

// ─── La configuración ────────────────────────────────────────────────

/**
 * La configuración del menú, puesta en regla.
 *
 * Por defecto hay una sola captura y todas las vistas van a ella, que es el
 * caso de una clase grabada con una cámara. Lo que no cuadra se corrige en vez
 * de rechazarse: una vista que nombra una captura que se quitó, o que quedó sin
 * ninguna, vuelve a la Captura 1, que siempre está.
 *
 * **El orden de cada vista se respeta tal cual viene**, porque es el apilado:
 * van de abajo hacia arriba, así que la última es la que tapa. Ordenar por
 * número, que es lo que hacía antes, perdía en silencio justo lo que el menú
 * deja elegir.
 *
 * @param {object} [config] { capturas: 2, vistas: { R: { capturas: [1, 2], unidas: true, siempre: [1, 2] } } }
 * @param {string[]} [vistasUsadas] las vistas que aparecen en las tomas
 * @returns {{capturas: number, vistas: object}}
 */
function normalizar(config, vistasUsadas) {
    const c = config || {};
    const capturas = Math.max(1, Math.min(20, Math.floor(Number(c.capturas) || 1)));
    const vistas = {};
    const todas = new Set(vivo.VISTAS.map(v => v.nombre).concat(vistasUsadas || []));
    for (const vista of todas) {
        vistas[vista] = vistaSaneada(c.vistas && c.vistas[vista], capturas);
    }
    return { capturas, vistas };
}

/**
 * Una vista: qué capturas la componen, apiladas de abajo hacia arriba, si van
 * anidadas y cuáles se quedan puestas en todas las tomas.
 *
 * **Anidadas o sueltas es la diferencia entre un encuadre y doce.** Anidadas,
 * las dos capturas viven adentro de una secuencia aparte y el recuadro se
 * acomoda una vez para toda la carpeta. Sueltas, cada una va en su propia pista
 * de la precortada y se puede mover toma por toma, que es lo que hace falta
 * cuando el recuadro tapa algo distinto en cada una.
 *
 * **`siempre` es qué hace esa captura en las tomas de las OTRAS vistas.** Las
 * que están ahí ocupan su pista en todas las tomas de la clase, apagadas donde
 * no les toca: cambiar de plano es encender el clip que ya está, que es como
 * trabaja Class Cut. Las que no están entran solo en las tomas de su vista y en
 * las demás su pista queda vacía, que es una línea de tiempo más limpia a cambio
 * de tener que arrastrar para cambiar de plano. Por defecto están todas, que es
 * lo que hacía la app antes de que esto se pudiera elegir.
 *
 * Una anidación es un solo clip en una sola pista, así que ahí es todo o nada:
 * `siempre` se redondea a las capturas enteras del grupo o a ninguna.
 *
 * Acepta la forma vieja —una lista pelada— porque es la que hay guardada en las
 * carpetas de antes y en los ajustes, y ahí dos capturas siempre eran una
 * anidación.
 */
function vistaSaneada(pedida, capturas) {
    const bruta = Array.isArray(pedida) ? { capturas: pedida } : (pedida || {});
    const pedidas = Array.isArray(bruta.capturas) ? bruta.capturas : [];
    const ids = [...new Set(pedidas.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= capturas))];
    const limpias = ids.length ? ids : [1];
    const unidas = limpias.length > 1 && bruta.unidas !== false;
    const puestas = Array.isArray(bruta.siempre)
        ? limpias.filter(id => bruta.siempre.includes(id))
        : limpias.slice();
    return {
        capturas: limpias,
        unidas,
        siempre: unidas ? (puestas.length ? limpias.slice() : []) : puestas
    };
}

/** Dónde guarda cada carpeta su configuración del menú. */
function archivoDeConfig(carpeta) {
    return path.join(workspace.datosDir(carpeta), 'prproj.json');
}

/**
 * La configuración del menú para esta carpeta, con lo que el menú necesita para
 * dibujarse.
 *
 * Primero la que la carpeta tiene guardada; si no tiene, la última que se usó en
 * cualquier carpeta (`ultima`, de los ajustes), que suele ser la misma cámara y
 * la misma pantalla; y si tampoco, una sola captura con todo adentro.
 *
 * @param {string} carpeta
 * @param {object} [ultima] la que quedó en los ajustes
 * @param {string} [enCurso] la secuencia que se está grabando, que no cuenta
 * @returns {{config, vistas: {nombre, titulo, usada}[], clases: number, guardada: boolean}}
 */
function leerConfig(carpeta, ultima, enCurso) {
    let guardada = null;
    try {
        guardada = JSON.parse(fs.readFileSync(archivoDeConfig(carpeta), 'utf8'));
    } catch (e) {
        // Sin archivo, o roto: se arranca de la última o de fábrica.
    }
    const sesiones = carpeta ? sesionesGrabadas.listar([carpeta], enCurso) : [];
    const usadas = vistasUsadas(sesiones);
    const config = normalizar(guardada || ultima, usadas);
    return {
        config,
        vistas: vivo.VISTAS.map(v => ({
            nombre: v.nombre, titulo: v.titulo, colorDeMarcador: v.colorDeMarcador, usada: usadas.includes(v.nombre)
        })),
        clases: sesiones.length,
        guardada: Boolean(guardada)
    };
}

/** La guarda en la carpeta, puesta en regla. Devuelve la que quedó. */
function guardarConfig(carpeta, config) {
    const limpia = normalizar(config);
    const destino = archivoDeConfig(carpeta);
    workspace.ensureDir(path.dirname(destino));
    workspace.writeJson(destino, limpia);
    return limpia;
}

/** Las vistas que se usan en las tomas que van al XML, en el orden de `VISTAS`. */
function vistasUsadas(sesiones) {
    const usadas = new Set();
    for (const s of sesiones || []) {
        for (const toma of vivo.tomasQueQuedan(s)) {
            usadas.add(vivo.vistaLeida(toma.vista) || vivo.VISTA_POR_DEFECTO);
        }
    }
    const orden = vivo.VISTAS.map(v => v.nombre);
    return [...usadas].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
}

// ─── El plan ─────────────────────────────────────────────────────────

/** Los WAV de una sesión, con la ruta donde están HOY. */
function wavsDe(sesion) {
    const sitio = sesion.archivos && sesion.archivos.json
        ? workspace.sesionDelSidecar(sesion.archivos.json)
        : null;
    return (sesion.sesiones || [])
        .filter(w => w && w.archivo && w.segundos > 0)
        .map(w => ({
            ...w,
            ruta: sitio ? sesionesGrabadas.dondeQuedoElWav(sitio, w.archivo) : w.archivo
        }));
}

/**
 * Cuánto dura una clase adentro de una anidación: lo que llega más lejos entre
 * el audio, las tomas y las claquetas. El audio casi siempre manda; las otras
 * dos son por si un WAV no está, que la franja no se achique hasta pisar la
 * siguiente.
 */
function largoDe(sesion, wavs) {
    const cero = sesion.ceroMs;
    let fin = 0;
    for (const w of wavs) fin = Math.max(fin, notasXml.aSegundos(w.desdeMs, cero) + w.segundos);
    for (const t of sesion.tomas || []) {
        if (t.outMs != null) fin = Math.max(fin, notasXml.aSegundos(t.outMs, cero));
    }
    for (const c of sesion.claquetas || []) {
        if (c.ms != null) fin = Math.max(fin, notasXml.aSegundos(c.ms, cero));
    }
    return fin;
}

/** El WAV que tiene sonando el instante `ms`, o null. */
function wavQueContiene(wavs, ms) {
    return wavs.find(w => ms >= w.desdeMs && ms < w.desdeMs + w.segundos * 1000) || null;
}

/**
 * Un marcador del XML dicho como los nombra este módulo.
 *
 * Los dos formatos llevan lo mismo —nombre, comentario, desde, hasta y el
 * entero de color de Premiere— con otros nombres de campo, así que el juego de
 * marcadores de una sesión se arma UNA vez, en `notas-xml.js`, y acá se
 * traduce. Un marcador de punto llega sin `endSec` y en este formato dura cero.
 */
function deXml(m) {
    return {
        nombre: m.name,
        comentario: m.comment,
        desdeSeg: m.startSec,
        hastaSeg: m.endSec == null ? m.startSec : m.endSec,
        color: m.color
    };
}

/**
 * Todo lo que va al proyecto, sin tocar todavía el formato.
 *
 * **Las clases van por hora de inicio, no por nombre.** Class Cut ordena por
 * nombre de archivo, y acá un nombre puede llevar delante lo que el editor
 * escribió al renombrar («Clase 3…»), que lo sacaría de su lugar.
 *
 * **Las fuentes de la precortada son las que las tomas usan**, en el mismo orden
 * para todas las clases: primero las capturas solas, de la 1 en adelante, y
 * después los grupos. Así el V1 de una clase es el V1 de todas.
 *
 * @param {object[]} sesiones lo que devuelve `sesiones-grabadas.listar`
 * @param {object} config lo que devuelve `normalizar`
 */
function planear(sesiones, config) {
    const avisos = [];
    const ordenadas = (sesiones || [])
        .filter(s => s && s.ceroMs != null)
        .slice()
        .sort((a, b) => a.ceroMs - b.ceroMs);

    const clases = [];
    let reloj = 0;
    for (const sesion of ordenadas) {
        const wavs = wavsDe(sesion);
        const faltan = wavs.filter(w => !fs.existsSync(w.ruta));
        for (const w of faltan) {
            avisos.push(`${sesion.secuencia}: no encontré el audio «${path.basename(w.ruta)}»; esa clase entra sin él.`);
        }
        if (!sesion.terminada) {
            avisos.push(`${sesion.secuencia} quedó sin terminar: entra con lo que tenía guardado.`);
        }
        const largoSeg = largoDe(sesion, wavs);
        // Lo que lleva cada WAV encima: los mismos marcadores que el XML le pone
        // al clip maestro, medidos desde el arranque del archivo. Es el juego
        // completo de la sesión —tomas, claquetas y notas— porque un WAV de dos
        // horas es lo único que el editor tiene para ubicarse mientras
        // sincroniza, y ahí no hay pistas de colores que mirar.
        const marcas = notasXml.marcadores(sesion);
        for (const w of wavs) {
            w.marcadores = notasXml.marcadoresDelClip(marcas, w, sesion.ceroMs).map(deXml);
        }
        clases.push({
            sesion,
            nombre: sesion.secuencia,
            wavs: wavs.filter(w => fs.existsSync(w.ruta)),
            franja: { desdeSeg: reloj, largoSeg }
        });
        reloj += largoSeg + nidos.AIRE_SEG;
    }
    const largoSeg = clases.length ? Math.max(0, reloj - nidos.AIRE_SEG) : 0;

    // Dónde cae un instante de una clase adentro de las anidaciones.
    const enNido = (clase, ms) => clase.franja.desdeSeg + notasXml.aSegundos(ms, clase.sesion.ceroMs);

    // Las fuentes que alguna toma usa. Una vista anidada enciende una sola —su
    // grupo—; una suelta enciende una por captura, y se apilan por el orden de
    // las pistas, que es lo que `ordenarFuentes` tiene que dejar bien.
    //
    // `siempre` viaja con la fuente, no con la vista, porque es una propiedad de
    // la pista: ahí se decide si en las tomas de las demás vistas hay un clip
    // apagado o no hay nada. Se anota también quién pidió qué, para poder
    // decirlo cuando dos vistas comparten una fuente y no piden lo mismo.
    const usadas = new Map();
    const quienPide = new Map();
    const anotar = (ids, vista, siempre) => {
        const clave = claveDeFuente(ids);
        if (!usadas.has(clave)) {
            usadas.set(clave, { clave, ids, nombre: nombreDeFuente(ids), siempre: false });
            quienPide.set(clave, { siempre: new Set(), suya: new Set() });
        }
        if (siempre) usadas.get(clave).siempre = true;
        quienPide.get(clave)[siempre ? 'siempre' : 'suya'].add(vista);
        return clave;
    };
    const fuentesDe = vista => {
        const v = config.vistas[vista] || { capturas: [1], unidas: false, siempre: [1] };
        const puestas = v.siempre || [];
        return v.unidas && v.capturas.length > 1
            ? [anotar(v.capturas, vista, puestas.length > 0)]
            : v.capturas.map(id => anotar([id], vista, puestas.includes(id)));
    };

    for (const clase of clases) {
        let cursor = 0;
        clase.cortes = [];
        clase.marcadores = [];
        const tomas = vivo.tomasQueQuedan(clase.sesion).slice().sort((a, b) => a.inMs - b.inMs);
        for (const toma of tomas) {
            const vista = vivo.vistaLeida(toma.vista) || vivo.VISTA_POR_DEFECTO;
            const inMs = ajustar.inAjustado(toma);
            const outMs = ajustar.outAjustado(toma);
            const largo = (outMs - inMs) / 1000;
            if (!(largo > 0)) continue;

            const wav = wavQueContiene(clase.wavs, inMs);
            let referencia = null;
            if (wav) {
                const entradaSeg = (inMs - wav.desdeMs) / 1000;
                // Una toma que cruza al WAV siguiente —la sesión se reanudó a mitad
                // de toma— corta su referencia donde termina el archivo: más allá
                // de ese WAV no hay audio que poner en A2.
                const cabe = Math.min(largo, wav.segundos - entradaSeg);
                if (cabe < largo - 0.05) {
                    avisos.push(`${clase.nombre}: la toma ${toma.id} cruza de un audio a otro; su referencia en A2 llega hasta donde termina el primero.`);
                }
                referencia = { ruta: wav.ruta, entradaSeg, largoSeg: cabe };
            }

            clase.cortes.push({
                toma: toma.id,
                vista,
                fuentes: fuentesDe(vista),
                desdeSeg: cursor,
                hastaSeg: cursor + largo,
                entradaSeg: enNido(clase, inMs),
                referencia
            });

            // **Solo las tomas que tienen algo escrito llevan marcador, y dura
            // lo que dura la toma.** En la precortada el plano ya se ve —es la
            // pista que quedó encendida, con el color de su anidación— así que
            // un marcador por toma diciendo «Toma 4 · PV» era repetir en una
            // tira de colores lo que ya dice la línea de tiempo, y tapaba los
            // pocos que sí traen algo que leer. El que queda abarca el bloque
            // entero porque la nota es de la toma entera, no de su principio.
            // En el XML siguen estando todos: ahí no hay pistas que mirar.
            if (vivo.limpio(toma.comentario)) {
                clase.marcadores.push({
                    nombre: `${notasXml.nombreDeToma(toma)} · ${vista}`,
                    comentario: vivo.comentarioDeEntrada(toma),
                    desdeSeg: cursor,
                    hastaSeg: cursor + largo,
                    color: notasXml.colorDeVista(vista)
                });
            }
            // Las notas sobre un pedazo del texto, en el sitio de la precortada
            // donde quedó ese pedazo. Las que caen fuera de la toma —un borde que
            // se corrió después de escribirlas— se quedan afuera: en la precortada
            // ese audio no está.
            for (const c of toma.comentarios || []) {
                if (c.desdeMs == null) continue;
                if (c.desdeMs < inMs || c.desdeMs >= outMs) continue;
                const desde = cursor + (c.desdeMs - inMs) / 1000;
                const hasta = c.hastaMs != null ? cursor + (Math.min(c.hastaMs, outMs) - inMs) / 1000 : desde;
                clase.marcadores.push({
                    nombre: 'Nota',
                    comentario: vivo.limpio(c.comentario),
                    desdeSeg: desde,
                    hastaSeg: Math.max(desde, hasta),
                    color: COLOR_DE_NOTA
                });
            }
            cursor += largo;
        }
        clase.duracionSeg = cursor;
        if (!clase.cortes.length) avisos.push(`${clase.nombre} no tiene tomas que vayan al XML: no lleva precortada.`);
    }

    // **En las anidaciones van las claquetas y nada más.**
    //
    // Son tres sitios con tres trabajos, y mezclarlos los arruina a los tres:
    //
    //   · El **audio de referencia** lleva todos los marcadores de la sesión,
    //     sin cortar y en la hora en que se dijeron: es el archivo, y ahí está
    //     todo lo que se oyó. Viajan con él adonde se lo ponga.
    //   · Las **anidaciones** llevan solo las claquetas, que es lo único que se
    //     usa acá adentro: alinear el material de esa cámara contra la palmada.
    //     Puestas las tomas y las notas, la regla quedaba tapada de banderitas
    //     justo donde hay que ver la onda.
    //   · La **precortada** lleva los marcadores cortados y estirados sobre el
    //     bloque de cada toma, que es lo que se lee al editar.
    const marcadoresDeCaptura = [];
    for (const clase of clases) {
        const claquetas = clase.sesion.claquetas || [];
        for (const c of claquetas) {
            if (c.ms == null) continue;
            const seg = enNido(clase, c.ms);
            marcadoresDeCaptura.push({
                nombre: `Claqueta ${c.n}`,
                comentario: `${clase.nombre} · ${notasXml.comentarioDeClaqueta(c, c === claquetas[0])}`,
                desdeSeg: seg,
                hastaSeg: seg,
                color: COLOR_DE_CLAQUETA
            });
        }
    }

    // Dos vistas pueden compartir una fuente —la Captura 2 sola es la misma
    // pista para «Pantalla» y para «Mano grande»— y pedirle cosas distintas. Es
    // una sola pista: queda puesta, que es lo que no pierde ningún plano, y se
    // dice cuál vista quedó sin cumplir.
    for (const [clave, pide] of quienPide) {
        if (!pide.siempre.size || !pide.suya.size) continue;
        avisos.push(`${[...pide.siempre].join(' y ')} deja la ${usadas.get(clave).nombre} puesta en todas las tomas`
            + ` y ${[...pide.suya].join(' y ')} la quiere solo en las suyas.`
            + ' Es una sola pista, así que quedó puesta en todas, apagada donde no toca.');
    }

    const fuentes = ordenarFuentes([...usadas.values()], config, avisos);
    const grupos = fuentes.filter(f => f.ids.length > 1);

    // Cada anidación de vista se llama como la vista o las vistas que la usan.
    for (const g of grupos) {
        const pide = quienPide.get(g.clave);
        g.vistas = [...new Set([...pide.siempre, ...pide.suya])];
        g.titulo = nombreDeAnidacion(g.vistas);
    }

    // Y cada una lleva su color. Las capturas primero y los grupos después, en
    // el orden de las pistas: dos anidaciones vecinas salen de colores
    // distintos mientras alcancen, que es cuando mirar el color sirve.
    const colorDeCaptura = new Map();
    for (let id = 1; id <= config.capturas; id++) {
        colorDeCaptura.set(id, COLORES_DE_ANIDACION[(id - 1) % COLORES_DE_ANIDACION.length]);
    }
    grupos.forEach((g, i) => {
        g.color = COLORES_DE_ANIDACION[(config.capturas + i) % COLORES_DE_ANIDACION.length];
    });
    for (const f of fuentes) {
        if (f.ids.length === 1) f.color = colorDeCaptura.get(f.ids[0]);
    }

    return { clases, largoSeg, fuentes, grupos, colorDeCaptura, marcadoresDeCaptura, avisos };
}

/**
 * En qué orden van las pistas de vídeo de la precortada, de abajo hacia arriba.
 *
 * Las capturas sueltas van abajo y los grupos encima, y eso no importa: de una
 * toma solo se enciende lo suyo, y lo apagado no tapa nada.
 *
 * **Lo que sí importa es el orden entre capturas sueltas, porque es su
 * apilado.** Una vista suelta con la Captura 1 sobre la 2 necesita que la pista
 * de la 1 esté más arriba que la de la 2, y las pistas son una sola lista para
 * toda la precortada: lo que pide una vista se lo come la otra. Así que se
 * ordenan respetando lo que piden todas (un orden topológico, con el número de
 * captura para desempatar y que dos corridas den lo mismo).
 *
 * **Dos vistas sueltas pueden pedir cosas contrarias** —una la 1 sobre la 2 y
 * la otra al revés— y entonces no hay orden que las deje contentas a las dos.
 * Se respeta la primera, se dice cuál quedó sin cumplir y se dice también cómo
 * arreglarlo, que es anidar una de las dos: una anidación tiene sus propias
 * pistas y ahí sí caben los dos apilados.
 */
function ordenarFuentes(fuentes, config, avisos) {
    const solas = fuentes.filter(f => f.ids.length === 1).sort((a, b) => a.ids[0] - b.ids[0]);
    const grupos = fuentes.filter(f => f.ids.length > 1)
        .sort((a, b) => a.ids.join(',').localeCompare(b.ids.join(','), 'en', { numeric: true }));

    // Lo que pide cada vista suelta: sus capturas vienen de abajo hacia arriba,
    // así que cada una tapa a la anterior.
    const pide = [];
    for (const [vista, v] of Object.entries(config.vistas || {})) {
        if (v.unidas || v.capturas.length < 2) continue;
        for (let i = 1; i < v.capturas.length; i++) {
            pide.push({ vista, arriba: v.capturas[i], abajo: v.capturas[i - 1] });
        }
    }
    if (!pide.length) return solas.concat(grupos);

    const hay = new Set(solas.map(f => f.ids[0]));
    const debajoDe = new Map([...hay].map(id => [id, new Set()]));
    const deQuien = new Map();
    for (const p of pide) {
        if (!hay.has(p.arriba) || !hay.has(p.abajo)) continue;
        // Antes de aceptarla se mira que no cierre un círculo con las que ya
        // están: aceptarla y arrepentirse después dejaría a medias un orden que
        // nadie pidió.
        if (alcanza(debajoDe, p.abajo, p.arriba)) {
            const otra = deQuien.get(`${p.abajo}>${p.arriba}`);
            avisos.push(`${p.vista} quiere la Captura ${p.arriba} sobre la ${p.abajo}`
                + `${otra ? ` y ${otra} las quiere al revés` : ' y otra vista suelta pide lo contrario'}.`
                + ' Las vistas sueltas comparten las pistas, así que quedó el primer apilado:'
                + ' anidá una de las dos para tener los dos.');
            continue;
        }
        debajoDe.get(p.arriba).add(p.abajo);
        deQuien.set(`${p.arriba}>${p.abajo}`, p.vista);
    }

    // De abajo hacia arriba: primero las que nadie tiene debajo suyo.
    const puestas = [];
    const quedan = solas.slice();
    while (quedan.length) {
        const i = quedan.findIndex(f => [...debajoDe.get(f.ids[0])].every(id => puestas.includes(id)));
        const elegida = quedan.splice(i === -1 ? 0 : i, 1)[0];
        puestas.push(elegida.ids[0]);
    }
    return puestas.map(id => solas.find(f => f.ids[0] === id)).concat(grupos);
}

/** ¿Se llega de `desde` a `hasta` siguiendo «va debajo de»? */
function alcanza(debajoDe, desde, hasta) {
    const vistos = new Set();
    const pendientes = [desde];
    while (pendientes.length) {
        const k = pendientes.pop();
        if (k === hasta) return true;
        if (vistos.has(k)) continue;
        vistos.add(k);
        for (const sig of debajoDe.get(k) || []) pendientes.push(sig);
    }
    return false;
}

// ─── El armado ───────────────────────────────────────────────────────

/** Los cuadros por segundo de la secuencia molde, leídos de su `VideoTrackGroup`. */
function fpsDeLaPlantilla(taller) {
    const p = taller.proyecto;
    const grupo = p.refsDe(taller.moldes.secuencia).find(k => p.clase(k) === 'VideoTrackGroup');
    const m = grupo ? /<FrameRate>(\d+)<\/FrameRate>/.exec(p.contenido(grupo)) : null;
    return m ? prproj.TICKS / Number(m[1]) : null;
}

/** ¿Es el mismo fps? 29.97 y 30 no lo son, aunque se escriban parecido. */
function mismoFps(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01;
}

/**
 * Las anidaciones de captura.
 *
 * La Captura 1 primero, porque las otras la llevan adentro. Cada una tiene:
 *   V1     vacío, donde va el vídeo de esa captura
 *   A1     vacío en la 1 (su propio audio); la Captura 1 anidada en las demás
 *   A2     el WAV de referencia de cada clase, entero, en su franja
 *   A3     vacío en las demás, para su propio audio
 * Las de referencia van con la pista silenciada: se ve la onda para sincronizar,
 * pero no se suma al audio de la precortada.
 */
function armarCapturas(taller, plan, config, medios, bin) {
    const capturas = new Map();
    for (let id = 1; id <= config.capturas; id++) {
        const primera = id === 1;
        const seq = taller.crearSecuencia({
            nombre: nombreDeCaptura(id),
            pistasVideo: 1,
            pistasAudio: primera ? 2 : 3,
            duracionSeg: plan.largoSeg
        });
        taller.pintarItemDelPanel(seq.itemDelPanel, plan.colorDeCaptura.get(id));
        taller.guardarEn(bin, seq.itemDelPanel);

        const pistaRef = seq.pistasAudio[1];
        for (const clase of plan.clases) {
            for (const w of clase.wavs) {
                const medio = medios.get(w.ruta);
                if (!medio) continue;
                const desde = clase.franja.desdeSeg + notasXml.aSegundos(w.desdeMs, clase.sesion.ceroMs);
                taller.colocarCorte({
                    pista: pistaRef, medio, desdeSeg: desde, hastaSeg: desde + w.segundos,
                    entradaSeg: 0, etiqueta: ETIQUETA_DE_REFERENCIA, sonando: true
                });
            }
        }
        taller.mutearPista(pistaRef);

        if (!primera && plan.largoSeg > 0) {
            const c1 = capturas.get(1);
            taller.colocarCorte({
                pista: seq.pistasAudio[0], medio: c1.comoFuente,
                desdeSeg: 0, hastaSeg: plan.largoSeg, entradaSeg: 0,
                etiqueta: plan.colorDeCaptura.get(1), sonando: true
            });
            taller.mutearPista(seq.pistasAudio[0]);
        }

        taller.ponerMarcadores(seq.secuencia, plan.marcadoresDeCaptura);
        capturas.set(id, seq);
    }
    return capturas;
}

/**
 * Las anidaciones de grupo: las capturas de una vista compuesta, apiladas.
 *
 * Van de punta a punta, sin cortar, porque el encuadre —el tamaño y el sitio del
 * recuadro— lo pone el editor una vez adentro y vale para toda la carpeta.
 *
 * **Quién tapa a quién sale del menú, no de los números.** Las capturas del
 * grupo vienen de abajo hacia arriba, igual que las pistas, así que la última
 * queda en el V más alto, que es donde Premiere pinta lo que tapa a lo demás.
 * Así «Captura 1 sobre Captura 2» y «Captura 2 sobre Captura 1» son dos
 * anidaciones distintas, y una vista puede llevar la cámara en recuadro sobre la
 * pantalla mientras otra lleva lo contrario.
 */
function armarGrupos(taller, plan, capturas, bin) {
    const grupos = new Map();
    for (const g of plan.grupos) {
        const seq = taller.crearSecuencia({
            nombre: g.titulo || g.nombre,
            pistasVideo: g.ids.length,
            pistasAudio: 1,
            duracionSeg: plan.largoSeg
        });
        taller.pintarItemDelPanel(seq.itemDelPanel, g.color);
        taller.guardarEn(bin, seq.itemDelPanel);
        if (plan.largoSeg > 0) {
            g.ids.forEach((id, i) => {
                taller.colocarCorte({
                    pista: seq.pistasVideo[i], medio: capturas.get(id).comoFuente,
                    desdeSeg: 0, hastaSeg: plan.largoSeg, entradaSeg: 0,
                    etiqueta: plan.colorDeCaptura.get(id), sonando: true
                });
            });
        }
        // Los mismos marcadores que las capturas: es donde se ajusta el encuadre,
        // y ahí también hay que saber en qué clase se está.
        taller.ponerMarcadores(seq.secuencia, plan.marcadoresDeCaptura);
        grupos.set(g.clave, seq);
    }
    return grupos;
}

/**
 * La precortada de una clase.
 *
 * En cada toma entran las fuentes de su vista —varias cuando va suelta, una
 * pista por captura, y una sola cuando va anidada— encendidas, y las demás
 * apagadas: cambiar de plano es encender la que ya está, como hace Class Cut, y
 * lo apagado no tapa a la buena.
 *
 * **Salvo las fuentes que el menú dejó «solo en sus tomas»**, que en las tomas
 * de las otras vistas no ponen nada. Es la línea de tiempo limpia de quien
 * prefiere ver solo lo que va a salir; el precio es que para cambiar de plano
 * ahí ya no hay un clip que encender.
 *
 * Las capturas entran solo como vídeo —su audio es la referencia y la Captura 1,
 * que acá ya están en A1 y A2—; colocadas con audio, la precortada sonaría doble.
 */
function armarPrecortada(taller, clase, plan, fuentes, capturas, medios, bin) {
    const seq = taller.crearSecuencia({
        nombre: clase.nombre,
        pistasVideo: Math.max(1, plan.fuentes.length),
        pistasAudio: 2,
        duracionSeg: clase.duracionSeg
    });
    taller.guardarEn(bin, seq.itemDelPanel);

    const pistaDe = new Map(plan.fuentes.map((f, i) => [f.clave, seq.pistasVideo[i]]));
    const c1 = capturas.get(1);
    let cortes = 0;
    for (const corte of clase.cortes) {
        for (const f of plan.fuentes) {
            const suya = corte.fuentes.includes(f.clave);
            if (!suya && !f.siempre) continue;
            taller.colocarCorte({
                pista: pistaDe.get(f.clave), medio: fuentes.get(f.clave).comoFuente,
                desdeSeg: corte.desdeSeg, hastaSeg: corte.hastaSeg, entradaSeg: corte.entradaSeg,
                etiqueta: f.color,
                sonando: suya
            });
            cortes++;
        }
        taller.colocarCorte({
            pista: seq.pistasAudio[0], medio: c1.comoFuente,
            desdeSeg: corte.desdeSeg, hastaSeg: corte.hastaSeg, entradaSeg: corte.entradaSeg,
            etiqueta: plan.colorDeCaptura.get(1), sonando: true
        });
        cortes++;
        const ref = corte.referencia;
        const medio = ref && medios.get(ref.ruta);
        if (medio && ref.largoSeg > 0) {
            taller.colocarCorte({
                pista: seq.pistasAudio[1], medio,
                desdeSeg: corte.desdeSeg, hastaSeg: corte.desdeSeg + ref.largoSeg, entradaSeg: ref.entradaSeg,
                etiqueta: ETIQUETA_DE_REFERENCIA, sonando: true
            });
            cortes++;
        }
    }
    taller.mutearPista(seq.pistasAudio[1]);
    taller.ponerMarcadores(seq.secuencia, clase.marcadores);
    return cortes;
}

/**
 * Arma el `.prproj` de la carpeta.
 *
 * El destino llega resuelto, como en Class Cut: decidir si se pisa un proyecto
 * que ya existe es un diálogo, y los diálogos viven en el proceso principal
 * (`ipc/prproj.js`).
 *
 * @param {object} opciones
 * @param {string} opciones.carpeta   la carpeta del curso
 * @param {string} opciones.destino   la ruta del `.prproj` a escribir
 * @param {string} opciones.plantilla el `.prproj` del que se clonan los moldes
 * @param {object} [opciones.config]  la del menú (ver `normalizar`)
 * @param {string} [opciones.enCurso] la secuencia que se está grabando, que no entra
 * @param {function} [opciones.avisar] recibe `{hecho, total, que}` mientras arma
 * @param {number} [opciones.semilla] para que dos corridas den el mismo archivo
 */
async function generar(opciones) {
    const op = opciones || {};
    const vacio = { ok: false, ruta: null, clases: 0, avisos: [], cuenta: [], error: null };
    const decir = (hecho, total, que) => {
        try { if (typeof op.avisar === 'function') op.avisar({ hecho, total, que }); } catch (e) { /* contar no es el trabajo */ }
    };

    if (!op.carpeta || !fs.existsSync(op.carpeta)) return { ...vacio, error: 'Esa carpeta no está.' };
    if (!op.destino) return { ...vacio, error: 'No me dijeron dónde escribir el proyecto.' };
    if (!op.plantilla || !fs.existsSync(op.plantilla)) {
        return { ...vacio, error: 'Falta la plantilla de Premiere que viene con la app. Reinstalala.' };
    }

    const sesiones = sesionesGrabadas.listar([op.carpeta], op.enCurso);
    if (!sesiones.length) return { ...vacio, error: 'Esta carpeta no tiene ninguna clase grabada todavía.' };
    const config = normalizar(op.config, vistasUsadas(sesiones));

    let proyecto;
    let taller;
    try {
        proyecto = prproj.Proyecto.leer(op.plantilla);
        taller = new Taller(proyecto, { semilla: op.semilla });
    } catch (e) {
        return { ...vacio, error: `No pude abrir la plantilla: ${e.message}` };
    }
    const faltan = loQueFalta(taller.moldes);
    if (faltan.length) {
        return { ...vacio, error: `La plantilla no sirve de molde: le falta ${faltan.join(', y ')}.` };
    }

    // **Los cuadros por segundo salen de la plantilla, no se escriben.** Una
    // secuencia clonada se queda con los del molde, así que una clase a 29,97
    // armada sobre una plantilla a 30 saldría corrida un cuadro cada medio
    // minuto. Se dice antes de armar nada.
    const fps = fpsDeLaPlantilla(taller);
    if (fps == null) {
        return { ...vacio, error: 'No pude leer los cuadros por segundo de la secuencia de la plantilla.' };
    }
    const distintas = sesiones.filter(s => !mismoFps(s.fps || 30, fps));
    if (distintas.length) {
        const cuales = [...new Set(distintas.map(s => s.fps || 30))].join(', ');
        return {
            ...vacio,
            error: `La plantilla es de ${Math.round(fps * 1000) / 1000} fps y en esta carpeta hay clases a ${cuales} fps`
                + ` (${distintas.length}). Un proyecto así quedaría corrido: hace falta una plantilla a ese fps.`
        };
    }

    // **Los cortes se ajustan contra la onda antes de planear.** El sidecar ya
    // trae el ajuste, pero puede ser de una versión anterior de esa cuenta
    // (`ajustar-corte.VERSION`), y entonces el proyecto saldría con los cortes
    // viejos mientras el XML de la misma clase —rehecho— sale con los nuevos:
    // dos versiones del mismo corte, que es justo lo que el editor no puede
    // tener. Se ajusta en memoria; el sidecar lo reescribe «Rehacer XML».
    decir(0, sesiones.length, 'Mirando la onda de cada clase…');
    for (const s of sesiones) {
        if (!s.archivos || !s.archivos.json) continue;
        sesionesGrabadas.ajustarBordes(s, workspace.sesionDelSidecar(s.archivos.json));
    }

    const plan = planear(sesiones, config);
    const avisos = plan.avisos.slice();
    const total = plan.clases.length;

    try {
        const raiz = taller.raizDelPanel();
        const descolgados = taller.vaciarElPanel();
        const bins = [BIN_CAPTURAS, BIN_PRECORTADAS, BIN_AUDIO, ...BINS_DEL_EDITOR].map((nombre, i) => {
            const bin = taller.crearBin(nombre, { orden: i });
            taller.guardarEn(raiz, bin);
            return bin;
        });

        decir(0, total, 'Importando el audio de referencia…');
        const medios = new Map();
        for (const clase of plan.clases) {
            for (const w of clase.wavs) {
                if (medios.has(w.ruta)) continue;
                const medio = taller.importarMedio({
                    ruta: w.ruta,
                    nombre: path.basename(w.ruta),
                    duracionSeg: w.segundos,
                    canales: w.canales === 2 ? 2 : 1,
                    conVideo: false
                });
                taller.marcarMedio(medio, w.marcadores);
                taller.guardarEn(bins[2], medio.clipProjectItem);
                medios.set(w.ruta, medio);
            }
        }

        decir(0, total, 'Armando las capturas…');
        const capturas = armarCapturas(taller, plan, config, medios, bins[0]);
        const grupos = armarGrupos(taller, plan, capturas, bins[0]);
        const fuentes = new Map();
        for (const f of plan.fuentes) {
            fuentes.set(f.clave, f.ids.length > 1 ? grupos.get(f.clave) : capturas.get(f.ids[0]));
        }

        let cortes = 0;
        let precortadas = 0;
        plan.clases.forEach((clase, i) => {
            if (!clase.cortes.length) return;
            decir(i, total, `Precortando ${clase.nombre}…`);
            cortes += armarPrecortada(taller, clase, plan, fuentes, capturas, medios, bins[1]);
            precortadas++;
        });

        const podados = taller.podarLaPlantilla();

        decir(total, total, 'Guardando el proyecto…');
        fs.mkdirSync(path.dirname(op.destino), { recursive: true });
        proyecto.guardar(op.destino);

        const tomas = plan.clases.reduce((n, c) => n + c.cortes.length, 0);
        const claquetas = plan.marcadoresDeCaptura.filter(m => m.nombre.startsWith('Claqueta ')).length;
        return {
            ok: true,
            ruta: op.destino,
            clases: total,
            precortadas,
            capturas: config.capturas,
            grupos: plan.grupos.length,
            tomas,
            claquetas,
            cortes,
            avisos,
            cuenta: [
                `${total} clase(s) en ${config.capturas} captura(s)`
                    + (plan.grupos.length ? ` y ${plan.grupos.length} grupo(s)` : '')
                    + `, de ${Math.round(plan.largoSeg / 60)} minutos con ${nidos.AIRE_SEG / 60} de aire entre clases.`,
                `${precortadas} precortada(s) con ${tomas} toma(s) y ${claquetas} claqueta(s) marcada(s) en las capturas.`,
                `Se quitaron ${descolgados} objeto(s) de la plantilla (${podados} borrado(s)).`
            ],
            error: null
        };
    } catch (e) {
        // `guardar` verifica antes de escribir: si el grafo quedó mal, no se
        // escribió nada. Se dice así, para que nadie busque un archivo roto.
        return { ...vacio, avisos, error: `No se pudo armar el proyecto y no escribí nada: ${e.message}` };
    }
}

module.exports = {
    generar,
    planear,
    normalizar,
    vistasUsadas,
    leerConfig,
    guardarConfig,
    archivoDeConfig,
    fpsDeLaPlantilla,
    mismoFps,
    nombreDeCaptura,
    nombreDeFuente,
    BIN_CAPTURAS,
    BIN_PRECORTADAS,
    BIN_AUDIO,
    BINS_DEL_EDITOR,
    COLOR_DE_CLAQUETA,
    COLOR_DE_NOTA
};
