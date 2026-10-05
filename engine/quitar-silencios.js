'use strict';
/**
 * quitar-silencios.js — Sacarle al vídeo los huecos en que nadie habla.
 *
 * Es para el vídeo de la semana, y es lo que pidió quien lo graba: entre una
 * idea y la siguiente uno se queda pensando, mira la pantalla, busca la
 * ventana que iba a enseñar. Eso en el momento no se nota y en el vídeo dura
 * una eternidad. El resultado es un vídeo que se sigue mejor y que dura menos,
 * sin que nadie tenga que abrir un editor.
 *
 * ── De dónde sale el silencio ─────────────────────────────────────────────
 *
 * **De la onda, no del texto.** Las marcas de palabra de Whisper serían lo
 * fácil —el hueco entre dos palabras es una resta— y serían mentira: cuando
 * detrás de una palabra hay silencio, Whisper le estira el final hasta donde
 * llega el audio que oyó, así que el hueco más largo de todos es justamente el
 * que mide cero (está medido y contado en `aplicarSenales`, en
 * `engine/notas-vivo.js`). Mirar la onda es la única forma de que un silencio
 * sea un silencio.
 *
 * Y la onda ya se sabe mirar: el umbral aprendido, el piso de la sala y la
 * búsqueda de huecos son los de `ajustar-corte.js`, que es lo que corre cada
 * borde de cada toma al silencio más cercano. Acá se usa el mismo umbral para
 * contestar otra pregunta —no «dónde está el hueco de al lado» sino «qué
 * huecos son largos»— y por eso el silencio que este archivo encuentra es el
 * mismo que encuentra aquel. Dos ideas distintas de silencio en la misma app
 * darían dos cortes que no se explican entre sí.
 *
 * ── Qué hace con él ───────────────────────────────────────────────────────
 *
 * No lo borra: lo acorta. Pegar las dos frases sin nada en medio suena a
 * recorte —las palabras se chocan y se oye el salto— y además no es lo que
 * hace falta: lo que molesta no es la pausa, es que dure cinco segundos. Un
 * hueco de más de `LARGO_MIN_SEC` queda en `AIRE_SEC`, que es lo que dura una
 * pausa normal entre dos frases.
 *
 * Trabaja sobre la lista de tomas ya resuelta del exportador —`{id, vista,
 * desdeMs, hastaMs}`— y devuelve la misma lista con más entradas: una toma con
 * dos silencios largos sale en tres pedazos, todos con su mismo `id` y su
 * misma vista. De ahí en adelante no cambia nada: el reparto, el grafo de
 * ffmpeg y el pegado ya trabajaban con una lista de trozos.
 */

const ajustar = require('./ajustar-corte');

/**
 * A partir de cuánto un hueco es «un silencio» y se acorta.
 *
 * Siete décimas, que es el número que se pidió, y aguanta mirado de cerca: una
 * pausa entre dos frases de la misma idea dura entre 0,3 y 0,5 s, y una coma
 * hablada menos todavía. Con un umbral más bajo se empezarían a comer las
 * pausas que son parte de cómo habla la persona, y el vídeo saldría atropellado.
 */
const LARGO_MIN_SEC = 0.7;

/**
 * En cuánto queda el hueco acortado.
 *
 * Tres décimas: lo que dura una pausa normal entre dos frases. Dejarlo en cero
 * es lo que suena mal —las dos frases se tocan, y se oye el corte—, y dejarlo
 * en medio segundo no se distingue de no haber hecho nada.
 */
const AIRE_SEC = 0.3;

/**
 * Lo más corto que puede quedar un pedazo.
 *
 * Un silencio largo justo después de la primera palabra dejaría un pedazo de
 * dos décimas: en el vídeo eso es un parpadeo con media sílaba. Cuando el
 * corte dejaría algo más corto que esto, no se corta; el hueco se queda y el
 * pedazo sigue entero, que es el modo de fallar correcto.
 */
const PEDAZO_MIN_SEC = 0.5;

