/**
 * panel-prproj.js — El menú de «Generar .prproj».
 *
 * Dos preguntas y un botón. Cuántas capturas hay —la cámara, la pantalla, la
 * que sea—, y qué capturas componen cada vista.
 *
 * Cada vista es una fila de cajitas. Encendidas las que la componen, y el orden
 * en que están es el apilado, **de abajo hacia arriba como las pistas de
 * Premiere: la de más a la derecha es la que tapa**. Se cambia arrastrándolas,
 * o con las flechas si se llegó con el teclado.
 *
 * Con dos o más encendidas se puede anidar, y eso cambia el proyecto entero:
 * anidadas, las capturas van adentro de una secuencia aparte y el encuadre se
 * acomoda una vez; sueltas, cada una va en su pista de la precortada y se puede
 * mover toma por toma. Se ve como un recuadro que las junta, en vez de como una
 * palabra: la pregunta es si van en la misma caja o no, y eso se dibuja.
 *
 * Y cada fuente —cada captura suelta, o la anidación entera— lleva su botón de
 * qué hace en las tomas de las OTRAS vistas: quedarse puesta en todas, apagada
 * donde no le toca, o entrar solo en las de su vista. Va adentro de la cajita
 * porque es una decisión por captura, no por vista.
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
            .map(([v, suya]) => [v, { capturas: [...suya.capturas], unidas: suya.unidas, siempre: [...suya.siempre] }]))
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
            ? `<button class="btn" type="button" data-hace="agregar-captura"
                 title="Sumar una cámara o una pantalla más: cada captura es otra anidación donde sincronizar su vídeo">
                 Agregar captura</button>`
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
              <span class="prproj-pila ${suya.unidas ? 'es-anidada' : ''}">
                ${suya.capturas.map(id => cajita(v, suya, id, true)).join('')}
                ${suya.unidas ? siempre(v, suya, suya.capturas) : ''}
              </span>
              ${suya.capturas.length > 1 ? union(v, suya) : ''}
              ${apagadas.length ? '<span class="prproj-corte"></span>' : ''}
              ${apagadas.map(id => cajita(v, suya, id, false)).join('')}
            </span>
          </div>`;
    }).join('');

    // Lo del apilado sale solo cuando hay algo apilado: con una captura por
    // vista no hay nada que ordenar ni que anidar, y sería una línea de ruido.
    // Lo de «en todas» está siempre, porque esa palabra está siempre.
    const hayPilas = Object.values(config.vistas).some(v => v.capturas.length > 1);
    $('#prproj-pilas-dice').textContent = (hayPilas
        ? 'Arrastrá las cajitas: la de la derecha va encima, como las pistas de Premiere.'
            + ' Dentro del recuadro van juntas en una anidación, con el encuadre puesto una vez para'
            + ' toda la carpeta; sin recuadro, cada una va en su pista y se acomoda toma por toma. '
        : '')
        + 'La palabra de al lado dice dónde está esa captura: «en todas» la deja puesta en todas las'
        + ' tomas de la clase, apagada donde no toca, y cambiar de plano es encenderla ahí mismo;'
        + ' «solo PV» la pone únicamente en las tomas de su vista y en las demás su pista queda vacía.';
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
    const donde = apilada
        ? ` · va ${id === suya.capturas[suya.capturas.length - 1] ? 'encima' : 'debajo'}, arrastrala para cambiarlo`
        : '';
    const chip = `<button class="btn btn-vista ${encendida ? 'es-elegida' : ''}" type="button"
                ${apilada ? 'draggable="true"' : ''}
                data-hace="elegir" data-vista="${esc(vista.nombre)}" data-captura="${id}"
                aria-pressed="${encendida}"
                title="${encendida ? 'Sacar' : 'Sumar'} la Captura ${id} ${encendida ? 'de' : 'a'} ${esc(vista.titulo)}${donde}"
                >${id}</button>`;
    if (!encendida) return chip;
    // El número es el asa del arrastre y la cajita entera es el sitio donde se
    // suelta: así soltar sobre la palabra de al lado también cuenta.
    return `<span class="prproj-caja" data-vista="${esc(vista.nombre)}" data-captura="${id}"
                ${apilada ? 'data-arrastra="si"' : ''}
                >${chip}${suya.unidas ? '' : siempre(vista, suya, [id])}</span>`;
}

/**
 * Qué hace una fuente en las tomas de las OTRAS vistas.
 *
 * Es una decisión de la pista, así que hay un botón por fuente: uno por cada
 * captura suelta, y uno solo para la anidación entera, que es un clip en una
 * sola pista y no se puede partir.
 *
 * **Lo dice con una palabra y no con un dibujo.** Estuvo dibujado —la pista
 * vista de lejos, el clip largo contra el corto— y a 15 px eran dos rectángulos
 * que no decían nada: había que apretarlos para enterarse de qué hacían. Las
 * dos palabras son las dos respuestas a «¿dónde está esta captura?»: en todas
 * las tomas, o solo en las de esta vista. Es la misma regla que el resto de la
 * app, donde los estados van en palabras y no en color ni en forma.
 */
