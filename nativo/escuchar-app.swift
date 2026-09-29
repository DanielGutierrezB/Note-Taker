// escuchar-app — El sonido de UNA app, sin drivers.
//
//   escuchar-app --listar                 qué apps están sonando, en JSON
//   escuchar-app --app us.zoom            PCM mono de 16 bits por stdout
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

/// La tasa a la que llegan las muestras ahora. La cambia el aviso de Core Audio
/// desde la misma cola que las lee, así que no hay carrera.
var tasaEntrada: Double = 48000

/// Dónde cae la próxima muestra de salida, medido en muestras de entrada desde
/// el principio del buffer que viene (-1 es la última del anterior).
var fase: Double = 0
var previa: Float = 0

/// Interpolación lineal entre buffers seguidos. Para voz alcanza, y en el caso
/// que existe esto —de 24 a 48 kHz— solo agrega muestras: no hay nada que
/// filtrar para no mezclar agudos.
func remuestrear(_ x: [Float]) -> [Int16] {
    let n = x.count
    guard n > 0 else { return [] }
    let paso = tasaEntrada / TASA_DE_SALIDA
    var salida: [Int16] = []
    salida.reserveCapacity(Int(Double(n) / paso) + 2)
    var p = fase
    // Estrictamente antes de la última: esa es la `previa` del buffer que viene,
    // y leer `x[i + 1]` con `i == n - 1` sería salirse.
    while p < Double(n - 1) {
        let i = Int(p.rounded(.down))
        let f = Float(p - Double(i))
        let a = i < 0 ? previa : x[i]
        let b = x[i + 1]
        let v = max(-1, min(1, a + (b - a) * f))
        salida.append(Int16(v * 32767))
        p += paso
    }
    fase = p - Double(n)
    previa = x[n - 1]
    return salida
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

func escuchar(prefijo: String) -> Never {
    guard #available(macOS 14.2, *) else {
        fallar("Esta Mac tiene un macOS anterior a 14.2, que no sabe escuchar una app sola.", "no-soportado")
    }

    let suyos = procesos().filter { $0.bundle.hasPrefix(prefijo) }
    if suyos.isEmpty {
        fallar("No encontré ninguna app que empiece con \(prefijo) entre las que usan audio. " +
               "Si es Zoom, abrila y entrá a la reunión.", "sin-app")
    }

    // Una copia del sonido de ESOS procesos, mezclada a estéreo, que no le
    // saca nada a nadie: `unmuted` es lo que hace que quien toma notas lo siga
    // escuchando en sus auriculares.
    let descripcion = CATapDescription(stereoMixdownOfProcesses: suyos.map { $0.objeto })
    descripcion.name = "Note Taker"
    descripcion.isPrivate = true
    descripcion.muteBehavior = .unmuted

    var estado = AudioHardwareCreateProcessTap(descripcion, &tapID)
    guard estado == noErr else {
        fallar("macOS no dejó crear la escucha (\(estado)). Revisá Ajustes del Sistema → " +
               "Privacidad y seguridad → Grabación de audio del sistema.", "sin-permiso")
    }

    // Un tap solo no se puede leer: hay que colgarlo de un dispositivo
    // agregado. El de salida del sistema va como reloj, que es lo que hace
    // que las muestras lleguen a la velocidad a la que suenan.
    let salida = leerNumero(AudioObjectID(kAudioObjectSystemObject),
                            kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)) ?? 0
    let uidSalida = leerTexto(salida, kAudioDevicePropertyDeviceUID) ?? ""
    let config: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Note Taker — escucha",
        kAudioAggregateDeviceUIDKey: "com.codigo.notetaker.escucha.\(UUID().uuidString)",
        kAudioAggregateDeviceMainSubDeviceKey: uidSalida,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
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

    // Se escribe desde una cola serie y no desde el hilo de audio: escribir un
    // pipe puede bloquear si quien lee se atrasa, y bloquear el hilo de audio
    // es perder muestras. Con la cola, el que espera es este proceso.
    let cola = DispatchQueue(label: "notetaker.escucha")
    let salidaPCM = FileHandle.standardOutput

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
        if let t = leerNumero(agregadoID, kAudioDevicePropertyNominalSampleRate, Float64(0)), t > 0 {
            tasaEntrada = t
        }
    }

    // Los canales del tap son los ÚLTIMOS del agregado. Delante van las
    // entradas del dispositivo de salida, si tiene: unos AirPods en modo
    // llamada traen su micrófono, y promediar todos los buffers metía la voz
    // de quien toma notas en la grabación de la clase.
    let canalesDelTap = max(1, Int(formato.mChannelsPerFrame))

    estado = AudioDeviceCreateIOProcIDWithBlock(&procID, agregadoID, cola) { _, entrada, _, _, _ in
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: entrada))
        var delTap: [AudioBuffer] = []
        var juntados = 0
        for b in buffers.reversed() where juntados < canalesDelTap && b.mNumberChannels > 0 {
            delTap.insert(b, at: 0)
            juntados += Int(b.mNumberChannels)
        }
        guard let primero = delTap.first else { return }
        let cuadros = Int(primero.mDataByteSize) / (4 * Int(primero.mNumberChannels))
        guard cuadros > 0 else { return }

        // A mono: el promedio de los canales del tap. Sirve igual si el sonido
        // llega entrelazado (un buffer, dos canales) o separado (dos buffers,
        // uno cada uno), que son las dos formas en que Core Audio lo entrega.
        var mono = [Float](repeating: 0, count: cuadros)
        for f in 0..<cuadros {
            var suma: Float = 0
            for b in delTap {
                guard let datos = b.mData?.assumingMemoryBound(to: Float.self) else { continue }
                let nc = Int(b.mNumberChannels)
                for c in 0..<nc { suma += datos[f * nc + c] }
            }
            mono[f] = suma / Float(juntados)
        }
        let salida = remuestrear(mono)
        if !salida.isEmpty { salida.withUnsafeBufferPointer { salidaPCM.write(Data(buffer: $0)) } }
    }
    guard estado == noErr, let proc = procID else {
        soltar()
        fallar("No se pudo enganchar la lectura del sonido (\(estado)).", "sin-lectura")
    }

    estado = AudioDeviceStart(agregadoID, proc)
    guard estado == noErr else {
        soltar()
        fallar("No arrancó la escucha (\(estado)).", "no-arranca")
    }

    avisarListo([
        "sampleRate": TASA_DE_SALIDA,
        "tasaDelDispositivo": tasaEntrada,
        "canales": 1,
        "procesos": suyos.map { $0.bundle }
    ])

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
if args.contains("--listar") { listar() }
if let i = args.firstIndex(of: "--app"), i + 1 < args.count {
    escuchar(prefijo: args[i + 1])
}
fallar("Uso: escuchar-app --listar | --app <prefijo del bundle>", "uso")
