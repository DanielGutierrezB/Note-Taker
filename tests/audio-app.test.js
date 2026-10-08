'use strict';
/**
 * La captura del sonido de Zoom, sin Zoom y sin permisos.
 *
 * El ayudante de verdad necesita que macOS le dé permiso de grabar el audio
 * del sistema, así que acá corre uno de mentira con el mismo protocolo
 * (`fixtures/escuchar-app-falso.js`). Lo que se prueba es todo lo que NO
 * depende de Core Audio: el re-empaquetado, el nivel, los errores y la caída.
 *
 * Y la otra mitad del cambio, que es la que evita el error caro: qué entradas
 * se ponen en verde y cuáles no (`estados.claseDeEntrada`).
 */

const fs = require('fs');
const path = require('path');

const audioApp = require('../engine/audio-app');

const FALSO = path.join(__dirname, 'fixtures', 'escuchar-app-falso.js');
fs.chmodSync(FALSO, 0o755);

const espera = ms => new Promise(r => setTimeout(r, ms));

function conFalso(modo, fn) {
    return async () => {
        const antes = { ayudante: process.env.NOTETAKER_ESCUCHAR_APP, modo: process.env.FALSO_MODO };
        process.env.NOTETAKER_ESCUCHAR_APP = FALSO;
        process.env.FALSO_MODO = modo;
        try { await fn(); } finally {
            audioApp.cerrar();
            if (antes.ayudante == null) delete process.env.NOTETAKER_ESCUCHAR_APP;
            else process.env.NOTETAKER_ESCUCHAR_APP = antes.ayudante;
            if (antes.modo == null) delete process.env.FALSO_MODO;
            else process.env.FALSO_MODO = antes.modo;
        }
    };
}

async function cargarEstados() {
    return import(`file://${path.join(__dirname, '..', 'src', 'js', 'estados.js')}`);
}

