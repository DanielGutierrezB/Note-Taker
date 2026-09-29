/**
 * doble.js — Las dos puertas por las que la ventana habla con el mundo,
 * falseadas: `window.nt` (el puente con Node) y el micrófono.
 *
 * Es lo ÚNICO que la maqueta falsea. Todo lo demás —el HTML, el CSS, las cuatro
 * pantallas, los iconos, el vocabulario de estados, el timecode— es el código
 * que se publica, sin una línea duplicada. Por eso sirve para mirar el diseño:
 * si acá se ve bien, se ve bien.
 *
 * El escenario se elige por la URL y se aplica DESPUÉS de que la app arranca:
 * `app.js` se cablea solo, dibuja Sesiones, y recién ahí esto lo empuja a la
 * pantalla que se quiere ver. Es a propósito: así el camino que la maqueta
 * recorre es el mismo que recorre la app de verdad.
 */

import { estadoEnVivo, SESIONES, AJUSTES, ENTRADAS, DOCTOR, OYENDO } from './datos.js';

const escenarios = new Set(
    (new URLSearchParams(location.search).get('e') || '').split(',').filter(Boolean));
const hay = nombre => escenarios.has(nombre);

/* ─── El puente ───────────────────────────────────────────────────────── */

const avisos = [];
let ajustes = { ...AJUSTES };
if (hay('sin-carpeta')) ajustes = { ...ajustes, carpeta: null, carpetas: [], curso: '' };

const doctor = hay('sin-whisper')
    ? {
        ...DOCTOR,
        ok: false,
        tools: DOCTOR.tools.map(x =>
            (x.key.startsWith('modelo') ? { ...x, found: false, name: null } : x))
    }
    : DOCTOR;

function sesiones() {
    if (hay('vacio') || hay('sin-carpeta')) return [];
    return SESIONES;
}

window.nt = {
    appInfo: async () => ({ version: '0.1.0', arch: 'arm64', electron: '43.7.5', platform: 'darwin' }),
    doctor: async () => doctor,

    ajustesLeer: async () => ajustes,
    ajustesGuardar: async parche => {
        ajustes = { ...ajustes, ...parche };
        return { ok: true, ajustes };
    },
    carpetaRecordar: async ruta => {
        ajustes = { ...ajustes, carpeta: ruta, carpetas: [ruta] };
        return ajustes;
    },
    carpetasEnDisco: async rutas => Object.fromEntries((rutas || []).map(r => [r, true])),

    updateCheck: async () => ({ hay: false, motivo: 'Estás al día.' }),
    updateDownload: async () => ({ ok: true }),
    updateCancel: async () => ({ ok: true }),
    updateInstall: async () => ({ ok: true }),

    pickFolder: async () => '/Volumes/Rodaje/Curso de automatizaciones',
    // La maqueta contesta que sí a todo: lo que se está mirando es cómo queda
    // la pantalla después, no el diálogo, que lo dibuja el sistema.
    confirmar: async () => true,
    reveal: async ruta => { console.log('reveal', ruta); return true; },
    openPath: async () => '',

    grabarIniciar: async () => ({ ok: true, estado: estadoEnVivo() }),
    grabarReanudar: async () => ({ ok: true, estado: estadoEnVivo() }),
    grabarPcm: () => {},
    grabarClaqueta: async () => estadoEnVivo(),
    grabarQuitarClaqueta: async () => estadoEnVivo(),
    grabarEditar: async () => estadoEnVivo(),
    grabarEditarGrabada: async () => ({ ok: true }),
    grabarCerrarToma: async () => estadoEnVivo(),
    grabarDeshacer: async () => ({ ok: true, que: 'poner la toma 4 en S', estado: estadoEnVivo() }),
    grabarRehacer: async () => ({ ok: false, estado: estadoEnVivo() }),
    grabarEstado: async () => estadoEnVivo(),
    grabarVistas: async () => estadoEnVivo().vistas,
    grabarListar: async () => sesiones(),
    grabarRenombrar: async () => ({ ok: true, secuencia: 'renombrada', movida: true, audios: 1 }),
    grabarBorrar: async () => ({ ok: true, secuencia: 'borrada', audios: 1 }),
    grabarRegenerar: async () => ({ ok: true, tomas: 6, sinAudio: 0, degradadas: 0, sinLeer: 0 }),
    grabarTerminar: async () => estadoEnVivo(),
    onGrabarAviso: cb => avisos.push(cb),

    anotar: async () => true,
    registroDescargar: async () => ({ ok: true, archivo: '/tmp/log.md' }),
    onUpdateProgress: () => {},
    onUpdateReady: () => {}
};

/* ─── El micrófono ────────────────────────────────────────────────────── */

/**
 * `getUserMedia` no se falsea: se falsea `oido.js` entero por la puerta de
 * `AudioContext`. Es más simple y es más honesto — lo que la maqueta no puede
 * probar es que el dispositivo abra, y fingir que abre lo taparía.
 *
 * Lo que sí hace falta es el medidor moviéndose: sin él, la pantalla de
 * Preparar se ve con el nivel en cero y parece rota.
 */
