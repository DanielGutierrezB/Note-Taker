'use strict';
/**
 * La nota de una claqueta: el mismo gesto que la de una toma, en la otra fila.
 *
 * Lo que se cuida acá no es que el campo exista —eso es una línea— sino las
 * tres maneras en que una claqueta cambia debajo de la nota mientras nadie
 * mira: se funde con otra, la renumeran, o viene de un sidecar escrito antes
 * de que esto existiera. En las tres, la nota tiene que quedarse donde está.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const vivo = require('../engine/notas-vivo');
const historial = require('../engine/deshacer');
const notasXml = require('../engine/notas-xml');
const rodecaster = require('../engine/rodecaster-xml');
const sesiones = require('../engine/sesiones-grabadas');
const grabacion = require('../engine/grabacion');
const workspace = require('../engine/workspace');

const RAIZ = path.join(__dirname, '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

const T0 = Date.parse('2026-09-30T12:04:00');

function nuevo() {
    return vivo.estadoNuevo({ secuencia: 'x', ceroMs: T0, fps: 30 });
}

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-nota-claqueta-'));
}

/** El marcador de la claqueta `n` dentro de los que salen al XML. */
function marcadorDe(estado, n) {
    return notasXml.marcadores(estado).find(m => m.name === `Claqueta ${n}`);
}

