/**
 * pantalla-preparar.js — La lista de verificación antes de grabar.
 *
 * Es la pantalla que evita el error caro de esta app: descubrir a mitad de una
 * clase de tres horas que entraba el micrófono de la Mac en vez del audio del
 * Zoom, o que faltaba un modelo de Whisper. Cuando eso pasa no hay arreglo: la
 * clase ya se dio.
 *
 * Por eso no es un formulario sino un checklist, y por eso cada renglón hace
 * tres cosas en el mismo sitio: dice cómo está, dice qué significa si está mal,
 * y ofrece el arreglo ahí mismo. Un checklist que dice «falta el dispositivo» y
 * te manda a otra pantalla a buscarlo es un checklist que hay que aprender.
 *
 * **El botón de Iniciar se enciende solo cuando lo esencial está.** Lo esencial
 * son tres: la carpeta, una entrada por la que entre sonido, y Whisper. La
 * cámara no, porque es de referencia y no se graba.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as oido from './grabar/oido.js';
import * as estados from './estados.js';

let app = null;
let doctor = null;
let entradas = [];
let reanudar = null;

const audio = { abierto: false, caido: false, pico: 0, dispositivo: null };

/** El pico decae solo: sin esto, un golpe deja el medidor arriba para siempre. */
let ultimoPico = 0;
/** El último estado del audio que se dibujó, para repintar solo al cambiar. */
let ultimoListo = null;

export function conectar(contexto) {
    app = contexto;
    $('#btn-iniciar').addEventListener('click', iniciar);
    $('#checklist').addEventListener('click', alClic);
    $('#checklist').addEventListener('change', alCambiar);
}

/**
 * Entra a la pantalla. `opciones.reanudar` es el sidecar de una sesión que
 * quedó abierta: se sigue en su mismo XML.
 */
export async function ver(opciones) {
    reanudar = (opciones && opciones.reanudar) || null;
    verVista('vista-preparar');
    $('#oyendo-preparar').textContent = reanudar
        ? 'Elegí la entrada y probá que llegue el audio: la sesión sigue en el mismo XML.'
        : 'Elegí una entrada y hablá: acá aparece lo que Whisper entiende.';

    doctor = await window.nt.doctor();
    const r = await oido.entradas();
    entradas = r.lista || [];
    if (!r.ok) avisar(r.error, 'error');

    // Si el dispositivo de la última vez sigue enchufado, se abre solo. Se
    // guarda por NOMBRE y no por id: el id que da el navegador cambia entre
    // arranques, así que guardarlo sería guardar algo que mañana no apunta a
    // nada; el nombre ("BlackHole 2ch") sobrevive a desenchufar y enchufar.
    const previo = entradas.find(d => d.nombre === app.ajustes.dispositivo);
    if (previo && !audio.abierto) await abrirEntrada(previo.id);

    pintar();
}

export async function salir() {
    await oido.cerrar();
    Object.assign(audio, { abierto: false, caido: false, pico: 0 });
}

