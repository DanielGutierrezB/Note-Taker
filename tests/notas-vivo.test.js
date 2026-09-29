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

    t.group('notas-vivo · la pausa cierra');

    t.test('"Pausa" con silencio detrás cierra la toma', () => {
        const e = nuevo();
        vivo.aplicarSenales(e, palabras([[0, '3,'], [400, '2,'], [800, '1.'], [1600, 'Hola']]));
        const ev = vivo.aplicarSenales(e, palabras([[5000, 'Pausa.'], [9000, 'Che']]));
        t.eq(ev[0].tipo, 'cerrada');
        t.ok(e.tomas[0].outMs != null, 'quedó cerrada');
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

    t.test('el colchón no crece toda la clase', () => {
        const e = nuevo();
        const muchas = [];
        for (let i = 0; i < 2000; i++) muchas.push([i * 400, `p${i}`]);
        vivo.aplicarSenales(e, palabras(muchas));
        const abarca = (e.sueltas[e.sueltas.length - 1].t - e.sueltas[0].t) / 1000;
        t.ok(abarca <= 31, `el colchón abarca ${abarca} s`);
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
