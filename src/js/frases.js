'use strict';
/**
 * frases.js — «Frases que oye la app», en Ajustes.
 *
 * Tres listas —abrir, cerrar y cambiar de vista— y el interruptor de la cuenta.
 * Cada cambio se guarda al hacerlo, como todo en Ajustes, y si hay una clase
 * grabando el motor la oye con las nuevas desde la pasada siguiente
 * (`grabacion.cambiarFrases`). La copia de la ventana que marca las señales en
 * el transcript se pone al día en el mismo momento (`senales.usarFrases`).
 *
 * Quién decide qué entra es el motor (`engine/ajustes.js`, `frasesSanas`):
 * acá se manda lo que se quiere y se pinta lo que volvió. Si una frase no
 * volvió es porque ya estaba en otra lista, y eso se dice.
 */

import { $, esc } from './chrome.js';
import { usarFrases } from './grabar/senales.js';

/** Las vistas, con el nombre con que el equipo llama a cada plano (`notas-vivo.VISTAS`). */
export const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor' },
    { nombre: 'R', titulo: 'Pantalla' },
    { nombre: 'S', titulo: 'Slides' },
    { nombre: 'MG', titulo: 'Motion Graphics' },
    { nombre: 'X2', titulo: 'Acelerar' }
];

/** Las de fábrica, las mismas que `notas-vivo.FRASES_DE_FABRICA`. */
export const DE_FABRICA = { cuenta: true, abrir: ['retomamos'], cerrar: ['pausa', 'pause'], vista: [] };

const LISTAS = ['abrir', 'cerrar', 'vista'];

/** Cuántas entran en cada lista: `ajustes.FRASES_POR_LISTA`. */
const POR_LISTA = 20;

let guardar = null;
let actuales = DE_FABRICA;

/** Las palabras de una frase, como las compara el motor (`texto.norm`). */
function palabrasDe(frase) {
    return String(frase == null ? '' : frase).split(/\s+/).map(p => p
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')).filter(Boolean);
}

/** Si dos frases son la misma: pegadas, como las busca el reconocedor. */
const clave = frase => palabrasDe(frase).join('');

const textoDe = x => (typeof x === 'string' ? x : x.frase);

/**
 * @param {function} guardarAjustes el `guardar` de `app.js`: manda un parche y
 *   contesta `{ ok, ajustes }` con lo que el motor saneó
 */
export function conectar(guardarAjustes) {
    guardar = guardarAjustes;
    const caja = $('#aj-frases');
    $('#aj-frases-cuenta').addEventListener('change', e => cambiar({ ...actuales, cuenta: e.target.checked }));
    $('#aj-frases-fabrica').addEventListener('click', () => cambiar(DE_FABRICA, 'Volvieron las frases de fábrica.'));
    $('#aj-frase-vista').innerHTML = VISTAS.map(v =>
        `<option value="${v.nombre}">${v.nombre} · ${esc(v.titulo)}</option>`).join('');
    $('#aj-frase-vista').value = 'R';
    caja.addEventListener('click', e => {
        const quitar = e.target.closest('[data-frase-quitar]');
        if (quitar) return sacar(quitar.closest('[data-lista]').dataset.lista, Number(quitar.dataset.fraseQuitar));
        const agregarle = e.target.closest('[data-frase-agregar]');
        if (agregarle) agregar(agregarle.closest('[data-lista]').dataset.lista);
    });
    caja.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.matches('[data-frase-nueva]')) return;
        e.preventDefault();
        agregar(e.target.closest('[data-lista]').dataset.lista);
    });
}

/** Las frases que dicen los ajustes, en Ajustes y en las marcas del transcript. */
export function pintar(frases) {
    actuales = frases || DE_FABRICA;
    usarFrases(actuales);
    $('#aj-frases-cuenta').checked = actuales.cuenta !== false;
    for (const cual of LISTAS) {
        const lista = actuales[cual] || [];
        const fichas = $(`[data-lista="${cual}"] .frases-fichas`);
        fichas.innerHTML = lista.length
            ? lista.map((x, i) => `<span class="ficha">
                <span>${esc(textoDe(x))}</span>${cual === 'vista' ? `<span class="ficha-vista">${esc(x.vista)}</span>` : ''}
                <button class="ficha-quitar" type="button" data-frase-quitar="${i}"
                        aria-label="Sacar «${esc(textoDe(x))}»" title="Sacar «${esc(textoDe(x))}»">×</button>
              </span>`).join('')
            : '<span class="v3">Ninguna.</span>';
    }
}

/**
 * Un guardado a la vez: dos clics en × antes de que vuelva el primero
 * filtraban la misma lista vieja, y el segundo reponía lo que sacó el primero.
 */
let guardando = false;

async function cambiar(frases, siSale) {
    if (guardando) return null;
    guardando = true;
    try {
        const r = await guardar({ frases });
        if (!r || !r.ok) return null;
        pintar(r.ajustes.frases);
        if (siSale) decir(siSale);
        return r.ajustes.frases;
    } finally {
        guardando = false;
    }
}

function decir(texto) {
    $('#aj-frases-dice').textContent = texto || '';
}

function sacar(cual, i) {
    const lista = (actuales[cual] || []).filter((_x, j) => j !== i);
    cambiar({ ...actuales, [cual]: lista }, '');
}

async function agregar(cual) {
    const campo = $(`[data-lista="${cual}"] [data-frase-nueva]`);
    const frase = campo.value.replace(/\s+/g, ' ').trim();
    if (!clave(frase)) return;
    if ((actuales[cual] || []).length >= POR_LISTA) {
        decir(`Esta lista ya tiene ${POR_LISTA} frases: sacá una para agregar «${frase}».`);
        return;
    }
    const nueva = cual === 'vista' ? { frase, vista: $('#aj-frase-vista').value } : frase;
    const quedaron = await cambiar({ ...actuales, [cual]: (actuales[cual] || []).concat([nueva]) });
    if (!quedaron) return;
    campo.value = '';
    const entro = (quedaron[cual] || []).some(x => clave(textoDe(x)) === clave(frase));
    decir(entro ? advertencia(cual, frase) : `«${frase}» ya estaba en esta lista o en otra: una frase hace una sola cosa.`);
}

/**
 * Una frase de una sola palabra se acepta, pero se dice qué puede pasar: el
 * profesor la puede decir hablando de otra cosa. Para cerrar es menos grave,
 * porque una sola palabra cierra solo con un segundo de silencio detrás.
 */
export function advertencia(cual, frase) {
    if (palabrasDe(frase).length > 1) return '';
    if (cual === 'cerrar') {
        return `«${frase}» es una sola palabra: cierra solo si después hay un segundo de silencio, como «pausa».`;
    }
    const hace = cual === 'abrir' ? 'abre una toma' : 'cambia de vista (⌘Z lo deshace)';
    return `«${frase}» es una sola palabra: si el profesor la dice hablando de otra cosa, ${hace}.`;
}
