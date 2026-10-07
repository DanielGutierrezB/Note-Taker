'use strict';
/**
 * mejorar-audio.js — Que el vídeo de la semana salga al volumen de todo lo
 * demás, parejo entre tomas y sin el zumbido de la sala.
 *
 * Es la otra casilla de la pantalla de revisión, al lado de «Quitar
 * silencios», y como aquella vive acá y no en el navegador: la decisión se
 * toma mirando el audio de verdad, y eso es ffmpeg.
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * Medido sobre los tres vídeos semanales que hay grabados, tal como salían
 * antes de esto:
 *
 *   05/10   -30,8 LUFS   LRA 5,0   pico real  -0,4 dBFS
 *   06/10   -26,0 LUFS   LRA 5,2   pico real  -7,8 dBFS
 *   07/10   -27,0 LUFS   LRA 4,5   pico real  -5,5 dBFS
 *
 * El vídeo en línea se escucha a -16 LUFS: es lo que YouTube deja pasar sin
 * tocarlo, y lo que mide cualquier otro vídeo que esté en la misma pestaña. O
 * sea que estos salían entre 10 y 15 dB por debajo de todo lo demás, y quien
 * los veía tenía que subir el volumen —y bajarlo otra vez para lo siguiente—.
 *
 * Y entre ellos tampoco coinciden: hay 4,8 dB del más bajo al más alto, así
 * que el vídeo de una semana no suena como el de la otra.
 *
 * ── Qué se hace, en orden ─────────────────────────────────────────────────
 *
 * **1. Emparejar las tomas, cada una con su ganancia fija.** Medido sobre las
 * grabaciones reales, entre la primera toma y la última hay 3,1 dB en una y
 * 1,2 en otra: la persona se va acercando al micrófono, o se va animando. En
 * el vídeo cortado eso es un escalón en cada corte. Peor es cuando el audio
 * cambia de fuente a mitad de vídeo —`repartir` usa el de la cámara si cubre
 * la toma y el WAV si no—, que ahí el salto es de los grandes.
 *
 * Se mide cada toma y se le pone UNA ganancia, la misma de principio a fin.
 * Es lo que hace un editor con el volumen de clip, y tiene la propiedad de
 * que no inventa nada: dentro de la toma la voz sube y baja igual que antes.
 *
 * **2. Quitar lo que no es voz.** Un pasa-altos a 80 Hz —debajo de eso no hay
 * voz, hay mesa, aire acondicionado y el golpe del teclado— y el denoiser
 * ajustado al piso de ruido de ESA grabación, que no es un número fijo: de
 * las tres, una tiene el piso en -60 dB y otra en -40. Ver `RUIDO_SOBRE_EL_PISO`.
 *
 * **3. Subir el conjunto a -16 LUFS**, también con una ganancia fija, y un
 * limitador detrás por si algún pico se pasa.
 *
 * ── Por qué una ganancia fija y no `loudnorm` ─────────────────────────────
 *
 * `loudnorm` es lo que todo el mundo usa y era lo primero que probé, en dos
 * pasadas. Llega al destino, pero con este material se le acaba el sitio y
 * cae a su modo dinámico, que es un compresor: la dinámica de la voz (LRA)
 * bajaba de 5,0 a 3,3. Medido, las dos formas una al lado de la otra:
 *
 *                       05/10        06/10        07/10
 *   crudo            -30,8 / 5,0  -26,0 / 5,2  -27,0 / 4,5
 *   loudnorm         -16,5 / 3,3  -16,2 / 3,0  -16,0 / 3,3
 *   ganancia fija    -16,4 / 4,1  -16,3 / 4,6  -16,2 / 3,9
 *
 * Las dos llegan a -16; la fija conserva un decibelio largo más de dinámica.
 * Como lo que se pidió fue «que se nivele, no muy exagerado», va la fija.
 *
 * Lo que sí se le copia a `loudnorm` son las dos pasadas: medir, corregir y
 * comprobar. Lo que no se le copia es el compresor. Ver `afinar`.
 *
 * ── Cómo quedaron las tres, medidas con `tools/medir-audio.js` ────────────
 *
 *            antes              ahora            dinámica   voz    ruido
 *   05/10   -30,8 LUFS   →   -16,2 LUFS       5,0 → 4,0   -0,5   -1,9 dB
 *   06/10   -26,0 LUFS   →   -16,1 LUFS       5,2 → 4,6   -0,3   -3,8 dB
 *   07/10   -27,0 LUFS   →   -16,1 LUFS       4,5 → 4,1   -0,3   -5,1 dB
 *
 * Los 4,8 dB que había de una semana a otra quedaron en 0,1: los tres vídeos
 * suenan igual entre ellos y suenan como el resto de internet. La voz se mueve
 * medio decibelio —que es la limpieza, medida sola— y el desfase que queda son
 * 0,3 ms.
 *
 * ── Por qué el limitador no es trampa ─────────────────────────────────────
 *
 * Subir 15 dB una señal cuyo pico está en -0,4 dBFS suena imposible, y lo
 * sería si ese pico fuera voz. No lo es: en la grabación del 05/10, de 33
 * segundos, lo que pasa de -12 dBFS dura **2 milisegundos**. Es un clic. El
 * limitador se lo lleva por delante y deja pasar todo lo demás.
 *
 * Contado sobre ventanas de 20 ms de habla, cuánto trabaja el limitador según
 * a dónde se quiera llegar:
 *
 *   destino    05/10    06/10    07/10
 *    -14      9,9 %    7,9 %    4,3 %
 *    -16      4,3 %    1,7 %    1,4 %      ← acá
 *    -18      1,2 %    0,3 %    0,5 %
 *
 * A -16 toca menos del 5 % y a -14 se dispara. Por eso el destino es -16 y no
 * el -14 al que YouTube normaliza: el decibelio y medio que faltaría cuesta el
 * doble de limitador.
 */

