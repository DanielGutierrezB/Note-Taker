'use strict';
/**
 * reparto-video.js — De qué instante de qué archivo sale cada trozo del vídeo
 * semanal.
 *
 * Es la mitad pura del corte: las tomas con sus bordes, los dos relojes —el del
 * audio, donde nacen los bordes, y el de pared, donde viven los vídeos— y qué
 * fuente es el fondo de cada toma, cuál va encima y de dónde sale el audio.
 * Ningún archivo, ningún proceso: es lo que deja probar el reparto sin un solo
 * vídeo delante, y es la mitad donde un error no se ve hasta que alguien abre
 * el MP4 y encuentra el corte encima de una palabra.
 *
 * La otra mitad, la que se lo pide a ffmpeg, es `exportar-video.js`.
 */

const vivo = require('./notas-vivo');
const ajustar = require('./ajustar-corte');
const videoCrudo = require('./video-crudo');

/** Una toma más corta que esto no es una toma: no entra. */
const MINIMO_SEC = 0.2;

/**
 * Las tomas que van al vídeo, en orden y con los bordes ya ajustados.
 *
 * Son las mismas que van al XML y por la misma puerta (`tomasQueQuedan` deja
 * fuera las descartadas y las que no tienen OUT), con los bordes corridos al
 * silencio. Sin esto, cada corte caería encima de una palabra.
 */
function tomasDe(crudas) {
    return (crudas || [])
        .slice()
        .sort((a, b) => a.inMs - b.inMs)
        .map(t => ({
            id: t.id,
            vista: t.vista || vivo.VISTA_POR_DEFECTO,
            desdeMs: ajustar.inAjustado(t),
            hastaMs: ajustar.outAjustado(t)
        }))
        .filter(t => t.hastaMs - t.desdeMs >= MINIMO_SEC * 1000);
}

/**
 * Qué fuente manda en una toma, según su vista.
 *
 * Es el mismo `viewMap` de todo el pipeline (`MAPA_DE_VISTAS` en
 * `notas-vivo.js`): PV se ve con la cámara, R y S con la pantalla. Acá no se
 * inventa una tabla nueva porque sería una segunda verdad sobre lo mismo, y el
 * día que alguien agregue una vista quedaría la mitad sin enterarse.
 */
function mandaLaCamara(vista) {
    return vivo.MAPA_DE_VISTAS[vivo.vistaLeida(vista || '')] === vivo.CAMARA;
}

/**
 * Cuánto se aparta el reloj del WAV del reloj de pared, medido en el propio WAV.
 *
 * **Son dos relojes distintos y hay que cruzarlos.** Los bordes de una toma
 * viven en el reloj del audio —`notas-vivo` los pone donde llegó el WAV— y los
 * vídeos viven en el reloj de pared, que es la hora a la que la ventana llamó a
 * `start()`. Si el dispositivo entrega más o menos muestras por segundo de las
 * que declara, los dos relojes se separan y el corte del vídeo se desliza: el
 * motor ya vigila esa deriva mientras graba (`vigilarDeriva` en `grabacion.js`),
 * y acá hay que deshacerla.
 *
 * El factor sale de los dos datos que el propio WAV guarda: cuánto duró según
 * el reloj de pared (`hastaMs - desdeMs`) y cuánto audio escribió (`segundos`).
 * Con un micrófono normal da 1,000 y esto no hace nada. Lo encontró la corrida
 * de punta a punta (`tools/semanal-de-punta-a-punta.js`) con la cámara y el
 * micrófono falsos de Chromium, que escriben audio a 1,88x: sin corregir, la
 * segunda toma caía fuera del vídeo y el corte la descartaba.
 *
 * Se recorta a un rango sensato: un factor de 3 no es una deriva, es un sidecar
 * roto, y con uno así es mejor cortar donde dicen las tomas —aunque esté
 * corrido— que donde diga una cuenta absurda.
 */
