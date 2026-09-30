'use strict';
/**
 * Dónde vive cada disparador de la pantalla En vivo.
 *
 * Se prueba sobre el código de la ventana, como en `turnos.test.js`: acá no hay
 * DOM, pero sí se puede decir en qué pedazo del HTML está declarado un botón y
 * en qué pedazo del JS se dibuja. Lo que mira esto es que el botón de Claqueta
 * esté en la barra —global, con los controles— y NO en la fila de la toma, que
 * es donde el editor lo apretaba por error queriendo cerrarla, y que los tres
 * caminos (el botón, el atajo de la tira y la tecla K) le pidan lo mismo al
 * motor en vez de tener cada uno su lógica.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/** El pedazo de `código` entre `desde` y `hasta`, para preguntarle qué hay adentro. */
function tramo(codigo, desde, hasta) {
    const a = codigo.indexOf(desde);
    if (a === -1) return '';
    const b = codigo.indexOf(hasta, a + desde.length);
    return codigo.slice(a, b === -1 ? codigo.length : b);
}

module.exports = function (t) {
    const html = leer('src', 'index.html');
    const js = leer('src', 'js', 'pantalla-vivo.js');
    const barra = tramo(html, '<div class="barra-arriba">', '<div class="atajos"');
    const atajos = tramo(html, '<div class="atajos" id="vivo-atajos">', '</div>\n    </div>');
    const tarjeta = tramo(js, 'function ahora(fps) {', '\n}\n');

    t.group('en vivo · la claqueta es global');

    t.test('el botón está en la barra, con los demás controles', () => {
        t.ok(/id="btn-claqueta"/.test(barra), 'está declarado en la fila de arriba');
        t.ok(/data-hace="claqueta"/.test(barra), 'y pide la misma acción que el atajo');
    });

    t.test('la tarjeta de «Ahora» no dibuja ninguno', () => {
        // Es la fila de la toma abierta: al lado de «Cerrar toma» se apretaba
        // sin querer, y una claqueta de más hay que ir a quitarla a la lista.
        t.ok(tarjeta.length > 0, 'se encontró la tarjeta');
        t.ok(!/data-hace="claqueta"/.test(tarjeta), 'ni con toma abierta ni sin ella');
    });

    t.test('la tecla K sigue escrita en la tira de atajos', () => {
        t.ok(/data-hace="claqueta"/.test(atajos));
        t.ok(/<kbd>K<\/kbd>/.test(atajos));
    });

    t.group('en vivo · los tres caminos le piden lo mismo al motor');

    t.test('el clic de la barra pasa por `alClic`', () => {
        // Sin esta escucha el botón queda dibujado y muerto: `data-hace` solo
        // hace algo en las tres zonas que tienen el manejador.
        t.ok(/\$\('\.barra-arriba'\)\.addEventListener\('click', alClic\)/.test(js));
    });

    t.test('`alClic` y la tecla K llaman a `grabarClaqueta`, y nadie más', () => {
        t.ok(/case 'claqueta': await pedir\(\(\) => window\.nt\.grabarClaqueta\(\)\)/.test(js));
        t.ok(/tecla === 'k'/.test(js), 'la tecla sigue siendo la K');
        const llamadas = [...js.matchAll(/window\.nt\.grabarClaqueta\(/g)].length;
        t.eq(llamadas, 2, 'una por el clic y una por la tecla: nada duplicado');
    });
};