const { spawnSync } = require('child_process');

/**
 * A cuánto se sube el vídeo. -16 LUFS es lo que se usa para vídeo en línea y
 * pódcast; YouTube normaliza a -14, pero llegar ahí cuesta el doble de
 * limitador sobre este material (ver la tabla de la cabecera).
 */
const DESTINO_LUFS = -16;

/** El techo, en pico real. -1,5 dBTP deja sitio para lo que el AAC agrega al codificar. */
const TECHO_DBTP = -1.5;

/** Debajo de esto no hay voz: hay mesa, aire y el golpe del teclado. */
const ALTO_PASO_HZ = 80;

/** Cuánto ruido se quita, en dB. 12 es lo de fábrica de `afftdn` y es lo que aguanta la voz. */
const RUIDO_NR = 12;

/**
 * Cuánto por encima del piso MEDIDO se le dice al denoiser que está el ruido.
 *
 * El piso no puede ser un número fijo, por lo mismo que en `sonido.js`: de las
 * tres grabaciones que hay, una tiene el piso en -60 dB (sala callada) y otra
 * en -40 (sala con ruido). Decirle -40 a la primera le hace quitar 10,6 dB, que
 * es mucho más de lo que hay que quitar, y ahí es donde aparece el burbujeo.
 *
 * Y por encima y no en el piso exacto porque medido da más limpieza por el
 * mismo precio. Restando la señal procesada de la original y midiendo el
 * residuo SOLO donde se habla —que es la única forma de ver si se está
 * tocando la voz—, con el piso medido + 6:
 *
 *   05/10   ruido -2,6 dB   residuo sobre la voz  -37,1 dB
 *   06/10   ruido -3,7 dB   residuo sobre la voz  -27,9 dB
 *   07/10   ruido -4,3 dB   residuo sobre la voz  -31,2 dB
 *
 * O sea que de la voz se toca entre el 0,02 % y el 0,16 % de la energía, que
 * no se oye. Con +14 el residuo sube a -23 dB (0,5 %), que ya es donde
 * empiezan los artefactos.
 */
