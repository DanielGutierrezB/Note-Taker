#!/usr/bin/env node
'use strict';
/**
 * Un `escuchar-app` de mentira, con el mismo protocolo que el de verdad.
 *
 * El de verdad necesita que macOS le dé permiso de grabar el audio del
 * sistema, y eso no se le puede pedir a una corrida de pruebas. Este habla
 * igual —una línea JSON por stderr, PCM mono Int16 por stdout— y se porta
 * según `FALSO_MODO`:
 *
 *   ok       dice que está listo y manda 9000 muestras en pedazos de 480
 *   sin-app  contesta el error de "Zoom no está abierto" y sale con 1
 *   muere    dice que está listo, manda un poco y se va solo
 */

const modo = process.env.FALSO_MODO || 'ok';
const args = process.argv.slice(2);

if (args.includes('--listar')) {
    process.stdout.write(JSON.stringify([
        { bundle: 'us.zoom.xos', pid: 123, sonando: modo !== 'callado' },
        { bundle: 'com.apple.controlcenter', pid: 45, sonando: false }
    ]) + '\n');
    process.exit(0);
}

if (modo === 'sin-app') {
    process.stderr.write(JSON.stringify({ error: 'No encontré ninguna app que empiece con us.zoom.', codigo: 'sin-app' }) + '\n');
    process.exit(1);
}

process.stderr.write(JSON.stringify({ listo: true, sampleRate: 48000, canales: 1, procesos: ['us.zoom.xos'] }) + '\n');

// Pedazos de 480 muestras, que es lo que suele entregar Core Audio a 48 kHz:
// a propósito de otro tamaño que el de la ventana, para que se vea el
// re-empaquetado.
let enviadas = 0;
const total = modo === 'muere' ? 2000 : 9000;
const tic = setInterval(() => {
    const n = Math.min(480, total - enviadas);
    const buf = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((enviadas + i) / 8) * 16000), i * 2);
    process.stdout.write(buf);
    enviadas += n;
    if (enviadas >= total) {
        clearInterval(tic);
        if (modo === 'muere') process.exit(3);
    }
}, 2);

process.on('SIGTERM', () => process.exit(0));
