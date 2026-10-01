#!/usr/bin/env node
'use strict';
/**
 * Audita la interfaz con números, no con adjetivos.
 *
 * Hermano de `medir-botones.js`, pero mide otra cosa: ese pregunta si algo se
 * ROMPE (desborde, solape); éste pregunta si algo se LEE. Son las medidas que
 * hacen falta para defender —o para tirar a la basura— una decisión de diseño:
 *
 *   · inventario: cuántos tamaños de letra, cuántos pesos y cuántos colores de
 *     texto hay pintados a la vez. Es la entropía del sistema, y es lo que
 *     decide si la jerarquía se lee o si compite consigo misma.
 *   · contraste REAL de cada texto visible contra el fondo que tiene detrás,
 *     con la cadena de `opacity` compuesta — que es lo que el ojo ve y lo que
 *     WCAG mide, no el color declarado en el CSS.
 *   · alto de las filas que se repiten (tomas, claquetas, sesiones).
 *   · el presupuesto vertical: cuánto de la ventana se va en cromo fijo antes
 *     de que empiece el contenido.
 *   · blancos de clic por debajo de 24×24 CSS px (WCAG 2.2 SC 2.5.8).
 *
 * Corre sobre la maqueta, que es el HTML y el CSS de verdad, y se la levanta
 * sola: pedirle a quien mide que antes arranque un servidor a mano es la
 * manera de que un día alguien mida contra el CSS de ayer.
 *
 *   node tools/auditar.js
 *   node tools/auditar.js --escenario en-vivo --ancho 900
 *
 * Usa el Chrome del sistema por CDP con `puppeteer-core` (no baja ningún
 * navegador). NT_CHROME cambia la ruta.
 */

const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function arg(nombre, def) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i === -1 ? def : process.argv[i + 1];
}

const ALTO = Number(arg('alto', 840));

/** Los escenarios que se auditan, y a qué anchos. */
const ESCENARIOS = arg('escenario', null)
    ? [arg('escenario')]
    : ['sesiones', 'preparar', 'en-vivo', 'toma-abierta', 'palmada', 'palmada-vencida', 'terminada', 'notas-de-antes', 'diagnostico'];
const ANCHOS = arg('ancho', null) ? [Number(arg('ancho'))] : [900, 1180, 1440];

/**
 * Los criterios de aceptación, escritos como números y no como intenciones.
 * Lo que no los cumple sale con código 1: es un fallo, no una opinión.
 */
const VARA = {
    bajoAA: 0,
    /**
     * Los tamaños que existen, en lugar de cuántos.
     *
     * Contar era más fácil de escribir y peor de leer: «6 tamaños» no dice
     * cuál sobra, y sobre todo no distingue un sexto tamaño legítimo de un
     * `kbd` que se quedó en 10 px. La lista es el sistema: 13/12/11 son las
     * tres voces; 32 es el ÚNICO elemento grande de la app —el timecode, lo que
     * se lee sin acercarse mientras el profesor habla— y 18 el escalón de los
     * números que se consultan: el estado de la sesión, cuántas tomas, cuántas
     * claquetas, cuánto dura la clase cortada (NN/g: «Limit how many elements
     * are big to a maximum of 2»).
     */
    tamanos: [32, 18, 13, 12, 11],
    chicos: 0,
    // La fila que se repite veinte veces en una clase. La de claqueta va en la
    // misma lista y mide lo mismo: tiene su propio renglón en el informe para
    // que se vea cuál de las dos se pasó.
    filaAlta: 32.9,
    filaClaquetaAlta: 32.9,
    cromo: 0.20
};

