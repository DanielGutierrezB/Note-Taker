'use strict';
/**
 * carga-del-sistema.js — Quién estaba usando la Mac cuando el vivo se atrasó.
 *
 * Una pasada del vivo tarda medio segundo con la Mac libre y lo mismo con una
 * relectura al lado, pero el 10/11 hubo clases enteras con pasadas de 3 a 8 s,
 * y el motor no tenía nada que ver: pasado el mismo audio por el mismo motor
 * después, las pasadas volvían a medio segundo. Lo que estaba ocupando la Mac
 * en ese momento —una grabación de pantalla, otra app con la GPU— no quedaba en
 * ningún lado, y al día siguiente ya no se podía saber.
 *
 * Así que cuando el ciclo anota una pasada lenta (`senal.pasada-lenta`, de a una
 * cada diez segundos), esto anota al lado lo que la Mac estaba haciendo: cuánto
 * se usaba la GPU y los procesos que más CPU se llevaban. Corre aparte, sin
 * esperarlo nadie: si `ps` o `ioreg` tardan o fallan, la pasada no se entera.
 * Por proceso solo se puede ver la CPU; la GPU por proceso pide permisos de
 * administrador, y la total alcanza para saber si estaba llena.
 */

const path = require('path');
const { execFile } = require('child_process');

const correr = (bin, args) => new Promise(resolve => {
    execFile(bin, args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
});

/** Cuánto se está usando la GPU, de la salida de `ioreg`, o null si no lo dice. */
function usoDeGpu(salidaIoreg) {
    const m = String(salidaIoreg || '').match(/"Device Utilization %"=(\d+)/);
    return m ? Number(m[1]) : null;
}

/** Los que más CPU usan, de `ps -A -o pcpu=,comm= -r` (ya ordenada). */
function quienesMas(salidaPs, cuantos) {
    return String(salidaPs || '').split('\n')
        .map(l => l.trim().match(/^([\d.,]+)\s+(.+)$/))
        .filter(Boolean)
        .map(m => ({ proceso: path.basename(m[2]), cpu: Number(m[1].replace(',', '.')) }))
        .slice(0, cuantos);
}

/** Lo que la Mac está haciendo ahora: la GPU entera y los seis que más CPU usan. */
async function medir() {
    const [ps, ioreg] = await Promise.all([
        correr('/bin/ps', ['-A', '-o', 'pcpu=,comm=', '-r']),
        correr('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator'])
    ]);
    return { gpu: usoDeGpu(ioreg), procesos: quienesMas(ps, 6) };
}

module.exports = { medir, usoDeGpu, quienesMas };
