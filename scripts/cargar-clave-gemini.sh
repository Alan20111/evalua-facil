#!/usr/bin/env bash
#
# Carga GEMINI_API_KEY (la clave DEFINITIVA de Gemini para el Video interactivo)
# en GCP Secret Manager SIN pasar por el prompt interactivo de firebase-tools.
#
# Mismo método y por la misma razón que scripts/cargar-clave-anthropic.sh:
# pegar la clave en el prompt enmascarado de `firebase functions:secrets:set`
# desde una consola de Windows puede guardar UN SOLO CARÁCTER y el CLI responde
# "Created a new secret version" como si hubiera ido bien. `--data-file` conserva
# el valor íntegro, y aquí además se verifica la ida y vuelta.
#
# Se usa UNA vez, con la clave definitiva (no una clave de prueba):
#   · ya NO se crean claves temporales para validar; el secreto es el único lugar.
#   · para el uso real conviene una clave de un proyecto con facturación (nivel de
#     pago): en el gratuito, Google usa lo enviado para mejorar sus productos.
#
# Uso:
#   1. Crear la clave en https://aistudio.google.com/apikey (restringida a la
#      Generative Language API) y guardarla —y nada más— en el archivo ORIGEN.
#   2. bash scripts/cargar-clave-gemini.sh [ORIGEN]
#
# El script nunca imprime la clave: solo su longitud. Borra el archivo de origen solo si se
# llama gemini-key-definitiva.txt; con cualquier otro nombre lo conserva y lo avisa.
set -euo pipefail

ORIGEN="${1:-/c/Users/Kike/gemini-key-definitiva.txt}"
LIMPIO="$(mktemp)"
trap 'rm -f "$LIMPIO"' EXIT

# gemini-key.txt fue el archivo de las claves de DIAGNÓSTICO, ya revocadas.
if [ "$(basename "$ORIGEN")" = "gemini-key.txt" ]; then
  echo "RECHAZADO: gemini-key.txt contenía las claves de diagnóstico (revocadas)."
  echo "Usa un archivo nuevo con la clave definitiva, p. ej. gemini-key-definitiva.txt."
  exit 1
fi

if [ ! -f "$ORIGEN" ]; then
  echo "FALTA: no existe $ORIGEN"
  exit 1
fi

# Saneado defensivo: BOM de UTF-8, CR de Windows, LF y espacios de los extremos.
# Se escribe SIN salto de línea final (las cabeceras HTTP no lo aceptan).
CLAVE="$(sed -e '1s/^\xEF\xBB\xBF//' "$ORIGEN" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

# Misma forma que valida leerClave() en functions/extraccionVideoGemini.js: ASCII
# imprimible, sin espacios, 20+ caracteres. Si no cumple, NO se sube nada.
if ! printf '%s' "$CLAVE" | grep -qE '^[!-~]{20,}$'; then
  echo "FORMA INVÁLIDA: ${#CLAVE} caracteres, no cumple ^[!-~]{20,}$"
  echo "No se cargó nada. Revisa que el archivo tenga la clave completa."
  exit 1
fi
echo "Forma OK: ${#CLAVE} caracteres."

printf '%s' "$CLAVE" > "$LIMPIO"
firebase functions:secrets:set GEMINI_API_KEY --data-file="$LIMPIO"

# Verificación de ida y vuelta: lo guardado debe medir lo mismo que lo enviado.
GUARDADO="$(firebase functions:secrets:access GEMINI_API_KEY | tr -d '\r\n')"
if [ "${#GUARDADO}" -ne "${#CLAVE}" ]; then
  echo "ERROR: se guardaron ${#GUARDADO} caracteres y se enviaron ${#CLAVE}."
  echo "NO redesplegar. El secreto quedó corrupto."
  exit 1
fi
echo "Verificado: la versión nueva mide ${#GUARDADO} caracteres, igual que el origen."

# Solo se borra el archivo con el nombre esperado: cualquier otro se conserva, para
# que un argumento equivocado nunca elimine un archivo ajeno.
if [ "$(basename "$ORIGEN")" = "gemini-key-definitiva.txt" ]; then
  rm -f "$ORIGEN"
  echo "Archivo de origen borrado."
else
  echo "AVISO: el archivo de origen NO se borró porque no se llama gemini-key-definitiva.txt."
  echo "Se conserva en: $ORIGEN"
  echo "Contiene la clave: bórralo tú cuando ya no lo necesites."
fi
echo
echo "Siguientes pasos, EN ESTE ORDEN (la versión del secreto se fija en el despliegue):"
echo "  1. cd seeds-db && node seed-ia-tarifas.js --dry-run   # revisar; luego sin --dry-run"
echo "  2. export FUNCTIONS_DISCOVERY_TIMEOUT=120"
echo "     firebase deploy --only functions:ejecutarOperacionIA"
echo "  3. Validación real, sin archivos con claves:"
echo "     GEMINI_API_KEY=\"\$(firebase functions:secrets:access GEMINI_API_KEY)\" \\"
echo "       node scripts/validar-extractor-gemini.mjs <url-youtube> <duracion-en-segundos>"
