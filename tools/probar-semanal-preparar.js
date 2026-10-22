'use strict';
/**
 * La pantalla de antes de grabar el vídeo de la semana, contra la maqueta.
 *
 * Lo que se comprueba es lo que pidió el editor, medido en píxeles y no
 * mirado: el preview al centro, cámara y pantalla del mismo ancho, micrófono y
 * Profesor Preview también, el nivel del ancho del micrófono, y Grabar un
 * cuadrado rojo de la altura de las dos filas que NO se mueve al elegir
 * pantalla —que era la queja—. A los tres anchos que mide `medir-botones`.
 *
 * Y la pregunta de Grabar sin pantalla: que pregunte, que cancelar no grabe,
 * que «solo con la cámara» grabe y que «Elegir pantalla» elija y no grabe.
 *
 *   node tools/probar-semanal-preparar.js
 */

const { abrir, espera, cerca } = require('./lib/arnes');


/** Las cajas de todo lo que importa, relativas a la tarjeta. */
const medir = p => p.evaluate(() => {
    const raiz = document.querySelector('#vista-semanal');
    const caja = sel => {
        const n = raiz.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left, y: r.top, ancho: r.width, alto: r.height, der: r.right, abajo: r.bottom };
    };
    // Desde el principio del preview, y no desde los controles: lo que no
    // tiene que moverse es Grabar en la pantalla, y lo que lo movía era lo que
    // hay ARRIBA de los controles.
    const tarjeta = caja('.semanal-preview').y;
    const grabar = raiz.querySelector('[data-hace="grabar"]');
    return {
        cuerpo: caja('.semanal-preview'),
        preview: caja('.semanal-preview .semanal-escena'),
        camara: caja('select[data-campo="camara"]'),
        micro: caja('select[data-campo="micro"]'),
        nivel: caja('.semanal-micro .nivel'),
        pantalla: caja('[data-hace="elegir-pantalla"]'),
        profesor: caja('.semanal-verme [data-hace="mirilla"]'),
        grabar: caja('[data-hace="grabar"]'),
        grabarDesdeControles: caja('[data-hace="grabar"]').y - tarjeta,
        rojo: getComputedStyle(grabar).backgroundColor,
        sale: document.documentElement.scrollWidth > window.innerWidth
    };
});

(async () => {
    const { p, ir, decir, terminar } = await abrir(4825);

    for (const ancho of [900, 1180, 1440]) {
        console.log(`\n── A ${ancho} px\n`);
        await p.setViewport({ width: ancho, height: 900 });
        await ir('semanal');
        await espera(400);
        const m = await medir(p);
        const izq = m.preview.x - m.cuerpo.x;
        const der = m.cuerpo.der - m.preview.der;
        decir(cerca(izq, der), `el preview al centro (${Math.round(izq)} y ${Math.round(der)} px a los lados)`);
        decir(cerca(m.camara.ancho, m.pantalla.ancho), `cámara y pantalla del mismo ancho (${Math.round(m.camara.ancho)})`);
        decir(cerca(m.micro.ancho, m.profesor.ancho), `micrófono y Profesor Preview también (${Math.round(m.micro.ancho)})`);
        decir(cerca(m.nivel.ancho, m.micro.ancho) && m.nivel.y > m.micro.abajo,
            'el nivel, del ancho del micrófono y justo debajo');
        decir(cerca(m.grabar.y, m.camara.y) && cerca(m.grabar.abajo, m.pantalla.abajo),
            'Grabar va del borde de arriba de los desplegables al de abajo de los botones');
        decir(cerca(m.grabar.ancho, m.grabar.alto), `y es un cuadrado (${Math.round(m.grabar.ancho)}×${Math.round(m.grabar.alto)})`);
        decir(m.rojo === 'rgb(209, 54, 58)', `rojo (${m.rojo})`);
        decir(!m.sale, 'nada se sale de la ventana');

        await ir('semanal-sin-pantalla');
        await espera(400);
        const sin = await medir(p);
        decir(cerca(sin.grabarDesdeControles, m.grabarDesdeControles) && cerca(sin.grabar.alto, m.grabar.alto),
            'sin pantalla, Grabar está en el mismo sitio y del mismo tamaño: elegirla no lo mueve');
        decir(cerca(sin.preview.alto, m.preview.alto), 'y el preview mide lo mismo con pantalla y sin');
    }

    // Y que entre en la ventana, de alto. Con el preview fijo en 760 px de ancho
    // las instrucciones quedaban afuera aun en el tamaño de fábrica, y en una
    // ventana más baja se iban también los controles: lo vio el editor al
    // abrirla en su computador, y acá se medía solo a 900 de alto.
    console.log('\n── Entra en la ventana, de alto\n');
    for (const [ancho, alto] of [[1180, 840], [1000, 690], [1440, 900]]) {
        await p.setViewport({ width: ancho, height: alto });
        await ir('semanal');
        await espera(400);
        const m = await p.evaluate(() => {
            const raiz = document.querySelector('#vista-semanal');
            const ultima = [...raiz.querySelectorAll('.semanal-campos > .campo')].pop().getBoundingClientRect();
            return { abajo: Math.round(ultima.bottom), alto: innerHeight,
                preview: Math.round(raiz.querySelector('.semanal-preview .semanal-escena').getBoundingClientRect().width) };
        });
        decir(m.abajo <= m.alto, `a ${ancho}×${alto} se ven hasta las instrucciones (terminan en ${m.abajo}, el preview mide ${m.preview})`);
    }

    console.log('\n── Grabar sin pantalla pregunta\n');
    await p.setViewport({ width: 1180, height: 900 });
    const probar = async contesta => {
        await ir('semanal-sin-pantalla');
        await espera(400);
        await p.evaluate(contesta => {
            window.preguntado = null;
            window.empezo = false;
            window.nt.preguntar = async q => { window.preguntado = q; return contesta; };
            const real = window.nt.grabarIniciar;
            window.nt.grabarIniciar = (...a) => { window.empezo = true; return real(...a); };
        }, contesta);
        await p.evaluate(() => document.querySelector('#vista-semanal [data-hace="grabar"]').click());
        await espera(1200);
        return p.evaluate(() => ({
            valores: window.preguntado && window.preguntado.opciones.map(o => o.valor),
            empezo: window.empezo,
            pantalla: (document.querySelector('#vista-semanal [data-hace="elegir-pantalla"]') || {}).textContent
        }));
    };
    const cancela = await probar(null);
    decir(JSON.stringify(cancela.valores) === '["elegir","camara"]', `pregunta (${JSON.stringify(cancela.valores)})`);
    decir(!cancela.empezo, 'cancelar no graba');
    const camara = await probar('camara');
    decir(camara.empezo, '«Grabar solo con la cámara» graba');
    const elegir = await probar('elegir');
    decir(!elegir.empezo && /Cambiar pantalla/.test(elegir.pantalla || ''),
        '«Elegir pantalla» la elige y no arranca: el preview cambia, para mirarlo antes');

    await terminar();
})();
