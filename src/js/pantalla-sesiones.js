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
import * as panelPrproj from './panel-prproj.js';

let app = null;
let sesiones = [];
/** El sidecar de la sesión cuyo nombre se está editando, o null. */
let renombrando = null;

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
    $('#lista-sesiones').addEventListener('keydown', alTecla);
    $('#btn-prproj').addEventListener('click', () => panelPrproj.abrir(app.ajustes.carpeta));
    panelPrproj.conectar();
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
    // Sin clases no hay nada que precortar ni ninguna claqueta que marcar.
    $('#btn-prproj').hidden = !sesiones.length;
    if (renombrando && !sesiones.some(s => s.archivos.json === renombrando)) renombrando = null;
    $('#lista-sesiones').innerHTML = sesiones.length ? sesiones.map(fila).join('') : vacio(carpeta);
    const campo = $('#lista-sesiones [data-campo="prefijo"]');
    if (campo) {
        campo.focus();
        campo.select();
    }
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
    const editando = renombrando === s.archivos.json;
    return `<div class="fila guarda ${editando ? 'es-renombrando' : ''}" data-estado="${est.clave}" data-json="${esc(s.archivos.json)}"
        ${est.porque && !editando ? `title="${esc(est.porque)}"` : ''}>
      ${editando ? campoDeNombre(s) : `<span class="fila-nombre">${esc(s.secuencia)}</span>`}
      <span class="fila-dato ses-dato">${esc(cuando(s.ceroMs))}</span>
      <span class="fila-dato ses-dato">${esc(duracion(r.segundos))}</span>
      <span class="fila-dato ses-dato">${r.tomas || 0} toma${r.tomas === 1 ? '' : 's'}</span>
      <span class="fila-dato ses-dato">${r.claquetas || 0} claqueta${r.claquetas === 1 ? '' : 's'}</span>
      <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      <span class="crece"></span>
      ${puedeReanudar
        ? `<button class="btn" type="button" data-hace="reanudar"
                   title="Seguir grabando esta clase, que quedó abierta: el audio y las tomas nuevas se suman a las que ya tiene">
             Reanudar</button>` : ''}
      <button class="btn" type="button" data-hace="notas"
              title="Abrir las notas de esta clase en la misma vista de cuando se tomaron.
No se graba nada: lo que ajustes se escribe en su XML en el acto.">Notas</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="xml"
              title="Mostrar el XML en el Finder">${icono('finder')}</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="rehacer-xml"
              title="Rehacer el XML con el formato de esta versión, sin releer el audio ni tocar las notas">${icono('xml')}</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="regenerar"
              title="Volver a leer todas las tomas con el modelo grande">${icono('regenerar')}</button>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="renombrar"
              aria-pressed="${editando}"
              title="${editando ? 'Dejar el nombre como estaba' : 'Ponerle un nombre delante del que puso la app'}">${icono('renombrar')}</button>
      <button class="btn btn-tenue btn-ico btn-peligro" type="button" data-hace="borrar"
              title="Borrar el XML, el audio y los datos">${icono('borrar')}</button>
    </div>`;
}

/**
 * El nombre de una sesión mientras se lo cambia.
 *
 * Lo que se escribe va DELANTE del nombre que puso la app, y ese nombre se ve
 * fijo al lado del campo mientras tanto: es lo que dice que no se va a perder
 * la fecha ni la hora, que son las que ordenan la lista y las que el editor
 * empareja con la cámara.
 */
function campoDeNombre(s) {
    const prefijo = s.prefijo || '';
    const base = prefijo && s.secuencia.startsWith(`${prefijo}_`)
        ? s.secuencia.slice(prefijo.length + 1)
        : s.secuencia;
    return `<span class="ses-renombre">
        <input type="text" data-campo="prefijo" value="${esc(prefijo)}"
               placeholder="Nombre" aria-label="Nombre delante de ${esc(base)}">
        <span class="ses-base">_${esc(base)}</span>
        <button class="btn" type="button" data-hace="guardar-nombre">Guardar</button>
        <span class="v3">Enter guarda · Esc cancela</span>
      </span>`;
}

