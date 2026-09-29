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
 * descartada que además quedó sin releer se dice descartada, porque ya no va al
 * XML y lo otro deja de importar.
 */
export function deToma(toma, estado) {
    if (!toma) return { clave: 'lista', palabra: 'lista' };
    if (toma.descartada) return { clave: 'descartada', palabra: 'descartada' };
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
 * Cómo viene entrando el audio.
 *
 * `pico` es el nivel de los últimos pedazos. El umbral es bajo a propósito: lo
 * que se está preguntando no es «suena fuerte» sino «hay algo del otro lado»,
 * y una clase donde nadie habla todavía tiene ruido de sala muy por encima del
 * silencio digital.
 */
export function deAudio(audio) {
    if (!audio || !audio.abierto) {
        return { clave: 'falta', palabra: 'sin elegir', listo: 'no' };
    }
    if (audio.caido) {
        return {
            clave: 'dispositivo perdido',
            palabra: 'dispositivo perdido',
            listo: 'mal',
            porque: 'La entrada dejó de existir: se desenchufó, o el programa que la ' +
                'creaba se cerró. Elegí otra y la grabación sigue en el mismo XML.'
        };
    }
    if (!(audio.pico > 0.002)) {
        return {
            clave: 'en silencio',
            palabra: 'en silencio',
            listo: 'no',
            porque: 'La entrada está abierta pero no llega nada. Si el audio viene de un ' +
                'Zoom, revisá que la reunión esté enviando a este dispositivo.'
        };
    }
    return { clave: 'entra', palabra: 'entra audio', listo: 'si' };
}

/** Qué encontró Whisper, dicho en palabras y no en rutas. */
export function deWhisper(doctor) {
    if (!doctor) return { clave: 'falta', palabra: 'sin comprobar', listo: 'no' };
    const de = k => (doctor.tools || []).find(t => t.key === k) || {};
    const cli = de('whisper-cli');
    const grande = de('modelo de Whisper');
    const liviano = de('modelo liviano (notas en vivo)');

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
    if (!liviano.found) {
        return {
            clave: 'modelo liviano',
            palabra: 'sin modelo liviano',
            listo: 'si',
            porque: 'Funciona, pero el ciclo que oye el conteo va con el modelo grande: ' +
                'gasta un segundo cada tres en vez de un décimo, durante toda la clase.'
        };
    }
    return { clave: 'listo', palabra: 'listo', listo: 'si' };
}