async function medir(pagina) {
    return pagina.evaluate(() => {
        const visible = el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };

        /* ── El contraste real, con la opacidad compuesta ──────────────── */
        const aRgb = s => {
            const m = String(s).match(/[\d.]+/g);
            return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null;
        };
        const mezclar = (frente, fondo) => ({
            r: frente.r * frente.a + fondo.r * (1 - frente.a),
            g: frente.g * frente.a + fondo.g * (1 - frente.a),
            b: frente.b * frente.a + fondo.b * (1 - frente.a),
            a: 1
        });
        const lum = c => {
            const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const ratio = (a, b) => {
            const l1 = lum(a);
            const l2 = lum(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };

        /** El fondo que este elemento tiene DETRÁS, subiendo hasta encontrar uno opaco. */
        const fondoDe = el => {
            let n = el;
            let acumulado = null;
            while (n && n !== document.documentElement) {
                const c = aRgb(getComputedStyle(n).backgroundColor);
                if (c && c.a > 0) {
                    acumulado = acumulado ? mezclar(acumulado, c) : c;
                    if (acumulado.a >= 1 || c.a >= 1) return acumulado;
                }
                n = n.parentElement;
            }
            return acumulado || { r: 15, g: 17, b: 21, a: 1 };
        };

        /** La opacidad compuesta de la cadena: es lo que el ojo ve. */
        const opacidadDe = el => {
            let n = el;
            let o = 1;
            while (n && n !== document.documentElement) {
                o *= Number(getComputedStyle(n).opacity);
                n = n.parentElement;
            }
            return o;
        };

        const textos = [];
        const tamanos = new Set();
        const pesos = new Set();
        const colores = new Set();
        const bajoAA = [];

        for (const el of document.querySelectorAll('*')) {
            if (!visible(el)) continue;
            // Solo los que pintan texto propio, no los contenedores.
            const propio = [...el.childNodes]
                .filter(n => n.nodeType === 3 && n.textContent.trim()).length > 0;
            if (!propio) continue;

            const cs = getComputedStyle(el);
            const size = parseFloat(cs.fontSize);
            const peso = Number(cs.fontWeight);
            const color = aRgb(cs.color);
            if (!color) continue;

            const op = opacidadDe(el);
            const frente = mezclar({ ...color, a: color.a * op }, fondoDe(el));
            const r = ratio(frente, fondoDe(el));
            // El umbral de WCAG baja a 3:1 para texto grande: 18.66 px en
            // negrita o 24 px normal.
            const grande = size >= 24 || (size >= 18.66 && peso >= 700);
            const minimo = grande ? 3 : 4.5;

            tamanos.add(Math.round(size * 10) / 10);
            pesos.add(peso);
            colores.add(cs.color);
            const info = {
                texto: el.textContent.trim().slice(0, 40),
                clase: el.className || el.tagName,
                size, peso, ratio: Math.round(r * 100) / 100, minimo
            };
            textos.push(info);
            if (r < minimo) bajoAA.push(info);
        }

        /* ── Blancos de clic (SC 2.5.8) ────────────────────────────────── */
        const chicos = [];
        let clicables = 0;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, [data-hace]')) {
            if (!visible(el)) continue;
            clicables++;
            const r = el.getBoundingClientRect();
            if (r.width < 24 || r.height < 24) {
                chicos.push({
                    clase: el.className || el.tagName,
                    texto: (el.textContent || '').trim().slice(0, 24),
                    w: Math.round(r.width), h: Math.round(r.height)
                });
            }
        }

        /* ── Las filas que se repiten ──────────────────────────────────── */
        const altoDe = el => Math.round(el.getBoundingClientRect().height * 10) / 10;
        const filas = [...document.querySelectorAll('.fila:not(.fila-claqueta)')]
            .filter(visible).map(altoDe);
        const claquetas = [...document.querySelectorAll('.fila-claqueta')]
            .filter(visible).map(altoDe);

        /* ── El presupuesto vertical ───────────────────────────────────── */
        const alto = window.innerHeight;
        const fijo = ['.topbar', '.barra-sesion', '.pie-teclas']
            .map(s => document.querySelector(s))
            .filter(el => el && visible(el))
            .reduce((n, el) => n + el.getBoundingClientRect().height, 0);

        return {
            textos: textos.length,
            tamanos: [...tamanos].sort((a, b) => b - a),
            pesos: [...pesos].sort(),
            colores: colores.size,
            bajoAA,
            peorContraste: textos.length
                ? Math.min(...textos.map(x => x.ratio)) : null,
            clicables,
            chicos,
            filas: filas.length ? { cuantas: filas.length, alta: Math.max(...filas) } : null,
            claquetas: claquetas.length
                ? { cuantas: claquetas.length, alta: Math.max(...claquetas) } : null,
            cromo: Math.round(fijo),
            cromoPorciento: Math.round((fijo / alto) * 1000) / 10
        };
    });
}

