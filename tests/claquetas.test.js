'use strict';
/**
 * Las claquetas múltiples: las tres puertas, la fusión y la numeración.
 *
 * Es lo que más cambia respecto de Class Cut, donde había UNA claqueta y la
 * regla era cuál de dos se queda. Acá se claquetea cada vez que hay que volver
 * a sincronizar, así que la pregunta es otra: cuáles son la misma.
 */

const vivo = require('../engine/notas-vivo');

const T0 = Date.parse('2026-09-29T10:00:00');

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

function palabras(pares) {
    return pares.map(([dt, texto]) => ({ t: T0 + dt, texto, hasta: T0 + dt + 300 }));
}

module.exports = function (t) {
    t.group('claquetas · las tres puertas');

    t.test('el aplauso anota una', () => {
        const e = nuevo();
        const r = vivo.anotarClaqueta(e, {
            ms: T0 + 12000, frase: 'Claqueta 1, clase 1', confirmada: true, origen: 'golpe'
        });
        t.ok(r.nueva);
        t.eq(e.claquetas.length, 1);
        t.eq(r.claqueta.n, 1);
    });

    t.test('la palabra "claqueta" dicha anota una', () => {
        const e = nuevo();
        const ev = vivo.aplicarSenales(e, palabras([
            [5000, 'Claqueta'], [5400, '3,'], [5800, 'clase'], [6200, '3.']
        ]));
        t.eq(e.claquetas.length, 1);
        t.eq(ev[0].tipo, 'claqueta');
        t.eq(ev[0].por, 'voz');
    });

    t.test('Whisper escribe la palabra mal y se la reconoce igual', () => {
        // "Cacleta", "Klaqueta" y "Claquetados" son escrituras reales.
        for (const como of ['Cacleta', 'Klaqueta', 'Claquetados']) {
            const e = nuevo();
            vivo.aplicarSenales(e, palabras([[1000, como], [1400, 'dos']]));
            t.eq(e.claquetas.length, 1, `${como} cuenta como claqueta`);
        }
    });

    t.test('el editor anota una a mano', () => {
        const e = nuevo();
        const r = vivo.anotarClaqueta(e, { ms: T0 + 200, confirmada: true, origen: 'editor' });
        t.eq(r.claqueta.origen, 'editor');
        t.ok(r.claqueta.confirmada);
    });

    t.group('claquetas · la fusión');

    t.test('dos puertas a menos de cinco segundos son la misma', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, frase: 'Claqueta 3', confirmada: true, origen: 'voz' });
        const r = vivo.anotarClaqueta(e, { ms: T0 + 13500, confirmada: true, origen: 'golpe' });
        t.eq(r.nueva, false, 'no es nueva');
        t.eq(e.claquetas.length, 1);
    });

    t.test('el `ms` lo pone el golpe, que es el que mide la onda', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, frase: 'Claqueta 3', confirmada: true, origen: 'voz' });
        vivo.anotarClaqueta(e, { ms: T0 + 13500, confirmada: true, origen: 'golpe' });
        t.eq(e.claquetas[0].ms, T0 + 13500, 'gana el del aplauso');
    });

    t.test('la frase la pone la voz, que es la única que sabe qué se dijo', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, frase: '', confirmada: false, origen: 'golpe' });
        vivo.anotarClaqueta(e, { ms: T0 + 13000, frase: 'Claqueta 3, clase 3', confirmada: true, origen: 'voz' });
        t.eq(e.claquetas[0].frase, 'Claqueta 3, clase 3');
    });

    t.test('confirmada es un o-lógico: una sin confirmar no desconfirma', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, confirmada: true, origen: 'voz' });
        vivo.anotarClaqueta(e, { ms: T0 + 13000, confirmada: false, origen: 'golpe' });
        t.ok(e.claquetas[0].confirmada);
    });

    t.test('el origen dice las dos puertas', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, confirmada: true, origen: 'voz' });
        vivo.anotarClaqueta(e, { ms: T0 + 13000, confirmada: false, origen: 'golpe' });
        t.eq(e.claquetas[0].origen, 'golpe,voz');
    });

    t.test('a más de cinco segundos son dos', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, confirmada: true, origen: 'golpe' });
        const r = vivo.anotarClaqueta(e, { ms: T0 + 20000, confirmada: true, origen: 'golpe' });
        t.ok(r.nueva);
        t.eq(e.claquetas.length, 2);
    });

    t.group('claquetas · la numeración');

    t.test('se numeran por orden de reloj y no de llegada', () => {
        // Un golpe cuyo texto tarda tres segundos en leerse puede entrar
        // después de uno posterior: el número tiene que decir el orden en que
        // sonaron, que es el que el editor ve en su pizarra.
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 60000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        t.deep(e.claquetas.map(c => c.n), [1, 2]);
        t.eq(e.claquetas[0].ms, T0 + 10000, 'la primera es la más temprana');
    });

    t.test('la referencia es siempre la primera del reloj', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 60000, confirmada: true, origen: 'golpe' });
        t.eq(vivo.claquetaDeReferencia(e).ms, T0 + 60000);
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        t.eq(vivo.claquetaDeReferencia(e).ms, T0 + 10000, 'la nueva pasa a ser la referencia');
    });

    t.test('quitar una renumera las que quedan', () => {
        const e = nuevo();
        for (const dt of [10000, 60000, 120000]) {
            vivo.anotarClaqueta(e, { ms: T0 + dt, confirmada: true, origen: 'golpe' });
        }
        vivo.quitarClaqueta(e, 2);
        t.deep(e.claquetas.map(c => c.n), [1, 2]);
        t.deep(e.claquetas.map(c => c.ms - T0), [10000, 120000]);
    });

    t.group('claquetas · no frenan a la primera');

    t.test('se anotan todas las que haya en una clase', () => {
        // En Class Cut, con la claqueta confirmada no se anotaba ningún golpe
        // más. Acá se claquetea cada vez que hay que volver a sincronizar.
        const e = nuevo();
        for (let i = 0; i < 7; i++) {
            vivo.anotarClaqueta(e, {
                ms: T0 + i * 600000, frase: `Claqueta ${i + 1}`, confirmada: true, origen: 'golpe'
            });
        }
        t.eq(e.claquetas.length, 7);
        t.deep(e.claquetas.map(c => c.n), [1, 2, 3, 4, 5, 6, 7]);
    });

    t.test('la claqueta dicha no abre ni cierra una toma', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Claqueta'], [5400, 'cuatro']]));
        t.eq(e.tomas.length, 1);
        t.eq(e.tomas[0].outMs, null, 'la toma sigue abierta');
    });

    t.test('y sus palabras entran en la toma que esté abierta', () => {
        // Sacarlas del transcript sería mentir sobre lo que se oye en el audio.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Claqueta'], [5400, 'cuatro']]));
        t.deep(e.tomas[0].palabras.map(w => w.texto), ['Hola', 'Claqueta', 'cuatro']);
    });
};
