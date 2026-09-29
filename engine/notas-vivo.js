'use strict';
/**
 * notas-vivo.js — Las notas de rodaje, mientras la clase se está grabando.
 *
 * El profesor dice "3, 2, 1" y la toma se abre, dice "Pausa" y se cierra, y dice
 * "claqueta" (o aplaude) y queda una marca de sincronía. De eso sale el XML que
 * el editor importa en Premiere (`notas-xml.js`).
 *
 * **Una sesión es una clase entera, grabada de corrido.** No hay "parar y
 * seguir": la clase dura lo que dure y de ella sale UN XML, con todas las tomas
 * y todas las claquetas adentro. Eso es lo que hace que los tiempos cierren en
 * el total, que es lo único que el editor no puede arreglar después.
 *
 * **Todo va con la HORA DEL DÍA en milisegundos.** Es lo que permite que el
 * reloj de la app y el del audio sean el mismo: las palabras y los golpes se
 * estampan por su posición en el WAV (`oir.aHoraDelDia`, `grabacion.pcm`), no
 * por cuándo la app se enteró. Pasarlo a los cuadros que entiende Premiere es
 * trabajo de `notas-xml.js`, que es lo único que conoce el formato.
 *
 * **La latencia no perjudica la precisión**, y es lo que hace que todo esto
 * funcione. Cuando el profesor dice "Pausa", el OUT no se pone donde la
 * herramienta se dio cuenta: se pone en el timecode de esa palabra, que Whisper
 * devuelve junto con el texto. Un segundo de demora en enterarse no mueve el
 * corte ni un cuadro, y en una clase de tres horas eso es la diferencia entre
 * unas notas que sirven para cortar y unas que hay que volver a mirar.
 *
 * **Sin estado y sin DOM**: todo lo de acá se prueba solo (`tests/notas-vivo.test.js`).
 * Los números que deciden —cuántos segundos de silencio confirman un "Pausa",
 * cuánto tienen que parecerse dos arranques, cuándo dos claquetas son la misma—
 * salen de medir clases reales con `tools/simular-grabacion.js`, no de estimarlos.
 */

const { norm } = require('./texto');

/**
 * Las dos fuentes que graba el Rodecaster, en el orden en que las numera.
 *
 * Son índices y no nombres porque es lo que el resto de la cadena maneja: el
 * plan de cortes elige la cámara por número (`cameraIndex`), el XML le pone a
 * cada fuente la etiqueta de color que le toca por posición (`CLIP_LABELS` en
 * `fcp-xml.js`) y el reproductor monta un `<video>` por índice. El orden es
 * estable clase a clase porque el aparato numera siempre igual.
 */
const CAMARA = 0;
const PANTALLA = 1;

/**
 * Las vistas que se pueden elegir: con qué se ve cada una y de qué color va.
 *
 * `colorDeMarcador` es el entero nativo de Premiere (`pproColor`) y es lo que
 * se escribe en el XML. Sale de un XML de verdad del director de contenido, no
 * de elegirlo: si acá se escribiera otro, el mismo tipo de toma llegaría a la
 * secuencia de un color distinto según quién tomó las notas.
 *
 * **Es también el color con el que la pantalla pinta la toma**, y no hay un
 * segundo color para eso. Class Cut sí tenía uno (`colorEnLaApp`) porque allá
 * la lista de tomas convivía con un reproductor que ya usaba esos colores para
 * otra cosa. Note Taker no tiene reproductor, y dos colores para lo mismo solo
 * lograban que el profesor se viera azul mientras se grababa y llegara rojo a
 * Premiere. Cómo se pinta sin perder contraste está en `src/js/colores.js`.
 *
 * `fuente` es con qué se ve cada vista en Class Cut (cámara o pantalla). Acá no
 * se usa para nada más que el `viewMap`, y se queda para que un XML hecho con
 * Note Taker se abra en Class Cut sin traducir nada.
 */
const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor', fuente: CAMARA, colorDeMarcador: 4281740498 },
    { nombre: 'R', titulo: 'Pantalla', fuente: PANTALLA, colorDeMarcador: 4280578025 },
    { nombre: 'S', titulo: 'Slides', fuente: PANTALLA, colorDeMarcador: 4281828977 },
    { nombre: 'MG', titulo: 'Multi', fuente: PANTALLA, colorDeMarcador: 4292277273 },
    { nombre: 'X2', titulo: 'Doble', fuente: PANTALLA, colorDeMarcador: 4289825711 }
];

const VISTA_POR_DEFECTO = 'PV';

/** Nombre de vista → con qué fuente se ve. Es el `viewMap` de todo el pipeline. */
const MAPA_DE_VISTAS = Object.fromEntries(VISTAS.map(v => [v.nombre, v.fuente]));

