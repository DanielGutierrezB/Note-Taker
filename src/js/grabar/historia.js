/**
 * historia.js — Deshacer y rehacer, los mismos en las dos pantallas.
 *
 * La pila vive en el motor (`engine/deshacer.js`) y es una por sesión, así que
 * la clase y el vídeo de la semana la usan igual: la misma tecla, el mismo
 * aviso y la misma forma de decir qué se va a deshacer. Lo único que cambia es
 * dónde guarda cada pantalla el estado que vuelve, y por eso es un parámetro.
 */

import { avisar } from '../chrome.js';

/** ⌘Z o Ctrl+Z, con o sin ⇧: la tecla del historial. */
export const esDeshacer = e => Boolean(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';

/** Lo que dice el botón: qué va a deshacer, o que no hay nada. */
export function tituloDe(hay, que, verbo) {
    return hay ? `${verbo} «${que}»` : `No hay nada que ${verbo.toLowerCase()}`;
}

/** El aviso de una toma que salió de la sesión: dice cómo traerla de vuelta. */
export const avisoDeDescarte = id => `Toma ${id} descartada. ⌘Z la devuelve.`;

/**
 * Deshacer o rehacer un paso, y avisar qué se hizo.
 *
 * @param {'deshacer'|'rehacer'} cual
 * @param {function} alEstado recibe el estado nuevo de la sesión, si vino
 */
export async function volver(cual, alEstado) {
    let r = null;
    try {
        r = cual === 'deshacer' ? await window.nt.grabarDeshacer() : await window.nt.grabarRehacer();
    } catch (e) {
        avisar(`No se pudo ${cual}: ${e.message}`, 'error');
    }
    if (!r) return;
    if (r.estado) alEstado(r.estado);
    if (r.error) avisar(r.error, 'error');
    else if (r.ok) avisar(`${cual === 'deshacer' ? 'Deshecho' : 'Rehecho'}: ${r.que}`);
}
