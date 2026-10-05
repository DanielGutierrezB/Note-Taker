'use strict';
/**
 * «Quitar silencios»: que el vídeo de la semana no dure cinco segundos de más
 * cada vez que la persona se queda pensando.
 *
 * Los WAV son sintéticos y dicen en su forma lo que se prueba: dónde hay voz,
 * dónde hay silencio y cuánto dura cada cosa, así que el corte esperado se
 * puede escribir como un número y no como una impresión. El silencio se
 * escribe con el RUIDO de un micrófono de verdad y no con ceros: el umbral se
 * estima del propio archivo, y un archivo de ceros exactos no probaría nada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ajustar = require('../engine/ajustar-corte');
const silencios = require('../engine/quitar-silencios');

/** El piso de ruido medido con AirPods: −65 dBFS, no silencio digital. */
const RUIDO = Math.pow(10, -65 / 20) * Math.SQRT2;
/** Voz normal: −22 dBFS. */
const VOZ = Math.pow(10, -22 / 20) * Math.SQRT2;

function wav(tramos) {
    const tasa = 16000;
    const muestras = [];
    for (const [seg, amp] of tramos) {
        for (let i = 0; i < Math.round(seg * tasa); i++) {
            muestras.push(Math.round(Math.sin(i / 5) * amp * 32767));
        }
    }
    const datos = Buffer.alloc(muestras.length * 2);
    muestras.forEach((v, i) => datos.writeInt16LE(v, i * 2));
    const cab = Buffer.alloc(44);
    cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
    cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
    cab.writeUInt32LE(tasa, 24); cab.writeUInt32LE(tasa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
    cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-silencios-'));
    const archivo = path.join(dir, 'x.wav');
    fs.writeFileSync(archivo, Buffer.concat([cab, datos]));
    ajustar.olvidar();
    return archivo;
}

/**
 * Una toma de 30,0 a 39,5 con un silencio largo y uno corto:
 *
 *   30,0 → 32,0  habla
 *   32,0 → 35,0  callada tres segundos   ← este se quita
 *   35,0 → 37,0  habla
 *   37,0 → 37,5  medio segundo de pausa  ← este se queda
 *   37,5 → 39,5  habla
 *
 * Los treinta segundos de sala de cada punta son para que el piso de ruido se
 * pueda estimar, que es lo que hace el motor de verdad con una sesión entera.
 */
function conUnHueco() {
    return wav([
        [30, RUIDO],
        [2, VOZ], [3, RUIDO], [2, VOZ], [0.5, RUIDO], [2, VOZ],
        [30, RUIDO]
    ]);
}

function sesionDe(archivo) {
    const w = ajustar.abrir(archivo);
    const segundos = w ? w.segundos : 0;
    ajustar.cerrar(w);
    return { sesiones: [{ archivo, desdeMs: 0, segundos }] };
}

const LA_TOMA = { id: 1, vista: 'R', desdeMs: 30000, hastaMs: 39500 };
const cerca = (a, b, margen) => Math.abs(a - b) <= (margen == null ? 120 : margen);

module.exports = function (t) {
    t.group('quitar silencios · el hueco largo se acorta y el corto se queda');

    t.test('una toma con un silencio de 3 s sale en dos pedazos', () => {
        const estado = sesionDe(conUnHueco());
        const r = silencios.partir([LA_TOMA], estado);
        t.eq(r.tomas.length, 2, 'un hueco largo, dos pedazos');
        t.eq(r.huecos, 1);
        t.eq(r.tomas[0].id, 1, 'los dos siguen siendo la toma 1');
        t.eq(r.tomas[1].id, 1);
        t.eq(r.tomas[1].vista, 'R', 'y con su vista');
    });

    t.test('el corte cae donde está el silencio, con su aire a cada lado', () => {
        const estado = sesionDe(conUnHueco());
        const [uno, dos] = silencios.partir([LA_TOMA], estado).tomas;
        // El hueco va de 32,0 a 35,0 y quedan 0,3 s: 0,15 de cada lado.
        t.ok(uno.desdeMs === 30000, 'el primero empieza donde empieza la toma');
        t.ok(cerca(uno.hastaMs, 32150), `cierra en 32,15 s y cerró en ${uno.hastaMs / 1000}`);
        t.ok(cerca(dos.desdeMs, 34850), `abre en 34,85 s y abrió en ${dos.desdeMs / 1000}`);
        t.ok(dos.hastaMs === 39500, 'y el último termina donde termina la toma');
    });

    t.test('el medio segundo de pausa no se toca', () => {
        // Es el que hace que la persona hable como habla: quitarlo deja el
        // vídeo atropellado, y por eso el umbral son 0,7 s y no cualquiera.
        const estado = sesionDe(conUnHueco());
        const r = silencios.partir([LA_TOMA], estado);
        const dentro = r.tomas.some(p => p.desdeMs < 37000 && p.hastaMs > 37500);
        t.ok(dentro, 'la pausa de 37,0 a 37,5 queda dentro de un pedazo');
    });

    t.test('se quita lo que se dice que se quitó', () => {
        const estado = sesionDe(conUnHueco());
        const r = silencios.partir([LA_TOMA], estado);
        const suma = r.tomas.reduce((s, p) => s + (p.hastaMs - p.desdeMs), 0);
        const quitado = (LA_TOMA.hastaMs - LA_TOMA.desdeMs - suma) / 1000;
        t.ok(cerca(quitado * 1000, 2700, 250), `se esperaban 2,7 s y se quitaron ${quitado}`);
    });

    t.group('quitar silencios · lo que no se parte');

    t.test('una toma hablada de punta a punta sale entera', () => {
        const archivo = wav([[30, RUIDO], [6, VOZ], [30, RUIDO]]);
        const r = silencios.partir(
            [{ id: 1, vista: 'R', desdeMs: 30000, hastaMs: 36000 }], sesionDe(archivo));
        t.eq(r.tomas.length, 1);
        t.eq(r.huecos, 0);
        t.eq(r.tomas[0].desdeMs, 30000, 'y sale con sus bordes intactos');
        t.eq(r.tomas[0].hastaMs, 36000);
    });

    t.test('sin WAV, la toma sale tal cual en vez de tirar', () => {
        // Es el modo de fallar correcto: una carpeta movida, un disco sin
        // montar. Mejor el vídeo con sus silencios que ningún vídeo.
        const r = silencios.partir([LA_TOMA], { sesiones: [] });
        t.eq(r.tomas.length, 1);
        t.eq(r.tomas[0], LA_TOMA, 'la misma toma, sin tocar');
        t.eq(r.huecos, 0);
    });

    t.test('un pedazo que quedaría de dos décimas no se corta', () => {
        // Un silencio largo justo después de la primera palabra: cortar ahí
        // deja un parpadeo con media sílaba. Se deja el hueco.
        const archivo = wav([[30, RUIDO], [0.3, VOZ], [2, RUIDO], [4, VOZ], [30, RUIDO]]);
        const r = silencios.partir(
            [{ id: 1, vista: 'R', desdeMs: 30000, hastaMs: 36300 }], sesionDe(archivo));
        t.eq(r.tomas.length, 1, 'sale entera');
        t.eq(r.huecos, 0);
    });

    t.test('los números son los que se le prometen a la persona', async () => {
        // La casilla de la revisión dice «los huecos de más de 0,7 s quedan en
        // 0,3». Son los dos números del motor escritos en una frase, y nadie
        // los iba a mantener a mano: se dibuja la tarjeta de verdad y se le
        // busca lo que el motor dice HOY. Cambiar una constante y no el texto
        // pone esto rojo, que es justo lo que no pasaba cuando la prueba
        // buscaba «0,7» a secas.
        t.eq(silencios.LARGO_MIN_SEC, 0.7);
        t.eq(silencios.AIRE_SEC, 0.3);
        const coma = n => String(n).replace('.', ',');
        const tarjetas = await import(pathToFileURL(
            path.join(__dirname, '..', 'src', 'js', 'semanal', 'tarjetas.js')).href);
        const html = tarjetas.tarjetaRevisar({ paso: 'revisar', silencios: false });
        t.ok(html.includes(`más de ${coma(silencios.LARGO_MIN_SEC)} s`),
            'y la casilla dice el largo mínimo del motor');
        t.ok(html.includes(`quedan en ${coma(silencios.AIRE_SEC)}`),
            'y el aire que les deja');
    });
};
