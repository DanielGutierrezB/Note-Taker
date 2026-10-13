'use strict';
/**
 * preload-mirilla.js — La puerta de la mirilla, que es más chica que la otra.
 *
 * La mirilla es un espejo con tres botones (`src/js/mirilla.js`): pide qué
 * mostrar, escucha el espejo y manda los gestos. Eso es todo lo que puede
 * hacer, y por eso es todo lo que tiene. Con el puente de la app entero, una
 * ventanita de 300 puntos encima de todo podría abrir carpetas, guardar los
 * ajustes o terminar la grabación.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nt', {
    mirillaQueMuestro: () => ipcRenderer.invoke('mirilla-que-muestro'),
    mirillaGesto: gesto => ipcRenderer.invoke('mirilla-gesto', gesto),
    onMirillaEspejo: callback => {
        ipcRenderer.on('mirilla-espejo', (_event, payload) => callback(payload));
    }
});
