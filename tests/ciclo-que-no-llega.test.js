'use strict';
/**
 * El ciclo de señales que no llega, y las notas que se perdieron por eso.
 *
 * El 8 de octubre, grabando un vídeo de la semana: las pasadas del ciclo
 * subieron de 2,5 s a 5,9 s sobre una ventana de 6 s, la ventana se abrió al
 * tope de 15 s y las pasadas pasaron a 30,7 s y 34,2 s. Desde la silla, el
 * transcript dejó de avanzar — igual que si el profesor estuviera callado, sin
 * un aviso en ningún sitio. Quien grababa siguió abriendo tomas a mano, y la
 * cola de Whisper llegó toda junta con una «Pausa» de ANTES que le cerró una
 * toma 0,10 s después de su IN: el montaje la tiró por corta y ese trozo de la
 * clase no salió en ninguna parte.
 *
 * Son tres cosas distintas y cada una se arregló por su lado:
 *
 *   - la señal vieja que cierra una toma nueva (en `notas-vivo.test.js`, al
 *     lado de las demás señales);
 *   - la ventana que se ensancha justo cuando no se puede pagar (`topeDeVentana`);
 *   - y que no se vea, que es lo que convirtió un problema de máquina en
 *     trabajo perdido (`atrasoSec` y `estados.atrasado`).
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const grabacion = require('../engine/grabacion');
const espejo = require('../engine/espejo');
const vivo = require('../engine/notas-vivo');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const T0 = Date.parse('2026-10-08T17:42:16');

/** Una sesión como la que mira `espejo.resumen`, sin motor y sin WAV. */
function sesion(p) {
    return {
        estado: vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 }),
        dir: '/tmp/x',
        cola: [],
        historia: { atras: [], adelante: [] },
        captura: { desdeMs: T0, segundos: p.segundos },
        escuchadoHastaMs: T0 + (p.escuchadoSec || p.segundos) * 1000,
        salteadoMs: p.salteadoMs || 0
    };
}

