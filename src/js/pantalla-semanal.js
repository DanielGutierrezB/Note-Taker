/**
 * pantalla-semanal.js — Grabarse explicando la semana, y salir con el vídeo.
 *
 * Es el modo simple, y simple quiere decir que no hay nada que decidir: se
 * aprieta Grabar, se habla abriendo cada toma con «3, 2, 1» y cerrándola con
 * «Pausa», se aprieta Terminar, y sale un MP4 con la pantalla de fondo y la
 * cámara en la esquina. Ni vistas, ni claquetas, ni XML, ni una lista de clases
 * que alguien tenga que entender.
 *
 * **Una pantalla con seis momentos y no seis pantallas.** Preparar, grabar,
 * mirar, elegir el corte, cortar y el vídeo listo son el mismo sitio cambiando
 * de tarjeta: así nadie se pierde, y volver atrás es siempre lo mismo —otro
 * vídeo— en vez de una navegación. Los seis están en una sola tabla, `MOMENTOS`.
 *
 * **Acá pasan cosas; lo que se VE está en `semanal/tarjetas.js`.** Cada momento
 * dibuja con una función pura de `estado` a HTML, y todas viven en ese otro
 * archivo y en `semanal/tarjetas-editor.js`, las de después de grabar. Este
 * tiene los gestos, los dispositivos, el reloj y lo que se le pide
 * al motor. Antes era todo junto y con el editor del corte final pasó de 484 a
 * 1.559 líneas: dejó de poderse abrir y entender de qué iba.
 *
 * **Y las decisiones del editor están en `semanal/corte.js`.** Qué toma sigue,
 * cuánto mide cada ficha, cuánto dura el montaje: no tocan el DOM, así que se
 * prueban llamándolas.
 *
 * **Lo que oye y lo que corta es el motor de siempre.** El micrófono viaja por
 * donde viaja en una clase, el «3, 2, 1» y la «Pausa» los reconoce el mismo
 * código, y los bordes los corre al silencio el mismo `ajustar-corte.js`. Este
 * archivo solo pone encima los dos vídeos y, al final, pide el corte. Si este
 * modo se borrara mañana, el de clase no se enteraría.
 */

import { $, esc, avisar, verVista } from './chrome.js';
import { icono } from './iconos.js';
import * as fmt from './formato.js';
import * as fuente from './grabar/fuente.js';
import * as ojo from './grabar/ojo.js';
import * as filmar from './grabar/filmar.js';
import * as texto from './grabar/texto-toma.js';
import * as alrededor from './grabar/alrededor-de-la-toma.js';
import * as fichas from './grabar/lista-tomas.js';
import * as montaje from './semanal/montaje.js';
import * as corte from './semanal/corte.js';
import * as tarjetas from './semanal/tarjetas.js';
import * as editor from './semanal/tarjetas-editor.js';
import * as alGrabar from './semanal/al-grabar.js';
import * as menuPalabra from './grabar/menu-de-palabra.js';
import * as rotuloBarra from './grabar/rotulo-barra.js';
import * as idiomas from './idiomas.js';
import * as historia from './grabar/historia.js';
import * as estadosToma from './grabar/estados-toma.js';
import * as estados from './estados.js';
import * as mirilla from './semanal/mirilla.js';
import { estiloDeVista } from './colores.js';

let app = null;

/**
 * En qué momento está la pantalla.
 *
 * `listo` es antes de grabar, `grabando` mientras, `cortando` mientras ffmpeg
 * trabaja y `hecho` con el vídeo en el disco. Nada más: cada uno dibuja una
 * tarjeta y tiene un solo botón que lleva al siguiente.
 */
const estado = {
    paso: 'listo',
    entradas: [],
    micro: null,
    camaras: [],
    camara: null,
    pantalla: null,          // { nombre, ancho, alto } de la pantalla elegida
    audio: { abierto: false, pico: 0, error: null },
    sesion: null,            // el estado que devuelve el motor mientras graba
    reloj: null,
    tomasAbiertas: 0,
    ficha: null,             // la toma desplegada abajo mientras graba, y la
                             // toma donde estoy parado en el editor del final
    vista: tarjetas.DE_ENTRADA, // la que va a llevar la toma siguiente
    vistaHasta: 0,           // hasta qué toma ya se le puso la vista elegida
    vistas: [],              // las del motor, con el color de su marcador
    json: null,              // el sidecar de lo que se acaba de grabar
    ultima: null,            // la última grabación que hay en la carpeta, para
                             // poder volver a ella al abrir la app
    buscada: null,            // la carpeta que se eligió a mano esta vez, si se
                              // eligió alguna. No es la de los ajustes
    encontradas: [],          // las grabaciones que había ahí, para elegir una
    montaje: null,           // dónde cae cada toma en los dos vídeos crudos
    enVivo: null,            // dónde va el montaje: { toma, montado, total, … }
    ocultarFuera: false,     // si la línea de tomas esconde las desactivadas
    grabada: null,           // las tomas con su texto, para mover los bordes
    brutos: [],              // los vídeos tal como se grabaron, para poder verlos
    corte: { pct: 0 },
    // Las dos opciones de la revisión, que se aplican al cortar. Encendidas de
    // fábrica: son lo que hay que hacerle a un vídeo para que se pueda ver, y
    // quien no las quiera las apaga y vuelve a cortar. Apagadas de fábrica
    // querían decir que el vídeo normal era el peor de los dos posibles.
    silencios: true,
    mejorarAudio: true,
    hecho: null,             // lo que devolvió el exportador
    mirilla: false,          // si está abierta la ventanita flotante de verse
    avisos: []
};

export function conectar(contexto) {
    app = contexto;
    // En la sección y no en el cuerpo: el rótulo del idioma vive en la fila del
    // título, fuera de la tarjeta que se rehace.
    $('#vista-semanal').addEventListener('click', alClic);
    $('#semanal-cuerpo').addEventListener('change', alCambio);
    $('#semanal-cuerpo').addEventListener('pointerdown', arrastrarPorLaLinea);
    document.addEventListener('keydown', alTeclado);
    // El clic derecho sobre UNA palabra pone ahí el IN o el OUT, igual que en
    // una clase y con el mismo módulo. Por `ponerBorde`, que es por donde entra
    // el arrastre: las dos maneras tienen que pedir lo mismo. Y parte la toma
    // por esa palabra, que es como se cambia de plano sin cortar lo que se
    // está diciendo: lo pidió el editor para el vídeo de la semana también.
    menuPalabra.conectar({
        raiz: '#vista-semanal',
        alCerrar: () => { if (pendiente) pintar(); },
        alElegir: q => ponerBorde(q.cual, q.toma, q.borde, q.ms),
        puedeDividir: true
    });
    // El color de cada vista es el del marcador que va a aparecer en Premiere, y
    // quien los sabe es el motor: así lo que se ve mientras se graba es lo mismo
    // que el editor va a ver después. No se espera: si tardan, los botones
    // aparecen sin color y el repintado siguiente los pinta.
    window.nt.grabarVistas().then(vistas => {
        estado.vistas = vistas || [];
        if (grabando() || estado.paso === 'listo') pintar();
    });
    window.nt.onSemanalAviso(aviso => {
        if (aviso && aviso.tipo === 'roto') seRompio(aviso);
        if (aviso && aviso.tipo === 'pantalla-soltada') dejarDePintarLaPantalla();
    });
    window.nt.onSemanalProgreso(p => {
        if (estado.paso !== 'cortando') return;
        estado.corte = p;
        pintar();
    });
    // Los tres botones de la mirilla entran por acá y van a parar a las MISMAS
    // funciones que sus botones de esta pantalla: apretar «PV» allá y apretarlo
    // acá tienen que ser el mismo gesto, no dos caminos que un día discrepan.
    // Con las mismas guardas que el teclado: el espejo puede ir un latido
    // atrasado, y una toma no se abre fuera de la grabación porque la
    // mirilla creyera que todavía se estaba grabando.
    window.nt.onMirillaGesto(g => {
        if (!g) return;
        if (g.hace === 'vista' && puedeVista()) cambiarVista(g.vista);
        if (g.hace === 'toma' && puedeBorde()) bordeDeToma();
    });
}

const nombreDe = cual => (cual === 'camara' ? 'la cámara' : 'la pantalla');

/**
 * Uno de los dos vídeos se rompió a mitad de grabación.
 *
 * Se apunta y se pinta, las dos cosas. El cartel flotante se puede perder
 * —quien graba está hablando, mirando a la cámara— así que lo que manda es el
 * renglón fijo en la tarjeta, que se queda hasta el final. Perder la pantalla
 * entera sin enterarse hasta que el vídeo no existe es exactamente lo que pasó
 * la primera vez que esto se usó de verdad.
 */
function seRompio(aviso) {
    const texto = `Se dejó de grabar ${nombreDe(aviso.cual)}: ${aviso.error}`;
    if (!estado.avisos.includes(texto)) estado.avisos.push(texto);
    avisar(texto, 'error');
    pintar();
}

/** Entrar al modo: se mira qué hay conectado y se espera. */
export async function ver() {
    verVista('vista-semanal');
    // Entrar a la pantalla con algo a medias no borra nada: es volver a mirar
    // lo que está pasando, no empezar de nuevo. Dejarla a propósito sí, y eso
    // es `alPanel`, que es la decisión y no el paso de vuelta.
    if (grabando()) { pintar(); return; }
    await alPanel();
}

