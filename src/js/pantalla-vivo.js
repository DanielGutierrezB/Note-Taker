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

import { $, esc, avisar, verVista, pref } from './chrome.js';
import { icono } from './iconos.js';
import * as fmt from './formato.js';
import * as estados from './estados.js';
import * as fuente from './grabar/fuente.js';
import { mostrador } from './grabar/turnos.js';
import * as texto from './grabar/texto-toma.js';
import { PALABRA_Y_APLAUSO_MS } from './grabar/senales.js';
import { estiloDeVista } from './colores.js';

let app = null;
let estado = null;
let audio = null;
let terminando = false;

/** Un repintado que llegó en un momento en que no se podía hacer, y quedó esperando. */
let pendiente = false;

/**
 * Un botón del mouse apretado en la pantalla (fuera de un IN/OUT). Mientras
 * tanto no se repinta: repintar entre el apretar y el soltar dejaba el clic
 * cayendo en otro nodo, y el navegador no se lo daba a nadie. Uno de cada diez
 * clics —abrir, cerrar, una vista— no hacía nada.
 */
let pulsando = false;

/** Un acento a medio escribir (tecla muerta): repintar lo partía en «´é». */
let componiendo = false;

/**
 * El texto con un borde recién soltado, mientras el motor contesta. Se deja
 * tal cual —con la línea donde se soltó— en vez de repintarlo con el estado
 * viejo, que hacía volver la línea a su palabra de antes hasta la respuesta.
 */
let enVuelo = null;

/** El texto cuyo IN u OUT está bajo el puntero: no se le agregan palabras ahí. */
let sobreBorde = null;

/** Cuándo llegó el último estado del motor, para darse cuenta si se calló. */
let ultimoAvisoMs = 0;

/**
 * Cuándo desapareció al repintar el campo que tenía el foco.
 *
 * Es lo único que justifica tragarse una tecla: lo que se siga escribiendo es
 * texto que iba a una nota, no atajos. Antes esto se marcaba en CADA tecla
 * escrita en un campo, y con eso el Enter que suelta la nota dejaba muerto al
 * Enter siguiente —el que abre la toma— y cada Enter estiraba la espera otros
 * segundo y medio. En la clase del 29/09 el atajo «a veces no abría».
 */
let campoDesaparecidoMs = 0;

/** El foco de un campo que desapareció al repintar y hay que buscar en su nuevo sitio. */
let focoPendiente = null;

/** Cuántas palabras de antes del IN se ven con la toma abierta: las que hacen falta para correrlo. */
const ORILLA_ABIERTA = 24;

/**
 * Lo de la vista y no de la clase: qué está abierto, qué está elegido, cómo se
 * mira la lista y el comentario a medio escribir, si hay uno.
 */
const vista = {
    abierta: null,
    elegida: null,
    compacto: pref.leer('vivo.compacto', false),
    sinDesactivadas: pref.leer('vivo.sinDesactivadas', false),
    // { toma, desdeMs, hastaMs, texto }: el pedazo seleccionado que se está comentando.
    comentando: null
};

/** Descarta las respuestas que llegan tarde (`turnos.js`). */
const turno = mostrador();

export function conectar(contexto) {
    app = contexto;

    $('#btn-terminar').addEventListener('click', terminar);
    $('#btn-deshacer').addEventListener('click', () => volver('deshacer'));
    $('#btn-rehacer').addEventListener('click', () => volver('rehacer'));
    $('#btn-deshacer').innerHTML = icono('deshacer');
    $('#btn-rehacer').innerHTML = icono('rehacer');
    $('#btn-claqueta').innerHTML = `${icono('claqueta')} Claqueta`;

    $('#ahora').addEventListener('click', alClic);
    $('#lista-vivo').addEventListener('click', alClic);
    $('#vivo-atajos').addEventListener('click', alClic);
    $('.barra-arriba').addEventListener('click', alClic);
    $('#ahora').addEventListener('change', alCambiar);
    $('#lista-vivo').addEventListener('change', alCambiar);
    // Seleccionar un pedazo del texto de una toma abre el campo para comentarlo.
    $('#ahora').addEventListener('mouseup', alSeleccionar);
    $('#lista-vivo').addEventListener('mouseup', alSeleccionar);
    // Y el clic derecho sobre UNA palabra pone ahí el IN o el OUT. En la
    // pantalla entera para que el clic derecho en cualquier otro lado también
    // cierre el menú, y en el documento para que lo cierre el de afuera.
    $('#vista-vivo').addEventListener('contextmenu', alClicDerecho);
    $('#menu-palabra').addEventListener('click', alClic);
    document.addEventListener('pointerdown', e => {
        if (menuPalabra && !e.target.closest('#menu-palabra')) cerrarMenuDePalabra();
    }, true);
    // La ventana se fue a otro lado: un menú abierto encima de una pantalla que
    // ya no se está mirando, y con el texto congelado detrás, no sirve a nadie.
    window.addEventListener('blur', cerrarMenuDePalabra);

    $('#btn-compacto').addEventListener('click', () => {
        vista.compacto = !vista.compacto;
        pref.guardar('vivo.compacto', vista.compacto);
        pintar();
    });
    $('#btn-desactivadas').addEventListener('click', () => {
        vista.sinDesactivadas = !vista.sinDesactivadas;
        pref.guardar('vivo.sinDesactivadas', vista.sinDesactivadas);
        pintar();
    });

    document.addEventListener('keydown', alTeclado);
    window.nt.onGrabarAviso(alAviso);

    // Soltar sin cambiar nada no trae estado nuevo: el texto se repinta ya.
    // Con un cambio, lo repinta la respuesta del motor (`enVuelo`).
    texto.alSoltarCualquiera(cambio => { if (!cambio) pintar(); });

    const pantalla = $('#vista-vivo');
    pantalla.addEventListener('pointerdown', e => {
        if (e.target.closest('.borde')) return;
        pulsando = true;
    });
    // Después del clic y no en el `pointerup`: el clic llega después, y
    // repintar antes lo volvía a perder. Y después de que `alSeleccionar` lea
    // la selección, que también espera un turno: repintar antes la dejaba
    // apuntando a nodos que ya no están y el comentario no se abría.
    const soltarPulsacion = () => setTimeout(() => {
        pulsando = false;
        if (pendiente) pintar();
    }, 30);
    window.addEventListener('pointerup', soltarPulsacion);
    window.addEventListener('pointercancel', soltarPulsacion);
    window.addEventListener('blur', soltarPulsacion);
    pantalla.addEventListener('pointerover', e => {
        const b = e.target.closest('.borde');
        if (b) sobreBorde = claveDe(b.closest('[data-texto]'));
    });
    pantalla.addEventListener('pointerout', e => {
        if (e.target.closest('.borde')) sobreBorde = null;
    });
    document.addEventListener('compositionstart', () => { componiendo = true; });
    document.addEventListener('compositionend', () => {
        componiendo = false;
        if (pendiente) pintar();
    });
    pantalla.addEventListener('input', e => {
        const c = e.target.closest('[data-campo="comentario"]');
        if (c && vista.comentando) vista.comentando.borrador = c.value;
    });

    // La barra de arriba —timecode, estado, nivel— se refresca sola, aunque el
    // motor no mande nada: si el audio se cae, el motor deja de mandar estados,
    // y esta pantalla seguía diciendo «escuchando» con el timecode quieto.
    setInterval(() => {
        if (estado && $('#vista-vivo').classList.contains('es-activa')) pintarBarra();
    }, 150);
}

