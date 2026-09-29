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

import { $, esc, verVista } from './chrome.js';
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

    $('#cierre-resumen').innerHTML = `
      <div class="tarjeta guarda" data-estado="terminada">
        <div class="tarjeta-cabeza">
          <span class="hp-ico" style="color:var(--ok)">${icono('ok')}</span>
          <span class="v1">${esc(salida.secuencia)}</span>
          <span class="pastilla" data-estado="terminada">terminada</span>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="contadores" style="margin-bottom:16px">
            ${contador(vivas.length, `toma${vivas.length === 1 ? '' : 's'}`)}
            ${contador(salida.claquetas.length,
                `claqueta${salida.claquetas.length === 1 ? '' : 's'}`)}
            ${contador(fmt.duracion(salida.segundos), 'de audio')}
            ${contador(fmt.timecode(salida.segundos, salida.fps), 'timecode final')}
          </div>

          ${sinReleer.length || chicas.length ? aviso(sinReleer, chicas) : ''}

          <p class="v3" style="margin-bottom:4px">El XML, listo para importar en Premiere:</p>
          <div class="oyendo" style="min-height:0">${esc(salida.archivos.xml)}</div>
          <p class="v3" style="margin:12px 0 4px">
            Adentro va el audio en A1 con estos mismos marcadores pegados al clip:
            sincronizá las cámaras contra él y las notas viajan con el WAV.
            ${salida.claquetas.length
                ? `La claqueta 1 está en <strong>${fmt.timecodeDe(salida.claquetas[0].ms,
                    salida.ceroMs, salida.fps)}</strong>, que es contra la que conviene
                   correlacionar los archivos.`
                : 'No quedó ninguna claqueta anotada, así que la sincronía va por forma de onda.'}
          </p>

          <div class="campo-fila" style="margin-top:16px">
            <button class="btn btn-primario" type="button" data-hace="finder">
              ${icono('finder')} Mostrar el XML en el Finder</button>
            <button class="btn" type="button" data-hace="sesiones">Volver a Sesiones</button>
          </div>
        </div>
      </div>`;
}

function contador(valor, rotulo) {
    return `<div class="contador">
      <span class="contador-num">${esc(valor)}</span>
      <span class="rotulo">${esc(rotulo)}</span></div>`;
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

function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    if (boton.dataset.hace === 'finder') window.nt.reveal(salida.archivos.xml);
    if (boton.dataset.hace === 'sesiones') app.irASesiones();
}
