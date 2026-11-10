'use strict';
/**
 * grabacion.js — La sesión de toma de notas, de principio a fin.
 *
 * Junta las tres piezas: `captura` escribe el audio que manda la ventana, `oir`
 * lo transcribe por pedazos, y `notas-vivo` decide qué es una toma. Acá está lo
 * que ninguna de las tres puede tener: el estado de la sesión y los relojes que
 * la mueven.
 *
 * **Una sesión es una clase entera, de corrido.** No hay "parar y seguir": se
 * aprieta Iniciar al empezar la clase y Terminar al final, y de eso sale UN XML
 * con todas las tomas. Es lo que pide el escenario: el editor sincroniza el WAV
 * de la clase con el audio de las cámaras por forma de onda y después sigue los
 * IN y los OUT de este XML para cortar, así que los tiempos tienen que cerrar en
 * el total y no por tramos.
 *
 * **Vive en el proceso principal y no en la ventana**, aunque la ventana sea la
 * que dibuja. El motivo es que hay una sola verdad: si el estado viviera allá,
 * las señales las decidiría un archivo y el XML lo escribiría otro, y en cuanto
 * discreparan la clase quedaría con marcadores que no son los que se vieron.
 * La ventana pide y dibuja; acá se decide.
 *
 * **Dos ciclos, y la separación es lo que protege el transcript.** El de señales
 * corre acá, seguido, y su texto es descartable: solo sirve para saber si alguien
 * dijo "3, 2, 1" o "Pausa", y de eso solo se le cree la hora. El de
 * toma corre en `relecturas.js`, una vez por toma, y ESE texto es el que queda.
 * Así el transcript nunca se arma pegando pedazos, que es de donde salen las
 * palabras cortadas y los tiempos que no cierran. Los dos le preguntan al modelo
 * grande: el de acá por el servidor residente, que lo tiene cargado y contesta una
 * ventana de seis segundos en menos de un segundo (ver `oido-residente.js`), y el
 * chico quedó de respaldo para cuando el servidor no está listo.
 *
 * **Qué queda acá y qué se fue.** Este archivo tiene la sesión: arrancarla, el
 * PCM que llega, el ciclo de señales y el cierre. Lo demás salió
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
const idiomas = require('./idiomas');
const registro = require('./registro');
const vivo = require('./notas-vivo');
const historial = require('./deshacer');
const nombreDeSesion = require('./nombre-de-sesion');
const workspace = require('./workspace');

const espejo = require('./espejo');
const residente = require('./oido-residente');
const relecturas = require('./relecturas');
const cambiosToma = require('./cambios-toma');
const sesionesGrabadas = require('./sesiones-grabadas');
const ciclo = require('./ciclo-senales');
const comprobarClase = require('./comprobar-clase');
const alinearAudio = require('./alinear-audio');
const disco = require('./disco');
const { CICLO_MS, CONTEXTO_MS } = ciclo;

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
 * **El cero es el botón**: el XML empieza donde el editor apretó grabar, que es
 * donde empieza el WAV de la clase, y desde ahí se sincroniza contra las cámaras
 * por forma de onda.
 *
 * @param {object} params { dir, numero, fps, idioma, dispositivo,
 *   sampleRate, canales, avisar, sinReloj, reanudar }
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
    // El cero es el instante en que la ventana empezó a capturar para esta
    // clase, si lo dijo (`anclaDe`): desde ahí viene el audio que va a llegar, y
    // lo que el motor tarde acá —la carpeta en un Drive, por ejemplo— no lo
    // corre. Sin eso, ahora.
    const ancla = anclaDe(p);
    const ceroMs = previa ? previa.ceroMs : (ancla != null ? ancla : Date.now());

    const dir = p.dir;

    // El número de clase, y cuál de las veces que se grabó esa clase es esta.
    //
    // La versión se resuelve ACÁ, al arrancar, y no cuando la pantalla mostró
    // el número: entre que alguien ve «01» en la lista de verificación y aprieta
    // Iniciar puede pasar media clase, y en esa carpeta —que suele estar en un
    // Drive compartido— puede haber aparecido la 01 de otra máquina. Lo que vale
    // es lo que hay en el disco en el instante en que se va a escribir.
    //
    // Sin número no hay versión: la sesión se nombra solo por la fecha.
    const numero = nombreDeSesion.numeroEnElNombre(p.numero) ? Math.floor(Number(p.numero)) : null;
    const vez = numero != null ? sesionesGrabadas.vezLibre(dir, numero) : null;

    // El curso es el nombre de la carpeta, siempre. La ventana no lo manda: se
    // resuelve acá para que el nombre que la pantalla muestra de ejemplo y el que
    // se escribe salgan de la MISMA decisión. Ver `cursoPorDefecto`.
    const curso = nombreDeSesion.cursoPorDefecto(p.dir);

    sesion = {
        // Mientras esté en pie. Lo mira todo lo que vuelve de un `await`, que es
        // la única forma de saber que la sesión se cerró mientras se esperaba.
        viva: true,
        estado: previa ? previa.estado : vivo.estadoNuevo({
            secuencia: nombreDeSesion.armar({ curso, cuandoMs: ceroMs, numero, vez }),
            curso,
            numero,
            vez,
            ceroMs,
            fps: p.fps,
            idioma: p.idioma,
            dispositivo: p.dispositivo
        }),
        dir,
        captura: null,
        // Las frases que abren, cierran y cambian de vista, las de Ajustes
        // (`cambiarFrases`). Sin ellas, las de fábrica.
        frases: p.frases || null,
        // El glosario de esta clase, el general y el del curso sumados y ya
        // armados para Whisper (`glosario.texto`). Lo usa la relectura.
        glosario: p.glosario || '',
        // Las tomas que esperan que se les rehaga el texto, de a una; y la
        // promesa de la pasada que las está atendiendo, si hay una
        // (`engine/relecturas.js`).
        cola: [],
        rehaciendo: null,
        // El otro idioma que viene sonando sin confirmar todavía, y cuántas
        // pasadas seguidas lleva (`idiomas.anotarOido`). El confirmado es
        // `estado.idiomaOido`, que se escribe; esto no.
        rachaOido: null,
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
        // Cómo le fue a la última pasada del ciclo, que es de donde sale el
        // tope de la siguiente (ver `topeDeVentana`), y cuánto audio se saltearon
        // entre todas, que es lo que la barra muestra cuando el ciclo no da.
        ultimaPasadaMs: 0,
        ultimaVentanaMs: CONTEXTO_MS,
        salteadoMs: 0,
        // Cuándo se anotó por última vez cada noticia del ciclo en el diario,
        // que va de a una cada `ENTRE_AVISOS_MS` (ver `tocaAnotar`).
        ultimoSalteoMs: 0,
        ultimaLentaMs: 0,
        timer: null,
        avisar: typeof p.avisar === 'function' ? p.avisar : () => {},
        // Con qué se abrió el último WAV, para volver a abrir uno si se pierde.
        ultimaEntrada: { dispositivo: p.dispositivo || null, sampleRate: p.sampleRate, canales: p.canales },
        dormida: false
    };

    // Si algo de lo que sigue falla —el disco desenchufado al abrir el WAV, la
    // carpeta sin permiso al escribir el XML—, la sesión no puede quedar en pie:
    // nadie podría terminarla y cada «Iniciar» siguiente diría que ya hay una
    // grabación en curso, hasta reiniciar la app.
    try {
        // Al reanudar, el WAV nuevo no puede empezar antes de donde terminó el
        // último: dos WAV encimados en A1 dirían dos veces el mismo instante.
        const ultimo = previa ? (sesion.estado.sesiones || []).slice(-1)[0] : null;
        abrirEscucha({
            sampleRate: p.sampleRate, canales: p.canales, sinReloj: p.sinReloj, desdeMs: p.desdeMs,
            noAntesDe: ultimo ? ultimo.desdeMs + (ultimo.segundos || 0) * 1000 : undefined
        });
        // `sinReloj` es para la simulación, que empuja el ciclo a mano después
        // de cada pedazo: con el reloj andando las dos pasadas se pisarían y la
        // que llegara segunda no vería nada.
        if (!p.sinReloj) {
            sesion.timer = setInterval(() => {
                avisarReloj();
                ciclo.buscarSenales(sesion);
                vigilarDeriva();
                reintentarAudio();
                guardarLaAbierta();
                vigilarDisco();
            }, CICLO_MS);
            // El modelo grande cargado para el texto en vivo. No se espera:
            // mientras carga, el ciclo oye por whisper-cli como siempre
            // (`oir.escuchar`).
            residente.arrancar({ idioma: sesion.estado.idioma || 'es' });
        }
        // Al reanudar, la toma que quedó abierta cuando la app murió viene
        // cerrada donde llegó el audio y provisional (`paraReanudar`): se relee,
        // para que su OUT caiga en la última palabra y su texto sea el del
        // modelo grande. Y las cerradas que no llegaron a releerse antes de la
        // caída, por lo mismo. Un archivo de antes de que se guardara la marca
        // no dice cuáles son, y releerlas todas grabando le quitaría la GPU al
        // vivo: esas se dejan para «Regenerar».
        if (previa) {
            const sabeCuales = sesion.estado.tomas.some(t => 'releida' in t);
            for (const t of sesion.estado.tomas) {
                const sinReleer = sabeCuales && t.outMs != null && !t.descartada && !t.releida;
                if (t.outProvisional || sinReleer) relecturas.encolar(sesion, t.id);
            }
        }
        espejo.escribir(sesion);
    } catch (err) {
        if (sesion.timer) clearInterval(sesion.timer);
        if (!p.sinReloj) residente.apagar();
        if (sesion.captura) captura.cerrar(sesion.captura.id, Date.now());
        registro.anotar('main', 'grabacion.no-arranco', { error: err.message });
        soltar();
        throw err;
    }
    return espejo.resumen(sesion);
}

/**
 * Cada cuánto se guarda la sesión mientras hay una toma abierta, aunque nada
 * haya cambiado.
 *
 * El archivo de notas se escribe con cada cambio, y una toma abierta crece sin
 * cambios: el ciclo le agrega palabras y el WAV sigue. Si la app se muere, lo
 * dicho desde el último cambio no estaba en el disco. Diez segundos es lo que
 * se arriesga, contra reescribir el archivo entero una vez por segundo.
 */
