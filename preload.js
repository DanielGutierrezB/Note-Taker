'use strict';
/**
 * preload.js — La única puerta entre la ventana y el sistema.
 *
 * La ventana no tiene Node: pide cosas por acá y el proceso principal decide.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nt', {
    appInfo: () => ipcRenderer.invoke('app-info'),
    doctor: () => ipcRenderer.invoke('doctor'),
    dependenciasEstado: () => ipcRenderer.invoke('dependencias-estado'),
    dependenciasInstalar: clave => ipcRenderer.invoke('dependencias-instalar', clave),
    dependenciasCancelar: clave => ipcRenderer.invoke('dependencias-cancelar', clave),
    onDependenciasProgreso: callback => {
        ipcRenderer.on('dependencias-progreso', (event, p) => callback(p));
    },

    ajustesLeer: () => ipcRenderer.invoke('ajustes-leer'),
    ajustesGuardar: datos => ipcRenderer.invoke('ajustes-guardar', datos),
    carpetaRecordar: ruta => ipcRenderer.invoke('carpeta-recordar', ruta),
    carpetasEnDisco: rutas => ipcRenderer.invoke('carpetas-en-disco', rutas),

    updateCheck: () => ipcRenderer.invoke('update-check'),
    updateDownload: payload => ipcRenderer.invoke('update-download', payload),
    updateCancel: () => ipcRenderer.invoke('update-cancel'),
    updateInstall: target => ipcRenderer.invoke('update-install', target),

    pickFolder: opciones => ipcRenderer.invoke('pick-folder', opciones),
    confirmar: payload => ipcRenderer.invoke('confirmar', payload),
    reveal: target => ipcRenderer.invoke('reveal', target),
    openPath: target => ipcRenderer.invoke('open-path', target),

    // La grabación. El audio va por `send` y no por `invoke` porque llega varias
    // veces por segundo y no hay nada que esperar de vuelta: esperar una
    // respuesta por cada pedazo pondría el reloj de la captura a depender de lo
    // rápido que conteste el disco.
    grabarIniciar: payload => ipcRenderer.invoke('grabar-iniciar', payload),
    grabarReanudar: (json, payload) => ipcRenderer.invoke('grabar-reanudar', json, payload),
    grabarPcm: chunk => ipcRenderer.send('grabar-pcm', chunk),

    // El sonido de Zoom, que abre Node y no la ventana (`engine/audio-app.js`).
    audioAppEstado: () => ipcRenderer.invoke('audio-app-estado'),
    audioAppAbrir: como => ipcRenderer.invoke('audio-app-abrir', como),
    audioAppMandar: si => ipcRenderer.invoke('audio-app-mandar', si),
    audioAppCerrar: () => ipcRenderer.invoke('audio-app-cerrar'),
    onAudioApp: callback => {
        ipcRenderer.on('audio-app', (_event, payload) => callback(payload));
    },
    // Sin argumento, la claqueta cae donde llegó el audio. Con el `ms` de un
    // aviso `golpe`, cae en ESA palmada: es lo que deja que la K enganche la
    // palmada que la pastilla está señalando aunque ya haya pasado su ventana.
    grabarClaqueta: palmadaMs => ipcRenderer.invoke('grabar-claqueta', palmadaMs),
    grabarQuitarClaqueta: n => ipcRenderer.invoke('grabar-quitar-claqueta', n),
    grabarEditar: cambio => ipcRenderer.invoke('grabar-editar', cambio),
    grabarEditarGrabada: (json, cambio) => ipcRenderer.invoke('grabar-editar-grabada', json, cambio),
    // Abrir una clase ya grabada en la misma pantalla de la clase, de solo
    // mirar y ajustar: contesta el mismo estado con `grabando: false`.
    grabarAbrirGrabada: json => ipcRenderer.invoke('grabar-abrir-grabada', json),
    // Sin argumento, ahora. Con la hora de una palabra, el borde va ahí: es lo
    // que manda arrastrar el IN o el OUT sobre el texto.
    grabarAbrirToma: ms => ipcRenderer.invoke('grabar-abrir-toma', ms),
    grabarCerrarToma: ms => ipcRenderer.invoke('grabar-cerrar-toma', ms),
    grabarDeshacer: () => ipcRenderer.invoke('grabar-deshacer'),
    grabarRehacer: () => ipcRenderer.invoke('grabar-rehacer'),
    grabarEstado: () => ipcRenderer.invoke('grabar-estado'),
    grabarVistas: () => ipcRenderer.invoke('grabar-vistas'),
    grabarListar: dirs => ipcRenderer.invoke('grabar-listar', dirs),
    grabarNombreSiguiente: (dir, que) => ipcRenderer.invoke('grabar-nombre-siguiente', dir, que),
    grabarRenombrar: (json, cambio) => ipcRenderer.invoke('grabar-renombrar', json, cambio),
    grabarBorrar: json => ipcRenderer.invoke('grabar-borrar', json),
    grabarRegenerar: json => ipcRenderer.invoke('grabar-regenerar', json),
    grabarRehacerXml: json => ipcRenderer.invoke('grabar-rehacer-xml', json),
    grabarTerminar: () => ipcRenderer.invoke('grabar-terminar'),
    onGrabarAviso: callback => {
        ipcRenderer.on('grabar-aviso', (_event, payload) => callback(payload));
    },

    // El proyecto de Premiere de la carpeta (`ipc/prproj.js`): leer y guardar la
    // configuración del menú, y generar.
    prprojConfig: carpeta => ipcRenderer.invoke('prproj-config', carpeta),
    prprojGuardarConfig: (carpeta, config) => ipcRenderer.invoke('prproj-guardar-config', carpeta, config),
    prprojGenerar: (carpeta, config) => ipcRenderer.invoke('prproj-generar', carpeta, config),
    onPrprojAviso: callback => {
        ipcRenderer.on('prproj-aviso', (_event, payload) => callback(payload));
    },

    // El modo semanal (`ipc/semanal.js`): los dos vídeos mientras se graban, y
    // el corte al final. Los trozos van por `send` por lo mismo que el PCM, y
    // `empezoMs` lo pone la ventana porque es la que llama a `start()`: es la
    // hora que alinea el vídeo con el audio (ver `engine/video-crudo.js`).
    semanalAbrir: pedido => ipcRenderer.invoke('semanal-abrir', pedido),
    semanalTrozo: (cual, trozo) => ipcRenderer.send('semanal-trozo', cual, trozo),
    // Sin `cual` cierra los dos, que es terminar de grabar. Con uno cierra solo
    // esa fuente: es cambiar de ventana, que parte la pantalla en tramos y deja
    // la cámara andando.
    semanalCerrar: cual => ipcRenderer.invoke('semanal-cerrar', cual || null),
    // Devuelve RUTAS del disco, no `data:`. La ventana las resuelve contra su
    // propia página —que en la app es `file:`— y se las da a los dos `<video>`
    // del editor. Son dos vídeos de decenas de megas: meterlos por el puente
    // codificados no entra en un mensaje de IPC ni haría falta.
    semanalMontaje: json => ipcRenderer.invoke('semanal-montaje', json),
    semanalExportar: (json, como) => ipcRenderer.invoke('semanal-exportar', json, como),
    onSemanalProgreso: callback => {
        ipcRenderer.on('semanal-progreso', (_event, payload) => callback(payload));
    },
    onSemanalAviso: callback => {
        ipcRenderer.on('semanal-aviso', (_event, payload) => callback(payload));
    },

    // Las fotos del OUT (`ipc/referencias.js`). El JPEG cruza como bytes y las
    // imágenes vuelven como `data:`, que es lo único que la ventana puede
    // dibujar con su CSP.
    fotoGuardar: pedido => ipcRenderer.invoke('foto-guardar', pedido),
    fotosListar: (carpeta, secuencia) => ipcRenderer.invoke('fotos-listar', carpeta, secuencia),
    fotoAbrir: ruta => ipcRenderer.invoke('foto-abrir', ruta),
    fotoCopiar: ruta => ipcRenderer.invoke('foto-copiar', ruta),

    // El diario de la sesión. La ventana solo anota y pide el archivo: el
    // registro entero vive del lado de Node, para que las dos mitades queden en
    // un mismo orden y con un mismo reloj.
    anotar: (evento, datos) => ipcRenderer.invoke('registro-anotar', { evento, datos }),
    registroDescargar: () => ipcRenderer.invoke('registro-descargar'),

    onUpdateProgress: callback => {
        ipcRenderer.on('update-progress', (_event, payload) => callback(payload));
    },
    onUpdateReady: callback => {
        ipcRenderer.on('update-ready', (_event, payload) => callback(payload));
    }
});