function pintar() {
    const a = estados.deAudio(audio);
    const w = estados.deWhisper(doctor);
    const carpeta = app.ajustes.carpeta;

    const listo = a.listo === 'si' && w.listo === 'si' && Boolean(carpeta);
    const boton = $('#btn-iniciar');
    boton.disabled = !listo;
    boton.textContent = reanudar ? 'Reanudar la grabación' : 'Iniciar grabación';
    boton.title = listo
        ? 'Empieza a grabar y pone el cero del XML acá'
        : 'Falta algo de la lista: cada renglón dice qué';

    $('#checklist').innerHTML = [
        check({
            listo: a.listo,
            titulo: 'Entrada de audio',
            estado: a,
            dice: 'Por acá entra la clase. Si viene de un Zoom, elegí el dispositivo ' +
                'virtual que recibe el sonido de la reunión (BlackHole, Loopback o un ' +
                'dispositivo agregado); si viene de una interfaz, su línea.',
            arreglo: `
              <select data-campo="dispositivo" style="max-width:280px">
                <option value="">Elegí una entrada…</option>
                ${entradas.map(d => `<option value="${esc(d.id)}"
                  ${d.nombre === audio.dispositivo ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}
              </select>
              <div class="nivel" id="prep-nivel"><div class="nivel-barra"></div></div>
              <button class="btn btn-tenue" type="button" data-hace="releer-entradas">
                Buscar de nuevo</button>`
        }),
        check({
            listo: w.listo,
            titulo: 'Whisper',
            estado: w,
            dice: 'Es lo que oye el «3, 2, 1», el «Pausa» y la palabra «claqueta», y lo ' +
                'que le escribe el texto a cada toma cuando cierra.',
            arreglo: `<button class="btn" type="button" data-hace="diagnostico">
                Ver Diagnóstico</button>`
        }),
        check({
            listo: carpeta ? 'si' : 'mal',
            titulo: 'Dónde se guarda',
            estado: carpeta
                ? { clave: 'listo', palabra: 'lista' }
                : { clave: 'falta', palabra: 'sin elegir',
                    porque: 'Sin carpeta no hay dónde escribir el XML ni el audio.' },
            dice: carpeta
                ? `El XML, el audio y los datos van a <code>${esc(carpeta)}/xml/</code>.`
                : 'Elegí la carpeta del curso en la pantalla anterior.',
            arreglo: `<button class="btn btn-tenue" type="button" data-hace="volver">
                Volver a Sesiones</button>`
        }),
        check({
            listo: 'si',
            titulo: 'Cómo va a quedar el XML',
            estado: { clave: 'listo', palabra: `${app.ajustes.fps} cuadros` },
            dice: `Los marcadores se calculan a ${app.ajustes.fps} cuadros por segundo, ` +
                'que tiene que ser el de la secuencia donde vas a cortar. El idioma de la ' +
                `clase está en ${esc(idiomaDicho(app.ajustes.idioma))}.`,
            arreglo: `<button class="btn btn-tenue" type="button" data-hace="ajustes">
                Cambiar en Ajustes</button>`
        }),
        reanudar ? avisoReanudar() : ''
    ].join('');
}

function idiomaDicho(codigo) {
    return { es: 'español', en: 'inglés', pt: 'portugués' }[codigo] || codigo;
}

function avisoReanudar() {
    return `<div class="aviso" style="margin-top:12px">${icono('atencion')}
      <span>Vas a seguir en el XML de una sesión que quedó abierta. El cero no se
      mueve —los marcadores que ya están escritos cuelgan de él— y el audio nuevo
      entra como otro clip en su lugar, con el hueco de lo que no se grabó.</span></div>`;
}

/**
 * Un renglón: la marca, el título con su pastilla, qué es, por qué está mal si
 * lo está, y el arreglo.
 */
function check({ listo, titulo, estado, dice, arreglo }) {
    const marca = listo === 'si' ? 'ok' : (listo === 'mal' ? 'error' : 'atencion');
    return `<div class="check" data-listo="${listo}">
      <span class="check-marca">${icono(marca)}</span>
      <div class="check-texto">
        <div class="check-titulo">
          <span>${esc(titulo)}</span>
          <span class="pastilla" data-estado="${estado.clave}">${esc(estado.palabra)}</span>
        </div>
        <div class="check-dice">${dice}</div>
        ${estado.porque ? `<div class="check-dice" style="color:var(--warn)">${esc(estado.porque)}</div>` : ''}
        <div class="check-arreglo">${arreglo}</div>
      </div>
    </div>`;
}

async function alCambiar(e) {
    const campo = e.target.closest('[data-campo]');
    if (!campo || campo.dataset.campo !== 'dispositivo') return;
    await abrirEntrada(campo.value);
    pintar();
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    switch (boton.dataset.hace) {
        case 'releer-entradas': {
            const r = await oido.entradas();
            entradas = r.lista || [];
            pintar();
            break;
        }
        case 'diagnostico': app.verDiagnostico(); break;
        case 'ajustes': app.verAjustes(); break;
        case 'volver': app.irASesiones(); break;
    }
}

async function abrirEntrada(deviceId) {
    if (!deviceId) {
        await oido.cerrar();
        Object.assign(audio, { abierto: false, pico: 0, dispositivo: null });
        return;
    }
    const r = await oido.abrir(deviceId, {
        alNivel: pico => {
            ultimoPico = Math.max(pico, ultimoPico * 0.85);
            audio.pico = ultimoPico;
            const barra = $('#prep-nivel');
            if (barra) {
                barra.firstElementChild.style.width = `${Math.min(100, ultimoPico * 140)}%`;
                barra.dataset.pico = ultimoPico > 0.95 ? 'clip' : (ultimoPico > 0.7 ? 'alto' : '');
            }
            // El renglón se rehace solo cuando el ESTADO cambia, no en cada
            // pedazo: el nivel llega doce veces por segundo y repintar a esa
            // velocidad tira el foco del selector mientras alguien lo está
            // usando. Sin esto, en cambio, la pastilla se quedaba diciendo «en
            // silencio» con el medidor moviéndose al lado —o sea, con la
            // pantalla contradiciéndose— y el botón de Iniciar apagado para
            // siempre, que es el error que esta pantalla existe para evitar.
            const ahora = estados.deAudio(audio).listo;
            if (ahora !== ultimoListo) { ultimoListo = ahora; pintar(); }
        },
        alCaerse: () => { audio.caido = true; pintar(); }
    });
    if (!r.ok) {
        avisar(r.error, 'error');
        Object.assign(audio, { abierto: false, dispositivo: null });
        return;
    }
    const nombre = (entradas.find(d => d.id === deviceId) || {}).nombre || null;
    Object.assign(audio, { abierto: true, caido: false, dispositivo: nombre });
    app.ajustes = (await window.nt.ajustesGuardar({ dispositivo: nombre })).ajustes;
}

async function iniciar() {
    const como = oido.comoSuena();
    const payload = {
        dir: app.ajustes.carpeta,
        curso: app.ajustes.curso || nombreDeLaCarpeta(app.ajustes.carpeta),
        fps: app.ajustes.fps,
        idioma: app.ajustes.idioma,
        dispositivo: como.dispositivo,
        sampleRate: como.sampleRate,
        canales: como.canales
    };

    const r = reanudar
        ? await window.nt.grabarReanudar(reanudar, payload)
        : await window.nt.grabarIniciar(payload);
    if (!r.ok) { avisar(r.error, 'error'); return; }

    // El audio empieza a viajar DESPUÉS de que el motor dijo que sí: mandar
    // antes sería escribir pedazos en una sesión que no arrancó.
    oido.empezarAMandar();
    app.irAVivo(r.estado, audio);
}

function nombreDeLaCarpeta(ruta) {
    return String(ruta || '').split('/').filter(Boolean).pop() || 'clase';
}

/** El estado del audio, que la pantalla de En vivo sigue mirando. */
export function elAudio() {
    return audio;
}
