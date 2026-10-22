'use strict';
/**
 * El martillo: secuencias al azar de gestos de un editor sobre una clase en
 * curso, comprobando las invariantes de las notas después de CADA gesto.
 *
 * Por qué existe. El 13/10 salieron dos tomas con el mismo número, y la causa
 * estaba en once sitios que confiaban en una propiedad que ninguna prueba
 * enunciaba —`find(t => t.id === n)` da la primera, así que con dos iguales la
 * ventana pintaba en la toma abierta el texto de la cerrada, y la abierta no se
 * releía nunca—. Las pruebas de siempre miran un gesto cada una; esto mira lo
 * que las notas tienen que cumplir SIEMPRE, hagan lo que hagan con ellas, y
 * busca a ciegas la secuencia que lo rompe. En su primera pasada encontró
 * trece clases de fallo; están contadas, una por una, en los comentarios de
 * `notas-vivo.js` y `cambios-toma.js` que dicen «lo encontró el martillo».
 *
 * Las invariantes, dichas una vez:
 *
 *   1. los números de toma son únicos, enteros, crecientes en la lista, y el
 *      contador nunca está por debajo del más alto;
 *   2. a lo sumo una toma abierta, y es la última de las vivas;
 *   3. toda toma tiene IN; una cerrada tiene OUT > IN; las vivas van en orden
 *      por IN y no se pisan;
 *   4. cada palabra de una toma cae dentro de sus bordes, en orden (con la
 *      deriva de Whisper de tolerancia), y ninguna está en dos tomas; lo que hay
 *      en `antes` es < IN y lo que hay en `despues` es ≥ OUT; una suelta no
 *      cae dentro de ninguna toma viva ni está escrita en ninguna;
 *   5. la cola de relecturas solo apunta a tomas que existen;
 *   6. el sidecar se escribe, se vuelve a leer y da las mismas tomas;
 *   7. el XML sale, y no tiene dos clips con el mismo nombre;
 *   8. el resumen para la ventana sale;
 *   9. y al terminar, el sidecar en disco cumple 1 y queda marcado terminado.
 *
 * Con semilla: un fallo se repite con su número, y la traza de los últimos
 * gestos sale en el mensaje. Dos tandas: la del editor —solo gestos que la
 * ventana puede mandar— y la de la ventana rota, que además manda basura (NaN,
 * tomas que no existen, tipos inventados), porque el motor no se fía de ella.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');
const oirToma = require('../engine/oir-toma');
const espejo = require('../engine/espejo');
const relecturas = require('../engine/relecturas');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');

/** Cuántas clases simula cada tanda y cuántos gestos lleva cada una. */
const CLASES = 40;
const GESTOS = 50;

/* ─── azar con semilla ─────────────────────────────────────────────────── */
function azar(semilla) {
    let x = semilla >>> 0 || 1;
    const r = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    r.entre = (a, b) => a + Math.floor(r() * (b - a + 1));
    r.de = lista => lista[Math.floor(r() * lista.length)];
    r.si = p => r() < p;
    return r;
}

const PALABRAS = ['hola', 'bueno', 'entonces', 'vamos', 'a', 'ver', 'esto', 'es', 'importante', 'la', 'clase',
    'de', 'hoy', 'miren', 'acá', 'el', 'código', 'así', 'queda', 'listo', 'perfecto', 'siguiente', 'punto'];

