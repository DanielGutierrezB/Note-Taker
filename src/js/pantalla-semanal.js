/**
 * pantalla-semanal.js — Grabarse explicando la semana, y salir con el vídeo.
 *
 * Es el modo simple, y simple quiere decir que no hay nada que decidir: se
 * aprieta Grabar, se habla abriendo cada toma con «3, 2, 1» y cerrándola con
 * «Pausa», se aprieta Terminar, y sale un MP4 con la pantalla de fondo y la
 * cámara en la esquina. Ni vistas, ni claquetas, ni XML, ni una lista de clases
 * que alguien tenga que entender.
 *
 * **Una pantalla con tres momentos y no tres pantallas.** Preparar, grabar y el
 * vídeo listo son el mismo sitio cambiando de tarjeta: así nadie se pierde, y
 * volver atrás es siempre lo mismo —otro vídeo— en vez de una navegación.
 *
 * **Lo que oye y lo que corta es el motor de siempre.** El micrófono viaja por
 * donde viaja en una clase, el «3, 2, 1» y la «Pausa» los reconoce el mismo
 * código, y los bordes los corre al silencio el mismo `ajustar-corte.js`. Este
 * archivo solo pone encima los dos vídeos y, al final, pide el corte. Si este
 * modo se borrara mañana, el de clase no se enteraría.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as fmt from './formato.js';
import * as fuente from './grabar/fuente.js';
import * as ojo from './grabar/ojo.js';
import * as filmar from './grabar/filmar.js';

let app = null;

/**
 * En qué momento está la pantalla.
 *
 * `listo` es antes de grabar, `grabando` mientras, `cortando` mientras ffmpeg
 * trabaja y `hecho` con el vídeo en el disco. Nada más: cada uno dibuja una
 * tarjeta y tiene un solo botón que lleva al siguiente.
 */
const estado = {
    paso: 'listo',
    entradas: [],
    micro: null,
    camaras: [],
    camara: null,
    pantalla: null,          // { nombre, ancho, alto } de la pantalla elegida
    audio: { abierto: false, pico: 0, error: null },
    sesion: null,            // el estado que devuelve el motor mientras graba
    reloj: null,
    tomasAbiertas: 0,
    corte: { pct: 0 },
    hecho: null,             // lo que devolvió el exportador
    avisos: []
};

export function conectar(contexto) {
    app = contexto;
    $('#semanal-cuerpo').addEventListener('click', alClic);
    $('#semanal-cuerpo').addEventListener('change', alCambio);
    window.nt.onSemanalAviso(aviso => {
        if (aviso && aviso.tipo === 'roto') {
            avisar(`Se está perdiendo el vídeo de ${nombreDe(aviso.cual)}: ${aviso.error}`, 'error');
        }
        if (aviso && aviso.tipo === 'pantalla-soltada') dejarDePintarLaPantalla();
    });
    window.nt.onSemanalProgreso(p => {
        if (estado.paso !== 'cortando') return;
        estado.corte = p;
        pintar();
    });
}

const nombreDe = cual => (cual === 'camara' ? 'la cámara' : 'la pantalla');

/** Entrar al modo: se mira qué hay conectado y se espera. */
export async function ver() {
    verVista('vista-semanal');
    if (estado.paso === 'grabando' || estado.paso === 'cortando') { pintar(); return; }
    estado.paso = 'listo';
    estado.hecho = null;
    estado.avisos = [];
    pintar();
    await mirarQueHay();
    pintar();
}

export async function salir() {
    if (estado.paso === 'grabando') return;          // grabando no se sale
    await fuente.cerrar();
    await filmar.soltarPantalla();
    await ojo.soltar('semanal');
    estado.audio = { abierto: false, pico: 0, error: null };
}