/**
 * El panel de antes de grabar, limpio.
 *
 * Está aparte de `ver()` porque son dos cosas distintas que acababan en el
 * mismo sitio: entrar a la pantalla y abandonar lo que se estaba haciendo.
 * `ver()` se protege —con la revisión a medias no toca nada— y por eso no
 * servía para el botón de volver, que lo que quiere es justamente dejarla.
 */
async function alPanel() {
    montaje.soltar();
    estado.paso = 'listo';
    estado.hecho = null;
    estado.avisos = [];
    estado.montaje = null;
    estado.enVivo = null;
    estado.json = null;
    estado.brutos = [];
    estado.cortes = 0;
    estado.vistaHasta = 0;
    // La carpeta que se miró a mano no sobrevive al volver al panel: es de
    // «esta vez», y dejar la lista de ayer arriba de la de la carpeta de
    // siempre sería prometer que sigue mirando ahí.
    estado.buscada = null;
    estado.encontradas = [];
    if (estado.mirilla) laMirilla(false);
    pintar();
    // Las dos en paralelo: mirar qué micrófonos y cámaras hay tarda —hay que
    // abrir los elegidos para poder verlos— y leer el disco no tiene por qué
    // esperar a eso. La pantalla ya está pintada y cada una repinta al llegar.
    await Promise.all([
        mirarQueHay().then(pintar),
        buscarLaUltima().then(pintar)
    ]);
}

/**
 * La última grabación que hay en la carpeta, para poder volver a ella.
 *
 * Es lo primero que hace falta al abrir la app: lo normal no es grabar otro
 * vídeo sino terminar el de ayer —mirarlo, sacarle una toma, volver a
 * cortarlo—. Antes eso no tenía puerta: la pantalla arrancaba siempre en
 * «listo» y lo grabado solo se podía abrir desde el Finder, que es donde no
 * sirve de nada porque lo que hay ahí son cinco archivos y no un proyecto.
 *
 * Si falla, no pasa nada: se queda sin la tarjeta y se puede grabar igual. Que
 * no se pueda leer lo de antes no es razón para no poder grabar lo de hoy.
 */
async function buscarLaUltima() {
    estado.ultima = null;
    const casa = app.ajustes.semanal && app.ajustes.semanal.carpeta;
    if (!casa) return;
    try {
        // Vienen ordenadas, la última primero (`sesiones-grabadas.listar`).
        const lista = await window.nt.grabarListar([casa]);
        const ultima = (lista || [])[0];
        if (!ultima || !ultima.archivos || !ultima.archivos.json) return;
        estado.ultima = deLaLista(ultima);
    } catch (err) {
        estado.ultima = null;
    }
}

/**
 * Una sesión de `grabarListar` como la línea que esta pantalla dibuja.
 *
 * Es una sola función porque son la misma línea: la última de la carpeta de
 * siempre y las de una carpeta elegida a mano se leen igual, y dos lecturas
 * parecidas se habrían separado en cuanto una contara las tomas distinto.
 *
 * Las descartadas CUENTAN. `resumen.tomas` son las que iban en el vídeo, y la
 * línea tiene que decir qué se va a encontrar al abrirla: el editor las abre
 * todas, con las de fuera marcadas. Decir «2 tomas» y abrir tres es hacer dudar
 * de si es la grabación buena.
 */
function deLaLista(s) {
    const resumen = s.resumen || {};
    return {
        json: s.archivos.json,
        nombre: s.secuencia,
        cuandoMs: s.ceroMs || null,
        tomas: (resumen.tomas || 0) + (resumen.descartadas || 0),
        fuera: resumen.descartadas || 0,
        segundos: resumen.segundos || 0,
        carpeta: s.carpeta
    };
}

export async function salir() {
    if (estado.paso === 'grabando') return;          // grabando no se sale
    // La mirilla antes que la cámara: encima de todo y con la cámara abierta
    // por su cuenta, se quedaba flotando sobre la pantalla de la clase.
    if (estado.mirilla) await laMirilla(false);
    // El montaje primero: dos vídeos corriendo que nadie mira siguen sonando y
    // siguen leyendo del disco.
    montaje.soltar();
    estado.enVivo = null;
    await fuente.cerrar();
    await filmar.soltarPantalla();
    await ojo.soltar('semanal');
    estado.audio = { abierto: false, pico: 0, error: null };
}

/** Qué micrófonos y qué cámaras hay, y abrir los elegidos para poder verlos. */
async function mirarQueHay() {
    const entradas = await fuente.entradas();
    estado.entradas = entradas.lista || [];
    const camaras = await ojo.camaras();
    estado.camaras = camaras.lista || [];

    // Lo elegido la última vez si sigue conectado, y si no lo primero que haya:
    // en este modo nadie va a ir a Ajustes a elegir un micrófono.
    const guardado = app.ajustes.dispositivo;
    estado.micro = estado.entradas.find(e => e.nombre === guardado)
        || estado.entradas.find(e => e.tipo !== 'app')
        || null;
    const camaraGuardada = app.ajustes.camara;
    estado.camara = estado.camaras.find(c => c.nombre === camaraGuardada)
        || estado.camaras[0]
        || null;

    // El micrófono sí se espera: de él depende que el botón de Grabar se
    // encienda, porque sin oír no hay «3, 2, 1» y sin «3, 2, 1» no hay tomas.
    await abrirElMicro();
    // La cámara, en cambio, se abre por su cuenta y repinta cuando esté. Dar el
    // primer fotograma puede tardar —una cámara virtual tarda segundos— y la
    // pantalla no tiene por qué quedarse en blanco mientras: lo único que
    // aparece después es su vista previa.
    abrirLaCamara().then(() => pintar());
}

async function abrirElMicro() {
    if (!estado.micro) {
        estado.audio = { abierto: false, pico: 0, error: 'No encontré ningún micrófono.' };
        return;
    }
    const r = await fuente.abrir(estado.micro, {
        alNivel: pico => {
            // El medidor es lo único que dice «te estoy oyendo» antes de grabar.
            const barra = $('#semanal-nivel .nivel-barra');
            if (barra) barra.style.width = `${Math.round(Math.min(1, pico) * 100)}%`;
        },
        alCaerse: () => {
            estado.audio.abierto = false;
            pintar();
        }
    });
    estado.audio = r.ok
        ? { abierto: true, pico: 0, error: null }
        : { abierto: false, pico: 0, error: r.error };
    if (r.ok) app.ajustes = (await window.nt.ajustesGuardar({ dispositivo: estado.micro.nombre })).ajustes;
}

async function abrirLaCamara() {
    if (!estado.camara) return;
    const r = await ojo.tomar('semanal', estado.camara.nombre, {
        alCaerse: mensaje => { avisar(mensaje, 'error'); pintar(); }
    });
    if (!r.ok) { avisar(r.error, 'error'); return; }
    app.ajustes = (await window.nt.ajustesGuardar({ camara: estado.camara.nombre })).ajustes;
    pegarLaEscena();
}

/**
 * La vista previa, que es el mismo stream del que va a salir el vídeo.
 *
 * Se comprueba que sea un `MediaStream` de verdad antes de pegarlo: asignar
 * otra cosa a `srcObject` tira, y lo que hay del otro lado no siempre es una
 * cámara —la maqueta falsea la captura para poder dibujar esta pantalla sin
 * cámara ni pantalla que compartir—. Sin vista previa esto sigue funcionando;
 * con una excepción acá, la tarjeta no se dibujaría.
 */
function pegar(sel, stream) {
    const video = $(sel);
    if (!video || !(stream instanceof MediaStream)) return;
    video.srcObject = stream;
    video.play().catch(() => {});
}

function pegarLaEscena() {
    pegar('#semanal-escena-fondo', filmar.laPantalla());
    pegar('#semanal-escena-camara', ojo.elStream());
}

function dejarDePintarLaPantalla() {
    estado.pantalla = null;
    if (estado.paso === 'grabando') {
        avisar('Dejaste de compartir la pantalla: lo que siga va a salir sin ella.', 'error');
        return;
    }
    pintar();
}

/* ─── Los seis momentos ───────────────────────────────────────────────── */

/**
 * Los seis momentos, en una sola tabla.
 *
 * Cada uno dice su título, qué tarjeta se dibuja y qué hay que enganchar
 * después —los vídeos vivos y los transcripts, que no viajan en un `innerHTML`
 * porque llevan escuchas de puntero—. Estaban en tres sitios: dos tablas con la
 * misma llave y tres `if` sueltos debajo. Se desincronizaban de a uno: agregar
 * un momento era acordarse de tres renglones lejanos.
 */
const MOMENTOS = {
    listo: {
        titulo: 'Tu vídeo de la semana',
        tarjeta: tarjetas.tarjetaListo,
        luego: () => pegarLaEscena()
    },
    grabando: {
        titulo: 'Grabando',
        tarjeta: tarjetas.tarjetaGrabando,
        luego: () => { pegarLaEscena(); montarTextos(); }
    },
    mirando: { titulo: 'Mirando lo que grabaste', tarjeta: editor.tarjetaMirando },
    revisar: {
        titulo: 'Mirá tu vídeo y elegí qué va',
        tarjeta: editor.tarjetaRevisar,
        luego: () => { pegarElMontaje(); montarTextos(); }
    },
    cortando: { titulo: 'Cortando el vídeo', tarjeta: editor.tarjetaCortando },
    hecho: { titulo: 'Tu vídeo está listo', tarjeta: editor.tarjetaHecho }
};

