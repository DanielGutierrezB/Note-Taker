/**
 * filmar.js — Los dos vídeos del modo semanal, grabados desde la ventana.
 *
 * La ventana es la única que puede abrir una cámara o una pantalla, así que acá
 * viven los dos `MediaRecorder` y nada más: los pedazos se van al proceso
 * principal en cuanto salen (`window.nt.semanalTrozo`) y el disco es cosa de
 * allá (`engine/video-crudo.js`).
 *
 * **La hora que se manda es la de `start()`, no la de `onstart`.** Es el dato
 * que alinea el vídeo con el audio y está medido en el Electron de esta app con
 * un vídeo sintético que cambia de color cada segundo: el primer fotograma del
 * archivo cae a 43 ms de la llamada a `start()`, mientras que el aviso
 * `onstart` llega 294 ms tarde en un grabador y 339 ms en el otro. Con
 * `onstart` como reloj, los dos vídeos quedaban además 45 ms corridos entre sí.
 *
 * **La cámara graba con el micrófono adentro.** La misma pista que alimenta el
 * worklet —la que hace el WAV y todo el oído— entra al grabador de la cámara,
 * así que la voz y los labios los cuadra Chromium y no esta app (medido: unos
 * 70 ms de desfase dentro del archivo). El WAV sigue siendo el de siempre, y es
 * el que se usa para cortar y el repuesto si la cámara no tiene audio.
 */

import * as ojo from './ojo.js';
import * as oido from './oido.js';

/**
 * Cada cuánto suelta `MediaRecorder` un pedazo.
 *
 * Dos segundos. Más corto son más viajes por el puente para nada; más largo es
 * más minutos de grabación que se perderían si la app se cayera, porque un
 * pedazo a medias no llega. Medido: con dos segundos los pedazos van de 50 kB a
 * 400 kB, que cruzan el puente sin que se note.
 */
const CADA_MS = 2000;

/**
 * Los formatos, en el orden en que se quieren.
 *
 * MP4 con H.264 primero, que es lo que ffmpeg abre, busca y recorta sin
 * remuxear nada. Comprobado en el Electron de la app (Chromium 150): acepta los
 * cuatro. El WebM está detrás por si una versión futura deja de aceptar MP4.
 */
const FORMATOS = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus'
];

/** Lo que se le pide a cada vídeo. La pantalla pesa más: es la que se lee. */
const CALIDAD = { pantalla: 8e6, camara: 4e6 };

/**
 * El tope al que se pide la pantalla, y no es una preferencia: es un límite del
 * codificador del Mac.
 *
 * Una pantalla Retina de 2560×1600 entra a 5120×3200, y a ese tamaño el H.264
 * por hardware contesta «The given encoder configuration is not supported by
 * the encoder» y no produce NI UN fotograma: el archivo queda en cero bytes.
 * Medido en el Electron de esta app sobre la pantalla de verdad: 5120×3200
 * falla, 2560×1600 pasa, 1920×1080 pasa. El techo está entre medias, que es lo
 * que se espera de VideoToolbox (4096 de ancho).
 *
 * 1920×1080 y no el techo real porque es exactamente lo que mide el vídeo que
 * sale (`ANCHO`/`ALTO` en `engine/exportar-video.js`): capturar más es gastar
 * disco y codificador en píxeles que el exportador va a tirar igual.
 */
const MAX_ANCHO = 1920;
const MAX_ALTO = 1080;

/**
 * Cuánto se espera a que el codificador se queje antes de darlo por bueno.
 *
 * Medido con la pantalla que falla, tres veces seguidas: el `onerror` llegó a
 * los 27, 2 y 5 ms de la llamada a `start()`. Doscientos es diez veces el peor
 * caso, y es lo que se le suma a apretar Grabar.
 */
const PRUEBA_MS = 200;

