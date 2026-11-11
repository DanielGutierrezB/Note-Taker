#!/usr/bin/env node
'use strict';
/**
 * banco-carga.js — Cuánto le pide la app a la Mac mientras graba una clase.
 *
 *   node tools/banco-carga.js --wav=<audio.wav> [--minutos=5] [--salida=antes.json]
 *   node tools/banco-carga.js --wav=<audio.wav> --contra=antes.json
 *
 * Las frases de señal salen de los Ajustes de esta Mac, como en la app: con las
 * de fábrica, una clase donde el profesor dice «vamos a la pantalla» no abre
 * las mismas tomas, y entonces el banco no estaría midiendo esa clase.
 *
 * Le pasa al motor una clase ya grabada **a ritmo real** y mide lo que cuesta:
 * la GPU, la CPU y la memoria de cada proceso, cuánto tarda cada pasada del
 * vivo y cuánto tarda una palabra en aparecer desde que se dice. Al final
 * escribe las tomas y el texto, que es lo que no puede empeorar.
 *
 * **A ritmo real y no acelerado, que es lo que lo distingue de
 * `simular-grabacion.js`.** Aquella corre cien veces más rápido para ver qué
 * tomas salen; eso sirve para la precisión y no para la carga, porque una clase
 * de media hora metida en veinte segundos no se parece en nada a lo que la Mac
 * aguanta mientras alguien habla. Acá el PCM entra como lo manda la ventana
 * —pedazos de 4096 muestras, contra el reloj— y el motor corre con su propio
 * ciclo, el mismo `setInterval` de la app.
 *
 * **Para qué existe:** para no tocar el vivo a ciegas. Cada cambio que busque
 * aliviar la Mac se corre antes y después con la misma clase, y con `--contra`
 * se ven los dos lados: si la carga baja pero el texto o las tomas cambian, el
 * cambio no sirve.
 *
 * Lo que NO mide: que el micrófono abra, que el dispositivo no se caiga y que
 * la pantalla dibuje. Eso es de la ventana.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFile } = require('child_process');

const paths = require('../engine/paths');
const ajustes = require('../engine/ajustes');
const grabacion = require('../engine/grabacion');
const registro = require('../engine/registro');
const residente = require('../engine/oido-residente');
const cargaDelSistema = require('../engine/carga-del-sistema');
const { arg, mmss } = require('./lib/cli');

/** El mismo tamaño de pedazo y la misma tasa que manda el capturador de la ventana. */
const MUESTRAS_POR_PEDAZO = 4096;
const TASA = 48000;

/**
 * Cada cuánto se mira la GPU, y cada cuánto los procesos.
 *
 * La GPU, muy seguido y a propósito: `ioreg` da el uso de ESTE instante, y el
 * vivo trabaja a tirones —medio segundo de pasada cada dos—. Mirándola cada dos
 * segundos, el mismo ritmo de las pasadas, la medición caía siempre en el mismo
 * punto del ciclo y daba 0 % o 90 % según la suerte de dónde empezó. Cada
 * cuarto de segundo, el promedio de muchas muestras sí es cuánto se usó.
 *
 * Los procesos van más espaciados porque `ps -A` los lista todos y eso sí se
 * paga.
 */
const GPU_CADA_MS = 250;
const PROCESOS_CADA_MS = 2000;

/** Una pasada que no llega a esto no le preguntó a Whisper: era silencio. */
const PASADA_LIVIANA_MS = 100;

const espera = ms => new Promise(r => setTimeout(r, ms));

/** El WAV a PCM crudo de 16 bits, a la tasa que declara la captura. */
function aPcm(wav, segundos) {
    const ffmpeg = paths.ffmpeg();
    if (!ffmpeg.path) throw new Error('Falta ffmpeg.');
    const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nt-banco-')), 'in.raw');
    const args = ['-v', 'error', '-y', '-i', wav];
    if (segundos) args.push('-t', String(segundos));
    args.push('-ar', String(TASA), '-ac', '1', '-f', 's16le', destino);
    const r = spawnSync(ffmpeg.path, args);
    if (r.status !== 0) throw new Error(`ffmpeg no pudo con ${wav}`);
    return destino;
}

