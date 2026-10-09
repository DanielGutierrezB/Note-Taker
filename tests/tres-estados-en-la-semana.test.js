'use strict';
/**
 * Mantener, Desactivar y Descartar en el vídeo de la semana, y el deshacer.
 *
 * El vídeo de la semana tenía un botón que alternaba entre dos —«Dejarla
 * fuera» y «Volver a usarla»—, así que la única manera de dar por perdida una
 * toma era dejarla tachada en la lista. Quien graba su vídeo lo pidió al revés:
 * «quitar mientras van haciendo su video y mantenerlo limpio». Son los tres
 * estados que la clase ya tenía, que son los tres que el motor ya sabía hacer
 * (`cambios-toma.js`): lo que faltaba era la pantalla.
 *
 * Lo que se prueba acá es lo que puede salir mal sin que se note mirando:
 *
 *   · Que Descartar aparezca donde NO se puede deshacer. Ahí no es el mismo
 *     botón aunque se llame igual: una sesión cerrada se relee del archivo en
 *     cada gesto y no tiene pila, así que lo que saca no vuelve. Vale para las
 *     dos pantallas, porque la de clase lo tenía puesto y lo único que
 *     conseguía era un error de `aplicar`.
 *   · Que ⌘Z no llegue. El portero del teclado de la semanal apaga todo lo que
 *     lleve ⌘, y una tecla que no llega convierte a Descartar en definitivo.
 *   · Que los dos botones nuevos lleven `id`: la pantalla de clase busca los
 *     suyos por `#btn-deshacer` en TODO el documento.
 *
 * Los tres se comprueban contra el texto de los archivos y no contra el DOM
 * porque estos módulos tocan `document` al importarse. `estados-toma.js` no:
 * ese se importa y se le mira lo que devuelve.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

module.exports = async t => {
    const control = await import(pathToFileURL(
        path.join(RAIZ, 'src', 'js', 'grabar', 'estados-toma.js')).href);

    t.group('los tres estados · el control compartido');

    t.test('los tres botones, cada uno con su toma', () => {
        const html = control.estadosDe({ id: 7, descartada: false });
        for (const hace of ['mantener', 'desactivar', 'descartar']) {
            t.ok(html.includes(`data-hace="${hace}" data-toma="7"`), `está ${hace}, y es de la 7`);
        }
    });

    t.test('marca el estado en el que está, y solo uno', () => {
        const viva = control.estadosDe({ id: 1, descartada: false });
        t.ok(/data-hace="mantener"[^>]*aria-pressed="true"/s.test(viva), 'una que cuenta: Mantener');
        t.ok(/data-hace="desactivar"[^>]*aria-pressed="false"/s.test(viva), 'y Desactivar suelto');

        const fuera = control.estadosDe({ id: 1, descartada: true });
        t.ok(/data-hace="mantener"[^>]*aria-pressed="false"/s.test(fuera), 'una desactivada: al revés');
        t.ok(/data-hace="desactivar"[^>]*aria-pressed="true"/s.test(fuera));
    });

    t.test('sin deshacer no hay Descartar', () => {
        // Es la regla entera: Descartar no pregunta, y lo que lo hace seguro es
        // ⌘Z. Donde no hay ⌘Z es otro botón.
        const html = control.estadosDe({ id: 3 }, { sePuedeDeshacer: false });
        t.ok(html.includes('data-hace="mantener"') && html.includes('data-hace="desactivar"'),
            'quedan los dos que se desandan apretando el otro');
        t.ok(!html.includes('data-hace="descartar"'), 'y Descartar no está');
    });

    t.test('cada pantalla dice adónde va la toma, con su propia palabra', () => {
        t.ok(control.estadosDe({ id: 1 }, { donde: 'en el vídeo' }).includes('title="Va en el vídeo"'),
            'en la semana se va al vídeo');
        t.ok(control.estadosDe({ id: 1 }, { donde: 'al XML' }).includes('title="Va al XML"'),
            'y en la clase al XML, que es lo que se abre en Premiere');
    });

    t.group('los tres estados · las dos pantallas lo usan');

    const laClase = () => leer('src', 'js', 'pantalla-vivo.js');
    const laSemana = () => leer('src', 'js', 'pantalla-semanal.js');
    const lasTarjetas = () => leer('src', 'js', 'semanal', 'tarjetas.js');

    t.test('ninguna se quedó con su propia copia de los botones', () => {
        for (const [quien, codigo] of [['clase', laClase()], ['semana', lasTarjetas()]]) {
            t.ok(/import \* as estadosToma from '\.\.?\/grabar\/estados-toma\.js'/.test(codigo),
                `${quien}: importa el control`);
            t.ok(!/data-hace="desactivar"/.test(codigo),
                `${quien}: y no escribe los botones a mano`);
        }
    });

    t.test('grabando sí se puede descartar, en el editor no', () => {
        const tarjetas = lasTarjetas();
        t.ok(/botonFuera\(t, true\)/.test(tarjetas),
            'la ficha de mientras se graba pide los tres');
        t.ok(/sePuedeDeshacer: grabando === true/.test(tarjetas),
            'y es `true` explícito: un argumento que falta no enciende Descartar');
        t.ok(/estadosToma\.estadosDe\(t, \{ donde: 'al XML', sePuedeDeshacer: !esDeMirar\(\) \}\)/
            .test(laClase()),
            'y la clase cerrada tampoco lo ofrece, que antes daba error');
    });

    t.test('los tres botones piden lo que el motor entiende', () => {
        const semana = laSemana();
        t.ok(/hace === 'mantener'\) return cambiarFicha\(Number\(boton\.dataset\.toma\),\s*\{ tipo: 'descartar', descartada: false \}/
            .test(semana), 'Mantener la vuelve a meter');
        t.ok(/hace === 'desactivar'\) return cambiarFicha\(Number\(boton\.dataset\.toma\),\s*\{ tipo: 'descartar', descartada: true \}/
            .test(semana), 'Desactivar la deja fuera del vídeo, en la sesión');
        t.ok(/hace === 'descartar'\) return descartar\(/.test(semana),
            'y Descartar pasa por su función, que es la que avisa');
        t.ok(/descartar\(id\)[\s\S]{0,400}cambiarFicha\(id, \{ tipo: 'eliminar' \}\)/.test(semana),
            'y pide `eliminar`, que es como se llama en el motor');
    });

    t.test('descartar no pregunta, pero dice con qué tecla se vuelve', () => {
        const semana = laSemana();
        t.ok(!/confirm\(/.test(semana), 'ningún cartel que leer con la cámara encendida');
        t.ok(/avisar\(`Toma \$\{id\} descartada\. ⌘Z la devuelve\.`\)/.test(semana),
            'el aviso nombra la tecla');
        // El motor se planta con la toma abierta, así que el aviso tiene que
        // mirar si de verdad se fue: decir «descartada» de una que sigue ahí es
        // peor que no decir nada.
        t.ok(/descartar\(id\)[\s\S]{0,400}\.some\(t => t\.id === id\)\) return;/.test(semana),
            'y solo si la toma se fue de la lista');
    });

    t.group('los tres estados · deshacer y rehacer en la semana');

    t.test('⌘Z pasa antes del portero que apaga las teclas con ⌘', () => {
        const semana = laSemana();
        const teclado = semana.slice(semana.indexOf('async function alTeclado'));
        const zeta = teclado.indexOf("e.key.toLowerCase() === 'z'");
        const portero = teclado.indexOf('e.metaKey || e.ctrlKey || e.altKey) return');
        t.ok(zeta > 0 && portero > 0, 'están los dos');
        t.ok(zeta < portero, 'y la tecla llega antes de que la apaguen');
        // Y la condición entera, no solo dónde está: dejarla puesta y apagada
        // —un `meta` que ya no se mira— pasaba la prueba de arriba y no
        // deshacía nada, que es justo el fallo que la tecla tiene que impedir.
        t.ok(/const meta = e\.metaKey \|\| e\.ctrlKey;/.test(teclado), 'mira ⌘ y Ctrl');
        t.ok(/if \(meta && e\.key\.toLowerCase\(\) === 'z' && hayHistoria\(\)\) \{/.test(teclado),
            'y la tecla es ⌘Z de verdad');
        t.ok(/volver\(e\.shiftKey \? 'rehacer' : 'deshacer'\)/.test(teclado),
            'con ⇧ rehace, como en la clase');
    });

    t.test('la tecla y los botones preguntan lo mismo', () => {
        // Dos condiciones parecidas se separan: una dejaría el botón apagado
        // donde la tecla sí funciona, o al revés.
        const semana = laSemana();
        t.ok(/function hayHistoria\(\)[\s\S]{0,200}estado\.paso === 'grabando'/.test(semana),
            'solo grabando, que es donde el motor tiene la pila');
        t.ok(/'z' && hayHistoria\(\)/.test(semana), 'la tecla pregunta por ahí');
    });

    t.test('los botones de la semana no se llaman como los de la clase', () => {
        // `pantalla-vivo.js` hace `$('#btn-deshacer')`, que busca en todo el
        // documento: un id repetido le daría el botón del otro modo.
        const historia = lasTarjetas().slice(lasTarjetas().indexOf('function laHistoria'));
        t.ok(/data-hace="\$\{hace\}"/.test(historia), 'se encuentran por `data-hace`');
        t.ok(!/id="btn-deshacer"|id="btn-rehacer"/.test(historia), 'y no llevan id');
        t.ok(/hace === 'deshacer' \|\| hace === 'rehacer'\) return volver\(hace\)/.test(laSemana()),
            'y el clic entra por la misma puerta que la tecla');
    });

    t.test('el botón dice qué va a deshacer, o que no hay nada', () => {
        const historia = lasTarjetas();
        t.ok(/hay \? `\$\{verbo\} «\$\{esc\(que\)\}»` : `No hay nada que \$\{verbo\.toLowerCase\(\)\}`/
            .test(historia), 'el título lleva el nombre del paso');
        t.ok(/\$\{hay \? '' : 'disabled'\}/.test(historia), 'y sin pasos queda apagado');
    });

    t.test('deshacer repinta la sesión de la semana, no la de la clase', () => {
        // `estado` acá es la pantalla entera y la sesión cuelga de `estado.sesion`;
        // en la clase `estado` ES la sesión. Copiar la línea de allá dejaba la
        // pantalla pintando un estado sin `paso`.
        t.ok(/async function volver\(cual\)[\s\S]{0,600}estado\.sesion = r\.estado; pintar\(\)/
            .test(laSemana()));
    });
};