module.exports = async t => {
    const estados = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'estados.js')).href);
    const tarjetas = await import(
        pathToFileURL(path.join(RAIZ, 'src', 'js', 'semanal', 'tarjetas.js')).href);

    t.group('ciclo atrasado · la ventana deja de ensancharse');

    t.test('un tropiezo suelto sí ensancha: esos segundos se recuperan', () => {
        // Una pasada de 8 s sobre 10 s de ventana se llevó más audio del que
        // costó. Ensanchar funcionó, así que se sigue ensanchando.
        t.eq(grabacion.topeDeVentana({ ultimaPasadaMs: 8000, ultimaVentanaMs: 10000 }),
            grabacion.VENTANA_MAX_MS);
    });

    t.test('la pasada normal ensancha, claro', () => {
        t.eq(grabacion.topeDeVentana({ ultimaPasadaMs: 500, ultimaVentanaMs: 6000 }),
            grabacion.VENTANA_MAX_MS);
    });

    t.test('la pasada que costó más que el audio que se llevó, no', () => {
        // Los números de la sesión del 8 de octubre: 30,7 s para 10,8 s de
        // ventana. Pedir 15 s otra vez es pagar dos veces y media por tirar lo
        // mismo, porque `escuchadoHastaMs` salta al final igual.
        t.eq(grabacion.topeDeVentana({ ultimaPasadaMs: 30662, ultimaVentanaMs: 10800 }),
            grabacion.CONTEXTO_MS, 'vuelve a la ventana de siempre');
    });

    t.test('el piso es la ventana de siempre y no menos', () => {
        // Por debajo de `CONTEXTO_MS` Whisper deja de acertar y las señales se
        // pierden, que sería cambiar un problema por otro peor.
        t.eq(grabacion.topeDeVentana({ ultimaPasadaMs: 999999, ultimaVentanaMs: 1 }),
            grabacion.CONTEXTO_MS);
        t.ok(grabacion.CONTEXTO_MS < grabacion.VENTANA_MAX_MS);
    });

    t.test('y el ciclo pide el tope a la política, no al máximo', () => {
        // El cableado, que es lo que puede volverse atrás en silencio: con
        // `hasta - VENTANA_MAX_MS` escrito a mano, la política de arriba queda
        // probada y sin usar, y la sesión se desboca igual.
        const js = leer('engine', 'grabacion.js');
        t.ok(/hasta - topeDeVentana\(s\)/.test(js), 'la ventana sale de `topeDeVentana`');
        t.ok(/s\.ultimaPasadaMs = Date\.now\(\) - empezoLaPasada/.test(js),
            'y cada pasada deja dicho lo que costó, que es de donde sale el tope siguiente');
        t.ok(/s\.ultimaVentanaMs = hasta - desde/.test(js), 'y lo que se llevó');
    });

    t.test('una sesión recién abierta ensancha como cualquiera', () => {
        // Sin pasadas todavía: `ultimaPasadaMs` arranca en 0 y no puede dar por
        // perdido un terreno que nadie pisó.
        t.eq(grabacion.topeDeVentana({ ultimaPasadaMs: 0, ultimaVentanaMs: grabacion.CONTEXTO_MS }),
            grabacion.VENTANA_MAX_MS);
    });

    t.group('ciclo atrasado · el estado lo cuenta');

    t.test('el resumen dice cuánto atrás va el ciclo', () => {
        const r = espejo.resumen(sesion({ segundos: 120, escuchadoSec: 119.5 }));
        t.near(r.atrasoSec, 0.5, 0.05, 'medio segundo es lo normal: es `COLA_MS`');
        t.eq(r.salteadoSec, 0, 'y nada salteado');
    });

    t.test('y lo dice cuando es el atraso de la sesión que se perdió', () => {
        const r = espejo.resumen(sesion({ segundos: 156, escuchadoSec: 125, salteadoMs: 19000 }));
        t.eq(r.atrasoSec, 31);
        t.eq(r.salteadoSec, 19);
    });

    t.test('una sesión sin ciclo no va atrasada: va en cero', () => {
        // Y no cincuenta y seis años, que es lo que da restarle a una hora del
        // día un cero. Avisaría de un problema que no existe.
        const s = sesion({ segundos: 10 });
        delete s.escuchadoHastaMs;
        t.eq(espejo.resumen(s).atrasoSec, 0);
    });

    t.test('un atraso negativo no existe', () => {
        // `grabadoHastaMs` y `escuchadoHastaMs` los mueven dos sitios distintos
        // y por un instante el segundo puede ir delante. Decir «-0,3 s de
        // atraso» sería decir que la app oye el futuro.
        const r = espejo.resumen(sesion({ segundos: 10, escuchadoSec: 11 }));
        t.eq(r.atrasoSec, 0);
    });

    t.group('ciclo atrasado · se ve mientras se graba');

    t.test('medio segundo de atraso no dice nada: es lo normal', () => {
        t.eq(estados.atrasado({ atrasoSec: 0.5, salteadoSec: 0 }), null);
    });

    t.test('el atraso que todavía no pierde palabras tampoco', () => {
        // El umbral es `CONTEXTO_MS - SOLAPE_MS`: hasta ahí las dos ventanas
        // seguidas se tocan y no queda audio en el medio.
        t.eq(estados.atrasado({ atrasoSec: 4, salteadoSec: 0 }), null);
    });

    t.test('pasado el umbral lo dice, con los segundos', () => {
        const a = estados.atrasado({ atrasoSec: 31, salteadoSec: 0 });
        t.ok(a, 'hay aviso');
        t.ok(/31/.test(a.palabra), `los segundos en la palabra: ${a.palabra}`);
        t.ok(/mano/.test(a.porque),
            'y el porqué avisa de lo que de verdad duele: abrir o cerrar a mano con el ciclo '
            + 'atrasado deja el borde corrido');
    });

    t.test('el umbral sale de los números del motor y no de uno elegido', () => {
        // Copiado en `estados.js` porque la ventana no puede cargar el motor, y
        // comparado acá para que no se separen — como `insistir.test.js`.
        const js = leer('src', 'js', 'estados.js');
        const m = js.match(/SE_PIERDEN_PALABRAS_SEC = \((\d+) - (\d+)\) \/ 1000/);
        t.ok(m, 'el umbral está escrito como la resta que es');
        t.eq(Number(m[1]), grabacion.CONTEXTO_MS, 'con el CONTEXTO_MS del motor');
        t.eq(Number(m[2]), grabacion.SOLAPE_MS, 'y con su SOLAPE_MS');
    });

    t.test('el audio salteado se queda puesto aunque el ciclo se ponga al día', () => {
        // El mismo trato que `audio.roto`: el agujero ya está hecho, deje o no
        // de pasar, y lo que hay que saber al entregar es que está.
        const a = estados.atrasado({ atrasoSec: 0.5, salteadoSec: 19 });
        t.ok(a, 'sigue avisando con el ciclo al día');
        t.ok(/19/.test(a.porque), 'con cuántos segundos de audio no se transcribieron');
        t.ok(/completo/.test(a.porque),
            'y diciendo que la grabación está completa: lo que falta es texto, no vídeo');
        t.ok(/revisalos|revisá/.test(a.porque), 'y que hay que revisar los bordes');
    });

    t.test('el hueco manda sobre el atraso: es el que no se va', () => {
        const a = estados.atrasado({ atrasoSec: 31, salteadoSec: 19 });
        t.ok(/hueco/.test(a.palabra), `el hueco primero: ${a.palabra}`);
    });

    t.test('la pastilla de la sesión lo pone por encima de «toma abierta»', () => {
        // Es CON una toma abierta cuando esto hace daño, así que taparlo con
        // «toma abierta» sería taparlo justo cuando hay que verlo.
        const e = estados.deSesion({ abierta: 3, atrasoSec: 31, salteadoSec: 0 }, null);
        t.ok(/atrás/.test(e.palabra), `${e.palabra}`);
    });

    t.test('pero el audio perdido sigue mandando sobre todo', () => {
        const e = estados.deSesion(
            { abierta: 3, atrasoSec: 31, salteadoSec: 19 },
            { roto: { veces: 1, mensaje: 'ENOSPC' } });
        t.eq(e.palabra, 'audio perdido', 'un WAV con agujeros es peor que un texto con agujeros');
    });

    t.group('ciclo atrasado · la tarjeta del vídeo de la semana');

    t.test('la tarjeta de grabar lo dice en la pastilla y en un renglón', () => {
        // Es la pantalla donde pasó, y la única que no usa la pastilla de clase.
        const html = tarjetas.tarjetaGrabando({
            sesion: { tomas: [{ id: 1, inMs: T0, outMs: null }], atrasoSec: 31, salteadoSec: 0 },
            vista: 'PV', avisos: []
        });
        t.ok(/id="semanal-pastilla"/.test(html), 'la pastilla tiene nombre para poder refrescarla');
        t.ok(/atrás/.test(html), 'y dice el atraso en vez de «toma abierta»');
        t.ok(/id="semanal-atraso"/.test(html), 'con su renglón, porque la palabra sola no alcanza');
        t.ok(/role="status"/.test(html), 'y anunciado, que es lo que lo hace llegar sin mirar');
    });

    t.test('sin atraso la tarjeta dice lo de siempre', () => {
        const html = tarjetas.tarjetaGrabando({
            sesion: { tomas: [{ id: 1, inMs: T0, outMs: null }], atrasoSec: 0.5, salteadoSec: 0 },
            vista: 'PV', avisos: []
        });
        t.ok(/toma abierta/.test(html));
        t.ok(!/id="semanal-atraso"/.test(html), 'sin el renglón, que si no es ruido permanente');
    });

    t.test('los segundos se refrescan sin repintar la tarjeta', () => {
        // Repintar cada segundo borraría el `<video>` de la vista previa, que es
        // justo lo que la huella de `repintarReloj` evita. Así que el número va
        // a mano, como el reloj, y en la huella entra solo que el aviso esté.
        const js = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/estados\.atrasado\(resumen\)/.test(js), 'el atraso se calcula en cada vuelta');
        t.ok(/#semanal-pastilla/.test(js) && /#semanal-atraso/.test(js),
            'y los dos sitios se refrescan a mano');
        t.ok(/\.concat\(\[atras \? atras\.clave : ''\]\)/.test(js),
            'en la huella va la clave y no los segundos: los segundos repintarían siempre');
    });
};
