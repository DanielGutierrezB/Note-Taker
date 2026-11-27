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

/**
 * Un árbol de archivos alineado: lo que se dice de cada uno arranca en la misma
 * columna, calculada del más largo. Con una columna fija, una ruta más larga que
 * ella se comía su propia separación y el árbol dejaba de leerse como tal.
 */
function arbol(filas) {
    const ancho = Math.max(...filas.map(([izq]) => izq.length)) + 2;
    return filas.map(([izq, dice]) => `${izq}${' '.repeat(ancho - izq.length)}${dice}`);
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
    L.push(enColumna('film.html', 'vacío: el montaje es tuyo, y esto es para que la carpeta abra'));
    L.push('notas-de-rodaje/');
    L.push(enColumna('clases.json', 'todas las clases y sus tomas, con los tiempos ya en segundos'));
    for (const c of clases.slice(0, 3)) {
        L.push(enColumna(`${c.corto}.md`, 'el guion de esa clase: cada toma, su vista, su nota y lo que se dice'));
    }
    if (clases.length > 3) L.push(enColumna('…', `y ${clases.length - 3} clase(s) más`));
    L.push('xml/');
    L.push(enColumna('Audio/*.wav', 'el audio de cada clase, grabado por la app'));
    L.push(enColumna('Audio/*.vtt', 'lo que se dijo, palabra por palabra, en los segundos de ese WAV'));
    L.push(enColumna('*.xml', 'las mismas notas para Premiere; acá no hacen falta'));
    L.push('assets/');
    for (const c of capturas) L.push(enColumna(`captura-${c.id}/`, `acá va el video de la ${c.nombre}`));
    L.push('```');
    L.push('');
    L.push('Esta carpeta es la del curso: `xml/` es lo que escribió la app al grabar y **no se toca**, y'
        + ' `Proyecto/`, si está, es un proyecto de Premiere de las mismas clases. Lo que armes vos va al'
        + ' lado, en `film.html` y `parts/`.');
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

    L.push('## El corte ya está armado');
    L.push('');
    L.push('**No hay que montar nada de cero: las secuencias ya están escritas**, con los cortes que marcó'
        + ' el director mientras grababa. Abrí `film.html` y vas a ver las clases precortadas, una detrás'
        + ' de otra, cada una anidada para entrar a iterarla.');
    L.push('');
    const conTomas = clases.filter(c => (c.tomas || []).length);
    L.push('```');
    L.push(...arbol([
        ['film.html', 'las clases precortadas, en fila'],
        ...capturas.map(c => [c.film, `la ${c.nombre}: acá se suelta su vídeo`]),
        ...vistas.filter(x => x.film).map(v => [v.film, `la vista ${v.vista}: ${comoSeCompone(v, capturas)}`]),
        ...conTomas.slice(0, 2).map(c => [c.film, `${c.titulo}, cortada: ${c.tomas.length} toma(s)`]),
        ...(conTomas.length > 2 ? [['parts/…', `y ${conTomas.length - 2} clase(s) más`]] : []),
        ...(conTomas.length ? [[conTomas[0].pre, 'la misma clase sin cortar, por si falta algo']] : [])
    ]));
    L.push('```');
    L.push('');
    L.push('Cómo está armado, que es el mismo armado que en Premiere:');
    L.push('');
    L.push('- **Una anidación por captura** (`parts/captura-N/`), con las clases una detrás de otra en su'
        + ` franja y **${d.aireSeg} s de aire** entre una y otra. Adentro está el audio de cada clase,`
        + ' muteado, que es contra lo que se sincroniza.');
    if (vistas.some(v => v.film)) {
        L.push('- **Una anidación por vista compuesta**, con sus capturas apiladas. El encuadre va en el'
            + ' `style` del clip de arriba, una vez para todo el curso.');
    }
    L.push('- **Una precortada por clase** (`parts/<clase>/`): un clip por toma, pegados y sin lo que'
        + ' quedó afuera, más la voz sacada del audio de la clase. Hay **una pista por vista**, y en cada'
        + ' toma está encendida la de su plano: las demás quedan ahí, apagadas (`disabled`), así que'
        + ' cambiar de plano es encender el clip que ya está, sin mover nada.');
    L.push('- **La clase entera al lado** (`-sin-cortar`), con las mismas pistas: es a donde volver'
        + ' cuando un borde quedó corto o una frase que valía se cayó del corte.');
    L.push('');

    L.push('## Lo único que falta: el vídeo de cada captura');
    L.push('');
    L.push('Las anidaciones de captura están armadas pero **vacías de imagen**: el vídeo de la cámara y el'
        + ' de la pantalla no los tiene la app, los tenés vos.');
    L.push('');
    for (const c of capturas) {
        L.push(`1. Poné el vídeo de la **${c.nombre}** en \`${c.material}\` y soltalo en \`${c.film}\`,`
            + ' en su pista de arriba.');
    }
    L.push('');
    L.push('**Y sincronizalo**, que es lo único que no te puedo dar hecho. El vídeo de cada cámara arranca'
        + ' cuando alguien apretó grabar en ella, y el audio cuando se apretó Iniciar en la app: entre los'
        + ' dos hay un desfase de segundos o de minutos. Calculalo comparando el audio del vídeo con el de'
        + ' su clase (ffmpeg sirve), movelo con su `at` y **decime cuánto te dio en cada clase**. Como todo'
        + ' cuelga de estas anidaciones, sincronizar acá deja bien el curso entero.');
    L.push('');
    L.push('| Clase | Su franja empieza en | Dura | Su audio |');
    L.push('|---|---|---|---|');
    for (const c of clases) {
        const a = (c.audio || [])[0];
        L.push(`| ${c.titulo} | ${c.franja.desdeSeg} s | ${largo(c.franja.largoSeg)} | ${a ? `\`${a.archivo}\`` : 'sin audio'} |`);
    }
    L.push('');

    L.push('## Lo que quedó cortado');
    L.push('');
    L.push('| Clase | Tomas | Cortado | Su precortada | Su guion |');
    L.push('|---|---|---|---|---|');
    for (const c of clases) {
        L.push(`| ${c.titulo} | ${(c.tomas || []).length} | ${largo(c.duracionSeg)} | `
            + `${(c.tomas || []).length ? `\`${c.film}\`` : '—'}`
            + ` | \`notas-de-rodaje/${c.corto}.md\` |`);
    }
    L.push('');
    const sinTomas = clases.filter(c => !(c.tomas || []).length);
    if (sinTomas.length) {
        L.push(`**${sinTomas.length === 1 ? 'Una clase no tiene ninguna toma' : `${sinTomas.length} clases no tienen ninguna toma`}**`
            + ` (${sinTomas.map(c => c.titulo).join(', ')}): esas no llevan precortada, y no entran en`
            + ' `film.html`. Van enteras y nada más, por si hay algo adentro que rescatar.');
        L.push('');
    }
    L.push('Leé el guion de una clase antes de tocarla: trae cada toma con su vista, la nota que escribió'
        + ' el director y lo que se dice adentro. Es con lo que se decide qué sacar y en qué orden.');
    L.push('');

    L.push('## Y de ahí en adelante, es tuyo');
    L.push('');
    L.push('Lo de arriba es el corte en bruto: están los planos y está la voz. Lo que hace que se vea como'
        + ' una clase y no como una grabación es lo que sigue, y eso es tu trabajo: el ritmo, los títulos,'
        + ' lo que se muestra en pantalla, la música, los subtítulos.');
    L.push('');
    L.push('Para los subtítulos ya está lo más caro hecho: cada audio tiene su `.vtt` al lado, con las'
        + ' palabras y su hora en los segundos de ese archivo. Pasalas a los segundos de la precortada'
        + ' —cada toma se corre a su `at`— y colgalas de una pista sola:');
    L.push('');
    L.push('```html');
    L.push('<section hidden>');
    L.push('  <track kind="captions" src="captions/captions.vtt" label="Captions">');
    L.push('</section>');
    L.push('```');
    L.push('');

    L.push('## Antes de darlo por hecho');
    L.push('');
    L.push('1. Corré `openfilm look` sobre el film del curso y sobre una clase.');
    L.push('2. Mirá la primera y la última toma de una clase: que empiecen y terminen donde dice su guion,'
        + ' y que se oiga la voz desde el primer segundo.');
    L.push('3. Decime el desfase que calculaste para cada captura y cada clase.');
    L.push('');
    L.push('**Si una anidación recortada no reproduce bien ese tramo, o la vista previa se arrastra** con'
        + ' muchas tomas, decímelo: se puede cambiar a que los clips apunten directo al vídeo de la cámara'
        + ' con el desfase ya sumado. El corte es el mismo y se pierde solo la comodidad de encuadrar una'
        + ' vez.');
    L.push('');
    L.push('**Lo que edites se respeta.** Note Taker anota la huella de cada secuencia que escribe'
        + ' (`notas-de-rodaje/secuencias.json`): al volver a exportar refresca las que siguen como las'
        + ' dejó y **no toca las que cambiaste**, aunque los cortes hayan cambiado en la app. Si una clase'
        + ' se re-cortó allá y querés su versión nueva, borrá su film y volvé a exportar.');
    L.push('');
    L.push('Y no cambies nada de `notas-de-rodaje/` ni de `xml/`: lo reescribe Note Taker en cada'
        + ' exportación, y `xml/` además es de donde sale todo esto.');
    L.push('');

    return `${L.join('\n')}\n`;
}

module.exports = { NOMBRE_DE_LA_GUIA, guia, comoSeCompone, largo };
