'use strict';
/**
 * Las sesiones que ya están en el disco: listar, renombrar, borrar y reanudar.
 *
 * Lo que estas pruebas cuidan sobre todo es el ORDEN de las escrituras. Las
 * tres operaciones tocan tres archivos y tres archivos no se pueden escribir de
 * una: lo que se fija acá es que un corte a la mitad nunca deje una sesión
 * desaparecida de la lista, que es lo único que no se puede arreglar mirando.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sesiones = require('../engine/sesiones-grabadas');
const workspace = require('../engine/workspace');
const notasXml = require('../engine/notas-xml');
const vivo = require('../engine/notas-vivo');
const nombre = require('../engine/nombre-de-sesion');

const T0 = Date.parse('2026-09-29T10:00:00');

function carpeta() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nt-lista-'));
}

/** Deja una sesión escrita en el disco, con su WAV de mentira. */
function sembrar(dir, opciones) {
    const o = opciones || {};
    const secuencia = o.secuencia || 'curso_2026-09-29_10-00-00';
    const wav = path.join(workspace.audioDir(dir), `${secuencia}-1.wav`);
    workspace.ensureDir(path.dirname(wav));
    fs.writeFileSync(wav, Buffer.alloc(1024));

    // Todo cuelga del cero, que por defecto es `T0`: así una sesión sembrada con
    // otra hora queda coherente —el WAV, las tomas y la claqueta se mueven con
    // ella— y el orden de la lista se puede probar de verdad.
    const cero = o.ceroMs != null ? o.ceroMs : T0;
    const estado = vivo.estadoNuevo({
        secuencia, curso: o.curso || 'curso', ceroMs: cero, fps: 30,
        numero: o.numero != null ? o.numero : null,
        vez: o.vez != null ? o.vez : null
    });
    estado.sesiones = [{ archivo: wav, desdeMs: cero, segundos: 600, sampleRate: 48000, canales: 1 }];
    estado.tomas = o.tomas || [{
        id: 1, vista: 'PV', comentario: 'Una', cuenta: '3, 2, 1.',
        inMs: cero + 20000, outMs: cero + 80000, descartada: false,
        palabras: [{ t: cero + 20000, texto: 'Hola' }], comentarios: []
    }];
    if (o.claquetas !== false) {
        vivo.anotarClaqueta(estado, { ms: cero + 12000, confirmada: true, origen: 'golpe' });
    }
    if (o.terminada !== false) estado.terminada = cero + 600000;

    const archivos = workspace.archivosDeSesion(dir, secuencia);
    workspace.writeAtomic(archivos.xml, notasXml.xmlDeNotas(estado));
    workspace.writeJson(archivos.json, notasXml.sidecar(estado));
    return { ...archivos, secuencia, wav };
}

