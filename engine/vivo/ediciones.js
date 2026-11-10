'use strict';
/**
 * vivo/ediciones.js — Los cambios del editor que se resuelven con lo que ya está escrito.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { norm } = require('../texto');
const { juntas, mismaPalabra, MISMA_DEL_CICLO_MS } = require('./palabras');
const { VISTAS } = require('./vistas');
const { tomaAbierta, laQuePisa, repartir, moverBorde } = require('./tomas');
const { yaEscritaEnDescartada } = require('./ciclo');

/* ─── Los cambios que se resuelven con lo que ya está escrito ────────────
 *
 * Acá y no en `grabacion.js` porque estos cambios se hacen sobre la clase que se
 * está grabando y también sobre una que ya terminó, y las dos tienen que
 * escribir exactamente lo mismo: si divergieran, el mismo gesto daría un XML
 * distinto según cuándo se hizo.
 */

/** @param {object} c { desdeMs, hastaMs, texto, comentario } */
function comentar(toma, c) {
    // Un comentario señala un tramo; sin horas no señala nada, y un NaN
    // guardado llega al XML como un marcador sin sitio.
    if (!Number.isFinite(Number(c.desdeMs)) || !Number.isFinite(Number(c.hastaMs))) return;
    toma.comentarios = (toma.comentarios || []).concat([{
        desdeMs: Number(c.desdeMs),
        hastaMs: Number(c.hastaMs),
        texto: String(c.texto || ''),
        comentario: String(c.comentario || '')
    }]);
}

function descomentar(toma, indice) {
    toma.comentarios = (toma.comentarios || []).filter((_x, i) => i !== indice);
}

/**
 * Cambiarle el texto a un comentario que ya está, sin mover el pedazo.
 *
 * Solo el comentario: el tramo que señala —`desdeMs`, `hastaMs` y las palabras
 * citadas— es lo que se eligió con el mouse, y para cambiarlo hay que volver a
 * seleccionar. Acá se corrige lo que se escribió, que es lo que se escribe
 * apurado en medio de una clase.
 *
 * Por índice, como `descomentar`: no hay dos formas de nombrar un comentario.
 * Un índice que no existe no hace nada, y no revienta, porque la lista pudo
 * cambiar entre que se pintó la fila y que se guardó.
 *
 * **Lista nueva y comentario nuevo, sin tocar nada en su sitio**, igual que
 * `comentar` concatena y `descomentar` filtra. Es lo que deja que `foto` en
 * `deshacer.js` copie la lista por encima y comparta los objetos de adentro:
 * si acá se le escribiera el texto al comentario que ya está, la foto que
 * espera en el historial cambiaría sola y deshacer no devolvería nada.
 *
 * @param {object} c { indice, comentario }
 */
function recomentar(toma, c) {
    const lista = toma.comentarios || [];
    const i = Number(c.indice);
    if (!lista[i]) return;
    toma.comentarios = lista.map((x, k) =>
        (k === i ? { ...x, comentario: String(c.comentario || '') } : x));
}

/**
 * Las palabras sueltas que ahora caen dentro de la toma pasan a ser suyas.
 *
 * Se usa al correr un borde de una toma CERRADA en la sesión viva. El caso que
 * lo pide es adelantar el OUT de la última: lo que se dijo después de cerrarla
 * está en `estado.sueltas` —no es de nadie— y abarcarlo con el borde es
 * decir que sí era de la toma. Sin esto, la toma se quedaba sin ese texto
 * hasta que la relectura lo trajera de Whisper.
 *
 * Solo lo que cae adentro, y sale de las sueltas: una palabra en los dos
 * sitios se dibujaría dos veces, una gris y otra no.
 */
function tragarSueltas(estado, toma) {
    const sueltas = estado.sueltas || [];
    if (!sueltas.length || toma.inMs == null || toma.outMs == null) return;
    const adentro = w => w.t >= toma.inMs && w.t < toma.outMs;
    if (!sueltas.some(adentro)) return;
    toma.palabras = juntas(toma.palabras, sueltas.filter(adentro))
        .sort((a, b) => a.t - b.t);
    estado.sueltas = sueltas.filter(w => !adentro(w));
}

/**
 * Lo mismo para la toma ABIERTA, que llega hasta ahora: todo lo suelto desde
 * su IN es suyo. Es lo que hace falta al reabrir una toma cerrada, porque lo
 * dicho desde que cerró estaba en el colchón y de golpe cae dentro de ella.
 */
function tragarSueltasDesde(estado, toma) {
    const sueltas = estado.sueltas || [];
    if (!sueltas.length || toma.inMs == null || toma.outMs != null) return;
    const adentro = w => w.t >= toma.inMs;
    if (!sueltas.some(adentro)) return;
    toma.palabras = juntas(toma.palabras, sueltas.filter(adentro))
        .sort((a, b) => a.t - b.t);
    estado.sueltas = sueltas.filter(w => !adentro(w));
}