const GUARDAR_LA_ABIERTA_MS = 10000;

/**
 * Cuántos minutos de disco quedan, mirado cada medio minuto.
 *
 * Se avisa al cruzar cada uno de estos umbrales, una vez: una hora alcanza para
 * terminar una clase normal y es lo primero que conviene saber; cinco minutos
 * es lo último que se puede hacer algo.
 */
const AVISOS_DE_DISCO_MIN = [60, 30, 10, 5];
const MIRAR_EL_DISCO_MS = 30000;

function vigilarDisco() {
    if (!sesion || !sesion.captura || sesion.terminando) return;
    const ahora = Date.now();
    if (ahora - (sesion.discoMiradoMs || 0) < MIRAR_EL_DISCO_MS) return;
    sesion.discoMiradoMs = ahora;
    const r = disco.revisar(workspace.audioDir(sesion.dir), sesion.captura);
    if (!r.escribible) {
        if (sesion.discoSinEscribir) return;
        sesion.discoSinEscribir = true;
        registro.anotar('main', 'disco.no-escribe', { error: r.error });
        sesion.avisar({ tipo: 'error', mensaje: `No se puede escribir en la carpeta de la clase: ${r.error}` });
        return;
    }
    sesion.discoSinEscribir = false;
    if (r.minutos == null) return;
    const cruzado = AVISOS_DE_DISCO_MIN.filter(u => r.minutos <= u).pop();
    if (cruzado == null || (sesion.discoAvisado != null && cruzado >= sesion.discoAvisado)) return;
    sesion.discoAvisado = cruzado;
    registro.anotar('main', 'disco.poco', { minutos: r.minutos });
    sesion.avisar({
        tipo: 'error',
        mensaje: `Quedan unos ${r.minutos} min de disco para el audio de esta clase. Liberá espacio `
            + 'ya: con el disco lleno el audio deja de escribirse.'
    });
}