export function ver(primerEstado, elAudio) {
    estado = primerEstado;
    audio = elAudio;
    vista.abierta = null;
    vista.elegida = null;
    vista.comentando = null;
    // Una palmada de la sesión anterior no dice nada de esta.
    palmada = null;
    pintarPalmada();
    ultimoAvisoMs = Date.now();
    verVista('vista-vivo');
    pintar();
}

/* ─── Lo que llega del motor ─────────────────────────────────────────── */

function alAviso(aviso) {
    if (!aviso) return;
    if (aviso.tipo === 'estado') {
        estado = aviso.estado;
        ultimoAvisoMs = Date.now();
        for (const ev of aviso.eventos || []) contar(ev);
        pintar();
        return;
    }
    if (aviso.tipo === 'claqueta') {
        // Cualquier claqueta anotada resuelve la palmada que estaba esperando:
        // la manual también, porque el motor funde las dos cuando caen juntas.
        palmada = null;
        pintarPalmada();
        avisar(`Claqueta ${aviso.claqueta} anotada (${aviso.por === 'golpe' ? 'aplauso' : 'voz'}).`);
        return;
    }
    if (aviso.tipo === 'golpe') {
        palmada = { ms: aviso.ms, sinConfirmar: false, dicho: false };
        pintarPalmada();
        return;
    }
    if (aviso.tipo === 'error') avisar(aviso.mensaje, 'error');
}

/* ─── La palmada que se oyó y todavía no es una claqueta ────────────────── */

/**
 * La última palmada sin resolver, o null.
 *
 * Es una sola y la nueva reemplaza a la vieja: dos palmadas seguidas son la
 * misma claqueta para el motor (`MISMA_CLAQUETA_MS`), y una lista de palmadas
 * en la barra sería ruido justo cuando hay que mirar al profesor.
 */
let palmada = null;

/**
 * Cuánto se le da al motor para contestar, después de tener el audio.
 *
 * El motor no puede confirmar antes de `PALABRA_Y_APLAUSO_MS`: le hace falta
 * ese audio de DESPUÉS del aplauso para leer si se dijo la palabra. Recién
 * cuando lo tiene empieza a leer, y eso es una pasada de Whisper sobre doce
 * segundos. Estos seis son para esa pasada, y se cuentan en tiempo de audio
 * grabado y no de reloj: si el audio se atrasa —Zoom que tartamudea, la máquina
 * ocupada— el aviso espera lo que haga falta en vez de acusar al motor de algo
 * que todavía no pudo hacer.
 */
const LECTURA_DE_PALMADA_MS = 6000;

/**
 * Cuánto se le da al editor para reaccionar a la pastilla roja.
 *
 * Ocho segundos, que con los doce de antes son veinte desde la palmada. Es el
 * número que hace honesta a la pastilla: el motor no puede decir «sin
 * confirmar» antes de los doce, y si la K dejara de enganchar ahí mismo, el
 * aviso llegaría justo tarde para lo único que pide hacer.
 *
 * Por arriba no hay riesgo de enganchar de más. El peligro sería que el editor
 * ponga a mano una claqueta NUEVA —una cuyo aplauso Zoom se comió, que es para
 * lo que la K existe— con una pastilla vieja todavía en pantalla, y que la
 * marca se fuera veinte segundos atrás. Pero dos claquetas de verdad nunca
 * están tan cerca: entre una y la siguiente hay una toma, o por lo menos el
 * tiempo de reacomodar una cámara (`MISMA_CLAQUETA_MS` en `notas-vivo.js`, que
 * da cinco segundos por el mismo motivo). Y si la palmada sí se oye, el aviso
 * nuevo reemplaza al viejo y la cuenta arranca de cero.
 */
const REACCION_MS = 8000;

/** Cuánto audio grabado lleva el motor, que es el reloj con el que él decide. */
function grabadoHastaMs() {
    return estado.ceroMs + (estado.segundos || 0) * 1000;
}

/**
 * ¿Ya se le puede decir al editor que esa palmada no se confirmó?
 *
 * Se mide con el audio que el motor tiene grabado, que es el mismo reloj con el
 * que él decide cuándo leer (`grabadoHastaMs` en `engine/grabacion.js`).
 */
function palmadaVencida() {
    if (!palmada || palmada.sinConfirmar || !estado) return false;
    return grabadoHastaMs() >= palmada.ms + PALABRA_Y_APLAUSO_MS + LECTURA_DE_PALMADA_MS;
}

/**
 * ¿La claqueta a mano todavía se engancha a esta palmada?
 *
 * Con el mismo reloj que el vencimiento, y por lo mismo: con el audio atrasado
 * el motor tampoco leyó, así que la pastilla todavía no dijo nada y el editor
 * no pudo reaccionar a nada.
 */
function palmadaEnganchable() {
    if (!palmada || !estado) return false;
    return grabadoHastaMs() <=
        palmada.ms + PALABRA_Y_APLAUSO_MS + LECTURA_DE_PALMADA_MS + REACCION_MS;
}

/**
 * La palmada en la que tiene que caer la claqueta a mano, o null para «acá».
 *
 * Es el `ms` que mandó el motor en su aviso `golpe`, de vuelta tal cual: él lo
 * busca en su lista antes de usarlo (`aplausoOido` en `notas-vivo.js`), así que
 * mandarlo de más no puede mover una marca a un sitio inventado.
 */
function palmadaParaEnganchar() {
    return palmadaEnganchable() ? palmada.ms : null;
}

/**
 * La pastilla de la palmada, en sus dos estados.
 *
 * Está en la fila de los atajos —la de la K, que es lo que hay que apretar si no
 * se confirma— y no en la de arriba, que a 900 px no tiene un pixel libre. Su
 * sitio exacto dentro de la fila está explicado en el HTML: aparecer no le puede
 * mover el suyo a ningún atajo.
 *
 * **No se puede apretar.** Sería una tercera puerta para lo mismo, y la K y el
 * botón de Claqueta ya están los dos a la vista.
 *
 * Que no se confirme NO se borra solo. Es la verdad de ese momento —«la última
 * palmada que oí no llegó a ser claqueta»— y es exactamente el diagnóstico que
 * le faltaba al editor cuando dijo «aún no está reconociendo la claqueta». Se
 * va cuando se anota una claqueta o cuando llega otra palmada.
 */
