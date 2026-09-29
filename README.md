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

Un detalle que costó descubrir: **el umbral de "todavía está hablando" no puede
ser el mismo que el hueco entre dos palabras.** Lo que la app tiene oído va
siempre atrasado, y se sabe cuánto —el ciclo corre cada tres segundos y Whisper
tarda algo más de uno—, así que la última palabra en memoria puede ser de hace
cuatro segundos con el profesor hablando sin parar. Con el umbral en 1,5 s el
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

La app no habla con Zoom: escucha una **entrada de audio del sistema**. Para que
el sonido de una reunión llegue ahí hace falta un dispositivo virtual.

1. Instalar [BlackHole 2ch](https://existential.audio/blackhole/) (o Loopback).
2. En Zoom → Configuración → Audio → **Altavoz**, elegir `BlackHole 2ch`.
   Para además escucharlo, armar un *dispositivo agregado* en Configuración de
   Audio MIDI con BlackHole y los auriculares, y elegir ese.
3. En Note Taker, pantalla **Preparar**, elegir `BlackHole 2ch` como entrada.
4. Mirar el medidor y el renglón **"Lo que se está oyendo"**: ahí aparece lo que
   Whisper entiende. Es la manera de saber que entra la voz correcta antes de
   empezar, y no después de haber grabado media clase.

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
toma descartada que no tiene que aparecer.

## Las dos lecturas de Whisper

Hay dos ciclos y la separación es lo que protege el transcript.

| | cuándo | modelo | qué queda |
|---|---|---|---|
| **señales** | cada 3 s, con 1,2 s de solape | el liviano (`ggml-small`) | solo la hora de las señales |
| **toma** | al cerrar cada toma | el grande (`large-v3-turbo`) | el texto |

El de señales es rápido y de calidad mediana: lo único que se le cree es que una
señal SONÓ y a qué hora. El de toma corre una vez, sobre la toma entera, y ESE
texto es el que queda. Así el transcript nunca se arma pegando pedazos, que es
de donde salen las palabras cortadas y los tiempos que no cierran.

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
npm test           # 221 pruebas, sin red y sin abrir nada
npm run maqueta    # la interfaz con datos falsos
```

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
