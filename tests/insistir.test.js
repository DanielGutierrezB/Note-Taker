'use strict';
/**
 * Qué hacer cuando Whisper se muere en medio de una clase.
 *
 * Es una política y no un algoritmo, así que lo que se fija acá es que cada
 * causa tenga su reacción y que la cosa TERMINE: los escalones son finitos y
 * cada uno pesa estrictamente menos que el anterior, pero una regla mal escrita
 * podría dar vueltas para siempre con la clase corriendo.
 */

const insistir = require('../engine/insistir');

function muerto(muerte) {
    const err = new Error('whisper-cli se fue');
    if (muerte) err.muerte = muerte;
    return err;
}

module.exports = function (t) {
    t.group('insistir · cómo se murió');

    t.test('una señal se reconoce como señal', () => {
        t.eq(insistir.comoSeMurio(muerto({ como: 'senal', senal: 'SIGKILL' })), 'senal');
    });

    t.test('un código de salida, como código', () => {
        t.eq(insistir.comoSeMurio(muerto({ como: 'codigo', codigo: 3 })), 'codigo');
    });

    t.test('un error que no llegó a correr no dice nada', () => {
        t.eq(insistir.comoSeMurio(muerto(null)), null);
    });

    t.group('insistir · qué hacer');

    t.test('una señal con el modelo bueno se insiste una vez', () => {
        // La hipótesis es concreta y falsable: lo mató la competencia por la
        // memoria y ya pasó.
        const r = insistir.queHacer({ muerte: 'senal', conElBueno: true, yaInsistio: false, hayEscalon: true });
        t.eq(r.que, 'insistir');
        t.ok(r.esperaMs > 0, 'y se espera un ciclo entero');
    });

    t.test('una señal que ya se insistió baja de modelo', () => {
        // Un segundo reintento idéntico no prueba nada nuevo: lo que cambia las
        // probabilidades es bajar los pesos residentes.
        const r = insistir.queHacer({ muerte: 'senal', conElBueno: true, yaInsistio: true, hayEscalon: true });
        t.eq(r.que, 'bajar');
    });

    t.test('un código NO se reintenta con el mismo modelo', () => {
        // Es la respuesta de un programa determinista: repetirlo cuesta una
        // pasada del modelo grande y compra exactamente nada.
        const r = insistir.queHacer({ muerte: 'codigo', conElBueno: true, yaInsistio: false, hayEscalon: true });
        t.eq(r.que, 'bajar');
        t.eq(r.esperaMs, 0, 'y sin esperar: no hay nada que ceda');
    });

    t.test('sin escalón al que bajar, se rinde', () => {
        const r = insistir.queHacer({ muerte: 'codigo', conElBueno: true, yaInsistio: false, hayEscalon: false });
        t.eq(r.que, 'rendirse');
    });

    t.test('si no llegó a correr, se rinde en el acto', () => {
        // Falta el binario o falta el modelo: ningún escalón lo arregla, y tres
        // intentos idénticos son tres pasadas de la fila tiradas.
        const r = insistir.queHacer({ muerte: null, conElBueno: true, hayEscalon: true });
        t.eq(r.que, 'rendirse');
    });

    t.test('ya bajado, un intento por escalón y no más', () => {
        const r = insistir.queHacer({ muerte: 'senal', conElBueno: false, yaInsistio: false, hayEscalon: false });
        t.eq(r.que, 'rendirse');
    });

    t.test('la política termina: bajando siempre se llega a rendirse', () => {
        // Se simula la peor cadena posible, con un escalón menos en cada vuelta.
        let escalones = 5;
        let yaInsistio = false;
        let conElBueno = true;
        let vueltas = 0;
        for (;;) {
            const r = insistir.queHacer({
                muerte: 'senal', conElBueno, yaInsistio, hayEscalon: escalones > 0
            });
            if (r.que === 'rendirse') break;
            if (r.que === 'insistir') yaInsistio = true;
            else { escalones--; conElBueno = false; yaInsistio = false; }
            vueltas++;
            t.ok(vueltas < 20, 'no da vueltas para siempre');
        }
        t.ok(vueltas > 0);
    });

    t.group('insistir · cómo queda marcada la toma');

    t.test('degradada dice con qué se leyó y con qué se quería', () => {
        const m = insistir.degradada({ modelo: 'ggml-small.bin', bueno: 'ggml-large-v3-turbo.bin' });
        t.eq(m.estado, 'degradada');
        t.ok(m.porque.includes('ggml-small.bin'));
        t.ok(m.porque.includes('ggml-large-v3-turbo.bin'), 'sin esto no se compara contra nada');
        t.ok(m.porque.includes('Regenerar'), 'y dice cómo se arregla');
    });

    t.test('sin-leer dice que el texto que se ve no es el bueno', () => {
        const m = insistir.sinLeer({ bueno: 'ggml-large-v3-turbo.bin' });
        t.eq(m.estado, 'sin-leer');
        t.ok(m.porque.includes('descartable'));
        t.ok(m.porque.includes('Regenerar'));
    });
};
