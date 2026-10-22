'use strict';
/**
 * alrededor-de-la-toma.js — Lo que rodea a una toma: lo que se dijo antes de su
 * IN y después de su OUT, y hasta dónde es de otra toma.
 *
 * Es lo que deja correr un borde mirando el texto: para adelantar el IN hay que
 * ver qué se dijo antes, y para atrasar el OUT, qué se dijo después. Vivía en
 * `pantalla-vivo.js` y el vídeo de la semana no lo tenía: su editor mostraba
 * solo la orilla corta de la relectura, sin la marca de dónde termina la toma
 * anterior, y con la toma abierta no mostraba nada antes del IN. El editor lo
 * pidió así: «al editar debería salirme el transcript previo al IN para ajustar
 * cortes». Ahora las dos pantallas lo piden acá.
 *
 * Son cuentas sobre el estado de una sesión —`{ tomas, sueltas, vistas }`— y
 * nada más: ni DOM ni puente, así que se prueban importándolas.
 */

import { coloresDeVista } from '../colores.js';

/** Cuántas palabras de antes del IN se ven con la toma abierta: las que hacen falta para correrlo. */
export const ORILLA_ABIERTA = 24;

/**
 * La toma de antes de una: la más cercana que termina antes de que esta empiece.
 *
 * Copia de `tomaAnterior` en `engine/notas-vivo.js`, que es la fuente de verdad.
 * Vive acá otra vez porque la ventana corre en otro proceso y necesita la misma
 * respuesta para dibujar el límite y para frenar el arrastre antes de pedir
 * nada. Que las dos digan lo mismo lo comprueba `tomas-que-no-se-pisan.test.js`
 * contra la clase de verdad del 30/09, toma por toma.
 *
 * Las descartadas no cuentan: descartar saca la toma del XML, así que su tramo
 * queda libre. Es lo mismo que decide el motor, y por el mismo motivo.
 */
export function tomaAnterior(estado, toma) {
    let previa = null;
    for (const t of estado.tomas) {
        if (t.id === toma.id || t.descartada) continue;
        if (t.outMs == null || t.inMs == null || t.inMs >= toma.inMs) continue;
        if (!previa || t.outMs > previa.outMs) previa = t;
    }
    return previa;
}

/**
 * La toma de después de una: la primera que empieza después de que esta empieza.
 *
 * El espejo de `tomaAnterior`, y copia de `techoDelOut` en
 * `engine/notas-vivo.js` por lo mismo: la ventana necesita la misma respuesta
 * para dibujar la marca y para frenar el arrastre del OUT sin pedir nada.
 *
 * Se mide contra el IN de ESTA y no contra su OUT —es lo que hace el motor—
 * porque una toma sin cerrar todavía no tiene OUT y aun así tiene vecinas.
 */
export function tomaSiguiente(estado, toma) {
    let proxima = null;
    for (const t of estado.tomas) {
        if (t.id === toma.id || t.descartada || t.inMs == null) continue;
        if (t.inMs <= toma.inMs) continue;
        if (!proxima || t.inMs < proxima.inMs) proxima = t;
    }
    return proxima;
}

/**
 * Cuántas palabras de la toma anterior se dejan ver antes del IN.
 *
 * Trescientas son unos dos minutos de habla: bastante para releer lo que se
 * acaba de decir y decidir dónde empieza la toma nueva, que es para lo que el
 * editor lo pidió. **Y esta ventana sí puede ser una ventana**, al contrario de
 * la que hacía saltar el texto (ver la nota en `montarTextos`): la toma anterior
 * está cerrada, su lista de palabras no cambia más, así que las trescientas
 * siempre son las mismas trescientas y nada se corre debajo del ojo.
 */
export const ANTERIOR_MAX = 300;

