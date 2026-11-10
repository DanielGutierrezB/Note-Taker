'use strict';
/**
 * Reanudar y cerrar sin perder la clase.
 *
 * Cada prueba es un fallo que pasaba de verdad, y todas fallaban antes del
 * arreglo:
 *
 *   · reanudar después de reabrir la app abría `-1.wav` truncándolo, con la
 *     primera mitad de la clase adentro;
 *   · tras un cierre brusco, la toma abierta se cerraba donde decía el último
 *     guardado y no donde llegaba el audio;
 *   · un «Iniciar» que fallaba al abrir el audio dejaba una sesión que nadie
 *     podía terminar;
 *   · un WAV que no se podía cerrar hacía fallar «Terminar» para siempre;
 *   · los gestos seguían entrando mientras la clase decía «terminando»;
 *   · unos ajustes ilegibles se pisaban con los de fábrica sin dejar rastro.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const captura = require('../engine/captura');
const grabacion = require('../engine/grabacion');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const workspace = require('../engine/workspace');
const ajustes = require('../engine/ajustes');

const RAIZ = path.join(__dirname, '..');
const T0 = Date.parse('2026-11-04T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-reanudar-'));
}

/** Un pedazo de PCM silencioso, del tamaño que manda la ventana. */
function pedazo(muestras) {
    return Buffer.alloc((muestras || 4096) * 2);
}

/** `fn` con un disco que no deja escribir la cabecera de ningún WAV. */
async function conCabeceraQueFalla(fn) {
    const real = fs.writeSync;
    fs.writeSync = (fd, buf, desde, largo, pos, ...resto) => {
        if (largo === 44 && pos === 0) throw new Error('EIO: el disco no contesta');
        return real(fd, buf, desde, largo, pos, ...resto);
    };
    try {
        return await fn();
    } finally {
        fs.writeSync = real;
    }
}