/**
 * Lo que no se pintó mientras el menú de una palabra estaba abierto.
 *
 * El menú habla de una palabra de un texto que se rehace cada segundo, y debajo
 * de «poner el OUT acá» tiene que seguir estando lo mismo hasta que se elija o
 * se cierre. Repintar lo tiraría: el `<button>` del menú sobrevive porque vive
 * fuera de `<main>`, pero la palabra de la que habla, no.
 */
let pendiente = false;

function pintar() {
    // El espejo antes que nada: es estado y no pantalla, así que no espera al
    // menú de una palabra. Una toma abierta por la voz con el menú abierto
    // tiene que encender el punto rojo igual.
    mirilla.espejar(estado);
    if (menuPalabra.hay()) { pendiente = true; return; }
    pendiente = false;
    const momento = MOMENTOS[estado.paso];
    $('#semanal-reloj').hidden = estado.paso !== 'grabando';
    pintarRotulo();
    $('#semanal-titulo').textContent = momento.titulo;
    $('#semanal-cuerpo').innerHTML = momento.tarjeta(estado);
    if (momento.luego) momento.luego();
}

/**
 * El idioma, en la fila del título y al lado del reloj, solo grabando.
 *
 * Fuera de la tarjeta, que se rehace entera cuando cambian las tomas: un rótulo
 * adentro se cambiaba por otro en medio del clic. Y se pone al día con el reloj,
 * cada segundo, y no con la tarjeta: lo que oye cambia sin que cambie ninguna
 * toma —es el modo donde alguien se pasa al inglés a mitad de frase—, y atado a
 * la tarjeta el «Auto · EN» y el ámbar no aparecían hasta la toma siguiente.
 */
function pintarRotulo() {
    const s = estado.paso === 'grabando' && estado.sesion;
    rotuloBarra.pintar($('#semanal-rotulos'), s
        ? [idiomas.rotulo('semanal-idioma', s.idioma || 'auto', s.idiomaOido || null)]
        : []);
}

/**
 * El montaje, movido al hueco que acaba de dejar el repintado.
 *
 * Los dos `<video>` no se rehacen nunca: se mueven. Rehacerlos los dejaría en
 * negro y buscando de nuevo con cada clic, y esta pantalla es toda clics.
 */
function pegarElMontaje() {
    const hueco = $('#semanal-montaje');
    if (!hueco) return;
    montaje.montar(hueco, alMontaje);
    if (estado.montaje) montaje.poner(estado.montaje);
    aguja(estado.enVivo);
}

/**
 * Las rutas del disco, hechas URL.
 *
 * La misma vuelta que `urlDeArchivo`: en la app la página es `file:` y las
 * rutas son del disco; en la maqueta son del servidor. Así el módulo del
 * montaje no tiene que saber en cuál de los dos está.
 *
 * Se llama UNA vez, cuando el plan llega, y no en cada pintado. No es por
 * ahorrar: el montaje distingue «este es otro plan» de «es el mismo» por la
 * identidad del objeto, y hacer una copia nueva en cada pintado la rompía.
 */
function conUrls(m) {
    const a = m.archivos || {};
    const url = r => (r ? tarjetas.urlDeArchivo(r) : null);
    return {
        ...m,
        archivos: {
            camara: url(a.camara),
            pantalla: url(a.pantalla),
            pantallas: (a.pantallas || []).map(url).filter(Boolean)
        },
        // La pantalla puede ser varios tramos y cada toma usa el suyo, así que
        // su ruta viaja por toma y hay que hacerla URL también: sin esto el
        // reproductor recibía una ruta del disco y no cargaba nada. Y lo mismo
        // con los pedazos, que es la toma que cambió de ventana por el medio.
        tomas: (m.tomas || []).map(t => ({
            ...t,
            pantallaRuta: url(t.pantallaRuta),
            sonido: t.sonido && t.sonido.cual === 'wav' ? { ...t.sonido, ruta: url(t.sonido.ruta) } : t.sonido,
            pantallaPartes: t.pantallaPartes
                ? t.pantallaPartes.map(x => (x.negro ? x : { ...x, ruta: url(x.ruta) }))
                : null
        }))
    };
}

/**
 * Lo que dice el reproductor mientras corre, sesenta veces por segundo.
 *
 * Tiene UNA sola razón para repintar: que cambió la toma que suena. Eso pasa
 * cada varios segundos y ahí sí hace falta, porque abajo tiene que aparecer la
 * toma nueva con su texto. Todo lo demás —el reloj, la aguja, el botón— se
 * escribe a mano en `aguja`, que es escribir tres atributos.
 *
 * Antes repintaba también cuando el botón pasaba de Reproducir a Pausa, y eso
 * costó caro: un repintado completo a mitad de reproducción le volvía a buscar
 * la posición al vídeo, y para taparlo hubo que inventarle al montaje una
 * huella de siete campos por toma. Escribir el rótulo del botón acá borró las
 * dos cosas.
 */
function alMontaje(info) {
    const cambioLaToma = !estado.enVivo || estado.enVivo.toma !== info.toma;
    estado.enVivo = info;
    if (cambioLaToma && info.toma != null && !arrastrando) {
        estado.ficha = info.toma;
        pintar();
        return;
    }
    aguja(info);
}

/**
 * El reloj, el botón y la aguja, escritos a mano para no repintar.
 *
 * Sin dato se escribe el estado de arranque —00:00, «Reproducir», sin aguja—,
 * que es lo que hay que ver en el primer pintado: el botón ya no viene con
 * rótulo desde el HTML, así que salir temprano lo dejaría vacío.
 */
function aguja(datos) {
    const info = datos || {};
    const reloj = $('#semanal-montado');
    if (reloj) reloj.textContent = fmt.relojCorto(info.montado || 0);
    const boton = $('#semanal-reproducir');
    if (boton) {
        boton.innerHTML = `${icono(info.reproduciendo ? 'pausa' : 'reproducir')} ${
            info.reproduciendo ? 'Pausa' : 'Reproducir'}`;
        boton.title = info.reproduciendo
            ? 'Pausa. Tecla: espacio' : 'Reproducir. Tecla: espacio';
    }
    for (const b of document.querySelectorAll('#semanal-cuerpo .linea-toma')) {
        const mia = Number(b.dataset.toma) === info.toma;
        const marca = b.querySelector('.linea-aguja');
        if (!marca) continue;
        marca.hidden = !mia;
        if (mia) marca.style.left = `${info.dura ? (info.dentro / info.dura) * 100 : 0}%`;
    }
}

/**
 * El transcript, en el hueco que le dejó la tarjeta.
 *
 * Va aparte del `innerHTML` por lo mismo que en una clase: lleva escuchas de
 * puntero que el HTML no puede traer. Y es el MISMO módulo que usa la pantalla
 * de clase —`grabar/texto-toma.js`, con sus dos líneas que se arrastran—, así
 * que el IN y el OUT se corren igual acá y allá, y arreglar uno arregla los dos.
 *
 * Esto es lo que contesta la pregunta que uno se hace grabando y que antes no
 * tenía respuesta: «¿me está oyendo?». Las palabras van apareciendo, y cuando
 * se dice «3, 2, 1» se lo ve llegar. Sin esto, entre que la señal tarda unos
 * segundos y que la pantalla no decía nada, lo razonable era repetirlo —que es
 * exactamente lo que pasó en la primera grabación de verdad.
 */
let textosPuestos = new Map();

/**
 * Dónde estaba cada transcript, por texto: si abajo del todo y si no, a qué
 * altura. Se guarda acá y no se mide en el momento porque al remontar el nodo
 * ya se perdió: sacarlo del DOM y volver a meterlo le borra el scroll.
 */
const rollos = new Map();

function montarTextos() {
    const previos = textosPuestos;
    textosPuestos = new Map();
    const tomas = lasTomas();
    for (const hueco of document.querySelectorAll('#semanal-cuerpo [data-texto]')) {
        const cual = hueco.dataset.texto;
        const clave = `${cual}:${hueco.dataset.toma || ''}`;
        const previo = previos.get(clave) || null;
        const toma = tomas.find(t => t.id === Number(hueco.dataset.toma));
        const nodo = unTexto(cual, toma, previo);
        if (!nodo) continue;
        // `textoDe` hace crecer el de antes si solo hay palabras nuevas al
        // final, y si no devuelve uno nuevo. Crecer es lo que deja que la
        // selección y el arrastre aguanten mientras se habla, así que el que
        // vuelve igual se deja donde está en vez de volver a meterlo.
        const remontado = nodo === previo && nodo.parentNode !== hueco;
        if (nodo !== previo || nodo.parentNode !== hueco) hueco.replaceChildren(nodo);
        textosPuestos.set(clave, nodo);
        // Abajo, que es donde entra lo nuevo, salvo que alguien haya subido: eso
        // es lo que hace usable el clic derecho, porque para poner el IN diez
        // frases atrás hay que poder subir a buscar la palabra (ver
        // `texto.dondeQueda`). En una toma ya cerrada no se toca: lo que se
        // busca ahí es el principio.
        const rollo = cual === 'cerrada' ? null : nodo.querySelector('.transcript');
        if (!rollo) continue;
        const queda = texto.dondeQueda({ rehecho: nodo !== previo, remontado, antes: rollos.get(clave) });
        if (queda === 'fondo') rollo.scrollTop = rollo.scrollHeight;
        else if (queda != null) rollo.scrollTop = queda;
        rollo.onscroll = () => rollos.set(clave, { fondo: texto.estaAlFondo(rollo), arriba: rollo.scrollTop });
    }
}

