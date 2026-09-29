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
 * **El piso es −60 dBFS y no más alto a propósito.** Medido en esas mismas
 * pruebas: la voz por Zoom va de −13 a −30 dB, y el ruido de sala más bajo de
 * unos AirPods como micrófono anda en −55. Un piso más alto empezaría a comerse
 * palabras dichas bajito por micrófono; este solo saca lo que cae sobre
 * silencio de verdad.
 */

const fs = require('fs');

/** Cada cuánto se mide, en segundos. Veinte milisegundos es media sílaba. */
const HOP_SEC = 0.02;

/** Por debajo de esto no suena nada (ver arriba). */
const PISO_DB = -60;

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

/** El tramo más fuerte entre dos segundos del recorte. */
function maximo(n, desdeSec, hastaSec) {
    const a = Math.max(0, Math.floor(desdeSec / n.hopSec));
    const b = Math.min(n.db.length, Math.ceil(hastaSec / n.hopSec));
    let m = -Infinity;
    for (let i = a; i < b; i++) if (n.db[i] > m) m = n.db[i];
    return m;
}

/** ¿Suena algo en todo el recorte? Si no, no hace falta ni preguntarle a Whisper. */
function algoSuena(n) {
    if (!n) return true;
    return maximo(n, 0, Infinity) >= PISO_DB;
}

/**
 * Las palabras que tienen sonido alrededor. Los tiempos son segundos dentro del
 * recorte (`start`/`end`, o `dtw` si vino), como salen de Whisper.
 *
 * @returns {{words:Array, mudas:number}}
 */
function conSonido(words, n) {
    if (!n) return { words: words || [], mudas: 0 };
    const salida = [];
    let mudas = 0;
    for (const w of words || []) {
        const desde = Math.min(w.start, w.dtw != null ? w.dtw : w.start);
        const hasta = Math.max(w.end != null ? w.end : w.start, desde);
        if (maximo(n, desde - MARGEN_SEC, hasta + MARGEN_SEC) >= PISO_DB) salida.push(w);
        else mudas++;
    }
    return { words: salida, mudas };
}

module.exports = { niveles, algoSuena, conSonido, PISO_DB, HOP_SEC, MARGEN_SEC };
