/**
 * datos.js — El relleno de la maqueta. Son datos y nada más: sin lógica.
 *
 * Todo lo que la maqueta muestra sale de acá, y nada más que de acá. Querés ver
 * un nombre más largo, cero tomas o un error más feo: lo cambiás y recargás.
 *
 * Los tiempos son relativos al cero de la sesión y se resuelven al cargar, así
 * que la maqueta se ve igual hoy que en seis meses.
 */

const CERO = new Date('2026-09-29T09:00:00').getTime();
const seg = s => CERO + s * 1000;

function palabras(texto, desdeSeg) {
    return texto.split(' ').map((w, i) => ({
        t: seg(desdeSeg + i * 0.42),
        texto: w,
        hasta: seg(desdeSeg + i * 0.42 + 0.38)
    }));
}

const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor', fuente: 0, colorDeMarcador: 4281740498 },
    { nombre: 'R', titulo: 'Pantalla', fuente: 1, colorDeMarcador: 4280578025 },
    { nombre: 'S', titulo: 'Slides', fuente: 1, colorDeMarcador: 4281828977 },
    { nombre: 'MG', titulo: 'Multi', fuente: 1, colorDeMarcador: 4292277273 },
    { nombre: 'X2', titulo: 'Doble', fuente: 1, colorDeMarcador: 4289825711 }
];

const TOMAS = [
    {
        id: 1, vista: 'PV', comentario: 'Intro y bienvenida', cuenta: '3, 2, 1.',
        inMs: seg(62), outMs: seg(184), descartada: false, cerradaSola: false,
        palabras: palabras('Hola y bienvenidos a la clase de hoy vamos a ver cómo se arma ' +
            'un flujo completo desde cero hasta produccion', 62),
        antes: palabras('tres dos uno', 60), despues: palabras('pausa che', 185),
        comentarios: [], relectura: null, repiteA: null, pausaAdentro: null
    },
    {
        id: 2, vista: 'R', comentario: 'Demo del editor', cuenta: '3, 2, 1.',
        inMs: seg(240), outMs: seg(402), descartada: false, cerradaSola: false,
        palabras: palabras('Miren la pantalla acá tengo el proyecto abierto y lo primero ' +
            'que hago es crear la secuencia con los cuadros correctos', 240),
        antes: [], despues: [], comentarios: [], relectura: null, repiteA: null, pausaAdentro: null
    },
    {
        id: 3, vista: 'PV', comentario: '', cuenta: 'Retomamos.',
        inMs: seg(430), outMs: seg(448), descartada: false, cerradaSola: false,
        palabras: palabras('Hola y bienvenidos a la clase de hoy vamos a', 430),
        antes: [], despues: [], comentarios: [], relectura: null,
        // Empieza diciendo casi lo mismo que la 1: un intento repetido.
        repiteA: 1, pausaAdentro: null
    },
    {
        id: 4, vista: 'S', comentario: 'Los tres pilares', cuenta: '3, 2, 1.',
        inMs: seg(470), outMs: seg(690), descartada: false, cerradaSola: true,
        palabras: palabras('Tres bloques que aparecen de a uno disparador condicion y accion ' +
            'cada uno con su linea de descripcion', 470),
        antes: [], despues: [], comentarios: [],
        relectura: { estado: 'degradada', modelo: 'ggml-small.bin', bueno: 'ggml-large-v3-turbo.bin' },
        repiteA: null, pausaAdentro: null
    },
    {
        id: 5, vista: 'MG', comentario: 'Cierre', cuenta: '3, 2, 1.',
        inMs: seg(720), outMs: seg(795), descartada: true, cerradaSola: false,
        palabras: palabras('Esto se descarto porque el profesor se trabo', 720),
        antes: [], despues: [], comentarios: [], relectura: null, repiteA: null, pausaAdentro: null
    },
    {
        id: 6, vista: 'PV', comentario: 'Preguntas', cuenta: '3, 2, 1.',
        inMs: seg(820), outMs: seg(1010), descartada: false, cerradaSola: false,
        palabras: [], antes: [], despues: [], comentarios: [],
        relectura: { estado: 'sin-leer', bueno: 'ggml-large-v3-turbo.bin' },
        repiteA: null, pausaAdentro: null
    }
];

const CLAQUETAS = [
    { n: 1, ms: seg(12), paredMs: seg(12), frase: 'Claqueta 1, clase 1', confirmada: true, origen: 'golpe,voz' },
    { n: 2, ms: seg(415), paredMs: seg(415), frase: '', confirmada: false, origen: 'golpe' },
    { n: 3, ms: seg(712), paredMs: seg(712), frase: '', confirmada: true, origen: 'editor' }
];

/**
 * Lo que se oyó después de la última toma, sin ninguna abierta: el texto del
 * campo de espera. Empieza apenas después del OUT de la 6 (1010 s).
 */