const correr = (bin, args) => new Promise(resolve => {
    execFile(bin, args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, salida) => resolve(err ? '' : String(salida)));
});

/** Cuánto se está usando la GPU entera, ahora mismo. */
async function muestraDeGpu() {
    return cargaDelSistema.usoDeGpu(await correr('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']));
}

/**
 * La CPU y la memoria de cada proceso que importa. Por proceso solo se puede
 * ver la CPU: la GPU por proceso pide permisos de administrador, y la entera
 * alcanza para saber si está llena.
 */
async function muestraDeProcesos() {
    const ps = await correr('/bin/ps', ['-A', '-o', 'pcpu=,rss=,comm=']);
    const m = { whisperCpu: 0, whisperMb: 0, nodeCpu: 0 };
    for (const linea of ps.split('\n')) {
        const p = linea.trim().match(/^([\d.,]+)\s+(\d+)\s+(.+)$/);
        if (!p) continue;
        const cpu = Number(p[1].replace(',', '.'));
        const mb = Number(p[2]) / 1024;
        const nombre = path.basename(p[3]);
        if (nombre.startsWith('whisper')) { m.whisperCpu += cpu; m.whisperMb += mb; }
        // El proceso de este banco hace de proceso principal de la app: es el
        // que escribe el WAV, arma el estado y guarda el archivo de notas.
        else if (nombre === 'node' || nombre === 'Note Taker') m.nodeCpu += cpu;
    }
    return m;
}

const mediana = a => cuantil(a, 0.5);

function cuantil(valores, parte) {
    const a = valores.filter(x => x != null).sort((x, y) => x - y);
    return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * parte))] : null;
}

const redondo = n => (n == null ? null : Math.round(n * 10) / 10);

/**
 * Un número resumido. El promedio para lo que se usa a tirones —la GPU está al
 * 90 % medio segundo y en nada el resto, y lo que importa es cuánto se usó en
 * total—, y la mediana y el peor para lo que se espera, como una pasada.
 */
function resumen(valores) {
    const a = valores.filter(x => x != null);
    return {
        media: a.length ? redondo(a.reduce((x, y) => x + y, 0) / a.length) : null,
        mediana: redondo(mediana(a)),
        p90: redondo(cuantil(a, 0.9)),
        peor: a.length ? redondo(Math.max(...a)) : null
    };
}

/**
 * Qué tan atrás va el texto en vivo en este aviso: la hora de la última palabra
 * que hay contra la hora de ahora.
 *
 * La última y no cada una: al cerrar una toma, la relectura le reescribe las
 * palabras enteras —otros objetos, otros instantes— y contarlas como recién
 * aparecidas decía que una palabra tardó medio minuto en salir cuando se había
 * visto en pantalla desde el principio. La última palabra no la mueve ninguna
 * relectura, y es exactamente lo que quien graba está esperando ver.
 */
function atrasSec(estado, ahora) {
    let ultima = 0;
    for (const w of estado.sueltas || []) ultima = Math.max(ultima, w.t);
    for (const t of estado.tomas || []) {
        for (const w of (t.palabras || [])) ultima = Math.max(ultima, w.t);
    }
    return ultima ? (ahora - ultima) / 1000 : null;
}

/** El texto entero de la clase, para poder compararlo tal cual. */
function textoDe(tomas, sueltas) {
    const partes = tomas.map(t => `#${t.id} ${(t.palabras || []).map(w => w.texto).join(' ')}`);
    partes.push(`sueltas ${(sueltas || []).map(w => w.texto).join(' ')}`);
    return partes.join('\n');
}

