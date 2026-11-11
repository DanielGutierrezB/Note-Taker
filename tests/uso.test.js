'use strict';
/**
 * Lo que la revisión de uso del 11/11 encontró, para que no vuelva.
 *
 *   · El problema de la clase se lee en la pantalla, no en un hover.
 *   · Un panel abierto se lleva el teclado, y lo de atrás queda inerte.
 *   · Los blancos de clic no bajan de 24 px.
 *   · Los textos chicos no pierden contraste por una opacidad.
 *   · Las vistas van con su nombre siempre que entre.
 *
 * Contra el texto de los archivos, como el resto de las pruebas de la ventana:
 * lo que se dibuja de verdad lo miden `tools/auditar.js` y
 * `tools/medir-botones.js` sobre la maqueta.
 */

const fs = require('fs');
const path = require('path');
const cssEntero = require('./fixtures/css');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/** El pedazo de `código` entre `desde` y `hasta`. */
function tramo(codigo, desde, hasta) {
    const a = codigo.indexOf(desde);
    if (a === -1) return '';
    const b = codigo.indexOf(hasta, a + desde.length);
    return codigo.slice(a, b === -1 ? codigo.length : b);
}

/** El cuerpo de la regla de ese selector exacto, o '' si no está. */
function regla(css, selector) {
    const i = css.indexOf(`${selector} {`);
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i));
}

