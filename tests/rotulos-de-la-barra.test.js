'use strict';
/**
 * Los rótulos de la barra y el cambio de idioma desde la ventana, probados
 * andando y no leyendo el código.
 *
 * Las pruebas que había leían el código con expresiones regulares, y estaban en
 * verde mientras un clic de persona sobre el rótulo agarraba 0 de 15 veces: la
 * barra lo rehacía cada 150 ms en medio del clic, y el menú de cámaras aparecía
 * en la esquina porque se ubicaba contra un botón que ya no estaba. Estas
 * cargan `src/js/grabar/rotulo-barra.js` y `src/js/idiomas.js` de verdad, con un
 * `document` y un `window.nt` de mentira del tamaño justo de lo que usan.
 *
 * Lo que no se puede probar sin navegador —que el clic llegue de verdad con un
 * repintado de por medio— lo mide `tools/probar-rotulos.js`.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const cargar = (...p) => import(pathToFileURL(path.join(RAIZ, 'src', 'js', ...p)).href);

const CERO = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

/** Un elemento con lo que `rotulo-barra.js` le pide, y la cuenta de escrituras. */
function elemento(id, caja = CERO) {
    let html = '';
    const e = {
        id,
        hijos: [],
        atributos: {},
        hidden: false,
        style: {},
        escrituras: 0,
        oyentes: {},
        get innerHTML() { return html; },
        set innerHTML(v) { html = v; e.escrituras++; },
        setAttribute(k, v) { e.atributos[k] = String(v); },
        getBoundingClientRect: () => caja,
        focus() { mundo.activo = e; },
        contains: otro => otro === e || e.hijos.some(h => h === otro || (h.contains && h.contains(otro))),
        closest: () => null,
        querySelector: () => null,
        addEventListener(tipo, fn) { (e.oyentes[tipo] = e.oyentes[tipo] || []).push(fn); }
    };
    return e;
}

/**
 * El documento y la ventana de mentira, que se ponen y se sacan en cada prueba.
 *
 * Al sacarlos se deja lo que había, y no nada: otras suites ponen su propio
 * `document` al registrarse y lo usan después, cuando les toca correr.
 */
const mundo = { porId: {}, oyentes: {}, activo: null, menu: null, antes: null };

function ponerMundo(nt) {
    mundo.porId = {};
    mundo.activo = null;
    mundo.antes = { document: globalThis.document, window: globalThis.window };
    globalThis.document = {
        getElementById: id => mundo.porId[id] || null,
        querySelector: sel => (sel === '#menu-barra' ? mundo.menu : null),
        addEventListener(tipo, fn) { (mundo.oyentes[tipo] = mundo.oyentes[tipo] || []).push(fn); },
        get activeElement() { return mundo.activo; }
    };
    globalThis.window = { innerWidth: 1440, innerHeight: 900, nt: nt || {} };
}

function sacarMundo() {
    globalThis.document = mundo.antes.document;
    globalThis.window = mundo.antes.window;
}

/** Lo que el `document` de verdad haría con un `pointerdown` sobre `objetivo`. */
const apretar = objetivo => (mundo.oyentes.pointerdown || []).forEach(fn => fn({ target: objetivo }));

/** Un `window.nt` que anota lo que le piden y contesta lo que se le diga. */
function puente({ contesta = null, motor = r => ({ ok: true, releyendo: r.releer ? 2 : 0, estado: { idioma: r.cual } }) } = {}) {
    const anotado = { preguntas: [], pedidos: [] };
    return {
        anotado,
        nt: {
            preguntar: async p => { anotado.preguntas.push(p); return contesta; },
            grabarIdioma: async (cual, o) => { anotado.pedidos.push({ cual, ...o }); return motor({ cual, ...o }); }
        }
    };
}

/** Dos cerradas que cuentan, una cerrada descartada y una abierta. */
const TOMAS = [
    { id: 1, inMs: 0, outMs: 1000 },
    { id: 2, inMs: 2000, outMs: 3000 },
    { id: 3, inMs: 4000, outMs: 5000, descartada: true },
    { id: 4, inMs: 6000, outMs: null }
];

