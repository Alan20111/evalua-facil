# Plan para publicar en Google Play

Qué falta para que Google acepte Evalúa Fácil en la Play Store, ordenado por
riesgo de rechazo. Complementa `docs/play-store/` (julio 2026), que ya trae los
textos de la ficha, el formulario de datos y el AAB firmado; aquí se anota lo
que cambió desde entonces y lo que la revisión de oct-2026 encontró en el
código.

Estado medido el 13-oct-2026 sobre `main` (`37bd71cd`).

**Responsable:** 🛠 = código (Claude) · 👤 = tú (Play Console, cuenta, decisiones).

---

## Resumen

| # | Bloque | Riesgo si no se hace | Responsable |
|---|--------|----------------------|-------------|
| B1 | Compra de créditos dentro de la app nativa | **Rechazo seguro** (política de pagos) | 🛠 + 👤 decide |
| B2 | Reportar contenido generado por IA | **Rechazo** (política de IA generativa) | 🛠 |
| B3 | Aviso de privacidad y Seguridad de los datos: IA y comprobantes | **Rechazo o retiro** (datos de usuario) | 🛠 + 👤 llena el formulario |
| B4 | Página web pública para pedir borrar la cuenta | **Bloquea el formulario** de datos | 🛠 |
| B5 | Permiso `SCHEDULE_EXACT_ALARM` | Bajo: no requiere declaración (ver B5) | ✅ |
| B6 | Funcionalidad mínima (la app carga el sitio remoto) | Rechazo por «solo un sitio web» | 🛠 |
| B7 | Nombre «SEP» en la ficha | Rechazo por suplantación o engaño | 👤 + 🛠 textos |
| S | Seguridad | Hallazgos en el informe previo al lanzamiento; riesgo real | 🛠 |
| A | Accesibilidad en Android | Advertencias en el informe previo; usuarios | 🛠 + 👤 prueba en celular |
| O | Optimización y Android vitals | Menor visibilidad en la tienda si se pasan los umbrales | 🛠 |
| P | Play Console: cuenta, prueba cerrada, ficha | **Sin esto no se publica** | 👤 |

Orden sugerido: **B1–B7 → S → A/O en paralelo → P.** La prueba cerrada de 14
días (P3) puede arrancar en cuanto B1–B6 estén en producción, porque la app
carga el sitio en vivo y lo que se arregle después le llega sola a los testers.

---

## B. Bloqueantes de política

### B1. Compra de créditos de IA dentro de la app 🛠 👤 ✅ opción a (paso 1)

> **Hecho (13-oct-2026).** `PUEDE_COMPRAR` en `src/utils/platform.js` oculta en la app los botones de compra, el modal, el precio de la Ayuda y los avisos que invitan a comprar. Los créditos de regalo se siguen activando. El Asistente IA recibe `puedeComprar: false` y no explica cómo comprar (`bloqueAyudaPlataforma` en `functions/ia.js`), pero eso **requiere desplegar `ejecutarOperacionIA`**. `allowNavigation` quedó solo con el sitio. Hay un candado en `check-ui-standards.sh`.

**Hallazgo.** `ComprarCreditosModal` (transferencia SPEI con CLABE y subida de
comprobante) se abre en la app nativa desde `CreditosPanel`,
`ConfirmacionCreditosModal`, `CalificarConIAModal` y el Perfil del docente.
Ninguno revisa `IS_NATIVE_APP`. Además, `capacitor.config` tiene los dominios de
Mercado Pago en `allowNavigation`.

**Por qué rechaza.** Los créditos de IA son un bien digital que se consume
dentro de la app. La política de pagos de Play exige **Google Play Billing**
para eso. También prohíbe mandar al usuario a pagar fuera (*anti-steering*):
botones, enlaces o textos del tipo «compra en la web».

**Opciones (decides tú):**

