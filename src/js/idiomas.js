'use strict';
/**
 * idiomas.js — Cómo se llama cada idioma en la pantalla.
 *
 * Es el lado de la ventana de `engine/idiomas.js`, y está duplicado por lo
 * mismo que `tools/maqueta/datos.js`: el motor es CommonJS y esto son módulos
 * que carga el navegador, así que no se pueden importar entre sí. Lo que vive
 * acá es cómo se dicen y qué se pregunta al cambiarlos; qué idiomas hay y cuál
 * se le pide a Whisper lo decide el motor, que es quien transcribe.
 *
 * **Que no se separen lo comprueba una prueba** (`tests/idioma-en-vivo.test.js`):
 * si alguien agrega un idioma de un lado y no del otro, la suite lo caza. Sin
 * eso, la barra ofrecería un idioma que el motor rechaza, o al revés.
 */

/** Lo que se puede elegir a mano. `auto` va aparte: no es un idioma, es una decisión. */
export const IDIOMAS = ['es', 'en', 'pt'];

/** Entre los que decide `auto`. El porqué está en `engine/idiomas.js`. */
export const AUTOMATICOS = ['es', 'en'];

const NOMBRES = { es: 'Español', en: 'Inglés', pt: 'Portugués', auto: 'Automático' };
const SIGLAS = { es: 'ES', en: 'EN', pt: 'PT' };

/** «Español», «Automático». */
export function nombre(codigo) {
    return NOMBRES[codigo] || codigo;
}

/**
 * Y en la barra, donde solo caben dos letras.
 *
 * Con `auto` dice además cuál está oyendo —«Auto · EN»— porque «Automático» a
 * secas no contesta la pregunta que uno se hace al mirar, que es en qué idioma
 * está saliendo el transcript ahora mismo.
 */
export function sigla(idioma, oido) {
    if (idioma !== 'auto') return SIGLAS[idioma] || String(idioma || '').toUpperCase();
    return oido && SIGLAS[oido] ? `Auto · ${SIGLAS[oido]}` : 'Auto';
}

/**
 * Las opciones del menú del rótulo, con la puesta marcada.
 *
 * `auto` primero porque es lo de fábrica y lo que casi siempre conviene; los
 * tres puestos debajo, para quien sabe lo que da la clase.
 */
export function opciones(puesto) {
    return [{
        valor: 'auto',
        dice: 'Automático (español o inglés)',
        pista: 'Lo detecta solo y cambia si el profesor cambia de idioma. '
            + 'Entre esos dos nada más: un portugués detectado sobre una clase en español '
            + 'no agrega un idioma, traduce la clase.'
    }].concat(IDIOMAS.map(l => ({
        valor: l,
        dice: nombre(l),
        pista: `La clase entera en ${nombre(l).toLowerCase()}.`
    }))).map(o => ({ ...o, marcada: o.valor === puesto }));
}

/**
 * Si cambiar el idioma a mitad tiene que rehacer lo de atrás, se pregunta.
 *
 * Cambiar el idioma y releer son dos cosas, y la segunda pisa trabajo hecho: el
 * texto de las tomas cerradas es el que va al Premiere. Quien se da cuenta a
 * mitad de que el idioma está mal quiere arreglarlo sin miedo a romper lo que
 * ya salió bien, así que se decide acá y no por nosotros. Son tres respuestas y
 * no dos —releer, seguir de acá en adelante, o no tocar nada—, por eso es
 * `preguntar` y no `confirmar`.
 *
 * Lo pregunta la ventana y no el motor porque el motor no tiene a quién
 * preguntarle: `grabacion.cambiarIdioma` recibe ya la respuesta.
 *
 * @param {number} cuantas Tomas cerradas que se releerían.
 * @param {string} a Idioma nuevo.
 * @returns {Promise<'releer'|'desde-aca'|null>} `null` si no quieren cambiar nada.
 */
export async function preguntarSiReleer(cuantas, a) {
    const tomas = cuantas === 1 ? '1 toma' : `${cuantas} tomas`;
    const cual = await window.nt.preguntar({
        titulo: `¿Releer lo que ya se grabó en ${nombre(a).toLowerCase()}?`,
        mensaje: `Hay ${tomas} ya cerrada${cuantas === 1 ? '' : 's'}, y su texto es el que `
            + 'va al Premiere. Releerlas lo rehace con el idioma nuevo y tarda un rato; '
            + 'si no, el idioma vale de acá en adelante y lo de atrás se queda como está.',
        opciones: [`Releer ${tomas}`, 'Solo de acá en adelante', 'Cancelar']
    });
    if (cual === 0) return 'releer';
    if (cual === 1) return 'desde-aca';
    return null;
}
