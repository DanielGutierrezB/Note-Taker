/**
 * divisor-secciones.js — El divisor entre lo que se dice y las tomas, en el
 * tema nuevo.
 *
 * En horizontal está parado y reparte el ancho; en vertical está acostado y
 * reparte el alto (`tema.parteDelDivisor`). Se arrastra, lo que se deja queda
 * guardado para esa distribución, doble clic lo vuelve a como venía, y con el
 * foco puesto las flechas lo mueven de a poco. Invisible hasta pasarle por
 * encima: es una raya entre dos partes que se mira una vez y se olvida.
 *
 * Lo que se mueve es una variable del CSS (`--parte-tomas`, `--parte-ahora`); el
 * reparto lo hace la grilla, con su mínimo para cada lado, así que ni
 * arrastrando hasta el borde una de las dos queda inservible.
 */

import { $ } from '../chrome.js';
import * as tema from '../tema.js';

/** Cuánto mueve una flecha. */
const PASO = 0.02;

/** Dos toques más juntos que esto, sin moverse, son un doble clic. */
const DOBLE_TOQUE_MS = 400;

/**
 * Qué parte va a valer el divisor puesto en este punto de la pantalla.
 *
 * En vertical, «Ahora» va arriba: su parte es lo que queda por encima. En
 * horizontal la parte es la de las tomas, que van a la izquierda salvo con el
 * texto a la izquierda.
 */
function parteEn(caja, ev, cual) {
    if (cual === 'ahora') return (ev.clientY - caja.top) / caja.height;
    const x = ev.clientX - caja.left;
    return (document.body.classList.contains('es-texto-izquierda') ? caja.width - x : x) / caja.width;
}

/** Qué flecha agranda la parte: en vertical, abajo; en horizontal, hacia el texto. */
function sentidoDe(tecla, cual) {
    if (cual === 'ahora') return { ArrowDown: 1, ArrowUp: -1 }[tecla] || 0;
    const tomasALaIzquierda = !document.body.classList.contains('es-texto-izquierda');
    return ({ ArrowRight: 1, ArrowLeft: -1 }[tecla] || 0) * (tomasALaIzquierda ? 1 : -1);
}

export function conectar() {
    const divisor = $('#divisor-secciones');
    if (!divisor) return;
    const lienzo = divisor.parentElement;

    // El doble clic se cuenta a mano: con el puntero capturado para arrastrar,
    // el navegador no manda `dblclick`.
    let ultimoToque = { ms: -Infinity, x: 0, y: 0 };

    divisor.addEventListener('pointerdown', e => {
        // Sin `preventDefault`: se comería el doble clic. Lo que evita que el
        // arrastre seleccione texto es `es-moviendo-divisor` en el body.
        if (e.button !== 0) return;
        const cual = tema.parteDelDivisor();
        const quieto = Math.abs(e.clientX - ultimoToque.x) < 4 && Math.abs(e.clientY - ultimoToque.y) < 4;
        if (e.timeStamp - ultimoToque.ms < DOBLE_TOQUE_MS && quieto) {
            ultimoToque = { ms: -Infinity, x: 0, y: 0 };
            tema.ponerParte(cual, tema.parteDeFabrica(cual), { guardar: true });
            return;
        }
        ultimoToque = { ms: e.timeStamp, x: e.clientX, y: e.clientY };
        const caja = lienzo.getBoundingClientRect();
        let parte = null;
        divisor.setPointerCapture(e.pointerId);
        divisor.classList.add('es-arrastrando');
        document.body.classList.add('es-moviendo-divisor');
        const mover = ev => { parte = tema.ponerParte(cual, parteEn(caja, ev, cual)); };
        const soltar = () => {
            divisor.removeEventListener('pointermove', mover);
            divisor.classList.remove('es-arrastrando');
            document.body.classList.remove('es-moviendo-divisor');
            // Un toque sin arrastre no guarda nada: es medio doble clic.
            if (parte != null) tema.ponerParte(cual, parte, { guardar: true });
        };
        divisor.addEventListener('pointermove', mover);
        divisor.addEventListener('pointerup', soltar, { once: true });
        divisor.addEventListener('pointercancel', soltar, { once: true });
    });

    divisor.addEventListener('keydown', e => {
        const cual = tema.parteDelDivisor();
        const sentido = sentidoDe(e.key, cual);
        if (!sentido) return;
        e.preventDefault();
        e.stopPropagation();
        tema.ponerParte(cual, tema.parte(cual) + sentido * PASO, { guardar: true });
    });
}
