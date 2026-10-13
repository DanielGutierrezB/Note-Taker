'use strict';
/**
 * Los tres caminos que faltaban en el vídeo de la semana.
 *
 * Los tres son la misma falta: entrar a un sitio del que no se sale.
 *
 *   · Al editor se entra por tres puertas —terminar de grabar, «Seguir con
 *     esa» y «Ajustar y cortar de nuevo»— y de las tres se salía exportando.
 *     Entrar por error costaba un corte entero. Lo contó quien lo usa: «no me
 *     permite arrepentirme».
 *   · «Lo último que grabaste» mira solo la carpeta de los ajustes, así que un
 *     vídeo de otra semana que vive en otro sitio no tenía por dónde abrirse.
 *   · Y el botón al Finder estaba solo después de cortar, que es cuando ya no
 *     hace falta: lo que se quiere mirar es si la pantalla se grabó, y eso se
 *     pregunta mientras se ajusta.
 *
 * Lo que se prueba es lo que puede salir mal sin que se note mirando:
 *
 *   · Que el botón de volver vuelva al sitio equivocado. Son dos sitios según
 *     de dónde se vino, y acertar la mitad de las veces es peor que no estar.
 *   · Que volver pase por `ver()`, que se protege sola mientras la revisión
 *     está a medias: el botón se apretaba y no pasaba nada. Pasó, y de ahí sale
 *     la prueba.
 *   · Que elegir una carpeta MUDE la de los ajustes. Es de esta vez, no para
 *     siempre, y escribirla cambiaría dónde caen los vídeos de mañana.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

/** Una sesión como la que dibuja la línea, con lo poco que la línea mira. */
const unaSesion = extra => Object.assign({
    json: '/x/xml/Datos/semana_notas-en-vivo.json',
    nombre: 'semana_2026-10-04_19-29-01',
    cuandoMs: new Date('2026-10-04T19:29:01').getTime(),
    tomas: 3, fuera: 1, segundos: 162
}, extra || {});

/** El estado del panel, con lo que `tarjetaListo` necesita para dibujarse. */
const elPanel = extra => Object.assign({
    paso: 'listo', vista: 'R', vistas: [], avisos: [],
    camaras: [], entradas: [], camara: null, micro: null, pantalla: null,
    audio: { abierto: true, pico: 0, error: null },
    ultima: null, buscada: null, encontradas: []
}, extra || {});