/** La sesión que se está mirando: la viva, o la ya grabada en el editor. */
function laSesionMirada() {
    return (estado.paso === 'revisar' ? estado.grabada : estado.sesion) || {};
}

/** Las tomas con su texto: las de la sesión viva, o las de la ya grabada. */
function lasTomas() {
    return laSesionMirada().tomas || [];
}

/**
 * Poner un borde en una palabra, venga del arrastre o del clic derecho.
 *
 * Los tres casos son el mismo gesto —poner el borde en esta palabra— y cambia a
 * qué se le pide, que es lo mismo que decide `ponerBorde` en la pantalla de
 * clase:
 *
 *   espera   no hay toma abierta: el IN soltado la ABRE desde esa palabra
 *   abierta  el OUT la CIERRA ahí
 *   cerrada  los dos corren su borde, con la toma ya grabada
 *
 * **Una sola puerta para las dos maneras**, igual que allá y por lo mismo: con
 * el menú hablando con el motor por su cuenta, el mismo cambio entraría por dos
 * caminos distintos y el deshacer vería dos cosas.
 *
 * Y el reparto mira el borde, no solo el texto. En la toma abierta solo el OUT
 * la cierra; el IN le corre el principio y eso es una edición como las demás.
 * Antes acá los dos iban a `grabarCerrarToma`, así que correr el IN de la toma
 * abierta la cerraba en esa palabra — arrastrando ya se podía, y el menú lo
 * ofrece sobre cualquier palabra del medio.
 */
function ponerBorde(cual, tomaId, borde, ms) {
    const contesta = r => { if (r) { estado.sesion = r; pintar(); } };
    switch (texto.queHaceElBorde(cual, borde)) {
        case 'abrir': return window.nt.grabarAbrirToma(ms).then(contesta);
        case 'cerrar': return window.nt.grabarCerrarToma(ms).then(contesta);
        case 'mover': return cambiarFicha(tomaId, { tipo: 'borde', borde, paredMs: ms });
        case 'dividir': return dividir(tomaId, ms);
        default: return undefined;
    }
}

/**
 * Parte una toma en dos por `ms`, venga del clic derecho o de «Dividir acá».
 *
 * En el editor, después se para en la segunda mitad con su ficha abierta: se
 * parte para cambiarle algo —casi siempre la vista— y es la que hay que tener
 * delante. Se la busca por dónde empieza, que es justo `ms`: si el motor dijo
 * que no, ninguna empieza ahí y no se mueve nada, y no hace falta saber qué
 * número le pone el motor a la mitad nueva.
 */
async function dividir(tomaId, ms) {
    await cambiarFicha(tomaId, { tipo: 'dividir', paredMs: ms });
    const segunda = estado.paso === 'revisar' && lasTomas().find(t => t.inMs === ms);
    if (segunda) pararEn(segunda.id);
}

/**
 * «Dividir acá»: parte la toma que se está mirando donde está la aguja.
 *
 * La aguja dice en qué toma está y cuántos segundos lleva dentro; el plan del
 * montaje, en qué hora de la clase empieza esa toma (`desdeMs`). Con las dos se
 * sabe la hora, y `corte.dondePartir` la lleva a la palabra que empieza ahí
 * para no cortar una por la mitad.
 */
async function dividirEnLaAguja() {
    const v = estado.enVivo;
    const enElPlan = v && ((estado.montaje && estado.montaje.tomas) || []).find(t => t.id === v.toma);
    const toma = enElPlan && lasTomas().find(t => t.id === v.toma);
    if (!toma || enElPlan.desdeMs == null) return;
    await dividir(toma.id, corte.dondePartir(toma, enElPlan.desdeMs + (v.dentro || 0) * 1000));
}

function unTexto(cual, toma, previo) {
    const tomas = lasTomas();
    const suyo = (borde, ms) => ponerBorde(cual, toma && toma.id, borde, ms);

    if (cual === 'espera') {
        const cerradas = tomas.filter(t => t.outMs != null);
        const desde = cerradas.length ? Math.max(...cerradas.map(t => t.outMs)) : -Infinity;
        return texto.textoDe({
            modo: 'inactiva',
            palabras: ((estado.sesion && estado.sesion.sueltas) || []).filter(w => w.t >= desde),
            vacio: 'Escuchando… lo que digas va a ir apareciendo acá.'
        }, suyo, previo);
    }

    // Lo de antes del IN y después del OUT, igual que en la clase y con las
    // mismas cuentas (`alrededor-de-la-toma.js`): el final de la toma vecina con
    // su marca, que frena el borde, y lo que se dijo entre las dos. Acá iba solo
    // la orilla corta de la relectura, sin marca, y con la toma abierta nada:
    // no había texto de donde correr el IN hacia atrás.
    const deLaSesion = { tomas, sueltas: laSesionMirada().sueltas, vistas: estado.vistas };

    if (cual === 'abierta') {
        const abierta = tomas.find(t => t.outMs == null);
        const atras = abierta ? alrededor.antesDeLaAbierta(deLaSesion, abierta) : { antes: [], limite: null };
        return texto.textoDe({
            modo: 'abierta',
            antes: atras.antes,
            limite: atras.limite,
            palabras: (abierta && abierta.palabras) || [],
            vacio: 'Todavía no se oyó nada de esta toma.'
        }, suyo, previo);
    }

    if (cual === 'cerrada' && toma) {
        const atras = alrededor.antesDeLaCerrada(deLaSesion, toma);
        const adelante = alrededor.despuesDeLaCerrada(deLaSesion, toma);
        return texto.textoDe({
            modo: 'cerrada',
            antes: atras.antes,
            limite: atras.limite,
            palabras: toma.palabras,
            despues: adelante.despues,
            limiteDespues: adelante.limiteDespues,
            vacio: 'Esta toma no tiene texto.'
        }, suyo, previo);
    }

    return null;
}

/* ─── Los gestos ──────────────────────────────────────────────────────── */

/**
 * Las dos teclas de este modo, y nada más.
 *
 * Quien graba su vídeo de la semana tiene las dos manos en lo que está
 * enseñando y la cara en la cámara: llegar al mouse para cambiar de vista es
 * justo el gesto que se ve en el vídeo. Las letras son las del motor (`R` y
 * `P`) y están escritas dentro de cada botón, así que la tecla y el clic hacen
 * lo mismo sin que haya que acordarse de cuál era.
 */
/** El borde de la toma —abrirla o cerrarla— solo existe grabando. */
const puedeBorde = () => estado.paso === 'grabando';

/**
 * Y la vista, solo donde la elección significa algo: antes de grabar fija la
 * primera toma, y grabando cambia la abierta o la que viene. En el editor cada
 * toma tiene la suya, y un gesto suelto no sabría a cuál le toca.
 */
const puedeVista = () => estado.paso === 'listo' || estado.paso === 'grabando';

async function alTeclado(e) {
    if (!$('#vista-semanal').classList.contains('es-activa')) return;
    // Con Ajustes o Diagnóstico encima, el teclado es de ellos.
    if (document.querySelector('.telon.es-activa')) return;
    // Y con el menú de una palabra abierto, del menú: Escape lo cierra y las
    // flechas van de una opción a la otra. Sin esto, la «P» de una vista
    // cambiaría la toma por detrás del menú.
    if (menuPalabra.alTeclado(e)) return;
    // ⌘Z antes del portero de abajo, que apaga todo lo que lleve ⌘: es la
    // tecla que hace que Descartar se pueda ofrecer sin preguntar, así que
    // tiene que estar donde está el botón. Grabando nada más, que es donde el
    // motor tiene la pila.
    if (historia.esDeshacer(e) && tarjetas.sePuedeDeshacer(estado)) {
        e.preventDefault();
        return volver(e.shiftKey ? 'rehacer' : 'deshacer');
    }
    if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    // Donde se escribe, se escribe: una «p» en un campo es una letra.
    const foco = document.activeElement;
    if (foco && foco.matches('input, textarea, select, [contenteditable="true"]')) return;
    // Y sobre un botón con foco, Enter y espacio son del botón.
    if ((e.key === 'Enter' || e.key === ' ') && foco && foco.closest('button, a, [role="button"]')) return;

    // Enter es el borde de la toma, y solo grabando: es la tecla que no hay que
    // pensar, y por eso es la misma para abrir y para cerrar.
    if (e.key === 'Enter') {
        if (!puedeBorde()) return;
        e.preventDefault();
        return bordeDeToma();
    }

    // El espacio reproduce y pausa el montaje, como en cualquier reproductor.
    // Solo en el editor: en los demás pasos no hay nada que reproducir.
    if (e.key === ' ' && estado.paso === 'revisar') {
        e.preventDefault();
        montaje.alternar();
        return;
    }

    if (!puedeVista()) return;

    const v = tarjetas.VISTAS.find(x => tarjetas.teclaDe(x).toLowerCase() === e.key.toLowerCase());
    if (!v) return;
    e.preventDefault();
    return cambiarVista(v.nombre);
}

