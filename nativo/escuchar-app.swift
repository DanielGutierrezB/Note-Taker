// escuchar-app — El sonido de otra app, o de toda la Mac, sin drivers.
//
//   escuchar-app --listar                 qué apps están sonando, en JSON
//   escuchar-app --app us.zoom            PCM mono de 16 bits por stdout
//   escuchar-app --sistema [--menos B]    lo mismo, pero todo lo que suene
//
// Existe por el escenario de esta app: la clase llega por una llamada de
// Zoom, y quien toma notas la escucha con auriculares. Ningún micrófono la
// oye. Hasta acá la única salida era instalar un driver virtual (BlackHole),
// armar un dispositivo de salida múltiple y acordarse de ponerlo como altavoz
// en Zoom — y el día que Zoom volviera solo a los auriculares, la clase se
// grababa en silencio.
//
// macOS 14.2 trae "process taps": se le pide a Core Audio una copia del sonido
// que produce un proceso, y lo entrega sin tocar a dónde va. Quien escucha
// sigue oyendo por sus auriculares, Zoom no se entera, y no se mezclan
// notificaciones ni nada más que suene en la Mac.
//
// **Y hay dos maneras de pedirla, que no son la misma.** `--app` engancha el
// tap a los procesos de esa app, de los que hay en ese instante: si la app se
// reinicia, el tap apunta a procesos que ya no están. `--sistema` pide el tap
// global —todo lo que sale por la salida del sistema— y no se engancha a
// ningún proceso ajeno: sirve igual para Zoom, para Meet o para lo que sea,
// no hay nada que se pueda reiniciar debajo, y a cambio también graba las
// notificaciones y cualquier otro sonido de la Mac. `--menos` le saca al tap
// global los procesos de un bundle, que es como Note Taker evita grabarse a
// sí misma.
//
// El protocolo con quien lo lanza (`engine/audio-app.js`) es mínimo:
//   · stderr, una línea JSON al arrancar: {"listo":true,"sampleRate":…} o
//     {"error":"…","codigo":"…"} y salida distinta de cero;
//   · stdout, PCM mono Int16 little-endian, el mismo formato que manda la
//     ventana cuando graba un micrófono (`src/js/grabar/pcm-worklet.js`), así
//     que el resto del motor no distingue de dónde vino.
//
// Lo que NO hace: pedir el permiso. macOS lo pide solo la primera vez que se
// crea un tap, y lo atribuye a la app que lanzó este proceso. Si se niega, el
// tap se crea igual y entrega silencio — no hay API pública para preguntar —,
// así que quien llama se entera por el nivel, que no se mueve.

import AudioToolbox
import os
import CoreAudio
import Foundation

// ─── Lo mínimo para preguntarle cosas a Core Audio ───────────────────────

func direccion(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
}

