#!/bin/bash
#
# tools/atajo-dev.sh — Deja en el Escritorio un atajo para abrir la app en
# desarrollo con doble clic.
#
#   bash tools/atajo-dev.sh
#   bash tools/atajo-dev.sh --donde ~/Applications
#
# Es un `.app` de verdad y no un archivo `.command`, y la diferencia importa:
# el `.command` abre una ventana de Terminal que se queda ahí mientras la app
# corre, y cerrarla mata la grabación. Un `.app` no abre nada: doble clic y
# aparece la ventana, como cualquier programa.
#
# **Esto NO es la app empaquetada.** Es un atalajo al árbol de desarrollo: abre
# el código que está en esta carpeta, con los cambios sin compilar y sin
# firmar. Si se mueve o se borra el repo, el atajo deja de andar y lo dice.
# La app de verdad la arma `tools/build-pkg.sh`.
#
set -euo pipefail

cd "$(dirname "$0")/.."
RAIZ="$PWD"

DONDE="$HOME/Desktop"
if [ "${1:-}" = "--donde" ]; then DONDE="${2:?falta la carpeta}"; fi

NOMBRE="Note Taker (Dev)"
APP="$DONDE/$NOMBRE.app"
ELECTRON="$RAIZ/node_modules/.bin/electron"

if [ ! -x "$ELECTRON" ]; then
    echo "No está Electron en node_modules. Corré: npm install"
    exit 1
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ── El lanzador ──────────────────────────────────────────────────────
#
# La ruta del repo se congela acá, al crear el atajo, y no se busca en tiempo
# de ejecución: un atajo que "encuentra" el repo solo es un atajo que un día
# abre otra copia. Si la carpeta se movió, esto lo dice en vez de fallar en
# silencio.
#
# La salida va a un log y no se tira: cuando algo no arranca, el doble clic no
# deja NADA a la vista —no hay Terminal donde mirar— y sin el archivo la única
# pista sería que no pasó nada. Si Electron sale mal, se ofrece abrirlo.
cat > "$APP/Contents/MacOS/note-taker-dev" <<LANZADOR
#!/bin/bash
RAIZ="$RAIZ"
LOG="\$HOME/Library/Logs/note-taker-dev.log"
mkdir -p "\$(dirname "\$LOG")"

aviso() {
    /usr/bin/osascript -e "display alert \"Note Taker (Dev)\" message \"\$1\" buttons {\"Ver el registro\", \"Cerrar\"} default button \"Cerrar\"" \\
        | grep -q "Ver el registro" && /usr/bin/open -a Console "\$LOG"
    exit 1
}

[ -d "\$RAIZ" ] || aviso "La carpeta del proyecto ya no está en \$RAIZ. Volvé a correr tools/atajo-dev.sh desde donde esté ahora."
[ -x "\$RAIZ/node_modules/.bin/electron" ] || aviso "Falta Electron en node_modules. Corré npm install en \$RAIZ."

cd "\$RAIZ"
{
    echo ""
    echo "── \$(date '+%Y-%m-%d %H:%M:%S') ──"
} >> "\$LOG"

"\$RAIZ/node_modules/.bin/electron" . --dev >> "\$LOG" 2>&1
CODIGO=\$?
# 0 es cerrar la ventana y 143 es un SIGTERM (macOS al apagar). Los dos son
# salidas normales y no tienen por qué avisar nada.
[ \$CODIGO -eq 0 ] || [ \$CODIGO -eq 143 ] || aviso "La app se cerró con el código \$CODIGO. El registro dice por qué."
LANZADOR
chmod +x "$APP/Contents/MacOS/note-taker-dev"

# ── La ficha ─────────────────────────────────────────────────────────
#
# Los dos usos de micrófono y cámara van acá además de en `package.json`:
# corriendo así, la app que macOS ve es ESTE bundle, y sin los dos textos el
# sistema niega el permiso sin preguntar y el medidor de nivel se queda en cero
# sin decir por qué.
#
# El identificador lleva `.dev` a propósito: con el mismo que la app
# empaquetada, los permisos y las preferencias de las dos se pisarían.
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>Note Taker (Dev)</string>
    <key>CFBundleDisplayName</key>     <string>Note Taker (Dev)</string>
    <key>CFBundleExecutable</key>      <string>note-taker-dev</string>
    <key>CFBundleIdentifier</key>      <string>com.codigo.notetaker.dev</string>
    <key>CFBundleIconFile</key>        <string>icon</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>dev</string>
    <key>LSMinimumSystemVersion</key>  <string>11.0</string>
    <key>NSHighResolutionCapable</key> <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Note Taker escucha la entrada de audio de la clase para medir el nivel y para reconocer el conteo y la pausa mientras se toman las notas.</string>
    <key>NSCameraUsageDescription</key>
    <string>Note Taker muestra en pantalla lo que está entrando por una cámara, para ver qué se está filmando mientras se toman las notas. Ese video no se graba ni se guarda.</string>
</dict>
</plist>
PLIST

[ -f build/icon.icns ] || node tools/hacer-icono.js > /dev/null
cp build/icon.icns "$APP/Contents/Resources/icon.icns"

# Firma ad-hoc. Sin ella macOS trata al bundle como un binario suelto y no le
# da acceso al micrófono, que es justo lo que esto tiene que poder probar.
codesign --force --sign - "$APP" 2>/dev/null || true

# Y se le avisa al Finder, que si no muestra el icono genérico hasta que
# alguien toque la carpeta.
touch "$APP"
/usr/bin/killall -u "$USER" Finder 2>/dev/null || true

echo "$APP"
echo ""
echo "Doble clic y abre la app con el código de $RAIZ."
echo "El registro queda en ~/Library/Logs/note-taker-dev.log"
