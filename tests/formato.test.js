'use strict';
/**
 * El timecode de la pantalla.
 *
 * Tiene que dar EXACTAMENTE el mismo número que el XML: si la barra redondeara
 * distinto que `notas-xml.aCuadros`, el editor leería un cuadro y el marcador
 * caería en otro, y esa diferencia es imposible de encontrar mirando.
 */

const fs = require('fs');
const path = require('path');
const notasXml = require('../engine/notas-xml');

/**
 * `formato.js` es un módulo de la ventana (ESM). Se importa con `import()`
 * desde acá: no tiene DOM adentro, así que corre en Node tal cual.
 */
async function cargar() {
    const ruta = path.join(__dirname, '..', 'src', 'js', 'formato.js');
    return import(`file://${ruta}`);
}

module.exports = async function (t) {
    const fmt = await cargar();
    const T0 = Date.parse('2026-09-29T10:00:00');

    t.group('formato · el timecode');

    t.test('el cero es 00:00:00:00', () => {
        t.eq(fmt.timecode(0, 30), '00:00:00:00');
    });

    t.test('un segundo a 30', () => {
        t.eq(fmt.timecode(1, 30), '00:00:01:00');
    });

    t.test('una hora y media a 25', () => {
        t.eq(fmt.timecode(5400, 25), '01:30:00:00');
    });

    t.test('a 29.97 el separador es punto y coma (drop-frame)', () => {
        t.ok(fmt.timecode(1, 29.97).includes(';'));
    });

    t.test('a 29.97 el timecode sigue al reloj de pared', () => {
        // Es para lo que existe el drop-frame: a una hora de grabación, el
        // timecode tiene que decir una hora. Sin saltar números diría
        // 00:59:56:12, y el editor sincroniza mirando ese número.
        // La notación SMPTE de drop-frame cambia solo el último separador.
        t.eq(fmt.timecode(3600, 29.97), '01:00:00;00');
    });

    t.test('a 30 clavado no hay drop-frame', () => {
        t.eq(fmt.timecode(3600, 30), '01:00:00:00');
    });

    t.group('formato · el mismo número que el XML');

    t.test('aCuadros da lo mismo que el motor, a cada fps', () => {
        for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
            for (const seg of [0, 1, 12.5, 600, 3600, 10800]) {
                t.eq(fmt.aCuadros(seg, fps), notasXml.aCuadros(T0 + seg * 1000, T0, fps),
                    `${seg} s a ${fps}`);
            }
        }
    });

    t.group('formato · las duraciones');

    t.test('menos de un minuto va en segundos', () => {
        t.eq(fmt.duracion(45), '45 s');
    });

    t.test('menos de una hora va en minutos', () => {
        t.eq(fmt.duracion(125), '2 min 05 s');
    });

    t.test('una clase larga va en horas', () => {
        t.eq(fmt.duracion(10800), '3 h 00 min');
    });
};
