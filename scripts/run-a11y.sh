#!/bin/bash
set -euo pipefail

# Script para ejecutar tests de accesibilidad (WCAG 2.1 AA) con Axe CLI
# contra cada story publicada en Storybook.

STORYBOOK_URL="${STORYBOOK_URL:-http://localhost:6006}"
BUILD_DIR="storybook-static"
REPORT_FILE="a11y-results.json"

echo "🔍 Iniciando validación de accesibilidad WCAG 2.1 AA..."
echo ""

# 1. Si Storybook no está corriendo, usa el build estático (más rápido y reproducible en CI)
if ! curl -s -o /dev/null "$STORYBOOK_URL"; then
  echo "⏳ Storybook no está corriendo en $STORYBOOK_URL — usando build estático..."
  if [ ! -d "$BUILD_DIR" ]; then
    npm run storybook:build
  fi
  npx http-server "$BUILD_DIR" -p 6007 -s &
  HTTP_SERVER_PID=$!
  trap 'kill $HTTP_SERVER_PID 2>/dev/null || true' EXIT
  STORYBOOK_URL="http://localhost:6007"
  npx wait-on "$STORYBOOK_URL" --timeout 60000
fi

# 2. Extrae todos los story IDs del índice de Storybook
INDEX_URL="$STORYBOOK_URL/index.json"
echo "📖 Leyendo índice de stories desde $INDEX_URL ..."
STORY_IDS=$(curl -s "$INDEX_URL" | jq -r '.entries | to_entries[] | select(.value.type == "story") | .key')

if [ -z "$STORY_IDS" ]; then
  echo "❌ No se encontraron stories en el índice."
  exit 1
fi

echo "🧪 Ejecutando Axe CLI sobre $(echo "$STORY_IDS" | wc -l | tr -d ' ') stories..."
echo ""

URLS=()
for id in $STORY_IDS; do
  URLS+=("$STORYBOOK_URL/iframe.html?id=$id&viewMode=story")
done

# 3. Corre Axe con reglas WCAG 2.0 A/AA + 2.1 AA + buenas prácticas.
# Se deshabilitan 3 reglas de "documento completo" (landmark-one-main,
# page-has-heading-one, region): cada story de Storybook se renderiza
# aislada sin <main>/<h1> de página — eso lo aporta la app real que la
# consume. Auditar eso aquí solo generaría ruido, no bugs reales.
set +e
npx axe "${URLS[@]}" \
  --tags wcag2a,wcag2aa,wcag21aa,best-practice \
  --disable landmark-one-main,page-has-heading-one,region \
  --save "$REPORT_FILE" \
  --exit
RESULT=$?
set -e

echo ""
if [ $RESULT -eq 0 ]; then
  echo "✅ Todas las pruebas de accesibilidad pasaron"
else
  echo "❌ Se encontraron problemas de accesibilidad — ver $REPORT_FILE"
  if [ -f "$REPORT_FILE" ]; then
    jq -r '.[] | select(.violations | length > 0) | "\n\(.url):\n" + (.violations[] | "  - [\(.impact // "n/a")] \(.id): \(.help)")' "$REPORT_FILE" 2>/dev/null || cat "$REPORT_FILE"
  fi
fi

exit $RESULT
