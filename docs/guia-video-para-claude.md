# Guía: la herramienta para grabarse y editar con Claude

Esta guía es para arrancar un **proyecto nuevo, aparte de Note Taker**. Ese
proyecto toma el modo semanal de Note Taker (grabarse con pantalla, cámara y
voz) y lo convierte en otra cosa: una herramienta que **no edita**, sino que
deja todo listo para que **Claude** haga la edición.

En Note Taker el modo semanal quedó desactivado: `MODOS` en `engine/ajustes.js`
ya solo acepta `clase`. Su código sigue en este repo, entero, porque es la base
de lo que viene. **`v0.6.1`** (en GitHub; `git fetch --tags`) es la última
versión publicada con el modo funcionando de punta a punta: sirve para comparar
cuando algo del proyecto nuevo no se comporta igual.

---

## 1. Qué cambia y por qué

Hasta ahora la persona grababa, elegía el corte en un editor dentro de la app y
salía con un MP4 cortado. Hoy esos vídeos se los pasa a Claude para que los
edite. Entonces sobra la edición final, y lo que hace falta es otra cosa:

1. **Un vídeo con buen audio.** Voz limpia y nivelada, sincronizada con la
   imagen. Si el audio llega mal, Claude no lo puede arreglar.
2. **Un prompt listo para sumar a la sesión de Claude.** Tiene que decirle que
   quite los silencios **sin cortar palabras**, que siga las notas de qué va y
   qué no, y que arme **una historia**: no una sucesión de tomas.
3. **Notas claras de lo que se fue haciendo.** Qué toma es la buena, qué se
   repitió, qué pedazo sobra y en qué parte de la historia va cada cosa. Se
   toman mientras se graba, que es cuando la persona lo sabe.
4. **Varios recursos, fácil.** Imágenes, capturas, otro clip, un documento. Se
   sueltan en la herramienta y viajan con el resto, descritos para Claude.

### Lo que NO hace

- No corta el vídeo final. Eso lo hace Claude.
- No escribe XML de Premiere, ni proyecto `.prproj`, ni claquetas.
- No tiene el modo `clase` de Note Taker.

---

## 2. La salida: el paquete para Claude

Todo gira alrededor de una carpeta por grabación. La persona la arrastra entera
a Claude, o la abre en una sesión de Claude que pueda leer archivos y correr
`ffmpeg`.

```
Semana_2026-11-03_18-53-10/
  PROMPT.md               ← lo primero que se le da a Claude; abre todo lo demás
  notas.md                ← las tomas en orden, qué va y qué no, la historia
  edicion.json            ← lo mismo para máquina: tomas, palabras, silencios
  transcript.srt          ← para leer y para subtítulos
  video/
    maestro.mp4           ← la grabación entera, SIN cortar, con el audio bueno
    maestro-liviano.mp4   ← lo mismo a 720p, por si hay límite de subida
  fuentes/
    pantalla.mp4, pantalla-2.mp4…   ← la pantalla cruda, por tramos
    camara.mp4                      ← la cámara cruda
    voz-original.wav                ← el micrófono tal cual entró
    voz-mejorada.wav                ← el mismo, procesado
  recursos/
    recursos.md           ← qué es cada archivo y dónde va
    (lo que la persona agregó)
```

### Una sola regla de tiempo

Todos los tiempos del paquete son **segundos desde el comienzo de
`video/maestro.mp4`**, con tres decimales: notas, JSON, SRT y prompt. Es la regla
más importante del proyecto.

En Note Taker hay tres relojes: el del WAV (`desdeMs`), el de cada vídeo
(`empezoMs`) y el de pared. `reparto-video.js` los traduce entre sí, deriva
incluida. Esa traducción se hace **una vez, al armar el paquete**, y Claude
nunca la ve. Si Claude recibe tiempos en dos relojes, va a cortar mal y no se va
a dar cuenta.

### `edicion.json`

