'use strict';
/**
 * Que el WAV del micrófono no se atrase contra el reloj (`engine/alinear-audio.js`).
 *
 * Lo que tiene que distinguir es una traba de audio perdido: los pedazos
 * encolados suben la deriva y la bajan al llegar juntos, y eso no se rellena;
 * lo perdido la sube y se queda, y eso sí.
 */

const fs = require('fs');
const path = require('path');
const alinear = require('../engine/alinear-audio');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/** Un pedazo cada 85 ms durante `segundos`, con la deriva que diga `deriva(t)`. */
function correr(segundos, deriva) {
    const a = alinear.nuevo();
    const rellenos = [];
    let agregado = 0;
    for (let t = 0; t <= segundos * 1000; t += 85) {
        const falta = alinear.mirar(a, deriva(t) - agregado, t);
        if (falta) { rellenos.push({ t, falta }); agregado += falta; }
    }
    return { rellenos, agregado };
}

module.exports = function (t) {
    t.group('alinear el audio · lo perdido se rellena, las trabas no');

    t.test('con el audio a la par no se rellena nada', () => {
        t.deep(correr(60, () => 120 + Math.random() * 40).rellenos, []);
    });

    t.test('una traba de dos segundos, que después llega junta, no se rellena', () => {
        const traba = tiempo => (tiempo > 20000 && tiempo < 22000 ? 120 + (tiempo - 20000) : 120);
        t.deep(correr(60, traba).rellenos, []);
    });

    t.test('medio segundo perdido se rellena una vez, y lo que sigue queda a la par', () => {
        const r = correr(60, tiempo => (tiempo > 20000 ? 620 : 120));
        t.eq(r.rellenos.length, 1, 'una vez');
        t.ok(Math.abs(r.agregado - 500) <= 1, `lo que faltó: ${r.agregado} ms`);
    });

    t.test('cuatro tropiezos de 0,6 s son cuatro rellenos que suman lo perdido', () => {
        const r = correr(200, tiempo => 120 + 600 * [30000, 60000, 110000, 150000].filter(x => tiempo > x).length);
        t.eq(r.rellenos.length, 4);
        t.ok(Math.abs(r.agregado - 2400) <= 4, `${r.agregado} ms`);
    });

    t.test('menos de 150 ms no se toca: es el ir y venir de los pedazos', () => {
        t.deep(correr(60, tiempo => (tiempo > 20000 ? 220 : 120)).rellenos, []);
    });

    t.test('lo perdido al arrancar también se rellena: no pasa a ser la referencia', () => {
        const r = correr(60, () => 2520);
        t.eq(r.rellenos.length, 1, 'una vez, al cerrar la primera ventana');
        t.ok(Math.abs(r.agregado - (2520 - alinear.BASE_MAX_MS)) <= 1, `${r.agregado} ms`);
    });

    t.test('una entrada que tarda un poco más de lo normal desde el arranque no se rellena', () => {
        t.deep(correr(60, () => 380 + Math.random() * 40).rellenos, []);
    });

    t.test('si la deriva baja, esa es la nueva referencia', () => {
        const r = correr(60, tiempo => (tiempo > 10000 ? 40 : 300));
        t.deep(r.rellenos, [], 'bajar no es perder');
    });

    t.group('alinear el audio · solo el micrófono');

    t.test('el puente marca el micrófono, y el de Zoom no se rellena dos veces', () => {
        const puente = leer('ipc', 'grabar.js');
        t.ok(/grabacion\.pcm\(chunk, 'ventana'\)/.test(puente), 'el de la ventana va marcado');
        t.ok(/alPcm: chunk => grabacion\.pcm\(chunk\)/.test(puente), 'el del ayudante no: ya se rellena allá');
        const motor = leer('engine', 'grabacion.js');
        t.ok(/origen === 'ventana' && cap\.alinear/.test(motor), 'y el motor solo alinea el marcado');
    });
};