| Opción | Qué implica | Recomendación |
|--------|-------------|---------------|
| **a) Solo consumo en la app** | En `IS_NATIVE_APP` se oculta todo lo de comprar: botón, modal, CLABE, precios y textos que digan dónde comprar. Se ve el saldo y se gasta. Se compra en la web. | ✅ **Recomendada para el lanzamiento.** Es lo que hacen Netflix y Spotify. Rápida, sin comisión. |
| b) Google Play Billing | Plugin de compras, productos en Play Console, validar el recibo en una Cloud Function y abonar créditos. Google cobra 15 % en el primer millón de USD al año. | Para después, si las ventas desde la app lo justifican. |
| c) Facturación alternativa | Programas de Google por país. Verificar si México está incluido antes de considerarla. | No contar con ella. |

**Trabajo (opción a):**
1. Crear una sola regla, `puedeComprarAqui()` en `src/utils/platform.js`, que valga `!IS_NATIVE_APP`.
2. Con ella, ocultar el botón «Comprar créditos» en los cuatro lugares.
3. Cuando el saldo se acaba, mostrar un texto neutro («Te quedaste sin
   créditos») **sin** decir dónde comprarlos ni enlazar a la web.
4. Revisar con esa regla:
   - el bloqueo de Asistencia con saldo 0 (`AttendanceTab`);
   - la Ayuda (`/ayuda`), que no debe explicar cómo comprar dentro de la app.
5. Quitar de `allowNavigation` los dominios de Mercado Pago y Mercado Libre.
6. Agregar un candado en `check-ui-standards.sh`: `ComprarCreditosModal` solo
   puede montarse detrás de `puedeComprarAqui()`.

### B2. Reportar contenido generado por IA 🛠 ✅ (paso 2)

> **Hecho (14-oct-2026).**
> - El componente `ReportarIA` va junto a cada resultado de IA que se muestra tal como salió:
>   - calificación sugerida (`CalificarConIAModal`);
>   - sugerencia por pregunta abierta (`EvaluacionManager`);
>   - rúbrica y lista de cotejo generadas;
>   - reactivos generados;
>   - preguntas del video;
>   - palabras del juego;
>   - planeación;
>   - los tres informes de análisis.
> - Los reportes se guardan en `reportesIA`, con reglas y 5 pruebas en `test/firestore-rules.test.mjs`. Los atiende el admin en **Panel admin › Reportes de IA**.
> - Probado en el emulador: el reporte llega y el admin lo marca revisado.
> - **Requiere `firebase deploy --only firestore:rules`**; sin eso, el reporte falla con error de permisos.
> - Los alumnos no ven resultados crudos de IA: solo lo que su docente revisó y publicó (punto 5).
> - `ChatAsistente.jsx` también lo lleva, pero hoy esa pantalla no se monta en ninguna ruta.
>
> **Pendiente (punto 4):** una regla común de «contenido apropiado para bachillerato» en los prompts de `functions/ia.js`. Hoy solo la tienen algunos (avisos, encuestas). Cambiarla en todos altera el comportamiento de cada operación y exige desplegar funciones, así que va en un PR aparte, con pruebas de cada operación. Claude y Gemini traen además sus propios filtros de seguridad.

**Hallazgo.** La app genera con IA rúbricas, preguntas, retroalimentación,
calificación sugerida y preguntas del video interactivo. No hay forma de
reportar una respuesta ofensiva o equivocada; `reportar` solo aparece en
textos sin relación.

**Política.** Las apps con IA generativa deben permitir **reportar o marcar**
el contenido generado **dentro de la app, sin salir de ella**. Google también
espera salvaguardas contra contenido dañino, sobre todo si hay menores.

**Trabajo:**
1. Crear un componente `ReportarIA` (botón discreto «Reportar respuesta», con
   ícono de bandera) junto a cada resultado de IA: rúbrica generada,
   retroalimentación, calificación sugerida, preguntas de video y chat de
   administración si un docente lo ve.
