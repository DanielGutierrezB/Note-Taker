/**
 * estados.js — El vocabulario de estados, en un solo sitio.
 *
 * Cada cosa que puede estar de varias maneras —una toma, la sesión, el
 * audio, Whisper— dice su estado con UNA PALABRA, y esa palabra la
 * decide este archivo.
 *
 * Está junto y no repartido por las pantallas por dos motivos. El primero es
 * WCAG 1.4.1: el color nunca puede ser el único canal, así que cada estado
 * tiene que tener su palabra, y con la palabra escrita en cada pantalla alguna
 * se olvidaría. El segundo es peor y es el que de verdad lo puso acá: la misma
 * situación llamada de dos maneras en dos pantallas parecen dos situaciones. Si
 * la lista dice «sin releer» y la barra dice «pendiente», el editor busca dos
 * problemas donde hay uno.
 *
 * La clave que devuelve cada función es también el `data-estado` del CSS, así
 * que el color sale de la palabra y no se pueden separar.
 */

/**
 * Cómo está una toma.
 *
 * El orden importa: se contesta lo MÁS URGENTE que le pase. Una toma
 * desactivada que además quedó sin releer se dice desactivada, porque ya no va al
 * XML y lo otro deja de importar.
 */
export function deToma(toma, estado) {
    if (!toma) return { clave: 'lista', palabra: 'lista' };
    if (toma.descartada) return { clave: 'desactivada', palabra: 'desactivada' };
    if (toma.outMs == null) return { clave: 'abierta', palabra: 'abierta' };
    if (toma.relectura && toma.relectura.estado === 'sin-leer') {
        return {
            clave: 'sin releer',
            palabra: 'sin releer',
            porque: 'Whisper no pudo con esta toma: lo que se ve es el texto del ciclo ' +
                'rápido, que no es el bueno. «Regenerar» la vuelve a leer con la ' +
                'máquina libre.'
        };
    }
    if (toma.relectura && toma.relectura.estado === 'degradada') {
        return {
            clave: 'sin releer',
            palabra: 'leída en chico',
            porque: 'El sistema se llevó al modelo grande y esta toma salió con uno más ' +
                'liviano: el texto se entiende pero pierde palabras. «Regenerar» la rehace.'
        };
    }
    if (estado && estado.releyendo && estado.abierta !== toma.id && toma.palabras &&
        !toma.palabras.length) {
        return { clave: 'releyendo', palabra: 'releyendo' };
    }
    if (toma.cerradaSola) return { clave: 'lista', palabra: 'cerrada a mano' };
    return { clave: 'lista', palabra: 'lista' };
}

/**
 * A partir de cuánto atraso del ciclo de señales se empiezan a perder palabras.
 *
 * No es un número elegido: es `CONTEXTO_MS - SOLAPE_MS` de `grabacion.js`. La
 * ventana de cada pasada son los últimos `CONTEXTO_MS` y se solapa `SOLAPE_MS`
 * con la anterior, así que mientras una pasada tarde menos que esa diferencia
 * las dos ventanas se tocan y no queda audio en el medio. Pasada esa marca
 * aparece un agujero, y el audio del agujero no lo oye nadie nunca.
 *
 * Copiado y no requerido porque esto corre en la ventana, que no puede cargar el
 * motor. Que no se separe del original lo cuida una prueba que requiere los dos
 * y compara, igual que con `insistir.js`.
 */
const SE_PIERDEN_PALABRAS_SEC = (6000 - 1200) / 1000;

/**
 * El ciclo de señales que no llega, en los dos estados que importan.
 *
 * **Que se haya salteado audio se queda puesto hasta el final de la sesión**, y
 * es el mismo trato que `audio.roto`: el agujero ya está hecho, deje o no de
 * pasar, y lo que hay que saber al entregar es que está. Que vaya atrasado
 * ahora mismo, en cambio, se va cuando el ciclo se pone al día.
 */
export function atrasado(estado) {
    if (!estado) return null;
    if (estado.salteadoSec > 0) {
        return {
            clave: 'sin audio',
            palabra: 'transcript con huecos',
            porque: `La app se quedó sin tiempo para escuchar y ${fmt(estado.salteadoSec)} s de ` +
                'audio no se transcribieron. El audio está completo —no se perdió nada de la ' +
                'grabación—, pero al texto le faltan trozos, así que los bordes de las tomas ' +
                'de este rato pueden estar mal puestos: revisalos antes de entregar el XML. ' +
                'Si sigue subiendo, cerrá lo que esté pesando en la Mac.'
        };
    }
    if (estado.atrasoSec > SE_PIERDEN_PALABRAS_SEC) {
        return {
            clave: 'releyendo',
            palabra: `oyendo ${fmt(estado.atrasoSec)} s atrás`,
            porque: 'La app está escuchando con atraso: lo que se dice tarda eso en aparecer. ' +
                'Mientras dure, «3, 2, 1» y «Pausa» llegan tarde y abrir o cerrar una toma a ' +
                'mano la puede dejar con el borde corrido. Suele ser otra cosa comiéndose la ' +
                'Mac.'
        };
    }
    return null;
}

