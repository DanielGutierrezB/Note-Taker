# Note Taker

App local de macOS (Apple Silicon) que toma las notas de rodaje **mientras la
clase se está grabando en vivo**, y devuelve un XML listo para importar en
**Premiere Pro** con el audio adentro.

El profesor dice "3, 2, 1" y la toma se abre; dice "Pausa" y se cierra; dice
"claqueta" o aplaude y queda una marca de sincronía. Al final hay **un solo
XML** con todas las tomas, todas las claquetas y el WAV de la clase en A1.

```
Zoom / interfaz ──► Note Taker ──► xml/clase.xml ──► Premiere
                       │
                       └─► xml/Audio/clase-1.wav
```

---

## El escenario

Una clase en vivo, grabada de corrido, de una a tres horas. El editor no está
en la sala: recibe los archivos después y tiene que armar el corte.

Lo que hace difícil ese trabajo no es cortar, es **saber dónde**. Una clase de
tres horas tiene treinta tomas, la mitad son intentos repetidos, y la única
persona que sabe cuál sirve es la que estaba mirando. Esta app es para esa
persona: toma las notas sin sacarle la vista de encima al profesor, y las deja
en el formato que el editor ya sabe abrir.

Y una cosa más, que es la que de verdad manda el diseño entero: **los tiempos
tienen que cerrar en el total**. Un marcador corrido tres segundos en el minuto
diez es un corte mal puesto; corrido tres segundos en la hora dos es una clase
que hay que volver a mirar entera. Por eso todo lo de acá se estampa contra el
audio grabado y no contra el reloj de pared (ver **Un solo reloj**).

## Cómo funciona

1. **Sesiones** — se elige la carpeta del curso. Adentro se crean `xml/` con el
   archivo que se importa en Premiere, `xml/Audio/` con el WAV y `xml/Datos/`
   con lo que la app se guarda para sí misma.
2. **Preparar** — una lista de verificación: la entrada de audio con su
   medidor, Whisper, la carpeta y los cuadros por segundo. El botón de
   **Iniciar grabación** se enciende cuando lo esencial está en verde, y cada
   renglón dice qué falta y ofrece el arreglo ahí mismo.
3. **En vivo** — el timecode grande, el estado de la sesión, la tarjeta de lo
   que está pasando ahora y la lista de todo lo que ya pasó. Las tomas se
   abren y se cierran solas; la nota se escribe a mano.
4. **Cierre** — qué quedó, dónde está el XML, y qué hay que rehacer si algo
   salió mal.

Ajustes y Diagnóstico son paneles: se abren encima de cualquier pantalla,
porque la pregunta que contestan aparece en cualquier momento.

## Lo que se dice y lo que pasa

| se dice | qué pasa |
|---|---|
| **"3, 2, 1"** (o "tres, dos, uno") | se abre una toma, en la palabra que sigue |
| **"Retomamos"** | lo mismo |
| **"Pausa"** + un segundo de silencio | se cierra, en la última palabra dicha |
| **"Claqueta"** | se anota una claqueta |
| un **aplauso** | lo mismo, y se confirma leyendo lo que se dijo alrededor |

Y lo que se hace a mano, para cuando nada de eso se dijo:

| tecla | qué pasa |
|---|---|
| **Enter** | abre la toma si no hay ninguna abierta, y la cierra si la hay |
| **K** | una claqueta acá |
| **P R S M X** | la vista de la toma |
| **⌘Z** · **⇧⌘Z** | deshacer · rehacer |

El botón primario de la pantalla es siempre el borde que toca: **Abrir toma**
cuando no hay ninguna, **Cerrar toma** cuando la hay.

**El conteo tiene que terminar en uno y llevar por lo menos dos números.** "Uno
de los problemas más comunes" abre clases de verdad, y "tenemos uno, dos, tres
opciones" también: sin esas dos reglas, las dos abrían una toma en medio de la
clase. En cifra (`3, 2, 1`) alcanza con una sola, porque Whisper escribe en
cifra el conteo y en letra el número hablado.

**"Pausa" pide silencio detrás.** El profesor puede decir "acá hacemos una
pausa en el flujo" y cerrar ahí partiría la clase al medio. Lo que distingue la
señal es que después no se dice nada.

**Un conteo adentro de una toma abierta no la parte.** Un profesor explicando
"…porque dije 3, 2, 1" dejaba una toma huérfana de tres segundos y la buena al
lado. Desde adentro de una toma no se puede saber si la cuenta es una señal o
alguien diciendo unos números, y entre partir una toma buena y dejar correr una
que ya estaba corriendo, lo segundo se arregla mirando y lo primero no.

