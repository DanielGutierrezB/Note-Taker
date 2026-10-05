'use strict';
/**
 * La maqueta: que el catálogo de escenarios no vuelva a derivar.
 *
 * Esta sí es una prueba sobre el TEXTO de un archivo, y acá es lo correcto: la
 * pregunta es «qué ramas implementa `doble.js`», que es un hecho sobre el
 * contenido del archivo y no sobre lo que hace al correr. `doble.js` corre en la
 * página —usa `window`— así que no se puede importar desde acá y preguntárselo.
 *
 * Lo que se vigila es un fallo que ya pasó: la lista de escenarios estaba
 * copiada en las tres herramientas de medición, con 37, 34 y 21 nombres, y tres
 * que la maqueta sabía armar no estaban en ninguna. Los estados vacíos y el de
 * error del modo semanal no los dibujaba nadie, así que nadie los auditaba ni
 * les medía los botones. Una captura que no se saca no se mira.
 */

const fs = require('fs');
const path = require('path');

const maqueta = require('../tools/maqueta/abrir');

const RAIZ = path.join(__dirname, '..');

/**
 * El catálogo que declara `doble.js`, que es quien los implementa.
 *
 * Se lee su `SE_HACEN` y no sus `hay(…)`: inferir qué escenarios existen del
 * flujo de control es frágil y ya falló en los dos sentidos. `faltan-modelos`
 * se lee con `URLSearchParams` y no con `hay`, y `semanal-hecho` no se nombra en
 * ningún sitio —es el camino por descarte cuando no es ninguno de los otros—,
 * así que contar `hay(…)` daba cuatro respuestas equivocadas.
 */
function lasQueSabeHacer() {
    const s = fs.readFileSync(path.join(RAIZ, 'tools', 'maqueta', 'doble.js'), 'utf8');
    const m = s.match(/export const SE_HACEN = \[([\s\S]*?)\];/);
    if (!m) throw new Error('doble.js ya no declara SE_HACEN');
    return [...new Set((m[1].match(/'[^']+'/g) || []).map(x => x.slice(1, -1)))].sort();
}

/** Los nombres sueltos del catálogo: «en-vivo,desplegada» son dos. */
function lasDelCatalogo() {
    const sueltas = new Set();
    for (const e of maqueta.ESCENARIOS) for (const x of e.split(',')) sueltas.add(x);
    return sueltas;
}

module.exports = function (t) {
    t.group('la maqueta · el catálogo de escenarios');

    t.test('el catálogo cubre todo lo que la maqueta sabe armar', () => {
        const faltan = lasQueSabeHacer().filter(x => !lasDelCatalogo().has(x));
        t.eq(faltan.join(', '), '',
            'un escenario que `doble.js` implementa y nadie dibuja no lo mira nadie');
    });

    t.test('y no promete ninguno que no exista', () => {
        // Al revés también importa: un nombre de más hace que la herramienta
        // dibuje la pantalla de arranque creyendo que es otra cosa, y lo mida.
        const sabe = new Set(lasQueSabeHacer());
        const sobran = [...lasDelCatalogo()].filter(x => !sabe.has(x));
        t.eq(sobran.join(', '), '');
    });

    t.test('y la maqueta avisa si le piden uno que no sabe', () => {
        // Sin esto, un nombre mal escrito daba la pantalla de arranque en
        // silencio y la herramienta sacaba la foto igual.
        const s = fs.readFileSync(path.join(RAIZ, 'tools', 'maqueta', 'doble.js'), 'utf8');
        t.ok(/if \(!SE_HACEN\.includes\(x\)\) \{[\s\S]{0,120}console\.error/.test(s),
            'el catálogo se usa, no solo se declara');
    });

    t.test('las tres herramientas salen del mismo catálogo', () => {
        // Y declaran lo que SALTAN, no lo que miran: así un escenario nuevo
        // entra solo en las tres, que es lo que no pasaba.
        for (const cual of ['capturar', 'medir-botones', 'auditar']) {
            const s = fs.readFileSync(path.join(RAIZ, 'tools', `${cual}.js`), 'utf8');
            t.ok(/maqueta\.(ESCENARIOS|escenariosMenos)/.test(s),
                `${cual}.js no se escribe su propia lista`);
        }
    });

    // Un escenario que está en el catálogo pero que el guion no nombra en
    // ningún `hay(…)` no se para en su pantalla: sigue de largo hasta el final
    // del recorrido y la herramienta fotografía, mide y audita OTRA pantalla
    // creyendo que es esa. Pasó al agregar `semanal-primera-vez`: la captura
    // salió del vídeo ya exportado.
    //
    // Las tres excepciones son de verdad y están contadas una por una, que es
    // la diferencia entre una excepción y un agujero.
    t.test('cada escenario se para en su pantalla', () => {
        const CAMINO_POR_DESCARTE = {
            sesiones: 'es la pantalla de arranque: se llega sin pedir nada',
            'faltan-modelos': 'se lee con URLSearchParams y no con hay(…)',
            'semanal-hecho': 'es el final del recorrido semanal: se llega por descarte'
        };
        const s = fs.readFileSync(path.join(RAIZ, 'tools', 'maqueta', 'doble.js'), 'utf8');
        const nombrados = new Set((s.match(/hay\('[^']+'\)/g) || [])
            .map(x => x.slice(5, -2)));
        const sueltos = lasQueSabeHacer()
            .filter(x => !nombrados.has(x) && !CAMINO_POR_DESCARTE[x]);
        t.eq(sueltos.join(', '), '',
            'sin una parada propia, la foto sale de la pantalla equivocada');
    });

    t.test('el modo semanal entra entero, también cuando algo sale mal', () => {
        // Son los que se escriben con menos cuidado y los que más se leen
        // cuando algo falló.
        const hay = lasDelCatalogo();
        for (const x of ['semanal-sin-pantalla', 'semanal-sin-tomas', 'semanal-con-aviso']) {
            t.ok(hay.has(x), `${x} está en el catálogo`);
        }
    });
};
