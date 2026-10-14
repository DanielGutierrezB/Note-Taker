'use strict';
/**
 * Lo que se dijo entre dos tomas, y desde dónde se puede tomar.
 *
 * Reportado el 13/10, grabando: «En este momento no me muestra transcript
 * antes del In en la toma 12, y en la 11 dice que corta al inicio de la 12.
 * Pero si hay transcript entre ambas, debería poder modificar en cualquiera de
 * los 2 lados.»
 *
 * Entre el OUT de la 11 y el IN de la 12 había medio minuto hablado, y ese
 * tramo se perdía en cuatro sitios distintos que se tapaban entre sí:
 *
 *   · **el conteo vaciaba las sueltas.** Abrir con «3, 2, 1» tiraba todo lo
 *     dicho antes, así que ni en vivo se veía;
 *   · **el puente las cortaba en el OUT de la última toma cerrada.** Un tramo
 *     del medio de la clase queda por debajo de ese piso, así que estaba en el
 *     motor y la ventana no lo recibía nunca (`sueltasQueSirven` en espejo.js);
 *   · **la pantalla no juntaba nada a la izquierda del IN de una toma cerrada.**
 *     Del otro lado del OUT juntaba tres fuentes, y acá mandaba solo la orilla
 *     de la relectura: por eso el tramo se veía desde la toma de arriba y no
 *     desde la de abajo, que es tal cual lo que reportó el editor;
 *   · **y el sidecar no las guardaba.** Vivían solo en memoria, así que cerrada
 *     la clase el tramo no existía para nadie.
 *
 * Lo que se prueba acá es que el tramo llega a la pantalla desde los dos lados
 * mientras la clase corre, y que queda ESCRITO para cuando no corra.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const oir = require('../engine/oir');
const espejo = require('../engine/espejo');
const vivo = require('../engine/notas-vivo');

const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-entre-'));

/** Whisper de mentira: la relectura devuelve lo que la toma ya tenía. */
function conWhisperFalso(fn) {
    return async () => {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { ventana: [], pedidos: [] };
        oirToma.tramo = async () => ({ palabras: falso.ventana });
        oirToma.leer = async (_a, toma, o) => {
            falso.pedidos.push({ toma: toma.id, tomas: (o || {}).tomas ? (o.tomas || []).length : 0 });
            return {
                antes: toma.antes || [], palabras: toma.palabras || [],
                despues: toma.despues || [], colapsadas: 0, relectura: null
            };
        };
        try { await fn(falso); } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
        }
    };
}

/**
 * Una función de la ventana, sacada del archivo y puesta a correr de verdad.
 *
 * `pantalla-vivo.js` es un módulo de la ventana —importa el DOM y media app—
 * así que no se puede cargar acá, pero estas tres funciones son cuentas puras
 * sobre `estado`. Se las saca por su nombre y se las corre con un `estado` de
 * mentira, igual que `tomas-que-no-se-pisan` hace con `tomaAnterior`: así la
 * prueba mide el código que se ejecuta y no una copia que ya cambió.
 *
 * @param {string} cual la que se devuelve
 * @param {string[]} [conQue] las que necesita al lado
 * @returns {function(object): Function} el `estado` y la función ya atada a él
 */
function sacar(cual, conQue) {
    const codigo = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pantalla-vivo.js'), 'utf8');
    const cuerpo = nombre => {
        const a = codigo.indexOf(`function ${nombre}(`);
        if (a === -1) throw new Error(`no está \`${nombre}\` en pantalla-vivo.js`);
        return codigo.slice(a, codigo.indexOf('\n}', a) + 2);
    };
    const partes = (conQue || []).concat([cual]).map(cuerpo).join('\n');
    // `coloresDeVista` y `SIGUIENTE_MAX` vienen de otros módulos: se dan hechos,
    // que es lo que deja correr el resto tal cual está escrito.
    // eslint-disable-next-line no-new-func
    const fabrica = new Function('estado', 'coloresDeVista', 'SIGUIENTE_MAX', 'ANTERIOR_MAX',
        `${partes} return ${cual};`);
    return estado => fabrica(estado, coloresDeVista, 25, 300);
}

/** Los colores de una vista, con la misma firma que en `colores.js`. */
function coloresDeVista(vistas, nombre) {
    const v = (vistas || []).find(x => x.nombre === nombre);
    return v ? { color: v.color, tinta: v.tinta } : {};
}

