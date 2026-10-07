'use strict';
/**
 * «Mejorar audio»: que el vídeo de la semana salga al volumen de todo lo
 * demás y parejo entre tomas.
 *
 * Acá se prueba lo que se decide, no lo que suena. Lo que suena lo mide
 * `tools/medir-audio.js` sobre grabaciones de verdad, porque hace falta
 * ffmpeg y un archivo con voz dentro, y eso no cabe en una suite que corre
 * en siete segundos sin nada instalado. Lo que sí cabe —y es donde están los
 * errores que cuestan caro— es la aritmética: qué ganancia le toca a cada
 * toma, qué pasa con la que no se pudo medir, y que la cadena que se le
 * escribe a ffmpeg devuelva el audio exactamente a donde estaba.
 *
 * La medición se finge con un `ffmpeg` falso para que las pruebas digan qué
 * se hace con los números, no si ffmpeg sabe medir.
 */

const audio = require('../engine/mejorar-audio');

/** Un trozo como los que arma `repartir`, con lo justo que mira el plan. */
function trozo(toma, desdeSec, hastaSec, ruta = '/t/a.wav') {
return { toma, audio: { ruta, desdeSec, hastaSec } };
}

/** Un medidor de mentira: dice lo que se le pida según dónde empiece el tramo. */
function medidor(porDesde, apunte) {
return (ffmpeg, tramo) => {
    if (apunte) apunte.push(tramo);
    const m = porDesde[String(tramo.desdeSec)];
    return m === undefined ? { lufs: -26, piso: -55 } : m;
};
}