module.exports = async function (t) {
    const estados = await cargarEstados();

    t.group('audio-app · los pedazos');

    t.test('re-empaqueta lo que llegue en pedazos de 4096 muestras', () => {
        // Es el tamaño con el que se midieron los umbrales de `golpe.js`: con
        // pedazos de otro largo, el mismo aplauso mediría distinto.
        const pedazos = [];
        audioApp._conectar({ alPcm: p => pedazos.push(p), avisar: () => {}, mandando: true });
        for (let i = 0; i < 20; i++) audioApp.recibir(Buffer.alloc(480 * 2));
        t.eq(pedazos.length, 2, '9600 muestras son dos pedazos enteros');
        for (const p of pedazos) t.eq(p.length, 4096 * 2);
    });

    t.test('antes de Iniciar se mide pero no se manda', () => {
        const pedazos = [];
        const niveles = [];
        audioApp._conectar({
            alPcm: p => pedazos.push(p),
            avisar: a => { if (a.tipo === 'nivel') niveles.push(a.pico); },
            mandando: false
        });
        const tono = Buffer.alloc(4096 * 2);
        for (let i = 0; i < 4096; i++) tono.writeInt16LE(16000, i * 2);
        audioApp.recibir(tono);
        t.eq(pedazos.length, 0, 'la grabación no recibe nada');
        t.ok(niveles.length && niveles[0] > 0.4, `el medidor sí: ${niveles[0]}`);
    });

    t.group('audio-app · el WAV va a la par del reloj');

    /**
     * Un ayudante de mentira a 48 kHz, de a 10 ms, con un reloj que avanza a
     * mano. `huecos` son [desde s, dura s, llega-tarde]: el tiempo en que no se
     * entrega nada; si llega tarde, lo que faltaba viene de golpe al final.
     */
    function simular(segundos, huecos) {
        const avisos = [];
        const relanzados = [];
        let enviadas = 0;
        let ahora = 1000;
        audioApp._fingirHijo(true);
        audioApp._conectar({
            alPcm: () => {}, avisar: a => avisos.push(a), mandando: true,
            tasa: 48000, reloj: () => ahora,
            // Sin esto, un hueco largo abriría un ayudante DE VERDAD en medio
            // de las pruebas: un tap de Core Audio y su pedido de permiso.
            relanzar: () => relanzados.push(ahora)
        });
        let debe = 0;
        for (let ms = 0; ms < segundos * 1000; ms += 10) {
            ahora += 10;
            const h = (huecos || []).find(([d, dur]) => ms >= d * 1000 && ms < (d + dur) * 1000);
            if (h) {
                if (h[2]) debe += 480;
            } else {
                const n = 480 + debe;
                debe = 0;
                audioApp.recibir(Buffer.alloc(n * 2));
                enviadas += n;
            }
            if (ms % 250 === 0) audioApp._revisar();
        }
        const rellenado = avisos.filter(a => a.tipo === 'relleno').reduce((x, a) => x + a.segundos, 0);
        audioApp._fingirHijo(false);
        return { avisos, enviadas, rellenado, relanzados };
    }

    t.test('una pausa de 3 s se rellena con silencio y no estira nada', () => {
        // Lo que rompía el vigilante de antes: una pausa lo hacía creer que el
        // audio venía a 24 kHz y estiraba al doble lo bueno que llegaba después.
        const r = simular(20, [[5, 3]]);
        t.near(r.rellenado, 3, 0.4, `rellenó ${r.rellenado} s`);
        t.near(audioApp._mandadas() / 48000, 20, 0.4, 'y el WAV dura lo que el reloj');
        t.ok(!r.avisos.some(a => a.tipo === 'tasa'), 'sin inventar otra tasa');
    });

    t.test('lo que faltaba y llega tarde se descuenta del relleno', () => {
        // El pipe se trabó: el audio no se perdió, llegó de golpe después.
        const r = simular(20, [[5, 3, true]]);
        const avisosRelleno = r.avisos.filter(a => a.tipo === 'relleno');
        t.ok(avisosRelleno.length >= 1, 'rellenó mientras no llegaba');
        // Mandado al WAV: lo que llegó + lo rellenado − lo devuelto. Tiene que
        // dar el reloj, 20 s, y no 23.
        const aWav = audioApp._mandadas();
        t.near(aWav / 48000, 20, 0.4, `el WAV tiene ${(aWav / 48000).toFixed(2)} s`);
    });

    t.test('sin pausas no se rellena nada', () => {
        const r = simular(20);
        t.eq(r.rellenado, 0);
        t.near(audioApp._mandadas() / 48000, 20, 0.1);
    });

    t.test('sin datos un segundo y medio, avisa; cuando vuelven, también', () => {
        const r = simular(10, [[3, 2]]);
        const tipos = r.avisos.map(a => a.tipo).filter(x => x === 'caido' || x === 'vuelve');
        t.deep(tipos, ['caido', 'vuelve']);
    });

    t.test('un hueco corto NO relanza: un rearme tampoco es gratis', () => {
        // Con el tap de una app, que no llegue nada un rato puede ser normal:
        // Core Audio para el tap cuando la app deja de sonar.
        const r = simular(20, [[5, 3]]);
        t.eq(r.relanzados.length, 0, 'tres segundos callado se avisan y nada más');
    });

    t.test('un hueco largo tira el ayudante y abre otro', () => {
        // Avisar y nada más era quedarse mirando: el proceso seguía vivo con
        // el tap tomado y el WAV llenándose de silencio puesto, y lo único que
        // lo arreglaba era volver a Preparar a mitad de una clase.
        const r = simular(40, [[5, 30]]);
        t.eq(r.relanzados.length, 1, `relanzó una vez (${r.relanzados.length})`);
        t.ok(r.relanzados[0] >= 1000 + 15000,
            'y después de los diez segundos, no al primer silencio');
        t.ok(r.avisos.some(a => a.tipo === 'caido'), 'habiéndolo dicho antes');
    });

    t.test('y no insiste en bucle: uno por minuto', () => {
        // Si no se arregla, insistir tampoco lo arregla, y cada intento es un
        // tap y un dispositivo agregado más que crear y destruir.
        const r = simular(120, [[5, 110]]);
        t.eq(r.relanzados.length, 2, `dos minutos, dos intentos (${r.relanzados.length})`);
    });

    t.group('audio-app · el ayudante');

    t.test('abre, dice la tasa y manda el audio cuando se le pide', conFalso('ok', async () => {
        const pedazos = [];
        const r = await audioApp.abrir({ alPcm: p => pedazos.push(p), avisar: () => {} });
        t.ok(r.ok, r.error);
        t.eq(r.sampleRate, 48000);
        audioApp.empezarAMandar();
        await espera(300);
        t.ok(pedazos.length >= 1, `llegaron ${pedazos.length} pedazos`);
    }));

    t.test('si Zoom no está abierto, lo dice con el motivo', conFalso('sin-app', async () => {
        const r = await audioApp.abrir({ avisar: () => {} });
        t.eq(r.ok, false);
        t.eq(r.codigo, 'sin-app');
        t.ok(r.error.includes('us.zoom'), r.error);
    }));

    t.test('si la salida de audio cambia, se rearma solo y sigue mandando', conFalso('salida', async () => {
        // Los AirPods al estuche en medio de la clase: antes la escucha quedaba
        // callada con el proceso vivo y nadie se enteraba.
        const contador = require('path').join(require('os').tmpdir(), `nt-falso-${process.pid}-${Date.now()}`);
        process.env.FALSO_CONTADOR = contador;
        try {
            const avisos = [];
            const pedazos = [];
            const r = await audioApp.abrir({ avisar: a => avisos.push(a), alPcm: p => pedazos.push(p) });
            t.ok(r.ok);
            audioApp.empezarAMandar();
            await espera(700);
            t.ok(avisos.some(a => a.tipo === 'rearmada'), 'se rearmó');
            t.ok(!avisos.some(a => a.tipo === 'caido' && a.codigo !== 'sin-datos'), 'sin darla por caída');
            t.ok(pedazos.length > 0, 'y el audio siguió llegando a la grabación');
            t.ok(audioApp.abierto());
        } finally {
            delete process.env.FALSO_CONTADOR;
            try { require('fs').rmSync(contador); } catch (e) { /* no quedó */ }
        }
    }));

    t.test('si el ayudante se va solo, avisa que se cayó', conFalso('muere', async () => {
        const avisos = [];
        const r = await audioApp.abrir({ avisar: a => avisos.push(a) });
        t.ok(r.ok);
        await espera(400);
        t.ok(avisos.some(a => a.tipo === 'caido'), 'hay un aviso de caída');
    }));

    t.test('cerrarlo a propósito NO es una caída', conFalso('ok', async () => {
        const avisos = [];
        await audioApp.abrir({ avisar: a => avisos.push(a) });
        audioApp.cerrar();
        await espera(200);
        t.eq(avisos.filter(a => a.tipo === 'caido').length, 0);
        t.eq(audioApp.abierto(), false);
    }));

    t.test('estado dice si Zoom está entre las apps con audio', conFalso('ok', async () => {
        const e = audioApp.estado();
        t.ok(e.soportado);
        t.ok(e.abierta);
        t.ok(e.sonando);
    }));

    t.test('sin ayudante, estado lo dice en vez de tirar', async () => {
        const antes = process.env.NOTETAKER_ESCUCHAR_APP;
        process.env.NOTETAKER_ESCUCHAR_APP = '/no/existe/escuchar-app';
        try {
            const e = audioApp.estado();
            t.eq(e.soportado, false);
        } finally {
            if (antes == null) delete process.env.NOTETAKER_ESCUCHAR_APP;
            else process.env.NOTETAKER_ESCUCHAR_APP = antes;
        }
    });

    t.group('estados · qué entrada se elige');

    t.test('cada nombre de tu Mac cae en su clase', () => {
        // Los nombres son los de verdad, sacados de la lista de esta Mac.
        const casos = [
            [{ tipo: 'app', nombre: 'Audio de Zoom (la llamada)' }, 'llamada'],
            [{ nombre: 'ZoomAudioDevice (Virtual)' }, 'zoom-falso'],
            [{ nombre: 'Default - AirPods (Bluetooth)' }, 'bluetooth'],
            [{ nombre: 'AirPods Max de Daniel' }, 'bluetooth'],
            [{ nombre: 'MacBook Pro Microphone (Built-in)' }, 'microfono'],
            [{ nombre: 'iPhone de Daniel Microphone' }, 'microfono'],
            [{ nombre: 'BlackHole 2ch' }, 'virtual'],
            [{ nombre: 'Scarlett 2i2 USB' }, 'otra']
        ];
        for (const [entrada, clase] of casos) {
            t.eq(estados.claseDeEntrada(entrada), clase, entrada.nombre);
        }
    });

    t.test('ZoomAudioDevice nunca se pone en verde', () => {
        // Parece la llamada y no lo es: es lo que Zoom usa para MANDAR el
        // sonido de la Mac al compartir pantalla.
        const e = estados.deAudio({ abierto: true, clase: 'zoom-falso', pico: 0.5 });
        t.eq(e.listo, 'mal');
        t.ok(e.porque.includes('Audio de Zoom'), 'y dice qué elegir');
    });

    t.test('un micrófono no se pone en verde aunque suene', () => {
        // Es el error que esto vino a evitar: la sala tiene ruido, el medidor
        // se mueve, y la llamada no se oye.
        const e = estados.deAudio({ abierto: true, clase: 'microfono', pico: 0.5 });
        t.eq(e.listo, 'no');
        t.eq(e.palabra, 'graba la sala');
    });

    t.test('los auriculares Bluetooth avisan además del modo llamada', () => {
        const e = estados.deAudio({ abierto: true, clase: 'bluetooth', pico: 0.5 });
        t.ok(e.porque.includes('Bluetooth'));
    });

    t.test('un micrófono aceptado a sabiendas sí sirve: la clase presencial', () => {
        const e = estados.deAudio({ abierto: true, clase: 'microfono', aceptado: true, pico: 0.5 });
        t.eq(e.listo, 'si');
    });

    t.test('Zoom en silencio no bloquea, pero avisa en ámbar', () => {
        // Antes de la clase no habla nadie, y es normal. Pero es también lo que
        // se ve sin permiso, así que se dice dónde mirar.
        const e = estados.deAudio({ abierto: true, clase: 'llamada', pico: 0 });
        t.eq(e.listo, 'si');
        t.eq(e.clave, 'en silencio');
        t.ok(e.porque.includes('Grabación de audio del sistema'));
    });

    t.test('Zoom sonando se pone en verde', () => {
        const e = estados.deAudio({ abierto: true, clase: 'llamada', pico: 0.3 });
        t.eq(e.listo, 'si');
        t.eq(e.palabra, 'entra la llamada');
    });

    t.test('un error al abrir se muestra con su motivo', () => {
        const e = estados.deAudio({ abierto: false, error: 'Zoom no está abierto.' });
        t.eq(e.listo, 'mal');
        t.eq(e.porque, 'Zoom no está abierto.');
    });

    t.group('audio-app · escuchar la Mac entera y no una app');

    t.test('cada modo llama al ayudante con lo suyo', () => {
        // Son dos taps distintos de Core Audio: uno colgado de los procesos de
        // una app y el otro global. Desde afuera suenan igual, así que esto es
        // lo único que distingue haber pedido uno u otro.
        t.deep(audioApp.argumentos({ modo: 'sistema' }),
            ['--sistema', '--menos', audioApp.NOSOTROS],
            'el del sistema se saca a sí misma: si no, la app se grabaría a ella');
        t.deep(audioApp.argumentos({ modo: 'app' }), ['--app', audioApp.ZOOM]);
        t.deep(audioApp.argumentos({}), ['--app', audioApp.ZOOM], 'sin modo, el de siempre');
    });

    t.test('el modo elegido llega hasta el ayudante', conFalso('ok', async () => {
        const donde = path.join(require('os').tmpdir(), `nt-args-${Date.now()}`);
        process.env.FALSO_ARGS = donde;
        try {
            const r = await audioApp.abrir({ modo: 'sistema', alPcm: () => {}, avisar: () => {} });
            t.ok(r.ok, r.error);
            t.eq(fs.readFileSync(donde, 'utf8'), `--sistema --menos ${audioApp.NOSOTROS}`);
        } finally {
            delete process.env.FALSO_ARGS;
            fs.rmSync(donde, { force: true });
        }
    }));

    t.test('el ayudante nativo sabe los dos modos', () => {
        // El binario se compila aparte y las pruebas corren contra uno de
        // mentira, así que lo único que se puede comprobar sin permisos de
        // macOS es que el de verdad entienda lo que se le va a pedir.
        const swift = fs.readFileSync(path.join(__dirname, '..', 'nativo', 'escuchar-app.swift'), 'utf8');
        t.ok(/stereoGlobalTapButExcludeProcesses/.test(swift), 'el tap global existe');
        t.ok(/valorDe\("--app"\)/.test(swift) && /args\.contains\("--sistema"\)/.test(swift),
            'y las dos banderas se leen');
        t.ok(/kAudioAggregateDeviceTapAutoStartKey: prefijo != nil/.test(swift),
            'el del sistema NO espera a que algo suene: lo normal al abrir Preparar '
            + 'es el silencio, y esperar sería colgarse');
    });

    t.test('un ayudante huérfano se suelta solo', () => {
        // Esto es lo que ocupaba el hardware sin que se viera: el tap y el
        // dispositivo agregado son privados —no salen en ninguna lista— y un
        // ayudante que sobrevive a la app los deja tomados para siempre.
        //
        // La red que había no alcanzaba. El hilo escritor se entera de que
        // nadie lee cuando el `write` devuelve EPIPE, pero sin sonido no
        // escribe nunca, y sin sonido es cuando esto pasa. Y SIGTERM solo
        // llega si la app alcanzó a mandarlo: un cierre forzado no manda nada.
        const swift = fs.readFileSync(path.join(__dirname, '..', 'nativo', 'escuchar-app.swift'), 'utf8');
        t.ok(/func vigilarAlPadre\(\)/.test(swift));
        t.ok(/getppid\(\) == 1 \{ soltar\(\); exit\(0\) \}/.test(swift),
            'padre adoptado por launchd: el de verdad ya no está');
        t.ok(swift.indexOf('vigilarAlPadre()\n') < swift.indexOf('dispatchMain()'),
            'y se arranca antes de quedarse esperando');
    });

    t.test('la lista de entradas ofrece las dos, y la del sistema primero', async () => {
        const fuente = await import(`file://${path.join(__dirname, '..', 'src', 'js', 'grabar', 'fuente.js')}`);
        t.eq(fuente.SISTEMA.modo, 'sistema');
        t.eq(fuente.ZOOM.modo, 'app');
        const codigo = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'js', 'grabar', 'fuente.js'), 'utf8');
        t.ok(/\[SISTEMA, ZOOM\]/.test(codigo), 'en ese orden: la que sirve siempre va primero');
        const preparar = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'js', 'pantalla-preparar.js'), 'utf8');
        t.ok(/previo \|\| delSistema \|\| null/.test(preparar),
            'y sin ninguna guardada se elige sola, sin depender de que haya una app abierta');
    });
};
