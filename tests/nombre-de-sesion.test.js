'use strict';
/**
 * El nombre del XML: armarlo y volver a leerlo.
 *
 * Las dos mitades viven en el mismo archivo porque son la misma convención, y
 * lo que estas pruebas fijan es que sigan siendo la misma: armar y leer tienen
 * que dar la vuelta completa.
 */

const nombre = require('../engine/nombre-de-sesion');

module.exports = function (t) {
    t.group('nombre-de-sesion');

    t.test('lleva el curso, la fecha y la hora', () => {
        const cuandoMs = Date.parse('2026-09-29T10:15:00');
        t.eq(nombre.armar({ curso: 'Curso de React', cuandoMs }),
            'curso-de-react_2026-09-29_10-15-00');
    });

    t.test('la hora es la de la pared y no UTC', () => {
        // Es contra esa hora que el editor empareja los archivos de cámara,
        // que traen la hora local de su reloj en su fecha de creación.
        const cuandoMs = Date.parse('2026-09-29T23:45:30');
        const armado = nombre.armar({ curso: 'x', cuandoMs });
        t.ok(armado.endsWith('_2026-09-29_23-45-30'), armado);
    });

    t.test('el curso se limpia de lo que no cabe en un archivo', () => {
        t.eq(nombre.armar({ curso: 'Diseño / UX 2026', cuandoMs: Date.parse('2026-01-02T03:04:05') }),
            'diseno-ux-2026_2026-01-02_03-04-05');
    });

    t.test('sin curso queda "clase"', () => {
        t.ok(nombre.armar({ cuandoMs: Date.parse('2026-01-02T03:04:05') }).startsWith('clase_'));
    });

    t.test('leer devuelve lo que armar puso', () => {
        const cuandoMs = Date.parse('2026-09-29T10:15:00');
        const leido = nombre.leer(nombre.armar({ curso: 'react', cuandoMs }));
        t.eq(leido.curso, 'react');
        t.eq(leido.cuandoMs, cuandoMs);
    });

    t.test('leer aguanta la extensión', () => {
        t.ok(nombre.leer('react_2026-09-29_10-15-00.xml') != null);
    });

    t.test('un nombre que no es nuestro devuelve null', () => {
        t.eq(nombre.leer('cualquier cosa.xml'), null);
    });

    t.test('un curso con guiones bajos no rompe la lectura', () => {
        // El curso puede traer lo que sea antes de la fecha: la expresión tiene
        // que anclar en la fecha y no en el primer guión bajo.
        const cuandoMs = Date.parse('2026-09-29T10:15:00');
        const armado = nombre.armar({ curso: 'a b c', cuandoMs });
        t.eq(nombre.leer(armado).cuandoMs, cuandoMs);
    });
};