```json
{
  "version": 1,
  "reloj": "segundos desde el comienzo de video/maestro.mp4",
  "duracion": 1834.517,
  "fps": 30,
  "idioma": "es",
  "tomas": [
    {
      "id": 3,
      "desde": 412.380,
      "hasta": 488.020,
      "estado": "va",
      "vista": "pantalla",
      "historia": "Lo que hice",
      "nota": "Esta es la buena del deploy",
      "repiteA": 2,
      "comentarios": [
        { "desde": 450.100, "hasta": 455.900, "texto": "eh no, perdón, la otra", "pide": "quitar" }
      ]
    }
  ],
  "palabras": [
    { "desde": 412.420, "hasta": 412.700, "texto": "Hoy", "toma": 3 }
  ],
  "silencios": [
    { "desde": 430.210, "hasta": 431.540, "dentroDeToma": 3, "recortable": true }
  ],
  "recursos": [
    { "archivo": "recursos/diagrama.png", "tipo": "imagen", "nota": "Mostrar cuando explico la arquitectura", "cerca": 460.0 }
  ]
}
```

Cada campo:

- **`estado`** es `va`, `no-va` o `dudosa`. Sale de los tres estados de toma que
  ya existen (`estados-toma.js`): mantener, desactivar y descartar.
- **`historia`** es el tramo del relato al que pertenece la toma. Es nuevo; ver
  la sección 4.
- **`repiteA`** dice que esta toma es otra versión de una anterior. Sale de
  `vivo.repeticiones`, que ya detecta «repite la 1».
- **`silencios`** son los huecos medidos en la **onda**, no en Whisper.
  `recortable` es verdadero si duran ≥ 0,7 s y no tocan una palabra. Ver la
  sección 5.
- **`palabras`** son las de la relectura con el modelo grande. Es el texto
  bueno, no el descartable del ciclo en vivo.

### `notas.md`

Lo mismo que el JSON, escrito para leerse. Claude lo usa para entender la
intención; la persona lo usa para revisar antes de mandar.

```markdown
# Semana del 3 de noviembre — Daniel

## La historia
1. Contexto — tomas 1, 2
2. El problema — toma 4
3. Lo que hice — tomas 3 (la buena), 6
4. Resultado y siguiente paso — toma 7

## Tomas
- **Toma 3** · 06:52–08:08 · pantalla · VA · «Esta es la buena del deploy»
  - Quitar 07:30–07:35: «eh no, perdón, la otra»
- **Toma 2** · 05:10–06:40 · NO VA · la repetí en la 3
```

### `PROMPT.md`

La plantilla está en la sección 7. La herramienta la llena con los datos de esta
grabación (nombre, duración, cuántas tomas, recursos) y la muestra con dos
botones: **Copiar el prompt** y **Mostrar la carpeta**.

---

## 3. Qué copiar de Note Taker

Conviene partir de **este repo como quedó**, y no de `v0.6.1`. Después de esa
versión pasaron dos cosas: se quitaron las claquetas, que el proyecto nuevo
tampoco quiere, y se desactivó el modo semanal en Ajustes. Su código no se tocó.
`v0.6.1` queda para comparar.

### Se copia casi tal cual

| Qué | Dónde está | Para qué sirve en el proyecto nuevo |
|---|---|---|
| Grabar pantalla y cámara | `src/js/grabar/filmar.js` | `MediaRecorder`, tramos de pantalla, latido de pistas, cola `enFila` |
| Abrir la cámara | `src/js/grabar/ojo.js` | `pedidoDeCamara` y `acotar` a 1920×1080 |
| Micrófono a WAV | `src/js/grabar/oido.js`, `pcm-worklet.js`, `fuente.js` | 48 kHz forzados, sin procesado del navegador |
| Escribir el WAV | `engine/captura.js` | cabecera reescrita en cada pedazo, siempre legible |
| Escribir los vídeos | `engine/video-crudo.js` | trozos en orden, `empezoMs`, tramos |
| Las señales en vivo | `engine/ciclo-senales.js`, `notas-vivo.js`, `oido-residente.js`, `oir.js`, `sonido.js` | «3, 2, 1», «Retomamos», «Pausa» + 1 s de silencio |
| Releer cada toma | `engine/relecturas.js`, `oir-toma.js`, `transcribe.js` | el texto bueno, con DTW, una vez por toma |
| Tomas a mano y deshacer | `engine/cambios-toma.js`, `deshacer.js` | Enter, bordes, dividir, comentar |
| Medir la onda | `engine/ajustar-corte.js` | `nivelesDeTramo`, `umbralDe`, `umbralLocal`, `silencios` |
| Huecos largos | `engine/quitar-silencios.js` | la regla de 0,7 s; acá **se anota, no se corta** |
| Audio bueno | `engine/mejorar-audio.js` | pasaalto, denoise afinado a la sala, −16 LUFS, limitador |
| Traducir relojes | `engine/reparto-video.js` | `derivaDe`, `aPared`, `enArchivo`, `conNegro` |
| Componer pantalla y cámara | `exportar-video.js` → `grafo` | la cámara redondeada en la esquina (`CAMARA_LADO 360`, `MARGEN 48`) |
| Comprobar el audio de la cámara | `exportar-video.js` → `audioDeLaCamara` | la regla de ±3 % |
| La ventana de la cámara | `src/js/mirilla.js`, `ipc/mirilla.js`, `preload-mirilla.js` | dónde va a quedar la cara; `setContentProtection(true)` |
| Diario y botón Report | `engine/registro.js`, `engine/reporte.js`, `ipc/con-diario.js`, `src/js/acciones.js` | depurar a distancia sin pedir carpetas |
| Binarios y modelos | `tools/bundle-binaries.sh`, `engine/paths.js`, `engine/dependencias.js` | ffmpeg, ffprobe, whisper-cli, whisper-server, modelos con SHA-256 |
| Arneses | `tools/semanal-de-punta-a-punta.js`, `tools/probar-semanal-*.js`, `tools/probar-pantalla-que-cambia.js`, `tools/lib/arnes.js` | probar la grabación sin una persona delante |

