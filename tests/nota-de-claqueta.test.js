'use strict';
/**
 * La nota de una claqueta, en las clases grabadas cuando la app todavía las
 * anotaba. Ya no se escribe desde la app, pero la que trae un sidecar viejo
 * tiene que seguir llegando a su marcador.
 */

const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const rodecaster = require('../tools/rodecaster-xml');
const claquetaVieja = require('./fixtures/claqueta-vieja');

const T0 = Date.parse('2026-09-30T12:04:00');

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

/** El marcador de la claqueta `n` dentro de los que salen al XML. */
function marcadorDe(estado, n) {
    return notasXml.marcadores(estado).find(m => m.name === `Claqueta ${n}`);
}

module.exports = function (t) {
    t.group('nota de claqueta · cómo viaja al XML');

    t.test('va en el comentario del marcador, detrás del número', () => {
        const e = nuevo();
        claquetaVieja(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, frase: 'Claqueta 1, clase 1',
            comentario: 'Cámara 2 arrancó tarde', confirmada: true, origen: 'golpe,voz'
        });
        const m = marcadorDe(e, 1);
        t.eq(m.name, 'Claqueta 1', 'el nombre no lo toca: es por lo que se la reconoce');
        t.ok(m.comment.startsWith('Claqueta 1 · Cámara 2 arrancó tarde · '),
            `la nota va segunda: ${m.comment}`);
        t.ok(m.comment.includes('referencia de sincronía'), 'y lo demás sigue estando');
        t.ok(m.comment.includes('«Claqueta 1, clase 1»'));
    });

    t.test('sin nota, el comentario es exactamente el de siempre', () => {
        const e = nuevo();
        claquetaVieja(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'golpe'
        });
        t.ok(marcadorDe(e, 1).comment.startsWith('Claqueta 1 · referencia de sincronía'));
    });

    t.test('el XML de vuelta la sigue reconociendo como claqueta', () => {
        // `isClapMarker` busca "claqueta" en el COMENTARIO. Una nota que no la
        // diga no puede hacer que el marcador deje de serlo, y por eso el
        // número va delante y la nota detrás.
        const e = nuevo();
        e.sesiones = [{ archivo: '/tmp/x.wav', desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
        claquetaVieja(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, comentario: 'Sin la palabra que lo delata',
            confirmada: true, origen: 'golpe'
        });
        const leido = rodecaster.parseXml(notasXml.xmlDeNotas(e));
        t.ok(leido.clap, 'la encontró');
        t.ok(leido.clap.comment.includes('Sin la palabra que lo delata'), 'y con la nota puesta');
    });
};
