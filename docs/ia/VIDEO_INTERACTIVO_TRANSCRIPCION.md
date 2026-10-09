# Video interactivo con IA — cómo se obtiene el contenido del video

> ## Actualización (8-oct-2026) — el mecanismo de este documento fue **descartado**
>
> La alternativa B (endpoints internos de YouTube) funcionó desde una PC pero **YouTube la rechazó
> el 100 % de las veces desde Google Cloud** (0 de 15 intentos con transcripción; ver la prueba
> en `diagTranscripcionYT`, ya eliminada). Su código se **borró**: no queda como ruta alternativa.
> El análisis de alternativas de abajo se conserva como historia; la decisión vigente es esta:
>
> **El contenido del video lo extrae Gemini** (`functions/extraccionVideoGemini.js`) con la API
> oficial y la URL pública de YouTube. Claude Haiku 4.5 sigue siendo quien genera las preguntas.
>
> | Tema | Decisión |
> |---|---|
> | Qué se obtiene | **Contenido extraído por tramos con marca de tiempo**, no una transcripción literal. Contrato: `{ videoId, modelo, idioma, habla, duracionSeg (+ duracionFuente / duracionConfiable), segmentos[{inicioSeg, texto}], texto "[m:ss] …", cobertura, descartados, uso{tokens, intentos, ms} }`. |
> | Dónde corre | En el **precheck** de `generar_preguntas_video`, antes de reservar créditos. Sin función, endpoint ni secreto nuevos. |
> | Credencial | Solo la variable de entorno `GEMINI_API_KEY`. Sin ella: error controlado y cero cobro. El secreto `GEMINI_API_KEY` **aún no existe** en Secret Manager; el código ya lo declara para `ejecutarOperacionIA` (procedimiento en CLAUDE.md, «Credencial de Gemini»). |
> | Modelo | `gemini-3.5-flash-lite` (el probado); cambiable con `GEMINI_VIDEO_MODELO`. |
> | Reintentos | Hasta 3 intentos solo ante fallas temporales (429/500/502/503/504, red, tiempo, respuesta vacía o ilegible), con espera de 5 s y 15 s, dentro de un presupuesto de 150 s (la función tiene 300 s). Un 4xx permanente no se reintenta. |
> | Tiempos (opcionales) | `GEMINI_VIDEO_TIMEOUT_MS` (por llamada, 90 000) y `GEMINI_VIDEO_PRESUPUESTO_MS` (total, 150 000). |
> | Cobro | El extractor no toca el libro de créditos. Cualquier falla termina en el precheck: `unavailable` + `reintentable: true` si es del servicio; `failed-precondition` si el video no sirve. Siempre con «No se descontaron créditos». |
> | Suficiencia | No hay mínimo fijo de caracteres: se mide **segmentos útiles ×2**, **densidad (≥ 40 caracteres por pregunta)** y **cobertura temporal** (≥ 40 % del video si se piden ≥ 3 preguntas y dura ≥ 1 min). Si no alcanza, el error dice cuántas preguntas sí respalda el video. |
> | Solo videos públicos | La documentación de Google no admite videos privados ni «no listados». |
>
> **Lo que sigue sin comprobarse** (requiere una clave real): el texto exacto del error de Gemini ante un
> video privado/no listado (hoy se clasifica por heurística), la calidad y el detalle del prompt de extracción
> con videos reales, y la precisión de la duración (`duracionConfiable`).
>

Etapa 2 (8-oct-2026). Documenta la decisión técnica de **cómo leer lo que dice un
video de YouTube a partir de su URL**, qué se descartó y por qué, y qué no está
verificado todavía.

## El problema

Para formular preguntas con timestamps la IA necesita **el texto hablado del video
con sus tiempos**. Evalúa Fácil no almacena videos ni pide la transcripción al
docente, así que el servidor debe obtenerla solo, a partir de la URL.

Restricciones fijadas por Kike: solo YouTube; no guardar video; el docente no sube
nada ni pega transcripciones; el modelo sigue siendo Claude Haiku 4.5; si no hay
contenido confiable, **se detiene antes de cobrar un crédito**.

## Qué se verificó (no se asumió)

