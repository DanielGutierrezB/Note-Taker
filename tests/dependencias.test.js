'use strict';
/**
 * Instalar lo que falta desde la app. La descarga de un modelo se prueba contra
 * un servidor local, con un "modelo" chico cuya huella se conoce; lo de verdad
 * (1,6 GB desde Hugging Face) no entra en una corrida de pruebas.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

module.exports = async function (t) {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-deps-'));
    const contenido = Buffer.concat([Buffer.from('lmgg'), crypto.randomBytes(200000)]);
    const servidor = http.createServer((req, res) => {
        if (req.url.endsWith('/roto.bin')) {
            res.writeHead(200, { 'Content-Length': 10 });
            res.end('<html></h>');
            return;
        }
        res.writeHead(200, { 'Content-Length': contenido.length });
        res.end(contenido);
    });
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    // Las pruebas corren después de que esta función vuelve: el servidor se
    // queda abierto, sin retener el proceso.
    servidor.unref();
    process.env.NOTETAKER_MODELOS_BASE = `http://127.0.0.1:${servidor.address().port}`;
    process.env.NOTETAKER_CARPETA_USUARIO = carpeta;
    delete require.cache[require.resolve('../engine/dependencias')];
    const dependencias = require('../engine/dependencias');

    t.group('dependencias · qué hay');

    t.test('cada una dice si está, para qué sirve y si impide grabar', () => {
        const lista = dependencias.estado();
        t.ok(lista.length >= 7);
        for (const d of lista) {
            t.ok(d.nombre && d.para, `${d.clave} dice qué es`);
            t.eq(typeof d.requerida, 'boolean');
            if (!d.esta) t.ok(d.accion, `${d.clave} dice cómo se instala`);
        }
        t.ok(lista.find(d => d.clave === 'modelo-grande').requerida, 'sin el modelo grande no se graba');
    });

    t.group('dependencias · bajar un modelo');

    t.test('baja, verifica la huella y deja el modelo en la carpeta del usuario', async () => {
        const nombre = 'ggml-prueba.bin';
        dependencias.MODELOS[nombre] = {
            bytes: contenido.length,
            sha256: crypto.createHash('sha256').update(contenido).digest('hex')
        };
        dependencias.LISTA.push({ clave: 'modelo-prueba', nombre: 'prueba', para: 'x', requerida: false, modelo: nombre });
        const avances = [];
        const r = await dependencias.instalar('modelo-prueba', p => avances.push(p));
        t.ok(r.ok, r.error);
        const destino = path.join(carpeta, 'models', nombre);
        t.ok(fs.existsSync(destino), 'quedó en su lugar');
        t.eq(fs.statSync(destino).size, contenido.length);
        t.ok(avances.length > 0, 'contó el avance');
        t.ok(!fs.readdirSync(path.join(carpeta, 'models')).some(f => /verificando|parcial/.test(f)), 'sin restos');
    });

    t.test('lo que no pasa la huella no se instala', async () => {
        const nombre = 'roto.bin';
        dependencias.MODELOS[nombre] = { bytes: 10, sha256: '0'.repeat(64) };
        dependencias.LISTA.push({ clave: 'modelo-roto', nombre: 'roto', para: 'x', requerida: false, modelo: nombre });
        const r = await dependencias.instalar('modelo-roto');
        t.eq(r.ok, false);
        t.ok(/huella/.test(r.error), r.error);
        t.ok(!fs.existsSync(path.join(carpeta, 'models', nombre)), 'no quedó nada');
    });

    t.test('lo que no se sabe instalar lo dice', async () => {
        const r = await dependencias.instalar('no-existe');
        t.eq(r.ok, false);
    });

    // La dirección y la carpeta ya quedaron leídas al cargar el módulo.
    delete process.env.NOTETAKER_MODELOS_BASE;
    delete process.env.NOTETAKER_CARPETA_USUARIO;
};
