/**
 * tarjetas.js — Lo que dice la pantalla semanal, en cada uno de sus momentos.
 *
 * Seis tarjetas —preparar, grabando, mirando, revisar, cortando, hecho— y los
 * trozos que comparten. Todas son lo mismo: reciben `estado` y devuelven HTML.
 * Ninguna abre un micrófono, ninguna llama a `pintar`, ninguna le pide nada al
 * motor. Eso vive en `pantalla-semanal.js`, que es quien hace que pasen cosas.
 *
 * **Por qué están acá y no allá.** Eran el 38 % de `pantalla-semanal.js`, y con
 * el editor del corte final ese archivo pasó de 484 a 1.559 líneas: ya no se
 * podía abrir y entender de qué iba. La costura estaba a la vista —cada
 * `tarjeta*` ya era una función pura de `estado` a texto, sin un solo efecto— y
 * cortar por donde ya estaba cortado dejó dos archivos que se leen de corrido:
 * acá qué se ve, allá qué pasa cuando se toca.
 *
 * **`estado` entra por la puerta.** Es el modelo de la pantalla y se pasa como
 * argumento, sin guardarlo en el módulo: así una tarjeta se puede dibujar en una
 * prueba con el estado que se quiera, y no hay forma de que dibujar deje algo
 * cambiado por detrás.
 *
 * Las decisiones del editor que no son HTML —qué toma sigue, cuánto mide cada
 * ficha, cuánto dura el montaje— están en `corte.js`, que no toca el DOM y sí
 * se prueba sola.
 */

import { esc } from '../chrome.js';
import { icono } from '../iconos.js';
import * as fmt from '../formato.js';
import * as fichas from '../grabar/lista-tomas.js';
import * as corte from './corte.js';
import { estiloDeVista } from '../colores.js';

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
export const VISTAS = [
    { nombre: 'R', titulo: 'Mi pantalla', dice: 'Tu pantalla, con tu cámara en la esquina' },
    { nombre: 'PV', titulo: 'Yo', dice: 'Tu cámara sola, llenando el cuadro' }
];

export const laVista = nombre => VISTAS.find(v => v.nombre === nombre) || VISTAS[0];

/**
 * La tecla de cada vista: la primera letra de su nombre en el motor.
 *
 * `R` y `P`, que son las mismas dos letras que en una clase. No se eligen acá
 * por eso mismo: quien usa los dos modos no tiene que aprender dos teclados, y
 * la letra sale del nombre y no de una tabla aparte que se pueda desincronizar.
 */
