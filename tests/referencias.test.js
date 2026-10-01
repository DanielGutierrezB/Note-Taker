'use strict';
/**
 * Las fotos de referencia del OUT: dónde van, que no se pisen y que se muevan
 * y se borren con su clase.
 *
 * Lo que estas pruebas cuidan es que esto no pueda tocar nada de lo que importa.
 * Una foto es una ayuda para quien graba: si falla, se pierde una miniatura, no
 * una clase. Así que acá se fija lo que no puede pasar —que una foto se escriba
 * fuera de la carpeta del curso, que pise la del momento en que la clase paró,
 * o que quede colgada de una clase que ya no existe— y que el XML siga siendo
 * exactamente el mismo con fotos o sin ellas.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const referencias = require('../engine/referencias');
const workspace = require('../engine/workspace');
const sesiones = require('../engine/sesiones-grabadas');
const notasXml = require('../engine/notas-xml');
const vivo = require('../engine/notas-vivo');

const T0 = Date.parse('2026-09-29T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-fotos-'));
}

/** Un «JPEG»: acá nadie lo decodifica, lo que se mira es el archivo. */
function jpeg(n) {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, n || 1]);
}

/** Una clase en el disco, como la de `sesiones-grabadas.test.js`. */
function sembrar(dir, secuencia, curso) {
    const seq = secuencia || 'curso_2026-09-29_10-00-00';
    const wav = path.join(workspace.audioDir(dir), `${seq}-1.wav`);
    workspace.ensureDir(path.dirname(wav));
    fs.writeFileSync(wav, Buffer.alloc(1024));

    const estado = vivo.estadoNuevo({ secuencia: seq, curso: curso || 'curso', ceroMs: T0, fps: 30 });
    estado.sesiones = [{ archivo: wav, desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
    estado.tomas = [{
        id: 1, vista: 'PV', comentario: '', cuenta: '3, 2, 1.',
        inMs: T0 + 20000, outMs: T0 + 80000, descartada: false,
        palabras: [{ t: T0 + 20000, texto: 'Hola' }], comentarios: []
    }];
    estado.terminada = T0 + 600000;

    const archivos = workspace.archivosDeSesion(dir, seq);
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return { ...archivos, secuencia: seq };
}

module.exports = function (t) {
    t.group('referencias · dónde va cada foto');

    t.test('la foto de la toma 3 es toma-3.jpg, en la carpeta de su clase', () => {
        const dir = carpeta();
        const ruta = referencias.archivoDeToma(dir, 'curso_2026-09-29_10-00-00', 3);
        t.eq(path.basename(ruta), 'toma-3.jpg');
        t.eq(path.basename(path.dirname(ruta)), 'curso_2026-09-29_10-00-00');
        t.eq(path.basename(path.dirname(path.dirname(ruta))), 'Referencias');
    });

    t.test('queda al lado del XML y nunca adentro', () => {
        // Es lo que deja que Premiere siga leyendo la carpeta `xml` sin ver una
        // imagen suelta, y que las fotos se puedan borrar a mano sin tocar nada.
        const dir = carpeta();
        const ruta = referencias.archivoDeToma(dir, 'curso_2026-09-29_10-00-00', 1);
        t.ok(workspace.dentroDe(workspace.xmlDir(dir), ruta), ruta);
    });

    t.test('un nombre de clase con barras no se sale de la carpeta', () => {
        const dir = carpeta();
        const ruta = referencias.archivoDeToma(dir, '../../fuera', 1);
        t.ok(workspace.dentroDe(dir, ruta), ruta);
    });

    t.test('una toma que no es un número se rechaza', () => {
        const dir = carpeta();
        let error = '';
        try { referencias.archivoDeToma(dir, 'curso_x', 'tres'); } catch (e) { error = e.message; }
        t.ok(error, error);
    });

    t.group('referencias · guardar');

    t.test('escribe la foto y dice que es nueva', () => {
        const dir = carpeta();
        const r = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 2, bytes: jpeg(1) });
        t.ok(r.nueva);
        t.eq(r.toma, 2);
        t.eq(fs.readFileSync(r.ruta)[0], 0xff);
    });

    t.test('no pisa la que ya estaba', () => {
        // Es LA regla: la foto es la del instante en que se puso el OUT. Si
        // después el editor corre el OUT o reabre y cierra la toma, la foto
        // sigue siendo la de cuando la clase paró.
        const dir = carpeta();
        const a = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 2, bytes: jpeg(1) });
        const b = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 2, bytes: jpeg(9) });
        t.eq(b.nueva, false);
        t.eq(b.ruta, a.ruta);
        t.eq(fs.readFileSync(a.ruta)[4], 1, 'la de antes sigue ahí');
    });

    t.test('una foto vacía o enorme se rechaza', () => {
        const dir = carpeta();
        let vacia = '';
        try { referencias.guardar({ carpeta: dir, secuencia: 'c', toma: 1, bytes: [] }); } catch (e) { vacia = e.message; }
        t.ok(vacia, vacia);
        let gorda = '';
        try {
            referencias.guardar({
                carpeta: dir, secuencia: 'c', toma: 1,
                bytes: Buffer.alloc(referencias.TOPE_BYTES + 1)
            });
        } catch (e) { gorda = e.message; }
        t.ok(gorda, gorda);
    });

    t.group('referencias · listar');

    t.test('las devuelve por número de toma, leyendo el disco', () => {
        const dir = carpeta();
        for (const n of [10, 2, 1]) {
            referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: n, bytes: jpeg(n) });
        }
        t.deep(referencias.listar(dir, 'curso_x').map(f => f.toma), [1, 2, 10]);
    });

    t.test('una foto borrada desde el Finder deja de estar', () => {
        const dir = carpeta();
        const r = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 1, bytes: jpeg(1) });
        fs.rmSync(r.ruta);
        t.eq(referencias.listar(dir, 'curso_x').length, 0);
    });

    t.test('una clase sin fotos no es un error, es una lista vacía', () => {
        t.deep(referencias.listar(carpeta(), 'nunca-grabada'), []);
    });

    t.test('lo que no sea una foto de una toma se ignora', () => {
        const dir = carpeta();
        const r = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 1, bytes: jpeg(1) });
        fs.writeFileSync(path.join(path.dirname(r.ruta), 'captura de pantalla.jpg'), jpeg(2));
        fs.writeFileSync(path.join(path.dirname(r.ruta), 'toma-1.txt'), 'hola');
        t.deep(referencias.listar(dir, 'curso_x').map(f => f.toma), [1]);
    });

    t.group('referencias · qué se puede abrir');

    t.test('solo las fotos de una toma, y solo desde Referencias', () => {
        const dir = carpeta();
        const r = referencias.guardar({ carpeta: dir, secuencia: 'curso_x', toma: 1, bytes: jpeg(1) });
        t.ok(referencias.esDeAca(r.ruta));
        t.eq(referencias.esDeAca('/Users/x/.ssh/id_rsa'), false);
        t.eq(referencias.esDeAca('/Users/x/Fotos/toma-1.jpg'), false, 'fuera de Referencias, no');
        t.eq(referencias.esDeAca(path.join(path.dirname(r.ruta), 'otra.jpg')), false);
        t.eq(referencias.esDeAca(null), false);
    });

    t.group('referencias · se van con su clase');

    t.test('renombrar la clase se lleva las fotos', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        referencias.guardar({ carpeta: dir, secuencia: s.secuencia, toma: 1, bytes: jpeg(1) });
        const r = sesiones.renombrar(s.json, { curso: 'Otro Curso' });
        t.ok(r.movida);
        t.eq(referencias.listar(dir, s.secuencia).length, 0, 'ya no están en el nombre viejo');
        t.deep(referencias.listar(dir, r.secuencia).map(f => f.toma), [1]);
    });

    t.test('borrar la clase se lleva las fotos', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        referencias.guardar({ carpeta: dir, secuencia: s.secuencia, toma: 1, bytes: jpeg(1) });
        referencias.guardar({ carpeta: dir, secuencia: s.secuencia, toma: 2, bytes: jpeg(2) });
        const r = sesiones.borrar(s.json);
        t.eq(r.fotos, 2);
        t.eq(referencias.listar(dir, s.secuencia).length, 0);
    });

    t.test('la lista de clases las cuenta, para poder avisar antes de borrar', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        t.eq(sesiones.listar([dir])[0].resumen.fotos, 0);
        referencias.guardar({ carpeta: dir, secuencia: s.secuencia, toma: 1, bytes: jpeg(1) });
        t.eq(sesiones.listar([dir])[0].resumen.fotos, 1);
    });

    t.test('una clase sin fotos se renombra y se borra igual', () => {
        // Es el caso de siempre: sin cámara elegida en Ajustes no hay ninguna
        // foto, y nada de esto puede estorbar.
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { curso: 'Otro' });
        t.ok(r.movida);
        t.eq(sesiones.borrar(r.archivos.json).fotos, 0);
    });

    t.test('las fotos de otra clase no se mueven', () => {
        const dir = carpeta();
        const a = sembrar(dir, 'a_2026-09-29_10-00-00', 'a');
        const b = sembrar(dir, 'b_2026-09-29_11-00-00', 'b');
        referencias.guardar({ carpeta: dir, secuencia: a.secuencia, toma: 1, bytes: jpeg(1) });
        referencias.guardar({ carpeta: dir, secuencia: b.secuencia, toma: 1, bytes: jpeg(2) });
        const r = sesiones.renombrar(a.json, { curso: 'otro' });
        t.deep(referencias.listar(dir, r.secuencia).map(f => f.toma), [1]);
        t.deep(referencias.listar(dir, b.secuencia).map(f => f.toma), [1], 'la otra clase, intacta');
    });

    t.test('el XML es el mismo con fotos y sin fotos', () => {
        // La prueba de que esto no es material: la foto no entra en lo que
        // Premiere lee, ni en el sidecar del que sale «Regenerar».
        const dirA = carpeta();
        const a = sembrar(dirA);
        const sinFotos = fs.readFileSync(a.xml, 'utf8');

        const dirB = carpeta();
        const b = sembrar(dirB);
        referencias.guardar({ carpeta: dirB, secuencia: b.secuencia, toma: 1, bytes: jpeg(1) });
        const conFotos = fs.readFileSync(b.xml, 'utf8');

        t.eq(conFotos.split(dirB).join('…'), sinFotos.split(dirA).join('…'));
    });
};
