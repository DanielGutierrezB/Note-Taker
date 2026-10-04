'use strict';
/**
 * exportar-video.js — El MP4 del modo semanal: las tomas, pegadas, con la
 * cámara en la esquina.
 *
 * Es el único sitio de la app que produce vídeo. Lo que hace es lo que haría el
 * editor a mano y en el mismo orden: tirar lo que está fuera de las tomas,
 * poner la pantalla de fondo, la cámara encima abajo a la derecha, y pegar.
 *
 * **Las tomas salen de donde salen las de Premiere.** Los mismos bordes ya
 * corridos al silencio por `ajustar-corte.js`, leídos del sidecar y no de la
 * memoria: exportar otra vez mañana da exactamente el mismo vídeo, y el corte
 * que ve la persona es el corte que vería el editor si abriera el XML.
 *
 * **Un solo ffmpeg, y está medido.** La otra forma era un proceso por toma y
 * después pegar sin recodificar. Con una grabación de cinco minutos y dos tomas
 * a cuatro minutos de distancia: un solo proceso, 909 MB de pico y 3,2 s; uno
 * por toma, 876 MB y 1,6 s. O sea que la memoria es la misma —es el x264, no el
 * grafo— y lo que se gana partiéndolo es tiempo que acá no hace falta. Se midió
 * además que el pico NO crece con la distancia entre tomas (906, 909 y 908 MB
 * con 10, 130 y 275 segundos de separación), que era el miedo. A cambio de esos
 * segundos: un proceso, ningún archivo temporal que limpiar, una sola barra de
 * progreso y una duración exacta —20,000 s pedidos, 20,000 s obtenidos, contra
 * los 20,021 que dejaba el pegado sin recodificar.
 *
 * **El fondo es la pantalla y el audio es el de la cámara.** El audio del
 * archivo de la cámara lo muxeó Chromium junto con su vídeo, así que los labios
 * y la voz van juntos por construcción: medido, el desfase dentro del archivo
 * es de unos 70 ms. Si ese archivo no tiene audio —o no llega hasta donde
 * llega la toma— se cae al WAV, que es el audio de siempre y está en la hora
 * del día, igual que los bordes.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const paths = require('./paths');
const workspace = require('./workspace');
const vivo = require('./notas-vivo');
const ajustar = require('./ajustar-corte');
const videoCrudo = require('./video-crudo');
const sesionesGrabadas = require('./sesiones-grabadas');

/**
 * El tamaño del vídeo que sale.
 *
 * 1080p30 y no lo que haya entrado: una pantalla Retina llega al doble y un
 * vídeo de 3840 de ancho para explicar lo que se hizo en la semana es un
 * archivo de varios gigas que nadie va a poder mandar. Lo que entra se escala
 * para que entre entero (`force_original_aspect_ratio=decrease`) y lo que sobra
 * queda en negro a los lados, sin deformar nada.
 */
const ANCHO = 1920;
const ALTO = 1080;
const FPS = 30;

/**
 * La cámara, abajo a la derecha, a un cuarto del ancho.
 *
 * 480 de 1920. Más grande tapa lo que se está explicando, que es el motivo del
 * vídeo; más chica no deja ver la cara. El margen es el mismo de la retícula de
 * la app (48 = 12 × 4) para que no quede pegada al borde.
 */
const CAMARA_ANCHO = 480;
const MARGEN = 48;

/** Una toma más corta que esto no es una toma: no entra. */
const MINIMO_SEC = 0.2;

/** Lo que tarda de más el x264 por calidad; `veryfast` con crf 20 es el trato. */
const CALIDAD = ['-preset', 'veryfast', '-crf', '20'];

/**
 * Las tomas que van al vídeo, en orden y con los bordes ya ajustados.
 *
 * Son las mismas que van al XML y por la misma puerta (`tomasQueQuedan` deja
 * fuera las descartadas y las que no tienen OUT), con los bordes corridos al
 * silencio. Sin esto, cada corte caería encima de una palabra.
 */
