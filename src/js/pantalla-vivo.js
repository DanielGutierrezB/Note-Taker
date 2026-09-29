/**
 * pantalla-vivo.js — La clase mientras se graba.
 *
 * Es la pantalla que se mira de reojo con el profesor hablando, así que todo lo
 * que hay acá está puesto pensando en eso:
 *
 * - **Dos elementos grandes y no más**: el timecode y el estado de la sesión.
 *   Son los dos que hay que poder leer sin acercarse. Todo lo demás vive en la
 *   escala de 13/12/11.
 * - **La tarjeta "Ahora" arriba del todo**: sin toma, el campo de la próxima
 *   con lo que se va oyendo; con una abierta, la toma con su nota y sus bordes
 *   arrastrables. Es donde está la mano del editor el 90 % del tiempo, y ahí vive
 *   el único botón primario de la pantalla: **Abrir toma** cuando no hay
 *   ninguna, **Cerrar toma** cuando la hay. Son la misma acción con el signo
 *   cambiado —poner el borde acá— y nunca se ven las dos a la vez, así que la
 *   pantalla siempre tiene exactamente una cosa que gritar.
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
import * as fuente from './grabar/fuente.js';
import { mostrador } from './grabar/turnos.js';
import * as texto from './grabar/texto-toma.js';
import { estiloDeVista } from './colores.js';

let app = null;
let estado = null;
let audio = null;

/** Un repintado que llegó con una línea agarrada y quedó esperando (`texto.arrastrando`). */
let pendiente = false;

/** Cuántas palabras de antes del IN se ven con la toma abierta: las que hacen falta para correrlo. */
const ORILLA_ABIERTA = 24;

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

    // Soltar sin cambiar nada no trae estado nuevo, así que el repintado que
    // esperó se hace acá. Con un cambio lo hace la respuesta del motor, y
    // repintar antes con el estado viejo haría saltar la línea para atrás.
    texto.alSoltarCualquiera(cambio => {
        if (pendiente && !cambio) pintar();
    });
}

export function ver(primerEstado, elAudio) {
    estado = primerEstado;
    audio = elAudio;
    vista.abierta = null;
    vista.elegida = null;
    verVista('vista-vivo');
    pintar();
}

/* ─── Lo que llega del motor ─────────────────────────────────────────── */