async function alCambio(e) {
    const campo = e.target.dataset.campo;
    if (campo === 'camara') {
        estado.camara = estado.camaras.find(c => c.nombre === e.target.value) || null;
        abrirLaCamara().then(() => pintar());
    }
    if (campo === 'micro') {
        estado.micro = estado.entradas.find(x => x.nombre === e.target.value) || null;
        await abrirElMicro();
        pintar();
    }
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton || boton.disabled) return;
    const hace = boton.dataset.hace;

    if (hace === 'elegir-pantalla') return elegirPantalla();
    if (hace === 'cambiar-pantalla') return cambiarPantalla(boton);
    if (hace === 'mirilla') return laMirilla(!estado.mirilla);
    if (hace === 'vista') return cambiarVista(boton.dataset.vista);
    if (hace === 'borde') return bordeDeToma();
    if (hace === 'plegar') return plegar(Number(boton.dataset.toma));
    if (hace === 'vista-ficha') return cambiarFicha(Number(boton.dataset.toma),
        { tipo: 'vista', vista: boton.dataset.vista });
    if (hace === 'mantener' || hace === 'desactivar') {
        return cambiarFicha(Number(boton.dataset.toma), estadosToma.cambioDe(hace));
    }
    if (hace === 'descartar') return descartar(Number(boton.dataset.toma));
    if (hace === 'deshacer' || hace === 'rehacer') return volver(hace);
    if (hace === 'idioma') {
        rotuloBarra.abrir(boton.id, idiomas.opciones((estado.sesion && estado.sesion.idioma) || 'auto'),
            cual => cambiarIdioma(cual));
        return undefined;
    }
    if (hace === 'reproducir') { montaje.alternar(); return undefined; }
    if (hace === 'dividir-aca') return dividirEnLaAguja();
    if (hace === 'opcion') return alternarOpcion(boton);
    if (hace === 'parar-en') {
        // Con el ratón ya lo puso el arrastre, en el punto exacto. Con el
        // teclado no hubo arrastre, así que esto es lo único que lo mueve.
        if (yaLoPusoElArrastre) { yaLoPusoElArrastre = false; return undefined; }
        return pararEn(Number(boton.dataset.toma));
    }
    if (hace === 'ocultar-fuera') {
        estado.ocultarFuera = !estado.ocultarFuera;
        pintar();
        return undefined;
    }
    if (hace === 'grabar') return pedirGrabar(boton);
    if (hace === 'terminar') return terminar(boton);
    if (hace === 'exportar') return exportar(boton);
    if (hace === 'ajustar') return ajustar();
    if (hace === 'atras') return atras();
    if (hace === 'mostrar') return window.nt.reveal(estado.hecho.ruta);
    if (hace === 'abrir') return window.nt.openPath(estado.hecho.ruta);
    if (hace === 'ver-brutos') return window.nt.reveal(dondeEstanLosBrutos());
    if (hace === 'otro') return ver();
    if (hace === 'abrir-ultima') return abrirLaUltima(boton);
    if (hace === 'elegir-carpeta') return elegirCarpeta(boton);
    if (hace === 'abrir-hallada') {
        return abrirLaUltima(boton, (estado.encontradas || [])[Number(boton.dataset.cual)]);
    }
    return undefined;
}

/** Encender o apagar la mirilla (ver `semanal/mirilla.js`). */
async function laMirilla(encendida) {
    try {
        await mirilla.poner(estado, encendida, filmar.laPantalla());
    } catch (e) {
        avisar(`No se pudo abrir la ventanita: ${e.message}`, 'error');
        return;
    }
    pintar();
}

/**
 * Encender o apagar una de las opciones de exportar.
 *
 * No repinta: la pantalla entera se rehace por cosas que cambian el vídeo, y
 * esto no cambia ninguna —se mira recién al cortar—. Repintar además le
 * sacaría el foco al botón que se acaba de apretar.
 */
function alternarOpcion(boton) {
    const campo = boton.dataset.campo;
    const clave = campo === 'silencios' ? 'silencios' : 'mejorarAudio';
    estado[clave] = !estado[clave];
    boton.setAttribute('aria-pressed', String(estado[clave]));
}

/**
 * Pararse en una toma de la línea: abajo aparece ella, y el vídeo salta al segundo
 * que se pidió, o a su principio si no se pidió ninguno.
 *
 * Y si estaba reproduciendo, sigue reproduciendo desde ahí. Clicar una toma es
 * decir «mostrame esta», no «pará»: tener que apretar play otra vez después de
 * cada clic es lo que hace que revisar sea un trámite.
 */
function pararEn(id, segundos) {
    const iba = montaje.reproduciendo();
    estado.ficha = id;
    montaje.irA(id, { reproducir: iba, segundos });
    pintar();
}

/**
 * Dónde cae un punto de la línea de tomas, en toma y en segundo.
 *
 * Se mide sobre la línea ENTERA y no sobre el trozo que se apretó, porque
 * arrastrar tiene que poder cruzar de una toma a la siguiente: con el ratón
 * apretado uno sale de un trozo y entra en otro, y si cada trozo contestara
 * solo por él, al salirse no contestaría nadie.
 *
 * Los trozos miden lo que duran (`corte.anchoDe`), salvo los muy cortos, que
 * tienen un mínimo para poder tocarse. Por eso la cuenta va sobre lo que cada
 * trozo MIDE en pantalla y no sobre lo que dura: es lo que se está señalando.
 */
function dondeCaeEnLaLinea(clienteX) {
    // Se buscan los trozos de nuevo en cada paso y no se guardan: la pantalla
    // se rehace entera cada vez que cambia la toma, y una lista guardada
    // apuntaría a botones que ya no están en ningún sitio. Medían todos cero y
    // el arrastre se iba siempre al último.
    const trozos = [...document.querySelectorAll('#semanal-cuerpo .linea-toma')];
    if (!trozos.length) return null;
    // Fuera por un lado o por el otro, el de la punta: arrastrar y pasarse
    // tiene que dejarte al final, no soltarte.
    const primero = trozos[0].getBoundingClientRect();
    if (clienteX < primero.left) return { id: Number(trozos[0].dataset.toma), segundos: 0 };
    for (const b of trozos) {
        const r = b.getBoundingClientRect();
        if (clienteX > r.right) continue;
        const parte = r.width > 0 ? (clienteX - r.left) / r.width : 0;
        return {
            id: Number(b.dataset.toma),
            segundos: Math.max(0, Math.min(1, parte)) * Number(b.dataset.segundos || 0)
        };
    }
    const ultimo = trozos[trozos.length - 1];
    return { id: Number(ultimo.dataset.toma), segundos: Number(ultimo.dataset.segundos || 0) };
}

/**
 * Si el puntero ya dejó el montaje donde quería.
 *
 * El botón de cada toma sigue teniendo su `click`, que es lo que lo hace
 * manejable con el teclado. Con el ratón llegan los dos —el arrastre y, detrás,
 * el clic— y el clic dejaría el montaje al principio de la toma, deshaciendo
 * justo lo que se acababa de elegir.
 */
let yaLoPusoElArrastre = false;

/**
 * Si el puntero está recorriendo la línea ahora mismo.
 *
 * Mientras dura, la pantalla NO se repinta aunque cambie de toma: repintar
 * rehace la línea entera debajo del puntero, y el arrastre se queda midiendo
 * botones que ya no están en ningún sitio. Al soltar se repinta una vez.
 */
let arrastrando = false;

/**
 * Arrastrar por la línea de tomas para buscar un punto del vídeo.
 *
 * La línea ya era el vídeo a escala y ya se podía apretar, pero apretar te
 * dejaba al PRINCIPIO de la toma: para ver algo del medio había que arrancar
 * desde su comienzo y esperar. Ahora cae donde se apretó, y con el ratón
 * apretado se recorre el vídeo entero.
 *
 * No repinta mientras se arrastra: repintar rehace los botones y el puntero se
 * queda apretando un elemento que ya no existe. Al soltar, una sola vez.
 */
function arrastrarPorLaLinea(e) {
    if (!e.target.closest('.linea-tomas') || e.button !== 0) return;
    const caida = dondeCaeEnLaLinea(e.clientX);
    if (!caida) return;
    e.preventDefault();

    const iba = montaje.reproduciendo();
    if (iba) montaje.pausar();
    arrastrando = true;

    let ultima = caida;
    const mueve = ev => {
        const d = dondeCaeEnLaLinea(ev.clientX);
        if (!d) return;
        ultima = d;
        montaje.irA(d.id, { segundos: d.segundos });
    };
    const suelta = () => {
        yaLoPusoElArrastre = true;
        arrastrando = false;
        window.removeEventListener('pointermove', mueve);
        window.removeEventListener('pointerup', suelta);
        estado.ficha = ultima.id;
        montaje.irA(ultima.id, { reproducir: iba, segundos: ultima.segundos });
        pintar();
    };
    window.addEventListener('pointermove', mueve);
    window.addEventListener('pointerup', suelta);
    montaje.irA(caida.id, { segundos: caida.segundos });
}

/**
 * Abrir y cerrar una ficha, en acordeón: una sola a la vez.
 *
 * Con la grabación corriendo, lo que se busca en la lista es una toma
 * concreta; con varias desplegadas hay que scrollear para encontrarla, y el
 * nombre y el momento alcanzan para elegir. Es la misma regla que en clase.
 */
