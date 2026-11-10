/**
 * pantalla-cierre.js — Qué quedó y dónde.
 *
 * Es corta a propósito: la clase terminó, el editor está cansado y lo único
 * que necesita es saber que salió bien y dónde está el archivo. Lo que no se
 * puede es que tenga que ir a buscarlo — por eso el botón que lo muestra en el
 * Finder es la acción principal.
 *
 * Y dice lo que NO salió bien con el mismo detalle que lo que sí: una sesión
 * con tres tomas sin releer que solo diga «listo» es la pérdida silenciosa que
 * toda esta app trata de evitar.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as fmt from './formato.js';

let app = null;
let salida = null;

export function conectar(contexto) {
    app = contexto;
    $('#cierre-resumen').addEventListener('click', alClic);
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
        return;
    }

    const vivas = salida.tomas.filter(t => !t.descartada);
    const sinReleer = salida.tomas.filter(t => t.relectura && t.relectura.estado === 'sin-leer');
    const chicas = salida.tomas.filter(t => t.relectura && t.relectura.estado === 'degradada');
    const problemas = (salida.comprobacion && salida.comprobacion.problemas) || [];

    $('#cierre-resumen').innerHTML = `
      <div class="tarjeta guarda" data-estado="terminada">
        <div class="tarjeta-cabeza">
          <span class="hp-ico" style="color:var(${problemas.length ? '--warn' : '--ok'})">${icono(problemas.length ? 'atencion' : 'ok')}</span>
          <span class="v1">${esc(salida.secuencia)}</span>
          <span class="pastilla" data-estado="${problemas.length ? 'en silencio' : 'terminada'}">${problemas.length ? 'revisar' : 'terminada'}</span>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="contadores" style="margin-bottom:16px">
            ${contador(vivas.length, `toma${vivas.length === 1 ? '' : 's'}`)}
            ${contador(fmt.duracion(salida.segundos), 'de audio')}
            ${contador(fmt.relojCorto(cortados()), 'la clase cortada')}
          </div>

          ${problemas.length ? avisoDeComprobacion(problemas) : ''}
          ${sinReleer.length || chicas.length ? aviso(sinReleer, chicas) : ''}

          <p class="v3" style="margin-bottom:4px">El XML, listo para importar en Premiere:</p>
          <div class="oyendo" style="min-height:0">${esc(salida.archivos.xml)}</div>
          <p class="v3" style="margin:12px 0 4px">
            Adentro va el audio en A1, y los mismos marcadores van tres veces: en la
            secuencia, en el clip de A1 y en el clip maestro del WAV. Los del maestro
            son los que acompañan al audio si lo arrastrás a otra secuencia o lo metés
            en un multicámara. La sincronía con las cámaras va por forma de onda.
          </p>

          <div class="campo-fila" style="margin-top:16px">
            <button class="btn btn-primario" type="button" data-hace="finder"
                    title="Abrir el Finder con el XML de esta clase seleccionado, listo para arrastrarlo a Premiere">
              ${icono('finder')} Mostrar el XML en el Finder</button>
            <button class="btn" type="button" data-hace="rehacer-xml"
                    title="Reescribe el XML con el formato de esta versión. No relee el audio ni toca las notas: es para cuando una versión nueva arregla algo del archivo.">
              ${icono('xml')} Rehacer el XML</button>
            <button class="btn" type="button" data-hace="sesiones"
                    title="Volver a la lista de clases de la carpeta">Volver a Sesiones</button>
          </div>
        </div>
      </div>`;
}

/**
 * Cuánto dura la clase cortada: lo que el editor va a entregar.
 *
 * La misma cuenta que la barra de En vivo (`segundosCortados`): la suma de las
 * tomas que van al XML, no lo que duró la grabación. Es el número que contesta
 * «¿cuánto material hay?», que es lo que se pregunta al terminar.
 */
function cortados() {
    return salida.tomas
        .filter(t => !t.descartada && t.inMs != null && t.outMs != null)
        .reduce((n, t) => n + (t.outMs - t.inMs), 0) / 1000;
}

function contador(valor, rotulo) {
    return `<div class="contador">
      <span class="contador-num">${esc(valor)}</span>
      <span class="rotulo">${esc(rotulo)}</span></div>`;
}

/**
 * Lo que la comprobación del motor encontró al terminar (`comprobar-clase.js`).
 * Va primero: un audio al que le faltan segundos es más grave que un texto
 * leído con el modelo chico.
 */
function avisoDeComprobacion(problemas) {
    return `<div class="aviso" style="margin-bottom:16px">${icono('atencion')}
      <span>Al terminar se revisó la clase, y hay algo que mirar antes de entregarla:
      ${problemas.map(p => esc(p)).join(' ')}</span></div>`;
}

function aviso(sinReleer, chicas) {
    const partes = [];
    if (sinReleer.length) {
        partes.push(`${sinReleer.length} toma(s) quedaron con el texto del ciclo rápido: ` +
            'Whisper no pudo con ellas mientras se grababa.');
    }
    if (chicas.length) {
        partes.push(`${chicas.length} se leyeron con un modelo más chico porque el sistema ` +
            'se llevó al grande.');
    }
    return `<div class="aviso" style="margin-bottom:16px">${icono('atencion')}
      <span>${esc(partes.join(' '))} El XML está completo igual —los tiempos son los
      buenos—, pero el texto de esas tomas no. «Regenerar» en la lista de sesiones las
      vuelve a leer ahora que la máquina está libre.</span></div>`;
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    if (boton.dataset.hace === 'finder') window.nt.reveal(salida.archivos.xml);
    if (boton.dataset.hace === 'sesiones') app.irASesiones();
    if (boton.dataset.hace === 'rehacer-xml') {
        boton.disabled = true;
        const r = await window.nt.grabarRehacerXml(salida.archivos.json);
        boton.disabled = false;
        avisar(r.ok
            ? `XML rehecho: ${r.tomas} toma${r.tomas === 1 ? '' : 's'}.`
            : r.error, r.ok ? 'ok' : 'error');
    }
}
