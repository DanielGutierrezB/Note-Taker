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

const captura = require('../engine/captura');
const workspace = require('../engine/workspace');
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

    t.group('cambiar de entrada · dormir, despertar y quedarse sin WAV');

    t.test('lo que llega con la Mac yéndose a dormir no entra, y al despertar hay un WAV nuevo', () => {
        grabando(10);
        try {
            const antes = grabacion._sesion().captura.archivo;
            const segundos = grabacion._sesion().captura.segundos;
            grabacion.dormir();
            grabacion.pcm(pedazo());
            t.eq(grabacion._sesion().captura.segundos, segundos, 'el pedazo de después de dormirse no se escribió');
            t.ok(grabacion.despertar().ok, 'despertar abre');
            t.ok(grabacion._sesion().captura.archivo !== antes, 'otro WAV');
            t.eq(grabacion.despertar(), null, 'y el segundo aviso de despertar no abre otro');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('si el aviso de despertar no llega, el audio que vuelve despierta la clase', () => {
        grabando(5);
        try {
            const antes = grabacion._sesion().captura.archivo;
            grabacion.dormir();
            grabacion._sesion().dormidaMs = Date.now() - 4000;
            grabacion.pcm(pedazo());
            t.eq(grabacion._sesion().dormida, false);
            t.ok(grabacion._sesion().captura.archivo !== antes, 'con un WAV nuevo');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('sin WAV, lo que llega se dice una vez y se vuelve a intentar abrir', () => {
        grabando(5);
        const avisos = [];
        try {
            const s = grabacion._sesion();
            s.avisar = a => avisos.push(a);
            s.estado.sesiones.push({ ...s.captura });
            s.captura = null;
            grabacion.pcm(pedazo());
            grabacion.pcm(pedazo());
            t.eq(avisos.filter(a => /no se está guardando/.test(a.mensaje)).length, 1, 'un aviso, no uno por pedazo');
            grabacion._reintentarAudio();
            t.ok(grabacion._sesion().captura, 'y volvió a haber dónde escribir');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('un WAV que falla seguido se suelta, y se vuelve a abrir otro', () => {
        grabando(5);
        try {
            const s = grabacion._sesion();
            const antes = s.captura.archivo;
            const escribir = captura.escribir;
            captura.escribir = () => { throw new Error('EIO: el disco no está'); };
            try {
                for (let i = 0; i < 30; i++) { try { grabacion.pcm(pedazo()); } catch (e) { /* lo dice el puente */ } }
            } finally {
                captura.escribir = escribir;
            }
            t.eq(grabacion._sesion().captura, null, 'el WAV muerto se soltó');
            grabacion._sesion().reintentoMs = 0;
            grabacion._reintentarAudio();
            t.ok(grabacion._sesion().captura && grabacion._sesion().captura.archivo !== antes, 'y hay otro');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('si al despertar no se puede abrir ni guardar, la clase no queda dormida ni reintenta por pedazo', () => {
        grabando(5);
        const abrir = captura.abrir;
        const atomico = workspace.writeAtomic;
        let intentos = 0;
        try {
            const s = grabacion._sesion();
            s.avisar = () => {};
            grabacion.dormir();
            s.dormidaMs = Date.now() - 5000;
            captura.abrir = () => { intentos++; throw new Error('ENOENT: el disco no volvió'); };
            workspace.writeAtomic = () => { throw new Error('ENOENT: el disco no volvió'); };
            const r = grabacion.despertar();
            t.ok(r && !r.ok, 'no abrió, y lo dice sin tirar');
            t.eq(s.dormida, false, 'y la clase ya no está dormida');
            for (let i = 0; i < 12; i++) grabacion.pcm(pedazo());
            t.eq(intentos, 1, 'los pedazos que llegan no vuelven a intentar abrir: eso es del ciclo');
        } finally {
            captura.abrir = abrir;
            workspace.writeAtomic = atomico;
            grabacion.apagar();
        }
    });

    t.test('el reintento es con la entrada que se pidió, y solo si el audio está llegando', () => {
        grabando(5);
        const abrir = captura.abrir;
        try {
            const s = grabacion._sesion();
            s.avisar = () => {};
            captura.abrir = () => { throw new Error('EIO'); };
            const r = grabacion.cambiarEntrada({ dispositivo: 'AirPods', sampleRate: 24000, canales: 1 });
            captura.abrir = abrir;
            t.ok(!r.ok, 'la nueva no abrió');
            s.reintentoMs = 0;
            grabacion._reintentarAudio();
            t.eq(s.captura, null, 'sin audio llegando no se abre un WAV para nadie');
            grabacion.pcm(pedazo());
            grabacion._reintentarAudio();
            t.ok(s.captura, 'con audio llegando, sí');
            t.eq(s.captura.sampleRate, 24000, 'a la tasa de la entrada que se pidió, no la de antes');
            t.eq(s.estado.dispositivo, 'AirPods');
        } finally {
            captura.abrir = abrir;
            grabacion.apagar();
        }
    });

    t.test('una clase reanudada queda con el micrófono de hoy', () => {
        const st = grabando(5);
        grabacion.apagar();
        grabacion.reanudar(st.archivos.json, { fps: 30, sinReloj: true, dispositivo: 'Shure USB' });
        try {
            const s = grabacion._sesion();
            t.eq(s.estado.dispositivo, 'Shure USB', 'el estado, que es con el que la ventana se reengancha');
            t.eq(s.ultimaEntrada.dispositivo, 'Shure USB', 'y con el que se reabre al despertar');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('un cierre que quedó esperando no termina la clase que arrancó después', async () => {
        grabando(5);
        let seguir;
        grabacion._sesion().pasada = new Promise(r => { seguir = r; });
        const cerrando = grabacion.terminar();
        grabacion.apagar();
        let negada = null;
        try {
            grabando(1);
        } catch (err) {
            negada = err.message;
        }
        t.ok(/todavía se está cerrando/.test(negada || ''), 'mientras el cierre espera, no arranca otra');
        seguir();
        t.eq(await cerrando, null, 'y el cierre ve que su clase ya no está');
        grabando(1);
        try {
            t.ok(grabacion.activa(), 'después, sí');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el WAV nuevo se ancla donde la ventana empezó a capturar, si es creíble', () => {
        grabando(5);
        try {
            const fin = () => { const c = grabacion._sesion().captura; return c.desdeMs + c.segundos * 1000; };
            const ancla = Math.round(Math.max(Date.now(), fin()) + 3000);
            grabacion.cambiarEntrada({ dispositivo: 'B', sampleRate: 48000, canales: 1, desdeMs: ancla });
            t.eq(grabacion._sesion().captura.desdeMs, ancla);
            const finDelSegundo = fin();
            grabacion.cambiarEntrada({ dispositivo: 'C', sampleRate: 48000, canales: 1, desdeMs: Date.now() + 60000 });
            t.ok(grabacion._sesion().captura.desdeMs < Date.now() + 10000, 'una hora a un minuto de ahora no es un ancla');
            t.ok(grabacion._sesion().captura.desdeMs >= finDelSegundo, 'y no se encima al anterior');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('cada WAV termina donde llegó su último pedazo, no cuando se lo cierra', () => {
        grabando(5);
        try {
            const ultimo = grabacion._sesion().captura.ultimoPcmMs;
            t.ok(ultimo, 'se anota');
            grabacion._sesion().captura.ultimoPcmMs = ultimo - 5000;
            grabacion.cambiarEntrada({ dispositivo: 'B', sampleRate: 48000, canales: 1 });
            t.eq(grabacion._sesion().estado.sesiones[0].hastaMs, ultimo - 5000);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('si escribir por última vez falla, la clase igual se suelta y el cierre lo dice', async () => {
        grabando(5);
        const espejo = require('../engine/espejo');
        const escribir = espejo.escribir;
        espejo.escribir = () => { throw new Error('No queda espacio en el disco'); };
        try {
            const salida = await grabacion.terminar();
            t.eq(grabacion.activa(), false, 'no queda una sesión en pie que nadie puede terminar');
            t.eq(salida.comprobacion.ok, false);
            t.ok(/No pude escribir las notas por última vez: No queda espacio/.test(salida.comprobacion.problemas[0]));
        } finally {
            espejo.escribir = escribir;
            grabacion.apagar();
        }
    });

    t.test('una toma de antes de un cambio de entrada no se reabre, y se dice por qué', () => {
        grabando(10);
        const avisos = [];
        try {
            grabacion._sesion().avisar = a => avisos.push(a);
            grabacion.abrirToma();
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.cerrarToma();
            const id = grabacion._sesion().estado.tomas[0].id;
            grabacion.cambiarEntrada({ dispositivo: 'AirPods', sampleRate: 48000, canales: 1 });
            grabacion._sesion().avisar = a => avisos.push(a);
            const r = grabacion.editar({ tipo: 'reabrir', toma: id });
            t.ok(r.tomas.every(t2 => t2.outMs != null), 'sigue cerrada');
            t.ok(avisos.some(a => /No puedo reabrir la toma/.test(a.mensaje || '')), 'y lo dice');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('una toma que cruza a otro WAV no se relee de uno solo', async () => {
        const oirToma = require('../engine/oir-toma');
        const archivos = [{ archivo: __filename, desdeMs: 1000, segundos: 10 }, { archivo: __filename, desdeMs: 11500, segundos: 10 }];
        t.eq(await oirToma.leer(archivos, { id: 1, inMs: 5000, outMs: 15000 }), null);
    });

    t.test('recargada con Zoom grabando, la ventana se engancha a la escucha que sigue y no la reabre', async () => {
        const audioApp = require('../engine/audio-app');
        const canales = new Map();
        puente.registrar({
            ipcMain: { handle: (c, fn) => canales.set(c, fn), on: () => {} },
            app: { on: () => {} }, send: () => {}, anotar: () => {}
        });
        grabando(3);
        audioApp._fingirHijo(true);
        audioApp._conectar({ mandando: true, tasa: 48000, relanzar: () => {} });
        try {
            const r = await canales.get('audio-app-abrir')(null, { modo: 'app', reusar: true });
            t.ok(r.ok && r.reusado, 'reusada');
            t.eq(r.sampleRate, 48000);
            t.ok(audioApp.estaMandando(), 'y sigue mandando al mismo WAV');
        } finally {
            audioApp._fingirHijo(false);
            audioApp.dejarDeMandar();
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
        const trasReenganchar = volver.slice(volver.indexOf('preparar.reengancharGrabando(enCurso)'));
        t.ok(/app\.irAVivo\(/.test(trasReenganchar.slice(0, 200)), 'aunque no se pueda: las notas siguen');
        t.ok(/if \(enCurso\.terminando\) \{[\s\S]{0,400}window\.nt\.grabarTerminar\(\)[\s\S]{0,80}app\.irACierre\(salida\)/.test(volver),
            'y si ya se estaba terminando, espera ese cierre y va a su resumen');
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
