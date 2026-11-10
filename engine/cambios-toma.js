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
const referencias = require('./referencias');
const registro = require('./registro');
const vivo = require('./notas-vivo');

/** Los cambios de una toma que esta puerta conoce; cualquier otro no es un cambio. */
const TIPOS = new Set(['vista', 'nota', 'descartar', 'comentar', 'editar-comentario',
    'borrar-comentario', 'borde', 'dividir', 'vista-desde-ahora', 'reabrir', 'eliminar']);

/**
 * Cuánto tiene que llevar abierta una toma para que cambiarle la vista la parta.
 *
 * Menos que esto es corregir la vista que se acaba de poner, no cambiar de
 * plano: partir dejaría un pedacito de un segundo con la vista que no se
 * quería, y en el vídeo un corte que no va a ninguna parte.
 */
const PARA_PARTIR_MS = 2000;

/**
 * Lo que el editor cambia a mano desde la pantalla.
 *
 * Un comando por gesto, con su `tipo`, y cada tipo con lo suyo:
 *
 *   vista             { vista }                       qué cámara usa la toma
 *   nota              { texto }                       la nota del director
 *   descartar         { descartada }                  desactivar: fuera del XML, o de vuelta
 *   borde             { borde:'in'|'out', paredMs }   mover un borde a una palabra
 *   dividir           { paredMs, vista? }             partirla en una palabra; `vista`
 *                                                     es la de la segunda mitad
 *   vista-desde-ahora { vista }                       la abierta cambia de plano en
 *                                                     este instante (`vistaDesdeAhora`)
 *   reabrir           —                               "Pausa" cerró de más
 *   comentar          { desdeMs, hastaMs, texto, comentario }  sobre un pedazo del texto
 *   editar-comentario { indice, comentario }          corregir lo que se escribió
 *   borrar-comentario { indice }
 *   eliminar          —                               descartar: sacarla de la sesión
 *
 * Y uno que no es de ninguna toma, así que no lleva `toma`:
 *
 *   vista-proxima     { vista }                       la de la que todavía no empezó
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
    // La vista de la toma que todavía no empezó. No es de ninguna toma, así que
    // no pasa por el portero del historial ni escribe el XML: no hay nada
    // escrito que cambiar. Es una elección pendiente, y deshacer tiene que
    // deshacer lo que pasó, no lo que todavía no.
    if (c.tipo === 'vista-proxima') {
        vivo.vistaDeLaProxima(sesion.estado, c.vista);
        return espejo.resumen(sesion);
    }
    const toma = sesion.estado.tomas.find(t => t.id === c.toma);
    if (!toma) return espejo.resumen(sesion);
    // Un tipo que no existe no es un cambio: se contesta con el estado tal cual,
    // igual que con una toma que no está. Antes bajaba hasta `vivo.aplicar`, que
    // revienta con «Cambio sin definir», y eso salía por el IPC como una promesa
    // rechazada en la ventana. El motor no se fía de lo que manda la ventana.
    if (!TIPOS.has(c.tipo)) {
        registro.anotar('main', 'grabar.cambio-desconocido', { tipo: String(c.tipo) });
        return espejo.resumen(sesion);
    }
    // No es un cambio propio sino la elección entre dos que ya existen: partir
    // la toma, o cambiarle la vista entera. Cada uno anota su paso.
    if (c.tipo === 'vista-desde-ahora') return vistaDesdeAhora(sesion, toma, c);

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
            } else if (vivo.moverBorde(toma, c.borde, Number(c.paredMs), sesion.estado.tomas)) {
                // Las palabras se reparten YA con lo que hay, y la relectura
                // afina después. Sin esto el borde volvía a su palabra de antes
                // hasta que terminaba la relectura —cargar 1,6 GB de modelo y
                // pasar la toma entera, peleando la GPU con el texto en vivo—, y
                // arrastrar el IN parecía no hacer nada durante varios segundos.
                //
                // «Lo que hay» incluye las sueltas: adelantar el OUT de la
                // última toma cerrada es justamente meter adentro lo que se
                // siguió diciendo, y eso todavía no es de nadie. Sin ellas la
                // toma se quedaba sin el texto que uno acababa de abarcar hasta
                // que Whisper lo releía.
                vivo.tragarSueltas(sesion.estado, toma);
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
        // Partir sale por su propia puerta: anota su paso y escribe él mismo,
        // porque su paso no es de una toma sola —aparece otra y los números
        // corren— y el portero de abajo no sabría qué fotografiar.
        case 'dividir':
            dividir(sesion, toma, c);
            return espejo.resumen(sesion);
        // Los otros cinco se resuelven con lo que ya está escrito, así que son
        // los mismos que se hacen sobre una clase ya terminada (`editarGrabada`
        // en `clases-grabadas.js`), y de ahí que los aplique la misma función.
        // `borde` también entra ahí, pero acá va aparte: con la sesión viva se
        // relee el tramo, así que el borde no está atado a las orillas guardadas.
        case 'descartar': {
            // La abierta no se desactiva: primero se cierra, igual que para
            // descartarla. La ventana no lo ofrece, y el motor tampoco lo acepta.
            if (toma.outMs == null) break;
            // Y una que vuelve a contar tiene que caber. Mientras no contaba no
            // ponía piso, así que la toma siguiente pudo abrirse legítimamente
            // sobre su tramo; reactivarla ahora dejaría dos tomas vivas pisándose,
            // con la misma palabra en las dos y dos clips encimados en el XML.
            // Se niega, y se dice: esto sí es una decisión del editor.
            const pisada = !c.descartada && vivo.laQuePisa(sesion.estado.tomas, toma);
            if (pisada) {
                if (sesion.avisar) {
                    sesion.avisar({
                        tipo: 'aviso',
                        mensaje: `No puedo volver a activar la toma ${toma.id}: la toma ${pisada.id} quedó ` +
                            `sobre su tramo. Desactivá o corré la ${pisada.id} primero.`
                    });
                }
                break;
            }
            vivo.aplicar(toma, c, sesion.estado.tomas);
            // Una toma que vuelve a contar recupera lo que se dijo en su tramo
            // mientras no contaba: el ciclo lo fue dejando en el colchón, porque
            // una desactivada no es de nadie, y ahora cae dentro de ella.
            if (!toma.descartada) vivo.tragarSueltas(sesion.estado, toma);
            break;
        }
        default:
            vivo.aplicar(toma, c, sesion.estado.tomas);
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
        case 'editar-comentario': return `corregir un comentario de ${cual}`;
        case 'borrar-comentario': return `quitar un comentario de ${cual}`;
        case 'borde': return `mover el ${c.borde === 'in' ? 'IN' : 'OUT'} de ${cual}`;
        case 'dividir': return c.vista ? `pasar a ${c.vista} a mitad de ${cual}` : `dividir ${cual}`;
        case 'reabrir': return `reabrir ${cual}`;
        case 'eliminar': return `descartar ${cual}`;
        case 'abrir': return `abrir ${cual}`;
        case 'cerrar': return `cerrar ${cual}`;
        default: return `el cambio en ${cual}`;
    }
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
    // Y sale de la cola de relecturas: una toma que ya no está no tiene nada
    // que leer, y su número en la cola es una entrada que apunta a nadie.
    sesion.cola = (sesion.cola || []).filter(id => id !== toma.id);
    // Lo que decía deja de ser de alguien y vuelve al colchón: es lo mismo que
    // pasa al desactivarla, y lo que hace que ese tramo se pueda volver a tomar.
    vivo.limpiarSueltas(sesion.estado, toma.palabras || []);
}

/* ─── Partir una toma en dos ───────────────────────────────────────────── */