2. Hoja con motivo (ofensivo, incorrecto, otro) y comentario opcional. Se
   guarda en una colección `reportesIA` con la operación, el id del resultado,
   el texto reportado (recortado) y el uid. Agregar reglas: solo crea el
   autor y solo lee el admin. Agregar prueba de reglas en
   `test/firestore-rules.test.mjs`.
3. Agregar la lista de reportes en el panel de admin.
4. Revisar que los prompts del sistema de `functions/ia.js` pidan explícitamente
   contenido apropiado para bachillerato. Si ya lo piden, documentarlo, porque
   Google puede preguntar.
5. Para el contenido del alumno, si existe: el alumno ve retroalimentación
   generada, así que el botón también va en su vista.

### B3. Privacidad y Seguridad de los datos 🛠 👤 ✅ textos (paso 2)

> **Hecho.**
> - El aviso de privacidad (14-oct-2026) tiene una sección nueva, «6. Inteligencia artificial». Dice qué va a Anthropic, que a Gemini solo llega la dirección de un video público, que esos datos no se usan para entrenar y que se puede reportar u oponerse.
> - Los datos de compra pasaron del modelo de suscripción al de créditos.
> - Se agregaron los reportes de IA.
> - `03-seguridad-de-datos.md` se rehízo: historial de compras, comprobantes, archivos, mensajes y la URL de borrado.
> - `04-clasificacion-contenido.md` responde «Sí» a la interacción entre usuarios y «No» a compras digitales.
>
> **Pendiente 👤:** llenar los formularios en Play Console.

**Hallazgos:**
- `Privacidad.jsx` lista a Firebase, Cloudinary, Mercado Pago y PayPal, pero
  **no menciona a Anthropic (Claude) ni a Google (Gemini)**. Los trabajos,
  respuestas y nombres de los alumnos pueden llegar a esos proveedores al
  calificar con IA.
- `docs/play-store/03-seguridad-de-datos.md` dice «Información financiera → No».
  Hoy se sube un **comprobante de transferencia**. Si B1 queda en la opción a,
  eso ya no pasa en la app, pero sí en la web con la misma cuenta. Hay que
  decidir cómo declararlo.
- No se declaran los mensajes ni el contenido que escribe el usuario: avisos,
  comentarios, entregas de los alumnos (texto y archivos).

**Trabajo:**
1. Aviso de privacidad: nueva sección «Procesamiento con inteligencia artificial».
   Debe decir:
   - qué datos se envían (texto de entregas, rúbricas; no se envían correos);
   - a quién (Anthropic y Google, como encargados);
   - que no se usan para entrenar modelos, según el contrato y el nivel de pago
     de cada uno. Verificar el nivel de Gemini: el gratuito sí entrena (ver
     CLAUDE.md);
   - cómo oponerse (ARCO).
   Actualizar la fecha.
2. Que el aviso diga explícitamente cómo se trata a los **menores** (15–17 años)
   y que el docente es quien carga sus datos.
3. Rehacer `03-seguridad-de-datos.md`:
   - Agregar **«Mensajes en la app → Otro contenido generado por el usuario»** y
     **«Archivos y documentos»** (entregas).
   - En **información financiera**, declarar los comprobantes de compra si la
     cuenta los sube por cualquier vía.
   - Mantener «Compartido = No»: los proveedores de IA procesan por cuenta de la
     app.
4. 👤 Llenar el formulario en Play Console con el documento actualizado.

### B4. URL web para pedir borrar la cuenta 🛠 ✅ (paso 1)

> **Hecho.** `https://evaluafacil.mx/eliminar-cuenta` (`src/pages/EliminarCuenta.jsx`), enlazada desde el aviso de privacidad. Es la URL que va en el formulario de Seguridad de los datos.

**Hallazgo.** Ya se puede borrar la cuenta dentro de la app
(`EliminarCuentaModal` y `EliminarCuentaAlumnoModal`). Falta una **página web
pública** con ese fin: no existe `/eliminar-cuenta`.

