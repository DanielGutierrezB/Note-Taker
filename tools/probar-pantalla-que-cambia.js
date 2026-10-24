'use strict';
/**
 * La pantalla que cambia de tamaño mientras se graba, con el filmar.js de verdad.
 *
 * El MP4 de Chromium no aguanta un cambio de tamaño: desde ahí el archivo no se
 * deja decodificar (ver `vigilarElTamano` en `src/js/grabar/filmar.js`). Esto
 * elige la propia pestaña como pantalla, graba, le cambia el tamaño a mitad y
 * termina; un puente falso escribe cada tramo en disco, y se mira que haya dos y
 * que ffmpeg los lea enteros, sin un error.
 *
 * Abre una ventana de Chrome: grabar una pestaña no anda sin ventana.
 *
 *   node tools/probar-pantalla-que-cambia.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const puppeteer = require('puppeteer-core');
const paths = require('../engine/paths');

const REPO = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pantalla-que-cambia-'));
const CHROME = process.env.NT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const abiertos = {};
let numero = 0;

const pagina = `<!doctype html><body style="margin:0;background:#123"><canvas id="c"></canvas><script>
const c = document.getElementById('c'); const g = c.getContext('2d'); let n = 0;
function pintar() { c.width = innerWidth; c.height = innerHeight; g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)';
  g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText('cuadro ' + n++, 40, 120);
  requestAnimationFrame(pintar); }
pintar();
window.anotado = [];
window.nt = {
  anotar: (e, d) => { window.anotado.push([e, d]); },
  semanalAbrir: p => fetch('/abrir?cual=' + p.cual).then(r => r.json()),
  semanalTrozo: (cual, bytes) => { fetch('/trozo?cual=' + cual, { method: 'POST', body: bytes }); },
  semanalCerrar: cual => fetch('/cerrar?cual=' + (cual || '')).then(r => r.json())
};
</script></body>`;

const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cual = u.searchParams.get('cual');
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(pagina); }
    if (u.pathname === '/abrir') {
        numero++;
        abiertos[cual] = path.join(DIR, `${cual}-${numero}.mp4`);
        fs.writeFileSync(abiertos[cual], '');
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, tramo: numero }));
    }
    if (u.pathname === '/trozo') {
        const partes = [];
        req.on('data', d => partes.push(d));
        req.on('end', () => { if (abiertos[cual]) fs.appendFileSync(abiertos[cual], Buffer.concat(partes)); res.end('ok'); });
        return undefined;
    }
    if (u.pathname === '/cerrar') {
        if (cual) delete abiertos[cual]; else for (const k of Object.keys(abiertos)) delete abiertos[k];
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
    }
    const ruta = path.join(REPO, 'src', u.pathname);
    if (!fs.existsSync(ruta)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(fs.readFileSync(ruta));
});

(async () => {
    await new Promise(r => servidor.listen(4855, r));
    const nave = await puppeteer.launch({
        executablePath: CHROME, headless: false,
        args: ['--auto-accept-this-tab-capture', '--no-sandbox', '--window-size=1300,900']
    });
    const p = await nave.newPage();
    const errores = [];
    p.on('pageerror', e => errores.push(e.message));
    await p.setViewport({ width: 1200, height: 800 });
    await p.goto('http://localhost:4855/');
    const eligio = await p.evaluate(async () => {
        // `getDisplayMedia` de la app pide la pantalla; acá, la pestaña.
        const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = o => real({ ...o, preferCurrentTab: true });
        window.filmar = await import('/js/grabar/filmar.js');
        const r = await window.filmar.elegirPantalla();
        const e = await window.filmar.empezar({ alAviso: a => window.anotado.push(['aviso', a]) });
        return { r, e };
    });
    console.log('eligió:', JSON.stringify(eligio));
    await new Promise(r => setTimeout(r, 4000));
    await p.setViewport({ width: 700, height: 800 });
    console.log('cambio de tamaño a los 4 s');
    await new Promise(r => setTimeout(r, 4000));
    await p.evaluate(() => window.filmar.terminar());
    await new Promise(r => setTimeout(r, 500));
    const anotado = await p.evaluate(() => window.anotado.filter(([e]) => /otro-tamano/.test(e)));
    await nave.close();
    servidor.close();
    let mal = 0;
    const decir = (bien, texto) => { console.log(`   ${bien ? '✓' : '✗'} ${texto}`); if (!bien) mal++; };
    const tramos = fs.readdirSync(DIR).filter(n => n.startsWith('pantalla')).sort();
    decir(eligio.e.ok, 'empezó a grabar la pantalla');
    decir(tramos.length === 2, `dos tramos, uno por tamaño (${tramos.join(', ')})`);
    decir(anotado.length === 1 && anotado[0][1].ok, `y quedó en el diario (${JSON.stringify(anotado[0] && anotado[0][1])})`);
    const ffmpeg = paths.ffmpeg().path;
    for (const t of tramos) {
        const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', path.join(DIR, t), '-f', 'null', '-'], { encoding: 'utf8' });
        const errores = (r.stderr.match(/error while decoding/g) || []).length;
        decir(fs.statSync(path.join(DIR, t)).size > 0 && errores === 0, `${t} se lee entero (${errores} errores)`);
    }
    decir(!errores.length, errores.length ? `errores de JS: ${errores[0]}` : 'ni un error de JS');
    console.log(`\n${mal ? '✗ ' + mal + ' mal' : '✓ todo bien'}\n`);
    process.exit(mal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
