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

/**
 * Todos los escenarios que este doble sabe armar, dicho de una vez.
 *
 * Es el catálogo, y está acá porque este es el archivo que los implementa: una
 * lista en otro sitio puede quedarse vieja, y esta no, porque es la que decide
 * si un nombre vale. Las herramientas que miden la leen —`tools/maqueta/abrir.js`
 * la repite para Node, que no puede importar un módulo que usa `window`— y
 * `tests/maqueta.test.js` comprueba que las dos digan lo mismo.
 *
 * Y se usa, no solo se declara: un `?e=` que no esté acá avisa fuerte. Antes un
 * nombre mal escrito daba la pantalla de arranque sin decir nada, y la
 * herramienta sacaba la foto igual y la medía creyendo que era otra cosa.
 */
export const SE_HACEN = [
    'vacio', 'sin-carpeta', 'sesiones', 'numero-de-clase',
    'preparar', 'preparar-clase-repetida', 'preparar-sin-audio', 'preparar-microfono',
    'preparar-zoom-falso', 'disco-lleno',
    'sin-whisper', 'sin-zoom', 'faltan-modelos', 'update',
    'en-vivo', 'desplegada', 'toma-abierta', 'releyendo', 'muchas-clases',
    'sin-audio', 'terminada', 'terminada-vacia', 'notas-de-antes', 'foto', 'foto-cien',
    'prproj', 'prproj-lleno', 'prproj-listo',
    'ajustes', 'diagnostico', 'iconos'
];

const escenarios = new Set(
    (new URLSearchParams(location.search).get('e') || '').split(',').filter(Boolean));
const hay = nombre => escenarios.has(nombre);

for (const x of escenarios) {
    if (!SE_HACEN.includes(x)) {
        console.error(`maqueta: no sé armar «${x}». Los que hay: ${SE_HACEN.join(', ')}`);
    }
}

/**
 * La foto de referencia de la maqueta: una pantalla de clase dibujada a mano.
 *
 * La maqueta no tiene cámara, así que las fotos del OUT las inventa el doble.
 * Es un SVG y no un JPEG de verdad para que el repo no cargue con una imagen
 * binaria, y se ve claramente dibujado: una captura de diseño no debería poder
 * confundirse con una foto de una clase que pasó.
 */
const PANTALLA_FALSA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    // 1920×1080 como la cámara de verdad, para que «ver al 100 %» en la
    // maqueta sea del tamaño que va a tener en la app.
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 320 180">
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
/** Las recientes, como las contesta el motor (`grabar-carpetas`). */
const RECIENTES = [
    ['/Volumes/Rodaje/Curso de automatizaciones', 3, '2026-09-28T09:02:11'],
    ['/Users/editor/Movies/Render/Curso Canva', 2, '2026-11-10T08:23:38'],
    ['/Users/editor/Movies/CUR/2610_ia-abogados/Material/LUISA_curso-ia-abogados', 6, '2026-11-07T10:00:00'],
    ['/Volumes/P_CONF_2/2610_NemoClaw_Course/note taker uli', 15, '2026-10-22T19:01:08']
];

let ajustes = { ...AJUSTES };
if (hay('sin-carpeta')) ajustes = { ...ajustes, carpeta: null, carpetas: RECIENTES.map(r => r[0]) };
if (hay('preparar-microfono')) ajustes = { ...ajustes, dispositivo: 'MacBook Pro Microphone (Built-in)' };
if (hay('preparar-zoom-falso')) ajustes = { ...ajustes, dispositivo: 'ZoomAudioDevice (Virtual)' };
if (hay('preparar-sin-audio') || hay('sin-zoom')) ajustes = { ...ajustes, dispositivo: null };

const glosarioGuardado = { general: ['Figma', 'Notion'], delCurso: ['Canva Pro', 'Magic Studio', 'kit de marca'] };
function glosarioFalso() {
    const entran = glosarioGuardado.general.concat(glosarioGuardado.delCurso);
    return { ...glosarioGuardado, entran, afuera: [], palabras: entran.join(' ').split(' ').length, tope: 150 };
}

