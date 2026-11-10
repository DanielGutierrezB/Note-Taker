#!/usr/bin/env node
'use strict';
/**
 * tools/banco-pasada.js — Lo que cuesta una pasada del vivo, con dos maneras de
 * pedirla, sobre ventanas de una clase de verdad.
 *
 *   node tools/banco-pasada.js <clase.wav> [--ventanas=40] [--idioma=es] [--glosario="Canva, Figma"]
 *   node tools/banco-pasada.js <clase.wav> --recorte     el recorte de la app contra el de ffmpeg
 *   node tools/banco-pasada.js <clase.wav> --relectura --glosario="Canva, …" [--tramos=5]
 *                                                       el glosario en la relectura, con whisper-cli
 *
 * Corta ventanas de seis segundos repartidas por la clase, levanta el mismo
 * `whisper-server` que usa el ciclo (`oido-residente.js`) y lee cada ventana
 * con las configuraciones de abajo, una detrás de otra. Dice cuánto tardó cada
 * una (mediana y percentil 90) y en cuántas ventanas el texto no salió igual a
 * la de antes, que es la pregunta de si un cambio de velocidad cuesta texto.
 *
 * El WAV solo se lee: los cortes van a la carpeta temporal y se borran al
 * terminar. Corre el modelo grande: no tiene que haber una clase grabando.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const paths = require('../engine/paths');
const residente = require('../engine/oido-residente');
const captura = require('../engine/captura');
const transcribe = require('../engine/transcribe');

const VENTANA_SEC = 6;

function arg(nombre, porDefecto) {
    const hit = process.argv.find(a => a.startsWith(`--${nombre}=`));
    return hit ? hit.slice(nombre.length + 3) : porDefecto;
}

/** Cuánto dura el WAV, leído de su cabecera (`captura.js` la escribe estándar). */
function segundosDe(wav) {
    const fd = fs.openSync(wav, 'r');
    try {
        const cabeza = Buffer.alloc(44);
        fs.readSync(fd, cabeza, 0, 44, 0);
        const porSegundo = cabeza.readUInt32LE(28);
        return (fs.statSync(wav).size - 44) / porSegundo;
    } finally {
        fs.closeSync(fd);
    }
}

function cortar(wav, desdeSec, destino) {
    execFileSync(paths.ffmpeg().path, [
        '-v', 'error', '-y', '-ss', String(desdeSec), '-t', String(VENTANA_SEC),
        '-i', wav, '-ar', '16000', '-ac', '1', destino
    ]);
}

const mediana = xs => { const o = xs.slice().sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; };
const p90 = xs => { const o = xs.slice().sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.floor(o.length * 0.9))]; };
const textoDe = r => (r.words || []).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();

/**
 * El glosario en la relectura: tramos largos por `whisper-cli`, con y sin él.
 *
 * Largos porque es donde se trababa la puntuación cuando se arrastraba el
 * texto entre ventanas de 30 s, que es lo que el glosario no puede volver a
 * hacer. Dice cuántas veces salió cada término, cuántas frases cerraron, el
 * tramo más largo sin un punto y cuánto tardó. Un término del glosario que
 * nadie dijo —ponerlo a propósito— dice si lo inventa en los silencios.
 */
async function relectura(wav, largo, idioma, glosario, cuantos, dir) {
    const terminos = String(glosario || '').split(',').map(x => x.trim()).filter(Boolean);
    const conGlosario = terminos.length ? `${terminos.join(', ')}.` : '';
    const TRAMO_SEC = 180;
    const cuenta = { sin: { ms: 0, cierres: 0, peor: 0, hits: {} }, con: { ms: 0, cierres: 0, peor: 0, hits: {} } };
    const clave = x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (let i = 0; i < cuantos; i++) {
        const desde = Math.floor(((i + 0.5) / cuantos) * Math.max(0, largo - TRAMO_SEC));
        const archivo = path.join(dir, `t${i}.wav`);
        execFileSync(paths.ffmpeg().path, ['-v', 'error', '-y', '-ss', String(desde), '-t', String(TRAMO_SEC),
            '-i', wav, '-ar', '16000', '-ac', '1', archivo]);
        for (const [cual, g] of [['sin', ''], ['con', conGlosario]]) {
            const t0 = Date.now();
            const r = await transcribe.runWhisper(archivo, { language: idioma, glosario: g });
            cuenta[cual].ms += Date.now() - t0;
            const palabras = (r.words || []).map(w => w.text);
            let corrida = 0;
            for (const w of palabras) {
                if (/[.?!…]$/.test(w)) { cuenta[cual].cierres++; corrida = 0; } else { corrida++; cuenta[cual].peor = Math.max(cuenta[cual].peor, corrida); }
            }
            const todo = clave(palabras.join(' '));
            for (const term of terminos) {
                const n = todo.split(clave(term)).length - 1;
                cuenta[cual].hits[term] = (cuenta[cual].hits[term] || 0) + n;
            }
        }
        console.log(`  tramo ${i + 1} de ${cuantos} (${Math.round(desde / 60)} min)`);
    }
    for (const cual of ['sin', 'con']) {
        const c = cuenta[cual];
        console.log(`  ${cual} glosario: ${Math.round(c.ms / 1000)} s, ${c.cierres} frases cerradas, `
            + `el tramo más largo sin cerrar ${c.peor} palabras; términos ${JSON.stringify(c.hits)}`);
    }
}

