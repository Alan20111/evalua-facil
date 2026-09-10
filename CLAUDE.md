# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Evalúa Fácil

React + Firebase SPA for Mexican SEP teachers to manage grades, activities, and student attendance. Deployed on Vercel at `evalua-facil.vercel.app`.

## Commands

```bash
npm run dev       # local dev server (Vite)
npm run build     # production build → dist/
npm run lint      # ESLint
npm run preview   # preview production build locally
```

No unit/integration tests for the UI. There IS a rules suite:

```bash
npm run test:rules    # emulador de Firestore + test/firestore-rules.test.mjs
```

Necesita **JDK 21+** (firebase-tools ya no acepta menos). En la máquina de Kike
el que sirve es el de Android Studio:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
```

## Credenciales de IA (Anthropic)

### Secreto de producción

**Nombre en GCP Secret Manager:** `ANTHROPIC_API_KEY_PROD`
**Proyecto GCP:** `evalua-facil-app`
**Funciones que lo usan:** `ejecutarOperacionIA` (`functions/ia.js`) y `chatAdmin` (`functions/adminChat.js`)
**Dónde se crea la key:** console.anthropic.com → Settings → API Keys
**Nombre sugerido en Anthropic:** `EVALUA-FACIL-PROD`
**Expiración:** ninguna (nunca poner fecha de expiración a la key de producción)

### Separación producción / pruebas

- Las keys de **prueba o desarrollo** NO deben existir en GCP Secret Manager bajo ningún nombre.
- Solo el secreto `ANTHROPIC_API_KEY_PROD` llega a Cloud Functions de producción.
- Para pruebas locales contra Anthropic, usar una variable de entorno temporal en la terminal, nunca commiteada.

### Cómo rotar la key de producción (sin downtime)

1. Ir a console.anthropic.com → Settings → API Keys → **Create Key**
   - Nombre: `EVALUA-FACIL-PROD` (o sufijo `-v2`, `-v3`, etc.)
   - Expiración: **ninguna**
2. Configurar la nueva versión del secreto:
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY_PROD --data-file=C:\Users\Kike\anthropic-key.txt
   ```
   El archivo contiene **solo la key**, sin salto de línea final, fuera del
   repositorio, y se borra en cuanto termina el comando. En Windows el modo
   interactivo (pegar en el prompt) puede guardar un solo carácter o un salto
   de línea sin avisar — así fue el incidente del 9-sep-2026. NUNCA pegar la
   key en el chat ni en código.
3. Redesplegar las funciones (para que las nuevas instancias lean la nueva versión):
   ```bash
   firebase deploy --only functions
   ```
4. Esperar 60 segundos; verificar en Firebase Console → Functions → Logs que no hay errores 401.
5. Realizar una prueba manual en producción: generar una rúbrica u otra operación de IA.
6. Solo si la prueba es exitosa: revocar la key anterior en Anthropic Console.
7. Verificar nuevamente los logs después de la revocación.

### Ante un error 401 de Anthropic en producción

Señal: los logs de Firebase muestran `AuthenticationError: 401 / API key is invalid.`

1. **No revocar la key actual hasta tener una nueva funcionando.**
2. Verificar el estado de `ANTHROPIC_API_KEY_PROD` en GCP:
   ```bash
   firebase functions:secrets:describe ANTHROPIC_API_KEY_PROD
   ```
3. Ir a Anthropic Console y comprobar que la key activa no fue revocada/expirada.
4. Si fue revocada: crear nueva key y seguir el procedimiento de rotación (arriba).
5. Si sigue activa: abrir soporte con Anthropic.

### Ante `invalid x-api-key header` / `APIConnectionError: Connection error`

Señal: los logs muestran `IA(...) falló: APIConnectionError: Connection error`
con `cause: InvalidArgumentError: invalid x-api-key header`. **No es una caída
de Anthropic ni un 401**: el valor del secreto está mal cargado (vacío, con un
salto de línea, con un carácter suelto), y undici rechaza la cabecera antes de
salir a la red.

Desde el 9-sep-2026 `ejecutarOperacionIA` y `chatAdmin` comprueban la forma de
la key antes de reservar créditos, así que este caso aparece como
`failed-precondition` con el mensaje "La IA no está configurada correctamente
en el servidor" y un `logger.error` que dice cuántos caracteres tiene.

Comprobar la forma del secreto sin imprimirlo (PowerShell):

