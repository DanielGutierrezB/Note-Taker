'use strict';
/**
 * El idioma de la clase: cambiarlo a mitad, y que «Automático» no cueste caro.
 *
 * Reportado el 20/10: «si la persona empieza sus notas y está en inglés pero es
 * un curso en español, debería poderlo cambiar en medio de lo que esté
 * haciendo». Hasta entonces el idioma se fijaba al apretar «Iniciar» y no se
 * movía: quien arrancaba con el equivocado se enteraba leyendo el transcript.
 *
 * **Y lo que está en juego no es la ortografía: es que Whisper TRADUCE.**
 * Medido ese día sobre dos clases reales con el modelo que la app usa:
 *
 *   audio en inglés, pedido «es»  →  «¿Qué es el skill prompt que se ha añadido?»
 *   audio en español, pedido «en» →  «the camera will show you the image…»
 *   audio en español, pedido «pt» →  «como acabou de ser agora»
 *
 * O sea que un idioma mal puesto no deja una clase con faltas: la deja en otro
 * idioma, y eso no se arregla mirando. De ahí salen las tres cosas que esto
 * prueba: que se pueda cambiar en vivo, que al cambiarlo se relea lo que ya
 * pasó, y que `auto` —que ahora es lo de fábrica— elija solo entre los dos
 * idiomas donde la detección es de fiar.
 *
 * La otra mitad de la medición es la que hizo barato el automático: el
 * servidor contesta qué idioma DETECTÓ en todas las pasadas, también cuando se
 * le pide uno puesto (871 ms pidiendo «es» contra 1214 ms pidiendo «auto»). Por
 * eso `quePedir` pregunta una vez y después vigila gratis.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const grabacion = require('../engine/grabacion');
const ajustes = require('../engine/ajustes');
const idiomas = require('../engine/idiomas');
const oir = require('../engine/oir');
const oirToma = require('../engine/oir-toma');
const captura = require('../engine/captura');
const sonido = require('../engine/sonido');
const residente = require('../engine/oido-residente');
const espejo = require('../engine/espejo');
const ciclo = require('../engine/ciclo-senales');
const notasXml = require('../engine/notas-xml');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const pedazo = () => Buffer.alloc(48000 * 2);
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-idioma-'));
const reposo = () => new Promise(r => setTimeout(r, 30));

/**
 * Una clase grabando con Whisper de mentira.
 *
 * `falso.pedidos` guarda con qué idioma se pidió cada pasada, que es lo que
 * prueba `quePedir`; `falso.contesta` decide qué idioma «se oyó».
 */