function guardarLaAbierta() {
    if (!sesion || sesion.terminando || vivo.tomaAbierta(sesion.estado) == null) return;
    if (Date.now() - (sesion.guardadoMs || 0) < GUARDAR_LA_ABIERTA_MS) return;
    try {
        espejo.escribir(sesion);
    } catch (err) {
        registro.anotar('main', 'grabacion.no-guardo', { error: err.message });
    }
}

function abrirEscucha(params) {
    const p = params || {};
    const info = captura.abrir({
        dir: workspace.audioDir(sesion.dir),
        nombre: sesion.estado.secuencia,
        sampleRate: p.sampleRate,
        canales: p.canales,
        // La simulación (`sinReloj`) puede decir a qué hora arranca el audio:
        // su tiempo corre a golpes de `pcm` y no con el reloj, así que al
        // reanudar una clase simulada el WAV nuevo tiene que nacer DESPUÉS del
        // viejo, como en la realidad. La app nunca lo manda.
        //
        // `noAntesDe` es donde terminó el WAV anterior de esta misma sesión:
        // dos WAV encimados en A1 dirían dos veces el mismo instante.
        desdeMs: Math.max(
            p.sinReloj && Number.isFinite(p.desdeMs) ? p.desdeMs : (anclaDe(p) != null ? anclaDe(p) : Date.now()),
            Number.isFinite(p.noAntesDe) ? p.noAntesDe : 0)
    });
    // La simulación lleva su tiempo a golpes de `pcm`, no con el reloj: ahí no
    // hay nada que alinear.
    sesion.captura = { ...info, segundos: 0, alinear: p.sinReloj ? null : alinearAudio.nuevo() };
    sesion.ultimaEntrada = {
        dispositivo: sesion.estado.dispositivo || null, sampleRate: info.sampleRate, canales: info.canales
    };
    sesion.escuchadoHastaMs = info.desdeMs;
    return info;
}

/**
 * El instante en que la ventana empezó a capturar para este WAV, si lo mandó y
 * es creíble: el reloj es el mismo de este lado, así que algo a más de cinco
 * segundos de ahora no es eso. Ver `prepararEnvio` en `oido.js`.
 */
function anclaDe(p) {
    const ms = Number(p && p.desdeMs);
    if (!Number.isFinite(ms) || (p && p.sinReloj)) return null;
    return Math.abs(Date.now() - ms) <= 5000 ? ms : null;
}

/**
 * El PCM que llega: se escribe, y lo oye el ciclo de señales.
 *
 * @param {string} [origen] 'ventana' para el micrófono. Ese es el que se
 *   completa con silencio si se atrasa (`alinear-audio.js`); el de Zoom y el
 *   del sistema ya lo hace su ayudante, y hacerlo dos veces sería poner el
 *   mismo hueco dos veces.
 */
function pcm(buffer, origen) {
    if (!sesion) return null;
    // Sin WAV —abrir el de después de dormir falló— o con la Mac yéndose a
    // dormir: lo que llega no tiene dónde ir. Antes se tiraba callado; ahora se
    // cuenta y se dice, y el ciclo vuelve a intentar abrir (`reintentarAudio`).
    if (sesion.dormida && Date.now() - sesion.dormidaMs > 3000) {
        // Llega audio con la Mac despierta y el aviso de despertar no vino (o
        // todavía no): se despierta desde acá, que si no la clase quedaría
        // tirando el audio para siempre.
        despertar();
    }
    if (!sesion.captura || sesion.dormida) {
        if (!sesion.terminando && !sesion.dormida) sinDondeEscribir();
        return null;
    }
    const cap = sesion.captura;
    let r = captura.escribir(cap.id, buffer);
    cap.segundos = r.segundos;
    // Hasta cuándo llegó audio a este WAV: es su final, no la hora en que se
    // cierra, que puede ser segundos después —una entrada nueva que tarda en
    // abrir, una relectura que se espera al terminar—.
    cap.ultimoPcmMs = Date.now();
    if (origen === 'ventana' && cap.alinear) {
        const ahora = Date.now();
        const faltaMs = alinearAudio.mirar(cap.alinear, (ahora - cap.desdeMs) - cap.segundos * 1000, ahora);
        if (faltaMs > 0) r = rellenar(cap, faltaMs);
    }
    return r;
}