/**
 * Parte una toma por una palabra: lo de antes queda cerrado y lo de después
 * sigue en una toma nueva.
 *
 * Lo pidió el editor el 13/10: «para poder separar una toma en 2 y cambiar de
 * vista, sin necesidad de que haya un corte de contenido». El reparto lo hace
 * `vivo.dividir`; acá está lo que hay que mover FUERA del estado cuando los
 * números corren, que es lo que hace que renumerar no rompa nada.
 *
 * Las dos mitades se releen: cada una es ahora un tramo distinto del audio, y
 * sus orillas también cambiaron.
 *
 * Con `vista`, la segunda mitad sale ya con esa: es cambiar de plano a mitad de
 * una toma, y partir y cambiarle la vista son un solo gesto, que se deshace de
 * una vez. En dos pasos, un deshacer dejaba la toma partida con la vista vieja
 * en las dos mitades, que no es nada que alguien haya querido.
 *
 * @returns {boolean} si se partió
 */
function dividir(sesion, toma, c) {
    const ms = Number(c.paredMs);
    const vista = c.vista || null;
    const antes = historial.foto(toma);
    // No se pudo partir ahí —el corte cae sobre un borde, deja media toma de
    // una décima, o pide una vista que no existe—: sin cambio no hay paso,
    // igual que un borde que no se movió.
    if (!partir(sesion, toma, ms, vista)) return false;

    historial.anotar(sesion.historia, {
        que: comoSeLlama({ ...c, vista, toma: toma.id }),
        tipo: 'dividir',
        id: toma.id,
        // Dónde se partió y con qué vista quedó la segunda, que es lo único que
        // hace falta para volver a hacerlo.
        ms,
        vista,
        antes,
        despues: historial.foto(toma)
    });
    espejo.escribir(sesion);
    return true;
}

