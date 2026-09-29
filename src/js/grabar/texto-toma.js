/**
 * texto-toma.js — El texto de una toma, con sus dos bordes que se arrastran.
 *
 * Es el mismo gesto que Class Cut: alrededor de la toma va en gris lo que se
 * dijo antes y después, y entre medio dos líneas —la azul del IN y la roja del
 * OUT— que se agarran y se sueltan en el hueco entre dos palabras. El borde cae
 * en la palabra que queda justo después de la línea.
 *
 * **La línea se mueve EN el texto mientras se arrastra**, no es un fantasma
 * aparte: el renglón se reacomoda solo y lo gris cambia en el acto, así que se
 * ve exactamente qué palabras entran y cuáles quedan afuera antes de soltar.
 *
 * Tres formas, según en qué momento esté la toma:
 *
 *   inactiva   lo que se oye sin ninguna toma abierta, todo en gris, y el IN
 *              esperando al final. Arrastrarlo hasta una palabra ABRE la toma
 *              desde ahí: es el campo de una toma que todavía no empezó.
 *   abierta    lo gris de antes, el IN, lo que va diciendo, y el OUT al final.
 *              Arrastrar el OUT hacia atrás la cierra en esa palabra.
 *   cerrada    las dos orillas y los dos bordes, que se mueven sobre el texto
 *              que quedó guardado.
 */

let arrastre = false;
let alTerminar = () => {};

/**
 * Si hay una línea agarrada en este momento.
 *
 * La pantalla se repinta sola cada tres segundos con lo que manda el motor, y
 * repintar reemplaza el texto entero: la línea que se estaba arrastrando
 * desaparecería de debajo del cursor. Mientras esto diga que sí, la pantalla
 * espera.
 */
export function arrastrando() {
    return arrastre;
}

/** Lo que hay que hacer al soltar, con si el borde cambió de palabra o no. */
export function alSoltarCualquiera(fn) {
    alTerminar = typeof fn === 'function' ? fn : () => {};
}

const BORDES = {
    in: { clase: 'es-in', que: 'Acá empieza la toma' },
    out: { clase: 'es-out', que: 'Acá termina la toma' }
};

function barra(cual, pista) {
    const b = document.createElement('span');
    b.className = `borde ${BORDES[cual].clase}`;
    b.dataset.borde = cual;
    b.title = `${pista || BORDES[cual].que}. Arrastralo para moverlo.`;
    b.setAttribute('aria-label', cual === 'in' ? 'IN de la toma' : 'OUT de la toma');
    b.innerHTML = `<span class="borde-etiqueta">${cual === 'in' ? 'IN' : 'OUT'}</span>`;
    return b;
}

function palabra(w) {
    const s = document.createElement('span');
    s.className = 'palabra';
    s.dataset.t = w.t;
    s.textContent = w.texto;
    return s;
}

/**
 * Gris lo que está fuera de los bordes.
 *
 * Se calcula recorriendo lo dibujado y no con los tiempos, para que valga
 * igual mientras se arrastra: la línea ya se movió en la pantalla pero el motor
 * todavía no sabe nada, y lo que tiene que verse es dónde quedaría.
 */
function marcarOrillas(texto) {
    let fuera = true;
    for (const hijo of texto.children) {
        if (hijo.classList.contains('borde')) {
            fuera = hijo.dataset.borde === 'out';
            continue;
        }
        hijo.classList.toggle('es-orilla', fuera);
    }
}

function palabraDespuesDe(b) {
    let n = b.nextElementSibling;
    while (n && !n.classList.contains('palabra')) n = n.nextElementSibling;
    return n;
}

function palabraBajo(texto, x, y) {
    const donde = document.elementFromPoint(x, y);
    const span = donde && donde.closest('.palabra');
    return span && texto.contains(span) ? span : null;
}

/**
 * Si llevar la línea a esa palabra la pasaría del otro lado de la otra línea.
 *
 * Un OUT antes del IN es una toma de duración negativa: el motor la rechaza al
 * soltar, pero mientras tanto lo gris se dibujaba al revés y no se entendía qué
 * iba a pasar. La línea se frena contra la otra, que es lo que se espera de
 * dos bordes.
 */
