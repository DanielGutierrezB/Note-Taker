'use strict';
/**
 * sonido.js — Dónde hay sonido en un recorte, para no creerle a Whisper
 * palabras dichas sobre el silencio.
 *
 * Whisper, sobre silencio, escribe frases aprendidas de memoria de los
 * subtítulos con que lo entrenaron: «Gracias.», «Gracias por ver el video.»,
 * «Subtítulos realizados por la comunidad de Amara.org». En una llamada de Zoom
 * eso pasa todo el tiempo, porque Zoom manda silencio DIGITAL —ceros exactos,
 * −120 dB— cada vez que nadie habla, y fue lo que se vio en las pruebas del
 * 29/09: «Gracias, gracias, gracias» antes de que el profesor empezara.
 *
 * `collapseLoops` (`transcribe.js`) ya sacaba la repetición larga, pero no un
 * «Gracias.» suelto ni tres seguidos. Esto mira el sonido, que es la única
 * fuente que no se puede inventar: una palabra cuyo alrededor no tiene nada que
 * suene no la dijo nadie.
 *
 * **Por qué el piso no puede ser un número fijo.** La primera versión cortaba
 * en −60 dBFS, pensando en ese silencio digital de Zoom, y en la clase del
 * 30/09 no filtró nada: el micrófono era unos AirPods, y ahí
 * el silencio de una sala de verdad está en −65 y sube a −55. El corte quedaba
 * DEBAJO del ruido, así que todo pasaba. Lo que separa no es el nivel absoluto
 * sino cuánto sobresale del ruido de ESA sala, con ESE micrófono. Medido sobre
 * las dos grabaciones reales que tenemos:
 *
 *   clase del 29/09 (2,5 h)   piso −74   lo hablado, de +30 a +65 dB sobre el piso
 *   clase del 30/09           piso −67   lo hablado, de +42 a +54
 *                                        lo inventado («¡Suscríbete al canal!»,
 *                                        «Y», «ya está.»), de +17,8 a +18,7
 *
 * O sea: lo dicho nunca bajó de +30 y lo inventado nunca pasó de +19. El corte
 * va en +24, justo en la mitad, y el piso se mide sobre la marcha porque cambia
 * cuando la persona cambia de micrófono o prende el aire acondicionado.
 *
 * **Y por qué no alcanza con el pico.** Con el corte adaptativo puesto, sobre
 * seis tramos callados del 30/09 Whisper seguía escribiendo «Gracias.» en dos
 * de ellos: en esos había un clic de teclado o un golpe de aire, que llega a
 * −33 dB y pasa cualquier corte de nivel. Lo que un ruido así NO tiene es
 * duración. Contando cuántos milisegundos estuvo el sonido arriba del corte:
 *
 *   los seis tramos callados        0, 80, 0, 20, 0 y 100 ms en seis segundos
 *   las 11.490 palabras del 29/09   99 de cada 100 pasan de 420 ms
 *
 * Por eso lo que se mide es tiempo sostenido y no pico. El corte en 150 ms sacó
 * lo inventado de las dos grabaciones sin tocar ninguna de las 101 palabras
 * dichas del 30/09 y perdiendo 3 de las 11.490 del 29/09 —«ta,», «ta,»,
 * «cuesta.»: finales de frase que se apagan—. En 300 ms se habría perdido un
 * «Pausa.», que es la palabra que cierra una toma, y eso ya no se puede pagar.
 */

const fs = require('fs');

/** Cada cuánto se mide, en segundos. Veinte milisegundos es media sílaba. */
const HOP_SEC = 0.02;

/**
 * El corte más bajo posible. Con una fuente que manda silencio digital el piso
 * medido es −120, y +24 sobre eso dejaría pasar cualquier cosa; acá se planta.
 */
const PISO_DB = -60;

/** Cuánto tiene que sobresalir del ruido de sala una palabra para creerle (ver arriba). */
const MARGEN_DB = 24;

/**
 * Y el corte más alto posible. En una sala muy ruidosa +24 se comería lo
 * hablado, y perder una palabra dicha es peor que mostrar una inventada: de acá
 * para arriba el filtro se rinde y deja pasar todo.
 */
const TECHO_DB = -35;

