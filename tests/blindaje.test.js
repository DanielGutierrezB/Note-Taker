'use strict';
/**
 * Las protecciones de una grabadora, que a la app le faltaban.
 *
 *   · la Mac no se duerme mientras se graba, ni Chromium frena la ventana;
 *   · lo escrito baja al disco y el archivo de notas de antes se conserva;
 *   · las fallas que no dejaban rastro ahora lo dejan;
 *   · al terminar se comprueba la clase;
 *   · al despertar, el audio sigue en un WAV nuevo; la ventana caída se recarga.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const captura = require('../engine/captura');
const grabacion = require('../engine/grabacion');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');
const comprobarClase = require('../engine/comprobar-clase');
const disco = require('../engine/disco');
const { pathToFileURL } = require('url');
const registro = require('../engine/registro');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const T0 = Date.parse('2026-11-04T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-blindaje-'));
}

function pedazo(muestras) {
    return Buffer.alloc((muestras || 4096) * 2);
}

/** Un WAV de `segundos` de silencio, con su cabecera. */
function wavDe(archivo, segundos) {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const bytes = Math.round(segundos * 48000) * 2;
    fs.writeFileSync(archivo, Buffer.concat([captura.cabecera(bytes, 48000, 1), Buffer.alloc(bytes)]));
}

