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
 * en pedazos de 4096 muestras. El tamaño no es cosmético: `golpe.js` mide el
 * pico y el promedio de cada pedazo para decidir si fue un aplauso, y sus
 * umbrales se midieron con pedazos de ese tamaño. Con pedazos del largo que se
 * le ocurra entregar a Core Audio, el mismo aplauso mediría distinto.
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
 * Cuánto se mira para saber a qué ritmo llegan las muestras, cuánto se espera
 * antes de la primera medición, y cuánto tiene que apartarse de lo declarado
 * para creerle a la medición y no a la declaración.
 */
const VENTANA_DE_TASA_MS = 6000;
const PRIMERA_MEDICION_MS = 4000;
const TOLERANCIA_DE_TASA = 0.05;
const TASAS = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];

let hijo = null;
let mandando = false;
/** La tasa que dijo el ayudante (la del WAV) y la que de verdad trae el audio. */
let tasaDeclarada = 0;
let tasaReal = 0;
/** [ms, muestras acumuladas]: lo último que llegó, para medir la tasa. */
let marcas = [];
let muestrasTotales = 0;
let candidata = 0;
/** El estado del remuestreo, entre pedazos seguidos (ver `remuestrear`). */
let fase = 0;
let previa = 0;
let reloj = () => Date.now();
let resto = Buffer.alloc(0);
let alPcm = () => {};
let avisar = () => {};
let ultimoNivel = 0;
let pico = 0;
/** Lo que se cerró a propósito no es una caída: no se avisa como tal. */
let cerrando = false;

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
    reiniciarTasa(0);
    mandando = false;
    cerrando = false;
    pico = 0;
    // El primer nivel sale en el primer pedazo, sin esperar la ventana de 80
    // ms de la entrada anterior: el medidor tiene que moverse apenas se elige.
    ultimoNivel = 0;

    return new Promise(listo => {
        let contestado = false;
        let errBuf = '';
        const contestar = r => { if (!contestado) { contestado = true; listo(r); } };

        const proc = spawn(bin.path, ['--app', o.prefijo || ZOOM], { stdio: ['ignore', 'pipe', 'pipe'] });
        hijo = proc;

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
                    tasaDeclarada = tasaReal = Math.round(j.sampleRate);
                    contestar({ ok: true, sampleRate: tasaDeclarada, canales: 1, procesos: j.procesos,
                        tasaDelDispositivo: j.tasaDelDispositivo || null });
                } else if (j.error) {
                    contestar({ ok: false, error: j.error, codigo: j.codigo });
                }
            }
        });

        proc.stdout.on('data', recibir);

        proc.on('error', err => contestar({ ok: false, codigo: 'spawn', error: err.message }));
        proc.on('exit', (codigo, senal) => {
            if (hijo === proc) hijo = null;
            contestar({ ok: false, codigo: 'salio', error: `El ayudante salió (${codigo ?? senal}).` });
            // Si se fue solo, en medio de una clase, eso es una caída y hay
            // que decirlo: la pantalla se pone en rojo igual que cuando se
            // desenchufa un micrófono, y lo escrito queda en el disco.
            if (!cerrando) avisar({ tipo: 'caido', codigo, senal: senal || null });
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
    medirTasa(datos.length / 2);
    if (tasaReal && tasaDeclarada && tasaReal !== tasaDeclarada) datos = remuestrear(datos);
    resto = resto.length ? Buffer.concat([resto, datos]) : datos;
    const bytes = MUESTRAS_POR_PEDAZO * 2;
    while (resto.length >= bytes) {
        const pedazo = Buffer.from(resto.subarray(0, bytes));
        resto = resto.subarray(bytes);

        // Se manda PRIMERO, igual que en la ventana: si medir tirara una
        // excepción, el audio ya salió, y lo que se está grabando no se puede
        // repetir.
        if (mandando) {
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

/**
 * La red de abajo del ayudante: cuántas muestras llegan de verdad por segundo.
 *
 * Existe por un error que costó dos sesiones de prueba: con unos AirPods en
 * modo llamada la salida del sistema baja a 24 kHz y el ayudante declaraba los
 * 48 del tap. El WAV quedaba al doble de velocidad y con la mitad de la
 * duración —84,3 s de clase, 42,1 s de audio—, Whisper oía la clase acelerada
 * y los marcadores caían a la mitad de donde van. El ayudante ya lee la tasa
 * correcta y remuestrea (`nativo/escuchar-app.swift`), pero lo que no se mide
 * no se sabe: si alguna vez vuelve a declarar una cosa y entregar otra, esto
 * lo ve en cuatro segundos, remuestrea a la tasa declarada, que es la del WAV,
 * y lo avisa.
 *
 * Se cree a la medición solo si cae cerca de una tasa de verdad y dos veces
 * seguidas: un pipe que se atrasa y entrega de golpe no es un audio a otra tasa.
 */
function medirTasa(muestras) {
    if (!tasaDeclarada) return;
    const ahora = reloj();
    muestrasTotales += muestras;
    marcas.push([ahora, muestrasTotales]);
    while (marcas.length > 2 && ahora - marcas[0][0] > VENTANA_DE_TASA_MS) marcas.shift();
    const [t0, m0] = marcas[0];
    if (ahora - t0 < PRIMERA_MEDICION_MS) return;
    // Las muestras del primer registro ya estaban cuando se tomó su hora.
    const medida = (muestrasTotales - m0) / ((ahora - t0) / 1000);
    const cercana = TASAS.reduce((a, b) => (Math.abs(b - medida) < Math.abs(a - medida) ? b : a));
    if (Math.abs(medida / cercana - 1) > TOLERANCIA_DE_TASA) { candidata = 0; return; }
    if (cercana === tasaReal) { candidata = 0; return; }
    if (candidata !== cercana) { candidata = cercana; return; }
    const antes = tasaReal;
    tasaReal = cercana;
    candidata = 0;
    fase = 0;
    avisar({ tipo: 'tasa', declarada: tasaDeclarada, real: tasaReal, antes,
        mensaje: `El audio de Zoom llega a ${tasaReal / 1000} kHz y no a ${tasaDeclarada / 1000}: ` +
            'se corrige solo, pero conviene avisarlo.' });
}

/**
 * De la tasa real a la declarada, interpolando. Es el mismo remuestreo que el
 * ayudante (`remuestrear` en `escuchar-app.swift`), con su estado entre pedazos.
 */
function remuestrear(datos) {
    const n = Math.floor(datos.length / 2);
    if (!n) return Buffer.alloc(0);
    const paso = tasaReal / tasaDeclarada;
    const salida = [];
    let p = fase;
    const x = i => (i < 0 ? previa : datos.readInt16LE(i * 2));
    while (p < n - 1) {
        const i = Math.floor(p);
        const f = p - i;
        const a = x(i);
        salida.push(Math.round(a + (x(i + 1) - a) * f));
        p += paso;
    }
    fase = p - n;
    previa = x(n - 1);
    const buf = Buffer.alloc(salida.length * 2);
    for (let k = 0; k < salida.length; k++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, salida[k])), k * 2);
    return buf;
}

/** Desde acá los pedazos van a la grabación. Antes solo se medían. */
function empezarAMandar() { mandando = true; }
function dejarDeMandar() { mandando = false; }

function abierto() { return Boolean(hijo); }

function reiniciarTasa(declarada) {
    tasaDeclarada = tasaReal = declarada;
    marcas = [];
    muestrasTotales = 0;
    candidata = 0;
    fase = 0;
    previa = 0;
    reloj = () => Date.now();
}

function cerrar() {
    mandando = false;
    if (!hijo) return;
    cerrando = true;
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
    // Para las pruebas, que reemplazan el ayudante por uno de mentira.
    _conectar(p) {
        alPcm = p.alPcm || alPcm;
        avisar = p.avisar || avisar;
        mandando = Boolean(p.mandando);
        resto = Buffer.alloc(0);
        ultimoNivel = 0;
        pico = 0;
        reiniciarTasa(p.tasa || 0);
        if (p.reloj) reloj = p.reloj;
    }
};
