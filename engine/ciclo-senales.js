'use strict';
/**
 * ciclo-senales.js — El ciclo que escucha lo último y abre o cierra tomas.
 *
 * Cada segundo oye los últimos seis de audio buscando «3, 2, 1», «Pausa» y
 * «claqueta», y lee qué se dijo alrededor de cada palmada pendiente. Su texto
 * es descartable: de lo que oye solo se le cree la hora (ver la cabecera de
 * `grabacion.js`, «Dos ciclos»).
 *
 * Va aparte de la sesión porque es lo único de ella que corre solo y espera a
 * Whisper, que es donde una sesión puede terminar y otra arrancar mientras se
 * espera. Por eso recibe la sesión en cada pasada y no la busca nunca: la que
 * le dieron es la que mira al volver de cada `await`.
 */

const registro = require('./registro');
const vivo = require('./notas-vivo');
const espejo = require('./espejo');
const residente = require('./oido-residente');
const oirToma = require('./oir-toma');
const relecturas = require('./relecturas');

/**
 * Cada cuánto se escucha buscando señales, y cuánto se escucha.
 *
 * Cada segundo, sobre los últimos seis. Antes era cada tres sobre poco más de
 * cuatro, relanzando whisper-cli con el modelo chico: el texto aparecía tarde y
 * mal. Con el modelo grande ya cargado (`oido-residente.js`) una pasada de seis
 * segundos tarda medio, así que se puede oír más seguido y con más audio
 * alrededor, que es de donde Whisper saca el contexto para acertar.
 *
 * Medido con una sesión de verdad sobre el audio de una prueba por Zoom, desde
 * que se dice una palabra hasta que aparece: cada 1,5 s con 0,7 s de cola, 3,3 s
 * de mediana y 5,4 s en el peor décimo; cada 1 s con 0,5 s, 2,9 y 4,1, con el
 * mismo texto. Más seguido que esto la GPU pasa más de la mitad del tiempo en el
 * ciclo, y la relectura de las tomas cerradas la necesita.
 *
 * La ventana se solapa con la anterior a propósito: una señal que caiga justo en
 * el borde entre dos pedazos aparece partida en los dos y en ninguno completa.
 * Lo repetido lo descarta `aplicarSenales`.
 *
 * `COLA_MS` es lo del final de cada pasada que se oye pero no se cree todavía:
 * la última palabra de un pedazo suele estar cortada, y la siguiente pasada la
 * oye entera (ver `firmeHastaMs` en `aplicarSenales`).
 */
const CICLO_MS = 1000;
const SOLAPE_MS = 1200;
const CONTEXTO_MS = 6000;
const NUEVO_MIN_MS = 700;
const COLA_MS = 500;

/**
 * Cuánto se le da a Whisper alrededor de una palmada para leer la frase.
 *
 * Los mismos seis segundos que `notas-vivo.PALABRA_Y_APLAUSO_MS`, que es la
 * otra mitad de la misma regla. Estaba en cuatro, y con cuatro se perdía la
 * claqueta del 30/09 a los 75,86 s: el profesor dijo «clase 2, claqueta» y
 * aplaudió 4,3 s después, así que la palabra caía justo afuera de la ventana y
 * la palmada quedaba sin confirmar. Con una palmada de verdad al lado, abrirla
 * no agrega falsos: lo que decide sigue siendo que se haya dicho la palabra.
 */
const MARGEN_CLAQUETA_MS = vivo.PALABRA_Y_APLAUSO_MS;

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

/** Un tramo de esta sesión, transcripto (`oir-toma.js` no sabe de sesiones). */
function oirTramo(desdeMs, hastaMs, liviano, s) {
    return oirToma.tramo(espejo.archivosDeLaSesion(s), desdeMs, hastaMs, liviano, s.estado.idioma);
}

/**
 * Lo más largo que se le pasa a Whisper en una pasada del ciclo. Si Whisper
 * falla varias veces seguidas, `escuchadoHastaMs` no avanzaba y la ventana
 * crecía una pasada por vez: a los dos minutos de errores eran 120 s de audio
 * por pasada, cortados con un ffmpeg sincrónico en el proceso principal, y de
 * ahí no se salía más.
 */
