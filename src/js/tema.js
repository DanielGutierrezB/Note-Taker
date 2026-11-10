/**
 * tema.js — Cómo se ve la pantalla de la clase: el clásico o el nuevo.
 *
 * El nuevo no cambia lo que se puede hacer: es el mismo En vivo con el texto
 * grande y centrado, el tamaño a mano (A− / A+), la vista de cada toma en su
 * fila, la búsqueda en las tomas (⌘F) y la distribución vertical u horizontal.
 * Se elige arriba, al lado de la versión, y se puede volver al clásico en
 * cualquier momento. Desde la 1.0.0 es el de fábrica: quien no eligió nada abre
 * con él. La distribución es vertical (el texto arriba), u horizontal con el
 * texto a la izquierda (`horizontal-izquierda`) o a la derecha (`horizontal`).
 *
 * Vive en las preferencias de la ventana y no en los ajustes del motor: es cómo
 * se ve esta Mac, y el motor no lo mira nunca.
 */

import { $, pref } from './chrome.js';
import { usarPaleta } from './colores.js';

/**
 * Los colores de vista que el tema nuevo cambia.
 *
 * El rojo de «Profesor» es la vista de casi todas las tomas, y una lista entera
 * de bloques rojos se lee densa y como si avisara algo. En el tema nuevo va
 * cerúleo, que es la etiqueta de Premiere con la que la cámara del profesor ya
 * llega al proyecto (`ETIQUETA_DE_VISTA` en `engine/prproj-plan.js`).
 */
const PALETA_NUEVA = { PV: '#2fbfde' };

/** El tema puesto, leído una vez por `aplicar` y no en cada fila que se dibuja. */
let nuevo = null;

const elegido = () => pref.leer('tema', 'nuevo') === 'nuevo';

export function esNuevo() {
    if (nuevo == null) nuevo = elegido();
    return nuevo;
}

export function distribucion() {
    return pref.leer('tema.distribucion', 'vertical');
}

/** Un tamaño de letra guardado, entre un mínimo y un máximo. */
function tamano(clave, min, max, deFabrica) {
    const leer = () => Math.max(min, Math.min(max, Number(pref.leer(clave, deFabrica)) || deFabrica));
    return {
        leer,
        cambiar(paso) {
            pref.guardar(clave, Math.max(min, Math.min(max, leer() + paso)));
            aplicar();
        }
    };
}

/** La de lo que se está diciendo, y la de las tomas, que agranda la lista sola. */
const deLoDicho = tamano('tema.letra', 14, 30, 19);
const deLasTomas = tamano('tema.letraTomas', 11, 24, 13);

export const letra = deLoDicho.leer;
export const cambiarLetra = deLoDicho.cambiar;
export const letraTomas = deLasTomas.leer;
export const cambiarLetraTomas = deLasTomas.cambiar;

/**
 * Pone en el documento lo que el CSS mira —la clase del tema, la distribución y
 * la letra— y en `colores.js` la paleta de las vistas. Va lo primero al
 * arrancar, antes de que se dibuje nada: si no, la ventana se ve un instante con
 * el otro tema.
 */
export function aplicar() {
    nuevo = elegido();
    usarPaleta(nuevo ? PALETA_NUEVA : {});
    document.body.classList.toggle('tema-nuevo', nuevo);
    const d = distribucion();
    document.body.classList.toggle('es-horizontal', nuevo && d !== 'vertical');
    document.body.classList.toggle('es-texto-izquierda', nuevo && d === 'horizontal-izquierda');
    document.body.style.setProperty('--letra-vivo', `${letra()}px`);
    document.body.style.setProperty('--letra-tomas', `${letraTomas()}px`);
    for (const b of document.querySelectorAll('[data-tema]')) b.setAttribute('aria-pressed', String(b.dataset.tema === (nuevo ? 'nuevo' : 'clasico')));
    for (const b of document.querySelectorAll('[data-distribucion]')) b.setAttribute('aria-pressed', String(b.dataset.distribucion === d));
    const distribuciones = $('#distribuciones');
    if (distribuciones) distribuciones.hidden = !nuevo;
}

/** Los botones de la barra de arriba. `alCambiar` repinta lo que dependa del tema. */
export function conectar(alCambiar) {
    for (const b of document.querySelectorAll('[data-tema]')) {
        b.addEventListener('click', () => { pref.guardar('tema', b.dataset.tema); aplicar(); alCambiar(); });
    }
    for (const b of document.querySelectorAll('[data-distribucion]')) {
        b.addEventListener('click', () => { pref.guardar('tema.distribucion', b.dataset.distribucion); aplicar(); alCambiar(); });
    }
}