function tomasDe(estado) {
    return vivo.tomasQueQuedan(estado)
        .slice()
        .sort((a, b) => a.inMs - b.inMs)
        .map(t => ({ id: t.id, desdeMs: ajustar.inAjustado(t), hastaMs: ajustar.outAjustado(t) }))
        .filter(t => t.hastaMs - t.desdeMs >= MINIMO_SEC * 1000);
}

/**
 * Cuánto se aparta el reloj del WAV del reloj de pared, medido en el propio WAV.
 *
 * **Son dos relojes distintos y hay que cruzarlos.** Los bordes de una toma
 * viven en el reloj del audio —`notas-vivo` los pone donde llegó el WAV— y los
 * vídeos viven en el reloj de pared, que es la hora a la que la ventana llamó a
 * `start()`. Si el dispositivo entrega más o menos muestras por segundo de las
 * que declara, los dos relojes se separan y el corte del vídeo se desliza: el
 * motor ya vigila esa deriva mientras graba (`vigilarDeriva` en `grabacion.js`),
 * y acá hay que deshacerla.
 *
 * El factor sale de los dos datos que el propio WAV guarda: cuánto duró según
 * el reloj de pared (`hastaMs - desdeMs`) y cuánto audio escribió (`segundos`).
 * Con un micrófono normal da 1,000 y esto no hace nada. Lo encontró la corrida
 * de punta a punta (`tools/semanal-de-punta-a-punta.js`) con la cámara y el
 * micrófono falsos de Chromium, que escriben audio a 1,88x: sin corregir, la
 * segunda toma caía fuera del vídeo y el corte la descartaba.
 *
 * Se recorta a un rango sensato: un factor de 3 no es una deriva, es un sidecar
 * roto, y con uno así es mejor cortar donde dicen las tomas —aunque esté
 * corrido— que donde diga una cuenta absurda.
 */
const DERIVA_MINIMA = 0.5;
const DERIVA_MAXIMA = 2;

function derivaDe(wav) {
    if (!wav || wav.desdeMs == null || wav.hastaMs == null || !(wav.segundos > 0)) return 1;
    const factor = (wav.hastaMs - wav.desdeMs) / (wav.segundos * 1000);
    if (!(factor > 0)) return 1;
    return Math.max(DERIVA_MINIMA, Math.min(DERIVA_MAXIMA, factor));
}

/**
 * Un instante de una toma, llevado al reloj de pared de los vídeos.
 *
 * Con el factor en 1 —lo normal— devuelve el mismo número que entró.
 */
function aPared(ms, wav) {
    if (!wav || wav.desdeMs == null) return ms;
    return wav.desdeMs + (ms - wav.desdeMs) * derivaDe(wav);
}

/**
 * De qué archivo sale cada pedazo de cada toma.
 *
 * Un trozo es una toma ya resuelta: qué entrada es el fondo, qué entrada va
 * encima (si alguna) y de dónde sale el audio, cada una con su instante dentro
 * de SU archivo. Que esto sea una función aparte es lo que deja probar el
 * reparto sin tener un solo vídeo delante.
 *
 * Reglas, todas por el mismo motivo —que un trozo no puede salir a medias—:
 *   · el fondo es la pantalla si cubre la toma entera, y si no la cámara;
 *   · la cámara va encima solo si no es ya el fondo y cubre la toma entera: una
 *     cámara que se corta a mitad de trozo dejaría el trozo cortado también
 *     (`overlay` termina con la más corta);
 *   · el audio es el de la cámara si lo tiene y cubre, y si no el del WAV.
 *
 * @param {object} p { tomas, pantalla, camara, camaraConAudio, wavs }
 * @returns {{trozos:object[], avisos:string[]}}
 */
