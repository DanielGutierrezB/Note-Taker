'use strict';
/**
 * La palmada de la claqueta, y todo lo que se le parece y no lo es.
 *
 * Los números de la primera tanda están medidos en la clase del 30/09
 * (`curso-jev_2026-09-30_07-45-31`, AirPods por Bluetooth, piso de sala
 * −67,8 dBFS) y en la del 29/09 (`curso-jev_2026-09-29_16-06-32`, por Zoom,
 * con silencio digital). Cada fila lleva el segundo del que salió, así que se
 * puede volver al audio y mirar.
 *
 * El caso que trajo todo esto está en la fila de los 108,52 s: ahí el profesor
 * dice, en la misma grabación, «no importa que haya dicho la palabra puesto que
 * igual no hice el aplauso» —y la app le acababa de poner una claqueta—.
 */

const golpe = require('../engine/golpe');
const aplausos = require('../engine/aplausos');
const vivo = require('../engine/notas-vivo');

const PISO_30 = -67.8;
const PISO_29 = -74.8;

/** Las siete palmadas de verdad del 30/09. */
const PALMADAS = [
    { seg: 26.77, picoDb: -7.1, pisoDb: PISO_30, previoDb: -59.0, ataqueMs: 5, caidaMs: 135, agudoHz: 5398 },
    { seg: 51.54, picoDb: -7.2, pisoDb: PISO_30, previoDb: -64.5, ataqueMs: 5, caidaMs: 160, agudoHz: 5384 },
    { seg: 63.27, picoDb: -7.3, pisoDb: PISO_30, previoDb: -67.0, ataqueMs: 5, caidaMs: 155, agudoHz: 6118 },
    { seg: 75.86, picoDb: -9.2, pisoDb: PISO_30, previoDb: -63.8, ataqueMs: 5, caidaMs: 160, agudoHz: 5978 },
    { seg: 337.59, picoDb: -7.7, pisoDb: PISO_30, previoDb: -60.0, ataqueMs: 5, caidaMs: 160, agudoHz: 5379 },
    { seg: 348.91, picoDb: -6.3, pisoDb: PISO_30, previoDb: -63.4, ataqueMs: 5, caidaMs: 155, agudoHz: 6655 },
    { seg: 356.80, picoDb: -8.2, pisoDb: PISO_30, previoDb: -66.6, ataqueMs: 10, caidaMs: 155, agudoHz: 6166 }
];

/** Y lo que NO lo es, con el motivo por el que antes colaba. */
const IMPOSTORES = [
    {
        que: 'la sílaba del «no hice el aplauso», que se llevó una claqueta',
        seg: 108.52, picoDb: -17.4, pisoDb: PISO_30, previoDb: -45.7,
        ataqueMs: 60, caidaMs: 95, agudoHz: 413
    },
    {
        que: 'la sílaba que le robó el marcador a la palmada de los 75,86 s',
        seg: 71.13, picoDb: -17.3, pisoDb: PISO_30, previoDb: -36.8,
        ataqueMs: 20, caidaMs: 290, agudoHz: 556
    },
    {
        que: 'el «claqueta clase 2» dicho sin aplaudir',
        seg: 355.18, picoDb: -13.1, pisoDb: PISO_30, previoDb: -34.6,
        ataqueMs: 15, caidaMs: 150, agudoHz: 522
    },
    {
        que: 'el «3» del conteo, que arranca desde el silencio como una palmada',
        seg: 87.32, picoDb: -10.0, pisoDb: PISO_30, previoDb: -57.7,
        ataqueMs: 120, caidaMs: 300, agudoHz: 559
    },
    {
        que: 'una vocal gritada, tan fuerte como una palmada',
        seg: 50.88, picoDb: -9.7, pisoDb: PISO_30, previoDb: -18.0,
        ataqueMs: 55, caidaMs: 85, agudoHz: 539
    },
    {
        que: 'el clic del ratón al apretar Iniciar: corto y agudo, pero flojo',
        seg: 1.15, picoDb: -28.7, pisoDb: PISO_30, previoDb: -65.6,
        ataqueMs: 5, caidaMs: 130, agudoHz: 2831
    },
    {
        que: 'una tecla',
        seg: 220.67, picoDb: -24.2, pisoDb: PISO_30, previoDb: -57.4,
        ataqueMs: 10, caidaMs: 130, agudoHz: 5205
    },
    {
        que: 'un clic sobre el silencio digital de Zoom, sin cola de sala',
        seg: 8758.80, picoDb: -22.5, pisoDb: PISO_29, previoDb: -84.3,
        ataqueMs: 0, caidaMs: 30, agudoHz: 3581
    },
    {
        que: 'la palabra «claqueta» del 29/09, dicha sobre el silencio de Zoom',
        seg: 8768.84, picoDb: -14.7, pisoDb: PISO_29, previoDb: -86.1,
        ataqueMs: 10, caidaMs: 300, agudoHz: 717
    }
];

