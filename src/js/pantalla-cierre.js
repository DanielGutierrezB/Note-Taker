/**
 * pantalla-cierre.js — Qué quedó y dónde.
 *
 * Es corta a propósito: la clase terminó, el editor está cansado y lo único
 * que necesita es saber que salió bien y dónde está el archivo. Lo que no se
 * puede es que tenga que ir a buscarlo — por eso el botón que lo muestra en el
 * Finder está arriba, al lado de «Volver a Sesiones», que es lo que se hace
 * después.
 *
 * Y dice lo que NO salió bien con el mismo detalle que lo que sí: una sesión
 * con tres tomas sin releer que solo diga «listo» es la pérdida silenciosa que
 * toda esta app trata de evitar. Por eso los avisos van antes que las acciones.
 *
 * Debajo, la clase de punta a punta —dónde cayó cada toma, del color de su
 * vista— y la lista de las tomas, que es lo que el editor va a encontrar en
 * Premiere. Las explicaciones largas van en el «?», no en la pantalla.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import { estiloDeVista } from './colores.js';
import * as fmt from './formato.js';
import * as panelPrproj from './panel-prproj.js';

let app = null;
let salida = null;

const LOGO_PREMIERE = `<svg class="logo-premiere" viewBox="0 0 24 23" aria-hidden="true"><rect width="24" height="23" rx="5.4" fill="#00005b"/><text x="12" y="16.4" text-anchor="middle" font-size="12.5" font-weight="700" fill="#9999ff" font-family="-apple-system, Helvetica, Arial, sans-serif">Pr</text></svg>`;

export function conectar(contexto) {
    app = contexto;
    $('#vista-cierre').addEventListener('click', alClic);
}

export function ver(laSalida) {
    salida = laSalida;
    verVista('vista-cierre');
    pintar();
}

function pintar() {
    if (!salida) {
        $('#cierre-resumen').innerHTML =
            '<div class="vacio"><span class="vacio-titulo">No quedó nada que mostrar.</span></div>';
        $('#cierre-pie').innerHTML = '';
        return;
    }

    const vivas = salida.tomas.filter(t => !t.descartada);
    const sinReleer = vivas.filter(t => t.relectura && t.relectura.estado === 'sin-leer');
    const chicas = vivas.filter(t => t.relectura && t.relectura.estado === 'degradada');
    const problemas = (salida.comprobacion && salida.comprobacion.problemas) || [];
    const revisar = problemas.length > 0;

    $('#cierre-resumen').innerHTML = `
      <header class="cierre-cabeza">
        <span class="cierre-icono ${revisar ? 'es-revisar' : ''}">${icono(revisar ? 'atencion' : 'ok')}</span>
        <div class="cierre-titulos">
          <h1 class="cierre-titulo">Resumen de la clase
            ${revisar ? '<span class="pastilla" data-estado="sin releer">revisar</span>' : ''}</h1>
          <div class="cierre-sub">
            <code>${esc(salida.corto || salida.secuencia)}</code>
            ${salida.curso ? `<span>${esc(salida.curso)}</span>` : ''}
            ${salida.ceroMs ? `<span>${esc(fmt.cuando(salida.ceroMs))}</span>` : ''}
          </div>
        </div>
        <span class="crece"></span>
        <button class="btn btn-grande" type="button" data-hace="finder"
                title="Abrir el Finder con el XML de esta clase seleccionado, listo para arrastrarlo a Premiere">
          ${icono('finder')} Mostrar el XML en el Finder</button>
        <button class="btn btn-primario btn-grande" type="button" data-hace="sesiones"
                title="Volver a la lista de clases de la carpeta">Volver a Sesiones</button>
      </header>

      <div class="cierre-cifras">
        ${cifra(vivas.length, vivas.length === 1 ? 'toma' : 'tomas')}
        ${cifra(fmt.duracion(cortados(vivas)), 'de clase cortada')}
        ${cifra(fmt.duracion(salida.segundos), 'de audio grabado')}
        ${vistasUsadas(vivas)}
      </div>

      ${revisar ? avisoDeComprobacion(problemas) : ''}
      ${sinReleer.length || chicas.length ? aviso(sinReleer, chicas) : ''}

      <section class="cierre-bloque">
        <h2 class="cierre-paso">La clase, de punta a punta
          <span class="ayuda" tabindex="0" title="Toda la grabación, de izquierda a derecha. Cada bloque es una toma que va al XML, del color de su vista; lo gris es lo que queda afuera.">?</span></h2>
        ${tira(vivas)}
      </section>

      ${vivas.length ? `
      <section class="cierre-bloque">
        <h2 class="cierre-paso">Tomas <span class="cierre-cuenta">${vivas.length}</span></h2>
        <div class="cierre-tomas">
          <div class="cierre-toma es-cabeza"><span>N.º</span><span>Vista</span><span>Empieza</span><span>Dura</span><span>Qué se dijo</span><span></span></div>
          ${vivas.map(filaDeToma).join('')}
        </div>
      </section>` : ''}`;

    // Lo que se usa poco va abajo y chico: «Crear proyecto» es del curso entero
    // y «Rehacer el XML» es para cuando una versión nueva arregla el archivo.
    // Al lado de los de arriba se confundían con lo que hay que hacer al terminar.
    $('#cierre-pie').innerHTML = `
      <span class="cierre-archivo" title="${esc(salida.archivos.xml)}">${esc(salida.archivos.xml)}</span>
      <span class="ayuda" tabindex="0" title="El XML lleva el audio en A1, y los mismos marcadores van tres veces: en la secuencia, en el clip de A1 y en el clip maestro del WAV. Los del maestro son los que acompañan al audio si lo arrastrás a otra secuencia o lo metés en un multicámara. La sincronía con las cámaras va por forma de onda.">?</span>
      <span class="crece"></span>
      <button class="btn btn-tenue btn-chico" type="button" data-hace="prproj"
              title="Armar el proyecto de Premiere del curso entero, con esta clase adentro">
        ${LOGO_PREMIERE} Crear proyecto</button>
      <button class="btn btn-tenue btn-chico" type="button" data-hace="rehacer-xml"
              title="Reescribe el XML con el formato de esta versión. No relee el audio ni toca las notas: es para cuando una versión nueva arregla algo del archivo.">
        ${icono('xml')} Rehacer el XML</button>`;
}

/**
 * Cuánto dura la clase cortada: lo que el editor va a entregar.
 *
 * La misma cuenta que la barra de En vivo (`segundosCortados`): la suma de las
 * tomas que van al XML, no lo que duró la grabación. Es el número que contesta
 * «¿cuánto material hay?», que es lo que se pregunta al terminar.
 */
