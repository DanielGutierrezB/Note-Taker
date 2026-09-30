'use strict';
/**
 * sesiones-grabadas.js — Las sesiones que ya están en el disco.
 *
 * Del otro lado de la pared está la grabación en curso, que vive en memoria y se
 * mueve sola. Acá no hay sesión ni relojes: hay una carpeta con archivos, y todo
 * lo que se puede hacer con ellos sin estar grabando —listarlos, editarlos,
 * volver a oírlos, renombrarlos, borrarlos y reanudar uno que quedó abierto—.
 *
 * Ninguna de estas funciones mira el estado de la sesión en curso. Las que
 * necesitan saber algo de ella —para no tocarle los archivos por debajo— lo
 * reciben como un nombre y nada más.
 *
 * **Todo lo que escribe o borra se queda adentro de la carpeta.** El nombre del
 * curso lo elige el editor y puede traer barras o `..`; las rutas se arman con
 * `workspace` y se comprueban antes de tocar nada (`dentroDe`).
 */

const fs = require('fs');
const path = require('path');

const notasXml = require('./notas-xml');
const nombreDeSesion = require('./nombre-de-sesion');
const workspace = require('./workspace');
const oirToma = require('./oir-toma');
const vivo = require('./notas-vivo');

const { SUFIJO_SIDECAR } = workspace;

/**
 * Las sesiones que hay en las carpetas, de la más nueva a la más vieja.
 *
 * Se leen del disco y no de la memoria: la lista SON las carpetas. Así la clase
 * de ayer aparece igual que la de hace un minuto, y cerrar la app no borra nada
 * de lo que se veía. Lo que hay es lo que quedó escrito —el sidecar que se
 * reescribe en cada cambio (`notas-xml.sidecar`)—, así que una sesión que se
 * cortó por un cierre brusco aparece igual, con lo que había hasta ahí y
 * marcada como abierta.
 *
 * La que se está grabando ahora no va: la pantalla la dibuja aparte, con lo que
 * llega por los avisos, y sería verla dos veces.
 *
 * @param {string[]} dirs las carpetas (`ajustes.leer().carpetas`)
 * @param {string} [enCurso] la secuencia que se está grabando, para dejarla fuera
 */
function listar(dirs, enCurso) {
    const sesiones = [];
    const vistas = new Set();
    for (const dir of dirs || []) {
        for (const s of sidecaresDe(workspace.datosDir(dir), dir)) {
            if (s.secuencia === enCurso || vistas.has(s.secuencia)) continue;
            vistas.add(s.secuencia);
            sesiones.push(s);
        }
    }
    return sesiones.sort((a, b) => (b.ceroMs || 0) - (a.ceroMs || 0));
}

/**
 * Las sesiones que hay en una carpeta concreta, con el resumen que la lista
 * dibuja sin tener que abrir ninguna.
 */
function sidecaresDe(donde, base) {
    let nombres = [];
    try {
        nombres = fs.readdirSync(donde);
    } catch (e) {
        return []; // una carpeta que no está no tiene sesiones
    }

    const sesiones = [];
    for (const nombre of nombres) {
        if (!nombre.endsWith(SUFIJO_SIDECAR)) continue;
        const json = path.join(donde, nombre);
        try {
            const leida = notasXml.estadoLeido(JSON.parse(fs.readFileSync(json, 'utf8')));
            if (!leida || !leida.secuencia) continue;
            const suyos = workspace.sesionDelSidecar(json);
            sesiones.push({
                ...leida,
                carpeta: base,
                archivos: { xml: suyos.xml, json },
                resumen: resumirParaLaLista(leida)
            });
        } catch (e) {
            // Un sidecar roto no puede tirar la lista entera: se salta y las
            // demás sesiones se siguen viendo.
        }
    }
    return sesiones;
}

