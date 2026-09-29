/**
 * pantalla-vivo.js — La clase mientras se graba.
 *
 * Es la pantalla que se mira de reojo con el profesor hablando, así que todo lo
 * que hay acá está puesto pensando en eso:
 *
 * - **Dos elementos grandes y no más**: el timecode y el estado de la sesión.
 *   Son los dos que hay que poder leer sin acercarse. Todo lo demás vive en la
 *   escala de 13/12/11.
 * - **La tarjeta "Ahora" arriba del todo**, con la toma abierta y su nota en
 *   edición. Es donde está la mano del editor el 90 % del tiempo.
 * - **La lista debajo, en filas de 32 px y en acordeón**: abrir una cierra las
 *   demás. Con veinte tomas desplegadas hay que scrollear para encontrar la que
 *   se busca, y el nombre y el timecode alcanzan para elegir.
 * - **Las teclas escritas en el pie.** Son cinco y se usan con la clase
 *   corriendo: una tecla que hay que recordar es una tecla que no se usa.
 *
 * Nada de acá guarda estado propio de la sesión: el motor manda el estado
 * entero en cada aviso y esto lo dibuja. Lo único que vive en la ventana es
 * qué fila está abierta y cuál está elegida para las teclas, que son dos cosas
 * de la vista y no de la clase.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as fmt from './formato.js';
import * as estados from './estados.js';
import * as oido from './grabar/oido.js';
import { mostrador } from './grabar/turnos.js';

let app = null;
let estado = null;
let audio = null;
let oyendo = '';

/** Lo de la vista y no de la clase: qué está abierto y qué está elegido. */
const vista = { abierta: null, elegida: null };

/** Descarta las respuestas que llegan tarde (`turnos.js`). */
const turno = mostrador();

export function conectar(contexto) {
    app = contexto;

    $('#btn-terminar').addEventListener('click', terminar);
    $('#btn-deshacer').addEventListener('click', () => volver('deshacer'));
    $('#btn-rehacer').addEventListener('click', () => volver('rehacer'));
    $('#btn-deshacer').innerHTML = icono('deshacer');
    $('#btn-rehacer').innerHTML = icono('rehacer');

    $('#ahora').addEventListener('click', alClic);
    $('#lista-vivo').addEventListener('click', alClic);
    $('#lista-claquetas').addEventListener('click', alClic);
    $('#ahora').addEventListener('change', alCambiar);
    $('#lista-vivo').addEventListener('change', alCambiar);

    document.addEventListener('keydown', alTeclado);
    window.nt.onGrabarAviso(alAviso);
}

export function ver(primerEstado, elAudio) {
    estado = primerEstado;
    audio = elAudio;
    vista.abierta = null;
    vista.elegida = null;
    oyendo = '';
    verVista('vista-vivo');
    pintar();
}

/* ─── Lo que llega del motor ─────────────────────────────────────────── */

function alAviso(aviso) {
    if (!aviso) return;
    if (aviso.tipo === 'estado') {
        estado = aviso.estado;
        if (typeof aviso.oyendo === 'string') oyendo = aviso.oyendo;
        for (const ev of aviso.eventos || []) contar(ev);
        pintar();
        return;
    }
    if (aviso.tipo === 'claqueta') {
        avisar(`Claqueta ${aviso.claqueta} anotada (${aviso.por === 'golpe' ? 'aplauso' : 'voz'}).`);
        return;
    }
    if (aviso.tipo === 'error') avisar(aviso.mensaje, 'error');
}

/** Lo que pasó solo se dice; lo que el editor hizo ya lo vio hacer. */
function contar(ev) {
    if (ev.tipo === 'abierta') {
        avisar(ev.por === 'retomamos' ? 'Toma abierta: «Retomamos».' : 'Toma abierta: 3, 2, 1.');
        // La toma que se acaba de abrir pasa a ser la de las teclas: es sobre
        // la que el editor va a escribir la nota y elegir la vista.
        vista.elegida = ev.toma;
    }
    if (ev.tipo === 'cerrada') avisar(`Toma ${ev.toma} cerrada.`);
    if (ev.tipo === 'claqueta') avisar(`Claqueta ${ev.claqueta} anotada (se dijo).`);
}

