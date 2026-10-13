/**
 * semanal/mirilla.js — Lo que la pantalla semanal le cuenta a la mirilla.
 *
 * La mirilla es la ventanita flotante donde te ves mientras grabás
 * (`ipc/mirilla.js`, `src/js/mirilla.js`). Es un espejo: no sabe qué vista va
 * ni si hay una toma abierta, se lo cuenta esta pantalla, que es la dueña. Lo
 * de acá es esa mitad: encenderla, decirle qué monitor se graba y mandarle el
 * espejo.
 *
 * Los gestos que vuelven de la mirilla no están acá sino en la pantalla, donde
 * están las funciones de sus propios botones: entrar por ellas es lo que hace
 * que apretar «PV» allá y acá sea el mismo gesto.
 */

import * as ojo from '../grabar/ojo.js';
import { coloresDeVista } from '../colores.js';

/**
 * Lo que la mirilla tiene que mostrar, sacado del estado de la pantalla.
 *
 * La vista es la de la toma abierta si hay una —es la que se está grabando— y
 * si no la que va en la próxima: la misma cuenta que hace la escena de la
 * tarjeta.
 *
 * **La cámara va solo si está ABIERTA de este lado.** Es la regla medida: si
 * la mirilla toma el dispositivo antes que nadie, negocia el formato y la
 * grabación de verdad lo hereda —una cámara de 2560 entraba a 640×480—. Así,
 * mientras acá no haya cámara, allá tampoco.
 *
 * Sin color cuando todavía no llegaron las vistas del motor, que es lo que
 * contesta `coloresDeVista` y hay que respetar: con un `.color` suelto, el
 * primer repintado de la pantalla se caía entero.
 *
 * @param {object} estado el de la pantalla semanal
 * @param {boolean} camaraAbierta si la cámara de esta ventana tiene stream
 */
export function espejoDe(estado, camaraAbierta) {
    const abierta = (estado.sesion && estado.sesion.tomas || []).find(t => t.outMs == null);
    const vista = abierta ? (abierta.vista || estado.vista) : estado.vista;
    const c = coloresDeVista(estado.vistas, vista);
    return {
        camara: camaraAbierta ? (estado.camara && estado.camara.nombre) || null : null,
        vista,
        color: c ? c.color : null,
        abierta: Boolean(abierta),
        puedeAbrir: estado.paso === 'grabando'
    };
}

/**
 * Contarle a la mirilla qué tiene que mostrar.
 *
 * Se manda entero en cada repintado en vez de llevar la cuenta de qué cambió:
 * son cinco campos, y un espejo que solo se actualiza cuando alguien se
 * acuerda de avisarle es un espejo que un día muestra la vista de hace dos
 * tomas.
 */
export function espejar(estado) {
    if (!estado.mirilla) return;
    window.nt.mirillaEspejo(espejoDe(estado, Boolean(ojo.elStream())));
}

/**
 * Qué pantalla se está grabando, para que la mirilla se mude a ese monitor.
 *
 * Lo que mira es `getSettings()` de la pista: ahí viene el `deviceId` del
 * monitor cuando se comparte una pantalla entera. Compartiendo UNA ventana no
 * viene, y da igual: en ese caso la mirilla no entra en la captura de ninguna
 * manera, así que basta con que se vea. Si falla, se queda donde estaba.
 *
 * @param {object} estado
 * @param {MediaStream|null} pantalla la que se está grabando
 */
export function contarLaPantalla(estado, pantalla) {
    if (!estado.mirilla) return;
    const pista = pantalla instanceof MediaStream ? pantalla.getVideoTracks()[0] : null;
    window.nt.mirillaPantalla(pista ? pista.getSettings() : null).catch(() => {});
}

/**
 * Encenderla o apagarla. Si el proceso principal no puede, tira, y el estado
 * no cambia: el botón no puede decir que está encendida si no lo está.
 *
 * El estado vive acá y no en el proceso principal porque el botón que lo dice
 * está acá: la ventana del otro lado es el reflejo, no el original.
 */
export async function poner(estado, encendida, pantalla) {
    await window.nt.mirillaPoner(encendida);
    estado.mirilla = encendida;
    if (encendida) contarLaPantalla(estado, pantalla);
}
