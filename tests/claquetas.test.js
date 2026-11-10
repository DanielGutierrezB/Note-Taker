'use strict';
/**
 * Las claquetas: la app ya no las anota, y las que traen las clases de antes
 * se siguen leyendo como entonces.
 *
 * Cada clase se sincroniza por forma de onda, el WAV de las notas contra el
 * audio de las cámaras, así que decir «claqueta» o aplaudir ya no deja nada.
 * Lo que queda es la lista de las clases grabadas antes —con su fusión y su
 * numeración—, que siguen llevando sus marcadores al XML.
 */

const vivo = require('../engine/notas-vivo');
const grabacion = require('../engine/grabacion');

const T0 = Date.parse('2026-09-29T10:00:00');

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

function palabras(pares) {
    return pares.map(([dt, texto]) => ({ t: T0 + dt, texto, hasta: T0 + dt + 300 }));
}

module.exports = function (t) {
    t.group('claquetas · la app ya no las anota');

    t.test('decir «claqueta» no anota ninguna ni avisa nada', () => {
        const e = nuevo();
        const ev = vivo.aplicarSenales(e, palabras([
            [5000, 'Claqueta'], [5400, '3,'], [5800, 'clase'], [6200, '3.']
        ]));
        t.eq(e.claquetas.length, 0);
        t.eq(ev.filter(x => /claqueta/.test(x.tipo)).length, 0, 'ni claqueta ni claqueta-sin-aplauso');
    });

    t.test('ni con las escrituras con que Whisper la escribía', () => {
        for (const como of ['Cacleta', 'Klaqueta', 'Claquetados', 'Laqueta']) {
            const e = nuevo();
            vivo.aplicarSenales(e, palabras([[1000, como], [1400, 'dos']]));
            t.eq(e.claquetas.length, 0, como);
        }
    });

    t.test('la palabra no abre ni cierra una toma', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Claqueta'], [5400, 'cuatro']]));
        t.eq(e.tomas.length, 1);
        t.eq(e.tomas[0].outMs, null, 'la toma sigue abierta');
    });

    t.test('y entra en la toma abierta como cualquier otra palabra', () => {
        // Sacarla del transcript sería mentir sobre lo que se oye en el audio.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Claqueta'], [5400, 'cuatro']]));
        t.deep(e.tomas[0].palabras.map(w => w.texto), ['Hola', 'Claqueta', 'cuatro']);
    });

    t.test('el motor ya no tiene por dónde anotarlas en vivo', () => {
        t.eq(typeof grabacion.claqueta, 'undefined', 'sin la K');
        t.eq(typeof grabacion.quitarClaqueta, 'undefined', 'sin quitarla');
        for (const nombre of ['claquetaDicha', 'recordarAplauso', 'aplausoCerca', 'CLAQUETA']) {
            t.eq(vivo[nombre], undefined, nombre);
        }
    });
};
