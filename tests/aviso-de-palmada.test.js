'use strict';
/**
 * El aviso de la palmada, en sus dos estados.
 *
 * Esto existe por un silencio que costó una tarde de desconfianza: el motor
 * avisaba `{tipo:'golpe'}` en cuanto oía una palmada y NADIE lo recibía, así que
 * aplaudir no movía nada en la pantalla hasta que la confirmación volvía de
 * Whisper seis segundos después — y si Whisper escribía la palabra de otra
 * manera, no movía nada nunca. El 30/09 salieron «La quinta» y «Tlajeta clase
 * 4»: dos claquetas de verdad que no se anotaron y que el editor no podía ver
 * que no se habían anotado. De ahí «aún no está reconociendo la claqueta».
 *
 * Lo que se prueba es que el aviso no MIENTA, que es lo único que lo haría peor
 * que no tenerlo:
 *
 *   · Que no diga «sin confirmar» antes de que el motor haya podido contestar.
 *     Necesita `PALABRA_Y_APLAUSO_MS` de audio DETRÁS del aplauso para leer, y
 *     acusarlo antes sería enseñarle al editor a no creerle al aviso.
 *   · Que no se quede esperando para siempre cuando la confirmación no llega.
 *   · Que el tiempo se cuente en audio GRABADO y no en reloj de pared: con el
 *     audio atrasado, el motor todavía no pudo leer y no tiene culpa de nada.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

module.exports = async t => {
    const estados = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'estados.js')).href);
    const senales = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'senales.js')).href);

    t.group('palmada · lo que dice en cada estado');

    t.test('sin palmada pendiente no dice nada', () => {
        t.eq(estados.dePalmada(null), null, 'la pastilla no está');
    });

    t.test('recién oída dice que oyó y que está esperando la palabra', () => {
        const e = estados.dePalmada({ ms: 30000 });
        t.eq(e.palabra, 'palmada oída', 'dice lo que pasó, no lo que va a pasar');
        t.eq(e.clave, 'por confirmar', 'en ámbar: ni hecho ni fallado');
        t.ok(/K/.test(e.porque), 'y dice qué hacer si ya se sabe que era una claqueta');
    });

    t.test('sin confirmar lo dice, y avisa que la K ya no cae en la palmada', () => {
        const e = estados.dePalmada({ ms: 30000, sinConfirmar: true });
        t.eq(e.palabra, 'palmada sin confirmar', 'no se calla ni finge que se anotó');
        t.eq(e.clave, 'sin confirmar', 'en rojo, como cualquier cosa que no salió');
        t.ok(/no en la palmada/.test(e.porque),
            'la marca a mano cae donde se aprieta, y eso no se esconde');
    });

    t.test('los dos estados son la misma pastilla, con las palabras del proyecto', () => {
        // WCAG 1.4.1: el color no es el único canal, así que cada estado tiene su
        // palabra escrita. Y la clave es el `data-estado` del CSS.
        const css = leer('src', 'css', 'style.css');
        for (const p of [{ ms: 1 }, { ms: 1, sinConfirmar: true }]) {
            const e = estados.dePalmada(p);
            t.ok(css.includes(`.pastilla[data-estado='${e.clave}']`), `${e.clave} tiene color`);
            t.ok(e.palabra && e.porque, `${e.clave} tiene palabra y explicación`);
        }
    });

    t.group('palmada · cuándo se puede decir que no se confirmó');

    t.test('el motor no puede confirmar antes de tener el audio de después', () => {
        t.eq(senales.PALABRA_Y_APLAUSO_MS, 6000, 'los segundos que el motor necesita detrás');
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf('function palmadaVencida()'),
            codigo.indexOf('\n}', codigo.indexOf('function palmadaVencida()')));
        t.ok(/PALABRA_Y_APLAUSO_MS \+ LECTURA_DE_PALMADA_MS/.test(cuerpo),
            'se esperan los dos: el audio que le falta y la pasada de Whisper');
        t.ok(/estado\.segundos/.test(cuerpo),
            'y se cuentan con el audio grabado, que es el reloj con el que el motor lee');
        t.ok(!/Date\.now/.test(cuerpo),
            'no con el reloj de pared: el audio atrasado no es culpa del motor');
    });

    t.test('la cuenta da un margen y no dispara al filo', () => {
        // Reconstruida acá para poder moverla sin abrir una ventana: es la misma
        // resta de `palmadaVencida`.
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const lectura = Number(codigo.match(/const LECTURA_DE_PALMADA_MS = (\d+);/)[1]);
        const vencida = (palmadaMs, grabadoHasta) =>
            grabadoHasta >= palmadaMs + senales.PALABRA_Y_APLAUSO_MS + lectura;
        t.ok(lectura >= 3000, 'la pasada de Whisper tiene tiempo de contestar');
        t.ok(!vencida(30000, 35000), 'a los 5 s el motor todavía no tiene el audio: se espera');
        t.ok(!vencida(30000, 36500), 'recién ahí empieza a leer: tampoco se lo acusa');
        t.ok(vencida(30000, 30000 + 6000 + lectura), 'pasado el margen, se dice que no se confirmó');
    });

    t.group('palmada · el ciclo se cierra');

    t.test('una claqueta anotada borra la palmada que la esperaba', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf("if (aviso.tipo === 'claqueta')"),
            codigo.indexOf("if (aviso.tipo === 'golpe')"));
        t.ok(/palmada = null/.test(cuerpo), 'la que se confirmó deja de estar pendiente');
    });

    t.test('el aviso de golpe del motor por fin lo recibe alguien', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/aviso\.tipo === 'golpe'/.test(codigo), 'la ventana atiende el golpe');
        const motor = leer('engine', 'grabacion.js');
        t.ok(/tipo: 'golpe'/.test(motor), 'que es el que el motor manda');
        t.ok(/tipo: 'golpe', ms:/.test(motor), 'con el ms de la palmada, que es lo que se usa');
    });

    t.test('se revisa solo, y en rojo, una vez', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf('function pintarPalmada()'),
            codigo.indexOf('\n}\n', codigo.indexOf('function pintarPalmada()')));
        t.ok(/palmada\.dicho/.test(cuerpo), 'la tostada sale una vez y no en cada repintado');
        t.ok(/'error'/.test(cuerpo), 'y sale en rojo, como su mitad simétrica');
        t.ok(/pintarPalmada\(\);/.test(codigo.slice(codigo.indexOf('function pintarBarra()'),
            codigo.indexOf('function pintar()'))),
        'lo mira la barra que se refresca sola: el vencimiento pasa sin que el motor avise');
    });

    t.test('una sesión nueva no arrastra la palmada de la anterior', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf('export function ver('),
            codigo.indexOf('\n}', codigo.indexOf('export function ver(')));
        t.ok(/palmada = null/.test(cuerpo), 'se limpia al entrar');
    });

    t.test('aparecer no le mueve el sitio a ningún atajo', () => {
        // Medido: puesta antes de los atajos, aparecer los corría 136 px, y al
        // desaparecer un clic apuntado a «abrir toma» caía en el de las vistas.
        const html = leer('src', 'index.html');
        const atajos = html.slice(html.indexOf('id="vivo-atajos"'),
            html.indexOf('</div>', html.indexOf('id="vivo-atajos"')));
        t.ok(/id="vivo-palmada"/.test(atajos), 'vive en la fila de la K, que es la que la arregla');
        t.ok(atajos.lastIndexOf('<button') < atajos.indexOf('id="vivo-palmada"'),
            'después del último botón: lo único que cede es el hueco elástico');
        t.ok(atajos.indexOf('id="vivo-palmada"') < atajos.indexOf('class="crece"'),
            'y antes del hueco, para no quedar tirada junto a la ruta');
        t.ok(/<span class="pastilla" id="vivo-palmada"/.test(atajos),
            'es un span: no se puede apretar, no es una tercera puerta a la claqueta');
    });
};
