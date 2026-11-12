'use strict';
/**
 * vivo/tomas.js — Las tomas: el estado de la clase, abrir, cerrar, partir y mover bordes.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { juntas } = require('./palabras');
const { VISTAS, vistaHeredada } = require('./vistas');

/**
 * Un estado recién iniciado: la forma entera, declarada una vez.
 *
 * Todo lo que la sesión y `aplicarSenales` van a escribir está acá desde el
 * principio, con su valor vacío. Antes `ultimaSenal` y `ultimaPalabraMs`
 * aparecían en el primer uso, y quien leía cómo arranca una sesión no podía
 * saber la forma completa sin leer también este archivo.
 *
 * @param {object} params { secuencia, curso, ceroMs, fps, idioma, dispositivo }
 */
function estadoNuevo(params) {
    const p = params || {};
    return {
        secuencia: p.secuencia || null,
        curso: p.curso || null,
        // El número de clase (1 → `01` en el nombre) y, si esa clase se grabó
        // más de una vez, cuál de esas veces es esta. Los dos nulos en una
        // sesión sin número, que se nombra solo por la fecha.
        //
        // `vez` y no `version`, que es el nombre que ya usa el formato del
        // sidecar (ver `PRIMERA_VEZ` en `nombre-de-sesion.js`).
        numero: p.numero != null ? p.numero : null,
        vez: p.vez != null ? p.vez : null,
        // El momento de "Iniciar grabación", del que cuelgan los cuadros del XML.
        ceroMs: p.ceroMs != null ? p.ceroMs : null,
        // A cuántos cuadros va la secuencia del editor. Se congela al arrancar y
        // viaja en el estado en vez de leerse de Ajustes al escribir el XML:
        // cambiarlo a mitad de una clase de tres horas movería todos los
        // marcadores que ya se habían escrito, y el editor ya sincronizó contra
        // ellos. Cambiar el fps es empezar otra sesión.
        fps: p.fps || 30,
        idioma: p.idioma || 'es',
        /**
         * Y qué idioma se está OYENDO, que no siempre es el que se pidió.
         *
         * Lo pone el ciclo de señales con lo que contesta Whisper, que lo dice
         * en cada pasada aunque el idioma esté puesto (ver `anotarLoQueSuena`
         * en `ciclo-senales.js`). Sirve para dos cosas: con `auto` es lo que
         * decide qué pedir la pasada siguiente —y lo que hace que detectar no
         * cueste 400 ms en cada una— y con el idioma puesto es lo que deja que
         * la barra avise cuando no coinciden. No va al sidecar: es de esta
         * corrida y se vuelve a saber en dos pasadas.
         */
        idiomaOido: null,
        dispositivo: p.dispositivo || null,
        /**
         * Las claquetas de las clases grabadas antes de que la app dejara de
         * anotarlas. Una clase nueva no tiene ninguna —se sincroniza por forma
         * de onda—, pero las viejas las siguen llevando a su XML.
         *
         * Cada una: `{ n, ms, paredMs, frase, confirmada, origen }`. `n` es su
         * número, que es con el que se la nombra en el XML y en la pantalla;
         * `ms` es su hora en el reloj del audio y `paredMs` la del reloj de
         * pared, que se guarda para poder emparejarla con la fecha de creación
         * de un archivo de cámara.
         */
        claquetas: [],
        // Los archivos de audio que la sesión fue cerrando. Una sesión puede
        // tener más de uno: si el dispositivo se cae y se reabre, el WAV nuevo
        // entra como otro clip en su offset (`captura.laQueContiene`).
        sesiones: [],
        tomas: [],
        proximaToma: 0,
        // La vista elegida entre toma y toma, para la que todavía no empezó
        // (`vistaDeLaProxima`). Se gasta al abrirse. No va al XML ni al
        // sidecar: cuando el XML se escribe, la toma ya tiene la suya.
        vistaProxima: null,
        /**
         * Lo que se oyó SIN una toma abierta, de los últimos minutos
         * (`VENTANA_DE_SUELTAS_SEC`).
         *
         * Antes esto se tiraba: una palabra dicha entre dos tomas no es de
         * nadie, y para el XML sigue sin serlo. Existe por un caso concreto y
         * es el que más tomas hace perder: el profesor arranca sin decir
         * "3, 2, 1" y quien toma notas se da cuenta cinco o diez segundos
         * después. Abrir la toma en ese momento la abriría a mitad de la
         * primera frase.
         *
         * Con estas palabras guardadas, abrir a mano puede retroceder hasta
         * donde ESA tirada empezó (ver `abrirToma`), que es donde el conteo la
         * habría abierto. Son unas cien palabras en memoria y no van al XML ni
         * al sidecar.
         */
        sueltas: [],
        // Hasta dónde se oyó y cuándo sonó la última señal de cada tipo: lo que
        // deja pasar la ventana entera del ciclo, con su solape, sin repetir nada.
        ultimaPalabraMs: 0,
        ultimaSenal: {}
    };
}

/**
 * Las tomas que van al XML: las que se quedaron y tienen los dos bordes.
 *
 * Una toma descartada no se escribe, que es el sentido de descartarla. Una sin
 * cerrar tampoco: el parser la aceptaría y avisaría `bloque_sin_out`, pero acá
 * todavía se puede cerrar a mano, así que es mejor no escribirla que escribir un
 * bloque que el editor va a tener que arreglar en post.
 */
