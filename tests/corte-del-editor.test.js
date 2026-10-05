'use strict';
/**
 * Las decisiones del editor del corte final, probadas de verdad.
 *
 * Se importa `src/js/semanal/corte.js` y se le pregunta: cuál es la toma que
 * sigue, cuál se está mirando, cuánto va a durar el vídeo. Es el mismo módulo
 * que corre en la ventana, no una copia de su lógica.
 *
 * Por qué existe este archivo: lo mismo estaba probado leyendo el código como
 * texto y buscándole expresiones regulares, y eso NO prueba nada. Se midió:
 * invertir `if (!t.descartada) return i` en `if (t.descartada) continue;
 * return i` —el mismo comportamiento, exactamente— ponía la prueba roja igual
 * que romper el comportamiento de verdad. Una prueba que falla en los dos casos
 * no distingue ninguno, y encima se cae con cada reformateo.
 *
 * Lo que vive en el DOM —que la línea de tomas se dibuje, que apretar un trozo
 * pare ahí, que el espacio reproduzca— no se prueba acá porque no hay DOM: lo
 * comprueba `tools/probar-editor.js` apretando los botones en un navegador.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');

/** Un plan como el que contesta `semanal-montaje`: `fuera` son las desactivadas. */
function plan(largos, fuera) {
    const sacadas = new Set(fuera || []);
    return largos.map((segundos, i) => ({
        id: i + 1,
        vista: 'R',
        fondo: 'pantalla',
        descartada: sacadas.has(i + 1),
        segundos
    }));
}

module.exports = async t => {
    const corte = await import(
        pathToFileURL(path.join(RAIZ, 'src', 'js', 'semanal', 'corte.js')).href);

    t.group('modo semanal · las decisiones del corte');

    t.test('la reproducción salta las tomas que quedaron fuera', () => {
        const p = plan([7, 3, 9, 5], [2]);
        t.eq(corte.laQueSigue(p, 0), 2, 'de la 1 pasa a la 3, no a la 2');
        t.eq(corte.laQueSigue(p, 2), 3);
        t.eq(corte.laQueSigue(p, 3), -1, 'y al final no queda ninguna');
    });

    t.test('con las últimas desactivadas, no hay siguiente', () => {
        // Si contestara el índice de una desactivada, el montaje la pondría a
        // sonar y lo que se oye dejaría de ser el corte final.
        const p = plan([7, 3, 9, 5], [3, 4]);
        t.eq(corte.laQueSigue(p, 1), -1);
    });

    t.test('se arranca por la primera que va al vídeo', () => {
        t.eq(corte.primera(plan([7, 3, 9], [1])), 1, 'la 1 está fuera: arranca en la 2');
        t.eq(corte.primera(plan([7, 3, 9])), 0);
    });

    t.test('con TODAS desactivadas se muestra la primera igual', () => {
        // No -1: hay que poder ver una para poder volver a activarla. Esto se
        // puede llegar apretando «dejarla fuera» en todas.
        t.eq(corte.primera(plan([7, 3], [1, 2])), 0);
        t.eq(corte.primera([]), -1, 'sin tomas sí no hay nada');
    });

    t.test('lo que va a durar el vídeo es la suma de las que van', () => {
        t.eq(corte.elTotal(plan([7, 3, 9, 5], [2])), 21);
        t.eq(corte.elTotal(plan([7, 3, 9, 5])), 24);
        t.eq(corte.elTotal(plan([7, 3], [1, 2])), 0, 'sin ninguna, cero');
    });

    t.test('el reloj del montaje no cuenta las desactivadas', () => {
        // Es el número que la persona lee mientras elige: tiene que ser el del
        // corte final, no el de los archivos crudos.
        const p = plan([7, 3, 9, 5], [2]);
        t.eq(corte.loMontadoHasta(p, 0), 0);
        t.eq(corte.loMontadoHasta(p, 2), 7, 'la 2 está fuera: después de la 1 van 7 s');
        t.eq(corte.loMontadoHasta(p, 3), 16);
    });

    t.test('la vista que sale es la del fondo, no la que se pidió', () => {
        // Una toma que pidió la pantalla y no la tiene grabada sale con la
        // cámara, y abajo tiene que decir «Yo» y no «Mi pantalla».
        t.eq(corte.vistaReal({ vista: 'R', fondo: 'camara' }), 'PV');
        t.eq(corte.vistaReal({ vista: 'PV', fondo: 'pantalla' }), 'R');
        t.eq(corte.vistaReal({ vista: 'S' }), 'S', 'sin fondo resuelto, la pedida');
    });

    t.test('el trozo de la línea mide lo que dura la toma', () => {
        t.eq(corte.anchoDe({ segundos: 9, descartada: false }), 9);
    });

    t.test('una toma cortita se dibuja con el mínimo que se puede apretar', () => {
        t.eq(corte.anchoDe({ segundos: 1, descartada: false }), corte.ANCHO_MIN);
        t.ok(corte.ANCHO_MIN > 1, 'o no habría forma de darle');
    });

    t.test('una desactivada larga no se come la línea', () => {
        t.eq(corte.anchoDe({ segundos: 90, descartada: true }), corte.ANCHO_MAX_FUERA);
        t.eq(corte.anchoDe({ segundos: 90, descartada: false }), 90, 'pero si va, mide lo suyo');
    });

    t.test('abajo se muestra la toma elegida', () => {
        const p = plan([7, 3, 9]);
        t.eq(corte.laParada(p, 3).id, 3);
    });

    t.test('sin elegir ninguna se muestra la primera que va al vídeo', () => {
        t.eq(corte.laParada(plan([7, 3, 9], [1]), null).id, 2);
    });

    t.test('si la elegida ya no está, se cae a una que sí', () => {
        // Pasa al volver a cortar: el plan nuevo puede no traer una toma que
        // quedó por debajo del mínimo.
        t.eq(corte.laParada(plan([7, 3, 9]), 99).id, 1);
        t.eq(corte.laParada([], 1), null, 'y sin tomas, nada');
    });

    t.test('el texto de cada toma se pega al plan sin pisarle los bordes', () => {
        // Son dos fuentes y el plan manda: trae lo que hay que reproducir, y la
        // toma grabada pone encima lo que el plan no tiene —las palabras—. Donde
        // los dos dicen algo, gana el plan.
        const p = plan([7, 3]);
        const grabadas = [{
            id: 1, inMs: 1000, outMs: 8000, vista: 'PV', palabras: [{ texto: 'hola' }]
        }];
        const [una, dos] = corte.conElTexto(p, grabadas);
        t.eq(una.palabras.length, 1, 'el texto sale de la sesión');
        t.eq(una.inMs, 1000, 'y los bordes también, que el plan no los trae');
        t.eq(una.outMs, 8000);
        t.eq(una.segundos, 7, 'lo que se reproduce es lo del montaje');
        t.eq(una.vista, 'R', 'y donde los dos opinan, gana el montaje');
        t.eq(dos.palabras, undefined, 'una toma sin texto pasa tal cual');
        t.eq(dos.segundos, 3);
    });

    t.test('el plan es el del motor: no se reordena ni se filtra acá', () => {
        // La pantalla dibuja lo que el motor manda, incluidas las desactivadas:
        // sin verlas no se puede deshacer un descarte.
        const p = plan([7, 3, 9, 5], [2]);
        t.eq(corte.conElTexto(p, []).map(x => x.id).join(','), '1,2,3,4');
        t.eq(corte.lasQueVan(p).map(x => x.id).join(','), '1,3,4');
    });
};
