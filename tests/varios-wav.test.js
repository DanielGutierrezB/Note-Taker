'use strict';
/**
 * Una clase en más de un WAV, y una que no se terminó.
 *
 *   · La segunda mitad de una toma partida en un cambio de entrada se lee del
 *     WAV nuevo, no del viejo: los medio segundo de gracia del final del viejo
 *     se pisaban con el principio del nuevo.
 *   · Una clase que quedó abierta se lee con lo que sus WAV miden en el disco,
 *     no con lo del último guardado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const captura = require('../engine/captura');
const grabacion = require('../engine/grabacion');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');

const T0 = Date.parse('2026-11-10T10:00:00');

module.exports = function (t) {
    t.group('varios WAV · cuál tiene cada momento');

    const viejo = { archivo: 'a-1.wav', desdeMs: T0, segundos: 60 };
    const nuevo = { archivo: 'a-2.wav', desdeMs: T0 + 60200, segundos: 60 };

    t.test('justo después del cambio, el nuevo', () => {
        t.eq(captura.laQueContiene([viejo, nuevo], T0 + 60300).archivo, 'a-2.wav');
    });

    t.test('adentro del viejo, el viejo', () => {
        t.eq(captura.laQueContiene([viejo, nuevo], T0 + 59000).archivo, 'a-1.wav');
    });

    t.test('en el hueco del cambio, todavía el viejo por la gracia de su final', () => {
        t.eq(captura.laQueContiene([viejo, nuevo], T0 + 60100).archivo, 'a-1.wav');
    });

    t.test('fuera de todos, ninguno', () => {
        t.eq(captura.laQueContiene([viejo, nuevo], T0 + 200000), null);
    });

    t.group('varios WAV · una clase que no se terminó');

    t.test('se lee con lo que el WAV mide en el disco, no con el último guardado', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-wav-'));
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
        try {
            // Guardado con poco audio, y después siguió llegando: es la app que
            // se muere entre toma y toma.
            for (let i = 0; i < 5; i++) grabacion.pcm(Buffer.alloc(4096 * 2));
            grabacion.abrirToma();
            for (let i = 0; i < 60; i++) grabacion.pcm(Buffer.alloc(4096 * 2));
            const enElDisco = grabacion._sesion().captura.segundos;
            const lista = sesionesGrabadas.sidecaresDe(workspace.datosDir(dir), dir);
            t.eq(lista.length, 1);
            const wav = lista[0].sesiones[lista[0].sesiones.length - 1];
            t.ok(Math.abs(wav.segundos - enElDisco) < 0.05, `${wav.segundos} contra ${enElDisco} en el disco`);
        } finally {
            grabacion.apagar();
        }
    });
};
