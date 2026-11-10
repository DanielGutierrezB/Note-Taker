/**
 * pantalla-preparar.js — Lo que se elige antes de grabar.
 *
 * Es la pantalla que evita el error caro de esta app: descubrir a mitad de una
 * clase de tres horas que entraba el micrófono de la Mac en vez del audio del
 * Zoom, o que faltaba un modelo de Whisper. Cuando eso pasa no hay arreglo: la
 * clase ya se dio.
 *
 * Va en el orden en que se decide: de dónde sale la clase (audio y cámara),
 * qué clase es (número, idioma, fps) y qué tiene que escribir bien Whisper (el
 * glosario). Lo que está bien no ocupa lugar: Whisper y la carpeta van en el
 * pie, y suben arriba como aviso solo si algo impide grabar. Lo que explica
 * cada cosa es una pista al pasar el mouse por su «?».
 *
 * **El botón de Iniciar se enciende solo cuando lo esencial está.** Lo esencial
 * son tres: la carpeta, una entrada abierta, y Whisper. Que la entrada suene, o
 * que sea la que conviene, se dice pero no frena: se cambia grabando, desde el
 * rótulo Audio de la barra. La cámara no, porque es de referencia y no se graba.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as fuente from './grabar/fuente.js';
import * as idiomas from './idiomas.js';
import * as estados from './estados.js';
import * as editorDeGlosario from './glosario.js';

let app = null;
let doctor = null;
/** Si en la carpeta se puede escribir y cuánto queda (`engine/disco.js`). */
let disco = null;
let entradas = [];
let zoom = { soportado: false };
let reanudar = null;

/**
 * Lo que se sabe de la entrada elegida. `clase` es qué tipo de entrada es
 * (`estados.claseDeEntrada`), `error` el motivo cuando no se pudo abrir, y
 * `roto` el audio que se perdió en medio de la grabación (`alRomperse`, más
 * abajo).
 *
 * **Este objeto lo mira también la pantalla de En vivo**, que lo recibe tal
 * cual en `app.irAVivo` y lo lee en cada repintado de la barra: la entrada la
 * abre y la sigue esta pantalla, así que lo que le pase durante la clase entra
 * por acá.
 */
const audio = {
    abierto: false, caido: false, pico: 0, dispositivo: null,
    clase: null, error: null, roto: null
};

/**
 * Cómo se va a llamar esta clase: `{ numero, vez, cuandoMs, nombre }`.
 *
 * Lo contesta el motor, que es el único que sabe qué hay en la carpeta y el
 * único que tiene la convención de nombres. Acá se guarda para poder dibujarlo
 * y para mandar el número al arrancar.
 */
let nombre = null;

/**
 * Mientras se entra: desde que se ve la pantalla hasta que el disco, los
 * modelos, el nombre y la entrada están medidos.
 *
 * Sin esto se veía la pantalla de la visita anterior con Iniciar habilitado
 * durante esos segundos, y una clase podía arrancar con el número de la
 * anterior y con una entrada que ya no estaba abierta.
 */
let cargando = false;

/** Las cámaras, como opciones (`app.camarasParaElegir`), con la elegida marcada. */
let camaras = [];

/** El pico decae solo: sin esto, un golpe deja el medidor arriba para siempre. */
let ultimoPico = 0;
/** El último estado del audio que se dibujó, para repintar solo al cambiar. */
let ultimoEstado = null;
/** La entrada se abrió solo para el medidor de Ajustes, sin Preparar delante. */
let soloParaAjustes = false;
/** Quienes quieren saber cuándo cambia el estado del audio (el medidor de Ajustes). */
const alCambiarAudio = new Set();

const seVe = () => $('#vista-preparar').classList.contains('es-activa');

/** Repinta solo si la pantalla está delante: el audio también se abre desde Ajustes. */
function pintarSiSeVe() {
    if (seVe()) pintar();
}

export function alCambiarElAudio(fn) {
    alCambiarAudio.add(fn);
}

/** Cómo está el audio ahora, dicho como lo dice la pastilla de Preparar. */
export function estadoDelAudio() {
    return estados.deAudio(audio);
}

/**
 * Abre la entrada elegida para que el medidor de Ajustes tenga qué medir,
 * cuando no hay ninguna abierta: es mirar si llega señal sin ir a Preparar.
 * Se cierra al cerrar Ajustes (`soltarDeAjustes`). Con `otra` se reabre con la
 * que se acaba de elegir.
 */
