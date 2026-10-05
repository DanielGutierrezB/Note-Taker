#!/usr/bin/env node
'use strict';
/**
 * tools/probar-editor.js — El editor del corte final, apretado de verdad.
 *
 *   node tools/probar-editor.js
 *
 * Lo que la maqueta no puede contestar con una foto: que el montaje reproduzca,
 * que al terminar una toma salte a la siguiente y no a la de al lado, que
 * clicar un trozo de la línea cambie lo de abajo, y que «Ocultar desactivadas»
 * deje la línea con el corte final y nada más.
 *
 * Corre sobre la maqueta y con un MP4 de verdad servido por ella, que es lo que
 * hace que esto pruebe algo: los dos `<video>` cargan, buscan y corren.
 */

const path = require('path');
const puppeteer = require('puppeteer-core');
const maqueta = require('./maqueta/abrir');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Lo que se dice por el camino, y lo que estaba mal.
 *
 * Las dos cosas por la misma puerta, y las que empiezan con «✗» se cuentan: de
 * esto dependen las comprobaciones que NO se pueden hacer sin un navegador —que
 * clicar una toma no rebobine el vídeo, que lo de abajo siga al reproductor— y
 * un sondeo que las imprime pero sale con cero no las garantiza. Antes salía
 * con cero y por eso no servía de red.
 */
