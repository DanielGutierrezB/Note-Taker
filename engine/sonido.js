'use strict';
/**
 * sonido.js — Dónde hay sonido en un recorte, para no creerle a Whisper
 * palabras dichas sobre el silencio.
 *
 * Whisper, sobre silencio, escribe frases aprendidas de memoria de los
 * subtítulos con que lo entrenaron: «Gracias.», «Gracias por ver el video.»,
 * «Subtítulos realizados por la comunidad de Amara.org». En una llamada de Zoom
 * eso pasa todo el tiempo, porque Zoom manda silencio DIGITAL —ceros exactos,
 * −120 dB— cada vez que nadie habla, y fue lo que se vio en las pruebas del
 * 29/09: «Gracias, gracias, gracias» antes de que el profesor empezara.
 *
 * `collapseLoops` (`transcribe.js`) ya sacaba la repetición larga, pero no un
 * «Gracias.» suelto ni tres seguidos. Esto mira el sonido, que es la única
 * fuente que no se puede inventar: una palabra cuyo alrededor no tiene nada que
 * suene no la dijo nadie.
 *
 * **Por qué el piso no puede ser un número fijo.** La primera versión cortaba
 * en −60 dBFS, pensando en ese silencio digital de Zoom, y en la clase del
 * 30/09 no filtró nada: el micrófono era unos AirPods, y ahí
 * el silencio de una sala de verdad está en −65 y sube a −55. El corte quedaba
 * DEBAJO del ruido, así que todo pasaba. Lo que separa no es el nivel absoluto
 * sino cuánto sobresale del ruido de ESA sala, con ESE micrófono. Medido sobre
 * las dos grabaciones reales que tenemos:
 *
 *   clase del 29/09 (2,5 h)   piso −74   lo hablado, de +30 a +65 dB sobre el piso
 *   clase del 30/09           piso −67   lo hablado, de +42 a +54
 *                                        lo inventado («¡Suscríbete al canal!»,
 *                                        «Y», «ya está.»), de +17,8 a +18,7
 *
 * O sea: lo dicho nunca bajó de +30 y lo inventado nunca pasó de +19. El corte
 * va en +24, justo en la mitad, y el piso se mide sobre la marcha porque cambia
 * cuando la persona cambia de micrófono o prende el aire acondicionado.
 *
 * **Y por qué no alcanza con el pico.** Con el corte adaptativo puesto, sobre
 * seis tramos callados del 30/09 Whisper seguía escribiendo «Gracias.» en dos
 * de ellos: en esos había un clic de teclado o un golpe de aire, que llega a
 * −33 dB y pasa cualquier corte de nivel. Lo que un ruido así NO tiene es
 * duración. Contando cuántos milisegundos estuvo el sonido arriba del corte:
 *
 *   los seis tramos callados        0, 80, 0, 20, 0 y 100 ms en seis segundos
 *   las 11.490 palabras del 29/09   99 de cada 100 pasan de 420 ms
 *
 * Por eso lo que se mide es tiempo sostenido y no pico. El corte en 150 ms sacó
 * lo inventado de las dos grabaciones sin tocar ninguna de las 101 palabras
 * dichas del 30/09 y perdiendo 3 de las 11.490 del 29/09 —«ta,», «ta,»,
 * «cuesta.»: finales de frase que se apagan—. En 300 ms se habría perdido un
 * «Pausa.», que es la palabra que cierra una toma, y eso ya no se puede pagar.
 */

const fs = require('fs');

/** Cada cuánto se mide, en segundos. Veinte milisegundos es media sílaba. */
const HOP_SEC = 0.02;

/**
 * El corte más bajo posible. Con una fuente que manda silencio digital el piso
 * medido es −120, y +24 sobre eso dejaría pasar cualquier cosa; acá se planta.
 */
const PISO_DB = -60;

/** Cuánto tiene que sobresalir del ruido de sala una palabra para creerle (ver arriba). */
const MARGEN_DB = 24;

/**
 * Y el corte más alto posible. En una sala muy ruidosa +24 se comería lo
 * hablado, y perder una palabra dicha es peor que mostrar una inventada: de acá
 * para arriba el filtro se rinde y deja pasar todo.
 */
const TECHO_DB = -35;

/**
 * Cuántas pasadas recuerda el piso. A una por segundo son cinco minutos: dura
 * lo suficiente para no moverse con una frase larga y lo bastante poco para
 * seguir a la persona que se cambia los audífonos a mitad de clase.
 */
const RECUERDO = 300;

/** Con menos pasadas medidas todavía no hay de dónde sacar un piso; vale el de abajo. */
const MINIMO = 3;

/** Cuánto tiene que durar el sonido para ser una palabra y no un golpe (ver arriba). */
const SOSTENIDO_MS = 150;

/**
 * Cuánto alrededor de una palabra se mira. Los tiempos de Whisper se corren
 * varias décimas; con menos margen se perdería la primera palabra de una frase
 * cuyo comienzo el modelo puso un poco antes de que suene.
 */
const MARGEN_SEC = 0.5;

