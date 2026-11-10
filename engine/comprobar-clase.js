'use strict';
/**
 * comprobar-clase.js — Al terminar, que la clase haya quedado entera.
 *
 * «Terminar» escribía por última vez y decía «listo» sin mirar nada. Lo que
 * se descubre en la mesa de edición —un WAV más corto que la clase, una toma
 * sin texto, un archivo que no está— se puede descubrir acá, con la clase
 * todavía fresca y la persona todavía delante.
 *
 * No arregla nada: dice qué encontró, y la pantalla de cierre lo muestra.
 */

const fs = require('fs');
const path = require('path');

/** Lo que un WAV puede quedarse corto contra el reloj sin que sea una pérdida. */
const TOLERANCIA_SEC = 2;

/**
 * @param {object} estado el de la sesión, con `sesiones` ya cerradas
 * @param {{xml:string, json:string}} archivos los que se acaban de escribir
 * @returns {{ok:boolean, problemas:string[], segundos:number}} `segundos` es el
 *   audio que hay de verdad, sumando todos los WAV
 */
function comprobar(estado, archivos) {
    const problemas = [];

    for (const archivo of [archivos.xml, archivos.json]) {
        if (!fs.existsSync(archivo)) problemas.push(`No está ${path.basename(archivo)}.`);
    }
    if (fs.existsSync(archivos.xml) && !/<\/xmeml>\s*$/.test(fs.readFileSync(archivos.xml, 'utf8'))) {
        problemas.push('El XML quedó cortado: no termina donde tiene que terminar.');
    }

    let segundos = 0;
    for (const wav of estado.sesiones || []) {
        const nombre = path.basename(wav.archivo || '');
        let bytes;
        try {
            bytes = fs.statSync(wav.archivo).size;
        } catch (e) {
            problemas.push(`No está el audio ${nombre}.`);
            continue;
        }
        const medidos = Math.max(0, bytes - 44) / ((wav.sampleRate || 48000) * (wav.canales || 1) * 2);
        segundos += medidos;
        if (Math.abs(medidos - (wav.segundos || 0)) > 1) {
            problemas.push(`El audio ${nombre} mide ${redondo(medidos)} s y las notas dicen ${redondo(wav.segundos || 0)} s.`);
        }
        // Contra el reloj: lo que duró ese tramo de la clase y lo que tiene el
        // archivo. Más corto es audio que no llegó a escribirse.
        if (wav.desdeMs != null && wav.hastaMs != null) {
            const falta = (wav.hastaMs - wav.desdeMs) / 1000 - medidos;
            if (falta > TOLERANCIA_SEC) {
                problemas.push(`Al audio ${nombre} le faltan ${redondo(falta)} s contra el reloj: `
                    + 'hubo un rato en que no se escribió.');
            }
        }
    }

    for (const toma of (estado.tomas || []).filter(t => !t.descartada)) {
        if (toma.inMs == null || toma.outMs == null) problemas.push(`La toma ${toma.id} quedó sin uno de sus bordes.`);
        else if (!(toma.palabras || []).length) problemas.push(`La toma ${toma.id} no tiene texto.`);
    }

    return { ok: problemas.length === 0, problemas, segundos: Math.round(segundos * 10) / 10 };
}

function redondo(sec) {
    return String(Math.round(sec * 10) / 10).replace('.', ',');
}

module.exports = { comprobar, TOLERANCIA_SEC };
