/**
 * El montaje que se mira mientras se elige el corte final.
 *
 * No es el exportado. Exportar tarda, y tardar entre cada decisión era lo que
 * hacía que nadie cambiara nada: se miraba el vídeo ya hecho, se veía que una
 * toma no iba, y volver atrás costaba otro corte entero. Acá el vídeo se arma
 * en la ventana con los dos crudos y aritmética, así que dejar fuera una toma,
 * cambiarle la vista o moverle un borde se ve en el acto.
 *
 * **Dos `<video>` y nada más.** Uno para la pantalla y otro para la cámara, los
 * dos apuntados a los archivos crudos. En cada toma se busca el segundo que
 * dijo el motor (`semanal-montaje`, que lo saca del MISMO reparto que hace el
 * export), se muestra entera la que va de fondo y, si la toma lleva recuadro, la
 * cámara va a la esquina con el lado, el margen y el redondeo que le va a dar
 * ffmpeg. Al llegar al final de la toma se salta a la siguiente que quede. El
 * salto se nota —hay un parpadeo mientras busca— y está bien que se note: es un
 * montaje de trabajo, no el entregable.
 *
 * El que lleva el reloj es el que tiene el audio, que es la cámara. Al otro se
 * lo sigue y se lo corrige si se separa.
 *
 * **Y no se mantienen juntos solos.** Esta cabecera decía que sí, porque los
 * dos archivos arrancan en el mismo instante del reloj de pared —cierto: 1 ms
 * de diferencia, medido en el diario—. Pero lo que los separa no es el
 * arranque de la grabación sino el de la reproducción: son dos `play()`
 * sueltos, y el de la cámara tarda más en dar el primer fotograma porque además
 * trae el sonido. Esa distancia se abre en ese instante y se queda. Medido con
 * `tools/medir-sincronia.js` sobre una grabación de verdad: el sonido iba 108 ms
 * detrás de la imagen, de media, durante toda la reproducción.
 */

import * as corte from './corte.js';

/* Los umbrales y el cálculo de la corrección viven en `corte.js`: son una
 * decisión con un número de entrada y dos de salida, así que se prueban sin
 * navegador. Ahí está también de dónde salen (EBU R37, ITU-R BT.1359) y por qué
 * se estira en vez de buscar.
 *
 * El que estaba acá valía 0,25 s, que es el doble de lo que se oye. Y como los
 * dos `<video>` arrancan con dos `play()` sueltos y el de la cámara tarda más
 * en dar el primer fotograma —trae el sonido además de la imagen— la distancia
 * que se abría en ese instante se quedaba ahí toda la reproducción, por debajo
 * del umbral y sin corregirse nunca: 108 ms de media medidos con
 * `tools/medir-sincronia.js` sobre una grabación de verdad, y CERO correcciones
 * en 10 s. Ahora, 12 ms de media y 20 de pico.
 */

/** Cada cuánto se mira dónde va. `timeupdate` llega cada 250 ms y es poco. */
const CADA_MS = 60;

/** El margen con que se da por terminada una toma, en segundos. */
const AL_FILO = 0.02;

let caja = null;
let elCam = null;
let elPan = null;
let plan = [];
let archivos = { camara: null, pantalla: null };
// La esquina donde va la cámara, cuando el motor la manda.
//
// Arranca en nada a propósito. Tenía por defecto `{lado: 0.1875, margen: 0.025,
// redondeo: 0.125}`, que son 360/1920, 48/1920 y 45/360: los tres números del
// exportador, copiados dentro del módulo al que se le mandan POR IPC justamente
// para no copiarlos. Y como solo se usaban cuando el plan venía sin ellos,
// quedarse viejos no se notaba nunca.
let recuadro = null;
let donde = -1;
let sola = false;
let tictac = null;
let avisar = null;
let planPuesto = null;
// Cuál de los pedazos de pantalla está puesto en `elPan`, para la toma de
// ahora. `-1` es «ninguno todavía», y las tomas normales —un archivo y nada
// más— no lo usan nunca.
let piezaPuesta = -1;

/**
 * Pone los dos vídeos dentro de un elemento, una sola vez.
 *
 * Viven fuera del repintado de la pantalla: si se volvieran a escribir con el
 * resto del HTML, cada cambio de vista los dejaría en negro y buscando de
 * nuevo, que es justo lo que este módulo existe para evitar.
 */
