'use strict';
/**
 * vivo/ciclo.js — Lo que oye el ciclo de señales, metido en las tomas (`aplicarSenales`).
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { norm } = require('../texto');
const { textoDe, mismaPalabra, MISMA_DEL_CICLO_MS, meterEnOrden } = require('./palabras');
const { vistaDeLaProxima } = require('./vistas');
const { reglasDeFrases, MISMA_SENAL_MS, senales } = require('./senales');
const { tomaAbierta, nuevaToma, VENTANA_DE_SUELTAS_SEC, MARGEN_DE_SUELTAS_SEC, pisoDeLasSueltas, finDeToma } = require('./tomas');

/**
 * Cuánto después de empezar su última palabra se corta una toma por una frase
 * de vista, si detrás todavía no se oyó nada.
 */
const FIN_DE_FRASE_MAX_MS = 800;

/** Cuántas de las últimas palabras oídas se recuerdan para encontrarlas en la pasada siguiente. */
const RECIENTES = 12;

/** El pedazo más largo de esas que se busca, y cuánto puede correrse de hora. */
const ENGANCHE_MAX = 8;

const ENGANCHE_CORRIMIENTO_MS = 2500;

/**
 * En qué palabra de la ventana nueva empieza lo que no se había oído.
 *
 * **Por el texto y no por la hora.** Sin la alineación contra el sonido (DTW,
 * que en vivo cuesta demasiado), la hora que Whisper le pone a una palabra se
 * corre hasta medio segundo de una pasada a otra. Con ventanas que se solapan
 * cuatro segundos, comparar horas perdía palabras —la nueva caía "antes" de la
 * última guardada— y repetía otras —la vieja caía "después"—: medido sobre una
 * prueba real por Zoom, «Esto inicia la primera toma» llegaba como «inicia la
 * toma», y «voy a» dos veces.
 *
 * Lo que se busca es la cola de lo ya oído (`estado.recientes`) adentro de la
 * ventana nueva: el pedazo más largo que coincida, cerca de su hora, y se sigue
 * después de él. Es lo que hacen las implementaciones de Whisper en vivo
 * (whisper_streaming). Si no aparece —otra forma de escribir lo mismo, o
 * silencio entre medio— se vuelve a la hora, que es lo que había.
 */
function dondeSigue(estado, nuevas) {
    const recientes = estado.recientes || [];
    if (recientes.length) {
        const textos = nuevas.map(w => norm(w.texto));
        const ultima = recientes[recientes.length - 1];
        for (let largo = Math.min(ENGANCHE_MAX, recientes.length); largo >= 1; largo--) {
            const cola = recientes.slice(-largo);
            // Una sola palabra es poco para creerle ("la", "y"): se le pide que
            // caiga casi a la misma hora.
            const margen = largo === 1 ? 800 : ENGANCHE_CORRIMIENTO_MS;
            let donde = -1;
            for (let j = 0; j + largo <= textos.length; j++) {
                if (!cola.every((r, k) => mismaPalabra(textos[j + k], r.n))) continue;
                if (Math.abs(nuevas[j + largo - 1].t - ultima.t) > margen) continue;
                donde = j + largo;
            }
            if (donde !== -1) return donde;
        }
    }
    const desde = estado.ultimaPalabraMs;
    if (desde == null) return 0;
    const i = nuevas.findIndex(w => w.t > desde);
    return i === -1 ? nuevas.length : i;
}