const SUELTAS = palabras(
    'bueno ahora vamos con lo siguiente entonces lo que hacemos acá es tomar el ' +
    'disparador y conectarlo con la condición de salida y fíjense que cuando ' +
    'cambia el valor se vuelve a evaluar todo el flujo desde el principio', 1015);

/** El estado de una sesión en curso, como lo manda `espejo.resumen`. */
export function estadoEnVivo(extra) {
    return Object.assign({
        secuencia: 'curso-de-automatizaciones_2026-09-29_09-00-00',
        curso: 'Curso de automatizaciones',
        ceroMs: CERO,
        fps: 29.97,
        idioma: 'es',
        claquetas: CLAQUETAS,
        vistas: VISTAS,
        dir: '/Volumes/Rodaje/Curso de automatizaciones',
        archivos: {
            xml: '/Volumes/Rodaje/Curso de automatizaciones/xml/curso-de-automatizaciones_2026-09-29_09-00-00.xml',
            json: '/Volumes/Rodaje/Curso de automatizaciones/xml/Datos/curso-de-automatizaciones_2026-09-29_09-00-00_notas-en-vivo.json'
        },
        grabando: true,
        segundos: 1043,
        releyendo: 0,
        terminando: false,
        abierta: null,
        sueltas: SUELTAS,
        historia: { atras: 3, adelante: 0, queAtras: 'poner la toma 4 en S', queAdelante: '' },
        tomas: TOMAS
    }, extra || {});
}

/** Las sesiones que hay en la carpeta, como las manda `sesiones-grabadas.listar`. */
export const SESIONES = [
    {
        secuencia: 'curso-de-automatizaciones_2026-09-28_09-02-11',
        curso: 'Curso de automatizaciones',
        ceroMs: new Date('2026-09-28T09:02:11').getTime(),
        archivos: { xml: '/x/a.xml', json: '/x/a_notas-en-vivo.json' },
        resumen: { tomas: 14, descartadas: 2, claquetas: 4, segundos: 9820, sinReleer: 0, estado: 'terminada' }
    },
    {
        secuencia: 'curso-de-automatizaciones_2026-09-27_14-30-00',
        curso: 'Curso de automatizaciones',
        ceroMs: new Date('2026-09-27T14:30:00').getTime(),
        archivos: { xml: '/x/b.xml', json: '/x/b_notas-en-vivo.json' },
        resumen: { tomas: 9, descartadas: 0, claquetas: 2, segundos: 5410, sinReleer: 3, estado: 'sin releer' }
    },
    {
        secuencia: 'curso-de-automatizaciones_2026-09-26_10-00-00',
        curso: 'Curso de automatizaciones',
        ceroMs: new Date('2026-09-26T10:00:00').getTime(),
        archivos: { xml: '/x/c.xml', json: '/x/c_notas-en-vivo.json' },
        resumen: { tomas: 6, descartadas: 1, claquetas: 1, segundos: 2140, sinReleer: 0, estado: 'abierta' }
    }
];

export const AJUSTES = {
    version: 1,
    carpeta: '/Volumes/Rodaje/Curso de automatizaciones',
    carpetas: ['/Volumes/Rodaje/Curso de automatizaciones'],
    curso: 'Curso de automatizaciones',
    fps: 29.97,
    idioma: 'es',
    dispositivo: 'Audio de Zoom (la llamada)',
    camara: false
};

// Los nombres son los de verdad de una Mac con Zoom instalado: es la lista
// que confundía, y la maqueta tiene que mostrarla tal cual.
export const ENTRADAS = [
    { id: 'default', nombre: 'Default - AirPods (Bluetooth)' },
    { id: 'airpods', nombre: 'AirPods (Bluetooth)' },
    { id: 'mac', nombre: 'MacBook Pro Microphone (Built-in)' },
    { id: 'iphone', nombre: 'iPhone de Daniel Microphone' },
    { id: 'zoomdev', nombre: 'ZoomAudioDevice (Virtual)' }
];

export const DOCTOR = {
    arch: 'arm64',
    appleSilicon: true,
    ok: true,
    tools: [
        { key: 'ffprobe', required: true, found: true, name: 'ffprobe', source: 'incluido en la app', searched: [] },
        { key: 'ffmpeg', required: true, found: true, name: 'ffmpeg', source: 'incluido en la app', searched: [] },
        { key: 'whisper-cli', required: true, found: true, name: 'whisper-cli', source: 'incluido en la app', searched: [] },
        { key: 'modelo de Whisper', required: true, found: true, name: 'ggml-large-v3-turbo.bin', source: '/Library/Application Support/Note Taker/models', searched: [] },
        { key: 'modelo liviano (notas en vivo)', required: false, found: true, name: 'ggml-small.bin', source: '/Library/Application Support/Note Taker/models', searched: [] },
        { key: 'modelo al que bajar si el grande se muere', required: false, found: true, name: 'ggml-small.bin', source: '488 MB contra 1.5 GB del grande', searched: [] }
    ]
};

export const SALIDA = {
    ...estadoEnVivo(),
    terminando: false,
    archivos: estadoEnVivo().archivos
};