/**
 * El corte en sí, que es lo mismo al partir y al rehacer una división: el
 * reparto (`vivo.dividir`), lo que guarda un número de toma fuera del estado,
 * y las dos mitades a releer.
 *
 * @returns {boolean} si se partió
 */
function partir(sesion, toma, ms, vista) {
    const id = toma.id;
    const r = vivo.dividir(sesion.estado, toma, ms, { vista });
    if (!r) return false;
    correrLoDeAfuera(sesion, r.movidas);
    // Y la foto del OUT se va con el OUT, que ahora es de la segunda mitad. Va
    // DESPUÉS de las movidas: para entonces su sitio ya quedó libre.
    correrLoDeAfuera(sesion, [{ de: id, a: r.segunda.id }]);
    relecturas.encolar(sesion, r.primera.id);
    relecturas.encolar(sesion, r.segunda.id);
    return true;
}

const esVista = v => vivo.VISTAS.some(x => x.nombre === v);

/**
 * Cambiar de plano con la toma abierta: desde ESTE instante, no desde el IN.
 *
 * El profesor pasa a mostrar su pantalla a mitad de toma: lo que ya dijo a
 * cámara sigue con la cámara. Cambiarle la vista a la toma entera pasaría lo de
 * atrás a pantalla también. Así que se parte donde llegó el audio —la hora del
 * motor, que es la del WAV— y la segunda mitad, que sigue abierta, se lleva la
 * vista nueva (`dividir`).
 *
 * Con la toma recién abierta (`PARA_PARTIR_MS`) no se parte: es corregir la
 * vista que se acaba de poner, y va a la toma entera. Lo mismo si ya está
 * cerrada, que no hay un «ahora» dentro de ella, o si el corte no se puede hacer.
 */
function vistaDesdeAhora(sesion, toma, c) {
    if (!esVista(c.vista) || toma.vista === c.vista) return espejo.resumen(sesion);
    const ahora = espejo.grabadoHastaMs(sesion);
    const sePuede = toma.outMs == null && ahora - toma.inMs >= PARA_PARTIR_MS;
    if (sePuede && dividir(sesion, toma, { tipo: 'dividir', toma: toma.id, paredMs: ahora, vista: c.vista })) {
        return espejo.resumen(sesion);
    }
    return editar(sesion, { tipo: 'vista', toma: toma.id, vista: c.vista });
}

/**
 * Una frase de vista que se oyó con una toma abierta (ver `aplicarSenales`).
 *
 * Es «Dividir» con vista, y no un camino aparte: queda en el historial y ⌘Z la
 * deshace de una vez. La toma es la que tenía abierta cuando empezó la frase
 * —se busca por la hora, porque un corte anterior de la misma pasada ya corrió
 * los números—, y se parte en `ev.ms`, que es justo después de la frase.
 *
 * Con la toma recién abierta (`PARA_PARTIR_MS`) no se parte: la vista va a la
 * toma entera, como al elegirla a mano en ese momento.
 *
 * @returns {'partida'|'toda'|null} qué se hizo, para decirlo en la pantalla
 */
