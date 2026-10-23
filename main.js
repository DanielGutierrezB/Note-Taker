'use strict';
/**
 * main.js — Proceso principal de Note Taker.
 *
 * Todo el trabajo que no es dibujar vive acá, en Node: escribir el WAV mientras
 * entra, llamar a Whisper, decidir qué es una toma y escribir el XML. La ventana
 * manda el audio y los gestos del editor y recibe el estado entero de vuelta.
 *
 * El motivo no es de rendimiento sino de verdad: si el estado viviera en la
 * ventana, las señales las decidiría un archivo y el XML lo escribiría otro, y
 * en cuanto discreparan la clase quedaría con marcadores que nadie vio. Y el
 * motor se puede probar entero sin abrir la app (`node tests/run.js`).
 */

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard,
    session, desktopCapturer, screen, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

const paths = require('./engine/paths');
const ajustes = require('./engine/ajustes');
const updates = require('./engine/updates');
const registro = require('./engine/registro');
const dependencias = require('./engine/dependencias');
const ipcGrabar = require('./ipc/grabar');
const ipcPrproj = require('./ipc/prproj');
const ipcReferencias = require('./ipc/referencias');
const ipcSemanal = require('./ipc/semanal');
const ipcMirilla = require('./ipc/mirilla');
const ipcReporte = require('./ipc/reporte');
const { conDiario } = require('./ipc/con-diario');
const devShot = require('./dev-shot');

let mainWindow = null;
let mirilla = null;
let descargaEnCurso = null;

function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version;
    } catch (e) {
        return app.getVersion();
    }
}

/**
 * Avisarle algo a la ventana de la app.
 *
 * Solo a ella. La mirilla no escucha al motor: lo que muestra se lo cuenta la
 * pantalla semanal por el espejo (`ipc/mirilla.js`), que es la dueña.
 */
function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** Una línea en el diario de la sesión (`engine/registro.js`). */
function anotar(evento, datos) {
    registro.anotar('main', evento, datos);
}

/**
 * Los pedidos de la ventana, todos anotados (`ipc/con-diario.js`). Salvo el
 * propio diario y las preguntas que la ventana hace solo para pintarse, que
 * dirían lo mismo cada vez y no son acciones.
 */
const ipc = conDiario(ipcMain, anotar, new Set([
    'registro-anotar', 'app-info', 'ajustes-leer', 'grabar-estado', 'grabar-vistas', 'audio-app-estado'
]));

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 840,
        // El mínimo es el ancho al que la pantalla de En vivo todavía entra con
        // sus dos columnas; por debajo el costado baja y sigue funcionando.
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0f1115',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    permitirPedirLaPantalla();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    // La mirilla se va con ella. Es una ventana sin marco y sin botón de
    // cerrar, pegada encima de todo lo demás: sola en la pantalla, sin la app
    // que la mandó abrir, no habría forma de quitársela de encima. Y en macOS
    // la app no se cierra al cerrar su ventana, así que esto no es hipotético.
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (mirilla) mirilla.cerrar('se cerró la ventana de la app');
    });
    mainWindow.loadFile('src/index.html');
    // El arnés de desarrollo (capturas, JS inyectado) vive en `dev-shot.js` y
    // sin sus flags no hace nada.
    mainWindow.webContents.once('did-finish-load', () => devShot.correr(mainWindow));
}

/**
 * Deja que la ventana pueda pedir la pantalla (el modo semanal la graba).
 *
 * En Electron, `navigator.mediaDevices.getDisplayMedia` no hace nada hasta que
 * el proceso principal dice quién elige la fuente. Con `useSystemPicker` la
 * elige el selector de macOS —el mismo que sale al compartir pantalla en
 * cualquier app— y entonces este handler ni se llama. Es lo que se quiere: la
 * persona ve las ventanas y las pantallas de verdad, con sus miniaturas, sin
 * que esta app tenga que dibujar un selector propio.
 *
 * El selector del sistema es de macOS 15 en adelante, y esta app corre desde la
 * 14.2 (la tiene como mínimo el ayudante de audio). Por eso el handler está
 * puesto igual: en una Mac más vieja no hay selector, así que se graba la
 * pantalla principal, que es lo que esa persona iba a elegir de todos modos.
 */
