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
    return pistasDeVideo(p, secuencia).map(pista => {
        const fuente = p.cierre([pista], { claseFrontera: ['Sequence'] })
            .find(k => p.clase(k) === 'VideoSequenceSource');
        const dentro = fuente && p.refsDe(fuente).find(k => p.clase(k) === 'Sequence');
        return dentro ? nombre(dentro) : null;
    });
}

/**
 * De qué color quedaron los clips de cada pista de vídeo, de V1 para arriba.
 *
 * El color va dos veces en el archivo y acá se lee el nombre, que es el que
 * Premiere muestra. Una pista sin clips, o con clips sin pintar, da `null`.
 */
function coloresDeLasPistas(p, secuencia) {
    return pistasDeVideo(p, secuencia).map(pista => {
        const clip = p.cierre([pista], { claseFrontera: ['Sequence'] })
            .filter(k => p.clase(k) === 'VideoClip')[0];
        const m = clip && /BE\.Prefs\.LabelColors\.(\d+)/.exec(p.contenido(clip));
        return m ? m[1] : null;
    });
}

/** Cuántos clips quedaron en cada pista de vídeo, de V1 para arriba. */
function clipsDeLasPistas(p, secuencia) {
    return pistasDeVideo(p, secuencia).map(pista => p.cierre([pista], { claseFrontera: ['Sequence'] })
        .filter(k => p.clase(k) === 'VideoClipTrackItem').length);
}