/** Ruido siempre igual, para que la prueba no dependa de la suerte. */
function ruido() {
    let s = 987654321;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 1073741824 - 1;
    };
}

const TASA = 48000;
const MUESTRAS_POR_PEDAZO = 4096;

/** El nivel de sala del 30/09: −65 dBFS. */
const SALA = Math.pow(10, -65 / 20);

/**
 * Una pista de `segundos` de ruido de sala, en muestras de punto flotante.
 * Se le pegan encima los sonidos con `poner`.
 */
function pista(segundos) {
    const r = ruido();
    const x = new Float32Array(Math.round(segundos * TASA));
    for (let i = 0; i < x.length; i++) x[i] = r() * SALA * Math.SQRT2;
    return x;
}

function poner(x, seg, muestras) {
    const a = Math.round(seg * TASA);
    for (let i = 0; i < muestras.length && a + i < x.length; i++) x[a + i] += muestras[i];
}

/**
 * Una palmada: un chasquido de banda ancha que sube en dos milisegundos y se
 * apaga 30 dB en unos 150, que es lo que tarda la sala en callarse.
 */
function palmada(picoDb) {
    const r = ruido();
    const amp = Math.pow(10, picoDb / 20);
    const largo = Math.round(0.4 * TASA);
    const subida = Math.round(0.002 * TASA);
    const tau = 0.0434 * TASA; // 30 dB en 150 ms
    const x = new Float32Array(largo);
    for (let i = 0; i < largo; i++) {
        const sube = i < subida ? i / subida : 1;
        x[i] = r() * amp * Math.SQRT2 * sube * Math.exp(-i / tau);
    }
    return x;
}

/**
 * Una sílaba acentuada: grave, sube despacio y se sostiene. Mide igual de
 * fuerte que una palmada y `golpe.js` la contaba como una.
 */
function silaba(picoDb, segundos) {
    const amp = Math.pow(10, picoDb / 20);
    const largo = Math.round(segundos * TASA);
    const subida = Math.round(0.05 * TASA);
    const x = new Float32Array(largo);
    for (let i = 0; i < largo; i++) {
        const sube = i < subida ? i / subida : 1;
        const baja = i > largo - subida ? (largo - i) / subida : 1;
        const t = i / TASA;
        const onda = Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t);
        x[i] = onda * amp * sube * baja;
    }
    return x;
}

/**
 * Una consonante explosiva: ocho milisegundos de nada, graves, en medio de un
 * pedazo por lo demás tranquilo. Es la forma exacta que tenía el pico de los
 * 108,52 s, el que se llevó la claqueta fantasma: para `golpe.js` —un pico alto
 * y un promedio bajo— es indistinguible de una palmada.
 */
function plosiva(picoDb) {
    const amp = Math.pow(10, picoDb / 20);
    const largo = Math.round(0.008 * TASA);
    const x = new Float32Array(largo);
    for (let i = 0; i < largo; i++) {
        x[i] = amp * Math.sin(Math.PI * i / largo) * Math.sin(2 * Math.PI * 150 * i / TASA);
    }
    return x;
}

/** Un clic: dos milisegundos y nada más. Agudo y corto, pero sin cola. */
function clic(picoDb) {
    const r = ruido();
    const amp = Math.pow(10, picoDb / 20);
    const largo = Math.round(0.002 * TASA);
    const x = new Float32Array(largo);
    for (let i = 0; i < largo; i++) x[i] = r() * amp * Math.SQRT2;
    return x;
}