const progresoUpdate = [];
const listaUpdate = [];
let oyenteDependencias = null;
const DEPENDENCIAS = [
    ['modelo-grande', 'Modelo de Whisper (large-v3-turbo)', 'Relee cada toma cerrada y escribe el texto que va al XML. También es el que oye el texto en vivo.', true, 'Descargar (1,6 GB)', 1624555275, '1,6 GB'],
    ['modelo-liviano', 'Modelo liviano (small)', 'El respaldo: si el grande se cae a mitad de una toma, se relee con este.', false, 'Descargar (488 MB)', 487601967, '488 MB'],
    ['ffmpeg', 'ffmpeg', 'Corta el audio grabado en los pedazos que se le pasan a Whisper.', true, null],
    ['ffprobe', 'ffprobe', 'Lee cuánto dura y cómo está hecho un audio.', true, null],
    ['whisper-cli', 'whisper-cli', 'Transcribe: sin él no se oye el conteo, ni la pausa, ni hay texto.', true, null],
    ['whisper-server', 'whisper-server', 'Deja el modelo cargado para el texto en vivo.', false, null],
    ['escuchar-app', 'Escucha de Zoom', 'Graba el sonido de la llamada de Zoom directo.', false, null]
];
const faltanModelos = new URLSearchParams(location.search).get('e') === 'faltan-modelos';
const dependencias = DEPENDENCIAS.map(([clave, nombre, para, requerida, etiqueta, bytes, peso]) => {
    const esta = !(faltanModelos && etiqueta);
    return { clave, nombre, para, requerida, esta, donde: esta ? '/Applications/Note Taker.app' : null,
        accion: esta ? null : { tipo: 'descargar', etiqueta, bytes, peso } };
});

/**
 * Las pistas de una precortada, con la regla de `prproj-plan.repartirPistas`:
 * la maqueta no puede pedírselas al motor.
 */
function pistasDeLaMaqueta(config, usadas) {
    const orden = ['PV', 'R', 'S', 'MG', 'X2'];
    const pistas = [];
    for (const vista of Object.keys(config.vistas).sort((a, b) => orden.indexOf(a) - orden.indexOf(b))) {
        const v = config.vistas[vista];
        const grupos = v.unidas && v.capturas.length > 1 ? [v.capturas.slice()] : v.capturas.map(id => [id]);
        for (const ids of grupos) {
            const siempre = ids.every(id => v.siempre.includes(id));
            if (usadas.includes(vista) || siempre) pistas.push({ vista, ids, siempre });
        }
    }
    return pistas;
}

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

/** Lo que hay grabado en una carpeta. */
function sesiones() {
    if (hay('vacio') || hay('sin-carpeta')) return [];
    // Un curso entero, para ver la lista compacta: es como se ve con 80.
    if (hay('muchas-clases')) {
        return Array.from({ length: 24 }, (_x, i) => {
            const n = 24 - i;
            const cero = new Date(2026, 8, 1 + n, 9, n % 60).getTime();
            const estado = n === 20 ? 'abierta' : (n % 7 === 3 ? 'sin releer' : 'terminada');
            return {
                secuencia: `${String(n).padStart(2, '0')}_curso-de-automatizaciones_2026-09-${String(1 + n).padStart(2, '0')}_09-${String(n % 60).padStart(2, '0')}-00`,
                curso: 'Curso de automatizaciones', numero: n, vez: 1, ceroMs: cero,
                archivos: { xml: `/x/${n}.xml`, json: `/x/${n}_notas-en-vivo.json` },
                resumen: { tomas: 8 + (n * 7) % 11, descartadas: 0, segundos: 5000 + (n * 613) % 5200, sinReleer: estado === 'sin releer' ? 2 : 0, estado }
            };
        });
    }
    return SESIONES;
}


