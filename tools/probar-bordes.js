#!/usr/bin/env node
'use strict';
/**
 * Mover bordes en cada distribución, con la ventana de verdad y el motor de verdad.
 *
 *   node tools/probar-bordes.js --sidecar=<…_notas-en-vivo.json> [--tomas=1,5] [--ver]
 *       [--relectura-vacia] [--sin-abierta]
 *
 * La maqueta tiene la ventana entera pero no el motor, y las pruebas tienen el
 * motor pero no la ventana: un gesto que sale mal solo en una distribución —la
 * ventana le pide al motor otra palabra, o dibuja otra cosa con la misma
 * respuesta— no lo ve ninguna de las dos. Acá la ventana de la maqueta le habla
 * al motor de este proceso: se retoma una COPIA de una clase grabada (el WAV se
 * enlaza y solo se lee), y cada pedido de la ventana va a `grabacion` como iría
 * por el IPC, relectura con Whisper incluida.
 *
 * Por cada distribución —clásica, nueva en vertical, nueva en horizontal y en
 * horizontal con el texto a la izquierda— primero cierra desde «Ahora» una toma
 * abierta arrastrando su OUT, y después despliega cada toma pedida: arrastra con
 * el mouse su OUT y su IN para los dos lados, deshace con ⌘Z, y pone el OUT, el
 * IN y una división por el menú del clic derecho. Después de cada gesto espera a
 * que el motor termine de releer y compara cuántas palabras quedaron en la toma
 * en el motor y cuántas se ven dentro de sus bordes. Una toma que queda sin
 * texto, con palabras repetidas, o que en la pantalla se ve distinta de lo que
 * el motor tiene, es un fallo.
 *
 * La toma abierta la relee un Whisper de mentira con lo mismo que oyó el vivo;
 * con `--relectura-vacia` no escribe nada, que es lo que deja el filtro de nivel
 * con una voz que entra baja por la llamada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const maqueta = require('./maqueta/abrir');
const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');
const { arg } = require('./lib/cli');

const CHROME = process.env.NT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DISTRIBUCIONES = [
    { nombre: 'clásica', tema: 'clasico', distribucion: 'vertical' },
    { nombre: 'nueva vertical', tema: 'nuevo', distribucion: 'vertical' },
    { nombre: 'nueva horizontal', tema: 'nuevo', distribucion: 'horizontal' },
    { nombre: 'nueva horizontal, texto a la izquierda', tema: 'nuevo', distribucion: 'horizontal-izquierda' }
];
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Una copia de la clase que se puede retomar: sin `terminada`, con el WAV enlazado. */
function copiaDe(sidecar) {
    const curso = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-bordes-'));
    const datos = path.join(curso, 'xml', 'Datos');
    const audio = path.join(curso, 'xml', 'Audio');
    fs.mkdirSync(datos, { recursive: true });
    fs.mkdirSync(audio, { recursive: true });
    const s = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    delete s.terminada;
    for (const ses of s.sesiones || []) {
        const enlace = path.join(audio, path.basename(ses.archivo));
        if (fs.existsSync(ses.archivo) && !fs.existsSync(enlace)) fs.symlinkSync(ses.archivo, enlace);
        ses.archivo = enlace;
    }
    const json = path.join(datos, path.basename(sidecar));
    fs.writeFileSync(json, JSON.stringify(s));
    return { curso, json };
}

/** Hasta que la cola de relecturas se vacíe, o un minuto. */
async function quieto() {
    for (let i = 0; i < 600; i++) {
        const s = grabacion._sesion();
        if (!s || (!s.rehaciendo && !(s.cola || []).length)) return true;
        await espera(100);
    }
    return false;
}