```bash
$p = firebase functions:secrets:access ANTHROPIC_API_KEY_PROD | Out-String
"len=$($p.Trim().Length) ok=$($p.Trim() -match '^sk-ant-[\x21-\x7E]{20,}$')"
```

Si no sale `ok=True`, volver a cargar el secreto con `--data-file` (paso 2 de
la rotación) y **redesplegar las funciones**: la versión del secreto queda
fijada en el despliegue, así que cargar una versión nueva no basta.

### Qué NO hacer

- **Nunca** poner una key de prueba en `ANTHROPIC_API_KEY_PROD`.
- **Nunca** poner fecha de expiración a la key de producción.
- **Nunca** pegar la key en el chat, en código, en `.env`, en logs ni en documentación.
- **Nunca** revocar la key anterior antes de confirmar que la nueva funciona.
- **Nunca** usar `ANTHROPIC_API_KEY` (sin `_PROD`) — ese nombre fue reemplazado en sep-2026 precisamente para evitar que una key de prueba ocupara el slot de producción.

### Smoke test manual post-deploy

Después de cualquier deploy de Cloud Functions que toque IA:
1. Abrir Evalúa Fácil en producción como docente con créditos.
2. Generar una rúbrica (operación IA más común).
3. Confirmar que se obtiene respuesta y que el crédito se descuenta.
4. Revisar Firebase Console → Functions → Logs: ausencia de `AuthenticationError`.

---

### Candado de suscripción (servidor)

Un docente sin suscripción vigente puede leer y exportar, pero no escribir. El
candado tiene dos capas y las dos deben moverse juntas:

1. **Cliente** — `src/utils/firestoreGuard.js` intercepta las escrituras de las
   pantallas del docente y abre la ventana de pago. Es la capa amable.
2. **Servidor** — `firestore.rules` (`docenteActivo()`) compara `request.time`
   contra `users/{uid}.suscripcionHasta`, que espeja la Cloud Function
   `onSuscripcionEscrita` en cada cambio de la suscripción. Es la que de verdad
   no se puede rodear.

El campo AUSENTE deja pasar a propósito (un dato faltante no debe dejar a nadie
fuera de su trabajo), así que al instalar esto hay que correr una vez
`seeds-db/backfill-suscripcion.js`. Orden de despliegue: **functions → backfill
→ rules**.

**Database scripts** (destructive — wipe all Firestore data):
```bash
cd seeds-db && bash clear-db-firebase-cli.sh   # requires firebase-cli + firebase login
cd seeds-db && npm install && node clear-db.js  # requires Firebase Admin SDK credentials
```

## Stack

- **React 19 + Vite 8** — SPA, no SSR
- **Tailwind CSS v3** — utility classes only; **blue only** for teacher/admin UI (never indigo)
- **Firebase** — Auth + Firestore (no Storage, no Functions, no backend)
- **React Router v7** — `<BrowserRouter>`, Vercel rewrites all paths to `index.html`
- **EmailJS** (`@emailjs/browser`) — client-side email via HTML template with `{{{html_content}}}` (triple braces = unescaped HTML in Handlebars)
- **lucide-react** — icons throughout

## Architecture

### Auth & roles

Three user types share Firebase Auth:

| Role | Email pattern | Firestore doc |
|------|--------------|---------------|
| Teacher (`docente`) | real email | `users/{uid}` |
| Student (`alumno`) | `{username}.{escuelaId}@evalua.local` | `students/{id}` (not `users`) |
| Admin (`admin`) | real email | `users/{uid}` with `role: 'admin'` |

`AuthContext` (`src/context/AuthContext.jsx`) runs `onAuthStateChanged`, fetches the `users/{uid}` doc, enriches it with the school name from `schools/{escuelaId}`, and exposes `{ currentUser, userProfile, loading, setUserProfile }`. It also migrates legacy CCT-based teacher usernames (starting with a digit) to the short-name format on first login.

`ProtectedTeacher` in `App.jsx` gates the teacher routes; it allows through if authenticated regardless of email verification (verification is optional — shown as in-app banner only). Students go through `ProtectedStudent`.

### Routes

```
/            → RootRedirect (teacher login or /dashboard)
/docente     → same RootRedirect
/register    → TeacherRegister
/alumno      → StudentLogin
/activate/:code → StudentActivation
/dashboard   → TeacherDashboard (protected)
/subject/:id → SubjectPage (protected)
/activity/:id → ActivityPage (protected)
/profile     → Profile (protected)
/admin       → (planned) AdminLogin/redirect
```