### Se copia y se cambia

- **`src/js/pantalla-semanal.js` y `src/js/semanal/tarjetas.js`.** Quedan los
  momentos `listo` y `grabando`. Después de `grabando` ya no viene `mirando` →
  `revisar` → `cortando`, sino **`notas`** (revisar y ordenar) y **`paquete`**
  (armarlo y entregarlo).
- **`exportar-video.js`.** Ya no recorta tomas. Arma el **maestro entero**
  sobre una línea de tiempo continua; ver la sección 6.
- **`notas-xml.js`.** Del sidecar se queda la parte JSON (`sidecar()`). Lo de
  XML y marcadores de Premiere se va.

### No se copia

- El editor y el montaje en vivo: `src/js/semanal/montaje.js`, `corte.js` y lo
  de cortar en `tarjetas-editor.js`.
- Todo el modo de clase: `pantalla-vivo.js`, `pantalla-preparar.js`,
  `pantalla-sesiones.js` y `pantalla-cierre.js`.
- Premiere: `prproj-*.js`, `fcp-xml.js`, `rodecaster-xml.js`, `notas-xml.js`
  (la parte XML).
- Las claquetas, que en Note Taker ya se quitaron.
- El audio de Zoom: `nativo/escuchar-app.swift`, `engine/audio-app.js`. El modo
  semanal nunca lo usó.

---

## 4. Lo nuevo: notas que cuentan una historia

En Note Taker las tomas ya tienen estado, nota y comentarios sobre pedazos del
texto. Para Claude falta lo que convierte una lista de tomas en un relato.

### Mientras se graba

- **El tramo de la historia.** Encima de las tomas, una fila de etiquetas
  cortas: Contexto, Problema, Lo que hice, Resultado, Siguiente. La toma que se
  abre hereda la última elegida, igual que hoy hereda la vista. Se cambia con un
  clic o con una tecla. Las etiquetas se pueden editar, pero las de fábrica
  alcanzan para empezar.
- **«Esta es la buena».** Un gesto, tecla o botón en la ficha, que marca la
  toma actual como la que va y deja las anteriores con `repiteA` como `no-va`.
  Es la nota que más se da y la que más le cuesta inferir a Claude.
- **Quitar un pedazo.** Ya existe: seleccionar texto y comentar. Se agrega un
  campo `pide: "quitar" | "dejar" | "ojo"` para que no dependa de la
  redacción.

### Después de grabar (el momento `notas`)

- La lista de tomas en el **orden de la historia** y no en el de grabación.
  Arrastrar para reordenar, y dejar ver cuál falta.
- Una caja de texto libre, **«Lo que quiero que se entienda»**. Va arriba del
  prompt y es lo que Claude usa para decidir el tono.
- Revisar lo que se oyó, con el texto bueno de la relectura. Los bordes se
  pueden mover como hoy, arrastrando el IN y el OUT sobre el texto.

---

## 5. Silencios sin cortar palabras

Es lo que más se va a notar en el resultado, y la herramienta tiene que dejarlo
**resuelto en datos**: Claude no debería tener que adivinar dónde termina una
palabra.

### Qué ya se aprendió en Note Taker

