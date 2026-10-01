'use strict';
/**
 * Un IN no puede entrar en la toma anterior.
 *
 * El editor, después de la clase del 30/09: «No debería poder colocar un In
 * antes del OUT de la toma anterior. Esto si sucede, solo parece que se demora
 * en cargar lo anterior. Cuando pues es un espacio compartido.»
 *
 * Y sí se podía: `moverInAbierta` escribía el `inMs` que le pasaran y
 * `moverBorde` solo miraba el OUT de la MISMA toma. El resultado es un XML con
 * dos bloques pisados sobre el mismo tramo de clase, con las mismas palabras
 * dentro de los dos.
 *
 * Hay tres caminos que mueven un IN —arrastrar la línea, el menú del clic
 * derecho, y el motor desde una sesión ya grabada— y acá se prueban los tres,
 * porque la regla no sirve si vale en dos de ellos. El motor es la última
 * palabra: la ventana dibuja el tope para que el gesto se frene solo, pero el
 * motor no le cree.
 *
 * Lo último que se prueba es que la ventana y el motor digan lo MISMO sobre cuál
 * es «la toma anterior». Es la regla duplicada a propósito —la ventana corre en
 * otro proceso y no puede preguntarle para dibujar— y se comparan las dos
 * implementaciones toma por toma sobre la clase de verdad del 30/09, que tiene
 * 32 tomas con bordes movidos a mano.
 */

const fs = require('fs');
const path = require('path');

const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const vivo = require('../engine/notas-vivo');
const dom = require('./fixtures/dom');

const T0 = 1700000000000;

/** Una toma cerrada, con sus palabras repartidas como las deja el motor. */
function toma(id, desde, hasta, opciones) {
    const ws = [];
    for (let t = desde; t < hasta; t += 400) ws.push({ t: T0 + t, hasta: T0 + t + 380, texto: `w${t}` });
    return {
        id, vista: 'PV', comentario: '', descartada: false,
        inMs: T0 + desde, outMs: T0 + hasta,
        antes: [], palabras: ws, despues: [], comentarios: [],
        ...(opciones || {})
    };
}

