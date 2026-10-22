'use strict';
/**
 * La pantalla de grabar el vídeo de la semana, contra la maqueta.
 *
 * Lo que pidió el editor, medido en píxeles:
 *
 *   · arriba, Terminar en la esquina, al lado de deshacer y rehacer, ancho y rojo;
 *   · el micrófono con su nivel justo debajo del preview, de su mismo ancho;
 *   · Professor a la izquierda y Screen a la derecha, ocupando la fila de arriba
 *     de la rejilla; debajo, cambiar ventana a la izquierda y Profesor Preview a
 *     la derecha; y Abrir o Cerrar toma en el cuadrado de las dos filas;
 *   · con la toma abierta, el rojo de «esto sale en el vídeo», y el cuadrado en
 *     el mismo sitio abierta o cerrada.
 *
 *   node tools/probar-semanal-grabando.js
 */

const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const espera = ms => new Promise(r => setTimeout(r, ms));
const cerca = (a, b, tolerancia = 1.5) => Math.abs(a - b) <= tolerancia;
const ROJO = 'rgb(209, 54, 58)';

let mal = 0;
function decir(bien, texto) {
    console.log(`   ${bien ? '✓' : '✗'} ${texto}`);
    if (!bien) mal += 1;
}

const medir = p => p.evaluate(() => {
    const raiz = document.querySelector('#vista-semanal');
    const caja = sel => {
        const n = raiz.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left, y: r.top, der: r.right, abajo: r.bottom, ancho: r.width, alto: r.height };
    };
    const color = sel => getComputedStyle(raiz.querySelector(sel)).backgroundColor;
    return {
        deshacer: caja('[data-hace="deshacer"]'),
        terminar: caja('[data-hace="terminar"]'),
        terminarColor: color('[data-hace="terminar"]'),
        preview: caja('.semanal-escena'),
        marco: getComputedStyle(raiz.querySelector('.semanal-escena')).outlineColor,
        micro: caja('.semanal-micro-vivo'),
        professor: caja('[data-hace="vista"][data-vista="PV"]'),
        screen: caja('[data-hace="vista"][data-vista="R"]'),
        ventana: caja('[data-hace="cambiar-pantalla"]'),
        profesor: caja('[data-hace="mirilla"]'),
        toma: caja('[data-hace="borde"]'),
        tomaColor: color('[data-hace="borde"]'),
        tomaDice: raiz.querySelector('[data-hace="borde"]').textContent.trim(),
        tarjeta: raiz.querySelector('.semanal-grabando').dataset.toma,
        alto: innerHeight,
        sale: document.documentElement.scrollWidth > innerWidth
    };
});

(async () => {
    const sitio = await maqueta.levantar(4829);
    const nave = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));

    for (const [ancho, alto] of [[900, 760], [1000, 690], [1180, 840], [1440, 900]]) {
        console.log(`\n── A ${ancho}×${alto}\n`);
        await p.setViewport({ width: ancho, height: alto });
        await p.goto(`${sitio.url}?e=semanal-grabando`, { waitUntil: 'networkidle0' });
        await p.evaluate(() => window.maquetaPuesta);
        await espera(400);
        const m = await medir(p);
        decir(cerca(m.terminar.y, m.deshacer.y, 8) && m.terminar.x > m.deshacer.der,
            'Terminar arriba, a la derecha de deshacer');
        decir(m.terminar.ancho >= 140 && m.terminarColor === ROJO, `ancho y rojo (${Math.round(m.terminar.ancho)} px)`);
        decir(m.micro.y > m.preview.abajo && cerca(m.micro.ancho, m.preview.ancho),
            'el micrófono debajo del preview, de su mismo ancho');
        decir(m.professor.x < m.screen.x, 'Professor a la izquierda, Screen a la derecha');
        decir(cerca(m.professor.x, m.ventana.x) && cerca(m.screen.der, m.profesor.der, 3),
            'y los dos ocupan la fila entera de arriba');
        decir(m.ventana.x < m.profesor.x && cerca(m.ventana.ancho, m.profesor.ancho),
            'abajo, cambiar ventana a la izquierda y Profesor Preview a la derecha, del mismo ancho');
        decir(cerca(m.toma.y, m.professor.y) && cerca(m.toma.abajo, m.ventana.abajo) && cerca(m.toma.ancho, m.toma.alto),
            `la toma, un cuadrado de las dos filas (${Math.round(m.toma.ancho)}×${Math.round(m.toma.alto)})`);
        decir(/Abrir toma/.test(m.tomaDice) && m.tomaColor !== ROJO && m.tarjeta === 'no', 'entre tomas, abrirla, y no en rojo');
        decir(m.toma.abajo <= m.alto, 'el botón de la toma se ve sin bajar');
        decir(!m.sale, 'nada se sale de la ventana');

        await p.evaluate(() => document.querySelector('#vista-semanal [data-hace="borde"]').click());
        await espera(600);
        const a = await medir(p);
        decir(/Cerrar toma/.test(a.tomaDice) && a.tomaColor === ROJO && a.tarjeta === 'abierta',
            'con la toma abierta, cerrarla, en rojo');
        decir(a.marco === 'rgb(229, 72, 77)', `y el marco del preview en rojo (${a.marco})`);
        decir(cerca(a.toma.y, m.toma.y) && cerca(a.toma.x, m.toma.x), 'el cuadrado no se movió al abrirla');
    }

    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    await nave.close();
    await sitio.bajar();
    process.exit(mal ? 1 : 0);
})();