/**
 * Nombres de vista que ya no se ofrecen pero que hay que seguir entendiendo.
 *
 * `SL` y `SR` eran las slides encuadradas a izquierda y a derecha, y llegaban a
 * la secuencia del mismo verde porque son la misma fuente: la distinción era de
 * encuadre y no de material, así que en el corte no cambiaba nada. Ahora son una
 * sola, `S`.
 *
 * Dejar de ofrecerlas no es lo mismo que dejar de entenderlas, y hay dos sitios
 * donde siguen llegando: las clases que ya se grabaron las tienen escritas en su
 * sidecar y en su XML, y el XML que entra de afuera trae el nombre que el
 * director de contenido le puso al marcador, que puede ser cualquiera de los que
 * la herramienta ofrecía el día que tomó esas notas. Si no se tradujeran, esas
 * tomas quedarían con una vista que no existe: el selector no marcaría ninguna,
 * el color caería al de `PV` y el mapeo las mandaría a la cámara equivocada.
 */
const VISTAS_RENOMBRADAS = { SL: 'S', SR: 'S' };

/**
 * El nombre de hoy de una vista que se acaba de leer de un archivo.
 *
 * Se traduce al LEER y no se reescribe el disco al pasar: un camino de lectura
 * que escribe es lo que vuelve irreproducible el próximo error, y además una
 * clase se lista sin que nadie la haya pedido. Igual el archivo se cura solo, y
 * en el primer gesto: cada cambio sobre una clase grabada reescribe el sidecar y
 * el XML enteros desde el estado ya traducido (`editarGrabada` en
 * `grabacion.js`), así que la primera vez que alguien la toca queda con `S`.
 */
function vistaLeida(nombre) {
    const n = limpio(nombre);
    return VISTAS_RENOMBRADAS[n] || n;
}

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
        // El momento de "Iniciar grabación", del que cuelgan los cuadros del XML.
        ceroMs: p.ceroMs != null ? p.ceroMs : null,
        // A cuántos cuadros va la secuencia del editor. Se congela al arrancar y
        // viaja en el estado en vez de leerse de Ajustes al escribir el XML:
        // cambiarlo a mitad de una clase de tres horas movería todos los
        // marcadores que ya se habían escrito, y el editor ya sincronizó contra
        // ellos. Cambiar el fps es empezar otra sesión.
        fps: p.fps || 30,
        idioma: p.idioma || 'es',
        dispositivo: p.dispositivo || null,
        /**
         * Las claquetas, en orden y todas.
         *
         * Son una lista y no un campo porque en una clase en vivo se claquetea
         * varias veces: el editor sincroniza a mano y correlaciona la primera
         * para saber si hay uno o varios archivos en Premiere, y las demás le
         * sirven de control cada vez que una cámara se cortó y volvió.
         *
         * Cada una: `{ n, ms, paredMs, frase, confirmada, origen }`. `n` es su
         * número, que es con el que se la nombra en el XML y en la pantalla;
         * `ms` es su hora en el reloj del audio y `paredMs` la del reloj de
         * pared, que se guarda para poder emparejarla con la fecha de creación
         * de un archivo de cámara.
         */
        claquetas: [],
        proximaClaqueta: 0,
        // Los archivos de audio que la sesión fue cerrando. Una sesión puede
        // tener más de uno: si el dispositivo se cae y se reabre, el WAV nuevo
        // entra como otro clip en su offset (`captura.laQueContiene`).
        sesiones: [],
        tomas: [],
        proximaToma: 0,
        /**
         * Lo que se oyó SIN una toma abierta, de los últimos treinta segundos.
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
 * Las palabras con las que el profesor abre y cierra.
 *
 * El conteo no se busca con la expresión de `rodecaster-xml.COUNT_RUN` porque esa
 * está anclada al principio de un comentario ya escrito; acá hay que encontrarlo
 * en el medio de un río de palabras. Tampoco con `speech-edges.conteosEn`, que
 * también busca conteos sueltos, porque en vivo hacen falta dos cosas que en post
 * no: que la cuenta TERMINE en uno (ver `senales`) y tolerar los puntos
 * suspensivos con que Whisper cierra un "1...". Lo que se busca es lo mismo: dos
 * o más números seguidos hacia abajo, que es lo que nadie dice por casualidad.
 *
 * La puntuación de atrás no cuenta, y va con `*` y no con `?` porque Whisper
 * escribe puntos suspensivos: en el curso salió "3, 2, 1..." y con un solo signo
 * permitido el "1..." no era un número, el conteo se quedaba en "3, 2" y la toma
 * no se abría. Lo encontró la simulación sobre el audio de verdad.
 */
const CUENTA = /^(?:3|2|1|tres|dos|uno)[.,…!?]*$/i;
const RETOMAR = /^retomamos[.,…!?]*$/i;
const PAUSA = /^pausa[.,…!?]*$/i;
/** "Ok" delante del conteo es parte de la señal, no de la clase. */
const OK = /^ok[.,…!?]*$/i;

