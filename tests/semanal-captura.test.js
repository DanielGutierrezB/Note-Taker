'use strict';
/**
 * Lo que la ventana tiene que hacer antes de grabar, y después de parar.
 *
 * Estas dos cosas no se pueden probar llamándolas: viven en la ventana, piden
 * una pantalla de verdad y un codificador de verdad. Lo que sí se puede es
 * cuidar que no desaparezcan, y vale la pena porque las dos nacieron de un
 * fallo caro y ninguna de las dos avisa cuando se rompe:
 *
 *   · **el tope de 1920×1080 al pedir la pantalla.** Sin él, una Retina entra
 *     a 5120×3200, el H.264 del Mac la rechaza y el archivo queda en cero
 *     bytes. Medido en el Electron de la app: 5120×3200 falla, 2560×1600 pasa.
 *     Pasó de verdad, y la grabación entera se perdió.
 *   · **la pantalla de revisión.** Antes se exportaba solo al apretar
 *     Terminar, y una toma con la vista equivocada obligaba a rehacer el vídeo
 *     entero. Si alguien vuelve a atar Terminar con exportar, esto se cae.
 *
 * El resto del comportamiento de la ventana se mira en la maqueta, que lo
 * dibuja con el código de verdad (`tools/capturar.js`).
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const exportar = require('../engine/exportar-video');
const dom = require('./fixtures/dom');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

/**
 * La pantalla semanal, que son dos archivos.
 *
 * `pantalla-semanal.js` hace que pasen cosas y `semanal/tarjetas.js` dice lo
 * que se ve; se partieron cuando el primero pasó de las 1.500 líneas. Las
 * comprobaciones de acá miran el texto del código y no les importa en cuál de
 * los dos cayó cada función, así que se leen juntos.
 *
 * Donde se pueda llamar a la función en vez de leerla, mejor: para eso está
 * `cargarTarjetas()` acá abajo, y `corte-del-editor.test.js`, que importan los
 * módulos y comprueban lo que devuelven.
 */
const laPantalla = () => leer('src', 'js', 'pantalla-semanal.js')
    + '\n' + leer('src', 'js', 'semanal', 'tarjetas.js');

/**
 * Las tarjetas, para dibujarlas acá sin navegador.
 *
 * Es un módulo de la ventana, pero no toca el DOM ni espera uno: recibe
 * `estado` y devuelve texto. Por eso se puede llamar desde Node y comprobar lo
 * que SALE, que vale bastante más que comprobar cómo está escrito.
 */
const cargarTarjetas = () => import(
    pathToFileURL(path.join(RAIZ, 'src', 'js', 'semanal', 'tarjetas.js')).href);