export function montar(hueco, alCambio) {
    avisar = alCambio || avisar;
    if (!caja) {
        caja = document.createElement('div');
        caja.className = 'montaje';
        elPan = document.createElement('video');
        elCam = document.createElement('video');
        for (const v of [elPan, elCam]) {
            v.playsInline = true;
            v.preload = 'auto';
            v.muted = true;
            caja.append(v);
        }
        elPan.className = 'montaje-pan';
        elCam.className = 'montaje-cam';
    }
    // Se MUEVE al hueco nuevo, no se vuelve a hacer: mover un nodo no recarga
    // el vídeo, y rehacerlo lo dejaría en negro y buscando con cada repintado.
    if (caja.parentNode !== hueco) hueco.replaceChildren(caja);
    return caja;
}

/**
 * El plan: qué toma va, y dónde cae en cada uno de los dos archivos.
 *
 * Se vuelve a llamar con cada cambio —un borde movido, una vista, un descarte—
 * y se queda en la toma donde estaba si sigue existiendo. Mantener el sitio
 * importa más de lo que parece: mover un OUT es mirarlo, moverlo otra vez y
 * volver a mirarlo, y que el vídeo salte al principio en cada intento hace el
 * trabajo imposible.
 *
 * @param {object} m lo que contesta `semanal-montaje`, con las rutas ya hechas
 *   URL por quien lo llama (en la app son `file:` y en la maqueta `http:`)
 */
export function poner(m) {
    // Si es el MISMO plan, no se toca nada. Hace falta decirlo porque la
    // pantalla llama acá en cada repintado —es la forma de que los dos `<video>`
    // sobrevivan al `innerHTML`— y volver a buscar el principio de la toma en
    // cada uno dejaba el reloj clavado en cero.
    //
    // «El mismo» es el mismo objeto, y alcanza porque el plan solo cambia
    // cuando el motor contesta otro: la pantalla lo guarda tal cual lo recibe y
    // nunca lo edita en el sitio. Antes esto comparaba una huella de siete
    // campos por toma, que era tanta máquina como hacía falta mientras la
    // pantalla fabricaba una copia nueva en cada pintado.
    if (m === planPuesto) return;
    planPuesto = m;

    const antes = laDeAhora();
    const iba = reproduciendo();
    plan = (m.tomas || []).map(t => ({ ...t }));
    archivos = m.archivos || archivos;
    recuadro = m.recuadro || null;
    apuntar(elCam, archivos.camara);
    // La pantalla la vuelve a apuntar cada toma, con el tramo que le toca. Esto
    // no sobra: es de lo que vive un plan sin `pantallaRuta` por toma —uno de
    // antes de que la pantalla pudiera partirse, o el de la maqueta—, donde
    // `buscar` no tiene a dónde apuntar y se queda con este.
    apuntar(elPan, archivos.pantalla);
    const sigue = antes ? plan.findIndex(t => t.id === antes.id) : -1;
    irAlIndice(sigue === -1 ? corte.primera(plan) : sigue, { reproducir: iba });
}

/**
 * Apunta un `<video>` a un archivo. Devuelve si lo cambió.
 *
 * Importa quién lo cambió y cuándo, porque un `src` nuevo tira los metadatos:
 * el `currentTime` que se ponga en el mismo turno se pierde, y hay que esperar
 * a `loadedmetadata`. Lo necesita la pantalla, que puede ser varios tramos.
 */
function apuntar(v, ruta) {
    if (!v || !ruta || v.dataset.ruta === ruta) return false;
    v.dataset.ruta = ruta;
    v.src = ruta;
    return true;
}

function laDeAhora() {
    return donde >= 0 && donde < plan.length ? plan[donde] : null;
}

export function reproduciendo() {
    return Boolean(elCam && plan.length && !elMaestro(laDeAhora())?.paused);
}

/**
 * Pararse en una toma.
 *
 * Una dejada fuera se reproduce SOLA: al terminar no sigue con la que viene. Es
 * lo que hace falta para decidir —oírla una vez antes de dejarla fuera para
 * siempre— sin que escucharla la devuelva al corte.
 */
export function irA(id, opciones) {
    const i = plan.findIndex(t => t.id === id);
    if (i === -1) return;
    irAlIndice(i, opciones || {});
}

function irAlIndice(i, o) {
    donde = i;
    // De toma nueva, pedazo por averiguar: `buscar` lo decide enseguida y así
    // nunca se arrastra el de la toma anterior.
    piezaPuesta = -1;
    const t = laDeAhora();
    sola = Boolean(t && t.descartada);
    acomodar(t);
    buscar(t, o.segundos);
    if (o.reproducir) arrancar();
    else decir();
}

export function alternar() {
    if (reproduciendo()) pausar();
    else arrancar();
}

