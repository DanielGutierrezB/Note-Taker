/**
 * lista-tomas.js — Las tomas como fichas.
 *
 * Una fila que se lee de un vistazo —toma, momento, cuánto dura, lo que
 * empieza diciendo y cómo está— y, al abrirla, su texto con el IN y el OUT
 * para mover. El cuerpo de la ficha lo arma la pantalla; este módulo pone la
 * caja, el acordeón, el color de la vista y la pastilla de estado.
 */

import { esc } from '../chrome.js';
import { icono } from '../iconos.js';
import * as fmt from '../formato.js';
import * as estados from '../estados.js';
import { estiloDeVista } from '../colores.js';
import { fraseConLoBuscado } from './buscar-tomas.js';

/**
 * Una toma como ficha: la fila plegada y, si está abierta, su cuerpo.
 *
 * `o` lleva lo que le pasa la pantalla:
 *
 *   sesion     el estado entero, que es lo que mira `estados.deToma`
 *   abierta    si esta ficha está desplegada
 *   elegida    si es la que se lleva las teclas
 *   vistas     las vistas con su color, o null si la pantalla no las usa
 *   tc         cómo se escribe el momento de la toma (timecode o reloj)
 *   cuerpo     lo que va dentro al abrirla, sin la caja
 *   alAbrir    qué se va a ver al abrirla, para el hover de la fila
 *   miniVistas si la fila lleva su selector de vista (tema nuevo): la vista se
 *              cambia sin desplegar
 *   resaltar   lo que se está buscando (`buscar-tomas.consulta`), para marcarlo
 *              en la frase de la fila
 */
export function ficha(t, o) {
    const est = estados.deToma(t, o.sesion);
    return `<div class="bloque-toma ${o.vistas ? 'con-vista' : ''} ${o.abierta ? 'es-abierta' : ''}"
        data-estado="${est.clave}" data-toma="${t.id}"
        style="${o.vistas ? estiloDeVista(o.vistas, t.vista) : ''}">
      ${fila(t, o, est)}
      ${o.abierta
        ? `<div class="cuerpo-toma">${o.cuerpo(t)}</div>`
        : ''}
    </div>`;
}

/**
 * La fila plegada: entera es el botón que abre la ficha.
 *
 * El orden es el de la pregunta que se hace al mirarla: cuál es, cuándo fue,
 * cuánto dura, qué dice y cómo está. Los 32 px de alto son para que entren
 * veinte sin scrollear.
 */
function fila(t, o, est) {
    const dur = t.outMs != null ? (t.outMs - t.inMs) / 1000 : null;
    return `<div class="fila guarda ${o.elegida ? 'es-elegida' : ''}"
           role="button" tabindex="0" aria-expanded="${o.abierta}"
           data-estado="${est.clave}" data-toma="${t.id}" data-hace="plegar"
           title="${esc(dicePlegar(o.abierta, est, o.alAbrir))}">
        <span class="chevron">${icono('chevron')}</span>
        ${o.vistas ? `<span class="etiqueta-vista">${esc(t.vista)}</span>` : ''}
        <span class="fila-nombre">Toma ${t.id}</span>
        <time class="fila-dato tc">${esc(o.tc(t))}</time>
        ${dur != null ? `<span class="fila-dato">${fmt.duracion(dur)}</span>` : ''}
        <span class="fila-nota">${o.resaltar ? conLoBuscado(t, o.resaltar) : esc(t.comentario || primeras(t))}</span>
        <span class="crece"></span>
        ${o.vistas && o.miniVistas ? miniVistas(t, o.vistas) : ''}
        ${t.repiteA ? `<span class="pastilla" data-estado="por confirmar"
          title="Empieza diciendo casi lo mismo que la toma ${t.repiteA}: puede ser un
          intento repetido">repite la ${t.repiteA}</span>` : ''}
        <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      </div>`;
}

/**
 * Las vistas, para cambiar la de la toma desde la fila: aparecen al pasar por
 * ella o con la fila elegida (CSS), a la derecha, y la sigla de la izquierda
 * sigue diciendo cuál tiene.
 */
function miniVistas(t, vistas) {
    return `<span class="mini-vistas">${vistas.map(v => `
        <button type="button" class="mini-vista" data-hace="vista" data-vista="${esc(v.nombre)}" data-toma="${t.id}"
                aria-pressed="${t.vista === v.nombre}" style="${estiloDeVista(vistas, v.nombre)}"
                title="Poner la toma ${t.id} en ${esc(v.nombre)} (${esc(v.titulo || '')})">${esc(v.nombre)}</button>`).join('')}</span>`;
}

/** La frase de la fila con lo buscado marcado: el pedazo del texto donde aparece. */
function conLoBuscado(t, q) {
    const { partes, cortada } = fraseConLoBuscado(t, q);
    return (cortada ? '…' : '') + partes.map(p => (p.marca ? `<mark>${esc(p.texto)}</mark>` : esc(p.texto))).join('');
}

/** Lo que la toma empieza diciendo, que es con lo que se la reconoce. */
function primeras(t) {
    return (t.palabras || []).slice(0, 10).map(w => w.texto).join(' ');
}

/**
 * Qué dice el hover de la fila.
 *
 * La fila entera es el botón que la abre, así que lo primero es qué se va a
 * ver al abrirla. Si la toma además tiene algo que avisar, el aviso va debajo:
 * la pastilla del final dice la palabra —«sin releer», «leída en chico»— y
 * acá está el porqué, que es lo que no cabe en la pastilla.
 */
function dicePlegar(abierta, est, alAbrir) {
    const gesto = abierta ? 'Plegar la toma' : `Abrir la toma: ${alAbrir}`;
    return est.porque ? `${gesto}\n${est.porque}` : gesto;
}