export const teclaDe = vista => vista.nombre[0];

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
export function escena(estado, vista) {
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

/**
 * La última grabación que hay en la carpeta, para volver a ella.
 *
 * Va ARRIBA de todo y no al pie, porque al abrir la app lo normal no es grabar
 * otro vídeo: es terminar el de ayer. Mirarlo, sacarle una toma que no iba,
 * volver a cortarlo. Antes eso no tenía puerta en ninguna pantalla y lo único
 * que quedaba era el Finder, donde lo que hay son cinco archivos sueltos y no
 * un proyecto.
 *
 * No es un botón primario: el primario de esta pantalla es Grabar, y sigue
 * siendo uno solo.
 *
 * Y es UNA línea, no una tarjeta con cabeza y cuerpo como las demás. La hice
 * así primero y a 840 px de alto empujaba Grabar abajo del borde: una pantalla
 * donde no se ve el botón de grabar es peor que una sin este atajo. Lo que se
 * perdió al apretarla —que se abre donde se dejó, que el vídeo ya exportado no
 * se pisa— está en el `title` del botón, que es donde se lee si hace falta.
 */
function tarjetaDeLaUltima(estado) {
    const u = estado.ultima;
    if (!u) return '';
    const cuantas = `${u.tomas} toma${u.tomas === 1 ? '' : 's'}`;
    const fuera = u.fuera ? ` (${u.fuera} fuera)` : '';
    const cuanto = u.segundos ? ` · ${esc(fmt.duracion(u.segundos))} grabados` : '';
    return `
      <div class="tarjeta semanal-ultima">
        <div class="campo-fila">
          ${icono('camara')}
          <span class="v2">Lo último que grabaste</span>
          <span class="v3 crece">${esc(fmt.cuando(u.cuandoMs))} · ${cuantas}${fuera}${cuanto}</span>
          <button class="btn" type="button" data-hace="abrir-ultima"
                  title="Vuelve al editor de esa grabación: qué toma va, qué se ve en cada una, y cortarla nueva. Se abre donde se dejó, y el vídeo que ya sacaste no se pisa.">
            Seguir con esa</button>
        </div>
      </div>`;
}

/** Antes de grabar: qué se va a grabar, y el botón. */
export function tarjetaListo(estado) {
    const puede = estado.audio.abierto && (estado.pantalla || estado.camara);
    return `
      ${tarjetaDeLaUltima(estado)}
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
              ${escena(estado, 'R')}
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
export function tarjetaGrabando(estado) {
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
            ${escena(estado, abierta ? (abierta.vista || estado.vista) : estado.vista)}
            <div class="crece">${elegirVista(estado, abierta)}</div>
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
          ${lasFichas(estado)}
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
export function lasFichas(estado) {
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
            cuerpo: t2 => cuerpoDeFicha(estado, t2)
        }))}</div>
        <span class="v3">Abrí una para corregirle dónde empieza o termina, cambiarle
          lo que se ve, o dejarla fuera del vídeo. También se puede al terminar.</span>
      </div>`;
}

export function cuerpoDeFicha(estado, t) {
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
          ${t.descartada ? '' : vistasDeFicha(estado, t)}
          <span class="crece"></span>
          ${botonFuera(t)}
        </div>`;
}

/** El texto de la toma, con sus dos bordes para arrastrar. */
export function textoDeFicha(t) {
    if (!t.palabras) {
        return '<p class="v3">Esta toma no tiene texto, así que sus bordes no se pueden mover acá.</p>';
    }
    return `
        <div data-texto="cerrada" data-toma="${t.id}"></div>
        <p class="v3 pista">Lo gris es lo que quedó fuera de la toma. Arrastrá el
          <b class="pista-in">IN</b> o el <b class="pista-out">OUT</b> hasta la palabra
          donde querés que empiece o termine.</p>`;
}

export function botonFuera(t) {
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
export function vistasDeFicha(estado, t, sale) {
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
export function elegirVista(estado, abierta) {
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

/** Mientras se sacan las fotos de cada toma: son unos segundos. */
export function tarjetaMirando() {
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
export function tarjetaRevisar(estado) {
    const todas = lasDeLaRevision(estado);
    const van = todas.filter(t => !t.descartada);
    const t = corte.laParada(todas, estado.ficha);
    return `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo revisar-fila">
          <div class="revisar-espejo" aria-hidden="true"></div>
          <div class="revisar-video">
            <div id="semanal-montaje" class="montaje-hueco"></div>
            ${barraDelMontaje(estado, todas, van)}
            ${lineaDeTomas(estado, todas)}
          </div>
          ${ladoDeExportar(estado, van)}
        </div>
      </div>
      ${t ? tarjetaDeLaToma(estado, t) : `
      <div class="tarjeta">
        <div class="tarjeta-cuerpo">
          <span class="v2">No queda ninguna toma en el vídeo. Volvé a meter alguna de las que
            dejaste fuera, o grabá otro.</span>
        </div>
      </div>`}`;
}

/**
 * Lo que hay que decidir antes de exportar, al lado del reproductor.
 *
 * Estaba debajo del todo, después del montaje, de la línea de tomas y de la
 * ficha de la toma, y en una ventana normal eso lo dejaba fuera de la
 * pantalla: había que hacer scroll para encontrar el botón que termina el
 * trabajo, sin nada que diera a entender que había algo más abajo.
 *
 * Acá al lado no hace falta robarle sitio a nada. El montaje es 16:9 con el
 * alto por techo, así que a partir de cierto ancho le sobra el espacio de los
 * costados; esta columna lo ocupa. Cuando la ventana se estrecha y ya no
 * caben los dos, la columna se va debajo sola (`.revisar-fila` envuelve).
 */
function ladoDeExportar(estado, van) {
    const comun = 'Se aplica al cortar, así que no se oye en el montaje de al lado. '
        + 'Si no te gusta cómo quedó, apagala y volvé a cortar.';
    return `
      <aside class="revisar-lado" aria-label="Antes de exportar">
        ${opcion('silencios', 'Quitar silencios', estado.silencios,
            `Los huecos de más de 0,7 s —cuando te quedás pensando o buscando algo— quedan `
            + `en 0,3.\n\n${comun}`)}
        ${opcion('mejorar-audio', 'Mejorar audio', estado.mejorarAudio,
            `Deja el vídeo al volumen de cualquier otro, empareja las tomas entre sí y le `
            + `quita el ruido de fondo a la sala.\n\n${comun}`)}
        <button class="btn btn-primario revisar-exportar" type="button" data-hace="exportar"
                ${van.length ? '' : 'disabled'}
                title="${van.length
                    ? 'Corta las tomas, las pega y deja el MP4 listo para subir'
                    : 'No queda ninguna toma: volvé a meter alguna o grabá otro'}">
          Exportar</button>
      </aside>`;
}

/**
 * Una opción de exportar: un botón que se queda apretado.
 *
 * Era una casilla con la explicación escrita debajo, y eran cuatro párrafos de
 * letra chica al lado del reproductor para dos decisiones que casi nadie
 * cambia. Las dos vienen encendidas y hacen lo que hay que hacerle a un vídeo:
 * de un vistazo se necesita saber si están puestas, no por qué. El porqué está
 * en el `title`, a un segundo de distancia.
 *
 * Y sin la cajita: puesta o no se dice con el color del botón entero, que se
 * ve de más lejos que un cuadradito de 24 px. `aria-pressed` es lo que lo
 * cuenta para quien no lo está mirando.
 */
function opcion(campo, rotulo, puesta, explica) {
    return `
      <button class="btn revisar-opcion" type="button" data-hace="opcion" data-campo="${campo}"
              aria-pressed="${Boolean(puesta)}" title="${esc(explica)}">
        ${esc(rotulo)}</button>`;
}

/** Reproducir, dónde va, y si se ven las que dejé fuera. */
export function barraDelMontaje(estado, todas, van) {
    const v = estado.enVivo || {};
    const fuera = todas.length - van.length;
    return `
      <div class="campo-fila montaje-barra">
        <button class="btn btn-primario" type="button" data-hace="reproducir"
                id="semanal-reproducir"></button>
        <time class="tc" id="semanal-montado">${esc(fmt.relojCorto(v.montado || 0))}</time>
        <span class="v3">de ${esc(fmt.relojCorto(v.total || 0))}</span>
        <span class="montaje-cuenta">
          <span class="v3">${van.length} toma${van.length === 1 ? '' : 's'} en el vídeo${
            fuera ? ` · ${fuera} fuera` : ''}</span>
          ${fuera ? `<button class="btn btn-tenue" type="button" data-hace="ocultar-fuera"
                aria-pressed="${Boolean(estado.ocultarFuera)}"
                title="${estado.ocultarFuera
                    ? 'Volver a ver las tomas que dejaste fuera, para poder recuperarlas'
                    : 'Deja de mostrar las que dejaste fuera: abajo queda solo el corte final'}">
            ${estado.ocultarFuera ? 'Ver las desactivadas' : 'Ocultar desactivadas'}</button>` : ''}
        </span>
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
export function lineaDeTomas(estado, todas) {
    const lista = estado.ocultarFuera ? todas.filter(t => !t.descartada) : todas;
    if (!lista.length) return '';
    const parada = corte.laParada(todas, estado.ficha);
    const total = lista.reduce((s, x) => s + corte.anchoDe(x), 0) || 1;
    return `
      <div class="linea-tomas" role="group" aria-label="Las tomas del vídeo">
        ${lista.map(x => `
          <button class="linea-toma" type="button" data-hace="parar-en" data-toma="${x.id}"
                  style="flex:${corte.anchoDe(x) / total};${estiloDeVista(estado.vistas, corte.vistaReal(x))}"
                  data-fuera="${x.descartada ? 'si' : 'no'}"
                  data-segundos="${x.segundos}"
                  aria-pressed="${Boolean(parada && parada.id === x.id)}"
                  title="Toma ${x.id} · ${fmt.duracion(x.segundos)}${
                      x.descartada ? ' · está fuera del vídeo' : ''}">
            <span class="linea-num">${x.id}</span>
            <span class="linea-aguja" hidden></span>
          </button>`).join('')}
      </div>`;
}