function pintarPalmada() {
    const chapa = $('#vivo-palmada');
    if (palmadaVencida()) {
        palmada.sinConfirmar = true;
        // Dicho una vez y en rojo, además de la pastilla: es el espejo exacto de
        // «se dijo claqueta pero no se oyó el aplauso», y las dos mitades del
        // mismo problema tienen que avisar igual.
        if (!palmada.dicho) {
            palmada.dicho = true;
            avisar('Se oyó una palmada y no se leyó «claqueta» alrededor: no se anotó ninguna. ' +
                'Si fue una claqueta, apretá K y queda en la palmada.', 'error');
        }
    }
    // Lo que la pastilla promete depende de si la K todavía engancha, así que
    // se resuelve acá y viaja con la palmada: `estados.js` dice las palabras,
    // no mira relojes.
    if (palmada) palmada.enganchable = palmadaEnganchable();
    const est = estados.dePalmada(palmada);
    chapa.hidden = !est;
    if (!est) return;
    chapa.dataset.estado = est.clave;
    chapa.textContent = est.palabra;
    chapa.title = est.porque;
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
    if (ev.tipo === 'claqueta') avisar(`Claqueta ${ev.claqueta} anotada: se dijo y se oyó el aplauso.`);
    // Una claqueta es la palabra Y el aplauso. La palabra sola no se anota, pero
    // se dice: por Zoom el aplauso puede no llegar, y ahí la pone quien mira.
    if (ev.tipo === 'claqueta-sin-aplauso') {
        avisar('Se dijo «claqueta» pero no se oyó el aplauso. Si lo hubo, apretá K.', 'error');
    }
}

/* ─── Dibujar ─────────────────────────────────────────────────────────── */

/**
 * Sin estado del motor por más que esto, algo se calló: el audio no llega, o el
 * motor se trabó. Lo normal es uno por segundo.
 */
const MOTOR_CALLADO_MS = 6000;

/**
 * Cuánto dura la clase cortada: la suma de lo que va a quedar en el XML.
 *
 * Es lo que el editor va a entregar, y no lo que se grabó: las tomas
 * desactivadas no cuentan, y lo que se dijo entre dos tomas tampoco. La
 * abierta cuenta hasta donde va el audio, así que el número sube mientras el
 * profesor habla y se queda quieto entre tomas — que es exactamente la
 * diferencia entre las dos cosas que la barra muestra.
 */
function segundosCortados() {
    const hasta = estado.ceroMs + (estado.segundos || 0) * 1000;
    let ms = 0;
    for (const t of estado.tomas) {
        if (t.descartada || t.inMs == null) continue;
        const fin = t.outMs != null ? t.outMs : hasta;
        if (fin > t.inMs) ms += fin - t.inMs;
    }
    return ms / 1000;
}

/** Lo de arriba: timecode, estado de la sesión y nivel. Barato: va seguido. */
function pintarBarra() {
    const callado = !terminando && Date.now() - ultimoAvisoMs > MOTOR_CALLADO_MS;
    const conAudio = audio ? { ...audio, caido: audio.caido || callado } : (callado ? { caido: true } : null);
    const est = estados.deSesion(estado, conAudio);
    // Sin cuadros: son dos dígitos que cambian treinta veces por segundo al
    // lado de los que se quieren leer. El cuadro sigue en cada fila y en el XML.
    $('#vivo-tc').textContent = fmt.relojCorto(estado.segundos);
    $('#vivo-cortada').textContent = fmt.relojCorto(segundosCortados());
    if (!terminando) {
        $('#vivo-estado').textContent = est.palabra;
        // Lo que la palabra no puede decir en dos palabras. Hasta ahora este
        // renglón era el único estado de la app sin su explicación al lado, y
        // «audio perdido» es justo el que no se entiende solo.
        $('#vivo-estado').title = est.porque || '';
        $('#vivo-estado').style.color =
            est.clave === 'sin audio' ? 'var(--error)'
                : (est.clave === 'abierta' || est.clave === 'releyendo' ? 'var(--accent)' : 'var(--ok)');
    }
    if (audio) {
        const barra = $('#vivo-nivel');
        barra.firstElementChild.style.width = `${Math.min(100, (audio.pico || 0) * 140)}%`;
        barra.dataset.pico = audio.pico > 0.95 ? 'clip' : (audio.pico > 0.7 ? 'alto' : '');
    }
    // Acá y no en `pintar`, por dos razones: esto corre igual mientras se
    // arrastra un borde o se escribe una nota, y sobre todo el vencimiento de la
    // palmada pasa SIN que el motor avise nada —es justamente que no avisó—.
    pintarPalmada();
}

function pintar() {
    if (!estado) return;
    // Con el menú de una palabra abierto tampoco se repinta: el menú habla de
    // una palabra de un texto que se rehace cada segundo, y debajo de «poner el
    // OUT acá» tiene que seguir estando lo mismo hasta que se elija o se cierre.
    if (pulsando || componiendo || menuPalabra) {
        pendiente = true;
        return;
    }
    pendiente = false;
    const fps = estado.fps;
    pintarBarra();
    pintarAtajos();

    const vivas = estado.tomas.filter(t => !t.descartada);
    $('#vivo-tomas').textContent = vivas.length;
    $('#vivo-claquetas').textContent = estado.claquetas.length;
    const desactivadas = estado.tomas.filter(t => t.descartada).length;
    $('#vivo-cuantas').textContent = estado.tomas.length
        ? `${vivas.length} van al XML${desactivadas ? ` · ${desactivadas} desactivada${desactivadas === 1 ? '' : 's'}` : ''}`
        : '';
    pintarInterruptores(desactivadas);
    $('#vivo-donde').textContent = estado.archivos ? estado.archivos.xml : '';

    const h = estado.historia || {};
    botonHistoria($('#btn-deshacer'), h.atras, h.queAtras, 'Deshacer');
    botonHistoria($('#btn-rehacer'), h.adelante, h.queAdelante, 'Rehacer');

    const foco = focoPendiente || recordarFoco();
    focoPendiente = null;
    const pantalla = $('#vista-vivo');
    const habiaFoco = pantalla.contains(document.activeElement) && document.activeElement !== pantalla;
    const rollos = recordarRollos();
    const quedan = textosQueSeQuedan();
    const lienzo = pantalla.querySelector('.scroll');
    const arriba = lienzo ? lienzo.scrollTop : 0;

    $('#ahora').innerHTML = ahora(fps);
    const items = laLista();
    $('#lista-vivo').innerHTML = items.length
        ? items.map(it => (it.toma ? filaToma(it.toma, fps) : filaClaqueta(it.claqueta, fps))).join('')
        : `<div class="vacio">${icono('toma')}
             <span class="vacio-titulo">Todavía no hay ninguna toma</span>
             <span class="v3">La primera se abre sola cuando alguien diga «3, 2, 1». Las
               claquetas aparecen acá también, en su lugar: con el aplauso, diciendo
               «claqueta» o con la tecla K.</span></div>`;

    montarTextos(quedan);
    devolverRollos(rollos, quedan);
    if (lienzo) lienzo.scrollTop = arriba;
    devolverFoco(foco);
    // El foco estaba en algo de esta pantalla que ya no existe (un botón que se
    // repintó, el campo de una toma que se cerró): vuelve a la pantalla y no al
    // `<body>`, así el teclado sigue siendo de acá.
    if (habiaFoco && !pantalla.contains(document.activeElement)) pantalla.focus({ preventScroll: true });
}