const RUIDO_SOBRE_EL_PISO = 6;

/**
 * Lo más que se le mueve una toma para emparejarla con las demás.
 *
 * Emparejar y llegar al destino son dos cosas distintas y llevan dos topes
 * distintos, y mezclarlas fue el primer error de este archivo: con un tope
 * solo de 12 dB, la grabación del 05/10 —que necesitaba 14,8 para llegar—
 * se quedaba en -19,5 LUFS, o sea sin arreglar. Lo cazó
 * `tools/medir-audio.js`, que es para lo que está.
 *
 * Acá el tope sí tiene sentido: una toma que mide 20 dB por debajo de sus
 * hermanas no está baja, está rota —el micrófono se desconectó, la fuente no
 * era la que se creía—. Subirla 20 dB sería subir su ruido 20 dB y entregar un
 * tramo que suena a lata en medio de un vídeo que suena bien. Con el tope
 * queda más baja que las otras, que es honesto y se oye como lo que es.
 *
 * Medido, la deriva de verdad entre tomas es de 1,2 a 3,1 dB, así que 12 no
 * estorba nunca: es un seguro, no un objetivo.
 */
const GANANCIA_MAX_DB = 12;

/**
 * Lo más que se sube el vídeo entero para llegar al destino.
 *
 * Es mucho más alto que el de emparejar porque es otra cosa: esta ganancia es
 * la MISMA para todo el vídeo, así que no puede hacer que un trozo suene
 * distinto de otro. De las tres grabaciones medidas, la más floja pedía 14,8
 * dB; 24 deja sitio de sobra para una peor.
 *
 * Tope hay igual, porque a partir de algún punto no queda voz que subir: un
 * vídeo que mide -45 LUFS no está bajo, está vacío, y subirlo 29 dB entrega 29
 * dB de siseo. Mejor que salga bajo y se oiga que algo salió mal.
 */
const GANANCIA_PROGRAMA_MAX_DB = 24;

/**
 * Lo que la cadena retrasa el audio, en milisegundos.
 *
 * `afftdn` trabaja por ventanas de FFT y devuelve la señal 1200 muestras más
 * tarde (25 ms a 48 kHz); el limitador mira 5 ms hacia adelante y suma los
 * suyos. Ninguno de los dos cambia la cantidad de muestras: meten silencio al
 * principio y se comen otro tanto del final.
 *
 * **Hay que compensarlo o se rompe la sincronía que se acaba de arreglar.**
 * El montaje de la pantalla de revisión persigue 11 ms de media; dejar que el
 * exporte saliera 30 ms detrás haría que lo que se mira y lo que se baja no
 * fueran la misma cosa. Se compensa cortando el principio y rellenando el
 * final, y medido sobre la grabación del 06/10 el desfase que queda es de 6
 * muestras: 0,1 ms.
 *
 * `tools/medir-audio.js` lo vuelve a medir sobre material de verdad, porque es
 * un número que depende de ffmpeg y no de nosotros.
 */
const RETRASO_MS = 30;

/**
 * Cuántas veces se mide el resultado para corregir lo que el limitador se come.
 *
 * Dos: la primera mide y corrige, la segunda comprueba. Una tercera no cambia
 * nada medible y cuesta otra lectura de todos los archivos.
 */
const VUELTAS_DE_AFINE = 2;

/** Cuánto se perdona en el destino antes de gastar otra vuelta. 0,3 dB no se oye. */
const AFINE_SUFICIENTE_DB = 0.3;

/** Una toma más corta que esto no se puede medir: R128 necesita algo que medir. */
const MINIMO_MEDIBLE_SEC = 1.5;

function num(texto, re) {
    const m = String(texto || '').match(re);
    return m ? Number(m[1]) : NaN;
}