function enElMotor(id) {
    const t = grabacion._sesion().estado.tomas.find(x => x.id === id);
    if (!t) return null;
    const todas = (t.antes || []).concat(t.palabras || [], t.despues || []).sort((a, b) => a.t - b.t);
    let repetidas = 0;
    for (let i = 1; i < todas.length; i++) {
        for (let j = i - 1; j >= 0 && todas[i].t - todas[j].t < 350; j--) {
            if (todas[j].texto.toLowerCase().replace(/\W/g, '') === todas[i].texto.toLowerCase().replace(/\W/g, '')) { repetidas++; break; }
        }
    }
    return {
        repetidas,
        inMs: t.inMs, outMs: t.outMs,
        palabras: (t.palabras || []).length,
        todas: (t.antes || []).length + (t.palabras || []).length + (t.despues || []).length,
        texto: (t.palabras || []).map(w => w.texto).join(' ')
    };
}

/** Lo que se ve de la toma: las palabras entre su IN y su OUT. */
function enLaPantalla(pagina, id) {
    return pagina.evaluate(id => {
        const texto = document.querySelector(`#lista-vivo [data-texto][data-toma="${id}"] .transcript`);
        if (!texto) return null;
        let dentro = false;
        const palabras = [];
        for (const n of texto.children) {
            if (n.classList.contains('borde')) { dentro = n.dataset.borde === 'in'; continue; }
            if (dentro && n.classList.contains('palabra')) palabras.push(n.textContent.trim());
        }
        return { palabras: palabras.length, texto: palabras.join(' '), vacio: Boolean(texto.querySelector('.transcript-vacio')) };
    }, id);
}

/** Qué muestra «Ahora», y si la última toma se ve en la lista. Corre en la página. */
function ahoraSeVe() {
    const ahora = document.querySelector('#ahora');
    const hueco = ahora && ahora.querySelector('[data-texto]');
    const palabras = hueco ? hueco.querySelectorAll('.palabra').length : 0;
    const vacio = hueco && hueco.querySelector('.transcript-vacio');
    const filas = [...document.querySelectorAll('#lista-vivo [data-hace="plegar"][data-toma]')];
    const ultima = filas[filas.length - 1];
    const abierta = ultima && document.querySelector(`#lista-vivo [data-texto][data-toma="${ultima.dataset.toma}"] .transcript`);
    return {
        resumen: `${hueco ? hueco.dataset.texto : 'nada'}, ${palabras} palabras${vacio ? ` («${vacio.textContent.trim().slice(0, 40)}»)` : ''}`
            + `, ${filas.length} tomas en la lista, la última ${abierta ? 'desplegada' : 'plegada'}`,
        enLaLista: ultima ? Number(ultima.dataset.toma) : null
    };
}

async function desplegar(pagina, id) {
    const abierta = await pagina.$(`#lista-vivo [data-texto][data-toma="${id}"] .transcript`);
    if (abierta) return true;
    // Buscado y apretado en el mismo paso: el repintado de cada segundo
    // cambia el botón por uno nuevo.
    const hay = await pagina.evaluate(id => {
        const b = document.querySelector(`#lista-vivo [data-hace="plegar"][data-toma="${id}"]`);
        if (!b) return false;
        b.scrollIntoView({ block: 'center' });
        b.click();
        return true;
    }, id);
    if (!hay) return false;
    await espera(250);
    return Boolean(await pagina.$(`#lista-vivo [data-texto][data-toma="${id}"] .transcript`));
}

/**
 * Arrastra el borde `cual` de la toma `id` hasta `pasos` palabras más allá
 * (negativo, para atrás), con el mouse de verdad.
 */
