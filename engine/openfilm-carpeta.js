'use strict';
/**
 * openfilm-carpeta.js — La misma carpeta de clases, lista para OpenFilm.
 *
 * El otro exportador escribe un `.prproj`, que es un archivo cerrado: adentro
 * van las secuencias, los clips y los marcadores, y quien lo abre es Premiere.
 * OpenFilm es lo contrario —un proyecto suyo es una carpeta con un `film.html`
 * que se lee como texto— y lo edita un agente que trabaja al lado de la persona.
 *
 * Así que acá no se escribe el montaje sino **lo que hace falta para armarlo**:
 * el audio de cada clase, lo que se dijo palabra por palabra, las tomas con sus
 * bordes ya en segundos, y un `PRIMER-CORTE.md` que le dice al agente qué armar
 * con eso. El `film.html` lo escribe él, que es su trabajo y donde la persona lo
 * va a corregir; si lo escribiera esta app, el primer cambio que hiciera el
 * agente lo pisaría.
 *
 * **Los cortes son los mismos que van a Premiere.** El plan sale de
 * `prproj-plan.planear`, que ya decide la franja de cada clase, qué fuente le
 * toca a cada toma y dónde cae cada borde. Acá solo se traduce a segundos y a
 * nombres de archivo: las dos salidas cortan igual, que es lo único que no se
 * puede negociar entre dos exportadores de la misma clase.
 */

const fs = require('fs');
const path = require('path');

const vivo = require('./notas-vivo');
const nombreDeSesion = require('./nombre-de-sesion');
const sesionesGrabadas = require('./sesiones-grabadas');
const workspace = require('./workspace');
const vtt = require('./vtt');
const { planear, AIRE_SEG, nombreDeCaptura } = require('./prproj-plan');
const { normalizar, vistasUsadas, vistaDe, gruposDe } = require('./prproj-carpeta-config');
const { guia, NOMBRE_DE_LA_GUIA } = require('./openfilm-guia');

/** La carpeta que se abre en OpenFilm, adentro de la del curso. */
const CARPETA = 'OpenFilm';

/** Y las de adentro, que son las que el `.md` nombra. */
const NOTAS = 'notas-de-rodaje';
const ASSETS = 'assets';
const AUDIO = `${ASSETS}/audio`;

/** Entre clase y clase, el mismo aire que en Premiere: lo pidió el editor. */
const AIRE_SEG_OPENFILM = AIRE_SEG;

/** Milésimas, que es a lo que OpenFilm redondea los tiempos (§1 de su protocolo). */
const seg = n => Math.round(Number(n) * 1000) / 1000;

/** `clase-01`, con el número de la clase si lo tiene. */
function nombreCorto(sesion, i) {
    const n = sesion.numero != null ? Number(sesion.numero) : i + 1;
    const vez = Number(sesion.vez) || 1;
    return `clase-${String(n).padStart(2, '0')}${vez > 1 ? `-v${vez}` : ''}`;
}

/**
 * El WAV de una clase, en la carpeta de OpenFilm.
 *
 * **Enlazado, no copiado.** Una clase de tres horas son 1,2 GB, y el WAV ya está
 * en la carpeta del curso: un enlace duro deja el mismo archivo con dos nombres
 * y no ocupa un byte más. Entre discos distintos no se puede enlazar —el enlace
 * vive en el sistema de archivos, no entre dos— así que ahí se copia, que es lo
 * que OpenFilm necesita: solo lee lo que está adentro del proyecto.
 *
 * @returns {'enlace'|'copia'|'ya-estaba'}
 */
function traerElAudio(origen, destino) {
    if (fs.existsSync(destino)) {
        const mismo = workspace.sameFingerprint(
            workspace.fingerprint(origen), workspace.fingerprint(destino));
        if (mismo) return 'ya-estaba';
        fs.rmSync(destino);
    }
    try {
        fs.linkSync(origen, destino);
        return 'enlace';
    } catch (e) {
        fs.copyFileSync(origen, destino);
        return 'copia';
    }
}

/**
 * Las capturas y las vistas, dichas como las va a leer el agente.
 *
 * Es la misma elección del panel —qué capturas hay, qué capturas componen cada
 * vista, apiladas de abajo hacia arriba, y si van anidadas— traducida a dónde
 * tiene que soltar cada video y qué film arma con cada una.
 */
function lasCapturas(config) {
    const salida = [];
    for (let id = 1; id <= config.capturas; id++) {
        salida.push({
            id,
            nombre: nombreDeCaptura(id),
            material: `${ASSETS}/captura-${id}`,
            film: `parts/captura-${id}/film.html`
        });
    }
    return salida;
}

