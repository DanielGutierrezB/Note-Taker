#!/bin/bash
#
# tools/build-pkg.sh — Arma el instalador de una versión.
#
#   NoteTaker-<v>-arm64.pkg              la app, ~150 MB   el que se publica
#   NoteTaker-<v>-arm64-con-modelos.pkg  app + modelos     solo con --con-modelos
#
# El que se publica NO lleva los modelos de Whisper. Pesan más de dos gigas, que
# es el tope de un archivo en un release de GitHub, y además no hace falta: la
# app se da cuenta al abrir de que faltan y los baja con un botón, a la carpeta
# del usuario y verificados contra su huella (`engine/dependencias.js`). El
# mismo instalador sirve para una Mac nueva y para actualizar, porque reemplaza
# la app y no toca los modelos.
#
# El que lleva los modelos es para pasar a mano a una Mac sin buena conexión:
# la app a /Applications y los modelos a /Library/Application Support/Note Taker,
# que es donde `engine/paths.js` los busca primero.
#
#   bash tools/build-pkg.sh
#   bash tools/build-pkg.sh --con-modelos
#
set -euo pipefail

cd "$(dirname "$0")/.."

CON_MODELOS=0
[ "${1:-}" = "--con-modelos" ] && CON_MODELOS=1

VERSION=$(node -p "require('./package.json').version")
IDENT=$(node -p "require('./package.json').build.appId")
APP_NAME="Note Taker"
DATA_DIR="/Library/Application Support/${APP_NAME}"
OUT="dist"
STAGE="$OUT/pkg-stage"

echo "Note Taker ${VERSION}"

# La app reporta la de `version.json` y el instalador se llama con la de
# `package.json`. Si no son la misma, la app se compara contra los releases con
# un número que no es el suyo: o no ve una actualización que existe, o se ofrece
# a sí misma para siempre.
REPORTADA=$(node -p "require('./version.json').version")
if [ "$REPORTADA" != "$VERSION" ]; then
    echo "version.json dice ${REPORTADA} y package.json ${VERSION}. Igualalos antes de compilar."
    exit 1
fi

for tool in pkgbuild productbuild; do
    command -v "$tool" >/dev/null || { echo "Falta $tool (viene con las Command Line Tools)."; exit 1; }
done

# ── 1. La app ────────────────────────────────────────────────────────
# `--dir` deja el .app sin empaquetar: el empaquetado lo hacemos acá abajo,
# porque el target `pkg` de electron-builder solo sabe armar un componente y
# necesitamos dos.
echo "→ compilando la app"
npx electron-builder --mac --dir

APP="$OUT/mac-arm64/${APP_NAME}.app"
[ -d "$APP" ] || { echo "No quedó el .app en $APP"; exit 1; }

# Los modelos no viajan dentro de la app. En desarrollo `bin/mac/models` suele
# ser un enlace a la carpeta de otra app, y adentro del .app llegaba colgado a la
# Mac donde se instala; peor, en ESTA Mac apuntaba a modelos de verdad, y una app
# instalada acá nunca mostraba el aviso de que faltan.
rm -rf "$APP/Contents/Resources/bin/models"

# Sin certificado de Apple la firma es ad-hoc. Alcanza para que macOS la deje
# correr después del primer "Abrir igual", y es lo que hay hasta que exista un
# Developer ID.
echo "→ firmando ad-hoc"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

rm -rf "$STAGE"
mkdir -p "$STAGE"

if [ "$CON_MODELOS" = 1 ]; then
# ── 2. Los modelos ───────────────────────────────────────────────────
MODELS="bin/mac/models"
[ -d "$MODELS" ] || { echo "Faltan los modelos de Whisper: corré tools/bundle-binaries.sh"; exit 1; }

mkdir -p "$STAGE/payload"
echo "→ juntando los modelos"
# `ditto` y no `cp`: sin `--norsrc` cada archivo viaja con un `._` al lado, que
# son 16 archivos de basura dentro de un instalador de 3.8 GB.
ditto --norsrc --noextattr --noacl "$MODELS" "$STAGE/payload/models"

