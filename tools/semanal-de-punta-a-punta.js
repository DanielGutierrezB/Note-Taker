'use strict';
/**
 * tools/semanal-de-punta-a-punta.js — El modo semanal entero, sin manos.
 *
 *   npx electron . --use-fake-device-for-media-stream \
 *       --guion=tools/semanal-de-punta-a-punta.js [--segundos=12]
 *
 * Es la única forma de comprobar el modo semanal como se usa: con la cámara
 * grabando de verdad desde la ventana, el micrófono entrando por el puente, el
 * motor abriendo y cerrando tomas, y ffmpeg cortando al final. Las pruebas de
 * `node tests/run.js` cubren el reparto y el grafo, que es la parte que se
 * puede comprobar sin medios; esto cubre lo que no: que lo que graba la ventana
 * sea lo que ffmpeg puede abrir, y que los relojes de los tres archivos caigan
 * donde tienen que caer.
 *
 * La cámara es la falsa de Chromium (`--use-fake-device-for-media-stream`): un
 * patrón que se mueve, que es justo lo que hace falta para ver si el recorte
 * cayó donde se pidió. La pantalla no se graba acá —el selector de macOS es del
 * sistema y no se puede contestar desde afuera—, así que esta corrida ejercita
 * el camino de «solo cámara», donde la cámara pasa a ser el fondo.
 *
 * Las tomas se abren y se cierran por el puente, igual que hace la tecla Enter
 * en la pantalla de clase: el micrófono falso es un pitido y Whisper no va a oír
 * ningún «3, 2, 1» en él.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const paths = require('../engine/paths');
const workspace = require('../engine/workspace');

const espera = ms => new Promise(r => setTimeout(r, ms));

/** Lo que la ventana tiene que contar de vuelta en cada paso. */
const EN_LA_VENTANA = {
    async preparar(carpeta) {
        return `(async () => {
            dev.app.ajustes = (await window.nt.ajustesGuardar({
                modo: 'semanal', semanal: { carpeta: ${JSON.stringify(carpeta)} }
            })).ajustes;
            await dev.app.irASemanal();
            return 'modo semanal, carpeta puesta';
        })()`;
    }
};