let mal = 0;
const decir = (...x) => {
    if (String(x[0] || '').startsWith('✗')) mal++;
    console.log('  ', ...x);
};
const espera = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const sitio = await maqueta.levantar(4733);
    const nav = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
    });
    const p = await nav.newPage();
    const malo = [];
    p.on('pageerror', e => malo.push(e.message));
    p.on('console', m => {
        if (m.type() === 'error' && !m.text().includes('favicon')) malo.push(m.text());
    });
    await p.setViewport({ width: 1180, height: 900 });
    await p.goto(`${sitio.url}?e=semanal-revisar`, { waitUntil: 'networkidle0' });
    await espera(1200);

    const js = x => p.evaluate(x);
    const mirar = () => js(`(() => {
        const v = [...document.querySelectorAll('.montaje video')];
        const puesto = document.querySelector('.linea-toma[aria-pressed="true"]');
        const aguja = document.querySelector('.linea-aguja:not([hidden])');
        return {
            tomaAbajo: (document.querySelector('.tarjeta-cabeza .v1') || {}).textContent,
            puesta: puesto ? Number(puesto.dataset.toma) : null,
            conAguja: aguja ? Number(aguja.closest('.linea-toma').dataset.toma) : null,
            reloj: (document.querySelector('#semanal-montado') || {}).textContent,
            boton: (document.querySelector('[data-hace="reproducir"]') || {}).textContent.trim(),
            trozos: [...document.querySelectorAll('.linea-toma')].map(b => ({
                toma: Number(b.dataset.toma), fuera: b.dataset.fuera
            })),
            videos: v.map(x => ({
                clase: x.className,
                visible: x.style.display !== 'none',
                listo: x.readyState,
                t: Math.round(x.currentTime * 100) / 100,
                corriendo: !x.paused,
                mudo: x.muted
            }))
        };
    })()`);

    console.log('\n── El editor del corte final\n');
    let e = await mirar();
    decir('arranca parado en la', e.tomaAbajo, '· la línea tiene',
        e.trozos.length, 'trozos:', e.trozos.map(t => `${t.toma}${t.fuera === 'si' ? ' (fuera)' : ''}`).join(', '));
    decir('los vídeos cargaron:', e.videos.map(v => `readyState ${v.listo}`).join(' · '));
    if (e.videos.some(v => v.listo < 1)) decir('✗ algún vídeo no cargó ni los metadatos');

    /* ── Reproducir ──────────────────────────────────────────────────── */
    decir('\napretando Reproducir…');
    await p.click('[data-hace="reproducir"]');
    await espera(1500);
    e = await mirar();
    decir('el botón dice', JSON.stringify(e.boton), '· el reloj va por', e.reloj);
    decir('corriendo:', e.videos.filter(v => v.corriendo).map(v => v.clase).join(' y ') || 'ninguno');
    decir('la aguja está en la toma', e.conAguja);
    if (e.boton !== 'Pausa') decir('✗ el botón no pasó a Pausa');
    if (!e.videos.some(v => v.corriendo && v.visible)) decir('✗ el vídeo que se ve no está corriendo');
    if (e.conAguja == null) decir('✗ la aguja no aparece en ninguna toma');
    const reloj1 = e.reloj;

    await espera(2000);
    e = await mirar();
    decir('dos segundos después el reloj va por', e.reloj);
    if (e.reloj === reloj1) decir('✗ el reloj no se movió: no está reproduciendo');

    /* ── El salto de toma ────────────────────────────────────────────── */
    // La toma 1 de la maqueta dura 56 s de sesión, pero el tramo del MP4 dura
    // lo que dure el archivo: lo que se mira es que el salto ocurra y que caiga
    // en una toma que va al vídeo, no en la descartada.
    decir('\nesperando el salto a la toma siguiente…');
    const desde = e.conAguja;
    let salto = null;
    for (let i = 0; i < 40; i++) {
        await espera(500);
        const x = await mirar();
        if (x.conAguja != null && x.conAguja !== desde) { salto = x; break; }
    }
    if (!salto) {
        decir('· no saltó en 20 s (el tramo de la toma es más largo que eso)');
    } else {
        decir('saltó de la toma', desde, 'a la', salto.conAguja, '· abajo dice', salto.tomaAbajo);
        const fuera = salto.trozos.find(t => t.toma === salto.conAguja);
        if (fuera && fuera.fuera === 'si') decir('✗ saltó a una toma que está FUERA del vídeo');
        if (!String(salto.tomaAbajo || '').includes(String(salto.conAguja))) {
            decir('✗ lo de abajo no siguió al reproductor');
        }
    }

    /* ── Pararse en una toma a mano ──────────────────────────────────── */
    decir('\nclicando el trozo de la toma 3…');
    await p.click('.linea-toma[data-toma="3"]');
    await espera(900);
    e = await mirar();
    decir('abajo:', e.tomaAbajo, '· marcada la', e.puesta, '· sigue corriendo:',
        e.videos.some(v => v.corriendo) ? 'sí' : 'no');
    if (e.puesta !== 3) decir('✗ no quedó marcada la 3');
    if (!String(e.tomaAbajo || '').includes('3')) decir('✗ abajo no apareció la toma 3');
    if (!e.videos.some(v => v.corriendo)) decir('✗ clicar una toma paró el vídeo');
    // La 3 de la maqueta no tiene pantalla grabada: tiene que salir con la
    // cámara, y el botón marcado tiene que ser el de la cámara.
    const vistas = await js(`[...document.querySelectorAll('.semanal-vistas button')]
        .map(b => ({ dice: b.textContent.trim(), puesta: b.getAttribute('aria-pressed') }))`);
    decir('la 3 sale con:', vistas.filter(v => v.puesta === 'true').map(v => v.dice).join(', ') || 'nada');
    const dice = await js(`(document.querySelector('.tarjeta-cuerpo .campo-fila .v3') || {}).textContent`);
    decir('y lo dice:', String(dice || '').replace(/\\s+/g, ' ').trim());

    /* ── Clicar una desactivada la reproduce sola ────────────────────── */
    decir('\nclicando la toma 2, que está fuera del vídeo…');
    await p.click('.linea-toma[data-toma="2"]');
    await espera(900);
    e = await mirar();
    decir('abajo:', e.tomaAbajo, '· corriendo:', e.videos.some(v => v.corriendo) ? 'sí' : 'no');
    const pastilla = await js(`(document.querySelector('.tarjeta-cabeza .pastilla') || {}).textContent`);
    decir('y la pastilla dice:', String(pastilla || '').trim());

    /* ── Cambiar la vista se ve en el acto ───────────────────────────── */
    decir('\ncambiando la vista de la toma 2 a «Yo»…');
    const antes = (await mirar()).videos.map(v => `${v.clase}:${v.visible ? 'se ve' : 'no'}`).join(' · ');
    await p.click('.semanal-vistas button[data-vista="PV"]');
    await espera(900);
    const ahora = (await mirar()).videos.map(v => `${v.clase}:${v.visible ? 'se ve' : 'no'}`).join(' · ');
    decir('antes:', antes);
    decir('ahora:', ahora);
    if (antes === ahora) decir('✗ el montaje no cambió al cambiar la vista');

    /* ── Ocultar desactivadas ────────────────────────────────────────── */
    decir('\napretando «Ocultar desactivadas»…');
    await p.click('[data-hace="ocultar-fuera"]');
    await espera(600);
    e = await mirar();
    decir('la línea queda con', e.trozos.length, 'trozos:',
        e.trozos.map(t => t.toma).join(', '));
    if (e.trozos.some(t => t.fuera === 'si')) decir('✗ quedó alguna desactivada a la vista');
    const texto = await js(`document.querySelector('[data-hace="ocultar-fuera"]').textContent.trim()`);
    decir('y el botón ahora dice:', JSON.stringify(texto));

    /* ── El espacio ──────────────────────────────────────────────────── */
    decir('\napretando la barra espaciadora…');
    await js(`document.activeElement.blur()`);
    await p.keyboard.press('Space');
    await espera(600);
    e = await mirar();
    decir('el botón dice', JSON.stringify(e.boton));

    console.log(malo.length ? `\n✗ ${malo.length} error(es) de JS:` : '\n✓ ni un error de JS');
    for (const m of malo) console.log(`   ${m}`);
    console.log(mal ? `✗ ${mal} comprobación(es) mal\n` : '✓ todas las comprobaciones bien\n');

    await nav.close();
    await sitio.bajar();
    if (malo.length || mal) process.exit(1);
}

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