/** Qué micrófonos y qué cámaras hay, y abrir los elegidos para poder verlos. */
async function mirarQueHay() {
    const entradas = await fuente.entradas();
    estado.entradas = entradas.lista || [];
    const camaras = await ojo.camaras();
    estado.camaras = camaras.lista || [];

    // Lo elegido la última vez si sigue conectado, y si no lo primero que haya:
    // en este modo nadie va a ir a Ajustes a elegir un micrófono.
    const guardado = app.ajustes.dispositivo;
    estado.micro = estado.entradas.find(e => e.nombre === guardado)
        || estado.entradas.find(e => e.tipo !== 'app')
        || null;
    const camaraGuardada = app.ajustes.camara;
    estado.camara = estado.camaras.find(c => c.nombre === camaraGuardada)
        || estado.camaras[0]
        || null;

    // El micrófono sí se espera: de él depende que el botón de Grabar se
    // encienda, porque sin oír no hay «3, 2, 1» y sin «3, 2, 1» no hay tomas.
    await abrirElMicro();
    // La cámara, en cambio, se abre por su cuenta y repinta cuando esté. Dar el
    // primer fotograma puede tardar —una cámara virtual tarda segundos— y la
    // pantalla no tiene por qué quedarse en blanco mientras: lo único que
    // aparece después es su vista previa.
    abrirLaCamara().then(() => pintar());
}

async function abrirElMicro() {
    if (!estado.micro) {
        estado.audio = { abierto: false, pico: 0, error: 'No encontré ningún micrófono.' };
        return;
    }
    const r = await fuente.abrir(estado.micro, {
        alNivel: pico => {
            // El medidor es lo único que dice «te estoy oyendo» antes de grabar.
            const barra = $('#semanal-nivel .nivel-barra');
            if (barra) barra.style.width = `${Math.round(Math.min(1, pico) * 100)}%`;
        },
        alCaerse: () => {
            estado.audio.abierto = false;
            pintar();
        }
    });
    estado.audio = r.ok
        ? { abierto: true, pico: 0, error: null }
        : { abierto: false, pico: 0, error: r.error };
    if (r.ok) app.ajustes = (await window.nt.ajustesGuardar({ dispositivo: estado.micro.nombre })).ajustes;
}

async function abrirLaCamara() {
    if (!estado.camara) return;
    const r = await ojo.tomar('semanal', estado.camara.nombre, {
        alCaerse: mensaje => { avisar(mensaje, 'error'); pintar(); }
    });
    if (!r.ok) { avisar(r.error, 'error'); return; }
    app.ajustes = (await window.nt.ajustesGuardar({ camara: estado.camara.nombre })).ajustes;
    pegarLaCamara();
}

/**
 * La vista previa, que es el mismo stream del que va a salir el vídeo.
 *
 * Se comprueba que sea un `MediaStream` de verdad antes de pegarlo: asignar
 * otra cosa a `srcObject` tira, y lo que hay del otro lado no siempre es una
 * cámara —la maqueta falsea la captura para poder dibujar esta pantalla sin
 * cámara ni pantalla que compartir—. Sin vista previa esto sigue funcionando;
 * con una excepción acá, la tarjeta no se dibujaría.
 */
function pegar(sel, stream) {
    const video = $(sel);
    if (!video || !(stream instanceof MediaStream)) return;
    video.srcObject = stream;
    video.play().catch(() => {});
}

const pegarLaCamara = () => pegar('#semanal-camara', ojo.elStream());
const pegarLaPantalla = () => pegar('#semanal-pantalla', filmar.laPantalla());

function dejarDePintarLaPantalla() {
    estado.pantalla = null;
    if (estado.paso === 'grabando') {
        avisar('Dejaste de compartir la pantalla: lo que siga va a salir sin ella.', 'error');
        return;
    }
    pintar();
}

/* ─── Los cuatro momentos ─────────────────────────────────────────────── */

