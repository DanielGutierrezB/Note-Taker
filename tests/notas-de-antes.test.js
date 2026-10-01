'use strict';
/**
 * Volver a entrar a una clase ya grabada, en la pantalla de la clase.
 *
 * El editor, con la lista de Sesiones delante: «en esta interfaz debería poder
 * entrar nuevamente a mis notas anteriores como en la vista de cuando las estoy
 * tomando […] por si deseo ajustar una nota desde ahí directamente.»
 *
 * Lo que cuidan estas pruebas es que sea la MISMA pantalla y no una parecida: el
 * estado que contesta `paraMirar` tiene que tener la forma del que manda
 * `espejo.resumen` grabando, porque si le falta un campo la pantalla de la clase
 * se rompe al dibujarlo y nadie lo sabe hasta que alguien aprieta el botón. Y que
 * entrar a mirar no pueda pisar la clase que se está grabando, que es el único
 * daño irreversible que hay por acá.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sesiones = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');
const notasXml = require('../engine/notas-xml');
const vivo = require('../engine/notas-vivo');

const T0 = Date.parse('2026-09-29T10:00:00');
const SRC = path.join(__dirname, '..', 'src', 'js');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-mirar-'));
}

/** Una clase grabada en el disco: dos tomas con texto y una claqueta. */
function sembrar(opciones) {
    const o = opciones || {};
    const dir = carpeta();
    const secuencia = o.secuencia || 'curso_2026-09-29_10-00-00';
    const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
    workspace.ensureDir(path.dirname(wav));
    fs.writeFileSync(wav, Buffer.alloc(1024));

    const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
    estado.sesiones = [{ archivo: wav, desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
    const palabras = (desde, cuantas) => Array.from({ length: cuantas }, (_, i) => ({
        t: desde + i * 500, hasta: desde + i * 500 + 400, texto: `pa${i}`
    }));
    estado.tomas = [
        {
            id: 1, vista: 'PV', comentario: 'La primera', cuenta: '3, 2, 1.',
            inMs: T0 + 20000, outMs: T0 + 40000, descartada: false,
            palabras: palabras(T0 + 20000, 20), antes: [], despues: [], comentarios: []
        },
        {
            id: 2, vista: 'R', comentario: 'La segunda', cuenta: '3, 2, 1.',
            inMs: T0 + 60000, outMs: T0 + 90000, descartada: false,
            palabras: palabras(T0 + 60000, 30),
            // El gris de antes del IN llega hasta ANTES del OUT de la toma 1: es
            // el espacio compartido del que habla el editor, y es justo donde se
            // puede arrastrar el IN demasiado atrás.
            antes: palabras(T0 + 36000, 48), despues: [], comentarios: []
        }
    ];
    vivo.anotarClaqueta(estado, { ms: T0 + 12000, confirmada: true, origen: 'golpe' });
    if (o.terminada !== false) estado.terminada = T0 + 600000;

    const archivos = workspace.archivosDeSesion(dir, secuencia);
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return { ...archivos, dir, secuencia };
}

/**
 * Qué decide la pantalla, sacado del archivo de verdad.
 *
 * `esDeMirar` es de una línea y es la que manda todo lo demás —qué cromo se
 * esconde, por qué puerta salen los cambios, si Enter abre una toma—, así que lo
 * que hay que fijar es su regla y no copiarla acá. Se lee del fuente para que una
 * prueba que pasa no pueda estar mirando una copia vieja.
 */
function esDeMirarDeLaPantalla() {
    const fuente = fs.readFileSync(path.join(SRC, 'pantalla-vivo.js'), 'utf8');
    const desde = fuente.indexOf('function esDeMirar()');
    const hasta = fuente.indexOf('\n}', desde);
    const cuerpo = fuente.slice(fuente.indexOf('{', desde) + 1, hasta);
    return new Function('estado', cuerpo);
}

module.exports = function (t) {
    t.group('notas de antes · el estado que manda el motor');

    t.test('tiene la forma del que manda grabando', () => {
        const s = sembrar();
        const e = sesiones.paraMirar(s.json, null);
        // Los campos que la pantalla de la clase dibuja sin preguntar. Si alguno
        // falta, `pintar` se cae en el primero que toque.
        for (const campo of ['secuencia', 'ceroMs', 'fps', 'tomas', 'claquetas', 'vistas',
            'sueltas', 'segundos', 'historia', 'archivos', 'abierta', 'releyendo']) {
            t.ok(campo in e, `trae ${campo}`);
        }
        t.eq(e.tomas.length, 2);
        t.eq(e.claquetas.length, 1);
        t.eq(e.tomas[1].comentario, 'La segunda', 'con las notas de verdad');
        t.eq(e.tomas[0].palabras.length, 20, 'y con el texto, que es donde se arrastra');
    });

    t.test('dice que no se está grabando, y cuál es su archivo', () => {
        const s = sembrar();
        const e = sesiones.paraMirar(s.json, null);
        t.eq(e.grabando, false, 'el campo con el que la pantalla se apaga el cromo');
        t.eq(e.terminada, true);
        t.eq(e.json, s.json, 'el sidecar por donde va a salir cada cambio');
        t.eq(e.abierta, null, 'y ninguna toma abierta: no hay ciclo que la llene');
        t.deep(e.sueltas, [], 'ni colchón de palabras sueltas');
    });

    t.test('el reloj es la duración del audio grabado', () => {
        const s = sembrar();
        const e = sesiones.paraMirar(s.json, null);
        t.eq(e.segundos, 600, 'los 600 s del único pedazo');
    });

    t.test('sin deshacer, y a propósito', () => {
        const s = sembrar();
        const e = sesiones.paraMirar(s.json, null);
        t.eq(e.historia.atras, 0);
        t.eq(e.historia.adelante, 0);
    });

    t.test('una clase sin terminar se puede mirar, y lo dice', () => {
        const s = sembrar({ terminada: false });
        const e = sesiones.paraMirar(s.json, null);
        t.eq(e.terminada, false);
        t.eq(e.grabando, false, 'sin cerrar no es lo mismo que grabando');
    });

    t.test('la que se está grabando NO se abre por acá', () => {
        const s = sembrar({ terminada: false });
        let dijo = '';
        try {
            sesiones.paraMirar(s.json, s.secuencia);
        } catch (e) {
            dijo = e.message;
        }
        t.ok(dijo, 'se niega');
        t.ok(/grabando/i.test(dijo), `y dice por qué: ${dijo}`);
    });

    t.group('notas de antes · ajustar una nota desde ahí');

    t.test('la nota queda en el XML y no se pierde nada más', () => {
        const s = sembrar();
        const antes = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        const r = sesiones.editarGrabada(s.json, { tipo: 'nota', toma: 2, texto: 'Ajustada después' });

        t.eq(r.estado.grabando, false, 'contesta el estado para repintar');
        t.eq(r.estado.tomas[1].comentario, 'Ajustada después');
        t.ok(fs.readFileSync(s.xml, 'utf8').includes('Ajustada después'), 'y el XML lo dice');

        const despues = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        t.eq(despues.tomas[0].comentario, 'La primera', 'la otra nota intacta');
        t.deep(despues.tomas.map(x => (x.palabras || []).map(w => w.texto)),
            antes.tomas.map(x => (x.palabras || []).map(w => w.texto)), 'las palabras intactas');
        t.deep(despues.claquetas, antes.claquetas, 'la claqueta intacta');
        t.eq(despues.terminada, antes.terminada, 'y sigue terminada');
    });

    t.test('la vista, desactivar y la nota de la claqueta también', () => {
        const s = sembrar();
        sesiones.editarGrabada(s.json, { tipo: 'vista', toma: 1, vista: 'MG' });
        sesiones.editarGrabada(s.json, { tipo: 'descartar', toma: 1, descartada: true });
        const r = sesiones.editarGrabada(s.json, { tipo: 'nota-claqueta', n: 1, texto: 'Tarjeta 1' });
        t.eq(r.estado.tomas[0].vista, 'MG');
        t.eq(r.estado.tomas[0].descartada, true);
        t.eq(r.estado.claquetas[0].comentario, 'Tarjeta 1');
        const xml = fs.readFileSync(s.xml, 'utf8');
        t.ok(xml.includes('Tarjeta 1'));
        t.ok(!xml.includes('La primera'), 'y la toma desactivada ya no está en el XML');
    });

    t.test('mover un borde anda, y no pisa la toma anterior', () => {
        const s = sembrar();
        const adelante = sesiones.editarGrabada(s.json, { tipo: 'borde', toma: 2, borde: 'in', paredMs: T0 + 50000 });
        t.ok(adelante.estado.tomas[1].inMs < T0 + 60000, 'el IN se puede correr hacia atrás');
        // El OUT de la 1 está en T0+40000, y el gris de la 2 llega más atrás: ahí
        // es donde el arrastre tiene que frenarse.
        const r = sesiones.editarGrabada(s.json, { tipo: 'borde', toma: 2, borde: 'in', paredMs: T0 + 37000 });
        t.ok(r.estado.tomas[1].inMs >= T0 + 40000,
            `frenado en el OUT anterior (quedó en ${(r.estado.tomas[1].inMs - T0) / 1000} s)`);
        t.eq(r.estado.tomas[0].outMs, T0 + 40000, 'y la toma anterior sin tocar');
        t.eq(r.estado.tomas[0].palabras.length, 20, 'con sus palabras');
    });

    t.test('reabrir se niega con su motivo, no en silencio', () => {
        const s = sembrar();
        let dijo = '';
        try {
            sesiones.editarGrabada(s.json, { tipo: 'reabrir', toma: 2 });
        } catch (e) {
            dijo = e.message;
        }
        t.ok(/arrastr/i.test(dijo), `dice qué hacer en su lugar: ${dijo}`);
        const despues = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        t.eq(despues.tomas[1].outMs, T0 + 90000, 'y no tocó nada');
    });

    t.group('notas de antes · lo que decide la pantalla');

    t.test('`esDeMirar` mira `grabando` y nada más', () => {
        const mirar = esDeMirarDeLaPantalla();
        t.eq(mirar({ grabando: false, terminada: true }), true, 'una clase grabada');
        t.eq(mirar({ grabando: false, terminada: false }), true, 'y una sin cerrar también');
        t.eq(mirar({ grabando: true }), false, 'la que se está grabando, no');
        // Sin estado la pantalla no dibuja nada, pero `pintarBarra` corre cada
        // 150 ms desde un `setInterval`: acá no puede explotar ni decir que sí.
        t.eq(mirar(null), false, 'sin estado, no');
        t.eq(mirar({}), false, 'y un estado sin el campo tampoco: grabar es lo seguro');
    });

    t.test('el estado del motor y la pantalla están de acuerdo', () => {
        const s = sembrar();
        const mirar = esDeMirarDeLaPantalla();
        t.eq(mirar(sesiones.paraMirar(s.json, null)), true,
            'lo que contesta `paraMirar` la pantalla lo lee como "mirando"');
    });

    t.test('el camino de Sesiones a las notas existe de punta a punta', () => {
        // Las tres puntas: el botón de la fila, el puente y el motor. Un eslabón
        // que no exista deja el botón sin hacer nada, y en la app no hay quien lo
        // note hasta que alguien lo aprieta.
        const fila = fs.readFileSync(path.join(SRC, 'pantalla-sesiones.js'), 'utf8');
        t.ok(/data-hace="notas"/.test(fila), 'la fila tiene el botón');
        t.ok(/grabarAbrirGrabada/.test(fila), 'que llama al puente');
        t.ok(/irANotas/.test(fila), 'y lleva a la pantalla de la clase');

        const puente = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
        t.ok(/grabarAbrirGrabada:/.test(puente), 'el puente lo expone');
        const ipc = fs.readFileSync(path.join(__dirname, '..', 'ipc', 'grabar.js'), 'utf8');
        t.ok(/'grabar-abrir-grabada'/.test(ipc), 'el canal existe');
        t.eq(typeof require('../engine/grabacion').paraMirar, 'function', 'y el motor contesta');

        const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
        t.ok(/irANotas\(estado\)/.test(app), 'la ruta está');
        t.ok(/irANotas[\s\S]{0,320}btn-volver'\)\.hidden = false/.test(app),
            'y deja encendido el camino de vuelta, porque acá no se está grabando');
    });

    t.test('el cromo de grabar se esconde, y la salida va al sidecar', () => {
        const fuente = fs.readFileSync(path.join(SRC, 'pantalla-vivo.js'), 'utf8');
        const mirando = fuente.slice(fuente.indexOf('const mirando = esDeMirar();'));
        for (const cual of ['btn-terminar', 'btn-claqueta', 'vivo-nivel', 'btn-deshacer', 'btn-rehacer']) {
            t.ok(new RegExp(`#${cual}'\\)\\.hidden = mirando`).test(mirando.slice(0, 700)),
                `${cual} se esconde`);
        }
        const editar = fuente.slice(fuente.indexOf('async function editar(cambio)'));
        t.ok(/esDeMirar\(\)[\s\S]{0,400}grabarEditarGrabada/.test(editar.slice(0, 900)),
            'y los cambios salen por `editarGrabada` cuando se está mirando');
    });
};
