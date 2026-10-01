/**
 * panel-prproj.js — El menú de «Generar .prproj».
 *
 * Dos preguntas y un botón. Cuántas capturas hay —la cámara, la pantalla, la
 * que sea—, y qué capturas componen cada vista. Una vista hecha de dos capturas
 * es una anidación que las junta (`prproj-carpeta.armarGrupos`), y el orden en
 * que se las elige es el apilado: la primera es la que tapa a las de abajo.
 *
 * Lo que se elige se guarda en la carpeta al generar, así que la vez siguiente
 * el menú abre como se dejó. La lógica de qué cuadra y qué no vive en el motor
 * (`prproj-carpeta.normalizar`): acá solo se impide lo que no tiene sentido
 * pedir, como una vista sin ninguna captura.
 */

import { $, esc, avisar, verPanel } from './chrome.js';
import { icono } from './iconos.js';
import { estiloDeVista } from './colores.js';

/** El tope de capturas del menú: más que esto no es una clase, es un estudio. */
const MAX_CAPTURAS = 6;

let carpeta = null;
let config = null;
let vistas = [];
let generando = false;

export function conectar() {
    $('#btn-prproj-cerrar').innerHTML = icono('cerrar');
    $('#prproj-capturas').addEventListener('click', alClic);
    $('#prproj-vistas').addEventListener('click', alClic);
    $('#prproj-resultado').addEventListener('click', alClic);
    $('#btn-prproj-generar').addEventListener('click', generar);
    window.nt.onPrprojAviso(p => {
        if (!generando || p.carpeta !== carpeta) return;
        $('#btn-prproj-generar').textContent = p.que || 'Generando…';
    });
}

/** Abre el menú para una carpeta, con la configuración que tenga guardada. */
export async function abrir(laCarpeta) {
    if (!laCarpeta) {
        avisar('Primero elegí la carpeta del curso.');
        return;
    }
    const r = await window.nt.prprojConfig(laCarpeta);
    if (!r.ok) {
        avisar(r.error, 'error');
        return;
    }
    carpeta = laCarpeta;
    config = { capturas: r.config.capturas, vistas: { ...r.config.vistas } };
    vistas = r.vistas;
    $('#prproj-dice').textContent = r.clases
        ? `Con las ${r.clases} clase(s) de esta carpeta: una anidación por captura para sincronizar, y cada clase precortada encima.`
        : 'Esta carpeta todavía no tiene ninguna clase grabada.';
    $('#prproj-destino').textContent = `Se guarda en ${r.destino}`;
    $('#prproj-resultado').innerHTML = r.plantilla
        ? ''
        : '<div class="aviso" data-tono="error">Falta la plantilla de Premiere que viene con la app: reinstalala.</div>';
    $('#btn-prproj-generar').disabled = !r.clases || !r.plantilla;
    $('#btn-prproj-generar').textContent = 'Generar';
    pintar();
    verPanel('telon-prproj', true);
}

function pintar() {
    const ids = Array.from({ length: config.capturas }, (_, i) => i + 1);
    $('#prproj-capturas').innerHTML = ids.map(id => `
        <span class="prproj-captura">Captura ${id}${id > 1 && id === config.capturas
            ? `<button class="btn btn-tenue btn-ico" type="button" data-hace="quitar-captura"
                 title="Quitar la Captura ${id}">${icono('cerrar')}</button>` : ''}</span>`).join('')
        + (config.capturas < MAX_CAPTURAS
            ? '<button class="btn" type="button" data-hace="agregar-captura">Agregar captura</button>'
            : '');

    // Las que tienen tomas primero: son las que van a la precortada. Las otras
    // se pueden dejar listas para la próxima clase, pero no deciden nada hoy.
    const orden = vistas.filter(v => v.usada).concat(vistas.filter(v => !v.usada));
    $('#prproj-vistas').innerHTML = orden.map(v => {
        const elegidas = config.vistas[v.nombre] || [1];
        const grupo = elegidas.length > 1 ? pilaDe(v, elegidas) : '';
        return `<div class="prproj-vista ${v.usada ? '' : 'es-sin-tomas'}" style="${estiloDeVista(vistas, v.nombre)}">
            <span class="prproj-sigla">${esc(v.nombre)}</span>
            <span class="prproj-titulo">${esc(v.titulo)}${v.usada ? '' : ' <span class="v3">· sin tomas</span>'}</span>
            <span class="prproj-elige">${ids.map(id => `
              <button class="btn btn-vista ${elegidas.includes(id) ? 'es-elegida' : ''}" type="button"
                      data-hace="elegir" data-vista="${esc(v.nombre)}" data-captura="${id}"
                      aria-pressed="${elegidas.includes(id)}"
                      title="${elegidas.includes(id) ? 'Sacar' : 'Sumar'} la Captura ${id} ${elegidas.includes(id) ? 'de' : 'a'} ${esc(v.titulo)}">${id}</button>`).join('')}</span>
            ${grupo}
          </div>`;
    }).join('');

    // La explicación del apilado sale solo cuando hay algo apilado: con una
    // captura por vista no hay nada que ordenar y sería una línea de ruido.
    const hayPilas = Object.values(config.vistas).some(ids => (ids || []).length > 1);
    $('#prproj-pilas-dice').textContent = hayPilas
        ? 'Una vista de dos capturas es una anidación con las dos: la primera va encima, tapando a la otra, y la flecha la sube una capa.'
        : '';
}