/**
 * El nivel de cada tramo de 20 ms de un WAV PCM de 16 bits mono, en dBFS.
 *
 * @returns {{hopSec:number, db:Float32Array}|null} null si no es un WAV que se
 *   entienda: quien llama sigue sin filtrar, que es lo que había
 */
function niveles(archivo) {
    let buf;
    try { buf = fs.readFileSync(archivo); } catch (e) { return null; }
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;

    let tasa = 0;
    let canales = 0;
    let bits = 0;
    let datos = null;
    for (let off = 12; off + 8 <= buf.length;) {
        const id = buf.toString('ascii', off, off + 4);
        const largo = buf.readUInt32LE(off + 4);
        const cuerpo = off + 8;
        if (id === 'fmt ') {
            canales = buf.readUInt16LE(cuerpo + 2);
            tasa = buf.readUInt32LE(cuerpo + 4);
            bits = buf.readUInt16LE(cuerpo + 14);
        } else if (id === 'data') {
            datos = buf.subarray(cuerpo, Math.min(buf.length, cuerpo + largo));
            break;
        }
        off = cuerpo + largo + (largo % 2);
    }
    if (!datos || bits !== 16 || canales !== 1 || !tasa) return null;

    const porHop = Math.max(1, Math.round(tasa * HOP_SEC));
    const muestras = Math.floor(datos.length / 2);
    const db = new Float32Array(Math.ceil(muestras / porHop));
    for (let h = 0; h < db.length; h++) {
        let suma = 0;
        const fin = Math.min(muestras, (h + 1) * porHop);
        for (let i = h * porHop; i < fin; i++) {
            const v = datos.readInt16LE(i * 2) / 32768;
            suma += v * v;
        }
        const rms = Math.sqrt(suma / Math.max(1, fin - h * porHop));
        db[h] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    return { hopSec: porHop / tasa, db };
}

/** Cuántos milisegundos, entre dos segundos del recorte, el sonido pasó del corte. */
function arribaMs(n, desdeSec, hastaSec, corte) {
    const a = Math.max(0, Math.floor(desdeSec / n.hopSec));
    const b = Math.min(n.db.length, Math.ceil(hastaSec / n.hopSec));
    let hops = 0;
    for (let i = a; i < b; i++) if (n.db[i] >= corte) hops++;
    return hops * n.hopSec * 1000;
}

/** El valor bajo el cual queda `q` de los tramos. */
function percentil(db, q) {
    const orden = Array.from(db).sort((a, b) => a - b);
    return orden[Math.min(orden.length - 1, Math.floor(q * orden.length))];
}

/**
 * El piso de ruido de una sesión, que se va aprendiendo pasada por pasada.
 * Vive junto a la sesión de captura, no acá: dos clases seguidas no comparten
 * sala ni micrófono.
 */
function seguidor() {
    return { vistos: [] };
}

/**
 * Lo que sonó en una pasada, para el piso. Se guarda el percentil 10 del
 * recorte —o sea lo más callado que hubo en esos segundos— y no el mínimo,
 * que lo movería un solo tramo raro.
 */
function aprender(s, n) {
    if (!s || !n || !n.db.length) return;
    s.vistos.push(percentil(n.db, 0.1));
    if (s.vistos.length > RECUERDO) s.vistos.shift();
}

/**
 * De qué nivel para arriba se le cree a una palabra, con lo aprendido hasta
 * ahora. La mediana de las pasadas y no el promedio: media clase hablando
 * seguido no puede subir el piso.
 */
function umbral(s) {
    if (!s || s.vistos.length < MINIMO) return PISO_DB;
    const orden = s.vistos.slice().sort((a, b) => a - b);
    const piso = orden[Math.floor(orden.length / 2)];
    return Math.min(TECHO_DB, Math.max(PISO_DB, piso + MARGEN_DB));
}

/**
 * ¿Se habló en algún momento del recorte? Si no, no hace falta ni preguntarle a
 * Whisper: se ahorra la pasada y no hay nada que inventar.
 */
function algoSuena(n, corte) {
    if (!n) return true;
    return arribaMs(n, 0, Infinity, corte == null ? PISO_DB : corte) >= SOSTENIDO_MS;
}

/**
 * Las palabras que tienen sonido alrededor. Los tiempos son segundos dentro del
 * recorte (`start`/`end`, o `dtw` si vino), como salen de Whisper.
 *
 * @returns {{words:Array, mudas:number}}
 */
function conSonido(words, n, corte) {
    if (!n) return { words: words || [], mudas: 0 };
    const piso = corte == null ? PISO_DB : corte;
    const salida = [];
    let mudas = 0;
    for (const w of words || []) {
        const desde = Math.min(w.start, w.dtw != null ? w.dtw : w.start);
        const hasta = Math.max(w.end != null ? w.end : w.start, desde);
        if (arribaMs(n, desde - MARGEN_SEC, hasta + MARGEN_SEC, piso) >= SOSTENIDO_MS) salida.push(w);
        else mudas++;
    }
    return { words: salida, mudas };
}

module.exports = {
    niveles, algoSuena, conSonido, seguidor, aprender, umbral,
    PISO_DB, MARGEN_DB, TECHO_DB, HOP_SEC, MARGEN_SEC, MINIMO, SOSTENIDO_MS
};
