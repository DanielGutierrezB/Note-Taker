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
import * as fuente from './grabar/fuente.js';
import * as estados from './estados.js';

let app = null;
let doctor = null;
let entradas = [];
let zoom = { soportado: false };
let reanudar = null;

/**
 * Lo que se sabe de la entrada elegida. `clase` es qué tipo de entrada es
 * (`estados.claseDeEntrada`), `aceptado` que alguien eligió usar un micrófono
 * a sabiendas, `error` el motivo cuando no se pudo abrir, y `roto` el audio que
 * se perdió en medio de la grabación (`alRomperse`, más abajo).
 *
 * **Este objeto lo mira también la pantalla de En vivo**, que lo recibe tal
 * cual en `app.irAVivo` y lo lee en cada repintado de la barra: la entrada la
 * abre y la sigue esta pantalla, así que lo que le pase durante la clase entra
 * por acá.
 */
const audio = {
    abierto: false, caido: false, pico: 0, dispositivo: null,
    clase: null, aceptado: false, error: null, roto: null
};

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
    doctor = await window.nt.doctor();
    await releerEntradas();

    // Si la entrada de la última vez sigue ahí, se abre sola. Se guarda por
    // NOMBRE y no por id: el id que da el navegador cambia entre arranques, así
    // que guardarlo sería guardar algo que mañana no apunta a nada; el nombre
    // ("BlackHole 2ch", "Audio de Zoom") sobrevive a desenchufar y enchufar.
    //
    // Sin ninguna guardada y con Zoom abierto, se elige Zoom: en el escenario
    // de esta app es la respuesta correcta, y la que alguien que la abre por
    // primera vez no sabría encontrar entre seis micrófonos.
    if (!audio.abierto) {
        const previo = entradas.find(d => d.nombre === app.ajustes.dispositivo);
        const porDefecto = previo || (zoom.abierta ? fuente.ZOOM : null);
        if (porDefecto) await abrirEntrada(porDefecto.id);
    }

    pintar();
}

async function releerEntradas() {
    const r = await fuente.entradas();
    entradas = r.lista || [];
    zoom = r.zoom || { soportado: false };
    if (!r.ok) avisar(r.error, 'error');
}

export async function salir() {
    await fuente.cerrar();
    Object.assign(audio, { abierto: false, caido: false, pico: 0, error: null, roto: null });
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
            dice: queDice(),
            arreglo: `
              <select data-campo="dispositivo" style="max-width:300px">
                <option value="">Elegí una entrada…</option>
                ${opciones()}
              </select>
              <div class="nivel" id="prep-nivel"><div class="nivel-barra"></div></div>
              <button class="btn btn-tenue" type="button" data-hace="releer-entradas">
                Buscar de nuevo</button>
              ${(audio.clase === 'microfono' || audio.clase === 'bluetooth') && !audio.aceptado
                ? `<button class="btn" type="button" data-hace="usar-igual"
                     title="Para una clase presencial, donde el profesor está en la sala">
                     Es una clase presencial: usar el micrófono</button>`
                : ''}`
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

/** Qué es este renglón, dicho según lo que hay y lo que se eligió. */
function queDice() {
    if (!zoom.soportado) {
        return 'Por acá entra la clase. Si viene de un Zoom, elegí un dispositivo virtual ' +
            'que reciba el sonido de la reunión (BlackHole o Loopback); si viene de una ' +
            'interfaz, su línea.' + (zoom.error ? ` ${esc(zoom.error)}` : '');
    }
    if (!zoom.abierta && audio.clase !== 'llamada') {
        return 'Por acá entra la clase. Si viene de un Zoom, abrí la reunión y tocá ' +
            '«Buscar de nuevo»: aparece como «Audio de Zoom (la llamada)» y se escucha ' +
            'directo, sin cambiar nada en Zoom y sin dejar de oírla en tus auriculares.';
    }
    return 'Por acá entra la clase. «Audio de Zoom» escucha la reunión directo: seguís ' +
        'oyéndola en tus auriculares y no se mezcla nada más de la Mac. Un micrófono graba ' +
        'la sala, que sirve solo si la clase es presencial.';
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
            await releerEntradas();
            // Si se estaba buscando a Zoom y ahora está, se abre sin pedir
            // otro clic: es lo que quien apretó «Buscar de nuevo» quería.
            if (zoom.abierta && (!audio.abierto || audio.clase === 'llamada')) {
                await abrirEntrada(fuente.ZOOM.id);
            }
            pintar();
            break;
        }
        case 'usar-igual':
            audio.aceptado = true;
            ultimoListo = null;
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
    // Cada entrada nueva vuelve a preguntar: haber aceptado usar un micrófono
    // no vale para el siguiente que se elija. Y lo que se perdió se perdió con
    // la entrada anterior: esta arranca limpia.
    Object.assign(audio, {
        clase: estados.claseDeEntrada(entrada), aceptado: false, error: null,
        caido: false, pico: 0, roto: null
    });
    ultimoPico = 0;
    ultimoListo = null;
    const r = await fuente.abrir(entrada, {
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
        alCaerse: () => { audio.caido = true; pintar(); },
        // La escucha de Zoom vuelve sola de una traba o de un rearme.
        alVolver: () => { audio.caido = false; pintar(); },
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
         */
        alRomperse: mensaje => {
            const veces = (audio.roto ? audio.roto.veces : 0) + 1;
            audio.roto = { mensaje, veces };
            if (veces === 1) {
                avisar(`Se está perdiendo audio de la grabación: ${mensaje}`, 'error');
            }
            pintar();
        }
    });
    if (!r.ok) {
        // El motivo va al renglón y no a un aviso que se va: es lo que hay que
        // leer para arreglarlo, y en cuatro segundos no se lee.
        Object.assign(audio, { abierto: false, dispositivo: entrada.nombre, error: r.error });
        return;
    }
    const nombre = entrada.nombre;
    Object.assign(audio, { abierto: true, caido: false, dispositivo: nombre });
    app.ajustes = (await window.nt.ajustesGuardar({ dispositivo: nombre })).ajustes;
}

async function iniciar() {
    const como = fuente.comoSuena();
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
    await fuente.empezarAMandar();
    app.irAVivo(r.estado, audio);
}

function nombreDeLaCarpeta(ruta) {
    return String(ruta || '').split('/').filter(Boolean).pop() || 'clase';
}

/** El estado del audio, que la pantalla de En vivo sigue mirando. */
export function elAudio() {
    return audio;
}
