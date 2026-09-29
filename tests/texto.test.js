'use strict';
/**
 * `norm`, que es con lo que se comparan dos palabras.
 *
 * Lo usa el reconocimiento de repeticiones: dos intentos del mismo arranque se
 * dicen distinto —con tilde, con coma, con mayúscula— y son la misma palabra.
 */

const { norm } = require('../engine/texto');

module.exports = function (t) {
    t.group('texto · norm');

    t.test('baja a minúsculas', () => {
        t.eq(norm('Hola'), norm('hola'));
    });

    t.test('saca las tildes', () => {
        t.eq(norm('días'), norm('dias'));
    });

    t.test('saca la puntuación', () => {
        t.eq(norm('ejercicio,'), norm('ejercicio'));
        t.eq(norm('¿Listo?'), norm('listo'));
    });

    t.test('dos palabras distintas siguen siendo distintas', () => {
        t.ok(norm('prompt') !== norm('promesa'));
    });

    t.test('lo vacío no rompe', () => {
        t.eq(norm(''), '');
        t.eq(norm(null), '');
    });
};
