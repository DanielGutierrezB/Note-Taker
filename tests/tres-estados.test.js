'use strict';
/**
 * Mantener, Desactivar y Descartar, y el deshacer.
 *
 * Lo que se prueba acá es lo que puede salir mal sin que se note mirando:
 *
 *   · Que Descartar aparezca donde NO se puede deshacer. Ahí no es el mismo
 *     botón aunque se llame igual: una sesión cerrada se relee del archivo en
 *     cada gesto y no tiene pila, así que lo que saca no vuelve.
 *   · Que la pantalla escriba los botones a mano y se separe del control.
 *
 * La pantalla se comprueba contra el texto del archivo y no contra el DOM
 * porque toca `document` al importarse. `estados-toma.js` no: ese se importa
 * y se le mira lo que devuelve.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

module.exports = async t => {
    const control = await import(pathToFileURL(
        path.join(RAIZ, 'src', 'js', 'grabar', 'estados-toma.js')).href);
    const laClase = () => leer('src', 'js', 'pantalla-vivo.js');

    t.group('los tres estados · el control');

    t.test('los tres botones, cada uno con su toma', () => {
        const html = control.estadosDe({ id: 7, descartada: false });
        for (const hace of ['mantener', 'desactivar', 'descartar']) {
            t.ok(html.includes(`data-hace="${hace}" data-toma="7"`), `está ${hace}, y es de la 7`);
        }
    });

    t.test('marca el estado en el que está, y solo uno', () => {
        const viva = control.estadosDe({ id: 1, descartada: false });
        t.ok(/data-hace="mantener"[^>]*aria-pressed="true"/s.test(viva), 'una que cuenta: Mantener');
        t.ok(/data-hace="desactivar"[^>]*aria-pressed="false"/s.test(viva), 'y Desactivar suelto');

        const fuera = control.estadosDe({ id: 1, descartada: true });
        t.ok(/data-hace="mantener"[^>]*aria-pressed="false"/s.test(fuera), 'una desactivada: al revés');
        t.ok(/data-hace="desactivar"[^>]*aria-pressed="true"/s.test(fuera));
    });

    t.test('sin deshacer no hay Descartar', () => {
        // Es la regla entera: Descartar no pregunta, y lo que lo hace seguro es
        // ⌘Z. Donde no hay ⌘Z es otro botón.
        const html = control.estadosDe({ id: 3 }, { sePuedeDeshacer: false });
        t.ok(html.includes('data-hace="mantener"') && html.includes('data-hace="desactivar"'),
            'quedan los dos que se desandan apretando el otro');
        t.ok(!html.includes('data-hace="descartar"'), 'y Descartar no está');
    });

    t.test('dice adónde va la toma: al XML, que es lo que se abre en Premiere', () => {
        t.ok(control.estadosDe({ id: 1 }).includes('title="Va al XML"'));
    });

    t.group('los tres estados · la pantalla de clase');

    t.test('no se quedó con su propia copia de los botones', () => {
        const codigo = laClase();
        t.ok(/import \* as estadosToma from '\.\/grabar\/estados-toma\.js'/.test(codigo), 'importa el control');
        t.ok(!/data-hace="desactivar"/.test(codigo), 'y no escribe los botones a mano');
    });

    t.test('una clase cerrada no ofrece Descartar, que antes daba error', () => {
        t.ok(/estadosToma\.estadosDe\(t, \{ sePuedeDeshacer: !esDeMirar\(\) \}\)/.test(laClase()));
    });

    t.test('los tres botones piden lo que el motor entiende', () => {
        // El vocabulario del motor es la trampa: su `descartar` es Desactivar,
        // y Descartar es su `eliminar`.
        t.deep(control.cambioDe('mantener'), { tipo: 'descartar', descartada: false }, 'Mantener la vuelve a meter');
        t.deep(control.cambioDe('desactivar'), { tipo: 'descartar', descartada: true },
            'Desactivar la deja fuera, en la sesión');
        t.deep(control.cambioDe('descartar'), { tipo: 'eliminar' }, 'y Descartar la saca');
        t.eq(control.cambioDe('otra-cosa'), null);
        t.ok(/estadosToma\.cambioDe\(boton\.dataset\.hace\)/.test(laClase()), 'y la pantalla lo pregunta ahí');
    });

    t.test('el botón dice qué va a deshacer, o que no hay nada', async () => {
        if (!globalThis.document) globalThis.document = { querySelector: () => null };
        const historia = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'historia.js')).href);
        t.eq(historia.tituloDe(true, 'mover el IN', 'Deshacer'), 'Deshacer «mover el IN»',
            'el título lleva el nombre del paso');
        t.eq(historia.tituloDe(false, '', 'Rehacer'), 'No hay nada que rehacer');
        t.ok(/historia\.tituloDe\(hay, que, verbo\)/.test(laClase()), 'y la pantalla lo usa');
    });
};
