'use strict';
/**
 * El transcript que crece sin moverse.
 *
 * El editor, después de la clase de 2 h 05 del 30/09: «Cuando se va a
 * escribiendo el transcript el texto en la ventana del transcript va saltando,
 * esto pasa más cuando se resume ya cuando está muy largo. Creo que debería no
 * moverse en lo posible, para que pueda seleccionar fácilmente mientras se está
 * grabando.»
 *
 * Medido en la maqueta con la toma más larga de esa clase (1950 palabras): el
 * salto era de 24 px —un renglón justo, 13 px por 1,8 de interlineado— cada vez
 * que la ventana de las últimas 300 palabras dejaba caer un renglón por atrás.
 * Con 120 palabras no saltaba nunca, que es por qué solo se notaba en las tomas
 * largas.
 *
 * Acá se prueba la pieza de la que depende que no salte: que `textoDe`, cuando
 * lo único nuevo son palabras al final, AGREGUE al transcript que ya está en
 * pantalla en vez de hacer otro. Lo que importa de verdad son dos cosas:
 *
 *   · que los nodos de arriba sean LOS MISMOS objetos —de eso vive la selección
 *     del sistema, que es lo que el editor quiere poder hacer—, y
 *   · que lo que queda después de crecer sea IDÉNTICO a dibujarlo de cero. Es la
 *     prueba que protege de verdad: un camino rápido que dibuja distinto del
 *     lento es peor que no tenerlo, porque miente sin avisar.
 *
 * Y que se niegue a crecer cuando el texto de arriba SÍ cambió, que es cuando
 * taparlo sería mentir.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
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

/** Una tirada larga de habla con sus señales donde caen. */
function clase(cuantas) {
    const molde = ('el teorema de pitágoras dice que la suma de los cuadrados de los catetos '
        + 'es igual al cuadrado de la hipotenusa y eso vale para cualquier triángulo').split(' ');
    const ws = [];
    for (let i = 0; i < cuantas; i++) {
        ws.push({ t: 10000 + i * 400, hasta: 10000 + i * 400 + 380, texto: molde[i % molde.length] });
    }
    return ws;
}