function arrancar() {
    let t = laDeAhora();
    if (!t) return;
    // Al final de todo, volver al principio en vez de no hacer nada: apretar
    // play y que no pase nada no se distingue de que esté roto.
    if (!sola && corte.laQueSigue(plan, donde) === -1 && dentroDe(t) >= t.segundos - 0.05) {
        irAlIndice(corte.primera(plan), {});
        t = laDeAhora();
        if (!t) return;
    }
    // **La pantalla arranca primero, y el orden importa.** Probé el otro —el que
    // suena primero, que parecía lo razonable porque es el que no se puede
    // corregir después sin que se oiga— y salió mucho peor: 251 ms de desfase
    // medio contra 30, con 94 saltos en 10 s. La pantalla es la lenta de las
    // dos: entra a 1080p con intervalos de keyframe largos, tarda en arrancar y
    // tarda en rearmar después de cada búsqueda. Arrancándola segunda se
    // quedaba tan atrás que había que buscarla, y cada búsqueda la dejaba otra
    // vez atrás. La ventaja de salida es lo que la mantiene a tiro.
    for (const v of [elPan, elCam]) {
        if (v && v.dataset.ruta && v.style.display !== 'none') v.play().catch(() => {});
    }
    if (!tictac) tictac = setInterval(mirar, CADA_MS);
    decir();
}

export function pausar() {
    for (const v of [elPan, elCam]) if (v) v.pause();
    aVelocidadNormal();
    if (tictac) clearInterval(tictac);
    tictac = null;
    decir();
}

/** El que lleva el tiempo: el del audio si lo hay, y si no el del fondo. */
function elMaestro(t) {
    if (!t) return null;
    if (t.conAudio && t.camaraDesde != null) return elCam;
    // **Con la pantalla en pedazos manda la cámara aunque no suene.** Un pedazo
    // nuevo es un `src` nuevo, y un `src` nuevo pone el reloj del elemento en
    // cero: si el reloj de la toma saliera de ahí, cada cambio de ventana la
    // haría saltar al principio. La cámara no se parte nunca, así que mide.
    if (t.pantallaPartes && t.camaraDesde != null) return elCam;
    return t.fondo === 'camara' ? elCam : elPan;
}

/** El pedazo de pantalla que está puesto, si la toma va por pedazos. */
function laPieza(t) {
    return t && t.pantallaPartes ? t.pantallaPartes[piezaPuesta] || null : null;
}

/** Si lo que toca ahora mismo es el relevo en negro de un cambio de ventana. */
function enElNegro(t) {
    const p = laPieza(t);
    return Boolean(p && p.negro);
}

/**
 * En qué segundo de SU archivo cae un instante de la toma, para cada `<video>`.
 *
 * La única traducción entre el reloj de la toma y el de un archivo, y por eso
 * está en un sitio: la usan buscar, el tic que los mantiene juntos y el clavado
 * del final, y cuando cada una hacía su cuenta la pantalla en pedazos habría
 * necesitado el arreglo en las tres.
 */
function enSuArchivo(t, v, dentro) {
    if (v === elCam) return (t.camaraDesde || 0) + dentro;
    const p = laPieza(t);
    // El pedazo empieza en `enLaToma` y, dentro de su archivo, en `desdeSec`.
    return p ? p.desdeSec + (dentro - p.enLaToma) : (t.pantallaDesde || 0) + dentro;
}

/** En qué segundo de su archivo empieza la toma, para el que lleva el tiempo. */
function arranqueDe(t) {
    return enSuArchivo(t, elMaestro(t), 0);
}

/** Cuánto se lleva reproducido de la toma de ahora. */
function dentroDe(t) {
    const m = elMaestro(t);
    if (!m || !t) return 0;
    return Math.max(0, m.currentTime - arranqueDe(t));
}

/**
 * Ponerse en un punto de una toma. Sin `segundos`, en su principio.
 *
 * Los dos vídeos se mueven el mismo rato y no cada uno al suyo: están en
 * archivos distintos que empiezan en instantes distintos, y lo que los ata es
 * que ese rato sea el mismo para los dos.
 */
function buscar(t, segundos) {
    if (!t) return;
    // Sin esto, el estirón de la toma anterior sigue puesto en la siguiente y
    // el vídeo arranca un 8 % rápido hasta que el tic lo note.
    aVelocidadNormal();
    // Nunca al filo mismo del final: ahí el tic da la toma por terminada y
    // salta a la siguiente, que no es donde se hizo clic.
    const dentro = Math.max(0, Math.min(Number(segundos) || 0, t.segundos - AL_FILO * 2));
    if (elCam && elCam.dataset.ruta && t.camaraDesde != null) {
        elCam.currentTime = enSuArchivo(t, elCam, dentro);
    }
    if (elPan && t.pantallaDesde != null) verPieza(t, dentro);
}