function cortados(vivas) {
    return vivas
        .filter(t => t.inMs != null && t.outMs != null)
        .reduce((n, t) => n + (t.outMs - t.inMs), 0) / 1000;
}

function cifra(valor, rotulo) {
    return `<div class="cierre-cifra"><b>${esc(valor)}</b><span>${esc(rotulo)}</span></div>`;
}

/** Cuántas tomas tiene cada vista, con su color: es la leyenda de la tira. */
function vistasUsadas(vivas) {
    const cuenta = new Map();
    for (const t of vivas) cuenta.set(t.vista, (cuenta.get(t.vista) || 0) + 1);
    if (!cuenta.size) return '';
    const orden = (salida.vistas || []).map(v => v.nombre);
    const vistas = [...cuenta.keys()].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
    return `<div class="cierre-cifra es-vistas">
      <span class="cierre-vistas">${vistas.map(v => `
        <span class="cierre-vista" style="${estiloDeVista(salida.vistas, v)}"
              title="${esc(tituloDeVista(v))}: ${cuenta.get(v)} toma${cuenta.get(v) === 1 ? '' : 's'}">${esc(v)} <small>${cuenta.get(v)}</small></span>`).join('')}
      </span><span>por vista</span></div>`;
}

function tituloDeVista(nombre) {
    const v = (salida.vistas || []).find(x => x.nombre === nombre);
    return v ? v.titulo : nombre;
}

/** Desde dónde empieza la clase y cuánto mide, para ubicar cada toma. */
function largoDeLaClase(vivas) {
    const ultima = vivas.reduce((m, t) => Math.max(m, t.outMs || 0), 0);
    return Math.max(Number(salida.segundos) || 0, ultima ? (ultima - salida.ceroMs) / 1000 : 0);
}

function tira(vivas) {
    const total = largoDeLaClase(vivas);
    const bloques = total > 0 ? vivas.filter(t => t.inMs != null && t.outMs != null).map(t => {
        const desde = Math.max(0, (t.inMs - salida.ceroMs) / 1000);
        const hasta = Math.max(desde, (t.outMs - salida.ceroMs) / 1000);
        return `<span class="cierre-bloque-toma" style="${estiloDeVista(salida.vistas, t.vista)};left:${(desde / total * 100).toFixed(3)}%;width:${Math.max(0.4, (hasta - desde) / total * 100).toFixed(3)}%"
                      title="Toma ${t.id} · ${esc(t.vista)} · ${fmt.relojCorto(desde)} a ${fmt.relojCorto(hasta)}"></span>`;
    }).join('') : '';
    // Con una prueba de segundos, cinco marcas repetirían la misma hora.
    const partes = total >= 60 ? [0, 1, 2, 3, 4] : [0, 4];
    const marcas = partes.map(i => `<span>${fmt.relojCorto(total * i / 4)}</span>`).join('');
    return `
      <div class="cierre-tira">${bloques}${vivas.length ? '' : '<span class="cierre-tira-vacia">No se marcó ninguna toma: no hay nada cortado.</span>'}</div>
      <div class="cierre-marcas">${marcas}</div>`;
}