| Hecho | Cómo se comprobó |
|---|---|
| `captions.download` de la YouTube Data API v3 exige OAuth **del dueño del video** (o que el dueño haya habilitado contribuciones de terceros en esa pista). Con una API key, `captions.list` solo devuelve metadatos, no texto. No existe endpoint oficial para leer subtítulos de un video ajeno. | Búsqueda en documentación/foros. No pude abrir la referencia oficial de Google al momento de escribir esto: **confirmar en la referencia de `captions.download`** antes de citarlo como definitivo. |
| El endpoint interno `youtubei/v1/player` (cliente ANDROID) devuelve la lista de pistas y su URL de descarga **sin API key**; la URL entrega XML con `<p t d>`. | Probado el 8-oct-2026 desde la PC de Kike con `dQw4w9WgXcQ` (6 pistas, manuales y automáticas) y `jNQXAC9IVRw`. Funcionó. |
| YouTube **bloquea IPs de centros de datos** (AWS, GCP, VPS) con «Sign in to confirm you're not a bot» o 429; hay reportes de bloqueos por rangos completos. | Reportes de la comunidad (issues de `youtube-transcript-api`, MusicBot). **No pude probar desde Cloud Functions.** |
| Gemini acepta URLs de YouTube, pero solo videos **públicos** (no listados y privados no), con tope diario, y analiza cuadros además del audio. | Documentación de la API de Gemini (vía búsqueda). |

## Alternativas

| # | Alternativa | Dependencia | Limitaciones | Costo | Confiabilidad | Impacto en infraestructura | ¿API key? | Público / no listado |
|---|---|---|---|---|---|---|---|---|
| A | **YouTube Data API v3** (`captions.*`) | Oficial, `googleapis` | Solo videos propios o con contribuciones abiertas. **No sirve para una URL cualquiera.** | Cuota gratuita (captions.download es cara en cuota) | Alta, pero inaplicable | Ninguno | Key + OAuth del dueño | Solo del dueño |
| B | **Endpoint interno `youtubei` + `timedtext`** desde Cloud Functions | Ninguna (`fetch` de Node 20) | No oficial: YouTube puede cambiarlo; bloquea IPs de datacenter; sin subtítulos no hay nada; zona gris de los Términos de YouTube. | $0 | **Media. Sin medir desde GCP.** | Mínimo: 1 archivo, sin binarios | No | Público sí. No listado: debería (basta conocer el id) pero **no lo probé** |
| C | Librería npm (`youtube-transcript`, `youtubei.js`) | Paquete de terceros | Es el mismo mecanismo que B con mantenimiento ajeno: mismo bloqueo de IP, y si YouTube cambia hay que esperar al autor. | $0 | Media | +1 dependencia y su cadena | No | Igual que B |
| D | **Servicio gestionado de transcripciones** (proveedor externo) | API de un tercero | Dependencia y costo recurrente; las URLs de los docentes pasan por un tercero; el proveedor asume la parte legal/técnica. | Por transcripción (sin cotizar) | **Alta desde la nube** (su negocio es eso) | Un secreto más; un proveedor más | Sí | Depende del proveedor |
| E | Descargar audio + transcribir (yt-dlp + Whisper) | Binarios, ffmpeg, STT | **Viola los Términos de YouTube**, pesado, almacena medios temporalmente, y yt-dlp sufre el mismo bloqueo de IP. | Alto | Baja | Inviable en Cloud Functions | Sí (STT) | Igual |
| F | **Gemini con la URL** de YouTube | Otro modelo y otro proveedor | Rompe la regla de seguir con Haiku; no admite no listados; el modelo "ve" cuadros (costo por frames) y no controlamos el timestamp. | Tokens de video | Media | Otra cuenta y facturación | Sí | Solo públicos |
| G | Leerlo desde el navegador del docente (IFrame API) | — | El reproductor **no expone el texto** de los subtítulos; `timedtext` desde el navegador choca con CORS. | — | — | — | — | — |

Descartadas por requisito: **E** (ToS + infraestructura), **F** (otro modelo; no
cubre no listados), **G** (técnicamente imposible), **A** (inaplicable a videos de
terceros).

## ~~Decisión: B, con falla cerrada y puerta a D~~ (descartada, ver la actualización de arriba)

Se implementó **B** en `functions/transcripcionYouTube.js`, porque es la única
que cumple a la vez: sin dependencia nueva, sin API key, sin costo por video,
sin guardar medios y sin cambiar de modelo. **No se eligió por ser la más fácil
de programar**: se eligió después de descartar las otras por requisito, y se
acepta de frente su principal debilidad (no oficial, sensible a la IP).

Qué la hace segura aunque sea frágil:

1. **Falla cerrada.** Cualquier anomalía lanza `ErrorTranscripcion` con un código
   (`SIN_SUBTITULOS`, `BLOQUEO_YOUTUBE`, `VIDEO_PRIVADO`, `VIDEO_NO_DISPONIBLE`,
   `VIDEO_EN_VIVO`, `RED`, `FORMATO`, `CONTENIDO_INSUFICIENTE`, `VIDEO_MUY_LARGO`,
   `URL_INVALIDA`). Nunca devuelve una transcripción parcial.