window.nt = {
    appInfo: async () => ({ version: '0.1.0', arch: 'arm64', electron: '43.7.5', platform: 'darwin' }),
    doctor: async () => doctor,

    ajustesLeer: async () => ajustes,
    // El glosario sumado como lo suma el motor (`glosario.combinar`), sin el
    // tope: en la maqueta no se llega.
    glosarioLeer: async () => glosarioFalso(),
    glosarioGuardar: async c => {
        if (Array.isArray(c.general)) glosarioGuardado.general = c.general;
        if (Array.isArray(c.delCurso)) glosarioGuardado.delCurso = c.delCurso;
        return { ok: true, ...glosarioFalso() };
    },
    ajustesGuardar: async parche => {
        ajustes = { ...ajustes, ...parche };
        return { ok: true, ajustes };
    },
    carpetaRecordar: async ruta => {
        ajustes = { ...ajustes, carpeta: ruta, carpetas: [ruta] };
        return ajustes;
    },

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
    updateInstall: async () => ({ ok: true, cerrando: true }),

    pickFolder: async () => '/Volumes/Rodaje/Curso de automatizaciones',
    // La maqueta contesta que sí a todo: lo que se está mirando es cómo queda
    // la pantalla después, no el diálogo, que lo dibuja el sistema.
    confirmar: async () => true,
    // Y a la primera de las que tienen varias salidas, que es la de hacer algo.
    preguntar: async ({ opciones } = {}) => (opciones && opciones[0] ? opciones[0].valor : null),
    reveal: async ruta => { console.log('reveal', ruta); return true; },

    // El sonido de Zoom. `?e=sin-zoom` es Zoom cerrado.
    audioAppEstado: async () => ({ soportado: true, abierta: !hay('sin-zoom'), sonando: true }),
    audioAppAbrir: async () => (hay('sin-zoom')
        ? { ok: false, codigo: 'sin-app',
            error: 'No encontré ninguna app que empiece con us.zoom entre las que usan audio. Si es Zoom, abrila y entrá a la reunión.' }
        : { ok: true, sampleRate: 48000, canales: 1 }),
    audioAppMandar: async () => true,
    audioAppCerrar: async () => true,
    onAudioApp: cb => { oyenteZoom = cb; },

    grabarIniciar: async () => ({ ok: true, estado: laSesion() }),
    grabarReanudar: async () => ({ ok: true, estado: laSesion() }),
    grabarPcm: () => {},
    // Releyendo las que la pregunta dijo que iba a releer, y ninguna cuando
    // contestaron que solo de ahí en adelante: el aviso cuenta las dos cosas y
    // en la maqueta tienen que cuadrar con el diálogo que se acaba de ver.
    grabarIdioma: async (cual, opciones) => {
        const estado = estadoEnVivo({ idioma: cual });
        return { ok: true, releyendo: (opciones && opciones.releer === true) ? estado.porReleer : 0, estado };
    },
    grabarEditar: async c => {
        if (c && c.tipo === 'borde' && c.borde === 'in') return moverInEn(Number(c.paredMs));
        return cambiarEnVivo(c);
    },
    // Las notas de una clase ya grabada: el mismo estado de la clase con
    // `grabando: false`, que es lo que la pantalla usa para no dibujar el cromo
    // de grabar (ver `paraMirar` en engine/sesiones-grabadas.js).
    grabarAbrirGrabada: async json => ({ ok: true, estado: estadoDeNotas(json) }),
    grabarEditarGrabada: async (json, c) => ({ ok: true, estado: conCambio(estadoDeNotas(json), c) }),
    grabarAbrirToma: async ms => abrirEn(ms),
    grabarCerrarToma: async ms => cerrarEn(ms),
    grabarDeshacer: async () => ({ ok: true, que: 'poner la toma 4 en S', estado: estadoEnVivo() }),
    grabarRehacer: async () => ({ ok: false, estado: estadoEnVivo() }),
    // La app arranca sin ninguna clase grabando: cada escenario va a su
    // pantalla después (`aplicar`).
    grabarEstado: async () => null,
    grabarDisco: async () => (hay('disco-lleno')
        ? { escribible: true, libre: 600e6, minutos: 104 }
        : { escribible: true, libre: 300e9, minutos: 52000 }),
    grabarCambiarEntrada: async como => ({ ok: true, toma: null, estado: { ...laSesion(), dispositivo: como.dispositivo } }),
    grabarListar: async () => sesiones(),
    grabarCarpetas: async dirs => (dirs || []).map(ruta => {
        const r = RECIENTES.find(x => x[0] === ruta);
        return { ruta, nombre: ruta.split('/').pop(), existe: true, clases: r ? r[1] : sesiones().length,
            ultimaMs: r ? new Date(r[2]).getTime() : null };
    }),
    grabarRenombrar: async () => ({ ok: true, secuencia: 'renombrada', movida: true, audios: 1 }),

    /**
     * Cómo se llamaría la clase siguiente.
     *
     * La cuenta es la del motor —el más alto más uno, y V2 si ese número ya
     * está— hecha sobre las sesiones falsas: así la maqueta muestra la 04 porque
     * hay una 03, y no un número escrito a mano que mañana no cuadra con la
     * lista de al lado. Armar el nombre sí se repite, y es lo único: `armar`
     * vive en el motor y acá no se puede importar.
     */
    grabarNombreSiguiente: async (dir, que) => {
        const q = que || {};
        const suyas = SESIONES;
        const pedido = q.numero != null && q.numero !== '' ? Math.floor(Number(q.numero)) : null;
        const numero = pedido != null
            ? pedido
            : suyas.reduce((alto, s) => Math.max(alto, s.numero || 0), 0) + 1;
        const vez = suyas
            .filter(s => s.numero === numero)
            .reduce((alta, s) => Math.max(alta, s.vez || 1), 0) + 1;
        const cursoDicho = (ajustes.carpeta || '').split('/').filter(Boolean).pop() || 'clase';
        const curso = String(cursoDicho).toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const dosDigitos = String(numero).padStart(2, '0');
        return {
            numero,
            vez,
            cuandoMs: Date.now(),
            nombre: `${dosDigitos}_${vez > 1 ? `V${vez}_` : ''}${curso}_2026-09-29_10-15-00`,
            corto: `${dosDigitos}_${vez > 1 ? `V${vez}_` : ''}${curso}`
        };
    },
    grabarBorrar: async () => ({ ok: true, secuencia: 'borrada', audios: 1 }),
    grabarRegenerar: async () => ({ ok: true, tomas: 6, sinAudio: 0, degradadas: 0, sinLeer: 0 }),
    grabarRehacerXml: async () => ({ ok: true, tomas: 6 }),
    grabarTerminar: async () => cerrada(),
    onGrabarAviso: cb => avisos.push(cb),

    // El menú del .prproj: dos capturas, una vista anidada y otra suelta —los
    // dos estados del botón de unir— y en X2 una captura puesta en todas las
    // tomas y la otra solo en las suyas, que son las dos palabras del menú.
    prprojConfig: async carpeta => ({
        ok: true,
        // Con `prproj-lleno`, el peor caso del menú: las seis capturas, y una
        // vista que usa todas. Es lo que hay que mirar para saber si el menú
        // sigue cabiendo en la ventana más chica que la app deja abrir.
        config: hay('prproj-lleno') ? {
            capturas: 6,
            vistas: {
                PV: { capturas: [1, 2, 3, 4, 5, 6], unidas: false, siempre: [1, 2, 3, 4, 5, 6] },
                R: { capturas: [2, 1], unidas: true, siempre: [2, 1] },
                S: { capturas: [1, 2, 3], unidas: true, siempre: [1, 2, 3] },
                MG: { capturas: [1, 2], unidas: false, siempre: [1, 2] },
                X2: { capturas: [1, 2], unidas: true, siempre: [1, 2] }
            }
        } : {
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
        curso: String(carpeta).split('/').pop(),
        ejemplo: { nombre: '03_curso-de-automatizaciones', segundos: 9820 },
        guardada: true,
        destino: `${carpeta}/Proyecto/${String(carpeta).split('/').pop()}.prproj`,
        plantilla: true
    }),
    prprojPistas: async (config, usadas) => ({ ok: true, pistas: pistasDeLaMaqueta(config, usadas) }),
    prprojGenerar: async carpeta => ({
        ok: true,
        ruta: `${carpeta}/Proyecto/${String(carpeta).split('/').pop()}.prproj`,
        cuenta: ['3 clase(s) en 2 captura(s) y 1 grupo(s), de 412 minutos con 5 de aire entre clases.',
            '3 precortada(s) con 41 toma(s).'],
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
    reporteArmar: async () => ({ ok: true, archivo: '/Users/maqueta/Downloads/NoteTaker-reporte-20261023-174201.zip', partes: [], faltan: [] }),
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
        // Un `MediaStream` vacío de verdad y no un objeto parecido: la vista
        // previa de la cámara lo pega en un `<video>`, y `srcObject` solo
        // acepta uno de verdad. Vacío quiere decir sin fotogramas, que es lo
        // que la maqueta no puede inventar.
        getUserMedia: async () => new MediaStream(),
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
    constructor() {
        // «vaciar» se contesta como el worklet de verdad (`pcm-worklet.js`).
        const port = { onmessage: null, postMessage: m => {
            if (m === 'vaciar') setTimeout(() => port.onmessage && port.onmessage({ data: 'vaciado' }), 0);
        } };
        this.port = port;
        capturador = this;
    }
    disconnect() { if (capturador === this) capturador = null; }
};

/* ─── El escenario ────────────────────────────────────────────────────── */

const espera = ms => new Promise(r => setTimeout(r, ms));

/**
 * Esperar a que algo aparezca, en vez de esperar un rato y cruzar los dedos.
 *
 * Los ratos fijos de acá abajo son para animaciones que duran lo que duran. Esto
 * es para lo otro: lo que tarda lo que tarde. Contar un rato que alcance es
 * apostar; esperar el botón es saber.
 */
async function hastaQue(selector, comoSeLlama) {
    for (let i = 0; i < 300; i++) {
        if (document.querySelector(selector)) return document.querySelector(selector);
        await espera(20);
    }
    throw new Error(`${comoSeLlama || selector} no apareció en 6 s`);
}

/** Apretar algo que TIENE que estar. Si no está, se dice en voz alta. */
async function apretar(selector, comoSeLlama) {
    const boton = document.querySelector(selector);
    if (!boton) throw new Error(`no encontré ${comoSeLlama || selector} para apretar`);
    boton.click();
}

/**
 * Empujarle a la ventana un aviso del motor, desde afuera.
 *
 * Es la única manera de comprobar lo que la ventana hace con lo que LLEGA y no
 * con lo que pide: que un estado nuevo repinte, y que con un menú abierto el
 * texto de debajo se quede quieto.
 */
window.maqueta = { avisar: a => { for (const cb of avisos) cb(a); }, conAudio: () => conAudio() };

async function aplicar() {
    // Se espera el arranque de verdad y no un rato al azar: `arrancar` lee los
    // ajustes y lista la carpeta, así que empujar la app antes de que termine
    // la devolvía a Sesiones un instante después (ver `dev.listo` en `app.js`).
    while (!window.dev) await espera(10);
    await window.dev.listo;
    const app = window.dev.app;
    if (!app) return;

    if (hay('iconos')) return verIconos();

    // El número de clase abierto para cambiarlo. Es el único estado de la
    // primera pantalla que no se veía desde ninguna herramienta: «Cambiar el
    // número de clase», en el menú «···», reemplaza el título de la fila por un
    // campo, y una fila que nadie dibuja es una fila que nadie audita.
    if (hay('numero-de-clase')) {
        await apretar('.ses-fila [data-hace="menu"]', 'el «···» de la primera clase');
        await apretar('#ses-menu [data-hace="renombrar"]', 'cambiar el número, en el menú');
        await hastaQue('[data-campo="numero"]', 'el campo del número');
        return;
    }

    if (hay('preparar') || hay('preparar-clase-repetida') || hay('preparar-sin-audio') ||
        hay('sin-whisper') || hay('preparar-microfono') || hay('preparar-zoom-falso') ||
        hay('sin-zoom') || hay('disco-lleno')) {
        await app.irAPreparar();
        // Escribir el número de una clase que ya está grabada: la pantalla tiene
        // que decir que va a quedar como V2 ANTES de grabar tres horas.
        if (hay('preparar-clase-repetida')) {
            const campo = await hastaQue('[data-campo="numero"]', 'el número de clase');
            campo.value = '2';
            campo.dispatchEvent(new Event('change', { bubbles: true }));
            await espera(120);
        }
        // El nivel entrando, que es lo que dice «hay algo del otro lado».
        //
        // Sin `await`: `conAudio` es un surtidor que bombea nivel durante casi
        // un minuto, no un paso que termina. Esperarlo dejaba a
        // `window.maquetaPuesta` sin resolver todo ese rato, y los tools que lo
        // aguardan tardaban 48 s por escenario en vez de medio segundo.
        if (!hay('preparar-sin-audio')) {
            conAudio();
            // Pero sí el primer pico: lo que la captura tiene que mostrar es el
            // medidor con algo dentro, y eso llega en la primera vuelta.
            await espera(120);
        }
        return;
    }

    if (hay('en-vivo') || hay('toma-abierta') || hay('releyendo') || hay('sin-audio') ||
        hay('foto') || hay('foto-cien')) {
        const estado = estadoEnVivo(estadoDeLaClase());
        vivo = estado;
        app.irAVivo(estado, {
            abierto: true, caido: hay('sin-audio'), pico: 0.42,
            dispositivo: 'Audio del sistema (Zoom, Meet, lo que suene)', clase: 'llamada'
        });
        // Una toma cerrada desplegada: es donde se ven los dos bordes y las orillas.
        if (hay('desplegada')) document.querySelector('#lista-vivo [data-hace="plegar"][data-toma="1"]').click();
        // La foto del OUT en grande, abierta desde el bloque de su toma: es lo
        // que se mira para retomar, o lo que se copia para mandarle al profesor.
        if (hay('foto') || hay('foto-cien')) {
            await espera(120);
            document.querySelector('#lista-vivo [data-hace="plegar"][data-toma="1"]').click();
            await espera(60);
            const mini = document.querySelector('#lista-vivo [data-hace="ver-foto"][data-toma="1"]');
            if (mini) mini.click();
            await espera(120);
            // Y al 100 %, que es el estado en que la foto es más grande que el
            // panel: el que se desplaza tiene que ser el marco.
            if (hay('foto-cien')) {
                document.querySelector('#btn-foto-zoom').click();
                await espera(60);
            }
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

    if (hay('terminada') || hay('terminada-vacia')) {
        app.irACierre(cerrada());
        return;
    }

    // El menú de «Generar .prproj», y con `prproj-listo` ya generado.
    if (hay('prproj') || hay('prproj-listo') || hay('prproj-lleno')) {
        await app.irASesiones();
        document.querySelector('#btn-prproj').click();
        await espera(80);
        if (hay('prproj-listo')) {
            document.querySelector('#btn-prproj-generar').click();
            await espera(80);
        }
        return;
    }

    // Con nivel entrando: el medidor de la entrada está en Ajustes también.
    if (hay('ajustes')) { await app.verAjustes(); conAudio(); }
    if (hay('diagnostico')) app.verDiagnostico();
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
 * Lo que devuelve «Terminar»: la sesión, con los segundos del audio y lo que
 * encontró la comprobación del final (`engine/comprobar-clase.js`).
 */
function cerrada() {
    // `terminada-vacia` es una prueba de tres segundos sin ninguna toma: la
    // pantalla tiene que decirlo sin parecer rota.
    if (hay('terminada-vacia')) {
        return { ...estadoEnVivo(), secuencia: '01_pruebas_2026-11-10_11-10-43', corto: '01_pruebas', curso: 'Pruebas',
            grabando: false, segundos: 3, tomas: [], comprobacion: { ok: true, problemas: [] } };
    }
    return { ...estadoEnVivo(), corto: 'curso-de-automatizaciones', grabando: false, segundos: 1043,
        comprobacion: { ok: true, problemas: [] } };
}

/** La sesión que el motor devolvería. */
function laSesion() {
    if (vivo) return vivo;
    return estadoEnVivo();
}

/** Un cambio sobre una toma de la sesión viva: para VER que el gesto llega. */
function cambiarEnVivo(c) {
    const base = laSesion();
    // La vista de la toma que todavía no empezó: no es de ninguna toma, así
    // que no la busca. Es lo que la barra marca entre toma y toma.
    if (c && c.tipo === 'vista-proxima') {
        vivo = { ...base, vistaProxima: c.vista };
        return vivo;
    }
    if (!c || !Number.isFinite(Number(c.toma))) return base;
    const toma = base.tomas.find(t => t.id === Number(c.toma));
    if (!toma) return base;
    // Descartar saca la toma de la lista, igual que `eliminar` en el motor, y
    // deja un paso atrás: es lo que la pantalla mira para encender «Deshacer».
    // La abierta no, que el motor también se planta ahí.
    if (c.tipo === 'eliminar') {
        if (toma.outMs == null) return base;
        vivo = {
            ...base,
            tomas: base.tomas.filter(t => t !== toma),
            historia: { ...base.historia, atras: (base.historia.atras || 0) + 1,
                queAtras: `descartar la toma ${toma.id}` }
        };
        return vivo;
    }
    // Partir la toma en dos, para poder VER el gesto completo: dos bloques
    // pegados, la segunda con el número siguiente y las de después corridas.
    // El reparto de verdad está en `vivo.dividir`, con sus pruebas; acá es lo
    // justo para que la pantalla se dibuje como se va a dibujar.
    if (c.tipo === 'dividir') {
        const ms = Number(c.paredMs);
        if (!Number.isFinite(ms) || ms <= toma.inMs) return base;
        if (toma.outMs != null && ms >= toma.outMs) return base;
        const todas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
        const primera = {
            ...toma,
            outMs: ms,
            palabras: todas.filter(w => w.t >= toma.inMs && w.t < ms),
            despues: todas.filter(w => w.t >= ms)
        };
        const segunda = {
            ...toma,
            id: toma.id + 1,
            comentario: '',
            inMs: ms,
            antes: todas.filter(w => w.t < ms),
            palabras: todas.filter(w => w.t >= ms && (toma.outMs == null || w.t < toma.outMs)),
            despues: []
        };
        const corridas = base.tomas
            .filter(t => t !== toma && t.id > toma.id)
            .map(t => ({ ...t, id: t.id + 1 }));
        vivo = {
            ...base,
            tomas: base.tomas
                .filter(t => t !== toma && t.id < toma.id)
                .concat([primera, segunda], corridas),
            historia: { ...base.historia, atras: (base.historia.atras || 0) + 1,
                queAtras: `dividir la toma ${toma.id}` }
        };
        return vivo;
    }
    const cambiada = { ...toma };
    if (c.tipo === 'vista') cambiada.vista = c.vista;
    else if (c.tipo === 'descartar') cambiada.descartada = Boolean(c.descartada);
    else return base;
    vivo = { ...base, tomas: base.tomas.map(t => (t === toma ? cambiada : t)) };
    return vivo;
}

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
    const base = laSesion();
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
    const base = laSesion();
    if (base.abierta != null) return base;
    const sueltas = base.sueltas || [];
    const desde = ms != null ? ms : (sueltas.length ? sueltas[Math.max(0, sueltas.length - 8)].t : base.ceroMs);
    const id = Math.max(0, ...base.tomas.map(t => t.id)) + 1;
    const toma = {
        ...base.tomas[0], id, vista: 'PV', comentario: '', outMs: null, relectura: null,
        inMs: desde, palabras: sueltas.filter(w => w.t >= desde), antes: [], despues: []
    };
    vivo = { ...base, abierta: id, tomas: base.tomas.concat([toma]), sueltas: sueltas.filter(w => w.t < desde) };
    return { ...vivo, retrocedioSec: ms != null ? 0 : 4.2 };
}

function cerrarEn(ms) {
    const base = laSesion();
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

/**
 * La promesa de que el escenario ya está puesto Y DIBUJADO.
 *
 * Las herramientas la esperan en vez de contar un rato al azar: hay escenarios
 * que tardan en armarse —abrir una clase, apretar cosas— y una espera fija
 * dejaba la foto a medio camino sin decirlo.
 *
 * Las dos vueltas de `requestAnimationFrame` al final son la diferencia entre
 * «el guion terminó» y «la pantalla se puede fotografiar»: el último `.click()`
 * vuelve antes de que el navegador haya pintado lo que ese clic cambió. Sin
 * ellas, las tres herramientas esperaban esta promesa y DESPUÉS dormían 300 ms
 * por si acaso, que es exactamente la espera al azar que esto venía a borrar.
 *
 * Y si algo falla, falla a la vista: devuelve `{ok: false}` con el error en vez
 * de rechazar. Un rechazo se lo comía el `.catch(() => {})` de las herramientas
 * y la foto salía de una pantalla a medio armar, medida y auditada como si
 * fuera la buena.
 */
window.maquetaPuesta = aplicar()
    .then(() => new Promise(listo => requestAnimationFrame(() => requestAnimationFrame(listo))))
    .then(() => ({ ok: true }))
    .catch(e => ({ ok: false, error: String((e && e.message) || e) }));
