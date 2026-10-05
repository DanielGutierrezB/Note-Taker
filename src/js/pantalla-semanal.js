/**
 * pantalla-semanal.js — Grabarse explicando la semana, y salir con el vídeo.
 *
 * Es el modo simple, y simple quiere decir que no hay nada que decidir: se
 * aprieta Grabar, se habla abriendo cada toma con «3, 2, 1» y cerrándola con
 * «Pausa», se aprieta Terminar, y sale un MP4 con la pantalla de fondo y la
 * cámara en la esquina. Ni vistas, ni claquetas, ni XML, ni una lista de clases
 * que alguien tenga que entender.
 *
 * **Una pantalla con tres momentos y no tres pantallas.** Preparar, grabar y el
 * vídeo listo son el mismo sitio cambiando de tarjeta: así nadie se pierde, y
 * volver atrás es siempre lo mismo —otro vídeo— en vez de una navegación.
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
import * as fichas from './grabar/lista-tomas.js';
import * as montaje from './semanal/montaje.js';
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
    vista: 'R',              // la que va a llevar la toma siguiente
    vistaHasta: 0,           // hasta qué toma ya se le puso la vista elegida
    vistas: [],              // las del motor, con el color de su marcador
    json: null,              // el sidecar de lo que se acaba de grabar
    montaje: null,           // dónde cae cada toma en los dos vídeos crudos
    enVivo: null,            // dónde va el montaje: { toma, montado, total, … }
    ocultarFuera: false,     // si la línea de tomas esconde las desactivadas
    grabada: null,           // las tomas con su texto, para mover los bordes
    brutos: [],              // los vídeos tal como se grabaron, para poder verlos
    corte: { pct: 0 },
    silencios: false,        // la casilla de la revisión, que se aplica al cortar
    hecho: null,             // lo que devolvió el exportador
    avisos: []
};

/**
 * Las dos vistas de este modo, con los nombres que entiende el motor.
 *
 * `PV` y `R` no son nombres inventados acá: son las vistas del modo clase
 * (`VISTAS` en `engine/notas-vivo.js`), y el exportador decide qué se ve
 * mirando el mismo mapa vista→fuente que usa Premiere. Lo único propio de este
 * modo son los títulos, que hablan de quien se está grabando y no de un rodaje.
 *
 * Se arranca en «mi pantalla» porque es para lo que existe el modo: contar lo
 * que hiciste en la semana es enseñarlo. Quien quiera hablar a cámara lo elige,
 * y a partir de ahí se hereda, igual que en una clase.
 */
const VISTAS = [
    { nombre: 'R', titulo: 'Mi pantalla', dice: 'Tu pantalla, con tu cámara en la esquina' },
    { nombre: 'PV', titulo: 'Yo', dice: 'Tu cámara sola, llenando el cuadro' }
];

const laVista = nombre => VISTAS.find(v => v.nombre === nombre) || VISTAS[0];

/**
 * La tecla de cada vista: la primera letra de su nombre en el motor.
 *
 * `R` y `P`, que son las mismas dos letras que en una clase. No se eligen acá
 * por eso mismo: quien usa los dos modos no tiene que aprender dos teclados, y
 * la letra sale del nombre y no de una tabla aparte que se pueda desincronizar.
 */
const teclaDe = vista => vista.nombre[0];

export function conectar(contexto) {
    app = contexto;
    $('#semanal-cuerpo').addEventListener('click', alClic);
    $('#semanal-cuerpo').addEventListener('change', alCambio);
    document.addEventListener('keydown', alTeclado);
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
    if (grabando()) { pintar(); return; }
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
    pintar();
    await mirarQueHay();
    pintar();
}

