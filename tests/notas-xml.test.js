'use strict';
/**
 * El XML: los dos juegos de marcadores, el audio en A1 y los cuadros.
 *
 * Es el archivo que el editor importa, así que lo que se fija acá es lo que él
 * va a ver en Premiere. Lo más importante de todo es la ida y vuelta: escribir
 * el XML y volver a leerlo tiene que devolver las mismas tomas y las mismas
 * claquetas, porque si no lo que se escribió no significa lo que se cree.
 */

const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const rodecaster = require('../engine/rodecaster-xml');

const T0 = Date.parse('2026-09-29T10:00:00');

function conUnaToma(extra) {
    const e = vivo.estadoNuevo({
        secuencia: 'curso_2026-09-29_10-00-00', curso: 'curso', ceroMs: T0, fps: 30
    });
    e.sesiones = [{
        archivo: '/tmp/nt/Audio/curso-1.wav', desdeMs: T0, segundos: 600,
        sampleRate: 48000, canales: 1
    }];
    e.tomas = [{
        id: 1, vista: 'PV', comentario: 'La intro', cuenta: '3, 2, 1.',
        inMs: T0 + 20000, outMs: T0 + 80000, descartada: false,
        palabras: [{ t: T0 + 20000, texto: 'Hola' }, { t: T0 + 21000, texto: 'mundo' }],
        comentarios: []
    }];
    return Object.assign(e, extra || {});
}

