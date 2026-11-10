'use strict';
/**
 * arranque-seguro.js — Lo que la app instalada no acepta de quien la abre.
 *
 * Va antes que todo lo demás en `main.js`, y por eso es un archivo aparte: el
 * motor lee algunas variables al cargarse (`updates.DEFAULTS`), así que hay que
 * sacarlas antes de que nadie lo pida.
 *
 * **Las variables de desarrollo.** `NOTETAKER_*` y `NT_*` apuntan la app a un
 * servidor local de actualizaciones, a otros ajustes, a otra plantilla. Sirven
 * para probar; en la app instalada, cualquier programa que la abriera con
 * `launchctl setenv NOTETAKER_UPDATE_BASE …` le hacía bajar y abrir un
 * instalador de cualquier lado. Ahí se borran y vale lo de fábrica.
 *
 * **Los depuradores.** `--remote-debugging-port` le da la ventana entera, con
 * `window.nt`, a quien se conecte, y `--inspect` el proceso principal. Los
 * fusibles de Electron (`electronFuses` en `package.json`) apagan los de Node;
 * el de Chromium no tiene fusible, así que la app no arranca con él.
 */

const { app } = require('electron');

const DE_DESARROLLO = /^(NOTETAKER_|NT_)/;
const DEPURADORES = ['--remote-debugging-port', '--remote-debugging-pipe', '--inspect', '--inspect-brk'];

if (app && app.isPackaged) {
    for (const nombre of Object.keys(process.env)) {
        if (DE_DESARROLLO.test(nombre)) delete process.env[nombre];
    }
    if (process.argv.some(a => DEPURADORES.some(d => a === d || a.startsWith(`${d}=`)))) app.exit(1);
}

module.exports = { DE_DESARROLLO, DEPURADORES };
