'use strict';
/**
 * Sobre qué toma caen las vistas de la barra de arriba, contra la maqueta.
 *
 * La regla que se comprueba es la que pidió el editor: con una toma grabando
 * es la suya, y entre dos tomas es la de la que todavía no empezó, NO la de la
 * que se acaba de cerrar. Y que la barra lo diga, porque el botón encendido no
 * alcanza para saber de cuál está hablando.
 */

const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const espera = ms => new Promise(r => setTimeout(r, ms));

let mal = 0;
function decir(bien, texto) {
    console.log(`   ${bien ? '✓' : '✗'} ${texto}`);
    if (!bien) mal += 1;
}

const mirar = p => p.evaluate(`(() => {
    const bs = [...document.querySelectorAll('#atajo-vistas .atajo')];
    return {
        de: document.querySelector('#atajo-vistas-de').textContent.trim(),
        puesta: (bs.find(b => b.classList.contains('es-elegida')) || {}).dataset?.vista || null,
        dice: (bs[1] || {}).title || ''
    };
})()`);

const vistasDeLasTomas = p => p.evaluate(`(() => {
    const filas = [...document.querySelectorAll('#lista-vivo [data-hace="plegar"][data-toma]')];
    return filas.map(f => f.dataset.toma + ':' + (f.querySelector('.etiqueta-vista') || {}).textContent)
        .join(' ');
})()`);

(async () => {
    const sitio = await maqueta.levantar(4813);
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));
    await p.setViewport({ width: 1180, height: 900 });

    console.log('\n── Con una toma grabando\n');
    await p.goto(`${sitio.url}?e=toma-abierta`, { waitUntil: 'networkidle0' });
    await espera(900);
    let v = await mirar(p);
    console.log(`   la barra dice: «${v.de}» · puesta ${v.puesta}`);
    decir(/^toma \d+$/.test(v.de), 'habla de la toma que se está grabando');
    decir(/Poner la toma \d+ en/.test(v.dice), 'y los botones también lo dicen');
    const antesDeTeclear = await mirar(p);
    await p.keyboard.press('s');
    await espera(500);
    v = await mirar(p);
    decir(v.puesta === 'S' && antesDeTeclear.puesta !== 'S', `la tecla la cambió a ${v.puesta}`);

    console.log('\n── Sin ninguna toma abierta\n');
    await p.goto(`${sitio.url}?e=en-vivo`, { waitUntil: 'networkidle0' });
    await espera(900);
    const tomasAntes = await vistasDeLasTomas(p);
    v = await mirar(p);
    console.log(`   la barra dice: «${v.de}» · puesta ${v.puesta}`);
    decir(v.de === 'la que viene', 'habla de la toma que todavía no empezó');
    decir(/La toma que viene empieza en/.test(v.dice), 'y los botones también');

    console.log('\n   apretando «M» (Multi)…');
    await p.keyboard.press('m');
    await espera(500);
    v = await mirar(p);
    decir(v.puesta === 'MG', `la barra quedó en ${v.puesta}`);
    decir(await vistasDeLasTomas(p) === tomasAntes,
        'y NINGUNA toma hecha cambió de vista: era lo que pasaba antes');

    console.log('\n── Desplegando una toma hecha, que es el camino para corregirla\n');
    await p.click('#lista-vivo [data-hace="plegar"][data-toma="4"]');
    await espera(500);
    v = await mirar(p);
    console.log(`   la barra dice: «${v.de}» · puesta ${v.puesta}`);
    decir(v.de === 'toma 4', 'ahora habla de la que se desplegó');
    await p.keyboard.press('r');
    await espera(500);
    const ahora = await vistasDeLasTomas(p);
    decir(/4:R/.test(ahora), `la toma 4 quedó en R (${ahora})`);

    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    await nave.close();
    process.exit(mal ? 1 : 0);
})();
