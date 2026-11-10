'use strict';
/**
 * vivo/senales.js — Las señales que se dicen: la cuenta, las frases de abrir, cerrar y cambiar de vista, y el cue de cada toma.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { norm } = require('../texto');
const { limpio, palabra, textoDe } = require('./palabras');
const { VISTAS } = require('./vistas');

/**
 * Las palabras con las que el profesor abre y cierra.
 *
 * El conteo no se busca con `COUNT_RUN` de `tools/rodecaster-xml.js` porque esa
 * expresión está anclada al principio de un comentario ya escrito; acá hay que
 * encontrarlo en el medio de un río de palabras. Tampoco con `speech-edges.conteosEn`, que
 * también busca conteos sueltos, porque en vivo hacen falta dos cosas que en post
 * no: que la cuenta TERMINE en uno (ver `senales`) y tolerar los puntos
 * suspensivos con que Whisper cierra un "1...". Lo que se busca es lo mismo: dos
 * o más números seguidos hacia abajo, que es lo que nadie dice por casualidad.
 *
 * La puntuación de atrás no cuenta, y va con `*` y no con `?` porque Whisper
 * escribe puntos suspensivos: en el curso salió "3, 2, 1..." y con un solo signo
 * permitido el "1..." no era un número, el conteo se quedaba en "3, 2" y la toma
 * no se abría. Lo encontró la simulación sobre el audio de verdad.
 *
 * **En los dos idiomas.** Una clase puede pasarse al inglés a mitad de frase,
 * y el conteo se le pasa con ella: medido con el residente, el
 * modelo escribe los números como dígitos en los dos idiomas —«Okay. 3, 2, 1.
 * So this week…»— así que la mayoría de las veces alcanza con lo que ya había.
 * Las palabras van igual, por las veces que no: «three» no es «3» y una toma
 * que no abre es una toma perdida. «one» no se acepta suelta por lo mismo que
 * «uno» —tiene que cerrar una cuenta de dos o más— y por eso no lo dispara
 * «one of the problems».
 */
const CUENTA = /^(?:3|2|1|tres|dos|uno|three|two|one)[.,…!?]*$/i;

/**
 * Las frases que abren, cierran y cambian de vista, como vienen de fábrica.
 *
 * Se editan en Ajustes (`engine/ajustes.js` las sanea) y se pueden cambiar con
 * la clase andando: la pasada siguiente del ciclo ya oye las nuevas.
 *
 * «Pausa» y «Pause» son la misma palabra dicha en los dos idiomas, y el riesgo
 * es el mismo: lo que separa la señal de «acá hacemos una pausa» es el silencio
 * detrás, no la palabra (ver `SILENCIO_TRAS_PAUSA_SEC`).
 *
 * La cuenta no es una frase sino un patrón —cualquier cuenta hacia abajo que
 * termine en uno—, así que va como un interruptor.
 */
const FRASES_DE_FABRICA = Object.freeze({
    cuenta: true,
    abrir: Object.freeze(['retomamos']),
    cerrar: Object.freeze(['pausa', 'pause']),
    vista: Object.freeze([])
});

/** Las palabras de una frase, comparables: sin mayúsculas, acentos ni signos. */
function palabrasDeFrase(frase) {
    return String(frase == null ? '' : frase).split(/\s+/).map(norm).filter(Boolean);
}

/**
 * Las frases, listas para buscarlas en lo que se oye.
 *
 * Se busca la frase pegada —«vamosanuestrapantalla»— sobre las palabras
 * pegadas, y no palabra por palabra: Whisper a veces parte una palabra en dos
 * («re» «tomamos») o junta dos en una, y la frase es la misma. Las más largas
 * primero: «pausa larga» tiene que ganarle a «pausa».
 *
 * @param {object} [frases] las de Ajustes; sin ellas, las de fábrica
 */
