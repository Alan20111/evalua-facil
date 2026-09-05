#!/usr/bin/env bash
# Sube a GitHub los cuatro secrets de la firma de Android, leyéndolos de
# android/keystore.properties y del propio .jks.
#
#   bash scripts/subir-secrets-firma.sh
#
# Existe porque pegar las contraseñas a mano en `gh secret set` es frágil: si
# el pegado se corta o se junta con la línea anterior, el secret queda con un
# valor distinto y el fallo aparece tres minutos después, en mitad de la
# compilación, como "keystore password was incorrect". Pasó de verdad.
#
# Ninguna contraseña se imprime en pantalla.
set -euo pipefail

cd "$(dirname "$0")/.."
PROPS=android/keystore.properties
[ -f "$PROPS" ] || { echo "✗ No existe $PROPS"; exit 1; }

leer() { grep "^$1=" "$PROPS" | head -1 | cut -d= -f2-; }

STORE_FILE=$(leer storeFile)
STORE_PASS=$(leer storePassword)
KEY_ALIAS=$(leer keyAlias)
KEY_PASS=$(leer keyPassword)

for n in STORE_FILE STORE_PASS KEY_ALIAS KEY_PASS; do
  [ -n "${!n}" ] || { echo "✗ Falta $n en $PROPS"; exit 1; }
done
[ -f "$STORE_FILE" ] || { echo "✗ No existe la llave: $STORE_FILE"; exit 1; }

# Comprobar ANTES de subir nada: más vale enterarse aquí que a media
# compilación.
if ! keytool -list -keystore "$STORE_FILE" -storepass "$STORE_PASS" -alias "$KEY_ALIAS" >/dev/null 2>&1; then
  echo "✗ La contraseña de $PROPS no abre la llave — revisa el archivo antes de subir nada"
  exit 1
fi
echo "✓ La llave abre con los datos del archivo"

printf '%s' "$STORE_PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf '%s' "$KEY_ALIAS"  | gh secret set ANDROID_KEY_ALIAS
printf '%s' "$KEY_PASS"   | gh secret set ANDROID_KEY_PASSWORD
base64 < "$STORE_FILE"    | gh secret set ANDROID_KEYSTORE_BASE64

echo
echo "✓ Cuatro secrets actualizados. Ya se puede lanzar «Publicar APK»."
