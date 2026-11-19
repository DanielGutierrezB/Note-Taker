'use strict';
/**
 * El texto no se va de donde uno lo está mirando.
 *
 * Luisa, 18/11: «medio empezó a funcionar bien lo de mover el IN, pero otra vez
 * empezó a borrar partes del transcript». Lo que la pantalla muestra alrededor
 * de cada toma lo arma `grabar/alrededor-de-la-toma.js`, y ahí había cuatro
 * maneras de que texto que se estaba leyendo dejara de verse:
 *
 *   · al cerrarse la toma, «Ahora» mostraba solo lo dicho después de su OUT;
 *   · con una toma abierta, solo la toma anterior: abrir y cerrar una vacía con
 *     Enter cambiaba cuál era, y lo de antes se iba;
 *   · en la primera toma de la clase, solo veinticuatro palabras antes del IN;
 *   · al partir una toma, de la segunda mitad se asomaban veinticinco.
 *
 * Lo encontró `tools/probar-bordes.js`, que vigila cada palabra a la vista
 * mientras hace cada gesto en las cuatro distribuciones.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'grabar', 'alrededor-de-la-toma.js')).href);

const w = (s, texto) => ({ t: s * 1000, texto });
const palabras = (desde, n, raiz) => Array.from({ length: n }, (_, i) => w(desde + i * 0.4, `${raiz}${i + 1}`));
const toma = (id, inS, outS, ws) => ({ id, vista: 'PV', inMs: inS * 1000, outMs: outS == null ? null : outS * 1000, palabras: ws, antes: [], despues: [] });
const textos = ws => ws.map(x => x.texto);

module.exports = async function (t) {
    const al = await cargar();

    t.group('el texto no se va · «Ahora» sin toma abierta');

    t.test('al cerrarse una toma, su texto sigue arriba, con su marca', () => {
        const estado = { tomas: [toma(1, 10, 20, palabras(10, 20, 'a'))], sueltas: [w(21, 'después')], vistas: [] };
        const r = al.antesDeLaEspera(estado);
        t.deep(textos(r.antes).slice(-2), ['a19', 'a20'], 'el final de la toma');
        t.ok(r.antes.every(x => x.de && x.de.id === 1), 'de la toma 1');
        t.eq(r.limite.toma, 1);
        t.eq(r.limite.ms, 20000, 'y la marca en su OUT, que el IN no cruza');
    });

    t.test('y lo de antes de ella también: la clase de corrido', () => {
        const estado = {
            tomas: [toma(1, 10, 20, palabras(10, 5, 'a')), toma(2, 30, 40, palabras(30, 5, 'b'))],
            sueltas: [w(25, 'entre')], vistas: []
        };
        t.deep(textos(al.antesDeLaEspera(estado).antes), ['a1', 'a2', 'a3', 'a4', 'a5', 'entre', 'b1', 'b2', 'b3', 'b4', 'b5']);
    });

    t.test('abrir y cerrar una toma vacía no se lleva lo que había', () => {
        const llena = toma(1, 10, 20, palabras(10, 5, 'a'));
        const estado = { tomas: [llena, toma(2, 50, 51, [])], sueltas: [], vistas: [] };
        t.deep(textos(al.antesDeLaEspera(estado).antes), ['a1', 'a2', 'a3', 'a4', 'a5']);
        t.eq(al.antesDeLaEspera(estado).limite.toma, 2, 'con la marca en la vacía, que es la última');
    });

    t.test('una desactivada no es dueña: su texto va como el de afuera', () => {
        const apagada = { ...toma(1, 10, 20, palabras(10, 3, 'x')), descartada: true };
        const estado = { tomas: [apagada, toma(2, 30, 40, palabras(30, 2, 'b'))], sueltas: [], vistas: [] };
        const r = al.antesDeLaEspera(estado);
        t.deep(textos(r.antes), ['x1', 'x2', 'x3', 'b1', 'b2']);
        t.ok(r.antes.slice(0, 3).every(x => !x.de), 'sin dueña');
    });

    t.group('el texto no se va · la toma abierta');

    t.test('en la primera toma se ven más de veinticuatro palabras antes del IN', () => {
        const estado = { tomas: [toma(1, 100, null, [])], sueltas: palabras(50, 60, 's'), vistas: [] };
        t.eq(al.antesDeLaAbierta(estado, estado.tomas[0]).antes.length, 60);
    });

    t.test('y con varias tomas atrás, de corrido hasta el tope', () => {
        const estado = {
            tomas: [toma(1, 10, 20, palabras(10, 5, 'a')), toma(2, 30, 40, palabras(30, 5, 'b')), toma(3, 50, null, [])],
            sueltas: [], vistas: []
        };
        t.deep(textos(al.antesDeLaAbierta(estado, estado.tomas[2]).antes), ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5']);
        t.ok(al.antesDeLaAbierta(estado, estado.tomas[2]).antes.length <= al.ANTERIOR_MAX);
    });

    t.group('el texto no se va · al partir');

    t.test('la segunda mitad pegada se ve entera desde la primera', () => {
        const segunda = palabras(20, 60, 'b');
        const estado = { tomas: [toma(1, 10, 20, palabras(10, 20, 'a')), toma(2, 20, 50, segunda)], sueltas: [], vistas: [] };
        t.eq(al.despuesDeLaCerrada(estado, estado.tomas[0]).despues.length, 60, `no solo ${al.SIGUIENTE_MAX}`);
        t.eq(al.antesDeLaCerrada(estado, estado.tomas[1]).antes.length, 20, 'y la primera, entera, desde la segunda');
    });

    t.test('con aire entre las dos, de la siguiente se asoma el principio y nada más', () => {
        const estado = { tomas: [toma(1, 10, 20, palabras(10, 5, 'a')), toma(2, 30, 60, palabras(30, 60, 'b'))], sueltas: [], vistas: [] };
        t.eq(al.despuesDeLaCerrada(estado, estado.tomas[0]).despues.length, al.SIGUIENTE_MAX);
    });
};