**Política.** Play pide las dos cosas: el camino dentro de la app y una URL que
funcione sin instalar la app. Esa URL se pone en el formulario de Seguridad de
los datos.

**Trabajo:** crear la ruta pública `/eliminar-cuenta`, sin sesión, con:
- los pasos dentro de la app, para docente y para alumno;
- qué se borra, qué se conserva y por cuánto tiempo (p. ej. respaldos);
- un formulario o `mailto:` a `soporte@evaluafacil.mx` para quien ya no tiene
  acceso.
Enlazarla desde el aviso de privacidad.

### B5. Permiso de alarmas exactas 🛠 ✅ (corregido en el paso 1)

**Hallazgo.** El manifiesto pide `SCHEDULE_EXACT_ALARM`. Antes,
`localReminders.js` programaba los recordatorios con `schedule: { at }`, sin
`allowWhileIdle`.

**Política (corregida).** La declaración restringida de Play es para
`USE_EXACT_ALARM`, que solo se permite a apps de alarma o calendario.
`SCHEDULE_EXACT_ALARM` no la necesita: el usuario lo concede en Ajustes
(«Alarmas y recordatorios»), y desde Android 14 viene **negado por omisión**
en instalaciones nuevas.

**Por qué no se quitó.** El comentario de `AndroidManifest.xml` documenta una
prueba en un celular real: sin el permiso, un aviso programado 5 minutos antes
de la clase no llegó ni 30 minutos después. La causa no era el permiso. Sin
él, el plugin caía a `set(RTC)`, una alarma que no despierta al teléfono en
reposo (Doze).

**Hecho:**
1. El permiso se conserva. La app ya lleva al docente a concederlo al activar
   un recordatorio (`requestExactAlarmAccess`).
2. `schedule.allowWhileIdle: true`:
   - con el permiso, el plugin usa `setExactAndAllowWhileIdle`;
   - sin él, cae a `setAndAllowWhileIdle`, que sí despierta al teléfono. El
     aviso puede llegar unos minutos tarde, pero llega.
3. 👤 Pendiente: probar en un celular con Android 14+ **sin** conceder
   «Alarmas y recordatorios» que el aviso llega (paso 6).

### B6. Funcionalidad mínima: la app carga el sitio remoto 🛠 ◐ (paso 1)

> **Hecho:** punto 1 (`public/offline.html` + `server.errorPath`; entra al APK con `npx cap sync` en el próximo AAB) y punto 4 (la landing solo elige entre docente y alumno; las descargas ya explican que son de la web). **Pendiente:** punto 2. No se puede retener la splash hasta que cargue el sitio, porque la página sin conexión no tiene plugins y se quedaría trabada; se revisa en el celular (paso 6). El punto 3 se cubre en la ficha.

**Hallazgo.** `server.url` apunta a `https://evalua-facil.vercel.app`: la app
es un WebView del sitio. **No tiene página sin conexión**: no hay `errorPath`,
así que sin internet el revisor ve el error del WebView.

**Política.** Google rechaza las apps que «solo envuelven un sitio web» sin
ofrecer nada propio. Evalúa Fácil sí usa varias funciones nativas, pero hay que
hacerlas evidentes:
- notificaciones push y locales;
- inicio de sesión nativo con Google;
- compartir y guardar archivos en el teléfono;
- orientación de pantalla en el video;
- botón Atrás de Android.

**Trabajo:**
1. Pantalla **sin conexión** propia, empaquetada en el APK: `errorPath` en
   `capacitor.config`, con el logo, «Sin conexión» y un botón «Reintentar».
   Agregar su esqueleto si aplica.
2. Que el primer arranque nunca muestre una página en blanco: la splash debe
   quedarse hasta que cargue el sitio o salga la pantalla sin conexión.
3. En la ficha y en las notas para el revisor, enumerar las funciones nativas.
   Las capturas deben mostrar notificaciones y la app, no la landing.
