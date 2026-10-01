'use strict';
/**
 * panel-foto.js — La foto del OUT, en grande.
 *
 * La miniatura del bloque sirve para acordarse; esto es para mirar de verdad —
 * qué había en la pantalla del profesor, qué quedó a medias— y para mandarla.
 *
 * **«Copiar la imagen» y no «copiar el archivo».** Lo que sigue a este botón es
 * pegarla en el chat de la clase, así que va la imagen al portapapeles. Para lo
 * otro está «Mostrar en Finder», que es de donde se arrastra a cualquier parte.
 *
 * La imagen grande se pide recién al abrir (`fotoAbrir`): tenerlas todas en el
 * DOM serían varios megas de `data:` por clase, y la que se mira es una.
 *
 * **Y se puede ver al 100 %.** Entera cabe en el panel, que es cómo se mira qué
 * quedó a medias; para leer lo que decía la pantalla —un nombre de archivo, un
 * renglón de código— hace falta el tamaño de verdad, y en un monitor que no sea
 * Retina eso es el doble de lo que entra en el panel.
 */

import { $, avisar, verPanel } from './chrome.js';
import { icono } from './iconos.js';

let puesta = null;

export function conectar() {
    $('#btn-foto-cerrar').innerHTML = icono('cerrar');
    $('#btn-foto-copiar').addEventListener('click', copiar);
    const alternar = () => cien(!$('#foto-marco').classList.contains('es-cien'));
    $('#btn-foto-zoom').addEventListener('click', alternar);
    $('#foto-vista').addEventListener('click', alternar);
    $('#btn-foto-finder').addEventListener('click', () => {
        if (puesta) window.nt.reveal(puesta.ruta);
    });
}

/**
 * Entera o al 100 %.
 *
 * Entera cabe de una y es como se abre; al 100 % es para leer lo que había en
 * la pantalla, que es la mitad de para qué existe esta foto. El botón dice a
 * cuál se va, como todos los de esta app, y la imagen también lleva el gesto
 * porque es donde la mano va primero.
 */
function cien(puesto) {
    $('#foto-marco').classList.toggle('es-cien', puesto);
    const btn = $('#btn-foto-zoom');
    btn.textContent = puesto ? 'Que entre entera' : 'Ver al 100 %';
    btn.setAttribute('aria-pressed', String(puesto));
    if (!puesta) return;
    $('#foto-dice').textContent = `${puesta.ancho}×${puesta.alto} · clic en la imagen para `
        + `${puesto ? 'que entre entera' : 'verla al 100 %'} · ${puesta.ruta}`;
}

/** @param {object} cual { ruta, toma } */
export async function abrir(cual) {
    if (!cual || !cual.ruta) return;
    const r = await window.nt.fotoAbrir(cual.ruta);
    if (!r.ok) {
        avisar(r.error, 'error');
        return;
    }
    puesta = { ruta: cual.ruta, toma: cual.toma, ancho: r.ancho, alto: r.alto };
    $('#foto-titulo').textContent = `Toma ${cual.toma} · la pantalla al poner el OUT`;
    const img = $('#foto-vista');
    img.src = r.imagen;
    img.alt = `La pantalla en el momento en que se puso el OUT de la toma ${cual.toma}`;
    // Cada foto se abre entera, y el renglón de abajo dice el gesto y el tamaño.
    cien(false);
    verPanel('telon-foto', true);
}

async function copiar() {
    if (!puesta) return;
    const r = await window.nt.fotoCopiar(puesta.ruta);
    avisar(r.ok
        ? 'La imagen quedó en el portapapeles: pegala donde la mandes.'
        : `No se pudo copiar: ${r.error}`, r.ok ? 'ok' : 'error');
}
