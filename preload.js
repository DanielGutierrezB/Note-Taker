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

    updateCheck: () => ipcRenderer.invoke('update-check'),
    updateDownload: payload => ipcRenderer.invoke('update-download', payload),
    updateInstall: target => ipcRenderer.invoke('update-install', target),

    pickFolder: opciones => ipcRenderer.invoke('pick-folder', opciones),
    confirmar: payload => ipcRenderer.invoke('confirmar', payload),
    preguntar: payload => ipcRenderer.invoke('preguntar', payload),
    reveal: target => ipcRenderer.invoke('reveal', target),

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
    grabarIdioma: (cual, opciones) => ipcRenderer.invoke('grabar-idioma', cual, opciones),
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
    prprojGenerar: (carpeta, config) => ipcRenderer.invoke('prproj-generar', carpeta, config),
    onPrprojAviso: callback => {
        ipcRenderer.on('prproj-aviso', (_event, payload) => callback(payload));
    },

    // Las fotos del OUT (`ipc/referencias.js`). El JPEG cruza como bytes y las
    // imágenes vuelven como `data:`, que es lo único que la ventana puede
    // dibujar con su CSP.
    fotoGuardar: pedido => ipcRenderer.invoke('foto-guardar', pedido),
    fotosListar: (carpeta, secuencia) => ipcRenderer.invoke('fotos-listar', carpeta, secuencia),
    fotoAbrir: ruta => ipcRenderer.invoke('foto-abrir', ruta),
    fotoCopiar: ruta => ipcRenderer.invoke('foto-copiar', ruta),

    // El diario de la sesión. La ventana solo anota y pide el reporte: el
    // registro entero vive del lado de Node, para que las dos mitades queden en
    // un mismo orden y con un mismo reloj.
    anotar: (evento, datos) => ipcRenderer.invoke('registro-anotar', { evento, datos }),
    // El botón «Report»: un .zip en Descargas con el diario y lo que hace falta
    // para entender un problema (`ipc/reporte.js`). La ventana manda lo que solo
    // ella ve: los micrófonos, las cámaras y en qué pantalla está.
    reporteArmar: ventana => ipcRenderer.invoke('reporte-armar', ventana),

    onUpdateProgress: callback => {
        ipcRenderer.on('update-progress', (_event, payload) => callback(payload));
    },
    onUpdateReady: callback => {
        ipcRenderer.on('update-ready', (_event, payload) => callback(payload));
    }
});