function plegar(id) {
    estado.ficha = estado.ficha === id ? null : id;
    pintar();
}

/**
 * Descartar: sacar la toma de la sesión, el tercero de los tres estados.
 *
 * **No pregunta**, como el resto de esta pantalla y como la de clase: lo que
 * evita el accidente es ⌘Z, y un cartel de confirmación a mitad de una
 * grabación es un renglón que hay que leer con la cámara encendida. Por eso el
 * aviso nombra la tecla: quien descartó sin querer no tiene por qué saberla.
 *
 * El motor se planta con la toma abierta —descartarla dejaría al ciclo de
 * señales metiendo palabras en una toma que ya no existe—, así que acá no se
 * supone que pasó: se mira si la toma quedó. Si sigue en la lista no hay nada
 * que avisar, y la ficha abierta tampoco hay que cerrarla.
 */
async function descartar(id) {
    await cambiarFicha(id, estadosToma.cambioDe('descartar'));
    if (((estado.sesion && estado.sesion.tomas) || []).some(t => t.id === id)) return;
    if (estado.ficha === id) estado.ficha = null;
    avisar(historia.avisoDeDescarte(id));
    pintar();
}


/**
 * Deshacer y rehacer, lo mismo que en la clase y por el mismo motor.
 *
 * Todo lo que cambia una toma pasa por `cambios-toma.js`, que deja su paso en
 * el historial de la sesión; esta pantalla no guardaba nada por su cuenta, así
 * que lo único que le faltaba era la puerta. Es lo que hace que Descartar se
 * pueda ofrecer sin preguntar.
 *
 * Solo mientras se graba: una sesión ya cerrada se relee del archivo en cada
 * gesto y no tiene pila (ver `sesiones-grabadas.js`). Los dos botones viven en
 * la tarjeta de grabar, así que en el editor no están, y la tecla pregunta lo
 * mismo (`tarjetas.sePuedeDeshacer`).
 */
const volver = cual => historia.volver(cual, nuevo => { estado.sesion = nuevo; pintar(); });

/**
 * El idioma, cambiado a mitad de la grabación.
 *
 * Lo mismo que en la clase y por el mismo camino (`idiomas.cambiar`), con una
 * diferencia: acá se guarda en `semanal.idioma`, que es un ajuste aparte. Son
 * la misma pregunta hecha a dos personas distintas y cada una tiene su
 * respuesta.
 *
 * Por `app.guardarAjustes` y no por el puente directo: la copia de los ajustes
 * es de la app, y guardando por fuera quedaba vieja. El vídeo siguiente de la
 * misma tanda arrancaba en el idioma de antes, que es el que lee de ahí.
 */
async function cambiarIdioma(cual) {
    if (!estado.sesion || cual === estado.sesion.idioma) return;
    const r = await idiomas.cambiar(cual, estado.sesion);
    if (!r) return;
    if (!r.ok) { avisar(r.error, 'error'); return; }
    estado.sesion = r.estado;
    await app.guardarAjustes({ semanal: { idioma: cual } });
    pintar();
    avisar(r.aviso, 'ok');
}

/**
 * Un cambio sobre una toma de la lista, por la puerta que corresponda.
 *
 * Son dos puertas porque son dos sitios: grabando, la sesión está en memoria y
 * el motor la contesta entera; terminada, el cambio va al sidecar y reescribe
 * el XML. Es la misma distinción que en la clase, y la hace el paso y no quien
 * aprieta el botón.
 */
async function cambiarFicha(id, cambio) {
    if (estado.paso !== 'revisar') {
        const r = await window.nt.grabarEditar({ ...cambio, toma: id });
        if (r) { estado.sesion = r; pintar(); }
        return;
    }
    const r = await window.nt.grabarEditarGrabada(estado.json, { ...cambio, toma: id });
    if (!r || !r.ok) {
        avisar((r && r.error) || 'No se pudo guardar ese cambio.', 'error');
        return;
    }
    estado.grabada = r.estado;
    // Y el montaje otra vez, siempre: cualquiera de los tres cambios mueve lo
    // que hay que reproducir. Un borde cambia dónde empieza y termina la toma
    // dentro del archivo, una vista cambia cuál de los dos se ve, y un descarte
    // cambia a qué toma se salta.
    //
    // Es leer el sidecar y hacer restas, salvo la primera vez: el motor también
    // le pregunta a ffprobe si la cámara trae pista de audio, y eso sí es un
    // proceso. Lo recuerda por archivo (`audioDeLaCamara`), así que del segundo clic
    // en adelante no se lanza nada. Antes acá decía «no se toca ffmpeg», que era
    // mentira y escondía un `spawnSync` por clic en el proceso principal.
    await traerElMontaje();
    pintar();
}

/**
 * Pide el montaje y se lo da al reproductor, sin perder dónde iba.
 *
 * Es lo único que cruza los relojes, y por eso lo hace el motor y no la
 * pantalla: los bordes de las tomas están en el reloj del audio y los vídeos en
 * el de pared.
 */
async function traerElMontaje() {
    const m = await window.nt.semanalMontaje(estado.json);
    if (!m || !m.ok) {
        avisar((m && m.error) || 'No pude armar el montaje para mirarlo.', 'error');
        return false;
    }
    estado.montaje = conUrls(m);
    for (const a of m.avisos || []) avisar(a, 'aviso');
    return true;
}

/**
 * Cambiar de ventana sin parar de grabar.
 *
 * El botón se apaga mientras dura, y eso no es cosmético: el selector del
 * sistema tarda lo que tarde la persona, y dos cambios a la vez dejarían dos
 * grabadores escribiendo en el mismo tramo.
 *
 * **Con una toma abierta se cambia igual y se dice lo que va a pasar.** La
 * tarjeta ya lo advierte antes de apretar (ver `laVentana` en `tarjetas.js`);
 * esto lo repite después, cuando ya es un hecho y con el número de la toma, que
 * es el momento en que todavía se puede arreglar cerrando la toma y volviendo a
 * decir el «3, 2, 1».
 */
async function cambiarPantalla(boton) {
    const abierta = tarjetas.laAbierta(estado);
    boton.disabled = true;
    let r;
    try {
        r = await filmar.cambiarPantalla();
    } finally {
        boton.disabled = false;
    }
    if (!r.ok) {
        if (r.error) avisar(r.error, 'error');
        return undefined;
    }
    estado.pantalla = { nombre: r.nombre, ancho: r.ancho, alto: r.alto };
    // Si el cambio de ventana se fue a otro monitor, la mirilla se muda con él:
    // la esquina que importa es la del monitor que se está grabando.
    mirilla.contarLaPantalla(estado, filmar.laPantalla());
    if (abierta) {
        avisar(`Ahora se graba ${r.nombre}. La toma ${abierta.id} quedó partida entre dos `
            + 'ventanas, así que va a salir con tu cámara: si la querés con pantalla, cerrala '
            + 'y volvé a abrirla.', 'aviso');
    } else {
        avisar(`Ahora se graba ${r.nombre}.`);
    }
    pintar();
    return undefined;
}

/**
 * El borde de una toma, a mano: abre si no hay ninguna abierta y cierra si la hay.
 *
 * Es la misma tecla para las dos cosas, igual que en una clase: lo que se
 * aprieta no es «abrir» ni «cerrar» sino «acá va el borde». Y acá hace más
 * falta que allá, porque el motivo es medido: desde que se termina de decir
 * «1» hasta que la toma abre pasan unos 3 segundos de mediana, y quien graba su
 * vídeo de la semana se queda esperando en silencio, mirando. En el audio de la
 * primera grabación de verdad se ve el resultado: el «3, 2, 1» dicho a los
 * 4,8 s, repetido a los 13,5 s, y un tercero tan despacio —cinco segundos entre
 * el 3 y el 2— que no cabía en una sola pasada de Whisper.
 *
 * El del motor sigue andando igual: esto es otra puerta al mismo sitio, no un
 * reemplazo.
 */
let bordeEnVuelo = null;

async function bordeDeToma() {
    // Dos Enter seguidos —cerrar y volver a abrir— salían los dos con el MISMO
    // estado, así que el segundo pedía cerrar otra vez y se perdía. Se espera
    // al primero y se decide con lo que quedó.
    const previo = bordeEnVuelo;
    if (previo) await previo.catch(() => {});
    const mio = (async () => {
        const abierta = tarjetas.laAbierta(estado);
        const r = abierta
            ? await window.nt.grabarCerrarToma()
            : await window.nt.grabarAbrirToma();
        if (!r) return;
        estado.sesion = r;
        // La vista elegida le toca también a una toma abierta a mano, y sin
        // esperar a `repintarReloj`: quien la abrió ya había elegido con qué.
        await ponerLaVista(r);
        if (!abierta && r.abierta != null) {
            avisar(r.retrocedioSec > 0.5
                ? `Toma ${r.abierta} abierta ${r.retrocedioSec} s atrás, desde donde arrancó la frase.`
                : `Toma ${r.abierta} abierta.`);
        }
        pintar();
    })();
    bordeEnVuelo = mio;
    try {
        return await mio;
    } finally {
        if (bordeEnVuelo === mio) bordeEnVuelo = null;
    }
}

