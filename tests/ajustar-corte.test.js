'use strict';
/**
 * Los cortes que caían encima de una palabra. El caso real: el 29/09, de los 72
 * bordes de una clase de tres horas, 58 caían sobre energía de voz porque las
 * marcas de palabra de Whisper se corren un par de décimas, y el montajista
 * cortaba por ahí y partía la palabra en dos.
 *
 * Los WAV son sintéticos y dicen en su forma lo que se está probando: dónde hay
 * voz, dónde hay silencio y cuánto dura cada cosa.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ajustar = require('../engine/ajustar-corte');
const espejo = require('../engine/espejo');
const notasXml = require('../engine/notas-xml');
const sesionesGrabadas = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');

/** El piso de ruido medido con AirPods: −65 dBFS, no silencio digital. */
const RUIDO = Math.pow(10, -65 / 20) * Math.SQRT2;
/** Voz normal de la clase: −22 dBFS. */
const VOZ = Math.pow(10, -22 / 20) * Math.SQRT2;

/**
 * Un WAV de 16 kHz mono con la forma que se le pida.
 *
 * `tramos` es [[segundos, amplitud], …], igual que en `sonido.test.js`. El
 * silencio se escribe con el RUIDO del micrófono y no con ceros: el umbral se
 * estima del propio archivo, y un archivo de ceros exactos no probaría nada de
 * lo que pasa con un micrófono de verdad.
 */