/** Cada vista con su apilado y su film, si lleva uno propio (va anidada). */
function lasVistas(config, usadas) {
    const salida = [];
    for (const nombre of Object.keys(config.vistas || {})) {
        const v = vistaDe(config, nombre);
        const grupos = gruposDe(v);
        salida.push({
            vista: nombre,
            titulo: (vivo.VISTAS.find(x => x.nombre === nombre) || {}).titulo || nombre,
            usada: usadas.includes(nombre),
            capturas: v.capturas.slice(),
            unidas: v.unidas,
            siempre: v.siempre.slice(),
            // Anidada, la vista tiene su propio film con las capturas apiladas
            // adentro; suelta, cada captura va en su pista de la precortada.
            film: v.unidas && v.capturas.length > 1 ? `parts/vista-${nombre.toLowerCase()}/film.html` : null,
            grupos: grupos.map(ids => ids.slice())
        });
    }
    return salida;
}

/**
 * Las tomas de una clase, con sus bordes en las tres medidas que el agente
 * necesita y que son el centro de todo esto.
 *
 * Son el mismo instante dicho en tres relojes, y cada uno sirve para una cosa:
 *
 *   · `enElAudio`   dónde cae en el WAV de la clase. Es con lo que se buscan
 *                    las palabras y con lo que se recorta el audio limpio.
 *   · `enLaCaptura`  dónde cae en el film de su captura, con la clase ya puesta
 *                    en su franja. Es el `#t=` del clip de la precortada.
 *   · `enLaPrecortada` dónde cae en la precortada de esa clase, con las tomas
 *                    pegadas una detrás de la otra. Es el `at` del clip.
 *
 * Sin las tres, el agente tiene que hacer la cuenta, y es la cuenta donde un
 * error no se ve hasta que alguien mira el corte.
 */
function lasTomas(clase, porId, audios) {
    return clase.cortes.map(corte => {
        const toma = porId.get(corte.toma) || {};
        const largo = seg(corte.hastaSeg - corte.desdeSeg);
        const ref = corte.referencia;
        const audio = ref ? audios.find(a => a.ruta === ref.ruta) : null;
        return {
            toma: corte.toma,
            vista: corte.vista,
            nota: vivo.limpio(toma.comentario) || '',
            fuentes: corte.fuentes.slice(),
            enElAudio: audio ? {
                archivo: audio.archivo,
                desdeSeg: seg(ref.entradaSeg),
                hastaSeg: seg(ref.entradaSeg + ref.largoSeg)
            } : null,
            enLaCaptura: { desdeSeg: seg(corte.entradaSeg), hastaSeg: seg(corte.entradaSeg + largo) },
            enLaPrecortada: { desdeSeg: seg(corte.desdeSeg), hastaSeg: seg(corte.hastaSeg) },
            largoSeg: largo,
            // Lo que se dijo adentro, para que el agente pueda elegir sin abrir
            // el audio. Entero y no recortado: es texto, y es lo que convierte
            // una lista de tiempos en algo sobre lo que se puede decidir.
            dice: (toma.palabras || []).map(w => w.texto).join(' '),
            // Y las notas sobre un pedazo del texto, en los segundos de la
            // precortada, que es donde el agente las va a poner.
            comentarios: (toma.comentarios || [])
                .filter(c => c.desdeMs != null && c.desdeMs >= corte.desdeMs && c.desdeMs < corte.hastaMs)
                .map(c => ({
                    dice: vivo.limpio(c.comentario) || '',
                    desdeSeg: seg(corte.desdeSeg + (c.desdeMs - corte.desdeMs) / 1000)
                }))
        };
    });
}

/**
 * El `film.html` con el que la carpeta ya es un proyecto, si todavía no hay uno.
 *
 * **Vacío a propósito, y escrito una sola vez.** El montaje lo arma el agente
 * (`PRIMER-CORTE.md`), así que acá no va ni una pista: lo único que hace este
 * archivo es que OpenFilm reconozca la carpeta como un proyecto suyo. Sin él
 * pregunta «No film in this folder: ¿empezamos uno?» apenas se abre, que es una
 * pregunta rara cuando la carpeta se acaba de exportar llena de material.
 *
 * Es el mismo que hace `openfilm open` con una carpeta nueva —el `<meta>` del
 * escenario y nada más— con un comentario que dice dónde mirar. En cuanto el
 * agente escriba el suyo, exportar otra vez no lo toca.
 */
