/**
 * app.js — El cableado: qué pantalla sigue a cuál y quién sabe qué.
 *
 * Acá no se dibuja nada. Cada pantalla es su propio archivo y recibe un
 * contexto con lo que necesita del resto: los ajustes y las cuatro maneras de
 * ir a otro sitio. Es lo único que las conoce a las cuatro, así que es el único
 * sitio donde se puede leer el recorrido entero de la app de un vistazo:
 *
 *   Sesiones ──► Preparar ──► En vivo ──► Cierre ──► Sesiones
 *
 * Ajustes y Diagnóstico son paneles y no pantallas: se abren encima de
 * cualquiera de las cuatro, porque la pregunta que contestan —«¿a cuántos
 * cuadros va esto?», «¿encontró Whisper?»— aparece en cualquier momento.
 */

import { $, $$, esc, avisar, verPanel, pref } from './chrome.js';
import { icono } from './iconos.js';
import * as sesiones from './pantalla-sesiones.js';
import * as preparar from './pantalla-preparar.js';
import * as vivo from './pantalla-vivo.js';
import * as cierre from './pantalla-cierre.js';
import * as dependencias from './dependencias.js';

const app = {
    ajustes: null,

    irASesiones() {
        preparar.salir();
        $('#btn-volver').hidden = true;
        return sesiones.ver();
    },

    irAPreparar(opciones) {
        $('#btn-volver').hidden = false;
        return preparar.ver(opciones);
    },

    irAVivo(estado, audio) {
        // Volver a Sesiones con la clase grabando llevaría a una lista donde no
        // se puede tocar nada —la sesión en curso no se renombra ni se borra—,
        // así que el camino de vuelta se apaga hasta Terminar.
        $('#btn-volver').hidden = true;
        vivo.ver(estado, audio);
    },

    irACierre(salida) {
        $('#btn-volver').hidden = false;
        cierre.ver(salida);
    },

    verAjustes() { verPanel('telon-ajustes', true); },
    verDiagnostico() { pintarDiagnostico(); verPanel('telon-diagnostico', true); }
};

async function arrancar() {
    app.ajustes = await window.nt.ajustesLeer();

    $('#marca').innerHTML = `${icono('claqueta')}<span>Note Taker</span>`;
    $('#btn-ajustes').innerHTML = icono('ajustes');
    $('#btn-diagnostico').innerHTML = icono('diagnostico');
    $('#btn-volver').innerHTML = `${icono('volver')}<span>Sesiones</span>`;
    $('#btn-volver').addEventListener('click', () => app.irASesiones());

    $('#btn-ajustes').addEventListener('click', () => {
        pintarAjustes();
        dependencias.refrescar();
        app.verAjustes();
    });
    $('#btn-diagnostico').addEventListener('click', () => app.verDiagnostico());
    for (const b of $$('[data-cerrar]')) {
        b.addEventListener('click', () => verPanel(b.dataset.cerrar, false));
    }
    // Un clic en el telón cierra, y Escape también. Son las dos maneras que uno
    // prueba sin pensar.
    for (const t of $$('.telon')) {
        t.addEventListener('mousedown', e => { if (e.target === t) verPanel(t.id, false); });
    }
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        for (const t of $$('.telon.es-activa')) verPanel(t.id, false);
    });

    sesiones.conectar(app);
    preparar.conectar(app);
    vivo.conectar(app);
    cierre.conectar(app);

    conectarAjustes();
    conectarActualizaciones();

    await sesiones.ver();
    await revisarDependencias();

    const info = await window.nt.appInfo();
    window.nt.anotar('ventana.lista', { version: info.version });
}

/* ─── Lo que falta ────────────────────────────────────────────────────── */

/**
 * Al abrir: si falta algo, se dice antes de que nadie arme una sesión.
 *
 * Lo imprescindible se avisa cada vez que se abre mientras falte —sin eso no se
 * puede grabar—; lo recomendado, una sola vez: después vive en Ajustes, para no
 * insistir con algo que la persona decidió no instalar.
 */
async function revisarDependencias() {
    await dependencias.montar($('#deps-ajustes'));
    await dependencias.montar($('#deps-inicio'));
    $('#btn-deps-todo').addEventListener('click', async () => {
        $('#btn-deps-todo').disabled = true;
        try { await dependencias.instalarTodo(); } finally { $('#btn-deps-todo').disabled = false; }
    });
    dependencias.alActualizar(() => {
        const { requeridas, otras } = dependencias.faltan();
        $('#deps-titulo').textContent = requeridas.length ? 'Falta algo para poder grabar' : 'Antes de empezar';
        $('#deps-dice').textContent = requeridas.length
            ? 'Sin lo que está en rojo, Note Taker no puede grabar ni escribir las notas. ' +
              'Cada botón lo instala por vos; los modelos se bajan una sola vez.'
            : (otras.length
                ? 'Se puede grabar, pero con esto la app anda mejor. Lo podés instalar ahora o después desde Ajustes.'
                : 'Está todo.');
        $('#btn-deps-todo').hidden = !requeridas.length && !otras.length;
        // Ya no falta nada: el aviso se cierra solo.
        if (!requeridas.length && !otras.length) verPanel('telon-dependencias', false);
    });
    await dependencias.refrescar();

    const { requeridas, otras } = dependencias.faltan();
    const yaAvisado = pref.leer('dependencias.avisadas', false);
    if (requeridas.length || (otras.length && !yaAvisado)) {
        verPanel('telon-dependencias', true);
        pref.guardar('dependencias.avisadas', true);
    }
}

/* ─── Ajustes ─────────────────────────────────────────────────────────── */

const FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

