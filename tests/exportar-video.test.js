'use strict';
/**
 * El corte del modo semanal: qué pedazo de qué archivo entra en el vídeo.
 *
 * Casi todo se prueba sobre `repartir` y `grafo`, que son la mitad pura: de qué
 * instante de qué archivo sale cada trozo y cómo se le pide a ffmpeg. Es la
 * mitad donde un error no se ve hasta que alguien abre el MP4 y se encuentra con
 * que el corte cae encima de una palabra, o con que la cámara tapa lo que se
 * estaba explicando.
 *
 * Y al final, si ffmpeg está en el disco, se corta un vídeo de verdad y se
 * comprueba por dónde quedó: que la duración sea la suma de las tomas y que la
 * esquina de abajo a la derecha tenga la cámara y no el fondo. Esa es la única
 * prueba que mira la imagen, porque es lo único que no se puede deducir del
 * grafo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const exportar = require('../engine/exportar-video');
const videoCrudo = require('../engine/video-crudo');
const workspace = require('../engine/workspace');
const paths = require('../engine/paths');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');

const T0 = Date.parse('2026-10-03T10:00:00');

/** Un vídeo ya grabado, como lo deja `video-crudo.cerrar`. */
function video(cual, desdeS, hastaS) {
    return {
        cual,
        archivo: `/tmp/${cual}.mp4`,
        ruta: `/tmp/${cual}.mp4`,
        empezoMs: T0 + desdeS * 1000,
        cerradoMs: T0 + hastaS * 1000
    };
}

/** Un WAV ya grabado, como lo deja `captura.cerrar`. */
function wav(desdeS, segundos) {
    return { archivo: '/tmp/audio.wav', ruta: '/tmp/audio.wav', desdeMs: T0 + desdeS * 1000, segundos };
}

/**
 * Una toma con sus bordes ya ajustados, en segundos desde el cero.
 *
 * `R` por defecto, que es la vista de pantalla: es con la que se miran casi
 * todas estas pruebas, porque es la que tiene fondo Y recuadro.
 */
function toma(id, desdeS, hastaS, vista) {
    return { id, vista: vista || 'R', desdeMs: T0 + desdeS * 1000, hastaMs: T0 + hastaS * 1000 };
}

