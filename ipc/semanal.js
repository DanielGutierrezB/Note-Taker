'use strict';
/**
 * ipc/semanal.js — El puente del modo semanal: los dos vídeos y el MP4 final.
 *
 * El reparto es el mismo que con el audio y por el mismo motivo: la cámara y la
 * pantalla solo se pueden abrir desde la ventana (`getUserMedia` y
 * `getDisplayMedia` viven en el navegador) y el disco y ffmpeg solo se pueden
 * tocar desde acá. La ventana graba y manda pedazos; este lado los pega y, al
 * final, corta.
 *
 * **Los trozos van por `send` y no por `invoke`.** Son unos pocos por segundo y
 * de cientos de kilobytes, y esperar una respuesta por cada uno sería hacer
 * cola en el único hilo de la ventana mientras se graba. Es la misma decisión
 * que `grabar-pcm` en `ipc/grabar.js`, con la misma consecuencia: si una
 * escritura falla, se avisa por `semanal-aviso` en vez de contestar.
 *
 * **Nada de esto toca el modo de clase.** Las puertas son nuevas, el motor que
 * graba es el mismo de siempre (`grabar-iniciar` y `grabar-terminar`), y en una
 * clase normal este archivo no se entera: sin vídeos abiertos, el estado no
 * lleva `videos` y nadie exporta nada.
 */

const path = require('path');

const grabacion = require('../engine/grabacion');
const videoCrudo = require('../engine/video-crudo');
const exportar = require('../engine/exportar-video');
const workspace = require('../engine/workspace');

/**
 * @param {object} deps { ipcMain, send, anotar } de `main.js`
 */