/**
 * Cuántas pasadas recuerda el piso. A una por segundo son cinco minutos: dura
 * lo suficiente para no moverse con una frase larga y lo bastante poco para
 * seguir a la persona que se cambia los audífonos a mitad de clase.
 */
const RECUERDO = 300;

/**
 * De cuántas mediciones para arriba manda la mediana. Con menos que esto la
 * sesión está calentando y manda el mínimo (ver `umbral`).
 */
const MINIMO = 3;

/** Cuánto tiene que durar el sonido para ser una palabra y no un golpe (ver arriba). */
const SOSTENIDO_MS = 150;

/**
 * Cuánto alrededor de una palabra se mira. Los tiempos de Whisper se corren
 * varias décimas; con menos margen se perdería la primera palabra de una frase
 * cuyo comienzo el modelo puso un poco antes de que suene.
 */
const MARGEN_SEC = 0.5;

/* ─── La cola inventada ───────────────────────────────────────────────────
 *
 * Lo de arriba mira el nivel: una palabra escrita sobre el silencio. Esto mira
 * el BORDE: un recorte que se corta a mitad de frase, que es otra cosa y pasa
 * en otro sitio.
 *
 * Una toma se lee con audio a los dos lados (`hayOrilla` en `relecturas.js`),
 * salvo la última de cada clase: ahí el WAV termina en el OUT y no va a crecer
 * más. Con el audio cortado en seco, Whisper rellena el final con lo que tiene
 * aprendido de los subtítulos. Medido sobre la grabación del 13/10, releyendo
 * la misma toma cortada en su OUT:
 *
 *   3726.94-3726.96  Research
 *   3727.74-3727.74  ¡Suscríbete      ← las tres a la misma hora,
 *   3727.74-3727.74  al                  0,06 s en total,
 *   3727.74-3727.80  canal!              y pegadas al final del recorte
 *
 * Las dos señas son esas: **la misma hora** —tres palabras dichas de verdad
 * nunca empiezan en el mismo milisegundo— y **el sitio**, el último segundo y
 * medio del recorte. Fuera de ahí no se toca nada: a mitad de una clase,
 * «gracias» es una palabra como cualquier otra.
 */

/** Cuánto del final del recorte es la orilla donde Whisper rellena. */
const COLA_SEC = 1.5;

/** Lo más que puede durar una tirada para ser una cola colapsada y no habla. */
const COLAPSADA_SEC = 0.2;

/** Y lo más que pueden separarse dos comienzos para contar como «la misma hora». */
const MISMA_HORA_SEC = 0.02;

/**
 * Los créditos que Whisper escribe de memoria. Van completos y no por palabras
 * sueltas: «gracias» solo es habla, «gracias por ver el video» al filo de un
 * corte no lo dijo nadie.
 */
const APRENDIDAS = [
    /suscr[ií]b[aeí]\w*\s+al\s+canal/i,
    /gracias\s+por\s+ver\s+(el|este)\s+v[ií]deo/i,
    /amara\.org/i,
    /subt[ií]tulos?\s+(realizados|hechos)\s+por/i,
    /subt[ií]tulos?\s+por\s+la\s+comunidad/i
];

/**
 * Las palabras del recorte sin lo que Whisper rellenó en el corte del final.
 *
 * @param {Array} words como salen de Whisper, en segundos del recorte
 * @param {number} finSec cuánto dura el recorte
 * @returns {{words:Array, inventadas:Array}}
 */