module.exports = function (t) {

    t.group('mejorar audio · emparejar las tomas entre sí');

    t.test('la toma floja sube hasta la referencia y la fuerte baja', () => {
        t.near(audio.gananciaDe(-28, -26), 2, 0.001);
        t.near(audio.gananciaDe(-22, -26), -4, 0.001);
        t.eq(audio.gananciaDe(-26, -26), 0);
    });

    t.test('la toma rota no se empareja del todo: se le pone el tope', () => {
        // Si el micrófono se desconectó, la toma mide -45 contra -26 de sus
        // hermanas. Emparejarla serían 19 dB, que son 19 dB de su ruido: queda
        // baja, que es lo que es, y se avisa.
        t.eq(audio.gananciaDe(-45, -26), audio.GANANCIA_MAX_DB);
        t.eq(audio.gananciaDe(-2, -26), -audio.GANANCIA_MAX_DB);
    });

    t.test('lo que no se pudo medir no mueve nada', () => {
        t.eq(audio.gananciaDe(NaN, -26), 0);
        t.eq(audio.gananciaDe(-Infinity, -26), 0);
        t.eq(audio.gananciaDe(-26, NaN), 0);
    });

    t.group('mejorar audio · llegar al destino');

    t.test('la ganancia del conjunto es lo que falta hasta el destino', () => {
        t.near(audio.gananciaDelPrograma(-30), 14, 0.001);
        t.near(audio.gananciaDelPrograma(-12), -4, 0.001);
        t.eq(audio.gananciaDelPrograma(audio.DESTINO_LUFS), 0);
    });

    t.test('el tope del conjunto es mucho más alto que el de emparejar', () => {
        // Son dos cosas distintas, y mezclarlas fue el primer error de este
        // archivo: con un tope solo de 12 dB, la grabación del 05/10 —que
        // necesitaba 14,8 para llegar— se quedaba en -19,5 LUFS, o sea sin
        // arreglar. Esta ganancia es la misma para todo el vídeo, así que no
        // puede hacer que un trozo suene distinto de otro.
        t.ok(audio.GANANCIA_PROGRAMA_MAX_DB > audio.GANANCIA_MAX_DB);
        t.near(audio.gananciaDelPrograma(-30.8), 14.8, 0.001);
    });

    t.test('un vídeo vacío no se sube hasta el siseo', () => {
        t.eq(audio.gananciaDelPrograma(-60), audio.GANANCIA_PROGRAMA_MAX_DB);
    });

    t.group('mejorar audio · leer lo que midió ffmpeg');

    /** Lo que ffmpeg 9.0.1 escribe de verdad, recortado. */
    const REAL = [
        '[Parsed_ebur128_0 @ 0x14b004e10] Summary:',
        '',
        '  Integrated loudness:',
        '    I:         -24.9 LUFS',
        '    Threshold: -35.2 LUFS',
        '',
        '  Loudness range:',
        '    LRA:         5.2 LU',
        '',
        '  True peak:',
        '    Peak:       -7.8 dBFS',
        '',
        '[Parsed_astats_1 @ 0x14b005520] Noise floor dB: -37.599324',
        '[Parsed_astats_1 @ 0x14b005520] Peak level dB: -7.796870'
    ].join('\n');

    t.test('de la salida de verdad salen las dos', () => {
        const m = audio.leerMedida(REAL);
        t.near(m.lufs, -24.9, 0.001);
        t.near(m.piso, -37.599324, 0.0001);
    });

    t.test('no se confunde la I con el umbral ni el piso con el pico', () => {
        const m = audio.leerMedida(REAL);
        t.ok(m.lufs !== -35.2, 'esa es la Threshold');
        t.ok(m.piso !== -7.79687, 'ese es el Peak level');
    });

    t.test('sin sonoridad no hay medida: con eso no se decide nada', () => {
        t.eq(audio.leerMedida('ffmpeg version 9.0.1\nnada más'), null);
        t.eq(audio.leerMedida(''), null);
        t.eq(audio.leerMedida(null), null);
    });

    t.test('un archivo mudo mide -inf y eso no es un número', () => {
        // R128 escribe `-inf` cuando no hay nada que medir. Tomarlo por
        // bueno le pondría a la toma una ganancia infinita.
        t.eq(audio.leerMedida('  Integrated loudness:\n    I:  -inf LUFS'), null);
    });

    t.test('el piso puede faltar sin que se pierda la sonoridad', () => {
        // Sin piso no se denoisa, pero emparejar las tomas sí se puede.
        const m = audio.leerMedida('  Integrated loudness:\n    I:  -26.0 LUFS');
        t.near(m.lufs, -26, 0.001);
        t.eq(m.piso, null);
    });

    t.group('mejorar audio · el piso con el que se encuentra el denoiser');

    t.test('el piso de cada toma sube con su ganancia', () => {
        // Subir una toma 10 dB le sube el ruido 10 dB: el piso que ve el
        // denoiser es el de después, no el que se midió.
        t.eq(audio.pisoDespues([{ piso: -60, ganancia: 10 }]), -50);
    });

    t.test('manda el peor, no el promedio', () => {
        // El denoiser es uno para todo el vídeo. Si una toma deja el piso
        // en -40 y otra en -60, afinarlo a -50 le hace pasarse en la
        // callada, y pasarse es burbujeo encima de la voz.
        t.eq(audio.pisoDespues([
            { piso: -60, ganancia: 0 },
            { piso: -44, ganancia: 2 },
            { piso: -50, ganancia: 0 }
        ]), -42);
    });

    t.test('sin ninguna medida no hay piso que inventar', () => {
        t.eq(audio.pisoDespues([{ piso: null, ganancia: 3 }]), null);
        t.eq(audio.pisoDespues([]), null);
    });

    t.group('mejorar audio · la cadena del conjunto');

    const partes = s => s.split(',');

    t.test('lo que se le quita al audio va antes de lo que se le sube', () => {
        const c = partes(audio.cadenaDelPrograma([{ piso: -50, ganancia: 0 }], 12));
        const alto = c.findIndex(x => x.startsWith('highpass'));
        const ruido = c.findIndex(x => x.startsWith('afftdn'));
        const tope = c.findIndex(x => x.startsWith('alimiter'));
        // Denoisar después del limitador sería denoisar un ruido que ya se
        // movió, y limitar antes de quitar el retumbe sería gastar el
        // limitador en algo que se iba a tirar igual.
        t.ok(alto < ruido && ruido < tope, `el orden quedó: ${c.join(' → ')}`);
    });

    t.test('el denoiser se afina al piso medido, no a un número de fábrica', () => {
        const a = audio.cadenaDelPrograma([{ piso: -60, ganancia: 0 }], 0);
        const b = audio.cadenaDelPrograma([{ piso: -40, ganancia: 0 }], 0);
        t.ok(a.includes(`nf=${-60 + audio.RUIDO_SOBRE_EL_PISO}`), a);
        t.ok(b.includes(`nf=${-40 + audio.RUIDO_SOBRE_EL_PISO}`), b);
    });

    t.test('sin piso que mirar no se denoisa', () => {
        // Un `nf` inventado es exactamente lo que deja la voz sonando a
        // lata: mejor dejar el ruido, que al menos es el que había.
        const c = audio.cadenaDelPrograma([{ piso: null, ganancia: 0 }], 10);
        t.ok(!c.includes('afftdn'), c);
        t.ok(c.includes('alimiter'), 'el resto de la cadena sigue estando');
    });

    t.test('el retraso que mete la cadena se devuelve, o se rompe la sincronía', () => {
        // `afftdn` devuelve el audio 25 ms tarde y el limitador suma los
        // suyos. Sin esto el exporte saldría 30 ms detrás del montaje que
        // la persona acaba de aprobar.
        const c = partes(audio.cadenaDelPrograma([{ piso: -50, ganancia: 0 }], 12));
        const seg = (audio.RETRASO_MS / 1000).toFixed(3);
        const corta = c.indexOf(`atrim=start=${seg}`);
        const rellena = c.indexOf(`apad=pad_dur=${seg}`);
        t.ok(corta > 0, `falta el recorte del principio en: ${c.join(' → ')}`);
        t.ok(rellena > corta, 'y el relleno del final, que es lo que deja igual el largo');
        // Lo que se corta y lo que se rellena tienen que ser lo mismo: si
        // no, el vídeo cambia de largo y el desfase se va al otro lado.
        t.eq(c[corta].split('=').pop(), c[rellena].split('=').pop());
    });

    t.test('el techo deja sitio para lo que el AAC agrega al codificar', () => {
        t.ok(audio.TECHO_DBTP < 0, 'un techo en 0 dBTP se recorta al codificar');
        const c = audio.cadenaDelPrograma([], 0);
        t.ok(c.includes(`limit=${audio.TECHO_DBTP}dB`), c);
    });

    t.group('mejorar audio · el plan, toma por toma');

    t.test('todos los pedazos de una toma llevan la MISMA ganancia', () => {
        // Con «Quitar silencios» puesto, una toma sale partida en varios
        // pedazos. Si cada pedazo se midiera solo, el volumen cambiaría
        // dentro de una misma frase, que suena mucho peor que no hacer nada.
        const p = audio.plan({
            trozos: [trozo('A', 0, 2), trozo('A', 3, 5), trozo('A', 9, 12)],
            ffmpeg: null
        });
        t.eq(p.porTrozo.length, 3);
        t.eq(new Set(p.porTrozo).size, 1);
    });

    t.test('la toma se mide entera, no pedazo a pedazo', () => {
        // Medir dos segundos no da un número de fiar, y lo que importa es
        // el nivel de la toma. Se mide del principio del primer pedazo al
        // final del último, los silencios de en medio incluidos: R128 los
        // descarta solo, por su propia puerta.
        const pedidos = [];
        audio.plan({
            trozos: [trozo('A', 10, 14), trozo('A', 20, 31)],
            medir: medidor({}, pedidos)
        });
        t.eq(pedidos.length, 1, 'una sola medición para los dos pedazos');
        t.eq(pedidos[0].desdeSec, 10);
        t.eq(pedidos[0].hastaSec, 31);
    });

    t.test('dos tomas de distinto nivel quedan emparejadas', () => {
        const p = audio.plan({
            trozos: [trozo('A', 0, 30), trozo('B', 100, 130)],
            medir: medidor({
                0: { lufs: -28, piso: -55 },
                100: { lufs: -22, piso: -55 }
            })
        });
        // Los 6 dB que había entre las dos desaparecen, que es el escalón que
        // se oía en el corte. Llegar al destino es aparte: eso lo hace la
        // ganancia del conjunto, que va dentro de la cadena.
        // Lo que importa no es cuánto se mueve cada una sino que después de
        // moverse midan lo mismo: eso es estar emparejadas.
        t.near((-28 + p.porTrozo[0]) - (-22 + p.porTrozo[1]), 0, 0.001);
        t.near(p.porTrozo[0] - p.porTrozo[1], 6, 0.001);
        t.ok(p.avisos.some(a => a.includes('6.0 dB')), p.avisos.join(' / '));
        t.ok(p.programa.includes(`volume=${p.ganancia.toFixed(2)}dB`), p.programa);
    });

    t.test('la toma que no se pudo medir se queda donde estaba', () => {
        // Moverla a ciegas sería inventar, y no hace falta: la referencia es la
        // toma del medio, así que quedarse quieto ES estar en la referencia.
        const p = audio.plan({
            trozos: [trozo('A', 0, 30), trozo('B', 100, 130), trozo('C', 200, 230)],
            medir: medidor({ 100: null })
        });
        t.deep(p.porTrozo, [0, 0, 0]);
        t.near(p.referencia, -26, 0.001);
    });

    t.test('una toma más corta que el mínimo ni se intenta medir', () => {
        const pedidos = [];
        audio.plan({
            trozos: [trozo('A', 0, audio.MINIMO_MEDIBLE_SEC / 2)],
            medir: medidor({}, pedidos)
        });
        t.eq(pedidos.length, 0, 'R128 necesita algo que medir; pedírselo sería inventar');
    });

    t.test('sin ffmpeg no se decide nada y nada se rompe', () => {
        const p = audio.plan({ trozos: [trozo('A', 0, 30)], ffmpeg: null });
        t.deep(p.porTrozo, [0]);
        t.ok(!p.programa.includes('afftdn'), p.programa);
    });

    t.test('sin tomas tampoco', () => {
        const p = audio.plan({ trozos: [], ffmpeg: null });
        t.deep(p.porTrozo, []);
        t.deep(p.avisos, []);
    });

    t.group('mejorar audio · lo que se le dice a quien grabó');

    t.test('una deriva chica no se cuenta: no es noticia', () => {
        const p = audio.plan({
            trozos: [trozo('A', 0, 30), trozo('B', 100, 130)],
            medir: medidor({
                0: { lufs: -26.2, piso: -55 },
                100: { lufs: -26.6, piso: -55 }
            })
        });
        t.deep(p.avisos, []);
    });

    t.test('la toma que se topó se avisa, porque va a sonar distinta', () => {
        const p = audio.plan({
            trozos: [trozo('A', 0, 30), trozo('B', 50, 80), trozo('C', 100, 130)],
            medir: medidor({
                0: { lufs: -24, piso: -55 },
                50: { lufs: -25, piso: -55 },
                100: { lufs: -45, piso: -55 }
            })
        });
        t.ok(p.avisos.some(a => a.includes('quedó más baja')), p.avisos.join(' / '));
        // Y se dice UNA vez: «quedaron emparejadas» seguido de «una quedó más
        // baja» es contradecirse en dos renglones.
        t.eq(p.avisos.length, 1, p.avisos.join(' / '));
        t.ok(!p.avisos.some(a => a.includes('emparejadas')), p.avisos.join(' / '));
    });

    t.test('sin nada medido el vídeo sale como entró, no 16 dB más bajo', () => {
        // Era un error de los caros: la referencia de una lista vacía salía
        // cero, y como el destino es -16, el vídeo se entregaba 16 dB MÁS BAJO
        // de lo que entró. Un cero que significa «no sé» no se puede mezclar
        // con los ceros que significan cero.
        const p = audio.plan({ trozos: [trozo('A', 0, 30)], medir: () => null });
        t.eq(p.ganancia, 0);
        t.deep(p.porTrozo, [0]);
        t.ok(!p.programa.includes('volume='), p.programa);
        t.ok(p.avisos.some(a => a.includes('se dejó como estaba')), p.avisos.join(' / '));
    });

    t.test('un vídeo que vino tan bajo que no se arregla lo dice', () => {
        const p = audio.plan({ trozos: [trozo('A', 0, 30)], medir: medidor({ 0: { lufs: -55 } }) });
        t.ok(p.avisos.some(a => a.includes('micrófono')), p.avisos.join(' / '));
    });
};
