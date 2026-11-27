'use strict';
/**
 * La misma carpeta de clases, exportada para OpenFilm.
 *
 * Lo que se cuida acá es que el agente que lea esa carpeta no tenga que hacer
 * ninguna cuenta ni adivinar nada:
 *
 *   · los segundos de cada toma son los mismos cortes que van a Premiere;
 *   · el `.vtt` es WebVTT de verdad, con las palabras adentro del archivo;
 *   · la guía nombra las capturas, las vistas y cuántas tomas tiene cada clase;
 *   · el audio se enlaza si se puede, y se copia si no;
 *   · exportar otra vez no le pisa el montaje a nadie.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const openfilm = require('../engine/openfilm-carpeta');
const { guia, NOMBRE_DE_LA_GUIA, largo, comoSeCompone } = require('../engine/openfilm-guia');
const vtt = require('../engine/vtt');
const prprojPlan = require('../engine/prproj-plan');
const prprojConfig = require('../engine/prproj-carpeta-config');
const ajustar = require('../engine/ajustar-corte');
const vivo = require('../engine/notas-vivo');
const notasXml = require('../engine/notas-xml');
const workspace = require('../engine/workspace');

const T0 = Date.parse('2026-09-30T10:00:00');
const UNA_HORA = 3600 * 1000;

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-openfilm-'));

/** Un WAV con su cabecera, que es lo único que mira `fs.existsSync`. */
function wav(dir, nombre) {
    const ruta = path.join(workspace.audioDir(dir), nombre);
    workspace.ensureDir(path.dirname(ruta));
    fs.writeFileSync(ruta, Buffer.alloc(64));
    return ruta;
}

const palabra = (cero, seg, texto) => ({ t: cero + seg * 1000, hasta: cero + seg * 1000 + 300, texto });

function toma(id, desdeSeg, hastaSeg, vista, cero, extra) {
    return {
        id,
        vista,
        comentario: '',
        descartada: false,
        inMs: cero + desdeSeg * 1000,
        outMs: cero + hastaSeg * 1000,
        palabras: [palabra(cero, desdeSeg + 0.5, 'hola'), palabra(cero, desdeSeg + 1, 'mundo')],
        comentarios: [],
        ...(extra || {})
    };
}

/**
 * Una carpeta en el disco con clases de verdad: su sidecar y su WAV.
 *
 * Los sidecars se escriben con `notasXml.sidecar`, que es por donde pasan los de
 * la app, así que lo que se prueba acá lee lo mismo que leería una carpeta real.
 */
function carpetaConClases(opciones) {
    const o = opciones || {};
    const dir = o.dir || carpeta();
    for (const clase of o.clases) {
        const secuencia = clase.secuencia || `curso_${clase.cero}`;
        const estado = {
            ...vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: clase.cero, fps: 30 }),
            secuencia,
            numero: clase.numero,
            ceroMs: clase.cero,
            terminada: clase.cero + 1,
            sesiones: [{
                archivo: wav(dir, `${secuencia}-1.wav`),
                desdeMs: clase.cero,
                segundos: clase.segundos || 200,
                sampleRate: 48000,
                canales: 1
            }],
            tomas: clase.tomas || [],
            sueltas: clase.sueltas || []
        };
        const archivos = workspace.archivosDeSesion(dir, secuencia);
        workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    }
    return dir;
}

/** Dos clases con tomas, que es el caso de siempre. */
function dosClases(dir) {
    return carpetaConClases({
        dir,
        clases: [
            {
                cero: T0,
                numero: 1,
                tomas: [toma(1, 10, 40, 'PV', T0), toma(2, 50, 80, 'R', T0),
                    { ...toma(3, 90, 120, 'PV', T0), descartada: true }]
            },
            { cero: T0 + UNA_HORA, numero: 2, tomas: [toma(1, 5, 25, 'R', T0 + UNA_HORA)] }
        ]
    });
}

const CONFIG = {
    capturas: 2,
    vistas: {
        PV: { capturas: [1], unidas: false, siempre: [1] },
        R: { capturas: [2, 1], unidas: true, siempre: [2, 1] }
    }
};

const leerJson = ruta => JSON.parse(fs.readFileSync(ruta, 'utf8'));