/**
 * Cada cuánto se le toma el pulso a las pistas que se están grabando.
 *
 * **Esto existe porque una pista puede morirse sin que nadie avise.** Medido en
 * el Electron de esta app: con un grabador andando se le hace `stop()` a la
 * pista de vídeo y NI `onerror` del grabador NI `onended` de la pista dicen
 * nada; el grabador simplemente deja de entregar pedazos y el archivo se queda
 * con lo que llevaba. Pasó de verdad: una grabación de 71 segundos terminó con
 * la cámara en cero bytes y cero pedazos, sin un solo aviso, y quien grababa se
 * enteró al llegar a la pantalla de revisión.
 *
 * Lo que sí se puede mirar es la pista: un `stop()` la deja en `ended` en el
 * acto, y una cámara que se queda sin imagen —otra app se la llevó, el cable—
 * se pone en `muted`. Dos segundos es el mismo paso que los pedazos.
 */
const PULSO_MS = 2000;

/**
 * Cuánto se aguanta sin un solo pedazo antes de darlo por muerto.
 *
 * El pulso de arriba agarra la pista muerta; esto agarra lo que quede: un
 * grabador que arrancó, tiene pista viva y no entrega nada. Es el caso que pasó
 * de verdad, y la sospecha es el micrófono: el grabador de la cámara lleva la
 * voz adentro del mismo MP4, y un muxer esperando un audio que no llega no
 * entrega tampoco el vídeo. La pantalla, que graba sin audio, siguió entera.
 *
 * **Uno por fuente, porque no tardan lo mismo.** El MP4 de Chromium entrega a
 * tirones y el tirón depende de cuántos datos haya: medido, una cámara con una
 * cara delante suelta su primer pedazo antes de los 4 segundos, mientras que
 * una pantalla casi quieta tardó 35. Un solo número para las dos sería o un
 * aviso falso en la pantalla o una cámara perdida durante un minuto.
 */
const SIN_NADA_MS = { camara: 15000, pantalla: 45000 };

const estado = {
    pantalla: null,          // el stream de la pantalla, elegido antes de grabar
    tipos: {},               // cual → el mimeType que su fuente aguanta
    grabadores: new Map(),   // cual → MediaRecorder
    pulso: null,             // el reloj que le toma el pulso a las pistas
    salud: new Map(),        // cual → { bytes, desdeMs, avisado, pistas }
    alAviso: () => {}
};

/**
 * Los formatos que este Mac dice aceptar, en orden de preferencia.
 *
 * Decir que los acepta y aceptarlos son cosas distintas —`isTypeSupported` mira
 * el códec, no el tamaño de lo que le vas a meter—, así que esta lista es de
 * candidatos y quien decide de verdad es `aguanta()`.
 */
