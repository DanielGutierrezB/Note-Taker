'use strict';
/**
 * Correr el IN hacia adelante no puede hacer desaparecer el texto que queda
 * fuera de la toma: tiene que seguir a la vista, en gris, antes del IN.
 *
 * El 11/11, en vivo: «cuando muevo el IN, me corta parte de la transcripción».
 * La toma 2 empezaba pegada a la 1; con el IN corrido, lo que quedó entre el
 * OUT de la 1 y el IN nuevo no se veía en ningún lado.
 *
 * Se prueba de punta a punta: el motor de verdad, con un Whisper de mentira, y
 * lo que le manda a la ventana pasado por las mismas funciones que arman el
 * gris en pantalla (`grabar/alrededor-de-la-toma.js`).
 */

const path = require('path');
const { pathToFileURL } = require('url');

const grabacion = require('../engine/grabacion');
const conClaseMuda = require('./fixtures/clase-muda');

const cargarAlrededor = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'grabar', 'alrededor-de-la-toma.js')).href);

/** Lo gris de antes del IN, sin lo que es de la toma de arriba. */
const grisLibre = antes => antes.filter(w => !w.de).map(w => w.texto);

module.exports = function (t) {
    t.group('correr el IN · lo que queda afuera se sigue viendo');

    t.test('en la toma abierta, pegada a la anterior', async () => {
        const { antesDeLaAbierta } = await cargarAlrededor();
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(1100, 'uno'), w(1500, 'dos'));
            grabacion.cerrarToma();
            const fin = s.estado.tomas[0].outMs;
            grabacion.abrirToma(fin);
            await oir(w(7200, 'Y'), w(7600, 'esperen'), w(8000, 'lo'), w(8400, 'dejo'), w(8800, 'ahí'));
            const id = s.estado.tomas.find(x => x.outMs == null).id;
            grabacion.editar({ tipo: 'borde', toma: id, borde: 'in', paredMs: st.ceroMs + 8400 });
            const r = grabacion.resumen();
            const toma = r.tomas.find(x => x.id === id);
            t.eq(toma.palabras.map(x => x.texto).join(' '), 'dejo ahí', 'la toma empieza donde se dejó el IN');
            t.deep(grisLibre(antesDeLaAbierta(r, toma).antes), ['Y', 'esperen', 'lo'], 'y lo de antes se ve en gris');
        });
    });

    t.test('en una toma cerrada y ya releída, pegada a la anterior', async () => {
        const { antesDeLaCerrada } = await cargarAlrededor();
        const dicho = [];
        await conClaseMuda(async ({ st, s, w, oir }) => {
            const ws = [w(1100, 'uno'), w(1500, 'dos'), w(7200, 'Y'), w(7600, 'esperen'), w(8000, 'lo'),
                w(8400, 'dejo'), w(8800, 'ahí'), w(9200, 'listo')];
            dicho.push(...ws);
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(ws[0], ws[1]);
            grabacion.cerrarToma();
            if (s.rehaciendo) await s.rehaciendo;
            grabacion.abrirToma(s.estado.tomas[0].outMs);
            await oir(...ws.slice(2));
            const id = s.estado.tomas.find(x => x.outMs == null).id;
            grabacion.cerrarToma();
            await oir();
            if (s.rehaciendo) await s.rehaciendo;
            grabacion.editar({ tipo: 'borde', toma: id, borde: 'in', paredMs: st.ceroMs + 8400 });
            if (s.rehaciendo) await s.rehaciendo;
            const r = grabacion.resumen();
            const toma = r.tomas.find(x => x.id === id);
            t.eq(toma.palabras[0].texto, 'dejo', 'la toma empieza donde se dejó el IN');
            t.deep(grisLibre(antesDeLaCerrada(r, toma).antes), ['Y', 'esperen', 'lo'], 'y lo de antes se ve en gris');
        }, { relee: () => dicho });
    });

    t.test('una relectura con pocas palabras en el tramo no esconde las del vivo', async () => {
        // La forma de lo que vio Candela: la relectura dejó dos palabras en el
        // tramo de antes del IN —el resto lo tiró su filtro de silencio— y, como
        // juntar por tramo cubierto tomaba de la primera a la última, se tragaba
        // todo lo que el vivo sí tenía en el medio.
        const { antesDeLaCerrada } = await cargarAlrededor();
        const T = Date.parse('2026-11-11T17:00:00');
        const w = (ms, texto) => ({ t: T + ms, hasta: T + ms + 300, texto });
        const estado = {
            vistas: [],
            tomas: [
                { id: 1, vista: 'PV', inMs: T - 20000, outMs: T, palabras: [w(-1000, 'ver')], despues: [] },
                { id: 2, vista: 'R', inMs: T + 6000, outMs: T + 20000, palabras: [w(6000, 'de'), w(6400, 'YouTube')],
                    antes: [w(200, 'Y'), w(5600, 'videos')] }
            ],
            sueltas: [w(240, 'Y'), w(600, 'esperen'), w(1000, 'lo'), w(1400, 'dejo'), w(5640, 'videos')]
        };
        t.deep(grisLibre(antesDeLaCerrada(estado, estado.tomas[1]).antes), ['Y', 'esperen', 'lo', 'dejo', 'videos']);
    });
};