function tomasQueQuedan(estado) {
    return (estado.tomas || []).filter(t => !t.descartada && t.inMs != null && t.outMs != null);
}

function tomaAbierta(estado) {
    return (estado.tomas || []).find(t => t.outMs == null) || null;
}

/**
 * El contador, puesto al día: nunca por debajo del número más alto que ya hay.
 *
 * **El número se pide mirando las tomas, no solo el contador**, y eso es la red
 * y no un detalle. Un número repetido no es un rótulo mal puesto: once sitios
 * del motor buscan su toma con `find(t => t.id === n)` y todos se quedan con la
 * primera, así que mover un borde, un Cmd-Z o una relectura se van a la toma que
 * no es —y la que el editor está mirando no se relee nunca—. Salió grabando el
 * 13/10: «dice que es la toma 2 y ya hay una toma 2», y la causa era que
 * `dividir` metía la mitad nueva sin avisarle al contador (ver abajo). Con la
 * cuenta hecha sobre la lista, olvidarse de avisar deja un número saltado, que
 * es barato, en vez de dos tomas con el mismo nombre, que no lo es.
 */
function alDia(estado) {
    estado.proximaToma = Math.max(Number(estado.proximaToma) || 0,
        ...(estado.tomas || []).map(t => Number(t.id) || 0));
    return estado.proximaToma;
}

/**
 * Una toma nueva, con la forma entera declarada en un solo sitio.
 *
 * La arman los dos caminos que abren —el conteo hablado y el botón— y por eso
 * está acá: con la forma escrita dos veces, un campo que se agregue de un lado
 * deja tomas a las que les falta del otro, y eso no se ve hasta que algo lee el
 * campo que no está.
 */
function nuevaToma(estado, inMs, cuenta) {
    const pedida = estado.vistaProxima;
    estado.vistaProxima = null;
    return {
        id: (estado.proximaToma = alDia(estado) + 1),
        vista: pedida || vistaHeredada(estado),
        comentario: '',
        cuenta: cuenta || '',
        inMs,
        outMs: null,
        descartada: false,
        cerradaSola: false,
        palabras: [],
        comentarios: []
    };
}

/**
 * Cuánto silencio separa dos tiradas de habla.
 *
 * Es el hueco que convierte "sigue hablando" en "empezó otra cosa", y con él se
 * decide hasta dónde retrocede una toma abierta a mano. Segundo y medio: por
 * debajo, una coma respirada partiría la frase y el IN quedaría a mitad de
 * camino; por encima, dos frases separadas por una pausa normal se leerían como
 * una sola y el IN se iría demasiado atrás.
 */
const HUECO_DE_TIRADA_SEC = 1.5;

/**
 * Hasta dónde puede retroceder una toma abierta a mano.
 *
 * Veinte segundos, que es de sobra para el caso real —darse cuenta de que el
 * profesor arrancó sin decir el conteo lleva unos pocos— y poco para el caso
 * malo: si alguien abre a mano después de un monólogo de dos minutos, el IN no
 * se va al principio del monólogo. Ante la duda, el borde se corrige después
 * arrastrándolo sobre el texto, que es una cosa que se hace mirando; un IN que
 * se fue solo dos minutos atrás hay que descubrirlo primero.
 */
const RETROCESO_MAX_SEC = 20;

/**
 * Cuánto se guarda en el colchón de palabras sueltas, y de a cuánto se recorta.
 *
 * El colchón es además lo que se ve en el campo de espera, y eso decide los dos
 * números. Con treinta segundos recortados en cada pasada, a partir del medio
 * minuto sin toma abierta cada pasada sacaba palabras de arriba: el texto se
 * corría bajo el ojo y la selección se perdía, que es lo que el editor reportó
 * el 30/09 («el texto va saltando […] para que pueda seleccionar fácilmente
 * mientras se está grabando»).
 *
 * Diez minutos guardados y cinco de margen antes de recortar: el recorte llega
 * de a cinco minutos de una vez, así que el campo salta a lo sumo una vez cada
 * cinco minutos, y solo después de un cuarto de hora sin ninguna toma. Son unas
 * pocas miles de palabras como mucho. No cambia hasta dónde retrocede
 * `abrirToma` sola, que tiene su propio tope (`RETROCESO_MAX_SEC`); lo que gana
 * es el arrastre del IN sobre el texto suelto, que ahora llega más atrás.
 */
const VENTANA_DE_SUELTAS_SEC = 600;

const MARGEN_DE_SUELTAS_SEC = 300;

/**
 * Cuán vieja puede ser la última palabra oída para que cuente como "el
 * profesor está hablando ahora".
 *
 * **Seis segundos, y no es un número generoso: es el que hace falta.** Lo que
 * la app tiene oído va SIEMPRE atrasado, y se sabe cuánto: el ciclo de señales
 * corre cada tres segundos (`CICLO_MS`) y Whisper tarda algo más de uno en
 * contestar, así que en el peor caso la última palabra que hay en memoria se
 * dijo cuatro segundos y pico antes del clic aunque el profesor no haya parado
 * de hablar ni un instante. Con el umbral en el hueco entre palabras (1,5 s),
 * abrir a mano no retrocedía nunca: el arreglo no servía justo en el único
 * caso para el que existe.
 *
 * Los cuatro y pico del atraso más un par de segundos de reacción humana dan
 * seis. Más allá de eso se asume lo otro —que el profesor está callado y que
 * quien abre se está adelantando—, y entonces la toma empieza donde se apretó,
 * que es lo correcto para ese caso.
 */
