'use strict';
/**
 * El botón «Report» y lo que lo hace servir: que cada acción quede en el diario.
 *
 * Lo pidió el editor: un .zip en Descargas que alcance para arreglar un problema
 * sin tener que reproducirlo, y que toda acción deje su estado en el registro.
 * Se prueba lo que sale —el .zip, lo que trae y lo que no— y no cómo está
 * escrito.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const reporte = require('../engine/reporte');
const registro = require('../engine/registro');
const workspace = require('../engine/workspace');
const paths = require('../engine/paths');
const motorDeGrabacion = require('../engine/grabacion');
const { conDiario, resumirRespuesta } = require('../ipc/con-diario');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-reporte-prueba-'));

/** Un WAV de verdad, de un décimo de segundo en silencio, para que ffprobe lo lea. */
function wav(ruta) {
    const muestras = 4800;
    const b = Buffer.alloc(44 + muestras * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + muestras * 2, 4); b.write('WAVE', 8);
    b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write('data', 36); b.writeUInt32LE(muestras * 2, 40);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, b);
}

/** Una grabación en `base`, con su sidecar y su audio, tocada hace `haceMs`. */
function grabacion(base, nombre, haceMs) {
    const json = path.join(workspace.datosDir(base), `${nombre}${workspace.SUFIJO_SIDECAR}`);
    fs.mkdirSync(path.dirname(json), { recursive: true });
    fs.writeFileSync(json, JSON.stringify({ secuencia: nombre, tomas: [], archivo: path.join(os.homedir(), 'Downloads', nombre) }));
    wav(path.join(workspace.audioDir(base), `${nombre}-1.wav`));
    const t = new Date(Date.now() - haceMs);
    fs.utimesSync(json, t, t);
    return json;
}

