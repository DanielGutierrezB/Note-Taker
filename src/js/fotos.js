'use strict';
/**
 * fotos.js — Las fotos del OUT de cada toma, del lado de la ventana.
 *
 * Junta las dos mitades: la cámara (`grabar/ojo.js`), que tiene el fotograma de
 * cada instante, y el disco (`ipc/referencias.js`), que lo guarda. Lo que este
 * archivo sabe es CUÁNDO hay que guardar uno: cuando una toma aparece cerrada y
 * todavía no tenía foto.
 *
 * **Solo en el momento en que se pone el OUT.** Una toma que ya tiene foto no
 * se vuelve a fotografiar nunca, así que mover el OUT después —o reabrir y
 * cerrar— deja la foto que había: es la de cuando la clase paró, que es lo que
 * el editor va a mirar al retomar. Tampoco se fotografían las tomas de una clase
 * que se abre para mirar: ahí la cámara ni se enciende.
 *
 * **Sin cámara elegida en Ajustes no pasa absolutamente nada.** Ni se pide
 * permiso, ni se abre nada, ni los bloques cambian.
 */

import * as ojo from './grabar/ojo.js';

/** Quién pide la cámara, para que Ajustes no la apague en medio de una clase. */
const QUIEN = 'clase';

let donde = { carpeta: null, secuencia: null };
/** Si esta clase se está grabando: sin eso, la cámara no se enciende nunca. */
let grabando = false;
let tengo = new Map();
let sinFoto = new Set();
let sacando = false;
let alCambiar = () => {};
let avisar = () => {};

/**
 * @param {object} enlaces { alCambiar, avisar } — repintar, y decir lo que falle
 */
export function conectar(enlaces) {
    const e = enlaces || {};
    alCambiar = e.alCambiar || (() => {});
    avisar = e.avisar || (() => {});
}

/**
 * Entrar a una clase: se traen las fotos que ya tenga y, si se está grabando,
 * se enciende la cámara.
 *
 * Que la cámara no se pueda abrir se dice una vez y no vuelve a molestar: la
 * clase se graba igual, solo que sin fotos. Es lo que esto NO puede hacer —
 * estorbar una grabación— y por eso no hay ningún camino en el que una foto
 * pueda cortar nada.
 */
export async function entrar(sesion) {
    const s = sesion || {};
    await salir();
    if (!s.carpeta || !s.secuencia) return;
    donde = { carpeta: s.carpeta, secuencia: s.secuencia };
    grabando = s.grabando !== false;

    const r = await window.nt.fotosListar(s.carpeta, s.secuencia);
    for (const f of (r && r.fotos) || []) tengo.set(f.toma, { ruta: f.ruta, mini: f.mini });
    if (tengo.size) alCambiar();

    if (!s.grabando || !s.camara) return;
    const abierta = await ojo.tomar(QUIEN, s.camara, {
        alCaerse: mensaje => avisar(mensaje, 'error')
    });
    if (!abierta.ok) avisar(`${abierta.error} Las tomas de esta clase no van a tener foto.`, 'error');
}

/**
 * En Ajustes cambiaron la cámara en medio de la clase.
 *
 * Se obedece en el acto. Antes no: la cámara se leía una sola vez, al entrar a
 * En vivo, así que elegir «Ninguna» a mitad de una clase guardaba el ajuste y
 * no apagaba nada —la cámara seguía encendida y las tomas que venían seguían
 * llevando foto hasta el final—. El caso que lo pide es el que pasa: quedó
 * activada por error y uno se da cuenta cuando ya empezó.
 *
 * **Lo ya grabado no se toca.** Las fotos que están en el disco se quedan, y
 * siguen apareciendo en sus bloques: se sacaron cuando la cámara estaba puesta
 * y son lo que el editor va a mirar al retomar. Lo que cambia es de acá en
 * adelante, que es lo que se pidió.
 */
export async function cambiarCamara(camara) {
    if (!donde.carpeta) return;
    if (!grabando || !camara) {
        await ojo.soltar(QUIEN);
        return;
    }
    const abierta = await ojo.tomar(QUIEN, camara, {
        alCaerse: mensaje => avisar(mensaje, 'error')
    });
    if (!abierta.ok) avisar(`${abierta.error} Las tomas que sigan no van a tener foto.`, 'error');
}

/** Salir de la clase: la cámara se suelta y lo que se sabía se olvida. */
export async function salir() {
    donde = { carpeta: null, secuencia: null };
    grabando = false;
    tengo = new Map();
    sinFoto = new Set();
    await ojo.soltar(QUIEN);
}

/**
 * Llega un estado nuevo: se guardan las fotos de las tomas que cerraron.
 *
 * Se hace de a una y sin apurar nada: el estado llega varias veces por minuto y
 * lo normal es que no haya ninguna toma nueva que fotografiar.
 */
export async function alEstado(estado) {
    if (sacando || !estado || !donde.carpeta || !ojo.abierto()) return;
    if (estado.secuencia !== donde.secuencia) return;

    sacando = true;
    try {
        for (const t of estado.tomas || []) {
            if (t.outMs == null || tengo.has(t.id) || sinFoto.has(t.id)) continue;
            const bytes = ojo.fotoDe(t.outMs);
            if (!bytes) {
                // No había fotograma de ese momento: la cámara se abrió después,
                // o el OUT quedó fuera de la ventana del anillo. Se anota para no
                // volver a mirarlo en cada estado.
                sinFoto.add(t.id);
                continue;
            }
            const r = await window.nt.fotoGuardar({
                carpeta: donde.carpeta, secuencia: donde.secuencia, toma: t.id, jpeg: bytes
            });
            if (!r || !r.ok) {
                sinFoto.add(t.id);
                if (r && r.error) avisar(`No pude guardar la foto de la toma ${t.id}: ${r.error}`, 'error');
                continue;
            }
            tengo.set(t.id, { ruta: r.ruta, mini: r.mini });
            alCambiar();
        }
    } finally {
        sacando = false;
    }
}

/** La foto de una toma, o null. */
export function de(toma) {
    return tengo.get(toma) || null;
}

/** Si hay alguna: es lo que decide si el bloque lleva o no su recuadro. */
export function hay() {
    return tengo.size > 0;
}

/** La de la última toma cerrada, que es la que sirve al retomar la clase. */
export function ultima(estado) {
    const tomas = (estado && estado.tomas) || [];
    for (let i = tomas.length - 1; i >= 0; i--) {
        const foto = tengo.get(tomas[i].id);
        if (tomas[i].outMs != null && foto) return { toma: tomas[i].id, ...foto };
    }
    return null;
}
