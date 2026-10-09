'use strict';
/**
 * La mirilla: la ventanita flotante donde te ves mientras grabás.
 *
 * Quien graba su vídeo de la semana no se ve, y su cámara va en una esquina
 * tapando un pedazo de lo que enseña. Eso se descubría al día siguiente, con
 * el MP4 hecho y la caja que importaba debajo de una cara.
 *
 * Lo que se prueba acá es lo que puede salir mal SIN QUE SE NOTE mirando la
 * ventana, que es casi todo lo interesante:
 *
 *   · Que el recuadro no caiga donde va a caer en el vídeo. Si está en otro
 *     sitio o es de otro tamaño, la ventana miente, y una ventana que miente
 *     sobre esto es peor que no tenerla: te deja mover algo que no estorbaba.
 *     De ahí que la geometría se compare contra el EXPORTADOR, y no contra
 *     unos números copiados en esta prueba.
 *   · Que la mirilla se grabe a sí misma. Capturando la pantalla entera y sin
 *     `setContentProtection`, la cara sale dos veces: una en el fondo grabado
 *     y otra que `ffmpeg` pone encima. Medido antes de escribir nada.
 *   · Que le baje la resolución a la grabación de verdad. Dos ventanas pueden
 *     compartir la cámara, pero el formato lo negocia la primera: la mirilla
 *     abriendo antes y sin pedir tamaño dejaba el dispositivo en 640×480 y la
 *     grabación lo heredaba. También medido.
 *   · Que las dos ventanas lleven cada una su idea de qué vista va. La mirilla
 *     es un espejo y un mando: no decide nada.
 */

const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const mirilla = require('../ipc/mirilla');

