'use strict';
/**
 * El WAV que se escribe mientras entra.
 *
 * Lo que se fija acá es lo que hace que una app que se cae no cueste la clase:
 * la cabecera tiene que declarar el tamaño real en TODO momento, no solo al
 * cerrar. Un WAV con la cabecera en cero tiene el audio adentro y ningún
 * programa lo abre.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const captura = require('../engine/captura');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-captura-'));
}

function leerCabecera(archivo) {
    const buf = fs.readFileSync(archivo);
    return {
        riff: buf.toString('ascii', 0, 4),
        wave: buf.toString('ascii', 8, 12),
        canales: buf.readUInt16LE(22),
        sampleRate: buf.readUInt32LE(24),
        bits: buf.readUInt16LE(34),
        datos: buf.readUInt32LE(40),
        total: buf.length
    };
}

module.exports = function (t) {
    t.group('captura · el WAV');

    t.test('nace con una cabecera válida antes del primer pedazo', () => {
        const dir = carpeta();
        const s = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        const c = leerCabecera(s.archivo);
        t.eq(c.riff, 'RIFF');
        t.eq(c.wave, 'WAVE');
        t.eq(c.sampleRate, 48000);
        t.eq(c.bits, 16);
        captura.cerrar(s.id);
    });

    t.test('la cabecera declara el tamaño real en cada pedazo', () => {
        // Sin esto, el ciclo de señales pide los últimos segundos y ffmpeg le
        // cree a la cabecera: se lleva un WAV vacío y las señales de ese tramo
        // se pierden.
        const dir = carpeta();
        const s = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        captura.escribir(s.id, Buffer.alloc(4096));
        const c = leerCabecera(s.archivo);
        t.eq(c.datos, 4096, 'ya dice cuánto hay, sin haber cerrado');
        t.eq(c.total, 44 + 4096);
        captura.cerrar(s.id);
    });

    t.test('los segundos salen del audio escrito', () => {
        const dir = carpeta();
        const s = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        const r = captura.escribir(s.id, Buffer.alloc(48000 * 2));
        t.near(r.segundos, 1, 0.001);
        captura.cerrar(s.id);
    });

    t.group('captura · dónde cae un momento del reloj');

    t.test('un momento dentro del archivo da su posición', () => {
        const s = { desdeMs: 1000, segundos: 10 };
        t.eq(captura.posicionDe(s, 4000), 3);
    });

    t.test('un momento anterior al archivo no está', () => {
        t.eq(captura.posicionDe({ desdeMs: 1000, segundos: 10 }, 500), null);
    });

    t.test('un momento posterior tampoco', () => {
        t.eq(captura.posicionDe({ desdeMs: 1000, segundos: 10 }, 20000), null);
    });

    t.test('de varios archivos, elige el que lo contiene', () => {
        // Una sesión puede tener más de un WAV: el dispositivo se cayó y se
        // reabrió, o la sesión se reanudó.
        const uno = { archivo: 'a', desdeMs: 1000, segundos: 10 };
        const dos = { archivo: 'b', desdeMs: 60000, segundos: 10 };
        t.eq(captura.laQueContiene([uno, dos], 65000).archivo, 'b');
        t.eq(captura.laQueContiene([uno, dos], 5000).archivo, 'a');
        t.eq(captura.laQueContiene([uno, dos], 30000), null, 'el hueco del medio no es de nadie');
    });

    t.group('captura · cerrar');

    t.test('cerrar deja la cabecera con el tamaño final', () => {
        const dir = carpeta();
        const s = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        captura.escribir(s.id, Buffer.alloc(2048));
        const cerrada = captura.cerrar(s.id, Date.now());
        t.eq(leerCabecera(s.archivo).datos, 2048);
        t.ok(cerrada.hastaMs > 0);
        // El resumen redondea a centésimas: es un dato para mostrar, no el
        // reloj. El reloj sale de `posicionDe`, que no redondea.
        t.near(cerrada.segundos, 2048 / (48000 * 2), 0.005);
    });

    t.test('cerrarTodo no deja nada abierto', () => {
        const dir = carpeta();
        captura.abrir({ dir, nombre: 'a', sampleRate: 48000, canales: 1 });
        captura.abrir({ dir, nombre: 'b', sampleRate: 48000, canales: 1 });
        t.ok(captura.cerrarTodo().length >= 2);
        t.deep(captura.cerrarTodo(), []);
    });
};
