#!/usr/bin/env node
'use strict';
/**
 * tools/validar-plantilla.js — Revisa una plantilla de Premiere y, si sirve, la
 * deja como la que viaja con la app.
 *
 *   node tools/validar-plantilla.js ~/Desktop/Plantilla.prproj
 *   node tools/validar-plantilla.js ~/Desktop/Plantilla.prproj --instalar
 *
 * Mira tres cosas, que son las que hacen fallar un proyecto generado:
 *   1. que tenga los ejemplares de los que se clona todo (`loQueFalta`);
 *   2. de cuántos cuadros por segundo es su secuencia, que es el fps de todo lo
 *      que se genere;
 *   3. que generar con ella dé un proyecto que el motor vuelva a leer sin
 *      referencias colgando, sobre una carpeta de juguete en /tmp.
 *
 * Y cuenta lo que trae adentro, porque nada de eso llega al proyecto generado
 * pero sí viaja en el instalador: una plantilla armada sobre un proyecto real
 * lleva las rutas de su material a cualquier Mac donde se instale la app.
 *
 * Con `--instalar` la copia a `plantillas/Plantilla-30.prproj` (o al fps que
 * tenga) solo si las tres cosas dieron bien.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const prproj = require('../engine/prproj');
const { Taller, loQueFalta } = require('../engine/prproj-secuencia');
const carpetaPrproj = require('../engine/prproj-carpeta');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const workspace = require('../engine/workspace');
const { CARPETA: CARPETA_NEUTRA } = require('./limpiar-plantilla');

const RAIZ = path.join(__dirname, '..');

/** Una carpeta de juguete: una clase de un minuto con dos tomas y una claqueta. */
function carpetaDePrueba(fps) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-plantilla-'));
    const T0 = Date.parse('2026-09-30T10:00:00');
    const secuencia = 'prueba_2026-09-30_10-00-00';
    const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
    workspace.ensureDir(path.dirname(wav));
    const muestras = 48000 * 60;
    const datos = Buffer.alloc(44 + muestras * 2);
    datos.write('RIFF', 0); datos.writeUInt32LE(36 + muestras * 2, 4); datos.write('WAVE', 8);
    datos.write('fmt ', 12); datos.writeUInt32LE(16, 16); datos.writeUInt16LE(1, 20); datos.writeUInt16LE(1, 22);
    datos.writeUInt32LE(48000, 24); datos.writeUInt32LE(96000, 28); datos.writeUInt16LE(2, 32); datos.writeUInt16LE(16, 34);
    datos.write('data', 36); datos.writeUInt32LE(muestras * 2, 40);
    fs.writeFileSync(wav, datos);

    const estado = vivo.estadoNuevo({ secuencia, curso: 'prueba', ceroMs: T0, fps });
    estado.sesiones = [{ archivo: wav, desdeMs: T0, segundos: 60, sampleRate: 48000, canales: 1 }];
    estado.tomas = [
        { id: 1, vista: 'PV', comentario: '', inMs: T0 + 5000, outMs: T0 + 20000, descartada: false, palabras: [], comentarios: [] },
        { id: 2, vista: 'R', comentario: '', inMs: T0 + 25000, outMs: T0 + 50000, descartada: false, palabras: [], comentarios: [] }
    ];
    vivo.anotarClaqueta(estado, { ms: T0 + 2000, confirmada: true, origen: 'golpe' });
    estado.terminada = T0 + 60000;
    const archivos = workspace.archivosDeSesion(dir, secuencia);
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return dir;
}

async function main() {
    const ruta = process.argv[2];
    const instalar = process.argv.includes('--instalar');
    if (!ruta || !fs.existsSync(ruta)) {
        console.log('Uso: node tools/validar-plantilla.js <plantilla.prproj> [--instalar]');
        process.exit(1);
    }

    const proyecto = prproj.Proyecto.leer(ruta);
    const taller = new Taller(proyecto);
    const faltan = loQueFalta(taller.moldes);
    const fps = carpetaPrproj.fpsDeLaPlantilla(taller);
    const secuencias = proyecto.porClase('Sequence').length;
    const medios = [...new Set(proyecto.porClase('Media')
        .map(k => (/<FilePath>([^<]*)<\/FilePath>/.exec(proyecto.contenido(k)) || [])[1])
        .filter(r => r && r.startsWith('/')))];

    console.log(`Plantilla: ${ruta}`);
    console.log(`  cuadros por segundo: ${fps == null ? 'no se pudo leer' : Math.round(fps * 1000) / 1000}`);
    console.log(`  trae ${secuencias} secuencia(s) y ${medios.length} archivo(s) de material`);
    // Nada de esto llega al proyecto generado, pero viaja en el instalador: una
    // plantilla armada sobre un proyecto real lleva adentro las rutas de su
    // material. Las que `tools/limpiar-plantilla.js` ya dejó neutras no cuentan.
    const carpetas = [...new Set(medios.map(m => path.dirname(m)))];
    for (const c of carpetas.slice(0, 5)) console.log(`    ${c}/`);
    if (carpetas.length > 5) console.log(`    … y ${carpetas.length - 5} carpeta(s) más`);
    const ajenas = carpetas.filter(c => !c.startsWith(CARPETA_NEUTRA));
    if (ajenas.length) {
        console.log('  ! trae rutas de material real: pasala por tools/limpiar-plantilla.js');
    }
    if (faltan.length) {
        console.log(`  ✗ le falta: ${faltan.join('; ')}`);
        process.exit(1);
    }
    console.log('  ✓ tiene todos los ejemplares');

    const dir = carpetaDePrueba(fps || 30);
    const destino = path.join(dir, 'Proyecto', 'prueba.prproj');
    const r = await carpetaPrproj.generar({
        carpeta: dir, destino, plantilla: ruta,
        config: { capturas: 2, vistas: { PV: [1], R: [2] } }
    });
    if (!r.ok) {
        console.log(`  ✗ generar con ella falló: ${r.error}`);
        process.exit(1);
    }
    const revision = prproj.Proyecto.leer(destino).verificar();
    if (!revision.ok) {
        console.log(`  ✗ el proyecto generado no cierra: ${JSON.stringify(revision).slice(0, 400)}`);
        process.exit(1);
    }
    console.log(`  ✓ genera un proyecto que se vuelve a leer sin referencias colgando (${r.cortes} cortes)`);

    if (!instalar) return;
    const nombre = `Plantilla-${Math.round(fps)}.prproj`;
    const final = path.join(RAIZ, 'plantillas', nombre);
    fs.mkdirSync(path.dirname(final), { recursive: true });
    fs.copyFileSync(ruta, final);
    console.log(`  → instalada en plantillas/${nombre}`);
}

main().catch(e => { console.error(e); process.exit(1); });