function pistasDeVideo(p, secuencia) {
    const grupo = p.refsDe(secuencia).find(k => p.clase(k) === 'VideoTrackGroup');
    return [...p.contenido(grupo).matchAll(/<Track Index="\d+" Object(U?)Ref="([^"]+)"/g)]
        .map(m => prproj.clave(m[1] === 'U' ? 'UID' : 'ID', m[2]));
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
        for (const v of vivo.VISTAS) {
            t.deep(c.vistas[v.nombre], { capturas: [1], unidas: false, siempre: [1] }, v.nombre);
        }
    });

    t.test('una vista que nombra una captura que ya no está vuelve a la 1', () => {
        const c = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: { capturas: [3] }, X2: { capturas: [2, 2, 1] } } });
        t.deep(c.vistas.R.capturas, [1], 'la 3 no existe');
        t.deep(c.vistas.X2.capturas, [2, 1], 'sin repetidos y en el orden que se eligió');
    });

    t.test('el orden de una vista es el apilado y se respeta tal cual', () => {
        const c = carpetaPrproj.normalizar({ capturas: 3, vistas: { R: { capturas: [3, 1] } } });
        t.deep(c.vistas.R.capturas, [3, 1], 'la 3 queda encima de la 1');
    });

    t.test('una vista guardada como lista pelada sigue siendo una anidación', () => {
        // Es la forma de las primeras versiones, y lo que hay escrito en las
        // carpetas de entonces: ahí dos capturas eran siempre una anidación.
        const c = carpetaPrproj.normalizar({ capturas: 2, vistas: { X2: [1, 2] } });
        t.deep(c.vistas.X2, { capturas: [1, 2], unidas: true, siempre: [1, 2] });
    });

    t.test('con una sola captura no hay nada que anidar', () => {
        const c = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: { capturas: [2], unidas: true } } });
        t.eq(c.vistas.R.unidas, false);
    });

    t.test('sueltas se guarda como sueltas', () => {
        const c = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: { capturas: [1, 2], unidas: false } } });
        t.deep(c.vistas.R, { capturas: [1, 2], unidas: false, siempre: [1, 2] });
    });

    t.test('una captura puede entrar solo en las tomas de su vista', () => {
        const c = carpetaPrproj.normalizar({
            capturas: 2, vistas: { R: { capturas: [1, 2], unidas: false, siempre: [2] } }
        });
        t.deep(c.vistas.R.siempre, [2], 'la 2 queda puesta en todas y la 1 solo en las de R');
    });

    t.test('una anidación es un clip en una pista, así que ahí es todo o nada', () => {
        const una = carpetaPrproj.normalizar({
            capturas: 2, vistas: { R: { capturas: [1, 2], unidas: true, siempre: [2] } }
        });
        t.deep(una.vistas.R.siempre, [1, 2], 'pedir una captura del grupo pone el grupo entero');
        const ninguna = carpetaPrproj.normalizar({
            capturas: 2, vistas: { R: { capturas: [1, 2], unidas: true, siempre: [] } }
        });
        t.deep(ninguna.vistas.R.siempre, [], 'y sin ninguna, la anidación entra solo en sus tomas');
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
        carpetaPrproj.guardarConfig(dir, {
            capturas: 2, vistas: { PV: { capturas: [1] }, X2: { capturas: [2, 1], unidas: false, siempre: [2] } }
        });
        t.ok(fs.existsSync(path.join(workspace.datosDir(dir), 'prproj.json')));
        const leida = carpetaPrproj.leerConfig(dir, null);
        t.eq(leida.config.capturas, 2);
        t.deep(leida.config.vistas.X2, { capturas: [2, 1], unidas: false, siempre: [2] });
        t.ok(leida.guardada);
    });

    t.test('una carpeta sin configuración arranca de la última usada', () => {
        const dir = carpeta();
        const leida = carpetaPrproj.leerConfig(dir, { capturas: 3, vistas: { R: { capturas: [3] } } });
        t.eq(leida.config.capturas, 3);
        t.deep(leida.config.vistas.R.capturas, [3]);
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
        t.deep(cortes[0].fuentes, ['1']);
        t.deep(cortes[1].fuentes, ['2']);
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

    t.test('una toma con nota lleva un marcador que dura el bloque entero', () => {
        // En la precortada el plano ya se ve —la pista encendida, con su
        // color—, así que el marcador solo está donde hay algo que leer, y
        // abarca la toma porque la nota es de la toma.
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 15, 'R', T0, { comentario: 'repetir el final' })] });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        const [entrada] = plan.clases[0].marcadores;
        t.eq(entrada.nombre, 'Toma 1 · R');
        t.eq(entrada.desdeSeg, 0);
        t.eq(entrada.hastaSeg, 5, 'de punta a punta de la toma');
        t.ok(entrada.comentario.startsWith('repetir el final'), entrada.comentario);
        t.eq(entrada.color, notasXml.colorDeVista('R'));
    });

    t.test('una toma sin nota no lleva marcador', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 15, 'R', T0)] });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.deep(plan.clases[0].marcadores, []);
    });

    t.test('una nota sobre un pedazo dura lo que dura ese pedazo', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0,
            tomas: [toma(1, 10, 15, 'R', T0, {
                comentarios: [{ desdeMs: T0 + 12000, hastaMs: T0 + 13000, comentario: 'ojo' }]
            })]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        const [nota] = plan.clases[0].marcadores;
        t.eq(nota.nombre, 'Nota');
        t.eq(nota.desdeSeg, 2, 'en el sitio de la precortada donde quedó ese pedazo');
        t.eq(nota.hastaSeg, 3);
        t.eq(nota.color, notasXml.BLANCO);
    });

    t.test('el audio de referencia lleva los marcadores de toda la sesión', () => {
        // Es lo único que el editor tiene para ubicarse mientras sincroniza: dos
        // horas de onda. Son los mismos que el XML le pone al clip maestro, y
        // medidos desde el arranque DEL ARCHIVO, que no es el cero de la clase
        // cuando el dispositivo se cayó y el audio siguió en otro WAV.
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0,
            wavs: [{ desdeSeg: 0, segundos: 100 }, { desdeSeg: 200, segundos: 100 }],
            tomas: [toma(1, 10, 20, 'PV', T0), toma(2, 210, 220, 'R', T0)],
            claquetas: [{ n: 1, ms: T0 + 5000, confirmada: true }]
        });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        const [uno, dos] = plan.clases[0].wavs;
        t.deep(uno.marcadores.map(m => m.nombre), ['Claqueta 1', 'Toma 1 · PV', 'Toma 1 · OUT']);
        t.eq(uno.marcadores[1].desdeSeg, 10);
        // El segundo WAV arrancó a los 200 s de la clase: su toma está en el 10.
        t.deep(dos.marcadores.map(m => m.nombre), ['Toma 2 · R', 'Toma 2 · OUT']);
        t.eq(dos.marcadores[0].desdeSeg, 10, 'medido desde el arranque de ESE archivo');
        t.eq(dos.marcadores[0].color, notasXml.colorDeVista('R'));
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
        t.deep(plan.grupos.map(g => g.nombre), ['Captura 1 sobre Captura 2'], 'las claves van de abajo hacia arriba');
        t.deep(plan.grupos.map(g => g.titulo), ['X2'], 'la anidación se llama como su vista');
        t.deep(plan.clases[0].cortes[0].fuentes, ['2+1']);
    });

    t.test('dos vistas con la misma anidación la comparten, y lleva los dos nombres', () => {
        // Es una sola secuencia: tocarle el encuadre a una le toca el encuadre a
        // la otra, y el nombre tiene que decirlo antes de que pase.
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'X2', T0), toma(2, 30, 40, 'MG', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2,
            vistas: { X2: { capturas: [2, 1], unidas: true }, MG: { capturas: [2, 1], unidas: true } }
        });
        const plan = carpetaPrproj.planear([s], config);
        t.eq(plan.grupos.length, 1, 'una sola anidación para las dos');
        t.eq(plan.grupos[0].titulo, 'MG y X2', 'en el orden de las vistas');
    });

    t.test('cada anidación lleva su color, y las vecinas no repiten', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'X2', T0), toma(2, 30, 40, 'R', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2, vistas: { R: [2], X2: { capturas: [2, 1], unidas: true } }
        });
        const plan = carpetaPrproj.planear([s], config);
        const colores = plan.fuentes.map(f => f.color);
        t.eq(colores.filter(Boolean).length, plan.fuentes.length, 'todas pintadas');
        t.eq(new Set(colores).size, plan.fuentes.length, `y ninguna repetida: ${colores.join(', ')}`);
        const sola = plan.fuentes.find(f => f.clave === '2');
        t.eq(sola.color, plan.colorDeCaptura.get(2), 'la pista de una captura, del color de su anidación');
    });

    t.test('una vista suelta enciende una fuente por captura, sin anidación', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'R', T0), toma(2, 30, 40, 'PV', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2, vistas: { PV: { capturas: [1] }, R: { capturas: [1, 2], unidas: false } }
        });
        const plan = carpetaPrproj.planear([s], config);
        t.eq(plan.grupos.length, 0, 'suelta no arma anidación');
        t.deep(plan.clases[0].cortes[0].fuentes, ['1', '2'], 'la toma de R enciende las dos');
        t.deep(plan.clases[0].cortes[1].fuentes, ['1'], 'la de PV solo la suya');
    });

    t.test('las pistas se ordenan para que la de encima quede arriba', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'R', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 3, vistas: { R: { capturas: [1, 3, 2], unidas: false } }
        });
        const plan = carpetaPrproj.planear([s], config);
        // Las dos listas van de abajo hacia arriba, que es como se reparten las
        // pistas: la vista pide 1, después 3 y la 2 encima de todo.
        t.deep(plan.fuentes.map(f => f.clave), ['1', '3', '2']);
        t.deep(plan.avisos, []);
    });

    t.test('dos vistas sueltas que se contradicen: manda la primera y se dice', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'R', T0), toma(2, 30, 40, 'X2', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2,
            vistas: { R: { capturas: [1, 2], unidas: false }, X2: { capturas: [2, 1], unidas: false } }
        });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.fuentes.map(f => f.clave), ['1', '2'], 'la 2 encima, que es lo que pidió R');
        t.eq(plan.avisos.length, 1);
        t.ok(/X2|Doble/.test(plan.avisos[0]), plan.avisos[0]);
        t.ok(/anid/.test(plan.avisos[0]), 'y dice cómo arreglarlo');
    });

    t.test('cada fuente sabe si se queda puesta en todas las tomas', () => {
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'R', T0), toma(2, 30, 40, 'PV', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2,
            vistas: { PV: { capturas: [1], siempre: [1] }, R: { capturas: [2], siempre: [] } }
        });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.fuentes.map(f => [f.clave, f.siempre]), [['1', true], ['2', false]]);
        t.deep(plan.avisos, []);
    });

    t.test('dos vistas que comparten una fuente y no piden lo mismo: queda puesta y se dice', () => {
        // La Captura 2 sola es la MISMA pista para las dos vistas: no hay forma
        // de que esté en todas las tomas para una y solo en las suyas para la otra.
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, tomas: [toma(1, 10, 20, 'S', T0), toma(2, 30, 40, 'MG', T0)] });
        const config = carpetaPrproj.normalizar({
            capturas: 2,
            vistas: { S: { capturas: [2], siempre: [2] }, MG: { capturas: [2], siempre: [] } }
        });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.fuentes.map(f => [f.clave, f.siempre]), [['2', true]]);
        t.eq(plan.avisos.length, 1);
        t.ok(/MG|Mano/.test(plan.avisos[0]), plan.avisos[0]);
        t.ok(/una sola pista/.test(plan.avisos[0]), 'y dice por qué');
    });

    t.test('la misma pareja al revés es otro grupo, con otra anidación', () => {
        const dir = carpeta();
        const s = sesion(dir, {
            cero: T0, tomas: [toma(1, 10, 20, 'R', T0), toma(2, 30, 40, 'X2', T0)]
        });
        const config = carpetaPrproj.normalizar({ capturas: 2, vistas: { R: [1, 2], X2: [2, 1] } });
        const plan = carpetaPrproj.planear([s], config);
        t.deep(plan.grupos.map(g => g.clave), ['1+2', '2+1'], 'dos anidaciones, una por apilado');
        t.deep(plan.grupos.map(g => g.nombre), ['Captura 2 sobre Captura 1', 'Captura 1 sobre Captura 2']);
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

    t.test('y TODAS las tomas, tengan nota o no: el nido es donde se sincroniza', () => {
        // Al contrario de la precortada, donde el marcador solo está si hay algo
        // que leer: ahí el plano se ve en la pista encendida, y acá no hay más
        // que la onda del audio de referencia.
        const dir = carpeta();
        const s = sesion(dir, { cero: T0, segundos: 600, tomas: [toma(1, 10, 20, 'PV', T0)] });
        const plan = carpetaPrproj.planear([s], carpetaPrproj.normalizar(null, []));
        t.deep(plan.clases[0].marcadores, [], 'en la precortada no, que no tiene nota');
        const toma1 = plan.marcadoresDeCaptura.filter(m => m.nombre.startsWith('Toma 1'));
        t.deep(toma1.map(m => [m.nombre, m.desdeSeg, m.hastaSeg]),
            [['Toma 1 · PV', 10, 20], ['Toma 1 · OUT', 20, 20]]);
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
        for (const s of ['Captura 1', 'Captura 2', 'X2']) t.ok(secuencias.includes(s), s);
        t.eq(secuencias.length, 5, 'dos capturas, un grupo y dos precortadas');
        t.deep(p.porClase('BinProjectItem').map(nombre).sort(),
            [carpetaPrproj.BIN_CAPTURAS, carpetaPrproj.BIN_PRECORTADAS, carpetaPrproj.BIN_AUDIO].sort());

        // El apilado del menú, leído del archivo: la X2 se pidió `[2, 1]`, o sea
        // la 2 abajo y la 1 encima, y así tienen que haber quedado las pistas.
        const grupo = p.porClase('Sequence').find(k => nombre(k) === 'X2');
        t.deep(capturasDeLasPistas(p, grupo), ['Captura 2', 'Captura 1'], 'de V1 para arriba');

        // Y cada pista de la precortada, del color de su anidación: es lo que
        // deja leer de un vistazo qué plano es cada bloque.
        const precortada = p.porClase('Sequence').find(k => nombre(k) === `prueba_${T0}`);
        const colores = coloresDeLasPistas(p, precortada);
        t.eq(colores.filter(Boolean).length, 3, `las tres pistas pintadas: ${colores.join(', ')}`);
        t.eq(new Set(colores).size, 3, 'y las tres de distinto color');

        // Los marcadores del audio, que es la parte que no se puede comprobar en
        // el plan: que hayan quedado en el contenedor DEL MEDIO, que es el que
        // miran el clip maestro —el monitor de origen— y todos los cortes de ese
        // archivo donde aparezcan.
        const wavMaestro = p.porClase('MasterClip').find(k => /\.wav$/.test(nombre(k) || ''));
        const clip = p.refsDe(wavMaestro).find(k => p.clase(k) === 'AudioClip');
        const marcas = p.refsDe(clip).find(k => p.clase(k) === 'Markers');
        t.ok(marcas, 'el clip maestro del WAV tiene su contenedor de marcadores');
        const cuantos = (p.contenido(marcas).match(/<Marker Version/g) || []).length;
        // La primera clase: una claqueta y tres tomas, con su IN y su OUT.
        t.eq(cuantos, 7, 'con los marcadores de toda la sesión');
        t.ok(p.quienReferencia(marcas).filter(k => p.clase(k) === 'AudioClip').length > 1,
            'y es el mismo que usan los cortes de ese audio en las capturas');
    });

    t.test('una captura puesta solo en sus tomas no deja clips en las demás', async () => {
        const dir = carpetaConClases(30);
        const destino = path.join(dir, 'Proyecto', 'solo.prproj');
        const r = await carpetaPrproj.generar({
            carpeta: dir, destino, plantilla: PLANTILLA, semilla: 7,
            config: {
                capturas: 2,
                vistas: {
                    PV: { capturas: [1], siempre: [] },
                    R: { capturas: [2], siempre: [2] },
                    X2: { capturas: [2, 1], siempre: [2, 1] }
                }
            }
        });
        t.ok(r.ok, r.error || '');

        const p = prproj.Proyecto.leer(destino);
        t.ok(p.verificar().ok, 'y el archivo queda sano');
        const nombre = k => (/<Name>([^<]*)<\/Name>/.exec(p.contenido(k)) || [])[1];
        // La primera clase tiene tres tomas, una por vista.
        const precortada = p.porClase('Sequence').find(k => nombre(k) === `prueba_${T0}`);
        t.deep(capturasDeLasPistas(p, precortada), ['Captura 1', 'Captura 2', 'X2']);
        t.deep(clipsDeLasPistas(p, precortada), [1, 3, 3], 'la Captura 1 sola, solo en la toma de PV');
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