function sinColaInventada(words, finSec) {
    const lista = words || [];
    if (lista.length < 2 || !(finSec > 0)) return { words: lista, inventadas: [] };
    const fin = w => (w.end != null ? w.end : w.start);
    // Solo se mira lo que termina pegado al final del recorte.
    const enLaOrilla = i => fin(lista[i]) >= finSec - COLA_SEC;
    if (!enLaOrilla(lista.length - 1)) return { words: lista, inventadas: [] };

    let desde = lista.length;

    // La tirada final que comparte la misma hora de comienzo.
    let i = lista.length - 1;
    while (i > 0 && enLaOrilla(i - 1)
        && Math.abs(lista[i - 1].start - lista[lista.length - 1].start) <= MISMA_HORA_SEC) i--;
    if (lista.length - i >= 2 && fin(lista[lista.length - 1]) - lista[i].start <= COLAPSADA_SEC) {
        desde = i;
    }

    // Y los créditos aprendidos, aunque vengan con horas distintas. La tirada
    // MÁS CORTA que casa, y se para ahí: los créditos se buscan dentro del texto
    // de la tirada, así que una ventana más grande que los contenga casa
    // también, y quedarse con la más grande se llevaba por delante las palabras
    // de verdad que venían antes —medido: «PROMP Research ¡Suscríbete al
    // canal!» se iba entero, y «PROMP Research» sí lo dijo el profesor—.
    //
    // Acá no se le pide a cada palabra que esté en la orilla —con la última ya
    // alcanza, que es la guarda de arriba—: «Subtítulos realizados por la
    // comunidad de Amara.org» son dos segundos, y pedírselo a la primera dejaba
    // el crédito entero sin mirar.
    for (let n = 2; n <= Math.min(8, lista.length); n++) {
        const frase = lista.slice(lista.length - n).map(w => w.text || '').join(' ');
        if (APRENDIDAS.some(re => re.test(frase))) {
            desde = Math.min(desde, lista.length - n);
            break;
        }
    }

    if (desde >= lista.length) return { words: lista, inventadas: [] };
    return { words: lista.slice(0, desde), inventadas: lista.slice(desde) };
}

/**
 * El nivel de cada tramo de 20 ms de un WAV PCM de 16 bits mono, en dBFS.
 *
 * @returns {{hopSec:number, db:Float32Array}|null} null si no es un WAV que se
 *   entienda: quien llama sigue sin filtrar, que es lo que había
 */
