'use strict';
/**
 * audio-app.js — El sonido de una app (Zoom), como fuente de la grabación.
 *
 * La otra fuente es un micrófono o una interfaz, y esa la abre la ventana
 * (`src/js/grabar/oido.js`): `getUserMedia` vive en el navegador. Esta no: el
 * sonido de otra app lo entrega Core Audio a un proceso nativo
 * (`nativo/escuchar-app.swift`), y quien lo lanza y lo lee es Node. La ventana
 * solo pide abrir, empezar a mandar y cerrar, y recibe el nivel.
 *
 * **Lo que sale de acá es idéntico a lo que manda la ventana**: PCM mono Int16
 * en pedazos de 4096 muestras. El tamaño se mantiene para que las dos fuentes
 * entren por el mismo camino y el medidor de la ventana se mueva igual con las
 * dos; la palmada de la claqueta ya no depende de él, porque `aplausos.js`
 * remide todo en marcos de 5 ms venga como venga.
 *
 * Sin estado de la sesión: recibe a quién pasarle cada pedazo (`alPcm`) y a
 * quién avisarle (`avisar`), y el puente (`ipc/grabar.js`) los conecta con la
 * grabación. Así este archivo se prueba con un ayudante de mentira.
 */

const { spawn, spawnSync } = require('child_process');
const paths = require('./paths');

/** Las muestras de un pedazo: las mismas que el worklet de la ventana. */
const MUESTRAS_POR_PEDAZO = 4096;

/**
 * Cada cuánto se le manda el nivel a la ventana.
 *
 * Ochenta milisegundos, unas doce veces por segundo: es lo que tarda en llegar
 * un pedazo del micrófono, así que los dos medidores se mueven igual. Mandarlo
 * con cada lectura de Core Audio sería mandarlo cien veces por segundo para
 * que el ojo vea lo mismo.
 */
const NIVEL_CADA_MS = 80;

/** El bundle de Zoom. Es un prefijo: la app y su proceso de audio lo comparten. */
const ZOOM = 'us.zoom';

/**
 * Sin nada del ayudante por más que esto, la escucha está trabada: se avisa
 * como una caída aunque el proceso siga vivo (la salida del sistema se fue y el
 * dispositivo agregado dejó de dar la hora).
 */
const TRABADO_MS = 1500;

/**
 * Cuánto tiene que faltar, contra el reloj, para rellenar con silencio, y cuánto
 * atraso normal se deja sin rellenar: lo que tarda el audio en cruzar el pipe.
 */
const HUECO_MIN_MS = 1000;
const ATRASO_NORMAL_MS = 250;

/** Sin un «listo» en este tiempo, el ayudante no va a arrancar. */
const ARRANQUE_MAX_MS = 10000;

let hijo = null;
let mandando = false;
let resto = Buffer.alloc(0);
let alPcm = () => {};
let avisar = () => {};
let ultimoNivel = 0;
let pico = 0;
let prefijoAbierto = null;
/** La tasa que dijo el ayudante: la del WAV. */
let tasa = 0;

/**
 * El WAV atado al reloj. Desde que se empieza a mandar, lo mandado tiene que
 * ir a la par de lo que pasó en el reloj: si el ayudante deja de entregar —la
 * salida de audio se fue, el sistema lo trabó, se rearma—, el hueco se rellena
 * con silencio, porque un WAV más corto que la clase corre todos los marcadores
 * que vienen después y el editor ya no puede sincronizar contra la cámara. Y si
 * el audio que faltaba llega tarde (estaba en el pipe), se descuenta del
 * relleno en vez de sumarse: `relleno` es lo que todavía se puede devolver.
 */
let desdeMs = 0;
let mandadas = 0;
let relleno = 0;
let ultimoDatoMs = 0;
let trabado = false;
let vigilante = null;
let reloj = () => Number(process.hrtime.bigint() / 1000000n);

/**
 * El ayudante. `NOTETAKER_ESCUCHAR_APP` lo reemplaza, y existe para las
 * pruebas: el de verdad necesita que macOS le dé permiso de grabar el audio del
 * sistema, y ese permiso no se le puede pedir a una corrida de pruebas.
 */
function ayudante() {
    const propio = process.env.NOTETAKER_ESCUCHAR_APP;
    if (propio) return { path: propio, source: 'NOTETAKER_ESCUCHAR_APP' };
    return paths.resolveTool('escuchar-app');
}

