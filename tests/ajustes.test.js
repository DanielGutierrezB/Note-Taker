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

    // Los guiones de prueba necesitan escribir ajustes —una carpeta de /tmp— y
    // además la app, mientras graba, guarda sola el
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
            // Se mira ANTES de escribir, y si no coincide no se escribe nada.
            //
            // Esta prueba llama a `guardar` de verdad, así que si `archivo()`
            // se rompiera escribiría en los ajustes de quien corre esto —el
            // daño exacto que viene a impedir—. Pasó: comprobando que esta
            // prueba se pusiera roja, rompí `archivo()` a propósito y la
            // corrida se llevó puesta una configuración real antes de fallar.
            // Una prueba que para avisar de un desastre lo provoca no sirve.
            if (ajustes.dondeViven() !== aparte) {
                throw new Error(`NO se escribe: los ajustes irían a ${ajustes.dondeViven()}`
                    + ` en vez de a ${aparte}`);
            }
            ajustes.guardar({ dispositivo: 'solo de prueba' });
            t.ok(fs.existsSync(aparte), 'escribió donde se le dijo');
            t.eq(JSON.parse(fs.readFileSync(aparte, 'utf8')).dispositivo, 'solo de prueba');
            t.eq(ajustes.leer().dispositivo, 'solo de prueba', 'y lee de ahí también');
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
        t.eq(a.idioma, 'auto');
        t.eq(a.carpeta, null);
        t.deep(a.carpetas, []);
    });

    t.test('lo del modo semanal que quedó escrito se cae al guardar', () => {
        // El modo pasó a otro proyecto. `sanear` rearma el objeto entero, así
        // que lo de antes no llega a la app ni vuelve al archivo.
        const a = ajustes.sanear({ modo: 'semanal', semanal: { carpeta: '/x', idioma: 'en' }, fps: 25 });
        t.ok(!('modo' in a) && !('semanal' in a));
        t.eq(a.fps, 25, 'y lo demás se queda');
    });

    t.test('solo los idiomas que la app oye, y cualquier otra cosa no', () => {
        // Va a la línea de comandos de `whisper-server` tal cual, y con un `-l`
        // que no entiende el servidor no arranca: sin servidor no hay ni
        // «3, 2, 1» ni transcript. Y la lista es corta a propósito: un idioma
        // de más es una manera nueva de que una clase salga traducida
        // (ver `engine/idiomas.js`).
        const puesto = i => ajustes.sanear({ version: 2, idioma: i }).idioma;
        t.eq(puesto('auto'), 'auto');
        t.eq(puesto('en'), 'en');
        t.eq(puesto('pt'), 'pt');
        t.eq(puesto('fr'), 'auto', 'un idioma que la app no oye se cae a lo de fábrica');
        t.eq(puesto('automático'), 'auto');
        t.eq(puesto('--help'), 'auto');
    });

    t.test('el «es» de fábrica de antes pasa a «auto» una vez, y después se respeta lo elegido', () => {
        // `guardar` escribe el archivo entero, así que todo el mundo tiene un
        // `idioma: "es"` escrito lo haya elegido o no: mirando el archivo no se
        // distingue «lo dejé como venía» de «lo puse yo». Por eso la versión.
        const viejo = ajustes.sanear({ version: 1, idioma: 'es' });
        t.eq(viejo.idioma, 'auto', 'el de antes se pasa a automático');
        t.eq(viejo.version, 2, 'y el archivo queda en la versión que ya lo pasó');
        t.eq(ajustes.sanear(viejo).idioma, 'auto', 'y no se vuelve a pasar');
        // Quien después elija español lo conserva: el archivo ya dice 2.
        t.eq(ajustes.sanear({ ...viejo, idioma: 'es' }).idioma, 'es');
        t.eq(ajustes.sanear({ idioma: 'es' }).idioma, 'auto', 'sin versión escrita es un archivo de antes');
    });

    t.test('lo que alguien eligió distinto de «es» antes de la migración se queda', () => {
        // Antes había tres idiomas y el de fábrica era español: un «en» o un
        // «pt» en el archivo los eligió alguien. Pasar un «pt» a automático le
        // traduce la clase, porque automático oye español o inglés y nada más.
        t.eq(ajustes.sanear({ version: 1, idioma: 'pt' }).idioma, 'pt');
        t.eq(ajustes.sanear({ version: 1, idioma: 'en' }).idioma, 'en');
        t.eq(ajustes.sanear({ version: 1, idioma: 'auto' }).idioma, 'auto');
    });

    t.test('la marca de migración de antes ya no se escribe', () => {
        // Un campo por migración se queda en el archivo para siempre; la
        // versión es una sola marca para todas.
        t.ok(!('idiomaMigrado' in ajustes.sanear({ version: 1, idioma: 'es', idiomaMigrado: true })));
        t.ok(!('idiomaMigrado' in ajustes.DEFAULTS));
    });

    t.test('un fps de la lista se respeta', () => {
        t.eq(ajustes.sanear({ fps: 23.976 }).fps, 23.976);
    });

    t.test('un fps inventado cae al de fábrica', () => {
        t.eq(ajustes.sanear({ fps: 37 }).fps, 30);
        t.eq(ajustes.sanear({ fps: 'muchos' }).fps, 30);
    });

    t.test('un idioma que la app no oye cae al de fábrica', () => {
        t.eq(ajustes.sanear({ version: 2, idioma: 'castellano' }).idioma, 'auto');
        t.eq(ajustes.sanear({ version: 2, idioma: 'pt' }).idioma, 'pt');
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

    t.test('el curso no se guarda: es el nombre de la carpeta', () => {
        // Guardado aparte, el nombre del curso se escribía una vez y después
        // mentía: quien elegía otra carpeta seguía grabando clases con el nombre
        // del curso anterior. Ahora sale de la carpeta elegida, que se ve en la
        // pantalla donde eso pasa. Lo que quedó en el disco se cae al guardar,
        // porque `sanear` rearma el objeto entero.
        const puesto = ajustes.sanear({ curso: 'React', carpeta: '/Cursos/Diseño UX' });
        t.eq(puesto.curso, undefined, 'no vuelve, ni vacío');
        t.eq(puesto.carpeta, '/Cursos/Diseño UX', 'de ahí sale el nombre ahora');
    });

    t.test('todos los fps de la lista se aceptan', () => {
        for (const f of ajustes.FPS_POSIBLES) {
            t.eq(ajustes.sanear({ fps: f }).fps, f, `${f}`);
        }
    });
};