/**
 * Mete palabras nuevas y abre o cierra tomas según lo que se dijo.
 *
 * Las palabras llegan del ciclo de señales, que es rápido y de calidad mediana:
 * lo único que se le cree es que una señal SONÓ y a qué hora. El texto de la
 * toma no se arma con esto — se rehace entero al cerrar, con el modelo grande
 * (`oir.escuchar`) — así que acá las palabras se guardan para poder mostrar algo
 * mientras se habla y se reemplazan después.
 *
 * **Se le pasa la ventana ENTERA, con lo que ya se había oído.** Antes quien
 * llamaba recortaba las palabras viejas antes de entrar, y eso deshacía el solape
 * justo cuando servía: un conteo a caballo entre dos pasadas llegaba completo en
 * la segunda, el recorte le sacaba el "3" y el "2" por viejos, quedaba "uno"
 * suelto y la toma no se abría. En el audio del curso eso perdió dos tomas del
 * primer minuto. Ahora los duplicados se descartan acá, donde se sabe qué es una
 * palabra repetida y qué es una señal repetida.
 *
 * **Lo del final de la ventana se mira pero no se cree** (`firmeHastaMs`). La
 * última palabra de un pedazo suele estar cortada a la mitad —«funcion» por
 * «funcionando»— y la pasada siguiente, que la oye entera, ya no podía
 * arreglarla porque la palabra quedaba guardada. Ahora lo que termina después de
 * ese límite no se guarda ni dispara señales: vuelve a llegar en la pasada
 * siguiente, con audio de los dos lados. Pero SÍ se usa para mirar qué sigue a
 * "Pausa": sin eso, «pausa» al borde de la parte firme de «pausa en el flujo»
 * quedaba como última palabra, o sea con silencio detrás, y cerraba la toma.
 *
 * @param {object} estado el de la sesión (de `estadoNuevo`), se muta
 * @param {Array} palabras [{t, texto, hasta}] la ventana entera, en orden
 * @param {object} [opciones] { firmeHastaMs } — sin él, todo es firme
 * @returns {Array} qué pasó, para poder contarlo en la pantalla y en el registro
 */
/**
 * De qué toma es una palabra que el ciclo de señales acaba de oír.
 *
 * **La abierta no es la única que puede recibir palabras**, y eso es lo que
 * arregla el hueco del final de cada toma. El ciclo oye con unos segundos de
 * atraso —ventana de seis segundos, mediana de tres (ver `ciclo-senales.js`)—,
 * así que al cerrar una toma justo después de hablar, lo último dicho todavía
 * no se había oído. Llegaba con la toma ya cerrada, no había abierta, y se iba
 * al colchón: la toma se quedaba sin su final, y ese final volvía recién con la
 * relectura, que además espera a tener su orilla. Medio minuto de "me falta lo
 * que acabo de decir", justo donde el editor está mirando.
 *
 * La palabra cae dentro de los bordes de la toma, así que es suya: dejarla
 * suelta era decir que se dijo sin toma, y no es verdad. Es la misma regla que
 * `limpiarSueltas` mantiene del otro lado.
 *
 * Las descartadas no cuentan —ya no son de nadie— y una toma vieja no puede
 * salir elegida: la ventana del ciclo no llega tan atrás.
 */
function tomaCon(estado, w) {
    for (const t of estado.tomas || []) {
        if (t.inMs == null || t.descartada) continue;
        if (w.t >= t.inMs && (t.outMs == null || w.t < t.outMs)) return t;
    }
    return null;
}

/** Si una desactivada que cubre esa hora ya tiene esa misma palabra escrita. */
function yaEscritaEnDescartada(estado, w) {
    const n = norm(w.texto);
    for (const t of estado.tomas || []) {
        if (!t.descartada || t.inMs == null) continue;
        if (w.t < t.inMs || (t.outMs != null && w.t >= t.outMs)) continue;
        if ((t.palabras || []).some(p => Math.abs(p.t - w.t) < MISMA_DEL_CICLO_MS && mismaPalabra(norm(p.texto), n))) return true;
    }
    return false;
}

/**
 * Mete en una toma una palabra que el ciclo acaba de oír, con tres cuidados que
 * la toma abierta nunca necesitó y una cerrada sí:
 *
 *   · **en su sitio y no al final.** El ciclo oye con atraso, así que una
 *     palabra de hace cuatro segundos puede llegar cuando la toma ya tiene las
 *     de hace dos; pegada al final quedaba fuera de orden, y `senales` apunta a
 *     las palabras por índice;
 *   · **sin repetir.** Las ventanas se solapan y `dondeSigue` engancha por
 *     texto; cuando no engancha, la misma palabra vuelve. En la abierta la
 *     tapaba el enganche siguiente; en una cerrada se quedaba dos veces;
 *   · **y nunca sobre un texto releído.** Una toma que ya pasó por el modelo
 *     grande tiene SU texto, y el del ciclo es el descartable: meterle una
 *     palabra más es escribir «funcion» al lado de «funcionando».
 *
 * Los tres los encontró el martillo de secuencias al azar (`tests/martillo.test.js`).
 */