export async function salir() {
    if (estado.paso === 'grabando') return;          // grabando no se sale
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
    pegarLaCamara();
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

const pegarLaCamara = () => pegar('#semanal-camara', ojo.elStream());
const pegarLaPantalla = () => pegar('#semanal-pantalla', filmar.laPantalla());

/**
 * La escena: cómo va a quedar la toma, montada con los dos vídeos de ahora.
 *
 * No es una vista previa de la cámara, es una vista previa del VÍDEO: la
 * pantalla de fondo y la cámara en la misma esquina y del mismo tamaño en que
 * el exportador la va a poner. Así se descubre que la cara tapa justo el botón
 * que se está explicando mientras todavía se puede mover la ventana, y no
 * después de exportar.
 *
 * Las proporciones salen de las constantes del exportador y están escritas en
 * el CSS como tantos por ciento (`CAMARA_LADO`/`ANCHO`, el redondeo sobre el
 * lado, y `MARGEN` sobre cada lado del cuadro). El `object-fit: cover` del
 * recuadro es el `crop` cuadrado y centrado que hace el exportador antes de
 * achicar. Que no se separen lo cuida una prueba, porque son dos sitios diciendo
 * el mismo número y no hay forma de que la ventana lea el módulo de Node.
 *
 * @param {string} vista `PV` (la cámara sola) o cualquier otra (la pantalla)
 */
function escena(vista) {
    // La cámara llena el cuadro cuando la toma es de profesor, y también
    // cuando no hay pantalla: es lo mismo que decide `repartir`.
    const llena = vista === 'PV' || !estado.pantalla;
    return `
      <div class="semanal-escena" role="img"
           aria-label="${llena
               ? 'Tu cámara llenando el cuadro'
               : 'Tu pantalla con tu cámara en la esquina de abajo a la derecha'}">
        ${llena
            ? '<video id="semanal-escena-camara" class="semanal-escena-llena" muted playsinline></video>'
            : `<video id="semanal-escena-fondo" class="semanal-escena-fondo" muted playsinline></video>
               <video id="semanal-escena-camara" class="semanal-escena-esquina" muted playsinline></video>`}
      </div>`;
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

/* ─── Los cuatro momentos ─────────────────────────────────────────────── */

function pintar() {
    $('#semanal-reloj').hidden = estado.paso !== 'grabando';
    $('#semanal-titulo').textContent = {
        listo: 'Tu vídeo de la semana',
        grabando: 'Grabando',
        mirando: 'Mirando lo que grabaste',
        revisar: 'Mirá tu vídeo y elegí qué va',
        cortando: 'Cortando el vídeo',
        hecho: 'Tu vídeo está listo'
    }[estado.paso];

    $('#semanal-cuerpo').innerHTML = {
        listo: tarjetaListo,
        grabando: tarjetaGrabando,
        mirando: tarjetaMirando,
        revisar: tarjetaRevisar,
        cortando: tarjetaCortando,
        hecho: tarjetaHecho
    }[estado.paso]();

    if (estado.paso === 'listo') { pegarLaCamara(); pegarLaPantalla(); pegarLaEscena(); }
    if (estado.paso === 'grabando') { pegarLaEscena(); montarTextos(); }
    if (estado.paso === 'revisar') { pegarElMontaje(); montarTextos(); }
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
    if (estado.montaje) montaje.poner(conUrls(estado.montaje));
    aguja(estado.enVivo);
}

/**
 * Las rutas del disco, hechas URL.
 *
 * La misma vuelta que `urlDeArchivo`: en la app la página es `file:` y las
 * rutas son del disco; en la maqueta son del servidor. Así el módulo del
 * montaje no tiene que saber en cuál de los dos está.
 */
function conUrls(m) {
    const a = m.archivos || {};
    return {
        ...m,
        archivos: {
            camara: a.camara ? urlDeArchivo(a.camara) : null,
            pantalla: a.pantalla ? urlDeArchivo(a.pantalla) : null
        }
    };
}

/**
 * Lo que dice el reproductor mientras corre, sesenta veces por segundo.
 *
 * Por eso casi nunca repinta: mover la aguja y el reloj es escribir dos
 * atributos, y repintar la pantalla entera a ese ritmo mataría el vídeo. Se
 * repinta solo cuando cambia la toma que suena, que es cada varios segundos, y
 * ahí sí hace falta: abajo tiene que aparecer la toma nueva con su texto.
 */
function alMontaje(info) {
    const cambioLaToma = !estado.enVivo || estado.enVivo.toma !== info.toma;
    const cambioElBoton = !estado.enVivo || estado.enVivo.reproduciendo !== info.reproduciendo;
    estado.enVivo = info;
    if (cambioLaToma && info.toma != null) {
        estado.ficha = info.toma;
        pintar();
        return;
    }
    if (cambioElBoton) { pintar(); return; }
    aguja(info);
}

/** La aguja y el reloj, escritos a mano para no repintar. */
function aguja(info) {
    if (!info) return;
    const reloj = $('#semanal-montado');
    if (reloj) reloj.textContent = fmt.relojCorto(info.montado || 0);
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
        if (nodo !== previo || nodo.parentNode !== hueco) hueco.replaceChildren(nodo);
        textosPuestos.set(clave, nodo);
        // Lo nuevo entra abajo, así que abajo es donde hay que mirar. En una
        // toma ya cerrada no: lo que se busca ahí es el principio.
        const rollo = cual === 'cerrada' ? null : nodo.querySelector('.transcript');
        if (rollo) rollo.scrollTop = rollo.scrollHeight;
    }
}

/**
 * Un texto, con lo que su borde hace al soltarse.
 *
 * Los tres son el mismo gesto —poner el borde en esta palabra— y cambia a qué
 * se le pide, que es lo mismo que decide `ponerBorde` en la pantalla de clase:
 *
 *   espera   no hay toma abierta: el IN soltado la ABRE desde esa palabra
 *   abierta  el OUT la CIERRA ahí
 *   cerrada  los dos corren su borde, con la toma ya grabada
 */
/** Las tomas con su texto: las de la sesión viva, o las de la ya grabada. */
function lasTomas() {
    if (estado.paso === 'revisar') return (estado.grabada && estado.grabada.tomas) || [];
    return (estado.sesion && estado.sesion.tomas) || [];
}

function unTexto(cual, toma, previo) {
    const tomas = lasTomas();
    const contesta = r => { if (r) { estado.sesion = r; pintar(); } };

    if (cual === 'espera') {
        const cerradas = tomas.filter(t => t.outMs != null);
        const desde = cerradas.length ? Math.max(...cerradas.map(t => t.outMs)) : -Infinity;
        return texto.textoDe({
            modo: 'inactiva',
            palabras: ((estado.sesion && estado.sesion.sueltas) || []).filter(w => w.t >= desde),
            vacio: 'Escuchando… lo que digas va a ir apareciendo acá.'
        }, (borde, ms) => window.nt.grabarAbrirToma(ms).then(contesta), previo);
    }

    if (cual === 'abierta') {
        const abierta = tomas.find(t => t.outMs == null);
        return texto.textoDe({
            modo: 'abierta',
            antes: [],
            limite: abierta ? abierta.inMs : 0,
            palabras: (abierta && abierta.palabras) || [],
            vacio: 'Todavía no se oyó nada de esta toma.'
        }, (borde, ms) => window.nt.grabarCerrarToma(ms).then(contesta), previo);
    }

    if (cual === 'cerrada' && toma) {
        return texto.textoDe({
            modo: 'cerrada',
            antes: toma.antes,
            palabras: toma.palabras,
            despues: toma.despues,
            vacio: 'Esta toma no tiene texto.'
        }, (borde, ms) => cambiarFicha(toma.id, { tipo: 'borde', borde, paredMs: ms }), previo);
    }

    return null;
}

/** Antes de grabar: qué se va a grabar, y el botón. */
function tarjetaListo() {
    const puede = estado.audio.abierto && (estado.pantalla || estado.camara);
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo semanal-campos">
          <div class="campo">
            <span class="rotulo">Tu cámara</span>
            <div class="campo-fila">
              <select class="camara-elige" data-campo="camara">
                ${opciones(estado.camaras.map(c => c.nombre), estado.camara && estado.camara.nombre)}
              </select>
              <video id="semanal-camara" class="camara-previa" muted playsinline></video>
            </div>
            <span class="v3">Va en la esquina de abajo a la derecha del vídeo, siempre.</span>
          </div>

          <div class="campo">
            <span class="rotulo">Tu voz</span>
            <div class="campo-fila">
              <select class="camara-elige" data-campo="micro">
                ${opciones(estado.entradas.filter(e => e.tipo !== 'app').map(e => e.nombre),
                    estado.micro && estado.micro.nombre)}
              </select>
              <div class="nivel" id="semanal-nivel"><div class="nivel-barra"></div></div>
            </div>
            <span class="v3">${estado.audio.abierto
                ? 'Decí algo: si la barra no se mueve, elegí otra entrada.'
                : esc(estado.audio.error || 'Sin micrófono no se puede grabar.')}</span>
          </div>

          <div class="campo">
            <span class="rotulo">Tu pantalla</span>
            <div class="campo-fila">
              <button class="btn" type="button" data-hace="elegir-pantalla"
                      title="Abre el selector de macOS para elegir qué pantalla o qué ventana se graba">
                ${estado.pantalla ? 'Elegir otra…' : 'Elegir pantalla…'}</button>
              ${estado.pantalla
                ? `<video id="semanal-pantalla" class="camara-previa semanal-pantalla-previa"
                          muted playsinline></video>
                   <span class="v2">${esc(estado.pantalla.nombre)}</span>`
                : '<span class="v2">Todavía no elegiste ninguna.</span>'}
            </div>
            <span class="v3">${estado.pantalla
                ? 'Es el fondo del vídeo. Si cambiás de ventana a mitad de la grabación, se graba el cambio.'
                : 'Sin pantalla, el vídeo sale con tu cámara a pantalla completa.'}</span>
          </div>

          <div class="campo">
            <span class="rotulo">Así va a quedar</span>
            <div class="campo-fila">
              ${escena('R')}
              <span class="v3 crece">Es el vídeo, no la cámara: tu pantalla de fondo y tu cara
                en la esquina, del tamaño y en el sitio en que van a salir. Si la cara tapa algo
                que vas a explicar, movelo ahora.</span>
            </div>
          </div>

          <div class="campo">
            <span class="rotulo">Cómo se graba</span>
            <span class="v2">Decí <b>«3, 2, 1»</b> y empezá a hablar: eso abre una toma.
              Decí <b>«Pausa»</b> para cerrarla. Lo que quede fuera de las tomas no sale en el
              vídeo, así que podés equivocarte, decir «Pausa» y volver a empezar con «3, 2, 1».
              Oír la voz tarda unos segundos, así que si preferís no esperar, <b>Enter</b> abre y
              cierra la toma en el acto.</span>
          </div>

          <div class="campo-fila" style="margin-top:8px">
            <span class="crece"></span>
            <button class="btn btn-primario" type="button" data-hace="grabar" ${puede ? '' : 'disabled'}
                    title="${puede
                        ? 'Empieza a grabar la cámara, la pantalla y tu voz'
                        : 'Falta el micrófono: sin él no se puede oír el «3, 2, 1»'}">
              Grabar</button>
          </div>
        </div>
      </div>`;
}

/**
 * Mientras graba: el reloj, el nivel, y si hay una toma abierta o no.
 *
 * El único botón primario de esta tarjeta es el borde de la toma, y «Terminar»
 * queda como un botón normal: mientras se graba, lo que hay que poder apretar
 * sin pensar y sin mirar es el borde. Terminar se aprieta una vez, al final, y
 * con los ojos en la pantalla.
 */
function tarjetaGrabando() {
    const abierta = (estado.sesion && estado.sesion.tomas || []).find(t => t.outMs == null);
    const cerradas = (estado.sesion && estado.sesion.tomas || []).filter(t => t.outMs != null && !t.descartada);
    return `
      <div class="tarjeta guarda" data-estado="${abierta ? 'abierta' : 'terminada'}">
        <div class="tarjeta-cabeza">
          <span class="pastilla" data-estado="${abierta ? 'abierta' : 'listo'}">
            ${abierta ? 'toma abierta' : 'esperando el «3, 2, 1»'}</span>
          <span class="crece"></span>
          <div class="nivel" id="semanal-nivel"><div class="nivel-barra"></div></div>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="contadores" style="margin-bottom:16px">
            <div class="contador"><span class="contador-num">${cerradas.length}</span>
              <span class="rotulo">toma${cerradas.length === 1 ? '' : 's'} grabada${cerradas.length === 1 ? '' : 's'}</span></div>
            <div class="contador"><span class="contador-num">${esc(fmt.relojCorto(cortado(cerradas)))}</span>
              <span class="rotulo">va a durar</span></div>
          </div>
          <span class="v2">${abierta
            ? 'Estás dentro de una toma: esto es lo que va a salir en el vídeo. Decí «Pausa» '
                + 'para cerrarla, o apretá Enter.'
            : 'Lo que digas ahora no sale en el vídeo. Decí «3, 2, 1» para abrir la toma siguiente, '
                + 'o apretá Enter.'}</span>
          <div class="campo-fila" style="margin-top:12px">
            <button class="btn btn-primario" type="button" data-hace="borde"
                    title="${abierta
                        ? 'Cierra la toma acá, sin esperar a que se oiga «Pausa». Tecla: Enter'
                        : 'Abre una toma acá, sin esperar a que se oiga «3, 2, 1». Si ya venías '
                            + 'hablando, el IN retrocede hasta donde arrancó la frase. Tecla: Enter'}">
              <kbd>⏎</kbd>${abierta ? 'Cerrar toma' : 'Abrir toma'}</button>
            <span class="v3 crece">La voz tarda unos segundos en oírse: desde que decís «1» hasta
              que la toma abre pasan unos tres. Con Enter el borde cae donde lo apretás.</span>
          </div>
          <div class="campo-fila" style="margin-top:16px; align-items:flex-start">
            ${escena(abierta ? (abierta.vista || estado.vista) : estado.vista)}
            <div class="crece">${elegirVista(abierta)}</div>
          </div>
          <div class="campo" style="margin-top:16px">
            <span class="rotulo">${abierta ? `Lo que va diciendo la toma ${abierta.id}`
                : 'Lo que se está oyendo'}</span>
            <div data-texto="${abierta ? 'abierta' : 'espera'}"
                 data-toma="${abierta ? abierta.id : ''}"></div>
            <span class="v3 pista">${abierta
                ? 'Arrastrá el <b class="pista-out">OUT</b> hasta la palabra donde querés que '
                    + 'termine la toma: eso la cierra ahí.'
                : 'Si arrancaste a hablar sin decir el conteo, arrastrá el <b class="pista-in">IN</b> '
                    + 'hasta la palabra donde empezaste: eso abre la toma desde ahí.'}</span>
          </div>
          ${lasFichas()}
          ${estado.avisos.length ? `<ul class="prproj-avisos v3" style="margin-top:12px">
            ${estado.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <div class="campo-fila" style="margin-top:16px">
            <span class="crece"></span>
            <button class="btn" type="button" data-hace="terminar"
                    title="Deja de grabar y te deja elegir qué toma va">Terminar</button>
          </div>
        </div>
      </div>`;
}

