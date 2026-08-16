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

# Presupuesto/ratchet: para patrones con deuda YA existente y grande (decenas
# de casos), exigir 0 de golpe rompería el candado desde el primer commit —
# igual que pasó con disabled:opacity en la Fase 0. En vez de eso se congela
# el número de hoy: el candado deja pasar la deuda vieja pero bloquea que
# crezca. Bajar el número (arreglando casos) es progreso visible; para eso
# hay que editar el BASELINE de abajo a mano cuando se arregle algo — así el
# candado se aprieta con el tiempo en vez de acostumbrarse al numero alto.
# Ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1, paso 1.1.
ratchet() {
  local desc="$1" pattern="$2" baseline="$3" exclude="${4:-}" mode="${5:-occurrences}"
  local grep_flag="-rEo"
  [ "$mode" = "files" ] && grep_flag="-rlE"
  local count
  if [ -n "$exclude" ]; then
    count=$(grep $grep_flag "$pattern" --include="*.jsx" src/ 2>/dev/null | grep -vF "$exclude" | wc -l)
  else
    count=$(grep $grep_flag "$pattern" --include="*.jsx" src/ 2>/dev/null | wc -l)
  fi
  if [ "$count" -gt "$baseline" ]; then
    echo "❌ $desc — $count casos (presupuesto: $baseline). No agregues más sin arreglar de los viejos."
    FAIL=1
  elif [ "$count" -lt "$baseline" ]; then
    echo "✅ $desc — $count casos (¡bajó de $baseline! actualiza el BASELINE en scripts/check-ui-standards.sh para que el candado no se relaje)"
  else
    echo "✅ $desc — $count casos (presupuesto: $baseline, sin crecer)"
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
echo "=== Candados de accesibilidad — docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1 ==="
echo ""

# Cero tolerancia: ya se corrigió en la Fase 0 (arregla WCAG 1.4.4), no debe
# volver a aparecer. El patrón exige comilla después para no disparar con
# texto que simplemente MENCIONE "user-scalable=no" en un comentario.
if grep -q 'user-scalable=no"' index.html 2>/dev/null; then
  echo "❌ user-scalable=no en el viewport (bloquea pinch-zoom, WCAG 1.4.4) — index.html"
  FAIL=1
else
  echo "✅ user-scalable=no en el viewport (bloquea pinch-zoom, WCAG 1.4.4)"
fi

ratchet "Modales a mano (fixed inset-0 fuera de ui/Modal.jsx) — migrar a ui/Modal en Fase 3" \
  'fixed inset-0' 37 'components/ui/Modal.jsx' files
ratchet "h-screen (rompe con la barra de URL de Chrome Android, usar dvh) — Fase 5 paso 5.3" \
  '\bh-screen\b' 28
ratchet "vh crudo sin variante dvh/svh/lvh — Fase 5 paso 5.3" \
  '([0-9]+)(vh)\b' 59
# Presupuesto subido de 52 a 54 (Fase 2, paso 2.8): min-h-[44px]/min-w-[44px]
# en la variante icon de ui/Button.jsx son deliberados, no deuda — con
# html{font-size:90%} del proyecto, el equivalente en la escala rem de
# Tailwind (min-h-11) daría 39.6px reales, no los 44 que pide WCAG 2.5.8.
ratchet "Anchos/altos en píxeles duros (w-[Npx]/h-[Npx]) — evitar nuevos, usar tokens de layout.js" \
  '(min-)?[wh]-\[[0-9]+px\]' 54

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "⚠️  Se encontraron patrones ya corregidos anteriormente. Revisa docs/DESIGN_SYSTEM.md §6/§10 antes de continuar."
  exit 1
else
  echo "✅ Todo limpio — sin regresiones detectadas."
  exit 0
fi
