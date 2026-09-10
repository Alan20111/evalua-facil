#!/usr/bin/env bash
#
# Carga ANTHROPIC_API_KEY_PROD en GCP Secret Manager SIN pasar por el prompt
# interactivo de firebase-tools.
#
# Por qué existe (incidente 9-sep-2026, tres intentos fallidos seguidos):
# pegar la clave en el prompt enmascarado de `firebase functions:secrets:set`
# desde una consola de Windows guarda UN SOLO CARÁCTER y el CLI responde
# "Created a new secret version" igual que si hubiera ido bien. No hay error,
# no hay aviso, y el fallo solo aparece en producción horas después.
#
# Comprobado el 9-sep-2026 contra un secreto de prueba desechable:
#   --data-file  → 68 caracteres entran, 68 salen  ✅
#   stdin (pipe) → 68 caracteres entran, 68 salen  ✅
#   pegar en el prompt TTY → 1 carácter            ❌  ← lo que pasó
#
# Uso:
#   1. Guardar la clave (y nada más) en el archivo indicado por ORIGEN.
#   2. bash scripts/cargar-clave-anthropic.sh
#
# El script nunca imprime la clave: solo su longitud.
set -euo pipefail

ORIGEN="${1:-/c/Users/Kike/anthropic-key.txt}"
LIMPIO="$(mktemp)"
trap 'rm -f "$LIMPIO"' EXIT

if [ ! -f "$ORIGEN" ]; then
  echo "FALTA: no existe $ORIGEN"
  exit 1
fi

# Saneado defensivo: BOM de UTF-8 (el Bloc de notas lo añade si se elige
# "UTF-8 con BOM"), CR de Windows, LF y espacios de los extremos. Se escribe
# SIN salto de línea final, que es lo que undici rechaza en la cabecera.
CLAVE="$(sed -e '1s/^\xEF\xBB\xBF//' "$ORIGEN" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

# Misma forma que valida claveAnthropic() en functions/ia.js — si no cumple,
# NO se sube nada. Un rechazo ruidoso aquí vale más que un secreto corrupto.
if ! printf '%s' "$CLAVE" | grep -qE '^sk-ant-[!-~]{20,}$'; then
  echo "FORMA INVÁLIDA: ${#CLAVE} caracteres, no cumple ^sk-ant-[!-~]{20,}$"
  echo "No se cargó nada. Revisa que el archivo tenga la clave completa."
  exit 1
fi
echo "Forma OK: ${#CLAVE} caracteres."

printf '%s' "$CLAVE" > "$LIMPIO"
firebase functions:secrets:set ANTHROPIC_API_KEY_PROD --data-file="$LIMPIO"

# Verificación de ida y vuelta: lo que quedó guardado debe medir lo mismo que
# lo que se envió. Es la comprobación que faltó las tres veces anteriores.
GUARDADO="$(firebase functions:secrets:access ANTHROPIC_API_KEY_PROD | tr -d '\r\n')"
if [ "${#GUARDADO}" -ne "${#CLAVE}" ]; then
  echo "ERROR: se guardaron ${#GUARDADO} caracteres y se enviaron ${#CLAVE}."
  echo "NO redesplegar. El secreto quedó corrupto."
  exit 1
fi
echo "Verificado: la versión nueva mide ${#GUARDADO} caracteres, igual que el origen."

rm -f "$ORIGEN"
echo "Archivo de origen borrado."
echo
echo "Siguiente paso (la versión del secreto se fija en el despliegue):"
echo "  firebase deploy --only functions:ejecutarOperacionIA,functions:chatAdmin"