4. Revisar que dentro de la app no aparezcan:
   - la landing pública;
   - el botón «Descargar la app» (`descargaSoloWeb.js` ya lo cuida, verificarlo);
   - los enlaces que abren el navegador sin necesidad.

### B7. «SEP» en el nombre y la ficha 👤 🛠 ✅ textos (paso 1)

> **Hecho.** `02-ficha-tienda.md` con aviso de no afiliación, sección de IA, sección «En tu celular» y notas para la consola.

**Riesgo.** Si se ve como app oficial de la Secretaría de Educación Pública,
cae en la política de **suplantación y engaño**. Las apps que parecen
gubernamentales sin serlo se rechazan.

**Trabajo:**
- Que ni el nombre, ni el ícono, ni las capturas usen logotipos o colores de la SEP.
- En la descripción completa, una línea: «Evalúa Fácil es una herramienta
  independiente; no está afiliada a la SEP ni a ninguna dependencia de
  gobierno». Usar «para docentes de bachillerato tecnológico» en vez de
  «app de la SEP».
- Revisar `02-ficha-tienda.md` con ese criterio.

---

## S. Seguridad 🛠

| # | Hallazgo | Acción | Prioridad |
|---|----------|--------|-----------|
| S1 ✅ | `android:allowBackup="true"` | Paso 4: `allowBackup="false"`, `fullBackupContent="false"` y `dataExtractionRules` que excluyen todo en la nube y en la transferencia entre teléfonos (Android 12+). Confirmado en el manifiesto combinado del APK. | Alta |
| S2 ✅ / ◐ | `vercel.json` sin **CSP** ni **HSTS** | **HSTS:** ya lo manda Vercel en los dos dominios (`max-age=63072000`; en `vercel.app` también `includeSubDomains; preload`), así que no se agregó. **CSP:** va en modo `Report-Only` (paso 3), con los orígenes sacados del bundle. Se probó obligatoria contra producción (páginas públicas) y contra el emulador (pantallas del docente) sin violaciones. Los reportes llegan a `api/csp-report.js` → colección `cspReportes`, uno por violación distinta, con contador; solo el admin los lee. **Pendiente:** en 1–2 semanas revisar `cspReportes` en la consola de Firebase, ajustar y cambiar la cabecera a `Content-Security-Policy`. | Media |
| S3 | Sin **Firebase App Check** | Activar App Check con Play Integrity (Android) y reCAPTCHA Enterprise (web). Primero en modo solo métricas y luego en modo obligatorio en Firestore y en las Cloud Functions de IA, que son las que gastan dinero. | Alta |
| S4 ✅ | `minifyEnabled false` | Paso 4: R8 con `minifyEnabled` y `shrinkResources` (APK de 29.2 → 25.5 MB). Capacitor trae sus reglas; se agregó `-dontwarn com.facebook.**` (proveedor que no usamos) y números de línea para los fallos. **Cada AAB lleva su `mapping.txt`, que se sube a Play Console** (App bundle explorer → Descargas → Archivo de desofuscación). Probado en el emulador: arranca, carga el sitio, Atrás y la pantalla sin conexión funcionan. | Media |
| S5 👤 | API key web de Firebase | Restringirla en Google Cloud (ver «S5 paso a paso» abajo). Es trabajo de consola: no hay cambio de código. | Media |
| S6 ✅ | Tráfico en claro | El manifiesto no tiene `usesCleartextTraffic` ni `networkSecurityConfig`, y con target 36 el tráfico sin cifrar está bloqueado por omisión. Confirmar en el AAB final (paso 4). | Verificar |
| S7 ✅ | Componentes exportados | En el código fuente solo `MainActivity` es `exported=true` (el `FileProvider` es `false`) y ningún plugin exporta componentes. Confirmar en el manifiesto combinado del AAB (paso 4). | Verificar |
| S8 ✅ | Reglas de Firestore | Suite con 662 pruebas, incluidas `reportesIA` (B2) y `cspReportes` (S2). | Media |
| S9 ◐ | Secretos | En el historial completo de git (todas las ramas) hay 0 claves de Anthropic con forma real (13-oct-2026). Falta 👤 comprobar la forma de los secretos en GCP con el comando de CLAUDE.md. | Verificar |
| S10 ✅ | `WebView` | `allowNavigation` solo tiene el sitio (B1). Capacitor abre cualquier otro host con un intent al navegador del sistema (`Bridge.launchIntent`), así que la sesión nunca se usa en un sitio ajeno. Los iframes de YouTube y Docs no son navegación. | Media |

