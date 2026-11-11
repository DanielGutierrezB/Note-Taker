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
import { estiloDeVista } from './colores.js';
import { usarFrases } from './grabar/senales.js';

/**
 * Las vistas, con el nombre con que el equipo llama a cada plano y su color de
 * marcador: los mismos que `notas-vivo.VISTAS`, que una prueba compara. Cada
 * fila de «Cambiar de vista» va pintada del color con que esa vista se ve en la
 * clase y llega a Premiere.
 */
export const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor', colorDeMarcador: 4281740498 },
    { nombre: 'R', titulo: 'Pantalla', colorDeMarcador: 4280578025 },
    { nombre: 'S', titulo: 'Slides', colorDeMarcador: 4281828977 },
    { nombre: 'MG', titulo: 'Motion Graphics', colorDeMarcador: 4294345275 },
    { nombre: 'X2', titulo: 'Acelerar', colorDeMarcador: 4289825711 }
];

/** Las de fábrica, las mismas que `notas-vivo.FRASES_DE_FABRICA`. */
export const DE_FABRICA = { cuenta: true, abrir: ['retomamos'], cerrar: ['pausa', 'pause'], vista: [] };

const LISTAS = ['abrir', 'cerrar'];

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
    armarVistas();
    const donde = el => {
        const fila = el.closest('[data-lista]');
        return { cual: fila.dataset.lista, vista: fila.dataset.vista || null };
    };
    caja.addEventListener('click', e => {
        const quitar = e.target.closest('[data-frase-quitar]');
        if (quitar) return sacar(donde(quitar).cual, Number(quitar.dataset.fraseQuitar));
        const agregarle = e.target.closest('[data-frase-agregar]');
        if (agregarle) agregar(donde(agregarle));
    });
    caja.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.matches('[data-frase-nueva]')) return;
        e.preventDefault();
        agregar(donde(e.target));
    });
}

/**
 * Una fila por vista, cada una con su color, sus frases y su campo: así se
 * ve de un vistazo qué vista no tiene frase, y agregar una no pide elegir.
 * Se arma una sola vez, la primera que alguien la necesita: `app.js` pinta las
 * frases al arrancar, antes de conectar Ajustes.
 */
function armarVistas() {
    const caja = $('#aj-frases-vistas');
    if (caja.children.length) return;
    caja.innerHTML = VISTAS.map(v => `
        <div class="frases-vista" data-lista="vista" data-vista="${v.nombre}" style="${estiloDeVista(VISTAS, v.nombre)}">
          <div class="frases-vista-quien">
            <span class="frases-sigla">${v.nombre}</span>
            <span class="frases-vista-nombre">${esc(v.titulo)}</span>
          </div>
          <div class="frases-vista-cuerpo">
            <div class="frases-fichas"></div>
            <div class="campo-fila">
              <input type="text" maxlength="60" data-frase-nueva
                     aria-label="Una frase que pasa a ${esc(v.titulo)}"
                     placeholder="Una frase que pasa a ${esc(v.titulo)}">
              <button class="btn" type="button" data-frase-agregar
                      title="Sumar la frase que escribiste. También con Enter">Agregar</button>
            </div>
          </div>
        </div>`).join('');
}

const ficha = (texto, i) => `<span class="ficha">
    <span>${esc(texto)}</span>
    <button class="ficha-quitar" type="button" data-frase-quitar="${i}"
            aria-label="Sacar «${esc(texto)}»" title="Sacar «${esc(texto)}»">×</button>
  </span>`;

/** Las frases que dicen los ajustes, en Ajustes y en las marcas del transcript. */
export function pintar(frases) {
    actuales = frases || DE_FABRICA;
    usarFrases(actuales);
    armarVistas();
    $('#aj-frases-cuenta').checked = actuales.cuenta !== false;
    const ninguna = '<span class="v3">Ninguna.</span>';
    for (const cual of LISTAS) {
        const lista = actuales[cual] || [];
        $(`[data-lista="${cual}"] .frases-fichas`).innerHTML = lista.length ? lista.map(ficha).join('') : ninguna;
    }
    // Las de vista van todas en una lista (`frases.vista`); cada fila muestra
    // las suyas con su número en esa lista, que es el que se saca.
    const deVista = (actuales.vista || []).map((x, i) => ({ ...x, i }));
    for (const v of VISTAS) {
        const suyas = deVista.filter(x => x.vista === v.nombre);
        // Sin frases, nada: la fila con su campo vacío ya lo dice, y un
        // «Ninguna» por vista eran cinco renglones de scroll.
        $(`[data-vista="${v.nombre}"] .frases-fichas`).innerHTML = suyas.map(x => ficha(x.frase, x.i)).join('');
    }
    $('#aj-resumen-frases').textContent = resumen(actuales);
}

/** El renglón de la sección cerrada: qué abre, qué cierra y cuántas de vista. */
function resumen(f) {
    const abren = (f.cuenta !== false ? ['3, 2, 1'] : []).concat(f.abrir || []);
    const cierran = f.cerrar || [];
    const vistas = (f.vista || []).length;
    return [
        `IN: ${abren.length ? abren.join(', ') : 'nada'}`,
        `OUT: ${cierran.length ? cierran.join(', ') : 'nada'}`,
        vistas ? `${vistas} de vista` : null
    ].filter(Boolean).join(' · ');
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

async function agregar({ cual, vista }) {
    const fila = vista ? `[data-vista="${vista}"]` : `[data-lista="${cual}"]`;
    const campo = $(`${fila} [data-frase-nueva]`);
    const frase = campo.value.replace(/\s+/g, ' ').trim();
    if (!clave(frase)) return;
    if ((actuales[cual] || []).length >= POR_LISTA) {
        decir(`Esta lista ya tiene ${POR_LISTA} frases: sacá una para agregar «${frase}».`);
        return;
    }
    const nueva = cual === 'vista' ? { frase, vista } : frase;
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
