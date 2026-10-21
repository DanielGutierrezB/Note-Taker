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
        dataset: {},
        partes: {},
        hidden: false,
        style: {},
        title: '',
        textContent: '',
        escrituras: 0,
        oyentes: {},
        get innerHTML() { return html; },
        set innerHTML(v) { html = v; e.escrituras++; },
        setAttribute(k, v) { e.atributos[k] = String(v); },
        removeAttribute(k) { delete e.atributos[k]; },
        getBoundingClientRect: () => caja,
        focus() { mundo.activo = e; },
        contains: otro => otro === e || e.hijos.some(h => h === otro || (h.contains && h.contains(otro))),
        closest: () => null,
        querySelector: sel => e.partes[sel] || null,
        querySelectorAll: () => [],
        addEventListener(tipo, fn) { (e.oyentes[tipo] = e.oyentes[tipo] || []).push(fn); }
    };
    return e;
}

/**
 * Lo que el navegador haría con el HTML de `pintar`: un botón por rótulo, con
 * sus dos textos adentro, puesto en la caja y encontrable por su id.
 */
function armarRotulos(caja, ...ids) {
    return ids.map(id => {
        const b = elemento(id);
        b.partes = { '.rotulo-ancho': elemento(''), '.rotulo-angosto': elemento('') };
        b.hijos.push(b.partes['.rotulo-ancho'], b.partes['.rotulo-angosto']);
        caja.hijos.push(b);
        mundo.porId[id] = b;
        return b;
    });
}

