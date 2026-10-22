'use strict';
/**
 * Partir tomas en el vídeo de la semana, contra la maqueta.
 *
 * Lo que se comprueba es lo que pidió el editor, en los tres sitios donde pasa:
 *
 *   · en el editor, «Dividir acá» parte la toma donde está la aguja, en una
 *     palabra y no a mitad de una;
 *   · también en el editor, el clic derecho sobre una palabra ofrece «Dividir
 *     la toma acá», como en la clase;
 *   · grabando, cambiar de vista con una toma abierta le pide al motor que la
 *     parta DESDE AHORA, y no que le cambie la vista entera.
 *
 * Y que «Profesor Preview» se vea como algo que se enciende: azul teñido
 * apagado, y lleno encendido.
 *
 * Lo que el motor hace con cada pedido lo prueba la suite
 * (`tests/dividir-toma.test.js`); acá se mira que la pantalla pida lo que tiene
 * que pedir, con la hora que tiene que pedir.
 *
 *   node tools/probar-semanal-dividir.js
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

/** Todo lo que la pantalla le pida al motor por esa puerta queda anotado. */
const espiar = (p, puerta) => p.evaluate(puerta => {
    window.pedidos = [];
    const real = window.nt[puerta];
    window.nt[puerta] = (...a) => { window.pedidos.push(a[a.length - 1]); return real(...a); };
}, puerta);
const pedidos = p => p.evaluate(() => window.pedidos);

(async () => {
    const sitio = await maqueta.levantar(4821);
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));
    await p.setViewport({ width: 1440, height: 900 });

    console.log('\n── En el editor: «Dividir acá» en la aguja\n');
    await p.goto(`${sitio.url}?e=semanal-revisar`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    await espera(800);
    const boton = await p.$('[data-hace="dividir-aca"]');
    decir(Boolean(boton), 'el botón está en la barra del montaje');
    decir(boton && !(await p.evaluate(b => b.disabled, boton)), 'y se puede apretar');
    // Las palabras de la toma que se está mirando, para saber qué hora tiene
    // que pedir: una de ellas, nunca una cualquiera.
    const deLaToma = await p.evaluate(() => [...document.querySelectorAll('#semanal-cuerpo [data-texto="cerrada"] [data-t]')]
        .map(w => Number(w.dataset.t)));
    await espiar(p, 'grabarEditarGrabada');
    await p.click('[data-hace="dividir-aca"]');
    await espera(600);
    let pedido = (await pedidos(p))[0] || {};
    decir(pedido.tipo === 'dividir', `le pide al motor dividir (${JSON.stringify(pedido)})`);
    decir(deLaToma.includes(pedido.paredMs) && pedido.paredMs !== deLaToma[0],
        'en una palabra de la toma, que no es la primera: no corta ninguna por la mitad');

    console.log('\n── En el editor: el clic derecho sobre una palabra\n');
    await p.goto(`${sitio.url}?e=semanal-revisar`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    await espera(800);
    const palabra = await p.evaluate(() => {
        const ws = [...document.querySelectorAll('#semanal-cuerpo [data-texto="cerrada"] [data-t]')];
        const w = ws[Math.floor(ws.length / 2)];
        w.scrollIntoView({ block: 'center' });
        const r = w.getBoundingClientRect();
        return { t: Number(w.dataset.t), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await p.mouse.click(palabra.x, palabra.y, { button: 'right' });
    await espera(300);
    const opciones = await p.evaluate(() => [...document.querySelectorAll('#menu-palabra .menu-fila')]
        .map(b => b.textContent.trim()));
    decir(opciones.includes('Dividir la toma acá'), `el menú lo ofrece (${opciones.join(' · ')})`);
    await espiar(p, 'grabarEditarGrabada');
    await p.evaluate(() => [...document.querySelectorAll('#menu-palabra .menu-fila')]
        .find(b => /Dividir/.test(b.textContent)).click());
    await espera(600);
    pedido = (await pedidos(p))[0] || {};
    decir(pedido.tipo === 'dividir' && pedido.paredMs === palabra.t,
        `y parte justo en esa palabra (${JSON.stringify(pedido)})`);

    console.log('\n── Grabando: cambiar de vista con una toma abierta\n');
    await p.goto(`${sitio.url}?e=semanal-grabando`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    await espera(500);
    // Con el botón y no con el mouse: en la maqueta la tarjeta queda más abajo
    // de lo que entra en la ventana, y lo que se mira es qué se le pide al motor.
    const apretar = sel => p.evaluate(s => document.querySelector(s).click(), sel);
    await apretar('#vista-semanal [data-hace="borde"]');
    await espera(500);
    // Todo dentro de `#vista-semanal`: la pantalla de clase también tiene sus
    // botones de vista en el documento, escondidos, y con un selector suelto
    // el clic le pedía el cambio a la pantalla que no se está mirando.
    const abierta = await p.evaluate(() => document.querySelectorAll('#vista-semanal [data-texto="abierta"]').length);
    decir(abierta > 0, 'hay una toma abierta');
    const otra = await p.evaluate(() => {
        const b = [...document.querySelectorAll('#vista-semanal [data-hace="vista"]')]
            .find(x => x.getAttribute('aria-pressed') !== 'true');
        return b ? b.dataset.vista : null;
    });
    await espiar(p, 'grabarEditar');
    await apretar(`#vista-semanal [data-hace="vista"][data-vista="${otra}"]`);
    await espera(400);
    const todos = await pedidos(p);
    pedido = todos.find(x => x && x.tipo === 'vista-desde-ahora') || {};
    decir(pedido.vista === otra, `pide cambiar desde ahora (${JSON.stringify(todos)})`);
    decir(!todos.some(x => x && x.tipo === 'vista' && x.vista === otra),
        'y no le cambia la vista a la toma entera');

    console.log('\n── «Profesor Preview»\n');
    const color = () => p.evaluate(() => {
        const b = document.querySelector('#vista-semanal [data-hace="mirilla"]');
        const c = getComputedStyle(b);
        return { pressed: b.getAttribute('aria-pressed'), texto: c.color, fondo: c.backgroundColor };
    });
    const apagado = await color();
    decir(apagado.texto === 'rgb(122, 180, 255)' && /0\.16\)$/.test(apagado.fondo),
        `apagado, azul teñido (texto ${apagado.texto}, fondo ${apagado.fondo})`);
    await apretar('#vista-semanal [data-hace="mirilla"]');
    await espera(400);
    const encendido = await color();
    decir(encendido.pressed === 'true' && encendido.fondo === 'rgb(122, 180, 255)',
        `encendido, azul lleno (fondo ${encendido.fondo})`);

    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    await nave.close();
    await sitio.bajar();
    process.exit(mal ? 1 : 0);
})();
