/**
 * pantalla-sesiones.js — La carpeta del curso y lo que hay adentro.
 *
 * Es la primera pantalla y la que más se ve la primera vez que alguien abre la
 * app, así que su trabajo no es listar: es decir qué hacer. Sin carpeta
 * elegida, lo único encendido es «Elegir carpeta…»; con carpeta y sin sesiones,
 * el vacío dice qué va a pasar cuando se apriete «Nueva sesión».
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import { duracion, cuando } from './formato.js';
import * as estados from './estados.js';

let app = null;
let sesiones = [];

export function conectar(contexto) {
    app = contexto;

    $('#btn-elegir-carpeta').addEventListener('click', elegirCarpeta);
    $('#btn-abrir-carpeta').addEventListener('click', () => {
        if (app.ajustes.carpeta) window.nt.reveal(app.ajustes.carpeta);
    });
    $('#btn-nueva').addEventListener('click', () => {
        if (!app.ajustes.carpeta) {
            avisar('Primero elegí la carpeta donde van a caer las notas.');
            return;
        }
        app.irAPreparar();
    });
    $('#lista-sesiones').addEventListener('click', alClic);
}

async function elegirCarpeta() {
    const ruta = await window.nt.pickFolder({
        titulo: 'Elegí la carpeta del curso, donde van a caer las notas',
        boton: 'Usar esta carpeta'
    });
    if (!ruta) return;
    app.ajustes = await window.nt.carpetaRecordar(ruta);
    await pintar();
}

export async function pintar() {
    const carpeta = app.ajustes.carpeta;
    $('#carpeta-ruta').textContent = carpeta || 'Todavía no elegiste ninguna';
    $('#btn-abrir-carpeta').hidden = !carpeta;
    $('#btn-nueva').disabled = !carpeta;

    sesiones = carpeta ? await window.nt.grabarListar([carpeta]) : [];
    $('#sesiones-cuantas').textContent = sesiones.length
        ? `${sesiones.length} en esta carpeta` : '';
    $('#lista-sesiones').innerHTML = sesiones.length ? sesiones.map(fila).join('') : vacio(carpeta);
}

function vacio(carpeta) {
    if (!carpeta) {
        return `<div class="vacio">${icono('carpeta')}
            <span class="vacio-titulo">Elegí una carpeta para empezar</span>
            <span class="v3">Una carpeta es un curso: todas las clases que grabes van a
              caer ahí, y el editor abre siempre el mismo sitio.</span></div>`;
    }
    return `<div class="vacio">${icono('claqueta')}
        <span class="vacio-titulo">Todavía no hay ninguna clase grabada acá</span>
        <span class="v3">«Nueva sesión» abre la lista de verificación: la entrada de
          audio, Whisper y el nombre. Nada se graba hasta que aprietes Iniciar.</span></div>`;
}

/**
 * Una fila de sesión: 32 px, con lo que se necesita para elegir cuál abrir y
 * nada más. El estado va en palabras, que es lo que distingue una sesión que
 * se puede reanudar de una que ya está lista.
 */
function fila(s) {
    const r = s.resumen || {};
    const est = estados.deSesionGuardada(r);
    const puedeReanudar = r.estado === 'abierta';
    return `<div class="fila guarda" data-estado="${est.clave}" data-json="${esc(s.archivos.json)}"
        ${est.porque ? `title="${esc(est.porque)}"` : ''}>
      <span class="fila-nombre">${esc(s.secuencia)}</span>
      <span class="fila-dato ses-dato">${esc(cuando(s.ceroMs))}</span>
      <span class="fila-dato ses-dato">${esc(duracion(r.segundos))}</span>
      <span class="fila-dato ses-dato">${r.tomas || 0} toma${r.tomas === 1 ? '' : 's'}</span>
      <span class="fila-dato ses-dato">${r.claquetas || 0} claqueta${r.claquetas === 1 ? '' : 's'}</span>
      <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      <span class="crece"></span>
      ${puedeReanudar
        ? `<button class="btn" type="button" data-hace="reanudar">Reanudar</button>` : ''}
      <button class="btn btn-tenue btn-ico" type="button" data-hace="xml"
              title="Mostrar el XML en el Finder">${icono('finder')}</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="regenerar"
              title="Volver a leer todas las tomas con el modelo grande">${icono('regenerar')}</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="renombrar"
              title="Cambiar el nombre del curso">${icono('renombrar')}</button>
      <button class="btn btn-tenue btn-ico btn-peligro" type="button" data-hace="borrar"
              title="Borrar el XML, el audio y los datos">${icono('borrar')}</button>
    </div>`;
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    const fila = e.target.closest('[data-json]');
    if (!boton || !fila) return;
    const json = fila.dataset.json;
    const sesion = sesiones.find(s => s.archivos.json === json);
    if (!sesion) return;

    switch (boton.dataset.hace) {
        case 'xml':
            window.nt.reveal(sesion.archivos.xml);
            break;
        case 'reanudar':
            app.irAPreparar({ reanudar: json, sesion });
            break;
        case 'regenerar':
            await regenerar(json, boton);
            break;
        case 'renombrar':
            await renombrar(sesion);
            break;
        case 'borrar':
            await borrar(sesion);
            break;
    }
}

async function regenerar(json, boton) {
    boton.disabled = true;
    avisar('Releyendo las tomas con el modelo grande…');
    const r = await window.nt.grabarRegenerar(json);
    boton.disabled = false;
    if (!r.ok) { avisar(r.error, 'error'); return; }
    // Se dice lo que NO se pudo además de lo que sí: «8 tomas releídas» cuando
    // tres quedaron sin leer es la misma pérdida silenciosa que este botón
    // vino a arreglar.
    const faltas = [];
    if (r.sinLeer) faltas.push(`${r.sinLeer} sin leer`);
    if (r.degradadas) faltas.push(`${r.degradadas} con el modelo chico`);
    if (r.sinAudio) faltas.push(`${r.sinAudio} sin audio`);
    avisar(`${r.tomas} toma(s) releídas${faltas.length ? ` · ${faltas.join(', ')}` : ''}`,
        faltas.length ? 'normal' : 'ok');
    await pintar();
}

async function renombrar(sesion) {
    const curso = window.prompt('Nombre del curso', sesion.curso || '');
    if (curso == null) return;
    const r = await window.nt.grabarRenombrar(sesion.archivos.json, { curso });
    if (!r.ok) { avisar(r.error, 'error'); return; }
    avisar(r.movida ? `Ahora se llama ${r.secuencia}` : 'El nombre quedó igual.');
    await pintar();
}

async function borrar(sesion) {
    const r = sesion.resumen || {};
    // Se nombran los tres archivos antes de borrarlos, uno por uno: es la única
    // acción de la app que no se puede deshacer.
    const ok = await window.nt.confirmar({
        titulo: `¿Borrar «${sesion.secuencia}»?`,
        ok: 'Borrar',
        mensaje: 'Se van del disco el XML que importás en Premiere, el audio grabado ' +
            `(${duracion(r.segundos)}) y los datos de la sesión. Esto no se puede deshacer.`
    });
    if (!ok) return;
    const res = await window.nt.grabarBorrar(sesion.archivos.json);
    if (!res.ok) { avisar(res.error, 'error'); return; }
    avisar(`Se borró ${res.secuencia}.`);
    await pintar();
}

export function ver() {
    verVista('vista-sesiones');
    return pintar();
}
