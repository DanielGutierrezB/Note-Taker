'use strict';
/**
 * ipc/prproj.js — El puente de «Generar .prproj».
 *
 * Tres puertas: leer la configuración del menú para una carpeta, guardarla, y
 * generar. Generar es la única que pregunta algo —si ya hay un proyecto— y por
 * eso vive en el proceso principal: los diálogos son de acá.
 */

const fs = require('fs');
const path = require('path');

const ajustes = require('../engine/ajustes');
const paths = require('../engine/paths');
const grabacion = require('../engine/grabacion');
const carpetaPrproj = require('../engine/prproj-carpeta');

/**
 * Dónde va el proyecto de una carpeta: `<carpeta>/Proyecto/<carpeta>.prproj`.
 *
 * En una carpeta `Proyecto/` propia y no suelto, como en Class Cut: Premiere
 * deja autoguardados y previsualizaciones al lado del proyecto, y sin una
 * carpeta que los contenga se mezclan con el material.
 */
function destinoDe(carpeta) {
    return path.join(carpeta, 'Proyecto', `${path.basename(carpeta)}.prproj`);
}

/**
 * El primer nombre libre al lado de uno ocupado: `curso 2.prproj`, `curso 3`…
 *
 * Se cuenta en vez de pegarle la fecha porque así se lee como lo que es —el
 * segundo, el tercero— y es lo que hace el Finder, que es donde se los va a ver.
 */
function alLado(destino) {
    const dir = path.dirname(destino);
    const ext = path.extname(destino);
    const base = path.basename(destino, ext);
    for (let n = 2; n < 1000; n++) {
        const otro = path.join(dir, `${base} ${n}${ext}`);
        if (!fs.existsSync(otro)) return otro;
    }
    throw new Error(`Hay demasiados proyectos en ${dir}. Llevate alguno antes de generar otro.`);
}

/** Guarda la configuración en la carpeta y la deja como la última usada. */
function recordar(carpeta, config) {
    const limpia = carpetaPrproj.guardarConfig(carpeta, config);
    ajustes.guardar({ ...ajustes.leer(), prproj: limpia });
    return limpia;
}

/**
 * @param {object} deps { ipcMain, dialog, ventana, send, anotar } de `main.js`;
 *   `ventana` es una función, porque la ventana todavía no existe al registrar
 */
function registrar({ ipcMain, dialog, ventana, send, anotar }) {
    ipcMain.handle('prproj-config', (event, carpeta) => {
        try {
            const leida = carpetaPrproj.leerConfig(carpeta, ajustes.leer().prproj, grabacion.enCurso());
            return { ok: true, ...leida, destino: destinoDe(carpeta), plantilla: Boolean(paths.plantillaPrproj()) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('prproj-guardar-config', (event, carpeta, config) => {
        try {
            return { ok: true, config: recordar(carpeta, config) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('prproj-generar', async (event, carpeta, config) => {
        anotar('prproj.generar', { carpeta, config });
        const plantilla = paths.plantillaPrproj();
        if (!plantilla) {
            return { ok: false, error: 'Falta la plantilla de Premiere que viene con la app. Reinstalala.' };
        }

        let limpia;
        try {
            limpia = recordar(carpeta, config);
        } catch (err) {
            return { ok: false, error: `No pude guardar la configuración: ${err.message}` };
        }

        let destino = destinoDe(carpeta);
        if (fs.existsSync(destino)) {
            // Ese archivo no es un resultado sino un lugar de trabajo: para cuando
            // alguien vuelva a generar, ahí adentro puede estar la sincronización
            // de las capturas. Reemplazarlo en silencio sería tirar ese trabajo.
            const r = await dialog.showMessageBox(ventana(), {
                type: 'warning',
                buttons: ['Guardar uno nuevo al lado', 'Reemplazarlo', 'Cancelar'],
                defaultId: 0,
                cancelId: 2,
                title: 'Ya hay un proyecto de esta carpeta',
                message: 'Ya hay un proyecto de esta carpeta',
                detail: `${destino}\n\nSi lo abriste en Premiere y sincronizaste las capturas adentro, `
                    + 'reemplazarlo se lleva puesto ese trabajo.'
            });
            if (r.response === 2) return { ok: false, cancelado: true };
            if (r.response === 0) {
                try { destino = alLado(destino); } catch (err) { return { ok: false, error: err.message }; }
            }
        }

        const r = await carpetaPrproj.generar({
            carpeta,
            destino,
            plantilla,
            config: limpia,
            enCurso: grabacion.enCurso(),
            avisar: paso => send('prproj-aviso', { carpeta, ...paso })
        });
        anotar(r.ok ? 'prproj.generado' : 'prproj.falla', {
            carpeta, ruta: r.ruta, error: r.error, avisos: (r.avisos || []).length
        });
        return r;
    });
}

module.exports = { registrar, destinoDe, alLado };