function reglasDeFrases(frases) {
    const f = frases || FRASES_DE_FABRICA;
    const de = (lista, tipo) => (Array.isArray(lista) ? lista : []).map(x => {
        const texto = typeof x === 'string' ? x : (x && x.frase);
        const palabras = palabrasDeFrase(texto);
        return { tipo, texto: limpio(texto), pegada: palabras.join(''), palabras: palabras.length, vista: x && x.vista };
    }).filter(r => r.pegada && (tipo !== 'vista' || VISTAS.some(v => v.nombre === r.vista)));
    return {
        cuenta: f.cuenta !== false,
        frases: de(f.abrir, 'abre').concat(de(f.cerrar, 'cierra'), de(f.vista, 'vista'))
            .sort((a, b) => b.pegada.length - a.pegada.length)
    };
}

/**
 * Si desde la palabra `i` se dijo esa frase: hasta qué palabra llega, o -1.
 *
 * Las palabras que el modelo devuelve vacías —un «…» suelto— no cortan la frase.
 * Las citadas sí (ver adentro).
 */
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

/**
 * "Ok" delante del conteo es parte de la señal, no de la clase.
 *
 * Con «y» porque en inglés el modelo lo escribe «Okay» —se midió, está en
 * «Okay. 3, 2, 1. So this week…»— y sin ella el conteo quedaba detrás de una
 * palabra que no era ni señal ni número.
 */
const OK = /^ok(?:ay)?[.,…!?]*$/i;

/** Cuántos números seguidos hacen una cuenta. Uno solo es habla. */
const MINIMO_DE_CUENTA = 2;

/** Cuánto vale cada palabra de la cuenta, para saber si va hacia abajo. */
const VALOR = { 3: 3, tres: 3, three: 3, 2: 2, dos: 2, two: 2, 1: 1, uno: 1, one: 1 };

function valorDeCuenta(texto) {
    const limpia = String(texto).toLowerCase().replace(/[.,…!?]+$/, '');
    return VALOR[limpia];
}

/**
 * Dos señales del mismo tipo más cerca que esto son la misma señal oída dos veces.
 *
 * El ciclo de señales escucha ventanas que se solapan, así que un conteo que caiga
 * en el borde aparece en dos pasadas seguidas — eso es a propósito, es lo que
 * evita perderlo partido. Lo que hace falta es no abrir dos tomas con él, y no se
 * puede comparar el tiempo exacto porque Whisper no devuelve el mismo número en
 * las dos pasadas (unas décimas de diferencia). Dos segundos separan de sobra dos
 * conteos de verdad: entre uno y el siguiente hay una toma entera.
 */
const MISMA_SENAL_MS = 2000;

/**
 * Cuánto silencio tiene que seguir a "Pausa" para creerle.
 *
 * El profesor puede decir "pausa" hablando de otra cosa —"acá hacemos una pausa
 * en el flujo"— y cerrar la toma ahí partiría la clase al medio. Lo que
 * distingue la señal es que después no se dice nada: el profesor para. Un segundo
 * alcanza y no obliga a esperar.
 */
const SILENCIO_TRAS_PAUSA_SEC = 1;

/**
 * Las señales que hay en una tirada de palabras, en orden.
 *
 * Devuelve rangos de índices y no tiempos porque quien decide qué hacer con una
 * señal necesita saber qué palabras la forman: el IN va DESPUÉS de la última
 * palabra del conteo y el OUT ANTES de "Pausa", así que la señal misma nunca
 * queda adentro de la toma. Es lo mismo que el motor hace en post
 * (`speech-edges.trimChatter`), y por las mismas razones.
 *
 * @param {Array} palabras [{t, texto}] con `t` en hora del día (ms)
 * @param {number} [finMs] hasta dónde llega el audio oído
 * @param {object} [reglas] las de `reglasDeFrases`; sin ellas, las de fábrica
 * @returns {Array} [{tipo:'abre'|'cierra'|'pausa-corta'|'vista', desde:number, hasta:number}]
 */
