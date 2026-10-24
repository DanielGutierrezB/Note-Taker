'use strict';
/**
 * prproj-carpeta.js — El proyecto de Premiere de una carpeta entera.
 *
 * El editor, con las clases ya grabadas: un botón que le arme el proyecto con
 * las capturas listas para sincronizar y cada clase ya precortada. Lo que pidió,
 * dicho por él:
 *
 *   · «agregar capturas» —Capture 1, Capture 2, Capture 3— y que cada una sea
 *     una anidación con el marcador de todas las claquetas;
 *   · que todas las capturas tengan dentro el audio del XML, completo y sin
 *     cortar, para sincronizar ahí;
 *   · que las capturas después de la primera lleven la anidación de la Captura 1
 *     en A1, para sincronizarse contra ese audio desde donde esté;
 *   · elegir qué capturas componen cada vista, incluso si una vista es la unión
 *     de dos, para que la herramienta sepa qué activar y qué anidar;
 *   · y en la secuencia ya cortada, A1 el audio de la Captura 1 y A2 el audio de
 *     referencia de las notas.
 *
 * **Por qué precortar SOBRE anidaciones.** Las capturas se sueltan y se
 * sincronizan una vez, adentro de su anidación, y todos los cortes de todas las
 * clases son ventanas a esa misma línea de tiempo. Es la misma idea que los
 * nidos de Class Cut (`prproj-nidos.js`), con la diferencia de que acá las
 * anidaciones se entregan vacías de vídeo: Note Taker no tiene las cámaras,
 * tiene el audio y los cortes.
 *
 * Está partido en dos mitades a propósito. `planear`, en `prproj-plan.js`, es
 * pura: decide franjas, qué fuente le toca a cada toma y dónde cae cada corte y
 * cada marcador, y se prueba sin plantilla. Acá, `generar` traduce ese plan a
 * llamadas del `Taller`, que es lo que sabe del formato.
 */

const fs = require('fs');
const path = require('path');

const prproj = require('./prproj');
const { Taller, loQueFalta } = require('./prproj-secuencia');
const {
    BIN_PRE, COLORES_DE_CAPTURA, ETIQUETA_DE_VISTA, COLOR_DE_CLAQUETA, COLOR_DE_NOTA, nombreDeCaptura, planear
} = require('./prproj-plan');
const nidos = require('./prproj-nidos');
const notasXml = require('./notas-xml');
const sesionesGrabadas = require('./sesiones-grabadas');
const workspace = require('./workspace');
const {
    normalizar, archivoDeConfig, leerConfig, guardarConfig, vistasUsadas
} = require('./prproj-carpeta-config');

/** Los bins del panel, numerados para que Premiere los ordene así. */
const BIN_CAPTURAS = '01 Capturas';
const BIN_PRECORTADAS = '02 Precortadas';
const BIN_AUDIO = '03 Audio de referencia';

/** Cómo se llama la secuencia sin cortar de una clase. */
function nombreDePre(nombre) {
    return `${nombre} PRE`;
}

/**
 * Y los que el proyecto deja vacíos, que son del editor.
 *
 * Los tres primeros los llena esta app; estos tres son donde va lo que llega
 * después —el material que manda el profesor, las composiciones, los gráficos
 * y las pistas— y existen desde el principio para que el proyecto se vea igual
 * en todos los cursos y nadie tenga que acordarse de crearlos ni de cómo se
 * llamaban. Premiere guarda un bin vacío sin lista de ítems, así que no cuesta
 * nada tenerlos.
 */
const BINS_DEL_EDITOR = ['04 Material', '05 Comps', '06 Assets'];

/** El audio de referencia, en el panel y en la línea de tiempo. */
const ETIQUETA_DE_REFERENCIA = 'Caribbean';

// ─── El armado ───────────────────────────────────────────────────────

/** Los cuadros por segundo de la secuencia molde, leídos de su `VideoTrackGroup`. */
function fpsDeLaPlantilla(taller) {
    return taller.cuadro ? prproj.TICKS / taller.cuadro : null;
}