### S5 paso a paso (👤, consola de Google Cloud)

La clave web de Firebase es pública por diseño: va dentro del JavaScript.
Restringirla impide que otro sitio la use para gastar tu cuota o crear cuentas.

1. Entra a console.cloud.google.com → proyecto `evalua-facil-app` →
   **APIs y servicios › Credenciales**.
2. Abre la clave **Browser key** (la de `VITE_FIREBASE_API_KEY`):
   - **Restricciones de aplicación → Sitios web (referentes HTTP):**
     - `https://evalua-facil.vercel.app/*`
     - `https://evaluafacil.mx/*`
     - `https://www.evaluafacil.mx/*`
     - `https://evalua-facil-app.firebaseapp.com/*`, que hace falta para el inicio de sesión con Google.

     La app de Android carga el sitio de Vercel, así que entra con esos mismos
     referentes.
   - **Restricciones de API:** solo las que usa la web:
     - Identity Toolkit API
     - Token Service API
     - Cloud Firestore API
     - Firebase Installations API
     - FCM Registration API
     - Firebase Cloud Messaging API, por las notificaciones web

     Si dudas, empieza solo con los referentes y deja las APIs sin restringir:
     ya es la protección principal.
3. Abre la clave **Android key** (la de `google-services.json`). En
   **Apps de Android**, agrega el paquete `mx.evaluafacil.app` con su SHA-1:
   - el SHA-1 de **Play App Signing** (Play Console › Integridad de la app);
   - el SHA-1 de la clave de subida, si pruebas builds locales firmadas.
4. Guarda, espera 5 minutos y prueba:
   - entrar con correo y con Google, en web y en la app;
   - recibir una notificación.

   Si algo falla con «API key not valid» o «referer blocked», revisa la lista.
   No quites la restricción completa.

---

## A. Accesibilidad en Android 🛠 👤

Play no rechaza por accesibilidad, pero el **informe previo al lanzamiento**
(Pre-launch report) corre Accessibility Scanner en cada versión y lo muestra en
la consola. La web ya está en 0 errores de axe y 0 focos invisibles
(`npm run test:visual -- --a11y`); falta lo propio de Android.

