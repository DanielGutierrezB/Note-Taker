/**
 * filmar.js — Los dos vídeos del modo semanal, grabados desde la ventana.
 *
 * La ventana es la única que puede abrir una cámara o una pantalla, así que acá
 * viven los dos `MediaRecorder` y nada más: los pedazos se van al proceso
 * principal en cuanto salen (`window.nt.semanalTrozo`) y el disco es cosa de
 * allá (`engine/video-crudo.js`).
 *
 * **La hora que se manda es la de `start()`, no la de `onstart`.** Es el dato
 * que alinea el vídeo con el audio y está medido en el Electron de esta app con
 * un vídeo sintético que cambia de color cada segundo: el primer fotograma del
 * archivo cae a 43 ms de la llamada a `start()`, mientras que el aviso
 * `onstart` llega 294 ms tarde en un grabador y 339 ms en el otro. Con
 * `onstart` como reloj, los dos vídeos quedaban además 45 ms corridos entre sí.
 *
 * **La cámara graba con el micrófono adentro.** La misma pista que alimenta el
 * worklet —la que hace el WAV y todo el oído— entra al grabador de la cámara,
 * así que la voz y los labios los cuadra Chromium y no esta app (medido: unos
 * 70 ms de desfase dentro del archivo). El WAV sigue siendo el de siempre, y es
 * el que se usa para cortar y el repuesto si la cámara no tiene audio.
 */

import * as ojo from './ojo.js';
import * as oido from './oido.js';

/**
 * Cada cuánto suelta `MediaRecorder` un pedazo.
 *
 * Dos segundos. Más corto son más viajes por el puente para nada; más largo es
 * más minutos de grabación que se perderían si la app se cayera, porque un
 * pedazo a medias no llega. Medido: con dos segundos los pedazos van de 50 kB a
 * 400 kB, que cruzan el puente sin que se note.
 */
const CADA_MS = 2000;

/**
 * Los formatos, en el orden en que se quieren.
 *
 * MP4 con H.264 primero, que es lo que ffmpeg abre, busca y recorta sin
 * remuxear nada. Comprobado en el Electron de la app (Chromium 150): acepta los
 * cuatro. El WebM está detrás por si una versión futura deja de aceptar MP4.
 */
const FORMATOS = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus'
];

/** Lo que se le pide a cada vídeo. La pantalla pesa más: es la que se lee. */
const CALIDAD = { pantalla: 8e6, camara: 4e6 };

const estado = {
    pantalla: null,          // el stream de la pantalla, elegido antes de grabar
    grabadores: new Map(),   // cual → MediaRecorder
    alAviso: () => {}
};

function formatoPara(conAudio) {
    const puede = t => window.MediaRecorder && MediaRecorder.isTypeSupported(t);
    // Sin audio no hace falta que el formato declare códec de audio: pedirlo con
    // `mp4a` y no mandar pista deja un archivo con una pista vacía declarada.
    const lista = conAudio ? FORMATOS : FORMATOS.map(t => t.replace(/,\s*(mp4a[^";]*|opus)/, ''));
    return lista.find(puede) || null;
}

/**
 * Abre el selector del sistema y se queda con la pantalla o la ventana elegida.
 *
 * Tiene que venir de un clic: el navegador no deja pedir la pantalla sin que la
 * persona lo haya pedido. Se elige ANTES de grabar, a propósito, para que se
 * vea en la vista previa qué es lo que va a quedar grabado.
 */
export async function elegirPantalla() {
    await soltarPantalla();
    try {
        estado.pantalla = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30 } },
            audio: false
        });
    } catch (e) {
        // Cancelar el selector entra por acá y no es un error que haya que
        // contar como tal: la persona dijo «no», y la pantalla sigue sin elegir.
        const cancelado = /denied|dismissed|abort/i.test(e.name + e.message);
        return cancelado
            ? { ok: false, cancelado: true }
            : { ok: false, error: `No se pudo tomar la pantalla: ${e.message}` };
    }
    const pista = estado.pantalla.getVideoTracks()[0];
    pista.onended = () => {
        // «Dejar de compartir» desde la barra del sistema.
        estado.pantalla = null;
        estado.alAviso({ tipo: 'pantalla-soltada' });
    };
    const puesta = pista.getSettings ? pista.getSettings() : {};
    return {
        ok: true,
        nombre: pista.label || 'la pantalla',
        ancho: puesta.width || null,
        alto: puesta.height || null
    };
}

export function laPantalla() {
    return estado.pantalla;
}

