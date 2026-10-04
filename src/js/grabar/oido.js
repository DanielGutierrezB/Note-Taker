'use strict';
/**
 * oido.js — Abrir el micrófono y mandar el audio.
 *
 * La ventana es la única que puede abrir un dispositivo de audio
 * (`getUserMedia` vive acá), así que este archivo es la puerta: abre la entrada
 * elegida y manda el PCM al motor. De paso mide el nivel, que es lo único que
 * dice "está entrando audio" antes de que alguien hable.
 *
 * Encontrar el aplauso de una claqueta NO es de acá aunque las muestras pasen
 * por este archivo: la regla vive en `engine/golpe.js`, del lado que escribe el
 * WAV. Ahí se la puede probar pasándole el audio de una clase de verdad, y de
 * este lado solo se podría probar aplaudiendo delante del micrófono.
 *
 * **Se abre la entrada apenas se elige, en la pantalla de Preparar**, no al
 * apretar "Iniciar grabación", y el medidor se mueve desde ese momento. Es
 * para poder ver que el audio del Zoom está llegando ANTES de comprometerse:
 * descubrir que entraba el micrófono de la Mac después de la primera toma es
 * exactamente lo que esto evita.
 *
 * El audio, en cambio, se manda recién al apretar "Iniciar". No es una falta:
 * antes de ese botón no hay a qué referirlo, porque el cero del XML es ese
 * botón.
 */

const CANAL_UNICO = 1;

const estado = {
    contexto: null,
    stream: null,
    nodo: null,
    fuente: null,
    dispositivo: null,
    sampleRate: 48000,
    // A quién avisarle. Lo pone la vista.
    alNivel: () => {},
    alCaerse: () => {},
    // El audio solo se manda cuando la grabación está armada; escuchar arranca
    // antes, para no perderse la claqueta.
    mandando: false
};

/**
 * Las entradas que hay.
 *
 * Hace falta pedir permiso antes: sin permiso, `enumerateDevices` devuelve los
 * dispositivos sin nombre y el selector queda con tres "Micrófono" iguales.
 */
export async function entradas() {
    try {
        const previo = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of previo.getTracks()) track.stop();
    } catch (e) {
        return { ok: false, error: 'No se pudo acceder al audio: ' + e.message, lista: [] };
    }
    const todos = await navigator.mediaDevices.enumerateDevices();
    const lista = todos
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ id: d.deviceId, nombre: d.label || 'Entrada sin nombre' }));
    return { ok: true, lista };
}

/**
 * Abre una entrada y empieza a escuchar.
 *
 * Sin procesado de ninguna clase: el cancelador de eco, el control automático de
 * ganancia y el supresor de ruido están hechos para una llamada, y acá arruinan
 * las dos cosas que importan. El automático de ganancia sube el fondo en los
 * silencios, que es justo cuando la claqueta tiene que destacar; el supresor se
 * come los transitorios, que es lo que la claqueta ES.
 */