function vistaPorFrase(sesion, ev) {
    if (!sesion || !esVista(ev.vista)) return null;
    const toma = sesion.estado.tomas.find(t => !t.descartada && t.inMs != null
        && ev.desdeMs >= t.inMs && (t.outMs == null || ev.desdeMs < t.outMs));
    if (!toma || toma.vista === ev.vista) return null;
    if (ev.ms - toma.inMs < PARA_PARTIR_MS) {
        editar(sesion, { tipo: 'vista', toma: toma.id, vista: ev.vista });
        return 'toda';
    }
    return dividir(sesion, toma, { tipo: 'dividir', toma: toma.id, paredMs: ev.ms, vista: ev.vista }) ? 'partida' : null;
}

/**
 * Lo que guarda un número de toma y no vive en `estado.tomas`.
 *
 * Son dos, y se rompen distinto: la cola releería la toma que no es, y las
 * fotos del OUT quedarían cada una en el bloque de al lado.
 *
 * El historial NO está acá, y no es un olvido: su pila es LIFO, así que cuando
 * un paso se aplica la numeración es siempre la que había cuando se anotó. El
 * razonamiento entero está en `engine/deshacer.js`.
 */
/**
 * La toma abierta, cuando la entrada de audio cambia a mitad de la clase.
 *
 * Cada entrada escribe su propio WAV, y una toma se relee de UN solo WAV: el
 * que tiene su IN (`captura.laQueContiene`). Una toma que cruzara el cambio se
 * quedaría sin el texto de después. Así que se parte donde terminó el audio
 * viejo, y la segunda mitad —que sigue abierta, con la misma vista— empieza
 * donde empieza el nuevo. Entre los dos queda el hueco en que no se grabó.
 *
 * Una toma recién abierta, demasiado corta para partirla, no se parte: su IN
 * pasa al principio del WAV nuevo, y lo poco que se dijo antes queda suelto.
 *
 * **No va al historial.** Deshacerlo juntaría otra vez una toma con medio
 * texto en cada WAV, que es justo lo que esto evita.
 *
 * @returns {'partida'|'corrida'|null} qué se hizo, o null sin toma abierta
 */
function pasarAOtroAudio(sesion, finDelViejo, inicioDelNuevo) {
    const abierta = vivo.tomaAbierta(sesion.estado);
    if (!abierta) return null;
    const partida = partir(sesion, abierta, finDelViejo, abierta.vista);
    vivo.moverInAbierta(sesion.estado, vivo.tomaAbierta(sesion.estado), inicioDelNuevo);
    return partida ? 'partida' : 'corrida';
}

function correrLoDeAfuera(sesion, movidas) {
    if (!(movidas || []).length) return;
    const cambia = new Map(movidas.map(m => [m.de, m.a]));
    sesion.cola = (sesion.cola || []).map(id => (cambia.has(id) ? cambia.get(id) : id));
    try {
        referencias.renumerar(sesion.dir, sesion.estado.secuencia, movidas);
    } catch (e) {
        // Una foto que no se pudo renombrar no puede costar la división: lo peor
        // que pasa es que un bloque muestre la foto de al lado, y la clase sigue.
    }
}

/**
 * Deshacer una división junta las dos mitades; rehacerla las vuelve a partir.
 *
 * **No entra por `historial.poner` como los demás pasos**, y por eso tiene su
 * propia puerta: aquel repone campos de UNA toma, y acá hay una toma que
 * aparece o desaparece y un número que corre en todas las que siguen. La foto
 * de antes sí sirve, y es la que devuelve a la primera mitad su OUT, su texto y
 * sus dos orillas de una vez.
 *
 * @returns {boolean} si se pudo
 */
