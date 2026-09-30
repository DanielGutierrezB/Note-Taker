'use strict';
/**
 * ajustar-corte.js — Que el corte caiga entre palabras y no encima de una.
 *
 * El IN y el OUT de cada toma salen de las marcas de palabra de Whisper, y esas
 * marcas no son milimétricas: el modelo pone el final de una palabra una o dos
 * décimas antes o después de donde de verdad terminó. En el XML eso no se nota,
 * pero en Premiere sí: el montajista corta por el marcador y el corte parte la
 * palabra por la mitad. Medido sobre las dos clases que había en el disco: de
 * los 72 bordes de la del 29/09 (dos horas y media, 36 tomas), 58 caían sobre
 * energía de voz clara —varios en −15 dBFS, o sea el medio de una sílaba—.
 * Ninguno de esos 58 se puede cortar donde está. Con esto quedan 8, y los 8 son
 * los que no tienen ningún silencio cerca.
 *
 * Lo que hace este archivo es mirar la ONDA, que es el único dato que no se
 * puede inventar, y correr el borde al silencio más cercano. Nada más: no
 * decide qué es una toma (eso es `notas-vivo.js`) ni cómo se escribe el XML (eso
 * es `notas-xml.js`). Recibe un tiempo y contesta otro, o el mismo.
 *
 * ── Por qué el umbral se estima acá, y no se le pide a `sonido.js` ────────
 *
 * Los dos aprenden el piso de la sala en vez de plantar un número fijo, pero no
 * contestan la misma pregunta y por eso no comparten el corte. Allá la pregunta
 * es binaria y por palabra —¿sonó ALGO alrededor de esto, o lo inventó
 * Whisper?—, y se responde con un piso que se sigue sobre la marcha y un margen
 * ancho a propósito, +24 dB, que es el que separa lo dicho de lo inventado. Acá
 * la pregunta es más fina y es del archivo entero: ¿dónde está el hueco ENTRE
 * dos palabras? Con el +24 de allá, en la clase del 30/09 el corte caería en
 * −43 y no en −54, once dB por encima del valle del histograma: una frase dicha
 * bajito contaría como hueco y el OUT podría caer justo en medio de ella.
 *
 * Y un número fijo tampoco sirve, para ninguno de los dos. Medido en esa misma
 * clase, con AirPods por Bluetooth: el piso de ruido está en −67 dBFS y hay un
 * 17 % del material entre −60 y −55, que es ruido de sala y no voz. Con −60
 * como umbral, ese 17 % contaría como voz y casi ningún hueco calificaría. Con
 * otro micrófono el piso se mueve diez dB y el número elegido a mano quedaría
 * mal para el otro lado.
 *
 * Así que el umbral se ESTIMA por sesión, de la distribución del propio archivo:
 * el piso es el percentil 10 de todo, la voz el 90 de lo que suena por encima de
 * él, y el silencio es lo que está en el primer tercio de ese recorrido
 * (`umbralDe`). En esa clase da −54 dBFS, que es justo el valle del histograma
 * —la franja de −55 a −45 tiene tres veces menos material que la de −65 a −60—,
 * o sea el hueco natural entre "sala" y "voz". Y el resultado no es frágil:
 * barriendo el umbral a mano entre el piso+9 y el piso+20 sobre los 72 bordes
 * reales, la cuenta de cortes rescatados no se mueve.
 *
 * ── Por qué el IN y el OUT no se tratan igual ─────────────────────────────
 *
 * Un IN quiere caer justo ANTES de que empiece a sonar la voz y un OUT justo
 * DESPUÉS de que termine. No son el mismo gesto: si el borde cayó en mitad de una
 * palabra, correr el IN hacia atrás deja esa palabra adentro de la toma y
 * correrlo hacia adelante la tira; con el OUT pasa lo mismo al revés. Una
 * dirección agrega silencio y la otra pierde algo que el profesor dijo. De ahí
 * las tres asimetrías: la ventana tiene cien milisegundos más del lado bueno, el
 * hueco de ese lado gana aunque esté una vez y media más lejos, y dentro del
 * hueco elegido el IN se pega a su final y el OUT a su principio, los dos con una
 * guarda para no lamer el ataque ni la cola.
 *
 * ── Qué NO se ajusta, y por qué ───────────────────────────────────────────
 *
 * Solo los bordes de las tomas, que son lo único por lo que alguien corta. Las
 * claquetas no: un marcador de claqueta señala un golpe, y correrlo al silencio
 * de al lado rompe exactamente lo que el marcador existe para hacer, que es
 * correlacionar el aplauso con el de las cámaras. Los comentarios sobre el texto
 * tampoco: señalan una frase para leerla, no un corte, y moverlos los dejaría
 * apuntando a otra palabra que la que el editor escribió.
 */

