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
 * Lo que sale de acá es para MIRAR y nada más. Quien abre tomas y las cierra
 * es el motor; esto no decide nada.
 */

/* ─── Las expresiones, copiadas del motor tal cual ────────────────────── */

const CUENTA = /^(?:3|2|1|tres|dos|uno|three|two|one)[.,…!?]*$/i;
const OK = /^ok(?:ay)?[.,…!?]*$/i;

const MINIMO_DE_CUENTA = 2;
const VALOR = { 3: 3, tres: 3, three: 3, 2: 2, dos: 2, two: 2, 1: 1, uno: 1, one: 1 };
export const SILENCIO_TRAS_PAUSA_SEC = 0.7;

const VISTAS = ['PV', 'R', 'S', 'MG', 'X2'];

function limpio(texto) {
    return String(texto == null ? '' : texto).trim();
}

function palabraDe(w) {
    return limpio(w && w.texto).replace(/^[¿¡"'(]+/, '');
}

/** Lo mismo que `engine/texto.js:norm`. */
function norm(texto) {
    return String(texto == null ? '' : texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/* ─── Las frases, las de Ajustes ──────────────────────────────────────── */

/**
 * Las frases que oye la app, las mismas que el motor (`reglasDeFrases`).
 *
 * Las pone `app.js` cada vez que lee o guarda los ajustes, así que una frase
 * agregada a mitad de clase se marca en el repintado siguiente, igual que el
 * motor la oye en la pasada siguiente. Hasta entonces, las de fábrica.
 */
let reglas = reglasDeFrases(null);

export function usarFrases(frases) {
    reglas = reglasDeFrases(frases);
}

function reglasDeFrases(frases) {
    const f = frases || { cuenta: true, abrir: ['retomamos'], cerrar: ['pausa', 'pause'], vista: [] };
    const de = (lista, tipo) => (Array.isArray(lista) ? lista : []).map(x => {
        const texto = typeof x === 'string' ? x : (x && x.frase);
        const palabras = String(texto == null ? '' : texto).split(/\s+/).map(norm).filter(Boolean);
        return { tipo, texto: limpio(texto), pegada: palabras.join(''), palabras: palabras.length, vista: x && x.vista };
    }).filter(r => r.pegada && (tipo !== 'vista' || VISTAS.includes(r.vista)));
    return {
        cuenta: f.cuenta !== false,
        frases: de(f.abrir, 'abre').concat(de(f.cerrar, 'cierra'), de(f.vista, 'vista'))
            .sort((a, b) => b.pegada.length - a.pegada.length)
    };
}

function dondeTermina(lista, i, pegada) {
    let junto = '';
    for (let k = i; k < lista.length; k++) {
        const crudo = String((lista[k] && lista[k].texto) || '').trim().replace(/^[¿¡"'(]+/, '');
        // Con comillas es una cita: «el profesor dice "Pausa", y para» habla
        // de la señal, no la dice. La de apertura sola es el comienzo de lo
        // que alguien dijo, y esa sí vale.
        if (/["«»“”]/.test(crudo)) return -1;
        const n = norm(crudo);
        if (!n) {
            if (k === i) return -1;
            continue;
        }
        junto += n;
        if (junto === pegada) return k;
        if (!pegada.startsWith(junto)) return -1;
    }
    return -1;
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
 * @returns {Array} [{tipo:'abre'|'cierra'|'pausa-corta'|'vista', desde, hasta, huecoSec?}]
 */
export function senalesEn(lista) {
    const ws = lista || [];
    const salida = [];

    for (let i = 0; i < ws.length; i++) {
        const p = palabraDe(ws[i]);
        let frase = null;
        let hasta = -1;
        for (const f of reglas.frases) {
            hasta = dondeTermina(ws, i, f.pegada);
            if (hasta !== -1) { frase = f; break; }
        }

        if (frase && (frase.tipo !== 'cierra' || frase.palabras > 1)) {
            salida.push({ tipo: frase.tipo, desde: i, hasta, vista: frase.vista, por: frase.texto });
            i = hasta;
            continue;
        }

        if (frase) {
            const siguiente = ws[hasta + 1];
            const hueco = siguiente ? (siguiente.t - ws[i].t) / 1000 : 0;
            salida.push({
                tipo: hueco >= SILENCIO_TRAS_PAUSA_SEC ? 'cierra' : 'pausa-corta',
                desde: i,
                hasta,
                por: frase.texto,
                // El hueco medido, para poder decirlo. `null` cuando todavía no
                // hay palabra detrás: ahí no se midió nada, y poner 0 sería
                // decir que el profesor siguió hablando sin respirar.
                huecoSec: siguiente ? Math.round(hueco * 100) / 100 : null
            });
            i = hasta;
            continue;
        }

        if (!reglas.cuenta) continue;

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
 * Índice de palabra → la señal que es, para pintar.
 *
 * El valor es la señal entera y no su tipo, porque la «Pausa» que no cerró trae
 * además su hueco y es lo único que explica por qué no cerró (`pistaDe`).
 */
export function porPalabra(lista) {
    const ws = lista || [];
    const marcas = new Map();
    for (const s of senalesEn(ws)) {
        for (let i = s.desde; i <= s.hasta; i++) marcas.set(i, s);
    }
    return marcas;
}

/** Qué hace cada señal, para la pista de la palabra marcada. */
export const QUE_HACE = {
    abre: 'Con esto la app abre una toma',
    cierra: 'Con esto la app cierra la toma',
    'pausa-corta': '«Pausa» sin el segundo de silencio detrás: la app no cerró la toma',
    vista: 'Con esto la app pasa a otra vista'
};

/**
 * La pista de una palabra marcada, con el dato que le falta a la plaquita.
 *
 * La plaquita hueca ya dice que la app no hizo nada, pero no CUÁNTO faltó, y
 * ese número es el que decide qué pasó: con 0,3 s el profesor siguió hablando y
 * la toma tenía que seguir abierta; con 0,9 s el umbral está pidiendo demasiado
 * y hay que bajarlo. El motor lo mide y lo anota en el registro
 * (`senal.pausa-corta`), así que hasta ahora había que abrir el diario al día
 * siguiente para saber de cuánto fue; acá está al pasar el mouse por encima.
 *
 * Sin palabra detrás no se dice nada: no hay hueco medido todavía.
 */
export function pistaDe(senal) {
    let base = QUE_HACE[senal && senal.tipo] || '';
    if (senal && senal.tipo === 'pausa-corta' && senal.por) {
        base = base.replace('«Pausa»', `«${senal.por.charAt(0).toUpperCase()}${senal.por.slice(1)}»`);
    }
    if (senal && senal.tipo === 'vista') return `${base}: ${senal.vista}`;
    if (!senal || senal.tipo !== 'pausa-corta' || senal.huecoSec == null) return base;
    const hueco = String(senal.huecoSec).replace('.', ',');
    return `${base}. El hueco fue de ${hueco} s y hace falta ${SILENCIO_TRAS_PAUSA_SEC}`;
}