/**
 * Las tomas que ya quedaron, abajo, como en la toma de notas.
 *
 * Es la MISMA ficha que la de una clase (`grabar/lista-tomas.js`): la fila que
 * se lee de un vistazo y, al abrirla, el texto con el IN y el OUT. Lo pidió
 * quien graba su vídeo de la semana, y el motivo es el de siempre: una toma
 * que salió mal se nota al terminar de decirla, no al final de todo, y hasta
 * ahora había que acordarse hasta la revisión.
 *
 * Lo que no trae de la clase son las notas y los comentarios al XML: acá no
 * hay nadie editando en Premiere después, así que lo único que se hace con una
 * toma es moverle los bordes, elegir qué se ve y dejarla fuera.
 */
function lasFichas() {
    const tomas = (estado.sesion && estado.sesion.tomas) || [];
    if (!tomas.length) return '';
    const cero = (estado.sesion && estado.sesion.ceroMs) || 0;
    return `
      <div class="campo" style="margin-top:20px">
        <span class="rotulo">Las tomas que llevás</span>
        <div class="lista">${fichas.lista(tomas, t => ({
            sesion: estado.sesion,
            abierta: estado.ficha === t.id,
            vistas: estado.vistas,
            tc: toma => fmt.relojCorto(Math.max(0, toma.inMs - cero) / 1000),
            alAbrir: 'lo que dijiste, con el IN y el OUT para moverlos, y qué se ve',
            cuerpo: cuerpoDeFicha
        }))}</div>
        <span class="v3">Abrí una para corregirle dónde empieza o termina, cambiarle
          lo que se ve, o dejarla fuera del vídeo. También se puede al terminar.</span>
      </div>`;
}

