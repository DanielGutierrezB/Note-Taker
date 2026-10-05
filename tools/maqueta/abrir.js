#!/usr/bin/env node
'use strict';
/**
 * Maqueta: la interfaz de verdad, con datos falsos y sin hardware.
 *
 *   node tools/maqueta/abrir.js            levanta y abre el navegador
 *   node tools/maqueta/abrir.js --no-open  solo imprime la URL
 *   node tools/maqueta/abrir.js --puerto 5000
 *
 * Es el HTML y el CSS de verdad (`src/index.html`, `src/css/style.css`, todo
 * `src/js/`): acá adentro no hay ni una línea de interfaz duplicada. Lo único
 * que se falsea es la puerta por donde la ventana habla con el mundo
 * (`window.nt`) y el micrófono.
 *
 * Existe porque las pantallas que más importan solo se pueden ver con una clase
 * grabándose: En vivo con seis tomas y tres claquetas, o el Cierre con tomas
 * sin releer. Sin esto, mirar el diseño de esa pantalla pide un Zoom abierto,
 * un modelo de un giga y medio y alguien contando «3, 2, 1» en voz alta.
 *
 * Los escenarios se eligen por la URL y se combinan con coma
 * (`?e=en-vivo,sin-audio`):
 *
 *   vacio            carpeta elegida y ninguna sesión todavía
 *   sin-carpeta      lo primero que ve alguien que abre la app por primera vez
 *   sesiones         la lista con sus tres estados a la vez
 *   preparar         la lista de verificación, con todo en verde
 *   preparar-sin-audio  la misma, con la entrada sin elegir
 *   sin-whisper      la misma, sin modelo: el botón de Iniciar apagado
 *   en-vivo          la clase corriendo, con seis tomas y tres claquetas
 *   toma-abierta     la misma, con una toma abierta y su texto entrando
 *   releyendo        la misma, con dos tomas en la cola de relectura
 *   sin-audio        la misma, con el dispositivo caído
 *   terminada        la pantalla de Cierre, con dos tomas mal leídas
 *   foto             la foto del OUT de una toma, abierta en grande
 *   ajustes          la app con el panel de Ajustes abierto
 *   diagnostico      con el de Diagnóstico
 *   iconos           todos los iconos juntos, para mirarlos de una
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const SRC = path.join(RAIZ, 'src');

function arg(nombre, def) {
    const i = process.argv.indexOf(nombre);
    return i === -1 ? def : process.argv[i + 1];
}

const PUERTO = Number(arg('--puerto', 4600));

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    // El vídeo de ejemplo del modo semanal. Son 37 kB y se manda entero, sin
    // atender rangos: el reproductor acepta el 200 completo y busca dentro de
    // lo que ya tiene, que con tres segundos es todo.
    '.mp4': 'video/mp4'
};

/**
 * El HTML de verdad, con el doble de `window.nt` inyectado ANTES del módulo de
 * la app.
 *
 * Se inyecta por `<script type="module">` y no por `<script>` suelto porque el
 * doble importa `datos.js`, y hay que garantizar que termine antes de que
 * `app.js` arranque: los módulos corren en el orden en que aparecen, así que
 * poniéndolo delante alcanza.
 *
 * La política de contenido se afloja acá y solo acá: el HTML publicado la lleva
 * sin `unsafe-inline` en los scripts, y esta copia vive en memoria del servidor
 * de la maqueta. Nunca se escribe al disco.
 */
function html() {
    const crudo = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    return crudo
        .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, '')
        .replace('<script type="module" src="js/app.js"></script>',
            '<script type="module" src="/maqueta/doble.js"></script>\n' +
            '<script type="module" src="js/app.js"></script>\n' +
            '<div style="position:fixed;right:0;bottom:0;background:#f5b43c;color:#2a1e00;' +
            'font:600 11px/1.6 system-ui;padding:2px 10px;z-index:99">MAQUETA · datos falsos</div>');
}