/**
 * Las sueltas, cuadradas contra las tomas que hay ahora.
 *
 * Una palabra está en las sueltas exactamente cuando se dijo sin toma: lo que
 * cae adentro de una sobra ahí, y lo que se salió de una tiene que volver.
 * `moverInAbierta` y `tragarSueltas` mantienen eso solas porque mueven la
 * palabra de un sitio al otro en el mismo gesto, pero **deshacer repone la toma
 * y no las sueltas** —la foto del historial es de UNA toma, nunca de la sesión
 * (ver `engine/deshacer.js`)—, así que después de volver atrás un borde hay que
 * cuadrarlas acá.
 *
 * Sin esto el daño no se ve enseguida: deshacer dejaba la palabra en los dos
 * sitios y lo cobraba el siguiente gesto que leyera las sueltas —`tragarSueltas`
 * al mover el OUT, o la toma siguiente al abrirse—, y entonces el texto salía
 * doble ("uno uno dos dos tres") en la pantalla y en el XML.
 *
 * Lo de las orillas (`antes`, `despues`) sí convive: es el gris de contexto, y
 * la pantalla lo junta con las sueltas sin repetir. Acá solo cuenta lo que cae
 * entre el IN y el OUT, que es donde la palabra pasa a ser de la toma.
 *
 * @param {object[]} [soltadas] palabras que una toma tenía y ya no
 */
function limpiarSueltas(estado, soltadas) {
    // Lo que se suelta entra con la regla del ciclo —en orden y sin la misma
    // palabra dos veces a la misma hora— y no por igualdad exacta: lo que
    // suelta un Cmd-Z puede ser la lectura del modelo grande de un tramo que el
    // ciclo ya tenía con otra ortografía, y las dos juntas en el gris eran
    // «funcion funcionando».
    //
    // Contra lo que YA estaba suelto, no entre ellas: dos soltadas iguales
    // seguidas —«no, no»— son dos palabras dichas, y vienen de una toma que ya
    // las tenía deduplicadas.
    const habia = (estado.sueltas || []).slice();
    const nuevas = (soltadas || []).filter(w => {
        const n = norm(w.texto);
        return !habia.some(h => Math.abs(h.t - w.t) < MISMA_DEL_CICLO_MS && mismaPalabra(norm(h.texto), n));
    });
    const todas = juntas(habia, nuevas);
    // Lo que cae dentro de una CERRADA sobra en el colchón y punto: la toma lo
    // tiene o lo va a tener con su relectura. Lo que cae dentro de la ABIERTA
    // se le mete, porque a la abierta nadie la relee hasta que cierre, y tirarlo
    // era perder lo que se dijo —lo encontró el martillo deshaciendo una
    // división de la toma abierta—.
    const abierta = tomaAbierta(estado);
    if (abierta && !abierta.descartada && abierta.inMs != null) {
        const suyas = todas.filter(w => w.t >= abierta.inMs);
        if (suyas.length) abierta.palabras = juntas(abierta.palabras, suyas);
    }
    // Y lo que una toma tiene escrito no está suelto, cuente la toma o no: una
    // desactivada se queda con sus palabras y las muestra en su fila, así que
    // tenerlas además en el colchón era verlas dos veces. Es la otra mitad de
    // la regla: suelta es lo que no está dentro de ninguna viva NI escrito en
    // ninguna.
    const escritas = new Set();
    for (const t of estado.tomas || []) for (const w of t.palabras || []) escritas.add(`${w.t}|${w.texto}`);
    estado.sueltas = todas.filter(w => !esDeAlgunaToma(estado, w)
        && !escritas.has(`${w.t}|${w.texto}`)
        // Con la regla del ciclo para las desactivadas: su texto puede venir
        // de la relectura, con otra ortografía que la palabra suelta.
        && !yaEscritaEnDescartada(estado, w));
}

/**
 * Si una palabra cae dentro de los bordes de alguna toma.
 *
 * **Es la regla de qué NO puede estar suelto**, y está acá sola porque la usan
 * los dos lados: `limpiarSueltas` la mantiene al editar y el puente la usa para
 * decidir qué colchón cruza a la ventana (`sueltasQueSirven` en `espejo.js`).
 * Escrita dos veces, una de las dos se habría quedado atrás.
 *
 * Las descartadas no cuentan: su tramo vuelve a quedar libre, igual que en
 * `tomaAnterior` y en `pisoDeLasSueltas`.
 */
function esDeAlgunaToma(estado, w) {
    return (estado.tomas || []).some(t => t.inMs != null && !t.descartada
        && w.t >= t.inMs && (t.outMs == null || w.t < t.outMs));
}

