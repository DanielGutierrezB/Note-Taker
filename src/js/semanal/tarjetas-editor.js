/**
 * tarjetas-editor.js — Lo que dice la pantalla semanal después de grabar.
 *
 * Cuatro tarjetas —mirando, revisar, cortando, hecho— y los trozos del editor:
 * la barra del montaje, la línea de tomas y la ficha de cada una. Son lo mismo
 * que las de `tarjetas.js`: reciben `estado` y devuelven HTML, sin un efecto.
 *
 * Se separaron cuando `tarjetas.js` estaba por pasar las mil líneas, por la
 * costura que ya tenía: antes y durante la grabación allá, el editor acá. Lo
 * que usan las dos —la vista de una toma, su texto, sus estados, los números
 * de los archivos— vive allá y se importa de allá, en una sola dirección.
 */

import { esc } from '../chrome.js';
import { icono } from '../iconos.js';
import * as fmt from '../formato.js';
import * as fichas from '../grabar/lista-tomas.js';
import * as corte from './corte.js';
import { estiloDeVista } from '../colores.js';
import { laVista, textoDeFicha, estadosDe, vistasDeFicha, megas, nombreDelArchivo, urlDeArchivo, cortado } from './tarjetas.js';

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
      ${salidasDelEditor(estado)}
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
 * Las dos puertas del editor: para atrás, y a la carpeta.
 *
 * **Para atrás no había ninguna.** Al editor se entra por tres sitios —terminar
 * de grabar, «Seguir con esa» y «Ajustar y cortar de nuevo»— y de los tres se
 * salía exportando: arrepentirse de haber entrado no era un gesto que
 * existiera. Lo contó quien lo usa: «no me permite arrepentirme».
 *
 * El botón dice ADÓNDE vuelve y no «Atrás», porque no vuelve siempre al mismo
 * sitio: si hay un vídeo ya cortado, vuelve a él —es de donde se vino, y sigue
 * ahí sin que lo haya pisado nadie—, y si no, al panel de antes de grabar. Un
 * «Atrás» a secas obliga a apretarlo para saber qué hace.
 *
 * Y «Mostrar en Finder», que estaba solo al final: mientras se ajusta es
 * cuando hace falta mirar lo que hay en el disco —si la pantalla se grabó, si
 * el tramo nuevo está—, y no después de cortar.
 */
function salidasDelEditor(estado) {
    const hay = Boolean(estado.hecho && estado.hecho.ok);
    return `
      <div class="campo-fila" style="margin-bottom:12px">
        <button class="btn btn-tenue" type="button" data-hace="atras"
                title="${hay
        ? 'Vuelve al vídeo que ya cortaste, tal como quedó. Lo que ajustaste acá se mantiene.'
        : 'Vuelve a la pantalla de antes de grabar. La grabación queda en el disco y se '
            + 'puede volver a abrir con «Seguir con esa».'}">
          ${icono('volver')} ${hay ? 'Volver al vídeo' : 'Volver al panel'}</button>
        <span class="crece"></span>
        <button class="btn btn-tenue" type="button" data-hace="ver-brutos"
                title="Abre la carpeta donde está quedando todo: la cámara, la pantalla y el audio tal como se grabaron">
          ${icono('finder')} Mostrar en Finder</button>
      </div>`;
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
        <button class="btn" type="button" data-hace="dividir-aca" ${v.toma == null ? 'disabled' : ''}
                title="Parte la toma donde está la aguja, en la palabra que empieza ahí. La segunda mitad queda elegida abajo para cambiarle la vista">
          ${icono('dividir')} Dividir acá</button>
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
                : `Pediste «${esc(laVista(t.vista).titulo)}» y esa toma no lo tiene
                   grabado: sale con lo otro.`}</span>
            ${estadosDe(estado, t)}
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