/**
 * Qué apps están usando audio, y si la que se busca está entre ellas.
 *
 * Es lo que la pantalla de Preparar pregunta para decir, antes de que nadie
 * elija nada, si Zoom está abierto.
 *
 * @returns {{soportado:boolean, abierta:boolean, sonando:boolean, error?:string}}
 */
function estado(prefijo) {
    const buscado = prefijo || ZOOM;
    const bin = ayudante();
    if (!bin.path) {
        return { soportado: false, abierta: false, sonando: false,
            error: 'Falta el ayudante que escucha a Zoom (escuchar-app). Corré tools/bundle-binaries.sh.' };
    }
    const r = spawnSync(bin.path, ['--listar'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) {
        return { soportado: false, abierta: false, sonando: false,
            error: leerError(r.stderr) || 'No se pudo preguntar qué apps usan audio.' };
    }
    let lista = [];
    try { lista = JSON.parse(r.stdout); } catch (e) { /* queda vacía */ }
    const suyas = lista.filter(p => String(p.bundle || '').startsWith(buscado));
    return {
        soportado: true,
        abierta: suyas.length > 0,
        sonando: suyas.some(p => p.sonando)
    };
}

function leerError(texto) {
    for (const linea of String(texto || '').split('\n')) {
        try {
            const j = JSON.parse(linea);
            if (j.error) return j.error;
        } catch (e) { /* no era JSON */ }
    }
    return null;
}

/**
 * Empieza a escuchar a la app. Contesta cuando el ayudante dijo que está
 * listo, con la tasa a la que va a llegar el audio, o con el motivo si no.
 *
 * @param {object} p { prefijo, alPcm, avisar }
 * @returns {Promise<{ok:boolean, sampleRate?:number, canales?:number, error?:string, codigo?:string}>}
 */
function abrir(p) {
    const o = p || {};
    cerrar();
    const bin = ayudante();
    if (!bin.path) {
        return Promise.resolve({ ok: false, codigo: 'sin-ayudante',
            error: 'Falta el ayudante que escucha a Zoom. Corré tools/bundle-binaries.sh.' });
    }

    alPcm = typeof o.alPcm === 'function' ? o.alPcm : () => {};
    avisar = typeof o.avisar === 'function' ? o.avisar : () => {};
    resto = Buffer.alloc(0);
    mandando = false;
    pico = 0;
    // El primer nivel sale en el primer pedazo, sin esperar la ventana de 80
    // ms de la entrada anterior: el medidor tiene que moverse apenas se elige.
    ultimoNivel = 0;
    prefijoAbierto = o.prefijo || ZOOM;
    return lanzar(bin.path, false);
}

/**
 * El proceso del ayudante. `rearme` es volver a lanzarlo en medio de la clase,
 * cuando la salida de audio cambió: se sigue mandando a la misma grabación, y
 * el hueco lo rellena `vigilar`.
 *
 * Cada proceso lleva su propio «lo cerré yo»: con uno solo para el módulo, el
 * `exit` de un ayudante viejo llegaba después de abrir el nuevo y lo daba por
 * caído.
 */
function lanzar(ruta, rearme) {
    return new Promise(listo => {
        let contestado = false;
        let errBuf = '';
        let codigoAlSalir = null;
        const contestar = r => {
            if (contestado) return;
            contestado = true;
            clearTimeout(espera);
            listo(r);
        };

        const proc = spawn(ruta, ['--app', prefijoAbierto], { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.cerrando = false;
        hijo = proc;

        // `kAudioAggregateDeviceTapAutoStartKey` hace esperar al arranque hasta
        // que la app suene: con Zoom abierto fuera de una reunión, sin esto
        // Preparar se quedaba esperando para siempre.
        const espera = setTimeout(() => {
            if (contestado) return;
            proc.cerrando = true;
            try { proc.kill('SIGTERM'); } catch (e) { /* ya se fue */ }
            contestar({ ok: false, codigo: 'sin-respuesta',
                error: 'Zoom está abierto pero no entrega sonido. Entrá a la reunión y volvé a intentar.' });
        }, ARRANQUE_MAX_MS);

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', texto => {
            errBuf += texto;
            let corte;
            while ((corte = errBuf.indexOf('\n')) !== -1) {
                const linea = errBuf.slice(0, corte);
                errBuf = errBuf.slice(corte + 1);
                let j = null;
                try { j = JSON.parse(linea); } catch (e) { continue; }
                if (j.listo) {
                    tasa = Math.round(j.sampleRate);
                    contestar({ ok: true, sampleRate: tasa, canales: 1, procesos: j.procesos,
                        tasaDelDispositivo: j.tasaDelDispositivo || null });
                    if (rearme) avisar({ tipo: 'rearmada', mensaje: 'Cambió la salida de audio: la escucha de Zoom se rearmó sola.' });
                    vigilar();
                } else if (j.error) {
                    codigoAlSalir = j.codigo || null;
                    contestar({ ok: false, error: j.error, codigo: j.codigo });
                } else {
                    // Lo que el ayudante cuenta en medio de la escucha: una tasa
                    // que cambió, muestras que no cupieron, el micrófono apagado.
                    avisar({ tipo: 'ayudante', ...j });
                }
            }
        });

        proc.stdout.on('data', datos => { if (hijo === proc) recibir(datos); });

        proc.on('error', err => contestar({ ok: false, codigo: 'spawn', error: err.message }));
        // `close` y no `exit`: `exit` puede llegar antes de que se lea la última
        // línea de stderr, y esa es la que dice si se fue por la salida de audio
        // (y hay que rearmar) o por otra cosa (y es una caída).
        proc.on('close', (codigo, senal) => {
            contestar({ ok: false, codigo: 'salio', error: `El ayudante salió (${codigo ?? senal}).` });
            if (hijo !== proc) return;
            hijo = null;
            if (proc.cerrando) return;
            // La salida de audio cambió: se vuelve a lanzar sobre la nueva, y la
            // grabación sigue. Solo si ya estaba andando: en el primer arranque
            // eso es un error y se contesta como tal.
            if (codigoAlSalir === 'salida-cambio' && tasa) {
                lanzar(ruta, true).then(r => {
                    if (!r.ok) avisar({ tipo: 'caido', codigo: r.codigo || 'rearme', senal: null });
                });
                return;
            }
            // Si se fue solo, en medio de una clase, eso es una caída y hay
            // que decirlo: la pantalla se pone en rojo igual que cuando se
            // desenchufa un micrófono, y lo escrito queda en el disco.
            avisar({ tipo: 'caido', codigo, senal: senal || null });
        });
    });
}

/**
 * Lo que llega del ayudante, en pedazos del tamaño que usa el resto del motor.
 *
 * Core Audio entrega lo que se le antoja —512 muestras, 480, lo que pida el
 * dispositivo de salida— y se re-empaqueta en 4096 (ver arriba).
 */
function recibir(datos) {
    const antes = ultimoDatoMs;
    ultimoDatoMs = reloj();
    const trasHueco = ultimoDatoMs - antes > ATRASO_NORMAL_MS * 2;
    if (trabado) {
        trabado = false;
        avisar({ tipo: 'vuelve' });
    }
    // Lo que llega tarde después de haber rellenado: ya está puesto como
    // silencio, así que se descuenta del relleno en vez de correr el reloj.
    if (relleno > 0 && mandando && tasa) {
        const sobra = mandadas + resto.length / 2 + datos.length / 2 - esperadas() - tasa * ATRASO_NORMAL_MS / 1000;
        const devolver = Math.min(relleno, Math.floor(sobra), Math.floor(datos.length / 2));
        if (devolver > 0) {
            datos = datos.subarray(devolver * 2);
            relleno -= devolver;
        }
    }
    empaquetar(datos);
    // Al volver de un hueco, lo que todavía falta se completa ya: `revisar`
    // rellena de a pedazos mientras no llega nada, y el último pedazo del hueco
    // quedaba sin poner. Si lo que vuelve es el atraso del pipe y sigue
    // llegando, se descuenta de este relleno arriba, en la vuelta siguiente.
    if (trasHueco && mandando && tasa) {
        const falta = esperadas() - mandadas - resto.length / 2 - tasa * ATRASO_NORMAL_MS / 1000;
        if (falta > tasa * 0.1) {
            const poner = Math.floor(falta);
            relleno += poner;
            avisar({ tipo: 'relleno', segundos: Math.round(poner / tasa * 10) / 10 });
            empaquetar(Buffer.alloc(poner * 2));
        }
    }
}

function empaquetar(datos) {
    resto = resto.length ? Buffer.concat([resto, datos]) : datos;
    const bytes = MUESTRAS_POR_PEDAZO * 2;
    while (resto.length >= bytes) {
        const pedazo = Buffer.from(resto.subarray(0, bytes));
        resto = resto.subarray(bytes);

        // Se manda PRIMERO, igual que en la ventana: si medir tirara una
        // excepción, el audio ya salió, y lo que se está grabando no se puede
        // repetir.
        if (mandando) {
            mandadas += MUESTRAS_POR_PEDAZO;
            try { alPcm(pedazo); } catch (e) { avisar({ tipo: 'error', mensaje: e.message }); }
        }

        for (let i = 0; i < pedazo.length; i += 2) {
            const v = Math.abs(pedazo.readInt16LE(i)) / 32768;
            if (v > pico) pico = v;
        }
        const ahora = Date.now();
        if (ahora - ultimoNivel >= NIVEL_CADA_MS) {
            ultimoNivel = ahora;
            avisar({ tipo: 'nivel', pico });
            pico = 0;
        }
    }
}

/** Cuántas muestras tendría que haber mandado a esta altura, por el reloj. */
function esperadas() {
    return (reloj() - desdeMs) / 1000 * tasa;
}

/**
 * Cada cuarto de segundo: ¿sigue llegando audio? Si no, se dice (una vez) y,
 * si ya se está grabando, se rellena el hueco para que el WAV no se atrase
 * contra el reloj.
 */
function revisar() {
    if (!hijo || !tasa) return;
    const ahora = reloj();
    const callado = ahora - ultimoDatoMs;
    if (callado > TRABADO_MS && !trabado) {
        trabado = true;
        avisar({ tipo: 'caido', codigo: 'sin-datos', senal: null });
    }
    if (!mandando || callado < ATRASO_NORMAL_MS * 2) return;
    const falta = esperadas() - mandadas - resto.length / 2;
    if (falta < tasa * HUECO_MIN_MS / 1000) return;
    const poner = Math.floor(falta - tasa * ATRASO_NORMAL_MS / 1000);
    if (poner <= 0) return;
    relleno += poner;
    avisar({ tipo: 'relleno', segundos: Math.round(poner / tasa * 10) / 10 });
    empaquetar(Buffer.alloc(poner * 2));
}

function vigilar() {
    ultimoDatoMs = reloj();
    if (vigilante) return;
    vigilante = setInterval(revisar, 250);
    if (vigilante.unref) vigilante.unref();
}

/** Desde acá los pedazos van a la grabación. Antes solo se medían. */
function empezarAMandar() {
    mandando = true;
    // El reloj arranca con lo primero que se manda, que es lo primero del WAV.
    desdeMs = reloj() - (resto.length / 2) / Math.max(1, tasa) * 1000;
    mandadas = 0;
    relleno = 0;
}
function dejarDeMandar() { mandando = false; }

function abierto() { return Boolean(hijo); }

function cerrar() {
    mandando = false;
    if (vigilante) { clearInterval(vigilante); vigilante = null; }
    trabado = false;
    tasa = 0;
    if (!hijo) return;
    hijo.cerrando = true;
    try { hijo.kill('SIGTERM'); } catch (e) { /* ya se había ido */ }
    hijo = null;
}

module.exports = {
    ZOOM,
    MUESTRAS_POR_PEDAZO,
    estado,
    abrir,
    recibir,
    empezarAMandar,
    dejarDeMandar,
    abierto,
    cerrar,
    // Para las pruebas, que reemplazan el ayudante por uno de mentira y el reloj
    // por uno que avanza a mano.
    _conectar(p) {
        alPcm = p.alPcm || alPcm;
        avisar = p.avisar || avisar;
        resto = Buffer.alloc(0);
        ultimoNivel = 0;
        pico = 0;
        tasa = p.tasa || 48000;
        if (p.reloj) reloj = p.reloj;
        mandando = false;
        if (p.mandando) empezarAMandar();
        ultimoDatoMs = reloj();
        trabado = false;
    },
    _revisar: revisar,
    _mandadas: () => mandadas,
    _fingirHijo(si) { hijo = si ? { cerrando: false } : null; }
};
