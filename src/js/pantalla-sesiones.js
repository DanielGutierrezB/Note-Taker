/**
 * pantalla-sesiones.js — El curso y sus clases.
 *
 * Es la primera pantalla y la que más se ve la primera vez que alguien abre la
 * app, así que su trabajo no es listar: es decir qué hacer.
 *
 *   · Sin carpeta —o cambiando de curso—, un solo botón para elegirla, y debajo
 *     las que se usaron hace poco, con su nombre y su ruta.
 *   · Con carpeta, el curso es el título. Sin clases, «Nueva sesión» va al
 *     centro; con clases, va arriba de la lista, y «Crear proyecto» al borde
 *     derecho.
 *   · La lista tiene dos vistas: cómoda, con filas altas, y compacta, una fila
 *     por clase en columnas, que es la que se pone sola con muchas clases (un
 *     curso llega a 80). Lo que se hace con una clase está en el menú «···»,
 *     cada cosa con su nombre y lo que hace.
 */

import { $, $$, esc, avisar, verVista, pref } from './chrome.js';
import { icono } from './iconos.js';
import { duracion, cuando } from './formato.js';
import * as estados from './estados.js';
import * as panelPrproj from './panel-prproj.js';

let app = null;
let sesiones = [];
/** El sidecar de la sesión cuyo nombre se está editando, o null. */
let renombrando = null;
/** Si se está eligiendo otro curso con uno ya elegido («Cambiar de curso»). */
let eligiendo = false;

/** Desde cuántas clases la lista pasa sola a la vista compacta. */
const PARA_COMPACTA = 8;

export function conectar(contexto) {
    app = contexto;

    $('#ses-hero-icono').innerHTML = icono('carpeta');
    $('#btn-elegir-carpeta').addEventListener('click', elegirCarpeta);
    $('#btn-cancelar-elegir').addEventListener('click', () => { eligiendo = false; pintar(); });
    $('#btn-cambiar-carpeta').addEventListener('click', () => { eligiendo = true; pintar(); });
    $('#btn-abrir-carpeta').addEventListener('click', () => {
        if (app.ajustes.carpeta) window.nt.reveal(app.ajustes.carpeta);
    });
    $('#btn-nueva').addEventListener('click', nueva);
    $('#ses-recientes').addEventListener('click', e => {
        const fila = e.target.closest('[data-carpeta]');
        if (fila && !fila.disabled) usarCarpeta(fila.dataset.carpeta);
    });
    for (const b of $$('[data-vista-lista]')) {
        b.addEventListener('click', () => {
            pref.guardar('sesiones.vista', b.dataset.vistaLista);
            pintarLista();
        });
    }
    $('#lista-sesiones').addEventListener('click', alClic);
    $('#lista-sesiones').addEventListener('keydown', alTecla);
    $('#ses-menu').addEventListener('click', e => { cerrarMenu(); alClic(e); });
    document.addEventListener('click', e => {
        if (!e.target.closest('#ses-menu, [data-hace="menu"]')) cerrarMenu();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });
    $('#btn-prproj').addEventListener('click', () => panelPrproj.abrir(app.ajustes.carpeta));
    panelPrproj.conectar();
}

function nueva() {
    if (!app.ajustes.carpeta) {
        avisar('Primero elegí la carpeta del curso.');
        return;
    }
    app.irAPreparar();
}

async function elegirCarpeta() {
    const ruta = await window.nt.pickFolder({
        titulo: 'Elegí la carpeta del curso, donde van a caer las notas',
        boton: 'Usar esta carpeta'
    });
    if (ruta) await usarCarpeta(ruta);
}

async function usarCarpeta(ruta) {
    app.ajustes = await window.nt.carpetaRecordar(ruta);
    eligiendo = false;
    await pintar();
}

export async function pintar() {
    cerrarMenu();
    const carpeta = app.ajustes.carpeta;
    const elegir = !carpeta || eligiendo;
    $('#ses-elegir').hidden = !elegir;
    $('#ses-curso').hidden = elegir;
    $('#btn-cancelar-elegir').hidden = !carpeta;
    if (elegir) return pintarRecientes();

    const [info] = await window.nt.grabarCarpetas([carpeta]);
    $('#curso-titulo').textContent = (info && info.nombre) || carpeta;
    $('#carpeta-ruta').textContent = carpeta;
    const siguiente = await window.nt.grabarNombreSiguiente(carpeta);
    $('#curso-ejemplo').textContent = (siguiente && siguiente.corto) || '—';

    sesiones = await window.nt.grabarListar([carpeta]);
    const hay = sesiones.length > 0;
    $('#sesiones-cuantas').textContent = `${sesiones.length} en este curso`;
    $('#ses-barra').hidden = !hay;
    $('#ses-lista-cabeza').hidden = !hay;
    if (renombrando && !sesiones.some(s => s.archivos.json === renombrando)) renombrando = null;
    pintarLista(siguiente);
}

