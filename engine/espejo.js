'use strict';
/**
 * espejo.js — La sesión mirada desde afuera.
 *
 * Todo lo de acá recibe la sesión y no la cambia: hasta dónde llegó el audio, en
 * qué archivos está, dónde van a caer sus dos archivos, qué dibuja la ventana y
 * qué queda en el disco. Son cinco preguntas distintas con una sola cosa en
 * común, y es la que importa: ninguna decide nada.
 *
 * Están juntas porque son la misma frontera. El resto del motor —el ciclo de
 * señales, la cola de relecturas, los cambios a mano— toca el estado de la
 * sesión; para contarlo afuera pasa por acá, y así hay UN solo sitio donde se
 * decide qué se ve de una grabación. Cuando la pantalla y el XML discrepan, el
 * que miente está en este archivo y en ninguno más.
 *
 * `escribir` es la única que sale del proceso, y sigue siendo un espejo: deja en
 * el disco exactamente el estado que las otras cuatro cuentan.
 */

const ajustar = require('./ajustar-corte');
const historial = require('./deshacer');
const notasXml = require('./notas-xml');
const vivo = require('./notas-vivo');
const workspace = require('./workspace');

/**
 * Hasta dónde llega el audio escrito, en hora del día.
 *
 * **Este es el reloj de la app, y no `Date.now()`.** No se puede preguntar hasta
 * "ahora": el audio de ahora todavía no está en el archivo. Se pregunta hasta
 * donde el archivo llega, que es lo que `captura` sabe, y con eso todo —las
 * palabras, los golpes, la claqueta que el editor marca a mano y el OUT del
 * botón— queda estampado contra la misma regla. Es lo único que hace que los
 * tiempos cierren en el total de una clase de tres horas: dos relojes que
 * arrancan juntos se separan, uno solo no.
 */
function grabadoHastaMs(sesion) {
    if (!sesion || !sesion.captura) return 0;
    return sesion.captura.desdeMs + sesion.captura.segundos * 1000;
}

/** Los WAV de esta sesión: el que se está escribiendo y los que ya se cerraron. */
function archivosDeLaSesion(sesion) {
    return (sesion.captura ? [sesion.captura] : []).concat(sesion.estado.sesiones);
}

/**
 * Dónde van a caer el XML y el sidecar de la sesión que se está grabando.
 *
 * Se pregunta desde dos sitios: al escribirlos, y en el resumen que mira la
 * pantalla, que lo único que hace con ellos es decirle al editor dónde está
 * guardando. La forma de la carpeta vive en `workspace.js` y escribirla de nuevo
 * en el renderer sería el mismo error con otra ropa: va la ruta ya armada.
 */
function archivosDeLaClase(sesion) {
    return workspace.archivosDeSesion(
        sesion.dir, workspace.safeName(sesion.estado.secuencia));
}

/**
 * El XML y el sidecar, los dos atómicos.
 *
 * Se escriben en cada cambio y no al terminar: lo que se está grabando no se
 * puede repetir, así que si la app se cae, lo que ya pasó tiene que estar en el
 * disco. Cuesta dos escrituras de unos kilobytes.
 */
function escribir(sesion) {
    if (!sesion) return null;
    const archivos = archivosDeLaClase(sesion);

    const conSesiones = {
        ...sesion.estado,
        sesiones: sesion.estado.sesiones.concat(
            sesion.captura ? [{ ...sesion.captura }] : [])
    };

    // Los bordes de las tomas, corridos al silencio de al lado mirando el WAV
    // (`ajustar-corte.js`). Va acá y no adentro de `xmlDeNotas` porque esto lee
    // el disco y aquello es una traducción pura; y va ANTES de las dos
    // escrituras para que el sidecar se lleve el ajuste ya calculado y "Rehacer
    // XML" pueda repetir el mismo corte sin el audio. El estado se comparte con
    // `sesion.estado`, así que cada toma se mira una vez y no en cada cambio.
    ajustar.ajustarSesion(conSesiones);

    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(conSesiones));
    workspace.writeJson(archivos.json, notasXml.sidecar(conSesiones));
    return archivos;
}

/**
 * Cuántas palabras sueltas cruzan el puente, como mucho.
 *
 * Eran 120, y 120 es lo que se habla en menos de un minuto. Alcanzaba mientras
 * las sueltas fueran solo el ratito entre dos tomas, pero **correr el IN de la
 * toma abierta hacia adelante convierte en sueltas todo el principio de la
 * toma de golpe** (`moverInAbierta`): una toma de tres minutos son unas
 * cuatrocientas palabras, y las que pasaban de 120 no llegaban a la ventana.
 * O sea que el gesto se llevaba de la pantalla justo el texto contra el que
 * uno estaba decidiendo dónde poner el borde, y no volvía hasta cerrar la
 * toma. Seiscientas son unos cinco minutos: más larga que eso, una toma ya no
 * es una toma.
 *
 * El tope sigue existiendo porque sin ninguna toma cerrada las sueltas son
 * todo lo que se oyó, y el motor se guarda diez minutos
 * (`VENTANA_DE_SUELTAS_SEC`): mandar eso en cada estado es mandar media clase
 * por el puente una vez por segundo.
 */
const SUELTAS_QUE_CRUZAN = 600;

