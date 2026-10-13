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
 * Está partido en dos mitades a propósito. `planear` es pura: decide franjas,
 * qué fuente le toca a cada toma y dónde cae cada corte y cada marcador, y se
 * prueba sin plantilla. `generar` traduce ese plan a llamadas del `Taller`, que
 * es lo que sabe del formato.
 */

const fs = require('fs');
const path = require('path');

const prproj = require('./prproj');
const { Taller, loQueFalta } = require('./prproj-secuencia');
const nidos = require('./prproj-nidos');
const vivo = require('./notas-vivo');
const notasXml = require('./notas-xml');
const ajustar = require('./ajustar-corte');
const sesionesGrabadas = require('./sesiones-grabadas');
const workspace = require('./workspace');
const {
    porOrdenDeVistas, normalizar, vistaDe, gruposDe,
    archivoDeConfig, leerConfig, guardarConfig, vistasUsadas
} = require('./prproj-carpeta-config');

/** Los bins del panel, numerados para que Premiere los ordene así. */
const BIN_CAPTURAS = '01 Capturas';
const BIN_PRECORTADAS = '02 Precortadas';
const BIN_AUDIO = '03 Audio de referencia';

/**
 * Y adentro de las precortadas, la clase SIN cortar.
 *
 * La precortada tira todo lo que quedó fuera de las tomas, y eso casi siempre
 * está bien: es el trabajo. Pero cuando está mal —una frase que valía y quedó
 * afuera, un borde puesto dos palabras tarde, una clase que no se marcó— no
 * había forma de llegar a ese audio desde Premiere. Había que volver a la app,
 * mover el borde y rehacer el proyecto.
 *
 * Así que al lado de cada precortada va la misma clase de punta a punta, con
 * las mismas pistas y todo lo que se dijo. Lo pidió así: «una dentro que se
 * llame PRE, y dentro esté la secuencia previa a ser cortada».
 */
const BIN_PRE = 'PRE';

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

/**
 * Un color por anidación, para poder leer la precortada de un vistazo.
 *
 * Cada anidación —cada captura y cada vista compuesta— se pinta de un color, y
 * sus clips llevan ese mismo color donde aparezcan: en su pista de la
 * precortada, adentro de otra anidación y en la fila del panel. Así una franja
 * de color dice qué se está viendo sin leer el nombre del clip.
 *
 * Los tres primeros son los que el editor eligió para sus capturas; los otros
 * siguen con lo que queda de la paleta, salteando el caribe, que es el del
 * audio de referencia y ya significa otra cosa. Con más de siete capturas se
 * repiten, que es lo único que se puede hacer con ocho ranuras.
 */
const COLORES_DE_CAPTURA = ['Cerulean', 'Lavender', 'Mango', 'Rose', 'Violet', 'Iris', 'Forest'];

/**
 * Y una anidación que es una vista se pinta del color de esa vista.
 *
 * Una captura es material —de ahí sale un plano— y su color es de la paleta;
 * una anidación que se llama `X2` o `R` **es** la vista, y el editor ya conoce
 * su color de las notas: tenerlo igual en Premiere ahorra traducir. Lo que hay
 * acá es esa traducción, de `colorDeMarcador` a la etiqueta más cercana de la
 * paleta de Premiere, medida en distancia RGB:
 *
 *   R  #E96F24 → Mango  (60)      S  #718637 → Forest (68)
 *   MG #3B82F6 → Iris   (73)      X2 #AF8BB1 → Violet (48)
 *
 * **PV es la excepción y es a propósito.** Su rojo no existe en esta paleta —lo
 * más cercano es un marrón a 83 de distancia, que no se parece a nada— así que
 * en Premiere va cerúleo, que es además el color de la Captura 1, que es la
 * cámara del profesor en todos los cursos que se han armado.
 *
 * Una anidación puede ser de dos vistas que piden la misma pareja de capturas
 * (`MG y X2`): lleva el color de la primera, que es la que da el nombre.
 */
const ETIQUETA_DE_VISTA = {
    PV: 'Cerulean',
    R: 'Mango',
    S: 'Forest',
    MG: 'Iris',
    X2: 'Violet'
};