function repartir(p) {
    const { tomas, pantalla, camara, wavs } = p;
    const avisos = [];
    const trozos = [];

    // Si el audio y el reloj de pared se separaron, se dice una vez y no una
    // por toma: es una propiedad de la grabación, no de cada corte.
    for (const w of wavs || []) {
        const factor = derivaDe(w);
        if (Math.abs(factor - 1) > 0.01) {
            avisos.push(`El audio se grabó a ${factor.toFixed(2)}x del reloj: los cortes se `
                + 'corrigieron con esa medida.');
        }
    }

    for (const toma of tomas) {
        // El WAV al que pertenece la toma: es el que lleva su reloj, y el que
        // dice cuánto hay que corregir para buscar ese instante en un vídeo.
        const wav = (wavs || []).find(w => w
            && toma.desdeMs >= w.desdeMs
            && toma.hastaMs <= w.desdeMs + (w.segundos || 0) * 1000 + 500) || null;
        // Dos versiones del mismo tramo: en el reloj del audio (que es donde
        // viven los bordes) y en el de pared (que es donde viven los vídeos).
        const enElAudio = toma;
        const enLaPared = {
            id: toma.id,
            desdeMs: aPared(toma.desdeMs, wav),
            hastaMs: aPared(toma.hastaMs, wav)
        };

        const cubre = v => v && videoCrudo.cubre(v, enLaPared.desdeMs) && videoCrudo.cubre(v, enLaPared.hastaMs);
        const fondo = cubre(pantalla) ? pantalla : (cubre(camara) ? camara : null);
        if (!fondo) {
            avisos.push(`La toma ${toma.id} queda fuera de lo que se grabó: no entra en el vídeo.`);
            continue;
        }
        const encima = fondo !== camara && cubre(camara) ? camara : null;
        if (!encima && fondo !== camara) {
            avisos.push(`La toma ${toma.id} va sin la cámara: ese trozo no está grabado.`);
        }

        const audio = p.camaraConAudio && cubre(camara)
            ? { archivo: camara, tramo: enLaPared }
            : (wav ? { archivo: wav, tramo: enElAudio } : null);
        if (!audio) {
            avisos.push(`La toma ${toma.id} no tiene audio grabado: no entra en el vídeo.`);
            continue;
        }

        trozos.push({
            toma: toma.id,
            // Lo que va a durar el trozo lo manda el vídeo, que es la imagen: el
            // audio se recorta al mismo largo y `concat` no admite discrepancias.
            segundos: (enLaPared.hastaMs - enLaPared.desdeMs) / 1000,
            fondo: enArchivo(fondo, enLaPared),
            encima: encima ? enArchivo(encima, enLaPared) : null,
            audio: enArchivo(audio.archivo, audio.tramo)
        });
    }
    return { trozos, avisos };
}

/**
 * Dónde cae una toma adentro de un archivo.
 *
 * El WAV guarda su arranque en `desdeMs` y los vídeos en `empezoMs`; los dos
 * son la hora del día del primer dato del archivo, que es lo que alinea los
 * tres relojes. Esta es la única cuenta del módulo que puede correr el corte
 * entero, y por eso está en un sitio y no en tres.
 */
function enArchivo(archivo, toma) {
    const arranque = archivo.empezoMs != null ? archivo.empezoMs : archivo.desdeMs;
    return {
        ruta: archivo.ruta || archivo.archivo,
        desdeSec: Math.max(0, (toma.desdeMs - arranque) / 1000),
        hastaSec: Math.max(0, (toma.hastaMs - arranque) / 1000)
    };
}

const tres = n => Math.round(n * 1000) / 1000;

/**
 * El grafo de ffmpeg, armado y nada más: ninguna llamada, ningún archivo.
 *
 * Separado de `exportar` a propósito, porque es lo que se puede comprobar en una
 * prueba sin medios: que cada trozo recorte donde se le dijo, que la cámara
 * quede abajo a la derecha y que se peguen en orden.
 *
 * @param {object} p { trozos, salida }
 * @returns {{args:string[], segundos:number, entradas:string[]}}
 */
