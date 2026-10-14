'use strict';
/**
 * Los comentarios sobre un pedazo del texto: ponerlos, corregirlos y quitarlos.
 *
 * Lo que se prueba es que los tres gestos trabajen sobre la MISMA lista y la
 * dejen bien, porque los tres se nombran por índice y un índice corrido edita
 * o borra el comentario de al lado. Eso no se ve en la pantalla —el renglón
 * cambia y parece que anduvo— y aparece en el XML, después de la clase, como
 * un marcador blanco con el texto de otro.
 *
 * Y que corregir NO mueva el pedazo señalado: `desdeMs`, `hastaMs` y las
 * palabras citadas salieron de lo que se eligió con el mouse. Si el texto se
 * pudiera cambiar sin volver a elegir, el marcador del XML quedaría diciendo
 * una cosa sobre un tramo que dice otra.
 */

const path = require('path');
const fs = require('fs');

const vivo = require('../engine/notas-vivo');
const deshacer = require('../engine/deshacer');

const RAIZ = path.join(__dirname, '..');

const unaToma = () => ({ id: 1, vista: 'PV', inMs: 1000, outMs: 9000, comentarios: [] });

function poner(toma, texto, comentario, desdeMs) {
    vivo.aplicar(toma, {
        tipo: 'comentar',
        desdeMs: desdeMs,
        hastaMs: desdeMs + 500,
        texto,
        comentario
    });
}

