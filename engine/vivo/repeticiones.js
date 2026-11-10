'use strict';
/**
 * vivo/repeticiones.js — Las tomas que empiezan diciendo casi lo mismo que otra: intentos repetidos.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { norm } = require('../texto');
const { palabra, juntas } = require('./palabras');

/** Cuántas palabras del arranque se comparan para ver si una toma repite otra. */
const PALABRAS_DEL_ARRANQUE = 8;

/**
 * Cuánto tienen que compartir dos arranques para decir que uno repite al otro.
 *
 * **No se comparan iguales, se comparan parecidos**, y eso lo decidió el material
 * real. Los tres intentos del mismo arranque en la clase 2 salieron así:
 *
 *   "1. Quiero que hagas un ejercicio mental. Piensa en el…"
 *   "que hagas un ejercicio piensa en el prom que utilizaste…"
 *   "Uno, quiero que hagas un ejercicio. Piensa en el PROM que…"
 *
 * Son el mismo arranque y ninguno empieza igual que otro: el conteo le deja
 * pegado un "1." o un "Uno," al primero, y a veces se come la primera palabra.
 * Comparando prefijos exactos no se reconocía ninguno.
 *
 * Con seis de ocho palabras compartidas los tres se reconocen entre sí, y el
 * arranque de otro tema del mismo profesor ("Peor aún, qué sucede si algún
 * desarrollador…") comparte una sola.
 */
const PARECIDO_MINIMO = 0.6;

/**
 * Qué tomas repiten el arranque de otra anterior.
 *
 * No descarta nada — descartar es del editor y es explícito, porque a veces se
 * retoma para AGREGAR y no para repetir. Esto solo lo deja dicho.
 *
 * Hace falta por lo que se ve en el material real: en la clase 2 del curso el
 * profesor empezó "Quiero que hagas un ejercicio…" SIETE veces seguidas, y el
 * director de contenido se quedó con una. Sin esta marca, decidir eso obliga a
 * leer once transcripciones parecidas para descubrir que diez dicen lo mismo; con
 * ella es mirar una línea.
 *
 * Se comparan las primeras palabras y no todo el texto porque un ensayo se corta
 * a la mitad: lo que dos intentos del mismo arranque tienen en común es
 * justamente el arranque.
 *
 * Devuelve el resultado en vez de escribirlo sobre las tomas: se recalcula cada
 * vez que se mira el estado, porque el texto de una toma cambia cuando se la
 * relee o se le mueve un borde, y un camino de lectura que escribe es lo que
 * vuelve irreproducible el próximo error.
 *
 * @returns {Map<number, number>} id de la toma → id de la que repite
 */
function repeticiones(tomas) {
    const repite = new Map();
    const vistos = [];

    for (const toma of tomas || []) {
        const arranque = new Set((toma.palabras || [])
            .slice(0, PALABRAS_DEL_ARRANQUE)
            .map(w => norm(w.texto))
            .filter(Boolean));

        // Con dos o tres palabras cualquier cosa se parece a cualquier cosa, y
        // decir "repite" donde no se sabe es peor que no decir nada.
        if (arranque.size < 5) continue;

        // Al primero que se le parezca, no al último: si el tercer intento
        // apuntara al segundo, habría que seguir el hilo para llegar al original.
        const previo = vistos.find(v => parecido(arranque, v.arranque) >= PARECIDO_MINIMO);
        if (previo) repite.set(toma.id, previo.id);
        else vistos.push({ id: toma.id, arranque });
    }
    return repite;
}

/** Qué parte de las palabras de un arranque están también en el otro. */
function parecido(a, b) {
    let juntas = 0;
    for (const palabra of a) if (b.has(palabra)) juntas++;
    return juntas / Math.max(a.size, b.size);
}

module.exports = {
    PALABRAS_DEL_ARRANQUE,
    PARECIDO_MINIMO,
    repeticiones,
    parecido
};
