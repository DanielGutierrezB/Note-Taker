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

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage, clipboard,
    screen, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

const paths = require('./engine/paths');
const ajustes = require('./engine/ajustes');
const updates = require('./engine/updates');
const registro = require('./engine/registro');
const dependencias = require('./engine/dependencias');
const grabacion = require('./engine/grabacion');
const residente = require('./engine/oido-residente');
const ipcGrabar = require('./ipc/grabar');
const ipcPrproj = require('./ipc/prproj');
const ipcReferencias = require('./ipc/referencias');
const ipcReporte = require('./ipc/reporte');
const { conDiario } = require('./ipc/con-diario');
const devShot = require('./dev-shot');

let mainWindow = null;
let descargaEnCurso = null;

function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version;
    } catch (e) {
        return app.getVersion();
    }
}

/** Avisarle algo a la ventana de la app. */
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
    'registro-anotar', 'app-info', 'ajustes-leer', 'grabar-estado', 'audio-app-estado'
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

    cerrarYa = false;
    mainWindow.once('ready-to-show', () => mainWindow.show());
    // Con una clase grabando, cerrar la ventana la dejaba grabando sin pantalla
    // desde donde terminarla. Se pregunta.
    mainWindow.on('close', e => {
        if (cerrarYa || !grabacion.activa()) return;
        e.preventDefault();
        terminarAntesDe(() => { if (mainWindow) mainWindow.close(); });
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadFile('src/index.html');
    // El arnés de desarrollo (capturas, JS inyectado) vive en `dev-shot.js` y
    // sin sus flags no hace nada.
    mainWindow.webContents.once('did-finish-load', () => devShot.correr(mainWindow));
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

/** Ya se preguntó y se terminó la clase: cerrar no vuelve a preguntar. */
let cerrarYa = false;
let preguntando = false;

/**
 * Pregunta antes de cerrar la ventana o salir con una clase grabando, y si la
 * respuesta es terminar, la termina como el botón —cierra el audio y relee lo
 * que falta— antes de `seguir`.
 */
async function terminarAntesDe(seguir) {
    if (preguntando) return;
    preguntando = true;
    try {
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Seguir grabando', 'Terminar la clase y cerrar'],
            defaultId: 0,
            cancelId: 0,
            message: 'Hay una clase grabando',
            detail: 'Cerrar termina la clase: se cierra el audio y se releen las últimas tomas, '
                + 'como con el botón Terminar. Para seguir tomando notas, elegí «Seguir grabando».'
        });
        if (response !== 1) return;
        anotar('app.termina-para-cerrar', {});
        await grabacion.terminar();
        cerrarYa = true;
        seguir();
    } catch (err) {
        anotar('app.no-termino-para-cerrar', { error: err.message });
        dialog.showErrorBox('No se pudo terminar la clase', `${err.message}\n\nLa clase sigue grabando.`);
    } finally {
        preguntando = false;
    }
}

/**
 * El menú de la app, sin «Recargar».
 *
 * El de fábrica de Electron trae Recargar (⌘R) y Forzar recarga: recargar la
 * ventana con una clase grabando corta el micrófono, que lo abre la ventana. Y
 * las herramientas de desarrollo, que en la app instalada no tienen nada que
 * hacer. El resto es el mismo: el menú de la app, Edición —que es lo que hace
 * andar copiar y pegar en los campos— y Ventana.
 */
function ponerElMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
            label: 'Ver',
            submenu: [
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }])
            ]
        },
        { role: 'windowMenu' }
    ]));
}

/**
 * La ventana de la clase, al frente: la que hay aunque esté escondida, o una
 * nueva si se cerró.
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
        // El whisper-server que dejó una app que se cayó, con el modelo cargado.
        const huerfano = residente.limpiarHuerfano();
        if (huerfano) anotar('residente.huerfano-apagado', { pid: huerfano });
        ponerElMenu();
        createWindow();
        app.on('activate', traerLaVentana);
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', e => {
    // ⌘Q con una clase grabando: se pregunta, igual que al cerrar la ventana.
    // Si se termina, `app.quit()` vuelve a entrar acá con la clase ya cerrada.
    if (!cerrarYa && grabacion.activa()) {
        e.preventDefault();
        terminarAntesDe(() => app.quit());
        return;
    }
    // El último segundo del diario, que si no se pierde. Es el segundo más
    // interesante cuando alguien cierra la app porque se le quedó colgada. (Lo
    // que quede de la grabación lo cierra su propio puente: `ipc/grabar.js`.)
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

// Con el aviso de unos ajustes que no se pudieron leer, si lo hay: no se
// guarda —`sanear` lo deja afuera— y la ventana lo muestra al arrancar.
let ajustesIlegiblesAnotados = false;
ipc.handle('ajustes-leer', () => {
    const leidos = ajustes.leer();
    const aviso = ajustes.aviso();
    if (aviso && !ajustesIlegiblesAnotados) {
        ajustesIlegiblesAnotados = true;
        anotar('ajustes.ilegibles', { aviso });
    }
    return aviso ? { ...leidos, aviso } : leidos;
});

/**
 * Guarda un PARCHE sobre lo que hay, no el objeto entero.
 *
 * Cada pantalla manda solo lo suyo: Ajustes el fps y el idioma, Preparar la
 * carpeta y el dispositivo. Si una mandara todo lo que cargó al abrirse,
 * pisaría lo que la otra guardó mientras estaba abierta.
 */
ipc.handle('ajustes-guardar', (event, datos) => {
    const parche = datos || {};
    try {
        const guardados = ajustes.guardar({ ...ajustes.leer(), ...parche });
        anotar('ajustes.guardados', { que: Object.keys(parche), fps: guardados.fps });
        return { ok: true, ajustes: guardados };
    } catch (err) {
        anotar('ajustes.no-guardados', { error: err.message });
        return { ok: false, error: err.message };
    }
});

ipc.handle('carpeta-recordar', (event, ruta) => ajustes.recordarCarpeta(ruta));

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

ipc.handle('update-install', async (event, target) => {
    if (!target || !fs.existsSync(target)) {
        return { ok: false, error: 'El instalador ya no está donde se bajó.' };
    }
    // En medio de una clase no: cerrar acá pierde lo que se esté grabando, y el
    // instalador puede esperar.
    if (grabacion.activa()) {
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

ipcGrabar.registrar({ ipcMain: ipc, app, send, anotar });
ipcPrproj.registrar({ ipcMain: ipc, dialog, ventana: () => mainWindow, send, anotar });
ipcReferencias.registrar({ ipcMain: ipc, nativeImage, clipboard, anotar });
ipcReporte.registrar({ ipcMain: ipc, app, shell, screen, systemPreferences, version: appVersion, anotar });
