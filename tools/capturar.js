#!/usr/bin/env node
'use strict';
/**
 * Las capturas de cada pantalla, a los tres anchos.
 *
 * Es lo único que puede decir si una tira envuelve bien, si una pastilla se
 * lee, o si el verde se distingue del ámbar. Lo que sí se mide con número está
 * en `auditar.js` y en `medir-botones.js`; esto es para mirar.
 *
 *   node tools/capturar.js                       todas, a 900/1180/1440
 *   node tools/capturar.js --escenario en-vivo
 *   node tools/capturar.js --ancho 1180
 *
 * **Falla si la página tira un error de JS** en vez de sacar la foto de una
 * pantalla rota, que es justo la foto que uno mira y da por buena.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DESTINO = path.join(__dirname, '..', 'docs', 'capturas');

function arg(nombre, def) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i === -1 ? def : process.argv[i + 1];
}

const ESCENARIOS = arg('escenario', null) ? [arg('escenario')] : [
    'sin-carpeta', 'sesiones', 'preparar', 'preparar-sin-audio', 'sin-whisper',
    'preparar-microfono', 'preparar-zoom-falso', 'sin-zoom',
    'en-vivo', 'en-vivo,desplegada', 'en-vivo,claqueta-abierta',
    'toma-abierta', 'releyendo', 'sin-audio', 'terminada', 'notas-de-antes', 'foto', 'foto-cien',
    'palmada', 'palmada-vencida', 'prproj', 'prproj-lleno', 'prproj-listo',
    'ajustes', 'ajustes-semanal', 'diagnostico', 'faltan-modelos',
    // El modo semanal, momento por momento.
    'semanal', 'semanal-grabando', 'semanal-ficha', 'semanal-revisar', 'semanal-revisar-fuera', 'semanal-cortando', 'semanal-hecho',
    'iconos'
];
const ANCHOS = arg('ancho', null) ? [Number(arg('ancho'))] : [900, 1180, 1440];
const ALTO = Number(arg('alto', 840));

async function main() {
    fs.mkdirSync(DESTINO, { recursive: true });
    const sitio = await maqueta.levantar(Number(arg('puerto', 4612)));
    const navegador = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--force-device-scale-factor=1']
    });

    const rotas = [];
    try {
        for (const escenario of ESCENARIOS) {
            for (const ancho of ANCHOS) {
                const pagina = await navegador.newPage();
                const errores = [];
                pagina.on('pageerror', e => errores.push(e.message));
                pagina.on('console', m => {
                    if (m.type() === 'error' && !m.text().includes('favicon')) {
                        errores.push(m.text());
                    }
                });

                await pagina.setViewport({ width: ancho, height: ALTO });
                await pagina.goto(`${sitio.url}?e=${escenario}`, { waitUntil: 'networkidle0' });
                // Esperar a que el escenario esté puesto, y no un rato fijo: los
                // del modo semanal tardan segundos en armarse.
                await pagina.evaluate('window.maquetaPuesta').catch(() => {});
                await new Promise(r => setTimeout(r, 300));

                const archivo = path.join(DESTINO, `${escenario.replace(/,/g, '+')}-${ancho}.png`);
                await pagina.screenshot({ path: archivo });
                await pagina.close();

                console.log(`${errores.length ? '✗' : '·'} ${path.basename(archivo)}`);
                for (const e of errores) {
                    console.log(`    ${e}`);
                    rotas.push(`${escenario}@${ancho}: ${e}`);
                }
            }
        }
    } finally {
        await navegador.close();
        await sitio.bajar();
    }

    console.log(`\nEn ${path.relative(process.cwd(), DESTINO)}/`);
    if (rotas.length) {
        console.log(`\n${rotas.length} vista(s) con errores de JS.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