function senales(palabras, finMs, reglas) {
    const lista = palabras || [];
    const salida = [];
    const r = reglas || reglasDeFrases();

    for (let i = 0; i < lista.length; i++) {
        const p = palabra(lista[i]);
        let frase = null;
        let hasta = -1;
        for (const f of r.frases) {
            hasta = dondeTermina(lista, i, f.pegada);
            if (hasta !== -1) { frase = f; break; }
        }

        if (frase && frase.tipo === 'abre') {
            salida.push({ tipo: 'abre', desde: i, hasta, por: frase.texto });
            i = hasta;
            continue;
        }

        if (frase && frase.tipo === 'vista') {
            salida.push({ tipo: 'vista', desde: i, hasta, vista: frase.vista, por: frase.texto });
            i = hasta;
            continue;
        }

        // Una frase de varias palabras cierra sin pedir silencio: «terminamos
        // por hoy» no se dice hablando de otra cosa como se dice «pausa».
        if (frase && frase.tipo === 'cierra' && frase.palabras > 1) {
            salida.push({ tipo: 'cierra', desde: i, hasta, por: frase.texto, larga: true });
            i = hasta;
            continue;
        }

        if (frase && frase.tipo === 'cierra') {
            // Sin lo que sigue no se puede saber si es la señal o una palabra de
            // la clase: se pide silencio detrás. La última palabra de la tirada
            // se resuelve con el silencio que venga después, así que quien llama
            // decide (ver `cierraDeVerdad`).
            //
            // **El hueco se mide desde donde EMPIEZA «pausa», y no desde donde
            // termina.** Con palabra detrás, medirlo desde el final parece más
            // exacto y no lo es: el final sale del modelo o del DTW, que sobre
            // una palabra suelta se corre varias décimas hacia adelante, y eso
            // se le descontaba al hueco. En la clase del 29/09 el profesor decía
            // «Pausa» y paraba, y la toma no cerraba: quedaban por cerrar a
            // mano. Desde el comienzo, la única cosa que el hueco mide es
            // cuánto tardó en llegar la palabra siguiente, que es justo lo que
            // separa la señal de «acá hacemos una pausa en el flujo».
            //
            // Sin palabra detrás hace falta por otro motivo, y también medido:
            // cuando detrás hay silencio, Whisper le estira el
            // final a la última palabra hasta el final del audio que oyó. En la
            // primera grabación de verdad del vídeo semanal, un «pausa.» dicho
            // en el segundo 0,69 llegó como «0.69-6.13» con la ventana
            // terminando en 6.14 — o sea que el silencio de cinco segundos que
            // tenía que cerrar la toma se lo había comido la palabra, y el hueco
            // daba una centésima. Desde el comienzo, el hueco mide lo único que
            // se puede medir sin creerle al final: cuánto audio pasó desde que
            // la palabra empezó sin que llegara nada más.
            const siguiente = lista[hasta + 1];
            const hueco = siguiente
                ? (siguiente.t - lista[i].t) / 1000
                : (finMs != null ? (finMs - lista[i].t) / 1000 : Infinity);
            if (hueco >= SILENCIO_TRAS_PAUSA_SEC) {
                salida.push({ tipo: 'cierra', desde: i, hasta, por: frase.texto });
            } else {
                // Una «Pausa» que no cerró queda anotada con su hueco. Es lo
                // único que deja saber, al día siguiente, si la toma se cerró a
                // mano porque el profesor siguió hablando o porque este número
                // está mal puesto (lo escribe `grabacion.js` en el registro).
                salida.push({ tipo: 'pausa-corta', desde: i, hasta, huecoSec: Math.round(hueco * 100) / 100 });
            }
            i = hasta;
            continue;
        }

        if (!r.cuenta) continue;

        // El conteo: se mira si desde acá arranca una tirada de números.
        let j = i;
        if (OK.test(p) && lista[i + 1] && CUENTA.test(palabra(lista[i + 1]))) j = i + 1;
        // La tirada de números, cortada en el PRIMER uno: ahí termina la cuenta.
        // Sin ese corte, una clase que arranca diciendo "uno de los problemas…"
        // se comía su propia primera palabra, porque "uno" también es número.
        let fin = j;
        while (fin < lista.length && CUENTA.test(palabra(lista[fin]))) {
            fin++;
            if (valorDeCuenta(palabra(lista[fin - 1])) === 1) break;
        }

        // Y tiene que terminar en uno, no solo tener dos números: "tenemos uno,
        // dos, tres opciones" es habla, y con la regla de "dos seguidos" abría una
        // toma en medio de la clase. Se pide el final y no que baje monótona
        // porque el falso arranque existe: en el curso real está escrito "3 2 3 2 1.".
        const cierraEnUno = fin > j && valorDeCuenta(palabra(lista[fin - 1])) === 1;
        if (fin - j >= MINIMO_DE_CUENTA && cierraEnUno) {
            salida.push({ tipo: 'abre', desde: i, hasta: fin - 1, por: 'cuenta' });
            i = fin - 1;
        }
    }

    return salida;
}

