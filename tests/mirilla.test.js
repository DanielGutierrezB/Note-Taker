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


/**
 * El proceso principal de mentira: lo justo para que `registrar` corra y se
 * pueda mirar qué hizo. `close()` es asíncrono como el de verdad —el `closed`
 * llega cuando la prueba lo suelta—, que es justo lo que hace falta para ver
 * la carrera de apagar y encender rápido.
 */
function principal() {
    const manejadores = {};
    const ventanas = [];
    const pantallas = [
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
    ];
    const escuchas = [];
    const enviadoAlaApp = [];
    const app = {
        isDestroyed: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        webContents: { send: (canal, dato) => enviadoAlaApp.push([canal, dato]) }
    };
    class Ventana {
        constructor(opciones) {
            this.opciones = opciones;
            this.hecho = [];
            this.eventos = {};
            this.cerrada = false;
            this.visible = false;
            this.bordes = { x: opciones.x, y: opciones.y, width: opciones.width, height: opciones.height };
            this.webContents = {
                enviado: [],
                send: (canal, dato) => this.webContents.enviado.push([canal, dato]),
                isLoading: () => false,
                on: (ev, fn) => { this.eventos[`wc:${ev}`] = fn; },
                setWindowOpenHandler: fn => { this.abrirVentana = fn; }
            };
            ventanas.push(this);
        }
        setAlwaysOnTop(...a) { this.hecho.push(['setAlwaysOnTop', ...a]); }
        setVisibleOnAllWorkspaces(...a) { this.hecho.push(['setVisibleOnAllWorkspaces', ...a]); }
        setContentProtection(...a) { this.hecho.push(['setContentProtection', ...a]); }
        loadFile(f) { this.archivo = f; }
        once(ev, fn) { this.eventos[ev] = fn; }
        on(ev, fn) { this.eventos[ev] = fn; }
        isDestroyed() { return this.cerrada; }
        isVisible() { return this.visible; }
        showInactive() { this.visible = true; }
        setBounds(b) { this.bordes = b; }
        getBounds() { return this.bordes; }
        close() { this.pidioCerrar = true; }
        destroy() { this.destruida = true; this.cerrarse(); }
        /** El `closed` de verdad, cuando la prueba diga. */
        cerrarse() { this.cerrada = true; if (this.eventos.closed) this.eventos.closed(); }
    }
    const ipcMain = {
        handle: (canal, fn) => { manejadores[canal] = fn; },
        on: (canal, fn) => { manejadores[canal] = fn; }
    };
    const screen = {
        getAllDisplays: () => pantallas,
        getDisplayMatching: () => pantallas[0],
        getPrimaryDisplay: () => pantallas[0],
        on: ev => escuchas.push(ev)
    };
    const anotado = [];
    const r = mirilla.registrar({
        ipcMain, BrowserWindow: Ventana, screen,
        ventanaPrincipal: () => app, anotar: (ev, d) => anotado.push([ev, d])
    });
    const deLaApp = { sender: app.webContents };
    const deLa = w => ({ sender: w.webContents });
    return {
        r, manejadores, ventanas, escuchas, enviadoAlaApp, anotado, app,
        deLaApp, deLa,
        llamar: (canal, event, ...args) => manejadores[canal](event, ...args)
    };
}

/**
 * La página de la mirilla, cargada de verdad con un documento de mentira.
 *
 * Las peticiones de cámara quedan pendientes hasta que la prueba las suelta:
 * así se puede ver qué pasa cuando llega otro espejo mientras una está en
 * camino, que es la carrera que dejaba dos cámaras abiertas.
 */
