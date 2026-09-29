'use strict';
/**
 * dependencias.js — Lo que la app necesita para funcionar, y cómo instalarlo
 * desde la propia app.
 *
 * El instalador de Note Taker trae todo adentro, salvo los modelos de Whisper:
 * pesan más de dos gigas, que es el tope de un archivo en un release de GitHub,
 * así que el instalador que se publica no los lleva. En una Mac nueva la app
 * arranca, se da cuenta de que faltan y los ofrece bajar, con un botón por
 * cada cosa. Lo mismo para lo demás, que en la versión instalada ya viene pero
 * en desarrollo o en una instalación rota puede faltar.
 *
 * Cada dependencia dice qué es, para qué sirve con palabras, si sin ella no se
 * puede grabar, y cómo se instala:
 *
 *   descargar   un modelo, de Hugging Face, a la carpeta del usuario (no pide
 *               contraseña), verificado contra su SHA-256
 *   brew        con Homebrew, si está
 *   homebrew    Homebrew mismo: abre la Terminal con el instalador oficial,
 *               porque pide la contraseña y eso no se puede hacer por la persona
 *   compilar    el ayudante que escucha a Zoom, con el swiftc de las
 *               herramientas de Apple
 *   xcode       las herramientas de Apple: abre su instalador
 *   reinstalar  lo que solo viene con el instalador de la app
 */

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('./paths');
const updates = require('./updates');

// Las pruebas los cambian por un servidor y una carpeta propios.
const HUGGING_FACE = process.env.NOTETAKER_MODELOS_BASE || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** Donde se instala lo que baja la app: la carpeta del usuario, sin contraseña. */
const CARPETA_USUARIO = process.env.NOTETAKER_CARPETA_USUARIO ||
    path.join(os.homedir(), 'Library', 'Application Support', 'Note Taker');

/**
 * Los modelos, con el peso y el SHA-256 de los archivos con los que se probó la
 * app. Hugging Face los publica en la cabecera `x-linked-etag`: si el archivo
 * del repositorio cambiara, la descarga no pasaría la verificación y lo diría,
 * en vez de dejar instalado un modelo distinto del que se midió.
 */
const MODELOS = {
    'ggml-large-v3-turbo.bin': {
        bytes: 1624555275,
        sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
    },
    'ggml-small.bin': {
        bytes: 487601967,
        sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
    }
};

const LISTA = [
    {
        clave: 'modelo-grande',
        nombre: 'Modelo de Whisper (large-v3-turbo)',
        para: 'Relee cada toma cerrada y escribe el texto que va al XML. También es el que oye el texto en vivo.',
        requerida: true,
        modelo: 'ggml-large-v3-turbo.bin'
    },
    {
        clave: 'modelo-liviano',
        nombre: 'Modelo liviano (small)',
        para: 'El respaldo: si el grande se cae a mitad de una toma, se relee con este. Sin él, esa toma queda sin releer hasta «Regenerar».',
        requerida: false,
        modelo: 'ggml-small.bin'
    },
    {
        clave: 'ffmpeg',
        nombre: 'ffmpeg',
        para: 'Corta el audio grabado en los pedazos que se le pasan a Whisper.',
        requerida: true,
        herramienta: 'ffmpeg',
        brew: 'ffmpeg'
    },
    {
        clave: 'ffprobe',
        nombre: 'ffprobe',
        para: 'Lee cuánto dura y cómo está hecho un audio.',
        requerida: true,
        herramienta: 'ffprobe',
        brew: 'ffmpeg'
    },
    {
        clave: 'whisper-cli',
        nombre: 'whisper-cli',
        para: 'Transcribe: sin él no se oye el conteo, ni la pausa, ni hay texto.',
        requerida: true,
        herramienta: 'whisper-cli',
        brew: 'whisper-cpp'
    },
    {
        clave: 'whisper-server',
        nombre: 'whisper-server',
        para: 'Deja el modelo cargado para el texto en vivo. Sin él, el texto en vivo llega más tarde y con más errores.',
        requerida: false,
        herramienta: 'whisper-server',
        brew: 'whisper-cpp'
    },
    {
        clave: 'escuchar-app',
        nombre: 'Escucha de Zoom',
        para: 'Graba el sonido de la llamada de Zoom directo. Sin él, «Audio de Zoom» no aparece en la lista.',
        requerida: false,
        herramienta: 'escuchar-app',
        compilar: 'escuchar-app.swift'
    }
];

