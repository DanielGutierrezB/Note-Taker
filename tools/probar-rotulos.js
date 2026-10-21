'use strict';
/**
 * Que los rótulos de la barra —idioma y cámara— agarren el clic de una persona,
 * contra la maqueta.
 *
 * Lo que se comprueba es lo que las pruebas de la suite no pueden, porque no
 * tienen navegador: la barra de la clase se repinta cada 150 ms, y si el rótulo
 * se rehace entre que se aprieta y se suelta, el navegador no da el clic por
 * hecho. Con los rótulos rehaciéndose en cada vuelta, un clic de persona
 * (apretar, 180 ms, soltar) agarraba 0 de 15 veces, y quien lo usaba creía que
 * había que darle a un punto exacto. Por eso cada clic acá es lento y cae en
 * tres sitios del rótulo: el icono, la palabra y el borde.
 *
 * Y el menú de cámaras con la lista tardando, que se ubicaba contra un rótulo
 * que ya no estaba en la página y aparecía en la esquina.
 *
 *   node tools/probar-rotulos.js
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

const menuAbierto = p => p.evaluate(() => !document.getElementById('menu-barra').hidden);

/** Cuántas veces se cambia el botón por otro en un segundo sin tocar nada. */
const reemplazosEnUnSegundo = (p, id) => p.evaluate(async id => {
    let n = 0;
    let antes = document.getElementById(id);
    const fin = Date.now() + 1000;
    while (Date.now() < fin) {
        await new Promise(r => setTimeout(r, 10));
        const ahora = document.getElementById(id);
        if (ahora !== antes) { n += 1; antes = ahora; }
    }
    return n;
}, id);

