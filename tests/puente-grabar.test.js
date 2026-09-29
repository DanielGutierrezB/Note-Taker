'use strict';
/**
 * El puente con la ventana: que los canales existan y que lo que contestan
 * tenga la forma que la pantalla espera.
 *
 * No levanta Electron: se le pasa un `ipcMain` de mentira que guarda los
 * manejadores, y después se los llama. Lo que se está fijando es el contrato,
 * que es lo que se rompe en silencio cuando se renombra algo del motor.
 */

const puente = require('../ipc/grabar');

function armar() {
    const canales = new Map();
    const escuchas = new Map();
    const avisos = [];
    const diario = [];
    const alCerrar = [];

    puente.registrar({
        ipcMain: {
            handle: (canal, fn) => canales.set(canal, fn),
            on: (canal, fn) => escuchas.set(canal, fn)
        },
        app: { on: (evento, fn) => { if (evento === 'before-quit') alCerrar.push(fn); } },
        send: (canal, payload) => avisos.push({ canal, payload }),
        anotar: (evento, datos) => diario.push({ evento, datos })
    });

    return {
        canales, escuchas, avisos, diario, alCerrar,
        llamar: (canal, ...args) => canales.get(canal)(null, ...args)
    };
}

module.exports = function (t) {
    t.group('puente · los canales que la ventana usa');

    t.test('están todos los que el preload declara', () => {
        const { canales, escuchas } = armar();
        const esperados = [
            'grabar-iniciar', 'grabar-reanudar', 'grabar-claqueta', 'grabar-quitar-claqueta',
            'grabar-editar', 'grabar-editar-grabada',
            'grabar-abrir-toma', 'grabar-cerrar-toma',
            'grabar-deshacer', 'grabar-rehacer', 'grabar-estado', 'grabar-vistas',
            'grabar-listar', 'grabar-renombrar', 'grabar-borrar', 'grabar-regenerar',
            'grabar-terminar'
        ];
        for (const canal of esperados) {
            t.ok(canales.has(canal), `falta ${canal}`);
        }
        t.ok(escuchas.has('grabar-pcm'), 'el PCM va por `on` y no por `handle`');
    });

    t.test('el PCM va por `send` a propósito', () => {
        // Llega varias veces por segundo y no hay nada que esperar de vuelta:
        // devolver el estado entero por cada pedazo llenaría el puente.
        const { canales } = armar();
        t.eq(canales.has('grabar-pcm'), false);
    });

    t.group('puente · lo que contesta');

    t.test('las vistas salen con su nombre y sus dos colores', () => {
        const p = armar();
        const vistas = p.llamar('grabar-vistas');
        t.eq(vistas.length, 5);
        for (const v of vistas) {
            t.ok(v.nombre, 'tiene nombre');
            t.ok(v.colorDeMarcador, 'y el color que va al XML');
            t.ok(v.colorEnLaApp, 'y el de la pantalla, que es otra pregunta');
        }
    });

    t.test('sin sesión, el estado es null y no explota', () => {
        const p = armar();
        t.eq(p.llamar('grabar-estado'), null);
    });

    t.test('listar una carpeta que no existe devuelve una lista vacía', () => {
        const p = armar();
        t.deep(p.llamar('grabar-listar', ['/no/existe']), []);
    });

    t.test('iniciar sin carpeta contesta el motivo en vez de tirar', () => {
        const p = armar();
        const r = p.llamar('grabar-iniciar', {});
        t.eq(r.ok, false);
        t.ok(r.error.includes('carpeta'), r.error);
        t.ok(p.diario.some(l => l.evento === 'grabar.no-arranca'), 'y queda en el diario');
    });

    t.test('renombrar algo que no es una sesión contesta `ok:false`', () => {
        // Los que se pueden negar contestan `{ok, error}` y no el estado pelado:
        // el motivo lo conoce el motor y hay que poder mostrarlo tal cual.
        const p = armar();
        const r = p.llamar('grabar-renombrar', '/tmp/cualquiera.txt', { curso: 'x' });
        t.eq(r.ok, false);
        t.ok(r.error);
    });

    t.test('borrar algo que no es una sesión, lo mismo', () => {
        const p = armar();
        const r = p.llamar('grabar-borrar', '/tmp/cualquiera.txt');
        t.eq(r.ok, false);
    });

    t.test('reanudar algo que no es una sesión, lo mismo', () => {
        const p = armar();
        const r = p.llamar('grabar-reanudar', '/tmp/cualquiera.txt', {});
        t.eq(r.ok, false);
    });

    t.group('puente · el cierre de la app');

    t.test('se engancha a before-quit para no perder la clase', () => {
        const p = armar();
        t.eq(p.alCerrar.length, 1);
        p.alCerrar[0]();  // sin sesión no hace nada, y no puede tirar
    });
};
