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

    t.group('nombre-de-sesion · el número de clase');

    const T = Date.parse('2026-09-29T10:15:00');
    const arma = (numero, vez) => nombre.armar({ curso: 'Curso Jev', cuandoMs: T, numero, vez });

    t.test('el número va primero y con dos dígitos', () => {
        // Dos dígitos para que `01` ordene al lado de `02` y de `10`, que es
        // justo lo que `1`, `2` y `10` no hacen en ninguna lista de archivos.
        t.eq(arma(1), '01_curso-jev_2026-09-29_10-15-00');
        t.eq(arma(12), '12_curso-jev_2026-09-29_10-15-00');
    });

    t.test('la primera vez no lleva V1', () => {
        // Casi todas las clases se graban una sola vez: un `V1` en todas sería
        // ruido en todas para decir algo de unas pocas.
        t.eq(arma(1, 1), arma(1));
        t.eq(arma(1, 2), '01_V2_curso-jev_2026-09-29_10-15-00');
        t.eq(arma(1, 7), '01_V7_curso-jev_2026-09-29_10-15-00');
    });

    t.test('pasados los 99 se escribe entero, no truncado', () => {
        // Un curso de 120 clases es raro, pero perderle el número a la 100 por
        // raro sería un error silencioso en el nombre de un archivo.
        t.eq(arma(100), '100_curso-jev_2026-09-29_10-15-00');
    });

    t.test('sin número el nombre es el de siempre', () => {
        // Es por acá que entra el modo semanal, que nombra por fecha.
        t.eq(arma(null), 'curso-jev_2026-09-29_10-15-00');
        t.eq(arma(0), 'curso-jev_2026-09-29_10-15-00', 'no hay clase 00');
        t.eq(arma('abc'), 'curso-jev_2026-09-29_10-15-00');
        t.eq(nombre.armar({ curso: 'Curso Jev', cuandoMs: T, vez: 4 }),
            'curso-jev_2026-09-29_10-15-00', 'y una vez sin número no se escribe sola');
    });

    t.test('leer devuelve el número y la vez que armar puso', () => {
        for (const [n, v] of [[1, 1], [1, 2], [12, 4], [100, 12]]) {
            const leido = nombre.leer(arma(n, v));
            t.eq(leido.numero, n, arma(n, v));
            t.eq(leido.vez, v);
            t.eq(leido.curso, 'curso-jev');
            t.eq(leido.cuandoMs, T);
        }
    });

    t.test('una clase sin número se lee igual, con la vez en 1', () => {
        // Las grabadas antes de que el número existiera. Una sesión que no se
        // puede leer no se puede abrir ni renombrar ni regenerar.
        const leido = nombre.leer('curso-jev_2026-09-29_10-15-00');
        t.eq(leido.numero, null);
        t.eq(leido.vez, 1, 'siempre al menos 1: el que lee no tiene que acordarse');
    });

    t.test('un curso que empieza con números no se confunde con uno', () => {
        // Es el caso real: la carpeta «2609_Claude_Code» da el curso
        // «2609-claude-code». Lo que salva es que la parte del número pide
        // dígitos seguidos de `_`, y ahí después de los dígitos viene un guión.
        const leido = nombre.leer('2609-claude-code_2026-09-29_10-15-00');
        t.eq(leido.numero, null);
        t.eq(leido.curso, '2609-claude-code');
    });

    t.test('un curso que ES un número no se come la fecha', () => {
        const leido = nombre.leer('01_2026-09-29_10-15-00');
        t.eq(leido.curso, '01');
        t.eq(leido.numero, null);
        t.eq(leido.cuandoMs, T);
    });
};
