'use strict';
/**
 * Una claqueta como la trae el archivo de notas de una clase grabada cuando la
 * app todavía las anotaba. La app ya no las crea: solo las lee y las lleva al
 * XML, así que las pruebas las ponen a mano en el estado.
 */
module.exports = function claquetaVieja(estado, c) {
    const claqueta = {
        n: estado.claquetas.length + 1,
        ms: c.ms,
        paredMs: c.paredMs != null ? c.paredMs : null,
        frase: c.frase || '',
        comentario: c.comentario || '',
        confirmada: Boolean(c.confirmada),
        origen: c.origen || 'editor'
    };
    estado.claquetas.push(claqueta);
    return claqueta;
};
