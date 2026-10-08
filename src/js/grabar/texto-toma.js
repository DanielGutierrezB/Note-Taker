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

import * as senales from './senales.js';

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

/**
 * Una palabra.
 *
 * La señal va en un `data-senal` del MISMO span y no en un elemento que lo
 * envuelva: el arrastre del IN y del OUT encuentra la palabra por su caja en
 * pantalla (`palabraBajo`) y mueve la línea entre hermanos (`marcarOrillas`,
 * `malParada`), así que un nodo de más en el medio cambiaría las dos cosas. Un
 * atributo no cambia ninguna.
 */
function palabra(w, comentarios, senal) {
    const s = document.createElement('span');
    s.className = 'palabra';
    s.dataset.t = w.t;
    // Ya es de otra toma: no es un adorno, es lo que dice que ahí el IN no
    // entra. Va en el mismo span por la misma razón que la señal.
    if (w.de) s.dataset.deToma = w.de.id;
    if (w.hasta != null) s.dataset.hasta = w.hasta;
    s.textContent = w.texto;
    // Subrayada si cae en un pedazo comentado: es lo que dice dónde está cada
    // comentario de la lista de abajo.
    if ((comentarios || []).some(c => w.t >= c.desdeMs && w.t <= c.hastaMs)) {
        s.classList.add('es-comentada');
    }
    if (senal) {
        s.dataset.senal = senal.tipo;
        s.title = senales.pistaDe(senal);
    }
    return s;
}

/**
 * La marca de dónde empieza o termina la toma de al lado.
 *
 * Es una pastilla como las de los bordes, pero no se agarra: dice de quién es
 * el texto de ese lado y, sobre todo, es la PARED del borde. `malParada` y
 * `bordesQuePuede` la leen igual que leen el otro borde, así que el arrastre se
 * frena acá solo, sin ninguna cuenta de tiempos: el orden de los hermanos ya
 * sabe de qué lado está cada cosa.
 *
 * Hay una de cada lado y son la misma cosa mirada al revés. A la izquierda
 * frena el IN contra la toma anterior; a la derecha frena el OUT contra la
 * siguiente. `data-lado` es lo que las distingue, porque un borde solo tropieza
 * con la suya: el IN puede pasar por delante de la marca de la derecha sin
 * problema, y al revés.
 *
 * El color de la vista de esa toma es el mismo que el de su bloque en la lista,
 * y no es el único canal: la pastilla dice «Toma 12» con letras, que es lo que
 * se lee si el color no llega (WCAG 1.4.1).
 */