- **Los huecos se miden en la onda, no en los tiempos de Whisper.** Whisper
  estira la última palabra sobre el silencio que sigue, así que «el hueco entre
  dos palabras» según Whisper es más corto que el de verdad. Las funciones son
  `nivelesDeTramo` (RMS en pasos de 20 ms), `umbralDe` (piso = percentil 10) y
  `umbralLocal` (voz P90 − 15 dB, nunca por debajo de piso + 6), en
  `ajustar-corte.js`.
- **Un silencio cuenta desde 120 ms.** Las oclusivas (p, t, k) tienen 50–100 ms
  de silencio adentro, y cortar ahí parte la palabra.
- **Los huecos que se acortan son de 0,7 s o más**, y quedan en **0,3 s**, con
  0,15 s de cada lado. No se borran: sin aire, la voz se atropella.
- **Ningún pedazo queda en menos de 0,5 s.** Una cola corta vuelve al pedazo
  anterior.
- **Los bordes de toma ya caen en silencio.** `ajustar-corte` corre el IN y el
  OUT al silencio más cercano (−0,35/+0,25 s el IN, al revés el OUT), con
  ventaja para el lado que no pierde palabras. Si la voz no se despega 12 dB del
  piso, no toca nada.

### Qué hace la herramienta nueva con eso

1. Al terminar, después de las relecturas, recorre **el WAV mejorado entero**,
   no solo las tomas, y escribe `silencios[]` en `edicion.json`. Marca
   `recortable` cuando el hueco cumple las reglas de arriba **y** no se cruza con
   ninguna palabra de `palabras[]`. La doble condición protege de las dos
   maneras de equivocarse.
2. Los IN y OUT de cada toma van **ya ajustados**, sacados de `toma.ajuste`.
3. El prompt le dice a Claude que **solo** corte dentro de un silencio
   `recortable`, o en los bordes de una toma, y nunca dentro del intervalo de una
   palabra.

### Cómo se comprueba

Una prueba del proyecto nuevo, que corre sobre una grabación real:

1. Aplicar los cortes que proponga Claude, o una simulación con las reglas de
   arriba, al `maestro.mp4`.
2. Volver a transcribir el resultado con el modelo grande.
3. Comparar contra `palabras[]` de las tomas que van: no puede faltar ninguna,
   salvo las de los pedazos marcados `quitar`.

`tools/medir-audio.js` es el modelo a seguir: un número que dice si salió bien,
no una impresión.

---

## 6. El maestro: un vídeo entero con buen audio

### Qué es

La grabación completa, **sin cortar**, de principio a fin:

- **Imagen.** Para cada momento se usa la vista de la toma (pantalla con la
  cámara en la esquina, o la cámara sola). Entre tomas va la pantalla con la
  cámara. Donde la pantalla cambió de tramo, va el negro que ya pone `conNegro`.
- **Audio.** `voz-mejorada.wav`, puesto en el reloj del vídeo.
- **Formato.** El de hoy: `libx264 -preset veryfast -crf 20 -pix_fmt yuv420p
  -r 30`, `aac 192k`, `+faststart`. Además va `maestro-liviano.mp4` a 1280×720
  y `crf 26`, para cuando el lugar donde se sube tiene límite.

### El audio bueno

Es la cadena de `mejorar-audio.js`, aplicada al WAV entero en vez de a un MP4
cortado:

1. Medir cada toma con `ebur128` (las menores de 1,5 s no cuentan) y tomar la
   mediana como referencia.
2. Aplicar `highpass=f=80`, después
   `afftdn=nr=12:nf=<piso medido + 6>`, después ganancia fija hasta −16 LUFS
   (tope +24 dB), y por último
   `alimiter=limit=-1.5dB:attack=5:release=50:level=disabled`.
3. Compensar los 30 ms que la cadena retrasa (`atrim=start=0.030` +
   `apad=pad_dur=0.030`). Sin eso, la voz va detrás de la boca.
4. Volver a medir y afinar hasta quedar a 0,3 dB de −16 LUFS, con dos pasadas
   como máximo (`afinar`).

**Ganancia fija y no `loudnorm`.** `loudnorm` aplastó la dinámica en las
pruebas: el LRA bajó de 5,0 a 3,3. En un vídeo entero, sin cortes, una sola
ganancia es lo correcto. La nivelación por toma de Note Taker existía porque
pegaba tomas de momentos distintos; acá, de hacer falta, la hace Claude al
cortar, y el prompt se lo dice.