module.exports = function (t) {
    t.group('entre dos tomas · lo que llega a la pantalla');

    t.test('lo hablado entre dos tomas cruza el puente y se ve de los dos lados',
        conWhisperFalso(async falso => {
            // La secuencia del diario: la 11 se cierra con el botón, se habla
            // medio minuto sin ninguna toma, y la 12 se abre con el botón y
            // después se le corre el IN hacia adelante.
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });

            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(1, '3,'), w(1.4, '2,'), w(1.8, '1.'), w(3, 'empieza'), w(7, 'la')];
            await grabacion.buscarSenales();
            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(12, 'datos'), w(18, 'uno')];
            await grabacion.buscarSenales();
            grabacion.cerrarToma();

            // Medio minuto hablando sin ninguna toma abierta.
            for (let i = 0; i < 40; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(22, 'entonces'), w(30, 'esa'), w(38, 'sería'),
                w(46, 'la'), w(54, 'parte')];
            await grabacion.buscarSenales();

            grabacion.abrirToma();
            const t12 = s.estado.tomas.find(x => x.outMs == null);
            grabacion.editar({ tipo: 'borde', toma: t12.id, borde: 'in', paredMs: st.ceroMs + 54000 });

            const res = espejo.resumen(s);
            const entre = (res.sueltas || []).map(x => x.texto);
            t.ok(entre.includes('entonces') && entre.includes('sería'),
                `lo de en medio llega: ${entre.join(' ')}`);
            // Y desde los dos lados: el gris de la cerrada y el de la abierta
            // salen de las mismas sueltas (`despuesDeLaCerrada` y
            // `antesDeLaAbierta` en la pantalla).
            const cerrada = res.tomas.find(x => x.outMs != null);
            t.ok((res.sueltas || []).every(x => x.t >= cerrada.outMs),
                'todas caen después del OUT de la cerrada, que es lo que la pantalla filtra');
            t.ok((res.sueltas || []).some(x => x.t < t12.inMs), 'y antes del IN de la abierta');
        }));

    t.test('abrir con el conteo ya no borra lo que se dijo antes',
        conWhisperFalso(async falso => {
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const s = grabacion._sesion();
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });

            for (let i = 0; i < 20; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(2, 'charla'), w(6, 'suelta'), w(10, 'de'), w(14, 'pasillo')];
            await grabacion.buscarSenales();
            t.eq((s.estado.sueltas || []).length, 4, 'se oyó sin ninguna toma abierta');

            for (let i = 0; i < 10; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(22, '3,'), w(22.4, '2,'), w(22.8, '1.'), w(24, 'Hola')];
            await grabacion.buscarSenales();
            const res = espejo.resumen(s);
            t.deep((res.sueltas || []).map(x => x.texto), ['charla', 'suelta', 'de', 'pasillo'],
                'y sigue a mano para meterlo en una toma o para leerlo');
        }));

    t.test('una toma CERRADA también junta lo de antes de su IN', () => {
        // El agujero que quedaba: la pantalla juntaba tres fuentes a la derecha
        // del OUT (`despuesDeLaCerrada`) y a la izquierda del IN mandaba solo
        // `toma.antes`, la orilla de la relectura. O sea que el tramo de en
        // medio se veía desde la toma de arriba y no desde la de abajo, que es
        // justo lo que el editor reportó con la 11 y la 12. Y mientras la
        // relectura no terminara no había NI UNA palabra antes del IN, así que
        // el arrastre no tenía dónde apoyarse.
        //
        // Se corre el código de la ventana sacado del archivo, como en
        // `tomas-que-no-se-pisan`: así la prueba no mide una copia que ya cambió.
        const deLaVentana = sacar('antesDeLaCerrada', ['tomaAnterior', 'sueltasEntre']);
        const T = Date.parse('2026-10-13T16:00:00');
        const palabras = (desde, textos) => textos.map((texto, i) => ({
            t: desde + i * 1000, hasta: desde + i * 1000 + 300, texto
        }));
        const estado = {
            vistas: [{ nombre: 'PV', color: '#718637', tinta: '#fff' }],
            tomas: [
                {
                    id: 11, vista: 'PV', inMs: T, outMs: T + 20000,
                    palabras: palabras(T, ['la', 'once']),
                    // Su orilla llega hasta la vecina: son las mismas palabras
                    // que el tramo de en medio, contadas desde el otro lado.
                    antes: [], despues: palabras(T + 22000, ['entonces', 'esa', 'sería'])
                },
                {
                    id: 12, vista: 'R', inMs: T + 30000, outMs: T + 50000,
                    palabras: palabras(T + 30000, ['la', 'doce']),
                    // Todavía sin releer: su orilla izquierda está vacía.
                    antes: [], despues: []
                }
            ],
            sueltas: []
        };

        const atras = deLaVentana(estado)(estado.tomas[1]);
        t.deep(atras.antes.filter(w => !w.de).map(w => w.texto), ['entonces', 'esa', 'sería'],
            'lo hablado entre las dos aparece antes del IN de la 12');
        t.ok(atras.antes.some(w => w.de && w.de.id === 11),
            'y el final de la 11 se asoma, marcado como suyo');
        t.eq(atras.limite.toma, 11, 'con la marca de dónde termina la 11');
        t.eq(atras.limite.ms, T + 20000, 'puesta en su OUT, que es la pared del IN');
        t.eq(atras.limite.color, '#718637', 'y del color de su vista');
    });

    t.test('y nada de lo que ya es de una toma se cuela ahí', () => {
        // La otra mitad: juntar tres fuentes no puede traer al gris palabras que
        // están DENTRO de una toma, porque entonces el mismo texto se leería dos
        // veces y el IN podría entrar donde no entra.
        const deLaVentana = sacar('antesDeLaCerrada', ['tomaAnterior', 'sueltasEntre']);
        const T = Date.parse('2026-10-13T16:00:00');
        const w = (ms, texto) => ({ t: ms, hasta: ms + 300, texto });
        const estado = {
            vistas: [],
            tomas: [
                {
                    id: 1, vista: 'PV', inMs: T, outMs: T + 10000,
                    palabras: [w(T + 1000, 'adentro-de-la-1')],
                    antes: [], despues: [w(T + 12000, 'en-medio')]
                },
                {
                    id: 2, vista: 'PV', inMs: T + 20000, outMs: T + 30000,
                    palabras: [w(T + 21000, 'adentro-de-la-2')],
                    // Una orilla que se pasa de largo: llega hasta dentro de la 1.
                    antes: [w(T + 1000, 'adentro-de-la-1'), w(T + 12000, 'en-medio')],
                    despues: []
                }
            ],
            sueltas: []
        };

        const atras = deLaVentana(estado)(estado.tomas[1]);
        const grises = atras.antes.filter(x => !x.de).map(x => x.texto);
        t.deep(grises, ['en-medio'], 'solo el tramo de nadie, no lo que es de la 1');
        t.ok(!atras.antes.some(x => x.t >= estado.tomas[1].inMs),
            'y nada de la toma misma, que ya se dibuja entre las dos líneas');
    });

    t.test('una toma desactivada no tapa lo que se dijo en su tramo', () => {
        // Descartar saca la toma del XML y su tramo queda libre —lo mismo que
        // decide `tomaAnterior` y `pisoDeLasSueltas` en el motor—, así que el
        // piso de las sueltas no la puede contar. Contándola, el puente se
        // quedaba con ese texto y la ventana no lo dibujaba ni dejaba abrir ahí.
        const deLaVentana = sacar('sueltasLibres');
        const T = Date.parse('2026-10-13T16:00:00');
        const w = (ms, texto) => ({ t: ms, hasta: ms + 300, texto });
        const estado = {
            tomas: [{ id: 1, inMs: T, outMs: T + 40000, descartada: true, palabras: [] }],
            sueltas: [w(T + 10000, 'dentro-de-la-descartada'), w(T + 50000, 'despues')]
        };
        t.deep(deLaVentana(estado)().map(x => x.texto),
            ['dentro-de-la-descartada', 'despues'], 'las dos se pueden ver y tomar');

        // Y el puente dice lo mismo, que es de donde las saca la ventana.
        const falsa = {
            dir: carpeta(),
            estado: { ...estado, secuencia: 'e_2026-10-13_16-00-00', ceroMs: T, claquetas: [] },
            captura: {}, cola: [], historia: { atras: [], adelante: [] }
        };
        t.deep(espejo.resumen(falsa).sueltas.map(x => x.texto),
            ['dentro-de-la-descartada', 'despues'], 'el motor manda las dos');
    });

    t.test('y la tarjeta de la toma cerrada se lo pide, que es lo que la dibuja', () => {
        // La cuenta puede estar perfecta y no llamarla nadie. Lo que se mira es
        // el único sitio donde se arma el texto de una toma cerrada.
        const codigo = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'js', 'pantalla-vivo.js'), 'utf8');
        const desde = codigo.indexOf("} else if (cual === 'cerrada' && toma) {");
        const rama = codigo.slice(desde, codigo.indexOf('}, soltar, previo));', desde));
        t.ok(desde !== -1, 'la rama está donde se la busca');
        t.ok(/antesDeLaCerrada\(toma\)/.test(rama), 'junta lo de antes del IN');
        t.ok(/antes: atras\.antes/.test(rama), 'y se lo pasa al texto');
        t.ok(/limite: atras\.limite/.test(rama),
            'con la marca de la toma anterior, que es la pared del arrastre');
        t.ok(/limiteDespues: adelante\.limiteDespues/.test(rama),
            'y la del otro lado sigue estando: son los dos lados, no uno');
    });

    t.group('entre dos tomas · lo que queda escrito');

    t.test('la orilla de una toma llega hasta su vecina, no doce segundos', () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const tomas = [
            { id: 1, inMs: T, outMs: T + 20000 },
            { id: 2, inMs: T + 55000, outMs: T + 80000 }
        ];
        // 35 s entre una y otra: la orilla los cubre enteros por los dos lados.
        t.eq(vivo.techoDelOut(tomas, tomas[0]) - tomas[0].outMs, 35000);
        t.eq(tomas[1].inMs - vivo.pisoDelIn(tomas, tomas[1]), 35000);
    });

    t.test('y no más allá, que sería escribir la misma frase en las dos tomas', () => {
        // Con la vecina a dos segundos, la orilla se achica: lo de más allá de
        // su borde ya es texto suyo.
        const T = Date.parse('2026-10-13T16:00:00');
        const tomas = [
            { id: 1, inMs: T, outMs: T + 20000 },
            { id: 2, inMs: T + 22000, outMs: T + 40000 }
        ];
        t.eq(vivo.techoDelOut(tomas, tomas[0]) - tomas[0].outMs, 2000);
    });

    t.test('y eso es lo que se le pide a Whisper, no doce segundos', async () => {
        const T = Date.parse('2026-10-13T16:00:00');
        const antes = oir.escuchar;
        const pedidos = [];
        oir.escuchar = async p => {
            pedidos.push({ desde: (p.desdeMs - T) / 1000, hasta: (p.hastaMs - T) / 1000 });
            return { palabras: [], colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: [] };
        };
        try {
            const archivos = [{ archivo: __filename, desdeMs: T, segundos: 600 }];
            const tomas = [
                { id: 1, inMs: T + 100000, outMs: T + 120000 },
                { id: 2, inMs: T + 155000, outMs: T + 180000 },
                { id: 3, inMs: T + 220000, outMs: T + 240000 }
            ];
            await oirToma.leer(archivos, tomas[1], { idioma: 'es', tomas });
            t.eq(pedidos[0].desde, 120, 'por la izquierda llega al OUT de la 1');
            t.eq(pedidos[0].hasta, 220, 'y por la derecha al IN de la 3');

            // Sin vecinas, la orilla de siempre.
            pedidos.length = 0;
            await oirToma.leer(archivos, { id: 9, inMs: T + 300000, outMs: T + 320000 }, { idioma: 'es' });
            t.eq(pedidos[0].desde, 300 - oirToma.ORILLA_MS / 1000);
            t.eq(pedidos[0].hasta, 320 + oirToma.ORILLA_MS / 1000);
        } finally { oir.escuchar = antes; }
    });

    t.test('con una vecina muy lejos la orilla se planta en el tope', async () => {
        // Cada segundo de orilla es audio que Whisper transcribe dos veces, una
        // por cada lado. Minuto y medio es el trato.
        const T = Date.parse('2026-10-13T16:00:00');
        const antes = oir.escuchar;
        const pedidos = [];
        oir.escuchar = async p => {
            pedidos.push({ desde: (p.desdeMs - T) / 1000, hasta: (p.hastaMs - T) / 1000 });
            return { palabras: [], colapsadas: 0, mudas: 0, quitadas: [], inventadas: [], huecos: [] };
        };
        try {
            const tomas = [
                { id: 1, inMs: T + 10000, outMs: T + 20000 },
                { id: 2, inMs: T + 500000, outMs: T + 520000 }
            ];
            await oirToma.leer([{ archivo: __filename, desdeMs: T, segundos: 2000 }], tomas[1],
                { idioma: 'es', tomas });
            t.eq(pedidos[0].desde, 500 - oirToma.ORILLA_MAX_MS / 1000, 'no se trae media clase');
        } finally { oir.escuchar = antes; }
    });

    t.test('la relectura recibe las tomas, que es de donde sale la orilla',
        conWhisperFalso(async falso => {
            // El cableado, que es lo que puede volverse atrás en silencio: sin
            // las tomas, `oir-toma` se queda con los doce segundos de siempre y
            // el tramo entre dos tomas vuelve a no guardarse en ninguna parte.
            const st = grabacion.iniciar({
                dir: carpeta(), curso: 'e', fps: 30, sinReloj: true, sampleRate: 48000
            });
            const w = (seg, texto) => ({ t: st.ceroMs + seg * 1000, texto, hasta: st.ceroMs + seg * 1000 + 300 });
            for (let i = 0; i < 8; i++) grabacion.pcm(pedazo());
            falso.ventana = [w(1, '3,'), w(1.4, '2,'), w(1.8, '1.'), w(3, 'Hola')];
            await grabacion.buscarSenales();
            grabacion.cerrarToma();
            for (let i = 0; i < 14; i++) grabacion.pcm(pedazo());
            falso.ventana = [];
            await grabacion.buscarSenales();
            await new Promise(r => setTimeout(r, 40));
            t.ok(falso.pedidos.length > 0, 'se releyó');
            t.ok(falso.pedidos.every(p => p.tomas > 0), 'y con las tomas en la mano');
        }));
};