/**
 * Los textos que NO se rehacen en este repintado: el que se está arrastrando,
 * el que espera la respuesta de un borde soltado, y aquel cuyo IN/OUT está bajo
 * el puntero —si le entran palabras, la línea se corre justo antes de agarrarla
 * (medido: 293 px con seis palabras nuevas)—. Se sacan del DOM viejo y se
 * vuelven a poner en el hueco nuevo, con sus escuchas y todo.
 */
function textosQueSeQuedan() {
    const claves = new Set();
    const agarrado = texto.arrastrado();
    if (agarrado && agarrado.parentElement) claves.add(claveDe(agarrado.parentElement));
    if (enVuelo && Date.now() < enVuelo.hasta) claves.add(enVuelo.clave);
    if (sobreBorde) claves.add(sobreBorde);
    const quedan = new Map();
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const clave = claveDe(hueco);
        const t = hueco.querySelector('.transcript');
        if (t && claves.has(clave)) quedan.set(clave, t);
    }
    return quedan;
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
      </div>
      <div class="tarjeta-cuerpo">
        <input type="text" data-campo="nota" data-toma="${abierta.id}"
               value="${esc(abierta.comentario || '')}"
               placeholder="Nota de esta toma — se escribe en el marcador del XML">
        <div data-texto="abierta" data-toma="${abierta.id}"></div>
        <p class="v3 pista">Arrastrá el <b class="pista-in">IN</b> para mover el
          principio, o el <b class="pista-out">OUT</b> hacia atrás para cerrarla en esa palabra.
          Seleccioná un pedazo para comentarlo.</p>
        ${comentariosDe(abierta)}
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
           role="button" tabindex="0" aria-expanded="${abierta}"
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
    if (t.outMs == null) {
        return `<div class="cuerpo-toma">
            <p class="v3">Está abierta: su texto, su nota y sus bordes están arriba, en «Ahora».</p>
        </div>`;
    }
    return `<div class="cuerpo-toma">
        <input type="text" data-campo="nota" data-toma="${t.id}"
               value="${esc(t.comentario || '')}" placeholder="Nota de toda la toma — va en el marcador del XML">
        <div data-texto="cerrada" data-toma="${t.id}"></div>
        <p class="v3 pista">Lo gris es lo que se dijo fuera de la toma. Arrastrá el
          <b class="pista-in">IN</b> o el <b class="pista-out">OUT</b> para moverlos, o
          seleccioná un pedazo para comentarlo.</p>
        ${comentariosDe(t)}
        <div class="campo-fila" style="margin-top:8px">
          ${t.descartada ? '' : vistas(t)}
          <span class="crece"></span>
          ${sePuedeReabrir(t)
            ? `<button class="btn btn-tenue" type="button" data-hace="reabrir" data-toma="${t.id}"
                 title="Si «Pausa» la cerró de más: la toma sigue abierta y vuelve a juntar lo que se dice">
                 ${icono('abrirToma')} Reabrir</button>`
            : ''}
          ${estadosDe(t)}
        </div>
    </div>`;
}

/**
 * Los tres estados de una toma, en un solo control porque son excluyentes.
 *
 *   Mantener     va al XML
 *   Desactivar   no va al XML, pero sigue acá y se vuelve a mantener
 *   Descartar    sale de la sesión; se deshace con ⌘Z
 */
function estadosDe(t) {
    const activa = !t.descartada;
    return `<span class="estados-toma" role="group" aria-label="Estado de la toma ${t.id}">
      <button class="btn btn-tenue" type="button" data-hace="mantener" data-toma="${t.id}"
              aria-pressed="${activa}" title="Va al XML">Mantener</button>
      <button class="btn btn-tenue" type="button" data-hace="desactivar" data-toma="${t.id}"
              aria-pressed="${!activa}"
              title="No va al XML, pero sigue acá: con Mantener vuelve">Desactivar</button>
      <button class="btn btn-tenue" type="button" data-hace="descartar" data-toma="${t.id}"
              title="La saca de la sesión. Se deshace con ⌘Z">${icono('descartar')} Descartar</button>
    </span>`;
}

/** Reabrir solo la última, y solo si no hay otra abierta: es lo único que el motor honra. */
function sePuedeReabrir(t) {
    const ultima = estado.tomas[estado.tomas.length - 1];
    return t === ultima && estado.abierta == null && !t.descartada;
}

/**
 * Los comentarios sobre pedazos del texto, y el campo para uno nuevo.
 *
 * Van al XML como marcadores blancos en el tramo comentado, además de la nota
 * de la toma entera. El campo aparece cuando se selecciona un pedazo del texto
 * de ESTA toma (`alSeleccionar`).
 */
function comentariosDe(t) {
    const lista = (t.comentarios || []).map((c, i) => `
      <div class="comentario">
        <span class="hp-ico">${icono('comentar')}</span>
        <q>${esc(c.texto)}</q>
        <span class="crece">${esc(c.comentario)}</span>
        <button class="btn btn-tenue btn-ico" type="button" data-hace="borrar-comentario"
                data-toma="${t.id}" data-indice="${i}" title="Quitar este comentario">${icono('cerrar')}</button>
      </div>`).join('');
    const c = vista.comentando && vista.comentando.toma === t.id ? vista.comentando : null;
    const campo = c ? `
      <div class="comentar">
        <span class="v3">Comentar <q>${esc(c.texto)}</q></span>
        <input type="text" data-campo="comentario" data-toma="${t.id}"
               value="${esc(c.borrador || '')}"
               placeholder="Qué pasa en este pedazo — va al XML como marcador blanco">
        <button class="btn" type="button" data-hace="guardar-comentario" data-toma="${t.id}">Comentar</button>
        <button class="btn btn-tenue" type="button" data-hace="cancelar-comentario">Cancelar</button>
      </div>` : '';
    return lista || campo ? `<div class="comentarios">${lista}</div>${campo}` : '';
}

/**
 * Tomas y claquetas en una sola lista, la más nueva arriba.
 *
 * Juntas y en su orden porque es como se leen: «la claqueta 2 vino entre la
 * toma 3 y la 4» es lo que el editor necesita para saber en qué archivo de
 * Premiere cae cada toma. En un costado aparte había que cruzar la pantalla y
 * comparar timecodes para saberlo.
 */
function laLista() {
    const tomas = estado.tomas
        .filter(t => !(vista.sinDesactivadas && t.descartada))
        .map(t => ({ ms: t.inMs, toma: t }));
    const claquetas = (estado.claquetas || []).map(c => ({ ms: c.ms, claqueta: c }));
    return tomas.concat(claquetas).sort((a, b) => b.ms - a.ms);
}

