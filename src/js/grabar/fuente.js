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
 * **El audio que no viene de un micrófono va primero en la lista, y no por
 * gusto.** En el escenario de esta app la clase llega por una llamada y quien
 * toma notas la escucha con auriculares, así que ningún micrófono la oye. La
 * opción que sirve tiene que ser la que se ve primero, y la que se elige sola.
 */

import * as oido from './oido.js';
import { avisar } from '../chrome.js';

/**
 * Las dos entradas que no son dispositivos, y por eso no tienen un id suyo.
 *
 * **La del sistema va primera.** Graba lo que salga por los altavoces venga de
 * donde venga —Zoom, Meet, un vídeo— y, sobre todo, **no se engancha a ningún
 * proceso ajeno**: el tap de Zoom se cuelga de los procesos de Zoom que haya
 * en ese momento, y eso es tanto un punto de contacto con una app que no es
 * nuestra como algo que se rompe solo si Zoom se reinicia. El precio es que
 * también entra lo demás que suene en la Mac, y por eso se dice en la lista.
 *
 * La de Zoom se queda: graba la llamada y nada más, que cuando se puede es
 * mejor.
 */
export const SISTEMA = {
    id: 'app:sistema',
    nombre: 'Audio del sistema (Zoom, Meet, lo que suene)',
    tipo: 'app',
    modo: 'sistema'
};
export const ZOOM = {
    id: 'app:zoom',
    nombre: 'Audio de Zoom (solo la llamada)',
    tipo: 'app',
    modo: 'app'
};

let tipo = null;
let info = { dispositivo: null, sampleRate: 48000, canales: 1 };
let avisos = { alNivel: () => {}, alCaerse: () => {}, alVolver: () => {}, alRomperse: () => {} };
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
        if (aviso.tipo === 'vuelve') avisos.alVolver();
        // Los dos los resuelve el motor solo (`engine/audio-app.js`): se dicen
        // para que queden a la vista, no para que alguien haga algo.
        if (aviso.tipo === 'rearmada') avisar(aviso.mensaje);
        // Este no lo resuelve el motor solo del todo: dejó de llegar audio
        // durante diez segundos y se está reabriendo la escucha. Se dice para
        // que quien graba sepa que ese pedazo de la clase va a salir en
        // silencio, y pueda repetirlo si era importante.
        if (aviso.tipo === 'relanzando') avisar(aviso.mensaje, 'error');
        if (aviso.tipo === 'relleno') {
            avisar(`No llegó audio de Zoom por ${aviso.segundos} s: se completó con silencio ` +
                'para que el WAV no se atrase contra la cámara.', 'error');
        }
        // Y este no lo resuelve nadie. El pedazo que reventó al procesarse NO
        // se escribió: al WAV le falta ese trozo y todo lo que viene detrás
        // queda corrido contra la cámara. Es lo peor que puede pasar en medio
        // de una clase y hasta ahora no se veía en ninguna parte — el ayudante
        // seguía vivo, el medidor seguía moviéndose y el editor se enteraba al
        // abrir el XML. No va a una tostada y nada más: va al estado del audio,
        // que es lo que se queda a la vista (ver `alRomperse` en
        // `pantalla-preparar.js` y `deSesion` en `estados.js`).
        if (aviso.tipo === 'error') avisos.alRomperse(aviso.mensaje);
    });
}

/**
 * El motor avisa que un pedazo del PCM del MICRÓFONO reventó al procesarse.
 *
 * Es el mismo agujero que el `error` de Zoom de acá arriba —lo que reventó no
 * llegó al WAV y todo lo de atrás queda corrido contra la cámara— y por eso va
 * a la misma pastilla. Lo que cambia es de dónde viene: el de Zoom lo grita el
 * motor por su canal y este viaja por `grabar-aviso`, que lo atiende la
 * pantalla En vivo, así que entra por acá en vez de por el enganche.
 *
 * La cuenta viene hecha del otro lado: allá los pedazos revientan de a doce
 * por segundo y el puente los junta antes de cruzar (ver `ipc/grabar.js`).
 */
export function seRompio(mensaje, veces) {
    avisos.alRomperse(mensaje, veces);
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
    // Las dos del ayudante van juntas y las dos dependen de lo mismo: que el
    // ayudante corra, o sea macOS 14.2 o más. La del sistema no necesita que
    // ninguna app esté abierta; la de Zoom sí, pero igual se ofrece para poder
    // decir por qué no anda.
    const delAyudante = zoom && zoom.soportado ? [SISTEMA, ZOOM] : [];
    return {
        ok: dispositivos.ok,
        error: dispositivos.error,
        zoom: zoom || { soportado: false },
        lista: delAyudante.concat(lista)
    };
}

/**
 * Abre una entrada y empieza a medir. Todavía no graba: el audio se manda
 * recién con `empezarAMandar`, que es el botón de Iniciar.
 */
export async function abrir(entrada, losAvisos) {
    await cerrar();
    avisos = {
        alNivel: () => {}, alCaerse: () => {}, alVolver: () => {}, alRomperse: () => {},
        ...(losAvisos || {})
    };

    if (entrada && entrada.tipo === 'app') {
        engancharZoom();
        const r = await window.nt.audioAppAbrir({ modo: entrada.modo || 'app' });
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