async function medir(wav, minutos) {
    const raw = aPcm(wav, minutos * 60);
    const pcm = fs.readFileSync(raw);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-banco-dir-'));
    const segundos = pcm.byteLength / 2 / TASA;
    console.log(`Audio:   ${wav}`);
    console.log(`Son:     ${mmss(segundos)}, a ritmo real`);
    console.log(`Salida:  ${dir}\n`);

    const pasadas = [];
    const demoras = [];

    const estadoInicial = grabacion.iniciar({
        dir,
        curso: 'banco',
        fps: 30,
        idioma: arg('idioma', 'auto'),
        sampleRate: TASA,
        canales: 1,
        dispositivo: 'banco',
        frases: (ajustes.leer() || {}).frases || null,
        avisar: aviso => {
            if (aviso.tipo !== 'estado') return;
            // Cuánto tardó ESTA pasada: `buscarSenales` lo anota en su `finally`,
            // que corre justo después de avisar y antes de volver al reloj.
            const s = grabacion._sesion();
            setImmediate(() => { if (s) pasadas.push(s.ultimaPasadaMs); });
            // Y cuánto tarda en aparecer lo que se dice: como el audio entra
            // contra el reloj, la hora de una palabra es la hora en que sonó.
            const atras = atrasSec(aviso.estado, Date.now());
            if (atras != null) demoras.push(atras);
        }
    });

    const gpu = [];
    const procesos = [];
    const mirarGpu = setInterval(async () => { gpu.push(await muestraDeGpu()); }, GPU_CADA_MS);
    const mirarProcesos = setInterval(async () => { procesos.push(await muestraDeProcesos()); }, PROCESOS_CADA_MS);

    // El PCM contra el reloj: cuánto tendría que haber entrado a esta altura, y
    // se manda lo que falte. Así el WAV no se atrasa ni se adelanta contra el
    // reloj, que es lo que hace la ventana con el micrófono abierto.
    const bytesPorSegundo = TASA * 2;
    const bytesPorPedazo = MUESTRAS_POR_PEDAZO * 2;
    const arranque = Date.now();
    let off = 0;
    let dicho = 0;
    while (off < pcm.byteLength) {
        const deberia = Math.min(pcm.byteLength, Math.floor((Date.now() - arranque) / 1000 * bytesPorSegundo));
        while (off < deberia) {
            const fin = Math.min(off + bytesPorPedazo, deberia);
            grabacion.pcm(pcm.subarray(off, fin), 'ventana');
            off = fin;
        }
        if (off < pcm.byteLength) await espera(85);
        // Una línea por segundo: el PCM entra doce veces por segundo, y una
        // línea por pedazo son cien kilobytes de progreso en una clase corta.
        if (Date.now() - dicho < 1000) continue;
        dicho = Date.now();
        process.stdout.write(`\r  ${(off / pcm.byteLength * 100).toFixed(0)}% · ${mmss(off / 2 / TASA)} de audio · ` +
            `${grabacion.resumen().tomas.length} tomas · pasada ${pasadas.length ? pasadas[pasadas.length - 1] : '—'} ms   `);
    }
    process.stdout.write('\n\n');

    // Lo último que se dijo todavía está por oírse: se le da el rato que la app
    // le daría, y después se cierra como se cierra una clase.
    await espera(3000);
    const cerrado = Date.now();
    const final = await grabacion.terminar();
    clearInterval(mirarGpu);
    clearInterval(mirarProcesos);
    residente.apagar();
    fs.rmSync(path.dirname(raw), { recursive: true, force: true });

    const trabajo = pasadas.reduce((n, ms) => n + ms, 0);
    const eventos = registro.todo();
    const relecturas = eventos.filter(e => e.evento === 'relectura.leida');
    const salteado = eventos.filter(e => e.evento === 'senal.salteado').pop();
    return {
        cuando: new Date().toISOString(),
        wav: path.basename(wav),
        audioSec: Math.round(segundos),
        carga: {
            gpu: resumen(gpu),
            whisperCpu: resumen(procesos.map(c => c.whisperCpu)),
            whisperMb: redondo(Math.max(0, ...procesos.map(c => c.whisperMb))),
            nodeCpu: resumen(procesos.map(c => c.nodeCpu))
        },
        vivo: {
            pasadas: pasadas.length,
            // La parte de la clase que el vivo pasó transcribiendo. Es lo único
            // de acá que no se ensucia con lo que haga el resto de la Mac: la
            // GPU la comparten todos, y una medición con otra app encima dice
            // más de esa app que de esta.
            ocupado: redondo(trabajo / 10 / segundos),
            // Las que no le preguntaron a Whisper: con más silencio salteado,
            // más de estas y la misma clase.
            sinWhisper: pasadas.filter(ms => ms < PASADA_LIVIANA_MS).length,
            pasadaMs: resumen(pasadas.filter(ms => ms >= PASADA_LIVIANA_MS)),
            demoraSec: resumen(demoras),
            lentas: eventos.filter(e => e.evento === 'senal.pasada-lenta').length,
            // Cuántas veces la Mac se ahogó tanto que el vivo pasó al modelo
            // chico para no perder audio (`mirarSiDaAbasto` en ciclo-senales).
            conElChico: eventos.filter(e => e.evento === 'vivo.con-el-chico').length,
            salteadoSec: salteado ? salteado.datos.enTotalSec : 0
        },
        cierre: { segundos: redondo((Date.now() - cerrado) / 1000), relecturas: relecturas.length },
        tomas: (final.tomas || []).map(t => ({
            id: t.id,
            inSec: redondo((t.inMs - estadoInicial.ceroMs) / 1000),
            outSec: t.outMs == null ? null : redondo((t.outMs - estadoInicial.ceroMs) / 1000),
            vista: t.vista,
            palabras: (t.palabras || []).length
        })),
        texto: textoDe(final.tomas || [], final.sueltas)
    };
}

