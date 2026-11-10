'use strict';
/**
 * ipc/grabar.js — El puente de la toma de notas en vivo.
 *
 * La grabación vive del lado de Node y no de la ventana, aunque la ventana sea
 * la que dibuja: hay una sola verdad, y es la que escribe el XML. La ventana
 * manda el audio y los cambios que hace el editor, y recibe el estado entero de
 * vuelta (`engine/grabacion.js`).
 *
 * Está en su archivo y no en `main.js` porque de él necesita dos cosas —mandar
 * avisos a la ventana y anotar en el diario— y porque así `main.js` se queda
 * con lo que es de la app entera: la ventana, los diálogos y los ajustes.
 */

const grabacion = require('../engine/grabacion');
const nombreDeSesion = require('../engine/nombre-de-sesion');
const audioApp = require('../engine/audio-app');
const disco = require('../engine/disco');
const ajustes = require('../engine/ajustes');
const glosario = require('../engine/glosario');
const workspace = require('../engine/workspace');

/** Cada cuánto se repite el aviso de que el audio se está perdiendo. */
const AVISO_DE_PCM_MS = 2000;

/**
 * Los dos glosarios de una carpeta, sumados, y el texto que va a Whisper.
 *
 * Se arma acá, donde están los ajustes y la carpeta, y el motor recibe el
 * texto hecho: así la clase en curso, Regenerar y la pantalla de Ajustes no
 * pueden sumar distinto.
 */
function glosarioDe(carpeta) {
    const general = ajustes.leer().glosario;
    const delCurso = glosario.leerDelCurso(carpeta);
    const suma = glosario.combinar(general, delCurso);
    return { general, delCurso, ...suma, texto: glosario.texto(suma.entran) };
}

/**
 * @param {object} deps { ipcMain, app, send, anotar } de `main.js`
 */