func leerLista(_ objeto: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var dir = direccion(selector)
    var tamano: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(objeto, &dir, 0, nil, &tamano) == noErr, tamano > 0 else { return [] }
    var lista = [AudioObjectID](repeating: 0, count: Int(tamano) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(objeto, &dir, 0, nil, &tamano, &lista) == noErr else { return [] }
    return lista
}

func leerTexto(_ objeto: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var dir = direccion(selector)
    var tamano = UInt32(MemoryLayout<CFString?>.size)
    var valor: Unmanaged<CFString>?
    guard AudioObjectGetPropertyData(objeto, &dir, 0, nil, &tamano, &valor) == noErr,
          let texto = valor?.takeRetainedValue() else { return nil }
    return texto as String
}

/// `BitwiseCopyable` porque Core Audio escribe los bytes directo encima del
/// valor: con un tipo que tuviera referencias adentro, eso sería pisar un
/// puntero con basura. Los que se leen acá son todos números y structs de C.
func leerNumero<T: BitwiseCopyable>(_ objeto: AudioObjectID, _ selector: AudioObjectPropertySelector, _ vacio: T) -> T? {
    var dir = direccion(selector)
    var tamano = UInt32(MemoryLayout<T>.size)
    var valor = vacio
    guard AudioObjectGetPropertyData(objeto, &dir, 0, nil, &tamano, &valor) == noErr else { return nil }
    return valor
}

/// Termina con una línea de error que quien lanzó esto puede leer y mostrar.
func fallar(_ mensaje: String, _ codigo: String) -> Never {
    let json: [String: Any] = ["error": mensaje, "codigo": codigo]
    if let datos = try? JSONSerialization.data(withJSONObject: json),
       let linea = String(data: datos, encoding: .utf8) {
        FileHandle.standardError.write((linea + "\n").data(using: .utf8)!)
    }
    exit(1)
}

/// Una línea JSON por stderr en medio de la escucha: una tasa que cambió,
/// muestras perdidas. Quien lanzó esto la anota en el registro.
func avisar(_ campos: [String: Any]) {
    if let datos = try? JSONSerialization.data(withJSONObject: campos),
       let linea = String(data: datos, encoding: .utf8) {
        FileHandle.standardError.write((linea + "\n").data(using: .utf8)!)
    }
}

func avisarListo(_ campos: [String: Any]) {
    var json = campos
    json["listo"] = true
    if let datos = try? JSONSerialization.data(withJSONObject: json),
       let linea = String(data: datos, encoding: .utf8) {
        FileHandle.standardError.write((linea + "\n").data(using: .utf8)!)
    }
}

// ─── Los procesos que tienen audio ───────────────────────────────────────

struct Proceso {
    let objeto: AudioObjectID
    let bundle: String
    let pid: Int32
    let sonando: Bool
}

/// Los procesos que Core Audio conoce, con su identificador de app.
///
/// Se busca por bundle y no por PID porque Zoom no es UN proceso: la ventana
/// y el que produce el sonido de la reunión pueden ser dos, y el segundo no
/// se llama como la app. Con el prefijo del bundle se agarran todos.
func procesos() -> [Proceso] {
    leerLista(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList).compactMap { objeto in
        guard let bundle = leerTexto(objeto, kAudioProcessPropertyBundleID), !bundle.isEmpty else { return nil }
        let pid = leerNumero(objeto, kAudioProcessPropertyPID, Int32(0)) ?? 0
        let sonando = (leerNumero(objeto, kAudioProcessPropertyIsRunningOutput, UInt32(0)) ?? 0) != 0
        return Proceso(objeto: objeto, bundle: bundle, pid: pid, sonando: sonando)
    }
}

// ─── --listar ────────────────────────────────────────────────────────────

func listar() -> Never {
    let lista = procesos().map { ["bundle": $0.bundle, "pid": $0.pid, "sonando": $0.sonando] as [String: Any] }
    let datos = (try? JSONSerialization.data(withJSONObject: lista)) ?? Data("[]".utf8)
    FileHandle.standardOutput.write(datos)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

// ─── --app ───────────────────────────────────────────────────────────────

// ─── El remuestreo a 48 kHz ───────────────────────────────────────────────

/// Lo que sale de acá, siempre. Es la tasa del WAV que se escribe, así que no
/// puede cambiar a mitad de una clase aunque cambie la del dispositivo.
let TASA_DE_SALIDA: Double = 48000

/// La tasa a la que llegan las muestras ahora. La escribe el aviso de Core
/// Audio y la lee el hilo de audio: es un Double alineado, que en arm64 se lee
/// y se escribe de una vez, y un pedazo leído con la tasa vieja son unos
/// milisegundos mal remuestreados en el instante del cambio.
var tasaEntrada: Double = 48000

/// Dónde cae la próxima muestra de salida, medido en muestras de entrada desde
/// el principio del buffer que viene (-1 es la última del anterior).
var fase: Double = 0
var previa: Float = 0

/// Interpolación lineal entre buffers seguidos, sin reservar memoria: corre en
/// el hilo de audio. Para voz alcanza, y en el caso que existe esto —de 24 a
/// 48 kHz— solo agrega muestras: no hay nada que filtrar.
///
/// - Returns: cuántas muestras escribió en `salida`
func remuestrear(_ x: UnsafePointer<Float>, _ n: Int,
                 _ salida: UnsafeMutablePointer<Int16>, _ capacidad: Int) -> Int {
    guard n > 0 else { return 0 }
    let paso = tasaEntrada / TASA_DE_SALIDA
    var escritas = 0
    var p = fase
    // Estrictamente antes de la última: esa es la `previa` del buffer que viene,
    // y leer `x[i + 1]` con `i == n - 1` sería salirse.
    while p < Double(n - 1) && escritas < capacidad {
        let i = Int(p.rounded(.down))
        let f = Float(p - Double(i))
        let a = i < 0 ? previa : x[i]
        let b = x[i + 1]
        let v = max(-1, min(1, a + (b - a) * f))
        salida[escritas] = Int16(v * 32767)
        escritas += 1
        p += paso
    }
    fase = p - Double(n)
    previa = x[n - 1]
    return escritas
}

// ─── El anillo entre el hilo de audio y el pipe ───────────────────────────

/// El hilo de audio no escribe el pipe: deja las muestras acá y sigue.
///
/// Antes escribía desde una cola serie creyendo que así no bloqueaba, pero los
/// bloques de E/S de Core Audio se despachan SINCRÓNICAMENTE (lo dice el header
/// de `AudioDeviceCreateIOProcIDWithBlock`): el hilo de tiempo real esperaba al
/// pipe, y con el proceso de Node ocupado unos cientos de milisegundos el pipe
/// se llenaba y se perdían ciclos de audio para siempre. Ahora un hilo aparte
/// vacía el anillo; si Node se atrasa, lo que espera es ese hilo, y el anillo
/// aguanta diez segundos.
let CAPACIDAD_ANILLO = 48000 * 10
let anillo = UnsafeMutablePointer<Int16>.allocate(capacity: CAPACIDAD_ANILLO)
var anilloEscrito = 0   // muestras totales que entraron
var anilloLeido = 0     // muestras totales que salieron al pipe
var anilloPerdidas = 0  // las que no cupieron
let candado: UnsafeMutablePointer<os_unfair_lock> = {
    let c = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    c.initialize(to: os_unfair_lock())
    return c
}()

/// Lo del hilo de audio, que no reserva memoria: los dos buffers de trabajo se
/// reservan una vez.
let CAPACIDAD_TRABAJO = 16384
let trabajoMono = UnsafeMutablePointer<Float>.allocate(capacity: CAPACIDAD_TRABAJO)
let trabajoSalida = UnsafeMutablePointer<Int16>.allocate(capacity: CAPACIDAD_TRABAJO * 8)

func alAnillo(_ datos: UnsafePointer<Int16>, _ n: Int) {
    os_unfair_lock_lock(candado)
    let libres = CAPACIDAD_ANILLO - (anilloEscrito - anilloLeido)
    let entran = min(n, libres)
    for k in 0..<entran { anillo[(anilloEscrito + k) % CAPACIDAD_ANILLO] = datos[k] }
    anilloEscrito += entran
    anilloPerdidas += n - entran
    os_unfair_lock_unlock(candado)
}

/// El hilo que vacía el anillo en stdout. Si quien leía se fue (EPIPE), no hay
/// a quién mandarle nada: se suelta todo y se sale.
func arrancarEscritor() {
    let hilo = Thread {
        let local = UnsafeMutablePointer<Int16>.allocate(capacity: CAPACIDAD_ANILLO)
        var perdidasAvisadas = 0
        while true {
            usleep(10_000)
            os_unfair_lock_lock(candado)
            let hay = anilloEscrito - anilloLeido
            for k in 0..<hay { local[k] = anillo[(anilloLeido + k) % CAPACIDAD_ANILLO] }
            anilloLeido += hay
            let perdidas = anilloPerdidas
            os_unfair_lock_unlock(candado)

            var bytes = UnsafeRawPointer(local)
            var quedan = hay * 2
            while quedan > 0 {
                let r = write(1, bytes, quedan)
                if r < 0 {
                    if errno == EINTR { continue }
                    soltar(); exit(0)
                }
                bytes += r
                quedan -= r
            }
            // Se dice, no se esconde: son muestras que el WAV no tiene, y quien
            // lanza esto rellena el hueco con silencio para no correr el reloj.
            if perdidas > perdidasAvisadas {
                avisar(["perdidas": perdidas - perdidasAvisadas])
                perdidasAvisadas = perdidas
            }
        }
    }
    hilo.qualityOfService = .userInitiated
    hilo.start()
}

var tapID = AudioObjectID(kAudioObjectUnknown)
var agregadoID = AudioObjectID(kAudioObjectUnknown)
var procID: AudioDeviceIOProcID?

/// Deja todo como estaba. Un tap o un dispositivo agregado que queda vivo no
/// se ve en ningún lado —son privados— pero sigue ocupando el hardware hasta
/// que el proceso muere, así que se sueltan en orden y a mano.
func soltar() {
    if let proc = procID {
        AudioDeviceStop(agregadoID, proc)
        AudioDeviceDestroyIOProcID(agregadoID, proc)
    }
    if agregadoID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(agregadoID) }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
}

/// Cuántos streams de entrada tiene un dispositivo.
func streamsDeEntrada(_ dispositivo: AudioObjectID) -> Int {
    var dir = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                         mScope: kAudioObjectPropertyScopeInput,
                                         mElement: kAudioObjectPropertyElementMain)
    var tamano: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(dispositivo, &dir, 0, nil, &tamano) == noErr else { return -1 }
    return Int(tamano) / MemoryLayout<AudioStreamID>.size
}