2. **Se lee en el precheck**, antes de `ledger.reservar()`: si falla, no existe
   reserva que reembolsar y el docente ve «No fue posible obtener el contenido
   del video… No se descontaron créditos». No se crea ninguna actividad.
3. **Sin recortes silenciosos.** Más de 150 000 caracteres (~2-3 h de habla) se
   rechaza; menos de 600 se rechaza. Recortar generaría preguntas solo de la
   primera parte sin que el docente lo sepa.
4. **Superficie mínima.** Solo se acepta un id de 11 caracteres de una lista
   cerrada de hosts de YouTube; la URL de subtítulos devuelta por YouTube solo se
   sigue si es `https` en `youtube.com`; timeout de 10 s por petición.
5. **Aislada.** Todo lo que tiene que ver con YouTube vive en una sola función
   (`obtenerTranscripcion`). Si en producción hay bloqueos, se agrega un proveedor
   gestionado (alternativa D) **detrás de la misma función**, sin tocar la
   operación de IA, el cobro ni las pruebas.

## Qué NO está verificado (y cómo cerrarlo)

- **Funcionamiento desde Google Cloud.** Probé desde una IP residencial. Las IP de
  Cloud Functions podrían ser rechazadas. *Cierre:* tras desplegar, correr la
  operación con un video público con subtítulos. Si YouTube bloquea, el resultado
  es `BLOQUEO_YOUTUBE` **sin cobro** (lo cubre la prueba `video: YouTube bloquea…`),
  y se decide entonces pasar a la alternativa D con datos reales.
- **Videos no listados.** No los probé.
- **Versión del cliente ANDROID** (`clientVersion 20.10.38`): YouTube puede dejar
  de aceptarla. Está centralizada en `CLIENTE_YOUTUBE`.
- **Términos de YouTube.** Leer subtítulos por un canal no oficial es una zona gris;
  es una decisión de negocio de Kike, no técnica. Solo se descarga texto, nunca
  audio ni video, y no se redistribuye: se usa para proponer preguntas que el
  docente revisa.

## Cómo encaja con el resto

```
URL ─▶ precheck: tarifa==2 cr/pregunta ─▶ distribución ─▶ asignatura es del docente
     ─▶ obtenerTranscripcion()  ── falla ─▶ error SIN reservar
     ─▶ ledger.reservar(2 × preguntas)
     ─▶ Claude Haiku 4.5 (1 pasada + 1 de reparación si faltó algo)
     ─▶ normalizar: tipo / timestamp ∈ [0, duración] / opciones / clave / sin duplicados
     ─▶ ledger.liquidar(2 × preguntas ENTREGADAS)  ── 0 utilizables ─▶ reembolso total
     ─▶ { videoInteractivo, generacion, preguntas[estado:'propuesta'] }
```

- **Modelo:** `config/iaTarifas.modeloPorOperacion.generar_preguntas_video`
  = `claude-haiku-4-5`, el mismo de las demás operaciones de evaluación. No se
  introdujo otro.
- **Cobro:** 2 cr × preguntas **entregadas** (`unidadesReales`). El cliente no puede
  abaratarlo (`unidadesMinimas` sale del servidor) y, si la tarifa configurada no
  es 2, la operación se niega para que la pantalla nunca prometa otro precio.
- **Idempotencia:** misma clave ⇒ mismas preguntas, sin segundo cobro (el resultado
  queda en `iaConsumos`). Ojo: en un reintento el precheck vuelve a consultar
  YouTube antes de que el ledger reconozca la clave repetida.
- **Datos:** permanentes (`videoInteractivo`: proveedor, videoId, url, duracionSeg)
  separados de los de generación (`generacion`: numeroPreguntas, distribucion,
  creditosConsumidos, modeloIA, fechaGeneracion, estado, faltantes,
  fuenteContenido).
- **Preguntas:** nacen `estado: 'propuesta'`, `origen: 'ia'`. La abierta es
  `respuesta_corta` sin `respuestaCorrecta`. La operación **no escribe en
  Firestore**: guardarlas (la respuesta correcta va a `clave/`, como en
  cuestionarios) es de la etapa del editor.
- **Preguntas adicionales:** `params.yaGeneradas` (enunciados) evita repetir y solo
  se cobran las nuevas.

## Para dejarlo funcionando en producción (lo hace Kike)

1. `cd seeds-db && node seed-ia-tarifas.js --dry-run`, revisar, y correrlo sin
   `--dry-run` (usa `set()`; la versión sube a 11). Agrega
   `generar_preguntas_video` (tarifa 2, categoría «Evaluaciones», modelo Haiku 4.5).