module.exports = function (t) {
    t.group('reanudar · el audio grabado no se pisa');

    t.test('abrir un WAV salta los que ya están en el disco', () => {
        // El contador vuelve a cero con cada arranque de la app, así que sin
        // esto el WAV de la segunda mitad caía encima del de la primera.
        const dir = carpeta();
        const previos = [];
        for (let n = 1; n <= 300; n++) {
            const archivo = path.join(dir, `clase-${n}.wav`);
            fs.writeFileSync(archivo, `audio de antes ${n}`);
            previos.push(archivo);
        }
        const abierto = captura.abrir({ dir, nombre: 'clase', sampleRate: 48000, canales: 1 });
        try {
            t.ok(!previos.includes(abierto.archivo), `abrió uno nuevo: ${path.basename(abierto.archivo)}`);
            for (let n = 1; n <= 300; n++) {
                t.eq(fs.readFileSync(previos[n - 1], 'utf8'), `audio de antes ${n}`);
            }
        } finally {
            captura.cerrar(abierto.id);
        }
    });

    t.group('reanudar · la toma abierta llega hasta donde llegó el audio');

    t.test('se cierra donde termina el WAV del disco, no donde decía el último guardado', () => {
        // El archivo de notas se escribió a los 10 s; la app siguió grabando
        // hasta los 30 y murió sin escribir más.
        const dir = carpeta();
        const secuencia = 'curso_2026-11-04_10-00-00';
        const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
        workspace.ensureDir(path.dirname(wav));
        fs.writeFileSync(wav, Buffer.concat([captura.cabecera(30 * 48000 * 2, 48000, 1), Buffer.alloc(30 * 48000 * 2)]));

        const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
        estado.sesiones = [{ archivo: wav, desdeMs: T0, segundos: 10, sampleRate: 48000, canales: 1 }];
        estado.tomas = [{
            id: 1, vista: 'PV', comentario: '', inMs: T0 + 5000, outMs: null, descartada: false,
            palabras: [{ t: T0 + 5000, texto: 'Hola' }], comentarios: []
        }];
        const archivos = workspace.archivosDeSesion(dir, secuencia);
        workspace.writeJson(archivos.json, notasXml.sidecar(estado));

        const previa = sesionesGrabadas.paraReanudar(archivos.json, null);
        const toma = previa.estado.tomas[0];
        t.eq(toma.outMs, T0 + 30000, 'el OUT va al final del audio que hay');
        t.eq(previa.estado.sesiones[0].segundos, 30, 'y el WAV dice lo que mide');
    });

    t.test('con una toma abierta, el archivo de notas se guarda aunque nada cambie', () => {
        // Lo que la toma oye no es un cambio, y antes solo se guardaba con un
        // cambio: lo dicho desde el último quedaba en memoria.
        const dir = carpeta();
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        try {
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            const abierta = grabacion.abrirToma();
            const s = grabacion._sesion();
            const toma = s.estado.tomas.find(x => x.id === abierta.abierta);
            toma.palabras = [{ t: toma.inMs + 100, texto: 'recién' }, { t: toma.inMs + 400, texto: 'dicho' }];
            s.guardadoMs = 0;
            grabacion.guardarLaAbierta();
            const leido = JSON.parse(fs.readFileSync(abierta.archivos.json, 'utf8'));
            const guardada = leido.tomas.find(x => x.id === abierta.abierta);
            t.deep(guardada.palabras.map(w => w.texto), ['recién', 'dicho']);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('y sin toma abierta no se reescribe', () => {
        const dir = carpeta();
        const st = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        try {
            const antes = fs.readFileSync(st.archivos.json, 'utf8');
            grabacion._sesion().estado.curso = 'otro';
            grabacion._sesion().guardadoMs = 0;
            grabacion.guardarLaAbierta();
            t.eq(fs.readFileSync(st.archivos.json, 'utf8'), antes);
        } finally {
            grabacion.apagar();
        }
    });

    t.group('iniciar · si falla, no queda una sesión en pie');

    t.test('un audio que no se puede abrir no deja la grabación tomada', () => {
        // Un archivo en el lugar de la carpeta: crear `xml/Audio` adentro falla,
        // igual que con el disco desenchufado.
        const dir = carpeta();
        const noEsCarpeta = path.join(dir, 'no-es-carpeta');
        fs.writeFileSync(noEsCarpeta, 'x');
        let error = null;
        try {
            grabacion.iniciar({ dir: noEsCarpeta, curso: 'prueba', fps: 30, sinReloj: true });
        } catch (e) {
            error = e.message;
        }
        t.ok(error, 'el error llega a quien apretó Iniciar');
        t.eq(grabacion.activa(), false, 'y no queda nada grabando');
        const otra = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        t.ok(otra && otra.secuencia, 'la siguiente arranca sin reiniciar la app');
        grabacion.apagar();
    });

    t.group('terminar · un WAV que no cierra no la traba');

    t.test('cerrar suelta la sesión aunque la cabecera no se pueda escribir', async () => {
        const dir = carpeta();
        const abierto = captura.abrir({ dir, nombre: 'x', sampleRate: 48000, canales: 1 });
        const r = await conCabeceraQueFalla(() => captura.cerrar(abierto.id));
        t.ok(r && /EIO/.test(r.error), 'dice qué pasó');
        t.eq(captura.cerrar(abierto.id), null, 'y la segunda vez no hay nada que cerrar');
    });

    t.test('«Terminar» termina, y la siguiente clase arranca', async () => {
        const dir = carpeta();
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
        const salida = await conCabeceraQueFalla(() => grabacion.terminar());
        t.ok(salida, 'terminó');
        t.eq(grabacion.activa(), false);
        const notas = JSON.parse(fs.readFileSync(salida.archivos.json, 'utf8'));
        t.eq(notas.sesiones.length, 1, 'con su WAV apuntado');
        t.eq(notas.sesiones[0].error, undefined, 'y el error va al diario, no al archivo de notas');
    });

    t.group('terminando · ya no entran gestos');

    t.test('ni abrir, ni editar, ni deshacer', () => {
        const dir = carpeta();
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        try {
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma();
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            grabacion.cerrarToma();
            const s = grabacion._sesion();
            s.terminando = true;
            const tomas = s.estado.tomas.length;

            grabacion.abrirToma();
            t.eq(s.estado.tomas.length, tomas, 'Enter no abre otra');
            grabacion.editar({ tipo: 'reabrir', toma: 1 });
            t.ok(s.estado.tomas[0].outMs != null, 'Reabrir no la reabre');
            const r = grabacion.deshacer();
            t.eq(r.ok, false, '⌘Z no deshace');
            t.ok(s.estado.tomas[0].outMs != null, 'y la toma sigue cerrada');
            s.terminando = false;
        } finally {
            grabacion.apagar();
        }
    });

    t.test('y la pantalla tampoco los manda', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        const teclado = js.slice(js.indexOf('async function alTeclado(e) {'));
        t.ok(/if \(terminando\) return;/.test(teclado.slice(0, 400)));
    });

    t.group('ajustes · los ilegibles se guardan aparte');

    t.test('un archivo roto se copia antes de que se escriba encima', () => {
        const antes = process.env.NT_AJUSTES;
        const dir = carpeta();
        const archivo = path.join(dir, 'ajustes.json');
        process.env.NT_AJUSTES = archivo;
        try {
            if (ajustes.dondeViven() !== archivo) throw new Error('NO se escribe: no es el archivo de prueba');
            fs.writeFileSync(archivo, '{"fps": 23.976, "carpeta": "/Cursos/Re');
            t.eq(ajustes.leer().fps, 30, 'se lee como de fábrica, para poder grabar');
            const copias = fs.readdirSync(dir).filter(n => n.startsWith('ajustes.json.ilegible-'));
            t.eq(copias.length, 1, 'y quedó una copia');
            t.ok(fs.readFileSync(path.join(dir, copias[0]), 'utf8').includes('23.976'), 'con lo de antes');
            t.ok(ajustes.aviso() && ajustes.aviso().includes(copias[0]), 'y el aviso dice dónde');
            ajustes.guardar({ ...ajustes.leer(), fps: 25 });
            t.eq(ajustes.leer().fps, 25, 'después se guarda normal');
        } finally {
            if (antes === undefined) delete process.env.NT_AJUSTES;
            else process.env.NT_AJUSTES = antes;
        }
    });
};