const FRESCURA_MAX_SEC = 6;

/**
 * Dónde empieza la tirada de habla que está corriendo ahora.
 *
 * Se camina hacia atrás desde la última palabra oída, y se para en el primer
 * hueco de `HUECO_DE_TIRADA_SEC` o al llegar al tope de retroceso. Lo que
 * devuelve es el índice de la primera palabra de esa tirada, o -1 si no hay
 * ninguna palabra reciente.
 *
 * @param {Array} sueltas palabras con hora del día, en orden
 * @param {number} hastaMs el momento desde el que se mira para atrás
 */
function arranqueDeLaTirada(sueltas, hastaMs) {
    const lista = sueltas || [];
    let i = lista.length - 1;
    while (i >= 0 && lista[i].t > hastaMs) i--;
    if (i < 0) return -1;

    // La última palabra tiene que ser RECIENTE. Si lo último que se oyó fue
    // hace medio minuto, no hay ninguna tirada corriendo: el profesor está
    // callado y la toma empieza donde se apretó el botón. El umbral es el del
    // atraso del ciclo y no el del hueco entre palabras (ver `FRESCURA_MAX_SEC`).
    const fin = lista[i].hasta || lista[i].t;
    if ((hastaMs - fin) / 1000 > FRESCURA_MAX_SEC) return -1;

    const piso = hastaMs - RETROCESO_MAX_SEC * 1000;
    while (i > 0) {
        const previa = lista[i - 1];
        if (previa.t < piso) break;
        const hueco = (lista[i].t - (previa.hasta || previa.t)) / 1000;
        if (hueco >= HUECO_DE_TIRADA_SEC) break;
        i--;
    }
    return i;
}

/**
 * Abre una toma a mano: el botón y la tecla, no la señal.
 *
 * Existe porque el conteo no siempre se dice. El profesor arranca directo, o se
 * lo come, o dice "bueno, vamos" — y entonces la toma no se abre sola y lo que
 * sigue se pierde para el XML. Es la pérdida más cara de esta app, porque no se
 * descubre hasta la mesa de edición.
 *
 * **Retrocede hasta donde empezó la frase, y ahí está la gracia.** Abrir en el
 * momento del clic sería abrir a mitad de lo que el profesor ya venía diciendo:
 * quien toma notas se da cuenta unos segundos tarde, siempre. Con las palabras
 * sueltas guardadas (ver `sueltas`), el IN se puede poner donde el conteo lo
 * habría puesto — al principio de la tirada— y esas palabras entran a la toma
 * en vez de quedar afuera.
 *
 * Si el profesor está callado, no hay nada que retroceder y la toma empieza
 * donde se apretó. Eso también es correcto: es el caso de abrir ANTES de que
 * alguien hable, que es como se usa cuando uno se adelanta.
 *
 * **Con `exacto`, el IN va donde se pidió y no se retrocede.** Es el gesto de
 * arrastrar el IN hasta una palabra del texto suelto: ahí quien toma notas ya
 * eligió dónde empieza, mirando, y adivinar el arranque de la frase sería
 * pisarle la decisión.
 *
 * @param {object} estado el de la sesión, se muta
 * @param {number} ms la hora del día del gesto, en el reloj del audio
 * @param {object} [opciones] { exacto, ahoraMs } — `ahoraMs` es desde dónde se
 *   cuenta cuánto retrocedió, cuando `ms` no es "ahora"
 * @returns {{toma: object, retrocedioSec: number}|null} null si ya hay una abierta
 */
function abrirToma(estado, ms, opciones) {
    if (tomaAbierta(estado)) return null;
    const o = opciones || {};

    // Solo lo que todavía no es de nadie. Las sueltas llegan hasta antes de la
    // toma anterior —ya no se tiran al abrir con el conteo— así que sin este
    // piso el retroceso podría meter en la toma nueva palabras que ya están
    // adentro de la de antes, y la misma frase saldría dos veces en el XML.
    const piso = pisoDeLasSueltas(estado);
    const todas = estado.sueltas || [];
    const libres = todas.filter(w => w.t >= piso);
    const desde = o.exacto
        ? libres.findIndex(w => w.t >= ms)
        : arranqueDeLaTirada(libres, ms);
    // Nunca antes del OUT de la última cerrada, venga de donde venga la hora.
    // Con el retroceso de siempre eso se cumple solo —sale de `libres`, que ya
    // está por encima del piso—, pero una hora exacta es de la ventana y la
    // ventana puede mandar una palabra gris de antes del piso: la toma nueva
    // nacía adentro de la anterior, y a partir de ahí las dos se pisaban en el
    // XML y los bordes de las dos se peleaban la misma palabra.
    const inMs = Math.max(piso, (o.exacto || desde === -1) ? ms : libres[desde].t);

    const toma = nuevaToma(estado, inMs, '');
    if (desde !== -1) {
        // Las palabras de la tirada dejan de ser de nadie y pasan a ser de la
        // toma. Se sacan del colchón: dejarlas ahí las mostraría dos veces
        // —adentro de la toma y como sueltas— y la toma siguiente podría
        // volver a absorberlas. Lo de debajo del piso se queda como estaba: es
        // el gris de una toma de antes y no es de esta.
        toma.palabras = libres.slice(desde);
        estado.sueltas = todas.filter(w => w.t < piso).concat(libres.slice(0, desde));
    }
    estado.tomas.push(toma);
    const desdeCuando = o.ahoraMs != null ? o.ahoraMs : ms;
    return { toma, retrocedioSec: Math.max(0, Math.round((desdeCuando - inMs) / 100) / 10) };
}

