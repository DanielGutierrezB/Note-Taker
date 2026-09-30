'use strict';
/**
 * aplausos.js — Reconocer la PALMADA de una claqueta en el audio que va entrando.
 *
 * Reemplaza a `golpe.js` en la grabación. `golpe.js` preguntaba "¿este pedazo de
 * 85 ms tiene un pico fuerte y desparejo?", y eso lo cumple media clase: una
 * sílaba acentuada, el clic del ratón, la tecla de Iniciar, un golpe en la mesa.
 * Con la regla de ayer —palabra Y aplauso— los falsos ya no alcanzaban solos,
 * pero seguían entrando por la puerta de atrás: el profesor dice "claqueta"
 * mientras explica, cerca hay un pico cualquiera, y la claqueta se anota igual.
 *
 * **Lo que se midió** (sesión del 30/09 con AirPods, `curso-jev_2026-09-30_07-45-31`,
 * piso de sala −67,8 dBFS). Siete palmadas de verdad y todo lo demás:
 *
 *                      sobre el piso   ataque   caída 30 dB   centro del color
 *   palmada (×7)        58,7 a 61,5 dB   5-10 ms   135-160 ms    5,3 a 6,9 kHz
 *   vocal fuerte        46 a 58 dB       15-200 ms  60-800 ms    0,2 a 0,8 kHz
 *   clic de ratón       30 a 45 dB       5-10 ms    70-200 ms    3 a 8 kHz
 *
 * Ninguna de las tres columnas separa sola: hay habla tan fuerte como una
 * palmada, y hay clics tan cortos y tan agudos como una palmada. Las tres
 * juntas sí, y con mucho aire entre el sí y el no. De ahí las cuatro
 * preguntas de `esAplauso`.
 *
 * **Todo es relativo al piso de ESTA sesión.** Un umbral absoluto no sirve: en
 * este material el piso está en −65 y hay "silencio" a −55, y en el Live-Mix
 * del curso viejo el piso estaba en −74. Lo que no cambia es cuánto se despega
 * una palmada del silencio de su propia sala: unos 60 dB.
 *
 * **Se decide 300 ms tarde, a propósito.** La caída es la mitad del argumento
 * —una palmada se apaga en 150 ms y una vocal sigue sonando— y para medirla hay
 * que haber oído lo que viene después. El `ms` que se devuelve es el del pico,
 * no el del momento en que se decidió: el marcador tiene que caer en la palmada.
 */

/** El grano del análisis. Cinco milisegundos: el ataque de una palmada son dos. */
const MARCO_MS = 5;

/** Cuánto se espera después del pico para poder medirle la caída. */
const ESPERA_MS = 300;

/** La ventana del nivel de antes, y lo pegado al pico que no cuenta como "antes". */
const ANTES_MS = 300;
const HUECO_MS = 40;

/** Cuánto se guarda: lo de antes, lo de después y el margen del ataque. */
const MEMORIA_MS = 1000;

/**
 * Cuánto tiene que despegarse del piso de la sala.
 *
 * Cincuenta decibelios. Las siete palmadas medidas dan de 58,7 a 61,5, y lo
 * más fuerte que no es una palmada —una vocal gritada contra el micrófono— da
 * 58,1 pero se cae en el ataque y en la caída. Lo que este número saca de
 * cuajo son los clics: el del ratón al apretar Iniciar da 39 dB sobre el piso,
 * y las teclas andan entre 30 y 45. Son cortos y agudos como una palmada; lo
 * único que no tienen es fuerza.
 */
const SOBRE_EL_PISO_DB = 50;

/**
 * Cuánto tiene que despegarse de lo que sonaba justo antes.
 *
 * Es la pregunta "¿esto pasó adentro de una frase?". Un pico que está veinte
 * decibelios por encima de su propio alrededor es un evento; uno que está diez
 * es una sílaba más de alguien que viene hablando. Las palmadas medidas dan de
 * 44 a 59 dB porque casi siempre se aplaude sobre un silencio, pero se deja en
 * 20 para no perder a quien aplaude sin dejar de hablar.
 */
const SALTO_MIN_DB = 20;