/** Lo que llega sin WAV abierto: se avisa una vez cada medio minuto. */
function sinDondeEscribir() {
    sesion.tiradosSinWav = (sesion.tiradosSinWav || 0) + 1;
    const ahora = Date.now();
    if (sesion.dormida || ahora - (sesion.avisoSinWavMs || 0) < 30000) return;
    sesion.avisoSinWavMs = ahora;
    registro.anotar('main', 'grabacion.sin-wav', { tirados: sesion.tiradosSinWav });
    sesion.avisar({
        tipo: 'error',
        mensaje: 'El audio no se está guardando: no se pudo abrir el archivo de audio de la clase. '
            + 'Se sigue intentando; si la carpeta está en un disco externo o en un Drive, revisá que esté.'
    });
}

/**
 * Sin WAV y con la clase en pie, se vuelve a intentar abrir uno cada cinco
 * segundos con la misma entrada. Pasa cuando abrir el de después de dormir
 * falló porque el disco de la carpeta todavía no había vuelto: sin esto, el
 * resto de la clase quedaba sin audio hasta que alguien eligiera otra entrada.
 */
function reintentarAudio() {
    if (!sesion || sesion.captura || sesion.terminando || !sesion.ultimaEntrada) return;
    const ahora = Date.now();
    if (ahora - (sesion.reintentoMs || 0) < 5000) return;
    sesion.reintentoMs = ahora;
    const r = cambiarEntrada(sesion.ultimaEntrada);
    if (r.ok) {
        registro.anotar('main', 'grabacion.audio-volvio', { tirados: sesion.tiradosSinWav || 0 });
        sesion.avisar({ tipo: 'error', mensaje: 'El audio se vuelve a guardar, en un WAV nuevo desde ahora.' });
    }
}

/** La Mac se va a dormir: lo que llegue hasta despertar no es de la clase. */
function dormir() {
    if (!sesion || sesion.terminando) return;
    sesion.dormida = true;
    sesion.dormidaMs = Date.now();
}

const AL_DESPERTAR = 'La Mac se durmió: lo de ese rato no se grabó. El audio sigue en un WAV nuevo, en su hora.';

/**
 * La Mac despertó: lo que se grabe va a un WAV nuevo en su hora. Lo llaman el
 * aviso de despertar y el primer audio que llega después de dormir, el que
 * llegue antes; el segundo no vuelve a abrir otro.
 */
function despertar() {
    if (!sesion || sesion.terminando) return null;
    if (!sesion.dormida && sesion.despertoMs && Date.now() - sesion.despertoMs < 10000) return null;
    sesion.despertoMs = Date.now();
    return reabrirAudio(AL_DESPERTAR);
}

/** Escribe `ms` de silencio donde va el próximo pedazo, y lo deja dicho. */
function rellenar(cap, ms) {
    const canales = cap.canales || 1;
    const muestras = Math.round(ms / 1000 * (cap.sampleRate || 48000));
    const r = captura.escribir(cap.id, Buffer.alloc(muestras * canales * 2));
    cap.segundos = r.segundos;
    registro.anotar('main', 'grabacion.relleno', { ms, segundos: cap.segundos });
    // Un tropiezo de un cuarto de segundo no amerita un cartel; uno de más de
    // un segundo sí, que es audio de la clase que no está.
    if (ms >= 1000) {
        sesion.avisar({
            tipo: 'error',
            mensaje: `No llegó audio por ${(ms / 1000).toFixed(1).replace('.', ',')} s: se completó con silencio `
                + 'para que los marcadores no se corran.'
        });
    }
    return r;
}

/**
 * Cuánto se puede atrasar el audio grabado contra el reloj antes de avisar, y de
 * a cuánto se vuelve a avisar si sigue creciendo.
 */
const DERIVA_AVISO_MS = 2000;

/**
 * El reloj del audio grabado, a la ventana, cada segundo y por su cuenta.
 *
 * **Va aparte de `buscarSenales` porque el reloj no puede esperar a Whisper.**
 * El estado completo sale una vez por pasada del ciclo, y una pasada tarda 800 ms
 * medidos con el servidor cargado y se le permiten hasta 20 s (`tiempoMaxMs` en
 * `engine/oir.js`); además no se solapa consigo misma. Así que el timecode de la
 * pantalla —que es la duración de la clase— avanzaba a saltos del tamaño de la
 * pasada, y con la máquina ocupada o sin whisper-server se quedaba quieto medio
 * minuto. El editor lo reportó como «el timecode solo se mueve cuando hay
 * transcript», que es exactamente lo que se ve cuando el reloj cuelga del que
 * transcribe.
 *
 * **Y sigue siendo el audio grabado, no el reloj de pared.** Son los segundos que
 * el WAV tiene escritos (`captura.segundos`). Si la entrada se atrasa, esto se
 * queda quieto y eso es información: `vigilarDeriva` lo dice con palabras, y un
 * temporizador en la ventana lo taparía inventando segundos que no se grabaron.
 *
 * Es un aviso flaco a propósito: `espejo.resumen` copia las palabras de todas las
 * tomas de la clase y mandarlo cada segundo sería mover la clase entera por el
 * puente para adelantar dos dígitos.
 */
function avisarReloj() {
    if (!sesion || !sesion.captura || sesion.terminando) return;
    sesion.avisar({
        tipo: 'reloj',
        segundos: sesion.captura.segundos,
        // El mismo par que usa `espejo.grabadoHastaMs`, para que la ventana pueda
        // sacar la hora del audio sin tener que pedir el estado entero.
        ceroMs: sesion.estado.ceroMs,
        grabadoHastaMs: espejo.grabadoHastaMs(sesion)
    });
}

