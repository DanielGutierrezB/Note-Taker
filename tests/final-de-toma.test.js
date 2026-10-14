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
const vivo = require('../engine/notas-vivo');
const relecturas = require('../engine/relecturas');

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
            // Con `colgar`, la lectura arranca y no contesta: es como mirar la
            // pantalla mientras Whisper trabaja, que es cuando hay que ver el
            // texto del ciclo puesto en su sitio.
            if (falso.colgar) await new Promise(() => {});
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
        t.ok(espejo.grabadoHastaMs(s) < s.estado.tomas[0].outMs + oirToma.ORILLA_MINIMA_MS,
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

    /* ─── Dos pasadas, y la corta primero ─────────────────────────────────────
     *
     * Esperar la orilla era correcto, pero esperaba doce segundos para una cosa
     * que se arregla con uno: la misma constante medía CUÁNTO CONTEXTO guardar
     * —treinta palabras, para mover un borde mirando— y CUÁNTO AUDIO hace falta
     * detrás del OUT para que Whisper no invente el final. La medición está en
     * `ORILLA_MINIMA_MS`: con un segundo salen las mismas palabras que con doce,
     * en las cinco tomas probadas de la clase del 13/10.
     *
     * Así que la espera se parte en dos. La primera pasada sale con el mínimo y
     * deja el texto bueno enseguida, que es cuando el editor acaba de cerrar la
     * toma y la tiene delante; el contexto largo lo completa después una pasada
     * corta que NO vuelve a leer la toma —solo el tramo de detrás del OUT—, y
     * esa sí puede esperar, porque para entonces nadie la está mirando.
     */
    t.group('final de la toma · la espera corta y la orilla que llega después');

    /** Una toma cerrada a mano en `dt`, sin OUT provisional que se mueva solo. */
    async function tomaCerradaEn(falso, dt) {
        const { st, w } = await conUnaTomaAbierta(falso, 8);
        grabacion.cerrarToma(st.ceroMs + dt);
        falso.ventana = [];
        await reposo();
        return { st, w, s: grabacion._sesion() };
    }

    const correrCiclo = async (falso, chunks) => {
        for (let i = 0; i < chunks; i++) grabacion.pcm(pedazo());
        await grabacion.buscarSenales();
        await reposo();
    };

    t.test('la primera pasada se conforma con el mínimo, no con la orilla entera',
        conWhisperFalso(async falso => {
            // Cerrada a 7,5 s con 8 s grabados: medio segundo de orilla, que no
            // alcanza. La toma espera, como siempre.
            const { st, s } = await tomaCerradaEn(falso, 7500);
            t.deep(falso.leidas, [], 'con medio segundo no se lee');

            await correrCiclo(falso, 2);
            const out = st.ceroMs + 7500;
            t.deep(falso.leidas, [1], 'con dos segundos y medio sí');
            t.ok(espejo.grabadoHastaMs(s) < out + oirToma.ORILLA_MS,
                'y eso fue MUCHO antes de tener los doce segundos que se pedían');
        }));

    t.test('y la orilla larga se completa después, sin volver a leer la toma',
        conWhisperFalso(async falso => {
            const { st, w, s } = await tomaCerradaEn(falso, 7500);
            await correrCiclo(falso, 2);
            const toma = s.estado.tomas[0];
            t.deep(s.cola, [1], 'la toma vuelve a la cola: le falta contexto a la derecha');
            t.deep(toma.despues, [], 'que por ahora no tiene');

            // Lo que se dijo detrás del OUT. Al ciclo le llega igual —se va al
            // colchón— y es lo que la pasada de orilla viene a buscar.
            falso.ventana = [w(8200, 'la'), w(9000, 'orilla'), w(10000, 'larga')];
            await correrCiclo(falso, 10);

            t.deep(falso.leidas, [1], 'la toma NO se releyó: eso es cargar el modelo grande otra vez');
            t.deep(toma.palabras.map(x => x.texto), ['RELEÍDA'], 'su texto no se movió');
            t.deep(toma.despues.map(x => x.texto), ['la', 'orilla', 'larga'],
                'y ya tiene con qué mover el OUT mirando');
            t.deep(s.cola, [], 'la cola quedó vacía');
            t.eq(toma.releida.orillaMs, oirToma.ORILLA_MS,
                'y queda anotado que a esta toma ya se le pidió su contexto entero');
        }));

    t.test('y no se pide una tercera vez', conWhisperFalso(async falso => {
        const { w, s } = await tomaCerradaEn(falso, 7500);
        await correrCiclo(falso, 2);
        falso.ventana = [w(8200, 'la'), w(9000, 'orilla')];
        await correrCiclo(falso, 10);
        t.deep(s.cola, [], 'ya está completa');

        // Dos vueltas más del ciclo. Sin la marca de hasta dónde quedó leída, la
        // toma se encolaría sola en cada una hasta el final de la clase.
        await correrCiclo(falso, 3);
        await correrCiclo(falso, 3);
        t.deep(s.cola, [], 'y sigue sin pedir nada');
        t.deep(falso.leidas, [1], 'una sola lectura en toda su vida');
    }));

    t.test('el OUT provisional se acerca a la última palabra ya en la primera pasada',
        conWhisperFalso(async falso => {
            // Cerrar con el botón deja el OUT donde llegó el audio, con el
            // silencio del atraso incluido, y la relectura lo acerca a lo último
            // que se dijo. Si ese acercamiento pidiera la orilla entera no
            // pasaría NUNCA: la primera pasada sale con el mínimo y es la única
            // que hay, porque la segunda no vuelve a mirar el texto de la toma.
            const { s } = await (async () => {
                const r = await conUnaTomaAbierta(falso, 8);
                grabacion.cerrarToma();
                await reposo();
                return { ...r, s: grabacion._sesion() };
            })();
            const toma = s.estado.tomas[0];
            const puestoPorElBoton = toma.outMs;
            t.ok(toma.outProvisional, 'el botón lo dejó provisional');

            await correrCiclo(falso, 2);

            t.ok(toma.outMs < puestoPorElBoton, 'se acercó');
            // La relectura de mentira contesta una palabra que acaba a los 300 ms
            // del IN, y el cierre va 200 ms detrás de ella.
            t.eq(toma.outMs, toma.inMs + 500, 'justo detrás de la última palabra');
            t.ok(!toma.outProvisional, 'y ya no es provisional');
        }));

    t.test('una toma pegada a la siguiente no espera una orilla que nadie va a pedir',
        conWhisperFalso(async falso => {
            // Las dos mitades de una división se tocan: detrás del OUT de la
            // primera no hay ni un milímetro de audio que no sea ya de la
            // segunda, así que su lectura recorta la orilla derecha a cero.
            // Esperarla era esperar por algo que después nadie iba a pedir.
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'f', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            for (let i = 0; i < 5; i++) grabacion.pcm(pedazo());
            const toma = (id, inMs, outMs) => ({
                id, vista: 'PV', comentario: '', cuenta: '', descartada: false,
                cerradaSola: false, comentarios: [], palabras: [], antes: [], despues: [],
                inMs: st.ceroMs + inMs, outMs: outMs == null ? null : st.ceroMs + outMs
            });
            s.estado.tomas = [toma(1, 1000, 5000)];
            s.estado.proximaToma = 1;

            // Sola, la toma espera: no hay nada grabado detrás de su OUT.
            t.ok(!relecturas.hayOrilla(s, s.estado.tomas[0]), 'sola, espera');

            s.estado.tomas.push(toma(2, 5000, null));
            t.ok(relecturas.hayOrilla(s, s.estado.tomas[0]), 'con la vecina pegada, no');

            relecturas.encolar(s, 1);
            await reposo();
            t.deep(falso.leidas, [1], 'y se lee');
            t.deep(s.cola, [], 'sin quedar pidiendo una segunda pasada que no tiene sitio');
        }));

    t.test('la orilla que cuenta es la que cupo en la lectura, no la que creció mientras', async () => {
        // El OUT provisional se acerca a la última palabra de la lectura, y eso
        // solo vale si detrás del OUT había audio: si no, esa última palabra es
        // justamente la que Whisper inventó en el corte seco. La cuenta se hacía
        // al VOLVER de leer, y leer tarda, así que lo grabado ya había crecido:
        // una toma leída cortada en seco declaraba quince segundos de orilla y
        // se cerraba en la palabra inventada igual.
        const guardado = { tramo: oirToma.tramo, leer: oirToma.leer };
        oirToma.tramo = async () => ({ palabras: [] });
        oirToma.leer = async (_a, toma) => {
            // La clase sigue grabando mientras Whisper trabaja.
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            return {
                antes: [], despues: [], colapsadas: 0, relectura: null,
                palabras: [{ t: toma.inMs + 500, texto: 'inventada', hasta: toma.inMs + 800 }]
            };
        };
        try {
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'f', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            for (let i = 0; i < 8; i++) grabacion.pcm(pedazo());
            s.estado.tomas = [{
                id: 1, vista: 'PV', comentario: '', cuenta: '', descartada: false,
                cerradaSola: false, comentarios: [], palabras: [], antes: [], despues: [],
                inMs: st.ceroMs + 1000, outMs: st.ceroMs + 8000, outProvisional: true
            }];
            s.terminando = true;
            await relecturas.encolar(s, 1);
            await reposo();

            t.eq(s.estado.tomas[0].outMs, st.ceroMs + 8000,
                'el OUT se queda donde llegó el audio: sobra silencio, pero no falta nada hablado');
        } finally {
            oirToma.tramo = guardado.tramo;
            oirToma.leer = guardado.leer;
            grabacion.apagar();
        }
    });

    /* ─── El atraso del ciclo ─────────────────────────────────────────────────
     *
     * Esperar la orilla arregló el texto de la relectura, pero dejó a la vista el
     * otro lado del mismo problema: hasta que la relectura llega, lo que se ve es
     * lo que oyó el ciclo de señales, y el ciclo oye tarde. Cerrar la toma justo
     * después de hablar dejaba lo último dicho fuera de ella durante medio minuto
     * —«hay partes del transcript que no aparecen... como si hubiera un delay»—,
     * y no por el audio: la palabra llegaba, pero como ya no había toma abierta se
     * iba al colchón aunque cayera entre el IN y el OUT.
     */
    t.group('final de la toma · el atraso del ciclo de señales');

    t.test('lo último dicho entra en la toma aunque se cierre antes de oírlo',
        conWhisperFalso(async falso => {
            const { st, w } = await conUnaTomaAbierta(falso, 8);
            grabacion.cerrarToma();
            const s = grabacion._sesion();
            const out = s.estado.tomas[0].outMs;
            // La relectura de esa toma arranca y se queda trabajando: lo que se
            // mira acá es el texto que hay MIENTRAS tanto, que es el momento en
            // que el editor acaba de apretar el botón.
            falso.colgar = true;

            // Se dijo a los 7 s, o sea DENTRO de la toma, pero el ciclo lo oye
            // con la toma ya cerrada: su ventana va unos segundos atrás.
            falso.ventana = falso.ventana.concat([w(7000, 'lo'), w(7400, 'último')]);
            for (let i = 0; i < 2; i++) grabacion.pcm(pedazo());
            await grabacion.buscarSenales();
            await reposo();

            t.ok(st.ceroMs + 7400 < out, 'la palabra cae antes del OUT');
            t.deep(s.estado.tomas[0].palabras.map(x => x.texto), ['Hola', 'mundo', 'lo', 'último'],
                'y es de la toma, no del colchón');
            t.deep(s.estado.sueltas.map(x => x.texto), [], 'nada quedó suelto');
            t.deep(falso.leidas, [1],
                'y está puesto con la relectura todavía en vuelo, que es lo que tardaba');
        }));

    t.test('pero lo dicho DESPUÉS del OUT sigue siendo de nadie',
        conWhisperFalso(async falso => {
            // El colchón no se vacía: es de donde sale lo gris entre dos tomas y
            // lo que absorbe la toma siguiente al abrirse a mano.
            const { w } = await conUnaTomaAbierta(falso, 8);
            grabacion.cerrarToma();
            const s = grabacion._sesion();
            falso.colgar = true;

            falso.ventana = falso.ventana.concat([w(9000, 'ya'), w(9400, 'fuera')]);
            // Tres segundos y no dos: a la última palabra de una ventana el ciclo
            // no se la cree hasta la pasada siguiente (`firmeHastaMs`).
            for (let i = 0; i < 3; i++) grabacion.pcm(pedazo());
            await grabacion.buscarSenales();
            await reposo();

            t.deep(s.estado.tomas[0].palabras.map(x => x.texto), ['Hola', 'mundo'],
                'la toma no se estira');
            t.deep(s.estado.sueltas.map(x => x.texto), ['ya', 'fuera'], 'eso sí es suelto');
        }));

    t.group('final de la toma · un borde movido mientras se lee');

    t.test('la lectura que llega tarde no deshace el gesto', async () => {
        // Leer tarda —modelo grande sobre la toma entera— y el editor sigue
        // trabajando mientras tanto. La lectura reparte por los bordes que había
        // al empezar, así que al aterrizar pisaba el reparto del gesto con uno
        // viejo: con el IN corrido hacia atrás, las palabras que el editor
        // acababa de meter en la toma volvían a la orilla y desaparecían del
        // texto hasta la relectura siguiente.
        const guardado = { tramo: oirToma.tramo, leer: oirToma.leer };
        let suelta;
        const enVuelo = new Promise(r => { suelta = r; });
        let todas = [];
        let lecturas = 0;
        oirToma.tramo = async () => ({ palabras: [] });
        oirToma.leer = async (_a, toma) => {
            const bordes = { inMs: toma.inMs, outMs: toma.outMs };
            lecturas++;
            // La primera se queda esperando a que el editor mueva el borde; la
            // segunda no contesta nunca, para poder mirar el estado de en medio.
            if (lecturas === 1) await enVuelo;
            else await new Promise(() => {});
            return { colapsadas: 0, relectura: null, ...vivo.repartir(todas, bordes) };
        };

        try {
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'f', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
            todas = [w(6000, 'esto'), w(8000, 'es'), w(10000, 'uno'), w(12000, 'dos'),
                w(14000, 'tres'), w(22000, 'después')];
            const bordes = { inMs: st.ceroMs + 10000, outMs: st.ceroMs + 20000 };
            s.estado.tomas = [{
                id: 1, vista: 'PV', comentario: '', cuenta: '', descartada: false,
                cerradaSola: false, comentarios: [], ...bordes, ...vivo.repartir(todas, bordes)
            }];
            s.estado.proximaToma = 1;
            // Audio de sobra: la toma ya tiene su orilla, así que se lee enseguida.
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());

            const toma = s.estado.tomas[0];
            relecturas.encolar(s, 1);
            await reposo();
            t.eq(lecturas, 1, 'se está leyendo');

            // Y acá el editor mueve el IN hacia atrás: la toma empezó antes.
            grabacion.editar({ tipo: 'borde', toma: 1, borde: 'in', paredMs: st.ceroMs + 6000 });
            t.deep(toma.palabras.map(x => x.texto), ['esto', 'es', 'uno', 'dos', 'tres'],
                'el gesto mete las dos palabras de antes, al instante');

            suelta();
            await reposo();
            t.deep(toma.palabras.map(x => x.texto), ['esto', 'es', 'uno', 'dos', 'tres'],
                'y la lectura vieja no se las lleva de vuelta a la orilla');
            t.eq(toma.inMs, st.ceroMs + 6000, 'el borde sigue donde lo puso el editor');
        } finally {
            oirToma.tramo = guardado.tramo;
            oirToma.leer = guardado.leer;
            grabacion.apagar();
        }
    });

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
