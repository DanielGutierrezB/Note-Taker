'use strict';
/**
 * Una relectura que no escribe nada no borra la nota.
 *
 * Luisa, 18/11: «quise recorrer un OUT y se borró toda la nota». Mover el borde
 * manda a releer la toma, y si el modelo grande no escribía nada —una voz que
 * entra baja por la llamada queda debajo del corte de nivel, o un tramo donde
 * solo inventa— el reparto dejaba la toma sin una palabra.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');

const RAIZ = path.join(__dirname, '..');
const pedazo = () => Buffer.alloc(48000 * 2);
const reposo = () => new Promise(r => setTimeout(r, 60));

/** Una toma abierta por el conteo con diez palabras, y lo que contesta la relectura. */
async function conUnaToma(t, releida) {
    const antes = { tramo: oirToma.tramo, escuchar: oir.escuchar };
    const st = grabacion.iniciar({
        dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-vacia-')), curso: 'v', fps: 30, sinReloj: true, sampleRate: 48000
    });
    const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 300 });
    const dicho = [w(1000, '3,'), w(1400, '2,'), w(1800, '1.')];
    for (let i = 0; i < 10; i++) dicho.push(w(2600 + i * 400, `p${i + 1}`));
    oirToma.tramo = async () => ({ palabras: dicho });
    oir.escuchar = async p => ({
        palabras: releida(dicho).filter(x => x.t >= p.desdeMs && x.t < p.hastaMs),
        colapsadas: 0, mudas: 0, quitadas: [], inventadas: []
    });
    try {
        for (let i = 0; i < 9; i++) grabacion.pcm(pedazo());
        await grabacion.buscarSenales();
        oirToma.tramo = async () => ({ palabras: [] });
        grabacion.cerrarToma(st.ceroMs + 5500);
        for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
        await grabacion.buscarSenales();
        await reposo();
        return grabacion._sesion().estado.tomas[0];
    } finally {
        oirToma.tramo = antes.tramo;
        oir.escuchar = antes.escuchar;
        grabacion.apagar();
    }
}

module.exports = function (t) {
    t.group('relectura vacía · la nota se queda');

    t.test('si el modelo grande no escribe nada, la toma conserva el texto del vivo', async () => {
        const toma = await conUnaToma(t, () => []);
        t.ok(toma.palabras.length > 0, `quedaron ${toma.palabras.length} palabras`);
        t.eq(toma.palabras[0].texto, 'p1');
        t.eq(toma.relectura && toma.relectura.estado, 'sin-leer', 'y queda marcada para Regenerar');
        t.ok(/no escribió nada/.test(toma.relectura.porque), toma.relectura.porque);
        t.ok(!toma.releida, 'sin dar el tramo por leído: el próximo borde vuelve a pedirlo');
    });

    t.test('con texto, la relectura manda como siempre', async () => {
        const toma = await conUnaToma(t, dicho => dicho.map(w => (w.texto === 'p1' ? { ...w, texto: 'P1' } : w)));
        t.eq(toma.palabras[0].texto, 'P1');
        t.eq(toma.relectura, null);
    });

    t.group('relectura vacía · la pantalla dibuja la respuesta');

    t.test('soltar un borde o deshacer no deja congelado el texto bajo el puntero', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        const enviar = js.slice(js.indexOf('const enviar = hacer =>'), js.indexOf('const soltar = enviar('));
        t.ok(/if \(sobreBorde === clave\) sobreBorde = null;\s*pintar\(\);/.test(enviar), 'al contestar el motor');
        t.ok(/const volver = cual => historia\.volver\(cual, nuevo => \{ estado = nuevo; sobreBorde = null; pintar\(\); \}\);/.test(js),
            'y al deshacer o rehacer');
    });

    t.group('compacto · el borde se mueve sobre el texto entero');

    t.test('esconde lo gris solo de las terminadas, y nunca mientras se arrastra', () => {
        const css = fs.readFileSync(path.join(RAIZ, 'src', 'css', '03-armazon.css'), 'utf8');
        t.ok(css.includes('.es-compacto .transcript.es-cerrada:not(.es-moviendo) .es-orilla'), 'la regla');
        t.ok(!/\.es-compacto \.transcript:not\(\.es-inactiva\)/.test(css), 'y no la de antes, que tocaba la abierta');
    });

    t.test('arranca apagado: la preferencia vieja no se hereda', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        t.ok(/pref\.leer\('vivo\.compactoTerminadas', false\)/.test(js));
        t.ok(!/'vivo\.compacto'/.test(js));
    });

    t.test('al agarrar, la línea sigue donde la vio la mano aunque el texto se reacomode', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js'), 'utf8');
        t.ok(/const desfase = seguirALaLinea\(texto, b, agarre\);/.test(js));
        t.ok(/const span = palabraBajo\(texto, x, y\);/.test(js), 'y el arrastre mide con el desfase');
    });
};