/// Deja prendido solo el stream del tap.
///
/// El agregado trae las entradas de su dispositivo de salida, y un stream de
/// entrada prendido es un micrófono abierto: con unos AirPods, eso solo ya
/// podía pasarlos a modo llamada —24 kHz, peor sonido en los oídos de quien
/// escucha y el indicador del micrófono encendido— aunque Zoom no los usara.
///
/// Solo se toca si la cuenta cierra: los del dispositivo de salida más UNO, que
/// es el del tap. Si no cierra, no se sabe cuál es cuál, y apagar el del tap
/// sería grabar silencio: se deja todo como estaba.
func apagarEntradasAjenas(_ agregado: AudioObjectID, _ proc: AudioDeviceIOProcID, salida: AudioObjectID) {
    var dir = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyIOProcStreamUsage,
                                         mScope: kAudioObjectPropertyScopeInput,
                                         mElement: kAudioObjectPropertyElementMain)
    var tamano: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(agregado, &dir, 0, nil, &tamano) == noErr,
          tamano >= UInt32(MemoryLayout<AudioHardwareIOProcStreamUsage>.size) else { return }
    let crudo = UnsafeMutableRawPointer.allocate(byteCount: Int(tamano), alignment: 16)
    defer { crudo.deallocate() }
    crudo.initializeMemory(as: UInt8.self, repeating: 0, count: Int(tamano))
    let uso = crudo.bindMemory(to: AudioHardwareIOProcStreamUsage.self, capacity: 1)
    uso.pointee.mIOProc = unsafeBitCast(proc, to: UnsafeMutableRawPointer.self)
    guard AudioObjectGetPropertyData(agregado, &dir, 0, nil, &tamano, crudo) == noErr else { return }
    let total = Int(uso.pointee.mNumberStreams)
    let ajenos = streamsDeEntrada(salida)
    guard total > 1, ajenos >= 0, ajenos == total - 1,
          let offset = MemoryLayout<AudioHardwareIOProcStreamUsage>.offset(of: \.mStreamIsOn) else { return }
    let prendidos = (crudo + offset).bindMemory(to: UInt32.self, capacity: total)
    for i in 0..<total { prendidos[i] = i == total - 1 ? 1 : 0 }
    if AudioObjectSetPropertyData(agregado, &dir, 0, nil, tamano, crudo) == noErr {
        avisar(["entradasApagadas": ajenos])
    }
}

