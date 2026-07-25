# Firma y compilación del AAB

## Dónde está todo (fuera del repositorio, por seguridad)
Estos archivos **NO están en git** (son secretos/binarios) y viven solo en tu Mac:

```
~/evaluafacil-android/
├── evalua-facil-upload.jks          ← keystore (clave de firma de subida)
├── KEYSTORE-INFO.txt                ← alias + CONTRASEÑA (respáldalo!)
└── evalua-facil-v1.0-release.aab    ← el instalable firmado para subir a Play
```

- **Alias:** `upload`
- **Contraseña:** en `KEYSTORE-INFO.txt`.

> ⚠️ **RESPALDA `~/evaluafacil-android/` en un lugar seguro** (Drive, gestor de
> contraseñas). Con Play App Signing, si pierdes el keystore Google puede ayudarte a
> resetear la clave de subida, pero mejor no arriesgar.

## Cómo se conecta con el repo (sin secretos)
- `android/keystore.properties` (ignorado en git) apunta al `.jks` y trae las
  contraseñas. En una máquina nueva hay que recrearlo con el contenido correcto o el
  release sale sin firmar.
- `android/app/build.gradle` lee ese archivo y firma el `release`.

Contenido de `android/keystore.properties` (recréalo si trabajas en otra Mac):
```
storeFile=/Users/<usuario>/evaluafacil-android/evalua-facil-upload.jks
storePassword=<la de KEYSTORE-INFO.txt>
keyAlias=upload
keyPassword=<la de KEYSTORE-INFO.txt>
```

## Recompilar el AAB (cuando haya cambios)
Desde la raíz del repo:
```bash
npm run build                 # compila la web (dist/)
npx cap sync android          # copia la web + plugins al proyecto Android
cd android
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
sh ./gradlew :app:bundleRelease
```
El AAB queda en:
```
android/app/build/outputs/bundle/release/app-release.aab
```

## Actualizar la versión (para cada nueva subida a Play)
En `android/app/build.gradle`, dentro de `defaultConfig`, **sube el `versionCode`**
(entero, siempre mayor al anterior) y opcionalmente el `versionName`:
```
versionCode 2          // era 1
versionName "1.0.1"    // o "1.1", etc.
```
Play **rechaza** una subida cuyo `versionCode` no sea mayor al ya publicado.

## Verificar que el AAB está firmado
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
"$JAVA_HOME/bin/jarsigner" -verify android/app/build/outputs/bundle/release/app-release.aab
# Debe decir: "jar verified."
```