const fs = require('fs');

const sonido = require('./sonido');

/** El mismo salto de 20 ms que `sonido.js`, para que los dB sean comparables. */
const HOP_SEC = sonido.HOP_SEC;

/**
 * Cuánto se busca a cada lado, en segundos.
 *
 * Seiscientos milisegundos de ventana y no más. Una sílaba dura entre 150 y 250
 * ms y el hueco entre dos palabras seguidas entre 100 y 300: con tres décimas
 * alcanza para llegar al hueco de al lado y no alcanza para saltar por encima de
 * una palabra entera y aterrizar en otro punto del discurso, que es el error que
 * no se puede cometer. Un corte movido medio segundo sigue siendo el mismo
 * corte; movido dos segundos es otro corte, y el editor no pidió eso.
 *
 * Trescientos es además el codo de la curva, barriendo el tamaño sobre los 72
 * bordes reales del 29/09: con ±150 quedaban 27 cortes sobre voz, con ±200
 * quedaban 16 y con ±300 quedan 7. De ahí en adelante se paga mucho por poco
 * —±500 baja a 4 y ±800 a 3, con el corte moviéndose hasta tres cuartos de
 * segundo—, y ese poco son justamente los cortes en mitad de un párrafo seguido,
 * donde el silencio más cercano ya es otro momento de la clase.
 *
 * El reparto es el que dice la asimetría de arriba: el IN mira más hacia atrás
 * y el OUT más hacia adelante.
 */
const VENTANA = {
    in: { atras: 0.35, adelante: 0.25 },
    out: { atras: 0.25, adelante: 0.35 }
};

/**
 * Cuánto tiene que durar un hueco para llamarse silencio.
 *
 * Ciento veinte milisegundos, y el número viene de la fonética, no del gusto:
 * una oclusiva —la /p/ de "papá", la /t/ de "toma"— tiene entre 50 y 100 ms de
 * silencio ADENTRO de la palabra, mientras los labios o la lengua están
 * cerrados. Un umbral de 40 ms encontraría esos huecos y cortaría en el medio de
 * una palabra creyendo que la respetaba, que es el bug que esto viene a
 * arreglar. Con 120 ms solo califican las pausas de verdad.
 */
const SILENCIO_MIN_SEC = 0.12;

/**
 * Cuánto se deja de aire entre el corte y la voz.
 *
 * Tres saltos. El silencio medido empieza y termina donde el RMS cruza el
 * umbral, y el ataque de una consonante sube desde abajo: pegar el corte exacto
 * al cruce le come los primeros milisegundos. Sesenta es poco para que se note
 * como aire y suficiente para que no se note como corte.
 */
const GUARDA_SEC = 0.06;

/**
 * Y cuánto aire hace falta como mínimo, cuando la ventana no deja los 60 ms.
 *
 * Cuarenta milisegundos, que es más de un cuadro a 30 (33 ms). El número sale de
 * ahí y no del oído: el XML no lleva segundos, lleva CUADROS, y `toFrames`
 * redondea. Un corte dejado a 10 ms del ataque de una palabra puede caer, ya
 * redondeado, 20 ms DENTRO de ella — y el editor vería otra vez el bug que esto
 * arregla, esta vez sin que el sidecar lo explique.
 */
const MARGEN_MINIMO_SEC = 0.04;

