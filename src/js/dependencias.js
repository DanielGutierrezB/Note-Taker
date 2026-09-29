/**
 * dependencias.js — La lista de lo que la app necesita, con un botón para
 * instalar cada cosa que falte.
 *
 * Se dibuja en dos sitios: en Ajustes, siempre, y en el aviso de la primera
 * apertura, cuando falta algo. Los dos son la misma lista y se actualizan
 * juntos: una descarga que arrancó en el aviso sigue viéndose en Ajustes.
 *
 * El motor sabe qué hay y cómo se instala (`engine/dependencias.js`); acá solo
 * se dibuja y se aprieta.
 */

import { esc, avisar } from './chrome.js';
import { icono } from './iconos.js';

/** Los contenedores donde se dibuja la lista. */
const donde = new Set();
let lista = [];
/** clave → { pct, texto } de lo que se está instalando. */
const instalando = new Map();
/** clave → { error } o { mensaje } de lo último que pasó. */
const resultado = new Map();
let escuchando = false;
const alCambiar = new Set();

/** Lo que haya que hacer cuando cambie la lista (el aviso se cierra solo si ya no falta nada). */
export function alActualizar(fn) {
    alCambiar.add(fn);
}

export async function montar(contenedor) {
    donde.add(contenedor);
    if (!escuchando && window.nt.onDependenciasProgreso) {
        escuchando = true;
        window.nt.onDependenciasProgreso(p => {
            instalando.set(p.clave, { pct: p.pct, texto: p.texto });
            pintar();
        });
    }
    contenedor.addEventListener('click', alClic);
    await refrescar();
}

export async function refrescar() {
    lista = await window.nt.dependenciasEstado();
    pintar();
    for (const fn of alCambiar) fn(lista);
    return lista;
}

/** Lo que falta, separando lo que impide grabar de lo que solo lo empeora. */
export function faltan() {
    const f = lista.filter(d => !d.esta);
    return { requeridas: f.filter(d => d.requerida), otras: f.filter(d => !d.requerida) };
}

function pintar() {
    const html = lista.map(fila).join('');
    for (const c of donde) c.innerHTML = html;
}

function fila(d) {
    const enCurso = instalando.get(d.clave);
    const r = resultado.get(d.clave);
    const listo = d.esta ? 'si' : (d.requerida ? 'mal' : 'no');
    const marca = d.esta ? 'ok' : (d.requerida ? 'error' : 'atencion');
    const pastilla = d.esta
        ? '<span class="pastilla" data-estado="listo">está</span>'
        : `<span class="pastilla" data-estado="${d.requerida ? 'falta' : 'modelo liviano'}">${d.requerida ? 'falta' : 'recomendado'}</span>`;

    let accion = '';
    if (enCurso) {
        accion = d.accion && d.accion.tipo === 'descargar'
            ? `<button class="btn btn-tenue" type="button" data-cancelar="${esc(d.clave)}">Cancelar</button>`
            : '';
    } else if (!d.esta && d.accion && d.accion.etiqueta) {
        // Secundario: la acción principal del aviso es «Instalar lo que falta».
        accion = `<button class="btn" type="button"
                    data-instalar="${esc(d.clave)}">${esc(d.accion.etiqueta)}</button>`;
    }

    const progreso = enCurso ? `
      <div class="dep-progreso">
        <div class="nivel dep-barra"><div class="nivel-barra" style="width:${Math.max(2, enCurso.pct || 0)}%"></div></div>
        <span class="v3">${esc(enCurso.texto || 'Instalando…')}</span>
      </div>` : '';

    return `
      <div class="check dep" data-listo="${listo}" data-clave="${esc(d.clave)}">
        <span class="check-marca">${icono(marca)}</span>
        <div class="check-texto">
          <div class="check-titulo">
            <span>${esc(d.nombre)}</span>
            ${pastilla}
            <span class="crece"></span>
            ${accion}
          </div>
          <div class="check-dice">${esc(d.para)}</div>
          ${!d.esta && d.accion && d.accion.nota ? `<div class="check-dice">${esc(d.accion.nota)}</div>` : ''}
          ${progreso}
          ${r && r.error ? `<div class="check-dice" style="color:var(--error)">${esc(r.error)}</div>` : ''}
          ${r && r.mensaje ? `<div class="check-dice" style="color:var(--warn)">${esc(r.mensaje)}</div>` : ''}
        </div>
      </div>`;
}

async function alClic(e) {
    const instalar = e.target.closest('[data-instalar]');
    const cancelar = e.target.closest('[data-cancelar]');
    if (cancelar) {
        await window.nt.dependenciasCancelar(cancelar.dataset.cancelar);
        return;
    }
    if (instalar) await instalarUna(instalar.dataset.instalar);
}

export async function instalarUna(clave) {
    if (instalando.has(clave)) return { ok: false };
    const d = lista.find(x => x.clave === clave);
    instalando.set(clave, { pct: 0, texto: d && d.accion ? `${d.accion.etiqueta}…` : 'Instalando…' });
    resultado.delete(clave);
    pintar();
    let r;
    try {
        r = await window.nt.dependenciasInstalar(clave);
    } catch (err) {
        r = { ok: false, error: err.message };
    }
    instalando.delete(clave);
    if (!r.ok) resultado.set(clave, { error: r.error });
    else if (r.mensaje) resultado.set(clave, { mensaje: r.mensaje });
    else if (d) avisar(`${d.nombre}: listo.`, 'ok');
    await refrescar();
    return r;
}

/**
 * Todo lo que falte y se pueda instalar sin salir de la app, de a uno: lo
 * imprescindible primero. Lo que sigue afuera (la Terminal, el instalador de
 * Apple) no se lanza solo: eso lo aprieta la persona, que es la que va a tener
 * que poner la contraseña.
 */
export async function instalarTodo() {
    const orden = [...lista].sort((a, b) => Number(b.requerida) - Number(a.requerida));
    for (const d of orden) {
        if (d.esta || !d.accion || !['descargar', 'brew', 'compilar'].includes(d.accion.tipo)) continue;
        await instalarUna(d.clave);
    }
}