2. `export FUNCTIONS_DISCOVERY_TIMEOUT=120` y
   `firebase deploy --only functions:ejecutarOperacionIA`.
3. Prueba de humo con un video público que tenga subtítulos.

Sin el paso 1 la operación responde «no está configurada correctamente» y no cobra.


---

## Pantalla docente: crear el video, generar y revisar (8-oct-2026)

**Dónde:** Asignatura → *Agregar actividad* → *Actividad interactiva* → *Video interactivo*
(`CrearVideoInteractivoModal`). Luego se abre el editor de la evaluación, donde está el panel
*Preguntas propuestas por la IA* (`PropuestasVideoPanel`).

**Qué cobra y qué no.** Abrir, configurar, validar, editar, aprobar y rechazar no cuestan nada. Solo
`generar_preguntas_video` cobra (2 créditos por pregunta ENTREGADA), y únicamente después de que el docente
confirma el costo en el diálogo estándar (`ConfirmacionCreditosModal`, con la ruta de compra si no alcanza el saldo).

**Orden de los pasos** (`src/utils/videoGeneracion.js`, con dependencias inyectadas para poder probarlo):

1. Se valida nombre, enlace de YouTube y cantidades (1–20). Nada toca el servidor.
2. Se crea la actividad (oculta, `modalidad: 'video_interactivo'`) con el **intento** ya guardado:
   `videoInteractivo.generacion.intento = { idempotencyKey, url, distribucion, asignaturaId }`.
3. Se llama a la operación con esa clave. El libro de créditos guarda el resultado en `iaConsumos/{clave}`.
4. Se guardan las propuestas con ids derivados de la clave (`{clave}_00`, `_01`…): guardar dos veces el
   mismo resultado no duplica nada.
5. Se cierra el intento (`videoInteractivo.generacion` pasa a `completa`/`incompleta`).

**Fallos y recuperación.**

| Qué pasó | Qué hace la pantalla |
|---|---|
| El servidor declara «sin cobro» (video privado, sin saldo, IA caída y reembolsada…) | Muestra su mensaje, limpia el intento y deja generar de nuevo con una clave NUEVA sobre la misma actividad (borrador). |
| Red caída, tiempo agotado, respuesta ilegible | Conserva la clave. «Reintentar sin volver a cobrar» repite la misma solicitud: si ya se ejecutó, el servidor devuelve lo guardado. |
| La IA generó pero falló guardar las propuestas | Igual: la clave sigue en la actividad. Reintentar recupera sin cobrar. |
| El docente cerró la pestaña a medias | Al abrir la actividad, el editor muestra «Una generación de preguntas no terminó de guardarse» con *Recuperar preguntas*. |

Cambio en el servidor (necesita desplegar `ejecutarOperacionIA`): el precheck de `generar_preguntas_video`
reconoce una clave que YA se ejecutó para ese mismo docente y no vuelve a leer el video con Gemini (costaría
dinero y podría fallar justo cuando el docente solo quiere recuperar lo ya pagado). Sin ese despliegue la
recuperación sigue sin cobrar dos veces, pero vuelve a leer el video.

**Ponderaciones al aprobar (criterio elegido).**

- La calificación se normaliza por el total (`obtenida / totalPonderacion × maxCalif`, `calcularCalificacion`):
  un total distinto de 10 no cambia ninguna nota. El editor solo exige que el total no pase de 10 y ofrece
  «Repartir 10 pts parejo» cuando no suma 10.
- Aprobar **nunca** modifica las ponderaciones de las preguntas existentes (el docente pudo fijarlas a mano).
- La pregunta aprobada recibe `floor(libre / pendientes)`, donde *libre* = 10 − lo ya asignado y *pendientes*
  cuenta las propuestas aún pendientes (incluida la que se aprueba). Así aprobar todo nunca rebasa 10, con o sin
  pesos manuales, y rechazar propuestas reparte más puntos a las que sigan.
- Si no queda nada libre (menos de 0.01) no se aprueba y el mensaje dice qué hacer: liberar puntos o usar
  «Repartir parejo» (mismo criterio que agregar un reactivo a mano que excede 10).

**Reglas de Firestore** (`firestore.rules`, subcolección `propuestasVideo`): solo el docente dueño, solo en
actividades de video; nace `pendiente`; el tipo no cambia; `pendiente → aprobada|rechazada`, `rechazada → pendiente`;
`aprobada` es terminal (tampoco se borra). **No se despliegan solas**: `firebase deploy --only firestore:rules`.
