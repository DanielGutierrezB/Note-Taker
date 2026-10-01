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

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
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

/** Avisarle algo a la ventana, si todavía está. */
function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** Una línea en el diario de la sesión (`engine/registro.js`). */
function anotar(evento, datos) {
    registro.anotar('main', evento, datos);
}

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

    mainWindow.once('ready-to-show', () => mainWindow.show());
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

app.whenReady().then(() => {
    // Lo primero de todo, antes de anotar nada: el diario en disco. Si se
    // abriera después, las líneas del arranque —que son las que explican una app
    // que no llega ni a mostrar la ventana— quedarían solo en memoria.
    const diario = registro.abrirDiario(app.getPath('userData'));
    anotar('app.arranca', {
        version: appVersion(),
        electron: process.versions.electron,
        arch: process.arch,
        diario: diario.ok ? `guardando (${diario.teniamos} línea(s) de antes)` : `sin guardar: ${diario.error}`
    });
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Y el último segundo del diario, que si no se pierde. Es el segundo más
    // interesante cuando alguien cierra la app porque se le quedó colgada. (La
    // grabación en curso la cierra su propio puente: `ipc/grabar.js`.)
    anotar('app.cierra', {});
    registro.volcar();
});

// ─── Puente con la ventana ────────────────────────────────────────────

ipcMain.handle('app-info', () => ({
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
ipcMain.handle('registro-anotar', (event, { evento, datos } = {}) => {
    registro.anotar('ventana', evento, datos);
    return true;
});

/**
 * Escribe el diario en Descargas, que es la carpeta que el editor sabe
 * encontrar para adjuntar un archivo a un mail o a un chat.
 */
ipcMain.handle('registro-descargar', () => {
    anotar('registro.descarga', registro.estado());
    const res = registro.escribir(app.getPath('downloads'), {
        version: appVersion(),
        electron: process.versions.electron,
        plataforma: process.platform,
        arquitectura: process.arch
    });
    // Se revela y no se abre: abrirlo lanza el editor de texto del sistema
    // encima de la app, y lo que hace falta es tenerlo a mano para arrastrarlo.
    if (res.ok) shell.showItemInFolder(res.archivo);
    return res;
});

ipcMain.handle('doctor', async () => paths.doctor());

// Lo que falta, y el botón que lo instala (`engine/dependencias.js`). El avance
// va por un canal aparte porque una descarga de 1,6 GB tarda minutos.
ipcMain.handle('dependencias-estado', () => dependencias.estado());
ipcMain.handle('dependencias-instalar', async (event, clave) => {
    const r = await dependencias.instalar(clave, p => {
        if (!event.sender.isDestroyed()) event.sender.send('dependencias-progreso', { clave, ...p });
    });
    registro.anotar('main', 'dependencias.instalar', { clave, ok: r.ok, error: r.error || null });
    return r;
});
ipcMain.handle('dependencias-cancelar', (event, clave) => dependencias.cancelar(clave));

// ─── Ajustes ──────────────────────────────────────────────────────────

ipcMain.handle('ajustes-leer', () => ajustes.leer());

/**
 * Guarda un PARCHE sobre lo que hay, no el objeto entero.
 *
 * Cada pantalla manda solo lo suyo: Ajustes el fps y el idioma, Preparar la
 * carpeta y el dispositivo. Si una mandara todo lo que cargó al abrirse,
 * pisaría lo que la otra guardó mientras estaba abierta.
 */
ipcMain.handle('ajustes-guardar', (event, datos) => {
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

ipcMain.handle('carpeta-recordar', (event, ruta) => ajustes.recordarCarpeta(ruta));

/**
 * Cuáles de las carpetas recordadas siguen en el disco.
 *
 * Se pregunta cada vez que la pantalla se abre en vez de guardarse: un disco
 * externo se enchufa y se desenchufa, así que un "no está" escrito hoy sería
 * mentira mañana.
 */
ipcMain.handle('carpetas-en-disco', (event, rutas) => {
    const salida = {};
    for (const ruta of rutas || []) {
        salida[ruta] = fs.existsSync(ruta);
    }
    return salida;
});

// ─── Actualizaciones ──────────────────────────────────────────────────

ipcMain.handle('update-check', async () => {
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
ipcMain.handle('update-download', async (event, payload) => {
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

ipcMain.handle('update-cancel', () => {
    if (descargaEnCurso) descargaEnCurso.abort();
    return { ok: true };
});

ipcMain.handle('update-install', async (event, target) => {
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
ipcMain.handle('confirmar', async (event, { titulo, mensaje, ok } = {}) => {
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

// El texto es de quien llama: el mismo diálogo sirve para elegir la carpeta del
// curso y para cualquier otra cosa, y no dicen lo mismo.
ipcMain.handle('pick-folder', async (event, opciones) => {
    const o = opciones || {};
    const result = await dialog.showOpenDialog(mainWindow, {
        title: o.titulo || 'Elegí la carpeta del curso, donde van a caer las notas',
        buttonLabel: o.boton || 'Elegir',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle('reveal', (event, target) => {
    if (!target) return false;
    shell.showItemInFolder(target);
    return true;
});

ipcMain.handle('open-path', async (event, target) => {
    if (!target) return 'No llegó ninguna ruta.';
    return shell.openPath(target);
});

ipcGrabar.registrar({ ipcMain, app, send, anotar });
ipcPrproj.registrar({ ipcMain, dialog, ventana: () => mainWindow, send, anotar });
ipcReferencias.registrar({ ipcMain, nativeImage, clipboard, anotar });
