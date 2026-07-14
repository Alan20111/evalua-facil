#!/bin/bash
# Candado anti-regresión del sistema de diseño (docs/DESIGN_SYSTEM.md).
# Corre los mismos greps de cierre usados en docs/PLAN_UNIFICACION_MAIN.md
# para detectar si alguno de los patrones ya corregidos reaparece.
#
# Uso: npm run check:design
# Sale con código 1 si encuentra algo — útil para un hook/CI más adelante,
# pero hoy es solo una herramienta manual (no está enganchada a nada).

set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0

check() {
  local desc="$1" pattern="$2" extra_grep_args="${3:-}"
  # shellcheck disable=SC2086
  local matches
  matches=$(grep -rn $extra_grep_args "$pattern" --include="*.jsx" src/ 2>/dev/null)
  if [ -n "$matches" ]; then
    echo "❌ $desc"
    echo "$matches" | sed 's/^/   /'
    echo ""
    FAIL=1
  else
    echo "✅ $desc"
  fi
}

echo "=== Candado anti-regresión — docs/DESIGN_SYSTEM.md §10 ==="
echo ""

# bg-blue-600 fuera de Landing.jsx (excepción documentada: colores literales
# sin data-role activo, ver DESIGN_SYSTEM.md §10-#5 y el comentario en el código)
matches=$(grep -rln "bg-blue-600" --include="*.jsx" src/ 2>/dev/null | grep -v "pages/Landing.jsx")
if [ -n "$matches" ]; then
  echo "❌ Dialecto azul duro (bg-blue-600) fuera de tokens — DESIGN_SYSTEM.md §10-#1"
  echo "$matches" | sed 's/^/   /'
  echo ""
  FAIL=1
else
  echo "✅ Dialecto azul duro (bg-blue-600) fuera de tokens — DESIGN_SYSTEM.md §10-#1"
fi

check "focus:ring-2 sin focus-visible — DESIGN_SYSTEM.md §10-#19" 'focus:ring-2\b' '-E'
check "disabled:opacity fuera de 40/60 — DESIGN_SYSTEM.md §10-#20" 'disabled:opacity-(20|30|50)' '-E'
check "fontSize inline en píxeles crudos — DESIGN_SYSTEM.md §10 (Fase 1)" 'fontSize: [0-9]' '-E'
check "role=\"presentation\" (usar el patrón canónico de backdrop de §6.7)" 'role="presentation"'

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "⚠️  Se encontraron patrones ya corregidos anteriormente. Revisa docs/DESIGN_SYSTEM.md §6/§10 antes de continuar."
  exit 1
else
  echo "✅ Todo limpio — sin regresiones detectadas."
  exit 0
fi
