'use strict';
/**
 * La primera palabra después del «3, 2, 1» es de la toma.
 *
 * El IN del conteo cae en esa palabra con la hora del ciclo. Al cerrar, el
 * modelo grande la vuelve a escribir con la suya, que suele ser unos
 * milisegundos antes, y repartida por el IN viejo quedaba en el gris de antes:
 * en las clases de octubre le pasó a una toma de cada cinco («Aquí inicia una
 * toma» salía «inicia una toma»).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const vivo = require('../engine/notas-vivo');

const pedazo = () => Buffer.alloc(48000 * 2);
const reposo = () => new Promise(r => setTimeout(r, 40));

const T0 = 1_000_000;
const w = (dt, texto) => ({ t: T0 + dt, texto, hasta: T0 + dt + 300 });
const delConteo = extra => ({
    id: 1, cuenta: '3, 2, 1', inMs: T0 + 2600, outMs: T0 + 9000, finDelConteoMs: T0 + 2100,
    antes: [w(1000, '3,'), w(1400, '2,'), w(1800, '1.'), w(2570, 'Aquí')],
    palabras: [w(2900, 'inicia')], ...extra
});

/**
 * Una clase con una toma abierta por el conteo, cerrada y releída por un
 * Whisper de mentira que escribe «Aquí» 30 ms antes que el ciclo.
 */
async function releidaConLaPrimeraAntes(t, antesDeLeer) {
    const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
    const st = grabacion.iniciar({
        dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-conteo-')), curso: 'c', fps: 30, sinReloj: true, sampleRate: 48000
    });
    const enVivo = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
    let ventana = [enVivo(1000, '3,'), enVivo(1400, '2,'), enVivo(1800, '1.'), enVivo(2600, 'Aquí'), enVivo(3000, 'inicia')];
    oirToma.tramo = async () => ({ palabras: ventana });
    oirToma.leer = async (_a, toma) => ({
        ...vivo.repartir([enVivo(1000, '3,'), enVivo(1400, '2,'), enVivo(1800, '1.'),
            enVivo(2570, 'Aquí'), enVivo(2990, 'inicia'), enVivo(3400, 'una')], toma),
        colapsadas: 0, relectura: null
    });
    try {
        for (let i = 0; i < 8; i++) grabacion.pcm(pedazo());
        await grabacion.buscarSenales();
        const s = grabacion._sesion();
        const toma = s.estado.tomas[0];
        t.eq(toma.inMs, st.ceroMs + 2600, 'el conteo puso el IN en «Aquí», con la hora del ciclo');
        if (antesDeLeer) antesDeLeer(st);
        grabacion.cerrarToma(st.ceroMs + 4000);
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        ventana = [];
        await grabacion.buscarSenales();
        await reposo();
        return { st, toma };
    } finally {
        oirToma.tramo = antes.tramo;
        oirToma.leer = antes.leer;
        grabacion.apagar();
    }
}

module.exports = function (t) {
    t.group('conteo · la primera palabra, la regla');

    t.test('la primera palabra corrida unos milisegundos antes del IN lo trae', () => {
        t.eq(vivo.inTrasElConteo(delConteo()), T0 + 2570);
    });

    t.test('el «1» no cuenta, aunque la relectura lo escriba después del final del ciclo', () => {
        const toma = delConteo({ antes: [w(1000, '3,'), w(1400, '2,'), w(2200, 'Uno.'), w(2570, 'Aquí')], cuenta: '3, 2, uno' });
        t.eq(vivo.inTrasElConteo(toma), T0 + 2570);
    });

    t.test('lo de antes del conteo no se toca', () => {
        t.eq(vivo.inTrasElConteo(delConteo({ antes: [w(1000, '3,'), w(1400, '2,'), w(1800, '1.')] })), null);
    });

    t.test('más lejos que la holgura es algo que el ciclo no oyó, y el IN se queda', () => {
        const lejos = 2600 - vivo.HOLGURA_DEL_CONTEO_MS - 100;
        const toma = delConteo({ finDelConteoMs: T0 + lejos - 50, antes: [w(lejos - 300, '1.'), w(lejos, 'eh'), w(2570, 'Aquí')] });
        t.eq(vivo.inTrasElConteo(toma), null,
            'la primera después del conteo está lejos: no se salta a la segunda');
    });

    t.test('sin la marca del conteo, nada: una toma abierta a mano o un IN movido', () => {
        t.eq(vivo.inTrasElConteo(delConteo({ finDelConteoMs: undefined })), null);
        const movida = delConteo();
        vivo.moverBorde(movida, 'in', T0 + 2800, []);
        t.eq(movida.finDelConteoMs, undefined, 'mover el IN borra la marca');
        t.eq(vivo.inTrasElConteo(movida), null);
    });

    t.group('conteo · la primera palabra, en la relectura');

    t.test('releída, la toma empieza con la palabra que siguió al «1»', async () => {
        const { st, toma } = await releidaConLaPrimeraAntes(t);
        t.eq(toma.inMs, st.ceroMs + 2570, 'el IN se acercó a la hora del modelo grande');
        t.deep(toma.palabras.map(x => x.texto), ['Aquí', 'inicia', 'una']);
        t.deep(toma.antes.map(x => x.texto), ['3,', '2,', '1.'], 'y el conteo sigue afuera');
        t.eq(toma.finDelConteoMs, undefined, 'una vez, como el OUT del botón');
    });

    t.test('un IN movido a mano antes de releer se respeta', async () => {
        const { st, toma } = await releidaConLaPrimeraAntes(t, st => {
            grabacion.editar({ tipo: 'borde', toma: 1, borde: 'in', paredMs: st.ceroMs + 2990 });
        });
        t.eq(toma.inMs, st.ceroMs + 2990, 'donde lo dejó el editor');
        t.eq(toma.palabras[0].texto, 'inicia');
    });
};
