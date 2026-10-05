'use strict';
/**
 * tools/medir-sincronia.js — ¿Se oye donde se ve, en el montaje de la revisión?
 *
 *   npx electron . --guion=tools/medir-sincronia.js --sesion=/ruta/a/una/copia
 *
 * El montaje de la revisión son dos `<video>` sueltos que arrancan con dos
 * `play()` seguidos: uno trae la imagen que se mira (la pantalla, entera) y el
 * otro el sonido (la cámara, en la esquina). Nada los ata más que haber
 * arrancado casi a la vez. Si uno tarda más que el otro en empezar a
 * decodificar —y la pantalla, 1080p con intervalos de keyframe largos, tarda—
 * la distancia que se abra en ese instante se queda ahí toda la reproducción.
 *
 * Esto la mide con una grabación de verdad. Carga el módulo que se está
 * probando —`src/js/semanal/montaje.js`, el mismo que corre en la app— le da el
 * plan que contesta `semanal-montaje`, aprieta Reproducir, y cada 100 ms anota
 * en qué segundo va cada uno. La distancia entre los dos es, en milisegundos,
 * lo que el ojo ve de más o de menos que lo que el oído oye.
 *
 * La vara no es una opinión: la EBU R37 pide el sonido entre 60 ms detrás y
 * 20 ms delante de la imagen, y la ITU-R BT.1359 mide que se empieza a notar a
 * los 45 ms si va delante y a los 125 ms si va detrás. Un montaje de trabajo
 * puede ser más flojo que una emisión, pero no puede pasarse de lo que se nota:
 * si se nota, no se puede juzgar el corte, que es para lo único que existe.
 *
 * **Lee la sesión, no la escribe.** Se le pasa una copia con `--sesion=`.
 */

const fs = require('fs');
const path = require('path');

const espera = ms => new Promise(r => setTimeout(r, ms));

/** Cada cuánto se mira, y cuánto rato. */
const CADA_MS = 100;
const RATO_MS = 10000;

/**
 * Hasta cuándo se considera que todavía está arrancando.
 *
 * El lazo cierra la diferencia con un cambio de velocidad proporcional al error
 * —el doble— así que la cierra en medio segundo, venga de donde venga. Un
 * segundo es ese medio con margen.
 */
const ARRANQUE_MS = 1000;

/** Lo que la EBU R37 admite, en milisegundos. El signo es el del adelanto. */
const EBU_DELANTE = 20;
const EBU_DETRAS = 60;

/** El sidecar de la sesión: es por donde entra todo lo demás. */
function elJsonDe(sesion) {
    const dir = path.join(sesion, 'xml', 'Datos');
    if (!fs.existsSync(dir)) return null;
    const uno = fs.readdirSync(dir).find(n => n.endsWith('_notas-en-vivo.json'));
    return uno ? path.join(dir, uno) : null;
}