/**
 * Cuánto puede tardar en llegar al pico, y cuánto en apagarse.
 *
 * El ataque se mide como cuánto tiempo seguido, antes del pico, el nivel ya
 * estaba a menos de 20 dB de él; la caída, cuánto tarda en bajar 30 dB. Una
 * palmada tarda entre 5 y 10 ms en subir y unos 150 en apagarse. Una vocal
 * sube en 50 o 100 y se sostiene medio segundo: es lo que la separa del
 * arranque de una palabra dicha después de un silencio, que por nivel y por
 * salto mide igual que una palmada.
 *
 * La caída también tiene un mínimo, y ese es contra los clics. Una palmada
 * excita la sala y la sala contesta: las siete medidas tardan de 135 a 160 ms
 * en bajar 30 dB. Un clic del ratón sobre el silencio digital de Zoom —el
 * único falso que sobrevivía a todo lo demás, a las 2:25:58 de la clase del
 * 29/09— sube en un marco y se apaga en 30 ms. No tiene cola porque no es un
 * sonido de la sala.
 */
const ATAQUE_MAX_MS = 15;
const CAIDA_MIN_MS = 60;
const CAIDA_MAX_MS = 250;
const ATAQUE_DB = 20;
const CAIDA_DB = 30;

/**
 * Qué tan agudo tiene que ser el pico.
 *
 * Es lo único que mira el CONTENIDO y no la forma, y es lo que de verdad saca
 * el habla: una palmada es un chasquido de banda ancha con el centro de su
 * energía arriba de 5 kHz, y una vocal —hasta una gritada— lo tiene abajo de
 * 1 kHz. Con el corte en 2,5 kHz quedan más de dos octavas de aire a cada
 * lado, que es el margen que hace falta con un micrófono Bluetooth: el códec
 * recorta agudos y no se sabe cuánto.
 *
 * Se estima sin FFT, con la energía de la diferencia entre muestras contra la
 * energía total: para un tono de frecuencia f esa razón vale (2·sen(π·f/fs))²,
 * así que se invierte y sale una frecuencia. Barata y suficiente para
 * preguntar "¿esto es grave o agudo?".
 */
const AGUDO_MIN_HZ = 2500;

/** Después de una palmada no se busca otra por un rato: el eco de la sala. */
const DESCANSO_MS = 700;

/**
 * Cuánto audio hace falta antes de creerle a nada.
 *
 * El piso arranca supuesto y tarda unas décimas en encontrar el de la sala; con
 * un piso equivocado, "50 dB sobre el piso" no quiere decir nada.
 */
const CALENTAR_MS = 1000;

/**
 * El seguidor del piso, en dB por marco.
 *
 * Sube lento y baja rápido, que es como se persigue un percentil bajo sin
 * guardar el historial: con estos dos números se asienta cerca del 4 % más
 * silencioso. Bajar 0,5 dB por marco son 100 dB por segundo —encuentra el piso
 * de la sala en menos de un segundo— y subir 0,02 son 4 dB por segundo, lo
 * bastante lento para que una frase larga no se lo lleve.
 */
const PISO_SUBE_DB = 0.02;
const PISO_BAJA_DB = 0.5;
const PISO_INICIAL_DB = -60;

/**
 * Y dos topes. El de abajo es contra el silencio digital: Zoom manda ceros
 * exactos, el piso se hundiría a −120 y cualquier cosa quedaría "70 dB sobre el
 * piso". El de arriba es para que en una sala ruidosa la regla se ponga
 * imposible antes que ponerse fácil.
 */
const PISO_MIN_DB = -80;
const PISO_MAX_DB = -25;

const TASA_POR_DEFECTO = 48000;

