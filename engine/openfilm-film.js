'use strict';
/**
 * openfilm-film.js — Las secuencias de OpenFilm, escritas: `film.html` y `parts/`.
 *
 * Es el mismo armado que el del `.prproj` —una anidación por captura, una por
 * vista compuesta, una precortada por clase y la clase entera al lado— pero en
 * el formato de OpenFilm, que es HTML: cada pista es una `<section>` y cada clip
 * un elemento con su archivo recortado (`#t=in,out`) y su lugar (`at`).
 *
 * **Por qué lo escribe la app y no el agente.** Al principio esto era parte de
 * la guía: «armá una precortada por clase». Pero entonces abrir el proyecto no
 * mostraba nada —hay que pedírselo al agente y esperar— y lo que se arma es
 * justamente lo que la app ya sabe de memoria: dónde cae cada corte. Escribirlo
 * acá es que al abrir ya esté la línea de tiempo cortada, con las anidaciones
 * listas para iterar. Lo que el agente hace después es lo suyo: el ritmo, los
 * títulos, la música.
 *
 * Es puro: recibe los datos de `openfilm-carpeta.js` y devuelve un mapa de
 * `ruta → texto`. No toca el disco, así que se prueba comparando HTML.
 */

const { NOMBRE_DE_LA_GUIA } = require('./openfilm-guia');

/** Milésimas: a lo que OpenFilm redondea los tiempos (§1 de su protocolo). */
const seg = n => Math.round(Number(n) * 1000) / 1000;

/** Lo que va adentro de un atributo, sin romper el HTML. */
const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Un `film.html` con su escenario y sus pistas.
 *
 * El escenario va en el `<meta>` y es 1920×1080, que es a lo que se graban estas
 * clases. Las pistas van **de arriba hacia abajo**: la primera `<section>` es la
 * que tapa, al revés que las pistas de Premiere, donde V1 es la de abajo.
 */
