'use strict';
/**
 * Dónde vive cada disparador de la pantalla En vivo.
 *
 * Se prueba sobre el código de la ventana, como en `turnos.test.js`: acá no hay
 * DOM, pero sí se puede decir en qué pedazo del HTML está declarado un botón y
 * en qué pedazo del JS se dibuja: que la claqueta ya no aparezca por ningún
 * lado, y que cada disparador que queda le pida al motor lo mismo por el clic
 * que por la tecla.
 */

const fs = require('fs');
const cssEntero = require('./fixtures/css');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/** El pedazo de `código` entre `desde` y `hasta`, para preguntarle qué hay adentro. */
function tramo(codigo, desde, hasta) {
    const a = codigo.indexOf(desde);
    if (a === -1) return '';
    const b = codigo.indexOf(hasta, a + desde.length);
    return codigo.slice(a, b === -1 ? codigo.length : b);
}

module.exports = function (t) {
    const html = leer('src', 'index.html');
    const js = leer('src', 'js', 'pantalla-vivo.js');
    const barra = tramo(html, '<div class="barra-arriba">', '<div class="atajos"');

    t.group('en vivo · la claqueta ya no está');

    t.test('ni botón en la barra, ni atajo, ni contador, ni pastilla de palmada', () => {
        for (const rastro of ['btn-claqueta', 'data-hace="claqueta"', 'vivo-claquetas', 'vivo-palmada', '<kbd>K</kbd>']) {
            t.ok(!html.includes(rastro), rastro);
        }
    });

    t.test('la pantalla no la pide por ningún camino', () => {
        for (const rastro of ['grabarClaqueta', 'grabarQuitarClaqueta', "tecla === 'k'", 'filaClaqueta', 'nota-claqueta']) {
            t.ok(!js.includes(rastro), rastro);
        }
    });

    t.test('el clic de la barra sigue pasando por `alClic`', () => {
        // Sin esta escucha los rótulos de la barra quedan dibujados y muertos:
        // `data-hace` solo hace algo en las zonas que tienen el manejador.
        t.ok(/\$\('\.barra-arriba'\)\.addEventListener\('click', alClic\)/.test(js));
    });

    t.group('en vivo · sobre qué toma caen las vistas de la barra');

    t.test('el clic y la tecla pasan por la misma función', () => {
        // Si cada uno resolviera la toma por su cuenta, el mismo gesto haría
        // dos cosas según se haya hecho con el mouse o con el teclado.
        t.ok(/case 'vista-tecla': await ponerVista\(boton\.dataset\.vista\)/.test(js));
        t.eq([...js.matchAll(/await ponerVista\(/g)].length, 2, 'el clic y la tecla');
    });

    t.test('sin toma abierta ni desplegada, la elección es para la que viene', () => {
        const fn = js.slice(js.indexOf('function laDeLasTeclas()'),
            js.indexOf('\n}', js.indexOf('function laDeLasTeclas()')));
        t.ok(/por\(estado\.abierta\)/.test(fn), 'primero la que se está grabando');
        t.ok(/vista\.abierta === `t\$\{desplegada\.id\}`/.test(fn),
            'después, solo una que el editor haya desplegado a mano');
        t.ok(!/reverse\(\)\.find/.test(fn),
            'y ya NO la última cerrada: era lo que hacía que la barra, entre dos '
            + 'tomas, le cambiara la vista a una que ya estaba hecha');
        const poner = js.slice(js.indexOf('async function ponerVista('),
            js.indexOf('\n}', js.indexOf('async function ponerVista(')));
        t.ok(/tipo: 'vista-proxima'/.test(poner), 'sin toma, va al motor como elección pendiente');
    });

    t.test('la barra dice de qué toma está hablando', () => {
        // El botón encendido no lo cuenta solo: con la barra diciendo siempre
        // lo mismo, apretar una vista entre dos tomas parecía estar cambiando
        // la de la que se acababa de cerrar.
        t.ok(/atajo-vistas-de/.test(html), 'el hueco está en el HTML');
        t.ok(/laDeTeclas \? `toma \$\{laDeTeclas\.id\}` : 'la que viene'/.test(js));
    });

    /* ─── El idioma y la cámara, a la vista ──────────────────────────────
     *
     * Los dos estaban enterrados en Ajustes y eso costaba una clase entera:
     * empezar con el idioma equivocado no deja un transcript con faltas, lo
     * deja TRADUCIDO (ver `engine/idiomas.js`), y no había forma de notarlo
     * sin leerlo. Ahora se ven en la barra y se cambian ahí.
     */
    t.group('en vivo · el idioma y la cámara en la barra');

    // Cómo se comportan los rótulos y el cambio de idioma lo prueba andando
    // `rotulos-de-la-barra.test.js`. Acá, que es lo que se puede leer del
    // código: que esta pantalla los cablee por las piezas compartidas.
    const rotulos = tramo(js, 'function pintarRotulos() {', '\n}');
    const camara = tramo(js, 'function rotuloDeCamara() {', '\n}');

    t.test('los dos rótulos tienen su hueco en la barra', () => {
        t.ok(/id="vivo-rotulos"/.test(barra), 'y está en la fila de arriba, con el nivel');
        t.ok(/idiomas\.rotulo\('vivo-idioma', estado\.idioma, estado\.idiomaOido \|\| null\)/.test(rotulos),
            'el de idioma sale de idiomas.rotulo');
        t.ok(/rotuloDeCamara\(\)/.test(rotulos) && /id: 'vivo-camara'/.test(camara),
            'y el de cámara es de esta pantalla, que es la única con cámara de referencia');
    });

    t.test('se ponen con rotuloBarra.pintar, nunca escribiendo el HTML a mano', () => {
        // La barra se repinta cada 150 ms. Escribir el `innerHTML` directo
        // rehacía los botones en medio del clic: medido, 0 de 15 agarraban.
        t.ok(/rotuloBarra\.pintar\(caja, esDeMirar\(\) \? \[\] : \[/.test(rotulos),
            'y en una clase que se mira, vacíos: ni transcribe ni saca fotos');
        t.ok(!/innerHTML/.test(rotulos), 'nada de escribirlos a mano');
    });

    t.test('el menú se abre por el id del rótulo, no por el botón apretado', () => {
        // La lista de cámaras se espera antes de abrir: el botón apretado pudo
        // haberse redibujado, y el menú caía en la esquina.
        t.ok(/case 'idioma':\s*\n\s*rotuloBarra\.abrir\(boton\.id,/.test(js));
        t.ok(/rotuloBarra\.abrir\(boton\.id, await app\.camarasParaElegir\(\)/.test(js));
    });

    t.test('la cámara dice de qué es, y tiene su forma corta', () => {
        t.ok(/que: 'Cámara'/.test(camara) && /icono: 'camara'/.test(camara));
        // Sin la corta se repite la larga, la fila vuelve a desbordarse a
        // 900 px y nadie se entera hasta medirla.
        t.ok(/\n\s+corto: /.test(camara));
    });

    t.test('cambiar el idioma pasa por idiomas.cambiar y queda para mañana', () => {
        const fn = tramo(js, 'async function cambiarIdioma(cual) {', '\n}');
        t.ok(/idiomas\.cambiar\(cual, estado\)/.test(fn), 'que es el que pregunta si releer');
        t.ok(/if \(!r\) return;/.test(fn), 'cancelar no toca nada, ni los ajustes');
        t.ok(/app\.guardarAjustes\(\{ idioma: cual \}\)/.test(fn),
            'y queda para las clases siguientes: quien se equivocó hoy se equivoca mañana');
        t.ok(/avisar\(r\.aviso, 'ok'\)/.test(fn), 'y dice lo que hizo');
    });

    t.test('el diálogo de varias salidas existe de punta a punta', () => {
        t.ok(/preguntar: payload => ipcRenderer\.invoke\('preguntar', payload\)/
            .test(leer('preload.js')), 'el preload lo expone');
        const main = tramo(leer('main.js'), "ipc.handle('preguntar',", '\n});');
        t.ok(/buttons: \[\.\.\.formas\.map\(o => o\.dice\), 'Cancelar'\]/.test(main),
            'cancelar lo pone el diálogo, al final: no se lo tiene que acordar quien pregunta');
        t.ok(/cancelId: formas\.length/.test(main) && /defaultId: formas\.length/.test(main),
            'y es el marcado, y el que contesta Escape');
        t.ok(/return elegida \? elegida\.valor : null;/.test(main), 'vuelve el valor, o null');
    });

    t.test('la palabra entra solo donde hay lugar, el icono siempre', () => {
        // «Auto» a secas no contesta de qué habla: fue lo primero que se
        // preguntó al verlo. La palabra no cabe a cualquier ancho —medido, a
        // 1180 px sobran 95 px en la fila y las dos palabras piden más—, así que
        // entra a partir de 1200 px y donde no entra lo dice el icono.
        const css = cssEntero();
        t.ok(/\.rotulo-que \{\s*display: none;/.test(css), 'la palabra arranca escondida');
        t.ok(/@media \(min-width: 1200px\) \{\s*\n\s*\.rotulo-que \{\s*\n\s*display: inline;/.test(css),
            'y entra solo donde hay lugar medido');
        t.ok(/\n    idioma:\n/.test(leer('src', 'js', 'iconos.js')), 'y el icono de idioma está dibujado');
        t.ok(/\.rotulo-barra\[data-avisa='si'\]/.test(css), 'el ámbar tiene su estilo');
    });

    t.test('a 900 px los rótulos pasan a su forma corta, y nada se esconde', () => {
        // La barra iba al límite exacto a 900 px, que es el ancho mínimo de la
        // ventana. Lo que cede está medido y escrito en el CSS; lo que no puede
        // pasar es que se resuelva recortando con puntos suspensivos —«Auto ·
        // ES» cortado por la derecha se come justo el idioma— ni escondiendo un
        // número.
        const css = cssEntero();
        const estrecho = tramo(css, '@media (max-width: 1100px) {', '\n}\n');
        t.ok(/\.rotulo-ancho \{\s*display: none;/.test(estrecho), 'se va la forma larga');
        t.ok(/\.rotulo-angosto \{\s*display: inline;/.test(estrecho), 'y entra la corta');
        t.ok(!/display: none/.test(estrecho.replace(/\.rotulo-ancho \{[^}]*\}/, '')),
            'y no se esconde nada más: ni el timecode, ni el estado, ni los contadores');
    });

    t.test('la lista de cámaras se pide al abrir el menú, no antes', () => {
        // Una cámara virtual aparece cuando alguien abre el OBS: una lista de
        // hace una hora no tendría la que se está buscando.
        t.ok(/case 'camara':[\s\S]{0,400}await app\.camarasParaElegir\(\)/.test(js));
        const app = leer('src', 'js', 'app.js');
        const fn = tramo(app, 'async function camarasParaElegir() {', '\n}');
        t.ok(/await ojo\.camaras\(\)/.test(fn), 'y se pregunta al sistema en ese momento');
        t.ok(/valor: '',[\s\S]{0,60}dice: 'Ninguna'/.test(fn), '«Ninguna» está entre las opciones');
        t.ok(/no está conectada/.test(fn),
            'y la elegida sigue en la lista desenchufada: eso no es cambiar de ajuste');
    });
};
