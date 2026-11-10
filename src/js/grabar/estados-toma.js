/**
 * estados-toma.js — Mantener, Desactivar y Descartar.
 *
 * Son los tres estados que puede tener una toma, y van en un solo control
 * porque son excluyentes:
 *
 *   Mantener     cuenta (lo de siempre)
 *   Desactivar   no cuenta, pero sigue en la sesión y se vuelve a mantener
 *   Descartar    sale de la sesión; se deshace con ⌘Z
 *
 * Los tres estados son del motor, no de la pantalla, y por eso viven en un
 * módulo que se puede importar sin documento y probar por lo que devuelve.
 *
 * Descartar aparece solo donde se puede deshacer. Es lo que lo hace seguro:
 * no pregunta, igual que el resto de esta app, y lo que evita el accidente es
 * el historial. Donde no hay historial —una sesión ya cerrada, que se relee
 * del archivo en cada gesto— un botón que borra sin vuelta atrás no es el
 * mismo botón, aunque se llame igual.
 */

import { icono } from '../iconos.js';

/**
 * Qué le pide al motor cada uno de los tres botones.
 *
 * Está acá con los botones porque el vocabulario del motor es una trampa: su
 * `tipo: 'descartar'` es lo que acá se llama Desactivar —la toma queda, pero
 * no cuenta— y lo que acá se llama Descartar es su `eliminar`. Traducido en
 * cada pantalla, un día una lo traduce al revés.
 *
 * @param {string} hace el `data-hace` del botón
 * @returns {object|null} el cambio, sin la toma; `null` si no es de estos
 */
export function cambioDe(hace) {
    switch (hace) {
        case 'mantener': return { tipo: 'descartar', descartada: false };
        case 'desactivar': return { tipo: 'descartar', descartada: true };
        case 'descartar': return { tipo: 'eliminar' };
        default: return null;
    }
}

/**
 * Los tres botones, o dos si no hay con qué deshacer.
 *
 * @param {object} t la toma
 * @param {object} [o]
 * @param {boolean} [o.sePuedeDeshacer] si no, Descartar no se ofrece
 */
export function estadosDe(t, o) {
    const activa = !t.descartada;
    const descartar = !o || o.sePuedeDeshacer !== false;
    return `<span class="estados-toma" role="group" aria-label="Estado de la toma ${t.id}">
      <button class="btn btn-tenue" type="button" data-hace="mantener" data-toma="${t.id}"
              aria-pressed="${activa}" title="Va al XML">Mantener</button>
      <button class="btn btn-tenue" type="button" data-hace="desactivar" data-toma="${t.id}"
              aria-pressed="${!activa}"
              title="No va al XML, pero sigue acá: con Mantener vuelve">Desactivar</button>
      ${descartar ? `<button class="btn btn-tenue" type="button" data-hace="descartar" data-toma="${t.id}"
              title="La saca de la sesión. Se deshace con ⌘Z">${icono('descartar')} Descartar</button>` : ''}
    </span>`;
}
