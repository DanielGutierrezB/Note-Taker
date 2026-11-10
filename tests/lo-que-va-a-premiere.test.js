'use strict';
/**
 * Lo que va a Premiere: el XML de las notas y el proyecto de la carpeta.
 *
 *   · los bordes ajustados de dos tomas vecinas no se cruzan;
 *   · «Rehacer XML» nombra el WAV donde está hoy, no donde estaba al grabar;
 *   · la plantilla que viaja en el instalador no nombra ningún curso;
 *   · el fps se revisa antes de preguntar si se reemplaza el proyecto, y una
 *     plantilla con el fps en el nombre se elige sola;
 *   · armar el proyecto le da paso al audio entre clase y clase.
 *
 * El `$` en la ruta se prueba con un proyecto entero en `prproj-carpeta.test.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ajustar = require('../engine/ajustar-corte');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const workspace = require('../engine/workspace');
const paths = require('../engine/paths');
const prproj = require('../engine/prproj');
const carpetaPrproj = require('../engine/prproj-carpeta');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const T0 = Date.parse('2026-11-04T10:00:00');

const tomaAjustada = (id, inMs, outMs, inAj, outAj) => ({
    id, inMs, outMs, descartada: false,
    ajuste: { v: ajustar.VERSION, deInMs: inMs, deOutMs: outMs, inMs: inAj, outMs: outAj, porQueIn: 'silencio', porQueOut: 'silencio' }
});

module.exports = function (t) {
    t.group('premiere · bordes que no se cruzan');

    t.test('el OUT corrido de una y el IN corrido de la siguiente se frenan en la mitad del hueco', () => {
        // A 300 ms una de otra: el OUT se fue 450 ms adelante y el IN 400 atrás.
        const a = tomaAjustada(1, 10000, 20000, 10000, 20450);
        const b = tomaAjustada(2, 20300, 30000, 19900, 30000);
        ajustar.noCruzarVecinas([a, b]);
        t.ok(ajustar.outAjustado(a) <= ajustar.inAjustado(b), `${ajustar.outAjustado(a)} ≤ ${ajustar.inAjustado(b)}`);
        t.eq(ajustar.outAjustado(a), 20150);
        t.eq(ajustar.inAjustado(b), 20150);
        t.eq(a.ajuste.porQueOut, 'vecina');
    });

    t.test('las que no se cruzan quedan como estaban', () => {
        const a = tomaAjustada(1, 10000, 20000, 10000, 20200);
        const b = tomaAjustada(2, 22000, 30000, 21700, 30000);
        ajustar.noCruzarVecinas([a, b]);
        t.eq(ajustar.outAjustado(a), 20200);
        t.eq(ajustar.inAjustado(b), 21700);
    });

    t.test('contra una toma abierta, que no tiene ajuste, el OUT no pasa su IN', () => {
        const a = tomaAjustada(1, 10000, 20000, 10000, 20450);
        const b = { id: 2, inMs: 20300, outMs: null, descartada: false };
        ajustar.noCruzarVecinas([a, b]);
        t.ok(ajustar.outAjustado(a) <= b.inMs);
    });

    t.test('si la vecina se desactiva, el freno se va con ella', () => {
        const a = tomaAjustada(1, 10000, 20000, 10000, 20450);
        const b = tomaAjustada(2, 20300, 30000, 19900, 30000);
        ajustar.noCruzarVecinas([a, b]);
        t.eq(ajustar.outAjustado(a), 20150, 'frenado');
        b.descartada = true;
        ajustar.noCruzarVecinas([a, b]);
        t.eq(ajustar.outAjustado(a), 20450, 'vuelve a lo que dio la onda');
        t.eq(a.ajuste.porQueOut, 'silencio');
    });

    t.test('un borde que no se pudo mirar sigue diciéndolo, para volver a intentarlo', () => {
        const a = tomaAjustada(1, 10000, 20000, 10000, 20000);
        a.ajuste.porQueOut = 'sin-audio';
        const b = tomaAjustada(2, 20100, 30000, 19900, 30000);
        ajustar.noCruzarVecinas([a, b]);
        t.ok(ajustar.inAjustado(b) >= ajustar.outAjustado(a), 'frenado igual');
        t.eq(b.ajuste.porQueIn, 'vecina');
        t.eq(a.ajuste.porQueOut, 'sin-audio');
    });

    t.test('una desactivada en el medio no cuenta', () => {
        const a = tomaAjustada(1, 10000, 20000, 10000, 20450);
        const fuera = { ...tomaAjustada(2, 20100, 20200, 20100, 20200), descartada: true };
        const b = tomaAjustada(3, 20300, 30000, 19900, 30000);
        ajustar.noCruzarVecinas([a, fuera, b]);
        t.ok(ajustar.outAjustado(a) <= ajustar.inAjustado(b));
    });

    t.group('premiere · el WAV donde está hoy');

    t.test('«Rehacer XML» de una carpeta movida nombra el WAV de la carpeta nueva', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-movida-'));
        try {
            const secuencia = 'curso_2026-11-04_10-00-00';
            const wav = path.join(workspace.audioDir(dir), `${secuencia}.wav`);
            workspace.ensureDir(path.dirname(wav));
            fs.writeFileSync(wav, Buffer.alloc(44));
            const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
            // Grabado en otra Mac, en otra carpeta.
            estado.sesiones = [{ archivo: `/Volumes/Otro/Curso/Audio/${secuencia}.wav`, desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
            estado.tomas = [{ id: 1, vista: 'PV', comentario: '', inMs: T0 + 10000, outMs: T0 + 40000, descartada: false, palabras: [], comentarios: [] }];
            estado.terminada = T0 + 600000;
            const archivos = workspace.archivosDeSesion(dir, secuencia);
            workspace.ensureDir(path.dirname(archivos.json));
            workspace.writeJson(archivos.json, notasXml.sidecar(estado));

            sesionesGrabadas.rehacerXml(archivos.json, null);
            const xml = fs.readFileSync(archivos.xml, 'utf8');
            t.ok(!xml.includes('/Volumes/Otro'), 'ya no la ruta del día de la grabación');
            t.ok(xml.includes(encodeURI(wav)) || xml.includes(wav), 'sino la de hoy');
            t.eq(JSON.parse(fs.readFileSync(archivos.json, 'utf8')).sesiones[0].archivo, wav, 'y el archivo de notas también');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    t.group('premiere · la plantilla del instalador');

    t.test('no nombra el curso con el que se armó', () => {
        const plantilla = path.join(RAIZ, 'plantillas', paths.PLANTILLA_PRPROJ);
        const texto = prproj.Proyecto.leer(plantilla).texto();
        t.eq((texto.match(/<RelativePath>/g) || []).length, 0, 'sin rutas relativas al material de la clase');
        t.ok(!/curso|\/CUR\//i.test(texto), 'ni el nombre del curso');
        t.ok(!/\/Users\/(?!Shared\/Note Taker\/Plantilla)/.test(texto), 'ni rutas de nadie');
    });

    t.test('la herramienta que la limpia también quita las rutas relativas', () => {
        const { neutralizar } = require('../tools/limpiar-plantilla');
        const r = neutralizar('<Media>\n\t\t<RelativePath>../../CUR/curso-x/Clase 1/grabacion-clase-1.wav</RelativePath>'
            + '\n\t\t<FilePath>/Users/x/CUR/curso-x/grabacion-clase-1.wav</FilePath>\n</Media>');
        t.ok(!/RelativePath|curso-x/.test(r.texto), r.texto);
    });

    t.group('premiere · el fps antes de preguntar');

    t.test('el puente revisa el fps antes del diálogo de reemplazar', () => {
        const js = leer('ipc', 'prproj.js');
        const antes = js.indexOf('carpetaPrproj.revisarAntes(');
        const dialogo = js.indexOf('dialog.showMessageBox(');
        t.ok(antes > 0 && antes < dialogo, 'primero la revisión');
    });

    t.test('una carpeta con clases a otro fps se rechaza sin armar nada', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-fps-'));
        try {
            const secuencia = 'curso_2026-11-04_10-00-00';
            const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 25 });
            estado.tomas = [];
            estado.terminada = T0 + 1000;
            const archivos = workspace.archivosDeSesion(dir, secuencia);
            workspace.ensureDir(path.dirname(archivos.json));
            workspace.writeJson(archivos.json, notasXml.sidecar(estado));
            const r = carpetaPrproj.revisarAntes({ carpeta: dir, enCurso: null });
            t.eq(r.ok, false);
            t.ok(/25 fps/.test(r.error) && /Plantilla-25\.prproj/.test(r.error), r.error);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    t.test('una plantilla con el fps en el nombre se elige sola', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-plantillas-'));
        const antes = process.env.NOTETAKER_PLANTILLA_PRPROJ;
        try {
            t.eq(paths.plantillaPrproj(), path.join(RAIZ, 'plantillas', paths.PLANTILLA_PRPROJ));
            t.eq(paths.plantillaPrproj(25), path.join(RAIZ, 'plantillas', paths.PLANTILLA_PRPROJ),
                'sin una de 25, la de siempre: el rechazo lo dice después con su porqué');
        } finally {
            if (antes == null) delete process.env.NOTETAKER_PLANTILLA_PRPROJ;
            else process.env.NOTETAKER_PLANTILLA_PRPROJ = antes;
            fs.rmSync(dir, { recursive: true, force: true });
        }
        t.ok(/`Plantilla-\$\{Number\(fps\)\}\.prproj`/.test(leer('engine', 'paths.js')), 'y el nombre que busca lleva el fps');
    });

    t.group('premiere · un campo que no está, se dice');

    t.test('poner un valor en una etiqueta que no está falla en vez de dejar la del molde', () => {
        const { exigido } = require('../engine/prproj-secuencia');
        t.eq('<Name>viejo</Name>'.replace(exigido(/<Name>[^<]*<\/Name>/), () => '<Name>$&</Name>'), '<Name>$&</Name>',
            'y lo que pone va tal cual, con $& y todo');
        let error = null;
        try { '<Title>x</Title>'.replace(exigido(/<Name>[^<]*<\/Name>/), () => 'y'); } catch (e) { error = e.message; }
        t.ok(error && /no está/.test(error), error);
        const conG = exigido(/a/g);
        t.eq('banana'.replace(conG, () => 'o'), 'bonono', 'con /g, todas');
        t.eq('banana'.replace(conG, () => 'o'), 'bonono', 'y otra vez igual: el lastIndex no queda colgado');
    });

    t.group('premiere · armar sin que otro gesto se meta en el medio');

    t.test('mientras se arma el proyecto de una carpeta, sus clases no se renombran ni se borran', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-generando-'));
        try {
            const json = path.join(dir, 'xml', 'Datos', 'x_notas-en-vivo.json');
            sesionesGrabadas.marcarGenerando(dir, true);
            let error = null;
            try { sesionesGrabadas.borrar(json, null); } catch (e) { error = e.message; }
            t.ok(error && /armando el proyecto/.test(error), error);
            sesionesGrabadas.marcarGenerando(dir, false);
            t.ok(/if \(carpeta\) sesionesGrabadas\.marcarGenerando\(carpeta, false\);/.test(leer('engine', 'prproj-carpeta.js')),
                'y se suelta aunque armar falle');
        } finally {
            sesionesGrabadas.marcarGenerando(dir, false);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    t.group('premiere · armar sin trabar el audio');

    t.test('entre clase y clase, el proceso principal suelta', () => {
        const js = leer('engine', 'prproj-carpeta.js');
        const generar = js.slice(js.indexOf('async function generar('));
        t.ok((generar.match(/await ceder\(\);/g) || []).length >= 4, 'al ajustar, al importar, al precortar y al terminar');
    });
};
