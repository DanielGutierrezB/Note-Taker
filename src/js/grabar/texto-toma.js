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

/** El texto cuya línea está agarrada, o null. */
let agarrado = null;
let alTerminar = () => {};

/**
 * El texto que se está arrastrando, si hay uno.
 *
 * La pantalla se repinta sola cada segundo, y repintar reemplaza los textos
 * enteros: la línea que se arrastra desaparecería de debajo del cursor. La
 * pantalla deja ESTE texto como está y repinta lo demás —antes congelaba todo,
 * y mientras se buscaba dónde cortar se paraban el timecode y el medidor—.
 */
export function arrastrado() {
    return agarrado;
}

/** Compatibilidad: si hay una línea agarrada. */
export function arrastrando() {
    return Boolean(agarrado);
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

function palabra(w, comentarios) {
    const s = document.createElement('span');
    s.className = 'palabra';
    s.dataset.t = w.t;
    if (w.hasta != null) s.dataset.hasta = w.hasta;
    s.textContent = w.texto;
    // Subrayada si cae en un pedazo comentado: es lo que dice dónde está cada
    // comentario de la lista de abajo.
    if ((comentarios || []).some(c => w.t >= c.desdeMs && w.t <= c.hastaMs)) {
        s.classList.add('es-comentada');
    }
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

/**
 * La palabra más cercana al puntero, dentro del texto.
 *
 * `elementFromPoint` solo acierta si el puntero está ENCIMA de una palabra: con
 * el interlineado del texto, la mitad del área —entre renglones, en los
 * espacios— no devolvía nada, la línea se trababa y un movimiento en diagonal
 * se salteaba palabras. Si no acierta, se busca por geometría: el renglón que
 * está a la altura del puntero, y en él la palabra más cercana en x.
 */
function palabraBajo(texto, x, y) {
    const donde = document.elementFromPoint(x, y);
    const span = donde && donde.closest && donde.closest('.palabra');
    if (span && texto.contains(span)) return span;
    let mejor = null;
    let distancia = Infinity;
    for (const w of texto.querySelectorAll('.palabra')) {
        const r = w.getBoundingClientRect();
        if (!r.width) continue;
        const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
        const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
        // El renglón pesa mucho más que la distancia en x: se queda en el
        // renglón del puntero aunque la palabra quede lejos a un costado.
        const d = dy * 1000 + dx;
        if (d < distancia) { distancia = d; mejor = w; }
    }
    return mejor;
}

/**
 * Si la línea quedó mal parada: del otro lado de la otra línea, o pegada a ella
 * sin ninguna palabra en medio.
 *
 * Se mira DESPUÉS de mover y no antes: antes se miraba de qué lado de la otra
 * línea estaba la palabra, y soltar el IN en la mitad derecha de la última
 * palabra antes del OUT lo mandaba más allá del OUT; soltar el OUT pegado al
 * IN dejaba una toma de largo cero. Una toma necesita al menos una palabra.
 */
function malParada(texto, b) {
    const otra = texto.querySelector(`.borde:not([data-borde="${b.dataset.borde}"])`);
    if (!otra) return false;
    const inB = b.dataset.borde === 'in' ? b : otra;
    const outB = b.dataset.borde === 'in' ? otra : b;
    if (!(inB.compareDocumentPosition(outB) & Node.DOCUMENT_POSITION_FOLLOWING)) return true;
    for (let n = inB.nextElementSibling; n && n !== outB; n = n.nextElementSibling) {
        if (n.classList.contains('palabra')) return false;
    }
    return true;
}

/** Cuánto se desplaza el texto por movimiento cuando el puntero está en un borde. */
const PASO_DE_SCROLL = 14;

/**
 * Arrastrar una línea hasta el hueco entre dos palabras.
 *
 * **Los eventos se escuchan en la ventana y no en la línea**: mover la línea
 * de sitio la saca del documento y la vuelve a meter, y eso suelta la captura
 * del puntero. Con `setPointerCapture` el arrastre avanzaba una palabra y se
 * trababa ahí (lo aprendió Class Cut).
 *
 * **Y se cancela en cuanto el botón no está apretado**: un `pointerup` perdido
 * (Cmd-Tab a mitad, un diálogo del sistema) dejaba la línea pegada al mouse y
 * el siguiente clic en cualquier lado guardaba el borde donde hubiera quedado.
 * Cancelar devuelve la línea a su sitio y no guarda nada.
 */
function empezar(texto, b, alSoltar) {
    if (agarrado) return;
    const previa = palabraDespuesDe(b);
    const desde = previa ? previa.dataset.t : null;
    const origen = { padre: b.parentNode, siguiente: b.nextSibling };
    agarrado = texto;
    b.classList.add('es-arrastrando');
    texto.classList.add('es-moviendo');

    const mover = e => {
        if (!(e.buttons & 1)) { cancelar(); return; }
        // Llevado más allá del borde de arriba o de abajo del texto, se
        // desplaza: si no, solo se podía soltar en lo que ya estaba a la vista.
        // Afuera y no «cerca»: en un campo de tres renglones, una zona adentro
        // del borde tapaba el renglón entero y el texto se movía debajo del
        // cursor justo al ir a soltar ahí.
        const caja = texto.getBoundingClientRect();
        if (e.clientY < caja.top) texto.scrollTop -= PASO_DE_SCROLL;
        else if (e.clientY > caja.bottom) texto.scrollTop += PASO_DE_SCROLL;

        const span = palabraBajo(texto, e.clientX, e.clientY);
        if (!span) return;
        const antes = { padre: b.parentNode, siguiente: b.nextSibling };
        // A qué lado de la palabra: por la mitad, como cualquier cursor de
        // texto. Si ya está de ese lado no se toca, que mover el nodo en cada
        // pixel hace saltar el renglón entero.
        const r = span.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2) {
            if (b.previousElementSibling === span) return;
            span.after(b);
        } else {
            if (b.nextElementSibling === span) return;
            span.before(b);
        }
        if (malParada(texto, b)) {
            antes.padre.insertBefore(b, antes.siguiente);
            return;
        }
        marcarOrillas(texto);
    };

    const terminar = () => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        window.removeEventListener('pointercancel', cancelar);
        window.removeEventListener('blur', cancelar);
        b.classList.remove('es-arrastrando');
        texto.classList.remove('es-moviendo');
        agarrado = null;
    };

    function cancelar() {
        terminar();
        origen.padre.insertBefore(b, origen.siguiente);
        marcarOrillas(texto);
        alTerminar(false);
    }

    function soltar() {
        terminar();
        const despues = palabraDespuesDe(b);
        const paredMs = despues ? despues.dataset.t : null;
        // Soltarla donde estaba no es un cambio, y soltarla al final del todo
        // no dice ninguna palabra: en los dos casos se deja como estaba.
        const cambio = paredMs !== null && paredMs !== desde;
        if (cambio) {
            // Hasta que conteste el motor, la línea se ve «guardándose» y el
            // texto no se repinta (ver `enVuelo` en pantalla-vivo.js).
            b.classList.add('es-guardando');
            alSoltar(b.dataset.borde, Number(paredMs), texto);
        } else {
            origen.padre.insertBefore(b, origen.siguiente);
            marcarOrillas(texto);
        }
        alTerminar(cambio);
    }

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', cancelar);
    window.addEventListener('blur', cancelar);
}

