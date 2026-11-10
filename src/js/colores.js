/**
 * colores.js — El color de cada vista, que es el de su marcador en Premiere.
 *
 * Una toma de «Profesor» se pinta del mismo rojo con el que va a aparecer su
 * marcador en la secuencia, y una de «Pantalla» del mismo naranja. Es lo que
 * deja ver de un golpe qué vista se le está poniendo a cada toma, y que lo que
 * se ve mientras se graba sea lo que el editor va a ver después.
 *
 * En Class Cut no era así, y a propósito: allá la pantalla pintaba las vistas
 * con los colores de su reproductor, que en Note Taker no existe. Sin ese
 * motivo, dos colores para la misma cosa solo servían para confundir: el
 * profesor se veía azul acá y llegaba rojo a Premiere.
 *
 * **El color va de FONDO y nunca de letra.** El rojo de «Profesor» sobre la
 * tarjeta oscura da 3,2:1 y el verde de «Slides» 4,0:1, los dos debajo del 4,5
 * que pide el texto chico (WCAG 1.4.3). Como relleno no hay problema, y la
 * sigla de adentro se escribe con la tinta que mejor contraste contra ESE
 * color (`tintaSobre`).
 */

/**
 * El entero de Premiere a `#rrggbb`.
 *
 * `pproColor` viene ABGR y no ARGB: el byte de más peso después del alfa es el
 * AZUL. Leerlo al revés no rompe nada visible —sigue siendo un color válido—,
 * solo que es OTRO color (ver `componentesDePremiere` en `engine/fcp-xml.js`).
 */
export function hexDeMarcador(entero) {
    const n = Number(entero) >>> 0;
    const r = n & 255;
    const g = (n >>> 8) & 255;
    const b = (n >>> 16) & 255;
    return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

function luminancia(hex) {
    const s = hex.replace('#', '');
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(parseInt(s.slice(0, 2), 16)) +
        0.7152 * f(parseInt(s.slice(2, 4), 16)) +
        0.0722 * f(parseInt(s.slice(4, 6), 16));
}

function contraste(a, b) {
    const l1 = luminancia(a);
    const l2 = luminancia(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const CLARA = '#ffffff';
const OSCURA = '#0a0c10';

/** La tinta que mejor se lee encima de un color: blanca o casi negra. */
export function tintaSobre(hex) {
    return contraste(CLARA, hex) >= contraste(OSCURA, hex) ? CLARA : OSCURA;
}

/**
 * Las dos variables CSS de una vista, listas para un `style=""`.
 *
 * Van como variables y no como colores sueltos para que el CSS decida qué
 * hacer con ellas —el tinte del bloque, el relleno de la sigla, el botón
 * elegido— y este archivo solo diga cuál es el color.
 */
export function estiloDeVista(vistas, nombre) {
    const c = coloresDeVista(vistas, nombre);
    return c ? `--vista:${c.color};--vista-tinta:${c.tinta}` : '';
}

/**
 * Lo mismo pero sin envolverlo en CSS, para quien pone las variables a mano.
 *
 * Lo pide el transcript: la marca de la toma anterior y sus palabras llevan el
 * color de la vista de ESA toma, y `texto-toma.js` las escribe con
 * `setProperty` sobre el elemento que ya tiene (ver `limiteDe`), no con un
 * `style=""` en una plantilla.
 */
export function coloresDeVista(vistas, nombre) {
    const v = (vistas || []).find(x => x.nombre === nombre) || (vistas || [])[0];
    if (!v) return null;
    const hex = (temaNuevo() && EN_EL_TEMA_NUEVO[v.nombre]) || hexDeMarcador(v.colorDeMarcador);
    return { color: hex, tinta: tintaSobre(hex) };
}

/**
 * Los colores que el tema nuevo cambia, y solo en la pantalla.
 *
 * El rojo de «Profesor» es la vista de casi todas las tomas, y una lista entera
 * de bloques rojos se lee densa y como si avisara algo. En el tema nuevo va
 * cerúleo, que es la etiqueta de Premiere con la que la cámara del profesor ya
 * llega al proyecto (`ETIQUETA_DE_VISTA` en `engine/prproj-plan.js`). El
 * marcador del XML sigue rojo: esto no sale de la ventana.
 */
const EN_EL_TEMA_NUEVO = {
    PV: '#2fbfde'
};

/**
 * Se mira la clase del documento y no `tema.js`: este archivo también se
 * evalúa fuera de la ventana (`tools/contrastes.js`, los tests), donde no hay
 * ni documento ni preferencias, y ahí vale el color de siempre.
 */
function temaNuevo() {
    return typeof document !== 'undefined' && Boolean(document.body) && document.body.classList.contains('tema-nuevo');
}