/**
 * Lo que dejó ffmpeg en su salida de registro, convertido en dos números.
 *
 * Va aparte porque es lo único de la medición que se puede probar sin un
 * archivo con voz dentro, y porque si ffmpeg cambia el texto esto se cae en
 * silencio: devolvería `null` y el vídeo saldría sin tocar, que no es un
 * error que se note hasta que alguien lo escucha.
 *
 * Y las dos salen del MISMO texto porque son la misma lectura del archivo:
 * pedirlas por separado sería decodificar dos veces lo mismo.
 */
function leerMedida(salida) {
    const lufs = num(salida, /Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)/);
    const piso = num(salida, /Noise floor dB:\s*(-?[\d.]+)/);
    if (!Number.isFinite(lufs)) return null;
    return { lufs, piso: Number.isFinite(piso) ? piso : null };
}

/**
 * Mide un tramo de un archivo: cuánto suena y cuánto ruido tiene debajo.
 *
 * @param {string} ffmpeg la ruta al binario
 * @param {object} tramo { ruta, desdeSec, hastaSec }
 * @returns {{lufs:number, piso:number}|null} null si no se pudo medir
 */
function medirTramo(ffmpeg, tramo) {
    const t = tramo || {};
    const dur = Number(t.hastaSec) - Number(t.desdeSec);
    if (!ffmpeg || !t.ruta || !(dur > 0)) return null;

    const r = spawnSync(ffmpeg, [
        '-v', 'info', '-nostdin',
        '-ss', String(t.desdeSec), '-t', String(dur), '-i', t.ruta,
        '-af', 'ebur128=peak=true,astats=metadata=0:measure_perchannel=none',
        '-f', 'null', '-'
    ], { encoding: 'utf8', maxBuffer: 1 << 26 });

    // Las dos medidas se escriben en el registro, que ffmpeg manda a stderr.
    return leerMedida(r.stderr || '');
}

function tope(x, max) {
    return Math.max(-max, Math.min(max, x));
}

/**
 * La ganancia que empareja una toma con la referencia, con el tope puesto.
 *
 * La referencia es la toma del medio, no el destino: lo que esto arregla es el
 * escalón entre una toma y la siguiente. Llegar a -16 lo hace `gananciaDelPrograma`,
 * una sola vez y para todo el vídeo.
 */
function gananciaDe(lufs, referencia) {
    if (!Number.isFinite(lufs) || !Number.isFinite(referencia)) return 0;
    return tope(referencia - lufs, GANANCIA_MAX_DB);
}

/** Lo que le falta al vídeo entero para sonar como todo lo demás. */
function gananciaDelPrograma(referencia) {
    if (!Number.isFinite(referencia)) return 0;
    return tope(DESTINO_LUFS - referencia, GANANCIA_PROGRAMA_MAX_DB);
}

/**
 * El del medio de una lista de números, o `NaN` si no hay ninguno.
 *
 * `NaN` y no cero, que es lo que decía antes y era un error de los caros: sin
 * nada medido la referencia salía 0 LUFS, y como el destino es -16, el vídeo
 * se iba a entregar **16 dB más bajo** de lo que entró. Un cero que significa
 * «no sé» se mezcla con los ceros que significan cero.
 */
function mediana(xs) {
    const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    return v[Math.floor(v.length / 2)];
}

/**
 * Qué ganancia lleva cada trozo y qué cadena lleva el conjunto.
 *
 * **Se mide por TOMA y no por trozo.** Con «Quitar silencios» puesto, una toma
 * sale partida en varios trozos de uno o dos segundos, y medir la sonoridad de
 * dos segundos no da un número de fiar. Se mide el tramo entero de la toma
 * —del principio del primer trozo al final del último— y todos sus pedazos
 * llevan la misma ganancia, que además es lo correcto: son la misma toma, y
 * que un pedazo suene distinto del de al lado sería peor que no hacer nada.
 *
 * Los silencios que quedan en medio de ese tramo no estorban: R128 los
 * descarta por su propia puerta (todo lo que esté 10 LU por debajo no cuenta).
 *
 * @param {object} p { trozos, ffmpeg, medir } — `medir` solo lo pasan las
 *   pruebas, para decidir sin un archivo delante
 * @returns {{porTrozo:number[], programa:string, avisos:string[], tomas:object[]}}
 */