### Abrir a mano, sin perder el arranque

El conteo no siempre se dice: el profesor arranca directo, se lo come, o dice
"bueno, vamos". Sin nada más, lo que sigue no queda en ninguna toma y se pierde
para el XML — la pérdida más cara de esta app, porque no se descubre hasta la
mesa de edición.

**Enter abre la toma, y el IN retrocede solo hasta donde arrancó la frase.**
Quien toma notas se da cuenta unos segundos tarde, siempre; abrir en el momento
del clic dejaría la primera oración afuera. La app se guarda los últimos treinta
segundos de lo que oyó sin ninguna toma abierta, y al abrir camina para atrás
hasta el primer silencio de segundo y medio: ahí pone el IN y se lleva esas
palabras adentro de la toma. El aviso dice cuánto retrocedió, para que el borde
no aparezca en un sitio que nadie pidió.

Si el profesor está callado, no hay nada que retroceder y la toma empieza donde
se apretó. Eso también es correcto: es el caso de abrir **antes** de que alguien
hable, que es como se usa cuando uno se adelanta.

### El campo de espera y los bordes que se arrastran

![La tarjeta «Ahora» sin toma abierta: lo que se oye entra abajo y el IN espera al final](docs/capturas/en-vivo-1180.png)

Sin ninguna toma abierta, la tarjeta **Ahora** es el campo de la toma que
todavía no empezó: borde punteado, lo que se va oyendo entrando abajo en gris y
lo viejo desvaneciéndose arriba, tres renglones y no más. Al final espera la
pastilla azul del **IN**.

**Arrastrar el IN hasta una palabra abre la toma ahí**, exacto y sin el
retroceso automático de Enter: quien arrastró ya eligió dónde. Es el arreglo
para cuando el profesor arrancó sin conteo y el retroceso no acertó la frase.

Con una toma abierta, la tarjeta pasa a ser **la toma**, y el texto suelto deja
de verse hasta que se cierre. Adelante quedan unas pocas palabras en gris, las
justas para correr el IN hacia atrás, y al final del texto la pastilla roja del
**OUT**: arrastrarla hacia atrás cierra la toma en esa palabra. En las tomas ya
cerradas de la lista, las dos pastillas se mueven sobre lo que quedó guardado
y el tramo se relee. Ninguna de las dos puede pasar al otro lado de la otra.

Es el mismo gesto que en Class Cut: la línea viaja por el texto mientras se
arrastra y lo gris cambia en el acto, así que se ve qué entra antes de soltar.
Mientras hay una agarrada, la pantalla no se repinta.

### Cada toma, del color de su marcador

![Una toma abierta en «Profesor»: el bloque teñido del mismo rojo que su marcador en Premiere](docs/capturas/toma-abierta-1180.png)

El bloque de cada toma lleva el color de su vista, que es **el mismo color con
el que llega su marcador a Premiere**: rojo para Profesor (PV), naranja para
Pantalla (R), verde para Slides (S), cian para Multi (MG) y lila para Doble
(X2). Sale del mismo entero que se escribe en el XML, así que no pueden
separarse. En el selector de vista, la elegida va rellena de su color y las
otras lo llevan en una rayita abajo.

El color va de **fondo**, nunca de letra: el rojo de Profesor da 3,2:1 sobre la
tarjeta, debajo del 4,5 que pide el texto. La sigla va rellena con la tinta que
contrasta contra su color, y el tinte del bloque está medido para que el texto
más tenue siga pasando 4,5:1 encima con los cinco colores
(`node tools/contrastes.js`). Una toma desactivada pierde el color: su marcador
no va a existir.

### Mantener, desactivar, descartar

Cada toma cerrada, al desplegarla, tiene sus tres estados en un solo control:

| | qué pasa |
|---|---|
| **Mantener** | va al XML (lo de siempre) |
| **Desactivar** | no va al XML, pero sigue en la lista y se vuelve a mantener |
| **Descartar** | sale de la sesión; ⌘Z la devuelve |

La abierta no se descarta: primero se cierra. **Reabrir** aparece en la última
toma cuando no hay otra abierta, para cuando «Pausa» cerró de más.
**Ocultar desactivadas** las saca de la vista sin tocarlas.

**Compacto** esconde lo gris de antes del IN y de después del OUT de cada toma,
para leer solo el texto de la toma; apagado, se ve el antes y el después para
validar dónde quedó cada borde. El campo de espera no cambia: ahí todo es gris.