function permitirPedirLaPantalla() {
    session.defaultSession.setDisplayMediaRequestHandler(async (pedido, contestar) => {
        try {
            const fuentes = await desktopCapturer.getSources({ types: ['screen'] });
            anotar('semanal.pantalla-sin-selector', { cuantas: fuentes.length });
            contestar(fuentes.length ? { video: fuentes[0] } : {});
        } catch (err) {
            anotar('semanal.pantalla-falla', { error: err.message });
            contestar({});
        }
    }, { useSystemPicker: true });
}

// Un fallo suelto no puede dejar la app viva pero muda: se registra y sigue.
// Y queda en el diario, que es justo la clase de cosa que el editor no ve y que
// explica por qué algo dejó de andar en medio de una clase.
process.on('uncaughtException', err => {
    anotar('error.no-atrapado', { mensaje: err && err.message });
    console.error('Excepción no atrapada:', err);
});
process.on('unhandledRejection', reason => {
    anotar('error.promesa', { mensaje: reason && reason.message ? reason.message : String(reason) });
    console.error('Promesa rechazada:', reason);
});

/**
 * La ventana de la clase, al frente: la que hay aunque esté escondida, o una
 * nueva si se cerró.
 *
 * Mirar si queda «alguna ventana» no alcanza, y así estaba: la mirilla es una
 * ventana, así que con ella abierta y la de la clase escondida, el clic en el
 * dock no hacía nada y la clase quedaba grabando sin ventana desde donde
 * terminarla.
 */
