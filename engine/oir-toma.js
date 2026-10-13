'use strict';
/**
 * oir-toma.js — Oír un tramo del reloj de pared, y oír una toma con sus orillas.
 *
 * Es la única pieza de la grabación que no sabe nada de la sesión: recibe la
 * lista de archivos de captura donde buscar, y nada más. Está aparte justamente
 * por eso — la usan los dos lados que necesitan volver a escuchar el audio, y
 * son lados que no se conocen entre sí: el ciclo de una sesión en curso
 * (`grabacion.js`, `relecturas.js`) y una sesión que terminó hace meses y se
 * manda a regenerar (`sesiones-grabadas.js`). Con esto adentro de la sesión,
 * regenerar tendría que entrar por una puerta que pide una sesión que no existe.
 */

const fs = require('fs');

const captura = require('./captura');
const insistir = require('./insistir');
const oir = require('./oir');
const paths = require('./paths');
const registro = require('./registro');
const vivo = require('./notas-vivo');

/**
 * Cuánto se guarda de lo que se dijo justo antes y justo después de una toma.
 *
 * Es lo que deja mover un borde MIRANDO. Con el texto recortado exactamente en el
 * IN y en el OUT, correr un borde es adivinar: no se ve la frase que quedó
 * afuera, que es justo la que dice si el corte está bien puesto. Doce segundos
 * son unas treinta palabras a la velocidad del curso —más de lo que un borde se
 * corre nunca, porque el error típico es de una frase— y para Whisper siguen
 * siendo el mismo recorte corto (`oir.js`: el largo casi no cambia lo que tarda).
 */
const ORILLA_MS = 12000;

/**
 * Un tramo del reloj de pared, transcripto.
 *
 * Se busca en qué archivo está: el que se está escribiendo o alguno ya cerrado
 * (`estado.sesiones`). Lo segundo es lo que permite releer la última toma de una
 * clase después de cerrar el audio, en `terminar`.
 */
function tramo(archivos, desdeMs, hastaMs, liviano, idioma) {
    const donde = captura.laQueContiene(archivos, desdeMs);
    if (!donde) return Promise.resolve(null);
    return oir.escuchar({ sesion: donde, desdeMs, hastaMs, liviano, idioma });
}

/**
 * El texto de una toma, con un poco de lo que se dijo antes y después.
 *
 * **Una sola pasada de Whisper, no tres.** Partir el audio en la raya del IN le
 * quita el contexto de la frase justo en el único sitio donde importa: el borde
 * mal puesto. Se pide el tramo entero con orillas y se reparte después, así que
 * la frase que cruza el corte se transcribe una vez y entera.
 *
 * El tramo se recorta a lo que el archivo tiene. La primera toma de una clase
 * empieza a pocos segundos del principio del WAV, y `captura.recorte` no sirve
 * tramos que no existen: sin recortar, pedir doce segundos antes devolvía null y
 * la toma se quedaba con el texto del ciclo liviano, que es el descartable.
 *
 * **Y una pasada que se muere no deja la toma en silencio.** Es la política de
 * `engine/insistir.js` y se obedece acá porque esta es la única puerta por la que
 * se vuelve a oír una toma: la usan la clase en curso (`relecturas.js`) y la que
 * se manda a regenerar (`clases-grabadas.js`), que no se conocen entre sí. Con la
 * política en cada uno de los dos, el que se escribiera después la resolvería de
 * otra manera — que es exactamente lo que le pasó al criterio de la GPU antes de
 * que se juntara en `engine/gpu.js`.
 *
 * Lo que devuelve dice las tres cosas que pueden pasar, y `relectura` es la única
 * que cambia de forma:
 *
 *   null                                sin audio donde buscar esta toma
 *   {..., relectura: null}              salió con el modelo bueno, que es lo normal
 *   {..., relectura: {degradada}}       salió, con un modelo más liviano
 *   {relectura: {sin-leer}}             sin palabras: no salió con ninguno
 *
 * En los tres que traen `relectura` va como campo y no como excepción a
 * propósito: los dos que llaman hacen `Object.assign(toma, leido)`, así que un
 * `relectura: null` BORRA la marca de una vuelta anterior. Eso es lo que hace que
 * "Regenerar" limpie sola la marca de la toma que arregla.
 *
 * @param {Array} archivos las sesiones de captura donde buscar (`captura.laQueContiene`)
 * @param {object} [opciones] { esperaMs, idioma } — `esperaMs` es cuánto esperar
 *   entre dos intentos y solo lo pasan las pruebas, para no tardar los 4,25 s de
 *   verdad en cada una; en la app manda `insistir.ESPERA_MS`, que es el razonado.
 * @returns {Promise<{antes, palabras, despues, colapsadas, relectura}|{relectura}|null>}
 */
