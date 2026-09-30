'use strict';
/**
 * El timecode de la clase es el audio grabado, y no espera a Whisper.
 *
 * El editor lo reportó así: «el timecode de la esquina solo se mueve cuando hay
 * transcript». Y era literal: el estado completo sale UNA vez por pasada del
 * ciclo de señales, y esa pasada transcribe antes de avisar. Medido con la clase
 * del 30/09 y whisper-server cargado, una pasada tarda 798 ms de mediana — y se
 * le permiten hasta 20 s (`tiempoMaxMs` en `engine/oir.js`). Así que el reloj de
 * la pantalla avanzaba a saltos del tamaño de la pasada, y con la máquina ocupada
 * o sin servidor se quedaba quieto mucho más.
 *
 * Lo que se prueba acá es lo que hace al aviso confiable:
 *
 *   · Que salga SIN transcribir nada, porque el reloj no es asunto del que
 *     transcribe.
 *   · Que sean los segundos del WAV y no el reloj de pared. Si la entrada se
 *     atrasa, el timecode tiene que quedarse quieto y decirlo: taparlo con un
 *     temporizador en la ventana sería inventar segundos que no se grabaron.
 *   · Que la ventana no lo tome como señal de vida cuando NO avanza, que es lo
 *     que dejaría la pantalla diciendo «escuchando» con el reloj clavado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const grabacion = require('../engine/grabacion');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nt-reloj-'));
const pedazo = muestras => Buffer.alloc((muestras || 4096) * 2);

module.exports = function (t) {
    t.group('reloj · el aviso del motor');

    t.test('el reloj sale sin transcribir nada', () => {
        const dir = carpeta();
        const avisos = [];
        try {
            grabacion.iniciar({
                dir, curso: 'prueba', fps: 30, sinReloj: true, avisar: a => avisos.push(a)
            });
            // Un segundo de audio, y el reloj a mano: es lo que hace el
            // `setInterval` de la sesión, sin tocar el ciclo de señales.
            for (let i = 0; i < 12; i++) grabacion.pcm(pedazo());
            avisos.length = 0;
            grabacion.avisarReloj();
            const reloj = avisos.filter(a => a.tipo === 'reloj');
            t.eq(reloj.length, 1, 'un aviso de reloj');
            t.ok(reloj[0].segundos > 0, 'con los segundos del audio');
            t.ok(reloj[0].grabadoHastaMs > reloj[0].ceroMs, 'y con la hora del audio');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('son los segundos del WAV, no los del reloj de pared', () => {
        const dir = carpeta();
        const avisos = [];
        try {
            grabacion.iniciar({
                dir, curso: 'prueba', fps: 30, sinReloj: true, avisar: a => avisos.push(a)
            });
            // Nada de audio: el WAV está en cero aunque el reloj de pared corra.
            grabacion.avisarReloj();
            const quieto = avisos.filter(a => a.tipo === 'reloj').pop();
            t.eq(quieto.segundos, 0, 'sin audio escrito, el reloj está en cero');

            for (let i = 0; i < 24; i++) grabacion.pcm(pedazo());
            grabacion.avisarReloj();
            const anda = avisos.filter(a => a.tipo === 'reloj').pop();
            t.ok(anda.segundos >= 2, `con dos segundos de audio, ${anda.segundos.toFixed(2)} s`);

            // Y con audio que dejó de llegar se queda donde estaba: es lo que
            // `vigilarDeriva` dice con palabras, y lo que la ventana lee como
            // «acá no está entrando nada».
            grabacion.avisarReloj();
            const igual = avisos.filter(a => a.tipo === 'reloj').pop();
            t.eq(igual.segundos, anda.segundos, 'sin audio nuevo, el reloj no se mueve');
        } finally {
            grabacion.apagar();
        }
    });

    t.test('el reloj de la sesión lo llama, y antes que al ciclo', () => {
        // Si fuera al revés, una pasada que tarda se lleva puesto el segundo.
        const codigo = leer('engine', 'grabacion.js');
        const m = codigo.match(/setInterval\(\(\) => \{ ([^}]+)\}/);
        t.ok(m, 'la sesión tiene su reloj');
        t.ok(/^avisarReloj\(\);/.test(m[1].trim()), `el reloj va primero: «${m[1].trim()}»`);
    });

    t.test('el aviso es flaco: no arrastra la clase entera cada segundo', () => {
        const codigo = leer('engine', 'grabacion.js');
        const cuerpo = codigo.slice(codigo.indexOf('function avisarReloj()'),
            codigo.indexOf('\n}', codigo.indexOf('function avisarReloj()')));
        t.ok(!/espejo\.resumen/.test(cuerpo),
            'sin `espejo.resumen`, que copia las palabras de todas las tomas');
        t.ok(!/Date\.now/.test(cuerpo), 'y sin el reloj de pared');
    });

    t.group('reloj · lo que hace la ventana');

    t.test('mueve el timecode sin repintar la pantalla', () => {
        // Repintarla entera cada segundo le rompe la selección a quien está
        // seleccionando, que es el otro pedido de esta misma ronda.
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf("if (aviso.tipo === 'reloj')"),
            codigo.indexOf("if (aviso.tipo === 'golpe')"));
        t.ok(/estado\.segundos = aviso\.segundos/.test(cuerpo), 'se queda con los segundos');
        t.ok(/pintarBarra\(\)/.test(cuerpo), 'y repinta la barra');
        t.ok(!/[^r]\bpintar\(\)/.test(cuerpo), 'pero no la pantalla entera');
    });

    t.test('un reloj que no avanza no cuenta como señal de vida', () => {
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf("if (aviso.tipo === 'reloj')"),
            codigo.indexOf("if (aviso.tipo === 'golpe')"));
        t.ok(/aviso\.segundos > estado\.segundos\) ultimoAvisoMs/.test(cuerpo),
            'solo el reloj que avanzó refresca `ultimoAvisoMs`');
    });

    t.test('«Clase cortada» también corre con el audio', () => {
        // Usa el mismo reloj como fin de la toma abierta, así que se descongela
        // con él. El concepto no cambia: sigue siendo la suma de los cortes.
        const codigo = leer('src', 'js', 'pantalla-vivo.js');
        const cuerpo = codigo.slice(codigo.indexOf('function segundosCortados()'),
            codigo.indexOf('\n}', codigo.indexOf('function segundosCortados()')));
        t.ok(/estado\.ceroMs \+ \(estado\.segundos \|\| 0\) \* 1000/.test(cuerpo),
            'el fin de la toma abierta es el reloj del audio');
        t.ok(/vivo-cortada/.test(codigo) && /pintarBarra/.test(codigo),
            'y se pinta en la barra, que es la que el reloj repinta');
    });
};
