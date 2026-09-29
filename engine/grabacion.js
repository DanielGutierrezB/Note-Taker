'use strict';
/**
 * grabacion.js — La sesión de toma de notas, de principio a fin.
 *
 * Junta las tres piezas: `captura` escribe el audio que manda la ventana, `oir`
 * lo transcribe por pedazos, y `notas-vivo` decide qué es una toma y qué es una
 * claqueta. Acá está lo que ninguna de las tres puede tener: el estado de la
 * sesión y los relojes que la mueven.
 *
 * **Una sesión es una clase entera, de corrido.** No hay "parar y seguir": se
 * aprieta Iniciar al empezar la clase y Terminar al final, y de eso sale UN XML
 * con todas las tomas y todas las claquetas. Es lo que pide el escenario: el
 * editor sincroniza los archivos a mano contra la primera claqueta y después
 * sigue los IN y los OUT de este XML para cortar, así que los tiempos tienen que
 * cerrar en el total y no por tramos.
 *
 * **Vive en el proceso principal y no en la ventana**, aunque la ventana sea la
 * que dibuja. El motivo es que hay una sola verdad: si el estado viviera allá,
 * las señales las decidiría un archivo y el XML lo escribiría otro, y en cuanto
 * discreparan la clase quedaría con marcadores que no son los que se vieron.
 * La ventana pide y dibuja; acá se decide.
 *
 * **Dos ciclos, y la separación es lo que protege el transcript.** El de señales
 * corre acá, seguido y con un modelo liviano, y su texto es descartable: solo
 * sirve para saber si alguien dijo "3, 2, 1", "Pausa" o "claqueta", y de eso
 * solo se le cree la hora. El de toma corre en `relecturas.js`, una vez por toma
 * y con el modelo grande, y ESE texto es el que queda. Así el transcript nunca
 * se arma pegando pedazos, que es de donde salen las palabras cortadas y los
 * tiempos que no cierran.
 *
 * **Qué queda acá y qué se fue.** Este archivo tiene la sesión: arrancarla, el
 * PCM que llega, el ciclo de señales, las claquetas y el cierre. Lo demás salió
 * a módulos con nombre propio, y todos reciben la sesión en vez de buscarla:
 *
 *   `espejo.js`           lo que se ve de la sesión: el disco y la pantalla
 *   `relecturas.js`       la cola que le rehace el texto a cada toma cerrada
 *   `cambios-toma.js`     lo que el editor cambia a mano, y deshacer
 *   `sesiones-grabadas.js` las sesiones que ya están en el disco
 *   `oir-toma.js`         volver a oír un tramo, con o sin sesión
 *
 * Lo de abajo del todo es la fachada: la ventana y las pruebas siguen entrando
 * por `grabacion`, que es lo único que sabe si hay una sesión y cuál es.
 */

const captura = require('./captura');
const golpe = require('./golpe');
const vivo = require('./notas-vivo');
const historial = require('./deshacer');
const nombreDeSesion = require('./nombre-de-sesion');
const workspace = require('./workspace');

const espejo = require('./espejo');
const oirToma = require('./oir-toma');
const relecturas = require('./relecturas');
const cambiosToma = require('./cambios-toma');
const sesionesGrabadas = require('./sesiones-grabadas');

/**
 * Cada cuánto se escucha buscando señales, y cuánto se escucha.
 *
 * La ventana se solapa con la anterior a propósito: una señal que caiga justo en
 * el borde entre dos pedazos aparece partida en los dos y en ninguno completa. Un
 * segundo alcanza para "3, 2, 1", que es la señal más larga.
 */
const CICLO_MS = 3000;
const SOLAPE_MS = 1200;

/** Cuánto se le da a Whisper alrededor de un golpe para leer la frase. */
const MARGEN_CLAQUETA_MS = 4000;

/**
 * Lo que se busca alrededor del aplauso para creerle.
 *
 * El director dice "Claqueta 7, clase 7" y aplaude, pero Whisper no conoce la
 * palabra: en trece clases reales la escribió "Claqueta", "Claquetados",
 * "Cacleta", "Klaqueta" y hasta "clasedos" pegando "clase dos". De ahí que se
 * busque el pedazo del medio y no la palabra entera.
 *
 * "Clase" a secas NO alcanza y por eso lleva un número detrás: es la palabra más
 * dicha de una clase —"en esta clase vas a entender…"— y con ella cualquier
 * portazo cerca de alguien hablando quedaba confirmado.
 */
