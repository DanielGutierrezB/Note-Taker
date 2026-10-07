'use strict';
/**
 * tools/medir-audio.js — ¿Suena «Mejorar audio» como se dice que suena?
 *
 *   node tools/medir-audio.js /ruta/a/un/exporte.mp4 [otro.mp4 …]
 *
 * Las pruebas de `mejorar-audio.test.js` comprueban lo que se DECIDE: qué
 * ganancia le toca a cada toma, qué cadena se le escribe a ffmpeg. No pueden
 * comprobar lo que SUENA, porque para eso hace falta ffmpeg y un archivo con
 * voz dentro, y la suite corre en siete segundos sin nada instalado.
 *
 * Esto es la otra mitad: coge audio de verdad, le pasa la cadena de verdad y
 * mide el resultado contra lo prometido. Sale distinto de cero si algo se
 * sale de la vara, así que sirve de prueba aunque haya que correrla a mano.
 *
 * ── Las cuatro cosas que se miden ─────────────────────────────────────────
 *
 * **1. Que llegue al destino.** -16 LUFS ±1. Es para lo que existe.
 *
 * **2. Que no se cargue la dinámica.** El LRA de la salida no puede caer más
 * de 1,5 LU respecto de la entrada. Es la diferencia entre nivelar y
 * comprimir, y es exactamente lo que se le pidió: «no muy exagerado». Es
 * también lo que descartó `loudnorm`, que en este material baja el LRA de 5,0
 * a 3,3.
 *
 * **3. Que no se toque la voz.** El ruido tiene que bajar y el nivel de la voz
 * —el percentil 90 de las ventanas de 20 ms, que es donde está la voz— tiene
 * que quedar donde estaba, ±1 dB.
 *
 * Esto se mide con la LIMPIEZA SOLA, sin la ganancia ni el limitador. Pasada
 * por la cadena entera la pregunta no tiene respuesta: el limitador también
 * mueve la voz, y moverla es su trabajo, así que un número que los sume no
 * dice de quién es. Medida sola, la limpieza deja la voz donde estaba.
 *
 * **4. Que no se desincronice.** La cadena retrasa el audio 30 ms y los
 * devuelve a mano (ver `RETRASO_MS` en `engine/mejorar-audio.js`). Esto mide
 * el desfase que queda de verdad, buscando el desplazamiento que mejor
 * alinea la salida con la entrada. Es el número más importante de los cuatro:
 * si se va, lo que la persona aprobó en la revisión no es lo que se baja.
 *
 * **Lee, no escribe.** Trabaja en una carpeta temporal y no toca el original.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const mejorar = require('../engine/mejorar-audio');
const paths = require('../engine/paths');

/** Las varas, en el orden de la cabecera. */
const VARA = {
    destinoMargen: 1.0,     // LUFS de distancia al destino que se perdona
    dinamicaMaxCaida: 1.5,  // LU de LRA que puede perder sin ser compresión
    vozMaxMovida: 1.0,      // dB que la voz puede moverse de donde la puso la ganancia
    desfaseMaxMs: 5         // ms de desfase: la décima parte de lo que se nota
};

const FF = paths.ffmpeg().path;

function ff(args) {
    const r = spawnSync(FF, ['-nostdin', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    return (r.stderr || '') + (r.stdout || '');
}

function num(texto, re) {
    const m = String(texto || '').match(re);
    return m ? Number(m[1]) : NaN;
}

/** Sonoridad, dinámica, pico real y piso de un archivo. */
function medir(archivo) {
    const s = ff(['-v', 'info', '-i', archivo,
        '-af', 'ebur128=peak=true,astats=metadata=0:measure_perchannel=none', '-f', 'null', '-']);
    return {
        lufs: num(s, /Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)/),
        lra: num(s, /Loudness range:[\s\S]*?LRA:\s*(-?[\d.]+)/),
        pico: num(s, /True peak:[\s\S]*?Peak:\s*(-?[\d.]+)/),
        piso: num(s, /Noise floor dB:\s*(-?[\d.]+)/)
    };
}

/** Un WAV mono a 48 kHz, que es lo único que sabe leer `sonido.js`. */
function aWav(entrada, salida, cadena) {
    const args = ['-v', 'error', '-y', '-i', entrada];
    if (cadena) args.push('-af', cadena);
    args.push('-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', salida);
    ff(args);
    return salida;
}

/** Las muestras de un WAV de 16 bits, como números entre -1 y 1. */
function muestras(archivo) {
    const b = fs.readFileSync(archivo);
    // El `data` no está siempre en el mismo sitio: se busca.
    let i = 12;
    while (i + 8 <= b.length) {
        const tipo = b.toString('ascii', i, i + 4);
        const largo = b.readUInt32LE(i + 4);
        if (tipo === 'data') break;
        i += 8 + largo + (largo & 1);
    }
    const desde = i + 8;
    const n = Math.floor((b.readUInt32LE(i + 4)) / 2);
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) x[k] = b.readInt16LE(desde + k * 2) / 32768;
    return x;
}