function film(titulo, pistas) {
    return [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=1920, height=1080">',
        '</head>',
        `<body>`,
        `<!-- ${titulo} · lo escribió Note Taker al exportar. Ver ${NOMBRE_DE_LA_GUIA}. -->`,
        ...pistas.flatMap(p => [
            `<section${p.oculta ? ' hidden' : ''}>`,
            ...(p.dice ? [`  <!-- ${p.dice} -->`] : []),
            ...p.clips,
            '</section>'
        ]),
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** Un clip: `<iframe>` si es un film anidado, `<video>` o `<audio>` si es un archivo. */
function clip(tipo, p) {
    const atributos = [
        `id="${esc(p.id)}"`,
        `src="${esc(p.src)}${p.desde != null ? `#t=${seg(p.desde)},${seg(p.hasta)}` : ''}"`,
        `at="${seg(p.at)}"`,
        ...(p.muted ? ['muted'] : []),
        ...(p.disabled ? ['disabled'] : []),
        ...(p.titulo ? [`title="${esc(p.titulo)}"`] : []),
        ...Object.entries(p.datos || {}).map(([k, v]) => `data-${k}="${esc(v)}"`)
    ];
    return `  <${tipo} ${atributos.join(' ')}></${tipo}>`;
}

/** Hacia arriba desde `parts/<algo>/`, que es donde viven todos estos films. */
const desdeParts = ruta => `../../${ruta}`;

/**
 * La anidación de una captura: donde se suelta el vídeo de esa cámara.
 *
 * Arriba, una pista vacía para el vídeo; abajo, el WAV de cada clase en su
 * franja, muteado. Es lo mismo que la anidación del `.prproj`, y por el mismo
 * motivo: se sincroniza una vez acá adentro, contra la onda del audio, y todo lo
 * que la use queda sincronizado.
 *
 * La pista del vídeo va vacía y no con un clip apuntando a un archivo que no
 * existe: un `src` que no resuelve es un error del film, y el proyecto no
 * abriría.
 */
function filmDeCaptura(captura, clases) {
    return film(`${captura.nombre} · las clases en fila, para sincronizar`, [
        {
            dice: `Soltá acá el vídeo de la ${captura.nombre} y alinealo contra el audio de abajo.`
                + ' Una vez: todo lo que use esta captura queda sincronizado.',
            clips: []
        },
        {
            dice: 'El audio que grabó Note Taker, para sincronizar. Va muteado.',
            clips: clases.filter(c => (c.audio || []).length).map(c => clip('audio', {
                id: `audio-${c.corto}`,
                src: desdeParts(c.audio[0].archivo),
                at: c.franja.desdeSeg + c.audio[0].desdeSeg,
                muted: true,
                datos: { clase: c.corto }
            }))
        }
    ]);
}

/**
 * La anidación de una vista compuesta: dos o más capturas apiladas.
 *
 * Cada captura entera, una por pista, de la que tapa hacia abajo. El encuadre va
 * en el `style` de la de arriba y lo pone quien edita, una vez para todo el
 * curso: es exactamente para eso que esta anidación existe.
 */
function filmDeVista(fuente, capturas, largoSeg) {
    const nombre = id => (capturas.find(c => c.id === id) || {}).nombre || `Captura ${id}`;
    const film2 = id => (capturas.find(c => c.id === id) || {}).film;
    return film(`${fuente.vista} · ${fuente.nombre}`, fuente.capturas.slice().reverse().map((id, i) => ({
        dice: i === 0
            ? `${nombre(id)}, la que tapa: su encuadre va en el style de este clip, y vale para todo el curso.`
            : `${nombre(id)}, debajo.`,
        clips: [clip('iframe', {
            id: `captura-${id}`,
            src: desdeParts(film2(id)),
            desde: 0,
            hasta: largoSeg,
            at: 0,
            datos: { captura: id }
        })]
    })));
}

/**
 * La precortada de una clase: un clip por toma, pegados, sin lo que quedó afuera.
 *
 * **Las pistas son las del `.prproj`, y hacen lo mismo.** Una pista «en todas»
 * tiene un clip en cada toma, apagado donde no le toca (`disabled`: ni se ve ni
 * se oye, y su lugar queda), así que cambiar de plano es encender el clip que ya
 * está. Una «solo suya» tiene clips únicamente en las tomas de su vista.
 *
 * Abajo de todo, el audio de cada toma sacado del WAV: es la voz, y es lo único
 * que no sale de una anidación.
 */
function filmDeClase(clase, pistas, fuentes) {
    const filmDe = clave => (fuentes.find(f => f.clave === clave) || {}).film;
    // De arriba hacia abajo: la última pista del plan es la que tapa (como V5
    // en Premiere), así que va primero.
    // **Una pista es de SU vista, y eso es lo que enciende el clip.** No la
    // fuente: dos vistas pueden usar la misma captura —PV y S con la Captura 1—
    // así que mirando la fuente el clip quedaba encendido en las dos pistas a la
    // vez, y la toma de PV se veía también en la de S. Es la misma línea que en
    // el `.prproj` («suya» en `armarPrecortada`).
    const deVideo = pistas.slice().reverse().map((pista, i) => ({
        dice: `${pista.vista} · ${pista.nombre}${pista.siempre ? ' · puesta en todas las tomas' : ` · solo en las tomas de ${pista.vista}`}`,
        clips: clase.tomas
            .filter(t => pista.siempre || t.vista === pista.vista)
            .map(t => clip('iframe', {
                id: `v${pistas.length - i}-toma-${t.toma}`,
                src: desdeParts(filmDe(pista.clave)),
                desde: t.enLaCaptura.desdeSeg,
                hasta: t.enLaCaptura.hastaSeg,
                at: t.enLaPrecortada.desdeSeg,
                disabled: t.vista !== pista.vista,
                titulo: t.nota || '',
                datos: { toma: t.toma, vista: t.vista }
            }))
    }));
    return film(`${clase.titulo} · precortada, ${clase.tomas.length} toma(s)`, [
        ...deVideo,
        {
            dice: 'La voz de la clase, toma por toma, del audio que grabó Note Taker.',
            clips: clase.tomas.filter(t => t.enElAudio).map(t => clip('audio', {
                id: `audio-toma-${t.toma}`,
                src: desdeParts(t.enElAudio.archivo),
                desde: t.enElAudio.desdeSeg,
                hasta: t.enElAudio.hastaSeg,
                at: t.enLaPrecortada.desdeSeg,
                datos: { toma: t.toma }
            }))
        }
    ]);
}

/**
 * La misma clase sin cortar: de punta a punta, con las mismas pistas.
 *
 * Es a donde se vuelve cuando un borde quedó corto o una frase que valía se cayó
 * del corte. Cada pista lleva un solo clip con la clase entera; la encendida es
 * la vista con la que la clase empezó, y las demás quedan apagadas para poder
 * encenderlas ahí mismo.
 */
function filmSinCortar(clase, pistas, fuentes) {
    const filmDe = clave => (fuentes.find(f => f.clave === clave) || {}).film;
    const desde = clase.franja.desdeSeg;
    const hasta = seg(desde + clase.franja.largoSeg);
    const deVideo = pistas.slice().reverse().map((pista, i) => ({
        dice: `${pista.vista} · ${pista.nombre}`,
        clips: [clip('iframe', {
            id: `v${pistas.length - i}-entera`,
            src: desdeParts(filmDe(pista.clave)),
            desde,
            hasta,
            at: 0,
            disabled: pista.vista !== clase.vistaDeLaPre,
            datos: { vista: pista.vista }
        })]
    }));
    return film(`${clase.titulo} · la clase entera, sin cortar`, [
        ...deVideo,
        {
            dice: 'La clase entera, como se grabó.',
            clips: (clase.audio || []).map((a, i) => clip('audio', {
                id: `audio-entera-${i + 1}`,
                src: desdeParts(a.archivo),
                desde: 0,
                hasta: a.segundos,
                at: a.desdeSeg
            }))
        }
    ]);
}

/**
 * El film del curso: las precortadas una detrás de otra, sin aire entre ellas.
 *
 * El aire de cinco minutos vive adentro de las anidaciones, que es donde sirve
 * —separar el material de una clase del de la siguiente mientras se sincroniza—
 * y no acá, donde serían cinco minutos de negro en el corte.
 */
function filmDelCurso(curso, clases) {
    let reloj = 0;
    const clips = [];
    for (const clase of clases) {
        if (!clase.tomas.length) continue;
        clips.push(clip('iframe', {
            id: clase.corto,
            src: clase.film,
            desde: 0,
            hasta: clase.duracionSeg,
            at: reloj,
            datos: { clase: clase.corto }
        }));
        reloj = seg(reloj + clase.duracionSeg);
    }
    return film(`${curso} · las clases precortadas, una detrás de otra`, [
        { dice: 'Cada clase, ya cortada. Entrá a una para iterarla.', clips }
    ]);
}

/**
 * Todos los films del proyecto: `ruta relativa → texto`.
 *
 * @param {object} datos lo mismo que se escribe en `notas-de-rodaje/clases.json`
 * @returns {Object<string, string>}
 */
function films(datos) {
    const d = datos || {};
    const capturas = d.capturas || [];
    const fuentes = d.fuentes || [];
    const pistas = d.pistas || [];
    const salida = {};

    for (const captura of capturas) {
        salida[captura.film] = filmDeCaptura(captura, d.clases || []);
    }
    for (const fuente of fuentes.filter(f => f.capturas.length > 1)) {
        salida[fuente.film] = filmDeVista(fuente, capturas, d.largoSeg || 0);
    }
    for (const clase of d.clases || []) {
        if (clase.tomas.length) salida[clase.film] = filmDeClase(clase, pistas, fuentes);
        if (clase.franja.largoSeg > 0) salida[clase.pre] = filmSinCortar(clase, pistas, fuentes);
    }
    salida['film.html'] = filmDelCurso(d.curso || 'El curso', d.clases || []);
    return salida;
}

module.exports = { films, film, clip, filmDeCaptura, filmDeVista, filmDeClase, filmSinCortar, filmDelCurso };
