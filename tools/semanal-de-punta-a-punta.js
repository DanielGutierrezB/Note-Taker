'use strict';
/**
 * tools/semanal-de-punta-a-punta.js — El modo semanal entero, sin manos.
 *
 *   npx electron . --use-fake-device-for-media-stream \
 *       --guion=tools/semanal-de-punta-a-punta.js [--segundos=12]
 *
 * Es la única forma de comprobar el modo semanal como se usa: con la cámara
 * grabando de verdad desde la ventana, el micrófono entrando por el puente, el
 * motor abriendo y cerrando tomas, y ffmpeg cortando al final. Las pruebas de
 * `node tests/run.js` cubren el reparto y el grafo, que es la parte que se
 * puede comprobar sin medios; esto cubre lo que no: que lo que graba la ventana
 * sea lo que ffmpeg puede abrir, y que los relojes de los tres archivos caigan
 * donde tienen que caer.
 *
 * La cámara es la falsa de Chromium (`--use-fake-device-for-media-stream`): un
 * patrón que se mueve, que es justo lo que hace falta para ver si el recorte
 * cayó donde se pidió.
 *
 * **Y la pantalla es la pantalla de verdad.** El selector de macOS no se puede
 * contestar desde afuera, así que se reemplaza SOLO el selector: en su lugar se
 * devuelve la pantalla por la vía de `desktopCapturer`, y todo lo demás —el
 * tope de tamaño, la prueba del codificador, los dos grabadores, el corte— corre
 * tal cual. Importa que sea así y no una pantalla inventada: la que llega por
 * esta vía entra a 5120×3200, que es exactamente el tamaño que el H.264 del Mac
 * rechaza, y por lo tanto esta corrida comprueba que el tope lo salva.
 *
 * Las tomas se abren y se cierran por el puente, igual que hace la tecla Enter
 * en la pantalla de clase: el micrófono falso es un pitido y Whisper no va a oír
 * ningún «3, 2, 1» en él. La vista de cada toma y el descarte sí se aprietan en
 * la pantalla, que es lo que hay que ejercitar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { desktopCapturer } = require('electron');

const paths = require('../engine/paths');
const workspace = require('../engine/workspace');
const mejorar = require('../engine/mejorar-audio');

const espera = ms => new Promise(r => setTimeout(r, ms));

/**
 * Preguntarle a la ventana hasta que conteste algo, o rendirse.
 *
 * Devuelve `null` si no contestó nunca, y el que pregunta decide si eso es un
 * fallo. Dormir un rato fijo y mirar una vez es lo que hace que una corrida
 * pase en esta máquina y falle en otra más lenta.
 */
async function esperarA(js, expresion, cuanto = 8000) {
    for (let i = 0; i < Math.ceil(cuanto / 200); i++) {
        const r = await js(expresion);
        if (r !== null && r !== undefined && r !== false) return r;
        await espera(200);
    }
    return null;
}

/** Lo que la ventana tiene que contar de vuelta en cada paso. */
const EN_LA_VENTANA = {
    async preparar(carpeta) {
        return `(async () => {
            dev.app.ajustes = (await window.nt.ajustesGuardar({
                modo: 'semanal', semanal: { carpeta: ${JSON.stringify(carpeta)} }
            })).ajustes;
            await dev.app.irASemanal();
            return 'modo semanal, carpeta puesta';
        })()`;
    }
};

async function correr(contexto) {
    // **Los ajustes de quien corre esto no se tocan**, y no por cuidado sino
    // por construcción: esta corrida escribe en otro archivo.
    //
    // Hace falta escribir ajustes —modo semanal, una carpeta de /tmp— y además
    // la app guarda por su cuenta, mientras graba, el micrófono y la cámara que
    // usó, que acá son los falsos de Chromium. El primer intento fue leerlos al
    // empezar y devolverlos en un `finally`. Funciona cuando todo va bien, que
    // es cuando no hace falta. Cuando no: la ventana no se cerraba sola al
    // terminar, hubo que matarla, el `finally` no corrió, y los ajustes de
    // verdad quedaron con `Fake Default Audio Input` de micrófono y la carpeta
    // semanal apuntando a un /tmp borrado. Pasó de verdad, en esta misma
    // máquina.
    //
    // `NT_AJUSTES` lo mueve antes de que exista la ventana (`engine/ajustes.js`).
    // Un archivo que no se toca no se puede romper, por mal que salga esto.
    if (!process.env.NT_AJUSTES) {
        throw new Error('esto escribe ajustes: hay que correrlo con NT_AJUSTES'
            + ' apuntando a un archivo de prueba, o `dev-shot.js` no lo desvió');
    }
    console.log(`   ajustes de esta corrida: ${process.env.NT_AJUSTES}`);
    return laPasada(contexto);
}