**Comentar un pedazo**: seleccionar palabras del texto de una toma abre un campo
para comentarlas. El comentario va al XML como un marcador blanco en ese tramo,
además de la nota de la toma entera, y las palabras comentadas quedan subrayadas.

Las **claquetas** van en la misma lista, en su lugar entre las tomas, con su
número, timecode, la frase con la que se dijeron, si es la referencia y cómo
quitarlas. En un costado aparte había que cruzar la pantalla y comparar
timecodes para saber qué toma venía después de qué claqueta.

Un detalle que costó descubrir: **el umbral de "todavía está hablando" no puede
ser el mismo que el hueco entre dos palabras.** Lo que la app tiene oído va
siempre atrasado, y se sabe cuánto —el ciclo corre cada segundo, oye con medio
segundo de cola y Whisper tarda otro medio—, así que la última palabra en
memoria puede ser de hace varios segundos con el profesor hablando sin parar. Con el umbral en 1,5 s el
retroceso no se disparaba nunca, o sea que el arreglo no servía justo en el
único caso para el que existe.

## Un solo reloj

Todo se estampa con la **posición en el audio grabado**, no con `Date.now()`.

Las palabras ya venían así: el tiempo de cada una sale de dónde cae en el WAV
(`oir.aHoraDelDia`). Lo que se agregó acá es que **también los gestos del
editor** —la claqueta con la tecla K, cerrar una toma con el botón— se estampan
contra el audio escrito (`espejo.grabadoHastaMs`). El reloj de pared se guarda
igual, en el sidecar, para poder depurar.

El motivo es concreto: el audio que se está escribiendo va uno o dos pedazos por
detrás del reloj de pared. Con `Date.now()`, la marca de la claqueta caía
adelante de donde suena. En una clase de tres horas eso son marcas que no
coinciden con la onda, y el editor sincroniza mirando exactamente eso.

**La latencia no perjudica la precisión**, y es lo que hace que todo esto
funcione. Cuando el profesor dice "Pausa", el OUT no se pone donde la
herramienta se dio cuenta: se pone en el timecode de esa palabra, que Whisper
devuelve junto con el texto. Un segundo de demora en enterarse no mueve el corte
ni un cuadro.

### El cero es el botón, no la claqueta

El cuadro 0 del XML es el momento de **Iniciar grabación**. Podría ser la
primera claqueta —es la referencia física— y sería peor: el número que el editor
tendría que compensar sería "cuánto tardaron en claquetear", que es cualquier
cosa entre siete segundos y dos minutos. Con el cero en el botón, el XML empieza
donde se apretó grabar y la primera claqueta queda adentro, con su timecode,
que es justo lo que hace falta para correlacionar.

## Las claquetas

En una clase en vivo se claquetea varias veces, así que la app las lleva
**todas**, numeradas por orden de reloj. Entran por tres puertas:

- **El aplauso**, que `golpe.js` encuentra como un pico en el PCM y se confirma
  leyendo cuatro segundos a cada lado buscando "claqueta" o "clase N".
- **La palabra dicha**, que oye el ciclo de señales. Existe porque el aplauso
  puede no llegar: el audio de un Zoom pasa por compresión, cancelación de eco y
  control automático de ganancia, y las tres aplastan justo lo que el detector
  busca —un pico corto y muy por encima del fondo—.
- **La tecla K**, que la afirma una persona que estaba mirando.

**Dos que caen a menos de cinco segundos son la misma**, y se funden tomando de
cada una lo que sabe: el `ms` lo pone el aplauso (es un pico en la onda, cae
exactamente donde suena), la frase la pone la voz (el aplauso no sabe qué se
dijo, y el número —"claqueta 4, clase 4"— solo aparece en el texto), y
`confirmada` es un o-lógico.

**Un golpe sin frase se anota igual, sin confirmar.** Una claqueta de más se
borra con un clic; una de menos es un punto de sincronía que el editor no tiene.
La pantalla la muestra como `por confirmar` y quien está mirando decide.

## El XML

Se importa en Premiere tal cual. Lleva **dos cosas**, y las dos hacen falta:

### El audio en A1

El WAV que la app grabó, en su posición contra el cero. Con él el editor
sincroniza las cámaras por forma de onda o con la sincronía automática de
Premiere, en vez de alinear a ojo contra un marcador.

Si el dispositivo se cayó y se reabrió —o si la sesión se reanudó— hay más de un
WAV, y cada uno entra en **su** offset: entre uno y el siguiente hay un hueco
real, y pegarlos uno detrás del otro correría todo lo que viene después.