function filmDeArranque(destino) {
    if (fs.existsSync(destino)) return false;
    workspace.writeAtomic(destino, [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=1920, height=1080">',
        '</head>',
        '<body>',
        `<!-- Todavía sin montar. Lo que va acá está en ${NOMBRE_DE_LA_GUIA}, en esta misma carpeta:`,
        '     las clases, sus tomas y qué armar con ellas. -->',
        '</body>',
        '</html>',
        ''
    ].join('\n'));
    return true;
}

/** El guion de una clase: lo que se lee antes de tocar nada. */
function guionDeLaClase(clase, fuentes) {
    // Las fuentes se nombran como se leen —«Captura 2 sobre Captura 1»— y no por
    // su clave: la clave es para `clases.json`, que la lee una máquina.
    const comoSeLlama = clave => {
        const f = (fuentes || []).find(x => x.clave === clave);
        return f ? f.nombre : clave;
    };
    const lineas = [
        `# ${clase.titulo}`,
        '',
        `${clase.tomas.length} toma(s) · ${Math.round(clase.duracionSeg / 60)} min cortados `
            + `de ${Math.round(clase.franja.largoSeg / 60)} min grabados.`,
        '',
        `Su precortada va en \`${clase.film}\`, y su clase entera sin cortar en \`${clase.pre}\`.`,
        ''
    ];
    for (const t of clase.tomas) {
        lineas.push(`## Toma ${t.toma} · ${t.vista}${t.nota ? ` · ${t.nota}` : ''}`);
        lineas.push('');
        lineas.push(`En la precortada ${t.enLaPrecortada.desdeSeg} → ${t.enLaPrecortada.hastaSeg} s`
            + ` · en ${t.fuentes.map(comoSeLlama).join(' y ')} ${t.enLaCaptura.desdeSeg} → ${t.enLaCaptura.hastaSeg} s`
            + (t.enElAudio ? ` · en el audio ${t.enElAudio.desdeSeg} → ${t.enElAudio.hastaSeg} s` : ''));
        lineas.push('');
        if (t.dice) {
            lineas.push(`> ${t.dice}`);
            lineas.push('');
        }
        for (const c of t.comentarios) {
            lineas.push(`- Nota en ${c.desdeSeg} s: ${c.dice}`);
        }
        if (t.comentarios.length) lineas.push('');
    }
    return lineas.join('\n');
}

/**
 * Arma `<carpeta>/OpenFilm/`.
 *
 * **Lo que escribe el agente no se toca.** Exportar otra vez rehace la guía, las
 * notas y los audios, y nada más: `film.html`, `parts/` y lo que la persona haya
 * puesto en `assets/` siguen como estaban. Es la misma razón por la que el
 * `.prproj` pregunta antes de pisarse, resuelta de otra manera: acá lo que se
 * reescribe son datos, no montaje, y el montaje vive en archivos distintos.
 *
 * @param {object} opciones { carpeta, config, enCurso, avisar }
 * @returns {Promise<{ok, ruta, guia, clases, tomas, avisos, cuenta, error}>}
 */