function siempre(vista, suya, ids) {
    const puesta = ids.every(id => suya.siempre.includes(id));
    const quien = ids.length > 1 ? 'La anidación' : `La Captura ${ids[0]}`;
    const donde = esc(vista.titulo);
    return `<button class="btn btn-tenue prproj-siempre" type="button" data-hace="siempre"
                data-vista="${esc(vista.nombre)}" ${ids.length > 1 ? '' : `data-captura="${ids[0]}"`}
                aria-pressed="${puesta}"
                title="${puesta
        ? `${quien} queda puesta en todas las tomas de la clase, encendida solo en las de ${donde}: cambiar de plano es encenderla ahí mismo. Clic para que entre solo en las tomas de ${donde}.`
        : `${quien} entra solo en las tomas de ${donde}; en las demás su pista queda vacía. Clic para dejarla puesta en todas, apagada donde no toca.`}"
                >${puesta ? 'en todas' : `solo ${esc(vista.nombre)}`}</button>`;
}

/**
 * El botón de anidar, que es el que dibuja o borra el recuadro.
 *
 * Solo el icono: lo que está pasando ya se ve en el recuadro, y una palabra al
 * lado («Anidadas», «Sueltas») obliga a adivinar si nombra el estado de ahora o
 * lo que va a pasar al apretarla.
 */
function union(vista, suya) {
    const nombres = suya.capturas.slice().reverse().map(id => `Captura ${id}`).join(' sobre ');
    return `<button class="btn btn-tenue btn-ico prproj-une" type="button" data-hace="unir"
                data-vista="${esc(vista.nombre)}" aria-pressed="${suya.unidas}"
                title="${suya.unidas
        ? `${nombres}, juntas en una anidación llamada «${esc(vista.nombre)}»: el encuadre se acomoda una vez y vale para toda la carpeta. Clic para separarlas.`
        : `${nombres}, cada una en su pista de la precortada: el encuadre se acomoda toma por toma. Clic para anidarlas.`}"
                >${icono(suya.unidas ? 'enlace' : 'sinEnlace')}</button>`;
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
                poner(v, quedan.length ? quedan : [1], suya.unidas, quedan.length ? suya.siempre : [1]);
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
            // La que se suma entra por la derecha, o sea encima: es donde está
            // la cajita que se acaba de apretar, y de ahí se arrastra. Entra
            // puesta en todas las tomas, que es lo que el editor espera.
            poner(v, suya.capturas.includes(id)
                ? suya.capturas.filter(x => x !== id)
                : [...suya.capturas, id], suya.unidas, [...suya.siempre, id]);
            pintar();
            break;
        }
        case 'unir': {
            const suya = config.vistas[boton.dataset.vista];
            poner(boton.dataset.vista, suya.capturas, !suya.unidas, suya.siempre);
            pintar();
            break;
        }
        case 'siempre': {
            const suya = config.vistas[boton.dataset.vista];
            // Sin número es el botón de la anidación, que manda sobre todas las
            // capturas del grupo: es un clip en una sola pista.
            const cuales = boton.dataset.captura ? [Number(boton.dataset.captura)] : suya.capturas;
            const puesta = cuales.every(id => suya.siempre.includes(id));
            poner(boton.dataset.vista, suya.capturas, suya.unidas, puesta
                ? suya.siempre.filter(id => !cuales.includes(id))
                : [...suya.siempre, ...cuales]);
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
 *
 * Y `siempre` se queda con las capturas que la vista tiene hoy, redondeado a
 * todo o nada si van anidadas: el motor lo redondea igual (`vistaSaneada`), y lo
 * que se dibuja tiene que ser lo que se va a generar.
 */
function poner(vista, capturas, unidas, siempre) {
    const anidada = capturas.length > 1 && unidas;
    const puestas = capturas.filter(id => siempre.includes(id));
    config.vistas[vista] = {
        capturas,
        unidas: anidada,
        siempre: anidada ? (puestas.length ? capturas.slice() : []) : puestas
    };
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
    // Antes o después se mide contra el NÚMERO y no contra la cajita entera: la
    // cajita incluye la palabra de la derecha, así que su mitad caía dentro de
    // la palabra y soltar sobre el número de al lado siempre significaba
    // «antes». Contra el número, la palabra cuenta como «después», que es el
    // lado donde está.
    const chip = caja.querySelector('.btn-vista') || caja;
    const sitio = chip.getBoundingClientRect();
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
    const vuelve = document.querySelector(`[data-hace="elegir"][data-vista="${vista}"][data-captura="${id}"]`);
    if (vuelve) vuelve.focus();
}

/** Pone `id` antes o después de `vecina` en la pila de esa vista. */
function mover(vista, id, vecina, despues) {
    const suya = config.vistas[vista];
    const capturas = suya.capturas.filter(x => x !== id);
    const donde = capturas.indexOf(vecina);
    if (donde === -1) return;
    capturas.splice(donde + (despues ? 1 : 0), 0, id);
    poner(vista, capturas, suya.unidas, suya.siempre);
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
          <button class="btn" type="button" data-hace="mostrar" data-ruta="${esc(r.ruta)}"
                  title="Abrir el Finder con el proyecto recién escrito seleccionado">Mostrar en Finder</button>
        </div>`;
    avisar('Proyecto de Premiere listo.', 'ok');
}
