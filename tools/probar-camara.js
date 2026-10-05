'use strict';
/**
 * tools/probar-camara.js — ¿Qué entrega la cámara, y aguanta el codificador?
 *
 *   npx electron . --guion=tools/probar-camara.js [--segundos=8]
 *
 * Salió de una grabación que terminó con la cámara en CERO bytes y sin un solo
 * error: el grabador arrancó, el archivo se abrió, y en 71 segundos no llegó ni
 * un trozo. La pantalla de al lado grabó bien. Lo que esto mide, con la cámara
 * de verdad enchufada, es dónde se corta:
 *
 *   1. con qué tamaño abre `ojo.js` la cámara (le pide `ideal: 2560`)
 *   2. si el grabador MP4 entrega trozos a ese tamaño
 *   3. lo mismo acotada a 1920×1080
 *   4. y lo mismo con la pantalla grabando al lado, que es el caso de verdad:
 *      dos sesiones de H.264 a la vez sobre el mismo codificador del Mac
 *
 * No escribe nada en el disco ni toca los ajustes: cuenta trozos y los tira.
 */

const { desktopCapturer } = require('electron');

/** Lo que corre adentro de la ventana, que es la única que tiene los medios. */
function EN_LA_VENTANA(segundos) {
    return `(async () => {
        const dice = [];
        const dato = (...x) => { dice.push(x.join(' ')); console.log('  ', ...x); };

        /** Graba de un stream y devuelve qué llegó. */
        const probar = async (stream, etiqueta, tipo) => {
            const pista = stream.getVideoTracks()[0];
            const s = pista.getSettings();
            let trozos = 0;
            let bytes = 0;
            let roto = null;
            let grabador;
            try {
                grabador = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: 4e6 });
            } catch (e) {
                dato(etiqueta, '· no se pudo ni crear:', e.message);
                return;
            }
            grabador.ondataavailable = e => { if (e.data && e.data.size) { trozos++; bytes += e.data.size; } };
            grabador.onerror = e => { roto = (e.error && e.error.message) || 'sin mensaje'; };
            grabador.start(2000);
            await new Promise(r => setTimeout(r, ${segundos} * 1000));
            try { if (grabador.state !== 'inactive') grabador.stop(); } catch (e) { roto = roto || 'stop tiró'; }
            await new Promise(r => setTimeout(r, 600));
            dato(etiqueta.padEnd(34),
                (s.width + 'x' + s.height).padEnd(11),
                (Math.round(s.frameRate || 0) + ' fps').padEnd(7),
                'pista ' + pista.readyState + (pista.muted ? ' MUDA' : ' con imagen'),
                '·', trozos + ' trozo(s)', Math.round(bytes / 1024) + ' KB',
                roto ? '· ROTO: ' + roto : (trozos ? '· ✓' : '· ✗ NO LLEGÓ NADA'));
        };

        const TIPO = 'video/mp4;codecs="avc1.42E01E"';
        const nombre = (await window.nt.ajustesLeer()).camara;
        dato('cámara de los ajustes:', nombre || '(ninguna)');

        const lista = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'videoinput');
        const cual = lista.find(d => d.label === nombre) || lista[0];
        dato('cámaras enchufadas:', lista.map(d => d.label).join(' · ') || '(ninguna)');

        // 1 y 2 · tal como la abre la app hoy.
        const comoHoy = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cual.deviceId }, width: { ideal: 2560 } }
        });
        await probar(comoHoy, 'como la abre la app hoy', TIPO);

        // 3 · acotada, sin volver a pedirla: la misma pista.
        await comoHoy.getVideoTracks()[0].applyConstraints({
            width: { max: 1920 }, height: { max: 1080 }
        });
        await probar(comoHoy, 'la misma pista, acotada', TIPO);

        // 4 · las dos a la vez, que es como graba el modo semanal.
        const pantalla = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { max: 1920 }, height: { max: 1080 } }
        });
        const aLaVez = [];
        const dos = [
            { s: pantalla, q: 'pantalla, con la cámara al lado' },
            { s: comoHoy, q: 'cámara, con la pantalla al lado' }
        ];
        for (const d of dos) aLaVez.push(probar(d.s, d.q, TIPO));
        await Promise.all(aLaVez);

        // 5 · con el micrófono adentro, que es como graba de verdad: el
        // grabador de la cámara lleva vídeo Y audio en el mismo MP4, y un
        // muxer que espera audio que no llega no entrega NADA de vídeo.
        const TIPO_CON_AUDIO = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
        const micro = (await window.nt.ajustesLeer()).dispositivo;
        const oido = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'audioinput');
        const ese = oido.find(d => d.label === micro) || oido[0];
        dato('micrófono de los ajustes:', micro || '(ninguno)');
        const voz = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: ese.deviceId } }
        });
        const conAudio = new MediaStream([
            ...comoHoy.getVideoTracks(), ...voz.getAudioTracks()
        ]);
        await probar(conAudio, 'cámara + micrófono, como de verdad', TIPO_CON_AUDIO);

        // 6 · y el mecanismo: si la pista de vídeo muere a mitad, ¿avisa o
        // calla? De esto depende si un vigilante tiene que mirar los bytes o
        // le alcanza con escuchar a la pista.
        const sola = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cual.deviceId }, width: { max: 1280 } }
        });
        const g = new MediaRecorder(sola, { mimeType: TIPO, videoBitsPerSecond: 4e6 });
        let avisoDeRoto = null;
        let trozosAntesDeMorir = 0;
        g.onerror = e => { avisoDeRoto = (e.error && e.error.message) || 'sin mensaje'; };
        g.ondataavailable = e => { if (e.data && e.data.size) trozosAntesDeMorir++; };
        const pistaSola = sola.getVideoTracks()[0];
        let murio = false;
        pistaSola.onended = () => { murio = true; };
        g.start(2000);
        await new Promise(r => setTimeout(r, 1500));
        pistaSola.stop();                     // la mato a mitad, a propósito
        await new Promise(r => setTimeout(r, 4000));
        try { if (g.state !== 'inactive') g.stop(); } catch (e) { /* ya está */ }
        await new Promise(r => setTimeout(r, 600));
        dato('pista muerta a mitad'.padEnd(34), ''.padEnd(11), ''.padEnd(7),
            'onended ' + (murio ? 'SÍ avisó' : 'no avisó'),
            '·', trozosAntesDeMorir + ' trozo(s)',
            avisoDeRoto ? '· onerror: ' + avisoDeRoto : '· onerror NO avisó');

        for (const t of [...comoHoy.getTracks(), ...pantalla.getTracks(),
            ...voz.getTracks(), ...sola.getTracks()]) t.stop();
        return dice.join('\\n');
    })()`;
}

async function correr({ win, arg }) {
    const segundos = Number(arg('segundos') || 8);
    console.log('\n── Qué entrega la cámara, y si el codificador la aguanta\n');

    // El selector de pantalla de macOS no se puede contestar desde afuera: se
    // le da la primera pantalla y listo, que acá es relleno para que la cámara
    // tenga una segunda sesión de H.264 al lado.
    win.webContents.session.setDisplayMediaRequestHandler(async (_req, callback) => {
        const fuentes = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: fuentes[0] });
    }, { useSystemPicker: false });

    try {
        await win.webContents.executeJavaScript(EN_LA_VENTANA(segundos));
    } catch (e) {
        console.log('   se rompió:', e.message);
    }
    console.log('');
}

module.exports = { correr };
