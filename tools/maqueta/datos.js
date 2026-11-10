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
    { nombre: 'PV', titulo: 'Profesor', colorDeMarcador: 4281740498 },
    { nombre: 'R', titulo: 'Pantalla', colorDeMarcador: 4280578025 },
    { nombre: 'S', titulo: 'Slides', colorDeMarcador: 4281828977 },
    { nombre: 'MG', titulo: 'Motion Graphics', colorDeMarcador: 4294345275 },
    { nombre: 'X2', titulo: 'Acelerar', colorDeMarcador: 4289825711 }
];

const TOMAS = [
    {
        id: 1, vista: 'PV', comentario: 'Intro y bienvenida', cuenta: '3, 2, 1.',
        inMs: seg(62), outMs: seg(184), descartada: false, cerradaSola: false,
        palabras: palabras('Hola y bienvenidos a la clase de hoy vamos a ver cómo se arma ' +
            'un flujo completo desde cero hasta produccion', 62),
        antes: palabras('tres dos uno', 60), despues: palabras('pausa che', 185),
        // La única toma con comentarios sobre pedazos del texto: son el renglón
        // que se corrige con doble clic, y sin ninguno en la maqueta no lo
        // medía ni lo auditaba nadie. Dos, porque lo que puede salir mal es que
        // el índice se corra entre uno y otro.
        comentarios: [
            { desdeMs: seg(64), hastaMs: seg(67), texto: 'bienvenidos a la clase de hoy',
                comentario: 'Arranca acá de verdad' },
            { desdeMs: seg(70), hastaMs: seg(74), texto: 'desde cero hasta produccion',
                comentario: 'Revisar si esto aporta' }
        ],
        relectura: null, repiteA: null, pausaAdentro: null
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
        // La toma de antes de la abierta: su texto se ve durante la toma
        // siguiente, en lo gris de antes del IN y con su color, para poder hacer
        // scroll y seleccionar sin esperar a que esta cierre (ver
        // `antesDeLaAbierta` en grabar/alrededor-de-la-toma.js). Tiene palabras aunque esté
        // «sin releer» porque es lo que pasa de verdad: el ciclo en vivo ya las
        // escribió y la relectura solo las afina.
        id: 6, vista: 'PV', comentario: 'Preguntas', cuenta: '3, 2, 1.',
        inMs: seg(820), outMs: seg(1010), descartada: false, cerradaSola: false,
        palabras: palabras('Y acá viene la parte de las preguntas que es donde se ve si ' +
            'quedó claro miren lo que pregunta alguien del chat porque es justo la duda ' +
            'que yo tenía la primera vez que armé uno de estos', 820),
        antes: [], despues: [], comentarios: [],
        relectura: { estado: 'sin-leer', bueno: 'ggml-large-v3-turbo.bin' },
        repiteA: null, pausaAdentro: null
    }
];

/**
 * Lo que se oyó después de la última toma, sin ninguna abierta: el texto del
 * campo de espera. Empieza apenas después del OUT de la 6 (1010 s).
 *
 * Lleva adentro una «pausa» dicha hablando de otra cosa, con la clase
 * siguiendo detrás: es la que el motor anota como `pausa-corta` y NO cierra
 * nada, y hace falta para mirar cómo queda marcada.
 */
const SUELTAS = palabras(
    'bueno ahora vamos con lo siguiente acá hacemos una pausa en el flujo y ' +
    'conectamos el disparador con la condición de salida fíjense que cuando ' +
    'cambia el valor se vuelve a evaluar todo desde el principio', 1015);

/** El estado de una sesión en curso, como lo manda `espejo.resumen`. */
export function estadoEnVivo(extra) {
    const estado = Object.assign({
        secuencia: 'curso-de-automatizaciones_2026-09-29_09-00-00',
        curso: 'Curso de automatizaciones',
        ceroMs: CERO,
        fps: 29.97,
        // En automático y oyendo español, que es como sale de fábrica: así la
        // maqueta enseña el rótulo «Auto · ES» que se ve en una clase de verdad.
        idioma: 'auto',
        idiomaOido: 'es',
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
        // El ciclo al día, que es lo normal: medio segundo de atraso y nada
        // salteado.
        atrasoSec: 0.5,
        salteadoSec: 0,
        abierta: null,
        sueltas: SUELTAS,
        historia: { atras: 3, adelante: 0, queAtras: 'poner la toma 4 en S', queAdelante: '' },
        tomas: TOMAS
    }, extra || {});
    // Como `espejo.resumen`: las que van al XML (`tomasQueQuedan`), contadas
    // sobre las tomas que hayan quedado puestas.
    estado.porReleer = estado.tomas.filter(t => !t.descartada && t.inMs != null && t.outMs != null).length;
    return estado;
}