/**
 * Lo que va antes del IN de la toma abierta, y hasta dónde es de otra.
 *
 * El editor, después de la clase del 30/09: «El transcript de "antes", ya está
 * escrito, debería dejarme verlo siempre en donde se escribe el transcript, si
 * hay una parte del transcript del antes seleccionada en otra toma, que se
 * entienda visualmente. Esto para poder hacer scroll y seleccionar durante la
 * toma.»
 *
 * Antes acá solo iban las palabras sueltas —el colchón del motor—, y con una
 * toma recién abierta el colchón está VACÍO: `abrirToma` le
 * pasa la tirada a la toma y el conteo lo vacía del todo. De ahí la sensación de
 * que lo anterior «se demora en cargar»: no se demoraba, no estaba. El texto que
 * el editor quería ver no vive en las sueltas sino en la toma anterior, que ya
 * está escrita y entera en el estado.
 *
 * Así que van las dos cosas, en orden: las últimas palabras de la toma anterior,
 * y después lo que se dijo entre su OUT y este IN (su orilla de después más las
 * sueltas, que es tierra de nadie y ahí SÍ puede entrar el IN).
 *
 * @returns {{antes: Array, limite: object|null}} `limite` es la toma anterior con
 *   su OUT: donde se dibuja la marca que el IN no puede cruzar
 */
export function antesDeLaAbierta(estado, toma) {
    const previa = tomaAnterior(estado, toma);
    const libres = sueltasEntre(estado, previa ? previa.outMs : -Infinity, toma.inMs);
    if (!previa) return { antes: libres.slice(-ORILLA_ABIERTA), limite: null };
    // De la toma anterior, con su dueña pegada para que se distinga al dibujar.
    const suyas = (previa.palabras || []).slice(-ANTERIOR_MAX)
        .map(w => ({ ...w, de: { id: previa.id, vista: previa.vista, ...coloresDeVista(estado.vistas, previa.vista) } }));
    // Entre su OUT y este IN: su orilla de después y las sueltas son la misma
    // tirada contada dos veces, así que se juntan sin repetir.
    const vistas = new Set(libres.map(w => w.t));
    const medio = (previa.despues || [])
        .filter(w => w.t >= previa.outMs && w.t < toma.inMs && !vistas.has(w.t))
        .concat(libres)
        .sort((a, b) => a.t - b.t);
    return {
        antes: suyas.concat(medio),
        limite: { toma: previa.id, ms: previa.outMs, ...coloresDeVista(estado.vistas, previa.vista) }
    };
}

/**
 * Cuántas palabras de la toma siguiente se dejan ver después del OUT.
 *
 * Muchas menos que las trescientas del otro lado, a propósito. Antes del IN uno
 * está releyendo lo que acaba de decir para decidir dónde empieza la toma; acá
 * es al revés —lo que viene ya se vio pasar— y lo único que hace falta es
 * entender dónde se frena el OUT. Con cincuenta, el asomo de la toma siguiente
 * pesaba tanto como la toma que se está mirando. Veinticinco son unos diez
 * segundos: lo justo para reconocer dónde empieza.
 */
export const SIGUIENTE_MAX = 25;

/**
 * Lo que va después del OUT de una toma cerrada, y desde dónde es de otra.
 *
 * El espejo de `antesDeLaAbierta`, y existe por lo mismo. El editor, después
 * de la clase del 07/10: «Cuando hago un OUT puedo ver en el espacio de toma
 * para abrir el transcript aparecer, pero no se ve en el out de la toma que
 * cerré. Por lo cual no puedo ajustar el OUT si deseo adelantarlo hasta mucho
 * después.»
 *
 * Y tenía razón: acá iba solo `toma.despues`, que lo escribe la relectura con
 * sus 12 s de orilla. Hasta que Whisper termina no hay NADA del otro lado del
 * OUT, y sin palabras el arrastre no tiene dónde apoyarse —`bordesQuePuede`
 * necesita una palabra siguiente—. Las palabras ya estaban en la pantalla, en
 * el campo de espera de la toma que viene; lo que faltaba era mostrarlas
 * también acá.
 *
 * Así que van las tres cosas, en orden: la orilla de la relectura, lo que se
 * oyó suelto desde el OUT, y el principio de la toma siguiente si ya hay una.
 *
 * @returns {{despues: Array, limiteDespues: object|null}} `limiteDespues` es la
 *   toma siguiente con su IN: donde se dibuja la marca que el OUT no cruza
 */
