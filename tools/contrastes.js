#!/usr/bin/env node
'use strict';
/**
 * Calcula la tabla de contrastes de los tokens contra WCAG 2.2.
 *
 * No es un adorno del informe: es la herramienta con la que se eligieron los
 * colores. Cada token de `src/css/style.css` salió de acá y no del ojo — sobre
 * fondo oscuro, dos grises que se ven claramente distintos pueden estar los dos
 * por debajo del mínimo, y dos que parecen iguales pueden estar uno a cada lado.
 *
 * Fórmula: la de WCAG 2.x (luminancia relativa sRGB + (L1+0.05)/(L2+0.05)), con
 * los umbrales de 1.4.3 (4.5:1 texto chico, 3:1 texto grande) y 1.4.11 (3:1
 * para el borde que identifica un control o un estado).
 *
 *   node tools/contrastes.js
 *   node tools/contrastes.js --buscar '#34d399'   contra las cuatro superficies
 *
 * Los tokens se LEEN del CSS y no se copian acá: una tabla con los valores
 * escritos a mano dice la verdad hasta que alguien cambia el CSS, y entonces
 * dice una mentira con formato de medición.
 */

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'src', 'css', 'style.css');

function hex2rgb(h) {
    let s = String(h).trim().replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function ratio(a, b) {
    const l1 = lum(hex2rgb(a));
    const l2 = lum(hex2rgb(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Los tokens `--nombre: #hex;` del CSS, en el orden en que están escritos. */
function tokens() {
    const css = fs.readFileSync(CSS, 'utf8');
    const salida = new Map();
    const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
    let m;
    while ((m = re.exec(css)) !== null) salida.set(m[1], m[2]);
    return salida;
}

function fmt(n) {
    return `${n.toFixed(2)}:1`;
}

function marca(n, minimo) {
    return n >= minimo ? 'ok ' : 'NO ';
}

function main() {
    const t = tokens();
    const superficies = ['bg-base', 'bg-surface', 'bg-surface-hover', 'bg-inset', 'bg-overlay']
        .filter(k => t.has(k));

    const buscado = process.argv.includes('--buscar')
        ? process.argv[process.argv.indexOf('--buscar') + 1] : null;

    if (buscado) {
        console.log(`\n${buscado} contra las superficies\n`);
        for (const s of superficies) {
            const r = ratio(buscado, t.get(s));
            console.log(`  ${marca(r, 4.5)} ${s.padEnd(18)} ${fmt(r)}`);
        }
        return;
    }

    // El texto: 4.5:1 en el PEOR caso, que es contra la superficie más clara.
    // Medir contra el fondo del lienzo y nada más es la trampa de siempre:
    // el mismo gris sobre una tarjeta tiene menos contraste.
    console.log('\nTEXTO — mínimo 4.5:1 (SC 1.4.3), medido contra la peor superficie\n');
    const textos = [...t.keys()].filter(k => k.startsWith('text-') || ['ok', 'warn', 'error', 'accent'].includes(k));
    let peor = { n: Infinity };
    for (const k of textos) {
        const contra = superficies.map(s => ({ s, r: ratio(t.get(k), t.get(s)) }))
            .sort((a, b) => a.r - b.r)[0];
        if (contra.r < peor.n) peor = { n: contra.r, k, s: contra.s };
        console.log(`  ${marca(contra.r, 4.5)} ${k.padEnd(18)} ${fmt(contra.r)}  (peor: ${contra.s})`);
    }

    // Las vistas: su etiqueta se lee sobre una tarjeta.
    console.log('\nVISTAS — la etiqueta, sobre --bg-surface\n');
    for (const k of [...t.keys()].filter(x => x.startsWith('vista-'))) {
        const r = ratio(t.get(k), t.get('bg-surface'));
        if (r < peor.n) peor = { n: r, k, s: 'bg-surface' };
        console.log(`  ${marca(r, 4.5)} ${k.padEnd(18)} ${fmt(r)}`);
    }

    // Las tintas: van ENCIMA de un relleno de color, así que cada una se mide
    // contra el suyo. Un mismo gris oscuro daría 4:1 sobre uno y 9:1 sobre otro.
    console.log('\nTINTAS — el texto sobre un relleno de color\n');
    for (const [tinta, fondo] of [['on-accent', 'accent'], ['on-ok', 'ok'],
        ['on-warn', 'warn'], ['on-error', 'error']]) {
        if (!t.has(tinta) || !t.has(fondo)) continue;
        const r = ratio(t.get(tinta), t.get(fondo));
        console.log(`  ${marca(r, 4.5)} ${tinta.padEnd(18)} ${fmt(r)}  (sobre --${fondo})`);
    }

    // Las líneas: solo una de las dos pide 3:1 (ver el comentario del CSS).
    console.log('\nLÍNEAS — 3:1 solo para la que identifica un control (SC 1.4.11)\n');
    for (const [k, minimo, para] of [['border-field', 3, 'campos y foco'],
        ['hairline', 0, 'divisores, decorativa']]) {
        if (!t.has(k)) continue;
        const r = ratio(t.get(k), t.get('bg-base'));
        console.log(`  ${minimo ? marca(r, minimo) : '—  '} ${k.padEnd(18)} ${fmt(r)}  (${para})`);
    }

    console.log(`\nEl peor contraste de texto de la app: ${fmt(peor.n)} (--${peor.k} sobre --${peor.s})`);
    if (peor.n < 4.5) {
        console.log('\nHay texto por debajo de AA. Eso es un fallo, no una opinión.');
        process.exit(1);
    }
}

main();
