'use strict';
/**
 * El texto en vivo por whisper-server. Lo que se prueba sin un servidor de
 * verdad: cómo sus piezas se vuelven palabras, y que sin él no arranca nada ni
 * se rompe nada. Contra el servidor y el modelo de verdad está
 * `tools/medir-vivo.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const residente = require('../engine/oido-residente');

/** Un proceso de mentira que se llama `nombre`: una copia de `sleep`. */
function procesoLlamado(dir, nombre) {
    const bin = path.join(dir, nombre);
    fs.copyFileSync('/bin/sleep', bin);
    fs.chmodSync(bin, 0o755);
    return spawn(bin, ['30'], { stdio: 'ignore' });
}

const vive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
const espera = ms => new Promise(r => setTimeout(r, ms));

/** `fn` con el pid del servidor anotado en un archivo de prueba. */
async function conPidAparte(fn) {
    const antes = process.env.NT_RESIDENTE_PID;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-residente-'));
    process.env.NT_RESIDENTE_PID = path.join(dir, 'whisper-server.pid');
    try {
        await fn(dir, process.env.NT_RESIDENTE_PID);
    } finally {
        if (antes === undefined) delete process.env.NT_RESIDENTE_PID;
        else process.env.NT_RESIDENTE_PID = antes;
    }
}

module.exports = function (t) {
    t.group('oído residente · las piezas');

    t.test('las piezas sin espacio se pegan a la palabra anterior', () => {
        // Así las devuelve whisper-server: « in» + «icia».
        const palabras = residente.palabrasDe({
            segments: [{
                words: [
                    { word: ' esto', start: 0.01, end: 0.23 },
                    { word: ' in', start: 0.38, end: 0.51 },
                    { word: 'icia', start: 0.51, end: 0.85 },
                    { word: ' la', start: 0.85, end: 0.96 },
                    { word: ' toma', start: 1.66, end: 1.96 },
                    { word: '.', start: 1.96, end: 1.98 }
                ]
            }]
        });
        t.deep(palabras.map(w => w.text), ['esto', 'inicia', 'la', 'toma.']);
        t.eq(palabras[1].start, 0.38, 'empieza donde empezó su primera pieza');
        t.eq(palabras[1].end, 0.85, 'y termina donde terminó la última');
    });

    t.test('el DTW de la palabra es el de su primera pieza con dato, en segundos', () => {
        const palabras = residente.palabrasDe({
            segments: [{
                words: [
                    { word: ' in', start: 0.38, end: 0.51, t_dtw: -1 },
                    { word: 'icia', start: 0.51, end: 0.85, t_dtw: 106 },
                    { word: ' la', start: 0.85, end: 0.96, t_dtw: 118 }
                ]
            }]
        });
        t.eq(palabras[0].dtw, 1.06, '-1 es «no sé», no cero');
        t.eq(palabras[1].dtw, 1.18);
    });

    t.test('las marcas entre corchetes no son palabras', () => {
        const palabras = residente.palabrasDe({
            segments: [{ words: [{ word: ' [_BEG_]', start: 0, end: 0 }, { word: ' hola', start: 0.1, end: 0.4 }] }]
        });
        t.deep(palabras.map(w => w.text), ['hola']);
    });

    t.group('oído residente · sin servidor');

    t.test('sin binario no arranca, y no está listo', async () => {
        const ok = await residente.arrancar({ bin: null, modelo: { path: null } });
        t.eq(ok, false);
        t.eq(residente.listo(), false);
    });

    t.group('oído residente · que no quede vivo');

    t.test('uno que no contesta a tiempo se apaga, en vez de quedar colgado', async () => {
        await conPidAparte(async (dir, archivo) => {
            // Uno que arranca y no contesta nunca, como un modelo que no carga.
            const bin = path.join(dir, 'trabado');
            fs.writeFileSync(bin, '#!/bin/sh\nsleep 30\n');
            fs.chmodSync(bin, 0o755);
            const arranque = residente.arrancar({ bin, modelo: { path: '/x', name: 'x' }, arranqueMaxMs: 600 });
            await espera(200);
            const pid = Number(fs.readFileSync(archivo, 'utf8'));
            t.ok(vive(pid), 'mientras carga está vivo, y anotado');
            t.eq(await arranque, false, 'no arrancó');
            await espera(200);
            t.ok(!vive(pid), 'y después del plazo ya no está');
            t.ok(!fs.existsSync(archivo), 'ni su pid');
            t.eq(residente.listo(), false);
            residente.apagar();
        });
    });

    t.test('el que dejó una app caída se apaga al arrancar la siguiente', async () => {
        await conPidAparte(async (dir, archivo) => {
            const huerfano = procesoLlamado(dir, 'whisper-server');
            try {
                await espera(100);
                fs.writeFileSync(archivo, String(huerfano.pid));
                t.eq(residente.limpiarHuerfano(), huerfano.pid, 'lo encontró');
                await espera(200);
                t.ok(!vive(huerfano.pid), 'y ya no está');
                t.ok(!fs.existsSync(archivo), 'y el archivo se fue con él');
            } finally {
                try { huerfano.kill('SIGKILL'); } catch (e) { /* ya se fue */ }
            }
        });
    });

    t.test('y un pid que ahora es de otro proceso no se toca', async () => {
        await conPidAparte(async (dir, archivo) => {
            const otro = procesoLlamado(dir, 'otro-proceso');
            try {
                await espera(100);
                fs.writeFileSync(archivo, String(otro.pid));
                t.eq(residente.limpiarHuerfano(), null);
                t.ok(vive(otro.pid), 'sigue vivo');
            } finally {
                try { otro.kill('SIGKILL'); } catch (e) { /* ya se fue */ }
            }
        });
    });

    t.test('transcribir sin servidor tira, para que quien llama use el respaldo', async () => {
        let error = null;
        try { await residente.transcribir('/no/existe.wav', 'es'); } catch (e) { error = e; }
        t.ok(error, 'tiró');
    });
};