/** Blanco, el de las claquetas en el XML (`notas-xml.BLANCO`). */
const COLOR_DE_CLAQUETA = notasXml.BLANCO;

/** Turquesa, el de las notas sobre el texto en el XML (`notas-xml.TURQUESA`). */
const COLOR_DE_NOTA = notasXml.TURQUESA;

/** El nombre de una captura sola. */
function nombreDeCaptura(id) {
    return `Captura ${id}`;
}

/**
 * Una fuente es una captura sola o un grupo; su clave son los ids con `+`.
 *
 * **Los ids van de abajo hacia arriba, como las pistas de Premiere**, y el
 * orden es parte de la clave: `1+2` y `2+1` son dos grupos distintos —la misma
 * pareja apilada al revés— y una carpeta puede necesitar los dos: la cámara en
 * recuadro sobre la pantalla en una vista, y al revés en otra.
 */
function claveDeFuente(ids) {
    return ids.join('+');
}

/** «Captura 2 sobre Captura 1» para `[1, 2]`: se nombra desde la que tapa. */
function nombreDeFuente(ids) {
    return ids.slice().reverse().map(nombreDeCaptura).join(' sobre ');
}

/**
 * La anidación de una vista compuesta se llama como la vista: `PV`, `R`, `X2`.
 *
 * No como su composición. En la precortada, el clip de esa pista lleva el
 * nombre de la anidación, y lo que hace falta leer ahí es qué plano es, no de
 * qué capturas está hecho: eso se decide una vez en el menú y después estorba.
 * La composición sigue nombrada en los avisos, que es donde importa.
 *
 * Dos vistas pueden compartir una anidación —la misma pareja apilada igual— y
 * entonces lleva los dos nombres: es una sola secuencia y esconder que la
 * comparten haría que tocar el encuadre de una cambiara la otra sin avisar.
 */
function nombreDeAnidacion(vistas) {
    return vistas.slice().sort(porOrdenDeVistas).join(' y ');
}

// ─── El plan ─────────────────────────────────────────────────────────

/** Los WAV de una sesión, con la ruta donde están HOY. */
function wavsDe(sesion) {
    const sitio = sesion.archivos && sesion.archivos.json
        ? workspace.sesionDelSidecar(sesion.archivos.json)
        : null;
    return (sesion.sesiones || [])
        .filter(w => w && w.archivo && w.segundos > 0)
        .map(w => ({
            ...w,
            ruta: sitio ? sesionesGrabadas.dondeQuedoElWav(sitio, w.archivo) : w.archivo
        }));
}

/**
 * Cuánto dura una clase adentro de una anidación: lo que llega más lejos entre
 * el audio, las tomas y las claquetas. El audio casi siempre manda; las otras
 * dos son por si un WAV no está, que la franja no se achique hasta pisar la
 * siguiente.
 */
function largoDe(sesion, wavs) {
    const cero = sesion.ceroMs;
    let fin = 0;
    for (const w of wavs) fin = Math.max(fin, notasXml.aSegundos(w.desdeMs, cero) + w.segundos);
    for (const t of sesion.tomas || []) {
        if (t.outMs != null) fin = Math.max(fin, notasXml.aSegundos(t.outMs, cero));
    }
    for (const c of sesion.claquetas || []) {
        if (c.ms != null) fin = Math.max(fin, notasXml.aSegundos(c.ms, cero));
    }
    return fin;
}

/** El WAV que tiene sonando el instante `ms`, o null. */
function wavQueContiene(wavs, ms) {
    return wavs.find(w => ms >= w.desdeMs && ms < w.desdeMs + w.segundos * 1000) || null;
}

/**
 * Un marcador del XML dicho como los nombra este módulo.
 *
 * Los dos formatos llevan lo mismo —nombre, comentario, desde, hasta y el
 * entero de color de Premiere— con otros nombres de campo, así que el juego de
 * marcadores de una sesión se arma UNA vez, en `notas-xml.js`, y acá se
 * traduce. Un marcador de punto llega sin `endSec` y en este formato dura cero.
 */
function deXml(m) {
    return {
        nombre: m.name,
        comentario: m.comment,
        desdeSeg: m.startSec,
        hastaSeg: m.endSec == null ? m.startSec : m.endSec,
        color: m.color
    };
}

