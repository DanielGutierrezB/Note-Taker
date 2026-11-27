'use strict';
/**
 * openfilm-guia.js — El `PRIMER-CORTE.md` que lee el agente de OpenFilm.
 *
 * Es la mitad del exportador que habla, y vive aparte porque es lo único de
 * todo esto que se escribe para que lo lea alguien y no una máquina: el agente
 * de OpenFilm abre la carpeta, lee este archivo y arma el primer corte. Recibe
 * los mismos datos que se escriben en `clases.json` y no toca el disco, así que
 * se prueba comparando texto.
 *
 * **Lleva los números de ESTA carpeta y no instrucciones generales.** Un
 * «armá una precortada por clase» obliga al agente a deducir cuántas clases hay,
 * cómo se llama cada captura y qué vista usa cuál, y cada deducción es un sitio
 * donde puede errar sin que se note hasta ver el corte. Acá va la cuenta hecha:
 * las clases con su nombre, las capturas con su carpeta, las vistas con su
 * apilado y cuántas tomas tiene que quedar cada clase.
 */

/** Cómo se llama el archivo. En mayúsculas porque es lo primero que hay que abrir. */
const NOMBRE_DE_LA_GUIA = 'PRIMER-CORTE.md';

/**
 * `1 h 23 min`, para decir un largo sin obligar a dividir.
 *
 * Por debajo del minuto, en segundos: una clase de prueba de medio minuto decía
 * «0 min», que se lee como una clase vacía y no como una corta.
 */