/** Un número y su diferencia contra la corrida de antes. */
function contra(ahora, antes, unidad) {
    if (ahora == null) return '—';
    if (antes == null) return `${ahora}${unidad}`;
    const d = Math.round((ahora - antes) * 10) / 10;
    const pinta = d === 0 ? 'igual' : `${d > 0 ? '+' : ''}${d}${unidad}`;
    return `${ahora}${unidad} (antes ${antes}${unidad}, ${pinta})`;
}

function contarParte(r, viejo, unidad, cual) {
    const clave = cual || 'mediana';
    return `${clave} ${contra(r[clave], viejo && viejo[clave], unidad)} · peor ${contra(r.peor, viejo && viejo.peor, unidad)}`;
}

function parte(m, viejo) {
    const v = viejo || {};
    console.log(`Lo que costó (${mmss(m.audioSec)} de clase):`);
    console.log(`  GPU               ${contarParte(m.carga.gpu, v.carga && v.carga.gpu, ' %', 'media')}`);
    console.log(`  CPU de Whisper    ${contarParte(m.carga.whisperCpu, v.carga && v.carga.whisperCpu, ' %', 'media')}`);
    console.log(`  CPU del motor     ${contarParte(m.carga.nodeCpu, v.carga && v.carga.nodeCpu, ' %', 'media')}`);
    console.log(`  Memoria Whisper   ${contra(m.carga.whisperMb, v.carga && v.carga.whisperMb, ' MB')}`);
    console.log('');
    console.log('El vivo:');
    console.log(`  pasadas           ${contra(m.vivo.pasadas, v.vivo && v.vivo.pasadas, '')}` +
        `, ${contra(m.vivo.sinWhisper, v.vivo && v.vivo.sinWhisper, '')} sin preguntarle a Whisper` +
        `${m.vivo.lentas ? `, ${m.vivo.lentas} lentas` : ''}` +
        `${m.vivo.conElChico ? `, ${m.vivo.conElChico} veces al modelo chico` : ''}`);
    console.log(`  cada pasada       ${contarParte(m.vivo.pasadaMs, v.vivo && v.vivo.pasadaMs, ' ms')}`);
    console.log(`  transcribiendo    ${contra(m.vivo.ocupado, v.vivo && v.vivo.ocupado, ' % de la clase')}`);
    // El peor caso de la demora no dice nada: en un silencio largo la última
    // palabra envejece sin que nada falle. El noveno décimo sí.
    console.log(`  tarda en aparecer mediana ${contra(m.vivo.demoraSec.mediana, v.vivo && v.vivo.demoraSec.mediana, ' s')}` +
        ` · p90 ${contra(m.vivo.demoraSec.p90, v.vivo && v.vivo.demoraSec.p90, ' s')}`);
    console.log(`  audio salteado    ${contra(m.vivo.salteadoSec, v.vivo && v.vivo.salteadoSec, ' s')}`);
    console.log('');
    console.log(`El cierre:          ${contra(m.cierre.segundos, v.cierre && v.cierre.segundos, ' s')} · ${m.cierre.relecturas} relecturas`);
    console.log('');
    console.log(`Tomas (${m.tomas.length}):`);
    for (const t of m.tomas) {
        console.log(`  ${t.id}. ${mmss(t.inSec)} → ${t.outSec == null ? '—' : mmss(t.outSec)} ${t.vista} · ${t.palabras} palabras`);
    }
    if (!viejo) return;
    console.log('');
    const tomas = mismasTomas(m.tomas, viejo.tomas);
    const parecido = Math.round(cuantoSeParece(m.texto, viejo.texto) * 100);
    console.log(`Contra la corrida de antes: tomas ${tomas.igual ? 'iguales' : `DISTINTAS (${tomas.porque})`} · ` +
        `texto ${parecido} % igual`);
    if (!tomas.igual || parecido < PARECIDO_MINIMO) {
        console.log('  Un cambio que alivia la Mac pero mueve las tomas o el texto no sirve: miralo antes de adoptarlo.');
    }
}

