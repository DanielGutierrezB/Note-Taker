'use strict';
/**
 * vivo/palabras.js — Las palabras sueltas: limpiarlas, compararlas y meterlas en orden.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { norm } = require('../texto');

function limpio(texto) {
    return String(texto == null ? '' : texto).trim();
}

/** El texto de una palabra, sin signos, para comparar contra las señales. */
function palabra(w) {
    return limpio(w && w.texto).replace(/^[¿¡"'(]+/, '');
}

/**
 * El texto de una señal, tal como va al comentario del marcador.
 *
 * El parser de post busca el conteo justo detrás del separador para saber dónde
 * termina la nota del editor y empieza lo que se dijo, así que el conteo tiene
 * que llegar escrito. Con "Retomamos" no hay conteo y el parser cae en su
 * convención vieja, que también funciona.
 */
function textoDe(palabras, desde, hasta) {
    return (palabras || []).slice(desde, hasta + 1).map(w => limpio(w.texto)).join(' ').trim();
}

/** Las dos listas juntas, en orden y sin repetir lo que esté en las dos. */
function juntas(a, b) {
    const vistas = new Set();
    return (a || []).concat(b || [])
        .filter(w => {
            const clave = `${w.t}|${w.texto}`;
            if (vistas.has(clave)) return false;
            vistas.add(clave);
            return true;
        })
        .sort((x, y) => x.t - y.t);
}

/**
 * La misma palabra oída dos veces, aunque una de las dos venga entera y la otra
 * cortada («funcion» y «funcionando»).
 */
function mismaPalabra(a, b) {
    if (!a || !b) return false;
    return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

/** Dos palabras del ciclo son la misma si suenan igual y caen así de cerca. */
const MISMA_DEL_CICLO_MS = 600;

/**
 * Cuánto puede correrse la hora de una palabra sin que eso diga nada del orden.
 *
 * Whisper le pone a la misma palabra horas distintas de una pasada a otra, hasta
 * medio segundo (ver `dondeSigue`). Por eso el ciclo engancha por TEXTO y no por
 * hora, y por eso una palabra que llega con la hora un poco por detrás de la
 * última guardada va al final igual: el orden en que se oyó manda sobre una
 * deriva de milisegundos. Lo que sí se mete en su sitio es lo que llega
 * claramente tarde —segundos, el atraso del ciclo contra una toma recién
 * cerrada—, que no es deriva: es una palabra de antes.
 */
const DERIVA_DEL_CICLO_MS = 1000;

/**
 * Una palabra del ciclo, en una lista que se mantiene en orden y sin repetir.
 * Vale para las palabras de una toma y para el colchón de sueltas, que tienen
 * el mismo problema: el ciclo oye con atraso y con solape.
 */
function meterEnOrden(lista, w) {
    const n = norm(w.texto);
    for (let i = lista.length - 1; i >= 0 && w.t - lista[i].t < MISMA_DEL_CICLO_MS * 4; i--) {
        if (Math.abs(lista[i].t - w.t) < MISMA_DEL_CICLO_MS && mismaPalabra(norm(lista[i].texto), n)) return false;
    }
    let donde = lista.length;
    while (donde > 0 && lista[donde - 1].t - w.t > DERIVA_DEL_CICLO_MS) donde--;
    lista.splice(donde, 0, w);
    return true;
}

module.exports = {
    limpio,
    palabra,
    textoDe,
    juntas,
    mismaPalabra,
    MISMA_DEL_CICLO_MS,
    DERIVA_DEL_CICLO_MS,
    meterEnOrden
};
