/**
 * al-grabar.js — Qué hace «Grabar» en el vídeo de la semana, antes de grabar.
 *
 * Sin pantalla el vídeo sale solo con la cámara, llenando el cuadro. Es un vídeo
 * que vale —por eso se pregunta y no se niega—, pero casi siempre quiere decir
 * que se olvidó de elegirla, y eso se descubre recién al mirar lo grabado.
 *
 * Elegir pantalla desde la pregunta no arranca a grabar: el preview cambia, y
 * es para mirarlo antes de apretar Grabar otra vez.
 *
 * Es una decisión sin DOM a propósito: la pregunta llega de afuera, así que se
 * prueba con lo que contesta y no leyendo cómo está escrita.
 */

export const SIN_PANTALLA = {
    titulo: 'Todavía no elegiste pantalla',
    mensaje: 'Si grabás así, el vídeo sale solo con tu cámara, llenando el cuadro.',
    opciones: [
        { valor: 'elegir', dice: 'Elegir pantalla' },
        { valor: 'camara', dice: 'Grabar solo con la cámara' }
    ]
};

/**
 * @param {boolean} hayPantalla si ya se eligió qué pantalla se graba
 * @param {(pregunta: object) => Promise<string|null>} preguntar el diálogo
 * @returns {Promise<'grabar'|'elegir'|null>} null es que se canceló
 */
export async function queHacer(hayPantalla, preguntar) {
    if (hayPantalla) return 'grabar';
    const dicho = await preguntar(SIN_PANTALLA);
    if (dicho === 'elegir') return 'elegir';
    if (dicho === 'camara') return 'grabar';
    return null;
}