export async function escucharParaAjustes(otra) {
    if (audio.abriendo || (audio.abierto && !(otra && soloParaAjustes))) return;
    await releerEntradas();
    const guardada = app.ajustes.dispositivo;
    const elegida = entradas.find(d => d.nombre === guardada)
        || entradas.find(d => d.nombre === fuente.sinPrefijoDelSistema(guardada));
    if (!elegida) return;
    soloParaAjustes = true;
    await abrirEntrada(elegida.id);
}

/** Cierra lo que abrió Ajustes, si nadie más la está usando. */
export async function soltarDeAjustes() {
    if (!soloParaAjustes) return;
    soloParaAjustes = false;
    if (seVe() || await window.nt.grabarEstado()) return;
    await cerrarEntrada();
    avisarCambio();
}

function avisarCambio() {
    for (const fn of alCambiarAudio) fn(estados.deAudio(audio));
}

/** Todos los medidores de la entrada: el de Preparar y el de Ajustes. */
function pintarMedidores(pico) {
    for (const barra of document.querySelectorAll('[data-medidor="entrada"]')) {
        barra.firstElementChild.style.width = `${Math.min(100, pico * 140)}%`;
        barra.dataset.pico = pico > 0.95 ? 'clip' : (pico > 0.7 ? 'alto' : '');
    }
}

export function conectar(contexto) {
    app = contexto;
    $('#btn-iniciar').addEventListener('click', iniciar);
    $('#vista-preparar').addEventListener('click', alClic);
    $('#vista-preparar').addEventListener('change', alCambiar);
    editorDeGlosario.conectar('#prep-glosario');
}

/**
 * Entra a la pantalla. `opciones.reanudar` es el sidecar de una sesión que
 * quedó abierta: se sigue en su mismo XML.
 */
export async function ver(opciones) {
    reanudar = (opciones && opciones.reanudar) || null;
    soloParaAjustes = false;
    cargando = true;
    pintar();
    verVista('vista-preparar');
    try {
        await entrar();
    } finally {
        cargando = false;
        pintar();
    }
}

async function entrar() {
    // El modelo grande se empieza a cargar ya, para que el «3, 2, 1» del
    // arranque lo oiga él (`grabacion.prepararOido`).
    if (window.nt.grabarPrepararOido) window.nt.grabarPrepararOido(app.ajustes.idioma);
    doctor = await window.nt.doctor();
    disco = app.ajustes.carpeta ? await window.nt.grabarDisco(app.ajustes.carpeta) : null;
    // Al reanudar no se pregunta: esa clase ya tiene su número y su nombre, y
    // ofrecerle el siguiente invitaría a cambiarle el nombre a una sesión que ya
    // tiene marcadores escritos y que el editor puede haber sincronizado.
    nombre = reanudar ? null : await preguntarElNombre();
    await editorDeGlosario.pintar(app.ajustes.carpeta);
    camaras = await app.camarasParaElegir();
    await releerEntradas();

    // Si la entrada de la última vez sigue ahí, se abre sola. Se guarda por
    // NOMBRE y no por id: el id que da el navegador cambia entre arranques, así
    // que guardarlo sería guardar algo que mañana no apunta a nada; el nombre
    // ("BlackHole 2ch", "Audio de Zoom") sobrevive a desenchufar y enchufar.
    //
    // Sin ninguna guardada se elige el audio del sistema: en el escenario de
    // esta app es la respuesta correcta —la clase llega por una llamada y
    // ningún micrófono la oye—, sirva la llamada por Zoom, por Meet o por lo
    // que sea, y es la que alguien que abre la app por primera vez no sabría
    // encontrar entre seis micrófonos. No hace falta que ninguna app esté
    // abierta: el tap global graba lo que salga por los altavoces.
    if (!audio.abierto) {
        // Una guardada como «Default - X», de antes de que esas no se ofrecieran,
        // vuelve como el aparato X.
        const guardada = app.ajustes.dispositivo;
        const previo = entradas.find(d => d.nombre === guardada)
            || entradas.find(d => d.nombre === fuente.sinPrefijoDelSistema(guardada));
        const delSistema = entradas.find(d => d.id === fuente.SISTEMA.id);
        const porDefecto = previo || delSistema || null;
        if (porDefecto) await abrirEntrada(porDefecto.id);
    }
}

/**
 * Le pregunta al motor cómo se llamaría esta clase.
 *
 * @param {number|string} [numero] el que se escribió a mano; sin esto, el que
 *   la app sugiere (el más alto de la carpeta, más uno)
 */
