#!/usr/bin/env node
'use strict';
/**
 * Mide todos los botones, a mano y a cada ancho.
 *
 * Hermano de `auditar.js`, pero pregunta otra cosa: ese pregunta si algo se
 * LEE, éste si algo se ROMPE. Existe porque «a ojo» no alcanza: un botón que
 * quedó en 79 px con una etiqueta de 102 px se ve como un botón, solo que con
 * el texto pintado afuera de su caja.
 *
 *   node tools/medir-botones.js
 *   node tools/medir-botones.js --escenario en-vivo --ancho 900
 *
 * Dos precisiones que sin ellas el número miente:
 *
 *   · **`scrollWidth` NO sirve de criterio.** Los botones son `inline-flex`
 *     con `justify-content: center`, así que el texto que no entra se sale por
 *     los DOS lados y `scrollWidth` solo cuenta el de la derecha. El criterio
 *     es `max-content` contra el ancho real, y el `max-content` no se estima:
 *     se clona el botón como hermano suyo —así los selectores por descendencia
 *     siguen aplicando— y se lo mide.
 *
 *   · **Lo que recorta con ellipsis NO chorrea.** Un nombre largo con
 *     `text-overflow: ellipsis` pide más de lo que tiene y eso está bien: es
 *     un nombre recortado, no texto encima del vecino. Para separarlos, al
 *     clonar se le congela el ancho a todo descendiente que recorte.
 */

const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function arg(nombre, def) {
    const i = process.argv.indexOf(`--${nombre}`);
    return i === -1 ? def : process.argv[i + 1];
}

const ESCENARIOS = arg('escenario', null) ? [arg('escenario')] : [
    'sin-carpeta', 'sesiones', 'preparar', 'preparar-sin-audio', 'sin-whisper',
    'preparar-microfono', 'preparar-zoom-falso', 'sin-zoom',
    'en-vivo', 'toma-abierta', 'palmada-vencida', 'terminada', 'notas-de-antes', 'foto', 'prproj', 'prproj-listo', 'ajustes', 'diagnostico'
];
const ANCHOS = arg('ancho', null) ? [Number(arg('ancho'))] : [900, 1180, 1440];
const ALTO = Number(arg('alto', 840));

/** Cuánto se le perdona a un botón antes de llamarlo desbordado. */
const MARGEN_PX = 1;

async function medir(pagina) {
    return pagina.evaluate((MARGEN) => {
        const visible = el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };

        const desbordados = [];
        const botones = [...document.querySelectorAll('button, .btn, .pastilla, kbd')]
            .filter(visible);

        for (const el of botones) {
            const r = el.getBoundingClientRect();

            // El clon va de hermano para que los selectores por descendencia y
            // por hijo sigan aplicando: medido fuera del árbol, un `.btn`
            // adentro de `.topbar` perdería el padding que le da esa regla.
            const clon = el.cloneNode(true);
            clon.style.width = 'max-content';
            clon.style.maxWidth = 'none';
            clon.style.position = 'absolute';
            clon.style.visibility = 'hidden';
            clon.style.left = '-9999px';
            // Lo que recorta con ellipsis se congela: pide más de lo que tiene
            // a propósito, y eso no es un desborde.
            for (const hijo of [el, ...el.querySelectorAll('*')]) {
                const cs = getComputedStyle(hijo);
                if (cs.textOverflow !== 'ellipsis') continue;
                const igual = hijo === el
                    ? clon
                    : clon.querySelectorAll('*')[[...el.querySelectorAll('*')].indexOf(hijo)];
                if (igual) igual.style.width = `${hijo.getBoundingClientRect().width}px`;
            }
            el.parentElement.appendChild(clon);
            const necesita = clon.getBoundingClientRect().width;
            clon.remove();

            if (necesita > r.width + MARGEN) {
                desbordados.push({
                    texto: (el.textContent || '').trim().slice(0, 30) || el.className,
                    clase: el.className || el.tagName,
                    tiene: Math.round(r.width),
                    necesita: Math.round(necesita)
                });
            }
        }

        /* ── Solapes entre hermanos de una misma fila flex ─────────────── */
        const solapes = [];
        for (const fila of document.querySelectorAll('.fila, .tarjeta-cabeza, .topbar, .barra-sesion, .campo-fila, .pie-teclas, .check-arreglo')) {
            const hijos = [...fila.children].filter(visible);
            for (let i = 0; i < hijos.length; i++) {
                for (let j = i + 1; j < hijos.length; j++) {
                    const a = hijos[i].getBoundingClientRect();
                    const b = hijos[j].getBoundingClientRect();
                    const cruzaX = a.left < b.right - MARGEN && b.left < a.right - MARGEN;
                    const cruzaY = a.top < b.bottom - MARGEN && b.top < a.bottom - MARGEN;
                    if (cruzaX && cruzaY) {
                        solapes.push({
                            a: (hijos[i].textContent || hijos[i].className).trim().slice(0, 20),
                            b: (hijos[j].textContent || hijos[j].className).trim().slice(0, 20)
                        });
                    }
                }
            }
        }

        return {
            botones: botones.length,
            desbordados,
            solapes,
            // El documento no puede tener scroll horizontal: si lo tiene, hay
            // algo más ancho que la ventana y la app se lee corrida.
            desbordeH: document.documentElement.scrollWidth > window.innerWidth
        };
    }, MARGEN_PX);
}

async function main() {
    const sitio = await maqueta.levantar(Number(arg('puerto', 4613)));
    const navegador = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--force-device-scale-factor=1']
    });

    let mirados = 0;
    let fallos = 0;
    try {
        for (const escenario of ESCENARIOS) {
            for (const ancho of ANCHOS) {
                const pagina = await navegador.newPage();
                await pagina.setViewport({ width: ancho, height: ALTO });
                await pagina.goto(`${sitio.url}?e=${escenario}`, { waitUntil: 'networkidle0' });
                await new Promise(r => setTimeout(r, 700));

                const m = await medir(pagina);
                await pagina.close();
                mirados += m.botones;

                const mal = m.desbordados.length || m.solapes.length || m.desbordeH;
                if (mal) fallos++;
                console.log(`${mal ? '✗' : '·'} ${escenario} @ ${ancho} — ${m.botones} cajas` +
                    `${m.desbordados.length ? `, ${m.desbordados.length} con el texto afuera` : ''}` +
                    `${m.solapes.length ? `, ${m.solapes.length} solapes` : ''}` +
                    `${m.desbordeH ? ', la página se sale de ancho' : ''}`);
                for (const d of m.desbordados.slice(0, 8)) {
                    console.log(`    «${d.texto}» tiene ${d.tiene} px y necesita ${d.necesita}`);
                }
                for (const s of m.solapes.slice(0, 8)) {
                    console.log(`    «${s.a}» encima de «${s.b}»`);
                }
            }
        }
    } finally {
        await navegador.close();
        await sitio.bajar();
    }

    console.log(`\n${mirados} cajas medidas · ${fallos} vista(s) con problemas`);
    if (fallos) process.exit(1);
}

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