/** Pasa la pista por los dos buscadores, en pedazos de 4096 como la app. */
function correr(x) {
    const busc = aplausos.nuevo({ tasa: TASA });
    const viejo = golpe.nuevo();
    const palmadas = [];
    const golpes = [];
    for (let off = 0; off + MUESTRAS_POR_PEDAZO <= x.length; off += MUESTRAS_POR_PEDAZO) {
        const pcm = Buffer.alloc(MUESTRAS_POR_PEDAZO * 2);
        for (let i = 0; i < MUESTRAS_POR_PEDAZO; i++) {
            const v = Math.max(-1, Math.min(1, x[off + i]));
            pcm.writeInt16LE(Math.round(v * 32767), i * 2);
        }
        const ms = Math.round(off / TASA * 1000);
        for (const a of aplausos.mirar(busc, pcm, ms).aplausos) palmadas.push(a);
        const v = golpe.mirar(viejo, pcm, ms);
        if (v.golpe) golpes.push(v.ms);
    }
    return { palmadas, golpes, piso: busc.pisoDb };
}

module.exports = function (t) {
    t.group('aplausos · lo medido en el audio real');

    t.test('las siete palmadas de la clase del 30/09 se reconocen', () => {
        for (const p of PALMADAS) {
            t.eq(aplausos.esAplauso(p), true, `la palmada de los ${p.seg} s`);
        }
    });

    t.test('y nada de lo que se le parece', () => {
        for (const i of IMPOSTORES) {
            t.eq(aplausos.esAplauso(i), false, `${i.seg} s: ${i.que}`);
        }
    });

    t.test('a los cuatro golpe.js les decía que sí, y por eso hubo claquetas fantasma', () => {
        // El pico y el promedio del pedazo de 4096 muestras, medidos en el mismo
        // audio y en los mismos instantes, con el fondo que `golpe.js` llevaba
        // aprendido al llegar ahí.
        const COMO_LOS_VEIA = [
            { seg: 108.37, pico: 0.1226, medio: 0.00610, fondo: 0.00031 },
            { seg: 71.00, pico: 0.1772, medio: 0.00984, fondo: 0.00031 },
            { seg: 355.07, pico: 0.1248, medio: 0.00586, fondo: 0.00029 },
            { seg: 1.11, pico: 0.1224, medio: 0.01070, fondo: 0.00133 }
        ];
        for (const g of COMO_LOS_VEIA) {
            t.eq(golpe.esGolpe(g.pico, g.medio, g.fondo), true, `golpe.js aceptaba el de los ${g.seg} s`);
        }
        for (const seg of COMO_LOS_VEIA.map(g => g.seg)) {
            const i = IMPOSTORES.find(x => Math.abs(x.seg - seg) < 0.2);
            t.eq(aplausos.esAplauso(i), false, `aplausos.js lo rechaza (${seg} s)`);
        }
    });

    t.test('las tres preguntas por separado dejarían pasar impostores', () => {
        // Es la razón de que sean cuatro. Ninguna columna separa sola: hay habla
        // tan fuerte como una palmada, habla tan corta como una palmada y clics
        // tan agudos como una palmada.
        const tan = (i, cuanto) => IMPOSTORES.find(x => x.seg === i)[cuanto];
        t.ok(tan(50.88, 'picoDb') - PISO_30 > aplausos.SOBRE_EL_PISO_DB,
            'la vocal gritada es tan fuerte como una palmada');
        t.ok(tan(355.18, 'ataqueMs') <= aplausos.ATAQUE_MAX_MS,
            'la sílaba de los 355 s ataca tan rápido como una palmada');
        t.ok(tan(220.67, 'agudoHz') >= aplausos.AGUDO_MIN_HZ,
            'la tecla es tan aguda como una palmada');
    });

    t.test('las palmadas pasan cada umbral con margen, no raspando', () => {
        // Si alguien mueve un número, que se vea cuánto aire había.
        const menos = (que, umbral) => Math.min(...PALMADAS.map(p => p[que])) - umbral;
        const mas = (que, umbral) => umbral - Math.max(...PALMADAS.map(p => p[que]));
        t.ok(menos('agudoHz', aplausos.AGUDO_MIN_HZ) > 2500,
            `la palmada más grave centra en ${Math.min(...PALMADAS.map(p => p.agudoHz))} Hz`);
        t.ok(mas('ataqueMs', aplausos.ATAQUE_MAX_MS) >= 5,
            `la de ataque más lento sube en ${Math.max(...PALMADAS.map(p => p.ataqueMs))} ms`);
        t.ok(mas('caidaMs', aplausos.CAIDA_MAX_MS) >= 80 &&
            menos('caidaMs', aplausos.CAIDA_MIN_MS) >= 70,
            'la caída de todas queda lejos de los dos bordes');
    });

    t.group('aplausos · el mismo audio por los dos buscadores');

    t.test('el pico de habla que golpe.js contaba como aplauso ya no cuenta', () => {
        // El falso positivo, de punta a punta: la misma pista por los dos.
        const x = pista(4);
        poner(x, 2.0, plosiva(-10));
        const { palmadas, golpes } = correr(x);
        t.eq(golpes.length, 1, 'golpe.js dice que hubo un aplauso');
        t.eq(palmadas.length, 0, 'aplausos.js dice que no');
    });

    t.test('una sílaba fuerte tampoco', () => {
        const x = pista(4);
        poner(x, 2.0, silaba(-10, 0.30));
        t.eq(correr(x).palmadas.length, 0);
    });

    t.test('la palmada sí, y en el instante en que suena', () => {
        const x = pista(4);
        poner(x, 2.0, palmada(-8));
        const { palmadas } = correr(x);
        t.eq(palmadas.length, 1);
        t.near(palmadas[0].ms, 2000, 15, 'el ms es el del pico');
    });

    t.test('el ms es el del pico aunque se decida tres pedazos después', () => {
        // La caída es parte del argumento, así que la palmada se confirma 300 ms
        // tarde. Si el ms fuera el del pedazo que la confirma, el marcador
        // caería un tercio de segundo después de la palmada.
        const x = pista(4);
        poner(x, 2.0, palmada(-8));
        const busc = aplausos.nuevo({ tasa: TASA });
        let msDelPedazo = null;
        let palmada1 = null;
        for (let off = 0; off + MUESTRAS_POR_PEDAZO <= x.length; off += MUESTRAS_POR_PEDAZO) {
            const pcm = Buffer.alloc(MUESTRAS_POR_PEDAZO * 2);
            for (let i = 0; i < MUESTRAS_POR_PEDAZO; i++) {
                const v = Math.max(-1, Math.min(1, x[off + i]));
                pcm.writeInt16LE(Math.round(v * 32767), i * 2);
            }
            const ms = Math.round(off / TASA * 1000);
            const r = aplausos.mirar(busc, pcm, ms);
            if (r.aplausos.length && !palmada1) { palmada1 = r.aplausos[0]; msDelPedazo = ms; }
        }
        t.ok(msDelPedazo - palmada1.ms >= 250,
            `se confirmó ${msDelPedazo - palmada1.ms} ms después`);
        t.near(palmada1.ms, 2000, 15);
    });

    t.test('un clic sin cola de sala no es una palmada, por agudo que sea', () => {
        const x = pista(4);
        poner(x, 2.0, clic(-8));
        t.eq(correr(x).palmadas.length, 0);
    });

    t.test('dos palmadas seguidas son dos', () => {
        const x = pista(6);
        poner(x, 2.0, palmada(-8));
        poner(x, 4.0, palmada(-8));
        const { palmadas } = correr(x);
        t.eq(palmadas.length, 2);
        t.near(palmadas[1].ms - palmadas[0].ms, 2000, 20);
    });

    t.test('el eco de una palmada no cuenta como la segunda', () => {
        const x = pista(4);
        poner(x, 2.0, palmada(-8));
        poner(x, 2.1, palmada(-16));
        t.eq(correr(x).palmadas.length, 1);
    });

    t.group('aplausos · el piso lo pone la sesión');

    t.test('una clase grabada 18 dB más bajo no pierde su palmada', () => {
        // El piso se aprende: en el material del 30/09 anda por −65 y en el
        // Live-Mix del curso viejo estaba en −74. `golpe.js` tenía un suelo fijo
        // (`PICO_MINIMO`) y por eso hubo que bajarlo hasta donde ya no filtraba.
        const x = pista(4);
        poner(x, 2.0, palmada(-8));
        for (let i = 0; i < x.length; i++) x[i] *= Math.pow(10, -18 / 20);
        const { palmadas, golpes } = correr(x);
        t.eq(palmadas.length, 1, 'la palmada sigue estando 50 dB sobre SU piso');
        t.eq(golpes.length, 0, 'para golpe.js, con su suelo fijo, ya no existe');
    });

    t.test('y en una sala que suena más fuerte, tampoco', () => {
        const x = pista(4);
        poner(x, 2.0, palmada(-2));
        for (let i = 0; i < x.length; i++) x[i] *= Math.pow(10, 6 / 20);
        const { palmadas, piso } = correr(x);
        t.eq(palmadas.length, 1);
        t.ok(piso > -62 && piso < -53, `el piso aprendido quedó en ${piso.toFixed(1)} dBFS`);
    });

    t.test('sobre silencio digital el piso no se hunde', () => {
        // Zoom manda ceros exactos. Con el piso en −120, cualquier ruidito
        // quedaría «setenta decibelios sobre el piso».
        const x = new Float32Array(3 * TASA);
        poner(x, 2.0, clic(-25));
        const { palmadas, piso } = correr(x);
        t.eq(piso, aplausos.PISO_MIN_DB);
        t.eq(palmadas.length, 0);
    });

    t.test('no se decide nada hasta tener el piso medido', () => {
        // Con un piso supuesto, «50 dB sobre el piso» no quiere decir nada.
        const x = pista(2);
        poner(x, 0.3, palmada(-8));
        t.eq(correr(x).palmadas.length, 0, `los primeros ${aplausos.CALENTAR_MS} ms no cuentan`);
    });

    t.group('aplausos · la claqueta sigue siendo la palabra Y la palmada');

    t.test('la palmada sola no anota nada; con la palabra, sí, y va en la palmada', () => {
        const T0 = Date.parse('2026-09-30T07:45:31');
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });

        // Los dos instantes reales del 30/09: la palabra a los 71,1 s y la
        // palmada a los 75,9. Antes el marcador caía en la palabra.
        vivo.recordarAplauso(e, T0 + 75860);
        t.eq(e.claquetas.length, 0, 'la palmada sola no es una claqueta');

        const r = vivo.claquetaDicha(e, T0 + 71130, 'clase 2 claqueta');
        t.eq(e.claquetas.length, 1);
        t.eq(r.claqueta.ms, T0 + 75860, 'el marcador va en la palmada, no en la palabra');
        t.eq(r.claqueta.origen, 'golpe,voz');
    });

    t.test('con la palmada al lado, la palabra mal escrita también cuenta', () => {
        // Cómo escribió Whisper las siete palmadas del 30/09: «Claqueta» dos
        // veces, «Laqueta», «Tlaqueta», «TLAQUETA CLASE 2», «Tlajeta clase 4» y
        // «La quinta». Las cuatro primeras se reconocen; las dos últimas no, y
        // esas dos palmadas quedan sin confirmar —que es el lado correcto del
        // error: se ve el aviso y se pone la K—.
        for (const [como, cuenta] of [
            ['Clase 1. Claqueta.', true], ['Laqueta.', true],
            ['TLAQUETA CLASE 2', true], ['Cacleta dos', true],
            ['Tlajeta clase 4', false], ['La quinta.', false]
        ]) {
            t.eq(vivo.CLAQUETA.test(como), cuenta, `«${como}»`);
        }
    });

    t.test('sin palmada, la palabra no anota nada', () => {
        // Las tres claquetas fantasma de los 355, 365 y 375 s: el profesor decía
        // «claqueta clase 1/2/3» seguido, probando, y no aplaudió ninguna vez.
        const T0 = Date.parse('2026-09-30T07:45:31');
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        for (const seg of [365.3, 374.5, 383.7]) {
            const r = vivo.claquetaDicha(e, T0 + seg * 1000, 'claqueta clase 3');
            t.eq(r.sinAplauso, true, `a los ${seg} s`);
        }
        t.eq(e.claquetas.length, 0);
    });
};
