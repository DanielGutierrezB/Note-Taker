'use strict';
/**
 * Las reglas de la foto del OUT que no se pueden romper sin darse cuenta.
 *
 * El disco está probado en `referencias.test.js`; lo de acá es el lado de la
 * ventana y el puente, que no tienen DOM en estas pruebas pero sí se pueden
 * leer: igual que `vivo-interfaz.test.js`, esto pregunta dónde está declarada
 * cada cosa. Son pocas y son todas la misma: **una foto no puede estorbar una
 * clase, ni cambiar lo que se graba**.
 *
 * Lo que una prueba de código no puede ver —que la cámara abra de verdad, que
 * el anillo tenga el fotograma del OUT, que un `data:` se dibuje con la CSP de
 * la app— se comprobó con la cámara falsa de Chrome contra `src/js/grabar/ojo.js`
 * (ver el README); acá quedan las reglas.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

function tramo(codigo, desde, hasta) {
    const a = codigo.indexOf(desde);
    if (a === -1) return '';
    const b = codigo.indexOf(hasta, a + desde.length);
    return codigo.slice(a, b === -1 ? codigo.length : b);
}

module.exports = function (t) {
    const fotos = leer('src', 'js', 'fotos.js');
    const ojo = leer('src', 'js', 'grabar', 'ojo.js');
    const puente = leer('ipc', 'referencias.js');
    const preload = leer('preload.js');
    const html = leer('src', 'index.html');

    t.group('foto del OUT · una por toma, la del momento en que cerró');

    t.test('una toma que ya tiene foto no se vuelve a fotografiar', () => {
        const bucle = tramo(fotos, 'for (const t of estado.tomas', 'alCambiar();');
        t.ok(/tengo\.has\(t\.id\)/.test(bucle), 'se saltea la que ya tiene');
        t.ok(/t\.outMs == null/.test(bucle), 'y la que no cerró');
    });

    t.test('el fotograma se busca por la hora del OUT, no por la de ahora', () => {
        t.ok(/ojo\.fotoDe\(t\.outMs\)/.test(fotos), 'se le pasa el outMs de la toma');
        t.eq(/fotoDe\(Date\.now\(\)/.test(fotos), false, 'nunca la hora de enterarse');
    });

    t.test('un fotograma lejos del OUT no vale', () => {
        // Es lo que evita la foto de otro momento: sin candidato cerca, la toma
        // se queda sin foto.
        t.ok(/lejos <= CERCA_MS/.test(ojo));
    });

    t.test('la hora del fotograma se lee antes de comprimirlo', () => {
        const sacar = tramo(ojo, 'async function guardarFotograma()', '\n}\n');
        t.ok(sacar.indexOf('const ms = Date.now()') < sacar.indexOf('comoJpeg'));
    });

    t.group('foto del OUT · no puede estorbar la clase');

    t.test('sin cámara elegida no se abre nada', () => {
        t.ok(/if \(!s\.grabando \|\| !s\.camara\) return;/.test(fotos));
    });

    t.test('una clase que se abre para mirar no enciende la cámara', () => {
        // `grabando` es false en `paraMirar`, y es la misma condición.
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/grabando: estado\.grabando !== false/.test(vivo));
    });

    t.test('la pantalla se repinta antes de guardar la foto', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        const aviso = tramo(vivo, "if (aviso.tipo === 'estado')", 'return;');
        t.ok(aviso.indexOf('pintar()') < aviso.indexOf('fotos.alEstado'));
    });

    t.test('guardar una foto que falla se anota y se sigue', () => {
        const guardar = tramo(puente, "ipcMain.handle('foto-guardar'", '\n    });');
        t.ok(/catch \(err\)/.test(guardar));
        t.ok(/anotar\('foto\.falla'/.test(guardar));
        t.ok(/return \{ ok: false/.test(guardar));
    });

    t.test('la cámara la suelta cada pantalla por su nombre', () => {
        // Es lo que deja que cerrar Ajustes no apague la cámara de una clase
        // que está grabando con esa misma cámara.
        t.ok(/const QUIEN = 'clase'/.test(fotos));
        t.ok(/ojo\.soltar\('ajustes'\)/.test(leer('src', 'js', 'app.js')));
        t.ok(/if \(!estado\.duenos\.size\) await apagar\(\)/.test(ojo));
    });

    t.group('foto del OUT · fuera del XML');

    t.test('el motor del XML no sabe que las fotos existen', () => {
        // Ni el XML, ni el sidecar, ni el proyecto de Premiere: el único que
        // toca las fotos es quien mueve y borra clases.
        for (const archivo of ['notas-xml.js', 'notas-vivo.js', 'espejo.js', 'prproj.js', 'prproj-carpeta.js']) {
            const codigo = leer('engine', archivo);
            t.eq(/require\('\.\/referencias'\)/.test(codigo), false, `engine/${archivo}`);
            t.eq(/\.jpg/.test(codigo), false, `engine/${archivo} · ni una imagen`);
        }
    });

    t.test('las fotos se van con su clase, y nada más', () => {
        const sesiones = leer('engine', 'sesiones-grabadas.js');
        t.ok(/referencias\.mover\(/.test(sesiones), 'al renombrar');
        t.ok(/referencias\.borrar\(/.test(sesiones), 'y al borrar');
    });

    t.group('foto del OUT · el puente');

    t.test('abrir y copiar comprueban que la ruta sea de las nuestras', () => {
        // Llega de la ventana, y de este lado hay un `readFile` y un
        // portapapeles. Sin esto, cualquier ruta del disco se podría leer.
        for (const puerta of ['foto-abrir', 'foto-copiar']) {
            const h = tramo(puente, `ipcMain.handle('${puerta}'`, '\n    });');
            t.ok(/referencias\.esDeAca\(ruta\)/.test(h), puerta);
            t.ok(/fs\.existsSync\(ruta\)/.test(h), `${puerta} · y que esté`);
        }
    });

    t.test('las imágenes cruzan como data:, que es lo que la CSP deja dibujar', () => {
        t.ok(/img-src 'self' data:/.test(html), 'la CSP admite data:');
        t.ok(/toDataURL\(\)/.test(puente), 'y el puente las manda así');
        t.eq(/file:\/\//.test(leer('src', 'js', 'panel-foto.js')), false);
    });

    t.test('la miniatura va escalada y la grande solo cuando se abre', () => {
        t.ok(/ANCHO_MINI = 320/.test(puente));
        const listar = tramo(puente, "ipcMain.handle('fotos-listar'", '\n    });');
        t.ok(/ANCHO_MINI/.test(listar), 'la lista manda miniaturas');
        t.ok(/window\.nt\.fotoAbrir/.test(leer('src', 'js', 'panel-foto.js')), 'la grande, al abrir');
    });

    t.test('las cuatro puertas están en el preload y en ningún otro lado', () => {
        for (const puerta of ['fotoGuardar', 'fotosListar', 'fotoAbrir', 'fotoCopiar']) {
            t.ok(new RegExp(`${puerta}:`).test(preload), puerta);
        }
        t.ok(/ipcReferencias\.registrar\(/.test(leer('main.js')));
    });

    t.group('foto del OUT · dónde se ve');

    t.test('la miniatura del bloque abre el visor', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/data-hace="ver-foto"/.test(vivo), 'el botón');
        t.ok(/case 'ver-foto'/.test(vivo), 'y quien lo atiende');
        t.ok(/panelFoto\.abrir\(/.test(vivo));
    });

    t.test('la última cerrada se ve en la tarjeta de Ahora', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        const tarjeta = tramo(vivo, 'function ahora(fps) {', '\n}\n');
        t.ok(/laDeLaPausa\(\)/.test(tarjeta));
        t.ok(/function laDeLaPausa/.test(vivo));
    });

    t.test('el visor copia la imagen, no el archivo', () => {
        const panel = leer('src', 'js', 'panel-foto.js');
        t.ok(/fotoCopiar/.test(panel));
        t.ok(/clipboard\.writeImage/.test(puente), 'va la imagen al portapapeles');
        t.ok(/btn-foto-finder/.test(html), 'y el archivo se muestra en Finder');
    });

    t.test('sin foto, el bloque es el de antes', () => {
        const vivo = leer('src', 'js', 'pantalla-vivo.js');
        const laFoto = tramo(vivo, 'function laFoto(', '\n}\n');
        t.ok(/if \(!foto\) return '';/.test(laFoto));
    });
};
