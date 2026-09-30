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

    t.test('sobre el ruido de sala, con el piso aprendido, tampoco se dijo nada', () => {
        // El caso del 30/09: el micrófono eran unos AirPods, el silencio de la
        // sala estaba en −65 y el corte fijo de −60 no filtraba nada.
        const ruido = Math.pow(10, -65 / 20) * Math.SQRT2;
        const piso = sonido.seguidor();
        for (let i = 0; i < sonido.MINIMO; i++) sonido.aprender(piso, sonido.niveles(wav([[2, ruido]])));
        const corte = sonido.umbral(piso);
        t.ok(corte > -50 && corte < -35, `el corte quedó en ${corte.toFixed(1)} dBFS`);

        const n = sonido.niveles(wav([[3, ruido]]));
        t.eq(sonido.algoSuena(n, corte), false);
        t.eq(sonido.conSonido([{ start: 1, end: 1.3, text: 'Gracias.' }], n, corte).words.length, 0);
    });

    t.test('con el piso aprendido, lo hablado sobre ese mismo ruido se queda', () => {
        const ruido = Math.pow(10, -65 / 20) * Math.SQRT2;
        const piso = sonido.seguidor();
        for (let i = 0; i < sonido.MINIMO; i++) sonido.aprender(piso, sonido.niveles(wav([[2, ruido]])));
        const corte = sonido.umbral(piso);

        // −20 dB, que es donde estuvo la voz en las dos grabaciones reales.
        const n = sonido.niveles(wav([[2, ruido], [2, Math.pow(10, -20 / 20) * Math.SQRT2]]));
        t.eq(sonido.algoSuena(n, corte), true);
        const r = sonido.conSonido([
            { start: 0.5, end: 0.9, text: 'Gracias.' },
            { start: 2.5, end: 2.9, text: 'Hola' }
        ], n, corte);
        t.deep(r.words.map(w => w.text), ['Hola']);
    });

    t.test('un golpe corto no es una palabra por más fuerte que sea', () => {
        // El caso que se colaba con el corte adaptativo solo: un clic de teclado
        // llega a −33 dB y pasa cualquier corte de nivel, pero dura 40 ms.
        const ruido = Math.pow(10, -65 / 20) * Math.SQRT2;
        const fuerte = Math.pow(10, -20 / 20) * Math.SQRT2;
        const piso = sonido.seguidor();
        for (let i = 0; i < sonido.MINIMO; i++) sonido.aprender(piso, sonido.niveles(wav([[2, ruido]])));
        const corte = sonido.umbral(piso);

        const golpe = sonido.niveles(wav([[2, ruido], [0.04, fuerte], [2, ruido]]));
        t.eq(sonido.algoSuena(golpe, corte), false);
        t.eq(sonido.conSonido([{ start: 2.0, end: 2.05, text: 'Gracias.' }], golpe, corte).words.length, 0);

        const palabra = sonido.niveles(wav([[2, ruido], [0.4, fuerte], [2, ruido]]));
        t.eq(sonido.algoSuena(palabra, corte), true);
        t.eq(sonido.conSonido([{ start: 2.0, end: 2.4, text: 'Hola' }], palabra, corte).words.length, 1);
    });

    t.test('la primera pasada de una clase ya corre con el piso medido', () => {
        // El «Gracias.» del arranque de la grabación de las 09:08 del 30/09: el
        // piso esperaba a tener tres mediciones y hasta entonces valía −60, que
        // es justo el corte que con un micrófono de sala no filtra nada. Eran
        // dos segundos de rendija al principio de cada clase.
        const ruido = Math.pow(10, -65 / 20) * Math.SQRT2;
        const piso = sonido.seguidor();
        sonido.aprender(piso, sonido.niveles(wav([[2, ruido]])));
        const corte = sonido.umbral(piso);
        t.ok(corte > -50 && corte < -35, `el corte de la primera pasada quedó en ${corte.toFixed(1)} dBFS`);

        const n = sonido.niveles(wav([[3, ruido]]));
        t.eq(sonido.algoSuena(n, corte), false);
        t.eq(sonido.conSonido([{ start: 1, end: 1.4, text: 'Gracias.' }], n, corte).words.length, 0);
    });

    t.test('mientras calienta manda la pasada más callada y no la más ruidosa', () => {
        // Una clase que arranca con alguien ya hablando mide un piso alto en la
        // primera pasada. Con una sola medición no hay cómo saber si eso es la
        // sala o es la voz, así que vale la más callada: perder una palabra
        // dicha es peor que dejar pasar una inventada.
        const piso = sonido.seguidor();
        sonido.aprender(piso, sonido.niveles(wav([[2, Math.pow(10, -45 / 20) * Math.SQRT2]])));
        sonido.aprender(piso, sonido.niveles(wav([[2, Math.pow(10, -65 / 20) * Math.SQRT2]])));
        const corte = sonido.umbral(piso);
        t.ok(corte > -45 && corte < -37, `manda el piso de −65: el corte quedó en ${corte.toFixed(1)} dBFS`);
    });

    t.test('sin pasadas medidas el corte es el de abajo, que no se come nada', () => {
        t.eq(sonido.umbral(sonido.seguidor()), sonido.PISO_DB);
        t.eq(sonido.umbral(null), sonido.PISO_DB);
    });

    t.test('con silencio digital el corte no se hunde con el piso', () => {
        // Piso −120 + 24 daría −96: cualquier cosa pasaría. Se planta en −60.
        const piso = sonido.seguidor();
        for (let i = 0; i < 5; i++) sonido.aprender(piso, sonido.niveles(wav([[2, 0]])));
        t.eq(sonido.umbral(piso), sonido.PISO_DB);
    });

    t.test('en una sala ruidosa el filtro se rinde antes que comerse lo hablado', () => {
        const piso = sonido.seguidor();
        const ruido = Math.pow(10, -40 / 20) * Math.SQRT2;
        for (let i = 0; i < 5; i++) sonido.aprender(piso, sonido.niveles(wav([[2, ruido]])));
        t.eq(sonido.umbral(piso), sonido.TECHO_DB);
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
