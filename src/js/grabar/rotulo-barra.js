'use strict';
/**
 * rotulo-barra.js — Un dato de la barra que además se puede cambiar ahí mismo.
 *
 * El idioma de la clase y la cámara de referencia se elegían en Ajustes y no
 * se veían en ninguna otra parte, y eso costaba dos cosas distintas:
 *
 *   · **no se veían.** Quien arranca una clase en inglés con el idioma en
 *     español no tiene cómo enterarse hasta leer el transcript, y para
 *     entonces la clase entera está traducida (ver `engine/idiomas.js`);
 *   · **y cambiarlas era irse de la pantalla.** Mientras se graba, abrir un
 *     panel encima de la lista de tomas es justo lo que no se quiere hacer.
 *
 * Así que son rótulos: dicen cómo está la cosa, y al apretarlos la cambian.
 * Viven en la barra, que es donde ya se miran el timecode y el nivel.
 *
 * **Está acá y no en una pantalla porque lo usan las dos**, igual que
 * `menu-de-palabra.js`: la clase y el vídeo de la semana tienen los dos un
 * idioma que cambiar. Y el menú vive fuera de la barra por lo mismo que aquel
 * vive fuera de la tarjeta: la tarjeta del vídeo semanal se rehace entera, y
 * un menú abierto adentro se lo llevaría puesto.
 */

import { $, esc } from '../chrome.js';
import { icono } from '../iconos.js';

/**
 * Lo que el menú abierto está eligiendo, o null.
 *
 * Guarda el id del rótulo y no el botón: el botón lo puede rehacer cualquier
 * repintado, y un menú colgado de un botón que ya no está en la página se ubica
 * contra una caja de cero —la esquina de arriba a la izquierda— y le devuelve
 * el foco a la nada. El id es el mismo antes y después.
 */
let abierto = null;

/** El rótulo del que cuelga el menú, el que esté en la página ahora. */
const suRotulo = () => (abierto ? document.getElementById(abierto.id) : null);

/**
 * Pone los rótulos en su caja y los mantiene al día EN SU LUGAR.
 *
 * Las barras se repintan solas —la de la clase cada 150 ms, para que el
 * timecode no se quede quieto— y rehacer el botón en cada vuelta lo cambiaba
 * por otro en medio del clic. El navegador solo da el clic por hecho si se
 * apretó y se soltó sobre el MISMO elemento, así que un clic de persona, que
 * tarda lo mismo que una vuelta, se perdía casi siempre: medido, 0 de 15.
 *
 * Así que el botón se hace una vez y después solo se le cambian el texto y los
 * atributos: cuando «Auto · ES» pasa a «Auto · EN» es el mismo botón diciendo
 * otra cosa, y un clic que caiga justo en ese momento agarra igual. Se rehacen
 * solo cuando cambia CUÁLES hay —una clase que termina se queda sin ellos—, y
 * entonces el menú que colgaba de uno se cierra, que ya no tiene de dónde.
 *
 * @param {HTMLElement} caja donde van los rótulos
 * @param {Array<object>} rotulos lo que recibe `rotulo`, en orden; [] la vacía
 */
export function pintar(caja, rotulos) {
    const cuales = rotulos.map(r => r.id).join(' ');
    if (caja.dataset.rotulos !== cuales) {
        if (caja.contains(suRotulo())) cerrar();
        caja.dataset.rotulos = cuales;
        caja.innerHTML = rotulos.map(rotulo).join('');
        return;
    }
    for (const r of rotulos) ponerAlDia(document.getElementById(r.id), r);
}

/** Lo que cambia de un rótulo, puesto en el botón que ya está. */
function ponerAlDia(boton, r) {
    boton.setAttribute('aria-label', `${r.que}: ${r.dice}`);
    boton.title = r.pista || '';
    if (r.avisa) boton.setAttribute('data-avisa', 'si');
    else boton.removeAttribute('data-avisa');
    ponerTexto(boton.querySelector('.rotulo-ancho'), r.dice);
    ponerTexto(boton.querySelector('.rotulo-angosto'), r.corto || r.dice);
}

function ponerTexto(nodo, texto) {
    if (nodo.textContent !== texto) nodo.textContent = texto;
}

/**
 * El HTML de un rótulo, la primera vez que entra en su caja.
 *
 * @param {object} r { id, hace, que, icono, dice, corto, pista, avisa }
 *   `que` es de qué es el rótulo —«Idioma», «Cámara»— y `dice` cómo está. Sin
 *   el `que`, «Auto» a secas no contesta de qué habla: eso fue lo primero que
 *   se preguntó al verlo en la barra. Va escrito cuando hay lugar, y cuando no
 *   lo dice el icono, que es el mismo concepto en 16 px.
 *   `corto` es lo que se ve con la ventana en su ancho mínimo, donde esta
 *   barra no tiene un píxel de sobra: se dice acá y no se recorta con puntos
 *   suspensivos porque lo que importa está al final —«Auto · ES»— y cortar por
 *   la derecha se come justamente el idioma. Sin él se usa `dice`.
 *   `avisa` lo pinta en ámbar: es para «lo tenés en español y suena a inglés»,
 *   que no es un error —se puede estar citando— pero hay que poder verlo de
 *   reojo sin leer el tooltip.
 *
 * El nombre accesible lo pone `aria-label` y no el texto de adentro: con la
 * palabra escondida a ventana chica, lo que se lee en voz alta sería «ES».
 */