function conClase(fn, opciones) {
    return async () => {
        const antes = { tramo: oirToma.tramo, leer: oirToma.leer };
        const falso = { pedidos: [], relecturas: [], contesta: 'es', palabras: [] };
        oirToma.tramo = async (_a, desde, hasta, liviano, idioma, oyendo) => {
            falso.pedidos.push(idiomas.quePedir({ idioma, oyendo, liviano }));
            return { palabras: falso.palabras.filter(w => w.t >= desde && w.t <= hasta), oido: falso.contesta };
        };
        oirToma.leer = async (_a, toma, o) => {
            falso.relecturas.push({ toma: toma.id, idioma: (o || {}).idioma });
            return { antes: [], palabras: [], despues: [], colapsadas: 0, relectura: null };
        };
        const dir = carpeta();
        try {
            const st = grabacion.iniciar({
                dir, curso: 'i', fps: 30, sinReloj: true, sampleRate: 48000,
                idioma: (opciones && opciones.idioma) || 'auto'
            });
            const s = grabacion._sesion();
            const w = (dt, texto) => ({ t: st.ceroMs + dt, texto, hasta: st.ceroMs + dt + 250 });
            const correr = async n => {
                for (let i = 0; i < n; i++) { grabacion.pcm(pedazo()); await grabacion.buscarSenales(); }
            };
            for (let i = 0; i < 4; i++) grabacion.pcm(pedazo());
            await fn({ st, s, w, correr, falso });
        } finally {
            oirToma.tramo = antes.tramo;
            oirToma.leer = antes.leer;
            grabacion.apagar();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

/**
 * `oir.escuchar` de verdad, con un `whisper-server` de mentira delante.
 *
 * `contesta(idioma, n)` decide qué devuelve la pasada número `n` pedida en
 * `idioma`. Devuelve lo que se le pidió al servidor, en orden, y lo que contestó
 * `escuchar`. Todo lo que toca disco o audio se tapa: lo que se mira es QUÉ se
 * le pide a Whisper, que es lo que hace o deshace una clase traducida.
 */
async function conServidorFalso(contesta, params) {
    const antes = {
        recorte: captura.recorte, tirar: captura.tirar,
        niveles: sonido.niveles, algoSuena: sonido.algoSuena, conSonido: sonido.conSonido,
        sinCola: sonido.sinColaInventada, huecos: sonido.huecosConVoz,
        listo: residente.listo, transcribir: residente.transcribir
    };
    const pedidos = [];
    captura.recorte = () => ({ archivo: '/no/existe.wav', desdeSec: 0 });
    captura.tirar = () => {};
    sonido.niveles = () => ({ db: [0], hopSec: 0.02 });
    sonido.algoSuena = () => true;
    sonido.conSonido = words => ({ words, mudas: 0, quitadas: [] });
    sonido.sinColaInventada = words => ({ words, inventadas: [] });
    sonido.huecosConVoz = () => [];
    residente.listo = () => true;
    residente.transcribir = async (_a, idioma) => {
        pedidos.push(idioma);
        return { words: [], model: 'x', ...contesta(idioma, pedidos.length) };
    };
    try {
        const r = await oir.escuchar({
            sesion: { desdeMs: 0, archivo: '/no/existe.wav' },
            desdeMs: 0, hastaMs: 6000, liviano: true, ...params
        });
        return { pedidos, r };
    } finally {
        Object.assign(captura, { recorte: antes.recorte, tirar: antes.tirar });
        Object.assign(sonido, { niveles: antes.niveles, algoSuena: antes.algoSuena,
            conSonido: antes.conSonido, sinColaInventada: antes.sinCola, huecosConVoz: antes.huecos });
        Object.assign(residente, { listo: antes.listo, transcribir: antes.transcribir });
    }
}

module.exports = function (t) {
    t.group('el idioma · cambiarlo con la clase grabando');

    t.test('cambia el de la sesión y lo deja escrito', conClase(async ({ s }) => {
        t.eq(s.estado.idioma, 'auto', 'arranca como lo de fábrica');
        const r = grabacion.cambiarIdioma('en');
        t.ok(r.ok, 'se puede');
        t.eq(s.estado.idioma, 'en', 'la sesión lo tiene');
        t.eq(r.estado.idioma, 'en', 'y la pantalla se entera en el acto');
        // Y queda en el sidecar, que es lo que lee «Regenerar» mañana.
        t.eq(notasXml.sidecar(s.estado).idioma, 'en');
    }));

    t.test('con releer, las tomas ya cerradas se vuelven a leer, que es donde está el daño',
        conClase(async ({ st, s, falso, correr }) => {
            // Dos cerradas y una abierta, más una desactivada.
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            grabacion.abrirToma(st.ceroMs + 4000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 6000);
            grabacion.editar({ tipo: 'descartar', toma: 2, descartada: true });
            grabacion.abrirToma(st.ceroMs + 7000);
            await reposo();
            falso.relecturas.length = 0;

            const r = grabacion.cambiarIdioma('en', { releer: true });
            t.eq(r.releyendo, 1, 'solo la cerrada que sigue contando');
            await reposo();
            t.deep(falso.relecturas.map(x => x.toma), [1], 'y es esa la que se releyó');
            t.deep(falso.relecturas.map(x => x.idioma), ['en'], 'con el idioma nuevo');
            // La abierta no: el ciclo ya la está oyendo en el idioma nuevo.
            t.eq(s.estado.tomas[2].outMs, null, 'la tercera sigue abierta');
        }));

    t.test('sin releer el idioma cambia igual y lo de atrás queda intacto',
        conClase(async ({ st, s, falso, correr }) => {
            // La respuesta de quien no se quiere arriesgar: de acá en adelante
            // en el idioma nuevo, y lo que ya salió bien que no se toque.
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            await reposo();
            falso.relecturas.length = 0;
            const marca = { inMs: s.estado.tomas[0].inMs, outMs: s.estado.tomas[0].outMs, orillaMs: 12000 };
            s.estado.tomas[0].releida = marca;

            const r = grabacion.cambiarIdioma('en');
            t.ok(r.ok, 'el cambio se hace igual');
            t.eq(r.releyendo, 0, 'y no manda nada a releer');
            t.eq(s.estado.idioma, 'en', 'la clase que sigue se oye en el nuevo');
            await reposo();
            t.deep(falso.relecturas, [], 'ni por la cola entró nada');
            t.deep(s.estado.tomas[0].releida, marca, 'la toma cerrada quedó como estaba');
        }));

    t.test('el resumen dice cuántas se releerían, y son las que se releen',
        conClase(async ({ st, s, correr }) => {
            // La ventana pregunta «¿Releer N tomas?» con este número: si lo
            // contara ella y el motor releyera otras, el diálogo mentiría.
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            grabacion.abrirToma(st.ceroMs + 4000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 6000);
            grabacion.editar({ tipo: 'descartar', toma: 2, descartada: true });
            grabacion.abrirToma(st.ceroMs + 7000);
            await reposo();
            const dice = espejo.resumen(s).porReleer;
            t.eq(dice, 1, 'ni la abierta ni la descartada');
            t.eq(grabacion.cambiarIdioma('en', { releer: true }).releyendo, dice, 'y relee esas');
        }));

    t.test('releer tiene que ser «true», no algo que se le parezca', conClase(async ({ st, correr }) => {
        // Lo que no sea un sí explícito es no releer, que es lo que no pisa
        // nada: un `"si"` que llegue por el puente no rehace media clase.
        grabacion.abrirToma(st.ceroMs + 1000);
        await correr(2);
        grabacion.cerrarToma(st.ceroMs + 3000);
        t.eq(grabacion.cambiarIdioma('en', { releer: 'si' }).releyendo, 0);
        t.eq(grabacion.cambiarIdioma('es', { releer: 1 }).releyendo, 0);
    }));

    t.test('y entre las dos respuestas solo cambia la cola, no el idioma',
        conClase(async ({ st, s, correr }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            await reposo();
            // Con `auto` puesto a mano, lo que se venía oyendo deja de valer en
            // los dos casos: eso es del idioma, no de la relectura.
            s.estado.idiomaOido = 'en';
            grabacion.cambiarIdioma('pt');
            t.eq(s.estado.idiomaOido, null, 'sin releer también se olvida lo oído');
            t.eq(notasXml.sidecar(s.estado).idioma, 'pt', 'y el sidecar lo dice igual');
        }));

    t.test('la marca de releída se quita, o la cola solo le completaría la orilla',
        conClase(async ({ st, s, correr }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            await reposo();
            // Como la deja una relectura que ya corrió: con esa marca puesta,
            // `pasada` la manda a completar la orilla en vez de leerla entera.
            s.estado.tomas[0].releida = { inMs: s.estado.tomas[0].inMs, outMs: s.estado.tomas[0].outMs, orillaMs: 12000 };
            grabacion.cambiarIdioma('en', { releer: true });
            t.eq(s.estado.tomas[0].releida, undefined);
        }));

    t.test('los bordes no se mueven: la toma se abrió donde se abrió',
        conClase(async ({ st, s, w, correr }) => {
            grabacion.abrirToma(st.ceroMs + 1000);
            await correr(2);
            grabacion.cerrarToma(st.ceroMs + 3000);
            const antes = s.estado.tomas.map(x => `${x.inMs}-${x.outMs}`);
            grabacion.cambiarIdioma('pt');
            t.deep(s.estado.tomas.map(x => `${x.inMs}-${x.outMs}`), antes);
        }));

    t.test('un idioma que la app no oye se rechaza, y lo dice', conClase(async ({ s }) => {
        for (const malo of ['fr', 'automático', '--help', '', null, 'es-419']) {
            const r = grabacion.cambiarIdioma(malo);
            t.ok(!r.ok, `«${malo}» no se acepta`);
            t.ok(/no es un idioma/.test(r.error || ''), 'y se dice por qué');
        }
        t.eq(s.estado.idioma, 'auto', 'nada de eso lo movió');
    }));

    t.test('sin clase grabando no hace nada', () => {
        grabacion.apagar();
        const r = grabacion.cambiarIdioma('en');
        t.ok(!r.ok);
        t.eq(r.estado, null, 'y no inventa un estado');
    });

    t.test('con «Terminar» apretado tampoco', conClase(async ({ st, s, correr }) => {
        // Terminar cierra el audio y espera la cola para que ninguna toma se
        // quede con el texto del ciclo. Mandarle media clase a releer en ese
        // momento es alargar el cierre con lecturas que el editor no pidió, y
        // además el idioma ya no cambia nada: no entra más audio.
        grabacion.abrirToma(st.ceroMs + 1000);
        await correr(2);
        grabacion.cerrarToma(st.ceroMs + 3000);
        s.terminando = true;
        const r = grabacion.cambiarIdioma('en');
        t.ok(!r.ok, 'se niega');
        t.eq(s.estado.idioma, 'auto', 'y no lo movió');
    }));

    t.test('el mismo idioma no relee nada', conClase(async ({ st, correr }) => {
        grabacion.abrirToma(st.ceroMs + 1000);
        await correr(2);
        grabacion.cerrarToma(st.ceroMs + 3000);
        const r = grabacion.cambiarIdioma('auto');
        t.ok(r.ok);
        t.eq(r.releyendo, 0, 'no se relee una clase entera por tocar el que ya estaba');
    }));

    t.group('el idioma · qué se le pide a Whisper');

    t.test('con el idioma puesto se pide ese, siempre', () => {
        t.eq(idiomas.quePedir({ idioma: 'es', liviano: true }), 'es');
        t.eq(idiomas.quePedir({ idioma: 'pt', liviano: true, oyendo: 'en' }), 'pt',
            'lo que suene no cambia lo que se pidió: alguien lo eligió');
        t.eq(idiomas.quePedir({ idioma: 'en', liviano: false }), 'en');
    });

    t.test('con «auto», el ciclo pregunta una vez y después oye el que viene oyendo', () => {
        // Es lo que hace que automático no cueste 400 ms por pasada: medido el
        // 20/10, 1214 ms pidiendo «auto» contra 871 ms pidiendo el idioma.
        t.eq(idiomas.quePedir({ idioma: 'auto', liviano: true }), 'auto',
            'la primera, cuando no sabe nada');
        t.eq(idiomas.quePedir({ idioma: 'auto', liviano: true, oyendo: 'en' }), 'en',
            'y después, el que suena');
        t.eq(idiomas.quePedir({ idioma: 'auto', liviano: true, oyendo: 'pt' }), 'auto',
            'un idioma que «auto» no elige no sirve de atajo');
    });

    t.test('una relectura con «auto» siempre pregunta', () => {
        // Es una por toma, con la toma entera delante —donde detectar acierta
        // mucho más que en seis segundos— y los 400 ms no se los lleva nadie
        // que esté mirando.
        t.eq(idiomas.quePedir({ idioma: 'auto', liviano: false, oyendo: 'es' }), 'auto');
    });

    t.group('el idioma · «Automático» elige entre español e inglés');

    t.test('un portugués detectado se resuelve con las probabilidades', () => {
        // Un español lleno de términos técnicos en inglés se puede confundir
        // con un portugués en seis segundos, y dejarlo pasar traduce la clase.
        t.eq(idiomas.entreEsEIn('pt', { es: 0.7, en: 0.2, pt: 0.9 }, null), 'es');
        t.eq(idiomas.entreEsEIn('it', { es: 0.1, en: 0.8 }, null), 'en');
        t.eq(idiomas.entreEsEIn('es', { en: 0.9 }, null), 'es', 'lo que ya es de los dos se queda');
        t.eq(idiomas.entreEsEIn('pt', null, 'en'), 'en', 'sin probabilidades, el que venía sonando');
        t.eq(idiomas.entreEsEIn('pt', null, null), 'es', 'y sin nada, el español');
    });

    t.test('con un portugués detectado, la ventana se vuelve a leer en español', async () => {
        // Es lo que impide que una clase salga traducida, así que se prueba de
        // verdad y no por la forma del código: se le pone delante un servidor
        // que contesta «portuguese» y se mira QUÉ pidió después.
        const { pedidos, r } = await conServidorFalso((idioma, n) => (n === 1
            // La primera dice portugués, y con el español muy por encima: es un
            // español con términos técnicos, no una clase en portugués.
            ? { oido: 'pt', pesos: { pt: 0.5, es: 0.9, en: 0.1 } }
            : { oido: 'es', pesos: null }), { idioma: 'auto' });
        t.deep(pedidos, ['auto', 'es'], 'preguntó, no le gustó la respuesta, y volvió a leer en español');
        t.eq(r.oido, 'es', 'y eso es lo que informa haber oído');
    });

    t.test('y un español detectado no se vuelve a leer: sería pagar dos pasadas por nada', async () => {
        const { pedidos } = await conServidorFalso(() => ({ oido: 'en', pesos: null }), { idioma: 'auto' });
        t.deep(pedidos, ['auto'], 'una sola pasada');
    });

    t.test('con el idioma ya asentado, un portugués no se relee en el mismo que se pidió', async () => {
        // Asentado en español, la pasada pide «es» y el servidor igual contesta
        // qué detectó. Si detecta portugués y lo más parecido es el español,
        // releer en «es» lo que se acaba de leer en «es» eran 870 ms por el
        // mismo texto, en cada pasada donde el español sonara a portugués.
        const { pedidos, r } = await conServidorFalso(
            () => ({ oido: 'pt', pesos: { pt: 0.6, es: 0.8, en: 0.1 } }),
            { idioma: 'auto', oyendo: 'es' });
        t.deep(pedidos, ['es'], 'una sola pasada');
        t.eq(r.oido, 'es', 'y lo oído es español, no portugués');
    });

    t.test('asentado en español, un portugués que se parece al inglés sí se relee en inglés', async () => {
        const { pedidos, r } = await conServidorFalso((idioma, n) => (n === 1
            ? { oido: 'pt', pesos: { pt: 0.6, es: 0.1, en: 0.7 } }
            : { oido: 'en', pesos: null }), { idioma: 'auto', oyendo: 'es' });
        t.deep(pedidos, ['es', 'en']);
        t.eq(r.oido, 'en');
    });

    t.test('qué se oyó y con qué releer, como regla suelta', () => {
        const auto = (pedido, oido, pesos) => idiomas.enAutomatico({ idioma: 'auto', pedido, oido, pesos, oyendo: null });
        t.deep(auto('auto', 'en', null), { oido: 'en', releerCon: null }, 'lo que ya es de los dos, tal cual');
        t.deep(auto('auto', 'pt', { es: 0.9 }), { oido: 'es', releerCon: 'es' });
        t.deep(auto('es', 'pt', { es: 0.9 }), { oido: 'es', releerCon: null }, 'ya se pidió español');
        t.deep(auto('es', null, null), { oido: null, releerCon: null }, 'sin detección no hay nada que hacer');
        // Llevado a español o inglés AUNQUE la segunda lectura falle: con un
        // «pt» la barra diría «Auto · PT», y la pasada siguiente volvería a
        // pedir `auto` para siempre.
        t.eq(auto('auto', 'pt', null).oido, 'es', 'nunca queda un portugués en automático');
        t.deep(idiomas.enAutomatico({ idioma: 'pt', pedido: 'pt', oido: 'pt', pesos: null }),
            { oido: 'pt', releerCon: null }, 'puesto a mano, lo que se eligió no se discute');
        t.deep(idiomas.enAutomatico({ idioma: 'es', pedido: 'es', oido: 'en', pesos: null }),
            { oido: 'en', releerCon: null }, 'y lo oído se informa tal cual, que es lo que pinta el ámbar');
    });

    t.test('los nombres de whisper-server se entienden', () => {
        // El servidor contesta «spanish» y `whisper-cli` contesta «es»: con la
        // traducción repartida, comparar los dos daba siempre «cambió de idioma».
        t.eq(idiomas.normalizar('spanish'), 'es');
        t.eq(idiomas.normalizar('English'), 'en');
        t.eq(idiomas.normalizar('portuguese'), 'pt');
        t.eq(idiomas.normalizar('es'), 'es');
        t.eq(idiomas.normalizar('es-419'), 'es');
        t.eq(idiomas.normalizar('en_US'), 'en');
        t.eq(idiomas.normalizar('italian'), null, 'lo que no se reconoce no se adivina');
        t.eq(idiomas.normalizar(''), null);
        t.eq(idiomas.normalizar(undefined), null);
    });

    t.test('el servidor dice qué oyó, y eso es lo que se mira', () => {
        const fn = leer('engine', 'oido-residente.js');
        t.ok(/oido: idiomas\.normalizar\(dicho\.detected_language\)/.test(fn),
            'el DETECTADO, no el que se usó: con el idioma forzado los dos difieren');
        t.ok(/pesos: dicho\.language_probabilities/.test(fn),
            'y cuánto se parece a cada uno, que es lo que resuelve un portugués detectado');
    });

    t.group('el idioma · lo que suena, con histéresis');

    t.test('una pasada suelta en otro idioma no cambia el rótulo', conClase(async ({ s, falso, correr }) => {
        falso.contesta = 'en';
        await correr(1);
        t.eq(s.estado.idiomaOido, null, 'con una sola no alcanza: pudo ser una cita');
        await correr(1);
        t.eq(s.estado.idiomaOido, 'en', 'con dos seguidas, sí');
    }));

    t.test('dos idiomas alternándose no hacen parpadear nada', conClase(async ({ s, falso, correr }) => {
        for (const cual of ['en', 'es', 'en', 'es']) { falso.contesta = cual; await correr(1); }
        t.eq(s.estado.idiomaOido, null, 'ninguno llegó a dos seguidas');
    }));

    t.test('y sale en el resumen, que es de donde lo lee la barra', conClase(async ({ s, falso, correr }) => {
        falso.contesta = 'en';
        await correr(2);
        const r = espejo.resumen(s);
        t.eq(r.idioma, 'auto');
        t.eq(r.idiomaOido, 'en');
    }));

    t.test('poner el idioma a mano olvida lo que venía oyendo', conClase(async ({ s, falso, correr }) => {
        falso.contesta = 'en';
        await correr(2);
        t.eq(s.estado.idiomaOido, 'en');
        grabacion.cambiarIdioma('es');
        t.eq(s.estado.idiomaOido, null,
            'o la barra avisaría de una discrepancia medida contra el idioma viejo');
    }));

    t.test('poner el idioma a mano también olvida la racha que venía contando', conClase(async ({ s, falso, correr }) => {
        // Una pasada en inglés antes del cambio y una después no son dos
        // seguidas: entre medio alguien dijo qué idioma es.
        falso.contesta = 'en';
        await correr(1);
        grabacion.cambiarIdioma('es');
        await correr(1);
        t.eq(s.estado.idiomaOido, null, 'una sola después del cambio no alcanza');
        await correr(1);
        t.eq(s.estado.idiomaOido, 'en', 'y con dos después, sí');
    }));

    t.group('el idioma · la regla de la histéresis');

    const anotar = pasadas => pasadas.reduce(
        (a, oido) => idiomas.anotarOido(a.oido, a.racha, oido), { oido: 'es', racha: null }).oido;

    t.test('dos pasadas seguidas en otro idioma lo cambian, una no', () => {
        t.eq(idiomas.PASADAS_PARA_CAMBIAR, 2);
        t.eq(anotar(['en']), 'es', 'pudo ser una cita');
        t.eq(anotar(['en', 'en']), 'en');
    });

    t.test('un silencio en el medio no corta la cuenta', () => {
        // Una pasada sin nada que oír no dice que se volvió al español: dice
        // que nadie habló. Contándola como otra cosa, una pausa entre dos
        // ventanas en inglés hacía empezar de cero.
        t.eq(anotar(['en', null, 'en']), 'en');
        t.eq(anotar(['en', null, null, 'en']), 'en');
    });

    t.test('volver al idioma de siempre sí la corta', () => {
        t.eq(anotar(['en', 'es', 'en']), 'es');
        t.eq(anotar(['en', 'pt', 'en']), 'es', 'y otro idioma distinto, también');
    });

    t.test('sin nada oído todavía también pide dos', () => {
        // Al arrancar es cuando más fácil es que la primera ventana sea una
        // cita, y con el idioma puesto a mano el ámbar parpadearía de entrada.
        const desdeNada = pasadas => pasadas.reduce(
            (a, oido) => idiomas.anotarOido(a.oido, a.racha, oido), { oido: null, racha: null }).oido;
        t.eq(desdeNada(['es']), null);
        t.eq(desdeNada(['es', 'es']), 'es');
    });

    t.group('el idioma · lo de fábrica');

    t.test('una clase nueva arranca en automático', () => {
        t.eq(ajustes.DEFAULTS.idioma, 'auto');
        t.eq(ajustes.DEFAULTS.semanal.idioma, 'auto');
    });

    t.test('el porqué está escrito, con lo que se midió', () => {
        // Es el ajuste que cambió de criterio: el comentario tiene que contar
        // por qué, o el próximo que lo lea lo vuelve a poner fijo «porque
        // detectar cuesta».
        const fn = leer('engine', 'ajustes.js');
        t.ok(/TRADUCE/.test(fn), 'que equivocarse traduce');
        t.ok(/detect/i.test(fn) && /pasada/.test(fn), 'y qué pasó con el precio de detectar');
    });

    t.group('el idioma · el motor y la ventana dicen lo mismo');

    t.test('las dos listas de idiomas no se pueden separar', async () => {
        // `engine/idiomas.js` es CommonJS y `src/js/idiomas.js` son módulos que
        // carga el navegador, así que no se pueden importar entre sí. Lo único
        // que comparten es la lista; si se separa, la barra ofrece un idioma
        // que el motor rechaza, o uno que el motor oye se queda sin nombre.
        const ventana = await import(pathToFileURL(path.join(RAIZ, 'src', 'js', 'idiomas.js')).href);
        t.deep(ventana.IDIOMAS, idiomas.IDIOMAS, 'los que se pueden elegir');
        for (const l of idiomas.IDIOMAS.concat(['auto'])) {
            t.ok(ventana.nombre(l) !== l, `«${l}» tiene nombre en la pantalla`);
        }
        t.deep(ventana.opciones('auto').map(o => o.valor), ['auto'].concat(idiomas.IDIOMAS),
            'y el menú ofrece justo los que el motor acepta');
        for (const o of ventana.opciones('auto')) t.ok(idiomas.esElegible(o.valor), `el motor acepta «${o.valor}»`);
    });

    t.test('el menú de la barra ofrece automático primero y los tres debajo', () => {
        const ventana = leer('src', 'js', 'idiomas.js');
        const fn = ventana.slice(ventana.indexOf('export function opciones'));
        t.ok(/valor: 'auto'/.test(fn), 'automático está');
        t.ok(fn.indexOf("valor: 'auto'") < fn.indexOf('IDIOMAS.map'), 'y va primero');
        t.ok(/marcada: o\.valor === puesto/.test(fn), 'y se marca el que está puesto');
    });

    t.test('el canal existe de punta a punta', () => {
        // Un canal que la ventana llama y el puente no declara es una promesa
        // rechazada en medio de una clase.
        t.ok(/grabarIdioma: \(cual, opciones\) => ipcRenderer\.invoke\('grabar-idioma', cual, opciones\)/
            .test(leer('preload.js')), 'con la respuesta de releer, que viaja con el idioma');
        t.ok(/ipcMain\.handle\('grabar-idioma', \(event, cual, opciones\) =>\s*grabacion\.cambiarIdioma\(cual, opciones\)\)/
            .test(leer('ipc', 'grabar.js')), 'y el ipc la pasa, o la respuesta se perdería en el camino');
        const doble = leer('tools', 'maqueta', 'doble.js');
        t.ok(/grabarIdioma:/.test(doble),
            'y la maqueta lo tiene, o sus escenarios romperían al tocar el rótulo');
        t.ok(/preguntar: async \(\{ opciones \} = \{\}\) =>/.test(doble),
            'con la pregunta contestada por valor, como el diálogo de verdad');
        t.ok(/releyendo: \(opciones && opciones\.releer === true\) \? estado\.porReleer : 0/.test(doble),
            'y contestando distinto según lo que se pidió, que es lo que se va a mirar');
    });

    t.test('las dos pantallas cambian el idioma y lo muestran con las mismas piezas', () => {
        // La clase y el vídeo semanal tenían cada una su `cambiarIdioma` y su
        // rótulo, casi iguales, y ya habían empezado a decir cosas distintas.
        // Ahora preguntar, avisar y cómo se ve el rótulo son de `idiomas.js`; a
        // cada pantalla le queda dónde lo guarda y cómo repinta.
        for (const cual of ['pantalla-vivo.js', 'pantalla-semanal.js']) {
            const fn = leer('src', 'js', cual);
            const cuerpo = fn.slice(fn.indexOf('async function cambiarIdioma(cual) {'));
            t.ok(/await idiomas\.cambiar\(cual, /.test(cuerpo), `${cual} cambia por idiomas.cambiar`);
            t.ok(!/grabarIdioma/.test(fn), `${cual} no le habla al motor por su cuenta`);
            t.ok(/idiomas\.rotulo\(/.test(fn), `${cual} usa el rótulo compartido`);
            t.ok(/rotuloBarra\.pintar\(/.test(fn), `${cual} lo pone sin rehacerlo en cada vuelta`);
        }
    });

    t.test('en el vídeo semanal el rótulo vive fuera de la tarjeta', () => {
        // La tarjeta se rehace entera con cada estado, una vez por segundo
        // grabando: un rótulo adentro se cambiaba por otro en medio del clic.
        // Va en la fila del título, que no se rehace, al lado del reloj: el
        // mismo sitio que tiene en la clase, al lado del timecode.
        const titulo = leer('src', 'index.html').match(/<div class="seccion-titulo">[\s\S]*?id="semanal-reloj"/);
        t.ok(titulo && /id="semanal-rotulos"/.test(titulo[0]), 'su caja es fija, en el HTML');
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/\$\('#vista-semanal'\)\.addEventListener\('click', alClic\)/.test(semanal),
            'y el clic se escucha en la sección entera, o el rótulo quedaría sordo fuera del cuerpo');
        // La tarjeta se repinta solo cuando cambian las tomas (`repintarReloj`
        // y su huella). Lo que oye cambia sin que cambie ninguna, así que el
        // rótulo se pone al día con el reloj, cada segundo: atado a la tarjeta,
        // el «Auto · EN» y el ámbar no aparecían hasta la toma siguiente.
        const reloj = semanal.slice(semanal.indexOf('async function repintarReloj() {'));
        t.ok(/\$\('#semanal-reloj'\)\.textContent = [^\n]*\n\s*pintarRotulo\(\);/.test(reloj),
            'el rótulo se pone al día con el reloj, no con la tarjeta');
        t.ok(/app\.guardarAjustes\(\{ semanal: \{ idioma: cual \} \}\)/.test(semanal),
            'y el idioma se guarda por la misma puerta que Ajustes, o el vídeo siguiente arranca en el viejo');
        t.ok(!/rotulos-barra|rotuloBarra|idiomas\./.test(leer('src', 'js', 'semanal', 'tarjetas.js')),
            'y la tarjeta no dibuja ninguno');
    });

    /* ─── Ajustes, más corto ─────────────────────────────────────────────
     *
     * El panel tenía siete renglones de dependencias abiertos empujando fuera
     * de la vista todo lo que sí se cambia, y ofrecía cambiar de modo en medio
     * de una clase, que es ofrecer tirar la pantalla donde está esa clase.
     */
    t.group('ajustes · el panel no estorba');

    t.test('«Lo que la app necesita» viene plegado', () => {
        const html = leer('src', 'index.html');
        t.ok(/<details class="campo" id="aj-deps">/.test(html), 'es un desplegable');
        t.ok(!/<details class="campo" id="aj-deps" open>/.test(html), 'y no nace abierto');
        t.ok(/id="aj-deps-dice"/.test(html), 'con un resumen que dice si falta algo');
    });

    t.test('y se abre solo cuando falta algo imprescindible', () => {
        const app = leer('src', 'js', 'app.js');
        const fn = app.slice(app.indexOf('function pintarResumenDeps'), app.indexOf('\n}', app.indexOf('function pintarResumenDeps')));
        t.ok(/if \(requeridas\.length\) caja\.open = true;/.test(fn),
            'sin eso no se puede grabar: hay que verlo sin buscarlo');
        t.ok(!/caja\.open = false/.test(fn),
            'y no se cierra solo: a quien lo abrió para mirar algo no se le cierra en la cara');
        t.ok(/está todo/.test(fn), 'cuando no falta nada, lo dice');
    });

    t.test('«Para qué usás Note Taker» no se ofrece mientras se graba', () => {
        const app = leer('src', 'js', 'app.js');
        t.ok(/\$\('#aj-modo-campo'\)\.hidden = await hayAlgoGrabando\(\);/.test(app),
            'se esconde la pregunta, porque la respuesta siempre iba a ser que no');
        const quien = app.slice(app.indexOf('async function hayAlgoGrabando'), app.indexOf('\n}', app.indexOf('async function hayAlgoGrabando')));
        t.ok(/window\.nt\.grabarEstado\(\)/.test(quien) && /semanal\.grabando\(\)/.test(quien),
            'y quien sabe si hay algo grabando es el motor, no la pantalla');
        const cambio = app.slice(app.indexOf("$('#aj-modo').addEventListener"), app.indexOf('\n    });', app.indexOf("$('#aj-modo').addEventListener")));
        t.ok(/if \(await hayAlgoGrabando\(\)\)/.test(cambio),
            'y la guarda del cambio se queda: una clase puede arrancar sola desde que el panel se pintó');
    });
};
