'use strict';
/**
 * Seguridad, diario y empaquetado.
 *
 *   · la ventana no navega a otra página ni abre otra;
 *   · lo que se lee de un archivo de notas y la pantalla escribe en el HTML es
 *     un número;
 *   · la actualización la decide el proceso principal, y solo baja de GitHub;
 *   · el arnés de desarrollo no corre en la app instalada;
 *   · el diario tiene un solo freno para las ráfagas, y acorta las rutas con
 *     espacios;
 *   · el permiso de audio dice lo que la app hace, y el instalador no esconde
 *     una firma fallida ni deja instalar donde la app no abre.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const notasXml = require('../engine/notas-xml');
const updates = require('../engine/updates');
const registro = require('../engine/registro');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

module.exports = async function (t) {
    t.group('seguridad · la ventana es la app y nada más');

    t.test('no navega a otra página ni abre ventanas', () => {
        const main = leer('main.js');
        t.ok(/webContents\.on\('will-navigate', frenar\)/.test(main));
        t.ok(/webContents\.on\('will-redirect', frenar\)/.test(main));
        t.ok(/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/.test(main));
        t.ok(/if \(String\(url\)\.split\('#'\)\[0\] === propia\) return;/.test(main), 'salvo su propia página');
    });

    t.test('un número de toma que no es un número no llega a la pantalla', () => {
        const leido = notasXml.estadoLeido({
            numero: '<b>3</b>', vez: 2,
            tomas: [{ id: '"><img src=x onerror=alert(1)>', vista: 'PV' }, { id: 7, vista: 'R' }, null]
        });
        t.eq(leido.tomas.length, 2, 'lo que no es una toma se cae');
        t.eq(leido.tomas[0].id, 1, 'el que no es un número toma su lugar en la lista');
        t.eq(leido.tomas[1].id, 7);
        t.eq(leido.numero, null);
        t.eq(leido.vez, 2);
    });

    t.group('seguridad · la actualización');

    t.test('la ventana no dice de dónde bajar ni qué abrir', () => {
        const main = leer('main.js');
        t.ok(/ipc\.handle\('update-download', async \(\) => \{/.test(main), 'la descarga no recibe nada de la ventana');
        t.ok(/const \{ url, nombre, tamañoBytes \} = novedad;/.test(main), 'sale de lo que contestó GitHub');
        t.ok(/ipc\.handle\('update-install', async \(\) => \{\s+const target = instalador;/.test(main), 'y abre lo que se bajó');
        t.ok(/sitios: process\.env\.NOTETAKER_UPDATE_BASE \? null : updates\.GITHUB/.test(main));
    });

    t.test('solo https y solo GitHub', () => {
        t.ok(updates.deEstosSitios('https://github.com/x/y/releases/download/v1/a.pkg', updates.GITHUB));
        t.ok(updates.deEstosSitios('https://objects.githubusercontent.com/abc', updates.GITHUB));
        t.ok(!updates.deEstosSitios('http://github.com/x', updates.GITHUB), 'sin https no');
        t.ok(!updates.deEstosSitios('https://github.com.evil.example/x', updates.GITHUB));
        t.ok(!updates.deEstosSitios('no es una url', updates.GITHUB));
    });

    t.test('una redirección a otro sitio corta la descarga', async () => {
        const servidor = http.createServer((req, res) => {
            res.writeHead(302, { Location: 'https://otro-sitio.example/malo.pkg' });
            res.end();
        });
        await new Promise(r => servidor.listen(0, '127.0.0.1', r));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-update-'));
        try {
            const url = `http://127.0.0.1:${servidor.address().port}/a.pkg`;
            const r = await updates.download({ url, destDir: dir, nombre: 'a.pkg', sitios: ['127.0.0.1'] });
            t.eq(r.ok, false);
            t.ok(/no viene de/.test(r.error), r.error);
            t.deep(fs.readdirSync(dir), [], 'y no dejó nada en el disco');
        } finally {
            servidor.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    t.test('el nombre del instalador no lleva carpetas y es un .pkg', () => {
        t.eq(updates.nombreSano('NoteTaker-0.7.0-arm64.pkg'), 'NoteTaker-0.7.0-arm64.pkg');
        t.eq(updates.nombreSano('../../Library/LaunchAgents/x.pkg'), 'x.pkg');
        t.eq(updates.nombreSano('script.command'), null);
    });

    t.group('seguridad · el arnés de desarrollo');

    t.test('en la app instalada, ninguna bandera del arnés se lee', () => {
        const js = leer('dev-shot.js');
        const cuerpo = js.slice(js.indexOf('function argValue(flag) {'));
        t.ok(/^function argValue\(flag\) \{\s+if \(app\.isPackaged\) return null;/.test(cuerpo), '--js y --guion incluidos');
        t.eq((js.match(/process\.argv/g) || []).length, 1, 'y no hay otra puerta a las banderas');
    });

    t.group('diario · ráfagas y rutas');

    t.test('un mismo evento, como mucho veinte por minuto, y el siguiente dice cuántos se callaron', () => {
        registro.limpiar();
        const ahora = Date.now;
        let reloj = 1_000_000;
        Date.now = () => reloj;
        try {
            for (let i = 0; i < 50; i++) registro.anotar('main', 'prueba.rafaga', { i });
            t.eq(registro.todo().filter(l => l.evento === 'prueba.rafaga').length, 20);
            registro.anotar('main', 'prueba.otro', {});
            t.eq(registro.todo().filter(l => l.evento === 'prueba.otro').length, 1, 'los otros eventos pasan');
            reloj += 60000;
            const linea = registro.anotar('main', 'prueba.rafaga', { i: 50 });
            t.eq(linea.datos.callados, 30);
            t.eq(registro.todo().filter(l => l.evento === 'prueba.rafaga').length, 21);
        } finally {
            Date.now = ahora;
            registro.limpiar();
        }
    });

    t.test('una ruta con espacios también se acorta; un mensaje con una ruta adentro, no', () => {
        t.eq(registro.sanear('/Volumes/Rodaje/Curso de Canva/Audio/clase 1.wav'), '…/Audio/clase 1.wav');
        const mensaje = "ENOENT: no such file or directory, open '/Volumes/Rodaje/Curso de Canva/x.wav'";
        t.eq(registro.sanear(mensaje), mensaje);
    });

    t.group('empaquetado');

    t.test('el permiso del audio del sistema dice que se graba lo que suene, no solo Zoom', () => {
        const pkg = JSON.parse(leer('package.json'));
        const dice = pkg.build.mac.extendInfo.NSAudioCaptureUsageDescription;
        t.ok(!/Solo escucha a Zoom/.test(dice), dice);
        t.ok(/Audio del sistema/.test(dice));
        t.ok(!/Solo escucha a Zoom/.test(leer('tools', 'atajo-dev.sh')), 'y la app de desarrollo dice lo mismo');
    });

    t.test('Electron al día con el aviso alto de npm audit', () => {
        const pkg = JSON.parse(leer('package.json'));
        const [mayor, menor, parche] = pkg.devDependencies.electron.replace(/^\D+/, '').split('.').map(Number);
        t.ok(mayor > 43 || (mayor === 43 && (menor > 8 || (menor === 8 && parche >= 7))), pkg.devDependencies.electron);
    });

    t.test('una firma que falla para la compilación', () => {
        const sh = leer('tools', 'build-pkg.sh');
        t.ok(!/codesign[^\n]*2>\/dev\/null \|\| true/.test(sh), 'sin esconder el error');
        t.ok(/codesign --verify --deep --strict "\$APP"/.test(sh), 'y se verifica');
    });

    t.test('el instalador no deja instalar donde la app no abre', () => {
        const sh = leer('tools', 'build-pkg.sh');
        t.ok(/<os-version min="12\.0"\/>/.test(sh));
        t.eq(JSON.parse(leer('package.json')).build.mac.minimumSystemVersion, '12.0');
    });

    t.test('«Instalar y reabrir» reabre: la app deja la marca y el instalador la busca', () => {
        t.ok(/'reabrir-al-instalar'/.test(leer('main.js')));
        const sh = leer('tools', 'build-pkg.sh');
        t.ok(/Library\/Application Support\/Note Taker\/reabrir-al-instalar/.test(sh));
        t.ok(/--scripts "\$STAGE\/scripts"/.test(sh));
    });
};
