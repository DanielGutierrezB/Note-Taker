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
 * Y un atajo de vuelta: desde Sesiones se puede abrir una clase ya grabada en la
 * MISMA pantalla de En vivo, para mirarla y ajustarle las notas (`irANotas`). No
 * es una pantalla más: es la misma con otro estado.
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
import * as ojo from './grabar/ojo.js';

const app = {
    ajustes: null,

    irASesiones() {
        preparar.salir();
        vivo.salir();
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

    /**
     * Las notas de una clase ya grabada, en la MISMA pantalla de la clase.
     *
     * No es una quinta pantalla y por eso no cambia el recorrido de arriba: es la
     * de En vivo con el estado de una clase que ya terminó (`grabando: false`), y
     * de ahí se vuelve a Sesiones, que es de donde se entró. El camino de vuelta
     * se deja encendido justamente porque acá no se está grabando nada.
     */
    irANotas(estado) {
        $('#btn-volver').hidden = false;
        vivo.ver(estado, null);
    },

    irACierre(salida) {
        // La clase terminó: la cámara de referencia se apaga acá y no al volver
        // a Sesiones, que puede tardar lo que el editor tarde en leer el cierre.
        vivo.salir();
        $('#btn-volver').hidden = false;
        cierre.ver(salida);
    },

    // Pintar es parte de abrir: los ajustes se leen del archivo y la lista de
    // cámaras del sistema, y las dos cosas cambian mientras la app está abierta.
    verAjustes() {
        pintarAjustes();
        dependencias.refrescar();
        verPanel('telon-ajustes', true);
    },
    verDiagnostico() { pintarDiagnostico(); verPanel('telon-diagnostico', true); }
};

async function arrancar() {
    app.ajustes = await window.nt.ajustesLeer();

    $('#marca').innerHTML = `${icono('claqueta')}<span>Note Taker</span>`;
    $('#btn-ajustes').innerHTML = icono('ajustes');
    $('#btn-diagnostico').innerHTML = icono('diagnostico');
    $('#btn-volver').innerHTML = `${icono('volver')}<span>Sesiones</span>`;
    $('#btn-volver').addEventListener('click', () => app.irASesiones());

    $('#btn-ajustes').addEventListener('click', () => app.verAjustes());
    $('#btn-diagnostico').addEventListener('click', () => app.verDiagnostico());
    for (const b of $$('[data-cerrar]')) {
        b.addEventListener('click', () => cerrarPanel(b.dataset.cerrar));
    }
    // Un clic en el telón cierra, y Escape también. Son las dos maneras que uno
    // prueba sin pensar.
    for (const t of $$('.telon')) {
        t.addEventListener('mousedown', e => { if (e.target === t) cerrarPanel(t.id); });
    }
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        for (const t of $$('.telon.es-activa')) cerrarPanel(t.id);
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
    pintarVersion(info.version);
    window.nt.anotar('ventana.lista', { version: info.version });
}

/**
 * Cerrar un panel, por cualquiera de las tres maneras.
 *
 * Es una función y no `verPanel` suelto porque Ajustes deja algo encendido: la
 * vista previa de la cámara. Si no se la soltara al cerrar, quedaría la luz de
 * la cámara prendida toda la clase sin que nadie la esté mirando.
 */
function cerrarPanel(id) {
    verPanel(id, false);
    if (id === 'telon-ajustes') ojo.soltar('ajustes');
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
    $('#aj-camara').addEventListener('change', async e => {
        await guardar({ camara: e.target.value || null });
        await verLaCamara();
    });
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
    pintarCamaras();
}

/* ─── La cámara de referencia ─────────────────────────────────────────── */

/**
 * El selector de cámaras, con la elegida puesta.
 *
 * La lista se pide cada vez que se abre Ajustes y no al arrancar la app: una
 * cámara virtual aparece cuando se abre el OBS, y pedir la lista al arrancar
 * dejaría un selector sin la opción que la persona está buscando. Pedirla
 * implica pedir permiso de cámara (si no, los nombres vienen vacíos), así que
 * solo pasa acá, cuando alguien vino a elegir una.
 *
 * **La elegida se guarda aunque hoy no esté conectada**, y sigue en la lista con
 * su nombre: una cámara desenchufada no es un cambio de ajuste.
 */
async function pintarCamaras() {
    const select = $('#aj-camara');
    const elegida = app.ajustes.camara || '';
    const { ok, lista, error } = await ojo.camaras();
    const nombres = (lista || []).map(c => c.nombre);
    if (elegida && !nombres.includes(elegida)) nombres.push(elegida);

    select.innerHTML = '<option value="">Ninguna</option>'
        + nombres.map(n => `<option value="${esc(n)}" ${n === elegida ? 'selected' : ''}>`
            + `${esc(n)}${(lista || []).some(c => c.nombre === n) ? '' : ' (no está conectada)'}</option>`).join('');
    select.value = elegida;
    if (!ok && error) $('#aj-camara-dice').textContent = error;
    await verLaCamara();
}

/**
 * La vista previa, encendida solo mientras Ajustes está abierto.
 *
 * Se pide la cámara con un nombre propio («ajustes»), así que si hay una clase
 * grabando con esa misma cámara, cerrar este panel no la apaga: la suelta, y
 * sigue encendida para la clase (ver `ojo.tomar`).
 */
async function verLaCamara() {
    const video = $('#aj-camara-ve');
    const cual = app.ajustes.camara;
    if (!cual) {
        await ojo.soltar('ajustes');
        video.srcObject = null;
        video.hidden = true;
        return;
    }
    const r = await ojo.tomar('ajustes', cual);
    if (!r.ok) {
        video.srcObject = null;
        video.hidden = true;
        $('#aj-camara-dice').textContent = r.error;
        return;
    }
    video.srcObject = ojo.elStream();
    video.hidden = false;
    try { await video.play(); } catch (e) { /* la muestra el navegador cuando pueda */ }
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

/**
 * La versión, y el botón que trae la que sigue.
 *
 * La app se va a repartir entre varias personas y cada una va a reportar cosas,
 * así que subir una versión tiene que ser algo que le llegue a todos sin
 * explicarles nada. Por eso el aviso vive en la barra de arriba, a la vista en
 * las cuatro pantallas, y no en un cartel: un cartel en medio de una clase es
 * una interrupción, y uno que aparece al abrir se cierra sin leer.
 *
 * El botón pasa por tres estados y cada uno dice qué va a hacer al apretarlo:
 *
 *   hay      «Versión 0.1.1 · Actualizar»   la baja
 *   bajando  «Bajando… 42 %»                se puede seguir trabajando
 *   lista    «Instalar y reabrir»           abre el instalador y se cierra
 *
 * **La instalación no borra nada de lo que la persona configuró.** El `.pkg`
 * reemplaza `/Applications/Note Taker.app` y nada más; los ajustes, lo que se
 * prefiere de la pantalla y los modelos de Whisper viven en
 * `~/Library/Application Support/Note Taker`, que el instalador no toca.
 */
const update = { estado: 'al-dia', version: null, url: null, nombre: null, ruta: null, notas: '' };

function conectarActualizaciones() {
    $('#btn-buscar-update').addEventListener('click', () => buscar(true));
    $('#btn-update').addEventListener('click', alApretarUpdate);

    window.nt.onUpdateProgress(p => {
        // `percent` es lo que manda el motor (`updates.download`). Antes acá se
        // leía `p.hechos`, que no existe, y el renglón decía «Bajando… NaN %».
        const pct = Number.isFinite(p.percent) ? p.percent : 0;
        update.estado = 'bajando';
        update.pct = pct;
        pintarUpdate();
        $('#update-dice').textContent = `Bajando… ${pct} %`;
    });
    window.nt.onUpdateReady(r => {
        update.estado = 'lista';
        update.ruta = r.path;
        pintarUpdate();
        $('#update-dice').textContent = 'Lista para instalar.';
        avisar(`La versión ${update.version || 'nueva'} está lista: apretá «Instalar y reabrir».`, 'ok');
    });

    // Al arrancar y cada media hora, en silencio: el botón aparece solo si hay
    // algo, y quien esté grabando lo ve pero no lo interrumpe nada.
    setTimeout(() => buscar(false), 4000);
    setInterval(() => buscar(false), 30 * 60 * 1000);
}

function pintarVersion(version) {
    $('#app-version').textContent = `v${version}`;
    $('#app-version').title = `Note Taker ${version}. Se comprueba solo si hay una nueva.`;
}

function pintarUpdate() {
    const boton = $('#btn-update');
    if (update.estado === 'al-dia') {
        boton.hidden = true;
        return;
    }
    boton.hidden = false;
    boton.disabled = update.estado === 'bajando';
    if (update.estado === 'hay') {
        boton.textContent = `Versión ${update.version} · Actualizar`;
        boton.title = (update.notas || '').slice(0, 300) ||
            'Baja el instalador de la versión nueva. Tus ajustes y los modelos se quedan como están.';
    } else if (update.estado === 'bajando') {
        boton.textContent = `Bajando… ${update.pct || 0} %`;
        boton.title = 'Se está bajando el instalador a Descargas.';
    } else {
        boton.textContent = 'Instalar y reabrir';
        boton.title = 'Abre el instalador y cierra Note Taker. Tus ajustes y los modelos se quedan como están.';
    }
}

async function alApretarUpdate() {
    if (update.estado === 'hay') {
        update.estado = 'bajando';
        update.pct = 0;
        pintarUpdate();
        const r = await window.nt.updateDownload({ url: update.url, nombre: update.nombre });
        if (r && !r.ok) {
            update.estado = 'hay';
            pintarUpdate();
            avisar(r.error || 'No se pudo bajar la versión nueva.', 'error');
        }
        return;
    }
    if (update.estado === 'lista') return instalar(update.ruta);
}

async function buscar(aMano) {
    if (aMano) $('#update-dice').textContent = 'Buscando…';
    // Mientras se baja o espera para instalar, una comprobación nueva borraría
    // lo que ya está en marcha.
    if (update.estado === 'bajando' || update.estado === 'lista') {
        if (aMano) $('#update-dice').textContent = update.estado === 'bajando' ? 'Bajando…' : 'Lista para instalar.';
        return;
    }

    let r = null;
    try {
        r = await window.nt.updateCheck();
    } catch (e) {
        if (aMano) $('#update-dice').textContent = `No se pudo comprobar: ${e.message}`;
        return;
    }
    if (!r || !r.hay) {
        update.estado = 'al-dia';
        pintarUpdate();
        if (aMano) $('#update-dice').textContent = r && r.motivo ? r.motivo : 'Estás al día.';
        return;
    }

    Object.assign(update, {
        estado: 'hay', version: r.version, url: r.url, nombre: r.nombre, notas: r.notas || ''
    });
    pintarUpdate();
    $('#update-dice').textContent = `Hay la ${r.version}.`;
    if (aMano) return;
    // Una sola vez por versión se dice en voz alta; después queda el botón. Con
    // una clase grabando no se dice nada: el botón está ahí y no molesta.
    const dicho = pref.leer('update.avisada', '');
    if (dicho !== r.version && !$('#vista-vivo').classList.contains('es-activa')) {
        pref.guardar('update.avisada', r.version);
        avisar(`Hay una versión nueva (${r.version}). Está arriba, en «Actualizar».`);
    }
}

async function instalar(ruta) {
    const ok = await window.nt.confirmar({
        titulo: '¿Instalar y cerrar?',
        ok: 'Instalar',
        mensaje: 'El instalador reemplaza la app, así que Note Taker se cierra. Lo que ' +
            'hayas grabado ya está escrito en el disco, y tus ajustes y los modelos ' +
            'de Whisper se quedan como están.'
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