async function main() {
    const wav = process.argv[2];
    if (!wav || !fs.existsSync(wav)) {
        console.log('Uso: node tools/banco-pasada.js <clase.wav> [--ventanas=40] [--idioma=es] [--glosario="..."]');
        process.exit(1);
    }
    const idioma = arg('idioma', 'es');
    const cuantas = Number(arg('ventanas', 40));
    const glosario = arg('glosario', null);
    const largo = segundosDe(wav);

    const configuraciones = [
        { nombre: 'como antes (idioma en cada pasada, con reintentos)', o: { medirIdioma: true, reintentos: true } },
        { nombre: 'sin reintentos', o: { medirIdioma: true, reintentos: false } },
        { nombre: 'sin reintentos ni idioma', o: { medirIdioma: false, reintentos: false } }
    ];
    if (glosario) configuraciones.push({ nombre: 'sin reintentos ni idioma, con glosario', o: { medirIdioma: false, reintentos: false, glosario } });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-banco-'));
    try {
        // Sin el servidor del vivo: la relectura va por whisper-cli, y con el
        // servidor cargado los dos se pelearían la GPU y el tiempo no diría nada.
        if (process.argv.includes('--relectura')) {
            await relectura(wav, largo, idioma, glosario, Number(arg('tramos', 5)), dir);
            return;
        }
        const ventanas = [];
        for (let i = 0; i < cuantas; i++) {
            const desde = Math.floor(((i + 0.5) / cuantas) * Math.max(0, largo - VENTANA_SEC));
            const destino = path.join(dir, `v${i}.wav`);
            cortar(wav, desde, destino);
            ventanas.push({ desde, archivo: destino });
        }
        console.log(`${cuantas} ventanas de ${VENTANA_SEC} s de ${path.basename(wav)} (${Math.round(largo / 60)} min), en «${idioma}»`);
        if (!(await residente.arrancar({ idioma }))) throw new Error('whisper-server no arrancó');
        // La primera pasada carga lo que falte en la GPU: no se cuenta.
        await residente.transcribir(ventanas[0].archivo, idioma);

        if (process.argv.includes('--recorte')) {
            // El mismo pedazo cortado por ffmpeg y por la app (`captura.recorteEnLaApp`):
            // lo que importa es si Whisper lee lo mismo.
            let distintas = 0;
            const ms = [];
            for (const v of ventanas) {
                const propio = path.join(dir, 'propio.wav');
                const t0 = Date.now();
                if (!captura.recorteEnLaApp(wav, v.desde, VENTANA_SEC, propio)) throw new Error('la app no supo recortar ese WAV');
                ms.push(Date.now() - t0);
                const a = textoDe(await residente.transcribir(v.archivo, idioma, { medirIdioma: false }));
                const b = textoDe(await residente.transcribir(propio, idioma, { medirIdioma: false }));
                if (a !== b) { distintas++; console.log(`    ${v.desde}s\n      ffmpeg: ${a}\n      app:    ${b}`); }
            }
            console.log(`  recorte en la app: ${mediana(ms)} ms de mediana; texto distinto en ${distintas} de ${cuantas}`);
            return;
        }

        const base = [];
        for (const [k, c] of configuraciones.entries()) {
            const tiempos = [];
            let distintas = 0;
            for (const [i, v] of ventanas.entries()) {
                const t0 = Date.now();
                const r = await residente.transcribir(v.archivo, idioma, c.o);
                tiempos.push(Date.now() - t0);
                const texto = textoDe(r);
                if (k === 0) base[i] = texto;
                else if (texto !== base[i]) distintas++;
            }
            console.log(`  ${c.nombre}: mediana ${mediana(tiempos)} ms, p90 ${p90(tiempos)} ms`
                + (k ? `, texto distinto en ${distintas} de ${cuantas}` : ''));
        }
    } finally {
        residente.apagar();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(e => { console.error(e.message); residente.apagar(); process.exit(1); });
}