async function preguntarElNombre(numero) {
    const carpeta = app.ajustes.carpeta;
    if (!carpeta) return null;
    return window.nt.grabarNombreSiguiente(carpeta, { numero });
}

async function releerEntradas() {
    const r = await fuente.entradas();
    entradas = r.lista || [];
    zoom = r.zoom || { soportado: false };
    if (!r.ok) avisar(r.error, 'error');
}

/**
 * Elegir la entrada desde Ajustes, con Preparar delante: la misma apertura
 * que el selector de su renglón, que es lo que la pantalla de atrás muestra.
 */
export async function elegirEntrada(id) {
    await abrirEntrada(id);
    pintar();
    return audio.abierto ? { ok: true } : { ok: false, error: audio.error || 'No se pudo abrir esa entrada.' };
}

/** La entrada que está abierta ahora, por su nombre, o null. */
export function entradaAbierta() {
    return audio.abierto ? audio.dispositivo : null;
}

/** Volver a leer lo que se pudo cambiar en Ajustes, y repintar. */
export async function refrescar() {
    if (cargando) return;
    await editorDeGlosario.pintar(app.ajustes.carpeta);
    camaras = await app.camarasParaElegir();
    pintar();
}

export async function salir() {
    if (window.nt.grabarSoltarOido) window.nt.grabarSoltarOido();
    soloParaAjustes = false;
    await cerrarEntrada();
}

async function cerrarEntrada() {
    await fuente.cerrar();
    Object.assign(audio, { abierto: false, caido: false, pico: 0, error: null, roto: null });
}