function grafo(p) {
    const trozos = p.trozos || [];
    if (!trozos.length) throw new Error('No hay ninguna toma que exportar.');

    // Una entrada por archivo, no por trozo: ffmpeg decodifica una vez y reparte.
    const entradas = [];
    const indiceDe = ruta => {
        const i = entradas.indexOf(ruta);
        if (i !== -1) return i;
        entradas.push(ruta);
        return entradas.length - 1;
    };

    const partes = [];
    const pegar = [];
    trozos.forEach((t, i) => {
        const fondo = indiceDe(t.fondo.ruta);
        partes.push(`[${fondo}:v]trim=start=${tres(t.fondo.desdeSec)}:end=${tres(t.fondo.hastaSec)},`
            + `setpts=PTS-STARTPTS,fps=${FPS},`
            + `scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=decrease,`
            + `pad=${ANCHO}:${ALTO}:(ow-iw)/2:(oh-ih)/2,setsar=1[f${i}]`);

        if (t.encima) {
            const enc = indiceDe(t.encima.ruta);
            partes.push(`[${enc}:v]trim=start=${tres(t.encima.desdeSec)}:end=${tres(t.encima.hastaSec)},`
                + `setpts=PTS-STARTPTS,fps=${FPS},scale=${CAMARA_ANCHO}:-2,setsar=1[e${i}]`);
            // Abajo a la derecha, siempre: `W-w` es el ancho del fondo menos el
            // de la cámara, o sea pegada al borde, y el margen la separa.
            partes.push(`[f${i}][e${i}]overlay=W-w-${MARGEN}:H-h-${MARGEN}:shortest=1[v${i}]`);
        } else {
            partes.push(`[f${i}]null[v${i}]`);
        }

        const aud = indiceDe(t.audio.ruta);
        partes.push(`[${aud}:a]atrim=start=${tres(t.audio.desdeSec)}:end=${tres(t.audio.hastaSec)},`
            + `asetpts=PTS-STARTPTS,aresample=48000[a${i}]`);
        pegar.push(`[v${i}][a${i}]`);
    });
    partes.push(`${pegar.join('')}concat=n=${trozos.length}:v=1:a=1[v][a]`);

    const args = ['-v', 'error', '-y', '-nostdin'];
    for (const ruta of entradas) args.push('-i', ruta);
    args.push('-filter_complex', partes.join(';'));
    args.push('-map', '[v]', '-map', '[a]');
    args.push('-c:v', 'libx264', ...CALIDAD, '-pix_fmt', 'yuv420p', '-r', String(FPS));
    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
    args.push('-progress', 'pipe:1', p.salida);

    return {
        args,
        entradas,
        segundos: tres(trozos.reduce((s, t) => s + t.segundos, 0))
    };
}

/** Si un archivo de vídeo trae audio dentro. */
function tieneAudio(ruta) {
    const ffprobe = paths.ffprobe();
    if (!ffprobe.path || !ruta || !fs.existsSync(ruta)) return false;
    const r = spawnSync(ffprobe.path, ['-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=index', '-of', 'csv=p=0', ruta], { encoding: 'utf8' });
    return r.status === 0 && String(r.stdout || '').trim().length > 0;
}

/**
 * Corre el ffmpeg y va contando por dónde va.
 *
 * El progreso sale de `-progress pipe:1`, que escribe `out_time_us` cada poco:
 * dividido por lo que va a durar el vídeo da el tanto por ciento, que es lo
 * único que se puede decir con verdad mientras esto trabaja.
 */
function correr(args, segundos, alProgreso) {
    const ffmpeg = paths.ffmpeg();
    if (!ffmpeg.path) return Promise.resolve({ ok: false, error: 'Falta ffmpeg: sin él no puedo cortar el vídeo.' });

    return new Promise(resolve => {
        const hijo = spawn(ffmpeg.path, args);
        let error = '';
        let resto = '';

        hijo.stdout.on('data', trozo => {
            resto += trozo.toString();
            const lineas = resto.split('\n');
            resto = lineas.pop();
            for (const linea of lineas) {
                const m = /^out_time_us=(\d+)/.exec(linea.trim());
                if (m && segundos > 0 && typeof alProgreso === 'function') {
                    const pct = Math.max(0, Math.min(99, Math.round(Number(m[1]) / 1e4 / segundos)));
                    alProgreso({ pct, segundos: Number(m[1]) / 1e6, total: segundos });
                }
            }
        });
        hijo.stderr.on('data', t => { error += t.toString(); });
        hijo.on('error', err => resolve({ ok: false, error: err.message }));
        hijo.on('close', codigo => {
            if (codigo === 0) {
                if (typeof alProgreso === 'function') alProgreso({ pct: 100, segundos, total: segundos });
                resolve({ ok: true });
                return;
            }
            resolve({ ok: false, error: primerasLineas(error) || `ffmpeg terminó con el código ${codigo}.` });
        });
    });
}