function pintar() {
    $('#semanal-reloj').hidden = estado.paso !== 'grabando';
    $('#semanal-titulo').textContent = {
        listo: 'Tu vídeo de la semana',
        grabando: 'Grabando',
        cortando: 'Cortando el vídeo',
        hecho: 'Tu vídeo está listo'
    }[estado.paso];

    $('#semanal-cuerpo').innerHTML = {
        listo: tarjetaListo,
        grabando: tarjetaGrabando,
        cortando: tarjetaCortando,
        hecho: tarjetaHecho
    }[estado.paso]();

    if (estado.paso === 'listo') { pegarLaCamara(); pegarLaPantalla(); }
    if (estado.paso === 'grabando') pegarLaCamara();
}

/** Antes de grabar: qué se va a grabar, y el botón. */
function tarjetaListo() {
    const puede = estado.audio.abierto && (estado.pantalla || estado.camara);
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo semanal-campos">
          <div class="campo">
            <span class="rotulo">Tu cámara</span>
            <div class="campo-fila">
              <select class="camara-elige" data-campo="camara">
                ${opciones(estado.camaras.map(c => c.nombre), estado.camara && estado.camara.nombre)}
              </select>
              <video id="semanal-camara" class="camara-previa" muted playsinline></video>
            </div>
            <span class="v3">Va en la esquina de abajo a la derecha del vídeo, siempre.</span>
          </div>

          <div class="campo">
            <span class="rotulo">Tu voz</span>
            <div class="campo-fila">
              <select class="camara-elige" data-campo="micro">
                ${opciones(estado.entradas.filter(e => e.tipo !== 'app').map(e => e.nombre),
                    estado.micro && estado.micro.nombre)}
              </select>
              <div class="nivel" id="semanal-nivel"><div class="nivel-barra"></div></div>
            </div>
            <span class="v3">${estado.audio.abierto
                ? 'Decí algo: si la barra no se mueve, elegí otra entrada.'
                : esc(estado.audio.error || 'Sin micrófono no se puede grabar.')}</span>
          </div>

          <div class="campo">
            <span class="rotulo">Tu pantalla</span>
            <div class="campo-fila">
              <button class="btn" type="button" data-hace="elegir-pantalla"
                      title="Abre el selector de macOS para elegir qué pantalla o qué ventana se graba">
                ${estado.pantalla ? 'Elegir otra…' : 'Elegir pantalla…'}</button>
              ${estado.pantalla
                ? `<video id="semanal-pantalla" class="camara-previa semanal-pantalla-previa"
                          muted playsinline></video>
                   <span class="v2">${esc(estado.pantalla.nombre)}</span>`
                : '<span class="v2">Todavía no elegiste ninguna.</span>'}
            </div>
            <span class="v3">${estado.pantalla
                ? 'Es el fondo del vídeo. Si cambiás de ventana a mitad de la grabación, se graba el cambio.'
                : 'Sin pantalla, el vídeo sale con tu cámara a pantalla completa.'}</span>
          </div>

          <div class="campo">
            <span class="rotulo">Cómo se graba</span>
            <span class="v2">Decí <b>«3, 2, 1»</b> y empezá a hablar: eso abre una toma.
              Decí <b>«Pausa»</b> para cerrarla. Lo que quede fuera de las tomas no sale en el
              vídeo, así que podés equivocarte, decir «Pausa» y volver a empezar con «3, 2, 1».</span>
          </div>

          <div class="campo-fila" style="margin-top:8px">
            <span class="crece"></span>
            <button class="btn btn-primario" type="button" data-hace="grabar" ${puede ? '' : 'disabled'}
                    title="${puede
                        ? 'Empieza a grabar la cámara, la pantalla y tu voz'
                        : 'Falta el micrófono: sin él no se puede oír el «3, 2, 1»'}">
              Grabar</button>
          </div>
        </div>
      </div>`;
}

/** Mientras graba: el reloj, el nivel, y si hay una toma abierta o no. */
function tarjetaGrabando() {
    const abierta = (estado.sesion && estado.sesion.tomas || []).find(t => t.outMs == null);
    const cerradas = (estado.sesion && estado.sesion.tomas || []).filter(t => t.outMs != null && !t.descartada);
    return `
      <div class="tarjeta guarda" data-estado="${abierta ? 'abierta' : 'terminada'}">
        <div class="tarjeta-cabeza">
          <span class="pastilla" data-estado="${abierta ? 'abierta' : 'listo'}">
            ${abierta ? 'toma abierta' : 'esperando el «3, 2, 1»'}</span>
          <span class="crece"></span>
          <div class="nivel" id="semanal-nivel"><div class="nivel-barra"></div></div>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="contadores" style="margin-bottom:16px">
            <div class="contador"><span class="contador-num">${cerradas.length}</span>
              <span class="rotulo">toma${cerradas.length === 1 ? '' : 's'} grabada${cerradas.length === 1 ? '' : 's'}</span></div>
            <div class="contador"><span class="contador-num">${esc(fmt.relojCorto(cortado(cerradas)))}</span>
              <span class="rotulo">va a durar</span></div>
          </div>
          <span class="v2">${abierta
            ? 'Estás dentro de una toma: esto es lo que va a salir en el vídeo. Decí «Pausa» para cerrarla.'
            : 'Lo que digas ahora no sale en el vídeo. Decí «3, 2, 1» para abrir la toma siguiente.'}</span>
          <div class="campo-fila" style="margin-top:16px">
            <video id="semanal-camara" class="camara-previa" muted playsinline></video>
            <span class="crece"></span>
            <button class="btn btn-primario" type="button" data-hace="terminar"
                    title="Deja de grabar, corta las tomas y exporta el vídeo">Terminar y exportar</button>
          </div>
        </div>
      </div>`;
}

/** Mientras ffmpeg trabaja: lo único honesto es el tanto por ciento. */
function tarjetaCortando() {
    const pct = Math.max(2, Math.round(estado.corte.pct || 0));
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <span class="v2">Cortando las tomas y poniendo tu cámara en la esquina. No cierres la app.</span>
          <div class="nivel" style="margin-top:16px">
            <div class="nivel-barra" style="width:${pct}%"></div>
          </div>
          <span class="v3" style="margin-top:8px">${pct} %</span>
        </div>
      </div>`;
}