function wav(tramos, nombre) {
    const tasa = 16000;
    const muestras = [];
    for (const [seg, amp] of tramos) {
        for (let i = 0; i < Math.round(seg * tasa); i++) {
            muestras.push(Math.round(Math.sin(i / 5) * amp * 32767));
        }
    }
    const datos = Buffer.alloc(muestras.length * 2);
    muestras.forEach((v, i) => datos.writeInt16LE(v, i * 2));
    const cab = Buffer.alloc(44);
    cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
    cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
    cab.writeUInt32LE(tasa, 24); cab.writeUInt32LE(tasa * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
    cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-ajuste-'));
    const archivo = path.join(dir, nombre || 'x.wav');
    fs.writeFileSync(archivo, Buffer.concat([cab, datos]));
    ajustar.olvidar();
    return archivo;
}

/**
 * Le agrega segundos de sala al final de un WAV, con la cabecera al día.
 *
 * Es lo que hace `captura.js` en cada pedazo, y un WAV que crece es el caso que
 * no se puede probar con un archivo quieto: en vivo una toma se ajusta con el
 * audio que hay y se rehace cuando llega el resto.
 */
function agregar(archivo, segundos, amp) {
    const tasa = 16000;
    const cuantas = Math.round(segundos * tasa);
    const datos = Buffer.alloc(cuantas * 2);
    for (let i = 0; i < cuantas; i++) {
        datos.writeInt16LE(Math.round(Math.sin(i / 5) * (amp == null ? RUIDO : amp) * 32767), i * 2);
    }
    fs.appendFileSync(archivo, datos);
    const bytes = fs.statSync(archivo).size - 44;
    const fd = fs.openSync(archivo, 'r+');
    const tamanos = Buffer.alloc(4);
    tamanos.writeUInt32LE(36 + bytes, 0);
    fs.writeSync(fd, tamanos, 0, 4, 4);
    tamanos.writeUInt32LE(bytes, 0);
    fs.writeSync(fd, tamanos, 0, 4, 40);
    fs.closeSync(fd);
}

/**
 * Los niveles de todo el archivo, como los ve el ajuste.
 *
 * `umbralDb` se saca igual que en producción: el piso es de la sesión y el
 * umbral se calcula del tramo que se le va a pasar a `mejorInstante`.
 */
function tramoEntero(archivo) {
    const w = ajustar.abrir(archivo);
    const tramo = ajustar.nivelesDeTramo(w, 0, w.segundos);
    const umbral = ajustar.umbralDe(w);
    ajustar.cerrar(w);
    return { tramo, umbral, umbralDb: umbral ? ajustar.umbralLocal(tramo, umbral.pisoDb) : null };
}

/**
 * Cuatro palabras de 300 ms separadas por huecos de 200 ms, con un minuto de
 * sala antes y después para que el piso se pueda estimar.
 *
 * La palabra del medio empieza en 30,0 s y termina en 30,3: un corte en 30,15
 * cae justo en su mitad.
 *
 * @param {number} [cola] cuánta sala queda después de la última palabra
 */
function cuatroPalabras(cola) {
    return wav([
        [30 - 0.5 - 0.3 - 0.2, RUIDO],
        [0.3, VOZ], [0.2, RUIDO], // palabra 1, hueco
        [0.3, VOZ],               // palabra 2: 29,5 → 29,8
        [0.2, RUIDO],             // hueco:    29,8 → 30,0
        [0.3, VOZ],               // palabra 3: 30,0 → 30,3  ← la del medio
        [0.2, RUIDO],             // hueco:    30,3 → 30,5
        [0.3, VOZ],               // palabra 4: 30,5 → 30,8
        [cola == null ? 30 : cola, RUIDO]
    ]);
}

module.exports = function (t) {
    t.group('ajustar-corte · el umbral se estima del audio');

    t.test('el piso de ruido del micrófono no se confunde con la voz', () => {
        const { umbral, umbralDb } = tramoEntero(cuatroPalabras());
        t.ok(umbral != null, 'el archivo tiene contraste');
        t.ok(umbral.pisoDb < -60, `el piso salió ${umbral.pisoDb.toFixed(1)} dB`);
        t.ok(umbralDb > umbral.pisoDb, 'el umbral está por encima del piso');
        t.ok(umbralDb < -30, `y bien por debajo de la voz (${umbralDb.toFixed(1)} dB)`);
    });

    t.test('un archivo sin contraste no se ajusta: no hay silencios que buscar', () => {
        // Puro ruido de sala de punta a punta: entre el piso y la "voz" no hay
        // los doce dB que hacen falta para creerle a la medición.
        const { umbral } = tramoEntero(wav([[10, RUIDO]]));
        t.eq(umbral, null);
    });

    t.test('un micrófono con menos ruido no mueve el umbral: la voz manda', () => {
        // Es el bug que trajo el DJI Mic Mini. El mismo profesor, la misma sala y
        // los mismos huecos entre palabras, con un micrófono que tiene veinte dB
        // menos de ruido propio: el piso se fue de −65 a −85 y el umbral viejo se
        // fue con él, veinte dB por debajo de donde están los huecos.
        const conPiso = pisoDb => {
            const ruido = Math.pow(10, pisoDb / 20) * Math.SQRT2;
            const w = ajustar.abrir(wav([
                [30, ruido], [0.3, VOZ], [0.2, ruido], [0.3, VOZ], [30, ruido]
            ]));
            // La ventana de un borde, del tamaño que la lee `ajustarSesion`.
            const tramo = ajustar.nivelesDeTramo(w, 29.5, 31);
            const piso = ajustar.umbralDe(w).pisoDb;
            ajustar.cerrar(w);
            return { umbral: ajustar.umbralLocal(tramo, piso), piso };
        };
        const airpods = conPiso(-65);
        const dji = conPiso(-85);
        t.ok(dji.piso < airpods.piso - 15, `el piso bajó de verdad (${dji.piso.toFixed(1)} dB)`);
        t.near(dji.umbral, airpods.umbral, 1.5,
            `el umbral se quedó donde la voz (${dji.umbral.toFixed(1)} vs ${airpods.umbral.toFixed(1)} dB)`);
        // Y el hueco de 200 ms entre las dos palabras sigue encontrándose con
        // los dos micrófonos, que es para lo que existe el umbral.
        t.ok(dji.umbral > dji.piso + ajustar.CAIDA_DE_LA_VOZ_DB, 'sin quedar pegado al piso');
    });

    t.group('ajustar-corte · el corte en mitad de una palabra se va al silencio');

    t.test('un IN en mitad de la palabra se corre al hueco de ANTES', () => {
        const { tramo, umbralDb } = tramoEntero(cuatroPalabras());
        const r = ajustar.mejorInstante(tramo, 30.15, umbralDb, 'in');
        t.eq(r.porQue, 'silencio');
        // El hueco de antes es 29,8 → 30,0. Con la guarda, el IN queda pegado al
        // arranque de la palabra pero antes de él.
        t.ok(r.sec > 29.8 && r.sec < 30.0, `quedó en ${r.sec.toFixed(3)} s`);
        t.near(r.sec, 30.0 - ajustar.GUARDA_SEC, 0.03, 'a una guarda del ataque');
    });

    t.test('un OUT en mitad de la palabra se corre al hueco de DESPUÉS', () => {
        const { tramo, umbralDb } = tramoEntero(cuatroPalabras());
        const r = ajustar.mejorInstante(tramo, 30.15, umbralDb, 'out');
        t.eq(r.porQue, 'silencio');
        // El hueco de después es 30,3 → 30,5, y el OUT se pega a la cola.
        t.ok(r.sec > 30.3 && r.sec < 30.5, `quedó en ${r.sec.toFixed(3)} s`);
        t.near(r.sec, 30.3 + ajustar.GUARDA_SEC, 0.03, 'a una guarda de la cola');
    });

    t.test('el corte que ya cae en un silencio no se mueve ni un milisegundo', () => {
        const { tramo, umbralDb } = tramoEntero(cuatroPalabras());
        const r = ajustar.mejorInstante(tramo, 30.4, umbralDb, 'in');
        t.eq(r.porQue, 'ya-en-silencio');
        t.eq(r.sec, 30.4);
    });

    t.test('el corte nunca queda pegado al ataque: siempre a más de un cuadro', () => {
        const { tramo, umbralDb } = tramoEntero(cuatroPalabras());
        for (const lado of ['in', 'out']) {
            for (const t0 of [30.05, 30.15, 30.25]) {
                const r = ajustar.mejorInstante(tramo, t0, umbralDb, lado);
                const distancias = ajustar.silencios(tramo, umbralDb)
                    .filter(h => r.sec >= h.desde && r.sec <= h.hasta)
                    .map(h => Math.min(r.sec - h.desde, h.hasta - r.sec));
                t.ok(distancias.length, `${lado} en ${t0}: el punto cae en un silencio`);
                t.ok(distancias[0] >= ajustar.MARGEN_MINIMO_SEC - 0.011,
                    `${lado} en ${t0}: quedó a ${(distancias[0] * 1000).toFixed(0)} ms de la voz`);
            }
        }
    });

    t.group('ajustar-corte · sin silencio no se inventa nada');

    t.test('en mitad de una frase seguida el tiempo NO se mueve', () => {
        // Diez segundos de voz sin un hueco: no hay adónde correr el corte, y
        // moverlo a cualquier parte sería peor que dejarlo.
        const archivo = wav([[30, RUIDO], [10, VOZ], [30, RUIDO]]);
        const { tramo, umbralDb } = tramoEntero(archivo);
        for (const lado of ['in', 'out']) {
            const r = ajustar.mejorInstante(tramo, 35, umbralDb, lado);
            t.eq(r.porQue, 'sin-silencio', lado);
            t.eq(r.sec, 35, `${lado}: el tiempo quedó tal cual`);
        }
    });

    t.test('el silencio de una oclusiva no cuenta: 60 ms adentro de una palabra', () => {
        // La /p/ de "papá" tiene entre 50 y 100 ms de silencio ADENTRO de la
        // palabra. Un mínimo más corto encontraría ese hueco y cortaría en mitad
        // de la palabra creyendo que la respetaba.
        const archivo = wav([
            [30, RUIDO],
            // Una sola palabra de 30,0 a 30,66, con su oclusiva en 30,3 → 30,36.
            [0.3, VOZ], [0.06, RUIDO], [0.3, VOZ],
            [30, RUIDO]
        ]);
        const { tramo, umbralDb } = tramoEntero(archivo);
        t.eq(ajustar.silencios(tramo, umbralDb)
            .filter(h => h.desde > 30.1 && h.hasta < 30.6).length, 0,
        'la oclusiva no figura como silencio');
        // El IN cae en 30,2. La oclusiva está a 100 ms y el silencio de verdad a
        // 240: si la oclusiva contara, ganaría por cercanía y el corte quedaría
        // en mitad de la palabra.
        const r = ajustar.mejorInstante(tramo, 30.2, umbralDb, 'in');
        t.eq(r.porQue, 'silencio');
        t.ok(r.sec < 30.0, `se fue al hueco de antes de la palabra (${r.sec.toFixed(3)} s)`);
    });

    t.test('un silencio a más de la ventana no arrastra el corte hasta allá', () => {
        // Un hueco a dos segundos es otro punto del discurso. La ventana es de
        // unos cientos de milisegundos justamente para que eso no pase.
        const archivo = wav([[30, RUIDO], [2, VOZ], [1, RUIDO], [2, VOZ], [30, RUIDO]]);
        const { tramo, umbralDb } = tramoEntero(archivo);
        const r = ajustar.mejorInstante(tramo, 31, umbralDb, 'out');
        t.eq(r.porQue, 'sin-silencio');
        t.eq(r.sec, 31);
    });

    t.group('ajustar-corte · la sesión entera');

    /** Una sesión con una sola toma cuyos dos bordes caen sobre la palabra. */
    function sesionDe(archivo, inSec, outSec, extra) {
        const cero = 1790772000000;
        return {
            secuencia: 'prueba-de-ajuste',
            fps: 30,
            ceroMs: cero,
            // Cerrada: el WAV ya no va a crecer, así que un borde pegado al final
            // del archivo se mira una vez y no en cada escritura.
            terminada: cero + 70000,
            claquetas: [],
            sesiones: [{
                id: 1, archivo, desdeMs: cero, sampleRate: 16000, canales: 1,
                segundos: ajustar.abrir(archivo).segundos
            }],
            tomas: [{
                id: 1, vista: 'PV', comentario: '', cuenta: '3, 2, 1.',
                inMs: cero + inSec * 1000, outMs: cero + outSec * 1000,
                descartada: false, palabras: [], antes: [], despues: [],
                comentarios: [], ...(extra || {})
            }]
        };
    }

    t.test('los dos bordes de la toma se corren y los originales no se tocan', () => {
        const archivo = cuatroPalabras();
        const e = sesionDe(archivo, 30.15, 60);
        const inAntes = e.tomas[0].inMs;
        const cuenta = ajustar.ajustarSesion(e);
        t.eq(cuenta.tomas, 1);
        t.eq(e.tomas[0].inMs, inAntes, 'el IN que marcó el editor sigue intacto');
        t.eq(e.tomas[0].ajuste.porQueIn, 'silencio');
        t.ok(ajustar.inAjustado(e.tomas[0]) < inAntes, 'y el ajustado se fue para atrás');
        t.ok(Math.abs(ajustar.inAjustado(e.tomas[0]) - inAntes) < 400,
            'sin salirse de la ventana');
    });

    t.test('sin audio no se ajusta nada y no se tira', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        e.sesiones[0].archivo = '/no/existe/nada.wav';
        ajustar.ajustarSesion(e);
        t.eq(ajustar.inAjustado(e.tomas[0]), e.tomas[0].inMs);
        t.eq(e.tomas[0].ajuste.porQueIn, 'sin-audio');
    });

    t.test('un borde movido a mano invalida el ajuste viejo', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        ajustar.ajustarSesion(e);
        const ajustado = ajustar.inAjustado(e.tomas[0]);
        t.ok(ajustado !== e.tomas[0].inMs);
        // El editor arrastra la línea roja: el ajuste guardado apunta a otro
        // sitio y no se puede usar.
        e.tomas[0].inMs += 5000;
        t.eq(ajustar.inAjustado(e.tomas[0]), e.tomas[0].inMs, 'manda lo que marcó el editor');
    });

    t.test('una toma corta no se da vuelta', () => {
        // Un conteo mal oído deja tomas de un tercio de segundo. Si el IN
        // ajustado se pasara del OUT, el marcador de entrada quedaría después
        // del de salida y el par se leería al revés.
        const e = sesionDe(cuatroPalabras(), 30.15, 30.2);
        ajustar.ajustarSesion(e);
        t.ok(ajustar.inAjustado(e.tomas[0]) < ajustar.outAjustado(e.tomas[0]));
    });

    t.test('una toma descartada no se mira: no va al XML', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60, { descartada: true });
        const cuenta = ajustar.ajustarSesion(e);
        t.eq(cuenta.tomas, 0);
        t.eq(e.tomas[0].ajuste, undefined);
    });

    t.group('ajustar-corte · lo que llega al XML');

    t.test('el marcador de la toma usa el borde ajustado', () => {
        const archivo = cuatroPalabras();
        const e = sesionDe(archivo, 30.15, 60);
        const sinAjuste = notasXml.marcadores(JSON.parse(JSON.stringify(e)));
        ajustar.ajustarSesion(e);
        const conAjuste = notasXml.marcadores(e);
        const de = m => m.find(x => x.name === 'Toma 1 · PV').startSec;
        t.ok(de(conAjuste) < de(sinAjuste), 'el IN del marcador se movió');
        t.near(de(conAjuste), de(sinAjuste) - 0.21, 0.08, 'unos 200 ms para atrás');
    });

    t.test('las claquetas y los comentarios sobre el texto NO se mueven', () => {
        const archivo = cuatroPalabras();
        const e = sesionDe(archivo, 30.15, 60);
        // Una claqueta y un comentario, los dos en mitad de una palabra.
        e.claquetas = [{ n: 1, ms: e.ceroMs + 30150, paredMs: e.ceroMs + 30150, confirmada: true }];
        e.tomas[0].comentarios = [{
            desdeMs: e.ceroMs + 30150, hastaMs: e.ceroMs + 30200,
            texto: 'x', comentario: 'acá se traba'
        }];
        ajustar.ajustarSesion(e);
        const marcas = notasXml.marcadores(e);
        // Una claqueta señala un golpe y un comentario señala una frase: ninguno
        // corta nada, y moverlos rompería justamente para lo que existen.
        t.eq(marcas.find(m => m.name === 'Claqueta 1').startSec, 30.15);
        t.eq(marcas.find(m => m.name === 'Nota').startSec, 30.15);
    });

    t.test('el sidecar guarda el ajuste y el tiempo original', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        ajustar.ajustarSesion(e);
        const s = notasXml.sidecar(e);
        t.eq(s.tomas[0].inMs, e.tomas[0].inMs, 'el original va como estaba');
        t.eq(s.tomas[0].ajuste.deInMs, e.tomas[0].inMs, 'y el ajuste dice contra qué se hizo');
        t.ok(s.tomas[0].ajuste.inMs !== e.tomas[0].inMs);
        // Y al volver a entrar, el XML sale con el mismo corte sin mirar audio.
        const vuelto = notasXml.estadoLeido(JSON.parse(JSON.stringify(s)));
        t.eq(ajustar.inAjustado(vuelto.tomas[0]), ajustar.inAjustado(e.tomas[0]));
    });

    t.test('una toma sin ajuste escribe el tiempo que marcó el editor', () => {
        // Es el sidecar de una clase vieja, de antes de que esto existiera.
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        t.eq(ajustar.inAjustado(e.tomas[0]), e.tomas[0].inMs);
        t.eq(ajustar.outAjustado(e.tomas[0]), e.tomas[0].outMs);
    });

    t.group('ajustar-corte · la clase que se está grabando');

    t.test('el XML que se escribe en vivo ya sale con los cortes ajustados', () => {
        const archivo = cuatroPalabras();
        const e = sesionDe(archivo, 30.15, 45);
        // En vivo la sesión está ABIERTA y el audio todavía crece: el WAV que se
        // está escribiendo va aparte, en `captura`.
        delete e.terminada;
        const captura = e.sesiones.pop();
        const sesion = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-vivo-')), captura, estado: { ...e, sesiones: [] } };
        sesion.estado.tomas = e.tomas;

        const archivos = espejo.escribir(sesion);
        const marca = notasXml.marcadores({ ...sesion.estado, sesiones: [captura] })
            .find(m => m.name === 'Toma 1 · PV');
        t.ok(marca.startSec < 30.15, `el marcador salió en ${marca.startSec.toFixed(3)} s`);
        // Y el ajuste quedó en el estado de la sesión, no solo en el archivo: es
        // lo que evita volver a mirar la onda en cada escritura.
        t.eq(sesion.estado.tomas[0].ajuste.porQueIn, 'silencio');
        t.ok(fs.readFileSync(archivos.xml, 'utf8').includes('Toma 1 · PV'));
    });

    t.test('un borde pegado al final del audio se vuelve a mirar cuando llega la cola', () => {
        // Una toma se cierra en el instante en que el profesor dice "pausa", y la
        // cola que la ventana quiere mirar todavía no está escrita. Se ajusta con
        // lo que hay, se marca, y la escritura siguiente lo rehace.
        const archivo = cuatroPalabras(0.4); // el WAV termina en 31,2
        const e = sesionDe(archivo, 30.15, 30.9);
        delete e.terminada;
        ajustar.ajustarSesion(e);
        t.eq(e.tomas[0].ajuste.provisional, true, 'le falta cola para decidir');

        // Sigue entrando audio: el WAV crece y la sesión llega más lejos.
        agregar(archivo, 14);
        const w = ajustar.abrir(archivo);
        e.sesiones[0].segundos = w.segundos;
        ajustar.cerrar(w);
        ajustar.ajustarSesion(e);
        t.eq(e.tomas[0].ajuste.provisional, undefined, 'y ahora el ajuste queda firme');
    });

    t.group('ajustar-corte · «Rehacer XML»');

    /** Una sesión escrita en el disco con la forma de una carpeta de verdad. */
    function enElDisco(estado) {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-rehacer-'));
        fs.mkdirSync(workspace.datosDir(base), { recursive: true });
        fs.mkdirSync(workspace.audioDir(base), { recursive: true });
        const wavDestino = path.join(workspace.audioDir(base),
            path.basename(estado.sesiones[0].archivo));
        fs.copyFileSync(estado.sesiones[0].archivo, wavDestino);
        // La ruta guardada es la de entonces, que ya no existe: es el caso de
        // una carpeta que se movió, y el WAV se busca por su nombre.
        const archivos = workspace.archivosDeSesion(base, workspace.safeName(estado.secuencia));
        workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
        workspace.writeJson(archivos.json, notasXml.sidecar(estado));
        return archivos;
    }

    t.test('rehacer el XML de una clase vieja le ajusta los cortes', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        const archivos = enElDisco(e);
        const antes = fs.readFileSync(archivos.xml, 'utf8');

        const r = sesionesGrabadas.rehacerXml(archivos.json);
        t.eq(r.tomas, 1);
        // El IN caía en mitad de la palabra y se corrió; el OUT ya estaba en el
        // silencio del final y se quedó donde estaba.
        t.eq(r.bordesAjustados, 1);
        const despues = fs.readFileSync(archivos.xml, 'utf8');
        t.ok(antes !== despues, 'el XML cambió');
        t.eq(JSON.parse(fs.readFileSync(archivos.json, 'utf8')).tomas[0].inMs,
            e.tomas[0].inMs, 'y el sidecar sigue diciendo lo que marcó el editor');
    });

    t.test('rehacerlo dos veces da el mismo XML', () => {
        const archivos = enElDisco(sesionDe(cuatroPalabras(), 30.15, 60));
        const uno = sesionesGrabadas.rehacerXml(archivos.json);
        const primero = fs.readFileSync(archivos.xml, 'utf8');
        const dos = sesionesGrabadas.rehacerXml(archivos.json);
        t.eq(dos.bordesAjustados, uno.bordesAjustados);
        t.eq(fs.readFileSync(archivos.xml, 'utf8'), primero);
    });

    t.test('rehacerlo sin el WAV escribe el mismo corte y no pierde notas', () => {
        const e = sesionDe(cuatroPalabras(), 30.15, 60);
        e.tomas[0].palabras = [{ t: e.ceroMs + 30200, texto: 'hola' }];
        const archivos = enElDisco(e);
        sesionesGrabadas.rehacerXml(archivos.json);
        const conAudio = fs.readFileSync(archivos.xml, 'utf8');

        // Se borra el audio: el ajuste ya está en el sidecar, que es lo que hace
        // que esto no pueda empeorar un XML que ya estaba bien.
        const sitio = workspace.sesionDelSidecar(archivos.json);
        for (const n of fs.readdirSync(sitio.audio)) fs.unlinkSync(path.join(sitio.audio, n));
        const r = sesionesGrabadas.rehacerXml(archivos.json);
        t.eq(fs.readFileSync(archivos.xml, 'utf8'), conAudio, 'el mismo XML');
        t.eq(r.tomas, 1);
        t.deep(JSON.parse(fs.readFileSync(archivos.json, 'utf8'))
            .tomas[0].palabras.map(w => w.texto), ['hola']);
    });
};
