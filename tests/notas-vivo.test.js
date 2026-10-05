'use strict';
/**
 * Las señales: qué abre una toma, qué la cierra y qué no.
 *
 * Los casos que están acá no son inventados: cada uno es una toma que se perdió
 * o que se partió al medio en material real, y el comentario dice cuál.
 */

const vivo = require('../engine/notas-vivo');

const T0 = Date.parse('2026-09-29T10:00:00');

/** Palabras con su hora del día, como las entrega `oir.aHoraDelDia`. */
function palabras(pares) {
    return pares.map(([dt, texto]) => ({ t: T0 + dt, texto, hasta: T0 + dt + 300 }));
}

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

module.exports = function (t) {
    t.group('notas-vivo · el conteo abre');

    t.test('"3, 2, 1" abre una toma', () => {
        const e = nuevo();
        const ev = vivo.aplicarSenales(e, palabras([
            [0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']
        ]));
        t.eq(e.tomas.length, 1, 'una toma');
        t.eq(ev[0].tipo, 'abierta');
        t.eq(ev[0].por, 'cuenta');
    });

    t.test('el IN cae en la palabra que sigue al conteo, no en el conteo', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola'], [2000, 'mundo']
        ]));
        t.eq(e.tomas[0].inMs, T0 + 1600, 'arranca en "Hola"');
    });

    t.test('el conteo queda en `cuenta` y no adentro de la toma', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']
        ]));
        t.eq(e.tomas[0].cuenta, '3, 2, 1.');
        t.deep(e.tomas[0].palabras.map(w => w.texto), ['Hola']);
    });

    t.test('"Ok" delante del conteo es parte de la señal', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, 'Ok.'], [300, '3,'], [700, '2,'], [1100, '1.'], [1900, 'Vamos']
        ]));
        t.eq(e.tomas.length, 1);
        t.eq(e.tomas[0].inMs, T0 + 1900);
    });

    t.test('"Retomamos" solo también abre', () => {
        const e = nuevo();
        const ev = vivo.aplicarSenales(e, palabras([[0, 'Retomamos.'], [900, 'Entonces']]));
        t.eq(e.tomas.length, 1);
        t.eq(ev[0].por, 'retomamos');
    });

    t.test('un número suelto no abre nada', () => {
        // "Uno de los problemas más comunes" abre clases de verdad.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'Uno'], [400, 'de'], [800, 'los'], [1200, 'problemas']]));
        t.eq(e.tomas.length, 0);
    });

    t.test('una cuenta que no termina en uno es habla', () => {
        // "tenemos uno, dos, tres opciones": dos números seguidos, pero sube.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, 'tenemos'], [400, 'uno,'], [800, 'dos,'], [1200, 'tres'], [1600, 'opciones']
        ]));
        t.eq(e.tomas.length, 0);
    });

    t.test('"3, 2, 1..." con puntos suspensivos también abre', () => {
        // Whisper cierra el conteo con puntos suspensivos y con un solo signo
        // permitido el "1..." dejaba de ser número y la toma no se abría.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1...'], [1600, 'Hola']]));
        t.eq(e.tomas.length, 1);
    });

    t.test('el conteo adentro de una toma abierta no la parte', () => {
        // Un profesor explicando "…porque dije 3, 2, 1" partía la toma en dos:
        // una huérfana de tres segundos y la buena al lado.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([
            [20000, 'porque'], [20400, 'dije'], [20800, '3,'], [21200, '2,'], [21600, '1.']
        ]));
        t.eq(e.tomas.length, 1, 'sigue habiendo una sola');
        t.eq(e.tomas[0].outMs, null, 'y sigue abierta');
    });

    t.group('notas-vivo · la vista de la toma nueva');

    t.test('la primera toma arranca en PV', () => {
        const e = nuevo();
        vivo.abrirToma(e, T0);
        t.eq(e.tomas[0].vista, 'PV');
    });

    t.test('la toma nueva hereda la vista de la anterior', () => {
        // Una clase se graba por tramos con la misma vista: heredarla acierta
        // casi siempre, y poner PV en todas obligaba a elegir en cada toma.
        const e = nuevo();
        const { toma } = vivo.abrirToma(e, T0);
        vivo.aplicar(toma, { tipo: 'vista', vista: 'S' });
        toma.outMs = T0 + 1000;
        vivo.abrirToma(e, T0 + 2000);
        t.eq(e.tomas[1].vista, 'S');
    });

    t.test('una toma desactivada no decide la vista de la que viene', () => {
        const e = nuevo();
        const a = vivo.abrirToma(e, T0).toma;
        vivo.aplicar(a, { tipo: 'vista', vista: 'S' });
        a.outMs = T0 + 1000;
        const b = vivo.abrirToma(e, T0 + 2000).toma;
        vivo.aplicar(b, { tipo: 'vista', vista: 'X2' });
        vivo.aplicar(b, { tipo: 'descartar', descartada: true });
        b.outMs = T0 + 3000;
        vivo.abrirToma(e, T0 + 4000);
        t.eq(e.tomas[2].vista, 'S', 'la de la última que cuenta');
    });

    t.test('el conteo hablado también la hereda', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicar(e.tomas[0], { tipo: 'vista', vista: 'MG' });
        vivo.aplicarSenales(e, palabras([[5000, 'Pausa.'], [9000, 'Che']]));
        vivo.aplicarSenales(e, palabras([[12000, '3,'], [12400, '2,'], [12800, '1.'], [13600, 'Otra']]));
        t.eq(e.tomas[1].vista, 'MG');
    });

    t.group('notas-vivo · la pausa cierra');

    t.test('"Pausa" con silencio detrás cierra la toma', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        const ev = vivo.aplicarSenales(e, palabras([[5000, 'Pausa.'], [9000, 'Che']]));
        t.eq(ev[0].tipo, 'cerrada');
        t.ok(e.tomas[0].outMs != null, 'quedó cerrada');
    });

    t.test('«Pausa» y el profesor para: cierra aunque la palabra dure', () => {
        // Lo que se rompió el 29/09: el hueco se medía desde el FINAL de
        // «Pausa», y ese final lo corre el DTW varias décimas hacia adelante.
        // Con la palabra durando 600 ms y la siguiente a 1,1 s, el hueco medido
        // daba 0,5 s y la toma no cerraba: había que cerrarla a mano.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        const pausa = { t: T0 + 5000, texto: 'Pausa.', hasta: T0 + 5600 };
        const despues = { t: T0 + 6100, texto: 'Listo', hasta: T0 + 6400 };
        const ev = vivo.aplicarSenales(e, [pausa, despues]);
        t.eq(ev[0].tipo, 'cerrada');
        t.ok(e.tomas[0].outMs != null, 'quedó cerrada');
    });

    t.test('una «Pausa» que no cierra queda contada, con su hueco', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        const ev = vivo.aplicarSenales(e, palabras([[5000, 'pausa'], [5300, 'en'], [5600, 'el']]));
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
        const corta = ev.find(x => x.tipo === 'pausa-corta');
        t.ok(corta, 'se cuenta');
        t.eq(corta.huecoSec, 0.3, 'con el hueco que se midió');
    });

    t.test('"pausa" sin silencio detrás es habla', () => {
        // "acá hacemos una pausa en el flujo" no cierra nada.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'pausa'], [5300, 'en'], [5600, 'el'], [5900, 'flujo']]));
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
    });

    t.test('el OUT es el final de la última palabra, no la hora de "Pausa"', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Pausa.'], [9000, 'Che']]));
        t.eq(e.tomas[0].outMs, T0 + 1600 + 300, 'el `hasta` de "Hola"');
    });

    t.group('notas-vivo · el solape del ciclo no duplica');

    t.test('la misma señal en dos ventanas abre una sola toma', () => {
        // El ciclo escucha ventanas que se solapan: un conteo en el borde
        // aparece en dos pasadas seguidas, y eso es a propósito.
        const e = nuevo();
        const cuenta = palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]);
        vivo.aplicarSenales(e, cuenta);
        vivo.aplicarSenales(e, cuenta);
        t.eq(e.tomas.length, 1);
    });

    t.test('una palabra ya oída no se guarda dos veces', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[1600, 'Hola'], [2400, 'mundo']]));
        t.deep(e.tomas[0].palabras.map(w => w.texto), ['Hola', 'mundo']);
    });

    t.test('el solape se engancha por el texto aunque la hora se corra', () => {
        // Sin DTW la hora de una palabra se corre de una pasada a otra. La
        // regresión, medida en una prueba por Zoom: «Esto inicia la primera
        // toma» quedaba en «inicia la toma», y «voy a» salía dos veces.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'voy'], [300, 'a'], [600, 'iniciar'], [1100, 'una']]));
        // La pasada siguiente oye lo mismo 400 ms antes, y sigue.
        vivo.aplicarSenales(e, palabras([
            [-400, 'voy'], [-100, 'a'], [200, 'iniciar'], [700, 'una'], [1000, 'toma'], [1400, 'nueva']
        ]));
        t.deep(e.sueltas.map(w => w.texto), ['voy', 'a', 'iniciar', 'una', 'toma', 'nueva'],
            'ni repetidas ni perdidas');
    });

    t.test('y aunque la hora se corra para el otro lado', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'puedo'], [400, 'ver'], [800, 'cómo']]));
        vivo.aplicarSenales(e, palabras([[450, 'puedo'], [850, 'ver'], [1250, 'cómo'], [1600, 'está']]));
        t.deep(e.sueltas.map(w => w.texto), ['puedo', 'ver', 'cómo', 'está']);
    });

    t.group('notas-vivo · la cola de cada pasada');

    t.test('lo del final no se guarda: vuelve entero en la pasada siguiente', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'cómo'], [400, 'está'], [800, 'funcion']]),
            { firmeHastaMs: T0 + 800 });
        t.deep(e.sueltas.map(w => w.texto), ['cómo', 'está'], '«funcion» cortada, esperando');
        vivo.aplicarSenales(e, palabras([[0, 'cómo'], [400, 'está'], [800, 'funcionando'], [1500, 'bien']]));
        t.deep(e.sueltas.map(w => w.texto), ['cómo', 'está', 'funcionando', 'bien']);
    });

    t.test('"pausa" al borde mira lo que sigue en la cola y no cierra', () => {
        // Sin la cola para mirar, «pausa» quedaba última de lo firme, o sea con
        // silencio detrás, y «acá hacemos una pausa en el flujo» cerraba la toma.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'pausa'], [5300, 'en'], [5600, 'el']]),
            { firmeHastaMs: T0 + 5000 + 300 });
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
    });

    t.test('una señal en la cola espera a la pasada siguiente', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'bueno'], [400, '3,'], [800, '2,'], [1200, '1.']]),
            { firmeHastaMs: T0 + 900 });
        t.eq(e.tomas.length, 0, 'todavía no');
        vivo.aplicarSenales(e, palabras([[400, '3,'], [800, '2,'], [1200, '1.'], [2000, 'Hola']]));
        t.eq(e.tomas.length, 1, 'y ahí sí, una sola');
    });

    t.group('notas-vivo · el conteo en inglés');

    t.test('"three, two, one" abre una toma', () => {
        // Con el idioma en automático, la pasada que oyó medio conteo llegó
        // como «Okay. Three.»: el modelo escribe el número con letras cuando
        // está solo, y sin esto la toma no abría.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'three,'], [400, 'two,'], [800, 'one.']]));
        t.eq(e.tomas.length, 1);
    });

    t.test('"Okay" delante del conteo es parte de la señal', () => {
        // Medido con el residente: en inglés lo escribe «Okay» y no «Ok».
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'Okay'], [300, '3,'], [700, '2,'], [1100, '1.']]));
        t.eq(e.tomas.length, 1, 'abrió');
        t.ok(/Okay/.test(e.tomas[0].cuenta || ''), 'y el «Okay» quedó en la cuenta');
    });

    t.test('"one" suelto no abre nada', () => {
        // «one of the problems» es el «uno de los problemas» del otro idioma:
        // un número solo es habla, y la cuenta tiene que ser de dos o más.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'one'], [400, 'of'], [800, 'the'], [1200, 'problems']]));
        t.eq(e.tomas.length, 0);
    });

    t.test('"Pause" cierra la toma igual que "Pausa"', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'three,'], [400, 'two,'], [800, 'one.'], [1600, 'Hello']]));
        vivo.aplicarSenales(e, palabras([[5000, 'Pause.']]),
            { firmeHastaMs: T0 + 9400, finMs: T0 + 9900 });
        t.ok(e.tomas[0].outMs != null, 'cerró');
    });

    t.test('y "pausing" o "pauses" no son la señal', () => {
        // La expresión pide la palabra entera: con `paus[ae]` suelto, cualquier
        // cosa que empiece igual cerraría la toma a mitad de una explicación.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hello']]));
        vivo.aplicarSenales(e, palabras([[5000, 'pausing']]),
            { firmeHastaMs: T0 + 9400, finMs: T0 + 9900 });
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
    });

    t.group('notas-vivo · la última palabra, estirada por el silencio');

    t.test('el "1" con el final estirado hasta el borde abre igual', () => {
        // Medido en la primera grabación de verdad del vídeo semanal: cuando
        // detrás hay silencio —y detrás de un «3, 2, 1» siempre lo hay, el que
        // uno deja esperando a que la toma abra— Whisper le estira el final a
        // la última palabra hasta el final del audio que oyó. El «1...» llegó
        // cinco pasadas seguidas como 9.64-10.23, -11.26, -12.28, -13.30, con
        // el final corriéndose detrás de la ventana, y la toma no abrió nunca:
        // había que decir el conteo otra vez y seguir hablando.
        const e = nuevo();
        const dichas = palabras([[0, '3,'], [400, '2,'], [800, '1...']]);
        dichas[2].hasta = T0 + 2400;            // estirada hasta el final de la ventana
        vivo.aplicarSenales(e, dichas, { firmeHastaMs: T0 + 1900, finMs: T0 + 2400 });
        t.eq(e.tomas.length, 1, 'abrió con el «1» empezado antes del límite');
    });

    t.test('pero una señal que EMPIEZA en la cola sigue esperando', () => {
        const e = nuevo();
        const dichas = palabras([[0, 'bueno'], [1400, '3,'], [1800, '2,'], [2200, '1.']]);
        dichas[3].hasta = T0 + 2400;
        vivo.aplicarSenales(e, dichas, { firmeHastaMs: T0 + 1900, finMs: T0 + 2400 });
        t.eq(e.tomas.length, 0, 'el «1» empezó después del límite: a la pasada siguiente');
    });

    t.test('una palabra de la clase estirada SÍ espera, que puede venir cortada', () => {
        // La regla de las señales no vale para las palabras: «funcion» a mitad
        // de «funcionando» también empieza a tiempo, y guardarla sería guardarla
        // mal.
        const e = nuevo();
        const dichas = palabras([[0, 'cómo'], [400, 'está'], [1800, 'funcion']]);
        dichas[2].hasta = T0 + 2400;
        vivo.aplicarSenales(e, dichas, { firmeHastaMs: T0 + 1900, finMs: T0 + 2400 });
        t.deep(e.sueltas.map(w => w.texto), ['cómo', 'está']);
    });

    t.test('"Pausa" y quedarse callado cierra la toma', () => {
        // El mismo estirón, del otro lado: el silencio que tenía que cerrar la
        // toma se lo comía la palabra «pausa», el hueco daba una centésima y la
        // toma seguía abierta. Ahora el hueco se mide desde donde la palabra
        // EMPIEZA, con o sin palabra detrás.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        const dichas = palabras([[5000, 'pausa']]);
        dichas[0].hasta = T0 + 9900;            // estirada por los cinco segundos de silencio
        vivo.aplicarSenales(e, dichas, { firmeHastaMs: T0 + 9400, finMs: T0 + 9900 });
        t.ok(e.tomas[0].outMs != null, 'cerró');
    });

    t.test('y "pausa en el flujo" sigue sin cerrarla', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        vivo.aplicarSenales(e, palabras([[5000, 'pausa'], [5300, 'en'], [5600, 'el']]),
            { firmeHastaMs: T0 + 5300, finMs: T0 + 5900 });
        t.eq(e.tomas[0].outMs, null, 'sigue abierta');
    });

    t.group('notas-vivo · abrir a mano');

    t.test('abre una toma donde se apretó, con el profesor callado', () => {
        const e = nuevo();
        const r = vivo.abrirToma(e, T0 + 5000);
        t.eq(e.tomas.length, 1);
        t.eq(r.toma.inMs, T0 + 5000);
        t.eq(r.retrocedioSec, 0);
    });

    t.test('sin conteo, las palabras quedan sueltas en vez de perderse', () => {
        // Es la mitad del arreglo: antes se descartaban, así que abrir a mano
        // no tenía con qué retroceder.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'Bueno'], [400, 'entonces'], [800, 'vamos']]));
        t.eq(e.tomas.length, 0, 'no se abrió ninguna toma');
        t.deep(e.sueltas.map(w => w.texto), ['Bueno', 'entonces', 'vamos']);
    });

    t.test('abrir tarde retrocede hasta donde arrancó la frase', () => {
        // El caso que hace perder tomas: el profesor arranca sin decir el
        // conteo y quien toma notas se da cuenta unos segundos después.
        //
        // Los 4 s del clic contra el último `hasta` oído (1,9 s) son 2,1 s de
        // atraso, que es menos de lo que el ciclo de señales tarda en traer
        // una palabra: el profesor no paró de hablar (ver `FRESCURA_MAX_SEC`).
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, 'Bueno'], [400, 'entonces'], [800, 'lo'], [1200, 'que'], [1600, 'hacemos']
        ]));
        const r = vivo.abrirToma(e, T0 + 4000);
        t.eq(r.toma.inMs, T0, 'el IN va al arranque de la tirada, no al clic');
        t.eq(r.retrocedioSec, 4);
        t.deep(r.toma.palabras.map(w => w.texto),
            ['Bueno', 'entonces', 'lo', 'que', 'hacemos'], 'y se lleva lo que ya se dijo');
        t.eq(e.sueltas.length, 0, 'que dejan de estar sueltas');
    });

    t.test('no retrocede sobre un silencio largo', () => {
        // Lo que se dijo antes de una pausa de verdad es de otra cosa: el IN
        // arranca en la tirada de ahora y no se lleva la de antes.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([
            [0, 'Algo'], [400, 'viejo'],
            [9000, 'Ahora'], [9400, 'sí'], [9800, 'arranco']
        ]));
        const r = vivo.abrirToma(e, T0 + 10500);
        t.eq(r.toma.inMs, T0 + 9000, 'arranca en la tirada de ahora');
        t.deep(r.toma.palabras.map(w => w.texto), ['Ahora', 'sí', 'arranco']);
    });

    t.test('con el profesor callado hace rato no retrocede nada', () => {
        // Abrir con silencio delante es adelantarse a propósito, y ahí el
        // borde que uno quiere es justo donde apretó.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'algo'], [400, 'viejo']]));
        const r = vivo.abrirToma(e, T0 + 20000);
        t.eq(r.retrocedioSec, 0);
        t.eq(r.toma.palabras.length, 0);
    });

    t.test('el atraso del ciclo de señales no cuenta como silencio', () => {
        // La regresión que esto fija: con el umbral en el hueco entre palabras
        // (1,5 s), el retroceso no se disparaba NUNCA. Lo que la app tiene
        // oído va siempre unos segundos atrás —el ciclo corre cada tres y
        // Whisper tarda más de uno—, así que el profesor puede estar hablando
        // sin parar y la última palabra en memoria ser de hace cuatro.
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'Vamos'], [400, 'a'], [800, 'empezar']]));
        const r = vivo.abrirToma(e, T0 + 1100 + vivo.HUECO_DE_TIRADA_SEC * 1000 + 2000);
        t.ok(r.retrocedioSec > 0, `retrocedió ${r.retrocedioSec} s`);
        t.eq(r.toma.palabras.length, 3);
    });

    t.test('el retroceso tiene tope', () => {
        // Un monólogo de dos minutos sin un solo hueco no manda el IN al
        // principio del monólogo: eso habría que descubrirlo mirando.
        const e = nuevo();
        const largo = [];
        for (let i = 0; i < 300; i++) largo.push([i * 400, `p${i}`]);
        vivo.aplicarSenales(e, palabras(largo));
        const r = vivo.abrirToma(e, T0 + 300 * 400);
        t.ok(r.retrocedioSec <= vivo.RETROCESO_MAX_SEC + 0.5, `${r.retrocedioSec} s`);
    });

    t.test('con una toma ya abierta no abre otra', () => {
        // Dos abiertas a la vez rompen el ciclo de señales.
        const e = nuevo();
        vivo.abrirToma(e, T0 + 1000);
        t.eq(vivo.abrirToma(e, T0 + 2000), null);
        t.eq(e.tomas.length, 1);
    });

    t.test('una toma abierta a mano se cierra con "Pausa" como cualquier otra', () => {
        const e = nuevo();
        vivo.abrirToma(e, T0 + 1000);
        vivo.aplicarSenales(e, palabras([[2000, 'Hola'], [6000, 'Pausa.'], [9000, 'Che']]));
        t.ok(e.tomas[0].outMs != null);
    });

    t.test('el conteo vacía el colchón: lo de antes es de otra cosa', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, 'charla'], [400, 'suelta']]));
        vivo.aplicarSenales(e, palabras([
            [1000, '3,'], [1400, '2,'], [1800, '1.'], [2400, 'Hola']
        ]));
        t.eq(e.sueltas.length, 0);
    });

    t.test('el colchón no crece toda la clase, y se recorta pocas veces', () => {
        // Tres horas sin ninguna toma, de a una pasada por segundo. Recortar de a
        // una palabra por pasada corría el campo de espera en cada segundo; de a
        // cinco minutos lo corre una vez cada cinco minutos.
        const e = nuevo();
        const tope = vivo.VENTANA_DE_SUELTAS_SEC + vivo.MARGEN_DE_SUELTAS_SEC;
        let recortes = 0;
        let primera = null;
        let abarcaMax = 0;
        for (let s = 0; s < 3 * 3600; s++) {
            vivo.aplicarSenales(e, palabras([[s * 1000, `p${s}`], [s * 1000 + 500, `q${s}`]]));
            if (primera != null && e.sueltas[0].t !== primera) recortes++;
            primera = e.sueltas[0].t;
            abarcaMax = Math.max(abarcaMax, (e.sueltas[e.sueltas.length - 1].t - e.sueltas[0].t) / 1000);
        }
        t.ok(abarcaMax <= tope + 1, `el colchón abarca hasta ${abarcaMax} s`);
        t.ok(recortes <= Math.ceil(3 * 3600 / vivo.MARGEN_DE_SUELTAS_SEC),
            `${recortes} recortes en tres horas, no uno por pasada`);
    });

    t.group('notas-vivo · los bordes arrastrados');

    const tirada = () => palabras([
        [0, 'Bueno'], [400, 'entonces'], [800, 'lo'], [1200, 'que'], [1600, 'hacemos']
    ]);
    const textos = ws => ws.map(w => w.texto);

    t.test('el IN soltado en una palabra abre ahí, sin retroceder', () => {
        // Quien arrastró ya eligió la palabra: el retroceso automático al
        // principio de la tirada movería el borde de donde lo puso.
        const e = nuevo();
        vivo.aplicarSenales(e, tirada());
        const r = vivo.abrirToma(e, T0 + 800, { exacto: true, ahoraMs: T0 + 4000 });
        t.eq(r.toma.inMs, T0 + 800);
        t.deep(textos(r.toma.palabras), ['lo', 'que', 'hacemos']);
        t.deep(textos(e.sueltas), ['Bueno', 'entonces'], 'lo de antes sigue suelto, para poder correrlo');
        t.eq(r.retrocedioSec, 3.2, 'y cuánto antes de ahora quedó');
    });

    t.test('el IN de la abierta se corre para atrás sobre lo suelto', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, tirada());
        const { toma } = vivo.abrirToma(e, T0 + 800, { exacto: true });
        t.ok(vivo.moverInAbierta(e, toma, T0 + 400));
        t.eq(toma.inMs, T0 + 400);
        t.deep(textos(toma.palabras), ['entonces', 'lo', 'que', 'hacemos']);
        t.deep(textos(e.sueltas), ['Bueno']);
    });

    t.test('y para adelante, devolviendo lo que deja afuera', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, tirada());
        const { toma } = vivo.abrirToma(e, T0 + 400, { exacto: true });
        vivo.moverInAbierta(e, toma, T0 + 1200);
        t.deep(textos(toma.palabras), ['que', 'hacemos']);
        t.deep(textos(e.sueltas), ['Bueno', 'entonces', 'lo'], 'sin perder ni duplicar ninguna');
    });

    t.test('el IN de una cerrada no se mueve por acá', () => {
        // Esa se relee (`moverBorde` + relectura): su texto ya no está en las sueltas.
        const e = nuevo();
        const { toma } = vivo.abrirToma(e, T0);
        toma.outMs = T0 + 2000;
        t.eq(vivo.moverInAbierta(e, toma, T0 + 400), false);
    });

    t.test('el OUT soltado en una palabra cierra ahí', () => {
        const e = nuevo();
        const { toma } = vivo.abrirToma(e, T0);
        vivo.aplicarSenales(e, tirada());
        t.ok(vivo.cerrarEn(e, toma, T0 + 1200));
        t.eq(toma.outMs, T0 + 1200);
        t.deep(textos(toma.palabras), ['Bueno', 'entonces', 'lo']);
        t.deep(textos(toma.despues), ['que', 'hacemos'], 'lo de después queda de orilla');
        t.deep(textos(e.sueltas), ['que', 'hacemos'], 'y suelto, para la toma siguiente');
    });

    t.test('el OUT no cierra en el IN ni antes', () => {
        const e = nuevo();
        const { toma } = vivo.abrirToma(e, T0 + 800);
        t.eq(vivo.cerrarEn(e, toma, T0 + 800), false);
        t.eq(vivo.cerrarEn(e, toma, T0 + 400), false);
        t.eq(toma.outMs, null);
    });

    t.group('notas-vivo · el final de una toma');

    t.test('finDeToma usa el final de la última palabra', () => {
        const toma = { palabras: [{ t: 100, hasta: 900 }] };
        t.eq(vivo.finDeToma(toma, 5000), 900);
    });

    t.test('sin palabras, termina donde diga quien la cierra', () => {
        t.eq(vivo.finDeToma({ palabras: [] }, 5000), 5000);
    });

    t.group('notas-vivo · qué va al XML');

    t.test('una toma descartada no va', () => {
        const e = nuevo();
        e.tomas = [{ id: 1, inMs: 1, outMs: 2, descartada: true }];
        t.eq(vivo.tomasQueQuedan(e).length, 0);
    });

    t.test('una toma sin cerrar no va', () => {
        const e = nuevo();
        e.tomas = [{ id: 1, inMs: 1, outMs: null }];
        t.eq(vivo.tomasQueQuedan(e).length, 0);
    });

    t.group('notas-vivo · el comentario del marcador');

    t.test('lleva el separador con sus dos espacios aunque no haya nota', () => {
        // Sin él, el parser de post no encuentra dónde termina la nota y el
        // conteo pasa a ser parte del cue.
        const toma = { comentario: '', cuenta: '3, 2, 1.', palabras: [{ texto: 'Hola' }] };
        t.eq(vivo.comentarioDeEntrada(toma), ' - 3, 2, 1. Hola');
    });

    t.test('con nota, la nota va adelante', () => {
        const toma = { comentario: 'La intro', cuenta: '3, 2, 1.', palabras: [{ texto: 'Hola' }] };
        t.eq(vivo.comentarioDeEntrada(toma), 'La intro - 3, 2, 1. Hola');
    });

    t.group('notas-vivo · las repeticiones');

    t.test('dos arranques parecidos se reconocen', () => {
        // Los tres intentos del mismo arranque en una clase real: ninguno
        // empieza igual que otro, y los tres son el mismo.
        const tomas = [
            { id: 1, palabras: 'Quiero que hagas un ejercicio mental piensa en el'.split(' ').map(texto => ({ texto })) },
            { id: 2, palabras: 'Uno quiero que hagas un ejercicio piensa en el prom'.split(' ').map(texto => ({ texto })) }
        ];
        t.eq(vivo.repeticiones(tomas).get(2), 1);
    });

    t.test('dos arranques distintos no', () => {
        const tomas = [
            { id: 1, palabras: 'Quiero que hagas un ejercicio mental piensa en el'.split(' ').map(texto => ({ texto })) },
            { id: 2, palabras: 'Peor aun que sucede si algun desarrollador entra hoy'.split(' ').map(texto => ({ texto })) }
        ];
        t.eq(vivo.repeticiones(tomas).get(2), undefined);
    });
};
