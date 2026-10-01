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

import { estadoEnVivo, SESIONES, AJUSTES, ENTRADAS, CAMARAS, DOCTOR } from './datos.js';

const escenarios = new Set(
    (new URLSearchParams(location.search).get('e') || '').split(',').filter(Boolean));
const hay = nombre => escenarios.has(nombre);

/**
 * La foto de referencia de la maqueta: una pantalla de clase dibujada a mano.
 *
 * La maqueta no tiene cámara, así que las fotos del OUT las inventa el doble.
 * Es un SVG y no un JPEG de verdad para que el repo no cargue con una imagen
 * binaria, y se ve claramente dibujado: una captura de diseño no debería poder
 * confundirse con una foto de una clase que pasó.
 */
const PANTALLA_FALSA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#101216"/>
      <rect x="0" y="0" width="320" height="18" fill="#1b1f27"/>
      <circle cx="12" cy="9" r="3" fill="#ff5f57"/><circle cx="22" cy="9" r="3" fill="#febc2e"/>
      <circle cx="32" cy="9" r="3" fill="#28c840"/>
      <text x="160" y="12" fill="#8a93a3" font-family="Helvetica" font-size="8"
            text-anchor="middle">Automatización · paso 3 de 7</text>
      <rect x="20" y="36" width="110" height="34" rx="4" fill="#223049" stroke="#4e7bd4"/>
      <text x="75" y="57" fill="#cfd8e6" font-family="Helvetica" font-size="9"
            text-anchor="middle">Disparador</text>
      <rect x="190" y="36" width="110" height="34" rx="4" fill="#223049" stroke="#4e7bd4"/>
      <text x="245" y="57" fill="#cfd8e6" font-family="Helvetica" font-size="9"
            text-anchor="middle">Condición</text>
      <path d="M130 53h60" stroke="#4e7bd4" stroke-width="1.6"/>
      <path d="M184 49l6 4-6 4z" fill="#4e7bd4"/>
      <rect x="105" y="98" width="110" height="34" rx="4" fill="#2b2436" stroke="#a46fd6"/>
      <text x="160" y="119" fill="#e2d7f0" font-family="Helvetica" font-size="9"
            text-anchor="middle">Salida</text>
      <path d="M160 70v28" stroke="#a46fd6" stroke-width="1.6"/>
      <path d="M156 92l4 6 4-6z" fill="#a46fd6"/>
      <rect x="20" y="150" width="190" height="4" rx="2" fill="#2a3040"/>
      <rect x="20" y="160" width="120" height="4" rx="2" fill="#2a3040"/>
    </svg>`);

/* ─── El puente ───────────────────────────────────────────────────────── */

const avisos = [];
let ajustes = { ...AJUSTES };
if (hay('sin-carpeta')) ajustes = { ...ajustes, carpeta: null, carpetas: [], curso: '' };
if (hay('preparar-microfono')) ajustes = { ...ajustes, dispositivo: 'MacBook Pro Microphone (Built-in)' };
if (hay('preparar-zoom-falso')) ajustes = { ...ajustes, dispositivo: 'ZoomAudioDevice (Virtual)' };
if (hay('preparar-sin-audio') || hay('sin-zoom')) ajustes = { ...ajustes, dispositivo: null };

const progresoUpdate = [];
const listaUpdate = [];
let oyenteDependencias = null;
const DEPENDENCIAS = [
    ['modelo-grande', 'Modelo de Whisper (large-v3-turbo)', 'Relee cada toma cerrada y escribe el texto que va al XML. También es el que oye el texto en vivo.', true, 'Descargar (1,6 GB)'],
    ['modelo-liviano', 'Modelo liviano (small)', 'El respaldo: si el grande se cae a mitad de una toma, se relee con este.', false, 'Descargar (488 MB)'],
    ['ffmpeg', 'ffmpeg', 'Corta el audio grabado en los pedazos que se le pasan a Whisper.', true, null],
    ['ffprobe', 'ffprobe', 'Lee cuánto dura y cómo está hecho un audio.', true, null],
    ['whisper-cli', 'whisper-cli', 'Transcribe: sin él no se oye el conteo, ni la pausa, ni hay texto.', true, null],
    ['whisper-server', 'whisper-server', 'Deja el modelo cargado para el texto en vivo.', false, null],
    ['escuchar-app', 'Escucha de Zoom', 'Graba el sonido de la llamada de Zoom directo.', false, null]
];
const faltanModelos = new URLSearchParams(location.search).get('e') === 'faltan-modelos';
const dependencias = DEPENDENCIAS.map(([clave, nombre, para, requerida, etiqueta]) => {
    const esta = !(faltanModelos && etiqueta);
    return { clave, nombre, para, requerida, esta, donde: esta ? '/Applications/Note Taker.app' : null,
        accion: esta ? null : { tipo: 'descargar', etiqueta } };
});

/** El oyente del sonido de Zoom, para poder mandarle nivel desde `conAudio`. */
let oyenteZoom = null;

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

    // Lo que falta. `?e=faltan-modelos` es la Mac del compañero: el instalador
    // publicado no trae los modelos. La descarga es de mentira y avanza sola.
    dependenciasEstado: async () => dependencias.map(d => ({ ...d })),
    dependenciasInstalar: async clave => {
        const d = dependencias.find(x => x.clave === clave);
        for (let pct = 0; pct <= 100; pct += 20) {
            if (oyenteDependencias) oyenteDependencias({ clave, pct, texto: `${Math.round(pct * 16) / 10} de 1,6 GB` });
            await espera(120);
        }
        if (d) { d.esta = true; d.accion = null; d.donde = '~/Library/Application Support/Note Taker/models'; }
        return { ok: true };
    },
    dependenciasCancelar: async () => true,
    onDependenciasProgreso: cb => { oyenteDependencias = cb; },
    // `?e=update` es la app con una versión nueva esperando.
    updateCheck: async () => (hay('update')
        ? { hay: true, version: '0.1.1', url: 'https://x/NoteTaker.pkg', nombre: 'NoteTaker-0.1.1-arm64.pkg',
            notas: 'Pausa que cierra, Enter que abre, marcadores con el nombre de la toma.' }
        : { hay: false, motivo: 'Estás al día.' }),
    updateDownload: async () => {
        for (let pct = 0; pct <= 100; pct += 20) {
            for (const cb of progresoUpdate) cb({ percent: pct, bajado: pct * 1.4e6, total: 1.4e8 });
            await espera(150);
        }
        for (const cb of listaUpdate) cb({ path: '/Users/x/Downloads/NoteTaker-0.1.1-arm64.pkg' });
        return { ok: true, path: '/Users/x/Downloads/NoteTaker-0.1.1-arm64.pkg' };
    },
    updateCancel: async () => ({ ok: true }),
    updateInstall: async () => ({ ok: true, cerrando: true }),

    pickFolder: async () => '/Volumes/Rodaje/Curso de automatizaciones',
    // La maqueta contesta que sí a todo: lo que se está mirando es cómo queda
    // la pantalla después, no el diálogo, que lo dibuja el sistema.
    confirmar: async () => true,
    reveal: async ruta => { console.log('reveal', ruta); return true; },
    openPath: async () => '',

    // El sonido de Zoom. `?e=sin-zoom` es Zoom cerrado.
    audioAppEstado: async () => ({ soportado: true, abierta: !hay('sin-zoom'), sonando: true }),
    audioAppAbrir: async () => (hay('sin-zoom')
        ? { ok: false, codigo: 'sin-app',
            error: 'No encontré ninguna app que empiece con us.zoom entre las que usan audio. Si es Zoom, abrila y entrá a la reunión.' }
        : { ok: true, sampleRate: 48000, canales: 1 }),
    audioAppMandar: async () => true,
    audioAppCerrar: async () => true,
    onAudioApp: cb => { oyenteZoom = cb; },

    grabarIniciar: async () => ({ ok: true, estado: estadoEnVivo() }),
    grabarReanudar: async () => ({ ok: true, estado: estadoEnVivo() }),
    grabarPcm: () => {},
    grabarClaqueta: async () => estadoEnVivo(),
    grabarQuitarClaqueta: async () => estadoEnVivo(),
    grabarEditar: async c => (c && c.tipo === 'borde' && c.borde === 'in'
        ? moverInEn(Number(c.paredMs))
        : estadoEnVivo()),
    // Las notas de una clase ya grabada: el mismo estado de la clase con
    // `grabando: false`, que es lo que la pantalla usa para no dibujar el cromo
    // de grabar (ver `paraMirar` en engine/sesiones-grabadas.js).
    grabarAbrirGrabada: async json => ({ ok: true, estado: estadoDeNotas(json) }),
    grabarEditarGrabada: async (json, c) => ({ ok: true, estado: conCambio(estadoDeNotas(json), c) }),
    grabarAbrirToma: async ms => abrirEn(ms),
    grabarCerrarToma: async ms => cerrarEn(ms),
    grabarDeshacer: async () => ({ ok: true, que: 'poner la toma 4 en S', estado: estadoEnVivo() }),
    grabarRehacer: async () => ({ ok: false, estado: estadoEnVivo() }),
    grabarEstado: async () => estadoEnVivo(),
    grabarVistas: async () => estadoEnVivo().vistas,
    grabarListar: async () => sesiones(),
    grabarRenombrar: async () => ({ ok: true, secuencia: 'renombrada', movida: true, audios: 1 }),
    grabarBorrar: async () => ({ ok: true, secuencia: 'borrada', audios: 1 }),
    grabarRegenerar: async () => ({ ok: true, tomas: 6, sinAudio: 0, degradadas: 0, sinLeer: 0 }),
    grabarRehacerXml: async () => ({ ok: true, tomas: 6, claquetas: 3 }),
    grabarTerminar: async () => estadoEnVivo(),
    onGrabarAviso: cb => avisos.push(cb),

    // El menú del .prproj: dos capturas, una vista anidada y otra suelta —los
    // dos estados del botón de unir— y en X2 una captura puesta en todas las
    // tomas y la otra solo en las suyas, que son las dos palabras del menú.
    prprojConfig: async carpeta => ({
        ok: true,
        config: {
            capturas: 2,
            vistas: {
                PV: { capturas: [1], unidas: false, siempre: [1] },
                R: { capturas: [2, 1], unidas: true, siempre: [2, 1] },
                S: { capturas: [2], unidas: false, siempre: [] },
                MG: { capturas: [2], unidas: false, siempre: [2] },
                X2: { capturas: [1, 2], unidas: false, siempre: [2] }
            }
        },
        vistas: estadoEnVivo().vistas.map(v => ({ ...v, usada: ['PV', 'R', 'X2'].includes(v.nombre) })),
        clases: 3,
        guardada: true,
        destino: `${carpeta}/Proyecto/${String(carpeta).split('/').pop()}.prproj`,
        plantilla: true
    }),
    prprojGuardarConfig: async (carpeta, config) => ({ ok: true, config }),
    prprojGenerar: async carpeta => ({
        ok: true,
        ruta: `${carpeta}/Proyecto/${String(carpeta).split('/').pop()}.prproj`,
        cuenta: ['3 clase(s) en 2 captura(s) y 1 grupo(s), de 412 minutos con 5 de aire entre clases.',
            '3 precortada(s) con 41 toma(s) y 7 claqueta(s) marcada(s) en las capturas.'],
        avisos: ['clase-2_2026-09-28_14-30-00 quedó sin terminar: entra con lo que tenía guardado.']
    }),
    onPrprojAviso: () => {},

    fotosListar: async (carpeta, secuencia) => ({
        ok: true,
        fotos: [1, 2, 3, 4, 6].map(toma => ({
            toma,
            ruta: `${carpeta}/xml/Referencias/${secuencia}/toma-${toma}.jpg`,
            mini: PANTALLA_FALSA
        }))
    }),
    fotoGuardar: async p => ({
        ok: true, toma: p.toma, nueva: true, mini: PANTALLA_FALSA,
        ruta: `${p.carpeta}/xml/Referencias/${p.secuencia}/toma-${p.toma}.jpg`
    }),
    fotoAbrir: async ruta => ({ ok: true, ruta, imagen: PANTALLA_FALSA, ancho: 1920, alto: 1080 }),
    fotoCopiar: async () => ({ ok: true }),

    anotar: async () => true,
    registroDescargar: async () => ({ ok: true, archivo: '/tmp/log.md' }),
    onUpdateProgress: cb => progresoUpdate.push(cb),
    onUpdateReady: cb => listaUpdate.push(cb)
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
        enumerateDevices: async () => [
            ...ENTRADAS.map(d => ({ kind: 'audioinput', deviceId: d.id, label: d.nombre })),
            ...CAMARAS.map(d => ({ kind: 'videoinput', deviceId: d.id, label: d.nombre }))
        ]
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

/**
 * Empujarle a la ventana un aviso del motor, desde afuera.
 *
 * Es la única manera de comprobar lo que la ventana hace con lo que LLEGA y no
 * con lo que pide: que un estado nuevo repinte, que el golpe de una palmada se
 * vea, y que con un menú abierto el texto de debajo se quede quieto.
 */
window.maqueta = { avisar: a => { for (const cb of avisos) cb(a); } };

async function aplicar() {
    // Se espera el arranque de verdad y no un rato al azar: `arrancar` lee los
    // ajustes y lista la carpeta, así que empujar la app antes de que termine
    // la devolvía a Sesiones un instante después (ver `dev.listo` en `app.js`).
    while (!window.dev) await espera(10);
    await window.dev.listo;
    const app = window.dev.app;
    if (!app) return;

    if (hay('iconos')) return verIconos();

    if (hay('preparar') || hay('preparar-sin-audio') || hay('sin-whisper') ||
        hay('preparar-microfono') || hay('preparar-zoom-falso') || hay('sin-zoom')) {
        await app.irAPreparar();
        // El nivel entrando, que es lo que dice «hay algo del otro lado».
        if (!hay('preparar-sin-audio')) await conAudio();
        return;
    }

    if (hay('en-vivo') || hay('toma-abierta') || hay('releyendo') || hay('sin-audio') ||
        hay('palmada') || hay('palmada-vencida') || hay('foto')) {
        const estado = estadoEnVivo(estadoDeLaClase());
        vivo = estado;
        app.irAVivo(estado, { abierto: true, caido: hay('sin-audio'), pico: 0.42 });
        // Una toma cerrada desplegada: es donde se ven los dos bordes y las orillas.
        if (hay('desplegada')) document.querySelector('#lista-vivo [data-hace="plegar"][data-toma="1"]').click();
        // Y una claqueta desplegada, que es donde se le escribe la nota: el
        // renglón se abre igual que el de una toma y trae el mismo campo.
        if (hay('claqueta-abierta')) {
            document.querySelector('#lista-vivo [data-hace="plegar-claqueta"]').click();
        }
        if (hay('palmada') || hay('palmada-vencida')) await conPalmada(estado);
        // La foto del OUT en grande, abierta desde el bloque de su toma: es lo
        // que se mira para retomar, o lo que se copia para mandarle al profesor.
        if (hay('foto')) {
            await espera(120);
            document.querySelector('#lista-vivo [data-hace="plegar"][data-toma="1"]').click();
            await espera(60);
            const mini = document.querySelector('#lista-vivo [data-hace="ver-foto"][data-toma="1"]');
            if (mini) mini.click();
            await espera(120);
        }
        return;
    }

    // Las notas de una clase ya grabada, abiertas desde la fila de Sesiones: la
    // misma pantalla de la clase sin el cromo de grabar.
    if (hay('notas-de-antes')) {
        await app.irASesiones();
        const boton = document.querySelector('#lista-sesiones [data-hace="notas"]');
        if (boton) boton.click();
        // Una toma desplegada, que es donde se ajusta la nota.
        await espera(80);
        const plegar = document.querySelector('#lista-vivo [data-hace="plegar"][data-toma="4"]');
        if (plegar) plegar.click();
        return;
    }

    if (hay('terminada')) {
        app.irACierre(estadoEnVivo());
        return;
    }

    // El menú de «Generar .prproj», y con `prproj-listo` ya generado.
    if (hay('prproj') || hay('prproj-listo')) {
        await app.irASesiones();
        document.querySelector('#btn-prproj').click();
        await espera(80);
        if (hay('prproj-listo')) {
            document.querySelector('#btn-prproj-generar').click();
            await espera(80);
        }
        return;
    }

    if (hay('ajustes')) app.verAjustes();
    if (hay('diagnostico')) app.verDiagnostico();
}

/**
 * Una palmada oída, en sus dos momentos.
 *
 * Entra por donde entra de verdad —el aviso `golpe` del motor— y vence por donde
 * vence de verdad: con el reloj del audio grabado, que es un estado más con más
 * `segundos`. Nada de tocar la pastilla a mano, que es lo que habría mostrado
 * una pastilla linda encima de una cuenta que no funciona.
 */
async function conPalmada(estado) {
    const palmadaMs = estado.ceroMs + estado.segundos * 1000 - 400;
    for (const cb of avisos) cb({ tipo: 'golpe', ms: palmadaMs });
    if (!hay('palmada-vencida')) return;
    // Los 6 s de audio que al motor le faltan para poder leer, más los 6 de la
    // pasada de Whisper. Pasados, nadie confirmó nada y eso hay que decirlo.
    await espera(50);
    for (const cb of avisos) cb({ tipo: 'estado', estado: { ...estado, segundos: estado.segundos + 13 } });
}

/**
 * El estado en vivo de la maqueta, que abrir y cerrar sí cambian.
 *
 * Es lo mínimo para poder ARRASTRAR en la maqueta y ver qué pasa: soltar el IN
 * en el campo de espera abre la toma 7 en esa palabra, y soltar su OUT la
 * cierra. Lo demás (mover bordes de una cerrada, las vistas, las notas) vuelve
 * el estado tal cual, porque ahí lo que se mira es la pantalla, no el motor.
 */
let vivo = null;

/**
 * Las notas de una clase ya grabada, como las manda el motor.
 *
 * Es el estado de la clase con `grabando: false`, sin toma abierta y con el
 * `json` de donde cuelga cada edición: lo mismo que arma `paraMirar` en
 * `engine/sesiones-grabadas.js`. Así se puede mirar y medir la pantalla de las
 * notas de una clase vieja sin tener una clase grabada a mano.
 */
let notas = null;

function estadoDeNotas(json) {
    if (!notas || notas.json !== json) {
        const base = estadoEnVivo();
        notas = {
            ...base,
            json,
            grabando: false,
            terminada: true,
            abierta: null,
            sueltas: [],
            releyendo: 0,
            historia: { atras: 0, adelante: 0, queAtras: '', queAdelante: '' },
            // Todas cerradas: una clase terminada no tiene ninguna abierta.
            tomas: base.tomas.map(t => (t.outMs == null ? { ...t, outMs: t.inMs + 60000 } : t))
        };
    }
    return notas;
}

/** El cambio aplicado, para poder VER que el gesto llega al archivo. */
function conCambio(base, c) {
    if (!c) return base;
    if (c.tipo === 'quitar-claqueta') {
        notas = { ...base, claquetas: base.claquetas.filter(q => q.n !== Number(c.n)) };
        return notas;
    }
    if (c.tipo === 'nota-claqueta') {
        notas = {
            ...base,
            claquetas: base.claquetas.map(q => (q.n === Number(c.n) ? { ...q, comentario: c.texto } : q))
        };
        return notas;
    }
    const campo = { nota: 'comentario', vista: 'vista', descartar: 'descartada' }[c.tipo];
    if (!campo) return base;
    const valor = c.tipo === 'nota' ? c.texto : (c.tipo === 'vista' ? c.vista : Boolean(c.descartada));
    notas = { ...base, tomas: base.tomas.map(t => (t.id === c.toma ? { ...t, [campo]: valor } : t)) };
    return notas;
}

/**
 * Correr el IN de la toma abierta, con el tope de la toma anterior.
 *
 * Es el tercer gesto que la maqueta hace de verdad, por el mismo motivo que los
 * otros dos: es lo que hay que poder ARRASTRAR acá para ver qué pasa. Y el tope
 * está porque sin él la maqueta mostraba lo contrario de lo que hace la app —el
 * IN se metía en la toma de antes al soltar— y una captura así miente.
 *
 * Es el mismo cálculo que `pisoDelIn` y `moverInAbierta` en
 * `engine/notas-vivo.js`, que son la última palabra; acá está en corto porque la
 * maqueta no tiene motor.
 */
function moverInEn(ms) {
    const base = vivo || estadoEnVivo();
    const toma = base.tomas.find(t => t.id === base.abierta);
    if (!toma || !Number.isFinite(ms)) return base;
    let piso = null;
    for (const t of base.tomas) {
        if (t.id === toma.id || t.descartada || t.outMs == null || t.inMs >= toma.inMs) continue;
        if (piso == null || t.outMs > piso) piso = t.outMs;
    }
    const donde = piso != null ? Math.max(ms, piso) : ms;
    const todas = (base.sueltas || []).concat(toma.palabras || []).sort((a, b) => a.t - b.t);
    const movida = { ...toma, inMs: donde, palabras: todas.filter(w => w.t >= donde) };
    vivo = {
        ...base,
        tomas: base.tomas.map(t => (t === toma ? movida : t)),
        sueltas: todas.filter(w => w.t < donde)
    };
    return vivo;
}

function abrirEn(ms) {
    const base = vivo || estadoEnVivo();
    if (base.abierta != null) return base;
    const sueltas = base.sueltas || [];
    const desde = ms != null ? ms : (sueltas.length ? sueltas[Math.max(0, sueltas.length - 8)].t : base.ceroMs);
    const toma = {
        ...base.tomas[0], id: 7, vista: 'PV', comentario: '', outMs: null, relectura: null,
        inMs: desde, palabras: sueltas.filter(w => w.t >= desde), antes: [], despues: []
    };
    vivo = { ...base, abierta: 7, tomas: base.tomas.concat([toma]), sueltas: sueltas.filter(w => w.t < desde) };
    return { ...vivo, retrocedioSec: ms != null ? 0 : 4.2 };
}

function cerrarEn(ms) {
    const base = vivo || estadoEnVivo();
    const toma = base.tomas.find(t => t.id === base.abierta);
    if (!toma) return base;
    const hasta = ms != null ? ms : (toma.palabras.length ? toma.palabras[toma.palabras.length - 1].hasta : toma.inMs + 1000);
    const cerrada = {
        ...toma, outMs: hasta,
        palabras: toma.palabras.filter(w => w.t < hasta),
        despues: toma.palabras.filter(w => w.t >= hasta)
    };
    vivo = { ...base, abierta: null, tomas: base.tomas.map(t => (t === toma ? cerrada : t)), sueltas: cerrada.despues };
    return vivo;
}

function estadoDeLaClase() {
    if (hay('toma-abierta')) {
        const base = estadoEnVivo();
        const palabras = base.tomas[0].palabras.slice(0, 12).map(w => ({
            ...w, t: w.t + 990000, hasta: w.hasta + 990000
        }));
        // El conteo con el que se abrió, en lo gris de antes del IN: es donde
        // cae siempre —el IN va DESPUÉS de la última palabra de la cuenta— y es
        // lo que hay que poder ver marcado para saber que la app lo oyó.
        const conteo = base.sueltas.slice(-6).map((w, i) => ({
            ...w,
            t: palabras[0].t - (4 - i * 0.6) * 1000,
            hasta: palabras[0].t - (4 - i * 0.6) * 1000 + 380,
            texto: ['entonces', 'arrancamos', 'ok', 'tres,', 'dos,', 'uno.'][i]
        }));
        const abierta = {
            ...base.tomas[5], id: 7, outMs: null, comentario: '', relectura: null,
            inMs: palabras[0].t, palabras
        };
        return { abierta: 7, sueltas: conteo, tomas: base.tomas.concat([abierta]) };
    }
    if (hay('releyendo')) return { releyendo: 2 };
    return {};
}

/**
 * Audio entrando, por el camino de verdad: se le pasan pedazos de PCM al mismo
 * puerto por el que los manda el worklet (ver `capturador`).
 */
async function conAudio() {
    for (let i = 0; i < 600; i++) {
        // Por las dos puertas: el nivel de Zoom llega por `onAudioApp`, el de
        // un micrófono por el worklet. Cada fuente escucha solo la suya.
        if (oyenteZoom) oyenteZoom({ tipo: 'nivel', pico: 0.25 + Math.abs(Math.sin(i / 7)) * 0.4 });
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