/**
 * Todo lo que va al proyecto, sin tocar todavía el formato.
 *
 * **Las clases van por hora de inicio, no por nombre.** Class Cut ordena por
 * nombre de archivo, y acá un nombre puede llevar delante lo que el editor
 * escribió al renombrar («Clase 3…»), que lo sacaría de su lugar.
 *
 * **Las fuentes de la precortada son las que las tomas usan**, en el mismo orden
 * para todas las clases: primero las capturas solas, de la 1 en adelante, y
 * después los grupos. Así el V1 de una clase es el V1 de todas.
 *
 * @param {object[]} sesiones lo que devuelve `sesiones-grabadas.listar`
 * @param {object} config lo que devuelve `normalizar`
 */
function planear(sesiones, config) {
    const avisos = [];
    const ordenadas = (sesiones || [])
        .filter(s => s && s.ceroMs != null)
        .slice()
        .sort((a, b) => a.ceroMs - b.ceroMs);

    const clases = [];
    let reloj = 0;
    for (const sesion of ordenadas) {
        const wavs = wavsDe(sesion);
        const faltan = wavs.filter(w => !fs.existsSync(w.ruta));
        for (const w of faltan) {
            avisos.push(`${sesion.secuencia}: no encontré el audio «${path.basename(w.ruta)}»; esa clase entra sin él.`);
        }
        if (!sesion.terminada) {
            avisos.push(`${sesion.secuencia} quedó sin terminar: entra con lo que tenía guardado.`);
        }
        const largoSeg = largoDe(sesion, wavs);
        // Lo que lleva cada WAV encima: los mismos marcadores que el XML le pone
        // al clip maestro, medidos desde el arranque del archivo. Es el juego
        // completo de la sesión —tomas, claquetas y notas— porque un WAV de dos
        // horas es lo único que el editor tiene para ubicarse mientras
        // sincroniza, y ahí no hay pistas de colores que mirar.
        const marcas = notasXml.marcadores(sesion);
        for (const w of wavs) {
            w.marcadores = notasXml.marcadoresDelClip(marcas, w, sesion.ceroMs).map(deXml);
        }
        clases.push({
            sesion,
            nombre: sesion.secuencia,
            wavs: wavs.filter(w => fs.existsSync(w.ruta)),
            franja: { desdeSeg: reloj, largoSeg },
            marcas
        });
        reloj += largoSeg + nidos.AIRE_SEG;
    }
    const largoSeg = clases.length ? Math.max(0, reloj - nidos.AIRE_SEG) : 0;

    // Dónde cae un instante de una clase adentro de las anidaciones.
    const enNido = (clase, ms) => clase.franja.desdeSeg + notasXml.aSegundos(ms, clase.sesion.ceroMs);

    // **Una fuente es un medio; una pista es un sitio.** Son dos cosas y antes
    // eran una sola, y de ahí salía el enredo que esto arregla.
    //
    // La fuente es lo que se importa o se anida una vez y se usa donde haga
    // falta: la Captura 1 es un solo clip maestro aunque la pidan tres vistas.
    // La pista es el renglón de la precortada, y de ese sí **cada vista es
    // dueña**: la Captura 1 de PV y la Captura 1 de R son el mismo medio en dos
    // renglones distintos, cada uno con su apilado y su «en todas».
    //
    // `usadas` junta los medios, sin repetir. Quién los pide se anota para
    // poder nombrar una anidación por las vistas que la comparten.
    const usadas = new Map();
    const quienPide = new Map();
    const anotar = (ids, vista) => {
        const clave = claveDeFuente(ids);
        if (!usadas.has(clave)) {
            usadas.set(clave, { clave, ids, nombre: nombreDeFuente(ids) });
            quienPide.set(clave, new Set());
        }
        quienPide.get(clave).add(vista);
        return clave;
    };
    const fuentesDe = vista => gruposDe(vistaDe(config, vista)).map(ids => anotar(ids, vista));

    for (const clase of clases) {
        let cursor = 0;
        clase.cortes = [];
        clase.marcadores = [];
        const tomas = vivo.tomasQueQuedan(clase.sesion).slice().sort((a, b) => a.inMs - b.inMs);
        for (const toma of tomas) {
            const vista = vivo.vistaLeida(toma.vista) || vivo.VISTA_POR_DEFECTO;
            const inMs = ajustar.inAjustado(toma);
            const outMs = ajustar.outAjustado(toma);
            const largo = (outMs - inMs) / 1000;
            if (!(largo > 0)) continue;

            const wav = wavQueContiene(clase.wavs, inMs);
            let referencia = null;
            if (wav) {
                const entradaSeg = (inMs - wav.desdeMs) / 1000;
                // Una toma que cruza al WAV siguiente —la sesión se reanudó a mitad
                // de toma— corta su referencia donde termina el archivo: más allá
                // de ese WAV no hay audio que poner en A2.
                const cabe = Math.min(largo, wav.segundos - entradaSeg);
                if (cabe < largo - 0.05) {
                    avisos.push(`${clase.nombre}: la toma ${toma.id} cruza de un audio a otro; su referencia en A2 llega hasta donde termina el primero.`);
                }
                referencia = { ruta: wav.ruta, entradaSeg, largoSeg: cabe };
            }

            clase.cortes.push({
                toma: toma.id,
                vista,
                fuentes: fuentesDe(vista),
                desdeSeg: cursor,
                hastaSeg: cursor + largo,
                entradaSeg: enNido(clase, inMs),
                referencia
            });

            // **Solo las tomas que tienen algo escrito llevan marcador, y dura
            // lo que dura la toma.** En la precortada el plano ya se ve —es la
            // pista que quedó encendida, con el color de su anidación— así que
            // un marcador por toma diciendo «Toma 4 · PV» era repetir en una
            // tira de colores lo que ya dice la línea de tiempo, y tapaba los
            // pocos que sí traen algo que leer. El que queda abarca el bloque
            // entero porque la nota es de la toma entera, no de su principio.
            // En el XML siguen estando todos: ahí no hay pistas que mirar.
            if (vivo.limpio(toma.comentario)) {
                clase.marcadores.push({
                    nombre: `${notasXml.nombreDeToma(toma)} · ${vista}`,
                    comentario: vivo.comentarioDeEntrada(toma),
                    desdeSeg: cursor,
                    hastaSeg: cursor + largo,
                    color: notasXml.colorDeVista(vista)
                });
            }
            // Las notas sobre un pedazo del texto, en el sitio de la precortada
            // donde quedó ese pedazo. Las que caen fuera de la toma —un borde que
            // se corrió después de escribirlas— se quedan afuera: en la precortada
            // ese audio no está.
            for (const c of toma.comentarios || []) {
                if (c.desdeMs == null) continue;
                if (c.desdeMs < inMs || c.desdeMs >= outMs) continue;
                const desde = cursor + (c.desdeMs - inMs) / 1000;
                const hasta = c.hastaMs != null ? cursor + (Math.min(c.hastaMs, outMs) - inMs) / 1000 : desde;
                clase.marcadores.push({
                    nombre: 'Nota',
                    comentario: vivo.limpio(c.comentario),
                    desdeSeg: desde,
                    hastaSeg: Math.max(desde, hasta),
                    color: COLOR_DE_NOTA
                });
            }
            cursor += largo;
        }
        clase.duracionSeg = cursor;
        if (!clase.cortes.length) {
            avisos.push(`${clase.nombre} no tiene tomas que vayan al XML: no lleva precortada`
                + (clase.franja.largoSeg > 0 ? `, pero entra entera en ${BIN_PRE}.` : '.'));
        }
    }

    const pistas = repartirPistas(clases, config, anotar);

    // La clase sin cortar (ver `armarPre`). Sus marcadores son los del XML tal
    // cual: ya vienen en segundos desde el cero de la clase, que es justo el
    // reloj de la PRE. No hace falta correrlos como en la precortada —donde
    // cada toma se pega a la anterior— porque acá no se quitó nada: el minuto
    // 12 de la clase es el minuto 12 de la secuencia.
    for (const clase of clases) {
        clase.pre = clase.franja.largoSeg > 0
            ? { vista: vistaDeLaPre(clase, pistas), marcadores: clase.marcas.map(deXml) }
            : null;
        delete clase.marcas;
    }

    // **En las anidaciones van las claquetas y nada más.**
    //
    // Son tres sitios con tres trabajos, y mezclarlos los arruina a los tres:
    //
    //   · El **audio de referencia** lleva todos los marcadores de la sesión,
    //     sin cortar y en la hora en que se dijeron: es el archivo, y ahí está
    //     todo lo que se oyó. Viajan con él adonde se lo ponga.
    //   · Las **anidaciones** llevan solo las claquetas, que es lo único que se
    //     usa acá adentro: alinear el material de esa cámara contra la palmada.
    //     Puestas las tomas y las notas, la regla quedaba tapada de banderitas
    //     justo donde hay que ver la onda.
    //   · La **precortada** lleva los marcadores cortados y estirados sobre el
    //     bloque de cada toma, que es lo que se lee al editar.
    const marcadoresDeCaptura = [];
    for (const clase of clases) {
        const claquetas = clase.sesion.claquetas || [];
        for (const c of claquetas) {
            if (c.ms == null) continue;
            const seg = enNido(clase, c.ms);
            marcadoresDeCaptura.push({
                nombre: `Claqueta ${c.n}`,
                comentario: `${clase.nombre} · ${notasXml.comentarioDeClaqueta(c, c === claquetas[0])}`,
                desdeSeg: seg,
                hastaSeg: seg,
                color: COLOR_DE_CLAQUETA
            });
        }
    }

    // Los medios que hay que armar: las capturas sueltas y las anidaciones. El
    // orden acá no decide nada de la precortada —eso lo decide `pistas`—, pero
    // sí el de la carpeta de Premiere, así que van las capturas por número y
    // después las anidaciones, y no en el orden en que la primera clase las
    // fue nombrando, que cambia con cada grabación.
    const anidacion = f => (f.ids.length > 1 ? 1 : 0);
    const fuentes = [...usadas.values()].sort((a, b) =>
        anidacion(a) - anidacion(b)
        || a.ids[0] - b.ids[0]
        || a.ids.join(',').localeCompare(b.ids.join(','), 'en', { numeric: true }));
    const grupos = fuentes.filter(f => f.ids.length > 1);

    // Cada anidación se llama como la vista o las vistas que la usan: dos
    // vistas que armaron el mismo apilado comparten el medio aunque cada una
    // tenga su propia pista.
    for (const g of grupos) {
        g.vistas = [...quienPide.get(g.clave)];
        g.titulo = nombreDeAnidacion(g.vistas);
    }

    // Y cada una lleva su color: las capturas de la paleta, y las que son una
    // vista el de su vista. Si apareciera una vista sin traducción —una nueva en
    // `notas-vivo`— sigue la paleta por detrás de las capturas, que es quedarse
    // con un color cualquiera pero no sin ninguno.
    const colorDeCaptura = new Map();
    for (let id = 1; id <= config.capturas; id++) {
        colorDeCaptura.set(id, COLORES_DE_CAPTURA[(id - 1) % COLORES_DE_CAPTURA.length]);
    }
    grupos.forEach((g, i) => {
        g.color = ETIQUETA_DE_VISTA[g.vistas[0]]
            || COLORES_DE_CAPTURA[(config.capturas + i) % COLORES_DE_CAPTURA.length];
    });
    for (const f of fuentes) {
        if (f.ids.length === 1) f.color = colorDeCaptura.get(f.ids[0]);
    }
    for (const p of pistas) p.color = usadas.get(p.clave).color;

    return { clases, largoSeg, fuentes, pistas, grupos, colorDeCaptura, marcadoresDeCaptura, avisos };
}