const VENTANA_MAX_MS = 15000;

/**
 * Hasta dónde se puede ensanchar la ventana ESTA pasada.
 *
 * Ensanchar sirve para un tropiezo: una pasada que tardó ocho segundos deja
 * ocho segundos de audio sin oír, y la siguiente los recupera pidiendo una
 * ventana más larga. Para eso está `VENTANA_MAX_MS` y hay que dejarlo.
 *
 * **Pero cuando la máquina no da, ensanchar es lo peor que se puede hacer.** La
 * ventana se clava en el tope justo cuando menos se puede pagar: 15 s de audio
 * es dos veces y media el costo de los 6 s normales, y el audio de más no se
 * recupera igual, porque `escuchadoHastaMs` salta a `hasta - COLA_MS` al
 * terminar y lo que quedó antes del borde no lo oye nadie nunca. O sea que se
 * paga el triple por tirar lo mismo, y cada pasada tarda más, y el agujero
 * siguiente es más grande: de ahí no se sale.
 *
 * Medido en una sesión de verdad (8 de octubre, 17:42): las pasadas subieron de
 * 2,5 s a 5,9 s sobre 6 s de ventana, la ventana se abrió a 15 s y las pasadas
 * pasaron a 30,7 s y 34,2 s. El transcript dejó de avanzar y quien grababa no
 * se enteró.
 *
 * Así que se ensancha mientras ensanchar gane terreno, y se deja de ensanchar
 * cuando la pasada anterior costó más que el audio que se llevó: eso ya no es
 * un tropiezo, es que no alcanza. El piso es `CONTEXTO_MS`, que es la ventana
 * de siempre y lo mínimo con lo que Whisper acierta.
 */
function topeDeVentana(s) {
    const perdiendoTerreno = s.ultimaPasadaMs > s.ultimaVentanaMs;
    return perdiendoTerreno ? CONTEXTO_MS : VENTANA_MAX_MS;
}

/**
 * El ciclo de señales: escucha lo último y abre o cierra tomas.
 *
 * Nunca corre dos veces a la vez. Whisper tarda algo más de un segundo y el ciclo
 * dispara cada tres, pero si el disco o el modelo se demoran, encadenar dos
 * lecturas del mismo audio duplicaría las palabras y con ellas las señales.
 */