| # | Tema | Acción |
|---|------|--------|
| A1 | **Áreas táctiles de 48 dp** | El control táctil mide 43 px (`--control` en `pointer: coarse`), y en el WebView 1 px CSS ≈ 1 dp. Opciones: subir `--control` táctil a 48 px, o dar a los controles chicos un área de toque invisible de 48 px (`::after` con `inset` negativo) sin cambiar su tamaño visual. Recomendado: área invisible para iconos y `size-control-sm`, y medir el impacto de 48 px en botones con el verificador (esqueletos incluidos). |
| A2 | **TalkBack** | 👤 con el celular: recorrer inicio de sesión, tablero, asignatura, calificar, evaluación del alumno. Anotar lo que lee mal. 🛠 corrige. El orden de lectura y los nombres de ya salen de axe; falta confirmar hojas, menús y anuncios de `aria-live`. |
| A3 | **Tamaño de letra del sistema** | Probar con la fuente del sistema al 200 %. El WebView escala el texto (`textZoom`). Verificar que nada se corte ni se encime, sobre todo en encabezados de tabla y en la barra inferior. Otra opción: fijar `textZoom` y respetar el tamaño con `rem`. |
| A4 | Contraste | Ya en AA (#1602). Revisar la pantalla sin conexión nueva (B6) y la splash. |
| A5 ✅ | Modo oscuro del sistema | Probado en el emulador con el modo oscuro del sistema: la app se queda clara, sin oscurecimiento forzado (con target 33+ el WebView ya no lo aplica por omisión y la web no declara `color-scheme`). | — |
| A6 | Movimiento reducido | Ya respetado en web (`desplazamiento()`). Confirmar que Android pasa «Quitar animaciones» al WebView como `prefers-reduced-motion`. |
| A7 ◐ | Botón Atrás y gesto predictivo | Paso 4, en el emulador: la tecla Atrás la atiende la app («Presiona de nuevo para salir»), así que el plugin `App` sigue vivo con R8. Falta 👤 probar el gesto predictivo y el cierre de hojas y menús en un celular (paso 6). | — |

---

## O. Optimización y Android vitals 🛠

Umbrales de Play: si la app los pasa, pierde visibilidad y muestra advertencias.
- **Tasa de fallos percibidos:** 1.09 % de los usuarios al día.
- **ANR:** 0.47 %.

| # | Tema | Acción |
|---|------|--------|
| O1 | Arranque en frío | La app descarga el sitio cada vez. Medir el tiempo hasta el primer contenido en un celular de gama baja con 4G. Objetivo: menos de 3 s con caché y menos de 5 s sin caché. Revisar que el *service worker* de la PWA cachee el *shell* también dentro del WebView. |
| O2 | Tamaño del JS inicial | Revisar `npm run build` y el reporte de chunks. Separar en carga diferida lo pesado que no se usa al entrar: editor de rúbricas, video, calendario, panel admin, `planteles.json`. |
| O3 | Errores de JavaScript | Play vitals solo ve fallos **nativos**. Un error de React deja pantalla en blanco sin que nadie se entere. Agregar un `ErrorBoundary` raíz con «Algo salió mal · Reintentar» y un registro mínimo de errores (colección `erroresCliente` con límite de escritura, o un servicio con plan gratis). |
| O4 | Memoria | El WebView se reinicia si consume mucho: listas largas (alumnos, entregas), imágenes de Cloudinary sin tamaño (`f_auto,q_auto,w_…`). |
| O5 | Sin conexión | B6 cubre el arranque. Durante el uso: aviso «Sin conexión, los cambios se guardarán al volver». Firestore ya hace cola offline; verificar que la caché persistente esté activa. |
| O6 ✅ | Páginas de 16 KB | El APK sí trae librerías nativas: `libdatastore_shared_counter.so` (androidx) para 4 ABIs. Todas tienen segmentos LOAD alineados a 16 384, y la app corre en un emulador Android 17 con páginas de 16 KB. | — |
| O7 ◐ | Edge-to-edge | En el emulador (Android 17, navegación por gestos) el contenido respeta la barra de estado y la de gestos. Falta probar en un celular con navegación de 3 botones (paso 6). | — |
| O8 ✅ | Versionado | Paso 4: `versionCode` 16, `versionName` 1.0.15. AAB y mapping en `~/evaluafacil-android/evalua-facil-v1.0.15-vc16-*`. En cada AAB nuevo se sube el número. | — |

---

## P. Play Console y cuenta 👤

| # | Requisito | Estado | Nota |
|---|-----------|--------|------|
| P1 | Verificación de identidad y teléfono | ⏳ / ⬜ | En `01-checklist.md`. |
| P2 | Crear la app, nombre y descripciones | ⬜ | `02-ficha-tienda.md`, corregido por B7. |
| P3 | **Prueba cerrada: 12 testers × 14 días seguidos** | ⬜ | Requisito de cuentas personales nuevas. Los testers deben **optar** por la prueba y seguir inscritos los 14 días. Conviene reclutar 15–20 docentes (tus conocidos) por si alguno se sale. Después se pide acceso a producción con un cuestionario sobre la prueba: anota qué te reportaron y qué cambiaste. |
| P4 | Acceso para revisores | ⬜ | `05-acceso-revisores.md`: una cuenta docente con una asignatura de ejemplo y créditos, y una cuenta alumno inscrita. Que no caduque y que no pida verificar el correo. |
| P5 | Clasificación de contenido (IARC) | ⬜ | `04-clasificacion-contenido.md`. Declarar que los usuarios interactúan (avisos y comentarios) y que hay IA generativa. |
| P6 | Público objetivo | ⬜ | 13–15, 16–17 y 18+. **No** marcar «diseñada para niños» ni entrar al programa Familias. Con menores en la audiencia, Google revisa más el contenido y los datos: B2 y B3 son clave. |
| P7 | Anuncios | ⬜ | «No contiene anuncios». |
| P8 | Seguridad de los datos | ⬜ | Con el documento de B3 y la URL de B4. |
| P9 | Capturas | ⬜ parcial | Mínimo 2, ideal 6–8, del celular con sesión iniciada: tablero, calificar, rúbrica con IA, calendario, vista del alumno, notificación. Sin datos reales de alumnos: usar el emulador sembrado o una cuenta demo. |
| P10 | Correo de soporte | ✅ | `soporte@evaluafacil.mx` solo recibe. Probar que llegue antes de publicarlo. |
| P11 | Declaraciones de permisos | ⬜ | `SCHEDULE_EXACT_ALARM` y notificaciones no requieren declaración. Si la consola pregunta por alarmas exactas: recordatorios de clase que programa el propio docente. |
| P12 | Política de pagos | ⬜ | Si B1 queda en la opción a, en «Productos» no hay nada que dar de alta. |
| P13 | Gobierno o salud | ⬜ | Responder «No» a app gubernamental. Va de la mano con B7. |

---

## Orden de trabajo propuesto

| Paso | Contenido | Quién | Duración |
|------|-----------|-------|----------|
| **1. PR «política»** ✅ | B1 (opción a), B4, B5, B6 (pantalla sin conexión) y textos de B7 | 🛠 | Hecho |
| **2. PR «IA responsable»** ✅ | B2 (reportar, colección, reglas, admin) y B3 (aviso y documento de datos) | 🛠 | Hecho; falta desplegar las reglas |
| **3. PR «seguridad web»** ✅ | S2 (HSTS + CSP solo reporte), S5, S6, S7, S10 | 🛠 | Hecho; S5 es tuyo en consola |
| **4. PR «Android»** ✅ | S1, S4, A5, A7, O6–O8 y un AAB nuevo (`versionCode` 16) | 🛠 | 1 sesión; necesita el keystore |
| **5. App Check** | S3, primero en modo métricas y una semana después obligatorio | 🛠 + 👤 en consola | En dos tiempos |
| **6. Celular** | A1–A3 y O1, con TalkBack y fuente al 200 % | 👤 prueba + 🛠 corrige | 1–2 sesiones |
| **7. Consola** | P1–P13, subir el AAB a prueba interna y luego a la cerrada | 👤 | Los 14 días corren aquí |
| **8. Producción** | Cuestionario de la prueba cerrada y solicitud de acceso a producción | 👤 | Google tarda días |

Los pasos 1–3 no necesitan nada tuyo salvo decidir B1. El 4 necesita el
keystore (`~/evaluafacil-android/`). El 6 necesita un celular Android o un
emulador con Play Store.

## Decisiones pendientes (tuyas)

1. ~~**B1:** ¿opción a?~~ Sí, opción a (13-oct-2026).
2. **A1:** ¿se suben los controles táctiles a 48 px, o solo se agranda el área
   invisible de toque?
3. **O3:** ¿registro de errores propio en Firestore o servicio externo? Un
   servicio externo agrega un proveedor más al aviso de privacidad.
4. **P3:** ¿quiénes son los 12+ testers? La prueba exige que **opten** con su
   cuenta de Google.