/* ─── Partir una toma en dos ──────────────────────────────────────────────
 *
 * Lo pidió el editor el 13/10: «deberíamos agregar una función de "Dividir
 * toma". Esto para poder separar una toma en 2 y cambiar de vista, sin
 * necesidad de que haya un corte de contenido.»
 *
 * O sea: el profesor habló de corrido veinte minutos y en el medio pasó de
 * hablar a cámara a mostrar la pantalla. Es una sola tirada de contenido —no
 * hay dónde cortar— pero son dos planos. Hasta ahora eso pedía cerrar la toma
 * en una palabra y abrir otra en la siguiente, con dos gestos y el riesgo de
 * dejar un hueco entre el OUT de una y el IN de la otra.
 *
 * **Las dos mitades se tocan.** El OUT de la primera ES el IN de la segunda, y
 * `repartir` reparte con el OUT exclusivo, así que ni se pierde ni se repite
 * una palabra. Eso es lo que hace que esto no sea «cerrar y abrir»: entre las
 * dos no queda nada afuera.
 */

/**
 * Parte `toma` en dos por la palabra que empieza en `ms`.
 *
 * La primera mitad se queda con el número —es la misma toma, que ahora termina
 * antes— y la segunda es nueva y se mete justo detrás. Si la toma estaba
 * abierta, la segunda queda abierta: es «dejá cerrado lo de hasta acá y seguí
 * grabando», que es como lo pidió.
 *
 * Qué se lleva cada una:
 *
 *   · las palabras y las dos orillas se reparten por el corte, sin releer nada;
 *   · la **vista** la heredan las dos, porque el gesto es justamente cambiarle
 *     la vista a una de ellas y hay que poder ver cuál se cambió. Salvo que se
 *     pida otra para la segunda (`vista`): es cambiar de plano a mitad de
 *     una toma, y una vista que no existe no parte nada;
 *   · el **OUT** y su foto son del final, así que son de la segunda;
 *   · la **nota de la toma** se queda en la primera y no se copia. Es un
 *     marcador del XML: duplicarla pondría dos marcadores iguales en Premiere,
 *     y la nota se escribió mirando el principio, que es donde queda;
 *   · las **notas sobre el texto** van cada una a la mitad donde cae su palabra;
 *   · `descartada` la heredan las dos: una toma desactivada partida en dos sigue
 *     desactivada entera, y volver a activar media sería otro gesto;
 *   · el **ajuste** al silencio se tira en las dos. Los bordes cambiaron, así
 *     que el guardado ya no vale (ver `bordeAjustado` en `ajustar-corte.js`), y
 *     dejarlo puesto sería escribir en el XML un corte que no se calculó contra
 *     estos bordes.
 *
 * @param {object} estado el de la sesión, se muta
 * @param {object} toma la que se parte
 * @param {number} ms la hora de la palabra que abre la segunda mitad
 * @param {{vista?: string}} [cambio] la vista con que sigue la segunda mitad
 * @returns {{primera:object, segunda:object}|null} null si no se puede partir ahí
 */
function dividir(estado, toma, ms, { vista } = {}) {
    if (!toma || !Number.isFinite(ms)) return null;
    if (vista != null && !VISTAS.some(v => v.nombre === vista)) return null;
    if (toma.inMs == null || ms <= toma.inMs) return null;
    if (toma.outMs != null && ms >= toma.outMs) return null;
    // Que las dos mitades sean tomas y no un fotograma: el mismo mínimo con el
    // que `finDeToma` cuida que el OUT no caiga sobre el IN.
    if (ms - toma.inMs < DURACION_MINIMA_MS) return null;
    if (toma.outMs != null && toma.outMs - ms < DURACION_MINIMA_MS) return null;

    const todas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
    const comentarios = toma.comentarios || [];

    const segunda = {
        id: toma.id + 1,
        vista: vista || toma.vista,
        comentario: '',
        cuenta: '',
        inMs: ms,
        outMs: toma.outMs,
        inISO: null,
        outISO: toma.outISO || null,
        descartada: Boolean(toma.descartada),
        cerradaSola: Boolean(toma.cerradaSola),
        palabras: [],
        comentarios: comentarios.filter(c => c.desdeMs != null && c.desdeMs >= ms),
        relectura: toma.relectura || null
    };
    if (toma.outProvisional) segunda.outProvisional = true;

    // Y la primera termina donde empieza la segunda.
    toma.outMs = ms;
    toma.outISO = null;
    toma.cerradaSola = false;
    toma.comentarios = comentarios.filter(c => c.desdeMs == null || c.desdeMs < ms);
    delete toma.outProvisional;
    delete toma.ajuste;
    delete toma.pausaAdentro;

    Object.assign(toma, repartir(todas, toma));
    Object.assign(segunda, repartir(todas, segunda));

    // La segunda entra justo detrás, y lo que venía después corre un número: el
    // editor pidió que se leyeran en orden (ver `correrNumeros`).
    const donde = estado.tomas.indexOf(toma);
    const movidas = correrNumeros(estado, toma.id + 1);
    estado.tomas.splice(donde + 1, 0, segunda);
    // Y el contador se entera DESPUÉS de meterla, que es lo que faltaba: lo
    // ponía al día `correrNumeros`, que cuenta las tomas de la lista, y ahí la
    // mitad nueva todavía no estaba. Dividiendo la última no había ninguna otra
    // que correr, así que el contador se quedaba abajo y la toma siguiente
    // repartía un número ya usado.
    alDia(estado);
    return { primera: toma, segunda, movidas };
}

