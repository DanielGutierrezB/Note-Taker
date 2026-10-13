'use strict';
/**
 * prproj-carpeta-config.js — Lo que dice el menú del proyecto de Premiere.
 *
 * Qué capturas hay, qué capturas componen cada vista, si van anidadas y cuáles
 * se quedan puestas en todas las tomas. Se lee de la carpeta, se pone en regla
 * y se guarda; el que la usa para armar es `prproj-carpeta.js`.
 *
 * Va aparte porque es otra cosa que el armado: esto es lo que el editor elige,
 * y se lee y se escribe sin que haya un proyecto delante. Lo único que las dos
 * mitades comparten es la forma de una vista, y esa forma vive acá.
 */

const fs = require('fs');
const path = require('path');

const vivo = require('./notas-vivo');
const sesionesGrabadas = require('./sesiones-grabadas');
const workspace = require('./workspace');

/**
 * El orden de las vistas en todo el proyecto: el de `VISTAS`, y las que el
 * menú no conoce —una sigla de un XML tocado a mano— al final, por nombre.
 */
function porOrdenDeVistas(a, b) {
    const orden = vivo.VISTAS.map(v => v.nombre);
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    return (ia === -1 ? orden.length : ia) - (ib === -1 ? orden.length : ib) || (a < b ? -1 : 1);
}

/**
 * La configuración del menú, puesta en regla.
 *
 * Por defecto hay una sola captura y todas las vistas van a ella, que es el
 * caso de una clase grabada con una cámara. Lo que no cuadra se corrige en vez
 * de rechazarse: una vista que nombra una captura que se quitó, o que quedó sin
 * ninguna, vuelve a la Captura 1, que siempre está.
 *
 * **El orden de cada vista se respeta tal cual viene**, porque es el apilado:
 * van de abajo hacia arriba, así que la última es la que tapa. Ordenar por
 * número, que es lo que hacía antes, perdía en silencio justo lo que el menú
 * deja elegir.
 *
 * @param {object} [config] { capturas: 2, vistas: { R: { capturas: [1, 2], unidas: true, siempre: [1, 2] } } }
 * @param {string[]} [vistasUsadas] las vistas que aparecen en las tomas
 * @returns {{capturas: number, vistas: object}}
 */
function normalizar(config, vistasUsadas) {
    const c = config || {};
    const capturas = Math.max(1, Math.min(20, Math.floor(Number(c.capturas) || 1)));
    const vistas = {};
    const todas = new Set(vivo.VISTAS.map(v => v.nombre).concat(vistasUsadas || []));
    for (const vista of todas) {
        vistas[vista] = vistaSaneada(c.vistas && c.vistas[vista], capturas);
    }
    return { capturas, vistas };
}

/**
 * Una vista: qué capturas la componen, apiladas de abajo hacia arriba, si van
 * anidadas y cuáles se quedan puestas en todas las tomas.
 *
 * **Anidadas o sueltas es la diferencia entre un encuadre y doce.** Anidadas,
 * las dos capturas viven adentro de una secuencia aparte y el recuadro se
 * acomoda una vez para toda la carpeta. Sueltas, cada una va en su propia pista
 * de la precortada y se puede mover toma por toma, que es lo que hace falta
 * cuando el recuadro tapa algo distinto en cada una.
 *
 * **`siempre` es qué hace esa captura en las tomas de las OTRAS vistas.** Las
 * que están ahí ocupan su pista en todas las tomas de la clase, apagadas donde
 * no les toca: cambiar de plano es encender el clip que ya está, que es como
 * trabaja Class Cut. Las que no están entran solo en las tomas de su vista y en
 * las demás su pista queda vacía, que es una línea de tiempo más limpia a cambio
 * de tener que arrastrar para cambiar de plano. Por defecto están todas, que es
 * lo que hacía la app antes de que esto se pudiera elegir.
 *
 * Una anidación es un solo clip en una sola pista, así que ahí es todo o nada:
 * `siempre` se redondea a las capturas enteras del grupo o a ninguna.
 *
 * Acepta la forma vieja —una lista pelada— porque es la que hay guardada en las
 * carpetas de antes y en los ajustes, y ahí dos capturas siempre eran una
 * anidación.
 */
