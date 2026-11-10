'use strict';
/**
 * Editar y deshacer sin perder tomas.
 *
 * Los casos los reprodujo la revisión, y cada uno fallaba antes del arreglo:
 *
 *   · un ⌘Z de un «abrir» viejo sacaba una toma terminada y rehacer no la
 *     devolvía como estaba;
 *   · deshacer una división, con la segunda mitad ya cerrada por «Pausa»,
 *     reabría la toma junta;
 *   · un paso que no se podía deshacer trababa la pila entera;
 *   · en una clase grabada, «Mantener» sobre una desactivada dejaba dos bloques
 *     encimados en el XML;
 *   · el IN provisional de un conteo se lo llevaba el «1» del propio conteo;
 *   · un conteo que llegaba tarde abría una toma fantasma;
 *   · «Regenerar» no impedía tocar la misma clase;
 *   · qué tomas ya se releyeron vivía solo en memoria.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const workspace = require('../engine/workspace');
const oirToma = require('../engine/oir-toma');
const relecturas = require('../engine/relecturas');
const conClaseMuda = require('./fixtures/clase-muda');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const T0 = Date.parse('2026-11-04T10:00:00');

/** Una clase grabada en el disco con estas tomas, para editarla después. */
function grabada(tomas, o) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-grabada-'));
    const secuencia = 'curso_2026-11-04_10-00-00';
    const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
    estado.sesiones = [{ archivo: path.join(dir, 'x.wav'), desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
    estado.tomas = tomas;
    if (!(o && o.abierta)) estado.terminada = T0 + 600000;
    const archivos = workspace.archivosDeSesion(dir, secuencia);
    workspace.ensureDir(path.dirname(archivos.json));
    fs.writeFileSync(estado.sesiones[0].archivo, Buffer.alloc(44));
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return archivos;
}

const toma = (id, inSec, outSec, o) => ({
    id, vista: 'PV', comentario: '', inMs: T0 + inSec * 1000, outMs: T0 + outSec * 1000,
    descartada: false, palabras: [{ t: T0 + inSec * 1000, texto: `t${id}` }], comentarios: [], ...(o || {})
});

module.exports = function (t) {
    t.group('deshacer · un «abrir» viejo');

    t.test('deshacerlo saca la toma, y rehacerlo la devuelve como estaba, cerrada', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'), w(4000, 'Pausa.'));
            await oir();
            const out = s.estado.tomas[0].outMs;
            t.ok(out != null, 'la «Pausa» la cerró');

            t.ok(grabacion.deshacer().ok, 'se deshace el «abrir»');
            t.eq(s.estado.tomas.length, 0);
            const r = grabacion.rehacer();
            t.ok(r.ok, r.error);
            t.eq(s.estado.tomas.length, 1, 'vuelve');
            t.eq(s.estado.tomas[0].outMs, out, 'con su OUT, y no abierta como nació');
        });
    });

    t.group('deshacer · una división con la segunda mitad cerrada');

    t.test('vuelve una toma cerrada donde la cerró la «Pausa»', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'));
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 2500 });
            await oir(w(6000, 'Pausa.'));
            await oir();
            const fin = s.estado.tomas[1].outMs;
            t.ok(fin != null, 'la segunda mitad la cerró la señal');
            const r = grabacion.deshacer();
            t.ok(r.ok, r.error);
            t.eq(s.estado.tomas.length, 1);
            t.eq(s.estado.tomas[0].outMs, fin, 'cerrada: antes volvía abierta y se tragaba lo de después');
        });
    });

    t.group('deshacer · un paso que no se puede dar no traba la pila');

    t.test('se saca, se dice, y el ⌘Z siguiente llega a lo de antes', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'));
            grabacion.editar({ tipo: 'vista', toma: 1, vista: 'S' });
            grabacion.cerrarToma();
            // El conteo abre la 2 detrás: reabrir la 1 ya no cabe.
            await oir(w(8000, '3,'), w(8400, '2,'), w(8800, '1.'), w(9200, 'tres'), w(9600, 'cuatro'));
            t.eq(s.estado.tomas.length, 2);

            const primero = grabacion.deshacer();
            t.eq(primero.ok, false, 'deshacer el cierre no se puede');
            t.ok(/Lo saqué del historial/.test(primero.error), primero.error);
            const segundo = grabacion.deshacer();
            t.ok(segundo.ok, `y el siguiente sí: ${segundo.error || segundo.que}`);
            t.eq(s.estado.tomas[0].vista, 'PV', 'era el cambio de vista');
        });
    });

    t.group('editar una clase grabada');

    t.test('«Mantener» no activa una toma que quedó debajo de otra', () => {
        const { json, xml } = grabada([toma(1, 10, 40, { descartada: true }), toma(2, 15, 50)]);
        let error = null;
        try { grabacion.editarGrabada(json, { tipo: 'descartar', toma: 1, descartada: false }); } catch (e) { error = e.message; }
        t.ok(error && /la toma 2 quedó sobre su tramo/.test(error), error);
        t.ok(!/Toma 1/.test(fs.readFileSync(xml, 'utf8')), 'y el XML no tiene la 1 encimada');
    });

    t.test('una vista que no existe y un borde que no es IN ni OUT no cambian nada', () => {
        const { json } = grabada([toma(1, 10, 40)]);
        grabacion.editarGrabada(json, { tipo: 'vista', toma: 1, vista: 'NO-EXISTE' });
        grabacion.editarGrabada(json, { tipo: 'borde', toma: 1, borde: 'medio', paredMs: T0 + 20000 });
        const t1 = sesionesGrabadas.paraMirar(json, null).tomas[0];
        t.eq(t1.vista, 'PV');
        t.eq(t1.outMs, T0 + 40000);
    });

    t.group('el conteo y su IN');

    t.test('el «1» del propio conteo no se lleva el IN: va a la primera palabra de la clase', () => {
        // Un «1» con el final estirado hasta el borde de la ventana se acepta
        // por su comienzo; en la pasada siguiente vuelve con su final de verdad.
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        const cuenta = [{ t: T0 + 1000, texto: '3,', hasta: T0 + 1300 }, { t: T0 + 1500, texto: '2,', hasta: T0 + 1800 }];
        vivo.aplicarSenales(e, cuenta.concat([{ t: T0 + 2000, texto: '1.', hasta: T0 + 6000 }]),
            { firmeHastaMs: T0 + 4000, finMs: T0 + 6000 });
        t.eq(e.tomas.length, 1, 'el conteo abrió');
        vivo.aplicarSenales(e, cuenta.concat([
            { t: T0 + 2000, texto: '1.', hasta: T0 + 2300 },
            { t: T0 + 3800, texto: 'Hola', hasta: T0 + 4100 },
            { t: T0 + 4300, texto: 'clase', hasta: T0 + 4600 }
        ]), { firmeHastaMs: T0 + 7000, finMs: T0 + 8000 });
        t.eq(e.tomas[0].inMs, T0 + 3800, 'el IN cae en «Hola»');
        t.ok(e.tomas[0].palabras.some(w => w.texto === 'Hola'), 'y «Hola» es de la toma');
        t.ok(!e.sueltas.some(w => w.texto === '1.'), 'y el «1.» no queda suelto en el gris');
    });

    t.test('un conteo dicho dentro de una toma ya cerrada no abre una fantasma', () => {
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        e.tomas.push({ id: 1, vista: 'PV', inMs: T0 + 2000, outMs: T0 + 30000, palabras: [], comentarios: [] });
        e.proximaToma = 1;
        vivo.aplicarSenales(e, [
            { t: T0 + 10000, texto: '3,', hasta: T0 + 10300 },
            { t: T0 + 10400, texto: '2,', hasta: T0 + 10700 },
            { t: T0 + 10800, texto: '1.', hasta: T0 + 11100 },
            { t: T0 + 11500, texto: 'sigue', hasta: T0 + 11800 }
        ], { firmeHastaMs: T0 + 40000, finMs: T0 + 40000 });
        t.eq(e.tomas.length, 1, 'llegó tarde, y se dijo adentro de la 1: no es una toma nueva');
    });

    t.test('pero si el OUT lo puso el botón, el conteo dice dónde terminó de verdad', () => {
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        e.tomas.push({ id: 1, vista: 'PV', inMs: T0 + 2000, outMs: T0 + 30000, outProvisional: true, palabras: [], comentarios: [] });
        e.proximaToma = 1;
        vivo.aplicarSenales(e, [
            { t: T0 + 20000, texto: '3,', hasta: T0 + 20300 },
            { t: T0 + 20400, texto: '2,', hasta: T0 + 20700 },
            { t: T0 + 20800, texto: '1.', hasta: T0 + 21100 },
            { t: T0 + 21500, texto: 'nueva', hasta: T0 + 21800 }
        ], { firmeHastaMs: T0 + 40000, finMs: T0 + 40000 });
        t.eq(e.tomas[0].outMs, T0 + 20000, 'la 1 termina donde empezó el conteo');
        t.eq(e.tomas.length, 2, 'y la 2 abre');
        t.eq(e.tomas[1].inMs, T0 + 21500, 'en la primera palabra después del conteo');
    });

    t.group('los avisos del motor se ven');

    t.test('la pantalla en vivo muestra el «aviso» que manda el motor al sacar un paso', () => {
        t.ok(/if \(aviso\.tipo === 'aviso'\) avisar\(aviso\.mensaje\);/.test(leer('src', 'js', 'pantalla-vivo.js')));
    });

    t.group('regenerar · nadie toca la clase mientras tanto');

    t.test('editar, rehacer el XML, renombrar, borrar y reanudar contestan que está ocupada', async () => {
        const { json } = grabada([toma(1, 10, 40)]);
        let suelta;
        const espera = new Promise(r => { suelta = r; });
        const leerReal = oirToma.leer;
        oirToma.leer = async () => { await espera; return null; };
        try {
            const regenerando = grabacion.regenerar(json, () => {});
            await new Promise(r => setTimeout(r, 20));
            const intentar = fn => { try { fn(); return null; } catch (e) { return e.message; } };
            for (const [que, fn] of [
                ['editar', () => grabacion.editarGrabada(json, { tipo: 'nota', toma: 1, texto: 'x' })],
                ['rehacer el XML', () => grabacion.rehacerXml(json)],
                ['renombrar', () => grabacion.renombrarGrabada(json, { numero: 3 })],
                ['borrar', () => grabacion.borrarGrabada(json)],
                ['reanudar', () => sesionesGrabadas.paraReanudar(json, null)]
            ]) {
                const error = intentar(fn);
                t.ok(error && /regenerando/.test(error), `${que}: ${error}`);
            }
            suelta();
            await regenerando;
        } finally {
            oirToma.leer = leerReal;
        }
        t.ok(fs.existsSync(json), 'y la clase sigue en su sitio');
    });

    t.test('la fila de la lista se apaga mientras tanto', () => {
        const js = leer('src', 'js', 'pantalla-sesiones.js');
        t.ok(/const ocupada = regenerandoAhora\.has\(s\.archivos\.json\);/.test(js));
        t.ok(/data-hace="borrar" \$\{apagado\}/.test(js), 'borrar incluido');
    });

    t.group('relecturas · lo releído queda en el archivo de notas');

    t.test('la marca viaja al archivo y vuelve al leerlo', () => {
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        e.tomas = [toma(1, 1, 5, { releida: { inMs: T0 + 1000, outMs: T0 + 5000, orillaMs: 12000 } })];
        const vuelta = notasXml.estadoLeido(JSON.parse(JSON.stringify(notasXml.sidecar(e))));
        t.deep(vuelta.tomas[0].releida, { inMs: T0 + 1000, outMs: T0 + 5000, orillaMs: 12000 });
    });

    t.test('al reanudar, las cerradas sin releer vuelven a la cola', () => {
        const { json } = grabada([
            toma(1, 10, 20, { releida: { inMs: T0 + 10000, outMs: T0 + 20000, orillaMs: 0 } }),
            toma(2, 30, 40)
        ], { abierta: true });
        const encolarReal = relecturas.encolar;
        const encoladas = [];
        relecturas.encolar = (_s, id) => encoladas.push(id);
        try {
            grabacion.reanudar(json, { sinReloj: true, sampleRate: 48000 });
            t.deep(encoladas, [2], 'la 2 se relee; la 1 ya estaba releída');
        } finally {
            relecturas.encolar = encolarReal;
            grabacion.apagar();
        }
    });

    t.test('un archivo de antes de la marca no manda a releer todas grabando', () => {
        const { json } = grabada([toma(1, 10, 20), toma(2, 30, 40)], { abierta: true });
        const sidecar = JSON.parse(fs.readFileSync(json, 'utf8'));
        for (const t1 of sidecar.tomas) delete t1.releida;
        fs.writeFileSync(json, JSON.stringify(sidecar));
        const encolarReal = relecturas.encolar;
        const encoladas = [];
        relecturas.encolar = (_s, id) => encoladas.push(id);
        try {
            grabacion.reanudar(json, { sinReloj: true, sampleRate: 48000 });
            t.deep(encoladas, []);
        } finally {
            relecturas.encolar = encolarReal;
            grabacion.apagar();
        }
    });
};