function mega(bytes) {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function brew() {
    for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
        if (paths.isExecutable(p)) return p;
    }
    return null;
}

function swiftc() {
    for (const p of ['/usr/bin/swiftc', '/Library/Developer/CommandLineTools/usr/bin/swiftc']) {
        if (!paths.isExecutable(p)) continue;
        // `/usr/bin/swiftc` existe siempre en macOS, pero sin las herramientas
        // de Apple es un aviso que pide instalarlas. `xcode-select -p` dice si
        // de verdad están.
        if (p === '/usr/bin/swiftc') {
            try { execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'ignore' }); } catch (e) { continue; }
        }
        return p;
    }
    return null;
}

function fuenteSwift(archivo) {
    const f = path.join(paths.appRoot(), 'nativo', archivo);
    return fs.existsSync(f) ? f : null;
}

function encontrada(d) {
    if (d.modelo) {
        const m = paths.modelosInstalados().find(x => x.name === d.modelo);
        return m ? { path: m.path } : null;
    }
    const t = paths.resolveTool(d.herramienta);
    return t.path ? { path: t.path } : null;
}

/** Cómo se instalaría, si falta. */
function accionDe(d) {
    if (d.modelo) {
        const m = MODELOS[d.modelo];
        return { tipo: 'descargar', etiqueta: `Descargar (${mega(m.bytes)})` };
    }
    if (d.brew) {
        return brew()
            ? { tipo: 'brew', etiqueta: 'Instalar con Homebrew' }
            : { tipo: 'homebrew', etiqueta: 'Instalar Homebrew primero',
                nota: 'Se abre la Terminal con el instalador oficial de Homebrew: pide la contraseña de la Mac. Cuando termine, volvé acá.' };
    }
    if (d.compilar) {
        if (!fuenteSwift(d.compilar)) {
            return { tipo: 'reinstalar', etiqueta: null,
                nota: 'Viene con el instalador de Note Taker: volvé a instalarlo.' };
        }
        return swiftc()
            ? { tipo: 'compilar', etiqueta: 'Armarlo en esta Mac' }
            : { tipo: 'xcode', etiqueta: 'Instalar las herramientas de Apple',
                nota: 'Se abre el instalador de Apple (unos minutos). Cuando termine, volvé acá y armalo.' };
    }
    return { tipo: 'reinstalar', etiqueta: null };
}

/**
 * Qué hay y qué falta.
 *
 * @returns {Array<{clave, nombre, para, requerida, esta, donde, accion}>}
 */
function estado() {
    paths.clearCache();
    return LISTA.map(d => {
        const hay = encontrada(d);
        return {
            clave: d.clave,
            nombre: d.nombre,
            para: d.para,
            requerida: d.requerida,
            esta: Boolean(hay),
            donde: hay ? hay.path : null,
            accion: hay ? null : accionDe(d)
        };
    });
}

/** Las descargas en curso, para poder cancelarlas. */
const enCurso = new Map();