function registrar({ ipcMain, send, anotar }) {

    // Lo que está grabando ahora, por `cual`. Vive acá y no en el motor porque
    // es el handle del archivo abierto, que es de este lado del puente.
    const grabando = new Map();

    /**
     * Cuántos tramos se abrieron de cada fuente en ESTA sesión.
     *
     * La pantalla puede ser varios archivos: cambiar de ventana a mitad de
     * grabación cierra uno y abre el siguiente, y cada uno necesita su nombre
     * para no pisar al anterior. La cuenta vive acá —no en `grabando`, que solo
     * sabe de lo que está abierto ahora mismo— y se reinicia al cambiar de
     * sesión, que es lo que hace que cada grabación empiece otra vez por el
     * archivo sin sufijo.
     */
    let tramos = { secuencia: null, cuenta: new Map() };

    /**
     * Abre el archivo de uno de los dos vídeos.
     *
     * `empezoMs` lo manda la ventana con el `Date.now()` de su llamada a
     * `start()`, y es el dato más delicado de todo el modo: es lo que alinea el
     * vídeo con el audio a la hora de cortar. Tomarlo acá mediría además el
     * viaje por el puente (ver la cabecera de `engine/video-crudo.js`).
     */
    ipcMain.handle('semanal-abrir', (event, pedido) => {
        const p = pedido || {};
        const donde = grabacion.dondeVa();
        if (!donde) return { ok: false, error: 'No hay ninguna grabación en curso.' };
        if (tramos.secuencia !== donde.secuencia) {
            tramos = { secuencia: donde.secuencia, cuenta: new Map() };
        }
        const tramo = (tramos.cuenta.get(p.cual) || 0) + 1;
        try {
            const info = videoCrudo.abrir({
                dir: workspace.videoDir(donde.dir),
                nombre: donde.secuencia,
                cual: p.cual,
                tipo: p.tipo,
                empezoMs: p.empezoMs,
                tramo
            });
            tramos.cuenta.set(info.cual, tramo);
            grabando.set(info.cual, info);
            anotar('semanal.graba', {
                cual: info.cual, tipo: info.tipo, tramo,
                archivo: path.basename(info.archivo),
                desdeElCero: info.empezoMs - donde.ceroMs
            });
            return { ok: true, ...info, tramo };
        } catch (err) {
            anotar('semanal.falla', { cual: p.cual, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /** Un pedazo de vídeo al final de su archivo. */
    ipcMain.on('semanal-trozo', (event, cual, trozo) => {
        const abierto = grabando.get(cual);
        if (!abierto) return;
        try {
            videoCrudo.escribir(abierto.id, trozo);
        } catch (err) {
            // Se avisa una vez y se deja de intentar: con el archivo roto, cada
            // pedazo siguiente daría el mismo error varias veces por segundo.
            grabando.delete(cual);
            anotar('semanal.trozo-roto', { cual, error: err.message });
            send('semanal-aviso', { tipo: 'roto', cual, error: err.message });
        }
    });

    /**
     * Cierra los vídeos y los apunta en la sesión.
     *
     * Devuelve lo que quedó en el disco para que la pantalla pueda decir en
     * palabras qué se grabó, que es lo único que la persona puede comprobar.
     *
     * **Con un `cual` cierra solo esa fuente y deja la otra grabando.** Es lo
     * que hace cambiar de ventana a mitad de grabación: se cierra el tramo de
     * pantalla que estaba y se abre el siguiente, mientras la cámara y el audio
     * siguen sin enterarse. El apunte va a la sesión en el momento y no al
     * final, porque si la app se cayera después, ese tramo ya está en el
     * sidecar con su hora y el corte lo puede usar.
     */
    ipcMain.handle('semanal-cerrar', (event, cual) => {
        const cuales = cual ? [String(cual)] : [...grabando.keys()];
        const cerrados = [];
        for (const c of cuales) {
            const abierto = grabando.get(c);
            if (!abierto) continue;
            const r = videoCrudo.cerrar(abierto.id, Date.now());
            if (r) cerrados.push(r);
            grabando.delete(c);
            anotar('semanal.cerrado', { cual: c, bytes: r ? r.bytes : 0 });
        }
        const puestos = grabacion.anotarVideos(cerrados);
        return { ok: true, videos: cerrados, enLaSesion: puestos.length };
    });

    /**
     * Dónde cae cada toma dentro de los dos vídeos crudos.
     *
     * Es lo que deja que el editor del corte final muestre el montaje sin
     * exportarlo: la ventana reproduce los crudos y salta de toma en toma con
     * estos segundos. Se vuelve a pedir después de mover un borde, porque el
     * borde ajustado lo calcula el motor y no la pantalla.
     */
    ipcMain.handle('semanal-montaje', async (event, json) => {
        try {
            const r = exportar.montajeDeSesion(json);
            anotar('semanal.montaje', {
                json: path.basename(String(json || '')), tomas: r.tomas.length
            });
            return r;
        } catch (err) {
            anotar('semanal.falla-montaje', { error: err.message });
            return { ok: false, error: err.message, tomas: [] };
        }
    });

    /**
     * Corta y exporta el MP4 de una sesión ya terminada.
     *
     * Va después de `grabar-terminar`, que es quien deja el sidecar escrito con
     * las tomas y sus bordes: desde acá se lee el disco, no la memoria, para
     * que exportar de nuevo mañana dé exactamente el mismo vídeo.
     */
    ipcMain.handle('semanal-exportar', async (event, json, como) => {
        try {
            const r = await exportar.deSesion(json, {
                alProgreso: p => send('semanal-progreso', p),
                quitarSilencios: Boolean(como && como.quitarSilencios),
                mejorarAudio: Boolean(como && como.mejorarAudio)
            });
            anotar(r.ok ? 'semanal.exportado' : 'semanal.sin-exportar', {
                json: path.basename(String(json || '')),
                ruta: r.ruta ? path.basename(r.ruta) : null,
                tomas: r.tomas, segundos: r.segundos, error: r.error
            });
            return r;
        } catch (err) {
            anotar('semanal.falla-exportar', { error: err.message });
            return { ok: false, error: err.message };
        }
    });
}

module.exports = { registrar };
