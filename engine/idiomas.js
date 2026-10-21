'use strict';
/**
 * idiomas.js — Qué idioma habla la clase, dicho de una sola manera.
 *
 * Existe porque el idioma se nombra en cinco sitios con tres formas distintas:
 * los ajustes y el sidecar lo guardan como «es», `whisper-cli` lo contesta como
 * «es», y `whisper-server` lo contesta como «spanish». Con la traducción
 * repartida, cada sitio la hacía un poco distinto y comparar «es» contra
 * «spanish» daba siempre «cambió de idioma».
 *
 * **Los dos que la app oye son el español y el inglés.** No es un límite de
 * Whisper —entiende cien— sino de para qué sirve detectar: en una ventana de
 * seis segundos, un español lleno de términos técnicos en inglés se puede
 * confundir con un italiano o un portugués, y entonces el transcript sale
 * TRADUCIDO. Medido el 20/10 sobre dos clases reales: audio en inglés pedido
 * en español salió «¿Qué es el skill prompt que se ha añadido?», y el mismo
 * audio en portugués salió en portugués. Un idioma de más en la lista no es
 * una opción más: es una manera nueva de arruinar una clase. El portugués se
 * puede elegir a mano, que es otra cosa: ahí alguien lo decidió.
 */

/** Lo que se puede elegir a mano, además de `auto`. */
const IDIOMAS = ['es', 'en', 'pt'];

/** Entre los que decide `auto`, y el porqué está arriba. */
const AUTOMATICOS = ['es', 'en'];

/** Cómo se llaman, para la pantalla. */
const NOMBRES = { es: 'Español', en: 'Inglés', pt: 'Portugués', auto: 'Automático' };

/** Y en dos letras mayúsculas, que es lo que cabe en la barra. */
const SIGLAS = { es: 'ES', en: 'EN', pt: 'PT' };

/**
 * Los nombres con que `whisper-server` contesta. Solo los que nos importan: lo
 * que no esté acá se normaliza a null, que es «no sé», y no a una adivinanza.
 */
const DE_WHISPER = {
    spanish: 'es', castilian: 'es',
    english: 'en',
    portuguese: 'pt'
};

/**
 * Un código de idioma de los nuestros, venga como venga, o null.
 *
 * Acepta «es», «ES», «es-419», «spanish» y «Spanish». Lo que no reconoce
 * devuelve null en vez de adivinar: quien llama decide qué hacer sin saber, y
 * eso es mejor que arrancar `whisper-server` con un `-l` que no entiende, que
 * no arranca —y sin servidor no hay ni «3, 2, 1» ni transcript.
 */
function normalizar(valor) {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim().toLowerCase();
    if (!limpio) return null;
    if (DE_WHISPER[limpio]) return DE_WHISPER[limpio];
    // «es-419», «en-US»: la región no cambia con qué modelo se transcribe.
    const dos = limpio.split(/[-_]/)[0];
    return IDIOMAS.includes(dos) ? dos : null;
}

/** Si es algo que se puede guardar como ajuste o como idioma de una sesión. */
function esElegible(valor) {
    return valor === 'auto' || IDIOMAS.includes(valor);
}

/**
 * Entre los que `auto` elige, el que más se le parezca a lo que se oyó.
 *
 * `probabilidades` es lo que manda `whisper-server` (`language_probabilities`):
 * cuánto se parece el audio a cada idioma. Con un portugués detectado, lo que
 * decide es si ese audio se parece más al español o al inglés, que casi siempre
 * contesta bien —un español con palabras en inglés da «es» por mucho—. Sin
 * probabilidades se queda con `deRespaldo`, que es lo que se venía oyendo.
 */
function entreEsEIn(oido, probabilidades, deRespaldo) {
    if (AUTOMATICOS.includes(oido)) return oido;
    const p = probabilidades || {};
    const conPeso = AUTOMATICOS.filter(l => typeof p[l] === 'number');
    if (conPeso.length) return conPeso.reduce((a, b) => (p[b] > p[a] ? b : a));
    return AUTOMATICOS.includes(deRespaldo) ? deRespaldo : AUTOMATICOS[0];
}

/** Cómo se dice en la pantalla: «Español», «Automático». */
function nombre(codigo) {
    return NOMBRES[codigo] || codigo;
}

/** Y en la barra, donde solo caben dos letras: «ES», o «Auto · ES». */
function sigla(idioma, oido) {
    if (idioma !== 'auto') return SIGLAS[idioma] || String(idioma || '').toUpperCase();
    return oido && SIGLAS[oido] ? `Auto · ${SIGLAS[oido]}` : 'Auto';
}

module.exports = {
    IDIOMAS,
    AUTOMATICOS,
    NOMBRES,
    SIGLAS,
    normalizar,
    esElegible,
    entreEsEIn,
    nombre,
    sigla
};