/** Y el final: dónde está el vídeo. */
function tarjetaHecho() {
    const r = estado.hecho || {};
    if (!r.ok) {
        return `
          <div class="tarjeta guarda" data-estado="sin audio">
            <div class="tarjeta-cabeza">
              <span class="hp-ico" style="color:var(--error)">${icono('error')}</span>
              <span class="v1">No se pudo cortar el vídeo</span>
            </div>
            <div class="tarjeta-cuerpo">
              <span class="v2">${esc(r.error || 'No sé qué pasó.')}</span>
              <div class="campo-fila" style="margin-top:16px">
                <button class="btn" type="button" data-hace="ver-brutos"
                        title="Abre la carpeta con la cámara, la pantalla y el audio tal como se grabaron">
                  Mostrar lo que se grabó</button>
                <span class="crece"></span>
                <button class="btn btn-primario" type="button" data-hace="otro"
                        title="Volver a la pantalla de antes de grabar">Grabar otro</button>
              </div>
            </div>
          </div>`;
    }
    return `
      <div class="tarjeta guarda" data-estado="terminada">
        <div class="tarjeta-cabeza">
          <span class="hp-ico" style="color:var(--ok)">${icono('ok')}</span>
          <span class="v1">${esc(nombreDelArchivo(r.ruta))}</span>
          <span class="pastilla" data-estado="terminada">listo</span>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="contadores" style="margin-bottom:16px">
            <div class="contador"><span class="contador-num">${r.tomas}</span>
              <span class="rotulo">toma${r.tomas === 1 ? '' : 's'}</span></div>
            <div class="contador"><span class="contador-num">${esc(fmt.relojCorto(r.segundos))}</span>
              <span class="rotulo">de vídeo</span></div>
            <div class="contador"><span class="contador-num">${megas(r.bytes)}</span>
              <span class="rotulo">MB</span></div>
          </div>
          ${(r.avisos || []).length ? `<ul class="prproj-avisos v3">
            ${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <span class="v3">La cámara, la pantalla y el audio sin cortar quedaron en
            <code>xml/</code>, por si hay que rehacerlo.</span>
          <div class="campo-fila" style="margin-top:16px">
            <button class="btn btn-primario" type="button" data-hace="mostrar"
                    title="Abre el Finder con el vídeo seleccionado, listo para subirlo">
              ${icono('finder')} Mostrar en Finder</button>
            <button class="btn" type="button" data-hace="abrir"
                    title="Abrir el vídeo en el reproductor para verlo">Verlo</button>
            <span class="crece"></span>
            <button class="btn" type="button" data-hace="otro"
                    title="Volver a la pantalla de antes de grabar">Grabar otro</button>
          </div>
        </div>
      </div>`;
}

const megas = bytes => (Math.round((bytes || 0) / 1e5) / 10).toFixed(1);
const nombreDelArchivo = ruta => String(ruta || '').split('/').pop();

function opciones(nombres, puesto) {
    if (!nombres.length) return '<option value="">No encontré ninguna…</option>';
    return nombres.map(n =>
        `<option value="${esc(n)}"${n === puesto ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

/** Lo que va a durar el vídeo, en segundos: la suma de las tomas que quedan. */
function cortado(tomas) {
    return tomas.reduce((s, t) => s + Math.max(0, (t.outMs || 0) - t.inMs), 0) / 1000;
}

/* ─── Los gestos ──────────────────────────────────────────────────────── */

async function alCambio(e) {
    const campo = e.target.dataset.campo;
    if (campo === 'camara') {
        estado.camara = estado.camaras.find(c => c.nombre === e.target.value) || null;
        abrirLaCamara().then(() => pintar());
    }
    if (campo === 'micro') {
        estado.micro = estado.entradas.find(x => x.nombre === e.target.value) || null;
        await abrirElMicro();
        pintar();
    }
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton || boton.disabled) return;
    const hace = boton.dataset.hace;

    if (hace === 'elegir-pantalla') {
        const r = await filmar.elegirPantalla();
        if (!r.ok) {
            if (r.error) avisar(r.error, 'error');
            return;
        }
        estado.pantalla = { nombre: r.nombre, ancho: r.ancho, alto: r.alto };
        pintar();
        return;
    }
    if (hace === 'grabar') return grabar(boton);
    if (hace === 'terminar') return terminar(boton);
    if (hace === 'mostrar') return window.nt.reveal(estado.hecho.ruta);
    if (hace === 'abrir') return window.nt.openPath(estado.hecho.ruta);
    if (hace === 'ver-brutos') return window.nt.reveal(estado.hecho.brutos || app.ajustes.semanal.carpeta);
    if (hace === 'otro') return ver();
    return undefined;
}

/**
 * Empezar: la carpeta, el motor, los dos vídeos y el audio. En ese orden.
 *
 * El orden importa. El motor primero, porque es quien fija el cero de la
 * sesión y abre el WAV; los vídeos después, cada uno diciendo a qué hora
 * arrancó; y el audio al final, que es lo que ya hacía la pantalla de clase:
 * mandar PCM antes de que el motor diga que sí sería escribir en una sesión
 * que no arrancó.
 */
async function grabar(boton) {
    boton.disabled = true;
    try {
        const carpeta = await dondeGuardar();
        if (!carpeta) return;

        const como = fuente.comoSuena();
        const r = await window.nt.grabarIniciar({
            dir: carpeta,
            curso: 'semana',
            fps: 30,
            idioma: app.ajustes.idioma,
            dispositivo: como.dispositivo,
            sampleRate: como.sampleRate,
            canales: como.canales
        });
        if (!r.ok) { avisar(r.error, 'error'); return; }

        const f = await filmar.empezar({
            alAviso: a => {
                if (a.tipo === 'pantalla-soltada') dejarDePintarLaPantalla();
            }
        });
        if (!f.ok) {
            // Sin vídeo no hay modo semanal: se cierra la sesión que acaba de
            // abrirse para no dejar una grabación a medias en el disco.
            await window.nt.grabarTerminar();
            avisar(f.error, 'error');
            return;
        }
        await fuente.empezarAMandar();

        estado.sesion = r.estado;
        estado.paso = 'grabando';
        estado.reloj = setInterval(repintarReloj, 1000);
        pintar();
    } finally {
        boton.disabled = false;
    }
}

/** La carpeta del modo, preguntada una sola vez y recordada. */
async function dondeGuardar() {
    const puesta = app.ajustes.semanal && app.ajustes.semanal.carpeta;
    if (puesta) return puesta;
    const ruta = await window.nt.pickFolder({
        titulo: 'Dónde guardar tus vídeos de la semana',
        boton: 'Guardar acá'
    });
    if (!ruta) return null;
    app.ajustes = (await window.nt.ajustesGuardar({ semanal: { carpeta: ruta } })).ajustes;
    return ruta;
}

async function repintarReloj() {
    // `grabar-estado` contesta el resumen pelado, que es el mismo que mira la
    // pantalla de clase: sin `ok` ni envoltorio.
    const resumen = await window.nt.grabarEstado();
    if (!resumen) return;
    estado.sesion = resumen;
    $('#semanal-reloj').textContent = fmt.relojCorto(resumen.segundos);
    const abierta = (resumen.tomas || []).some(t => t.outMs == null);
    // Se repinta la tarjeta solo cuando cambia lo que dice, no cada segundo:
    // repintar borraría el `<video>` de la vista previa y la dejaría en negro.
    const ahora = `${abierta}|${(resumen.tomas || []).filter(t => t.outMs != null).length}`;
    if (ahora !== estado.ultimo) {
        estado.ultimo = ahora;
        pintar();
    }
}

/**
 * Terminar: parar todo, cerrar la sesión y cortar.
 *
 * Es un solo gesto a propósito —«todo es automático»— pero por dentro son
 * cuatro pasos en orden: los vídeos (que entregan su último pedazo al pararse),
 * el audio, el motor (que relee las últimas tomas y escribe el sidecar con los
 * bordes ya ajustados) y por último el corte, que lee ese sidecar.
 */
async function terminar(boton) {
    boton.disabled = true;
    if (estado.reloj) clearInterval(estado.reloj);
    estado.reloj = null;
    estado.corte = { pct: 0 };
    estado.paso = 'cortando';
    pintar();

    try {
        fuente.dejarDeMandar();
        await filmar.terminar();
        // `grabar-terminar` contesta la salida pelada, con los archivos que
        // quedaron escritos: de ahí sale el sidecar que el corte va a leer.
        const salida = await window.nt.grabarTerminar();
        await fuente.cerrar();
        await ojo.soltar('semanal');

        if (!salida || !salida.archivos || !salida.archivos.json) {
            estado.hecho = { ok: false, error: 'La grabación no se pudo cerrar, así que no hay qué cortar.' };
            estado.paso = 'hecho';
            pintar();
            return;
        }

        const r = await window.nt.semanalExportar(salida.archivos.json);
        estado.hecho = { ...r, brutos: app.ajustes.semanal.carpeta };
        estado.paso = 'hecho';
        estado.sesion = null;
        pintar();
        if (r.ok) avisar('Tu vídeo está listo.', 'ok');
    } catch (err) {
        estado.hecho = { ok: false, error: err.message };
        estado.paso = 'hecho';
        pintar();
    }
}

/** Para que `app.js` sepa si puede dejar salir de la pantalla. */
export function grabando() {
    return estado.paso === 'grabando' || estado.paso === 'cortando';
}