function alTecla(e) {
    const campo = e.target.closest('[data-campo="prefijo"]');
    if (!campo) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        guardarNombre();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        renombrando = null;
        pintar();
    }
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
        case 'notas':
            await verNotas(json);
            break;
        case 'regenerar':
            await regenerar(json, boton);
            break;
        case 'rehacer-xml':
            await rehacerXml(json, boton);
            break;
        case 'renombrar':
            renombrando = renombrando === json ? null : json;
            await pintar();
            break;
        case 'guardar-nombre':
            await guardarNombre();
            break;
        case 'borrar':
            await borrar(sesion);
            break;
    }
}

/**
 * Abrir las notas de una clase grabada, en la pantalla de la clase.
 *
 * El editor: «en esta interfaz debería poder entrar nuevamente a mis notas
 * anteriores como en la vista de cuando las estoy tomando […] por si deseo
 * ajustar una nota desde ahí directamente.»
 *
 * El motor contesta el mismo estado que manda grabando, con `grabando: false`
 * (ver `paraMirar`), y la pantalla de la clase lo dibuja sin el cromo de grabar.
 * Puede negarse —la clase que se está grabando ahora no se abre por acá, esa ya
 * tiene su pantalla— y el motivo se muestra tal cual.
 */
async function verNotas(json) {
    const r = await window.nt.grabarAbrirGrabada(json);
    if (!r.ok) return avisar(r.error, 'error');
    app.irANotas(r.estado);
}

/**
 * Rehacer el XML sin releer el audio.
 *
 * El otro botón —«Regenerar»— vuelve a pasar cada toma por Whisper y tarda lo
 * que tarda el modelo grande. Este solo reescribe el archivo con el molde de
 * hoy, en un segundo: es para llevarle a una clase ya grabada un arreglo del
 * XML (un marcador que ahora dice el número de la toma, los marcadores del
 * clip maestro) sin volver a tocar una sola palabra de las notas.
 */
async function rehacerXml(json, boton) {
    boton.disabled = true;
    const r = await window.nt.grabarRehacerXml(json);
    boton.disabled = false;
    if (!r.ok) { avisar(r.error, 'error'); return; }
    avisar(`XML rehecho: ${r.tomas} toma${r.tomas === 1 ? '' : 's'} y ` +
        `${r.claquetas} claqueta${r.claquetas === 1 ? '' : 's'}.`, 'ok');
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

/**
 * Guarda el nombre de delante. Renombra los tres archivos de la sesión —el XML,
 * los datos y el audio— y la secuencia que se ve en Premiere.
 *
 * Antes esto pedía el nombre con `window.prompt`, que Electron no tiene: tira
 * «prompt() is not supported», así que el lápiz nunca hizo nada. Por eso el
 * nombre se edita en la fila misma.
 */
async function guardarNombre() {
    const json = renombrando;
    const campo = $('#lista-sesiones [data-campo="prefijo"]');
    if (!json || !campo) return;
    const r = await window.nt.grabarRenombrar(json, { prefijo: campo.value });
    if (!r.ok) {
        // El campo se queda abierto con lo escrito: el motivo suele ser que ya
        // hay otra sesión con ese nombre, y se corrige cambiando una letra.
        avisar(r.error, 'error');
        return;
    }
    renombrando = null;
    avisar(r.movida ? `Ahora se llama ${r.secuencia}` : 'El nombre quedó igual.', r.movida ? 'ok' : 'normal');
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
            `(${duracion(r.segundos)}), los datos de la sesión`
            + (r.fotos ? ` y ${r.fotos === 1 ? 'la foto de referencia' : `las ${r.fotos} fotos de referencia`}` : '')
            + '. Esto no se puede deshacer.'
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
