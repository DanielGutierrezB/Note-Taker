/**
 * senales.js — Qué palabras del transcript son señales para la app.
 *
 * Existe para una sola cosa: que mientras la clase se graba se pueda VER si la
 * app oyó lo que el profesor dijo. El transcript es texto corrido y gris, así
 * que un «3, 2, 1» que Whisper escribió «3, 2, uña» se lee igual que el resto y
 * la toma no se abre, sin que nada lo diga. Marcadas, la señal que salió bien y
 * la que no se distinguen de un vistazo.
 *
 * **Es la misma regla que `engine/notas-vivo.js:senales`, escrita otra vez.**
 * El motor corre en el otro proceso y la ventana no puede importarlo, y el
 * transcript se repinta una vez por segundo: preguntar por el puente qué palabra
 * es señal sería un viaje de ida y vuelta por repintado para algo que es puro
 * léxico. Para que las dos copias no se separen, `tests/senales-del-texto.test.js`
 * lee las expresiones del motor DEL ARCHIVO y las compara con las de acá: si
 * alguien toca una en el motor, la prueba falla hasta que se toque acá también.
 *
 * Lo que sale de acá es para MIRAR y nada más. Quien abre tomas, las cierra y
 * anota claquetas es el motor; esto no decide nada.
 */

/* ─── Las expresiones, copiadas del motor tal cual ────────────────────── */

const CUENTA = /^(?:3|2|1|tres|dos|uno)[.,…!?]*$/i;
const RETOMAR = /^retomamos[.,…!?]*$/i;
const PAUSA = /^pausa[.,…!?]*$/i;
const OK = /^ok[.,…!?]*$/i;
const CLAQUETA = /laque|cacle/i;

const MINIMO_DE_CUENTA = 2;
const VALOR = { 3: 3, tres: 3, 2: 2, dos: 2, 1: 1, uno: 1 };
const SILENCIO_TRAS_PAUSA_SEC = 1;

function limpio(texto) {
    return String(texto == null ? '' : texto).trim();
}

function palabraDe(w) {
    return limpio(w && w.texto).replace(/^[¿¡"'(]+/, '');
}

function valorDeCuenta(texto) {
    return VALOR[String(texto).toLowerCase().replace(/[.,…!?]+$/, '')] || 0;
}

/**
 * Las señales de una tirada de palabras, en rangos de índices.
 *
 * Una diferencia con el motor, y es a propósito: una «Pausa» que todavía no
 * tiene palabra detrás acá cuenta como `pausa-corta` y no como cierre. El motor
 * resuelve ese caso con hasta dónde llegó el audio (`finMs`); la ventana no lo
 * sabe, y de las dos maneras de equivocarse esta es la buena — decir «cerró» de
 * una toma que sigue abierta sería mentir sobre lo único que la marca promete.
 * En el repintado siguiente llega la palabra que sigue, o la toma ya está
 * cerrada, y la marca se corrige sola.
 *
 * @param {Array} lista [{t, texto, hasta}] en orden
 * @returns {Array} [{tipo:'abre'|'cierra'|'claqueta'|'pausa-corta', desde, hasta}]
 */
export function senalesEn(lista) {
    const ws = lista || [];
    const salida = [];

    for (let i = 0; i < ws.length; i++) {
        const p = palabraDe(ws[i]);

        if (CLAQUETA.test(p)) {
            salida.push({ tipo: 'claqueta', desde: i, hasta: i });
            continue;
        }

        if (RETOMAR.test(p)) {
            salida.push({ tipo: 'abre', desde: i, hasta: i });
            continue;
        }

        if (PAUSA.test(p)) {
            const siguiente = ws[i + 1];
            const hueco = siguiente ? (siguiente.t - ws[i].t) / 1000 : 0;
            salida.push({
                tipo: hueco >= SILENCIO_TRAS_PAUSA_SEC ? 'cierra' : 'pausa-corta',
                desde: i,
                hasta: i
            });
            continue;
        }

        let j = i;
        if (OK.test(p) && ws[i + 1] && CUENTA.test(palabraDe(ws[i + 1]))) j = i + 1;
        let fin = j;
        while (fin < ws.length && CUENTA.test(palabraDe(ws[fin]))) {
            fin++;
            if (valorDeCuenta(palabraDe(ws[fin - 1])) === 1) break;
        }
        // Tiene que terminar en uno y llevar dos números: sin eso, «uno de los
        // problemas más comunes» se marcaría en media clase.
        const cierraEnUno = fin > j && valorDeCuenta(palabraDe(ws[fin - 1])) === 1;
        if (fin - j >= MINIMO_DE_CUENTA && cierraEnUno) {
            salida.push({ tipo: 'abre', desde: i, hasta: fin - 1 });
            i = fin - 1;
        }
    }

    return salida;
}

/**
 * Índice de palabra → qué señal es, para pintar.
 *
 * Los cortes de una toma larga (`recortarAbierta`) parten la tirada: a los dos
 * lados de un «… 900 palabras más …» no hay ninguna relación, y una «Pausa»
 * justo antes del corte tendría como palabra siguiente una de veinte minutos
 * después. Se busca por tramos y se devuelven los índices de la lista entera.
 */
export function porPalabra(lista) {
    const ws = lista || [];
    const marcas = new Map();
    let desde = 0;
    const tramos = [];
    for (let i = 0; i < ws.length; i++) {
        if (ws[i] && ws[i].corte) {
            tramos.push([desde, i]);
            desde = i + 1;
        }
    }
    tramos.push([desde, ws.length]);

    for (const [a, b] of tramos) {
        for (const s of senalesEn(ws.slice(a, b))) {
            for (let i = s.desde; i <= s.hasta; i++) marcas.set(a + i, s.tipo);
        }
    }
    return marcas;
}

/** Qué hace cada señal, para la pista de la palabra marcada. */
export const QUE_HACE = {
    abre: 'Con esto la app abre una toma',
    cierra: 'Con esto la app cierra la toma',
    claqueta: 'Acá la app anota una claqueta',
    'pausa-corta': '«Pausa» sin el segundo de silencio detrás: la app no cerró la toma'
};
