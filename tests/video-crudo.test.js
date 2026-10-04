'use strict';
/**
 * Los dos vídeos del modo semanal mientras entran: que los pedazos queden en
 * orden, que el archivo se pueda abrir en cualquier momento y que la hora de
 * arranque sobreviva, que es la que alinea el corte.
 *
 * Lo que cuidan estas pruebas es lo que no se puede arreglar después. Un pedazo
 * escrito fuera de su sitio rompe el archivo entero —el primero trae la
 * cabecera y los demás no valen nada sin ella—, y una hora de arranque perdida
 * deja un vídeo que no se puede cortar porque no hay forma de saber qué
 * instante de la grabación es cada fotograma.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const videoCrudo = require('../engine/video-crudo');
const workspace = require('../engine/workspace');

const T0 = Date.parse('2026-10-03T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-video-'));
}

module.exports = function (t) {
    t.group('vídeo crudo · el archivo');

    t.test('cada cual va a su archivo, con el nombre de la sesión', () => {
        const dir = carpeta();
        const cam = videoCrudo.abrir({ dir, nombre: 'curso_2026-10-03_10-00-00', cual: 'camara', empezoMs: T0 });
        const pan = videoCrudo.abrir({ dir, nombre: 'curso_2026-10-03_10-00-00', cual: 'pantalla', empezoMs: T0 });
        t.eq(path.basename(cam.archivo), 'curso_2026-10-03_10-00-00-camara.mp4');
        t.eq(path.basename(pan.archivo), 'curso_2026-10-03_10-00-00-pantalla.mp4');
        t.ok(cam.id !== pan.id, 'y son dos archivos, no uno');
        videoCrudo.cerrarTodo();
    });

    t.test('la extensión la decide lo que la ventana pudo grabar', () => {
        t.eq(videoCrudo.extensionDe('video/mp4;codecs="avc1.42E01E,mp4a.40.2"'), 'mp4');
        t.eq(videoCrudo.extensionDe('video/webm;codecs=vp8'), 'webm');
        // Lo que no se reconoce entra como MP4, que es lo que graba hoy: mejor
        // una extensión optimista que un archivo sin extensión que nadie abre.
        t.eq(videoCrudo.extensionDe('video/cualquiera'), 'mp4');
        t.eq(videoCrudo.extensionDe(null), 'mp4');
    });

    t.test('no graba lo que no sabe grabar', () => {
        const dir = carpeta();
        let error = null;
        try { videoCrudo.abrir({ dir, nombre: 'x', cual: 'microondas' }); } catch (e) { error = e.message; }
        t.ok(error && /microondas/.test(error), `lo dice y no abre nada: ${error}`);
    });

    t.test('los pedazos quedan pegados en el orden en que llegaron', () => {
        const dir = carpeta();
        const v = videoCrudo.abrir({ dir, nombre: 'orden', cual: 'camara', empezoMs: T0 });
        videoCrudo.escribir(v.id, Buffer.from('uno-'));
        videoCrudo.escribir(v.id, Buffer.from('dos-'));
        videoCrudo.escribir(v.id, Buffer.from('tres'));
        const r = videoCrudo.cerrar(v.id, T0 + 9000);
        t.eq(fs.readFileSync(v.archivo, 'utf8'), 'uno-dos-tres');
        t.eq(r.bytes, 12);
        t.eq(r.trozos, 3);
    });

    t.test('un pedazo vacío no cuenta ni mueve nada', () => {
        const dir = carpeta();
        const v = videoCrudo.abrir({ dir, nombre: 'vacio', cual: 'camara', empezoMs: T0 });
        videoCrudo.escribir(v.id, Buffer.from('algo'));
        videoCrudo.escribir(v.id, Buffer.alloc(0));
        const r = videoCrudo.cerrar(v.id, T0 + 1000);
        t.eq(r.bytes, 4);
        t.eq(r.trozos, 1);
    });

    t.test('escribir en un vídeo que ya se cerró lo dice, no lo inventa', () => {
        const dir = carpeta();
        const v = videoCrudo.abrir({ dir, nombre: 'cerrado', cual: 'pantalla', empezoMs: T0 });
        videoCrudo.cerrar(v.id, T0 + 10);
        let error = null;
        try { videoCrudo.escribir(v.id, Buffer.from('x')); } catch (e) { error = e.message; }
        t.ok(error && /no hay vídeo/i.test(error), error);
    });

    t.test('lo que quede abierto se cierra al salir, con lo que llegó adentro', () => {
        const dir = carpeta();
        const a = videoCrudo.abrir({ dir, nombre: 'salir', cual: 'camara', empezoMs: T0 });
        const b = videoCrudo.abrir({ dir, nombre: 'salir', cual: 'pantalla', empezoMs: T0 });
        videoCrudo.escribir(a.id, Buffer.from('cam'));
        videoCrudo.escribir(b.id, Buffer.from('pantalla'));
        const cerrados = videoCrudo.cerrarTodo();
        t.eq(cerrados.length, 2);
        t.deep(cerrados.map(c => c.cual).sort(), ['camara', 'pantalla']);
        t.eq(fs.readFileSync(a.archivo, 'utf8'), 'cam');
        t.eq(videoCrudo.cerrarTodo().length, 0, 'y no quedan dos veces');
    });

    t.group('vídeo crudo · la hora que alinea el corte');

    t.test('la hora de arranque es la que mandó la ventana, no la de acá', () => {
        // Es la medida más delicada del modo: la ventana es la que llama a
        // `start()`, y tomar la hora de este lado mediría además el viaje por el
        // puente. Medido en el Electron de la app: el primer fotograma cae a
        // 43 ms de `start()`, mientras que el aviso `onstart` llega 294 ms tarde.
        const dir = carpeta();
        const hace5s = Date.now() - 5000;
        const v = videoCrudo.abrir({ dir, nombre: 'reloj', cual: 'camara', empezoMs: hace5s });
        t.eq(v.empezoMs, hace5s);
        const r = videoCrudo.cerrar(v.id, hace5s + 9000);
        t.eq(r.empezoMs, hace5s, 'y sigue siendo la misma al cerrarlo');
        t.eq(r.segundos, 9, 'la duración sale de las dos horas');
    });

    t.test('sin hora de arranque se usa la de ahora, que es mejor que ninguna', () => {
        const dir = carpeta();
        const antes = Date.now();
        const v = videoCrudo.abrir({ dir, nombre: 'sin-hora', cual: 'camara' });
        t.ok(v.empezoMs >= antes && v.empezoMs <= Date.now(), 'cae en este instante');
        videoCrudo.cerrarTodo();
    });

    t.test('un instante de la grabación cae donde toca dentro del archivo', () => {
        const video = { cual: 'camara', empezoMs: T0 + 2000, cerradoMs: T0 + 12000 };
        t.eq(videoCrudo.posicionDe(video, T0 + 5000), 3, 'tres segundos dentro del archivo');
        t.eq(videoCrudo.posicionDe(video, T0 + 2000), 0);
    });

    t.test('y se sabe decir si ese instante está grabado o no', () => {
        const video = { cual: 'camara', empezoMs: T0 + 2000, cerradoMs: T0 + 12000 };
        t.eq(videoCrudo.cubre(video, T0 + 5000), true);
        t.eq(videoCrudo.cubre(video, T0 + 1000), false, 'antes de empezar a grabar, no');
        t.eq(videoCrudo.cubre(video, T0 + 20000), false, 'después de parar, tampoco');
        // Mientras graba todavía no tiene cierre: cubre hasta donde haga falta.
        t.eq(videoCrudo.cubre({ cual: 'camara', empezoMs: T0, cerradoMs: null }, T0 + 99999), true);
    });

    t.group('vídeo crudo · dónde vive en el disco');

    t.test('los brutos van a xml/Video, al lado del audio', () => {
        const base = '/Cursos/Semana 40';
        t.eq(workspace.videoDir(base), path.join(base, 'xml', 'Video'));
        t.ok(workspace.videoDir(base) !== workspace.audioDir(base), 'pero no mezclados con él');
    });
};