function largo(seg) {
    const s = Math.max(0, Math.round(Number(seg) || 0));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/** Cómo se compone una vista, dicho de abajo hacia arriba como sus pistas. */
function comoSeCompone(v, capturas) {
    const nombre = id => (capturas.find(c => c.id === id) || { nombre: `Captura ${id}` }).nombre;
    if (v.capturas.length === 1) return nombre(v.capturas[0]);
    const apilado = v.capturas.slice().reverse().map(nombre).join(' sobre ');
    return v.unidas ? `${apilado}, anidadas` : `${apilado}, en pistas sueltas`;
}

/**
 * El texto de `PRIMER-CORTE.md`.
 *
 * @param {object} datos lo mismo que se escribe en `notas-de-rodaje/clases.json`
 * @returns {string}
 */
function guia(datos) {
    const d = datos || {};
    const capturas = d.capturas || [];
    const clases = d.clases || [];
    const vistas = (d.vistas || []).filter(v => v.usada);
    const tomas = clases.reduce((n, c) => n + (c.tomas || []).length, 0);
    const L = [];

    L.push(`# El primer corte de ${d.curso}`);
    L.push('');
    L.push('Esta carpeta la escribió **Note Taker**, la app con la que se tomaron las notas de rodaje'
        + ' mientras la clase se grababa en vivo. Trae el audio de cada clase, lo que se dijo palabra por'
        + ' palabra y las tomas que el director marcó, con sus bordes ya en segundos.');
    L.push('');
    L.push(`Son **${clases.length} clase(s)** con **${tomas} toma(s)**, grabadas con`
        + ` **${capturas.length} captura(s)**. Lo que falta es el video de cada captura y el montaje:`
        + ' eso es lo que te toca.');
    L.push('');
    L.push('Leé este archivo entero antes de escribir nada, y después el skill de OpenFilm que corresponda'
        + ' para editar el film.');
    L.push('');

    L.push('## Lo que hay acá');
    L.push('');
    // El árbol se alinea contra una columna fija, para que se lea como un árbol
    // y no como una lista de renglones de largos distintos.
    const enColumna = (izquierda, dice) => `  ${izquierda}${' '.repeat(Math.max(1, 21 - izquierda.length))}${dice}`;
    L.push('```');
    L.push('notas-de-rodaje/');
    L.push(enColumna('clases.json', 'todas las clases y sus tomas, con los tiempos ya en segundos'));
    for (const c of clases.slice(0, 3)) {
        L.push(enColumna(`${c.corto}.md`, 'el guion de esa clase: cada toma, su vista, su nota y lo que se dice'));
    }
    if (clases.length > 3) L.push(enColumna('…', `y ${clases.length - 3} clase(s) más`));
    L.push('assets/');
    L.push(enColumna('audio/*.wav', 'el audio de cada clase, grabado por la app'));
    L.push(enColumna('audio/*.vtt', 'lo que se dijo, palabra por palabra, en los segundos de ese WAV'));
    for (const c of capturas) L.push(enColumna(`captura-${c.id}/`, `acá va el video de la ${c.nombre}`));
    L.push('```');
    L.push('');
    L.push('**Los tiempos de `clases.json` ya están en segundos**, redondeados a la milésima, que es como'
        + ' OpenFilm los escribe. No hay ninguna cuenta que hacer: cada toma trae su lugar en tres relojes.');
    L.push('');
    L.push('| Campo de la toma | Qué mide | Para qué sirve |');
    L.push('|---|---|---|');
    L.push('| `enElAudio` | dónde cae en el WAV de su clase | recortar el audio limpio y buscar sus palabras en el `.vtt` |');
    L.push('| `enLaCaptura` | dónde cae en el film de su captura, con la clase ya en su franja | el `#t=` del clip de la precortada |');
    L.push('| `enLaPrecortada` | dónde cae en la precortada de su clase, con las tomas pegadas | el `at` del clip |');
    L.push('');
    L.push('Cada toma trae además `vista` (qué plano es), `nota` (lo que escribió el director),'
        + ' `fuentes` (de qué capturas sale) y `dice` (lo que se dice adentro).'
        + ' Las tomas descartadas no están: lo que ves es lo que va al corte.');
    L.push('');

    L.push('## Las capturas y las vistas');
    L.push('');
    L.push('Una **captura** es una cámara o una pantalla: un archivo por clase, que se graba aparte y hay'
        + ' que sincronizar contra el audio. Una **vista** es un plano del corte, y se compone de una o'
        + ' varias capturas.');
    L.push('');
    for (const c of capturas) {
        L.push(`- **${c.nombre}**: su video va en \`${c.material}\`, y su film en \`${c.film}\`.`);
    }
    L.push('');
    if (vistas.length) {
        L.push('Las vistas que se usaron en estas clases:');
        L.push('');
        L.push('| Vista | Es | Se compone de |');
        L.push('|---|---|---|');
        for (const v of vistas) {
            L.push(`| \`${v.vista}\` | ${v.titulo} | ${comoSeCompone(v, capturas)} |`);
        }
        L.push('');
        L.push('El apilado se lee **de abajo hacia arriba**, como las pistas: la última es la que tapa.'
            + ' «Anidadas» quiere decir que esas capturas van adentro de un film propio de la vista y se'
            + ' encuadran una sola vez para todo el curso; «en pistas sueltas», que cada una va en su'
            + ' propia pista de la precortada y se acomoda toma por toma.');
        L.push('');
    }

    L.push('## Qué armar');
    L.push('');
    L.push('### 1. Un film por captura');
    L.push('');
    L.push('En `parts/captura-N/film.html`, las clases una detrás de otra, cada una en su franja, con'
        + ` **${d.aireSeg} s de aire** entre clase y clase. Las franjas ya están calculadas en`
        + ' `clases.json` (`clase.franja.desdeSeg`):');
    L.push('');
    L.push('| Clase | Empieza en | Dura | Su audio |');
    L.push('|---|---|---|---|');
    for (const c of clases) {
        const a = (c.audio || [])[0];
        L.push(`| ${c.titulo} | ${c.franja.desdeSeg} s | ${largo(c.franja.largoSeg)} | ${a ? `\`${a.archivo}\`` : 'sin audio'} |`);
    }
    L.push('');
    L.push('En cada franja van dos cosas: **el WAV de la clase**, `muted`, que es contra lo que se'
        + ' sincroniza, y **el video de esa captura**, también `muted` acá adentro. El audio bueno del'
        + ' corte sale del WAV en la precortada, no de la cámara.');
    L.push('');
    L.push('**La sincronía es lo único que no te puedo dar hecho.** El video de cada cámara arranca'
        + ' cuando alguien apretó grabar en ella, y el WAV cuando se apretó Iniciar en la app: entre los'
        + ' dos hay un desfase de segundos o de minutos. Calculalo comparando el audio del video con el'
        + ' WAV de su clase (ffmpeg sirve) y **decime cuánto te dio en cada clase antes de seguir**. Si'
        + ' el número no cuadra, todo lo que armes encima queda corrido y no se ve hasta mirar el corte.');
    L.push('');
    if (vistas.some(v => v.film)) {
        L.push('### 2. Un film por vista anidada');
        L.push('');
        for (const v of vistas.filter(x => x.film)) {
            L.push(`- \`${v.film}\`: ${comoSeCompone(v, capturas)}. Una pista por captura, en ese orden,`
                + ' con el film de cada una adentro y el encuadre en su `style`.');
        }
        L.push('');
    }
    L.push(`### ${vistas.some(v => v.film) ? 3 : 2}. Una precortada por clase`);
    L.push('');
    L.push('En `parts/<clase>/film.html`, un clip por toma, en orden y pegados: el final de una es el'
        + ' principio de la siguiente, sin huecos. Cada clip es el film de la captura que le toca a su'
        + ' vista, recortado a la toma:');
    L.push('');
    L.push('```html');
    const ejemplo = clases.find(c => (c.tomas || []).length);
    const t = ejemplo ? ejemplo.tomas[0] : null;
    if (t) {
        const fuente = (d.fuentes || []).find(f => f.clave === t.fuentes[0]);
        const anidado = !fuente || /film\.html$/.test(fuente.film);
        const tag = anidado ? 'iframe' : 'video';
        L.push(`<!-- ${ejemplo.titulo}, toma ${t.toma} (${t.vista}) -->`);
        L.push(`<${tag} id="toma-${t.toma}" src="../../${fuente ? fuente.film : 'parts/captura-1/film.html'}`
            + `#t=${t.enLaCaptura.desdeSeg},${t.enLaCaptura.hastaSeg}"`);
        L.push(`        at="${t.enLaPrecortada.desdeSeg}" data-toma="${t.toma}" data-vista="${t.vista}"`
            + `${t.nota ? ` title="${t.nota}"` : ''}></${tag}>`);
    }
    L.push('```');
    L.push('');
    L.push('Un film anidado es un `<iframe>` y una cámara suelta un `<video>`: usá el elemento que'
        + ' corresponda a lo que estés poniendo. **Ponele a cada clip su `id`** (`toma-1`, `toma-2`):'
        + ' sin uno, el id sale del nombre del archivo y todos los clips de una precortada se llaman'
        + ' igual, así que no hay cómo nombrar uno para corregirlo después.');
    L.push('');
    L.push('Las pistas van **de arriba hacia abajo en el orden en que se dibujan**: la primera `<section>`'
        + ' queda encima. Y abajo de todo, una pista con el WAV de la clase recortado igual que las tomas,'
        + ' que es el audio que se oye.');
    L.push('');
    L.push('Cada clase tiene que quedar con estas tomas:');
    L.push('');
    L.push('| Clase | Tomas | Cortado | Su precortada | Su guion |');
    L.push('|---|---|---|---|---|');
    for (const c of clases) {
        L.push(`| ${c.titulo} | ${(c.tomas || []).length} | ${largo(c.duracionSeg)} | \`${c.film}\``
            + ` | \`notas-de-rodaje/${c.corto}.md\` |`);
    }
    const sinTomas = clases.filter(c => !(c.tomas || []).length);
    if (sinTomas.length) {
        L.push(`**${sinTomas.length === 1 ? 'Una clase no tiene ninguna toma' : `${sinTomas.length} clases no tienen ninguna toma`}**`
            + ` (${sinTomas.map(c => c.titulo).join(', ')}): esas no llevan precortada. Van enteras y`
            + ' nada más, por si hay algo adentro que rescatar.');
        L.push('');
    }
    L.push(`### ${vistas.some(v => v.film) ? 4 : 3}. La clase entera, sin cortar`);
    L.push('');
    L.push('Al lado de cada precortada, la misma clase de punta a punta, con las mismas pistas y todo lo'
        + ' que se dijo (`clase.pre` en `clases.json`). Es a donde se vuelve cuando un borde quedó corto'
        + ' o una frase que valía se cayó del corte.');
    L.push('');
    L.push(`### ${vistas.some(v => v.film) ? 5 : 4}. El film principal`);
    L.push('');
    L.push('En `film.html`, las precortadas una detrás de otra, en orden de clase.');
    L.push('');

    L.push('## Antes de darlo por hecho');
    L.push('');
    L.push('1. Corré `openfilm look` sobre una clase y sobre el film principal.');
    L.push('2. Contá las tomas de cada precortada y comparalas con la tabla de arriba.');
    L.push('3. Mirá la primera y la última toma de una clase: que empiecen y terminen donde dice'
        + ' `clases.json`, y que se oiga la voz desde el primer segundo.');
    L.push('4. Decime el desfase que calculaste para cada clase.');
    L.push('');
    L.push('**Si un film anidado recortado no reproduce bien ese tramo, o la vista previa se arrastra**'
        + ' con muchas tomas, cambiá de plan: que los clips de las precortadas apunten directo al video'
        + ' de la cámara, con el desfase ya sumado a sus tiempos. El resultado es el mismo y se pierde'
        + ' solo la comodidad de encuadrar una vez; decime si tuviste que hacerlo.');
    L.push('');
    L.push('No cambies nada de `notas-de-rodaje/` ni de `assets/audio/`: lo reescribe Note Taker cada vez'
        + ' que se exporta. Lo que armes vos —`film.html`, `parts/`— no lo toca nunca.');
    L.push('');

    return `${L.join('\n')}\n`;
}

module.exports = { NOMBRE_DE_LA_GUIA, guia, comoSeCompone, largo };