module.exports = async function (t) {
    const rb = await cargar('grabar', 'rotulo-barra.js');
    const idiomas = await cargar('idiomas.js');

    // `conectar` se llama una vez al arrancar la app, y pone sus escuchas en el
    // documento: acá también una vez, y las escuchas quedan en `mundo`.
    mundo.menu = elemento('menu-barra');
    ponerMundo();
    rb.conectar();
    sacarMundo();

    /** Cada prueba con su mundo limpio, y sin menú abierto al salir. */
    const enElMundo = (nombre, fn, nt) => t.test(nombre, async () => {
        ponerMundo(nt);
        mundo.menu.hidden = true;
        try { await fn(); } finally { rb.cerrar(); sacarMundo(); }
    });

    t.group('rótulos de la barra · no se rehacen en medio del clic');

    enElMundo('lo mismo dos veces no toca la caja', () => {
        // La barra de la clase pide los rótulos cada 150 ms. Si cada pedido
        // rehace el botón, el que se apretó ya no es el que se suelta, y el
        // navegador no da el clic por hecho.
        const caja = elemento('caja');
        for (let i = 0; i < 5; i++) rb.pintar(caja, '<b>ES</b>');
        t.eq(caja.escrituras, 1, 'cinco vueltas iguales, una sola escritura');
        rb.pintar(caja, '<b>EN</b>');
        t.eq(caja.escrituras, 2, 'y lo que cambió sí entra');
    });

    enElMundo('con su menú abierto no la toca aunque cambie, y lo pendiente entra al cerrar', () => {
        const caja = elemento('caja');
        const rotulo = elemento('r1');
        caja.hijos.push(rotulo);
        mundo.porId.r1 = rotulo;
        rb.pintar(caja, 'antes');
        rb.abrir('r1', [{ valor: 'es', dice: 'Español' }], () => {});
        t.ok(!mundo.menu.hidden, 'el menú está abierto');
        rb.pintar(caja, 'después');
        t.eq(caja.innerHTML, 'antes', 'el rótulo del que cuelga sigue siendo el mismo');
        rb.cerrar();
        rb.pintar(caja, 'después');
        t.eq(caja.innerHTML, 'después', 'y al cerrar entra lo que cambió');
    });

    enElMundo('el menú abierto de otra caja no frena esta', () => {
        const otra = elemento('otra');
        const suya = elemento('r1');
        otra.hijos.push(suya);
        mundo.porId.r1 = suya;
        rb.abrir('r1', [], () => {});
        const caja = elemento('caja');
        rb.pintar(caja, 'algo');
        t.eq(caja.innerHTML, 'algo');
    });

    t.group('rótulos de la barra · el menú cuelga del rótulo que está ahora');

    enElMundo('se ubica contra el rótulo de la página, no contra el que se apretó', () => {
        // La lista de cámaras se espera antes de abrir, y en esa espera el
        // rótulo se pudo redibujar: ubicarse contra el viejo, que mide cero,
        // dejaba el menú en la esquina de arriba a la izquierda.
        mundo.porId.camara = elemento('camara', { left: 892, top: 70, right: 980, bottom: 94, width: 88, height: 24 });
        rb.abrir('camara', [{ valor: '', dice: 'Ninguna' }], () => {});
        t.eq(mundo.menu.style.left, '892px', 'alineado con el rótulo');
        t.eq(mundo.menu.style.top, '98px', 'y justo debajo');
        t.eq(mundo.porId.camara.atributos['aria-expanded'], 'true', 'que se ve apretado');
    });

    enElMundo('un rótulo que ya no está no abre nada', () => {
        rb.abrir('se-fue', [{ valor: 'x', dice: 'X' }], () => {});
        t.ok(mundo.menu.hidden, 'mejor nada que un menú en la esquina');
    });

    enElMundo('cerrar le devuelve el foco al rótulo que está ahora', () => {
        mundo.porId.r1 = elemento('r1');
        rb.abrir('r1', [], () => {});
        mundo.activo = mundo.menu;
        mundo.menu.contains = x => x === mundo.menu;
        const nuevo = elemento('r1');
        mundo.porId.r1 = nuevo;
        rb.cerrar();
        t.ok(mundo.activo === nuevo, 'y no a uno que ya no está en la página');
        t.eq(nuevo.atributos['aria-expanded'], 'false');
        mundo.menu.contains = () => false;
    });

    t.group('rótulos de la barra · apretarlo es apretarlo, en cualquier parte');

    enElMundo('apretar el rótulo abierto sobre su icono no lo cierra por afuera', () => {
        // El rótulo tiene icono y texto adentro. Comparando el objetivo exacto
        // con el botón, apretar sobre el icono contaba como «afuera»: el menú se
        // cerraba en el `pointerdown` y el clic lo volvía a abrir.
        const rotulo = elemento('r1');
        const icono = elemento('');
        rotulo.hijos.push(icono);
        mundo.porId.r1 = rotulo;
        rb.abrir('r1', [], () => {});
        apretar(icono);
        t.ok(!mundo.menu.hidden, 'sobre el icono sigue abierto, y el clic decide');
        apretar(elemento('lejos'));
        t.ok(mundo.menu.hidden, 'afuera de verdad, se cierra');
    });

    enElMundo('apretar el mismo rótulo otra vez lo cierra', () => {
        mundo.porId.r1 = elemento('r1');
        rb.abrir('r1', [], () => {});
        rb.abrir('r1', [], () => {});
        t.ok(mundo.menu.hidden);
    });

    t.group('rótulos de la barra · cómo se lee');

    t.test('dice de qué es, con la palabra y el icono, y el nombre accesible entero', () => {
        const html = rb.rotulo(idiomas.rotulo('vivo-idioma', 'auto', 'es'));
        t.ok(/<span class="rotulo-que">Idioma:<\/span/.test(html), 'la palabra');
        t.ok(/class="hp-ico"[\s\S]*<span class="rotulo-que">/.test(html), 'con el icono delante');
        t.ok(/aria-label="Idioma: Auto · ES"/.test(html), 'y entero en voz alta: a 900 px lo que se ve es «ES»');
        t.ok(/<span class="rotulo-ancho">Auto · ES<\/span/.test(html));
        t.ok(/<span class="rotulo-angosto">ES<\/span/.test(html), 'angosto, solo lo que suena');
    });

    t.test('automático dice qué está oyendo, y sin oír nada todavía dice Auto', () => {
        t.eq(idiomas.rotulo('x', 'auto', 'en').dice, 'Auto · EN');
        t.eq(idiomas.rotulo('x', 'auto', null).dice, 'Auto');
        t.eq(idiomas.rotulo('x', 'auto', null).corto, 'Auto');
        t.eq(idiomas.rotulo('x', 'pt', 'pt').dice, 'PT', 'puesto a mano dice el puesto');
    });

    t.test('el puesto a mano que no coincide con lo que suena va en ámbar', () => {
        const mal = idiomas.rotulo('x', 'es', 'en');
        t.ok(mal.avisa, 'en español y sonando inglés');
        t.ok(/TRADUCIDO/.test(mal.pista), 'y el tooltip dice lo que está en juego');
        t.ok(/data-avisa="si"/.test(rb.rotulo(mal)), 'que es lo que pinta el CSS');
        t.ok(!idiomas.rotulo('x', 'auto', 'en').avisa, 'en automático no hay nada que avisar');
        t.ok(!idiomas.rotulo('x', 'es', null).avisa, 'ni sin haber oído nada');
        t.ok(!idiomas.rotulo('x', 'es', 'es').avisa);
    });

    t.group('idioma desde la ventana · pregunta antes de releer');

    enElMundo('sin tomas cerradas no pregunta: no hay nada que elegir', async () => {
        const p = puente();
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', [{ id: 1, inMs: 0, outMs: null }]);
        t.eq(p.anotado.preguntas.length, 0, 'un diálogo de más en medio de una clase estorba');
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: false }]);
        t.eq(r.aviso, 'Sigue en inglés.');
    });

    enElMundo('con tomas cerradas pregunta, contando solo las que cuentan', async () => {
        const p = puente({ contesta: 'desde-aca' });
        window.nt = p.nt;
        await idiomas.cambiar('en', TOMAS);
        const preg = p.anotado.preguntas[0];
        t.ok(/Hay 2 tomas ya cerradas/.test(preg.mensaje), 'ni la abierta ni la descartada');
        t.deep(preg.opciones.map(o => o.valor), ['releer', 'desde-aca'],
            'releer o seguir; cancelar lo pone el diálogo');
        t.eq(preg.opciones[0].dice, 'Releer 2 tomas');
    });

    enElMundo('«solo de acá en adelante» cambia el idioma y no relee nada', async () => {
        const p = puente({ contesta: 'desde-aca' });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', TOMAS);
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: false }]);
        t.ok(r.ok);
        t.eq(r.aviso, 'Sigue en inglés de acá en adelante. Lo de antes queda como está.');
    });

    enElMundo('«releer» relee, y cuenta cuántas porque tarda', async () => {
        const p = puente({ contesta: 'releer' });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', TOMAS);
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: true }]);
        t.eq(r.aviso, 'Sigue en inglés. Releyendo 2 tomas ya cerradas.');
        t.deep(r.estado, { idioma: 'en' }, 'y trae el estado que contestó el motor');
    });

    enElMundo('cancelar no cambia nada: ni el idioma ni los ajustes', async () => {
        const p = puente({ contesta: null });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', TOMAS);
        t.eq(r, null, 'quien llama no guarda ni avisa');
        t.eq(p.anotado.pedidos.length, 0, 'y al motor no se le pidió nada');
    });

    enElMundo('una sola toma se dice en singular', async () => {
        const p = puente({ contesta: 'releer', motor: () => ({ ok: true, releyendo: 1, estado: {} }) });
        window.nt = p.nt;
        const r = await idiomas.cambiar('pt', [TOMAS[0]]);
        t.ok(/Hay 1 toma ya cerrada,/.test(p.anotado.preguntas[0].mensaje));
        t.eq(p.anotado.preguntas[0].opciones[0].dice, 'Releer 1 toma');
        t.eq(r.aviso, 'Sigue en portugués. Releyendo 1 toma ya cerrada.');
    });

    enElMundo('si el motor se niega, se dice por qué', async () => {
        const p = puente({ motor: () => ({ ok: false, error: 'No hay una clase grabando.' }) });
        window.nt = p.nt;
        t.deep(await idiomas.cambiar('en', []), { ok: false, error: 'No hay una clase grabando.' });
        window.nt.grabarIdioma = async () => null;
        t.deep(await idiomas.cambiar('en', []), { ok: false, error: 'No se pudo cambiar el idioma.' },
            'y sin motivo, uno genérico en vez de un «undefined» en la tostada');
    });
};
