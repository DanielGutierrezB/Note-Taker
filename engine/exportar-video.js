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
const silencios = require('./quitar-silencios');
const mejorarAudio = require('./mejorar-audio');
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
 * La cámara, abajo a la derecha: un cuadrado con las esquinas redondeadas.
 *
 * **Cuadrada y no del formato de la cámara.** Una cámara de portátil entrega
 * 4:3 o 16:9, y de esos fotogramas la mitad es pared: recortar al cuadrado
 * centrado deja la cara y tira el resto, así que el recuadro ocupa menos sitio
 * mostrando lo mismo. Lo que se tapa de la pantalla es lo que se está
 * explicando, y es el motivo del vídeo.
 *
 * 360 es un tercio del alto del cuadro. Más grande vuelve a tapar; más chica
 * no deja ver una cara.
 *
 * El redondeo es un octavo del lado. El margen es el de la retícula de la app
 * (48 = 12 × 4), igual en los dos lados, para que no quede pegada al borde.
 */
const CAMARA_LADO = 360;
const CAMARA_REDONDEO = 45;
const MARGEN = 48;

/**
 * El alfa del recuadro: opaco adentro, transparente fuera del redondeo.
 *
 * Se lee así: si el punto está en una de las cuatro esquinas —o sea, más allá
 * del radio en los DOS ejes a la vez— entonces es opaco solo si cae dentro del
 * círculo de esa esquina. En el resto del cuadrado, opaco.
 */
const ALFA_REDONDEADO = `if(gt(abs(W/2-X),W/2-${CAMARA_REDONDEO})*gt(abs(H/2-Y),H/2-${CAMARA_REDONDEO}),`
    + `if(lte(hypot(abs(W/2-X)-(W/2-${CAMARA_REDONDEO}),abs(H/2-Y)-(H/2-${CAMARA_REDONDEO})),`
    + `${CAMARA_REDONDEO}),255,0),255)`;

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
function tomasDe(crudas) {
    return (crudas || [])
        .slice()
        .sort((a, b) => a.inMs - b.inMs)
        .map(t => ({
            id: t.id,
            vista: t.vista || vivo.VISTA_POR_DEFECTO,
            desdeMs: ajustar.inAjustado(t),
            hastaMs: ajustar.outAjustado(t)
        }))
        .filter(t => t.hastaMs - t.desdeMs >= MINIMO_SEC * 1000);
}

/**
 * Qué fuente manda en una toma, según su vista.
 *
 * Es el mismo `viewMap` de todo el pipeline (`MAPA_DE_VISTAS` en
 * `notas-vivo.js`): PV se ve con la cámara, R y S con la pantalla. Acá no se
 * inventa una tabla nueva porque sería una segunda verdad sobre lo mismo, y el
 * día que alguien agregue una vista quedaría la mitad sin enterarse.
 */
