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
 * Lo que llega varias veces por segundo —el audio, los pedazos de vídeo, el
 * espejo de la mirilla— va por `on` y no se anota: son datos, no acciones, y
 * llenarían el diario en minutos.
 */

/** Cuántos campos de una respuesta se guardan: los primeros dicen de qué se trata. */
const CAMPOS = 12;

/** Lo que va en el diario en lugar de unos bytes: cuántos son. */
function bytes(valor) {
    return `‹${valor.byteLength} bytes›`;
}

const sonBytes = v => v instanceof ArrayBuffer || ArrayBuffer.isView(v);

/**
 * Lo que se pidió, sin los bytes. Del resto —rutas, textos largos, claves— se
 * ocupa `registro.sanear` al anotar.
 */
function resumirPedido(args) {
    return args.map(function resumir(v) {
        if (sonBytes(v)) return bytes(v);
        if (Array.isArray(v)) return v.map(resumir);
        if (v && typeof v === 'object') {
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resumir(x)]));
        }
        return v;
    });
}

/**
 * Lo que contestó, en una línea: si salió bien, el error si lo hubo, y de lo
 * demás los valores sueltos y cuántos hay de cada lista. Una respuesta entera
 * —una sesión con sus tomas y sus palabras— es un archivo, no una línea.
 */
function resumirRespuesta(r) {
    if (r == null || typeof r !== 'object') return r === undefined ? null : r;
    if (sonBytes(r)) return bytes(r);
    if (Array.isArray(r)) return { cuantos: r.length };
    const salida = {};
    for (const [k, v] of Object.entries(r).slice(0, CAMPOS)) {
        if (v == null || typeof v !== 'object') salida[k] = v;
        else if (Array.isArray(v)) salida[k] = { cuantos: v.length };
        else if (sonBytes(v)) salida[k] = bytes(v);
        else salida[k] = '{…}';
    }
    return salida;
}

/**
 * El `ipcMain` que se les da a los módulos: el mismo, con `handle` anotado.
 *
 * @param {object} ipcMain el de Electron
 * @param {(evento: string, datos: object) => void} anotar
 * @param {Set<string>} [callados] canales que no se anotan: el propio diario, y
 *   las preguntas que la ventana hace solo para pintarse
 */
function conDiario(ipcMain, anotar, callados) {
    const sinAnotar = callados || new Set();
    return {
        handle(canal, fn) {
            ipcMain.handle(canal, async (event, ...args) => {
                if (sinAnotar.has(canal)) return fn(event, ...args);
                const desde = Date.now();
                try {
                    const r = await fn(event, ...args);
                    anotar(`ipc.${canal}`, {
                        pide: resumirPedido(args), contesta: resumirRespuesta(r), ms: Date.now() - desde
                    });
                    return r;
                } catch (err) {
                    anotar(`ipc.${canal}.error`, {
                        pide: resumirPedido(args), error: err && err.message, ms: Date.now() - desde
                    });
                    throw err;
                }
            });
        },
        on: (canal, fn) => ipcMain.on(canal, fn)
    };
}

module.exports = { conDiario, resumirPedido, resumirRespuesta };
