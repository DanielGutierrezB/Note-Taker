'use strict';
/**
 * vtt.js — Lo que se dijo en una clase, como WebVTT, palabra por palabra.
 *
 * El XML de Premiere lleva las palabras adentro de los marcadores de cada toma,
 * que es lo que un editor lee en su línea de tiempo. OpenFilm las pide de otra
 * forma: un archivo `.vtt` al lado del audio y con su mismo nombre
 * (`clase-1.wav` → `clase-1.vtt`), en los segundos del archivo, con las
 * palabras marcadas una por una adentro de cada línea (§Words de su protocolo).
 * Con eso, sus subtítulos salen solos y su agente puede editar leyendo lo que se
 * dijo, que es la mitad del trabajo de un primer corte.
 *
 * Es texto, no XML: por eso vive aparte de `notas-xml.js` y no sabe de tomas ni
 * de proyectos. Recibe palabras y un archivo de audio, y devuelve el texto.
 */

/**
 * Cuánto silencio corta una línea.
 *
 * Es el mismo hueco con el que la app decide que una tirada de habla terminó
 * (`HUECO_DE_TIRADA_SEC` en `vivo/tomas.js`, segundo y medio) dividido por dos:
 * acá no se decide dónde empieza una toma sino dónde conviene cortar un
 * renglón, y a segundo y medio las líneas salían de veinte palabras.
 */
const PAUSA_SEC = 0.75;

/** Y el largo máximo de una línea, para que ninguna se vuelva un párrafo. */
const LINEA_MAX_SEC = 7;

/** Dos lecturas del mismo tramo ponen la misma palabra a esta distancia. */
const MISMA_PALABRA_MS = 350;

/** `00:01:02.345`, que es como WebVTT escribe un instante. */
function reloj(seg) {
    const s = Math.max(0, seg);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const resto = s - h * 3600 - m * 60;
    const dos = n => String(n).padStart(2, '0');
    return `${dos(h)}:${dos(m)}:${resto.toFixed(3).padStart(6, '0')}`;
}

/**
 * Las palabras de una sesión que suenan en un archivo de audio, sin repetir y
 * en orden, con su instante en segundos de ESE archivo.
 *
 * Se juntan de todos lados —las de cada toma, las de sus dos orillas y las que
 * quedaron sueltas— porque lo que el `.vtt` dice es lo que se oyó en la clase,
 * no lo que entró en una toma: el agente lo usa para ubicarse en el material
 * entero. Y sin repetir porque los tres sitios se solapan a propósito: la
 * orilla de una toma y el colchón del vivo cubren el mismo tramo con otras
 * horas (la misma regla que `juntarSinRepetir` en la ventana).
 *
 * @param {object} sesion el sidecar de la clase
 * @param {{desdeMs: number, segundos: number}} wav el archivo
 * @returns {{t: number, hasta: number|null, texto: string}[]} en segundos del archivo
 */
function palabrasDelArchivo(sesion, wav) {
    const hastaMs = wav.desdeMs + wav.segundos * 1000;
    const enElArchivo = lista => (lista || [])
        .filter(w => w && w.t >= wav.desdeMs && w.t < hastaMs && String(w.texto || '').trim())
        .sort((a, b) => a.t - b.t);

    const tomas = (sesion.tomas || []).filter(t => !t.descartada);
    // En orden de confianza: lo que quedó adentro de una toma lo escribió el
    // modelo grande con la frase entera; sus orillas también, pero son el borde
    // de esa lectura; y el colchón del vivo es el texto descartable.
    const fuentes = [
        enElArchivo([].concat(...tomas.map(t => t.palabras || []))),
        enElArchivo([].concat(...tomas.map(t => (t.antes || []).concat(t.despues || [])))),
        enElArchivo(sesion.sueltas)
    ];

    // **La misma palabra, no la de al lado.** Se descarta una palabra solo si
    // una fuente ANTERIOR ya dice algo en ese instante: adentro de una misma
    // lectura las palabras van a dos o tres décimas una de otra, y mirando
    // contra lo ya guardado se perdía una de cada dos. Es la misma regla que
    // `juntarSinRepetir` en la ventana, y por el mismo motivo: las tres fuentes
    // cubren tramos que se solapan, cada una con sus propias horas.
    const salida = [];
    for (const fuente of fuentes) {
        const ya = salida.map(w => w.ms).sort((a, b) => a - b);
        for (const w of fuente) {
            if (cercaDeAlguna(ya, w.t)) continue;
            salida.push({
                ms: w.t,
                t: (w.t - wav.desdeMs) / 1000,
                hasta: w.hasta != null ? (w.hasta - wav.desdeMs) / 1000 : null,
                texto: String(w.texto).trim()
            });
        }
    }
    return salida.sort((a, b) => a.ms - b.ms).map(({ t, hasta, texto }) => ({ t, hasta, texto }));
}