/** ¿Es el mismo fps? 29.97 y 30 no lo son, aunque se escriban parecido. */
function mismoFps(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01;
}

/**
 * El audio de referencia de una clase, entero y en su sitio, contado desde
 * `origenSeg`: la franja de la clase en las capturas, el cero en la PRE.
 */
function colocarReferencia(taller, pista, clase, medios, origenSeg) {
    let cortes = 0;
    for (const w of clase.wavs) {
        const medio = medios.get(w.ruta);
        if (!medio) continue;
        const desde = origenSeg + notasXml.aSegundos(w.desdeMs, clase.sesion.ceroMs);
        taller.colocarCorte({
            pista, medio, desdeSeg: desde, hastaSeg: desde + w.segundos,
            entradaSeg: 0, etiqueta: ETIQUETA_DE_REFERENCIA, sonando: true
        });
        cortes++;
    }
    return cortes;
}

/**
 * Las anidaciones de captura.
 *
 * La Captura 1 primero, porque las otras la llevan adentro. Cada una tiene:
 *   V1     vacío, donde va el vídeo de esa captura
 *   A1     vacío en la 1 (su propio audio); la Captura 1 anidada en las demás
 *   A2     el WAV de referencia de cada clase, entero, en su franja
 *   A3     vacío en las demás, para su propio audio
 * Las de referencia van con la pista silenciada: se ve la onda para sincronizar,
 * pero no se suma al audio de la precortada.
 */
function armarCapturas(taller, plan, config, medios, bin) {
    const capturas = new Map();
    for (let id = 1; id <= config.capturas; id++) {
        const primera = id === 1;
        const seq = taller.crearSecuencia({
            nombre: nombreDeCaptura(id),
            pistasVideo: 1,
            pistasAudio: primera ? 2 : 3,
            duracionSeg: plan.largoSeg
        });
        taller.pintarItemDelPanel(seq.itemDelPanel, plan.colorDeCaptura.get(id));
        taller.guardarEn(bin, seq.itemDelPanel);

        const pistaRef = seq.pistasAudio[1];
        for (const clase of plan.clases) colocarReferencia(taller, pistaRef, clase, medios, clase.franja.desdeSeg);
        taller.mutearPista(pistaRef);

        if (!primera && plan.largoSeg > 0) {
            const c1 = capturas.get(1);
            taller.colocarCorte({
                pista: seq.pistasAudio[0], medio: c1.comoFuente,
                desdeSeg: 0, hastaSeg: plan.largoSeg, entradaSeg: 0,
                etiqueta: plan.colorDeCaptura.get(1), sonando: true
            });
            taller.mutearPista(seq.pistasAudio[0]);
        }

        taller.ponerMarcadores(seq.secuencia, plan.marcadoresDeCaptura);
        capturas.set(id, seq);
    }
    return capturas;
}

/**
 * Las anidaciones de grupo: las capturas de una vista compuesta, apiladas.
 *
 * Van de punta a punta, sin cortar, porque el encuadre —el tamaño y el sitio del
 * recuadro— lo pone el editor una vez adentro y vale para toda la carpeta.
 *
 * **Quién tapa a quién sale del menú, no de los números.** Las capturas del
 * grupo vienen de abajo hacia arriba, igual que las pistas, así que la última
 * queda en el V más alto, que es donde Premiere pinta lo que tapa a lo demás.
 * Así «Captura 1 sobre Captura 2» y «Captura 2 sobre Captura 1» son dos
 * anidaciones distintas, y una vista puede llevar la cámara en recuadro sobre la
 * pantalla mientras otra lleva lo contrario.
 */