/**
 * Cuánto más lejos se acepta un silencio del lado que le conviene al borde.
 *
 * Los dos lados no cuestan lo mismo, y de ahí el número. Si el IN está en mitad
 * de la primera palabra de la toma, correrlo hacia ATRÁS deja la palabra adentro
 * y correrlo hacia adelante la tira; con el OUT y la última palabra pasa lo
 * mismo al revés. O sea: una dirección agrega silencio y la otra pierde algo que
 * el profesor dijo. Así que el hueco del lado bueno gana aunque esté una vez y
 * media más lejos, y el del otro lado solo gana si está claramente más cerca.
 */
const VENTAJA_DEL_LADO_BUENO = 1.5;

/**
 * Los percentiles con que se leen el piso y la voz.
 *
 * El piso es el 10 de TODO el archivo. La voz es el 90 de lo que suena por
 * encima del piso, y no el 95 de todo, que fue el primer intento y está mal: en
 * una clase donde el profesor habla un 3 % del tiempo —que es lo normal en una
 * sesión larga con pausas, y es exactamente lo que pasa en un WAV de prueba— el
 * percentil 95 del archivo entero sigue siendo ruido de sala, el contraste sale
 * en cero y no se ajustaría nada. Mirar solo lo que suena arregla eso y además
 * aguanta un golpe suelto, que un máximo no aguantaría.
 */
const PERCENTIL_PISO = 10;
const PERCENTIL_VOZ = 90;

/** Cuánto por encima del piso empieza a contar como "algo que suena". */
const SOBRE_EL_PISO_DB = 6;

/**
 * Dónde cae el umbral entre el piso y la voz: en el primer tercio.
 *
 * Con el piso en −67 y la voz en −24 da −54, que es el valle del histograma de
 * la clase medida. Un tercio y no la mitad porque la distribución no es
 * simétrica: el ruido de sala se apelotona justo encima del piso y la voz se
 * reparte en veinte dB, así que la frontera está más abajo del medio.
 */
const FRACCION_DEL_RANGO = 0.30;

/**
 * El techo de ese margen, en dB sobre el piso.
 *
 * Es el freno para una sesión muy fuerte: con la voz en −6 dBFS, un tercio del
 * recorrido pondría el umbral en −47 y empezaría a contar como silencio una
 * palabra dicha bajito. Quince dB sobre el piso de ruido no es voz en ningún
 * micrófono que se haya visto acá.
 */
const MARGEN_MAXIMO_DB = 15;

/**
 * Cuánto contraste hace falta para creerle al análisis.
 *
 * Si entre el piso y la voz hay menos de doce dB, ese archivo no tiene silencios
 * distinguibles —está saturado, o es puro ruido, o el micrófono tiene compresión
 * agresiva— y cualquier umbral que se ponga va a inventar huecos donde no hay.
 * En ese caso no se ajusta nada, que es el modo de fallar correcto: el tiempo
 * que el editor marcó queda tal cual.
 */
const CONTRASTE_MINIMO_DB = 12;

/** Cuánto se mira más allá de la ventana, para medir un hueco que la cruza. */
const CONTEXTO_SEC = 0.5;

/**
 * Hasta qué duración se analiza el archivo entero, y cómo se muestrea si es más
 * largo.
 *
 * Cinco minutos de WAV son 28 MB y se leen de una sin que se note. Más allá se
 * muestrea: 240 pedazos de 150 ms repartidos de punta a punta son 36 segundos de
 * audio y 1800 medidas, y de una clase de tres horas eso describe la
 * distribución igual de bien que leer los 850 MB.
 */
const ENTERO_HASTA_SEC = 300;
const MUESTRAS_DEL_PISO = 240;
const MUESTRA_SEC = 0.15;

/* ─── Leer un pedazo de WAV sin leer el WAV entero ─────────────────────────
 *
 * `sonido.niveles` lee el archivo completo y saca los dB de todo, que es lo
 * correcto para un recorte de quince segundos. Acá no sirve: el WAV de una clase
 * de tres horas pesa 850 MB, el XML se reescribe en cada cambio de la sesión, y
 * mientras se graba el archivo CRECE, así que ninguna caché del análisis entero
 * se sostiene. Un corte necesita medio segundo de audio alrededor; eso es lo que
 * se lee.
 */

