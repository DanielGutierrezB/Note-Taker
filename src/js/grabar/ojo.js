'use strict';
/**
 * ojo.js — La cámara de referencia, y el fotograma del instante del OUT.
 *
 * Lo que hace falta: que cada toma guarde una foto de cómo estaba la pantalla
 * del profesor cuando la clase paró, para poder mirarla al retomar o mandársela.
 * El vídeo solo lo puede abrir la ventana (`getUserMedia` vive acá), igual que
 * el micrófono en `oido.js`, así que este archivo es la puerta; guardarla en el
 * disco es del otro lado (`ipc/referencias.js`).
 *
 * **Por qué un anillo de fotogramas y no una foto cuando llega el aviso.** El
 * OUT casi nunca se pone ahora: lo pone «Pausa», y para creerle hacen falta el
 * segundo de silencio de atrás y la pasada de Whisper que lee la palabra, así
 * que el motor avisa de un OUT que ya pasó hace varios segundos. Sacar la foto
 * al enterarse daría la pantalla de después —el profesor ya se movió, ya cambió
 * de slide— que es justo lo que no sirve. Acá se guarda un fotograma cada medio
 * segundo con la hora en que se sacó, y cuando el motor dice «la toma 4 cerró a
 * tal hora» se busca el que estaba más cerca de esa hora.
 *
 * Son unos cincuenta JPEG en memoria —veinte o treinta megas— y un encode por
 * cada medio segundo. Es lo más barato que hace esta app mientras graba.
 *
 * **La cámara es de quien la pida, y se cierra cuando no la usa nadie.** La
 * pantalla de la clase la quiere abierta toda la clase y Ajustes la quiere un
 * rato para la vista previa; con un `cerrar` suelto, salir de Ajustes la habría
 * apagado en medio de una grabación.
 */

/** Cada cuánto se guarda un fotograma, y cuánto pasado se conserva. */
const CADA_MS = 500;
const VENTANA_MS = 25000;

/**
 * Cuánto puede alejarse del OUT el fotograma que se acepta.
 *
 * Medio segundo es el paso del anillo, así que con uno y medio siempre hay
 * candidato si la cámara estaba abierta en ese momento. Más que eso ya sería
 * otra cosa: un OUT que el editor corrió a mano, o una cámara que se abrió
 * después. En esos casos la toma se queda sin foto, que es mejor que una foto
 * de otro momento.
 */
const CERCA_MS = 1500;

/**
 * El tamaño y la compresión de la foto.
 *
 * **Se guarda tal como viene, sin reescalar.** Estuvo a 1280 px «porque es una
 * referencia, no material», y eso era confundir para qué sirve: lo que se mira
 * en esta foto es la pantalla del profesor, y ahí lo que hay que leer es el
 * nombre del archivo que dejó abierto o el renglón de código a medias. Una
 * cámara de 1920 bajada a 1280 pierde un tercio de cada letra, y después el
 * visor la vuelve a estirar a casi 1920 en pantalla Retina: texto chico que no
 * se entiende. El tope solo existe para que un NDI en 4K no llene la memoria.
 *
 * **Y la calidad es alta.** 0.82 es lo correcto para una cara o un plano de
 * clase; sobre texto chico el JPEG a esa calidad embarra los bordes justo donde
 * está la información. A 0.92 un fotograma de pantalla pesa medio mega, así que
 * el anillo son unos veinte o treinta megas mientras la clase corre.
 */
const ANCHO_TOPE = 2560;
const CALIDAD = 0.92;

const estado = {
    nombre: null,
    stream: null,
    video: null,
    lienzo: null,
    reloj: null,
    anillo: [],
    sacando: false,
    duenos: new Set(),
    alCaerse: () => {}
};

/**
 * Las cámaras que hay.
 *
 * Hace falta pedir permiso antes, como con el audio: sin permiso
 * `enumerateDevices` devuelve los dispositivos sin nombre, y el selector
 * quedaría con tres «Cámara» iguales.
 */