const DICE_CLAQUETA = vivo.CLAQUETA;
const DICE_CLASE_N = /\bclase\s*(\d{1,3})\b/i;

let sesion = null;
/** La promesa de `terminar`, mientras dura. */
let cierre = null;

function activa() {
    return Boolean(sesion);
}

/** La sesión que se está grabando, para que el disco la deje fuera de la lista. */
function enCurso() {
    return sesion ? sesion.estado.secuencia : null;
}

/**
 * Suelta la sesión, y le avisa.
 *
 * Los dos son necesarios y por eso van juntos. Bajar `viva` es lo que hace que
 * las pasadas que quedaron en el aire —una relectura— se den cuenta al volver de
 * su `await` de que la sesión que tienen en la mano ya no es la de nadie.
 */
function soltar() {
    if (sesion) sesion.viva = false;
    sesion = null;
}

/**
 * Arranca una sesión.
 *
 * `ceroMs` se fija acá y no cuando llega el primer audio: es el momento de
 * "Iniciar grabación", y de él cuelgan todos los cuadros del XML. También es la
 * hora que va en el nombre del archivo (ver `nombre-de-sesion.js`).
 *
 * **El cero es el botón y no la primera claqueta**, aunque la claqueta sea la
 * referencia física. Con el cero en la claqueta, el número que el editor tendría
 * que compensar sería "cuánto tardaron en claquetear", que es cualquier cosa
 * entre siete segundos y dos minutos. Con el cero en el botón, el XML empieza
 * donde el editor apretó grabar y la primera claqueta queda marcada adentro,
 * con su timecode, que es exactamente lo que él necesita para correlacionar.
 *
 * @param {object} params { dir, curso, fps, idioma, dispositivo, sampleRate,
 *   canales, avisar, sinReloj, reanudar }
 */