/**
 * La claqueta, dicha.
 *
 * Es la tercera puerta por la que entra una claqueta, y existe porque el
 * aplauso puede no llegar: el audio de una reunión de Zoom pasa por compresión,
 * cancelación de eco y control automático de ganancia, y las tres cosas
 * aplastan justo lo que `golpe.js` busca —un pico corto y muy por encima del
 * fondo—. Con la clase en vivo entrando por un dispositivo virtual, confiar
 * solo en el pico es confiar en que el procesamiento de otro programa deje
 * pasar un transitorio.
 *
 * El pedazo del medio y no la palabra entera, con el mismo motivo que en la
 * confirmación del golpe: Whisper no conoce la palabra y la escribió
 * "Claqueta", "Claquetados", "Cacleta", "Klaqueta" y hasta "clasedos" pegando
 * "clase dos". Se pide de cinco letras para arriba para que no la dispare
 * cualquier sílaba suelta.
 */
const CLAQUETA = /claque|cacle|klaque/i;

/** Cuántos números seguidos hacen una cuenta. Uno solo es habla. */
const MINIMO_DE_CUENTA = 2;

/** Cuánto vale cada palabra de la cuenta, para saber si va hacia abajo. */
const VALOR = { 3: 3, tres: 3, 2: 2, dos: 2, 1: 1, uno: 1 };

function valorDeCuenta(texto) {
    const limpia = String(texto).toLowerCase().replace(/[.,…!?]+$/, '');
    return VALOR[limpia];
}

/**
 * Dos señales del mismo tipo más cerca que esto son la misma señal oída dos veces.
 *
 * El ciclo de señales escucha ventanas que se solapan, así que un conteo que caiga
 * en el borde aparece en dos pasadas seguidas — eso es a propósito, es lo que
 * evita perderlo partido. Lo que hace falta es no abrir dos tomas con él, y no se
 * puede comparar el tiempo exacto porque Whisper no devuelve el mismo número en
 * las dos pasadas (unas décimas de diferencia). Dos segundos separan de sobra dos
 * conteos de verdad: entre uno y el siguiente hay una toma entera.
 */
const MISMA_SENAL_MS = 2000;

/**
 * Cuánto silencio tiene que seguir a "Pausa" para creerle.
 *
 * El profesor puede decir "pausa" hablando de otra cosa —"acá hacemos una pausa
 * en el flujo"— y cerrar la toma ahí partiría la clase al medio. Lo que
 * distingue la señal es que después no se dice nada: el profesor para. Un segundo
 * alcanza y no obliga a esperar.
 */
const SILENCIO_TRAS_PAUSA_SEC = 1;

function limpio(texto) {
    return String(texto == null ? '' : texto).trim();
}