function armarGrupos(taller, plan, capturas, bin) {
    const grupos = new Map();
    for (const g of plan.grupos) {
        const seq = taller.crearSecuencia({
            nombre: g.titulo || g.nombre,
            pistasVideo: g.ids.length,
            pistasAudio: 1,
            duracionSeg: plan.largoSeg
        });
        taller.pintarItemDelPanel(seq.itemDelPanel, g.color);
        taller.guardarEn(bin, seq.itemDelPanel);
        if (plan.largoSeg > 0) {
            g.ids.forEach((id, i) => {
                taller.colocarCorte({
                    pista: seq.pistasVideo[i], medio: capturas.get(id).comoFuente,
                    desdeSeg: 0, hastaSeg: plan.largoSeg, entradaSeg: 0,
                    etiqueta: plan.colorDeCaptura.get(id), sonando: true
                });
            });
        }
        // Los mismos marcadores que las capturas: es donde se ajusta el encuadre,
        // y ahí también hay que saber en qué clase se está.
        taller.ponerMarcadores(seq.secuencia, plan.marcadoresDeCaptura);
        grupos.set(g.clave, seq);
    }
    return grupos;
}

/**
 * La precortada de una clase.
 *
 * **Cada vista tiene sus propias pistas**, y en una toma se encienden las de su
 * vista y nada más: cambiar de plano es encender el clip que ya está, como hace
 * Class Cut, y lo apagado no tapa a la buena. Como el renglón no se comparte
 * entre vistas, el apilado de cada una es el que pidió el menú.
 *
 * **Salvo las pistas que el menú dejó «solo en sus tomas»**, que en las tomas
 * de las otras vistas no ponen nada. Es la línea de tiempo limpia de quien
 * prefiere ver solo lo que va a salir; el precio es que para cambiar de plano
 * ahí ya no hay un clip que encender.
 *
 * Las capturas entran solo como vídeo —su audio es la referencia y la Captura 1,
 * que acá ya están en A1 y A2—; colocadas con audio, la precortada sonaría doble.
 */
function armarPrecortada(taller, clase, plan, fuentes, capturas, medios, bin) {
    if (!clase.cortes.length) return 0;
    const seq = taller.crearSecuencia({
        nombre: clase.nombre,
        pistasVideo: Math.max(1, plan.pistas.length),
        pistasAudio: 2,
        duracionSeg: clase.duracionSeg
    });
    taller.guardarEn(bin, seq.itemDelPanel);

    const c1 = capturas.get(1);
    let cortes = 0;
    for (const corte of clase.cortes) {
        plan.pistas.forEach((p, i) => {
            const suya = p.vista === corte.vista;
            if (!suya && !p.siempre) return;
            taller.colocarCorte({
                pista: seq.pistasVideo[i], medio: fuentes.get(p.clave).comoFuente,
                desdeSeg: corte.desdeSeg, hastaSeg: corte.hastaSeg, entradaSeg: corte.entradaSeg,
                etiqueta: p.color,
                sonando: suya
            });
            cortes++;
        });
        taller.colocarCorte({
            pista: seq.pistasAudio[0], medio: c1.comoFuente,
            desdeSeg: corte.desdeSeg, hastaSeg: corte.hastaSeg, entradaSeg: corte.entradaSeg,
            etiqueta: plan.colorDeCaptura.get(1), sonando: true
        });
        cortes++;
        const ref = corte.referencia;
        const medio = ref && medios.get(ref.ruta);
        if (medio && ref.largoSeg > 0) {
            taller.colocarCorte({
                pista: seq.pistasAudio[1], medio,
                desdeSeg: corte.desdeSeg, hastaSeg: corte.desdeSeg + ref.largoSeg, entradaSeg: ref.entradaSeg,
                etiqueta: ETIQUETA_DE_REFERENCIA, sonando: true
            });
            cortes++;
        }
    }
    taller.mutearPista(seq.pistasAudio[1]);
    taller.ponerMarcadores(seq.secuencia, clase.marcadores);
    return cortes;
}