/**
 * Los atajos de abajo del timecode.
 *
 * Se actualizan, no se rehacen: son botones que están bajo el mouse todo el
 * tiempo, y rehacerlos en cada repintado perdía el clic que caía entre el
 * apretar y el soltar (lo mismo que pasaba con la lista). Los de vista se
 * arman una vez, cuando llegan las vistas de la sesión.
 */
function pintarAtajos() {
    const cajaVistas = $('#atajo-vistas');
    if (!cajaVistas.children.length && (estado.vistas || []).length) {
        // Con el nombre de la vista y no con su sigla: «R R» y «S S» —la tecla
        // y la sigla, que son la misma letra— no dicen nada, y acá la gracia es
        // justamente que no haya que aprenderse las siglas para usar el mouse.
        cajaVistas.innerHTML = estado.vistas.map(v =>
            `<button class="atajo" type="button" data-hace="vista-tecla" data-vista="${esc(v.nombre)}"
               style="${estiloDeVista(estado.vistas, v.nombre)}"
               title="Poner la toma en ${esc(v.nombre)} (${esc(v.titulo)}). Tecla: ${esc(v.nombre[0])}">
               <kbd>${esc(v.nombre[0])}</kbd><span>${esc(v.titulo)}</span></button>`).join('');
    }

    // El borde dice qué va a hacer, no las dos cosas: es la misma tecla con el
    // signo cambiado, y leer «abrir / cerrar» obliga a decidir cuál toca.
    const abierta = estado.abierta != null;
    $('#atajo-borde-dice').textContent = abierta ? 'cerrar toma' : 'abrir toma';
    $('#atajo-borde').title = abierta
        ? 'Cerrar la toma en la última palabra dicha. Tecla: Enter'
        : 'Abrir una toma acá. Si el profesor ya venía hablando, el IN retrocede hasta donde arrancó la frase. Tecla: Enter';

    // La vista de la toma sobre la que caen las teclas, encendida.
    const laDeTeclas = laDeLasTeclas();
    for (const b of cajaVistas.children) {
        b.classList.toggle('es-elegida', Boolean(laDeTeclas) && laDeTeclas.vista === b.dataset.vista);
    }

    const h = estado.historia || {};
    $('#atajo-deshacer').disabled = !h.atras;
    $('#atajo-deshacer').title = h.atras ? `Deshacer «${h.queAtras}». Tecla: ⌘Z` : 'No hay nada que deshacer';
}

function pintarInterruptores(desactivadas) {
    const compacto = $('#btn-compacto');
    compacto.setAttribute('aria-pressed', String(vista.compacto));
    $('#vista-vivo').classList.toggle('es-compacto', vista.compacto);

    const boton = $('#btn-desactivadas');
    boton.hidden = !desactivadas && !vista.sinDesactivadas;
    boton.setAttribute('aria-pressed', String(vista.sinDesactivadas));
    boton.textContent = vista.sinDesactivadas
        ? `Desactivadas escondidas (${desactivadas})`
        : 'Ocultar desactivadas';
}

/**
 * Pone los textos con sus bordes en los huecos que dejó el HTML.
 *
 * Van aparte porque llevan escuchas de puntero, que un `innerHTML` no puede
 * traer. Cada hueco dice qué texto es (`data-texto`) y de qué toma.
 */
function montarTextos(quedan) {
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const cual = hueco.dataset.texto;
        const clave = claveDe(hueco);
        if (quedan && quedan.has(clave)) {
            hueco.append(quedan.get(clave));
            continue;
        }
        const toma = estado.tomas.find(t => t.id === Number(hueco.dataset.toma));
        // Soltar un borde: el texto queda como se soltó hasta que el motor
        // conteste (`enVuelo`), y ahí se repinta con lo que dijo.
        const enviar = hacer => (borde, ms, el) => {
            enVuelo = { clave, el, hasta: Date.now() + 8000 };
            Promise.resolve(hacer(borde, ms)).finally(() => {
                if (enVuelo && enVuelo.el === el) enVuelo = null;
                pintar();
            });
        };
        const soltar = enviar((borde, ms) => ponerBorde(cual, toma && toma.id, borde, ms));
        if (cual === 'espera') {
            hueco.append(texto.textoDe({
                modo: 'inactiva',
                palabras: sueltasLibres(),
                vacio: 'Escuchando… lo que se diga va a aparecer acá.'
            }, soltar));
        } else if (cual === 'abierta' && toma) {
            hueco.append(texto.textoDe({
                modo: 'abierta',
                antes: sueltasLibres().filter(w => w.t < toma.inMs).slice(-ORILLA_ABIERTA),
                palabras: recortarAbierta(toma.palabras),
                comentarios: toma.comentarios,
                vacio: 'Todavía no se oyó nada de esta toma.'
            }, soltar));
        } else if (cual === 'cerrada' && toma) {
            hueco.append(texto.textoDe({
                modo: 'cerrada',
                antes: toma.antes,
                palabras: toma.palabras,
                despues: toma.despues,
                comentarios: toma.comentarios,
                vacio: 'Esta toma no tiene texto.'
            }, soltar));
        }
    }
}

/**
 * Poner un borde de una toma en la palabra que empieza en `ms`.
 *
 * Es el único sitio que sabe a qué le pide cada borde de cada texto, y está
 * aparte porque hay DOS maneras de hacerlo —arrastrar la línea y el menú del
 * clic derecho— y las dos tienen que terminar en la misma llamada. Cada una
 * pasa por el motor por su puerta de siempre, así que el deshacer por campo
 * (`engine/deshacer.js`) ve lo mismo que veía: un `borde` es un cambio de toma,
 * cerrar es cerrar y abrir es abrir.
 *
 *   espera   no hay toma: poner el IN ahí es ABRIRLA desde esa palabra
 *   abierta  el OUT la cierra en esa palabra; el IN mueve el principio
 *   cerrada  los dos mueven su borde
 */
function ponerBorde(cual, tomaId, borde, ms) {
    if (cual === 'espera') return abrir(ms);
    if (cual === 'abierta' && borde === 'out') {
        return pedir(() => window.nt.grabarCerrarToma(ms));
    }
    return editar({ tipo: 'borde', toma: tomaId, borde, paredMs: ms });
}

/**
 * Cuántas palabras de una toma abierta larga se dibujan: el principio, para
 * poder correr el IN, y el final, que es lo que se está diciendo. Una toma de
 * veinte minutos son tres mil palabras, y repintarlas cada segundo costaba
 * 18 ms más casi 2 ms por cada movimiento del mouse al arrastrar.
 */
const ABIERTA_PRINCIPIO = 40;
const ABIERTA_FINAL = 300;

