/**
 * tema.js — Cómo se ve la pantalla de la clase: el clásico o el nuevo.
 *
 * El nuevo no cambia lo que se puede hacer: es el mismo En vivo con el texto
 * grande y centrado, el tamaño a mano (A− / A+), la vista de cada toma en su
 * fila, la búsqueda en las tomas (⌘F) y la distribución vertical u horizontal.
 * Se elige arriba, al lado de la versión, y se puede volver al clásico en
 * cualquier momento: es para probarlo sin perder el de siempre. La
 * distribución es vertical (el texto arriba), u horizontal con el texto a la
 * izquierda (`horizontal-izquierda`) o a la derecha (`horizontal`).
 *
 * Vive en las preferencias de la ventana y no en los ajustes del motor: es cómo
 * se ve esta Mac, y el motor no lo mira nunca.
 */

import { $, pref } from './chrome.js';

const LETRA_MIN = 14;
const LETRA_MAX = 30;

export function esNuevo() {
    return pref.leer('tema', 'clasico') === 'nuevo';
}

export function distribucion() {
    return pref.leer('tema.distribucion', 'vertical');
}

export function letra() {
    return Math.max(LETRA_MIN, Math.min(LETRA_MAX, Number(pref.leer('tema.letra', 19)) || 19));
}

/** Pone en el documento lo que el CSS mira: la clase del tema, la distribución y la letra. */
export function aplicar() {
    const nuevo = esNuevo();
    document.body.classList.toggle('tema-nuevo', nuevo);
    const d = distribucion();
    document.body.classList.toggle('es-horizontal', nuevo && d !== 'vertical');
    document.body.classList.toggle('es-texto-izquierda', nuevo && d === 'horizontal-izquierda');
    document.body.style.setProperty('--letra-vivo', `${letra()}px`);
    for (const b of document.querySelectorAll('[data-tema]')) b.setAttribute('aria-pressed', String(b.dataset.tema === (nuevo ? 'nuevo' : 'clasico')));
    for (const b of document.querySelectorAll('[data-distribucion]')) b.setAttribute('aria-pressed', String(b.dataset.distribucion === distribucion()));
    const distribuciones = $('#distribuciones');
    if (distribuciones) distribuciones.hidden = !nuevo;
}

/** Dos pasos de letra para arriba o para abajo. */
export function cambiarLetra(paso) {
    pref.guardar('tema.letra', Math.max(LETRA_MIN, Math.min(LETRA_MAX, letra() + paso)));
    aplicar();
}

/** Los botones de la barra de arriba. `alCambiar` repinta lo que dependa del tema. */
export function conectar(alCambiar) {
    for (const b of document.querySelectorAll('[data-tema]')) {
        b.addEventListener('click', () => { pref.guardar('tema', b.dataset.tema); aplicar(); alCambiar(); });
    }
    for (const b of document.querySelectorAll('[data-distribucion]')) {
        b.addEventListener('click', () => { pref.guardar('tema.distribucion', b.dataset.distribucion); aplicar(); alCambiar(); });
    }
    aplicar();
}