const DERIVA_MINIMA = 0.5;
const DERIVA_MAXIMA = 2;

function derivaDe(wav) {
    if (!wav || wav.desdeMs == null || wav.hastaMs == null || !(wav.segundos > 0)) return 1;
    const factor = (wav.hastaMs - wav.desdeMs) / (wav.segundos * 1000);
    if (!(factor > 0)) return 1;
    return Math.max(DERIVA_MINIMA, Math.min(DERIVA_MAXIMA, factor));
}

/**
 * Un instante de una toma, llevado al reloj de pared de los vídeos.
 *
 * Con el factor en 1 —lo normal— devuelve el mismo número que entró.
 */
function aPared(ms, wav) {
    if (!wav || wav.desdeMs == null) return ms;
    return wav.desdeMs + (ms - wav.desdeMs) * derivaDe(wav);
}

/** Y de vuelta: de la pared al reloj del audio, para recortar en los dos a la vez. */
function alAudio(ms, wav) {
    if (!wav || wav.desdeMs == null) return ms;
    return wav.desdeMs + (ms - wav.desdeMs) / derivaDe(wav);
}

/**
 * La toma recortada a un tramo del reloj de pared, en los DOS relojes.
 *
 * **Antes esto no existía y la toma se perdía entera.** Una toma que se salía
 * del metraje aunque fuera por un instante no tenía fondo, y el reparto la
 * dejaba fuera con un aviso. Pasó de verdad, y costó un vídeo: catorce
 * segundos hablados desaparecieron porque el último segundo y medio no tenía
 * imagen. El aviso estaba, pero un aviso no es lo mismo que el vídeo.
 *
 * Y no es un caso raro, es estructural. Al terminar, los vídeos se cierran
 * ANTES que el audio (ver `terminar` en `pantalla-semanal.js`), así que una
 * toma que siga abierta al apretar Terminar SIEMPRE termina un poco después
 * del último fotograma. Lo normal es que sean milisegundos y no se note; con
 * el audio atrasado —que es cuando el reloj se estira— son segundos.
 *
 * Se recorta en los dos relojes y con la misma cuenta al revés, porque si el
 * vídeo se recorta y el audio no, lo que sale está desfasado, que es peor que
 * corto.
 *
 * @param {object} tramos lo que devuelve `enLosDosRelojes`
 * @param {{desdeMs, hastaMs}|null} tramo dónde hay imagen; sin tramo, nada
 * @returns {{wav, enElAudio, enLaPared, recortadoMs}|null} `null` si no queda
 *   una toma
 */
function recortarA(tramos, tramo) {
    const { wav, enElAudio: toma, enLaPared } = tramos;
    if (!tramo) return { ...tramos, recortadoMs: 0 };
    const desdeMs = Math.max(enLaPared.desdeMs, tramo.desdeMs);
    const hastaMs = Math.min(enLaPared.hastaMs, tramo.hastaMs);
    const recortadoMs = (desdeMs - enLaPared.desdeMs) + (enLaPared.hastaMs - hastaMs);
    if (recortadoMs <= 0) return { ...tramos, recortadoMs: 0 };
    // Lo que queda tiene que ser una toma y no un fotograma suelto: por debajo
    // del mínimo que ya usa `tomasDe`, recortar sería fingir que se salvó algo.
    if (hastaMs - desdeMs < MINIMO_SEC * 1000) return null;
    return {
        wav,
        enElAudio: { ...toma, desdeMs: alAudio(desdeMs, wav), hastaMs: alAudio(hastaMs, wav) },
        enLaPared: { id: toma.id, desdeMs, hastaMs },
        recortadoMs
    };
}

/** Donde hay los dos tramos a la vez, o `null` si no se tocan. */
function cruce(a, b) {
    if (!a || !b) return null;
    const desdeMs = Math.max(a.desdeMs, b.desdeMs);
    const hastaMs = Math.min(a.hastaMs, b.hastaMs);
    return desdeMs < hastaMs ? { desdeMs, hastaMs } : null;
}