### Poner el WAV en el reloj del vídeo

Note Taker lo resuelve **por toma**: cada recorte se traduce con `aPared`, que
corrige la deriva medida del WAV (`derivaDe`). Para un maestro de media hora en
una sola pieza hay dos caminos:

- **Por pedazos de 60 s** con la misma traducción de hoy, y `concat`. Reusa
  código probado, y la deriva no se acumula dentro de un pedazo.
- **Una pasada con `atempo`** igual a la deriva medida. Es más simple, pero la
  deriva medida es un promedio y no corrige un salto.

**Se recomienda el primero**, con `tools/medir-sincronia.js` como prueba: la
sincronía se mide, no se mira. En el último arreglo, la vista previa pasó de
108 ms a 11 ms de desfase medio. La meta del maestro es la misma: menos de 40 ms
en todo el largo.

---

## 7. La plantilla del prompt

La herramienta escribe `PROMPT.md` con esto, reemplazando lo que va entre
`{{ }}`. Está escrito para una sesión de Claude que puede leer los archivos de
la carpeta y correr `ffmpeg`. Si no puede correrlo, igual devuelve la lista de
cortes y el guion, y eso se aplica con otra herramienta.

```markdown
# Editá mi vídeo de la semana

Te paso una carpeta con una grabación mía de {{duracion}}: mi pantalla, mi cámara
y mi voz. Quiero que la edites y la conviertas en un vídeo que cuente una
historia, no una lista de tomas.

Lo que quiero que se entienda: {{lo_que_quiero_que_se_entienda}}

## Qué hay en la carpeta
- `video/maestro.mp4`: la grabación entera, sin cortar, con el audio ya limpio y
  nivelado. Es la que se edita.
- `notas.md`: mis notas, toma por toma, y el orden de la historia. Mandan sobre
  cualquier otra cosa.
- `edicion.json`: lo mismo para máquina, más cada palabra con su tiempo y cada
  silencio medido en la onda.
- `fuentes/`: la pantalla, la cámara y la voz por separado, por si necesitás
  recomponer una vista.
- `recursos/`: {{cuantos_recursos}} archivos que quiero que uses, descritos en
  `recursos/recursos.md`.

Todos los tiempos están en segundos desde el comienzo de `video/maestro.mp4`.

## Las reglas del corte
1. **Nunca cortes dentro de una palabra.** Una palabra ocupa de `desde` a `hasta`
   en `edicion.json → palabras`. Ningún corte puede caer en ese intervalo.
2. **Silencios**: dentro de las tomas que van, acortá a 0,3 s cada silencio
   marcado `recortable: true`, dejando 0,15 s de cada lado. No toques los
   silencios que no están marcados: son pausas cortas que la voz necesita.
3. **Cortá solo en los bordes de una toma o dentro de un silencio recortable.**
   Si un corte que querés hacer no cae en ninguno de los dos, decímelo en vez de
   hacerlo.
4. **Tomas**: va lo que dice `va`, no va lo que dice `no-va`. Las `dudosa`
   proponémelas y decime por qué. Si dos tomas son la misma (`repiteA`), quedate
   con la marcada como buena o, si no hay ninguna marcada, con la última.
5. **Pedazos**: respetá los comentarios con `pide: "quitar"` y `pide: "dejar"`.
6. **Historia**: ordená las tomas según «La historia» en `notas.md`. Si algo no
   encaja o falta un puente, decímelo.
7. **Recursos**: usalos donde dice `recursos.md`. Si no dice, proponé dónde.
8. **Audio**: ya está limpio y a −16 LUFS. No lo comprimas ni lo normalices de
   nuevo. Si dos tomas que quedan juntas suenan a volúmenes distintos, igualá
   esas dos y nada más.

## Cómo quiero que trabajes
1. Primero leé `notas.md` y `edicion.json` y devolveme **el guion**: las tomas
   en orden, qué quitás de cada una y cuánto dura el resultado. **Esperá mi OK**
   antes de cortar.
2. Con mi OK, armá el vídeo. Guardalo como `editado.mp4`, junto a la lista de
   cortes (`cortes.json`, en tiempos del maestro).
3. Al terminar comprobá dos cosas: que cada corte cae en el borde de una toma o
   en un silencio recortable, y la duración final. Decime si algo no cumple.
```

### Por qué el prompt es así

- **Las reglas son verificables.** «No cortes palabras» solo no alcanza: con
  `palabras[]` y `silencios[]` es una comprobación, no una opinión.
