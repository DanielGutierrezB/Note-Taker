'use strict';
/**
 * Romper la app a propósito, para ver que lo grabado sobrevive.
 *
 *   · matar el proceso en medio de una clase y reanudarla en otro;
 *   · que falle cada escritura al disco, una por una, como un disco lleno o
 *     desenchufado en ese instante.
 *
 * Lo que se exige es lo de las cuatro promesas: el audio no se pierde ni se
 * pisa, la falla se ve, y de la caída se vuelve sin perder lo grabado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const grabacion = require('../engine/grabacion');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');
const relecturas = require('../engine/relecturas');

const RAIZ = path.join(__dirname, '..');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-caos-'));
}

function pedazo(muestras) {
    return Buffer.alloc((muestras || 4096) * 2, 7);
}

/** Lo que dice la cabecera de un WAV sobre cuánto audio trae, y lo que trae de verdad. */
function wavLegible(archivo) {
    const b = fs.readFileSync(archivo);
    return {
        riff: b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE',
        declara: b.readUInt32LE(40),
        tiene: b.length - 44
    };
}

/**
 * Un proceso aparte que graba una clase y se muere sin avisar.
 *
 * Abre una toma, sigue grabando un rato sin ningún cambio —así el archivo de
 * notas queda atrás del WAV— y se mata con SIGKILL, que es lo que no deja
 * correr ningún `exit`, ningún `finally` ni `apagar`.
 */
const GUION_QUE_SE_MUERE = `
const grabacion = require(${JSON.stringify(path.join(RAIZ, 'engine', 'grabacion.js'))});
const pedazo = () => Buffer.alloc(4096 * 2, 7);
const st = grabacion.iniciar({ dir: process.argv[1], curso: 'caos', fps: 30, sinReloj: true });
for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
grabacion.abrirToma();
for (let i = 0; i < 120; i++) grabacion.pcm(pedazo());
process.stdout.write(JSON.stringify({ json: st.archivos.json }));
process.kill(process.pid, 'SIGKILL');
`;

module.exports = function (t) {
    t.group('caos · el proceso muere en medio de la clase');

    t.test('se reanuda en otro proceso sin pisar el audio, con la toma hasta donde llegó', async () => {
        const dir = carpeta();
        const r = spawnSync(process.execPath, ['-e', GUION_QUE_SE_MUERE, dir], { encoding: 'utf8' });
        t.eq(r.signal, 'SIGKILL', 'se murió de verdad');
        const { json } = JSON.parse(r.stdout);

        const audio = workspace.audioDir(dir);
        const [primero] = fs.readdirSync(audio).filter(n => n.endsWith('.wav'));
        const antes = wavLegible(path.join(audio, primero));
        t.ok(antes.riff, 'el WAV de la primera mitad se abre');
        t.eq(antes.declara, antes.tiene, 'y su cabecera dice lo que tiene');
        t.eq(antes.tiene, 160 * 4096 * 2, 'con todo lo que llegó antes de morir');

        const previa = sesionesGrabadas.paraReanudar(json, null);
        const wav = previa.estado.sesiones[0];
        const finDelAudio = wav.desdeMs + 160 * 4096 / 48000 * 1000;
        t.near(previa.estado.tomas[0].outMs, finDelAudio, 5, 'la toma va hasta donde llegó el audio, no hasta el último guardado');

        const reanudada = grabacion.reanudar(json, { sinReloj: true, sampleRate: 48000, desdeMs: finDelAudio + 5000 });
        try {
            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
        } finally {
            await grabacion.terminar();
        }
        t.ok(reanudada, 'reanudó');
        const despues = wavLegible(path.join(audio, primero));
        t.eq(despues.tiene, antes.tiene, 'y el WAV de antes sigue entero: el nuevo no cayó encima');
        t.eq(fs.readdirSync(audio).filter(n => n.endsWith('.wav')).length, 2, 'son dos WAV');
    });

    t.group('caos · el disco falla en cada escritura, de a una');

    t.test('la clase se termina igual, y el audio que se escribió se puede abrir', async () => {
        // Se cuentan las escrituras de una clase corta y después se repite la
        // misma clase haciendo fallar la primera, la segunda, la tercera…
        //
        // Sin releer: lo que se prueba son las escrituras, y cada relectura es
        // Whisper de verdad sobre el audio, que en un bucle de cien clases es
        // un minuto de GPU.
        const atender = relecturas.atender;
        relecturas.atender = () => {};
        try {
            const reales = { writeSync: fs.writeSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync };
            const clase = () => {
                const errores = [];
                const intentar = fn => { try { fn(); } catch (e) { errores.push(e.message); } };
                for (let i = 0; i < 10; i++) intentar(() => grabacion.pcm(pedazo()));
                intentar(() => grabacion.abrirToma());
                for (let i = 0; i < 10; i++) intentar(() => grabacion.pcm(pedazo()));
                intentar(() => grabacion.cerrarToma());
                return errores;
            };
            let escrituras = 0;
            const contar = () => {
                for (const k of Object.keys(reales)) fs[k] = (...a) => { escrituras++; return reales[k](...a); };
            };
            const soltar = () => Object.assign(fs, reales);

            grabacion.iniciar({ dir: carpeta(), curso: 'caos', fps: 30, sinReloj: true });
            contar();
            try { clase(); } finally { soltar(); }
            await grabacion.terminar();
            t.ok(escrituras > 10, `una clase corta escribe ${escrituras} veces`);

            let rotas = 0;
            for (let falla = 1; falla <= escrituras; falla++) {
                const dir = carpeta();
                grabacion.iniciar({ dir, curso: 'caos', fps: 30, sinReloj: true });
                let n = 0;
                for (const k of Object.keys(reales)) {
                    fs[k] = (...a) => {
                        n++;
                        if (n === falla) throw new Error('ENOSPC: no queda sitio en el disco');
                        return reales[k](...a);
                    };
                }
                try { clase(); } finally { soltar(); }
                try { await grabacion.terminar(); } catch (e) { grabacion.apagar(); }
                if (grabacion.activa()) { rotas++; grabacion.apagar(); }
                for (const n of fs.readdirSync(workspace.audioDir(dir)).filter(x => x.endsWith('.wav'))) {
                    const w = wavLegible(path.join(workspace.audioDir(dir), n));
                    if (!w.riff || w.declara !== w.tiene) rotas++;
                }
            }
            t.eq(rotas, 0, 'ninguna clase quedó en pie ni con un WAV que no se abre');
        } finally {
            relecturas.atender = atender;
        }
    });
};
