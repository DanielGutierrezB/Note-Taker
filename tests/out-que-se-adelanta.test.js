'use strict';
/**
 * Adelantar el OUT de una toma cerrada sobre lo que se siguió diciendo.
 *
 * El editor, después de la clase del 07/10: «Cuando hago un OUT puedo ver en el
 * espacio de toma para abrir el transcript aparecer, pero no se ve en el out de
 * la toma que cerré. Por lo cual no puedo ajustar el OUT si deseo adelantarlo
 * hasta mucho después. Me gusta como podemos ver el IN anterior subiendo del
 * transcript, deberíamos poder ver hasta un poco de la siguiente también.»
 *
 * Eran dos agujeros, uno de cada lado:
 *
 *   · **En la pantalla**, después del OUT solo iba `toma.despues`, que lo
 *     escribe la relectura. Hasta que Whisper termina no hay NADA ahí, y sin
 *     palabras el arrastre no tiene dónde apoyar: `bordesQuePuede` necesita una
 *     palabra siguiente para calcular la pared.
 *   · **En el motor**, el texto que quedaba abarcado por el OUT nuevo estaba en
 *     las sueltas y nadie lo metía en la toma, así que la toma se quedaba sin él
 *     hasta la relectura.
 *
 * Lo que acá se prueba de la pantalla es la marca de la toma siguiente, que es
 * la pared del OUT: el espejo exacto de la del IN, y por el mismo motivo —si el
 * menú ofreciera lo que el arrastre frena, el mismo gesto daría dos respuestas
 * según cómo se hizo—.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const dom = require('./fixtures/dom');
const grabacion = require('../engine/grabacion');
const vivo = require('../engine/notas-vivo');

const RAIZ = path.join(__dirname, '..');
const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-out-'));

function palabras(texto, desde) {
    return texto.split(' ').map((w, i) => ({
        t: desde + i * 400, hasta: desde + i * 400 + 380, texto: w
    }));
}

module.exports = async t => {
    dom.fingir();
    const texto = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js')).href);

    const armar = p => {
        const el = texto.textoDe(p, () => {});
        const ws = el.todos().filter(n => n.clases.has('palabra'));
        return { el, ws, de: w => ws.find(n => n.textContent === w) };
    };
    const sobre = (tr, w) => texto.bordesQuePuede(tr.el, tr.de(w))
        .map(o => `${o.borde}@${o.ms}`).join(' ');

    /** Una cerrada con la toma siguiente asomando detrás del OUT. */
    const conSiguiente = () => armar({
        modo: 'cerrada',
        antes: palabras('ya', 9000),
        palabras: palabras('el teorema de pitagoras', 10000),
        despues: palabras('pausa che', 11600).concat(
            palabras('tres dos uno arrancamos', 13000)
                .map(w => ({ ...w, de: { id: 7, vista: 'R' } }))),
        limiteDespues: { toma: 7, ms: 13000 }
    });

    t.group('el OUT que se adelanta · la pared de la toma siguiente');

    t.test('la marca se dibuja donde cambia de dueño el texto', () => {
        const tr = conSiguiente();
        const hijos = tr.el.todos().filter(n => n.clases.has('transcript-limite'));
        t.eq(hijos.length, 1, 'una sola marca');
        t.eq(hijos[0].dataset.lado, 'despues', 'y es la del lado del OUT');
        t.eq(hijos[0].dataset.limite, '7');
    });

    t.test('lo que ya es de la toma siguiente no ofrece ningún borde', () => {
        const tr = conSiguiente();
        t.eq(sobre(tr, 'tres'), '', 'la primera de la siguiente');
        t.eq(sobre(tr, 'dos'), '', 'y las que vienen detrás');
    });

    t.test('lo de tierra de nadie sí mueve el OUT, que es el punto de todo esto', () => {
        const tr = conSiguiente();
        // «pausa» 11600, «che» 12000: el OUT apoya en la palabra siguiente.
        t.eq(sobre(tr, 'pausa'), 'out@12000', 'el OUT se adelanta hasta después de «pausa»');
        // «che» es la última antes de la marca: su pared es la primera de la
        // toma siguiente, o sea el OUT queda pegado al IN de la 7. Dos tomas
        // que se tocan son legales; lo que no se puede es entrar.
        t.eq(sobre(tr, 'che'), 'out@13000', 'y hasta el filo mismo de la toma que viene');
    });

    t.test('sin toma siguiente no hay marca, y el OUT llega hasta lo último oído', () => {
        const tr = armar({
            modo: 'cerrada',
            antes: palabras('ya', 9000),
            palabras: palabras('el teorema', 10000),
            despues: palabras('pausa che', 11600)
        });
        t.eq(tr.el.todos().filter(n => n.clases.has('transcript-limite')).length, 0);
        t.eq(sobre(tr, 'pausa'), 'out@12000');
        t.eq(sobre(tr, 'che'), '', 'la última de todo no tiene pared detrás: igual que siempre');
    });

    t.test('el IN sigue sin tropezarse con la marca del OUT', () => {
        // Cada borde se frena con la marca de SU lado. Si el IN leyera la de la
        // derecha, mover el principio de la toma dejaría de poder hacerse
        // apenas hubiera una toma siguiente, que son casi todas.
        const tr = conSiguiente();
        t.eq(sobre(tr, 'ya'), 'in@9000', 'lo gris de antes sigue moviendo el IN');
        t.eq(sobre(tr, 'teorema'), 'in@10400 out@10800', 'y lo de adentro, los dos');
    });

    t.group('el OUT que se adelanta · el motor se lleva lo que abarcó');

    t.test('adelantar el OUT mete las sueltas en la toma', () => {
        grabacion.apagar();
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'out', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let i = 0; i < 4; i++) grabacion.pcm(pedazo());
        const e = grabacion._sesion().estado;
        const w = (dt, tx) => ({ t: st.ceroMs + dt, texto: tx, hasta: st.ceroMs + dt + 380 });
        e.tomas = [{
            id: 1, vista: 'PV', comentario: '', cuenta: '', comentarios: [],
            inMs: st.ceroMs + 1000, outMs: st.ceroMs + 3000, descartada: false,
            antes: [], palabras: [w(1000, 'el'), w(1400, 'teorema')], despues: []
        }];
        e.proximaToma = 1;
        // Lo que se siguió diciendo después de cerrarla: todavía no es de nadie.
        e.sueltas = [w(3200, 'y'), w(3600, 'esto'), w(4000, 'tambien')];
        e.ultimaPalabraMs = st.ceroMs + 4000;

        grabacion.editar({ tipo: 'borde', toma: 1, borde: 'out', paredMs: st.ceroMs + 4400 });

        const toma = e.tomas[0];
        t.deep(toma.palabras.map(x => x.texto), ['el', 'teorema', 'y', 'esto', 'tambien'],
            'las tres se metieron adentro, en orden');
        t.eq(e.sueltas.length, 0, 'y salieron de las sueltas: en los dos sitios se verían dos veces');
        grabacion.apagar();
    });

    t.test('solo se lleva lo que quedó adentro, no todo lo suelto', () => {
        grabacion.apagar();
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'out', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let i = 0; i < 4; i++) grabacion.pcm(pedazo());
        const e = grabacion._sesion().estado;
        const w = (dt, tx) => ({ t: st.ceroMs + dt, texto: tx, hasta: st.ceroMs + dt + 380 });
        e.tomas = [{
            id: 1, vista: 'PV', comentario: '', cuenta: '', comentarios: [],
            inMs: st.ceroMs + 1000, outMs: st.ceroMs + 3000, descartada: false,
            antes: [], palabras: [w(1000, 'el')], despues: []
        }];
        e.proximaToma = 1;
        e.sueltas = [w(3200, 'adentro'), w(9000, 'mucho'), w(9400, 'despues')];
        e.ultimaPalabraMs = st.ceroMs + 9400;

        grabacion.editar({ tipo: 'borde', toma: 1, borde: 'out', paredMs: st.ceroMs + 3800 });

        t.deep(e.tomas[0].palabras.map(x => x.texto), ['el', 'adentro']);
        t.deep(e.sueltas.map(x => x.texto), ['mucho', 'despues'], 'lo de más allá sigue suelto');
        grabacion.apagar();
    });

    t.test('`tragarSueltas` no toca una toma sin cerrar', () => {
        // La abierta se alimenta sola del ciclo en vivo; si esto además le
        // volcara las sueltas, se las llevaría todas, incluidas las de antes
        // de su IN que son lo gris que se dibuja delante.
        const estado = { sueltas: [{ t: 100, texto: 'a' }, { t: 900, texto: 'b' }] };
        const toma = { inMs: 0, outMs: null, palabras: [] };
        vivo.tragarSueltas(estado, toma);
        t.eq(estado.sueltas.length, 2, 'las sueltas quedan donde estaban');
        t.eq(toma.palabras.length, 0);
    });
};
