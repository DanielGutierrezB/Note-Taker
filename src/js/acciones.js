/**
 * acciones.js — Cada gesto de la ventana, anotado en el diario.
 *
 * Lo pidió el editor: que toda acción deje su rastro, para que un reporte
 * (el botón «Report») cuente qué se hizo hasta que algo salió mal sin tener que
 * preguntarlo. Lo que pasó del lado del motor lo anota `ipc/con-diario.js`, y
 * esto anota la otra mitad: qué apretó la persona, en qué pantalla, y con qué
 * tecla. Juntas, el diario se lee como un relato: «apretó Dividir acá en la
 * toma 3, el motor partió, la ventana pidió el montaje».
 *
 * Se escucha en la fase de captura y en el documento entero, así que no hace
 * falta que cada pantalla se acuerde de anotar: un botón nuevo queda anotado sin
 * tocar nada.
 *
 * **Lo que se escribe no se anota.** De un campo de texto queda que cambió y
 * cuánto mide, no qué dice: un comentario o un nombre de clase no le hacen falta
 * a nadie para entender un fallo, y un diario que se puede mandar sin leerlo se
 * manda.
 */

const TEXTO_MAX = 40;

/** La pantalla que se está viendo: la vista activa del documento. */
function pantalla() {
    const activa = document.querySelector('.vista.es-activa');
    return activa ? activa.id : null;
}

const esCampoDeTexto = el => Boolean(el) && (el.isContentEditable
    || el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type)));

/**
 * Cómo se llama lo que se tocó: lo que hace, su id, o lo que dice.
 *
 * `data-hace` primero porque es el nombre que la app le da a la acción, y es el
 * que se busca en el código. Los demás `data-*` dicen sobre qué: la toma, la
 * vista, el borde.
 */
export function describir(el) {
    const datos = { ...(el.dataset || {}) };
    const dice = (el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '';
    return {
        que: datos.hace || el.id || null,
        dice: dice.replace(/\s+/g, ' ').trim().slice(0, TEXTO_MAX) || null,
        datos: Object.keys(datos).length ? datos : null
    };
}

/** Lo que se puede tocar: el botón, el enlace o la opción que envuelve al clic. */
const tocable = destino => destino && destino.closest
    && destino.closest('button, a, summary, label, [data-hace], [role="button"], [role="menuitem"]');

/**
 * Empieza a anotar. Una sola vez, al arrancar la ventana.
 *
 * @param {(evento: string, datos: object) => void} anotar
 */
export function anotarLosGestos(anotar) {
    document.addEventListener('click', e => {
        const el = tocable(e.target);
        if (!el) return;
        anotar('ui.clic', { pantalla: pantalla(), ...describir(el), derecho: e.button === 2 || undefined });
    }, true);

    document.addEventListener('contextmenu', e => {
        const el = e.target && e.target.closest && e.target.closest('[data-t], [data-hace], button');
        if (!el) return;
        anotar('ui.clic-derecho', { pantalla: pantalla(), ...describir(el) });
    }, true);

    document.addEventListener('change', e => {
        const el = e.target;
        if (!el || !el.tagName) return;
        const campo = (el.dataset && el.dataset.campo) || el.id || el.name || el.tagName.toLowerCase();
        const valor = esCampoDeTexto(el)
            ? { largo: String(el.value || '').length }
            : { valor: el.type === 'checkbox' ? el.checked : el.value };
        anotar('ui.cambio', { pantalla: pantalla(), campo, ...valor });
    }, true);

    document.addEventListener('keydown', e => {
        if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
        // Escribiendo en un campo, las teclas son texto y no gestos.
        if (esCampoDeTexto(e.target) && !e.metaKey && !e.ctrlKey && e.key !== 'Escape' && e.key !== 'Enter') return;
        const con = [e.metaKey && '⌘', e.ctrlKey && '⌃', e.altKey && '⌥', e.shiftKey && '⇧'].filter(Boolean).join('');
        anotar('ui.tecla', { pantalla: pantalla(), tecla: `${con}${e.key}` });
    }, true);

    // Y lo que se rompe en la ventana, que hasta ahora solo se veía en el
    // inspector: del lado de Node ya se anotaba (`uncaughtException` en `main.js`).
    window.addEventListener('error', e => {
        anotar('ventana.error', { pantalla: pantalla(), mensaje: e.message, donde: e.filename, linea: e.lineno });
    });
    window.addEventListener('unhandledrejection', e => {
        const r = e.reason;
        anotar('ventana.error.promesa', { pantalla: pantalla(), mensaje: r && r.message ? r.message : String(r) });
    });
}
