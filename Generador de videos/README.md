# Generador de videos de Evalúa Fácil

Todo lo necesario para volver a hacer (o variar) el video de demo y las capturas
de Google Play, sin gastar créditos de ninguna plataforma. Esta carpeta es también
el **contexto para una IA**: si vas a generar un video nuevo, lee primero este
archivo y respeta las preferencias de abajo.

Estado: v1 hecha el 23-oct-2026 (92.7 s, vertical 1080×1920, con música).

## Preferencias del usuario (obligatorias)

- **Música: siempre la misma.** `musica/musica-principal-85s.mp3` (piano suave y
  cuerdas pulsadas, cálida y optimista, sin voces). `montar.mjs` la usa por
  omisión. No generar música nueva ni gastar créditos; solo cambiarla si el
  usuario lo pide.
- **Gratis.** Todo se hace en local: Playwright + Chrome (CDP) + sharp + ffmpeg.
  Nada de modelos generativos de video: inventarían una interfaz que no es la
  de la app. Higgsfield solo se usó para la música (quedan ~6.7 de 10 créditos
  gratuitos; el plan es gratuito y conviene revisar los términos de uso
  comercial antes de publicar).
- **Se graba la app real**, en modo Android (Capacitor emulado), con datos de
  demostración inventados y contra los emuladores de Firebase. Nunca producción
  ni datos reales de docentes o alumnos.
- **Estilo del video:** animaciones exageradas (cámara lenta 0.45×), zoom que
  se acerca a lo importante y se suelta, un círculo donde se toca la pantalla,
  letreros cortos en español abajo, tarjeta de inicio y de cierre con el logo.
  Marca: azul para docente, naranja para alumno; fuente Outfit.
- **Todo en español**, sin palabras en inglés en pantalla.
- Formato vertical 9:16 (1080×1920), 30 fps, H.264 CRF 18 + AAC 192k.
  Play Console no acepta el mp4: pide un enlace de YouTube (subirlo no listado).
  Una versión 16:9 aún no existe; se puede hacer con el mismo guion.

## Contenido de la carpeta

```
README.md                       este archivo
scripts/
  navegador.mjs                 abre la app como teléfono Android (360×640 a 4x)
  grabador.mjs                  graba con screencast de Chrome (1440×2560) y
                                guarda una línea de tiempo (zooms y letreros)
  demo.mjs                      el guion: qué se toca y cuándo (recorrido completo)
  montar.mjs                    compone cada fotograma con sharp y manda a ffmpeg
  capturas.mjs                  las 8 capturas para la ficha de Google Play
musica/
  musica-principal-85s.mp3      LA pista (85 s; se encadena consigo misma con
                                fundido de 5 s para cubrir el video completo)
  musica-alterna-75s.mp3        primera versión, no se usa
datos/
  sembrar-demo.cjs.copia        copia de scripts/emulador/sembrar-demo.cjs
                                (rama chore/semilla-demo): siembra docente,
                                4 asignaturas, alumnos, actividades y entregas
  ids-ejemplo.json              ejemplo de la salida de la semilla (los ids
                                cambian en cada corrida)
salidas/
  demo-v1.mp4                   video final v1
  capturas/01…08-*.png          capturas 1080×1920, PNG RGB sin alfa
  hoja-de-contacto-v1.png       18 cuadros del video para revisarlo de un vistazo
```

## Cómo se regenera (siempre desde la raíz del repositorio)

1. Emuladores y servidor (ver `docs/VERIFICACION_VISUAL.md`):
   `firebase emulators:start --only auth,firestore --project demo-esqueletos`
   y Vite con `VITE_EMULADORES=1 VITE_FIREBASE_PROJECT_ID=demo-esqueletos
   VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=localhost
   VITE_FIREBASE_APP_ID=1:1:web:1 VITE_FIREBASE_MESSAGING_SENDER_ID=1
   npx vite --port 5175 --strictPort`. Necesita JDK 21+.
2. Sembrar los datos: `node scripts/emulador/sembrar-demo.cjs` (en la rama
   `chore/semilla-demo`; si no está, usar la copia de `datos/`). La última línea
   que imprime es el JSON de ids: guardarlo como `ids.json`.
3. Capturas: `node "Generador de videos/scripts/capturas.mjs" ids.json <salida>`
4. Grabar: `node "Generador de videos/scripts/demo.mjs" ids.json <carpeta-grabacion>`
5. Montar (con la música de siempre):
   `node "Generador de videos/scripts/montar.mjs" <carpeta-grabacion> <salida.mp4>`

Variables: `BASE_URL` (por omisión `http://localhost:5175`), `CHROME_PATH`.
Las claves de las cuentas de prueba se leen de `scripts/emulador/sembrar-docente.cjs`
y nunca se imprimen.

## Lecciones aprendidas (ahorran horas)

- `Animation.setPlaybackRate` también frena los `requestAnimationFrame`: para
  desplazamientos con JS medir con `performance.now()`, no con la marca de rAF.
- Para que el screencast entregue 1440×2560 hay que usar
  `--force-device-scale-factor=4` real y **no** `isMobile`; con la densidad solo
  emulada salen cuadros de 360×640 y el zoom se ve borroso.
- Los filtros de ffmpeg con `scale eval=frame` se caen a veces (SIGBUS) en este
  Mac de 8 GB: por eso cada cuadro se compone con sharp y se manda crudo a ffmpeg.
- Este ffmpeg no trae `drawtext`: los letreros y tarjetas se dibujan con Chrome
  como PNG transparentes con la fuente Outfit incrustada.
- Playwright: `locator.filter({visible:true})` no existe aquí (usar `visible()`
  de navegador.mjs, porque el menú lateral guarda copias ocultas de los textos);
  `locator.tap()` se cuelga en filas arrastrables (tocar por coordenadas con
  `page.touchscreen.tap`).
- La barra superior móvil se oculta al bajar: volver arriba antes de usar sus
  botones. No recargar la página a media demo (aparece el logo grande de arranque):
  navegar tocando.
- Esperas de carga con tope de 3.5 s para que un spinner no estire el video.
- El botón de confirmar el cierre de sesión dice «Salir», no «Cerrar sesión».
- Los letreros van a 270 px del borde inferior para no tapar la barra de navegación.
- Música generada con Higgsfield (Seed Audio, ~0.7 créditos): la duración sale del
  prompt («Around 85 seconds» funcionó; 95 s falló). Prompt usado:
  «Instrumental background music for a product demo video of an education app for
  teachers. Warm, optimistic, modern; soft piano and plucked strings with a light
  steady beat, gentle build in the middle, no vocals, no sudden changes, calm clean
  ending. Exactly 85 seconds long.»

## Guion de la v1 (92.7 s)

Tarjeta de inicio (3.2 s) → elegir rol «Soy Docente» → login con zoom → tablero →
asignatura y parciales → entregas de una actividad (Tarde, 10/10) → estudiantes →
horario → notificaciones (3 pestañas) → créditos de IA → cerrar sesión → «Soy
Estudiante» → login alumno → promedios → retroalimentación → agenda → tarjeta de
cierre «Menos papeleo, más tiempo para enseñar» (evaluafacil.mx).

## Ideas pendientes (no hechas)

- Versión horizontal 16:9 para YouTube.
- Captura cuadro por cuadro (`HeadlessExperimental.beginFrame` / virtual time) en
  lugar de screencast + cámara lenta: animaciones exactas, sin cuadros perdidos.
- Locución gratis con `say` de macOS (voces Paulina o Mónica) o Piper.