async function correr({ win, arg }) {
    const sesion = arg('sesion');
    const json = sesion && elJsonDe(sesion);
    if (!json) {
        console.error('medir-sincronia: hace falta --sesion=/ruta a una carpeta ya grabada'
            + ' (con su xml/Datos/..._notas-en-vivo.json)');
        process.exitCode = 1;
        return;
    }
    console.log(`\n── ¿Se oye donde se ve? · ${path.basename(json)}\n`);

    const js = s => win.webContents.executeJavaScript(s);
    win.webContents.on('console-message', (_e, _n, texto) => console.log(`      ${texto}`));

    await js(`(async () => {
        await window.nt.ajustesGuardar({ modo: 'semanal',
            semanal: { carpeta: ${JSON.stringify(sesion)} } });
        await dev.app.irASemanal();
    })()`);
    await espera(400);

    // El montaje de verdad, con el plan de verdad. Se monta en el hueco de la
    // pantalla semanal para que herede su CSS: el tamaño y la esquina de la
    // cámara salen de ahí, y medir sobre un montaje sin estilo mediría otra cosa.
    const puesto = await js(`(async () => {
        const mo = await import('./js/semanal/montaje.js');
        const tj = await import('./js/semanal/tarjetas.js');
        window.__sinc = { mo };
        const m = await window.nt.semanalMontaje(${JSON.stringify(json)});
        if (!m.ok) return { ok: false, error: m.error };
        const plan = { ...m, archivos: {
            camara: m.archivos.camara ? tj.urlDeArchivo(m.archivos.camara) : null,
            pantalla: m.archivos.pantalla ? tj.urlDeArchivo(m.archivos.pantalla) : null
        } };
        const hueco = document.querySelector('#semanal-cuerpo');
        hueco.innerHTML = '';
        mo.montar(hueco);
        mo.poner(plan);
        await new Promise(r => setTimeout(r, 1200));
        return { ok: true, tomas: plan.tomas, avisos: m.avisos || [] };
    })()`);
    if (!puesto.ok) {
        console.error(`   no pude armar el montaje: ${puesto.error}`);
        process.exitCode = 1;
        return;
    }
    for (const a of puesto.avisos) console.log(`   aviso: ${a}`);

    // Hay que medir una toma con los dos a la vez: es la única donde se ve una
    // fuente y se oye la otra, y por lo tanto la única donde el desfase existe.
    const toma = puesto.tomas.find(t => t.fondo === 'pantalla' && t.conAudio
        && t.camaraDesde != null && !t.descartada);
    if (!toma) {
        console.log('   esta sesión no tiene ninguna toma de pantalla con la cámara al lado:');
        console.log('   son las únicas donde se ve una fuente y se oye la otra. Nada que medir.');
        return;
    }
    console.log(`   toma ${toma.id}: pantalla de fondo, cámara en la esquina,`
        + ` ${toma.segundos.toFixed(2)} s`);
    console.log(`   el segundo ${toma.pantallaDesde} de la pantalla`
        + ` y el ${toma.camaraDesde} de la cámara\n`);

    await js(`(async () => {
        window.__sinc.mo.irA(${toma.id});
        await new Promise(r => setTimeout(r, 600));
        window.__sinc.mo.alternar();
    })()`);

    const muestras = [];
    const desde = Date.now();
    while (Date.now() - desde < RATO_MS) {
        await espera(CADA_MS);
        const m = await js(`(() => {
            const pan = document.querySelector('.montaje-pan');
            const cam = document.querySelector('.montaje-cam');
            if (!pan || !cam) return null;
            return { pan: pan.currentTime, cam: cam.currentTime,
                     quietos: pan.paused && cam.paused };
        })()`);
        if (!m || m.quietos) break;
        // Lo que el oído adelanta al ojo: dónde va la cámara —que es lo que se
        // oye— menos dónde tendría que ir según dónde va la pantalla, que es lo
        // que se ve. Positivo es que el sonido va DELANTE de la imagen.
        const deberia = toma.camaraDesde + (m.pan - toma.pantallaDesde);
        muestras.push({ ms: Date.now() - desde, adelanto: Math.round((m.cam - deberia) * 1000) });
    }

    if (!muestras.length) {
        console.error('   no salió ni una muestra: el montaje no se movió');
        process.exitCode = 1;
        return;
    }

    for (const x of muestras.filter((_, i) => i % 8 === 0)) {
        const señal = x.adelanto > 0 ? 'el sonido va delante' : 'el sonido va detrás';
        console.log(`   t+${String(x.ms).padStart(5)} ms   ${String(x.adelanto).padStart(6)} ms`
            + `   ${Math.abs(x.adelanto) <= 5 ? 'juntos' : señal}`);
    }

    // El arranque y el resto se miden aparte, porque son dos cosas distintas y
    // se arreglan distinto. Mientras arranca, los dos `<video>` todavía están
    // abriendo: la diferencia que haya ahí la cierra el lazo en medio segundo.
    // Lo que importa para juzgar un corte es lo de después, que es donde se
    // pasan los minutos. Juntarlos en un solo número dejaba el pico del arranque
    // mandando sobre diez segundos de reproducción buena.
    const corte = ARRANQUE_MS;
    const peorDe = xs => xs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    const medioDe = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const arranque = muestras.filter(x => x.ms <= corte).map(x => x.adelanto);
    const resto = muestras.filter(x => x.ms > corte).map(x => x.adelanto);
    const todos = muestras.map(x => x.adelanto);
    const saltos = todos.filter((x, i) => i && Math.abs(x - todos[i - 1]) > 50).length;

    console.log(`\n   ${muestras.length} muestras · ${saltos} salto(s) de más de 50 ms`);
    console.log(`   arrancando (hasta ${corte} ms): medio ${medioDe(arranque)} ms`
        + ` · peor ${peorDe(arranque)} ms`);
    console.log(`   ya en marcha:                   medio ${medioDe(resto)} ms`
        + ` · peor ${peorDe(resto)} ms`);
    console.log(`   la vara (EBU R37): entre ${-EBU_DETRAS} y +${EBU_DELANTE} ms`);

    const peor = peorDe(resto);
    const fuera = peor > EBU_DELANTE || peor < -EBU_DETRAS;
    console.log(fuera
        ? `\n✗ ya en marcha se oye ${Math.abs(peor)} ms ${peor > 0 ? 'antes' : 'después'}`
            + ' de lo que se ve: está por encima de lo que se nota'
        : '\n✓ se oye donde se ve');
    const picoAlArrancar = peorDe(arranque);
    if (!fuera && (picoAlArrancar > EBU_DELANTE || picoAlArrancar < -EBU_DETRAS)) {
        console.log(`   · al arrancar llega a ${picoAlArrancar} ms y se cierra solo:`
            + ' es el lazo poniéndolos juntos, y se mide para que no crezca sin que nadie mire');
    }
    if (fuera || saltos > 2) process.exitCode = 1;
}

module.exports = { correr, CADA_MS, RATO_MS, ARRANQUE_MS, EBU_DELANTE, EBU_DETRAS };