/**
 * Cuánto más se le puede recortar a una toma para que salga con su plano.
 *
 * Al apretar Terminar la cámara y la pantalla se cierran por separado y no en
 * el mismo milisegundo. Recortando solo a donde hay ALGO, una toma de pantalla
 * que terminaba en esos milisegundos llegaba a la cámara y no a la pantalla: se
 * quedaba sin su fondo y salía con la cámara a pantalla completa, convertida en
 * una toma de profesor por 50 ms. Por eso primero se prueba recortar a donde
 * está el plano entero.
 *
 * Pero con un tope. Si la cámara se cortó a los diez segundos y la pantalla
 * siguió, el plano entero de una toma de pantalla está solo hasta los diez:
 * conservar la esquina costaría segundos de clase de una toma que no se salía
 * de nada. Un segundo cubre de sobra lo que separa los dos cierres, y por
 * encima de eso es mejor la toma entera con la falta avisada.
 */
const RECORTE_POR_EL_PLANO_MS = 1000;

/**
 * La toma recortada a lo que hay: con su plano entero si cuesta poco, y si no
 * con lo mínimo (ver `RECORTE_POR_EL_PLANO_MS`).
 *
 * @returns {object|null} como `recortarA`; `null` si no queda nada
 */
function recortarALoQueHay(tramos, vista, camara, pantallas) {
    const deCamara = videoCrudo.tramoGrabado([camara]);
    const dePantalla = videoCrudo.tramoGrabado(pantallas);
    const minimo = recortarA(tramos, videoCrudo.tramoGrabado([camara, ...pantallas]));
    if (!minimo) return null;
    const conSuPlano = mandaLaCamara(vista) ? [deCamara] : [cruce(dePantalla, deCamara), dePantalla];
    for (const tramo of conSuPlano) {
        if (!tramo) continue;
        const recorte = recortarA(tramos, tramo);
        if (recorte && recorte.recortadoMs - minimo.recortadoMs <= RECORTE_POR_EL_PLANO_MS) return recorte;
    }
    return minimo;
}

const fueraDeLoGrabado = id => `La toma ${id} queda fuera de lo que se grabó: no entra en el vídeo.`;

/**
 * Una toma, con sus dos tramos: el del reloj del audio y el del de pared.
 *
 * Los bordes nacen en el reloj del audio y los vídeos viven en el de pared, así
 * que todo lo que vaya a buscar algo dentro de un vídeo tiene que pasar por
 * acá. Es una función y no dos líneas repetidas porque la usan el reparto del
 * corte y el montaje que se mira, y que las dos crucen el reloj de la misma
 * manera es justamente lo que hace que lo que se mira sea lo que sale.
 */
function enLosDosRelojes(toma, wavs) {
    const wav = ajustar.elWavDe(wavs, toma.desdeMs, toma.hastaMs);
    return {
        wav,
        enElAudio: toma,
        enLaPared: {
            id: toma.id,
            desdeMs: aPared(toma.desdeMs, wav),
            hastaMs: aPared(toma.hastaMs, wav)
        }
    };
}

