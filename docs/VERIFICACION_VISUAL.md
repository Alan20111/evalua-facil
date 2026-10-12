# Verificación visual (`npm run test:visual`)

Fase 6 de `docs/PLAN_NORMALIZACION_UI.md`. Recorre las pantallas principales en
compu (1280×800) y en celular (375×812, táctil) contra el **emulador** y hace dos
cosas:

1. **Compara el HTML** de `main` contra una referencia tomada antes del cambio.
   Sirve para refactors que no deben cambiar nada visible (fase 5: dividir
   monolitos) y para ver exactamente qué cambió cuando sí se quiere un cambio.
2. **Audita el contrato de medidas**: todo botón, campo o pestaña visible debe
   medir `--control-sm`, `--control`, `--control-lg` o la píldora segmentada
   (`--control` − 0.5rem), y no tener esquina «a medias» (radio menor a la
   mitad del alto). Las alturas se leen de las variables CSS de la página, así
   que en táctil valen 43 px y en compu 40 px.

Además deja una captura de página completa de cada vista en
`test/visual/capturas/<compu|celular>/`.

Todo lo que genera (`test/visual/`) es **local y no se sube**: las referencias
llevan la fecha del día y los ids del emulador, así que solo sirven para
comparar antes/después en la misma máquina y el mismo día.

## Montaje

Lo mismo que `docs/MEDIR_ESQUELETOS.md` (no toca producción; proyecto
`demo-esqueletos`):

```bash
# 1. Emuladores de Auth y Firestore (JDK 21+)
firebase emulators:start --only auth,firestore --project demo-esqueletos
# 2. App apuntando al emulador en el puerto 5175
env VITE_EMULADORES=1 VITE_FIREBASE_PROJECT_ID=demo-esqueletos VITE_FIREBASE_API_KEY=fake \
    VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_APP_ID=1:1:web:1 \
    VITE_FIREBASE_MESSAGING_SENDER_ID=1 npx vite --port 5175 --strictPort
```

No hace falta sembrar a mano: `--referencia` vacía el emulador y corre
`scripts/emulador/sembrar-docente.cjs`. Usa Google Chrome del sistema
(`CHROME_PATH` para otra ruta) con `playwright-core`; no descarga navegadores.

## Uso

```bash
# ANTES del cambio: vacía el emulador, siembra y guarda las referencias
node scripts/visual/verificar.mjs --referencia
# DESPUÉS del cambio: compara (sale con código 1 si alguna vista cambió)
npm run test:visual
# Solo un rol
node scripts/visual/verificar.mjs --solo=docente
# Solo una vista (más rápido mientras se trabaja una pantalla)
node scripts/visual/verificar.mjs --vista=nueva-asignatura
```

Las hojas de formulario se capturan con `abrir`: la vista entra a su página,
toca el botón con ese nombre y compara el HTML del diálogo en vez del de
`main`. Además deja `<vista>-pie.png` con la hoja desplazada hasta abajo. En
las capturas se oculta el aviso «Activa las notificaciones», que tapaba el pie.

Al comparar se **reutilizan** los datos sembrados (`test/visual/.semilla.json`):
resembrar cambiaría los ids y con ellos el orden en que Firestore devuelve las
listas, y todo «difería» sin que el código cambiara. Por eso solo
`--referencia` resiembra.

Una diferencia se reporta con el primer punto donde el HTML se separa (50
caracteres antes y 70 después). Si el cambio era intencional, revisa la captura
y vuelve a tomar la referencia.

## Vistas

| Rol | Vistas |
|-----|--------|
| Docente | tablero, «Nueva asignatura», asignatura (+ cada pestaña), «Editar asignatura», «Duplicar asignatura» (solo compu: el teléfono no tiene ese botón), actividad, calendario, perfil (+ cada pestaña), notificaciones, catálogo `/dev/componentes` |
| Alumno | tablero, perfil (+ cada pestaña), agenda |

La asignatura y la actividad **del alumno** no se pueden ver en local: leen de
la API serverless (`/api/content`), que no corre con Vite.

## Trampas conocidas

- **El celular va en su propio navegador** con el puntero táctil fijado en Blink
  (`--blink-settings=primaryPointerType=2,…`). La emulación de Playwright
  (`hasTouch`) sola no basta: la captura de página completa redimensiona la
  ventana, Chromium pierde la emulación y `(pointer: coarse)` deja de cumplirse.
  El «celular» se volvía una compu angosta: contadores de escritorio en las
  filas de actividad, el calendario de laptop y controles de 40 px. Así se
  escondieron 6 hallazgos del contrato que solo existen en el teléfono.
- **No se espera `networkidle`**: Firestore deja conexiones abiertas y nunca se
  cumple. Se espera a que no quede ningún `[aria-busy="true"]` (esqueletos).
- Se navega con `reducedMotion: 'reduce'` para que las animaciones de entrada
  no dejen cosas a media escala en la captura.
- Después de abrir una hoja el ratón se mueve a una esquina: si se queda donde
  estaba el botón, lo que caiga debajo sale con su estilo de «pasar encima».
- La posición de la línea de «ahora» del calendario se normaliza (baja con el
  reloj).
- El calendario recuerda la última vista: la primera corrida después de usarlo a
  mano puede abrir en otra vista que la referencia.
