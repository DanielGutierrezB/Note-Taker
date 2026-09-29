'use strict';
/**
 * ipc/grabar.js — El puente de la toma de notas en vivo.
 *
 * La grabación vive del lado de Node y no de la ventana, aunque la ventana sea
 * la que dibuja: hay una sola verdad, y es la que escribe el XML. La ventana
 * manda el audio y los cambios que hace el editor, y recibe el estado entero de
 * vuelta (`engine/grabacion.js`).
 *
 * Está en su archivo y no en `main.js` porque de él necesita dos cosas —mandar
 * avisos a la ventana y anotar en el diario— y porque así `main.js` se queda
 * con lo que es de la app entera: la ventana, los diálogos y los ajustes.
 */

const grabacion = require('../engine/grabacion');
const vivo = require('../engine/notas-vivo');
const audioApp = require('../engine/audio-app');

/**
 * @param {object} deps { ipcMain, app, send, anotar } de `main.js`
 */
function registrar({ ipcMain, app, send, anotar }) {
    ipcMain.handle('grabar-iniciar', (event, payload) => {
        const p = payload || {};
        try {
            const estado = grabacion.iniciar({
                ...p,
                avisar: aviso => send('grabar-aviso', aviso)
            });
            anotar('grabar.inicia', {
                secuencia: estado.secuencia,
                dir: estado.dir,
                fps: estado.fps,
                dispositivo: p.dispositivo
            });
            return { ok: true, estado };
        } catch (err) {
            anotar('grabar.no-arranca', { error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * Reanudar una sesión que quedó abierta: mismo XML, mismo cero, otro WAV.
     */
    ipcMain.handle('grabar-reanudar', (event, json, payload) => {
        try {
            const estado = grabacion.reanudar(json, {
                ...(payload || {}),
                avisar: aviso => send('grabar-aviso', aviso)
            });
            anotar('grabar.reanuda', { json, secuencia: estado.secuencia });
            return { ok: true, estado };
        } catch (err) {
            anotar('grabar.no-reanuda', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * El PCM que manda la ventana. Va por `on` y no por `handle`: llega varias
     * veces por segundo y no hay nada que esperar de vuelta, y devolver el
     * estado entero cada vez llenaría el puente de tomas repetidas.
     */
    ipcMain.on('grabar-pcm', (event, chunk) => {
        try {
            grabacion.pcm(chunk);
        } catch (err) {
            anotar('grabar.pcm-falla', { error: err.message });
        }
    });

    /**
     * La otra fuente: el sonido de Zoom, que no pasa por la ventana.
     *
     * Lo abre Node (`engine/audio-app.js`) y los pedazos van directo a
     * `grabacion.pcm`, por el mismo camino que los del micrófono. La ventana
     * pide y recibe el nivel por `audio-app`, y nada más: mandar el audio
     * hasta allá para que lo devuelva sería hacerlo cruzar el puente dos veces
     * para llegar al mismo sitio.
     */
    ipcMain.handle('audio-app-estado', () => audioApp.estado());

    ipcMain.handle('audio-app-abrir', async () => {
        const r = await audioApp.abrir({
            alPcm: chunk => grabacion.pcm(chunk),
            avisar: aviso => {
                // Lo que le pasa a la escucha en medio de la clase va al
                // registro siempre: es lo que explica un WAV con silencios
                // puestos, una tasa que cambió o una escucha que se rearmó.
                if (aviso && ['ayudante', 'relleno', 'rearmada', 'caido', 'vuelve'].includes(aviso.tipo)) {
                    anotar(`audio-app.${aviso.tipo}`, aviso);
                }
                send('audio-app', aviso);
            }
        });
        anotar('audio-app.abrir', { ok: r.ok, codigo: r.codigo || null, sampleRate: r.sampleRate || null,
            tasaDelDispositivo: r.tasaDelDispositivo || null });
        return r;
    });

    ipcMain.handle('audio-app-mandar', (event, si) => {
        if (si) audioApp.empezarAMandar(); else audioApp.dejarDeMandar();
        return true;
    });

    ipcMain.handle('audio-app-cerrar', () => { audioApp.cerrar(); return true; });

    /**
     * "Claqueta ahora": la puso el editor, así que queda confirmada.
     *
     * No lleva la hora: la pone el motor con el reloj del audio
     * (`espejo.grabadoHastaMs`). Mandarla desde la ventana sería mandar
     * `Date.now()`, que va uno o dos pedazos por delante de lo que se grabó, y
     * en una clase larga eso son marcas que no coinciden con la onda.
     */
    ipcMain.handle('grabar-claqueta', () => {
        anotar('grabar.claqueta', { aMano: true });
        return grabacion.claqueta();
    });

    ipcMain.handle('grabar-quitar-claqueta', (event, n) => {
        anotar('grabar.quitar-claqueta', { n });
        return grabacion.quitarClaqueta(n);
    });

    ipcMain.handle('grabar-editar', (event, cambio) => {
        anotar('grabar.editar', { toma: cambio && cambio.toma, tipo: cambio && cambio.tipo });
        return grabacion.editar(cambio);
    });

    /**
     * Abrir y cerrar una toma a mano, para cuando el conteo no se dijo.
     *
     * No llevan la hora, igual que la claqueta: la pone el motor con el reloj
     * del audio. Y `grabar-abrir-toma` devuelve además cuánto retrocedió el
     * IN, que es lo único que la ventana no puede saber sola y lo que le deja
     * decir «abierta 4 s atrás, desde donde arrancó la frase».
     */
    ipcMain.handle('grabar-abrir-toma', (event, ms) => {
        const estado = grabacion.abrirToma(ms);
        anotar('grabar.abrir-toma', {
            toma: estado && estado.abierta,
            retrocedioSec: estado && estado.retrocedioSec
        });
        return estado;
    });

    ipcMain.handle('grabar-cerrar-toma', (event, ms) => grabacion.cerrarToma(ms));

    /**
     * Deshacer y rehacer lo que el editor hizo a mano.
     *
     * Contestan `{ok, que, error, estado}` y no el estado pelado como los demás
     * canales de acá, porque hay dos cosas que la ventana no puede saber sola:
     * qué paso se acaba de revertir —lo dice en el aviso, que si no un cambio
     * revertido lejos del scroll es invisible— y por qué un paso no se pudo
     * revertir (una toma nueva abierta encima, ver `engine/deshacer.js`).
     */
    ipcMain.handle('grabar-deshacer', () => {
        const r = grabacion.deshacer();
        anotar('grabar.deshace', { que: r.que || '', pudo: r.ok });
        return r;
    });

    ipcMain.handle('grabar-rehacer', () => {
        const r = grabacion.rehacer();
        anotar('grabar.rehace', { que: r.que || '', pudo: r.ok });
        return r;
    });

    ipcMain.handle('grabar-estado', () => grabacion.resumen());
    // Las vistas viajan con el estado de la grabación en curso, pero una sesión
    // ya terminada también deja cambiarlas y ahí no hay estado del que sacarlas.
    ipcMain.handle('grabar-vistas', () => vivo.VISTAS);
    ipcMain.handle('grabar-listar', (event, dirs) => grabacion.listar(dirs));

    // Tarda lo que tarde releer las últimas tomas con el modelo grande: la
    // ventana espera la respuesta y lo dice mientras tanto.
    ipcMain.handle('grabar-terminar', async () => {
        const salida = await grabacion.terminar();
        anotar('grabar.termina', {
            secuencia: salida && salida.secuencia,
            tomas: salida ? salida.tomas.length : 0,
            claquetas: salida ? salida.claquetas.length : 0
        });
        return salida;
    });

    // Cambiar una sesión que ya terminó. Reescribe su XML en el acto, así que
    // la respuesta dice si se pudo: la ventana avisa con eso.
    ipcMain.handle('grabar-editar-grabada', (event, json, cambio) => {
        anotar('grabar.editar-grabada', {
            json, toma: cambio && cambio.toma, tipo: cambio && cambio.tipo
        });
        try {
            return { ok: true, ...grabacion.editarGrabada(json, cambio) };
        } catch (err) {
            anotar('grabar.editar-grabada-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * Renombrar y borrar una sesión de la lista.
     *
     * Contestan `{ok, error}` y no el estado pelado: los dos se pueden negar por
     * un motivo que solo el motor conoce —un nombre que chocaría con otra
     * sesión, una que se está grabando ahora mismo— y ese motivo hay que poder
     * mostrarlo tal cual.
     *
     * La confirmación de borrar es de la pantalla y no de acá. Cuando el gesto
     * llega a este renglón ya está decidido, y el motor borra.
     */
    ipcMain.handle('grabar-renombrar', (event, json, cambio) => {
        anotar('grabar.renombrar', { json, curso: cambio && cambio.curso });
        try {
            const r = grabacion.renombrarGrabada(json, cambio);
            anotar('grabar.renombrada', { json, secuencia: r.secuencia, audios: r.audios });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.renombrar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('grabar-borrar', (event, json) => {
        anotar('grabar.borrar', { json });
        try {
            const r = grabacion.borrarGrabada(json);
            anotar('grabar.borrada', { json, secuencia: r.secuencia, audios: r.audios });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.borrar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('grabar-regenerar', async (event, json) => {
        anotar('grabar.regenerar', { json });
        try {
            const r = await grabacion.regenerar(
                json, aviso => send('grabar-aviso', aviso), grabacion.enCurso());
            anotar('grabar.regenerada', { json, tomas: r.tomas, sinAudio: r.sinAudio });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.regenerar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    // Si había una grabación en curso al cerrar la app, se cierra lo abierto: la
    // cabecera del WAV queda con el tamaño real y el XML con lo último que pasó.
    // La sesión NO queda marcada como terminada, así que se puede reanudar:
    // cerrar la app en medio de un rodaje no puede costar la clase.
    app.on('before-quit', () => {
        // El ayudante primero: si siguiera mandando mientras se cierra la
        // sesión, el último pedazo podría llegar a una sesión que ya no está.
        try { audioApp.cerrar(); } catch (e) { /* ya estaba cerrado */ }
        try { grabacion.apagar(); } catch (e) { /* ya estaba cerrado */ }
    });
}

module.exports = { registrar };