export function despuesDeLaCerrada(estado, toma) {
    const siguiente = tomaSiguiente(estado, toma);
    const techo = siguiente ? siguiente.inMs : Infinity;
    // La orilla de la relectura, las sueltas y la orilla de la siguiente son la
    // misma tirada contada hasta tres veces: se juntan por tiempo, sin repetir.
    const tierraDeNadie = new Map();
    for (const w of (toma.despues || [])
        .concat(sueltasEntre(estado, toma.outMs, techo), siguiente ? (siguiente.antes || []) : [])) {
        if (w.t >= toma.outMs && w.t < techo && !tierraDeNadie.has(w.t)) tierraDeNadie.set(w.t, w);
    }
    const medio = [...tierraDeNadie.values()].sort((a, b) => a.t - b.t);
    if (!siguiente) return { despues: medio, limiteDespues: null };
    // De la toma siguiente, con su dueña pegada para que se distinga al dibujar.
    const suyas = (siguiente.palabras || []).slice(0, SIGUIENTE_MAX)
        .map(w => ({ ...w, de: { id: siguiente.id, vista: siguiente.vista, ...coloresDeVista(estado.vistas, siguiente.vista) } }));
    return {
        despues: medio.concat(suyas),
        limiteDespues: {
            toma: siguiente.id, ms: siguiente.inMs,
            ...coloresDeVista(estado.vistas, siguiente.vista)
        }
    };
}

/**
 * Lo que va antes del IN de una toma CERRADA, y hasta dónde es de otra.
 *
 * El espejo de `despuesDeLaCerrada`, y faltaba. Acá iba solo `toma.antes` —la
 * orilla que escribe la relectura— mientras que del otro lado se juntaban tres
 * fuentes, y esa asimetría es un agujero con dos caras:
 *
 *   · hasta que la relectura termina no hay NADA antes del IN, así que el
 *     arrastre no tiene dónde apoyarse (`bordesQuePuede` necesita una palabra) y
 *     el IN de una toma recién cerrada no se podía correr hacia atrás;
 *   · lo que se dijo entre dos tomas se veía desde la de ARRIBA y no desde la de
 *     abajo. El editor lo dijo tal cual el 13/10: «no me muestra transcript
 *     antes del In en la toma 12, y en la 11 dice que corta al inicio de la 12.
 *     Pero si hay transcript entre ambas, debería poder modificar en cualquiera
 *     de los 2 lados».
 *
 * Así que van las mismas tres cosas que del otro lado, en orden: el final de la
 * toma anterior si ya hay una, lo que se dijo entre su OUT y este IN —su orilla
 * de después, la orilla de esta y lo suelto, que son la misma tirada contada
 * hasta tres veces— y nada más.
 *
 * @returns {{antes: Array, limite: object|null}} `limite` es la toma anterior
 *   con su OUT: donde se dibuja la marca que el IN no puede cruzar
 */
export function antesDeLaCerrada(estado, toma) {
    const previa = tomaAnterior(estado, toma);
    const piso = previa ? previa.outMs : -Infinity;
    const tierraDeNadie = new Map();
    for (const w of (toma.antes || [])
        .concat(sueltasEntre(estado, piso, toma.inMs), previa ? (previa.despues || []) : [])) {
        if (w.t >= piso && w.t < toma.inMs && !tierraDeNadie.has(w.t)) tierraDeNadie.set(w.t, w);
    }
    const medio = [...tierraDeNadie.values()].sort((a, b) => a.t - b.t);
    if (!previa) return { antes: medio, limite: null };
    // Del final de la toma anterior se asoman pocas, como del principio de la
    // siguiente del otro lado: acá lo que hace falta es entender dónde se frena
    // el IN, no releer esa toma (para eso está su propia tarjeta).
    const suyas = (previa.palabras || []).slice(-SIGUIENTE_MAX)
        .map(w => ({ ...w, de: { id: previa.id, vista: previa.vista, ...coloresDeVista(estado.vistas, previa.vista) } }));
    return {
        antes: suyas.concat(medio),
        limite: { toma: previa.id, ms: previa.outMs, ...coloresDeVista(estado.vistas, previa.vista) }
    };
}

/**
 * Lo que se oyó sin ninguna toma en un tramo concreto.
 *
 * El colchón del motor es la clase entera, y cada tarjeta necesita un pedazo:
 * el de entre su IN y la toma de arriba, o el de entre su OUT y la de abajo.
 * Pedirlo por tramo es lo que deja ver el hueco del medio de la clase, que con
 * un piso único —«desde el OUT de la última cerrada»— no se veía nunca.
 */
export function sueltasEntre(estado, desde, hasta) {
    return (estado.sueltas || []).filter(w => w.t >= desde && w.t < hasta);
}
