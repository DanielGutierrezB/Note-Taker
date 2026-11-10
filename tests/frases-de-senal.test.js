'use strict';
/**
 * Las frases que abren, cierran y cambian de vista, editables en Ajustes.
 *
 * Lo que se prueba:
 *
 *   · que con las de fábrica todo siga igual que cuando eran expresiones fijas;
 *   · cómo se reconoce una frase: de varias palabras, con acentos y signos,
 *     partida por Whisper en dos palabras, partida entre dos pasadas y oída dos
 *     veces por el solape;
 *   · que se puedan cambiar con la clase andando;
 *   · que una de vista parta la toma, y que ⌘Z lo deshaga de una vez;
 *   · el saneo al guardar;
 *   · y que la ventana marque en el transcript lo mismo que el motor oye.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const vivo = require('../engine/notas-vivo');
const ajustes = require('../engine/ajustes');
const grabacion = require('../engine/grabacion');
const conClaseMuda = require('./fixtures/clase-muda');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const T0 = Date.parse('2026-11-04T10:00:00');

/** Palabras cada 400 ms; con `cada` se cambia el paso. */
function palabras(texto, cada, desde) {
    const paso = cada == null ? 400 : cada;
    const cero = desde == null ? T0 : desde;
    return texto.split(' ').map((w, i) => ({ t: cero + i * paso, hasta: cero + i * paso + 300, texto: w }));
}

const conFrases = f => vivo.reglasDeFrases({ ...vivo.FRASES_DE_FABRICA, ...f });
const tipos = (ws, f) => vivo.senales(ws, Infinity, f && conFrases(f)).map(s => `${s.tipo}:${s.desde}-${s.hasta}`);

