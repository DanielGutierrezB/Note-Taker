'use strict';
/**
 * ipc/con-diario.js — Cada pedido de la ventana, anotado en el diario.
 *
 * Lo pidió el editor: que toda acción deje en el registro qué se pidió y en qué
 * quedó, para que un reporte alcance para entender un problema sin tener que
 * reproducirlo. Las acciones de la app son pedidos de la ventana al motor —abrir
 * una toma, dividir, exportar, generar el proyecto— y todos pasan por
 * `ipcMain.handle`. Así que en vez de anotar en cada uno de los sesenta, se los
 * registra a todos a través de esto, que anota el pedido, la respuesta resumida,
 * si falló y cuánto tardó.
 *
 * **Anotar nunca decide lo que contesta.** Si resumir o escribir el diario
 * fallara, la acción ya ocurrió: la ventana recibe su respuesta igual.
 *
 * **Lo que se escribe no se anota**: de un comentario, una nota o un texto queda
 * cuánto mide (`sinLoEscrito`). Los bytes, las claves y las rutas los tapa
 * `registro.sanear` al anotar, como en cualquier otra línea.
 *
 * Lo que llega varias veces por segundo —el audio, los pedazos de vídeo, el
 * espejo de la mirilla— va por `on` y no se anota: son datos, no acciones, y
 * llenarían el diario en minutos.
 */

/** Cuántos campos de una respuesta se guardan: los primeros dicen de qué se trata. */
const CAMPOS = 12;

/** Los campos que son lo que alguien escribió, y no se copian al diario. */
const ESCRITO = /^(comentario|texto|nota|notas|palabra)$/i;

/** Hasta dónde se baja a buscar texto escrito: lo mismo que `registro.sanear` guarda. */
const HONDO = 3;

function sinLoEscrito(v, nivel = 0) {
    if (nivel >= HONDO || v == null || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
    if (Array.isArray(v)) return v.map(x => sinLoEscrito(x, nivel + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
        ESCRITO.test(k) && typeof x === 'string' ? `‹${x.length} caracteres›` : sinLoEscrito(x, nivel + 1)]));
}

/**
 * Lo que contestó, en una línea: si salió bien, el error si lo hubo, y de lo
 * demás los valores sueltos y cuántos hay de cada lista. Una respuesta entera
 * —una sesión con sus tomas y sus palabras— es un archivo, no una línea.
 */
function resumirRespuesta(r) {
    if (r == null || typeof r !== 'object') return r === undefined ? null : r;
    if (Array.isArray(r)) return { cuantos: r.length };
    const salida = {};
    for (const [k, v] of Object.entries(r).slice(0, CAMPOS)) {
        if (v == null || typeof v !== 'object') salida[k] = v;
        else if (Array.isArray(v)) salida[k] = { cuantos: v.length };
        else salida[k] = '{…}';
    }
    return salida;
}

/**
 * El `ipcMain` que se les da a los módulos: el mismo, con `handle` anotado.
 * Solo tiene `handle` y `on`, que es lo que usan; otro método no está a
 * propósito, para que no pase sin anotar.
 *
 * @param {object} ipcMain el de Electron
 * @param {(evento: string, datos: object) => void} anotar
 * @param {Set<string>} [callados] canales que no se anotan: el propio diario, y
 *   las preguntas que la ventana hace solo para pintarse
 */
function conDiario(ipcMain, anotar, callados) {
    const sinAnotar = callados || new Set();
    const anotarSinTirar = (evento, datos) => {
        try {
            anotar(evento, datos());
        } catch (e) {
            // El diario no decide el resultado: la acción ya pasó.
        }
    };
    return {
        handle(canal, fn) {
            ipcMain.handle(canal, async (event, ...args) => {
                if (sinAnotar.has(canal)) return fn(event, ...args);
                const desde = Date.now();
                let r;
                try {
                    r = await fn(event, ...args);
                } catch (err) {
                    anotarSinTirar(`ipc.${canal}.error`, () => ({
                        pide: sinLoEscrito(args), error: err && err.message, ms: Date.now() - desde
                    }));
                    throw err;
                }
                anotarSinTirar(`ipc.${canal}`, () => ({
                    pide: sinLoEscrito(args), contesta: resumirRespuesta(r), ms: Date.now() - desde
                }));
                return r;
            });
        },
        on: (canal, fn) => ipcMain.on(canal, fn)
    };
}

module.exports = { conDiario, sinLoEscrito, resumirRespuesta };