function recortarAbierta(palabras) {
    const ws = palabras || [];
    if (ws.length <= ABIERTA_PRINCIPIO + ABIERTA_FINAL + 20) return ws;
    const salteadas = ws.length - ABIERTA_PRINCIPIO - ABIERTA_FINAL;
    return ws.slice(0, ABIERTA_PRINCIPIO)
        .concat([{ corte: salteadas }], ws.slice(-ABIERTA_FINAL));
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

function devolverRollos(rollos, quedan) {
    for (const hueco of document.querySelectorAll('#vista-vivo [data-texto]')) {
        const t = hueco.querySelector('.transcript');
        if (!t) continue;
        const antes = rollos.get(claveDe(hueco));
        // El que se quedó igual vuelve a donde estaba: sacarlo del DOM y volver
        // a meterlo le borra el scroll.
        if (quedan && quedan.has(claveDe(hueco)) && antes) t.scrollTop = antes.arriba;
        else t.scrollTop = !antes || antes.alFondo ? t.scrollHeight : antes.arriba;
        marcarTapado(t);
        t.onscroll = () => marcarTapado(t);
    }
}

/** Desvanecer arriba solo si hay texto escondido arriba. */
function marcarTapado(t) {
    t.classList.toggle('es-tapado', t.scrollTop > 1);
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
    if (!a || !a.matches('#vista-vivo [data-campo]')) return null;
    return {
        campo: a.dataset.campo,
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
    const campo = document.querySelector(`${donde} [data-campo="${f.campo}"][data-toma="${f.toma}"]`)
        || document.querySelector(`#vista-vivo [data-campo="${f.campo}"][data-toma="${f.toma}"]`);
    if (!campo) {
        // El campo se fue: pasa con la nota de la toma abierta cuando «Pausa»
        // la cierra mientras se escribe. La toma sigue en la lista, así que se
        // despliega ahí y se sigue escribiendo en su nota, sin perder nada ni
        // mandar las letras que vienen como atajos.
        campoDesaparecidoMs = Date.now();
        const toma = estado && estado.tomas.find(t => String(t.id) === String(f.toma));
        if (f.campo === 'nota' && toma && toma.outMs != null && vista.abierta !== `t${toma.id}`) {
            vista.abierta = `t${toma.id}`;
            focoPendiente = { ...f, enAhora: false };
            setTimeout(pintar, 0);
        }
        return;
    }
    campo.value = f.valor;
    campo.focus({ preventScroll: true });
    campo.setSelectionRange(f.desde, f.hasta);
}

/**
 * Una claqueta, en la lista con las tomas.
 *
 * Un renglón de 32 px como una toma, pero sin fondo de color ni chevron: no es
 * una toma, no tiene vista ni nada que desplegar. Lo que la identifica va a la
 * izquierda —el icono, el número, el timecode, la frase con la que se dijo— y
 * lo que se confirma a la derecha: si es la referencia, cómo está y quitarla.
 */
function filaClaqueta(c, fps) {
    const est = estados.deClaqueta(c);
    return `<div class="fila fila-claqueta guarda" data-estado="${est.clave}"
        data-claqueta="${c.n}" ${est.porque ? `title="${esc(est.porque)}"` : ''}>
      <span class="hp-ico">${icono('claqueta')}</span>
      <span class="fila-nombre">Claqueta ${c.n}</span>
      <time class="fila-dato tc">${fmt.timecodeDe(c.ms, estado.ceroMs, fps)}</time>
      ${c.frase ? `<span class="fila-nota">«${esc(c.frase)}»</span>` : ''}
      <span class="crece"></span>
      ${c.n === 1 ? '<span class="pastilla" data-estado="listo" title="Es contra esta que el editor correlaciona los archivos en Premiere">referencia</span>' : ''}
      <span class="pastilla" data-estado="${est.clave}">${esc(est.palabra)}</span>
      <button class="btn btn-tenue btn-ico" type="button" data-hace="quitar-claqueta"
              data-claqueta="${c.n}" title="Quitarla: no era una claqueta">${icono('cerrar')}</button>
    </div>`;
}

/* ─── Los gestos ──────────────────────────────────────────────────────── */

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton) return;
    // El foco vuelve a la pantalla: con el botón enfocado, el Enter siguiente
    // lo volvía a apretar en vez de abrir o cerrar la toma.
    if (e.detail > 0) $('#vista-vivo').focus({ preventScroll: true });

    const toma = boton.dataset.toma ? Number(boton.dataset.toma) : null;
    switch (boton.dataset.hace) {
        case 'plegar':
            vista.abierta = vista.abierta === `t${toma}` ? null : `t${toma}`;
            vista.elegida = toma;
            pintar();
            break;
        case 'claqueta': await pedir(() => window.nt.grabarClaqueta(palmadaParaEnganchar())); break;
        // Los atajos de la barra: lo mismo que las teclas, con el mouse.
        case 'borde': await bordeDeToma(); break;
        case 'deshacer': await volver('deshacer'); break;
        case 'vista-tecla': {
            const suya = laDeLasTeclas();
            if (!suya) break;
            vista.elegida = suya.id;
            await editar({ tipo: 'vista', toma: suya.id, vista: boton.dataset.vista });
            break;
        }
        case 'abrir': await abrir(); break;
        case 'cerrar': await pedir(() => window.nt.grabarCerrarToma()); break;
        case 'vista':
            await editar({ tipo: 'vista', toma, vista: boton.dataset.vista });
            break;
        case 'mantener': await editar({ tipo: 'descartar', toma, descartada: false }); break;
        case 'desactivar': await editar({ tipo: 'descartar', toma, descartada: true }); break;
        case 'descartar':
            await editar({ tipo: 'eliminar', toma });
            if (!estado.tomas.some(t => t.id === toma)) {
                vista.abierta = null;
                avisar(`Toma ${toma} descartada. ⌘Z la devuelve.`);
            }
            break;
        case 'reabrir': await editar({ tipo: 'reabrir', toma }); break;
        case 'guardar-comentario': await guardarComentario(); break;
        case 'cancelar-comentario':
            vista.comentando = null;
            pintar();
            break;
        case 'borrar-comentario':
            await editar({ tipo: 'borrar-comentario', toma, indice: Number(boton.dataset.indice) });
            break;
        case 'quitar-claqueta':
            await pedir(() => window.nt.grabarQuitarClaqueta(Number(boton.dataset.claqueta)));
            break;
        case 'borde-aqui': {
            // La palabra y el texto se leyeron al abrir el menú: el texto no se
            // repintó mientras estaba abierto, pero la elección ya está tomada
            // y no depende de lo que haya debajo ahora.
            const que = menuPalabra;
            cerrarMenuDePalabra();
            if (que) await ponerBorde(que.cual, que.toma, boton.dataset.borde, Number(boton.dataset.ms));
            break;
        }
    }
}

/* ─── El menú del clic derecho sobre una palabra ───────────────────────── */

/**
 * Lo que el menú abierto va a hacer, o null.
 *
 * Se resuelve al abrirlo y no al elegir: mientras está abierto el texto no se
 * repinta, pero igual conviene que la opción lleve su palabra puesta, que es lo
 * que hace que elegir «poner el OUT» no dependa de dónde quedó el mouse.
 */