function rotulo(r) {
    return `<button class="rotulo-barra" type="button" id="${esc(r.id)}"
            data-hace="${esc(r.hace)}" aria-haspopup="menu" aria-expanded="false"
            ${r.avisa ? 'data-avisa="si"' : ''}
            aria-label="${esc(r.que)}: ${esc(r.dice)}"
            title="${esc(r.pista || '')}"
        >${icono(r.icono)}<span class="rotulo-que">${esc(r.que)}:</span
        ><span class="rotulo-ancho">${esc(r.dice)}</span
        ><span class="rotulo-angosto">${esc(r.corto || r.dice)}</span></button>`;
}

/**
 * Abre el menú de un rótulo.
 *
 * Se ubica contra el rótulo que está en la página AHORA, buscado por su id, y
 * no contra el que se apretó: la lista de cámaras se espera antes de abrir, y
 * en esa espera el rótulo se pudo redibujar.
 *
 * @param {string} id el del rótulo que se apretó
 * @param {Array} opciones [{ valor, dice, pista, marcada }]
 * @param {Function} alElegir recibe el valor; cerrar sin elegir no la llama
 */
export function abrir(id, opciones, alElegir) {
    // Apretar el mismo rótulo otra vez lo cierra, que es lo que hace cualquier
    // menú y lo que uno prueba sin pensar.
    const mismo = abierto && abierto.id === id;
    cerrar();
    const boton = document.getElementById(id);
    if (mismo || !boton) return;

    abierto = { id, alElegir };
    boton.setAttribute('aria-expanded', 'true');
    const menu = $('#menu-barra');
    menu.innerHTML = opciones.map(o => `<button class="menu-fila" type="button" role="menuitem"
            data-valor="${esc(o.valor)}" title="${esc(o.pista || '')}"
            ${o.marcada ? 'aria-checked="true" data-marcada="si"' : ''}>
            <span class="hp-ico">${o.marcada ? icono('ok') : ''}</span>${esc(o.dice)}</button>`).join('');
    menu.hidden = false;

    // Debajo del rótulo y alineado con él, y contra el borde derecho se corre
    // hacia adentro: la barra llega hasta el borde de la ventana.
    const caja = boton.getBoundingClientRect();
    const mio = menu.getBoundingClientRect();
    const margen = 8;
    const izq = Math.max(margen, Math.min(caja.left, window.innerWidth - mio.width - margen));
    const arr = caja.bottom + mio.height + margen > window.innerHeight
        ? Math.max(margen, caja.top - mio.height - 4)
        : caja.bottom + 4;
    menu.style.left = `${Math.round(izq)}px`;
    menu.style.top = `${Math.round(arr)}px`;
    const marcada = menu.querySelector('[data-marcada]') || menu.querySelector('.menu-fila');
    if (marcada) marcada.focus({ preventScroll: true });
}

export function cerrar() {
    if (!abierto) return;
    const boton = suRotulo();
    abierto = null;
    const menu = $('#menu-barra');
    // Con el foco adentro, vaciar el menú lo dejaría en el `body`, y desde ahí
    // las teclas de la clase siguen andando de casualidad. Vuelve al rótulo,
    // que es de donde salió.
    if (boton && document.activeElement && menu.contains(document.activeElement)) {
        boton.focus({ preventScroll: true });
    }
    if (boton) boton.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    menu.innerHTML = '';
}

/**
 * Se conecta una vez, al arrancar la app.
 *
 * El clic de afuera y el Escape cierran, como en cualquier menú. Se escucha en
 * el documento y no en el menú porque lo que hay que atrapar es justamente lo
 * que pasa fuera de él.
 */
export function conectar() {
    const menu = $('#menu-barra');
    menu.addEventListener('click', e => {
        const fila = e.target.closest('.menu-fila');
        if (!fila || !abierto) return;
        const { alElegir } = abierto;
        const valor = fila.dataset.valor;
        cerrar();
        alElegir(valor);
    });
    // Con `contains` y no con `===`: el rótulo tiene icono y texto adentro, y
    // apretarlo sobre ellos es apretarlo. Comparando el objetivo exacto, eso
    // cerraba el menú acá y el clic lo volvía a abrir en el acto.
    document.addEventListener('pointerdown', e => {
        if (!abierto) return;
        const rotulo = suRotulo();
        if (e.target.closest('#menu-barra') || (rotulo && rotulo.contains(e.target))) return;
        cerrar();
    });
    // Con el menú abierto el teclado es del menú, y se escucha en la captura
    // para llegar antes que cualquier pantalla: en el vídeo semanal, una letra
    // de vista con el menú abierto le cambiaba la vista a una toma que no se
    // estaba mirando. Escape lo cierra —antes que los telones— y las flechas
    // van de una opción a otra. Enter y espacio siguen hasta el botón con foco,
    // que es lo que lo aprieta, pero la pantalla no se entera; el Tab es del
    // navegador.
    document.addEventListener('keydown', e => {
        if (!abierto || e.key === 'Tab') return;
        e.stopPropagation();
        if (e.key === 'Escape') { cerrar(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const filas = [...menu.querySelectorAll('.menu-fila')];
            const i = filas.indexOf(document.activeElement);
            const paso = e.key === 'ArrowDown' ? 1 : -1;
            const cual = filas[(Math.max(0, i) + paso + filas.length) % filas.length];
            if (cual) cual.focus({ preventScroll: true });
        }
    }, true);
}