function formatosPara(conAudio) {
    const puede = t => window.MediaRecorder && MediaRecorder.isTypeSupported(t);
    // Sin audio no hace falta que el formato declare códec de audio: pedirlo con
    // `mp4a` y no mandar pista deja un archivo con una pista vacía declarada.
    if (!conAudio) return FORMATOS.map(t => t.replace(/,\s*(mp4a[^";]*|opus)/, '')).filter(puede);
    // **Y con audio, solo los que lo declaran.** `video/mp4;codecs=avc1` estaba
    // en la lista y es un candidato válido para la pantalla, pero si le entra la
    // pista del micrófono a un formato que no declara audio, la voz se va en
    // silencio: el archivo sale sin ella y nadie se enteró. Visto de verdad en
    // una corrida de la cámara, que cayó a ese formato porque el primero no
    // pasó la prueba del codificador.
    return FORMATOS.filter(t => /mp4a|opus/.test(t)).filter(puede);
}

/**
 * Si el codificador acepta de verdad esta fuente con este formato.
 *
 * Se graba medio segundo a la basura y se mira si el grabador se queja. Parece
 * exagerado y es justo lo contrario: sin esto, una fuente que el codificador no
 * traga se descubre cuando la persona termina de grabar y se encuentra con un
 * archivo vacío, que es exactamente lo que pasó con la pantalla Retina. El
 * error llega en los primeros milisegundos —no al final—, así que medio segundo
 * antes de arrancar compra la única garantía que importa.
 *
 * Se prueba sin `timeslice`: no interesa el dato, interesa el `onerror`. Y es
 * lo único que se puede mirar: medido, un `MediaRecorder` de MP4 no entrega
 * nada en los primeros tres segundos ni pidiéndoselo cada 100 ms, así que
 * «todavía no llegó un trozo» no significa nada.
 */
async function aguanta(stream, tipo, cual) {
    let grabador;
    try {
        grabador = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: CALIDAD[cual] });
    } catch (e) {
        return false;
    }
    let roto = false;
    grabador.onerror = () => { roto = true; };
    try {
        grabador.start();
    } catch (e) {
        return false;
    }
    await new Promise(r => setTimeout(r, PRUEBA_MS));
    // Si ya se cayó solo, `stop()` tira: el estado quedó en `inactive`.
    try { if (grabador.state !== 'inactive') grabador.stop(); } catch (e) { roto = true; }
    return !roto;
}

/** El primer formato que esta fuente aguanta de verdad. `null` si ninguno. */
async function formatoQueAguanta(stream, conAudio, cual) {
    for (const tipo of formatosPara(conAudio)) {
        if (await aguanta(stream, tipo, cual)) return tipo;
    }
    return null;
}

/**
 * Deja la pista en el cuadro del vídeo que sale, y dice a qué quedó.
 *
 * Se pide acotada Y se acota después: medido, las dos funcionan por separado
 * —pedirla con `max` entra ya a 1920×1080, y `applyConstraints` baja una de
 * 5120×3200 que ya estaba abierta—, pero el selector del sistema de macOS es
 * quien resuelve el pedido y no se le puede exigir que honre la restricción.
 * La segunda vía es la que no depende de él.
 *
 * **Y encuadra en las dos direcciones, no solo hacia abajo.** Una cámara se
 * puede quedar clavada CHICA: `ojo.camaras()` abre la cámara con `video: true`
 * para poder leer los nombres, eso la negocia a 640×480, y el pedido de verdad
 * que viene detrás se encuentra el dispositivo ya abierto a ese tamaño y lo
 * hereda. Medido en la app: una OBSBOT que da 2560×1440 entró a 640×480. En la
 * esquina no se nota, pero una toma de «Yo» es la cámara llenando 1920×1080, y
 * ahí 640 de ancho se estiran a tres veces su tamaño.
 */
async function acotar(pista) {
    const mide = () => (pista.getSettings ? pista.getSettings() : {});
    const antes = mide();
    const grande = (antes.width || 0) > MAX_ANCHO || (antes.height || 0) > MAX_ALTO;
    const chica = (antes.width || 0) < MAX_ANCHO && (antes.height || 0) < MAX_ALTO;
    if (grande || chica) {
        try {
            await pista.applyConstraints({
                width: { ideal: MAX_ANCHO, max: MAX_ANCHO },
                height: { ideal: MAX_ALTO, max: MAX_ALTO },
                frameRate: { max: 30 }
            });
        } catch (e) {
            // Se sigue igual: puede que el codificador aguante este tamaño, y
            // quien lo decide es `aguanta()`, no esta cuenta.
        }
    }
    return mide();
}

/**
 * Abre el selector del sistema y devuelve la pantalla elegida, ya comprobada.
 *
 * Tiene que venir de un clic: el navegador no deja pedir la pantalla sin que la
 * persona lo haya pedido. No toca `estado`: devuelve el stream y quien llama
 * decide qué hacer con él. Eso es lo que deja cambiar de ventana a mitad de
 * grabación sin riesgo —la de antes sigue grabando mientras el selector está
 * abierto, y si se cancela no se tocó nada.
 */
async function pedirPantalla(enSeguida) {
    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30 },
                width: { max: MAX_ANCHO },
                height: { max: MAX_ALTO }
            },
            audio: false
        });
    } catch (e) {
        // Cancelar el selector entra por acá y no es un error que haya que
        // contar como tal: la persona dijo «no», y la pantalla sigue sin elegir.
        const cancelado = /denied|dismissed|abort/i.test(e.name + e.message);
        return cancelado
            ? { ok: false, cancelado: true }
            : { ok: false, error: `No se pudo tomar la pantalla: ${e.message}` };
    }
    const pista = stream.getVideoTracks()[0];
    // **Antes de grabar se adopta acá, y no al volver.** Comprobar el
    // codificador son cientos de milisegundos, y en todo ese rato
    // `tienePantalla()` diría que no hay ninguna aunque la persona ya la haya
    // elegido. De eso depende que aparezca el botón de Grabar, así que
    // adoptarla al final dejaba una ventana en la que apretarlo contestaba «no
    // hay ni cámara ni pantalla que grabar».
    //
    // Cambiando de ventana a mitad de grabación es justo al revés: adoptarla
    // temprano pisaría la que todavía está grabando, y es lo que hace que
    // cancelar el selector no cueste nada. Por eso esto va por parámetro.
    if (enSeguida) quedarse(stream, pista);
    const puesta = await acotar(pista);

    // Se comprueba contra ESTA fuente, no una vez por sesión: cada ventana entra
    // a su tamaño y el codificador rechaza unos y acepta otros, así que la
    // ventana nueva hay que probarla igual que la primera.
    const tipo = await formatoQueAguanta(stream, false, 'pantalla');
    if (!tipo) {
        if (enSeguida) await soltarPantalla();
        else for (const p of stream.getTracks()) p.stop();
        return {
            ok: false,
            error: `Este Mac no puede grabar esa pantalla (${puesta.width}×${puesta.height}): `
                + 'su codificador de vídeo la rechaza. Probá eligiendo una ventana en vez de la '
                + 'pantalla entera, o bajá la resolución en Ajustes del sistema.'
        };
    }
    if (enSeguida) estado.tipos.pantalla = tipo;
    return {
        ok: true,
        stream,
        pista,
        tipo,
        nombre: pista.label || 'la pantalla',
        ancho: puesta.width || null,
        alto: puesta.height || null
    };
}

