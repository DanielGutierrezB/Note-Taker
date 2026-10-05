'use strict';
/**
 * tools/probar-pulso.js — Matar la cámara a mitad y ver si la pantalla avisa.
 *
 *   npx electron . --guion=tools/probar-pulso.js
 *
 * Una grabación de verdad terminó con la cámara en cero bytes, cero pedazos y
 * ningún aviso: quien grababa se enteró al llegar a la revisión, con los 71
 * segundos ya grabados. Medido aparte (`tools/probar-camara.js`), si la pista
 * de vídeo muere a mitad NI `onerror` del grabador NI `onended` de la pista
 * dicen nada, así que el único aviso posible es mirarle el pulso a la pista.
 *
 * Esto comprueba que ese pulso llegue hasta donde tiene que llegar: a un
 * renglón fijo en la tarjeta, mientras se graba, con la persona todavía a
 * tiempo de parar. Se graba contra una carpeta temporal y se le mata la pista
 * de la cámara a propósito.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, desktopCapturer } = require('electron');

const espera = ms => new Promise(r => setTimeout(r, ms));

async function correr({ win }) {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pulso-'));
    const js = texto => win.webContents.executeJavaScript(texto);
    const decir = (...x) => console.log('  ', ...x);

    console.log('\n── Si la cámara se muere a mitad, ¿avisa la pantalla?\n');

    const comoEstaban = await js('window.nt.ajustesLeer()');
    await js(`(async () => {
        dev.app.ajustes = (await window.nt.ajustesGuardar({
            modo: 'semanal', semanal: { carpeta: ${JSON.stringify(carpeta)} }
        })).ajustes;
        await dev.app.irASemanal();
    })()`);
    await espera(2500);

    const fuentes = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: 1, height: 1 }
    });
    await js(`(() => {
        navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: ${JSON.stringify(fuentes[0].id)}
            } }
        });
        return true;
    })()`);
    await js(`(async () => {
        document.querySelector('[data-hace="elegir-pantalla"]').click();
        await new Promise(r => setTimeout(r, 2500));
    })()`);

    decir('apretando Grabar…');
    await js('document.querySelector(\'[data-hace="grabar"]\').click()');
    await espera(3000);

    // Con qué entró cada fuente, que es lo que ahora queda anotado.
    const fuente = await js(`(async () => {
        const v = document.querySelector('#semanal-escena-camara')
            || document.querySelector('#semanal-camara');
        const p = v && v.srcObject && v.srcObject.getVideoTracks()[0];
        const s = p ? p.getSettings() : null;
        return s ? s.width + 'x' + s.height : 'sin cámara';
    })()`);
    decir('la cámara entra a', fuente, '(sin el tope entraría a 2560x1440)');

    decir('matándole la pista de la cámara, a propósito…');
    const muerta = await js(`(() => {
        const v = document.querySelector('#semanal-escena-camara')
            || document.querySelector('#semanal-camara');
        const p = v && v.srcObject && v.srcObject.getVideoTracks()[0];
        if (!p) return 'no había pista';
        p.stop();
        return p.readyState;
    })()`);
    decir('la pista quedó en', muerta);

    // El pulso va cada dos segundos; con seis hay margen de sobra.
    await espera(6000);
    const loQueDice = await js(`(() => {
        const t = document.querySelector('#semanal-cuerpo');
        const avisos = [...t.querySelectorAll('li')].map(l => l.textContent.trim());
        return { avisos, sigueGrabando: !document.querySelector('#semanal-reloj').hidden };
    })()`);

    const avisa = loQueDice.avisos.some(a => /cámara/i.test(a));
    console.log('');
    for (const a of loQueDice.avisos) decir('la tarjeta dice:', a);
    console.log(`\n   ${avisa ? '✓ avisó mientras grababa' : '✗ NO avisó: el fallo sigue siendo invisible'}`);
    decir('y sigue grabando:', loQueDice.sigueGrabando ? 'sí' : 'no');

    // Lo que quedó anotado en el diario, que es la otra mitad del arreglo: sin
    // esto, la próxima vez que pase tampoco se sabría a qué tamaño grababa.
    const diario = path.join(app.getPath('userData'), 'diario.ndjson');
    if (fs.existsSync(diario)) {
        const lineas = fs.readFileSync(diario, 'utf8').trim().split('\n').slice(-60)
            .filter(l => /semanal\.fuente/.test(l));
        for (const l of lineas) {
            const e = JSON.parse(l);
            decir('diario:', e.evento, JSON.stringify(e.datos));
        }
    }

    await js('document.querySelector(\'[data-hace="terminar"]\').click()');
    await espera(4000);
    await js(`window.nt.ajustesGuardar(${JSON.stringify(comoEstaban)})`);
    console.log(`\n   ajustes devueltos · lo grabado quedó en ${carpeta}\n`);
}

module.exports = { correr };