function limiteDe(limite, lado) {
    const l = document.createElement('span');
    l.className = 'transcript-limite';
    l.dataset.limite = limite.toma;
    l.dataset.lado = lado;
    l.title = lado === 'antes'
        ? `Hasta acá es la toma ${limite.toma}, que ya está hecha. `
            + 'El IN no puede entrar ahí: las dos tomas se quedarían con las mismas palabras.'
        : `Desde acá es la toma ${limite.toma}, que ya está hecha. `
            + 'El OUT no puede entrar ahí: las dos tomas se quedarían con las mismas palabras.';
    const dice = document.createElement('span');
    dice.className = 'borde-etiqueta';
    dice.textContent = lado === 'antes'
        ? `fin de la toma ${limite.toma}`
        : `empieza la toma ${limite.toma}`;
    l.append(dice);
    return l;
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
        if (hijo.classList.contains('palabra')) hijo.classList.toggle('es-orilla', fuera);
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
 *
 * **Y ningún borde puede pasar la marca de la toma de al lado.** Es el mismo
 * tipo de tope que el otro borde y se comprueba igual, por orden de hermanos,
 * así que el arrastre se frena solo ahí: la línea se queda en el límite en vez
 * de irse y volver al repintar. La última palabra la tienen el motor
 * (`pisoDelIn` y `techoDelOut` en engine/notas-vivo.js), que no le cree a la
 * ventana.
 *
 * Cada borde tropieza con la marca de SU lado y nada más: el IN con la de la
 * toma anterior, que tiene que quedarle detrás, y el OUT con la de la
 * siguiente, que tiene que quedarle delante.
 */
function malParada(texto, b) {
    const propio = b.dataset.borde === 'in' ? 'antes' : 'despues';
    const limite = texto.querySelector(`.transcript-limite[data-lado="${propio}"]`);
    if (limite) {
        const detras = Boolean(b.compareDocumentPosition(limite) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (propio === 'antes' ? detras : !detras) return true;
    }
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

/**
 * Qué bordes se pueden poner en una palabra, sin arrastrar nada.
 *
 * Es lo que necesita el menú del clic derecho, y vive acá y no en la pantalla
 * porque son las mismas reglas del arrastre y salen del mismo sitio: el orden de
 * los hermanos. Contesta también el `ms` de cada uno, que es el que `soltar`
 * calcularía si la línea se hubiera arrastrado hasta ahí, así que las dos
 * maneras de mover un borde le piden al motor exactamente lo mismo.
 *
 *   · **El IN va DELANTE de la palabra** y ella queda adentro: su `ms` es el de
 *     la palabra. Alcanza con que esté antes del OUT — una toma de una palabra
 *     sola es legal, es lo que `malParada` deja pasar.
 *   · **El OUT va DETRÁS** y la palabra es la última de la toma: su `ms` es el
 *     de la palabra SIGUIENTE, que es donde apoya la pared. Si no hay
 *     siguiente no se puede: no hay pared, y el arrastre tampoco puede.
 *   · **Poner un borde donde ya está no se ofrece**: no cambiaría nada y
 *     dejaría un paso de deshacer que no deshace nada.
 *   · **Sobre una palabra que ya es de otra toma, su borde no se ofrece.** Es el
 *     mismo tope que frena el arrastre (`malParada`), leído del mismo sitio: si
 *     el menú lo ofreciera, el gesto que la app dibuja como imposible sería
 *     posible por el otro camino. Hacia atrás es el IN contra la toma anterior,
 *     y hacia adelante el OUT contra la siguiente.
 */
export function bordesQuePuede(texto, w) {
    const lineaIn = texto.querySelector('.borde.es-in');
    const lineaOut = texto.querySelector('.borde.es-out');
    const deAntes = texto.querySelector('.transcript-limite[data-lado="antes"]');
    const deDespues = texto.querySelector('.transcript-limite[data-lado="despues"]');
    const antes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const siguiente = palabraDespuesDe(w);
    const puede = [];
    if (deAntes && antes(w, deAntes)) return puede;
    if (deDespues && antes(deDespues, w)) return puede;
    if (lineaIn && (!lineaOut || antes(w, lineaOut)) && palabraDespuesDe(lineaIn) !== w) {
        puede.push({ borde: 'in', ms: Number(w.dataset.t) });
    }
    // La última palabra de antes de la marca SÍ puede llevar el OUT: apoya en
    // la primera de la toma siguiente, o sea que el OUT queda exactamente en su
    // IN. Dos tomas pegadas son legales —`techoDelOut` deja justo eso—, lo que
    // no se puede es entrar.
    if (lineaIn && lineaOut && siguiente && antes(lineaIn, w) &&
        palabraDespuesDe(lineaOut) !== siguiente) {
        puede.push({ borde: 'out', ms: Number(siguiente.dataset.t) });
    }
    return puede;
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
 * @param {Element} [previo] el transcript que ya estaba dibujado ahí. Si lo único
 *   que cambió es que hay palabras nuevas al final, se le agregan y se devuelve
 *   el mismo elemento en vez de uno nuevo (ver `crecer`).
 */
export function textoDe(p, alSoltar, previo) {
    if (previo && crecer(previo, p)) return previo;
    const texto = document.createElement('div');
    texto.className = `transcript es-${p.modo}${alSoltar ? ' es-movible' : ''}`;
    // El color de la vista de la toma de al lado, para su marca y sus palabras.
    // Lo trae hecho la pantalla (`coloresDeVista`): acá no se sabe de colores.
    // Una sola variable porque una sola marca aparece por transcript: la de
    // antes es de la toma abierta y la de después, de una cerrada.
    const ajena = p.limite || p.limiteDespues;
    if (ajena && ajena.color) {
        texto.style.setProperty('--vista-ajena', ajena.color);
        texto.style.setProperty('--tinta-ajena', ajena.tinta);
    }
    // Las señales se buscan sobre la tirada ENTERA y en el orden en que se
    // dibuja, no sobre cada pedazo: el conteo que abrió la toma está en lo gris
    // de antes del IN y la «Pausa» que la cerró en lo gris de después del OUT,
    // y esa «Pausa» se resuelve con la palabra que la sigue, que está del otro
    // lado del borde.
    const enOrden = [...(p.antes || []), ...(p.palabras || []), ...(p.despues || [])];
    const marcas = senales.porPalabra(enOrden);
    let cual = -1;
    const poner = w => {
        cual++;
        texto.append(palabra(w, p.comentarios, marcas.get(cual)), document.createTextNode(' '));
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
        ponerAntes(texto, p, poner);
        conBarra('in');
        for (const w of p.palabras || []) poner(w);
        if (p.modo === 'abierta') {
            conBarra('out', 'Arrastralo hacia atrás para cerrar la toma en esa palabra');
        } else {
            conBarra('out');
            ponerDespues(texto, p, poner);
        }
    }

    if (!texto.querySelector('.palabra') && p.vacio) {
        const v = document.createElement('span');
        v.className = 'transcript-vacio';
        v.textContent = p.vacio;
        texto.prepend(v, document.createTextNode(' '));
    }

    marcarOrillas(texto);
    dibujado.set(texto, huella(p));
    return texto;
}

/**
 * Lo gris de antes del IN, con la marca de dónde termina la toma anterior.
 *
 * La marca va DESPUÉS de la última palabra que es de esa toma, que es donde
 * cambia de dueño el texto. Si no hay ninguna a la vista va igual, pegada al
 * principio: es la pared del IN y tiene que estar aunque lo que protege haya
 * quedado más arriba del recorte.
 */
function ponerAntes(texto, p, poner) {
    const ws = p.antes || [];
    let puesta = false;
    for (let i = 0; i < ws.length; i++) {
        if (p.limite && !puesta && !ws[i].de) {
            texto.append(limiteDe(p.limite, 'antes'), document.createTextNode(' '));
            puesta = true;
        }
        poner(ws[i]);
    }
    if (p.limite && !puesta) texto.append(limiteDe(p.limite, 'antes'), document.createTextNode(' '));
}

/**
 * Lo gris de después del OUT, con la marca de dónde empieza la toma siguiente.
 *
 * El mismo `ponerAntes` del revés: la marca va DELANTE de la primera palabra
 * que ya es de otra toma. Si no hay ninguna a la vista va igual, al final: es
 * la pared del OUT y tiene que estar para que el arrastre se frene, aunque lo
 * que protege haya quedado más abajo del recorte.
 */
function ponerDespues(texto, p, poner) {
    const ws = p.despues || [];
    let puesta = false;
    for (let i = 0; i < ws.length; i++) {
        if (p.limiteDespues && !puesta && ws[i].de) {
            texto.append(limiteDe(p.limiteDespues, 'despues'), document.createTextNode(' '));
            puesta = true;
        }
        poner(ws[i]);
    }
    if (p.limiteDespues && !puesta) {
        texto.append(limiteDe(p.limiteDespues, 'despues'), document.createTextNode(' '));
    }
}

/** Con qué se dibujó cada transcript, para saber si puede crecer. */
const dibujado = new WeakMap();

/**
 * Cuántas palabras del final pueden cambiar de señal cuando entra una nueva.
 *
 * `senales.porPalabra` decide mirando una ventana corta alrededor de cada
 * palabra —una «Pausa» no se sabe si es corta hasta que llega la que sigue, un
 * conteo se lee hacia atrás—, así que al agregar al final solo el final se
 * mueve. De todas formas el repaso recorre todo y solo ESCRIBE donde cambió,
 * que es lo que cuesta; este número solo está para documentar por qué agregar
 * al final no le miente a lo de arriba.
 */
const COLA_DE_SENALES = 16;

function huella(p) {
    return {
        modo: p.modo,
        antes: firma(p.antes),
        limite: p.limite ? `${p.limite.toma}@${p.limite.ms}` : '',
        limiteDespues: p.limiteDespues ? `${p.limiteDespues.toma}@${p.limiteDespues.ms}` : '',
        palabras: (p.palabras || []).map(sello),
        despues: firma(p.despues),
        comentarios: (p.comentarios || []).map(c => `${c.desdeMs}-${c.hastaMs}`).join(',')
    };
}

const sello = w => `${w.t}|${w.texto}${w.de ? `|t${w.de.id}` : ''}`;
const firma = ws => (ws || []).map(sello).join(' ');

/**
 * Le agrega al transcript que ya está en pantalla las palabras nuevas, en vez
 * de rehacerlo.
 *
 * **Esto existe porque el texto ya escrito no puede moverse.** El editor lo
 * pidió así: «el texto en la ventana del transcript va saltando […] debería no
 * moverse en lo posible, para que pueda seleccionar fácilmente mientras se está
 * grabando». Rehacer el div entero cada segundo tiene dos costos que no se ven
 * en una captura: la selección del sistema vive en los nodos, así que al
 * reemplazarlos se borra —no se puede seleccionar una frase y quedarse
 * mirándola—, y el scroll hay que devolverlo a mano (`devolverRollos` en
 * pantalla-vivo.js). Creciendo, los nodos de arriba son LOS MISMOS: no hay nada
 * que devolver y no hay nada que borrar.
 *
 * Solo crece si lo único que cambió es que hay palabras nuevas al final. Todo
 * lo demás —que se haya movido un borde, que el modelo grande haya reescrito
 * una palabra de atrás, que aparezca o desaparezca un comentario— devuelve
 * `false` y el llamador dibuja de nuevo, que es lo correcto: ahí el texto de
 * arriba SÍ cambió y taparlo sería mentir.
 *
 * @returns {boolean} si creció; `false` si hay que dibujar de nuevo
 */
function crecer(previo, p) {
    // A mitad de un arrastre la línea ya se movió en la pantalla y el motor
    // todavía no lo sabe, así que lo dibujado no coincide con `p` a propósito.
    if (agarrado === previo) return false;
    const antes = dibujado.get(previo);
    if (!antes) return false;
    if (antes.modo !== p.modo) return false;
    // La primera palabra de la toma tiene que sacar el «Todavía no se oyó nada
    // de esta toma»; dibujarla de nuevo es más simple y pasa una sola vez.
    if (previo.querySelector('.transcript-vacio')) return false;
    if (antes.antes !== firma(p.antes) || antes.despues !== firma(p.despues)) return false;
    if (antes.limite !== (p.limite ? `${p.limite.toma}@${p.limite.ms}` : '')) return false;
    if (antes.limiteDespues !== (p.limiteDespues ? `${p.limiteDespues.toma}@${p.limiteDespues.ms}` : '')) return false;
    if (antes.comentarios !== (p.comentarios || []).map(c => `${c.desdeMs}-${c.hastaMs}`).join(',')) return false;

    const ahora = (p.palabras || []).map(sello);
    if (ahora.length < antes.palabras.length) return false;
    for (let i = 0; i < antes.palabras.length; i++) {
        if (ahora[i] !== antes.palabras[i]) return false;
    }

    const nuevas = (p.palabras || []).slice(antes.palabras.length);
    const enOrden = [...(p.antes || []), ...(p.palabras || []), ...(p.despues || [])];
    const marcas = senales.porPalabra(enOrden);
    if (nuevas.length) {
        // En la inactiva el IN espera al final y todo lo oído queda antes; en
        // las demás, las palabras de la toma van entre las dos líneas. En los
        // dos casos el sitio es «justo antes de la línea que las cierra», y
        // ponerlas ahí no toca ni un nodo de los de arriba.
        const cierra = previo.querySelector(p.modo === 'inactiva' ? '.borde[data-borde="in"]' : '.borde[data-borde="out"]');
        const trozo = document.createDocumentFragment();
        let cual = (p.antes || []).length + antes.palabras.length - 1;
        for (const w of nuevas) {
            cual++;
            trozo.append(palabra(w, p.comentarios, marcas.get(cual)), document.createTextNode(' '));
        }
        if (cierra) previo.insertBefore(trozo, cierra);
        else previo.append(trozo);
        marcarOrillas(previo);
    }
    repasarSenales(previo, marcas);
    dibujado.set(previo, huella(p));
    return true;
}

/**
 * Pone al día las señales de lo que ya estaba dibujado.
 *
 * Recorre todo pero solo escribe donde la señal cambió de verdad, que en la
 * práctica son las últimas palabras (ver `COLA_DE_SENALES`): tocar el atributo
 * de una palabra de arriba le pediría al navegador recalcular su estilo sin
 * que nada haya cambiado.
 *
 * El índice es el de la palabra entre las palabras, que es el mismo con el que
 * `senales.porPalabra` contesta: las barras y las marcas no cuentan.
 */
function repasarSenales(texto, marcas) {
    let cual = -1;
    for (const hijo of texto.children) {
        if (!hijo.classList.contains('palabra')) continue;
        cual++;
        const marca = marcas.get(cual);
        if ((hijo.dataset.senal || '') === (marca ? marca.tipo : '')) continue;
        if (marca) {
            hijo.dataset.senal = marca.tipo;
            hijo.title = senales.pistaDe(marca);
        } else {
            delete hijo.dataset.senal;
            hijo.removeAttribute('title');
        }
    }
}
