'use strict';
/**
 * Los ajustes: qué sobrevive a un archivo escrito a mano.
 *
 * `sanear` es lo único que se prueba acá y es lo único que importa: un fps que
 * no está en la lista no se puede escribir bien en el XML —haría falta saber
 * si lleva `ntsc`— así que tiene que caer al de fábrica en vez de arrastrar un
 * número que después nadie sabe de dónde salió.
 */

const ajustes = require('../engine/ajustes');

module.exports = function (t) {
    t.group('ajustes · sanear');

    t.test('un archivo vacío da lo de fábrica', () => {
        const a = ajustes.sanear(null);
        t.eq(a.fps, 30);
        t.eq(a.idioma, 'es');
        t.eq(a.carpeta, null);
        t.deep(a.carpetas, []);
    });

    t.test('un fps de la lista se respeta', () => {
        t.eq(ajustes.sanear({ fps: 23.976 }).fps, 23.976);
    });

    t.test('un fps inventado cae al de fábrica', () => {
        t.eq(ajustes.sanear({ fps: 37 }).fps, 30);
        t.eq(ajustes.sanear({ fps: 'muchos' }).fps, 30);
    });

    t.test('un idioma que no es de dos letras cae al de fábrica', () => {
        t.eq(ajustes.sanear({ idioma: 'castellano' }).idioma, 'es');
        t.eq(ajustes.sanear({ idioma: 'pt' }).idioma, 'pt');
    });

    t.test('la carpeta activa va primera en la lista', () => {
        // Es el invariante que hace que elegir carpeta sea guardar una sola
        // clave, y que quitar una de la lista no pueda dejar la activa afuera.
        const a = ajustes.sanear({ carpeta: '/b', carpetas: ['/a', '/b', '/c'] });
        t.eq(a.carpetas[0], '/b');
        t.eq(a.carpetas.length, 3, 'y no se duplica');
    });

    t.test('las carpetas no se repiten', () => {
        t.deep(ajustes.sanear({ carpetas: ['/a', '/a', '/b'] }).carpetas, ['/a', '/b']);
    });

    t.test('la lista se recorta al tope, y se recorta al sanear', () => {
        // Quien agregue una séptima no tiene que acordarse de recortar.
        const muchas = Array.from({ length: 20 }, (_, i) => `/c${i}`);
        t.eq(ajustes.sanear({ carpetas: muchas }).carpetas.length, ajustes.RECIENTES);
    });

    t.test('lo que no es una ruta se descarta', () => {
        t.deep(ajustes.sanear({ carpetas: ['/a', null, 3, '', '/b'] }).carpetas, ['/a', '/b']);
    });

    t.test('el curso se recorta pero no se pierde', () => {
        t.eq(ajustes.sanear({ curso: '  React  ' }).curso, 'React');
    });

    t.test('todos los fps de la lista se aceptan', () => {
        for (const f of ajustes.FPS_POSIBLES) {
            t.eq(ajustes.sanear({ fps: f }).fps, f, `${f}`);
        }
    });
};
