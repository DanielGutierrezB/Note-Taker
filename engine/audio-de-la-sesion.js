'use strict';
/**
 * audio-de-la-sesion.js — El WAV de la clase que se está grabando.
 *
 * Abrirlo, escribirle lo que llega, completarlo con silencio si se atrasa, y
 * abrir otro cuando hace falta: otra entrada, la Mac que despertó, un disco que
 * volvió. Y mirar que lo grabado vaya a la par del reloj y que quede disco.
 *
 * Recibe la sesión y no la busca, como `espejo`, `relecturas` y
 * `ciclo-senales`: la sesión es de `grabacion.js`, que es el único que sabe si
 * hay una. De ella toca solo lo del audio —`captura`, `ultimaEntrada`,
 * `dormida`, los WAV cerrados en `estado.sesiones` y `estado.dispositivo`— y
 * nunca tira por no poder guardar las notas: eso lo dice `espejo.guardar`. Un
 * cambio de entrada que tiraba a la mitad dejaba la sesión dormida para siempre
 * y reintentando abrir un WAV con cada pedazo que llegaba.
 */

const captura = require('./captura');
const registro = require('./registro');
const workspace = require('./workspace');
const espejo = require('./espejo');
const cambiosToma = require('./cambios-toma');
const alinearAudio = require('./alinear-audio');
const disco = require('./disco');
const { CICLO_MS } = require('./ciclo-senales');

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

/** Dónde termina el último WAV cerrado de la clase: ahí puede empezar el que sigue. */
function finDelUltimoWav(estado) {
    const ultimo = estado.sesiones[estado.sesiones.length - 1];
    return ultimo ? ultimo.desdeMs + (ultimo.segundos || 0) * 1000 : estado.ceroMs;
}

/**
 * Abre un WAV para la entrada que se pide.
 *
 * **La entrada queda anotada antes de abrir, y acá y en ningún otro lado.** Es
 * la que la ventana está mandando, abra o no: si abrir falla, reintentar tiene
 * que ser con ESA y no con la de antes —otra tasa metida en este WAV sonaría a
 * otra velocidad—, y al reanudar una clase el micrófono es el de hoy y no el
 * de la sesión que quedó abierta, que es con el que la ventana se reengancharía.
 *
 * @param {object} p { dispositivo, sampleRate, canales, desdeMs, noAntesDe, sinReloj }
 */
