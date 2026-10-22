'use strict';
/**
 * mirilla.js — La ventanita flotante que te deja verte mientras grabás.
 *
 * Lo que hace falta: quien graba su vídeo de la semana no se ve. Su cámara va
 * en una esquina del vídeo final, tapando un pedazo de lo que está
 * enseñando, y eso no se descubre hasta mirar el MP4 al día siguiente, cuando
 * la caja que importaba quedó debajo de su propia cara. Lo pidió así: «un
 * pequeño player en la esquina inferior derecha, donde saldría el mini
 * profesor en la edición final, mientras esté grabando».
 *
 * **Flota sobre el escritorio de verdad, y por eso no compone nada.** La
 * ventana se pone en el mismo sitio y al mismo tamaño que va a tener el
 * recuadro en el export, encima de tu pantalla tal como está. Lo que ves no es
 * una simulación de la composición: ES la composición, porque el fondo es
 * literalmente la pantalla que se está grabando. Un preview que dibujara la
 * pantalla capturada dentro de un cuadro chiquito habría costado componer dos
 * vídeos en vivo para mostrar peor lo mismo.
 *
 * **Y se saca de la captura.** `setContentProtection` la marca como no
 * compartible y ScreenCaptureKit la omite. No es un detalle estético: sin eso,
 * grabando la pantalla entera, tu cara saldría DOS veces en el vídeo —una
 * grabada en el fondo y otra que `ffmpeg` pone encima al exportar—. Medido
 * antes de escribir esto: con la protección puesta, cero píxeles de la ventana
 * en un fotograma de 4112×2658; sin ella, los 397.138 que ocupa.
 *
 * **La cámara la abre ella misma, y nunca primero.** Las dos ventanas pueden
 * tener la misma cámara abierta a la vez —Chromium comparte una sola captura
 * del dispositivo y reparte los fotogramas—, pero el primero que abre negocia
 * el formato y el segundo lo hereda. Medido: con la mirilla abriendo primero y
 * sin pedir tamaño, la cámara queda en 640×480 y la grabación de verdad entra
 * ahí detrás y sale en 640×480. Por eso esta ventana no se abre hasta que la
 * pantalla principal ya tiene la suya, y pide exactamente las mismas
 * `constraints` (ver `ANCHO_TOPE` en `src/js/grabar/ojo.js`).
 */

const path = require('path');

/**
 * La geometría del recuadro en el vídeo final.
 *
 * Son los mismos números que `engine/exportar-video.js`, y están copiados a
 * propósito: este archivo corre en el proceso principal y aquel es del motor
 * del corte, así que importarlo por tres constantes traería medio exportador.
 * Lo que no se puede es que se separen, y de eso se encarga una prueba que
 * compara los dos archivos.
 */
const CUADRO_ANCHO = 1920;
const CAMARA_LADO = 360;
const MARGEN = 48;

/** Lo más chica que se deja, en puntos: por debajo no se distingue una cara. */
const LADO_MINIMO = 120;

/**
 * Qué monitor se está grabando, si se puede saber.
 *
 * `getSettings().deviceId` de una pista de pantalla trae `screen:N:0`, y esa N
 * es el `display_id` de su monitor (el `id` del `Display` de `screen`). Medido
 * con el selector apagado; con el selector del sistema puede venir vacío, y
 * entonces no se adivina: se cae al monitor donde está la ventana de la app,
 * que es donde está la persona.
 *
 * Compartiendo UNA ventana en vez de la pantalla entera tampoco se sabe —la
 * pista no dice en qué monitor vive esa ventana— y da igual: en ese caso la
 * mirilla no entra en la captura de ninguna manera, así que lo único que
 * importa es que se vea.
 */
function monitorDe(pista, pantallas) {
    const id = pista && pista.deviceId;
    const m = /^screen:(\d+):/.exec(String(id || ''));
    if (!m) return null;
    const fuente = (pantallas || []).find(f => String(f.display_id) === m[1]);
    return fuente ? m[1] : null;
}

/**
 * Dónde y de qué tamaño va la ventana en ese monitor.
 *
 * El export siempre es 1920 de ancho, así que el recuadro ocupa 360/1920 del
 * ancho del cuadro y se despega 48/1920. Llevado al monitor, eso es la misma
 * fracción de su ancho: así lo que tapás en pantalla es lo que vas a tapar en
 * el vídeo, que es la única razón de que esto exista.
 *
 * Un monitor que no sea 16:9 no da una correspondencia exacta —la captura se
 * encaja en el cuadro del export— pero sí la de la esquina y la del ancho, que
 * es lo que se mira.
 */
function sitioEn(monitor) {
    const b = monitor.bounds;
    const lado = Math.max(LADO_MINIMO, Math.round(b.width * CAMARA_LADO / CUADRO_ANCHO));
    const margen = Math.round(b.width * MARGEN / CUADRO_ANCHO);
    return {
        x: b.x + b.width - lado - margen,
        y: b.y + b.height - lado - margen,
        width: lado,
        height: lado
    };
}

