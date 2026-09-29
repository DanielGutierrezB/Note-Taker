'use strict';
/**
 * Los errores que encontró la revisión del motor del 29/09, cada uno con la
 * forma en que se reprodujo. Whisper se reemplaza por lo que haga falta que
 * "oiga" (`oirToma.tramo` y `oirToma.leer`), y se repone al terminar cada prueba.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const vivo = require('../engine/notas-vivo');

const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-revision-'));

/** Corre `fn` con Whisper de mentira. `oye` es lo que devuelve cada pasada. */
function conWhisperFalso(fn) {
    return async () => {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { ventana: [] };
        oirToma.tramo = async () => ({ palabras: falso.ventana });
        oirToma.leer = async (_a, toma) => ({
            antes: [], despues: [], colapsadas: 0, relectura: null,
            palabras: [{ t: toma.inMs, texto: 'TEXTO-BUENO', hasta: toma.inMs + 300 }]
        });
        try { await fn(falso); } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
        }
    };
}

module.exports = function (t) {
    t.group('revisión · deshacer no pisa lo que pasó solo');

    t.test('deshacer la vista no reabre una toma que «Pausa» cerró', conWhisperFalso(async falso => {
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'r', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let i = 0; i < 8; i++) grabacion.pcm(pedazo());
        const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
        falso.ventana = [w(1000, '3,'), w(1400, '2,'), w(1800, '1.'), w(2600, 'Hola'), w(3000, 'mundo')];
        await grabacion.buscarSenales();
        grabacion.editar({ tipo: 'vista', toma: 1, vista: 'S' });
        for (let i = 0; i < 6; i++) grabacion.pcm(pedazo());
        falso.ventana = [w(8000, 'bien'), w(8400, 'Pausa.')];
        await grabacion.buscarSenales();
        await new Promise(r => setTimeout(r, 30));

        const r = grabacion.deshacer();
        t.ok(r.ok, r.error);
        const toma = r.estado.tomas[0];
        t.eq(toma.vista, 'PV', 'la vista volvió');
        t.ok(toma.outMs != null, 'y la toma sigue cerrada');
        t.deep(toma.palabras.map(x => x.texto), ['TEXTO-BUENO'], 'con el texto de la relectura');
    }));

    t.test('deshacer una claqueta a mano no se lleva las que se oyeron después', conWhisperFalso(async falso => {
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'r', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        grabacion.claqueta();
        for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
        const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
        // Una claqueta de verdad: la palabra y el aplauso.
        vivo.recordarAplauso(grabacion._sesion().estado, st.ceroMs + 27500);
        falso.ventana = [w(26000, 'claqueta'), w(26400, 'cuatro')];
        await grabacion.buscarSenales();
        t.eq(grabacion.resumen().claquetas.length, 2);
        const r = grabacion.deshacer();
        t.deep(r.estado.claquetas.map(c => c.origen), ['golpe,voz'], 'se fue la del editor y nada más');
        const re = grabacion.rehacer();
        t.eq(re.estado.claquetas.length, 2, 'y se rehace');
    }));

    t.test('una claqueta quitada a mano no vuelve con la relectura', () => {
        const e = vivo.estadoNuevo({});
        vivo.anotarClaqueta(e, { ms: 10000, origen: 'voz', confirmada: true });
        vivo.quitarClaqueta(e, 1);
        const otra = vivo.anotarClaqueta(e, { ms: 10300, origen: 'voz', confirmada: true });
        t.eq(otra.nueva, false);
        t.eq(e.claquetas.length, 0);
        vivo.anotarClaqueta(e, { ms: 10300, origen: 'editor', confirmada: true });
        t.eq(e.claquetas.length, 1, 'el editor sí la puede volver a poner');
    });

    t.group('revisión · el ciclo');

    t.test('una sesión reanudada vuelve a abrir tomas', conWhisperFalso(async falso => {
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'r', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let i = 0; i < 5; i++) grabacion.pcm(pedazo());
        grabacion.apagar();
        const errores = [];
        grabacion.reanudar(st.archivos.json, {
            sinReloj: true, sampleRate: 48000, avisar: m => { if (m.tipo === 'error') errores.push(m.mensaje); }
        });
        const T = Date.now();
        const w = (dt, x) => ({ t: T + dt, texto: x, hasta: T + dt + 300 });
        for (let s = 0; s < 6; s++) {
            grabacion.pcm(pedazo());
            falso.ventana = [w(200, 'bueno'), w(1500, '3,'), w(1900, '2,'), w(2300, '1.'), w(3100, 'Hola')];
            await grabacion.buscarSenales();
        }
        t.eq(errores.length, 0, errores[0]);
        t.eq(grabacion.resumen().tomas.length, 1);
    }));

    t.test('la ventana no crece sin techo aunque Whisper falle', conWhisperFalso(async () => {
        const pedidos = [];
        oirToma.tramo = async (_a, d, h) => { pedidos.push(h - d); throw new Error('whisper se cayó'); };
        grabacion.iniciar({ dir: carpeta(), curso: 'r', fps: 30, sinReloj: true, sampleRate: 48000 });
        for (let s = 0; s < 40; s++) {
            grabacion.pcm(pedazo());
            await grabacion.buscarSenales();
        }
        t.ok(Math.max(...pedidos) <= 15000, `la más larga pidió ${Math.max(...pedidos)} ms`);
    }));

    t.test('Terminar durante una pasada no deja una toma sin OUT', conWhisperFalso(async falso => {
        let soltar = null;
        oirToma.tramo = () => new Promise(res => { soltar = () => res({ palabras: falso.ventana }); });
        const st = grabacion.iniciar({ dir: carpeta(), curso: 'r', fps: 30, sinReloj: true, sampleRate: 48000 });
        const w = (dt, x) => ({ t: st.ceroMs + dt, texto: x, hasta: st.ceroMs + dt + 300 });
        for (let i = 0; i < 12; i++) grabacion.pcm(pedazo());
        falso.ventana = [w(1000, '3,'), w(1400, '2,'), w(1800, '1.'), w(2600, 'Hola')];
        let p = grabacion.buscarSenales(); await new Promise(r => setTimeout(r, 5)); soltar(); await p;

        falso.ventana = [w(6000, 'fin'), w(6400, 'Pausa.'), w(8000, '3,'), w(8400, '2,'), w(8800, '1.'), w(9600, 'Otra')];
        grabacion.pcm(pedazo());
        p = grabacion.buscarSenales();
        await new Promise(r => setTimeout(r, 5));
        const fin = grabacion.terminar();
        soltar(); await p;
        const salida = await fin;
        const side = JSON.parse(fs.readFileSync(salida.archivos.json, 'utf8'));
        t.ok(side.terminada);
        t.ok(side.tomas.every(x => x.outMs != null), 'todas con OUT');
    }));

    t.group('revisión · las señales');

    const T0 = 1000000;
    const ws = pares => pares.map(([dt, texto]) => ({ t: T0 + dt, texto, hasta: T0 + dt + 300 }));

    t.test('el IN tras un «1» que fue lo último oído se corrige con la palabra que sigue', () => {
        const e = vivo.estadoNuevo({});
        vivo.aplicarSenales(e, ws([[0, '3,'], [400, '2,'], [800, '1.']]));
        t.eq(e.tomas[0].inMs, T0 + 1100, 'provisional: el final del «1»');
        vivo.aplicarSenales(e, ws([[800, '1.'], [2200, 'Hoy'], [2600, 'vamos']]));
        t.eq(e.tomas[0].inMs, T0 + 2200, 'y ahí donde empieza la clase');
    });

    t.test('«pausa» al final de lo oído necesita un segundo de silencio de verdad', () => {
        const e = vivo.estadoNuevo({});
        vivo.aplicarSenales(e, ws([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        // «pausa» termina a 5300 y lo oído llega a 5750: medio segundo, no alcanza.
        vivo.aplicarSenales(e, ws([[5000, 'pausa']]), { finMs: T0 + 5750 });
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
        vivo.aplicarSenales(e, ws([[5000, 'pausa']]), { finMs: T0 + 6500 });
        t.ok(e.tomas[0].outMs != null, 'con 1,2 s de silencio sí cierra');
    });

    t.test('dos conteos en la misma ventana no se vuelven a disparar en cada pasada', () => {
        const e = vivo.estadoNuevo({});
        const ventana = ws([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola'],
            [3000, 'Pausa.'], [5000, '3,'], [5400, '2,'], [5800, '1.'], [6600, 'Otra']]);
        vivo.aplicarSenales(e, ventana);
        const tomas = e.tomas.length;
        vivo.aplicarSenales(e, ventana);
        vivo.aplicarSenales(e, ventana);
        t.eq(e.tomas.length, tomas, 'las mismas tomas');
    });

    t.test('las palabras dichas antes del IN de una toma a mano no entran en ella', () => {
        const e = vivo.estadoNuevo({});
        vivo.abrirToma(e, T0 + 10000);
        vivo.aplicarSenales(e, ws([[8000, 'antes'], [10200, 'adentro']]));
        t.deep(e.tomas[0].palabras.map(w => w.texto), ['adentro']);
        t.ok(vivo.finDeToma({ inMs: 5000, palabras: [{ t: 4000, hasta: 4300 }] }, 0) > 5000,
            'y el OUT nunca queda antes del IN');
    });
};