export function tienePantalla() {
    return Boolean(estado.pantalla && estado.pantalla.getVideoTracks().length);
}

export async function soltarPantalla() {
    if (!estado.pantalla) return;
    for (const pista of estado.pantalla.getTracks()) {
        pista.onended = null;
        pista.stop();
    }
    estado.pantalla = null;
}

/**
 * Arranca los dos grabadores.
 *
 * Los dos `start()` van seguidos y sin nada en medio —ni un `await`— porque la
 * distancia entre los dos es el desfase que va a tener el vídeo. Lo que sí va
 * antes es abrir los archivos, que es lo que puede tardar.
 *
 * @returns {Promise<{ok:boolean, error?:string, grabando?:string[]}>}
 */
export async function empezar(avisos) {
    if (avisos && avisos.alAviso) estado.alAviso = avisos.alAviso;

    const pistaDelMicro = oido.laPista();
    const pedidos = [];

    const camara = ojo.elStream();
    if (camara && camara.getVideoTracks().length) {
        pedidos.push({
            cual: 'camara',
            stream: new MediaStream([
                ...camara.getVideoTracks(),
                ...(pistaDelMicro ? [pistaDelMicro] : [])
            ]),
            conAudio: Boolean(pistaDelMicro)
        });
    }
    if (tienePantalla()) {
        pedidos.push({ cual: 'pantalla', stream: estado.pantalla, conAudio: false });
    }
    if (!pedidos.length) return { ok: false, error: 'No hay ni cámara ni pantalla que grabar.' };

    // Primero los archivos, y solo después los `start()`.
    const listos = [];
    for (const pedido of pedidos) {
        const tipo = formatoPara(pedido.conAudio);
        if (!tipo) return { ok: false, error: 'Este Mac no puede grabar vídeo desde la ventana.' };
        let grabador;
        try {
            grabador = new MediaRecorder(pedido.stream, {
                mimeType: tipo,
                videoBitsPerSecond: CALIDAD[pedido.cual]
            });
        } catch (e) {
            return { ok: false, error: `No se pudo preparar el vídeo de ${pedido.cual}: ${e.message}` };
        }
        listos.push({ ...pedido, tipo, grabador });
    }

    const abiertos = [];
    for (const l of listos) {
        // `empezoMs` se manda con la hora de ESTE instante y los `start()` van
        // justo después: entre abrir el archivo y arrancar no hay nada.
        const r = await window.nt.semanalAbrir({ cual: l.cual, tipo: l.tipo, empezoMs: Date.now() });
        if (!r.ok) {
            for (const a of abiertos) a.grabador.stop();
            await window.nt.semanalCerrar();
            return { ok: false, error: r.error };
        }
        abiertos.push(l);
    }

    for (const l of abiertos) {
        l.grabador.ondataavailable = async e => {
            if (!e.data || !e.data.size) return;
            const bytes = new Uint8Array(await e.data.arrayBuffer());
            window.nt.semanalTrozo(l.cual, bytes);
        };
        l.grabador.onerror = e => {
            estado.alAviso({
                tipo: 'roto',
                cual: l.cual,
                error: (e.error && e.error.message) || 'el grabador se detuvo'
            });
        };
        estado.grabadores.set(l.cual, l.grabador);
    }
    // Los dos a la vez. La hora que se mandó arriba es esta, con el error de un
    // `await` de IPC en medio: medido, el primer fotograma cae a 43 ms.
    for (const l of abiertos) l.grabador.start(CADA_MS);

    return { ok: true, grabando: abiertos.map(l => l.cual) };
}

/**
 * Para los dos grabadores y espera a que suelten lo último.
 *
 * Esperar el `onstop` de cada uno no es opcional: `MediaRecorder` entrega en ese
 * momento el pedazo que tenía a medias, y sin él el archivo pierde los últimos
 * segundos, que es justo donde está el final de la última toma.
 */
export async function terminar() {
    const paradas = [...estado.grabadores.values()].map(g => new Promise(listo => {
        if (g.state === 'inactive') return listo();
        g.onstop = listo;
        try { g.stop(); } catch (e) { listo(); }
        return undefined;
    }));
    await Promise.all(paradas);
    estado.grabadores.clear();
    // Los pedazos viajan por `send`, así que el último puede ir todavía en el
    // aire cuando esto vuelve: un turno del bucle de eventos los deja llegar
    // antes de pedir el cierre de los archivos.
    await new Promise(r => setTimeout(r, 50));
    const r = await window.nt.semanalCerrar();
    await soltarPantalla();
    return r;
}

export function grabando() {
    return estado.grabadores.size > 0;
}