function volverDivision(sesion, paso, hacia) {
    const tomas = sesion.estado.tomas;
    if (hacia === 'adelante') {
        const toma = tomas.find(t => t.id === paso.id);
        if (!toma) return false;
        return partir(sesion, toma, paso.ms, paso.vista || null);
    }

    const segunda = tomas.find(t => t.id === paso.id + 1);
    const primera = tomas.find(t => t.id === paso.id);
    if (!segunda || !primera) return false;
    // Si la junta vuelve abierta, tiene que poder serlo: ninguna otra abierta
    // y ninguna viva detrás. La segunda mitad no cuenta porque se va en este
    // mismo gesto. Pasa cuando el conteo abrió otra toma después de partir
    // —el conteo no deja paso en el historial, así que la división sigue
    // arriba de la pila—, y deshacerla dejaría dos abiertas.
    //
    // Vuelve abierta solo si la segunda mitad sigue abierta: el final de la
    // junta es el de la segunda tal como está ahora (ver más abajo).
    if (segunda.outMs == null) {
        const estorba = tomas.some(t => t !== primera && t !== segunda && !t.descartada
            && (t.outMs == null || t.inMs > primera.inMs));
        if (estorba) return false;
    }
    // La foto del OUT vuelve a la primera mitad antes de que los números corran.
    correrLoDeAfuera(sesion, [{ de: segunda.id, a: primera.id }]);
    // Sin `campos`, que es como `poner` repone la toma entera: acá hay que
    // devolverle a la vez el OUT, el texto y las dos orillas.
    // Lo que la segunda mitad oyó DESPUÉS de partir no está en la foto de la
    // primera, que es de antes: si la segunda seguía abierta, es todo lo que se
    // dijo desde el corte, y se iba con ella. Se queda con la junta.
    const foto = paso.antes || {};
    const ultimaDeLaFoto = (foto.palabras || []).reduce((m, w) => Math.max(m, w.t), -Infinity);
    const nuevas = (segunda.palabras || []).filter(w => w.t > ultimaDeLaFoto + 1000);
    // **El final de la junta es el de la segunda mitad como está ahora**, y no
    // el de la foto. Partida la toma abierta, la foto es de una toma sin OUT;
    // si después «Pausa» cerró la segunda mitad, reponer la foto la reabría y
    // se tragaba lo que se dijo entre tomas, y el «3, 2, 1» siguiente caía
    // adentro.
    const fin = {
        outMs: segunda.outMs,
        outISO: segunda.outISO || null,
        despues: segunda.despues || [],
        cerradaSola: Boolean(segunda.cerradaSola),
        outProvisional: segunda.outProvisional
    };
    historial.poner(tomas, paso.id, paso.antes, null);
    Object.assign(primera, { outMs: fin.outMs, outISO: fin.outISO, despues: fin.despues, cerradaSola: fin.cerradaSola });
    if (fin.outProvisional) primera.outProvisional = true;
    else delete primera.outProvisional;
    primera.palabras = vivo.juntas(primera.palabras, nuevas);
    // La toma junta vuelve con el texto de antes de partirla, que no es un
    // texto leído con estos bordes (ver `volver`).
    delete primera.releida;
    tomas.splice(tomas.indexOf(segunda), 1);
    sesion.cola = (sesion.cola || []).filter(id => id !== segunda.id);
    correrLoDeAfuera(sesion, vivo.correrNumeros(sesion.estado, segunda.id + 1, -1));
    relecturas.encolar(sesion, primera.id);
    return true;
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
    // Reabrir una desactivada es querer seguir grabando en ella: vuelve a
    // contar. Una abierta que no cuenta deja al ciclo mandando al colchón lo
    // que se dice dentro de ella, y eso no se ve en ningún sitio. Y tiene que
    // caber: mientras no contaba, otra pudo correr su IN por encima de ella.
    const pisada = vivo.laQuePisa(tomas, { ...toma, descartada: false, outMs: null });
    if (pisada) {
        if (sesion.avisar) {
            sesion.avisar({
                tipo: 'aviso',
                mensaje: `No puedo reabrir la toma ${toma.id}: la toma ${pisada.id} quedó sobre su tramo.`
            });
        }
        return;
    }
    toma.descartada = false;
    toma.outMs = null;
    toma.cerradaSola = false;
    // Lo que se dijo desde que cerró vuelve a ser suyo. Sin OUT la toma llega
    // hasta ahora, así que las sueltas de ese tramo caen dentro de ella: dejarlas
    // en el colchón era tener palabras que no se veían en ningún sitio —no son
    // de nadie para la pantalla, pero están dentro de una toma para el motor—.
    vivo.tragarSueltasDesde(sesion.estado, toma);
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
 * motivo de que la foto sea de una toma y nunca de la sesión.
 */

/**
 * Un paso que ya no se puede dar: se tira, y se dice.
 *
 * Quedarse arriba de la pila lo dejaba trabado para siempre, con los pasos de
 * abajo inalcanzables. Se tira de la pila de la que se quiso sacar, así el
 * próximo ⌘Z sigue con el anterior.
 */
function sinPoder(sesion, paso, hacia, porque) {
    historial.tirar(sesion.historia, hacia);
    const verbo = hacia === 'adelante' ? 'rehacer' : 'deshacer';
    return {
        ok: false,
        error: `No puedo ${verbo} «${paso.que}»: ${porque}. Lo saqué del historial: ⌘Z sigue con lo anterior.`,
        estado: espejo.resumen(sesion)
    };
}

/**
 * @param {'atras'|'adelante'} hacia
 * @returns {{ok:boolean, que?:string, error?:string, estado:object|null}}
 */
function volver(sesion, hacia) {
    if (!sesion) return { ok: false, estado: null };
    const paso = historial.proximo(sesion.historia, hacia);
    if (!paso) return { ok: false, estado: espejo.resumen(sesion) };

    const foto = hacia === 'adelante' ? paso.despues : paso.antes;
    // No se puede reponer una toma que ya no cabe: mientras estuvo desactivada
    // —o fuera, si el paso es un «eliminar»— su tramo quedó libre y otra pudo
    // ocuparlo. Es la misma regla que «Mantener» y «Reabrir» (`laQuePisa`).
    // La división no: repone la primera mitad sobre el tramo de la segunda a
    // propósito, porque en el mismo gesto la segunda se va (`volverDivision`,
    // que tiene sus propias comprobaciones).
    if (foto && paso.tipo !== 'dividir') {
        // Como va a quedar la toma, no como está en la foto: el paso repone solo
        // los campos que cambió (`poner`), y el resto se queda como está hoy.
        const actual = sesion.estado.tomas.find(t => t.id === paso.id) || {};
        const quedaria = Array.isArray(paso.campos)
            ? { ...actual, ...Object.fromEntries(paso.campos.filter(k => k in foto).map(k => [k, foto[k]])) }
            : { ...foto };
        const pisada = quedaria.descartada ? null
            : vivo.laQuePisa(sesion.estado.tomas, { ...quedaria, id: paso.id });
        if (pisada) return sinPoder(sesion, paso, hacia, `la toma ${pisada.id} quedó sobre el tramo de la ${paso.id}`);
    }
    // Tampoco a la división: deshacerla saca la segunda mitad en el mismo
    // gesto, así que la abierta que esta guarda vería es justamente la que se
    // va. Con la guarda puesta, dividir la toma abierta —el caso para el que
    // existe dividir— no se podía deshacer nunca.
    if (paso.tipo !== 'dividir'
        && historial.dejariaDosAbiertas(sesion.estado.tomas, paso.id, foto, paso.campos)) {
        return sinPoder(sesion, paso, hacia, 'mientras tanto hubo otra toma detrás, y reabrirla las dejaría pisándose');
    }

    // Partir y juntar no se reponen con una foto: hay una toma que aparece o
    // desaparece y un número que corre en todas las que siguen (ver
    // `volverDivision`). Se mira ANTES de sacar el paso del historial, para que
    // uno que no se puede dar no se gaste.
    if (paso.tipo === 'dividir') {
        if (!volverDivision(sesion, paso, hacia)) return sinPoder(sesion, paso, hacia, 'esa toma ya no está como estaba');
        historial.sacar(sesion.historia, hacia);
        // Las dos mitades juntas o separadas cambian qué tramo es de quién, y
        // las sueltas son de la sesión: se cuadran igual que en el camino de
        // abajo. Sin esto, deshacer la división de la toma abierta dejaba en el
        // colchón lo dicho desde el corte, dentro de la toma y sin verse.
        vivo.limpiarSueltas(sesion.estado, []);
        espejo.escribir(sesion);
        return { ok: true, que: paso.que, estado: espejo.resumen(sesion) };
    }

    // Deshacer una creación —abrir, partir— saca la toma; rehacerla la vuelve a
    // poner. Lo que vuelve tiene que ser la toma como estaba al sacarla, y no
    // como nació: un ⌘Z de un «abrir» viejo sacaba una toma ya cerrada y el
    // rehacer la devolvía abierta, o ni la devolvía.
    if (hacia === 'atras' && paso.antes == null) {
        const actual = sesion.estado.tomas.find(t => t.id === paso.id);
        if (actual) paso.despues = historial.foto(actual);
    }
    const dado = historial.sacar(sesion.historia, hacia);
    // Lo que la toma tiene ANTES de que la foto vuelva: si la foto no se lo
    // devuelve, es porque esa palabra pasa a estar fuera de toda toma otra vez.
    const tenia = ((sesion.estado.tomas.find(t => t.id === paso.id) || {}).palabras || []).slice();
    historial.poner(sesion.estado.tomas, paso.id, foto, dado.campos);
    // La foto repone los campos que el gesto cambió, y las palabras pueden
    // no estar entre ellos: deshacer un «reabrir» devuelve el OUT viejo y
    // deja en la toma todo lo que el ciclo le metió mientras estuvo abierta,
    // o sea palabras fuera de sus propios bordes. Se vuelve a repartir por
    // los bordes repuestos, y lo que cae fuera pasa a orilla.
    const vuelta = sesion.estado.tomas.find(t => t.id === paso.id);
    if (vuelta && vuelta.inMs != null) {
        // Solo hacia afuera: lo que quedó fuera de los bordes sale a la
        // orilla. No al revés —meter la orilla dentro— porque la orilla es
        // texto del modelo grande y las palabras repuestas son del ciclo:
        // juntarlas dejaba la misma palabra dos veces con dos ortografías.
        const fin = vuelta.outMs == null ? Infinity : vuelta.outMs;
        const dentroDe = w => w.t >= vuelta.inMs && w.t < fin;
        const fuera = (vuelta.palabras || []).filter(w => !dentroDe(w));
        vuelta.palabras = (vuelta.palabras || []).filter(dentroDe);
        // Y la orilla se recorta a lo que es orilla con estos bordes: lo que
        // ahora cae dentro no se mete —sería la lectura grande junto a la
        // del ciclo— y lo repone la relectura, que vuelve a correr.
        vuelta.antes = vivo.juntas(vuelta.antes, fuera).filter(w => w.t < vuelta.inMs);
        vuelta.despues = vuelta.outMs == null ? [] : vivo.juntas(vuelta.despues, fuera).filter(w => w.t >= fin);
        // Un texto repuesto no es un texto leído. La foto devuelve las
        // palabras de entonces —las del ciclo, si la relectura aterrizó
        // después—, y la marca de «ya releída con estos bordes» se quedaba
        // puesta: la cola la veía leída y no la volvía a leer nunca, así
        // que el texto descartable quedaba en el archivo para siempre.
        delete vuelta.releida;
    }
    // La foto es de una toma y las sueltas son de la sesión: hay que
    // cuadrarlas a mano, o un borde repuesto deja la misma palabra adentro
    // y afuera. Vuelve al colchón lo que la toma PERDIÓ: lo que tenía en
    // `palabras` y ya no tiene. Lo que sigue en `palabras` no —y eso cubre
    // a la toma desactivada, que se queda con sus palabras y mandarlas
    // además al colchón las mostraba dos veces, gris entre tomas y dentro
    // de su fila—. Las orillas no cuentan: una palabra en `despues` está
    // fuera de la toma, y que además esté suelta es lo normal.
    //
    // **Y solo lo que quedó FUERA de sus bordes.** Lo que la toma tenía y
    // sigue cayendo dentro de ellos no se perdió: se reemplazó. Es el caso
    // de deshacer un «cerrar» cuando la relectura ya aterrizó: la foto
    // devuelve el texto del ciclo, y las palabras del modelo grande que
    // no coinciden letra por letra —«funcion» y «funcionando»— no son
    // sueltas que haya que devolver, son la otra lectura del mismo tramo.
    // Soltarlas las metía otra vez en la toma reabierta, y el texto salía
    // con las dos lecturas pegadas.
    const sigueEn = new Set(((vuelta && vuelta.palabras) || []).map(w => `${w.t}|${w.texto}`));
    const dentro = w => vuelta && vuelta.inMs != null && w.t >= vuelta.inMs
        && (vuelta.outMs == null || w.t < vuelta.outMs);
    vivo.limpiarSueltas(sesion.estado,
        (tenia || []).filter(w => !sigueEn.has(`${w.t}|${w.texto}`) && !dentro(w)));
    // Y la cola no apunta a una toma que el paso acaba de sacar.
    if (!vuelta) sesion.cola = (sesion.cola || []).filter(id => id !== paso.id);
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

module.exports = { editar, comoSeLlama, volver, abrirToma, cerrarToma, pasarAOtroAudio, vistaPorFrase };
