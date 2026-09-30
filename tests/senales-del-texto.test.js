'use strict';
/**
 * Las palabras señal, marcadas en el transcript.
 *
 * Dos cosas se prueban acá, y la segunda es la que importa a largo plazo:
 *
 *   · Que `src/js/grabar/senales.js` encuentre lo que tiene que encontrar y
 *     —sobre todo— que NO marque lo que no es señal: "uno de los problemas" y
 *     "tenemos uno, dos, tres opciones" son habla, y marcarlas convertiría el
 *     transcript en un arcoíris de palabras comunes.
 *
 *   · Que esa copia no se separe del motor. La regla vive en
 *     `engine/notas-vivo.js`, y la ventana la tiene escrita otra vez porque
 *     corre en otro proceso. Así que las expresiones se leen DE LOS DOS
 *     ARCHIVOS y se comparan carácter por carácter: si alguien afina la del
 *     conteo en el motor, esta prueba se pone roja hasta que la afine acá.
 *
 * Y que el resalte no le cambie la caja a la palabra, que es de lo que depende
 * el arrastre del IN y del OUT (`palabraBajo` mide posiciones de verdad).
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/** Palabras cada `cada` milisegundos, que es lo que el hueco de «Pausa» mide. */
function palabras(texto, cada) {
    const paso = cada == null ? 400 : cada;
    return texto.split(' ').map((w, i) => ({ t: 10000 + i * paso, hasta: 10000 + i * paso + 380, texto: w }));
}