/**
 * Cambiar qué se ve, mientras se graba: desde la mirilla, los botones de la
 * tarjeta o las teclas, que pasan todos por acá.
 *
 * Con una toma abierta, cambia DESDE AHORA (`vista-desde-ahora` en el motor):
 * la toma se parte en este instante y lo que sigue va con la vista nueva, y lo
 * que ya se dijo se queda con la de antes. Es pasar a cámara para contar algo
 * sin que lo de la pantalla de recién pase a cámara también. Si la toma acaba
 * de abrirse, el motor entiende que es corregir la vista y la cambia entera.
 *
 * Sin toma abierta queda elegido para la siguiente, que es el gesto que se pidió.
 */
async function cambiarVista(nombre) {
    if (!tarjetas.VISTAS.some(v => v.nombre === nombre)) return;
    estado.vista = nombre;
    const abierta = tarjetas.laAbierta(estado);
    if (abierta) {
        const r = await window.nt.grabarEditar({ tipo: 'vista-desde-ahora', toma: abierta.id, vista: nombre });
        if (r) estado.sesion = r;
    }
    pintar();
}

/**
 * Elegir qué pantalla o ventana se graba, con el selector de macOS.
 *
 * @returns {Promise<boolean>} si quedó una elegida
 */
async function elegirPantalla() {
    const r = await filmar.elegirPantalla();
    if (!r.ok) {
        if (r.error) avisar(r.error, 'error');
        return;
    }
    estado.pantalla = { nombre: r.nombre, ancho: r.ancho, alto: r.alto };
    mirilla.contarLaPantalla(estado, filmar.laPantalla());
    pintar();
}

/** «Grabar», y sin pantalla elegida, preguntar antes (`al-grabar.js`). */
async function pedirGrabar(boton) {
    const que = await alGrabar.queHacer(Boolean(estado.pantalla), window.nt.preguntar);
    if (que === 'elegir') await elegirPantalla();
    if (que === 'grabar') await grabar(boton);
}

/**
 * Empezar: la carpeta, el motor, los dos vídeos y el audio. En ese orden.
 *
 * El orden importa. El motor primero, porque es quien fija el cero de la
 * sesión y abre el WAV; los vídeos después, cada uno diciendo a qué hora
 * arrancó; y el audio al final, que es lo que ya hacía la pantalla de clase:
 * mandar PCM antes de que el motor diga que sí sería escribir en una sesión
 * que no arrancó.
 */
async function grabar(boton) {
    boton.disabled = true;
    try {
        const carpeta = await dondeGuardar();
        if (!carpeta) return;

        const como = fuente.comoSuena();
        const r = await window.nt.grabarIniciar({
            dir: carpeta,
            // Una carpeta por grabación adentro de la que eligió, con el vídeo
            // y los brutos juntos: así mandar o borrar una grabación es mandar
            // o borrar una carpeta (ver `workspace.carpetaDeGrabacion`).
            carpetaPropia: true,
            curso: 'semana',
            fps: 30,
            // El de este modo, que de fábrica es `auto`: acá el idioma cambia a
            // mitad de frase y lo que hay que entender igual es el «3, 2, 1» y
            // la «Pausa» (ver `semanal.idioma` en `engine/ajustes.js`).
            idioma: (app.ajustes.semanal && app.ajustes.semanal.idioma) || 'auto',
            dispositivo: como.dispositivo,
            sampleRate: como.sampleRate,
            canales: como.canales
        });
        if (!r.ok) { avisar(r.error, 'error'); return; }

        const f = await filmar.empezar({
            alAviso: a => {
                if (a.tipo === 'pantalla-soltada') dejarDePintarLaPantalla();
                if (a.tipo === 'roto') seRompio(a);
            }
        });
        if (!f.ok) {
            // Sin vídeo no hay modo semanal: se cierra la sesión que acaba de
            // abrirse para no dejar una grabación a medias en el disco.
            await window.nt.grabarTerminar();
            avisar(f.error, 'error');
            return;
        }
        await fuente.empezarAMandar();

        estado.sesion = r.estado;
        estado.paso = 'grabando';
        estado.reloj = setInterval(repintarReloj, 1000);
        pintar();
    } finally {
        boton.disabled = false;
    }
}

/** La carpeta del modo, preguntada una sola vez y recordada. */
async function dondeGuardar() {
    const puesta = app.ajustes.semanal && app.ajustes.semanal.carpeta;
    if (puesta) return puesta;
    const ruta = await window.nt.pickFolder({
        titulo: 'Dónde guardar tus vídeos de la semana',
        boton: 'Guardar acá'
    });
    if (!ruta) return null;
    app.ajustes = (await window.nt.ajustesGuardar({ semanal: { carpeta: ruta } })).ajustes;
    return ruta;
}

/**
 * Le pone la vista elegida a las tomas que aparecieron desde la última vuelta.
 *
 * Solo a las nuevas: `vistaHasta` es hasta dónde se llegó, y sin él un cambio
 * de vista en la toma 5 reescribiría también las cuatro anteriores, que ya
 * estaban decididas. Las tomas las abre la voz, así que acá no hay forma de
 * ponerle la vista a una toma antes de que exista: se le pone al verla.
 */
async function ponerLaVista(resumen) {
    for (const t of resumen.tomas || []) {
        if (t.id <= estado.vistaHasta) continue;
        estado.vistaHasta = t.id;
        if (t.vista !== estado.vista) {
            await window.nt.grabarEditar({ tipo: 'vista', toma: t.id, vista: estado.vista });
        }
    }
}

async function repintarReloj() {
    // `grabar-estado` contesta el resumen pelado, que es el mismo que mira la
    // pantalla de clase: sin `ok` ni envoltorio.
    const resumen = await window.nt.grabarEstado();
    if (!resumen) return;
    await ponerLaVista(resumen);
    estado.sesion = resumen;
    $('#semanal-reloj').textContent = fmt.relojCorto(resumen.segundos);
    pintarRotulo();
    // El atraso del ciclo, igual que el reloj y por lo mismo: los segundos
    // suben solos y meterlos en la huella de abajo repintaría la tarjeta cada
    // segundo, que es justo lo que la huella evita. Lo que entra en la huella
    // es solo que el aviso aparezca o se vaya (ver `atrasado` en `estados.js`).
    const atras = estados.atrasado(resumen);
    if (atras) {
        const pastilla = $('#semanal-pastilla');
        const renglon = $('#semanal-atraso');
        if (pastilla) { pastilla.textContent = atras.palabra; pastilla.title = atras.porque; }
        if (renglon) renglon.textContent = atras.porque;
    }
    // Se repinta la tarjeta solo cuando cambia lo que dice, no cada segundo:
    // repintar borraría el `<video>` de la vista previa y la dejaría en negro.
    //
    // Lo que dice son los renglones de la lista: cuántas tomas hay, dónde
    // empieza y termina cada una, qué se ve en ella y si quedó fuera. Las
    // palabras cuentan solo en las cerradas —una relectura puede reescribirle
    // el principio a una, y entonces el renglón cambia— porque las de la
    // abierta crecen cada segundo y repintarían siempre.
    const ahora = (resumen.tomas || [])
        .map(t => [t.id, t.inMs, t.outMs, t.vista, t.descartada ? 1 : 0,
            t.outMs == null ? '' : (t.palabras || []).length].join(':'))
        .concat([atras ? atras.clave : ''])
        .join('|');
    if (ahora !== estado.ultimo) {
        estado.ultimo = ahora;
        pintar();
        return;
    }
    // El transcript sí cada segundo: es lo único que cambia mientras se habla,
    // y crece sin rehacerse. Salvo con una línea agarrada, que desaparecería
    // de debajo del cursor justo mientras se busca dónde cortar — o con el menú
    // de una palabra abierto, que es el mismo caso con otro gesto: el menú
    // habla de una palabra que tiene que seguir ahí hasta que se elija.
    if (!texto.arrastrando() && !menuPalabra.hay()) montarTextos();
}

/**
 * Terminar: parar todo, cerrar la sesión y mirar lo que quedó.
 *
 * Por dentro son tres pasos en orden: los vídeos (que entregan su último
 * pedazo al pararse), el audio, y el motor, que relee las últimas tomas y
 * escribe el sidecar con los bordes ya ajustados. De ahí sale el archivo que
 * leen tanto las fotos como el corte.
 *
 * **Y acá ya no se exporta solo.** Se exportaba, y estaba mal: entre que una
 * toma salió con la vista equivocada y que una toma no había que usarla, lo
 * que salía era un vídeo que había que volver a hacer entero. Ahora se para
 * acá, se mira y se decide, y recién entonces se corta.
 */
async function terminar(boton) {
    boton.disabled = true;
    if (estado.reloj) clearInterval(estado.reloj);
    estado.reloj = null;
    // La mirilla se cierra acá y no cuando le toque: es una ventana encima de
    // todo lo demás y sin nada que grabar ya no es ayuda, es un estorbo que
    // tapa el editor.
    if (estado.mirilla) laMirilla(false);
    estado.paso = 'mirando';
    pintar();

    try {
        fuente.dejarDeMandar();
        // Lo que contesta el cierre son los archivos que quedaron escritos: es
        // de donde sale «Mostrar lo que se grabó».
        const cierre = await filmar.terminar();
        estado.brutos = ((cierre && cierre.videos) || []).map(v => v.archivo).filter(Boolean);
        // `grabar-terminar` contesta la salida pelada, con los archivos que
        // quedaron escritos: de ahí sale el sidecar que todo lo demás va a leer.
        const salida = await window.nt.grabarTerminar();
        await fuente.cerrar();
        await ojo.soltar('semanal');
        estado.sesion = null;

        if (!salida || !salida.archivos || !salida.archivos.json) {
            estado.hecho = { ok: false, error: 'La grabación no se pudo cerrar, así que no hay qué cortar.' };
            estado.paso = 'hecho';
            pintar();
            return;
        }
        await irAlEditor(salida.archivos.json);
    } catch (err) {
        estado.hecho = { ok: false, error: err.message, brutos: dondeEstanLosBrutos() };
        estado.paso = 'hecho';
        pintar();
    }
}