async function exportar(opciones) {
    const op = opciones || {};
    const vacio = { ok: false, ruta: null, guia: null, clases: 0, tomas: 0, avisos: [], cuenta: [], error: null };
    const decir = (hecho, total, que) => {
        try { if (typeof op.avisar === 'function') op.avisar({ hecho, total, que }); } catch (e) { /* contar no es el trabajo */ }
    };
    const ceder = () => new Promise(r => setImmediate(r));

    if (!op.carpeta || !fs.existsSync(op.carpeta)) return { ...vacio, error: 'Esa carpeta no está.' };
    const sesiones = sesionesGrabadas.listar([op.carpeta], op.enCurso);
    if (!sesiones.length) return { ...vacio, error: 'Esta carpeta no tiene ninguna clase grabada todavía.' };

    const usadas = vistasUsadas(sesiones);
    const config = normalizar(op.config, usadas);

    // Los cortes se ajustan contra la onda antes de planear, por lo mismo que en
    // Premiere: el sidecar puede traer el ajuste de una versión anterior de esa
    // cuenta, y las dos salidas de la misma clase tienen que cortar igual.
    decir(0, sesiones.length, 'Mirando la onda de cada clase…');
    for (const s of sesiones) {
        if (!s.archivos || !s.archivos.json) continue;
        sesionesGrabadas.ajustarBordes(s, workspace.sesionDelSidecar(s.archivos.json));
        await ceder();
    }

    const plan = planear(sesiones, config);
    const avisos = plan.avisos.slice();
    const raiz = path.join(op.carpeta, CARPETA);

    try {
        workspace.ensureDir(path.join(raiz, NOTAS));
        workspace.ensureDir(path.join(raiz, AUDIO));
        for (const captura of lasCapturas(config)) workspace.ensureDir(path.join(raiz, captura.material));

        const clases = [];
        for (const [i, clase] of plan.clases.entries()) {
            decir(i, plan.clases.length, `Llevando ${clase.nombre}…`);
            const corto = nombreCorto(clase.sesion, i);

            // El audio de la clase, y lo que se dijo en él. Un WAV que no está
            // se salta con su aviso: el plan ya lo dijo, y la clase entra igual.
            const audios = [];
            for (const w of clase.wavs) {
                const nombre = path.basename(w.ruta);
                const destino = path.join(raiz, AUDIO, nombre);
                const como = traerElAudio(w.ruta, destino);
                if (como === 'copia') {
                    avisos.push(`${clase.nombre}: su audio está en otro disco, así que se copió `
                        + `(${Math.round(w.segundos / 60)} min).`);
                }
                const palabras = vtt.deLaSesion(clase.sesion, w);
                const vttNombre = nombre.replace(/\.wav$/i, '.vtt');
                if (palabras) workspace.writeAtomic(path.join(raiz, AUDIO, vttNombre), palabras);
                audios.push({
                    ruta: w.ruta,
                    archivo: `${AUDIO}/${nombre}`,
                    palabras: palabras ? `${AUDIO}/${vttNombre}` : null,
                    desdeSeg: seg((w.desdeMs - clase.sesion.ceroMs) / 1000),
                    segundos: seg(w.segundos)
                });
                await ceder();
            }

            const porId = new Map(vivo.tomasQueQuedan(clase.sesion).map(t => [t.id, t]));
            clases.push({
                numero: clase.sesion.numero != null ? Number(clase.sesion.numero) : i + 1,
                vez: Number(clase.sesion.vez) || 1,
                nombre: clase.nombre,
                titulo: nombreDeSesion.sinFecha(clase.nombre),
                corto,
                film: `parts/${corto}/film.html`,
                pre: `parts/${corto}-sin-cortar/film.html`,
                franja: { desdeSeg: seg(clase.franja.desdeSeg), largoSeg: seg(clase.franja.largoSeg) },
                duracionSeg: seg(clase.duracionSeg),
                audio: audios.map(({ ruta, ...resto }) => resto),
                tomas: lasTomas(clase, porId, audios)
            });
        }

        const datos = {
            version: 1,
            curso: path.basename(op.carpeta),
            aireSeg: AIRE_SEG_OPENFILM,
            largoSeg: seg(plan.largoSeg),
            capturas: lasCapturas(config),
            vistas: lasVistas(config, usadas),
            fuentes: plan.fuentes.map(f => ({
                clave: f.clave,
                nombre: f.nombre,
                capturas: f.ids.slice(),
                vista: f.vista || null,
                film: f.ids.length > 1
                    ? `parts/vista-${String(f.vista).toLowerCase()}/film.html`
                    : `parts/captura-${f.ids[0]}/film.html`
            })),
            clases
        };

        decir(plan.clases.length, plan.clases.length, 'Escribiendo las notas de rodaje…');
        workspace.writeJson(path.join(raiz, NOTAS, 'clases.json'), datos);
        for (const clase of clases) {
            workspace.writeAtomic(path.join(raiz, NOTAS, `${clase.corto}.md`),
                guionDeLaClase(clase, datos.fuentes));
        }
        const texto = guia(datos);
        const rutaGuia = path.join(raiz, NOMBRE_DE_LA_GUIA);
        workspace.writeAtomic(rutaGuia, texto);
        filmDeArranque(path.join(raiz, 'film.html'));

        const tomas = clases.reduce((n, c) => n + c.tomas.length, 0);
        return {
            ok: true,
            ruta: raiz,
            guia: rutaGuia,
            clases: clases.length,
            tomas,
            avisos,
            cuenta: [
                `${clases.length} clase(s) con ${tomas} toma(s), en ${config.capturas} captura(s).`,
                `Abrí ${CARPETA}/ en OpenFilm y pedile al agente que lea ${NOMBRE_DE_LA_GUIA}.`
            ],
            error: null
        };
    } catch (e) {
        return { ...vacio, avisos, error: `No pude escribir la carpeta de OpenFilm: ${e.message}` };
    }
}

module.exports = {
    CARPETA,
    NOTAS,
    ASSETS,
    AUDIO,
    exportar,
    lasCapturas,
    lasVistas,
    guionDeLaClase,
    filmDeArranque
};
