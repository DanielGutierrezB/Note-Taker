'use strict';
/**
 * vivo/vistas.js — Las vistas: cuáles hay, cómo se leen las viejas y cuál le toca a una toma.
 *
 * Es una parte de `engine/notas-vivo.js`, que las junta: quien usa el motor
 * pide `notas-vivo` y no estas piezas.
 */

const { limpio } = require('./palabras');

/**
 * Las vistas que se pueden elegir: cómo se llama cada una y de qué color va.
 *
 * `colorDeMarcador` es el entero nativo de Premiere (`pproColor`) y es lo que
 * se escribe en el XML. Salen de un XML de verdad del director de contenido, no
 * de elegirlos: si acá se escribiera otro, el mismo tipo de toma llegaría a la
 * secuencia de un color distinto según quién tomó las notas.
 *
 * **MG es la excepción, y se movió a mano.** El turquesa que traía (#19F4D6) es
 * ahora el de las notas sobre el texto (`notas-xml.TURQUESA`), que antes salían
 * del mismo blanco que las claquetas y no se distinguían de ellas. Dos cosas no
 * pueden compartir color en la tira de marcadores, y entre las dos el editor
 * pidió el turquesa para las notas, que las usa todos los días, y no para MG,
 * que no se usó ni una vez en las 101 tomas grabadas hasta hoy. El azul nuevo
 * es el más lejos que queda de las otras cuatro vistas (ΔE 50 contra la más
 * parecida, que es X2).
 *
 * **Es también el color con el que la pantalla pinta la toma**, y no hay un
 * segundo color para eso. Class Cut sí tenía uno (`colorEnLaApp`) porque allá
 * la lista de tomas convivía con un reproductor que ya usaba esos colores para
 * otra cosa. Note Taker no tiene reproductor, y dos colores para lo mismo solo
 * lograban que el profesor se viera azul mientras se grababa y llegara rojo a
 * Premiere. Cómo se pinta sin perder contraste está en `src/js/colores.js`.
 */
const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor', colorDeMarcador: 4281740498 },
    { nombre: 'R', titulo: 'Pantalla', colorDeMarcador: 4280578025 },
    { nombre: 'S', titulo: 'Slides', colorDeMarcador: 4281828977 },
    // Los títulos son los nombres con que el equipo llama a cada plano: MG es
    // Motion Graphics y X2 es el tramo que se acelera en post. «Multi» y
    // «Doble» eran traducciones que nadie usaba (corregido el 14/10).
    { nombre: 'MG', titulo: 'Motion Graphics', colorDeMarcador: 4294345275 },
    { nombre: 'X2', titulo: 'Acelerar', colorDeMarcador: 4289825711 }
];

const VISTA_POR_DEFECTO = 'PV';

/**
 * Nombres de vista que ya no se ofrecen pero que hay que seguir entendiendo.
 *
 * `SL` y `SR` eran las slides encuadradas a izquierda y a derecha, y llegaban a
 * la secuencia del mismo verde porque son la misma fuente: la distinción era de
 * encuadre y no de material, así que en el corte no cambiaba nada. Ahora son una
 * sola, `S`.
 *
 * Dejar de ofrecerlas no es lo mismo que dejar de entenderlas, y hay dos sitios
 * donde siguen llegando: las clases que ya se grabaron las tienen escritas en su
 * sidecar y en su XML, y el XML que entra de afuera trae el nombre que el
 * director de contenido le puso al marcador, que puede ser cualquiera de los que
 * la herramienta ofrecía el día que tomó esas notas. Si no se tradujeran, esas
 * tomas quedarían con una vista que no existe: el selector no marcaría ninguna,
 * el color caería al de `PV` y el mapeo las mandaría a la cámara equivocada.
 */
const VISTAS_RENOMBRADAS = { SL: 'S', SR: 'S' };

/**
 * El nombre de hoy de una vista que se acaba de leer de un archivo.
 *
 * Se traduce al LEER y no se reescribe el disco al pasar: un camino de lectura
 * que escribe es lo que vuelve irreproducible el próximo error, y además una
 * clase se lista sin que nadie la haya pedido. Igual el archivo se cura solo, y
 * en el primer gesto: cada cambio sobre una clase grabada reescribe el sidecar y
 * el XML enteros desde el estado ya traducido (`editarGrabada` en
 * `grabacion.js`), así que la primera vez que alguien la toca queda con `S`.
 */
function vistaLeida(nombre) {
    // El marcador puede llamarse «Toma 3 · PV» —lo que escribe esta app, para
    // que el editor vea el número en la línea de tiempo— o «PV» a secas, que es
    // como lo escribían los XML de antes y los de Class Cut. La vista es lo que
    // va después del separador, y los dos casos salen de la misma línea.
    const n = limpio(nombre).split('·').pop().trim();
    return VISTAS_RENOMBRADAS[n] || n;
}

/**
 * La vista que le toca a una toma nueva: la de la última que se hizo.
 *
 * Una clase se graba por tramos con la misma vista —varias tomas de profesor
 * seguidas, después varias de pantalla— así que heredarla es acertar casi
 * siempre, y cuando no, se corrige con una tecla. Arrancar todas en `PV`
 * obligaba a apretar la vista en CADA toma, y la que se olvidaba llegaba al XML
 * con el color equivocado.
 *
 * Se mira la última no desactivada: una que se desactivó es una que no cuenta
 * —su vista puede ser justamente la que estaba mal— y no tiene por qué decidir
 * la de la que viene.
 */
function vistaHeredada(estado) {
    const previa = [...(estado.tomas || [])].reverse().find(t => !t.descartada && t.vista);
    return previa ? previa.vista : VISTA_POR_DEFECTO;
}

/**
 * La vista que se eligió para la toma que todavía no empezó.
 *
 * Entre toma y toma, apretar una vista arriba es decir «la que viene va así»:
 * la última ya se hizo y cambiarle la vista desde la barra era cambiar algo
 * que el editor no estaba mirando. Para corregir una toma hecha está su propia
 * fila, que lleva su `data-toma` y no se confunde con nada.
 *
 * Se guarda acá y no en la ventana porque quien decide la vista de una toma
 * nueva es `nuevaToma`, y una toma se abre sola cuando el profesor cuenta «3,
 * 2, 1»: si viviera en la pantalla, la elección llegaría tarde.
 *
 * Vale UNA vez. Gana sobre la herencia y se gasta al abrirse la toma, porque
 * es una decisión sobre esa toma y no un modo nuevo en el que quedarse.
 */
function vistaDeLaProxima(estado, vista) {
    if (!VISTAS.some(v => v.nombre === vista)) return false;
    if (estado.vistaProxima === vista) return false;
    estado.vistaProxima = vista;
    return true;
}

module.exports = {
    VISTAS,
    VISTA_POR_DEFECTO,
    VISTAS_RENOMBRADAS,
    vistaLeida,
    vistaHeredada,
    vistaDeLaProxima
};