/* ─── las invariantes ──────────────────────────────────────────────────── */
function invariantes(s) {
    const e = s.estado;
    const fallos = [];
    const f = (cond, msg) => { if (!cond) fallos.push(msg); };
    const tomas = e.tomas || [];
    const vivas = tomas.filter(t => !t.descartada);

    const ids = tomas.map(t => t.id);
    f(new Set(ids).size === ids.length, `ids repetidos: ${ids.join(',')}`);
    f(ids.every(i => Number.isInteger(i) && i > 0), `id raro: ${ids.join(',')}`);
    f(ids.every((id, i) => i === 0 || id > ids[i - 1]), `ids desordenados: ${ids.join(',')}`);
    f(e.proximaToma >= Math.max(0, ...ids), `contador ${e.proximaToma} por debajo de ${Math.max(...ids)}`);

    const abiertas = vivas.filter(t => t.outMs == null);
    f(abiertas.length <= 1, `${abiertas.length} tomas abiertas`);
    if (abiertas.length === 1) f(abiertas[0] === vivas[vivas.length - 1], `la abierta (${abiertas[0].id}) no es la última`);

    for (const t of tomas) {
        f(Number.isFinite(t.inMs), `toma ${t.id} sin IN`);
        if (t.outMs != null) f(t.outMs > t.inMs, `toma ${t.id}: OUT ${t.outMs} <= IN ${t.inMs}`);
    }
    for (let i = 1; i < vivas.length; i++) {
        const a = vivas[i - 1], b = vivas[i];
        f(b.inMs >= a.inMs, `tomas ${a.id} y ${b.id} fuera de orden por IN`);
        if (a.outMs != null) f(b.inMs >= a.outMs, `toma ${b.id} (IN ${b.inMs}) pisa a ${a.id} (OUT ${a.outMs})`);
    }

    const vistas = new Map();
    const escritas = new Set();
    for (const t of vivas) {
        const ps = t.palabras || [];
        for (let i = 0; i < ps.length; i++) {
            const w = ps[i];
            f(w.t >= t.inMs && (t.outMs == null || w.t < t.outMs), `toma ${t.id}: «${w.texto}»@${w.t} fuera de [${t.inMs},${t.outMs})`);
            if (i) f(ps[i].t >= ps[i - 1].t - 1000, `toma ${t.id}: palabras desordenadas en ${i}`);
            const k = `${w.t}|${w.texto}`;
            f(!vistas.has(k), `«${w.texto}»@${w.t} está en la toma ${t.id} y en la ${vistas.get(k)}`);
            vistas.set(k, t.id);
        }
        for (const w of t.antes || []) f(w.t < t.inMs, `toma ${t.id}: «${w.texto}» en antes pero >= IN`);
        for (const w of t.despues || []) f(t.outMs == null || w.t >= t.outMs, `toma ${t.id}: «${w.texto}» en despues pero < OUT`);
    }
    for (const t of tomas) for (const w of t.palabras || []) escritas.add(`${w.t}|${w.texto}`);
    for (const w of e.sueltas || []) {
        f(!vivo.esDeAlgunaToma(e, w), `suelta «${w.texto}»@${w.t} cae dentro de una toma viva`);
        f(!escritas.has(`${w.t}|${w.texto}`), `suelta «${w.texto}»@${w.t} también está escrita en una toma`);
    }

    for (const id of s.cola || []) f(ids.includes(id), `la cola apunta a la toma ${id}, que no existe`);

    try {
        const sc = notasXml.sidecar(e);
        const le = notasXml.estadoLeido(JSON.parse(JSON.stringify(sc)));
        const firma = lista => JSON.stringify(lista.map(t => `${t.id}:${t.inMs}:${t.outMs}:${(t.palabras || []).length}:${t.descartada ? 'd' : ''}`));
        f(firma(tomas) === firma(le.tomas || []), 'el sidecar no vuelve igual');
    } catch (err) { fallos.push(`el sidecar revienta: ${err.message}`); }

    try {
        const xml = notasXml.xmlDeNotas(e);
        // Cada toma viva y cerrada está en el XML con su nombre. Que no haya dos
        // tomas con el mismo nombre lo garantiza la invariante 1, que es la que
        // lo caza de verdad: en el XML dos tomas del mismo número son
        // indistinguibles.
        for (const t of vivas) {
            if (t.outMs == null) continue;
            f(xml.includes(`<name>${notasXml.nombreDeToma(t)}`), `la toma ${t.id} no está en el XML`);
        }
    } catch (err) { fallos.push(`el XML revienta: ${err.message}`); }

    try { espejo.resumen(s); } catch (err) { fallos.push(`el resumen revienta: ${err.message}`); }

    return fallos;
}

/* ─── una clase simulada ───────────────────────────────────────────────── */
/**
 * @param {boolean} conBasura si además llegan cambios inválidos por el IPC
 * @param {boolean} seCae si a mitad de clase la app muere y se reanuda del sidecar
 */