module.exports = function (t) {
    const html = leer('src', 'index.html');
    const vivo = leer('src', 'js', 'pantalla-vivo.js');
    const css = cssEntero();

    t.group('uso · lo que le pasa a la clase se lee en la pantalla');

    t.test('el aviso está debajo de la barra, y lo anuncia un lector de pantalla', () => {
        const pantalla = tramo(html, 'id="vista-vivo"', 'id="vista-cierre"');
        t.ok(/<div class="aviso aviso-sesion" id="vivo-aviso" role="alert" hidden><\/div>\s*<div class="scroll">/.test(pantalla));
    });

    t.test('dice el motivo y qué hacer, que antes estaban solo en el hover de la barra', () => {
        const fn = tramo(vivo, 'function pintarAviso(est) {', '\n}');
        t.ok(/est && est\.porque/.test(fn), 'aparece cuando el estado trae su porqué');
        t.ok(/esc\(est\.porque\)/.test(fn), 'y lo escribe');
        t.ok(/caja\.dataset\.tono = est\.clave === 'sin audio' \? 'error' : 'normal'/.test(fn), 'en rojo si falta audio o texto');
        t.ok(/if \(caja\.dataset\.dice === dice\) return;/.test(fn), 'sin tocar el documento si dice lo mismo');
        const barra = tramo(vivo, 'function pintarBarra() {', '\n}');
        t.ok(/pintarAviso\(terminando \? null : est\)/.test(barra), 'lo pone al día la barra, en cada vuelta');
        t.ok(/pintarAviso\(null\);\s*pintarSalud\(null\);\s*return;/.test(barra), 'y mirando una clase grabada no hay aviso');
        t.ok(/pintarSalud\(estados\.salud\(/.test(barra), 'y el renglón de cómo va el vivo, también en cada vuelta');
    });

    t.test('la tarjeta de «Ahora» no dice «escuchando» con la barra en «sin audio»', () => {
        t.ok(!/<span class="pastilla" data-estado="escuchando">escuchando<\/span>/.test(vivo), 'la pastilla ya no está escrita a mano');
        t.ok(/data-pastilla-sesion/.test(tramo(vivo, 'function ahora(fps) {', '\nfunction ')), 'sale del estado de la sesión');
        const fn = tramo(vivo, 'function pastillaDeSesion(est) {', '\n}');
        t.ok(/est\.clave === 'sin audio'[\s\S]*dice: est\.palabra/.test(fn));
    });

    t.group('uso · un panel abierto se lleva el teclado');

    t.test('el foco entra al panel, lo de atrás queda inerte y al cerrar vuelve', () => {
        const chrome = leer('src', 'js', 'chrome.js');
        const fn = tramo(chrome, 'export function verPanel(id, abierto) {', '\n}');
        t.ok(/panel\.setAttribute\('role', 'dialog'\)/.test(fn) && /aria-modal/.test(fn));
        t.ok(/dejarElFondo\(true\);\s*panel\.focus\(/.test(fn), 'abre: fondo inerte y foco adentro');
        t.ok(/dejarElFondo\(Boolean\(otro\)\);\s*devolverElFoco\(desde, otro\)/.test(fn), 'cierra: lo devuelve');
        t.ok(/querySelectorAll\('\.topbar, \.vista'\)\) el\.inert = inerte/.test(chrome), 'la barra de arriba y las pantallas');
    });

    t.test('en la pantalla de la clase el foco vuelve a la pantalla, no a un botón', () => {
        // Con el foco en el botón de Ajustes, el Enter que abre una toma lo
        // volvería a apretar.
        const fn = tramo(leer('src', 'js', 'chrome.js'), 'function devolverElFoco(desde, otroPanel) {', '\n}');
        t.ok(/pantalla && pantalla\.hasAttribute\('tabindex'\)\) pantalla\.focus/.test(fn));
        t.ok(/<section class="vista" id="vista-vivo" tabindex="-1">/.test(html), 'y la de la clase es la que se lo lleva');
    });

    t.group('uso · blancos de clic y hovers');

    t.test('los alternadores, las vistas de la fila y los enlaces llegan a 24 px', () => {
        t.ok(/min-height: 24px;/.test(regla(css, '.alternar button')));
        t.ok(/height: 24px;/.test(regla(css, '.mini-vista')));
        const enlace = regla(css, '.btn-enlace');
        t.ok(/padding: 4px 0;/.test(enlace) && /margin: -4px 0;/.test(enlace), 'el enlace, sin mover el renglón');
    });

    t.test('la distribución se elige solo en la pantalla de la clase', () => {
        t.ok(/body:not\(:has\(#vista-vivo\.es-activa\)\) \.tema-barra \.distribuciones \{ display: none; \}/.test(css));
    });

    t.test('los botones que no decían qué hacen, ahora lo dicen', () => {
        for (const sin of [
            /<button[^>]*data-termino-agregar>Agregar/, /<button[^>]*data-frase-agregar>Agregar/,
            /<button type="button" data-vista-lista="(compacta|comoda)">/
        ]) t.ok(!sin.test(html), `sin hover: ${sin}`);
        t.ok(!/data-frase-agregar>Agregar/.test(leer('src', 'js', 'frases.js')));
        t.ok(/data-hace="nueva"\s+title="/.test(leer('src', 'js', 'pantalla-sesiones.js')));
        const preparar = leer('src', 'js', 'pantalla-preparar.js');
        t.ok(/data-hace="diagnostico" title="/.test(preparar) && /data-hace="ajustes"\s+title="/.test(preparar));
    });

    t.group('uso · contraste y nombres');

    t.test('los textos chicos no pierden contraste por una opacidad', () => {
        t.ok(!/opacity/.test(regla(css, '.pp-clip small')));
        t.ok(!/opacity/.test(regla(css, '.cierre-vista small')));
        t.ok(!/opacity/.test(css.slice(css.lastIndexOf('.pp-clip.es-referencia {'), css.indexOf('}', css.lastIndexOf('.pp-clip.es-referencia {')))),
            'la pista de referencia apaga el fondo, no el texto');
    });

    t.test('las vistas van con su nombre siempre que entre, y la letra sola es el último recurso', () => {
        t.ok(!/\.tema-nuevo\.es-horizontal \.atajo-vistas \.atajo span \{ display: none; \}/.test(css), 'horizontal ya no las esconde de por sí');
        t.ok(/@container \(max-width: 860px\) \{[\s\S]{0,400}\.atajos-centro \{ grid-column: 1 \/ -1; grid-row: 2; \}/.test(css), 'sin lugar, bajan a su renglón');
        t.ok(/@container \(max-width: 520px\) \{\s*\.tema-nuevo \.atajo-vistas \.atajo span \{ display: none; \}/.test(css));
    });

    t.test('la auditoría lee los colores mezclados del tema nuevo', () => {
        const tool = leer('tools', 'auditar.js');
        t.ok(/\/\^color\\\(srgb\/\.test\(texto\) \? 255 : 1/.test(tool));
    });
};