/** Una tecla, con lo que el escucha del menú le hace anotado. */
const tecla = key => ({ key, parada: false, evitada: false,
    stopPropagation() { this.parada = true; }, preventDefault() { this.evitada = true; } });

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

    t.group('rótulos de la barra · el botón es siempre el mismo');

    const IDIOMA_ES = { id: 'r1', hace: 'idioma', que: 'Idioma', icono: 'idioma', dice: 'Auto · ES', corto: 'ES' };

    enElMundo('pedirlos cien veces no rehace los botones', () => {
        // La barra de la clase los pide cada 150 ms. Si cada pedido rehace el
        // botón, el que se apretó ya no es el que se suelta, y el navegador no
        // da el clic por hecho.
        const caja = elemento('caja');
        rb.pintar(caja, [IDIOMA_ES]);
        armarRotulos(caja, 'r1');
        for (let i = 0; i < 100; i++) rb.pintar(caja, [IDIOMA_ES]);
        t.eq(caja.escrituras, 1, 'se escribió una vez, al entrar');
    });

    enElMundo('lo que cambia se pone en el mismo botón, sin rehacerlo', () => {
        // «Auto · ES» que pasa a «Auto · EN» es el mismo botón diciendo otra
        // cosa: un clic que caiga justo en ese momento agarra igual.
        const caja = elemento('caja');
        rb.pintar(caja, [IDIOMA_ES]);
        const [b] = armarRotulos(caja, 'r1');
        rb.pintar(caja, [{ ...IDIOMA_ES, dice: 'EN', corto: 'EN', avisa: true, pista: 'suena a inglés' }]);
        t.eq(caja.escrituras, 1, 'la caja no se volvió a escribir');
        t.eq(b.partes['.rotulo-ancho'].textContent, 'EN', 'el texto largo cambió');
        t.eq(b.partes['.rotulo-angosto'].textContent, 'EN', 'y el corto');
        t.eq(b.atributos['aria-label'], 'Idioma: EN', 'y lo que se lee en voz alta');
        t.eq(b.atributos['data-avisa'], 'si', 'y se puso en ámbar');
        t.eq(b.title, 'suena a inglés');
        rb.pintar(caja, [IDIOMA_ES]);
        t.ok(!('data-avisa' in b.atributos), 'y el ámbar se va cuando deja de hacer falta');
    });

    enElMundo('con el menú abierto se pone al día igual, y sigue apretado', () => {
        const caja = elemento('caja');
        rb.pintar(caja, [IDIOMA_ES]);
        const [b] = armarRotulos(caja, 'r1');
        rb.abrir('r1', [{ valor: 'es', dice: 'Español' }], () => {});
        rb.pintar(caja, [{ ...IDIOMA_ES, dice: 'Auto · EN' }]);
        t.eq(b.partes['.rotulo-ancho'].textContent, 'Auto · EN');
        t.eq(b.atributos['aria-expanded'], 'true', 'el menú sigue colgando de él');
        t.ok(!mundo.menu.hidden);
    });

    enElMundo('cuando cambia cuáles hay se rehacen, y el menú que colgaba se cierra', () => {
        // Una clase que termina se queda sin rótulos: el menú abierto de uno
        // ya no tiene de dónde colgar.
        const caja = elemento('caja');
        rb.pintar(caja, [IDIOMA_ES]);
        armarRotulos(caja, 'r1');
        rb.abrir('r1', [], () => {});
        rb.pintar(caja, []);
        t.eq(caja.escrituras, 2, 'se vació');
        t.eq(caja.innerHTML, '');
        t.ok(mundo.menu.hidden, 'y el menú se cerró');
    });

    enElMundo('la primera vez entra entero: la palabra, el icono y el nombre accesible', () => {
        const caja = elemento('caja');
        rb.pintar(caja, [idiomas.rotulo('vivo-idioma', 'es', 'en')]);
        const html = caja.innerHTML;
        t.ok(/<span class="rotulo-que">Idioma:<\/span/.test(html), 'la palabra');
        t.ok(/class="hp-ico"[\s\S]*<span class="rotulo-que">/.test(html), 'con el icono delante');
        t.ok(/aria-label="Idioma: ES"/.test(html), 'entero en voz alta: a 900 px lo que se ve es corto');
        t.ok(/<span class="rotulo-ancho">ES<\/span/.test(html));
        t.ok(/data-avisa="si"/.test(html), 'y en ámbar si hace falta desde el principio');
    });

    t.group('rótulos de la barra · con el menú abierto el teclado es del menú');

    const conMenu = () => {
        mundo.porId.r1 = elemento('r1');
        rb.abrir('r1', [], () => {});
    };
    const teclear = key => {
        const e = tecla(key);
        (mundo.oyentes.keydown || []).forEach(fn => fn(e));
        return e;
    };

    enElMundo('una letra no llega a la pantalla', () => {
        // En el vídeo semanal, una letra de vista con el menú abierto le
        // cambiaba la vista a una toma que no se estaba mirando.
        conMenu();
        for (const k of ['k', 'p', 'z', 'Enter', ' ']) {
            t.ok(teclear(k).parada, `«${k}» no sigue hasta la pantalla`);
        }
        t.ok(!teclear('Enter').evitada, 'pero Enter sigue apretando la opción con foco');
    });

    enElMundo('Tab es del navegador, y sin menú nada se toca', () => {
        conMenu();
        t.ok(!teclear('Tab').parada);
        rb.cerrar();
        t.ok(!teclear('k').parada, 'cerrado, la K vuelve a ser de la pantalla');
    });

    enElMundo('Escape lo cierra', () => {
        conMenu();
        teclear('Escape');
        t.ok(mundo.menu.hidden);
    });

    enElMundo('las flechas van de una opción a otra, y dan la vuelta', () => {
        const filas = [elemento('a'), elemento('b'), elemento('c')];
        mundo.menu.querySelectorAll = () => filas;
        conMenu();
        mundo.activo = filas[0];
        teclear('ArrowDown');
        t.ok(mundo.activo === filas[1]);
        teclear('ArrowUp');
        teclear('ArrowUp');
        t.ok(mundo.activo === filas[2], 'de la primera para arriba, a la última');
        mundo.menu.querySelectorAll = () => [];
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

    t.test('automático dice qué está oyendo, y sin oír nada todavía dice Auto', () => {
        t.eq(idiomas.rotulo('x', 'auto', 'en').dice, 'Auto · EN');
        t.eq(idiomas.rotulo('x', 'auto', 'en').corto, 'EN', 'angosto, solo lo que suena');
        t.eq(idiomas.rotulo('x', 'auto', 'en').que, 'Idioma', 'y dice de qué es');
        t.eq(idiomas.rotulo('x', 'auto', null).dice, 'Auto');
        t.eq(idiomas.rotulo('x', 'auto', null).corto, 'Auto');
        t.eq(idiomas.rotulo('x', 'pt', 'pt').dice, 'PT', 'puesto a mano dice el puesto');
    });

    t.test('el puesto a mano que no coincide con lo que suena va en ámbar', () => {
        const mal = idiomas.rotulo('x', 'es', 'en');
        t.ok(mal.avisa, 'en español y sonando inglés');
        t.ok(/TRADUCIDO/.test(mal.pista), 'y el tooltip dice lo que está en juego');
        t.ok(!idiomas.rotulo('x', 'auto', 'en').avisa, 'en automático no hay nada que avisar');
        t.ok(!idiomas.rotulo('x', 'es', null).avisa, 'ni sin haber oído nada');
        t.ok(!idiomas.rotulo('x', 'es', 'es').avisa);
    });

    t.group('idioma desde la ventana · pregunta antes de releer');

    enElMundo('sin tomas cerradas no pregunta: no hay nada que elegir', async () => {
        const p = puente();
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', { porReleer: 0 });
        t.eq(p.anotado.preguntas.length, 0, 'un diálogo de más en medio de una clase estorba');
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: false }]);
        t.eq(r.aviso, 'Sigue en inglés.');
    });

    enElMundo('con tomas para releer pregunta, con el número que dice el motor', async () => {
        const p = puente({ contesta: 'desde-aca' });
        window.nt = p.nt;
        await idiomas.cambiar('en', { porReleer: 2 });
        const preg = p.anotado.preguntas[0];
        t.ok(/Hay 2 tomas ya cerradas/.test(preg.mensaje), 'el del resumen: la ventana no cuenta por su cuenta');
        t.deep(preg.opciones.map(o => o.valor), ['releer', 'desde-aca'],
            'releer o seguir; cancelar lo pone el diálogo');
        t.eq(preg.opciones[0].dice, 'Releer 2 tomas');
    });

    enElMundo('«solo de acá en adelante» cambia el idioma y no relee nada', async () => {
        const p = puente({ contesta: 'desde-aca' });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', { porReleer: 2 });
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: false }]);
        t.ok(r.ok);
        t.eq(r.aviso, 'Sigue en inglés de acá en adelante. Lo de antes queda como está.');
    });

    enElMundo('«releer» relee, y cuenta cuántas porque tarda', async () => {
        const p = puente({ contesta: 'releer' });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', { porReleer: 2 });
        t.deep(p.anotado.pedidos, [{ cual: 'en', releer: true }]);
        t.eq(r.aviso, 'Sigue en inglés. Releyendo 2 tomas ya cerradas.');
        t.deep(r.estado, { idioma: 'en' }, 'y trae el estado que contestó el motor');
    });

    enElMundo('cancelar no cambia nada: ni el idioma ni los ajustes', async () => {
        const p = puente({ contesta: null });
        window.nt = p.nt;
        const r = await idiomas.cambiar('en', { porReleer: 2 });
        t.eq(r, null, 'quien llama no guarda ni avisa');
        t.eq(p.anotado.pedidos.length, 0, 'y al motor no se le pidió nada');
    });

    enElMundo('una sola toma se dice en singular', async () => {
        const p = puente({ contesta: 'releer', motor: () => ({ ok: true, releyendo: 1, estado: {} }) });
        window.nt = p.nt;
        const r = await idiomas.cambiar('pt', { porReleer: 1 });
        t.ok(/Hay 1 toma ya cerrada,/.test(p.anotado.preguntas[0].mensaje));
        t.eq(p.anotado.preguntas[0].opciones[0].dice, 'Releer 1 toma');
        t.eq(r.aviso, 'Sigue en portugués. Releyendo 1 toma ya cerrada.');
    });

    enElMundo('si el motor se niega, se dice por qué', async () => {
        const p = puente({ motor: () => ({ ok: false, error: 'No hay una clase grabando.' }) });
        window.nt = p.nt;
        t.deep(await idiomas.cambiar('en', { porReleer: 0 }), { ok: false, error: 'No hay una clase grabando.' });
        window.nt.grabarIdioma = async () => null;
        t.deep(await idiomas.cambiar('en', { porReleer: 0 }), { ok: false, error: 'No se pudo cambiar el idioma.' },
            'y sin motivo, uno genérico en vez de un «undefined» en la tostada');
    });
};