module.exports = function (t) {
    t.group('nota de claqueta · el campo en el modelo');

    t.test('una claqueta nace con la nota vacía, la anote quien la anote', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, { ms: T0 + 60000, confirmada: true, origen: 'editor' });
        t.eq(e.claquetas[0].comentario, '');
        t.eq(e.claquetas[1].comentario, '');
    });

    t.test('`aplicarAClaqueta` la escribe y la limpia', () => {
        const e = nuevo();
        const { claqueta } = vivo.anotarClaqueta(e, { ms: T0 + 10000, origen: 'golpe' });
        vivo.aplicarAClaqueta(claqueta, { tipo: 'nota-claqueta', texto: '  Cámara 2 arrancó tarde  ' });
        t.eq(claqueta.comentario, 'Cámara 2 arrancó tarde');
    });

    t.test('un cambio que una claqueta no entiende es un error y no un silencio', () => {
        const e = nuevo();
        const { claqueta } = vivo.anotarClaqueta(e, { ms: T0 + 10000, origen: 'golpe' });
        let dijo = '';
        try {
            vivo.aplicarAClaqueta(claqueta, { tipo: 'reabrir' });
        } catch (err) {
            dijo = err.message;
        }
        t.ok(/reabrir/.test(dijo), `lo dice y nombra el tipo: ${dijo}`);
    });

    t.group('nota de claqueta · sobrevive a la fusión');

    t.test('el aplauso llega después y le pone origen y hora: la nota se queda', () => {
        // El caso real: la K anota la claqueta, el editor le escribe la nota, y
        // doce segundos más tarde Whisper confirma la palabra dicha.
        const e = nuevo();
        const puesta = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'editor'
        }).claqueta;
        vivo.aplicarAClaqueta(puesta, { tipo: 'nota-claqueta', texto: 'Se cortó la cámara 2' });

        vivo.anotarClaqueta(e, {
            ms: T0 + 11200, paredMs: T0 + 11200, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe,voz'
        });

        t.eq(e.claquetas.length, 1, 'se fundieron en una');
        t.eq(e.claquetas[0].comentario, 'Se cortó la cámara 2');
        t.eq(e.claquetas[0].frase, 'Claqueta 1, clase 1', 'y la frase nueva también entró');
        t.eq(e.claquetas[0].origen, 'editor,golpe,voz');
    });

    t.test('y al revés: la que llega con nota se la deja a la que ya estaba', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, { ms: T0 + 10000, confirmada: true, origen: 'golpe' });
        vivo.anotarClaqueta(e, {
            ms: T0 + 12000, comentario: 'desde el historial', confirmada: true, origen: 'editor'
        });
        t.eq(e.claquetas.length, 1);
        t.eq(e.claquetas[0].comentario, 'desde el historial');
    });

    t.group('nota de claqueta · cómo viaja al XML');

    t.test('va en el comentario del marcador, detrás del número', () => {
        const e = nuevo();
        const { claqueta } = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe,voz'
        });
        vivo.aplicarAClaqueta(claqueta, { tipo: 'nota-claqueta', texto: 'Cámara 2 arrancó tarde' });
        const m = marcadorDe(e, 1);
        t.eq(m.name, 'Claqueta 1', 'el nombre no lo toca: es por lo que se la reconoce');
        t.ok(m.comment.startsWith('Claqueta 1 · Cámara 2 arrancó tarde · '),
            `la nota va segunda: ${m.comment}`);
        t.ok(m.comment.includes('referencia de sincronía'), 'y lo demás sigue estando');
        t.ok(m.comment.includes('«Claqueta 1, clase 1»'));
    });

    t.test('sin nota, el comentario es exactamente el de siempre', () => {
        const e = nuevo();
        vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'golpe'
        });
        t.ok(marcadorDe(e, 1).comment.startsWith('Claqueta 1 · referencia de sincronía'));
    });

    t.test('el XML de vuelta la sigue reconociendo como claqueta', () => {
        // `isClapMarker` busca "claqueta" en el COMENTARIO. Una nota que no la
        // diga no puede hacer que el marcador deje de serlo, y por eso el
        // número va delante y la nota detrás.
        const e = nuevo();
        e.sesiones = [{ archivo: '/tmp/x.wav', desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
        const { claqueta } = vivo.anotarClaqueta(e, {
            ms: T0 + 10000, paredMs: T0 + 10000, confirmada: true, origen: 'golpe'
        });
        vivo.aplicarAClaqueta(claqueta, { tipo: 'nota-claqueta', texto: 'Sin la palabra que lo delata' });
        const leido = rodecaster.parseXml(notasXml.xmlDeNotas(e));
        t.ok(leido.clap, 'la encontró');
        t.ok(leido.clap.comment.includes('Sin la palabra que lo delata'), 'y con la nota puesta');
    });

    t.group('nota de claqueta · deshacer repone el campo y nada más');

    t.test('un paso de lista con los dos lados anota qué campos tocó', () => {
        const h = historial.nueva();
        historial.anotar(h, {
            que: 'la nota de la claqueta 1', tipo: 'nota-claqueta', campo: 'claquetas',
            antes: { n: 1, ms: T0, frase: '', comentario: '' },
            despues: { n: 1, ms: T0, frase: '', comentario: 'algo' }
        });
        t.deep(historial.proximo(h, 'atras').campos, ['comentario']);
    });

    t.test('reponer solo ese campo deja lo que cambió después', () => {
        const lista = [{ n: 1, ms: T0, frase: 'Claqueta 1, clase 1', comentario: 'lo escrito' }];
        historial.ponerEnLista(lista, { ...lista[0] }, { n: 1, ms: T0, frase: '', comentario: '' },
            { campos: ['comentario'] });
        t.eq(lista.length, 1, 'no se reemplazó la entrada');
        t.eq(lista[0].comentario, '');
        t.eq(lista[0].frase, 'Claqueta 1, clase 1', 'la frase que llegó después se queda');
    });

    t.test('la encuentra aunque la fusión le haya corrido el `ms`', () => {
        // Buscándola por igualdad exacta el paso empujaba una copia y la clase
        // terminaba con dos claquetas donde hubo una.
        const lista = [{ n: 1, ms: T0 + 1500, frase: 'Claqueta 1, clase 1', comentario: 'lo escrito' }];
        historial.ponerEnLista(lista, { n: 1, ms: T0, comentario: 'lo escrito' },
            { n: 1, ms: T0, comentario: '' },
            { campos: ['comentario'], esLaMisma: vivo.mismaClaqueta });
        t.eq(lista.length, 1);
        t.eq(lista[0].comentario, '');
        t.eq(lista[0].ms, T0 + 1500, 'y el `ms` que dejó la fusión no se toca');
    });

    t.test('sin campos sigue siendo saca-y-pone, que es lo que quitar necesita', () => {
        const lista = [{ n: 1, ms: T0, comentario: 'x' }];
        historial.ponerEnLista(lista, { ...lista[0] }, null);
        t.eq(lista.length, 0);
    });

    t.group('nota de claqueta · en una sesión que se está grabando');

    t.test('escribirla, fundirla y deshacerla sin perder nada', async () => {
        const dir = carpeta();
        let estado;
        try {
            estado = grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 60; i++) grabacion.pcm(Buffer.alloc(8192));
            grabacion.claqueta();
            const s = grabacion._sesion();
            const ms = s.estado.claquetas[0].ms;

            grabacion.editar({ tipo: 'nota-claqueta', n: 1, texto: 'Cámara 2 arrancó tarde' });
            t.eq(s.estado.claquetas[0].comentario, 'Cámara 2 arrancó tarde');

            // Whisper confirma la palabra dicha unos segundos más tarde.
            vivo.anotarClaqueta(s.estado, {
                ms: ms + 1500, frase: 'Claqueta 1, clase 1', confirmada: true, origen: 'golpe,voz'
            });

            const r = grabacion.deshacer();
            t.ok(r.ok, 'se pudo deshacer');
            t.eq(r.que, 'la nota de la claqueta 1', 'y dice qué deshizo');
            t.eq(s.estado.claquetas.length, 1);
            t.eq(s.estado.claquetas[0].comentario, '', 'volvió la nota');
            t.eq(s.estado.claquetas[0].frase, 'Claqueta 1, clase 1',
                'y lo que pasó después no se lo llevó puesto');

            grabacion.rehacer();
            t.eq(s.estado.claquetas[0].comentario, 'Cámara 2 arrancó tarde');
            t.eq(s.estado.claquetas[0].frase, 'Claqueta 1, clase 1');
        } finally {
            grabacion.apagar();
        }
        const xml = fs.readFileSync(estado.archivos.xml, 'utf8');
        t.ok(xml.includes('Cámara 2 arrancó tarde'), 'y el XML del disco la tiene');
    });

    t.test('la nota de una claqueta que ya no está no rompe nada', () => {
        const dir = carpeta();
        try {
            grabacion.iniciar({ dir, curso: 'prueba', fps: 30, sinReloj: true });
            for (let i = 0; i < 60; i++) grabacion.pcm(Buffer.alloc(8192));
            const r = grabacion.editar({ tipo: 'nota-claqueta', n: 7, texto: 'tarde' });
            t.ok(r, 'contesta el estado igual');
            t.eq(grabacion.deshacer().ok, false, 'y no dejó ningún paso fantasma');
        } finally {
            grabacion.apagar();
        }
    });

    t.group('nota de claqueta · en una sesión ya grabada');

    t.test('un sidecar sin el campo se comenta y se rehace sin migrar nada', () => {
        const dir = carpeta();
        const secuencia = 'curso_2026-09-30_12-04-00';
        const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
        workspace.ensureDir(path.dirname(wav));
        fs.writeFileSync(wav, Buffer.alloc(1024));

        const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
        estado.sesiones = [{ archivo: wav, desdeMs: T0, segundos: 600, sampleRate: 48000, canales: 1 }];
        estado.tomas = [{
            id: 1, vista: 'PV', comentario: 'Una', cuenta: '3, 2, 1.',
            inMs: T0 + 20000, outMs: T0 + 80000, descartada: false,
            palabras: [{ t: T0 + 20000, texto: 'Hola' }], comentarios: []
        }];
        vivo.anotarClaqueta(estado, {
            ms: T0 + 12000, paredMs: T0 + 12000, frase: 'Claqueta 1, clase 1',
            confirmada: true, origen: 'golpe,voz'
        });
        estado.terminada = T0 + 600000;

        const archivos = workspace.archivosDeSesion(dir, secuencia);
        const viejo = notasXml.sidecar(estado);
        // Un sidecar de 0.1.3: las claquetas no tenían `comentario`.
        for (const c of viejo.claquetas) delete c.comentario;
        workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
        workspace.writeJson(archivos.json, viejo);

        const antes = sesiones.rehacerXml(archivos.json, null);
        t.eq(antes.claquetas, 1, 'rehacer el XML del sidecar viejo sigue andando');

        sesiones.editarGrabada(archivos.json, {
            tipo: 'nota-claqueta', n: 1, texto: 'Acá se cambió la tarjeta'
        });
        const guardado = JSON.parse(fs.readFileSync(archivos.json, 'utf8'));
        t.eq(guardado.claquetas[0].comentario, 'Acá se cambió la tarjeta');
        t.eq(guardado.claquetas[0].frase, 'Claqueta 1, clase 1', 'sin perder lo que ya tenía');
        t.eq(guardado.tomas[0].comentario, 'Una', 'ni la nota de la toma');
        t.ok(fs.readFileSync(archivos.xml, 'utf8').includes('Acá se cambió la tarjeta'));

        // Y rehacer el XML después la conserva: es el botón que se aprieta al
        // final, y perder ahí lo escrito sería perderlo sin que nada lo diga.
        sesiones.rehacerXml(archivos.json, null);
        t.ok(fs.readFileSync(archivos.xml, 'utf8').includes('Acá se cambió la tarjeta'));
    });

    t.test('una claqueta que no existe se dice, no se traga', () => {
        const dir = carpeta();
        const secuencia = 'curso_2026-09-30_12-04-00';
        const estado = vivo.estadoNuevo({ secuencia, curso: 'curso', ceroMs: T0, fps: 30 });
        estado.terminada = T0 + 600000;
        const archivos = workspace.archivosDeSesion(dir, secuencia);
        workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
        workspace.writeJson(archivos.json, notasXml.sidecar(estado));
        let dijo = '';
        try {
            sesiones.editarGrabada(archivos.json, { tipo: 'nota-claqueta', n: 3, texto: 'x' });
        } catch (err) {
            dijo = err.message;
        }
        t.ok(/claqueta 3/.test(dijo), `lo dice y la nombra: ${dijo}`);
    });

    t.group('nota de claqueta · la fila');

    t.test('la fila se despliega y adentro está el campo', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/data-hace="plegar-claqueta"/.test(js), 'el renglón abre');
        t.ok(/data-campo="nota-claqueta"/.test(js), 'y tiene su campo');
        t.ok(/class="cuerpo-toma"[\s\S]{0,400}data-campo="nota-claqueta"/.test(js),
            'en la misma caja que la nota de una toma: el mismo aspecto');
        t.ok(/va en el marcador del XML/.test(js), 'y dice adónde va lo que se escribe');
    });

    t.test('la fila y su campo se identifican por `ms`, que no se corre', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/vista\.abierta === `c\$\{c\.ms\}`/.test(js), 'lo abierto se recuerda por ms');
        t.ok(/data-campo="nota-claqueta" data-claqueta="\$\{c\.n\}" data-ms="\$\{c\.ms\}"/.test(js),
            'el campo lleva los dos: el ms para encontrarlo y el n para el cambio');
        t.ok(/f\.ms \? `\[data-ms="\$\{f\.ms\}"\]`/.test(js),
            'y al repintar se vuelve a él por ms');
    });

    t.test('el cambio que sale de la fila es el que el motor entiende', () => {
        const js = leer('src', 'js', 'pantalla-vivo.js');
        t.ok(/tipo: 'nota-claqueta', n: Number\(claqueta\.dataset\.claqueta\)/.test(js));
        const motor = leer('engine', 'cambios-toma.js');
        t.ok(/c\.tipo === 'nota-claqueta'/.test(motor), 'y el motor lo desvía antes de buscar la toma');
    });

    t.test('la abre un botón de verdad, y no el renglón', () => {
        // El renglón de una toma es `role="button"` entero; el de una claqueta
        // no puede serlo, porque adentro tiene el botón de quitarla y un botón
        // dentro de otro no hay lector de pantalla que lo anuncie. Así que el
        // chevron es el botón, con su teclado puesto sin ayuda de nadie.
        const js = leer('src', 'js', 'pantalla-vivo.js');
        const desde = js.indexOf('function filaClaqueta(');
        const fila = js.slice(desde, js.indexOf('\n}', desde));
        t.ok(!/role="button"/.test(fila), 'el renglón no se declara botón');
        t.ok(/<button class="btn btn-tenue btn-ico chevron"[\s\S]*?data-hace="plegar-claqueta"/.test(fila),
            'el chevron sí');
        t.ok(/aria-expanded="\$\{abierta\}"/.test(fila), 'y dice si está abierto');
        t.ok(!/\[data-hace="plegar-claqueta"\]/.test(js.slice(js.indexOf('async function alTeclado'))),
            'sin el parche de teclado de las tomas: un botón de verdad no lo necesita, ' +
            'y con él el Enter abriría y cerraría de una');
    });
};