/**
 * Cuál de los pedazos de pantalla toca en este segundo de la toma.
 *
 * Solo las tomas que cambiaron de ventana por el medio tienen pedazos; las
 * demás devuelven `-1` y siguen por el camino de siempre, que es una ruta y un
 * `currentTime`.
 */
function piezaPara(t, dentro) {
    const ps = t.pantallaPartes;
    if (!ps || !ps.length) return -1;
    let i = ps.findIndex(p => dentro < p.enLaToma + p.segundos);
    if (i === -1) i = ps.length - 1;
    // **Sin cámara, el reloj lo lleva la pantalla, y un pedazo en negro no
    // tiene reloj que llevar.** Así que ahí el relevo se salta y se pasa
    // directo a la ventana nueva. El vídeo exportado SÍ trae el negro: es la
    // única cosa en la que esta vista previa no es lo que va a salir, y son las
    // décimas que tarda el relevo. Con cámara —lo normal— no pasa: manda ella y
    // el negro se ve igual que en el vídeo.
    if (elMaestro(t) === elPan) {
        while (i < ps.length - 1 && ps[i].negro) i++;
    }
    return i;
}

/**
 * Pone en `elPan` el pedazo que toca, y lo apaga si el que toca es el negro.
 *
 * Un `src` nuevo tira los metadatos, así que el reloj se pone cuando llegan:
 * puesto en el mismo turno se perdía y el archivo arrancaba de cero.
 */
function verPieza(t, dentro) {
    // En una local y no `elPan`: irse de la pantalla lo pone en `null`, y el
    // oyente de los metadatos puede llegar después.
    const pan = elPan;
    const i = piezaPara(t, dentro);
    piezaPuesta = i;

    // Sin pedazos, la toma entera sale de un archivo: es el caso de siempre.
    const p = i === -1 ? { ruta: t.pantallaRuta, desdeSec: t.pantallaDesde, enLaToma: 0 } : t.pantallaPartes[i];
    if (p.negro) {
        // Se apaga y se para. Dejarlo corriendo escondido lo llevaría más allá
        // del final de su archivo, y el que vuelve después del relevo es otro.
        pan.style.display = 'none';
        pan.playbackRate = 1;
        pan.pause();
        return;
    }
    pan.style.display = seVe(t) ? '' : 'none';
    const seg = enSuArchivo(t, pan, dentro);
    if (apuntar(pan, p.ruta)) {
        pan.addEventListener('loadedmetadata', () => { pan.currentTime = seg; }, { once: true });
    } else if (pan.dataset.ruta) {
        pan.currentTime = seg;
    }
}

/** El tic: ¿sigue dentro de la toma, y siguen juntos los dos vídeos? */
function mirar() {
    const t = laDeAhora();
    const m = elMaestro(t);
    if (!t || !m) return;
    if (dentroDe(t) >= t.segundos - AL_FILO) {
        const sigue = sola ? -1 : corte.laQueSigue(plan, donde);
        if (sigue === -1) {
            pausar();
            // Clavado en el final y no pasado de largo: si el elemento se queda
            // corriendo, el siguiente play arranca dentro de la toma de al lado.
            m.currentTime = enSuArchivo(t, m, Math.max(0, t.segundos - AL_FILO * 2));
            decir();
            return;
        }
        irAlIndice(sigue, { reproducir: true });
        return;
    }
    // El relevo de un cambio de ventana, si lo hay: entra el negro y después la
    // ventana nueva, sin salir de la toma. Se mira acá y no con un temporizador
    // porque el que manda es el reloj de la toma, no el de pared: moverle el
    // borde o arrastrar la aguja tiene que caer en el pedazo que corresponde.
    const dentro = dentroDe(t);
    if (t.pantallaPartes && piezaPara(t, dentro) !== piezaPuesta) {
        verPieza(t, dentro);
        if (reproduciendo() && elPan.dataset.ruta) elPan.play().catch(() => {});
    }
    // Y los dos juntos. Solo hace falta cuando los dos se ven a la vez —la toma
    // con recuadro—: si el otro está escondido, que se separe no se nota y
    // buscarlo cada tanto sí se nota. En el relevo en negro no hay nada que
    // juntar: el fondo no está en ningún archivo, así que preguntar por su
    // posición daba `NaN` y el `NaN` terminaba en `playbackRate`.
    if (hayRecuadro(t) && elCam.dataset.ruta && elPan.dataset.ruta && !enElNegro(t)) juntarlos(t, m);
    decir();
}

