'use strict';
/**
 * alinear-audio.js — Que el WAV del micrófono no se atrase contra el reloj.
 *
 * Los marcadores viven en la hora del día y su lugar en el WAV se saca contando
 * desde que se abrió (`captura.posicionDe`). Si al archivo le faltan muestras
 * —el dispositivo se reacomodó, el sistema suspendió el audio un momento—, todo
 * lo de ahí en adelante cae corrido, y crece con cada tropiezo: una prueba de
 * tres minutos terminó 2,4 s atrás sin que nada lo dijera hasta el final.
 *
 * El audio de Zoom ya se completa con silencio del lado del ayudante
 * (`audio-app.js`, `relleno`); esto es lo mismo para el micrófono, que llega
 * por la ventana.
 *
 * **Se mira el mínimo y no cada pedazo.** La deriva —reloj menos audio escrito—
 * sube sola cuando la ventana se traba un momento y los pedazos se encolan, y
 * baja cuando llegan todos juntos: eso no es audio perdido. Lo perdido no
 * vuelve, así que sube y se queda. El mínimo de una ventana de varios segundos
 * no ve las trabas —en algún momento de la ventana llegaron los encolados— y sí
 * ve lo perdido, que levanta todos los valores.
 *
 * Contra qué: el mínimo de la primera ventana, que es lo que tarda el audio en
 * llegar con esa entrada. Si después baja, esa es la nueva referencia.
 */

/** De cuánto es cada ventana en la que se busca el mínimo. */
const VENTANA_MS = 5000;

/** Lo que tiene que faltar para rellenar: menos es el ir y venir de los pedazos. */
const HUECO_MIN_MS = 150;

function nuevo() {
    return { base: null, minimo: Infinity, desdeMs: null };
}

/**
 * Una deriva más. Devuelve cuántos milisegundos de silencio hay que escribir
 * ahora para volver a la par, o 0.
 *
 * @param {object} a lo que devolvió `nuevo`, que se va actualizando
 * @param {number} derivaMs reloj transcurrido menos audio escrito
 * @param {number} ahoraMs el reloj
 */
function mirar(a, derivaMs, ahoraMs) {
    if (a.desdeMs == null) a.desdeMs = ahoraMs;
    a.minimo = Math.min(a.minimo, derivaMs);
    if (ahoraMs - a.desdeMs < VENTANA_MS) return 0;
    const minimo = a.minimo;
    a.minimo = Infinity;
    a.desdeMs = ahoraMs;
    if (a.base == null || minimo < a.base) {
        a.base = minimo;
        return 0;
    }
    const falta = minimo - a.base;
    return falta > HUECO_MIN_MS ? Math.round(falta) : 0;
}

module.exports = { nuevo, mirar, VENTANA_MS, HUECO_MIN_MS };
