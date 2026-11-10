'use strict';
/**
 * glosario.js — Las palabras que Whisper tiene que escribir bien.
 *
 * Son dos y se suman: el general, en Ajustes, para todas las clases, y el del
 * curso, que vive en la carpeta Datos del curso, al lado de `prproj.json`, y
 * viaja con la carpeta si se comparte.
 *
 * **Cómo llega a Whisper.** La app lee con `-mc 0`, sin arrastrar el texto de
 * una ventana de 30 s a la siguiente, porque arrastrado se trababa la
 * puntuación (`transcribe.runWhisper`). `--carry-initial-prompt` guarda el
 * glosario aparte y lo pone primero en cada ventana, y lo que sobre del tope
 * `-mc` lo llena con lo de la ventana anterior. Así que el tope se ajusta al
 * largo del glosario: con él justo, no se arrastra nada más. Si queda corto,
 * whisper.cpp se queda con los ÚLTIMOS tokens, y por eso el del curso va al
 * final: lo que se cae es lo del general. (Leído en `vendor/whisper.cpp`,
 * `whisper_full_with_state`.) Como la cuenta es por lo alto, pueden colarse
 * unos pocos tokens de la ventana anterior: no los suficientes para trabar
 * la puntuación, que es lo que se midió (`tools/banco-pasada.js --relectura`).
 *
 * El tokenizador vive en el modelo y desde acá no se puede preguntar cuántos
 * tokens son, así que se estima por lo alto: un token de más deja pasar un
 * token de la ventana anterior, que no traba nada; uno de menos se come una
 * palabra del glosario.
 */

const fs = require('fs');
const path = require('path');

const workspace = require('./workspace');
const { norm } = require('./texto');

/**
 * Cuántas palabras entran entre los dos glosarios.
 *
 * El prompt de whisper.cpp tiene la mitad del contexto de texto del modelo,
 * 224 tokens. Las palabras son el tope que se le dice a la persona; el que
 * manda es el de tokens (`combinar`), que con términos cortos llega antes.
 */
const PALABRAS_MAX = 150;
const TERMINO_MAX = 40;
const TOKENS_MAX = 223;

/** Términos sanos: sin vacíos, sin repetidos y no más largos que `TERMINO_MAX`. */
function sanos(lista) {
    const vistos = new Set();
    const salida = [];
    for (const x of Array.isArray(lista) ? lista : []) {
        if (typeof x !== 'string') continue;
        const termino = x.replace(/\s+/g, ' ').trim().slice(0, TERMINO_MAX).trim();
        const clave = termino.split(' ').map(norm).filter(Boolean).join(' ');
        if (!clave || vistos.has(clave)) continue;
        vistos.add(clave);
        salida.push(termino);
        if (salida.length >= PALABRAS_MAX) break;
    }
    return salida;
}

const palabrasDe = termino => termino.split(' ').filter(Boolean).length;

function archivoDelCurso(carpeta) {
    return path.join(workspace.datosDir(carpeta), 'glosario.json');
}

function leerDelCurso(carpeta) {
    if (!carpeta) return [];
    try {
        const crudo = JSON.parse(fs.readFileSync(archivoDelCurso(carpeta), 'utf8'));
        return sanos(crudo && crudo.terminos);
    } catch (e) {
        return [];
    }
}

function guardarDelCurso(carpeta, lista) {
    const terminos = sanos(lista);
    workspace.ensureDir(workspace.datosDir(carpeta));
    workspace.writeJson(archivoDelCurso(carpeta), { terminos });
    return terminos;
}

/**
 * Los dos glosarios sumados, con el del curso primero en la cuenta.
 *
 * Si no entran todos, el del curso tiene prioridad —es el de esta clase— y
 * `afuera` dice qué quedó sin pasar, para que la pantalla lo diga: un término
 * que se corta en silencio es un término que alguien cree que está.
 *
 * @returns {{entran:string[], afuera:string[], palabras:number, tope:number}}
 */
function combinar(general, delCurso) {
    const curso = sanos(delCurso);
    const claves = new Set(curso.map(x => norm(x)));
    const delGeneral = sanos(general).filter(x => !claves.has(norm(x)));
    let palabras = 0;
    const entranDelCurso = [];
    const entranDelGeneral = [];
    const afuera = [];
    // El tope de verdad es el de tokens: las palabras son lo que se le puede
    // decir a la persona, pero una coma ya es un token y cien términos sueltos
    // pasaban los 222 sin pasar las 150 palabras. Lo que no entra en tokens
    // también queda afuera, y se dice.
    const entraEnTokens = lista => tokensEstimados(texto(lista)) < TOKENS_MAX;
    for (const [lista, destino] of [[curso, entranDelCurso], [delGeneral, entranDelGeneral]]) {
        for (const t of lista) {
            const n = palabrasDe(t);
            const conEste = entranDelGeneral.concat(entranDelCurso, [t]);
            if (palabras + n > PALABRAS_MAX || !entraEnTokens(conEste)) { afuera.push(t); continue; }
            palabras += n;
            destino.push(t);
        }
    }
    // El del curso al final: si whisper.cpp tiene que cortar, corta del principio.
    return { entran: entranDelGeneral.concat(entranDelCurso), afuera, palabras, tope: PALABRAS_MAX };
}

/** El texto que se le pasa a Whisper: los términos separados por comas. */
function texto(entran) {
    return (entran || []).length ? `${entran.join(', ')}.` : '';
}

/** Cuántos tokens son, por lo alto: uno cada tres bytes, más los de los bordes. */
function tokensEstimados(t) {
    return Math.ceil(Buffer.byteLength(String(t || ''), 'utf8') / 3) + 2;
}

/** Lo que va a `whisper-cli` con este glosario, o nada si está vacío. */
function argumentos(t) {
    if (!t) return [];
    return ['--prompt', t, '--carry-initial-prompt', '-mc', String(Math.min(TOKENS_MAX, tokensEstimados(t) + 1))];
}

module.exports = {
    PALABRAS_MAX,
    TERMINO_MAX,
    sanos,
    archivoDelCurso,
    leerDelCurso,
    guardarDelCurso,
    combinar,
    texto,
    tokensEstimados,
    argumentos
};
