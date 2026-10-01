'use strict';
/**
 * Un DOM de juguete para probar lo que dibuja el renderer.
 *
 * El runner no tiene ninguno y no vamos a meter una dependencia por esto. Tiene
 * solo lo que el código de `src/js/grabar/` usa de verdad —hermanos, orden,
 * `dataset`, clases y `querySelector` de clase y atributo—, que es justamente lo
 * que se quiere probar: si mañana el transcript se arma con otra estructura, las
 * pruebas se rompen acá en vez de seguir en verde contra una copia vieja.
 *
 * Lo comparten `menu-de-palabra.test.js` y `transcript-que-crece.test.js`
 * porque las dos preguntan por lo MISMO transcript, y dos juguetes distintos
 * acabarían mintiendo cada uno por su lado.
 */

class Nodo {
    constructor(tipo) {
        this.tipo = tipo;
        this.hijos = [];
        // Los `data-*` guardan cadenas, como en el DOM de verdad: sin esto un
        // `dataset.x = 1` se leía como número acá y como '1' en la app, y una
        // prueba con `===` pasaba en un sitio y fallaba en el otro.
        this.dataset = new Proxy({}, {
            set: (o, k, v) => { o[k] = String(v); return true; }
        });
        this.style = {
            propiedades: {},
            setProperty: (k, v) => { this.style.propiedades[k] = String(v); },
            getPropertyValue: k => this.style.propiedades[k] || ''
        };
        this.atributos = {};
        this.clases = new Set();
        this.textoPropio = '';
        this.classList = {
            add: c => this.clases.add(c),
            remove: c => this.clases.delete(c),
            contains: c => this.clases.has(c),
            toggle: (c, si) => (si ? this.clases.add(c) : this.clases.delete(c))
        };
    }
    set className(v) {
        this.clases = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    get className() { return [...this.clases].join(' '); }
    set textContent(v) { this.textoPropio = String(v); this.hijos = []; }
    get textContent() {
        return this.hijos.length ? this.hijos.map(h => h.textContent).join('') : this.textoPropio;
    }
    set innerHTML(v) { this.html = String(v); this.hijos = []; }
    append(...nodos) {
        for (const n of nodos) this.meter(n, this.hijos.length);
    }
    prepend(...nodos) {
        let donde = 0;
        for (const n of nodos) this.meter(n, donde++);
    }
    insertBefore(nodo, antes) {
        const donde = antes ? this.hijos.indexOf(antes) : this.hijos.length;
        this.meter(nodo, donde === -1 ? this.hijos.length : donde);
        return nodo;
    }
    /** Un fragmento se deshace al meterlo, como en el DOM de verdad. */
    meter(nodo, donde) {
        if (nodo.tipo === 'fragmento') {
            const sueltos = nodo.hijos.splice(0);
            for (const h of sueltos) this.meter(h, donde++);
            return;
        }
        nodo.padre = this;
        this.hijos.splice(donde, 0, nodo);
    }
    setAttribute(k, v) { this.atributos[k] = String(v); }
    removeAttribute(k) { delete this.atributos[k]; }
    get children() { return this.hijos.filter(n => n.tipo !== 'texto'); }
    get hermanos() { return this.padre ? this.padre.hijos : [this]; }
    get nextElementSibling() {
        const h = this.hermanos.filter(n => n.tipo !== 'texto');
        return h[h.indexOf(this) + 1] || null;
    }
    /** Solo el bit que se usa: ¿el otro viene DESPUÉS de mí? */
    compareDocumentPosition(otro) {
        const h = this.hermanos;
        return h.indexOf(otro) > h.indexOf(this) ? 4 : 2;
    }
    /** `.una.otra` y `.una[data-x="y"]`, que es todo lo que el código pide. */
    querySelector(sel) {
        return this.todos().find(n => cumple(n, sel)) || null;
    }
    todos() {
        return this.hijos.flatMap(h => [h, ...h.todos()]);
    }
}

function cumple(n, sel) {
    const atrs = [...sel.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
    const clases = sel.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean);
    if (!clases.every(c => n.clases.has(c))) return false;
    return atrs.every(([, k, v]) => {
        const corto = k.startsWith('data-') ? k.slice(5).replace(/-(\w)/g, (_, l) => l.toUpperCase()) : null;
        return (corto && n.dataset[corto] === v) || n.atributos[k] === v;
    });
}

/** Deja `document` y `Node` puestos en el global, como en la ventana. */
function fingir() {
    globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
    globalThis.document = {
        createElement: () => new Nodo('el'),
        createDocumentFragment: () => new Nodo('fragmento'),
        createTextNode: t => {
            const n = new Nodo('texto');
            n.textoPropio = t;
            return n;
        }
    };
}

module.exports = { Nodo, fingir };