/**
 * Se queda con la pantalla: la pone en `estado` y escucha si la sueltan.
 *
 * El tipo no entra acá porque los dos caminos lo saben en momentos distintos:
 * eligiendo se adopta antes de comprobarlo y se guarda después, y cambiando de
 * ventana ya viene comprobado.
 */
function quedarse(stream, pista) {
    estado.pantalla = stream;
    pista.onended = () => {
        // «Dejar de compartir» desde la barra del sistema.
        estado.pantalla = null;
        estado.tipos.pantalla = null;
        estado.alAviso({ tipo: 'pantalla-soltada' });
    };
}

/**
 * Elige la pantalla antes de grabar, para que se vea en la vista previa qué es
 * lo que va a quedar grabado.
 */
export async function elegirPantalla() {
    await soltarPantalla();
    const elegida = await pedirPantalla(true);
    if (!elegida.ok) return elegida;
    return { ok: true, nombre: elegida.nombre, ancho: elegida.ancho, alto: elegida.alto };
}

/**
 * Cambia de ventana sin parar la grabación.
 *
 * **La pantalla sale en tramos: un archivo por ventana.** Una pista de
 * `getDisplayMedia` está atada a la ventana que se eligió y no se la puede
 * repuntar, y `MediaRecorder` graba el juego de pistas que tenía al llamar a
 * `start()` —meterle una pista nueva al stream no la toma—. Así que cambiar es
 * cerrar un archivo y abrir el siguiente, cada uno con su hora de arranque.
 * `repartir`, en el exportador, elige para cada toma el tramo que la cubre.
 *
 * **La ventana nueva se pide ANTES de cerrar la que estaba**, y ese orden es
 * todo lo que hace que esto sirva. Mientras el selector del sistema está
 * abierto, la pantalla de antes sigue grabando: el hueco no es lo que tarde la
 * persona en elegir —que pueden ser varios segundos— sino lo que tarde el
 * cambio, que son los milisegundos de cerrar un archivo y abrir otro. Y si
 * cancela el selector, o si el codificador rechaza la ventana que eligió, la
 * grabación sigue intacta porque todavía no se tocó nada.
 *
 * Con una toma abierta el cambio igual se hace, porque pararlo sería peor: lo
 * que pasa es que esa toma queda a caballo entre dos tramos y ninguno la cubre
 * entera, así que sale con la cámara. Avisarlo es cosa de la pantalla, que es
 * quien sabe si hay una toma abierta.
 */
