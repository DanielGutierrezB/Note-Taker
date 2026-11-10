'use strict';
/**
 * notas-vivo.js — Las notas de rodaje, mientras la clase se está grabando.
 *
 * El profesor dice "3, 2, 1" y la toma se abre, y dice "Pausa" y se cierra. De
 * eso sale el XML que el editor importa en Premiere (`notas-xml.js`).
 *
 * **Una sesión es una clase entera, grabada de corrido.** No hay "parar y
 * seguir": la clase dura lo que dure y de ella sale UN XML, con todas las tomas
 * adentro. Eso es lo que hace que los tiempos cierren en el total, que es lo
 * único que el editor no puede arreglar después.
 *
 * **Todo va con la HORA DEL DÍA en milisegundos.** Es lo que permite que el
 * reloj de la app y el del audio sean el mismo: las palabras se estampan por
 * su posición en el WAV (`oir.aHoraDelDia`, `grabacion.pcm`), no
 * por cuándo la app se enteró. Pasarlo a los cuadros que entiende Premiere es
 * trabajo de `notas-xml.js`, que es lo único que conoce el formato.
 *
 * **La latencia no perjudica la precisión**, y es lo que hace que todo esto
 * funcione. Cuando el profesor dice "Pausa", el OUT no se pone donde la
 * herramienta se dio cuenta: se pone en el timecode de esa palabra, que Whisper
 * devuelve junto con el texto. Un segundo de demora en enterarse no mueve el
 * corte ni un cuadro, y en una clase de tres horas eso es la diferencia entre
 * unas notas que sirven para cortar y unas que hay que volver a mirar.
 *
 * **Sin estado y sin DOM**: todo lo de acá se prueba solo (`tests/notas-vivo.test.js`).
 * Los números que deciden —cuántos segundos de silencio confirman un "Pausa",
 * cuánto tienen que parecerse dos arranques—
 * salen de medir clases reales con `tools/simular-grabacion.js`, no de estimarlos.
 *
 * **Está partido en siete piezas** (`engine/vivo/`), de abajo hacia arriba:
 * `palabras`, `vistas`, `senales`, `tomas`, `repeticiones`, `ciclo` y
 * `ediciones`. Ninguna pide a una de más arriba, así que no hay ciclos. Este
 * archivo las junta y es la única puerta: lo de afuera pide `notas-vivo`.
 */

const palabras = require('./vivo/palabras');
const vistas = require('./vivo/vistas');
const senales = require('./vivo/senales');
const tomas = require('./vivo/tomas');
const repeticiones = require('./vivo/repeticiones');
const ciclo = require('./vivo/ciclo');
const ediciones = require('./vivo/ediciones');

module.exports = {
    VISTAS: vistas.VISTAS,
    VISTA_POR_DEFECTO: vistas.VISTA_POR_DEFECTO,
    vistaLeida: vistas.vistaLeida,
    aplicar: ediciones.aplicar,
    estadoNuevo: tomas.estadoNuevo,
    senales: senales.senales,
    aplicarSenales: ciclo.aplicarSenales,
    repeticiones: repeticiones.repeticiones,
    tomaAbierta: tomas.tomaAbierta,
    abrirToma: tomas.abrirToma,
    moverInAbierta: tomas.moverInAbierta,
    tomaAnterior: tomas.tomaAnterior,
    pisoDelIn: tomas.pisoDelIn,
    techoDelOut: tomas.techoDelOut,
    cerrarEn: tomas.cerrarEn,
    arranqueDeLaTirada: tomas.arranqueDeLaTirada,
    HUECO_DE_TIRADA_SEC: tomas.HUECO_DE_TIRADA_SEC,
    RETROCESO_MAX_SEC: tomas.RETROCESO_MAX_SEC,
    VENTANA_DE_SUELTAS_SEC: tomas.VENTANA_DE_SUELTAS_SEC,
    MARGEN_DE_SUELTAS_SEC: tomas.MARGEN_DE_SUELTAS_SEC,
    FRESCURA_MAX_SEC: tomas.FRESCURA_MAX_SEC,
    finDeToma: tomas.finDeToma,
    SILENCIO_TRAS_PAUSA_SEC: senales.SILENCIO_TRAS_PAUSA_SEC,
    FRASES_DE_FABRICA: senales.FRASES_DE_FABRICA,
    palabrasDeFrase: senales.palabrasDeFrase,
    reglasDeFrases: senales.reglasDeFrases,
    vistaHeredada: vistas.vistaHeredada,
    vistaDeLaProxima: vistas.vistaDeLaProxima,
    repartir: tomas.repartir,
    cerrarProvisional: tomas.cerrarProvisional,
    moverBorde: tomas.moverBorde,
    dividir: tomas.dividir,
    correrNumeros: tomas.correrNumeros,
    tragarSueltas: ediciones.tragarSueltas,
    tragarSueltasDesde: ediciones.tragarSueltasDesde,
    laQuePisa: tomas.laQuePisa,
    juntas: palabras.juntas,
    limpiarSueltas: ediciones.limpiarSueltas,
    esDeAlgunaToma: ediciones.esDeAlgunaToma,
    tomasQueQuedan: tomas.tomasQueQuedan,
    limpio: palabras.limpio,
    comentarioDeEntrada: senales.comentarioDeEntrada,
    cueDeSalida: senales.cueDeSalida
};
