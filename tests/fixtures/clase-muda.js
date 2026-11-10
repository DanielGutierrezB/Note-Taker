'use strict';
/**
 * Una clase de verdad por el motor, con un Whisper de mentira.
 *
 * El ciclo oye lo que se le ponga en `oir(...)`, y la relectura no relee nada,
 * salvo que `o.relee` diga qué contesta. Sirve para pinchar a mano los casos que
 * el martillo encontró y que una prueba tiene que poder repetir sin la suerte
 * de una semilla.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../../engine/grabacion');
const oirToma = require('../../engine/oir-toma');
const vivo = require('../../engine/notas-vivo');

module.exports = async function conClaseMuda(fn, o) {
    const guardado = { tramo: oirToma.tramo, leer: oirToma.leer };
    const falso = { ventana: [] };
    oirToma.tramo = async (_a, desde, hasta) => ({ palabras: falso.ventana.filter(w => w.t >= desde && w.t <= hasta) });
    oirToma.leer = o && o.relee
        ? async (_a, toma) => ({ ...vivo.repartir(o.relee(), toma), colapsadas: 0, relectura: null })
        : async () => null;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-clase-muda-'));
    try {
        const st = grabacion.iniciar({ dir, curso: 'm', fps: 30, sinReloj: true, sampleRate: 48000 });
        const s = grabacion._sesion();
        const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 250 });
        // Tres pasadas y no dos: a la última palabra de una ventana el ciclo
        // no se la cree hasta la pasada siguiente (`firmeHastaMs`).
        const oir = async (...palabras) => {
            falso.ventana = falso.ventana.concat(palabras);
            for (let i = 0; i < 3; i++) { grabacion.pcm(Buffer.alloc(48000 * 2)); await grabacion.buscarSenales(); }
            // Con una relectura corriendo el vivo pasa cada dos segundos
            // (`NUEVO_MIN_RELEYENDO_MS`) y la última se pudo saltear: se espera
            // la relectura y se oye lo que faltaba. Si no faltaba nada, esta
            // pasada no tiene audio nuevo y no hace nada.
            if (s.rehaciendo) await s.rehaciendo;
            await grabacion.buscarSenales();
        };
        for (let i = 0; i < 4; i++) grabacion.pcm(Buffer.alloc(48000 * 2));
        await fn({ st, s, w, oir, falso });
    } finally {
        oirToma.tramo = guardado.tramo;
        oirToma.leer = guardado.leer;
        grabacion.apagar();
        fs.rmSync(dir, { recursive: true, force: true });
    }
};