function niveles(archivo) {
    let buf;
    try { buf = fs.readFileSync(archivo); } catch (e) { return null; }
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;

    let tasa = 0;
    let canales = 0;
    let bits = 0;
    let datos = null;
    for (let off = 12; off + 8 <= buf.length;) {
        const id = buf.toString('ascii', off, off + 4);
        const largo = buf.readUInt32LE(off + 4);
        const cuerpo = off + 8;
        if (id === 'fmt ') {
            canales = buf.readUInt16LE(cuerpo + 2);
            tasa = buf.readUInt32LE(cuerpo + 4);
            bits = buf.readUInt16LE(cuerpo + 14);
        } else if (id === 'data') {
            datos = buf.subarray(cuerpo, Math.min(buf.length, cuerpo + largo));
            break;
        }
        off = cuerpo + largo + (largo % 2);
    }
    if (!datos || bits !== 16 || canales !== 1 || !tasa) return null;

    const porHop = Math.max(1, Math.round(tasa * HOP_SEC));
    const muestras = Math.floor(datos.length / 2);
    const db = new Float32Array(Math.ceil(muestras / porHop));
    for (let h = 0; h < db.length; h++) {
        let suma = 0;
        const fin = Math.min(muestras, (h + 1) * porHop);
        for (let i = h * porHop; i < fin; i++) {
            const v = datos.readInt16LE(i * 2) / 32768;
            suma += v * v;
        }
        const rms = Math.sqrt(suma / Math.max(1, fin - h * porHop));
        db[h] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    return { hopSec: porHop / tasa, db };
}

/** Cuántos milisegundos, entre dos segundos del recorte, el sonido pasó del corte. */
function arribaMs(n, desdeSec, hastaSec, corte) {
    const a = Math.max(0, Math.floor(desdeSec / n.hopSec));
    const b = Math.min(n.db.length, Math.ceil(hastaSec / n.hopSec));
    let hops = 0;
    for (let i = a; i < b; i++) if (n.db[i] >= corte) hops++;
    return hops * n.hopSec * 1000;
}

/* ─── Los huecos con voz ──────────────────────────────────────────────────
 *
 * Un tramo donde se oye hablar y no quedó escrita ni una palabra. Es la red
 * para lo que los dos filtros de arriba no pueden ver, y para lo que Whisper
 * hace mal por su cuenta.
 *
 * El caso que la trajo, medido sobre la grabación del 13/10 (toma 10, el hueco
 * que el editor reportó entre «Ahí voy.» y «la ausencia»): el profesor calló
 * siete segundos cambiando de slide y después dijo «a raíz de la ausencia…».
 * Whisper, leyendo la toma entera, le puso a CINCO palabras la misma hora
 * —4713,6 s—, que cae en mitad de ese silencio, y el filtro de nivel tiró
 * cuatro porque ahí de verdad no sonaba nada: −82,8 dB contra un corte de −35.
 * Las dos piezas hicieron lo suyo bien y aun así se perdieron dos palabras
 * dichas.
 *
 * Releyendo SOLO ese tramo, las palabras vuelven y con la hora en su sitio:
 * un recorte corto no le deja a Whisper dónde descolocarlas. Así que la red es
 * eso: buscar los huecos donde sonó voz, releerlos aparte y meter lo que salga.
 *
 * No se mira cualquier hueco. Un silencio de verdad —el de cambiar de slide—
 * no tiene nada que recuperar, y releerlo sería pagar una pasada de Whisper
 * para que invente. Se pide que adentro haya voz sostenida, que es lo mismo
 * que le pide `conSonido` a una palabra para creerle.
 */

/** Lo menos que tiene que durar un hueco para mirarlo siquiera. */
const HUECO_MIN_SEC = 2;

/** Y cuánta voz tiene que haber adentro para que valga volver a leerlo. */
const VOZ_EN_HUECO_MS = 600;

/**
 * Los huecos del recorte donde se oyó hablar y no quedó ninguna palabra.
 *
 * @param {Array} words las que QUEDARON, ya filtradas
 * @returns {Array<{desdeSec:number, hastaSec:number, vozMs:number}>}
 */
function huecosConVoz(words, n, corte) {
    const lista = words || [];
    if (!n || lista.length < 2) return [];
    const piso = corte == null ? PISO_DB : corte;
    // Con el MISMO reloj que la salida, que es el `dtw` cuando viene (ver
    // `aHoraDelDia` en `oir.js`). Midiendo el hueco con el `start` crudo se
    // miraba un tramo distinto del que el lector ve: en el caso de la toma 10,
    // el `start` de «de» era 4713,70 y su `dtw` 4714,90, así que el hueco
    // medido caía entero en el silencio y la voz de los últimos 0,9 s —la que
    // había que rescatar— quedaba fuera de la cuenta.
    const empieza = w => (w.dtw != null ? w.dtw : w.start);
    const fin = w => Math.max(w.end != null ? w.end : empieza(w), empieza(w));
    const salida = [];
    for (let i = 1; i < lista.length; i++) {
        const desdeSec = fin(lista[i - 1]);
        const hastaSec = empieza(lista[i]);
        if (hastaSec - desdeSec < HUECO_MIN_SEC) continue;
        const vozMs = Math.round(arribaMs(n, desdeSec, hastaSec, piso));
        if (vozMs >= VOZ_EN_HUECO_MS) salida.push({ desdeSec, hastaSec, vozMs });
    }
    return salida;
}

/** El nivel más alto que alcanzó el sonido entre dos segundos del recorte. */
function picoDb(n, desdeSec, hastaSec) {
    const a = Math.max(0, Math.floor(desdeSec / n.hopSec));
    const b = Math.min(n.db.length, Math.ceil(hastaSec / n.hopSec));
    let max = -120;
    for (let i = a; i < b; i++) if (n.db[i] > max) max = n.db[i];
    return Math.round(max * 10) / 10;
}

/** El valor bajo el cual queda `q` de los tramos. */
function percentil(db, q) {
    const orden = Array.from(db).sort((a, b) => a - b);
    return orden[Math.min(orden.length - 1, Math.floor(q * orden.length))];
}

/**
 * El piso de ruido de una sesión, que se va aprendiendo pasada por pasada.
 * Vive junto a la sesión de captura, no acá: dos clases seguidas no comparten
 * sala ni micrófono.
 */
function seguidor() {
    return { vistos: [] };
}

/**
 * Lo que sonó en una pasada, para el piso. Se guarda el percentil 10 del
 * recorte —o sea lo más callado que hubo en esos segundos— y no el mínimo,
 * que lo movería un solo tramo raro.
 */
function aprender(s, n) {
    if (!s || !n || !n.db.length) return;
    s.vistos.push(percentil(n.db, 0.1));
    if (s.vistos.length > RECUERDO) s.vistos.shift();
}

/**
 * De qué nivel para arriba se le cree a una palabra, con lo aprendido hasta
 * ahora. La mediana de las pasadas y no el promedio: media clase hablando
 * seguido no puede subir el piso.
 *
 * **Las dos primeras pasadas también van con el piso medido.** Antes esperaban
 * a tener tres mediciones y mientras tanto valía `PISO_DB`, que es justo el
 * número que no filtra nada con un micrófono de sala; era una rendija de dos
 * segundos al principio de CADA clase, y por ahí entraba un «Gracias.» del
 * arranque —pasó en la grabación de las 09:08 del 30/09—. No hace falta
 * esperar: `oir.escuchar` mide antes de preguntar el umbral, así que en la
 * primera pasada ya hay un piso, y en esa sesión valía −68,7, o sea bueno.
 *
 * Mientras calienta manda el MÍNIMO y no la mediana. El riesgo de fiarse de una
 * o dos mediciones es que la clase arranque con alguien ya hablando: ahí el
 * percentil de la pasada sale alto, el umbral quedaría estricto y se comería
 * palabras dichas, que es el error caro. El mínimo es la estimación más
 * permisiva de las que hay, así que es la que menos puede equivocarse hacia ese
 * lado. A partir de `MINIMO` ya hay de dónde sacar una mediana.
 */
function umbral(s) {
    if (!s || !s.vistos.length) return PISO_DB;
    const orden = s.vistos.slice().sort((a, b) => a - b);
    const piso = s.vistos.length < MINIMO ? orden[0] : orden[Math.floor(orden.length / 2)];
    return Math.min(TECHO_DB, Math.max(PISO_DB, piso + MARGEN_DB));
}

/**
 * ¿Se habló en algún momento del recorte? Si no, no hace falta ni preguntarle a
 * Whisper: se ahorra la pasada y no hay nada que inventar.
 */
function algoSuena(n, corte) {
    if (!n) return true;
    return arribaMs(n, 0, Infinity, corte == null ? PISO_DB : corte) >= SOSTENIDO_MS;
}

/**
 * Las palabras que tienen sonido alrededor. Los tiempos son segundos dentro del
 * recorte (`start`/`end`, o `dtw` si vino), como salen de Whisper.
 *
 * **Las que se van, se dicen.** `quitadas` lleva cada una con el nivel al que
 * sonaba y el corte contra el que se la midió. Este filtro es el único sitio de
 * la app que puede hacer desaparecer algo que el profesor dijo —un invitado que
 * entra bajo por la llamada queda debajo del corte— y hasta que esto existió
 * eso pasaba sin dejar rastro en ninguna parte: el diario decía que la toma se
 * había releído bien y el texto tenía un hueco. Quien lo use lo anota (ver
 * `relectura.leida` en `relecturas.js`).
 *
 * @returns {{words:Array, mudas:number, quitadas:Array}}
 */
function conSonido(words, n, corte) {
    if (!n) return { words: words || [], mudas: 0, quitadas: [] };
    const piso = corte == null ? PISO_DB : corte;
    const salida = [];
    const quitadas = [];
    for (const w of words || []) {
        const desde = Math.min(w.start, w.dtw != null ? w.dtw : w.start);
        const hasta = Math.max(w.end != null ? w.end : w.start, desde);
        if (arribaMs(n, desde - MARGEN_SEC, hasta + MARGEN_SEC, piso) >= SOSTENIDO_MS) salida.push(w);
        else {
            quitadas.push({
                texto: w.text,
                desdeSec: Math.round(desde * 100) / 100,
                db: picoDb(n, desde - MARGEN_SEC, hasta + MARGEN_SEC),
                corte: Math.round(piso * 10) / 10
            });
        }
    }
    return { words: salida, mudas: quitadas.length, quitadas };
}

module.exports = {
    niveles, algoSuena, conSonido, sinColaInventada, huecosConVoz, picoDb,
    seguidor, aprender, umbral,
    PISO_DB, MARGEN_DB, TECHO_DB, HOP_SEC, MARGEN_SEC, MINIMO, SOSTENIDO_MS,
    COLA_SEC, HUECO_MIN_SEC, VOZ_EN_HUECO_MS
};