module.exports = async t => {
    t.group('tomas que no se pisan · el motor, que es la última palabra');

    t.test('el IN de la toma abierta se frena en el OUT de la anterior', () => {
        const previa = toma(1, 0, 10000);
        const abierta = { ...toma(2, 12000, 20000), outMs: null };
        const estado = { tomas: [previa, abierta], sueltas: [] };
        // El gesto pide 4 s, que está DENTRO de la toma 1.
        t.ok(vivo.moverInAbierta(estado, abierta, T0 + 4000), 'se movió');
        t.eq(abierta.inMs, T0 + 10000, 'pero hasta el OUT de la toma 1 y no más atrás');
        t.ok(previa.palabras.every(w => w.t < T0 + 10000), 'la toma 1 no perdió ninguna palabra');
    });

    t.test('el IN puesto JUSTO en el OUT anterior es legal: se tocan y no se pisan', () => {
        // El OUT es exclusivo en toda la app (`repartir`), así que la palabra que
        // empieza en el OUT de la 1 ya no es de la 1.
        const abierta = { ...toma(2, 12000, 20000), outMs: null };
        const estado = { tomas: [toma(1, 0, 10000), abierta], sueltas: [] };
        t.ok(vivo.moverInAbierta(estado, abierta, T0 + 10000));
        t.eq(abierta.inMs, T0 + 10000);
    });

    t.test('sin toma anterior el IN retrocede libre, como siempre', () => {
        const abierta = { ...toma(1, 12000, 20000), outMs: null };
        const estado = { tomas: [abierta], sueltas: [] };
        t.ok(vivo.moverInAbierta(estado, abierta, T0 + 3000));
        t.eq(abierta.inMs, T0 + 3000, 'la primera toma de la clase puede ir hasta donde haya audio');
    });

    t.test('una toma DESCARTADA no frena nada: su tramo quedó libre', () => {
        // Es lo que se hace cuando una toma salió mal: se desactiva y se vuelve
        // a grabar el mismo tramo. Si siguiera frenando, el IN de la nueva no
        // podría llegar al principio de lo que hay que rehacer.
        const abierta = { ...toma(2, 12000, 20000), outMs: null };
        const estado = { tomas: [toma(1, 0, 10000, { descartada: true }), abierta], sueltas: [] };
        t.ok(vivo.moverInAbierta(estado, abierta, T0 + 4000));
        t.eq(abierta.inMs, T0 + 4000, 'entra en el tramo de la descartada sin problema');
    });

    t.test('con dos tomas antes, manda la que termina más tarde', () => {
        // Y no la última de la lista: los bordes se mueven a mano, así que el
        // orden en que se abrieron no es el orden en el tiempo.
        const abierta = { ...toma(3, 30000, 40000), outMs: null };
        const estado = { tomas: [toma(1, 20000, 25000), toma(2, 0, 10000), abierta], sueltas: [] };
        vivo.moverInAbierta(estado, abierta, T0 + 1000);
        t.eq(abierta.inMs, T0 + 25000, 'se frena en el OUT de la 1, que es la de verdad anterior');
    });

    t.test('el IN de una toma CERRADA también se frena', () => {
        const media = toma(2, 12000, 20000);
        const tomas = [toma(1, 0, 10000), media];
        t.eq(vivo.moverBorde(media, 'in', T0 + 4000, tomas), true);
        t.eq(media.inMs, T0 + 10000, 'hasta el OUT de la 1');
    });

    t.test('y pedir el IN donde ya está no cuenta como movimiento', () => {
        // Si contara, dejaría un paso de deshacer que no deshace nada y una
        // relectura de dos segundos de GPU para no cambiar la toma.
        const media = toma(2, 10000, 20000);
        t.eq(vivo.moverBorde(media, 'in', T0 + 4000, [toma(1, 0, 10000), media]), false,
            'el tope cae justo donde el IN ya estaba: no se mueve');
    });

    t.test('el OUT no se frena con esto: lo suyo es no cruzar su propio IN', () => {
        // El tope es del IN y solo del IN. El OUT de una toma puede ir hasta
        // donde haya texto, y hacia atrás se frena en su propio IN como siempre.
        const previa = toma(1, 0, 10000);
        const media = toma(2, 12000, 20000);
        t.eq(vivo.moverBorde(media, 'out', T0 + 14000, [previa, media]), true, 'se acorta');
        t.eq(media.outMs, T0 + 14000);
        t.eq(vivo.moverBorde(media, 'out', T0 + 12000, [previa, media]), false,
            'pero no hasta su propio IN: una toma necesita al menos una palabra');
    });

    t.group('tomas que no se pisan · una sesión ya grabada');

    t.test('arrastrar el IN de una toma vieja tampoco la mete en la anterior', () => {
        // Por acá pasa «ajustar una nota desde ahí» de una clase terminada: el
        // mismo gesto tiene que dar el mismo XML que daría en vivo.
        const previa = toma(1, 0, 10000);
        const media = toma(2, 12000, 24000);
        // Las orillas guardadas llegan más atrás que el OUT de la 1, que es
        // justamente lo que dejaba meter el borde donde no va.
        media.antes = [];
        for (let x = 4000; x < 12000; x += 400) media.antes.push({ t: T0 + x, hasta: T0 + x + 380, texto: `o${x}` });
        vivo.aplicar(media, { tipo: 'borde', borde: 'in', paredMs: T0 + 5200 }, [previa, media]);
        t.eq(media.inMs, T0 + 10000, 'el IN quedó en el OUT de la toma 1');
        t.ok(media.antes.every(w => w.t < T0 + 10000), 'y lo de antes del IN sigue siendo orilla');
        t.ok(media.palabras.every(w => w.t >= T0 + 10000), 'las palabras de la toma empiezan en el tope');
    });

    t.test('sin las tomas, `aplicar` no se inventa un tope', () => {
        // Es a propósito: así se ve en la prueba de abajo que los dos caminos de
        // verdad SÍ las pasan, en vez de que un `undefined` pase inadvertido.
        const media = toma(2, 12000, 24000);
        for (let x = 4000; x < 12000; x += 400) media.antes.push({ t: T0 + x, hasta: T0 + x + 380, texto: `o${x}` });
        vivo.aplicar(media, { tipo: 'borde', borde: 'in', paredMs: T0 + 5200 });
        t.eq(media.inMs, T0 + 5200);
    });

    t.test('los dos caminos del motor le pasan las tomas', () => {
        const cambios = fs.readFileSync(path.join(RAIZ, 'engine', 'cambios-toma.js'), 'utf8');
        const grabadas = fs.readFileSync(path.join(RAIZ, 'engine', 'sesiones-grabadas.js'), 'utf8');
        t.ok(/vivo\.aplicar\(toma, c, sesion\.estado\.tomas\)/.test(cambios), 'la clase en curso');
        t.ok(/vivo\.moverBorde\(toma, c\.borde, Number\(c\.paredMs\), sesion\.estado\.tomas\)/.test(cambios),
            'y su camino de toma cerrada');
        t.ok(/vivo\.aplicar\(toma, c, estado\.tomas\)/.test(grabadas), 'la clase ya grabada');
    });

    t.group('tomas que no se pisan · la ventana, que lo dibuja');

    t.test('la marca de la toma anterior es la pared del arrastre y del menú', async () => {
        dom.fingir();
        const texto = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js')).href);
        const ajena = n => ({ t: T0 + n, hasta: T0 + n + 380, texto: `v${n}`, de: { id: 1 } });
        const libre = n => ({ t: T0 + n, hasta: T0 + n + 380, texto: `l${n}` });
        const tr = texto.textoDe({
            modo: 'abierta',
            antes: [ajena(1000), ajena(1400), libre(2000), libre(2400)],
            limite: { toma: 1, ms: T0 + 1800, color: '#718637', tinta: '#ffffff' },
            palabras: [libre(3000), libre(3400), libre(3800)]
        }, () => {});

        const marca = tr.querySelector('.transcript-limite');
        t.ok(marca, 'la marca está');
        t.ok(/fin de la toma 1/.test(marca.textContent), 'y dice de qué toma, con letras y no solo con color');
        t.eq(tr.style.getPropertyValue('--vista-ajena'), '#718637',
            'el color de la vista de esa toma, que es el mismo de su bloque en la lista');
        const hijos = tr.children;
        const antesDeLaMarca = hijos.slice(0, hijos.indexOf(marca)).filter(h => h.clases.has('palabra'));
        t.eq(antesDeLaMarca.length, 2, 'las dos palabras de la toma 1 quedan de su lado');
        t.ok(antesDeLaMarca.every(w => w.dataset.deToma === '1'), 'y marcadas con su dueña');

        // El menú: sobre una ajena no se ofrece nada; sobre una libre, el IN.
        const di = w => texto.bordesQuePuede(tr, w).map(o => o.borde).join('+') || '';
        t.eq(di(antesDeLaMarca[0]), '', 'sobre una palabra de la toma 1 no se ofrece ningún borde');
        const libres = hijos.filter(h => h.clases.has('palabra') && !h.dataset.deToma);
        t.ok(/in/.test(di(libres[1])), 'sobre una libre de antes del IN, sí');
    });

    t.test('la ventana y el motor eligen la MISMA toma anterior, en la clase de verdad', () => {
        const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        // La copia de la ventana, sacada del archivo y corrida de verdad: así la
        // prueba no se queda comparando contra una versión que ya cambió.
        const cuerpo = codigo.slice(codigo.indexOf('function tomaAnterior(toma) {'),
            codigo.indexOf('\n}', codigo.indexOf('function tomaAnterior(toma) {')) + 2);
        t.ok(cuerpo.length > 100, 'la copia de la ventana está donde se la busca');
        // eslint-disable-next-line no-new-func
        const deLaVentana = new Function('estado', `${cuerpo} return tomaAnterior;`);

        // Los casos donde las dos podrían separarse: tomas fuera de orden en la
        // lista, una descartada en el medio, dos que se tocan, y una abierta.
        const tomas = [
            toma(1, 0, 10000),
            toma(3, 40000, 50000),
            toma(2, 10000, 20000),
            toma(4, 50000, 60000, { descartada: true }),
            toma(5, 55000, 70000),
            { ...toma(6, 80000, 90000), outMs: null }
        ];
        const ventana = deLaVentana({ tomas });
        for (const x of tomas) {
            const a = vivo.tomaAnterior(tomas, x);
            const b = ventana(x);
            t.eq(b ? b.id : null, a ? a.id : null, `toma ${x.id}: las dos dicen lo mismo`);
        }
        // Y que de verdad estén contestando algo, no `null` seis veces.
        t.eq(vivo.tomaAnterior(tomas, tomas[4]).id, 3, 'la 5 viene detrás de la 3, salteando la descartada');
        t.eq(vivo.tomaAnterior(tomas, tomas[2]).id, 1, 'la 2 detrás de la 1, aunque en la lista esté tercera');
    });
};