module.exports = async function (t) {
    t.group('reporte · cada pedido de la ventana, en el diario');

    t.test('se anota qué se pidió, qué contestó en resumen y cuánto tardó', async () => {
        const handlers = {};
        const anotado = [];
        const ipc = conDiario({ handle: (c, fn) => { handlers[c] = fn; } }, (e, d) => anotado.push([e, d]));
        ipc.handle('grabar-editar', async (event, cambio) => ({ ok: true, tomas: [1, 2, 3], abierta: 4, estado: { mucho: 1 } }));
        const r = await handlers['grabar-editar']({}, { tipo: 'dividir', toma: 3, paredMs: 1234 });
        t.eq(r.tomas.length, 3, 'la respuesta llega entera a la ventana');
        const [evento, datos] = anotado[0];
        t.eq(evento, 'ipc.grabar-editar');
        t.deep(datos.pide, [{ tipo: 'dividir', toma: 3, paredMs: 1234 }], 'con lo que se pidió');
        t.deep(datos.contesta, { ok: true, tomas: { cuantos: 3 }, abierta: 4, estado: '{…}' },
            'y la respuesta en una línea: los valores sueltos y cuántos hay de cada lista');
        t.ok(datos.ms >= 0, 'y cuánto tardó');
    });

    t.test('un pedido que falla se anota como error y la ventana se entera igual', async () => {
        const handlers = {};
        const anotado = [];
        const ipc = conDiario({ handle: (c, fn) => { handlers[c] = fn; } }, (e, d) => anotado.push([e, d]));
        ipc.handle('semanal-exportar', async () => { throw new Error('ffmpeg salió con 1'); });
        let llego = null;
        try { await handlers['semanal-exportar']({}, '/x.json'); } catch (e) { llego = e.message; }
        t.eq(llego, 'ffmpeg salió con 1', 'el error sigue llegando a quien pidió');
        t.eq(anotado[0][0], 'ipc.semanal-exportar.error');
        t.eq(anotado[0][1].error, 'ffmpeg salió con 1');
    });

    t.test('los bytes no entran al diario, y lo que se calla no se anota', async () => {
        const handlers = {};
        const anotado = [];
        // Como en main.js: lo que se anota pasa por `registro.sanear`.
        const ipc = conDiario({ handle: (c, fn) => { handlers[c] = fn; }, on: () => {} },
            (e, d) => anotado.push([e, registro.sanear(d)]), new Set(['grabar-estado']));
        ipc.handle('foto-guardar', async () => true);
        ipc.handle('grabar-estado', async () => ({ tomas: [] }));
        await handlers['foto-guardar']({}, { toma: 2, jpeg: new Uint8Array(50000) });
        await handlers['grabar-estado']({});
        t.eq(anotado.length, 1, 'el estado que la ventana pregunta para pintarse no se anota');
        t.eq(anotado[0][1].pide[0].jpeg, '‹50000 bytes›', 'y de una foto queda cuánto pesa, no la foto');
        t.deep(resumirRespuesta([1, 2]), { cuantos: 2 }, 'una lista de respuesta, por cuántos trae');
    });

    t.test('un diario que falla no cambia lo que contesta la acción', async () => {
        const handlers = {};
        const ipc = conDiario({ handle: (c, fn) => { handlers[c] = fn; } }, () => { throw new Error('disco lleno'); });
        ipc.handle('ajustes-guardar', async () => ({ ok: true }));
        t.deep(await handlers['ajustes-guardar']({}, { idioma: 'es' }), { ok: true }, 'se guardó, y la ventana lo sabe');
    });

    t.test('lo que alguien escribió queda como cuánto mide', async () => {
        const handlers = {};
        const anotado = [];
        const ipc = conDiario({ handle: (c, fn) => { handlers[c] = fn; } }, (e, d) => anotado.push([e, registro.sanear(d)]));
        ipc.handle('grabar-editar', async () => ({ ok: true }));
        await handlers['grabar-editar']({}, { tipo: 'nota', toma: 3, comentario: 'esto lo dijo mal, repetir' });
        t.deep(anotado[0][1].pide[0], { tipo: 'nota', toma: 3, comentario: '‹25 caracteres›' });
    });

    t.test('todos los módulos registran por el que anota', () => {
        const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
        t.ok(!/ipcMain\.handle\(/.test(main), 'en main.js ningún handle se salta el diario');
        for (const m of ['ipcGrabar', 'ipcPrproj', 'ipcReferencias', 'ipcSemanal', 'ipcReporte']) {
            t.ok(new RegExp(`${m}\\.registrar\\(\\{ ipcMain: ipc,`).test(main), `${m} recibe el que anota`);
        }
        t.ok(/ipcMain: ipc, BrowserWindow/.test(main), 'y la mirilla también');
    });

    t.group('reporte · cada gesto de la ventana, en el diario');

    t.test('un clic dice qué hace, sobre qué, y lo que dice el botón', async () => {
        const acciones = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'acciones.js')).href);
        const boton = {
            id: '', dataset: { hace: 'dividir-aca', toma: '3' },
            getAttribute: () => null, textContent: '\n   Dividir    acá  '
        };
        t.deep(acciones.describir(boton), { que: 'dividir-aca', dice: 'Dividir acá', datos: { hace: 'dividir-aca', toma: '3' } });
        const sinNada = { id: 'btn-reporte', dataset: {}, getAttribute: () => 'Report', textContent: '' };
        t.deep(acciones.describir(sinNada), { que: 'btn-reporte', dice: 'Report', datos: null },
            'sin data-hace, su id; y lo que dice para un lector de pantalla');
    });

    t.test('la ventana empieza a anotar apenas arranca', () => {
        const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
        const arranque = app.slice(app.indexOf('async function arrancar() {'));
        t.ok(/^async function arrancar\(\) \{\s*\/\/[^\n]*\n\s*anotarLosGestos\(window\.nt\.anotar\);/.test(arranque),
            'lo primero que hace, antes de leer los ajustes');
    });

    t.group('reporte · el .zip');

    t.test('las últimas grabaciones: de un curso y del vídeo de la semana, la más nueva primero', () => {
        const curso = tmp();
        const semana = tmp();
        grabacion(curso, 'curso_clase-1', 3 * 3600e3);
        grabacion(curso, 'curso_clase-2', 2 * 3600e3);
        grabacion(path.join(semana, 'Grabación-2026-10-23_10-24-32'), 'downloads_2026-10-23_10-24-32', 60e3);
        grabacion(path.join(semana, 'Grabación-2026-10-22_17-38-06'), 'downloads_2026-10-22_17-38-06', 24 * 3600e3);
        fs.mkdirSync(path.join(semana, 'otra cosa'));
        // En un disco exFAT cada archivo tiene su `._nombre` al lado, más nuevo que él.
        fs.writeFileSync(path.join(workspace.datosDir(curso), `._curso_clase-1${workspace.SUFIJO_SIDECAR}`), 'basura');
        fs.writeFileSync(path.join(workspace.audioDir(curso), '._curso_clase-1-1.wav'), 'basura');
        const ultimas = reporte.ultimasGrabaciones([curso, semana, null, '/no/existe']);
        t.deep(ultimas.map(s => s.nombre), ['downloads_2026-10-23_10-24-32', 'curso_clase-2', 'curso_clase-1']);
        t.eq(ultimas.length, reporte.CUANTAS_GRABACIONES);
        t.deep(reporte.mediosDe(ultimas[2]).map(m => path.basename(m)), ['curso_clase-1-1.wav'], 'y sin los ocultos del disco');
    });

    t.test('de cada grabación, solo sus audios y vídeos', () => {
        const curso = tmp();
        grabacion(curso, 'curso_clase-1', 0);
        grabacion(curso, 'curso_clase-2', 0);
        fs.writeFileSync(path.join(workspace.audioDir(curso), 'curso_clase-1-1.txt'), 'no es un medio');
        const [sesion] = reporte.ultimasGrabaciones([curso]).filter(s => s.nombre === 'curso_clase-1');
        t.deep(reporte.mediosDe(sesion).map(m => path.basename(m)), ['curso_clase-1-1.wav'],
            'los WAV de las otras clases de la carpeta no son de esta');
        // Y la 10 no es la 1: por prefijo a secas, la clase 1 se los llevaba.
        grabacion(curso, 'curso_clase-10', 0);
        t.deep(reporte.mediosDe(sesion).map(m => path.basename(m)), ['curso_clase-1-1.wav'], 'ni los de la clase 10');
    });

    t.test('los cuelgues: los de la app y de las últimas dos semanas', () => {
        const dir = tmp();
        for (const [n, dias] of [['Note Taker-2026-10-23.ips', 1], ['Note Taker-2026-09-01.ips', 40],
            ['Safari-2026-10-23.ips', 1], ['Electron-2026-10-22.ips', 2]]) {
            const f = path.join(dir, n);
            fs.writeFileSync(f, '{}');
            const t0 = new Date(Date.now() - dias * 24 * 3600e3);
            fs.utimesSync(f, t0, t0);
        }
        t.deep(reporte.cuelguesDe(dir, ['Note Taker', 'Electron']).map(f => path.basename(f)),
            ['Note Taker-2026-10-23.ips', 'Electron-2026-10-22.ips']);
        t.deep(reporte.cuelguesDe('/no/existe', ['Note Taker']), [], 'sin carpeta, sin cuelgues');
    });

    t.test('arma el .zip con el diario, el sistema, las grabaciones y sin secretos', async () => {
        const descargas = tmp();
        const curso = tmp();
        grabacion(curso, 'curso_clase-1', 0);
        registro.limpiar();
        registro.anotar('ventana', 'ui.clic', { pantalla: 'vista-semanal', que: 'grabar' });
        const ffprobe = (paths.ffprobe() || {}).path || null;
        const r = await reporte.armar({
            dir: descargas,
            cabecera: { version: '0.6.0' },
            sistema: { mac: { macos: '26.0' }, permisos: { microfono: 'granted' } },
            ajustes: { carpeta: curso, claveAnthropic: 'sk-ant-123456789012345678', prproj: { vistas: { PV: { capturas: [1] } } } },
            herramientas: { doctor: [] },
            ventana: { dispositivos: [{ tipo: 'audioinput', nombre: 'AirPods de Daniel' }] },
            carpetas: [curso],
            ffprobe
        });
        t.ok(r.ok, r.error || 'se armó');
        t.ok(/NoteTaker-reporte-\d{8}-\d{6}\.zip$/.test(r.archivo) && fs.existsSync(r.archivo), 'y quedó en Descargas');
        const abierto = tmp();
        execFileSync('/usr/bin/ditto', ['-x', '-k', r.archivo, abierto]);
        const [raiz] = fs.readdirSync(abierto);
        const leer = f => fs.readFileSync(path.join(abierto, raiz, f), 'utf8');
        for (const f of ['LEEME.md', 'diario.md', 'diario.ndjson', 'sistema.json', 'ajustes.json', 'herramientas.json', 'ventana.json']) {
            t.ok(fs.existsSync(path.join(abierto, raiz, f)), `trae ${f}`);
        }
        t.ok(/"evento":"ui\.clic"/.test(leer('diario.ndjson')), 'el diario trae lo que se hizo');
        const ajustes = JSON.parse(leer('ajustes.json'));
        t.eq(ajustes.claveAnthropic, registro.OCULTO, 'la clave no viaja');
        t.deep(ajustes.prproj.vistas.PV.capturas, [1], 'y los ajustes van enteros, aunque estén hondos');
        t.ok(/AirPods de Daniel/.test(leer('ventana.json')), 'con el micrófono que veía la ventana');
        t.ok(fs.existsSync(path.join(abierto, raiz, 'grabaciones', 'curso_clase-1', `curso_clase-1${workspace.SUFIJO_SIDECAR}`)),
            'con el sidecar de la última grabación');
        t.ok(!leer(`grabaciones/curso_clase-1/curso_clase-1${workspace.SUFIJO_SIDECAR}`).includes(os.homedir()),
            'sin la carpeta de usuario adentro, como promete el LEEME');
        if (ffprobe) {
            const [ficha] = JSON.parse(leer('grabaciones/curso_clase-1/medios.json'));
            t.eq(ficha.archivo, 'curso_clase-1-1.wav');
            t.eq(Number(ficha.streams[0].sample_rate), 48000, 'y la ficha de su audio, con la tasa');
        }
        t.ok(!fs.readdirSync(path.join(abierto, raiz), { recursive: true }).some(f => /\.(wav|mp4)$/.test(String(f))),
            'pero ni un audio ni un vídeo');
    });

    t.test('un pedazo que falla se dice en el LEEME, y el resto sale igual', async () => {
        const descargas = tmp();
        const curso = tmp();
        const json = grabacion(curso, 'curso_clase-1', 0);
        // Un sidecar que se encuentra pero no se deja leer.
        fs.chmodSync(json, 0o000);
        const r = await reporte.armar({ dir: descargas, cabecera: {}, carpetas: [curso], ffprobe: null });
        fs.chmodSync(json, 0o644);
        t.ok(r.ok, 'el reporte sale igual');
        t.ok(r.faltan.some(f => /curso_clase-1/.test(f)), `y dice qué faltó (${r.faltan.join('; ')})`);
    });

    t.group('reporte · el diario no crece sin techo');

    t.test('la deriva se avisa al duplicarse, no cada dos segundos', () => {
        // Una entrada trabada sube un escalón cada dos segundos: avisando en cada
        // uno, una instancia sin ventana llenó el diario durante más de un día.
        let avisado = 0;
        const avisos = [];
        for (let escalon = 0; escalon <= 1800; escalon++) {
            if (motorDeGrabacion.tocaAvisarDeriva(escalon, avisado)) { avisos.push(escalon); avisado = escalon; }
        }
        t.deep(avisos.slice(0, 5), [1, 2, 4, 8, 16], 'a los 2 s, 4, 8, 16…');
        t.ok(avisos.length <= 12, `una hora trabado son ${avisos.length} avisos, no 1800`);
    });

    t.test('y se recorta mientras corre, no solo al abrir', () => {
        // Este tiene que ir último: abre el diario en disco para todo el proceso.
        const dir = tmp();
        registro.abrirDiario(dir);
        const archivo = path.join(dir, 'diario.ndjson');
        const muchas = Math.ceil(registro.TOPE_EN_DISCO * 1.5) + 50;
        for (let i = 0; i < muchas; i++) registro.anotar('main', 'prueba.linea', { i });
        registro.volcar();
        const lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n');
        t.ok(lineas.length <= registro.TOPE_EN_DISCO, `quedan ${lineas.length}, el tope es ${registro.TOPE_EN_DISCO}`);
        t.eq(JSON.parse(lineas[lineas.length - 1]).datos.i, muchas - 1, 'y son las últimas, no las primeras');
    });
};
