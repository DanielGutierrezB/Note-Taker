'use strict';
/**
 * El final de una toma: que lo último que se dijo entre en ella.
 *
 * Reportado el 13/10, grabando: «si cierro una toma manualmente después de que
 * dijo algo, me hace el transcript como si lo parara cuando dije pero no
 * transcribe lo que dijo en ese último momento».
 *
 * La causa, reproducida sobre el audio de esa clase releyendo la MISMA toma de
 * las dos maneras:
 *
 *   cortado en el OUT   …PROMP Research «¡Suscríbete al canal!»  (y nada detrás)
 *   con su orilla       …PROMP Research.  │ buenísimo Alejo Alejo mientras…
 *
 * Al cerrar con el botón, el WAV termina justo en el OUT, así que Whisper
 * recibía un audio cortado a mitad de frase y en ese borde escribía las frases
 * que tiene aprendidas de los subtítulos. Y no quedaba en texto de más: el OUT
 * provisional se acercaba A esa palabra inventada, así que lo dicho de verdad
 * quedaba FUERA de la toma.
 *
 * Lo que se prueba acá es la regla que lo impide —una toma no se lee hasta que
 * hay audio detrás de su OUT— y las dos cosas que no se pueden romper al
 * ponerla: que la toma se lea igual cuando el audio la alcanza, y que al
 * terminar la clase se lea con lo que haya, porque esa orilla ya no va a llegar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');
const espejo = require('../engine/espejo');

/** Un segundo de audio a 48 kHz, que es lo que escribe cada `pcm`. */
const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-final-'));

/**
 * Corre `fn` con Whisper de mentira. `falso.ventana` es lo que oye el ciclo, y
 * cada relectura contesta una palabra sola, para poder ver de un vistazo si la
 * toma se releyó o si todavía tiene el texto del ciclo.
 */
function conWhisperFalso(fn) {
    return async () => {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { ventana: [], leidas: [] };
        oirToma.tramo = async () => ({ palabras: falso.ventana });
        oirToma.leer = async (_a, toma) => {
            falso.leidas.push(toma.id);
            return {
                antes: [], despues: [], colapsadas: 0, relectura: null,
                palabras: [{ t: toma.inMs, texto: 'RELEÍDA', hasta: toma.inMs + 300 }]
            };
        };
        try { await fn(falso); } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
        }
    };
}

/** Una clase con una toma abierta por el conteo y el audio donde se diga. */
async function conUnaTomaAbierta(falso, segundos) {
    const st = grabacion.iniciar({
        dir: carpeta(), curso: 'f', fps: 30, sinReloj: true, sampleRate: 48000
    });
    for (let i = 0; i < segundos; i++) grabacion.pcm(pedazo());
    const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
    falso.ventana = [w(1000, '3,'), w(1400, '2,'), w(1800, '1.'), w(2600, 'Hola'), w(3000, 'mundo')];
    await grabacion.buscarSenales();
    return { st, w };
}

const reposo = () => new Promise(r => setTimeout(r, 40));

