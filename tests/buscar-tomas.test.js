'use strict';
/**
 * Buscar en las tomas (`src/js/grabar/buscar-tomas.js`): una sola regla para
 * filtrar la lista, contar las veces y marcar la frase de la fila.
 *
 *   · Una frase con un signo en el medio se encuentra igual.
 *   · Sin tildes para buscar, y lo hallado se marca aunque tenga tilde.
 *   · Lo que filtra la lista es lo mismo que ▲ ▼ recorren.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'grabar', 'buscar-tomas.js')).href);

function toma(id, dicho, extra) {
    return {
        id,
        palabras: dicho.split(' ').map((texto, i) => ({ t: id * 1000 + i, texto })),
        ...(extra || {})
    };
}

const marcado = f => f.partes.filter(p => p.marca).map(p => p.texto).join(' ');

module.exports = function (t) {
    t.group('buscar en las tomas · una sola regla');

    t.test('menos de dos letras no es buscar', async () => {
        const b = await cargar();
        t.eq(b.consulta('a'), null);
        t.eq(b.consulta('   '), null);
        t.ok(b.consulta('la'));
    });

    t.test('una frase con una coma en el medio se encuentra, y ▲ ▼ llegan a ella', async () => {
        const b = await cargar();
        const q = b.consulta('hola mundo');
        const t1 = toma(1, 'y entonces hola, mundo como siempre');
        t.ok(b.coincide(t1, q), 'la lista la deja');
        t.eq(b.ocurrencias([t1], q).length, 1, 'y se cuenta');
    });

    t.test('sin tildes se encuentra con tilde, y se marca', async () => {
        const b = await cargar();
        const q = b.consulta('accion');
        const t1 = toma(2, 'el disparador y la acción del flujo');
        t.ok(b.coincide(t1, q));
        t.eq(marcado(b.fraseConLoBuscado(t1, q)), 'acción', 'la fila la marca tal como se dijo');
    });

    t.test('en la nota y en los comentarios también, y la fila muestra esa', async () => {
        const b = await cargar();
        const q = b.consulta('repetir');
        const conNota = toma(3, 'lo que se dijo', { comentario: 'Repetir el final' });
        const conComentario = toma(4, 'lo que se dijo', { comentarios: [{ texto: 'un pedazo', comentario: 'hay que repetir esto' }] });
        t.ok(b.coincide(conNota, q));
        t.ok(b.coincide(conComentario, q));
        t.eq(marcado(b.fraseConLoBuscado(conNota, q)), 'Repetir');
        t.eq(b.ocurrencias([conNota, conComentario], q).length, 0, 'las veces son solo de lo dicho, que es lo que se marca en el texto');
    });

    t.test('el número de la toma la encuentra', async () => {
        const b = await cargar();
        t.ok(b.coincide(toma(12, 'nada que ver'), b.consulta('12')));
    });

    t.test('una palabra sola vale adentro de otra; en una frase, la última a medio escribir', async () => {
        const b = await cargar();
        const t1 = toma(5, 'los idiomas de la clase');
        t.ok(b.coincide(t1, b.consulta('idioma')));
        t.ok(b.coincide(t1, b.consulta('idiomas de la cl')));
        t.ok(!b.coincide(t1, b.consulta('idiomas cl')), 'las del medio, enteras y en orden');
    });

    t.test('cada vez trae los instantes de sus palabras, que es como el texto las reconoce', async () => {
        const b = await cargar();
        const q = b.consulta('la clase');
        const lista = b.ocurrencias([toma(6, 'la clase y otra vez la clase')], q);
        t.deep(lista.map(o => o.ts), [['6000', '6001'], ['6005', '6006']]);
    });

    t.test('la frase de una toma larga empieza un poco antes de lo hallado', async () => {
        const b = await cargar();
        const relleno = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ');
        const t1 = toma(7, `${relleno} acá viene lo buscado y sigue`);
        const f = b.fraseConLoBuscado(t1, b.consulta('lo buscado'));
        t.ok(f.cortada, 'se dice que está cortada');
        t.eq(marcado(f), 'lo buscado');
        t.eq(f.partes[0].texto, 'palabra37');
    });
};
