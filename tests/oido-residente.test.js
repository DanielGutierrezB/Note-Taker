'use strict';
/**
 * El texto en vivo por whisper-server. Lo que se prueba sin un servidor de
 * verdad: cómo sus piezas se vuelven palabras, y que sin él no arranca nada ni
 * se rompe nada. Contra el servidor y el modelo de verdad está
 * `tools/medir-vivo.js`.
 */

const residente = require('../engine/oido-residente');

module.exports = function (t) {
    t.group('oído residente · las piezas');

    t.test('las piezas sin espacio se pegan a la palabra anterior', () => {
        // Así las devuelve whisper-server: « in» + «icia».
        const palabras = residente.palabrasDe({
            segments: [{
                words: [
                    { word: ' esto', start: 0.01, end: 0.23 },
                    { word: ' in', start: 0.38, end: 0.51 },
                    { word: 'icia', start: 0.51, end: 0.85 },
                    { word: ' la', start: 0.85, end: 0.96 },
                    { word: ' toma', start: 1.66, end: 1.96 },
                    { word: '.', start: 1.96, end: 1.98 }
                ]
            }]
        });
        t.deep(palabras.map(w => w.text), ['esto', 'inicia', 'la', 'toma.']);
        t.eq(palabras[1].start, 0.38, 'empieza donde empezó su primera pieza');
        t.eq(palabras[1].end, 0.85, 'y termina donde terminó la última');
    });

    t.test('las marcas entre corchetes no son palabras', () => {
        const palabras = residente.palabrasDe({
            segments: [{ words: [{ word: ' [_BEG_]', start: 0, end: 0 }, { word: ' hola', start: 0.1, end: 0.4 }] }]
        });
        t.deep(palabras.map(w => w.text), ['hola']);
    });

    t.group('oído residente · sin servidor');

    t.test('sin binario no arranca, y no está listo', async () => {
        const ok = await residente.arrancar({ bin: null, modelo: { path: null } });
        t.eq(ok, false);
        t.eq(residente.listo(), false);
    });

    t.test('transcribir sin servidor tira, para que quien llama use el respaldo', async () => {
        let error = null;
        try { await residente.transcribir('/no/existe.wav', 'es'); } catch (e) { error = e; }
        t.ok(error, 'tiró');
    });
};