function crear(puerto) {
    return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${puerto}`);
    const ruta = url.pathname;

    if (ruta === '/' || ruta === '/index.html') {
        const cuerpo = html();
        res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
        return res.end(cuerpo);
    }

    // El favicon que el navegador pide solo. Se contesta vacío y con 200 para
    // que su 404 no cuente como «la pantalla tiene un error» en `capturar.js`,
    // que es la clase de ruido que hace ignorar los errores de verdad.
    if (ruta === '/favicon.ico') {
        res.writeHead(200, { 'Content-Type': 'image/x-icon' });
        return res.end();
    }

    // Los dos archivos de la maqueta, que no viven en `src/`.
    const base = ruta.startsWith('/maqueta/')
        ? path.join(__dirname, ruta.slice('/maqueta/'.length))
        : path.join(SRC, ruta);

    // Nada fuera de `src/` y de esta carpeta: es un servidor de desarrollo,
    // pero abre un puerto igual.
    if (!base.startsWith(SRC) && !base.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end('no');
    }
    if (!fs.existsSync(base) || fs.statSync(base).isDirectory()) {
        res.writeHead(404);
        return res.end('no está');
    }

    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(base)] || 'application/octet-stream' });
    res.end(fs.readFileSync(base));
    });
}

/**
 * Lo que hay que dibujar: cada escenario, y los que van juntos con coma.
 *
 * **Estaba escrito tres veces** —en `capturar.js`, en `medir-botones.js` y en
 * `auditar.js`— y las tres listas habían derivado: 37, 34 y 21 nombres. Cinco
 * que la maqueta sabe armar no estaban en NINGUNA: los tres del modo semanal
 * que se salen del camino felíz, el aviso de versión nueva, y el estado vacío.
 * O sea que los estados de error, que son los que se escriben con menos cuidado
 * y los que más se leen cuando algo falló, no los miraba nadie.
 *
 * El catálogo de verdad es `SE_HACEN` en `doble.js`, que es el archivo que los
 * implementa. Esto es la misma lista puesta para Node —que no puede importar un
 * módulo que usa `window`— con los pares que se combinan ya armados, y que las
 * dos digan lo mismo lo cuida `tests/maqueta.test.js`.
 *
 * Cada herramienta declara lo que SALTA y por qué. Declarar exclusiones y no
 * inclusiones es lo que hace que un escenario nuevo entre solo en las tres.
 */
const ESCENARIOS = [
    'vacio', 'sin-carpeta', 'sesiones',
    'preparar', 'preparar-sin-audio', 'preparar-microfono', 'preparar-zoom-falso',
    'sin-whisper', 'sin-zoom', 'faltan-modelos', 'update',
    // `desplegada` y `claqueta-abierta` no son pantallas: son cómo queda la de
    // en vivo con algo abierto, así que van con ella.
    'en-vivo', 'en-vivo,desplegada', 'en-vivo,claqueta-abierta',
    'toma-abierta', 'releyendo', 'sin-audio', 'terminada', 'notas-de-antes',
    'foto', 'foto-cien', 'palmada', 'palmada-vencida',
    'prproj', 'prproj-lleno', 'prproj-listo',
    'ajustes', 'ajustes-semanal', 'diagnostico',
    // El modo semanal, momento por momento, más los tres que se salen del
    // camino felíz: sin pantalla compartida, sin ninguna toma, y con el aviso
    // de que un vídeo se rompió a mitad.
    'semanal', 'semanal-primera-vez', 'semanal-sin-pantalla', 'semanal-grabando', 'semanal-sin-tomas',
    'semanal-con-aviso', 'semanal-ficha', 'semanal-revisar',
    'semanal-revisar-fuera', 'semanal-cortando', 'semanal-hecho',
    'iconos'
];

/** Los de la lista menos los que esta herramienta no quiere, con su razón. */
const escenariosMenos = saltar => ESCENARIOS.filter(e => !saltar[e]);

/**
 * Levanta la maqueta y devuelve su URL y cómo bajarla.
 *
 * Se exporta para que las tres herramientas de medición se la levanten solas:
 * pedirle a quien mide que antes arranque un servidor a mano es la manera de
 * que un día alguien mida contra un servidor viejo, con el CSS de antes.
 */
function levantar(puerto) {
    const p = puerto || PUERTO;
    const servidor = crear(p);
    return new Promise(listo => {
        servidor.listen(p, () => listo({
            url: `http://localhost:${p}/`,
            bajar: () => new Promise(r => servidor.close(r))
        }));
    });
}

if (require.main === module) {
    levantar().then(({ url }) => {
        console.log(`Maqueta en ${url}`);
        console.log('Escenarios: ?e=sin-carpeta | sesiones | preparar | preparar-sin-audio |');
        console.log('            sin-whisper | en-vivo | toma-abierta | releyendo | sin-audio |');
        console.log('            terminada | ajustes | diagnostico | iconos');
        if (!process.argv.includes('--no-open')) execFile('open', [url]);
    });
}

module.exports = { levantar, ESCENARIOS, escenariosMenos };
