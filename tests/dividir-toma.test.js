'use strict';
/**
 * Partir una toma en dos, sin que se pierda ni se repita nada.
 *
 * Lo pidió el editor el 13/10: «acá deberíamos agregar una función de "Dividir
 * toma". Esto para poder separar una toma en 2 y cambiar de vista, sin
 * necesidad de que haya un corte de contenido. Esta opción también se debe
 * poder hacer en las tomas anteriores o editando las notas tomadas. Si pongo
 * esta opción en una toma abierta, debe es dejar todo lo anterior a ese punto
 * como una toma ya cerrada y seguir abierta desde donde estoy.»
 *
 * Lo que importa de este gesto es que las dos mitades se TOCAN —el OUT de una
 * es el IN de la otra— así que entre ellas no queda nada afuera ni nada
 * repetido. Y que renumerar, que fue la decisión del editor preguntado de
 * frente, no rompa lo que guarda números por su cuenta: el historial de
 * deshacer, la cola de relecturas y las fotos del OUT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const vivo = require('../engine/notas-vivo');
const historial = require('../engine/deshacer');
const referencias = require('../engine/referencias');
const ajustar = require('../engine/ajustar-corte');
const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const T0 = Date.parse('2026-10-13T16:00:00');
const seg = n => T0 + n * 1000;

/** Una toma cerrada con su texto, sus orillas y sus notas sobre el texto. */
function unaToma(o) {
    const p = (desde, hasta, textos) => textos.map((texto, i) => ({
        t: seg(desde + i * ((hasta - desde) / textos.length)),
        texto,
        hasta: seg(desde + i * ((hasta - desde) / textos.length)) + 200
    }));
    return {
        id: 4,
        vista: 'PV',
        comentario: 'la nota de la toma',
        cuenta: '3, 2, 1',
        inMs: seg(10),
        outMs: o && o.abierta ? null : seg(30),
        descartada: false,
        cerradaSola: false,
        antes: p(6, 10, ['antes', 'de', 'la', 'toma']),
        palabras: p(10, 30, ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho']),
        despues: o && o.abierta ? [] : p(30, 34, ['y', 'después']),
        comentarios: [
            { desdeMs: seg(12), hastaMs: seg(13), texto: 'dos', comentario: 'de la primera' },
            { desdeMs: seg(25), hastaMs: seg(26), texto: 'siete', comentario: 'de la segunda' }
        ]
    };
}

const estadoCon = (...tomas) => ({
    ...vivo.estadoNuevo({ ceroMs: T0 }),
    tomas,
    proximaToma: Math.max(...tomas.map(t => t.id))
});

const textos = a => (a || []).map(w => w.texto);

module.exports = function (t) {
    t.group('dividir · el reparto');

    t.test('las dos mitades se tocan: ni una palabra se pierde ni se repite', () => {
        const toma = unaToma();
        const e = estadoCon(toma);
        const todas = textos(toma.antes).concat(textos(toma.palabras), textos(toma.despues));

        const r = vivo.dividir(e, toma, seg(20));
        t.ok(r, 'se partió');
        t.eq(r.primera.outMs, seg(20));
        t.eq(r.segunda.inMs, seg(20), 'el OUT de una es el IN de la otra');

        // Todo lo que había sigue estando, una sola vez y en el mismo orden.
        const ahora = textos(r.primera.antes).concat(textos(r.primera.palabras));
        const luego = textos(r.segunda.palabras).concat(textos(r.segunda.despues));
        t.deep(ahora.concat(luego), todas, 'ni se pierde ni se repite');
        t.deep(textos(r.primera.palabras), ['uno', 'dos', 'tres', 'cuatro'], 'lo de antes del corte');
        t.deep(textos(r.segunda.palabras), ['cinco', 'seis', 'siete', 'ocho'], 'y lo de después');
    });

    t.test('cada mitad ve a la otra en su orilla, que es lo que deja mover el borde', () => {
        const toma = unaToma();
        const e = estadoCon(toma);
        const r = vivo.dividir(e, toma, seg(20));
        t.deep(textos(r.primera.despues), ['cinco', 'seis', 'siete', 'ocho', 'y', 'después'],
            'la primera ve lo que sigue');
        t.deep(textos(r.segunda.antes), ['antes', 'de', 'la', 'toma', 'uno', 'dos', 'tres', 'cuatro'],
            'y la segunda lo que vino antes');
    });

    t.test('la vista la heredan las dos, que es para lo que se parte', () => {
        const toma = unaToma();
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.eq(r.segunda.vista, 'PV', 'y después se le cambia a una de ellas');
        t.eq(r.primera.vista, 'PV');
    });

    t.test('la nota de la toma no se duplica: sería dos marcadores iguales en Premiere', () => {
        const toma = unaToma();
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.eq(r.primera.comentario, 'la nota de la toma', 'se queda donde se escribió');
        t.eq(r.segunda.comentario, '', 'y la mitad nueva arranca sin nota');
    });

    t.test('las notas sobre el texto van a la mitad donde cae su palabra', () => {
        const toma = unaToma();
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.deep(r.primera.comentarios.map(c => c.comentario), ['de la primera']);
        t.deep(r.segunda.comentarios.map(c => c.comentario), ['de la segunda']);
    });

    t.test('el ajuste al silencio se tira: los bordes ya no son los que se midieron', () => {
        const toma = unaToma();
        toma.ajuste = { v: 1, deInMs: toma.inMs, deOutMs: toma.outMs, inMs: toma.inMs, outMs: toma.outMs };
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.eq(r.primera.ajuste, undefined);
        t.eq(r.segunda.ajuste, undefined);
    });

    t.test('una desactivada partida sigue desactivada entera', () => {
        const toma = unaToma();
        toma.descartada = true;
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.eq(r.primera.descartada, true);
        t.eq(r.segunda.descartada, true);
    });

    t.group('dividir · la toma abierta');

    t.test('lo de antes queda cerrado y la toma sigue abierta desde ahí', () => {
        // Tal cual lo pidió: «debe es dejar todo lo anterior a ese punto como
        // una toma ya cerrada y seguir abierta desde donde estoy».
        const toma = unaToma({ abierta: true });
        const e = estadoCon(toma);
        const r = vivo.dividir(e, toma, seg(20));
        t.eq(r.primera.outMs, seg(20), 'la primera queda cerrada');
        t.eq(r.segunda.outMs, null, 'y la segunda sigue abierta');
        t.eq(vivo.tomaAbierta(e).id, r.segunda.id, 'que es la que el ciclo va a seguir llenando');
    });

    t.test('y se lleva su texto: una toma abierta no tiene orilla por la derecha', () => {
        // Lo pidió así el 13/10: «la palabra seleccionada debería quedar como el
        // inicio de la nueva toma o toma abierta». En la cerrada salía bien; en la
        // abierta la mitad nueva aparecía VACÍA, con el texto entero en `despues`.
        // `repartir` comparaba contra un OUT que no existe, y `w.t < null` es
        // falso para cualquier hora, así que nada caía adentro.
        const toma = unaToma({ abierta: true });
        const r = vivo.dividir(estadoCon(toma), toma, seg(20));
        t.deep(textos(r.segunda.palabras), ['cinco', 'seis', 'siete', 'ocho'],
            'la mitad que sigue grabando arranca en la palabra del clic');
        t.deep(textos(r.segunda.despues), [],
            'y no tiene orilla por la derecha: todavía no terminó');
        t.deep(textos(r.primera.palabras), ['uno', 'dos', 'tres', 'cuatro'],
            'lo de antes del corte queda cerrado, sin la palabra del clic');
    });

    t.test('el ciclo de señales sigue llenando la mitad nueva', () => {
        // Que el reparto esté bien no alcanza: lo que importa es que la toma que
        // queda abierta siga siendo una toma normal para lo que viene después.
        const toma = unaToma({ abierta: true });
        const e = estadoCon(toma);
        const r = vivo.dividir(e, toma, seg(20));
        const dicha = { t: seg(32), texto: 'nueve', hasta: seg(32) + 200 };
        Object.assign(r.segunda, vivo.repartir(
            (r.segunda.antes || []).concat(r.segunda.palabras, [dicha]), r.segunda));
        t.deep(textos(r.segunda.palabras), ['cinco', 'seis', 'siete', 'ocho', 'nueve'],
            'lo que se dice después del corte entra en la mitad abierta');
    });

    t.group('dividir · dónde no se puede');

    t.test('no se parte sobre un borde ni dejando media toma de una décima', () => {
        const dale = ms => vivo.dividir(estadoCon(unaToma()), unaToma(), ms);
        t.eq(dale(seg(10)), null, 'sobre el IN');
        t.eq(dale(seg(30)), null, 'sobre el OUT');
        t.eq(dale(seg(5)), null, 'antes del IN');
        t.eq(dale(seg(35)), null, 'después del OUT');
        t.eq(dale(seg(10.05)), null, 'ni dejando una primera mitad de 50 ms');
        t.eq(dale(seg(29.95)), null, 'ni una segunda');
        t.eq(dale(NaN), null);
    });

    t.group('dividir · los números corren');

    t.test('la mitad nueva lleva el número siguiente y las de después corren uno', () => {
        // La decisión del editor, preguntada de frente: renumerar en vez de
        // meter una toma 9 entre la 4 y la 5.
        const toma = unaToma();
        const e = estadoCon(
            { id: 2, inMs: seg(1), outMs: seg(5), palabras: [] },
            toma,
            { id: 5, inMs: seg(40), outMs: seg(50), palabras: [] },
            { id: 6, inMs: seg(60), outMs: seg(70), palabras: [] }
        );
        const r = vivo.dividir(e, toma, seg(20));
        t.deep(e.tomas.map(x => x.id), [2, 4, 5, 6, 7], 'en orden y sin huecos');
        t.eq(r.segunda.id, 5, 'la mitad nueva es la 5');
        t.deep(r.movidas, [{ de: 6, a: 7 }, { de: 5, a: 6 }], 'de atrás hacia adelante');
        t.eq(e.proximaToma, 7, 'y el contador sube');
    });

    t.test('el historial no hace falta renumerarlo, y está dicho por qué', () => {
        // Parecía que sí: un paso guarda de qué toma es por su `id`, y las dos
        // fotos y el rótulo llevan el número adentro. Pero la pila es LIFO —un
        // paso más viejo solo se deshace después de deshacer la división, y eso
        // devuelve los números— así que no se pudo escribir una prueba que
        // fallara sin renumerarlos. El razonamiento está en `engine/deshacer.js`
        // y la consecuencia la prueba el caso de abajo, de punta a punta.
        t.eq(historial.renumerarPasos, undefined, 'así que no existe tal función');
        t.ok(/pila es LIFO/.test(leer('engine', 'deshacer.js')), 'y el porqué está escrito');
    });

    t.test('y la cola de relecturas también, o se relee la toma que no es', async () => {
        await conUnaClase(async (s, st) => {
            // Mover un borde manda la toma a la cola, y ahí espera su orilla.
            grabacion.editar({ tipo: 'borde', toma: 2, borde: 'out', paredMs: st.ceroMs + 48000 });
            t.deep(s.cola, [2], 'la 2 espera su orilla');
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            // La que esperaba pasó a ser la 3, y las dos mitades entran detrás.
            // Sin correrla, el «2» de la cola sería la mitad nueva —`encolar` lo
            // ve como ya encolado— y la toma que se tocó no se releería nunca.
            t.deep(s.cola, [3, 1, 2], JSON.stringify(s.cola));
        });
    });

    t.test('las fotos del OUT se mueven con el gesto, no solo si alguien se acuerda', async () => {
        await conUnaClase(async (s, st) => {
            // Una foto para cada toma, como las que deja la cámara de referencia.
            for (const n of [1, 2]) {
                const ruta = referencias.archivoDeToma(s.dir, s.estado.secuencia, n);
                fs.mkdirSync(path.dirname(ruta), { recursive: true });
                fs.writeFileSync(ruta, `foto de la ${n}`);
            }
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            const leer = n => fs.readFileSync(
                referencias.archivoDeToma(s.dir, s.estado.secuencia, n), 'utf8');
            t.eq(leer(3), 'foto de la 2', 'la de la 2 se fue con ella');
            t.eq(leer(2), 'foto de la 1', 'y la del OUT original es de la mitad que lo heredó');
        });
    });

    t.test('las fotos del OUT también, o cada bloque muestra la de al lado', () => {
        const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-dividir-'));
        const secuencia = '01_clase';
        for (const n of [4, 5, 6]) {
            const ruta = referencias.archivoDeToma(carpeta, secuencia, n);
            fs.mkdirSync(path.dirname(ruta), { recursive: true });
            fs.writeFileSync(ruta, `foto de la ${n}`);
        }
        referencias.renumerar(carpeta, secuencia, [{ de: 6, a: 7 }, { de: 5, a: 6 }]);
        const leer = n => fs.readFileSync(referencias.archivoDeToma(carpeta, secuencia, n), 'utf8');
        t.eq(leer(4), 'foto de la 4');
        t.eq(leer(6), 'foto de la 5', 'cada foto se fue con su toma');
        t.eq(leer(7), 'foto de la 6');
        t.eq(referencias.listar(carpeta, secuencia).length, 3, 'y no se perdió ninguna');
    });

    t.test('una toma sin foto no rompe el renombrado', () => {
        const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-dividir-'));
        const ruta = referencias.archivoDeToma(carpeta, '01_clase', 5);
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        fs.writeFileSync(ruta, 'x');
        t.eq(referencias.renumerar(carpeta, '01_clase', [{ de: 6, a: 7 }, { de: 5, a: 6 }]), 1);
    });

    t.group('dividir · de punta a punta, y el deshacer');

    /** Una clase de mentira con una toma cerrada y texto, lista para partir. */
    async function conUnaClase(fn) {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        oirToma.tramo = async () => ({ palabras: [] });
        oirToma.leer = async toma => ({
            antes: [], palabras: toma.palabras || [], despues: [], colapsadas: 0, relectura: null
        });
        try {
            const st = grabacion.iniciar({
                dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-div-')),
                curso: 'd', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            // Dos tomas cerradas, a mano: lo que importa acá es el gesto, no cómo
            // se abrieron.
            s.estado.tomas = [
                { id: 1, vista: 'PV', comentario: '', inMs: st.ceroMs + 10000,
                    outMs: st.ceroMs + 30000, descartada: false, comentarios: [],
                    palabras: [
                        { t: st.ceroMs + 11000, texto: 'uno', hasta: st.ceroMs + 11200 },
                        { t: st.ceroMs + 25000, texto: 'dos', hasta: st.ceroMs + 25200 }
                    ],
                    antes: [], despues: [] },
                { id: 2, vista: 'R', comentario: '', inMs: st.ceroMs + 40000,
                    outMs: st.ceroMs + 50000, descartada: false, comentarios: [],
                    palabras: [], antes: [], despues: [] }
            ];
            s.estado.proximaToma = 2;
            await fn(s, st);
        } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
        }
    }

    t.test('el gesto llega al motor y deja las dos mitades', async () => {
        await conUnaClase(async (s, st) => {
            const r = grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            t.deep(r.tomas.map(x => x.id), [1, 2, 3], 'la 2 de antes pasó a ser la 3');
            t.eq(r.tomas[0].outMs, st.ceroMs + 20000);
            t.eq(r.tomas[1].inMs, st.ceroMs + 20000, 'pegadas');
            t.eq(r.historia.queAtras, 'dividir la toma 1', 'y queda en el historial');
        });
    });

    t.test('partida la abierta, la pantalla dibuja arriba la mitad nueva', async () => {
        // El resumen saca «cuál está abierta» de la lista y no de un campo
        // aparte, así que no hay dos verdades que puedan separarse.
        await conUnaClase(async (s, st) => {
            s.estado.tomas[1].outMs = null;
            const r = grabacion.editar({ tipo: 'dividir', toma: 2, paredMs: st.ceroMs + 45000 });
            t.eq(r.abierta, 3, 'la mitad nueva es la que sigue abierta');
            t.eq(r.tomas.find(x => x.id === 2).outMs, st.ceroMs + 45000, 'y la de antes quedó cerrada');
        });
    });

    t.test('deshacer junta las dos mitades y devuelve los números', async () => {
        await conUnaClase(async (s, st) => {
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            const r = grabacion.deshacer();
            t.ok(r.ok, r.error);
            t.eq(r.que, 'dividir la toma 1');
            t.deep(r.estado.tomas.map(x => x.id), [1, 2], 'la 3 volvió a ser la 2');
            t.eq(r.estado.tomas[0].outMs, st.ceroMs + 30000, 'y la toma volvió a terminar donde terminaba');
            t.deep(r.estado.tomas[0].palabras.map(w => w.texto), ['uno', 'dos'], 'con su texto entero');
        });
    });

    t.test('y rehacer la vuelve a partir', async () => {
        await conUnaClase(async (s, st) => {
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            grabacion.deshacer();
            const r = grabacion.rehacer();
            t.ok(r.ok, r.error);
            t.deep(r.estado.tomas.map(x => x.id), [1, 2, 3]);
            t.eq(r.estado.tomas[0].outMs, st.ceroMs + 20000);
        });
    });

    t.test('deshacer un cambio anterior sigue cayendo en su toma', async () => {
        // La prueba de que renumerar no rompe el historial: se le cambia la
        // vista a la toma 2, se parte la 1 —así la 2 pasa a ser la 3— y el
        // Cmd-Z tiene que devolverle la vista a la que ahora es la 3.
        await conUnaClase(async (s, st) => {
            grabacion.editar({ tipo: 'vista', toma: 2, vista: 'S' });
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 20000 });
            const r = grabacion.deshacer();   // deshace la división
            t.ok(r.ok, r.error);
            const otra = grabacion.deshacer();  // y ahora la vista
            t.ok(otra.ok, otra.error);
            t.eq(otra.estado.tomas.find(x => x.id === 2).vista, 'R', 'la vista volvió a la suya');
        });
    });

    t.group('dividir · dónde se ofrece');

    t.test('en la pantalla de clase sí, y en el vídeo de la semana no', () => {
        const menu = leer('src', 'js', 'grabar', 'menu-de-palabra.js');
        t.ok(/puedeDividir: p\.puedeDividir === true/.test(menu), 'lo declara la pantalla');
        t.ok(/dueño\.puedeDividir && cual !== 'espera' && paraIn/.test(menu),
            'y solo sobre una toma que existe');
        t.ok(/puedeDividir: true/.test(leer('src', 'js', 'pantalla-vivo.js')), 'la clase lo pide');
        t.ok(!/puedeDividir/.test(leer('src', 'js', 'pantalla-semanal.js')),
            'y la semanal no, que no lo sabe hacer');
    });

    t.test('el gesto entra por la misma puerta que los bordes', () => {
        // Si el menú llamara al motor por su cuenta, el historial vería dos
        // cosas distintas para el mismo cambio.
        const vivoJs = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/case 'dividir': return dividir\(tomaId, ms\);/.test(vivoJs));
        t.ok(/editar\(\{ tipo: 'dividir', toma: tomaId, paredMs: ms \}\)/.test(vivoJs));
        t.ok(/await fotos\.recargar\(\)/.test(vivoJs),
            'y las fotos se releen, porque los números corrieron');
    });

    t.test('y también sobre una clase ya grabada', () => {
        // «Esta opción también se debe poder hacer en las tomas anteriores o
        // editando las notas tomadas.»
        const grabadas = leer('engine', 'sesiones-grabadas.js');
        t.ok(/c\.tipo === 'dividir'/.test(grabadas), 'entra por `editarGrabada`');
        t.ok(/vivo\.dividir\(estado, toma, Number\(c\.paredMs\)\)/.test(grabadas));
        t.ok(/referencias\.renumerar\(sitio\.base, estado\.secuencia/.test(grabadas),
            'con sus fotos');
    });

    t.group('dividir · el borde pegado no se mueve');

    t.test('el ajuste al silencio respeta los bordes que se tocan', () => {
        // Los dos bordes se ajustan por separado, así que correrlos dejaría en
        // el XML un hueco entre los dos bloques o un pedazo repetido en los dos.
        const e = {
            ceroMs: T0,
            sesiones: [],
            tomas: [
                { id: 4, inMs: seg(10), outMs: seg(20), palabras: [] },
                { id: 5, inMs: seg(20), outMs: seg(30), palabras: [] }
            ]
        };
        ajustar.ajustarSesion(e, {});
        t.eq(e.tomas[0].ajuste.porQueOut, 'pegado', 'el OUT de la primera');
        t.eq(e.tomas[1].ajuste.porQueIn, 'pegado', 'y el IN de la segunda');
        t.eq(ajustar.outAjustado(e.tomas[0]), seg(20), 'se quedan donde los dejó el editor');
        t.eq(ajustar.inAjustado(e.tomas[1]), seg(20));
        // Y los bordes de afuera siguen mirándose como siempre.
        t.eq(e.tomas[0].ajuste.porQueIn, 'sin-audio', 'sin WAV no hay nada que mirar, y se dice');
    });

    t.test('y una descartada no cuenta como vecina', () => {
        const e = {
            ceroMs: T0,
            sesiones: [],
            tomas: [
                { id: 4, inMs: seg(10), outMs: seg(20), palabras: [] },
                { id: 5, inMs: seg(20), outMs: seg(30), palabras: [], descartada: true }
            ]
        };
        ajustar.ajustarSesion(e, {});
        t.eq(e.tomas[0].ajuste.porQueOut, 'sin-audio', 'el OUT vuelve a mirarse solo');
    });
};
