'use strict';
/**
 * Lo dicho entre dos tomas no desaparece a los diez minutos.
 *
 * El colchón de sueltas se recorta a diez minutos (`VENTANA_DE_SUELTAS_SEC`), y
 * con él se iba el texto de entre dos tomas viejas: abierta la tarjeta de una
 * para correrle el OUT, solo quedaba el gris de su relectura. Lo que está cerca
 * de un borde pasa a la orilla de esa toma antes de tirarse, y una relectura
 * posterior no lo pisa.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const vivo = require('../engine/notas-vivo');
const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');

const T0 = 1_000_000_000;
const w = (s, texto) => ({ t: T0 + s * 1000, texto, hasta: T0 + s * 1000 + 300 });
const toma = (id, inS, outS, extra) => ({ id, vista: 'PV', inMs: T0 + inS * 1000, outMs: T0 + outS * 1000, palabras: [], antes: [], despues: [], ...extra });
const textos = ws => (ws || []).map(x => x.texto);
const pedazo = () => Buffer.alloc(48000 * 2);

module.exports = function (t) {
    t.group('orillas rescatadas · lo que el colchón tira');

    t.test('lo que está cerca de un borde pasa a la orilla, y lo lejano se tira', () => {
        const a = toma(1, 0, 10);
        const b = toma(2, 200, 210);
        const estado = { tomas: [a, b] };
        vivo.guardarEnLasOrillas(estado, [w(20, 'cerca-de-a'), w(100, 'lejos'), w(180, 'cerca-de-b')]);
        t.deep(textos(a.despues), ['cerca-de-a']);
        t.deep(textos(b.antes), ['cerca-de-b']);
        t.ok(!textos(a.despues).concat(textos(b.antes)).includes('lejos'), `a más de ${vivo.ORILLA_RESCATADA_SEC} s de las dos`);
    });

    t.test('entre dos tomas cercanas queda en las dos orillas, cada tarjeta con la suya', () => {
        const a = toma(1, 0, 10);
        const b = toma(2, 30, 40);
        vivo.guardarEnLasOrillas({ tomas: [a, b] }, [w(20, 'medio')]);
        t.deep(textos(a.despues), ['medio']);
        t.deep(textos(b.antes), ['medio']);
    });

    t.test('no escribe dos veces lo que la relectura ya dejó en ese instante', () => {
        const a = toma(1, 0, 10, { despues: [w(12, 'Bueno,')] });
        vivo.guardarEnLasOrillas({ tomas: [a] }, [w(12.1, 'bueno'), w(30, 'después')]);
        t.deep(textos(a.despues), ['Bueno,', 'después'], 'en orden y sin repetir');
    });

    t.test('una desactivada no se queda con nada: su tramo es de nadie', () => {
        const apagada = toma(1, 0, 10, { descartada: true });
        vivo.guardarEnLasOrillas({ tomas: [apagada] }, [w(20, 'x')]);
        t.deep(apagada.despues, []);
    });

    t.group('orillas rescatadas · en una clase que corre');

    t.test('el recorte de los diez minutos deja en la orilla lo de cerca', async () => {
        const antes = { tramo: oirToma.tramo };
        const st = grabacion.iniciar({
            dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-orillas-')), curso: 'o', fps: 30, sinReloj: true, sampleRate: 48000
        });
        try {
            const s = grabacion._sesion();
            const at = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });
            s.estado.tomas.push({ ...toma(1, 0, 0), inMs: st.ceroMs + 10000, outMs: st.ceroMs + 20000 });
            s.estado.proximaToma = 1;
            s.estado.sueltas = [at(25, 'pegado'), at(60, 'cerca'), at(200, 'lejos')];
            for (let i = 0; i < 3; i++) grabacion.pcm(pedazo());
            // Media hora después: la última palabra oída es de ahí, y con la
            // próxima pasada el colchón se recorta.
            s.estado.ultimaPalabraMs = st.ceroMs + 1800 * 1000;
            oirToma.tramo = async () => ({ palabras: [at(2, 'ahora'), at(2.4, 'sí')] });
            await grabacion.buscarSenales();
            const t1 = s.estado.tomas[0];
            t.ok(!s.estado.sueltas.some(x => x.texto === 'pegado'), 'el colchón lo soltó');
            t.deep(textos(t1.despues), ['pegado', 'cerca'], 'y la toma lo tiene en su orilla');
        } finally {
            oirToma.tramo = antes.tramo;
            grabacion.apagar();
        }
    });

    t.test('releer la toma no pisa lo rescatado más allá de lo leído', async () => {
        const antes = { tramo: oirToma.tramo, escuchar: oir.escuchar };
        const st = grabacion.iniciar({
            dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-orillas-')), curso: 'o', fps: 30, sinReloj: true, sampleRate: 48000
        });
        const at = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });
        const dicho = [at(1, '3,'), at(1.4, '2,'), at(1.8, '1.'), at(2.6, 'hola'), at(3, 'mundo'), at(6, 'pausa.')];
        oirToma.tramo = async () => ({ palabras: dicho });
        // El modelo grande lee solo lo que se le pide: la toma y su orilla corta.
        oir.escuchar = async p => ({
            palabras: dicho.filter(x => x.t >= p.desdeMs && x.t < p.hastaMs), colapsadas: 0, mudas: 0, quitadas: [], inventadas: []
        });
        try {
            for (let i = 0; i < 5; i++) grabacion.pcm(pedazo());
            await grabacion.buscarSenales();
            const s = grabacion._sesion();
            const t1 = s.estado.tomas[0];
            grabacion.cerrarToma(st.ceroMs + 4000);
            // Lo que el colchón dejó lejos, a cuarenta segundos del OUT.
            t1.despues = (t1.despues || []).concat([at(44, 'rescatada')]);
            oirToma.tramo = async () => ({ palabras: [] });
            for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
            await grabacion.buscarSenales();
            await new Promise(r => setTimeout(r, 60));
            t.ok(t1.releida, 'se releyó');
            t.ok(textos(t1.despues).includes('rescatada'), textos(t1.despues).join(' '));
        } finally {
            oirToma.tramo = antes.tramo;
            oir.escuchar = antes.escuchar;
            grabacion.apagar();
        }
    });
};
