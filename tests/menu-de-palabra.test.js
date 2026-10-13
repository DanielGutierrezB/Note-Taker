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

    const elModulo = () => fs.readFileSync(
        path.join(RAIZ, 'src', 'js', 'grabar', 'menu-de-palabra.js'), 'utf8');
    const laClase = () => fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
    const laSemana = () => fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-semanal.js'), 'utf8');

    t.test('las dos maneras de mover un borde terminan en la misma llamada', () => {
        // Si el menú llamara al motor por su cuenta, el deshacer por campo vería
        // dos cosas distintas para el mismo cambio. Vale en las dos pantallas:
        // cada una tiene su `ponerBorde` porque le pide a motores distintos
        // —una clase en curso y un vídeo de la semana no se editan igual—, pero
        // dentro de cada una hay una sola puerta.
        for (const [quien, codigo] of [['clase', laClase()], ['semana', laSemana()]]) {
            t.ok(/function ponerBorde\(cual, tomaId, borde, ms\)/.test(codigo),
                `${quien}: la puerta existe y recibe lo mismo`);
            t.ok(/alElegir: q => ponerBorde\(q\.cual, q\.toma, q\.borde, q\.ms\)/.test(codigo),
                `${quien}: el menú no habla con el motor, pasa por ponerBorde`);
            t.ok(/function ponerBorde[\s\S]{0,900}grabarCerrarToma[\s\S]{0,300}tipo: 'borde'/.test(codigo),
                `${quien}: ponerBorde es el único que reparte entre abrir, cerrar y mover`);
        }
        t.ok(/suyo = \(borde, ms\) => ponerBorde\(/.test(laSemana()),
            'y en la semana el arrastre entra por la misma puerta que el menú');
    });

    t.test('el menú del sistema no sale encima', () => {
        t.ok(/function alClicDerecho[\s\S]{0,900}e\.preventDefault\(\)/.test(elModulo()),
            'el contextmenu se cancela antes de abrir el nuestro');
        const main = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
        t.ok(!/context-menu/.test(main), 'Electron no tiene ningún menú propio que competir');
    });

    t.test('el menú es uno solo y lo usan las dos pantallas', () => {
        // Estaba dentro de `pantalla-vivo.js` cuando era de una. Copiarlo en la
        // otra habría dejado dos menús que se separan: el mismo transcript lo
        // dibuja un solo módulo y el menú que abre encima tiene que ser uno.
        for (const [quien, codigo] of [['clase', laClase()], ['semana', laSemana()]]) {
            t.ok(/import \* as menuPalabra from '\.\/grabar\/menu-de-palabra\.js'/.test(codigo),
                `${quien}: lo importa`);
            t.ok(/menuPalabra\.conectar\(\{/.test(codigo), `${quien}: y se conecta`);
        }
        t.ok(!/function comoSeLlama/.test(laClase()) && !/function comoSeLlama/.test(laSemana()),
            'y ninguna se quedó con una copia de los nombres de las opciones');
    });

    t.test('cada pantalla recibe lo de su propio menú y no lo de la otra', () => {
        // Las dos se conectan al arrancar la app, seguidas, y `#menu-palabra` es
        // uno solo en el documento. Con una sola dueña ganaría la última en
        // conectarse y el menú de la semana le pediría el borde a la clase.
        const m = elModulo();
        t.ok(/const dueños = new Map\(\)/.test(m), 'hay un registro y no una dueña sola');
        t.ok(/\[\.\.\.dueños\.values\(\)\]\.find\(d => w\.closest\(d\.raiz\)\)/.test(m),
            'y se enruta por dónde se hizo el clic, que no depende del orden');
        t.ok(/abierto = \{ cual, toma, dueño \}/.test(m),
            'el menú abierto se queda con su dueña, por si la otra pantalla aparece en el medio');
        const app = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'app.js'), 'utf8');
        t.ok(app.indexOf('vivo.conectar(app)') < app.indexOf('semanal.conectar(app)'),
            'las dos se conectan al arrancar: es la situación que esto resuelve');
    });

    t.test('con el menú abierto, debajo no se mueve nada', () => {
        // El menú habla de una palabra: si el texto se rehace, la palabra de la
        // que habla ya no está. En la semana son dos sitios, porque el reloj
        // remonta el transcript aparte del repintado de la tarjeta.
        t.ok(/pulsando \|\| componiendo \|\| menuPalabra\.hay\(\)/.test(laClase()),
            'clase: no repinta');
        const semana = laSemana();
        t.ok(/if \(menuPalabra\.hay\(\)\) \{ pendiente = true; return; \}/.test(semana),
            'semana: no repinta la tarjeta');
        t.ok(/!texto\.arrastrando\(\) && !menuPalabra\.hay\(\)/.test(semana),
            'semana: y tampoco remonta el transcript, que es lo que el reloj hace cada segundo');
        for (const [quien, codigo] of [['clase', laClase()], ['semana', semana]]) {
            t.ok(/alCerrar: \(\) => \{ if \(pendiente\) pintar\(\); \}/.test(codigo),
                `${quien}: y al cerrarlo se pinta lo que esperaba`);
        }
    });

    t.test('el teclado con el menú abierto es del menú, en las dos', () => {
        t.ok(/export function alTeclado[\s\S]{0,400}e\.key === 'Escape'/.test(elModulo()),
            'Escape lo cierra');
        for (const [quien, codigo] of [['clase', laClase()], ['semana', laSemana()]]) {
            t.ok(/if \(menuPalabra\.alTeclado\(e\)\) return;/.test(codigo),
                `${quien}: la pantalla le cede la tecla`);
        }
    });

    t.test('en la semana se puede subir a buscar la palabra', () => {
        // Lo que hace usable el clic derecho: para poner el IN diez frases
        // atrás hay que llegar hasta ellas, y el transcript se iba al fondo una
        // vez por segundo. El que está abajo sigue abajo —lo nuevo entra ahí—,
        // el que alguien movió se queda quieto.
        const subido = { fondo: false, arriba: 120 };
        t.eq(texto.dondeQueda({ rehecho: false, remontado: false, antes: { fondo: true, arriba: 0 } }), 'fondo',
            'el que estaba al fondo sigue al fondo');
        t.eq(texto.dondeQueda({ rehecho: false, remontado: false, antes: subido }), null,
            'el que alguien movió se queda quieto');
        t.eq(texto.dondeQueda({ rehecho: false, remontado: false, antes: undefined }), 'fondo',
            'uno que nadie miró todavía arranca abajo');
        t.eq(texto.dondeQueda({ rehecho: true, remontado: false, antes: subido }), 'fondo',
            'un texto que se rehace entero sí arranca abajo: no hay dónde haber subido');
        const semana = laSemana();
        t.ok(/rollo\.onscroll = \(\) => rollos\.set\(clave, \{ fondo: texto\.estaAlFondo\(rollo\), arriba: rollo\.scrollTop \}\)/
            .test(semana), 'y la pantalla recuerda las dos cosas al moverlo');
        t.ok(/texto\.dondeQueda\(\{ rehecho: nodo !== previo, remontado, antes: rollos\.get\(clave\) \}\)/
            .test(semana), 'y usa la regla');
    });

    t.test('un repintado entero no te tira arriba del todo', () => {
        // Repintar la pantalla saca el texto del DOM y lo vuelve a meter, y eso
        // le borra el scroll. Quien había subido a buscar una palabra aparecía
        // arriba del todo, y ahí se quedaba hasta bajar a mano.
        t.eq(texto.dondeQueda({ rehecho: false, remontado: true, antes: { fondo: false, arriba: 120 } }), 120,
            'vuelve a donde estaba');
    });

    t.test('en la toma abierta solo el OUT la cierra, también en la semana', () => {
        // El menú ofrece «poner el IN acá» sobre cualquier palabra del medio de
        // la toma abierta. Con los dos bordes yendo a `grabarCerrarToma` —que es
        // como estaba— correr el IN la habría cerrado en esa palabra.
        t.eq(texto.queHaceElBorde('abierta', 'out'), 'cerrar', 'el OUT cierra');
        t.eq(texto.queHaceElBorde('abierta', 'in'), 'mover', 'y el IN le corre el principio');
        t.eq(texto.queHaceElBorde('espera', 'in'), 'abrir', 'en espera, el IN la abre');
        t.eq(texto.queHaceElBorde('cerrada', 'in'), 'mover');
        t.eq(texto.queHaceElBorde('cerrada', 'out'), 'mover');
        // Y las dos pantallas lo preguntan ahí en vez de decidirlo cada una.
        for (const [quien, codigo] of [['clase', laClase()], ['semana', laSemana()]]) {
            const puerta = codigo.slice(codigo.indexOf('function ponerBorde(cual, tomaId'));
            t.ok(/switch \(texto\.queHaceElBorde\(cual, borde\)\)/.test(puerta), `${quien}: usa la regla`);
            t.ok(!/cual === 'abierta'/.test(puerta.slice(0, 600)), `${quien}: y no la reescribe`);
        }
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