/** La cabecera de un WAV PCM 16 bits mono, o null si no es uno que se entienda. */
function cabecera(fd, tamano) {
    const buf = Buffer.alloc(Math.min(tamano, 4096));
    if (buf.length < 44) return null;
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;

    let tasa = 0;
    let canales = 0;
    let bits = 0;
    let datosDesde = 0;
    let datosLargo = 0;
    for (let off = 12; off + 8 <= buf.length;) {
        const id = buf.toString('ascii', off, off + 4);
        const largo = buf.readUInt32LE(off + 4);
        const cuerpo = off + 8;
        if (id === 'fmt ' && cuerpo + 16 <= buf.length) {
            canales = buf.readUInt16LE(cuerpo + 2);
            tasa = buf.readUInt32LE(cuerpo + 4);
            bits = buf.readUInt16LE(cuerpo + 14);
        } else if (id === 'data') {
            datosDesde = cuerpo;
            // El largo declarado puede quedarse corto: la cabecera de una
            // captura en curso se reescribe cada tanto (`captura.js`), así que
            // manda lo que el archivo mide HOY.
            datosLargo = Math.min(largo, tamano - cuerpo);
            break;
        }
        off = cuerpo + largo + (largo % 2);
    }
    if (!datosDesde || bits !== 16 || canales !== 1 || !tasa) return null;
    return { tasa, datosDesde, muestras: Math.floor(datosLargo / 2) };
}

/** Abre un WAV para leerlo por pedazos. Quien llama cierra con `cerrar`. */
function abrir(archivo) {
    let fd;
    try {
        fd = fs.openSync(archivo, 'r');
    } catch (e) {
        return null;
    }
    try {
        const tamano = fs.fstatSync(fd).size;
        const cab = cabecera(fd, tamano);
        if (!cab) {
            fs.closeSync(fd);
            return null;
        }
        return { ...cab, fd, tamano, segundos: cab.muestras / cab.tasa };
    } catch (e) {
        try { fs.closeSync(fd); } catch (e2) { /* nada que cerrar */ }
        return null;
    }
}

function cerrar(w) {
    if (w && w.fd != null) {
        try { fs.closeSync(w.fd); } catch (e) { /* ya estaba cerrado */ }
    }
}

/**
 * Los dB de un tramo del WAV, con el mismo salto y la misma cuenta que
 * `sonido.niveles`: RMS del tramo, a dBFS, y −120 para el silencio digital.
 *
 * @returns {{desdeSec:number, hopSec:number, db:Float32Array}|null}
 */