function registrar({ ipcMain, app, send, anotar }) {
    // Los pedazos de PCM que reventaron en ESTA sesión, y cuándo se dijo por
    // última vez. Se ponen a cero al arrancar y al reanudar: lo que se perdió
    // en la clase anterior ya está dicho, y su cuenta no es de esta.
    const pcm = { veces: 0, avisadoMs: 0 };
    const olvidarPcmRoto = () => Object.assign(pcm, { veces: 0, avisadoMs: 0 });

    ipcMain.handle('grabar-iniciar', (event, payload) => {
        const p = payload || {};
        olvidarPcmRoto();
        try {
            // Las frases salen de Ajustes y no de la ventana: es el mismo
            // archivo que `ajustes-guardar` acaba de escribir.
            const estado = grabacion.iniciar({
                ...p,
                frases: ajustes.leer().frases,
                glosario: glosarioDe(p.dir).texto,
                avisar: aviso => send('grabar-aviso', aviso)
            });
            anotar('grabar.inicia', {
                secuencia: estado.secuencia,
                dir: estado.dir,
                fps: estado.fps,
                dispositivo: p.dispositivo
            });
            return { ok: true, estado };
        } catch (err) {
            anotar('grabar.no-arranca', { error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * Reanudar una sesión que quedó abierta: mismo XML, mismo cero, otro WAV.
     */
    ipcMain.handle('grabar-reanudar', (event, json, payload) => {
        olvidarPcmRoto();
        try {
            const estado = grabacion.reanudar(json, {
                ...(payload || {}),
                frases: ajustes.leer().frases,
                glosario: glosarioDe(workspace.sesionDelSidecar(json).base).texto,
                avisar: aviso => send('grabar-aviso', aviso)
            });
            anotar('grabar.reanuda', { json, secuencia: estado.secuencia });
            return { ok: true, estado };
        } catch (err) {
            anotar('grabar.no-reanuda', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * El PCM que manda la ventana. Va por `on` y no por `handle`: llega varias
     * veces por segundo y no hay nada que esperar de vuelta, y devolver el
     * estado entero cada vez llenaría el puente de tomas repetidas.
     *
     * **Un pedazo que revienta al procesarse NO llegó al WAV**, y hasta ahora
     * eso solo quedaba en el diario: la ventana seguía mandando audio, el
     * medidor seguía moviéndose y el agujero aparecía al abrir el XML, con
     * todo lo de después corrido contra la cámara. Es el mismo agujero que ya
     * se avisa cuando el que revienta es el audio de Zoom, y va por el mismo
     * camino y a la misma pastilla (`alRomperse` en `pantalla-preparar.js`).
     *
     * Lo único distinto es que este lado tiene que contar y espaciar. El
     * motivo de que reviente un pedazo —el disco lleno, la carpeta que se
     * desmontó— revienta todos los que siguen, doce por segundo: mandarlos
     * todos serían doce repintados por segundo de una pantalla que ya dijo lo
     * que tenía que decir, y doce renglones por segundo en el diario. Así que
     * se cuentan todos y se avisa el primero en el acto —es el que hay que
     * ver— y después uno cada dos segundos, con la cuenta acumulada, que es lo
     * que distingue un tropiezo de una clase perdida.
     */
    ipcMain.on('grabar-pcm', (event, chunk) => {
        try {
            grabacion.pcm(chunk);
        } catch (err) {
            pcmRoto(err.message);
        }
    });

    function pcmRoto(mensaje) {
        pcm.veces++;
        const ahora = Date.now();
        if (pcm.veces > 1 && ahora - pcm.avisadoMs < AVISO_DE_PCM_MS) return;
        pcm.avisadoMs = ahora;
        anotar('grabar.pcm-falla', { error: mensaje, veces: pcm.veces });
        send('grabar-aviso', { tipo: 'audio-roto', mensaje, veces: pcm.veces });
    }

    /**
     * La otra fuente: el sonido de Zoom, que no pasa por la ventana.
     *
     * Lo abre Node (`engine/audio-app.js`) y los pedazos van directo a
     * `grabacion.pcm`, por el mismo camino que los del micrófono. La ventana
     * pide y recibe el nivel por `audio-app`, y nada más: mandar el audio
     * hasta allá para que lo devuelva sería hacerlo cruzar el puente dos veces
     * para llegar al mismo sitio.
     */
    ipcMain.handle('audio-app-estado', () => audioApp.estado());

    ipcMain.handle('audio-app-abrir', async (event, como) => {
        const r = await audioApp.abrir({
            modo: como && como.modo,
            alPcm: chunk => grabacion.pcm(chunk),
            avisar: aviso => {
                // Un pedazo que no se pudo escribir es el mismo agujero que el
                // del micrófono, y va por el mismo freno: contado, y dicho el
                // primero y después uno cada dos segundos. Sin el freno eran
                // doce renglones por segundo en el diario.
                if (aviso && aviso.tipo === 'error') {
                    pcmRoto(aviso.mensaje);
                    return;
                }
                // Lo demás que le pasa a la escucha en medio de la clase va al
                // registro siempre: es lo que explica un WAV con silencios
                // puestos, una tasa que cambió o una escucha que se rearmó.
                if (aviso && ['ayudante', 'relleno', 'rearmada', 'relanzando', 'caido', 'vuelve'].includes(aviso.tipo)) {
                    anotar(`audio-app.${aviso.tipo}`, aviso);
                }
                send('audio-app', aviso);
            }
        });
        anotar('audio-app.abrir', { modo: (como && como.modo) || 'app',
            ok: r.ok, codigo: r.codigo || null, sampleRate: r.sampleRate || null,
            tasaDelDispositivo: r.tasaDelDispositivo || null });
        return r;
    });

    ipcMain.handle('audio-app-mandar', (event, si) => {
        if (si) audioApp.empezarAMandar(); else audioApp.dejarDeMandar();
        return true;
    });

    ipcMain.handle('audio-app-cerrar', () => { audioApp.cerrar(); return true; });

    /**
     * El idioma de la clase que está grabando, cambiado a mitad.
     *
     * No lo anota acá: lo anota el motor, que es el que sabe cuántas tomas
     * manda a releer y el que puede negarse (`grabacion.cambiarIdioma`).
     */
    ipcMain.handle('grabar-idioma', (event, cual, opciones) =>
        grabacion.cambiarIdioma(cual, opciones));

    /**
     * Otra entrada de audio, con la clase grabando. La ventana ya la abrió y
     * manda con qué tasa suena; el motor cierra el WAV y abre otro.
     */
    ipcMain.handle('grabar-cambiar-entrada', (event, como) => grabacion.cambiarEntrada(como));

    ipcMain.handle('grabar-editar', (event, cambio) => {
        anotar('grabar.editar', { toma: cambio && cambio.toma, tipo: cambio && cambio.tipo });
        return grabacion.editar(cambio);
    });

    /**
     * Abrir y cerrar una toma a mano, para cuando el conteo no se dijo.
     *
     * No llevan la hora: la pone el motor con el reloj del audio. Y `grabar-abrir-toma` devuelve además cuánto retrocedió el
     * IN, que es lo único que la ventana no puede saber sola y lo que le deja
     * decir «abierta 4 s atrás, desde donde arrancó la frase».
     */
    ipcMain.handle('grabar-abrir-toma', (event, ms) => {
        const estado = grabacion.abrirToma(ms);
        anotar('grabar.abrir-toma', {
            toma: estado && estado.abierta,
            retrocedioSec: estado && estado.retrocedioSec
        });
        return estado;
    });

    ipcMain.handle('grabar-cerrar-toma', (event, ms) => grabacion.cerrarToma(ms));

    /**
     * Deshacer y rehacer lo que el editor hizo a mano.
     *
     * Contestan `{ok, que, error, estado}` y no el estado pelado como los demás
     * canales de acá, porque hay dos cosas que la ventana no puede saber sola:
     * qué paso se acaba de revertir —lo dice en el aviso, que si no un cambio
     * revertido lejos del scroll es invisible— y por qué un paso no se pudo
     * revertir (una toma nueva abierta encima, ver `engine/deshacer.js`).
     */
    ipcMain.handle('grabar-deshacer', () => {
        const r = grabacion.deshacer();
        anotar('grabar.deshace', { que: r.que || '', pudo: r.ok });
        return r;
    });

    ipcMain.handle('grabar-rehacer', () => {
        const r = grabacion.rehacer();
        anotar('grabar.rehace', { que: r.que || '', pudo: r.ok });
        return r;
    });

    ipcMain.handle('grabar-estado', () => grabacion.resumen());
    // Si en la carpeta se puede escribir y cuánta clase entra, antes de empezar.
    ipcMain.handle('grabar-disco', (event, dir) => disco.revisar(dir));
    ipcMain.handle('grabar-listar', (event, dirs) => grabacion.listar(dirs));

    /**
     * Cómo se llamaría la clase siguiente en esa carpeta.
     *
     * Contesta el nombre ARMADO y no solo el número, y por eso existe: la
     * ventana muestra ese nombre en dos sitios —el ejemplo de la pantalla de la
     * carpeta y la lista de verificación— y armarlo allá quería decir tener la
     * convención de nombres escrita también en el renderer, que es justo lo que
     * `nombre-de-sesion.js` existe para evitar. El renderer no puede `require`
     * un módulo del motor, así que la única forma de que haya una sola
     * convención es que la pregunta se conteste de este lado.
     *
     * El número se vuelve a resolver al arrancar: entre ver esto y apretar
     * Iniciar puede pasar media clase.
     */
    /**
     * El glosario de una carpeta, para Ajustes y Preparar.
     */
    ipcMain.handle('glosario-leer', (event, carpeta) => glosarioDe(carpeta));

    /**
     * Guardar el general, el del curso o los dos. Con una clase grabando, la
     * próxima relectura ya usa el nuevo: el general vale para cualquier clase,
     * el del curso solo si es el de la que se graba.
     */
    ipcMain.handle('glosario-guardar', (event, cambio) => {
        const c = cambio || {};
        try {
            if (Array.isArray(c.general)) ajustes.guardar({ ...ajustes.leer(), glosario: c.general });
            if (Array.isArray(c.delCurso) && c.carpeta) glosario.guardarDelCurso(c.carpeta, c.delCurso);
            const enCurso = grabacion.dirEnCurso();
            if (enCurso) grabacion.cambiarGlosario(glosarioDe(enCurso).texto);
            return { ok: true, ...glosarioDe(c.carpeta) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('grabar-preparar-oido', (event, idioma) => grabacion.prepararOido(idioma));
    ipcMain.handle('grabar-soltar-oido', () => grabacion.soltarOido());

    ipcMain.handle('grabar-nombre-siguiente', (event, dir, que) => {
        const q = que || {};
        const numero = q.numero != null && q.numero !== ''
            ? Math.floor(Number(q.numero))
            : grabacion.proximoNumero(dir);
        const vez = grabacion.vezDeLaSiguiente(dir, numero);
        const cuandoMs = Date.now();
        // El curso sale de la carpeta y lo resuelve el motor, no la ventana: eso
        // es lo que impide que el nombre que se ve de ejemplo y el que se graba
        // se separen.
        const curso = nombreDeSesion.cursoPorDefecto(dir);
        return {
            numero,
            vez,
            cuandoMs,
            nombre: nombreDeSesion.armar({ curso, cuandoMs, numero, vez })
        };
    });

    // Tarda lo que tarde releer las últimas tomas con el modelo grande: la
    // ventana espera la respuesta y lo dice mientras tanto.
    ipcMain.handle('grabar-terminar', async () => {
        const salida = await grabacion.terminar();
        anotar('grabar.termina', {
            secuencia: salida && salida.secuencia,
            tomas: salida ? salida.tomas.length : 0
        });
        return salida;
    });

    /**
     * Abrir una sesión ya grabada para mirarla y ajustarla.
     *
     * Contesta el mismo estado que la clase en curso, con `grabando: false`, para
     * que la pantalla de la clase sea UNA (ver `paraMirar`). Puede negarse —una
     * sesión que se está grabando ahora no se abre por acá— y el motivo se
     * muestra tal cual.
     */
    ipcMain.handle('grabar-abrir-grabada', (event, json) => {
        anotar('grabar.abrir-grabada', { json });
        try {
            return { ok: true, estado: grabacion.paraMirar(json) };
        } catch (err) {
            anotar('grabar.abrir-grabada-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    // Cambiar una sesión que ya terminó. Reescribe su XML en el acto, así que
    // la respuesta dice si se pudo: la ventana avisa con eso.
    ipcMain.handle('grabar-editar-grabada', (event, json, cambio) => {
        anotar('grabar.editar-grabada', { json, toma: cambio && cambio.toma, tipo: cambio && cambio.tipo });
        try {
            return { ok: true, ...grabacion.editarGrabada(json, cambio) };
        } catch (err) {
            anotar('grabar.editar-grabada-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    /**
     * Renombrar y borrar una sesión de la lista.
     *
     * Contestan `{ok, error}` y no el estado pelado: los dos se pueden negar por
     * un motivo que solo el motor conoce —un nombre que chocaría con otra
     * sesión, una que se está grabando ahora mismo— y ese motivo hay que poder
     * mostrarlo tal cual.
     *
     * La confirmación de borrar es de la pantalla y no de acá. Cuando el gesto
     * llega a este renglón ya está decidido, y el motor borra.
     */
    ipcMain.handle('grabar-renombrar', (event, json, cambio) => {
        anotar('grabar.renombrar', { json, numero: cambio && cambio.numero });
        try {
            const r = grabacion.renombrarGrabada(json, cambio);
            anotar('grabar.renombrada', { json, secuencia: r.secuencia, audios: r.audios });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.renombrar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('grabar-borrar', (event, json) => {
        anotar('grabar.borrar', { json });
        try {
            const r = grabacion.borrarGrabada(json);
            anotar('grabar.borrada', { json, secuencia: r.secuencia, audios: r.audios, fotos: r.fotos });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.borrar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('grabar-regenerar', async (event, json) => {
        anotar('grabar.regenerar', { json });
        try {
            const r = await grabacion.regenerar(
                json, aviso => send('grabar-aviso', aviso), grabacion.enCurso(),
                glosarioDe(workspace.sesionDelSidecar(json).base).texto);
            anotar('grabar.regenerada', { json, tomas: r.tomas, sinAudio: r.sinAudio });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.regenerar-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    // Reescribir el XML con el molde de hoy, sin releer nada (`rehacerXml`).
    ipcMain.handle('grabar-rehacer-xml', (event, json) => {
        anotar('grabar.rehacer-xml', { json });
        try {
            const r = grabacion.rehacerXml(json);
            anotar('grabar.xml-rehecho', { json, tomas: r.tomas });
            return { ok: true, ...r };
        } catch (err) {
            anotar('grabar.rehacer-xml-falla', { json, error: err.message });
            return { ok: false, error: err.message };
        }
    });

    // Si había una grabación en curso al cerrar la app, se cierra lo abierto: la
    // cabecera del WAV queda con el tamaño real y el XML con lo último que pasó.
    // La sesión NO queda marcada como terminada, así que se puede reanudar:
    // cerrar la app en medio de un rodaje no puede costar la clase.
    // En `will-quit` y no en `before-quit`: ese lo puede cancelar quien
    // pregunta si terminar la clase (`main.js`), y un `preventDefault` no
    // frena a los demás oyentes. Acá la salida ya es segura.
    app.on('will-quit', () => {
        // El ayudante primero: si siguiera mandando mientras se cierra la
        // sesión, el último pedazo podría llegar a una sesión que ya no está.
        try { audioApp.cerrar(); } catch (e) { /* ya estaba cerrado */ }
        try { grabacion.apagar(); } catch (e) { /* ya estaba cerrado */ }
    });
}

module.exports = { registrar };
