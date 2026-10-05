'use strict';
/**
 * Las sesiones que ya están en el disco: listar, renombrar, borrar y reanudar.
 *
 * Lo que estas pruebas cuidan sobre todo es el ORDEN de las escrituras. Las
 * tres operaciones tocan tres archivos y tres archivos no se pueden escribir de
 * una: lo que se fija acá es que un corte a la mitad nunca deje una sesión
 * desaparecida de la lista, que es lo único que no se puede arreglar mirando.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sesiones = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');
const notasXml = require('../engine/notas-xml');
const vivo = require('../engine/notas-vivo');

const T0 = Date.parse('2026-09-29T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-lista-'));
}

/** Deja una sesión escrita en el disco, con su WAV de mentira. */
function sembrar(dir, opciones) {
    const o = opciones || {};
    const secuencia = o.secuencia || 'curso_2026-09-29_10-00-00';
    const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
    workspace.ensureDir(path.dirname(wav));
    fs.writeFileSync(wav, Buffer.alloc(1024));

    // Todo cuelga del cero, que por defecto es `T0`: así una sesión sembrada con
    // otra hora queda coherente —el WAV, las tomas y la claqueta se mueven con
    // ella— y el orden de la lista se puede probar de verdad.
    const cero = o.ceroMs != null ? o.ceroMs : T0;
    const estado = vivo.estadoNuevo({ secuencia, curso: o.curso || 'curso', ceroMs: cero, fps: 30 });
    estado.sesiones = [{ archivo: wav, desdeMs: cero, segundos: 600, sampleRate: 48000, canales: 1 }];
    estado.tomas = o.tomas || [{
        id: 1, vista: 'PV', comentario: 'Una', cuenta: '3, 2, 1.',
        inMs: cero + 20000, outMs: cero + 80000, descartada: false,
        palabras: [{ t: cero + 20000, texto: 'Hola' }], comentarios: []
    }];
    if (o.claquetas !== false) {
        vivo.anotarClaqueta(estado, { ms: cero + 12000, confirmada: true, origen: 'golpe' });
    }
    if (o.terminada !== false) estado.terminada = cero + 600000;

    const archivos = workspace.archivosDeSesion(dir, secuencia);
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return { ...archivos, secuencia, wav };
}

