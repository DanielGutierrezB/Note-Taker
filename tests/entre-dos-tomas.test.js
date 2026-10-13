'use strict';
/**
 * Lo que se dijo entre dos tomas, y desde dónde se puede tomar.
 *
 * Reportado el 13/10, grabando: «En este momento no me muestra transcript
 * antes del In en la toma 12, y en la 11 dice que corta al inicio de la 12.
 * Pero si hay transcript entre ambas, debería poder modificar en cualquiera de
 * los 2 lados.»
 *
 * Entre el OUT de la 11 y el IN de la 12 había medio minuto hablado. En el
 * sidecar de esa clase ese tramo no está en ninguna parte, y por dos motivos
 * distintos que se tapaban entre sí:
 *
 *   · **las sueltas no se guardan.** Viven en la memoria de la sesión, así que
 *     cerrada la clase el tramo entre dos tomas no existe para nadie;
 *   · **y el conteo las vaciaba.** Abrir con «3, 2, 1» tiraba todo lo dicho
 *     antes, así que ni en vivo se veía.
 *
 * Lo que se prueba acá es que el tramo llega a la pantalla mientras la clase
 * corre, y que queda ESCRITO en las dos tomas para cuando no corra.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');
const espejo = require('../engine/espejo');
const vivo = require('../engine/notas-vivo');

const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-entre-'));

/** Whisper de mentira: la relectura devuelve lo que la toma ya tenía. */
function conWhisperFalso(fn) {
    return async () => {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { ventana: [], pedidos: [] };
        oirToma.tramo = async () => ({ palabras: falso.ventana });
        oirToma.leer = async (_a, toma, o) => {
            falso.pedidos.push({ toma: toma.id, tomas: (o || {}).tomas ? (o.tomas || []).length : 0 });
            return {
                antes: toma.antes || [], palabras: toma.palabras || [],
                despues: toma.despues || [], colapsadas: 0, relectura: null
            };
        };
        try { await fn(falso); } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
        }
    };
}