export async function cambiarPantalla() {
    // Antes de grabar, cambiar de ventana y elegirla son lo mismo.
    if (!grabando()) return elegirPantalla();

    const elegida = await pedirPantalla(false);
    if (!elegida.ok) return elegida;

    // Desde acá empieza el hueco, y todo lo que hay en medio es lo que lo
    // alarga: ni un `await` que no haga falta.
    const viejo = estado.grabadores.get('pantalla');
    const anterior = estado.pantalla;
    if (viejo) {
        await new Promise(listo => {
            if (viejo.state === 'inactive') return listo();
            // `onstop` entrega el pedazo que tenía a medias, y sin él el tramo
            // pierde sus últimos segundos.
            viejo.onstop = listo;
            try { viejo.stop(); } catch (e) { listo(); }
            return undefined;
        });
        estado.grabadores.delete('pantalla');
        // Los trozos viajan por `send`: un turno del bucle los deja llegar
        // antes de pedir el cierre del archivo, igual que en `terminar`.
        await new Promise(r => setTimeout(r, 50));
        await window.nt.semanalCerrar('pantalla');
    }

    const abierto = await window.nt.semanalAbrir({
        cual: 'pantalla', tipo: elegida.tipo, empezoMs: Date.now()
    });
    if (!abierto.ok) {
        // El tramo nuevo no se pudo abrir y el viejo ya está cerrado: lo que
        // hay grabado hasta acá se queda, y se dice que desde ahora no hay
        // pantalla. Peor sería seguir como si nada y no grabar nada más.
        for (const p of elegida.stream.getTracks()) p.stop();
        if (anterior) await soltarPantalla();
        estado.salud.delete('pantalla');
        estado.alAviso({ tipo: 'roto', cual: 'pantalla', error: abierto.error });
        return { ok: false, error: abierto.error };
    }

    let grabador;
    try {
        grabador = new MediaRecorder(elegida.stream, {
            mimeType: elegida.tipo, videoBitsPerSecond: CALIDAD.pantalla
        });
    } catch (e) {
        for (const p of elegida.stream.getTracks()) p.stop();
        return { ok: false, error: `No se pudo preparar la pantalla nueva: ${e.message}` };
    }
    enganchar({ cual: 'pantalla', grabador, stream: elegida.stream, tipo: elegida.tipo, conAudio: false });
    grabador.start(CADA_MS);

    // Y recién ahora se suelta la de antes: soltarla primero habría dejado un
    // hueco más largo por nada.
    if (anterior) {
        for (const p of anterior.getTracks()) { p.onended = null; p.stop(); }
    }
    quedarse(elegida.stream, elegida.pista);
    estado.tipos.pantalla = elegida.tipo;
    window.nt.anotar('semanal.cambio-de-ventana', {
        nombre: elegida.nombre, ancho: elegida.ancho, alto: elegida.alto, tramo: abierto.tramo
    });
    return { ok: true, nombre: elegida.nombre, ancho: elegida.ancho, alto: elegida.alto };
}

export function laPantalla() {
    return estado.pantalla;
}

export function tienePantalla() {
    return Boolean(estado.pantalla && estado.pantalla.getVideoTracks().length);
}

export async function soltarPantalla() {
    estado.tipos.pantalla = null;
    if (!estado.pantalla) return;
    for (const pista of estado.pantalla.getTracks()) {
        pista.onended = null;
        pista.stop();
    }
    estado.pantalla = null;
}

/** Cómo se llama cada fuente cuando hay que nombrarla en un cartel. */
const nombreDe = cual => (cual === 'camara' ? 'tu cámara' : 'tu pantalla');

/**
 * Le toma el pulso a lo que se está grabando y avisa UNA vez por fuente.
 *
 * Una vez y no en cada vuelta: quien graba está hablando a cámara y no puede
 * hacer nada con el segundo cartel que no pudiera hacer con el primero. El
 * renglón que `pantalla-semanal.js` deja fijo en la tarjeta es el que queda.
 */