- **Guion antes de cortar.** Revisar un guion de diez líneas lleva un minuto;
  rehacer un vídeo, diez.
- **Las notas mandan.** La persona sabe cuál era la toma buena. Claude solo lo
  infiere, y a veces mal.
- **El audio no se vuelve a tocar.** Dos cadenas encadenadas (la herramienta y
  después Claude) suben el ruido y aplastan la voz.

---

## 8. Varios recursos

- **Una zona para soltar archivos**, en el momento `notas` y también mientras
  se graba, con la ficha de la toma abierta. Cada archivo pide una línea:
  *qué es* y *dónde va*.
- **«Dónde va» se toma de la toma abierta.** Si se suelta mientras se graba, el
  recurso queda atado a ese momento (`cerca` en `edicion.json`), sin escribir
  nada.
- Se **copian** a `recursos/` con un nombre limpio, sin acentos ni espacios. No
  se enlazan: el paquete tiene que poder moverse de máquina.
- `recursos/recursos.md` lista cada uno con su tipo, su nota y su momento. Es
  lo que el prompt le dice a Claude que lea.
- Tipos que entiende: imagen, vídeo, audio, PDF y texto. Lo demás se copia igual,
  con su nota.

---

## 9. Lo que costó aprender y no hay que volver a descubrir

Cada punto ya pasó con grabaciones reales y tiene su arreglo en el código.

### Grabación

- **Si la ventana capturada cambia de tamaño, el MP4 se rompe desde ese
  punto.** El encoder H.264 se reinicia con el tamaño nuevo, pero la cabecera del
  MP4 se queda con el viejo, y el archivo deja de poder decodificarse: Chrome da
  `PIPELINE_ERROR_DECODE` y ffmpeg decodifica basura. El arreglo es **un tramo
  nuevo por cada tamaño**: `vigilarElTamano` escucha el `resize` de un `<video>`
  oculto y llama a `otroTramo`. La grabación del 22/10 perdió todo lo de después
  del segundo 86,9 por esto.
- **El encoder por hardware no acepta 5120×3200.** El archivo sale de 0 bytes.
  Por eso se acota a 1920×1080 y se hace una grabación de prueba de 200 ms
  (`aguanta`) antes de usar la fuente.
- **La cámara se clava en 640×480** si se abre con `video: true` para leer los
  nombres de los dispositivos. Hay que pedir `deviceId` exacto y
  `width: { ideal: 2560 }`, y después acotar.
- **Las pistas se mueren sin avisar.** Hubo una cámara de 0 bytes después de
  71 s. Hay un latido cada 2 s (`PULSO_MS`) que mira `ended` y `muted`, y avisa
  si una fuente no entrega nada en 15 s (cámara) o 45 s (pantalla).
- **La hora de arranque es la de `start()`, no la de `onstart`.** El primer
  cuadro cae 43 ms después de `start()`, mientras que `onstart` llega entre 294 y
  339 ms tarde.
- **Al cambiar de ventana, primero se pide la nueva y después se suelta la
  vieja.** Al revés queda un hueco sin imagen.

### Audio

- **AirPods y Bluetooth en llamada bajan a 16 o 24 kHz.**
  - Sin forzar el `AudioContext` a 48 kHz, los pedazos duran el doble y el WAV
    sale a otra velocidad.
  - Metido en el MP4 de la cámara, un micrófono a 24 kHz dio 804 s de audio en
    un vídeo de 402 s: la voz robótica del video del compañero.
  - El arreglo: el micrófono entra al MP4 de la cámara **solo si va a 48 kHz**
    (`vaEnElVideo`); el WAV se usa siempre; y el audio de la cámara se usa solo
    si dura lo mismo que la imagen, con ±3 % de margen (`audioDeLaCamara`).
  - Abrir el micrófono de unos auriculares Bluetooth los pasa a modo llamada y
    suenan peor. Hay que avisarlo en la pantalla de preparar.
- **Sin cancelación de eco, sin supresión de ruido, sin ganancia automática.**
  Las tres son para llamadas: suben el fondo en los silencios y cambian la onda,
  que es justo con lo que se miden los silencios.
- **Whisper inventa texto sobre el silencio** («Gracias.»). `sonido.js` solo deja
  pasar audio que esté 24 dB sobre el piso durante 150 ms.
