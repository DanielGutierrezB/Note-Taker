'use strict';
/**
 * Una sesión entera, de punta a punta y sin Whisper.
 *
 * Es la prueba que más cubre de todo el repo: arranca una grabación de verdad
 * —escribe el WAV, escribe el XML, escribe el sidecar— y le mete las palabras
 * a mano en lugar de dejar que las traiga el modelo. Lo que queda afuera es
 * solo la transcripción; todo el resto del camino es el de la app.
 *
 * El motivo de meter las palabras a mano es que el ciclo de señales necesita
 * `whisper-cli` y un modelo de un giga y medio, y esto tiene que correr en
 * cualquier máquina y en un segundo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const vivo = require('../engine/notas-vivo');
const workspace = require('../engine/workspace');
const notasXml = require('../engine/notas-xml');
const rodecaster = require('../engine/rodecaster-xml');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-sesion-'));
}

/** Un pedazo de PCM silencioso, del tamaño que manda la ventana. */
function pedazo(muestras) {
    return Buffer.alloc((muestras || 4096) * 2);
}

module.exports = function (t) {
    t.group('sesión · de punta a punta');

    t.test('arrancar escribe el XML y el sidecar desde el primer instante', () => {
        const dir = carpeta();
        try {
            const estado = grabacion.iniciar({
                dir, curso: 'prueba', fps: 30, idioma: 'es', sinReloj: true
            });
            t.ok(fs.existsSync(estado.archivos.xml), 'el XML existe ya');
            t.ok(fs.existsSync(estado.archivos.json), 'y el sidecar también');
            t.ok(estado.archivos.xml.includes(`${path.sep}xml${path.sep}`), 'en xml/');
            t.ok(estado.archivos.json.includes(`${path.sep}Datos${path.sep}`), 'y en xml/Datos/');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el audio va a xml/Audio y crece con cada pedazo', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            grabacion.pcm(pedazo());
            const r = grabacion.pcm(pedazo());
            t.ok(r.segundos > 0, 'el WAV tiene audio');
            const wavs = fs.readdirSync(workspace.audioDir(dir));
            t.eq(wavs.length, 1);
            t.ok(wavs[0].endsWith('.wav'));
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el XML lleva el audio en A1 apenas hay algo grabado', () => {
        const dir = carpeta();
        let estado;
        try {
            estado = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            // Cualquier gesto reescribe el XML; la claqueta es el más barato.
            grabacion.claqueta();
        } finally {
            grabacion.apagar();
        }
        const xml = fs.readFileSync(estado.archivos.xml, 'utf8');
        t.ok(xml.includes('<pathurl>'), 'el WAV está referenciado');
        t.ok(xml.includes('.wav'), 'y es un WAV');
        t.ok(/<clipitem[\s\S]*?<marker>/.test(xml), 'con los marcadores pegados al clip');
    });

    t.test('editar sin sesión no explota', () => {
        // La ventana puede mandar un cambio justo después de Terminar: entre
        // que se pinta el botón y llega el clic, la sesión ya no está.
        t.eq(grabacion.editar({ tipo: 'nota', toma: 1, texto: 'x' }), null);
        t.eq(grabacion.cerrarToma(), null);
        t.eq(grabacion.claqueta(), null);
        t.eq(grabacion.resumen(), null);
    });

    t.test('terminar deja la sesión dicha como terminada', async () => {
        const dir = carpeta();
        grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
        const salida = await grabacion.terminar();
        t.ok(salida, 'contesta');
        const sidecar = JSON.parse(fs.readFileSync(salida.archivos.json, 'utf8'));
        t.ok(sidecar.terminada, 'queda con la hora de cierre');
        t.eq(grabacion.activa(), false, 'y la sesión se soltó');
    });

    t.test('apagar la app NO la deja terminada, para poder reanudarla', () => {
        const dir = carpeta();
        const estado = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
        grabacion.apagar();
        const sidecar = JSON.parse(fs.readFileSync(estado.archivos.json, 'utf8'));
        t.eq(sidecar.terminada, null, 'sin terminar');
        t.ok((sidecar.sesiones || []).length > 0, 'pero con su audio anotado');
    });

    t.test('dos sesiones a la vez no', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'a', fps: 30, sinReloj: true });
            let error = null;
            try { grabacion.iniciar({ dir, curso: 'b', fps: 30, sinReloj: true }); }
            catch (e) { error = e.message; }
            t.ok(error && error.includes('en curso'), error);
        } finally {
            grabacion.apagar();
        }
    });

    t.group('sesión · la claqueta a mano');

    t.test('se estampa con el reloj del AUDIO y no con Date.now()', () => {
        // Es el cambio que hace que todo cierre en el total. El editor aprieta
        // la tecla mientras oye la claqueta, y el audio que se está escribiendo
        // va uno o dos pedazos por detrás del reloj de pared: con `Date.now()`
        // la marca caía adelante de donde suena.
        //
        // Se comprueba contra CUÁNTO AUDIO HAY, que es el reloj de la app, y no
        // contra `Date.now()`: acá los pedazos se escriben de golpe, así que la
        // posición en el audio corre más rápido que el reloj de pared. Es la
        // misma propiedad que deja pasarle a la app el audio de una clase vieja
        // a toda velocidad (`tools/simular-grabacion.js`).
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            const pedazos = 20;
            let r;
            for (let i = 0; i < pedazos; i++) r = grabacion.pcm(pedazo());

            const antes = Date.now();
            const estado = grabacion.claqueta();
            t.eq(estado.claquetas.length, 1);
            const c = estado.claquetas[0];

            // La marca cae donde llega el audio escrito, al milisegundo.
            t.near(c.ms - inicial.ceroMs, r.segundos * 1000, 50);
            t.ok(c.ms !== c.paredMs, 'los dos relojes se guardan aparte');
            t.ok(c.paredMs >= antes, 'y el de pared es el de verdad, para depurar');
            t.eq(c.origen, 'editor');
            t.ok(c.confirmada, 'la afirmó una persona que estaba mirando');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('quitarla la saca y deja el XML sin ese marcador', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.claqueta();
            const estado = grabacion.quitarClaqueta(1);
            t.eq(estado.claquetas.length, 0);
            const xml = fs.readFileSync(inicial.archivos.xml, 'utf8');
            t.ok(!xml.includes('Claqueta 1'), 'el XML tampoco la tiene');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('se deshace, y con ella la renumeración', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.claqueta();
            const r = grabacion.deshacer();
            t.ok(r.ok, r.error);
            t.eq(r.estado.claquetas.length, 0);
            const rehecho = grabacion.rehacer();
            t.eq(rehecho.estado.claquetas.length, 1);
        } finally {
            grabacion.apagar();
        }
    });

    t.group('sesión · abrir y cerrar a mano');

    t.test('abrir deja una toma abierta, con el reloj del audio', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            let r;
            for (let i = 0; i < 20; i++) r = grabacion.pcm(pedazo());
            const estado = grabacion.abrirToma();
            t.ok(estado.abierta != null, 'quedó una abierta');
            const toma = estado.tomas.find(x => x.id === estado.abierta);
            t.near(toma.inMs - inicial.ceroMs, r.segundos * 1000, 50);
            t.eq(toma.cuenta, '', 'sin conteo: no se dijo ninguno');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('la que se abrió a mano se cierra a mano', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma();
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            const estado = grabacion.cerrarToma();
            t.eq(estado.abierta, null);
            t.ok(estado.tomas[0].outMs != null);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('abrir con la hora de una palabra pone el IN ahí', () => {
        // Es el IN arrastrado en el campo de espera.
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            const estado = grabacion.abrirToma(inicial.ceroMs + 1000);
            t.eq(estado.tomas[0].inMs, inicial.ceroMs + 1000);
            t.eq(estado.retrocedioSec > 0, true, 'contado desde ahora');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('una palabra del futuro no abre más adelante que lo grabado', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            let r;
            for (let i = 0; i < 20; i++) r = grabacion.pcm(pedazo());
            const estado = grabacion.abrirToma(inicial.ceroMs + 3600000);
            t.near(estado.tomas[0].inMs - inicial.ceroMs, r.segundos * 1000, 50);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('cerrar con la hora de una palabra pone el OUT ahí', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma(inicial.ceroMs + 500);
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            const estado = grabacion.cerrarToma(inicial.ceroMs + 2000);
            t.eq(estado.abierta, null);
            t.eq(estado.tomas[0].outMs, inicial.ceroMs + 2000);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('un OUT en el IN o antes no cierra nada', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma(inicial.ceroMs + 1000);
            const estado = grabacion.cerrarToma(inicial.ceroMs + 900);
            t.ok(estado.abierta != null, 'sigue abierta');
            t.eq(estado.historia.atras, 1, 'y no dejó un paso vacío en el historial');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el IN de la abierta se mueve sin cerrarla y se deshace', () => {
        const dir = carpeta();
        try {
            const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma(inicial.ceroMs + 1500);
            const estado = grabacion.editar({ tipo: 'borde', toma: 1, borde: 'in', paredMs: inicial.ceroMs + 700 });
            t.eq(estado.tomas[0].inMs, inicial.ceroMs + 700);
            t.eq(estado.abierta, 1, 'sigue abierta');
            const r = grabacion.deshacer();
            t.eq(r.estado.tomas[0].inMs, inicial.ceroMs + 1500);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el estado trae lo suelto, que es el texto del campo de espera', () => {
        const dir = carpeta();
        try {
            const estado = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            t.ok(Array.isArray(estado.sueltas), 'aunque esté vacío');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('abrir dos veces seguidas no deja dos abiertas', () => {
        // Llega solo: entre que la pantalla dibuja el botón y el clic, el
        // ciclo de señales pudo haber oído un conteo.
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma();
            const estado = grabacion.abrirToma();
            t.eq(estado.tomas.length, 1);
        } finally {
            grabacion.apagar();
        }
    });

    t.test('se deshace, y la toma se va de la sesión', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            grabacion.abrirToma();
            const r = grabacion.deshacer();
            t.ok(r.ok, r.error);
            t.eq(r.estado.tomas.length, 0);
            t.eq(r.estado.abierta, null);
            t.ok(r.que.includes('abrir'), r.que);
            const rehecho = grabacion.rehacer();
            t.eq(rehecho.estado.tomas.length, 1, 'y se rehace');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('una toma abierta a mano llega al XML al terminar', async () => {
        const dir = carpeta();
        const inicial = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
        grabacion.abrirToma();
        for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
        // La cierra `terminar`, como la toma que el profesor olvidó cerrar.
        const salida = await grabacion.terminar();
        t.eq(salida.tomas.length, 1);
        t.ok(salida.tomas[0].cerradaSola, 'la cerró el cierre de la sesión');
        const xml = fs.readFileSync(inicial.archivos.xml, 'utf8');
        t.ok(xml.includes('<name>PV</name>'), 'y está en el XML');
    });

    t.group('sesión · reanudar');

    t.test('sigue en el mismo XML, con el mismo cero y otro WAV', async () => {
        // Es lo que protege el invariante que importa: que de una clase salga
        // UN XML con los tiempos cerrados de punta a punta.
        const dir = carpeta();
        const primera = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
        grabacion.claqueta();
        grabacion.apagar();   // como si la app se hubiera ido al piso

        const segunda = grabacion.reanudar(primera.archivos.json, { sinReloj: true });
        try {
            t.eq(segunda.secuencia, primera.secuencia, 'el mismo nombre');
            t.eq(segunda.ceroMs, primera.ceroMs, 'y el mismo cero');
            t.eq(segunda.claquetas.length, 1, 'con lo que ya había adentro');
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
        } finally {
            await grabacion.terminar();
        }

        const sidecar = JSON.parse(fs.readFileSync(primera.archivos.json, 'utf8'));
        t.eq(sidecar.sesiones.length, 2, 'dos WAV: el de antes y el de después');
        const xml = fs.readFileSync(primera.archivos.xml, 'utf8');
        t.eq((xml.match(/<pathurl>/g) || []).length, 2, 'los dos en A1');
    });

    t.test('una sesión ya terminada no se reanuda', async () => {
        const dir = carpeta();
        const s = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
        for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
        await grabacion.terminar();
        let error = null;
        try { grabacion.reanudar(s.archivos.json, { sinReloj: true }); }
        catch (e) { error = e.message; }
        t.ok(error && error.includes('ya se cerró'), error);
    });

    t.group('sesión · lo que se escribe se puede leer');

    t.test('el XML de una sesión recién arrancada ya es legible', () => {
        const dir = carpeta();
        try {
            const estado = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            const leido = rodecaster.parseXml(fs.readFileSync(estado.archivos.xml, 'utf8'));
            t.ok(leido.ok, leido.error);
            t.eq(leido.sequenceName, estado.secuencia);
        } finally {
            grabacion.apagar();
        }
    });
};