/**
 * Lo que la fila de la lista dice sin abrir nada: cuánto duró, cuántas tomas,
 * cuántas claquetas, y en qué estado quedó.
 *
 * El estado va en PALABRAS y no solo en color, que es la regla de toda la
 * interfaz. Son tres y se excluyen:
 *
 *   `abierta`     quedó sin cerrar (la app se fue al piso, o se cerró grabando).
 *                 Es la única que se puede reanudar, y por eso es la que más
 *                 importa distinguir: mientras esté así, todavía se le puede
 *                 agregar audio y tomas al mismo XML.
 *   `sin releer`  terminó, pero alguna toma se quedó con el texto descartable
 *                 del ciclo liviano porque Whisper se murió. Se arregla con
 *                 "Regenerar", que acá tiene la máquina libre.
 *   `terminada`   cerró bien y todas sus tomas tienen su texto.
 */
function resumirParaLaLista(estado) {
    const tomas = estado.tomas || [];
    const sinReleer = tomas.filter(t => t.relectura && t.relectura.estado === 'sin-leer').length;
    const segundos = (estado.sesiones || []).reduce((n, s) => n + (s.segundos || 0), 0);
    return {
        tomas: tomas.filter(t => !t.descartada).length,
        descartadas: tomas.filter(t => t.descartada).length,
        claquetas: (estado.claquetas || []).length,
        segundos,
        sinReleer,
        estado: !estado.terminada ? 'abierta' : (sinReleer ? 'sin releer' : 'terminada')
    };
}

/**
 * Vuelve a leer todas las tomas de una sesión con el modelo grande.
 *
 * Es lo que arregla la toma que quedó con el texto del ciclo liviano porque el
 * sistema se llevó a whisper-cli en medio de la clase. Acá la máquina está
 * libre, que es la razón por la que ahora sí puede salir.
 */
const regenerando = new Set();

async function regenerar(json, avisar, enCurso) {
    const sitio = workspace.sesionDelSidecar(json);
    const estado = leerSidecar(json);
    if (estado.secuencia && estado.secuencia === enCurso) {
        throw new Error('Esa sesión se está grabando ahora. Terminala antes de regenerarla.');
    }
    if (regenerando.has(json)) throw new Error('Esa sesión ya se está regenerando.');
    regenerando.add(json);
    try {
        // El WAV se guardó con la ruta de entonces. Si la carpeta se movió,
        // sigue en la carpeta de audio de esta carpeta.
        const archivos = (estado.sesiones || []).map(s => ({
            ...s,
            archivo: dondeQuedoElWav(sitio, s.archivo)
        }));
        const tomas = (estado.tomas || []).filter(t => t.inMs != null && t.outMs != null);
        const aviso = typeof avisar === 'function' ? avisar : () => {};

        let sinAudio = 0;
        let degradadas = 0;
        let sinLeer = 0;
        for (const [i, toma] of tomas.entries()) {
            const leido = await oirToma.leer(archivos, toma, { idioma: estado.idioma });
            // **Y acá es donde la marca se limpia sola.** `leer` devuelve
            // `relectura: null` cuando la toma salió con el modelo bueno, así
            // que el `Object.assign` borra la marca que le había quedado de la
            // sesión en vivo. Es justo para lo que existe este botón.
            if (leido) Object.assign(toma, leido);
            else sinAudio++;
            if (leido && leido.relectura) {
                if (leido.relectura.estado === 'degradada') degradadas++;
                else sinLeer++;
            }
            aviso({ tipo: 'regenerando', json, hechas: i + 1, total: tomas.length });
        }

        workspace.writeAtomic(sitio.xml, notasXml.xmlDeNotas(estado));
        workspace.writeJson(sitio.json, notasXml.sidecar(estado));
        // `degradadas` y `sinLeer` se cuentan para poder decirlo al terminar:
        // una regeneración que no logró leer tres tomas y contesta "8 tomas
        // releídas" es la misma pérdida silenciosa que esto vino a arreglar.
        return {
            tomas: tomas.length, sinAudio, degradadas, sinLeer,
            archivos: { xml: sitio.xml, json: sitio.json }
        };
    } finally {
        regenerando.delete(json);
    }
}

/**
 * Dónde está hoy un WAV que el sidecar anotó con la ruta de entonces.
 *
 * La ruta guardada manda si el archivo sigue ahí; si no, se lo busca por su
 * nombre en la carpeta de audio de esta carpeta. Sin esto, mover la carpeta
 * dejaría a "Regenerar" sin audio, y eso no se ve hasta que alguien lo aprieta.
 */