async function unaClase(semilla, conBasura, seCae) {
    const r = azar(semilla);
    const guardado = { tramo: oirToma.tramo, leer: oirToma.leer };
    const falso = { ventana: [] };
    // Como el Whisper real: en orden de tiempo y sin dos palabras en el mismo instante.
    const ordenadas = lista => {
        const porT = new Map();
        for (const w of lista) if (!porT.has(w.t)) porT.set(w.t, w);
        return [...porT.values()].sort((a, b) => a.t - b.t);
    };
    oirToma.tramo = async (_a, desde, hasta) => ({ palabras: ordenadas(falso.ventana.filter(w => w.t >= desde && w.t <= hasta)) });
    oirToma.leer = async (_a, toma) => {
        const dichas = ordenadas(falso.ventana.filter(w => w.t >= toma.inMs - 12000 && w.t < (toma.outMs || Infinity) + 12000));
        // Determinista, para que la semilla repita aunque la cola corra async.
        const h = (toma.id * 7919 + (toma.inMs % 1000)) % 100;
        if (h < 5) return null;
        if (h < 10) return { relectura: { estado: 'sin-leer' } };
        return { ...vivo.repartir(dichas, toma), colapsadas: 0, relectura: null };
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-martillo-'));
    const fallos = [];
    const traza = [];
    try {
        const st = grabacion.iniciar({ dir, curso: 'm', fps: 30, sinReloj: true, sampleRate: 48000 });
        let s = grabacion._sesion();
        const pedazo = () => Buffer.alloc(48000 * 2);
        const ahora = () => espejo.grabadoHastaMs(s);
        const w = (t, texto) => ({ t, texto, hasta: t + 250 });
        const hablar = (desde, n) => { for (let i = 0; i < n; i++) falso.ventana.push(w(desde + i * 400, r.de(PALABRAS))); };
        const avanzar = async (seg) => {
            for (let i = 0; i < seg; i++) {
                grabacion.pcm(pedazo());
                if (r.si(0.7)) hablar(ahora() - 1000, 2);
                await grabacion.buscarSenales();
            }
        };
        const tomaAlAzar = () => { const ts = s.estado.tomas; return ts.length ? r.de(ts) : null; };
        const cerradaAlAzar = () => { const ts = s.estado.tomas.filter(t => t.outMs != null); return ts.length ? r.de(ts) : null; };
        const hay = () => s.estado.tomas.find(t => t.outMs == null && !t.descartada);
        const idDe = t => (t || {}).id;

        await avanzar(8);

        const gestos = [
            ['avanzar', async () => avanzar(r.entre(1, 4))],
            ['abrir', async () => { if (!hay()) grabacion.abrirToma(r.si(0.5) ? undefined : ahora() - r.entre(0, 9000)); }],
            ['conteo', async () => {
                if (hay()) return;
                const t = ahora();
                falso.ventana.push(w(t - 1500, '3,'), w(t - 1100, '2,'), w(t - 700, '1.'));
                hablar(t - 200, 3);
                await avanzar(2);
            }],
            ['cerrar', async () => { if (hay()) grabacion.cerrarToma(r.si(0.5) ? undefined : ahora() - r.entre(0, 4000)); }],
            ['pausa', async () => { if (!hay()) return; falso.ventana.push(w(ahora() - 800, 'Pausa.')); await avanzar(3); }],
            // Como la ventana: un borde se suelta sobre una palabra, y las palabras están donde hay audio.
            ['borde-in', async () => { const t = tomaAlAzar(); if (t) grabacion.editar({ tipo: 'borde', toma: t.id, borde: 'in', paredMs: Math.min(ahora(), t.inMs + r.entre(-15000, 15000)) }); }],
            ['borde-out', async () => { const t = cerradaAlAzar(); if (t) grabacion.editar({ tipo: 'borde', toma: t.id, borde: 'out', paredMs: Math.min(ahora(), t.outMs + r.entre(-15000, 15000)) }); }],
            ['dividir', async () => {
                const t = tomaAlAzar(); if (!t) return;
                const fin = t.outMs == null ? ahora() : t.outMs;
                grabacion.editar({ tipo: 'dividir', toma: t.id, paredMs: t.inMs + r.entre(-1000, fin - t.inMs + 1000) });
            }],
            ['reabrir', async () => { const t = cerradaAlAzar(); if (t) grabacion.editar({ tipo: 'reabrir', toma: t.id }); }],
            ['eliminar', async () => { const t = tomaAlAzar(); if (t) grabacion.editar({ tipo: 'eliminar', toma: t.id }); }],
            ['descartar', async () => { const t = tomaAlAzar(); if (t) grabacion.editar({ tipo: 'descartar', toma: t.id, descartada: r.si(0.6) }); }],
            ['vista', async () => { const t = tomaAlAzar(); if (t) grabacion.editar({ tipo: 'vista', toma: t.id, vista: r.de(['PV', 'R', 'PA', 'PV+R']) }); }],
            // Cambiar de plano grabando parte la abierta en el instante del
            // audio, así que es el gesto que crea tomas sin que nadie elija la
            // palabra: tiene que convivir con el conteo, deshacer y las caídas.
            // A veces sobre una cerrada, o con una vista que no existe.
            ['vista-desde-ahora', async () => {
                const abierta = (s.estado.tomas || []).find(x => x.outMs == null);
                const t = r.si(0.8) ? abierta : tomaAlAzar();
                if (t) grabacion.editar({ tipo: 'vista-desde-ahora', toma: t.id, vista: r.de(['PV', 'R', 'S', 'XX']) });
            }],
            ['nota', async () => { const t = tomaAlAzar(); if (t) grabacion.editar({ tipo: 'nota', toma: t.id, texto: r.de(['', 'ojo', 'cortar acá', 'x'.repeat(300)]) }); }],
            ['comentar', async () => {
                const t = tomaAlAzar(); if (!t || !(t.palabras || []).length) return;
                const p = r.de(t.palabras);
                grabacion.editar({ tipo: 'comentar', toma: t.id, desdeMs: p.t, hastaMs: p.hasta || p.t + 200, texto: p.texto, comentario: 'nota' });
            }],
            ['borrar-comentario', async () => { const t = tomaAlAzar(); if (t && (t.comentarios || []).length) grabacion.editar({ tipo: 'borrar-comentario', toma: t.id, indice: r.entre(0, t.comentarios.length) }); }],
            // Cambiar el idioma a mitad y pedir releer manda todas las tomas
            // cerradas a la cola de una vez, así que es el gesto que más cola
            // genera: es justo el que tiene que convivir con deshacer, dividir
            // y las caídas. Sin releer no encola nada y el idioma cambia igual,
            // y las dos respuestas caen acá para que ninguna quede sin martillo.
            ['idioma', async () => {
                grabacion.cambiarIdioma(r.de(['auto', 'es', 'en', 'pt']), { releer: r.si(0.5) });
            }],
            ['claqueta', async () => { grabacion.claqueta(); }],
            ['quitar-claqueta', async () => { const c = s.estado.claquetas || []; if (c.length) grabacion.quitarClaqueta(r.de(c).n); }],
            ['deshacer', async () => { grabacion.deshacer(); }],
            ['rehacer', async () => { grabacion.rehacer(); }],
            ['relectura', async () => { await new Promise(res => setTimeout(res, 5)); }]
        ];
        if (conBasura) {
            gestos.push(['basura', async () => {
                const malos = [
                    { tipo: 'borde', toma: 999, borde: 'in', paredMs: ahora() },
                    { tipo: 'borde', toma: idDe(tomaAlAzar()), borde: 'out', paredMs: NaN },
                    { tipo: 'borde', toma: idDe(tomaAlAzar()), borde: 'in', paredMs: 'abc' },
                    { tipo: 'borde', toma: idDe(tomaAlAzar()), borde: 'out', paredMs: Infinity },
                    { tipo: 'dividir', toma: idDe(tomaAlAzar()), paredMs: -1 },
                    { tipo: 'dividir', toma: idDe(tomaAlAzar()), paredMs: Infinity },
                    { tipo: 'vista', toma: idDe(tomaAlAzar()), vista: 'NOEXISTE' },
                    { tipo: 'loquesea', toma: idDe(tomaAlAzar()) },
                    { tipo: 'descartar', toma: 'uno' },
                    { tipo: 'idioma', toma: idDe(tomaAlAzar()), idioma: 'fr' },
                    { tipo: 'comentar', toma: idDe(tomaAlAzar()), desdeMs: NaN, hastaMs: 'x', texto: 'y' },
                    { tipo: 'borrar-comentario', toma: idDe(tomaAlAzar()), indice: 99 },
                    { tipo: 'editar-comentario', toma: idDe(tomaAlAzar()), indice: -1, comentario: 'x' },
                    null, undefined, {}, { tipo: null }
                ];
                grabacion.editar(r.de(malos));
                if (r.si(0.3)) grabacion.cerrarToma(NaN);
                if (r.si(0.3)) grabacion.abrirToma('ayer');
                if (r.si(0.3)) {
                    grabacion.cambiarIdioma(r.de(['fr', '', null, '--help', 42]),
                        r.de([undefined, null, {}, { releer: 'si' }, 'releer']));
                }
            }]);
        }

        // La app se MUERE: ni Terminar ni apagado ordenado. En el disco queda el
        // sidecar tal cual estaba —con la toma abierta si la había— y se reanuda
        // de ahí, con el mismo audio delante. Lo que había escrito en cada toma
        // tiene que seguir, la abierta tiene que quedar cerrada donde llegó el
        // audio, y la clase tiene que poder seguir.
        const caerse = async () => {
            if (s.rehaciendo) await s.rehaciendo;
            espejo.escribir(s);
            const finDelAudio = espejo.grabadoHastaMs(s);
            const escritas = s.estado.tomas.map(t => ({ id: t.id, in: t.inMs, out: t.outMs, n: (t.palabras || []).length, d: Boolean(t.descartada) }));
            const datos = path.join(dir, 'xml', 'Datos');
            const json = path.join(datos, fs.readdirSync(datos).find(n => n.endsWith('.json')));
            const talCual = fs.readFileSync(json);
            grabacion.apagar();
            fs.writeFileSync(json, talCual);
            // El audio nuevo nace cinco segundos después de donde murió el viejo,
            // como en la realidad: hubo que volver a abrir la app.
            grabacion.reanudar(json, { curso: 'm', fps: 30, sinReloj: true, sampleRate: 48000, desdeMs: finDelAudio + 5000 });
            s = grabacion._sesion();
            const vueltas = s.estado.tomas.map(t => ({ id: t.id, in: t.inMs, out: t.outMs, n: (t.palabras || []).length, d: Boolean(t.descartada) }));
            for (let i = 0; i < Math.max(escritas.length, vueltas.length); i++) {
                const a = escritas[i], b = vueltas[i];
                if (!a || !b || a.id !== b.id || a.in !== b.in || a.n !== b.n || a.d !== b.d) {
                    fallos.push(`[caída] la toma ${(a || b).id} no vuelve igual: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
                } else if (a.out == null) {
                    // Donde llegó el audio, o la duración mínima si se abrió justo ahí.
                    const debe = Math.max(finDelAudio, a.in + 100);
                    if (b.out !== debe) fallos.push(`[caída] la toma ${a.id} estaba abierta y tenía que cerrarse donde llegó el audio (${debe}), no en ${b.out}`);
                } else if (a.out !== b.out) {
                    fallos.push(`[caída] la toma ${a.id} cambió de OUT: ${a.out} → ${b.out}`);
                }
            }
            for (let i = 0; i < 3; i++) grabacion.pcm(pedazo());
        };

        for (let paso = 1; paso <= GESTOS; paso++) {
            const [nombre, hacer] = r.de(gestos);
            traza.push(`${paso}. ${nombre}   ${s.estado.tomas.map(t => `${t.id}${t.descartada ? 'ᵈ' : ''}[${t.inMs}-${t.outMs}]`).join(' ')}`);
            try {
                if (seCae && paso === Math.floor(GESTOS / 2)) { traza.push(`${paso}. LA APP SE CAE Y SE REANUDA`); await caerse(); } else await hacer();
            } catch (err) {
                fallos.push(`[paso ${paso} ${nombre}] revienta: ${err.message}`);
                break;
            }
            const rotas = invariantes(s);
            if (rotas.length) { fallos.push(...rotas.map(m => `[paso ${paso} ${nombre}] ${m}`)); break; }
        }

        await grabacion.terminar();
        const datos = path.join(dir, 'xml', 'Datos');
        const sc = fs.readdirSync(datos).find(n => n.endsWith('.json'));
        const leido = notasXml.estadoLeido(JSON.parse(fs.readFileSync(path.join(datos, sc), 'utf8')));
        const ids = (leido.tomas || []).map(t => t.id);
        if (new Set(ids).size !== ids.length) fallos.push(`[terminar] el sidecar en disco tiene ids repetidos: ${ids}`);
        if (!leido.terminada) fallos.push('[terminar] el sidecar no quedó marcado como terminado');
    } catch (err) {
        fallos.push(`revienta: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
    } finally {
        oirToma.tramo = guardado.tramo;
        oirToma.leer = guardado.leer;
        try { grabacion.apagar(); } catch (e) { /* ya estaba */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return { fallos, traza };
}

module.exports = function (t) {
    t.group('el martillo · gestos al azar de un editor');

    t.test(`${CLASES} clases de ${GESTOS} gestos cumplen las invariantes en cada paso`, async () => {
        const rotas = [];
        for (let semilla = 1; semilla <= CLASES; semilla++) {
            const r = await unaClase(semilla, false);
            if (r.fallos.length) rotas.push(`semilla ${semilla}:\n      ${r.traza.slice(-6).join('\n      ')}\n      ${r.fallos.join('\n      ')}`);
        }
        t.eq(rotas.length, 0, rotas.join('\n\n') || 'ninguna clase rompió nada');
    });

    /* ─── Dos que el martillo largo encontró y cuarenta clases no tocan ──────
     *
     * Con 800 clases de 80 gestos salieron; con las 40 de arriba no siempre.
     * Se pinchan a mano para que no dependan de la suerte de la semilla.
     */
    t.group('el martillo · deshacer deja la toma cuadrada');

    /**
     * Una clase con Whisper de mentira. Por defecto no relee nada —solo el
     * ciclo—; con `o.relee` la relectura contesta esas palabras, repartidas.
     */
    async function conClaseMuda(fn, o) {
        const guardado = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { ventana: [] };
        oirToma.tramo = async (_a, desde, hasta) => ({ palabras: falso.ventana.filter(w => w.t >= desde && w.t <= hasta) });
        oirToma.leer = o && o.relee
            ? async (_a, toma) => ({ ...vivo.repartir(o.relee(), toma), colapsadas: 0, relectura: null })
            : async () => null;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-martillo-'));
        try {
            const st = grabacion.iniciar({ dir, curso: 'm', fps: 30, sinReloj: true, sampleRate: 48000 });
            const s = grabacion._sesion();
            const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 250 });
            // Tres pasadas y no dos: a la última palabra de una ventana el ciclo
            // no se la cree hasta la pasada siguiente (`firmeHastaMs`).
            const oir = async (...palabras) => {
                falso.ventana = falso.ventana.concat(palabras);
                for (let i = 0; i < 3; i++) { grabacion.pcm(Buffer.alloc(48000 * 2)); await grabacion.buscarSenales(); }
            };
            for (let i = 0; i < 4; i++) grabacion.pcm(Buffer.alloc(48000 * 2));
            await fn({ st, s, w, oir });
        } finally {
            oirToma.tramo = guardado.tramo;
            oirToma.leer = guardado.leer;
            grabacion.apagar();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    t.test('deshacer un «reabrir» manda a la orilla lo que el ciclo metió mientras estuvo abierta', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'));
            grabacion.cerrarToma(st.ceroMs + 5000);
            grabacion.editar({ tipo: 'reabrir', toma: 1 });
            // Abierta otra vez, el ciclo le sigue metiendo palabras.
            await oir(w(7000, 'tres'), w(8000, 'cuatro'));
            const toma = s.estado.tomas[0];
            t.deep(toma.palabras.map(x => x.texto), ['uno', 'dos', 'tres', 'cuatro'], 'las cuatro son suyas mientras está abierta');

            const r = grabacion.deshacer();
            t.ok(r.ok, 'se deshace el reabrir');
            t.eq(toma.outMs, st.ceroMs + 5000, 'vuelve el OUT de antes');
            t.deep(toma.palabras.map(x => x.texto), ['uno', 'dos'], 'y dentro quedan solo las de dentro de los bordes');
            t.ok(toma.palabras.every(x => x.t < toma.outMs), 'ninguna palabra más allá del OUT');
            t.deep(toma.despues.map(x => x.texto), ['tres', 'cuatro'], 'las otras dos pasan a orilla, no se pierden');
        });
    });

    t.test('deshacer la división de la toma abierta no deja suelto lo dicho desde el corte', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'));
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 2500 });
            t.deep(s.estado.tomas.map(x => x.id), [1, 2], 'las dos mitades');
            // La segunda sigue abierta y el ciclo le mete palabras.
            await oir(w(6000, 'tres'), w(7000, 'cuatro'));
            t.deep(s.estado.tomas[1].palabras.map(x => x.texto), ['dos', 'tres', 'cuatro']);

            const r = grabacion.deshacer();
            t.ok(r.ok, 'se deshace la división');
            const junta = s.estado.tomas[0];
            t.eq(s.estado.tomas.length, 1, 'vuelve a ser una');
            t.eq(junta.outMs, null, 'y abierta');
            t.deep(junta.palabras.map(x => x.texto), ['uno', 'dos', 'tres', 'cuatro'], 'con TODO lo dicho, también lo de después del corte');
            t.deep(s.estado.sueltas.filter(x => x.t >= junta.inMs), [], 'y nada de eso quedó suelto');
        });
    });

    t.test('deshacer la división se niega si el conteo ya abrió otra toma detrás', async () => {
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'), w(3000, 'dos'));
            grabacion.editar({ tipo: 'dividir', toma: 1, paredMs: st.ceroMs + 2500 });
            // La segunda mitad la cierra una «Pausa» y la toma siguiente la abre
            // un conteo: ninguno de los dos deja paso en el historial, así que
            // la división sigue arriba de la pila.
            // Una «Pausa» y silencio detrás: con una palabra pegada sería una
            // pausa corta y no cerraría.
            await oir(w(6000, 'Pausa.'));
            await oir();
            t.ok(s.estado.tomas[1].outMs != null, 'la 2 cerró por la señal');
            await oir(w(8000, '3,'), w(8400, '2,'), w(8800, '1.'), w(9200, 'tres'), w(9600, 'cuatro'));
            t.eq(s.estado.tomas.length, 3, 'y el conteo abrió la 3');
            t.eq(s.estado.tomas[2].outMs, null, 'que está abierta');

            const r = grabacion.deshacer();
            t.ok(!r.ok, 'deshacer la división se niega: dejaría la junta abierta con la 3 abierta detrás');
            t.eq(s.estado.tomas.length, 3, 'y no tocó nada');
        });
    });

    t.test('deshacer un «cerrar» con la relectura ya puesta no mezcla las dos lecturas', async () => {
        // El ciclo oyó «funcion»; el modelo grande, «funcionando», a la misma
        // hora. Deshecho el cierre, la toma vuelve con el texto del ciclo y la
        // palabra del modelo grande no se queda ni dentro ni suelta: es la otra
        // lectura del mismo tramo, no una palabra más.
        const T = [];
        await conClaseMuda(async ({ st, s, w, oir }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'esto'), w(3000, 'funcion'), w(4000, 'bien'));
            T.push(w(2000, 'esto'), w(3000, 'funcionando'));
            // El cierre deja «bien» fuera, así que el paso del historial lleva
            // las palabras: deshacerlo las repone, y ahí es donde se decide qué
            // se hace con las de la relectura que ya no están.
            grabacion.cerrarToma(st.ceroMs + 3500);
            await new Promise(res => setTimeout(res, 20));
            const toma = s.estado.tomas[0];
            t.deep(toma.palabras.map(x => x.texto), ['esto', 'funcionando'], 'la relectura aterrizó');

            const r = grabacion.deshacer();
            t.ok(r.ok, 'se deshace el cierre');
            const textos = toma.palabras.map(x => x.texto);
            t.eq(textos.filter(x => /^funcion/.test(x)).length, 1, `una sola lectura de esa palabra, no las dos: ${textos.join(' ')}`);
            t.deep(s.estado.sueltas.filter(x => /^funcion/.test(x.texto)), [], 'y ninguna de las dos quedó suelta');
        }, { relee: () => T });
    });

    t.test('la relectura de una toma desactivada limpia del colchón lo que escribe', async () => {
        const T = [];
        await conClaseMuda(async ({ st, s, w, oir }) => {
            T.push(w(2000, 'uno'));
            grabacion.abrirToma(st.ceroMs + 1000);
            await oir(w(2000, 'uno'));
            grabacion.cerrarToma(st.ceroMs + 6000);
            await new Promise(res => setTimeout(res, 20));
            grabacion.editar({ tipo: 'descartar', toma: 1, descartada: true });
            // Desactivada, lo que se dice en su tramo va al colchón (el OUT
            // está en 6 s; esto cae dentro).
            await oir(w(4000, 'dos'), w(4400, 'tres'));
            t.deep(s.estado.sueltas.map(x => x.texto), ['dos', 'tres'], 'sueltas mientras no cuenta');
            // Se vuelve a leer entera —como la deja un Cmd-Z, sin la marca de
            // releída— y la lectura trae esas dos palabras escritas en la toma.
            T.push(w(4000, 'dos'), w(4400, 'tres'));
            delete s.estado.tomas[0].releida;
            relecturas.encolar(s, 1);
            await new Promise(res => setTimeout(res, 20));
            t.deep(s.estado.tomas[0].palabras.map(x => x.texto), ['uno', 'dos', 'tres'], 'la toma las tiene escritas');
            t.deep(s.estado.sueltas.map(x => x.texto), [], 'y ya no están sueltas además');
        }, { relee: () => T });
    });

    t.group('el martillo · el final de una toma');

    t.test('el OUT cae después de la palabra que termina más tarde, esté donde esté en la lista', () => {
        // La lista admite la deriva de Whisper en el orden: la última de la
        // lista no es siempre la que termina más tarde.
        const toma = { inMs: 0, outMs: null, palabras: [
            { t: 1000, texto: 'a', hasta: 1300 }, { t: 3000, texto: 'c', hasta: 3300 }, { t: 2200, texto: 'b', hasta: 2500 }
        ] };
        vivo.cerrarProvisional(toma, 2000);
        t.ok(toma.outMs >= 3300, `el OUT (${toma.outMs}) deja dentro a la que termina en 3300`);
        t.ok(toma.palabras.every(w => w.t < toma.outMs), 'ninguna palabra queda sobre el OUT');
    });

    t.test('una palabra sin final —como venían las del sidecar— termina después de empezar', () => {
        const toma = { inMs: 0, outMs: null, palabras: [{ t: 1000, texto: 'a' }, { t: 3000, texto: 'b' }] };
        vivo.cerrarProvisional(toma, 1500);
        t.ok(toma.outMs > 3000, `el OUT (${toma.outMs}) no cae sobre la palabra de las 3000`);
    });

    t.test('el sidecar guarda el final de cada palabra, y un sidecar viejo sin él se lee igual', () => {
        const e = { ...vivo.estadoNuevo({ ceroMs: 1000 }), tomas: [{
            id: 1, vista: 'PV', comentario: '', cuenta: '', descartada: false, cerradaSola: false, comentarios: [],
            inMs: 1000, outMs: 5000, palabras: [{ t: 2000, texto: 'con', hasta: 2300 }, { t: 3000, texto: 'sin' }]
        }] };
        const sc = notasXml.sidecar(e);
        t.eq(sc.tomas[0].palabras[0].hasta, 2300, 'con final, guarda el final');
        t.ok(!('hasta' in sc.tomas[0].palabras[1]), 'sin final, no inventa uno');
        const le = notasXml.estadoLeido(JSON.parse(JSON.stringify(sc)));
        t.eq(le.tomas[0].palabras[0].hasta, 2300, 'y vuelve al leer');
    });

    t.group('el martillo · la ventana rota');

    t.test(`${CLASES} clases donde además llega basura por el IPC`, async () => {
        const rotas = [];
        for (let semilla = 1001; semilla <= 1000 + CLASES; semilla++) {
            const r = await unaClase(semilla, true);
            if (r.fallos.length) rotas.push(`semilla ${semilla}:\n      ${r.traza.slice(-6).join('\n      ')}\n      ${r.fallos.join('\n      ')}`);
        }
        t.eq(rotas.length, 0, rotas.join('\n\n') || 'el motor no se fía de la ventana');
    });

    t.group('el martillo · la app se cae a mitad de clase');

    t.test(`${CLASES} clases que se caen y se reanudan del sidecar, y siguen enteras`, async () => {
        const rotas = [];
        for (let semilla = 2001; semilla <= 2000 + CLASES; semilla++) {
            const r = await unaClase(semilla, false, true);
            if (r.fallos.length) rotas.push(`semilla ${semilla}:\n      ${r.traza.slice(-6).join('\n      ')}\n      ${r.fallos.join('\n      ')}`);
        }
        t.eq(rotas.length, 0, rotas.join('\n\n') || 'ninguna clase perdió nada al caerse');
    });
};