/**
 * Corre un número a todas las tomas desde `desde`, para hacerle sitio a una.
 *
 * **Renumerar y no dejar huecos fue la decisión del editor**, preguntado de
 * frente: una toma 9 metida entre la 4 y la 5 se lee peor en Premiere que
 * cuatro tomas que cambian de nombre. El precio es que el número de una toma
 * deja de ser para siempre, y por eso todo lo que guarda un número tiene que
 * correrlo en el mismo gesto: las fotos del OUT —que se nombran por el número
 * de su toma (`engine/referencias.js`)—, la cola de relecturas y, sobre todo,
 * el historial de deshacer, que guarda los pasos por `id`. Nada de eso se puede
 * hacer desde acá, así que lo orquesta `cambios-toma`.
 *
 * De atrás hacia adelante al subir y al revés al bajar, para que ningún número
 * pise a otro mientras se mueven. Lo que devuelve va en ese mismo orden, porque
 * quien renombra las fotos tiene el mismo problema.
 *
 * **`proximaToma` solo sube.** Al deshacer una división los números vuelven,
 * pero el contador se queda arriba: un número que ya se usó no se reparte otra
 * vez, porque el historial guarda los pasos por `id` y reusarlo haría que un
 * Cmd-Z viejo cayera en una toma que no es. El precio es que la toma siguiente
 * puede saltarse un número, que es lo mismo que ya pasa al descartar una.
 *
 * @param {number} [cuanto] `1` para hacer sitio, `-1` para cerrar el hueco
 * @returns {Array<{de:number, a:number}>} qué número pasó a ser cuál
 */
function correrNumeros(estado, desde, cuanto) {
    const salto = cuanto == null ? 1 : cuanto;
    const movidas = (estado.tomas || [])
        .filter(t => t.id >= desde)
        .sort((a, b) => (salto > 0 ? b.id - a.id : a.id - b.id));
    const mapa = [];
    for (const t of movidas) {
        mapa.push({ de: t.id, a: t.id + salto });
        t.id += salto;
    }
    alDia(estado);
    return mapa;
}

/**
 * La toma de antes: la más cercana que termina antes de que esta empiece.
 *
 * **Las descartadas no cuentan.** Descartar es sacar la toma del XML, así que
 * el tramo que ocupaba queda libre de verdad: es justamente lo que se hace
 * cuando una toma salió mal y hay que rehacerla desde más atrás. En la pantalla
 * eso se llama «desactivada», y es el mismo campo (`descartada`): una sola cosa,
 * un solo nombre acá.
 *
 * Se elige por el OUT más grande y no por el orden de la lista, porque los
 * bordes se mueven a mano: después de arrastrar dos INs, el orden en que se
 * abrieron ya no es el orden en el tiempo.
 */
function tomaAnterior(tomas, toma) {
    let previa = null;
    for (const t of tomas || []) {
        if (t === toma || t.id === toma.id || t.descartada) continue;
        if (t.outMs == null || t.inMs == null || t.inMs >= toma.inMs) continue;
        if (!previa || t.outMs > previa.outMs) previa = t;
    }
    return previa;
}

/**
 * Desde dónde las palabras sueltas son «de nadie».
 *
 * El OUT de la última toma cerrada: lo anterior ya es texto de una toma, y
 * meterlo en una toma nueva sería escribir la misma frase dos veces en el XML.
 *
 * Es el piso que hacía falta para poder dejar de vaciar el colchón cuando el
 * conteo abre una toma (ver `aplicarSenales`), que es lo que hacía desaparecer
 * de la pantalla todo lo hablado entre dos tomas.
 */
function pisoDeLasSueltas(estado) {
    const cerradas = (estado.tomas || []).filter(t => t.outMs != null && !t.descartada);
    return cerradas.length ? Math.max(...cerradas.map(t => t.outMs)) : -Infinity;
}

/**
 * La toma viva que se solapa con esta, si hay alguna.
 *
 * Dos tomas vivas no se pisan nunca: es lo que hace que una palabra sea de una
 * sola y que el XML no tenga dos clips encimados. Lo mantienen `moverBorde`
 * —con su piso y su techo—, `abrirToma` y el conteo; esto es para el gesto que
 * puede romperlo por la puerta de atrás, que es volver a activar una toma
 * desactivada sobre cuyo tramo ya nació otra (ver `descartar` en `cambios-toma`).
 */