function dondeQuedoElWav(sitio, guardado) {
    if (guardado && fs.existsSync(guardado)) return guardado;
    const nombre = path.basename(guardado || '');
    return path.join(sitio.audio, nombre);
}

/**
 * Cambia una sesión que ya terminó, y reescribe su XML.
 *
 * **El XML se reescribe acá mismo, en el mismo gesto.** Un cambio que se queda
 * en la pantalla no llega a Premiere, y tener un botón aparte de "guardar"
 * garantiza que alguna vez se haga lo primero sin lo segundo.
 *
 * **Qué se puede y qué no lo decide `vivo.aplicar`, y el criterio es si alcanza
 * con lo que ya está escrito.** Comentar, cambiar la vista, escribir la nota y
 * descartar una toma son escribir un campo. Mover un borde también entra, que
 * es lo que menos parece: las orillas de cada toma están guardadas en el mismo
 * archivo, así que correr el IN o el OUT dentro de ese rango es repartir de
 * nuevo las palabras que ya están (ver `moverBordeGuardado` allá).
 *
 * @param {string} json el sidecar de la sesión
 * @param {object} cambio uno de los que no necesiten el audio
 */
function editarGrabada(json, cambio) {
    const c = cambio || {};
    const estado = leerSidecar(json);
    const sitio = workspace.sesionDelSidecar(json);

    if (c.tipo === 'quitar-claqueta') {
        vivo.quitarClaqueta(estado, Number(c.n));
    } else {
        const toma = (estado.tomas || []).find(t => t.id === c.toma);
        if (!toma) throw new Error(`Esa sesión no tiene la toma ${c.toma}.`);
        vivo.aplicar(toma, c);
    }

    workspace.writeAtomic(sitio.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(sitio.json, notasXml.sidecar(estado));
    return { archivos: { xml: sitio.xml, json: sitio.json } };
}

/**
 * Reescribe el XML de una sesión desde su sidecar, sin releer nada.
 *
 * Es el otro botón, y la diferencia con «Regenerar» es la que hay entre el
 * texto y el formato. Regenerar vuelve a pasarle el audio a Whisper: arregla
 * una toma que salió con el modelo chico, tarda lo que tarda el modelo grande
 * por cada toma y necesita el WAV. Esto solo vuelve a escribir el archivo con
 * el molde de HOY: los marcadores en el clip maestro, el nombre con el número
 * de la toma, cualquier arreglo del XML que traiga una versión nueva. Tarda un
 * segundo, no toca el audio y no cambia una sola palabra de las notas.
 *
 * Existe porque el XML se escribe al grabar, y lo que se arregla después no
 * llega solo a las clases ya grabadas: sin esto, el editor tendría que volver a
 * grabarlas para ver el arreglo, que es imposible.
 *
 * **El sidecar es la fuente y el XML la copia**, y de ahí que esto siempre se
 * pueda hacer: en el sidecar está la hora del día de cada palabra y de cada
 * borde, y el XML son esos mismos datos en cuadros. Por eso reescribirlo no
 * puede perder nada — y por eso el sidecar también se reescribe, para que la
 * sesión quede entera con la forma de esta versión.
 */
function rehacerXml(json, enCurso) {
    const estado = leerSidecar(json);
    const sitio = workspace.sesionDelSidecar(json);
    if (estado.secuencia && estado.secuencia === enCurso) {
        throw new Error('Esa sesión se está grabando ahora: su XML se reescribe en cada cambio.');
    }
    workspace.writeAtomic(sitio.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(sitio.json, notasXml.sidecar(estado));
    return {
        tomas: vivo.tomasQueQuedan(estado).length,
        claquetas: (estado.claquetas || []).length,
        archivos: { xml: sitio.xml, json: sitio.json }
    };
}

/* ─── Reanudar ────────────────────────────────────────────────────────────
 *
 * Una sesión que quedó abierta —la app se fue al piso, o se cerró con la clase
 * andando— se puede retomar en el mismo XML en vez de empezar otro.
 *
 * **Es lo que protege el único invariante que importa acá**: que de una clase
 * salga UN XML con los tiempos cerrados de punta a punta. Con dos XML, el
 * editor tendría que sincronizar dos veces y correlacionar dos primeras
 * claquetas, que es justo el trabajo que esta app existe para ahorrarle.
 *
 * Lo que NO se puede mover es el cero: los marcadores ya escritos cuelgan de él
 * y el editor pudo haber sincronizado contra ellos. El audio nuevo entra como
 * OTRO WAV, en su offset contra ese mismo cero, y el hueco del medio queda
 * dicho por la diferencia entre los dos clips en A1 — que es la verdad: ahí no
 * se grabó nada.
 */

/**
 * Prepara una sesión abierta para volver a ponerla en curso.
 *
 * @param {string} json el sidecar de la sesión
 * @param {string} [enCurso] la secuencia que se está grabando ahora
 * @returns {{dir:string, ceroMs:number, estado:object}}
 */
function paraReanudar(json, enCurso) {
    const sitio = workspace.sesionDelSidecar(json);
    const estado = leerSidecar(json);

    if (estado.secuencia && estado.secuencia === enCurso) {
        throw new Error('Esa sesión ya se está grabando.');
    }
    if (estado.terminada) {
        throw new Error('Esa sesión ya se cerró. Reanudar es para las que quedaron ' +
            'abiertas: una cerrada tiene su XML completo, y seguir grabando en él ' +
            'movería marcadores que el editor pudo haber usado ya para sincronizar.');
    }
    if (estado.ceroMs == null) {
        throw new Error('Esa sesión no dice a qué hora empezó, así que no hay cero ' +
            'del que colgar los cuadros nuevos.');
    }

    // El WAV anterior tiene que quedar apuntado donde está HOY: es de ahí que
    // sale el clip de A1 y la relectura de sus tomas.
    const sesiones = (estado.sesiones || []).map(s => ({
        ...s,
        archivo: dondeQuedoElWav(sitio, s.archivo)
    }));

    return {
        dir: sitio.base,
        ceroMs: Number(estado.ceroMs),
        estado: {
            // Primero un estado nuevo entero y encima lo del sidecar: el sidecar
            // no guarda lo que vive solo en memoria (las palabras sueltas, lo
            // último oído), y sin esto una sesión reanudada tenía `sueltas`
            // indefinido y el ciclo de señales tiraba en cada pasada: nunca más
            // abría una toma, y la ventana que oía crecía sin techo.
            ...vivo.estadoNuevo({}),
            ...estado,
            sueltas: [],
            recientes: [],
            sesiones,
            // Los contadores siguen desde donde estaban: una toma nueva no puede
            // reusar el id de una vieja, y una claqueta nueva no puede llamarse
            // como una que ya está en el XML.
            proximaToma: (estado.tomas || []).reduce((n, t) => Math.max(n, t.id || 0), 0),
            proximaClaqueta: (estado.claquetas || []).length,
            ultimaPalabraMs: 0,
            ultimaSenal: {}
        }
    };
}

/* ─── Gestionar la carpeta: renombrar y borrar ────────────────────────────
 *
 * Las dos operaciones tocan tres archivos —el XML, el sidecar y el WAV— y la
 * gracia está en el orden, porque tres archivos no se pueden escribir de una.
 * **El sidecar es lo que hace visible a una sesión** (`sidecaresDe` busca su
 * sufijo y nada más), así que se lo deja para el final. Una operación cortada
 * por la mitad deja la sesión en la lista, entera o repetida, y nunca
 * desaparecida.
 */

/** Lee el sidecar de una sesión, o dice que ese archivo no es una sesión. */
function leerSidecar(json) {
    if (!String(json || '').endsWith(SUFIJO_SIDECAR)) {
        throw new Error('Eso no es el archivo de una sesión.');
    }
    try {
        return notasXml.estadoLeido(JSON.parse(fs.readFileSync(json, 'utf8'))) || {};
    } catch (e) {
        throw new Error('No pude leer esa sesión: su archivo de datos está roto.');
    }
}

/** Borra un archivo que puede no estar. @returns {boolean} si había algo que borrar */
function quitar(ruta) {
    try {
        fs.unlinkSync(ruta);
        return true;
    } catch (e) {
        return false; // ya no estaba, o nunca estuvo
    }
}

/** Los WAV de una sesión que están hoy en el disco. */
function audiosDe(sitio, estado) {
    const vistos = new Set();
    const salida = [];
    for (const s of estado.sesiones || []) {
        if (!s.archivo) continue;
        const donde = dondeQuedoElWav(sitio, s.archivo);
        if (vistos.has(donde) || !fs.existsSync(donde)) continue;
        vistos.add(donde);
        salida.push({ sesion: s, archivo: donde });
    }
    return salida;
}

/**
 * La hora de captura, que es lo único que un renombrado no toca.
 *
 * Es la hora de "Iniciar grabación" y el cero de todos los cuadros del XML.
 * Cambiarla no renombraría una sesión: le movería todos los marcadores.
 */
function horaDeCaptura(estado, nombre) {
    if (estado.ceroMs) return Number(estado.ceroMs);
    const leido = nombreDeSesion.leer(nombre);
    if (leido && leido.cuandoMs != null) return leido.cuandoMs;
    throw new Error('Esa sesión no dice a qué hora se grabó, así que renombrarla le ' +
        'inventaría una hora nueva.');
}

/**
 * Cómo se llamaría este WAV con la sesión renombrada.
 *
 * El audio se llama `<secuencia>-<n>.wav` (`captura.abrir`), así que renombrarlo
 * es cambiarle el prefijo y dejarle el resto: el `-1` de la cola distingue las
 * capturas de una sesión que se reanudó, y no es nuestro para tocarlo.
 *
 * @returns {string|null} null si el archivo no lleva nuestro nombre, y entonces
 *   no lo pusimos nosotros y no se toca.
 */
function wavRenombrado(ruta, viejo, nuevo) {
    const base = path.basename(ruta);
    const prefijo = workspace.safeName(viejo);
    if (!base.startsWith(prefijo)) return null;
    return path.join(path.dirname(ruta), workspace.safeName(nuevo) + base.slice(prefijo.length));
}

/**
 * Renombra una sesión: el curso, nunca la hora.
 *
 * **La que se está grabando no se renombra.** El motor tiene su nombre en
 * memoria y le escribe el XML en cada cambio: renombrarle los archivos por
 * debajo haría que la escritura siguiente los volviera a crear con el nombre
 * viejo, y la sesión quedaría partida en dos.
 *
 * **El orden es el que aguanta un corte.** Primero el audio, después el par
 * nuevo, y recién al final se borra el par viejo. En ningún momento hay un
 * sidecar apuntando a un XML que ya no se llama así.
 *
 * @param {string} json el sidecar de la sesión
 * @param {object} cambio { curso }
 * @param {string} [enCurso] la secuencia que se está grabando ahora
 */
function renombrar(json, cambio, enCurso) {
    const c = cambio || {};
    const sitio = workspace.sesionDelSidecar(json);
    const estado = leerSidecar(json);

    if (estado.secuencia && estado.secuencia === enCurso) {
        throw new Error('Esa sesión se está grabando ahora. Terminala para renombrarla.');
    }
    if (c.curso != null && !String(c.curso).trim()) {
        throw new Error('El nombre del curso no puede quedar vacío.');
    }

    const cuandoMs = horaDeCaptura(estado, sitio.nombre);
    const curso = c.curso != null
        ? String(c.curso)
        : (estado.curso || (nombreDeSesion.leer(sitio.nombre) || {}).curso || '');

    const nombre = nombreDeSesion.armar({ curso, cuandoMs });
    const archivos = { xml: sitio.xml, json: sitio.json };
    // El mismo nombre no es un error: se llega acá corrigiendo una tilde que el
    // nombre de archivo ya no distinguía. Se contesta que no se movió nada, en
    // vez de escribir dos archivos encima de sí mismos.
    if (nombre === sitio.nombre) return { secuencia: nombre, archivos, movida: false, audios: 0 };

    const destino = workspace.archivosDeSesion(sitio.base, workspace.safeName(nombre));
    for (const ruta of [destino.xml, destino.json]) {
        if (!workspace.dentroDe(sitio.base, ruta)) {
            throw new Error('Ese nombre se sale de la carpeta.');
        }
        if (fs.existsSync(ruta)) {
            throw new Error(`Ya hay una sesión llamada «${nombre}» en esa carpeta.`);
        }
    }

    const movidos = [];
    try {
        for (const wav of audiosDe(sitio, estado)) {
            const nuevo = wavRenombrado(wav.archivo, sitio.nombre, nombre);
            if (!nuevo || fs.existsSync(nuevo)) continue;
            if (!workspace.dentroDe(sitio.base, nuevo)) {
                throw new Error('Ese nombre se sale de la carpeta.');
            }
            fs.renameSync(wav.archivo, nuevo);
            movidos.push([wav.archivo, nuevo]);
            // El sidecar que se va a escribir tiene que decir dónde está el
            // audio AHORA: es de donde sale el clip de A1 y "Regenerar".
            wav.sesion.archivo = nuevo;
        }

        estado.secuencia = nombre;
        estado.curso = curso;

        workspace.writeAtomic(destino.xml, notasXml.xmlDeNotas(estado));
        workspace.writeJson(destino.json, notasXml.sidecar(estado));
    } catch (err) {
        // Lo que se llegó a hacer se deshace, y la sesión queda exactamente como
        // estaba. Es lo que convierte tres escrituras sueltas en una operación:
        // sin esto, un disco lleno a mitad de camino dejaba el audio con el
        // nombre nuevo y el sidecar con el viejo, o sea la sesión sin audio.
        for (const [de, a] of movidos.reverse()) {
            try { fs.renameSync(a, de); } catch (e) { /* se hizo lo que se pudo */ }
        }
        quitar(destino.xml);
        quitar(destino.json);
        throw err;
    }

    // Y recién con el par nuevo entero en el disco se va el viejo. El sidecar
    // primero: es el que hace visible a la sesión, así que la repetida dura lo
    // que tarda un `unlink`, y el XML que queda suelto no lo lista nadie.
    quitar(sitio.json);
    quitar(sitio.xml);

    return { secuencia: nombre, archivos: destino, movida: true, audios: movidos.length };
}

/**
 * Borra una sesión: el XML, el sidecar y el audio.
 *
 * **Borra de verdad y no manda a la papelera.** El audio de una clase de tres
 * horas son cientos de megas y lo que el editor quiere al apretar esto es que
 * dejen de estar. La confirmación es de la pantalla, no de acá: este es el
 * gesto ya decidido.
 *
 * **Lo que falte no es un error.** Se llega a borrar una sesión justamente
 * cuando quedó mal, y plantarse en el primer archivo ausente dejaría los otros
 * dos ahí, sin forma de sacarlos desde la app.
 *
 * @param {string} json el sidecar de la sesión
 * @param {string} [enCurso] la secuencia que se está grabando ahora
 */
function borrar(json, enCurso) {
    const sitio = workspace.sesionDelSidecar(json);
    const estado = leerSidecar(json);

    if (estado.secuencia && estado.secuencia === enCurso) {
        throw new Error('Esa sesión se está grabando ahora. Terminala para borrarla.');
    }

    let audios = 0;
    for (const wav of audiosDe(sitio, estado)) {
        // Un sidecar puede traer la ruta que tenía el WAV en otra máquina o en
        // otra carpeta. Se borra lo que esté adentro de esta carpeta y nada
        // más: acá se está borrando de verdad.
        if (!workspace.dentroDe(sitio.base, wav.archivo)) continue;
        if (quitar(wav.archivo)) audios++;
    }

    const xml = quitar(sitio.xml);
    const sidecar = quitar(sitio.json);
    return { secuencia: estado.secuencia || sitio.nombre, xml, sidecar, audios };
}

module.exports = {
    SUFIJO_SIDECAR,
    listar,
    sidecaresDe,
    resumirParaLaLista,
    regenerar,
    rehacerXml,
    dondeQuedoElWav,
    editarGrabada,
    paraReanudar,
    renombrar,
    borrar
};