function cuerpoDeFicha(t) {
    // La abierta se arregla arriba, donde está su texto creciendo: dos textos
    // movibles de la misma toma serían dos líneas de IN que se pisan.
    if (t.outMs == null) {
        return '<p class="v3">Es la toma de ahora: lo que va diciendo y su OUT están arriba.</p>';
    }
    // Mientras se graba, los dos botones de vista: todavía no hay fotos, los
    // vídeos están abiertos.
    return `
        ${textoDeFicha(t)}
        <div class="campo-fila" style="margin-top:8px">
          ${t.descartada ? '' : vistasDeFicha(t)}
          <span class="crece"></span>
          ${botonFuera(t)}
        </div>`;
}

/** El texto de la toma, con sus dos bordes para arrastrar. */
function textoDeFicha(t) {
    if (!t.palabras) {
        return '<p class="v3">Esta toma no tiene texto, así que sus bordes no se pueden mover acá.</p>';
    }
    return `
        <div data-texto="cerrada" data-toma="${t.id}"></div>
        <p class="v3 pista">Lo gris es lo que quedó fuera de la toma. Arrastrá el
          <b class="pista-in">IN</b> o el <b class="pista-out">OUT</b> hasta la palabra
          donde querés que empiece o termine.</p>`;
}

function botonFuera(t) {
    return `<button class="btn btn-tenue" type="button" data-hace="fuera" data-toma="${t.id}"
              data-usar="${t.descartada ? 'si' : 'no'}"
              title="${t.descartada
                  ? 'Volver a meter esta toma en el vídeo'
                  : 'Esta toma no sale en el vídeo. Se puede volver a meter'}">
        ${t.descartada ? 'Volver a usarla' : 'Dejarla fuera'}</button>`;
}

/**
 * Qué se ve en ESTA toma, ya grabada.
 *
 * Sin la tecla escrita, al revés que los de arriba: las teclas cambian la toma
 * de ahora o la que viene, nunca una de la lista. Una tecla dibujada en un
 * botón que esa tecla no aprieta es una promesa que no se cumple.
 */
function vistasDeFicha(t, sale) {
    // Lo marcado es lo que se VE, que no siempre es lo que se pidió: una toma
    // que pidió la cámara y no la tiene grabada sale con la pantalla, y marcar
    // la cámara sería decir que se ve algo que no se ve.
    const puesta = sale || t.vista;
    return `<span class="semanal-vistas" role="group" aria-label="Qué se ve en la toma ${t.id}">
      ${VISTAS.map(v => `
        <button class="btn btn-tenue btn-vista${puesta === v.nombre ? ' es-elegida' : ''}"
                type="button" data-hace="vista-ficha" data-toma="${t.id}" data-vista="${v.nombre}"
                style="${estiloDeVista(estado.vistas, v.nombre)}"
                aria-pressed="${puesta === v.nombre}"
                title="${esc(v.dice)}">${esc(v.titulo)}</button>`).join('')}
    </span>`;
}