function tomarElPulso() {
    for (const cual of estado.grabadores.keys()) {
        const salud = estado.salud.get(cual);
        if (!salud || salud.avisado) continue;

        // Las pistas que se guardaron al arrancar, y no `grabador.stream`: es el
        // mismo objeto, y pedirlo por acá no depende de que el grabador lo
        // exponga (la maqueta usa uno falso que no lo tiene).
        const pistas = salud.pistas;
        const muerta = pistas.find(p => p.readyState === 'ended');
        const muda = pistas.find(p => p.muted);
        const tope = SIN_NADA_MS[cual] || SIN_NADA_MS.pantalla;
        const quieto = !salud.bytes && Date.now() - salud.desdeMs > tope;
        if (!muerta && !muda && !quieto) continue;

        salud.avisado = true;
        const error = muerta
            ? 'se apagó la fuente'
            : (muda ? 'dejó de llegar imagen' : `no llegó nada en ${Math.round(tope / 1000)} s`);
        window.nt.anotar('semanal.fuente-caida', {
            cual,
            motivo: error,
            bytes: salud.bytes,
            segundos: Math.round((Date.now() - salud.desdeMs) / 1000),
            pistas: pistas.map(p => ({
                estado: p.readyState, muda: p.muted, encendida: p.enabled, nombre: p.label
            }))
        });
        estado.alAviso({ tipo: 'roto', cual, error });
    }
}

/**
 * Le pone a un grabador el pulso, el diario y la salida de pedazos.
 *
 * Está suelto porque lo usan las dos vías que arrancan un grabador: `empezar`,
 * con los dos de la sesión, y `cambiarPantalla`, con el tramo nuevo. Mientras
 * estaba escrito dentro del bucle de `empezar`, un tramo nuevo habría quedado
 * grabando sin pulso y sin nadie escuchando sus pedazos.
 *
 * No llama a `start()`: en `empezar` los dos `start()` van juntos al final y
 * esa distancia es el desfase entre los dos vídeos.
 */
function enganchar(l) {
    const pistas = (l.stream.getVideoTracks && l.stream.getVideoTracks()) || [];
    estado.salud.set(l.cual, { bytes: 0, desdeMs: Date.now(), avisado: false, pistas });
    // Con qué entra cada fuente, anotado antes del primer fotograma. Es el
    // dato que faltaba la vez que la cámara terminó en cero: sin él no hubo
    // forma de saber a qué tamaño estaba grabando.
    const pista = pistas[0];
    const puesta = (pista && pista.getSettings && pista.getSettings()) || {};
    window.nt.anotar('semanal.fuente', {
        cual: l.cual,
        tipo: l.tipo,
        ancho: puesta.width || null,
        alto: puesta.height || null,
        fps: puesta.frameRate ? Math.round(puesta.frameRate) : null,
        nombre: (pista && pista.label) || null,
        conAudio: l.conAudio
    });

    l.grabador.ondataavailable = async e => {
        if (!e.data || !e.data.size) return;
        const salud = estado.salud.get(l.cual);
        if (salud) salud.bytes += e.data.size;
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        window.nt.semanalTrozo(l.cual, bytes);
    };
    l.grabador.onerror = e => {
        estado.alAviso({
            tipo: 'roto',
            cual: l.cual,
            error: (e.error && e.error.message) || 'el grabador se detuvo'
        });
    };
    estado.grabadores.set(l.cual, l.grabador);
}

/**
 * Arranca los dos grabadores.
 *
 * Los dos `start()` van seguidos y sin nada en medio —ni un `await`— porque la
 * distancia entre los dos es el desfase que va a tener el vídeo. Lo que sí va
 * antes es abrir los archivos, que es lo que puede tardar.
 *
 * @returns {Promise<{ok:boolean, error?:string, grabando?:string[]}>}
 */
