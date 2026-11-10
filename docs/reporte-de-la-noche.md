# Reporte de la noche del 9 al 10 de noviembre

Hice las fases 5 a 9 del plan, con una revisión de código al final, y los arreglos de esa revisión. Todo está en `main` y subido a GitHub. La suite pasa entera: 1025 pruebas. No generé ningún `.pkg` ni publiqué nada.

Lo que más importa probar en la app de verdad está al final, en «Lo que tenés que probar».

## Lo que quedó hecho

### Fase 6: la ventana durante la clase (`79eef9d`)
- **Enter:** tocar un botón con el mouse (deshacer, Compacto) ya no hace que el Enter siguiente lo vuelva a apretar. Comprobado en la maqueta.
- **Entrada de audio:** las aperturas y cierres van en fila. Dos seguidas ya no dejan dos micrófonos abiertos sobre el mismo WAV.
- **Preparar:** Iniciar queda apagado mientras carga, y también mientras se abre una entrada. La revisión encontró que, apretando Iniciar en ese momento, la clase podía grabar entera sin audio.
- **Cámara:** elegida desde la barra, ya no queda encendida después de la clase. Si se cierra Ajustes mientras abre, también se apaga.
- **Borde rechazado:** si el motor no acepta un borde que arrastraste, la línea vuelve a donde está.
- **Nota:** se guarda al salir del campo, comparando con la del motor. Antes, si el repintado reemplazaba el campo, no se guardaba.

### Fase 7: lo que va a Premiere (`b377e42`, `891fb29`)
- **Tomas vecinas:** los bordes ajustados de dos tomas vecinas ya no se encastran. Se frenan en la mitad del hueco y, si la vecina se desactiva, vuelven a su lugar.
- **Ruta del WAV:** «Rehacer XML», Regenerar, editar y renombrar nombran el WAV donde está hoy. Antes, en una carpeta movida, Premiere importaba sin audio.
- **`$` en la ruta:** ya no corrompe el `.prproj`. Lo probé con un proyecto entero armado desde una carpeta con `$&-$'` en el nombre.
- **Generar .prproj:** le da paso al audio entre clase y clase, y mientras arma, las clases de esa carpeta no se renombran ni se borran.
- **fps:** se revisa antes de preguntar si se reemplaza el proyecto. Si ponés `Plantilla-25.prproj` en `plantillas/`, la app la usa sola.
- **Plantilla:** la del instalador ya no nombra el curso con el que se armó (`CUR/2026_curso-spec-driven-development/…`). La volví a limpiar y a validar.
- **Campos del molde:** un campo que no está en el molde hace fallar la generación, en vez de quedarse con el valor de ejemplo.

### Fase 8: seguridad, diario y empaquetado (`b76d8d1`, `4d75f31`)
- **Navegación:** la ventana no navega a otras páginas ni abre ventanas.
- **Actualización:** la decide el proceso principal y solo baja de GitHub por https, también después de cada redirección.
- **App instalada:**
  - Borra las variables `NOTETAKER_*` y `NT_*`.
  - No arranca con un depurador.
  - Los fusibles de Electron apagan `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` y `--inspect`.
  - El arnés de desarrollo no lee ninguna bandera.
- **Diario:**
  - Un freno para los avisos repetidos. El 96 % de tu diario era un mismo aviso de octubre.
  - Un error distinto nunca se calla detrás de otro.
  - Lo callado queda contado con su última línea.
  - Las rutas con espacios se acortan, y los clics no copian lo que escribiste.
- **Permiso de audio:** dice lo que la app hace. Con «Audio del sistema» graba todo lo que suena, no solo Zoom.
- **Empaquetado:**
  - Una firma que falla para la compilación.
  - macOS 12 como mínimo, que es lo que pide Electron 43.
  - «Instalar y reabrir» reabre la app, aunque la hayas movido de carpeta.
- **Versiones:** Electron 43.8.7 y puppeteer-core 25.16.0.

### Fase 5: que el vivo no se atrase (`5ac44b8`)
Medí con una herramienta nueva, `tools/banco-pasada.js`, sobre 40 ventanas de una clase tuya de Canva de 141 minutos, con el servidor y el modelo de verdad:

| Cambio | Antes | Después |
|---|---|---|
| Pasada del vivo, mediana | 681 ms | 408 ms |
| Recorte de cada pasada | 53 ms, con el proceso principal parado | 9 ms |
| Archivo de notas de 3 h, reescrito en cada cambio | 1,40 MB | 0,73 MB |

- **Idioma:** medirlo en cada pasada costaba unos 270 ms. Ahora se mide cada 5 s, y siempre con «Automático» hasta que se asienta. De paso deja de saltar de idioma con una cita, porque dos mediciones seguidas ya no comparten casi todo el audio.
- **Reintentos:** sin reintentos a más temperatura, el texto salió igual en 40 de 40 ventanas.
- **Recorte:** el que hace la app da la misma onda que ffmpeg (correlación 0,9999). La relectura sigue usando ffmpeg.
- **Modelo grande:** se carga en Preparar, así que el «3, 2, 1» del arranque ya no lo oye el modelo chico.
- **Mover un borde:** dentro de lo que el modelo grande ya leyó, ya no se relee; se reparten sus palabras. La revisión encontró dos fallas en esto, ya arregladas.
- **Relectura en curso:** mientras corre una, el vivo pasa cada 2 s y no cada 1.