// `navigator.mediaDevices` es de solo lectura, así que se redefine la
// propiedad en vez de asignarla: asignándola, el navegador no se queja en
// modo suelto pero tira en módulos, que es como corre todo esto.
Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
        getUserMedia: async () => ({ getTracks: () => [] }),
        enumerateDevices: async () =>
            ENTRADAS.map(d => ({ kind: 'audioinput', deviceId: d.id, label: d.nombre }))
    }
});

// Y el grafo de audio, que sin un `MediaStream` de verdad no se puede armar.
// Es la última cosa que la maqueta falsea, y la que más claramente marca su
// límite: acá no se puede comprobar que el dispositivo abra ni que el PCM
// llegue. Para eso está `tools/simular-grabacion.js`, que le pasa al motor el
// audio de una clase de verdad.
window.AudioContext = class {
    constructor() { this.sampleRate = 48000; }
    get audioWorklet() { return { addModule: async () => {} }; }
    createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
    close() { return Promise.resolve(); }
};

/**
 * El nodo de captura, guardado para poder empujarle PCM desde afuera.
 *
 * Es lo que hace que la maqueta recorra el camino de verdad y no uno paralelo:
 * los pedazos entran por el mismo `port.onmessage` que usa el worklet, así que
 * corre `oido.recibir`, se mide el pico como en la app y la pantalla se entera
 * por donde se entera siempre. Escribir el ancho de la barra a mano habría
 * mostrado un medidor lindo sobre una pastilla que decía «en silencio».
 */
let capturador = null;
window.AudioWorkletNode = class {
    constructor() { this.port = { onmessage: null }; capturador = this; }
    disconnect() { if (capturador === this) capturador = null; }
};

/* ─── El escenario ────────────────────────────────────────────────────── */

const espera = ms => new Promise(r => setTimeout(r, ms));

async function aplicar() {
    // Se espera el arranque de verdad y no un rato al azar: `arrancar` lee los
    // ajustes y lista la carpeta, así que empujar la app antes de que termine
    // la devolvía a Sesiones un instante después (ver `dev.listo` en `app.js`).
    while (!window.dev) await espera(10);
    await window.dev.listo;
    const app = window.dev.app;
    if (!app) return;

    if (hay('iconos')) return verIconos();

    if (hay('preparar') || hay('preparar-sin-audio') || hay('sin-whisper')) {
        await app.irAPreparar();
        // El nivel entrando, que es lo que dice «hay algo del otro lado».
        if (!hay('preparar-sin-audio')) await conAudio();
        return;
    }

    if (hay('en-vivo') || hay('toma-abierta') || hay('releyendo') || hay('sin-audio')) {
        const estado = estadoEnVivo(estadoDeLaClase());
        app.irAVivo(estado, { abierto: true, caido: hay('sin-audio'), pico: 0.42 });
        document.getElementById('oyendo-vivo').textContent = OYENDO;
        return;
    }

    if (hay('terminada')) {
        app.irACierre(estadoEnVivo());
        return;
    }

    if (hay('ajustes')) app.verAjustes();
    if (hay('diagnostico')) app.verDiagnostico();
}

function estadoDeLaClase() {
    if (hay('toma-abierta')) {
        const base = estadoEnVivo();
        const abierta = {
            ...base.tomas[5], id: 7, outMs: null, comentario: '', relectura: null,
            palabras: base.tomas[0].palabras.slice(0, 12).map(w => ({
                ...w, t: w.t + 990000, hasta: w.hasta + 990000
            }))
        };
        return { abierta: 7, tomas: base.tomas.concat([abierta]) };
    }
    if (hay('releyendo')) return { releyendo: 2 };
    return {};
}

/**
 * Audio entrando, por el camino de verdad: se le pasan pedazos de PCM al mismo
 * puerto por el que los manda el worklet (ver `capturador`).
 */
async function conAudio() {
    const oyendo = document.getElementById('oyendo-preparar');
    if (oyendo) oyendo.textContent = OYENDO;

    for (let i = 0; i < 600; i++) {
        if (capturador && capturador.port.onmessage) {
            const pico = 0.25 + Math.abs(Math.sin(i / 7)) * 0.4;
            const muestras = new Int16Array(512);
            for (let k = 0; k < muestras.length; k++) {
                muestras[k] = Math.round(Math.sin(k / 6) * pico * 32767);
            }
            capturador.port.onmessage({ data: muestras });
        }
        await espera(80);
    }
}

/** Todos los iconos juntos: es la única forma de ver si alguno desentona. */
async function verIconos() {
    const { icono, nombres } = await import('/js/iconos.js');
    document.querySelector('.app').innerHTML =
        `<div class="scroll"><div class="seccion">
          <div class="seccion-titulo"><span>Los iconos</span>
            <span class="v3">${nombres().length} dibujos, uno por concepto</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
            ${nombres().map(n => `<div class="tarjeta" style="margin:0">
              <div class="tarjeta-cabeza" style="flex-direction:column;gap:8px;padding:16px">
                <span class="hp-ico" style="width:24px;height:24px">${icono(n)}</span>
                <span class="v3">${n}</span>
              </div></div>`).join('')}
          </div></div></div>`;
}

aplicar();