function traerLaVentana() {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

/**
 * Una sola Note Taker a la vez.
 *
 * Sin esto, abrirla otra vez abría otra copia entera, con su motor, su diario y
 * su cámara: el editor perdió la ventana de una que estaba grabando, la volvió a
 * abrir desde el dock, y quedaron dos —la primera con una grabación abierta que
 * nadie podía terminar—. Ahora la segunda le pasa el foco a la primera y se va.
 *
 * Los guiones de `tools/` arrancan la app misma, así que con la app abierta
 * tampoco corren: es lo que tiene que pasar, porque graban con el mismo motor,
 * los mismos ajustes y el mismo diario.
 */
if (!app.requestSingleInstanceLock()) {
    console.error('Ya hay una Note Taker abierta: le paso el foco a esa.');
    app.quit();
} else {
    app.on('second-instance', traerLaVentana);
    app.whenReady().then(() => {
        // Lo primero de todo, antes de anotar nada: el diario en disco. Si se
        // abriera después, las líneas del arranque —que son las que explican
        // una app que no llega ni a mostrar la ventana— quedarían solo en memoria.
        const diario = registro.abrirDiario(app.getPath('userData'));
        anotar('app.arranca', {
            version: appVersion(),
            electron: process.versions.electron,
            arch: process.arch,
            diario: diario.ok ? `guardando (${diario.teniamos} línea(s) de antes)` : `sin guardar: ${diario.error}`
        });
        createWindow();
        app.on('activate', traerLaVentana);
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // La mirilla, antes que nada y sin esperar a que se cierre la ventana de la
    // app: con ⌘Q no se le pedía nada a ella, y una ventana encima de todo que
    // tarda en irse es lo primero que se ve de una app que dice haberse cerrado.
    if (mirilla) mirilla.cerrar('la app se cierra');
    // Y el último segundo del diario, que si no se pierde. Es el segundo más
    // interesante cuando alguien cierra la app porque se le quedó colgada. (La
    // grabación en curso la cierra su propio puente: `ipc/grabar.js`.)
    anotar('app.cierra', {});
    registro.volcar();
});

// ─── Puente con la ventana ────────────────────────────────────────────

ipc.handle('app-info', () => ({
    version: appVersion(),
    arch: process.arch,
    electron: process.versions.electron,
    platform: process.platform
}));

// ─── El diario de la sesión ───────────────────────────────────────────

/**
 * La ventana también anota.
 *
 * Podría llevar su propio registro y mandarlo entero al descargar, pero
 * entonces habría dos diarios con dos relojes y el archivo mezclaría dos
 * ordenamientos: qué pasó primero, si el clic o el ciclo que disparó, dejaría
 * de leerse. Con un solo registro, el orden del archivo es el orden real.
 */
ipc.handle('registro-anotar', (event, { evento, datos } = {}) => {
    registro.anotar('ventana', evento, datos);
    return true;
});

ipc.handle('doctor', async () => paths.doctor());

// Lo que falta, y el botón que lo instala (`engine/dependencias.js`). El avance
// va por un canal aparte porque una descarga de 1,6 GB tarda minutos.
ipc.handle('dependencias-estado', () => dependencias.estado());
ipc.handle('dependencias-instalar', async (event, clave) => {
    const r = await dependencias.instalar(clave, p => {
        if (!event.sender.isDestroyed()) event.sender.send('dependencias-progreso', { clave, ...p });
    });
    registro.anotar('main', 'dependencias.instalar', { clave, ok: r.ok, error: r.error || null });
    return r;
});
ipc.handle('dependencias-cancelar', (event, clave) => dependencias.cancelar(clave));

// ─── Ajustes ──────────────────────────────────────────────────────────

ipc.handle('ajustes-leer', () => ajustes.leer());

/**
 * Guarda un PARCHE sobre lo que hay, no el objeto entero.
 *
 * Cada pantalla manda solo lo suyo: Ajustes el fps y el idioma, Preparar la
 * carpeta y el dispositivo. Si una mandara todo lo que cargó al abrirse,
 * pisaría lo que la otra guardó mientras estaba abierta.
 *
 * El parche entra un nivel adentro (ver `ajustes.conParche`).
 */
ipc.handle('ajustes-guardar', (event, datos) => {
    const parche = datos || {};
    try {
        const guardados = ajustes.guardar(ajustes.conParche(ajustes.leer(), parche));
        anotar('ajustes.guardados', { que: Object.keys(parche), fps: guardados.fps });
        return { ok: true, ajustes: guardados };
    } catch (err) {
        anotar('ajustes.no-guardados', { error: err.message });
        return { ok: false, error: err.message };
    }
});

ipc.handle('carpeta-recordar', (event, ruta) => ajustes.recordarCarpeta(ruta));

/**
 * Cuáles de las carpetas recordadas siguen en el disco.
 *
 * Se pregunta cada vez que la pantalla se abre en vez de guardarse: un disco
 * externo se enchufa y se desenchufa, así que un "no está" escrito hoy sería
 * mentira mañana.
 */
ipc.handle('carpetas-en-disco', (event, rutas) => {
    const salida = {};
    for (const ruta of rutas || []) {
        salida[ruta] = fs.existsSync(ruta);
    }
    return salida;
});

// ─── Actualizaciones ──────────────────────────────────────────────────

ipc.handle('update-check', async () => {
    const res = await updates.check({ currentVersion: appVersion() });
    anotar('update.buscada', {
        hay: Boolean(res && res.hay),
        version: (res && res.version) || null,
        motivo: (res && res.motivo) || null
    });
    return res;
});

/**
 * Baja el instalador y lo abre.
 *
 * Se abre en vez de instalarlo solo: sin Developer ID de Apple la app va firmada
 * ad-hoc, y el instalador silencioso de macOS valida firmas que no tenemos (ver
 * `engine/updates.js`). Abrir el PKG deja al editor a un clic de Continuar.
 */
ipc.handle('update-download', async (event, payload) => {
    if (descargaEnCurso) return { ok: false, error: 'Ya se está descargando.' };
    const { url, nombre } = payload || {};
    if (!url) return { ok: false, error: 'No llegó de dónde bajarla.' };

    const controller = new AbortController();
    descargaEnCurso = controller;
    try {
        const result = await updates.download({
            url,
            nombre,
            // A Descargas y no a una carpeta temporal: si algo sale mal a mitad
            // de la instalación, el editor todavía tiene el instalador a mano.
            destDir: app.getPath('downloads'),
            signal: controller.signal,
            onProgress: info => send('update-progress', info)
        });
        anotar('update.descargada', { ok: Boolean(result.ok), error: result.error || null });
        if (result.ok) send('update-ready', { path: result.path });
        return result;
    } finally {
        descargaEnCurso = null;
    }
});

ipc.handle('update-cancel', () => {
    if (descargaEnCurso) descargaEnCurso.abort();
    return { ok: true };
});

ipc.handle('update-install', async (event, target) => {
    if (!target || !fs.existsSync(target)) {
        return { ok: false, error: 'El instalador ya no está donde se bajó.' };
    }
    // En medio de una clase no: cerrar acá pierde lo que se esté grabando, y el
    // instalador puede esperar.
    if (require('./engine/grabacion').activa()) {
        return { ok: false, error: 'Hay una clase grabando. Terminala antes de actualizar.' };
    }

    anotar('update.instalando', {});
    const error = await shell.openPath(target);
    if (error) return { ok: false, error };

    // El instalador reemplaza este mismo `.app`. Si seguimos abiertos, lo que
    // queda corriendo es una app cuyos archivos en disco ya no son los suyos.
    setTimeout(() => app.quit(), 1500);
    return { ok: true, cerrando: true };
});

// ─── Diálogos del sistema ─────────────────────────────────────────────

/**
 * El diálogo nativo y no uno dibujado en la ventana: este es el que bloquea de
 * verdad y el que se ve igual con la app de fondo.
 */
ipc.handle('confirmar', async (event, { titulo, mensaje, ok } = {}) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: [ok || 'Continuar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: titulo || 'Confirmar',
        message: titulo || 'Confirmar',
        detail: mensaje || ''
    });
    return result.response === 0;
});