function conectarAjustes() {
    $('#aj-fps').innerHTML = FPS.map(f =>
        `<option value="${f}">${f} ${esNtsc(f) ? '(NTSC)' : ''}</option>`).join('');

    const guardar = async parche => {
        const r = await window.nt.ajustesGuardar(parche);
        if (r.ok) app.ajustes = r.ajustes;
        else avisar(r.error, 'error');
    };

    $('#aj-fps').addEventListener('change', e => guardar({ fps: Number(e.target.value) }));
    $('#aj-idioma').addEventListener('change', e => guardar({ idioma: e.target.value }));
    $('#aj-curso').addEventListener('change', e => guardar({ curso: e.target.value }));
    $('#btn-log').addEventListener('click', async () => {
        const r = await window.nt.registroDescargar();
        avisar(r.ok ? 'El registro quedó en Descargas.' : `No se pudo: ${r.error}`,
            r.ok ? 'ok' : 'error');
    });
}

function esNtsc(f) {
    return [23.976, 29.97, 59.94].includes(f);
}

function pintarAjustes() {
    $('#aj-fps').value = String(app.ajustes.fps);
    $('#aj-idioma').value = app.ajustes.idioma;
    $('#aj-curso').value = app.ajustes.curso || '';
}

/* ─── Diagnóstico ─────────────────────────────────────────────────────── */

/**
 * Qué encontró la app y dónde, en palabras.
 *
 * Cada renglón dice primero si está y después dónde, y los que no son
 * imprescindibles explican qué se pierde sin ellos. Es la diferencia entre un
 * diagnóstico que sirve y una lista de rutas: «no se pudo leer el audio» sin
 * decir que falta ffmpeg manda a buscar la culpa al lugar equivocado.
 */
async function pintarDiagnostico() {
    const cuerpo = $('#diagnostico-cuerpo');
    cuerpo.innerHTML = '<p class="v3">Mirando…</p>';
    const d = await window.nt.doctor();
    const info = await window.nt.appInfo();

    cuerpo.innerHTML = `
      <div class="v3">Note Taker ${esc(info.version)} · Electron ${esc(info.electron)}
        · ${esc(info.arch)}</div>
      ${(d.tools || []).map(t => `
        <div class="check" data-listo="${t.found ? 'si' : (t.required ? 'mal' : 'no')}">
          <span class="check-marca">${icono(t.found ? 'ok' : (t.required ? 'error' : 'atencion'))}</span>
          <div class="check-texto">
            <div class="check-titulo">
              <span>${esc(t.key)}</span>
              <span class="pastilla" data-estado="${t.found ? 'listo' : (t.required ? 'falta' : 'modelo liviano')}">
                ${t.found ? 'está' : (t.required ? 'falta' : 'no está')}</span>
            </div>
            <div class="check-dice">${t.found
                ? `${esc(t.name || '')} en <code>${esc(t.source)}</code>`
                : `Se buscó en ${(t.searched || []).length} sitio(s).`}</div>
            ${!t.found && t.nota ? `<div class="check-dice" style="color:var(--warn)">${esc(t.nota)}</div>` : ''}
          </div>
        </div>`).join('')}`;
}

/* ─── Actualizaciones ─────────────────────────────────────────────────── */

function conectarActualizaciones() {
    $('#btn-buscar-update').addEventListener('click', () => buscar(true));
    window.nt.onUpdateProgress(p => {
        $('#update-dice').textContent = `Bajando… ${Math.round((p.hechos / p.total) * 100)} %`;
    });
    window.nt.onUpdateReady(r => {
        $('#update-dice').textContent = 'Lista para instalar.';
        instalar(r.path);
    });
    // Al arrancar y cada seis horas, en silencio: solo se dice algo si hay una.
    setTimeout(() => buscar(false), 4000);
    setInterval(() => buscar(false), 6 * 60 * 60 * 1000);
}

async function buscar(aMano) {
    if (aMano) $('#update-dice').textContent = 'Buscando…';
    const r = await window.nt.updateCheck();
    if (!r || !r.hay) {
        if (aMano) $('#update-dice').textContent = r && r.motivo ? r.motivo : 'Estás al día.';
        return;
    }
    $('#update-dice').textContent = `Hay la ${r.version}.`;
    // Nunca en medio de una clase: el aviso espera a que la pantalla de En vivo
    // no esté puesta. Una actualización que interrumpe un rodaje es peor que
    // una que llega mañana.
    if ($('#vista-vivo').classList.contains('es-activa')) return;
    const ok = await window.nt.confirmar({
        titulo: `¿Bajar la versión ${r.version}?`,
        ok: 'Bajar',
        mensaje: (r.notas || '').slice(0, 400) || 'Se baja a Descargas y se abre el instalador.'
    });
    if (ok) window.nt.updateDownload({ url: r.url, nombre: r.nombre });
}

async function instalar(ruta) {
    const ok = await window.nt.confirmar({
        titulo: '¿Instalar y cerrar?',
        ok: 'Instalar',
        mensaje: 'El instalador reemplaza la app, así que Note Taker se cierra. ' +
            'Lo que hayas grabado ya está escrito en el disco.'
    });
    if (!ok) return;
    const r = await window.nt.updateInstall(ruta);
    if (!r.ok) avisar(r.error, 'error');
}

// El arnés de desarrollo entra por acá (`dev-shot.js` y la maqueta), y nada
// más que por acá.
//
// `listo` es la promesa del arranque, y no es un lujo: `arrancar` es `async`
// —lee los ajustes y lista la carpeta— así que quien quiera empujar la app a
// otra pantalla tiene que esperarla. Sin esto, la maqueta pedía la pantalla de
// En vivo y el arranque, que venía detrás, la devolvía a Sesiones: los seis
// escenarios se medían iguales y el número no decía nada.
window.dev = { app, verPanel, pref, listo: arrancar() };
