/**
 * corte.js — Las decisiones del corte final, en aritmética y sin pantalla.
 *
 * Son las preguntas que el editor se hace todo el tiempo —cuál es la toma que
 * sigue, cuál se está mirando, qué se ve en ella, cuánto dura el vídeo— y
 * ninguna necesita un `<video>` ni un `<button>` para contestarse. Viven acá
 * por dos razones.
 *
 * La primera es que se usan desde los dos lados: `montaje.js` necesita saber
 * cuál es la toma que sigue para saltar sola, y `pantalla-semanal.js` necesita
 * lo mismo para dibujar la línea de tomas. Tenerlas una vez evita que las dos
 * mitades del editor se contesten distinto.
 *
 * La segunda es que así se pueden PROBAR. Mientras estaban metidas entre el
 * DOM, la única forma de comprobarlas era leer el archivo y buscarle el texto
 * con una expresión regular, y eso no prueba nada: invertir
 * `if (!t.descartada) return i` en `if (t.descartada) continue; return i`
 * —el mismo comportamiento, carácter por carácter distinto— rompía la prueba
 * igual que romper el comportamiento de verdad. Una prueba que se pone roja en
 * los dos casos no informa de ninguno.
 *
 * El `plan` que recibe todo esto es lo que contesta `semanal-montaje`: una
 * toma por elemento, en orden, cada una con `{ id, vista, descartada, segundos,
 * fondo }`. Lo arma el motor con el MISMO reparto que el export.
 */

/** Las tomas que van al vídeo: las demás están desactivadas. */
export function lasQueVan(plan) {
    return (plan || []).filter(t => !t.descartada);
}

/**
 * La primera que va al vídeo.
 *
 * Si están todas desactivadas se devuelve la primera de todas, no -1: la
 * pantalla tiene que poder mostrar algo, y lo que se muestra es la primera que
 * hay para que se la pueda volver a activar.
 */
export function primera(plan) {
    const lista = plan || [];
    const i = lista.findIndex(t => !t.descartada);
    return i === -1 ? (lista.length ? 0 : -1) : i;
}

/** Al final de una toma, la siguiente que vaya al vídeo. -1 si no queda ninguna. */
export function laQueSigue(plan, desde) {
    const lista = plan || [];
    for (let i = desde + 1; i < lista.length; i++) {
        if (!lista[i].descartada) return i;
    }
    return -1;
}

/** Lo que va a durar el vídeo: la suma de las tomas que van, en segundos. */
export function elTotal(plan) {
    return lasQueVan(plan).reduce((s, t) => s + t.segundos, 0);
}

/** Cuánto vídeo quedó antes de la toma `i`, para el reloj del montaje. */
export function loMontadoHasta(plan, i) {
    return (plan || []).slice(0, Math.max(0, i))
        .filter(t => !t.descartada)
        .reduce((s, t) => s + t.segundos, 0);
}

/**
 * Lo que esa toma va a mostrar de verdad.
 *
 * No siempre es su vista: una fuente puede no cubrir una toma —la pantalla se
 * dejó de compartir a mitad, la cámara se cayó— y entonces el exportador usa la
 * otra. Acá no se recalcula nada: `fondo` ya es la respuesta, porque el montaje
 * sale del mismo reparto que el export. Antes se adivinaba mirando si había
 * foto de cada fuente, que era una segunda verdad sobre lo mismo.
 */
export function vistaReal(t) {
    if (!t.fondo) return t.vista;
    return t.fondo === 'camara' ? 'PV' : 'R';
}

/**
 * El ancho del trozo de una toma en la línea, en unidades de segundo.
 *
 * La línea es el vídeo a escala, así que el ancho es lo que dura. Con dos
 * correcciones, las dos para que se pueda apretar:
 *
 *   · un piso de 2,5, porque una toma de un segundo salía más finita que el
 *     mínimo clicable y no había forma de darle;
 *   · un techo de 6 para las desactivadas, porque una toma larga que se dejó
 *     fuera se comía la línea entera sin aportar nada al corte.
 */
export const ANCHO_MIN = 2.5;
export const ANCHO_MAX_FUERA = 6;

export function anchoDe(t) {
    return Math.max(ANCHO_MIN, t.descartada ? Math.min(t.segundos, ANCHO_MAX_FUERA) : t.segundos);
}

/**
 * La toma que se está mirando: la elegida, o la primera que vaya al vídeo.
 *
 * Nunca devuelve nada si la lista está vacía, y nunca devuelve una desactivada
 * por defecto: lo que se abre al llegar al editor es el corte, no un descarte.
 */
export function laParada(plan, elegida) {
    const lista = plan || [];
    return lista.find(t => t.id === elegida)
        || lista.find(t => !t.descartada)
        || lista[0]
        || null;
}

/**
 * El plan del motor con el texto de cada toma pegado.
 *
 * Son dos fuentes porque contestan dos cosas: el montaje dice qué se ve y en
 * qué segundo del archivo cae, y la sesión grabada dice qué se dijo. Los bordes
 * los manda la sesión —`inMs`/`outMs`—, que es lo que el arrastre del IN y del
 * OUT escribe; el montaje trae los suyos ya resueltos a segundos de vídeo y
 * pisarían los que la pantalla necesita mover.
 */
export function conElTexto(plan, grabadas) {
    const conTexto = grabadas || [];
    return (plan || []).map(t => {
        const texto = conTexto.find(x => x.id === t.id);
        return texto ? { ...texto, ...t, inMs: texto.inMs, outMs: texto.outMs } : t;
    });
}