module.exports = function (t) {
    t.group('notas-xml · los cuadros');

    t.test('el cero es el botón Iniciar', () => {
        t.eq(notasXml.aCuadros(T0, T0, 30), 0);
    });

    t.test('un segundo a 30 son 30 cuadros', () => {
        t.eq(notasXml.aCuadros(T0 + 1000, T0, 30), 30);
    });

    t.test('a 25 son 25', () => {
        t.eq(notasXml.aCuadros(T0 + 1000, T0, 25), 25);
    });

    t.test('a 29.97 se cuenta con la fracción y no con 30', () => {
        // Diez minutos a 29.97: 17.982 cuadros, no 18.000. La diferencia son
        // 18 cuadros, y el editor sincroniza mirando ese número.
        t.eq(notasXml.aCuadros(T0 + 600000, T0, 29.97), 17982);
    });

    t.test('algo dicho antes del cero no va a un cuadro negativo', () => {
        t.eq(notasXml.aCuadros(T0 - 5000, T0, 30), 0);
    });

    t.group('notas-xml · los marcadores de la secuencia');

    t.test('cada toma da un par IN/OUT', () => {
        const marcas = notasXml.marcadores(conUnaToma());
        t.eq(marcas.length, 2);
        t.eq(marcas[0].name, 'PV');
        t.eq(marcas[1].comment, 'OUT: Hola mundo');
    });

    t.test('el IN dura y el OUT no: es lo que los distingue', () => {
        const marcas = notasXml.marcadores(conUnaToma());
        t.eq(marcas[0].endSec - marcas[0].startSec, notasXml.SEGUNDOS_DEL_MARCADOR_IN);
        t.eq(marcas[1].endSec, undefined);
        t.ok(marcas[1].puntoComoIn, 'el OUT escribe su `out` igual que su `in`');
    });

    t.test('una claqueta da un marcador blanco con su número', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, {
            ms: T0 + 12000, paredMs: T0 + 12000, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe'
        });
        const marca = notasXml.marcadores(e).find(m => m.name === 'Claqueta 1');
        t.eq(marca.color, notasXml.BLANCO);
        t.ok(marca.comment.includes('referencia de sincronía'), 'la primera lo dice');
        t.ok(marca.comment.includes('10:00:12'), 'y lleva la hora del día');
        t.ok(marca.comment.includes('Claqueta 1, clase 1'), 'y lo que se oyó');
    });

    t.test('una claqueta sin confirmar lo dice en el comentario', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, confirmada: false, origen: 'golpe' });
        const marca = notasXml.marcadores(e).find(m => m.name === 'Claqueta 1');
        t.ok(marca.comment.includes('sin confirmar'));
    });

    t.test('solo la primera claqueta es la referencia', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, { ms: T0 + 12000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, { ms: T0 + 300000, confirmada: true, origen: 'golpe' });
        const marcas = notasXml.marcadores(e);
        const ref = marcas.filter(m => (m.comment || '').includes('referencia de sincronía'));
        t.eq(ref.length, 1);
    });

    t.group('notas-xml · el audio en A1');

    t.test('el WAV entra como clip con su offset contra el cero', () => {
        const clips = notasXml.clipsDeAudio(conUnaToma());
        t.eq(clips.length, 1);
        t.eq(clips[0].startSec, 0);
        t.eq(clips[0].endSec, 600);
        t.eq(clips[0].source.path, '/tmp/nt/Audio/curso-1.wav');
    });

    t.test('un segundo WAV entra en su lugar, con el hueco del medio', () => {
        // Es lo que pasa cuando el dispositivo se cae y se reabre, o cuando se
        // reanuda una sesión: pegarlos uno detrás del otro correría todo lo
        // que viene después.
        const e = conUnaToma();
        e.sesiones.push({
            archivo: '/tmp/nt/Audio/curso-2.wav', desdeMs: T0 + 900000, segundos: 300,
            sampleRate: 48000, canales: 1
        });
        const clips = notasXml.clipsDeAudio(e);
        t.eq(clips.length, 2);
        t.eq(clips[1].startSec, 900, 'arranca a los quince minutos y no pegado al primero');
    });

    t.test('los marcadores del clip se miden desde el arranque del WAV', () => {
        const e = conUnaToma();
        e.sesiones = [{
            archivo: '/tmp/nt/Audio/curso-2.wav', desdeMs: T0 + 10000, segundos: 600,
            sampleRate: 48000, canales: 1
        }];
        const clip = notasXml.clipsDeAudio(e)[0];
        const marcaIn = clip.marcadores.find(m => m.name === 'PV');
        // El IN de la toma está a 20 s del cero y el WAV arranca a los 10 s:
        // dentro del clip cae a los 10 s.
        t.eq(marcaIn.startSec, 10);
    });

    t.test('un marcador de otro WAV no entra en este clip', () => {
        const e = conUnaToma();
        e.sesiones = [{
            archivo: '/tmp/nt/Audio/curso-2.wav', desdeMs: T0 + 900000, segundos: 300,
            sampleRate: 48000, canales: 1
        }];
        const clip = notasXml.clipsDeAudio(e)[0];
        t.eq(clip.marcadores.length, 0, 'la toma pasó mucho antes de que empezara este WAV');
    });

    t.group('notas-xml · el archivo');

    t.test('lleva la firma, y el lector la reconoce', () => {
        // Las dos mitades: que se escriba y que se lea. Con solo la primera, la
        // firma puede quedar diciendo el nombre de la app de la que salió esta
        // —pasó— y el lector no reconoce como propio un XML que sí lo es.
        const e = conUnaToma();
        t.ok(notasXml.xmlDeNotas(e).includes(notasXml.FIRMA));
        t.ok(rodecaster.parseXml(notasXml.xmlDeNotas(e)).deNotasEnVivo);
    });

    t.test('los marcadores van dos veces: en la secuencia y en el clip', () => {
        const xml = notasXml.xmlDeNotas(conUnaToma());
        const todos = xml.match(/<marker>/g) || [];
        t.eq(todos.length, 4, 'dos de la toma, duplicados');
        t.ok(/<clipitem[\s\S]*?<marker>/.test(xml), 'hay marcadores adentro del clip');
    });

    t.test('a 29.97 el XML declara timebase 30 con ntsc', () => {
        const xml = notasXml.xmlDeNotas(conUnaToma({ fps: 29.97 }));
        t.ok(xml.includes('<timebase>30</timebase><ntsc>TRUE</ntsc>'));
        t.ok(xml.includes('displayformat>DF<'), 'y el timecode es drop-frame');
    });

    t.test('a 25 no es NTSC', () => {
        const xml = notasXml.xmlDeNotas(conUnaToma({ fps: 25 }));
        t.ok(xml.includes('<timebase>25</timebase><ntsc>FALSE</ntsc>'));
        t.ok(xml.includes('displayformat>NDF<'));
    });

    t.test('sin audio todavía, el XML sale igual', () => {
        // Los primeros segundos de una sesión: el WAV existe pero no tiene
        // nada. El archivo tiene que ser legible en todo momento.
        const e = conUnaToma();
        e.sesiones = [];
        const xml = notasXml.xmlDeNotas(e);
        t.ok(xml.includes('<xmeml'));
        t.eq((xml.match(/<clipitem /g) || []).length, 0);
    });

    t.group('notas-xml · la ida y la vuelta');

    t.test('lo que se escribe se vuelve a leer igual', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, {
            ms: T0 + 12000, frase: 'Claqueta 1, clase 1', confirmada: true, origen: 'golpe'
        });
        const leido = rodecaster.parseXml(notasXml.xmlDeNotas(e));
        t.ok(leido.ok, 'se puede leer');
        t.eq(leido.blocks.length, 1, 'una toma y no dos');
        t.eq(leido.blocks[0].view, 'PV');
        t.eq(leido.blocks[0].note, 'La intro');
        t.eq(leido.blocks[0].count, '3, 2, 1.');
        t.near(leido.blocks[0].startSec, 20, 0.05);
        t.near(leido.blocks[0].endSec, 80, 0.05);
    });

    t.test('los marcadores del clip no se cuentan como bloques', () => {
        // Los dos juegos son un `<marker>` y solo se distinguen por dónde
        // cuelgan: barrer el cuerpo entero devolvía cada toma dos veces y el
        // resultado eran bloques solapados de punta a punta.
        const leido = rodecaster.parseXml(notasXml.xmlDeNotas(conUnaToma()));
        t.deep(leido.problems || [], []);
    });

    t.group('notas-xml · el sidecar');

    t.test('guarda el fps y cómo se escribe', () => {
        const s = notasXml.sidecar(conUnaToma({ fps: 29.97 }));
        t.eq(s.fps, 29.97);
        t.deep(s.rate, { timebase: 30, ntsc: true, num: 30000, den: 1001 });
    });

    t.test('guarda las claquetas con sus dos relojes', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, {
            ms: T0 + 12000, paredMs: T0 + 12500, confirmada: true, origen: 'golpe'
        });
        const c = notasXml.sidecar(e).claquetas[0];
        t.eq(c.ms, T0 + 12000);
        t.eq(c.paredMs, T0 + 12500);
        t.ok(c.msISO.startsWith('2026-09-29'));
    });

    t.test('una sesión sin cerrar no dice `terminada`', () => {
        t.eq(notasXml.sidecar(conUnaToma()).terminada, null);
    });

    t.test('estadoLeido deja los contadores donde iban', () => {
        const e = conUnaToma();
        vivo.anotarClaqueta(e, { ms: T0 + 1000, confirmada: true, origen: 'golpe' });
        const vuelto = notasXml.estadoLeido(JSON.parse(JSON.stringify(notasXml.sidecar(e))));
        t.eq(vuelto.proximaClaqueta, 1);
    });
};