async function main() {
    const sitio = await maqueta.levantar(Number(arg('puerto', 4611)));
    const navegador = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--force-device-scale-factor=1']
    });

    let fallos = 0;
    try {
        for (const escenario of ESCENARIOS) {
            for (const ancho of ANCHOS) {
                const pagina = await navegador.newPage();
                await pagina.setViewport({ width: ancho, height: ALTO });
                await pagina.goto(`${sitio.url}?e=${escenario}`, { waitUntil: 'networkidle0' });
                // La maqueta aplica el escenario después de que la app dibuja.
                await new Promise(r => setTimeout(r, 700));

                const m = await medir(pagina);
                await pagina.close();

                const mal = [];
                if (m.bajoAA.length > VARA.bajoAA) mal.push(`${m.bajoAA.length} textos bajo AA`);
                const sobran = m.tamanos.filter(x => !VARA.tamanos.includes(x));
                if (sobran.length) mal.push(`tamaños fuera del sistema: ${sobran.join('/')} px`);
                if (m.chicos.length > VARA.chicos) mal.push(`${m.chicos.length} controles chicos`);
                if (m.filas && m.filas.alta > VARA.filaAlta) mal.push(`fila de ${m.filas.alta} px`);
                if (m.claquetas && m.claquetas.alta > VARA.filaClaquetaAlta) {
                    mal.push(`claqueta de ${m.claquetas.alta} px`);
                }
                if (m.cromoPorciento / 100 > VARA.cromo) mal.push(`cromo ${m.cromoPorciento} %`);

                console.log(`\n${mal.length ? '✗' : '✓'} ${escenario} @ ${ancho}×${ALTO}`);
                console.log(`   textos ${m.textos} · tamaños ${m.tamanos.join('/')} ` +
                    `· pesos ${m.pesos.join('/')} · colores ${m.colores}`);
                console.log(`   peor contraste ${m.peorContraste}:1 · bajo AA ${m.bajoAA.length}`);
                console.log(`   clicables ${m.clicables} · bajo 24×24 ${m.chicos.length}`);
                if (m.filas) console.log(`   filas ${m.filas.cuantas} · la más alta ${m.filas.alta} px`);
                if (m.claquetas) console.log(`   claquetas ${m.claquetas.cuantas} · la más alta ${m.claquetas.alta} px`);
                console.log(`   cromo fijo ${m.cromo} px (${m.cromoPorciento} %)`);

                for (const x of m.bajoAA.slice(0, 6)) {
                    console.log(`     ↳ ${x.ratio}:1 «${x.texto}» (.${x.clase}, ${x.size}px/${x.peso})`);
                }
                for (const x of m.chicos.slice(0, 6)) {
                    console.log(`     ↳ ${x.w}×${x.h} «${x.texto}» (.${x.clase})`);
                }
                if (mal.length) { fallos++; console.log(`   → ${mal.join(' · ')}`); }
            }
        }
    } finally {
        await navegador.close();
        await sitio.bajar();
    }

    console.log(fallos ? `\n${fallos} vista(s) fuera de la vara.` : '\nTodo dentro de la vara.');
    if (fallos) process.exit(1);
}

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