/**
 * La clase entera, sin cortar.
 *
 * Son las MISMAS pistas que la precortada y en el mismo orden, a pedido: así
 * un clip se copia de una secuencia a la otra y cae en el renglón que le toca,
 * sin tener que contar de nuevo cuál era cuál. La diferencia es que acá cada
 * pista lleva un solo clip de punta a punta en vez de un pedazo por toma.
 *
 * **De la anidación se mira la franja de ESTA clase.** Las anidaciones son una
 * sola línea de tiempo con todas las clases de la carpeta seguidas (ver
 * `planear`), así que la PRE entra en `franja.desdeSeg` y dura `franja.largoSeg`:
 * el minuto 12 de la clase es el minuto 12 de esta secuencia, que es lo que
 * hace que los marcadores caigan donde se dijeron.
 *
 * **Y queda encendida una sola vista.** Las pistas son las de la precortada,
 * repetidas por vista, así que encenderlas todas dejaría ver solo la de arriba
 * y las otras tapadas debajo. Va encendida la primera vista que se usó en esta
 * clase —no la primera pista, que puede ser una «en todas» que nadie llamó— y
 * las demás quedan puestas y apagadas, que es el mismo gesto que la
 * precortada: cambiar de plano es encender el clip que ya está.
 */
function armarPre(taller, clase, plan, fuentes, capturas, medios, bin) {
    if (!clase.pre) return 0;
    const largoSeg = clase.franja.largoSeg;
    const pistas = plan.pistas;
    const seq = taller.crearSecuencia({
        nombre: nombreDePre(clase.nombre),
        pistasVideo: Math.max(1, pistas.length),
        pistasAudio: 2,
        duracionSeg: largoSeg
    });
    taller.guardarEn(bin, seq.itemDelPanel);

    let cortes = 0;
    pistas.forEach((p, i) => {
        taller.colocarCorte({
            pista: seq.pistasVideo[i], medio: fuentes.get(p.clave).comoFuente,
            desdeSeg: 0, hastaSeg: largoSeg, entradaSeg: clase.franja.desdeSeg,
            etiqueta: p.color,
            sonando: p.vista === clase.pre.vista
        });
        cortes++;
    });

    // A1, el audio de la Captura 1, que es el que se oye en la precortada.
    taller.colocarCorte({
        pista: seq.pistasAudio[0], medio: capturas.get(1).comoFuente,
        desdeSeg: 0, hastaSeg: largoSeg, entradaSeg: clase.franja.desdeSeg,
        etiqueta: plan.colorDeCaptura.get(1), sonando: true
    });
    cortes++;

    // Y A2, el audio de referencia entero: acá no se corta por toma como en la
    // precortada, porque no hay tomas que seguir.
    cortes += colocarReferencia(taller, seq.pistasAudio[1], clase, medios, 0);
    taller.mutearPista(seq.pistasAudio[1]);

    taller.ponerMarcadores(seq.secuencia, clase.pre.marcadores);
    return cortes;
}

/**
 * Arma el `.prproj` de la carpeta.
 *
 * El destino llega resuelto, como en Class Cut: decidir si se pisa un proyecto
 * que ya existe es un diálogo, y los diálogos viven en el proceso principal
 * (`ipc/prproj.js`).
 *
 * @param {object} opciones
 * @param {string} opciones.carpeta   la carpeta del curso
 * @param {string} opciones.destino   la ruta del `.prproj` a escribir
 * @param {string} opciones.plantilla el `.prproj` del que se clonan los moldes
 * @param {object} [opciones.config]  la del menú (ver `normalizar`)
 * @param {string} [opciones.enCurso] la secuencia que se está grabando, que no entra
 * @param {function} [opciones.avisar] recibe `{hecho, total, que}` mientras arma
 * @param {number} [opciones.semilla] para que dos corridas den el mismo archivo
 */