module.exports = function (t) {
    t.group('comentarios · poner, corregir y quitar');

    t.test('corregir cambia lo escrito y deja el pedazo donde estaba', () => {
        const toma = unaToma();
        poner(toma, 'la interfaz de chatgpt', 'revisar si aporta', 2000);
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 0, comentario: 'no aporta: cortar' });
        t.eq(toma.comentarios.length, 1, 'sigue siendo uno, no se agregó otro');
        t.eq(toma.comentarios[0].comentario, 'no aporta: cortar');
        t.eq(toma.comentarios[0].texto, 'la interfaz de chatgpt', 'lo citado no se toca');
        t.eq(toma.comentarios[0].desdeMs, 2000);
        t.eq(toma.comentarios[0].hastaMs, 2500);
    });

    t.test('los tres gestos sobre la misma lista, por índice', () => {
        const toma = unaToma();
        poner(toma, 'uno', 'primero', 2000);
        poner(toma, 'dos', 'segundo', 3000);
        poner(toma, 'tres', 'tercero', 4000);
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 1, comentario: 'segundo corregido' });
        t.deep(toma.comentarios.map(c => c.comentario),
            ['primero', 'segundo corregido', 'tercero'],
            'se corrige el del medio y los de al lado quedan intactos');
        vivo.aplicar(toma, { tipo: 'borrar-comentario', indice: 0 });
        t.deep(toma.comentarios.map(c => c.comentario), ['segundo corregido', 'tercero']);
        // Después de borrar, los índices se corrieron: el 0 es el que era 1.
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 0, comentario: 'otra vez' });
        t.deep(toma.comentarios.map(c => c.comentario), ['otra vez', 'tercero']);
    });

    t.test('un índice que no existe no hace nada y no revienta', () => {
        const toma = unaToma();
        poner(toma, 'uno', 'primero', 2000);
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 7, comentario: 'de la nada' });
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: -1, comentario: 'de la nada' });
        t.deep(toma.comentarios.map(c => c.comentario), ['primero']);
    });

    t.test('sin comentarios todavía, corregir tampoco inventa uno', () => {
        const toma = unaToma();
        delete toma.comentarios;
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 0, comentario: 'de la nada' });
        t.ok(!(toma.comentarios || []).length, 'la lista sigue vacía');
    });

    t.test('la foto del historial no cambia sola al corregir', () => {
        // `foto` copia la lista por encima y comparte los comentarios de
        // adentro, porque nadie los escribe en su sitio. Si corregir rompiera
        // esa regla, la foto guardada se corregiría también y ⌘Z devolvería lo
        // mismo que ya está: un paso de deshacer que no deshace nada.
        const toma = unaToma();
        poner(toma, 'uno', 'como estaba', 2000);
        const antes = deshacer.foto(toma);
        vivo.aplicar(toma, { tipo: 'editar-comentario', indice: 0, comentario: 'corregido' });
        t.eq(antes.comentarios[0].comentario, 'como estaba', 'la foto se acuerda');
        t.eq(toma.comentarios[0].comentario, 'corregido', 'y la toma está corregida');
        t.ok(!deshacer.mismaFoto(antes, deshacer.foto(toma)),
            'y el historial lo cuenta como un cambio, así que deja su paso');
    });

    t.test('el cambio está documentado donde se documentan los cambios', () => {
        const codigo = fs.readFileSync(path.join(RAIZ, 'engine', 'cambios-toma.js'), 'utf8');
        t.ok(/editar-comentario \{ indice, comentario \}/.test(codigo),
            'la cabecera de cambios-toma.js lo lista con su payload');
    });

    t.group('comentarios · corregir uno ya escrito');

    const pantalla = () => fs.readFileSync(path.join(RAIZ, 'src', 'js', 'pantalla-vivo.js'), 'utf8');

    t.test('el comentario ES el botón de corregirlo', () => {
        // Antes era un doble clic sobre un `<span>`, con el `title` como única
        // pista, y el editor lo reportó el 13/10 sin haberlo encontrado: «no
        // tienen forma de ser editados, quedan solo para borrar o rehacer». Un
        // botón más al lado de la × no entra —dos iconos de 24 px en un renglón
        // de doce— pero el texto entero sí, y es un blanco grande.
        const codigo = pantalla();
        t.ok(/<button class="crece comentario-dicho" type="button" data-hace="corregir-comentario"/
            .test(codigo), 'el texto se aprieta');
        t.ok(/case 'corregir-comentario':/.test(codigo), 'y abre el campo');
        t.ok(!/dblclick/.test(codigo), 'y ya no hace falta el doble clic');
        // Con el repintado de cada segundo, los dos clics de un doble clic caen
        // en nodos distintos: grabando casi no se podía dar.
        const css = fs.readFileSync(path.join(RAIZ, 'src', 'css', 'style.css'), 'utf8');
        const regla = css.slice(css.indexOf('.comentario-dicho {'), css.indexOf('}', css.indexOf('.comentario-dicho {')));
        t.ok(/cursor: pointer;/.test(regla), 'y se ve que se toca');
        t.ok(/min-height: var\(--row-xs\)/.test(regla),
            'con el alto del renglón entero: 17 px es menos de lo que se puede apretar sin apuntar');
    });

    t.test('el renglón dice qué comentario es, que es lo que el gesto necesita', () => {
        const codigo = pantalla();
        t.ok(/<div class="comentario" data-toma="\$\{t\.id\}" data-indice="\$\{i\}">/.test(codigo),
            'toma e índice en el renglón, no solo en el botón de quitar');
    });

    t.test('no se puede estar escribiendo dos comentarios a la vez', () => {
        const codigo = pantalla();
        const corregir = codigo.slice(codigo.indexOf('function corregirComentario(toma, indice)'),
            codigo.indexOf('\n}', codigo.indexOf('function corregirComentario(toma, indice)')));
        t.ok(/vista\.comentando = null/.test(corregir), 'abrir la corrección cierra el campo nuevo');
        const selec = codigo.slice(codigo.indexOf('function alSeleccionar(e)'),
            codigo.indexOf('\n}\n', codigo.indexOf('function alSeleccionar(e)')));
        t.ok(/vista\.editando = null/.test(selec), 'y seleccionar un pedazo cierra la corrección');
    });

    t.test('Enter guarda y Escape deja el comentario como estaba', () => {
        const codigo = pantalla();
        t.ok(/comentario-editado'\) \{[\s\S]{0,200}'Enter'[\s\S]{0,80}guardarEdicion\(\)/.test(codigo),
            'Enter guarda');
        t.ok(/comentario-editado'\) \{[\s\S]{0,250}'Escape'[\s\S]{0,80}vista\.editando = null/.test(codigo),
            'Escape cancela sin mandar nada al motor');
    });

    t.test('si el renglón dejó de ser ese, no se guarda sobre otro', () => {
        const codigo = pantalla();
        const guardar = codigo.slice(codigo.indexOf('async function guardarEdicion()'),
            codigo.indexOf('\n}', codigo.indexOf('async function guardarEdicion()')));
        t.ok(/if \(!campo\) \{[\s\S]{0,120}vista\.editando = null;[\s\S]{0,40}return;/.test(guardar),
            'sin el campo en la pantalla, el índice guardado ya no vale');
        t.ok(/\.trim\(\)/.test(guardar) && /if \(!comentario\)/.test(guardar),
            'y vacío no se guarda: para eso está la ×');
    });
};
