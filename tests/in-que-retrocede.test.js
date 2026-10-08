'use strict';
/**
 * Mover el IN de la toma abierta hacia adelante, sin perder de vista lo de antes.
 *
 * El gesto es «esto de acá para atrás no era la toma»: con el clic derecho
 * sobre una palabra, o arrastrando el IN. `moverInAbierta` saca de la toma todo
 * lo anterior y lo manda a `estado.sueltas`, que es de donde la ventana arma lo
 * gris de antes del IN (`antesDeLaAbierta` en `pantalla-vivo.js`).
 *
 * Y ahí estaba el agujero: el puente recortaba las sueltas a las últimas 120
 * palabras. Una toma de un par de minutos tiene más que eso, así que al correr
 * el IN una parte del texto no cruzaba y desaparecía de la pantalla —el
 * contexto contra el que uno estaba decidiendo dónde poner el borde—. Volvía
 * recién al cerrar la toma, cuando la relectura rellena `antes` con los 12 s de
 * orilla, o sea tarde y solo un pedacito.
 *
 * Lo que se prueba es el puente, no la ventana: que lo que el motor manda
 * alcance para dibujar lo que la ventana sabe dibujar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const espejo = require('../engine/espejo');

const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-in-'));

/**
 * Una sesión con UNA toma cerrada y otra abierta y larga.
 *
 * Larga a propósito: lo que se rompía necesitaba más palabras de las que
 * cruzaban. Son dos por segundo, que es hablar despacio.
 */
function conUnaTomaLarga(cuantas) {
    // Por si la prueba anterior se cortó en una comprobación y no llegó a
    // apagar: si no, la de al lado falla con «ya hay una grabación en curso» y
    // tapa el fallo de verdad con uno que no es.
    grabacion.apagar();
    const st = grabacion.iniciar({ dir: carpeta(), curso: 'in', fps: 30, sinReloj: true, sampleRate: 48000 });
    for (let i = 0; i < 4; i++) grabacion.pcm(pedazo());
    const e = grabacion._sesion().estado;
    const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 400 });

    const cerrada = {
        id: 1, vista: 'PV', comentario: '', cuenta: '', inMs: st.ceroMs + 1000,
        outMs: st.ceroMs + 5000, descartada: false, comentarios: [],
        palabras: [w(1200, 'la'), w(1700, 'toma'), w(2200, 'de'), w(2700, 'antes')],
        antes: [], despues: []
    };
    const palabras = [];
    for (let i = 0; i < cuantas; i++) palabras.push(w(10000 + i * 500, `p${i}`));
    const abierta = {
        id: 2, vista: 'PV', comentario: '', cuenta: '', inMs: st.ceroMs + 10000,
        outMs: null, descartada: false, comentarios: [], palabras, antes: [], despues: []
    };
    e.tomas = [cerrada, abierta];
    e.proximaToma = 2;
    e.sueltas = [];
    e.ultimaPalabraMs = palabras[palabras.length - 1].t;
    return { st, e, palabras };
}

module.exports = function (t) {
    t.group('el IN que retrocede · lo de antes sigue estando');

    t.test('correr el IN al medio de una toma larga no esconde lo anterior', () => {
        // 400 palabras: tres minutos y pico de alguien hablando despacio, que es
        // una toma de clase normal. El IN se corre a la mitad.
        const { e, palabras } = conUnaTomaLarga(400);
        const corte = palabras[200].t;
        grabacion.editar({ tipo: 'borde', toma: 2, borde: 'in', paredMs: corte });

        const dentro = e.tomas[1];
        t.eq(dentro.inMs, corte, 'el IN quedó donde se pidió');
        t.eq(dentro.palabras.length, 200, 'y la toma se quedó con la segunda mitad');
        t.eq(e.sueltas.length, 200, 'el motor se guardó las 200 de antes');

        // Y esto es lo que se rompía: la ventana no las veía.
        const cruzan = espejo.resumen(grabacion._sesion()).sueltas;
        t.eq(cruzan.length, 200,
            'las 200 cruzan el puente: son lo gris contra lo que se eligió el borde');
        t.eq(cruzan[0].texto, 'p0', 'desde la primera palabra de la toma');
        t.eq(cruzan[cruzan.length - 1].texto, 'p199', 'hasta la de justo antes del IN');
        grabacion.apagar();
    });

    t.test('mover el IN no cambia QUÉ palabras hay en pantalla, solo dónde cae el borde', () => {
        // Es la propiedad que hace que el texto no salte. La ventana dibuja lo
        // gris de antes del IN y la toma como una sola tirada, así que mientras
        // la tirada sea la misma, el alto del transcript no cambia y el scroll
        // vuelve al mismo sitio. Cuando una parte no cruzaba, el texto se
        // acortaba debajo del rollo y el navegador lo empujaba al fondo: eso
        // era «me quitó de la vista lo que estaba antes».
        const { e } = conUnaTomaLarga(400);
        const enPantalla = () => espejo.resumen(grabacion._sesion()).sueltas
            .concat(e.tomas[1].palabras).map(w => w.texto).join(' ');
        const antes = enPantalla();
        grabacion.editar({ tipo: 'borde', toma: 2, borde: 'in', paredMs: e.tomas[1].palabras[200].t });
        t.eq(enPantalla(), antes, 'la misma tirada, palabra por palabra y en el mismo orden');
        grabacion.apagar();
    });

    t.test('no cruzan las de antes del OUT de la toma cerrada: la ventana las tira igual', () => {
        // `sueltasLibres()` en la ventana descarta todo lo anterior al último
        // OUT, porque eso ya es el texto de otra toma. Mandarlo sería mandar
        // palabras para que las tire del otro lado.
        const { st, e } = conUnaTomaLarga(10);
        e.sueltas = [
            { t: st.ceroMs + 3000, texto: 'adentro-de-la-1', hasta: st.ceroMs + 3300 },
            { t: st.ceroMs + 6000, texto: 'entre-las-dos', hasta: st.ceroMs + 6300 }
        ];
        const cruzan = espejo.resumen(grabacion._sesion()).sueltas;
        t.deep(cruzan.map(x => x.texto), ['entre-las-dos'],
            'solo lo posterior al OUT de la última cerrada');
        grabacion.apagar();
    });

    t.test('una clase entera de palabras sueltas no cruza entera', () => {
        // Sin ninguna toma cerrada no hay piso, y las sueltas son todo lo que se
        // oyó. El motor guarda diez minutos; mandarlos en cada estado, una vez
        // por segundo, es mandar la clase entera por el puente cada segundo.
        const { st, e } = conUnaTomaLarga(10);
        e.tomas = [];
        e.sueltas = [];
        for (let i = 0; i < 3000; i++) {
            e.sueltas.push({ t: st.ceroMs + i * 200, texto: `s${i}`, hasta: st.ceroMs + i * 200 + 150 });
        }
        const cruzan = espejo.resumen(grabacion._sesion()).sueltas;
        t.ok(cruzan.length < 3000, `se recortan (cruzaron ${cruzan.length})`);
        t.eq(cruzan[cruzan.length - 1].texto, 's2999', 'y lo que se recorta es lo viejo, no lo nuevo');
        grabacion.apagar();
    });
};