/** Lo que mide una toma en la línea. Una muy corta igual tiene que poder tocarse. */
/**
 * La toma de abajo: qué se ve en ella, su texto, y si va o no.
 *
 * El texto trae el antes y el después —lo que se dijo fuera de la toma, en
 * gris— porque es ahí donde se arregla un IN que entró tarde: la palabra con
 * la que uno quería empezar está justo antes del borde, y sin verla no hay
 * nada que arrastrar.
 */
export function tarjetaDeLaToma(estado, t) {
    const sale = corte.vistaReal(t);
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
            ${vistasDeFicha(estado, t, sale)}
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
export function lasDeLaRevision(estado) {
    return corte.conElTexto(
        (estado.montaje && estado.montaje.tomas) || [],
        (estado.grabada && estado.grabada.tomas) || []);
}

/** Mientras ffmpeg trabaja: lo único honesto es el tanto por ciento. */
export function tarjetaCortando(estado) {
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
export function tarjetaHecho(estado) {
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

export const megas = bytes => (Math.round((bytes || 0) / 1e5) / 10).toFixed(1);

export const nombreDelArchivo = ruta => String(ruta || '').split('/').pop();

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
export function urlDeArchivo(ruta) {
    try {
        return new URL(String(ruta || ''), location.href).href;
    } catch (e) {
        return '';
    }
}

export function opciones(nombres, puesto) {
    if (!nombres.length) return '<option value="">No encontré ninguna…</option>';
    return nombres.map(n =>
        `<option value="${esc(n)}"${n === puesto ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

/** Lo que va a durar el vídeo, en segundos: la suma de las tomas que quedan. */
export function cortado(tomas) {
    return tomas.reduce((s, t) => s + Math.max(0, (t.outMs || 0) - t.inMs), 0) / 1000;
}