/** Un segundo con coma, como se escribe acá. */
function fmt(sec) {
    return String(Math.round(sec * 10) / 10).replace('.', ',');
}

/**
 * Cómo está la sesión.
 *
 * Es lo que dice la pastilla grande de la barra, y es el único estado que se
 * mira sin apartar la vista del profesor.
 */
export function deSesion(estado, audio) {
    if (!estado) return { clave: 'terminada', palabra: 'sin sesión' };
    if (estado.terminando) return { clave: 'releyendo', palabra: 'terminando' };
    // Antes que «sin audio», y es a propósito: una entrada que se cae se nota
    // —el medidor se planta— y esto no se nota en nada. El audio sigue
    // llegando, el medidor sigue moviéndose, y los pedazos que reventaron al
    // procesarse no llegaron al WAV. Se queda puesto hasta que la sesión
    // termine aunque deje de fallar, porque el agujero ya está hecho y lo que
    // hay que saber al entregar es que está.
    if (audio && audio.roto) {
        const n = audio.roto.veces || 1;
        return {
            clave: 'sin audio',
            palabra: 'audio perdido',
            porque: (n === 1
                ? 'Un pedazo del audio no se pudo procesar y no llegó al WAV'
                : `${n} pedazos del audio no se pudieron procesar y no llegaron al WAV`) +
                ': lo que falta no está, y todo lo que viene después queda corrido contra la ' +
                `cámara. Motivo: ${audio.roto.mensaje}. Si sigue pasando, elegí otra entrada en ` +
                'el rótulo Audio de la barra: la clase sigue en el mismo XML, con otro WAV.'
        };
    }
    if (audio && audio.caido) {
        return {
            clave: 'sin audio',
            palabra: 'sin audio',
            porque: 'La entrada dejó de mandar audio. Elegí otra en el rótulo Audio de la barra: '
                + 'la clase sigue en el mismo XML.'
        };
    }
    // El ciclo que no llega, y va ANTES de «toma abierta» a propósito: es con
    // una toma abierta cuando esto hace daño. Los bordes de una toma salen de
    // las palabras, así que un transcript atrasado no es solo texto que tarda:
    // es una toma que puede abrirse o cerrarse en el lugar equivocado. Pasó el
    // 8 de octubre —el ciclo a treinta segundos, una toma cerrada por una
    // «Pausa» de antes de abrirla, 0,10 s de duración y afuera del montaje— y
    // en pantalla no se veía nada: el texto no crecía, igual que si el profesor
    // estuviera callado.
    const atras = atrasado(estado);
    if (atras) return atras;
    if (estado.abierta != null) return { clave: 'abierta', palabra: 'toma abierta' };
    if (estado.releyendo) {
        return { clave: 'releyendo', palabra: `releyendo ${estado.releyendo}` };
    }
    return { clave: 'escuchando', palabra: 'escuchando' };
}

/** Cómo está una sesión ya guardada, en la lista. */
export function deSesionGuardada(resumen) {
    const e = (resumen && resumen.estado) || 'terminada';
    if (e === 'abierta') {
        return {
            clave: 'sin cerrar',
            palabra: 'abierta',
            porque: 'Esta sesión no se cerró: la app se fue antes de apretar Terminar. ' +
                'Se puede reanudar y seguir grabando en el mismo XML.'
        };
    }
    if (e === 'sin releer') {
        return {
            clave: 'sin releer',
            palabra: 'sin releer',
            porque: `${resumen.sinReleer} toma(s) se quedaron con el texto del ciclo ` +
                'rápido. «Regenerar» las vuelve a leer.'
        };
    }
    return { clave: 'terminada', palabra: 'terminada' };
}