module.exports = function (t) {
    t.group('exportar vídeo · qué tomas entran');

    t.test('las mismas que van al XML, con los bordes ya corridos al silencio', () => {
        // Es la garantía de que el vídeo y el XML cuentan lo mismo: si esto
        // saliera por otra puerta, el corte del MP4 y el del editor podrían
        // diferir sin que nada se quejara.
        const estado = vivo.estadoNuevo({ secuencia: 's', curso: 'c', ceroMs: T0, fps: 30 });
        estado.tomas = [
            // `deInMs` es el borde DEL que se calculó el ajuste, y `inMs` el
            // sitio al que se corrió: así un borde movido a mano después
            // invalida su propio ajuste (ver `bordeAjustado`).
            { id: 1, vista: 'PV', inMs: T0 + 2000, outMs: T0 + 5000, palabras: [], comentarios: [],
              ajuste: { v: 2, deInMs: T0 + 2000, deOutMs: T0 + 5000, inMs: T0 + 1800, outMs: T0 + 5200 } },
            { id: 2, vista: 'PV', inMs: T0 + 8000, outMs: T0 + 9000, palabras: [], comentarios: [], descartada: true },
            { id: 3, vista: 'PV', inMs: T0 + 12000, outMs: null, palabras: [], comentarios: [] }
        ];
        const tomas = exportar.tomasDe(vivo.tomasQueQuedan(estado));
        t.eq(tomas.length, 1, 'la descartada y la que quedó sin OUT no entran');
        t.eq(tomas[0].desdeMs, T0 + 1800, 'y el borde es el ajustado, no el dicho');
        t.eq(tomas[0].hastaMs, T0 + 5200);
    });

    t.test('una toma que quedó en nada no entra', () => {
        const estado = vivo.estadoNuevo({ secuencia: 's', curso: 'c', ceroMs: T0, fps: 30 });
        estado.tomas = [{
            id: 1, vista: 'PV', inMs: T0 + 2000, outMs: T0 + 2100, palabras: [], comentarios: []
        }];
        t.eq(exportar.tomasDe(vivo.tomasQueQuedan(estado)).length, 0, `menos de ${exportar.MINIMO_SEC} s no es una toma`);
    });

    t.group('exportar vídeo · de qué archivo sale cada trozo');

    t.test('la pantalla va de fondo y la cámara encima', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.eq(r.avisos.length, 0, r.avisos.join(' · '));
        t.eq(r.trozos.length, 1);
        t.ok(/pantalla/.test(r.trozos[0].fondo.ruta), 'el fondo es la pantalla');
        t.ok(/camara/.test(r.trozos[0].encima.ruta), 'y la cámara va encima');
        t.eq(r.trozos[0].segundos, 10);
    });

    t.test('una toma de profesor es la cámara sola: ni pantalla de fondo ni recuadro', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20, 'PV')],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.eq(r.avisos.length, 0, r.avisos.join(' · '));
        t.ok(/camara/.test(r.trozos[0].fondo.ruta), 'el fondo es la cámara');
        t.eq(r.trozos[0].encima, null, 'y no hay nada encima: no se superpone a sí misma');
        t.eq(r.trozos[0].fondo.cual, 'camara', 'una cara llena el cuadro en vez de quedar con bandas');
    });

    t.test('la vista de cada toma manda, toma por toma', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20, 'PV'), toma(2, 25, 30, 'R'), toma(3, 35, 40, 'S')],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.deep(r.trozos.map(x => path.basename(x.fondo.ruta)),
            ['camara.mp4', 'pantalla.mp4', 'pantalla.mp4'],
            'PV con la cámara; R y S con la pantalla, que es lo que dice el viewMap');
        t.deep(r.trozos.map(x => Boolean(x.encima)), [false, true, true]);
    });

    t.test('`mandaLaCamara` es el mismo mapa que usa Premiere, y no una tabla nueva', () => {
        t.eq(exportar.mandaLaCamara('PV'), true);
        t.eq(exportar.mandaLaCamara('R'), false);
        t.eq(exportar.mandaLaCamara('S'), false);
        // Las vistas viejas se traducen al leer, así que una `SL` de un XML de
        // antes tiene que caer con las slides y no inventar una fuente.
        t.eq(exportar.mandaLaCamara('SL'), false, 'una vista renombrada sigue sabiendo de dónde sale');
        t.eq(exportar.mandaLaCamara(''), false, 'y sin vista, la pantalla: es el caso del modo semanal');
    });

    t.test('una toma que pide la cámara y no la tiene sale con la pantalla, y se dice', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 50, 55, 'PV')],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 30),        // se cortó antes
            camaraConAudio: false,
            wavs: [wav(0, 60)]
        });
        t.eq(r.trozos.length, 1, 'la toma entra igual');
        t.ok(/pantalla/.test(r.trozos[0].fondo.ruta), 'con la otra fuente');
        t.eq(r.trozos[0].fondo.cual, 'pantalla', 'y una pantalla no se recorta');
        t.ok(r.avisos.some(a => /pedía tu cámara/.test(a)), r.avisos.join(' · '));
    });

    t.test('cada archivo se recorta en SU instante, no en el de la grabación', () => {
        // Es la cuenta que alinea los tres relojes. La pantalla arrancó dos
        // segundos después que el audio, así que el mismo momento de la clase
        // cae dos segundos antes dentro de su archivo.
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 2, 60),
            camara: video('camara', 1, 60),
            camaraConAudio: false,
            wavs: [wav(0, 60)]
        });
        const [tr] = r.trozos;
        t.eq(tr.fondo.desdeSec, 8, 'la pantalla empezó en el segundo 2');
        t.eq(tr.encima.desdeSec, 9, 'la cámara en el 1');
        t.eq(tr.audio.desdeSec, 10, 'y el WAV en el cero');
        t.eq(tr.fondo.hastaSec, 18);
    });

    t.test('el audio es el de la cámara si lo tiene: así los labios cuadran', () => {
        const con = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.ok(/camara/.test(con.trozos[0].audio.ruta), 'con audio en la cámara, sale de ahí');

        const sin = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: false,
            wavs: [wav(0, 60)]
        });
        t.ok(/audio\.wav/.test(sin.trozos[0].audio.ruta), 'y si no, del WAV de siempre');
    });

    t.test('sin pantalla, la cámara pasa a ser el fondo y no se repite encima', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: null,
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.ok(/camara/.test(r.trozos[0].fondo.ruta));
        t.eq(r.trozos[0].encima, null, 'la cámara no va de fondo y encima a la vez');
    });

    t.test('una cámara que se cortó a media toma deja ese trozo sin cámara, no a medias', () => {
        // `overlay` termina con la más corta de las dos, así que una cámara que
        // no cubre el trozo entero no dejaría un trozo sin cámara al final:
        // dejaría el trozo CORTADO, y con él la frase.
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 30, 40)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 25),
            camaraConAudio: false,
            wavs: [wav(0, 60)]
        });
        t.eq(r.trozos.length, 2, 'las dos tomas entran');
        t.ok(r.trozos[0].encima, 'la primera con cámara');
        t.eq(r.trozos[1].encima, null, 'la segunda sin ella');
        t.ok(r.avisos.some(a => /toma 2 va sin la cámara/.test(a)), r.avisos.join(' · '));
    });

    t.test('una toma fuera de lo grabado se queda fuera, y se dice', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 80, 90)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        t.eq(r.trozos.length, 1);
        t.ok(r.avisos.some(a => /toma 2 queda fuera/.test(a)), r.avisos.join(' · '));
    });

    t.group('exportar vídeo · los dos relojes');

    t.test('un micrófono normal no mueve nada', () => {
        // 13,96 s de pared para 13,96 s de audio: factor 1 y ninguna cuenta.
        const normal = { desdeMs: T0, hastaMs: T0 + 13960, segundos: 13.96 };
        t.near(exportar.derivaDe(normal), 1, 0.001);
        t.eq(exportar.aPared(T0 + 5000, normal), T0 + 5000);
    });

    t.test('un audio que corre a otro ritmo se corrige con su propia medida', () => {
        // Medido con la cámara y el micrófono falsos de Chromium, que escriben
        // 26,28 s de audio en 13,96 s de pared. Sin corregir, la segunda toma
        // caía fuera del vídeo y el corte la descartaba.
        const corrido = { desdeMs: T0, hastaMs: T0 + 13960, segundos: 26.28 };
        t.near(exportar.derivaDe(corrido), 0.531, 0.002);
        // La toma que el audio pone en el segundo 16 pasó de verdad en el 8,5.
        t.near((exportar.aPared(T0 + 16040, corrido) - T0) / 1000, 8.52, 0.05);
    });

    t.test('un sidecar con un número absurdo no inventa un corte absurdo', () => {
        t.eq(exportar.derivaDe({ desdeMs: T0, hastaMs: T0 + 100000, segundos: 1 }), exportar.DERIVA_MAXIMA);
        t.eq(exportar.derivaDe({ desdeMs: T0, hastaMs: T0 + 1000, segundos: 100 }), exportar.DERIVA_MINIMA);
        t.eq(exportar.derivaDe({ desdeMs: T0, hastaMs: null, segundos: 10 }), 1, 'un WAV abierto, sin corrección');
        t.eq(exportar.derivaDe(null), 1);
    });

    t.test('con el audio corrido, el vídeo se busca en el instante de pared', () => {
        // La toma que el WAV pone del 16 al 22 pasó de verdad del 8,5 al 11,7:
        // ahí es donde hay que buscarla en la cámara, y ahí sí está.
        const wavCorrido = { archivo: '/tmp/audio.wav', ruta: '/tmp/audio.wav',
            desdeMs: T0, hastaMs: T0 + 13960, segundos: 26.28 };
        const r = exportar.repartir({
            tomas: [toma(1, 16.04, 22.19)],
            pantalla: null,
            camara: video('camara', 0, 13.2),
            camaraConAudio: false,
            wavs: [wavCorrido]
        });
        t.eq(r.trozos.length, 1, 'la toma entra, en vez de quedarse fuera del vídeo');
        t.near(r.trozos[0].fondo.desdeSec, 8.52, 0.05, 'en la cámara se busca en el 8,5');
        t.near(r.trozos[0].audio.desdeSec, 16.04, 0.05, 'y en el WAV, en el 16: es su propio reloj');
        t.ok(r.avisos.some(a => /0\.53x del reloj/.test(a)), r.avisos.join(' · '));
    });

    t.group('exportar vídeo · cómo se le pide a ffmpeg');

    t.test('un archivo es una entrada, aunque lo usen todas las tomas', () => {
        // Si cada toma abriera su propia entrada, ffmpeg decodificaría el mismo
        // archivo una vez por toma. Con una sola entrada lo decodifica una vez y
        // reparte, que es lo medido: pico de memoria plano aunque las tomas
        // estén a cuatro minutos de distancia.
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 30, 40), toma(3, 50, 55)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        t.eq(g.entradas.length, 2, 'la pantalla y la cámara, y nada más');
        t.eq(g.segundos, 25, 'y el vídeo durará la suma de las tomas');
    });

    t.test('la cámara va abajo a la derecha, siempre', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];
        t.ok(filtro.includes(`overlay=W-w-${exportar.MARGEN}:H-h-${exportar.MARGEN}`),
            `pegada al borde de abajo y de la derecha, con su margen: ${filtro.slice(0, 200)}`);
        t.ok(filtro.includes(`scale=${exportar.CAMARA_LADO}:${exportar.CAMARA_LADO}`),
            'cuadrada y chica');
        t.ok(filtro.includes("crop='min(iw,ih)':'min(iw,ih)'"),
            'recortada al cuadrado ANTES de achicar, que es lo que deja la cara');
        t.ok(filtro.includes(`scale=${exportar.ANCHO}:${exportar.ALTO}:force_original_aspect_ratio=decrease`),
            'y el fondo entero, sin deformar');
    });

    t.test('el recuadro de la cámara lleva las esquinas redondeadas', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 30, 40)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];

        // Una sola vez, repartida entre las tomas: `geq` cuesta por píxel y
        // por fotograma, y calcularla en cada uno duplica lo que tarda el corte.
        t.eq((filtro.match(/geq=/g) || []).length, 1, 'la máscara se calcula una vez');
        t.ok(filtro.includes('loop=loop=-1:size=1:start=0'), 'y después se repite');
        t.ok(filtro.includes('[mascara]split=2[m0][m1]'), 'una copia por toma');
        t.ok(filtro.includes('[c0][m0]alphamerge=shortest=1[e0]'), 'cada toma recorta la suya');
        t.ok(filtro.includes('[c1][m1]alphamerge=shortest=1[e1]'), 'sin pisarse');
    });

    t.test('sin cámara encima no se calcula ninguna máscara', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20, 'PV')],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];
        t.ok(!filtro.includes('geq='), `la cámara llena el cuadro, no hay esquina: ${filtro}`);
    });

    t.test('los trozos se pegan en orden y con su audio', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 30, 40)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];
        t.ok(filtro.includes('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]'), filtro.slice(-120));
        t.ok(filtro.includes('trim=start=10:end=20'), 'el primero');
        t.ok(filtro.includes('trim=start=30:end=40'), 'y el segundo');
    });

    t.test('con «Mejorar audio» cada toma lleva su ganancia y el conjunto su cadena', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20), toma(2, 30, 40)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({
            trozos: r.trozos,
            salida: '/tmp/x.mp4',
            audio: { porTrozo: [6, -3], programa: 'highpass=f=80,alimiter=limit=-1.5dB' }
        });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];
        t.ok(filtro.includes('volume=6.00dB'), 'la ganancia de la primera');
        t.ok(filtro.includes('volume=-3.00dB'), 'y la de la segunda, que es otra');
        // La etiqueta intermedia no puede ser `[aN]`: esas son las pistas de
        // los trozos, y `[a0]` ya está puesta.
        t.ok(filtro.includes('concat=n=2:v=1:a=1[v][apegado]'), filtro.slice(-160));
        t.ok(filtro.includes('[apegado]highpass=f=80,alimiter=limit=-1.5dB[a]'), filtro.slice(-160));
    });

    t.test('sin «Mejorar audio» el audio sale del concat sin nada en medio', () => {
        const r = exportar.repartir({
            tomas: [toma(1, 10, 20)],
            pantalla: video('pantalla', 0, 60),
            camara: video('camara', 0, 60),
            camaraConAudio: true,
            wavs: [wav(0, 60)]
        });
        const g = exportar.grafo({ trozos: r.trozos, salida: '/tmp/x.mp4' });
        const filtro = g.args[g.args.indexOf('-filter_complex') + 1];
        t.ok(!filtro.includes('volume='), 'ni una ganancia');
        t.ok(!filtro.includes('apegado'), 'ni un filtro de más que haya que atravesar');
        t.ok(filtro.includes('concat=n=1:v=1:a=1[v][a]'), filtro.slice(-120));
    });

    t.test('el fondo que llena el cuadro se recorta, y el que no, se rellena', () => {
        const con = exportar.grafo({
            trozos: exportar.repartir({
                tomas: [toma(1, 10, 20, 'PV')],
                pantalla: video('pantalla', 0, 60),
                camara: video('camara', 0, 60),
                camaraConAudio: true,
                wavs: [wav(0, 60)]
            }).trozos,
            salida: '/tmp/x.mp4'
        });
        const filtroCamara = con.args[con.args.indexOf('-filter_complex') + 1];
        t.ok(/force_original_aspect_ratio=increase/.test(filtroCamara), 'escala de más');
        t.ok(new RegExp(`crop=${exportar.ANCHO}:${exportar.ALTO}`).test(filtroCamara), 'y recorta');
        t.ok(!/pad=/.test(filtroCamara), 'sin bandas negras: la cara llena el cuadro');

        const sin = exportar.grafo({
            trozos: exportar.repartir({
                tomas: [toma(1, 10, 20, 'R')],
                pantalla: video('pantalla', 0, 60),
                camara: video('camara', 0, 60),
                camaraConAudio: true,
                wavs: [wav(0, 60)]
            }).trozos,
            salida: '/tmp/x.mp4'
        });
        const filtroPantalla = sin.args[sin.args.indexOf('-filter_complex') + 1];
        t.ok(/force_original_aspect_ratio=decrease/.test(filtroPantalla), 'la pantalla entra entera');
        t.ok(/pad=/.test(filtroPantalla), 'con lo que sobre en negro: recortarla se comería lo explicado');
    });

    t.test('sin tomas no hay grafo: lo dice en vez de armar un vídeo vacío', () => {
        let error = null;
        try { exportar.grafo({ trozos: [], salida: '/tmp/x.mp4' }); } catch (e) { error = e.message; }
        t.ok(error && /ninguna toma/.test(error), error);
    });

    t.test('el MP4 que ya existe no se pisa', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-export-'));
        const ruta = path.join(dir, 'semana.mp4');
        t.eq(exportar.alLado(ruta), ruta, 'si no hay nada, su nombre');
        fs.writeFileSync(ruta, 'el que ya mandó');
        t.eq(exportar.alLado(ruta), path.join(dir, 'semana 2.mp4'));
    });

    t.group('exportar vídeo · una sesión entera');

    /** Una sesión del modo semanal en el disco, con sus dos vídeos y su WAV. */
    function sembrar(opciones) {
        const o = opciones || {};
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-semanal-'));
        const secuencia = 'semana_2026-10-03_10-00-00';
        const ffmpeg = paths.ffmpeg();
        workspace.ensureDir(workspace.videoDir(dir));
        workspace.ensureDir(workspace.audioDir(dir));

        // Dos vídeos de colores planos distintos: el fondo rojo y la cámara
        // verde. Así se puede comprobar en la imagen final cuál quedó en cada
        // sitio, que es lo único que dice si el recuadro cayó donde se pidió.
        const hacer = (nombre, fuente, segundos) => {
            const ruta = path.join(workspace.videoDir(dir), `${secuencia}-${nombre}.mp4`);
            spawnSync(ffmpeg.path, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
                `${fuente}:size=640x360:rate=30:duration=${segundos}`,
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ruta]);
            return ruta;
        };
        const pantalla = hacer('pantalla', 'color=c=red', 12);
        const camara = hacer('camara', 'color=c=lime', 12);
        const audio = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
        spawnSync(ffmpeg.path, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
            'sine=frequency=440:sample_rate=48000:duration=12', audio]);

        const estado = vivo.estadoNuevo({ secuencia, curso: 'semana', ceroMs: T0, fps: 30 });
        estado.terminada = T0 + 12000;
        estado.sesiones = [{ archivo: audio, desdeMs: T0, segundos: 12, sampleRate: 48000, canales: 1 }];
        estado.videos = [
            { cual: 'pantalla', archivo: pantalla, tipo: 'video/mp4', empezoMs: T0, cerradoMs: T0 + 12000 },
            { cual: 'camara', archivo: camara, tipo: 'video/mp4', empezoMs: T0, cerradoMs: T0 + 12000 }
        ];
        // `R` es la vista de pantalla: pantalla de fondo con la cámara en la
        // esquina, que es lo que estas pruebas miran en la imagen.
        estado.tomas = o.tomas || [
            { id: 1, vista: 'R', inMs: T0 + 1000, outMs: T0 + 3000, palabras: [], comentarios: [] },
            { id: 2, vista: 'R', inMs: T0 + 6000, outMs: T0 + 9000, palabras: [], comentarios: [] }
        ];

        const archivos = workspace.archivosDeSesion(dir, secuencia);
        workspace.ensureDir(path.dirname(archivos.json));
        workspace.writeJson(archivos.json, notasXml.sidecar(estado));
        return { dir, secuencia, json: archivos.json };
    }

    if (!paths.ffmpeg().path) {
        t.skip('corta el vídeo de verdad y queda donde tiene que quedar', 'no hay ffmpeg en el disco');
        t.skip('sin ninguna toma no exporta nada, y los brutos se quedan', 'no hay ffmpeg en el disco');
        return;
    }

    t.test('corta el vídeo de verdad y queda donde tiene que quedar', async () => {
        const sitio = sembrar();
        const pasos = [];
        const r = await exportar.deSesion(sitio.json, { alProgreso: p => pasos.push(p.pct) });
        t.ok(r.ok, r.error || '');
        t.eq(r.tomas, 2);
        t.eq(r.segundos, 5, 'dos más tres segundos');
        t.eq(path.basename(r.ruta), `${sitio.secuencia}.mp4`);
        t.eq(path.dirname(r.ruta), sitio.dir, 'arriba, en la carpeta de la persona, no en xml/');
        t.ok(r.bytes > 10000, `y pesa algo: ${r.bytes} bytes`);
        t.ok(pasos.length > 0 && pasos[pasos.length - 1] === 100, `el progreso llega al final: ${pasos.join(',')}`);

        // La duración del archivo, medida: es la suma de las tomas y nada más.
        const dur = Number(spawnSync(paths.ffprobe().path, ['-v', 'error',
            '-show_entries', 'format=duration', '-of', 'csv=p=0', r.ruta], { encoding: 'utf8' }).stdout.trim());
        t.near(dur, 5, 0.12, `dura ${dur} s`);

        // Y la imagen: el medio es el fondo y la esquina de abajo a la derecha
        // es la cámara. Un píxel de cada sitio basta, porque son colores planos.
        const pixel = (x, y) => {
            const r2 = spawnSync(paths.ffmpeg().path, ['-v', 'error', '-i', r.ruta,
                '-vf', `crop=4:4:${x}:${y},scale=1:1`, '-frames:v', '1',
                '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
            return [r2.stdout[0], r2.stdout[1], r2.stdout[2]];
        };
        const medio = pixel(Math.round(exportar.ANCHO / 2), Math.round(exportar.ALTO / 2));
        t.ok(medio[0] > 100 && medio[1] < 80, `el fondo es la pantalla (roja): ${medio}`);
        const esquina = pixel(exportar.ANCHO - exportar.MARGEN - 100, exportar.ALTO - exportar.MARGEN - 60);
        t.ok(esquina[1] > 100 && esquina[0] < 80, `y la esquina es la cámara (verde): ${esquina}`);
        // Justo afuera del recuadro sigue estando el fondo: es lo que dice que
        // la cámara no se comió la pantalla entera.
        const fuera = pixel(10, exportar.ALTO - 100);
        t.ok(fuera[0] > 100 && fuera[1] < 80, `fuera del recuadro, la pantalla: ${fuera}`);

        // Y la punta del recuadro: dentro del cuadrado, pero fuera del
        // redondeo. Si ahí hay cámara, las esquinas salieron en pico.
        const punta = pixel(exportar.ANCHO - exportar.MARGEN - 8, exportar.ALTO - exportar.MARGEN - 8);
        t.ok(punta[0] > 100 && punta[1] < 80, `la esquina está redondeada: ${punta}`);
    });

    t.test('una toma de profesor sale con la cámara llenando el cuadro, y sin recuadro', async () => {
        const sitio = sembrar({
            tomas: [{ id: 1, vista: 'PV', inMs: T0 + 1000, outMs: T0 + 4000, palabras: [], comentarios: [] }]
        });
        const r = await exportar.deSesion(sitio.json);
        t.ok(r.ok, r.error || '');

        // La cámara es verde y la pantalla roja: si la vista se respetó, no
        // queda un solo píxel rojo en ninguna de las cuatro esquinas ni en el
        // medio. Es la comprobación de que la cámara llenó el cuadro Y de que
        // no se le superpuso nada.
        const pixel = (x, y) => {
            const r2 = spawnSync(paths.ffmpeg().path, ['-v', 'error', '-i', r.ruta,
                '-vf', `crop=4:4:${x}:${y},scale=1:1`, '-frames:v', '1',
                '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
            return [r2.stdout[0], r2.stdout[1], r2.stdout[2]];
        };
        const sitios = {
            'el medio': [exportar.ANCHO / 2, exportar.ALTO / 2],
            'arriba a la izquierda': [8, 8],
            'abajo a la izquierda': [8, exportar.ALTO - 12],
            'donde iría el recuadro': [exportar.ANCHO - exportar.MARGEN - 100, exportar.ALTO - exportar.MARGEN - 60]
        };
        for (const [donde, [x, y]] of Object.entries(sitios)) {
            const p = pixel(Math.round(x), Math.round(y));
            t.ok(p[1] > 100 && p[0] < 80, `${donde}: la cámara (verde), no la pantalla · ${p}`);
        }
    });

    t.test('un vídeo de cero bytes no mata la exportación: sale con el otro y se dice', async () => {
        // Es lo que pasó la primera vez que esto se usó de verdad: el
        // codificador rechazó la pantalla Retina, el archivo quedó en cero, y
        // ffmpeg se negó a abrirlo tirando la exportación entera abajo. El
        // vídeo tenía que salir igual, con la cámara.
        const sitio = sembrar();
        const vacio = path.join(workspace.videoDir(sitio.dir), `${sitio.secuencia}-pantalla.mp4`);
        fs.writeFileSync(vacio, '');

        const r = await exportar.deSesion(sitio.json);
        t.ok(r.ok, r.error || '');
        t.eq(r.tomas, 2, 'las dos tomas entran igual');
        t.ok(r.avisos.some(a => /No se grabó nada de la pantalla/.test(a)), r.avisos.join(' · '));
        t.ok(fs.existsSync(vacio), 'y el archivo vacío se queda donde estaba, sin borrarse');
    });

    t.test('el montaje del editor: cada toma, en qué segundo de qué archivo', async () => {
        const sitio = sembrar();
        const r = exportar.montajeDeSesion(sitio.json);
        t.ok(r.ok, r.error || '');
        t.eq(r.tomas.length, 2);
        t.deep(r.tomas.map(x => x.id), [1, 2], 'en orden');
        t.eq(r.tomas[0].vista, 'R', 'con la vista que tiene hoy, para poder cambiarla');
        t.eq(r.tomas[0].descartada, false);
        t.near(r.tomas[0].segundos, 2, 0.01, 'y su duración ya ajustada');
        t.eq(r.tomas[0].fondo, 'pantalla', 'la vista R se ve con la pantalla');
        t.ok(r.archivos.camara && r.archivos.pantalla, 'los dos archivos, una sola vez');
        for (const toma of r.tomas) {
            t.ok(toma.camaraDesde >= 0, `la toma ${toma.id} sabe dónde cae en la cámara`);
            t.ok(toma.pantallaDesde >= 0, 'y en la pantalla');
        }
        t.ok(r.recuadro.lado > 0 && r.recuadro.lado < 1, 'y el recuadro, en partes del ancho');
    });

    t.test('el montaje y el corte eligen el MISMO fondo en cada toma', async () => {
        // Es lo único que de verdad importa de esta función: si el preview
        // eligiera distinto que ffmpeg, lo que se mira no sería lo que sale.
        const sitio = sembrar({
            tomas: [
                { id: 1, vista: 'PV', inMs: T0 + 1000, outMs: T0 + 3000, palabras: [], comentarios: [] },
                { id: 2, vista: 'R', inMs: T0 + 6000, outMs: T0 + 9000, palabras: [], comentarios: [] }
            ]
        });
        const m = exportar.montajeDeSesion(sitio.json);
        t.deep(m.tomas.map(x => x.fondo), ['camara', 'pantalla']);
        t.eq(m.tomas[0].encima, undefined, 'la toma de cámara no lleva recuadro');
        t.ok(m.tomas[1].camaraDesde != null, 'y la de pantalla sí sabe dónde está la cara');
    });

    t.test('una toma descartada también viene en el montaje: hay que poder volver a meterla', async () => {
        const sitio = sembrar({
            tomas: [
                { id: 1, vista: 'R', inMs: T0 + 1000, outMs: T0 + 3000, palabras: [], comentarios: [],
                  descartada: true },
                { id: 2, vista: 'R', inMs: T0 + 6000, outMs: T0 + 9000, palabras: [], comentarios: [] }
            ]
        });
        const r = exportar.montajeDeSesion(sitio.json);
        t.eq(r.tomas.length, 2, 'las dos están');
        t.eq(r.tomas[0].descartada, true, 'marcada');
        t.ok(r.tomas[0].pantallaDesde != null, 'y con dónde mirarla');
    });

    t.test('sin ninguna toma no exporta nada, y los brutos se quedan', async () => {
        const sitio = sembrar({ tomas: [] });
        const r = await exportar.deSesion(sitio.json);
        t.eq(r.ok, false);
        t.ok(/ninguna toma/.test(r.error), r.error);
        t.ok(/quedaron guardados/.test(r.error), 'y dice que el material está a salvo');
        const brutos = fs.readdirSync(workspace.videoDir(sitio.dir));
        t.eq(brutos.length, 2, 'los dos vídeos siguen ahí');
    });
};