let menuPalabra = null;

/**
 * Clic derecho sobre una palabra: poner ahí el IN o el OUT.
 *
 * Es la otra manera de hacer lo que hace el arrastre. Existe porque arrastrar
 * una línea treinta renglones hacia arriba pide pulso, y porque en una toma
 * larga el borde que se quiere mover puede estar fuera de la vista.
 *
 * **Seleccionar de corrido sigue siendo comentar.** Son dos gestos que no se
 * pisan: `alSeleccionar` ignora el botón derecho, y esto solo mira una palabra.
 */
function alClicDerecho(e) {
    const w = e.target.closest && e.target.closest('.palabra');
    const donde = w && w.closest('.transcript.es-movible');
    cerrarMenuDePalabra();
    if (!w || !donde) return;
    // Sin esto sale el menú del navegador encima del nuestro. Electron no pone
    // ninguno propio (no hay `context-menu` en `main.js`), pero el de Chromium
    // aparece igual mientras se mira la maqueta.
    e.preventDefault();

    const hueco = donde.closest('[data-texto]');
    const cual = hueco.dataset.texto;
    const toma = hueco.dataset.toma ? Number(hueco.dataset.toma) : null;
    const opciones = texto.bordesQuePuede(donde, w).map(o => ({ ...o, ...comoSeLlama(cual, o.borde) }));
    if (!opciones.length) return;
    menuPalabra = { cual, toma };
    abrirMenuDePalabra(opciones, w.textContent, e.clientX, e.clientY);
}

/**
 * Cómo se llama cada opción, que es lo que el motor va a hacer de verdad.
 *
 * Las reglas de qué se puede ofrecer están en `texto.bordesQuePuede`, con el
 * arrastre. Acá está solo el nombre, porque el nombre no depende de la geometría
 * sino de qué texto es: el mismo IN puesto en el campo de espera ABRE una toma,
 * y puesto en una toma abierta le mueve el principio. Sin toma abierta el menú
 * sale con una opción sola, y eso es correcto: el OUT de una toma que no existe
 * no es nada, y cerrar la abierta en su última palabra ya es el botón primario.
 */
function comoSeLlama(cual, borde) {
    if (borde === 'in') {
        return cual === 'espera'
            ? { icono: 'abrirToma', dice: 'Abrir la toma acá',
                pista: 'La toma empieza en esta palabra. Es lo mismo que arrastrar el IN hasta acá' }
            : { icono: 'abrirToma', dice: 'Poner el IN acá',
                pista: 'La toma empieza en esta palabra, y lo de antes queda afuera' };
    }
    return cual === 'abierta'
        ? { icono: 'cerrarToma', dice: 'Cerrar la toma acá',
            pista: 'Esta palabra es la última de la toma, y la toma queda cerrada' }
        : { icono: 'cerrarToma', dice: 'Poner el OUT acá',
            pista: 'Esta palabra es la última de la toma, y lo de después queda afuera' };
}

function abrirMenuDePalabra(opciones, palabra, x, y) {
    const menu = $('#menu-palabra');
    menu.innerHTML = `<span class="menu-titulo">«${esc(recortar(palabra))}»</span>` +
        opciones.map(o => `<button class="menu-fila" type="button" role="menuitem"
            data-hace="borde-aqui" data-borde="${o.borde}" data-ms="${o.ms}"
            title="${esc(o.pista)}">
            <span class="hp-ico">${icono(o.icono)}</span>${o.dice}</button>`).join('');
    menu.hidden = false;
    // Medido y después acomodado: contra el borde de abajo o de la derecha se
    // abre hacia el otro lado, que es lo que hace cualquier menú y lo que evita
    // que la última palabra de un texto largo abra un menú fuera de la pantalla.
    const caja = menu.getBoundingClientRect();
    const margen = 8;
    const izq = Math.max(margen, Math.min(x, window.innerWidth - caja.width - margen));
    const arr = y + caja.height + margen > window.innerHeight
        ? Math.max(margen, y - caja.height)
        : y;
    menu.style.left = `${Math.round(izq)}px`;
    menu.style.top = `${Math.round(arr)}px`;
    const primera = menu.querySelector('.menu-fila');
    if (primera) primera.focus({ preventScroll: true });
}

/** El título del menú es para reconocer la palabra, no para leerla entera. */
function recortar(palabra) {
    const p = String(palabra || '').trim();
    return p.length > 24 ? `${p.slice(0, 23)}…` : p;
}

function cerrarMenuDePalabra() {
    if (!menuPalabra) return;
    menuPalabra = null;
    const menu = $('#menu-palabra');
    // Si el foco estaba en una opción, vuelve a la pantalla: vaciar el menú con
    // el foco adentro lo dejaba en el `body`, y desde ahí la K y el Enter
    // siguen andando de casualidad, porque el teclado se escucha en el documento.
    if (document.activeElement && menu.contains(document.activeElement)) {
        $('#vista-vivo').focus({ preventScroll: true });
    }
    menu.hidden = true;
    menu.innerHTML = '';
    // Mientras estaba abierto no se repintó: lo que llegó espera acá.
    if (pendiente) pintar();
}

/**
 * Un pedazo seleccionado del texto de una toma abre el campo para comentarlo.
 *
 * Se mira en el turno siguiente porque durante el `mouseup` la selección
 * todavía no está cerrada. Lo gris no cuenta: un comentario es sobre lo que
 * está adentro de la toma, que es lo que va al XML.
 */
function alSeleccionar(e) {
    // El botón derecho es el menú de la palabra y nada más. `mouseup` llega
    // igual con el derecho, así que sin esto un clic derecho hecho sobre una
    // selección que quedaba de antes abría además el campo de comentario.
    if (e.button !== 0) return;
    if (texto.arrastrando() || e.target.closest('.borde')) return;
    const hueco = e.target.closest('[data-texto="abierta"], [data-texto="cerrada"]');
    if (!hueco) return;
    setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const rango = sel.getRangeAt(0);
        const elegidas = [...hueco.querySelectorAll('.palabra:not(.es-orilla)')]
            .filter(w => rango.intersectsNode(w));
        if (!elegidas.length) return;
        const ultima = elegidas[elegidas.length - 1];
        vista.comentando = {
            toma: Number(hueco.dataset.toma),
            desdeMs: Number(elegidas[0].dataset.t),
            hastaMs: Number(ultima.dataset.hasta || ultima.dataset.t),
            texto: elegidas.map(w => w.textContent).join(' ')
        };
        sel.removeAllRanges();
        // El botón ya se soltó: se pinta ahora y no cuando venza la espera del
        // clic, que dejaba el campo sin foco y lo que se tecleaba iba a parar a
        // los atajos.
        pulsando = false;
        pintar();
        const campo = document.querySelector(`[data-campo="comentario"][data-toma="${vista.comentando.toma}"]`);
        if (campo) campo.focus({ preventScroll: true });
    }, 0);
}

