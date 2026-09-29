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
 *   salida   la primera vez que se lanza (según `FALSO_CONTADOR`), manda un
 *            poco y se va con «salida-cambio», como cuando los AirPods se van;
 *            la segunda anda normal
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

let primera = false;
if (modo === 'salida' && process.env.FALSO_CONTADOR) {
    const fs = require('fs');
    primera = !fs.existsSync(process.env.FALSO_CONTADOR);
    fs.writeFileSync(process.env.FALSO_CONTADOR, 'x');
}

process.stderr.write(JSON.stringify({ listo: true, sampleRate: 48000, canales: 1, procesos: ['us.zoom.xos'] }) + '\n');

if (primera) {
    setTimeout(() => {
        process.stderr.write(JSON.stringify({ error: 'Cambió la salida', codigo: 'salida-cambio' }) + '\n');
        process.exit(3);
    }, 30);
}

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

// El de verdad no se va hasta que lo paran: en el modo `salida`, la segunda vez
// se queda como él, para que irse no se lea como una caída.
if (modo === 'salida' && !primera) setInterval(() => {}, 1000);

process.on('SIGTERM', () => process.exit(0));
