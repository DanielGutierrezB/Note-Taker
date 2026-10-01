/**
 * panel-prproj.js — El menú de «Generar .prproj».
 *
 * Dos preguntas y un botón. Cuántas capturas hay —la cámara, la pantalla, la
 * que sea—, y qué capturas componen cada vista.
 *
 * Cada vista es una fila de cajitas. Encendidas las que la componen, y el orden
 * en que están es el apilado: la de más a la izquierda es la que tapa. Se
 * cambia arrastrándolas, o con las flechas si se llegó con el teclado.
 *
 * Con dos o más encendidas aparece el botón de anidar, que decide algo que no
 * se ve en la fila pero cambia el proyecto entero: anidadas, las capturas van
 * adentro de una secuencia aparte y el encuadre se acomoda una vez; sueltas,
 * cada una va en su pista de la precortada y se puede mover toma por toma.
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
    $('#prproj-resultado').addEventListener('click', alClic);
    const filas = $('#prproj-vistas');
    filas.addEventListener('click', alClic);
    filas.addEventListener('dragstart', alEmpezarArrastre);
    filas.addEventListener('dragover', alPasarPorEncima);
    filas.addEventListener('drop', alSoltar);
    filas.addEventListener('dragend', alTerminarArrastre);
    filas.addEventListener('keydown', alTecla);
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
    // Copia propia: lo que se toca acá no vuelve al motor hasta Generar.
    config = {
        capturas: r.config.capturas,
        vistas: Object.fromEntries(Object.entries(r.config.vistas)
            .map(([v, suya]) => [v, { capturas: [...suya.capturas], unidas: suya.unidas }]))
    };
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
        const suya = config.vistas[v.nombre];
        const apagadas = ids.filter(id => !suya.capturas.includes(id));
        return `<div class="prproj-vista ${v.usada ? '' : 'es-sin-tomas'}" style="${estiloDeVista(vistas, v.nombre)}">
            <span class="prproj-sigla">${esc(v.nombre)}</span>
            <span class="prproj-titulo">${esc(v.titulo)}${v.usada ? '' : ' <span class="v3">· sin tomas</span>'}</span>
            <span class="prproj-elige">
              ${suya.capturas.length > 1 ? '<span class="v3 prproj-arriba">encima</span>' : ''}
              ${suya.capturas.map(id => cajita(v, suya, id, true)).join('')}
              ${apagadas.length && suya.capturas.length ? '<span class="prproj-corte"></span>' : ''}
              ${apagadas.map(id => cajita(v, suya, id, false)).join('')}
            </span>
            ${suya.capturas.length > 1 ? union(v, suya) : ''}
          </div>`;
    }).join('');

    // La explicación sale solo cuando hay algo apilado: con una captura por
    // vista no hay nada que ordenar ni que anidar, y sería una línea de ruido.
    const hayPilas = Object.values(config.vistas).some(v => v.capturas.length > 1);
    $('#prproj-pilas-dice').textContent = hayPilas
        ? 'La cajita de más a la izquierda es la que va encima: arrastralas para cambiar el apilado.'
            + ' Anidadas van las dos adentro de una anidación, con el encuadre puesto una vez para toda la'
            + ' carpeta; sueltas, cada una va en su pista de la precortada y se acomoda toma por toma.'
        : '';
}

/**
 * Una captura en una vista: si está adentro, y en qué lugar de la pila.
 *
 * Las encendidas se arrastran y las apagadas no, porque una apagada no está en
 * ninguna pila: su lugar no significa nada hasta que entre. Las flechas hacen
 * lo mismo que el arrastre, para quien llegó con el teclado.
 */
function cajita(vista, suya, id, encendida) {
    const apilada = encendida && suya.capturas.length > 1;
    const comoSeMueve = apilada ? ' · arrastrala o movela con ← → para cambiar el apilado' : '';
    return `<button class="btn btn-vista ${encendida ? 'es-elegida' : ''}" type="button"
                ${apilada ? 'draggable="true" data-arrastra="si"' : ''}
                data-hace="elegir" data-vista="${esc(vista.nombre)}" data-captura="${id}"
                aria-pressed="${encendida}"
                title="${encendida ? 'Sacar' : 'Sumar'} la Captura ${id} ${encendida ? 'de' : 'a'} ${esc(vista.titulo)}${comoSeMueve}"
                >${id}</button>`;
}