function laQuePisa(tomas, toma) {
    if (!toma || toma.inMs == null) return null;
    const fin = toma.outMs == null ? Infinity : toma.outMs;
    return (tomas || []).find(t => {
        if (t === toma || t.id === toma.id || t.descartada || t.inMs == null) return false;
        // Caber es dos cosas: no solaparse, y quedar del lado que dice su
        // número. Mientras estuvo desactivada, un IN pudo cruzarla entera —su
        // tramo estaba libre—, y una toma 2 que vuelve a contar por detrás de
        // la 1 no pisa a nadie pero deja el XML con los nombres al revés.
        if (t.id < toma.id) return t.outMs == null || t.outMs > toma.inMs;
        return t.inMs < fin;
    }) || null;
}

/**
 * Hasta dónde puede retroceder el IN de una toma: el OUT de la de antes.
 *
 * El editor, después de la clase del 30/09: «No debería poder colocar un In
 * antes del OUT de la toma anterior. Esto si sucede, solo parece que se demora
 * en cargar lo anterior. Cuando pues es un espacio compartido.» Tenía razón en
 * las dos mitades: el texto de la toma de antes ya está escrito y ahora se ve
 * (ver `antesDeLaAbierta` en grabar/alrededor-de-la-toma.js), y por eso mismo el IN no puede
 * meterse ahí — las dos tomas se quedarían con las mismas palabras y el XML
 * tendría dos bloques pisados sobre el mismo tramo de clase.
 *
 * **El OUT es exclusivo en toda la app** (`repartir`), así que un IN puesto
 * justo EN el OUT de la de antes es legal: se tocan y no se pisan. El piso es
 * un mínimo, no una prohibición.
 *
 * Esta es la última palabra sobre la regla. La ventana la dibuja —el arrastre se
 * frena en la marca y el menú del clic derecho no ofrece el IN más atrás—, pero
 * el motor no le cree: cada camino que mueve un IN pasa por acá.
 *
 * @returns {number|null} el ms mínimo, o `null` si no hay toma antes
 */
function pisoDelIn(tomas, toma) {
    const previa = toma && toma.inMs != null ? tomaAnterior(tomas, toma) : null;
    return previa ? previa.outMs : null;
}

/**
 * Hasta dónde puede avanzar el OUT de una toma: el IN de la de después.
 *
 * Es `pisoDelIn` visto del otro lado, con las mismas reglas: las descartadas no
 * cuentan, y tocarse vale (el OUT es exclusivo, así que un OUT en el IN de la
 * siguiente no le quita ninguna palabra).
 *
 * @returns {number|null} el ms máximo, o `null` si no hay toma después
 */
function techoDelOut(tomas, toma) {
    if (!toma || toma.inMs == null) return null;
    let siguiente = null;
    for (const t of tomas || []) {
        if (t === toma || t.id === toma.id || t.descartada || t.inMs == null) continue;
        if (t.inMs <= toma.inMs) continue;
        if (!siguiente || t.inMs < siguiente.inMs) siguiente = t;
    }
    return siguiente ? siguiente.inMs : null;
}

/**
 * Corre el IN de la toma que está ABIERTA.
 *
 * Es otro caso que el de una toma cerrada, y por eso va aparte de `moverBorde`:
 * una toma abierta todavía no se releyó, así que no tiene orillas guardadas
 * —las palabras de antes de su IN están en `sueltas`, sin dueño— y moverle el
 * IN es pasar palabras de una lista a la otra. Hacia atrás, las sueltas que
 * quedan adentro pasan a ser de la toma; hacia adelante, las de la toma que
 * quedan afuera vuelven a estar sueltas, y un "abrir a mano" posterior puede
 * volver a encontrarlas.
 *
 * Se frena en el OUT de la toma anterior (`pisoDelIn`), como el arrastre se
 * frena en el otro borde: no explota ni ignora el gesto, lo deja en el límite.
 *
 * @returns {boolean} si se movió
 */
function moverInAbierta(estado, toma, ms) {
    if (!toma || toma.outMs != null || !Number.isFinite(ms)) return false;
    const piso = pisoDelIn(estado.tomas, toma);
    const donde = piso != null ? Math.max(ms, piso) : ms;
    if (donde === toma.inMs) return false;
    const todas = juntas(estado.sueltas, toma.palabras);
    toma.inMs = donde;
    delete toma.finDelConteoMs;
    toma.palabras = todas.filter(w => w.t >= donde);
    estado.sueltas = todas.filter(w => w.t < donde);
    // El gris de antes del IN también se corre: una toma reabierta conserva el
    // `antes` de su relectura, y con el IN hacia atrás esas palabras quedaban
    // a los dos lados de la línea —grises y a la vez dentro de la toma—.
    if (toma.antes) toma.antes = toma.antes.filter(w => w.t < donde);
    return true;
}

/**
 * Cierra la toma abierta en una palabra concreta, y no en la última.
 *
 * Es el gesto de arrastrar el OUT hacia atrás sobre el texto de la toma que
 * está corriendo: el profesor dijo "Pausa" tarde, o siguió hablando de otra
 * cosa, y el final bueno es una palabra de antes. El OUT cae en el arranque de
 * esa palabra —exclusivo, como en todo lo demás (`repartir`)— y lo que quedó
 * después pasa a ser la orilla de la toma y, además, palabras sueltas: se
 * dijeron sin toma, y el próximo "abrir a mano" tiene que poder encontrarlas.
 *
 * @returns {boolean} si se cerró
 */
