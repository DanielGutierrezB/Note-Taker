'use strict';
/**
 * cambios-toma.js — Lo que el editor le hace a una toma a mano, y cómo se vuelve.
 *
 * Del otro lado de la pared está el ciclo de señales, que abre y cierra tomas
 * oyendo al profesor. Acá está lo otro: los gestos de una persona que está
 * mirando la pantalla. Van juntos con el historial y no en dos archivos porque
 * son la misma decisión tomada dos veces — el que puede volver atrás un cambio
 * es el que lo escribió, y todo lo de acá escribe el XML en el mismo gesto.
 *
 * Nada de acá toca el audio ni levanta un Whisper. Lo más que hace es pedirle a
 * la cola que relea una toma (`relecturas.encolar`), que es lo que pasa cuando
 * un borde se mueve y el texto de ese tramo ya no es el que estaba.
 */

const espejo = require('./espejo');
const relecturas = require('./relecturas');
const historial = require('./deshacer');
const vivo = require('./notas-vivo');

/**
 * Lo que el editor cambia a mano desde la pantalla.
 *
 * Un comando por gesto, con su `tipo`, y cada tipo con lo suyo:
 *
 *   vista             { vista }                       qué cámara usa la toma
 *   nota              { texto }                       la nota del director
 *   descartar         { descartada }                  desactivar: fuera del XML, o de vuelta
 *   borde             { borde:'in'|'out', paredMs }   mover un borde a una palabra
 *   reabrir           —                               "Pausa" cerró de más
 *   comentar          { desdeMs, hastaMs, texto, comentario }  sobre un pedazo del texto
 *   borrar-comentario { indice }
 *   eliminar          —                               descartar: sacarla de la sesión
 *
 * Y uno que no es de ninguna toma, porque la fila de al lado tampoco lo es:
 *
 *   nota-claqueta     { n, texto }                    la nota de la claqueta n
 *
 * Todo pasa por acá y todo escribe el XML: la pantalla no guarda nada por su
 * cuenta, así que lo que se ve y lo que está en el archivo son lo mismo siempre.
 *
 * Y todo queda anotado en el historial de la sesión, así que todo se puede
 * deshacer (`volver` más abajo). Es por la misma razón que el cambio pasa por
 * acá: el que puede volver atrás es el que escribió el archivo.
 */