/**
 * Lo único que un gesto puede pedir, y nada más se reenvía.
 *
 * La mirilla no habla con el motor: le pasa el gesto a la pantalla semanal,
 * que lo atiende como a sus propios botones. Que llegue tal cual vino sería
 * que cualquier cosa que esa página mande entre por la puerta de la otra.
 */
function gestoLimpio(gesto) {
    const g = gesto || {};
    if (g.hace === 'toma') return { hace: 'toma' };
    if (g.hace === 'vista' && typeof g.vista === 'string' && g.vista) return { hace: 'vista', vista: g.vista };
    return null;
}

function registrar({ ipcMain, BrowserWindow, screen, ventanaPrincipal, anotar }) {
    let ventana = null;
    let quiereEstar = false;
    let dondeCae = null;          // el id del monitor que se está capturando

    /** El monitor donde ponerla: el que se graba, o el de la app. */
    function elMonitor() {
        const todos = screen.getAllDisplays();
        const suyo = dondeCae && todos.find(d => String(d.id) === String(dondeCae));
        if (suyo) return suyo;
        const app = ventanaPrincipal();
        if (app && !app.isDestroyed()) return screen.getDisplayMatching(app.getBounds());
        return screen.getPrimaryDisplay();
    }

    /** ¿Lo manda la mirilla? ¿Lo manda la app? Cada una tiene su mitad. */
    const deLaMirilla = event => Boolean(ventana && !ventana.isDestroyed() && event.sender === ventana.webContents);
    const deLaApp = event => {
        const app = ventanaPrincipal();
        return Boolean(app && !app.isDestroyed() && event.sender === app.webContents);
    };

    /**
     * Ponerla donde va, ahora.
     *
     * Se usa `setBounds` y después se lee: macOS corrige la geometría de una
     * ventana sin marco —medido, una de 300×300 volvió como 300×332— y esta
     * función existe para que el tamaño coincida con el del export, así que
     * creerle al número pedido sería creerle al que no es.
     */
    function acomodar() {
        if (!ventana || ventana.isDestroyed()) return null;
        const quiere = sitioEn(elMonitor());
        ventana.setBounds(quiere);
        const quedo = ventana.getBounds();
        if (quedo.width !== quiere.width || quedo.height !== quiere.height) {
            // No se insiste: lo que importa es que la página dibuje el recuadro
            // con el tamaño que de verdad tiene, y eso lo sabe ella sola.
            anotar('mirilla.geometria-corregida', { pedida: quiere, quedo });
        }
        return quedo;
    }

    /**
     * Abrirla, o acomodar la que ya está.
     *
     * Todo lo que llega más tarde —`ready-to-show`, `closed`— mira la ventana
     * que ESTE llamado creó y no la del módulo. `close()` es asíncrono: apagar
     * y encender rápido crea la segunda antes de que la primera avise que se
     * cerró, y ese aviso, mirando la del módulo, dejaba a la nueva sin dueño.
     * Sin marco, encima de todo y sin nadie que pueda cerrarla.
     */
    function abrir() {
        escucharMonitores();
        if (ventana && !ventana.isDestroyed()) { acomodar(); return ventana; }
        const sitio = sitioEn(elMonitor());
        const w = new BrowserWindow({
            ...sitio,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: false,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            show: false,
            webPreferences: {
                // Su propio puente, con sus tres llamadas: un espejo con tres
                // botones no tiene por qué poder abrir carpetas ni terminar la
                // grabación.
                preload: path.join(__dirname, '..', 'preload-mirilla.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true
            }
        });
        ventana = w;
        // `screen-saver` y no `floating`: con `floating` queda debajo de una app
        // en pantalla completa, que es justo cuando más falta hace verse.
        w.setAlwaysOnTop(true, 'screen-saver');
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        // Lo que la saca de la grabación de pantalla.
        w.setContentProtection(true);
        // Es una página y nada más: ni se va a otra ni abre ventanas.
        w.webContents.on('will-navigate', e => e.preventDefault());
        w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        w.loadFile(path.join(__dirname, '..', 'src', 'mirilla.html'));
        w.once('ready-to-show', () => {
            if (quiereEstar && ventana === w) { w.showInactive(); acomodar(); }
        });
        w.on('closed', () => { if (ventana === w) ventana = null; });
        anotar('mirilla.abierta', { sitio });
        return w;
    }

    /**
     * El espejo: lo que la mirilla tiene que mostrar.
     *
     * **La mirilla no es dueña de nada.** Qué vista va en la toma que viene es
     * estado de la pantalla semanal —vive en su `estado.vista`— y si acá se
     * guardara una copia habría dos versiones de lo mismo, que es exactamente
     * lo que esta app no hace en ninguna parte. Así que la semanal le manda qué
     * mostrar y la mirilla lo muestra: un espejo.
     *
     * Se guarda el último para que, al abrirla, la ventana tenga algo que
     * dibujar sin esperar al próximo latido. Y se olvida al cerrarla: reabierta,
     * un espejo de antes le diría que la cámara está abierta cuando a lo mejor
     * ya no, y abrirla sin que nadie la tenga es lo que baja la grabación a
     * 640×480 (ver arriba).
     */
    let ultimoEspejo = {};

    /**
     * Quitarla.
     *
     * `destroy` y no `close`: `close` es asíncrono y se puede cancelar, y el
     * módulo la soltaba en el acto. Una que no terminaba de irse quedaba sin
     * dueño, sin marco y encima de todo: el editor la vio con la app ya
     * cerrada. Es un espejo sin nada que guardar, así que no hay nada que esperar.
     *
     * Queda anotado por qué, que es lo que faltaba en el diario para saber qué
     * pasó la vez que quedó a la vista.
     *
     * @param {string} porque quién la quita: el botón, la ventana de la app, la salida
     */
    function cerrar(porque) {
        quiereEstar = false;
        const habia = Boolean(ventana && !ventana.isDestroyed());
        if (habia) ventana.destroy();
        ventana = null;
        ultimoEspejo = {};
        if (habia) anotar('mirilla.cerrada', { porque: porque || 'sin decir' });
    }

    /**
     * Si se mueven los monitores debajo, la esquina de ayer ya no es la esquina.
     *
     * Se engancha al abrir y no acá arriba porque `registrar` corre al cargar
     * `main.js`, antes del `ready` de la app, y el módulo `screen` de Electron
     * no existe hasta entonces.
     */
    let escuchandoMonitores = false;
    function escucharMonitores() {
        if (escuchandoMonitores) return;
        escuchandoMonitores = true;
        screen.on('display-metrics-changed', acomodar);
        screen.on('display-added', acomodar);
        screen.on('display-removed', acomodar);
    }

    /** Encenderla o apagarla. Lo pide la pantalla semanal. */
    ipcMain.handle('mirilla-poner', (event, encendida) => {
        if (!deLaApp(event)) return { ok: false };
        quiereEstar = Boolean(encendida);
        if (!quiereEstar) { cerrar('se apagó'); return { ok: true, visible: false }; }
        const w = abrir();
        if (!w.isVisible() && !w.webContents.isLoading()) { w.showInactive(); acomodar(); }
        return { ok: true, visible: true };
    });

    // Por `send` y no por `invoke`: sale en cada repintado de la semanal y no
    // hay nada que esperar de vuelta, igual que el PCM.
    ipcMain.on('mirilla-espejo', (event, info) => {
        if (!deLaApp(event)) return;
        ultimoEspejo = info || {};
        if (ventana && !ventana.isDestroyed()) ventana.webContents.send('mirilla-espejo', ultimoEspejo);
    });

    /** Y lo que la mirilla trae al cargar, sin esperar al próximo latido. */
    ipcMain.handle('mirilla-que-muestro', event => (deLaMirilla(event) ? ultimoEspejo : {}));

    /**
     * El mando a distancia: los tres botones no hacen, piden.
     *
     * Van a la pantalla semanal y entran por donde entran sus propios clics,
     * así que apretar «PV» en la mirilla y apretarlo en la app son el mismo
     * gesto y no dos caminos que podrían discrepar.
     */
    ipcMain.handle('mirilla-gesto', (event, gesto) => {
        const app = ventanaPrincipal();
        const limpio = gestoLimpio(gesto);
        if (!deLaMirilla(event) || !limpio || !app || app.isDestroyed()) return { ok: false };
        app.webContents.send('mirilla-gesto', limpio);
        return { ok: true };
    });

    /**
     * Qué pantalla se está capturando, para mudarse a ese monitor.
     *
     * Lo manda la pantalla semanal cada vez que se elige o se cambia la
     * ventana que se graba. Si no se puede saber el monitor, se queda donde
     * estaba: mudarla a un sitio inventado sería peor que no mudarla.
     *
     * Los monitores salen de `screen` y no de `desktopCapturer`: el
     * `display_id` de una fuente de pantalla ES el `id` de su `Display`, y
     * `getSources` dibuja una miniatura de cada monitor solo para decir que
     * existe.
     */
    ipcMain.handle('mirilla-pantalla', (event, pista) => {
        if (!deLaApp(event)) return { ok: false };
        const pantallas = screen.getAllDisplays().map(d => ({ display_id: String(d.id) }));
        const cual = monitorDe(pista, pantallas);
        if (cual !== dondeCae) {
            anotar('mirilla.monitor', { antes: dondeCae, ahora: cual, pista: pista || null });
        }
        if (cual) dondeCae = cual;
        return { ok: true, monitor: dondeCae, sitio: acomodar() };
    });

    return { cerrar };
}

module.exports = { registrar, sitioEn, monitorDe, gestoLimpio, CUADRO_ANCHO, CAMARA_LADO, MARGEN, LADO_MINIMO };