function pintar() {
    const boton = $('#btn-iniciar');
    boton.textContent = reanudar ? 'Reanudar la grabación' : 'Iniciar grabación';
    if (cargando) {
        boton.disabled = true;
        boton.title = 'Revisando el audio, la carpeta y los modelos';
        $('#prep-avisos').innerHTML = '';
        $('#prep-fuentes').innerHTML = '<p class="v3">Revisando el audio, la carpeta y los modelos…</p>';
        $('#prep-clase').innerHTML = '';
        $('#prep-pie').innerHTML = '';
        return;
    }
    const a = estados.deAudio(audio);
    const w = estados.deWhisper(doctor);
    const carpeta = app.ajustes.carpeta;
    const c = estados.deCarpeta(carpeta, disco);

    const listo = a.listo === 'si' && w.listo === 'si' && c.listo === 'si' && !audio.abriendo;
    boton.disabled = !listo;
    boton.title = listo
        ? 'Empieza a grabar y pone el cero del XML acá'
        : 'Falta algo: el aviso de arriba dice qué';

    $('#prep-nombre').innerHTML = !reanudar && nombre ? `Va a quedar <code>${esc(nombre.nombre)}.xml</code>` : '';
    $('#prep-avisos').innerHTML = [
        reanudar ? avisoReanudar() : '',
        w.listo !== 'si' ? aviso(w, 'Whisper', `<button class="btn" type="button" data-hace="diagnostico">Ver Diagnóstico</button>`) : '',
        // El disco que alcanza justo no frena, pero se dice arriba: se descubre
        // a la segunda hora de clase.
        c.listo !== 'si' || c.porque ? aviso(c, 'Dónde se guarda', carpeta
            ? '' : `<button class="btn" type="button" data-hace="volver">Elegir la carpeta en Sesiones</button>`) : ''
    ].join('');

    $('#prep-fuentes').innerHTML = `
      <div class="prep-grupo-cabeza"><span class="prep-grupo-titulo">Fuentes</span></div>
      <div class="prep-fila">
        <span class="prep-etiqueta">Audio ${ayuda(queDice() + ' ' + COMO_SABER)}</span>
        <div class="prep-control">
          <select data-campo="dispositivo" aria-label="Entrada de audio">
            ${audio.dispositivo ? '' : '<option value="">Elegí una entrada…</option>'}
            ${opciones()}
          </select>
          <button class="btn btn-ico" type="button" data-hace="releer-entradas" aria-label="Buscar de nuevo las entradas"
                  title="Volver a preguntarle al sistema qué entradas hay: por si acabás de conectar el micrófono o de abrir Zoom">${icono('regenerar')}</button>
        </div>
        <div class="medidor-fila">
          <div class="nivel es-medidor" id="prep-nivel" data-medidor="entrada" aria-hidden="true"><div class="nivel-barra"></div></div>
          <span class="pastilla" data-estado="${a.clave}" tabindex="0" ${a.porque ? `title="${esc(a.porque)}"` : ''}>${esc(a.palabra)}</span>
        </div>
      </div>
      <div class="prep-fila">
        <span class="prep-etiqueta">Cámara ${ayuda('Una cámara, o una cámara virtual como la de OBS para una señal por NDI. '
            + 'De ella sale un fotograma al cerrarse cada toma, guardado al lado de las notas y fuera del XML.')}</span>
        <div class="prep-control">
          <select data-campo="camara" aria-label="Cámara de referencia">
            ${camaras.map(o => `<option value="${esc(o.valor)}" ${o.marcada ? 'selected' : ''}>${esc(o.dice)}</option>`).join('')}
          </select>
          <button class="btn btn-ico" type="button" data-hace="releer-camaras" aria-label="Buscar de nuevo las cámaras"
                  title="Volver a preguntarle al sistema qué cámaras hay: por si acabás de conectar una o de abrir OBS">${icono('regenerar')}</button>
        </div>
        <div class="prep-nota">Solo para la foto del OUT de cada toma. No graba la pantalla ni vídeo.</div>
      </div>`;

    $('#prep-clase').innerHTML = `
      <div class="prep-grupo-cabeza"><span class="prep-grupo-titulo">La clase</span></div>
      ${reanudar ? '' : `<div class="prep-fila">
        <label class="prep-etiqueta" for="prep-numero">Número de clase ${ayuda(
            'El que sigue en esta carpeta. Cambialo si esta clase es otra: el nombre del XML y de la secuencia de Premiere salen de acá.')}</label>
        <div class="prep-control">
          <input type="number" min="1" step="1" id="prep-numero" data-campo="numero" class="prep-numero"
                 value="${nombre && nombre.numero != null ? nombre.numero : ''}">
          ${nombre && nombre.vez > 1 ? `<span class="pastilla" data-estado="por confirmar">V${nombre.vez}</span>` : ''}
        </div>
        ${nombre && nombre.vez > 1 ? `<div class="prep-nota es-aviso" title="${esc(comoSeVaALlamar().replace(/<[^>]+>/g, ''))}">`
            + `Ya hay una clase ${dosDigitos(nombre.numero)} en esta carpeta: esta queda como V${nombre.vez}.</div>` : ''}
      </div>`}
      <div class="prep-fila">
        <label class="prep-etiqueta" for="prep-idioma">Idioma ${ayuda(app.ajustes.idioma === 'auto'
            ? 'Automático elige entre español e inglés, y mientras grabás el rótulo de la barra dice cuál está oyendo. '
                + 'Para el portugués, ponelo a mano.'
            : 'Si la clase no es en este idioma, el transcript sale traducido. Se puede cambiar grabando, desde la barra.')}</label>
        <div class="prep-control">
          <select id="prep-idioma" data-campo="idioma">
            ${['auto', ...idiomas.IDIOMAS].map(cod => `<option value="${cod}" ${cod === app.ajustes.idioma ? 'selected' : ''}>${esc(idiomas.nombre(cod))}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="prep-fila">
        <span class="prep-etiqueta">Selección de FPS ${ayuda(
            'Los cuadros por segundo de la secuencia donde vas a cortar: con ellos se calculan los marcadores del XML. '
                + 'Se cambia en Ajustes, para que no se toque sin querer.')}</span>
        <div class="prep-control">
          <span class="prep-valor">${esc(String(app.ajustes.fps))} fps</span>
          <button class="btn-enlace" type="button" data-hace="ajustes">Cambiar en Ajustes</button>
        </div>
      </div>`;

    $('#prep-pie').innerHTML = `
      <span class="prep-pie-item" data-listo="${w.listo}">${icono(w.listo === 'si' ? 'ok' : 'atencion')} Whisper ${esc(w.palabra)}</span>
      <button class="btn-enlace" type="button" data-hace="diagnostico"
              title="Qué modelos encontró la app, dónde los buscó y qué falta bajar">Ver diagnóstico</button>
      <span class="prep-pie-item" title="${esc(carpeta ? `${carpeta}/xml/` : '')}">${carpeta
        ? `Se guarda en <code>${esc(carpeta.split('/').pop())}/xml/</code>`
            + (disco && disco.minutos != null ? ` · quedan unas ${Math.floor(disco.minutos / 60)} h` : '')
        : 'Sin carpeta'}</span>`;
}

/** Cómo comprobar la voz en los primeros segundos: va en la pista del audio. */
const COMO_SABER = 'El medidor se mueve con cualquier sonido, así que no alcanza: apenas inicies, En vivo muestra '
    + 'en «Oyendo» lo que Whisper entiende. Si no es lo que dice el profesor, cambiá la entrada desde el rótulo '
    + 'Audio de la barra: la clase sigue, con lo anotado.';

/** El «?» con la explicación al pasar el mouse. */
function ayuda(texto) {
    return `<span class="ayuda" tabindex="0" title="${esc(texto)}">?</span>`;
}

/** Lo que impide grabar, arriba y con su arreglo. */
function aviso(estado, que, arreglo) {
    return `<div class="aviso prep-aviso" data-tono="${estado.listo === 'mal' ? 'error' : ''}">${icono(estado.listo === 'mal' ? 'error' : 'atencion')}
      <span><strong>${esc(que)}: ${esc(estado.palabra)}.</strong> ${esc(estado.porque || '')}</span>
      ${arreglo || ''}</div>`;
}

/**
 * La lista de entradas, en dos grupos: la llamada y todo lo demás.
 *
 * Los grupos dicen en palabras la diferencia que importa, que no se ve en los
 * nombres: la primera trae la voz de quien habla en Zoom, las otras graban
 * lo que suena en la sala.
 */
function opciones() {
    const opcion = d => `<option value="${esc(d.id)}"
        ${d.nombre === audio.dispositivo ? 'selected' : ''}>${esc(d.nombre)}</option>`;
    const llamada = entradas.filter(d => d.tipo === 'app');
    const resto = entradas.filter(d => d.tipo !== 'app');
    return (llamada.length ? `<optgroup label="La llamada">${llamada.map(opcion).join('')}</optgroup>` : '') +
        `<optgroup label="Micrófonos y dispositivos (graban la sala)">${resto.map(opcion).join('')}</optgroup>`;
}

function dosDigitos(n) {
    return n == null ? '—' : String(n).padStart(2, '0');
}

/**
 * Qué dice el renglón del número: cómo se va a llamar, y si es una repetición.
 *
 * **La vez se avisa.** Grabar la 01 cuando ya hay una 01 es casi siempre a
 * propósito —se cortó el Zoom, se volvió a dar la clase— pero también es como se
 * ve un número mal escrito, y es lo único que la pantalla puede decir a tiempo.
 * Después de grabar tres horas, descubrir que la clase quedó como V2 porque se
 * tecleó 1 en vez de 11 no tiene arreglo barato.
 */
function comoSeVaALlamar() {
    if (!nombre) return 'Elegí la carpeta del curso para saber qué clase sigue.';
    const comoQueda = `Va a quedar <code>${esc(nombre.nombre)}.xml</code>, y la secuencia de `
        + 'Premiere se llama igual.';
    if (nombre.vez > 1) {
        return `Ya hay una clase ${dosDigitos(nombre.numero)} en esta carpeta, así que esta `
            + `queda como <strong>V${nombre.vez}</strong>: la vez número ${nombre.vez} `
            + `que se graba esa clase. ${comoQueda}`;
    }
    return `Es el número que sigue en esta carpeta. ${comoQueda}`;
}

/** Qué es este renglón, dicho según lo que hay y lo que se eligió. */
function queDice() {
    if (!zoom.soportado) {
        return 'Por acá entra la clase. Si viene de un Zoom, elegí un dispositivo virtual ' +
            'que reciba el sonido de la reunión (BlackHole o Loopback); si viene de una ' +
            'interfaz, su línea.' + (zoom.error ? ` ${zoom.error}` : '');
    }
    // Las dos entradas del ayudante hacen lo mismo visto desde afuera —graban
    // la llamada sin que haya que tocar nada ni dejar de oírla— y lo que hay
    // que explicar es en qué se diferencian, que es qué MÁS entra. Lo de Zoom
    // ya no se dice aparte según esté abierto o no: el audio del sistema no
    // depende de que ninguna app lo esté.
    return 'Por acá entra la clase, y seguís oyéndola en tus auriculares: lo que se graba es ' +
        'una copia. «Audio del sistema» toma todo lo que suene en la Mac, venga de Zoom, de ' +
        'Meet o de un vídeo, y por eso también entran las notificaciones. «Audio de Zoom» ' +
        'toma solo la llamada, que es más limpio cuando la clase es por ahí. Un micrófono ' +
        'graba la sala, que sirve solo si la clase es presencial.';
}

function avisoReanudar() {
    return `<div class="aviso" style="margin-top:12px">${icono('atencion')}
      <span>Vas a seguir en el XML de una sesión que quedó abierta. El cero no se
      mueve —los marcadores que ya están escritos cuelgan de él— y el audio nuevo
      entra como otro clip en su lugar, con el hueco de lo que no se grabó.</span></div>`;
}

async function alCambiar(e) {
    const campo = e.target.closest('[data-campo]');
    if (!campo) return;
    if (campo.dataset.campo === 'numero') {
        // Se le vuelve a preguntar al motor en vez de creerle al campo: escribir
        // un número que ya está tomado tiene que mostrar la V2 que va a salir,
        // antes de grabar y no después.
        nombre = await preguntarElNombre(campo.value);
        pintar();
        return;
    }
    if (campo.dataset.campo === 'idioma') {
        await app.guardarAjustes({ idioma: campo.value });
        pintar();
        return;
    }
    if (campo.dataset.campo === 'camara') {
        await app.ponerCamara(campo.value);
        camaras = await app.camarasParaElegir();
        pintar();
        return;
    }
    if (campo.dataset.campo !== 'dispositivo') return;
    await abrirEntrada(campo.value);
    pintar();
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    switch (boton.dataset.hace) {
        case 'releer-entradas': {
            await releerEntradas();
            // Si se estaba buscando a Zoom y ahora está, se abre sin pedir
            // otro clic: es lo que quien apretó «Buscar de nuevo» quería.
            if (zoom.abierta && (!audio.abierto || audio.clase === 'llamada')) {
                await abrirEntrada(fuente.ZOOM.id);
            }
            pintar();
            break;
        }
        case 'releer-camaras':
            camaras = await app.camarasParaElegir();
            pintar();
            break;
        case 'diagnostico': app.verDiagnostico(); break;
        case 'ajustes': app.verAjustes(); break;
        case 'volver': app.irASesiones(); break;
    }
}

async function abrirEntrada(id) {
    const entrada = entradas.find(d => d.id === id) || (id === fuente.ZOOM.id ? fuente.ZOOM : null);
    if (!entrada) {
        await fuente.cerrar();
        Object.assign(audio, {
            abierto: false, pico: 0, dispositivo: null, clase: null, error: null, roto: null
        });
        return;
    }
    // Lo que se perdió se perdió con la entrada anterior: esta arranca limpia.
    Object.assign(audio, {
        clase: estados.claseDeEntrada(entrada), error: null,
        caido: false, pico: 0, roto: null
    });
    ultimoPico = 0;
    ultimoEstado = null;
    // Mientras abre, la de antes ya se está cerrando: Iniciar se apaga hasta
    // saber con qué entrada y a qué tasa se graba (`pintar`). Es una cuenta y
    // no un sí o no: la que quedó reemplazada termina antes que la que la
    // reemplazó, y no puede volver a encender Iniciar en el medio.
    audio.abierto = false;
    audio.abriendo = (audio.abriendo || 0) + 1;
    pintarSiSeVe();
    let r;
    try {
        r = await abrirLaEntrada(entrada);
    } finally {
        audio.abriendo--;
    }
    // Otra elección llegó mientras esta abría: la pantalla es de esa.
    if (r.reemplazada) return r;
    if (!r.ok) {
        // El motivo va al renglón y no a un aviso que se va: es lo que hay que
        // leer para arreglarlo, y en cuatro segundos no se lee.
        Object.assign(audio, { abierto: false, dispositivo: entrada.nombre, error: r.error });
        avisarCambio();
        return r;
    }
    const nombre = entrada.nombre;
    Object.assign(audio, { abierto: true, caido: false, dispositivo: nombre });
    // Si guardar falla (el disco de arranque lleno), los ajustes de la ventana
    // siguen siendo los que había: pisarlos con `undefined` rompía Ajustes y la
    // barra en medio de la clase.
    const guardado = await window.nt.ajustesGuardar({ dispositivo: nombre });
    if (guardado && guardado.ok) app.ajustes = guardado.ajustes;
    avisarCambio();
    return r;
}

function abrirLaEntrada(entrada) {
    return fuente.abrir(entrada, {
        alNivel: pico => {
            ultimoPico = Math.max(pico, ultimoPico * 0.85);
            audio.pico = ultimoPico;
            pintarMedidores(ultimoPico);
            // El renglón se rehace solo cuando el ESTADO cambia, no en cada
            // pedazo: el nivel llega doce veces por segundo y repintar a esa
            // velocidad tira el foco del selector mientras alguien lo está
            // usando. Sin esto, en cambio, la pastilla se quedaba diciendo «en
            // silencio» con el medidor moviéndose al lado, o sea con la
            // pantalla contradiciéndose. Se mira la clave y no `listo`: callada
            // o sonando, la entrada deja iniciar igual.
            const ahora = estados.deAudio(audio).clave;
            if (ahora !== ultimoEstado) { ultimoEstado = ahora; pintarSiSeVe(); avisarCambio(); }
        },
        alCaerse: () => { audio.caido = true; pintarSiSeVe(); avisarCambio(); },
        // La escucha de Zoom vuelve sola de una traba o de un rearme.
        alVolver: () => { audio.caido = false; pintarSiSeVe(); avisarCambio(); },
        /**
         * El procesado de un pedazo de PCM reventó en medio de la grabación.
         *
         * Solo puede pasar grabando —los pedazos se procesan recién desde
         * «Iniciar»—, así que esto se ve en la barra de En vivo y no acá. Se
         * cuentan porque puede reventar con cada pedazo, doce veces por
         * segundo, y saber si fue uno o fueron mil es la diferencia entre un
         * tropiezo y una clase perdida.
         *
         * **La tostada sale una sola vez.** Doce por segundo no son un aviso
         * sino una pared, y lo que queda a la vista después es la pastilla.
         *
         * @param {number} [cuantos] la cuenta ya hecha, para el micrófono: ahí
         *   los pedazos revientan del lado de Node y el puente los junta y
         *   avisa cada dos segundos, así que el número lo trae el aviso y no
         *   se puede sacar contando llamadas (ver `ipc/grabar.js`). El de Zoom
         *   llega de a uno y lo cuenta acá.
         */
        alRomperse: (mensaje, cuantos) => {
            const primera = !audio.roto;
            audio.roto = {
                mensaje,
                veces: cuantos != null ? cuantos : (audio.roto ? audio.roto.veces : 0) + 1
            };
            if (primera) avisar(`Se está perdiendo audio de la grabación: ${mensaje}`, 'error');
            pintar();
        }
    });
}

async function iniciar() {
    if (cargando || audio.abriendo) return;
    const como = fuente.comoSuena();
    const payload = {
        dir: app.ajustes.carpeta,
        // El número, no la versión: cuál de las veces que se grabó esta clase es
        // esta se resuelve en el motor al escribir, con lo que haya en la
        // carpeta en ese instante (ver `grabacion.iniciar`).
        numero: nombre ? nombre.numero : null,
        fps: app.ajustes.fps,
        idioma: app.ajustes.idioma,
        dispositivo: como.dispositivo,
        sampleRate: como.sampleRate,
        canales: como.canales
    };

    // El micrófono empieza a capturar para la clase ya, y el motor ancla el cero
    // en ese instante (`desdeMs`). Lo capturado se retiene hasta que el pedido
    // salió, así llega detrás de él: lo que el motor tarde en arrancar queda
    // esperando en el puente y entra al WAV, en vez de perderse el «3, 2, 1».
    payload.desdeMs = await fuente.prepararEnvio();
    const pedido = reanudar
        ? window.nt.grabarReanudar(reanudar, payload)
        : window.nt.grabarIniciar(payload);
    fuente.liberarEnvio();
    const r = await pedido;
    if (!r.ok) { await fuente.dejarDeMandar(); avisar(r.error, 'error'); return; }

    // El de Zoom empieza a viajar DESPUÉS de que el motor dijo que sí: lo abre y
    // lo ancla Node. El micrófono ya está mandando y esto no lo toca.
    await fuente.empezarAMandar();
    app.irAVivo(r.estado, audio);
}

/** El estado del audio, que la pantalla de En vivo sigue mirando. */
export function elAudio() {
    return audio;
}

/**
 * Las entradas para el menú de la barra de En vivo, con la puesta marcada.
 *
 * Se vuelven a pedir cada vez que se abre: unos AirPods que se conectan a
 * mitad de la clase aparecen recién ahí, y son justo los que se buscan.
 */
export async function entradasParaElegir() {
    await releerEntradas();
    return entradas.map(d => ({
        valor: d.id,
        dice: d.nombre,
        pista: d.tipo === 'app'
            ? 'Lo que suena en la Mac, sin pasar por un micrófono.'
            : `La voz entra por ${d.nombre}.`,
        marcada: d.nombre === audio.dispositivo
    }));
}

/**
 * Cambia la entrada con la clase grabando, sin perder nada de lo anotado.
 *
 * El orden es lo que lo hace seguro, y cada paso tiene su porqué:
 *
 *   1. **se deja de mandar** antes de tocar nada: un pedazo de la entrada vieja
 *      que llegue tarde no puede caer en el WAV nuevo, ni al revés;
 *   2. **se abre la nueva**, y si no abre se vuelve a la que había: la clase no
 *      se puede quedar sin audio por un clic;
 *   3. **el motor cierra el WAV y abre otro** con la tasa de la que quedó
 *      abierta, aunque sea la misma de antes: el rato del cambio no está en el
 *      archivo, y seguir en el mismo correría todo lo de después;
 *   4. **se vuelve a mandar**.
 *
 * @returns {{ok:boolean, estado?:object, toma?:string|null, volvio?:boolean, error?:string}}
 */
export async function cambiarEntradaGrabando(id) {
    const antes = audio.abierto ? entradas.find(d => d.nombre === audio.dispositivo) || null : null;
    // La misma que ya está no se reabre, salvo que se haya caído o esté
    // perdiendo audio: elegirla otra vez es justo lo que la pantalla le pide a
    // quien la ve en rojo, y volver sin hacer nada dejaba la clase sin audio.
    if (antes && antes.id === id && !audio.caido && !audio.roto) return { ok: true, estado: null };
    await fuente.dejarDeMandar();
    // Reemplazada por otra elección hecha mientras abría: de esa se ocupa la
    // otra llamada. Seguir acá le avisaba al motor de una entrada ya cerrada.
    if ((await abrirEntrada(id) || {}).reemplazada) return { ok: true, estado: null };
    const fallo = audio.abierto ? null : (audio.error || 'No se pudo abrir esa entrada.');
    if (fallo && antes) await abrirEntrada(antes.id);
    if (!audio.abierto) {
        return { ok: false, error: `${fallo} La clase no está grabando audio: elegí otra entrada en el rótulo Audio.` };
    }
    const r = await mandarAlMotor();
    if (!r.ok) return r;
    return { ...r, volvio: Boolean(fallo), error: fallo };
}

/**
 * Vuelve a enganchar el audio de una clase que siguió grabando sin ventana.
 *
 * Pasa al recargar la ventana o al volver a abrirla después de cerrarla: el
 * motor siguió con la sesión, pero un micrófono lo abre la ventana y con ella
 * se fue. Se reabre la misma entrada, por su nombre, y desde ahí es un cambio
 * de entrada como cualquier otro: un WAV nuevo desde ahora, con el hueco del
 * rato en que no hubo ventana.
 *
 * @returns {{ok:boolean, estado?:object, error?:string}}
 */
export async function reengancharGrabando(estado) {
    await releerEntradas();
    const cual = entradas.find(d => d.nombre === estado.dispositivo)
        || entradas.find(d => d.nombre === fuente.sinPrefijoDelSistema(estado.dispositivo))
        || entradas.find(d => d.nombre === app.ajustes.dispositivo)
        || null;
    if (!cual) {
        return { ok: false, error: `No encontré ${estado.dispositivo || 'la entrada de la clase'}: `
            + 'elegí otra en el rótulo Audio para seguir grabando audio.' };
    }
    if ((await abrirEntrada(cual.id) || {}).reemplazada) return { ok: true, estado: null };
    if (!audio.abierto) {
        return { ok: false, error: `${audio.error || 'No se pudo abrir la entrada.'} `
            + 'Elegí otra en el rótulo Audio para seguir grabando audio.' };
    }
    return mandarAlMotor();
}

/** Le dice al motor con qué suena la entrada que quedó abierta, y empieza a mandar. */
async function mandarAlMotor() {
    const como = fuente.comoSuena();
    // Como en `iniciar`: el WAV nuevo se ancla donde empezó a capturar la
    // entrada nueva, y su audio cruza detrás del pedido.
    const desdeMs = await fuente.prepararEnvio();
    const pedido = window.nt.grabarCambiarEntrada({
        dispositivo: como.dispositivo, sampleRate: como.sampleRate, canales: como.canales, desdeMs
    });
    fuente.liberarEnvio();
    const r = await pedido;
    if (!r || !r.ok) {
        await fuente.dejarDeMandar();
        return { ok: false, error: (r && r.error) || 'El motor no aceptó la entrada nueva.' };
    }
    await fuente.empezarAMandar();
    return { ok: true, estado: r.estado, toma: r.toma };
}
