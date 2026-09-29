'use strict';
/**
 * Las palabras sobre el silencio. El caso real: Zoom manda ceros exactos cuando
 * nadie habla, y Whisper escribía «Gracias, gracias, gracias» antes de que el
 * profesor empezara.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sonido = require('../engine/sonido');

/** Un WAV de 16 kHz mono: `tramos` es [[segundos, amplitud 0..1], …]. */
function wav(tramos) {
    const tasa = 16000;
    const muestras = [];
    for (const [seg, amp] of tramos) {
        for (let i = 0; i < seg * tasa; i++) muestras.push(Math.round(Math.sin(i / 5) * amp * 32767));
    }
    const datos = Buffer.alloc(muestras.length * 2);
    muestras.forEach((v, i) => datos.writeInt16LE(v, i * 2));
    const cab = Buffer.alloc(44);
    cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
    cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
    cab.writeUInt32LE(tasa, 24); cab.writeUInt32LE(tasa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
    cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
    const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nt-sonido-')), 'x.wav');
    fs.writeFileSync(archivo, Buffer.concat([cab, datos]));
    return archivo;
}

module.exports = function (t) {
    t.group('sonido · lo que se dijo sobre el silencio');

    t.test('un recorte de silencio digital no suena: no se le pregunta a Whisper', () => {
        const n = sonido.niveles(wav([[4, 0]]));
        t.eq(sonido.algoSuena(n), false);
    });

    t.test('con voz suena', () => {
        const n = sonido.niveles(wav([[2, 0], [2, 0.2]]));
        t.eq(sonido.algoSuena(n), true);
    });

    t.test('«Gracias.» sobre el silencio se va, lo dicho se queda', () => {
        // 0-3 s silencio, 3-5 s voz.
        const n = sonido.niveles(wav([[3, 0], [2, 0.2]]));
        const r = sonido.conSonido([
            { start: 0.5, end: 0.9, text: 'Gracias.' },
            { start: 1.2, end: 1.6, text: 'Gracias.' },
            { start: 3.1, end: 3.5, text: 'Hola' },
            { start: 3.6, end: 4.0, text: 'mundo' }
        ], n);
        t.deep(r.words.map(w => w.text), ['Hola', 'mundo']);
        t.eq(r.mudas, 2);
    });

    t.test('una palabra puesta un poco antes de que suene se queda', () => {
        // Los tiempos de Whisper se corren: el margen es para esto.
        const n = sonido.niveles(wav([[3, 0], [2, 0.2]]));
        const r = sonido.conSonido([{ start: 2.7, end: 2.95, text: 'Bueno' }], n);
        t.eq(r.words.length, 1);
    });

    t.test('el ruido de sala de un micrófono no es silencio', () => {
        // −55 dB, lo más bajo medido con unos AirPods como micrófono.
        const n = sonido.niveles(wav([[3, Math.pow(10, -55 / 20) * Math.SQRT2]]));
        t.eq(sonido.algoSuena(n), true);
        t.eq(sonido.conSonido([{ start: 1, end: 1.3, text: 'sí' }], n).words.length, 1);
    });

    t.test('un archivo que no se entiende no filtra nada', () => {
        const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nt-sonido-')), 'x.wav');
        fs.writeFileSync(archivo, 'no es un wav');
        const n = sonido.niveles(archivo);
        t.eq(n, null);
        t.eq(sonido.algoSuena(n), true);
        t.eq(sonido.conSonido([{ start: 0, end: 1, text: 'x' }], n).words.length, 1);
    });
};
