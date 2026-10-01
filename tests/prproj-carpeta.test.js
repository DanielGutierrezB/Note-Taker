'use strict';
/**
 * El proyecto de Premiere de una carpeta: capturas, grupos y precortadas.
 *
 * Casi todo se prueba sobre `planear`, que es la mitad pura: dónde cae cada
 * clase en las anidaciones, qué fuente le toca a cada toma y dónde va cada
 * corte y cada marcador. Es la mitad donde una cuenta mal hecha no se ve hasta
 * que el editor suelta la cámara y los cortes caen corridos.
 *
 * La otra mitad —el formato— la cuida el motor portado de Class Cut, con sus
 * propias pruebas. Acá solo se arma un proyecto entero si hay una plantilla en
 * el disco, y se lo vuelve a leer para contar lo que tiene adentro.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const carpetaPrproj = require('../engine/prproj-carpeta');
const prproj = require('../engine/prproj');
const paths = require('../engine/paths');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const nidos = require('../engine/prproj-nidos');
const workspace = require('../engine/workspace');
const ipcPrproj = require('../ipc/prproj');

const T0 = Date.parse('2026-09-30T10:00:00');
const UNA_HORA = 3600 * 1000;

/** La plantilla con la que armar un proyecto entero, si hay alguna a mano. */
const PLANTILLA = paths.plantillaPrproj()
    || ['/Users/danielgutierrez/Movies/Render/PRUEBA-D-efecto.prproj'].find(r => fs.existsSync(r))
    || null;

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-prproj-carpeta-'));
}

/** Un WAV de verdad, para que `fs.existsSync` lo encuentre: solo la cabecera importa. */
function wav(dir, nombre) {
    const ruta = path.join(workspace.audioDir(dir), nombre);
    workspace.ensureDir(path.dirname(ruta));
    fs.writeFileSync(ruta, Buffer.alloc(64));
    return ruta;
}

/**
 * Qué captura hay en cada pista de vídeo de una anidación, de V1 para arriba.
 *
 * El apilado es lo que decide quién tapa a quién, y es lo único del menú que no
 * se puede comprobar en el plan: ahí es una lista, y acá es en qué pista quedó
 * cada una. Se sigue el camino que hace Premiere —pista, corte, fuente de
 * secuencia— parando antes de entrar a la secuencia del otro lado.
 */
function capturasDeLasPistas(p, secuencia) {
    const nombre = k => (/<Name>([^<]*)<\/Name>/.exec(p.contenido(k)) || [])[1];
    const grupo = p.refsDe(secuencia).find(k => p.clase(k) === 'VideoTrackGroup');
    const pistas = [...p.contenido(grupo).matchAll(/<Track Index="\d+" Object(U?)Ref="([^"]+)"/g)]
        .map(m => prproj.clave(m[1] === 'U' ? 'UID' : 'ID', m[2]));
    return pistas.map(pista => {
        const fuente = p.cierre([pista], { claseFrontera: ['Sequence'] })
            .find(k => p.clase(k) === 'VideoSequenceSource');
        const dentro = fuente && p.refsDe(fuente).find(k => p.clase(k) === 'Sequence');
        return dentro ? nombre(dentro) : null;
    });
}

function toma(id, desdeSeg, hastaSeg, vista, cero, extra) {
    return {
        id, vista, comentario: '', descartada: false,
        inMs: cero + desdeSeg * 1000, outMs: hastaSeg == null ? null : cero + hastaSeg * 1000,
        palabras: [], comentarios: [], ...(extra || {})
    };
}

/** Una sesión como la devuelve `listar`, sin tocar el disco más que el WAV. */
function sesion(dir, opciones) {
    const o = opciones || {};
    const cero = o.cero;
    const secuencia = o.secuencia || `curso_${cero}`;
    const wavs = (o.wavs || [{ desdeSeg: 0, segundos: o.segundos || 600 }]).map((w, i) => ({
        archivo: wav(dir, `${secuencia}-${i + 1}.wav`),
        desdeMs: cero + w.desdeSeg * 1000,
        segundos: w.segundos,
        sampleRate: 48000,
        canales: 1
    }));
    return {
        secuencia,
        ceroMs: cero,
        fps: o.fps || 30,
        terminada: o.terminada === false ? null : cero + 1,
        sesiones: wavs,
        tomas: o.tomas || [],
        claquetas: o.claquetas || []
    };
}

