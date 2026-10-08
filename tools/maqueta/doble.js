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

import { estadoEnVivo, estadoSemanal, SESIONES, SEMANALES, AJUSTES, ENTRADAS, CAMARAS, DOCTOR } from './datos.js';

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
    'preparar-zoom-falso',
    'sin-whisper', 'sin-zoom', 'faltan-modelos', 'update',
    'en-vivo', 'desplegada', 'claqueta-abierta', 'toma-abierta', 'releyendo',
    'sin-audio', 'terminada', 'notas-de-antes', 'foto', 'foto-cien',
    'palmada', 'palmada-vencida',
    'prproj', 'prproj-lleno', 'prproj-listo',
    'ajustes', 'ajustes-semanal', 'diagnostico', 'iconos',
    'semanal', 'semanal-primera-vez', 'semanal-sin-pantalla', 'semanal-grabando', 'semanal-sin-tomas',
    'semanal-con-aviso', 'semanal-ficha', 'semanal-revisar', 'semanal-revisar-fuera',
    'semanal-cortando', 'semanal-hecho'
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

/**
 * Y una cara, para el otro lado del selector de la revisión.
 *
 * Esa pantalla pregunta «¿esta toma con tu cara o con tu pantalla?», así que
 * las dos miniaturas tienen que distinguirse de un vistazo o no se está
 * mirando el diseño que se quiere mirar. Dibujada igual de a mano y por el
 * mismo motivo: que no se pueda confundir con la cara de nadie.
 */
