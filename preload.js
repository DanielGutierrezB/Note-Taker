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
    audioAppAbrir: () => ipcRenderer.invoke('audio-app-abrir'),
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
    // Sin argumento, ahora. Con la hora de una palabra, el borde va ahí: es lo
    // que manda arrastrar el IN o el OUT sobre el texto.
    grabarAbrirToma: ms => ipcRenderer.invoke('grabar-abrir-toma', ms),
    grabarCerrarToma: ms => ipcRenderer.invoke('grabar-cerrar-toma', ms),
    grabarDeshacer: () => ipcRenderer.invoke('grabar-deshacer'),
    grabarRehacer: () => ipcRenderer.invoke('grabar-rehacer'),
    grabarEstado: () => ipcRenderer.invoke('grabar-estado'),
    grabarVistas: () => ipcRenderer.invoke('grabar-vistas'),
    grabarListar: dirs => ipcRenderer.invoke('grabar-listar', dirs),
    grabarRenombrar: (json, cambio) => ipcRenderer.invoke('grabar-renombrar', json, cambio),
    grabarBorrar: json => ipcRenderer.invoke('grabar-borrar', json),
    grabarRegenerar: json => ipcRenderer.invoke('grabar-regenerar', json),
    grabarRehacerXml: json => ipcRenderer.invoke('grabar-rehacer-xml', json),
    grabarTerminar: () => ipcRenderer.invoke('grabar-terminar'),
    onGrabarAviso: callback => {
        ipcRenderer.on('grabar-aviso', (_event, payload) => callback(payload));
    },

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