async function arrastrar(pagina, id, cual, pasos) {
    const donde = await pagina.evaluate((id, cual, pasos) => {
        const texto = document.querySelector(`#lista-vivo [data-texto][data-toma="${id}"] .transcript`);
        if (!texto) return null;
        const linea = texto.querySelector(`.borde[data-borde="${cual}"]`);
        if (!linea) return null;
        const hijos = [...texto.children];
        const palabras = hijos.filter(n => n.classList.contains('palabra'));
        const i = hijos.indexOf(linea);
        // La palabra de destino: la que queda a `pasos` de la línea, contando
        // desde la de su derecha (adelante) o la de su izquierda (atrás).
        const derecha = palabras.findIndex(p => hijos.indexOf(p) > i);
        const base = derecha === -1 ? palabras.length : derecha;
        const objetivo = palabras[pasos > 0 ? base + pasos - 1 : base + pasos];
        if (!objetivo) return null;
        linea.scrollIntoView({ block: 'center' });
        const a = linea.getBoundingClientRect();
        const b = objetivo.getBoundingClientRect();
        return {
            desde: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
            // Adelante se suelta en la mitad derecha, para que quede detrás de
            // la palabra; atrás, en la izquierda.
            hasta: { x: pasos > 0 ? b.right - 2 : b.left + 2, y: b.top + b.height / 2 },
            palabra: objetivo.textContent.trim(),
            t: Number(objetivo.dataset.t)
        };
    }, id, cual, pasos);
    if (!donde) return null;
    // Se vuelve a medir después del scroll.
    await espera(120);
    const medido = await pagina.evaluate((id, cual) => {
        const l = document.querySelector(`#lista-vivo [data-texto][data-toma="${id}"] .transcript .borde[data-borde="${cual}"]`);
        const r = l.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, id, cual);
    const destino = await pagina.evaluate((id, palabra, t) => {
        const w = [...document.querySelectorAll(`#lista-vivo [data-texto][data-toma="${id}"] .transcript .palabra`)]
            .find(p => Number(p.dataset.t) === t);
        if (!w) return null;
        const r = w.getBoundingClientRect();
        return { left: r.left, right: r.right, y: r.top + r.height / 2 };
    }, id, donde.palabra, donde.t);
    if (!destino) return null;
    const x = pasos > 0 ? destino.right - 2 : destino.left + 2;
    await pagina.mouse.move(medido.x, medido.y);
    await pagina.mouse.down();
    for (let k = 1; k <= 12; k++) {
        await pagina.mouse.move(medido.x + (x - medido.x) * k / 12, medido.y + (destino.y - medido.y) * k / 12);
        await espera(15);
    }
    await pagina.mouse.up();
    // Y la mano se va, como después de cualquier arrastre: con el puntero
    // sobre la línea el texto no se repinta a propósito (`sobreBorde`).
    if (!process.env.NT_QUIETO) await pagina.mouse.move(5, 5);
    return donde;
}

/**
 * Clic derecho sobre la palabra que queda a `pasos` de la línea `desde`, y la
 * opción del menú que pone `borde` ahí (o «Dividir»). Devuelve la palabra, o
 * null si el menú no la ofrece.
 */
async function porElMenu(pagina, id, desde, pasos, borde) {
    const donde = await pagina.evaluate((id, desde, pasos) => {
        const texto = document.querySelector(`#lista-vivo [data-texto][data-toma="${id}"] .transcript`);
        const linea = texto && texto.querySelector(`.borde[data-borde="${desde}"]`);
        if (!linea) return null;
        const hijos = [...texto.children];
        const palabras = hijos.filter(n => n.classList.contains('palabra'));
        const i = hijos.indexOf(linea);
        const derecha = palabras.findIndex(p => hijos.indexOf(p) > i);
        const w = palabras[(derecha === -1 ? palabras.length : derecha) + pasos];
        if (!w) return null;
        w.scrollIntoView({ block: 'center' });
        const r = w.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, palabra: w.textContent.trim() };
    }, id, desde, pasos);
    if (!donde) return null;
    await espera(120);
    await pagina.mouse.click(donde.x, donde.y, { button: 'right' });
    await espera(150);
    const hecho = await pagina.evaluate(borde => {
        const b = document.querySelector(`#menu-palabra:not([hidden]) [data-borde="${borde}"]`);
        if (!b) return false;
        b.click();
        return true;
    }, borde);
    if (!hecho) {
        await pagina.keyboard.press('Escape');
        return null;
    }
    await pagina.mouse.move(5, 5);
    return donde;
}