/**
 * Las sueltas que la ventana puede usar, que no son todas.
 *
 * Lo anterior al OUT de la última toma cerrada ya es texto de una toma, y la
 * ventana lo descarta apenas llega (`sueltasLibres` en `pantalla-vivo.js`):
 * mandarlo es mandar palabras para que las tiren del otro lado. Filtrar acá
 * además hace que el tope de arriba se gaste en lo que sirve.
 */
function sueltasQueSirven(e) {
    const lista = e.sueltas || [];
    const cerradas = (e.tomas || []).filter(t => t.outMs != null);
    const piso = cerradas.length ? Math.max(...cerradas.map(t => t.outMs)) : -Infinity;
    return lista.filter(w => w.t >= piso).slice(-SUELTAS_QUE_CRUZAN);
}

/**
 * Lo que la ventana necesita para dibujar.
 *
 * Va todo en cada aviso y no los cambios: una sesión tiene unas decenas de tomas
 * y unos miles de palabras, que es nada, y mandar el estado entero evita que la
 * pantalla y el motor puedan discrepar.
 *
 * No toca el estado. Qué toma repite a cuál se calcula acá y no se guarda —el
 * texto de una toma cambia cuando se la relee o se le mueve un borde— y se lee
 * del resultado, no de las tomas.
 */
function resumen(sesion) {
    if (!sesion) return null;
    const e = sesion.estado;
    const abierta = vivo.tomaAbierta(e);
    const repite = vivo.repeticiones(e.tomas);
    return {
        secuencia: e.secuencia,
        curso: e.curso,
        ceroMs: e.ceroMs,
        fps: e.fps,
        idioma: e.idioma,
        // Todas, en orden y con su número. La primera es la de referencia: es
        // contra ella que el editor correlaciona los archivos de Premiere.
        claquetas: e.claquetas || [],
        vistas: vivo.VISTAS,
        dir: sesion.dir,
        // Dónde van a caer los dos archivos. La pantalla lo muestra para que el
        // editor sepa dónde buscar el XML (ver `archivosDeLaClase`).
        archivos: archivosDeLaClase(sesion),
        grabando: true,
        // Hasta dónde llegó el audio, que es el reloj con el que la barra dibuja
        // el timecode. Va el número del motor y no uno que la ventana lleve por
        // su cuenta: dos relojes que arrancan juntos se separan, y el que el
        // editor mira tiene que ser el mismo que el que escribe el XML.
        segundos: sesion.captura ? sesion.captura.segundos : 0,
        // Qué hay en la cola de relecturas, para que la barra pueda decir
        // «releyendo 2» en vez de no decir nada mientras Whisper trabaja.
        releyendo: sesion.cola.length + (sesion.rehaciendo ? 1 : 0),
        // Cerrando: el audio ya está cerrado y se releen las últimas tomas.
        terminando: Boolean(sesion.terminando),
        abierta: abierta ? abierta.id : null,
        // Lo que se oyó sin ninguna toma abierta. Es el texto de la tarjeta de
        // "Ahora" cuando no hay toma —el que se va escribiendo y se desvanece
        // arriba— y, con una toma abierta, lo gris de antes de su IN: lo que
        // deja arrastrar el IN hacia atrás.
        sueltas: sueltasQueSirven(e),
        // Qué hay para deshacer y para rehacer, con el nombre del paso que toca:
        // es lo que deja que los dos botones se apaguen cuando no hay nada y
        // digan en su título qué van a revertir antes de apretarlos.
        historia: {
            ...historial.pasos(sesion.historia),
            queAtras: (historial.proximo(sesion.historia, 'atras') || {}).que || '',
            queAdelante: (historial.proximo(sesion.historia, 'adelante') || {}).que || ''
        },
        tomas: e.tomas.map(t => ({
            id: t.id,
            vista: t.vista,
            comentario: t.comentario || '',
            descartada: Boolean(t.descartada),
            cerradaSola: Boolean(t.cerradaSola),
            pausaAdentro: t.pausaAdentro || null,
            repiteA: repite.get(t.id) || null,
            cuenta: t.cuenta || '',
            inMs: t.inMs,
            outMs: t.outMs,
            palabras: t.palabras,
            // Qué le pasó a su relectura, si le pasó algo: es lo que la tarjeta
            // dibuja como aviso (`engine/insistir.js`).
            relectura: t.relectura || null,
            // Lo que se dijo pegado a cada borde, para poder moverlo mirando.
            antes: t.antes || [],
            despues: t.despues || [],
            comentarios: t.comentarios
        }))
    };
}

/**
 * El estado, y de paso el aviso a la ventana. Es el par que se repite en cada
 * cambio del motor, y escribirlo suelto en veinte sitios es la forma de que
 * alguna vez uno de los dos falte.
 *
 * **Es también el portero de la sesión que ya se cerró.** Lo llaman cosas que
 * tardan: una relectura vuelve unos segundos después, y para entonces el editor
 * puede haber apretado "Terminar". Escribir ahí sería resucitar el XML de una
 * sesión cerrada —o peor, escribirlo mientras la siguiente ya está grabando—. Se
 * mira `viva` y no si hay una sesión en curso, porque la que hay puede ser otra.
 */
function fijar(sesion) {
    if (!sesion || !sesion.viva) return null;
    escribir(sesion);
    const estado = resumen(sesion);
    sesion.avisar({ tipo: 'estado', estado });
    return estado;
}

module.exports = {
    grabadoHastaMs,
    archivosDeLaSesion,
    archivosDeLaClase,
    escribir,
    resumen,
    fijar
};