/**
 * El mismo diálogo pero con más de una forma de seguir, para cuando «cancelar»
 * y «no» no son lo mismo: cambiar el idioma en medio de una clase se puede
 * hacer releyendo lo de atrás o solo de ahí en adelante, y son tres respuestas.
 *
 * Cada opción trae su `valor` y vuelve ese valor, o `null` si se canceló —con
 * el botón o con Escape—. «Cancelar» lo pone el diálogo, al final y marcado:
 * no es una opción más que quien llama tenga que acordarse de poner última.
 *
 * @param {{titulo:string, mensaje:string, opciones:Array<{valor:string, dice:string}>}}
 */
ipc.handle('preguntar', async (event, { titulo, mensaje, opciones } = {}) => {
    const formas = Array.isArray(opciones) ? opciones : [];
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [...formas.map(o => o.dice), 'Cancelar'],
        defaultId: formas.length,
        cancelId: formas.length,
        title: titulo || 'Elegí',
        message: titulo || 'Elegí',
        detail: mensaje || ''
    });
    const elegida = formas[result.response];
    return elegida ? elegida.valor : null;
});

// El texto es de quien llama: el mismo diálogo sirve para elegir la carpeta del
// curso y para cualquier otra cosa, y no dicen lo mismo.
ipc.handle('pick-folder', async (event, opciones) => {
    const o = opciones || {};
    const result = await dialog.showOpenDialog(mainWindow, {
        title: o.titulo || 'Elegí la carpeta del curso, donde van a caer las notas',
        buttonLabel: o.boton || 'Elegir',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipc.handle('reveal', (event, target) => {
    if (!target) return false;
    shell.showItemInFolder(target);
    return true;
});

ipc.handle('open-path', async (event, target) => {
    if (!target) return 'No llegó ninguna ruta.';
    return shell.openPath(target);
});

ipcGrabar.registrar({ ipcMain: ipc, app, send, anotar });
ipcPrproj.registrar({ ipcMain: ipc, dialog, ventana: () => mainWindow, send, anotar });
ipcReferencias.registrar({ ipcMain: ipc, nativeImage, clipboard, anotar });
ipcSemanal.registrar({ ipcMain: ipc, send, anotar });
ipcReporte.registrar({ ipcMain: ipc, app, shell, screen, systemPreferences, version: appVersion, anotar });
mirilla = ipcMirilla.registrar({
    ipcMain: ipc, BrowserWindow, screen,
    ventanaPrincipal: () => mainWindow, anotar
});