/**
 * Qué tan parecidos son dos textos, por las palabras que comparten.
 *
 * No se comparan letra por letra, y es por el ritmo real: las ventanas del
 * vivo no caen en el mismo milisegundo en dos corridas, así que Whisper parte
 * las frases un poco distinto y dos corridas del MISMO código dan un 97 % y no
 * un 100 %. Lo que delata un cambio malo es el texto que desaparece, no una
 * coma movida.
 */
function cuantoSeParece(a, b) {
    const bolsa = texto => {
        const m = new Map();
        for (const w of String(texto || '').toLowerCase().split(/\s+/).filter(Boolean)) m.set(w, (m.get(w) || 0) + 1);
        return m;
    };
    const x = bolsa(a);
    const y = bolsa(b);
    let comunes = 0;
    for (const [w, n] of x) comunes += Math.min(n, y.get(w) || 0);
    const total = Math.max([...x.values()].reduce((p, q) => p + q, 0), [...y.values()].reduce((p, q) => p + q, 0));
    return total ? comunes / total : 1;
}

/** Debajo de esto, el texto perdió algo y hay que mirarlo. */
const PARECIDO_MINIMO = 95;

/** Cuánto se puede mover un borde entre dos corridas sin que sea otra toma. */
const BORDE_TOLERANCIA_SEC = 1;

/** Las mismas tomas: la misma cantidad, la misma vista y los bordes en su sitio. */
function mismasTomas(ahora, antes) {
    if (!antes) return { igual: true };
    if (ahora.length !== antes.length) return { igual: false, porque: `${ahora.length} contra ${antes.length}` };
    for (const [i, t] of ahora.entries()) {
        const v = antes[i];
        if (t.vista !== v.vista) return { igual: false, porque: `la ${t.id} salió ${t.vista} y era ${v.vista}` };
        const corrido = ['inSec', 'outSec'].find(b => t[b] != null && v[b] != null && Math.abs(t[b] - v[b]) > BORDE_TOLERANCIA_SEC);
        if (corrido) return { igual: false, porque: `el ${corrido === 'inSec' ? 'IN' : 'OUT'} de la ${t.id} se corrió ${redondo(t[corrido] - v[corrido])} s` };
    }
    return { igual: true };
}

async function main() {
    const wav = arg('wav');
    if (!wav || !fs.existsSync(wav)) {
        console.error('Falta --wav=<ruta al audio de una clase>');
        process.exit(1);
    }
    const minutos = Number(arg('minutos', '5'));
    const antes = arg('contra', null);
    const salida = arg('salida', null);

    const m = await medir(wav, minutos);
    console.log('');
    parte(m, antes && fs.existsSync(antes) ? JSON.parse(fs.readFileSync(antes, 'utf8')) : null);
    if (salida) {
        fs.writeFileSync(salida, `${JSON.stringify(m, null, 2)}\n`);
        console.log(`\nMedición guardada en ${salida}: con --contra=${salida} se compara la próxima.`);
    }
}

main().catch(err => {
    console.error(err.stack);
    process.exit(1);
});
