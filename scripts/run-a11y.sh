#!/bin/bash

# Script para ejecutar tests de accesibilidad con Axe

echo "🔍 Iniciando validación de accesibilidad WCAG 2.1 AA..."
echo ""

# Esperar a que Storybook esté listo
echo "⏳ Esperando a Storybook..."
npx wait-on http://localhost:6006 --timeout 120000

# Ejecutar Axe
echo "🧪 Ejecutando Axe CLI..."
npx axe http://localhost:6006 \
  --standard WCAG2AA \
  --tags best-practice,wcag2aa,wcag2a \
  --exit \
  --reporter json > a11y-results.json

RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "✅ Todas las pruebas de accesibilidad pasaron"
else
  echo "❌ Se encontraron problemas de accesibilidad"
  cat a11y-results.json | jq '.violations[] | {id: .id, description: .description, nodes: (.nodes | length)}'
fi

exit $RESULT