module.exports = async function (t) {
    t.group('openfilm · los segundos son los mismos que van a Premiere');

    t.test('cada toma trae sus tres relojes, y coinciden con el plan', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        t.ok(r.ok, r.error || '');
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));

        // El mismo plan que arma el `.prproj`, para comparar contra él.
        const sesiones = require('../engine/sesiones-grabadas').listar([dir], null);
        const plan = prprojPlan.planear(sesiones, prprojConfig.normalizar(CONFIG));
        t.eq(datos.clases.length, plan.clases.length, 'las mismas clases');

        for (const [i, clase] of datos.clases.entries()) {
            const delPlan = plan.clases[i];
            t.eq(clase.tomas.length, delPlan.cortes.length, `${clase.titulo}: las mismas tomas`);
            for (const [j, toma] of clase.tomas.entries()) {
                const corte = delPlan.cortes[j];
                t.eq(toma.toma, corte.toma);
                t.eq(toma.enLaPrecortada.desdeSeg, Math.round(corte.desdeSeg * 1000) / 1000, 'el at del clip');
                t.eq(toma.enLaCaptura.desdeSeg, Math.round(corte.entradaSeg * 1000) / 1000, 'su entrada en la captura');
            }
        }
    });

    t.test('y los del audio son los del sidecar, sin ninguna cuenta de por medio', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        const sesiones = require('../engine/sesiones-grabadas').listar([dir], null);
        const primera = sesiones.slice().sort((a, b) => a.ceroMs - b.ceroMs)[0];
        const suya = datos.clases[0].tomas[0];
        const deLaSesion = primera.tomas.find(x => x.id === suya.toma);
        const desde = (ajustar.inAjustado(deLaSesion) - primera.sesiones[0].desdeMs) / 1000;
        t.eq(suya.enElAudio.desdeSeg, Math.round(desde * 1000) / 1000);
        t.eq(suya.enElAudio.archivo, `${openfilm.AUDIO}/${path.basename(primera.sesiones[0].archivo)}`);
    });

    t.test('una toma desactivada no está: lo que se ve es lo que va al corte', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        t.deep(datos.clases[0].tomas.map(x => x.toma), [1, 2], 'sin la 3, que está descartada');
        t.eq(r.tomas, 3, 'y la cuenta del resultado tampoco la cuenta');
    });

    t.test('cada toma dice de qué fuente sale, y la fuente dice su film', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        const pv = datos.clases[0].tomas.find(x => x.vista === 'PV');
        const erre = datos.clases[0].tomas.find(x => x.vista === 'R');
        const film = clave => datos.fuentes.find(f => f.clave === clave).film;
        t.eq(film(pv.fuentes[0]), 'parts/captura-1/film.html', 'PV sale de la captura sola');
        t.eq(film(erre.fuentes[0]), 'parts/vista-r/film.html', 'y R de su anidación');
    });

    t.group('openfilm · lo que se dijo, en WebVTT');

    t.test('el archivo es WebVTT, con cada palabra marcada adentro de su línea', () => {
        const cero = T0;
        const sesion = {
            tomas: [{ palabras: [palabra(cero, 1, 'hola'), palabra(cero, 1.4, 'mundo')], antes: [], despues: [] }],
            sueltas: []
        };
        const texto = vtt.deLaSesion(sesion, { desdeMs: cero, segundos: 60 });
        t.ok(/^WEBVTT\n/.test(texto), 'arranca como manda el formato');
        t.ok(/\n00:00:01\.000 --> 00:00:0\d\.\d{3}\n/.test(texto), texto);
        t.ok(/\nhola <00:00:01\.400>mundo\n/.test(texto), 'la primera sin marca y las demás con la suya');
    });

    t.test('las palabras seguidas no se pierden: solo se tira la misma de otra lectura', () => {
        const cero = T0;
        // Habla normal: dos o tres décimas entre palabra y palabra.
        const dichas = [palabra(cero, 1, 'uno'), palabra(cero, 1.25, 'dos'), palabra(cero, 1.5, 'tres')];
        const sesion = {
            // Y la misma frase otra vez, con las horas corridas unas centésimas,
            // que es como la deja la lectura de al lado.
            tomas: [{ palabras: dichas, antes: [], despues: [palabra(cero, 1.03, 'uno')] }],
            sueltas: [palabra(cero, 1.28, 'dos')]
        };
        const palabras = vtt.palabrasDelArchivo(sesion, { desdeMs: cero, segundos: 60 });
        t.deep(palabras.map(w => w.texto), ['uno', 'dos', 'tres']);
    });

    t.test('las líneas se cortan en las pausas, no a mitad de frase', () => {
        const cero = T0;
        const sesion = {
            tomas: [{
                palabras: [palabra(cero, 1, 'antes'), palabra(cero, 1.3, 'de'),
                    palabra(cero, 5, 'después'), palabra(cero, 5.3, 'de')],
                antes: [], despues: []
            }],
            sueltas: []
        };
        const lineas = vtt.enLineas(vtt.palabrasDelArchivo(sesion, { desdeMs: cero, segundos: 60 }));
        t.eq(lineas.length, 2, 'el silencio del medio las parte');
        t.deep(lineas[0].map(w => w.texto), ['antes', 'de']);
    });

    t.test('en una clase muda no se escribe ningún .vtt', async () => {
        const dir = carpetaConClases({ clases: [{ cero: T0, numero: 1, tomas: [] }] });
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const audio = fs.readdirSync(path.join(r.ruta, openfilm.AUDIO));
        t.ok(audio.some(f => f.endsWith('.wav')), 'el audio sí va');
        t.ok(!audio.some(f => f.endsWith('.vtt')), `pero no un .vtt vacío: ${audio.join(' ')}`);
    });

    t.test('y el .vtt de una clase con tomas queda al lado de su WAV, con su nombre', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        const audio = datos.clases[0].audio[0];
        t.eq(audio.palabras, audio.archivo.replace(/\.wav$/, '.vtt'));
        t.ok(fs.existsSync(path.join(r.ruta, audio.palabras)), audio.palabras);
    });

    t.group('openfilm · la guía que lee el agente');

    t.test('nombra cada captura con su carpeta y cada vista con su apilado', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const texto = fs.readFileSync(r.guia, 'utf8');
        t.ok(r.guia.endsWith(NOMBRE_DE_LA_GUIA), r.guia);
        t.ok(texto.includes('assets/captura-1'), 'dónde va el video de la Captura 1');
        t.ok(texto.includes('assets/captura-2'), 'y el de la Captura 2');
        t.ok(/\| `R` \| Pantalla \| Captura 1 sobre Captura 2, anidadas \|/.test(texto), texto.slice(0, 200));
    });

    t.test('dice cuántas tomas tiene que quedar cada clase, que es con lo que se revisa', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const texto = fs.readFileSync(r.guia, 'utf8');
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        for (const clase of datos.clases) {
            t.ok(texto.includes(`| ${clase.titulo} | ${clase.tomas.length} |`),
                `${clase.titulo} con sus ${clase.tomas.length} tomas`);
        }
    });

    t.test('pide la sincronía antes de seguir, y trae el plan B', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const texto = fs.readFileSync(r.guia, 'utf8');
        t.ok(/decime cuánto te dio en cada clase antes de seguir/.test(texto), 'la sincronía, dicha antes');
        t.ok(/openfilm look/.test(texto), 'cómo comprobarlo');
        t.ok(/apunten directo al video de la cámara/.test(texto), 'y qué hacer si la anidación no sirve');
    });

    t.test('una clase sin tomas se dice, en vez de dejar una precortada vacía', async () => {
        const dir = carpetaConClases({
            clases: [
                { cero: T0, numero: 1, tomas: [toma(1, 10, 40, 'PV', T0)] },
                { cero: T0 + UNA_HORA, numero: 2, tomas: [] }
            ]
        });
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const texto = fs.readFileSync(r.guia, 'utf8');
        t.ok(/no tiene ninguna toma/.test(texto), 'lo nombra');
        t.ok(/esas no llevan precortada/.test(texto), 'y dice qué hacer con ella');
    });

    t.test('un largo por debajo del minuto se dice en segundos, no «0 min»', () => {
        t.eq(largo(42), '42 s');
        t.eq(largo(120), '2 min');
        t.eq(largo(3600 * 2 + 60 * 5), '2 h 05 min');
    });

    t.test('una vista de una sola captura se nombra sin apilado', () => {
        const capturas = [{ id: 1, nombre: 'Captura 1' }, { id: 2, nombre: 'Captura 2' }];
        t.eq(comoSeCompone({ capturas: [1], unidas: false }, capturas), 'Captura 1');
        t.eq(comoSeCompone({ capturas: [1, 2], unidas: false }, capturas), 'Captura 2 sobre Captura 1, en pistas sueltas');
    });

    t.test('la guía se arma sola de los datos, sin tocar el disco', () => {
        // Es texto a partir de un objeto: sin esto no se podría probar lo que
        // dice sin exportar una carpeta entera.
        const texto = guia({ curso: 'Curso X', aireSeg: 300, capturas: [{ id: 1, nombre: 'Captura 1', material: 'assets/captura-1', film: 'parts/captura-1/film.html' }], vistas: [], clases: [] });
        t.ok(texto.includes('# El primer corte de Curso X'), texto.slice(0, 80));
    });

    t.group('openfilm · el audio de cada clase');

    t.test('se enlaza en vez de copiarse: el mismo archivo con dos nombres', async () => {
        const dir = dosClases();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        const copia = path.join(r.ruta, datos.clases[0].audio[0].archivo);
        const original = path.join(workspace.audioDir(dir), path.basename(copia));
        t.eq(fs.statSync(copia).ino, fs.statSync(original).ino, 'es el mismo archivo, no una copia');
    });

    t.test('y si no se puede enlazar, se copia: OpenFilm solo lee lo suyo', async () => {
        // Entre dos discos no hay enlace posible. Se simula con un `linkSync`
        // que falla, que es exactamente lo que el sistema contesta ahí.
        const dir = dosClases();
        const linkSync = fs.linkSync;
        fs.linkSync = () => { const e = new Error('EXDEV'); e.code = 'EXDEV'; throw e; };
        let r;
        try {
            r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        } finally {
            fs.linkSync = linkSync;
        }
        t.ok(r.ok, r.error || '');
        const datos = leerJson(path.join(r.ruta, openfilm.NOTAS, 'clases.json'));
        const copia = path.join(r.ruta, datos.clases[0].audio[0].archivo);
        t.ok(fs.existsSync(copia), 'el audio está igual');
        t.ok(r.avisos.some(a => /otro disco/.test(a)), `y se dice: ${r.avisos.join(' ')}`);
    });

    t.group('openfilm · exportar otra vez');

    t.test('rehace la guía y las notas, y no toca el montaje del agente', async () => {
        const dir = dosClases();
        const primera = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        t.ok(primera.ok, primera.error || '');

        // Lo que el agente escribió: su film y algo suyo en assets.
        const film = path.join(primera.ruta, 'film.html');
        fs.writeFileSync(film, '<!doctype html><html><body></body></html>');
        workspace.ensureDir(path.join(primera.ruta, 'parts', 'clase-01'));
        const suyo = path.join(primera.ruta, 'parts', 'clase-01', 'film.html');
        fs.writeFileSync(suyo, 'el corte');
        const video = path.join(primera.ruta, openfilm.ASSETS, 'captura-1', 'camara.mp4');
        fs.writeFileSync(video, 'video');

        const antes = fs.readFileSync(primera.guia, 'utf8');
        const segunda = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        t.ok(segunda.ok, segunda.error || '');
        t.eq(fs.readFileSync(segunda.guia, 'utf8'), antes, 'la guía sale igual: exportar dos veces no cambia nada');
        t.eq(fs.readFileSync(suyo, 'utf8'), 'el corte', 'y la precortada del agente sigue donde estaba');
        t.ok(fs.existsSync(film), 'su film.html también');
        t.ok(fs.existsSync(video), 'y el video que soltó en la captura');
    });

    t.group('openfilm · lo que no se puede exportar');

    t.test('una carpeta sin clases lo dice, en vez de dejar una carpeta vacía', async () => {
        const dir = carpeta();
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        t.eq(r.ok, false);
        t.ok(/ninguna clase/.test(r.error), r.error);
        t.ok(!fs.existsSync(path.join(dir, openfilm.CARPETA)), 'y no la crea');
    });

    t.test('una carpeta que no está tampoco rompe nada', async () => {
        const r = await openfilm.exportar({ carpeta: '/no/esta/por/ningun/lado', config: CONFIG });
        t.eq(r.ok, false);
        t.ok(/no está/.test(r.error), r.error);
    });

    t.group('openfilm · el guion de cada clase');

    t.test('lleva cada toma con su vista, su nota y lo que se dice', async () => {
        const dir = carpetaConClases({
            clases: [{
                cero: T0,
                numero: 1,
                tomas: [{ ...toma(1, 10, 40, 'PV', T0), comentario: 'la intro, quedó buena' }]
            }]
        });
        const r = await openfilm.exportar({ carpeta: dir, config: CONFIG });
        const texto = fs.readFileSync(path.join(r.ruta, openfilm.NOTAS, 'clase-01.md'), 'utf8');
        t.ok(/## Toma 1 · PV · la intro, quedó buena/.test(texto), texto.slice(0, 300));
        t.ok(/> hola mundo/.test(texto), 'y lo que se dijo adentro');
        t.ok(/en Captura 1 /.test(texto), 'con la fuente dicha por su nombre y no por su clave');
    });
};