async function laPasada({ win, arg }) {
    const segundos = Number(arg('segundos')) || 12;
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-semanal-punta-'));
    const js = texto => win.webContents.executeJavaScript(texto);

    // Lo que se dice por el camino, y lo que estaba mal. Las que empiezan con
    // «✗» se cuentan y hacen que la corrida salga con error: imprimir un fallo
    // y salir con cero no es una red, es un informe que nadie mira.
    let mal = 0;
    const decir = (...x) => {
        if (String(x[0] || '').startsWith('✗')) mal++;
        console.log('  ', ...x);
    };

    /**
     * Rendirse a mitad del camino. Se TIRA, no se devuelve.
     *
     * Cortar con `return` se saltaba también el recuento del final, así que la
     * corrida imprimía su «✗» y salía con cero: en una consola se ve, en una
     * tubería o en CI no se ve nada y parece que fue bien. Lo que se tira acá lo
     * recoge `dev-shot.js`, que sale con uno.
     */
    const rendirse = porque => {
        throw new Error(mal ? `${porque} · y ${mal} comprobación(es) mal antes` : porque);
    };

    console.log(`\n── El modo semanal, de punta a punta · ${carpeta}\n`);

    decir(await js(await EN_LA_VENTANA.preparar(carpeta)));
    await espera(2500);                       // que abra el micro y la cámara

    // El selector del sistema, y nada más que él. Lo que devuelve es la
    // pantalla de verdad, sin acotar: así el tope de `filmar.js` tiene algo
    // que acotar, que es lo que se quiere comprobar.
    const fuentes = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1, height: 1 }
    });
    if (!fuentes.length) {
        return rendirse('No hay ninguna pantalla que capturar.');
    }
    // El selector se contesta en la capa de Electron y NO reemplazando
    // `getDisplayMedia` en la página.
    //
    // Es la diferencia entre probar y no probar. La app llama con
    // `{ video: { width: { max: MAX_ANCHO }, height: { max: MAX_ALTO } } }`, y un
    // doble puesto en la página que no recibe argumentos tira esas condiciones a
    // la basura: lo que se medía después era solo lo que hace `acotar()` con
    // `applyConstraints`, y el tope del `getDisplayMedia` —la primera defensa
    // contra el fallo que costó una grabación entera— no se ejecutaba nunca.
    // Contestando acá, la llamada de la app corre tal como está escrita.
    win.webContents.session.setDisplayMediaRequestHandler((_pedido, contestar) => {
        contestar({ video: fuentes[0] });
    }, { useSystemPicker: false });
    decir('eligiendo la pantalla…');
    const pantalla = await js(`(async () => {
        document.querySelector('[data-hace="elegir-pantalla"]').click();
        await new Promise(r => setTimeout(r, 2500));
        const v = document.querySelector('#semanal-pantalla');
        const pista = v && v.srcObject && v.srcObject.getVideoTracks()[0];
        const s = pista ? pista.getSettings() : null;
        return s ? s.width + 'x' + s.height : 'no quedó elegida';
    })()`);
    decir('la pantalla entra a', pantalla, '(sin el tope entraría a 5120x3200, que el H.264 rechaza)');

    const listo = await js(`(() => {
        const sel = document.querySelectorAll('#semanal-cuerpo select');
        return {
            camara: sel[0] ? sel[0].value : null,
            micro: sel[1] ? sel[1].value : null,
            puedeGrabar: !document.querySelector('[data-hace="grabar"]').disabled
        };
    })()`);
    decir('cámara:', listo.camara || '(ninguna)', '· micrófono:', listo.micro || '(ninguno)');
    if (!listo.puedeGrabar) {
        return rendirse('El botón de grabar está apagado:'
            + ' sin micrófono no hay nada que medir.');
    }

    decir('apretando Grabar…');
    await js(`document.querySelector('[data-hace="grabar"]').click()`);
    await espera(3000);
    const grabando = await js(`(() => ({
        paso: document.querySelector('#semanal-reloj').hidden ? 'no graba' : 'graba',
        reloj: document.querySelector('#semanal-reloj').textContent
    }))()`);
    decir('estado:', grabando.paso, '· reloj:', grabando.reloj);

    /* ── Tres tomas, con un hueco en medio ───────────────────────────────
     *
     * El hueco es lo que NO tiene que salir en el vídeo, y por eso es la
     * medida que importa. Las tres se usan para algo distinto: la primera con
     * la pantalla (lo de fábrica), la segunda con la cámara eligiéndolo ENTRE
     * tomas —que es el gesto que se pidió— y la tercera para descartarla
     * después, en la revisión.
     */
    const quiere = { 1: 'R', 2: 'PV', 3: 'R' };
    for (const n of [1, 2, 3]) {
        if (n > 1) {
            // Entre tomas, con la pausa hecha: elegir y seguir.
            await js(`document.querySelector('[data-hace="vista"][data-vista="${quiere[n]}"]').click()`);
            decir(`entre tomas: elegida la vista ${quiere[n]}`);
        }
        await js(`window.nt.grabarAbrirToma()`);
        decir(`toma ${n}: abierta`);
        // Más de un segundo: la vista se le pone a la toma en la vuelta del
        // reloj siguiente a que aparezca (`ponerLaVista`).
        await espera((segundos / 4) * 1000);
        await js(`window.nt.grabarCerrarToma()`);
        decir(`toma ${n}: cerrada`);
        await espera((segundos / 6) * 1000);
    }

    /* ── La ficha de una toma, mientras se sigue grabando ────────────────
     *
     * Es lo que se pidió después del primer vídeo de verdad: una toma que
     * salió mal se nota al terminar de decirla, no al final de todo. Acá se
     * comprueba lo que de verdad hace falta que funcione —que la ficha trae el
     * texto de ESA toma y que el borde soltado llega al motor— y no que la
     * lista exista.
     */
    const ficha = await js(`(async () => {
        const fila = document.querySelector('#semanal-cuerpo [data-hace="plegar"][data-toma="2"]');
        if (!fila) return { error: 'la toma 2 no tiene ficha' };
        fila.click();
        await new Promise(r => setTimeout(r, 300));
        const caja = document.querySelector('#semanal-cuerpo [data-texto="cerrada"][data-toma="2"]');
        const antes = await window.nt.grabarEstado();
        const t2 = (antes.tomas || []).find(t => t.id === 2);
        // El conteo y el movimiento salen del MISMO estado: el transcript
        // sigue creciendo mientras corre esto, y mirarlo dos veces daba dos
        // respuestas distintas —cuatro palabras dibujadas y ninguna que
        // mover— que no es nada de lo que se está probando.
        const palabras = (t2 && t2.palabras) || [];
        return {
            texto: Boolean(caja),
            dibujadas: [...(caja ? caja.querySelectorAll('.palabra') : [])].length,
            palabras: palabras.length,
            inMs: t2 ? t2.inMs : null,
            // El IN no puede entrar en la toma de antes: moverBorde lo topa
            // en su OUT. Acá hace falta saberlo porque el micrófono falso de
            // Chromium escribe el audio más rápido que el reloj, las palabras
            // quedan corridas, y la segunda de la toma 2 puede caer —según
            // cuánto haya derivado esa corrida— antes de que la toma 2 empiece.
            pisoMs: (() => {
                const uno = (antes.tomas || []).find(t => t.id === 1);
                return uno ? uno.outMs : null;
            })(),
            // La segunda si la hay, y si no la última: lo que se prueba es que
            // el borde soltado sobre una palabra caiga en esa palabra.
            mueveA: palabras.length > 1 ? palabras[1].t : null
        };
    })()`);
    if (ficha.error) decir('✗', ficha.error);
    else decir(`ficha de la toma 2 abierta: ${ficha.palabras} palabra(s) en su texto`
        + `, ${ficha.dibujadas} dibujada(s)`);

    // Y el borde movido por donde lo mueve el arrastre: la misma llamada.
    if (ficha.mueveA != null) {
        const movido = await js(`(async () => {
            const r = await window.nt.grabarEditar({
                tipo: 'borde', toma: 2, borde: 'in', paredMs: ${ficha.mueveA} });
            const d = (r.tomas || []).find(t => t.id === 2);
            return { a: d ? d.inMs : null };
        })()`);
        const esperado = ficha.pisoMs != null
            ? Math.max(ficha.mueveA, ficha.pisoMs) : ficha.mueveA;
        decir(`el IN de la toma 2 se movió de ${ficha.inMs} a ${movido.a} ms` +
            ` (se pidió ${ficha.mueveA}` +
            (esperado !== ficha.mueveA ? `, topado en el OUT de la toma 1` : '') + ')');
        if (movido.a !== esperado) decir('✗ el motor no lo puso donde se pidió');
    } else {
        decir('la toma 2 no tiene dos palabras que oír: no hay borde que mover');
    }
    await js(`document.querySelector('#semanal-cuerpo [data-hace="plegar"][data-toma="2"]').click()`);

    decir('apretando Terminar…');
    await js(`document.querySelector('[data-hace="terminar"]').click()`);

    /* ── El editor del corte final ───────────────────────────────────── */
    let cuantas = 0;
    for (let i = 0; i < 120; i++) {
        await espera(1000);
        cuantas = await js(`document.querySelectorAll('#semanal-cuerpo .linea-toma').length`);
        if (cuantas) break;
    }
    if (!cuantas) {
        return rendirse('El editor no llegó a dibujarse.');
    }

    // Lo que la maqueta no puede contestar: que los dos `<video>` apunten a los
    // archivos que se acaban de grabar, que carguen desde `file:` con la CSP de
    // la app puesta, y que cada toma caiga dentro de lo que dura el archivo.
    console.log('\n── El editor del corte final\n');
    const cargados = await js(`(async () => {
        const v = [...document.querySelectorAll('.montaje video')];
        await Promise.all(v.map(x => new Promise(r => {
            if (x.readyState >= 1) return r();
            x.addEventListener('loadedmetadata', r, { once: true });
            x.addEventListener('error', r, { once: true });
            setTimeout(r, 8000);
        })));
        return v.map(x => ({
            clase: x.className,
            esquema: (x.currentSrc || '').slice(0, 7),
            dura: Math.round(x.duration * 100) / 100,
            tamano: x.videoWidth + 'x' + x.videoHeight,
            error: x.error ? x.error.code : null
        }));
    })()`);
    for (const v of cargados) {
        decir(v.error
            ? `✗ ${v.clase} no cargó (error ${v.error})`
            : `${v.clase.padEnd(26)} ${v.tamano} · ${v.dura} s · desde ${v.esquema}`);
    }

    // Cada toma: en qué segundo de qué archivo cae, qué se ve y cuánto texto
    // trae. Es lo que hace falta para decidir, así que es lo que hay que
    // comprobar que está.
    for (let n = 1; n <= 12; n++) {
        const f = await js(`(async () => {
            const dela = () => document.querySelector('#semanal-cuerpo .linea-toma[data-toma="${n}"]');
            if (!dela()) return null;
            dela().click();
            await new Promise(r => setTimeout(r, 400));
            // Todo dentro de la pantalla semanal: la de clase sigue en el
            // documento, escondida, y sus tarjetas contestan a los mismos
            // selectores. Buscar en todo el documento leía las de ella.
            // (Y sin comillas invertidas en estos comentarios: van dentro de
            // una plantilla, así que una sola la cerraría a mitad.)
            const aca = document.querySelector('#semanal-cuerpo');
            const texto = aca.querySelector('[data-texto="cerrada"][data-toma="${n}"]');
            const puesta = aca.querySelector('.semanal-vistas [aria-pressed="true"]');
            const v = [...aca.querySelectorAll('.montaje video')]
                .filter(x => x.style.display !== 'none');
            return {
                toma: (aca.querySelector('.tarjeta-cabeza .v1') || {}).textContent.trim(),
                dura: (aca.querySelector('.tarjeta-cabeza .v3') || {}).textContent.trim(),
                sale: puesta ? puesta.textContent.trim() : '?',
                seVe: v.map(x => x.className.replace('montaje-', '')).join(' + '),
                donde: v.map(x => Math.round(x.currentTime * 100) / 100).join(' / '),
                pasado: v.some(x => x.duration && x.currentTime > x.duration),
                hueco: Boolean(texto),
                palabras: texto ? texto.querySelectorAll('.palabra').length : 0
            };
        })()`);
        if (!f) continue;
        decir(`${f.toma} (${f.dura}): sale ${f.sale} · se ve ${f.seVe}`
            + ` · buscó el segundo ${f.donde} · ${f.palabras} palabra(s) de texto`);
        // Sin hueco es que el editor no cargó el texto de la sesión: eso es el
        // fallo. Cero palabras con hueco es que no se oyó nada, que con el
        // micrófono falso de Chromium es lo esperable.
        if (!f.hueco) decir('✗ esa toma no trajo su texto: no se puede editar a partir de él');
        if (f.pasado) decir('✗ buscó más allá del final del archivo');
        if (!f.seVe) decir('✗ no se ve ninguno de los dos vídeos');
    }

    // Y que reproduzca de verdad: el reloj tiene que moverse.
    decir('apretando Reproducir…');
    await js(`document.querySelector('[data-hace="reproducir"]').click()`);
    const reloj = () => js(`(document.querySelector('#semanal-montado') || {}).textContent`);
    const antesDePlay = await reloj();
    await espera(2500);
    const despues = await reloj();
    decir(`el reloj del montaje: ${antesDePlay} → ${despues}`);
    if (antesDePlay === despues) decir('✗ el montaje no se movió: no está reproduciendo');
    await js(`document.querySelector('[data-hace="reproducir"]').click()`);

    decir('dejando fuera la toma 3…');
    await js(`document.querySelector('.linea-toma[data-toma="3"]').click()`);
    await espera(350);
    await js(`document.querySelector('[data-hace="fuera"][data-toma="3"]').click()`);
    await espera(700);
    const linea = await js(`[...document.querySelectorAll('.linea-toma')]
        .map(b => b.dataset.toma + ':' + b.dataset.fuera).join(' ')`);
    decir('la línea de tomas queda:', linea);
    if (!/3:si/.test(linea)) decir('✗ la toma 3 no quedó marcada como fuera');

    // Las dos opciones vienen encendidas de fábrica, y este primer corte las
    // apaga a propósito: lo que mide es si los bordes caen donde se pidieron,
    // y eso solo se puede comprobar contra un corte que no le haya hecho nada
    // al audio. Encendidas van en el segundo.
    decir('apagando las dos opciones para medir el corte crudo…');
    const apagadas = await js(`(() => {
        for (const campo of ['silencios', 'mejorar-audio']) {
            const b = document.querySelector(\`[data-hace="opcion"][data-campo="\${campo}"]\`);
            if (!b) return 'falta la opción ' + campo;
            if (b.getAttribute('aria-pressed') !== 'true') return campo + ' no venía encendida';
            b.click();
            if (b.getAttribute('aria-pressed') !== 'false') return campo + ' no se apagó';
        }
        return 'ok';
    })()`);
    if (apagadas !== 'ok') decir(`✗ ${apagadas}`);

    decir('apretando Cortar y exportar…');
    await js(`document.querySelector('[data-hace="exportar"]').click()`);

    // Esperar a que la pantalla diga que terminó de cortar, mirando lo que
    // dibuja y no un reloj: cortar tarda lo que tarde.
    let paso = null;
    for (let i = 0; i < 180; i++) {
        await espera(1000);
        paso = await js(`(() => {
            const t = document.querySelector('#semanal-titulo').textContent;
            const nivel = document.querySelector('#semanal-cuerpo .nivel-barra');
            return { titulo: t, pct: nivel ? nivel.style.width : null };
        })()`);
        if (/listo|No se pudo/.test(paso.titulo)) break;
        if (i % 5 === 0) decir(`${paso.titulo}${paso.pct ? ` · ${paso.pct}` : ''}…`);
    }
    decir('la pantalla dice:', paso && paso.titulo);

    // Que el reproductor abra el archivo de verdad. Es lo único de esta
    // pantalla que la maqueta no puede comprobar: allá el vídeo lo sirve un
    // servidor por http y acá tiene que salir del disco, con la ruta resuelta
    // contra una página `file:` y la política de contenido de la app puesta.
    const visor = await js(`(async () => {
        const v = document.querySelector('.semanal-visor');
        if (!v) return { hay: false };
        if (v.readyState < 1) {
            await new Promise(r => {
                v.addEventListener('loadedmetadata', r, { once: true });
                v.addEventListener('error', r, { once: true });
                setTimeout(r, 8000);
            });
        }
        return { hay: true, src: v.currentSrc.slice(0, 7), ancho: v.videoWidth,
                 alto: v.videoHeight, dura: Math.round(v.duration * 100) / 100,
                 error: v.error ? v.error.code : null };
    })()`);
    decir(visor.hay && visor.ancho
        ? `el reproductor abrió el vídeo: ${visor.ancho}x${visor.alto} · ${visor.dura} s`
            + ` · desde ${visor.src}`
        : `✗ el reproductor no pudo abrir el vídeo (${JSON.stringify(visor)})`);

    /* ── Y ahora lo que quedó en el disco ─────────────────────────────── */
    console.log('\n── Lo que quedó en el disco\n');

    /* ── Una grabación, una carpeta ───────────────────────────────────────
     *
     * En la carpeta que se elige no cae nada suelto: cae UNA carpeta
     * «Grabación-<fecha>_<hora>» con el vídeo, los brutos, el audio y el xml
     * adentro. Así mandar o borrar una grabación es mandar o borrar una
     * carpeta, en vez de reconocer qué cinco archivos de los veinte que hay
     * eran de la del martes.
     *
     * Esto se comprueba acá y no solo en las pruebas porque es lo único que
     * mira dónde caen los archivos DE VERDAD: las pruebas miran la función que
     * arma el nombre, no el disco después de grabar.
     */
    const dentro = fs.readdirSync(carpeta, { withFileTypes: true })
        .filter(d => d.isDirectory() && workspace.esCarpetaDeGrabacion(d.name))
        .map(d => d.name);
    if (dentro.length !== 1) {
        return rendirse(`esperaba UNA carpeta «${workspace.CARPETA_GRABACION}-…»`
            + ` en la elegida y hay ${dentro.length}.`
            + ` Lo que hay: ${fs.readdirSync(carpeta).join(', ') || '(nada)'}`);
    }
    const casa = path.join(carpeta, dentro[0]);
    const suelto = fs.readdirSync(carpeta).filter(f => f !== dentro[0]);
    if (suelto.length) decir(`✗ quedó algo fuera de la carpeta: ${suelto.join(', ')}`);
    decir(`carpeta ${dentro[0]}`);

    const mp4 = fs.readdirSync(casa).filter(f => f.endsWith('.mp4'));
    const brutos = fs.existsSync(workspace.videoDir(casa))
        ? fs.readdirSync(workspace.videoDir(casa)) : [];
    const audios = fs.existsSync(workspace.audioDir(casa))
        ? fs.readdirSync(workspace.audioDir(casa)) : [];

    const mide = ruta => {
        const salida = execFileSync(paths.ffprobe().path, ['-v', 'error',
            '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height',
            '-of', 'default=nw=1', ruta], { encoding: 'utf8' });
        const d = /duration=([\d.]+)/.exec(salida);
        const pistas = [...salida.matchAll(/codec_name=(\w+)/g)].map(m => m[1]);
        const tam = /width=(\d+)\nheight=(\d+)/.exec(salida);
        return {
            segundos: d ? Number(d[1]).toFixed(2) : '?',
            pistas: pistas.join('+'),
            tamano: tam ? `${tam[1]}x${tam[2]}` : ''
        };
    };

    /** La sonoridad de un MP4, en LUFS. ffmpeg la escribe en su registro. */
    const sonoridad = ruta => {
        const r = spawnSync(paths.ffmpeg().path,
            ['-v', 'info', '-nostdin', '-i', ruta, '-af', 'ebur128', '-f', 'null', '-'],
            { encoding: 'utf8', maxBuffer: 1 << 26 });
        const m = /Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)/.exec(r.stderr || '');
        return m ? Number(m[1]) : NaN;
    };

    for (const f of brutos) {
        const r = mide(path.join(workspace.videoDir(casa), f));
        decir(`bruto  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas} · ${r.tamano}`);
    }
    for (const f of audios) {
        const r = mide(path.join(workspace.audioDir(casa), f));
        decir(`audio  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas}`);
    }
    if (!mp4.length) {
        return rendirse(`No salió ningún MP4 en ${casa}.`);
    }
    for (const f of mp4) {
        const ruta = path.join(casa, f);
        const r = mide(ruta);
        const megas = (fs.statSync(ruta).size / 1e6).toFixed(1);
        decir(`VÍDEO  ${f.padEnd(44)} ${r.segundos} s · ${r.pistas} · ${r.tamano} · ${megas} MB`);
    }

    /* ── La cuenta que lo dice todo ───────────────────────────────────────
     *
     * El vídeo tiene que durar lo que duran las tomas. Pero «lo que duran las
     * tomas» está dicho en el reloj del AUDIO, y el vídeo se mide en el reloj
     * de pared: con el micrófono falso de Chromium, que escribe audio a 1,88x,
     * los dos números no se pueden comparar sin corregir la deriva. Es
     * exactamente el cruce que hace `exportar-video.js`, y por eso se repite
     * acá: si esta cuenta no cuadra, el corte está mal.
     */
    const json = fs.readdirSync(workspace.datosDir(casa))[0];
    const estado = JSON.parse(fs.readFileSync(path.join(workspace.datosDir(casa), json), 'utf8'));
    const wav = (estado.sesiones || [])[0];
    const deriva = wav && wav.segundos > 0 ? (wav.hastaMs - wav.desdeMs) / (wav.segundos * 1000) : 1;
    // La descartada no cuenta: dejarla fuera en la revisión tiene que sacarla
    // del vídeo, y esta resta es lo que lo comprueba.
    const van = (estado.tomas || []).filter(t => !t.descartada);
    const suma = van.reduce((s, t) => s + (t.outMs - t.inMs), 0) / 1000;
    const esperada = suma * deriva;
    const dur = Number(mide(path.join(casa, mp4[0])).segundos);
    const pared = (estado.terminada - estado.ceroMs) / 1000;

    console.log(`\n   la grabación duró ${pared.toFixed(1)} s de reloj de pared`);
    console.log(`   el audio se escribió a ${deriva.toFixed(2)}x del reloj`
        + `${Math.abs(deriva - 1) > 0.01 ? ' (el micrófono falso de Chromium: con uno real da 1,00x)' : ''}`);
    const fuera = (estado.tomas || []).length - van.length;
    console.log(`   ${van.length} toma(s)${fuera ? ` (${fuera} dejada fuera en la revisión)` : ''},`
        + ` que suman ${suma.toFixed(2)} s de audio = ${esperada.toFixed(2)} s de pared`);
    console.log(`   el vídeo dura ${dur.toFixed(2)} s · diferencia ${Math.round((dur - esperada) * 1000)} ms`);
    // El margen es de un cuarto de segundo y no de un fotograma por dos cosas
    // que son del micrófono falso y no del corte: su ritmo no es parejo —la
    // deriva se mide sobre todo el WAV, así que un tramo puede ir más rápido
    // que la media— y cada toma pierde hasta un fotograma al recortar. Con un
    // micrófono de verdad la deriva es 1,00x y la diferencia baja a decenas de
    // milisegundos: medido, 14 ms en dos tomas.
    const bien = Math.abs(dur - esperada) < 0.25;
    console.log(`\n   ${bien ? '✓ el corte cae donde se pidió' : '✗ el corte NO cuadra'}`);

    /* ── Y el mismo corte otra vez, con los silencios quitados ───────────
     *
     * Acá no se puede pedir una duración exacta: cuántos silencios hay lo
     * dice el audio, y el de esta corrida es un pitido de Chromium. Lo que se
     * comprueba es la cadena entera —botón, puente, motor, ffmpeg— y que el
     * vídeo salga más corto que el de antes y se siga pudiendo abrir.
     */
    console.log('\n── El mismo corte, con las dos opciones como vienen de fábrica\n');
    await js(`document.querySelector('[data-hace="ajustar"]').click()`);
    await espera(400);
    const comoVienen = await js(`(() => {
        const b = [...document.querySelectorAll('[data-hace="opcion"]')];
        for (const x of b) if (x.getAttribute('aria-pressed') !== 'true') x.click();
        return b.filter(x => x.getAttribute('aria-pressed') === 'true')
            .map(x => x.dataset.campo).join(' + ');
    })()`);
    decir('encendidas:', comoVienen);
    await js(`document.querySelector('[data-hace="exportar"]').click()`);
    let dos = null;
    for (let i = 0; i < 180; i++) {
        await espera(1000);
        dos = await js(`document.querySelector('#semanal-titulo').textContent`);
        if (/listo|No se pudo/.test(dos)) break;
    }
    decir('la pantalla dice:', dos);
    const dichos = await js(`[...document.querySelectorAll('.prproj-avisos li')]
        .map(l => l.textContent.trim())`);
    for (const a of dichos || []) decir(a);
    const nuevos = fs.readdirSync(casa).filter(f => f.endsWith('.mp4') && !mp4.includes(f));
    if (!nuevos.length) {
        decir('✗ el segundo corte no dejó ningún MP4');
    } else {
        const r = mide(path.join(casa, nuevos[0]));
        decir(`VÍDEO  ${nuevos[0].padEnd(44)} ${r.segundos} s · ${r.pistas} · ${r.tamano}`);
        const menos = dur - Number(r.segundos);
        console.log(`\n   ${menos > 0
            ? `✓ dura ${menos.toFixed(2)} s menos que el de antes, y el de antes sigue ahí`
            : '· no había silencios de más de 0,7 s que quitar, así que dura lo mismo'}`);

        // Y que «Mejorar audio» hizo lo que dice. Acá el audio es un pitido de
        // Chromium, así que lo que se comprueba no es que suene bien —un
        // pitido no suena bien de ninguna manera— sino que la cadena corrió de
        // punta a punta y dejó el vídeo donde tenía que dejarlo. Si suena bien
        // con voz de verdad lo dice `tools/medir-audio.js`.
        const antes = sonoridad(path.join(casa, mp4[0]));
        const ahora = sonoridad(path.join(casa, nuevos[0]));
        decir(`sonoridad  ${antes.toFixed(1)} → ${ahora.toFixed(1)} LUFS`
            + `  (destino ${mejorar.DESTINO_LUFS})`);
        const lejos = Math.abs(ahora - mejorar.DESTINO_LUFS);
        console.log(`   ${lejos <= 2
            ? '✓ «Mejorar audio» lo dejó en el destino'
            : `✗ quedó a ${lejos.toFixed(1)} dB del destino: la cadena no corrió`}`);
    }

    /* ── Volver a lo último grabado ────────────────────────────────────────
     *
     * La otra mitad de «una grabación, una carpeta»: si lo grabado no se puede
     * volver a abrir, haberlo guardado ordenado no sirve de nada. Se vuelve al
     * inicio como lo haría cualquiera —«Grabar otro»— y se comprueba que la
     * grabación que se acaba de hacer esté ahí ofrecida, y que abra el editor
     * con las tomas puestas.
     *
     * Esto es lo único que recorre el camino entero: escribir la carpeta,
     * encontrarla de nuevo leyendo el disco, y releer su sidecar. Las pruebas
     * miran cada tramo por separado.
     */
    console.log('\n── Volver a lo último que se grabó\n');
    await js(`document.querySelector('[data-hace="otro"]').click()`);
    const ultima = await esperarA(js, `(() => {
        const b = document.querySelector('[data-hace="abrir-ultima"]');
        return b ? b.closest('.tarjeta').textContent.replace(/\\s+/g, ' ').trim() : null;
    })()`);
    if (!ultima) {
        decir('✗ la pantalla de inicio no ofrece la grabación que se acaba de hacer');
    } else {
        decir(`la ofrece: «${ultima}»`);
        await js(`document.querySelector('[data-hace="abrir-ultima"]').click()`);
        const volvio = await esperarA(js, `(() => {
            const n = document.querySelectorAll('[data-hace="parar-en"]').length;
            return n ? n : null;
        })()`);
        decir(volvio
            ? `abrió el editor con ${volvio} toma(s): se puede seguir cortándola`
            : '✗ abrió, pero sin tomas: la grabación de antes no se releyó');
    }

    console.log(`\n   todo en ${casa}\n`);

    if (mal) {
        console.log(`✗ ${mal} comprobación(es) mal\n`);
        process.exitCode = 1;
    } else {
        console.log('✓ todas las comprobaciones bien\n');
    }
}

module.exports = { correr };