module.exports = async t => {
    const src = nombre => pathToFileURL(path.join(RAIZ, 'src', 'js', nombre)).href;
    const senales = await import(src('grabar/senales.js'));

    /** Los tipos por palabra, para poder escribir la expectativa de un tirón. */
    const marcas = ws => {
        const m = senales.porPalabra(ws);
        return ws.map((w, i) => (m.get(i) || {}).tipo || null);
    };

    t.group('señales · el conteo que abre');

    t.test('«3, 2, 1» se marca entero', () => {
        t.deep(marcas(palabras('bueno 3, 2, 1. arrancamos')), [null, 'abre', 'abre', 'abre', null]);
    });

    t.test('escrito en letras, lo mismo', () => {
        t.deep(marcas(palabras('tres dos uno')), ['abre', 'abre', 'abre']);
    });

    t.test('el «ok» de adelante es parte de la señal', () => {
        // El motor lo toma como parte del conteo, así que se marca igual: si no,
        // la plaquita empezaría una palabra después de donde la app oyó.
        t.deep(marcas(palabras('ok 3, 2, 1.')), ['abre', 'abre', 'abre', 'abre']);
    });

    t.test('un «ok» que no lleva conteo detrás no se marca', () => {
        t.deep(marcas(palabras('ok seguimos')), [null, null]);
    });

    t.test('el falso arranque «3 2 3 2 1» se marca completo', () => {
        // Está escrito así en el curso de verdad: el profesor se corrige.
        t.deep(marcas(palabras('3 2 3 2 1.')), ['abre', 'abre', 'abre', 'abre', 'abre']);
    });

    t.test('un número suelto no es un conteo', () => {
        t.deep(marcas(palabras('uno de los problemas más comunes')),
            [null, null, null, null, null, null]);
    });

    t.test('una cuenta que no termina en uno tampoco', () => {
        t.deep(marcas(palabras('tenemos uno, dos, tres opciones')),
            [null, null, null, null, null]);
    });

    t.test('«Retomamos» abre y se marca sola', () => {
        t.deep(marcas(palabras('listo Retomamos.')), [null, 'abre']);
    });

    t.group('señales · la pausa, que a veces cierra y a veces no');

    t.test('con el segundo de silencio detrás, cierra', () => {
        t.deep(marcas(palabras('y listo Pausa. bueno', 1200)), [null, null, 'cierra', null]);
    });

    t.test('con la clase siguiendo detrás, no cierra: queda hueca', () => {
        // «acá hacemos una pausa en el flujo» es la frase que la rompía.
        t.deep(marcas(palabras('hacemos una pausa en el flujo', 420)),
            [null, null, 'pausa-corta', null, null, null]);
    });

    t.test('la «Pausa» que todavía no tiene palabra detrás se muestra hueca', () => {
        // La ventana no sabe hasta dónde llegó el audio —eso lo resuelve el
        // motor con `finMs`—, y de las dos maneras de equivocarse prefiere esta:
        // decir «cerró» de una toma que sigue abierta sería mentir.
        t.deep(marcas(palabras('y listo Pausa.')), [null, null, 'pausa-corta']);
    });

    t.group('señales · la claqueta, como Whisper la escriba');

    t.test('las cinco escrituras que salieron en clases de verdad', () => {
        for (const como of ['Claqueta', 'Claquetados', 'Cacleta', 'Klaqueta', 'Laqueta', 'TLAQUETA']) {
            t.deep(marcas(palabras(`${como} clase 2`))[0], 'claqueta', `${como} se marca`);
        }
    });

    t.test('una claqueta nunca se lee además como otra cosa', () => {
        // En el motor la claqueta corta el recorrido (`continue`), y acá igual:
        // una palabra tiene una marca y no dos.
        const m = senales.senalesEn(palabras('Laqueta pausa', 300));
        t.eq(m.length, 2);
        t.eq(m[0].tipo, 'claqueta');
        t.eq(m[1].tipo, 'pausa-corta');
    });

    t.group('señales · sobre la tirada que se dibuja');

    t.test('los índices son los de la tirada entera, orillas incluidas', () => {
        // El conteo vive en lo gris de ANTES del IN y la pausa en lo de después
        // del OUT: si los índices fueran por pedazo, la marca caería corrida.
        const antes = palabras('tres dos uno');
        const dentro = palabras('Hola y bienvenidos');
        const m = senales.porPalabra(antes.concat(dentro));
        t.deep([0, 1, 2].map(i => m.get(i).tipo), ['abre', 'abre', 'abre']);
        t.eq(m.get(3), undefined, 'lo de la toma no se marca');
    });

    t.test('un corte de toma larga parte la tirada', () => {
        // A los dos lados de «… 900 palabras más …» no hay ninguna relación: la
        // palabra que sigue a una «Pausa» de ahí es de veinte minutos después.
        const ws = palabras('y listo Pausa.', 420)
            .concat([{ corte: 900 }], palabras('después de todo eso', 420));
        const m = senales.porPalabra(ws);
        t.eq(m.get(2).tipo, 'pausa-corta', 'no se le cree al otro lado del corte');
        t.eq(m.get(3), undefined, 'el corte no es una palabra');
    });

    t.test('sin palabras no explota', () => {
        t.deep(senales.senalesEn(null), []);
        t.eq(senales.porPalabra(null).size, 0);
    });

    t.test('cada tipo de señal dice qué hace, para la pista de la palabra', () => {
        for (const tipo of ['abre', 'cierra', 'claqueta', 'pausa-corta']) {
            t.ok(senales.QUE_HACE[tipo], `${tipo} tiene pista`);
            t.ok(senales.pistaDe({ tipo }).startsWith(senales.QUE_HACE[tipo]), `${tipo} la usa`);
        }
    });

    t.test('la «Pausa» que no cerró dice de cuánto fue el hueco', () => {
        // El dato lo mide la ventana y lo tiraba: la plaquita hueca decía que
        // la app no hizo nada, y no cuánto faltó. Con 0,3 s el profesor siguió
        // hablando y la toma tenía que seguir abierta; con 0,9 el umbral está
        // pidiendo demasiado. Hasta ahora eso solo estaba en el registro.
        const ws = palabras('hacemos una pausa en el flujo', 420);
        const senal = senales.porPalabra(ws).get(2);
        t.eq(senal.tipo, 'pausa-corta');
        t.eq(senal.huecoSec, 0.42, 'el hueco medido, redondeado como en el motor');
        const pista = senales.pistaDe(senal);
        t.ok(/0,42 s/.test(pista), 'con coma, que es como se escriben acá los decimales');
        t.ok(new RegExp(`hace falta ${senales.SILENCIO_TRAS_PAUSA_SEC}$`).test(pista),
            'y contra cuánto se lo compara');
    });

    t.test('sin palabra detrás no se inventa un hueco de cero', () => {
        // Ahí no se midió nada todavía: decir «el hueco fue de 0 s» sería decir
        // que el profesor siguió hablando sin respirar.
        const senal = senales.porPalabra(palabras('y listo Pausa.')).get(2);
        t.eq(senal.tipo, 'pausa-corta');
        t.eq(senal.huecoSec, null, 'no hay hueco que medir');
        t.eq(senales.pistaDe(senal), senales.QUE_HACE['pausa-corta'], 'y no se dice nada de más');
    });

    t.test('la palabra lleva el tipo en el atributo y la pista entera en el título', () => {
        const codigo = leer('src', 'js', 'grabar', 'texto-toma.js');
        t.ok(/s\.dataset\.senal = senal\.tipo/.test(codigo), 'el CSS sigue pintando por tipo');
        t.ok(/s\.title = senales\.pistaDe\(senal\)/.test(codigo), 'y el hueco llega al título');
    });

    t.group('señales · la ventana y el motor dicen lo mismo');

    t.test('las expresiones y los números son los del motor, letra por letra', () => {
        const motor = leer('engine', 'notas-vivo.js');
        const ventana = leer('src', 'js', 'grabar', 'senales.js');
        const literal = (codigo, nombre) => {
            const m = codigo.match(new RegExp(`^(?:export )?const ${nombre} = (.+);$`, 'm'));
            return m ? m[1].trim() : null;
        };
        // PALABRA_Y_APLAUSO_MS está acá porque de ella cuelga el aviso de la
        // palmada: es lo que el motor tarda como MÍNIMO en poder confirmar, y si
        // el motor la cambiara, la pantalla diría «sin confirmar» antes de tiempo.
        for (const nombre of ['CUENTA', 'RETOMAR', 'PAUSA', 'OK', 'CLAQUETA',
            'MINIMO_DE_CUENTA', 'VALOR', 'SILENCIO_TRAS_PAUSA_SEC', 'PALABRA_Y_APLAUSO_MS']) {
            const delMotor = literal(motor, nombre);
            t.ok(delMotor, `${nombre} se encontró en el motor`);
            t.eq(literal(ventana, nombre), delMotor, `${nombre} es la misma en la ventana`);
        }
    });

    t.group('señales · el resalte no le cambia la caja a la palabra');

    t.test('la marca va en el mismo span de la palabra, sin envolverla', () => {
        // Envolverla rompería las tres cosas del arrastre que trabajan con
        // hermanos y con cajas: `palabraBajo`, `marcarOrillas` y `malParada`.
        const codigo = leer('src', 'js', 'grabar', 'texto-toma.js');
        const cuerpo = codigo.slice(
            codigo.indexOf('function palabra(w, comentarios, senal)'),
            codigo.indexOf('\n}', codigo.indexOf('function palabra(w, comentarios, senal)')));
        t.ok(/s\.dataset\.senal = senal/.test(cuerpo), 'el atributo va en el span de la palabra');
        t.eq((cuerpo.match(/createElement/g) || []).length, 1, 'un solo nodo por palabra, como antes');
    });

    t.test('el estilo no toca la geometría ni pisa los colores de vista', () => {
        const css = leer('src', 'css', 'style.css');
        const desde = css.indexOf(".transcript .palabra[data-senal] {");
        t.ok(desde > 0, 'la regla existe');
        const bloque = css.slice(desde, css.indexOf('}', css.indexOf("[data-senal='pausa-corta']")));
        t.ok(/padding:\s*0 /.test(bloque), 'nada de relleno vertical: el alto de la caja no se mueve');
        t.ok(!/\bborder:/.test(bloque), 'ningún borde de verdad, que suma un píxel de cada lado');
        t.ok(/inset /.test(bloque), 'el contorno de la hueca va por dentro');
        t.ok(!/#[0-9a-fA-F]{3,6}/.test(bloque), 'los colores salen de la paleta y no a mano');
        t.ok(!/--vista/.test(bloque), 'no usa el color de la vista: es lo único que no puede parecer');
    });
};