/**
 * ¿Lo grabado va a la par del reloj?
 *
 * Es la pregunta que habría encontrado en el primer minuto el error del audio
 * de Zoom al doble de velocidad (84,3 s de clase, 42,1 s de WAV), y que
 * encuentra cualquier otro de la misma familia, venga por donde venga —una tasa
 * mal declarada, muestras perdidas, una escucha que se calló—, por Zoom o por
 * micrófono. Lo normal es menos de un tercio de segundo: lo que tarda el audio
 * en llegar. Si se pasa, se avisa en pantalla y queda en el registro (ver
 * `tocaAvisarDeriva`): un atraso que crece es una tasa mal puesta, uno que salta
 * y se queda es un hueco.
 */
function vigilarDeriva() {
    if (!sesion || !sesion.captura || sesion.terminando) return;
    // Una vuelta que llega tarde es un proceso que estuvo trabado, y el audio de
    // ese rato está todavía en camino: medir ahora es ver un atraso que en un
    // momento se pone al día. Se mide en la vuelta siguiente.
    const ahoraMs = Date.now();
    const tarde = sesion.ultimaVueltaMs && ahoraMs - sesion.ultimaVueltaMs > CICLO_MS * 2;
    sesion.ultimaVueltaMs = ahoraMs;
    if (tarde) return;
    const deriva = (Date.now() - sesion.captura.desdeMs) - sesion.captura.segundos * 1000;
    const escalon = Math.floor(deriva / DERIVA_AVISO_MS);
    if (!tocaAvisarDeriva(escalon, sesion.derivaAvisada || 0)) return;
    sesion.derivaAvisada = escalon;
    registro.anotar('main', 'grabacion.deriva', {
        derivaMs: Math.round(deriva),
        segundos: sesion.captura.segundos,
        sampleRate: sesion.captura.sampleRate || null
    });
    sesion.avisar({
        tipo: 'error',
        mensaje: `El audio grabado va ${(deriva / 1000).toFixed(1)} s atrás del reloj. ` +
            'Los marcadores pueden quedar corridos: revisá la entrada en Preparar.'
    });
}

/**
 * Si toca avisar de la deriva: la primera vez que pasa un escalón, y después
 * cada vez que se duplica (2 s, 4, 8, 16…).
 *
 * Antes era cada escalón, o sea cada dos segundos mientras el audio siguiera
 * atrasándose: con la entrada trabada, un cartel y una línea del diario cada
 * dos segundos para siempre. Pasó con una instancia que se quedó grabando sin
 * ventana: más de un día anotando, y el diario —que se recorta a un tope— perdió
 * la historia de esa tarde, que era la que hacía falta mirar. Duplicando, un
 * atraso que crece se sigue viendo crecer, y uno trabado deja una docena de
 * líneas por hora.
 *
 * @param {number} escalon cuántos `DERIVA_AVISO_MS` va atrás
 * @param {number} avisado el escalón del último aviso, o 0
 */
function tocaAvisarDeriva(escalon, avisado) {
    return escalon >= 1 && escalon >= Math.max(1, avisado * 2);
}

/**
 * Cambia la entrada de audio con la clase grabando, sin perder lo anotado.
 *
 * La ventana ya abrió la nueva y dejó de mandar la vieja; acá se cierra el WAV
 * que venía y se abre otro con la tasa de la que quedó, aunque sea la misma: el
 * rato del cambio no está en el archivo, y seguir en el mismo correría todo lo
 * de después contra la cámara. Es lo mismo que pasa al reanudar, y el XML ya
 * sabe llevar varios WAV, cada uno en su sitio.
 *
 * La toma abierta se parte en el cambio (`cambiosToma.pasarAOtroAudio`).
 *
 * @param {{dispositivo:string, sampleRate:number, canales:number}} params
 */
function cambiarEntrada(params) {
    // Sin `captura` también: si abrir el WAV nuevo falló la vez anterior, la
    // clase sigue en pie sin audio y lo que hace falta es justamente otra
    // entrada.
    if (!sesion || !sesion.viva || sesion.terminando) {
        return { ok: false, error: 'No hay una clase grabando.', estado: null };
    }
    const p = params || {};
    const tasa = Number(p.sampleRate);
    if (!(tasa >= 8000 && tasa <= 192000)) {
        return { ok: false, error: 'La entrada nueva no dijo a qué tasa suena.', estado: espejo.resumen(sesion) };
    }
    const vieja = sesion.captura;
    if (vieja) {
        const cerrada = captura.cerrar(vieja.id, vieja.ultimoPcmMs || Date.now());
        if (cerrada) {
            const { error, ...wav } = cerrada;
            if (error) registro.anotar('main', 'captura.no-cerro', { archivo: wav.archivo, error });
            sesion.estado.sesiones.push(wav);
        }
        sesion.captura = null;
    }
    const ultimo = sesion.estado.sesiones[sesion.estado.sesiones.length - 1];
    const finDelViejo = ultimo ? ultimo.desdeMs + (ultimo.segundos || 0) * 1000 : sesion.estado.ceroMs;
    let nueva;
    try {
        nueva = abrirEscucha({
            sampleRate: tasa, canales: Number(p.canales) || 1, noAntesDe: finDelViejo, desdeMs: p.desdeMs
        });
    } catch (err) {
        registro.anotar('main', 'grabacion.otra-entrada-falla', { error: err.message });
        espejo.escribir(sesion);
        return { ok: false, error: `No pude abrir el audio nuevo: ${err.message}`, estado: espejo.resumen(sesion) };
    }
    const toma = cambiosToma.pasarAOtroAudio(sesion, finDelViejo, nueva.desdeMs);
    sesion.estado.dispositivo = p.dispositivo || null;
    sesion.ultimaEntrada = { dispositivo: p.dispositivo || null, sampleRate: tasa, canales: Number(p.canales) || 1 };
    sesion.dormida = false;
    // El atraso se mide desde el WAV nuevo: el viejo ya no corre.
    sesion.derivaAvisada = 0;
    registro.anotar('main', 'grabacion.otra-entrada', {
        dispositivo: sesion.estado.dispositivo,
        sampleRate: tasa,
        antes: vieja ? { sampleRate: vieja.sampleRate, segundos: vieja.segundos } : null,
        huecoMs: Math.max(0, Math.round(nueva.desdeMs - finDelViejo)),
        toma
    });
    espejo.escribir(sesion);
    return { ok: true, toma, estado: espejo.resumen(sesion) };
}