function plan(p) {
    const trozos = (p && p.trozos) || [];
    const ffmpeg = p && p.ffmpeg;
    const medir = (p && p.medir) || medirTramo;
    const avisos = [];

    // El tramo de cada toma: de donde empieza su primer pedazo a donde termina
    // el último, en SU archivo. Dos tomas pueden salir de archivos distintos.
    const porToma = new Map();
    for (const t of trozos) {
        const a = t.audio || {};
        const antes = porToma.get(t.toma);
        if (!antes) {
            porToma.set(t.toma, { ruta: a.ruta, desdeSec: a.desdeSec, hastaSec: a.hastaSec });
            continue;
        }
        if (antes.ruta !== a.ruta) continue;
        antes.desdeSec = Math.min(antes.desdeSec, a.desdeSec);
        antes.hastaSec = Math.max(antes.hastaSec, a.hastaSec);
    }

    const medidas = [];
    for (const [id, tramo] of porToma) {
        const corta = (tramo.hastaSec - tramo.desdeSec) < MINIMO_MEDIBLE_SEC;
        const m = corta ? null : medir(ffmpeg, tramo);
        medidas.push({ id, tramo, lufs: m ? m.lufs : NaN, piso: m ? m.piso : null, corta });
    }

    // La referencia es la toma del medio: la mitad de las tomas se suben y la
    // otra mitad se bajan, así que nadie se mueve mucho. Tomar la más alta o la
    // más baja movería a todas las demás por una sola.
    const referencia = mediana(medidas.map(m => m.lufs));
    medidas.forEach(m => {
        m.medida = Number.isFinite(m.lufs);
        // Lo que no se pudo medir se queda quieto: es lo único honesto. Está en
        // la referencia por definición, porque la referencia es la del medio.
        m.ganancia = m.medida ? gananciaDe(m.lufs, referencia) : 0;
    });

    const deLaToma = new Map(medidas.map(m => [m.id, m]));
    const porTrozo = trozos.map(t => {
        const m = deLaToma.get(t.toma);
        return m ? m.ganancia : 0;
    });

    const delPrograma = gananciaDelPrograma(referencia);

    const medidasBuenas = medidas.filter(m => m.medida);
    const topadas = medidasBuenas.filter(m => Math.abs(referencia - m.lufs) > GANANCIA_MAX_DB);
    if (medidasBuenas.length > 1) {
        const l = medidasBuenas.map(m => m.lufs);
        const deriva = Math.max(...l) - Math.min(...l);
        // Los dos avisos son el mismo hecho contado distinto, así que va uno:
        // decir «quedaron emparejadas» y a renglón seguido «una quedó más
        // baja» es contradecirse en dos líneas seguidas.
        if (topadas.length) {
            avisos.push(`Había ${deriva.toFixed(1)} dB entre la toma que más suena y la que `
                + `menos. ${topadas.length} sonaba(n) tan distinto del resto que emparejarla(s) `
                + 'del todo habría subido su ruido: quedó más baja. Vale la pena oírla.');
        } else if (deriva >= 2) {
            avisos.push(`Entre la toma que más suena y la que menos había ${deriva.toFixed(1)} dB: `
                + 'quedaron emparejadas.');
        }
    }
    if (!medidasBuenas.length && trozos.length) {
        avisos.push('No se pudo medir el audio, así que se dejó como estaba.');
    }
    if (medidasBuenas.length
        && Math.abs(DESTINO_LUFS - referencia) > GANANCIA_PROGRAMA_MAX_DB) {
        avisos.push('El audio venía tan bajo que subirlo hasta el volumen normal habría sido '
            + 'subir siseo: el vídeo queda más bajo de lo normal. Revisá el micrófono.');
    }

    return {
        porTrozo,
        referencia,
        ganancia: delPrograma,
        programa: cadenaDelPrograma(medidas, delPrograma),
        tomas: medidas,
        avisos
    };
}