async function buscarSenales(s) {
    // La sesión de ESTA pasada, que llega de la mano y no se busca. Todo lo de
    // abajo espera a Whisper, y mientras tanto la sesión puede terminar, o
    // terminar y arrancar otra: mirando la variable del módulo, una pasada de
    // la sesión A escribía en la B y su `finally` le soltaba el `buscando` a
    // la B. `viva` baja al soltarla (`soltar` en `grabacion.js`), antes de que
    // pueda haber otra.
    if (!s || s.buscando || !s.captura || s.terminando) return;
    const vive = () => s.viva && !s.terminando;
    const hasta = espejo.grabadoHastaMs(s);
    if (hasta - s.escuchadoHastaMs < NUEVO_MIN_MS) return;
    const desde = Math.max(s.captura.desdeMs, hasta - topeDeVentana(s),
        Math.min(s.escuchadoHastaMs - SOLAPE_MS, hasta - CONTEXTO_MS));

    s.buscando = true;
    let listo;
    s.pasada = new Promise(r => { listo = r; });
    const empezoLaPasada = Date.now();
    try {
        // Primero los golpes que quedaron por leer: una claqueta es lo que ancla
        // la sincronía en post y una toma puede esperar tres segundos más.
        await leerCandidatas(s, vive);
        if (!vive()) return;

        residente.asegurar({ idioma: s.estado.idioma || 'es' });
        const oido = await oirTramo(desde, hasta, true, s);
        if (!vive()) return;

        let eventos = [];
        if (oido && oido.palabras.length) {
            // La ventana entera, incluido el solape: quitar acá lo ya oído deshacía
            // el solape justo cuando servía (ver `aplicarSenales`).
            eventos = vivo.aplicarSenales(s.estado, oido.palabras, { firmeHastaMs: hasta - COLA_MS, finMs: hasta });
            for (const ev of eventos) {
                if (ev.tipo === 'cerrada') relecturas.encolar(s, ev.toma);
                // Una «Pausa» que se oyó y no cerró. Al registro y no a la
                // pantalla: quien graba ya se da cuenta —la toma sigue abierta—
                // y lo que hace falta es poder mirar al día siguiente si el
                // profesor siguió hablando o si el umbral está mal puesto.
                if (ev.tipo === 'pausa-corta') {
                    registro.anotar('main', 'senal.pausa-corta', {
                        segundo: Math.round((ev.ms - s.estado.ceroMs) / 100) / 10,
                        huecoSec: ev.huecoSec,
                        pide: vivo.SILENCIO_TRAS_PAUSA_SEC
                    });
                }
            }
            if (eventos.length) espejo.escribir(s);
        }
        relecturas.releerOrillas(s);
        // El estado va en cada pasada y no solo cuando hay una señal: así las
        // palabras de la toma abierta van apareciendo en pantalla, que es lo que
        // dice "esto está oyendo bien" sin tener que esperar a que la toma cierre.
        s.avisar({
            tipo: 'estado',
            estado: espejo.resumen(s),
            eventos,
            oyendo: (oido ? oido.palabras : []).map(w => w.texto).join(' ')
        });
    } catch (err) {
        if (vive()) s.avisar({ tipo: 'error', mensaje: err.message });
    } finally {
        // Lo que esta pasada costó y lo que se llevó, que es de donde sale el
        // tope de la siguiente (ver `topeDeVentana`).
        s.ultimaPasadaMs = Date.now() - empezoLaPasada;
        s.ultimaVentanaMs = hasta - desde;
        // El agujero: audio que quedó entre lo oído y el principio de esta
        // ventana, y que nadie va a oír nunca. Se mide ANTES de avanzar, que es
        // el único momento en que se puede.
        anotarSiSeSalteo(s, desde);
        // Avanza aunque haya fallado: repetir la misma ventana cada vez más
        // larga no la arregla (ver `VENTANA_MAX_MS`).
        s.escuchadoHastaMs = Math.max(s.escuchadoHastaMs, hasta - COLA_MS);
        s.buscando = false;
        anotarSiSeAtraso(s, s.ultimaPasadaMs, s.ultimaVentanaMs);
        listo();
    }
}

/**
 * Cuánto puede tardar una pasada antes de que valga la pena anotarlo.
 *
 * Una pasada tarda medio segundo con el modelo ya cargado y el ciclo dispara
 * cada uno, así que a partir de dos ya se están salteando vueltas: lo que se
 * dice tarda más en aparecer y una señal puede quedarse una vuelta esperando.
 * Es lo que hay que poder mirar al día siguiente cuando alguien dice que tuvo
 * que decir «3, 2, 1» dos veces, y hasta ahora no quedaba registrado en ningún
 * sitio.
 *
 * Se anota de a una cada diez segundos: con el ciclo a un segundo, una GPU
 * ocupada llenaría el diario con la misma noticia.
 */
const PASADA_LENTA_MS = 2 * CICLO_MS;
const ENTRE_AVISOS_MS = 10000;

/**
 * ¿Toca anotar esta noticia, o ya se anotó hace menos de `ENTRE_AVISOS_MS`?
 * Si toca, marca la hora en `s[campo]`.
 */
function tocaAnotar(s, campo) {
    const ahora = Date.now();
    if (s[campo] && ahora - s[campo] < ENTRE_AVISOS_MS) return false;
    s[campo] = ahora;
    return true;
}

const enDecimas = ms => Math.round(ms / 100) / 10;

/**
 * El audio que se salteó, sumado y anotado.
 *
 * Cuando la ventana arranca después de donde se había dejado de oír, el audio
 * del medio no entra en esta pasada y tampoco en la siguiente —`escuchadoHastaMs`
 * ya pasó de largo—, así que no se transcribe nunca. Es la pérdida de verdad del
 * ciclo atrasado, y hasta hoy no quedaba registrada en ningún sitio: en pantalla
 * el transcript simplemente dejaba de crecer.
 *
 * Se guarda sumado en la sesión porque es lo que la barra muestra (ver
 * `atrasoSec` en `espejo.resumen`): no importa que una pasada se saltee medio
 * segundo, importa que en una clase se hayan salteado cuarenta.
 *
 * El total se suma siempre y al diario va de a uno cada diez segundos, igual
 * que `pasada-lenta` y por lo mismo: mientras esto pasa, pasa en cada pasada.
 */
