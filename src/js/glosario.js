'use strict';
/**
 * glosario.js — El glosario, en Ajustes: el general y el del curso.
 *
 * Las palabras que el modelo grande tiene que escribir bien al releer cada toma
 * y al regenerar: nombres de herramientas, de personas, siglas. El general vale
 * para todas las clases; el del curso se guarda en la carpeta del curso y viaja
 * con ella. Se suman, y si no entran todos el del curso tiene prioridad: el
 * contador dice cuánto se usa y qué quedó afuera.
 *
 * Quién sanea, suma y guarda es el proceso principal (`ipc/grabar.js`,
 * `engine/glosario.js`): acá se manda lo que se quiere y se pinta lo que volvió.
 */

import { $, esc, avisar } from './chrome.js';

let carpeta = null;
let actual = null;

const LISTAS = { general: '#aj-glosario-general', delCurso: '#aj-glosario-curso' };

export function conectar() {
    const caja = $('#aj-glosario');
    caja.addEventListener('click', e => {
        const quitar = e.target.closest('[data-termino-quitar]');
        if (quitar) return sacar(quitar.closest('[data-glosario]').dataset.glosario, Number(quitar.dataset.terminoQuitar));
        const agregarle = e.target.closest('[data-termino-agregar]');
        if (agregarle) agregar(agregarle.closest('[data-glosario]').dataset.glosario);
    });
    caja.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.matches('[data-termino-nuevo]')) return;
        e.preventDefault();
        agregar(e.target.closest('[data-glosario]').dataset.glosario);
    });
}

/** El glosario de esta carpeta, leído de nuevo: otra pantalla pudo cambiarlo. */
export async function pintar(deLaCarpeta) {
    carpeta = deLaCarpeta || null;
    if (!window.nt.glosarioLeer) return;
    actual = await window.nt.glosarioLeer(carpeta);
    dibujar();
}

function dibujar() {
    if (!actual) return;
    for (const [cual, donde] of Object.entries(LISTAS)) {
        const lista = actual[cual] || [];
        $(`${donde} .frases-fichas`).innerHTML = lista.length
            ? lista.map((x, i) => `<span class="ficha">
                <span>${esc(x)}</span>
                <button class="ficha-quitar" type="button" data-termino-quitar="${i}"
                        aria-label="Sacar «${esc(x)}»" title="Sacar «${esc(x)}»">×</button>
              </span>`).join('')
            : '<span class="v3">Ninguna.</span>';
    }
    const delCurso = $(LISTAS.delCurso);
    delCurso.querySelector('.rotulo').textContent = carpeta
        ? `De este curso (${carpeta.split('/').pop()}): se guarda en su carpeta y viaja con ella`
        : 'De este curso: elegí la carpeta del curso para tener uno';
    for (const campo of delCurso.querySelectorAll('input, button')) campo.disabled = !carpeta;
    const afuera = actual.afuera || [];
    $('#aj-glosario-dice').textContent = `${actual.palabras} de ${actual.tope} palabras.`
        + (afuera.length ? ` No entran y quedan afuera: ${afuera.join(', ')}.` : '');
    $('#aj-glosario-dice').dataset.falta = afuera.length ? 'si' : '';
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

async function agregar(cual) {
    const campo = $(`${LISTAS[cual]} [data-termino-nuevo]`);
    const nuevos = campo.value.split(',').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!nuevos.length) return;
    if (await guardar({ [cual]: (actual[cual] || []).concat(nuevos) })) campo.value = '';
}
