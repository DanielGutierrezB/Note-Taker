'use strict';
/**
 * El clic derecho sobre una palabra: poner ahí el IN o el OUT.
 *
 * Lo que se prueba es QUÉ se ofrece y CON QUÉ TIEMPO, que es todo lo que puede
 * salir mal sin que se note mirando:
 *
 *   · Una opción que no debería estar deja una toma imposible o un paso de
 *     deshacer que no deshace nada.
 *   · Un `ms` corrido en una palabra deja el corte en el sitio equivocado, y eso
 *     se descubre en el XML, después de la clase.
 *
 * Las reglas son las mismas del arrastre a propósito (`malParada` y `soltar` en
 * el mismo archivo): las dos maneras de mover un borde tienen que ofrecer lo
 * mismo y pedirle al motor lo mismo. Acá se comprueba contra las tres formas de
 * transcript que la pantalla dibuja de verdad, que se arman con `textoDe` y no a
 * mano para que la prueba no se quede con una estructura que ya cambió.
 *
 * El DOM de juguete está en `fixtures/dom.js`, compartido con las pruebas del
 * transcript que crece: las dos preguntan por el mismo transcript.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const dom = require('./fixtures/dom');

const RAIZ = path.join(__dirname, '..');

/** Palabras cada 400 ms, como en el resto de las pruebas del transcript. */
function palabras(texto, desde) {
    return texto.split(' ').map((w, i) => ({
        t: (desde == null ? 10000 : desde) + i * 400,
        hasta: (desde == null ? 10000 : desde) + i * 400 + 380,
        texto: w
    }));
}