### Firestore collections

| Collection | Key fields | Notes |
|-----------|-----------|-------|
| `schools` | `claveSEP`, `shortName`, `nombre` | Created on first teacher from a school |
| `users` | `role`, `username`, `escuelaId`, `email` | Teachers + admins |
| `students` | `username`, `escuelaId`, `asignaturaId`, `activado`, `resetPassword` | Public read (needed for QR activation) |
| `subjects` | `docenteId`, `accessCode`, `archived`, `parciales`, `ciclo` | Public read (needed for QR activation) |
| `activities` | `asignaturaId`, `docenteId`, `parcial`, `maxCalif` | |
| `submissions` | `actividadId`, `alumnoId`, `calificacion` | |
| `attendance` | `asignaturaId`, `docenteId`, `fecha` | |

**Critical Firestore constraint**: Only single-field equality queries or multiple `where('==')` filters are permitted. **No range operators (`<`, `>`, `!=`), no `orderBy` in queries.** Sort results in memory. The deployed composite indexes are in `firestore.indexes.json` — do not add new multi-field indexes without deploying them there first.

### Username formats

- **Teachers**: `{SchoolShortName}-{seq}` e.g. `CBTIS255-01` — generated in `Register.jsx` by counting existing teachers at that school
- **Students**: 4-char code derived from name initials via `generateUsername()` in `src/utils/generate.js`
- **Temp passwords**: 4-char alphanumeric via `generateResetPassword()` in `src/utils/generate.js`

### Student auth flow

Students never have real emails. Firebase Auth uses fake emails: `${username.toLowerCase()}.${escuelaId}@evalua.local` (built by `studentEmail()` in `src/utils/generate.js`).

**First activation**: Student scans QR or enters code → `/activate/:code` → creates Firebase Auth account → sets `activado: true` + `uid` in Firestore.

**Teacher password reset**: Teacher generates temp password → stored in `students/{id}.resetPassword` + `activado: false` → on next login, `StudentLogin` detects `resetPassword` and navigates to `/activate/:code` with `{ prefillUsername }` state → `Activation.jsx` catches `auth/email-already-in-use`, signs in with temp password, calls `updatePassword`.

### School catalog

`/public/planteles.json` (~290 KB, ~1700 Mexican CBT/CETIS/CBTIS campuses). Fetched lazily via `usePlanteles()` hook (`src/data/usePlanteles.js`) and cached at module level — only loaded on Register and Profile pages.

### EmailJS

Credentials in `.env.local` (not committed) and Vercel environment variables:
- `VITE_EMAILJS_SERVICE_ID`
- `VITE_EMAILJS_TEMPLATE_ID`
- `VITE_EMAILJS_PUBLIC_KEY`

Template body is just `{{{html_content}}}`. The full HTML email is built in `src/utils/welcomeEmail.js` and passed as a single variable. Sending is best-effort — failures are caught and ignored so they don't break registration.

### Layout

`src/components/Layout.jsx` (`TeacherLayout`) — desktop sidebar + mobile top-bar/bottom-nav. Used by all teacher-protected pages. Also owns the "Nueva asignatura" modal and loads sidebar subject list independently of page content.

## Environment variables

Copy `.env.example` to `.env` for local dev. All vars are `VITE_` prefixed (public, client-side):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_CLOUDINARY_CLOUD_NAME
VITE_CLOUDINARY_UPLOAD_PRESET
VITE_EMAILJS_SERVICE_ID
VITE_EMAILJS_TEMPLATE_ID
VITE_EMAILJS_PUBLIC_KEY
```

## Git workflow

Use **feature branches + pull requests** — never commit directly to `main`.

```bash
# Start every task
git checkout -b feat/short-description   # or fix/, chore/

# When done: build, commit, push, open PR
npm run build
git add <files>
git commit -m "feat(...): ..."
git push -u origin feat/short-description
gh pr create --title "..." --body "..."
```

PRs merge into `main` → Vercel auto-deploys. Always push immediately after committing (no confirmation needed).

## Deployment

Push to `main` → Vercel auto-deploys. Config in `vercel.json` (Vite framework, all routes → `index.html`). Firestore security rules and indexes are **not** auto-deployed — run `firebase deploy --only firestore` manually when `firestore.rules` or `firestore.indexes.json` change.
