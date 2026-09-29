#!/usr/bin/env node
'use strict';
/**
 * Arma el icono de la app a partir del que ya usa la interfaz.
 *
 *   node tools/hacer-icono.js
 *
 * Dibuja la claqueta de `src/js/iconos.js` sobre el fondo de la app, saca un
 * PNG de 1024 y lo convierte a `.icns` con las herramientas del sistema.
 *
 * Se genera en vez de dibujarse aparte por un motivo y no por comodidad: el
 * icono del Dock y el de la barra de la app tienen que ser el MISMO dibujo. Con
 * dos archivos, el día que la claqueta cambie de trazo va a cambiar en un solo
 * sitio y nadie se va a enterar hasta ver los dos juntos.
 *
 * El `.icns` va a `build/`, que es donde electron-builder lo busca solo, así
 * que el mismo archivo sirve para el atajo de desarrollo y para el `.pkg`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.NT_CHROME
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'build');

/** El dibujo de la claqueta, leído del módulo de iconos y no copiado. */
function dibujoDeLaClaqueta() {
    const src = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'iconos.js'), 'utf8');
    const m = src.match(/\n\s*claqueta:\s*([\s\S]*?),\n\n/);
    if (!m) throw new Error('No encontré el dibujo de la claqueta en src/js/iconos.js');
    // Son literales de cadena concatenados con `+`: se evalúan como tales.
    // eslint-disable-next-line no-new-func
    return Function(`return (${m[1]});`)();
}

/**
 * El lienzo: el fondo de la app con la claqueta en el acento.
 *
 * Con esquinas redondeadas propias y no cuadrado a sangre: macOS NO redondea
 * los iconos de app por su cuenta —eso es iOS— así que un PNG cuadrado se ve
 * como una estampilla al lado de los demás del Dock. El radio es el 22,4 % del
 * lado, que es la proporción de la plantilla de Apple.
 */
function html(dibujo) {
    return `<!DOCTYPE html><html><body style="margin:0">
      <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
        <defs><clipPath id="r"><rect width="1024" height="1024" rx="229" ry="229"/></clipPath></defs>
        <g clip-path="url(#r)">
          <rect width="1024" height="1024" fill="#1c2027"/>
          <rect width="1024" height="1024" fill="none" stroke="#2b3138" stroke-width="16"/>
        </g>
        <g transform="translate(512 512) scale(30) translate(-12 -12)"
           fill="none" stroke="#7ab4ff" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">${dibujo}</g>
      </svg></body></html>`;
}

/** Los tamaños que pide un `.iconset` de macOS. */
const TAMANOS = [16, 32, 64, 128, 256, 512, 1024];

async function main() {
    fs.mkdirSync(DESTINO, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-icono-'));
    const png = path.join(tmp, 'icono.png');

    const navegador = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--force-device-scale-factor=1']
    });
    try {
        const pagina = await navegador.newPage();
        await pagina.setViewport({ width: 1024, height: 1024 });
        await pagina.setContent(html(dibujoDeLaClaqueta()));
        await pagina.screenshot({ path: png, omitBackground: true });
    } finally {
        await navegador.close();
    }

    // `iconutil` pide un `.iconset` con los nombres exactos, y cada tamaño con
    // su `@2x`: sin el @2x, el icono se ve borroso en una pantalla Retina, que
    // son todas.
    const iconset = path.join(tmp, 'icono.iconset');
    fs.mkdirSync(iconset);
    for (const n of TAMANOS) {
        if (n <= 512) {
            execFileSync('sips', ['-z', String(n), String(n), png,
                '--out', path.join(iconset, `icon_${n}x${n}.png`)], { stdio: 'ignore' });
        }
        if (n >= 32) {
            execFileSync('sips', ['-z', String(n), String(n), png,
                '--out', path.join(iconset, `icon_${n / 2}x${n / 2}@2x.png`)], { stdio: 'ignore' });
        }
    }

    const icns = path.join(DESTINO, 'icon.icns');
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
    fs.copyFileSync(png, path.join(DESTINO, 'icon.png'));
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`${icns}  (${Math.round(fs.statSync(icns).size / 1024)} KB)`);
    console.log('electron-builder lo toma solo desde build/, así que el `.pkg`');
    console.log('y el atajo de desarrollo llevan el mismo icono.');
}

main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