/* ─── Dibujar ─────────────────────────────────────────────────────────── */

function pintar() {
    if (!estado) return;
    const fps = estado.fps;
    const est = estados.deSesion(estado, audio);

    $('#vivo-tc').textContent = fmt.timecode(estado.segundos, fps);
    $('#vivo-estado').textContent = est.palabra;
    $('#vivo-estado').style.color =
        est.clave === 'sin audio' ? 'var(--error)'
            : (est.clave === 'abierta' || est.clave === 'releyendo' ? 'var(--accent)' : 'var(--ok)');

    const vivas = estado.tomas.filter(t => !t.descartada);
    $('#vivo-tomas').textContent = vivas.length;
    $('#vivo-claquetas').textContent = estado.claquetas.length;
    $('#vivo-cuantas').textContent = estado.tomas.length
        ? `${estado.tomas.length} en total` : '';
    $('#vivo-donde').textContent = estado.archivos ? estado.archivos.xml : '';

    const h = estado.historia || {};
    botonHistoria($('#btn-deshacer'), h.atras, h.queAtras, 'Deshacer');
    botonHistoria($('#btn-rehacer'), h.adelante, h.queAdelante, 'Rehacer');

    $('#ahora').innerHTML = ahora(fps);
    $('#lista-vivo').innerHTML = estado.tomas.length
        ? [...estado.tomas].reverse().map(t => filaToma(t, fps)).join('')
        : `<div class="vacio">${icono('toma')}
             <span class="vacio-titulo">Todavía no hay ninguna toma</span>
             <span class="v3">La primera se abre sola cuando alguien diga «3, 2, 1».</span></div>`;
    $('#lista-claquetas').innerHTML = estado.claquetas.length
        ? estado.claquetas.map(c => filaClaqueta(c, fps)).join('')
        : `<div class="vacio">${icono('claqueta')}
             <span class="vacio-titulo">Sin claquetas</span>
             <span class="v3">Se anotan solas con el aplauso o diciendo «claqueta»,
               y a mano con la tecla K.</span></div>`;
    $('#oyendo-vivo').textContent = oyendo || 'Silencio.';

    if (audio) {
        const barra = $('#vivo-nivel');
        barra.firstElementChild.style.width = `${Math.min(100, (audio.pico || 0) * 140)}%`;
        barra.dataset.pico = audio.pico > 0.95 ? 'clip' : (audio.pico > 0.7 ? 'alto' : '');
    }
}

function botonHistoria(boton, hay, que, verbo) {
    boton.disabled = !hay;
    boton.title = hay ? `${verbo} «${que}»` : `No hay nada que ${verbo.toLowerCase()}`;
}

/**
 * La tarjeta de lo que está pasando ahora.
 *
 * Con una toma abierta muestra su texto entrando y su nota; sin ninguna, dice
 * qué se está esperando — que es información y no un vacío: quien mira quiere
 * saber que la app sigue escuchando.
 */
function ahora(fps) {
    const abierta = estado.tomas.find(t => t.id === estado.abierta);
    if (!abierta) {
        return `<div class="tarjeta"><div class="tarjeta-cabeza">
            <span class="hp-ico" style="color:var(--text-muted)">${icono('oido')}</span>
            <span class="v1">Esperando el «3, 2, 1»</span>
            <span class="pastilla" data-estado="escuchando">escuchando</span>
            <span class="crece"></span>
            <button class="btn" type="button" data-hace="claqueta">
              ${icono('claqueta')} Claqueta</button>
          </div></div>`;
    }

    const texto = (abierta.palabras || []).map(w => esc(w.texto)).join(' ');
    return `<div class="tarjeta guarda" data-estado="abierta">
      <div class="tarjeta-cabeza">
        <span class="v1">Toma ${abierta.id}</span>
        <span class="pastilla" data-estado="abierta">abierta</span>
        <time class="fila-dato tc">${fmt.timecodeDe(abierta.inMs, estado.ceroMs, fps)}</time>
        <span class="crece"></span>
        ${vistas(abierta)}
        <button class="btn" type="button" data-hace="cerrar">
          ${icono('cerrarToma')} Cerrar toma</button>
        <button class="btn" type="button" data-hace="claqueta">
          ${icono('claqueta')} Claqueta</button>
      </div>
      <div class="tarjeta-cuerpo">
        <input type="text" data-campo="nota" data-toma="${abierta.id}"
               value="${esc(abierta.comentario || '')}"
               placeholder="Nota de esta toma — se escribe en el marcador del XML">
        <div class="transcript" style="margin-top:8px">${texto ||
            '<span class="orilla">Todavía no se oyó nada de esta toma.</span>'}</div>
      </div>
    </div>`;
}