module.exports = function (t) {
    t.group('entre dos tomas · lo que llega a la pantalla');

    t.test('lo hablado entre dos tomas cruza el puente y se ve de los dos lados',
        conWhisperFalso(async falso => {
            // La secuencia del diario: la 11 se cierra con el botón, se habla
            // medio minuto sin ninguna toma, y la 12 se abre con el botón y
            // después se le corre el IN hacia adelante.
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });

            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(1, '3,'), w(1.4, '2,'), w(1.8, '1.'), w(3, 'empieza'), w(7, 'la')];
            await grabacion.buscarSenales();
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(12, 'datos'), w(18, 'uno')];
            await grabacion.buscarSenales();
            grabacion.cerrarToma();

            // Medio minuto hablando sin ninguna toma abierta.
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(22, 'entonces'), w(30, 'esa'), w(38, 'sería'),
                w(46, 'la'), w(54, 'parte')];
            await grabacion.buscarSenales();

            grabacion.abrirToma();
            const t12 = s.estado.tomas.find(x => x.outMs == null);
            grabacion.editar({ tipo: 'borde', toma: t12.id, borde: 'in', paredMs: st.ceroMs + 54000 });

            const res = espejo.resumen(s);
            const entre = (res.sueltas || []).map(x => x.texto);
            t.ok(entre.includes('entonces') && entre.includes('sería'),
                `lo de en medio llega: ${entre.join(' ')}`);
            // Y desde los dos lados: el gris de la cerrada y el de la abierta
            // salen de las mismas sueltas (`despuesDeLaCerrada` y
            // `antesDeLaAbierta` en la pantalla).
            const cerrada = res.tomas.find(x => x.outMs != null);
            t.ok((res.sueltas || []).every(x => x.t >= cerrada.outMs),
                'todas caen después del OUT de la cerrada, que es lo que la pantalla filtra');
            t.ok((res.sueltas || []).some(x => x.t < t12.inMs), 'y antes del IN de la abierta');
        }));

    t.test('abrir con el conteo ya no borra lo que se dijo antes',
        conWhisperFalso(async falso => {
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });

            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(2, 'charla'), w(6, 'suelta'), w(10, 'de'), w(14, 'pasillo')];
            await grabacion.buscarSenales();
            t.eq((s.estado.sueltas || []).length, 4, 'se oyó sin ninguna toma abierta');

            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(22, '3,'), w(22.4, '2,'), w(22.8, '1.'), w(24, 'Hola')];
            await grabacion.buscarSenales();
            const res = espejo.resumen(s);
            t.deep((res.sueltas || []).map(x => x.texto), ['charla', 'suelta', 'de', 'pasillo'],
                'y sigue a mano para meterlo en una toma o para leerlo');
        }));

    t.group('entre dos tomas · lo que queda escrito');

    t.test('la orilla de una toma llega hasta su vecina, no doce segundos', () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const tomas = [
            { id: 1, inMs: T, outMs: T + 20000 },
            { id: 2, inMs: T + 55000, outMs: T + 80000 }
        ];
        // 35 s entre una y otra: la orilla los cubre enteros por los dos lados.
        t.eq(vivo.techoDelOut(tomas, tomas[0]) - tomas[0].outMs, 35000);
        t.eq(tomas[1].inMs - vivo.pisoDelIn(tomas, tomas[1]), 35000);
    });

    t.test('y no más allá, que sería escribir la misma frase en las dos tomas', () => {
        // Con la vecina a dos segundos, la orilla se achica: lo de más allá de
        // su borde ya es texto suyo.
        const T = Date.parse('2026-10-13T16:00:00');
        const tomas = [
            { id: 1, inMs: T, outMs: T + 20000 },
            { id: 2, inMs: T + 22000, outMs: T + 40000 }
        ];
        t.eq(vivo.techoDelOut(tomas, tomas[0]) - tomas[0].outMs, 2000);
    });

    t.test('y eso es lo que se le pide a Whisper, no doce segundos', async () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const antes = oir.escuchar;
        const pedidos = [];
        oir.escuchar = async p => {
            pedidos.push({ desde: (p.desdeMs - T) / 1000, hasta: (p.hastaMs - T) / 1000 });
            return { palabras: [], colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: [] };
        };
        try {
            const archivos = [{ archivo: __filename, desdeMs: T, segundos: 600 }];
            const tomas = [
                { id: 1, inMs: T + 100000, outMs: T + 120000 },
                { id: 2, inMs: T + 155000, outMs: T + 180000 },
                { id: 3, inMs: T + 220000, outMs: T + 240000 }
            ];
            await oirToma.leer(archivos, tomas[1], { idioma: 'es', tomas });
            t.eq(pedidos[0].desde, 120, 'por la izquierda llega al OUT de la 1');
            t.eq(pedidos[0].hasta, 220, 'y por la derecha al IN de la 3');

            // Sin vecinas, la orilla de siempre.
            pedidos.length = 0;
            await oirToma.leer(archivos, { id: 9, inMs: T + 300000, outMs: T + 320000 }, { idioma: 'es' });
            t.eq(pedidos[0].desde, 300 - oirToma.ORILLA_MS / 1000);
            t.eq(pedidos[0].hasta, 320 + oirToma.ORILLA_MS / 1000);
        } finally { oir.escuchar = antes; }
    });

    t.test('con una vecina muy lejos la orilla se planta en el tope', async () => {
        // Cada segundo de orilla es audio que Whisper transcribe dos veces, una
        // por cada lado. Minuto y medio es el trato.
        const T = Date.parse('2026-10-13T16:00:00');
        const antes = oir.escuchar;
        const pedidos = [];
        oir.escuchar = async p => {
            pedidos.push({ desde: (p.desdeMs - T) / 1000, hasta: (p.hastaMs - T) / 1000 });
            return { palabras: [], colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: [] };
        };
        try {
            const tomas = [
                { id: 1, inMs: T + 10000, outMs: T + 20000 },
                { id: 2, inMs: T + 500000, outMs: T + 520000 }
            ];
            await oirToma.leer([{ archivo: __filename, desdeMs: T, segundos: 2000 }], tomas[1],
                { idioma: 'es', tomas });
            t.eq(pedidos[0].desde, 500 - oirToma.ORILLA_MAX_MS / 1000, 'no se trae media clase');
        } finally { oir.escuchar = antes; }
    });

    t.test('la relectura recibe las tomas, que es de donde sale la orilla',
        conWhisperFalso(async falso => {
            // El cableado, que es lo que puede volverse atrás en silencio: sin
            // las tomas, `oir-toma` se queda con los doce segundos de siempre y
            // el tramo entre dos tomas vuelve a no guardarse en ninguna parte.
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });
            for (let i = 0; i < 8; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(1, '3,'), w(1.4, '2,'), w(1.8, '1.'), w(3, 'Hola')];
            await grabacion.buscarSenales();
            grabacion.cerrarToma();
            for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
            falso.ventana = [];
            await grabacion.buscarSenales();
            await new Promise(r => setTimeout(r, 40));
            t.ok(falso.pedidos.length > 0, 'se releyó');
            t.ok(falso.pedidos.every(p => p.tomas > 0), 'y con las tomas en la mano');
        }));
};
