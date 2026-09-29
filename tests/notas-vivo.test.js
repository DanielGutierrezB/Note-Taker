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