/** El nivel de un puñado de muestras, en dBFS. */
function enDb(sumaCuadrados, muestras) {
    if (!muestras) return -120;
    const rms = Math.sqrt(sumaCuadrados / muestras);
    return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/**
 * Dónde está el centro de la energía del marco, en Hz, sin FFT.
 *
 * @param {number} energia suma de x²
 * @param {number} energiaDiferencia suma de (x[n] − x[n−1])²
 */
function centroHz(energia, energiaDiferencia, tasa) {
    if (!(energia > 0)) return 0;
    const r = Math.min(1, Math.sqrt(energiaDiferencia / energia) / 2);
    return Math.asin(r) * tasa / Math.PI;
}

/**
 * Las cuatro preguntas, sin reloj y sin estado, para poder probarlas con
 * números escritos a mano.
 *
 * @param {object} r { picoDb, pisoDb, previoDb, ataqueMs, caidaMs, agudoHz }
 */
function esAplauso(r) {
    if (r.picoDb - r.pisoDb < SOBRE_EL_PISO_DB) return false;
    if (r.picoDb - r.previoDb < SALTO_MIN_DB) return false;
    if (r.ataqueMs > ATAQUE_MAX_MS) return false;
    if (r.caidaMs < CAIDA_MIN_MS || r.caidaMs > CAIDA_MAX_MS) return false;
    if (r.agudoHz < AGUDO_MIN_HZ) return false;
    return true;
}

/**
 * El buscador: el anillo de marcos ya medidos, el piso aprendido y las muestras
 * que quedaron colgando entre un pedazo y el siguiente.
 *
 * El anillo hace falta porque la decisión mira 300 ms para atrás y 300 para
 * adelante, y los pedazos que entran duran 85.
 */
function nuevo(params) {
    const tasa = Number((params || {}).tasa) || TASA_POR_DEFECTO;
    const porMarco = Math.max(1, Math.round(tasa * MARCO_MS / 1000));
    const capacidad = Math.ceil(MEMORIA_MS / MARCO_MS);
    return {
        tasa,
        porMarco,
        capacidad,
        db: new Float32Array(capacidad),
        agudo: new Float32Array(capacidad),
        piso: new Float32Array(capacidad),
        ms: new Float64Array(capacidad),
        /** Cuántos marcos se midieron desde que arrancó: el índice absoluto. */
        marcos: 0,
        pisoDb: PISO_INICIAL_DB,
        /** Las muestras sueltas del pedazo anterior, y la hora de la primera. */
        resto: Buffer.alloc(0),
        restoMs: null,
        /** La última muestra del marco anterior, para que la diferencia no se corte. */
        ultima: 0,
        // `null` y no 0 por lo mismo que en `golpe.js`: con 0, una palmada en el
        // primer segundo del audio simulado caía dentro del descanso de una
        // palmada que no existió.
        ultimoMs: null
    };
}

/** El marco de índice absoluto `i`, si todavía está en el anillo. */
function marco(b, i) {
    if (i < 0 || i >= b.marcos || i < b.marcos - b.capacidad) return null;
    const k = i % b.capacidad;
    return { db: b.db[k], agudo: b.agudo[k], piso: b.piso[k], ms: b.ms[k] };
}

function guardar(b, db, agudo, ms) {
    const k = b.marcos % b.capacidad;
    b.db[k] = db;
    b.agudo[k] = agudo;
    b.piso[k] = b.pisoDb;
    b.ms[k] = ms;
    b.marcos++;
}

/** La mediana de los niveles entre dos marcos. */
function medianaDb(b, desde, hasta) {
    const v = [];
    for (let i = desde; i < hasta; i++) {
        const m = marco(b, i);
        if (m) v.push(m.db);
    }
    if (!v.length) return -120;
    v.sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)];
}

/**
 * ¿El marco `p` fue una palmada?
 *
 * Se lo pregunta cuando ya pasaron `ESPERA_MS` de audio por detrás de él, que
 * es cuando se le puede medir la caída. Devuelve los rasgos medidos junto con
 * el veredicto, porque quien afina esto los necesita para entender un no.
 */
