# Publicación en Google Play — Evalúa Fácil

Guía maestra y **paso a paso completo** para subir Evalúa Fácil a la Play Store.
Todo lo que se puede preparar por adelantado ya está en esta carpeta; lo único
que **no depende de nosotros** es que Google apruebe la verificación de identidad
de la cuenta de desarrollador.

> **Datos base del proyecto**
> - Nombre de la app: **Evalúa Fácil**
> - Nombre de paquete (permanente): **`mx.evaluafacil.app`**
> - versionCode: `1` · versionName: `1.0`
> - targetSdk: `36` (Android 16 — por encima del mínimo de Play) · minSdk: `24` (Android 7)
> - Categoría: **Educación**
> - Sitio: `https://evaluafacil.mx` · Privacidad: `https://evaluafacil.mx/privacidad`

---

## Índice de esta carpeta
| Archivo | Contenido |
|---|---|
| [`01-checklist.md`](01-checklist.md) | Checklist completo: qué está listo ✅ y qué falta ⬜ |
| [`02-ficha-tienda.md`](02-ficha-tienda.md) | Textos de la ficha: nombre, descripciones, categoría |
| [`03-seguridad-de-datos.md`](03-seguridad-de-datos.md) | Respuestas del formulario de Seguridad de los datos |
| [`04-clasificacion-contenido.md`](04-clasificacion-contenido.md) | Respuestas del cuestionario de clasificación de contenido |
| [`05-acceso-revisores.md`](05-acceso-revisores.md) | Acceso a la app para los revisores de Google (login de prueba) |
| [`06-firma-y-aab.md`](06-firma-y-aab.md) | Firma (keystore), dónde está el AAB y cómo recompilarlo |
| `assets/` | Gráfico destacado y capturas para la ficha |

---

## Paso a paso (orden recomendado)

### FASE A — Cuenta de desarrollador *(tú)*
1. Cuenta creada y **$25 pagados** ✅.
2. **Verificación de identidad** en curso (Google revisa tus documentos — tarda días). ⏳
   - Completa también la **verificación de teléfono** (Play Console → "Ver detalles").
   - No podrás **publicar** hasta que Google apruebe la identidad. Todo lo demás se puede ir dejando listo.

### FASE B — Crear la app en Play Console *(tú)*
3. Play Console → **"Crear aplicación"**:
   - Nombre: **Evalúa Fácil** · Idioma predeterminado: **Español (México)**
   - Tipo: **Aplicación** · **Gratuita**
   - Acepta las declaraciones.

### FASE C — Completar "Configura tu app" *(tú, con los textos de esta carpeta)*
En el tablero de la app, completa cada tarea usando los archivos indicados:
4. **Política de privacidad** → pega `https://evaluafacil.mx/privacidad` (ver [`01-checklist`](01-checklist.md)).
5. **Acceso a la app** → da a los revisores un login de prueba ([`05-acceso-revisores.md`](05-acceso-revisores.md)).
6. **Anuncios** → la app **no** tiene anuncios → responde "No".
7. **Seguridad de los datos** → usa [`03-seguridad-de-datos.md`](03-seguridad-de-datos.md).
8. **Clasificación de contenido** → usa [`04-clasificacion-contenido.md`](04-clasificacion-contenido.md).
9. **Público objetivo y contenido** → grupos de edad: **13-15, 16-17 y 18+** (educación media superior). NO marcar "diseñada para niños".
10. **App gubernamental** → No. **Funciones financieras** → No (la suscripción se cobra por proveedores externos, no es una función financiera dentro de la app).

### FASE D — Ficha de la tienda *(tú, con [`02-ficha-tienda.md`](02-ficha-tienda.md))*
11. Nombre, descripción corta y completa.
12. **Icono** 512×512 (ya lo tienes: la hojita) · **Gráfico destacado** 1024×500 (`assets/`).
13. **Capturas** de teléfono (mín. 2). Ver [`01-checklist`](01-checklist.md) — algunas hay que tomarlas con sesión iniciada.
14. Categoría: **Educación** · Datos de contacto (correo).

### FASE E — Subir el instalable *(tú)*
15. **Prueba y lanzamiento → Prueba interna → Crear versión**.
16. **Sube el AAB**: `~/evaluafacil-android/evalua-facil-v1.0-release.aab` (ver [`06-firma-y-aab.md`](06-firma-y-aab.md)).
17. Al subir, **acepta Play App Signing** (Google guarda la clave de firma real; tu keystore solo firma las subidas).
18. Agrega notas de la versión y guarda.

### FASE F — Prueba cerrada y producción
19. ⚠️ **Cuentas personales nuevas:** antes de publicar en producción, Google exige una **prueba cerrada con 12 probadores durante 14 días**. Crea una pista de **Prueba cerrada**, agrega ≥12 correos de probadores (pueden ser conocidos), y déjala correr 14 días.
20. Cumplido el requisito y **aprobada tu identidad**, aplica para **acceso a producción** y crea la versión de producción.
21. **Envía a revisión.** La revisión de Google tarda de unos días a ~2 semanas para cuentas nuevas.

---

## Actualizaciones futuras (para la v1.1, v2, …)
Cada vez que subas una versión nueva hay que **incrementar el `versionCode`** (y opcionalmente el `versionName`) en `android/app/build.gradle`, y recompilar el AAB (ver [`06-firma-y-aab.md`](06-firma-y-aab.md)). El `versionCode` debe ser siempre mayor al anterior o Play rechaza la subida.