module.exports = function (t) {

    t.group('la mirilla · dónde cae');

    t.test('en un monitor 16:9 el recuadro es el del vídeo, al píxel', () => {
        // El export es 1920×1080 con la cámara de 360 y 48 de margen, así que
        // en un monitor de ese mismo tamaño los números tienen que coincidir
        // exactamente: es la correspondencia que la ventana promete.
        const s = mirilla.sitioEn({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
        t.deep(s, { x: 1512, y: 672, width: 360, height: 360 },
            'misma esquina y mismo lado que en el MP4');
    });

    t.test('en un monitor más grande crece con él, en proporción', () => {
        const s = mirilla.sitioEn({ bounds: { x: 0, y: 0, width: 2056, height: 1329 } });
        t.eq(s.width, Math.round(2056 * 360 / 1920), 'el lado es la misma fracción del ancho');
        t.eq(s.x + s.width, 2056 - Math.round(2056 * 48 / 1920), 'y se despega lo mismo');
    });

    t.test('en el segundo monitor va a SU esquina, no a la del primero', () => {
        // Las coordenadas de macOS son del escritorio entero, así que un
        // monitor a la izquierda tiene `x` negativa. Sumar mal acá pone la
        // ventana en el monitor de al lado, que es donde no sirve.
        const s = mirilla.sitioEn({ bounds: { x: -2056, y: 0, width: 2056, height: 1329 } });
        t.ok(s.x < -2056 + 2056, 'queda dentro de ese monitor');
        t.ok(s.x > -2056, 'y no se cae por la izquierda');
        t.eq(s.y + s.height, 1329 - Math.round(2056 * 48 / 1920), 'pegada a su borde de abajo');
    });

    t.test('un monitor chico no la deja más chica que una cara', () => {
        const s = mirilla.sitioEn({ bounds: { x: 0, y: 0, width: 400, height: 300 } });
        t.eq(s.width, mirilla.LADO_MINIMO, 'por debajo no se distingue nada y deja de servir');
    });

    t.test('la geometría es la MISMA que la del exportador', () => {
        // Son dos sitios diciendo el mismo número y no hay forma de que el
        // proceso principal lea el módulo del corte sin traerse medio
        // exportador. Que no se separen lo cuida esto.
        const exportador = leer('engine', 'exportar-video.js');
        for (const [nombre, valor] of [
            ['ANCHO', mirilla.CUADRO_ANCHO],
            ['CAMARA_LADO', mirilla.CAMARA_LADO],
            ['MARGEN', mirilla.MARGEN]
        ]) {
            const m = new RegExp(`const ${nombre} = (\\d+);`).exec(exportador);
            t.ok(m, `el exportador sigue teniendo ${nombre}`);
            t.eq(Number(m[1]), valor, `${nombre} dice lo mismo en los dos archivos`);
        }
    });

    t.group('la mirilla · en qué monitor se pone');

    t.test('la pista de una pantalla entera dice cuál es', () => {
        // `deviceId` viene como `screen:N:0` y esa N es el `display_id` de
        // `desktopCapturer`. Comprobado contra el sistema, no supuesto.
        t.eq(mirilla.monitorDe({ deviceId: 'screen:1:0' }, [{ display_id: '1' }]), '1');
    });

    t.test('compartiendo UNA ventana no se sabe, y se dice que no se sabe', () => {
        // Devolver un monitor inventado la mudaría a un sitio cualquiera. Y no
        // hace falta: compartiendo una ventana, la mirilla no entra nunca en
        // la captura, así que lo único que importa es que se vea.
        t.eq(mirilla.monitorDe({ deviceId: 'window:94:0' }, [{ display_id: '1' }]), null);
    });

    t.test('un monitor que ya no está no se usa', () => {
        // El selector del sistema puede dar un id que para cuando llega acá ya
        // no existe: desenchufar una pantalla entre una cosa y la otra.
        t.eq(mirilla.monitorDe({ deviceId: 'screen:7:0' }, [{ display_id: '1' }]), null);
    });

    t.test('sin pista tampoco se adivina', () => {
        t.eq(mirilla.monitorDe(null, []), null);
        t.eq(mirilla.monitorDe({}, []), null);
    });

    t.group('la mirilla · que no se grabe a sí misma');

    t.test('la ventana se marca como no compartible', () => {
        const src = leer('ipc', 'mirilla.js');
        t.ok(/ventana\.setContentProtection\(true\);/.test(src),
            'sin esto la cara sale dos veces en el vídeo: la grabada y la que pone ffmpeg');
    });

    t.test('queda encima hasta de una app en pantalla completa', () => {
        const src = leer('ipc', 'mirilla.js');
        t.ok(/setAlwaysOnTop\(true, 'screen-saver'\)/.test(src),
            'con «floating» se esconde debajo de una pantalla completa, que es cuando más falta hace');
        t.ok(/visibleOnFullScreen: true/.test(src), 'y en el escritorio donde estés');
    });

    t.group('la mirilla · la cámara');

    t.test('pide exactamente lo mismo que la grabación de verdad', () => {
        // La regla medida: dos ventanas comparten el dispositivo, pero el
        // formato lo negocia la primera. Pidiendo menos acá, la grabación de
        // allá sale peor.
        const ojo = leer('src', 'js', 'grabar', 'ojo.js');
        const suyo = /const ANCHO_TOPE = (\d+);/.exec(ojo);
        const nuestro = /const ANCHO_TOPE = (\d+);/.exec(leer('src', 'js', 'mirilla.js'));
        t.ok(suyo && nuestro, 'las dos siguen teniendo el tope');
        t.eq(nuestro[1], suyo[1], 'el mismo número en los dos sitios');
        t.ok(/deviceId: \{ exact: cual\.deviceId \}, width: \{ ideal: ANCHO_TOPE \}/
            .test(leer('src', 'js', 'mirilla.js')), 'y la misma forma de pedirlo');
    });

    t.test('no abre la cámara si no hay quien ya la tenga abierta', () => {
        const src = leer('src', 'js', 'mirilla.js');
        t.ok(/if \(!info\.camara\) return soltar\(/.test(src),
            'abriéndola primero, la de verdad hereda 640×480');
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/camara: ojo\.elStream\(\) \? \(estado\.camara && estado\.camara\.nombre\) \|\| null : null/
            .test(semanal),
            'y el nombre solo se manda con el stream ya abierto de este lado');
    });

    t.group('la mirilla · espejo, no segunda opinión');

    t.test('los tres botones piden, no hacen', () => {
        const src = leer('src', 'js', 'mirilla.js');
        t.ok(!/window\.nt\.grabar(Abrir|Cerrar|Editar)/.test(src),
            'la mirilla no le habla al motor: le habla a la semanal');
        t.ok(/window\.nt\.mirillaGesto\(\{ hace: 'vista'/.test(src), 'la vista se pide');
        t.ok(/window\.nt\.mirillaGesto\(\{ hace: 'toma'/.test(src), 'y la toma también');
    });

    t.test('los gestos entran por las mismas funciones que los botones de la semanal', () => {
        // Si abrieran una toma por otro camino, un día los dos caminos harían
        // cosas distintas: `bordeDeToma` espera al borde anterior en vuelo, y
        // `cambiarVista` le pone la vista a la toma abierta.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/onMirillaGesto\(g => \{[\s\S]*?cambiarVista\(g\.vista\);[\s\S]*?bordeDeToma\(\);/
            .test(semanal), 'las mismas dos funciones, y no copias');
    });

    t.test('el color del borde sale del motor, no de un rojo escrito a mano', () => {
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/const c = coloresDeVista\(estado\.vistas, vista\);/.test(semanal),
            'son los colores de los marcadores de Premiere: lo que ves es lo que verá el editor');
    });

    t.test('y antes de que lleguen las vistas no se cae', async () => {
        // `coloresDeVista` contesta `null` mientras el motor no contestó, y un
        // `.color` suelto tiraba en el PRIMER repintado de la pantalla: no la
        // mirilla, la pantalla entera.
        const { coloresDeVista } = await import(
            require('url').pathToFileURL(path.join(RAIZ, 'src', 'js', 'colores.js')).href);
        t.eq(coloresDeVista([], 'PV'), null, 'sigue contestando null');
        t.ok(/color: c \? c\.color : null,/.test(leer('src', 'js', 'pantalla-semanal.js')),
            'y se respeta en vez de pedirle `.color`');
        t.ok(/if \(info\.color\) document\.documentElement\.style\.setProperty/
            .test(leer('src', 'js', 'mirilla.js')), 'del otro lado tampoco se da por hecho');
    });

    t.test('la vista que muestra es la de la toma abierta, no la del próximo', () => {
        // Es la misma cuenta que hace la escena de la tarjeta: con una toma
        // abierta manda la suya, porque es la que se está grabando.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/const vista = abierta \? \(abierta\.vista \|\| estado\.vista\) : estado\.vista;/
            .test(semanal), 'igual que `escena`');
    });

    t.test('se cierra sola al terminar de grabar', () => {
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/if \(estado\.mirilla\) laMirilla\(false\);\n    estado\.paso = 'mirando';/
            .test(semanal), 'una ventana encima de todo y sin nada que grabar tapa el editor');
    });

    t.group('la mirilla · el monitor que se graba');

    t.test('se le cuenta el cambio de ventana, no solo la primera elección', () => {
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        const cambiar = /async function cambiarPantalla\(boton\)[\s\S]*?\n}/.exec(semanal);
        t.ok(cambiar, 'sigue existiendo el cambio de ventana a mitad de grabación');
        t.ok(/contarLaPantalla\(\);/.test(cambiar[0]),
            'cambiando a una ventana de otro monitor, la mirilla se muda con ella');
    });

    t.test('los monitores se escuchan al abrir y no al cargar main', () => {
        // `registrar` corre antes del `ready` de la app, y el módulo `screen`
        // de Electron no existe hasta entonces: engancharlos arriba rompía el
        // arranque entero.
        const src = leer('ipc', 'mirilla.js');
        const fuera = /^screen\.on\(/m.test(src);
        t.ok(!fuera, 'nada de `screen` en el cuerpo de registrar');
        t.ok(/function escucharMonitores\(\)[\s\S]*?screen\.on\('display-metrics-changed'/
            .test(src), 'se enganchan la primera vez que se abre');
    });

    t.group('la mirilla · el puente');

    t.test('las dos ventanas reciben lo que manda el motor', () => {
        const main = leer('main.js');
        t.ok(/if \(mirilla\) mirilla\.avisar\(channel, payload\);/.test(main),
            '`send` es el único sitio por donde sale todo, así que fanea acá');
    });

    t.test('se va con la ventana de la app', () => {
        // Sin marco y sin botón de cerrar, sola encima de todo y sin la app
        // que la abrió, no habría forma de quitársela de encima. Y en macOS la
        // app sigue viva después de cerrar su ventana, así que pasaría.
        const main = leer('main.js');
        t.ok(/mainWindow\.on\('closed', \(\) => \{[\s\S]*?if \(mirilla\) mirilla\.cerrar\(\);/
            .test(main), 'al cerrar la principal se cierra la mirilla');
    });

    t.test('la maqueta tiene su doble, o la semanal se rompe al repintar', () => {
        // `pintar` manda el espejo en cada repintado: sin estas, la maqueta
        // tira en cuanto se dibuja la pantalla semanal.
        const doble = leer('tools', 'maqueta', 'doble.js');
        for (const nombre of ['mirillaPoner', 'mirillaPantalla', 'mirillaEspejo',
            'mirillaQueMuestro', 'mirillaGesto', 'onMirillaEspejo', 'onMirillaGesto']) {
            t.ok(new RegExp(`${nombre}:`).test(doble), `${nombre} está en el doble`);
        }
    });

    t.test('el puente de verdad expone las mismas siete', () => {
        const preload = leer('preload.js');
        for (const nombre of ['mirillaPoner', 'mirillaPantalla', 'mirillaEspejo',
            'mirillaQueMuestro', 'mirillaGesto', 'onMirillaEspejo', 'onMirillaGesto']) {
            t.ok(new RegExp(`${nombre}:`).test(preload), `${nombre} está en el preload`);
        }
    });

    t.test('la página de la mirilla no puede cargar nada de fuera', () => {
        const html = leer('src', 'mirilla.html');
        t.ok(/default-src 'none'/.test(html), 'tiene CSP y arranca cerrada');
        t.ok(/media-src 'self' blob: mediastream:/.test(html),
            'y deja pasar la cámara, que es lo único que necesita');
    });
};
