'use strict';
/**
 * idiomas.js — Cómo se llama cada idioma en la pantalla.
 *
 * Es el lado de la ventana de `engine/idiomas.js`, y está duplicado por lo
 * mismo que `tools/maqueta/datos.js`: el motor es CommonJS y esto son módulos
 * que carga el navegador, así que no se pueden importar entre sí. Lo que vive
 * acá es cómo se dicen, su rótulo y cómo se cambian desde la ventana; qué
 * idiomas hay y cuál se le pide a Whisper lo decide el motor, que es quien
 * transcribe.
 *
 * **Que no se separen lo comprueba una prueba** (`tests/idioma-en-vivo.test.js`):
 * si alguien agrega un idioma de un lado y no del otro, la suite lo caza. Sin
 * eso, la barra ofrecería un idioma que el motor rechaza, o al revés.
 */

/** Lo que se puede elegir a mano. `auto` va aparte: no es un idioma, es una decisión. */
export const IDIOMAS = ['es', 'en', 'pt'];

/** Entre los que decide `auto`. El porqué está en `engine/idiomas.js`. */
export const AUTOMATICOS = ['es', 'en'];

const NOMBRES = { es: 'Español', en: 'Inglés', pt: 'Portugués', auto: 'Automático' };
const SIGLAS = { es: 'ES', en: 'EN', pt: 'PT' };

/** «Español», «Automático». */
export function nombre(codigo) {
    return NOMBRES[codigo] || codigo;
}

/**
 * Y en la barra, donde solo caben dos letras.
 *
 * Con `auto` dice además cuál está oyendo —«Auto · EN»— porque «Automático» a
 * secas no contesta la pregunta que uno se hace al mirar, que es en qué idioma
 * está saliendo el transcript ahora mismo.
 */
export function sigla(idioma, oido) {
    if (idioma !== 'auto') return SIGLAS[idioma] || String(idioma || '').toUpperCase();
    return oido && SIGLAS[oido] ? `Auto · ${SIGLAS[oido]}` : 'Auto';
}

/**
 * El rótulo del idioma, para `rotulo-barra.rotulo`. Es el mismo en la clase y
 * en el vídeo semanal; cambia el id, que es de cada barra.
 *
 * Angosto dice solo las dos letras, que es la pregunta de verdad —en qué idioma
 * está saliendo el transcript—: que lo haya elegido solo se lee en el menú.
 *
 * En ámbar si el idioma está puesto a mano y suena otro. No es un error —se
 * puede estar citando— pero con el idioma equivocado Whisper traduce la clase
 * entera (ver `engine/idiomas.js`), así que tiene que verse de reojo.
 *
 * @param {string} id el del botón
 * @param {string} puesto el elegido: uno de `IDIOMAS` o `auto`
 * @param {string|null} oido lo que se está oyendo, si ya se sabe
 */
export function rotulo(id, puesto, oido) {
    const discrepa = puesto !== 'auto' && Boolean(oido) && oido !== puesto;
    const como = l => nombre(l).toLowerCase();
    return {
        id,
        hace: 'idioma',
        que: 'Idioma',
        icono: 'idioma',
        dice: sigla(puesto, oido),
        corto: sigla(puesto === 'auto' ? (oido || 'auto') : puesto, oido),
        avisa: discrepa,
        pista: discrepa
            ? `Lo tenés en ${como(puesto)} y suena a ${como(oido)}. Con el idioma equivocado `
                + 'el transcript sale TRADUCIDO: tocá acá para cambiarlo.'
            : `En qué idioma oye${puesto === 'auto' && oido
                ? `: lo está eligiendo solo y ahora oye ${como(oido)}`
                : ''}. Tocá para cambiarlo: pregunta si releer lo que ya cerraste.`
    };
}

/**
 * Las opciones del menú del rótulo, con la puesta marcada.
 *
 * `auto` primero porque es lo de fábrica y lo que casi siempre conviene; los
 * tres puestos debajo, para quien sabe lo que da la clase.
 */
export function opciones(puesto) {
    return [{
        valor: 'auto',
        dice: 'Automático (español o inglés)',
        pista: 'Lo detecta solo y cambia si el profesor cambia de idioma. '
            + 'Entre esos dos nada más: un portugués detectado sobre una clase en español '
            + 'no agrega un idioma, traduce la clase.'
    }].concat(IDIOMAS.map(l => ({
        valor: l,
        dice: nombre(l),
        pista: `La clase entera en ${nombre(l).toLowerCase()}.`
    }))).map(o => ({ ...o, marcada: o.valor === puesto }));
}

/**
 * Cambia el idioma de lo que se está grabando, la clase o el vídeo semanal.
 *
 * Cambiar el idioma y releer son dos cosas, y la segunda pisa trabajo hecho: el
 * texto de las tomas cerradas es el que va al Premiere. Quien se da cuenta a
 * mitad de que el idioma está mal quiere arreglarlo sin miedo a romper lo que
 * ya salió bien, así que se le pregunta. Son tres respuestas y no dos —releer,
 * seguir de acá en adelante, o no tocar nada—, por eso es `preguntar` y no
 * `confirmar`. Sin ninguna toma cerrada no hay nada que elegir y no pregunta:
 * un diálogo de más en medio de una clase estorba.
 *
 * Lo pregunta la ventana y no el motor porque el motor no tiene a quién
 * preguntarle: `grabacion.cambiarIdioma` recibe ya la respuesta.
 *
 * Lo que queda en cada pantalla es lo que es de cada una: dónde se guarda para
 * la próxima vez y cómo se repinta.
 *
 * @param {string} cual el idioma nuevo
 * @param {Array} tomas las de la sesión, para contar las cerradas
 * @returns {Promise<null|{ok:false, error:string}|{ok:true, estado:object, aviso:string}>}
 *   `null` si cancelaron, que no cambia nada.
 */
export async function cambiar(cual, tomas) {
    const cerradas = (tomas || []).filter(t => t.outMs != null && !t.descartada).length;
    const dicho = cerradas ? await preguntarSiReleer(cerradas, cual) : 'desde-aca';
    if (!dicho) return null;
    const r = await window.nt.grabarIdioma(cual, { releer: dicho === 'releer' });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'No se pudo cambiar el idioma.' };
    return { ok: true, estado: r.estado, aviso: avisoDelCambio(cual, r.releyendo, cerradas) };
}

function preguntarSiReleer(cuantas, a) {
    const tomas = cuantas === 1 ? '1 toma' : `${cuantas} tomas`;
    return window.nt.preguntar({
        titulo: `¿Releer lo que ya se grabó en ${nombre(a).toLowerCase()}?`,
        mensaje: `Hay ${tomas} ya cerrada${cuantas === 1 ? '' : 's'}, y su texto es el que `
            + 'va al Premiere. Releerlas lo rehace con el idioma nuevo y tarda un rato; '
            + 'si no, el idioma vale de acá en adelante y lo de atrás se queda como está.',
        opciones: [
            { valor: 'releer', dice: `Releer ${tomas}` },
            { valor: 'desde-aca', dice: 'Solo de acá en adelante' }
        ]
    });
}

/** Lo que se avisa después: releer tarda, así que se dice cuántas. */
function avisoDelCambio(cual, releyendo, cerradas) {
    const como = nombre(cual).toLowerCase();
    if (releyendo) {
        const s = releyendo === 1 ? '' : 's';
        return `Sigue en ${como}. Releyendo ${releyendo} toma${s} ya cerrada${s}.`;
    }
    if (cerradas) return `Sigue en ${como} de acá en adelante. Lo de antes queda como está.`;
    return `Sigue en ${como}.`;
}