/**
 * Las pistas de vídeo de la precortada, de V1 para arriba.
 *
 * **Cada vista es dueña de sus pistas, y no las comparte con nadie.** Las de
 * una vista van juntas y en su orden, de abajo hacia arriba, así que la última
 * del menú es la que tapa. Después empieza la vista siguiente, en el orden de
 * `VISTAS`: primero las pistas de PV, después las de R, y así.
 *
 * Esto es lo que antes se hacía al revés, y era el enredo. Las pistas eran una
 * sola lista para toda la precortada y la Captura 1 era UNA pista, la misma
 * para todas las vistas que la pidieran. Entonces dos vistas con apilados
 * distintos —PV con la Captura 1 sola, R con la 1 encima de la 2— se peleaban
 * por el mismo renglón: había que ordenarlas con un orden topológico, la
 * Captura 1 terminaba en V2 para que pudiera tapar a la 2 en las tomas de R, y
 * cuando dos vistas pedían lo contrario no había orden posible y una se quedaba
 * sin su apilado, con un aviso de consuelo. Repitiendo la pista por vista nada
 * de eso puede pasar: el medio se comparte —la Captura 1 se importa una vez—
 * pero el renglón no, y cada vista queda con el apilado que pidió.
 *
 * **Lo que dice el menú es lo que sale.** «En todas» deja la captura puesta en
 * todas las tomas de la clase, apagada donde no toca, y eso vale aunque la
 * vista no se haya llamado ni una vez: es la pista que el editor va a encender
 * a mano en Premiere. «Solo PV» la pone únicamente en las tomas de PV, así que
 * si PV no se llamó no hay dónde ponerla y no reserva renglón.
 *
 * Antes una captura SUELTA «en todas» de una vista sin tomas no entraba —solo
 * las anidaciones—, con el argumento de que «Captura 1, en todas» es lo que
 * toda vista dice de fábrica y nadie lo había pedido. Pero ese menú es el mismo
 * diálogo donde se aprieta Generar: lo que dice cada vista está a la vista en
 * ese momento, y quien no quiere un renglón lo pone en «solo». Pasó así: PV
 * con la Captura 1 «en todas», una clase donde solo se dijo R, y la pista de PV
 * no estaba en Premiere.
 */
