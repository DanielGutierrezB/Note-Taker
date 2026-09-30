#!/bin/bash
#
# tools/subir-version.sh — Sube la versión, arma el instalador y lo publica.
#
#   bash tools/subir-version.sh 0.1.1 notas/0.1.1.md
#   bash tools/subir-version.sh 0.1.1            # sin notas escritas
#
# Existe porque una versión se publica en cuatro pasos y el que se olvida no se
# nota hasta que alguien no recibe la actualización:
#
#   1. `package.json` y `version.json` con el MISMO número. La app reporta el de
#      `version.json` y el instalador se llama con el de `package.json`: si no
#      coinciden, la app se compara contra los releases con un número que no es
#      el suyo y se ofrece a sí misma para siempre (`build-pkg.sh` lo comprueba).
#   2. Los binarios adentro de la app (`bundle-binaries.sh`), si cambió alguno.
#   3. El `.pkg`.
#   4. El release, que es lo que el botón «Actualizar» consulta.
#
# Lo que NO hace: commitear. El commit y el push los hace quien esto llama, que
# es quien sabe qué entra en la versión.
#
set -euo pipefail

cd "$(dirname "$0")/.."

NUEVA="${1:-}"
NOTAS="${2:-}"

if ! [[ "$NUEVA" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Uso: bash tools/subir-version.sh <x.y.z> [notas.md]"
    exit 1
fi
if [ -n "$NOTAS" ] && [ ! -f "$NOTAS" ]; then
    echo "No existe el archivo de notas: $NOTAS"
    exit 1
fi

ANTES=$(node -p "require('./package.json').version")
if [ "$(node -p "require('./engine/updates').compare('$NUEVA', '$ANTES')")" != "1" ]; then
    echo "La $NUEVA no es posterior a la $ANTES: la app no la vería como nueva."
    exit 1
fi

echo "Note Taker ${ANTES} → ${NUEVA}"

# Los dos archivos a la vez, con node y no con sed: así el JSON queda válido
# aunque el formato cambie.
node -e "
const fs = require('fs');
for (const f of ['package.json', 'version.json']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.version = '$NUEVA';
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
"
echo "→ package.json y version.json en ${NUEVA}"

bash tools/build-pkg.sh

if [ -n "$NOTAS" ]; then
    bash tools/publish-release.sh "$NOTAS"
else
    bash tools/publish-release.sh
fi

echo ""
echo "Publicada la ${NUEVA}. Las apps instaladas la van a ver en la próxima"
echo "comprobación (al abrir, y cada media hora)."
echo "Falta commitear el cambio de versión."
