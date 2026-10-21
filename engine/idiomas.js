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

/* ─── Lo que se oye mientras se graba ────────────────────────────────────
 *
 * Qué pedirle a Whisper, qué hacer cuando contesta otro idioma y cuándo creer
 * que el profesor cambió de idioma. Estaba repartido entre `oir.js`,
 * `ciclo-senales.js` y `grabacion.js`, y repartido ya pagaba una pasada de
 * Whisper de más y dejaba que un silencio cortara la cuenta. Acá decide; los
 * otros tres solo hacen lo que esto contesta.
 */

/**
 * Qué idioma pedirle a Whisper esta pasada.
 *
 * **Detectar cuesta 400 ms por pasada y vigilar sale gratis**, así que
 * «Automático» no pide `auto` todas las veces: pide `auto` cuando todavía no
 * sabe nada, y después pide el que viene oyendo —que es rápido— sin dejar de
 * mirar el `detected_language` que el servidor contesta igual (ver
 * `oido-residente.transcribir`). Medido el 20/10: 1214 ms con `auto` contra
 * 871 ms con el idioma puesto, sobre la misma ventana de seis segundos. Esa es
 * la razón por la que ahora es lo de fábrica (ver `ajustes.js`).
 *
 * Sin idioma escrito se pide español, y no `auto`, por las sesiones de antes de
 * que existiera: eran todas en español, que era lo de fábrica.
 *
 * @param {{idioma:string, oyendo:string|null, liviano:boolean}} p
 */
function quePedir(p) {
    if (p.idioma !== 'auto') return p.idioma || 'es';
    // Una relectura siempre pregunta: es una por toma, con la toma entera
    // delante —donde detectar acierta mucho más que en seis segundos— y los
    // 400 ms no se los lleva nadie que esté mirando.
    if (!p.liviano) return 'auto';
    return AUTOMATICOS.includes(p.oyendo) ? p.oyendo : 'auto';
}

/**
 * Con `auto`, lo que se oyó llevado a español o inglés, y con qué volver a leer
 * la ventana si lo que se pidió no era eso.
 *
 * Un portugués detectado sobre una clase en español no es una clase en
 * portugués: es una ventana de seis segundos que se parece. Dejarlo pasar no
 * agrega un idioma, TRADUCE la clase entera. Así que lo oído se lleva al de los
 * dos al que más se parezca (`entreEsEIn`), y la ventana se vuelve a leer con
 * ese, **salvo que sea justo el que se pidió**: con el idioma ya asentado se
 * pide «es», el servidor igual contesta qué detectó, y releer en «es» lo que se
 * acaba de leer en «es» eran 870 ms para el mismo texto.
 *
 * Lo oído queda en español o inglés aunque la segunda lectura falle: con un
 * «pt» la barra diría «Auto · PT», y la pasada siguiente volvería a pedir
 * `auto` para siempre, porque «pt» no está entre los que `auto` sigue.
 *
 * @param {{idioma:string, pedido:string, oido:string|null, pesos:object|null, oyendo:string|null}} p
 * @returns {{oido:string|null, releerCon:string|null}}
 */
function enAutomatico(p) {
    if (p.idioma !== 'auto' || !p.oido || AUTOMATICOS.includes(p.oido)) {
        return { oido: p.oido, releerCon: null };
    }
    const cual = entreEsEIn(p.oido, p.pesos, p.oyendo);
    return { oido: cual, releerCon: cual === p.pedido ? null : cual };
}

/**
 * Cuántas pasadas seguidas tiene que sonar otro idioma para creerle.
 *
 * Una sola no alcanza: en una clase en español, seis segundos leyendo en voz
 * alta un error de la consola suenan a inglés de verdad, y con eso el rótulo
 * de la barra se pondría a parpadear. Dos seguidas ya son doce segundos
 * hablando en el otro idioma, que es un cambio y no una cita.
 */
const PASADAS_PARA_CAMBIAR = 2;

/**
 * Qué idioma se está oyendo después de esta pasada, con la histéresis de arriba.
 *
 * Vale igual con el idioma puesto a mano y con `auto`, y es a propósito: con
 * `auto` es lo que decide qué pedir la pasada siguiente, y con el idioma puesto
 * es lo que deja que la barra avise «lo tenés en español y suena a inglés».
 *
 * **Un silencio no corta la cuenta.** Una pasada sin nada que oír no dice que
 * se volvió al idioma de antes: dice que nadie habló. Contándolo como «otra
 * cosa», una pausa entre dos ventanas en inglés hacía empezar de cero.
 *
 * @param {string|null} actual lo que se viene oyendo
 * @param {{idioma:string, seguidas:number}|null} racha el otro que viene sonando
 * @param {string|null} oido lo de esta pasada; null si no se oyó nada
 * @returns {{oido:string|null, racha:object|null}}
 */
function anotarOido(actual, racha, oido) {
    if (!oido) return { oido: actual, racha };
    if (oido === actual) return { oido: actual, racha: null };
    const seguidas = (racha && racha.idioma === oido ? racha.seguidas : 0) + 1;
    if (seguidas >= PASADAS_PARA_CAMBIAR) return { oido, racha: null };
    return { oido: actual, racha: { idioma: oido, seguidas } };
}

module.exports = {
    IDIOMAS,
    AUTOMATICOS,
    PASADAS_PARA_CAMBIAR,
    normalizar,
    esElegible,
    entreEsEIn,
    quePedir,
    enAutomatico,
    anotarOido
};