/** El texto de una palabra, sin signos, para comparar contra las señales. */
function palabra(w) {
    return limpio(w && w.texto).replace(/^[¿¡"'(]+/, '');
}

/**
 * Las señales que hay en una tirada de palabras, en orden.
 *
 * Devuelve rangos de índices y no tiempos porque quien decide qué hacer con una
 * señal necesita saber qué palabras la forman: el IN va DESPUÉS de la última
 * palabra del conteo y el OUT ANTES de "Pausa", así que la señal misma nunca
 * queda adentro de la toma. Es lo mismo que el motor hace en post
 * (`speech-edges.trimChatter`), y por las mismas razones.
 *
 * @param {Array} palabras [{t, texto}] con `t` en hora del día (ms)
 * @returns {Array} [{tipo:'abre'|'cierra'|'claqueta', desde:number, hasta:number}]
 */
function senales(palabras, finMs) {
    const lista = palabras || [];
    const salida = [];

    for (let i = 0; i < lista.length; i++) {
        const p = palabra(lista[i]);

        // La claqueta dicha. No abre ni cierra nada —una claqueta no es una
        // toma— así que no corta el recorrido: la misma palabra puede además
        // ser parte de otra cosa, y las palabras de alrededor siguen entrando
        // a la toma que esté abierta si la hay.
        if (CLAQUETA.test(p)) {
            salida.push({ tipo: 'claqueta', desde: i, hasta: i, por: 'voz' });
            continue;
        }

        if (RETOMAR.test(p)) {
            salida.push({ tipo: 'abre', desde: i, hasta: i, por: 'retomamos' });
            continue;
        }

        if (PAUSA.test(p)) {
            // Sin lo que sigue no se puede saber si es la señal o una palabra de
            // la clase: se pide silencio detrás. La última palabra de la tirada
            // se resuelve con el silencio que venga después, así que quien llama
            // decide (ver `cierraDeVerdad`).
            // Desde que TERMINA «pausa», y sin palabra detrás, hasta donde llega
            // lo oído: antes una «pausa» al final de la ventana contaba como
            // silencio infinito, y con medio segundo oído detrás ya cerraba.
            const siguiente = lista[i + 1];
            const finPausa = lista[i].hasta != null ? lista[i].hasta : lista[i].t;
            const hueco = siguiente
                ? (siguiente.t - finPausa) / 1000
                : (finMs != null ? (finMs - finPausa) / 1000 : Infinity);
            if (hueco >= SILENCIO_TRAS_PAUSA_SEC) {
                salida.push({ tipo: 'cierra', desde: i, hasta: i, por: 'pausa' });
            }
            continue;
        }

        // El conteo: se mira si desde acá arranca una tirada de números.
        let j = i;
        if (OK.test(p) && lista[i + 1] && CUENTA.test(palabra(lista[i + 1]))) j = i + 1;
        // La tirada de números, cortada en el PRIMER uno: ahí termina la cuenta.
        // Sin ese corte, una clase que arranca diciendo "uno de los problemas…"
        // se comía su propia primera palabra, porque "uno" también es número.
        let fin = j;
        while (fin < lista.length && CUENTA.test(palabra(lista[fin]))) {
            fin++;
            if (valorDeCuenta(palabra(lista[fin - 1])) === 1) break;
        }

        // Y tiene que terminar en uno, no solo tener dos números: "tenemos uno,
        // dos, tres opciones" es habla, y con la regla de "dos seguidos" abría una
        // toma en medio de la clase. Se pide el final y no que baje monótona
        // porque el falso arranque existe: en el curso real está escrito "3 2 3 2 1.".
        const cierraEnUno = fin > j && valorDeCuenta(palabra(lista[fin - 1])) === 1;
        if (fin - j >= MINIMO_DE_CUENTA && cierraEnUno) {
            salida.push({ tipo: 'abre', desde: i, hasta: fin - 1, por: 'cuenta' });
            i = fin - 1;
        }
    }

    return salida;
}

/**
 * El texto de una señal, tal como va al comentario del marcador.
 *
 * El parser de post busca el conteo justo detrás del separador para saber dónde
 * termina la nota del editor y empieza lo que se dijo, así que el conteo tiene
 * que llegar escrito. Con "Retomamos" no hay conteo y el parser cae en su
 * convención vieja, que también funciona.
 */
function textoDe(palabras, desde, hasta) {
    return (palabras || []).slice(desde, hasta + 1).map(w => limpio(w.texto)).join(' ').trim();
}

/** Cuántas palabras del arranque se citan en el comentario del IN. */
const PALABRAS_DEL_CUE = 8;

/**
 * El cue de una toma: el conteo y las primeras palabras de lo que se dijo.
 *
 * El conteo se escribe con un punto y nada más al final. Viene como lo escribió
 * Whisper, que a veces pone puntos suspensivos ("3, 2, 1..."), y el parser de post
 * come el conteo pero no los signos de sobra: el cue quedaba empezando en ".. Uno,
 * un PROM sirve…". Ese cue es lo que `align.js` busca en el Live-Mix para reanclar
 * el borde, así que conviene que sean palabras y no basura.
 */
function cueDeEntrada(toma) {
    const cuenta = limpio(toma.cuenta).replace(/[.,…!?]+$/, '.');
    const primeras = textoDe(toma.palabras, 0, PALABRAS_DEL_CUE - 1);
    return [cuenta, primeras].filter(Boolean).join(' ').trim();
}

/**
 * El comentario del marcador de entrada: la nota, el separador y lo que se dijo.
 *
 * **El separador va con sus dos espacios y el resultado NO se recorta.** Parece
 * detalle y no lo es: el parser de post busca literalmente " - " para saber dónde
 * termina la nota del director y empieza el habla, y una toma sin nota deja el
 * comentario empezando en " - 3, 2, 1…". Recortarlo lo dejaba en "- 3, 2, 1…",
 * sin separador que encontrar, y de ahí en adelante el conteo pasaba a ser parte
 * del cue: `hasCount` en falso y el motor de cortes sin saber dónde arranca la
 * clase. Salió en la simulación —las once tomas de una clase entera con
 * `conteo:false`— porque las pruebas de antes usaban una toma CON nota, que es el
 * caso raro. La herramienta del director escribe " - " igual, con su espacio.
 */
function comentarioDeEntrada(toma) {
    return `${limpio(toma.comentario)} - ${cueDeEntrada(toma)}`;
}

/** El cue de salida: las últimas palabras dichas, que es lo que el CD escribe. */
function cueDeSalida(toma) {
    const palabras = toma.palabras || [];
    const desde = Math.max(0, palabras.length - PALABRAS_DEL_CUE);
    return textoDe(palabras, desde, palabras.length - 1);
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
 * Una toma nueva, con la forma entera declarada en un solo sitio.
 *
 * La arman los dos caminos que abren —el conteo hablado y el botón— y por eso
 * está acá: con la forma escrita dos veces, un campo que se agregue de un lado
 * deja tomas a las que les falta del otro, y eso no se ve hasta que algo lee el
 * campo que no está.
 */
function nuevaToma(estado, inMs, cuenta) {
    return {
        id: (estado.proximaToma = estado.proximaToma + 1),
        vista: VISTA_POR_DEFECTO,
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
 * Cuánto se guarda en el colchón de palabras sueltas.
 *
 * Treinta segundos: el tope de retroceso más un margen, que es todo lo que
 * `abrirToma` puede llegar a mirar. Guardar más sería guardar para nada.
 */
const VENTANA_DE_SUELTAS_SEC = 30;

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

    const sueltas = estado.sueltas || [];
    const desde = o.exacto
        ? sueltas.findIndex(w => w.t >= ms)
        : arranqueDeLaTirada(sueltas, ms);
    const inMs = (o.exacto || desde === -1) ? ms : sueltas[desde].t;

    const toma = nuevaToma(estado, inMs, '');
    if (desde !== -1) {
        // Las palabras de la tirada dejan de ser de nadie y pasan a ser de la
        // toma. Se sacan del colchón: dejarlas ahí las mostraría dos veces
        // —adentro de la toma y como sueltas— y la toma siguiente podría
        // volver a absorberlas.
        toma.palabras = sueltas.slice(desde);
        estado.sueltas = sueltas.slice(0, desde);
    }
    estado.tomas.push(toma);
    const desdeCuando = o.ahoraMs != null ? o.ahoraMs : ms;
    return { toma, retrocedioSec: Math.max(0, Math.round((desdeCuando - inMs) / 100) / 10) };
}

/** Las dos listas juntas, en orden y sin repetir lo que esté en las dos. */
function juntas(a, b) {
    const vistas = new Set();
    return (a || []).concat(b || [])
        .filter(w => {
            const clave = `${w.t}|${w.texto}`;
            if (vistas.has(clave)) return false;
            vistas.add(clave);
            return true;
        })
        .sort((x, y) => x.t - y.t);
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
 * @returns {boolean} si se movió
 */
function moverInAbierta(estado, toma, ms) {
    if (!toma || toma.outMs != null || !Number.isFinite(ms)) return false;
    const todas = juntas(estado.sueltas, toma.palabras);
    toma.inMs = ms;
    toma.palabras = todas.filter(w => w.t >= ms);
    estado.sueltas = todas.filter(w => w.t < ms);
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
    const ultima = palabras[palabras.length - 1];
    const fin = ultima ? (ultima.hasta || ultima.t) : siNoDijoNada;
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

/* ─── Las claquetas ──────────────────────────────────────────────────────
 *
 * En una clase en vivo se claquetea varias veces, así que acá no se elige UNA:
 * se mantiene la lista. Lo único que hay que resolver es que la misma claqueta
 * no entre dos veces, y eso pasa seguido porque llega por tres puertas a la vez:
 * el aplauso que oye `golpe.js` en el PCM, la palabra "claqueta" que oye el
 * ciclo de señales, y el editor que aprieta la tecla.
 */

/**
 * Cuánto tienen que separarse dos claquetas para ser dos y no la misma.
 *
 * Cinco segundos. Por abajo, las tres puertas llegan dentro de ese margen: el
 * editor aprieta la tecla mientras la escucha, el aplauso suena mientras se dice
 * "claqueta 3", y el ciclo de señales confirma el golpe leyendo cuatro segundos
 * a cada lado (`MARGEN_CLAQUETA_MS` en `grabacion.js`). Por arriba, dos
 * claquetas de verdad nunca están tan cerca: entre una y la siguiente hay una
 * toma, o por lo menos el tiempo de reacomodar una cámara.
 */
const MISMA_CLAQUETA_MS = 5000;

/**
 * Cuál de dos orígenes manda para cada cosa.
 *
 * No es "gana uno entero", porque cada puerta sabe algo distinto y ninguna sabe
 * todo:
 *
 * - **El `ms` lo pone el golpe.** Es un pico en la onda, medido sobre la
 *   posición en el WAV: cae exactamente donde suena. Lo que diga el editor está
 *   a su tiempo de reacción, y lo que diga la voz está al arranque de una
 *   palabra que se dijo antes o después del aplauso.
 * - **La frase la pone la voz.** El golpe no sabe qué se dijo; el número de la
 *   claqueta ("claqueta 3, clase 3") solo aparece en el texto, y es lo que deja
 *   emparejarla con lo que el editor escribió en la pizarra.
 * - **`confirmada` es un o-lógico.** Cada puerta confirma por su cuenta: el
 *   editor por haber estado mirando, la voz por haber dicho la palabra, el golpe
 *   por las dos cosas juntas. Que una no confirme no desconfirma a la otra.
 */
function fundir(vieja, nueva) {
    const deGolpe = nueva.origen === 'golpe' ? nueva : (vieja.origen === 'golpe' ? vieja : null);
    return {
        ...vieja,
        ms: deGolpe ? deGolpe.ms : Math.min(vieja.ms, nueva.ms),
        paredMs: deGolpe ? deGolpe.paredMs : (vieja.paredMs || nueva.paredMs),
        frase: limpio(nueva.frase) || limpio(vieja.frase),
        confirmada: Boolean(vieja.confirmada || nueva.confirmada),
        // Los dos, separados por coma, porque saberlo cambia cuánto se le cree:
        // una claqueta que solo vio el editor no tiene aplauso con el que
        // alinear la onda, y una que solo oyó la voz tampoco.
        origen: vieja.origen === nueva.origen
            ? vieja.origen
            : [...new Set(vieja.origen.split(',').concat(nueva.origen))].sort().join(',')
    };
}

/**
 * Anota una claqueta, fundiéndola con la que ya esté a menos de cinco segundos.
 *
 * Devuelve la que quedó en la lista y si fue nueva, que es lo que quien llama
 * necesita para no avisar dos veces de la misma (`grabacion.js`).
 *
 * La lista se mantiene ORDENADA por `ms` y se renumera después de cada cambio:
 * `n` es el número con el que la claqueta se nombra en el XML y en la pantalla,
 * y tiene que decir el orden en que sonaron, no el orden en que la app se enteró.
 * Un golpe cuyo texto tarda tres segundos en leerse puede entrar después de uno
 * posterior.
 *
 * @param {object} estado el de la sesión, se muta
 * @param {object} claqueta { ms, paredMs, frase, confirmada, origen }
 * @returns {{claqueta: object, nueva: boolean}}
 */
function anotarClaqueta(estado, claqueta) {
    const lista = estado.claquetas || (estado.claquetas = []);
    // Una que el editor quitó a mano no vuelve sola: la relectura la volvía a
    // encontrar doce segundos después (`releerOrillas`) y renumeraba las de
    // atrás. Solo la puede volver a poner él (o su Cmd-Z).
    if ((claqueta.origen || 'editor') !== 'editor' &&
        (estado.claquetasQuitadas || []).some(ms => Math.abs(ms - Number(claqueta.ms)) < MISMA_CLAQUETA_MS)) {
        return { claqueta: null, nueva: false, quitada: true };
    }
    const entra = {
        ms: Number(claqueta.ms),
        paredMs: claqueta.paredMs != null ? Number(claqueta.paredMs) : null,
        frase: limpio(claqueta.frase),
        confirmada: Boolean(claqueta.confirmada),
        origen: claqueta.origen || 'editor'
    };

    const cerca = lista.find(c => Math.abs(c.ms - entra.ms) < MISMA_CLAQUETA_MS);
    if (cerca) {
        Object.assign(cerca, fundir(cerca, entra));
        renumerar(estado);
        return { claqueta: cerca, nueva: false };
    }

    entra.n = ++estado.proximaClaqueta;
    lista.push(entra);
    renumerar(estado);
    return { claqueta: entra, nueva: true };
}

/** Las claquetas por orden de reloj, con su número puesto de nuevo. */
function renumerar(estado) {
    const lista = estado.claquetas || [];
    lista.sort((a, b) => a.ms - b.ms);
    lista.forEach((c, i) => { c.n = i + 1; });
    estado.proximaClaqueta = lista.length;
    return lista;
}

/**
 * La claqueta de referencia: la primera, que es contra la que el editor
 * correlaciona los archivos de Premiere.
 *
 * Es una función y no un campo guardado porque puede cambiar: un golpe que se
 * lee tarde y cae antes que todas pasa a ser la referencia, y un campo escrito
 * al arrancar diría lo de antes.
 */
function claquetaDeReferencia(estado) {
    return (estado.claquetas || [])[0] || null;
}

function quitarClaqueta(estado, n) {
    const quitada = (estado.claquetas || []).find(c => c.n === n);
    if (quitada) recordarQuitada(estado, quitada);
    estado.claquetas = (estado.claquetas || []).filter(c => c.n !== n);
    renumerar(estado);
    return estado.claquetas;
}

function recordarQuitada(estado, c) {
    if (!c) return;
    estado.claquetasQuitadas = (estado.claquetasQuitadas || []).concat([c.ms]);
}

function olvidarQuitada(estado, c) {
    if (!c || !estado.claquetasQuitadas) return;
    estado.claquetasQuitadas = estado.claquetasQuitadas.filter(ms => Math.abs(ms - c.ms) >= MISMA_CLAQUETA_MS);
}

/** La claqueta con la que se fundiría una nueva en `ms`, si hay. */
function claquetaCerca(estado, ms) {
    return (estado.claquetas || []).find(c => Math.abs(c.ms - ms) < MISMA_CLAQUETA_MS) || null;
}

/** Cuántas de las últimas palabras oídas se recuerdan para encontrarlas en la pasada siguiente. */
const RECIENTES = 12;

/** El pedazo más largo de esas que se busca, y cuánto puede correrse de hora. */
const ENGANCHE_MAX = 8;
const ENGANCHE_CORRIMIENTO_MS = 2500;

/**
 * La misma palabra oída dos veces, aunque una de las dos venga entera y la otra
 * cortada («funcion» y «funcionando»).
 */
function mismaPalabra(a, b) {
    if (!a || !b) return false;
    return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

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

    const marcas = senales(nuevas, finMs).filter(m => m.hasta < cuantasFirmes && !yaVista(m));
    // Dónde empieza lo que no se había oído: por el TEXTO y no por la hora (ver
    // `dondeSigue`).
    const inicioNuevo = dondeSigue(estado, nuevas);
    const eventos = [];
    let cursor = 0;

    const guardar = (hasta) => {
        const toma = tomaAbierta(estado);
        const tope = Math.min(hasta, cuantasFirmes);
        for (let i = Math.max(cursor, inicioNuevo); i < tope; i++) {
            const w = nuevas[i];
            // El IN que puso el conteo sobre su propio «1», porque no se había
            // oído nada detrás: la primera palabra que llega es donde empieza.
            if (toma && toma.inProvisional) {
                toma.inMs = Math.max(toma.inMs, w.t);
                delete toma.inProvisional;
            }
            // Con una toma abierta la palabra es suya —salvo que se haya dicho
            // antes de su IN, que pasa al abrir a mano durante el atraso del
            // ciclo—; sin ninguna, queda en el colchón por si alguien abre a mano
            // en los próximos segundos (ver `sueltas` y `abrirToma`).
            if (toma && w.t >= toma.inMs) toma.palabras.push(w);
            else estado.sueltas.push(w);
        }
        cursor = hasta;
    };

    for (const marca of marcas) {
        estado.ultimaSenal[marca.tipo] = nuevas[marca.hasta].t;
        estado.senalesVistas[marca.tipo] = (estado.senalesVistas[marca.tipo] || [])
            .concat([nuevas[marca.hasta].t]).slice(-8);

        if (marca.tipo === 'claqueta') {
            // Las palabras de la claqueta se guardan como cualquier otra: si hay
            // una toma abierta, "claqueta 4" se dijo adentro de ella y sacarlo
            // del transcript sería mentir sobre lo que se oye en el audio. La
            // relectura con el modelo grande lo vuelve a escribir igual.
            guardar(marca.hasta + 1);
            // La frase entera de alrededor y no la palabra sola: es de donde
            // sale el número ("claqueta 4, clase 4"), que es lo que el editor
            // busca para emparejarla con la pizarra.
            const anotada = anotarClaqueta(estado, {
                ms: nuevas[marca.desde].t,
                paredMs: Date.now(),
                frase: textoDe(nuevas, Math.max(0, marca.desde - 2), marca.hasta + 3),
                confirmada: true,
                origen: 'voz'
            });
            if (anotada.nueva) {
                eventos.push({ tipo: 'claqueta', claqueta: anotada.claqueta.n, por: marca.por });
            }
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
            const toma = nuevaToma(
                estado,
                sigue ? sigue.t : (uno.hasta != null ? uno.hasta : uno.t),
                textoDe(nuevas, marca.desde, marca.hasta));
            if (!sigue) toma.inProvisional = true;
            // El conteo abrió la toma, así que lo que se dijo antes es de otra
            // cosa: el colchón se vacía para que un "abrir a mano" posterior no
            // retroceda hasta una tirada que ya quedó del lado de afuera.
            estado.sueltas = [];
            estado.tomas.push(toma);
            eventos.push({ tipo: 'abierta', toma: toma.id, por: marca.por });
            cursor = marca.hasta + 1;
            continue;
        }

        // Cierra. El OUT va ANTES de "Pausa": la señal tampoco es clase.
        const toma = tomaAbierta(estado);
        if (toma) {
            toma.outMs = finDeToma(toma, nuevas[marca.desde].t);
            eventos.push({ tipo: 'cerrada', toma: toma.id });
        }
        cursor = marca.hasta + 1;
    }

    guardar(nuevas.length);
    // Hasta acá se oyó, haya o no toma abierta: una palabra que se dijo entre dos
    // tomas no es de nadie, pero tampoco puede volver a aparecer en la siguiente
    // ventana como si fuera nueva. Hasta la última FIRME: lo de después vuelve.
    // Las señales cuentan como oídas aunque no se guarden: son lo que la pasada
    // siguiente va a encontrar al principio de su ventana.
    if (cuantasFirmes > inicioNuevo) {
        estado.ultimaPalabraMs = Math.max(estado.ultimaPalabraMs || -Infinity, nuevas[cuantasFirmes - 1].t);
        estado.recientes = (estado.recientes || [])
            .concat(nuevas.slice(inicioNuevo, cuantasFirmes).map(w => ({ n: norm(w.texto), t: w.t })))
            .filter(r => r.n)
            .slice(-RECIENTES);
    }

    // El colchón se recorta a su ventana. Sin esto, una clase de tres horas
    // donde nadie abre ninguna toma acumula en memoria todas sus palabras, y
    // `abrirToma` tendría que caminar hacia atrás sobre una lista que crece
    // toda la clase para contestar lo mismo.
    const piso = estado.ultimaPalabraMs - VENTANA_DE_SUELTAS_SEC * 1000;
    if (estado.sueltas.length && estado.sueltas[0].t < piso) {
        estado.sueltas = estado.sueltas.filter(w => w.t >= piso);
    }
    return eventos;
}

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
 */
function repartir(palabras, toma) {
    const lista = palabras || [];
    return {
        antes: lista.filter(w => w.t < toma.inMs),
        palabras: lista.filter(w => w.t >= toma.inMs && w.t < toma.outMs),
        despues: lista.filter(w => w.t >= toma.outMs)
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
 * @returns {boolean} si se pudo mover
 */
function moverBorde(toma, cual, paredMs) {
    if (!toma || paredMs == null) return false;
    if (cual === 'in') {
        if (toma.outMs != null && paredMs >= toma.outMs) return false;
        toma.inMs = paredMs;
        return true;
    }
    if (toma.inMs != null && paredMs <= toma.inMs) return false;
    toma.outMs = paredMs;
    return true;
}

/* ─── Los cambios que se resuelven con lo que ya está escrito ────────────
 *
 * Acá y no en `grabacion.js` porque estos cambios se hacen sobre la clase que se
 * está grabando y también sobre una que ya terminó, y las dos tienen que
 * escribir exactamente lo mismo: si divergieran, el mismo gesto daría un XML
 * distinto según cuándo se hizo.
 */

/** @param {object} c { desdeMs, hastaMs, texto, comentario } */
function comentar(toma, c) {
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
function moverBordeGuardado(toma, cual, paredMs) {
    const guardadas = (toma.antes || []).concat(toma.palabras || [], toma.despues || []);
    const ultima = guardadas[guardadas.length - 1];
    if (!guardadas.length || !Number.isFinite(paredMs) ||
        paredMs < guardadas[0].t || paredMs > ultima.t) {
        throw new Error('Ese borde cae fuera del texto que quedó guardado. ' +
            'Corrilo hasta donde llega el gris y usá "Regenerar": relee la toma ' +
            'del audio y deja otros segundos de contexto para seguir.');
    }
    if (!moverBorde(toma, cual, paredMs)) return;
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
 * @throws si el cambio no se puede hacer sin volver a oír el audio
 */
function aplicar(toma, cambio) {
    const c = cambio || {};
    switch (c.tipo) {
        case 'vista':
            toma.vista = c.vista;
            return;
        case 'nota':
            toma.comentario = String(c.texto || '');
            return;
        case 'descartar':
            toma.descartada = Boolean(c.descartada);
            return;
        case 'comentar':
            comentar(toma, c);
            return;
        case 'borrar-comentario':
            descomentar(toma, c.indice);
            return;
        case 'borde':
            moverBordeGuardado(toma, c.borde, Number(c.paredMs));
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
    CAMARA,
    PANTALLA,
    VISTAS,
    VISTA_POR_DEFECTO,
    MAPA_DE_VISTAS,
    vistaLeida,
    aplicar,
    estadoNuevo,
    senales,
    aplicarSenales,
    repeticiones,
    tomaAbierta,
    abrirToma,
    moverInAbierta,
    cerrarEn,
    arranqueDeLaTirada,
    HUECO_DE_TIRADA_SEC,
    RETROCESO_MAX_SEC,
    FRESCURA_MAX_SEC,
    finDeToma,
    anotarClaqueta,
    renumerar,
    quitarClaqueta,
    claquetaDeReferencia,
    fundir,
    MISMA_CLAQUETA_MS,
    CLAQUETA,
    repartir,
    renumerar,
    cerrarProvisional,
    recordarQuitada,
    olvidarQuitada,
    claquetaCerca,
    moverBorde,
    tomasQueQuedan,
    limpio,
    comentarioDeEntrada,
    cueDeSalida
};