/**
 * Cómo se apilan las capturas de una vista compuesta, y cómo se cambia.
 *
 * Elegir dos capturas no alcanza: hay que decir cuál tapa a cuál, que es la
 * diferencia entre la cámara en recuadro sobre la pantalla y la pantalla
 * tapando la cámara. Se dibujan en orden, la de encima primero, y cada una
 * menos esa es un botón que la sube una capa.
 *
 * Horizontal y no en columna porque la fila mide 32 px y hay una por vista: una
 * pila vertical por fila haría un menú tres veces más alto para decir lo mismo.
 * Lo que dice qué extremo es el de arriba es la palabra «encima» delante.
 */
function pilaDe(vista, elegidas) {
    const capas = elegidas.map((id, i) => i === 0
        ? `<span class="prproj-capa es-encima">Captura ${id}</span>`
        : `<button class="btn btn-tenue prproj-capa" type="button" data-hace="subir"
                   data-vista="${esc(vista.nombre)}" data-captura="${id}"
                   title="Subir la Captura ${id} encima de la Captura ${elegidas[i - 1]}"
                   >${icono('subir')}Captura ${id}</button>`).join('');
    return `<span class="prproj-pila"><span class="v3">encima</span>${capas}</span>`;
}

function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton || generando) return;
    switch (boton.dataset.hace) {
        case 'agregar-captura':
            config.capturas = Math.min(MAX_CAPTURAS, config.capturas + 1);
            pintar();
            break;
        case 'quitar-captura': {
            const fuera = config.capturas;
            config.capturas = Math.max(1, fuera - 1);
            // Las vistas que la usaban se quedan con lo demás que tenían, y si no
            // les queda nada vuelven a la Captura 1, que siempre está.
            for (const [v, ids] of Object.entries(config.vistas)) {
                const quedan = ids.filter(id => id !== fuera);
                config.vistas[v] = quedan.length ? quedan : [1];
            }
            pintar();
            break;
        }
        case 'elegir': {
            const v = boton.dataset.vista;
            const id = Number(boton.dataset.captura);
            const ids = config.vistas[v] || [1];
            // Una vista sin ninguna captura no se puede cortar: el último no se saca.
            if (ids.includes(id) && ids.length === 1) {
                avisar('Cada vista necesita por lo menos una captura.');
                return;
            }
            // La que se suma entra debajo de las que ya estaban: es el orden en
            // que se apilan, y subirla es un clic más (`subir`).
            config.vistas[v] = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
            pintar();
            break;
        }
        case 'subir': {
            const v = boton.dataset.vista;
            const id = Number(boton.dataset.captura);
            const ids = [...(config.vistas[v] || [1])];
            const donde = ids.indexOf(id);
            if (donde > 0) {
                ids.splice(donde - 1, 0, ids.splice(donde, 1)[0]);
                config.vistas[v] = ids;
                pintar();
            }
            break;
        }
        case 'mostrar':
            window.nt.reveal(boton.dataset.ruta);
            break;
    }
}

async function generar() {
    if (generando || !carpeta) return;
    generando = true;
    const boton = $('#btn-prproj-generar');
    boton.disabled = true;
    boton.textContent = 'Generando…';
    $('#prproj-resultado').innerHTML = '';
    let r;
    try {
        r = await window.nt.prprojGenerar(carpeta, config);
    } catch (err) {
        r = { ok: false, error: err.message };
    }
    generando = false;
    boton.disabled = false;
    boton.textContent = 'Generar';
    if (r.cancelado) return;
    if (!r.ok) {
        $('#prproj-resultado').innerHTML = `<div class="aviso" data-tono="error">${esc(r.error)}</div>`;
        return;
    }
    // Lo que hay que mirar va primero y separado de la cuenta: es lo único de
    // acá que pide hacer algo.
    const avisos = (r.avisos || []).map(a => `<li>${esc(a)}</li>`).join('');
    $('#prproj-resultado').innerHTML = `
        <div class="aviso" data-tono="ok">
          <div class="prproj-hecho">
            <span>Listo: ${esc(r.ruta.split('/').pop())}</span>
            <span class="v3">${(r.cuenta || []).slice(0, 2).map(esc).join(' ')}</span>
            ${avisos ? `<ul class="prproj-avisos v3">${avisos}</ul>` : ''}
          </div>
          <button class="btn" type="button" data-hace="mostrar" data-ruta="${esc(r.ruta)}">Mostrar en Finder</button>
        </div>`;
    avisar('Proyecto de Premiere listo.', 'ok');
}
