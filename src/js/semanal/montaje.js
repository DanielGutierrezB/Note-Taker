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
 * lo sigue y se lo corrige si se separa: los dos archivos arrancaron en el
 * mismo instante del reloj de pared, así que se mantienen juntos solos.
 */

import * as corte from './corte.js';

/** Más de esto de separación entre los dos vídeos y se vuelve a buscar. */
const SE_SEPARO_SEC = 0.25;

/** Cada cuánto se mira dónde va. `timeupdate` llega cada 250 ms y es poco. */
const CADA_MS = 60;

/** El margen con que se da por terminada una toma, en segundos. */
const AL_FILO = 0.02;

let caja = null;
let elCam = null;
let elPan = null;
let plan = [];
let archivos = { camara: null, pantalla: null };
let recuadro = { lado: 0.1875, margen: 0.025, redondeo: 0.125 };
let donde = -1;
let sola = false;
let tictac = null;
let avisar = null;
let planPuesto = null;

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
    recuadro = m.recuadro || recuadro;
    apuntar(elCam, archivos.camara);
    apuntar(elPan, archivos.pantalla);
    const sigue = antes ? plan.findIndex(t => t.id === antes.id) : -1;
    irAlIndice(sigue === -1 ? corte.primera(plan) : sigue, { reproducir: iba });
}

function apuntar(v, ruta) {
    if (!v || !ruta || v.dataset.ruta === ruta) return;
    v.dataset.ruta = ruta;
    v.src = ruta;
}

export function laDeAhora() {
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
    const t = laDeAhora();
    sola = Boolean(t && t.descartada);
    acomodar(t);
    buscar(t);
    if (o.reproducir) arrancar();
    else decir();
}

export function alternar() {
    if (reproduciendo()) pausar();
    else arrancar();
}

export function arrancar() {
    let t = laDeAhora();
    if (!t) return;
    // Al final de todo, volver al principio en vez de no hacer nada: apretar
    // play y que no pase nada no se distingue de que esté roto.
    if (!sola && corte.laQueSigue(plan, donde) === -1 && dentroDe(t) >= t.segundos - 0.05) {
        irAlIndice(corte.primera(plan), {});
        t = laDeAhora();
        if (!t) return;
    }
    for (const v of [elPan, elCam]) {
        if (v && v.dataset.ruta && v.style.display !== 'none') v.play().catch(() => {});
    }
    if (!tictac) tictac = setInterval(mirar, CADA_MS);
    decir();
}

export function pausar() {
    for (const v of [elPan, elCam]) if (v) v.pause();
    if (tictac) clearInterval(tictac);
    tictac = null;
    decir();
}

/** El que lleva el tiempo: el del audio si lo hay, y si no el del fondo. */
function elMaestro(t) {
    if (!t) return null;
    if (t.conAudio && t.camaraDesde != null) return elCam;
    return t.fondo === 'camara' ? elCam : elPan;
}

/** En qué segundo de su archivo empieza la toma, para el que lleva el tiempo. */
function arranqueDe(t) {
    return (elMaestro(t) === elCam ? t.camaraDesde : t.pantallaDesde) || 0;
}

/** Cuánto se lleva reproducido de la toma de ahora. */
function dentroDe(t) {
    const m = elMaestro(t);
    return m && t ? Math.max(0, m.currentTime - arranqueDe(t)) : 0;
}

function buscar(t) {
    if (!t) return;
    if (elCam && elCam.dataset.ruta && t.camaraDesde != null) elCam.currentTime = t.camaraDesde;
    if (elPan && elPan.dataset.ruta && t.pantallaDesde != null) elPan.currentTime = t.pantallaDesde;
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
            m.currentTime = arranqueDe(t) + Math.max(0, t.segundos - AL_FILO * 2);
            decir();
            return;
        }
        irAlIndice(sigue, { reproducir: true });
        return;
    }
    // Y los dos juntos. Solo hace falta cuando los dos se ven a la vez —la toma
    // con recuadro—: si el otro está escondido, que se separe no se nota y
    // buscarlo cada tanto sí se nota.
    if (hayRecuadro(t) && elCam.dataset.ruta && elPan.dataset.ruta) {
        const deberia = t.camaraDesde + (elPan.currentTime - t.pantallaDesde);
        if (Math.abs(elCam.currentTime - deberia) > SE_SEPARO_SEC) elCam.currentTime = deberia;
    }
    decir();
}

function hayRecuadro(t) {
    return Boolean(t && t.fondo === 'pantalla' && t.camaraDesde != null && t.pantallaDesde != null);
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
    elPan.style.display = camaraDeFondo || t.pantallaDesde == null ? 'none' : '';
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
            + `right:${recuadro.margen * 100}%;bottom:${recuadro.margen * 100 * 16 / 9}%;`
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
        total: elTotal(),
        sola,
        reproduciendo: reproduciendo()
    });
}

export function elTotal() {
    return corte.elTotal(plan);
}

export function elPlan() {
    return plan;
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