function cruzaria(texto, b, span) {
    const otra = texto.querySelector(`.borde:not([data-borde="${b.dataset.borde}"])`);
    if (!otra) return false;
    const antesDeLaOtra = !!(span.compareDocumentPosition(otra) & Node.DOCUMENT_POSITION_FOLLOWING);
    return b.dataset.borde === 'out' ? antesDeLaOtra : !antesDeLaOtra;
}

/**
 * Arrastrar una línea hasta el hueco entre dos palabras.
 *
 * **Los eventos se escuchan en la ventana y no en la línea**: mover la línea
 * de sitio la saca del documento y la vuelve a meter, y eso suelta la captura
 * del puntero. Con `setPointerCapture` el arrastre avanzaba una palabra y se
 * trababa ahí (lo aprendió Class Cut).
 */
function empezar(texto, b, alSoltar) {
    const previa = palabraDespuesDe(b);
    const desde = previa ? previa.dataset.t : null;
    arrastre = true;
    b.classList.add('es-arrastrando');
    texto.classList.add('es-moviendo');

    const mover = e => {
        const span = palabraBajo(texto, e.clientX, e.clientY);
        if (!span || cruzaria(texto, b, span)) return;
        // A qué lado de la palabra: por la mitad, como cualquier cursor de
        // texto. Si ya está de ese lado no se toca, que mover el nodo en cada
        // pixel hace saltar el renglón entero.
        const caja = span.getBoundingClientRect();
        if (e.clientX > caja.left + caja.width / 2) {
            if (b.previousElementSibling === span) return;
            span.after(b);
        } else {
            if (b.nextElementSibling === span) return;
            span.before(b);
        }
        marcarOrillas(texto);
    };

    const soltar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        window.removeEventListener('pointercancel', soltar);
        b.classList.remove('es-arrastrando');
        texto.classList.remove('es-moviendo');
        arrastre = false;

        const despues = palabraDespuesDe(b);
        const paredMs = despues ? despues.dataset.t : null;
        // Soltarla donde estaba no es un cambio, y soltarla al final del todo
        // no dice ninguna palabra: en los dos casos se deja como estaba.
        const cambio = paredMs !== null && paredMs !== desde;
        if (cambio) alSoltar(b.dataset.borde, Number(paredMs));
        alTerminar(cambio);
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
}

/**
 * Arma el texto.
 *
 * @param {object} p
 *   modo      'inactiva' | 'abierta' | 'cerrada'
 *   antes     palabras de antes del IN (en gris)
 *   palabras  las de la toma (en la inactiva, todo lo oído)
 *   despues   las de después del OUT (en gris)
 *   vacio     qué decir si no hay ninguna palabra
 * @param {function(string, number)} [alSoltar] (borde, hora de la palabra); sin
 *   él las líneas se ven pero no se mueven
 */
export function textoDe(p, alSoltar) {
    const texto = document.createElement('div');
    texto.className = `transcript es-${p.modo}${alSoltar ? ' es-movible' : ''}`;
    const poner = w => texto.append(palabra(w), document.createTextNode(' '));
    const conBarra = (cual, pista) => {
        const b = barra(cual, pista);
        if (alSoltar) {
            b.onpointerdown = e => {
                // Sin esto el arrastre selecciona texto.
                e.preventDefault();
                empezar(texto, b, alSoltar);
            };
        }
        texto.append(b, document.createTextNode(' '));
    };

    if (p.modo === 'inactiva') {
        // Todo lo oído es orilla, y el IN espera al final: arrastrarlo hacia
        // atrás es decir "la toma empezaba acá".
        for (const w of p.palabras || []) poner(w);
        conBarra('in', 'Arrastralo hasta la palabra donde empieza la toma');
    } else {
        for (const w of p.antes || []) poner(w);
        conBarra('in');
        for (const w of p.palabras || []) poner(w);
        if (p.modo === 'abierta') {
            conBarra('out', 'Arrastralo hacia atrás para cerrar la toma en esa palabra');
        } else {
            conBarra('out');
            for (const w of p.despues || []) poner(w);
        }
    }

    if (!texto.querySelector('.palabra') && p.vacio) {
        const v = document.createElement('span');
        v.className = 'transcript-vacio';
        v.textContent = p.vacio;
        texto.prepend(v, document.createTextNode(' '));
    }

    marcarOrillas(texto);
    return texto;
}
