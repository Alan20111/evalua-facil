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

No test suite. There are no unit or integration tests.

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