/** Las sesiones que hay en la carpeta, como las manda `sesiones-grabadas.listar`. */
export const SESIONES = [
    {
        secuencia: '03_curso-de-automatizaciones_2026-09-28_09-02-11',
        curso: 'Curso de automatizaciones',
        numero: 3,
        vez: 1,
        ceroMs: new Date('2026-09-28T09:02:11').getTime(),
        archivos: { xml: '/x/a.xml', json: '/x/a_notas-en-vivo.json' },
        resumen: { tomas: 14, descartadas: 2, segundos: 9820, sinReleer: 0, estado: 'terminada' }
    },
    {
        secuencia: '02_V2_curso-de-automatizaciones_2026-09-27_14-30-00',
        curso: 'Curso de automatizaciones',
        numero: 2,
        vez: 2,
        ceroMs: new Date('2026-09-27T14:30:00').getTime(),
        archivos: { xml: '/x/b.xml', json: '/x/b_notas-en-vivo.json' },
        resumen: { tomas: 9, descartadas: 0, segundos: 5410, sinReleer: 3, estado: 'sin releer' }
    },
    {
        secuencia: '02_curso-de-automatizaciones_2026-09-26_10-00-00',
        curso: 'Curso de automatizaciones',
        numero: 2,
        vez: 1,
        ceroMs: new Date('2026-09-26T10:00:00').getTime(),
        archivos: { xml: '/x/c.xml', json: '/x/c_notas-en-vivo.json' },
        resumen: { tomas: 6, descartadas: 1, segundos: 2140, sinReleer: 0, estado: 'abierta' }
    }
];

export const AJUSTES = {
    version: 2,
    carpeta: '/Volumes/Rodaje/Curso de automatizaciones',
    carpetas: ['/Volumes/Rodaje/Curso de automatizaciones'],
    curso: 'Curso de automatizaciones',
    fps: 29.97,
    idioma: 'auto',
    dispositivo: 'Audio del sistema (Zoom, Meet, lo que suene)',
    // Sin cámara de referencia: es como arranca la app, y es lo que deja que la
    // maqueta corra en una máquina sin ninguna cámara. Las fotos que se ven en
    // los bloques son las que el doble dice que ya están en el disco.
    camara: null,
    // Las de fábrica, más una de cada tipo como las que agregaría alguien.
    frases: {
        cuenta: true,
        abrir: ['retomamos', 'retoma'],
        cerrar: ['pausa', 'pause'],
        vista: [{ frase: 'vamos a nuestra pantalla', vista: 'R' }, { frase: 'volvemos a las slides', vista: 'S' }]
    }
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

// Las cámaras, con los mismos nombres que da una Mac: la del Mac, la
// Rodecaster por USB-C y la virtual del OBS, que es por donde entra el NDI.
export const CAMARAS = [
    { id: 'facetime', nombre: 'FaceTime HD Camera' },
    { id: 'rodecaster', nombre: 'RØDECaster Video' },
    { id: 'obs', nombre: 'OBS Virtual Camera' }
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
        { key: 'whisper-server (el texto en vivo)', required: false, found: true, name: 'whisper-server', source: 'incluido en la app', searched: [] },
        { key: 'modelo liviano (respaldo del texto en vivo)', required: false, found: true, name: 'ggml-small.bin', source: '/Library/Application Support/Note Taker/models', searched: [] },
        { key: 'modelo al que bajar si el grande se muere', required: false, found: true, name: 'ggml-small.bin', source: '488 MB contra 1.5 GB del grande', searched: [] }
    ]
};

export const SALIDA = {
    ...estadoEnVivo(),
    terminando: false,
    archivos: estadoEnVivo().archivos
};
