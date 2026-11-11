'use strict';
/**
 * ciclo-senales.js — El ciclo que escucha lo último y abre o cierra tomas.
 *
 * Cada dos segundos oye los últimos seis de audio buscando «3, 2, 1» y «Pausa». Su
 * texto es descartable: de lo que oye solo se le cree la hora (ver la cabecera de
 * `grabacion.js`, «Dos ciclos»).
 *
 * Va aparte de la sesión porque es lo único de ella que corre solo y espera a
 * Whisper, que es donde una sesión puede terminar y otra arrancar mientras se
 * espera. Por eso recibe la sesión en cada pasada y no la busca nunca: la que
 * le dieron es la que mira al volver de cada `await`.
 */

const registro = require('./registro');
const idiomas = require('./idiomas');
const vivo = require('./notas-vivo');
const espejo = require('./espejo');
const residente = require('./oido-residente');
const oirToma = require('./oir-toma');
const relecturas = require('./relecturas');
const cambiosToma = require('./cambios-toma');
const cargaDelSistema = require('./carga-del-sistema');

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
 * **Y la pasada sale cada dos segundos de audio nuevo, no cada uno** (ver
 * `NUEVO_MIN_MS`): el reloj sigue mirando cada segundo, pero no lee hasta que
 * haya dos. Whisper procesa la ventana entera en cada pasada, así que con una
 * por segundo cada segundo de clase se transcribía seis veces: el 10/11, con
 * la Mac libre, el vivo solo llevaba la GPU de 39 % a 87 %, y con una grabación
 * de pantalla al lado ya no alcanzaba. Cada dos, a 67 %, con la misma pasada.
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
const NUEVO_MIN_MS = 2000;
const COLA_MS = 500;

/**
 * Lo nuevo que hace falta para una pasada mientras se relee una toma.
 *
 * La relectura y el vivo comparten la GPU, y en la clase de tres horas un
 * tercio de las pasadas lentas cayó en el minuto en que terminaba una
 * relectura. Mientras corre, el vivo pasa cada tres segundos y no cada dos: la
 * ventana sale un poco más larga —hasta su tope, `topeDeVentana`—, la señal
 * llega un segundo más tarde, y la relectura termina antes.
 */
const NUEVO_MIN_RELEYENDO_MS = 3000;

/**
 * Cuánto audio nuevo pide esta pasada.
 *
 * Sin reloj —la simulación y las pruebas, que empujan el ciclo a mano después
 * de cada pedazo— la cadencia la pone quien empuja: alcanza con que haya algo
 * más que la cola que la pasada anterior dejó sin creer. Con reloj, la de arriba.
 */
function nuevoMinimo(s) {
    if (s.sinReloj) return COLA_MS + 200;
    return s.rehaciendo ? NUEVO_MIN_RELEYENDO_MS : NUEVO_MIN_MS;
}

/**
 * Cuántas pasadas seguidas hacen falta para cambiar de modelo, y con qué.
 *
 * Tres: una pasada lenta pasa sola —un guardado, una relectura que arranca— y
 * no significa nada. Tres seguidas son seis segundos largos sin que el texto
 * avance, y de ahí no se sale solo.
 *
 * **Para volver se pide mucho más que para irse, y no es simetría perdida: es
 * lo único que evita el ida y vuelta.** Con el chico las pasadas son rápidas
 * PORQUE es el chico, así que medirlas contra `PASADA_LENTA_MS` diría «ya está,
 * volvé» a los seis segundos, el grande volvería a ahogarse y el ciclo pasaría
 * la clase saltando de un modelo al otro. Medido en esta Mac libre: con el
 * chico, 572 ms por ventana (whisper-cli lo relanza y carga 487 MB cada vez);
 * con la Mac ocupada, bastante más. Así que por debajo de `VUELVE_MS` la Mac
 * está de verdad libre y recién ahí se vuelve.
 */
const PARA_CAMBIAR_DE_MODELO = 3;
const VUELVE_MS = 800;

/**
 * El modelo grande no da abasto: se oye con el chico hasta que la Mac afloje.
 *
 * **Es la diferencia entre texto peor y texto que no está.** Cuando una pasada
 * tarda más que el audio que se lleva, lo que no entra en esa ventana no lo oye
 * nadie nunca (ver `topeDeVentana` y `senal.salteado`): el 10/11 fueron 14 s de
 * clase sin transcribir, y con ellos las señales que hubiera adentro. El modelo
 * chico lee la misma ventana unas tres veces más rápido, así que el ciclo se
 * pone al día: el texto en vivo sale con más faltas —el bueno lo rehace la
 * relectura igual, que para eso está— pero sigue saliendo, y «3, 2, 1» y
 * «Pausa» se siguen oyendo.
 *
 * No hace falta cambiar nada más para que pase: sin el servidor residente,
 * `oir.escuchar` ya lee con el liviano (`paths.modeloLiviano`). Acá solo se
 * decide no preguntarle al residente mientras dure.
 *
 * **Qué se probó y qué no.** La cuenta de cuándo cambiar y cuándo volver tiene
 * sus pruebas. Lo que no se pudo montar es la situación entera: con la Mac
 * tomada como la toma una grabación de pantalla, el vivo aguanta sin esto
 * —815 ms por pasada y nada de audio salteado— y el cambio ni se dispara; y
 * con tres servidores más saturando la GPU se dispara, pero para entonces ya
 * no hay modelo que alcance (123 s salteados igual). O sea que es una red para
 * el medio de esos dos, que es justo donde estuvo la clase del 10/11, y esa red
 * no se pudo ver atajar. Lo que sí: por debajo no se activa sola.
 */
