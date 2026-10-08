'use strict';
/**
 * El doble clic que corrige un comentario, contra la maqueta.
 *
 * La maqueta no tiene motor: `grabarEditar` lo contesta `doble.js`. Lo que se
 * comprueba acá es la mitad de la ventana —que el doble clic abra el campo con
 * lo que ya decía, que Escape lo deje como estaba y que Enter mande el cambio
 * que corresponde—, que es la mitad que las pruebas de texto no pueden ver.
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

/**
 * Un doble clic de verdad sobre un elemento.
 *
 * `click({ clickCount: 2 })` NO sirve: manda un solo apretar-soltar con el
 * contador en dos, y el navegador no saca ningún `dblclick` de eso. Hacen
 * falta las dos pulsaciones, la segunda contando dos.
 *
 * Y antes hay que traerlo a la pantalla a mano: los comentarios están abajo
 * del todo, `boundingBox` da la posición tal cual —fuera de la ventana— y el
 * clic terminaba cayendo en cualquier otra cosa.
 */
/** Dejar el campo vacío, sin depender de que el atajo de seleccionar todo ande. */
function vaciar(pagina) {
    return pagina.evaluate(`(() => {
        const el = document.querySelector('[data-campo="comentario-editado"]');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
}

async function dobleClic(pagina, elemento) {
    await elemento.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await espera(150);
    const caja = await elemento.boundingBox();
    const x = caja.x + caja.width * 0.4;
    const y = caja.y + caja.height / 2;
    await pagina.mouse.move(x, y);
    await pagina.mouse.down({ clickCount: 1 });
    await pagina.mouse.up({ clickCount: 1 });
    await pagina.mouse.down({ clickCount: 2 });
    await pagina.mouse.up({ clickCount: 2 });
    await espera(300);
}

(async () => {
    const sitio = await maqueta.levantar(4807);
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));
    await p.setViewport({ width: 1180, height: 900 });
    await p.goto(`${sitio.url}?e=en-vivo,desplegada`, { waitUntil: 'networkidle0' });
    await espera(900);

    // Lo que la ventana le manda al motor, interceptado antes de que se pierda.
    await p.evaluate(`(() => {
        window.MANDADO = [];
        const antes = window.nt.grabarEditar;
        window.nt.grabarEditar = c => { window.MANDADO.push(c); return antes(c); };
    })()`);

    const filas = await p.$$('.comentario');
    decir(filas.length === 2, `los dos comentarios de la toma 1 están (${filas.length})`);
    if (filas.length < 2) { await nave.close(); process.exit(1); }

    const dice = i => p.evaluate(`document.querySelectorAll('.comentario')[${i}]
        .querySelector('.comentario-dicho').textContent.trim()`);
    console.log(`\n   el segundo dice: "${await dice(1)}"`);

    console.log('\nhaciendo doble clic en el segundo comentario…');
    await dobleClic(p, filas[1]);
    const campo = await p.$('[data-campo="comentario-editado"]');
    decir(Boolean(campo), 'se abrió el campo');
    if (!campo) { await nave.close(); process.exit(1); }
    decir(await p.evaluate(`document.querySelector('[data-campo="comentario-editado"]').value`)
        === 'Revisar si esto aporta', 'y viene con lo que ya decía, no vacío');
    decir(await p.evaluate(`document.activeElement.dataset.campo === 'comentario-editado'`),
        'y con el foco puesto: se puede escribir sin tocar nada más');
    decir(await p.evaluate(`document.querySelectorAll('.comentario')[0]
        .querySelector('.comentario-dicho') !== null`), 'el otro comentario sigue como estaba');
    decir(await p.evaluate(`document.querySelectorAll('[data-campo="comentario-editado"]').length`) === 1,
        'y hay un solo campo abierto');

    console.log('\napretando Escape…');
    await p.keyboard.press('Escape');
    await espera(300);
    decir(!(await p.$('[data-campo="comentario-editado"]')), 'el campo se cerró');
    decir(await dice(1) === 'Revisar si esto aporta', 'y el comentario quedó como estaba');
    decir((await p.evaluate('window.MANDADO.length')) === 0, 'sin mandarle nada al motor');

    console.log('\ndoble clic otra vez, borrar y escribir, y Enter…');
    await dobleClic(p, (await p.$$('.comentario'))[1]);
    await vaciar(p);
    await p.keyboard.type('No aporta: cortar');
    await p.keyboard.press('Enter');
    await espera(400);
    const mandado = await p.evaluate('window.MANDADO');
    decir(mandado.length === 1, `se mandó un cambio y uno solo (${mandado.length})`);
    if (mandado.length) {
        const c = mandado[0];
        console.log(`   ${JSON.stringify(c)}`);
        decir(c.tipo === 'editar-comentario', 'del tipo que corresponde');
        decir(c.toma === 1 && c.indice === 1, 'con la toma y el índice del renglón');
        decir(c.comentario === 'No aporta: cortar', 'y el texto nuevo');
    }
    decir(!(await p.$('[data-campo="comentario-editado"]')), 'y el campo se cerró al guardar');

    console.log('\nvacío no se guarda…');
    await dobleClic(p, (await p.$$('.comentario'))[0]);
    await vaciar(p);
    await p.keyboard.press('Enter');
    await espera(400);
    decir((await p.evaluate('window.MANDADO.length')) === 1, 'no se mandó nada nuevo');
    decir(Boolean(await p.$('[data-campo="comentario-editado"]')), 'y el campo sigue abierto');

    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    await nave.close();
    process.exit(mal ? 1 : 0);
})();
