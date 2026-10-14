'use strict';
/**
 * menu-de-palabra.js — El clic derecho sobre una palabra: poner ahí el IN o el OUT.
 *
 * Es la otra manera de hacer lo que hace el arrastre. Existe porque arrastrar
 * una línea treinta renglones hacia arriba pide pulso, y porque en una toma
 * larga el borde que se quiere mover puede estar fuera de la vista.
 *
 * **Está acá y no en una pantalla porque lo usan las dos**, igual que
 * `texto-toma.js`, que es de donde salen las palabras sobre las que esto abre.
 * La pantalla de clase y la del vídeo de la semana dibujan el mismo transcript
 * con el mismo módulo, así que el menú tiene que ofrecer lo mismo en las dos y
 * arreglar una tiene que arreglar las dos. Vivía dentro de `pantalla-vivo.js`
 * cuando era de una sola.
 *
 * Lo que cambia entre pantallas son tres cosas y se dicen al conectar: dónde
 * vuelve el foco al cerrar, qué hacer con lo que quedó sin pintar mientras
 * estaba abierto, y a quién se le pide el borde. El resto —qué se ofrece, cómo
 * se llama, dónde se dibuja— es igual.
 *
 * **Seleccionar de corrido sigue siendo comentar.** Son dos gestos que no se
 * pisan: cada pantalla ignora el botón derecho al seleccionar, y esto solo mira
 * una palabra.
 */

import { $, esc } from '../chrome.js';
import { icono } from '../iconos.js';
import * as texto from './texto-toma.js';

/**
 * Lo que el menú abierto va a hacer, o null.
 *
 * Se resuelve al abrirlo y no al elegir: mientras está abierto el texto no se
 * repinta, pero igual conviene que la opción lleve su palabra puesta, que es lo
 * que hace que elegir «poner el OUT» no dependa de dónde quedó el mouse.
 */
let abierto = null;

/**
 * Las pantallas que lo usan, por su raíz.
 *
 * Un registro y no una sola dueña porque **las dos se conectan al arrancar la
 * app** (`vivo.conectar` y `semanal.conectar`, seguidas, en `app.js`) y el menú
 * es uno solo en el documento: `#menu-palabra` vive fuera de `<main>`, que es
 * lo que lo salva del repintado de la tarjeta de debajo. Con una sola dueña
 * ganaría la que se conectó última y el menú de una pantalla le pediría el
 * borde a la otra. Se enruta por dónde se hizo el clic, que es exacto y no
 * depende del orden.
 */
const dueños = new Map();

/** El `#menu-palabra` lo atiende este módulo, y una sola vez. */
let enganchado = false;

/**
 * Una pantalla que quiere el menú sobre sus palabras.
 *
 * `raiz` es dónde están sus transcripts, `foco` a dónde vuelve el foco al
 * cerrar, `alCerrar` qué hacer con lo que quedó sin pintar mientras estaba
 * abierto, y `alElegir` a quién se le pide el borde — que tiene que ser el
 * MISMO sitio al que se lo pide el arrastre.
 */
export function conectar(p) {
    dueños.set(p.raiz, {
        raiz: p.raiz,
        foco: p.foco || p.raiz,
        alCerrar: typeof p.alCerrar === 'function' ? p.alCerrar : () => {},
        alElegir: typeof p.alElegir === 'function' ? p.alElegir : () => {},
        // Si esta pantalla sabe partir una toma. Lo declara ella y no se
        // supone acá: el vídeo de la semana usa el mismo menú y no lo sabe
        // hacer, y ofrecérselo sería un botón que no hace nada.
        puedeDividir: p.puedeDividir === true
    });
    $(p.raiz).addEventListener('contextmenu', alClicDerecho);
    if (enganchado) return;
    enganchado = true;
    $('#menu-palabra').addEventListener('click', e => {
        const fila = e.target.closest && e.target.closest('.menu-fila');
        if (!fila) return;
        const que = elegido(fila);
        if (que) que.dueño.alElegir(que);
    });
    // En el documento y en captura, para que un clic en cualquier otro sitio lo
    // cierre antes de hacer lo suyo.
    document.addEventListener('pointerdown', e => {
        if (abierto && esDeFuera(e.target)) cerrar();
    }, true);
    // La ventana se fue a otro lado: un menú abierto encima de una pantalla que
    // ya no se está mirando, y con el texto congelado detrás, no sirve a nadie.
    window.addEventListener('blur', cerrar);
}

/** Si hay uno abierto: con esto la pantalla sabe que no puede repintar. */
export function hay() {
    return Boolean(abierto);
}

/**
 * El clic derecho sobre una palabra.
 *
 * Devuelve si se abrió, que es lo que deja a la pantalla saber si tiene que
 * dejar de repintar. Sobre cualquier otra cosa cierra el que hubiera y no hace
 * nada más: un clic derecho en el aire es cerrar.
 */