module.exports = async function (t) {
    t.group('frases · las de fábrica');

    t.test('sin frases, el motor oye las de fábrica: «retomamos», «pausa», «pause» y la cuenta', () => {
        t.deep(tipos(palabras('bueno Retomamos. hola')), ['abre:1-1']);
        t.deep(tipos(palabras('listo Pausa.'), null), ['cierra:1-1']);
        t.deep(tipos(palabras('ok Pause.')), ['cierra:1-1']);
        t.deep(tipos(palabras('ok 3, 2, 1. hola')), ['abre:0-3']);
        t.eq(vivo.senales(palabras('Retomamos'), Infinity)[0].por, 'retomamos', 'y el motivo se sigue llamando igual');
    });

    t.test('«Pausa» sigue pidiendo el segundo de silencio detrás', () => {
        t.deep(tipos(palabras('una Pausa en el flujo')), ['pausa-corta:1-1']);
    });

    t.group('frases · cómo se reconoce una');

    t.test('una de varias palabras abre con el IN después de su última palabra', () => {
        const ws = palabras('bueno ahora sí arrancamos hola gente');
        t.deep(tipos(ws, { abrir: ['ahora sí arrancamos'] }), ['abre:1-3']);
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        vivo.aplicarSenales(e, ws, { frases: { ...vivo.FRASES_DE_FABRICA, abrir: ['ahora sí arrancamos'] } });
        t.eq(e.tomas.length, 1);
        t.eq(e.tomas[0].inMs, ws[4].t, 'el IN cae en «hola»');
        t.eq(e.tomas[0].cuenta, 'ahora sí arrancamos', 'y la frase va al comentario del IN, como la cuenta');
    });

    t.test('sin mayúsculas, acentos ni signos', () => {
        t.deep(tipos(palabras('¡Ahora, Si: ARRANCAMOS! hola'), { abrir: ['ahora sí arrancamos'] }), ['abre:0-2']);
    });

    t.test('aunque Whisper parta una palabra en dos, o junte dos en una', () => {
        t.deep(tipos(palabras('bueno re tomamos hola')), ['abre:1-2']);
        t.deep(tipos(palabras('vamos anuestra pantalla ya'), { vista: [{ frase: 'vamos a nuestra pantalla', vista: 'R' }] }), ['vista:0-2']);
    });

    t.test('entre comillas es una cita, no la señal: así se explican en clase', () => {
        // Medido en una clase de verdad: «el nombre "Pausa", "3, 2, 1"». La
        // expresión de antes no las tomaba, y con las de fábrica nada cambia.
        t.deep(tipos(palabras('el nombre "Pausa", y sigo', 2000)), []);
        t.deep(tipos(palabras('dijo «retomamos» y nada')), []);
        t.deep(tipos(palabras('"Retomamos. hola')), ['abre:0-0'], 'la comilla de apertura sola sí vale');
    });

    t.test('no es la frase si le falta o le sobra una palabra', () => {
        t.deep(tipos(palabras('ahora sí que arrancamos'), { abrir: ['ahora sí arrancamos'] }), []);
        t.deep(tipos(palabras('retomamoslo'), {}), []);
    });

    t.test('la más larga gana: «vamos a nuestra pantalla» no es «vamos»', () => {
        t.deep(tipos(palabras('vamos a nuestra pantalla ya'), {
            abrir: ['vamos'], vista: [{ frase: 'vamos a nuestra pantalla', vista: 'R' }]
        }), ['vista:0-3']);
    });

    t.test('una de cerrar con varias palabras no pide silencio; una de una sola, sí', () => {
        t.deep(tipos(palabras('y terminamos por hoy gracias'), { cerrar: ['terminamos por hoy'] }), ['cierra:1-3']);
        t.deep(tipos(palabras('el corte y sigo'), { cerrar: ['corte'] }), ['pausa-corta:1-1']);
        t.deep(tipos(palabras('el corte', 2000), { cerrar: ['corte'] }), ['cierra:1-1']);
    });

    t.test('con la cuenta apagada, «3, 2, 1» es habla', () => {
        t.deep(tipos(palabras('3, 2, 1. hola'), { cuenta: false }), []);
        t.deep(tipos(palabras('Retomamos hola'), { cuenta: false }), ['abre:0-0'], 'las frases siguen');
    });

    t.test('una lista vacía no oye nada de esa lista', () => {
        t.deep(tipos(palabras('listo Pausa.'), { cerrar: [] }), []);
    });

    t.group('frases · en la clase');

    t.test('una de cerrar partida entre dos pasadas: el OUT va antes de la frase entera', () => {
        const frases = { ...vivo.FRASES_DE_FABRICA, cerrar: ['terminamos por hoy'] };
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        e.tomas.push({ id: 1, vista: 'PV', inMs: T0, outMs: null, palabras: [], comentarios: [] });
        e.proximaToma = 1;
        const ws = palabras('esto es todo terminamos por hoy', 600);
        vivo.aplicarSenales(e, ws.slice(0, 5), { frases });
        t.ok(e.tomas[0].palabras.some(w => w.texto === 'terminamos'), 'la primera pasada guardó el comienzo como clase');
        vivo.aplicarSenales(e, ws, { frases });
        t.ok(e.tomas[0].outMs != null, 'cerró');
        t.ok(!e.tomas[0].palabras.some(w => w.texto === 'terminamos' || w.texto === 'por'), 'y la frase no quedó adentro');
        t.ok(e.tomas[0].outMs <= ws[3].t, 'el OUT no cae en el medio de la frase');
    });

    t.test('oída dos veces por el solape, abre una sola toma', () => {
        const frases = { ...vivo.FRASES_DE_FABRICA, abrir: ['ahora sí arrancamos'] };
        const e = vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
        const ws = palabras('ahora sí arrancamos hola gente');
        vivo.aplicarSenales(e, ws, { frases });
        // La pasada siguiente vuelve a traerla, con las horas un poco corridas.
        vivo.aplicarSenales(e, ws.map(w => ({ ...w, t: w.t + 120, hasta: w.hasta + 120 })).concat(palabras('y más', 400, T0 + 3000)), { frases });
        t.eq(e.tomas.length, 1);
    });

    t.test('cambiarlas con la clase andando: la pasada siguiente ya oye las nuevas', async () => {
        await conClaseMuda(async ({ s, w, oir }) => {
            await oir(w(1000, 'arrancamos'), w(1400, 'hola'), w(1800, 'gente'));
            t.eq(s.estado.tomas.length, 0, 'todavía no es una frase');
            t.ok(grabacion.cambiarFrases({ ...vivo.FRASES_DE_FABRICA, abrir: ['arrancamos'] }));
            await oir(w(5000, 'arrancamos'), w(5400, 'otra'), w(5800, 'vez'));
            t.eq(s.estado.tomas.length, 1, 'ahora sí');
            grabacion.cambiarFrases({ ...vivo.FRASES_DE_FABRICA, cerrar: [] });
            await oir(w(7000, 'Pausa.'));
            await oir();
            t.eq(s.estado.tomas[0].outMs, null, 'sin «pausa» en la lista, la toma sigue abierta');
        });
    });

    t.test('sin clase, cambiarlas no hace nada', () => {
        t.eq(grabacion.cambiarFrases({ ...vivo.FRASES_DE_FABRICA }), false);
    });

    t.group('frases · cambiar de vista');

    const DE_VISTA = { ...vivo.FRASES_DE_FABRICA, vista: [{ frase: 'vamos a nuestra pantalla', vista: 'R' }] };

    t.test('con la toma abierta, la parte después de la frase y la segunda sigue en esa vista', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.cambiarFrases(DE_VISTA);
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'esto'), w(2400, 'es'), w(2800, 'la'), w(3200, 'cámara'));
            await oir(w(4000, 'vamos'), w(4300, 'a'), w(4600, 'nuestra'), w(4900, 'pantalla'), w(5600, 'acá'), w(6000, 'vemos'));
            t.eq(s.estado.tomas.length, 2, 'partida');
            const [primera, segunda] = s.estado.tomas;
            t.eq(primera.vista, 'PV');
            t.eq(segunda.vista, 'R');
            t.eq(segunda.outMs, null, 'la segunda sigue abierta');
            t.eq(segunda.inMs, st.ceroMs + 5600, 'empieza en la palabra que sigue a la frase');
            t.ok(primera.palabras.some(p => p.texto === 'pantalla'), 'la frase queda al final de la primera');

            const r = grabacion.deshacer();
            t.ok(r.ok, r.error);
            t.eq(s.estado.tomas.length, 1, '⌘Z la deshace de una vez');
            t.eq(s.estado.tomas[0].vista, 'PV');
        });
    });

    t.test('con la toma recién abierta, la vista va a la toma entera', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.cambiarFrases(DE_VISTA);
            grabacion.abrirToma(st.ceroMs + 3500);
            await oir(w(3600, 'vamos'), w(3800, 'a'), w(4000, 'nuestra'), w(4200, 'pantalla'), w(4600, 'acá'));
            t.eq(s.estado.tomas.length, 1);
            t.eq(s.estado.tomas[0].vista, 'R');
        });
    });

    t.test('si la toma ya está en esa vista, no hace nada', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.cambiarFrases(DE_VISTA);
            grabacion.abrirToma(st.ceroMs + 1000);
            grabacion.editar({ tipo: 'vista', toma: 1, vista: 'R' });
            const pasos = s.historia.atras.length;
            await oir(w(4000, 'vamos'), w(4300, 'a'), w(4600, 'nuestra'), w(4900, 'pantalla'), w(5600, 'acá'));
            t.eq(s.estado.tomas.length, 1);
            t.eq(s.historia.atras.length, pasos, 'ni un paso en el historial');
        });
    });

    t.test('sin toma abierta, deja elegida la vista de la próxima', async () => {
        await conClaseMuda(async ({ s, w, oir }) => {
            grabacion.cambiarFrases(DE_VISTA);
            await oir(w(1000, 'vamos'), w(1300, 'a'), w(1600, 'nuestra'), w(1900, 'pantalla'), w(2400, 'bueno'));
            t.eq(s.estado.vistaProxima, 'R');
            await oir(w(4000, '3,'), w(4400, '2,'), w(4800, '1.'), w(5200, 'hola'), w(5600, 'gente'));
            t.eq(s.estado.tomas[0].vista, 'R', 'y la toma que abre la cuenta sale en R');
        });
    });

    t.test('la pantalla dice qué frase se oyó y qué hizo', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/ev\.tipo === 'vista' && ev\.hizo === 'partida'/.test(js));
        t.ok(/ev\.tipo === 'vista-proxima'/.test(js));
        t.ok(/ev\.por === 'cuenta' \? 'Toma abierta: 3, 2, 1\.'/.test(js), 'y la que abrió, con su frase');
    });

    t.group('frases · al guardar');

    t.test('sin vacías, sin repetidas y una frase en una sola lista', () => {
        const f = ajustes.sanear({
            frases: {
                abrir: ['Retomamos', 'retomamos.', '  ', ' ahora   sí ', 'Pausa'],
                cerrar: ['pausa', 'AHORA SI'],
                vista: [{ frase: 'ahora sí', vista: 'R' }, { frase: 'a slides', vista: 'S' }]
            }
        }).frases;
        t.deep(f.abrir, ['Retomamos', 'ahora sí', 'Pausa']);
        t.deep(f.cerrar, [], '«pausa» ya abría, y «ahora si» también');
        t.deep(f.vista, [{ frase: 'a slides', vista: 'S' }]);
    });

    t.test('con tope de largo y de cantidad, y sin vistas que no existen', () => {
        const larga = 'palabra '.repeat(20);
        const f = ajustes.sanear({
            frases: {
                abrir: Array.from({ length: 30 }, (_x, i) => `frase ${i}`).concat([larga]),
                vista: [{ frase: 'a la nada', vista: 'ZZ' }, { frase: 'sin vista' }]
            }
        }).frases;
        t.eq(f.abrir.length, ajustes.FRASES_POR_LISTA);
        t.deep(f.vista, []);
        const una = ajustes.sanear({ frases: { abrir: [larga] } }).frases.abrir[0];
        t.ok(una.length <= ajustes.FRASE_MAX, `cortada a ${ajustes.FRASE_MAX}`);
    });

    t.test('una lista vaciada queda vacía; una que no está trae las de fábrica', () => {
        const f = ajustes.sanear({ frases: { cuenta: false, cerrar: [] } }).frases;
        t.deep(f.cerrar, []);
        t.deep(f.abrir, ['retomamos']);
        t.eq(f.cuenta, false);
        t.deep(ajustes.sanear({}).frases, JSON.parse(JSON.stringify(vivo.FRASES_DE_FABRICA)));
    });

    t.group('frases · el camino hasta la clase');

    t.test('la clase arranca con las de Ajustes, y guardarlas grabando se las pasa', () => {
        t.ok(/frases: ajustes\.leer\(\)\.frases/.test(leer('ipc', 'grabar.js')));
        t.eq((leer('ipc', 'grabar.js').match(/frases: ajustes\.leer\(\)\.frases/g) || []).length, 2, 'al iniciar y al reanudar');
        t.ok(/if \('frases' in parche\) grabacion\.cambiarFrases\(guardados\.frases\);/.test(leer('main.js')));
        t.ok(/frases: s\.frases/.test(leer('engine', 'ciclo-senales.js')), 'y el ciclo se las pasa al motor');
    });

    t.test('escribiendo en Ajustes, los atajos de En vivo no se disparan', () => {
        t.ok(/if \(document\.querySelector\('\.telon\.es-activa'\)\) return;/.test(leer('src', 'js', 'pantalla-vivo.js')));
    });

    t.group('frases · la ventana marca lo mismo que el motor oye');

    const src = nombre => pathToFileURL(path.join(RAIZ, 'src', 'js', nombre)).href;
    const senales = await import(src('grabar/senales.js'));
    const frasesDeAjustes = await import(src('frases.js'));

    t.test('con frases propias, las mismas señales en el mismo sitio', () => {
        const f = {
            cuenta: false,
            abrir: ['ahora sí arrancamos'],
            cerrar: ['terminamos por hoy', 'corte'],
            vista: [{ frase: 'vamos a nuestra pantalla', vista: 'R' }]
        };
        senales.usarFrases(f);
        try {
            for (const texto of [
                '¡Ahora, sí: arrancamos! hola',
                'vamos a nuestra pantalla y vemos',
                'y terminamos por hoy gracias',
                '3, 2, 1. hola',
                'el corte y sigo'
            ]) {
                const ws = palabras(texto);
                const delMotor = vivo.senales(ws, undefined, vivo.reglasDeFrases(f)).map(s => [s.tipo, s.desde, s.hasta]);
                const deLaVentana = senales.senalesEn(ws).map(s => [s.tipo, s.desde, s.hasta]);
                t.deep(deLaVentana, delMotor, texto);
            }
        } finally {
            senales.usarFrases(null);
        }
    });

    t.test('Ajustes tiene las mismas vistas y las mismas de fábrica que el motor', () => {
        t.deep(frasesDeAjustes.VISTAS, vivo.VISTAS.map(v => ({ nombre: v.nombre, titulo: v.titulo })));
        t.deep(frasesDeAjustes.DE_FABRICA, JSON.parse(JSON.stringify(vivo.FRASES_DE_FABRICA)));
    });

    t.test('una frase de una sola palabra entra con una advertencia', () => {
        t.ok(/una sola palabra/.test(frasesDeAjustes.advertencia('abrir', 'retoma')));
        t.ok(/segundo de silencio/.test(frasesDeAjustes.advertencia('cerrar', 'corte')));
        t.eq(frasesDeAjustes.advertencia('vista', 'vamos a la pantalla'), '');
    });
};