function anotarSiSeSalteo(s, desde) {
    const salteado = desde - s.escuchadoHastaMs;
    if (salteado <= 0) return;
    s.salteadoMs += salteado;
    if (!tocaAnotar(s, 'ultimoSalteoMs')) return;
    registro.anotar('main', 'senal.salteado', {
        salteadoSec: enDecimas(salteado),
        enTotalSec: enDecimas(s.salteadoMs)
    });
}

function anotarSiSeAtraso(s, tardo, ventanaMs) {
    if (tardo < PASADA_LENTA_MS) return;
    if (!tocaAnotar(s, 'ultimaLentaMs')) return;
    registro.anotar('main', 'senal.pasada-lenta', {
        tardoMs: tardo,
        ventanaSec: enDecimas(ventanaMs),
        ciclo: CICLO_MS
    });
}

/**
 * Lee qué se dijo alrededor de cada golpe pendiente y decide si es una claqueta.
 *
 * El pico solo no alcanza —una puerta o un golpe en la mesa miden igual— así que
 * se transcribe alrededor y se busca "claqueta".
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
 * **Un golpe sin la palabra no se anota.** Una claqueta es la palabra Y el
 * aplauso. Anotar los golpes solos «por confirmar» llenaba la lista de
 * claquetas que nadie hizo: cualquier golpe en la mesa o ruido de la llamada.
 * Si el aplauso no se oyó (Zoom lo puede apagar), la palabra sola se avisa en
 * pantalla y la claqueta se pone con la tecla K.
 */
async function leerCandidatas(s, vive) {
    while (vive() && s.candidatas.length) {
        const ms = s.candidatas[0];
        // Todavía no hay audio detrás de este golpe; los que siguen son
        // posteriores, así que tampoco.
        if (espejo.grabadoHastaMs(s) < ms + MARGEN_CLAQUETA_MS) return;
        s.candidatas.shift();

        const leida = await leerClaqueta(ms, s);
        if (!vive()) return;
        // Sin la palabra alrededor, no es una claqueta: un golpe en la mesa, una
        // puerta, un ruido de la llamada. Antes se anotaba «por confirmar».
        if (!leida.confirmada) continue;
        const anotada = vivo.anotarClaqueta(s.estado, leida);
        if (anotada.nueva) {
            s.avisar({ tipo: 'claqueta', claqueta: anotada.claqueta.n, por: 'golpe' });
        }
        espejo.fijar(s);
    }
}

async function leerClaqueta(ms, s) {
    let frase = '';
    try {
        const oido = await oirTramo(ms - MARGEN_CLAQUETA_MS, ms + MARGEN_CLAQUETA_MS, false, s);
        frase = (oido ? oido.palabras : []).map(w => w.texto).join(' ').trim();
    } catch (err) {
        // El golpe se oyó igual: queda anotado sin frase, y se avisa. A ESTA
        // sesión: si terminó mientras se esperaba, avisarle a la del módulo
        // le mandaba a la grabación siguiente el error de la anterior.
        if (s.viva && !s.terminando) s.avisar({ tipo: 'error', mensaje: err.message });
    }
    return {
        ms,
        // La hora de pared de verdad, para poder emparejar la claqueta con la
        // fecha de creación de un archivo de cámara. No se usa para nada del
        // XML: los cuadros salen de `ms`, que es el reloj del audio.
        paredMs: Date.now(),
        frase,
        // La palabra y nada más. «Clase 4» solo confirmaba cualquier ruido
        // cerca de alguien diciendo «en la clase 2 vimos…».
        confirmada: DICE_CLAQUETA.test(frase),
        origen: 'golpe,voz'
    };
}

module.exports = {
    CICLO_MS,
    SOLAPE_MS,
    CONTEXTO_MS,
    NUEVO_MIN_MS,
    COLA_MS,
    VENTANA_MAX_MS,
    MARGEN_CLAQUETA_MS,
    topeDeVentana,
    buscarSenales
};