/**
 * De qué archivo sale cada pedazo de cada toma.
 *
 * Un trozo es una toma ya resuelta: qué entrada es el fondo, qué entrada va
 * encima (si alguna) y de dónde sale el audio, cada una con su instante dentro
 * de SU archivo. Que esto sea una función aparte es lo que deja probar el
 * reparto sin tener un solo vídeo delante.
 *
 * **Lo manda la vista de la toma.** Una toma de profesor (`PV`) es la cámara
 * sola a pantalla completa —es el plano de hablar a cámara, y meterle la
 * pantalla en una esquina sería meterle ruido—; cualquier otra es la pantalla
 * de fondo con la cámara en la esquina. Es la misma vista que el modo clase
 * manda al XML, así que una persona que elige «yo» en la pantalla de revisión y
 * un editor que pone `PV` en Premiere están diciendo lo mismo.
 *
 * Reglas, todas por el mismo motivo —que un trozo no puede salir a medias—:
 *   · el fondo es la fuente que pide la vista, y si esa no cubre la toma
 *     entera, la otra;
 *   · la cámara va encima solo si no es ya el fondo y cubre la toma entera: una
 *     cámara que se corta a mitad de trozo dejaría el trozo cortado también
 *     (`overlay` termina con la más corta);
 *   · el audio es el de la cámara si lo tiene y cubre, y si no el del WAV.
 *
 * @param {object} p { tomas, pantallas, camara, camaraConAudio, wavs } —
 *   `pantallas` son los tramos, del más viejo al más nuevo; se acepta
 *   `pantalla` suelta porque es lo que había cuando la pantalla era una sola
 * @returns {{trozos:object[], avisos:string[]}}
 */
function repartir(p) {
    const { tomas, camara, wavs } = p;
    // La pantalla puede ser varios archivos: cambiar de ventana mientras se
    // graba cierra uno y abre el siguiente. Cuál le toca a cada toma lo decide
    // la hora, abajo, y no hay una «la pantalla» para toda la sesión.
    const pantallas = p.pantallas || (p.pantalla ? [p.pantalla] : []);
    const avisos = [];
    const trozos = [];

    // Si el audio y el reloj de pared se separaron, se dice una vez y no una
    // por toma: es una propiedad de la grabación, no de cada corte.
    for (const w of wavs || []) {
        const factor = derivaDe(w);
        if (Math.abs(factor - 1) > 0.01) {
            avisos.push(`El audio se grabó a ${factor.toFixed(2)}x del reloj: los cortes se `
                + 'corrigieron con esa medida.');
        }
    }

    for (const toma of tomas) {
        // Una toma que se pase de la imagen se recorta a lo que hay en vez de
        // perderse: ver `recortarALoQueHay`.
        const cabe = recortarALoQueHay(enLosDosRelojes(toma, wavs), toma.vista, camara, pantallas);
        if (!cabe) {
            avisos.push(fueraDeLoGrabado(toma.id));
            continue;
        }
        const { wav, enElAudio, enLaPared, recortadoMs } = cabe;
        if (recortadoMs > 0) {
            avisos.push(`A la toma ${toma.id} le faltaba imagen en el borde: se le recortaron `
                + `${conComa(tres(recortadoMs / 1000))} s y el resto entra entero.`);
        }

        const cubre = v => v && videoCrudo.cubre(v, enLaPared.desdeMs) && videoCrudo.cubre(v, enLaPared.hastaMs);

        // Los dos fondos posibles, cada uno con sus pedazos. La cámara es
        // siempre uno solo: no se la puede cambiar sin parar. La pantalla puede
        // ser varios, con negro en los cambios de ventana (ver `conNegro`).
        const deCamara = cubre(camara) ? [{ video: camara, ...enLaPared }] : null;
        const dePantalla = conNegro(pantallas, enLaPared);

        // La que pide la vista primero, y la otra como repuesto: una toma que
        // pedía la cámara y no la tiene sale con la pantalla, que es mucho
        // mejor que no salir.
        const quiereCamara = mandaLaCamara(toma.vista);
        const pedida = quiereCamara ? deCamara : dePantalla;
        const fondo = pedida || (quiereCamara ? dePantalla : deCamara);
        if (!fondo) {
            avisos.push(fueraDeLoGrabado(toma.id));
            continue;
        }
        if (!pedida) {
            avisos.push(`La toma ${toma.id} pedía ${quiereCamara ? 'tu cámara' : 'tu pantalla'} `
                + 'y ese trozo no está grabado: va con la otra fuente.');
        }
        const esCamara = fondo === deCamara;
        const negroSeg = fondo.reduce((s, x) => s + (x.negro ? (x.hastaMs - x.desdeMs) / 1000 : 0), 0);
        if (negroSeg > 0) {
            avisos.push(`La toma ${toma.id} tiene un cambio de ventana en el medio: `
                + `${conComa(tres(negroSeg))} s en negro mientras entra la otra.`);
        }
        // Encima solo cuando el fondo es la pantalla. Una toma de profesor es la
        // cámara sola: no hay nada que superponerle.
        const encima = !esCamara && cubre(camara) ? camara : null;
        if (!encima && !esCamara) {
            avisos.push(`La toma ${toma.id} va sin la cámara en la esquina: ese trozo no está grabado.`);
        }

        const audio = p.camaraConAudio && cubre(camara)
            ? { archivo: camara, tramo: enLaPared }
            : (wav ? { archivo: wav, tramo: enElAudio } : null);
        if (!audio) {
            avisos.push(`La toma ${toma.id} no tiene audio grabado: no entra en el vídeo.`);
            continue;
        }

        // Los pedazos del fondo, ya en segundos dentro de su archivo. El
        // primero nunca es negro —`conNegro` lo exige—, así que sirve para
        // decir de qué fuente es el fondo sin tener que mirar la lista.
        const pedazos = fondo.map(x => (x.negro
            ? { cual: 'negro', segundos: tres((x.hastaMs - x.desdeMs) / 1000) }
            : enArchivo(x.video, x)));

        trozos.push({
            toma: toma.id,
            vista: toma.vista,
            // Lo que va a durar el trozo lo manda el vídeo, que es la imagen: el
            // audio se recorta al mismo largo y `concat` no admite discrepancias.
            segundos: (enLaPared.hastaMs - enLaPared.desdeMs) / 1000,
            // El primer pedazo arriba y la lista aparte: casi todas las tomas
            // tienen uno solo, y quien no sepa de pedazos —el reproductor
            // cuando el plan es de antes— sigue leyendo `ruta` y `desdeSec`.
            fondo: { ...pedazos[0], partes: pedazos },
            encima: encima ? enArchivo(encima, enLaPared) : null,
            audio: enArchivo(audio.archivo, audio.tramo)
        });
    }
    return { trozos, avisos };
}