/**
 * Cierra el WAV y abre otro con la misma entrada, desde ahora.
 *
 * Es lo que hace falta después de que la Mac durmió: el reloj siguió y el
 * archivo no, y seguir en el mismo correría contra la cámara todo lo que se
 * grabe después. Es un cambio de entrada a la misma entrada.
 */
function reabrirAudio(motivo) {
    if (!sesion || sesion.terminando) return null;
    const c = sesion.captura || sesion.ultimaEntrada || {};
    const r = cambiarEntrada({ dispositivo: sesion.estado.dispositivo, sampleRate: c.sampleRate, canales: c.canales });
    if (r.ok && motivo) sesion.avisar({ tipo: 'error', mensaje: motivo });
    // Si no abrió, se dice: antes la falla era callada y el resto de la clase
    // quedaba sin audio. El ciclo lo vuelve a intentar (`reintentarAudio`).
    if (!r.ok) {
        sesion.dormida = false;
        registro.anotar('main', 'grabacion.no-reabrio', { motivo, error: r.error });
        sesion.avisar({ tipo: 'error', mensaje: `${r.error} Se vuelve a intentar en unos segundos.` });
    }
    return r;
}

/**
 * Cambia el idioma de la clase que se está grabando, y si se lo piden relee lo
 * que ya pasó.
 *
 * Hasta acá el idioma se fijaba al apretar «Iniciar» y no se podía mover: quien
 * arrancaba con el idioma equivocado se enteraba leyendo el transcript, y para
 * entonces la clase entera estaba mal. Y mal no es «con faltas»: con el idioma
 * equivocado Whisper TRADUCE. Medido el 20/10 sobre una clase real en inglés
 * pedida en español, lo que salió fue «¿Qué es el skill prompt que se ha
 * añadido?». Por eso el gesto existe y por eso no alcanza con cambiarlo de acá
 * en adelante.
 *
 * **Las tomas cerradas se vuelven a leer solo con `releer`.** Quien pregunta es
 * la ventana, porque la decisión es de quien graba: releer rehace el texto que
 * va al XML, que es justo el que está traducido, pero también pisa lo que ya
 * estaba leído. Con `releer` se les quita la marca de releídas y entran en la
 * cola de siempre, que las atiende de a una (`relecturas.js`). Sin `releer` el
 * idioma cambia igual y lo ya leído se queda como está.
 *
 * La toma abierta no hace falta tocarla en ningún caso —el ciclo ya la está
 * oyendo con el idioma nuevo— y la descartada tampoco, que no va a ninguna
 * parte. Una cerrada que todavía no se leyó se va a leer con el idioma nuevo
 * aunque digan que no: ahí no hay trabajo hecho que cuidar.
 *
 * Lo que NO se toca son los bordes: una toma se abrió donde se abrió, y el
 * «3, 2, 1» que la abrió se oyó igual en los dos idiomas.
 *
 * Releer son las tomas que van al XML (`tomasQueQuedan`), las mismas que cuenta
 * `porReleer` en el resumen, que es el número que la ventana pregunta.
 *
 * @param {string} cual Idioma nuevo: uno de los que la app oye, o `auto`.
 * @param {{releer?:boolean}} [opciones] `releer: true` rehace las tomas ya
 *   cerradas. Solo `true`: cualquier otra cosa es no releer, que es lo que no
 *   pisa nada.
 * @returns {{ok:boolean, releyendo?:number, error?:string, estado:object|null}}
 */
function cambiarIdioma(cual, opciones) {
    if (!sesion || !sesion.viva || sesion.terminando) {
        return { ok: false, error: 'No hay una clase grabando.', estado: null };
    }
    if (!idiomas.esElegible(cual)) {
        return { ok: false, error: `«${cual}» no es un idioma de los que la app oye.`, estado: espejo.resumen(sesion) };
    }
    if (cual === sesion.estado.idioma) return { ok: true, releyendo: 0, estado: espejo.resumen(sesion) };

    sesion.estado.idioma = cual;
    // Lo que se venía oyendo deja de valer como decisión: con el idioma puesto
    // a mano, la pasada siguiente lo va a volver a medir contra el nuevo. Y la
    // racha que venía contando se va con él: si no, dos pasadas en inglés de
    // antes del cambio podían confirmar la primera de después.
    if (cual !== 'auto') {
        sesion.estado.idiomaOido = null;
        sesion.rachaOido = null;
    }

    const paraReleer = (opciones && opciones.releer === true) ? vivo.tomasQueQuedan(sesion.estado) : [];
    for (const toma of paraReleer) {
        delete toma.releida;
        relecturas.encolar(sesion, toma.id);
    }
    registro.anotar('main', 'grabar.idioma', { idioma: cual, releyendo: paraReleer.length });
    espejo.escribir(sesion);
    return { ok: true, releyendo: paraReleer.length, estado: espejo.resumen(sesion) };
}

/**
 * Las frases de señal nuevas, con la clase andando: la pasada siguiente del
 * ciclo ya las oye. Lo que ya se oyó no se vuelve a mirar: una toma que abrió
 * con una frase que ahora no está sigue abierta.
 *
 * Sin clase no hace nada: la próxima arranca con las que estén en Ajustes.
 */