/**
 * Cuántas muestras hay que correr `b` para que se parezca lo más posible a `a`.
 *
 * Se busca el desplazamiento que deja el residuo —lo que queda al restar una
 * de la otra— con la menor energía. Hace falta porque los filtros de la cadena
 * retrasan la señal, y comparar dos cosas desalineadas da números que parecen
 * reales y no lo son: es el error que me hizo creer primero que el denoiser se
 * comía la voz.
 */
function desfase(a, b, maxMuestras) {
    const n = Math.min(a.length, b.length);
    const desde = Math.floor(n * 0.2);
    const hasta = Math.min(desde + 48000 * 5, n - maxMuestras - 1);
    let mejor = 0;
    let menos = Infinity;
    for (let d = -maxMuestras; d <= maxMuestras; d++) {
        let e = 0;
        for (let k = desde; k < hasta; k += 4) {
            const r = a[k] - b[k + d];
            e += r * r;
        }
        if (e < menos) { menos = e; mejor = d; }
    }
    return mejor;
}

/** El percentil q de los niveles de ventanas de 20 ms, en dB. */
function nivel(x, q) {
    const ventana = Math.round(48000 * 0.02);
    const db = [];
    for (let i = 0; i + ventana <= x.length; i += ventana) {
        let s = 0;
        for (let k = i; k < i + ventana; k++) s += x[k] * x[k];
        db.push(20 * Math.log10(Math.sqrt(s / ventana) + 1e-12));
    }
    db.sort((a, b) => a - b);
    return db[Math.min(db.length - 1, Math.floor(db.length * q))];
}

function dos(x) { return Number.isFinite(x) ? x.toFixed(1) : '—'; }