/**
 * El piso de ruido con el que se va a encontrar el denoiser.
 *
 * Cada toma lleva su ganancia, así que su ruido sube con ella: el piso que hay
 * DESPUÉS de emparejar no es el que se midió. Y se toma el más alto de todos,
 * no el promedio, porque el denoiser es uno solo para todo el vídeo y pasarse
 * cuesta más caro que quedarse corto: quedarse corto deja ruido, pasarse deja
 * burbujeo encima de la voz.
 */
function pisoDespues(medidas) {
    const pisos = (medidas || [])
        .filter(m => Number.isFinite(m.piso))
        .map(m => m.piso + (m.ganancia || 0));
    return pisos.length ? Math.max(...pisos) : null;
}

/**
 * Lo que se le QUITA al audio: el retumbe y el ruido de la sala.
 *
 * Va aparte de lo que se le sube porque son las dos mitades del trabajo y se
 * juzgan distinto: esta no debería tocar la voz en absoluto —y medida sola,
 * no la toca— mientras que la otra la sube y la limita, que sí la mueve. Para
 * saber si el denoiser se está comiendo algo hay que poder oírlo sin lo demás
 * encima, y `tools/medir-audio.js` lo hace llamando a esta.
 */
function limpieza(medidas) {
    const piso = pisoDespues(medidas);
    const pasos = [`highpass=f=${ALTO_PASO_HZ}`];
    // Sin un piso que mirar no se denoisa: un `nf` inventado es exactamente lo
    // que deja la voz sonando a lata.
    if (piso != null) pasos.push(`afftdn=nr=${RUIDO_NR}:nf=${Math.round(piso + RUIDO_SOBRE_EL_PISO)}`);
    return pasos.join(',');
}

/**
 * La cadena que va DESPUÉS de pegar las tomas, sobre el vídeo entero.
 *
 * El orden importa y es este:
 *
 *   1. `highpass` — quitar el retumbe primero, para no gastar el resto de la
 *      cadena en algo que se iba a tirar igual.
 *   2. `afftdn` — el denoiser, mientras el ruido siga estando donde se midió.
 *   3. `volume` — subir al destino. Después de denoisar, porque denoisar un
 *      ruido que ya se movió sería afinarlo a un número que no es el suyo.
 *   4. `alimiter` — el techo, al final, que es donde sirve de techo.
 */
function cadenaDelPrograma(medidas, ganancia) {
    const pasos = limpieza(medidas).split(',');
    if (ganancia) pasos.push(`volume=${ganancia.toFixed(2)}dB`);
    pasos.push(`alimiter=limit=${TECHO_DBTP}dB:attack=5:release=50:level=disabled`);
    // Y se devuelve el audio a donde estaba: ver `RETRASO_MS`.
    const seg = (RETRASO_MS / 1000).toFixed(3);
    pasos.push(`atrim=start=${seg}`, 'asetpts=PTS-STARTPTS', `apad=pad_dur=${seg}`);
    pasos.push('aresample=48000');
    return pasos.join(',');
}

/**
 * El grafo de SOLO el audio: las tomas con su ganancia, pegadas, con la cadena
 * del conjunto encima. El mismo que va en el exporte, sin el vídeo.
 *
 * Existe para poder oír el resultado antes de hacerlo: medir el audio final
 * cuesta una lectura de los archivos, y el exporte de verdad cuesta minutos de
 * x264. Así se puede medir dos veces y encodear una.
 */