/** Cada cuánto se comprueba que Note Taker siga viva. */
let VIGILAR_CADA_SEG: Double = 2

/**
 Si quien lanzó esto se fue, se suelta todo y se sale.

 Esto es el arreglo de un problema real y feo: **un ayudante huérfano se queda
 con el tap y el dispositivo agregado tomados para siempre**, y los dos son
 privados, así que no se ven en ningún lado —ni en Configuración de Audio MIDI,
 ni en ninguna lista— mientras siguen ocupando el hardware. Lo único que lo
 arreglaba era encontrar el proceso y matarlo a mano.

 Había una red y no alcanzaba: el hilo escritor se entera de que nadie lee
 cuando el `write` devuelve EPIPE, pero si no hay sonido no escribe nunca, y
 sin sonido es justamente cuando esto pasa. Y SIGTERM solo llega si la app
 alcanzó a mandarlo: un cierre forzado, un cuelgue o un SIGKILL no mandan nada.

 `getppid() == 1` es el padre adoptado por launchd, o sea que el de verdad ya
 no está.
 */
func vigilarAlPadre() {
    let cola = DispatchQueue(label: "notetaker.padre")
    let reloj = DispatchSource.makeTimerSource(queue: cola)
    reloj.schedule(deadline: .now() + VIGILAR_CADA_SEG, repeating: VIGILAR_CADA_SEG)
    reloj.setEventHandler {
        if getppid() == 1 { soltar(); exit(0) }
    }
    reloj.resume()
    _ = Unmanaged.passRetained(reloj)
}