module.exports = function (t) {
    t.group('final de la toma · la orilla antes de leer');

    t.test('una toma recién cerrada espera a que el audio pase su OUT', conWhisperFalso(async falso => {
        const { st } = await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma();
        await reposo();

        const s = grabacion._sesion();
        t.deep(s.cola, [1], 'queda en la cola');
        t.ok(!s.rehaciendo, 'y no se está leyendo: todavía no hay orilla');
        t.deep(falso.leidas, [], 'nadie la leyó cortada en seco');
        // Mientras espera se sigue viendo lo que oyó el ciclo, como siempre.
        t.deep(s.estado.tomas[0].palabras.map(x => x.texto), ['Hola', 'mundo']);
        t.ok(espejo.grabadoHastaMs(s) < s.estado.tomas[0].outMs + oirToma.ORILLA_MS,
            'que es justo lo que `hayOrilla` mira');
    }));

    t.test('y se lee sola en cuanto el audio la alcanza', conWhisperFalso(async falso => {
        await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma();
        await reposo();
        t.deep(falso.leidas, [], 'antes no');

        // La clase sigue: el ciclo la recoge en su próxima pasada.
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        falso.ventana = [];
        await grabacion.buscarSenales();
        await reposo();

        const s = grabacion._sesion();
        t.deep(falso.leidas, [1], 'se leyó una vez');
        t.deep(s.cola, [], 'y la cola quedó vacía');
        t.deep(s.estado.tomas[0].palabras.map(x => x.texto), ['RELEÍDA']);
    }));

    t.test('la cola no se traba con una toma que espera: las demás se leen', conWhisperFalso(async falso => {
        // La 2 cerró recién y espera; a la 1, que cerró hace rato, se le mueve un
        // borde y hay que releerla. Con una cola en orden estricto, la 2 —que
        // entró antes— habría parado a la 1 hasta que su audio llegara.
        const { st, w } = await conUnaTomaAbierta(falso, 8);
        const s = grabacion._sesion();
        grabacion.cerrarToma(st.ceroMs + 3500);
        // La clase sigue y el audio pasa su OUT: ahí se lee.
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        falso.ventana = [];
        await grabacion.buscarSenales();
        await reposo();
        t.deep(falso.leidas, [1], 'la 1 ya se leyó, con su orilla');

        for (let i = 0; i < 4; i++) grabacion.pcm(pedazo());
        falso.ventana = [w(23000, '3,'), w(23400, '2,'), w(23800, '1.'), w(24200, 'otra')];
        await grabacion.buscarSenales();
        t.eq(s.estado.tomas.length, 2, 'hay dos tomas');
        grabacion.cerrarToma();
        await reposo();
        t.deep(s.cola, [2], 'la 2 espera su orilla');

        grabacion.editar({ tipo: 'borde', toma: 1, borde: 'out', paredMs: st.ceroMs + 3600 });
        await reposo();
        t.deep(falso.leidas, [1, 1], 'la 1 se releyó sin esperar a la 2');
        t.deep(s.cola, [2], 'y la 2 sigue esperando');
    }));

    t.group('final de la toma · al terminar no hay orilla que esperar');

    t.test('terminar lee lo que quedó esperando, con lo que haya', conWhisperFalso(async falso => {
        await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma();
        await reposo();
        t.deep(falso.leidas, [], 'esperando');

        const final = await grabacion.terminar();
        t.deep(falso.leidas, [1], 'al terminar se lee igual: esa orilla no va a llegar nunca');
        t.deep(final.tomas[0].palabras.map(x => x.texto), ['RELEÍDA']);
    }));

    t.test('y la toma que quedó abierta al terminar también', conWhisperFalso(async falso => {
        await conUnaTomaAbierta(falso, 8);
        const final = await grabacion.terminar();
        t.deep(falso.leidas, [1]);
        t.ok(final.tomas[0].outMs != null, 'cerrada');
    }));

    t.group('final de la toma · los huecos con voz');

    /**
     * `oir.escuchar` de mentira: la lectura grande devuelve un hueco, y la del
     * hueco devuelve lo que se había perdido ahí.
     */
    function conOirFalso(fn) {
        const antes = oir.escuchar;
        const pedidos = [];
        return (async () => {
            try { await fn(pedidos, p => { oir.escuchar = p; }); } finally { oir.escuchar = antes; }
        })();
    }

    t.test('un hueco con voz se vuelve a leer y lo que sale entra en su sitio', async () => {
        // El caso de la toma 10: leyendo la toma entera, Whisper puso unas
        // palabras en mitad de un silencio y el filtro de nivel las tiró con
        // razón. Releído solo ese tramo, vuelven con la hora en su sitio.
        const T = Date.parse('2026-10-13T16:00:00');
        const toma = { id: 1, inMs: T, outMs: T + 60000 };
        await conOirFalso(async (pedidos, poner) => {
            poner(async p => {
                pedidos.push([p.desdeMs - T, p.hastaMs - T]);
                if (pedidos.length === 1) {
                    return {
                        palabras: [
                            { t: T + 1000, texto: 'ahí', hasta: T + 1200 },
                            { t: T + 1300, texto: 'voy.', hasta: T + 1400 },
                            { t: T + 9000, texto: 'de', hasta: T + 9200 }
                        ],
                        colapsadas: 0, mudas: 4, quitadas: [], inventadas: [],
                        huecos: [{ desdeMs: T + 1400, hastaMs: T + 9000, vozMs: 900 }]
                    };
                }
                return {
                    palabras: [
                        { t: T + 1300, texto: 'voy', hasta: T + 1400 },
                        { t: T + 8400, texto: 'a', hasta: T + 8500 },
                        { t: T + 8600, texto: 'raíz', hasta: T + 8900 },
                        { t: T + 9000, texto: 'de', hasta: T + 9200 }
                    ],
                    colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: []
                };
            });

            const r = await oirToma.leer([{ archivo: __filename, desdeMs: T, segundos: 600 }], toma,
                { idioma: 'es' });
            t.eq(pedidos.length, 2, 'una lectura grande y una del hueco');
            t.deep(r.palabras.map(x => x.texto), ['ahí', 'voy.', 'a', 'raíz', 'de'],
                'lo rescatado entra en orden, y nada se repite');
        });
    });

    t.test('sin huecos no hay pasada de más', async () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const toma = { id: 1, inMs: T, outMs: T + 60000 };
        await conOirFalso(async (pedidos, poner) => {
            poner(async p => {
                pedidos.push(p);
                return {
                    palabras: [{ t: T + 1000, texto: 'hola', hasta: T + 1200 }],
                    colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: []
                };
            });
            await oirToma.leer([{ archivo: __filename, desdeMs: T, segundos: 600 }], toma, { idioma: 'es' });
            t.eq(pedidos.length, 1, 'Whisper no se llama por gusto');
        });
    });

    t.test('y un hueco que no se puede releer deja la toma como estaba', async () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const toma = { id: 1, inMs: T, outMs: T + 60000 };
        await conOirFalso(async (pedidos, poner) => {
            poner(async p => {
                pedidos.push(p);
                if (pedidos.length > 1) throw new Error('se murió whisper-cli');
                return {
                    palabras: [
                        { t: T + 1000, texto: 'hola', hasta: T + 1200 },
                        { t: T + 9000, texto: 'de', hasta: T + 9200 }
                    ],
                    colapsadas: 0, mudas: 0, quitadas: [], inventadas: [],
                    huecos: [{ desdeMs: T + 1200, hastaMs: T + 9000, vozMs: 900 }]
                };
            });
            const r = await oirToma.leer([{ archivo: __filename, desdeMs: T, segundos: 600 }], toma,
                { idioma: 'es' });
            t.deep(r.palabras.map(x => x.texto), ['hola', 'de'], 'no se pierde lo que sí salió');
        });
    });

    t.group('final de la toma · el OUT provisional');

    t.test('sin audio detrás, el OUT se queda donde llegó el audio', conWhisperFalso(async falso => {
        // Es el caso de «Terminar»: la última palabra de esa lectura es la que
        // Whisper se inventó en el corte seco, y cerrar la toma AHÍ es lo que
        // dejaba fuera lo último dicho. Sobra silencio, pero no falta nada.
        const { st } = await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma();
        const s = grabacion._sesion();
        const puesto = s.estado.tomas[0].outMs;
        t.ok(s.estado.tomas[0].outProvisional, 'el botón lo deja provisional');

        const final = await grabacion.terminar();
        t.eq(final.tomas[0].outMs, puesto, 'no se acerca a la palabra inventada');
    }));

    t.test('con audio detrás sí se acerca a la última palabra', conWhisperFalso(async falso => {
        const { st } = await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma();
        const s = grabacion._sesion();
        const puesto = s.estado.tomas[0].outMs;
        // La relectura devuelve una palabra que termina mucho antes del OUT.
        oirToma.leer = async (_a, toma) => ({
            antes: [], despues: [], colapsadas: 0, relectura: null,
            palabras: [{ t: toma.inMs, texto: 'RELEÍDA', hasta: toma.inMs + 300 }]
        });
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        falso.ventana = [];
        await grabacion.buscarSenales();
        await reposo();
        t.ok(s.estado.tomas[0].outMs < puesto, 'el OUT se acercó al final de lo dicho');
        t.ok(!s.estado.tomas[0].outProvisional, 'y deja de ser provisional');
    }));
};
