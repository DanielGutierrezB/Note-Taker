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
 */

import { $, avisar, verPanel } from './chrome.js';
import { icono } from './iconos.js';

let puesta = null;

export function conectar() {
    $('#btn-foto-cerrar').innerHTML = icono('cerrar');
    $('#btn-foto-copiar').addEventListener('click', copiar);
    $('#btn-foto-finder').addEventListener('click', () => {
        if (puesta) window.nt.reveal(puesta.ruta);
    });
}

/** @param {object} cual { ruta, toma } */
export async function abrir(cual) {
    if (!cual || !cual.ruta) return;
    const r = await window.nt.fotoAbrir(cual.ruta);
    if (!r.ok) {
        avisar(r.error, 'error');
        return;
    }
    puesta = { ruta: cual.ruta, toma: cual.toma };
    $('#foto-titulo').textContent = `Toma ${cual.toma} · la pantalla al poner el OUT`;
    const img = $('#foto-vista');
    img.src = r.imagen;
    img.alt = `La pantalla en el momento en que se puso el OUT de la toma ${cual.toma}`;
    $('#foto-dice').textContent = `${r.ancho}×${r.alto} · ${r.ruta}`;
    verPanel('telon-foto', true);
}

async function copiar() {
    if (!puesta) return;
    const r = await window.nt.fotoCopiar(puesta.ruta);
    avisar(r.ok
        ? 'La imagen quedó en el portapapeles: pegala donde la mandes.'
        : `No se pudo copiar: ${r.error}`, r.ok ? 'ok' : 'error');
}
