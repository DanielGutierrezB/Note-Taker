/**
 * chrome.js — Lo mínimo que todas las pantallas necesitan del DOM.
 *
 * No es un framework y no quiere serlo: son cuatro funciones y un `$`. Lo que
 * dibuja cada pantalla es su archivo; lo de acá es lo que sería igual escrito
 * cinco veces.
 */

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/** Escapa lo que va adentro de un `innerHTML`. */
export function esc(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Muestra una de las vistas y esconde las demás.
 *
 * Las cuatro pantallas viven en el mismo HTML y se prenden y apagan con una
 * clase, en vez de armarse al entrar. Son pocas y livianas, y así el estado del
 * scroll y de un campo a medio escribir no se pierde al ir y volver — que en
 * medio de una clase es exactamente lo que no puede pasar.
 */
export function verVista(id) {
    for (const v of $$('.vista')) v.classList.toggle('es-activa', v.id === id);
}

/** Abre o cierra un panel flotante (Ajustes, Diagnóstico). */
export function verPanel(id, abierto) {
    const t = document.getElementById(id);
    if (t) t.classList.toggle('es-activa', abierto !== false);
}

let tostadaTimer = null;

/**
 * Un aviso que aparece y se va.
 *
 * Para lo que se confirma y no se decide: «XML guardado», «claqueta 4
 * anotada». Lo que hay que decidir no va acá — va en la pantalla, donde se
 * pueda leer sin apuro.
 */
export function avisar(texto, tono) {
    let t = $('.tostada');
    if (!t) {
        t = document.createElement('div');
        t.className = 'tostada';
        // Que un lector de pantalla lo diga: es por donde la app cuenta lo que
        // pasó solo (una toma que se abrió, un audio que se cayó).
        t.setAttribute('role', 'status');
        t.setAttribute('aria-live', 'polite');
        document.body.appendChild(t);
    }
    t.textContent = texto;
    t.dataset.tono = tono || 'normal';
    t.style.display = 'block';
    clearTimeout(tostadaTimer);
    // Cuatro segundos: lo que tarda en leerse una línea sin apuro. Un aviso que
    // se va antes de que lo leas es un aviso que no existió.
    tostadaTimer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}

/** Lo que el editor prefiere y no vale la pena guardar del lado de Node. */
export const pref = {
    leer(clave, siNo) {
        try {
            const v = localStorage.getItem(`nt.${clave}`);
            return v == null ? siNo : JSON.parse(v);
        } catch (e) {
            return siNo;
        }
    },
    guardar(clave, valor) {
        try { localStorage.setItem(`nt.${clave}`, JSON.stringify(valor)); } catch (e) { /* da igual */ }
    }
};
