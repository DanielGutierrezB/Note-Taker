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

    t.group('el corte del editor · que se oiga donde se ve');

    // El signo es TODO acá, y es lo que estaba mal: el montaje corregía el
    // vídeo que trae el sonido en vez del mudo, o sea movía el audio para
    // perseguir a la imagen. Probar esto sin navegador es la razón de que la
    // cuenta viva en este módulo y no dentro del reproductor.
    t.test('el mudo adelantado se frena y el atrasado se apura', () => {
        const adelante = corte.comoAlcanzar(0.2);
        t.ok(adelante.velocidad < 1, `va delante: hay que frenarlo (${adelante.velocidad})`);
        const detras = corte.comoAlcanzar(-0.2);
        t.ok(detras.velocidad > 1, `va detrás: hay que apurarlo (${detras.velocidad})`);
        t.ok(!adelante.buscar && !detras.buscar, 'y sin buscar, que se vería');
    });

    t.test('juntos no se toca nada', () => {
        for (const error of [0, 0.01, -0.01, corte.JUNTOS_SEC, -corte.JUNTOS_SEC]) {
            const que = corte.comoAlcanzar(error);
            t.eq(que.velocidad, 1, `${error} s`);
            t.eq(que.buscar, false, `${error} s, sin buscar`);
        }
    });

    // Lo que se admite tiene que quedar por debajo de lo que se oye, y eso son
    // números de norma y no gusto: EBU R37 pide el sonido entre 60 ms detrás y
    // 20 ms delante. El umbral que había, 250 ms, era el doble del peor de los
    // dos, así que el desfase se quedaba puesto sin que nada lo corrigiera.
    t.test('lo que se deja pasar está por debajo de lo que se nota', () => {
        t.ok(corte.JUNTOS_SEC * 1000 <= 20, `${corte.JUNTOS_SEC * 1000} ms contra los 20 de la EBU`);
        t.eq(corte.comoAlcanzar(0.25).velocidad === 1, false,
            'un cuarto de segundo NO puede darse por bueno');
    });

    // Cuánto tarda en ponerlos juntos, corriendo la cuenta en vez de leyéndola.
    //
    // Los límites son los medidos, no los que me parecían: el estirón es el
    // doble del error, lo que da medio segundo de constante, pero el techo de
    // `ESTIRON_MAX` muerde por encima de 125 ms y a partir de ahí baja en línea
    // recta. Puse «medio segundo siempre» y esta prueba lo desmintió: desde
    // 200 ms son 1,2 s. Lo que importa es que el caso de verdad —los 100 ms que
    // se midieron en el navegador— se cierre por debajo del segundo.
    t.test('los junta en menos de un segundo desde donde pasa de verdad', () => {
        for (const desde of [0.05, 0.1, 0.12]) {
            let error = desde;
            let t_ = 0;
            const paso = 0.06;
            while (Math.abs(error) > corte.JUNTOS_SEC && t_ < 3) {
                error -= (corte.comoAlcanzar(error).velocidad - 1) * -paso;
                t_ += paso;
            }
            t.ok(t_ <= 1, `desde ${desde * 1000} ms tardó ${Math.round(t_ * 1000)} ms`);
        }
    });

    t.test('y desde muy lejos tarda más, porque el estirón tiene techo', () => {
        let error = 0.45;
        let t_ = 0;
        const paso = 0.06;
        while (Math.abs(error) > corte.JUNTOS_SEC && t_ < 5) {
            error -= (corte.comoAlcanzar(error).velocidad - 1) * -paso;
            t_ += paso;
        }
        t.ok(t_ > 1 && t_ < 3, `desde 450 ms tardó ${Math.round(t_ * 1000)} ms`);
    });

    t.test('una diferencia que no se alcanza estirando se busca', () => {
        const lejos = corte.comoAlcanzar(1.2);
        t.eq(lejos.buscar, true, 'buscar');
        t.eq(lejos.velocidad, 1, 'y a velocidad normal, no estirando además');
    });

    t.test('el estirón tiene techo: nada se arregla a cámara rápida', () => {
        for (const error of [0.3, 0.49, -0.3, -0.49]) {
            const v = corte.comoAlcanzar(error).velocidad;
            t.ok(Math.abs(v - 1) <= corte.ESTIRON_MAX + 1e-9,
                `${error} s da ${v.toFixed(3)}`);
        }
    });
};
