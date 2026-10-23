'use strict';
/**
 * ipc/reporte.js — El puente del botón «Report».
 *
 * Junta lo que solo sabe el proceso principal —las versiones, macOS, el modelo
 * de la Mac, las pantallas y los permisos— con lo que manda la ventana, y se lo
 * pasa a `engine/reporte.js`, que arma el .zip. Lo deja en Descargas y lo
 * muestra en el Finder: es la carpeta que cualquiera sabe encontrar para
 * adjuntar un archivo a un mail o a un chat.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ajustes = require('../engine/ajustes');
const dependencias = require('../engine/dependencias');
const grabacion = require('../engine/grabacion');
const paths = require('../engine/paths');
const reporte = require('../engine/reporte');

/** La salida de un comando corto del sistema, o null. Nunca tira. */
function preguntarAlSistema(comando, args) {
    return new Promise(resolve => {
        execFile(comando, args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
}

/** Cuánto lugar queda en el disco de la carpeta de usuario, en GB. */
function libreEnGb(dir) {
    try {
        const s = fs.statfsSync(dir);
        return Math.round((s.bavail * s.bsize) / 1e8) / 10;
    } catch (e) {
        return null;
    }
}

/**
 * @param {object} p
 * @param {object} p.ipcMain el de `ipc/con-diario.js`
 * @param {object} p.app
 * @param {object} p.shell
 * @param {object} p.screen
 * @param {object} p.systemPreferences
 * @param {() => string} p.version la de la app, de `version.json`
 * @param {(evento: string, datos: object) => void} p.anotar
 */
function registrar(p) {
    const { ipcMain, app, shell, screen, systemPreferences, version, anotar } = p;

    async function laMac() {
        const [macos, build, modelo] = await Promise.all([
            preguntarAlSistema('/usr/bin/sw_vers', ['-productVersion']),
            preguntarAlSistema('/usr/bin/sw_vers', ['-buildVersion']),
            preguntarAlSistema('/usr/sbin/sysctl', ['-n', 'hw.model'])
        ]);
        const permiso = cual => {
            try { return systemPreferences.getMediaAccessStatus(cual); } catch (e) { return null; }
        };
        return {
            app: {
                version: version(),
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node,
                empaquetada: app.isPackaged
            },
            mac: {
                macos, build, modelo,
                arquitectura: process.arch,
                procesador: (os.cpus()[0] || {}).model || null,
                nucleos: os.cpus().length,
                memoriaGb: Math.round(os.totalmem() / 1e8) / 10,
                libreGb: libreEnGb(os.homedir()),
                encendidaHaceHoras: Math.round(os.uptime() / 360) / 10
            },
            idioma: app.getLocale(),
            zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
            pantallas: screen.getAllDisplays().map(d => ({
                ancho: d.size.width, alto: d.size.height, escala: d.scaleFactor, principal: d.id === screen.getPrimaryDisplay().id
            })),
            permisos: { microfono: permiso('microphone'), camara: permiso('camera'), pantalla: permiso('screen') }
        };
    }

    ipcMain.handle('reporte-armar', async (event, ventana) => {
        const lasAjustes = ajustes.leer();
        const [sistema, doctor, faltan] = await Promise.all([
            laMac(),
            Promise.resolve().then(() => paths.doctor()),
            Promise.resolve().then(() => dependencias.estado())
        ]);
        const r = await reporte.armar({
            dir: app.getPath('downloads'),
            cabecera: {
                version: version(),
                electron: process.versions.electron,
                plataforma: process.platform,
                arquitectura: process.arch
            },
            sistema,
            ajustes: lasAjustes,
            herramientas: { doctor, dependencias: faltan },
            ventana,
            grabando: grabacion.activa() ? grabacion.resumen() : null,
            carpetas: [lasAjustes.carpeta, lasAjustes.semanal && lasAjustes.semanal.carpeta],
            ffprobe: (paths.ffprobe() || {}).path || null,
            cuelgues: path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports'),
            nombresDeLaApp: ['Note Taker', 'Electron']
        });
        anotar('reporte.armado', { ok: r.ok, archivo: r.archivo, partes: r.partes, faltan: r.faltan, error: r.error });
        // Se muestra y no se abre: lo que hace falta es tenerlo a mano para
        // arrastrarlo a un mail, no descomprimirlo.
        if (r.ok) shell.showItemInFolder(r.archivo);
        return r;
    });
}

module.exports = { registrar };