/**
 * Abrir el editor de una grabación que está en el disco.
 *
 * Lo usan los dos caminos que llevan ahí: terminar de grabar, y abrir la última
 * del inicio. Son el mismo: una grabación recién cerrada y una de ayer se
 * distinguen en nada una vez escritas, y tener esto dos veces quería decir que
 * la de ayer se iba a abrir un poco distinto que la de hace un minuto.
 *
 * @param {string} json el sidecar, que es de donde cuelga todo lo demás
 */
async function irAlEditor(json) {
    estado.json = json;
    const m = await window.nt.semanalMontaje(json);
    if (!m.ok || !m.tomas.length) {
        estado.hecho = {
            ok: false,
            brutos: dondeEstanLosBrutos(),
            error: m.error || 'No se abrió ninguna toma: no hay nada que cortar. '
                + 'Los vídeos y el audio quedaron guardados.'
        };
        estado.paso = 'hecho';
        pintar();
        return;
    }
    estado.montaje = conUrls(m);
    // «Ver lo que se grabó» necesita un archivo de la grabación para abrir SU
    // carpeta. Al terminar de grabar lo pone el cierre; al abrir una de ayer no
    // hay cierre, y sin esto se caía al respaldo —la carpeta que se eligió, que
    // ahora es la madre de todas— y abría el Finder en el sitio equivocado.
    if (!estado.brutos.length) {
        // Todos los tramos de pantalla, no solo el primero: `ver-brutos` abre el
        // Finder en el primero de la lista, y si faltaran los demás no habría
        // forma de llegar a lo que se grabó después de cambiar de ventana.
        estado.brutos = [m.archivos.camara, ...(m.archivos.pantallas || [m.archivos.pantalla])]
            .filter(Boolean);
    }
    for (const a of m.avisos || []) avisar(a, 'aviso');
    // Y el texto de cada toma, que es con lo que se edita: el montaje dice
    // qué se ve y las palabras dicen dónde empieza y dónde termina. Si no
    // se pudiera leer, el editor sigue andando sin texto antes que no haber
    // editor.
    const grabada = await window.nt.grabarAbrirGrabada(json);
    estado.grabada = grabada && grabada.ok ? grabada.estado : null;
    estado.ficha = null;
    estado.enVivo = null;
    estado.paso = 'revisar';
    pintar();
}

/**
 * Abrir la última grabación, desde el inicio.
 *
 * El vídeo que sale de acá no se pisa nunca: «Cortar y exportar» escribe al
 * lado con otro nombre (ver `alLado` en `engine/exportar-video.js`), así que
 * volver sobre una grabación de la semana pasada no puede perder la que ya se
 * había mandado.
 */
async function abrirLaUltima(boton, cual) {
    const u = cual || estado.ultima;
    if (!u) return;
    boton.disabled = true;
    try {
        estado.cortes = 0;
        estado.brutos = [];
        await irAlEditor(u.json);
    } catch (err) {
        avisar(`No pude abrir «${u.nombre}»: ${err.message}`, 'error');
        boton.disabled = false;
    }
}

/**
 * Abrir un vídeo de otra carpeta.
 *
 * «Lo último que grabaste» mira solo la carpeta de los ajustes, así que un
 * vídeo que vive en otro sitio —otra semana, otro disco, la carpeta de otra
 * persona— no tenía por dónde abrirse. Esto lo pide prestado para esta vez: no
 * toca `ajustes.semanal.carpeta`, porque elegir dónde buscar hoy no es mudarse.
 *
 * Y busca con el mismo `grabarListar` que la última, que ya baja por la
 * carpeta sola (`dondeBuscar`): da igual que se apunte a la carpeta del vídeo o
 * a la que la contiene, que es justo lo que no se sabe de memoria al estar
 * frente al diálogo del Finder.
 *
 * Con uno solo entra directo. Con varios los muestra y elige quien sabe cuál
 * quería (ver `deLaCarpeta` en `semanal/tarjetas.js`).
 */
async function elegirCarpeta(boton) {
    const dir = await window.nt.pickFolder({
        titulo: 'Elegí la carpeta donde grabaste ese vídeo',
        boton: 'Buscar acá'
    });
    if (!dir) return;
    boton.disabled = true;
    estado.buscada = dir;
    estado.encontradas = [];
    try {
        estado.encontradas = (await window.nt.grabarListar([dir]) || [])
            .filter(s => s.archivos && s.archivos.json)
            .map(deLaLista);
    } catch (err) {
        avisar(`No pude leer esa carpeta: ${err.message}`, 'error');
        estado.buscada = null;
    }
    boton.disabled = false;
    if (estado.encontradas.length === 1) {
        const sola = estado.encontradas[0];
        estado.encontradas = [];
        estado.buscada = null;
        return abrirLaUltima(boton, sola);
    }
    pintar();
    return undefined;
}

/**
 * Volver a la revisión con el vídeo ya visto.
 *
 * Es el único camino que va para atrás en esta pantalla, y existe porque mirar
 * el vídeo es lo que destapa el error: una toma salió con la cámara cuando
 * tenía que ser la pantalla, o una toma que parecía buena no lo era. Antes eso
 * se arreglaba grabándolo todo de nuevo — lo grabado seguía en el disco, pero
 * la pantalla ya no tenía por dónde volver a usarlo.
 *
 * No se borra nada ni se vuelve a leer el disco: la revisión es la misma que se
 * dejó, con las fotos ya cargadas, así que volver es instantáneo. Lo que sí
 * queda es el MP4 anterior, que no se pisa nunca (ver `alLado`).
 */
function ajustar() {
    estado.paso = 'revisar';
    pintar();
}

/**
 * Arrepentirse de haber entrado al editor.
 *
 * Es el camino que faltaba: al editor se entra por tres sitios y de los tres se
 * salía exportando, así que entrar por error costaba un corte entero o cerrar
 * la app. Vuelve adonde se vino, que es lo que hace que sea un «atrás» y no
 * otro botón que lleva a otro sitio:
 *
 *   · Si hay un vídeo ya cortado, a él. Nada que hacer más que cambiar de
 *     paso: el MP4 no se pisó —`alLado` nunca pisa— y el montaje sigue
 *     cargado, así que ir y volver es gratis las veces que haga falta.
 *   · Si no, al panel de antes de grabar, que es `ver()` y ya limpia todo lo
 *     que hay que limpiar. Lo grabado queda en el disco y vuelve a abrirse con
 *     «Seguir con esa» o con «Elegir carpeta…».
 *
 * Lo que se ajustó no se pierde en ninguno de los dos casos: cada cambio ya
 * está escrito en el sidecar (`cambiarFicha`), no en esta pantalla.
 */
function atras() {
    if (estado.hecho && estado.hecho.ok) {
        montaje.pausar();
        estado.paso = 'hecho';
        pintar();
        return undefined;
    }
    return alPanel();
}

/** Y recién acá se corta. */
async function exportar(boton) {
    boton.disabled = true;
    // El montaje callado mientras corre ffmpeg: dos vídeos reproduciéndose al
    // lado del codificador es pelearle el disco y la CPU por nada.
    montaje.pausar();
    estado.corte = { pct: 0 };
    estado.cortes = (estado.cortes || 0) + 1;
    estado.paso = 'cortando';
    pintar();
    try {
        const r = await window.nt.semanalExportar(estado.json,
            { quitarSilencios: estado.silencios, mejorarAudio: estado.mejorarAudio });
        estado.hecho = { ...r, brutos: dondeEstanLosBrutos() };
        estado.paso = 'hecho';
        pintar();
        if (r.ok) avisar('Tu vídeo está listo.', 'ok');
    } catch (err) {
        estado.hecho = { ok: false, error: err.message, brutos: dondeEstanLosBrutos() };
        estado.paso = 'hecho';
        pintar();
    }
}

/**
 * Para que `app.js` sepa si puede dejar salir de la pantalla.
 *
 * Todo lo que hay entre apretar Grabar y tener el MP4 cuenta: irse a mitad de
 * la revisión dejaría la grabación entera sin cortar y sin nadie que lo diga.
 */
export function grabando() {
    return ['grabando', 'mirando', 'revisar', 'cortando'].includes(estado.paso);
}

/**
 * Dónde están la cámara, la pantalla y el audio tal como se grabaron.
 *
 * Se revela un archivo y no la carpeta del modo: `showItemInFolder` con una
 * carpeta abre la de arriba con esta señalada, que es justo lo que no sirve
 * cuando lo que se busca son los vídeos. Con un archivo adentro, el Finder
 * abre `xml/Video/` con él marcado.
 */
function dondeEstanLosBrutos() {
    return estado.brutos[0] || (app.ajustes.semanal && app.ajustes.semanal.carpeta) || null;
}