function vistaSaneada(pedida, capturas) {
    const bruta = Array.isArray(pedida) ? { capturas: pedida } : (pedida || {});
    const pedidas = Array.isArray(bruta.capturas) ? bruta.capturas : [];
    const ids = [...new Set(pedidas.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= capturas))];
    const limpias = ids.length ? ids : [1];
    const unidas = limpias.length > 1 && bruta.unidas !== false;
    const puestas = Array.isArray(bruta.siempre)
        ? limpias.filter(id => bruta.siempre.includes(id))
        : limpias.slice();
    return {
        capturas: limpias,
        unidas,
        siempre: unidas ? (puestas.length ? limpias.slice() : []) : puestas
    };
}

/** Dónde guarda cada carpeta su configuración del menú. */
function archivoDeConfig(carpeta) {
    return path.join(workspace.datosDir(carpeta), 'prproj.json');
}

/**
 * La configuración del menú para esta carpeta, con lo que el menú necesita para
 * dibujarse.
 *
 * Primero la que la carpeta tiene guardada; si no tiene, la última que se usó en
 * cualquier carpeta (`ultima`, de los ajustes), que suele ser la misma cámara y
 * la misma pantalla; y si tampoco, una sola captura con todo adentro.
 *
 * @param {string} carpeta
 * @param {object} [ultima] la que quedó en los ajustes
 * @param {string} [enCurso] la secuencia que se está grabando, que no cuenta
 * @returns {{config, vistas: {nombre, titulo, usada}[], clases: number, guardada: boolean}}
 */
function leerConfig(carpeta, ultima, enCurso) {
    let guardada = null;
    try {
        guardada = JSON.parse(fs.readFileSync(archivoDeConfig(carpeta), 'utf8'));
    } catch (e) {
        // Sin archivo, o roto: se arranca de la última o de fábrica.
    }
    const sesiones = carpeta ? sesionesGrabadas.listar([carpeta], enCurso) : [];
    const usadas = vistasUsadas(sesiones);
    const config = normalizar(guardada || ultima, usadas);
    return {
        config,
        vistas: vivo.VISTAS.map(v => ({
            nombre: v.nombre, titulo: v.titulo, colorDeMarcador: v.colorDeMarcador, usada: usadas.includes(v.nombre)
        })),
        clases: sesiones.length,
        guardada: Boolean(guardada)
    };
}

/** La guarda en la carpeta, puesta en regla. Devuelve la que quedó. */
function guardarConfig(carpeta, config) {
    const limpia = normalizar(config);
    const destino = archivoDeConfig(carpeta);
    workspace.ensureDir(path.dirname(destino));
    workspace.writeJson(destino, limpia);
    return limpia;
}

/** Las vistas que se usan en las tomas que van al XML, en el orden de `VISTAS`. */
function vistasUsadas(sesiones) {
    const usadas = new Set();
    for (const s of sesiones || []) {
        for (const toma of vivo.tomasQueQuedan(s)) {
            usadas.add(vivo.vistaLeida(toma.vista) || vivo.VISTA_POR_DEFECTO);
        }
    }
    return [...usadas].sort(porOrdenDeVistas);
}

/** La vista del menú, o la de fábrica si el menú no la conoce. */
function vistaDe(config, vista) {
    return (config.vistas || {})[vista] || vistaSaneada(null, config.capturas);
}

/**
 * Los apilados de una vista: uno solo si va anidada, uno por captura si van
 * sueltas. Cada apilado es una fuente del proyecto y, en la precortada, una
 * pista.
 */
function gruposDe(v) {
    return v.unidas && v.capturas.length > 1 ? [v.capturas.slice()] : v.capturas.map(id => [id]);
}

module.exports = {
    porOrdenDeVistas,
    normalizar,
    vistaSaneada,
    vistaDe,
    gruposDe,
    archivoDeConfig,
    leerConfig,
    guardarConfig,
    vistasUsadas
};
