/**
 * iconos.js — Los iconos de la app, en SVG de líneas y escritos una sola vez.
 *
 * No son emojis, y no es una cuestión de gusto. Un emoji lo dibuja la fuente
 * del sistema, así que la app se ve distinta en cada máquina, no hereda el
 * color del texto —un micrófono no se puede poner en rojo mientras escucha ni
 * en gris cuando está apagado, que es justo lo que acá hace falta— y su caja
 * tiene su propio alto, así que cualquier fila con uno queda desalineada por
 * dentro.
 *
 * Todos están dibujados en la misma caja de 24×24 y con el mismo grosor de
 * trazo, que es lo que hace que se vean de la misma familia al lado del otro.
 * El color y el tamaño los pone `.hp-ico` en `style.css` con `currentColor`.
 *
 * **Un dibujo por CONCEPTO.** Si dos botones hacen cosas distintas, no
 * comparten icono. La regla se nota sobre todo en la familia de «rehacer»:
 * regenerar una sesión, reintentar una relectura y deshacer un cambio son tres
 * cosas que a 16 px con una flecha en círculo no se distinguen.
 */

const DIBUJOS = {
    /* ── Lo propio de esta app ────────────────────────────────────── */

    // La claqueta: la pizarra con su brazo levantado. Es el icono más usado de
    // la app —está en la tecla, en el botón, en cada fila de la lista— así que
    // tiene que leerse a 16 px: el brazo va separado del cuerpo y en diagonal,
    // que es lo único que la distingue de una tarjeta a ese tamaño.
    claqueta:
        '<path d="M3.4 9.8h17.2v9.1a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8z"/>' +
        '<path d="M3.9 9.8 3.2 6.6l16.9-3.4.7 3.2z"/>' +
        '<path d="m8.6 9.5-.7-3.2M13.3 8.6l-.7-3.2M18 7.6l-.7-3.2"/>',

    // Una toma: el corchete de entrada y el de salida, que es exactamente lo
    // que una toma es en este XML —un IN y un OUT— y no un clip ni un
    // rectángulo.
    toma:
        '<path d="M8.4 4.2H5.6a1.4 1.4 0 0 0-1.4 1.4v12.8a1.4 1.4 0 0 0 1.4 1.4h2.8"/>' +
        '<path d="M15.6 4.2h2.8a1.4 1.4 0 0 1 1.4 1.4v12.8a1.4 1.4 0 0 1-1.4 1.4h-2.8"/>' +
        '<path d="M12 8.6v6.8"/>',

    // El oído: la onda que entra. No es un micrófono a propósito — lo que la
    // app escucha no es un micrófono sino una entrada de audio, que puede ser
    // un dispositivo virtual con el sonido de un Zoom.
    oido:
        '<path d="M4 10.4v3.2M8 7.6v8.8M12 4.6v14.8M16 8.4v7.2M20 11v2"/>',

    microfono:
        '<path d="M12 3.2a2.9 2.9 0 0 1 2.9 2.9v4.8a2.9 2.9 0 0 1-5.8 0V6.1A2.9 2.9 0 0 1 12 3.2z"/>' +
        '<path d="M5.8 10.9a6.2 6.2 0 0 0 12.4 0"/>' +
        '<path d="M12 17.1v3.7"/><path d="M9.2 20.8h5.6"/>',

    reloj:
        '<circle cx="12" cy="12" r="8.4"/><path d="M12 7v5.2l3.4 2"/>',

    carpeta:
        '<path d="M3.4 6.8a1.8 1.8 0 0 1 1.8-1.8h3.6l2 2.4h8a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8z"/>',

    // El XML: la hoja con sus chevrones. Es el archivo que el editor importa,
    // y el `< >` es lo que lo distingue de una hoja cualquiera.
    xml:
        '<path d="M6 3.4h7.2L19 9.2v11.4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1z"/>' +
        '<path d="M13 3.6v5.8h5.6"/>' +
        '<path d="m10.4 13.6-1.8 2 1.8 2M13.6 13.6l1.8 2-1.8 2"/>',

    camara:
        '<rect x="3" y="7.2" width="12.6" height="9.6" rx="2"/>' +
        '<path d="m15.6 11.4 4.4-2.6v6.4l-4.4-2.6z"/>',

    /* ── Las acciones ─────────────────────────────────────────────── */

    // Empezar a grabar: el punto lleno. A trazo se lee como un círculo vacío,
    // que es lo contrario de lo que este botón hace.
    grabar:
        '<circle class="solido" cx="12" cy="12" r="6"/>',

    // Terminar: el cuadrado lleno, por lo mismo.
    terminar:
        '<rect class="solido" x="7" y="7" width="10" height="10" rx="2.2"/>',

    // Abrir y cerrar una toma: la misma raya con la flecha para el otro lado.
    //
    // Es la única pareja de la caja que comparte dibujo a propósito, y es
    // porque son la misma acción con el signo cambiado: poner el borde de una
    // toma donde uno está. La flecha que baja abre, la que sube cierra, y en
    // la pantalla nunca se ven las dos a la vez —hay una toma abierta o no la
    // hay—, así que no hay nada que confundir.
    abrirToma:
        '<path d="M12 3.6v16.8"/><path d="M7.4 15.8 12 20.4l4.6-4.6"/>' +
        '<path d="M4 12h3.4M16.6 12H20"/>',
    cerrarToma:
        '<path d="M12 3.6v16.8"/><path d="M7.4 8.2 12 3.6l4.6 4.6"/>' +
        '<path d="M4 12h3.4M16.6 12H20"/>',

    // Regenerar: el lazo que vuelve al principio. Es «tirar el texto y volver
    // a leerlo», no «reintentar lo que falló».
    regenerar:
        '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.2 4.4v4.4h-4.4"/>',

    deshacer:
        '<path d="M4.4 9.6h9.8a5.2 5.2 0 0 1 0 10.4H8.8"/>' +
        '<path d="m8.2 5.2-3.8 4.4 3.8 4.4"/>',

    rehacer:
        '<path d="M19.6 9.6H9.8a5.2 5.2 0 0 0 0 10.4h5.4"/>' +
        '<path d="m15.8 5.2 3.8 4.4-3.8 4.4"/>',

    // Descartar: la toma sale del XML pero se queda. El ojo tachado dice eso
    // —«esto no se ve»— y no «esto se borra», que es el cesto.
    descartar:
        '<path d="M3.6 12s3.4-6 8.4-6 8.4 6 8.4 6-3.4 6-8.4 6-8.4-6-8.4-6z"/>' +
        '<circle cx="12" cy="12" r="2.6"/><path d="m4.6 4.6 14.8 14.8"/>',

    recuperar:
        '<path d="M3.6 12s3.4-6 8.4-6 8.4 6 8.4 6-3.4 6-8.4 6-8.4-6-8.4-6z"/>' +
        '<circle cx="12" cy="12" r="2.6"/>',

    // Borrar: el cesto, y solo acá. Es la única acción de la app que borra
    // archivos del disco.
    borrar:
        '<path d="M4.8 6.8h14.4"/><path d="M9.2 6.8V4.6h5.6v2.2"/>' +
        '<path d="M6.6 6.8 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.8-13.2"/>' +
        '<path d="M10.4 10.6v6M13.6 10.6v6"/>',

    renombrar:
        '<path d="M4.6 15.4 15.8 4.2a2.2 2.2 0 0 1 3.1 3.1L7.7 18.5l-4 .9z"/>',

    comentar:
        '<path d="M20 13.6a2.6 2.6 0 0 1-2.6 2.6H8.6L4 20V6.4a2.6 2.6 0 0 1 2.6-2.6h10.8A2.6 2.6 0 0 1 20 6.4z"/>',

    ajustes:
        '<circle cx="12" cy="12" r="2.8"/>' +
        '<path d="M19.1 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.7-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.7l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9z"/>',

    diagnostico:
        '<path d="M4 12h3.6l2.2-6 4 12 2.2-6H20"/>',

    finder:
        '<path d="M4.2 6.6a1.8 1.8 0 0 1 1.8-1.8h3.2l1.8 2.2h7a1.8 1.8 0 0 1 1.8 1.8v8.6a1.8 1.8 0 0 1-1.8 1.8H6a1.8 1.8 0 0 1-1.8-1.8z"/>' +
        '<path d="M12 11v5.2M9.6 13.6 12 11l2.4 2.6"/>',

    /* ── Los estados y los avisos ─────────────────────────────────── */

    ok: '<path d="M5.4 12.6 10 17.2l8.6-10"/>',
    atencion: '<path d="M12 4.6 21 20H3z"/><path d="M12 10v4.2M12 17.1v.1"/>',
    error: '<circle cx="12" cy="12" r="8.4"/><path d="m8.8 8.8 6.4 6.4M15.2 8.8l-6.4 6.4"/>',
    // «Todavía no»: el círculo abierto de un pendiente. No es un reloj: un
    // reloj dice «está tardando» y esto dice «falta hacerlo».
    pendiente: '<circle cx="12" cy="12" r="8.4" stroke-dasharray="3 3"/>',

    chevron: '<path d="m9.6 5.8 6.2 6.2-6.2 6.2"/>',
    volver: '<path d="M19.4 12H5"/><path d="m10.6 5.6-5 6.4 5 6.4"/>',
    cerrar: '<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>',
    mas: '<path d="M12 5.2v13.6M5.2 12h13.6"/>'
};

/**
 * El SVG de un icono, listo para pegar.
 *
 * Se devuelve el markup y no un elemento porque el DOM de mentira con el que
 * corren las pruebas de la maqueta no tiene `createElementNS`, y sin él un
 * `createElement('svg')` no crea un SVG sino un elemento HTML desconocido que
 * el navegador no dibuja. Pegado como texto adentro de un `<span>`, el parser
 * de HTML lo resuelve al namespace correcto.
 */
export function icono(nombre) {
    const dibujo = DIBUJOS[nombre];
    if (!dibujo) return '';
    return `<span class="hp-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${dibujo}</svg></span>`;
}

/** Los nombres que hay, para que la maqueta pueda dibujarlos todos juntos. */
export function nombres() {
    return Object.keys(DIBUJOS);
}

export default { icono, nombres };