function cerrarEn(estado, toma, ms) {
    if (!toma || toma.outMs != null || !Number.isFinite(ms) || ms <= toma.inMs) return false;
    const afuera = (toma.palabras || []).filter(w => w.t >= ms);
    toma.palabras = (toma.palabras || []).filter(w => w.t < ms);
    toma.despues = afuera;
    toma.outMs = ms;
    estado.sueltas = juntas(estado.sueltas, afuera);
    return true;
}

/**
 * Dónde termina una toma que se cierra ahora: el FINAL de su última palabra.
 *
 * Es una función porque son tres los sitios que cierran —"Pausa", el botón y
 * "Terminar"— y cuando cada uno hacía la cuenta a su manera, uno usaba el
 * arranque de la palabra: la toma que el profesor olvidó cerrar perdía su última
 * palabra en el XML. Si no dijo ninguna, termina donde diga quien llama.
 */
function finDeToma(toma, siNoDijoNada) {
    const palabras = toma.palabras || [];
    // La que termina más tarde, no la última de la lista: la lista admite la
    // deriva de Whisper en el orden (`DERIVA_DEL_CICLO_MS`), y con una palabra
    // tardía al final el OUT caía ENCIMA de otra —misma hora que su `t`—, que
    // por el OUT exclusivo quedaba fuera de la toma.
    //
    // Y una palabra sin final termina DESPUÉS de empezar. Las del sidecar
    // venían sin `hasta`, así que en una clase reanudada el OUT caía en el
    // `t` de la última palabra y esa palabra quedaba fuera de su propia toma.
    const fin = palabras.length
        ? palabras.reduce((m, w) => Math.max(m, w.hasta != null ? w.hasta : w.t + 1), -Infinity)
        : siNoDijoNada;
    // Nunca antes del IN: una toma abierta a mano durante el atraso del ciclo
    // podía tener palabras de antes de su IN y cerrar con el OUT más atrás
    // que el IN, que igual llegaba al XML.
    return toma.inMs != null ? Math.max(fin, toma.inMs + DURACION_MINIMA_MS) : fin;
}

/** Lo más corto que puede durar una toma, para que el OUT no caiga sobre el IN. */
const DURACION_MINIMA_MS = 100;

/**
 * Cierra en `ms` —donde llegó el audio— y deja anotado que es provisional: la
 * relectura, que oye la toma entera con el modelo grande, lo acerca a la última
 * palabra (ver `relecturas.js`).
 */
function cerrarProvisional(toma, ms) {
    toma.outMs = Math.max(Number(ms) || 0, finDeToma(toma, ms));
    toma.outProvisional = true;
}

/**
 * Una lectura con orillas, repartida por los bordes de la toma.
 *
 * Lo que se lee al cerrar una toma es un poco más ancho que la toma: unos segundos
 * de cada lado, para que el editor pueda mover un borde viendo la frase que quedó
 * afuera (ver `ORILLA_MS` en `grabacion.js`). Acá se decide qué es de la toma y qué
 * es orilla, que es la misma frontera que mueve `moverBorde` y por eso vive al lado.
 *
 * El OUT es exclusivo, como en todo lo demás: una palabra que empieza justo en el
 * OUT ya no es de la toma. Lo que queda en `palabras` es exactamente lo que había
 * antes de que existieran las orillas —lo que va al XML y lo que se compara para
 * ver si una toma repite a otra—, así que nada de lo que se escribe cambia.
 *
 * **Una toma abierta no tiene orilla derecha**, y hay que decirlo aparte: sin OUT
 * no hay frontera por la derecha, así que todo lo que se dijo desde el IN es de
 * la toma. Comparar contra `null` no da eso sino lo contrario —`w.t < null` es
 * falso para cualquier hora—, y el texto entero se le iba a `despues`: al partir
 * una toma abierta, la mitad que sigue grabando aparecía vacía.
 *
 * **Y sale en orden de tiempo, venga como venga.** Quien reparte suele juntar
 * tres listas —`antes`, `palabras`, `despues`— y a veces una cuarta, las sueltas
 * que un OUT corrido hacia adelante acaba de tragar. Pegadas una detrás de otra
 * no están en orden: con el OUT en 3 y las sueltas en 5, correrlo a 6 dejaba
 * [1, 2, 5, 3, 4]. Y el orden no es estética: `senales` apunta a las palabras
 * por índice y la ventana dibuja de corrido.
 *
 * **Y sin repetidas.** Las cuatro listas se solapan a propósito: la orilla
 * `despues` de la relectura y las sueltas del ciclo cubren el mismo tramo, así
 * que correr el OUT hacia adelante traía la misma palabra por los dos lados y
 * la toma la escribía dos veces. Misma hora y mismo texto es la misma palabra
 * (`juntas`). Las dos cosas las encontró el martillo (`tests/martillo.test.js`).
 */
function repartir(palabras, toma) {
    const lista = juntas(palabras, []);
    const hasta = toma.outMs == null ? Infinity : toma.outMs;
    return {
        antes: lista.filter(w => w.t < toma.inMs),
        palabras: lista.filter(w => w.t >= toma.inMs && w.t < hasta),
        despues: lista.filter(w => w.t >= hasta)
    };
}

