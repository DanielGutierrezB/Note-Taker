/**
 * lista-tomas.js — Las tomas como fichas, las mismas en las dos pantallas.
 *
 * La clase y el vídeo semanal graban con el mismo motor y producen las mismas
 * tomas, así que la lista de abajo tiene que ser la misma lista: una fila que
 * se lee de un vistazo —toma, momento, cuánto dura, lo que empieza diciendo y
 * cómo está— y, al abrirla, su texto con el IN y el OUT para mover.
 *
 * Está acá y no copiado en cada pantalla por lo de siempre: dos listas que se
 * parecen se separan. La de la clase ya tenía el acordeón, el color de la
 * vista y la pastilla de estado, y la semanal iba a tener que reinventarlos
 * peor.
 *
 * Lo que NO entra acá es lo que de verdad cambia entre las dos: la clase tiene
 * claquetas, notas y comentarios al XML, y la semanal no tiene nada de eso
 * porque la persona que graba su vídeo de la semana no edita en Premiere. Por
 * eso el cuerpo de la ficha lo arma cada pantalla y este módulo solo pone la
 * caja: lo compartido es lo que se ve igual, no lo que hace cada una.
 */

import { esc } from '../chrome.js';
import { icono } from '../iconos.js';
import * as fmt from '../formato.js';
import * as estados from '../estados.js';
import { estiloDeVista } from '../colores.js';

/**
 * Una toma como ficha: la fila plegada y, si está abierta, su cuerpo.
 *
 * `o` lleva lo que cambia entre pantallas:
 *
 *   sesion     el estado entero, que es lo que mira `estados.deToma`
 *   abierta    si esta ficha está desplegada
 *   elegida    si es la que se lleva las teclas
 *   vistas     las vistas con su color, o null si la pantalla no las usa
 *   tc         cómo se escribe el momento de la toma (timecode o reloj)
 *   cuerpo     lo que va dentro al abrirla, sin la caja
 *   alAbrir    qué se va a ver al abrirla, para el hover de la fila
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

/** La lista entera, de la más nueva a la más vieja. */
export function lista(tomas, deCadaUna) {
    return tomas.slice().sort((a, b) => b.inMs - a.inMs)
        .map(t => ficha(t, deCadaUna(t))).join('');
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
        <span class="fila-nota">${esc(t.comentario || primeras(t))}</span>
        <span class="crece"></span>
        ${t.repiteA ? `<span class="pastilla" data-estado="por confirmar"
          title="Empieza diciendo casi lo mismo que la toma ${t.repiteA}: puede ser un
          intento repetido">repite la ${t.repiteA}</span>` : ''}
        <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      </div>`;
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