function repartirPistas(clases, config, anotar) {
    const conTomas = new Set();
    for (const clase of clases) {
        for (const corte of clase.cortes) conTomas.add(corte.vista);
    }

    // Las del menú, más cualquiera que haya salido de una toma y no esté ahí:
    // `vistaLeida` devuelve lo que diga el marcador, así que un XML tocado a
    // mano puede traer una sigla que el menú no conoce. Sin esto esa toma se
    // quedaría sin una sola pista de vídeo, que es el peor final posible.
    const enOrden = [...new Set([...Object.keys(config.vistas || {}), ...conTomas])].sort(porOrdenDeVistas);

    const pistas = [];
    for (const vista of enOrden) {
        const v = vistaDe(config, vista);
        const llamada = conTomas.has(vista);
        for (const ids of gruposDe(v)) {
            // Una anidación es un clip: «en todas» es todo el grupo o nada
            // (ver `vistaSaneada`). Y sin tomas de su vista, una «solo suya»
            // quedaría vacía de punta a punta: un renglón sin un solo clip.
            const siempre = ids.every(id => v.siempre.includes(id));
            if (!llamada && !siempre) continue;
            pistas.push({ vista, clave: anotar(ids, vista), ids, siempre });
        }
    }
    return pistas;
}

/**
 * La vista que queda encendida en la PRE: la primera que se usó en esta clase,
 * en el orden de las pistas, que ya es el de `VISTAS`. No la primera pista, que
 * puede ser una «en todas» que nadie llamó. Una clase sin tomas no usó ninguna
 * y se queda con la primera pista.
 */
function vistaDeLaPre(clase, pistas) {
    const usadas = new Set(clase.cortes.map(c => c.vista));
    const primera = pistas.find(p => usadas.has(p.vista)) || pistas[0];
    return primera ? primera.vista : null;
}

// ─── El armado ───────────────────────────────────────────────────────

/** Los cuadros por segundo de la secuencia molde, leídos de su `VideoTrackGroup`. */
function fpsDeLaPlantilla(taller) {
    const p = taller.proyecto;
    const grupo = p.refsDe(taller.moldes.secuencia).find(k => p.clase(k) === 'VideoTrackGroup');
    const m = grupo ? /<FrameRate>(\d+)<\/FrameRate>/.exec(p.contenido(grupo)) : null;
    return m ? prproj.TICKS / Number(m[1]) : null;
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

    const plan = planear(sesiones, config);
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
    nombreDeFuente,
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