/**
 * Mueve un borde a la hora de una palabra.
 *
 * Son las dos líneas del texto —la azul del IN y la roja del OUT— arrastradas
 * hasta el hueco entre dos palabras, y el clic derecho ("cortar el OUT acá") para
 * los saltos largos. Hace falta porque se retoma muchas veces con lo último que se
 * dijo, así que el final bueno es una palabra concreta y no el momento en que
 * alguien dijo "Pausa".
 *
 * El IN se frena además en el OUT de la toma anterior, si le pasan las tomas
 * para saber cuál es (`pisoDelIn`). Sin ellas no se frena, y eso es a propósito:
 * hay un solo camino que mueve el IN de una toma cerrada y le pasa las tomas
 * —lo comprueba `tomas-que-no-se-pisan.test.js`—, así que si mañana aparece otro
 * la prueba se pone roja en vez de dejar pasar un borde pisado.
 *
 * Y el OUT, por lo mismo del otro lado, se frena en el IN de la toma siguiente
 * (`techoDelOut`): un OUT corrido adentro de la que viene pisa las mismas
 * palabras que un IN corrido adentro de la de antes.
 *
 * @param {Array} [tomas] las de la sesión, para saber dónde están las vecinas
 * @returns {boolean} si se pudo mover
 */
/**
 * Cuánto antes del IN puede caer la primera palabra detrás del conteo.
 *
 * El IN del conteo cae en esa palabra con la hora del ciclo, y el modelo grande
 * la escribe con la suya: en las clases de octubre, la mitad de las que se
 * corrieron lo hizo menos de 30 ms y nueve de cada diez menos de medio segundo.
 * Repartidas por el IN viejo, quedaban en `antes`, y una toma de cada cinco
 * empezaba sin su primera palabra. Más lejos que esto ya no es la misma palabra
 * corrida sino algo que el ciclo no oyó, y el IN no se toca.
 */
const HOLGURA_DEL_CONTEO_MS = 600;

const comoPalabra = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Dónde cae el IN del conteo con las horas de la relectura, o null si no se mueve.
 *
 * La primera palabra después del final del «1» que no sea el «1» mismo, si cae
 * antes del IN y dentro de `HOLGURA_DEL_CONTEO_MS`. Solo para una toma que abrió
 * un conteo y cuyo IN nadie movió (`finDelConteoMs`).
 */
function inTrasElConteo(toma) {
    if (!toma || toma.finDelConteoMs == null) return null;
    const cuenta = String(toma.cuenta || '').trim().split(/\s+/);
    const uno = comoPalabra(cuenta[cuenta.length - 1]);
    const primera = (toma.antes || []).concat(toma.palabras || [])
        .find(w => w.t >= toma.finDelConteoMs && comoPalabra(w.texto) !== uno);
    if (!primera || primera.t >= toma.inMs || toma.inMs - primera.t > HOLGURA_DEL_CONTEO_MS) return null;
    return primera.t;
}

function moverBorde(toma, cual, paredMs, tomas) {
    // Finito, no solo distinto de null: un NaN pasaba las dos comparaciones de
    // abajo —las dos dan falso— y terminaba ESCRITO en el borde. Una toma con
    // el IN en NaN no está en ninguna parte: no se dibuja, no se relee, no se
    // reparte y el XML sale con un clip sin principio.
    if (!toma || !Number.isFinite(paredMs)) return false;
    if (cual === 'in') {
        if (toma.outMs != null && paredMs >= toma.outMs) return false;
        const piso = tomas ? pisoDelIn(tomas, toma) : null;
        const donde = piso != null ? Math.max(paredMs, piso) : paredMs;
        if (donde === toma.inMs || (toma.outMs != null && donde >= toma.outMs)) return false;
        toma.inMs = donde;
        // Un IN puesto a mano ya no es el del conteo, y la relectura no lo
        // vuelve a acercar a ninguna palabra (`inTrasElConteo`).
        delete toma.finDelConteoMs;
        return true;
    }
    if (toma.inMs != null && paredMs <= toma.inMs) return false;
    const techo = tomas ? techoDelOut(tomas, toma) : null;
    const donde = techo != null ? Math.min(paredMs, techo) : paredMs;
    if (donde === toma.outMs || (toma.inMs != null && donde <= toma.inMs)) return false;
    toma.outMs = donde;
    // Un OUT puesto a mano no es provisional. El del botón sí —cae donde llegó
    // el audio y la relectura lo acerca a la última palabra—, pero si el editor
    // lo arrastró antes de que la relectura llegara, la marca seguía puesta y
    // la relectura le movía el borde que acababa de elegir. Lo encontró el
    // martillo deshaciendo y rehaciendo (`tests/martillo.test.js`).
    delete toma.outProvisional;
    return true;
}

module.exports = {
    estadoNuevo,
    tomasQueQuedan,
    tomaAbierta,
    alDia,
    nuevaToma,
    HUECO_DE_TIRADA_SEC,
    RETROCESO_MAX_SEC,
    VENTANA_DE_SUELTAS_SEC,
    MARGEN_DE_SUELTAS_SEC,
    FRESCURA_MAX_SEC,
    arranqueDeLaTirada,
    abrirToma,
    dividir,
    correrNumeros,
    tomaAnterior,
    pisoDeLasSueltas,
    laQuePisa,
    pisoDelIn,
    techoDelOut,
    moverInAbierta,
    cerrarEn,
    finDeToma,
    DURACION_MINIMA_MS,
    cerrarProvisional,
    repartir,
    moverBorde,
    HOLGURA_DEL_CONTEO_MS,
    inTrasElConteo
};
