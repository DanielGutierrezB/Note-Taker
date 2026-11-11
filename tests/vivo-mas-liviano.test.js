'use strict';
/**
 * Que el vivo no se atrase: lo que cada pasada dejó de hacer de más.
 *
 *   · el idioma se mide cada cinco segundos y no en cada pasada, y sin los
 *     reintentos a más temperatura (medido con `tools/banco-pasada.js`);
 *   · el recorte de cada pasada se hace en la app, sin lanzar ffmpeg;
 *   · el archivo de notas se escribe sin sangría;
 *   · el modelo grande se carga en Preparar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const captura = require('../engine/captura');
const grabacion = require('../engine/grabacion');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

/** Un WAV como los de la app, con lo que diga `muestra(i)`. */
function wav(archivo, tasa, canales, segundos, muestra) {
    const cuadros = Math.round(tasa * segundos);
    const datos = Buffer.alloc(cuadros * canales * 2);
    for (let i = 0; i < cuadros; i++) {
        for (let c = 0; c < canales; c++) datos.writeInt16LE(Math.round(muestra(i, c)), (i * canales + c) * 2);
    }
    fs.writeFileSync(archivo, Buffer.concat([captura.cabecera(datos.length, tasa, canales), datos]));
}

function muestras(archivo) {
    const b = fs.readFileSync(archivo);
    if (b.readUInt32LE(24) !== 16000 || b.readUInt16LE(22) !== 1) throw new Error('no salió a 16 kHz mono');
    const n = (b.length - 44) / 2;
    return Array.from({ length: n }, (_x, i) => b.readInt16LE(44 + 2 * i));
}