- **La deriva existe y se mide.** El micrófono falso de Chromium la dejó ver al
  1,88× y otras corridas dieron 0,51× y 1,01×. Las tomas viven en el reloj del
  audio y los vídeos en el de pared; `derivaDe` los une.

### Señales

- **«Pausa» cierra solo con un segundo de silencio detrás, medido desde donde
  la palabra EMPIEZA.** Medido desde el final no cerraba nunca: Whisper estira la
  palabra hasta el borde de lo que oyó.
- **Un «3, 2, 1» con una toma abierta no la parte.** Desde adentro no se
  distingue una señal de alguien contando.
- **El IN va después del «1»; el OUT, antes de «Pausa».** Las señales nunca
  quedan adentro de la toma.
- **Lo del ciclo en vivo es descartable.** Lo bueno es la relectura de cada toma
  con el modelo grande y DTW, y esa es la que va a `palabras[]`.

### La ventana de la cámara

- Su posición y su tamaño son los de la cámara en el maestro: la persona ve
  dónde va a quedar su cara.
- **`setContentProtection(true)`** la saca de la captura. Sin eso, la cara sale
  dos veces.
- Tiene que abrir la cámara **después** que la ventana principal.

### Sobre el propio proyecto

- **Una carpeta por grabación**, con el nombre del mismo instante que los
  archivos de adentro. Nunca se pisa un archivo: si existe, va al lado con « 2»
  (`alLado`).
- **El diario y el botón Report salvaron más tiempo que cualquier otra cosa.**
  Cada acción deja una línea; el reporte se arma en un zip sin rutas de la casa.
  Hay que traerlos desde el primer día.

---

## 10. El plan, por etapas

Cada etapa termina con algo que se puede usar, y con su prueba.

1. **Esqueleto.** Electron, el diario y el botón Report, los binarios
   (`bundle-binaries.sh`), los modelos con su descarga y el corredor de pruebas
   (`tests/run.js`). *Listo cuando* la app abre, encuentra ffmpeg y Whisper, y el
   Report deja un zip.
2. **Grabar.** Pantalla, cámara y voz, con todas las defensas de la sección 9 y
   la ventana de la cámara. *Listo cuando* `semanal-de-punta-a-punta.js` y
   `probar-pantalla-que-cambia.js`, adaptados, pasan, y una grabación de 10 min
   con AirPods sale con el audio a velocidad normal.
3. **Tomas y notas en vivo.** Señales, Enter, estados, comentarios con `pide`,
   el tramo de la historia y «esta es la buena». *Listo cuando* una grabación de
   prueba deja las tomas y las notas que se dijeron.
4. **El paquete.** El maestro, el audio bueno, `edicion.json`, `notas.md`,
   `transcript.srt` y `PROMPT.md`. *Listo cuando*:
   - el maestro sale a −16 ± 0,3 LUFS;
   - la sincronía queda por debajo de 40 ms (`medir-sincronia`);
   - todo silencio `recortable` está fuera de toda palabra.
5. **Recursos.** La zona para soltar archivos, la copia y `recursos.md`.
   *Listo cuando* cinco archivos de tipos distintos llegan con su nota y su
   momento.
6. **La vuelta con Claude.** Tres grabaciones reales pasadas por Claude con el
   prompt. *Listo cuando* la comprobación de la sección 5 no encuentra ninguna
   palabra cortada y la persona aprueba el guion sin reescribirlo.

---

## 11. Preguntas para decidir antes de empezar

- **¿Dónde corre Claude?** Si es en una sesión que lee la carpeta y corre
  `ffmpeg` (Claude Code, o el escritorio con herramientas), el paquete sirve
  tal cual. Si es claude.ai con subida de archivos, mandan los límites de
  tamaño: el `maestro-liviano.mp4` y un `edicion.json` sin `palabras[]` de las
  tomas que no van pueden ser necesarios.
- **¿El maestro lleva la vista ya compuesta, o pantalla y cámara aparte?**
  Compuesta, Claude edita un solo archivo. Aparte, puede recomponer mejor. La
  guía propone las dos cosas (`video/` y `fuentes/`), y conviene confirmarlo
  con el uso.
- **¿Las etiquetas de la historia son fijas o de cada persona?** Se pueden
  empezar fijas y guardar las que cada uno edite.
- **¿Subtítulos?** `transcript.srt` sale gratis de `palabras[]`. Si Claude tiene
  que quemarlos en el vídeo, va al prompt.