module.exports = async function (t) {
    const estados = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'estados.js')).href);

    t.group('blindaje · la Mac despierta y la ventana sin frenar');

    t.test('mientras se graba no se duerme, y al terminar se suelta', () => {
        const main = leer('main.js');
        t.ok(/powerSaveBlocker\.start\('prevent-app-suspension'\)/.test(main), 'se bloquea el sueño');
        t.ok(/powerSaveBlocker\.stop\(bloqueoDelSueno\)/.test(main), 'y se suelta');
        t.ok(/setInterval\(vigilarElSueno, 2000\)/.test(main), 'mirando cada dos segundos, termine como termine la clase');
        t.ok(/backgroundThrottling: false/.test(main), 'y Chromium no frena la ventana tapada');
    });

    t.test('al despertar, el audio sigue en un WAV nuevo, en su hora', () => {
        const main = leer('main.js');
        t.ok(/powerMonitor\.on\('resume', \(\) => \{[\s\S]{0,200}grabacion\.despertar\(/.test(main));
        t.ok(/function despertar\(s\)[\s\S]{0,400}reabrir\(s, AL_DESPERTAR\)/.test(leer('engine', 'audio-de-la-sesion.js')),
            'que reabre el audio');
        grabacion.iniciar({ dir: carpeta(), curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
        try {
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            const antes = grabacion._sesion().captura;
            const r = grabacion.reabrirAudio('La Mac se durmió.');
            t.ok(r.ok, r.error);
            const ahora = grabacion._sesion().captura;
            t.ok(ahora.archivo !== antes.archivo, 'otro WAV');
            t.eq(ahora.sampleRate, antes.sampleRate, 'con la misma tasa');
            t.eq(r.estado.dispositivo, 'MacBook', 'y la misma entrada');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('una ventana que se cae se vuelve a cargar', () => {
        t.ok(/'render-process-gone'[\s\S]{0,300}mainWindow\.reload\(\)/.test(leer('main.js')));
    });

    t.test('los atrasos del proceso principal quedan en el diario', () => {
        const main = leer('main.js');
        t.ok(/setInterval\(vigilarElAtraso, 500\)/.test(main));
        // Con la Mac dormida el reloj no corre: eso no se anota como atraso.
        const vigia = main.slice(main.indexOf('function vigilarElAtraso() {'), main.indexOf('anotar(\'main.atrasado\''));
        t.ok(/if \(macDormida\) \{\s*esperadoMs = 0;\s*return;/.test(vigia), 'dormida, no mide y empieza de cero al volver');
        t.ok(/on\('suspend', \(\) => \{\s*macDormida = true;/.test(main) && /on\('resume', \(\) => \{\s*macDormida = false;/.test(main));
        t.ok(/anotar\('main\.atrasado', \{/.test(main), 'con lo que se había anotado antes');
    });

    t.group('blindaje · lo escrito queda en el disco');

    t.test('el WAV se asegura en el disco cada pocos segundos', () => {
        const dir = carpeta();
        const real = fs.fsyncSync;
        let veces = 0;
        fs.fsyncSync = fd => { veces++; return real(fd); };
        try {
            const abierto = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
            captura.escribir(abierto.id, pedazo());
            captura.escribir(abierto.id, pedazo());
            captura.cerrar(abierto.id);
        } finally {
            fs.fsyncSync = real;
        }
        t.eq(veces, 1, 'el primer pedazo, y no cada uno');
    });

    t.test('un pedazo que no se pudo escribir deja su hueco, y lo de después cae en su sitio', () => {
        const dir = carpeta();
        const abierto = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        const uno = Buffer.alloc(4096 * 2, 1);
        const tres = Buffer.alloc(4096 * 2, 3);
        captura.escribir(abierto.id, uno);
        const real = fs.writeSync;
        fs.writeSync = () => { throw new Error('EIO'); };
        let error = null;
        try { captura.escribir(abierto.id, Buffer.alloc(4096 * 2, 2)); } catch (e) { error = e; } finally { fs.writeSync = real; }
        t.ok(error, 'el error sale, para que quien escribe lo diga');
        captura.escribir(abierto.id, tres);
        captura.cerrar(abierto.id);
        const wav = fs.readFileSync(abierto.archivo);
        t.eq(wav.length, 44 + 3 * 4096 * 2, 'mide los tres pedazos');
        t.eq(wav[44 + 2 * 4096 * 2], 3, 'el tercero está donde va, no corrido sobre el hueco');
        t.eq(wav[44 + 4096 * 2], 0, 'y el hueco es silencio');
    });

    t.test('el archivo de notas se asegura y el de antes queda al lado', () => {
        const dir = carpeta();
        const json = path.join(dir, 'x_notas-en-vivo.json');
        workspace.writeJson(json, { v: 1 }, { asegurar: true, conservarAnterior: true });
        workspace.writeJson(json, { v: 2 }, { asegurar: true, conservarAnterior: true });
        t.eq(JSON.parse(fs.readFileSync(json, 'utf8')).v, 2);
        t.eq(JSON.parse(fs.readFileSync(`${json}${workspace.ANTERIOR}`, 'utf8')).v, 1);
        t.ok(/asegurar: true, conservarAnterior: true/.test(leer('engine', 'espejo.js')), 'y la sesión lo pide');
    });

    t.test('si el archivo de notas quedó roto, se lee el de antes', () => {
        const dir = carpeta();
        const estado = vivo.estadoNuevo({ secuencia: 'curso_x', curso: 'curso', ceroMs: T0, fps: 30 });
        const archivos = workspace.archivosDeSesion(dir, 'curso_x');
        workspace.writeJson(archivos.json, notasXml.sidecar(estado), { conservarAnterior: true });
        workspace.writeJson(archivos.json, notasXml.sidecar(estado), { conservarAnterior: true });
        fs.writeFileSync(archivos.json, '{"secuencia": "curso_x", "tom');
        const r = sesionesGrabadas.paraMirar(archivos.json, null);
        t.ok(r && r.secuencia === 'curso_x', 'se abrió con el de antes');
    });

    t.group('blindaje · lo que fallaba sin decirlo');

    t.test('un recorte que ffmpeg no pudo hacer queda en el diario', () => {
        const antes = registro.todo().length;
        const r = captura.recorte({ sesion: { archivo: '/no/existe.wav', desdeMs: T0, segundos: 10 }, desdeMs: T0, hastaMs: T0 + 2000 });
        t.eq(r, null);
        const nuevas = registro.todo().slice(antes).map(l => l.evento);
        const hayFfmpeg = Boolean(require('../engine/paths').ffmpeg().path);
        if (hayFfmpeg) t.ok(nuevas.includes('captura.recorte-falla'), nuevas.join(', '));
    });

    t.test('whisper-server que se cae solo queda en el diario', () => {
        t.ok(/registro\.anotar\('main', 'residente\.se-cayo'/.test(leer('engine', 'oido-residente.js')));
    });

    t.group('blindaje · el disco');

    t.test('se prueba escribiendo, y se dice cuánta clase entra', () => {
        const r = disco.revisar(carpeta());
        t.eq(r.escribible, true);
        t.ok(r.minutos > 0, `${r.minutos} min`);
        const no = disco.revisar('/no/existe/esta/carpeta');
        t.eq(no.escribible, false, 'una carpeta que no está no se puede escribir');
        t.ok(no.error, 'y dice por qué');
        t.eq(disco.bytesPorMinuto(48000, 1), 48000 * 2 * 60, 'unos 345 MB por hora');
    });

    t.test('Preparar frena sin carpeta, sin poder escribir o sin espacio, y avisa con poco', () => {
        t.eq(estados.deCarpeta(null, null).listo, 'mal');
        t.eq(estados.deCarpeta('/x', { escribible: false, error: 'EROFS' }).listo, 'mal');
        t.eq(estados.deCarpeta('/x', { escribible: true, minutos: 10 }).listo, 'mal', 'diez minutos no alcanzan para una clase');
        const poco = estados.deCarpeta('/x', { escribible: true, minutos: 100 });
        t.eq(poco.listo, 'si', 'cien sí, para una corta');
        t.eq(poco.clave, 'en silencio', 'pero en ámbar');
        t.eq(estados.deCarpeta('/x', { escribible: true, minutos: null }).listo, 'si', 'un disco de red que no dice cuánto queda no frena');
        t.eq(estados.deCarpeta('/x', { escribible: true, minutos: 5000 }).clave, 'listo');
    });

    t.test('grabando, avisa al cruzar cada umbral, una vez', () => {
        grabacion.iniciar({ dir: carpeta(), curso: 'prueba', fps: 30, sinReloj: true });
        const avisos = [];
        const real = disco.revisar;
        let minutos = 200;
        disco.revisar = () => ({ escribible: true, libre: 0, minutos });
        try {
            const s = grabacion._sesion();
            s.avisar = a => avisos.push(a);
            for (minutos of [200, 59, 55, 29, 28, 4]) {
                s.discoMiradoMs = 0;
                grabacion.vigilarDisco();
            }
        } finally {
            disco.revisar = real;
            grabacion.apagar();
        }
        t.deep(avisos.map(a => /Quedan unos (\d+) min/.exec(a.mensaje)[1]), ['59', '29', '4']);
    });

    t.group('blindaje · la clase que quedó abierta');

    t.test('al abrir la app se ofrece seguirla', () => {
        const app = leer('src', 'js', 'app.js');
        t.ok(/await sesiones\.ver\(\);\s*await ofrecerLaQueQuedoAbierta\(\);/.test(app));
        const fn = app.slice(app.indexOf('async function ofrecerLaQueQuedoAbierta() {'));
        t.ok(/s\.resumen\.estado === 'abierta' && Date\.now\(\) - s\.ceroMs < ABIERTA_RECIENTE_MS/.test(fn), 'solo las recientes');
        t.ok(/app\.irAPreparar\(\{ reanudar: abierta\.archivos\.json/.test(fn), 'y lleva a reanudarla');
    });

    t.group('blindaje · al terminar se comprueba la clase');

    t.test('una clase entera pasa', () => {
        const dir = carpeta();
        const wav = path.join(dir, 'a.wav');
        wavDe(wav, 30);
        const xml = path.join(dir, 'a.xml');
        const json = path.join(dir, 'a.json');
        fs.writeFileSync(xml, '<xmeml></xmeml>\n');
        fs.writeFileSync(json, '{}');
        const r = comprobarClase.comprobar({
            sesiones: [{ archivo: wav, desdeMs: T0, hastaMs: T0 + 30000, segundos: 30, sampleRate: 48000, canales: 1 }],
            tomas: [{ id: 1, inMs: T0 + 1000, outMs: T0 + 9000, palabras: [{ t: T0 + 1000, texto: 'Hola' }] }]
        }, { xml, json });
        t.ok(r.ok, r.problemas.join(' '));
        t.eq(r.segundos, 30, 'y dice cuánto audio hay');
    });

    t.test('dice lo que falta: audio corto contra el reloj, una toma sin texto, el XML cortado', () => {
        const dir = carpeta();
        const wav = path.join(dir, 'a.wav');
        wavDe(wav, 20);
        const xml = path.join(dir, 'a.xml');
        fs.writeFileSync(xml, '<xmeml><sequence>');
        const r = comprobarClase.comprobar({
            sesiones: [
                { archivo: wav, desdeMs: T0, hastaMs: T0 + 30000, segundos: 20, sampleRate: 48000, canales: 1 },
                { archivo: path.join(dir, 'b.wav'), desdeMs: T0 + 40000, hastaMs: T0 + 50000, segundos: 10, sampleRate: 48000, canales: 1 }
            ],
            tomas: [
                { id: 1, inMs: T0 + 1000, outMs: T0 + 9000, palabras: [] },
                { id: 2, inMs: T0 + 10000, outMs: null, palabras: [{ t: T0 + 10000, texto: 'x' }] },
                { id: 3, inMs: T0 + 12000, outMs: T0 + 13000, palabras: [], descartada: true }
            ]
        }, { xml, json: path.join(dir, 'no-esta.json') });
        const dice = r.problemas.join(' | ');
        t.eq(r.ok, false);
        t.ok(/le faltan 10 s contra el reloj/.test(dice), dice);
        t.ok(/No está el audio b\.wav/.test(dice), 'el WAV que no está');
        t.ok(/La toma 1 no tiene texto/.test(dice), 'la toma sin texto');
        t.ok(/La toma 2 quedó sin uno de sus bordes/.test(dice), 'la toma sin OUT');
        t.ok(!/toma 3/.test(dice), 'y la desactivada no cuenta');
        t.ok(/XML quedó cortado/.test(dice), 'el XML cortado');
        t.ok(/No está no-esta\.json/.test(dice), 'el archivo de notas que no está');
    });

    t.test('«Terminar» devuelve la comprobación y los segundos del audio, que antes daban cero', async () => {
        grabacion.iniciar({ dir: carpeta(), curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 24; i++) grabacion.pcm(pedazo());
        const salida = await grabacion.terminar();
        t.ok(salida.comprobacion, 'trae la comprobación');
        t.near(salida.segundos, 24 * 4096 / 48000, 0.1, `y ${salida.segundos} s de audio`);
        t.ok(/avisoDeComprobacion\(problemas\)/.test(leer('src', 'js', 'pantalla-cierre.js')), 'y la pantalla de cierre la muestra');
    });
};
