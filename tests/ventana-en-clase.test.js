'use strict';
/**
 * La ventana durante la clase: lo que se rompía con el uso y no en el motor.
 *
 *   · un botón tocado con el mouse se quedaba con el foco, y el Enter siguiente
 *     lo volvía a apretar en vez de abrir o cerrar la toma;
 *   · dos aperturas de entrada solapadas dejaban dos capturas abiertas;
 *   · Preparar mostraba la visita anterior con Iniciar habilitado mientras
 *     cargaba;
 *   · la cámara elegida desde la barra quedaba encendida después de la clase;
 *   · un borde que el motor rechazaba quedaba dibujado donde se soltó;
 *   · la nota no se guardaba si el repintado había reemplazado el campo.
 *
 * Lo que necesita un navegador de verdad (el foco, el arrastre) se comprobó
 * en la maqueta; acá queda escrita la regla, para que no vuelva.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const esperar = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function (t) {
    t.group('la ventana en clase · el foco del mouse');

    t.test('un clic de mouse en un botón de En vivo le devuelve el foco a la pantalla', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        const desde = js.indexOf("document.addEventListener('click', e => {");
        t.ok(desde > 0, 'en el documento, para deshacer y Compacto, que viven en barras distintas');
        const cuerpo = js.slice(desde, js.indexOf('}, true);', desde));
        t.ok(/e\.detail === 0\) return;/.test(cuerpo), 'solo con el mouse: con el teclado el foco es de quien navega');
        t.ok(/\$\('#vista-vivo'\)\.focus\(\{ preventScroll: true \}\)/.test(cuerpo));
        t.ok(/!boton\.closest\('\.telon'\)/.test(cuerpo), 'y no adentro de Ajustes');
    });

    t.group('la ventana en clase · las aperturas de entrada, de a una');

    t.test('dos aperturas seguidas: la primera se cierra, la segunda queda, y la primera dice que la reemplazaron', async () => {
        const abiertas = [];
        let cerradas = 0;
        global.window = {
            nt: {
                audioAppAbrir: async ({ modo }) => {
                    await esperar(20);
                    abiertas.push(modo);
                    return { ok: true, sampleRate: 48000, canales: 1 };
                },
                audioAppCerrar: async () => { await esperar(5); cerradas++; }
            }
        };
        try {
            const fuente = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'fuente.js')).href);
            const [a, b] = await Promise.all([
                fuente.abrir({ tipo: 'app', modo: 'sistema', nombre: 'A' }),
                fuente.abrir({ tipo: 'app', modo: 'app', nombre: 'B' })
            ]);
            t.eq(a.reemplazada, true, 'la primera no la abre nadie');
            t.ok(b.ok, 'la segunda sí');
            t.deep(abiertas, ['app'], 'una sola captura, la que se eligió última');
            t.eq(fuente.comoSuena().dispositivo, 'B');
            await fuente.cerrar();
            t.eq(cerradas, 1, 'y al cerrar no queda ninguna');
        } finally {
            delete global.window;
        }
    });

    t.test('«mandar» pedido mientras abre llega a la entrada nueva, no a la vieja', async () => {
        const mandados = [];
        global.window = {
            nt: {
                audioAppAbrir: async () => { await esperar(20); return { ok: true, sampleRate: 48000, canales: 1 }; },
                audioAppCerrar: async () => {},
                audioAppMandar: async si => { mandados.push(si); }
            }
        };
        try {
            const fuente = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'fuente.js')).href + '?mandar');
            const abriendo = fuente.abrir({ tipo: 'app', modo: 'app', nombre: 'Zoom' });
            await fuente.empezarAMandar();
            t.deep(mandados, [], 'todavía no hay entrada a la que mandarle');
            await abriendo;
            t.deep(mandados, [true], 'y apenas abre, manda');
            await fuente.cerrar();
        } finally {
            delete global.window;
        }
    });

    t.test('Preparar descarta la respuesta de una apertura reemplazada', () => {
        const js = leer('src', 'js', 'pantalla-preparar.js');
        t.ok(/if \(r\.reemplazada\) return r;/.test(js));
        t.eq((js.match(/\.reemplazada\) return \{ ok: true, estado: null \};/g) || []).length, 2,
            'y un cambio de entrada grabando, reemplazado, no le avisa al motor de la que se cerró');
    });

    t.group('la ventana en clase · Preparar mientras carga');

    t.test('Iniciar queda apagado y la lista dice que está revisando hasta que todo está medido', () => {
        const js = leer('src', 'js', 'pantalla-preparar.js');
        const ver = js.slice(js.indexOf('export async function ver('), js.indexOf('async function entrar()'));
        t.ok(/cargando = true;\s+pintar\(\);\s+verVista\('vista-preparar'\);/.test(ver), 'apagado ANTES de mostrar la pantalla');
        t.ok(/finally \{\s+cargando = false;\s+pintar\(\);/.test(ver));
        const pintar = js.slice(js.indexOf('function pintar() {'), js.indexOf('const a = estados.deAudio(audio);'));
        t.ok(/if \(cargando\) \{[\s\S]*boton\.disabled = true;[\s\S]*return;/.test(pintar));
        t.ok(/async function iniciar\(\) \{\s+if \(cargando \|\| audio\.abriendo\) return;/.test(js), 'y un clic que llegue igual no arranca nada');
        t.ok(/c\.listo === 'si' && !audio\.abriendo;/.test(js), 'ni mientras abre una entrada: grababa sin audio');
    });

    t.group('la ventana en clase · la cámara');

    t.test('la vista previa de Ajustes se pide solo con Ajustes abierto', () => {
        const js = leer('src', 'js', 'app.js');
        const poner = js.slice(js.indexOf('async function ponerCamara('), js.indexOf('async function camarasParaElegir('));
        t.ok(/if \(\$\('#telon-ajustes'\)\.classList\.contains\('es-activa'\)\) await verLaCamara\(\);/.test(poner),
            'desde la barra nadie soltaba a «ajustes» y la cámara seguía encendida');
    });

    t.group('la ventana en clase · el borde soltado');

    t.test('un texto con una línea soltada no se reutiliza: se dibuja con lo que contestó el motor', () => {
        const js = leer('src', 'js', 'grabar', 'texto-toma.js');
        const crecer = js.slice(js.indexOf('function crecer(previo, p) {'));
        t.ok(/if \(previo\.querySelector\('\.es-guardando'\)\) return false;/.test(crecer));
        t.ok(/b\.classList\.add\('es-guardando'\);/.test(js), 'la marca la pone quien suelta');
    });

    t.group('la ventana en clase · la nota');

    t.test('se guarda al salir del campo, si no es la que el motor ya tiene', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/addEventListener\('focusout', alSalirDeLaNota\)/.test(js));
        t.ok(!/addEventListener\('change', alCambiar\)/.test(js), 'ya no con change');
        const cuerpo = js.slice(js.indexOf('async function alSalirDeLaNota('), js.indexOf('/**', js.indexOf('async function alSalirDeLaNota(')));
        t.ok(/if \(!campo\.isConnected\) return;/.test(cuerpo), 'el campo que reemplazó el repintado no cuenta como salir');
        t.ok(/\(toma\.comentario \|\| ''\) === campo\.value\) return;/.test(cuerpo));
    });
};