function cambiarFrases(frases) {
    if (!sesion || !sesion.viva) return false;
    sesion.frases = frases || null;
    registro.anotar('main', 'grabar.frases', {
        abrir: (sesion.frases && sesion.frases.abrir || []).length,
        cerrar: (sesion.frases && sesion.frases.cerrar || []).length,
        vista: (sesion.frases && sesion.frases.vista || []).length
    });
    return true;
}

/**
 * Cargar el modelo grande desde Preparar, y no al apretar Iniciar.
 *
 * Cargarlo lleva unos segundos, y mientras tanto el ciclo oye con el respaldo
 * (`whisper-cli` con el modelo chico): el «3, 2, 1» del arranque de cada clase,
 * que es justo el que abre la primera toma, lo oía el peor de los dos. Desde
 * Preparar, para cuando se aprieta Iniciar ya está cargado. `arrancar` no hace
 * nada si ya hay uno.
 */
function prepararOido(idioma) {
    residente.arrancar({ idioma: idioma || 'es' });
    return true;
}

/** Y soltarlo al salir de Preparar sin grabar: son 1,6 GB que nadie usa. */
function soltarOido() {
    if (sesion) return false;
    residente.apagar();
    return true;
}

/**
 * El glosario nuevo, con la clase andando: la próxima relectura ya lo usa.
 */
/** La carpeta de la clase que se está grabando, o null. */
function dirEnCurso() {
    return sesion && sesion.viva ? sesion.dir : null;
}

