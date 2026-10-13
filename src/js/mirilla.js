/**
 * mirilla.js — La ventanita donde te ves mientras grabás.
 *
 * Es un espejo con tres botones, y nada más. No decide: no sabe qué vista va
 * en la toma que viene, ni si hay una toma abierta; se lo cuentan. Y cuando se
 * aprieta algo, no lo hace: lo pide. La dueña de todo eso es la pantalla
 * semanal (`pantalla-semanal.js`), y esta ventana es su reflejo.
 *
 * Esa es la decisión que hace que esto sea chico. La alternativa —que la
 * mirilla llevara su propia idea del estado y hablara con el motor— son dos
 * ventanas opinando de lo mismo y un día discrepando, que con una grabación
 * en curso es la peor hora para descubrirlo.
 *
 * Lo único suyo es la cámara, porque un `<video>` no cruza el puente. Y de eso
 * hay una regla, medida y no supuesta: pide EXACTAMENTE lo que pide
 * `grabar/ojo.js` —por eso lo importa—, y no abre la cámara si no hay quien ya
 * la tenga abierta. Chromium deja que dos ventanas compartan un dispositivo,
 * pero el formato lo negocia el primero y lo hereda el segundo: abriendo esta
 * primero y a lo que salga, la grabación de verdad entra detrás y sale en
 * 640×480.
 */

import { pedidoDeCamara } from './grabar/ojo.js';

const $ = s => document.querySelector(s);

const estado = {
    /** Lo último que dijo el espejo. */
    espejo: {},
    /** El nombre de la cámara que está abierta, o pidiéndose, acá. */
    camara: null,
    stream: null,
    /**
     * Cuántas veces se soltó. Una petición que vuelve de `getUserMedia` y ve
     * otro número llegó tarde: entre medio se pidió otra cámara o ninguna.
     */
    pedido: 0
};

const marco = $('#marco');
const video = $('#camara');
const aviso = $('#aviso');

// Sin esperar al `DOMContentLoaded`: un `<script type="module">` ya es
// diferido, así que acá el documento está entero. Esperarlo igual, «por si
// acaso», es lo que dejó esta página muerta la primera vez que se abrió de
// verdad —la guarda vivía debajo de su propia llamada y tiraba en la zona
// muerta temporal—, y en una ventana sin consola a la vista eso se ve como un
// cuadro negro y nada más.
arrancar();

function arrancar() {
    marco.addEventListener('click', alClic);
    window.nt.onMirillaEspejo(mostrar);
    // Lo último que se dijo, para tener algo que dibujar ya: la ventana se abre
    // en mitad de una grabación y esperar al próximo latido serían mil
    // milisegundos de cuadro negro.
    window.nt.mirillaQueMuestro().then(mostrar);
}

/**
 * Pintar lo que la semanal dice que hay.
 *
 * @param {{camara?: string, vista?: string, color?: string, abierta?: boolean,
 *          puedeAbrir?: boolean}} info
 */
async function mostrar(info) {
    if (!info) return;
    estado.espejo = info;

    // El borde dice en qué vista estás. El color lo manda la semanal porque lo
    // saca del motor —son los colores de los marcadores de Premiere— y así lo
    // que ves mientras grabás es lo que el editor va a ver después.
    if (info.color) document.documentElement.style.setProperty('--vista', info.color);
    marco.dataset.vista = info.vista || '';
    marco.dataset.toma = info.abierta ? 'abierta' : 'no';

    const toma = $('#btn-toma');
    toma.textContent = info.abierta ? 'Cerrar toma' : 'Toma';
    toma.disabled = !info.abierta && !info.puedeAbrir;
    toma.setAttribute('aria-label', info.abierta
        ? 'Cerrar la toma que está abierta'
        : 'Abrir una toma nueva');

    // Los dos de la vista marcan cuál va, y la que está puesta no se puede
    // volver a apretar: no haría nada y parecería que sí.
    for (const b of [$('#btn-r'), $('#btn-pv')]) {
        const suya = b.dataset.vista === info.vista;
        b.setAttribute('aria-pressed', String(suya));
        b.setAttribute('aria-label', suya
            ? `Ya estás en ${b.dataset.vista}`
            : `Pasar a ${b.dataset.vista}`);
    }

    await laCamara(info);
}

/**
 * La cámara, con la regla de no abrir primero.
 *
 * `info.camara` solo viene cuando la pantalla semanal YA la tiene abierta. Sin
 * eso no se pide nada: esta ventana tomando el dispositivo antes que nadie es
 * justo lo que deja la grabación de verdad en 640×480.
 *
 * **Y una sola petición a la vez.** Los espejos llegan de a varios —al abrir
 * llegan el guardado y el del primer repintado casi juntos— y cada uno pedía
 * su cámara mientras la anterior seguía en camino: la primera quedaba abierta
 * y sin nadie que la soltara. Peor, un espejo sin cámara en el medio soltaba
 * nada, y la petición en vuelo la abría igual al volver.
 */
async function laCamara(info) {
    if (!info.camara) return soltar('La cámara se prende al empezar');
    // Ya está, o ya se pidió.
    if (estado.camara === info.camara) return undefined;

    soltar('');
    const mio = estado.pedido;
    estado.camara = info.camara;
    try {
        const todas = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'videoinput');
        if (mio !== estado.pedido) return undefined;
        const cual = todas.find(d => d.label === info.camara);
        if (!cual) return soltar('No encuentro esa cámara');
        const stream = await navigator.mediaDevices.getUserMedia(pedidoDeCamara(cual.deviceId));
        if (mio !== estado.pedido) {
            for (const t of stream.getTracks()) t.stop();
            return undefined;
        }
        estado.stream = stream;
        video.srcObject = stream;
        await video.play();
        marco.dataset.aviso = 'no';
    } catch (e) {
        if (mio === estado.pedido) soltar('No pude abrir la cámara');
    }
    return undefined;
}

function soltar(porque) {
    estado.pedido++;
    for (const t of (estado.stream ? estado.stream.getTracks() : [])) t.stop();
    estado.stream = null;
    estado.camara = null;
    video.srcObject = null;
    aviso.textContent = porque;
    marco.dataset.aviso = porque ? 'si' : 'no';
}

/** Los tres botones no hacen: piden. */
function alClic(e) {
    const boton = e.target.closest('button[data-hace]');
    if (!boton || boton.disabled) return;
    if (boton.dataset.hace === 'vista') {
        window.nt.mirillaGesto({ hace: 'vista', vista: boton.dataset.vista });
        return;
    }
    // Uno solo y no «abrir»/«cerrar»: del otro lado lo atiende `bordeDeToma`,
    // que ya decide cuál toca mirando el estado del motor. Mandar la decisión
    // desde acá sería decidirla con lo que el espejo supo hace un instante.
    window.nt.mirillaGesto({ hace: 'toma' });
}