/** El botón de anidar: una anidación con las dos, o cada una en su pista. */
function union(vista, suya) {
    const nombres = suya.capturas.map(id => `Captura ${id}`).join(' sobre ');
    return `<button class="btn btn-tenue prproj-union" type="button" data-hace="unir"
                data-vista="${esc(vista.nombre)}"
                title="${suya.unidas
        ? `${nombres}, adentro de una anidación: el encuadre se acomoda una vez y vale para toda la carpeta. Clic para dejarlas sueltas.`
        : `${nombres}, cada una en su pista de la precortada: el encuadre se acomoda toma por toma. Clic para anidarlas.`}"
                >${icono(suya.unidas ? 'enlace' : 'sinEnlace')}${suya.unidas ? 'Anidadas' : 'Sueltas'}</button>`;
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
            for (const [v, suya] of Object.entries(config.vistas)) {
                const quedan = suya.capturas.filter(id => id !== fuera);
                poner(v, quedan.length ? quedan : [1], suya.unidas);
            }
            pintar();
            break;
        }
        case 'elegir': {
            const v = boton.dataset.vista;
            const id = Number(boton.dataset.captura);
            const suya = config.vistas[v];
            // Una vista sin ninguna captura no se puede cortar: la última no se saca.
            if (suya.capturas.includes(id) && suya.capturas.length === 1) {
                avisar('Cada vista necesita por lo menos una captura.');
                return;
            }
            // La que se suma entra debajo de las que ya estaban, que es lo menos
            // sorprendente: lo que ya se veía se sigue viendo.
            poner(v, suya.capturas.includes(id)
                ? suya.capturas.filter(x => x !== id)
                : [...suya.capturas, id], suya.unidas);
            pintar();
            break;
        }
        case 'unir': {
            const v = boton.dataset.vista;
            poner(v, config.vistas[v].capturas, !config.vistas[v].unidas);
            pintar();
            break;
        }
        case 'mostrar':
            window.nt.reveal(boton.dataset.ruta);
            break;
    }
}

/**
 * Deja una vista como quedó.
 *
 * Con una sola captura no hay nada que anidar, así que `unidas` se apaga: dejar
 * un `true` dormido ahí haría que sumar una segunda captura anidara sin que
 * nadie lo pidiera.
 */
function poner(vista, capturas, unidas) {
    config.vistas[vista] = { capturas, unidas: capturas.length > 1 && unidas };
}

// ─── Mover las cajitas ───────────────────────────────────────────────

/**
 * Qué cajita se está arrastrando.
 *
 * Se guarda acá y no en el `dataTransfer` porque de ahí no se puede leer
 * mientras se arrastra —el navegador solo lo abre al soltar— y hace falta
 * saberlo antes, en `dragover`, para decidir si este sitio acepta o no.
 */
let arrastre = null;

function alEmpezarArrastre(e) {
    const caja = e.target.closest('[data-arrastra]');
    if (!caja || generando) return;
    arrastre = { vista: caja.dataset.vista, id: Number(caja.dataset.captura) };
    caja.classList.add('se-arrastra');
    e.dataTransfer.effectAllowed = 'move';
    // Sin algo escrito, Chrome no arranca el arrastre.
    try { e.dataTransfer.setData('text/plain', String(arrastre.id)); } catch (err) { /* da igual qué lleve */ }
}

/** Solo se suelta sobre otra cajita apilada de la MISMA vista. */
function destinoDe(e) {
    const caja = arrastre && e.target.closest('[data-arrastra]');
    return caja && caja.dataset.vista === arrastre.vista ? caja : null;
}

function alPasarPorEncima(e) {
    const caja = destinoDe(e);
    if (!caja) return;
    // Sin este `preventDefault` el navegador entiende que acá no se puede soltar
    // y no llega a dispararse el `drop`.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function alSoltar(e) {
    const caja = destinoDe(e);
    if (!caja) return;
    e.preventDefault();
    const sitio = caja.getBoundingClientRect();
    mover(arrastre.vista, arrastre.id, Number(caja.dataset.captura), e.clientX > sitio.left + sitio.width / 2);
    arrastre = null;
}

function alTerminarArrastre() {
    arrastre = null;
    for (const caja of document.querySelectorAll('.se-arrastra')) caja.classList.remove('se-arrastra');
}

/** Las flechas hacen lo mismo que el arrastre, un lugar por vez. */
function alTecla(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const caja = e.target.closest('[data-arrastra]');
    if (!caja || generando) return;
    const vista = caja.dataset.vista;
    const id = Number(caja.dataset.captura);
    const donde = config.vistas[vista].capturas.indexOf(id);
    const vecina = config.vistas[vista].capturas[donde + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (vecina == null) return;
    e.preventDefault();
    mover(vista, id, vecina, e.key === 'ArrowRight');
    const vuelve = document.querySelector(`[data-arrastra][data-vista="${vista}"][data-captura="${id}"]`);
    if (vuelve) vuelve.focus();
}

/** Pone `id` antes o después de `vecina` en la pila de esa vista. */
function mover(vista, id, vecina, despues) {
    const suya = config.vistas[vista];
    const capturas = suya.capturas.filter(x => x !== id);
    const donde = capturas.indexOf(vecina);
    if (donde === -1) return;
    capturas.splice(donde + (despues ? 1 : 0), 0, id);
    poner(vista, capturas, suya.unidas);
    pintar();
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
