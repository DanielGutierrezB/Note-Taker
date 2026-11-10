'use strict';
/**
 * El glosario: el general y el del curso, sumados, y cómo llegan a Whisper.
 *
 * La medición que lo dejó encendido en la relectura —que no trabó la
 * puntuación ni inventó términos— está en `tools/banco-pasada.js --relectura`
 * y en el commit; acá se prueba la forma: qué entra, en qué orden, con qué
 * tope de contexto, y que llegue a la relectura y a Regenerar y no al vivo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const glosario = require('../engine/glosario');
const ajustes = require('../engine/ajustes');
const grabacion = require('../engine/grabacion');
const workspace = require('../engine/workspace');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

module.exports = function (t) {
    t.group('glosario · qué entra');

    t.test('sin vacíos ni repetidos, con tope de largo', () => {
        const largo = 'x'.repeat(80);
        t.deep(glosario.sanos(['Canva', ' canva ', '', 'Magic   Studio', 'Cánva', largo, 3, null]),
            ['Canva', 'Magic Studio', 'x'.repeat(glosario.TERMINO_MAX)]);
    });

    t.test('el del curso tiene prioridad, y lo que no entra se dice', () => {
        const general = Array.from({ length: 140 }, (_x, i) => `general${i}`);
        const delCurso = Array.from({ length: 20 }, (_x, i) => `curso${i}`);
        const r = glosario.combinar(general, delCurso);
        t.eq(r.palabras, glosario.PALABRAS_MAX);
        t.ok(delCurso.every(x => r.entran.includes(x)), 'entra todo el del curso');
        t.eq(r.afuera.length, 10, 'y quedan afuera diez del general');
        t.ok(r.afuera.every(x => x.startsWith('general')));
    });

    t.test('el del curso va al final, que es lo que whisper.cpp guarda si tiene que cortar', () => {
        const r = glosario.combinar(['Figma', 'Canva'], ['Canva', 'Magic Studio']);
        t.deep(r.entran, ['Figma', 'Canva', 'Magic Studio']);
        t.eq(r.entran[r.entran.length - 1], 'Magic Studio');
        t.eq(r.entran.filter(x => x === 'Canva').length, 1, 'el repetido, una vez');
    });

    t.group('glosario · cómo llega a Whisper');

    t.test('con el tope de contexto justo para el glosario, y sin glosario como siempre', () => {
        const texto = glosario.texto(['Canva', 'Magic Studio']);
        t.eq(texto, 'Canva, Magic Studio.');
        const args = glosario.argumentos(texto);
        t.deep(args.slice(0, 3), ['--prompt', texto, '--carry-initial-prompt']);
        t.eq(args[3], '-mc');
        t.eq(Number(args[4]), glosario.tokensEstimados(texto) + 1, 'lo que sobre del tope se llenaría con la ventana anterior');
        t.deep(glosario.argumentos(''), []);
        t.ok(/args\.splice\(args\.indexOf\('-mc'\), 2, \.\.\.conGlosario\)/.test(leer('engine', 'transcribe.js')),
            'reemplaza el -mc 0 de siempre, no se suma');
    });

    t.test('un glosario larguísimo no pasa el tope del modelo', () => {
        const texto = glosario.texto(Array.from({ length: 150 }, (_x, i) => `terminolargo${i}`));
        t.ok(Number(glosario.argumentos(texto)[4]) <= 223);
    });

    t.test('va a la relectura y a Regenerar, y no al vivo', () => {
        t.ok(/if \(!p\.liviano && p\.glosario\) opciones\.glosario = p\.glosario;/.test(leer('engine', 'oir.js')));
        t.ok(/glosario: sesion\.glosario \}\)/.test(leer('engine', 'relecturas.js')));
        t.ok(/oirToma\.leer\(archivos, toma, \{ idioma: estado\.idioma, tomas, glosario \}\)/.test(leer('engine', 'sesiones-grabadas.js')));
        const ipc = leer('ipc', 'grabar.js');
        t.eq((ipc.match(/glosarioDe\(/g) || []).length >= 4, true, 'al iniciar, reanudar, regenerar y guardar');
    });

    t.group('glosario · dónde se guarda');

    t.test('el del curso, en la carpeta Datos del curso', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-glosario-'));
        try {
            t.deep(glosario.leerDelCurso(dir), [], 'sin archivo, vacío');
            glosario.guardarDelCurso(dir, ['Canva Pro', 'canva pro', 'Magic Studio']);
            t.eq(glosario.archivoDelCurso(dir), path.join(workspace.datosDir(dir), 'glosario.json'));
            t.deep(glosario.leerDelCurso(dir), ['Canva Pro', 'Magic Studio']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    t.test('el general, en Ajustes, saneado', () => {
        t.deep(ajustes.sanear({ glosario: ['Figma', 'figma', ''] }).glosario, ['Figma']);
        t.deep(ajustes.sanear({}).glosario, []);
    });

    t.test('cambiarlo grabando: la próxima relectura usa el nuevo', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-glosario-'));
        try {
            grabacion.iniciar({ dir, curso: 'x', fps: 30, sinReloj: true, sampleRate: 48000, glosario: 'Canva.' });
            t.eq(grabacion._sesion().glosario, 'Canva.');
            t.eq(grabacion.dirEnCurso(), dir);
            t.ok(grabacion.cambiarGlosario('Canva, Figma.'));
            t.eq(grabacion._sesion().glosario, 'Canva, Figma.');
        } finally {
            grabacion.apagar();
            fs.rmSync(dir, { recursive: true, force: true });
        }
        t.eq(grabacion.cambiarGlosario('x'), false, 'sin clase, nada');
    });
};