async function unaDistribucion(url, sidecar, d, tomas, ver, abierta) {
    const { json } = copiaDe(sidecar);
    const avisos = [];
    grabacion.reanudar(json, { sinReloj: true, avisar: a => avisos.push(a) });
    const navegador = await puppeteer.launch({ executablePath: CHROME, headless: ver ? false : 'new',
        args: ver ? ['--window-position=2600,0', '--window-size=1440,900'] : [] });
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1440, height: 900 });
    const pedidos = [];
    const historial = [];
    await pagina.exposeFunction('__motor', (que, a, b) => {
        if (que === 'editar') pedidos.push(a);
        const r = que === 'editar' ? grabacion.editar(a)
            : que === 'abrir' ? grabacion.abrirToma(a)
                : que === 'cerrar' ? grabacion.cerrarToma(a)
                    : que === 'deshacer' ? grabacion.deshacer()
                        : que === 'rehacer' ? grabacion.rehacer()
                            : grabacion.resumen();
        if (que === 'deshacer' || que === 'rehacer') {
            const est = r && r.estado;
            historial.push({ que, ok: r && r.ok, dice: r && (r.que || r.error),
                tomas: est ? est.tomas.map(t => `${t.id}:${(t.palabras || []).length}`).join(' ') : null });
        }
        return JSON.parse(JSON.stringify(r == null ? null : r));
    });
    await pagina.evaluateOnNewDocument(d => {
        localStorage.setItem('nt.tema', d.tema);
        localStorage.setItem('nt.tema.distribucion', d.distribucion);
    }, d);
    await pagina.goto(`${url}?e=sesiones`, { waitUntil: 'networkidle0' });
    await espera(400);
    await pagina.evaluate(() => {
        const nt = window.nt;
        nt.grabarEditar = c => window.__motor('editar', c);
        nt.grabarAbrirToma = ms => window.__motor('abrir', ms);
        nt.grabarCerrarToma = ms => window.__motor('cerrar', ms);
        nt.grabarDeshacer = () => window.__motor('deshacer');
        nt.grabarRehacer = () => window.__motor('rehacer');
        nt.grabarEstado = () => window.__motor('estado');
    });
    await pagina.evaluate(estado => window.dev.app.irAVivo(estado, {
        abierto: true, caido: false, pico: 0.3, dispositivo: 'prueba', clase: 'llamada'
    }), JSON.parse(JSON.stringify(grabacion.resumen())));
    await espera(400);

    // Lo que el motor avisa (la relectura que terminó, sobre todo) llega a la
    // ventana como por el IPC.
    const reenviar = async () => {
        while (avisos.length) {
            const a = avisos.shift();
            await pagina.evaluate(a => window.maqueta.avisar(a), JSON.parse(JSON.stringify(a))).catch(() => {});
        }
    };
    // Grabando, el ciclo manda el estado cada segundo y la pantalla se repinta
    // con él: los gestos tienen que aguantar eso, que es lo de todos los días.
    const latido = setInterval(() => {
        avisos.push({ tipo: 'estado', estado: grabacion.resumen() });
        reenviar();
    }, 1000);

    const fallos = [];
    const filas = [];
    const mirar = async (id, gesto, donde) => {
        await quieto();
        await reenviar();
        await espera(350);
        const motor = enElMotor(id);
        const pantalla = await enLaPantalla(pagina, id);
        const pedido = pedidos[pedidos.length - 1];
        filas.push({ id, gesto, palabra: donde && donde.palabra, motor, pantalla, pedido,
            historial: gesto === '⌘Z' ? historial.splice(0) : null });
        const mal = [];
        if (!motor) mal.push('la toma ya no está en el motor');
        else if (motor.palabras === 0) mal.push('el motor la dejó sin palabras');
        if (motor && motor.repetidas > 2) mal.push(`${motor.repetidas} palabras repetidas en la toma y sus orillas`);
        if (pantalla == null) mal.push('la toma no se ve desplegada');
        else if (motor && pantalla.palabras !== motor.palabras) {
            mal.push(`la pantalla muestra ${pantalla.palabras} palabras y el motor tiene ${motor.palabras}`);
        }
        if (mal.length) fallos.push(`toma ${id}, ${gesto}: ${mal.join('; ')}`);
        if (ver) await pagina.screenshot({ path: path.join(os.tmpdir(), `nt-bordes-${d.distribucion}-${d.tema}-${id}-${gesto.replace(/\W+/g, '-')}.png`) });
    };

    // La toma abierta, en «Ahora»: su OUT arrastrado hacia atrás la CIERRA en
    // esa palabra. Una toma vieja no se puede reabrir (es de otro WAV), así que
    // se abre una nueva con un conteo y treinta palabras de un ciclo de mentira,
    // y la relee un Whisper de mentira: con lo mismo, o vacío si `abierta` es
    // 'vacia', que es lo que deja el filtro de nivel con una voz que entra baja.
    if (abierta) {
        const s = grabacion._sesion();
        for (let i = 0; i < 40; i++) grabacion.pcm(Buffer.alloc(48000 * 2));
        const cero = s.captura.desdeMs;
        const w = (dt, texto) => ({ t: cero + dt, texto, hasta: cero + dt + 300 });
        const dicho = [w(1000, '3,'), w(1400, '2,'), w(1800, '1.')];
        for (let i = 0; i < 30; i++) dicho.push(w(2600 + i * 400, `palabra${i + 1}`));
        oirToma.tramo = async () => ({ palabras: dicho });
        // Whisper de mentira por debajo de `oirToma.leer`, para que la relectura
        // pase entera por el código de verdad.
        oir.escuchar = async p => ({
            palabras: abierta === 'vacia' ? [] : dicho.filter(x => x.t >= p.desdeMs && x.t < p.hastaMs),
            colapsadas: 0, mudas: 0, quitadas: [], inventadas: []
        });
        await grabacion.buscarSenales();
        oirToma.tramo = async () => ({ palabras: [] });
        const ultima = s.estado.tomas.slice(-1)[0].id;
        await pagina.evaluate(estado => window.maqueta.avisar({ tipo: 'estado', estado }),
            JSON.parse(JSON.stringify(grabacion.resumen())));
        await espera(500);
        const antes = await pagina.evaluate(ahoraSeVe);
        const r = await pagina.evaluate(() => {
            const t = document.querySelector('#ahora [data-texto="abierta"] .transcript');
            const out = t && t.querySelector('.borde[data-borde="out"]');
            const ps = t ? [...t.querySelectorAll('.palabra')] : [];
            const w = ps[ps.length - 5];
            if (!out || !w) return null;
            w.scrollIntoView({ block: 'center' });
            const a = out.getBoundingClientRect();
            const b = w.getBoundingClientRect();
            return { a: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, b: { x: b.left + 2, y: b.top + b.height / 2 }, palabra: w.textContent };
        });
        if (!r) fallos.push('la toma abierta no se ve en «Ahora» con su OUT');
        else {
            await pagina.mouse.move(r.a.x, r.a.y);
            await pagina.mouse.down();
            for (let k = 1; k <= 12; k++) { await pagina.mouse.move(r.a.x + (r.b.x - r.a.x) * k / 12, r.a.y + (r.b.y - r.a.y) * k / 12); await espera(15); }
            await pagina.mouse.up();
            await pagina.mouse.move(5, 5);
            await quieto();
            await reenviar();
            await espera(600);
            const despues = await pagina.evaluate(ahoraSeVe);
            const motor = enElMotor(ultima);
            filas.push({ id: ultima, gesto: 'OUT de la abierta −5', palabra: r.palabra, motor,
                pantalla: { palabras: despues.enLaLista }, nota2: `«Ahora» antes: ${antes.resumen} · después: ${despues.resumen}` });
            if (!motor || motor.palabras === 0) fallos.push(`toma ${ultima} cerrada desde «Ahora»: el motor la dejó sin palabras`);
            if (despues.enLaLista == null) fallos.push(`toma ${ultima} cerrada desde «Ahora»: no se ve en la lista`);
        }
    }

    for (const id of tomas) {
        if (!await desplegar(pagina, id)) { fallos.push(`toma ${id}: no se pudo desplegar`); continue; }
        await mirar(id, 'desplegada');
        for (const [cual, pasos, gesto] of [['out', 3, 'OUT +3'], ['out', -4, 'OUT −4'], ['out', 12, 'OUT +12'],
            ['in', 2, 'IN +2'], ['in', -3, 'IN −3']]) {
            if (!await desplegar(pagina, id)) { fallos.push(`toma ${id}, ${gesto}: se plegó sola`); break; }
            const donde = await arrastrar(pagina, id, cual, pasos);
            if (!donde) { filas.push({ id, gesto, nota: 'no hay a dónde' }); continue; }
            await mirar(id, gesto, donde);
        }
        await pagina.keyboard.down('Meta');
        await pagina.keyboard.press('z');
        await pagina.keyboard.up('Meta');
        await mirar(id, '⌘Z');

        for (const [desde, pasos, borde, gesto] of [['out', 2, 'out', 'menú OUT acá'], ['in', 2, 'in', 'menú IN acá'],
            ['in', 6, 'dividir', 'menú Dividir']]) {
            if (!await desplegar(pagina, id)) { fallos.push(`toma ${id}, ${gesto}: no se pudo desplegar`); break; }
            const cuantas = grabacion._sesion().estado.tomas.length;
            const donde = await porElMenu(pagina, id, desde, pasos, borde);
            if (!donde) { filas.push({ id, gesto, nota: 'el menú no lo ofrece ahí' }); continue; }
            await mirar(id, gesto, donde);
            if (borde === 'dividir') {
                const tomasAhora = grabacion._sesion().estado.tomas;
                if (tomasAhora.length !== cuantas + 1) fallos.push(`toma ${id}, ${gesto}: no se partió`);
                const segunda = tomasAhora[tomasAhora.findIndex(t => t.id === id) + 1];
                if (segunda && await desplegar(pagina, segunda.id)) await mirar(segunda.id, 'segunda mitad');
            }
        }
    }

    clearInterval(latido);
    await navegador.close();
    grabacion.apagar();
    return { filas, fallos };
}