/**
 * La pantalla de una toma, en pedazos, con negro donde cambió de ventana.
 *
 * **La toma mantiene su vista aunque la pantalla se haya partido.** Antes acá
 * se pedía un tramo solo que cubriera la toma entera, y una toma a caballo
 * entre dos ventanas se caía al repuesto: salía con la cámara a pantalla
 * completa, o sea convertida en una toma de profesor sin que nadie lo pidiera.
 * Un cambio de ventana son milisegundos y costaba la vista de la toma entera.
 *
 * Ahora el hueco se rellena con negro y la vista se queda: se ve la ventana de
 * antes, un parpadeo en negro mientras entra la otra, y la ventana nueva. El
 * audio no se parte —sale del WAV o de la cámara, que cubren la toma entera—,
 * así que la persona se sigue oyendo durante el negro y se lee como un corte.
 *
 * **Lo que no se rellena son los bordes.** Si la pantalla no estaba grabando
 * cuando la toma empezó, o ya no estaba cuando terminó, esto devuelve `null` y
 * la toma se va al repuesto como siempre. La diferencia no es de cuánto dura
 * sino de qué es: un hueco en el medio es un cambio de ventana, y por como se
 * hace el cambio (ver `cambiarPantalla` en `src/js/grabar/filmar.js`, que pide
 * la ventana nueva antes de soltar la vieja) dura lo que tarda el relevo. Un
 * hueco en el borde es metraje que no existe, y de eso el negro no salva.
 *
 * @returns {object[]|null} pedazos `{video, desdeMs, hastaMs}` o
 *   `{negro:true, desdeMs, hastaMs}`, en orden y sin solaparse; el primero
 *   nunca es negro. `null` si la pantalla no sirve de fondo para esta toma.
 */