async function paginaDeLaMirilla(n) {
    const elemento = () => ({
        dataset: {}, atributos: {}, textContent: '', disabled: false, srcObject: null,
        style: { setProperty() {} },
        setAttribute(k, v) { this.atributos[k] = v; },
        addEventListener() {},
        play: async () => {}
    });
    const els = {};
    for (const id of ['marco', 'camara', 'aviso', 'btn-toma', 'btn-r', 'btn-pv']) els[id] = elemento();
    els['btn-r'].dataset.vista = 'R';
    els['btn-pv'].dataset.vista = 'PV';
    let alEspejo = null;
    const pedidos = [];
    const pistas = [];
    const antes = { document: globalThis.document, window: globalThis.window,
        navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
    globalThis.document = {
        querySelector: sel => els[sel.replace('#', '')],
        documentElement: { style: { setProperty() {} } }
    };
    globalThis.window = { nt: {
        onMirillaEspejo: fn => { alEspejo = fn; },
        mirillaQueMuestro: async () => ({}),
        mirillaGesto: async () => ({ ok: true })
    } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
        enumerateDevices: async () => [{ kind: 'videoinput', label: 'Cámara', deviceId: 'd1' }],
        getUserMedia: pedido => new Promise(soltar => {
            const pista = { parada: false, stop() { this.parada = true; } };
            pistas.push(pista);
            pedidos.push({ pedido, soltar: () => soltar({ getTracks: () => [pista] }) });
        })
    } } });
    await import(`${require('url').pathToFileURL(path.join(RAIZ, 'src', 'js', 'mirilla.js')).href}?n=${n}`);
    const devolver = () => {
        globalThis.document = antes.document;
        globalThis.window = antes.window;
        Object.defineProperty(globalThis, 'navigator', antes.navigator);
    };
    const esperar = () => new Promise(r => setTimeout(r, 5));
    return { els, pedidos, pistas, espejo: info => alEspejo(info), esperar, devolver };
}

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
        // `deviceId` viene como `screen:N:0` y esa N es el `id` del monitor.
        // Comprobado contra el sistema, no supuesto.
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

    t.group('la mirilla · la ventana');

    t.test('se marca como no compartible, y queda encima hasta de una pantalla completa', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const hecho = m.ventanas[0].hecho;
        t.deep(hecho.find(h => h[0] === 'setContentProtection'), ['setContentProtection', true],
            'sin esto la cara sale dos veces en el vídeo: la grabada y la que pone ffmpeg');
        t.deep(hecho.find(h => h[0] === 'setAlwaysOnTop'), ['setAlwaysOnTop', true, 'screen-saver'],
            'con «floating» se esconde debajo de una pantalla completa, que es cuando más falta hace');
        t.deep(hecho.find(h => h[0] === 'setVisibleOnAllWorkspaces')[2], { visibleOnFullScreen: true });
    });

    t.test('abre con su propio puente, que el paquete lleva', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const preload = m.ventanas[0].opciones.webPreferences.preload;
        t.eq(path.basename(preload), 'preload-mirilla.js', 'no el de la app entera');
        t.ok(m.ventanas[0].opciones.webPreferences.sandbox, 'y en la caja');
        const archivos = JSON.parse(leer('package.json')).build.files;
        t.ok(archivos.includes('preload-mirilla.js'),
            'sin esto el .pkg abre la mirilla sin puente: un cuadro negro');
    });

    t.test('no navega ni abre ventanas', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const w = m.ventanas[0];
        let frenada = false;
        w.eventos['wc:will-navigate']({ preventDefault: () => { frenada = true; } });
        t.ok(frenada, 'se queda en su página');
        t.deep(w.abrirVentana(), { action: 'deny' });
    });

    t.test('apagar y encender rápido no deja una ventana sin dueño', () => {
        // `close()` es asíncrono: la segunda se crea antes de que la primera
        // avise que se cerró, y ese aviso, mirando la del módulo, dejaba a la
        // nueva sin que nadie pudiera cerrarla.
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-poner', m.deLaApp, false);
        m.llamar('mirilla-poner', m.deLaApp, true);
        const [vieja, nueva] = m.ventanas;
        vieja.cerrarse();
        m.r.cerrar();
        t.ok(nueva.destruida, 'la nueva se puede cerrar todavía');
    });

    t.test('cerrar no deja ninguna viva, encienda y apague como se encienda', () => {
        // Con `close`, una que no terminaba de irse quedaba sin dueño y encima
        // de todo con la app ya cerrada, que es lo que vio el editor.
        const m = principal();
        for (const encendida of [true, false, true, true, false, true]) {
            m.llamar('mirilla-poner', m.deLaApp, encendida);
        }
        m.r.cerrar('se cerró la ventana de la app');
        t.ok(m.ventanas.length > 1, `se abrieron ${m.ventanas.length}`);
        t.ok(m.ventanas.every(w => w.isDestroyed()), 'y no queda viva ninguna');
    });

    t.test('se destruye y no se le pide que se cierre', () => {
        // `close` es asíncrono y se puede cancelar: una ventana sin marco que
        // no se cierra es una que no hay forma de quitarse de encima.
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-poner', m.deLaApp, false);
        t.ok(m.ventanas[0].destruida && !m.ventanas[0].pidioCerrar);
    });

    t.test('después de cerrarla, una que termina de cargar tarde no aparece', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const w = m.ventanas[0];
        m.r.cerrar('la app se cierra');
        w.visible = false;
        w.eventos['ready-to-show']();
        t.eq(w.visible, false);
    });

    t.test('queda en el diario cuándo y por qué se fue', () => {
        // Faltaba: la vez que quedó a la vista, el diario decía cuándo se abrió
        // y nada de cuándo se tendría que haber ido.
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.r.cerrar('la app se cierra');
        t.deep(m.anotado.find(([ev]) => ev === 'mirilla.cerrada'), ['mirilla.cerrada', { porque: 'la app se cierra' }]);
        m.r.cerrar('otra vez');
        t.eq(m.anotado.filter(([ev]) => ev === 'mirilla.cerrada').length, 1, 'sin nada que cerrar no se anota nada');
    });

    t.test('y una que llega tarde a mostrarse no muestra a la otra', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-poner', m.deLaApp, false);
        const vieja = m.ventanas[0];
        vieja.visible = false;
        vieja.eventos['ready-to-show']();
        t.eq(vieja.visible, false, 'apagada, no aparece aunque termine de cargar');
    });

    t.test('los monitores se escuchan al abrir y no al cargar main', () => {
        // `registrar` corre antes del `ready` de la app, y el módulo `screen`
        // de Electron no existe hasta entonces: engancharlos arriba rompía el
        // arranque entero.
        const m = principal();
        t.deep(m.escuchas, [], 'registrar no toca `screen`');
        m.llamar('mirilla-poner', m.deLaApp, true);
        t.ok(m.escuchas.includes('display-metrics-changed'), 'se enganchan la primera vez que se abre');
    });

    t.group('la mirilla · en qué monitor');

    t.test('se muda al monitor de la pantalla que se graba', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const r = m.llamar('mirilla-pantalla', m.deLaApp, { deviceId: 'screen:2:0' });
        t.eq(r.monitor, '2');
        t.deep(r.sitio, mirilla.sitioEn({ bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }),
            'a la esquina de ese monitor');
    });

    t.test('sin saberlo se queda donde estaba', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-pantalla', m.deLaApp, { deviceId: 'screen:2:0' });
        t.eq(m.llamar('mirilla-pantalla', m.deLaApp, { deviceId: 'window:9:0' }).monitor, '2');
    });

    t.group('la mirilla · el espejo');

    t.test('lo que manda la semanal le llega, y nada más', () => {
        // El motor le habla a la app y solo a la app: lo que la mirilla
        // muestra se lo cuenta la semanal por el espejo. Antes le llegaba
        // todo —el estado entero con cada palabra, en cada pasada— a una
        // página que solo escuchaba un canal.
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-espejo', m.deLaApp, { vista: 'R', abierta: true });
        t.deep(m.ventanas[0].webContents.enviado, [['mirilla-espejo', { vista: 'R', abierta: true }]]);
        t.eq(m.r.avisar, undefined, 'no hay por dónde mandarle otra cosa');
        t.ok(!/mirilla\.avisar/.test(leer('main.js')), 'y `send` no fanea');
    });

    t.test('al abrirla tiene lo último, y al reabrirla no tiene lo de antes', () => {
        // Reabierta, un espejo viejo le diría que la cámara está abierta
        // cuando a lo mejor ya no, y abrirla sin que nadie la tenga es lo que
        // baja la grabación a 640×480.
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        m.llamar('mirilla-espejo', m.deLaApp, { camara: 'Cámara' });
        t.deep(m.llamar('mirilla-que-muestro', m.deLa(m.ventanas[0])), { camara: 'Cámara' });
        m.llamar('mirilla-poner', m.deLaApp, false);
        m.ventanas[0].cerrarse();
        m.llamar('mirilla-poner', m.deLaApp, true);
        t.deep(m.llamar('mirilla-que-muestro', m.deLa(m.ventanas[1])), {});
    });

    t.test('cada ventana tiene su mitad, y no la otra', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const deLaMirilla = m.deLa(m.ventanas[0]);
        t.eq(m.llamar('mirilla-poner', deLaMirilla, false).ok, false, 'la mirilla no se apaga sola');
        t.eq(m.llamar('mirilla-gesto', m.deLaApp, { hace: 'toma' }).ok, false, 'la app no se hace gestos');
        t.deep(m.llamar('mirilla-que-muestro', m.deLaApp), {}, 'ni lee el espejo que ella misma manda');
        t.deep(m.enviadoAlaApp, []);
    });

    t.test('un gesto se reenvía limpio, y uno que no es un gesto no pasa', () => {
        const m = principal();
        m.llamar('mirilla-poner', m.deLaApp, true);
        const deLaMirilla = m.deLa(m.ventanas[0]);
        m.llamar('mirilla-gesto', deLaMirilla, { hace: 'vista', vista: 'PV', otra: 'cosa' });
        m.llamar('mirilla-gesto', deLaMirilla, { hace: 'toma' });
        t.eq(m.llamar('mirilla-gesto', deLaMirilla, { hace: 'terminar' }).ok, false);
        t.eq(m.llamar('mirilla-gesto', deLaMirilla, { hace: 'vista', vista: 3 }).ok, false);
        t.deep(m.enviadoAlaApp, [
            ['mirilla-gesto', { hace: 'vista', vista: 'PV' }],
            ['mirilla-gesto', { hace: 'toma' }]
        ]);
    });

    t.test('se va con la ventana de la app', () => {
        // Sin marco y sin botón de cerrar, sola encima de todo y sin la app
        // que la abrió, no habría forma de quitársela de encima. Y en macOS la
        // app sigue viva después de cerrar su ventana, así que pasaría.
        const main = leer('main.js');
        t.ok(/mainWindow\.on\('closed', \(\) => \{[\s\S]*?if \(mirilla\) mirilla\.cerrar\('/
            .test(main), 'al cerrar la principal se cierra la mirilla');
        const salida = main.slice(main.indexOf("app.on('before-quit'"));
        t.ok(/^app\.on\('before-quit', \(\) => \{[\s\S]*?if \(mirilla\) mirilla\.cerrar\('la app se cierra'\);/.test(salida),
            'y al salir con ⌘Q también, sin esperar a la ventana de la app');
    });

    t.group('la mirilla · la cámara');

    t.test('pide exactamente lo mismo que la grabación de verdad', () => {
        // La regla medida: dos ventanas comparten el dispositivo, pero el
        // formato lo negocia la primera. Pidiendo menos acá, la grabación de
        // allá sale peor. Las dos lo sacan del mismo sitio.
        t.ok(/import \{ pedidoDeCamara \} from '\.\/grabar\/ojo\.js';/.test(leer('src', 'js', 'mirilla.js')));
        t.ok(/getUserMedia\(pedidoDeCamara\(cual\.id\)\)/.test(leer('src', 'js', 'grabar', 'ojo.js')),
            'y la grabación de verdad pide con lo mismo');
    });

    t.test('no la abre si nadie la tiene abierta', async () => {
        const p = await paginaDeLaMirilla(1);
        try {
            p.espejo({ camara: null, vista: 'R' });
            await p.esperar();
            t.eq(p.pedidos.length, 0, 'abriéndola primero, la de verdad hereda 640×480');
        } finally { p.devolver(); }
    });

    t.test('dos espejos seguidos abren UNA cámara', async () => {
        // Al abrirla llegan casi juntos el guardado y el del primer repintado.
        const p = await paginaDeLaMirilla(2);
        try {
            p.espejo({ camara: 'Cámara' });
            p.espejo({ camara: 'Cámara' });
            await p.esperar();
            t.eq(p.pedidos.length, 1);
            t.deep(p.pedidos[0].pedido.video.width, { ideal: 2560 }, 'con el pedido de `ojo.js`');
            // Y uno que llega con la primera ya esperando el `getUserMedia` no
            // la tira para pedirla de nuevo: la cámara parpadearía.
            p.espejo({ camara: 'Cámara' });
            await p.esperar();
            t.eq(p.pedidos.length, 1, 'la que se está pidiendo vale');
        } finally { p.devolver(); }
    });

    t.test('y si mientras se pedía la soltaron, al llegar se cierra', async () => {
        // Antes la petición en vuelo la abría igual al volver, y quedaba
        // abierta sin nadie que la tuviera del otro lado.
        const p = await paginaDeLaMirilla(3);
        try {
            p.espejo({ camara: 'Cámara' });
            await p.esperar();
            p.espejo({ camara: null });
            p.pedidos[0].soltar();
            await p.esperar();
            t.ok(p.pistas[0].parada, 'la que llegó tarde se para');
            t.eq(p.els.camara.srcObject, null, 'y no se muestra');
        } finally { p.devolver(); }
    });

    t.test('vuelta a abrir, se pide otra vez', async () => {
        const p = await paginaDeLaMirilla(4);
        try {
            p.espejo({ camara: 'Cámara' });
            await p.esperar();
            p.pedidos[0].soltar();
            await p.esperar();
            p.espejo({ camara: null });
            p.espejo({ camara: 'Cámara' });
            await p.esperar();
            t.eq(p.pedidos.length, 2);
            t.ok(p.pistas[0].parada, 'la primera se soltó');
        } finally { p.devolver(); }
    });

    t.group('la mirilla · espejo, no segunda opinión');

    t.test('los tres botones piden, no hacen', () => {
        const src = leer('src', 'js', 'mirilla.js');
        t.ok(!/window\.nt\.grabar(Abrir|Cerrar|Editar)/.test(src),
            'la mirilla no le habla al motor: le habla a la semanal');
        t.ok(/window\.nt\.mirillaGesto\(\{ hace: 'vista'/.test(src), 'la vista se pide');
        t.ok(/window\.nt\.mirillaGesto\(\{ hace: 'toma'/.test(src), 'y la toma también');
    });

    t.test('el puente de la mirilla es el de la mirilla, y el de la app no lo tiene', () => {
        const suyo = leer('preload-mirilla.js');
        for (const nombre of ['mirillaQueMuestro', 'mirillaGesto', 'onMirillaEspejo']) {
            t.ok(new RegExp(`${nombre}:`).test(suyo), `${nombre} está en su puente`);
        }
        t.ok(!/pickFolder|grabarTerminar|ajustesGuardar/.test(suyo), 'y nada de lo de la app');
        const app = leer('preload.js');
        for (const nombre of ['mirillaPoner', 'mirillaPantalla', 'mirillaEspejo', 'onMirillaGesto']) {
            t.ok(new RegExp(`${nombre}:`).test(app), `${nombre} está en el de la app`);
        }
        t.ok(!/mirillaQueMuestro|mirillaGesto:|onMirillaEspejo/.test(app), 'y lo de la mirilla no');
        const doble = leer('tools', 'maqueta', 'doble.js');
        for (const nombre of ['mirillaPoner', 'mirillaPantalla', 'mirillaEspejo', 'onMirillaGesto']) {
            t.ok(new RegExp(`${nombre}:`).test(doble), `${nombre} está en el doble`);
        }
    });

    t.test('los gestos entran por las mismas funciones que los botones de la semanal', () => {
        // Si abrieran una toma por otro camino, un día los dos caminos harían
        // cosas distintas: `bordeDeToma` espera al borde anterior en vuelo, y
        // `cambiarVista` le pone la vista a la toma abierta. Y con las mismas
        // guardas que el teclado: el espejo puede ir un latido atrasado.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/onMirillaGesto\(g => \{[\s\S]*?puedeVista\(\)\) cambiarVista\(g\.vista\);[\s\S]*?puedeBorde\(\)\) bordeDeToma\(\);/
            .test(semanal), 'las mismas dos funciones, con sus guardas');
        t.ok(/if \(!puedeBorde\(\)\) return;/.test(semanal), 'que son las del teclado');
        t.ok(/if \(!puedeVista\(\)\) return;/.test(semanal));
    });

    t.test('la página de la mirilla no puede cargar nada de fuera', () => {
        const html = leer('src', 'mirilla.html');
        t.ok(/default-src 'none'/.test(html), 'tiene CSP y arranca cerrada');
        t.ok(/media-src 'self' blob: mediastream:/.test(html),
            'y deja pasar la cámara, que es lo único que necesita');
    });

    t.group('la mirilla · lo que le cuenta la semanal');

    const espejoDe = async (...args) => {
        const m = await import(require('url').pathToFileURL(path.join(RAIZ, 'src', 'js', 'semanal', 'mirilla.js')).href);
        return m.espejoDe(...args);
    };
    // Las de verdad, con el entero de color de Premiere que manda el motor.
    const VISTAS = require('../engine/notas-vivo').VISTAS;

    t.test('la vista es la de la toma abierta, no la del próximo', async () => {
        const e = await espejoDe({ vista: 'PV', vistas: VISTAS, paso: 'grabando',
            sesion: { tomas: [{ vista: 'PV', outMs: 1 }, { vista: 'R', outMs: null }] } }, true);
        t.eq(e.vista, 'R');
        t.eq(e.abierta, true);
        t.eq(e.puedeAbrir, true);
    });

    t.test('sin toma abierta, la que viene', async () => {
        const e = await espejoDe({ vista: 'PV', vistas: VISTAS, paso: 'listo', sesion: null }, true);
        t.eq(e.vista, 'PV');
        t.eq(e.abierta, false);
        t.eq(e.puedeAbrir, false, 'antes de grabar no hay toma que abrir');
    });

    t.test('la cámara se nombra solo con el stream ya abierto de este lado', async () => {
        const estado = { vista: 'R', vistas: VISTAS, camara: { nombre: 'Cámara' } };
        t.eq((await espejoDe(estado, true)).camara, 'Cámara');
        t.eq((await espejoDe(estado, false)).camara, null, 'abriéndola primero allá, la de acá hereda 640×480');
    });

    t.test('el color sale del motor, y antes de que lleguen las vistas no se cae', async () => {
        t.eq((await espejoDe({ vista: 'R', vistas: VISTAS }, false)).color, '#e96f24',
            'son los colores de los marcadores de Premiere');
        t.eq((await espejoDe({ vista: 'R', vistas: [] }, false)).color, null);
        t.ok(/if \(info\.color\) document\.documentElement\.style\.setProperty/
            .test(leer('src', 'js', 'mirilla.js')), 'del otro lado tampoco se da por hecho');
    });

    t.group('la mirilla · cuándo se va');

    t.test('se cierra sola al terminar de grabar', () => {
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/if \(estado\.mirilla\) laMirilla\(false\);\n    estado\.paso = 'mirando';/
            .test(semanal), 'una ventana encima de todo y sin nada que grabar tapa el editor');
    });

    t.test('y al salir del modo, antes de soltar la cámara', () => {
        // Se quedaba flotando sobre la pantalla de la clase con la cámara
        // abierta por su cuenta.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        const salir = /export async function salir\(\) \{[\s\S]*?\n}/.exec(semanal)[0];
        t.ok(salir.indexOf('laMirilla(false)') > 0, 'la cierra');
        t.ok(salir.indexOf('laMirilla(false)') < salir.indexOf("ojo.soltar('semanal')"), 'antes que la cámara');
    });

    t.test('el espejo no espera al menú de una palabra', () => {
        // Una toma abierta por la voz con el menú abierto tiene que encender el
        // punto rojo igual: es estado, no pantalla.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        const pintar = /function pintar\(\) \{[\s\S]*?\n}/.exec(semanal)[0];
        t.ok(pintar.indexOf('mirilla.espejar(estado)') < pintar.indexOf('menuPalabra.hay()'));
    });

    t.test('se le cuenta el cambio de ventana, no solo la primera elección', () => {
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        const cambiar = /async function cambiarPantalla\(boton\)[\s\S]*?\n}/.exec(semanal);
        t.ok(cambiar, 'sigue existiendo el cambio de ventana a mitad de grabación');
        t.ok(/mirilla\.contarLaPantalla\(estado, filmar\.laPantalla\(\)\);/.test(cambiar[0]),
            'cambiando a una ventana de otro monitor, la mirilla se muda con ella');
    });

    t.group('la mirilla · el punto de grabando');

    t.test('se enciende con la toma abierta y se apaga al cerrarla', () => {
        const css = leer('src', 'css', 'mirilla.css');
        t.ok(/\.rec \{[\s\S]*?display: none;/.test(css), 'apagado de entrada');
        t.ok(/\.marco\[data-toma='abierta'\] \.rec \{ display: block; \}/.test(css),
            'y encendido por el mismo dato que ya cambia el botón de abajo');
        t.ok(/marco\.dataset\.toma = info\.abierta \? 'abierta' : 'no';/
            .test(leer('src', 'js', 'mirilla.js')), 'que lo pone el espejo');
    });

    t.test('es un rojo propio y no el de la vista', () => {
        // `--vista` ya es rojo en «Yo»: un punto del color del marco sería un
        // punto que desaparece justo en una de las dos vistas.
        const css = leer('src', 'css', 'mirilla.css');
        const rec = css.slice(css.indexOf('.rec {'), css.indexOf('.marco[data-toma=\'abierta\'] .rec'));
        t.ok(/background: #ff3b30;/.test(rec), 'el rojo de grabar');
        t.ok(!/var\(--vista\)/.test(rec), 'y nada que dependa de la vista');
    });

    t.test('late, pero no para quien pidió que no', () => {
        const css = leer('src', 'css', 'mirilla.css');
        t.ok(/animation: rec-late/.test(css), 'un punto quieto se vuelve mobiliario');
        t.ok(/prefers-reduced-motion: reduce\) \{\n  \.rec \{ animation: none; \}/.test(css),
            'y quien pidió menos movimiento se queda con el punto, que es lo que importa');
    });
};