function mandaLaCamara(vista) {
    return vivo.MAPA_DE_VISTAS[vivo.vistaLeida(vista || '')] === vivo.CAMARA;
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
 * Una toma, con sus dos tramos: el del reloj del audio y el del de pared.
 *
 * Los bordes nacen en el reloj del audio y los vídeos viven en el de pared, así
 * que todo lo que vaya a buscar algo dentro de un vídeo tiene que pasar por
 * acá. Es una función y no dos líneas repetidas porque la usan el reparto del
 * corte y el montaje que se mira, y que las dos crucen el reloj de la misma
 * manera es justamente lo que hace que lo que se mira sea lo que sale.
 */
function enLosDosRelojes(toma, wavs) {
    const wav = ajustar.elWavDe(wavs, toma.desdeMs, toma.hastaMs);
    return {
        wav,
        enElAudio: toma,
        enLaPared: {
            id: toma.id,
            desdeMs: aPared(toma.desdeMs, wav),
            hastaMs: aPared(toma.hastaMs, wav)
        }
    };
}

/**
 * De qué archivo sale cada pedazo de cada toma.
 *
 * Un trozo es una toma ya resuelta: qué entrada es el fondo, qué entrada va
 * encima (si alguna) y de dónde sale el audio, cada una con su instante dentro
 * de SU archivo. Que esto sea una función aparte es lo que deja probar el
 * reparto sin tener un solo vídeo delante.
 *
 * **Lo manda la vista de la toma.** Una toma de profesor (`PV`) es la cámara
 * sola a pantalla completa —es el plano de hablar a cámara, y meterle la
 * pantalla en una esquina sería meterle ruido—; cualquier otra es la pantalla
 * de fondo con la cámara en la esquina. Es la misma vista que el modo clase
 * manda al XML, así que una persona que elige «yo» en la pantalla de revisión y
 * un editor que pone `PV` en Premiere están diciendo lo mismo.
 *
 * Reglas, todas por el mismo motivo —que un trozo no puede salir a medias—:
 *   · el fondo es la fuente que pide la vista, y si esa no cubre la toma
 *     entera, la otra;
 *   · la cámara va encima solo si no es ya el fondo y cubre la toma entera: una
 *     cámara que se corta a mitad de trozo dejaría el trozo cortado también
 *     (`overlay` termina con la más corta);
 *   · el audio es el de la cámara si lo tiene y cubre, y si no el del WAV.
 *
 * @param {object} p { tomas, pantallas, camara, camaraConAudio, wavs } —
 *   `pantallas` son los tramos, del más viejo al más nuevo; se acepta
 *   `pantalla` suelta porque es lo que había cuando la pantalla era una sola
 * @returns {{trozos:object[], avisos:string[]}}
 */
function repartir(p) {
    const { tomas, camara, wavs } = p;
    // La pantalla puede ser varios archivos: cambiar de ventana mientras se
    // graba cierra uno y abre el siguiente. Cuál le toca a cada toma lo decide
    // la hora, abajo, y no hay una «la pantalla» para toda la sesión.
    const pantallas = p.pantallas || (p.pantalla ? [p.pantalla] : []);
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
        const { wav, enElAudio, enLaPared } = enLosDosRelojes(toma, wavs);

        const cubre = v => v && videoCrudo.cubre(v, enLaPared.desdeMs) && videoCrudo.cubre(v, enLaPared.hastaMs);

        // **El tramo de pantalla que cubre esta toma entera, si hay alguno.**
        // Entera y no a medias: un trozo no puede salir mitad de una ventana y
        // mitad de otra, así que una toma que se quedó a caballo entre dos
        // tramos —cambió de ventana sin cerrarla— no tiene pantalla y se va al
        // repuesto, que es la cámara. Es lo mismo que hace una toma que quedó
        // fuera de lo grabado, y por el mismo motivo.
        const pantalla = pantallas.find(cubre) || null;

        // La que pide la vista primero, y la otra como repuesto: una toma que
        // pedía la cámara y no la tiene sale con la pantalla, que es mucho
        // mejor que no salir.
        const pedida = mandaLaCamara(toma.vista) ? camara : pantalla;
        const otra = pedida === camara ? pantalla : camara;
        const fondo = cubre(pedida) ? pedida : (cubre(otra) ? otra : null);
        if (!fondo) {
            avisos.push(`La toma ${toma.id} queda fuera de lo que se grabó: no entra en el vídeo.`);
            continue;
        }
        if (fondo !== pedida) {
            avisos.push(`La toma ${toma.id} pedía ${pedida === camara ? 'tu cámara' : 'tu pantalla'} `
                + 'y ese trozo no está grabado: va con la otra fuente.');
        }
        // Encima solo cuando el fondo es la pantalla. Una toma de profesor es la
        // cámara sola: no hay nada que superponerle.
        const encima = fondo !== camara && cubre(camara) ? camara : null;
        if (!encima && fondo !== camara) {
            avisos.push(`La toma ${toma.id} va sin la cámara en la esquina: ese trozo no está grabado.`);
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
            vista: toma.vista,
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
        // Cuál de las tres fuentes es. Lo trae `video-crudo` en cada vídeo desde
        // que se graba, y tirarlo acá obligaba a adivinarlo después comparando
        // rutas; el WAV no lo tiene porque no es un vídeo.
        cual: archivo.cual || 'wav',
        ruta: archivo.ruta || archivo.archivo,
        desdeSec: Math.max(0, (toma.desdeMs - arranque) / 1000),
        hastaSec: Math.max(0, (toma.hastaMs - arranque) / 1000)
    };
}

const tres = n => Math.round(n * 1000) / 1000;

/** Con coma decimal, que es como se escribe un número en castellano. */
const conComa = n => String(n).replace('.', ',');

/**
 * Lo que dura una lista de tomas en el reloj de PARED.
 *
 * El único reloj que se le puede enseñar a nadie. Los bordes de una toma viven
 * en el del audio, y si el micrófono escribió a otra velocidad —el falso de
 * Chromium va a 0,51x— restar ahí da un número que no se parece a nada de lo
 * que la persona va a ver pasar en el reproductor.
 *
 * Está acá, al lado de `aPared` y `enLosDosRelojes`, y no dentro de quien la
 * usa: es la cuenta más sensible al reloj de todo el módulo, y estaba metida en
 * un `if` dentro de otro `if` dentro del exportador, donde no se podía probar y
 * donde nadie que viniera a auditar los relojes la iba a encontrar.
 */
function duracionEnPared(tomas, wavs) {
    return (tomas || []).reduce((suma, t) => {
        const { enLaPared } = enLosDosRelojes(t, wavs);
        return suma + enLaPared.hastaMs - enLaPared.desdeMs;
    }, 0);
}

/**
 * El grafo de ffmpeg, armado y nada más: ninguna llamada, ningún archivo.
 *
 * Separado de `exportar` a propósito, porque es lo que se puede comprobar en una
 * prueba sin medios: que cada trozo recorte donde se le dijo, que la cámara
 * quede abajo a la derecha y que se peguen en orden.
 *
 * @param {object} p { trozos, salida, audio } — `audio` es el plan de
 *   `mejorar-audio.plan`, o nada si la opción está apagada
 * @returns {{args:string[], segundos:number, entradas:string[]}}
 */
function grafo(p) {
    const trozos = p.trozos || [];
    if (!trozos.length) throw new Error('No hay ninguna toma que exportar.');
    const audio = p.audio || {};

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

    /* La máscara del recuadro, calculada UNA vez y repetida.
     *
     * `geq` evalúa una expresión por píxel y por fotograma, y eso se paga:
     * medido sobre un minuto de vídeo, calcularla en cada fotograma tarda
     * 5,7 s y calcularla una sola vez 2,5 s, que es exactamente lo que tarda
     * el mismo corte SIN redondear. O sea que hecha así, la esquina redondeada
     * sale gratis. De ahí el `loop` sobre un único fotograma: lo que se repite
     * es el resultado, no la cuenta. */
    const conRecuadro = trozos.filter(x => x.encima).length;
    if (conRecuadro) {
        partes.push(`color=c=white:s=${CAMARA_LADO}x${CAMARA_LADO}:d=1:r=${FPS},format=gray,`
            + `geq=lum='${ALFA_REDONDEADO}',loop=loop=-1:size=1:start=0,setpts=N/${FPS}/TB[mascara]`);
        partes.push(`[mascara]split=${conRecuadro}`
            + Array.from({ length: conRecuadro }, (_x, k) => `[m${k}]`).join(''));
    }
    let cuantosRecuadros = 0;

    trozos.forEach((t, i) => {
        const fondo = indiceDe(t.fondo.ruta);
        // Llenar el cuadro (escalar de más y recortar) o entrar entero (escalar
        // de menos y rellenar con negro). Ver el comentario de `repartir`.
        //
        // Una cara se recorta para llenar el cuadro y una pantalla no: a la cara
        // le sobra fondo por los lados y recortarla la mejora, mientras que
        // recortar una pantalla se come justo lo que se está explicando.
        const encuadre = t.fondo.cual === 'camara'
            ? `scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=increase,crop=${ANCHO}:${ALTO}`
            : `scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=decrease,`
                + `pad=${ANCHO}:${ALTO}:(ow-iw)/2:(oh-ih)/2`;
        partes.push(`[${fondo}:v]trim=start=${tres(t.fondo.desdeSec)}:end=${tres(t.fondo.hastaSec)},`
            + `setpts=PTS-STARTPTS,fps=${FPS},${encuadre},setsar=1[f${i}]`);

        if (t.encima) {
            const enc = indiceDe(t.encima.ruta);
            const m = cuantosRecuadros++;
            // Al cuadrado centrado y recién después a su tamaño: recortar
            // primero es lo que deja la cara y tira la pared de los lados.
            partes.push(`[${enc}:v]trim=start=${tres(t.encima.desdeSec)}:end=${tres(t.encima.hastaSec)},`
                + `setpts=PTS-STARTPTS,fps=${FPS},crop='min(iw,ih)':'min(iw,ih)',`
                + `scale=${CAMARA_LADO}:${CAMARA_LADO},format=rgba,setsar=1[c${i}]`);
            partes.push(`[c${i}][m${m}]alphamerge=shortest=1[e${i}]`);
            // Abajo a la derecha, siempre: `W-w` es el ancho del fondo menos el
            // de la cámara, o sea pegada al borde, y el margen la separa.
            partes.push(`[f${i}][e${i}]overlay=W-w-${MARGEN}:H-h-${MARGEN}:shortest=1[v${i}]`);
        } else {
            partes.push(`[f${i}]null[v${i}]`);
        }

        const aud = indiceDe(t.audio.ruta);
        // La ganancia de la toma va acá, pegada a su recorte, porque es lo
        // único de la mejora que es de CADA toma y no del conjunto: empareja
        // esta con las demás antes de que se peguen. Es una ganancia fija, así
        // que no retrasa ni deforma nada (ver `mejorar-audio.js`).
        const sube = audio.porTrozo && audio.porTrozo[i];
        const nivela = sube ? `,volume=${sube.toFixed(2)}dB` : '';
        partes.push(`[${aud}:a]atrim=start=${tres(t.audio.desdeSec)}:end=${tres(t.audio.hastaSec)},`
            + `asetpts=PTS-STARTPTS,aresample=48000${nivela}[a${i}]`);
        pegar.push(`[v${i}][a${i}]`);
    });
    // Si hay cadena de conjunto, el concat entrega en una etiqueta aparte y
    // ella produce `[a]`. La etiqueta no puede ser `[aN]`: esas son las pistas
    // de los trozos y `[a0]` ya está puesta.
    partes.push(`${pegar.join('')}concat=n=${trozos.length}:v=1:a=1[v]`
        + (audio.programa ? '[apegado]' : '[a]'));
    // La limpieza y el volumen del conjunto van sobre el vídeo ya pegado: el
    // denoiser quiere un solo ruido que aprender y el volumen final es uno
    // solo por definición.
    if (audio.programa) partes.push(`[apegado]${audio.programa}[a]`);

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
/**
 * Recordado por ruta, porque es una propiedad del archivo y no de la pregunta.
 *
 * Y porque el editor pregunta MUCHO: `montajeDeSesion` lo llama en cada clic
 * —cada borde que se mueve, cada vista que se cambia, cada toma que se deja
 * fuera—, y esto es un `spawnSync` en el proceso principal, que es el que
 * atiende todos los demás canales y las dos ventanas. Un vídeo ya grabado no le
 * va a crecer una pista de audio, así que preguntarlo una vez alcanza. Es el
 * mismo truco que `umbralDe` con el piso de ruido del WAV.
 *
 * La clave lleva el tamaño además de la ruta: un archivo que se está grabando
 * todavía crece, y el nombre se puede reciclar entre sesiones.
 */
const audioSabido = new Map();

function tieneAudio(ruta) {
    const ffprobe = paths.ffprobe();
    if (!ffprobe.path || !ruta || !fs.existsSync(ruta)) return false;
    const clave = `${ruta}:${fs.statSync(ruta).size}`;
    if (audioSabido.has(clave)) return audioSabido.get(clave);
    const r = spawnSync(ffprobe.path, ['-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=index', '-of', 'csv=p=0', ruta], { encoding: 'utf8' });
    const hay = r.status === 0 && String(r.stdout || '').trim().length > 0;
    audioSabido.set(clave, hay);
    return hay;
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
 * Lo que hace falta para montar la sesión en la ventana, sin exportar nada.
 *
 * Es el editor del corte final: el vídeo que se ve mientras se elige. No es el
 * exportado —exportar tarda, y tardar entre cada decisión es lo que hacía que
 * nadie cambiara nada— sino los dos vídeos crudos reproducidos uno al lado del
 * otro, mostrando el que cada toma pida y saltando de toma en toma. O sea, el
 * mismo montaje que va a hacer ffmpeg, hecho con dos `<video>` y aritmética.
 *
 * Lo único que la ventana no puede hacer por su cuenta es cruzar los relojes:
 * los bordes de las tomas están en el reloj del audio y los vídeos viven en el
 * de pared. Así que acá se cruzan una vez y se entregan segundos ya buenos
 * para `currentTime`. Los cruza `enLosDosRelojes`, la misma que usa el corte, y
 * por eso el montaje y el export caen en el mismo fotograma.
 *
 * @param {string} json el sidecar
 * @returns {object} `{ ok, avisos, archivos: {camara, pantalla, pantallas}, tomas, recuadro }`
 *   o `{ ok: false, avisos, error }` si no hay ni un vídeo que mirar
 */
/**
 * Una sesión abierta: los bordes ya corridos al silencio y las fuentes a mano.
 *
 * Lo usan las dos puntas —el montaje que se mira y el vídeo que sale— y por eso
 * está acá y no escrito dos veces. La promesa del modo es que lo que se mira
 * ES lo que sale, y mientras los dos lados se abrían la sesión por su cuenta
 * eso dependía de que nadie tocara uno sin tocar el otro. Ahora no se puede
 * separar: hay un solo sitio donde se decide con qué se trabaja.
 *
 * `ajustarBordes` es la misma llamada que hacen el XML y el proyecto de
 * Premiere, así que el corte también es el mismo que ve el editor.
 */
function abrirLaSesion(json) {
    const sitio = workspace.sesionDelSidecar(json);
    const estado = sesionesGrabadas.leerSidecar(json);
    sesionesGrabadas.ajustarBordes(estado, sitio);

    const { videos, vacios } = videosDe(estado, sitio);
    const camara = videoCrudo.de(videos, 'camara');
    return {
        sitio, estado, vacios,
        camara,
        // Todos los tramos: cambiar de ventana mientras se graba parte la
        // pantalla en varios archivos, y cuál le toca a cada toma lo decide
        // `repartir` por la hora.
        pantallas: videoCrudo.todas(videos, 'pantalla'),
        camaraConAudio: Boolean(camara) && tieneAudio(camara.ruta),
        wavs: wavsDe(estado, sitio)
    };
}

function montajeDeSesion(json) {
    const { estado, vacios, camara, pantallas, camaraConAudio, wavs } = abrirLaSesion(json);
    if (!pantallas.length && !camara) {
        // El mismo fallo que da el corte, y no un editor vacío con `ok: true`.
        // Eran dos contratos distintos para la misma entrada en el mismo módulo.
        return {
            ok: false,
            avisos: vacios,
            error: vacios.length
                ? 'Los dos vídeos salieron vacíos: no hay imagen que mirar.'
                : 'No encontré los vídeos de esta grabación.'
        };
    }

    // Todas las tomas cerradas, también las descartadas: el editor tiene que
    // poder mostrarlas, porque sin verlas no se puede deshacer un descarte. El
    // corte en cambio pide `vivo.tomasQueQuedan`, que las deja fuera.
    //
    // Es la única diferencia entre las dos puntas, y por eso `tomasDe` recibe la
    // lista ya elegida en vez de un interruptor: la que se queda a la vista es
    // la decisión, y el ordenar-mapear-filtrar de abajo es el mismo para las
    // dos. Antes estaba copiado acá entero, con una línea cambiada.
    const fuera = new Set((estado.tomas || []).filter(t => t.descartada).map(t => t.id));
    const tomas = tomasDe((estado.tomas || [])
        .filter(t => t.inMs != null && t.outMs != null));

    // Y el MISMO reparto que hace el export, no una segunda tabla: así el
    // montaje que se mira y el vídeo que sale eligen fondo, recuadro y encuadre
    // con la misma regla, incluidos los repuestos —la toma que pedía la cámara
    // y no la tiene— y lo que se ve es de verdad lo que va a salir.
    const { trozos, avisos } = repartir({ tomas, pantallas, camara, camaraConAudio, wavs });

    // Dónde cae cada toma en cada archivo, y además de QUÉ archivo de pantalla
    // se trata: con los tramos ya no hay una sola, así que la ventana tiene que
    // saber a cuál apuntar su `<video>` en cada toma. La de la cámara sigue
    // siendo una y va suelta, como siempre.
    //
    // Solo el fondo y lo de encima, nunca el audio. Si el audio sale de la
    // cámara, la cámara ya está en uno de esos dos —`repartir` solo la elige
    // para el sonido cuando la tiene grabada, y entonces es el fondo o va en la
    // esquina—, así que mirarlo no agrega nada. Y si sale del WAV, sus segundos
    // están en el reloj del AUDIO: antes esto lo recorría igual y lo único que
    // evitaba que un número del reloj equivocado acabara en un `currentTime` era
    // que una ruta `.wav` nunca es igual a una `.mp4`. Un límite de relojes no
    // se sostiene con una comparación de texto.
    const deCual = (t, cual) => [t.fondo, t.encima].find(x => x && x.cual === cual) || null;
    const enCual = (t, cual) => {
        const x = deCual(t, cual);
        return x ? tres(x.desdeSec) : null;
    };

    return {
        ok: true,
        // Lo que faltó va primero, igual que en el corte: una pantalla que salió
        // de cero bytes hacía que el montaje se viera solo con la cámara sin
        // decir por qué, y el corte de después sí lo explicaba.
        avisos: vacios.concat(avisos),
        archivos: {
            camara: camara ? camara.ruta : null,
            // El primer tramo, que es el único que hay cuando nadie cambió de
            // ventana. Lo que manda de verdad es `pantallaRuta` de cada toma.
            pantalla: pantallas.length ? pantallas[0].ruta : null,
            pantallas: pantallas.map(v => v.ruta)
        },
        tomas: trozos.map(t => ({
            id: t.toma,
            vista: t.vista,
            descartada: fuera.has(t.toma),
            segundos: tres(t.segundos),
            // Cuál se ve entera. La otra, si está, va en la esquina.
            fondo: t.fondo.cual,
            camaraDesde: enCual(t, 'camara'),
            pantallaDesde: enCual(t, 'pantalla'),
            // Cuál de los tramos de pantalla usa esta toma.
            pantallaRuta: (deCual(t, 'pantalla') || {}).ruta || null,
            // El sonido solo si sale de la cámara. Cuando sale del WAV el
            // montaje va mudo: sincronizar un tercer archivo en una vista
            // previa no paga lo que cuesta, y para eso está el aviso.
            conAudio: t.audio.cual === 'camara'
        })),
        // La esquina donde va la cámara, en partes del ancho del cuadro, para
        // que la ventana la ponga donde la va a poner ffmpeg sin repetir los
        // números. Ver `CAMARA_LADO`, `MARGEN` y `CAMARA_REDONDEO`.
        recuadro: {
            lado: CAMARA_LADO / ANCHO,
            margen: MARGEN / ANCHO,
            redondeo: CAMARA_REDONDEO / CAMARA_LADO,
            // El margen va en partes del ANCHO, y abajo hay que medirlo contra
            // el alto: la proporción del cuadro viaja con él para que la ventana
            // tampoco tenga que saber que es 16:9.
            proporcion: ANCHO / ALTO
        }
    };
}

/**
 * Los vídeos de una sesión, con su ruta de hoy y sin los que salieron vacíos.
 *
 * Un vídeo vacío no es un vídeo. Pasa cuando el codificador rechaza la fuente
 * (una pantalla Retina sin acotar lo hace: ver `MAX_ANCHO` en
 * `src/js/grabar/filmar.js`), y pasarle a ffmpeg un archivo de cero bytes mata
 * la exportación entera. Vale más sacar el vídeo con la fuente que sí se grabó
 * y decirlo, que no sacar nada.
 */
function videosDe(estado, sitio) {
    const vacios = [];
    const videos = (estado.videos || []).map(v => ({
        ...v,
        ruta: v.archivo && fs.existsSync(v.archivo)
            ? v.archivo
            : path.join(workspace.videoDir(sitio.base), path.basename(v.archivo || ''))
    })).filter(v => {
        if (!fs.existsSync(v.ruta)) return false;
        if (fs.statSync(v.ruta).size > 0) return true;
        vacios.push(`No se grabó nada de ${v.cual === 'camara' ? 'la cámara' : 'la pantalla'}: `
            + 'el vídeo salió sin esa fuente.');
        return false;
    });
    return { videos, vacios };
}

function wavsDe(estado, sitio) {
    return (estado.sesiones || [])
        .filter(w => w && w.archivo)
        .map(w => ({ ...w, ruta: sesionesGrabadas.dondeQuedoElWav(sitio, w.archivo) }))
        .filter(w => fs.existsSync(w.ruta));
}

/**
 * Corta y exporta el vídeo de una sesión ya terminada.
 *
 * @param {string} json el sidecar de la sesión
 * @param {object} [opciones] `{ alProgreso, salida, quitarSilencios, mejorarAudio }`
 * @returns {Promise<object>} { ok, ruta, segundos, tomas, avisos }
 */
async function deSesion(json, opciones) {
    const o = opciones || {};
    const { sitio, estado, vacios, pantallas, camara, camaraConAudio, wavs }
        = abrirLaSesion(json);

    const tomas = tomasDe(vivo.tomasQueQuedan(estado));
    if (!tomas.length) {
        return {
            ok: false, tomas: 0,
            error: 'No se abrió ninguna toma: no hay nada que cortar. '
                + 'Los vídeos y el audio quedaron guardados.'
        };
    }

    if (!pantallas.length && !camara) {
        return {
            ok: false,
            tomas: tomas.length,
            avisos: vacios,
            error: vacios.length
                ? 'Los dos vídeos salieron vacíos: no hay imagen que cortar.'
                : 'No encontré los vídeos de esta grabación.'
        };
    }

    // Y si se pidió, cada toma partida por sus silencios largos. Va acá —entre
    // las tomas y el reparto— porque un pedazo es una toma más corta y todo lo
    // de abajo ya sabía trabajar con varios trozos.
    //
    // `pedazos` es otro nombre y no `tomas` otra vez: a partir de acá las dos
    // listas existen y quieren decir cosas distintas. Mientras esto reasignaba
    // `tomas`, el `tomas.length` de los dos caminos de error de abajo contestaba
    // una cuenta de PEDAZOS con el nombre de las tomas —tres tomas partidas en
    // once decían «11»— mientras el camino bueno se tomaba el trabajo de contar
    // `new Set(trozos.map(t => t.toma)).size` justamente para no hacer eso.
    const quitados = [];
    const partidas = o.quitarSilencios ? silencios.partir(tomas, wavs) : null;
    const pedazos = partidas ? partidas.tomas : tomas;
    if (partidas) {
        const menos = (duracionEnPared(tomas, wavs)
            - duracionEnPared(pedazos, wavs)) / 1000;
        quitados.push(partidas.huecos
            ? `Se quitaron ${partidas.huecos} silencio(s) de más de `
                + `${conComa(silencios.LARGO_MIN_SEC)} s: ${conComa(menos.toFixed(1))} s `
                + 'menos de vídeo.'
            : 'No había ningún silencio de más de '
                + `${conComa(silencios.LARGO_MIN_SEC)} s que quitar.`);
    }

    const reparto = repartir({ tomas: pedazos, pantallas, camara, camaraConAudio, wavs });
    const trozos = reparto.trozos;
    // Lo que faltó va primero: es la causa de todo lo que venga detrás.
    const avisos = vacios.concat(reparto.avisos, quitados);
    if (!trozos.length) {
        return {
            ok: false, tomas: tomas.length, avisos,
            error: 'Ninguna toma cae dentro de lo que se grabó: no puedo cortar el vídeo.'
        };
    }

    // Medir va DESPUÉS del reparto porque lo que se mide es lo que va a sonar:
    // qué archivo trae el audio de cada toma lo decide `repartir`, y puede no
    // ser el mismo para todas. Y se mide dos veces y se encodea una: la
    // segunda pasada es solo audio y cuesta una lectura de los archivos,
    // mientras que el exporte cuesta minutos de x264.
    const audio = o.mejorarAudio
        ? mejorarAudio.afinar({
            trozos,
            ffmpeg: paths.ffmpeg().path,
            plan: mejorarAudio.plan({ trozos, ffmpeg: paths.ffmpeg().path })
        })
        : null;
    if (audio) avisos.push(...audio.avisos);

    const salida = alLado(o.salida || path.join(sitio.base, `${sitio.nombre}.mp4`));
    const g = grafo({ trozos, salida, audio });
    const r = await correr(g.args, g.segundos, o.alProgreso);
    if (!r.ok) return { ok: false, tomas: tomas.length, avisos, error: r.error };

    return {
        ok: true,
        ruta: salida,
        // Tomas, no trozos: con los silencios quitados una toma sale en varios
        // pedazos, y lo que la pantalla cuenta —y la persona reconoce— son las
        // veces que dijo «3, 2, 1».
        tomas: new Set(trozos.map(t => t.toma)).size,
        pedazos: trozos.length,
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
    CAMARA_LADO,
    CAMARA_REDONDEO,
    MARGEN,
    MINIMO_SEC,
    tomasDe,
    mandaLaCamara,
    enLosDosRelojes,
    montajeDeSesion,
    repartir,
    grafo,
    tieneAudio,
    alLado,
    deSesion
};