async function leer(archivos, toma, opciones) {
    const o = opciones || {};
    const donde = captura.laQueContiene(archivos, toma.inMs);
    if (!donde || !fs.existsSync(donde.archivo)) return null;

    const finDelArchivo = donde.desdeMs + (donde.segundos || 0) * 1000;
    const pedido = {
        sesion: donde,
        desdeMs: Math.max(donde.desdeMs, toma.inMs - ORILLA_MS),
        hastaMs: Math.min(finDelArchivo, toma.outMs + ORILLA_MS),
        liviano: false,
        idioma: o.idioma
    };

    const bueno = paths.whisperModel();
    let modelo = bueno;
    let yaInsistio = false;
    let ultimoMotivo = '';
    let hastaDonde = null;

    for (;;) {
        try {
            const oido = await oir.escuchar({ ...pedido, modelo });
            if (!oido) return null;
            // **Lo que los filtros tiraron, dicho.** No va en lo que devuelve
            // —los dos que llaman hacen `Object.assign(toma, leido)` y esto
            // terminaría guardado en el sidecar— sino al diario, que es donde
            // hace falta: el filtro de nivel es el único sitio capaz de hacer
            // desaparecer algo que el profesor dijo, y hasta que esto existió lo
            // hacía sin dejar rastro. Solo cuando hay algo que contar: una
            // lectura limpia no escribe nada.
            if ((oido.mudas || 0) > 0 || (oido.inventadas || []).length) {
                registro.anotar('main', 'lectura.filtrada', {
                    toma: toma && toma.id != null ? toma.id : null,
                    mudas: oido.mudas || 0,
                    // Las primeras, con el nivel al que sonaban y el corte contra
                    // el que se las midió: con eso se sabe si el corte estaba mal
                    // puesto o si de verdad no sonaba nada.
                    quitadas: (oido.quitadas || []).slice(0, 12),
                    inventadas: oido.inventadas || []
                });
            }
            const palabras = await rescatarHuecos(oido, { ...pedido, modelo }, toma);
            return {
                ...vivo.repartir(palabras, toma),
                colapsadas: oido.colapsadas || 0,
                relectura: modelo.name === bueno.name ? null : insistir.degradada({
                    modelo: modelo.name, bueno: bueno.name, detalle: ultimoMotivo
                })
            };
        } catch (err) {
            // Cancelar es un gesto de una persona y no una falla: sube tal cual,
            // que es lo que ya hacía y lo que espera quien apretó.
            if (err && err.code === 'cancelado') throw err;

            ultimoMotivo = err.message;
            const muerte = insistir.comoSeMurio(err);
            const abajo = muerte ? paths.escalonDebajo(modelo) : null;
            const paso = insistir.queHacer({
                muerte,
                conElBueno: modelo.name === bueno.name,
                yaInsistio,
                hayEscalon: Boolean(abajo)
            });

            // Al diario, porque esto pasa callado y explica cosas raras. Una
            // corrida que tardó el triple, o una toma con el texto peor que las
            // de al lado, se entienden al ver que acá se bajó de modelo; sin la
            // línea, lo único que queda es una clase que salió distinta y ninguna
            // pista de por qué. Son eventos raros: no inundan.
            registro.anotar('main', 'whisper.se-murio', {
                toma: toma && toma.id != null ? toma.id : null,
                modelo: modelo.name,
                muerte,
                hacemos: paso.que,
                detalle: ultimoMotivo
            });

            if (paso.que === 'rendirse') {
                return {
                    relectura: insistir.sinLeer({
                        bueno: bueno.name, hastaDonde, detalle: ultimoMotivo
                    })
                };
            }
            if (paso.que === 'insistir') {
                yaInsistio = true;
                await dormir(o.esperaMs == null ? paso.esperaMs : o.esperaMs);
                continue;
            }
            modelo = abajo;
            hastaDonde = abajo.name;
        }
    }
}

/* ─── Los huecos con voz ─────────────────────────────────────────────────── */