/**
 * Qué se va a ver: la toma de ahora si hay una abierta, y si no la que viene.
 *
 * Está en la pantalla de grabar y no solo en la de revisar porque así es como
 * se trabaja de verdad: se dice «Pausa», se elige con qué se sigue y se arranca
 * la toma siguiente ya decidida. Al final se puede cambiar igual, mirando las
 * fotos, pero quien ya lo sabía mientras grababa no tiene que volver a pensarlo.
 */
function elegirVista(abierta) {
    return `
      <div class="campo">
        <span class="rotulo">${abierta ? 'En esta toma se ve' : 'En la toma siguiente se va a ver'}</span>
        <span class="semanal-vistas" role="group" aria-label="Qué se ve en la toma">
          ${VISTAS.map(v => `
            <button class="btn btn-tenue btn-vista${estado.vista === v.nombre ? ' es-elegida' : ''}"
                    type="button" data-hace="vista" data-vista="${v.nombre}"
                    style="${estiloDeVista(estado.vistas, v.nombre)}"
                    aria-pressed="${estado.vista === v.nombre}"
                    title="${esc(v.dice)}. Tecla: ${esc(teclaDe(v))}">
              <kbd>${esc(teclaDe(v))}</kbd>${esc(v.titulo)}</button>`).join('')}
        </span>
        <span class="v3">${esc(laVista(estado.vista).dice)}.${abierta
            ? ''
            : ' Elegilo ahora y la toma que abras con «3, 2, 1» ya sale así.'}</span>
      </div>`;
}

/**
 * Las dos teclas de este modo, y nada más.
 *
 * Quien graba su vídeo de la semana tiene las dos manos en lo que está
 * enseñando y la cara en la cámara: llegar al mouse para cambiar de vista es
 * justo el gesto que se ve en el vídeo. Las letras son las del motor (`R` y
 * `P`) y están escritas dentro de cada botón, así que la tecla y el clic hacen
 * lo mismo sin que haya que acordarse de cuál era.
 */
async function alTeclado(e) {
    if (!$('#vista-semanal').classList.contains('es-activa')) return;
    // Con Ajustes o Diagnóstico encima, el teclado es de ellos.
    if (document.querySelector('.telon.es-activa')) return;
    if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    // Donde se escribe, se escribe: una «p» en un campo es una letra.
    const foco = document.activeElement;
    if (foco && foco.matches('input, textarea, select, [contenteditable="true"]')) return;
    // Y sobre un botón con foco, Enter y espacio son del botón.
    if ((e.key === 'Enter' || e.key === ' ') && foco && foco.closest('button, a, [role="button"]')) return;

    // Enter es el borde de la toma, y solo grabando: es la tecla que no hay que
    // pensar, y por eso es la misma para abrir y para cerrar.
    if (e.key === 'Enter') {
        if (estado.paso !== 'grabando') return;
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

    // Y las vistas, solo donde la elección significa algo: antes de grabar fija
    // la primera toma, y grabando cambia la abierta o la que viene. En el editor
    // cada toma tiene la suya, y una tecla sola no sabría a cuál le toca.
    if (estado.paso !== 'listo' && estado.paso !== 'grabando') return;

    const v = VISTAS.find(x => teclaDe(x).toLowerCase() === e.key.toLowerCase());
    if (!v) return;
    e.preventDefault();
    return cambiarVista(v.nombre);
}

/** Mientras se sacan las fotos de cada toma: son unos segundos. */
function tarjetaMirando() {
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <span class="v2">Cerrando la grabación y leyendo las tomas, para poder montarlas.
            Un momento.</span>
        </div>
      </div>`;
}

/**
 * El editor del corte final: el montaje arriba, y abajo la toma donde estoy.
 *
 * Antes acá había una ficha por toma, todas desplegables, y el vídeo se veía
 * recién después de exportar. Estaba mal por dos motivos: para decidir si una
 * toma va hay que verla, no leerla; y si verla cuesta un corte entero, nadie
 * cambia nada. Así que ahora el vídeo está arriba desde el primer momento, y
 * es un montaje de trabajo armado en la ventana (`semanal/montaje.js`), no el
 * exportado: desactivar una toma o cambiarle la vista se ve en el acto.
 *
 * Y abajo una sola toma, la que se está mirando. Diez fichas abiertas a la vez
 * son diez cosas que decidir; una toma con su texto delante es una.
 */
function tarjetaRevisar() {
    const todas = lasDeLaRevision();
    const van = todas.filter(t => !t.descartada);
    const t = laParada(todas);
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <div id="semanal-montaje" class="montaje-hueco"></div>
          ${barraDelMontaje(todas, van)}
          ${lineaDeTomas(todas)}
        </div>
      </div>
      ${t ? tarjetaDeLaToma(t) : `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <span class="v2">No queda ninguna toma en el vídeo. Volvé a meter alguna de las que
            dejaste fuera, o grabá otro.</span>
        </div>
      </div>`}
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <div class="campo-fila" style="align-items:flex-start">
            <div>
              <label class="semanal-casilla">
                <input type="checkbox" data-campo="silencios" ${estado.silencios ? 'checked' : ''}>
                <span>Quitar silencios</span>
              </label>
              <p class="v3" style="margin:4px 0 0;max-width:52ch">Los huecos de más de 0,7 s
                —cuando te quedás pensando o buscando algo— quedan en 0,3. Esto no se ve en el
                montaje de arriba: se aplica al cortar. Si no te gusta cómo suena, destildala
                y volvé a cortar.</p>
            </div>
            <span class="crece"></span>
            <button class="btn btn-primario" type="button" data-hace="exportar" ${van.length ? '' : 'disabled'}
                    title="${van.length
                        ? 'Corta las tomas, las pega y deja el MP4 listo para subir'
                        : 'No queda ninguna toma: volvé a meter alguna o grabá otro'}">
              Exportar</button>
          </div>
        </div>
      </div>`;
}

/** Reproducir, dónde va, y si se ven las que dejé fuera. */
function barraDelMontaje(todas, van) {
    const v = estado.enVivo || {};
    const fuera = todas.length - van.length;
    return `
      <div class="campo-fila montaje-barra">
        <button class="btn btn-primario" type="button" data-hace="reproducir"
                title="${v.reproduciendo ? 'Pausa. Tecla: espacio' : 'Reproducir. Tecla: espacio'}">
          ${icono(v.reproduciendo ? 'pausa' : 'reproducir')}
          ${v.reproduciendo ? 'Pausa' : 'Reproducir'}</button>
        <time class="tc" id="semanal-montado">${esc(fmt.relojCorto(v.montado || 0))}</time>
        <span class="v3">de ${esc(fmt.relojCorto(v.total || 0))}</span>
        <span class="crece"></span>
        <span class="v3">${van.length} toma${van.length === 1 ? '' : 's'} en el vídeo${
            fuera ? ` · ${fuera} fuera` : ''}</span>
        ${fuera ? `<button class="btn btn-tenue" type="button" data-hace="ocultar-fuera"
                aria-pressed="${Boolean(estado.ocultarFuera)}"
                title="${estado.ocultarFuera
                    ? 'Volver a ver las tomas que dejaste fuera, para poder recuperarlas'
                    : 'Deja de mostrar las que dejaste fuera: abajo queda solo el corte final'}">
          ${estado.ocultarFuera ? 'Ver las desactivadas' : 'Ocultar desactivadas'}</button>` : ''}
      </div>`;
}

