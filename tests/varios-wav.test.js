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

/** Una clase que quedó abierta en la carpeta, con la señal de quien la graba. */
function abiertaCon(grabandoEn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-otra-'));
    grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
    const json = grabacion._sesion().estado && require('../engine/espejo').resumen(grabacion._sesion()).archivos.json;
    grabacion.apagar();
    const datos = JSON.parse(fs.readFileSync(json, 'utf8'));
    datos.terminada = null;
    datos.grabandoEn = grabandoEn;
    fs.writeFileSync(json, JSON.stringify(datos));
    return { dir, json };
}

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

    t.group('varios WAV · una clase que se está grabando en otra Mac');

    t.test('mientras graba, el archivo de notas dice quién y cuándo; terminada, ya no', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-latido-'));
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
        const json = require('../engine/espejo').resumen(grabacion._sesion()).archivos.json;
        const grabando = JSON.parse(fs.readFileSync(json, 'utf8')).grabandoEn;
        t.eq(grabando && grabando.equipo, os.hostname());
        t.ok(Date.now() - grabando.latidoMs < 5000, 'con la hora de ahora');
        await grabacion.terminar();
        t.eq(JSON.parse(fs.readFileSync(json, 'utf8')).grabandoEn, null);
    });

    t.test('con una señal reciente de otra Mac, no se reanuda ni se borra, y la lista lo dice', () => {
        const { dir, json } = abiertaCon({ equipo: 'Mac-del-estudio', pid: 1, latidoMs: Date.now() - 30000 });
        let error = '';
        try { sesionesGrabadas.paraReanudar(json, null); } catch (e) { error = e.message; }
        t.ok(/se está grabando ahora en «Mac-del-estudio»/.test(error), error);
        error = '';
        try { sesionesGrabadas.borrar(json, null); } catch (e) { error = e.message; }
        t.ok(/Mac-del-estudio/.test(error), 'borrar tampoco');
        t.ok(fs.existsSync(json), 'y sigue en el disco');
        const lista = sesionesGrabadas.sidecaresDe(workspace.datosDir(dir), dir);
        t.eq(lista[0].resumen.estado, 'grabando en otra mac');
    });

    t.test('sin señal hace más de tres minutos, quedó abierta y se puede reanudar', () => {
        const { dir } = abiertaCon({ equipo: 'Mac-del-estudio', pid: 1, latidoMs: Date.now() - 4 * 60 * 1000 });
        const lista = sesionesGrabadas.sidecaresDe(workspace.datosDir(dir), dir);
        t.eq(lista[0].resumen.estado, 'abierta');
    });

    t.test('cerrar la app grabando deja la clase sin señal: otra Mac la puede reanudar ya', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-apagar-'));
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
        const json = require('../engine/espejo').resumen(grabacion._sesion()).archivos.json;
        grabacion.apagar();
        t.eq(JSON.parse(fs.readFileSync(json, 'utf8')).grabandoEn, null);
    });

    t.test('la señal de esta misma Mac no la bloquea: es una que se murió acá', () => {
        const { dir } = abiertaCon({ equipo: os.hostname(), pid: 1, latidoMs: Date.now() });
        const lista = sesionesGrabadas.sidecaresDe(workspace.datosDir(dir), dir);
        t.eq(lista[0].resumen.estado, 'abierta');
    });
};