module.exports = async t => {
    dom.fingir();
    const texto = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js')).href);
    const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

    /** Lo dibujado, nodo por nodo, para comparar dos transcripts enteros. */
    const foto = el => el.children
        .map(h => `${h.className}|${h.dataset.senal || ''}|${h.dataset.t || ''}|${h.textContent}`);

    t.group('transcript que crece · agrega en vez de rehacer');

    t.test('las palabras nuevas no tocan ni un nodo de los de arriba', () => {
        const ws = clase(60);
        const a = texto.textoDe({ modo: 'abierta', antes: [], palabras: ws.slice(0, 50), vacio: 'nada' });
        const antes = a.children.filter(h => h.clases.has('palabra'));
        const b = texto.textoDe({ modo: 'abierta', antes: [], palabras: ws, vacio: 'nada' }, null, a);
        t.eq(b, a, 'es el mismo elemento, no uno nuevo');
        const despues = b.children.filter(h => h.clases.has('palabra'));
        t.eq(despues.length, 60, 'están las sesenta');
        // Lo que hace que la selección del sistema sobreviva: los nodos de las
        // primeras cincuenta son los MISMOS objetos, no copias iguales.
        t.ok(antes.every((w, i) => despues[i] === w), 'las cincuenta de antes son los mismos objetos');
    });

    t.test('crecer deja exactamente lo mismo que dibujar de cero', () => {
        // La prueba que importa: si este camino dibujara distinto del normal,
        // el transcript se iría separando de la verdad sin que nada avise.
        const ws = clase(400);
        let vivo = texto.textoDe({ modo: 'abierta', antes: palabras('ah bueno', 9000), palabras: ws.slice(0, 40) });
        for (let n = 41; n <= 400; n++) {
            const otra = texto.textoDe(
                { modo: 'abierta', antes: palabras('ah bueno', 9000), palabras: ws.slice(0, n) }, null, vivo);
            t.eq(otra, vivo, `creció en la palabra ${n}`);
        }
        const decero = texto.textoDe({ modo: 'abierta', antes: palabras('ah bueno', 9000), palabras: ws });
        t.deep(foto(vivo), foto(decero), 'el crecido y el nuevo son el mismo dibujo');
    });

    t.test('las señales del final se corrigen al llegar la palabra que sigue', () => {
        // Una «Pausa» no se sabe si cerró hasta que llega la de después, así que
        // la palabra ya dibujada tiene que cambiar de marca sola.
        const ws = palabras('bueno pausa').concat([{ t: 40000, hasta: 40380, texto: 'seguimos' }]);
        const vivo = texto.textoDe({ modo: 'abierta', antes: [], palabras: ws.slice(0, 2) });
        const marcada = () => vivo.children.filter(h => h.clases.has('palabra'))
            .map(h => `${h.textContent}:${h.dataset.senal || '-'}`).join(' ');
        const conPausa = marcada();
        texto.textoDe({ modo: 'abierta', antes: [], palabras: ws }, null, vivo);
        t.ok(/pausa:/.test(conPausa), 'la «pausa» estaba marcada');
        t.deep(foto(vivo), foto(texto.textoDe({ modo: 'abierta', antes: [], palabras: ws })),
            'y después de crecer dice lo mismo que un dibujo nuevo');
    });

    t.test('el modo inactiva mete lo nuevo antes del IN, que espera al final', () => {
        const ws = clase(20);
        const a = texto.textoDe({ modo: 'inactiva', palabras: ws.slice(0, 15) });
        const b = texto.textoDe({ modo: 'inactiva', palabras: ws }, null, a);
        t.eq(b, a, 'creció');
        t.deep(foto(b), foto(texto.textoDe({ modo: 'inactiva', palabras: ws })),
            'con el IN todavía al final y todo lo oído en gris');
        t.ok(b.children.filter(h => h.clases.has('palabra')).every(w => w.clases.has('es-orilla')),
            'lo nuevo también queda gris: está fuera de los bordes');
    });

    t.group('transcript que crece · cuándo se niega');

    t.test('si el modelo grande reescribe una palabra de atrás, se dibuja de nuevo', () => {
        // La relectura cambia el texto de arriba. Taparlo dejaría en pantalla
        // palabras que el motor ya no tiene.
        const ws = clase(50);
        const a = texto.textoDe({ modo: 'abierta', palabras: ws });
        const corregidas = ws.map((w, i) => (i === 10 ? { ...w, texto: 'Pitágoras' } : w));
        const b = texto.textoDe({ modo: 'abierta', palabras: corregidas.concat(clase(51).slice(50)) }, null, a);
        t.ok(b !== a, 'es un transcript nuevo');
        t.eq(b.children.filter(h => h.textContent === 'Pitágoras').length, 1, 'y trae la corrección');
    });

    t.test('si se movió un borde, se dibuja de nuevo', () => {
        const ws = clase(50);
        const a = texto.textoDe({ modo: 'abierta', antes: palabras('ah bueno', 9000), palabras: ws });
        const b = texto.textoDe({ modo: 'abierta', antes: palabras('ah', 9000), palabras: ws }, null, a);
        t.ok(b !== a, 'el IN se corrió una palabra: el gris de antes cambió');
    });

    t.test('si apareció un comentario, se dibuja de nuevo', () => {
        // El subrayado cae sobre palabras que ya estaban dibujadas.
        const ws = clase(50);
        const a = texto.textoDe({ modo: 'abierta', palabras: ws, comentarios: [] });
        const b = texto.textoDe({ modo: 'abierta', palabras: ws, comentarios: [{ desdeMs: 10000, hastaMs: 12000 }] }, null, a);
        t.ok(b !== a, 'es nuevo');
        t.ok(b.children.some(h => h.clases.has('es-comentada')), 'y el subrayado está');
    });

    t.test('la primera palabra de la toma saca el «todavía no se oyó nada»', () => {
        const a = texto.textoDe({ modo: 'abierta', palabras: [], vacio: 'Todavía no se oyó nada de esta toma.' });
        t.ok(a.querySelector('.transcript-vacio'), 'el aviso está');
        const b = texto.textoDe({ modo: 'abierta', palabras: clase(3), vacio: 'Todavía no se oyó nada de esta toma.' }, null, a);
        t.ok(b !== a, 'se dibuja de nuevo, que pasa una sola vez por toma');
        t.ok(!b.querySelector('.transcript-vacio'), 'y el aviso ya no está');
    });

    t.test('un transcript que nadie dibujó con `textoDe` no crece', () => {
        // Por ejemplo el que se quedó intacto a mitad de un arrastre y volvió a
        // entrar por otro camino: sin huella no se sabe qué tiene dentro.
        const ajeno = document.createElement('div');
        const b = texto.textoDe({ modo: 'abierta', palabras: clase(5) }, null, ajeno);
        t.ok(b !== ajeno, 'no se le toca nada');
    });

    t.group('transcript que crece · la pantalla');

    t.test('la toma abierta se dibuja entera, sin la ventana que la hacía saltar', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(!/recortarAbierta/.test(codigo), 'el recorte deslizante ya no existe');
        t.ok(/modo: 'abierta',[\s\S]{0,200}palabras: toma\.palabras,/.test(codigo),
            'la abierta recibe todas sus palabras');
    });

    t.test('el repintado le pasa a `textoDe` el transcript que ya estaba', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        t.eq((codigo.match(/\}, soltar, previo\)\)/g) || []).length, 3,
            'los tres textos —espera, abierta y cerrada— pueden crecer');
        t.ok(/const previo = previos\.get\(clave\);/.test(codigo), 'y el previo sale del DOM de antes');
    });

    t.test('el que se está arrastrando no crece: se queda intacto', () => {
        // A mitad de un arrastre la línea ya se movió en pantalla y el motor no
        // lo sabe, así que lo dibujado no coincide con lo que se le pasaría.
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/if \(intactos\.has\(clave\) && previos\.has\(clave\)\)/.test(codigo),
            'el intacto se repone tal cual, antes de pensar en crecer');
        const crecer = leer('src', 'js', 'grabar', 'texto-toma.js');
        t.ok(/if \(agarrado === previo\) return false;/.test(crecer),
            'y `crecer` tampoco toca el que tiene la línea agarrada');
    });

    t.test('la selección se guarda y se devuelve alrededor del repintado', () => {
        // Creciendo, los nodos sobreviven; lo que borra la selección es que
        // `#ahora` se vacíe un momento. Por eso se anota el rango y se repone.
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf('const rollos = recordarRollos();'),
            codigo.indexOf('devolverFoco(foco);'));
        t.ok(cuerpo.indexOf('recordarSeleccion()') < cuerpo.indexOf("$('#ahora').innerHTML"),
            'se anota antes de vaciar la tarjeta');
        t.ok(cuerpo.indexOf('devolverSeleccion(') > cuerpo.indexOf('montarTextos('),
            'y se devuelve después de montar los textos');
        t.ok(/if \(!g \|\| !document\.contains\(g\.a\) \|\| !document\.contains\(g\.b\)\) return;/.test(codigo),
            'si el texto se rehizo, los extremos ya no están y no se devuelve nada');
    });
};