function nivelesDeTramo(w, desdeSec, hastaSec) {
    const porHop = Math.max(1, Math.round(w.tasa * HOP_SEC));
    const hop = porHop / w.tasa;
    const primerHop = Math.max(0, Math.floor(desdeSec / hop));
    const ultimoHop = Math.min(Math.floor(w.muestras / porHop), Math.ceil(hastaSec / hop));
    if (ultimoHop <= primerHop) return null;

    const desdeMuestra = primerHop * porHop;
    const cuantas = (ultimoHop - primerHop) * porHop;
    const buf = Buffer.alloc(cuantas * 2);
    let leidos = 0;
    try {
        leidos = fs.readSync(w.fd, buf, 0, buf.length, w.datosDesde + desdeMuestra * 2);
    } catch (e) {
        return null;
    }
    const hops = Math.floor(leidos / 2 / porHop);
    if (hops <= 0) return null;

    const db = new Float32Array(hops);
    for (let h = 0; h < hops; h++) {
        let suma = 0;
        for (let i = h * porHop; i < (h + 1) * porHop; i++) {
            const v = buf.readInt16LE(i * 2) / 32768;
            suma += v * v;
        }
        const rms = Math.sqrt(suma / porHop);
        db[h] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    return { desdeSec: primerHop * hop, hopSec: hop, db };
}

/* ─── El umbral de silencio de esta sesión ─────────────────────────────────── */

function percentil(orden, p) {
    if (!orden.length) return -120;
    return orden[Math.min(orden.length - 1, Math.floor(p / 100 * orden.length))];
}

/**
 * El piso de ruido, la voz y el umbral de silencio de un WAV.
 *
 * @returns {{pisoDb:number, vozDb:number, umbralDb:number}|null} null cuando el
 *   archivo no tiene contraste para distinguir un silencio (ver
 *   `CONTRASTE_MINIMO_DB`)
 */
function umbralDe(w) {
    const total = w.muestras / w.tasa;
    if (total <= 0) return null;

    const todos = [];
    if (total <= ENTERO_HASTA_SEC) {
        const tramo = nivelesDeTramo(w, 0, total);
        if (tramo) for (const v of tramo.db) todos.push(v);
    } else {
        const paso = total / MUESTRAS_DEL_PISO;
        for (let i = 0; i < MUESTRAS_DEL_PISO; i++) {
            const desde = i * paso;
            const tramo = nivelesDeTramo(w, desde, Math.min(total, desde + MUESTRA_SEC));
            if (tramo) for (const v of tramo.db) todos.push(v);
        }
    }
    if (todos.length < 10) return null;

    todos.sort((a, b) => a - b);
    const pisoDb = percentil(todos, PERCENTIL_PISO);
    const fuertes = todos.filter(v => v > pisoDb + SOBRE_EL_PISO_DB);
    if (fuertes.length < 10) return null; // no suena nada: no hay voz que separar
    const vozDb = percentil(fuertes, PERCENTIL_VOZ);
    if (vozDb - pisoDb < CONTRASTE_MINIMO_DB) return null;
    const umbralDb = pisoDb + Math.min(MARGEN_MAXIMO_DB, (vozDb - pisoDb) * FRACCION_DEL_RANGO);
    return { pisoDb, vozDb, umbralDb };
}

/**
 * El umbral de un archivo, recordado.
 *
 * El piso de ruido de una sesión no cambia —es el micrófono y la sala—, así que
 * se mide una vez. Mientras se graba el archivo crece, y se vuelve a medir solo
 * cuando duplicó su tamaño: con lo escrito en los primeros minutos el piso ya
 * está bien estimado, y volver a medirlo en cada escritura del XML sería trabajo
 * tirado.
 */
const recordados = new Map();

function umbralRecordado(w, archivo) {
    const antes = recordados.get(archivo);
    if (antes && w.tamano < antes.tamano * 2) return antes.umbral;
    const umbral = umbralDe(w);
    recordados.set(archivo, { tamano: w.tamano, umbral });
    return umbral;
}

/** Se olvida de lo medido. Para las pruebas, que reescriben el mismo nombre. */
function olvidar() {
    recordados.clear();
}

/* ─── El núcleo: dónde debería caer este corte ─────────────────────────────── */

/** Los tramos seguidos por debajo del umbral que duran lo suficiente. */
function silencios(tramo, umbralDb) {
    const salida = [];
    let desde = -1;
    let suma = 0;
    const anotar = hasta => {
        const largo = (hasta - desde) * tramo.hopSec;
        if (largo >= SILENCIO_MIN_SEC) {
            salida.push({
                desde: tramo.desdeSec + desde * tramo.hopSec,
                hasta: tramo.desdeSec + hasta * tramo.hopSec,
                medio: suma / (hasta - desde)
            });
        }
    };
    for (let i = 0; i < tramo.db.length; i++) {
        if (tramo.db[i] <= umbralDb) {
            if (desde < 0) { desde = i; suma = 0; }
            suma += tramo.db[i];
        } else if (desde >= 0) {
            anotar(i);
            desde = -1;
        }
    }
    if (desde >= 0) anotar(tramo.db.length);
    return salida;
}

/**
 * El mejor instante para este corte, mirando la onda.
 *
 * Es la única función que decide algo, y es pura: recibe los dB de un tramo y
 * contesta un tiempo. Las pruebas la usan directo.
 *
 * @param {{desdeSec:number, hopSec:number, db:Float32Array}} tramo
 * @param {number} tSec el tiempo original, en segundos dentro del WAV
 * @param {number} umbralDb por debajo de esto no hay voz
 * @param {'in'|'out'} lado
 * @returns {{sec:number, porQue:string}} `sec` es `tSec` cuando no se mueve, y
 *   `porQue` dice por qué: `silencio` se movió, `ya-en-silencio` ya estaba bien,
 *   `sin-silencio` no había ningún hueco decente en la ventana.
 */
function mejorInstante(tramo, tSec, umbralDb, lado) {
    const v = VENTANA[lado] || VENTANA.in;
    const desdeVentana = tSec - v.atras;
    const hastaVentana = tSec + v.adelante;

    const huecos = silencios(tramo, umbralDb);

    // **El corte que ya cae en un silencio no se toca.** Es la mitad del valor
    // de esto: los bordes que estaban bien quedan idénticos, así que un XML
    // rehecho solo cambia en los cortes que estaban mal, y el antes/después se
    // puede leer. "Adentro" es con el margen puesto: un borde a 10 ms del ataque
    // está dentro del hueco y de todas formas hay que correrlo.
    const adentro = h => tSec >= h.desde + MARGEN_MINIMO_SEC && tSec <= h.hasta - MARGEN_MINIMO_SEC;
    if (huecos.some(adentro)) return { sec: tSec, porQue: 'ya-en-silencio' };

    let elegido = null;
    for (const h of huecos) {
        // Dónde se PUEDE poner el corte en este hueco: lo que la ventana alcanza
        // y que además esté a un margen de la voz de los dos lados. Un hueco
        // cuya parte usable no llega a la ventana no sirve, aunque asome.
        const lo = Math.max(h.desde + MARGEN_MINIMO_SEC, desdeVentana);
        const hi = Math.min(h.hasta - MARGEN_MINIMO_SEC, hastaVentana);
        if (hi < lo) continue;
        const lejos = tSec < lo ? lo - tSec : (tSec > hi ? tSec - hi : 0);
        // Hacia atrás para el IN y hacia adelante para el OUT es el lado que no
        // pierde palabras; el otro paga la ventaja (ver arriba).
        const bueno = lado === 'out' ? tSec < lo : tSec > hi;
        const costo = bueno ? lejos : lejos * VENTAJA_DEL_LADO_BUENO;
        // El más barato, y entre dos iguales el más profundo: un hueco de −67 es
        // una pausa y uno de −55 puede ser una respiración.
        if (!elegido || costo < elegido.costo - 1e-9 ||
            (Math.abs(costo - elegido.costo) <= 1e-9 && h.medio < elegido.medio)) {
            elegido = { lo, hi, costo, medio: h.medio, desde: h.desde, hasta: h.hasta };
        }
    }
    if (!elegido) return { sec: tSec, porQue: 'sin-silencio' };

    // El IN se pega al final del hueco —lo último que es silencio antes de que
    // suene— y el OUT al principio, cada uno con la guarda hacia adentro. En un
    // hueco corto los dos tiran del mismo punto y el corte queda en el centro
    // del silencio, que es lo único que cabe.
    const objetivo = lado === 'out' ? elegido.desde + GUARDA_SEC : elegido.hasta - GUARDA_SEC;
    const sec = Math.min(elegido.hi, Math.max(elegido.lo, objetivo));
    return { sec, porQue: 'silencio' };
}

/* ─── De la sesión a los bordes ajustados ──────────────────────────────────── */

/** En qué WAV de la sesión cae esta hora del día, y en qué segundo de él. */
function dondeCae(sesiones, ms, resolver) {
    for (const s of sesiones || []) {
        if (!s || !s.archivo || !(s.segundos > 0)) continue;
        const desde = Number(s.desdeMs);
        const sec = (Number(ms) - desde) / 1000;
        if (sec < 0 || sec > s.segundos) continue;
        return { archivo: resolver ? resolver(s.archivo) : s.archivo, sec };
    }
    return null;
}

/**
 * El borde ajustado de una toma, si el ajuste guardado sigue valiendo.
 *
 * **El sidecar guarda las dos cosas**: `inMs`/`outMs` son lo que el editor
 * marcó y no se tocan nunca, y `ajuste` es lo que va al XML. Están separados
 * porque son datos distintos: uno es la intención y el otro el resultado de
 * mirar la onda. Y por eso `ajuste` dice CONTRA QUÉ se calculó (`deInMs`): si
 * alguien arrastra el IN a mano, el ajuste viejo deja de coincidir y se lo
 * ignora, en vez de escribir en el XML un corte que ya no tiene nada que ver.
 */
function bordeAjustado(toma, cual) {
    const propio = cual === 'out' ? toma.outMs : toma.inMs;
    const a = toma && toma.ajuste;
    if (!a) return propio;
    const contra = cual === 'out' ? a.deOutMs : a.deInMs;
    if (contra == null || Number(contra) !== Number(propio)) return propio;
    const ajustado = cual === 'out' ? a.outMs : a.inMs;
    return ajustado == null ? propio : Number(ajustado);
}

function inAjustado(toma) {
    return bordeAjustado(toma, 'in');
}

function outAjustado(toma) {
    return bordeAjustado(toma, 'out');
}

/**
 * ¿Hay que volver a calcular el ajuste de esta toma?
 *
 * Se recalcula cuando el editor movió un borde a mano —el ajuste viejo mira otro
 * sitio— y cuando el de antes se hizo sin todo el audio que necesitaba. Eso
 * último pasa siempre en vivo: una toma se cierra en el instante en que el
 * profesor dice "pausa", y los 850 ms de cola que la ventana quiere mirar
 * todavía no están escritos en el WAV. Se ajusta con lo que hay, se marca
 * `provisional`, y la escritura siguiente —un segundo después— lo rehace con el
 * audio completo.
 */
function haceFalta(toma) {
    const a = toma.ajuste;
    if (!a) return true;
    if (Number(a.deInMs) !== Number(toma.inMs)) return true;
    if (Number(a.deOutMs) !== Number(toma.outMs)) return true;
    if (a.provisional) return true;
    // Un borde que no se pudo mirar porque el WAV no estaba se vuelve a
    // intentar: el archivo puede aparecer después (una carpeta que se movió, un
    // disco que se volvió a montar), y ahí sí se puede ajustar.
    return a.porQueIn === 'sin-audio' || a.porQueOut === 'sin-audio';
}

/**
 * Ajusta los bordes de todas las tomas de una sesión contra la onda.
 *
 * Trabaja SOBRE el estado —le escribe `toma.ajuste`— y a propósito: así el
 * cálculo queda hecho una vez, viaja al sidecar y no se repite en cada una de
 * las escrituras que hace una sesión en vivo. Lo que no toca nunca es `inMs` ni
 * `outMs`.
 *
 * Es tolerante con todo lo que puede faltar: sin WAV, con un WAV que no se
 * entiende o sin contraste para distinguir un silencio, deja los tiempos como
 * estaban y lo dice en `porQue`. Nunca tira.
 *
 * @param {object} estado la sesión (en curso o leída del sidecar)
 * @param {object} [opciones] `resolver(rutaGuardada)` → dónde está el WAV hoy
 * @returns {{tomas:number, rehechos:number, movidos:number, mayorMs:number}}
 *   `movidos` son los bordes que el XML escribe corridos, los haya calculado
 *   esta pasada o una anterior: es lo que se le puede contar al editor.
 */
function ajustarSesion(estado, opciones) {
    const o = opciones || {};
    const cuenta = { tomas: 0, rehechos: 0, movidos: 0, mayorMs: 0 };
    if (!estado) return cuenta;

    // Un WAV cerrado no va a crecer, así que a un borde del final del archivo no
    // le va a llegar más cola y no tiene sentido volver a mirarlo en cada
    // escritura. Mientras la clase sigue abierta, sí.
    const puedeCrecer = !estado.terminada;

    const abiertos = new Map();
    const dameWav = archivo => {
        if (!abiertos.has(archivo)) abiertos.set(archivo, abrir(archivo));
        return abiertos.get(archivo);
    };

    try {
        for (const toma of estado.tomas || []) {
            if (!toma || toma.descartada) continue;
            if (toma.inMs == null || toma.outMs == null) continue;
            cuenta.tomas++;
            if (haceFalta(toma)) rehacer(toma);

            const movidoIn = Math.abs(inAjustado(toma) - toma.inMs);
            const movidoOut = Math.abs(outAjustado(toma) - toma.outMs);
            if (movidoIn) cuenta.movidos++;
            if (movidoOut) cuenta.movidos++;
            cuenta.mayorMs = Math.max(cuenta.mayorMs, movidoIn, movidoOut);
        }
    } finally {
        for (const w of abiertos.values()) cerrar(w);
    }
    return cuenta;

    /** Mira la onda alrededor de los dos bordes y escribe `toma.ajuste`. */
    function rehacer(toma) {
        cuenta.rehechos++;
        const ajuste = {
            deInMs: toma.inMs,
            deOutMs: toma.outMs,
            inMs: toma.inMs,
            outMs: toma.outMs,
            porQueIn: 'sin-audio',
            porQueOut: 'sin-audio'
        };

        for (const cual of ['in', 'out']) {
            const ms = cual === 'out' ? toma.outMs : toma.inMs;
            const donde = dondeCae(estado.sesiones, ms, o.resolver);
            if (!donde) continue;
            const w = dameWav(donde.archivo);
            if (!w) continue;
            const umbral = umbralRecordado(w, donde.archivo);
            if (!umbral) {
                ajuste[cual === 'out' ? 'porQueOut' : 'porQueIn'] = 'sin-contraste';
                continue;
            }
            const v = VENTANA[cual];
            const hastaQueria = donde.sec + v.adelante + CONTEXTO_SEC;
            const tramo = nivelesDeTramo(
                w, Math.max(0, donde.sec - v.atras - CONTEXTO_SEC), hastaQueria);
            if (!tramo) continue;
            const hastaLeyo = tramo.desdeSec + tramo.db.length * tramo.hopSec;
            if (puedeCrecer && hastaLeyo < hastaQueria - tramo.hopSec) ajuste.provisional = true;

            const r = mejorInstante(tramo, donde.sec, umbral.umbralDb, cual);
            // Se redondea el CORRIMIENTO y no el tiempo. Los bordes vienen con
            // fracción de milisegundo —salen de dividir muestras por la tasa— y
            // redondear el tiempo entero le movía un tercio de milisegundo a un
            // borde que no se tocó: ruido en el sidecar y en el antes/después,
            // que hace más difícil ver lo que sí pasó.
            const corrimiento = Math.round((r.sec - donde.sec) * 1000);
            const nuevoMs = corrimiento ? ms + corrimiento : ms;
            if (cual === 'out') {
                ajuste.outMs = nuevoMs;
                ajuste.porQueOut = r.porQue;
            } else {
                ajuste.inMs = nuevoMs;
                ajuste.porQueIn = r.porQue;
            }
        }

        // Un ajuste no puede dar vuelta la toma. Con la ventana de 600 ms y
        // tomas de segundos no pasa, pero las tomas de un tercio de segundo
        // existen —quedan de un conteo mal oído— y ahí el IN ajustado podría
        // pasarse del OUT.
        if (Number(ajuste.inMs) >= Number(ajuste.outMs)) {
            ajuste.inMs = toma.inMs;
            ajuste.outMs = toma.outMs;
            ajuste.porQueIn = 'toma-corta';
            ajuste.porQueOut = 'toma-corta';
        }

        toma.ajuste = ajuste;
    }
}

module.exports = {
    HOP_SEC,
    VENTANA,
    SILENCIO_MIN_SEC,
    GUARDA_SEC,
    MARGEN_MINIMO_SEC,
    VENTAJA_DEL_LADO_BUENO,
    CONTRASTE_MINIMO_DB,
    abrir,
    cerrar,
    nivelesDeTramo,
    umbralDe,
    olvidar,
    silencios,
    mejorInstante,
    dondeCae,
    bordeAjustado,
    inAjustado,
    outAjustado,
    ajustarSesion
};