module.exports = function (t) {
    t.group('sesiones-grabadas · listar');

    // El modo semanal pasó a darle una carpeta a cada grabación. Lo que estas
    // dos pruebas cuidan es el día del cambio: en la misma carpeta hay
    // grabaciones de las dos formas, y una lista que solo entendiera la nueva
    // las habría escondido sin borrarlas, que es peor que borrarlas.
    t.test('encuentra una grabación con su carpeta propia', () => {
        const casa = carpeta();
        const suya = workspace.carpetaDeGrabacion(casa, '2026-09-29_10-00-00');
        sembrar(suya, { secuencia: 'semana_2026-09-29_10-00-00' });
        const lista = sesiones.listar([casa]);
        t.eq(lista.length, 1, 'la encuentra un piso más abajo');
        t.eq(lista[0].secuencia, 'semana_2026-09-29_10-00-00');
        t.eq(lista[0].carpeta, suya, 'y dice la carpeta de la grabación, no la de arriba');
    });

    t.test('las de antes y las de ahora salen juntas, sin repetirse', () => {
        const casa = carpeta();
        sembrar(casa, { secuencia: 'semana_2026-09-28_09-00-00', ceroMs: T0 - 86400000 });
        sembrar(workspace.carpetaDeGrabacion(casa, '2026-09-29_10-00-00'),
            { secuencia: 'semana_2026-09-29_10-00-00', ceroMs: T0 });
        const lista = sesiones.listar([casa]);
        t.eq(lista.length, 2);
        t.eq(lista.map(x => x.secuencia).join(' '),
            'semana_2026-09-29_10-00-00 semana_2026-09-28_09-00-00', 'la última primero');
    });

    // Una carpeta renombrada a mano sigue siendo una grabación: lo que la hace
    // una es tener el archivo con la hora del día adentro, no cómo se llame.
    t.test('una carpeta renombrada a mano se sigue viendo', () => {
        const casa = carpeta();
        sembrar(path.join(casa, 'La semana que hablé del precio'),
            { secuencia: 'semana_2026-09-29_10-00-00' });
        t.eq(sesiones.listar([casa]).length, 1);
    });

    t.test('encuentra lo que hay y lo resume', () => {
        const dir = carpeta();
        sembrar(dir);
        const lista = sesiones.listar([dir]);
        t.eq(lista.length, 1);
        t.eq(lista[0].resumen.tomas, 1);
        t.eq(lista[0].resumen.claquetas, 1);
        t.eq(lista[0].resumen.segundos, 600);
        t.eq(lista[0].resumen.estado, 'terminada');
    });

    t.test('una sesión sin cerrar se dice `abierta`', () => {
        const dir = carpeta();
        sembrar(dir, { terminada: false });
        t.eq(sesiones.listar([dir])[0].resumen.estado, 'abierta');
    });

    t.test('una con tomas sin releer se dice `sin releer`', () => {
        const dir = carpeta();
        sembrar(dir, {
            tomas: [{
                id: 1, vista: 'PV', inMs: T0 + 1000, outMs: T0 + 2000, descartada: false,
                palabras: [], comentarios: [], relectura: { estado: 'sin-leer' }
            }]
        });
        const r = sesiones.listar([dir])[0].resumen;
        t.eq(r.estado, 'sin releer');
        t.eq(r.sinReleer, 1);
    });

    t.test('la que se está grabando no aparece', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        t.eq(sesiones.listar([dir], s.secuencia).length, 0);
    });

    t.test('un sidecar roto no tira la lista entera', () => {
        const dir = carpeta();
        sembrar(dir);
        fs.writeFileSync(
            path.join(workspace.datosDir(dir), `roto${workspace.SUFIJO_SIDECAR}`), '{no json');
        t.eq(sesiones.listar([dir]).length, 1, 'la buena sigue');
    });

    t.test('una carpeta que no existe no rompe nada', () => {
        t.deep(sesiones.listar(['/no/existe/para/nada']), []);
    });

    t.group('sesiones-grabadas · renombrar');

    t.test('cambia el curso y mueve los tres archivos', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { curso: 'Otro Curso' });
        t.ok(r.movida);
        t.eq(r.secuencia, 'otro-curso_2026-09-29_10-00-00');
        t.ok(fs.existsSync(r.archivos.xml), 'el XML nuevo está');
        t.ok(fs.existsSync(r.archivos.json), 'y el sidecar');
        t.eq(fs.existsSync(s.xml), false, 'el viejo se fue');
        t.eq(r.audios, 1, 'y el WAV se movió con él');
    });

    t.test('el sidecar nuevo apunta al WAV donde está ahora', () => {
        // Es de donde sale el clip de A1 y «Regenerar» meses después.
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { curso: 'Otro' });
        const sidecar = JSON.parse(fs.readFileSync(r.archivos.json, 'utf8'));
        t.ok(fs.existsSync(sidecar.sesiones[0].archivo), sidecar.sesiones[0].archivo);
    });

    t.test('nunca cambia la hora', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { curso: 'Otro' });
        t.ok(r.secuencia.endsWith('_2026-09-29_10-00-00'));
    });

    t.test('el mismo nombre no mueve nada', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { curso: 'curso' });
        t.eq(r.movida, false);
    });

    t.test('un nombre que ya existe se rechaza', () => {
        const dir = carpeta();
        const a = sembrar(dir, { secuencia: 'a_2026-09-29_10-00-00', curso: 'a' });
        sembrar(dir, { secuencia: 'b_2026-09-29_10-00-00', curso: 'b' });
        let error = null;
        try { sesiones.renombrar(a.json, { curso: 'b' }); } catch (e) { error = e.message; }
        t.ok(error && error.includes('Ya hay una sesión'), error);
        t.ok(fs.existsSync(a.xml), 'y la original sigue entera');
    });

    t.test('un curso vacío se rechaza', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.renombrar(s.json, { curso: '   ' }); } catch (e) { error = e.message; }
        t.ok(error && error.includes('vacío'), error);
    });

    t.test('la que se está grabando no se renombra', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.renombrar(s.json, { curso: 'x' }, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.group('sesiones-grabadas · renombrar con un nombre delante');

    t.test('lo escrito va DELANTE del nombre de siempre, como se escribió', () => {
        // El editor: «el renombre debería agregarse antes del nombre que pone
        // ahorita por default». El curso, la fecha y la hora se quedan.
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { prefijo: 'Clase 3 Física' });
        t.ok(r.movida);
        t.eq(r.secuencia, 'Clase 3 Física_curso_2026-09-29_10-00-00');
        t.ok(fs.existsSync(r.archivos.xml) && fs.existsSync(r.archivos.json));
        t.eq(r.audios, 1, 'el WAV se mueve con el nombre nuevo');
        const sidecar = JSON.parse(fs.readFileSync(r.archivos.json, 'utf8'));
        t.eq(sidecar.prefijo, 'Clase 3 Física', 'se guarda aparte');
        t.eq(sidecar.curso, 'curso', 'y el curso no se toca');
        t.ok(fs.readFileSync(r.archivos.xml, 'utf8').includes('Clase 3 Física_curso_2026-09-29_10-00-00'),
            'la secuencia del XML también se llama así');
    });

    t.test('renombrar otra vez lo reemplaza, no le suma otro delante', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const a = sesiones.renombrar(s.json, { prefijo: 'Clase 3' });
        const b = sesiones.renombrar(a.archivos.json, { prefijo: 'Clase 4' });
        t.eq(b.secuencia, 'Clase 4_curso_2026-09-29_10-00-00');
    });

    t.test('vacío vuelve al nombre de siempre', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const a = sesiones.renombrar(s.json, { prefijo: 'Clase 3' });
        const b = sesiones.renombrar(a.archivos.json, { prefijo: '   ' });
        t.eq(b.secuencia, s.secuencia);
        t.eq(JSON.parse(fs.readFileSync(b.archivos.json, 'utf8')).prefijo, null);
    });

    t.test('lo que un nombre de archivo no aguanta se cambia por un guion', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { prefijo: 'Clase 3/4: repaso' });
        t.eq(r.secuencia, 'Clase 3-4- repaso_curso_2026-09-29_10-00-00');
        t.ok(workspace.dentroDe(dir, r.archivos.xml), 'y no se sale de la carpeta');
    });

    t.test('cambiar el curso después conserva el nombre de delante', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const a = sesiones.renombrar(s.json, { prefijo: 'Clase 3' });
        const b = sesiones.renombrar(a.archivos.json, { curso: 'Otro' });
        t.eq(b.secuencia, 'Clase 3_otro_2026-09-29_10-00-00');
    });

    t.test('la lista trae el nombre de delante, para editarlo', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.renombrar(s.json, { prefijo: 'Clase 3' });
        t.eq(sesiones.listar([dir])[0].prefijo, 'Clase 3');
    });

    t.test('la pantalla ya no usa window.prompt, que Electron no tiene', () => {
        // `prompt()` en Electron tira «prompt() is not supported»: el lápiz
        // nunca hizo nada.
        const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pantalla-sesiones.js'), 'utf8');
        t.ok(!/window\.prompt\(/.test(js));
        t.ok(/grabarRenombrar\(json, \{ prefijo: campo\.value \}\)/.test(js), 'manda el prefijo');
    });

    t.group('sesiones-grabadas · borrar');

    t.test('se lleva los tres archivos', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.borrar(s.json);
        t.ok(r.xml);
        t.ok(r.sidecar);
        t.eq(r.audios, 1);
        t.eq(fs.existsSync(s.xml), false);
        t.eq(fs.existsSync(s.json), false);
        t.eq(fs.existsSync(s.wav), false);
    });

    t.test('lo que falta no es un error', () => {
        // Se llega a borrar una sesión justamente cuando quedó mal, y plantarse
        // en el primer archivo ausente dejaría los otros dos sin forma de
        // sacarlos desde la app.
        const dir = carpeta();
        const s = sembrar(dir);
        fs.unlinkSync(s.xml);
        const r = sesiones.borrar(s.json);
        t.eq(r.xml, false, 'dice que ese no estaba');
        t.ok(r.sidecar, 'y borra el que sí');
    });

    t.test('no borra un WAV de fuera de la carpeta', () => {
        const dir = carpeta();
        const afuera = path.join(os.tmpdir(), `nt-ajeno-${Date.now()}.wav`);
        fs.writeFileSync(afuera, Buffer.alloc(16));
        const s = sembrar(dir);
        const sidecar = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        sidecar.sesiones[0].archivo = afuera;
        fs.writeFileSync(s.json, JSON.stringify(sidecar));
        sesiones.borrar(s.json);
        t.ok(fs.existsSync(afuera), 'sigue ahí');
        fs.unlinkSync(afuera);
    });

    t.test('la que se está grabando no se borra', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.borrar(s.json, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.group('sesiones-grabadas · reanudar');

    t.test('una sesión abierta se puede reanudar', () => {
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        const previa = sesiones.paraReanudar(s.json);
        t.eq(previa.ceroMs, T0, 'el cero no se mueve');
        t.eq(previa.dir, dir);
        t.eq(previa.estado.secuencia, s.secuencia);
    });

    t.test('los contadores siguen desde donde estaban', () => {
        // Una toma nueva no puede reusar el id de una vieja, y una claqueta
        // nueva no puede llamarse como una que ya está en el XML.
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        const previa = sesiones.paraReanudar(s.json);
        t.eq(previa.estado.proximaToma, 1);
        t.eq(previa.estado.proximaClaqueta, 1);
    });

    t.test('una sesión ya cerrada NO se reanuda', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.paraReanudar(s.json); } catch (e) { error = e.message; }
        t.ok(error && error.includes('ya se cerró'), error);
    });

    t.test('la que se está grabando tampoco', () => {
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        let error = null;
        try { sesiones.paraReanudar(s.json, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('ya se está grabando'), error);
    });

    t.group('sesiones-grabadas · rehacer el XML');

    t.test('reescribe el XML con el formato de hoy sin tocar las notas', () => {
        // Es para lo que existe: una clase grabada con una versión anterior
        // tiene el XML de entonces, y sin esto habría que volver a grabarla
        // para que el arreglo le llegue.
        const dir = carpeta();
        const s = sembrar(dir);
        // Un XML de antes: el marcador se llamaba solo «PV» y no había
        // marcadores en el clip maestro.
        const viejo = fs.readFileSync(s.xml, 'utf8')
            .replace(/<name>Toma 1 · PV<\/name>/g, '<name>PV</name>');
        fs.writeFileSync(s.xml, viejo);
        const antes = JSON.parse(fs.readFileSync(s.json, 'utf8'));

        const r = sesiones.rehacerXml(s.json);
        t.eq(r.tomas, 1);
        const xml = fs.readFileSync(s.xml, 'utf8');
        t.ok(xml.includes('<name>Toma 1 · PV</name>'), 'el marcador lleva el número de la toma');
        t.ok(xml.slice(0, xml.indexOf('<sequence')).includes('<marker>'),
            'y el clip maestro tiene sus marcadores');

        const despues = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        t.deep(despues.tomas.map(x => x.comentario), antes.tomas.map(x => x.comentario),
            'las notas quedaron igual');
        t.deep(despues.tomas.map(x => (x.palabras || []).map(w => w.texto)),
            antes.tomas.map(x => (x.palabras || []).map(w => w.texto)),
            'y el texto también');
    });

    t.test('la sesión que se está grabando no se rehace', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const suya = JSON.parse(fs.readFileSync(s.json, 'utf8')).secuencia;
        let error = null;
        try { sesiones.rehacerXml(s.json, suya); } catch (e) { error = e.message; }
        t.ok(error && /grabando/.test(error), error);
    });

    t.group('sesiones-grabadas · editar una ya cerrada');

    t.test('cambiar la vista reescribe el XML', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.editarGrabada(s.json, { tipo: 'vista', toma: 1, vista: 'R' });
        const xml = fs.readFileSync(s.xml, 'utf8');
        t.ok(xml.includes('<name>Toma 1 · R</name>'), 'el marcador cambió de vista');
    });

    t.test('quitar una claqueta también', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.editarGrabada(s.json, { tipo: 'quitar-claqueta', n: 1 });
        t.ok(!fs.readFileSync(s.xml, 'utf8').includes('Claqueta 1'));
    });

    t.test('reabrir una toma se niega, y dice por qué', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.editarGrabada(s.json, { tipo: 'reabrir', toma: 1 }); }
        catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.test('un archivo que no es un sidecar se rechaza', () => {
        let error = null;
        try { sesiones.editarGrabada('/tmp/cualquiera.txt', { tipo: 'vista', toma: 1 }); }
        catch (e) { error = e.message; }
        t.ok(error && error.includes('no es el archivo'), error);
    });
};