/**
 * Arma el texto.
 *
 * @param {object} p
 *   modo      'inactiva' | 'abierta' | 'cerrada'
 *   antes     palabras de antes del IN (en gris)
 *   palabras  las de la toma (en la inactiva, todo lo oído)
 *   despues   las de después del OUT (en gris)
 *   comentarios [{desdeMs, hastaMs}] los pedazos comentados, que se subrayan
 *   vacio     qué decir si no hay ninguna palabra
 * @param {function(string, number)} [alSoltar] (borde, hora de la palabra); sin
 *   él las líneas se ven pero no se mueven
 */
export function textoDe(p, alSoltar) {
    const texto = document.createElement('div');
    texto.className = `transcript es-${p.modo}${alSoltar ? ' es-movible' : ''}`;
    const poner = w => {
        // Lo que se dejó de dibujar en el medio de una toma larga (ver
        // `recortarAbierta` en pantalla-vivo.js).
        if (w.corte) {
            const c = document.createElement('span');
            c.className = 'transcript-corte';
            c.textContent = `… ${w.corte} palabras más …`;
            texto.append(c, document.createTextNode(' '));
            return;
        }
        texto.append(palabra(w, p.comentarios), document.createTextNode(' '));
    };
    const conBarra = (cual, pista) => {
        const b = barra(cual, pista);
        if (alSoltar) {
            b.onpointerdown = e => {
                // Solo el botón principal: un clic derecho o con Ctrl también
                // empezaba a arrastrar.
                if (e.button !== 0 || !e.isPrimary) return;
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