/** El selector de vista: cinco rectángulos, uno encendido. */
function vistas(toma) {
    return `<span class="campo-fila" style="gap:2px">${(estado.vistas || []).map(v =>
        `<button class="btn btn-ico" type="button" data-hace="vista" data-vista="${v.nombre}"
           data-toma="${toma.id}" title="${esc(v.titulo)} · tecla ${v.nombre[0]}"
           style="${toma.vista === v.nombre
            ? `border-color:var(--border-field);color:var(--vista-${v.nombre.toLowerCase()})`
            : 'color:var(--text-muted)'}">${v.nombre}</button>`).join('')}</span>`;
}

function filaToma(t, fps) {
    const est = estados.deToma(t, estado);
    const abierta = vista.abierta === `t${t.id}`;
    const dur = t.outMs != null ? (t.outMs - t.inMs) / 1000 : null;
    return `<div class="${abierta ? 'es-abierta' : ''}">
      <div class="fila guarda ${vista.elegida === t.id ? 'es-elegida' : ''}"
           data-estado="${est.clave}" data-toma="${t.id}" data-hace="plegar"
           ${est.porque ? `title="${esc(est.porque)}"` : ''}>
        <span class="chevron">${icono('chevron')}</span>
        <span class="etiqueta-vista" data-vista="${esc(t.vista)}">${esc(t.vista)}</span>
        <span class="fila-nombre">Toma ${t.id}</span>
        <time class="fila-dato tc">${fmt.timecodeDe(t.inMs, estado.ceroMs, fps)}</time>
        ${dur != null ? `<span class="fila-dato">${fmt.duracion(dur)}</span>` : ''}
        <span class="fila-nota">${esc(t.comentario || primeras(t))}</span>
        <span class="crece"></span>
        ${t.repiteA ? `<span class="pastilla" data-estado="por confirmar"
          title="Empieza diciendo casi lo mismo que la toma ${t.repiteA}: puede ser un
          intento repetido">repite la ${t.repiteA}</span>` : ''}
        <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      </div>
      ${abierta ? cuerpoToma(t) : ''}
    </div>`;
}

function primeras(t) {
    return (t.palabras || []).slice(0, 10).map(w => w.texto).join(' ');
}

function cuerpoToma(t) {
    const orilla = ws => (ws || []).map(w => `<span class="orilla">${esc(w.texto)}</span>`).join(' ');
    const dentro = (t.palabras || []).map(w =>
        `<span class="palabra" data-t="${w.t}" data-toma="${t.id}">${esc(w.texto)}</span>`).join(' ');
    return `<div class="tarjeta" style="margin:2px 0 0">
      <div class="tarjeta-cuerpo" style="padding-top:12px">
        <input type="text" data-campo="nota" data-toma="${t.id}"
               value="${esc(t.comentario || '')}" placeholder="Nota de esta toma">
        <div class="transcript" style="margin-top:8px">
          ${orilla(t.antes)} ${dentro} ${orilla(t.despues)}</div>
        <p class="v3" style="margin-top:6px">
          Lo gris es lo que se dijo fuera de los bordes. Clic en una palabra para
          mover el IN o el OUT hasta ahí.</p>
        <div class="campo-fila" style="margin-top:8px">
          ${vistas(t)}
          <span class="crece"></span>
          ${t.descartada
            ? `<button class="btn" type="button" data-hace="recuperar" data-toma="${t.id}">
                 ${icono('recuperar')} Recuperar</button>`
            : `<button class="btn btn-tenue" type="button" data-hace="descartar" data-toma="${t.id}"
                 title="La saca del XML, pero se puede recuperar">
                 ${icono('descartar')} Descartar</button>`}
        </div>
      </div>
    </div>`;
}

/**
 * Una claqueta en el costado.
 *
 * Va en dos renglones y no en uno, que es lo contrario de una fila de toma, y
 * es por el ancho: el costado mide 300 px y acá hay que decir cinco cosas —el
 * número, el timecode, si es la referencia, cómo está y cómo quitarla—. En un
 * renglón, lo primero que se recortaba era el nombre, o sea justo el número
 * con el que el editor la busca en su pizarra.
 *
 * El orden de prioridad queda escrito así: arriba lo que identifica (número y
 * timecode), abajo lo que se confirma (referencia, estado) y la acción.
 */
function filaClaqueta(c, fps) {
    const est = estados.deClaqueta(c);
    return `<div class="fila fila-claqueta guarda" data-estado="${est.clave}"
        data-claqueta="${c.n}" ${est.porque ? `title="${esc(est.porque)}"` : ''}>
      <div class="claqueta-arriba">
        <span class="fila-nombre">Claqueta ${c.n}</span>
        <time class="fila-dato tc">${fmt.timecodeDe(c.ms, estado.ceroMs, fps)}</time>
        <span class="crece"></span>
        <button class="btn btn-tenue btn-ico" type="button" data-hace="quitar-claqueta"
                data-claqueta="${c.n}" title="Quitarla: no era una claqueta">${icono('cerrar')}</button>
      </div>
      <div class="claqueta-abajo">
        ${c.n === 1 ? '<span class="pastilla" data-estado="listo" title="Es contra esta que el editor correlaciona los archivos en Premiere">referencia</span>' : ''}
        <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      </div>
    </div>`;
}

/* ─── Los gestos ──────────────────────────────────────────────────────── */

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    const palabra = e.target.closest('.palabra');
    if (palabra) return moverBorde(palabra);
    if (!boton) return;

    const toma = boton.dataset.toma ? Number(boton.dataset.toma) : null;
    switch (boton.dataset.hace) {
        case 'plegar':
            vista.abierta = vista.abierta === `t${toma}` ? null : `t${toma}`;
            vista.elegida = toma;
            pintar();
            break;
        case 'claqueta': await pedir(() => window.nt.grabarClaqueta()); break;
        case 'cerrar': await pedir(() => window.nt.grabarCerrarToma()); break;
        case 'vista':
            await editar({ tipo: 'vista', toma, vista: boton.dataset.vista });
            break;
        case 'descartar': await editar({ tipo: 'descartar', toma, descartada: true }); break;
        case 'recuperar': await editar({ tipo: 'descartar', toma, descartada: false }); break;
        case 'quitar-claqueta':
            await pedir(() => window.nt.grabarQuitarClaqueta(Number(boton.dataset.claqueta)));
            break;
    }
}

async function alCambiar(e) {
    const campo = e.target.closest('[data-campo="nota"]');
    if (!campo) return;
    await editar({ tipo: 'nota', toma: Number(campo.dataset.toma), texto: campo.value });
}

/**
 * Mover un borde haciendo clic en una palabra.
 *
 * Se pregunta cuál de los dos: un clic sin preguntar sobre un texto de
 * doscientas palabras es un borde movido por accidente, y acá el accidente
 * cuesta una relectura de Whisper con la clase corriendo.
 */
async function moverBorde(palabra) {
    const toma = Number(palabra.dataset.toma);
    const paredMs = Number(palabra.dataset.t);
    const ok = await window.nt.confirmar({
        titulo: `¿Abrir el IN de la toma ${toma} acá?`,
        ok: 'Mover el IN',
        mensaje: `La toma va a empezar en «${palabra.textContent}». Cancelá si lo que ` +
            'querías era mover el OUT: para eso, hacé clic en la última palabra que quede adentro.'
    });
    await editar({ tipo: 'borde', toma, borde: ok ? 'in' : 'out', paredMs });
}

async function editar(cambio) {
    await pedir(() => window.nt.grabarEditar(cambio));
}

/**
 * Le pide algo al motor y dibuja lo que conteste, descartando lo que llegue
 * tarde: entre que se aprieta un botón y vuelve la respuesta, el ciclo de
 * señales puede haber mandado un estado más nuevo.
 */
async function pedir(hacer) {
    const mio = turno.pedir();
    const nuevo = await hacer();
    if (!turno.esElUltimo(mio) || !nuevo) return;
    estado = nuevo;
    pintar();
}

async function volver(cual) {
    const r = cual === 'deshacer' ? await window.nt.grabarDeshacer() : await window.nt.grabarRehacer();
    if (r.estado) { estado = r.estado; pintar(); }
    if (r.error) avisar(r.error, 'error');
    else if (r.ok) avisar(`${cual === 'deshacer' ? 'Deshecho' : 'Rehecho'}: ${r.que}`);
}

/* ─── Las teclas ──────────────────────────────────────────────────────── */

/**
 * Sobre la toma elegida, que es la que el editor tocó por última vez; si no
 * tocó ninguna, la abierta; si no hay abierta, la última que no esté
 * descartada. Sin esa cadena, una tecla apretada mientras se abre la toma
 * siguiente cae sobre otra.
 */
function laDeLasTeclas() {
    if (!estado) return null;
    const por = id => estado.tomas.find(t => t.id === id);
    return por(vista.elegida) || por(estado.abierta)
        || [...estado.tomas].reverse().find(t => !t.descartada) || null;
}

function escribiendo() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

async function alTeclado(e) {
    if (!$('#vista-vivo').classList.contains('es-activa')) return;
    if (escribiendo()) {
        // Enter en un campo guarda y suelta el foco, que es lo que uno espera
        // de un campo de una sola línea. Lo demás se lo queda el campo.
        if (e.key === 'Enter') document.activeElement.blur();
        return;
    }

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return volver(e.shiftKey ? 'rehacer' : 'deshacer');
    }
    if (meta) return;

    const tecla = e.key.toLowerCase();
    if (tecla === 'k') {
        e.preventDefault();
        return pedir(() => window.nt.grabarClaqueta());
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        return pedir(() => window.nt.grabarCerrarToma());
    }

    const v = (estado.vistas || []).find(x => x.nombre[0].toLowerCase() === tecla);
    const toma = laDeLasTeclas();
    if (v && toma) {
        e.preventDefault();
        vista.elegida = toma.id;
        await editar({ tipo: 'vista', toma: toma.id, vista: v.nombre });
    }
}

/* ─── Terminar ────────────────────────────────────────────────────────── */

async function terminar() {
    const abierta = estado && estado.abierta != null;
    const ok = await window.nt.confirmar({
        titulo: '¿Terminar la sesión?',
        ok: 'Terminar',
        mensaje: (abierta ? 'Hay una toma abierta: se cierra en su última palabra. ' : '') +
            'Se cierra el audio y se releen con el modelo grande las tomas que queden ' +
            'pendientes, así que puede tardar unos segundos.'
    });
    if (!ok) return;

    $('#btn-terminar').disabled = true;
    $('#vivo-estado').textContent = 'terminando';
    oido.dejarDeMandar();
    const salida = await window.nt.grabarTerminar();
    await oido.cerrar();
    $('#btn-terminar').disabled = false;
    app.irACierre(salida);
}

/** El nivel de audio lo sigue midiendo `oido`, y la barra lo dibuja acá. */
export function alNivel(pico) {
    if (!audio) return;
    audio.pico = Math.max(pico, (audio.pico || 0) * 0.85);
}