export async function camaras() {
    const mirar = async () => (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'videoinput');

    // **Primero se mira, y solo si hace falta se pide.** Abrir `video: true`
    // para leer los nombres tiene un precio que no se ve: deja el dispositivo
    // negociado a 640×480, y el pedido de verdad que viene detrás se encuentra
    // la cámara ya abierta a ese tamaño y lo hereda. Medido en la app: una
    // OBSBOT que da 2560×1440 entraba a 640×480, y una toma de «Yo» —la cámara
    // llenando 1920×1080— salía estirada tres veces. Con el permiso ya dado,
    // que es lo normal después de la primera vez, `enumerateDevices` trae los
    // nombres sin abrir nada.
    let lista = await mirar();
    if (!lista.length || lista.every(d => !d.label)) {
        try {
            const previo = await navigator.mediaDevices.getUserMedia({ video: true });
            for (const track of previo.getTracks()) track.stop();
        } catch (e) {
            return { ok: false, error: 'No se pudo acceder a la cámara: ' + e.message, lista: [] };
        }
        lista = await mirar();
    }
    return {
        ok: true,
        lista: lista.map(d => ({ id: d.deviceId, nombre: d.label || 'Cámara sin nombre' }))
    };
}

/**
 * Pide la cámara para `quien`, abriéndola si no estaba.
 *
 * @param {string} quien   «clase» o «ajustes»: solo para saber si queda alguien
 * @param {string} nombre  el de la cámara elegida en Ajustes
 */
export async function tomar(quien, nombre, avisos) {
    if (!nombre) return { ok: false, error: 'No hay ninguna cámara elegida.' };
    estado.duenos.add(quien);
    if (avisos && avisos.alCaerse) estado.alCaerse = avisos.alCaerse;
    if (estado.stream && estado.nombre === nombre) return { ok: true, nombre };

    await apagar();
    const { ok, lista, error } = await camaras();
    if (!ok) {
        estado.duenos.delete(quien);
        return { ok: false, error };
    }
    const cual = lista.find(c => c.nombre === nombre);
    if (!cual) {
        estado.duenos.delete(quien);
        return { ok: false, error: `No encontré la cámara «${nombre}». Revisá que esté conectada.` };
    }

    let stream;
    try {
        // Se le pide lo más grande que se va a guardar: con `ideal` la cámara
        // da el modo que más se acerque, así que una de 1080 entrega 1080 y una
        // virtual de más entrega más, en lugar de quedar clavada en 1920.
        stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cual.id }, width: { ideal: ANCHO_TOPE } }
        });
    } catch (e) {
        estado.duenos.delete(quien);
        return { ok: false, error: `No se pudo abrir «${nombre}»: ${e.message}` };
    }

    let video;
    try {
        video = document.createElement('video');
        video.className = 'ojo-escondido';
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        document.body.append(video);
        // Puede quedarse en pausa si la ventana está en segundo plano al abrir;
        // cada fotograma la vuelve a empujar.
        await video.play().catch(() => {});
    } catch (e) {
        for (const track of stream.getTracks()) track.stop();
        if (video) video.remove();
        estado.duenos.delete(quien);
        return { ok: false, error: `No se pudo enganchar «${nombre}»: ${e.message}` };
    }

    // Si la cámara se va —el USB desenchufado, el OBS que cerró su cámara
    // virtual— se avisa y se deja de sacar fotos. No se toca la grabación.
    for (const track of stream.getTracks()) {
        track.onended = () => {
            estado.alCaerse(`La cámara «${nombre}» se desconectó: las tomas que sigan no van a tener foto.`);
            apagar();
        };
    }

    Object.assign(estado, { nombre, stream, video, anillo: [] });
    estado.reloj = setInterval(() => { guardarFotograma(); }, CADA_MS);
    guardarFotograma();
    return { ok: true, nombre };
}

