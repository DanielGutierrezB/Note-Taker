#!/usr/bin/env node
'use strict';
/**
 * Escribe un XML de prueba en /tmp para abrirlo en Premiere.
 *
 *   node tools/ver-marcadores.js                          uno inventado, a 30
 *   node tools/ver-marcadores.js --fps 29.97
 *   node tools/ver-marcadores.js --wav /ruta/audio.wav    con un WAV de verdad
 *   node tools/ver-marcadores.js --sidecar /…_notas-en-vivo.json
 *
 * Los marcadores son de las cosas que NO se pueden revisar mirando la app: que
 * el color sea el que se quiso, que el de entrada abarque el tramo, que el de
 * clip viaje con el WAV cuando se lo arrastra a otra secuencia, y que un
 * timecode drop-frame caiga donde dice. Todo eso solo lo contesta Premiere.
 *
 * Con `--wav` el clip apunta a un archivo de verdad, así que la secuencia
 * suena y se puede comprobar que los marcadores caen donde se oye lo que
 * dicen. Sin él, el clip apunta a un archivo que no existe y Premiere lo
 * muestra offline: alcanza para mirar los marcadores y los colores, que es
 * casi todo lo que hay que mirar.
 *
 * No toca nada del disco del editor: escribe en /tmp y nada más.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const paths = require('../engine/paths');
const { arg } = require('./lib/cli');

const FPS = Number(arg('fps', '30'));

/** Cuánto dura un WAV, con ffprobe. Sin él se supone media hora. */
function duracionDe(wav) {
    const ffprobe = paths.ffprobe();
    if (!ffprobe.path) return 1800;
    try {
        const out = execFileSync(ffprobe.path, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=nw=1:nk=1', wav
        ], { encoding: 'utf8' });
        return Number(out.trim()) || 1800;
    } catch (e) {
        return 1800;
    }
}

/** Una sesión inventada con los casos que hay que poder mirar. */
function inventada(wav, duracionSec) {
    const cero = Date.parse('2026-09-29T09:00:00');
    const seg = s => cero + s * 1000;
    const palabras = (texto, desde) => texto.split(' ').map((w, i) => ({
        t: seg(desde + i * 0.4), texto: w, hasta: seg(desde + i * 0.4 + 0.36)
    }));

    const estado = vivo.estadoNuevo({
        secuencia: `prueba-de-marcadores_${FPS}`,
        curso: 'prueba',
        ceroMs: cero,
        fps: FPS
    });

    estado.sesiones = [{
        archivo: wav,
        desdeMs: cero,
        segundos: duracionSec,
        sampleRate: 48000,
        canales: 1
    }];

    // Las tres claquetas que hay que poder distinguir de un vistazo: la
    // referencia, una sin confirmar y una puesta a mano.
    vivo.anotarClaqueta(estado, {
        ms: seg(12), paredMs: seg(12), frase: 'Claqueta 1, clase 1',
        confirmada: true, origen: 'golpe,voz'
    });
    vivo.anotarClaqueta(estado, {
        ms: seg(420), paredMs: seg(420), frase: '', confirmada: false, origen: 'golpe'
    });
    vivo.anotarClaqueta(estado, {
        ms: seg(900), paredMs: seg(900), frase: '', confirmada: true, origen: 'editor'
    });

    // Una toma de cada vista, para ver los cinco colores de marcador juntos, y
    // una descartada que NO tiene que aparecer.
    let cuando = 40;
    estado.tomas = vivo.VISTAS.map((v, i) => {
        const desde = cuando;
        cuando += 120;
        return {
            id: i + 1,
            vista: v.nombre,
            comentario: `Nota de la toma ${i + 1} · vista ${v.nombre}`,
            cuenta: '3, 2, 1.',
            inMs: seg(desde), outMs: seg(desde + 90),
            descartada: false, cerradaSola: false,
            palabras: palabras(`Esto es la toma ${i + 1} en la vista ${v.titulo} y ` +
                'tiene que verse del color que le toca', desde),
            antes: [], despues: [], comentarios: []
        };
    });
    estado.tomas.push({
        id: 99, vista: 'PV', comentario: 'ESTA NO TIENE QUE APARECER',
        cuenta: '3, 2, 1.', inMs: seg(cuando), outMs: seg(cuando + 30),
        descartada: true, palabras: [], antes: [], despues: [], comentarios: []
    });
    estado.proximaToma = 99;

    // Y un comentario sobre un pedazo del texto, que va blanco y dura lo que
    // dura la selección.
    estado.tomas[0].comentarios = [{
        desdeMs: seg(50), hastaMs: seg(58),
        texto: 'un pedazo del texto', comentario: 'Acá se traba, cortar antes'
    }];

    return estado;
}

function main() {
    const wav = arg('wav', null);
    const sidecar = arg('sidecar', null);

    let estado;
    if (sidecar) {
        estado = notasXml.estadoLeido(JSON.parse(fs.readFileSync(sidecar, 'utf8')));
        if (arg('fps', null)) estado.fps = FPS;
    } else {
        const ruta = wav || '/tmp/note-taker-audio-de-mentira.wav';
        estado = inventada(ruta, wav ? duracionDe(wav) : 1800);
    }

    const destino = path.join(os.tmpdir(), `note-taker-marcadores-${estado.fps}.xml`);
    const xml = notasXml.xmlDeNotas(estado);
    fs.writeFileSync(destino, xml);

    const marcas = notasXml.marcadores(estado);
    const clips = notasXml.clipsDeAudio(estado);
    const deClip = clips.reduce((n, c) => n + c.marcadores.length, 0);

    console.log(`\n${destino}\n`);
    console.log(`  secuencia   ${estado.secuencia}`);
    console.log(`  cuadros     ${estado.fps}${[23.976, 29.97, 59.94].includes(estado.fps) ? ' (NTSC, drop-frame)' : ''}`);
    console.log(`  tomas       ${vivo.tomasQueQuedan(estado).length} en el XML` +
        `, ${(estado.tomas || []).filter(t => t.descartada).length} descartada(s) fuera`);
    console.log(`  claquetas   ${(estado.claquetas || []).length}`);
    const deMaestro = (xml.slice(0, xml.indexOf('<sequence')).match(/<marker>/g) || []).length;
    console.log(`  marcadores  ${marcas.length} en la secuencia · ${deClip} en el clip de A1 · ` +
        `${deMaestro} en el clip maestro`);
    console.log(`  audio       ${clips.length} clip(s) en A1`);
    if (!wav && !sidecar) {
        console.log('\n  El clip apunta a un archivo que no existe, así que Premiere lo va a');
        console.log('  mostrar offline. Alcanza para mirar los marcadores y los colores;');
        console.log('  con --wav <archivo> la secuencia además suena.');
    }
    console.log('\nQué mirar en Premiere:');
    console.log('  · los de la SECUENCIA, en la regla de tiempo');
    console.log('  · los del CLIP de A1, dibujados encima del clip en su pista');
    console.log('  · los del CLIP MAESTRO: abrí el WAV del bin en el monitor de origen,');
    console.log('    o arrastralo a otra secuencia (son los que viajan con el archivo)');
    console.log('  · que el nombre diga «Toma N · PV» y «Toma N · OUT»');
    console.log('  · que cada vista llegue de su color y que las claquetas sean blancas');
    console.log('  · que el timecode del primer marcador diga lo mismo que la app');
    console.log('  · y que NO haya marcadores repetidos en la regla de tiempo: si los');
    console.log('    hubiera, Premiere está leyendo dos juegos como uno');
}

main();