async function correr({ win, arg }) {
    const segundos = Number(arg('segundos')) || 12;
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-semanal-punta-'));
    const js = texto => win.webContents.executeJavaScript(texto);
    const decir = (...x) => console.log('  ', ...x);

    console.log(`\n── El modo semanal, de punta a punta · ${carpeta}\n`);

    // **Los ajustes de quien corre esto se dejan como estaban.** Esta corrida
    // pone la app en modo semanal con una carpeta temporal, y son los ajustes
    // de verdad: sin devolverlos, al editor le queda la app abriendo una
    // pantalla que no es la suya y apuntando a una carpeta de /tmp.
    const comoEstaban = await js('window.nt.ajustesLeer()');

    decir(await js(await EN_LA_VENTANA.preparar(carpeta)));
    await espera(2500);                       // que abra el micro y la cámara

    const listo = await js(`(() => {
        const sel = document.querySelectorAll('#semanal-cuerpo select');
        return {
            camara: sel[0] ? sel[0].value : null,
            micro: sel[1] ? sel[1].value : null,
            puedeGrabar: !document.querySelector('[data-hace="grabar"]').disabled
        };
    })()`);
    decir('cámara:', listo.camara || '(ninguna)', '· micrófono:', listo.micro || '(ninguno)');
    if (!listo.puedeGrabar) {
        console.log('\n✗ El botón de grabar está apagado: sin micrófono no hay nada que medir.\n');
        return;
    }

    decir('apretando Grabar…');
    await js(`document.querySelector('[data-hace="grabar"]').click()`);
    await espera(3000);
    const grabando = await js(`(() => ({
        paso: document.querySelector('#semanal-reloj').hidden ? 'no graba' : 'graba',
        reloj: document.querySelector('#semanal-reloj').textContent
    }))()`);
    decir('estado:', grabando.paso, '· reloj:', grabando.reloj);

    // Dos tomas, con un hueco en medio: el hueco es lo que NO tiene que salir
    // en el vídeo, y por eso es la medida que importa.
    const tomas = [];
    for (const n of [1, 2]) {
        const abre = await js(`window.nt.grabarAbrirToma()`);
        tomas.push({ n, abrio: Boolean(abre && abre.ok) });
        decir(`toma ${n}: abierta`);
        await espera((segundos / 4) * 1000);
        await js(`window.nt.grabarCerrarToma()`);
        decir(`toma ${n}: cerrada`);
        await espera((segundos / 6) * 1000);
    }

    decir('apretando Terminar…');
    await js(`document.querySelector('[data-hace="terminar"]').click()`);

    // Esperar a que la pantalla diga que terminó de cortar, mirando lo que
    // dibuja y no un reloj: cortar tarda lo que tarde.
    let paso = null;
    for (let i = 0; i < 180; i++) {
        await espera(1000);
        paso = await js(`(() => {
            const t = document.querySelector('#semanal-titulo').textContent;
            const nivel = document.querySelector('#semanal-cuerpo .nivel-barra');
            return { titulo: t, pct: nivel ? nivel.style.width : null };
        })()`);
        if (/listo|No se pudo/.test(paso.titulo)) break;
        if (i % 5 === 0) decir(`${paso.titulo}${paso.pct ? ` · ${paso.pct}` : ''}…`);
    }
    decir('la pantalla dice:', paso && paso.titulo);

    /* ── Y ahora lo que quedó en el disco ─────────────────────────────── */
    console.log('\n── Lo que quedó en el disco\n');
    const mp4 = fs.readdirSync(carpeta).filter(f => f.endsWith('.mp4'));
    const brutos = fs.existsSync(workspace.videoDir(carpeta))
        ? fs.readdirSync(workspace.videoDir(carpeta)) : [];
    const audios = fs.existsSync(workspace.audioDir(carpeta))
        ? fs.readdirSync(workspace.audioDir(carpeta)) : [];

    const mide = ruta => {
        const salida = execFileSync(paths.ffprobe().path, ['-v', 'error',
            '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height',
            '-of', 'default=nw=1', ruta], { encoding: 'utf8' });
        const d = /duration=([\d.]+)/.exec(salida);
        const pistas = [...salida.matchAll(/codec_name=(\w+)/g)].map(m => m[1]);
        const tam = /width=(\d+)\nheight=(\d+)/.exec(salida);
        return {
            segundos: d ? Number(d[1]).toFixed(2) : '?',
            pistas: pistas.join('+'),
            tamano: tam ? `${tam[1]}x${tam[2]}` : ''
        };
    };

    for (const f of brutos) {
        const r = mide(path.join(workspace.videoDir(carpeta), f));
        decir(`bruto  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas} · ${r.tamano}`);
    }
    for (const f of audios) {
        const r = mide(path.join(workspace.audioDir(carpeta), f));
        decir(`audio  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas}`);
    }
    if (!mp4.length) {
        console.log('\n✗ No salió ningún MP4.\n');
        return;
    }
    for (const f of mp4) {
        const ruta = path.join(carpeta, f);
        const r = mide(ruta);
        const megas = (fs.statSync(ruta).size / 1e6).toFixed(1);
        decir(`VÍDEO  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas} · ${r.tamano} · ${megas} MB`);
    }

    /* ── La cuenta que lo dice todo ───────────────────────────────────────
     *
     * El vídeo tiene que durar lo que duran las tomas. Pero «lo que duran las
     * tomas» está dicho en el reloj del AUDIO, y el vídeo se mide en el reloj
     * de pared: con el micrófono falso de Chromium, que escribe audio a 1,88x,
     * los dos números no se pueden comparar sin corregir la deriva. Es
     * exactamente el cruce que hace `exportar-video.js`, y por eso se repite
     * acá: si esta cuenta no cuadra, el corte está mal.
     */
    const json = fs.readdirSync(workspace.datosDir(carpeta))[0];
    const estado = JSON.parse(fs.readFileSync(path.join(workspace.datosDir(carpeta), json), 'utf8'));
    const wav = (estado.sesiones || [])[0];
    const deriva = wav && wav.segundos > 0 ? (wav.hastaMs - wav.desdeMs) / (wav.segundos * 1000) : 1;
    const suma = (estado.tomas || []).reduce((s, t) => s + (t.outMs - t.inMs), 0) / 1000;
    const esperada = suma * deriva;
    const dur = Number(mide(path.join(carpeta, mp4[0])).segundos);
    const pared = (estado.terminada - estado.ceroMs) / 1000;

    console.log(`\n   la grabación duró ${pared.toFixed(1)} s de reloj de pared`);
    console.log(`   el audio se escribió a ${deriva.toFixed(2)}x del reloj`
        + `${Math.abs(deriva - 1) > 0.01 ? ' (el micrófono falso de Chromium: con uno real da 1,00x)' : ''}`);
    console.log(`   ${(estado.tomas || []).length} toma(s), que suman ${suma.toFixed(2)} s de audio`
        + ` = ${esperada.toFixed(2)} s de pared`);
    console.log(`   el vídeo dura ${dur.toFixed(2)} s · diferencia ${Math.round((dur - esperada) * 1000)} ms`);
    // El margen es de un cuarto de segundo y no de un fotograma por dos cosas
    // que son del micrófono falso y no del corte: su ritmo no es parejo —la
    // deriva se mide sobre todo el WAV, así que un tramo puede ir más rápido
    // que la media— y cada toma pierde hasta un fotograma al recortar. Con un
    // micrófono de verdad la deriva es 1,00x y la diferencia baja a decenas de
    // milisegundos: medido, 14 ms en dos tomas.
    const bien = Math.abs(dur - esperada) < 0.25;
    console.log(`\n   ${bien ? '✓ el corte cae donde se pidió' : '✗ el corte NO cuadra'}`);
    console.log(`   todo en ${carpeta}\n`);

    await js(`window.nt.ajustesGuardar(${JSON.stringify({
        modo: comoEstaban.modo, semanal: comoEstaban.semanal
    })})`);
    console.log(`   ajustes devueltos a «${comoEstaban.modo}»\n`);
}

module.exports = { correr };
