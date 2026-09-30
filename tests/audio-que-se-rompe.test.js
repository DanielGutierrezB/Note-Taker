'use strict';
/**
 * El audio que se rompe en medio de la clase, y que no se veía en ninguna parte.
 *
 * `engine/audio-app.js` avisa `{tipo:'error'}` cuando el procesado de un pedazo
 * de PCM revienta, y ese aviso no lo atendía nadie: el puente no lo anotaba y
 * `src/js/grabar/fuente.js` lo dejaba pasar de largo. Visto desde la silla, la
 * app seguía diciendo «escuchando», el medidor seguía moviéndose y el ayudante
 * seguía vivo — y los pedazos que reventaron NO se escribieron, así que al WAV
 * le falta ese trozo y todo lo que viene detrás queda corrido contra la cámara.
 * En una clase de dos horas eso se descubría al abrir el XML.
 *
 * Lo que se prueba es que ahora se entera en el momento y que se queda a la
 * vista: una tostada de cuatro segundos, sola, no alcanza para algo que puede
 * pasar mientras nadie está mirando la pantalla.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const audioApp = require('../engine/audio-app');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const MUESTRAS_POR_PEDAZO = 4096;

module.exports = async t => {
    const estados = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'estados.js')).href);

    t.group('audio roto · el motor lo grita y el audio sigue saliendo');

    t.test('un pedazo que revienta al procesarse se avisa y no para la escucha', () => {
        const avisos = [];
        let cuantos = 0;
        audioApp._conectar({
            alPcm: () => { cuantos++; throw new Error('ENOSPC: no queda sitio en el disco'); },
            avisar: a => avisos.push(a),
            mandando: true
        });
        // Dos pedazos: el primero revienta y el segundo tiene que llegar igual.
        // Que el aviso cortara la escucha sería cambiar un agujero por el
        // resto de la clase.
        audioApp.recibir(Buffer.alloc(MUESTRAS_POR_PEDAZO * 2 * 2));
        t.eq(cuantos, 2, 'se le siguió dando audio');
        const rotos = avisos.filter(a => a.tipo === 'error');
        t.eq(rotos.length, 2, 'y cada uno se avisó');
        t.ok(/ENOSPC/.test(rotos[0].mensaje), 'con el motivo de verdad, no con uno inventado');
        audioApp.cerrar();
    });

    t.test('y va al registro, que es lo que al día siguiente lo explica', () => {
        const puente = leer('ipc', 'grabar.js');
        const lista = puente.match(/\[('[a-z]+',? ?)+\]\.includes\(aviso\.tipo\)/);
        t.ok(lista, 'la lista de lo que se anota existe');
        t.ok(/'error'/.test(lista[0]),
            'y el pedazo que no se escribió está en ella: sin esto, un WAV más corto que la ' +
            'clase no tiene explicación en ninguna parte');
    });

    t.group('audio roto · la ventana se entera');

    t.test('`fuente.js` por fin atiende el aviso', () => {
        const js = leer('src', 'js', 'grabar', 'fuente.js');
        t.ok(/aviso\.tipo === 'error'/.test(js), 'lo reconoce');
        t.ok(/avisos\.alRomperse\(aviso\.mensaje\)/.test(js), 'y lo pasa con su motivo');
        t.ok(/alRomperse: \(\) => \{\}/.test(js),
            'con un vacío por defecto, como los otros tres avisos');
    });

    t.test('la pantalla que abre la entrada lo guarda y lo dice una sola vez', () => {
        const js = leer('src', 'js', 'pantalla-preparar.js');
        const desde = js.indexOf('alRomperse: (mensaje, cuantos) =>');
        const cuerpo = js.slice(desde, js.indexOf('\n        }', desde));
        t.ok(desde > 0, 'la función está');
        t.ok(/audio\.roto = \{/.test(cuerpo),
            'queda en el estado del audio, que es lo que se queda a la vista');
        t.ok(/const primera = !audio\.roto/.test(cuerpo),
            'y la tostada sale una vez: puede reventar doce veces por segundo');
        t.ok(/if \(primera\) avisar\(/.test(cuerpo), 'pero sale, para enterarse en el momento');
        t.ok(/cuantos != null \? cuantos/.test(cuerpo),
            'y acepta la cuenta ya hecha, que es como llega la del micrófono');
    });

    t.test('una entrada nueva arranca sin lo que perdió la anterior', () => {
        const js = leer('src', 'js', 'pantalla-preparar.js');
        t.eq([...js.matchAll(/roto: null/g)].length, 4,
            'el estado inicial, las dos aperturas y el salir');
    });

    t.group('audio roto · el del micrófono, que no pasa por Zoom');

    t.test('el puente lo cuenta y lo dice en vez de tragárselo', () => {
        const puente = leer('ipc', 'grabar.js');
        const desde = puente.indexOf('function pcmRoto(');
        const cuerpo = puente.slice(desde, puente.indexOf('\n    }', desde));
        t.ok(desde > 0, 'hay un sitio donde se atiende y no solo un catch mudo');
        t.ok(/pcm\.veces\+\+/.test(cuerpo), 'los cuenta todos');
        t.ok(/send\('grabar-aviso', \{ tipo: 'audio-roto'/.test(cuerpo),
            'y cruza el puente: antes solo iba al diario y la clase se perdía en silencio');
        t.ok(/veces: pcm\.veces/.test(cuerpo), 'con la cuenta acumulada');
    });

    t.test('y los espacia, porque revientan doce por segundo', () => {
        const puente = leer('ipc', 'grabar.js');
        t.ok(/const AVISO_DE_PCM_MS = \d+/.test(puente), 'hay una cadencia declarada');
        const desde = puente.indexOf('function pcmRoto(');
        const cuerpo = puente.slice(desde, puente.indexOf('\n    }', desde));
        t.ok(/pcm\.veces > 1 && ahora - pcm\.avisadoMs < AVISO_DE_PCM_MS\) return/.test(cuerpo),
            'el primero sale en el acto y los demás cada tanto');
        t.ok(/anotar\('grabar\.pcm-falla'/.test(cuerpo),
            'el diario sigue estando, con la misma cadencia');
    });

    t.test('cada sesión arranca con su cuenta en cero', () => {
        const puente = leer('ipc', 'grabar.js');
        t.eq([...puente.matchAll(/^\s+olvidarPcmRoto\(\);$/gm)].length, 2,
            'las dos puertas por las que se empieza a grabar: iniciar y reanudar');
    });

    t.test('la ventana lo lleva a la misma pastilla que el de Zoom', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/aviso\.tipo === 'audio-roto'/.test(vivo), 'lo reconoce');
        t.ok(/fuente\.seRompio\(aviso\.mensaje, aviso\.veces\)/.test(vivo),
            'y lo manda por donde ya iba el de Zoom, con la cuenta puesta');
        const fuente = leer('src', 'js', 'grabar', 'fuente.js');
        t.ok(/export function seRompio\(mensaje, veces\)/.test(fuente));
        t.ok(/avisos\.alRomperse\(mensaje, veces\)/.test(fuente));
    });

    t.group('audio roto · lo que se ve en la barra');

    t.test('la sesión lo dice en rojo y con su palabra', () => {
        const e = estados.deSesion({ segundos: 300 },
            { abierto: true, roto: { mensaje: 'ENOSPC', veces: 1 } });
        t.eq(e.palabra, 'audio perdido', 'no «escuchando», que es lo que decía');
        t.eq(e.clave, 'sin audio', 'en rojo, como todo lo que le pasa al audio');
        t.ok(/no llegó al WAV/.test(e.porque), 'y explica qué se perdió');
        t.ok(/ENOSPC/.test(e.porque), 'con el motivo de verdad');
        t.ok(/reanudar/.test(e.porque), 'y qué hacer, que es lo que un aviso tiene que dar');
    });

    t.test('manda sobre «sin audio»: una entrada caída se nota y esto no', () => {
        const e = estados.deSesion({ segundos: 300 },
            { abierto: true, caido: true, roto: { mensaje: 'ENOSPC', veces: 3 } });
        t.eq(e.palabra, 'audio perdido');
        t.ok(/3 pedazos/.test(e.porque), 'y dice cuántos: uno es un tropiezo, mil es la clase');
    });

    t.test('sin nada roto, la barra dice lo de siempre', () => {
        t.eq(estados.deSesion({ segundos: 300 }, { abierto: true }).palabra, 'escuchando');
        t.eq(estados.deSesion({ segundos: 300 }, { abierto: true, caido: true }).palabra,
            'sin audio');
    });

    t.test('la explicación llega al renglón, que hasta ahora no tenía ninguna', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = js.slice(js.indexOf('function pintarBarra()'),
            js.indexOf('\n}', js.indexOf('function pintarBarra()')));
        t.ok(/#vivo-estado'\)\.title = est\.porque/.test(cuerpo),
            '«audio perdido» en dos palabras no se entiende solo');
    });

    t.test('y el rojo sale del CSS por la misma clave que las demás', () => {
        const css = leer('src', 'css', 'style.css');
        t.ok(css.includes(".pastilla[data-estado='sin audio']"), 'la clave ya tiene color');
    });
};