/** El centro de una pieza del rótulo, o su borde derecho. */
const puntoDe = (p, id, donde) => p.evaluate((id, donde) => {
    const b = document.getElementById(id);
    const pieza = donde === 'icono' ? b.querySelector('.hp-ico')
        : donde === 'palabra' ? [...b.querySelectorAll('span:not(.hp-ico)')]
            .find(s => getComputedStyle(s).display !== 'none')
            : b;
    const r = pieza.getBoundingClientRect();
    return donde === 'borde'
        ? { x: r.right - 4, y: r.top + r.height / 2 }
        : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id, donde);

/** Un clic como el de una persona: ni instantáneo ni en el centro exacto. */
async function clicLento(p, punto) {
    await p.mouse.move(punto.x, punto.y);
    await p.mouse.down();
    await espera(180);
    await p.mouse.up();
    await espera(250);
}

(async () => {
    const sitio = await maqueta.levantar(4817);
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));
    await p.setViewport({ width: 1440, height: 820 });

    for (const [escenario, id] of [
        ['en-vivo', 'vivo-idioma'], ['en-vivo', 'vivo-camara'], ['semanal-grabando', 'semanal-idioma']
    ]) {
        console.log(`\n── ${id}\n`);
        await p.goto(`${sitio.url}?e=${escenario}`, { waitUntil: 'networkidle0' });
        await p.evaluate(() => window.maquetaPuesta);

        const n = await reemplazosEnUnSegundo(p, id);
        decir(n === 0, `quieto mientras no cambia nada (${n} reemplazos en 1 s)`);

        for (const donde of ['icono', 'palabra', 'borde']) {
            const punto = await puntoDe(p, id, donde);
            let abrio = 0;
            for (let i = 0; i < 5; i += 1) {
                await clicLento(p, punto);
                if (await menuAbierto(p)) abrio += 1;
                await p.keyboard.press('Escape');
                await espera(100);
            }
            decir(abrio === 5, `un clic lento sobre ${donde === 'borde' ? 'el borde' : `${donde === 'icono' ? 'el icono' : 'la palabra'}`} abre el menú (${abrio}/5)`);
        }

        // Abierto, apretarlo otra vez sobre el icono lo cierra: comparando el
        // objetivo exacto con el botón, el icono contaba como «afuera» y el
        // menú se cerraba y se volvía a abrir en el mismo clic.
        const icono = await puntoDe(p, id, 'icono');
        await clicLento(p, icono);
        await clicLento(p, icono);
        decir(!(await menuAbierto(p)), 'abierto, otro clic sobre el icono lo cierra');
        await p.keyboard.press('Escape');
    }

    console.log('\n── Cambiar el idioma deja el mismo botón diciendo otra cosa\n');
    await p.goto(`${sitio.url}?e=en-vivo`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    await p.evaluate(() => {
        window.antes = document.getElementById('vivo-idioma');
        window.nt.preguntar = async () => 'desde-aca';
    });
    await p.click('#vivo-idioma');
    await espera(300);
    await p.evaluate(() => [...document.querySelectorAll('#menu-barra .menu-fila')]
        .find(b => /Inglés/.test(b.textContent)).click());
    await espera(500);
    const cambio = await p.evaluate(() => ({
        mismo: document.getElementById('vivo-idioma') === window.antes,
        dice: document.getElementById('vivo-idioma').getAttribute('aria-label')
    }));
    decir(cambio.dice === 'Idioma: EN', `dice el idioma nuevo («${cambio.dice}»)`);
    decir(cambio.mismo, 'y es el mismo botón, no uno nuevo');

    console.log('\n── El vídeo semanal\n');
    await p.goto(`${sitio.url}?e=semanal-grabando`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    // Lo que oye cambia sin que cambie ninguna toma: el rótulo tiene que
    // enterarse con el reloj. (Que sea con el reloj y no con la tarjeta lo
    // cuida la suite: en la maqueta la tarjeta se rehace sola cada tanto, y
    // acá no se distinguiría una cosa de la otra.)
    await p.evaluate(() => {
        const real = window.nt.grabarEstado;
        window.nt.grabarEstado = async () => ({ ...(await real()), idioma: 'es', idiomaOido: 'en' });
    });
    await espera(1600);
    const semanal = await p.evaluate(() => ({
        dice: document.getElementById('semanal-idioma').getAttribute('aria-label'),
        avisa: document.getElementById('semanal-idioma').getAttribute('data-avisa')
    }));
    decir(semanal.dice === 'Idioma: ES' && semanal.avisa === 'si',
        `en ámbar al oír otro idioma («${semanal.dice}», ámbar: ${semanal.avisa})`);

    // Con el menú abierto, una letra de vista le cambiaba la vista a una toma.
    await p.evaluate(() => {
        window.pedidos = [];
        const real = window.nt.grabarEditar;
        window.nt.grabarEditar = (...a) => { window.pedidos.push(a[0] && a[0].tipo); return real(...a); };
    });
    await p.click('#semanal-idioma');
    await espera(300);
    for (const k of ['p', 's', 'k', 'z']) { await p.keyboard.press(k); await espera(120); }
    const escapadas = await p.evaluate(() => window.pedidos);
    decir(!escapadas.length, `con el menú abierto las letras no tocan las tomas (${JSON.stringify(escapadas)})`);
    await p.keyboard.press('Escape');

    console.log('\n── El menú de cámaras con la lista tardando\n');
    await p.goto(`${sitio.url}?e=en-vivo`, { waitUntil: 'networkidle0' });
    await p.evaluate(() => window.maquetaPuesta);
    await p.evaluate(() => {
        const enumerar = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
        navigator.mediaDevices.enumerateDevices = async () => {
            await new Promise(r => setTimeout(r, 400));
            return enumerar();
        };
    });
    await p.click('#vivo-camara');
    await espera(900);
    const lugar = await p.evaluate(() => {
        const m = document.getElementById('menu-barra').getBoundingClientRect();
        const b = document.getElementById('vivo-camara').getBoundingClientRect();
        return { x: Math.round(m.left), y: Math.round(m.top), rx: Math.round(b.left), abajo: Math.round(b.bottom) };
    });
    decir(await menuAbierto(p), 'se abre');
    decir(Math.abs(lugar.x - lugar.rx) < 4 && Math.abs(lugar.y - lugar.abajo - 4) < 4,
        `debajo del rótulo y no en la esquina (menú en ${lugar.x},${lugar.y}; rótulo en ${lugar.rx},${lugar.abajo})`);

    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    await nave.close();
    await sitio.bajar();
    process.exit(mal ? 1 : 0);
})();
