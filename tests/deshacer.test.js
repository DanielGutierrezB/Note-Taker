'use strict';
/**
 * El historial: la pila, las fotos y lo único que no se puede deshacer.
 *
 * Se prueba sin sesión y sin disco. Lo que vive en la sesión —que deshacer
 * reescriba el XML— está en `sesion.test.js`; acá está la regla.
 */

const historial = require('../engine/deshacer');

function unaToma(extra) {
    return Object.assign({
        id: 1, vista: 'PV', comentario: '', inMs: 1000, outMs: 2000,
        descartada: false, palabras: [], comentarios: []
    }, extra || {});
}

module.exports = function (t) {
    t.group('deshacer · las fotos');

    t.test('una foto no comparte memoria con la toma', () => {
        // Si la compartiera, el próximo cambio la modificaría y deshacer
        // repondría el estado de después en vez del de antes.
        const toma = unaToma();
        const foto = historial.foto(toma);
        toma.comentario = 'después';
        t.eq(foto.comentario, '');
    });

    t.test('dos fotos iguales se reconocen', () => {
        t.ok(historial.mismaFoto(historial.foto(unaToma()), historial.foto(unaToma())));
    });

    t.test('y dos distintas no', () => {
        t.eq(historial.mismaFoto(
            historial.foto(unaToma()), historial.foto(unaToma({ vista: 'R' }))), false);
    });

    t.group('deshacer · la pila');

    t.test('un paso que no cambió nada no entra', () => {
        // Un arrastre que volvió al mismo sitio, un clic sobre la vista que ya
        // estaba: sin esto, un Cmd-Z se gasta en pasos fantasma antes de llegar
        // a lo que uno quería deshacer.
        const h = historial.nueva();
        const foto = historial.foto(unaToma());
        historial.anotar(h, { que: 'nada', tipo: 'vista', id: 1, antes: foto, despues: foto });
        t.eq(historial.pasos(h).atras, 0);
    });

    t.test('un paso que cambió algo sí', () => {
        const h = historial.nueva();
        historial.anotar(h, {
            que: 'poner la toma 1 en R', tipo: 'vista', id: 1,
            antes: historial.foto(unaToma()),
            despues: historial.foto(unaToma({ vista: 'R' }))
        });
        t.eq(historial.pasos(h).atras, 1);
        t.eq(historial.proximo(h, 'atras').que, 'poner la toma 1 en R');
    });

    t.test('deshacer mueve el paso a la pila de rehacer', () => {
        const h = historial.nueva();
        historial.anotar(h, {
            que: 'x', tipo: 'vista', id: 1,
            antes: historial.foto(unaToma()),
            despues: historial.foto(unaToma({ vista: 'R' }))
        });
        historial.sacar(h, 'atras');
        t.eq(historial.pasos(h).atras, 0);
        t.eq(historial.pasos(h).adelante, 1);
    });

    t.test('un paso nuevo tira lo que había para rehacer', () => {
        const h = historial.nueva();
        const paso = {
            que: 'x', tipo: 'vista', id: 1,
            antes: historial.foto(unaToma()),
            despues: historial.foto(unaToma({ vista: 'R' }))
        };
        historial.anotar(h, paso);
        historial.sacar(h, 'atras');
        historial.anotar(h, {
            que: 'y', tipo: 'nota', id: 1,
            antes: historial.foto(unaToma()),
            despues: historial.foto(unaToma({ comentario: 'hola' }))
        });
        t.eq(historial.pasos(h).adelante, 0, 'la rama vieja se fue');
    });

    t.group('deshacer · reponer');

    t.test('poner devuelve la toma a como estaba', () => {
        const tomas = [unaToma({ vista: 'R' })];
        historial.poner(tomas, 1, historial.foto(unaToma()));
        t.eq(tomas[0].vista, 'PV');
    });

    t.test('reponer una toma eliminada la devuelve a su sitio', () => {
        const tomas = [unaToma({ id: 1 }), unaToma({ id: 3 })];
        historial.poner(tomas, 2, historial.foto(unaToma({ id: 2 })));
        t.deep(tomas.map(x => x.id), [1, 2, 3], 'entra en orden y no al final');
    });

    t.test('reponer null elimina la toma', () => {
        const tomas = [unaToma({ id: 1 }), unaToma({ id: 2 })];
        historial.poner(tomas, 2, null);
        t.deep(tomas.map(x => x.id), [1]);
    });

    t.test('un campo del estado se repone entero', () => {
        // La foto de las claquetas es de la LISTA y no de una: anotar puede
        // fundir dos y renumerar las de atrás.
        const estado = { claquetas: [{ n: 1, ms: 5 }, { n: 2, ms: 9 }] };
        const antes = historial.fotoDeCampo([{ n: 1, ms: 5 }]);
        historial.ponerCampo(estado, 'claquetas', antes);
        t.eq(estado.claquetas.length, 1);
    });

    t.group('deshacer · lo que no se puede');

    t.test('no se repone una toma abierta si ya hay otra', () => {
        // Dos tomas abiertas a la vez rompen el ciclo de señales: le mete las
        // palabras a "la abierta" y no hay tal cosa.
        const tomas = [unaToma({ id: 1, outMs: null })];
        const foto = historial.foto(unaToma({ id: 2, outMs: null }));
        t.ok(historial.dejariaDosAbiertas(tomas, 2, foto));
    });

    t.test('reponer una cerrada sí se puede aunque haya una abierta', () => {
        const tomas = [unaToma({ id: 1, outMs: null })];
        const foto = historial.foto(unaToma({ id: 2, outMs: 9000 }));
        t.eq(historial.dejariaDosAbiertas(tomas, 2, foto), false);
    });

    t.group('deshacer · el tope');

    t.test('la pila no crece sin fin', () => {
        const h = historial.nueva();
        for (let i = 0; i < 200; i++) {
            historial.anotar(h, {
                que: `paso ${i}`, tipo: 'nota', id: 1,
                antes: historial.foto(unaToma({ comentario: `a${i}` })),
                despues: historial.foto(unaToma({ comentario: `b${i}` }))
            });
        }
        t.ok(historial.pasos(h).atras <= 60, historial.pasos(h).atras);
    });
};