function juzgar(b, p) {
    const enMarcos = ms => Math.round(ms / MARCO_MS);
    const pico = marco(b, p);
    if (!pico) return null;
    if (pico.ms == null) return null;
    if (p < enMarcos(CALENTAR_MS)) return null;

    // El más alto de su vecindad, para que una palmada no se cuente dos veces.
    // Empatados, gana el primero: el ataque es el borde que interesa.
    for (let i = p - enMarcos(HUECO_MS); i <= p + enMarcos(ESPERA_MS); i++) {
        if (i === p) continue;
        const m = marco(b, i);
        if (!m) continue;
        if (i < p ? m.db >= pico.db : m.db > pico.db) return null;
    }

    let ataqueMs = 0;
    for (let k = 1; k <= enMarcos(ANTES_MS); k++) {
        const m = marco(b, p - k);
        if (!m || m.db < pico.db - ATAQUE_DB) break;
        ataqueMs = k * MARCO_MS;
    }
    let caidaMs = 0;
    for (let k = 1; k <= enMarcos(ESPERA_MS); k++) {
        const m = marco(b, p + k);
        if (!m || m.db < pico.db - CAIDA_DB) break;
        caidaMs = k * MARCO_MS;
    }

    const rasgos = {
        ms: Math.round(pico.ms),
        picoDb: pico.db,
        pisoDb: pico.piso,
        previoDb: medianaDb(b, p - enMarcos(ANTES_MS), p - enMarcos(HUECO_MS)),
        ataqueMs,
        caidaMs,
        agudoHz: pico.agudo
    };
    if (!esAplauso(rasgos)) return null;
    if (b.ultimoMs != null && rasgos.ms - b.ultimoMs < DESCANSO_MS) return null;
    b.ultimoMs = rasgos.ms;
    return rasgos;
}

/**
 * Mete un pedazo de PCM y devuelve las palmadas que se confirmaron con él.
 *
 * Son cero o una en la práctica, pero se devuelve una lista porque las que
 * salen no son de ESTE pedazo sino de unos 300 ms atrás, y un pedazo más largo
 * de lo normal podría cerrar dos.
 *
 * La hora la trae el pedazo —la posición en el audio, no el reloj—, igual que
 * en `golpe.js` y por lo mismo: así una clase grabada se puede volver a pasar a
 * toda velocidad y las palmadas caen donde sonaron.
 *
 * @param {object} b de `nuevo()`
 * @param {Buffer} pcm 16 bits mono
 * @param {number} ms la hora de la PRIMERA muestra de este pedazo
 * @returns {{aplausos: Array, pisoDb: number}}
 */
function mirar(b, pcm, ms) {
    const aplausos = [];
    const entra = Buffer.isBuffer(pcm) ? pcm : Buffer.alloc(0);
    if (b.resto.length === 0) b.restoMs = Number(ms);
    const datos = b.resto.length ? Buffer.concat([b.resto, entra]) : entra;
    const bytes = b.porMarco * 2;

    let off = 0;
    for (; off + bytes <= datos.length; off += bytes) {
        let energia = 0;
        let diferencia = 0;
        let previa = b.ultima;
        for (let i = 0; i < b.porMarco; i++) {
            const v = datos.readInt16LE(off + i * 2) / 32768;
            energia += v * v;
            const d = v - previa;
            diferencia += d * d;
            previa = v;
        }
        b.ultima = previa;

        const db = enDb(energia, b.porMarco);
        // El piso se mueve antes de guardar el marco, pero el marco guarda el
        // piso de ANTES de sí mismo: el nivel de una palmada no puede ser parte
        // del silencio contra el que se la compara.
        const piso = b.pisoDb;
        b.pisoDb = Math.min(PISO_MAX_DB, Math.max(PISO_MIN_DB,
            db > piso ? piso + PISO_SUBE_DB : piso - PISO_BAJA_DB));

        guardar(b, db, centroHz(energia, diferencia, b.tasa), b.restoMs + off / 2 / b.tasa * 1000);

        const listo = juzgar(b, b.marcos - 1 - Math.round(ESPERA_MS / MARCO_MS));
        if (listo) aplausos.push(listo);
    }

    // Copia y no vista: el pedazo que entró es de quien lo mandó y puede
    // reusarlo en cuanto esta llamada vuelve.
    b.resto = Buffer.from(datos.subarray(off));
    b.restoMs = b.restoMs + off / 2 / b.tasa * 1000;
    return { aplausos, pisoDb: b.pisoDb };
}

module.exports = {
    MARCO_MS,
    ESPERA_MS,
    SOBRE_EL_PISO_DB,
    SALTO_MIN_DB,
    ATAQUE_MAX_MS,
    CAIDA_MIN_MS,
    CAIDA_MAX_MS,
    AGUDO_MIN_HZ,
    DESCANSO_MS,
    CALENTAR_MS,
    PISO_MIN_DB,
    PISO_MAX_DB,
    centroHz,
    esAplauso,
    nuevo,
    mirar
};
