/**
 * divisor-columnas.js — El divisor entre las tomas y lo que se dice, en la
 * distribución horizontal del tema nuevo.
 *
 * Se arrastra para repartir el ancho, y lo que se deja queda guardado
 * (`tema.parteTomas`). Doble clic lo vuelve a como venía, y con el foco puesto
 * las flechas lo mueven de a poco. Invisible hasta pasarle por encima: es una
 * raya entre dos columnas que se mira una vez y se olvida.
 *
 * Lo que se mueve es una variable del CSS (`--parte-tomas`); el reparto lo hace
 * la grilla, con su mínimo para cada columna, así que ni arrastrando hasta el
 * borde una de las dos queda inservible.
 */

import { $ } from '../chrome.js';
import * as tema from '../tema.js';

/** Cuánto mueve una flecha. */
const PASO = 0.02;

/** Dos toques más juntos que esto, sin moverse, son un doble clic. */
const DOBLE_TOQUE_MS = 400;

/** Las tomas están a la izquierda salvo con el texto a la izquierda. */
const tomasALaIzquierda = () => !document.body.classList.contains('es-texto-izquierda');

export function conectar() {
    const divisor = $('#divisor-columnas');
    if (!divisor) return;
    const lienzo = divisor.parentElement;

    // El doble clic se cuenta a mano: con el puntero capturado para arrastrar,
    // el navegador no manda `dblclick`.
    let ultimoToque = { ms: -Infinity, x: 0 };

    divisor.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.timeStamp - ultimoToque.ms < DOBLE_TOQUE_MS && Math.abs(e.clientX - ultimoToque.x) < 4) {
            ultimoToque = { ms: -Infinity, x: 0 };
            tema.ponerParteTomas(tema.PARTE_TOMAS_DE_FABRICA, { guardar: true });
            return;
        }
        ultimoToque = { ms: e.timeStamp, x: e.clientX };
        const caja = lienzo.getBoundingClientRect();
        let parte = null;
        divisor.setPointerCapture(e.pointerId);
        divisor.classList.add('es-arrastrando');
        document.body.classList.add('es-moviendo-divisor');
        const mover = ev => {
            const x = ev.clientX - caja.left;
            parte = tema.ponerParteTomas((tomasALaIzquierda() ? x : caja.width - x) / caja.width);
        };
        const soltar = () => {
            divisor.removeEventListener('pointermove', mover);
            divisor.classList.remove('es-arrastrando');
            document.body.classList.remove('es-moviendo-divisor');
            // Un toque sin arrastre no guarda nada: es medio doble clic.
            if (parte != null) tema.ponerParteTomas(parte, { guardar: true });
        };
        divisor.addEventListener('pointermove', mover);
        divisor.addEventListener('pointerup', soltar, { once: true });
        divisor.addEventListener('pointercancel', soltar, { once: true });
    });

    divisor.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        const hacia = (e.key === 'ArrowRight') === tomasALaIzquierda() ? 1 : -1;
        tema.ponerParteTomas(tema.parteTomas() + hacia * PASO, { guardar: true });
    });
}