/**
 * Un borde corrido sin volver a oír: se reparten otra vez las palabras que hay.
 *
 * **Mover un borde no necesita el audio, y esa es la razón de que las orillas
 * existan.** Al cerrar una toma se lee un tramo MÁS ANCHO que ella y lo que
 * sobra de cada lado se guarda al lado del XML (`repartir` acá, `sidecar` en
 * `notas-xml.js`). O sea que el texto de un rango más ancho que la toma ya está
 * en el disco: correr el borde dentro de ese rango es unir las tres listas,
 * mover la frontera y volver a repartir. Sale al instante y da exactamente lo
 * mismo que daría releer, porque son las mismas palabras.
 *
 * Fuera de ese rango no hay texto que respalde el borde. Escribirlo igual sería
 * peor que no dejarlo: el transcript y el cue de salida seguirían diciendo lo de
 * antes mientras el marcador dice otra cosa, y ese cue es lo que `align.js` busca
 * en el Live-Mix para reanclar el bloque. Así que se planta, y el camino para ir
 * más lejos es "Regenerar": relee cada toma con orillas nuevas alrededor de los
 * bordes de ahora, y el borde vuelve a tener doce segundos por delante.
 *
 * Un borde que cruza al otro no es un error de quien llama sino un arrastre que
 * se pasó, así que no explota: no se mueve y la línea vuelve a su sitio sola al
 * repintar, igual que en la clase en curso.
 */
function moverBordeGuardado(toma, cual, paredMs, tomas) {
    const guardadas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
    const ultima = guardadas[guardadas.length - 1];
    if (!guardadas.length || !Number.isFinite(paredMs) ||
        paredMs < guardadas[0].t || paredMs > ultima.t) {
        throw new Error('Ese borde cae fuera del texto que quedó guardado. ' +
            'Corrilo hasta donde llega el gris y usá "Regenerar": relee la toma ' +
            'del audio y deja otros segundos de contexto para seguir.');
    }
    if (!moverBorde(toma, cual, paredMs, tomas)) return;
    Object.assign(toma, repartir(guardadas, toma));
}

/**
 * Aplica un cambio que se resuelve con lo que ya está escrito, sin volver a oír.
 *
 * **Esta función es la línea que separa lo que se puede hacer sobre una clase ya
 * terminada de lo que no**, y por eso es una sola: si hubiera dos listas de tipos
 * en dos archivos, el mismo gesto daría un XML distinto según cuándo se hizo.
 *
 * Antes contestaba un booleano y quien llamaba inventaba el mensaje, porque el
 * motivo era siempre el mismo: "eso necesita el audio". Dejó de serlo. Mover un
 * borde entró —las orillas están guardadas, así que es repartir de nuevo lo
 * mismo—, y lo que queda afuera queda afuera por motivos distintos entre sí:
 * `reabrir` no tiene sentido sin el ciclo de señales, un borde puede caer donde
 * no hay texto, y un tipo que no existe es un error de programa. Así que lo que
 * contesta es una excepción con el motivo, que vive donde vive la regla.
 *
 * @param {Array} [tomas] las de la sesión: solo `borde` las usa, para que el IN
 *   no cruce el OUT de la toma anterior (`pisoDelIn`)
 * @throws si el cambio no se puede hacer sin volver a oír el audio
 */
function aplicar(toma, cambio, tomas) {
    const c = cambio || {};
    switch (c.tipo) {
        case 'vista':
            // Una vista que no existe llegaba hasta el nombre del marcador.
            if (!VISTAS.some(v => v.nombre === c.vista)) return;
            toma.vista = c.vista;
            return;
        case 'nota':
            toma.comentario = String(c.texto || '');
            return;
        case 'descartar': {
            // Una toma que vuelve a contar tiene que caber: mientras no
            // contaba, otra pudo quedar sobre su tramo, y activarla dejaría dos
            // bloques encimados en el XML. Acá y no solo en la clase en vivo,
            // que era la única puerta que lo miraba: una clase grabada entra
            // directo por acá.
            const pisada = !c.descartada && toma.descartada && laQuePisa(tomas || [], toma);
            if (pisada) {
                throw new Error(`No puedo volver a activar la toma ${toma.id}: la toma ${pisada.id} quedó `
                    + `sobre su tramo. Desactivá o corré la ${pisada.id} primero.`);
            }
            toma.descartada = Boolean(c.descartada);
            return;
        }
        case 'comentar':
            comentar(toma, c);
            return;
        case 'editar-comentario':
            recomentar(toma, c);
            return;
        case 'borrar-comentario':
            descomentar(toma, c.indice);
            return;
        case 'borde':
            // Solo los dos que hay: cualquier otra cosa movía el OUT.
            if (c.borde !== 'in' && c.borde !== 'out') return;
            moverBordeGuardado(toma, c.borde, Number(c.paredMs), tomas);
            return;
        case 'reabrir':
            // Reabrir es dejar la toma sin OUT para que el ciclo de señales le
            // siga metiendo palabras. Con la clase cerrada no hay ciclo, y una
            // toma sin OUT no se escribe (`tomasQueQuedan`): el gesto la haría
            // desaparecer del XML, que es lo último que espera quien lo pide.
            // Lo que quiere decir es "que la toma siga un poco más", y eso ahora
            // es correr el OUT.
            throw new Error('Reabrir es de la clase que se está grabando. Con la ' +
                'clase cerrada, una toma sin OUT no llega al XML: para que termine ' +
                'más adelante, arrastrá la línea roja.');
        default:
            throw new Error(`Cambio sin definir: ${c.tipo}`);
    }
}

module.exports = {
    comentar,
    descomentar,
    recomentar,
    tragarSueltas,
    tragarSueltasDesde,
    limpiarSueltas,
    esDeAlgunaToma,
    moverBordeGuardado,
    aplicar
};