function alClicDerecho(e) {
    const w = e.target.closest && e.target.closest('.palabra');
    const donde = w && w.closest('.transcript.es-movible');
    cerrar();
    const dueño = w && [...dueños.values()].find(d => w.closest(d.raiz));
    if (!w || !donde || !dueño) return false;
    // Sin esto sale el menú del navegador encima del nuestro. Electron no pone
    // ninguno propio (no hay `context-menu` en `main.js`), pero el de Chromium
    // aparece igual mientras se mira la maqueta.
    e.preventDefault();

    const hueco = donde.closest('[data-texto]');
    const cual = hueco.dataset.texto;
    const toma = hueco.dataset.toma ? Number(hueco.dataset.toma) : null;
    const bordes = texto.bordesQuePuede(donde, w);
    const opciones = bordes.map(o => ({ ...o, ...comoSeLlama(cual, o.borde) }));
    // Y partir la toma por esa palabra. Se ofrece justo donde se podría poner el
    // IN sobre una toma que ya existe, y no es casualidad: las dos dicen «acá
    // empieza algo». La diferencia es qué pasa con lo de antes — el IN lo deja
    // afuera y dividir lo deja en una toma propia.
    const paraIn = bordes.find(o => o.borde === 'in');
    if (dueño.puedeDividir && cual !== 'espera' && paraIn) {
        opciones.push({ borde: 'dividir', ms: paraIn.ms, ...NOMBRES.dividir });
    }
    if (!opciones.length) return false;
    abierto = { cual, toma, dueño };
    dibujar(opciones, w.textContent, e.clientX, e.clientY);
    return true;
}

/**
 * La opción elegida, ya cerrada: `{cual, toma, borde, ms}` o null.
 *
 * La palabra y el texto se leyeron al abrir: el texto no se repintó mientras
 * estaba abierto, pero la elección ya está tomada y no depende de lo que haya
 * debajo ahora.
 */
function elegido(boton) {
    const que = abierto;
    cerrar();
    if (!que) return null;
    return { ...que, borde: boton.dataset.borde, ms: Number(boton.dataset.ms) };
}

/**
 * Con el menú abierto el teclado es del menú.
 *
 * Escape lo cierra sin tocar nada y las flechas van de una opción a la otra.
 * Enter y espacio los atiende el botón solo, que es lo que hace un botón, y el
 * Tab es del navegador. Todo lo demás se traga: con el menú encima, la K o una
 * letra de vista cambiarían algo que no se está mirando.
 *
 * Devuelve si la tecla ya está atendida y la pantalla no tiene que seguir.
 */
export function alTeclado(e) {
    if (!abierto) return false;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const filas = [...$('#menu-palabra').querySelectorAll('.menu-fila')];
        const i = filas.indexOf(document.activeElement);
        const paso = e.key === 'ArrowDown' ? 1 : -1;
        const cual = filas[(Math.max(0, i) + paso + filas.length) % filas.length];
        if (cual) cual.focus({ preventScroll: true });
        return true;
    }
    return e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab';
}

/** Si el clic cayó fuera del menú, es cerrarlo. */
function esDeFuera(destino) {
    return !destino || !destino.closest('#menu-palabra');
}

export function cerrar() {
    if (!abierto) return;
    const { dueño } = abierto;
    abierto = null;
    const menu = $('#menu-palabra');
    // Si el foco estaba en una opción, vuelve a la pantalla: vaciar el menú con
    // el foco adentro lo dejaba en el `body`, y desde ahí la K y el Enter
    // siguen andando de casualidad, porque el teclado se escucha en el documento.
    if (document.activeElement && menu.contains(document.activeElement)) {
        const vuelve = $(dueño.foco);
        if (vuelve) vuelve.focus({ preventScroll: true });
    }
    menu.hidden = true;
    menu.innerHTML = '';
    // Mientras estaba abierto no se repintó: lo que llegó espera acá.
    dueño.alCerrar();
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
const NOMBRES = {
    abrir: { icono: 'abrirToma', dice: 'Abrir la toma acá',
        pista: 'La toma empieza en esta palabra. Es lo mismo que arrastrar el IN hasta acá' },
    cerrar: { icono: 'cerrarToma', dice: 'Cerrar la toma acá',
        pista: 'Esta palabra es la última de la toma, y la toma queda cerrada' },
    in: { icono: 'abrirToma', dice: 'Poner el IN acá',
        pista: 'La toma empieza en esta palabra, y lo de antes queda afuera' },
    out: { icono: 'cerrarToma', dice: 'Poner el OUT acá',
        pista: 'Esta palabra es la última de la toma, y lo de después queda afuera' },
    dividir: { icono: 'dividir', dice: 'Dividir la toma acá',
        pista: 'La toma se parte en dos por esta palabra, pegadas: sirve para cambiar '
            + 'de vista sin cortar lo que se está diciendo' }
};

function comoSeLlama(cual, borde) {
    const hace = texto.queHaceElBorde(cual, borde);
    return NOMBRES[hace === 'mover' ? borde : hace];
}

function dibujar(opciones, palabra, x, y) {
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
