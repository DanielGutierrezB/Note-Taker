'use strict';
/**
 * fcp-xml.js — Escribe el XML (xmeml v4 / FCP7) que importan Premiere y Resolve.
 *
 * Es el formato de intercambio más portable que hay, con dos condiciones que se
 * respetan acá: **plano** (nada de secuencias anidadas, que es donde Resolve se
 * pierde) y con las rutas absolutas bien escapadas.
 *
 * La cuenta de frames se hace con fracciones exactas. Con 29.97 (30000/1001)
 * redondear el frame rate hace que un marcador y su clip se separen un frame cada
 * pocos minutos, y en una clase de una hora eso ya se ve. El material de este
 * curso resultó ser 30 exactos —el XML del Rodecaster declara 29.97 en el formato,
 * pero ffprobe dice 30/1— así que el frame rate sale siempre del material medido,
 * nunca del XML de origen.
 *
 * La estructura sigue la del generador de Sync, que ya está probado importando en
 * los dos editores.
 *
 * El audio va **canal por canal**, que es la regla del formato y no una manía:
 * una pista de audio lleva UN canal, así que un clip estéreo son dos `clipitem`
 * en dos pistas "explotadas" que el editor vuelve a juntar al importar. Mientras
 * se escribió una sola pista pidiendo el canal 1, Premiere hacía exactamente eso
 * y cada clip llegaba partido en canales sueltos. Cuántos canales tiene cada
 * archivo se mide, no se supone: de los diez WAV del Rodecaster hay dos mono y
 * ocho estéreo (ver `canalesDe`).
 */

// Etiquetas de color de clip. Son los nombres nativos de Premiere; el orden es
// el que se le asigna a la 1ª, 2ª, 3ª… fuente de video, y como el Rodecaster
// numera igual en todas las clases, cada cámara conserva su color en el curso
// entero. Resolve ignora esta etiqueta al importar (ver resolve/README.md).
const CLIP_LABELS = [
    'Cerulean', 'Rose', 'Mango', 'Forest', 'Purple', 'Iris', 'Caribbean', 'Lavender'
];

// Premiere guarda los colores de marcador como enteros; el XML de intercambio los
// quiere como componentes de 16 bits. Este es el mapa que entienden los dos NLE.
const MARKER_COLORS = {
    red: { alpha: 0, red: 65535, green: 0, blue: 0 },
    green: { alpha: 0, red: 0, green: 65535, blue: 0 },
    blue: { alpha: 0, red: 0, green: 0, blue: 65535 },
    cyan: { alpha: 0, red: 0, green: 65535, blue: 65535 },
    magenta: { alpha: 0, red: 65535, green: 0, blue: 65535 },
    yellow: { alpha: 0, red: 65535, green: 65535, blue: 0 },
    white: { alpha: 0, red: 65535, green: 65535, blue: 65535 },
    orange: { alpha: 0, red: 65535, green: 42662, blue: 0 }
};

const NTSC_RATES = [
    { nominal: 23.976, timebase: 24, num: 24000, den: 1001 },
    { nominal: 29.97, timebase: 30, num: 30000, den: 1001 },
    { nominal: 59.94, timebase: 60, num: 60000, den: 1001 }
];

function rateFor(fps) {
    const value = Number(fps) || 30;
    for (const rate of NTSC_RATES) {
        if (Math.abs(value - rate.nominal) < 0.01) {
            return { timebase: rate.timebase, ntsc: true, num: rate.num, den: rate.den };
        }
    }
    const timebase = Math.round(value);
    return { timebase, ntsc: false, num: timebase, den: 1 };
}

/** Segundos → frames, con la fracción exacta del formato. */
function toFrames(seconds, fps) {
    const rate = rateFor(fps);
    return Math.round((Number(seconds) || 0) * rate.num / rate.den);
}

function framesToSeconds(frames, fps) {
    const rate = rateFor(fps);
    return (Number(frames) || 0) * rate.den / rate.num;
}

