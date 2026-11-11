'use strict';
/**
 * Mientras se graba, la relectura le cede el paso al texto en vivo
 * (`esperaAlVivo` en `engine/relecturas.js`).
 *
 *   · Con la última pasada del vivo lenta, una toma cerrada espera en la cola.
 *   · Cuando el vivo se repone, se lee (y vuelve a la cola, a esperar su
 *     orilla larga: eso es de siempre).
 *   · Y al terminar se lee igual: con el vivo apagado no hay a quién esperar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const relecturas = require('../engine/relecturas');

const pedazo = () => Buffer.alloc(4096 * 2);

/** Una clase con una toma cerrada y audio de sobra después de su OUT. */
function conUnaTomaCerrada(pasadaMs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-espera-'));
    grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
    const s = grabacion._sesion();
    s.ultimaPasadaMs = pasadaMs;
    for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
    const id = grabacion.abrirToma().abierta;
    for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
    grabacion.cerrarToma();
    for (let i = 0; i < 60; i++) grabacion.pcm(pedazo());
    return { s, id };
}

module.exports = function (t) {
    t.group('relecturas · el vivo va primero');

    t.test('con el vivo lento, la toma cerrada espera en la cola', () => {
        const { s, id } = conUnaTomaCerrada(5000);
        try {
            relecturas.atender(s);
            t.eq(s.rehaciendo, null, 'no arrancó ninguna lectura');
            t.ok(s.cola.includes(id), 'y la toma sigue esperando');
            t.ok(!s.estado.tomas.find(x => x.id === id).releida, 'sin leer');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('cuando el vivo se repone, se lee', async () => {
        const { s, id } = conUnaTomaCerrada(5000);
        try {
            s.ultimaPasadaMs = 700;
            relecturas.atender(s);
            t.ok(s.rehaciendo, 'arrancó');
            await s.rehaciendo;
            t.ok(s.estado.tomas.find(x => x.id === id).releida, 'y quedó leída');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('al terminar se lee aunque el vivo viniera lento', async () => {
        const { s, id } = conUnaTomaCerrada(5000);
        const r = await grabacion.terminar();
        t.ok(r, 'terminó');
        t.ok(s.estado.tomas.find(x => x.id === id).releida, 'y la toma quedó leída');
    });
};