### Fase 5B: el glosario (`68af533`)
- **Dónde está:** en Ajustes hay uno general y uno de cada curso. El del curso se guarda en la carpeta Datos y viaja con el curso. Preparar tiene su renglón.
- **Cómo llega a Whisper:** como `--prompt` con `--carry-initial-prompt`, y el tope de contexto ajustado a su largo, para no volver a arrastrar el texto de la ventana anterior.
- **Medición** con cinco tramos de 3 minutos de la misma clase:
  - La puntuación no se trabó: 125 frases cerradas contra 113.
  - «Canva» salió 28 veces contra 26.
  - Un término que nadie dijo («Kubernetes») no apareció nunca.
  - Tardó un 3 % más.
- **Dónde está encendido:** en la relectura y en Regenerar. En el vivo no, porque no lo medí con el servidor.

### Fase 9: estructura (`fa618fa`, `891fb29`, `3110b91`)
- **`notas-vivo.js`:** partido en siete piezas en `engine/vivo/`, sin ciclos. Queda como fachada con los mismos 43 nombres. La revisión comparó función por función y no cambió nada.
- **`.prproj`:** «poner un campo o fallar» (`exigido`) en lugar de los reemplazos sueltos.
- **`style.css`:** partido por sus 13 secciones. La captura sale idéntica byte a byte.

## Lo que no hice, y por qué

**Fase 5:**
- **Banco contra XML validado:** necesita dos o tres clases con su XML validado por vos. El banco que hice compara pasadas y texto, no bordes.
- **Juntar los rescates de huecos en un solo lanzamiento:** ahorra poco y tiene riesgo.
- **«Regenerar» con large-v3:** hay que bajar un modelo de 2,9 GB y agregar una opción.
- **Probar Parakeet:** necesita otro motor y otro modelo.
- **Mandar a la ventana solo lo que cambió** (1,3 MB por segundo a la tercera hora): es parte de pintar En vivo por filas.
- **El glosario en el vivo:** no está medido.

**Fase 7:** lo que el plan marcaba «por comprobar en Premiere contigo» (cortes anidados que comparten marcadores e identificadores repetidos).

**Fase 8:**
- **Firma con *hardened runtime*:** necesita un archivo de permisos con micrófono, cámara y JIT. Sin compilar un instalador y probarlo podía dejar la app sin micrófono.
- **ffmpeg con licencia GPL dentro del release público:** es para que lo decidas vos.

**Fase 9:** quedan cuatro de los siete puntos. Reescriben piezas centrales y no los quise hacer sin que puedas probar la app:
- la tabla de ediciones;
- un solo dueño del ciclo de vida de la sesión;
- pintar En vivo por filas;
- una sola regla para los huecos de audio.

Tampoco partí `app.js` ni `pantalla-vivo.js`.

**De la revisión:**
- **Una nota al cambiar de ventana:** se guarda en dos pasos. Lo prefiero a perderla.
- **El foco cuando una frase de vista parte la toma:** va a la primera mitad y no a la que sigue abierta. No se pierde texto.
- **Glosario en sesiones del formato viejo** (una carpeta por clase): no encuentran el glosario del curso.

## La revisión de código

Tres revisores en paralelo, de solo lectura, sobre todo lo hecho desde la Parada. Encontraron 30 hallazgos y arreglé todos salvo los de la sección anterior (`4d75f31`, `d697069`).

| Revisor | Alta | Media | Baja |
|---|---|---|---|
| Motor | 2 | 3 | 4 |
| Seguridad | 3 | 3 | 4 |
| Ventana | 1 | 3 | 7 |

Los de prioridad alta:
- **Motor:** el atajo de mover un borde dentro de lo leído podía duplicar palabras y creerle a una orilla todavía no leída.
- **Seguridad:**
  - La app instalada aceptaba depuradores y variables que desviaban la actualización.
  - El freno del diario podía callar un error distinto.
- **Ventana:** Iniciar durante la apertura de una entrada grababa sin audio.

## Lo que tenés que probar

Nada de esto lo pude comprobar en la app de verdad, solo en las pruebas y la maqueta:

1. **Preparar:** elegí una entrada y apretá Iniciar enseguida. Tiene que esperar a que abra, y la clase tiene que tener audio.
2. **Cerrar con una clase grabando:** cerrá la ventana. Tiene que preguntar, y al volver tenés que caer en la misma clase.
3. **Cambiar el micrófono:** hacelo desde el rótulo Audio en medio de una toma.
4. **Frases:** agregá «vamos a nuestra pantalla» con R, decila con una toma abierta y probá ⌘Z.
5. **Glosario:** agregá dos o tres términos del curso, grabá unos minutos y mirá la relectura.
6. **Enter:** tocá deshacer con el mouse y después apretá Enter. Tiene que abrir o cerrar la toma.
7. **Generar .prproj:** probalo en una carpeta real, abrí el proyecto en Premiere y fijate que esté bien.
8. **El instalador**, cuando lo generes: que la app instalada abra (los fusibles se aplican al empaquetar) y que «Instalar y reabrir» reabra.

## Commits de esta noche

```
d697069 Revisión del motor y de la ventana: lo que encontraron, arreglado
4d75f31 Revisión de seguridad: arranque seguro, diario sin perder fallos, postinstall
3110b91 style.css partido por sus secciones, un archivo por sección
891fb29 prproj: poner un campo o fallar (exigido)
fa618fa notas-vivo partido en siete piezas (engine/vivo/), con notas-vivo.js de fachada
68af533 Glosario: el general y el del curso, en la relectura y en Regenerar
5ac44b8 El vivo más liviano: idioma cada 5 s, sin reintentos, recorte en la app
b76d8d1 Seguridad, diario y empaquetado
b377e42 Lo que va a Premiere: bordes, ruta del WAV, el $, Generar sin trabar y la plantilla
79eef9d La ventana en clase: el Enter, las entradas, Preparar, la cámara, el borde y la nota
```