function grafoDeAudio(trozos, plan) {
    const entradas = [];
    const indiceDe = ruta => {
        const i = entradas.indexOf(ruta);
        if (i >= 0) return i;
        entradas.push(ruta);
        return entradas.length - 1;
    };
    const partes = [];
    const pegar = [];
    trozos.forEach((t, i) => {
        const a = t.audio;
        const sube = plan.porTrozo[i];
        partes.push(`[${indiceDe(a.ruta)}:a]atrim=start=${a.desdeSec}:end=${a.hastaSec},`
            + `asetpts=PTS-STARTPTS,aresample=48000`
            + `${sube ? `,volume=${sube.toFixed(2)}dB` : ''}[a${i}]`);
        pegar.push(`[a${i}]`);
    });
    partes.push(`${pegar.join('')}concat=n=${trozos.length}:v=0:a=1[apegado]`);
    partes.push(`[apegado]${plan.programa},ebur128=peak=true[a]`);
    const args = ['-v', 'info', '-nostdin'];
    for (const ruta of entradas) args.push('-i', ruta);
    args.push('-filter_complex', partes.join(';'), '-map', '[a]', '-f', 'null', '-');
    return args;
}

/**
 * Afinar: medir lo que va a sonar y corregir lo que falte.
 *
 * Una ganancia fija calculada de la medida llega al destino SALVO cuando el
 * limitador tiene que trabajar, porque lo que el limitador recorta también
 * baja la sonoridad. Medido: la grabación del 05/10 tiene el pico a -0,4 dBFS
 * —ese clic de 2 ms— y se quedaba 1,1 dB corta.
 *
 * No es algo que se pueda calcular: depende de cuántos picos haya y de cuánto
 * se pasen. Lo que sí se puede es oírlo y corregir, que es lo que hace
 * `loudnorm` en sus dos pasadas y lo que haría cualquiera con un medidor
 * delante. Dos vueltas bastan porque la corrección es casi lineal en este
 * rango; se para antes si ya está.
 *
 * Si no se puede medir se deja lo que había: una ganancia calculada de la
 * primera medida, que es lo que se tenía antes de esto y ya servía.
 */
function afinar(p) {
    const trozos = (p && p.trozos) || [];
    const ffmpeg = p && p.ffmpeg;
    let plan = p && p.plan;
    if (!plan || !trozos.length || !ffmpeg) return plan;

    for (let vuelta = 0; vuelta < VUELTAS_DE_AFINE; vuelta++) {
        const r = spawnSync(ffmpeg, grafoDeAudio(trozos, plan), {
            encoding: 'utf8', maxBuffer: 1 << 26
        });
        const m = leerMedida(r.stderr || '');
        if (!m) break;
        plan = { ...plan, medido: m.lufs };
        const falta = DESTINO_LUFS - m.lufs;
        if (Math.abs(falta) <= AFINE_SUFICIENTE_DB) break;
        const ganancia = tope(plan.ganancia + falta, GANANCIA_PROGRAMA_MAX_DB);
        if (ganancia === plan.ganancia) break;
        plan = { ...plan, ganancia, programa: cadenaDelPrograma(plan.tomas, ganancia) };
    }
    return plan;
}

module.exports = {
    DESTINO_LUFS,
    TECHO_DBTP,
    ALTO_PASO_HZ,
    RUIDO_NR,
    RUIDO_SOBRE_EL_PISO,
    GANANCIA_MAX_DB,
    GANANCIA_PROGRAMA_MAX_DB,
    RETRASO_MS,
    MINIMO_MEDIBLE_SEC,
    VUELTAS_DE_AFINE,
    AFINE_SUFICIENTE_DB,
    leerMedida,
    medirTramo,
    gananciaDe,
    gananciaDelPrograma,
    pisoDespues,
    limpieza,
    cadenaDelPrograma,
    plan,
    grafoDeAudio,
    afinar
};