function xmlSafe(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Los caracteres de control no son válidos en XML 1.0 y un comentario
        // pegado desde otro lado puede traerlos.
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Ruta absoluta → `file://localhost/...` con cada segmento escapado. Sin esto,
 * un espacio o una tilde ("Nicolás", "Clase 04 -Default") deja el clip offline.
 */
function pathUrl(absolutePath) {
    const parts = String(absolutePath).split('/').map(segment => encodeURIComponent(segment));
    return `file://localhost${parts.join('/')}`;
}

function rateXml(fps) {
    const rate = rateFor(fps);
    return `<rate><timebase>${rate.timebase}</timebase><ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
}

function timecodeXml(fps) {
    const rate = rateFor(fps);
    const sep = rate.ntsc ? ';' : ':';
    return `<timecode>${rateXml(fps)}<string>00${sep}00${sep}00${sep}00</string>` +
        `<frame>0</frame><displayformat>${rate.ntsc ? 'DF' : 'NDF'}</displayformat></timecode>`;
}

function videoCharacteristics(fps, width, height) {
    return `<samplecharacteristics>${rateXml(fps)}` +
        `<width>${width || 1920}</width><height>${height || 1080}</height>` +
        '<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>' +
        '<fielddominance>none</fielddominance></samplecharacteristics>';
}

/**
 * Cuántos canales tiene DE VERDAD una fuente. Es el número que decide todo lo
 * que sigue, así que sale de medir el archivo (`media-probe` lo saca de ffprobe)
 * y nunca de suponer por la extensión: de los diez WAV que graba el Rodecaster
 * hay dos mono —los COMBO, que son micrófonos— y ocho estéreo, y las cámaras
 * traen estéreo. Una sola regla para todos deja mal a la mitad del material.
 *
 * Se topa en 2 porque es hasta donde llega lo verificado: el par explotado que
 * escribe Premiere son dos pistas, y una fuente de seis canales pediría una
 * forma que no está en ninguna referencia. Nada de este curso pasa de dos.
 */
function canalesDe(source) {
    const n = Math.round(Number(source && source.channels));
    if (!isFinite(n) || n < 1) return 2;
    return Math.min(2, n);
}

/**
 * Registro de archivos: cada media se define UNA vez —en el bin, que va antes que
 * la secuencia— y todo lo demás la referencia por id. Repetir la definición hace
 * que Premiere importe el mismo archivo varias veces y el proyecto termine con
 * diez copias del mismo clip.
 *
 * El `masterclipid` es lo que ata todos los pedazos de una cámara al mismo clip
 * maestro. De eso depende que un Lumetri puesto en el maestro caiga sobre los
 * dieciséis trozos de la clase, que es como se ajusta todo junto ahora que no
 * hay anidaciones.
 */
class FileRegistry {
    constructor(fps) {
        this.fps = fps;
        this.byPath = new Map();
        this.next = 1;
    }

    register(source) {
        const key = source.path;
        if (!this.byPath.has(key)) {
            this.byPath.set(key, {
                id: `file-${this.next}`,
                masterclip: `masterclip-${this.next}`,
                defined: false,
                source
            });
            this.next++;
        }
        return this.byPath.get(key);
    }

    sources() {
        return [...this.byPath.values()];
    }

    fileXml(source) {
        const entry = this.register(source);
        if (entry.defined) return `<file id="${entry.id}"/>`;
        entry.defined = true;

        const isAudio = Boolean(source.audioOnly);
        const name = xmlSafe(source.name || source.path.split('/').pop());
        const canales = canalesDe(source);
        // Una fuente mono nombra su único canal; una estéreo no lleva
        // `audiochannel` ninguno. Así lo escribe Premiere al exportar este mismo
        // material (`1_COMBO-1.wav` contra `3_HDMI-2.wav`).
        const canalUnico = canales === 1
            ? '<audiochannel><sourcechannel>1</sourcechannel></audiochannel>' : '';
        const media = isAudio
            ? `<audio><samplecharacteristics><depth>${source.bits || 16}</depth>` +
              `<samplerate>${source.sampleRate || 48000}</samplerate></samplecharacteristics>` +
              `<channelcount>${canales}</channelcount>${canalUnico}</audio>`
            : `<video>${videoCharacteristics(this.fps, source.width, source.height)}</video>` +
              '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>' +
              `</samplecharacteristics><channelcount>${canales}</channelcount>${canalUnico}</audio>`;

        return `<file id="${entry.id}"><name>${name}</name>` +
            `<pathurl>${pathUrl(source.path)}</pathurl>` +
            `${rateXml(this.fps)}<duration>${toFrames(source.durationSec, this.fps)}</duration>` +
            `${timecodeXml(this.fps)}<media>${media}</media></file>`;
    }

    /**
     * El clip maestro del bin: define el archivo y le da nombre al conjunto.
     *
     * Y lleva los marcadores del archivo, si se le pasan. **Son el tercer juego
     * y el único que de verdad viaja con el WAV**: los del `<clipitem>` son de
     * ESA instancia en la secuencia, así que arrastrar el audio a otra
     * secuencia o meterlo en un multicámara lo deja sin nada. Los del maestro
     * se ven al abrir el archivo en el monitor de origen y lo acompañan a donde
     * vaya, que es lo que pide un editor que sincroniza a mano y después corta
     * siguiendo las notas.
     *
     * Sus tiempos son los mismos que los del clipitem: segundos DESDE EL
     * ARRANQUE DEL ARCHIVO (`marcadoresDelClip` en `notas-xml.js`).
     */
    binClipXml(source) {
        const entry = this.register(source);
        const name = xmlSafe(source.name || source.path.split('/').pop());
        const duration = toFrames(source.durationSec, this.fps);
        const fileXml = this.fileXml(source);
        const label = source.label
            ? `<labels><label2>${xmlSafe(source.label)}</label2></labels>`
            : '';
        const videoTrack = source.audioOnly ? '' :
            `<video><track><clipitem id="bin-v-${entry.id}"><name>${name}</name>` +
            `<file id="${entry.id}"/></clipitem></track></video>`;
        // Una pista por canal, igual que en la secuencia: en este formato una
        // pista de audio lleva UN canal, y eso vale también para el clip maestro
        // del bin. Con una sola pista, el maestro que el editor arrastra al
        // timeline sabe de un canal nada más.
        const canales = canalesDe(source);
        const pistasDeAudio = [];
        for (let canal = 1; canal <= canales; canal++) {
            pistasDeAudio.push(
                `<track><clipitem id="bin-a${canal}-${entry.id}"><name>${name}</name>` +
                `<file id="${entry.id}"/>` +
                `<sourcetrack><mediatype>audio</mediatype><trackindex>${canal}</trackindex></sourcetrack>` +
                '</clipitem></track>');
        }
        const audioTrack = `<audio>${pistasDeAudio.join('')}</audio>`;

        const marcadores = (source.marcadores || [])
            .map(m => `      ${markerXml(m, this.fps)}`).join('');

        return `        <clip id="masterclip-bin-${entry.id}">` +
            `<masterclipid>${entry.masterclip}</masterclipid>` +
            `<name>${name}</name><duration>${duration}</duration>${rateXml(this.fps)}` +
            `<ismasterclip>TRUE</ismasterclip>` +
            `${label}${fileXml}<media>${videoTrack}${audioTrack}</media>` +
            `${marcadores ? `\n${marcadores}        ` : ''}</clip>\n`;
    }
}

/**
 * Los hermanos de un clip: los `clipitem` que son el MISMO clip repartido en
 * canales. Sin esto, los dos canales de un estéreo son dos objetos sueltos que
 * se mueven y se recortan por separado, y una selección de puro audio no se
 * puede anidar.
 *
 * El `trackindex` es el número de pista de la secuencia (contando las
 * explotadas) y el `clipindex` el lugar del clip dentro de su pista; los dos
 * empiezan en 1. El `groupindex` es lo que dice que forman un grupo de canales.
 */
function enlacesXml(enlaces) {
    return (enlaces || []).map(enlace =>
        `<link><linkclipref>${enlace.ref}</linkclipref><mediatype>audio</mediatype>` +
        `<trackindex>${enlace.pista}</trackindex><clipindex>${enlace.clip}</clipindex>` +
        '<groupindex>1</groupindex></link>').join('');
}

function clipItemXml(params) {
    const { id, registry, source, startFrame, endFrame, inFrame, outFrame, enabled, fps, kind } = params;
    const entry = registry.register(source);
    const sourceDuration = toFrames(source.durationSec, fps);
    const fileXml = registry.fileXml(source);
    // Qué canal del archivo trae este clipitem. Uno por canal: el `trackindex`
    // acá no es la pista de la secuencia sino el canal del origen.
    const sourceTrack = kind === 'audio'
        ? '<sourcetrack><mediatype>audio</mediatype>' +
          `<trackindex>${params.canalDeOrigen || 1}</trackindex></sourcetrack>`
        : '';
    // Mono o estéreo, dicho en el clip y no solo en la pista. Es el atributo con
    // el que Premiere decide si el clip es una cosa o son canales sueltos.
    const tipoDeCanal = kind === 'audio' && params.tipoDeCanal
        ? ` premiereChannelType="${params.tipoDeCanal}"`
        : '';
    // La etiqueta de color, para distinguir de un vistazo qué fuente es cada clip
    // en una secuencia con los dieciséis trozos de la clase.
    const label = source.label
        ? `<labels><label2>${xmlSafe(source.label)}</label2></labels>`
        : '';

    // Los marcadores DEL CLIP, que no son los de la secuencia.
    //
    // Note Taker escribe TRES juegos y cada uno se ve en un sitio distinto. El
    // de secuencia vive en el timeline: es con el que se salta de toma en toma y
    // el que se ve en la regla de tiempo. El de clip es de ESTA instancia del
    // audio en la secuencia: se dibuja encima del clip, en su pista. Y el del
    // clip maestro (`binClipXml`) es del archivo: se ve al abrir el WAV en el
    // monitor de origen y lo acompaña a otra secuencia o a un multicámara.
    //
    // Los tres llevan lo mismo a propósito: el editor sincroniza a mano contra
    // la claqueta y después corta siguiendo las notas, y no se sabe por cuál de
    // los tres caminos va a entrar al material.
    //
    // Sus `in`/`out` son frames DEL ORIGEN y no del timeline —el mismo reloj que
    // `inFrame`/`outFrame` de acá arriba—, que es lo que hace que sigan
    // apuntando al mismo sonido cuando el clip se mueve.
    const marcadores = (params.marcadores || [])
        .map(m => `    ${markerXml(m, fps)}`).join('');

    return `        <clipitem id="${id}"${tipoDeCanal} frameBlend="FALSE">` +
        `<masterclipid>${entry.masterclip}</masterclipid>` +
        `<name>${xmlSafe(source.name || '')}</name>` +
        `<enabled>${enabled === false ? 'FALSE' : 'TRUE'}</enabled>` +
        `<duration>${sourceDuration}</duration>${rateXml(fps)}` +
        `<start>${startFrame}</start><end>${endFrame}</end>` +
        `<in>${inFrame}</in><out>${outFrame}</out>` +
        `${label}${fileXml}${sourceTrack}` +
        `${enlacesXml(params.enlaces)}${marcadores ? `\n${marcadores}        ` : ''}</clipitem>\n`;
}

/**
 * El color de un marcador, venga como nombre o como el entero de Premiere.
 *
 * `pproColor` viene ABGR y no ARGB: el byte de más peso después del alfa es el
 * AZUL. O sea que el `4280578025` (0xFF246FE9) que el Rodecaster le pone a los
 * marcadores R es RGB(233, 111, 36) —un naranja—, no RGB(36, 111, 233) —un azul—.
 * Está documentado así en las notas de formatos de OpenTimelineIO, que listan ese
 * entero exacto como el naranja de Premiere.
 *
 * Leerlo al revés no rompía nada de forma visible, y por eso duró: los seis bytes
 * siguen siendo un color válido y el XML importa igual. Lo que pasaba es que era
 * OTRO color. Premiere no se enteraba —lee `pproColor`, el entero, y lo muestra
 * bien— pero Resolve lee los componentes RGB de al lado, así que la misma
 * secuencia salía con los marcadores naranjas en un editor y azules en el otro. Y
 * la pantalla de tomar notas, que pinta cada vista con este mismo color, mostraba
 * el profesor azul cuando en la secuencia llegaba rojo.
 *
 * Se pasa a componentes de 16 bits (x257), que es lo que el formato quiere.
 */
function esEnteroDePremiere(color) {
    return typeof color === 'number' && isFinite(color);
}

function colorComponents(color) {
    if (esEnteroDePremiere(color)) {
        const { red, green, blue } = componentesDePremiere(color);
        return { alpha: 0, red: red * 257, green: green * 257, blue: blue * 257 };
    }
    return MARKER_COLORS[String(color || 'white').toLowerCase()] || MARKER_COLORS.white;
}

/**
 * El entero de Premiere a bytes de rojo, verde y azul.
 *
 * Acá y en un solo sitio porque el orden de los bytes es lo que se leyó mal, y
 * mientras cada lado desempaquetaba por su cuenta no había ningún lugar donde
 * arreglarlo una vez. Lo usan el XML de intercambio (los componentes RGB de cada
 * marcador) y `tests/colores.test.js`, que con esto compara los colores de la
 * pantalla contra el mismo desempaquetado que se escribe en la secuencia.
 *
 * @param {number} color el `pproColor` nativo, 0xAABBGGRR
 */
function componentesDePremiere(color) {
    const n = color >>> 0;
    return { red: n & 255, green: (n >>> 8) & 255, blue: (n >>> 16) & 255 };
}

function markerXml(marker, fps) {
    const color = colorComponents(marker.color);
    const inFrame = toFrames(marker.startSec, fps);
    // Un marcador con duración lleva su `out`; los de punto usan -1, que es como
    // el formato dice "sin duración".
    //
    // `puntoComoIn` escribe el MISMO número en vez del -1, y existe por
    // compatibilidad: es la convención con la que la herramienta del director de
    // contenido escribe sus marcadores de salida, y es la que el parser de Class
    // Cut usa para emparejar los pares IN/OUT (empareja POR DURACIÓN, así que un
    // -1 le rompe la cuenta). Premiere y Resolve leen las dos formas igual, pero
    // la que está probada contra el pipeline de corte es esta.
    const outFrame = marker.endSec != null && marker.endSec > marker.startSec
        ? toFrames(marker.endSec, fps)
        : (marker.puntoComoIn ? inFrame : -1);

    // El color va DOS veces, y no es redundancia:
    //
    // `pproColor` es el entero nativo de Premiere y es el mismo que trae el XML
    // del Rodecaster, así que el marcador vuelve con exactamente el color que le
    // puso el director de contenido. Sin él, Premiere lee los componentes RGB y
    // los ajusta al más parecido de su paleta indexada: el color cambia sin que
    // nadie lo haya pedido.
    //
    // `color` es el que entiende todo lo demás, Resolve incluido, que de
    // `pproColor` no sabe nada.
    const ppro = esEnteroDePremiere(marker.color)
        ? `<pproColor>${marker.color}</pproColor>`
        : '';

    return `    <marker><comment>${xmlSafe(marker.comment || '')}</comment>` +
        `<name>${xmlSafe(marker.name || '')}</name>` +
        `<in>${inFrame}</in><out>${outFrame}</out>${ppro}` +
        `<color><alpha>${color.alpha}</alpha><red>${color.red}</red>` +
        `<green>${color.green}</green><blue>${color.blue}</blue></color></marker>\n`;
}

/**
 * El máster de la secuencia, dicho canal por canal.
 *
 * Declarar `numOutputChannels` no alcanza: sin esta lista Premiere arma el
 * máster deduciéndolo del `outputchannelindex` de cada pista, y una pista que
 * pide una salida que no existe lo convierte en un máster multicanal. Con las
 * dos salidas escritas, la secuencia entra como estéreo y nada más.
 */
const MASTER_ESTEREO =
    '<outputs>' +
    '<group><index>1</index><numchannels>1</numchannels><downmix>0</downmix>' +
    '<channel><index>1</index></channel></group>' +
    '<group><index>2</index><numchannels>1</numchannels><downmix>0</downmix>' +
    '<channel><index>2</index></channel></group>' +
    '</outputs>';

/**
 * Arma el proyecto completo: un bin con los clips maestros y la secuencia.
 *
 * El orden importa y no es estético: el bin va PRIMERO porque es quien define
 * cada archivo, y así todo lo que viene después lo referencia por id en vez de
 * volver a describirlo (que es como el mismo video termina importado diez veces).
 *
 * @param {object} params
 *   name          nombre de la secuencia
 *   fps           frame rate REAL del material
 *   width/height  formato
 *   videoTracks   [[{source, startSec, endSec, sourceInSec, enabled}]]
 *   audioTracks   ídem
 *   markers       [{name, comment, startSec, endSec, color}]
 *   durationSec   duración total
 *   binName       nombre del bin (por defecto, el de la secuencia)
 */
function sequenceXml(params) {
    const {
        name, fps = 30, width = 1920, height = 1080,
        videoTracks = [], audioTracks = [], markers = [], durationSec = 0
    } = params || {};
    const binName = params.binName || name;

    const registry = new FileRegistry(fps);
    let clipId = 0;
    const nextId = () => `clipitem-${++clipId}`;

    // Los clips maestros se emiten antes que nada, en el orden en que aparece el
    // material, para que el bin quede legible: cámaras primero, después audios.
    const binOrder = [];
    for (const clips of videoTracks.concat(audioTracks)) {
        for (const clip of clips) {
            if (!binOrder.some(s => s.path === clip.source.path)) binOrder.push(clip.source);
        }
    }
    const binXml = binOrder.map(source => registry.binClipXml(source)).join('');

    const videoXml = videoTracks.map(clips =>
        '      <track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="25">\n' +
        clips.map(clip => clipItemXml({
            id: nextId(),
            registry,
            source: clip.source,
            ...cuadrosDelClip(clip, fps),
            enabled: clip.enabled,
            fps,
            kind: 'video'
        })).join('') +
        '        <enabled>TRUE</enabled><locked>FALSE</locked></track>\n'
    ).join('');

    // ── El audio, una pista de XML por CANAL ──────────────────────────────
    //
    // Acá estaba el defecto que hacía que Premiere partiera cada clip en canales
    // sueltos. En este formato una pista de audio lleva UN canal: un clip
    // estéreo son DOS `clipitem` —uno por canal— en dos pistas "explotadas" que
    // el editor vuelve a juntar al importar. Se escribía una sola pista pidiendo
    // el canal 1, así que Premiere hacía exactamente lo que se le pedía.
    //
    // Que sean dos pistas y no una se dice en tres sitios a la vez, y los tres
    // hacen falta: `totalExplodedTrackCount` en la pista, `premiereChannelType`
    // en el clip y los `<link>` entre hermanos. Está copiado del XML que exportó
    // el Premiere del editor con este mismo material.
    const pistasDeAudio = [];
    let numeroDePista = 1;
    for (const clips of audioTracks) {
        // Los clips de una pista salen todos del mismo archivo, pero se toma el
        // máximo por si alguna vez no fuera así: quedarse corto perdería un canal.
        const canales = clips.length
            ? Math.max(...clips.map(clip => canalesDe(clip.source)))
            : 1;
        const numeros = [];
        const ids = [];
        for (let canal = 0; canal < canales; canal++) {
            numeros.push(numeroDePista++);
            ids.push(clips.map(() => nextId()));
        }
        pistasDeAudio.push({ clips, canales, numeros, ids });
    }

    // Las pistas mono van alternando los dos canales del máster, que es como los
    // reparte Premiere. Las de un par explotado no eligen: la izquierda es la 1
    // y la derecha la 2. Antes se sumaba de a dos —1, 3, 5… hasta 19— contra un
    // máster declarado de dos canales, que es pedirle salidas que no existen.
    let canalMono = 0;
    const audioXml = pistasDeAudio.map(pista => pista.numeros.map((_, canal) => {
        const esEstereo = pista.canales > 1;
        const items = pista.clips.map((clip, i) => clipItemXml({
            id: pista.ids[canal][i],
            registry,
            source: clip.source,
            ...cuadrosDelClip(clip, fps),
            enabled: clip.enabled,
            fps,
            kind: 'audio',
            // Los marcadores de clip van en el canal 1 y en ningún otro. Un par
            // explotado son dos `clipitem` del mismo sonido, y Premiere los
            // vuelve a juntar al importar: escribir los marcadores en los dos
            // deja cada uno duplicado en el clip resultante.
            marcadores: canal === 0 ? clip.marcadores : null,
            canalDeOrigen: canal + 1,
            tipoDeCanal: esEstereo ? 'stereo' : 'mono',
            // Los dos canales se nombran entre sí, y los dos llevan la misma
            // lista: así lo escribe Premiere. Un mono no tiene a quién nombrar.
            enlaces: esEstereo
                ? pista.numeros.map((otra, otroCanal) => ({
                    ref: pista.ids[otroCanal][i], pista: otra, clip: i + 1
                }))
                : null
        })).join('');
        const canalDeSalida = esEstereo ? canal + 1 : (canalMono++ % 2) + 1;
        return '      <track TL.SQTrackAudioKeyframeStyle="0" TL.SQTrackShy="0" ' +
            `TL.SQTrackExpandedHeight="25" currentExplodedTrackIndex="${canal}" ` +
            `totalExplodedTrackCount="${pista.canales}" premiereTrackType="Stereo">\n` +
            items +
            '        <enabled>TRUE</enabled><locked>FALSE</locked>' +
            `<outputchannelindex>${canalDeSalida}</outputchannelindex></track>\n`;
    }).join('')).join('');

    const markersXml = markers.map(marker => markerXml(marker, fps)).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <project>
    <name>${xmlSafe(name)}</name>
    <children>
      <bin>
        <name>${xmlSafe(binName)}</name>
        <children>
${binXml}        </children>
      </bin>
      <sequence id="sequence-1" explodedTracks="true">
        <name>${xmlSafe(name)}</name>
        <duration>${toFrames(durationSec, fps)}</duration>
        ${rateXml(fps)}
        ${timecodeXml(fps)}
        <media>
          <video>
            <format>${videoCharacteristics(fps, width, height)}</format>
${videoXml}          </video>
          <audio>
            <numOutputChannels>2</numOutputChannels>
            <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
            ${MASTER_ESTEREO}
${audioXml}          </audio>
        </media>
${markersXml}      </sequence>
    </children>
  </project>
</xmeml>
`;
}

/**
 * Dónde va un clip en la secuencia y qué parte de su fuente muestra, en cuadros.
 *
 * El final sale del principio más lo que dura en la fuente, y no redondeado por
 * su cuenta: un WAV que no empieza justo en un cuadro —el segundo de una clase
 * que cambió de entrada— redondeaba los dos extremos para lados distintos, y el
 * clip quedaba un cuadro más largo o más corto que lo que muestra de la fuente.
 */
function cuadrosDelClip(clip, fps) {
    const desde = clip.sourceInSec || 0;
    const startFrame = toFrames(clip.startSec, fps);
    const inFrame = toFrames(desde, fps);
    const outFrame = toFrames(desde + (clip.endSec - clip.startSec), fps);
    return { startFrame, endFrame: startFrame + (outFrame - inFrame), inFrame, outFrame };
}

module.exports = {
    sequenceXml,
    markerXml,
    xmlSafe,
    toFrames,
    framesToSeconds,
    rateFor,
    pathUrl,
    xmlSafe,
    colorComponents,
    componentesDePremiere,
    MARKER_COLORS,
    CLIP_LABELS,
    FileRegistry
};