/**
 * Parte las tomas por sus silencios largos.
 *
 * Es tolerante con todo lo que puede faltar, igual que `ajustar-corte.js`: sin
 * WAV, con uno que no se entiende o sin contraste para distinguir un silencio,
 * la toma sale entera. Nunca tira.
 *
 * @param {object[]} tomas `{id, vista, desdeMs, hastaMs}`, en el reloj del audio
 * @param {object} estado la sesión leída del sidecar
 * @param {object} [opciones] `resolver(rutaGuardada)` → dónde está el WAV hoy
 * @returns {{tomas:object[], huecos:number}}
 */
function partir(tomas, estado, opciones) {
    const o = opciones || {};
    const salida = [];
    let huecos = 0;

    const abiertos = new Map();
    const umbrales = new Map();
    const dameWav = archivo => {
        if (!abiertos.has(archivo)) abiertos.set(archivo, ajustar.abrir(archivo));
        return abiertos.get(archivo);
    };
    const damePiso = (archivo, w) => {
        if (!umbrales.has(archivo)) umbrales.set(archivo, ajustar.umbralDe(w));
        return umbrales.get(archivo);
    };

    try {
        for (const toma of tomas || []) {
            const pedazos = deUnaToma(toma, estado, o, dameWav, damePiso);
            if (!pedazos) {
                salida.push(toma);
                continue;
            }
            huecos += pedazos.length - 1;
            for (const p of pedazos) salida.push(p);
        }
    } finally {
        for (const w of abiertos.values()) ajustar.cerrar(w);
    }

    // Cuánto se quitó NO se contesta acá a propósito. Saldría en el reloj del
    // audio, que es el de los bordes, y a una persona hay que decirle segundos
    // de los que va a ver pasar en el reproductor. Quien lo cuenta es
    // `deSesion`, que pasa los dos extremos por `enLosDosRelojes` antes de
    // restar. Un número en el reloj equivocado es peor que ninguno: nadie puede
    // mirarlo y darse cuenta de que está mal.
    return { tomas: salida, huecos };
}

/** Los pedazos de UNA toma, o null si no se pudo mirar su onda. */
function deUnaToma(toma, estado, o, dameWav, damePiso) {
    const donde = ajustar.dondeCae(estado.sesiones, toma.desdeMs, o.resolver);
    if (!donde) return null;
    const w = dameWav(donde.archivo);
    if (!w) return null;
    const piso = damePiso(donde.archivo, w);
    if (!piso) return null;

    const largoSec = (toma.hastaMs - toma.desdeMs) / 1000;
    const tramo = ajustar.nivelesDeTramo(w, donde.sec, donde.sec + largoSec);
    if (!tramo) return null;

    const umbralDb = ajustar.umbralLocal(tramo, piso.pisoDb);
    const largos = ajustar.silencios(tramo, umbralDb)
        .filter(h => h.hasta - h.desde >= LARGO_MIN_SEC);
    if (!largos.length) return null;

    // De segundos dentro del WAV a milisegundos del reloj del audio, que es en
    // el que vienen los bordes de la toma. Es la misma cuenta que `dondeCae`
    // al revés, así que el pedazo cae donde se midió.
    const aMs = sec => toma.desdeMs + (sec - donde.sec) * 1000;
    const mitad = AIRE_SEC / 2;

    const pedazos = [];
    let cursorMs = toma.desdeMs;
    for (const h of largos) {
        const cierraMs = aMs(h.desde + mitad);
        const abreMs = aMs(h.hasta - mitad);
        // Ni un pedazo demasiado corto antes del hueco, ni un corte que no
        // adelanta nada: los dos dejan el hueco donde está.
        if (cierraMs - cursorMs < PEDAZO_MIN_SEC * 1000) continue;
        if (abreMs <= cierraMs) continue;
        pedazos.push({ ...toma, desdeMs: cursorMs, hastaMs: cierraMs });
        cursorMs = abreMs;
    }
    if (!pedazos.length) return null;

    // La cola. Si quedó más corta que el mínimo no se tira: se le devuelve al
    // pedazo de antes, que es como si ese hueco no se hubiera cortado.
    if (toma.hastaMs - cursorMs < PEDAZO_MIN_SEC * 1000) {
        pedazos[pedazos.length - 1].hastaMs = toma.hastaMs;
    } else {
        pedazos.push({ ...toma, desdeMs: cursorMs, hastaMs: toma.hastaMs });
    }
    return pedazos;
}

module.exports = { LARGO_MIN_SEC, AIRE_SEC, PEDAZO_MIN_SEC, partir };
