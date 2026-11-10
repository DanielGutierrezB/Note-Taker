/**
 * buscar-tomas.js — Buscar en lo que se dijo, en las notas y en los comentarios
 * de las tomas (⌘F en el tema nuevo).
 *
 * Tres preguntas y una sola regla: qué tomas lo dicen (la lista se filtra), cada
 * vez que aparece en el texto (▲ ▼ y el contador), y qué pedazo de la fila lo
 * muestra marcado. Cuando cada una comparaba a su manera, una frase con una coma
 * en el medio no filtraba la toma que la decía —y entonces ▲ ▼ no llegaban
 * nunca a ella—, y «accion» encontraba «acción» pero no la marcaba.
 *
 * **La regla es por palabras**, sin tildes, mayúsculas ni signos: una palabra
 * sola vale adentro de otra («idioma» en «idiomas»); una frase, palabra por
 * palabra, con la última pudiendo estar a medio escribir. Es pura: no toca el
 * documento, y quien dibuja escapa y marca con lo que esto devuelve.
 */

/** Menos que esto no se busca: una letra está en todas las tomas. */
const MINIMO = 2;

function sinTildes(x) {
    return String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Una palabra comparable, o '' si era solo signos. */
function comparable(palabra) {
    return sinTildes(palabra).replace(/[^\p{L}\p{N}]/gu, '');
}

function palabrasDe(texto) {
    return String(texto || '').split(/\s+/).map(comparable).filter(Boolean);
}

/**
 * Lo buscado, listo para comparar, o null si todavía no hay qué buscar.
 *
 * @returns {{crudo:string, palabras:string[]}|null}
 */
export function consulta(texto) {
    const crudo = String(texto || '').trim();
    const palabras = palabrasDe(crudo);
    if (sinTildes(crudo).length < MINIMO || !palabras.length) return null;
    return { crudo, palabras };
}

/** Si desde la palabra `i` de `ws` (ya comparables) se dice lo buscado. */
function dichoDesde(ws, i, q) {
    for (let k = 0; k < q.length; k++) {
        const w = ws[i + k];
        if (w == null) return false;
        const ok = q.length === 1 ? w.includes(q[0]) : (k === q.length - 1 ? w.startsWith(q[k]) : w === q[k]);
        if (!ok) return false;
    }
    return true;
}

/** Dónde empieza cada vez que aparece lo buscado en una lista de palabras comparables. */
function dondeAparece(ws, q) {
    const desde = [];
    for (let i = 0; i < ws.length; i++) if (dichoDesde(ws, i, q.palabras)) desde.push(i);
    return desde;
}

/** Los textos de una toma en los que se busca, del que más la nombra al que menos. */
function textosDe(t) {
    return [
        t.comentario || '',
        (t.palabras || []).map(w => w.texto).join(' '),
        ...(t.comentarios || []).map(c => `${c.texto || ''} ${c.comentario || ''}`)
    ];
}

/** Si la toma lo dice, en su texto, su nota o sus comentarios. Sin consulta, todas. */
export function coincide(t, q) {
    if (!q) return true;
    if (String(t.id) === q.crudo) return true;
    return textosDe(t).some(x => dondeAparece(palabrasDe(x), q).length > 0);
}

/**
 * Cada vez que aparece lo buscado en lo que se dijo, en el orden de la lista:
 * de qué toma es y los instantes (`w.t`) de las palabras que lo dicen, que es
 * como el texto dibujado las reconoce.
 *
 * @returns {Array<{toma:number, ts:string[]}>}
 */
export function ocurrencias(tomas, q) {
    if (!q) return [];
    const salida = [];
    for (const t of tomas) {
        const ws = t.palabras || [];
        const comparables = ws.map(w => comparable(w.texto));
        for (const i of dondeAparece(comparables, q)) {
            salida.push({ toma: t.id, ts: ws.slice(i, i + q.palabras.length).map(w => String(w.t)) });
        }
    }
    return salida;
}

/** Cuántas palabras de la frase de la fila se muestran, y cuántas antes de lo hallado. */
const PALABRAS_DE_LA_FRASE = 28;
const ANTES_DE_LO_HALLADO = 5;

/**
 * La frase de la fila, con lo buscado marcado: el pedazo de la nota, de lo que
 * se dijo o de un comentario donde aparece, empezando un poco antes.
 *
 * @returns {{partes:Array<{texto:string, marca:boolean}>, cortada:boolean}}
 *   El texto va tal cual —con sus tildes y sus signos— y por pedazos: quien
 *   dibuja escapa cada uno y envuelve los marcados.
 */
export function fraseConLoBuscado(t, q) {
    const textos = textosDe(t);
    const base = textos.find(x => q && dondeAparece(palabrasDe(x), q).length) || textos[1];
    const pedazos = base.split(/(\s+)/);
    // Índice de pedazo de cada palabra comparable, para volver del hallazgo al texto.
    const enPedazo = [];
    const ws = [];
    pedazos.forEach((p, i) => {
        const c = comparable(p);
        if (c) { ws.push(c); enPedazo.push(i); }
    });
    const marcados = new Set();
    const desde = q ? dondeAparece(ws, q) : [];
    for (const i of desde) for (let k = 0; k < q.palabras.length; k++) marcados.add(enPedazo[i + k]);
    const primera = desde.length ? Math.max(0, desde[0] - ANTES_DE_LO_HALLADO) : 0;
    const ultima = Math.min(ws.length, primera + PALABRAS_DE_LA_FRASE);
    if (!ws.length) return { partes: [], cortada: false };
    const de = enPedazo[primera];
    const hasta = ultima < ws.length ? enPedazo[ultima] : pedazos.length;
    return {
        partes: pedazos.slice(de, hasta).map((texto, k) => ({ texto, marca: marcados.has(de + k) })),
        cortada: primera > 0
    };
}