async function generar(opciones) {
    const op = opciones || {};
    const vacio = { ok: false, ruta: null, clases: 0, avisos: [], cuenta: [], error: null };
    const decir = (hecho, total, que) => {
        try { if (typeof op.avisar === 'function') op.avisar({ hecho, total, que }); } catch (e) { /* contar no es el trabajo */ }
    };

    if (!op.carpeta || !fs.existsSync(op.carpeta)) return { ...vacio, error: 'Esa carpeta no está.' };
    if (!op.destino) return { ...vacio, error: 'No me dijeron dónde escribir el proyecto.' };
    if (!op.plantilla || !fs.existsSync(op.plantilla)) {
        return { ...vacio, error: 'Falta la plantilla de Premiere que viene con la app. Reinstalala.' };
    }

    const sesiones = sesionesGrabadas.listar([op.carpeta], op.enCurso);
    if (!sesiones.length) return { ...vacio, error: 'Esta carpeta no tiene ninguna clase grabada todavía.' };
    const config = normalizar(op.config, vistasUsadas(sesiones));

    let proyecto;
    let taller;
    try {
        proyecto = prproj.Proyecto.leer(op.plantilla);
        taller = new Taller(proyecto, { semilla: op.semilla });
    } catch (e) {
        return { ...vacio, error: `No pude abrir la plantilla: ${e.message}` };
    }
    const faltan = loQueFalta(taller.moldes);
    if (faltan.length) {
        return { ...vacio, error: `La plantilla no sirve de molde: le falta ${faltan.join(', y ')}.` };
    }

    // **Los cuadros por segundo salen de la plantilla, no se escriben.** Una
    // secuencia clonada se queda con los del molde, así que una clase a 29,97
    // armada sobre una plantilla a 30 saldría corrida un cuadro cada medio
    // minuto. Se dice antes de armar nada.
    const fps = fpsDeLaPlantilla(taller);
    if (fps == null) {
        return { ...vacio, error: 'No pude leer los cuadros por segundo de la secuencia de la plantilla.' };
    }
    const distintas = sesiones.filter(s => !mismoFps(s.fps || 30, fps));
    if (distintas.length) {
        const cuales = [...new Set(distintas.map(s => s.fps || 30))].join(', ');
        return {
            ...vacio,
            error: `La plantilla es de ${Math.round(fps * 1000) / 1000} fps y en esta carpeta hay clases a ${cuales} fps`
                + ` (${distintas.length}). Un proyecto así quedaría corrido: hace falta una plantilla a ese fps.`
        };
    }

    // **Los cortes se ajustan contra la onda antes de planear.** El sidecar ya
    // trae el ajuste, pero puede ser de una versión anterior de esa cuenta
    // (`ajustar-corte.VERSION`), y entonces el proyecto saldría con los cortes
    // viejos mientras el XML de la misma clase —rehecho— sale con los nuevos:
    // dos versiones del mismo corte, que es justo lo que el editor no puede
    // tener. Se ajusta en memoria; el sidecar lo reescribe «Rehacer XML».
    decir(0, sesiones.length, 'Mirando la onda de cada clase…');
    for (const s of sesiones) {
        if (!s.archivos || !s.archivos.json) continue;
        sesionesGrabadas.ajustarBordes(s, workspace.sesionDelSidecar(s.archivos.json));
    }

    const plan = planear(sesiones, config, fps);
    const avisos = plan.avisos.slice();
    const total = plan.clases.length;

    try {
        const raiz = taller.raizDelPanel();
        const descolgados = taller.vaciarElPanel();
        const [binCapturas, binPrecortadas, binAudio] = [BIN_CAPTURAS, BIN_PRECORTADAS, BIN_AUDIO, ...BINS_DEL_EDITOR]
            .map((nombre, i) => {
                const bin = taller.crearBin(nombre, { orden: i });
                taller.guardarEn(raiz, bin);
                return bin;
            });

        decir(0, total, 'Importando el audio de referencia…');
        const medios = new Map();
        for (const clase of plan.clases) {
            for (const w of clase.wavs) {
                if (medios.has(w.ruta)) continue;
                const medio = taller.importarMedio({
                    ruta: w.ruta,
                    nombre: path.basename(w.ruta),
                    duracionSeg: w.segundos,
                    canales: w.canales === 2 ? 2 : 1,
                    conVideo: false
                });
                taller.marcarMedio(medio, w.marcadores);
                taller.guardarEn(binAudio, medio.clipProjectItem);
                medios.set(w.ruta, medio);
            }
        }

        decir(0, total, 'Armando las capturas…');
        const capturas = armarCapturas(taller, plan, config, medios, binCapturas);
        const grupos = armarGrupos(taller, plan, capturas, binCapturas);
        const fuentes = new Map();
        for (const f of plan.fuentes) {
            fuentes.set(f.clave, f.ids.length > 1 ? grupos.get(f.clave) : capturas.get(f.ids[0]));
        }

        // El bin de las PRE va DENTRO del de las precortadas, no al lado: es la
        // misma clase y se busca desde ahí. Se crea aunque no haya ninguna que
        // meter, igual que los bins del editor: un bin vacío no cuesta nada y
        // un proyecto que a veces tiene la carpeta y a veces no se lee peor.
        const binPre = taller.crearBin(BIN_PRE, { orden: 0 });
        taller.guardarEn(binPrecortadas, binPre);

        let cortes = 0;
        let precortadas = 0;
        let pres = 0;
        plan.clases.forEach((clase, i) => {
            decir(i, total, `Precortando ${clase.nombre}…`);
            const precortada = armarPrecortada(taller, clase, plan, fuentes, capturas, medios, binPrecortadas);
            if (precortada) { cortes += precortada; precortadas++; }
            // **La PRE se arma aunque la clase no tenga ni una toma.** Es
            // justamente la clase a la que no se podía llegar: sin tomas no hay
            // precortada, y su audio y sus notas no aparecían en el proyecto por
            // ningún lado.
            const pre = armarPre(taller, clase, plan, fuentes, capturas, medios, binPre);
            if (pre) { cortes += pre; pres++; }
        });

        const podados = taller.podarLaPlantilla();

        decir(total, total, 'Guardando el proyecto…');
        fs.mkdirSync(path.dirname(op.destino), { recursive: true });
        proyecto.guardar(op.destino);

        const tomas = plan.clases.reduce((n, c) => n + c.cortes.length, 0);
        const claquetas = plan.marcadoresDeCaptura.filter(m => m.nombre.startsWith('Claqueta ')).length;
        return {
            ok: true,
            ruta: op.destino,
            clases: total,
            precortadas,
            pres,
            capturas: config.capturas,
            grupos: plan.grupos.length,
            tomas,
            claquetas,
            cortes,
            avisos,
            cuenta: [
                `${total} clase(s) en ${config.capturas} captura(s)`
                    + (plan.grupos.length ? ` y ${plan.grupos.length} grupo(s)` : '')
                    + `, de ${Math.round(plan.largoSeg / 60)} minutos con ${nidos.AIRE_SEG / 60} de aire entre clases.`,
                // Las dos primeras líneas son las que el panel enseña
                // (`slice(0, 2)` en `panel-prproj.js`), así que la PRE va en
                // esta y no en una tercera: es un sitio nuevo del proyecto y
                // hay que saber que está.
                `${precortadas} precortada(s) con ${tomas} toma(s) y ${claquetas} claqueta(s) marcada(s)`
                    + ' en las capturas'
                    + (pres ? `, y ${pres} clase(s) enteras sin cortar en «${BIN_PRECORTADAS} › ${BIN_PRE}».` : '.'),
                `Se quitaron ${descolgados} objeto(s) de la plantilla (${podados} borrado(s)).`
            ],
            error: null
        };
    } catch (e) {
        // `guardar` verifica antes de escribir: si el grafo quedó mal, no se
        // escribió nada. Se dice así, para que nadie busque un archivo roto.
        return { ...vacio, avisos, error: `No se pudo armar el proyecto y no escribí nada: ${e.message}` };
    }
}

module.exports = {
    generar,
    planear,
    normalizar,
    vistasUsadas,
    leerConfig,
    guardarConfig,
    archivoDeConfig,
    fpsDeLaPlantilla,
    mismoFps,
    nombreDeCaptura,
    nombreDePre,
    BIN_CAPTURAS,
    BIN_PRECORTADAS,
    BIN_AUDIO,
    BIN_PRE,
    BINS_DEL_EDITOR,
    COLORES_DE_CAPTURA,
    ETIQUETA_DE_VISTA,
    COLOR_DE_CLAQUETA,
    COLOR_DE_NOTA
};