/**
 * Qué clase de entrada es, leyendo su nombre.
 *
 * Existe por un error fácil de cometer y caro de descubrir: en una clase que
 * llega por Zoom y se escucha con auriculares, elegir un micrófono graba la
 * sala —o sea, nada—, y el medidor igual se mueve con cualquier ruido, así que
 * la pantalla se ponía en verde. Se descubría después de la clase.
 *
 * Es por nombre porque es lo único que el navegador dice de un dispositivo, y
 * alcanza: macOS los nombra de forma bastante estable ("MacBook Pro
 * Microphone", "AirPods (Bluetooth)", "ZoomAudioDevice (Virtual)").
 *
 *   llamada      el audio de Zoom, capturado directo. Lo que sirve.
 *   zoom-falso   ZoomAudioDevice. Parece la llamada y no lo es.
 *   virtual      BlackHole, Loopback, un dispositivo agregado. Sirve si Zoom
 *                manda su sonido ahí, y eso lo tuvo que armar alguien a mano.
 *   bluetooth    el micrófono de unos auriculares Bluetooth.
 *   microfono    cualquier otro micrófono.
 *   otra         una interfaz o algo que no se reconoce: se juzga por el nivel.
 */
export function claseDeEntrada(entrada) {
    if (!entrada) return null;
    if (entrada.tipo === 'app') return 'llamada';
    const n = String(entrada.nombre || '').toLowerCase();
    if (/zoomaudiodevice/.test(n)) return 'zoom-falso';
    if (/blackhole|loopback|soundflower|agregad|aggregate|multi-output|salida m[uú]ltiple/.test(n)) return 'virtual';
    if (/airpods|bluetooth|beats|buds|headset|auricular/.test(n)) return 'bluetooth';
    if (/microphone|micr[oó]fono|built-in|integrad|iphone|webcam|c[aá]mara|camera/.test(n)) return 'microfono';
    return 'otra';
}

/**
 * Cómo viene entrando el audio.
 *
 * `pico` es el nivel de los últimos pedazos. El umbral es bajo a propósito: lo
 * que se está preguntando no es «suena fuerte» sino «hay algo del otro lado»,
 * y una clase donde nadie habla todavía tiene ruido de sala muy por encima del
 * silencio digital.
 *
 * **`listo` dice si se puede iniciar, y para eso alcanza con una entrada
 * abierta.** Antes un micrófono pedía confirmar que la clase era presencial y
 * una entrada en silencio no dejaba empezar: las dos cosas se arreglan
 * grabando, desde el rótulo Audio de la barra, y frenar ahí era frenar las
 * notas. Lo dudoso —el silencio, ZoomAudioDevice, los auriculares Bluetooth—
 * se dice en ámbar con su porqué, y nada más.
 */
export function deAudio(audio) {
    if (audio && audio.error) {
        return { clave: 'falta', palabra: 'no se pudo abrir', listo: 'mal', porque: audio.error };
    }
    if (!audio || !audio.abierto) {
        return { clave: 'falta', palabra: 'sin elegir', listo: 'no' };
    }
    if (audio.caido) {
        return {
            clave: 'dispositivo perdido',
            palabra: audio.clase === 'llamada' ? 'Zoom se cerró' : 'dispositivo perdido',
            listo: 'mal',
            porque: audio.clase === 'llamada'
                ? 'Se dejó de oír a Zoom: la app se cerró o salió de la reunión. Volvé a ' +
                  'abrirla y elegí «Audio de Zoom» otra vez. Grabando, se elige en el rótulo ' +
                  'Audio de la barra y la grabación sigue en el mismo XML.'
                : 'La entrada dejó de existir: se desenchufó, o el programa que la creaba se ' +
                  'cerró. Elegí otra. Grabando, se elige en el rótulo Audio de la barra y la ' +
                  'grabación sigue en el mismo XML.'
        };
    }

    if (audio.clase === 'zoom-falso') {
        return {
            clave: 'en silencio',
            palabra: 'no es la llamada',
            listo: 'si',
            porque: 'ZoomAudioDevice es lo que Zoom usa para mandar el sonido de tu Mac cuando ' +
                'compartís pantalla. No trae la voz de la reunión: para grabar la llamada, ' +
                'elegí «Audio de Zoom» o «Audio del sistema».'
        };
    }

    // Abrir el micrófono de unos auriculares Bluetooth los pasa a modo llamada,
    // y eso se oye: no es un error de la elección, pero conviene saberlo antes.
    const bluetooth = audio.clase === 'bluetooth'
        ? 'Abrir el micrófono de unos auriculares Bluetooth los pasa a modo llamada y el ' +
          'sonido en tus oídos empeora mientras grabás.'
        : null;

    if (!(audio.pico > 0.002)) {
        // El silencio tampoco frena: antes de que la clase empiece no habla
        // nadie, y eso es normal. Se dice en ámbar porque también es lo que se
        // ve si macOS no le dio permiso a la app (el sonido llega en ceros y no
        // hay forma de preguntarlo de otra manera).
        if (audio.clase === 'llamada') {
            return {
                clave: 'en silencio',
                palabra: 'sin sonido todavía',
                listo: 'si',
                porque: 'Está conectado pero no suena nada. Es normal si nadie está ' +
                    'hablando. Si alguien habla y el medidor no se mueve, macOS no le dio ' +
                    'permiso a Note Taker: Ajustes del Sistema → Privacidad y seguridad → ' +
                    'Grabación de audio del sistema.'
            };
        }
        return {
            clave: 'en silencio',
            palabra: 'en silencio',
            listo: 'si',
            porque: 'La entrada está abierta pero todavía no llega sonido. Se puede empezar igual ' +
                'y cambiarla grabando, desde el rótulo Audio de la barra.' +
                (bluetooth ? ` ${bluetooth}` : '')
        };
    }

    if (audio.clase === 'llamada') return { clave: 'entra', palabra: 'entra la llamada', listo: 'si' };
    if (bluetooth) return { clave: 'entra', palabra: 'entra audio', listo: 'si', porque: bluetooth };
    return { clave: 'entra', palabra: 'entra audio', listo: 'si' };
}