/**
 * Las carpetas que se usaron hace poco: el nombre en grande y la ruta en chico,
 * para poder ir a buscarla. Una que ya no está en el disco se ve, apagada.
 */
async function pintarRecientes() {
    const caja = $('#ses-recientes');
    const rutas = app.ajustes.carpetas || [];
    if (!rutas.length) {
        caja.innerHTML = '';
        return;
    }
    const lista = await window.nt.grabarCarpetas(rutas);
    caja.innerHTML = `<div class="ses-recientes-titulo">Abiertas hace poco</div>
      <div class="ses-recientes">${lista.map(c => `
        <button class="ses-reciente" type="button" data-carpeta="${esc(c.ruta)}" ${c.existe ? '' : 'disabled'}
                title="${esc(c.existe ? `Abrir ${c.ruta}` : `${c.ruta} no está: puede ser un disco desconectado`)}">
          <span class="ses-reciente-icono">${icono('carpeta')}</span>
          <span class="ses-reciente-texto">
            <span class="ses-reciente-nombre">${esc(c.nombre)}${c.ruta === app.ajustes.carpeta ? ' <span class="v3">· el actual</span>' : ''}</span>
            <span class="ses-reciente-ruta">${esc(c.ruta)}</span>
          </span>
          <span class="ses-reciente-dato">${!c.existe ? 'no está en el disco'
            : `${c.ultimaMs ? `${esc(cuando(c.ultimaMs))} · ` : ''}${c.clases} clase${c.clases === 1 ? '' : 's'}`}</span>
        </button>`).join('')}</div>`;
}

/** Cómoda o compacta: la elegida a mano, o la que toca por cuántas clases hay. */
function vistaDeLaLista() {
    const elegida = pref.leer('sesiones.vista', null);
    if (elegida === 'compacta' || elegida === 'comoda') return elegida;
    return sesiones.length > PARA_COMPACTA ? 'compacta' : 'comoda';
}

function pintarLista(siguiente) {
    const lista = $('#lista-sesiones');
    if (!sesiones.length) {
        lista.className = 'ses-lista';
        lista.innerHTML = vacio(siguiente);
        return;
    }
    const vista = vistaDeLaLista();
    for (const b of $$('[data-vista-lista]')) b.setAttribute('aria-pressed', String(b.dataset.vistaLista === vista));
    lista.className = `ses-lista es-${vista}`;
    lista.innerHTML = vista === 'compacta'
        ? `<div class="ses-tabla-cabeza"><span>N.º</span><span>Fecha</span><span>Duración</span><span>Tomas</span>
             <span>Estado</span><span>Archivo</span><span></span></div>${sesiones.map(filaCompacta).join('')}`
        : sesiones.map(filaComoda).join('');
    const campo = $('#lista-sesiones [data-campo="numero"]');
    if (campo) {
        campo.focus();
        campo.select();
    }
}

function vacio(siguiente) {
    return `<div class="ses-vacio">
        <div class="ses-hero-icono">${icono('claqueta')}</div>
        <span class="ses-vacio-titulo">Todavía no grabaste ninguna clase en este curso</span>
        <span class="ses-vacio-dice">Antes de grabar elegís el audio y la cámara y revisás el nombre de la clase.
          Nada se graba hasta que aprietes Iniciar.</span>
        <button class="btn btn-primario btn-grande" type="button" data-hace="nueva">Nueva sesión</button>
        ${siguiente && siguiente.corto ? `<span class="ses-proxima">La primera va a ser la <code>${esc(siguiente.corto)}</code></span>` : ''}
      </div>`;
}

/** Lo que se repite en las dos vistas de una fila. */
function datosDeFila(s) {
    const r = s.resumen || {};
    // Mientras se regenera, la fila entera se apaga: el motor tampoco deja
    // tocarla (`siEstaOcupada` en sesiones-grabadas.js), y un botón que se
    // aprieta y contesta que no es peor que uno apagado.
    const ocupada = regenerandoAhora.has(s.archivos.json);
    // Grabándose en otra Mac de la misma carpeta: tampoco se toca, y el motor
    // lo rechaza igual si se intenta desde el menú.
    const enOtra = r.estado === 'grabando en otra mac';
    const est = ocupada
        ? { clave: 'releyendo', palabra: 'releyendo', porque: 'Se está releyendo con el modelo grande.' }
        : estados.deSesionGuardada(r);
    return {
        r,
        ocupada,
        apagado: ocupada || enOtra ? 'disabled' : '',
        est,
        numero: s.numero != null ? String(s.numero).padStart(2, '0') : '—',
        vez: s.vez > 1 ? s.vez : null,
        editando: renombrando === s.archivos.json,
        reanudar: r.estado === 'abierta'
    };
}

