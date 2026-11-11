'use strict';
/**
 * Cómo va el texto en vivo, en un renglón que está siempre (`estados.salud`).
 *
 *   · Dice siempre algo: al día, atrasada, al día otra vez, o el audio.
 *   · Con huecos que ya pasaron, vuelve a decir «al día» sin olvidarlos.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'estados.js')).href);

module.exports = function (t) {
    t.group('salud del vivo · el renglón de debajo de los timers');

    t.test('al día, con cuánto va detrás', async () => {
        const e = await cargar();
        const s = e.salud({ atrasoSec: 2.4, salteadoSec: 0 });
        t.eq(s.tono, 'ok');
        t.eq(s.dice, 'Al día · el texto va unos 2 s detrás de lo que decís');
    });

    t.test('atrasada, con los segundos y qué implica', async () => {
        const e = await cargar();
        const s = e.salud({ atrasoSec: 5.3, salteadoSec: 0 });
        t.eq(s.tono, 'atraso');
        t.ok(/^Atrasada 5,3 s · /.test(s.dice), s.dice);
        t.ok(/Suele ser otra cosa/.test(s.porque), 'y en el hover, el porqué');
    });

    t.test('después de los huecos dice que volvió, sin olvidarlos', async () => {
        const e = await cargar();
        const s = e.salud({ atrasoSec: 2, salteadoSec: 10.6 }, e.deSesion({ atrasoSec: 2, salteadoSec: 10.6, tomas: [] }));
        t.eq(s.tono, 'atraso');
        t.ok(/^Al día otra vez · quedaron 10,6 s sin texto en vivo/.test(s.dice), s.dice);
    });

    t.test('atrasada y con huecos, las dos cosas', async () => {
        const e = await cargar();
        const s = e.salud({ atrasoSec: 7.8, salteadoSec: 5.5 });
        t.ok(/^Atrasada 7,8 s · ya quedaron 5,5 s sin texto en vivo$/.test(s.dice), s.dice);
    });

    t.test('el audio va primero, en rojo y con lo que hay que hacer', async () => {
        const e = await cargar();
        const estado = { atrasoSec: 1, salteadoSec: 0, tomas: [] };
        const s = e.salud(estado, e.deSesion(estado, { caido: true }));
        t.eq(s.tono, 'error');
        t.ok(/^Sin audio · La entrada dejó de mandar audio$/.test(s.dice), s.dice);
    });

    t.test('terminando, lo dice', async () => {
        const e = await cargar();
        t.ok(/^Terminando/.test(e.salud({ terminando: true }).dice));
    });
};
