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

let hijo = null;
let mandando = false;
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
                    contestar({ ok: true, sampleRate: Math.round(j.sampleRate), canales: 1, procesos: j.procesos });
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

/** Desde acá los pedazos van a la grabación. Antes solo se medían. */
function empezarAMandar() { mandando = true; }
function dejarDeMandar() { mandando = false; }

function abierto() { return Boolean(hijo); }

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
    }
};