### Los marcadores, por duplicado

- **De secuencia**: viven en el timeline y son con los que se salta de toma en
  toma.
- **De clip**: viajan con el WAV. Si el editor lo arrastra a otra secuencia, lo
  mete en un multicámara o lo sincroniza con las cámaras, las notas se van con
  él.

Los dos dicen lo mismo y ninguno reemplaza al otro. Por toma van en pares: el de
entrada dura diez segundos y lleva `nota - lo que se dijo`, el de salida no dura
y lleva las últimas palabras. Cada claqueta lleva su número, su hora del día y
la frase que se oyó, y la primera dice que es **la referencia de sincronía**.

### Los cuadros

El fps se elige en Ajustes (23.976 · 24 · 25 · 29.97 · 30 · 50 · 59.94 · 60) y
tiene que ser el de la secuencia donde se va a cortar. Los tres NTSC se escriben
con su fracción exacta y con timecode drop-frame, y la app muestra el **mismo
número** que va a ver el editor: a 29.97, diez minutos son 17.982 cuadros y no
18.000, y esos 18 cuadros de diferencia son imposibles de encontrar mirando.

El fps se congela al arrancar la sesión. Cambiarlo a mitad de una clase de tres
horas movería todos los marcadores ya escritos, contra los que el editor pudo
haber sincronizado ya.

### Compatible con Class Cut

