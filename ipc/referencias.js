'use strict';
/**
 * ipc/referencias.js — El puente de las fotos del OUT.
 *
 * La ventana es la que tiene el vídeo (`src/js/grabar/ojo.js`) y este lado es el
 * que tiene el disco, el portapapeles y el escalador de imágenes de Electron.
 * Cuatro puertas: guardar la foto de una toma, listar las que ya tiene una
 * clase, abrir una en grande y copiarla para mandarla.
 *
 * **Las imágenes cruzan como `data:` y no como rutas.** La ventana corre con
 * `img-src 'self' data:` (ver `src/index.html`), así que un `file://` no lo
 * dibujaría: no es una vuelta de más, es la única forma que tiene de mostrarlas.
 *
 * Y cruzan en dos tamaños a propósito. La miniatura de cada bloque va a 320 px
 * —con eso se ve nítida en pantalla Retina y pesa unos kilobytes— y la grande
 * solo cuando alguien la abre. Mandar las grandes de veinte tomas en cada
 * repintado serían varios megas de `data:` metidos en el DOM.
 */

const fs = require('fs');

const referencias = require('../engine/referencias');

/** El ancho de la miniatura del bloque de la toma. */
const ANCHO_MINI = 320;

/** La imagen de un archivo, escalada o no, lista para un `<img src>`. */
function comoDataUrl(nativeImage, ruta, ancho) {
    const img = nativeImage.createFromPath(ruta);
    if (img.isEmpty()) return null;
    const puesta = ancho && img.getSize().width > ancho ? img.resize({ width: ancho }) : img;
    return puesta.toDataURL();
}

/**
 * @param {object} deps { ipcMain, nativeImage, clipboard, anotar } de `main.js`
 */
function registrar({ ipcMain, nativeImage, clipboard, anotar }) {

    /**
     * Guarda la foto que la ventana sacó al cerrarse una toma.
     *
     * Contesta también la miniatura, para que el bloque la pueda dibujar sin
     * tener que volver a pedir nada.
     */
    ipcMain.handle('foto-guardar', (event, pedido) => {
        const p = pedido || {};
        try {
            const r = referencias.guardar({
                carpeta: p.carpeta,
                secuencia: p.secuencia,
                toma: p.toma,
                bytes: Buffer.from(p.jpeg || [])
            });
            if (r.nueva) anotar('foto.guardada', { secuencia: p.secuencia, toma: r.toma, ruta: r.ruta });
            return { ok: true, ...r, mini: comoDataUrl(nativeImage, r.ruta, ANCHO_MINI) };
        } catch (err) {
            // Que no haya foto no puede estropear una clase: se anota y la
            // ventana sigue como si no hubiera cámara.
            anotar('foto.falla', { secuencia: p.secuencia, toma: p.toma, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /** Las fotos que una clase ya tiene, para cuando se la abre de nuevo. */
    ipcMain.handle('fotos-listar', (event, carpeta, secuencia) => {
        try {
            const fotos = referencias.listar(carpeta, secuencia).map(f => ({
                ...f, mini: comoDataUrl(nativeImage, f.ruta, ANCHO_MINI)
            }));
            return { ok: true, fotos: fotos.filter(f => f.mini) };
        } catch (err) {
            return { ok: false, error: err.message, fotos: [] };
        }
    });

    /**
     * Una foto en grande, para verla.
     *
     * Se comprueba que la ruta sea de las nuestras antes de leer el disco: llega
     * de la ventana, y de este lado hay un `readFile` sin límites.
     */
    ipcMain.handle('foto-abrir', (event, ruta) => {
        if (!referencias.esDeAca(ruta) || !fs.existsSync(ruta)) {
            return { ok: false, error: 'Esa foto ya no está.' };
        }
        const img = nativeImage.createFromPath(ruta);
        if (img.isEmpty()) return { ok: false, error: 'Esa foto no se puede leer.' };
        const tamano = img.getSize();
        return { ok: true, ruta, imagen: img.toDataURL(), ancho: tamano.width, alto: tamano.height };
    });

    /**
     * La foto al portapapeles, que es cómo se le manda al profesor.
     *
     * Va la imagen y no el archivo: así se pega en el WhatsApp o en el Slack de
     * la clase directamente, que es el gesto que esto tiene que ahorrar.
     */
    ipcMain.handle('foto-copiar', (event, ruta) => {
        if (!referencias.esDeAca(ruta) || !fs.existsSync(ruta)) {
            return { ok: false, error: 'Esa foto ya no está.' };
        }
        const img = nativeImage.createFromPath(ruta);
        if (img.isEmpty()) return { ok: false, error: 'Esa foto no se puede leer.' };
        clipboard.writeImage(img);
        anotar('foto.copiada', { ruta });
        return { ok: true };
    });
}

module.exports = { registrar, ANCHO_MINI };