/** Las primeras palabras de la toma: para reconocerla sin abrirla. */
function principio(t) {
    const palabras = (t.palabras || []).map(p => p.texto || p.w || '').filter(Boolean);
    const corto = palabras.slice(0, 18).join(' ');
    return palabras.length > 18 ? `${corto}…` : corto;
}

function filaDeToma(t) {
    const desde = t.inMs != null ? fmt.relojCorto((t.inMs - salida.ceroMs) / 1000) : '—';
    const dura = t.inMs != null && t.outMs != null ? fmt.duracion((t.outMs - t.inMs) / 1000) : '—';
    const marcas = [];
    if (t.relectura && t.relectura.estado === 'sin-leer') marcas.push('<span class="pastilla" data-estado="sin releer">sin releer</span>');
    if (t.relectura && t.relectura.estado === 'degradada') marcas.push('<span class="pastilla" data-estado="modelo liviano">modelo chico</span>');
    if (t.repiteA) marcas.push(`<span class="pastilla" data-estado="desactivada" title="Empieza diciendo casi lo mismo que la toma ${t.repiteA}">repite la ${t.repiteA}</span>`);
    const texto = principio(t);
    return `
      <div class="cierre-toma">
        <span class="cierre-toma-num">${String(t.id).padStart(2, '0')}</span>
        <span><span class="cierre-vista" style="${estiloDeVista(salida.vistas, t.vista)}" title="${esc(tituloDeVista(t.vista))}">${esc(t.vista)}</span></span>
        <span class="cierre-toma-tc">${desde}</span>
        <span>${esc(dura)}</span>
        <span class="cierre-toma-texto">${t.comentario ? `<b>${esc(t.comentario)}</b>` : ''}<span>${esc(texto || 'sin texto')}</span></span>
        <span class="cierre-toma-marcas">${marcas.join('')}</span>
      </div>`;
}

/**
 * Lo que la comprobación del motor encontró al terminar (`comprobar-clase.js`).
 * Va primero: un audio al que le faltan segundos es más grave que un texto
 * leído con el modelo chico.
 */
function avisoDeComprobacion(problemas) {
    return `<div class="aviso cierre-aviso">${icono('atencion')}
      <span><b>Antes de entregarla, mirá esto.</b> ${problemas.map(p => esc(p)).join(' ')}</span></div>`;
}

function aviso(sinReleer, chicas) {
    const partes = [];
    if (sinReleer.length) {
        partes.push(sinReleer.length === 1
            ? '1 toma quedó con el texto del ciclo rápido: Whisper no pudo con ella mientras se grababa.'
            : `${sinReleer.length} tomas quedaron con el texto del ciclo rápido: Whisper no pudo con ellas mientras se grababa.`);
    }
    if (chicas.length) {
        partes.push(`${chicas.length === 1 ? '1 se leyó' : `${chicas.length} se leyeron`} con un modelo más chico ` +
            'porque el sistema se llevó al grande.');
    }
    return `<div class="aviso cierre-aviso">${icono('atencion')}
      <span>${esc(partes.join(' '))} El XML está completo igual —los tiempos son los
      buenos—, pero el texto de esas tomas no. «Releer todo con el modelo grande», en el
      menú «···» de la clase en Sesiones, las vuelve a leer ahora que la máquina está libre.</span></div>`;
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    switch (boton.dataset.hace) {
        case 'finder':
            window.nt.reveal(salida.archivos.xml);
            break;
        case 'prproj':
            panelPrproj.abrir(app.ajustes && app.ajustes.carpeta);
            break;
        case 'sesiones':
            app.irASesiones();
            break;
        case 'rehacer-xml': {
            boton.disabled = true;
            const r = await window.nt.grabarRehacerXml(salida.archivos.json);
            boton.disabled = false;
            avisar(r.ok
                ? `XML rehecho: ${r.tomas} toma${r.tomas === 1 ? '' : 's'}.`
                : r.error, r.ok ? 'ok' : 'error');
            break;
        }
    }
}
