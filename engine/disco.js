'use strict';
/**
 * disco.js — Si en la carpeta se puede escribir, y cuánta clase entra.
 *
 * Nadie lo miraba: un disco lleno a mitad de la clase se descubría porque el
 * audio dejaba de crecer, y un disco desenchufado antes de empezar, al apretar
 * Iniciar. El WAV crece unos 345 MB por hora a 48 kHz mono, que es lo único
 * que pesa de verdad: el XML y el archivo de notas son kilobytes.
 */

const fs = require('fs');
const path = require('path');

/** Lo que crece el WAV por minuto, a la tasa y los canales de la entrada. */
function bytesPorMinuto(sampleRate, canales) {
    return (sampleRate || 48000) * (canales || 1) * 2 * 60;
}

/**
 * Escribe y borra un archivo de prueba, y pregunta cuánto queda libre.
 *
 * Se escribe de verdad y no se pregunta por permisos: una carpeta de un disco
 * que se desmontó, o de un Drive sin conexión, dice que se puede escribir y
 * después no deja.
 *
 * @returns {{escribible:boolean, libre:number|null, minutos:number|null, error?:string}}
 *   `minutos` es cuánto audio entra; null si el sistema no lo dice (pasa con
 *   algunos discos de red), y entonces no se frena por eso
 */
function revisar(dir, como) {
    const c = como || {};
    const prueba = path.join(dir, `.notetaker-prueba-${process.pid}-${Date.now()}`);
    try {
        fs.writeFileSync(prueba, 'x');
        fs.rmSync(prueba, { force: true });
    } catch (err) {
        return { escribible: false, libre: null, minutos: null, error: err.message };
    }
    try {
        const st = fs.statfsSync(dir);
        const libre = st.bavail * st.bsize;
        return { escribible: true, libre, minutos: Math.floor(libre / bytesPorMinuto(c.sampleRate, c.canales)) };
    } catch (err) {
        return { escribible: true, libre: null, minutos: null };
    }
}

module.exports = { revisar, bytesPorMinuto };