module.exports = function (t) {
    t.group('vivo más liviano · el recorte en la app');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-recorte-'));

    t.test('48 kHz a 16 kHz mono, del largo pedido y en su sitio', () => {
        // Un golpe a los 2,5 s: tiene que caer en la muestra 2,5 × 16000 del
        // recorte que empieza en 0, y en la 0,5 × 16000 del que empieza en 2.
        const origen = path.join(dir, 'golpe.wav');
        const golpe = Math.round(2.5 * 48000);
        wav(origen, 48000, 1, 5, i => (Math.abs(i - golpe) < 3 ? 20000 : 0));
        const a = path.join(dir, 'a.wav');
        t.ok(captura.recorteEnLaApp(origen, 0, 4, a));
        const xa = muestras(a);
        t.eq(xa.length, 64000);
        const pico = xa.indexOf(Math.max(...xa));
        t.ok(Math.abs(pico - 40000) <= 1, `pico en ${pico}`);
        const b = path.join(dir, 'b.wav');
        captura.recorteEnLaApp(origen, 2, 2, b);
        const xb = muestras(b);
        t.ok(Math.abs(xb.indexOf(Math.max(...xb)) - 8000) <= 1);
    });

    t.test('la voz pasa entera y lo que no entra en 16 kHz se filtra', () => {
        const voz = path.join(dir, 'voz.wav');
        wav(voz, 48000, 1, 1, i => 10000 * Math.sin(2 * Math.PI * 1000 * i / 48000));
        const agudo = path.join(dir, 'agudo.wav');
        wav(agudo, 48000, 1, 1, i => 10000 * Math.sin(2 * Math.PI * 12000 * i / 48000));
        const rms = xs => Math.sqrt(xs.slice(200, -200).reduce((s, x) => s + x * x, 0) / (xs.length - 400));
        const va = path.join(dir, 'va.wav');
        const aa = path.join(dir, 'aa.wav');
        captura.recorteEnLaApp(voz, 0, 1, va);
        captura.recorteEnLaApp(agudo, 0, 1, aa);
        t.ok(Math.abs(rms(muestras(va)) - 10000 / Math.SQRT2) < 150, 'un tono de 1 kHz sale con su amplitud');
        t.ok(rms(muestras(aa)) < 100, 'uno de 12 kHz, que en 16 kHz se doblaría, no sale');
    });

    t.test('dos canales se mezclan, y lo que no tiene la forma de la app vuelve a ffmpeg', () => {
        const estereo = path.join(dir, 'estereo.wav');
        wav(estereo, 48000, 2, 1, (_i, c) => (c === 0 ? 8000 : 0));
        const e = path.join(dir, 'e.wav');
        t.ok(captura.recorteEnLaApp(estereo, 0, 1, e));
        t.ok(Math.abs(muestras(e)[8000] - 4000) <= 2, 'la mitad de cada uno');
        const raro = path.join(dir, 'raro.wav');
        wav(raro, 44100, 1, 1, () => 0);
        t.eq(captura.recorteEnLaApp(raro, 0, 1, path.join(dir, 'r.wav')), false, '44,1 kHz no es múltiplo de 16');
    });

    t.test('el archivo de la clase en curso se lee hasta donde está escrito', () => {
        const corto = path.join(dir, 'corto.wav');
        wav(corto, 48000, 1, 1, () => 1000);
        const c = path.join(dir, 'c.wav');
        t.ok(captura.recorteEnLaApp(corto, 0.5, 2, c));
        const x = muestras(c);
        t.eq(x.length, 32000, 'del largo pedido');
        t.eq(x[30000], 0, 'con silencio donde el archivo todavía no llega');
    });

    t.test('una toma entera para releer sigue yendo por ffmpeg', () => {
        const js = leer('engine', 'captura.js');
        t.ok(/const enLaApp = !p\.conFfmpeg && dur <= RECORTE_EN_LA_APP_MAX_SEC;/.test(js));
        t.ok(/const RECORTE_EN_LA_APP_MAX_SEC = 20;/.test(js));
    });

    t.group('vivo más liviano · el idioma y los reintentos');

    t.test('cada pasada va sin reintentos, y el idioma se mide solo si se pide', () => {
        const js = leer('engine', 'oido-residente.js');
        t.ok(/if \(!o\.reintentos\) form\.append\('temperature_inc', '0'\);/.test(js));
        t.ok(/if \(!medir\) form\.append\('no_language_probabilities', 'true'\);/.test(js));
    });

    t.test('el vivo mide el idioma cada cinco segundos, y siempre con «auto», hasta que se asienta', () => {
        const js = leer('engine', 'oir.js');
        t.eq(require('../engine/oir').MEDIR_IDIOMA_CADA_MS, 5000);
        const toca = js.slice(js.indexOf('function tocaMedirIdioma('), js.indexOf('async function delResidente('));
        t.ok(/if \(pedido === 'auto'\) return true;/.test(toca));
        t.ok(/delResidente\(recortado\.archivo, releerCon, false\)/.test(js), 'la segunda lectura en el otro idioma no mide');
    });

    t.group('vivo más liviano · el vivo y la relectura no se pisan');

    t.test('el vivo pasa cada dos segundos de audio, y cada tres con una relectura corriendo', () => {
        const js = leer('engine', 'ciclo-senales.js');
        t.ok(/const NUEVO_MIN_MS = 2000;/.test(js));
        t.ok(/const NUEVO_MIN_RELEYENDO_MS = 3000;/.test(js));
        t.ok(/return s\.rehaciendo \? NUEVO_MIN_RELEYENDO_MS : NUEVO_MIN_MS;/.test(js));
    });

    t.group('vivo más liviano · el archivo de notas');

    t.test('se escribe sin sangría en cada cambio de la clase', () => {
        t.ok(/conservarAnterior: true, compacto: true \}\)/.test(leer('engine', 'espejo.js')));
        const archivo = path.join(dir, 'x.json');
        require('../engine/workspace').writeJson(archivo, { a: [1, 2] }, { compacto: true });
        t.eq(fs.readFileSync(archivo, 'utf8'), '{"a":[1,2]}');
    });

    t.group('vivo más liviano · el modelo grande desde Preparar');

    t.test('Preparar lo pide al entrar y lo suelta al salir sin grabar', () => {
        const js = leer('src', 'js', 'pantalla-preparar.js');
        t.ok(/window\.nt\.grabarPrepararOido\(app\.ajustes\.idioma\)/.test(js));
        t.ok(/export async function salir\(\) \{\s+if \(window\.nt\.grabarSoltarOido\) window\.nt\.grabarSoltarOido\(\);/.test(js));
    });

    t.test('con una clase grabando no se suelta', () => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-oido-'));
        try {
            grabacion.iniciar({ dir: d, curso: 'x', fps: 30, sinReloj: true, sampleRate: 48000 });
            t.eq(grabacion.soltarOido(), false);
        } finally {
            grabacion.apagar();
            fs.rmSync(d, { recursive: true, force: true });
        }
        t.eq(grabacion.soltarOido(), true, 'sin clase, sí');
    });

    t.test('fin', () => fs.rmSync(dir, { recursive: true, force: true }));
};