module.exports = async function (t) {
    t.group('prproj de la carpeta · la configuración del menú');

    t.test('por defecto: una captura y todas las vistas en ella', () => {
        const c = carpetaPrproj.normalizar(null, []);
        t.eq(c.capturas, 1);
        for (const v of vivo.VISTAS) t.deep(c.vistas[v.nombre], [1], v.nombre);
    });

    t.test('una vista que nombra una captura que ya no está vuelve a la 1', () => {
        const c = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: [3], X2: [2, 2, 1] } });
        t.deep(c.vistas.R, [1], 'la 3 no existe');
        t.deep(c.vistas.X2, [2, 1], 'sin repetidos y en el orden que se eligió');
    });

    t.test('el orden de una vista es el apilado y se respeta tal cual', () => {
        const c = carpetaPrproj.normalizar({ capturas: 3, vistas: { R: [3, 1] } });
        t.deep(c.vistas.R, [3, 1], 'la 3 queda encima de la 1');
    });

    t.test('las vistas usadas salen de las tomas que van al XML', () => {
        const s = {
            tomas: [
                toma(1, 0, 10, 'R', T0), toma(2, 20, 30, 'PV', T0),
                toma(3, 40, 50, 'X2', T0, { descartada: true }), toma(4, 60, null, 'S', T0)
            ]
        };
        t.deep(carpetaPrproj.vistasUsadas([s]), ['PV', 'R'], 'ni la desactivada ni la abierta');
    });

    t.test('se guarda en la carpeta y se vuelve a leer igual', () => {
        const dir = carpeta();
        carpetaPrproj.guardarConfig(dir, { capturas: 2, vistas: { PV: [1], X2: [1, 2] } });
        t.ok(fs.existsSync(path.join(workspace.datosDir(dir), 'prproj.json')));
        const leida = carpetaPrproj.leerConfig(dir, null);
        t.eq(leida.config.capturas, 2);
        t.deep(leida.config.vistas.X2, [1, 2]);
        t.ok(leida.guardada);
    });

    t.test('una carpeta sin configuración arranca de la última usada', () => {
        const dir = carpeta();
        const leida = carpetaPrproj.leerConfig(dir, { capturas: 3, vistas: { R: [3] } });
        t.eq(leida.config.capturas, 3);
        t.deep(leida.config.vistas.R, [3]);
        t.eq(leida.guardada, false);
    });

    t.group('prproj de la carpeta · dónde cae cada clase');

    t.test('las clases van por hora de inicio, no por nombre', () => {
        // Con el prefijo del renombrado, «Clase 3…» quedaría antes que «curso…»
        // ordenando por nombre, aunque se haya grabado después.
        const dir = carpeta();
        const temprano = sesion(dir, { cero: T0, secuencia: 'curso_2026-09-30_10-00-00' });
        const tarde = sesion(dir, { cero: T0 + UNA_HORA, secuencia: 'Clase 3_curso_2026-09-30_11-00-00' });
        const plan = carpetaPrproj.planear([tarde, temprano], carpetaPrproj.normalizar(null, []));
        t.deep(plan.clases.map(c => c.nombre), [temprano.secuencia, tarde.secuencia]);
    });

    t.test('cada clase arranca después de la anterior más los cinco minutos de aire', () => {
        const dir = carpeta();
        const a = sesion(dir, { cero: T0, segundos: 600 });
        const b = sesion(dir, { cero: T0 + UNA_HORA, segundos: 900 });
        const plan = carpetaPrproj.planear([a, b], carpetaPrproj.normalizar(null, []));
        t.eq(plan.clases[0].franja.desdeSeg, 0);
        t.eq(plan.clases[1].franja.desdeSeg, 600 + nidos.AIRE_SEG);
        t.eq(plan.largoSeg, 600 + nidos.AIRE_SEG + 900, 'sin aire después de la última');
    });

    t.test('una sesión reanudada pone cada WAV en su sitio, hueco incluido', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, wavs: [{ desdeSeg: 0, segundos: 300 }, { desdeSeg: 400, segundos: 200 }] });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.eq(plan.clases[0].franja.largoSeg, 600, 'hasta el final del segundo WAV');
        t.eq(plan.clases[0].wavs.length, 2);
    });

    t.test('un WAV que no está se avisa y la clase entra sin él', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'PV', T0)] });
        fs.unlinkSync(s.sesiones[0].archivo);
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.eq(plan.clases[0].wavs.length, 0);
        t.ok(plan.avisos.some(a => a.includes('no encontré el audio')), plan.avisos.join(' | '));
        // La franja sigue midiendo lo que se grabó, que el sidecar sabe aunque
        // el archivo no esté: la cámara cubre esos 600 s igual, y una franja
        // achicada pisaría a la clase siguiente el día que el WAV vuelva.
        t.eq(plan.clases[0].franja.largoSeg, 600);
    });

    t.group('prproj de la carpeta · la precortada');

    t.test('las tomas van una detrás de otra, y cada corte mira su sitio en la anidación', () => {
        const dir = carpeta();
        const a = sesion(dir, { cero: T0, segundos: 600 });
        const b = sesion(dir, {
            cero: T0 + UNA_HORA, segundos: 600,
            tomas: [toma(1, 100, 130, 'PV', T0 + UNA_HORA), toma(2, 200, 260, 'R', T0 + UNA_HORA)]
        });
        const plan = carpetaPrproj.planear([a, b], carpetaPrproj.normalizar({ capturas: 2, vistas: { R: [2] } }));
        const cortes = plan.clases[1].cortes;
        t.eq(cortes.length, 2);
        t.eq(cortes[0].desdeSeg, 0);
        t.eq(cortes[0].hastaSeg, 30);
        t.eq(cortes[1].desdeSeg, 30, 'pegada a la anterior');
        t.eq(cortes[1].hastaSeg, 90);
        const franja = 600 + nidos.AIRE_SEG;
        t.eq(cortes[0].entradaSeg, franja + 100, 'su franja más su segundo en la clase');
        t.eq(cortes[1].entradaSeg, franja + 200);
        t.eq(cortes[0].fuente, '1');
        t.eq(cortes[1].fuente, '2');
        t.eq(plan.clases[1].duracionSeg, 90);
    });

    t.test('la referencia de A2 corta del WAV que contiene la toma', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, wavs: [{ desdeSeg: 0, segundos: 300 }, { desdeSeg: 400, segundos: 200 }],
            tomas: [toma(1, 450, 480, 'PV', T0)]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        const ref = plan.clases[0].cortes[0].referencia;
        t.eq(ref.ruta, s.sesiones[1].archivo, 'el segundo WAV');
        t.eq(ref.entradaSeg, 50, 'medido desde el principio de ese archivo');
        t.eq(ref.largoSeg, 30);
    });

    t.test('una toma que cruza de un WAV a otro corta su referencia donde termina el primero', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, wavs: [{ desdeSeg: 0, segundos: 300 }, { desdeSeg: 300, segundos: 300 }],
            tomas: [toma(1, 290, 310, 'PV', T0)]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.eq(plan.clases[0].cortes[0].referencia.largoSeg, 10);
        t.ok(plan.avisos.some(a => a.includes('cruza')), plan.avisos.join(' | '));
    });

    t.test('ni las desactivadas ni la que quedó abierta entran', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0,
            tomas: [toma(1, 10, 20, 'PV', T0), toma(2, 30, 40, 'PV', T0, { descartada: true }), toma(3, 50, null, 'PV', T0)]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.deep(plan.clases[0].cortes.map(c => c.toma), [1]);
    });

    t.test('el IN de cada toma lleva su marcador al principio del corte', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, tomas: [toma(1, 10, 15, 'R', T0, { comentarios: [{ desdeMs: T0 + 12000, hastaMs: T0 + 13000, comentario: 'ojo' }] })]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        const [entrada, nota] = plan.clases[0].marcadores;
        t.eq(entrada.nombre, 'Toma 1 · R');
        t.eq(entrada.desdeSeg, 0);
        t.eq(entrada.hastaSeg, 5, 'no más largo que la toma');
        t.eq(entrada.color, notasXml.colorDeVista('R'));
        t.eq(nota.nombre, 'Nota');
        t.eq(nota.desdeSeg, 2, 'en el sitio de la precortada donde quedó ese pedazo');
        t.eq(nota.hastaSeg, 3);
    });

    t.test('una clase sin tomas no lleva precortada, y se dice', () => {
        const dir = carpeta();
        const plan = carpetaPrproj.planear([sesion(dir, { cero: T0 })], carpetaPrproj.normalizar(null, []));
        t.eq(plan.clases[0].cortes.length, 0);
        t.ok(plan.avisos.some(a => a.includes('no lleva precortada')));
    });

    t.group('prproj de la carpeta · capturas y grupos');

    t.test('una vista de dos capturas es un grupo, y los grupos van después de las solas', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, tomas: [toma(1, 10, 20, 'X2', T0), toma(2, 30, 40, 'R', T0), toma(3, 50, 60, 'PV', T0)]
        });
        const config = carpetaPrproj.normalizar({ capturas: 2, vistas: { PV: [1], R: [2], X2: [2, 1] } });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.fuentes.map(f => f.clave), ['1', '2', '2+1']);
        t.deep(plan.grupos.map(g => g.nombre), ['Captura 2 sobre Captura 1']);
        t.eq(plan.clases[0].cortes[0].fuente, '2+1');
    });

    t.test('la misma pareja al revés es otro grupo, con otra anidación', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, tomas: [toma(1, 10, 20, 'R', T0), toma(2, 30, 40, 'X2', T0)]
        });
        const config = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: [1, 2], X2: [2, 1] } });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.grupos.map(g => g.clave), ['1+2', '2+1'], 'dos anidaciones, una por apilado');
        t.deep(plan.grupos.map(g => g.nombre), ['Captura 1 sobre Captura 2', 'Captura 2 sobre Captura 1']);
    });

    t.test('solo entran a la precortada las fuentes que alguna toma usa', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'PV', T0)] });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar({ capturas: 3, vistas: { R: [2], X2: [1, 3] } }));
        t.deep(plan.fuentes.map(f => f.clave), ['1']);
        t.eq(plan.grupos.length, 0, 'la Doble no tiene tomas');
    });

    t.test('las capturas llevan el inicio de cada clase y todas sus claquetas', () => {
        const dir = carpeta();
        const a = sesion(dir, { cero: T0, segundos: 600 });
        const b = sesion(dir, {
            cero: T0 + UNA_HORA, segundos: 600,
            claquetas: [
                { n: 1, ms: T0 + UNA_HORA + 30000, confirmada: true },
                { n: 2, ms: T0 + UNA_HORA + 90000, confirmada: false }
            ]
        });
        const plan = carpetaPrproj.planear([a, b], carpetaPrproj.normalizar(null, []));
        const franja = 600 + nidos.AIRE_SEG;
        const inicios = plan.marcadoresDeCaptura.filter(m => m.color === carpetaPrproj.COLOR_DE_CLASE);
        t.deep(inicios.map(m => m.desdeSeg), [0, franja]);
        const claquetas = plan.marcadoresDeCaptura.filter(m => m.nombre.startsWith('Claqueta'));
        t.deep(claquetas.map(m => m.desdeSeg), [franja + 30, franja + 90]);
        t.ok(claquetas[0].comentario.startsWith(`${b.secuencia} · Claqueta 1`), claquetas[0].comentario);
        t.ok(claquetas[1].comentario.includes('sin confirmar'), 'también las sin confirmar, marcadas');
    });

    t.group('prproj de la carpeta · dónde se escribe');

    t.test('en Proyecto/, con el nombre de la carpeta', () => {
        t.eq(ipcPrproj.destinoDe('/x/Curso Freddy'), '/x/Curso Freddy/Proyecto/Curso Freddy.prproj');
    });

    t.test('uno que ya existe deja el nuevo al lado, sin pisarlo', () => {
        const dir = carpeta();
        const destino = path.join(dir, 'curso.prproj');
        fs.writeFileSync(destino, 'el del editor');
        t.eq(ipcPrproj.alLado(destino), path.join(dir, 'curso 2.prproj'));
        fs.writeFileSync(path.join(dir, 'curso 2.prproj'), 'otro');
        t.eq(ipcPrproj.alLado(destino), path.join(dir, 'curso 3.prproj'));
    });

    t.group('prproj de la carpeta · generar');

    t.test('una carpeta sin clases no genera nada y lo dice', async () => {
        const r = await carpetaPrproj.generar({ carpeta: carpeta(), destino: '/tmp/x.prproj', plantilla: __filename });
        t.eq(r.ok, false);
        t.ok(/ninguna clase/.test(r.error), r.error);
    });

    t.test('sin plantilla lo dice, en vez de romperse', async () => {
        const r = await carpetaPrproj.generar({ carpeta: carpeta(), destino: '/tmp/x.prproj', plantilla: '/no/esta.prproj' });
        t.eq(r.ok, false);
        t.ok(/plantilla/.test(r.error), r.error);
    });

    if (!PLANTILLA) {
        t.skip('armar un proyecto entero y volver a leerlo', 'no hay ninguna plantilla de Premiere en el disco');
        t.skip('una carpeta a otro fps que la plantilla se rechaza', 'no hay ninguna plantilla de Premiere en el disco');
        return;
    }

    /** Una carpeta real en el disco, con dos clases, para `generar`. */
    function carpetaConClases(fps) {
        const dir = carpeta();
        const clases = [
            { cero: T0, tomas: [[1, 10, 40, 'PV'], [2, 50, 80, 'R'], [3, 90, 120, 'X2']] },
            { cero: T0 + UNA_HORA, tomas: [[1, 5, 25, 'PV']] }
        ];
        for (const c of clases) {
            const secuencia = `prueba_${c.cero}`;
            const s = sesion(dir, {
                cero: c.cero, secuencia, segundos: 200, fps,
                tomas: c.tomas.map(([id, a, b, v]) => toma(id, a, b, v, c.cero)),
                claquetas: [{ n: 1, ms: c.cero + 3000, confirmada: true }]
            });
            const estado = { ...vivo.estadoNuevo({ secuencia, ceroMs: c.cero, fps: fps || 30 }), ...s };
            const archivos = workspace.archivosDeSesion(dir, secuencia);
            workspace.writeJson(archivos.json, notasXml.sidecar(estado));
        }
        return dir;
    }

    t.test('armar un proyecto entero y volver a leerlo', async () => {
        const dir = carpetaConClases(30);
        const destino = path.join(dir, 'Proyecto', 'prueba.prproj');
        const r = await carpetaPrproj.generar({
            carpeta: dir, destino, plantilla: PLANTILLA, semilla: 7,
            config: { capturas: 2, vistas: { PV: [1], R: [2], X2: [2, 1] } }
        });
        t.ok(r.ok, r.error || '');
        t.eq(r.clases, 2);
        t.eq(r.precortadas, 2);
        t.eq(r.grupos, 1);
        t.eq(r.tomas, 4);
        t.eq(r.claquetas, 2);

        const p = prproj.Proyecto.leer(destino);
        const revision = p.verificar();
        t.ok(revision.ok, `sin referencias colgando, índices salteados ni GUID repetidos: ${JSON.stringify(revision).slice(0, 300)}`);
        const nombre = k => (/<Name>([^<]*)<\/Name>/.exec(p.contenido(k)) || [])[1];
        const secuencias = p.porClase('Sequence').map(nombre);
        for (const s of ['Captura 1', 'Captura 2', 'Captura 2 sobre Captura 1']) t.ok(secuencias.includes(s), s);
        t.eq(secuencias.length, 5, 'dos capturas, un grupo y dos precortadas');
        t.deep(p.porClase('BinProjectItem').map(nombre).sort(),
            [carpetaPrproj.BIN_CAPTURAS, carpetaPrproj.BIN_PRECORTADAS, carpetaPrproj.BIN_AUDIO].sort());

        // El apilado del menú, leído del archivo: la primera de la lista tiene
        // que haber quedado en el V más alto, que es la que tapa.
        const grupo = p.porClase('Sequence').find(k => nombre(k) === 'Captura 2 sobre Captura 1');
        t.deep(capturasDeLasPistas(p, grupo), ['Captura 1', 'Captura 2'], 'de V1 para arriba');
    });

    t.test('una carpeta a otro fps que la plantilla se rechaza', async () => {
        const dir = carpetaConClases(29.97);
        const r = await carpetaPrproj.generar({
            carpeta: dir, destino: path.join(dir, 'Proyecto', 'x.prproj'), plantilla: PLANTILLA
        });
        t.eq(r.ok, false);
        t.ok(/fps/.test(r.error), r.error);
        t.eq(fs.existsSync(path.join(dir, 'Proyecto', 'x.prproj')), false, 'y no escribió nada');
    });
};