function conNegro(pantallas, ventana) {
    const partes = [];
    let reloj = ventana.desdeMs;
    for (const v of pantallas || []) {
        const fin = videoCrudo.finDe(v);
        if (fin <= reloj) continue;
        if (v.empezoMs >= ventana.hastaMs) break;
        if (v.empezoMs > reloj) {
            const hastaElHueco = Math.min(v.empezoMs, ventana.hastaMs);
            partes.push({ negro: true, desdeMs: reloj, hastaMs: hastaElHueco });
            reloj = hastaElHueco;
        }
        const hasta = Math.min(fin, ventana.hastaMs);
        if (hasta > reloj) {
            partes.push({ video: v, desdeMs: reloj, hastaMs: hasta });
            reloj = hasta;
        }
        if (reloj >= ventana.hastaMs) break;
    }
    // Un negro de entrada es la pantalla que todavía no estaba, y no llegar al
    // final es la que ya no está: las dos son borde, no cambio de ventana.
    if (!partes.length || partes[0].negro || reloj < ventana.hastaMs) return null;
    return partes;
}

/**
 * Dónde cae una toma adentro de un archivo.
 *
 * El WAV guarda su arranque en `desdeMs` y los vídeos en `empezoMs`; los dos
 * son la hora del día del primer dato del archivo, que es lo que alinea los
 * tres relojes. Esta es la única cuenta del módulo que puede correr el corte
 * entero, y por eso está en un sitio y no en tres.
 */
function enArchivo(archivo, toma) {
    const arranque = archivo.empezoMs != null ? archivo.empezoMs : archivo.desdeMs;
    return {
        // Cuál de las tres fuentes es. Lo trae `video-crudo` en cada vídeo desde
        // que se graba, y tirarlo acá obligaba a adivinarlo después comparando
        // rutas; el WAV no lo tiene porque no es un vídeo.
        cual: archivo.cual || 'wav',
        ruta: archivo.ruta || archivo.archivo,
        desdeSec: Math.max(0, (toma.desdeMs - arranque) / 1000),
        hastaSec: Math.max(0, (toma.hastaMs - arranque) / 1000)
    };
}

const tres = n => Math.round(n * 1000) / 1000;

/** Con coma decimal, que es como se escribe un número en castellano. */
const conComa = n => String(n).replace('.', ',');

/**
 * Lo que dura una lista de tomas en el reloj de PARED.
 *
 * El único reloj que se le puede enseñar a nadie. Los bordes de una toma viven
 * en el del audio, y si el micrófono escribió a otra velocidad —el falso de
 * Chromium va a 0,51x— restar ahí da un número que no se parece a nada de lo
 * que la persona va a ver pasar en el reproductor.
 *
 * Está acá, al lado de `aPared` y `enLosDosRelojes`, y no dentro de quien la
 * usa: es la cuenta más sensible al reloj de todo el módulo, y estaba metida en
 * un `if` dentro de otro `if` dentro del exportador, donde no se podía probar y
 * donde nadie que viniera a auditar los relojes la iba a encontrar.
 */
function duracionEnPared(tomas, wavs) {
    return (tomas || []).reduce((suma, t) => {
        const { enLaPared } = enLosDosRelojes(t, wavs);
        return suma + enLaPared.hastaMs - enLaPared.desdeMs;
    }, 0);
}

module.exports = {
    MINIMO_SEC,
    DERIVA_MINIMA,
    DERIVA_MAXIMA,
    RECORTE_POR_EL_PLANO_MS,
    tomasDe,
    mandaLaCamara,
    derivaDe,
    aPared,
    enLosDosRelojes,
    repartir,
    duracionEnPared,
    tres,
    conComa
};
