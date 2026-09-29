#!/usr/bin/env node
'use strict';
/**
 * Dos horas de clase por el motor de verdad, en un par de minutos.
 *
 *   node tools/estres-2h.js [--horas=2]
 *
 * Whisper se reemplaza por uno de mentira que "oye" habla continua —una palabra
 * cada 400 ms— con un «3, 2, 1» y una «Pausa» por minuto, y el audio se escribe
 * de verdad (un segundo de PCM por pasada). Lo que se mide es lo que se rompe
 * con el tiempo y no se ve en una prueba corta: si cada pasada tarda cada vez
 * más, si la memoria crece, cuánto pesa lo que se manda a la ventana, y si al
 * final el XML y el sidecar dicen lo que tienen que decir: todas las tomas con
 * IN y OUT, cada palabra con su hora, dentro de su toma y en orden.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const rodecaster = require('../engine/rodecaster-xml');

const horas = Number((process.argv.find(a => a.startsWith('--horas=')) || '--horas=2').split('=')[1]);
const PASADAS = Math.round(horas * 3600);
const TASA = 48000;

function palabrasEntre(desdeMs, hastaMs, cero) {
    // Habla continua: una palabra cada 400 ms. En el segundo 0 de cada minuto,
    // «3, 2, 1»; en el 50, «Pausa» seguida de 3 s de silencio.
    const out = [];
    for (let t = Math.ceil((desdeMs - cero) / 400) * 400; t < hastaMs - cero; t += 400) {
        const enMinuto = t % 60000;
        if (enMinuto >= 50400 && enMinuto < 53600) continue;
        let texto = `palabra${Math.floor(t / 400)}`;
        if (enMinuto === 0) texto = '3,';
        if (enMinuto === 400) texto = '2,';
        if (enMinuto === 800) texto = '1.';
        if (enMinuto === 50000) texto = 'Pausa.';
        out.push({ t: cero + t, texto, hasta: cero + t + 300 });
    }
    return out;
}

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-estres-'));
    let cero = 0;
    oirToma.tramo = async (_a, desdeMs, hastaMs) => ({ palabras: palabrasEntre(desdeMs, hastaMs, cero) });
    // La relectura devuelve las mismas palabras, repartidas por la toma de verdad.
    oirToma.leer = async (_a, toma) => {
        const vivo = require('../engine/notas-vivo');
        const ws = palabrasEntre(toma.inMs - 6000, toma.outMs + 6000, cero);
        return { ...vivo.repartir(ws, toma), colapsadas: 0, relectura: null };
    };

    const st = grabacion.iniciar({ dir, curso: 'estres', fps: 29.97, sinReloj: true, sampleRate: TASA, canales: 1 });
    cero = st.ceroMs;
    const pedazo = Buffer.alloc(TASA * 2);
    const tiempos = [];
    const t0 = Date.now();
    for (let i = 0; i < PASADAS; i++) {
        grabacion.pcm(pedazo);
        const a = process.hrtime.bigint();
        await grabacion.buscarSenales();
        tiempos.push(Number(process.hrtime.bigint() - a) / 1e6);
        if (i % 1800 === 0) {
            const r = grabacion.resumen();
            const mb = (Buffer.byteLength(JSON.stringify(r)) / 1e6).toFixed(2);
            const heap = (process.memoryUsage().heapUsed / 1e6).toFixed(0);
            const ult = tiempos.slice(-300);
            const media = (ult.reduce((x, y) => x + y, 0) / ult.length).toFixed(2);
            console.log(`${String(Math.round(i / 60)).padStart(4)} min · ${r.tomas.length} tomas · pasada ${media} ms · ` +
                `estado a la ventana ${mb} MB · heap ${heap} MB`);
        }
    }
    await new Promise(r => setTimeout(r, 200));
    const salida = await grabacion.terminar();
    console.log(`\n${PASADAS} pasadas en ${Math.round((Date.now() - t0) / 1000)} s de reloj`);

    // ── Lo que quedó escrito ──
    const side = JSON.parse(fs.readFileSync(salida.archivos.json, 'utf8'));
    const xml = fs.readFileSync(salida.archivos.xml, 'utf8');
    const problemas = [];
    let palabras = 0;
    for (const t of side.tomas) {
        if (t.inMs == null || t.outMs == null) problemas.push(`toma ${t.id} sin IN u OUT`);
        if (t.outMs <= t.inMs) problemas.push(`toma ${t.id} con OUT antes del IN`);
        let previa = -Infinity;
        for (const w of t.palabras || []) {
            palabras++;
            if (!Number.isFinite(w.t)) problemas.push(`toma ${t.id}: palabra sin hora («${w.texto}»)`);
            if (w.t < t.inMs || w.t >= t.outMs) problemas.push(`toma ${t.id}: «${w.texto}» fuera de su toma`);
            if (w.t < previa) problemas.push(`toma ${t.id}: «${w.texto}» fuera de orden`);
            previa = w.t;
        }
    }
    for (let i = 1; i < side.tomas.length; i++) {
        if (side.tomas[i].inMs < side.tomas[i - 1].outMs) problemas.push(`toma ${side.tomas[i].id} empieza antes de que termine la anterior`);
    }
    const esperadas = Math.floor(PASADAS / 60);
    const leido = rodecaster.parse ? rodecaster.parse(xml) : null;
    const wav = side.sesiones.reduce((s, x) => s + x.segundos, 0);
    console.log(`tomas: ${side.tomas.length} (se dijeron ${esperadas}) · palabras con hora: ${palabras}`);
    console.log(`WAV: ${wav.toFixed(1)} s de ${PASADAS} · XML ${(xml.length / 1e6).toFixed(2)} MB · sidecar ${(fs.statSync(salida.archivos.json).size / 1e6).toFixed(2)} MB`);
    if (leido) console.log(`el XML se vuelve a leer: ${JSON.stringify(Object.keys(leido)).slice(0, 80)}`);
    console.log(problemas.length ? `PROBLEMAS (${problemas.length}):\n  ${problemas.slice(0, 15).join('\n  ')}` : 'Sin problemas.');
    fs.rmSync(dir, { recursive: true, force: true });
}

main().catch(e => { console.error(e); grabacion.apagar(); process.exit(1); });
