'use strict';

/**
 * Los dos vídeos crudos de la maqueta, hechos con el ffmpeg de la app.
 *
 *     node tools/maqueta/hacer-videos.js
 *
 * Existe para que esos dos MP4 del repositorio no sean binarios huérfanos: son
 * 360 KB que alguien va a tener que rehacer el día que el editor cambie de
 * encuadre, y sin la receta no hay forma.
 *
 * Qué tienen que tener, y por qué:
 *
 * - **40 s**, que es más que la suma de los tramos que `doble.js` reparte. Con
 *   vídeos cortos el reproductor busca más allá del final y se queda en negro,
 *   y eso ya pasó: los primeros medían 3 s y las tomas no avanzaban nunca.
 * - **dos tamaños distintos** —la cámara apaisada y chica, la pantalla a
 *   1920x1080— porque el editor las encuadra con reglas distintas (la cámara
 *   recortada a `cover`, la pantalla entera a `contain`), y con los dos iguales
 *   no se vería si se equivocó de regla.
 * - **dos colores planos bien distintos**, que es lo que dice de un golpe cuál
 *   de los dos está puesto de fondo y cuál en el recuadro de la esquina.
 * - **una barra que viaja** de izquierda a derecha, que es el reloj: si una
 *   toma buscó el segundo que dijo el motor, la barra está donde toca. Es
 *   `drawbox` y no `drawtext` con el número escrito porque el ffmpeg que lleva
 *   la app viene sin el filtro de texto.
 * - **un tono en la cámara**, porque el montaje saca el sonido de ahí cuando la
 *   toma trae audio de cámara, y hay que poder oír si lo sacó.
 * - **dos pantallas y no una**, de colores distintos, porque la pantalla se
 *   puede partir en tramos: cambiar de ventana a mitad de grabación cierra un
 *   archivo y abre otro. La segunda es la «ventana nueva», y con ella la
 *   maqueta puede enseñar una toma que cruza el cambio —ventana, negro,
 *   ventana— que es lo único que prueba que el reproductor cambia de archivo
 *   sin salirse de la toma.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const paths = require('../../engine/paths');

const SEGUNDOS = 40;
const ACA = __dirname;

/** La barra que viaja: en el segundo N está a N/40 del ancho. */
function barra(ancho, alto) {
    const grueso = Math.round(alto / 24);
    return `drawbox=x='(iw-${grueso})*t/${SEGUNDOS}':y=ih-${grueso * 2}`
        + `:w=${grueso}:h=${grueso}:color=white@0.9:t=fill`;
}

function hacer(nombre, { ancho, alto, color, conTono, dura = SEGUNDOS }) {
    const salida = path.join(ACA, nombre);
    const args = ['-y',
        '-f', 'lavfi', '-i', `color=c=${color}:s=${ancho}x${alto}:r=30:d=${dura}`];
    if (conTono) {
        args.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${dura}`);
    }
    args.push('-vf', barra(ancho, alto),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
    if (conTono) args.push('-c:a', 'aac', '-b:a', '64k', '-shortest');
    args.push(salida);

    execFileSync(paths.ffmpeg().path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    return salida;
}

const hechos = [
    hacer('semanal-camara.mp4', { ancho: 960, alto: 720, color: '0x8a5a2b', conTono: true }),
    hacer('semanal-pantalla.mp4', { ancho: 1920, alto: 1080, color: '0x14507a', conTono: false }),
    // La ventana de después del cambio: otro color para que se vea de un golpe
    // que el reproductor cambió de archivo, y otro tamaño porque una ventana
    // suelta no mide lo que la pantalla entera.
    hacer('semanal-pantalla-2.mp4', { ancho: 1440, alto: 900, color: '0x2f6b3a', conTono: false }),
    // Y el «exportado», que es lo que abre el reproductor del final. Corto a
    // propósito: ahí no se busca nada, solo se mira que el vídeo cargue y que
    // el botón de Finder esté al lado.
    hacer('semana_2026-10-03_09-12-40.mp4',
        { ancho: 1920, alto: 1080, color: '0x1d1d22', conTono: false, dura: 3 })
];

for (const f of hechos) {
    const dice = execFileSync(paths.ffprobe().path, ['-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,width,height',
        '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n').join(' · ');
    console.log(`· ${path.basename(f)} — ${dice}`);
}