function cambiarGlosario(texto) {
    if (!sesion || !sesion.viva) return false;
    sesion.glosario = texto || '';
    registro.anotar('main', 'grabar.glosario', { largo: sesion.glosario.length });
    return true;
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
    // Primero que no arranque ninguna pasada más, y que la que está en vuelo
    // termine: si no, una pasada que volvía de Whisper después de cerrar la
    // toma le escribía palabras y hasta abría una toma nueva que quedaba sin
    // OUT en una sesión ya marcada como terminada.
    const s = sesion;
    s.terminando = true;
    if (s.pasada) await s.pasada;
    if (sesion !== s) return null;
    const pendiente = cerrarLoAbierto();
    if (pendiente != null) relecturas.encolar(sesion, pendiente);
    // Con el audio cerrado ya no va a llegar más orilla, así que lo que estuviera
    // esperándola se lee con lo que haya: `terminando` ya está puesto, y eso es
    // lo que `hayOrilla` mira. Sin esta llamada, una toma cerrada en los últimos
    // doce segundos se quedaba en la cola para siempre, con el texto del ciclo
    // de señales, que es el descartable.
    relecturas.atender(sesion);
    if (sesion.rehaciendo) await sesion.rehaciendo;
    if (!sesion) return null; // `apagar` se adelantó

    // La sesión queda dicha como terminada, que es lo que distingue en la lista
    // una que se cerró de una que quedó abierta porque la app se fue al piso. La
    // que quedó abierta se puede reanudar (`sesiones-grabadas.reanudar`).
    // **La sesión se suelta pase lo que pase.** Si escribir por última vez
    // fallaba —el disco lleno, la carpeta desenchufada—, la sesión quedaba en
    // pie con el audio ya cerrado: nada se podía terminar, cada ⌘Q volvía a
    // fallar y decía que la clase seguía grabando, y solo salía forzando la
    // salida. Lo que quedó en el disco es la última escritura, que la deja como
    // abierta y por lo tanto reanudable; el cierre lo dice.
    try {
        sesion.estado.terminada = Date.now();
        let final;
        let comprobacion;
        try {
            final = espejo.escribir(sesion);
            // Lo que se descubre en la mesa de edición se puede descubrir acá,
            // con la clase todavía delante (`comprobar-clase.js`). Y los segundos
            // del audio salen de los WAV: con el audio ya cerrado, el resumen
            // decía cero.
            comprobacion = comprobarClase.comprobar(sesion.estado, final);
        } catch (err) {
            registro.anotar('main', 'grabacion.no-cerro', { error: err.message });
            final = espejo.resumen(sesion).archivos;
            comprobacion = {
                ok: false,
                problemas: [`No pude escribir las notas por última vez: ${err.message}. `
                    + 'La clase quedó como abierta, con lo guardado hasta la última escritura: '
                    + 'cuando la carpeta vuelva, se puede reanudar o «Volver a armar el XML».'],
                segundos: (sesion.estado.sesiones || []).reduce((n, w) => n + (w.segundos || 0), 0)
            };
        }
        if (!comprobacion.ok) registro.anotar('main', 'grabacion.comprobacion', { problemas: comprobacion.problemas });
        return {
            ...espejo.resumen(sesion), corto: nombreDeSesion.sinFecha(sesion.estado.secuencia),
            archivos: final, segundos: comprobacion.segundos, comprobacion
        };
    } finally {
        soltar();
    }
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
    // Sin audio entrando no hay nada que oír en vivo, y el gigabyte y medio del
    // modelo le hace falta a la relectura de las últimas tomas.
    residente.apagar();

    const abierta = vivo.tomaAbierta(sesion.estado);
    if (abierta) {
        // Donde llegó el audio, y no en la última palabra oída: el ciclo va
        // unos segundos atrás, y cerrar en su última palabra cortaba lo que el
        // profesor dijo en ese tramo. La relectura lo acerca a la última
        // palabra de verdad (`outProvisional` en `relecturas.js`).
        vivo.cerrarProvisional(abierta, espejo.grabadoHastaMs(sesion));
        abierta.cerradaSola = true;
    }
    if (sesion.captura) {
        const cerrada = captura.cerrar(sesion.captura.id, sesion.captura.ultimoPcmMs || Date.now());
        if (cerrada) {
            const { error, ...wav } = cerrada;
            if (error) registro.anotar('main', 'captura.no-cerro', { archivo: wav.archivo, error });
            sesion.estado.sesiones.push(wav);
        }
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

/**
 * Si la sesión ya no acepta gestos: «Terminar» está cerrando.
 *
 * Mientras dice «terminando», el audio ya se cerró y se releen las últimas
 * tomas. Un Enter, un Reabrir o un ⌘Z que entrara ahí podía abrir una toma
 * después de cerrar lo abierto, y esa toma no llegaba al XML. Se contesta el
 * estado tal cual, igual que con una toma que no existe.
 */
function cerrando() {
    return Boolean(sesion && sesion.terminando);
}

function editar(cambio) {
    if (cerrando()) return espejo.resumen(sesion);
    return cambiosToma.editar(sesion, cambio);
}

/** `ms`, si viene, es la palabra donde se soltó el IN; sin él, ahora. */
function abrirToma(ms) {
    if (cerrando()) return espejo.resumen(sesion);
    return cambiosToma.abrirToma(sesion, { ms: ms == null ? undefined : Number(ms) });
}

/** `ms`, si viene, es la palabra donde se soltó el OUT; sin él, la última dicha. */
function cerrarToma(ms) {
    if (cerrando()) return espejo.resumen(sesion);
    return cambiosToma.cerrarToma(sesion, { ms: ms == null ? undefined : Number(ms) });
}

const NO_MIENTRAS_TERMINA = 'La clase está terminando: ya no se puede deshacer ni rehacer.';

function deshacer() {
    if (cerrando()) return { ok: false, error: NO_MIENTRAS_TERMINA, estado: espejo.resumen(sesion) };
    return cambiosToma.volver(sesion, 'atras');
}

function rehacer() {
    if (cerrando()) return { ok: false, error: NO_MIENTRAS_TERMINA, estado: espejo.resumen(sesion) };
    return cambiosToma.volver(sesion, 'adelante');
}

function resumen() {
    return espejo.resumen(sesion);
}

function listar(dirs) {
    return sesionesGrabadas.listar(dirs, enCurso());
}

/**
 * Qué número de clase le toca a la siguiente en esa carpeta.
 *
 * La que se está grabando ahora SÍ cuenta: su número ya está usado. `listar`
 * la deja fuera a propósito —la pantalla la dibuja aparte— y por eso acá se
 * suma a mano. Sin esto, apretar «Nueva sesión» en medio de una clase ofrecía
 * el número de la clase que se está grabando en ese momento.
 */
function proximoNumero(dir) {
    const suelto = sesionesGrabadas.proximoNumero(dir);
    const mia = sesion && sesion.estado.numero != null ? Number(sesion.estado.numero) + 1 : 0;
    return Math.max(suelto, mia);
}

/**
 * Qué vez de ese número le tocaría a una clase nueva.
 *
 * La que se está grabando cuenta, por lo mismo que en `proximoNumero`: poner a
 * mano el número de la clase que está grabándose ahora tiene que dar V2, no
 * pisarla.
 */
function vezDeLaSiguiente(dir, numero) {
    const suelta = sesionesGrabadas.vezLibre(dir, numero);
    const mia = sesion && Number(sesion.estado.numero) === Number(numero)
        ? Number(sesion.estado.vez || 1) + 1
        : 0;
    return Math.max(suelta, mia);
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
    tocaAvisarDeriva,
    CICLO_MS,
    SOLAPE_MS: ciclo.SOLAPE_MS,
    CONTEXTO_MS,
    VENTANA_MAX_MS: ciclo.VENTANA_MAX_MS,
    // La política del tope es pura y se prueba sin un WAV y sin un modelo, que
    // es la única forma de probar lo que pasa cuando la máquina no da.
    topeDeVentana: ciclo.topeDeVentana,
    activa,
    enCurso,
    iniciar,
    pcm,
    cambiarEntrada,
    reabrirAudio,
    dormir,
    despertar,
    cambiarIdioma,
    cambiarFrases,
    cambiarGlosario,
    dirEnCurso,
    prepararOido,
    soltarOido,
    editar,
    editarGrabada: (json, cambio) => sesionesGrabadas.editarGrabada(json, cambio, enCurso()),
    // Con la secuencia en curso, para que la que se está grabando no se abra por
    // acá: esa ya tiene su pantalla, con el reloj andando.
    paraMirar: json => sesionesGrabadas.paraMirar(json, enCurso()),
    deshacer,
    rehacer,
    abrirToma,
    cerrarToma,
    terminar,
    apagar,
    resumen,
    listar,
    proximoNumero,
    vezDeLaSiguiente,
    reanudar,
    regenerar: sesionesGrabadas.regenerar,
    rehacerXml: json => sesionesGrabadas.rehacerXml(json, enCurso()),
    renombrarGrabada,
    borrarGrabada,
    // Para poder empujar el ciclo desde una prueba o desde el arnés, sin esperar
    // el segundo del reloj.
    buscarSenales: () => ciclo.buscarSenales(sesion),
    guardarLaAbierta,
    vigilarDisco,
    vigilarDeriva,
    avisarReloj,
    // Para las pruebas que necesitan poner palabras a mano en una toma, que es
    // lo que en vivo hace el ciclo de señales con Whisper.
    _sesion: () => sesion,
    _reintentarAudio: () => reintentarAudio()
};