function mirarSiDaAbasto(s) {
    const cambia = s.apurado
        ? s.ultimaPasadaMs <= VUELVE_MS
        : s.ultimaPasadaMs >= PASADA_LENTA_MS;
    s.seguidas = cambia === Boolean(s.seguidasQueCambian) ? (s.seguidas || 0) + 1 : 1;
    s.seguidasQueCambian = cambia;
    if (!cambia || s.seguidas < PARA_CAMBIAR_DE_MODELO) return;
    const seguidas = s.seguidas;
    s.seguidas = 0;
    s.apurado = !s.apurado;
    const lenta = Boolean(s.apurado);
    registro.anotar('main', lenta ? 'vivo.con-el-chico' : 'vivo.con-el-grande', {
        pasadaMs: s.ultimaPasadaMs, seguidas
    });
    s.avisar({
        tipo: 'error',
        mensaje: lenta
            ? 'La Mac no da abasto: el texto en vivo pasa al modelo liviano para no perder lo que se dice. '
                + 'Sale con más faltas; el del XML lo rehace igual el modelo grande al cerrar cada toma.'
            : 'La Mac aflojó: el texto en vivo vuelve al modelo grande.'
    });
}

/** Un tramo de esta sesión, transcripto (`oir-toma.js` no sabe de sesiones). */
function oirTramo(desdeMs, hastaMs, liviano, s) {
    return oirToma.tramo(espejo.archivosDeLaSesion(s), desdeMs, hastaMs, liviano,
        s.estado.idioma, s.estado.idiomaOido,
        { nuevoDesdeMs: s.escuchadoHastaMs, apurado: Boolean(s.apurado) });
}

/**
 * Qué idioma se está oyendo, después de esta pasada (`idiomas.anotarOido`).
 *
 * Lo que se cree va en el estado —lo ven la barra y el resumen—; el otro idioma
 * que viene sonando sin confirmar va en la sesión, que no se escribe.
 */
function anotarLoQueSuena(s, oido) {
    const r = idiomas.anotarOido(s.estado.idiomaOido, s.rachaOido, oido);
    s.rachaOido = r.racha;
    if (r.oido === s.estado.idiomaOido) return;
    s.estado.idiomaOido = r.oido;
    registro.anotar('main', 'senal.idioma-oido', { oido: r.oido, pedido: s.estado.idioma });
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
    if (hasta - s.escuchadoHastaMs < nuevoMinimo(s)) return;
    const desde = Math.max(s.captura.desdeMs, hasta - topeDeVentana(s),
        Math.min(s.escuchadoHastaMs - SOLAPE_MS, hasta - CONTEXTO_MS));

    s.buscando = true;
    let listo;
    s.pasada = new Promise(r => { listo = r; });
    const empezoLaPasada = Date.now();
    try {
        residente.asegurar({ idioma: s.estado.idioma || 'es' });
        const oido = await oirTramo(desde, hasta, true, s);
        if (!vive()) return;

        if (oido) anotarLoQueSuena(s, oido.oido);

        let eventos = [];
        if (oido && oido.palabras.length) {
            // La ventana entera, incluido el solape: quitar acá lo ya oído deshacía
            // el solape justo cuando servía (ver `aplicarSenales`).
            eventos = vivo.aplicarSenales(s.estado, oido.palabras,
                { firmeHastaMs: hasta - COLA_MS, finMs: hasta, frases: s.frases });
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
            // Las frases de vista, al final y no en el orden de arriba: partir
            // corre los números de las tomas de después, y la cola de arriba
            // ya se encargó de las suyas (`correrLoDeAfuera`).
            for (const ev of eventos) {
                if (ev.tipo !== 'vista') continue;
                ev.hizo = cambiosToma.vistaPorFrase(s, ev);
                registro.anotar('main', 'senal.vista', {
                    segundo: Math.round((ev.desdeMs - s.estado.ceroMs) / 100) / 10,
                    vista: ev.vista,
                    hizo: ev.hizo
                });
            }
            if (eventos.length) espejo.escribir(s);
        }
        // Y la cola de relecturas, que es lo que recoge a las tomas que estaban
        // esperando a que el audio pasara su OUT (ver `hayOrilla`).
        relecturas.atender(s);
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
        mirarSiDaAbasto(s);
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
    // Y quién estaba ocupando la Mac, sin esperarlo (`carga-del-sistema.js`).
    cargaDelSistema.medir()
        .then(carga => registro.anotar('main', 'sistema.carga', carga))
        .catch(() => {});
}

module.exports = {
    CICLO_MS,
    SOLAPE_MS,
    CONTEXTO_MS,
    NUEVO_MIN_MS,
    COLA_MS,
    VENTANA_MAX_MS,
    topeDeVentana,
    mirarSiDaAbasto,
    PARA_CAMBIAR_DE_MODELO,
    VUELVE_MS,
    buscarSenales
};