/** Cuántas palabras del arranque se citan en el comentario del IN. */
const PALABRAS_DEL_CUE = 8;

/**
 * El cue de una toma: el conteo y las primeras palabras de lo que se dijo.
 *
 * El conteo se escribe con un punto y nada más al final. Viene como lo escribió
 * Whisper, que a veces pone puntos suspensivos ("3, 2, 1..."), y el parser de post
 * come el conteo pero no los signos de sobra: el cue quedaba empezando en ".. Uno,
 * un PROM sirve…". Ese cue es lo que `align.js` busca en el Live-Mix para reanclar
 * el borde, así que conviene que sean palabras y no basura.
 */
function cueDeEntrada(toma) {
    const cuenta = limpio(toma.cuenta).replace(/[.,…!?]+$/, '.');
    const primeras = textoDe(toma.palabras, 0, PALABRAS_DEL_CUE - 1);
    return [cuenta, primeras].filter(Boolean).join(' ').trim();
}

/**
 * El comentario del marcador de entrada: la nota, el separador y lo que se dijo.
 *
 * **El separador va con sus dos espacios y el resultado NO se recorta.** Parece
 * detalle y no lo es: el parser de post busca literalmente " - " para saber dónde
 * termina la nota del director y empieza el habla, y una toma sin nota deja el
 * comentario empezando en " - 3, 2, 1…". Recortarlo lo dejaba en "- 3, 2, 1…",
 * sin separador que encontrar, y de ahí en adelante el conteo pasaba a ser parte
 * del cue: `hasCount` en falso y el motor de cortes sin saber dónde arranca la
 * clase. Salió en la simulación —las once tomas de una clase entera con
 * `conteo:false`— porque las pruebas de antes usaban una toma CON nota, que es el
 * caso raro. La herramienta del director escribe " - " igual, con su espacio.
 */
function comentarioDeEntrada(toma) {
    return `${limpio(toma.comentario)} - ${cueDeEntrada(toma)}`;
}

/** El cue de salida: las últimas palabras dichas, que es lo que el CD escribe. */
function cueDeSalida(toma) {
    const palabras = toma.palabras || [];
    const desde = Math.max(0, palabras.length - PALABRAS_DEL_CUE);
    return textoDe(palabras, desde, palabras.length - 1);
}

module.exports = {
    CUENTA,
    FRASES_DE_FABRICA,
    palabrasDeFrase,
    reglasDeFrases,
    dondeTermina,
    OK,
    MINIMO_DE_CUENTA,
    VALOR,
    valorDeCuenta,
    MISMA_SENAL_MS,
    SILENCIO_TRAS_PAUSA_SEC,
    senales,
    PALABRAS_DEL_CUE,
    cueDeEntrada,
    comentarioDeEntrada,
    cueDeSalida
};
