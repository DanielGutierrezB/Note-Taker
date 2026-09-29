#!/usr/bin/env node
'use strict';
/**
 * Mide el texto en vivo contra el bueno, sobre el audio de una clase.
 *
 *   node tools/medir-vivo.js --wav=<audio.wav> [--minutos=3] [--idioma=es]
 *
 * Recorre el audio como lo recorre el ciclo de señales —cada tantos segundos,
 * una ventana con solape— y arma el texto que se habría visto en pantalla, con
 * dos formas de oír:
 *
 *   antes   whisper-cli relanzado con el modelo liviano, cada 3 s, sin cola
 *   ahora   whisper-server con el grande cargado, cada 1 s, 6 s de contexto y
 *           la cola de 0,5 s sin creer (ver `CICLO_MS` en `engine/grabacion.js`)
 *
 * y los pone al lado del archivo entero pasado por el modelo grande, que es lo
 * más parecido a la verdad que hay sin transcribir a mano. Dice cuánto tarda
 * cada pasada, y con `--salida=<archivo>` escribe los tres textos enteros.
 *
 * No es la sesión de verdad —no abre tomas ni escribe XML— sino el mismo camino
 * del texto: `aplicarSenales` con sus reglas de solape, sobre las mismas palabras.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const paths = require('../engine/paths');
const transcribe = require('../engine/transcribe');
const residente = require('../engine/oido-residente');
const vivo = require('../engine/notas-vivo');

function arg(nombre, def) {
    const a = process.argv.find(x => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3) : def;
}

function recortar(wav, desdeSec, durSec, destino) {
    spawnSync(paths.ffmpeg().path, ['-v', 'error', '-y', '-ss', String(desdeSec), '-t', String(durSec),
        '-i', wav, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', destino]);
}

function duracion(wav) {
    const r = spawnSync(paths.ffprobe().path, ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', wav], { encoding: 'utf8' });
    return Number(r.stdout.trim());
}

/**
 * Las palabras que se guardaron en esta pasada, en el orden en que entraron:
 * es el orden en que aparecen en pantalla. Ordenarlas por hora las mezclaría,
 * porque la hora de una palabra se corre de una pasada a otra.
 */
function guardadas(estado, vistas, orden) {
    const poner = w => { if (!vistas.has(w)) { vistas.add(w); orden.push(w); } };
    for (const w of estado.sueltas) poner(w);
    for (const t of estado.tomas) for (const w of t.palabras) poner(w);
}

async function recorrer(wav, total, forma, idioma) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-medir-'));
    const estado = vivo.estadoNuevo({ secuencia: 'x', ceroMs: 0, fps: 30 });
    const vistas = new Set();
    const orden = [];
    const tiempos = [];
    let escuchado = 0;
    for (let hasta = forma.ciclo; hasta <= total + forma.ciclo; hasta += forma.ciclo) {
        const fin = Math.min(hasta, total);
        if (fin - escuchado < 1) continue;
        const desde = Math.max(0, Math.min(escuchado - forma.solape, fin - forma.contexto));
        const archivo = path.join(tmp, 'p.wav');
        recortar(wav, desde, fin - desde, archivo);
        const t0 = Date.now();
        const salida = forma.residente
            ? await residente.transcribir(archivo, idioma)
            : await transcribe.runWhisper(archivo, { language: idioma, model: paths.modeloLiviano() });
        tiempos.push(Date.now() - t0);
        const limpias = transcribe.collapseLoops(salida.words || []).words;
        const palabras = limpias.map(w => ({
            t: Math.round((desde + (w.dtw != null ? w.dtw : w.start)) * 1000),
            hasta: Math.round((desde + w.end) * 1000),
            texto: w.text
        }));
        const firme = fin >= total ? Infinity : (fin - forma.cola) * 1000;
        vivo.aplicarSenales(estado, palabras, { firmeHastaMs: firme });
        guardadas(estado, vistas, orden);
        escuchado = fin - forma.cola;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    const lista = orden.map(w => w.texto);
    const promedio = tiempos.reduce((a, b) => a + b, 0) / Math.max(1, tiempos.length);
    return { palabras: lista, pasadas: tiempos.length, promedioMs: Math.round(promedio) };
}

async function main() {
    const wav = arg('wav');
    if (!wav) { console.error('Falta --wav=<audio>'); process.exit(1); }
    const idioma = arg('idioma', 'es');
    const total = Math.min(duracion(wav), Number(arg('minutos', '3')) * 60);

    console.log(`Audio: ${wav} · ${total.toFixed(0)} s\n`);
    console.log('Referencia: el tramo entero con el modelo grande…');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-ref-'));
    const entero = path.join(tmp, 'entero.wav');
    recortar(wav, 0, total, entero);
    const ref = (await transcribe.runWhisper(entero, { language: idioma })).words.map(w => w.text);
    const salida = arg('salida', null);

    const antes = await recorrer(wav, total, { ciclo: 3, solape: 1.2, contexto: 0, cola: 0, residente: false }, idioma);

    console.log('Cargando whisper-server…');
    const ok = await residente.arrancar({ idioma });
    if (!ok) { console.error('whisper-server no arrancó'); process.exit(1); }
    const ahora = await recorrer(wav, total, { ciclo: 1, solape: 1.2, contexto: 6, cola: 0.5, residente: true }, idioma);
    residente.apagar();
    fs.rmSync(tmp, { recursive: true, force: true });

    // Sin un número de error por palabra, a propósito: la referencia es Whisper
    // sobre el archivo entero, y sobre audio de Zoom se saltea tramos enteros
    // (un canturreo, un idioma que cambia) que el ciclo sí escribe. Contra eso
    // el número castigaba justamente lo que se oyó de más, y decía 94 % de error
    // de un texto que se leía bien. Los tres textos van enteros para mirarlos.
    const fila = (n, r) => console.log(
        `  ${n.padEnd(6)} ${String(r.pasadas).padStart(4)} pasadas · ${String(r.promedioMs).padStart(5)} ms cada una`);
    console.log('\nCuánto tarda cada pasada:');
    fila('antes', antes);
    fila('ahora', ahora);
    if (salida) {
        fs.writeFileSync(salida, `REFERENCIA\n${ref.join(' ')}\n\nANTES\n${antes.palabras.join(' ')}\n\nAHORA\n${ahora.palabras.join(' ')}\n`);
        console.log(`\nLos tres textos enteros: ${salida}`);
    }
    console.log(`\nReferencia: ${ref.join(' ').slice(0, 400)}`);
    console.log(`\nAntes:      ${antes.palabras.join(' ').slice(0, 400)}`);
    console.log(`\nAhora:      ${ahora.palabras.join(' ').slice(0, 400)}`);
}

main().catch(e => { console.error(e); residente.apagar(); process.exit(1); });