module.exports = function (t) {
    t.group('modo semanal · la captura de pantalla');

    const filmar = leer('src', 'js', 'grabar', 'filmar.js');

    t.test('la pantalla se pide acotada, y se acota otra vez por si acaso', () => {
        t.ok(/const MAX_ANCHO = 1920;/.test(filmar), 'el tope está declarado');
        t.ok(/const MAX_ALTO = 1080;/.test(filmar));
        t.ok(/getDisplayMedia\([\s\S]{0,260}width: \{ max: MAX_ANCHO \}/.test(filmar),
            'se pide con el tope puesto');
        t.ok(/applyConstraints\(\{[\s\S]{0,140}width: \{ ideal: MAX_ANCHO, max: MAX_ANCHO \}/.test(filmar),
            'y se encuadra después, que es la vía que no depende del selector del sistema');
    });

    t.test('cambiar de ventana pide la nueva ANTES de soltar la de antes', () => {
        // El orden es todo el diseño. Mientras el selector del sistema está
        // abierto —y la persona puede tardar lo que quiera en elegir— la
        // ventana vieja SIGUE grabando, así que el hueco es el cambio en sí y
        // no la duda. Y si cancela el selector o el codificador rechaza la
        // ventana nueva, no se tocó nada: la grabación sigue intacta.
        const cambiar = filmar.slice(filmar.indexOf('export async function cambiarPantalla'));
        const pide = cambiar.indexOf('await pedirPantalla(false)');
        const suelta = cambiar.indexOf("estado.grabadores.get('pantalla')");
        t.ok(pide !== -1 && suelta !== -1, 'las dos cosas están');
        t.ok(pide < suelta, 'y pedir va primero');
        t.ok(/const elegida = await pedirPantalla\(false\);\s*\n\s*if \(!elegida\.ok\) return elegida;/
            .test(cambiar), 'cancelar el selector se devuelve sin haber tocado la grabación');
    });

    t.test('eligiendo, la pantalla se adopta antes de comprobar el codificador', () => {
        // Al revés —adoptarla al volver, como hace el cambio de ventana— deja
        // medio segundo largo, el que tarda `aguanta`, en el que la persona ya
        // eligió pero `tienePantalla()` dice que no hay. Apretar Grabar ahí
        // contestaba «No hay ni cámara ni pantalla que grabar». Pasó.
        const pedir = filmar.slice(filmar.indexOf('async function pedirPantalla'));
        const adopta = pedir.indexOf('if (enSeguida) quedarse(stream, pista);');
        const prueba = pedir.indexOf('formatoQueAguanta(stream');
        t.ok(adopta !== -1 && prueba !== -1, 'las dos cosas están');
        t.ok(adopta < prueba, 'y adoptarla va primero');
        t.ok(/pedirPantalla\(true\)/.test(filmar), 'eligiendo se pide así');
        t.ok(/pedirPantalla\(false\)/.test(filmar), 'y cambiando de ventana, al revés');
        t.ok(/if \(enSeguida\) await soltarPantalla\(\);/.test(filmar),
            'y si el codificador la rechaza, la adoptada se suelta');
    });

    t.test('el tramo viejo se cierra entero antes de abrir el nuevo', () => {
        const cambiar = filmar.slice(filmar.indexOf('export async function cambiarPantalla'));
        t.ok(/viejo\.onstop = listo;/.test(cambiar),
            'se espera el último pedazo, que si no el tramo pierde sus segundos finales');
        t.ok(/await window\.nt\.semanalCerrar\('pantalla'\)/.test(cambiar),
            'y se cierra SOLO la pantalla, no la cámara');
        const cierra = cambiar.indexOf("semanalCerrar('pantalla')");
        const abre = cambiar.indexOf('semanalAbrir(');
        t.ok(cierra !== -1 && abre !== -1 && cierra < abre, 'en ese orden, que si no se pisan el archivo');
    });

    t.test('antes de grabar, cambiar de ventana y elegirla son lo mismo', () => {
        t.ok(/if \(!grabando\(\)\) return elegirPantalla\(\);/.test(filmar),
            'sin grabación no hay tramo que cerrar ni hueco que cuidar');
    });

    t.test('una cámara clavada chica se sube, no solo se baja la grande', () => {
        // Leer los nombres de las cámaras con `video: true` dejaba el
        // dispositivo negociado a 640×480 y el pedido de verdad lo heredaba.
        const ojo = leer('src', 'js', 'grabar', 'ojo.js');
        t.ok(/let lista = await mirar\(\);\n\s+if \(!lista\.length \|\| lista\.every\(d => !d\.label\)\)/
            .test(ojo), 'primero se mira y solo se pide permiso si los nombres vienen vacíos');
        t.ok(/const chica = \(antes\.width \|\| 0\) < MAX_ANCHO/.test(filmar),
            'y el encuadre mira también si entró demasiado chica');
    });

    t.test('el tope es exactamente el tamaño del vídeo que sale', () => {
        // Si el exportador creciera a 4K y esto se quedara en 1080, se estaría
        // escalando hacia arriba una captura peor que la pantalla que se grabó.
        t.eq(exportar.ANCHO, 1920, 'el vídeo final');
        t.eq(exportar.ALTO, 1080);
        t.ok(/const MAX_ANCHO = 1920;/.test(filmar), 'y la captura, el mismo número');
    });

    t.test('antes de grabar se comprueba que el codificador acepte la fuente', () => {
        t.ok(/async function aguanta\(/.test(filmar), 'la prueba existe');
        t.ok(/grabador\.onerror = \(\) => \{ roto = true; \};/.test(filmar),
            'y lo que mira es el error, no si llegaron datos');
        t.ok(/formatoQueAguanta\(stream, false, 'pantalla'\)/.test(filmar),
            'la pantalla se comprueba al elegirla, con la persona todavía sin grabar');
        // Y por eso la comprobación vive en `pedirPantalla`: así la ventana
        // nueva de un cambio a mitad de grabación se prueba igual que la
        // primera, que es cuando más importa —si el codificador la rechaza, la
        // de antes todavía está grabando y no se pierde nada.
        const pedir = filmar.slice(filmar.indexOf('async function pedirPantalla'));
        t.ok(pedir.indexOf('formatoQueAguanta(stream') !== -1
            && pedir.indexOf('formatoQueAguanta(stream') < pedir.indexOf('\nfunction quedarse'),
            'y está en el camino que usan las dos, elegir y cambiar');
        t.ok(/const PRUEBA_MS = 200;/.test(filmar), 'con el margen medido');
    });

    t.test('un grabador que se rompe a mitad llega a la pantalla', () => {
        const semanal = laPantalla();
        t.ok(/if \(a\.tipo === 'roto'\) seRompio\(a\);/.test(semanal),
            'el aviso de la ventana se atiende');
        t.ok(/if \(aviso && aviso\.tipo === 'roto'\) seRompio\(aviso\);/.test(semanal),
            'y el del proceso principal también');
        t.ok(/function seRompio[\s\S]{0,400}estado\.avisos\.push/.test(semanal),
            'se apunta, no solo se avisa: el cartel flotante se pierde');
        t.ok(/estado\.avisos\.length \? `<ul/.test(semanal), 'y se pinta en la tarjeta');
    });

    t.test('la cámara se acota como la pantalla, y por lo mismo', () => {
        // `ojo.js` le pide a la cámara lo más grande que tenga porque de ahí
        // saca las fotos de referencia de una clase; acá eso no se usa, y una
        // OBSBOT entra a 2560×1440 para terminar en un cuadrado de 360.
        t.ok(/await acotar\(camara\.getVideoTracks\(\)\[0\]\);/.test(filmar),
            'la pista de la cámara pasa por el mismo tope');
    });

    t.group('modo semanal · el pulso de las fuentes');

    t.test('se le toma el pulso a las pistas mientras se graba', () => {
        // Medido: con un grabador andando, hacerle `stop()` a la pista de vídeo
        // no dispara ni `onerror` ni `onended`. Mirar la pista es lo único que
        // queda, y de ahí sale este reloj.
        t.ok(/const PULSO_MS = 2000;/.test(filmar), 'cada dos segundos');
        t.ok(/estado\.pulso = setInterval\(tomarElPulso, PULSO_MS\);/.test(filmar),
            'y arranca con los grabadores');
        t.ok(/p\.readyState === 'ended'/.test(filmar), 'una pista apagada se ve');
        t.ok(/pistas\.find\(p => p\.muted\)/.test(filmar), 'y una sin imagen también');
    });

    t.test('un grabador que no entrega nada se da por muerto, pero sin apuro', () => {
        // El MP4 de Chromium entrega a tirones: medido, una pantalla casi
        // quieta tardó 35 s en soltar su primer pedazo. Un tope corto acá
        // llenaría la tarjeta de avisos falsos.
        t.ok(/const SIN_NADA_MS = \{ camara: 15000, pantalla: 45000 \};/.test(filmar),
            'un margen por fuente: la cara entrega en 4 s, la pantalla quieta tardó 35');
        t.ok(/!salud\.bytes && Date\.now\(\) - salud\.desdeMs > tope/.test(filmar),
            'y lo que se mira es que no haya llegado NADA, no que tarde');
    });

    t.test('con el micrófono adentro, solo valen formatos que declaren audio', () => {
        // `video/mp4;codecs=avc1` era candidato con audio, y si el primero no
        // pasaba la prueba del codificador la voz se iba en silencio.
        t.ok(/return FORMATOS\.filter\(t => \/mp4a\|opus\/\.test\(t\)\)/.test(filmar),
            'la lista con audio se queda solo con los que lo declaran');
    });

    t.test('se avisa una vez por fuente, y queda anotado en el diario', () => {
        t.ok(/if \(!salud \|\| salud\.avisado\) continue;/.test(filmar),
            'el segundo cartel no le sirve a quien está hablando a cámara');
        t.ok(/window\.nt\.anotar\('semanal\.fuente-caida'/.test(filmar),
            'el diario se queda con el motivo');
        t.ok(/estado\.alAviso\(\{ tipo: 'roto', cual, error \}\)/.test(filmar),
            'y entra por el mismo camino que un grabador roto, que ya se pinta');
    });

    t.test('con qué entra cada fuente queda anotado antes del primer fotograma', () => {
        // La vez que la cámara terminó en cero bytes no hubo forma de saber a
        // qué tamaño estaba grabando, que era justo la primera pregunta.
        t.ok(/window\.nt\.anotar\('semanal\.fuente', \{/.test(filmar), 'se anota');
        t.ok(/ancho: puesta\.width \|\| null/.test(filmar), 'con el tamaño de verdad');
        t.ok(/estado\.salud\.set\(l\.cual, \{ bytes: 0/.test(filmar),
            'y desde ahí se cuentan los bytes que llegan');
    });

    t.test('al parar se apaga el pulso', () => {
        t.ok(/if \(estado\.pulso\) \{ clearInterval\(estado\.pulso\); estado\.pulso = null; \}/
            .test(filmar), 'un reloj suelto avisaría de fuentes que ya nadie graba');
    });

    t.group('modo semanal · elegir la vista');

    t.test('cada vista lleva el color del marcador que va a tener en Premiere', () => {
        const semanal = laPantalla();
        t.ok(/import \{ estiloDeVista \} from '\.\/colores\.js';/.test(semanal),
            'el color sale del mismo sitio que en una clase');
        t.ok(/window\.nt\.grabarVistas\(\)\.then/.test(semanal),
            'y los colores los sabe el motor, no esta pantalla');
        t.ok(/style="\$\{estiloDeVista\(estado\.vistas, v\.nombre\)\}"/.test(semanal),
            'cada botón se pinta con el suyo');
    });

    t.test('los dos botones llevan su tecla escrita, y la tecla sale del nombre', () => {
        const semanal = laPantalla();
        t.ok(/const teclaDe = vista => vista\.nombre\[0\];/.test(semanal),
            'R y P salen de «R» y «PV»: una tabla aparte se desincronizaría');
        t.ok(/<kbd>\$\{esc\(teclaDe\(v\)\)\}<\/kbd>/.test(semanal), 'y están escritas en el botón');
        t.ok(/Tecla: \$\{esc\(teclaDe\(v\)\)\}/.test(semanal), 'también en el title');
    });

    t.test('las teclas solo valen donde la elección significa algo', () => {
        const semanal = laPantalla();
        t.ok(/const puedeVista = \(\) => estado\.paso === 'listo' \|\| estado\.paso === 'grabando';/.test(semanal)
            && /if \(!puedeVista\(\)\) return;/.test(semanal),
            'en la revisión cada toma tiene la suya y una tecla sola no sabría a cuál');
        t.ok(/foco\.matches\('input, textarea, select, \[contenteditable="true"\]'\)/.test(semanal),
            'donde se escribe, una «p» es una letra');
        t.ok(/document\.querySelector\('\.telon\.es-activa'\)/.test(semanal),
            'y con Ajustes encima el teclado es de Ajustes');
        t.ok(/if \(e\.repeat \|\| e\.isComposing \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return;/
            .test(semanal), 'ni repetida ni con modificadores');
    });

    t.test('el grupo de vistas no usa el estado gris de `.estados-toma`', () => {
        // `.estados-toma .btn[aria-pressed=true]` gana por especificidad y pinta
        // de gris, o sea que taparía justo el color que se quiere mostrar.
        const semanal = laPantalla();
        const css = leer('src', 'css', 'style.css');
        t.ok(/class="semanal-vistas"/.test(semanal), 'el grupo tiene su propia clase');
        t.ok(!/class="estados-toma"/.test(semanal), 'y no la que pinta de gris');
        t.ok(/\.semanal-vistas \{/.test(css), 'con su CSS');
        t.ok(/\.btn-vista\.es-elegida kbd \{/.test(css),
            'y la tecla se tiñe para leerse sobre el color');
    });

    t.group('modo semanal · las fichas de cada toma');

    // La ficha es la MISMA en las dos pantallas, y eso es lo que estas pruebas
    // cuidan: no que el HTML diga tal cosa, sino que no haya dos.
    t.test('la ficha de una toma la dibuja un solo módulo, usado por las dos pantallas', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        const semanal = laPantalla();
        for (const [cual, src] of [['la clase', vivo], ['el semanal', semanal]]) {
            t.ok(/import \* as fichas from '\.\/grabar\/lista-tomas\.js';/.test(src),
                `${cual} importa el módulo`);
            t.ok(/fichas\.(ficha|lista)\(/.test(src), `${cual} lo usa`);
        }
        const lista = leer('src', 'js', 'grabar', 'lista-tomas.js');
        t.ok(/class="bloque-toma/.test(lista), 'y la caja se escribe ahí');
        t.ok(!/class="bloque-toma/.test(vivo) && !/class="bloque-toma/.test(semanal),
            'y en ningún otro sitio');
    });

    t.test('una ficha abierta trae el texto con sus dos bordes', () => {
        const semanal = laPantalla();
        t.ok(/data-texto="cerrada" data-toma="\$\{t\.id\}"/.test(semanal),
            'el hueco del texto de esa toma');
        t.ok(/pista-in">IN<[\s\S]{0,120}pista-out">OUT</.test(semanal),
            'con el IN y el OUT dichos');
        t.ok(/ponerBorde\(cual, toma && toma\.id, borde, ms\)/.test(semanal),
            'y soltarlos va por `ponerBorde`, igual que el clic derecho');
        t.ok(/return cambiarFicha\(tomaId, \{ tipo: 'borde', borde, paredMs: ms \}\)/.test(semanal),
            'que para una toma cerrada mueve el borde por la puerta que toque');
    });

    t.test('la ficha del semanal no trae nada del XML', () => {
        // Ni nota, ni comentarios, ni claquetas: no hay nadie editando después.
        const semanal = laPantalla();
        t.ok(!/data-campo="nota"/.test(semanal), 'sin nota de toma');
        t.ok(!/data-hace="guardar-comentario"/.test(semanal), 'sin comentarios');
        t.ok(!/data-hace="plegar-claqueta"/.test(semanal), 'sin claquetas');
    });

    t.test('la toma abierta se arregla arriba y no en su ficha', () => {
        // Dos textos movibles de la misma toma serían dos líneas de IN que se
        // pisan, así que la ficha de la abierta manda arriba. Igual que en clase.
        const semanal = laPantalla();
        t.ok(/if \(t\.outMs == null\) \{\n\s+return '<p class="v3">Es la toma de ahora/.test(semanal));
    });

    t.group('modo semanal · el idioma');

    t.test('la sesión semanal arranca con el idioma de su modo', () => {
        // Y no con el de la clase: son dos ajustes porque son dos preguntas
        // distintas, y este viene en `auto` de fábrica.
        const semanal = laPantalla();
        t.ok(/idioma: \(app\.ajustes\.semanal && app\.ajustes\.semanal\.idioma\) \|\| 'auto'/
            .test(semanal));
    });

    t.test('el selector de Ajustes guarda en el idioma del modo', () => {
        const app = leer('src', 'js', 'app.js');
        t.ok(/app\.ajustes\.modo === 'semanal'\n\s+\? \{ semanal: \{ idioma: e\.target\.value \} \}\n\s+: \{ idioma: e\.target\.value \}/
            .test(app), 'al de los vídeos en un modo y al de la clase en el otro');
        t.ok(!/for \(const campo of \['#aj-fps', '#aj-idioma'/.test(app),
            'y ya no se apaga en el modo semanal: ahí es el único de abajo que vale');
        t.ok(/'Idioma de tus vídeos' : 'Idioma de la clase'/.test(app),
            'con el rótulo de lo que se está por grabar');
    });

    t.group('modo semanal · verlo y ajustarlo');

    t.test('el vídeo cortado se ve en la misma pantalla', () => {
        const semanal = laPantalla();
        const hecho = semanal.slice(semanal.indexOf('function tarjetaHecho'),
            semanal.indexOf('const megas ='));
        t.ok(/<video class="semanal-visor" controls/.test(hecho), 'con sus controles');
        t.ok(/urlDeArchivo\(r\.ruta\)\)}#t=0\.5/.test(hecho),
            'y empezado medio segundo adentro: así muestra un fotograma en vez de negro');
    });

    t.test('la dirección del archivo se resuelve contra la página', () => {
        // Y no pegando «file://» delante: la ventana se carga con `loadFile`, o
        // sea que su propia dirección ya es un `file:`, y resolver contra ella
        // además escapa los espacios y los acentos de una carpeta de Descargas.
        // Medido en la app: carga y busca sin que la CSP se queje.
        const semanal = laPantalla();
        t.ok(/new URL\(String\(ruta \|\| ''\), location\.href\)\.href/.test(semanal));
        t.ok(!/['"]file:\/\//.test(semanal), 'sin «file://» a mano en ninguna parte');
    });

    t.test('y se puede volver a la revisión y cortar de nuevo', () => {
        const semanal = laPantalla();
        t.ok(/data-hace="ajustar"/.test(semanal), 'hay botón');
        t.ok(/function ajustar\(\) \{\n\s+estado\.paso = 'revisar';/.test(semanal),
            'que lleva a la revisión que ya estaba, sin releer el disco');
        t.ok(/estado\.cortes = \(estado\.cortes \|\| 0\) \+ 1;/.test(semanal),
            'y se cuenta, porque el MP4 de antes no se pisa y hay que decirlo');
    });

    t.test('el visor no tapa los botones', () => {
        // Un 16:9 a lo ancho de la tarjeta deja «Ajustar» fuera de la pantalla,
        // que es justamente lo que hay que poder apretar después de mirarlo.
        const css = leer('src', 'css', 'style.css');
        const visor = css.slice(css.indexOf('.semanal-visor'), css.indexOf('.semanal-visor') + 400);
        t.ok(/width: min\(100%, calc\(\d+vh \* 16 \/ 9\)\)/.test(visor), 'el alto manda');
        t.ok(/aspect-ratio: 16 \/ 9/.test(visor), 'con la forma del archivo');
    });

    t.group('modo semanal · el borde a mano');

    t.test('Enter abre y cierra la toma, sin esperar a la voz', () => {
        // Medido sobre la primera grabación de verdad: desde que se termina de
        // decir «1» hasta que la toma abre pasan unos 3 s, y quien graba su
        // vídeo se queda esperando en silencio. En ese audio el «3, 2, 1» está
        // dicho a los 4,8 s y repetido a los 13,5 s.
        const semanal = laPantalla();
        t.ok(/if \(e\.key === 'Enter'\) \{[\s\S]{0,160}return bordeDeToma\(\);/.test(semanal),
            'la tecla llama al borde');
        t.ok(/const puedeBorde = \(\) => estado\.paso === 'grabando';/.test(semanal)
            && /if \(!puedeBorde\(\)\) return;/.test(semanal),
            'y solo grabando: sin sesión no hay borde que poner');
        t.ok(/data-hace="borde"/.test(semanal), 'y también hay botón, con su tecla escrita');
    });

    t.test('abrir y cerrar son el mismo botón, y no se pisan entre sí', () => {
        const semanal = laPantalla();
        t.ok(/\? await window\.nt\.grabarCerrarToma\(\)\n\s+: await window\.nt\.grabarAbrirToma\(\)/
            .test(semanal), 'cierra si hay una abierta y abre si no');
        t.ok(/const previo = bordeEnVuelo;\n\s+if \(previo\) await previo\.catch/.test(semanal),
            'dos Enter seguidos se encolan: con el mismo estado, el segundo se perdía');
        t.ok(/await ponerLaVista\(r\)/.test(semanal),
            'y la toma abierta a mano se lleva la vista que ya estaba elegida');
    });

    t.test('grabando, la toma es el cuadrado de la derecha y Terminar va aparte, en la esquina', async () => {
        // Lo pidió el editor: Terminar arriba a la derecha, ancho y rojo, para
        // que se vea que está ahí. Lo que no puede pasar es que se confunda con
        // el borde de la toma, que es lo que se aprieta sin mirar: van en
        // sitios distintos y con formas distintas.
        const tarjetas = await cargarTarjetas();
        const base = { paso: 'grabando', vista: 'R', vistas: [], avisos: [], pantalla: null };
        for (const tomas of [[], [{ id: 2, vista: 'R', inMs: 1000, outMs: null, palabras: [] }]]) {
            const html = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas, sueltas: [] } });
            const arriba = html.slice(html.indexOf('semanal-arriba'), html.indexOf('semanal-preview'));
            const controles = html.slice(html.indexOf('semanal-controles'), html.indexOf('data-texto'));
            t.ok(/class="btn btn-terminar" type="button" data-hace="terminar"/.test(arriba),
                'Terminar, arriba con deshacer y rehacer');
            t.ok(/class="btn btn-toma" type="button" data-hace="borde"/.test(controles),
                'y la toma en la rejilla, donde estaba Grabar');
            t.ok(!html.includes('btn-primario'), 'sin el azul de siempre: cada una tiene el suyo');
        }
    });

    t.test('grabando, en el orden que se pidió', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaGrabando({
            paso: 'grabando', vista: 'R', vistas: [], avisos: [],
            pantalla: { nombre: 'Keynote', ancho: 1920, alto: 1080 },
            micro: { nombre: 'DJI MIC MINI' }, sesion: { tomas: [], sueltas: [] }
        });
        const orden = ['semanal-pastilla', 'data-hace="deshacer"', 'data-hace="terminar"',
            'class="semanal-escena"', 'semanal-micro-vivo', 'Lo que digas ahora',
            'data-vista="PV"', 'data-vista="R"', 'data-hace="cambiar-pantalla"', 'data-hace="mirilla"',
            'data-hace="borde"', 'data-texto="espera"'];
        const donde = orden.map(x => html.indexOf(x));
        t.ok(donde.every(i => i >= 0), `están todos (${orden.filter((x, i) => donde[i] < 0).join(', ')})`);
        t.deep(donde.slice().sort((a, b) => a - b), donde, orden.join(' → '));
        t.ok(/DJI MIC MINI/.test(html.slice(html.indexOf('semanal-micro-vivo'))), 'el micrófono, con su nombre');
        t.ok(/>Professor</.test(html) && />Screen</.test(html), 'las vistas, con los nombres que pidió');
    });

    t.test('el orden de los botones no cambia cuál se usa sin saber', async () => {
        // Professor va primero porque así se pidieron los botones, pero una
        // vista que no se conoce —un sidecar viejo, un nombre roto— se lee como
        // Screen, que es para lo que existe el modo. Antes el respaldo era «la
        // primera de la lista», y reordenarla lo habría cambiado sin avisar.
        const tarjetas = await cargarTarjetas();
        t.eq(tarjetas.VISTAS[0].nombre, 'PV', 'Professor primero');
        t.eq(tarjetas.laVista('XX').nombre, 'R');
        t.eq(tarjetas.laVista(undefined).nombre, 'R');
        t.eq(tarjetas.laVista('PV').titulo, 'Professor');
    });

    t.test('con la toma abierta se dice en rojo, aunque la pastilla diga otra cosa', async () => {
        // El rojo cuelga de `data-toma` y no del estado de la pastilla: con el
        // ciclo atrasado la pastilla dice el atraso, y la toma sale igual.
        const tarjetas = await cargarTarjetas();
        const base = { paso: 'grabando', vista: 'R', vistas: [], avisos: [], pantalla: null };
        const abierta = { id: 4, vista: 'R', inMs: 1000, outMs: null, palabras: [] };
        const con = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [abierta], sueltas: [], atrasoSec: 31 } });
        t.ok(/data-toma="abierta"/.test(con), 'la tarjeta lo dice');
        t.ok(/data-abierta="si"/.test(con) && /Cerrar toma/.test(con), 'y el cuadrado la cierra');
        t.ok(/Toma 4 · esto sale en el vídeo/.test(con), 'y el preview lo dice encima');
        const sin = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [], sueltas: [] } });
        t.ok(/data-toma="no"/.test(sin) && /data-abierta="no"/.test(sin) && /Abrir toma/.test(sin));
        const css = leer('src', 'css', 'style.css');
        t.ok(/\.semanal-grabando\[data-toma='abierta'\] \.semanal-escena \{\s*outline: 3px solid #e5484d;/.test(css),
            'el marco del preview en rojo');
    });

    t.test('la caja de la toma abierta no dibuja la pared de la toma anterior', async () => {
        // Iba un `inMs` suelto donde `texto-toma` espera `{toma, ms, color}`, y
        // la pastilla salía diciendo «fin de la toma undefined». Se vio en el
        // MP4 de alguien grabándose: el fallo se exportó dentro del vídeo.
        //
        // Y acá esa marca no tiene trabajo: es la pared que frena el IN contra
        // la toma de antes, y este modo no enseña nada de antes del IN.
        const semanal = laPantalla();
        const caja = semanal.slice(semanal.indexOf("if (cual === 'abierta')"),
            semanal.indexOf("if (cual === 'cerrada'"));
        t.ok(/antes: \[\]/.test(caja), 'sigue sin enseñar lo de antes del IN');
        t.ok(!/limite:/.test(caja), 'así que no se le pasa ningún límite');

        // Y que no sea una casualidad del texto: con un número, el módulo de
        // verdad escribe el «undefined» que se vio.
        dom.fingir();
        const texto = await import(
            pathToFileURL(path.join(RAIZ, 'src', 'js', 'grabar', 'texto-toma.js')).href);
        const conNumero = texto.textoDe({ modo: 'abierta', antes: [], limite: 123456,
            palabras: [], vacio: 'x' }, () => {});
        t.ok(/undefined/.test(conNumero.textContent),
            'un número ahí escribe «undefined»: por eso no va ninguno');
        const sinNada = texto.textoDe({ modo: 'abierta', antes: [], palabras: [], vacio: 'x' },
            () => {});
        t.ok(!/undefined/.test(sinNada.textContent), 'y sin él, no');
    });

    t.group('modo semanal · la escena en vivo');

    t.test('el recuadro de la vista previa cae donde va a caer el de verdad', () => {
        // Son dos sitios diciendo el mismo número —el CSS no puede leer un
        // módulo de Node— así que lo que se compara es la cuenta. Si el
        // exportador mueve la cámara y el CSS no, la vista previa pasaría a
        // prometer un encuadre que el vídeo no tiene.
        const css = leer('src', 'css', 'style.css');
        const escena = css.slice(css.indexOf('.semanal-escena-esquina'));
        const tanto = (valor, sobre) => `${Math.round((valor / sobre) * 1000) / 10}`;

        // Los márgenes se comparan por el principio del número, que es lo que
        // el CSS trunca; el lado y el radio dan redondo y se comparan enteros.
        const justo = (valor, sobre) => `${+((valor / sobre) * 100).toFixed(4)}`;

        t.eq(justo(exportar.CAMARA_LADO, exportar.ANCHO), '18.75', 'el lado del recuadro');
        t.ok(new RegExp(`width: ${justo(exportar.CAMARA_LADO, exportar.ANCHO)}%`).test(escena),
            'y el CSS dice lo mismo');
        t.ok(/aspect-ratio: 1 \/ 1/.test(escena), 'cuadrado, como el `crop` del exportador');
        t.ok(/object-fit: cover/.test(escena), 'y recortando al centro, no deformando');
        t.ok(new RegExp(`border-radius: ${justo(exportar.CAMARA_REDONDEO, exportar.CAMARA_LADO)}%`)
            .test(escena), `las esquinas: ${exportar.CAMARA_REDONDEO} de ${exportar.CAMARA_LADO}`);
        t.ok(new RegExp(`right: ${tanto(exportar.MARGEN, exportar.ANCHO)}%`).test(escena),
            `el margen de la derecha: ${exportar.MARGEN} de ${exportar.ANCHO}`);
        t.ok(new RegExp(`bottom: ${tanto(exportar.MARGEN, exportar.ALTO)}`).test(escena),
            `y el de abajo: ${exportar.MARGEN} de ${exportar.ALTO}`);
    });

    t.test('la escena encuadra cada fuente como la encuadra el exportador', () => {
        const css = leer('src', 'css', 'style.css');
        t.ok(/\.semanal-escena-fondo \{[^}]*object-fit: contain/.test(css),
            'la pantalla entra entera, como el `pad`');
        t.ok(/\.semanal-escena-llena \{[^}]*object-fit: cover/.test(css),
            'y la cámara sola llena recortando, como el `crop`');
    });

    t.test('la escena sigue a la vista de la toma que se está grabando', async () => {
        // Dibujando de verdad, porque lo que importa no es cómo está escrito
        // sino qué se ve: con una toma abierta manda SU vista —aunque entre
        // tanto se haya elegido otra para la siguiente— y entre tomas manda la
        // elegida. Y sin pantalla la cámara llena el cuadro, igual que decide
        // `repartir` en el corte.
        const tarjetas = await cargarTarjetas();
        const base = {
            paso: 'grabando', vista: 'PV', vistas: [], avisos: [],
            pantalla: { nombre: 'Pantalla', ancho: 1920, alto: 1080 }
        };
        const abierta = { id: 1, vista: 'R', inMs: 1000, outMs: null, palabras: [] };

        const conToma = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [abierta], sueltas: [] } });
        t.ok(conToma.includes('semanal-escena-fondo'),
            'con la toma abierta en R se ve la pantalla de fondo');

        const entreTomas = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [], sueltas: [] } });
        t.ok(entreTomas.includes('semanal-escena-llena'),
            'y entre tomas manda la elegida, que es PV: la cámara sola');

        const sinPantalla = tarjetas.tarjetaGrabando({
            ...base, vista: 'R', pantalla: null, sesion: { tomas: [], sueltas: [] }
        });
        t.ok(sinPantalla.includes('semanal-escena-llena'),
            'y sin pantalla la cámara llena el cuadro aunque la vista sea R');
    });

    t.test('mientras se graba se puede cambiar de ventana, y se dice cuál es', async () => {
        const tarjetas = await cargarTarjetas();
        const base = {
            paso: 'grabando', vista: 'R', vistas: [], avisos: [],
            pantalla: { nombre: 'Keynote', ancho: 1920, alto: 1080 }
        };
        const html = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [], sueltas: [] } });
        t.ok(html.includes('data-hace="cambiar-pantalla"'), 'hay por dónde cambiar');
        t.ok(html.includes('Cambiar ventana · Keynote'),
            'y el botón dice qué se está grabando, que si no no se sabe');

        const sin = tarjetas.tarjetaGrabando({ ...base, pantalla: null, sesion: { tomas: [], sueltas: [] } });
        t.ok(sin.includes('data-hace="cambiar-pantalla"'),
            'y si se empezó sin pantalla, el mismo botón la suma a mitad de camino');
        t.ok(sin.includes('Elegir pantalla para grabar') && sin.includes('data-elegida="no"'),
            'en el morado lleno de lo que falta, como antes de grabar');
    });

    t.test('con una toma abierta, el aviso dice lo que va a costar el cambio', async () => {
        // La decisión fue dejar cambiar igual, pero avisando en el momento: un
        // cambio dentro de una toma la parte entre dos archivos y el corte la
        // resuelve con la cámara. Decirlo acá es lo que hace que la persona
        // pueda cerrar la toma antes y no pagarlo.
        const tarjetas = await cargarTarjetas();
        const base = {
            paso: 'grabando', vista: 'R', vistas: [], avisos: [],
            pantalla: { nombre: 'Keynote', ancho: 1920, alto: 1080 }
        };
        const abierta = { id: 7, vista: 'R', inMs: 1000, outMs: null, palabras: [] };
        const con = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [abierta], sueltas: [] } });
        t.ok(/toma 7[\s\S]{0,180}saldría con tu cámara/.test(con), 'nombra la toma y lo que pasaría');
        t.ok(con.includes('data-hace="cambiar-pantalla"'), 'pero el botón sigue ahí: avisa, no prohíbe');

        const sin = tarjetas.tarjetaGrabando({ ...base, sesion: { tomas: [], sueltas: [] } });
        t.ok(!/saldría con tu cámara/.test(sin), 'y entre tomas no avisa de nada, porque no cuesta nada');
    });

    t.group('modo semanal · volver a lo último que se grabó');

    /** Lo mínimo que `tarjetaListo` necesita para dibujarse. */
    const paraEmpezar = extra => ({
        audio: { abierto: true, pico: 0, error: null },
        camara: { id: 'c', nombre: 'Cámara' }, camaras: [], entradas: [], micro: null,
        pantalla: { nombre: 'Pantalla 1', ancho: 1920, alto: 1080 },
        vistas: [], avisos: [], ultima: null, ...extra
    });

    const grabadaAyer = {
        json: '/x/Grabación-2026-10-04_19-29-01/xml/Datos/semana_notas-en-vivo.json',
        nombre: 'semana_2026-10-04_19-29-01',
        cuandoMs: new Date('2026-10-04T19:29:01').getTime(),
        tomas: 4, segundos: 162
    };

    t.test('la pantalla de inicio ofrece seguir con la de antes', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar({ ultima: grabadaAyer }));
        t.ok(html.includes('data-hace="abrir-ultima"'), 'hay por dónde volver a ella');
        t.ok(html.includes('4 tomas'), 'y dice qué es, para reconocerla');
        t.ok(html.indexOf('abrir-ultima') < html.indexOf('data-hace="grabar"'),
            'va arriba de Grabar: al abrir la app lo normal es terminar el de ayer');
    });

    t.test('el primer día no hay nada que ofrecer, y no se finge', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar());
        t.ok(!html.includes('abrir-ultima'), 'sin grabación previa no hay tarjeta');
        t.ok(!html.includes('Lo último que grabaste'), 'ni el título solo');
        t.ok(html.includes('data-hace="grabar"'), 'pero se puede grabar igual');
    });

    t.test('una sola toma se dice en singular', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar({
            ultima: { ...grabadaAyer, tomas: 1 }
        }));
        t.ok(html.includes('1 toma<') || html.includes('1 toma '), 'no «1 tomas»');
        t.ok(!html.includes('1 tomas'));
    });

    t.test('si no se puede leer el disco, se puede grabar igual', () => {
        // Que no se lea lo de antes no es razón para no poder grabar lo de hoy:
        // la carpeta puede estar en un disco desconectado y la app se abre.
        const s = leer('src', 'js', 'pantalla-semanal.js');
        const cuerpo = s.slice(s.indexOf('async function buscarLaUltima()'));
        t.ok(/^[\s\S]*?catch \(err\) \{\s*estado\.ultima = null;/.test(cuerpo),
            'el fallo deja la pantalla sin tarjeta, no sin pantalla');
        t.ok(/if \(hace === 'abrir-ultima'\) return abrirLaUltima\(boton\);/.test(s),
            'y el botón está conectado');
    });

    t.test('las dos puertas al editor son la misma', () => {
        // Terminar de grabar y abrir la de ayer llevan al mismo sitio: una
        // grabación recién cerrada y una de anteayer no se distinguen en nada
        // una vez escritas. Tenerlo dos veces quería decir que la de ayer se
        // iba a abrir un poco distinto que la de hace un minuto.
        const s = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/async function irAlEditor\(json\)/.test(s), 'hay una sola entrada');
        t.eq((s.match(/await irAlEditor\(/g) || []).length, 2,
            'y la usan los dos caminos');
        t.ok(/estado\.paso = 'revisar';/.test(s), 'que dejan la pantalla en revisar');
    });

    t.test('«Ver lo que se grabó» abre la carpeta de ESA grabación', () => {
        // Al reabrir una de ayer no hay cierre que diga dónde están los brutos,
        // y el respaldo de `dondeEstanLosBrutos` es la carpeta elegida, que
        // ahora es la madre de todas las grabaciones. Sin esto el Finder abría
        // un nivel más arriba y había que buscar cuál de todas era.
        const s = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/if \(!estado\.brutos\.length\) \{[\s\S]{0,400}estado\.brutos = \[m\.archivos\.camara/
            .test(s), 'los saca del montaje, que leyó el disco');
        t.ok(/\.\.\.\(m\.archivos\.pantallas \|\| \[m\.archivos\.pantalla\]\)/.test(s),
            'y entran todos los tramos de pantalla, no solo el primero');
    });

    t.group('modo semanal · antes de grabar, un preview y los controles debajo');

    // Lo pidió el editor al ver que elegir pantalla corría Grabar hacia abajo:
    // arriba una sola vista, «Preview», y debajo cámara y micrófono, pantalla y
    // Profesor Preview, y Grabar al costado.

    t.test('un solo preview, sin las miniaturas sueltas de antes', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar());
        t.eq((html.match(/class="semanal-escena"/g) || []).length, 1, 'el vídeo, una vez');
        t.ok(/class="campo semanal-preview">\s*<span class="rotulo">Preview<\/span>/.test(html), 'con su nombre');
        t.ok(!html.includes('id="semanal-camara"') && !html.includes('id="semanal-pantalla"'),
            'ni la miniatura de la cámara ni la de la pantalla');
    });

    t.test('en el orden que se pidió', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar());
        const orden = ['semanal-preview', 'data-campo="camara"', 'data-campo="micro"',
            'data-hace="elegir-pantalla"', 'data-hace="mirilla"', 'data-hace="grabar"', 'Cómo se graba'];
        const donde = orden.map(x => html.indexOf(x));
        t.ok(donde.every(i => i >= 0), 'están todos');
        t.deep(donde.slice().sort((a, b) => a - b), donde, orden.join(' → '));
    });

    t.test('elegir pantalla no mueve nada: los controles son los mismos con y sin', async () => {
        // Lo que empujaba Grabar era una fila que aparecía al elegir pantalla.
        // Ahora cambian textos y atributos, y la forma es la misma.
        const tarjetas = await cargarTarjetas();
        const forma = html => html.slice(html.indexOf('semanal-controles'), html.indexOf('Cómo se graba'))
            .replace(/>[^<]*</g, '><')
            .replace(/\s(title|data-elegida|aria-pressed)="[^"]*"/g, '');
        t.eq(forma(tarjetas.tarjetaListo(paraEmpezar({ pantalla: null }))),
            forma(tarjetas.tarjetaListo(paraEmpezar())));
    });

    t.test('el botón de pantalla dice lo que falta, o cuál está', async () => {
        const tarjetas = await cargarTarjetas();
        const sin = tarjetas.tarjetaListo(paraEmpezar({ pantalla: null }));
        t.ok(sin.includes('Elegir pantalla para grabar') && sin.includes('data-elegida="no"'),
            'sin pantalla, morado lleno: es lo que falta');
        const con = tarjetas.tarjetaListo(paraEmpezar());
        t.ok(con.includes('Cambiar pantalla · Pantalla 1') && con.includes('data-elegida="si"'),
            'con una, dice cuál y baja a teñido');
    });

    t.test('Grabar es el rojo de la tarjeta, y no queda ningún otro primario', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar());
        t.ok(/class="btn btn-grabar" type="button" data-hace="grabar"/.test(html));
        t.ok(!html.includes('btn-primario'), 'una sola acción principal por pantalla');
    });

    t.test('sin micrófono se dice por qué, debajo del nivel, y Grabar no se puede apretar', async () => {
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaListo(paraEmpezar({
            audio: { abierto: false, pico: 0, error: 'No se pudo acceder al audio: Requested device not found' }
        }));
        const micro = html.slice(html.indexOf('semanal-micro'), html.indexOf('elegir-pantalla'));
        t.ok(micro.includes('Requested device not found'), 'en la columna del micrófono');
        t.ok(/data-hace="grabar" disabled/.test(html));
    });

    t.test('Profesor Preview se llama igual encendido y apagado', async () => {
        // Lo que dice si está puesta es el color, no otro nombre.
        const tarjetas = await cargarTarjetas();
        for (const puesta of [false, true]) {
            const b = tarjetas.verme(puesta);
            t.ok(b.includes('Profesor Preview'), `${puesta ? 'encendido' : 'apagado'}`);
            t.ok(b.includes(`aria-pressed="${puesta}"`));
        }
    });

    t.test('Grabar sin pantalla pregunta antes, y sin respuesta no graba', () => {
        // Grabar solo con la cámara vale, así que se pregunta y no se niega.
        const semanal = leer('src', 'js', 'pantalla-semanal.js');
        t.ok(/if \(hace === 'grabar'\) return pedirGrabar\(boton\);/.test(semanal), 'el botón pasa por la pregunta');
        const fn = semanal.slice(semanal.indexOf('async function pedirGrabar(boton) {'));
        const cuerpo = fn.slice(0, fn.indexOf('\n}'));
        t.ok(/if \(!estado\.pantalla\) \{/.test(cuerpo), 'solo sin pantalla');
        t.ok(/valor: 'elegir'/.test(cuerpo) && /valor: 'camara'/.test(cuerpo), 'elegirla o grabar solo con la cámara');
        t.ok(/if \(dicho === 'elegir'\) return elegirPantalla\(\);/.test(cuerpo), 'elegirla no arranca a grabar');
        t.ok(/if \(dicho !== 'camara'\) return undefined;/.test(cuerpo), 'y cancelar no hace nada');
        t.ok(/return grabar\(boton\);/.test(cuerpo));
    });

    t.group('modo semanal · revisar antes de cortar');

    const semanal = laPantalla();

    t.test('Terminar lleva a la revisión, y no a exportar', () => {
        t.ok(/estado\.paso = 'revisar';/.test(semanal), 'hay un paso de revisión');
        t.ok(!/async function terminar[\s\S]{0,2000}semanalExportar/.test(semanal),
            'y Terminar no llama al exportador');
        t.ok(/if \(hace === 'exportar'\) return exportar\(boton\);/.test(semanal),
            'exportar es un gesto aparte');
    });

    t.test('en la revisión, todo cambio va al sidecar, que es lo que el corte lee', () => {
        // Y grabando va a la sesión en memoria: son dos puertas, y la elige el
        // paso y no quien aprieta el botón.
        t.ok(/if \(estado\.paso !== 'revisar'\) \{\n\s+const r = await window\.nt\.grabarEditar\(/
            .test(semanal), 'grabando, por la puerta de la sesión viva');
        t.ok(/grabarEditarGrabada\(estado\.json, \{ \.\.\.cambio, toma: id \}\)/.test(semanal),
            'terminada, por la del sidecar');
    });

    t.group('modo semanal · el editor del corte final');

    t.test('el vídeo de arriba es un montaje, no el exportado', () => {
        // Es lo que cambia todo lo demás: si para ver el corte hubiera que
        // exportarlo, nadie cambiaría nada después del primer intento.
        t.ok(/import \* as montaje from '\.\/semanal\/montaje\.js';/.test(semanal));
        const editor = semanal.slice(semanal.indexOf('function tarjetaRevisar'),
            semanal.indexOf('function barraDelMontaje'));
        t.ok(/id="semanal-montaje"/.test(editor), 'con su hueco arriba');
        t.ok(!/semanal-visor/.test(editor), 'y sin el visor del archivo ya cortado');
    });

    t.test('el recuadro del montaje cae donde el del corte', () => {
        // Los números no se escriben acá: los manda el motor en partes del
        // ancho, sacados de las mismas constantes que usa el filtro de ffmpeg.
        const motor = leer('engine', 'exportar-video.js');
        t.ok(/lado: CAMARA_LADO \/ ANCHO/.test(motor));
        t.ok(/margen: MARGEN \/ ANCHO/.test(motor));
        t.ok(/redondeo: CAMARA_REDONDEO \/ CAMARA_LADO/.test(motor));
        const mod = leer('src', 'js', 'semanal', 'montaje.js');
        t.ok(/width:\$\{recuadro\.lado \* 100\}%/.test(mod), 'y la ventana los usa tal cual');
        t.ok(/border-radius:\$\{recuadro\.redondeo \* 100\}%/.test(mod));
    });

    t.test('el reproductor cambia de archivo a mitad de toma, sin perder el reloj', () => {
        // Una toma que cruza un cambio de ventana sale de dos archivos con un
        // negro en medio, y el reproductor tiene que seguirla igual. Lo que no
        // se puede romper es el reloj: un `src` nuevo pone el del elemento en
        // cero, así que si el de la toma saliera de ahí, cada cambio la haría
        // saltar al principio.
        const mod = leer('src', 'js', 'semanal', 'montaje.js');
        t.ok(/if \(t\.pantallaPartes && t\.camaraDesde != null\) return elCam;/.test(mod),
            'con pedazos manda la cámara, que no se parte nunca');
        t.ok(/function enSuArchivo\(t, v, dentro\)/.test(mod),
            'y la traducción entre el reloj de la toma y el del archivo está en un sitio');
        for (const quien of ['arranqueDe', 'juntarlos']) {
            t.ok(new RegExp(`function ${quien}\\([\\s\\S]{0,420}enSuArchivo\\(`).test(mod),
                `${quien} la usa en vez de hacer su propia cuenta`);
        }
    });

    t.test('en el relevo de un cambio de ventana no se sincroniza nada', () => {
        // El fondo no está en ningún archivo mientras dura el negro, así que
        // preguntar por su posición daba `NaN` y el `NaN` terminaba en
        // `playbackRate`. Lo destapó reproducir de corrido, no una prueba.
        const mod = leer('src', 'js', 'semanal', 'montaje.js');
        t.ok(/&& !enElNegro\(t\)\) juntarlos\(t, m\);/.test(mod), 'el tic lo saltea');
        t.ok(/pan\.pause\(\);/.test(mod),
            'y la pantalla se para: escondida y corriendo se iría más allá de su archivo');
    });

    t.test('abajo hay una sola toma: la que se está mirando', async () => {
        // Dibujando dos tomas y parándose en la segunda: abajo tiene que
        // aparecer esa y nada más. Una lista de todas era lo de la pantalla de
        // clase, y acá el editor es el vídeo arriba y la toma de abajo.
        const tarjetas = await cargarTarjetas();
        const html = tarjetas.tarjetaDeLaToma({ vistas: [] }, {
            id: 2, vista: 'R', fondo: 'pantalla', segundos: 4,
            palabras: [{ w: 'hola', t: 1000 }], antes: [], despues: []
        });
        t.ok(html.includes('data-toma="2"'), 'es la toma donde estoy parado');
        t.ok(!html.includes('data-toma="1"'), 'y no viene ninguna otra');
        t.ok(html.includes('data-texto='), 'con su texto para mover los bordes');
        t.eq((html.match(/data-hace="vista-ficha"/g) || []).length, 2,
            'y los dos botones de vista');
        t.ok(/data-vista="R"[^>]*aria-pressed="true"/s.test(html),
            'con la que SE VE marcada, no la que se pidió');
        t.ok(html.includes('data-hace="mantener"') && html.includes('data-hace="desactivar"'),
            'y los dos estados que se pueden desandar apretando el otro');
        t.ok(!html.includes('data-hace="descartar"'),
            'pero no Descartar: la sesión ya está cerrada y acá no hay ⌘Z que la devuelva');
    });

    t.test('el espacio reproduce y pausa, y solo en el editor', () => {
        t.ok(/if \(e\.key === ' ' && estado\.paso === 'revisar'\) \{[\s\S]{0,120}montaje\.alternar\(\)/
            .test(semanal));
    });

    t.test('al salir de la pantalla los dos vídeos se sueltan', () => {
        // Dos vídeos corriendo que nadie mira siguen sonando y leyendo del disco.
        t.ok(/montaje\.soltar\(\);\n\s+estado\.enVivo = null;\n\s+await fuente\.cerrar\(\);/
            .test(semanal), 'al irse del modo');
        t.ok(/async function exportar\(boton\) \{\n\s+boton\.disabled = true;[\s\S]{0,200}montaje\.pausar\(\);/
            .test(semanal), 'y callado mientras corre ffmpeg');
    });

    t.test('no se puede salir de la pantalla a mitad de nada', () => {
        t.ok(/\['grabando', 'mirando', 'revisar', 'cortando'\]\.includes\(estado\.paso\)/.test(semanal),
            'los cuatro pasos cuentan como «ocupado»');
    });

    t.test('la vista elegida en vivo solo toca las tomas nuevas', () => {
        t.ok(/if \(t\.id <= estado\.vistaHasta\) continue;/.test(semanal),
            'sin esto, elegir en la toma 5 reescribiría las cuatro anteriores');
    });

    t.test('«ver lo que se grabó» abre un archivo, no la carpeta del modo', () => {
        // `showItemInFolder` con una carpeta abre la de ARRIBA con esta
        // señalada, que es justo lo que no sirve cuando se buscan los vídeos.
        t.ok(/estado\.brutos = \(\(cierre && cierre\.videos\) \|\| \[\]\)/.test(semanal),
            'los archivos salen del cierre de la grabación');
        t.ok(/return estado\.brutos\[0\]/.test(semanal), 'y se revela uno de ellos');
    });
};
