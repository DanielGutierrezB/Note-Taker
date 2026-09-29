/**
 * fuente.js — De dónde sale el audio, sea cual sea.
 *
 * Hay dos fuentes y viven en lados distintos. Un micrófono o una interfaz los
 * abre la ventana (`oido.js`), porque `getUserMedia` vive acá. El sonido de
 * Zoom lo abre Node con un ayudante nativo (`engine/audio-app.js`), porque la
 * ventana no puede escuchar a otra app. Este archivo las junta detrás de las
 * mismas cinco funciones, así las pantallas no preguntan nunca cuál es: abren,
 * miden, empiezan a mandar y cierran.
 *
 * **El audio de Zoom va primero en la lista, y no por gusto.** En el escenario
 * de esta app la clase llega por una llamada y quien toma notas la escucha con
 * auriculares, así que ningún micrófono la oye. La opción que sirve tiene que
 * ser la que se ve primero, y la que se elige sola si Zoom está abierto.
 */

import * as oido from './oido.js';

/** La entrada de Zoom, que no es un dispositivo y por eso no tiene un id suyo. */
export const ZOOM = { id: 'app:zoom', nombre: 'Audio de Zoom (la llamada)', tipo: 'app' };

let tipo = null;
let info = { dispositivo: null, sampleRate: 48000, canales: 1 };
let avisos = { alNivel: () => {}, alCaerse: () => {} };
let escuchandoZoom = false;

// El canal de Zoom se escucha una sola vez: `onAudioApp` agrega un oyente cada
// vez que se lo llama, y con uno por cada apertura el nivel llegaría repetido.
let enganchado = false;
function engancharZoom() {
    if (enganchado || !window.nt.onAudioApp) return;
    enganchado = true;
    window.nt.onAudioApp(aviso => {
        if (!escuchandoZoom || !aviso) return;
        if (aviso.tipo === 'nivel') avisos.alNivel(aviso.pico);
        if (aviso.tipo === 'caido') avisos.alCaerse();
    });
}

/**
 * Las entradas que hay: Zoom primero, después los dispositivos.
 *
 * @returns {Promise<{ok:boolean, lista:Array, zoom:object, error?:string}>}
 */
export async function entradas() {
    const [dispositivos, zoom] = await Promise.all([
        oido.entradas(),
        window.nt.audioAppEstado ? window.nt.audioAppEstado() : Promise.resolve({ soportado: false })
    ]);
    const lista = (dispositivos.lista || []).map(d => ({ ...d, tipo: 'dispositivo' }));
    return {
        ok: dispositivos.ok,
        error: dispositivos.error,
        zoom: zoom || { soportado: false },
        lista: (zoom && zoom.soportado ? [ZOOM] : []).concat(lista)
    };
}

/**
 * Abre una entrada y empieza a medir. Todavía no graba: el audio se manda
 * recién con `empezarAMandar`, que es el botón de Iniciar.
 */
export async function abrir(entrada, losAvisos) {
    await cerrar();
    avisos = { alNivel: () => {}, alCaerse: () => {}, ...(losAvisos || {}) };

    if (entrada && entrada.tipo === 'app') {
        engancharZoom();
        const r = await window.nt.audioAppAbrir();
        if (!r.ok) return r;
        tipo = 'app';
        escuchandoZoom = true;
        info = { dispositivo: entrada.nombre, sampleRate: r.sampleRate, canales: r.canales || 1 };
        return { ok: true, sampleRate: info.sampleRate, canales: info.canales };
    }

    const r = await oido.abrir(entrada && entrada.id, avisos);
    if (!r.ok) return r;
    tipo = 'dispositivo';
    info = { ...oido.comoSuena(), dispositivo: entrada ? entrada.nombre : null };
    return r;
}

export function empezarAMandar() {
    if (tipo === 'app') return window.nt.audioAppMandar(true);
    return oido.empezarAMandar();
}

export function dejarDeMandar() {
    if (tipo === 'app') return window.nt.audioAppMandar(false);
    return oido.dejarDeMandar();
}

/** Con qué se está capturando, que es lo que el WAV tiene que declarar. */
export function comoSuena() {
    return { ...info };
}

export async function cerrar() {
    if (tipo === 'app') {
        escuchandoZoom = false;
        await window.nt.audioAppCerrar();
    } else if (tipo === 'dispositivo') {
        await oido.cerrar();
    }
    tipo = null;
}