function sha256De(archivo) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(archivo).on('data', c => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

async function descargar(d, alProgreso) {
    const m = MODELOS[d.modelo];
    const destDir = path.join(CARPETA_USUARIO, 'models');
    const control = new AbortController();
    enCurso.set(d.clave, control);
    try {
        const r = await updates.download({
            url: `${HUGGING_FACE}/${d.modelo}`,
            destDir,
            nombre: `${d.modelo}.verificando`,
            signal: control.signal,
            timeoutMs: 60000,
            onProgress: p => alProgreso({ pct: p.percent, texto: `${mega(p.bajado)} de ${mega(p.total || m.bytes)}` })
        });
        if (!r.ok) return r;
        alProgreso({ pct: 100, texto: 'Verificando que llegó entero…' });
        const suma = await sha256De(r.path);
        if (suma !== m.sha256) {
            try { fs.unlinkSync(r.path); } catch (e) { /* ya no está */ }
            return { ok: false, error: 'El archivo que llegó no es el modelo esperado (no coincide su huella). Probá de nuevo.' };
        }
        fs.renameSync(r.path, path.join(destDir, d.modelo));
        return { ok: true };
    } finally {
        enCurso.delete(d.clave);
    }
}

/** Corre un programa y va contando su última línea. */
function correr(bin, args, alProgreso, env) {
    return new Promise(resolve => {
        const hijo = spawn(bin, args, { env: { ...process.env, ...(env || {}) } });
        let ultima = '';
        let todo = '';
        const leer = d => {
            const texto = String(d);
            todo = (todo + texto).slice(-4000);
            const lineas = texto.split('\n').map(x => x.trim()).filter(Boolean);
            if (lineas.length) {
                ultima = lineas[lineas.length - 1];
                alProgreso({ texto: ultima.slice(0, 120) });
            }
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', leer);
        hijo.on('error', err => resolve({ ok: false, error: err.message }));
        hijo.on('close', codigo => resolve(codigo === 0
            ? { ok: true }
            : { ok: false, error: ultima || `terminó con ${codigo}`, detalle: todo }));
    });
}

function abrirTerminalCon(comando) {
    const guion = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(comando)}\nend tell`;
    return correr('/usr/bin/osascript', ['-e', guion], () => {});
}

/**
 * Instala una dependencia.
 *
 * @param {string} clave
 * @param {function({pct?:number, texto:string})} alProgreso
 * @returns {Promise<{ok:boolean, error?:string, mensaje?:string, sigue?:boolean}>}
 *   `sigue` es que la instalación siguió afuera (la Terminal, el instalador de
 *   Apple) y hay que volver a mirar cuando termine
 */
async function instalar(clave, alProgreso) {
    const avance = typeof alProgreso === 'function' ? alProgreso : () => {};
    const d = LISTA.find(x => x.clave === clave);
    if (!d) return { ok: false, error: `No sé instalar «${clave}».` };
    if (encontrada(d)) return { ok: true };
    if (enCurso.has(clave)) return { ok: false, error: 'Ya se está instalando.' };

    const accion = accionDe(d);
    try {
        switch (accion.tipo) {
            case 'descargar':
                return await descargar(d, avance);
            case 'brew': {
                avance({ texto: `brew install ${d.brew}…` });
                const r = await correr(brew(), ['install', d.brew], avance, {
                    // Sin preguntar nada y sin ponerse a actualizar Homebrew entero.
                    NONINTERACTIVE: '1', HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1'
                });
                return r.ok ? { ok: true } : { ok: false, error: `Homebrew no pudo: ${r.error}` };
            }
            case 'homebrew': {
                const r = await abrirTerminalCon(
                    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
                return r.ok
                    ? { ok: true, sigue: true, mensaje: 'Seguí en la Terminal. Cuando Homebrew termine, volvé y apretá «Instalar con Homebrew».' }
                    : { ok: false, error: 'No se pudo abrir la Terminal.' };
            }
            case 'xcode': {
                const r = await correr('/usr/bin/xcode-select', ['--install'], avance);
                return { ok: true, sigue: true, mensaje: r.ok
                    ? 'Se abrió el instalador de Apple. Cuando termine, volvé y apretá «Armarlo en esta Mac».'
                    : 'Las herramientas de Apple ya parecen estar, o su instalador ya está abierto.' };
            }
            case 'compilar': {
                const destino = path.join(CARPETA_USUARIO, 'bin', d.herramienta);
                fs.mkdirSync(path.dirname(destino), { recursive: true });
                const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
                // En la app instalada la fuente vive adentro de `app.asar`, que
                // Node lee pero swiftc no: se copia afuera antes de compilar.
                const fuente = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nt-swift-')), d.compilar);
                fs.writeFileSync(fuente, fs.readFileSync(fuenteSwift(d.compilar)));
                const args = ['-O', '-target', 'arm64-apple-macos14.2', '-o', destino, fuente];
                if (fs.existsSync(sdk)) args.unshift('-sdk', sdk);
                avance({ texto: 'Compilando…' });
                const r = await correr(swiftc(), args, avance);
                return r.ok ? { ok: true } : { ok: false, error: `No compiló: ${r.error}` };
            }
            default:
                return { ok: false, error: accion.nota || 'Esto viene con el instalador de Note Taker.' };
        }
    } finally {
        paths.clearCache();
    }
}

function cancelar(clave) {
    const c = enCurso.get(clave);
    if (c) c.abort();
    return Boolean(c);
}

module.exports = { estado, instalar, cancelar, LISTA, MODELOS, CARPETA_USUARIO };