export async function abrir(deviceId, avisos) {
    await cerrar();
    Object.assign(estado, avisos || {});

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: CANAL_UNICO
            }
        });
    } catch (e) {
        return { ok: false, error: 'No se pudo abrir esa entrada: ' + e.message };
    }

    // A 48 kHz fijos, como el audio de Zoom. Sin decirlo, el contexto toma la
    // tasa de la salida del sistema en ese momento: con unos AirPods en modo
    // llamada, 16 o 24 kHz, y los pedazos de 4096 muestras pasaban a durar el
    // doble o el triple, que es con lo que `golpe.js` mide si hubo un aplauso.
    const contexto = new AudioContext({ sampleRate: 48000 });
    try {
        await contexto.audioWorklet.addModule('js/grabar/pcm-worklet.js');
    } catch (e) {
        await contexto.close();
        for (const t of stream.getTracks()) t.stop();
        return { ok: false, error: 'No cargó el capturador de audio: ' + e.message };
    }

    // Armar el grafo también puede fallar, y hasta acá no se atrapaba: la
    // excepción salía por arriba de `abrir`, así que quien llamaba no recibía
    // su `{ok:false}` y encima el contexto y el stream quedaban abiertos —el
    // micrófono prendido, sin nadie escuchando—. Es el mismo trato que el
    // `getUserMedia` de arriba, que sí lo tenía.
    let fuente;
    let nodo;
    try {
        fuente = contexto.createMediaStreamSource(stream);
        nodo = new AudioWorkletNode(contexto, 'pcm-processor');
        nodo.port.onmessage = e => recibir(e.data);
        fuente.connect(nodo);
        // El nodo no va a los parlantes: conectarlo daría realimentación con el
        // micrófono abierto. Un `AudioWorkletNode` sin salida igual procesa.
    } catch (e) {
        await contexto.close();
        for (const t of stream.getTracks()) t.stop();
        return { ok: false, error: 'No se pudo enganchar esa entrada: ' + e.message };
    }

    // Si el dispositivo se va —el USB desenchufado, el Zoom que cerró su
    // salida virtual—, el track avisa. Se enciende el estado rojo y nada de lo
    // escrito se pierde: el WAV tiene su cabecera al día en cada pedazo, y
    // reconectar abre otro WAV que entra en su offset (`captura.js`).
    for (const track of stream.getTracks()) {
        track.onended = () => estado.alCaerse();
    }

    Object.assign(estado, {
        contexto, stream, nodo, fuente,
        dispositivo: deviceId || 'por defecto',
        sampleRate: contexto.sampleRate
    });
    return { ok: true, sampleRate: contexto.sampleRate, canales: CANAL_UNICO };
}

/**
 * Un pedazo de PCM: se manda y se mide el nivel.
 *
 * Se manda PRIMERO. Si medir tirara una excepción, el audio ya salió — y lo que
 * se está grabando no se puede repetir.
 *
 * El nivel que se calcula acá es para el medidor y nada más. Quién decide si un
 * pedazo fue el aplauso de la claqueta es el motor (`engine/golpe.js`), que ve
 * este mismo audio al escribirlo: teniendo la regla de un solo lado se la puede
 * probar contra el Live-Mix de una clase de verdad, y de este lado solo se podía
 * probar aplaudiendo delante del micrófono.
 */
function recibir(muestras) {
    if (estado.mandando) window.nt.grabarPcm(muestras);

    let pico = 0;
    for (let i = 0; i < muestras.length; i++) {
        const v = Math.abs(muestras[i]) / 32768;
        if (v > pico) pico = v;
    }
    estado.alNivel(pico);
}

/** Desde acá se manda el audio al motor. Antes solo se escuchaba. */
export function empezarAMandar() { estado.mandando = true; }
export function dejarDeMandar() { estado.mandando = false; }

export function escuchando() { return Boolean(estado.contexto); }

/**
 * La pista del micrófono, para quien necesite grabarla además de oírla.
 *
 * La usa el modo semanal: la misma pista entra al worklet —que es de donde sale
 * el WAV y todo el oído— y al grabador del vídeo de la cámara, y así Chromium
 * muxea la voz junto con la cara y los labios quedan cuadrados por
 * construcción. Una pista puede estar en dos sitios a la vez sin abrir el
 * dispositivo dos veces; abrirlo dos veces es lo que no se puede.
 */
export function laPista() {
    return estado.stream ? estado.stream.getAudioTracks()[0] || null : null;
}

/** Con qué se está capturando, que es lo que el WAV tiene que declarar. */
export function comoSuena() {
    return {
        dispositivo: estado.dispositivo,
        sampleRate: estado.sampleRate,
        canales: CANAL_UNICO
    };
}

export async function cerrar() {
    estado.mandando = false;
    if (estado.nodo) {
        estado.nodo.port.onmessage = null;
        try { estado.nodo.disconnect(); } catch (e) { /* ya estaba */ }
    }
    if (estado.fuente) { try { estado.fuente.disconnect(); } catch (e) { /* ya estaba */ } }
    if (estado.stream) {
        for (const track of estado.stream.getTracks()) { track.onended = null; track.stop(); }
    }
    if (estado.contexto) { try { await estado.contexto.close(); } catch (e) { /* ya estaba */ } }
    Object.assign(estado, { contexto: null, stream: null, nodo: null, fuente: null });
}

