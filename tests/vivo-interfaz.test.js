'use strict';
/**
 * Dónde vive cada disparador de la pantalla En vivo.
 *
 * Se prueba sobre el código de la ventana, como en `turnos.test.js`: acá no hay
 * DOM, pero sí se puede decir en qué pedazo del HTML está declarado un botón y
 * en qué pedazo del JS se dibuja. Lo que mira esto es que el botón de Claqueta
 * esté en la barra —global, con los controles— y NO en la fila de la toma, que
 * es donde el editor lo apretaba por error queriendo cerrarla, y que los tres
 * caminos (el botón, el atajo de la tira y la tecla K) le pidan lo mismo al
 * motor en vez de tener cada uno su lógica.
 */

const fs = require('fs');
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
    const atajos = tramo(html, '<div class="atajos" id="vivo-atajos">', '</div>\n    </div>');
    const tarjeta = tramo(js, 'function ahora(fps) {', '\n}\n');

    t.group('en vivo · la claqueta es global');

    t.test('el botón está en la barra, con los demás controles', () => {
        t.ok(/id="btn-claqueta"/.test(barra), 'está declarado en la fila de arriba');
        t.ok(/data-hace="claqueta"/.test(barra), 'y pide la misma acción que el atajo');
    });

    t.test('la tarjeta de «Ahora» no dibuja ninguno', () => {
        // Es la fila de la toma abierta: al lado de «Cerrar toma» se apretaba
        // sin querer, y una claqueta de más hay que ir a quitarla a la lista.
        t.ok(tarjeta.length > 0, 'se encontró la tarjeta');
        t.ok(!/data-hace="claqueta"/.test(tarjeta), 'ni con toma abierta ni sin ella');
    });

    t.test('la tecla K sigue escrita en la tira de atajos', () => {
        t.ok(/data-hace="claqueta"/.test(atajos));
        t.ok(/<kbd>K<\/kbd>/.test(atajos));
    });

    t.group('en vivo · los tres caminos le piden lo mismo al motor');

    t.test('el clic de la barra pasa por `alClic`', () => {
        // Sin esta escucha el botón queda dibujado y muerto: `data-hace` solo
        // hace algo en las tres zonas que tienen el manejador.
        t.ok(/\$\('\.barra-arriba'\)\.addEventListener\('click', alClic\)/.test(js));
    });

    t.test('`alClic` y la tecla K llaman a `grabarClaqueta`, y nadie más', () => {
        t.ok(/case 'claqueta': await pedir\(\(\) => window\.nt\.grabarClaqueta\(/.test(js));
        t.ok(/tecla === 'k'/.test(js), 'la tecla sigue siendo la K');
        const llamadas = [...js.matchAll(/window\.nt\.grabarClaqueta\(/g)].length;
        t.eq(llamadas, 2, 'una por el clic y una por la tecla: nada duplicado');
    });

    t.test('las dos mandan la palmada que la pastilla está señalando', () => {
        // Las DOS: el botón de la barra y la tecla hacen lo mismo, y una que
        // se olvidara de mandarla dejaría la claqueta en el dedo según por
        // dónde se haya pedido, que es la clase de diferencia que nadie
        // entiende mirando el XML al día siguiente.
        const conPalmada = [...js.matchAll(/window\.nt\.grabarClaqueta\(palmadaParaEnganchar\(\)\)/g)];
        t.eq(conPalmada.length, 2, 'el clic y la tecla, las dos');
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

    const rotulos = tramo(js, 'function pintarRotulos() {', '\n}');

    t.test('los dos rótulos tienen su hueco en la barra', () => {
        t.ok(/id="vivo-rotulos"/.test(barra), 'y está en la fila de arriba, con el nivel');
        t.ok(/id: 'vivo-idioma'/.test(rotulos) && /id: 'vivo-camara'/.test(rotulos));
    });

    t.test('solo grabando: una clase que se mira no transcribe nada', () => {
        t.ok(/if \(esDeMirar\(\)\) \{ caja\.innerHTML = ''; return; \}/.test(rotulos),
            'se esconden, como el resto del cromo que solo tiene sentido grabando');
    });

    t.test('con el menú abierto no se redibujan', () => {
        // El rótulo es el botón del que cuelga el menú: rehacerlo debajo deja
        // el menú apuntando a un botón que ya no está en el documento.
        t.ok(/if \(rotuloBarra\.hay\(\)\) return;/.test(rotulos));
    });

    t.test('el idioma puesto que no coincide con lo que suena se ve en ámbar', () => {
        t.ok(/estado\.idioma !== 'auto' && oido && oido !== estado\.idioma/.test(rotulos),
            'solo con el idioma puesto a mano: en «auto» no hay nada que avisar');
        t.ok(/TRADUCIDO/.test(rotulos), 'y el tooltip dice lo que está en juego');
        const css = leer('src', 'css', 'style.css');
        t.ok(/\.rotulo-barra\[data-avisa='si'\]/.test(css), 'con su estilo');
    });

    t.test('cambiar el idioma lo guarda para mañana y cuenta lo que relee', () => {
        const fn = tramo(js, 'async function cambiarIdioma(cual) {', '\n}');
        t.ok(/window\.nt\.grabarIdioma\(cual, \{ releer \}\)/.test(fn), 'se lo pide al motor');
        t.ok(/app\.guardarAjustes\(\{ idioma: cual \}\)/.test(fn),
            'y queda para las clases siguientes: quien se equivocó hoy se equivoca mañana');
        t.ok(/r\.releyendo/.test(fn) && /Releyendo/.test(fn),
            'y se dice cuántas tomas se están releyendo, que tarda');
    });

    t.test('releer lo de atrás se pregunta, y solo cuando hay algo que releer', () => {
        // Releer rehace el texto que va al Premiere, así que no se hace sin
        // permiso: quien se da cuenta a mitad de que el idioma está mal tiene
        // que poder arreglarlo sin miedo a romper lo que ya salió bien. Pero si
        // no hay ninguna toma cerrada no hay nada que elegir, y preguntar ahí
        // es un diálogo que estorba en medio de una clase.
        const fn = tramo(js, 'async function cambiarIdioma(cual) {', '\n}');
        t.ok(/t\.outMs != null && !t\.descartada/.test(fn),
            'cuenta las cerradas con la misma regla que el motor');
        t.ok(/if \(cerradas\) \{\s*\n\s*const dicho = await idiomas\.preguntarSiReleer\(cerradas, cual\);/
            .test(fn), 'pregunta, y solo adentro del «si hay cerradas»');
        t.ok(/if \(!dicho\) return;/.test(fn), 'cancelar no cambia ni el idioma');
        t.ok(/releer = dicho === 'releer'/.test(fn), 'y la otra salida cambia sin releer');

        const mod = leer('src', 'js', 'idiomas.js');
        const preg = tramo(mod, 'export async function preguntarSiReleer(cuantas, a) {', '\n}');
        t.ok(/window\.nt\.preguntar\(/.test(preg), 'por el diálogo del sistema, que bloquea');
        t.eq((preg.match(/'Solo de acá en adelante', 'Cancelar'/g) || []).length, 1,
            'con tres salidas: releer, seguir de acá, o no tocar nada');
        t.ok(/return null;/.test(preg), 'y cerrarlo es no tocar nada');

        // Y el puente existe: sin esto la ventana llama a algo que no está.
        t.ok(/preguntar: payload => ipcRenderer\.invoke\('preguntar', payload\)/
            .test(leer('preload.js')), 'el preload lo expone');
        t.ok(/ipcMain\.handle\('preguntar'/.test(leer('main.js')), 'y el main lo atiende');
    });

    t.test('a 900 px los rótulos pasan a su forma corta, y nada se esconde', () => {
        // La barra iba al límite exacto a 900 px, que es el ancho mínimo de la
        // ventana: los dos rótulos pedían 145 px más de los que había. Lo que
        // cede está medido y escrito en el CSS; lo que no puede pasar es que se
        // resuelva recortando con puntos suspensivos —«Auto · ES» cortado por
        // la derecha se come justo el idioma— ni escondiendo un número.
        const css = leer('src', 'css', 'style.css');
        const estrecho = tramo(css, '@media (max-width: 1100px) {', '\n}\n');
        t.ok(/\.rotulo-ancho \{\s*display: none;/.test(estrecho), 'se va la forma larga');
        t.ok(/\.rotulo-angosto \{\s*display: inline;/.test(estrecho), 'y entra la corta');
        t.ok(!/display: none/.test(estrecho.replace(/\.rotulo-ancho \{[^}]*\}/, '')),
            'y no se esconde nada más: ni el timecode, ni el estado, ni los contadores');
        // Los dos rótulos tienen que traerla: sin ella se repite la larga, la
        // fila vuelve a desbordarse a 900 px y nadie se entera hasta medirla.
        t.eq((rotulos.match(/\n\s+corto:/g) || []).length, 2,
            'los dos rótulos dicen cuál es su forma corta');
        // Los dos textos van en el documento, no se elige uno al dibujar: así
        // el tooltip, el `aria` y el menú son los mismos a cualquier ancho.
        const fn = tramo(leer('src', 'js', 'grabar', 'rotulo-barra.js'), 'export function rotulo(r) {', '\n}');
        t.ok(/rotulo-ancho/.test(fn) && /rotulo-angosto/.test(fn));
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