function primerasLineas(texto) {
    return String(texto || '').split('\n').filter(Boolean).slice(-3).join(' · ').slice(0, 300);
}

/**
 * Un nombre libre al lado, como hace el proyecto de Premiere.
 *
 * Nunca se pisa un MP4 que ya está: puede ser el que la persona ya mandó.
 */
function alLado(ruta) {
    if (!fs.existsSync(ruta)) return ruta;
    const dir = path.dirname(ruta);
    const ext = path.extname(ruta);
    const base = path.basename(ruta, ext);
    for (let n = 2; n < 500; n++) {
        const otra = path.join(dir, `${base} ${n}${ext}`);
        if (!fs.existsSync(otra)) return otra;
    }
    return ruta;
}

/**
 * Corta y exporta el vídeo de una sesión ya terminada.
 *
 * @param {string} json el sidecar de la sesión
 * @param {object} [opciones] { alProgreso, salida }
 * @returns {Promise<object>} { ok, ruta, segundos, tomas, avisos }
 */
async function deSesion(json, opciones) {
    const o = opciones || {};
    const sitio = workspace.sesionDelSidecar(json);
    const estado = sesionesGrabadas.leerSidecar(json);

    // Los bordes al silencio, con el WAV donde esté hoy. Es la misma llamada que
    // hacen el XML y el proyecto de Premiere, así que el corte es el mismo.
    sesionesGrabadas.ajustarBordes(estado, sitio);

    const tomas = tomasDe(estado);
    if (!tomas.length) {
        return {
            ok: false, tomas: 0,
            error: 'No se abrió ninguna toma: no hay nada que cortar. '
                + 'Los vídeos y el audio quedaron guardados.'
        };
    }

    const videos = (estado.videos || []).map(v => ({
        ...v,
        ruta: v.archivo && fs.existsSync(v.archivo)
            ? v.archivo
            : path.join(workspace.videoDir(sitio.base), path.basename(v.archivo || ''))
    })).filter(v => fs.existsSync(v.ruta));

    const pantalla = videoCrudo.de(videos, 'pantalla');
    const camara = videoCrudo.de(videos, 'camara');
    if (!pantalla && !camara) {
        return { ok: false, tomas: tomas.length, error: 'No encontré los vídeos de esta grabación.' };
    }

    const wavs = (estado.sesiones || [])
        .filter(w => w && w.archivo)
        .map(w => ({ ...w, ruta: sesionesGrabadas.dondeQuedoElWav(sitio, w.archivo) }))
        .filter(w => fs.existsSync(w.ruta));

    const { trozos, avisos } = repartir({
        tomas,
        pantalla,
        camara,
        camaraConAudio: Boolean(camara) && tieneAudio(camara.ruta),
        wavs
    });
    if (!trozos.length) {
        return {
            ok: false, tomas: tomas.length, avisos,
            error: 'Ninguna toma cae dentro de lo que se grabó: no puedo cortar el vídeo.'
        };
    }

    const salida = alLado(o.salida || path.join(sitio.base, `${sitio.nombre}.mp4`));
    const g = grafo({ trozos, salida });
    const r = await correr(g.args, g.segundos, o.alProgreso);
    if (!r.ok) return { ok: false, tomas: tomas.length, avisos, error: r.error };

    return {
        ok: true,
        ruta: salida,
        tomas: trozos.length,
        segundos: g.segundos,
        bytes: fs.existsSync(salida) ? fs.statSync(salida).size : 0,
        avisos
    };
}

module.exports = {
    ANCHO,
    DERIVA_MINIMA,
    DERIVA_MAXIMA,
    derivaDe,
    aPared,
    ALTO,
    FPS,
    CAMARA_ANCHO,
    MARGEN,
    MINIMO_SEC,
    tomasDe,
    repartir,
    grafo,
    tieneAudio,
    alLado,
    deSesion
};