module.exports = async t => {
    const tarjetas = await import(pathToFileURL(
        path.join(RAIZ, 'src', 'js', 'semanal', 'tarjetas.js')).href);
    const semanal = leer('src', 'js', 'pantalla-semanal.js');

    t.group('salir del editor · el botón de volver');

    const elEditor = extra => tarjetas.tarjetaRevisar(Object.assign({
        paso: 'revisar', ficha: null, vistas: [], grabada: { tomas: [] },
        montaje: { tomas: [] }, silencios: true, mejorarAudio: true, hecho: null
    }, extra || {}));

    t.test('vuelve al vídeo si hay uno cortado, y al panel si no', () => {
        // El nombre del sitio va en el botón porque no es siempre el mismo. Un
        // «Atrás» a secas obliga a apretarlo para saber qué hace.
        t.ok(elEditor({ hecho: { ok: true, ruta: '/x/semana.mp4' } }).includes('Volver al vídeo'),
            'viniendo de un vídeo ya cortado, vuelve a él');
        t.ok(elEditor().includes('Volver al panel'),
            'y recién grabado, al panel de antes de grabar');
    });

    t.test('el botón existe en el editor, que es donde no había ninguno', () => {
        t.ok(elEditor().includes('data-hace="atras"'));
        t.ok(/hace === 'atras'\) return atras\(\)/.test(semanal), 'y el clic lo encuentra');
    });

    t.test('volver no pasa por ver(), que se protege sola', () => {
        // `grabando()` cuenta `revisar`, así que `ver()` hacía `pintar()` y se
        // iba: el botón se apretaba y la pantalla se quedaba igual. Los dos
        // gestos son distintos —entrar a la pantalla y abandonar lo que se
        // estaba haciendo— y ahora el reinicio está aparte.
        t.ok(/async function alPanel\(\)/.test(semanal), 'el reinicio del panel es suyo');
        t.ok(/function atras\(\)[\s\S]{0,500}return alPanel\(\);/.test(semanal),
            'y volver lo llama derecho, sin el portero de `ver`');
        t.ok(/export async function ver\(\)[\s\S]{0,400}if \(grabando\(\)\) \{ pintar\(\); return; \}[\s\S]{0,200}await alPanel\(\)/
            .test(semanal), 'y `ver` conserva su portero y delega el resto');
    });

    t.test('volver al vídeo no vuelve a cortar ni pierde lo ajustado', () => {
        const atras = semanal.slice(semanal.indexOf('function atras()'));
        t.ok(/estado\.hecho && estado\.hecho\.ok/.test(atras.slice(0, 400)),
            'mira si hay vídeo hecho');
        t.ok(/estado\.paso = 'hecho'/.test(atras.slice(0, 400)),
            'y es solo cambiar de paso: el MP4 no se toca');
        t.ok(/montaje\.pausar\(\)/.test(atras.slice(0, 400)),
            'con el montaje callado, que nadie lo va a mirar');
        t.ok(!/semanalExportar/.test(atras.slice(0, 400)), 'y no corta nada');
    });

    t.group('salir del editor · mostrar en Finder mientras se ajusta');

    t.test('el editor tiene su botón a la carpeta', () => {
        t.ok(elEditor().includes('data-hace="ver-brutos"'),
            'el mismo gesto que al final, que ya sabe abrir la carpeta de lo grabado');
    });

    t.test('la maqueta no confunde el editor con la tarjeta del final', () => {
        // Su guion usaba «Ver lo que se grabó» para saber si ya estaba cortado,
        // y el botón nuevo del editor lo hizo decir «ya está» en la revisión:
        // el escenario del vídeo hecho se quedaba a medio camino. Ahora
        // pregunta por «Grabar otro», que es de la tarjeta del final y de
        // ninguna otra.
        const doble = leer('tools', 'maqueta', 'doble.js');
        t.ok(/if \(document\.querySelector\('\[data-hace="otro"\]'\)\) return;/.test(doble));
        t.ok(!elEditor().includes('data-hace="otro"'), 'y el editor no lo tiene');
    });

    t.group('salir del editor · elegir una carpeta');

    t.test('el botón está en el panel, encima de la última', () => {
        const conUltima = tarjetas.tarjetaListo(elPanel({ ultima: unaSesion() }));
        t.ok(conUltima.includes('data-hace="elegir-carpeta"'), 'está');
        t.ok(conUltima.includes('data-hace="abrir-ultima"'), 'y la última sigue');
        t.ok(/hace === 'elegir-carpeta'\) return elegirCarpeta\(boton\)/.test(semanal),
            'y el clic lo encuentra');
    });

    t.test('elegir una carpeta no muda la de los ajustes', () => {
        // Es mirar ahí esta vez. Escribirla cambiaría dónde caen los vídeos de
        // mañana, que no es lo que se pidió ni lo que dice el botón.
        const elegir = semanal.slice(semanal.indexOf('async function elegirCarpeta'));
        const cuerpo = elegir.slice(0, 1200);
        t.ok(/window\.nt\.pickFolder\(/.test(cuerpo), 'abre el diálogo del Finder');
        t.ok(/window\.nt\.grabarListar\(\[dir\]\)/.test(cuerpo),
            'y busca con el mismo listado que la última, que baja por la carpeta solo');
        t.ok(!/carpetaRecordar|ajustesGuardar/.test(cuerpo), 'y no guarda nada');
    });

    t.test('con un solo vídeo entra directo, sin preguntar', () => {
        const cuerpo = semanal.slice(semanal.indexOf('async function elegirCarpeta')).slice(0, 1400);
        t.ok(/estado\.encontradas\.length === 1/.test(cuerpo), 'mira si era uno solo');
        t.ok(/return abrirLaUltima\(boton, sola\)/.test(cuerpo),
            'y lo abre por la misma puerta que la última');
    });

    t.test('con varios los muestra para elegir, y esconde la última', () => {
        // Abrir el más nuevo por su cuenta sería acertar la mitad de las veces
        // y hacer perder el corte la otra mitad. Y la última es de OTRA
        // carpeta: dejarla ahí al lado es ofrecer dos cosas que parecen lo
        // mismo y no lo son.
        const html = tarjetas.tarjetaListo(elPanel({
            ultima: unaSesion(),
            buscada: '/Volumes/Rodaje/Curso',
            encontradas: [unaSesion(), unaSesion({ nombre: 'semana_2026-09-27_18-40-12' })]
        }));
        t.eq((html.match(/data-hace="abrir-hallada"/g) || []).length, 2, 'una fila por vídeo');
        t.ok(html.includes('data-cual="0"') && html.includes('data-cual="1"'),
            'cada una sabe cuál es');
        t.ok(!html.includes('data-hace="abrir-ultima"'), 'y la de la otra carpeta no se ofrece');
        t.ok(html.includes('2 vídeos en <b>Curso</b>'), 'dice cuántos y dónde');
    });

    t.test('una carpeta sin vídeos lo dice y deja elegir otra', () => {
        // Una carpeta equivocada es el caso normal de buscar algo, no un error.
        const html = tarjetas.tarjetaListo(elPanel({ buscada: '/Volumes/Rodaje/Vacía' }));
        t.ok(html.includes('no hay ningún vídeo grabado'));
        t.ok(html.includes('data-hace="elegir-carpeta"'), 'y se puede probar con otra');
    });

    t.test('y lo deja elegir UNA vez, aunque haya algo para seguir', () => {
        // Con una grabación de antes a mano salían dos: «Elegir otra…» al lado
        // del aviso y, debajo, «¿El vídeo que buscás está en otra carpeta?» con
        // el mismo botón. La pregunta es para quien todavía no buscó.
        const html = tarjetas.tarjetaListo(elPanel({ ultima: unaSesion(), buscada: '/Volumes/Rodaje/Vacía' }));
        t.eq(html.split('data-hace="elegir-carpeta"').length - 1, 1, 'un solo botón de carpeta');
        t.ok(html.includes('Seguir con esa'), 'y lo de antes sigue ahí');
    });

    t.test('sin nada que seguir, la tarjeta entera no está', () => {
        // Una línea que dice «no hay nada» no ayuda a grabar, que es lo que se
        // viene a hacer cuando no hay nada.
        const html = tarjetas.tarjetaListo(elPanel());
        t.ok(!html.includes('semanal-ultima'), 'ni la tarjeta');
        t.ok(!html.includes('data-hace="elegir-carpeta"'), 'ni el botón de carpeta');
    });

    t.test('la carpeta elegida no sobrevive al volver al panel', () => {
        // Dejar la lista de ayer arriba de la de la carpeta de siempre sería
        // prometer que sigue mirando ahí.
        const panel = semanal.slice(semanal.indexOf('async function alPanel'));
        t.ok(/estado\.buscada = null;/.test(panel.slice(0, 900)));
        t.ok(/estado\.encontradas = \[\];/.test(panel.slice(0, 900)));
    });

    t.test('la última y las halladas se leen con la misma función', () => {
        // Dos lecturas parecidas se habrían separado en cuanto una contara las
        // tomas distinto, y entonces la misma grabación diría dos cosas según
        // por qué línea se llegó a ella.
        t.ok(/function deLaLista\(s\)/.test(semanal), 'hay una sola lectura');
        t.ok(/estado\.ultima = deLaLista\(ultima\);/.test(semanal), 'la última la usa');
        t.ok(/\.map\(deLaLista\)/.test(semanal), 'y las halladas también');
        t.ok(/tomas: \(resumen\.tomas \|\| 0\) \+ \(resumen\.descartadas \|\| 0\)/.test(semanal),
            'con las descartadas contadas: el editor las abre todas');
    });
};
