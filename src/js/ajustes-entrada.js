'use strict';
/**
 * ajustes-entrada.js — La entrada de audio, elegible desde Ajustes.
 *
 * Es la misma elección que hay en Preparar y en el rótulo Audio de la barra, y
 * va por la misma puerta según dónde se esté:
 *
 *   · con una clase grabando, cambia la entrada como el rótulo Audio (el motor
 *     abre otro WAV y la toma abierta se parte donde corresponde);
 *   · con Preparar delante, abre la entrada como su renglón, que es lo que la
 *     pantalla de atrás muestra;
 *   · en cualquier otro lado, queda guardada y Preparar la abre la próxima vez.
 *
 * El botón de al lado le vuelve a preguntar al sistema qué entradas hay: es el
 * gesto de quien acaba de enchufar un micrófono, o de abrir Zoom, y no lo ve.
 *
 * Debajo va el medidor, el mismo de Preparar: si no hay ninguna entrada
 * abierta, Ajustes abre la elegida mientras está a la vista, para que se
 * pueda ver si llega señal sin ir a Preparar (`preparar.escucharParaAjustes`).
 */

import { $, esc, avisar } from './chrome.js';
import { icono } from './iconos.js';
import * as preparar from './pantalla-preparar.js';
import * as vivo from './pantalla-vivo.js';
import { sinPrefijoDelSistema } from './grabar/fuente.js';

let app = null;
let lista = [];

export function conectar(contexto) {
    app = contexto;
    $('#aj-entrada-buscar').innerHTML = icono('regenerar');
    $('#aj-entrada-buscar').addEventListener('click', () => pintar(true));
    $('#aj-entrada').addEventListener('change', e => elegir(e.target.value));
    preparar.alCambiarElAudio(pintarEstado);
}

/** Empieza a medir la entrada elegida, si nadie la tiene abierta. */
export async function escuchar() {
    if (!await window.nt.grabarEstado()) await preparar.escucharParaAjustes();
    pintarEstado(preparar.estadoDelAudio());
}

/** Al cerrar Ajustes: suelta la entrada si la abrió el medidor. */
export function soltar() {
    return preparar.soltarDeAjustes();
}

/** La pastilla del medidor: la palabra, y en el hover el porqué. */
function pintarEstado(a) {
    const pastilla = $('#aj-entrada-estado');
    if (!pastilla) return;
    const abierta = Boolean(preparar.entradaAbierta());
    pastilla.hidden = !abierta && !a.porque;
    pastilla.dataset.estado = a.clave;
    pastilla.textContent = a.palabra;
    pastilla.title = a.porque || '';
}

const enPreparar = () => $('#vista-preparar').classList.contains('es-activa');

/** La que se ve elegida: la abierta, o la que quedó guardada en Ajustes. */
function laElegida() {
    return preparar.entradaAbierta() || app.ajustes.dispositivo || '';
}

export async function pintar(aMano) {
    const select = $('#aj-entrada');
    const boton = $('#aj-entrada-buscar');
    if (aMano) {
        boton.disabled = true;
        $('#aj-entrada-dice').textContent = 'Buscando entradas…';
    }
    try {
        lista = await preparar.entradasParaElegir();
    } finally {
        boton.disabled = false;
    }
    const guardada = laElegida();
    const nombres = lista.map(d => d.dice);
    const elegida = nombres.includes(guardada) ? guardada : (nombres.includes(sinPrefijoDelSistema(guardada))
        ? sinPrefijoDelSistema(guardada) : guardada);
    const falta = elegida && !nombres.includes(elegida);
    select.innerHTML = (elegida ? '' : '<option value="">Elegí una entrada…</option>')
        + lista.map(d => `<option value="${esc(d.valor)}" ${d.dice === elegida ? 'selected' : ''}>${esc(d.dice)}</option>`).join('')
        + (falta ? `<option value="" selected>${esc(elegida)} (no está conectada)</option>` : '');
    const cual = lista.find(d => d.dice === elegida);
    $('#aj-entrada-dice').textContent = cual
        ? cual.pista
        : (falta ? `${elegida} no aparece: conectala y apretá el botón de al lado.` : 'Ninguna elegida todavía.');
    if (aMano) $('#aj-entrada-dice').textContent = `${lista.length} entrada${lista.length === 1 ? '' : 's'} encontrada${lista.length === 1 ? '' : 's'}. `
        + $('#aj-entrada-dice').textContent;
    resumen();
}

async function elegir(id) {
    const entrada = lista.find(d => d.valor === id);
    if (!entrada) return;
    $('#aj-entrada').disabled = true;
    try {
        if (await window.nt.grabarEstado()) {
            await vivo.cambiarEntrada(id);
        } else if (enPreparar()) {
            const r = await preparar.elegirEntrada(id);
            if (!r.ok) avisar(r.error, 'error');
        } else {
            const r = await window.nt.ajustesGuardar({ dispositivo: entrada.dice });
            if (r.ok) app.ajustes = r.ajustes;
            await preparar.escucharParaAjustes(true);
        }
    } finally {
        $('#aj-entrada').disabled = false;
    }
    await pintar(false);
}

/** El renglón de la sección cerrada: con qué se graba y de qué cámara sale la foto. */
export function resumen() {
    const entrada = laElegida() || 'sin entrada';
    const camara = app.ajustes.camara || 'sin cámara';
    $('#aj-resumen-fuentes').textContent = `${entrada} · ${camara}`;
}