module.exports = function (t) {
    t.group('sesiones-grabadas · listar');

    // El modo semanal pasó a darle una carpeta a cada grabación. Lo que estas
    // dos pruebas cuidan es el día del cambio: en la misma carpeta hay
    // grabaciones de las dos formas, y una lista que solo entendiera la nueva
    // las habría escondido sin borrarlas, que es peor que borrarlas.
    t.test('encuentra una grabación con su carpeta propia', () => {
        const casa = carpeta();
        const suya = workspace.carpetaDeGrabacion(casa, '2026-09-29_10-00-00');
        sembrar(suya, { secuencia: 'semana_2026-09-29_10-00-00' });
        const lista = sesiones.listar([casa]);
        t.eq(lista.length, 1, 'la encuentra un piso más abajo');
        t.eq(lista[0].secuencia, 'semana_2026-09-29_10-00-00');
        t.eq(lista[0].carpeta, suya, 'y dice la carpeta de la grabación, no la de arriba');
    });

    t.test('las de antes y las de ahora salen juntas, sin repetirse', () => {
        const casa = carpeta();
        sembrar(casa, { secuencia: 'semana_2026-09-28_09-00-00', ceroMs: T0 - 86400000 });
        sembrar(workspace.carpetaDeGrabacion(casa, '2026-09-29_10-00-00'),
            { secuencia: 'semana_2026-09-29_10-00-00', ceroMs: T0 });
        const lista = sesiones.listar([casa]);
        t.eq(lista.length, 2);
        t.eq(lista.map(x => x.secuencia).join(' '),
            'semana_2026-09-29_10-00-00 semana_2026-09-28_09-00-00', 'la última primero');
    });

    // Una carpeta renombrada a mano sigue siendo una grabación: lo que la hace
    // una es tener el archivo con la hora del día adentro, no cómo se llame.
    t.test('una carpeta renombrada a mano se sigue viendo', () => {
        const casa = carpeta();
        sembrar(path.join(casa, 'La semana que hablé del precio'),
            { secuencia: 'semana_2026-09-29_10-00-00' });
        t.eq(sesiones.listar([casa]).length, 1);
    });

    t.test('encuentra lo que hay y lo resume', () => {
        const dir = carpeta();
        sembrar(dir);
        const lista = sesiones.listar([dir]);
        t.eq(lista.length, 1);
        t.eq(lista[0].resumen.tomas, 1);
        t.eq(lista[0].resumen.claquetas, 1);
        t.eq(lista[0].resumen.segundos, 600);
        t.eq(lista[0].resumen.estado, 'terminada');
    });

    t.test('una sesión sin cerrar se dice `abierta`', () => {
        const dir = carpeta();
        sembrar(dir, { terminada: false });
        t.eq(sesiones.listar([dir])[0].resumen.estado, 'abierta');
    });

    t.test('una con tomas sin releer se dice `sin releer`', () => {
        const dir = carpeta();
        sembrar(dir, {
            tomas: [{
                id: 1, vista: 'PV', inMs: T0 + 1000, outMs: T0 + 2000, descartada: false,
                palabras: [], comentarios: [], relectura: { estado: 'sin-leer' }
            }]
        });
        const r = sesiones.listar([dir])[0].resumen;
        t.eq(r.estado, 'sin releer');
        t.eq(r.sinReleer, 1);
    });

    t.test('la que se está grabando no aparece', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        t.eq(sesiones.listar([dir], s.secuencia).length, 0);
    });

    t.test('un sidecar roto no tira la lista entera', () => {
        const dir = carpeta();
        sembrar(dir);
        fs.writeFileSync(
            path.join(workspace.datosDir(dir), `roto${workspace.SUFIJO_SIDECAR}`), '{no json');
        t.eq(sesiones.listar([dir]).length, 1, 'la buena sigue');
    });

    t.test('una carpeta que no existe no rompe nada', () => {
        t.deep(sesiones.listar(['/no/existe/para/nada']), []);
    });

    t.group('sesiones-grabadas · renombrar');

    t.test('mueve los tres archivos de la clase', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { numero: 3 });
        t.ok(r.movida);
        t.eq(r.secuencia, '03_curso_2026-09-29_10-00-00');
        t.ok(fs.existsSync(r.archivos.xml), 'el XML nuevo está');
        t.ok(fs.existsSync(r.archivos.json), 'y el sidecar');
        t.eq(fs.existsSync(s.xml), false, 'el viejo se fue');
        t.eq(r.audios, 1, 'y el WAV se movió con él');
    });

    t.test('el sidecar nuevo apunta al WAV donde está ahora', () => {
        // Es de donde sale el clip de A1 y «Regenerar» meses después.
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { numero: 3 });
        const sidecar = JSON.parse(fs.readFileSync(r.archivos.json, 'utf8'));
        t.ok(fs.existsSync(sidecar.sesiones[0].archivo), sidecar.sesiones[0].archivo);
    });

    t.test('nunca cambia la hora', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { numero: 3 });
        t.ok(r.secuencia.endsWith('_2026-09-29_10-00-00'));
    });

    t.test('el mismo nombre no mueve nada', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { numero: '' });
        t.eq(r.movida, false, 'sin número, y ya no tenía: el nombre es el mismo');
    });

    t.test('un archivo que ya está en ese nombre se rechaza', () => {
        // Dos clases no pueden chocar entre ellas: repetir un número da una V2.
        // Lo que sí puede estar en el camino es un archivo suelto —un XML sin
        // sidecar, de una copia a mano o de un borrado a medias—, que no sale en
        // la lista y por eso no entra en la cuenta de las veces. Pisarlo sería
        // perderlo sin decirlo.
        const dir = carpeta();
        const s = sembrar(dir);
        fs.writeFileSync(path.join(dir, 'xml', '03_curso_2026-09-29_10-00-00.xml'), 'suelto');
        let error = null;
        try { sesiones.renombrar(s.json, { numero: 3 }); } catch (e) { error = e.message; }
        t.ok(error && error.includes('Ya hay una sesión'), error);
        t.ok(fs.existsSync(s.xml), 'y la original sigue entera');
    });

    t.test('la que se está grabando no se renombra', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.renombrar(s.json, { numero: 3 }, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.group('sesiones-grabadas · el número de clase');

    /** Una clase con su número, nombrada como la nombra la app. */
    const clase = (dir, numero, vez, minuto) => sembrar(dir, {
        numero,
        vez,
        ceroMs: T0 + (minuto || 0) * 60000,
        secuencia: nombre.armar({
            curso: 'curso', numero, vez, cuandoMs: T0 + (minuto || 0) * 60000
        })
    });

    t.test('el número va delante y el resto del nombre no se toca', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.renombrar(s.json, { numero: 3 });
        t.ok(r.movida);
        t.eq(r.secuencia, '03_curso_2026-09-29_10-00-00');
        t.ok(fs.existsSync(r.archivos.xml) && fs.existsSync(r.archivos.json));
        t.eq(r.audios, 1, 'el WAV se mueve con el nombre nuevo');
        const sidecar = JSON.parse(fs.readFileSync(r.archivos.json, 'utf8'));
        t.eq(sidecar.numero, 3, 'se guarda aparte, para no tener que releer el nombre');
        t.eq(sidecar.curso, 'curso', 'y el curso no se toca');
        t.ok(fs.readFileSync(r.archivos.xml, 'utf8').includes('03_curso_2026-09-29_10-00-00'),
            'la secuencia del XML también se llama así');
    });

    t.test('renombrar otra vez lo reemplaza, no le suma otro delante', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const a = sesiones.renombrar(s.json, { numero: 3 });
        const b = sesiones.renombrar(a.archivos.json, { numero: 4 });
        t.eq(b.secuencia, '04_curso_2026-09-29_10-00-00');
    });

    t.test('vacío le quita el número', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const a = sesiones.renombrar(s.json, { numero: 3 });
        const b = sesiones.renombrar(a.archivos.json, { numero: '' });
        t.eq(b.secuencia, s.secuencia);
        t.eq(JSON.parse(fs.readFileSync(b.archivos.json, 'utf8')).numero, null);
    });

    t.test('el curso se queda como estaba, aunque la carpeta se haya renombrado', () => {
        // Podría rearmarse del nombre de la carpeta, que es de donde sale ahora.
        // No se hace: el nombre de una clase ya grabada es con lo que el editor
        // empareja los archivos de la cámara, y rebautizar diez clases viejas
        // porque alguien le corrigió una tilde a la carpeta rompe eso en silencio.
        const dir = carpeta();
        const a = clase(dir, 1, 1, 0);
        const r = sesiones.renombrar(a.json, { numero: 5 });
        t.eq(r.secuencia, '05_curso_2026-09-29_10-00-00', 'el curso viejo, el número nuevo');
        t.eq(JSON.parse(fs.readFileSync(r.archivos.json, 'utf8')).curso, 'curso');
    });

    t.test('la lista trae el número, para editarlo', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.renombrar(s.json, { numero: 3 });
        const puesta = sesiones.listar([dir])[0];
        t.eq(puesta.numero, 3);
        t.eq(puesta.vez, 1, 'la primera vez que se grabó esa clase');
    });

    t.test('la vez de clase no pisa la versión del formato del sidecar', () => {
        // Pasó: al número de vez lo llamé `version`, que es el nombre que ya
        // tenía la versión del FORMATO del sidecar. Las dos claves cayeron en el
        // mismo objeto literal y ganó la última, así que una clase 01 dejaba el
        // archivo diciendo que era de la versión 1 del formato en vez de la 2.
        //
        // Un sidecar que miente sobre su propio formato se lee mal para siempre
        // y en silencio, y es por eso que esto se comprueba y no se confía en
        // que nadie vuelva a elegir ese nombre.
        const dir = carpeta();
        const s = clase(dir, 1, 3, 0);
        const escrito = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        t.eq(escrito.version, 2, 'la del formato, que es la que leen los lectores');
        t.eq(escrito.vez, 3, 'y la de clase, aparte');
    });

    t.test('el que sigue es el más alto, más uno', () => {
        const dir = carpeta();
        t.eq(sesiones.proximoNumero(dir), 1, 'una carpeta vacía empieza en la 01');
        clase(dir, 1, 1, 0);
        t.eq(sesiones.proximoNumero(dir), 2);
        clase(dir, 5, 1, 10);
        t.eq(sesiones.proximoNumero(dir), 6, 'el más alto y no cuántas hay');
    });

    t.test('borrar una del medio no reusa su número', () => {
        // El número es cómo se llama la clase: «en la 04 expliqué los hooks».
        // Reusarlo haría que dos clases distintas se llamaran igual en los
        // apuntes de quien la vio.
        const dir = carpeta();
        clase(dir, 1, 1, 0);
        const dos = clase(dir, 2, 1, 10);
        clase(dir, 3, 1, 20);
        sesiones.borrar(dos.json);
        t.eq(sesiones.proximoNumero(dir), 4);
    });

    t.test('una clase de antes del número no rompe la cuenta', () => {
        // Las grabadas antes de que esto existiera no tienen número, y tienen
        // que seguir listándose: una sesión que no se lee no se puede abrir.
        const dir = carpeta();
        sembrar(dir);
        t.eq(sesiones.proximoNumero(dir), 1, 'no cuenta, y no tira la cuenta');
        t.eq(sesiones.listar([dir]).length, 1, 'pero sigue estando');
    });

    t.test('el número lee del nombre cuando el sidecar no lo dice', () => {
        // El sidecar manda y el nombre es el respaldo, que es el mismo orden que
        // usa todo lo demás. Importa para las clases de una versión anterior,
        // que están en el disco con el número en el nombre y sin él adentro.
        const dir = carpeta();
        sembrar(dir, { secuencia: '07_curso_2026-09-29_10-00-00' });
        t.eq(sesiones.proximoNumero(dir), 8);
        // Y la lista lo trae ya resuelto: es el número que la pantalla pone en el
        // campo del lápiz, y tiene que ser el mismo que el motor cuenta.
        t.eq(sesiones.listar([dir])[0].numero, 7, 'el de su nombre');
        t.eq(sesiones.listar([dir])[0].vez, 1);
    });

    t.test('repetir un número da V2, y después V3', () => {
        const dir = carpeta();
        t.eq(sesiones.vezLibre(dir, 1), 1, 'libre, así que no lleva marca');
        clase(dir, 1, 1, 0);
        t.eq(sesiones.vezLibre(dir, 1), 2);
        clase(dir, 1, 2, 10);
        t.eq(sesiones.vezLibre(dir, 1), 3);
        t.eq(sesiones.proximoNumero(dir), 2, 'y las veces no corren el número');
    });

    t.test('la V2 se escribe en el nombre y en la secuencia', () => {
        const dir = carpeta();
        clase(dir, 1, 1, 0);
        const s = sembrar(dir, { ceroMs: T0 + 600000, secuencia: 'otra_2026-09-29_10-10-00' });
        const r = sesiones.renombrar(s.json, { numero: 1 });
        t.eq(r.secuencia, '01_V2_curso_2026-09-29_10-10-00');
        t.ok(fs.readFileSync(r.archivos.xml, 'utf8').includes('01_V2_curso_2026-09-29_10-10-00'),
            'la secuencia de Premiere también');
    });

    t.test('guardar sin cambiar nada no la empuja a la vez siguiente', () => {
        // Al contar las veces de esa clase hay que SACARLA de la cuenta a ella
        // misma. Sin eso, cada vez que se abría el lápiz y se guardaba, la misma
        // sesión subía una V, y el nombre decía que se había grabado seis veces
        // una clase que se grabó una.
        const dir = carpeta();
        clase(dir, 1, 1, 0);
        const s = sembrar(dir, { ceroMs: T0 + 600000, secuencia: 'otra_2026-09-29_10-10-00' });
        const a = sesiones.renombrar(s.json, { numero: 1 });
        t.eq(a.secuencia, '01_V2_curso_2026-09-29_10-10-00');
        const b = sesiones.renombrar(a.archivos.json, { numero: 1 });
        t.eq(b.secuencia, '01_V2_curso_2026-09-29_10-10-00', 'sigue siendo la V2');
        t.eq(b.movida, false, 'y no se movió ningún archivo');
    });

    t.test('mover una clase a un número tomado la vuelve V2 de ESE número', () => {
        // La V que traía no significa nada en el número nuevo: se recalcula.
        const dir = carpeta();
        clase(dir, 3, 1, 0);
        const s = clase(dir, 9, 1, 10);
        const r = sesiones.renombrar(s.json, { numero: 3 });
        t.eq(r.secuencia, '03_V2_curso_2026-09-29_10-10-00');
    });

    t.test('la pantalla ya no usa window.prompt, que Electron no tiene', () => {
        // `prompt()` en Electron tira «prompt() is not supported»: el lápiz
        // nunca hizo nada.
        const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pantalla-sesiones.js'), 'utf8');
        t.ok(!/window\.prompt\(/.test(js));
        t.ok(/grabarRenombrar\(json, \{ numero: campo\.value \}\)/.test(js), 'manda el número');
    });

    t.test('el lápiz edita el número y deja fijo el resto del nombre', () => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pantalla-sesiones.js'), 'utf8');
        t.ok(/type="number" min="1" step="1" data-campo="numero"/.test(js),
            'es un campo de número, no de texto libre');
        t.ok(/<span class="ses-base">_\$\{esc\(base\)\}<\/span>/.test(js),
            'y al lado se ve lo que no se toca: el curso, la fecha y la hora');
    });

    t.test('el curso no se escribe en ningún sitio: es el nombre de la carpeta', () => {
        // «El nombre del curso debe sí o sí ser siempre el slug que es el nombre
        // de la carpeta». Había un campo para escribirlo en Ajustes y otro al
        // lado de la carpeta, y un valor guardado aparte se escribe una vez y
        // después miente: quien elegía otra carpeta seguía grabando clases con el
        // nombre del curso anterior.
        //
        // Lo que queda es una sola decisión, en el motor. Tenerla en las
        // pantallas también —estuvo en tres sitios— quería decir que el nombre
        // que se mostraba de ejemplo podía dejar de ser el que se iba a grabar, y
        // eso no se nota hasta que ya está en el disco.
        const raiz = path.join(__dirname, '..');
        const html = fs.readFileSync(path.join(raiz, 'src', 'index.html'), 'utf8');
        t.ok(!/id="aj-curso"|id="curso-nombre"/.test(html), 'no hay campo que escribir');
        t.ok(/id="curso-ejemplo"/.test(html), 'pero sí la vista previa del nombre que viene');
        for (const cual of ['pantalla-sesiones.js', 'pantalla-preparar.js']) {
            const js = fs.readFileSync(path.join(raiz, 'src', 'js', cual), 'utf8');
            t.ok(!/split\('\/'\)\.filter\(Boolean\)\.pop\(\)/.test(js),
                `${cual} no se saca el nombre de la carpeta por su cuenta`);
            t.ok(!/ajustes\.curso/.test(js), `${cual} tampoco lo lee de los ajustes`);
        }
        const guardados = fs.readFileSync(path.join(raiz, 'engine', 'ajustes.js'), 'utf8');
        t.ok(!/^\s*curso:/m.test(guardados), 'y no queda guardado, que es de dónde mentía');
        const motor = fs.readFileSync(path.join(raiz, 'engine', 'nombre-de-sesion.js'), 'utf8');
        t.ok(/function cursoPorDefecto\(dir\)/.test(motor), 'lo decide el motor, en un solo sitio');
    });

    t.test('la lista de verificación muestra el número antes de grabar', () => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pantalla-preparar.js'), 'utf8');
        t.ok(/titulo: 'Qué clase es'/.test(js), 'tiene su renglón');
        t.ok(/numero: nombre \? nombre\.numero : null/.test(js),
            'y manda el número al arrancar, no la vez: esa la resuelve el motor');
        t.ok(/nombre = reanudar \? null : await preguntarElNombre\(\)/.test(js),
            'al reanudar no se ofrece: esa clase ya tiene su nombre y sus marcadores');
        // Escribir un número tomado tiene que mostrar la V2 ANTES de grabar:
        // después de tres horas no hay arreglo barato.
        t.ok(/nombre = await preguntarElNombre\(campo\.value\)/.test(js),
            'y al escribir uno se le vuelve a preguntar al motor');
        t.ok(/Ya hay una clase \$\{dosDigitos\(nombre\.numero\)\} en esta carpeta/.test(js),
            'que es lo que deja avisar de la V2 a tiempo');
    });

    t.group('sesiones-grabadas · borrar');

    t.test('se lleva los tres archivos', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const r = sesiones.borrar(s.json);
        t.ok(r.xml);
        t.ok(r.sidecar);
        t.eq(r.audios, 1);
        t.eq(fs.existsSync(s.xml), false);
        t.eq(fs.existsSync(s.json), false);
        t.eq(fs.existsSync(s.wav), false);
    });

    t.test('lo que falta no es un error', () => {
        // Se llega a borrar una sesión justamente cuando quedó mal, y plantarse
        // en el primer archivo ausente dejaría los otros dos sin forma de
        // sacarlos desde la app.
        const dir = carpeta();
        const s = sembrar(dir);
        fs.unlinkSync(s.xml);
        const r = sesiones.borrar(s.json);
        t.eq(r.xml, false, 'dice que ese no estaba');
        t.ok(r.sidecar, 'y borra el que sí');
    });

    t.test('no borra un WAV de fuera de la carpeta', () => {
        const dir = carpeta();
        const afuera = path.join(os.tmpdir(), `nt-ajeno-${Date.now()}.wav`);
        fs.writeFileSync(afuera, Buffer.alloc(16));
        const s = sembrar(dir);
        const sidecar = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        sidecar.sesiones[0].archivo = afuera;
        fs.writeFileSync(s.json, JSON.stringify(sidecar));
        sesiones.borrar(s.json);
        t.ok(fs.existsSync(afuera), 'sigue ahí');
        fs.unlinkSync(afuera);
    });

    t.test('la que se está grabando no se borra', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.borrar(s.json, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.group('sesiones-grabadas · reanudar');

    t.test('una sesión abierta se puede reanudar', () => {
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        const previa = sesiones.paraReanudar(s.json);
        t.eq(previa.ceroMs, T0, 'el cero no se mueve');
        t.eq(previa.dir, dir);
        t.eq(previa.estado.secuencia, s.secuencia);
    });

    t.test('los contadores siguen desde donde estaban', () => {
        // Una toma nueva no puede reusar el id de una vieja, y una claqueta
        // nueva no puede llamarse como una que ya está en el XML.
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        const previa = sesiones.paraReanudar(s.json);
        t.eq(previa.estado.proximaToma, 1);
        t.eq(previa.estado.proximaClaqueta, 1);
    });

    t.test('una sesión ya cerrada NO se reanuda', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.paraReanudar(s.json); } catch (e) { error = e.message; }
        t.ok(error && error.includes('ya se cerró'), error);
    });

    t.test('la que se está grabando tampoco', () => {
        const dir = carpeta();
        const s = sembrar(dir, { terminada: false });
        let error = null;
        try { sesiones.paraReanudar(s.json, s.secuencia); } catch (e) { error = e.message; }
        t.ok(error && error.includes('ya se está grabando'), error);
    });

    t.group('sesiones-grabadas · rehacer el XML');

    t.test('reescribe el XML con el formato de hoy sin tocar las notas', () => {
        // Es para lo que existe: una clase grabada con una versión anterior
        // tiene el XML de entonces, y sin esto habría que volver a grabarla
        // para que el arreglo le llegue.
        const dir = carpeta();
        const s = sembrar(dir);
        // Un XML de antes: el marcador se llamaba solo «PV» y no había
        // marcadores en el clip maestro.
        const viejo = fs.readFileSync(s.xml, 'utf8')
            .replace(/<name>Toma 1 · PV<\/name>/g, '<name>PV</name>');
        fs.writeFileSync(s.xml, viejo);
        const antes = JSON.parse(fs.readFileSync(s.json, 'utf8'));

        const r = sesiones.rehacerXml(s.json);
        t.eq(r.tomas, 1);
        const xml = fs.readFileSync(s.xml, 'utf8');
        t.ok(xml.includes('<name>Toma 1 · PV</name>'), 'el marcador lleva el número de la toma');
        t.ok(xml.slice(0, xml.indexOf('<sequence')).includes('<marker>'),
            'y el clip maestro tiene sus marcadores');

        const despues = JSON.parse(fs.readFileSync(s.json, 'utf8'));
        t.deep(despues.tomas.map(x => x.comentario), antes.tomas.map(x => x.comentario),
            'las notas quedaron igual');
        t.deep(despues.tomas.map(x => (x.palabras || []).map(w => w.texto)),
            antes.tomas.map(x => (x.palabras || []).map(w => w.texto)),
            'y el texto también');
    });

    t.test('la sesión que se está grabando no se rehace', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        const suya = JSON.parse(fs.readFileSync(s.json, 'utf8')).secuencia;
        let error = null;
        try { sesiones.rehacerXml(s.json, suya); } catch (e) { error = e.message; }
        t.ok(error && /grabando/.test(error), error);
    });

    t.group('sesiones-grabadas · editar una ya cerrada');

    t.test('cambiar la vista reescribe el XML', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.editarGrabada(s.json, { tipo: 'vista', toma: 1, vista: 'R' });
        const xml = fs.readFileSync(s.xml, 'utf8');
        t.ok(xml.includes('<name>Toma 1 · R</name>'), 'el marcador cambió de vista');
    });

    t.test('quitar una claqueta también', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        sesiones.editarGrabada(s.json, { tipo: 'quitar-claqueta', n: 1 });
        t.ok(!fs.readFileSync(s.xml, 'utf8').includes('Claqueta 1'));
    });

    t.test('reabrir una toma se niega, y dice por qué', () => {
        const dir = carpeta();
        const s = sembrar(dir);
        let error = null;
        try { sesiones.editarGrabada(s.json, { tipo: 'reabrir', toma: 1 }); }
        catch (e) { error = e.message; }
        t.ok(error && error.includes('grabando'), error);
    });

    t.test('un archivo que no es un sidecar se rechaza', () => {
        let error = null;
        try { sesiones.editarGrabada('/tmp/cualquiera.txt', { tipo: 'vista', toma: 1 }); }
        catch (e) { error = e.message; }
        t.ok(error && error.includes('no es el archivo'), error);
    });
};