/**
 * La línea de tomas: el vídeo entero de un vistazo, y el sitio donde se elige.
 *
 * Cada toma es un trozo del ancho que le toca por lo que dura, así que la línea
 * es el vídeo a escala. Apretar un trozo se para en esa toma y la pone abajo;
 * mientras se reproduce, el trozo de la toma que suena se marca solo.
 *
 * Las dejadas fuera salen finitas y rayadas, y desaparecen con «Ocultar
 * desactivadas»: ahí la línea pasa a ser exactamente el corte que va a salir.
 */
function lineaDeTomas(todas) {
    const lista = estado.ocultarFuera ? todas.filter(t => !t.descartada) : todas;
    if (!lista.length) return '';
    const parada = laParada(todas);
    const total = lista.reduce((s, x) => s + anchoDe(x), 0) || 1;
    return `
      <div class="linea-tomas" role="group" aria-label="Las tomas del vídeo">
        ${lista.map(x => `
          <button class="linea-toma" type="button" data-hace="parar-en" data-toma="${x.id}"
                  style="flex:${anchoDe(x) / total};${estiloDeVista(estado.vistas, vistaReal(x))}"
                  data-fuera="${x.descartada ? 'si' : 'no'}"
                  aria-pressed="${Boolean(parada && parada.id === x.id)}"
                  title="Toma ${x.id} · ${fmt.duracion(x.segundos)}${
                      x.descartada ? ' · está fuera del vídeo' : ''}">
            <span class="linea-num">${x.id}</span>
            <span class="linea-aguja" hidden></span>
          </button>`).join('')}
      </div>`;
}

/** Lo que mide una toma en la línea. Una muy corta igual tiene que poder tocarse. */
function anchoDe(t) {
    return Math.max(2.5, t.descartada ? Math.min(t.segundos, 6) : t.segundos);
}

/** La toma que se está mirando: la elegida, o la primera que vaya al vídeo. */
function laParada(todas) {
    const lista = todas || lasDeLaRevision();
    return lista.find(t => t.id === estado.ficha)
        || lista.find(t => !t.descartada)
        || lista[0]
        || null;
}

/**
 * La toma de abajo: qué se ve en ella, su texto, y si va o no.
 *
 * El texto trae el antes y el después —lo que se dijo fuera de la toma, en
 * gris— porque es ahí donde se arregla un IN que entró tarde: la palabra con
 * la que uno quería empezar está justo antes del borde, y sin verla no hay
 * nada que arrastrar.
 */
function tarjetaDeLaToma(t) {
    const sale = vistaReal(t);
    return `
      <div class="tarjeta guarda" data-estado="${t.descartada ? 'descartada' : 'terminada'}">
        <div class="tarjeta-cabeza">
          <span class="v1">Toma ${t.id}</span>
          <span class="v3">${esc(fmt.duracion(t.segundos))}</span>
          <span class="crece"></span>
          <span class="pastilla" data-estado="${t.descartada ? 'descartada' : 'lista'}">
            ${t.descartada ? 'fuera del vídeo' : 'va en el vídeo'}</span>
        </div>
        <div class="tarjeta-cuerpo">
          <div class="campo-fila">
            ${vistasDeFicha(t, sale)}
            <span class="v3 crece">${sale === t.vista
                ? 'Lo que elijas se ve arriba en el acto.'
                : `Pediste ${esc(laVista(t.vista).titulo.toLowerCase())} y esa toma no lo tiene
                   grabado: sale con lo otro.`}</span>
            ${botonFuera(t)}
          </div>
          <div class="campo" style="margin-top:16px">
            <span class="rotulo">Lo que dijiste</span>
            ${textoDeFicha(t)}
          </div>
        </div>
      </div>`;
}

/**
 * Las tomas del editor, con el texto de cada una.
 *
 * Son dos fuentes y hacen falta las dos: `montaje` dice dónde cae cada toma en
 * los dos vídeos y cuánto dura ya con los bordes ajustados al silencio —eso lo
 * calcula el exportador, que es quien va a cortar— y `grabada` trae las
 * palabras, que es lo que deja editar a partir del texto. Si lo segundo no se
 * pudo leer, la toma se dibuja igual sin texto: elegir la vista y dejarla fuera
 * sigue andando.
 */
function lasDeLaRevision() {
    const conTexto = (estado.grabada && estado.grabada.tomas) || [];
    return (((estado.montaje && estado.montaje.tomas) || [])).map(t => {
        const texto = conTexto.find(x => x.id === t.id);
        return texto ? { ...texto, ...t, inMs: texto.inMs, outMs: texto.outMs } : t;
    });
}

