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

/** Desde dónde se abrió cada panel, para devolverle el foco al cerrarlo. */
const abiertoDesde = new Map();

/**
 * Abre o cierra un panel flotante (Ajustes, Diagnóstico, Crear proyecto…).
 *
 * **Abierto, el teclado es suyo.** El panel tapa la pantalla, pero el foco
 * seguía en el botón que lo abrió y Tab recorría lo de atrás: catorce paradas
 * en controles que no se ven antes de llegar a uno del panel. Ahora el foco
 * entra al panel, lo de atrás queda inerte —ni Tab ni lector de pantalla
 * llegan—, y al cerrar vuelve a donde estaba.
 */
export function verPanel(id, abierto) {
    const t = document.getElementById(id);
    if (!t) return;
    const abrir = abierto !== false;
    const estaba = t.classList.contains('es-activa');
    t.classList.toggle('es-activa', abrir);
    if (abrir === estaba) return;
    if (abrir) {
        abiertoDesde.set(id, document.activeElement);
        const panel = t.querySelector('.panel') || t;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        dejarElFondo(true);
        panel.focus({ preventScroll: true });
        return;
    }
    const desde = abiertoDesde.get(id);
    abiertoDesde.delete(id);
    const otro = [...document.querySelectorAll('.telon.es-activa')].pop();
    dejarElFondo(Boolean(otro));
    devolverElFoco(desde, otro);
}

/** Lo que queda detrás de un panel: la barra de arriba y las pantallas. */
function dejarElFondo(inerte) {
    for (const el of document.querySelectorAll('.topbar, .vista')) el.inert = inerte;
}

/**
 * A dónde va el foco al cerrar un panel: al panel que quede abierto debajo; si
 * no hay, a la pantalla si es de las que se llevan el teclado —la de la clase,
 * donde Enter abre y cierra tomas y no puede quedar en un botón—; y si no, a lo
 * que tenía el foco al abrir.
 */
function devolverElFoco(desde, otroPanel) {
    const sirve = el => el && el.isConnected && typeof el.focus === 'function';
    if (otroPanel) {
        const destino = sirve(desde) && otroPanel.contains(desde) ? desde : otroPanel.querySelector('.panel') || otroPanel;
        destino.focus({ preventScroll: true });
        return;
    }
    const pantalla = document.querySelector('.vista.es-activa');
    if (pantalla && pantalla.hasAttribute('tabindex')) pantalla.focus({ preventScroll: true });
    else if (sirve(desde) && desde !== document.body) desde.focus({ preventScroll: true });
}

let tostadaTimer = null;

/**
 * Un aviso que aparece y se va.
 *
 * Para lo que se confirma y no se decide: «XML guardado», «toma 4
 * cerrada». Lo que hay que decidir no va acá — va en la pantalla, donde se
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