function iniciar(params) {
    const p = params || {};
    if (!p.dir) throw new Error('Falta la carpeta donde guardar las notas.');
    if (sesion) throw new Error('Ya hay una grabación en curso.');

    // Reanudar una sesión que quedó abierta: se conservan el cero, el nombre y
    // todo lo grabado, y el audio nuevo entra como OTRO WAV en su offset. Lo que
    // no se puede es mover el cero, porque los marcadores ya escritos cuelgan de
    // él y el editor puede haber sincronizado contra ellos (ver `reanudar` en
    // `sesiones-grabadas.js`).
    const previa = p.reanudar || null;
    const ceroMs = previa ? previa.ceroMs : Date.now();

    sesion = {
        // Mientras esté en pie. Lo mira todo lo que vuelve de un `await`, que es
        // la única forma de saber que la sesión se cerró mientras se esperaba.
        viva: true,
        estado: previa ? previa.estado : vivo.estadoNuevo({
            secuencia: nombreDeSesion.armar({ curso: p.curso, cuandoMs: ceroMs }),
            curso: p.curso,
            ceroMs,
            fps: p.fps,
            idioma: p.idioma,
            dispositivo: p.dispositivo
        }),
        dir: p.dir,
        captura: null,
        // El fondo de esta sala y cuándo fue el último golpe (`golpe.js`).
        golpes: golpe.nuevo(),
        // Los golpes que todavía no se leyeron, en orden: la hora de cada uno. Se
        // leen cuando el audio de alrededor ya está en el disco (`leerCandidatas`).
        candidatas: [],
        // Las tomas que esperan que se les rehaga el texto, de a una; y la
        // promesa de la pasada que las está atendiendo, si hay una
        // (`engine/relecturas.js`).
        cola: [],
        rehaciendo: null,
        // Lo que el editor le hizo a las tomas a mano, para poder volver
        // (`engine/deshacer.js`). Nace con la sesión y muere con ella: las fotos
        // son de las tomas de ESTA clase, y deshacer con el historial de la
        // anterior metería una toma de otra grabación adentro de esta.
        historia: historial.nueva(),
        // "Terminar" ya apretado: el audio se cerró y se releen las últimas tomas.
        terminando: false,
        // Hasta dónde ya se escuchó buscando señales.
        escuchadoHastaMs: ceroMs,
        buscando: false,
        timer: null,
        avisar: typeof p.avisar === 'function' ? p.avisar : () => {}
    };

    abrirEscucha({ sampleRate: p.sampleRate, canales: p.canales });
    // `sinReloj` es para la simulación, que empuja el ciclo a mano después de
    // cada pedazo: con el reloj andando las dos pasadas se pisarían y la que
    // llegara segunda no vería nada.
    if (!p.sinReloj) sesion.timer = setInterval(() => { buscarSenales(); }, CICLO_MS);
    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

function abrirEscucha(params) {
    const p = params || {};
    const info = captura.abrir({
        dir: workspace.audioDir(sesion.dir),
        nombre: sesion.estado.secuencia,
        sampleRate: p.sampleRate,
        canales: p.canales,
        desdeMs: Date.now()
    });
    sesion.captura = { ...info, segundos: 0 };
    sesion.escuchadoHastaMs = info.desdeMs;
    return info;
}

/**
 * El PCM que manda la ventana: se escribe y se mira si trajo un golpe.
 *
 * La hora que se le da al buscador de golpes sale de la POSICIÓN EN EL AUDIO y
 * no de `Date.now()`, y eso importa por dos motivos. Uno: el pedazo que llega
 * ahora se grabó hace un instante, y el aplauso tiene que quedar donde suena.
 * El otro es que así el mismo código sirve para pasarle el audio de una clase
 * vieja a toda velocidad y comprobar que encuentra sus claquetas
 * (`tools/simular-grabacion.js`), que es la única forma de probar esto sin
 * ponerse a aplaudir delante del micrófono.
 *
 * **Los golpes no se dejan de anotar nunca.** En Class Cut, con la claqueta ya
 * confirmada no se anotaba ninguno más, porque en una clase de allá se aplaude
 * una vez. Acá se claquetea cada vez que hace falta volver a sincronizar, así
 * que cada golpe es candidato y `anotarClaqueta` se ocupa de que dos que sean el
 * mismo no entren dos veces.
 */
function pcm(buffer) {
    if (!sesion || !sesion.captura) return null;

    // Antes de escribir: `segundos` es cuánto había, o sea dónde arranca esto.
    const desdeMs = sesion.captura.desdeMs + sesion.captura.segundos * 1000;
    const r = captura.escribir(sesion.captura.id, buffer);
    sesion.captura.segundos = r.segundos;

    const visto = golpe.mirar(sesion.golpes, buffer, Math.round(desdeMs));
    if (visto.golpe) {
        sesion.candidatas.push(visto.ms);
        sesion.avisar({ tipo: 'golpe', ms: visto.ms });
    }
    return r;
}

/** Un tramo de esta sesión, transcripto (`oir-toma.js` no sabe de sesiones). */
function oirTramo(desdeMs, hastaMs, liviano) {
    return oirToma.tramo(
        espejo.archivosDeLaSesion(sesion), desdeMs, hastaMs, liviano, sesion.estado.idioma);
}

/**
 * El ciclo de señales: escucha lo último y abre o cierra tomas.
 *
 * Nunca corre dos veces a la vez. Whisper tarda algo más de un segundo y el ciclo
 * dispara cada tres, pero si el disco o el modelo se demoran, encadenar dos
 * lecturas del mismo audio duplicaría las palabras y con ellas las señales.
 */
async function buscarSenales() {
    if (!sesion || sesion.buscando || !sesion.captura) return;
    const hasta = espejo.grabadoHastaMs(sesion);
    const desde = Math.max(sesion.captura.desdeMs, sesion.escuchadoHastaMs - SOLAPE_MS);
    if (hasta - desde < 1500) return;

    sesion.buscando = true;
    try {
        // Primero los golpes que quedaron por leer: una claqueta es lo que ancla
        // la sincronía en post y una toma puede esperar tres segundos más.
        await leerCandidatas();
        if (!sesion) return;

        const oido = await oirTramo(desde, hasta, true);
        if (!sesion) return;

        let eventos = [];
        if (oido && oido.palabras.length) {
            // La ventana entera, incluido el solape: quitar acá lo ya oído deshacía
            // el solape justo cuando servía (ver `aplicarSenales`).
            eventos = vivo.aplicarSenales(sesion.estado, oido.palabras);
            for (const ev of eventos) {
                if (ev.tipo === 'cerrada') relecturas.encolar(sesion, ev.toma);
            }
            if (eventos.length) espejo.escribir(sesion);
        }
        relecturas.releerOrillas(sesion);
        // El estado va en cada pasada y no solo cuando hay una señal: así las
        // palabras de la toma abierta van apareciendo en pantalla, que es lo que
        // dice "esto está oyendo bien" sin tener que esperar a que la toma cierre.
        //
        // `oyendo` es lo que se acaba de oír, tal cual, incluida la charla que no
        // es de ninguna toma. Es el único sitio donde eso se ve, y es lo que
        // permite darse cuenta de que está entrando el micrófono de la Mac en vez
        // del audio del Zoom antes de haber grabado media clase.
        sesion.avisar({
            tipo: 'estado',
            estado: espejo.resumen(sesion),
            eventos,
            oyendo: (oido ? oido.palabras : []).map(w => w.texto).join(' ')
        });
        sesion.escuchadoHastaMs = hasta;
    } catch (err) {
        if (sesion) sesion.avisar({ tipo: 'error', mensaje: err.message });
    } finally {
        if (sesion) sesion.buscando = false;
    }
}

/* ─── Las claquetas ───────────────────────────────────────────────────────
 *
 * Cada aplauso ancla un punto de sincronía, y el editor los usa para saber si
 * los archivos de Premiere son uno o varios y dónde empieza cada uno.
 * Encontrarlos tiene dos mitades: el pico lo oye `golpe.js` en el PCM, y
 * creerle o no es lo de acá. La tercera puerta —la palabra "claqueta" dicha— no
 * pasa por este tramo: entra por el ciclo de señales (`notas-vivo.senales`),
 * porque ahí el audio ya está transcripto.
 */

/**
 * Lee qué se dijo alrededor de cada golpe pendiente y decide si es una claqueta.
 *
 * El pico solo no alcanza —una puerta o un golpe en la mesa miden igual— así que
 * se transcribe alrededor y se busca "claqueta" o "clase N".
 *
 * **Se lee después, no cuando el golpe suena.** En ese momento el audio que viene
 * DETRÁS todavía no existe —se está grabando— y ahí está la mitad de la frase:
 * pedir un tramo que no está escrito devuelve nada. Lo llama el ciclo de
 * señales, que corre cada tres segundos: para cuando le toca, el margen ya está
 * en el disco.
 *
 * Las candidatas son una cola y no un solo lugar porque dos golpes pueden venir
 * más cerca de lo que tarda en leerse el primero.
 *
 * **Un golpe sin frase se anota igual, sin confirmar.** Es la diferencia con
 * Class Cut, donde solo había una claqueta y una sin confirmar era ruido que
 * tapaba a la buena. Acá una claqueta de más se borra con un clic, y una de
 * menos es un punto de sincronía que el editor no tiene: la pantalla la muestra
 * como `por confirmar` y quien está mirando decide.
 */
async function leerCandidatas() {
    while (sesion && sesion.candidatas.length) {
        const ms = sesion.candidatas[0];
        // Todavía no hay audio detrás de este golpe; los que siguen son
        // posteriores, así que tampoco.
        if (espejo.grabadoHastaMs(sesion) < ms + MARGEN_CLAQUETA_MS) return;
        sesion.candidatas.shift();

        const leida = await leerClaqueta(ms);
        if (!sesion) return;
        const anotada = vivo.anotarClaqueta(sesion.estado, leida);
        if (anotada.nueva) {
            sesion.avisar({ tipo: 'claqueta', claqueta: anotada.claqueta.n, por: 'golpe' });
        }
        espejo.fijar(sesion);
    }
}

async function leerClaqueta(ms) {
    let frase = '';
    try {
        const oido = await oirTramo(ms - MARGEN_CLAQUETA_MS, ms + MARGEN_CLAQUETA_MS, false);
        frase = (oido ? oido.palabras : []).map(w => w.texto).join(' ').trim();
    } catch (err) {
        // El golpe se oyó igual: queda anotado sin frase, y se avisa.
        if (sesion) sesion.avisar({ tipo: 'error', mensaje: err.message });
    }
    return {
        ms,
        // La hora de pared de verdad, para poder emparejar la claqueta con la
        // fecha de creación de un archivo de cámara. No se usa para nada del
        // XML: los cuadros salen de `ms`, que es el reloj del audio.
        paredMs: Date.now(),
        frase,
        confirmada: DICE_CLAQUETA.test(frase) || DICE_CLASE_N.test(frase),
        origen: 'golpe'
    };
}

/**
 * Una claqueta puesta a mano: el aplauso no se oyó, o se oyó un portazo.
 *
 * Confirmada por construcción. La afirmó una persona que estaba mirando, y
 * pedirle a Whisper que lo confirme sería desconfiar del editor para creerle a
 * un modelo.
 *
 * **Se estampa con el reloj del AUDIO y no con `Date.now()`.** Es el cambio que
 * hace que todo cierre en el total: el editor aprieta la tecla mientras oye la
 * claqueta, y el audio que se está escribiendo va uno o dos pedazos por detrás
 * del reloj de pared. Con `Date.now()` la marca caía adelante de donde suena, y
 * en una clase de tres horas eso son marcas que no coinciden con la onda. El
 * `paredMs` real se guarda igual, en el sidecar, para poder depurar.
 *
 * **Va al historial como todo lo demás**, y la foto es de la lista entera:
 * anotar puede fundir dos y renumerar las de atrás (ver `anotarClaqueta`).
 */
function claqueta() {
    if (!sesion) return null;
    const antes = historial.fotoDeCampo(sesion.estado.claquetas);
    const anotada = vivo.anotarClaqueta(sesion.estado, {
        ms: espejo.grabadoHastaMs(sesion) || Date.now(),
        paredMs: Date.now(),
        frase: '',
        confirmada: true,
        origen: 'editor'
    });
    cambiosToma.anotarDeLaSesion(sesion, 'claquetas', antes,
        { tipo: 'claquetas', n: anotada.claqueta.n });
    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

/** Saca una claqueta de la lista: se marcó de más, o el portazo no era. */
function quitarClaqueta(n) {
    if (!sesion) return null;
    const antes = historial.fotoDeCampo(sesion.estado.claquetas);
    vivo.quitarClaqueta(sesion.estado, Number(n));
    cambiosToma.anotarDeLaSesion(sesion, 'claquetas', antes, { tipo: 'claquetas', n: null });
    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

/* ─── El cierre ───────────────────────────────────────────────────────────*/

/**
 * Termina la sesión: cierra el audio, relee lo que quedó pendiente, escribe por
 * última vez y suelta todo.
 *
 * Es asíncrona por la relectura. La toma que estaba abierta se cierra acá y
 * nadie la había releído con el modelo grande —y las que se cerraron en los
 * últimos segundos pueden estar todavía en la cola—. Sin esperar, la última toma
 * de cada clase quedaba con el texto del ciclo de señales, que es el
 * descartable. El audio ya está cerrado para entonces, así que se lee del WAV
 * terminado. Son uno o dos segundos por toma pendiente, y la ventana lo dice.
 *
 * Apretar "Terminar" dos veces es una vez: la segunda recibe la misma promesa.
 */
function terminar() {
    if (!sesion) return cierre || Promise.resolve(null);
    if (!cierre) {
        sesion.terminando = true;
        // La promesa vive fuera de `sesion`: si no hay nada que releer, cerrar es
        // sincrónico y `sesion` ya es null cuando la promesa vuelve.
        cierre = cerrarSesion().finally(() => { cierre = null; });
    }
    return cierre;
}

async function cerrarSesion() {
    const pendiente = cerrarLoAbierto();
    if (pendiente != null) relecturas.encolar(sesion, pendiente);
    if (sesion.rehaciendo) await sesion.rehaciendo;
    if (!sesion) return null; // `apagar` se adelantó

    // La sesión queda dicha como terminada, que es lo que distingue en la lista
    // una que se cerró de una que quedó abierta porque la app se fue al piso. La
    // que quedó abierta se puede reanudar (`sesiones-grabadas.reanudar`).
    sesion.estado.terminada = Date.now();
    const final = espejo.escribir(sesion);
    const salida = { ...espejo.resumen(sesion), archivos: final };
    soltar();
    return salida;
}

/**
 * Cierra la toma abierta y el audio, sin releer nada. Devuelve el id de la toma
 * que quedó por releer, si hubo una.
 *
 * La toma se cierra en su última palabra, o donde llegó el audio si no dijo
 * ninguna. No en `Date.now()`: la hora de ahora puede ser posterior a lo que se
 * grabó, y un OUT más allá del audio deja un bloque que en post no existe.
 */
function cerrarLoAbierto() {
    if (sesion.timer) clearInterval(sesion.timer);
    sesion.timer = null;

    const abierta = vivo.tomaAbierta(sesion.estado);
    if (abierta) {
        abierta.outMs = vivo.finDeToma(abierta, espejo.grabadoHastaMs(sesion));
        abierta.cerradaSola = true;
    }
    if (sesion.captura) {
        const cerrada = captura.cerrar(sesion.captura.id, Date.now());
        if (cerrada) sesion.estado.sesiones.push(cerrada);
        sesion.captura = null;
    }
    return abierta ? abierta.id : null;
}

/**
 * Al cerrar la app: lo mínimo y sincrónico. Se cierra lo abierto, se escribe y
 * se cierra cualquier WAV que quede. Sin releer nada, porque la app se está
 * yendo: para eso está "Regenerar" en la lista de sesiones.
 *
 * Así la cabecera del WAV queda con el tamaño real y el XML con lo último que
 * pasó. Cerrar la app en medio de un rodaje no puede costar la clase — y como
 * la sesión no queda marcada como terminada, se puede reanudar.
 */
function apagar() {
    if (sesion) {
        // Pase lo que pase, la sesión se suelta. Si escribir fallara —el disco
        // lleno, la carpeta desenchufada— y esto se cortara ahí, quedaría una
        // sesión en pie que nadie puede terminar y que impide arrancar la
        // siguiente: la app se cierra igual, pero la de al lado —la simulación,
        // las pruebas, un segundo arranque— se encuentra con «ya hay una
        // grabación en curso» y sin manera de sacarla.
        try {
            cerrarLoAbierto();
            espejo.escribir(sesion);
        } finally {
            soltar();
        }
    }
    captura.cerrarTodo();
}

/* ─── La fachada ──────────────────────────────────────────────────────────
 *
 * La ventana, el puente y las pruebas entran por acá y no por los módulos de
 * adentro, y el motivo es uno solo: este archivo es el único que sabe si hay una
 * sesión y cuál es.
 */

function editar(cambio) {
    return cambiosToma.editar(sesion, cambio);
}

function abrirToma() {
    return cambiosToma.abrirToma(sesion);
}

function cerrarToma() {
    return cambiosToma.cerrarToma(sesion);
}

function deshacer() {
    return cambiosToma.volver(sesion, 'atras');
}

function rehacer() {
    return cambiosToma.volver(sesion, 'adelante');
}

function resumen() {
    return espejo.resumen(sesion);
}

function listar(dirs) {
    return sesionesGrabadas.listar(dirs, enCurso());
}

/**
 * Renombrar, borrar y reanudar pasan por la fachada y no se exportan directo, y
 * es por lo único que este tramo existe: son las tres que tienen que saber cuál
 * es la sesión que se está grabando en este instante, para negarse a tocarle los
 * archivos por debajo.
 */
function renombrarGrabada(json, cambio) {
    return sesionesGrabadas.renombrar(json, cambio, enCurso());
}

function borrarGrabada(json) {
    return sesionesGrabadas.borrar(json, enCurso());
}

/**
 * Reanuda una sesión que quedó abierta: la vuelve a poner en curso con su cero y
 * sus tomas, y abre un WAV nuevo que entra como otro clip en su offset.
 */
function reanudar(json, params) {
    const previa = sesionesGrabadas.paraReanudar(json, enCurso());
    return iniciar({ ...(params || {}), dir: previa.dir, reanudar: previa });
}

module.exports = {
    CICLO_MS,
    MARGEN_CLAQUETA_MS,
    activa,
    enCurso,
    iniciar,
    pcm,
    claqueta,
    quitarClaqueta,
    editar,
    editarGrabada: sesionesGrabadas.editarGrabada,
    deshacer,
    rehacer,
    abrirToma,
    cerrarToma,
    terminar,
    apagar,
    resumen,
    listar,
    reanudar,
    regenerar: sesionesGrabadas.regenerar,
    renombrarGrabada,
    borrarGrabada,
    // Para poder empujar el ciclo desde una prueba o desde el arnés, sin esperar
    // los tres segundos del reloj.
    buscarSenales
};