/** Deja de usarla; cuando no queda nadie, se apaga. */
export async function soltar(quien) {
    estado.duenos.delete(quien);
    if (!estado.duenos.size) await apagar();
}

export function abierto() {
    return Boolean(estado.stream);
}

export function comoSeLlama() {
    return estado.nombre;
}

/** Para la vista previa de Ajustes, que dibuja este mismo vídeo. */
export function elStream() {
    return estado.stream;
}

/**
 * Un fotograma al anillo, con la hora en que se sacó.
 *
 * La hora se lee ANTES de comprimir: el JPEG tarda unos milisegundos y esa hora
 * es con la que después se busca el OUT.
 */
async function guardarFotograma() {
    const video = estado.video;
    if (!video || estado.sacando) return;
    if (video.paused) { try { await video.play(); } catch (e) { /* se intenta en el siguiente */ } }
    if (video.readyState < 2 || !video.videoWidth) return;

    estado.sacando = true;
    const ms = Date.now();
    try {
        const escala = Math.min(1, ANCHO_TOPE / video.videoWidth);
        const ancho = Math.round(video.videoWidth * escala);
        const alto = Math.round(video.videoHeight * escala);
        const lienzo = estado.lienzo || (estado.lienzo = document.createElement('canvas'));
        if (lienzo.width !== ancho || lienzo.height !== alto) {
            lienzo.width = ancho;
            lienzo.height = alto;
        }
        const pincel = lienzo.getContext('2d');
        // Solo cuenta cuando hay que bajar de 2560: a escala 1 no interpola.
        pincel.imageSmoothingQuality = 'high';
        pincel.drawImage(video, 0, 0, ancho, alto);
        const bytes = await comoJpeg(lienzo);
        if (bytes) estado.anillo.push({ ms, bytes });
        const viejo = Date.now() - VENTANA_MS;
        while (estado.anillo.length && estado.anillo[0].ms < viejo) estado.anillo.shift();
    } catch (e) {
        // Un fotograma que no salió no es nada: viene otro en medio segundo.
    } finally {
        estado.sacando = false;
    }
}

function comoJpeg(lienzo) {
    return new Promise(resuelve => {
        lienzo.toBlob(async blob => {
            if (!blob) return resuelve(null);
            try {
                resuelve(new Uint8Array(await blob.arrayBuffer()));
            } catch (e) {
                resuelve(null);
            }
        }, 'image/jpeg', CALIDAD);
    });
}

/**
 * El fotograma que estaba en pantalla en ese momento, o null si no lo hay.
 *
 * @param {number} ms la hora del OUT, del reloj del motor
 * @returns {Uint8Array|null}
 */
export function fotoDe(ms) {
    if (!Number.isFinite(ms) || !estado.anillo.length) return null;
    let mejor = null;
    for (const f of estado.anillo) {
        const lejos = Math.abs(f.ms - ms);
        if (!mejor || lejos < mejor.lejos) mejor = { f, lejos };
    }
    return mejor && mejor.lejos <= CERCA_MS ? mejor.f.bytes : null;
}

/** Apaga la cámara y tira el anillo, sin mirar quién la tenía pedida. */
async function apagar() {
    if (estado.reloj) clearInterval(estado.reloj);
    if (estado.stream) {
        for (const track of estado.stream.getTracks()) { track.onended = null; track.stop(); }
    }
    if (estado.video) {
        estado.video.srcObject = null;
        estado.video.remove();
    }
    Object.assign(estado, { nombre: null, stream: null, video: null, reloj: null, anillo: [] });
}

/** Para las pruebas y para la maqueta: cuántos fotogramas hay guardados. */
export function cuantosFotogramas() {
    return estado.anillo.length;
}

export default { camaras, tomar, soltar, abierto, comoSeLlama, elStream, fotoDe, cuantosFotogramas };