function unArchivo(archivo, tmp) {
    const base = path.basename(archivo).replace(/\W+/g, '_');
    console.log(`\n── ${path.basename(archivo)} ──`);

    const crudo = aWav(archivo, path.join(tmp, `${base}-crudo.wav`), null);
    const antes = medir(crudo);
    console.log(`   antes:  ${dos(antes.lufs)} LUFS   LRA ${dos(antes.lra)}   `
        + `pico ${dos(antes.pico)} dBFS   piso ${dos(antes.piso)} dB`);

    // La misma decisión que toma el exporte. Acá no hay tomas —hay un MP4 ya
    // pegado— así que se le pasa como una sola: la ganancia de emparejar sale
    // cero, que es correcto, y lo que se prueba es la cadena del conjunto.
    const trozos = [{ toma: 'todo', audio: { ruta: crudo, desdeSec: 0, hastaSec: 1e9 } }];
    const plan = mejorar.afinar({
        trozos, ffmpeg: FF,
        plan: mejorar.plan({ trozos, ffmpeg: FF })
    });
    const ganancia = plan.ganancia;
    const cadena = plan.programa;
    console.log(`   cadena: ${cadena}`);

    const hecho = aWav(crudo, path.join(tmp, `${base}-hecho.wav`), cadena);
    const después = medir(hecho);
    console.log(`   ahora:  ${dos(después.lufs)} LUFS   LRA ${dos(después.lra)}   `
        + `pico ${dos(después.pico)} dBFS   piso ${dos(después.piso)} dB`);

    // La limpieza se mide SOLA. Pasada por la cadena entera no se puede saber
    // de quién es el movimiento de la voz: el limitador también la mueve, y
    // moverla es su trabajo. Lo que esto pregunta es otra cosa —¿el denoiser
    // se está comiendo voz?— y para contestarla hay que oírlo sin nada encima.
    const soloLimpio = aWav(crudo, path.join(tmp, `${base}-limpio.wav`),
        mejorar.limpieza(plan.tomas));
    const a = muestras(crudo);
    const limpio = muestras(soloLimpio);
    // El denoiser devuelve la señal 25 ms tarde: comparar sin alinear da
    // números que parecen reales y no lo son.
    const dl = desfase(a, limpio, 4800);
    const limpioAlineado = limpio.subarray(Math.max(0, dl));
    const voz = { antes: nivel(a, 0.9), después: nivel(limpioAlineado, 0.9) };
    const piso = { antes: nivel(a, 0.1), después: nivel(limpioAlineado, 0.1) };
    console.log(`   voz:    ${dos(voz.antes)} → ${dos(voz.después)} dB  `
        + `(movida ${dos(voz.después - voz.antes)}, solo la limpieza)`);
    console.log(`   ruido:  ${dos(piso.antes)} → ${dos(piso.después)} dB  `
        + `(bajó ${dos(piso.antes - piso.después)})`);

    // Y el desfase se mide con la cadena entera, que es la que va en el vídeo.
    const b = muestras(hecho);
    const g = Math.pow(10, ganancia / 20);
    const subida = new Float64Array(a.length);
    for (let k = 0; k < a.length; k++) subida[k] = a[k] * g;
    const d = desfase(subida, b, 4800);
    const desfaseMs = d / 48;
    console.log(`   largo:  ${a.length} → ${b.length} muestras`);
    console.log(`   desfase que queda: ${desfaseMs.toFixed(1)} ms (${d} muestras)`);

    const mal = [];
    if (Math.abs(después.lufs - mejorar.DESTINO_LUFS) > VARA.destinoMargen) {
        mal.push(`no llegó al destino: ${dos(después.lufs)} contra ${mejorar.DESTINO_LUFS} LUFS`);
    }
    if (después.pico > mejorar.TECHO_DBTP + 0.3) {
        mal.push(`se pasó del techo: ${dos(después.pico)} contra ${mejorar.TECHO_DBTP} dBTP`);
    }
    if (antes.lra - después.lra > VARA.dinamicaMaxCaida) {
        mal.push(`le comió la dinámica: el LRA cayó ${dos(antes.lra - después.lra)} LU `
            + '(eso ya es comprimir, no nivelar)');
    }
    if (Math.abs(voz.después - voz.antes) > VARA.vozMaxMovida) {
        mal.push(`la limpieza le movió la voz ${dos(voz.después - voz.antes)} dB: el denoiser `
            + 'está comiéndose algo que no es ruido');
    }
    if (b.length !== a.length) {
        mal.push(`le cambió el largo: ${a.length} → ${b.length} muestras, y el vídeo no cambió`);
    }
    if (piso.antes - piso.después < 0.5) {
        mal.push('no le quitó ruido: el piso quedó donde estaba');
    }
    if (Math.abs(desfaseMs) > VARA.desfaseMaxMs) {
        mal.push(`quedó ${desfaseMs.toFixed(1)} ms desfasado: lo que se aprobó en la revisión `
            + 'no es lo que se baja');
    }
    for (const m of mal) console.log(`   ✗ ${m}`);
    if (!mal.length) console.log('   ✓ dentro de la vara en las cuatro cosas');
    return mal.length;
}

function main() {
    const archivos = process.argv.slice(2).filter(a => !a.startsWith('-'));
    if (!archivos.length) {
        console.log('Uso: node tools/medir-audio.js /ruta/a/un/exporte.mp4 [otro.mp4 …]');
        process.exit(2);
    }
    if (!fs.existsSync(FF)) {
        console.log(`No está ffmpeg en ${FF}`);
        process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-medir-audio-'));
    let mal = 0;
    try {
        for (const a of archivos) {
            if (!fs.existsSync(a)) { console.log(`\n── ${a} ──\n   ✗ no está`); mal++; continue; }
            mal += unArchivo(a, tmp);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(mal ? `\n${mal} cosa(s) fuera de la vara.` : '\nTodo dentro de la vara.');
    process.exit(mal ? 1 : 0);
}

if (require.main === module) main();
module.exports = { medir, muestras, desfase, nivel, VARA };