/** Con menos que esto no se empieza: no alcanza para ninguna clase. */
const MINUTOS_MINIMOS = 15;
/** Con menos que esto se avisa: alcanza para una clase corta y no para una de tres horas. */
const MINUTOS_PARA_AVISAR = 180;

/**
 * La carpeta donde se guarda: que esté elegida, que se pueda escribir en ella y
 * cuánta clase entra en el disco (`engine/disco.js`).
 *
 * @param {string|null} carpeta
 * @param {{escribible:boolean, minutos:number|null, error?:string}|null} disco
 *   null mientras no se preguntó
 */
export function deCarpeta(carpeta, disco) {
    if (!carpeta) {
        return { clave: 'falta', palabra: 'sin elegir', listo: 'mal',
            porque: 'Sin carpeta no hay dónde escribir el XML ni el audio.' };
    }
    if (disco && !disco.escribible) {
        return { clave: 'falta', palabra: 'no se puede escribir', listo: 'mal',
            porque: `No se pudo escribir en la carpeta (${disco.error}). Revisá que el disco esté conectado.` };
    }
    const minutos = disco ? disco.minutos : null;
    if (minutos != null && minutos < MINUTOS_MINIMOS) {
        return { clave: 'falta', palabra: 'sin espacio', listo: 'mal',
            porque: `Quedan unos ${minutos} min de disco: no alcanza para una clase. Liberá espacio y volvé a entrar.` };
    }
    if (minutos != null && minutos < MINUTOS_PARA_AVISAR) {
        return { clave: 'en silencio', palabra: `${horasDe(minutos)} de disco`, listo: 'si',
            porque: `Quedan unos ${minutos} min de disco para el audio: alcanza para una clase corta. `
                + 'Si va a ser larga, liberá espacio antes de empezar.' };
    }
    return { clave: 'listo', palabra: 'lista', listo: 'si' };
}

/** «2 h 10 min», o «45 min». */
function horasDe(minutos) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Qué encontró Whisper, dicho en palabras y no en rutas. */
export function deWhisper(doctor) {
    if (!doctor) return { clave: 'falta', palabra: 'sin comprobar', listo: 'no' };
    const de = k => (doctor.tools || []).find(t => t.key === k) || {};
    const cli = de('whisper-cli');
    const grande = de('modelo de Whisper');
    const servidor = de('whisper-server (el texto en vivo)');
    const liviano = de('modelo liviano (respaldo del texto en vivo)');

    if (!cli.found || !grande.found) {
        return {
            clave: 'falta',
            palabra: 'falta',
            listo: 'mal',
            porque: !cli.found
                ? 'No está whisper-cli, así que no se puede oír nada: sin él no hay ' +
                  'conteo, ni pausa, ni texto. Mirá Diagnóstico.'
                : 'Está whisper-cli pero no hay ningún modelo. Mirá Diagnóstico para ver ' +
                  'dónde se buscó.'
        };
    }
    // Con whisper-server el texto en vivo sale del modelo grande ya cargado, y
    // el liviano no hace falta. Sin él funciona igual, pero peor, y eso se dice.
    if (!servidor.found) {
        return {
            clave: 'modelo liviano',
            palabra: liviano.found ? 'texto en vivo lento' : 'texto en vivo muy lento',
            listo: 'si',
            porque: liviano.found
                ? 'Falta whisper-server: el texto en vivo sale del modelo liviano relanzado en ' +
                  'cada pasada, más tarde y con más errores. Las tomas se releen igual con el grande.'
                : 'Falta whisper-server y no hay modelo liviano: cada pasada relanza el modelo ' +
                  'grande, y el texto en vivo llega con varios segundos de atraso.'
        };
    }
    return { clave: 'listo', palabra: 'listo', listo: 'si' };
}