/** Si en `ms` (ordenados) hay un instante a menos de `MISMA_PALABRA_MS` de `t`. */
function cercaDeAlguna(ms, t) {
    let lo = 0;
    let hi = ms.length;
    while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (ms[m] < t) lo = m + 1; else hi = m;
    }
    return (lo < ms.length && ms[lo] - t < MISMA_PALABRA_MS) || (lo > 0 && t - ms[lo - 1] < MISMA_PALABRA_MS);
}

/** Las palabras repartidas en líneas: corta en las pausas y a los 7 segundos. */
function enLineas(palabras) {
    const lineas = [];
    let actual = null;
    for (const w of palabras) {
        const previa = actual && actual[actual.length - 1];
        const hueco = previa ? w.t - (previa.hasta != null ? previa.hasta : previa.t) : 0;
        const larga = actual && w.t - actual[0].t >= LINEA_MAX_SEC;
        if (!actual || hueco >= PAUSA_SEC || larga) {
            actual = [];
            lineas.push(actual);
        }
        actual.push(w);
    }
    return lineas;
}

/**
 * El `.vtt` de un archivo de audio.
 *
 * Cada línea es un cue y cada palabra lleva su marca de tiempo adentro, menos
 * la primera, que empieza donde empieza el cue. El final del cue es el de su
 * última palabra, estirado hasta la primera de la línea siguiente cuando el
 * hueco es corto: un subtítulo que desaparece entre palabra y palabra parpadea.
 *
 * @param {object} sesion el sidecar de la clase
 * @param {{desdeMs: number, segundos: number}} wav el archivo
 * @returns {string} el texto del archivo, o '' si en ese audio no se dijo nada
 */
function deLaSesion(sesion, wav) {
    if (!sesion || !wav || !(wav.segundos > 0)) return '';
    const lineas = enLineas(palabrasDelArchivo(sesion, wav));
    if (!lineas.length) return '';

    const partes = ['WEBVTT', '',
        'NOTE Lo que se oyó en esta clase, palabra por palabra, como lo transcribió Note Taker.', ''];
    lineas.forEach((linea, i) => {
        const primera = linea[0];
        const ultima = linea[linea.length - 1];
        const fin = ultima.hasta != null ? ultima.hasta : ultima.t + 0.3;
        const siguiente = lineas[i + 1];
        const hasta = Math.min(
            siguiente ? siguiente[0].t : wav.segundos,
            Math.max(fin, primera.t + 0.1),
            wav.segundos
        );
        partes.push(`${reloj(primera.t)} --> ${reloj(Math.max(hasta, primera.t + 0.1))}`);
        partes.push(linea.map((w, n) => (n === 0 ? w.texto : `<${reloj(w.t)}>${w.texto}`)).join(' '));
        partes.push('');
    });
    return `${partes.join('\n')}`;
}

module.exports = { PAUSA_SEC, LINEA_MAX_SEC, reloj, palabrasDelArchivo, enLineas, deLaSesion };