async function guardarComentario() {
    const c = vista.comentando;
    if (!c) return;
    const campo = document.querySelector(`[data-campo="comentario"][data-toma="${c.toma}"]`);
    const comentario = campo ? campo.value.trim() : '';
    if (!comentario) {
        if (campo) campo.focus();
        return;
    }
    vista.comentando = null;
    await editar({ tipo: 'comentar', toma: c.toma, desdeMs: c.desdeMs, hastaMs: c.hastaMs, texto: c.texto, comentario });
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
    let nuevo = null;
    try {
        nuevo = await window.nt.grabarAbrirToma(ms);
    } catch (e) {
        avisar(`No se pudo abrir la toma: ${e.message}`, 'error');
    }
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
/**
 * El Enter anterior, mientras el motor contesta.
 *
 * Dos Enter seguidos —cerrar y volver a abrir— salían los dos con el MISMO
 * estado: el segundo veía la toma todavía abierta y pedía cerrarla otra vez, o
 * sea que se perdía. Se espera al primero y se decide con lo que quedó.
 */
let bordeEnVuelo = null;

async function bordeDeToma() {
    const previo = bordeEnVuelo;
    if (previo) await previo.catch(() => {});
    const mio = (async () => {
        if (estado && estado.abierta != null) {
            return pedir(() => window.nt.grabarCerrarToma());
        }
        return abrir();
    })();
    bordeEnVuelo = mio;
    try {
        return await mio;
    } finally {
        if (bordeEnVuelo === mio) bordeEnVuelo = null;
    }
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
    let nuevo = null;
    try {
        nuevo = await hacer();
    } catch (e) {
        avisar(`No se pudo: ${e.message}`, 'error');
    }
    if (turno.atrasada(mio)) return;
    if (nuevo) estado = nuevo;
    pintar();
}

async function volver(cual) {
    let r = null;
    try {
        r = cual === 'deshacer' ? await window.nt.grabarDeshacer() : await window.nt.grabarRehacer();
    } catch (e) {
        avisar(`No se pudo ${cual}: ${e.message}`, 'error');
    }
    if (!r) return;
    if (r.estado) { estado = r.estado; pintar(); }
    if (r.error) avisar(r.error, 'error');
    else if (r.ok) avisar(`${cual === 'deshacer' ? 'Deshecho' : 'Rehecho'}: ${r.que}`);
}

/* ─── Las teclas ──────────────────────────────────────────────────────── */

/**
 * Sobre la toma elegida, que es la que el editor tocó por última vez; si no
 * tocó ninguna, la abierta; si no hay abierta, la última que no esté
 * desactivada. Sin esa cadena, una tecla apretada mientras se abre la toma
 * siguiente cae sobre otra.
 */
function laDeLasTeclas() {
    if (!estado) return null;
    const por = id => estado.tomas.find(t => t.id === id);
    return por(vista.elegida) || por(estado.abierta)
        || [...estado.tomas].reverse().find(t => !t.descartada) || null;
}

/** Cuánto se siguen tragando las letras después de que el campo desapareció. */
const GRACIA_DE_CAMPO_MS = 1500;

function escribiendo() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

async function alTeclado(e) {
    if (!$('#vista-vivo').classList.contains('es-activa')) return;
    // Con Ajustes o Diagnóstico abiertos encima, el teclado es de ellos: una
    // «p» en el selector de idioma cambiaba la vista de una toma.
    if (document.querySelector('.telon.es-activa')) return;
    // Con el menú de una palabra abierto, el teclado es del menú: Escape lo
    // cierra sin tocar nada y las flechas van de una opción a la otra. Enter y
    // espacio los atiende el botón solo, que es lo que hace un botón.
    if (menuPalabra) {
        if (e.key === 'Escape') { e.preventDefault(); return cerrarMenuDePalabra(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const filas = [...$('#menu-palabra').querySelectorAll('.menu-fila')];
            const i = filas.indexOf(document.activeElement);
            const paso = e.key === 'ArrowDown' ? 1 : -1;
            const cual = filas[(Math.max(0, i) + paso + filas.length) % filas.length];
            if (cual) cual.focus({ preventScroll: true });
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') return;
    }
    if (escribiendo()) {
        const campo = document.activeElement;
        if (campo.dataset.campo === 'comentario') {
            if (e.key === 'Enter') { e.preventDefault(); return guardarComentario(); }
            if (e.key === 'Escape') { vista.comentando = null; return pintar(); }
            return;
        }
        // Enter en un campo guarda y suelta el foco, que es lo que uno espera
        // de un campo de una sola línea. Lo demás se lo queda el campo.
        if (e.key === 'Enter') campo.blur();
        return;
    }

    // Tecla mantenida apretada: una sola vez. Mantener la K ponía cinco
    // claquetas, y mantener Enter abría y cerraba tomas.
    if (e.repeat || e.isComposing) return;
    // El campo que se estaba escribiendo desapareció al repintar (`devolverFoco`):
    // lo que se siga escribiendo es esa nota y no atajos, y se estira mientras
    // se siga escribiendo. **Enter nunca se traga**: es el borde de la toma y
    // tiene que responder siempre, que es justo lo que se rompió.
    if (e.key !== 'Enter' && Date.now() - campoDesaparecidoMs < GRACIA_DE_CAMPO_MS) {
        campoDesaparecidoMs = Date.now();
        return;
    }

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return volver(e.shiftKey ? 'rehacer' : 'deshacer');
    }
    if (meta) return;

    // Sobre un control con foco, las teclas son del control: Enter en un botón
    // lo aprieta (antes abría o cerraba una toma), y en una fila la despliega.
    const control = e.target && e.target.closest && e.target.closest('button, select, a, [role="button"]');
    if (control) {
        if ((e.key === 'Enter' || e.key === ' ') && control.matches('[data-hace="plegar"]')) {
            e.preventDefault();
            control.click();
        }
        return;
    }

    const tecla = e.key.toLowerCase();
    if (tecla === 'k') {
        e.preventDefault();
        return pedir(() => window.nt.grabarClaqueta(palmadaParaEnganchar()));
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
    terminando = true;
    $('#vivo-estado').textContent = 'terminando';
    let salida = null;
    try {
        // Primero se deja de mandar y después se termina: un pedazo que llegara
        // entre las dos cosas iría a una sesión que ya está cerrando su audio.
        await fuente.dejarDeMandar();
        salida = await window.nt.grabarTerminar();
        await fuente.cerrar();
    } catch (e) {
        avisar(`No se pudo terminar: ${e.message}`, 'error');
    } finally {
        terminando = false;
        $('#btn-terminar').disabled = false;
    }
    if (salida) app.irACierre(salida);
}

/** El nivel lo sigue midiendo la fuente (`grabar/fuente.js`), y la barra lo dibuja acá. */
export function alNivel(pico) {
    if (!audio) return;
    audio.pico = Math.max(pico, (audio.pico || 0) * 0.85);
}
