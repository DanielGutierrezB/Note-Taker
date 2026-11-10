'use strict';
/**
 * La nota de una claqueta, en las clases grabadas cuando la app todavía las
 * anotaba. Ya no se escribe desde la app, pero la que trae un sidecar viejo
 * tiene que seguir llegando a su marcador y sobrevivir a la fusión.
 */

const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const rodecaster = require('../engine/rodecaster-xml');

const T0 = Date.parse('2026-09-30T12:04:00');

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

/** El marcador de la claqueta `n` dentro de los que salen al XML. */
function marcadorDe(estado, n) {
    return notasXml.marcadores(estado).find(m => m.name === `Claqueta ${n}`);
}

module.exports = function (t) {
    t.group('nota de claqueta · el campo en el modelo');

    t.test('una claqueta nace con la nota vacía, la anote quien la anote', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, { ms: T0 + 60000, confirmada: true, origen: 'editor' });
        t.eq(e.claquetas[0].comentario, '');
        t.eq(e.claquetas[1].comentario, '');
    });

    t.group('nota de claqueta · sobrevive a la fusión');

    t.test('el aplauso llega después y le pone origen y hora: la nota se queda', () => {
        // Como pasaba en vivo: la K anotaba la claqueta, el editor le escribía
        // la nota, y doce segundos más tarde Whisper confirmaba la palabra dicha.
        const e = nuevo();
        const puesta = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'editor'
        }).claqueta;
        puesta.comentario = 'Se cortó la cámara 2';

        vivo.anotarClaqueta(e, {
            ms: T0 + 11200, paredMs: T0 + 11200, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe,voz'
        });

        t.eq(e.claquetas.length, 1, 'se fundieron en una');
        t.eq(e.claquetas[0].comentario, 'Se cortó la cámara 2');
        t.eq(e.claquetas[0].frase, 'Claqueta 1, clase 1', 'y la frase nueva también entró');
        t.eq(e.claquetas[0].origen, 'editor,golpe,voz');
    });

    t.test('y al revés: la que llega con nota se la deja a la que ya estaba', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, {
            ms: T0 + 12000, comentario: 'desde el historial', confirmada: true, origen: 'editor'
        });
        t.eq(e.claquetas.length, 1);
        t.eq(e.claquetas[0].comentario, 'desde el historial');
    });

    t.group('nota de claqueta · cómo viaja al XML');

    t.test('va en el comentario del marcador, detrás del número', () => {
        const e = nuevo();
        const { claqueta } = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe,voz'
        });
        claqueta.comentario = 'Cámara 2 arrancó tarde';
        const m = marcadorDe(e, 1);
        t.eq(m.name, 'Claqueta 1', 'el nombre no lo toca: es por lo que se la reconoce');
        t.ok(m.comment.startsWith('Claqueta 1 · Cámara 2 arrancó tarde · '),
            `la nota va segunda: ${m.comment}`);
        t.ok(m.comment.includes('referencia de sincronía'), 'y lo demás sigue estando');
        t.ok(m.comment.includes('«Claqueta 1, clase 1»'));
    });

    t.test('sin nota, el comentario es exactamente el de siempre', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, {
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
        const { claqueta } = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'golpe'
        });
        claqueta.comentario = 'Sin la palabra que lo delata';
        const leido = rodecaster.parseXml(notasXml.xmlDeNotas(e));
        t.ok(leido.clap, 'la encontró');
        t.ok(leido.clap.comment.includes('Sin la palabra que lo delata'), 'y con la nota puesta');
    });
};
