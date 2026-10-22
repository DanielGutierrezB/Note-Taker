'use strict';
/**
 * arnes.js — Lo que comparten los arneses que miran la maqueta en Chrome.
 *
 * Cada `tools/probar-semanal-*.js` traía su copia de lo mismo: la ruta de
 * Chrome, el puerto, el contador de lo que salió mal, los errores de la página
 * y el cierre. Las copias ya se habían separado de las herramientas viejas
 * —ninguna leía `NT_CHROME` ni `--puerto`—, que es lo que pasa con las copias.
 * Acá hay una, y cada arnés se queda con lo suyo: qué mira y qué espera.
 */

const puppeteer = require('puppeteer-core');
const maqueta = require('../maqueta/abrir');
const { arg } = require('./cli');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const espera = ms => new Promise(r => setTimeout(r, ms));
const cerca = (a, b, tolerancia = 1.5) => Math.abs(a - b) <= tolerancia;

/**
 * La maqueta levantada y una pestaña de Chrome sin ventana mirándola.
 *
 * @param {number} puerto el de este arnés, para que dos puedan correr a la vez;
 *   `--puerto` lo cambia
 * @returns {Promise<{p, ir, decir, terminar}>} `ir(escenario)` carga uno y
 *   espera a que la maqueta lo termine de poner; `terminar()` dice cómo fue,
 *   cierra todo y sale con 1 si algo estuvo mal
 */
async function abrir(puerto) {
    const sitio = await maqueta.levantar(Number(arg('puerto', puerto)));
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));

    let mal = 0;
    const decir = (bien, texto) => {
        console.log(`   ${bien ? '✓' : '✗'} ${texto}`);
        if (!bien) mal += 1;
    };
    const ir = async escenario => {
        await p.goto(`${sitio.url}?e=${escenario}`, { waitUntil: 'networkidle0' });
        await p.evaluate(() => window.maquetaPuesta);
    };
    const terminar = async () => {
        decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
        console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
        await nave.close();
        await sitio.bajar();
        process.exit(mal ? 1 : 0);
    };
    return { p, ir, decir, terminar };
}

module.exports = { abrir, espera, cerca };