export async function empezar(avisos) {
    if (avisos && avisos.alAviso) estado.alAviso = avisos.alAviso;

    const pistaDelMicro = oido.laPista();
    const pedidos = [];

    const camara = ojo.elStream();
    if (camara && camara.getVideoTracks().length) {
        // La cámara se acota igual que la pantalla, y por lo mismo: `ojo.js` la
        // abre pidiéndole lo más grande que tenga —le sirve, porque de ahí saca
        // las fotos de referencia de una clase— y acá eso no se usa para nada.
        // Una OBSBOT entra a 2560×1440 y el exportador la mete en un cuadrado
        // de 360 o, como mucho, en el cuadro de 1920×1080: cada píxel de más es
        // codificador y disco gastados en algo que se va a tirar, y encima le
        // roba CPU a Whisper, que es quien abre las tomas cuando se dice «3, 2, 1».
        await acotar(camara.getVideoTracks()[0]);
        pedidos.push({
            cual: 'camara',
            stream: new MediaStream([
                ...camara.getVideoTracks(),
                ...(pistaDelMicro ? [pistaDelMicro] : [])
            ]),
            conAudio: Boolean(pistaDelMicro)
        });
    }
    if (tienePantalla()) {
        pedidos.push({ cual: 'pantalla', stream: estado.pantalla, conAudio: false });
    }
    if (!pedidos.length) return { ok: false, error: 'No hay ni cámara ni pantalla que grabar.' };

    // Primero los archivos, y solo después los `start()`.
    const listos = [];
    for (const pedido of pedidos) {
        // El de la pantalla ya se comprobó contra esta fuente al elegirla. El de
        // la cámara se comprueba acá y no se guarda: la cámara se puede cambiar
        // en el selector, y entonces lo comprobado sería de otra.
        const tipo = estado.tipos[pedido.cual]
            || await formatoQueAguanta(pedido.stream, pedido.conAudio, pedido.cual);
        if (!tipo) {
            return {
                ok: false,
                error: `Este Mac no puede grabar ${nombreDe(pedido.cual)}: su codificador de vídeo `
                    + 'rechaza esa fuente.'
            };
        }
        let grabador;
        try {
            grabador = new MediaRecorder(pedido.stream, {
                mimeType: tipo,
                videoBitsPerSecond: CALIDAD[pedido.cual]
            });
        } catch (e) {
            return { ok: false, error: `No se pudo preparar el vídeo de ${pedido.cual}: ${e.message}` };
        }
        listos.push({ ...pedido, tipo, grabador });
    }

    const abiertos = [];
    for (const l of listos) {
        // `empezoMs` se manda con la hora de ESTE instante y los `start()` van
        // justo después: entre abrir el archivo y arrancar no hay nada.
        const r = await window.nt.semanalAbrir({ cual: l.cual, tipo: l.tipo, empezoMs: Date.now() });
        if (!r.ok) {
            for (const a of abiertos) a.grabador.stop();
            await window.nt.semanalCerrar();
            return { ok: false, error: r.error };
        }
        abiertos.push(l);
    }

    for (const l of abiertos) enganchar(l);
    // Los dos a la vez. La hora que se mandó arriba es esta, con el error de un
    // `await` de IPC en medio: medido, el primer fotograma cae a 43 ms.
    for (const l of abiertos) l.grabador.start(CADA_MS);

    if (estado.pulso) clearInterval(estado.pulso);
    estado.pulso = setInterval(tomarElPulso, PULSO_MS);

    return { ok: true, grabando: abiertos.map(l => l.cual) };
}

/**
 * Para los dos grabadores y espera a que suelten lo último.
 *
 * Esperar el `onstop` de cada uno no es opcional: `MediaRecorder` entrega en ese
 * momento el pedazo que tenía a medias, y sin él el archivo pierde los últimos
 * segundos, que es justo donde está el final de la última toma.
 */
export async function terminar() {
    if (estado.pulso) { clearInterval(estado.pulso); estado.pulso = null; }
    estado.salud.clear();
    const paradas = [...estado.grabadores.values()].map(g => new Promise(listo => {
        if (g.state === 'inactive') return listo();
        g.onstop = listo;
        try { g.stop(); } catch (e) { listo(); }
        return undefined;
    }));
    await Promise.all(paradas);
    estado.grabadores.clear();
    // Los pedazos viajan por `send`, así que el último puede ir todavía en el
    // aire cuando esto vuelve: un turno del bucle de eventos los deja llegar
    // antes de pedir el cierre de los archivos.
    await new Promise(r => setTimeout(r, 50));
    const r = await window.nt.semanalCerrar();
    await soltarPantalla();
    return r;
}

export function grabando() {
    return estado.grabadores.size > 0;
}
