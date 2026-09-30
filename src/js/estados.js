/**
 * estados.js — El vocabulario de estados, en un solo sitio.
 *
 * Cada cosa que puede estar de varias maneras —una toma, una claqueta, la
 * sesión, el audio, Whisper— dice su estado con UNA PALABRA, y esa palabra la
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

/** Cómo está una claqueta. */
export function deClaqueta(claqueta) {
    if (!claqueta) return { clave: 'por confirmar', palabra: 'por confirmar' };
    if (claqueta.origen === 'editor') {
        return { clave: 'confirmada', palabra: 'a mano' };
    }
    if (claqueta.confirmada) return { clave: 'confirmada', palabra: 'confirmada' };
    return {
        clave: 'por confirmar',
        palabra: 'por confirmar',
        porque: 'Se oyó un golpe pero no se dijo «claqueta» ni «clase N» alrededor: ' +
            'puede ser una puerta. Si era una claqueta, dejala; si no, quitala.'
    };
}

/**
 * La palmada que se oyó y todavía no es una claqueta.
 *
 * Es el único estado de la app que el motor no guarda en la sesión: el aviso de
 * `golpe` pasa y no queda en ninguna parte. Y es el que le faltaba a la
 * pantalla: el aplauso no daba ninguna señal hasta que la confirmación volvía
 * de Whisper, seis segundos después, así que aplaudir y no ver nada se leía
 * como «la app no lo oyó» — que es exactamente lo que el editor reportó.
 *
 * Son las dos mitades de la misma idea que las palabras marcadas del transcript:
 * lo que la app OYÓ no es lo que la app HIZO, y las dos cosas se dicen aparte.
 */
export function dePalmada(palmada) {
    if (!palmada) return null;
    if (palmada.sinConfirmar) {
        return {
            clave: 'sin confirmar',
            palabra: 'palmada sin confirmar',
            porque: 'Se oyó la palmada pero no se leyó «claqueta» alrededor, así que no se ' +
                'anotó ninguna. Pasa cuando Whisper escribe la palabra de otra manera: el ' +
                '30/09 salió «La quinta» y «Tlajeta clase 4». Si fue una claqueta, ponela ' +
                'con K o con el botón de Claqueta: ' +
                (palmada.enganchable
                    // Lo que el aviso existe para que se pueda hacer. El motor
                    // recibe el momento de ESTA palmada y anota ahí, no donde
                    // esté el dedo doce segundos después.
                    ? 'la marca cae en la palmada misma, no donde apretás.'
                    // Y cuando ya no, se dice. Un aviso que promete algo que no
                    // hace es peor que no tenerlo.
                    : 'pasaron más de veinte segundos, así que esta va a caer en el ' +
                      'momento en que apretás y no en la palmada, que ya quedó atrás.')
        };
    }
    return {
        clave: 'por confirmar',
        palabra: 'palmada oída',
        porque: 'Se oyó una palmada. La app está leyendo lo que se dijo alrededor para ver si ' +
            'es una claqueta, y tarda unos segundos porque necesita el audio de después. Si ' +
            'ya sabés que fue una claqueta, apretá K: la marca cae en la palmada misma y las ' +
            'dos se funden en una.'
    };
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
    if (audio && audio.caido) return { clave: 'sin audio', palabra: 'sin audio' };
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
 * **Lo primero que se mira es QUÉ se eligió, y después cuánto suena.** Un
 * micrófono en una clase por Zoom suena —la sala tiene ruido— y aun así no va
 * a oír a nadie. Con el nivel como única pregunta, esa elección salía en verde.
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
                  'abrirla y elegí «Audio de Zoom» otra vez; la grabación sigue en el mismo XML.'
                : 'La entrada dejó de existir: se desenchufó, o el programa que la creaba se ' +
                  'cerró. Elegí otra y la grabación sigue en el mismo XML.'
        };
    }

    if (audio.clase === 'zoom-falso') {
        return {
            clave: 'falta',
            palabra: 'no es la llamada',
            listo: 'mal',
            porque: 'ZoomAudioDevice es lo que Zoom usa para mandar el sonido de tu Mac cuando ' +
                'compartís pantalla. No trae la voz de la reunión. Elegí «Audio de Zoom (la llamada)».'
        };
    }

    // Un micrófono no bloquea para siempre: una clase presencial se graba así,
    // y para eso está «Usar el micrófono igual». Lo que no hace es ponerse en
    // verde solo, que es lo que dejaba grabar una llamada en silencio.
    if ((audio.clase === 'microfono' || audio.clase === 'bluetooth') && !audio.aceptado) {
        return {
            clave: 'en silencio',
            palabra: 'graba la sala',
            listo: 'no',
            porque: 'Esto es un micrófono: graba lo que suena en tu sala, no la llamada. Si la ' +
                'clase llega por Zoom y la escuchás con auriculares, no va a oír a nadie. Elegí ' +
                '«Audio de Zoom (la llamada)».' +
                (audio.clase === 'bluetooth'
                    ? ' Además, abrir el micrófono de unos auriculares Bluetooth los pasa a modo ' +
                      'llamada y el sonido en tus oídos empeora.'
                    : '')
        };
    }

    if (!(audio.pico > 0.002)) {
        // Con Zoom, el silencio no bloquea: antes de que la clase empiece no
        // habla nadie, o el que habla está muteado, y eso es normal. Pero se
        // dice en ámbar, porque también es lo que se ve si macOS no le dio
        // permiso a la app (el sonido llega en ceros y no hay forma de
        // preguntarlo de otra manera).
        if (audio.clase === 'llamada') {
            return {
                clave: 'en silencio',
                palabra: 'sin sonido todavía',
                listo: 'si',
                porque: 'Zoom está conectado pero no suena nada. Es normal si nadie está ' +
                    'hablando. Si alguien habla y el medidor no se mueve, macOS no le dio ' +
                    'permiso a Note Taker: Ajustes del Sistema → Privacidad y seguridad → ' +
                    'Grabación de audio del sistema.'
            };
        }
        return {
            clave: 'en silencio',
            palabra: 'en silencio',
            listo: 'no',
            porque: 'La entrada está abierta pero no llega nada. Si es un dispositivo virtual, ' +
                'revisá que Zoom esté mandando su sonido ahí.'
        };
    }

    if (audio.clase === 'llamada') return { clave: 'entra', palabra: 'entra la llamada', listo: 'si' };
    return { clave: 'entra', palabra: 'entra audio', listo: 'si' };
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