const pastilla = est => `<span class="pastilla" data-estado="${est.clave}" ${est.porque ? `title="${esc(est.porque)}"` : ''}>${esc(est.palabra)}</span>`;

function acciones(s, d) {
    return `${d.reanudar
        ? `<button class="btn btn-primario" type="button" data-hace="reanudar" ${d.apagado}
                 title="Seguir grabando esta clase, que quedó abierta: el audio y las tomas nuevas se suman a las que ya tiene">Reanudar</button>` : ''}
      <button class="btn" type="button" data-hace="notas" ${d.apagado}
              title="Abrir las notas de esta clase en la misma vista de cuando se tomaron. No se graba nada: lo que ajustes se escribe en su XML en el acto.">Abrir notas</button>
      <button class="btn btn-tenue btn-ico ses-mas" type="button" data-hace="menu" aria-haspopup="menu"
              aria-label="Más acciones" title="Mostrar en Finder, volver a armar el XML, releer, cambiar el número o borrar">···</button>`;
}

/** Una fila alta: el número grande, la fecha y el estado, y el archivo en chico. */
function filaComoda(s) {
    const d = datosDeFila(s);
    return `<div class="ses-fila" data-json="${esc(s.archivos.json)}" data-estado="${d.est.clave}">
      <span class="ses-num">${d.numero}</span>
      <div class="ses-fila-texto">
        ${d.editando ? campoDeNombre(s) : `<div class="ses-fila-titulo">${esc(cuando(s.ceroMs))} ${pastilla(d.est)}
          ${d.vez ? `<span class="v3">vez ${d.vez} (V${d.vez})</span>` : ''}</div>
        <div class="ses-fila-meta"><span>${esc(duracion(d.r.segundos))}</span>
          <span>${d.r.tomas || 0} toma${d.r.tomas === 1 ? '' : 's'}</span>
          <span class="ses-archivo">${esc(s.secuencia)}</span></div>`}
      </div>
      <div class="ses-acciones">${acciones(s, d)}</div>
    </div>`;
}

/** Una fila de 34 px, en columnas: la que se usa con muchas clases. */
function filaCompacta(s) {
    const d = datosDeFila(s);
    return `<div class="ses-fila-c ${d.reanudar ? 'es-abierta' : ''}" data-json="${esc(s.archivos.json)}" data-estado="${d.est.clave}">
      <span class="ses-num-c">${d.numero}${d.vez ? `<small>V${d.vez}</small>` : ''}</span>
      ${d.editando ? `<span class="ses-renombre-c">${campoDeNombre(s)}</span>` : `
      <span>${esc(cuando(s.ceroMs))}</span>
      <span>${esc(duracion(d.r.segundos))}</span>
      <span>${d.r.tomas || 0}</span>
      <span>${pastilla(d.est)}</span>
      <span class="ses-archivo" title="${esc(s.secuencia)}">${esc(s.secuencia)}</span>`}
      <span class="ses-acciones">${acciones(s, d)}</span>
    </div>`;
}

/* ─── El menú «···» ───────────────────────────────────────────────────── */

const ACCIONES_DEL_MENU = [
    ['xml', 'finder', 'Mostrar en Finder', 'El XML de esta clase, en su carpeta.'],
    ['rehacer-xml', 'xml', 'Volver a armar el XML', 'Con las notas como están. Para reimportar en Premiere.'],
    ['regenerar', 'regenerar', 'Releer todo con el modelo grande', 'Rehace el texto de cada toma. Tarda unos minutos.'],
    ['renombrar', 'renombrar', 'Cambiar el número de clase', 'Renombra el XML, el audio y las fotos.'],
    null,
    ['borrar', 'borrar', 'Borrar la clase', 'Pregunta antes de borrar el XML, el audio y las notas.']
];

