'use strict';
/**
 * La ventana se pierde en mitad de la clase, y el audio se cambia sin pararla.
 *
 *   · Cerrar la ventana o salir con ⌘Q, con una clase grabando, pregunta antes.
 *   · El menú de la app no trae «Recargar»: recargar corta el micrófono.
 *   · Una ventana nueva le pregunta al motor y vuelve a la clase en curso.
 *   · La entrada de audio se cambia desde la barra: un WAV por entrada, y la
 *     toma abierta partida en el cambio.
 *
 * Lo de Electron (`main.js`, la ventana) se comprueba contra el texto de los
 * archivos, igual que en el resto de la suite: no se levanta Electron.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const puente = require('../ipc/grabar');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-ventana-'));
}

/** Un pedazo de PCM silencioso, del tamaño que manda la ventana. */
function pedazo(muestras) {
    return Buffer.alloc((muestras || 4096) * 2);
}

/** Una sesión de prueba con `n` pedazos de audio ya escritos. */
function grabando(n) {
    const st = grabacion.iniciar({ dir: carpeta(), curso: 'prueba', fps: 30, sinReloj: true, dispositivo: 'MacBook' });
    for (let i = 0; i < n; i++) grabacion.pcm(pedazo());
    return st;
}

module.exports = function (t) {
    t.group('cambiar de entrada · el motor');

    t.test('cierra el WAV que venía y abre otro, con la tasa de la nueva', () => {
        grabando(20);
        try {
            const antes = grabacion._sesion().captura.archivo;
            const r = grabacion.cambiarEntrada({ dispositivo: 'AirPods', sampleRate: 24000, canales: 1 });
            t.ok(r.ok, r.error);
            t.eq(r.toma, null, 'sin toma abierta no hay nada que partir');
            const s = grabacion._sesion();
            t.eq(s.estado.sesiones.length, 1, 'el viejo quedó apuntado');
            t.eq(s.estado.sesiones[0].archivo, antes);
            t.ok(s.captura.archivo !== antes, 'y el nuevo es otro archivo');
            t.eq(s.captura.sampleRate, 24000);
            t.eq(r.estado.dispositivo, 'AirPods', 'y el estado dice por dónde entra ahora');
            t.ok(s.captura.desdeMs >= s.estado.sesiones[0].desdeMs + s.estado.sesiones[0].segundos * 1000,
                'el nuevo no empieza antes de donde terminó el viejo');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('la toma abierta se parte donde terminó el audio viejo', () => {
        grabando(10);
        try {
            grabacion.abrirToma();
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            const finDelViejo = grabacion._sesion().captura.desdeMs + grabacion._sesion().captura.segundos * 1000;
            const r = grabacion.cambiarEntrada({ dispositivo: 'AirPods', sampleRate: 48000, canales: 1 });
            t.ok(r.ok, r.error);
            t.eq(r.toma, 'partida');
            t.eq(r.estado.tomas.length, 2, 'la abierta siguió en otra');
            const [primera, segunda] = r.estado.tomas;
            t.eq(primera.outMs, finDelViejo, 'la primera termina con su audio');
            t.eq(segunda.outMs, null, 'la segunda sigue abierta');
            t.eq(segunda.vista, primera.vista, 'con la misma vista');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('una entrada sin tasa no se acepta, y la clase sigue como estaba', () => {
        grabando(5);
        try {
            const antes = grabacion._sesion().captura.archivo;
            const r = grabacion.cambiarEntrada({ dispositivo: 'Algo', sampleRate: 0 });
            t.eq(r.ok, false);
            t.eq(grabacion._sesion().captura.archivo, antes, 'sigue escribiendo en el mismo WAV');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('sin audio abierto, otra entrada lo vuelve a abrir', () => {
        // Es lo que queda si abrir el WAV nuevo falló la vez anterior: la clase
        // en pie, sin audio, y lo que hace falta es justamente otra entrada.
        grabando(5);
        try {
            const s = grabacion._sesion();
            s.estado.sesiones.push({ ...s.captura });
            s.captura = null;
            const r = grabacion.cambiarEntrada({ dispositivo: 'B', sampleRate: 48000, canales: 1 });
            t.ok(r.ok, r.error);
            t.ok(grabacion._sesion().captura, 'y vuelve a haber dónde escribir');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('terminando, no', () => {
        grabando(5);
        try {
            grabacion._sesion().terminando = true;
            t.eq(grabacion.cambiarEntrada({ dispositivo: 'B', sampleRate: 48000, canales: 1 }).ok, false);
            grabacion._sesion().terminando = false;
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el canal existe de punta a punta', () => {
        const canales = new Map();
        puente.registrar({
            ipcMain: { handle: (c, fn) => canales.set(c, fn), on: () => {} },
            app: { on: () => {} }, send: () => {}, anotar: () => {}
        });
        t.ok(canales.has('grabar-cambiar-entrada'), 'el puente lo atiende');
        t.ok(/grabarCambiarEntrada: como => ipcRenderer\.invoke\('grabar-cambiar-entrada', como\)/.test(leer('preload.js')),
            'y el preload lo declara');
        t.ok(/grabarCambiarEntrada:/.test(leer('tools', 'maqueta', 'doble.js')), 'y la maqueta también');
    });

    t.group('cambiar de entrada · la barra');

    t.test('el rótulo Audio está en la barra y abre el menú de entradas', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        const rotulos = vivo.slice(vivo.indexOf('function pintarRotulos() {'), vivo.indexOf('\n}', vivo.indexOf('function pintarRotulos() {')));
        t.ok(/rotuloDeEntrada\(\)/.test(rotulos), 'va con el idioma y la cámara');
        t.ok(/case 'entrada':[\s\S]{0,300}app\.entradasParaElegir\(\)[\s\S]{0,80}cambiarEntrada\(id\)/.test(vivo),
            'la lista se pide al abrir el menú');
    });

    t.test('Preparar deja de mandar antes de cambiar, y vuelve a la de antes si la nueva no abre', () => {
        const prep = leer('src', 'js', 'pantalla-preparar.js');
        const fn = prep.slice(prep.indexOf('export async function cambiarEntradaGrabando(id) {'));
        const cuerpo = fn.slice(0, fn.indexOf('\n}'));
        t.ok(cuerpo.indexOf('fuente.dejarDeMandar()') < cuerpo.indexOf('abrirEntrada(id)'), 'primero deja de mandar');
        t.ok(/if \(fallo && antes\) await abrirEntrada\(antes\.id\);/.test(cuerpo), 'y si la nueva no abre, vuelve');
        const mandar = prep.slice(prep.indexOf('async function mandarAlMotor() {'));
        t.ok(mandar.indexOf('grabarCambiarEntrada') < mandar.indexOf('fuente.empezarAMandar()'),
            'y vuelve a mandar recién cuando el motor abrió el WAV nuevo');
    });

    t.group('la ventana · volver a la clase');

    t.test('al arrancar, una clase grabando lleva a su pantalla y no a la lista', () => {
        const app = leer('src', 'js', 'app.js');
        const arranque = app.slice(app.indexOf('async function arrancar() {'));
        t.ok(/const enCurso = await window\.nt\.grabarEstado\(\);\s*if \(enCurso\) await volverALaClase\(enCurso\);\s*else \{\s*await sesiones\.ver\(\);/
            .test(arranque));
        const volver = app.slice(app.indexOf('async function volverALaClase(enCurso) {'));
        t.ok(/preparar\.reengancharGrabando\(enCurso\)/.test(volver), 'y vuelve a abrir el audio');
        t.ok(/app\.irAVivo\(/.test(volver.slice(0, 400)), 'aunque no se pueda: las notas siguen');
        t.ok(/grabarEstado: async \(\) => null/.test(leer('tools', 'maqueta', 'doble.js')),
            'y la maqueta arranca sin ninguna');
    });

    t.test('el motor dice por dónde entraba el audio', () => {
        grabando(2);
        try {
            t.eq(grabacion.resumen().dispositivo, 'MacBook');
        } finally {
            grabacion.apagar();
        }
    });

    t.group('la ventana · cerrar con una clase grabando');

    t.test('cerrar la ventana pregunta', () => {
        const main = leer('main.js');
        t.ok(/mainWindow\.on\('close', e => \{\s*if \(cerrarYa \|\| !grabacion\.activa\(\)\) return;\s*e\.preventDefault\(\);/.test(main));
        t.ok(/buttons: \['Seguir grabando', 'Terminar la clase y cerrar'\]/.test(main), 'y lo de fábrica es seguir');
        t.ok(/await grabacion\.terminar\(\);/.test(main), 'terminar es terminar de verdad, con la relectura');
    });

    t.test('salir con ⌘Q también, y la sesión se cierra recién cuando la salida es segura', () => {
        const main = leer('main.js');
        t.ok(/app\.on\('before-quit', e => \{\s*[^]*?if \(!cerrarYa && grabacion\.activa\(\)\) \{\s*e\.preventDefault\(\);/.test(main));
        const ipc = leer('ipc', 'grabar.js');
        t.ok(/app\.on\('will-quit'/.test(ipc) && !/app\.on\('before-quit'/.test(ipc),
            'el puente apaga en will-quit: en before-quit apagaría aunque la respuesta fuera seguir');
    });

    t.test('el menú no trae Recargar, y las herramientas de desarrollo solo en desarrollo', () => {
        const main = leer('main.js');
        const menu = main.slice(main.indexOf('function ponerElMenu() {'), main.indexOf('\n}', main.indexOf('function ponerElMenu() {')));
        t.ok(/Menu\.setApplicationMenu\(/.test(menu), 'pone el suyo');
        t.ok(!/reload|forceReload|viewMenu/i.test(menu), 'sin recargar');
        t.ok(/app\.isPackaged \? \[\] : \[[^\]]*toggleDevTools/.test(menu), 'y sin devtools en la app instalada');
        t.ok(/role: 'editMenu'/.test(menu), 'con Edición, que es lo que hace andar copiar y pegar');
        t.ok(/ponerElMenu\(\);\s*createWindow\(\);/.test(main), 'y se pone antes de abrir la ventana');
    });
};
