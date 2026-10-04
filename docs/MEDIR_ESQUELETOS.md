# Medir esqueletos contra la pantalla real

`npm run check:esqueletos` compara las **clases** de cada pareja `data-esq` (rápido, corre en CI).
Esta guía mide las **cajas reales** en el navegador: el esqueleto y la pantalla cargada, uno encima
del otro. Úsala al integrar una pantalla nueva o cuando alguien vea un «salto» al cargar.

## Montaje (todo local, no toca producción)

```bash
# 1. Emuladores de Auth y Firestore (necesita JDK 21+)
firebase emulators:start --only auth,firestore --project demo-esqueletos
# 2. Datos de prueba: un docente con 3 asignaturas, una actividad y 3 estudiantes
node scripts/emulador/sembrar-docente.cjs        # imprime los ids; cuenta solo del emulador
# 3. App apuntando al emulador (puerto 5175)
env VITE_EMULADORES=1 VITE_FIREBASE_PROJECT_ID=demo-esqueletos VITE_FIREBASE_API_KEY=fake \
    VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_APP_ID=1:1:web:1 \
    VITE_FIREBASE_MESSAGING_SENDER_ID=1 npx vite --port 5175 --strictPort
```

Entra en `/docente` con la cuenta de prueba (ver el script).

## Congelar la carga
Para ver el esqueleto el tiempo suficiente, retrasa SOLO el tráfico a Firestore: pega temporalmente
en `<head>` de `index.html` (¡no lo commitees!) un script que envuelva `fetch` y
`XMLHttpRequest.prototype.send` para las URL con `:8080` con un `setTimeout` de `?lento=2000` ms, y
abre la ruta con `?lento=2000`.

## Muestreo
En la consola, muestrea cada ~120 ms los `[data-esq]` y clasifica la etapa: **A** = esqueleto de sesión
(hay `output[aria-busy]` y no `main#main-content`), **B** = pantalla montada con su esqueleto
(ambos), **C** = cargada. Guarda `left/top/width/height` por id y compara A→C y B→C por índice.
Un `dy` distinto de 0 en elementos que no son contenido de datos es un desfase real.

## Lo que ya se encontró así (oct-2026)
- `SkeletonGroup` ponía el texto oculto como primer hijo y `space-y-*` empujaba la primera fila 3.6 px.
- Las flechas de reordenar miden 30.4×60.8 px (iconos de 16 px literales, no rem).
- `AuthProvider` hacía `{!loading && children}`: **pantalla en blanco** mientras cargaba la sesión; el esqueleto de sesión nunca se veía. Ahora pinta `EsqueletoSesion`.
- El esqueleto de sesión vive fuera de `RoleWrapper` y necesita su propio `data-role` (escala de letra del rol).
- La lista de entregas de la actividad no dibujaba el buscador (36.4 px).