function abrirMenu(boton, json) {
    const menu = $('#ses-menu');
    if (!menu.hidden && menu.dataset.json === json) return cerrarMenu();
    const ocupada = regenerandoAhora.has(json);
    menu.dataset.json = json;
    menu.innerHTML = ACCIONES_DEL_MENU.map(a => (a ? `
      <button class="ses-menu-item ${a[0] === 'borrar' ? 'es-peligro' : ''}" type="button" role="menuitem"
              data-hace="${a[0]}" ${ocupada && a[0] !== 'xml' ? 'disabled' : ''}>
        <span class="ses-menu-icono">${icono(a[1])}</span>
        <span><b>${a[2]}</b><span>${a[3]}</span></span>
      </button>` : '<div class="ses-menu-sep"></div>')).join('');
    const caja = boton.getBoundingClientRect();
    const vista = $('#vista-sesiones').getBoundingClientRect();
    menu.hidden = false;
    const alto = menu.offsetHeight;
    const abajo = caja.bottom + 4 + alto < window.innerHeight;
    menu.style.top = `${(abajo ? caja.bottom + 4 : caja.top - 4 - alto) - vista.top}px`;
    menu.style.left = `${Math.max(8, caja.right - menu.offsetWidth - vista.left)}px`;
    boton.setAttribute('aria-expanded', 'true');
    menu.querySelector('button:not([disabled])').focus({ preventScroll: true });
}

function cerrarMenu() {
    const menu = $('#ses-menu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    for (const b of $$('[data-hace="menu"][aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
}

/**
 * El número de clase de una sesión mientras se lo cambia.
 *
 * **Se edita el número y nada más.** El resto del nombre —el curso, la fecha y
 * la hora— se ve fijo al lado del campo: es lo que dice que no se va a perder
 * cuándo se grabó, que es lo que el editor empareja con los archivos de la
 * cámara y lo que ordena la lista.
 *
 * Es `number` y no texto para que en una Mac salga con sus flechitas y para que
 * el teclado del sistema no ofrezca letras. Dejarlo vacío le quita el número.
 */
function campoDeNombre(s) {
    const numero = s.numero != null ? s.numero : '';
    const base = sinNumero(s);
    return `<span class="ses-renombre">
        <input type="number" min="1" step="1" data-campo="numero" value="${esc(numero)}"
               placeholder="—" aria-label="Número de clase de ${esc(base)}">
        <span class="ses-base">_${esc(base)}</span>
        <button class="btn" type="button" data-hace="guardar-nombre"
                title="Renombra el XML, el audio y los datos de esta clase, y la secuencia que importás en Premiere. Si ese número ya está en la carpeta, esta queda como V2.">
          Guardar</button>
        <span class="v3">Enter guarda · Esc cancela</span>
      </span>`;
}

/**
 * El nombre sin el número ni la vez: lo que no se toca al renombrar.
 *
 * Se recorta del nombre de verdad y no se rearma con el curso y la fecha, que
 * sería armar un nombre por segunda vez fuera de `nombre-de-sesion.js`. Si el
 * recorte no cuadra se muestra el nombre entero, que es peor pero cierto.
 */
function sinNumero(s) {
    const marca = s.numero == null
        ? null
        : `${String(s.numero).padStart(2, '0')}_${s.vez > 1 ? `V${s.vez}_` : ''}`;
    return marca && s.secuencia.startsWith(marca) ? s.secuencia.slice(marca.length) : s.secuencia;
}

function alTecla(e) {
    const campo = e.target.closest('[data-campo="numero"]');
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
    if (boton && boton.dataset.hace === 'nueva') return nueva();
    const fila = e.target.closest('[data-json]');
    if (!boton || !fila) return;
    const json = fila.dataset.json;
    const sesion = sesiones.find(s => s.archivos.json === json);
    if (!sesion) return;

    switch (boton.dataset.hace) {
        case 'menu':
            abrirMenu(boton, json);
            break;
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
            await regenerar(json);
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
    avisar(`XML rehecho: ${r.tomas} toma${r.tomas === 1 ? '' : 's'}.`, 'ok');
}

/** Las sesiones que se están regenerando ahora, para dibujar su fila apagada. */
const regenerandoAhora = new Set();

async function regenerar(json) {
    regenerandoAhora.add(json);
    await pintar();
    avisar('Releyendo las tomas con el modelo grande…');
    let r;
    try {
        r = await window.nt.grabarRegenerar(json);
    } finally {
        regenerandoAhora.delete(json);
    }
    if (!r.ok) { avisar(r.error, 'error'); await pintar(); return; }
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
 * Guarda el número de clase. Renombra los tres archivos de la sesión —el XML,
 * los datos y el audio— y la secuencia que se ve en Premiere.
 *
 * Antes esto pedía el nombre con `window.prompt`, que Electron no tiene: tira
 * «prompt() is not supported», así que el lápiz nunca hizo nada. Por eso el
 * número se edita en la fila misma.
 */
async function guardarNombre() {
    const json = renombrando;
    const campo = $('#lista-sesiones [data-campo="numero"]');
    if (!json || !campo) return;
    const r = await window.nt.grabarRenombrar(json, { numero: campo.value });
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