const CARA_FALSA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="#1a1d24"/>
      <rect x="0" y="120" width="320" height="60" fill="#151821"/>
      <circle cx="160" cy="78" r="34" fill="#39404f"/>
      <circle cx="148" cy="72" r="3.4" fill="#aab4c4"/><circle cx="172" cy="72" r="3.4" fill="#aab4c4"/>
      <path d="M146 92q14 10 28 0" stroke="#aab4c4" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M104 180q0-44 56-44t56 44z" fill="#39404f"/>
      <text x="160" y="170" fill="#6d7686" font-family="Helvetica" font-size="8"
            text-anchor="middle">tu cámara</text>
    </svg>`);

/* ─── El puente ───────────────────────────────────────────────────────── */

const avisos = [];
let ajustes = { ...AJUSTES };
if (hay('sin-carpeta')) ajustes = { ...ajustes, carpeta: null, carpetas: [] };
if (hay('preparar-microfono')) ajustes = { ...ajustes, dispositivo: 'MacBook Pro Microphone (Built-in)' };
if (hay('preparar-zoom-falso')) ajustes = { ...ajustes, dispositivo: 'ZoomAudioDevice (Virtual)' };
if (hay('preparar-sin-audio') || hay('sin-zoom')) ajustes = { ...ajustes, dispositivo: null };
// El panel de Ajustes visto desde el modo semanal: el idioma cambia de rótulo,
// de valor de fábrica y de sitio donde se guarda, y el fps está apagado. No se
// llega cambiando el modo a mano porque cambiarlo navega.
if (hay('ajustes-semanal')) ajustes = { ...ajustes, modo: 'semanal' };

const progresoUpdate = [];
const listaUpdate = [];
const progresoSemanal = [];
const avisosSemanal = [];
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

/**
 * Lo que hay grabado en una carpeta.
 *
 * El modo semanal y el de clase no comparten material, y acá tampoco: se
 * contesta según el modo que esté puesto. Antes esto devolvía siempre las
 * clases, así que la tarjeta de «lo último que grabaste» del modo semanal
 * aparecía con el nombre de un curso, que es algo que no puede pasar.
 *
 * `semanal-primera-vez` es la carpeta recién elegida: no hay nada de antes y la
 * tarjeta no está. Es el estado en el que entra alguien el primer día, y el que
 * no se mira nunca si no se lo nombra.
 */
function sesiones() {
    if (hay('vacio') || hay('sin-carpeta') || hay('semanal-primera-vez')) return [];
    return esLaSemana() ? SEMANALES : SESIONES;
}

window.nt = {
    appInfo: async () => ({ version: '0.1.0', arch: 'arm64', electron: '43.7.5', platform: 'darwin' }),
    doctor: async () => doctor,

    ajustesLeer: async () => ajustes,
    // El parche entra un nivel, igual que `ajustes.conParche` en el motor: con
    // el parche pegado por arriba, guardar la carpeta del vídeo semanal borraba
    // el idioma de al lado, y la maqueta mentía sobre eso.
    ajustesGuardar: async parche => {
        const llano = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
        const nuevos = { ...ajustes };
        for (const [clave, valor] of Object.entries(parche || {})) {
            nuevos[clave] = llano(valor) && llano(ajustes[clave])
                ? { ...ajustes[clave], ...valor }
                : valor;
        }
        ajustes = nuevos;
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

    grabarIniciar: async () => ({ ok: true, estado: laSesion() }),
    grabarReanudar: async () => ({ ok: true, estado: laSesion() }),
    grabarPcm: () => {},
    grabarClaqueta: async () => estadoEnVivo(),
    grabarQuitarClaqueta: async () => estadoEnVivo(),
    grabarEditar: async c => {
        if (c && c.tipo === 'borde' && c.borde === 'in') return moverInEn(Number(c.paredMs));
        return cambiarEnVivo(c);
    },
    // Las notas de una clase ya grabada: el mismo estado de la clase con
    // `grabando: false`, que es lo que la pantalla usa para no dibujar el cromo
    // de grabar (ver `paraMirar` en engine/sesiones-grabadas.js).
    // En el modo semanal, «lo grabado» es la sesión que se acaba de cerrar: es
    // de donde la revisión saca el texto de cada toma para poder moverle los
    // bordes. En el de clase es una clase vieja que se abre a mirar.
    grabarAbrirGrabada: async json => ({
        ok: true,
        estado: esLaSemana() ? cerradaDelTodo() : estadoDeNotas(json)
    }),
    grabarEditarGrabada: async (json, c) => (esLaSemana()
        ? { ok: true, estado: cambiarEnVivo(c) }
        : { ok: true, estado: conCambio(estadoDeNotas(json), c) }),
    grabarAbrirToma: async ms => abrirEn(ms),
    grabarCerrarToma: async ms => cerrarEn(ms),
    grabarDeshacer: async () => ({ ok: true, que: 'poner la toma 4 en S', estado: estadoEnVivo() }),
    grabarRehacer: async () => ({ ok: false, estado: estadoEnVivo() }),
    grabarEstado: async () => laSesion(),
    grabarVistas: async () => estadoEnVivo().vistas,
    grabarListar: async () => sesiones(),
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
        const suyas = esLaSemana() ? [] : SESIONES;
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
            nombre: `${dosDigitos}_${vez > 1 ? `V${vez}_` : ''}${curso}_2026-09-29_10-15-00`
        };
    },
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
    /* ─── El modo semanal ──────────────────────────────────────────────
     *
     * Lo mismo que el resto del puente: se contesta lo que contestaría Node,
     * sin escribir nada. El progreso del corte se empuja en escalones para que
     * la barra se vea moverse, que es lo único que esa tarjeta tiene que
     * mostrar bien.
     */
    semanalAbrir: async pedido => ({
        ok: true, id: 1, cual: pedido.cual, tipo: pedido.tipo, empezoMs: pedido.empezoMs,
        archivo: `/Users/daniel/Movies/Semanal/xml/Video/semana-${pedido.cual}.mp4`
    }),
    semanalTrozo: () => {},
    semanalCerrar: async () => ({
        ok: true, enLaSesion: 2,
        videos: [
            { cual: 'camara', bytes: 48_000_000, segundos: 214 },
            { cual: 'pantalla', bytes: 96_000_000, segundos: 214 }
        ]
    }),
    /**
     * El montaje: dónde cae cada toma en los dos vídeos crudos.
     *
     * Sale de las MISMAS tomas que la lista de mientras se graba, y no de una
     * lista escrita al lado: con las dos a mano se iban separando —una decía
     * cuatro tomas y la otra otras cuatro distintas— y la maqueta dejaba de
     * servir justo para lo que está, que es mirar el camino entero.
     *
     * Los «vídeos crudos» son dos sintéticos de 40 s hechos con ffmpeg, uno
     * apaisado y chico como una cámara y el otro 1920x1080 como una pantalla,
     * los dos con una barra que viaja: así se ve de un golpe cuál de los dos
     * está puesto, que el encuadre es el que le toca a cada uno (la cámara
     * recortada, la pantalla entera) y que el reproductor buscó donde dijo.
     *
     * Y los segundos de cada toma son los del TRAMO, no los de la sesión falsa:
     * si dijeran 56 s y el tramo durara ocho, el salto a la toma siguiente no se
     * podría probar. La toma 3 se queda sin pantalla a propósito: es el caso feo
     * —una fuente que no cubre esa toma— y hay que poder ver cómo se dice.
     */
    semanalMontaje: async () => {
        if (hay('semanal-sin-tomas')) return { ok: true, tomas: [], avisos: [] };
        const cerradas = laSesion().tomas.filter(t => t.outMs != null);
        // A cada toma, un tramo suyo del archivo, en orden y de distinto largo:
        // con todos iguales la línea de tomas saldría en trozos iguales y no se
        // vería que cada trozo mide lo que dura.
        const LARGOS = [7, 3, 9, 5];
        let desde = 1;
        return {
            ok: true,
            avisos: hay('semanal-con-aviso')
                ? ['La toma 3 va sin la cámara: ese trozo no está grabado.'] : [],
            archivos: {
                camara: '/maqueta/semanal-camara.mp4',
                pantalla: '/maqueta/semanal-pantalla.mp4'
            },
            recuadro: { lado: 0.1875, margen: 0.025, redondeo: 0.125 },
            tomas: cerradas.map((t, i) => {
                const sinPantalla = t.id === 3;
                const pide = t.vista === 'PV' ? 'camara' : 'pantalla';
                const largo = LARGOS[i % LARGOS.length];
                const arranca = desde;
                desde += largo + 1;
                return {
                    id: t.id,
                    vista: t.vista,
                    descartada: Boolean(t.descartada),
                    segundos: largo,
                    fondo: sinPantalla ? 'camara' : pide,
                    camaraDesde: arranca,
                    pantallaDesde: sinPantalla ? null : arranca,
                    conAudio: true
                };
            })
        };
    },

    semanalExportar: async (json, como) => {
        for (const pct of [8, 24, 51, 78, 96]) {
            for (const cb of progresoSemanal) cb({ pct, segundos: pct * 1.6, total: 162 });
            // Despacio solo donde la barra es lo que se mira. En los demás
            // escenarios el corte falso tiene que terminar dentro del rato que
            // esperan `capturar.js` y compañía, o la foto sale con la barra a
            // medias en vez de con el vídeo listo.
            await espera(hay('semanal-cortando') ? 4000 : 20);
        }
        if (hay('semanal-sin-tomas')) {
            return {
                ok: false, tomas: 0,
                error: 'No se abrió ninguna toma: no hay nada que cortar. '
                    + 'Los vídeos y el audio quedaron guardados.'
            };
        }
        // Con los silencios quitados el vídeo dura menos y sale en más
        // pedazos: es lo que hay que poder ver en la pantalla del final para
        // saber si la opción hizo algo o no.
        const quita = Boolean(como && como.quitarSilencios);
        return {
            ok: true,
            tomas: 3,
            pedazos: quita ? 7 : 3,
            segundos: quita ? 134 : 162,
            bytes: quita ? 34_100_000 : 41_300_000,
            // Un vídeo de verdad, servido por la maqueta: el reproductor del
            // final se mide y se captura con algo que carga y se puede mover,
            // no con un cuadro negro. La pantalla resuelve la ruta contra la
            // página (`urlDeArchivo`), así que acá una ruta del servidor y en
            // la app una del disco son lo mismo.
            ruta: '/maqueta/semana_2026-10-03_09-12-40.mp4',
            avisos: (hay('semanal-con-aviso')
                ? ['La toma 3 va sin la cámara: ese trozo no está grabado.']
                : []
            ).concat(quita ? ['Se quitaron 4 silencio(s) de más de 0.7 s: 28 s menos de vídeo.'] : [])
        };
    },
    onSemanalProgreso: cb => progresoSemanal.push(cb),
    onSemanalAviso: cb => avisosSemanal.push(cb),

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
        // Un `MediaStream` vacío de verdad y no un objeto parecido: la
        // pantalla del modo semanal lo pega en un `<video>`, y `srcObject`
        // solo acepta uno de verdad. Vacío quiere decir sin fotogramas, que es
        // lo que la maqueta no puede inventar.
        getUserMedia: async () => new MediaStream(),
        enumerateDevices: async () => [
            ...ENTRADAS.map(d => ({ kind: 'audioinput', deviceId: d.id, label: d.nombre })),
            ...CAMARAS.map(d => ({ kind: 'videoinput', deviceId: d.id, label: d.nombre }))
        ]
    }
});

/**
 * La pantalla y el grabador de vídeo, falseados por el mismo motivo que el
 * `AudioContext`: sin un `MediaStream` de verdad no se pueden armar.
 *
 * El selector de pantalla de macOS no se puede contestar desde una maqueta, y
 * `MediaRecorder` necesita una pista real. Lo que la maqueta no puede probar
 * sigue siendo lo mismo que con el micrófono: que la captura abra. Lo que sí
 * prueba —y es para lo que está— es que la pantalla del modo semanal recorra
 * sus cuatro momentos por el camino de verdad.
 */
navigator.mediaDevices.getDisplayMedia = async () => ({
    getTracks: () => [{ label: 'Pantalla 1 · Studio Display', stop: () => {} }],
    getVideoTracks: () => [{
        label: 'Pantalla 1 · Studio Display',
        getSettings: () => ({ width: 3008, height: 1692 }),
        stop: () => {},
        set onended(_fn) { /* la maqueta no suelta la pantalla sola */ }
    }]
});

window.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; }
    start() { this.state = 'recording'; }
    stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
    }
};

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
 * Esperar a que algo aparezca, en vez de esperar un rato y cruzar los dedos.
 *
 * Los ratos fijos de acá abajo son para animaciones que duran lo que duran. Esto
 * es para lo otro: lo que tarda lo que tarde. El corte falso, por ejemplo, va por
 * cinco pasos de barra antes de dar el vídeo, y cuánto suma eso depende del
 * escenario. Contar un rato que alcance es apostar; esperar el botón es saber.
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

    // El número de clase abierto para cambiarlo. Es el único estado de la
    // primera pantalla que no se veía desde ninguna herramienta: el lápiz
    // reemplaza la fila entera por un campo, y una fila que nadie dibuja es una
    // fila que nadie audita.
    if (hay('numero-de-clase')) {
        await apretar('.fila [data-hace="renombrar"]', 'el lápiz de la primera clase');
        await hastaQue('[data-campo="numero"]', 'el campo del número');
        return;
    }

    if (hay('preparar') || hay('preparar-clase-repetida') || hay('preparar-sin-audio') ||
        hay('sin-whisper') || hay('preparar-microfono') || hay('preparar-zoom-falso') ||
        hay('sin-zoom')) {
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
        hay('palmada') || hay('palmada-vencida') || hay('foto') || hay('foto-cien')) {
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

    if (hay('terminada')) {
        app.irACierre(estadoEnVivo());
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

    /* ── El modo semanal, en sus cuatro momentos ───────────────────────
     *
     * Se recorre apretando los botones de verdad, igual que los demás
     * escenarios: elegir la pantalla, Grabar, y Terminar. Lo único puesto a
     * mano es el estado de la grabación que el motor devolvería, que es lo que
     * dibuja el contador de tomas.
     */
    if (esLaSemana()) {
        await app.irASemanal();
        await espera(120);
        // Sin pantalla elegida no hay botón de grabar: es justamente la
        // pantalla que este escenario retrata, así que acá se termina.
        if (hay('semanal-sin-pantalla')) return;
        await apretar('[data-hace="elegir-pantalla"]', 'Elegir pantalla');
        await espera(120);
        // La pantalla de inicio, con la tarjeta de lo último grabado y sin ella.
        if (hay('semanal') || hay('semanal-primera-vez')) return;

        // Arrancar tarda: antes de grabar se comprueba que el codificador
        // acepte cada fuente (`aguanta` en `src/js/grabar/filmar.js`), y son
        // 200 ms por fuente. Sin esperarlos, acá todavía no hay botón que
        // apretar.
        await apretar('[data-hace="grabar"]', 'Grabar');
        await espera(700);
        if (hay('semanal-grabando') || hay('semanal-ficha')) {
            await espera(300);
            // Una ficha abierta: es donde se le corrigen los bordes a una toma
            // sin esperar al final, que es lo que se pidió después de grabar
            // el primer vídeo de verdad.
            if (hay('semanal-ficha')) {
                await apretar('#semanal-cuerpo [data-hace="plegar"][data-toma="3"]', 'la ficha de la toma 3');
                await espera(120);
            }
            return;
        }

        // Terminar ya no exporta: lleva a la revisión. De ahí en adelante hay
        // que apretar «Cortar y exportar», que es el camino de verdad.
        await apretar('[data-hace="terminar"]', 'Terminar');
        await espera(300);
        // Parado en otra toma, y con las desactivadas ocultas: es el editor
        // cuando ya se decidió qué va y qué no, y la línea de arriba pasa a ser
        // exactamente el corte que va a salir.
        if (hay('semanal-revisar-fuera')) {
            await apretar('.linea-toma[data-toma="3"]', 'la toma 3 en la línea');
            await espera(150);
            await apretar('[data-hace="ocultar-fuera"]', 'Ocultar desactivadas');
            await espera(150);
            return;
        }
        if (hay('semanal-revisar')) return;

        // Sin ninguna toma abierta no hay nada que revisar y «Terminar» ya cortó
        // —y ya falló— sin pasar por acá. Es el único camino que se saltea la
        // revisión, y conviene decirlo: antes esto era un `if (cortar)` que
        // tapaba por igual este caso legítimo y cualquier botón que se hubiera
        // dejado de dibujar por error.
        if (document.querySelector('[data-hace="ver-brutos"]')) return;
        await apretar('[data-hace="exportar"]', 'Cortar y exportar');
        // El corte falso va por cinco pasos de barra. Antes acá se volvía en el
        // acto y las herramientas dormían 300 ms, que alcanzaban por poco:
        // quitada esa siesta, la foto de «semanal-hecho» salía de la barra a
        // medias. Ahora se espera lo que se está esperando de verdad —cada
        // escenario, lo suyo: uno retrata la barra andando y el otro el final.
        if (hay('semanal-cortando')) await hastaQue('.nivel-barra', 'la barra del corte');
        else await hastaQue('[data-hace="ver-brutos"]', 'el vídeo cortado');
        return;
    }

    if (hay('ajustes') || hay('ajustes-semanal')) app.verAjustes();
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
 * La sesión que el motor devolvería, de la clase o del vídeo de la semana.
 *
 * Son dos porque muestran cosas distintas: la semanal no tiene claquetas, ni
 * notas escritas, ni más vistas que la pantalla y la cámara. Con una sola, la
 * maqueta del modo semanal enseñaba tomas en «Slides» y renglones que decían
 * «Los tres pilares», y eso no es lo que ve quien graba su semana.
 */
const esLaSemana = () => [...escenarios].some(e => e.startsWith('semanal'));

function laSesion() {
    if (vivo) return vivo;
    return esLaSemana() ? estadoSemanal() : estadoEnVivo();
}

/** La sesión con todas las tomas cerradas: lo que deja Terminar. */
function cerradaDelTodo() {
    const base = laSesion();
    vivo = {
        ...base,
        grabando: false,
        abierta: null,
        tomas: base.tomas.map(t => (t.outMs == null ? { ...t, outMs: t.inMs + 30000 } : t))
    };
    return vivo;
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
 * Las herramientas la esperan en vez de contar un rato al azar: los escenarios
 * del modo semanal tardan segundos en armarse —elegir pantalla, grabar,
 * terminar, apretar cosas— y una espera fija dejaba la foto a medio camino sin
 * decirlo.
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