/**
 * Que se oiga donde se ve: el que suena manda y al mudo se lo acomoda.
 *
 * **Al mudo, nunca al que suena.** Esto corregía el de la cámara, que es el que
 * trae el sonido y el que lleva el reloj —lo contrario de lo que decía la
 * cabecera de este archivo—. Mover el que suena es un chasquido y, además, le
 * cambia el tiempo al que mide dónde va la toma, así que una corrección movía
 * también la línea de tiempo y el final de la toma.
 *
 * Y se corrige estirando, no buscando. Un `currentTime` deja el vídeo en negro
 * mientras rearma, y hacerlo cada 60 ms para perseguir 100 ms de diferencia se
 * ve mucho peor que la diferencia. Un 8 % de velocidad sobre un vídeo sin
 * sonido no se nota y arregla 100 ms en poco más de un segundo. Buscar queda
 * para lo que no se alcanza estirando.
 */
function juntarlos(t, maestro) {
    const esclavo = maestro === elCam ? elPan : elCam;
    const deberia = enSuArchivo(t, esclavo, dentroDe(t));
    const que = corte.comoAlcanzar(esclavo.currentTime - deberia);
    if (que.buscar) esclavo.currentTime = deberia;
    esclavo.playbackRate = que.velocidad;
}

/** Los dos a velocidad normal: al cambiar de toma y al parar. */
function aVelocidadNormal() {
    for (const v of [elPan, elCam]) if (v) v.playbackRate = 1;
}

/**
 * Si la pantalla se ve en esta toma. En el relevo de un cambio de ventana se
 * apaga aparte, en `verPieza`: eso es por pedazo y esto es por toma.
 */
function seVe(t) {
    return Boolean(t && t.fondo !== 'camara' && t.pantallaDesde != null);
}

function hayRecuadro(t) {
    return Boolean(recuadro && t && t.fondo === 'pantalla'
        && t.camaraDesde != null && t.pantallaDesde != null);
}

/** Qué se ve y dónde, que es lo único que distingue una vista de la otra. */
function acomodar(t) {
    if (!caja) return;
    caja.dataset.hay = t ? 'si' : 'no';
    if (!t) {
        for (const v of [elPan, elCam]) if (v) v.style.display = 'none';
        return;
    }
    const camaraDeFondo = t.fondo === 'camara';
    elPan.style.display = seVe(t) ? '' : 'none';
    elCam.style.display = camaraDeFondo || hayRecuadro(t) ? '' : 'none';
    // De fondo ocupa todo y se recorta —a una cara le sobra pared por los
    // lados—; una pantalla entra entera, con negro si hace falta, porque
    // recortarla se come justo lo que se está explicando. Es la misma regla que
    // el `llenar` de `exportar-video.js`.
    elCam.className = `montaje-cam${camaraDeFondo ? '' : ' es-recuadro'}`;
    if (camaraDeFondo) {
        elCam.style.cssText = '';
    } else {
        // El lado y el margen van en tanto por ciento del ANCHO del cuadro, que
        // es como los manda el motor; el redondeo en tanto por ciento del
        // cuadrado, que es lo que mide `CAMARA_REDONDEO` contra `CAMARA_LADO`.
        // `margin: 0` porque el `auto` del centrado de la pantalla lo movería.
        elCam.style.cssText = `width:${recuadro.lado * 100}%;aspect-ratio:1;height:auto;`
            + `right:${recuadro.margen * 100}%;`
            + `bottom:${recuadro.margen * 100 * recuadro.proporcion}%;`
            + `border-radius:${recuadro.redondeo * 100}%`;
    }
    // La cámara suena siempre que esté puesta, se vea entera o en la esquina:
    // es la única de las dos con pista de sonido.
    elCam.muted = !t.conAudio;
    elPan.muted = true;
}

/** Dónde va, para la línea de tiempo y para el rótulo de la toma. */
function decir() {
    if (!avisar) return;
    const t = laDeAhora();
    const dentro = dentroDe(t);
    avisar({
        toma: t ? t.id : null,
        dentro,
        dura: t ? t.segundos : 0,
        montado: corte.loMontadoHasta(plan, donde) + (t && !t.descartada ? dentro : 0),
        total: corte.elTotal(plan),
        sola,
        reproduciendo: reproduciendo()
    });
}

/** Al irse de la pantalla: parar y soltar los archivos. */
export function soltar() {
    pausar();
    for (const v of [elPan, elCam]) {
        if (!v) continue;
        v.removeAttribute('src');
        delete v.dataset.ruta;
        v.load();
    }
    caja = null;
    elCam = null;
    elPan = null;
    plan = [];
    planPuesto = null;
    donde = -1;
    sola = false;
    avisar = null;
}
