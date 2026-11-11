'use strict';
/**
 * Quién estaba usando la Mac cuando el vivo se atrasó (`engine/carga-del-sistema.js`).
 */

const fs = require('fs');
const path = require('path');
const carga = require('../engine/carga-del-sistema');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

module.exports = function (t) {
    t.group('carga del sistema · qué anota una pasada lenta');

    t.test('la GPU entera sale de ioreg', () => {
        const salida = '  | "PerformanceStatistics" = {"Device Utilization %"=93,"Renderer Utilization %"=90}';
        t.eq(carga.usoDeGpu(salida), 93);
        t.eq(carga.usoDeGpu(''), null, 'sin el dato, null y no cero');
    });

    t.test('los procesos, con su nombre y no la ruta, y con coma o punto', () => {
        const salida = [
            ' 75.5 /Applications/OBS.app/Contents/MacOS/OBS',
            ' 62,8 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer)',
            '  4.0 /usr/sbin/bluetoothd',
            ''
        ].join('\n');
        t.deep(carga.quienesMas(salida, 2), [
            { proceso: 'OBS', cpu: 75.5 },
            { proceso: 'Cursor Helper (Renderer)', cpu: 62.8 }
        ]);
    });

    t.test('medir de verdad contesta, aunque no haya nada pesado', async () => {
        const c = await carga.medir();
        t.ok(Array.isArray(c.procesos) && c.procesos.length > 0, 'con procesos');
        t.ok(c.gpu == null || (c.gpu >= 0 && c.gpu <= 100), `GPU ${c.gpu}`);
    });

    t.test('el ciclo la anota al lado de cada pasada lenta, sin esperarla', () => {
        const ciclo = leer('engine', 'ciclo-senales.js');
        const fn = ciclo.slice(ciclo.indexOf('function anotarSiSeAtraso('), ciclo.indexOf('module.exports'));
        t.ok(/'senal\.pasada-lenta'[\s\S]*cargaDelSistema\.medir\(\)\s*\.then\(carga => registro\.anotar\('main', 'sistema\.carga', carga\)\)/.test(fn));
        t.ok(!/await cargaDelSistema/.test(ciclo), 'la pasada no la espera');
    });
};