func escuchar(prefijo: String?, menos: String?) -> Never {
    guard #available(macOS 14.2, *) else {
        fallar("Esta Mac tiene un macOS anterior a 14.2, que no sabe escuchar el sonido de otra app.",
               "no-soportado")
    }

    // Una copia del sonido, mezclada a estéreo, que no le saca nada a nadie:
    // `unmuted` es lo que hace que quien toma notas lo siga escuchando en sus
    // auriculares. De los procesos de una app, o de todo menos los nuestros.
    let descripcion: CATapDescription
    var deQuien: [String] = []
    if let prefijo = prefijo {
        let suyos = procesos().filter { $0.bundle.hasPrefix(prefijo) }
        if suyos.isEmpty {
            fallar("No encontré ninguna app que empiece con \(prefijo) entre las que usan audio. " +
                   "Si es Zoom, abrila y entrá a la reunión.", "sin-app")
        }
        deQuien = suyos.map { $0.bundle }
        descripcion = CATapDescription(stereoMixdownOfProcesses: suyos.map { $0.objeto })
    } else {
        // Sin procesos que excluir se graba todo, incluido lo que suene en la
        // propia app: quien llama manda su bundle en `--menos`.
        let nuestros = menos == nil ? [] : procesos().filter { $0.bundle.hasPrefix(menos!) }
        deQuien = ["(todo el sistema)"] + nuestros.map { "menos \($0.bundle)" }
        descripcion = CATapDescription(stereoGlobalTapButExcludeProcesses: nuestros.map { $0.objeto })
    }
    descripcion.name = "Note Taker"
    descripcion.isPrivate = true
    descripcion.muteBehavior = .unmuted

    var estado = AudioHardwareCreateProcessTap(descripcion, &tapID)
    guard estado == noErr else {
        fallar("macOS no dejó crear la escucha (\(estado)). Revisá Ajustes del Sistema → " +
               "Privacidad y seguridad → Grabación de audio del sistema.", "sin-permiso")
    }

    // Un tap solo no se puede leer: hay que colgarlo de un dispositivo
    // agregado. El de salida va como reloj, que es lo que hace que las
    // muestras lleguen a la velocidad a la que suenan.
    //
    // **`DefaultOutputDevice` y no `DefaultSystemOutputDevice`**, que son dos
    // cosas distintas y se parecen demasiado en el nombre. El segundo es el de
    // los sonidos de alerta del sistema; el primero, por donde suenan las
    // apps. Mientras coinciden no se nota, y en cuanto no —un monitor puesto
    // como salida de alertas, que es lo que tenía la Mac donde se probó esto—
    // el agregado queda colgado de un dispositivo por donde no pasa nada: el
    // tap se crea, `AudioDeviceStart` dice que sí, el ayudante dice «listo» y
    // no entrega UNA muestra. Silencio perfecto y sin un solo error.
    let salida = leerNumero(AudioObjectID(kAudioObjectSystemObject),
                            kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0)) ?? 0
    let uidSalida = leerTexto(salida, kAudioDevicePropertyDeviceUID) ?? ""
    let config: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Note Taker — escucha",
        kAudioAggregateDeviceUIDKey: "com.codigo.notetaker.escucha.\(UUID().uuidString)",
        kAudioAggregateDeviceMainSubDeviceKey: uidSalida,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        // **No es opcional, y lo aprendí probándolo.** En `false`,
        // `AudioDeviceStart` devuelve 'stop' (`kAudioHardwareNotRunningError`)
        // y no arranca nada. Lo puse en false para el tap global creyendo que
        // ahí convenía lo contrario —que no esperara a que algo sonara, porque
        // al abrir Preparar lo normal es el silencio— y lo que se consigue es
        // que no arranque nunca. El tap tiene que poder arrancar con el
        // dispositivo; entregar silencio mientras nadie suena ya lo hace solo.
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: uidSalida]],
        kAudioAggregateDeviceTapListKey: [[
            kAudioSubTapDriftCompensationKey: true,
            kAudioSubTapUIDKey: descripcion.uuid.uuidString
        ]]
    ]
    estado = AudioHardwareCreateAggregateDevice(config as CFDictionary, &agregadoID)
    guard estado == noErr else {
        soltar()
        fallar("No se pudo armar el dispositivo de escucha (\(estado)).", "sin-dispositivo")
    }

    var formato = AudioStreamBasicDescription()
    guard let leido = leerNumero(tapID, kAudioTapPropertyFormat, formato) else {
        soltar()
        fallar("No se pudo leer el formato del sonido.", "sin-formato")
    }
    formato = leido
    guard formato.mFormatID == kAudioFormatLinearPCM,
          formato.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          formato.mBitsPerChannel == 32 else {
        soltar()
        fallar("El sonido llega en un formato que no es coma flotante de 32 bits.", "formato-raro")
    }

    // Los avisos de Core Audio (la tasa cambió, la salida se fue) llegan acá.
    let cola = DispatchQueue(label: "notetaker.escucha")

    // **La tasa es la del dispositivo agregado, no la del tap.** El tap dice
    // 48 kHz, pero las muestras llegan al ritmo del reloj del agregado, que es
    // el de la salida del sistema. Con unos AirPods y Zoom usando su
    // micrófono, el Bluetooth pasa a modo llamada y la salida baja a 24 kHz:
    // llegaban 24.000 muestras por segundo rotuladas como 48.000, y el WAV
    // quedaba al doble de velocidad y con la mitad de la duración. Medido en
    // las sesiones de prueba del 29/09: 84,3 s de reloj, 42,1 s de audio.
    //
    // Y la tasa cambia sola a mitad de la clase (Zoom prende el micrófono y el
    // Bluetooth cambia de modo), así que se escucha el cambio y lo que sale de
    // acá es SIEMPRE 48 kHz, remuestreado desde la tasa de cada momento.
    tasaEntrada = leerNumero(agregadoID, kAudioDevicePropertyNominalSampleRate, Float64(0)) ?? 0
    if tasaEntrada <= 0 { tasaEntrada = formato.mSampleRate }
    var dirTasa = direccion(kAudioDevicePropertyNominalSampleRate)
    AudioObjectAddPropertyListenerBlock(agregadoID, &dirTasa, cola) { _, _ in
        if let t = leerNumero(agregadoID, kAudioDevicePropertyNominalSampleRate, Float64(0)), t > 0,
           t != tasaEntrada {
            tasaEntrada = t
            avisar(["tasa": t])
        }
    }

    // **Si la salida del sistema cambia o desaparece, el reloj del agregado se
    // va con ella** —los AirPods al estuche, sin batería, o que se pasan al
    // teléfono— y la escucha se queda callada con el proceso vivo, sin que nadie
    // se entere. Se sale con un código, y quien lanzó esto lo vuelve a abrir
    // sobre la salida nueva (`engine/audio-app.js`).
    let irse: () -> Void = {
        soltar()
        avisar(["error": "Cambió la salida de audio del sistema: la escucha se rearma sola.",
                "codigo": "salida-cambio"])
        exit(3)
    }
    var dirSalida = direccion(kAudioHardwarePropertyDefaultOutputDevice)
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &dirSalida, cola) { _, _ in
        let nueva = leerNumero(AudioObjectID(kAudioObjectSystemObject),
                               kAudioHardwarePropertyDefaultOutputDevice, AudioObjectID(0)) ?? 0
        if nueva != salida { irse() }
    }
    var dirViva = direccion(kAudioDevicePropertyDeviceIsAlive)
    AudioObjectAddPropertyListenerBlock(salida, &dirViva, cola) { _, _ in
        if (leerNumero(salida, kAudioDevicePropertyDeviceIsAlive, UInt32(1)) ?? 0) == 0 { irse() }
    }

    // Los canales del tap son los ÚLTIMOS del agregado. Delante van las
    // entradas del dispositivo de salida, si tiene: unos AirPods en modo
    // llamada traen su micrófono, y promediar todos los buffers metía la voz
    // de quien toma notas en la grabación de la clase.
    let canalesDelTap = max(1, Int(formato.mChannelsPerFrame))

    // Sin cola: el bloque corre en el hilo de audio y no espera a nadie. Todo lo
    // que hace es sumar, remuestrear a memoria reservada y dejarlo en el anillo.
    estado = AudioDeviceCreateIOProcIDWithBlock(&procID, agregadoID, nil) { _, entrada, _, _, _ in
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: entrada))
        var juntados = 0
        var desde = buffers.count
        while desde > 0 && juntados < canalesDelTap {
            desde -= 1
            juntados += Int(buffers[desde].mNumberChannels)
        }
        guard juntados > 0, desde < buffers.count else { return }
        let primero = buffers[desde]
        guard primero.mNumberChannels > 0 else { return }
        let cuadros = min(CAPACIDAD_TRABAJO,
                          Int(primero.mDataByteSize) / (4 * Int(primero.mNumberChannels)))
        guard cuadros > 0 else { return }

        // A mono: el promedio de los canales del tap. Sirve igual si el sonido
        // llega entrelazado (un buffer, dos canales) o separado (dos buffers,
        // uno cada uno), que son las dos formas en que Core Audio lo entrega.
        for f in 0..<cuadros {
            var suma: Float = 0
            for k in desde..<buffers.count {
                let b = buffers[k]
                guard let datos = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
                let nc = Int(b.mNumberChannels)
                for c in 0..<nc { suma += datos[f * nc + c] }
            }
            trabajoMono[f] = suma / Float(juntados)
        }
        let n = remuestrear(trabajoMono, cuadros, trabajoSalida, CAPACIDAD_TRABAJO * 8)
        if n > 0 { alAnillo(trabajoSalida, n) }
    }
    guard estado == noErr, let proc = procID else {
        soltar()
        fallar("No se pudo enganchar la lectura del sonido (\(estado)).", "sin-lectura")
    }

    apagarEntradasAjenas(agregadoID, proc, salida: salida)
    arrancarEscritor()

    estado = AudioDeviceStart(agregadoID, proc)
    guard estado == noErr else {
        soltar()
        fallar("No arrancó la escucha (\(estado)).", "no-arranca")
    }

    avisarListo([
        "sampleRate": TASA_DE_SALIDA,
        "tasaDelDispositivo": tasaEntrada,
        "canales": 1,
        "procesos": deQuien
    ])

    vigilarAlPadre()

    // Hasta que lo paren. SIGTERM es lo que manda quien lo lanzó al terminar
    // la sesión; SIGPIPE, que quien leía se fue (la app se cerró de golpe), y
    // en los dos casos se suelta todo antes de salir.
    for senal in [SIGTERM, SIGINT, SIGPIPE] {
        signal(senal, SIG_IGN)
        let fuente = DispatchSource.makeSignalSource(signal: senal, queue: .main)
        fuente.setEventHandler { soltar(); exit(0) }
        fuente.resume()
        _ = Unmanaged.passRetained(fuente)
    }
    dispatchMain()
}

// ─── Entrada ─────────────────────────────────────────────────────────────

let args = CommandLine.arguments
func valorDe(_ bandera: String) -> String? {
    guard let i = args.firstIndex(of: bandera), i + 1 < args.count else { return nil }
    return args[i + 1]
}

if args.contains("--listar") { listar() }
if let app = valorDe("--app") { escuchar(prefijo: app, menos: nil) }
if args.contains("--sistema") { escuchar(prefijo: nil, menos: valorDe("--menos")) }
fallar("Uso: escuchar-app --listar | --app <prefijo> | --sistema [--menos <prefijo>]", "uso")
