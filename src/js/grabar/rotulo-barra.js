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

/** Lo que el menú abierto está eligiendo, o null. */
let abierto = null;

/**
 * El rótulo, para meterlo en el HTML de una barra.
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
export function rotulo(r) {
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
 * @param {HTMLElement} boton el rótulo que se apretó
 * @param {Array} opciones [{ valor, dice, pista, marcada }]
 * @param {Function} alElegir recibe el valor; cerrar sin elegir no la llama
 */
export function abrir(boton, opciones, alElegir) {
    // Apretar el mismo rótulo otra vez lo cierra, que es lo que hace cualquier
    // menú y lo que uno prueba sin pensar.
    const mismo = abierto && abierto.boton === boton;
    cerrar();
    if (mismo) return;

    abierto = { boton, alElegir };
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
    const { boton } = abierto;
    abierto = null;
    const menu = $('#menu-barra');
    // Con el foco adentro, vaciar el menú lo dejaría en el `body`, y desde ahí
    // las teclas de la clase siguen andando de casualidad. Vuelve al rótulo,
    // que es de donde salió.
    if (document.activeElement && menu.contains(document.activeElement)) {
        if (boton.isConnected) boton.focus({ preventScroll: true });
    }
    if (boton.isConnected) boton.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    menu.innerHTML = '';
}

export function hay() {
    return Boolean(abierto);
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
    document.addEventListener('pointerdown', e => {
        if (!abierto) return;
        if (e.target.closest('#menu-barra') || e.target === abierto.boton) return;
        cerrar();
    });
    document.addEventListener('keydown', e => {
        if (!abierto || e.key !== 'Escape') return;
        // Antes que los telones: con un menú abierto, Escape cierra el menú.
        e.stopPropagation();
        cerrar();
    }, true);
}