/**
 * Cuántos huecos se rescatan por toma, como mucho.
 *
 * Cada uno es una pasada más de Whisper. Tres son unos segundos y cubren el
 * caso real —una toma con un par de pausas largas—; una toma con quince huecos
 * con voz no tiene un problema de huecos, tiene un problema de audio, y
 * quince pasadas más no lo arreglan.
 */
const HUECOS_MAX = 3;

/** Lo que se le da de margen a cada lado del hueco al volver a leerlo. */
const MARGEN_DE_HUECO_MS = 1500;

/** Dos palabras son la misma si dicen lo mismo y caen así de cerca. */
const MISMA_PALABRA_MS = 500;

const comoSuena = texto => String(texto || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Vuelve a leer los tramos donde se oyó hablar y no quedó ninguna palabra.
 *
 * El caso real está contado en `sonido.huecosConVoz`: leyendo la toma entera,
 * Whisper le puso a cinco palabras la misma hora en mitad de un silencio de
 * siete segundos, el filtro de nivel tiró las cuatro que caían ahí, y se
 * perdieron dos palabras dichas. Releído solo ese tramo, el modelo las pone en
 * su sitio: un recorte corto no le deja dónde descolocarlas.
 *
 * **Va acá y no en `oir.escuchar`** porque es caro: una pasada más de Whisper
 * por hueco. El ciclo en vivo corre cada segundo y no se lo puede permitir —y
 * tampoco le hace falta, su texto es el descartable—; la relectura de una toma
 * pasa una vez y es la que queda escrita en el XML.
 *
 * Lo rescatado se mete en orden y sin repetir: el tramo nuevo se solapa con la
 * lectura grande a propósito —para que la frase entre entera— así que las
 * palabras de los bordes vuelven a salir.
 *
 * @returns {Promise<Array>} las palabras de la toma, con los huecos rellenos
 */
async function rescatarHuecos(oido, pedido, toma) {
    const huecos = (oido.huecos || []).slice(0, HUECOS_MAX);
    if (!huecos.length) return oido.palabras;

    let palabras = oido.palabras;
    for (const h of huecos) {
        let extra = null;
        try {
            extra = await oir.escuchar({
                ...pedido,
                desdeMs: Math.max(pedido.desdeMs, h.desdeMs - MARGEN_DE_HUECO_MS),
                hastaMs: Math.min(pedido.hastaMs, h.hastaMs + MARGEN_DE_HUECO_MS)
            });
        } catch (err) {
            // Un hueco que no se pudo releer deja la toma como estaba, que es lo
            // que había antes de que esto existiera. No se insiste ni se baja de
            // modelo: de eso se ocupa la lectura grande, que es la que importa.
            extra = null;
        }
        const dentro = ((extra && extra.palabras) || [])
            .filter(w => w.t >= h.desdeMs && w.t < h.hastaMs)
            .filter(w => !palabras.some(y => Math.abs(y.t - w.t) < MISMA_PALABRA_MS
                && comoSuena(y.texto) === comoSuena(w.texto)));
        if (!dentro.length) continue;
        palabras = palabras.concat(dentro).sort((a, b) => a.t - b.t);
        registro.anotar('main', 'lectura.hueco-rescatado', {
            toma: toma && toma.id != null ? toma.id : null,
            desdeMs: h.desdeMs,
            segundos: Math.round((h.hastaMs - h.desdeMs) / 100) / 10,
            vozMs: h.vozMs,
            palabras: dentro.map(w => w.texto)
        });
    }
    return palabras;
}

/**
 * La espera entre dos intentos.
 *
 * El reloj se deja atado al proceso a propósito, al revés del techo de
 * `medir-toma.conTecho`: ahí el `setTimeout` es un plazo que puede sobrar y
 * dejarlo suelto colgaba el cierre; acá es la espera misma, y soltarlo
 * —`unref`— dejaría que el proceso terminara en medio, con la toma perdida y sin
 * que nada avisara. Que "Terminar" espere estos cuatro segundos es correcto:
 * `cerrarSesion` espera la fila entera justamente para no soltar una clase con
 * tomas a medio releer, y esta es la última oportunidad que tiene esa toma.
 */
function dormir(ms) {
    return ms ? new Promise(listo => setTimeout(listo, ms)) : Promise.resolve();
}

module.exports = { ORILLA_MS, tramo, leer };