function alAviso(aviso) {
    if (!aviso) return;
    if (aviso.tipo === 'estado') {
        estado = aviso.estado;
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
    if (texto.arrastrando()) {
        pendiente = true;
        return;
    }
    pendiente = false;
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

    const foco = recordarFoco();
    const rollos = recordarRollos();

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

    montarTextos();
    devolverRollos(rollos);
    devolverFoco(foco);

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
 * Lo que se oyó y no está en ninguna toma, y que todavía puede entrar en una.
 *
 * Las sueltas que el motor manda se filtran contra la última toma cerrada: lo
 * de antes de su OUT ya tuvo su oportunidad, y un deshacer puede dejar ahí
 * palabras que ya son de la toma (el historial repone tomas, no las sueltas).
 */
function sueltasLibres() {
    const cerradas = estado.tomas.filter(t => t.outMs != null);
    const desde = cerradas.length ? Math.max(...cerradas.map(t => t.outMs)) : -Infinity;
    return (estado.sueltas || []).filter(w => w.t >= desde);
}

/**
 * La tarjeta de lo que está pasando ahora.
 *
 * **Sin toma abierta es el campo de una toma que todavía no empezó**: el texto
 * de lo que se está oyendo va entrando abajo y lo viejo se desvanece arriba,
 * en gris, con el IN esperando al final. Es el mismo lugar y la misma forma
 * que va a tener la toma, a propósito: si el profesor arrancó sin decir el
 * conteo, arrastrar el IN hasta la palabra donde empezó ES abrir la toma.
 *
 * **Con una toma abierta es la toma**, pintada del color de su vista, y el
 * texto suelto deja de verse: lo que se oye ahora es de la toma. De lo de antes
 * quedan unas pocas palabras en gris, las justas para poder correr el IN.
 */
function ahora(fps) {
    const abierta = estado.tomas.find(t => t.id === estado.abierta);
    if (!abierta) {
        // Sin toma abierta, la acción principal de la pantalla es abrirla: es
        // lo que hay que poder hacer rápido si el profesor arrancó sin decir el
        // conteo, que es como se pierden las tomas.
        return `<div class="tarjeta tarjeta-espera">
          <div class="tarjeta-cabeza">
            <span class="hp-ico" style="color:var(--text-muted)">${icono('oido')}</span>
            <span class="v1">Sin toma abierta</span>
            <span class="pastilla" data-estado="escuchando">escuchando</span>
            <span class="crece"></span>
            <button class="btn btn-primario" type="button" data-hace="abrir"
                    title="Abre una toma acá. Si el profesor ya venía hablando, el IN
retrocede solo hasta donde empezó la frase. Tecla: Enter">
              ${icono('abrirToma')} Abrir toma</button>
            <button class="btn" type="button" data-hace="claqueta">
              ${icono('claqueta')} Claqueta</button>
          </div>
          <div class="tarjeta-cuerpo">
            <div data-texto="espera"></div>
            <p class="v3 pista">Se abre sola con «3, 2, 1». Si ya empezó, arrastrá el
              <b class="pista-in">IN</b> hasta la primera palabra de la toma.</p>
          </div>
        </div>`;
    }

    return `<div class="tarjeta guarda con-vista" data-estado="abierta"
        style="${estiloDeVista(estado.vistas, abierta.vista)}">
      <div class="tarjeta-cabeza">
        <span class="etiqueta-vista">${esc(abierta.vista)}</span>
        <span class="v1">Toma ${abierta.id}</span>
        <span class="pastilla" data-estado="abierta">abierta</span>
        <time class="fila-dato tc">${fmt.timecodeDe(abierta.inMs, estado.ceroMs, fps)}</time>
        <span class="crece"></span>
        ${vistas(abierta)}
        <button class="btn btn-primario" type="button" data-hace="cerrar"
                title="Cierra la toma en la última palabra dicha. Tecla: Enter">
          ${icono('cerrarToma')} Cerrar toma</button>
        <button class="btn" type="button" data-hace="claqueta">
          ${icono('claqueta')} Claqueta</button>
      </div>
      <div class="tarjeta-cuerpo">
        <input type="text" data-campo="nota" data-toma="${abierta.id}"
               value="${esc(abierta.comentario || '')}"
               placeholder="Nota de esta toma — se escribe en el marcador del XML">
        <div data-texto="abierta" data-toma="${abierta.id}"></div>
        <p class="v3 pista">Arrastrá el <b class="pista-in">IN</b> para mover el
          principio, o el <b class="pista-out">OUT</b> hacia atrás para cerrarla en esa palabra.</p>
      </div>
    </div>`;
}

/**
 * El selector de vista: cinco rectángulos, cada uno con su color.
 *
 * El elegido va relleno del color del marcador y los demás lo llevan en una
 * rayita abajo: así el color de cada vista se aprende mirando el selector, que
 * es lo que hace falta para leer la lista de un vistazo.
 */
function vistas(toma) {
    return `<span class="selector-vista">${(estado.vistas || []).map(v =>
        `<button class="btn btn-ico btn-vista ${toma.vista === v.nombre ? 'es-elegida' : ''}"
           type="button" data-hace="vista" data-vista="${v.nombre}" data-toma="${toma.id}"
           aria-pressed="${toma.vista === v.nombre}"
           title="${esc(v.titulo)} · tecla ${v.nombre[0]}"
           style="${estiloDeVista(estado.vistas, v.nombre)}">${v.nombre}</button>`).join('')}</span>`;
}

function filaToma(t, fps) {
    const est = estados.deToma(t, estado);
    const abierta = vista.abierta === `t${t.id}`;
    const dur = t.outMs != null ? (t.outMs - t.inMs) / 1000 : null;
    return `<div class="bloque-toma con-vista ${abierta ? 'es-abierta' : ''}"
        data-estado="${est.clave}" style="${estiloDeVista(estado.vistas, t.vista)}">
      <div class="fila guarda ${vista.elegida === t.id ? 'es-elegida' : ''}"
           data-estado="${est.clave}" data-toma="${t.id}" data-hace="plegar"
           ${est.porque ? `title="${esc(est.porque)}"` : ''}>
        <span class="chevron">${icono('chevron')}</span>
        <span class="etiqueta-vista">${esc(t.vista)}</span>
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
    // La abierta se edita arriba, en «Ahora»: dos textos movibles de la misma
    // toma serían dos líneas de IN que se pisan.
    const texto = t.outMs == null
        ? '<p class="v3">Está abierta: su texto y sus bordes están arriba, en «Ahora».</p>'
        : `<div data-texto="cerrada" data-toma="${t.id}"></div>
           <p class="v3 pista">Lo gris es lo que se dijo fuera de la toma. Arrastrá el
             <b class="pista-in">IN</b> o el <b class="pista-out">OUT</b> para moverlos.</p>`;
    return `<div class="cuerpo-toma">
        <input type="text" data-campo="nota" data-toma="${t.id}"
               value="${esc(t.comentario || '')}" placeholder="Nota de esta toma">
        ${texto}
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
    </div>`;
}

/**
 * Pone los textos con sus bordes en los huecos que dejó el HTML.
 *
 * Van aparte porque llevan escuchas de puntero, que un `innerHTML` no puede
 * traer. Cada hueco dice qué texto es (`data-texto`) y de qué toma.
 */
function montarTextos() {
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const cual = hueco.dataset.texto;
        const toma = estado.tomas.find(t => t.id === Number(hueco.dataset.toma));
        if (cual === 'espera') {
            hueco.append(texto.textoDe({
                modo: 'inactiva',
                palabras: sueltasLibres(),
                vacio: 'Escuchando… lo que se diga va a aparecer acá.'
            }, (borde, ms) => abrir(ms)));
        } else if (cual === 'abierta' && toma) {
            hueco.append(texto.textoDe({
                modo: 'abierta',
                antes: sueltasLibres().filter(w => w.t < toma.inMs).slice(-ORILLA_ABIERTA),
                palabras: toma.palabras,
                vacio: 'Todavía no se oyó nada de esta toma.'
            }, (borde, ms) => borde === 'out'
                ? pedir(() => window.nt.grabarCerrarToma(ms))
                : editar({ tipo: 'borde', toma: toma.id, borde, paredMs: ms })));
        } else if (cual === 'cerrada' && toma) {
            hueco.append(texto.textoDe({
                modo: 'cerrada',
                antes: toma.antes,
                palabras: toma.palabras,
                despues: toma.despues,
                vacio: 'Esta toma no tiene texto.'
            }, (borde, ms) => editar({ tipo: 'borde', toma: toma.id, borde, paredMs: ms })));
        }
    }
}

/**
 * Dónde estaba cada texto con scroll, para dejarlo igual después de repintar.
 *
 * El que estaba abajo del todo —lo normal: es donde entra lo nuevo— se queda
 * abajo, así el texto se va escribiendo solo. El que alguien subió para buscar
 * dónde poner el IN se queda donde lo dejó: que salte abajo cada tres segundos
 * haría imposible encontrar la palabra.
 */
function recordarRollos() {
    const rollos = new Map();
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const t = hueco.querySelector('.transcript');
        if (!t) continue;
        rollos.set(claveDe(hueco), {
            arriba: t.scrollTop,
            alFondo: t.scrollHeight - t.scrollTop - t.clientHeight < 8
        });
    }
    return rollos;
}

function devolverRollos(rollos) {
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const t = hueco.querySelector('.transcript');
        if (!t) continue;
        const antes = rollos.get(claveDe(hueco));
        t.scrollTop = !antes || antes.alFondo ? t.scrollHeight : antes.arriba;
    }
}

function claveDe(hueco) {
    return `${hueco.dataset.texto}:${hueco.dataset.toma || ''}`;
}

/**
 * La nota a medio escribir sobrevive al repintado.
 *
 * La pantalla se repinta cada tres segundos y la nota se guarda al salir del
 * campo, así que sin esto lo escrito entre un repintado y el siguiente se
 * perdía, con el cursor y todo, en medio de una frase.
 */
function recordarFoco() {
    const a = document.activeElement;
    if (!a || !a.matches('#vista-vivo [data-campo="nota"]')) return null;
    return {
        toma: a.dataset.toma,
        enAhora: !!a.closest('#ahora'),
        valor: a.value,
        desde: a.selectionStart,
        hasta: a.selectionEnd
    };
}

function devolverFoco(f) {
    if (!f) return;
    const donde = f.enAhora ? '#ahora' : '#lista-vivo';
    const campo = document.querySelector(`${donde} [data-campo="nota"][data-toma="${f.toma}"]`);
    if (!campo) return;
    campo.value = f.valor;
    campo.focus();
    campo.setSelectionRange(f.desde, f.hasta);
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
    if (!boton) return;

    const toma = boton.dataset.toma ? Number(boton.dataset.toma) : null;
    switch (boton.dataset.hace) {
        case 'plegar':
            vista.abierta = vista.abierta === `t${toma}` ? null : `t${toma}`;
            vista.elegida = toma;
            pintar();
            break;
        case 'claqueta': await pedir(() => window.nt.grabarClaqueta()); break;
        case 'abrir': await abrir(); break;
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
 * Abrir una toma a mano, y decir cuánto retrocedió.
 *
 * El aviso no es cosmético: el motor pone el IN al principio de la frase que
 * el profesor venía diciendo, o sea ANTES de donde se apretó. Sin decirlo, el
 * borde aparece en un sitio que nadie pidió y parece un error; dicho, es lo
 * que uno quería y no tuvo que hacer.
 *
 * Con `ms` es el IN soltado sobre una palabra del campo de espera: ahí el
 * borde está donde se lo puso, y no hay nada que explicar.
 */
async function abrir(ms) {
    const mio = turno.tomar();
    const nuevo = await window.nt.grabarAbrirToma(ms);
    if (turno.atrasada(mio) || !nuevo) return;
    estado = nuevo;
    pintar();
    if (ms != null) {
        if (nuevo.abierta != null) avisar(`Toma ${nuevo.abierta} abierta desde donde pusiste el IN.`);
    } else if (nuevo.retrocedioSec > 0.5) {
        avisar(`Toma ${nuevo.abierta} abierta ${nuevo.retrocedioSec} s atrás, ` +
            'desde donde arrancó la frase.');
    } else if (nuevo.abierta != null) {
        avisar(`Toma ${nuevo.abierta} abierta.`);
    }
}

/**
 * El borde de una toma, con una sola tecla.
 *
 * Enter abre si no hay ninguna abierta y cierra si la hay, y es a propósito
 * que sea la misma: lo que se aprieta no es «abrir» ni «cerrar» sino «acá va
 * el borde». Con dos teclas habría que acordarse de cuál toca, y se aprieta
 * mirando al profesor y no a la pantalla — que es exactamente cuando uno no
 * puede acordarse de nada.
 *
 * Apretarla de más abre una toma de un segundo o cierra una que no había que
 * cerrar, y las dos cosas se arreglan con Cmd-Z.
 */
async function bordeDeToma() {
    if (estado && estado.abierta != null) {
        return pedir(() => window.nt.grabarCerrarToma());
    }
    return abrir();
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
    const mio = turno.tomar();
    const nuevo = await hacer();
    if (turno.atrasada(mio) || !nuevo) return;
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
        return bordeDeToma();
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
    // Primero se deja de mandar y después se termina: un pedazo que llegara
    // entre las dos cosas iría a una sesión que ya está cerrando su audio.
    await fuente.dejarDeMandar();
    const salida = await window.nt.grabarTerminar();
    await fuente.cerrar();
    $('#btn-terminar').disabled = false;
    app.irACierre(salida);
}

/** El nivel lo sigue midiendo la fuente (`grabar/fuente.js`), y la barra lo dibuja acá. */
export function alNivel(pico) {
    if (!audio) return;
    audio.pico = Math.max(pico, (audio.pico || 0) * 0.85);
}
