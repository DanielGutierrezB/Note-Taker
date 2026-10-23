'use strict';
/**
 * Cambiar de ventana a mitad de una toma, en el editor de la maqueta.
 *
 * Lo reportó el editor: grabó su vídeo de la semana, cambió de una app a otra,
 * y en el editor solo veía la segunda; al exportar se veían las dos. Una toma
 * así es tres pedazos —la primera ventana, medio segundo de negro y la segunda
 * (`pantallaPartes`, ver `exportar-video.js`)— y el reproductor los recorre con
 * el reloj de la toma. Esto la reproduce desde su principio y mira qué se ve.
 *
 * Ojo con dónde se hace clic: el bloque de la línea de tomas lleva la aguja al
 * punto del clic, y en el centro de una toma partida por la mitad está justo el
 * negro. Por eso se aprieta en su borde izquierdo.
 *
 *   node tools/probar-semanal-ventanas.js
 */

const { abrir, espera } = require('./lib/arnes');

(async () => {
    const { p, ir, decir, terminar } = await abrir(4831);
    await p.setViewport({ width: 1440, height: 900 });

    console.log('\n── Una toma que cruza un cambio de ventana\n');
    await ir('semanal-revisar');
    await espera(900);
    const partida = await p.evaluate(async () => {
        const m = await window.nt.semanalMontaje();
        const t = m.tomas.find(x => x.pantallaPartes);
        return t ? { id: t.id, segundos: t.segundos } : null;
    });
    decir(Boolean(partida), 'la maqueta trae una toma partida');
    if (!partida) return terminar();

    const bloque = await p.$(`.linea-toma[data-toma="${partida.id}"]`);
    const caja = await bloque.boundingBox();
    await p.mouse.click(caja.x + 2, caja.y + caja.height / 2);
    await espera(700);
    await p.click('[data-hace="reproducir"]');

    const vistos = [];
    const desde = Date.now();
    while (Date.now() - desde < partida.segundos * 1000) {
        await espera(200);
        const que = await p.evaluate(() => {
            const pan = document.querySelector('.montaje-pan');
            return pan.style.display === 'none' ? 'negro' : (pan.dataset.ruta || '').split('/').pop();
        });
        if (vistos[vistos.length - 1] !== que) vistos.push(que);
    }
    console.log(`   se vio: ${vistos.join(' → ')}`);
    const i1 = vistos.indexOf('semanal-pantalla.mp4');
    const i2 = vistos.indexOf('semanal-pantalla-2.mp4');
    decir(i1 === 0, 'empieza en la primera ventana');
    decir(i2 > i1 && vistos.slice(i1, i2).includes('negro'), 'y pasa a la segunda por el relevo en negro');
    await terminar();
})();