function editar(sesion, cambio) {
    if (!sesion) return null;
    const c = cambio || {};
    if (c.tipo === 'nota-claqueta') return notaDeClaqueta(sesion, c);
    const toma = sesion.estado.tomas.find(t => t.id === c.toma);
    if (!toma) return espejo.resumen(sesion);

    const antes = historial.foto(toma);

    switch (c.tipo) {
        case 'borde': {
            // El texto de la toma ya no es el de este tramo: se relee. Mover un
            // borde es lo que se hace justamente cuando el conteo se comió una
            // palabra o cuando hay que cortar antes de algo, y en los dos casos
            // lo que hay que ver después es el texto nuevo.
            //
            // Un borde que cae donde ya estaba no se relee, y hay dos gestos que
            // llegan así: un arrastre que volvió al hueco de donde salió y un
            // clic derecho sobre la palabra que ya es la primera de la toma.
            // Serían dos segundos de GPU para dejar la toma igual. Del historial
            // se ocupa el portero de más abajo, que ve que la toma no se movió.
            const estaba = c.borde === 'in' ? toma.inMs : toma.outMs;
            if (c.paredMs == null || Number(c.paredMs) === estaba) break;
            // La toma abierta no se relee hasta cerrarse, así que su IN se
            // mueve pasando palabras entre ella y las sueltas (`moverInAbierta`)
            // en vez de pedirle el texto a Whisper.
            if (toma.outMs == null && c.borde === 'in') {
                vivo.moverInAbierta(sesion.estado, toma, Number(c.paredMs));
            } else if (vivo.moverBorde(toma, c.borde, Number(c.paredMs))) {
                // Las palabras se reparten YA con lo que hay, y la relectura
                // afina después. Sin esto el borde volvía a su palabra de antes
                // hasta que terminaba la relectura —cargar 1,6 GB de modelo y
                // pasar la toma entera, peleando la GPU con el texto en vivo—, y
                // arrastrar el IN parecía no hacer nada durante varios segundos.
                const guardadas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
                Object.assign(toma, vivo.repartir(guardadas, toma));
                relecturas.encolar(sesion, toma.id);
            }
            break;
        }
        case 'reabrir':
            reabrir(sesion, toma);
            break;
        case 'eliminar':
            eliminar(sesion, toma);
            break;
        // Los otros cinco se resuelven con lo que ya está escrito, así que son
        // los mismos que se hacen sobre una clase ya terminada (`editarGrabada`
        // en `clases-grabadas.js`), y de ahí que los aplique la misma función.
        // `borde` también entra ahí, pero acá va aparte: con la sesión viva se
        // relee el tramo, así que el borde no está atado a las orillas guardadas.
        default:
            vivo.aplicar(toma, c);
    }

    // Al historial entra lo que cambió la toma, y nada más. Quien decide eso es
    // `historial.anotar`, comparando las dos fotos: está de aquel lado para que
    // no haya un gesto que se olvide de preguntar (ver `anotar`).
    //
    // Lo único que se decide acá es qué es la foto de después, y es null cuando
    // la toma ya no está en la sesión. Se mira en la LISTA y no en el tipo del
    // cambio: un `eliminar` que se plantó —la toma estaba abierta— deja la
    // toma donde estaba, así que su foto es la de antes y no hay paso que anotar.
    historial.anotar(sesion.historia, {
        que: comoSeLlama(c),
        tipo: c.tipo,
        id: toma.id,
        antes,
        despues: sesion.estado.tomas.includes(toma) ? historial.foto(toma) : null
    });

    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

/**
 * La nota de una claqueta: lo mismo que la nota de una toma, en la otra fila.
 *
 * Sale por su propia puerta porque una claqueta no está en `estado.tomas` y su
 * paso de historial es de lista, no de toma (`campo: 'claquetas'`). De ahí en
 * adelante es idéntico: el portero de `historial.anotar` decide si hubo cambio,
 * la foto es de la claqueta sola, y `volver` repone `comentario` y nada más
 * porque el paso dice qué campos tocó (ver `ponerEnLista`).
 *
 * Una claqueta que ya no está —la quitaron mientras el campo estaba abierto—
 * deja el gesto sin efecto y sin paso, igual que una toma que no se encuentra.
 */
function notaDeClaqueta(sesion, c) {
    const claqueta = (sesion.estado.claquetas || []).find(x => x.n === Number(c.n));
    if (!claqueta) return espejo.resumen(sesion);
    const antes = { ...claqueta };
    vivo.aplicarAClaqueta(claqueta, c);
    anotarDeLaSesion(sesion, 'claquetas', antes, c, { ...claqueta });
    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

/**
 * Cómo se llama lo que se acaba de hacer, para poder decirlo al deshacerlo.
 *
 * Se dice QUÉ se deshizo y no solo que algo pasó, igual que en la revisión de
 * cortes: con quince tomas en pantalla y el scroll donde lo dejó quien estaba
 * leyendo, un cambio que se revierte lejos de la vista es invisible.
 */
function comoSeLlama(c) {
    const cual = `la toma ${c.toma}`;
    switch (c.tipo) {
        case 'vista': return `poner ${cual} en ${c.vista}`;
        case 'nota': return `la nota de ${cual}`;
        case 'descartar': return `${c.descartada ? 'desactivar' : 'activar'} ${cual}`;
        case 'comentar': return `comentar «${vivo.limpio(String(c.texto || '')).slice(0, 30)}»`;
        case 'borrar-comentario': return `quitar un comentario de ${cual}`;
        case 'borde': return `mover el ${c.borde === 'in' ? 'IN' : 'OUT'} de ${cual}`;
        case 'reabrir': return `reabrir ${cual}`;
        case 'eliminar': return `descartar ${cual}`;
        case 'abrir': return `abrir ${cual}`;
        case 'cerrar': return `cerrar ${cual}`;
        // Las que no son de ninguna toma, así que no la nombran. Están acá y
        // no donde se hacen por lo mismo que los otros: si cada gesto redactara
        // su rótulo, el botón de deshacer diría las cosas de nueve maneras.
        //
        // La claqueta lleva su número porque en una clase en vivo hay varias:
        // «deshacer la claqueta» con siete anotadas no dice cuál se va.
        case 'claquetas': return c.n ? `poner la claqueta ${c.n}` : 'quitar una claqueta';
        case 'nota-claqueta': return `la nota de la claqueta ${c.n}`;
        default: return `el cambio en ${cual}`;
    }
}

/**
 * El paso de un campo de la sesión: hoy, la lista de claquetas.
 *
 * Está acá, con los de las tomas, porque son el mismo historial y la misma pila
 * —el orden de deshacer tiene que ser el orden de los gestos— y porque el rótulo
 * sale del mismo sitio. Lo que los distingue es qué se repone: un campo del
 * estado en vez de una toma, y por eso el paso lleva `campo` en lugar de `id`
 * (ver `engine/deshacer.js`).
 *
 * La foto es de LA CLAQUETA que se tocó y no de la lista, por lo mismo que la
 * de una toma no es de la sesión: la lista se llena sola mientras la foto
 * espera —el aplauso y la voz anotan claquetas— y reponerla entera se llevaba
 * puestas las que habían entrado después. Los números no se corren porque
 * `volver` renumera al terminar, que es lo que hace el gesto original.
 *
 * Quien los llama es `grabacion.js`, que es el único que sabe cuál es la sesión.
 * La foto de antes la toma él, antes de tocar nada; la de después se saca acá,
 * que es lo que garantiza que las dos se saquen igual.
 *
 * @param {'claquetas'} campo qué campo de `sesion.estado` se tocó
 * @param {object|null} antes de `historial.fotoDeCampo`, sacada antes del cambio
 */
function anotarDeLaSesion(sesion, campo, antes, cambio, despues) {
    if (!sesion) return;
    historial.anotar(sesion.historia, {
        que: comoSeLlama(cambio || {}),
        tipo: (cambio || {}).tipo,
        campo,
        antes,
        despues: despues !== undefined ? despues : historial.fotoDeCampo(sesion.estado[campo])
    });
}

/**
 * Descartar una toma: sacarla de la sesión.
 *
 * Es el tercero de los tres estados que se le ofrecen a cada toma en la
 * pantalla, y en el motor se sigue llamando `eliminar` porque así se llama en
 * Class Cut, de donde viene:
 *
 *   Mantener     va al XML (lo de siempre)
 *   Desactivar   fuera del XML pero en la sesión: se vuelve a activar
 *                (`descartada: true`, el nombre que tiene en el sidecar)
 *   Descartar    fuera de la sesión: su texto deja de contar para nada
 *
 * **No pregunta y se deshace con Cmd-Z**, como todo lo demás de esta pantalla.
 * En Class Cut solo se podía sobre una toma ya descartada, para que fueran dos
 * decisiones; acá los tres estados están a la vista y juntos, y lo que evita el
 * accidente es el historial. Un cartel de confirmación en medio de una clase
 * que se está grabando es un renglón que hay que leer con el profesor hablando.
 *
 * La abierta no se descarta: primero se cierra. Descartarla dejaría al ciclo de
 * señales metiendo palabras en una toma que ya no existe.
 */
function eliminar(sesion, toma) {
    // Y no contesta si pudo: quien anota mira si la toma quedó en la sesión, que
    // es la misma pregunta hecha una sola vez para todos los gestos (ver `editar`).
    if (toma.outMs == null) return;
    const tomas = sesion.estado.tomas;
    tomas.splice(tomas.indexOf(toma), 1);
}

/**
 * Solo la última, y solo si no hay otra abierta.
 *
 * Dos tomas abiertas a la vez rompen todo lo demás: el ciclo de señales le mete
 * las palabras a "la abierta" y no hay tal cosa, y el conteo siguiente cerraría
 * una de las dos dejando la otra abierta para siempre.
 *
 * **Plantarse es un caso que llega solo**, y de ahí que importe que no deje paso
 * en el historial: el botón se ofrece mirando el estado que está en pantalla, y
 * entre ese repintado y el clic el ciclo de señales pudo abrir la toma siguiente
 * —tres segundos—. El clic sale con el botón que la pantalla mostraba y acá ya no
 * se puede hacer nada. Como no toca la toma, la foto de después es igual a la de
 * antes y `editar` no anota nada.
 */
function reabrir(sesion, toma) {
    const tomas = sesion.estado.tomas;
    if (vivo.tomaAbierta(sesion.estado) || toma !== tomas[tomas.length - 1]) return;
    toma.outMs = null;
    toma.cerradaSola = false;
    // Lo que se dijo después del OUT deja de ser orilla: la toma sigue abierta y
    // esas palabras van a entrar en ella cuando se la relea al cerrar. Dejarlas
    // las mostraría dos veces, una en gris y otra dentro de la toma.
    toma.despues = [];
}

/* ─── Deshacer y rehacer ──────────────────────────────────────────────────
 *
 * El historial es del motor porque la verdad es del motor: cada cambio reescribe
 * el XML y el sidecar en el mismo gesto, así que volver atrás también tiene que
 * reescribirlos. El por qué está entero en `engine/deshacer.js`, junto con el
 * motivo de que la foto sea de una toma —o de un campo— y nunca de la sesión.
 */

/**
 * @param {'atras'|'adelante'} hacia
 * @returns {{ok:boolean, que?:string, error?:string, estado:object|null}}
 */
function volver(sesion, hacia) {
    if (!sesion) return { ok: false, estado: null };
    const paso = historial.proximo(sesion.historia, hacia);
    if (!paso) return { ok: false, estado: espejo.resumen(sesion) };

    const foto = hacia === 'adelante' ? paso.despues : paso.antes;
    // La única cosa que no se puede deshacer, y es de las tomas: un paso de la
    // sesión no repone ninguna, así que no puede dejar dos abiertas. Preguntarle
    // igual lo plantaría siempre, porque su `id` es undefined y entonces
    // cualquier toma abierta contaría como "la otra".
    if (!paso.campo && historial.dejariaDosAbiertas(sesion.estado.tomas, paso.id, foto, paso.campos)) {
        return {
            ok: false,
            error: `No puedo ${hacia === 'adelante' ? 'rehacer' : 'deshacer'} «${paso.que}»: ` +
                'mientras tanto se abrió otra toma, y dos tomas abiertas a la vez rompen ' +
                'el ciclo de señales. Cerrá la de ahora y volvé a intentar.',
            estado: espejo.resumen(sesion)
        };
    }

    const dado = historial.sacar(sesion.historia, hacia);
    if (paso.campo === 'claquetas') {
        historial.ponerEnLista(sesion.estado.claquetas || (sesion.estado.claquetas = []),
            dado.quitar, dado.foto, { campos: dado.campos, esLaMisma: vivo.mismaClaqueta });
        // Una claqueta que vuelve deja de estar entre las quitadas a mano, y una
        // que se va a mano entra: las mismas reglas que el gesto original.
        vivo.olvidarQuitada(sesion.estado, dado.foto);
        if (dado.quitar && !dado.foto) vivo.recordarQuitada(sesion.estado, dado.quitar);
        vivo.renumerar(sesion.estado);
    } else if (paso.campo) {
        historial.ponerCampo(sesion.estado, paso.campo, foto);
    } else {
        historial.poner(sesion.estado.tomas, paso.id, foto, dado.campos);
    }
    // Un borde repuesto pide el mismo texto que pidió el gesto original: acá el
    // reparto de palabras lo hace la relectura, no el borde (ver `editar`).
    if (paso.tipo === 'borde' || paso.tipo === 'cerrar') relecturas.encolar(sesion, paso.id);

    espejo.escribir(sesion);
    return { ok: true, que: paso.que, estado: espejo.resumen(sesion) };
}

/**
 * Abre una toma a mano. Es el botón y la tecla, no la señal.
 *
 * El conteo no siempre se dice: el profesor arranca directo, se lo come, o dice
 * "bueno, vamos". Sin esto, lo que sigue no queda en ninguna toma y se pierde
 * para el XML — la pérdida más cara de esta app, porque no se descubre hasta la
 * mesa de edición.
 *
 * El IN lo decide `vivo.abrirToma`, que retrocede hasta donde empezó la frase
 * que el profesor está diciendo: quien toma notas se da cuenta unos segundos
 * tarde, siempre, y abrir en el momento del clic dejaría el arranque afuera.
 *
 * Va al historial como todo lo demás, y ahí la foto de antes es `null` porque
 * la toma no existía: deshacer la saca de la sesión, igual que eliminarla.
 */
function abrirToma(sesion, opciones) {
    if (!sesion) return null;
    const o = opciones || {};
    const ahora = espejo.grabadoHastaMs(sesion);
    // Con `ms` es el IN arrastrado hasta una palabra del texto suelto: ahí se
    // abre exacto, sin retroceder, porque quien lo puso ya eligió dónde.
    const abierto = Number.isFinite(o.ms)
        ? vivo.abrirToma(sesion.estado, Math.min(o.ms, ahora), { exacto: true, ahoraMs: ahora })
        : vivo.abrirToma(sesion.estado, ahora);
    // Ya había una abierta. Llega solo: entre que la pantalla dibujó el botón y
    // el clic, el ciclo de señales pudo haber oído un conteo —tres segundos—.
    if (!abierto) return espejo.resumen(sesion);

    historial.anotar(sesion.historia, {
        que: comoSeLlama({ tipo: 'abrir', toma: abierto.toma.id }),
        tipo: 'abrir',
        id: abierto.toma.id,
        antes: null,
        despues: historial.foto(abierto.toma)
    });
    espejo.escribir(sesion);
    return { ...espejo.resumen(sesion), retrocedioSec: abierto.retrocedioSec };
}

/**
 * Cierra a mano la toma que esté abierta. Es el botón, no la señal.
 *
 * Se aprieta apurado y en medio de una interrupción —alguien quiere decirle algo
 * al profesor y hay que parar la toma para invitarlo a retomar—, así que va al
 * historial como todo lo demás: apretarlo de más es el error más probable de esta
 * pantalla, y tiene que costar una tecla arreglarlo.
 */
function cerrarToma(sesion, opciones) {
    if (!sesion) return null;
    const o = opciones || {};
    const toma = vivo.tomaAbierta(sesion.estado);
    if (!toma) return espejo.resumen(sesion);
    const antes = historial.foto(toma);
    // Con `ms` es el OUT arrastrado hacia atrás sobre el texto de la toma: se
    // cierra en esa palabra. Sin él, en la última palabra dicha, que es lo que
    // hacen el botón y la tecla.
    if (Number.isFinite(o.ms)) {
        if (!vivo.cerrarEn(sesion.estado, toma, o.ms)) return espejo.resumen(sesion);
    } else {
        // El botón es «cerrá acá», y acá es donde llegó el audio: la última
        // palabra que el ciclo oyó va unos segundos atrás, y cerrar en ella
        // cortaba lo último dicho. La relectura lo acerca a la palabra.
        vivo.cerrarProvisional(toma, espejo.grabadoHastaMs(sesion));
    }
    relecturas.encolar(sesion, toma.id);
    historial.anotar(sesion.historia, {
        que: comoSeLlama({ tipo: 'cerrar', toma: toma.id }),
        tipo: 'cerrar',
        id: toma.id,
        antes,
        despues: historial.foto(toma)
    });
    espejo.escribir(sesion);
    return espejo.resumen(sesion);
}

module.exports = { editar, comoSeLlama, anotarDeLaSesion, volver, abrirToma, cerrarToma };
