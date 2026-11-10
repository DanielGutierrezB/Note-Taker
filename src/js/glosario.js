'use strict';
/**
 * glosario.js — El glosario, el general y el del curso, en Ajustes y en Preparar.
 *
 * Las palabras que el modelo grande tiene que escribir bien al releer cada toma
 * y al regenerar: nombres de herramientas, de personas, siglas. El general vale
 * para todas las clases; el del curso se guarda en la carpeta del curso y viaja
 * con ella. Se suman, y si no entran todos el del curso tiene prioridad: el
 * contador dice cuánto se usa y qué quedó afuera.
 *
 * Se edita en dos sitios, Ajustes y Preparar, con el mismo marcado (bloques con
 * `data-glosario="general|delCurso"` y un `data-glosario-dice`): cada uno se
 * conecta una vez y todos se pintan juntos, así lo que se agrega en uno ya
 * está en el otro.
 *
 * Quién sanea, suma y guarda es el proceso principal (`ipc/grabar.js`,
 * `engine/glosario.js`): acá se manda lo que se quiere y se pinta lo que volvió.
 */

import { $, esc, avisar } from './chrome.js';

let carpeta = null;
let actual = null;
const cajas = [];

/** Conecta un sitio donde se edita el glosario: Ajustes o Preparar. */
export function conectar(donde) {
    const caja = $(donde || '#aj-glosario');
    if (!caja || cajas.includes(caja)) return;
    cajas.push(caja);
    caja.addEventListener('click', e => {
        const quitar = e.target.closest('[data-termino-quitar]');
        if (quitar) return sacar(quitar.closest('[data-glosario]').dataset.glosario, Number(quitar.dataset.terminoQuitar));
        const agregarle = e.target.closest('[data-termino-agregar]');
        if (agregarle) agregar(agregarle.closest('[data-glosario]'));
    });
    caja.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.matches('[data-termino-nuevo]')) return;
        e.preventDefault();
        agregar(e.target.closest('[data-glosario]'));
    });
    dibujar();
}

/** El glosario de esta carpeta, leído de nuevo: otra pantalla pudo cambiarlo. */
export async function pintar(deLaCarpeta) {
    carpeta = deLaCarpeta || null;
    if (!window.nt.glosarioLeer) return;
    actual = await window.nt.glosarioLeer(carpeta);
    dibujar();
}

const ficha = (x, i) => `<span class="ficha">
    <span>${esc(x)}</span>
    <button class="ficha-quitar" type="button" data-termino-quitar="${i}"
            aria-label="Sacar «${esc(x)}»" title="Sacar «${esc(x)}»">×</button>
  </span>`;

function dibujar() {
    if (!actual) return;
    const afuera = actual.afuera || [];
    for (const caja of cajas) {
        for (const cual of ['general', 'delCurso']) {
            const lista = actual[cual] || [];
            const bloque = caja.querySelector(`[data-glosario="${cual}"]`);
            if (!bloque) continue;
            bloque.querySelector('.frases-fichas').innerHTML = lista.length
                ? lista.map(ficha).join('') : '<span class="v3">Ninguna.</span>';
        }
        const delCurso = caja.querySelector('[data-glosario="delCurso"]');
        if (delCurso) {
            const rotulo = delCurso.querySelector('.rotulo');
            if (rotulo) {
                rotulo.textContent = carpeta ? `De este curso (${carpeta.split('/').pop()})` : 'De este curso';
                rotulo.title = carpeta
                    ? 'Se guarda en la carpeta del curso y viaja con ella.'
                    : 'Elegí la carpeta del curso para tener uno.';
            }
            for (const campo of delCurso.querySelectorAll('input, button')) campo.disabled = !carpeta;
        }
        const dice = caja.querySelector('[data-glosario-dice]');
        if (dice) {
            dice.textContent = `${actual.palabras} de ${actual.tope} palabras.`
                + (afuera.length ? ` No entran y quedan afuera: ${afuera.join(', ')}.` : '');
            dice.dataset.falta = afuera.length ? 'si' : '';
        }
    }
    const resumen = $('#aj-resumen-glosario');
    const n = (actual.entran || []).length;
    if (resumen) {
        resumen.textContent = n
            ? `${n} término${n === 1 ? '' : 's'}: ${(actual.delCurso || []).length} del curso y ${(actual.general || []).length} generales`
            : 'vacío';
    }
}

/** Un guardado a la vez, por lo mismo que en `frases.js`: dos × seguidas se pisaban. */
let guardando = false;

async function guardar(cambio) {
    if (guardando) return null;
    guardando = true;
    try {
        const r = await window.nt.glosarioGuardar({ carpeta, ...cambio });
        if (!r || !r.ok) {
            avisar(`No se pudo guardar el glosario: ${(r && r.error) || 'sin respuesta'}`, 'error');
            return null;
        }
        actual = r;
        dibujar();
        return r;
    } finally {
        guardando = false;
    }
}

function sacar(cual, i) {
    guardar({ [cual]: (actual[cual] || []).filter((_x, j) => j !== i) });
}

async function agregar(bloque) {
    const cual = bloque.dataset.glosario;
    const campo = bloque.querySelector('[data-termino-nuevo]');
    const nuevos = campo.value.split(',').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!nuevos.length) return;
    if (await guardar({ [cual]: (actual[cual] || []).concat(nuevos) })) campo.value = '';
}