/**
 * Lo que esa toma va a mostrar de verdad.
 *
 * No siempre es su vista: una fuente puede no cubrir una toma —la pantalla se
 * dejó de compartir a mitad, la cámara se cayó— y entonces el exportador usa
 * la otra. Acá no se recalcula: `fondo` ya es la respuesta, porque el montaje
 * sale del MISMO reparto que el export. Antes se adivinaba mirando si había
 * foto de cada fuente, que era una segunda verdad sobre lo mismo.
 */
function vistaReal(t) {
    if (!t.fondo) return t.vista;
    return t.fondo === 'camara' ? 'PV' : 'R';
}

/** Mientras ffmpeg trabaja: lo único honesto es el tanto por ciento. */
function tarjetaCortando() {
    const pct = Math.max(2, Math.round(estado.corte.pct || 0));
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <span class="v2">Cortando las tomas y poniendo tu cámara en la esquina. No cierres la app.</span>
          <div class="nivel" style="margin-top:16px">
            <div class="nivel-barra" style="width:${pct}%"></div>
          </div>
          <span class="v3" style="margin-top:8px">${pct} %</span>
        </div>
      </div>`;
}

/** Y el final: dónde está el vídeo. */
function tarjetaHecho() {
    const r = estado.hecho || {};
    if (!r.ok) {
        return `
          <div class="tarjeta guarda" data-estado="sin audio">
            <div class="tarjeta-cabeza">
              <span class="hp-ico" style="color:var(--error)">${icono('error')}</span>
              <span class="v1">No se pudo cortar el vídeo</span>
            </div>
            <div class="tarjeta-cuerpo">
              <span class="v2">${esc(r.error || 'No sé qué pasó.')}</span>
              <div class="campo-fila" style="margin-top:16px">
                <button class="btn" type="button" data-hace="ver-brutos"
                        title="Abre la carpeta con la cámara, la pantalla y el audio tal como se grabaron">
                  Mostrar lo que se grabó</button>
                <span class="crece"></span>
                <button class="btn btn-primario" type="button" data-hace="otro"
                        title="Volver a la pantalla de antes de grabar">Grabar otro</button>
              </div>
            </div>
          </div>`;
    }
    return `
      <div class="tarjeta guarda" data-estado="terminada">
        <div class="tarjeta-cabeza">
          <span class="hp-ico" style="color:var(--ok)">${icono('ok')}</span>
          <span class="v1">${esc(nombreDelArchivo(r.ruta))}</span>
          <span class="pastilla" data-estado="terminada">listo</span>
        </div>
        <div class="tarjeta-cuerpo">
          <video class="semanal-visor" controls preload="metadata"
                 src="${esc(urlDeArchivo(r.ruta))}#t=0.5"></video>
          ${estado.cortes > 1 ? `<span class="v3">Es el corte número ${estado.cortes}: el de antes
            quedó al lado, con su nombre, por si lo preferías.</span>` : ''}
          <div class="contadores" style="margin:16px 0">
            <div class="contador"><span class="contador-num">${r.tomas}</span>
              <span class="rotulo">toma${r.tomas === 1 ? '' : 's'}</span></div>
            <div class="contador"><span class="contador-num">${esc(fmt.relojCorto(r.segundos))}</span>
              <span class="rotulo">de vídeo</span></div>
            <div class="contador"><span class="contador-num">${megas(r.bytes)}</span>
              <span class="rotulo">MB</span></div>
          </div>
          ${(r.avisos || []).length ? `<ul class="prproj-avisos v3">
            ${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          <span class="v3">La cámara, la pantalla y el audio sin cortar quedaron en
            <code>xml/</code>, por si hay que rehacerlo.</span>
          <div class="campo-fila" style="margin-top:16px">
            <button class="btn btn-primario" type="button" data-hace="mostrar"
                    title="Abre el Finder con el vídeo seleccionado, listo para subirlo">
              ${icono('finder')} Mostrar en Finder</button>
            <button class="btn" type="button" data-hace="ajustar"
                    title="Volver a elegir qué se ve en cada toma y qué toma va, y cortarlo de nuevo">
              Ajustar y cortar de nuevo</button>
            <button class="btn btn-tenue" type="button" data-hace="abrir"
                    title="Abrirlo en el reproductor del Mac, a pantalla completa">Abrir aparte</button>
            <button class="btn btn-tenue" type="button" data-hace="ver-brutos"
                    title="Abre la carpeta con la cámara, la pantalla y el audio tal como se grabaron">
              Ver lo que se grabó</button>
            <span class="crece"></span>
            <button class="btn" type="button" data-hace="otro"
                    title="Volver a la pantalla de antes de grabar">Grabar otro</button>
          </div>
        </div>
      </div>`;
}

const megas = bytes => (Math.round((bytes || 0) / 1e5) / 10).toFixed(1);
const nombreDelArchivo = ruta => String(ruta || '').split('/').pop();

/**
 * La dirección con que el `<video>` puede abrir un archivo del disco.
 *
 * La ventana se carga con `loadFile`, o sea que su propia dirección es un
 * `file:`, y una ruta absoluta resuelta contra ella da el archivo: no hace
 * falta ni aflojar la política de contenido —`media-src 'self'` lo cubre,
 * medido— ni inventar un protocolo. `URL` además escapa los espacios y los
 * acentos, que en una carpeta de Descargas son la regla y no la excepción.
 *
 * Y resolver contra la página, en vez de pegar «file://» delante, es lo que
 * deja que la maqueta sirva su vídeo de ejemplo por http sin que este archivo
 * sepa que existe una maqueta.
 */
function urlDeArchivo(ruta) {
    try {
        return new URL(String(ruta || ''), location.href).href;
    } catch (e) {
        return '';
    }
}

function opciones(nombres, puesto) {
    if (!nombres.length) return '<option value="">No encontré ninguna…</option>';
    return nombres.map(n =>
        `<option value="${esc(n)}"${n === puesto ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

/** Lo que va a durar el vídeo, en segundos: la suma de las tomas que quedan. */
function cortado(tomas) {
    return tomas.reduce((s, t) => s + Math.max(0, (t.outMs || 0) - t.inMs), 0) / 1000;
}

/* ─── Los gestos ──────────────────────────────────────────────────────── */

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
    // La casilla no repinta: se mira al cortar, y repintar le sacaría el foco
    // justo al elemento que se acaba de tocar.
    if (campo === 'silencios') estado.silencios = e.target.checked;
}

async function alClic(e) {
    const boton = e.target.closest('[data-hace]');
    if (!boton || boton.disabled) return;
    const hace = boton.dataset.hace;

    if (hace === 'elegir-pantalla') {
        const r = await filmar.elegirPantalla();
        if (!r.ok) {
            if (r.error) avisar(r.error, 'error');
            return;
        }
        estado.pantalla = { nombre: r.nombre, ancho: r.ancho, alto: r.alto };
        pintar();
        return;
    }
    if (hace === 'vista') return cambiarVista(boton.dataset.vista);
    if (hace === 'borde') return bordeDeToma();
    if (hace === 'plegar') return plegar(Number(boton.dataset.toma));
    if (hace === 'vista-ficha') return cambiarFicha(Number(boton.dataset.toma),
        { tipo: 'vista', vista: boton.dataset.vista });
    if (hace === 'fuera') return cambiarFicha(Number(boton.dataset.toma),
        { tipo: 'descartar', descartada: boton.dataset.usar === 'no' });
    if (hace === 'reproducir') { montaje.alternar(); return undefined; }
    if (hace === 'parar-en') return pararEn(Number(boton.dataset.toma));
    if (hace === 'ocultar-fuera') {
        estado.ocultarFuera = !estado.ocultarFuera;
        pintar();
        return undefined;
    }
    if (hace === 'grabar') return grabar(boton);
    if (hace === 'terminar') return terminar(boton);
    if (hace === 'exportar') return exportar(boton);
    if (hace === 'ajustar') return ajustar();
    if (hace === 'mostrar') return window.nt.reveal(estado.hecho.ruta);
    if (hace === 'abrir') return window.nt.openPath(estado.hecho.ruta);
    if (hace === 'ver-brutos') return window.nt.reveal(dondeEstanLosBrutos());
    if (hace === 'otro') return ver();
    return undefined;
}

/**
 * Abrir y cerrar una ficha, en acordeón: una sola a la vez.
 *
 * Con la grabación corriendo, lo que se busca en la lista es una toma
 * concreta; con varias desplegadas hay que scrollear para encontrarla, y el
 * nombre y el momento alcanzan para elegir. Es la misma regla que en clase.
 */
/**
 * Pararse en una toma de la línea: abajo aparece ella, y el vídeo salta a su
 * principio.
 *
 * Y si estaba reproduciendo, sigue reproduciendo desde ahí. Clicar una toma es
 * decir «mostrame esta», no «pará»: tener que apretar play otra vez después de
 * cada clic es lo que hace que revisar sea un trámite.
 */
function pararEn(id) {
    const iba = montaje.reproduciendo();
    estado.ficha = id;
    montaje.irA(id, { reproducir: iba });
    pintar();
}

function plegar(id) {
    estado.ficha = estado.ficha === id ? null : id;
    pintar();
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
    // cambia a qué toma se salta. Volver a pedirlo es leer el sidecar y hacer
    // restas —no se toca ffmpeg—, así que se puede hacer con cada clic.
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
    estado.montaje = m;
    for (const a of m.avisos || []) avisar(a, 'aviso');
    return true;
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
        const abierta = (estado.sesion && estado.sesion.tomas || []).find(t => t.outMs == null);
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
 * Cambiar qué se ve, mientras se graba.
 *
 * Si hay una toma abierta, es esa la que cambia: quien lo aprieta a mitad de
 * una toma está corrigiendo la que tiene delante. Si no hay ninguna, queda
 * elegido para la siguiente, que es el gesto que se pidió.
 */
async function cambiarVista(nombre) {
    if (!VISTAS.some(v => v.nombre === nombre)) return;
    estado.vista = nombre;
    const abierta = (estado.sesion && estado.sesion.tomas || []).find(t => t.outMs == null);
    if (abierta) {
        const r = await window.nt.grabarEditar({ tipo: 'vista', toma: abierta.id, vista: nombre });
        if (r) estado.sesion = r;
    }
    pintar();
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
        .join('|');
    if (ahora !== estado.ultimo) {
        estado.ultimo = ahora;
        pintar();
        return;
    }
    // El transcript sí cada segundo: es lo único que cambia mientras se habla,
    // y crece sin rehacerse. Salvo con una línea agarrada, que desaparecería
    // de debajo del cursor justo mientras se busca dónde cortar.
    if (!texto.arrastrando()) montarTextos();
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
        estado.json = salida.archivos.json;

        const m = await window.nt.semanalMontaje(estado.json);
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
        estado.montaje = m;
        for (const a of m.avisos || []) avisar(a, 'aviso');
        // Y el texto de cada toma, que es con lo que se edita: el montaje dice
        // qué se ve y las palabras dicen dónde empieza y dónde termina. Si no
        // se pudiera leer, el editor sigue andando sin texto antes que no haber
        // editor.
        const grabada = await window.nt.grabarAbrirGrabada(estado.json);
        estado.grabada = grabada && grabada.ok ? grabada.estado : null;
        estado.ficha = null;
        estado.enVivo = null;
        estado.paso = 'revisar';
        pintar();
    } catch (err) {
        estado.hecho = { ok: false, error: err.message, brutos: dondeEstanLosBrutos() };
        estado.paso = 'hecho';
        pintar();
    }
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
            { quitarSilencios: estado.silencios });
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