function meterEnToma(toma, w) {
    if (toma.outMs != null && toma.releida) return false;
    return meterEnOrden(toma.palabras || (toma.palabras = []), w);
}

function aplicarSenales(estado, palabras, opciones) {
    if (!Array.isArray(estado.sueltas)) estado.sueltas = [];
    if (!estado.ultimaSenal) estado.ultimaSenal = {};
    const todas = (palabras || []).filter(w => w && w.t != null);
    if (!todas.length) return [];
    const firme = opciones && Number.isFinite(opciones.firmeHastaMs) ? opciones.firmeHastaMs : Infinity;
    const esFirme = w => (w.hasta != null ? w.hasta : w.t) <= firme;
    // Las firmes son un prefijo: las palabras llegan en orden.
    let cuantasFirmes = 0;
    while (cuantasFirmes < todas.length && esFirme(todas[cuantasFirmes])) cuantasFirmes++;
    const nuevas = todas;

    // Las señales ya vistas, varias por tipo: con una sola por tipo, dos conteos
    // en la misma ventana de seis segundos se turnaban y los dos se volvían a
    // disparar en cada pasada.
    if (!estado.senalesVistas) estado.senalesVistas = {};
    const yaVista = marca => (estado.senalesVistas[marca.tipo] || [])
        .some(t => Math.abs(nuevas[marca.hasta].t - t) < MISMA_SENAL_MS);
    const finMs = opciones && Number.isFinite(opciones.finMs) ? opciones.finMs : undefined;

    // **A una señal se le cree por dónde EMPIEZA; a una palabra, por dónde
    // termina.** Que sean distintos no es un descuido: cuando detrás hay
    // silencio —y detrás de un «3, 2, 1» siempre lo hay, el que uno deja
    // esperando a que la toma abra— Whisper le estira el final a la última
    // palabra hasta el final del audio que oyó, que por construcción está
    // después del límite de lo firme. Con la regla del final, el «1» no era
    // firme nunca: en la primera grabación de verdad del vídeo semanal llegó
    // cinco pasadas seguidas como «1...@9.64-10.23», «-11.26», «-12.28»,
    // «-13.30» —el final corriéndose con la ventana— y la toma no abrió ni una
    // vez. Por eso hacía falta decirlo dos veces: la segunda uno sigue
    // hablando, la palabra deja de ser la última y recién ahí vale.
    //
    // El comienzo no se estira, y para una señal alcanza: son palabras cortas
    // de una lista cerrada, y media sílaba de más no convierte un «1» en otra
    // cosa. Para las palabras de la clase no alcanzaría —«funcion» a mitad de
    // «funcionando» empieza a tiempo y se guardaría cortada—, así que ahí sigue
    // valiendo el final (ver `cuantasFirmes`).
    const empezoATiempo = m => nuevas[m.hasta].t <= firme;
    const reglas = reglasDeFrases(opciones && opciones.frases);
    const marcas = senales(nuevas, finMs, reglas).filter(m => empezoATiempo(m) && !yaVista(m));
    // Dónde empieza lo que no se había oído: por el TEXTO y no por la hora (ver
    // `dondeSigue`).
    const inicioNuevo = dondeSigue(estado, nuevas);
    const eventos = [];
    let cursor = 0;
    // Hasta dónde cuenta como oído. Las firmes, y además las palabras de una
    // señal aceptada aunque no estén firmes: un «1» estirado se acepta por su
    // comienzo, y si no se anotaba como oído volvía en la pasada siguiente
    // como palabra nueva, se llevaba el IN provisional de la toma que acababa
    // de abrir y quedaba suelto en el gris.
    let hastaOido = cuantasFirmes;

    const guardar = (hasta) => {
        const toma = tomaAbierta(estado);
        const tope = Math.min(hasta, cuantasFirmes);
        for (let i = Math.max(cursor, inicioNuevo); i < tope; i++) {
            const w = nuevas[i];
            // El IN que puso el conteo sobre su propio «1», porque no se había
            // oído nada detrás: la primera palabra que llega después del «1» es
            // donde empieza. Puede llegar antes de ese IN y no solo después: un
            // «1» con el final estirado hasta el borde de la ventana lo dejaba
            // segundos más tarde que la primera palabra de la clase, y con un
            // `max` esa palabra no lo corregía y quedaba suelta.
            if (toma && toma.inProvisional && w.t > (toma.unoMs != null ? toma.unoMs : -Infinity)) {
                toma.inMs = w.t;
                delete toma.inProvisional;
                delete toma.unoMs;
            }
            // La palabra es de la toma en cuyos bordes cae, esté abierta o
            // recién cerrada; si no cae en ninguna queda en el colchón, por si
            // alguien abre a mano en los próximos segundos (ver `sueltas` y
            // `abrirToma`).
            const suya = tomaCon(estado, w);
            if (suya) meterEnToma(suya, w);
            // Lo que cae en el tramo de una desactivada es de nadie —su tramo
            // quedó libre— salvo que sea la misma palabra que ella ya tiene
            // escrita: el solape la trae otra vez y quedaba suelta y en su fila.
            else if (!yaEscritaEnDescartada(estado, w)) meterEnOrden(estado.sueltas, w);
        }
        cursor = hasta;
    };

    for (const marca of marcas) {
        estado.ultimaSenal[marca.tipo] = nuevas[marca.hasta].t;
        estado.senalesVistas[marca.tipo] = (estado.senalesVistas[marca.tipo] || [])
            .concat([nuevas[marca.hasta].t]).slice(-8);

        // Una «Pausa» que no cerró: se cuenta y no se hace nada más. Tiene que
        // estar ANTES del salto a «cierra» de abajo, que es a donde cae todo lo
        // que no se reconoce.
        if (marca.tipo === 'pausa-corta') {
            eventos.push({ tipo: 'pausa-corta', ms: nuevas[marca.desde].t, huecoSec: marca.huecoSec });
            continue;
        }

        // Cambiar de vista no abre ni cierra: la frase es clase —el profesor
        // se lo dice a la gente, no a la app— y sus palabras se guardan como
        // cualquier otra. Sin toma abierta queda elegida para la próxima; con
        // una abierta, el corte lo hace quien llama (`cambiosToma.vistaPorFrase`),
        // que es quien anota en el historial: así ⌘Z lo deshace de una vez.
        if (marca.tipo === 'vista') {
            const abierta = tomaAbierta(estado);
            if (!abierta) {
                if (vistaDeLaProxima(estado, marca.vista)) {
                    eventos.push({ tipo: 'vista-proxima', vista: marca.vista, por: marca.por });
                }
                continue;
            }
            if (abierta.vista === marca.vista) continue;
            // La toma se parte justo después de la frase: en la palabra que la
            // sigue, o poco después de la última si todavía no llegó nada. Sin
            // ese tope, el final estirado de la última palabra (ver arriba)
            // corría el corte hasta el borde de la ventana.
            const ultima = nuevas[marca.hasta];
            const sigue = nuevas[marca.hasta + 1];
            const finDeLaFrase = ultima.hasta != null ? ultima.hasta : ultima.t;
            eventos.push({
                tipo: 'vista',
                vista: marca.vista,
                por: marca.por,
                desdeMs: nuevas[marca.desde].t,
                ms: sigue ? sigue.t : Math.min(finDeLaFrase, ultima.t + FIN_DE_FRASE_MAX_MS)
            });
            continue;
        }

        guardar(marca.desde);

        if (marca.tipo === 'abre') {
            // Con una toma abierta, la cuenta no es señal: es clase. Nunca hay
            // dos notas abiertas a la vez, y lo que cierra es "Pausa" o el botón.
            //
            // Antes esto cerraba la toma y abría otra, y el día que el profesor
            // contó "3, 2, 1" mientras EXPLICABA la cuenta ("…porque dije 3, 2,
            // 1") le partió la toma en dos: una huérfana de tres segundos y la
            // buena al lado. Del lado de adentro de una toma no se puede saber
            // si la cuenta es una señal o alguien diciendo unos números, y entre
            // partir una toma buena y dejar correr una que ya estaba corriendo,
            // lo segundo se arregla mirando y lo primero no.
            //
            // El cursor se queda donde está a propósito: los números vuelven a
            // ser palabras y el próximo `guardar` los mete en la toma, que es
            // donde el profesor los dijo.
            if (tomaAbierta(estado)) continue;
            // El IN cae en la palabra que sigue a la señal, no en la señal: el
            // conteo no es clase. Si la señal fue lo último que llegó, queda en
            // su final y la primera palabra que venga lo corrige.
            // Si el «1» fue lo último oído, el IN va al FINAL del «1» y queda
            // provisional: la primera palabra que llegue lo corrige (`guardar`).
            // Antes caía al principio del «1» y nadie lo corregía: el «Uno.»
            // quedaba adentro de la toma.
            const sigue = nuevas[marca.hasta + 1];
            const uno = nuevas[marca.hasta];
            // **Un conteo dicho dentro de una toma que ya cerró no abre otra.**
            // Pasa con el ciclo atrasado y una toma cerrada a mano: el «3, 2, 1»
            // llega después del OUT del botón, con su hora por delante, y abría
            // una toma fantasma pegada a ese OUT. La rama de «cierra» ya ignora
            // así las señales de antes. Si ese OUT lo puso el botón y es
            // provisional, el conteo dice dónde terminó de verdad: se corre ahí.
            const piso = pisoDeLasSueltas(estado);
            if (nuevas[marca.desde].t < piso) {
                const previa = (estado.tomas || []).find(t => t.outMs === piso && !t.descartada);
                if (!previa || !previa.outProvisional || nuevas[marca.desde].t <= previa.inMs) continue;
                previa.outMs = finDeToma(previa, nuevas[marca.desde].t);
                delete previa.outProvisional;
                eventos.push({ tipo: 'cerrada', toma: previa.id });
            }
            hastaOido = Math.max(hastaOido, marca.hasta + 1);
            // Y nunca antes del OUT de la última cerrada: el ciclo oye con
            // atraso, así que un «3, 2, 1» dicho justo al cerrar a mano puede
            // llegar con su hora por detrás del OUT que puso el botón, y la
            // toma nueva nacía pisando a la anterior.
            const arranque = sigue ? sigue.t : (uno.hasta != null ? uno.hasta : uno.t);
            const toma = nuevaToma(
                estado,
                Math.max(arranque, pisoDeLasSueltas(estado)),
                textoDe(nuevas, marca.desde, marca.hasta));
            if (!sigue) {
                toma.inProvisional = true;
                toma.unoMs = uno.t;
            }
            // **Lo que se dijo antes del conteo se queda.** Antes acá se vaciaba
            // el colchón entero, y con él desaparecía de la pantalla todo lo
            // hablado entre la toma anterior y el «3, 2, 1»: ni se veía en el
            // gris de antes del IN ni se podía meter en ninguna de las dos
            // tomas. El editor lo reportó el 13/10 mirando las tomas 11 y 12,
            // donde entre una y otra había medio minuto hablado y los dos lados
            // salían vacíos.
            //
            // Se vaciaba por un motivo que sigue siendo cierto —un «abrir a
            // mano» posterior no puede retroceder hasta una tirada que ya quedó
            // del lado de afuera— pero eso es un piso para el retroceso, no una
            // razón para tirar el texto: lo pone `pisoDeLasSueltas`, que mira el
            // OUT de la última toma cerrada.
            estado.tomas.push(toma);
            eventos.push({ tipo: 'abierta', toma: toma.id, por: marca.por });
            cursor = marca.hasta + 1;
            continue;
        }

        // Cierra. El OUT va ANTES de "Pausa": la señal tampoco es clase.
        //
        // **Y solo si se dijo DESPUÉS de donde arranca la toma.** Una señal
        // anterior al IN no es el final de esta toma: es algo que se dijo antes
        // de que existiera. Normalmente no puede pasar —el ciclo va un segundo
        // atrás y las señales llegan en orden—, pero con el ciclo atrasado la
        // cola llega toda junta y entonces sí: visto de verdad, con el
        // transcript treinta segundos atrás, una «Pausa» de antes cerró una
        // toma recién abierta a mano 0,10 s después de su IN, y el montaje la
        // tiró por corta (`MINIMO_SEC`). Las notas de quien grababa se
        // perdieron sin un error en ningún sitio.
        //
        // Es el mismo caso que `guardar` ya trataba para las palabras —"que
        // pasa al abrir a mano durante el atraso del ciclo"—, que iba al
        // colchón en vez de a la toma. Acá la toma se queda abierta: quien la
        // abrió lo hizo a propósito, y la cierra la próxima «Pausa» o la mano.
        const toma = tomaAbierta(estado);
        if (toma && nuevas[marca.desde].t > toma.inMs) {
            // Una frase de varias palabras puede llegar partida entre dos
            // pasadas, y entonces su comienzo ya se guardó como clase: se saca,
            // o el OUT caería en el medio de la frase.
            if (marca.larga) toma.palabras = (toma.palabras || []).filter(w => w.t < nuevas[marca.desde].t);
            toma.outMs = finDeToma(toma, nuevas[marca.desde].t);
            eventos.push({ tipo: 'cerrada', toma: toma.id, por: marca.por });
        }
        cursor = marca.hasta + 1;
    }

    guardar(nuevas.length);
    // Hasta acá se oyó, haya o no toma abierta: una palabra que se dijo entre dos
    // tomas no es de nadie, pero tampoco puede volver a aparecer en la siguiente
    // ventana como si fuera nueva. Hasta la última FIRME: lo de después vuelve.
    // Las señales cuentan como oídas aunque no se guarden: son lo que la pasada
    // siguiente va a encontrar al principio de su ventana.
    if (hastaOido > inicioNuevo) {
        estado.ultimaPalabraMs = Math.max(estado.ultimaPalabraMs || -Infinity, nuevas[hastaOido - 1].t);
        estado.recientes = (estado.recientes || [])
            .concat(nuevas.slice(inicioNuevo, hastaOido).map(w => ({ n: norm(w.texto), t: w.t })))
            .filter(r => r.n)
            .slice(-RECIENTES);
    }

    // El colchón se recorta a su ventana. Sin esto, una clase de tres horas
    // donde nadie abre ninguna toma acumula en memoria todas sus palabras, y
    // `abrirToma` tendría que caminar hacia atrás sobre una lista que crece
    // toda la clase para contestar lo mismo.
    // De a mucho y pocas veces, no de a una palabra por pasada (ver
    // `VENTANA_DE_SUELTAS_SEC`): cada recorte corre el campo de espera.
    const piso = estado.ultimaPalabraMs - VENTANA_DE_SUELTAS_SEC * 1000;
    const tope = piso - MARGEN_DE_SUELTAS_SEC * 1000;
    if (estado.sueltas.length && estado.sueltas[0].t < tope) {
        estado.sueltas = estado.sueltas.filter(w => w.t >= piso);
    }
    return eventos;
}

module.exports = {
    FIN_DE_FRASE_MAX_MS,
    RECIENTES,
    ENGANCHE_MAX,
    ENGANCHE_CORRIMIENTO_MS,
    dondeSigue,
    tomaCon,
    yaEscritaEnDescartada,
    meterEnToma,
    aplicarSenales
};