Los marcadores de salida escriben su `out` con el mismo número que su `in` —y no
con el `-1` que el formato permite— porque es la convención con la que el
director de contenido escribe los suyos y la que el parser de
[Class Cut](https://github.com/DanielGutierrezB/Class-Cut) usa para emparejar
los pares. Una clase grabada acá todavía puede pasar por aquel pipeline de
corte.

## El audio del Zoom

En el escenario de esta app la clase llega por una llamada de Zoom y quien toma
notas la escucha con auriculares, así que **ningún micrófono la oye**. Por eso la
primera entrada de la lista es **Audio de Zoom (la llamada)**: la app escucha el
sonido de Zoom directo, sin drivers y sin tocar la configuración de Zoom.

1. Abrir Zoom y entrar a la reunión.
2. En Note Taker, pantalla **Preparar**: si Zoom está abierto, «Audio de Zoom»
   ya viene elegido. Si no, «Buscar de nuevo» lo encuentra.
3. La primera vez, macOS pide permiso para **grabar el audio del sistema**. Hay
   que darlo: sin él, el sonido llega en silencio y no hay forma de preguntarlo
   de otra manera. Se revisa en Ajustes del Sistema → Privacidad y seguridad →
   Grabación de audio del sistema.
4. Apenas empieza la grabación, la tarjeta «Ahora» de En vivo muestra lo que
   Whisper entiende. Si ahí no aparece lo que dice el profesor, se termina y se
   elige otra entrada.

Seguís oyendo la llamada en tus auriculares como siempre, y no se graba nada más
de la Mac: ni notificaciones, ni otra app que suene.

**Cómo funciona.** macOS 14.2 trae los *process taps*: se le pide a Core Audio
una copia del sonido que produce una app, y lo entrega sin cambiar a dónde va.
Eso lo hace un ayudante nativo chico (`nativo/escuchar-app.swift`, compilado por
`tools/bundle-binaries.sh`) que Node lanza y lee. Lo que entrega es exactamente lo
mismo que manda la ventana cuando graba un micrófono —PCM mono de 16 bits en
pedazos de 4096 muestras—, así que el resto del motor no distingue de dónde vino.
El tamaño del pedazo importa: `golpe.js` mide el pico y el promedio de cada uno
para reconocer el aplauso, y sus umbrales se midieron con ese tamaño.

**La tasa es la del dispositivo, no la del tap.** El primer ayudante declaraba
los 48 kHz del formato del tap, pero las muestras llegan al ritmo del
dispositivo agregado, que sigue a la salida del sistema. Con unos AirPods y Zoom
usando su micrófono, el Bluetooth pasa a modo llamada y la salida baja a 24 kHz:
el WAV quedaba **al doble de velocidad y con la mitad de la duración** (en las
pruebas del 29/09, 84,3 s de clase y 42,1 s de audio). Whisper oía la clase
acelerada —de ahí el texto peor y los «Gracias» inventados— y los marcadores
caían a la mitad de donde van. Ahora el ayudante lee la tasa del agregado,
escucha cuando cambia a mitad de la clase, toma solo los canales del tap (antes
promediaba también el micrófono de los AirPods, y además lo dejaba abierto) y
entrega siempre 48 kHz.

**El WAV va atado al reloj**, porque de eso depende sincronizar con la cámara:
- El hilo de audio del ayudante no escribe el pipe: deja las muestras en un
  anillo de diez segundos y otro hilo las manda. Antes esperaba al pipe, y con
  Node ocupado se perdían ciclos de audio.
- Si la salida de audio cambia o desaparece (los AirPods al estuche), el
  ayudante sale con un código y Node lo vuelve a lanzar solo, sobre la salida
  nueva, sin cortar la grabación.
- Si no llega audio (una traba, un rearme), Node rellena el hueco con silencio
  para que el WAV no quede más corto que la clase; si lo que faltaba llega tarde,
  se descuenta del relleno. Se avisa en pantalla y queda en el registro.
- La sesión compara cada segundo lo grabado contra el reloj (`vigilarDeriva`).
  Si se atrasa más de dos segundos, lo avisa. Es la pregunta que habría
  encontrado el error del doble de velocidad en el primer minuto.

La primera versión de esta red medía la tasa por el reloj y remuestreaba si no
coincidía. Una revisión mostró que no distinguía "no llegó nada un rato" de
"llega a otra tasa": una pausa de tres segundos la hacía creer 24 kHz y
estiraba el audio bueno al doble. Se sacó.

**Sobre el silencio no se escribe.** Zoom manda ceros exactos cuando nadie habla,
y sobre eso Whisper escribe lo que aprendió de los subtítulos: «Gracias.»,
«Gracias por ver el video.». `engine/sonido.js` mide el nivel de cada recorte:
si no suena nada no se le pregunta a Whisper, y una palabra sin sonido alrededor
(−60 dBFS, lejos de la voz, de −13 a −30, y del ruido de sala más bajo de un
micrófono, −55) se descarta.

**Lo que la lista no deja elegir en verde.** Los nombres de la lista confunden, y
el error se descubría después de la clase:

| entrada | qué pasa |
|---|---|
| Audio de Zoom (la llamada) | la voz de la reunión. En verde |
| **ZoomAudioDevice (Virtual)** | parece la llamada y **no lo es**: es lo que Zoom usa para *mandar* el sonido de la Mac al compartir pantalla. En rojo |
| un micrófono (el de la Mac, el del iPhone, los AirPods) | graba la sala. En ámbar, con «Es una clase presencial: usar el micrófono» para cuando sí es eso |
| BlackHole, Loopback, un dispositivo agregado | sirve si Zoom manda su sonido ahí |

Con los auriculares Bluetooth hay además otro motivo para no elegir su
micrófono: abrirlo los pasa a modo llamada y el sonido en los oídos empeora.

Sin el ayudante —una Mac con macOS anterior a 14.2, o una copia sin
`bundle-binaries.sh`— queda el camino de siempre: instalar
[BlackHole](https://existential.audio/blackhole/), armar un dispositivo de salida
múltiple con BlackHole y los auriculares, ponerlo como altavoz en Zoom y elegir
BlackHole en Note Taker.

Si la fuente es una interfaz o una grabadora, se elige su línea y listo. La app
abre la entrada **sin** cancelación de eco, sin supresión de ruido y sin control
automático de ganancia: las tres están hechas para una llamada y acá arruinan lo
que importa —el automático sube el fondo en los silencios, que es cuando la
claqueta tiene que destacar, y el supresor se come los transitorios, que es lo
que la claqueta ES—.

## El flujo del editor en Premiere

1. Importar el XML. Entra un bin con el WAV y una secuencia con el audio en A1.
2. Poner los archivos de cámara en la misma secuencia.
3. **Sincronizar contra la claqueta 1.** El marcador dice su timecode y su hora
   del día: la hora sirve para emparejar con la fecha de creación de cada
   archivo cuando hay varios y no se sabe cuál es cuál.
4. Si hay más claquetas, sirven de control: cada una tiene que seguir cayendo
   donde suena. Una que se corrió dice que una cámara se cortó y volvió.
5. Cortar siguiendo los marcadores. Se salta de uno a otro con la navegación de
   marcadores de Premiere; el comentario de cada IN trae la nota y lo primero
   que se dijo.

Para ver cómo queda sin grabar nada:

```bash
node tools/ver-marcadores.js --fps 29.97
```

Escribe un XML de prueba en `/tmp` con las cinco vistas, tres claquetas y una
toma desactivada que no tiene que aparecer.

## Las dos lecturas de Whisper

Hay dos ciclos y la separación es lo que protege el transcript.

| | cuándo | modelo | qué queda |
|---|---|---|---|
| **en vivo** | cada 1 s, sobre los últimos 6 s | el grande (`large-v3-turbo`) con DTW, cargado en `whisper-server` | el texto que se ve mientras se habla, y la hora de las señales |
| **toma** | al cerrar cada toma | el grande, con alineación DTW (`whisper-cli`) | el texto del XML |

### El texto en vivo

Hasta la versión anterior el ciclo en vivo era el de Class Cut tal cual: cada
3 s, relanzando `whisper-cli` con el modelo chico (`ggml-small`). En Class Cut
ese texto se tiraba —solo servía para oír «3, 2, 1» y «Pausa»— así que no
importaba que fuera malo. Acá se muestra, y se notaba: sobre el audio de una
prueba por Zoom escribía «Proven, no Proven», «¡Sigual!», e inventaba «nos
vemos en el próximo vídeo, ¡hasta la próxima!» sobre los silencios.

Qué modelo usar salió de medir y no de elegir. Para español, en las
comparaciones publicadas de 2026 (FLEURS y similares), el orden en error por
palabra es Qwen3-ASR 1.7B (~3,4 %), Whisper large-v3-turbo (~3,6 %), Parakeet
TDT v3 (~4,5–4,9 %) y el SpeechAnalyzer de macOS (~5,4 %); Whisper small queda
bastante más atrás. Parakeet es el más rápido (corre en el Neural Engine) y
SpeechAnalyzer el de menos latencia, pero los dos se equivocan más en español.
Qwen3-ASR acierta apenas más que el turbo y necesita otro motor entero.

Y en esta máquina (M3 Max), sobre pedazos de 6 s del audio de Zoom:

| | por pasada | texto |
|---|---|---|
| `whisper-cli` + small | 0,76 s | «Esto inicia el primera tomo» |
| `whisper-cli` + turbo | 0,96 s | «esto inicia la primera toma» |
| `whisper-server` + turbo | **0,54 s** | «esto inicia la primera toma» |

Casi todo el costo de una pasada era cargar el modelo. Con el turbo cargado de
una vez en `whisper-server` (`engine/oido-residente.js`), el modelo bueno sale
más rápido que el chico relanzado. Si el servidor no está o se cae, el ciclo
vuelve a `whisper-cli` con el chico y la clase sigue.

Tres cosas más del ciclo, cada una por algo que se vio:

- **Lo del final de cada pasada no se cree todavía** (`COLA_MS`). La última
  palabra de un pedazo suele estar cortada («funcion» por «funcionando»); la
  pasada siguiente la oye entera. Pero se mira para saber qué sigue a «Pausa»,
  o «pausa en el flujo» cerraría la toma.
- **El solape se engancha por el texto y no por la hora.** Sin DTW, la hora de
  una palabra se corre hasta medio segundo de una pasada a otra, y comparar
  horas perdía palabras («Esto inicia la primera toma» llegaba como «inicia la
  toma») y repetía otras. Se busca la cola de lo ya oído adentro de la ventana
  nueva y se sigue después, como hace whisper_streaming.
- **Con DTW, como la relectura.** Son estos tiempos los que ponen el IN de
  «3, 2, 1» y el OUT de «Pausa». Sin la alineación contra el sonido caían hasta
  medio segundo corridos, y la relectura —que sí la usa— después ponía las
  palabras a un lado distinto del borde. Cuesta 0,15 s por pasada.
- **Cada segundo sobre seis.** Medido con una sesión de verdad sobre esa prueba,
  desde que se dice una palabra hasta que aparece: 2,9 s de mediana y 4,1 s en
  el peor décimo (antes, más de cinco).

`node tools/medir-vivo.js --wav=<audio> --salida=/tmp/textos.txt` recorre un
audio con la forma vieja y la nueva y deja los dos textos al lado del de
referencia.

El de toma sigue siendo el que queda: corre una vez, sobre la toma entera, con
la alineación contra el sonido, y ESE texto es el del XML. Así el transcript
del XML nunca se arma pegando pedazos, que es de donde salen las palabras
cortadas y los tiempos que no cierran.

**El solape no es un descuido.** Una señal que caiga justo en el borde entre dos
pasadas aparece partida en las dos y completa en ninguna; con el solape llega
entera en la segunda, y los duplicados se descartan donde se sabe qué es una
palabra repetida y qué es una señal repetida.

**Si Whisper se muere, hay política** (`engine/insistir.js`). Se distinguen dos
cosas: si el sistema se lo llevó por delante, eso cede y se insiste una vez; si
whisper.cpp contestó que no puede, eso no cambia repitiéndolo y se baja al
modelo más liviano que haya. Se baja por **peso** y no por calidad, porque el que
sigue en calidad pesa el doble y pedirle el doble de memoria a una máquina que
se acaba de quedar sin memoria no es un plan. Si no se pudo con ninguno, la toma
queda marcada como **sin releer** y «Regenerar» la limpia después, con la clase
ya grabada y la máquina libre.

## Reanudar

Si la app se cierra en medio de una clase, la sesión queda **abierta** y se
puede reanudar: mismo XML, mismo cero, y el audio nuevo entra como otro clip en
su lugar.

Es lo que protege el único invariante que importa: que de una clase salga UN XML
con los tiempos cerrados de punta a punta. Con dos XML, el editor tendría que
sincronizar dos veces y correlacionar dos primeras claquetas, que es justo el
trabajo que esta app existe para ahorrarle.

Una sesión ya cerrada **no** se reanuda: su XML está completo y el editor pudo
haber sincronizado contra él.

## La interfaz

El sistema visual es el de
[HyperPremiere](https://github.com/DanielGutierrezB/HyperPremiere) v1.6.0, que
se construyó midiendo y no eligiendo. Lo que se mantiene:

- **Tres voces hechas con peso y color**, con el tamaño casi quieto (13/12/11
  px). En listas densas el tamaño no puede ser el canal de jerarquía: el rango
  útil da tres pasos de 1 px, y un paso de 1 px no se lee.
- **Estado = guarda de color + la palabra en una pastilla. Acción = rectángulo
  con borde.** Pastilla es información, rectángulo es clic, y no hay una sola
  excepción. Nunca solo color (WCAG 1.4.1).
- **El acento quiere decir una cosa**: acá va tu atención ahora. El foco del
  teclado, la acción principal de la pantalla —una por pantalla— y lo que está
  corriendo. El hover es una capa, no un cambio de color.
- **Retícula de 4 px, filas de 32**, que es el `sm` de Carbon y la fila más
  chica que puede contener un control de 24×24 (WCAG 2.5.8).

Lo que cambia respecto de allá es que un panel mide 400 px y esta ventana 1180.
Eso habilita **dos elementos grandes y no más**: el timecode y el estado de la
sesión, que son los dos que hay que poder leer sin acercarse mientras el
profesor habla.

### Medido, no opinado

```bash
node tools/contrastes.js       # la tabla WCAG de los tokens
node tools/auditar.js          # contraste real sobre el DOM, filas, cromo, blancos de clic
node tools/medir-botones.js    # texto fuera de su caja, solapes, desbordes
node tools/capturar.js         # las capturas de docs/capturas/
node tools/maqueta/abrir.js    # la interfaz de verdad, con datos falsos
```

Los criterios de aceptación están escritos como números en `tools/auditar.js`, y
lo que no los cumple sale con código 1. Hoy, sobre las seis vistas a 900, 1180 y
1440 px:

| | |
|---|---|
| textos por debajo de AA | **0** |
| el peor contraste | **4.83:1** |
| tamaños de letra pintados a la vez | **5** (13/12/11 + los dos grandes) |
| controles por debajo de 24×24 | **0** de 558 |
| texto pintado fuera de su caja | **0** |
| solapes | **0** |
| fila de toma plegada | **32 px** |
| cromo fijo en la pantalla más cargada | **17,2 %** |

La maqueta (`tools/maqueta/`) es el HTML y el CSS de verdad con datos falsos:
acá adentro no hay ni una línea de interfaz duplicada. Lo único que se falsea
son las dos puertas por las que la ventana habla con el mundo —`window.nt` y el
micrófono—. Los escenarios se eligen por la URL y se combinan con coma
(`?e=en-vivo,sin-audio`).

## Desarrollo

```bash
npm install
npm start          # la app
npm test           # 237 pruebas, sin red y sin abrir nada
npm run maqueta    # la interfaz con datos falsos
npm run atajo      # un «Note Taker (Dev).app» en el Escritorio
```

`npm run atajo` deja en el Escritorio un `.app` que abre esta copia del código
con doble clic, sin Terminal de por medio. Es un bundle de verdad y no un
archivo `.command` porque un `.command` deja una ventana de Terminal abierta
mientras la app corre, y cerrarla mataría la grabación.

Lleva su propio identificador (`com.codigo.notetaker.dev`), así que sus
permisos de micrófono y sus preferencias no se pisan con los de la app
instalada. Si el repo se mueve o falta `node_modules`, el atajo lo dice en un
cartel en vez de no hacer nada; lo que la app escriba queda en
`~/Library/Logs/note-taker-dev.log`.

Para las herramientas externas alcanza con Homebrew:

```bash
brew install ffmpeg whisper-cpp
mkdir -p bin/mac/models   # y dejar ahí ggml-large-v3-turbo.bin y ggml-small.bin
```

Se pueden apuntar con `NOTETAKER_WHISPER_MODEL` y
`NOTETAKER_WHISPER_MODELO_LIVIANO`. **Diagnóstico** (arriba a la derecha) dice
qué encontró y dónde.

### Probarlo sin grabar nada

La única forma de ejercitar esto de punta a punta sin un Zoom abierto y sin
ponerse a contar "3, 2, 1" en voz alta:

```bash
node tools/simular-grabacion.js --wav=<audio de una clase> --minutos=6 \
  --contra=<xml de referencia>
```

Le pasa el audio al motor pedazo por pedazo como si estuviera entrando ahora, y
compara las tomas que salieron contra un XML escrito a mano. Funciona a toda
velocidad porque los tiempos no salen de `Date.now()` sino de la posición en el
audio: seis minutos de clase se pasan en dos minutos de reloj y los timecodes
que salen son los que habrían salido en vivo.

### Estructura

```
main.js · preload.js     Electron (el motor corre en el proceso principal)
ipc/grabar.js            el puente de la grabación
engine/
  grabacion.js           la sesión: los relojes, el ciclo de señales, las claquetas
  espejo.js              lo que se ve de la sesión: el disco y la pantalla
  notas-vivo.js          qué es una toma y qué es una claqueta
  notas-xml.js           cómo se escribe todo eso para Premiere
  fcp-xml.js             el formato FCP7, con marcadores de secuencia y de clip
  captura.js             el WAV que se escribe mientras entra
  golpe.js               el aplauso, en el PCM
  oir.js · transcribe.js Whisper local, por pedazos
  oir-toma.js            volver a oír un tramo, con o sin sesión
  relecturas.js          la cola que le rehace el texto a cada toma cerrada
  insistir.js            qué hacer cuando Whisper se muere
  cambios-toma.js        lo que el editor cambia a mano, y deshacer
  sesiones-grabadas.js   listar, renombrar, borrar y reanudar
  workspace.js           dónde escribe la app, y la escritura atómica
  paths.js               dónde están ffmpeg y whisper en esta máquina
src/js/
  app.js                 el cableado: qué pantalla sigue a cuál
  pantalla-*.js          Sesiones · Preparar · En vivo · Cierre
  estados.js             el vocabulario de estados, en un solo sitio
  formato.js             el timecode, que tiene que dar lo mismo que el XML
  iconos.js              SVG de trazo, un dibujo por concepto
  grabar/oido.js         getUserMedia y el worklet que manda el PCM
tools/                   maqueta, auditoría, simulación, build
tests/                   corredor propio: node tests/run.js
```

## Distribución

```bash
bash tools/bundle-binaries.sh   # ffmpeg, ffprobe y whisper-cli adentro de la app
npm run build                   # los dos instaladores
npm run publish                 # el release en GitHub
```

Son dos instaladores porque los modelos son casi todo el peso y son los mismos
entre versiones: si viajaran dentro del `.app`, cada actualización sería bajar
dos gigas para cambiar unos kilobytes, y reemplazar el `.app` los borraría. El
instalador completo los deja una vez en
`/Library/Application Support/Note Taker` y ahí se quedan; el de actualización
lleva solo la app.

**La app no está firmada con Developer ID.** La primera vez macOS la va a frenar
y hay que darle «Abrir igual» en Ajustes → Privacidad y seguridad.

## Estado

El motor está probado de punta a punta contra audio real: sobre seis minutos de
una clase grabada, abre las siete tomas que se dijeron, encuentra tres claquetas
—la primera confirmada por el texto, que Whisper escribió "Claquetados,
clasedos"— y el bloque de referencia que el director había marcado a mano cae
dentro del segundo (IN +0,6 s, OUT +0,9 s).

Lo que falta es la vuelta que solo la da el uso: una clase entera de verdad, con
el XML importado en Premiere y el corte hecho encima.
