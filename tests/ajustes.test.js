'use strict';
/**
 * Los ajustes: qué sobrevive a un archivo escrito a mano.
 *
 * `sanear` es lo único que se prueba acá y es lo único que importa: un fps que
 * no está en la lista no se puede escribir bien en el XML —haría falta saber
 * si lleva `ntsc`— así que tiene que caer al de fábrica en vez de arrastrar un
 * número que después nadie sabe de dónde salió.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ajustes = require('../engine/ajustes');

module.exports = function (t) {
    t.group('ajustes · dónde se escriben');

    // El banco de pruebas de punta a punta necesita escribir ajustes —modo
    // semanal, carpeta de /tmp— y además la app, mientras graba, guarda sola el
    // micrófono y la cámara, que ahí son los falsos de Chromium. Que eso no
    // pueda caer sobre la configuración de quien usa la app es una propiedad, no
    // una buena costumbre: el intento anterior fue devolverlos en un `finally`,
    // y el `finally` no corrió el día que hubo que matar la ventana.
    t.test('con NT_AJUSTES no se toca el archivo de verdad', () => {
        const antes = process.env.NT_AJUSTES;
        const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-ajustes-prueba-'));
        const aparte = path.join(carpeta, 'ajustes.json');
        process.env.NT_AJUSTES = aparte;
        try {
            ajustes.guardar({ modo: 'semanal', curso: 'solo de prueba' });
            t.ok(fs.existsSync(aparte), 'escribió donde se le dijo');
            t.eq(JSON.parse(fs.readFileSync(aparte, 'utf8')).curso, 'solo de prueba');
            t.eq(ajustes.leer().curso, 'solo de prueba', 'y lee de ahí también');
        } finally {
            if (antes === undefined) delete process.env.NT_AJUSTES;
            else process.env.NT_AJUSTES = antes;
            fs.rmSync(carpeta, { recursive: true, force: true });
        }
    });

    t.test('sin la variable, el archivo es el de siempre', () => {
        const antes = process.env.NT_AJUSTES;
        delete process.env.NT_AJUSTES;
        try {
            // Se mira la ruta, no se escribe: esto corre en la máquina de alguien.
            const suya = path.join(os.homedir(), 'Library', 'Application Support',
                'Note Taker', 'ajustes.json');
            t.eq(ajustes.dondeViven(), suya);
        } finally {
            if (antes !== undefined) process.env.NT_AJUSTES = antes;
        }
    });

    t.group('ajustes · sanear');

    t.test('un archivo vacío da lo de fábrica', () => {
        const a = ajustes.sanear(null);
        t.eq(a.fps, 30);
        t.eq(a.idioma, 'es');
        t.eq(a.carpeta, null);
        t.deep(a.carpetas, []);
        t.eq(a.modo, 'clase', 'la app abre tomando notas, como siempre');
        t.deep(a.semanal, { carpeta: null, idioma: 'auto' },
            'el vídeo de la semana detecta el idioma; la clase lo lleva puesto');
    });

    t.test('«auto» es un idioma válido, y cualquier otra cosa no', () => {
        // Va a la línea de comandos de `whisper-server` tal cual, y con un `-l`
        // que no entiende el servidor no arranca: sin servidor no hay ni
        // «3, 2, 1» ni transcript.
        t.eq(ajustes.sanear({ idioma: 'auto' }).idioma, 'auto');
        t.eq(ajustes.sanear({ idioma: 'en' }).idioma, 'en');
        t.eq(ajustes.sanear({ idioma: 'automático' }).idioma, 'es', 'se cae a lo de fábrica');
        t.eq(ajustes.sanear({ idioma: '--help' }).idioma, 'es');
        t.eq(ajustes.sanear({ semanal: { idioma: 'xx-larga' } }).semanal.idioma, 'auto');
    });

    t.group('ajustes · el parche de cada pantalla');

    t.test('guardar la carpeta del semanal no se lleva su idioma', () => {
        // Es por esto que el parche entra un nivel: quien guarda la carpeta
        // manda `{semanal:{carpeta}}`, y pegado por arriba eso borraba el
        // idioma de al lado.
        const previos = ajustes.sanear({ semanal: { carpeta: '/tmp/x', idioma: 'en' } });
        const despues = ajustes.sanear(
            ajustes.conParche(previos, { semanal: { carpeta: '/tmp/otra' } }));
        t.eq(despues.semanal.carpeta, '/tmp/otra');
        t.eq(despues.semanal.idioma, 'en', 'el idioma sigue donde estaba');
    });

    t.test('y un nivel y nada más: lo que se vacía se vacía', () => {
        const previos = ajustes.sanear({ carpeta: '/tmp/x', camara: 'OBSBOT', fps: 25 });
        const despues = ajustes.conParche(previos, { camara: null, fps: 30 });
        t.eq(despues.camara, null, 'un null reemplaza, no se fusiona');
        t.eq(despues.fps, 30);
        t.eq(despues.carpeta, '/tmp/x', 'y lo que no se mandó sigue igual');
        t.deep(ajustes.conParche(previos, { carpetas: ['/a'] }).carpetas, ['/a'],
            'un array tampoco se fusiona');
    });

    t.test('el modo se guarda, y uno inventado abre la app como siempre', () => {
        // Que un ajuste roto no pueda dejar a nadie en una pantalla que no
        // entiende: `clase` es el modo que no graba vídeo ni exporta nada.
        t.eq(ajustes.sanear({ modo: 'semanal' }).modo, 'semanal');
        t.eq(ajustes.sanear({ modo: 'clase' }).modo, 'clase');
        t.eq(ajustes.sanear({ modo: 'cualquiera' }).modo, 'clase');
        t.eq(ajustes.sanear({ modo: 7 }).modo, 'clase');
    });

    t.test('el modo semanal tiene su propia carpeta, aparte de la del curso', () => {
        // Aparte a propósito: así la lista de clases del editor no se llena de
        // vídeos de la semana ni la carpeta de un curso de MP4.
        const a = ajustes.sanear({ carpeta: '/Cursos/React', semanal: { carpeta: '/Users/x/Movies/Semanal' } });
        t.eq(a.carpeta, '/Cursos/React');
        t.eq(a.semanal.carpeta, '/Users/x/Movies/Semanal');
        t.deep(a.carpetas, ['/Cursos/React'], 'y la del modo semanal no entra en las recientes');
        t.eq(ajustes.sanear({ semanal: 'una cadena' }).semanal.carpeta, null);
    });

    t.test('un fps de la lista se respeta', () => {
        t.eq(ajustes.sanear({ fps: 23.976 }).fps, 23.976);
    });

    t.test('un fps inventado cae al de fábrica', () => {
        t.eq(ajustes.sanear({ fps: 37 }).fps, 30);
        t.eq(ajustes.sanear({ fps: 'muchos' }).fps, 30);
    });

    t.test('un idioma que no es de dos letras cae al de fábrica', () => {
        t.eq(ajustes.sanear({ idioma: 'castellano' }).idioma, 'es');
        t.eq(ajustes.sanear({ idioma: 'pt' }).idioma, 'pt');
    });

    t.test('la carpeta activa va primera en la lista', () => {
        // Es el invariante que hace que elegir carpeta sea guardar una sola
        // clave, y que quitar una de la lista no pueda dejar la activa afuera.
        const a = ajustes.sanear({ carpeta: '/b', carpetas: ['/a', '/b', '/c'] });
        t.eq(a.carpetas[0], '/b');
        t.eq(a.carpetas.length, 3, 'y no se duplica');
    });

    t.test('las carpetas no se repiten', () => {
        t.deep(ajustes.sanear({ carpetas: ['/a', '/a', '/b'] }).carpetas, ['/a', '/b']);
    });

    t.test('la lista se recorta al tope, y se recorta al sanear', () => {
        // Quien agregue una séptima no tiene que acordarse de recortar.
        const muchas = Array.from({ length: 20 }, (_, i) => `/c${i}`);
        t.eq(ajustes.sanear({ carpetas: muchas }).carpetas.length, ajustes.RECIENTES);
    });

    t.test('lo que no es una ruta se descarta', () => {
        t.deep(ajustes.sanear({ carpetas: ['/a', null, 3, '', '/b'] }).carpetas, ['/a', '/b']);
    });

    t.test('el curso se recorta pero no se pierde', () => {
        t.eq(ajustes.sanear({ curso: '  React  ' }).curso, 'React');
    });

    t.test('todos los fps de la lista se aceptan', () => {
        for (const f of ajustes.FPS_POSIBLES) {
            t.eq(ajustes.sanear({ fps: f }).fps, f, `${f}`);
        }
    });
};