async function main() {
    const sidecar = arg('sidecar');
    if (!sidecar || !fs.existsSync(sidecar)) {
        console.log('Uso: node tools/probar-bordes.js --sidecar=<…_notas-en-vivo.json> [--tomas=1,5] [--ver]');
        process.exit(1);
    }
    const tomas = String(arg('tomas', '1,5')).split(',').filter(Boolean).map(Number);
    const ver = process.argv.includes('--ver');
    const abierta = process.argv.includes('--sin-abierta') ? null : (process.argv.includes('--relectura-vacia') ? 'vacia' : 'llena');
    const { url, bajar } = await maqueta.levantar(5193);
    let rotas = 0;
    try {
        for (const d of DISTRIBUCIONES) {
            const r = await unaDistribucion(url, sidecar, d, tomas, ver, abierta);
            console.log(`\n${d.nombre}`);
            for (const f of r.filas) {
                if (f.nota) { console.log(`  toma ${f.id} ${f.gesto}: ${f.nota}`); continue; }
                if (f.nota2) console.log(`  ${f.nota2}`);
                const m = f.motor;
                const p = f.pantalla;
                console.log(`  toma ${f.id} ${f.gesto.padEnd(10)} ${f.palabra ? `«${f.palabra}» ` : ''}`
                    + `motor ${m ? `${m.palabras}/${m.todas}${m.repetidas ? ` (${m.repetidas} rep.)` : ''}` : '—'} · pantalla ${p ? p.palabras : '—'}`
                    + (f.historial ? `  ${JSON.stringify(f.historial)}` : ''));
            }
            for (const f of r.fallos) console.log(`  ✗ ${f}`);
            rotas += r.fallos.length;
        }
    } finally {
        await bajar();
    }
    console.log(rotas ? `\n${rotas} fallo(s)` : '\nSin fallos');
    process.exit(rotas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