function abrir(s, p) {
    if (p.dispositivo !== undefined) s.estado.dispositivo = p.dispositivo || null;
    s.ultimaEntrada = { dispositivo: s.estado.dispositivo || null, sampleRate: p.sampleRate, canales: p.canales };
    const info = captura.abrir({
        dir: workspace.audioDir(s.dir),
        nombre: s.estado.secuencia,
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
    s.captura = { ...info, segundos: 0, alinear: p.sinReloj ? null : alinearAudio.nuevo() };
    s.ultimaEntrada.sampleRate = info.sampleRate;
    s.ultimaEntrada.canales = info.canales;
    s.escuchadoHastaMs = info.desdeMs;
    return info;
}

/**
 * Cierra el WAV que se está escribiendo y lo suma a los de la clase. En su
 * último audio y no ahora: la hora de ahora puede ser segundos después —una
 * entrada nueva que tarda en abrir, una relectura que se espera al terminar—.
 */
function cerrarCaptura(s) {
    const cap = s.captura;
    if (!cap) return null;
    s.captura = null;
    const cerrada = captura.cerrar(cap.id, cap.ultimoPcmMs || Date.now());
    if (!cerrada) return null;
    const { error, ...wav } = cerrada;
    if (error) registro.anotar('main', 'captura.no-cerro', { archivo: wav.archivo, error });
    s.estado.sesiones.push(wav);
    return wav;
}

/**
 * El PCM que llega, al WAV.
 *
 * @param {string} [origen] 'ventana' para el micrófono. Ese es el que se
 *   completa con silencio si se atrasa (`alinear-audio.js`); el de Zoom y el
 *   del sistema ya lo hace su ayudante, y hacerlo dos veces sería poner el
 *   mismo hueco dos veces.
 */
function escribir(s, buffer, origen) {
    // Sin WAV —abrir el de después de dormir falló— o con la Mac yéndose a
    // dormir: lo que llega no tiene dónde ir. Antes se tiraba callado; ahora se
    // cuenta y se dice, y el ciclo vuelve a intentar abrir (`reintentar`).
    if (s.dormida && Date.now() - s.dormidaMs > 3000) {
        // Llega audio con la Mac despierta y el aviso de despertar no vino (o
        // todavía no): se despierta desde acá, que si no la clase quedaría
        // tirando el audio para siempre.
        despertar(s);
    }
    if (!s.captura || s.dormida) {
        if (!s.terminando && !s.dormida) sinDondeEscribir(s);
        return null;
    }
    const cap = s.captura;
    let r;
    try {
        r = captura.escribir(cap.id, buffer);
        cap.erroresSeguidos = 0;
    } catch (err) {
        soltarSiMurio(s, cap);
        throw err;
    }
    cap.segundos = r.segundos;
    // Hasta cuándo llegó audio a este WAV: es su final (`cerrarCaptura`).
    cap.ultimoPcmMs = Date.now();
    if (origen === 'ventana' && cap.alinear) {
        const ahora = Date.now();
        const faltaMs = alinearAudio.mirar(cap.alinear, (ahora - cap.desdeMs) - cap.segundos * 1000, ahora);
        if (faltaMs > 0) r = rellenar(s, cap, faltaMs);
    }
    return r;
}

/** Escribe `ms` de silencio donde va el próximo pedazo, y lo deja dicho. */
function rellenar(s, cap, ms) {
    const canales = cap.canales || 1;
    const muestras = Math.round(ms / 1000 * (cap.sampleRate || 48000));
    const r = captura.escribir(cap.id, Buffer.alloc(muestras * canales * 2));
    cap.segundos = r.segundos;
    registro.anotar('main', 'grabacion.relleno', { ms, segundos: cap.segundos });
    // Un tropiezo de un cuarto de segundo no amerita un cartel; uno de más de
    // un segundo sí, que es audio de la clase que no está.
    if (ms >= 1000) {
        s.avisar({
            tipo: 'error',
            mensaje: `No llegó audio por ${(ms / 1000).toFixed(1).replace('.', ',')} s: se completó con silencio `
                + 'para que los marcadores no se corran.'
        });
    }
    return r;
}

/**
 * Lo que llega sin WAV abierto: se avisa una vez cada medio minuto, y queda la
 * hora, que es lo que dice que la ventana sigue mandando (`reintentar`).
 */
function sinDondeEscribir(s) {
    s.tiradosSinWav = (s.tiradosSinWav || 0) + 1;
    const ahora = Date.now();
    s.tiradoMs = ahora;
    if (s.dormida || ahora - (s.avisoSinWavMs || 0) < 30000) return;
    s.avisoSinWavMs = ahora;
    registro.anotar('main', 'grabacion.sin-wav', { tirados: s.tiradosSinWav });
    s.avisar({
        tipo: 'error',
        mensaje: 'El audio no se está guardando: no se pudo abrir el archivo de audio de la clase. '
            + 'Se sigue intentando; si la carpeta está en un disco externo o en un Drive, revisá que esté.'
    });
}

/** Cuánto hace que llegó el último pedazo sin WAV, para creer que sigue llegando. */
const LLEGANDO_MS = 2000;

/**
 * Sin WAV y con la clase en pie, se vuelve a intentar abrir uno cada cinco
 * segundos con la entrada que la ventana está mandando. Pasa cuando abrir el de
 * después de dormir falló porque el disco de la carpeta todavía no había
 * vuelto: sin esto, el resto de la clase quedaba sin audio hasta que alguien
 * eligiera otra entrada.
 *
 * **Solo si el audio está llegando.** Cuando el motor rechaza una entrada nueva
 * la ventana deja de mandar (`mandarAlMotor` en `pantalla-preparar.js`), y
 * abrir un WAV para nadie decía «el audio se vuelve a guardar» sin que se
 * guardara nada.
 */
function reintentar(s) {
    if (s.captura || s.terminando || !s.ultimaEntrada) return;
    const ahora = Date.now();
    if (ahora - (s.reintentoMs || 0) < 5000) return;
    if (ahora - (s.tiradoMs || 0) > LLEGANDO_MS) return;
    s.reintentoMs = ahora;
    const r = cambiarEntrada(s, s.ultimaEntrada);
    if (r.ok) {
        registro.anotar('main', 'grabacion.audio-volvio', { tirados: s.tiradosSinWav || 0 });
        s.avisar({ tipo: 'error', mensaje: 'El audio se vuelve a guardar, en un WAV nuevo desde ahora.' });
    }
}

/**
 * Un WAV que falla dos segundos seguidos se da por muerto: el disco externo se
 * desenchufó o el Drive se trabó, y ese archivo abierto no vuelve a servir
 * aunque el disco vuelva. Se cierra y queda sin WAV, y `reintentar` abre otro
 * cada cinco segundos hasta que se pueda. Antes cada pedazo seguía fallando
 * contra el mismo archivo hasta el final de la clase.
 */
const ERRORES_PARA_SOLTAR = 24;
function soltarSiMurio(s, cap) {
    cap.erroresSeguidos = (cap.erroresSeguidos || 0) + 1;
    if (cap.erroresSeguidos < ERRORES_PARA_SOLTAR || s.captura !== cap) return;
    cerrarCaptura(s);
    s.reintentoMs = Date.now();
    registro.anotar('main', 'grabacion.wav-muerto', { archivo: cap.archivo });
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
 * La toma abierta se parte en el cambio (`cambiosToma.pasarAOtroAudio`). Abra o
 * no, la sesión deja de estar dormida: si no abrió, lo que llegue se cuenta y
 * se reintenta (`sinDondeEscribir`, `reintentar`).
 *
 * @param {{dispositivo:string, sampleRate:number, canales:number}} params
 */
function cambiarEntrada(s, params) {
    // Sin `captura` también: si abrir el WAV nuevo falló la vez anterior, la
    // clase sigue en pie sin audio y lo que hace falta es justamente otra
    // entrada.
    if (!s || !s.viva || s.terminando) {
        return { ok: false, error: 'No hay una clase grabando.', estado: null };
    }
    const p = params || {};
    const tasa = Number(p.sampleRate);
    if (!(tasa >= 8000 && tasa <= 192000)) {
        return { ok: false, error: 'La entrada nueva no dijo a qué tasa suena.', estado: espejo.resumen(s) };
    }
    const vieja = cerrarCaptura(s);
    const finDelViejo = finDelUltimoWav(s.estado);
    s.dormida = false;
    let nueva;
    try {
        nueva = abrir(s, {
            dispositivo: p.dispositivo || null,
            sampleRate: tasa,
            canales: Number(p.canales) || 1,
            noAntesDe: finDelViejo,
            desdeMs: p.desdeMs
        });
    } catch (err) {
        registro.anotar('main', 'grabacion.otra-entrada-falla', { error: err.message });
        espejo.guardar(s);
        return { ok: false, error: `No pude abrir el audio nuevo: ${err.message}`, estado: espejo.resumen(s) };
    }
    const toma = cambiosToma.pasarAOtroAudio(s, finDelViejo, nueva.desdeMs);
    // El atraso se mide desde el WAV nuevo: el viejo ya no corre.
    s.derivaAvisada = 0;
    registro.anotar('main', 'grabacion.otra-entrada', {
        dispositivo: s.estado.dispositivo,
        sampleRate: tasa,
        antes: vieja ? { sampleRate: vieja.sampleRate, segundos: vieja.segundos } : null,
        huecoMs: Math.max(0, Math.round(nueva.desdeMs - finDelViejo)),
        toma
    });
    espejo.guardar(s);
    return { ok: true, toma, estado: espejo.resumen(s) };
}

/**
 * Cierra el WAV y abre otro con la misma entrada, desde ahora.
 *
 * Es lo que hace falta después de que la Mac durmió: el reloj siguió y el
 * archivo no, y seguir en el mismo correría contra la cámara todo lo que se
 * grabe después. Es un cambio de entrada a la misma entrada.
 */
function reabrir(s, motivo) {
    if (s.terminando) return null;
    const c = s.captura || s.ultimaEntrada || {};
    const r = cambiarEntrada(s, { dispositivo: s.estado.dispositivo, sampleRate: c.sampleRate, canales: c.canales });
    if (r.ok && motivo) s.avisar({ tipo: 'error', mensaje: motivo });
    // Si no abrió, se dice: antes la falla era callada y el resto de la clase
    // quedaba sin audio. El ciclo lo vuelve a intentar (`reintentar`).
    if (!r.ok) {
        registro.anotar('main', 'grabacion.no-reabrio', { motivo, error: r.error });
        s.avisar({ tipo: 'error', mensaje: `${r.error} Se vuelve a intentar en unos segundos.` });
    }
    return r;
}

/** La Mac se va a dormir: lo que llegue hasta despertar no es de la clase. */
function dormir(s) {
    if (s.terminando) return;
    s.dormida = true;
    s.dormidaMs = Date.now();
}

const AL_DESPERTAR = 'La Mac se durmió: lo de ese rato no se grabó. El audio sigue en un WAV nuevo, en su hora.';

/**
 * La Mac despertó: lo que se grabe va a un WAV nuevo en su hora. Lo llaman el
 * aviso de despertar y el primer audio que llega después de dormir, el que
 * llegue antes; el segundo no vuelve a abrir otro.
 */
function despertar(s) {
    if (s.terminando) return null;
    if (!s.dormida && s.despertoMs && Date.now() - s.despertoMs < 10000) return null;
    s.despertoMs = Date.now();
    return reabrir(s, AL_DESPERTAR);
}

/**
 * Cuánto se puede atrasar el audio grabado contra el reloj antes de avisar, y de
 * a cuánto se vuelve a avisar si sigue creciendo.
 */
const DERIVA_AVISO_MS = 2000;

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
function vigilarDeriva(s) {
    if (!s.captura || s.terminando) return;
    // Una vuelta que llega tarde es un proceso que estuvo trabado, y el audio de
    // ese rato está todavía en camino: medir ahora es ver un atraso que en un
    // momento se pone al día. Se mide en la vuelta siguiente.
    const ahoraMs = Date.now();
    const tarde = s.ultimaVueltaMs && ahoraMs - s.ultimaVueltaMs > CICLO_MS * 2;
    s.ultimaVueltaMs = ahoraMs;
    if (tarde) return;
    const deriva = (Date.now() - s.captura.desdeMs) - s.captura.segundos * 1000;
    const escalon = Math.floor(deriva / DERIVA_AVISO_MS);
    if (!tocaAvisarDeriva(escalon, s.derivaAvisada || 0)) return;
    s.derivaAvisada = escalon;
    registro.anotar('main', 'grabacion.deriva', {
        derivaMs: Math.round(deriva),
        segundos: s.captura.segundos,
        sampleRate: s.captura.sampleRate || null
    });
    s.avisar({
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
 * Cuántos minutos de disco quedan, mirado cada medio minuto.
 *
 * Se avisa al cruzar cada uno de estos umbrales, una vez: una hora alcanza para
 * terminar una clase normal y es lo primero que conviene saber; cinco minutos
 * es lo último que se puede hacer algo.
 */
const AVISOS_DE_DISCO_MIN = [60, 30, 10, 5];
const MIRAR_EL_DISCO_MS = 30000;

function vigilarDisco(s) {
    if (!s.captura || s.terminando) return;
    const ahora = Date.now();
    if (ahora - (s.discoMiradoMs || 0) < MIRAR_EL_DISCO_MS) return;
    s.discoMiradoMs = ahora;
    const r = disco.revisar(workspace.audioDir(s.dir), s.captura);
    if (!r.escribible) {
        if (s.discoSinEscribir) return;
        s.discoSinEscribir = true;
        registro.anotar('main', 'disco.no-escribe', { error: r.error });
        s.avisar({ tipo: 'error', mensaje: `No se puede escribir en la carpeta de la clase: ${r.error}` });
        return;
    }
    s.discoSinEscribir = false;
    if (r.minutos == null) return;
    const cruzado = AVISOS_DE_DISCO_MIN.filter(u => r.minutos <= u).pop();
    if (cruzado == null || (s.discoAvisado != null && cruzado >= s.discoAvisado)) return;
    s.discoAvisado = cruzado;
    registro.anotar('main', 'disco.poco', { minutos: r.minutos });
    s.avisar({
        tipo: 'error',
        mensaje: `Quedan unos ${r.minutos} min de disco para el audio de esta clase. Liberá espacio `
            + 'ya: con el disco lleno el audio deja de escribirse.'
    });
}

module.exports = {
    anclaDe,
    finDelUltimoWav,
    abrir,
    cerrarCaptura,
    escribir,
    reintentar,
    cambiarEntrada,
    reabrir,
    dormir,
    despertar,
    vigilarDeriva,
    tocaAvisarDeriva,
    vigilarDisco
};