# Al payload van archivos y nada más.
#
# `ditto` preserva los enlaces simbólicos, y en desarrollo la carpeta de modelos
# suele SER uno: `bin/mac/models` apunta a los de otra app para no tener dos
# copias de un giga y medio en el disco. Acá resuelve, y por eso no se ve como
# basura al compilar; dentro de un `.pkg` sí lo es, porque esa ruta no existe en
# la máquina donde se instala y lo que llega es un enlace colgado.
#
# Seguirlo tampoco es la salida: sumaría 2,9 GB al instalador para traer el
# modelo que `large-v3-turbo` ya reemplaza —misma calidad y varias veces más
# rápido, ver `MODEL_PREFERENCE` en `engine/paths.js`—, y el editor descargaría
# esos gigas para nada.
#
# Así que se quitan del payload, y se dice cuáles: el enlace que aparezca mañana
# en la carpeta de modelos tiene que verse en el registro de la compilación en vez
# de viajar callado. La carpeta del repo no se toca — ahí el enlace sirve, y
# `modelosInstalados` lo pesa con `statSync` para tener a mano el escalón de
# arriba.
colgados=$(find "$STAGE/payload" -type l)
if [ -n "$colgados" ]; then
    echo "→ enlaces que NO viajan (su destino no existe donde se instala):"
    while IFS= read -r enlace; do
        echo "    $(basename "$enlace") → $(readlink "$enlace")"
    done <<< "$colgados"
    find "$STAGE/payload" -type l -delete
fi

# Qué modelos viajan, uno por uno, leídos del payload ya armado y no de la
# carpeta de origen: así el inventario es lo que entra al instalador, con los
# enlaces ya descontados.
#
# El total no alcanza para decidir nada, y acá hay algo que decidir: los modelos
# son casi todo el instalador, así que agregar o sacar uno se ve en el número que
# el editor descarga. El que más fácil se saca por parecer un extra es
# `ggml-small.bin`, y es justo el que no conviene sacar: le da a CUALQUIER máquina
# las dos cosas que esta Mac no tuvo hasta que se bajó —el modelo del ciclo de
# señales y el escalón al que bajar si el sistema se lleva al grande en medio de
# una toma (`engine/insistir.js`)—. Sin él el instalador pesa menos y la toma que
# se pierda no se puede recuperar hasta después de la clase.
echo "→ lo que viaja ($(du -shc "$STAGE/payload"/* | tail -1 | cut -f1)):"
for m in "$STAGE/payload/models"/*; do
    [ -e "$m" ] || continue
    echo "    $(du -sh "$m" | cut -f1)  $(basename "$m")"
done

fi

# ── 3. Los componentes ───────────────────────────────────────────────
echo "→ armando los componentes"
pkgbuild --quiet \
    --component "$APP" \
    --install-location "/Applications" \
    --identifier "${IDENT}" \
    --version "$VERSION" \
    "$STAGE/app.pkg"

if [ "$CON_MODELOS" = 1 ]; then
    pkgbuild --quiet \
        --root "$STAGE/payload" \
        --install-location "$DATA_DIR" \
        --identifier "${IDENT}.models" \
        --version "$VERSION" \
        "$STAGE/models.pkg"
fi

# ── 4. Los instaladores ──────────────────────────────────────────────
distribution() {
    local title="$1"; shift
    {
        echo '<?xml version="1.0" encoding="utf-8"?>'
        echo '<installer-gui-script minSpecVersion="2">'
        echo "  <title>${title}</title>"
        echo '  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>'
        echo '  <volume-check><allowed-os-versions><os-version min="11.0"/></allowed-os-versions></volume-check>'
        echo '  <choices-outline>'
        for pkg in "$@"; do echo "    <line choice=\"${pkg}\"/>"; done
        echo '  </choices-outline>'
        for pkg in "$@"; do
            echo "  <choice id=\"${pkg}\" visible=\"false\"><pkg-ref id=\"${pkg}\"/></choice>"
            echo "  <pkg-ref id=\"${pkg}\">${pkg}.pkg</pkg-ref>"
        done
        echo '</installer-gui-script>'
    }
}

echo "→ instalador"
distribution "${APP_NAME} ${VERSION}" app > "$STAGE/app.dist"
productbuild --distribution "$STAGE/app.dist" --package-path "$STAGE" \
    "$OUT/NoteTaker-${VERSION}-arm64.pkg"
HECHOS=("$OUT/NoteTaker-${VERSION}-arm64.pkg")

if [ "$CON_MODELOS" = 1 ]; then
    echo "→ instalador con modelos"
    distribution "${APP_NAME} ${VERSION}" app models > "$STAGE/full.dist"
    productbuild --distribution "$STAGE/full.dist" --package-path "$STAGE" \
        "$OUT/NoteTaker-${VERSION}-arm64-con-modelos.pkg"
    HECHOS+=("$OUT/NoteTaker-${VERSION}-arm64-con-modelos.pkg")
fi

rm -rf "$STAGE"

echo ""
echo "Listo:"
for f in "${HECHOS[@]}"; do
    echo "  $(du -h "$f" | cut -f1)  $f"
done
echo ""
echo "Para publicarlo: bash tools/publish-release.sh"