module.exports = async t => {
    dom.fingir();
    const texto = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js')).href);

    /** El transcript como lo arma la pantalla, y sus palabras por texto. */
    const armar = p => {
        const el = texto.textoDe(p, () => {});
        const ws = el.todos().filter(n => n.clases.has('palabra'));
        return { el, ws, de: w => ws.find(n => n.textContent === w) };
    };
    /** Lo que el menú ofrecería sobre una palabra, corto de leer. */
    const sobre = (tr, w) => texto.bordesQuePuede(tr.el, tr.de(w))
        .map(o => `${o.borde}@${o.ms}`).join(' ');

    t.group('clic derecho · el campo de espera, sin toma abierta');

    t.test('cualquier palabra abre la toma, y ninguna ofrece OUT', () => {
        // Modo `inactiva`: el IN espera al final de lo oído y no hay OUT.
        const tr = armar({ modo: 'inactiva', palabras: palabras('entonces arrancamos tres dos uno') });
        t.eq(sobre(tr, 'entonces'), 'in@10000', 'la primera abre la toma en ella misma');
        t.eq(sobre(tr, 'uno'), 'in@11600', 'la última también, y con su propio tiempo');
        t.eq(texto.bordesQuePuede(tr.el, tr.de('tres')).length, 1, 'una sola opción: no hay OUT que mover');
    });

    t.group('clic derecho · una toma abierta');

    t.test('el IN se mueve hacia atrás y hacia adelante, y el OUT la cierra', () => {
        const tr = armar({
            modo: 'abierta',
            antes: palabras('ah bueno', 9000),
            palabras: palabras('el teorema de pitágoras dice')
        });
        t.eq(sobre(tr, 'ah'), 'in@9000', 'una palabra de lo gris de antes entra a la toma');
        // «de» es 10800 y «pitágoras» 11200: el IN se pone en la palabra y el OUT
        // en la siguiente, que es la pared donde apoya.
        t.eq(sobre(tr, 'de'), 'in@10800 out@11200',
            'una del medio puede las dos: el IN en ella, el OUT detrás');
    });

    t.test('sobre la palabra donde el borde ya está, ese borde no se ofrece', () => {
        // Es lo que dejaría un paso de deshacer que no deshace nada.
        const tr = armar({ modo: 'abierta', antes: palabras('ah', 9000), palabras: palabras('el teorema dice') });
        t.eq(sobre(tr, 'el'), 'out@10400', 'el IN ya está delante de «el»: solo queda el OUT');
    });

    t.test('sobre la última palabra oída no se ofrece cerrar', () => {
        // El OUT apoya en la palabra siguiente y no hay ninguna. Cerrar en lo
        // último dicho es el botón primario, que no necesita pared.
        const tr = armar({ modo: 'abierta', antes: palabras('ah', 9000), palabras: palabras('el teorema dice') });
        t.eq(sobre(tr, 'dice'), 'in@10800', 'la última solo puede mover el IN');
    });

    t.test('una toma de una palabra sola es legal, igual que arrastrando', () => {
        // `malParada` pide al menos UNA palabra entre las dos líneas, no dos.
        const tr = armar({ modo: 'abierta', antes: palabras('ah', 9000), palabras: palabras('uno dos tres') });
        t.ok(/out@/.test(sobre(tr, 'uno')), 'el OUT puede ir justo detrás de la primera');
    });

    t.group('clic derecho · una toma cerrada');

    t.test('los dos bordes se mueven, y ninguno cruza al otro', () => {
        const tr = armar({
            modo: 'cerrada',
            antes: palabras('ya', 9000),
            palabras: palabras('el teorema de pitágoras'),
            despues: palabras('pausa che', 12000)
        });
        t.eq(sobre(tr, 'ya'), 'in@9000', 'lo de antes del IN solo puede moverlo a él');
        t.eq(sobre(tr, 'pausa'), 'out@12400', 'lo de después del OUT solo puede moverlo a él');
        t.eq(sobre(tr, 'teorema'), 'in@10400 out@10800', 'lo de adentro puede los dos');
        // La última palabra dibujada no tiene pared detrás, y estirar el OUT
        // hasta ella no se puede ni arrastrando. Es el mismo límite.
        t.eq(sobre(tr, 'che'), '', 'sobre la última de todo no se ofrece nada');
    });

    t.test('el OUT apoya en la palabra siguiente, aunque esté del otro lado', () => {
        const tr = armar({
            modo: 'cerrada',
            palabras: palabras('el teorema'),
            despues: palabras('pausa che', 12000)
        });
        // «teorema» es ya la última de la toma: ahí el OUT no se mueve. Y en
        // «pausa» el OUT tiene que apoyar en «che», que está fuera de la toma.
        t.eq(sobre(tr, 'teorema'), 'in@10400', 'donde el OUT ya está, no se ofrece');
        t.eq(sobre(tr, 'pausa'), 'out@12400', 'estirar la toma una palabra apoya en la que sigue');
    });

    t.group('clic derecho · el camino y el menú del sistema');

    t.test('las dos maneras de mover un borde terminan en la misma llamada', () => {
        // Si el menú llamara al motor por su cuenta, el deshacer por campo vería
        // dos cosas distintas para el mismo cambio.
        const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        t.eq((codigo.match(/ponerBorde\(/g) || []).length, 3,
            'una definición y dos usos: el arrastre y el menú');
        t.ok(/case 'borde-aqui':[\s\S]{0,400}await ponerBorde\(/.test(codigo),
            'el menú no habla con el motor: pasa por ponerBorde');
        t.ok(/function ponerBorde[\s\S]{0,700}grabarCerrarToma[\s\S]{0,200}tipo: 'borde'/.test(codigo),
            'ponerBorde es el único que reparte entre abrir, cerrar y mover');
    });

    t.test('el menú del sistema no sale encima', () => {
        const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        t.ok(/function alClicDerecho[\s\S]{0,900}e\.preventDefault\(\)/.test(codigo),
            'el contextmenu se cancela antes de abrir el nuestro');
        const main = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
        t.ok(!/context-menu/.test(main), 'Electron no tiene ningún menú propio que competir');
    });

    t.test('seleccionar de corrido sigue siendo comentar, y el derecho no', () => {
        const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        const cuerpo = codigo.slice(codigo.indexOf('function alSeleccionar(e)'),
            codigo.indexOf('\n}', codigo.indexOf('function alSeleccionar(e)')));
        t.ok(/e\.button !== 0/.test(cuerpo), 'el botón derecho no abre el campo de comentario');
        t.ok(/comentando/.test(cuerpo), 'y con el principal sigue abriéndolo');
    });

    t.test('el menú vive fuera de la tarjeta que se rehace cada segundo', () => {
        const html = fs.readFileSync(path.join(RAIZ, 'src', 'index.html'), 'utf8');
        const menu = html.indexOf('id="menu-palabra"');
        t.ok(menu > html.indexOf('</main>'), 'está afuera de la pantalla, con los telones');
        const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        t.ok(/pulsando \|\| componiendo \|\| menuPalabra/.test(codigo),
            'y con el menú abierto el texto de debajo no se repinta');
    });
};
