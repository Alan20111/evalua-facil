CONTEXTO COMPLETO DEL PROYECTO — EVALUA FACIL
Documento generado para lectura por IA. Texto plano, exhaustivo (carpeta por carpeta,
archivo por archivo, funcion por funcion) + diagramas en texto al final.
Fecha de generacion: 2026-06-27

===== 1. RESUMEN DEL PROYECTO =====

Nombre: Evalua Facil
Que es: Aplicacion web (SPA) para docentes de la SEP de Mexico que permite gestionar
  calificaciones, actividades y alumnos de sus asignaturas. Incluye acceso para alumnos
  (entregas) y un panel de administrador (planes, suscripciones, pagos).
Dominio en produccion: https://evalua-facil.vercel.app
Tipo de app: Single Page Application, sin SSR.

Stack principal:
  - React 19 + Vite 8 (SPA, sin servidor de render).
  - Tailwind CSS v3 (solo utilidades). Theming por rol via variable CSS --accent
    (docente azul #2563eb, alumno naranja #f97316) y paleta por asignatura.
  - Firebase: Authentication + Cloud Firestore. No se usa Firebase Storage para
    archivos de la app, no hay Cloud Functions; la logica vive en el cliente.
  - React Router v7 (BrowserRouter); Vercel reescribe todas las rutas a index.html.
  - EmailJS para correo del lado del cliente (plantilla con {{{html_content}}}).
  - lucide-react para iconos. qrcode/qrcode.react para QR. xlsx, jspdf, jszip para exportes.
  - Backend serverless en api/ (Vercel Functions) SOLO para pagos: MercadoPago + PayPal,
    usando Firebase Admin SDK. Los secretos viven en variables de entorno de Vercel,
    nunca en el cliente ni en Firestore.

Roles de usuario (comparten Firebase Auth):
  - Docente (role 'docente'): correo real, doc en users/{uid}.
  - Alumno (role 'alumno'): email falso {username}.{escuelaId}@evalua.local, doc en students/{id}.
  - Administrador (role 'admin'): correo real, doc en users/{uid} con role 'admin'.

Restriccion critica de Firestore:
  Solo se permiten queries de igualdad (== / in) o varios where('=='). NO hay operadores
  de rango (<, >, !=), NO hay orderBy en las queries. Todo orden/filtro por rango se hace
  en memoria. Los indices compuestos desplegados estan en firestore.indexes.json.

Comandos:
  npm run dev      -> servidor de desarrollo (Vite)
  npm run build    -> build de produccion a dist/
  npm run lint     -> ESLint
  npm run preview  -> previsualizar build
  No hay suite de pruebas (no unit/integration tests).
  seeds-db/ contiene scripts de base de datos (varios DESTRUCTIVOS).

Despliegue:
  Push a main -> Vercel auto-despliega. Reglas e indices de Firestore NO se auto-despliegan;
  se corre "firebase deploy --only firestore" manualmente cuando cambian firestore.rules o
  firestore.indexes.json.

===== 2. ESTRUCTURA DE CARPETAS (vista general) =====

raiz/
  index.html              Punto de entrada HTML (monta React en #root).
  vite.config.js          Config de Vite (plugin React).
  tailwind.config.js      Tokens de diseño (colores, radios, sombras, tipografia Outfit).
  postcss.config.js       PostCSS (tailwind + autoprefixer).
  eslint.config.js        Reglas de ESLint.
  vercel.json             Framework Vite + rewrites de todas las rutas a index.html.
  firebase.json           Config de Firebase (hosting/reglas/indices para el CLI).
  firestore.rules         Reglas de seguridad de Firestore.
  firestore.indexes.json  Indices compuestos desplegados.
  storage.rules           Reglas de Storage (no se usa Storage para archivos de app).
  package.json            Dependencias y scripts.
  CLAUDE.md, README.md, SETUP.md  Documentacion.
  public/
    manifest.json         Manifest PWA.
    planteles.json        Catalogo (~1700 planteles CBT/CETIS/CBTIS, ~290 KB).
  docs/                   Planes de cambios y diseño (PLAN_*.md) y este contexto.
  api/                    Funciones serverless (Vercel) para pagos.
    _lib/                 Utilidades del backend (firebaseAdmin, billing, paypal).
    mp/                   Endpoints MercadoPago (create-preference, webhook).
    paypal/               Endpoints PayPal (create-order, capture-order).
  seeds-db/               Scripts Node para sembrar/limpiar/migrar la base de datos.
  src/
    main.jsx              Bootstrap de React (createRoot, providers).
    App.jsx               Rutas, guards por rol, RootRedirect, theming por rol.
    firebase.js           Inicializacion de Firebase (auth, db) desde env VITE_*.
    index.css, App.css    Estilos globales y tokens.
    context/AuthContext.jsx   Estado de sesion y perfil del usuario.
    hooks/                useSubscription, useAdminStats, usePaymentConfig.
    data/usePlanteles.js  Carga perezosa del catalogo de planteles.
    config/               billing.js (planes/precios), fileTypes.js (tipos de archivo).
    components/           Layout, AdminLayout, modales, selects, primitivos ui/.
    pages/
      Landing.jsx         Pantalla inicial por rol.
      teacher/            Login, Register, RegisterSchool, Dashboard, SubjectPage,
                          ActivityPage, Profile, VerifyEmail, PagoResultado.
      student/            Login, Activation, Dashboard, SubjectPage, ActivityPage.
      admin/              Dashboard + components/ (planes, pagos, suscripciones, usuarios, config).
    utils/                Logica reutilizable (excel, pdf, generate, copySubject,
                          deleteSubjectCascade, downloadSubmissions, studentLookup,
                          subjectIcons, subjectName, subscriptionHelpers, welcomeEmail,
                          dateRange, activityVisibility).

A continuacion: el detalle archivo por archivo y funcion por funcion, seguido del
modelo de datos y los diagramas (casos de uso, entidad-relacion y relacional).



===== INFRAESTRUCTURA Y CONFIGURACION =====

ARCHIVO: src/main.jsx
LINEAS: 11
OBJETIVO: Punto de entrada de la SPA; monta React en el DOM e importa estilos y la fuente.
EXPORTA: nada (modulo de arranque, ejecuta efecto al importar)
  FN (modulo de nivel superior): monta la app en #root con createRoot
    estado: (no aplica)
    efectos: (no aplica; ejecucion directa al cargar el modulo)
    datos: (ninguno)
    logica:
      importa la fuente variable '@fontsource-variable/outfit'
      importa estilos globales './index.css'
      importa el componente raiz App desde './App.jsx'
      createRoot(document.getElementById('root')).render(...) envuelto en <StrictMode>
DATOS: (ninguna coleccion Firestore tocada)
DEPENDENCIAS:
  ./index.css (estilos globales + tokens Tailwind)
  ./App.jsx (componente raiz con router y providers)
  @fontsource-variable/outfit (fuente, externo)
  react / react-dom/client (externo)

ARCHIVO: src/App.jsx
LINEAS: 111
OBJETIVO: Componente raiz; define el arbol de providers, el theming por rol y TODAS las rutas de React Router con sus guards.
EXPORTA: default App (componente); internos no exportados: ProtectedAdmin, ProtectedTeacher, ProtectedStudent, RootRedirect, RoleWrapper

  FN ProtectedAdmin({ children }): guard de ruta para administradores
    estado: (ninguno; consume contexto)
    efectos: (ninguno)
    datos: (ninguno; lee del AuthContext)
    logica:
      lee { currentUser, userProfile, loading } via useAuth()
      si loading -> retorna null (no renderiza nada mientras carga el perfil)
      si NO currentUser -> <Navigate to="/" replace />
      si userProfile?.role !== 'admin' -> <Navigate to="/" replace />
      en caso contrario renderiza children
      nota: ruta protegida usada en /Admin

  FN ProtectedTeacher({ children }): guard de ruta para docentes
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno; lee del AuthContext)
    logica:
      lee { currentUser, userProfile, loading } via useAuth()
      si loading -> null
      si NO currentUser -> <Navigate to="/" replace />
      si userProfile?.role === 'admin' -> <Navigate to="/Admin" replace /> (redirige admin a su panel)
      si userProfile existe y role !== 'docente' -> <Navigate to="/alumno" replace /> (saca a alumnos)
      en caso contrario renderiza children
      nota: permite pasar aunque el correo NO este verificado (verificacion es opcional, solo banner)
      protege /dashboard, /subject/:subjectId, /activity/:activityId, /profile

  FN ProtectedStudent({ children }): guard de ruta para alumnos
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno; lee del AuthContext)
    logica:
      lee { currentUser } via useAuth() (NO comprueba loading ni role)
      si NO currentUser -> <Navigate to="/alumno" replace />
      en caso contrario renderiza children
      nota: guard mas laxo que los otros; solo exige sesion de Firebase Auth
      protege /alumno/dashboard, /alumno/materia/:subjectId, /alumno/actividad/:activityId

  FN RootRedirect({ guest = <TeacherLogin /> }): decide a donde mandar al visitar "/" o "/docente"
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno; lee del AuthContext + inspecciona currentUser.email)
    logica:
      lee { currentUser, userProfile, loading } via useAuth()
      si loading -> null
      si NO currentUser -> renderiza el elemento `guest` (por defecto <TeacherLogin />; en "/" se pasa <Landing />)
      si role === 'admin' -> <Navigate to="/Admin" replace />
      si role === 'docente' -> <Navigate to="/dashboard" replace />
      si NO hay userProfile (perfil aun no resuelto / alumno sin doc users):
        si currentUser.email termina en '@evalua.local' -> <Navigate to="/alumno/dashboard" replace /> (heuristica de correo de alumno)
        si no -> null
      caso final (userProfile existe pero no admin ni docente) -> <Navigate to="/alumno/dashboard" replace />

  FN RoleWrapper({ children }): aplica el tema de acento (color) segun rol o ruta
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      lee { userProfile } via useAuth() y { pathname } via useLocation()
      isStudentRoute = pathname empieza con '/alumno' o con '/activate'
      role = (userProfile?.role === 'alumno' o isStudentRoute) ? 'alumno' : 'docente'
      renderiza <div data-role={role}>{children}</div>
      efecto visual: el atributo data-role activa los overrides CSS de --accent en index.css (naranja alumno / azul docente)
      cubre rutas pre-login: /alumno y /activate ya pintan en naranja antes de autenticar

  FN App(): componente raiz; arma providers, theming y tabla de rutas
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno directamente; AuthProvider hace las lecturas Firestore)
    logica (orden de anidamiento de providers):
      <BrowserRouter>  (React Router v7, modo history; Vercel reescribe a index.html)
        <AuthProvider>  (sesion Firebase + perfil + nombre de escuela)
          <ToastProvider>  (notificaciones in-app)
            <RoleWrapper>  (tema por rol)
              <Routes> ... </Routes>
    RUTAS DEFINIDAS (path -> elemento -> guard):
      Publicas:
        "/"                    -> <RootRedirect guest={<Landing />} />            (sin guard; landing o redireccion)
        "/docente"             -> <RootRedirect />                               (guest por defecto = TeacherLogin)
        "/register"            -> <TeacherRegister />                            (registro docente)
        "/register/school"     -> <RegisterSchool />                             (alta de escuela)
        "/alumno"              -> <StudentLogin />                               (login alumno)
        "/activate/:accessCode"-> <StudentActivation />                          (activacion via QR/codigo; param accessCode)
        "/verify-email"        -> <VerifyEmail />                                (verificacion de correo docente)
        "/pago-resultado"      -> <PagoResultado />                              (callback de retorno tras pago MP/PayPal)
      Admin (protegida ProtectedAdmin):
        "/Admin"               -> <AdminDashboard />                             (OJO: ruta con A mayuscula)
      Docente (protegidas ProtectedTeacher):
        "/dashboard"           -> <TeacherDashboard />
        "/subject/:subjectId"  -> <SubjectPage />                                (param subjectId)
        "/activity/:activityId"-> <ActivityPage />                               (param activityId)
        "/profile"             -> <Profile />
      Alumno (protegidas ProtectedStudent):
        "/alumno/dashboard"            -> <StudentDashboard />
        "/alumno/materia/:subjectId"   -> <StudentSubjectPage />                 (param subjectId)
        "/alumno/actividad/:activityId"-> <StudentActivityPage />               (param activityId)
      Fallback:
        "*"                    -> <Navigate to="/" replace />                     (cualquier ruta desconocida vuelve al inicio)
    nota de discrepancia con CLAUDE.md: el archivo real usa "/register/school", "/verify-email", "/pago-resultado",
      "/Admin", "/alumno/dashboard", "/alumno/materia/:subjectId", "/alumno/actividad/:activityId" y un guest=<Landing /> en "/";
      el resumen de CLAUDE.md esta desactualizado respecto a estas rutas.
DATOS: ninguna lectura/escritura Firestore directa en App.jsx; toda la I/O de auth/perfil ocurre dentro de AuthProvider (AuthContext).
DEPENDENCIAS (imports internos):
  ./context/AuthContext (AuthProvider, useAuth)
  ./components/Toast (ToastProvider)
  ./pages/Landing
  ./pages/teacher/Login (TeacherLogin)
  ./pages/teacher/Register (TeacherRegister)
  ./pages/teacher/RegisterSchool
  ./pages/teacher/Dashboard (TeacherDashboard)
  ./pages/teacher/SubjectPage
  ./pages/teacher/ActivityPage
  ./pages/teacher/Profile
  ./pages/teacher/VerifyEmail
  ./pages/teacher/PagoResultado
  ./pages/student/Activation (StudentActivation)
  ./pages/student/Login (StudentLogin)
  ./pages/student/Dashboard (StudentDashboard)
  ./pages/student/SubjectPage (StudentSubjectPage)
  ./pages/student/ActivityPage (StudentActivityPage)
  ./pages/admin/Dashboard (AdminDashboard)
  react-router-dom (BrowserRouter, Routes, Route, Navigate, useLocation) (externo)

ARCHIVO: src/firebase.js
LINEAS: 17
OBJETIVO: Inicializa la app de Firebase y expone los handles de Auth y Firestore usados en todo el proyecto.
EXPORTA: named { auth, db }; default app (instancia FirebaseApp)
  FN (modulo de nivel superior): inicializa Firebase desde variables de entorno
    estado: (no aplica)
    efectos: (no aplica)
    datos: configura el cliente que luego lee/escribe Firestore (no ejecuta queries aqui)
    logica:
      construye firebaseConfig con import.meta.env.VITE_FIREBASE_* :
        apiKey            <- VITE_FIREBASE_API_KEY
        authDomain        <- VITE_FIREBASE_AUTH_DOMAIN
        projectId         <- VITE_FIREBASE_PROJECT_ID
        messagingSenderId <- VITE_FIREBASE_MESSAGING_SENDER_ID
        appId             <- VITE_FIREBASE_APP_ID
      app = initializeApp(firebaseConfig)
      export const auth = getAuth(app)
      export const db = getFirestore(app)
      export default app
      nota: NO inicializa Storage, Functions ni Analytics (no se usan); no incluye measurementId
DATOS: provee `db` (Firestore) y `auth` (Authentication) consumidos por contextos, paginas y utils.
DEPENDENCIAS:
  firebase/app (initializeApp) (externo)
  firebase/auth (getAuth) (externo)
  firebase/firestore (getFirestore) (externo)
  variables de entorno VITE_FIREBASE_* (ver .env / Vercel)

ARCHIVO: index.html
LINEAS: 30
OBJETIVO: Documento HTML raiz que Vite sirve; declara metadatos PWA/SEO, el contenedor #root y carga el bundle.
EXPORTA: (no aplica; es HTML estatico)
  Contenido relevante:
    <html lang="es">  (idioma espanol)
    <title>Evalúa Fácil</title>
    meta description: "Plataforma de gestion de calificaciones SEP"
    meta theme-color: #2563eb (azul; coincide con acento docente)
    link manifest -> /manifest.json (PWA)
    favicons: /favicon.svg (svg+xml) y /icon-192.png (png 192x192)
    metas iOS/Safari: apple-mobile-web-app-capable=yes, status-bar-style=black-translucent, title=Evalúa Fácil, apple-touch-icon=/apple-touch-icon.png
    meta Android: mobile-web-app-capable=yes
    body: <div id="root"></div> (punto de montaje de React)
    <script type="module" src="/src/main.jsx"></script> (entrada del bundle)
DATOS: (ninguno)
DEPENDENCIAS:
  /src/main.jsx (entrada JS)
  /manifest.json, /favicon.svg, /icon-192.png, /apple-touch-icon.png (assets en public/)

ARCHIVO: src/index.css
LINEAS: 58
OBJETIVO: Hoja de estilos global; carga Tailwind y define los design tokens (CSS variables) de superficie y de acento por rol/materia.
EXPORTA: (CSS; sin exports)
  Estructura:
    @tailwind base / components / utilities  (directivas de Tailwind v3)
    @layer base:
      body -> @apply bg-surface text-on-surface font-sans antialiased
      #root -> @apply min-h-screen
      :root tokens de superficie (neutros "luminous"):
        --surface #faf8ff, --surface-dim #d2d9f4, --surface-container #eaedff, --surface-card #ffffff
        --on-surface #131b2e, --on-surface-variant #414753, --outline #717785, --outline-variant #c0c6d5
      :root tokens de acento por defecto (docente / azul):
        --accent #2563eb, --accent-hover #1d4ed8, --accent-light #dbeafe
      override [data-role='docente']: mismo azul (#2563eb / #1d4ed8 / #dbeafe)
      override [data-role='alumno']: naranja (--accent #f97316, --accent-hover #ea580c, --accent-light #ffedd5)
      overrides por paleta de materia [data-subject-palette='...']:
        default -> azul (#2563eb / #1d4ed8 / #dbeafe)
        orange  -> #f97316 / #ea580c / #ffedd5
        purple  -> #9333ea / #7e22ce / #f3e8ff
        green   -> #16a34a / #15803d / #dcfce7
        rose    -> #e11d48 / #be123c / #ffe4e6
        teal    -> #14b8a6 / #0d9488 / #ccfbf1
    @layer utilities:
      .safe-bottom -> padding-bottom: env(safe-area-inset-bottom, 0px)  (para barras inferiores en moviles con notch)
  logica de theming:
    el atributo data-role lo pone RoleWrapper (App.jsx); data-subject-palette lo pone un wrapper dentro de paginas de materia.
    las clases Tailwind accent / accent-hover / accent-light (definidas en tailwind.config.js) resuelven a estas variables, por eso el color cambia segun el ancestro.
DATOS: (ninguno)
DEPENDENCIAS: Tailwind (procesado por PostCSS); consumido por tailwind.config.js (mapea CSS vars a clases).

ARCHIVO: src/App.css
LINEAS: 185
OBJETIVO: CSS heredado de la plantilla Vite (demo de logos/hero/next-steps); aparentemente residual, no parte del diseno actual de la app.
EXPORTA: (CSS; sin exports)
  Contenido:
    .counter, .hero (.base/.framework/.vite), #center, #next-steps, #docs, #spacer, .ticks
    usa variables --accent, --accent-bg, --accent-border, --border, --text-h, --social-bg, --shadow
    (estas variables --accent-bg/--accent-border/--border/etc NO estan definidas en index.css; son del scaffold original de Vite)
  nota: estilos de la pantalla de bienvenida de Vite; (no determinado) si algun componente actual aun lo importa, pero parece codigo muerto del template inicial.
DATOS: (ninguno)
DEPENDENCIAS: ninguna interna; depende de variables CSS no definidas en el proyecto actual.

ARCHIVO: vite.config.js
LINEAS: 8
OBJETIVO: Configuracion de Vite (bundler/dev server) para la SPA React.
EXPORTA: default defineConfig({...})
  Configuracion:
    plugins: [react()]  -> @vitejs/plugin-react (Fast Refresh, JSX/TSX, Babel)
    sin alias, sin proxy, sin ajustes de build personalizados (usa defaults: salida a dist/, entrada index.html)
DATOS: (ninguno)
DEPENDENCIAS: vite (defineConfig), @vitejs/plugin-react (externos)

ARCHIVO: tailwind.config.js
LINEAS: 58
OBJETIVO: Configuracion de Tailwind v3; mapea los design tokens (CSS vars) a clases utilitarias y define tipografia, radios, sombras y escala de fuente.
EXPORTA: default config object
  Configuracion:
    content: ['./index.html', './src/**/*.{js,jsx}']  (rutas a escanear para purga de clases)
    theme.extend:
      fontFamily.sans: ['"Outfit Variable"','Outfit','system-ui','-apple-system','sans-serif']
      colors:
        accent: { DEFAULT: var(--accent), hover: var(--accent-hover), light: var(--accent-light) }  (resueltos en runtime desde index.css)
        surface: { DEFAULT: var(--surface), dim: var(--surface-dim), container: var(--surface-container), card: var(--surface-card) }
        'on-surface': var(--on-surface)
        muted: var(--on-surface-variant)
        outline: { DEFAULT: var(--outline), variant: var(--outline-variant) }
        error: #ba1a1a, 'error-container': #ffdad6
      borderRadius: { DEFAULT: '1rem' (botones/inputs/items), card: '2rem' (tarjetas grandes), pill: '9999px' }
        (lg/xl/2xl conservan defaults de Tailwind para no romper usos previos)
      boxShadow: { card: '0 4px 20px rgba(0,0,0,0.04)', 'card-hover': '0 6px 24px rgba(0,0,0,0.08)' }
      maxWidth.container: '1200px'
      fontSize (escala semantica con lineHeight/letterSpacing/fontWeight):
        headline-xl 32/40 -0.02em 700; headline-lg 24/32 -0.01em 600; title-md 18/24 600
        body-md 16/24; body-sm 14/20; label-caps 12/16 0.05em 700; metadata 12/16
    plugins: []  (ninguno)
DATOS: (ninguno)
DEPENDENCIAS: lee variables CSS definidas en src/index.css; procesado por postcss.config.js.

ARCHIVO: postcss.config.js
LINEAS: 7
OBJETIVO: Pipeline PostCSS que aplica Tailwind y autoprefixer al CSS en el build.
EXPORTA: default { plugins: { tailwindcss: {}, autoprefixer: {} } }
  Configuracion:
    plugin tailwindcss -> compila las directivas @tailwind y purga segun tailwind.config.js
    plugin autoprefixer -> agrega prefijos de proveedor (-webkit-, etc.) automaticamente
DATOS: (ninguno)
DEPENDENCIAS: tailwindcss, autoprefixer (externos); usa tailwind.config.js

ARCHIVO: eslint.config.js
LINEAS: 21
OBJETIVO: Configuracion plana (flat config) de ESLint para JS/JSX con reglas de React Hooks y React Refresh.
EXPORTA: default defineConfig([...])
  Configuracion:
    globalIgnores(['dist'])  (no lintea la salida de build)
    bloque para '**/*.{js,jsx}':
      extends: js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite
      languageOptions.globals: globals.browser
      parserOptions.ecmaFeatures.jsx: true
    nota: no incluye reglas de TypeScript ni config de Prettier
DATOS: (ninguno)
DEPENDENCIAS: @eslint/js, globals, eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint/config (externos)

ARCHIVO: vercel.json
LINEAS: 8
OBJETIVO: Configuracion de despliegue en Vercel; declara framework, build y rewrites para SPA preservando las rutas /api.
EXPORTA: (JSON de config; sin exports)
  Configuracion:
    framework: "vite"
    buildCommand: "npm run build"
    outputDirectory: "dist"
    rewrites: [{ source: "/((?!api/).*)", destination: "/index.html" }]
      -> cualquier ruta que NO empiece por api/ se reescribe a index.html (enrutado client-side de React Router)
      -> las rutas /api/* quedan intactas para que las ejecuten las funciones serverless (pagos MP/PayPal en api/)
DATOS: (ninguno)
DEPENDENCIAS: el directorio api/ (funciones serverless) y el build de Vite (dist/)

ARCHIVO: firebase.json
LINEAS: 20
OBJETIVO: Configuracion de Firebase CLI; declara reglas/indices de Firestore y un bloque de hosting alternativo.
EXPORTA: (JSON de config; sin exports)
  Configuracion:
    firestore.rules    -> "firestore.rules"          (archivo de reglas de seguridad)
    firestore.indexes  -> "firestore.indexes.json"   (indices compuestos desplegados)
    hosting:
      public: "dist"
      ignore: ["firebase.json", "**/.*", "**/node_modules/**"]
      rewrites: [{ source: "**", destination: "/index.html" }]  (SPA fallback en Firebase Hosting)
    nota: el despliegue real es en Vercel; el bloque hosting parece previsto para Firebase Hosting alternativo.
    nota: reglas e indices NO se despliegan automaticamente; requieren `firebase deploy --only firestore` manual.
DATOS: gobierna acceso/indices de las colecciones Firestore (schools, users, students, subjects, activities, submissions, attendance).
DEPENDENCIAS: firestore.rules, firestore.indexes.json; Firebase CLI

ARCHIVO: package.json
LINEAS: 42
OBJETIVO: Manifiesto npm; define scripts, dependencias y metadatos del proyecto (modulo ESM).
EXPORTA: (manifiesto; sin exports de codigo)
  Metadatos: name "gestion-de-escuela", private true, version 0.0.0, type "module"
  scripts:
    dev     -> vite           (servidor de desarrollo)
    build   -> vite build     (build de produccion a dist/)
    lint    -> eslint .       (linting)
    preview -> vite preview   (previsualizar build)
  dependencies (runtime):
    @emailjs/browser ^4.4.1        (envio de correo cliente)
    @fontsource-variable/outfit ^5.2.8  (fuente Outfit variable)
    firebase ^12.14.0              (SDK cliente: Auth + Firestore)
    firebase-admin ^13.10.0        (SDK admin; usado por seeds-db / scripts serverless, no en el cliente)
    jspdf ^4.2.1 + jspdf-autotable ^5.0.8  (generacion de PDF: calificaciones, credenciales)
    jszip ^3.10.1                  (empaquetado ZIP, ej. exportaciones)
    lucide-react ^1.17.0           (iconos)
    qrcode ^1.5.4 + qrcode.react ^4.2.0  (generacion de QR para activacion de alumnos)
    react ^19.2.6 + react-dom ^19.2.6    (UI)
    react-router-dom ^7.17.0       (enrutado)
    xlsx ^0.18.5                   (lectura/escritura de hojas de calculo, import/export)
  devDependencies (build/lint):
    @eslint/js ^10.0.1, eslint ^10.3.0, eslint-plugin-react-hooks ^7.1.1, eslint-plugin-react-refresh ^0.5.2, globals ^17.6.0
    @types/react ^19.2.14, @types/react-dom ^19.2.3
    @vitejs/plugin-react ^6.0.1, vite ^8.0.12
    autoprefixer ^10.5.0, postcss ^8.5.15, tailwindcss ^3.4.19
  nota: no hay suite de pruebas (sin jest/vitest); no hay script de test.
DATOS: (ninguno)
DEPENDENCIAS: define todo el grafo de dependencias del proyecto.

ARCHIVO: public/manifest.json
LINEAS: 25
OBJETIVO: Web App Manifest (PWA); permite instalar la app y define nombre, iconos, colores y modo de presentacion.
EXPORTA: (JSON PWA; sin exports)
  Configuracion:
    name / short_name: "Evalúa Fácil"
    description: "Plataforma de gestion de calificaciones SEP"
    start_url: "/"
    display: "standalone"
    orientation: "portrait"
    background_color: "#f8fafc"
    theme_color: "#4f46e5"  (OJO: indigo; difiere del theme-color azul #2563eb de index.html y del azul de acento docente)
    lang: "es"
    icons:
      /icon-192.png 192x192 image/png purpose "any maskable"
      /icon-512.png 512x512 image/png purpose "any maskable"
DATOS: (ninguno)
DEPENDENCIAS: referenciado por index.html (link rel="manifest"); assets /icon-192.png, /icon-512.png en public/


===== CONTEXTO Y HOOKS =====

NOTA GENERAL DEL FLUJO DE AUTENTICACION
  onAuthStateChanged (en AuthContext) es el unico punto que escucha cambios de sesion de Firebase Auth.
  Secuencia al cambiar el estado de auth:
    1. setCurrentUser(user) guarda el objeto user de Firebase (o null si no hay sesion).
    2. Si hay user:
       a. Lee el doc users/{uid}.
       b. Si existe y tiene escuelaId y role !== 'alumno' (es decir docente o admin):
          - Lee schools/{escuelaId} para ENRIQUECER el perfil con schoolName (schoolData.nombre)
            y claveSEP (schoolData.claveSEP).
          - MIGRACION de usernames legacy: si el username empieza con digito (regex /^\d/, formato
            viejo basado en CCT como "110020-05"), reconstruye el username al formato por nombre corto
            de escuela: toma el sufijo numerico (numPart = lo que sigue al ultimo "-") y el prefijo
            (shortName o nombre de la escuela en MAYUSCULAS sin espacios). Resultado: "CBTIS255-05".
            Persiste el cambio con updateDoc en users/{uid} y actualiza el perfil en memoria.
          - Todo el enriquecimiento/migracion va dentro de try/catch best-effort (si falla, no rompe login).
       c. setUserProfile(profile) con el perfil (ya enriquecido si aplica).
       d. Caso ALUMNO LEGACY: si NO existe users/{uid} pero el email termina en @evalua.local,
          se asume cuenta de alumno sin doc users. Deriva el username del email
          (parte antes del "." dentro del local-part, en MAYUSCULAS), busca en students por
          where('username','==',username) y arma userProfile { role:'alumno', studentId, ...datos }.
          Si no encuentra, userProfile = null.
       e. Otro caso (doc no existe y no es @evalua.local): userProfile = null.
    3. Si no hay user: userProfile = null.
    4. setLoading(false) siempre al final.
  El Provider NO renderiza children mientras loading es true (evita parpadeo de rutas protegidas).


ARCHIVO: src/context/AuthContext.jsx
LINEAS: ~84
OBJETIVO: Provee el contexto de autenticacion global; escucha la sesion de Firebase Auth, carga y
  enriquece el perfil del usuario (docente/admin/alumno) y lo expone a toda la app.
EXPORTA:
  - AuthProvider (componente React, named export)
  - useAuth (hook, named export)
  (AuthContext se crea con createContext pero NO se exporta; se consume via useAuth.)

  FN AuthProvider({ children }): componente proveedor que monta el listener de auth y expone el valor del contexto.
    estado:
      currentUser (objeto user de Firebase Auth o null) — useState(null)
      userProfile (perfil del usuario; docente/admin desde users/{uid} enriquecido, o alumno armado desde students; o null) — useState(null)
      loading (bool, true hasta resolver el primer onAuthStateChanged) — useState(true)
    efectos:
      useEffect con deps [] (solo al montar): suscribe onAuthStateChanged(auth, callback async).
        Retorna unsub para desuscribir al desmontar.
        El callback ejecuta TODO el flujo descrito en "NOTA GENERAL DEL FLUJO DE AUTENTICACION".
    datos:
      getDoc users/{uid} (lee perfil docente/admin).
      getDoc schools/{escuelaId} (enriquecimiento: schoolName, claveSEP, y shortName para migracion).
      updateDoc users/{uid} { username } (solo si migra username legacy basado en CCT).
      getDocs students where('username','==',username) (caso alumno legacy sin doc users).
    logica:
      - Enriquecimiento de perfil con datos de escuela solo si escuelaId y role !== 'alumno'.
      - Migracion de username legacy (/^\d/) a formato {PREFIJO}-{num}; best-effort en try/catch.
      - Deteccion de alumno por email terminado en @evalua.local cuando no hay users/{uid}.
      - Renderiza children solo cuando !loading (provee { currentUser, userProfile, loading, setUserProfile }).

  FN useAuth(): hook de conveniencia para consumir el contexto de autenticacion.
    logica: retorna useContext(AuthContext); da acceso a { currentUser, userProfile, loading, setUserProfile }.
    (setUserProfile se expone para que otras pantallas actualicen el perfil en memoria sin recargar.)

  DATOS:
    users/{uid} — getDoc (lectura del perfil), updateDoc (solo migracion de username).
    schools/{escuelaId} — getDoc (enriquecimiento schoolName/claveSEP/shortName).
    students — getDocs con where username == (resolucion de alumno legacy).
  DEPENDENCIAS:
    Internos: ../firebase (auth, db).
    Externos: react (createContext, useContext, useEffect, useState), firebase/auth (onAuthStateChanged),
      firebase/firestore (collection, doc, getDoc, getDocs, query, updateDoc, where).


ARCHIVO: src/hooks/useSubscription.js
LINEAS: ~75
OBJETIVO: Hook que carga la suscripcion vigente del docente actual, los planes activos disponibles y
  sus pagos recientes; usado por pantallas de plan/suscripcion del docente.
EXPORTA: useSubscription (hook, named export).

  FN useSubscription(): obtiene suscripcion + planes + pagos recientes del docente autenticado.
    estado:
      subscription (la suscripcion mas reciente del docente o null) — useState(null)
      plans (lista de planes activos ordenados por campo orden) — useState([])
      recentPayments (hasta 3 pagos mas recientes del docente) — useState([])
      loading (bool) — useState(true)
    efectos:
      useEffect con deps [load]: invoca load() (carga inicial y al cambiar la funcion load).
    datos (todo dentro de load, en paralelo con Promise.all):
      getDocs plans where('activo','==',true) — planes activos.
      getDocs subscriptions where('docenteId','==',currentUser.uid) — suscripciones del docente.
      getDocs payments where('docenteId','==',currentUser.uid) — pagos del docente.
    logica:
      - load es useCallback con dep [currentUser]; si no hay currentUser, limpia todo (null/[]) y loading=false.
      - planes: map {id,...data} y sort ascendente por (orden || 0).
      - suscripciones: map {id,...data}, sort descendente por updatedAt.toMillis(); toma la primera como subscription (la mas reciente).
      - pagos: map {id,...data}, sort descendente por createdAt.toMillis(); slice(0,3) -> recentPayments.
      - Ordenamientos en memoria (Firestore no permite orderBy/range aqui; ver CLAUDE.md).
      - currentPlan (derivado, fuera de load): busca en plans el plan con id === subscription.planId;
        si no lo encuentra pero hay planId, devuelve un objeto fallback { id:planId, nombre:planId }; si no hay subscription, null.
      - Retorna { subscription, currentPlan, plans, recentPayments, loading, refresh: load }.

  DATOS:
    plans — getDocs where activo == true.
    subscriptions — getDocs where docenteId == uid (lectura).
    payments — getDocs where docenteId == uid (lectura, top 3).
  DEPENDENCIAS:
    Internos: ../firebase (db), ../context/AuthContext (useAuth).
    Externos: react (useState, useEffect, useCallback), firebase/firestore (collection, query, where, getDocs).


ARCHIVO: src/hooks/useAdminStats.js
LINEAS: ~179
OBJETIVO: Hook del panel de administracion; lee TODAS las colecciones de negocio y calcula KPIs,
  distribuciones y agregados (ingresos, conversion, churn, vencimientos, etc.) en memoria.
EXPORTA: useAdminStats (hook, named export).
  (isThisMonth, isWithinDays, isWithinLastDays son helpers internos de modulo, NO exportados.)

  FN isThisMonth(date): determina si una fecha pertenece al mes y anio actuales.
    logica: convierte con toDate; compara getMonth() y getFullYear() contra now; false si no hay fecha valida.

  FN isWithinDays(date, days): determina si una fecha cae entre hoy y hoy+days (rango futuro inclusivo).
    logica: normaliza now a 00:00:00, calcula limit = now + days; retorna d >= now && d <= limit; false si fecha invalida.

  FN isWithinLastDays(date, days): determina si una fecha cae dentro de los ultimos N dias (rango pasado).
    logica: cutoff = now - days; retorna d >= cutoff; false si fecha invalida.

  FN useAdminStats(): carga y agrega estadisticas globales para el dashboard de admin.
    estado:
      stats (objeto con colecciones crudas + kpis + agregados, o null) — useState(null)
      loading (bool) — useState(true)
    efectos:
      useEffect con deps [load]: ejecuta load() al montar.
    datos (load, en paralelo con Promise.all, lectura COMPLETA de colecciones):
      getDocs users
      getDocs students
      getDocs subscriptions
      getDocs payments
      getDocs plans
      getDocs schools
      getDocs subjects
    logica (todo calculado en memoria):
      - load es useCallback con deps [] (sin filtro; carga toda la base, lectura amplia de admin).
      - Mapea cada snapshot a array {id,...data}.
      - Derivados de filtrado:
          teachers = users con role === 'docente'
          activeStudents = students con activado === true
          activeSubs = subscriptions con status === 'activa'
          completedPayments = payments con status === 'completado'
          pendingPayments = payments con status === 'pendiente'
      - Ingresos:
          totalRevenue = suma de monto de completedPayments.
          monthRevenue = suma de monto de completedPayments cuyo createdAt es de este mes (isThisMonth).
      - expiringSoon = activeSubs con fechaVencimiento dentro de 7 dias (isWithinDays) y calcDaysRemaining >= 0.
      - conversionRate = (activeSubs / teachers) * 100 (0 si no hay teachers).
      - subsByPlan = por cada plan, conteo de subscriptions con ese planId y status 'activa'.
      - teachersBySchool: cuenta docentes por escuelaId, mapea a { school: shortName/claveSEP/id, count },
        sort desc por count, top 10. schoolsMap = mapa id->school.
      - revenueByPlan = por cada plan, suma de monto de completedPayments de ese planId.
      - subjectsByTeacher / studentsByTeacher: conteos por docenteId.
      - avgSubjects = total materias / numero de docentes (0 si no hay docentes).
      - avgStudents = total alumnos (con docenteId) / numero de docentes.
      - newTeachersThisMonth = docentes con createdAt de este mes.
      - expiredCount/cancelledCount/trialCount = subscriptions por status ('vencida'/'cancelada'/'trial').
      - churnCount = subscriptions 'cancelada' actualizadas (updatedAt) en los ultimos 30 dias (isWithinLastDays).
      - subsistemaDist: distribucion de docentes por subsistema de su escuela (schoolsMap[escuelaId].subsistema o 'Sin datos').
      - setStats con: colecciones crudas (teachers, students, subscriptions, payments, plans, schools), schoolsMap,
        objeto kpis (teacherCount, activeStudentCount, activeSubCount, trialCount, totalRevenue, monthRevenue,
        pendingPaymentCount, expiringSoonCount, conversionRate, expiredCount, cancelledCount, newTeachersThisMonth,
        avgSubjects, avgStudents, churnCount), y agregados (subsByPlan, teachersBySchool, revenueByPlan,
        subsistemaDist, pendingPayments).
      - Retorna { stats, loading, refresh: load }.

  DATOS:
    Lectura COMPLETA (getDocs sin where) de: users, students, subscriptions, payments, plans, schools, subjects.
    No escribe nada. Todos los agregados/KPIs se computan en cliente.
  DEPENDENCIAS:
    Internos: ../firebase (db), ../utils/subscriptionHelpers (calcDaysRemaining, toDate).
    Externos: react (useState, useEffect, useCallback), firebase/firestore (collection, getDocs).


ARCHIVO: src/hooks/usePaymentConfig.js
LINEAS: ~56
OBJETIVO: Hook que lee la configuracion PUBLICA de pagos (MercadoPago, PayPal, transferencia) desde
  Firestore config/payments, fusionada con valores por defecto. Los secretos viven en env de Vercel, no aqui.
EXPORTA:
  - DEFAULT_PAYMENT_CONFIG (constante, named export)
  - usePaymentConfig (hook, named export)
  (CONFIG_REF es constante interna de modulo: ['config','payments'], no exportada.)

  CONST DEFAULT_PAYMENT_CONFIG: forma por defecto cuando aun no existe el doc de configuracion.
    Campos: moneda 'MXN'; mercadoPago { enabled:false, publicKey:'' }; paypal { enabled:false, clientId:'' };
    transferencia { enabled:false, banco, titular, cuenta, clabe, nota (texto guia por defecto) }.
    Comentario del archivo: solo datos PUBLICOS/mostrables; secretos (token MP, secret PayPal) en Vercel env.

  FN usePaymentConfig(): carga la configuracion de pagos fusionada con defaults.
    estado:
      config (objeto de config fusionado o null mientras carga) — useState(null)
      loading (bool) — useState(true)
    efectos:
      useEffect con deps [load]: ejecuta load() al montar.
    datos:
      getDoc config/payments (lectura de la config; doc apuntado por CONFIG_REF).
    logica:
      - load es useCallback con deps [].
      - Si el doc existe: fusiona DEFAULT_PAYMENT_CONFIG con data, y fusiona profundamente los sub-objetos
        mercadoPago, paypal y transferencia (default + data[...] || {}) para no perder claves faltantes.
      - Si no existe: usa DEFAULT_PAYMENT_CONFIG tal cual.
      - En error (catch): cae a DEFAULT_PAYMENT_CONFIG (degradacion segura).
      - finally: loading=false.
      - Retorna { config, loading, refresh: load }.

  DATOS:
    config/payments — getDoc (solo lectura). No escribe.
  DEPENDENCIAS:
    Internos: ../firebase (db).
    Externos: react (useState, useEffect, useCallback), firebase/firestore (doc, getDoc).


ARCHIVO: src/data/usePlanteles.js
LINEAS: ~47
OBJETIVO: Hook que carga de forma diferida el catalogo estatico de planteles (CCT) desde
  /public/planteles.json, con cache a nivel de modulo; usado solo en Register y Profile.
EXPORTA:
  - usePlanteles (hook, named export)
  - findPlantel (funcion, named export)
  (cache e inflight son variables de modulo internas, no exportadas.)

  FN usePlanteles(): carga lazy y cachea el catalogo de planteles; expone { planteles, loading }.
    estado:
      planteles (array de planteles; inicializa con cache si ya existe) — useState(cache || [])
      loading (bool; inicializa true solo si no hay cache) — useState(!cache)
    efectos:
      useEffect con deps []: si ya hay cache, no hace nada. Si no, dispara (o reutiliza) el fetch.
        - inflight: promesa compartida a nivel de modulo del fetch('/planteles.json'); si falla r.ok lanza error.
        - Al resolver: guarda data en cache, y si el efecto sigue activo (flag active) actualiza planteles y loading=false.
        - En error: si active, loading=false (deja planteles vacios).
        - Cleanup: active=false para ignorar respuestas tras desmontar.
    datos:
      fetch('/planteles.json') — asset estatico desde /public (NO Firestore). Comentario: ~1700 planteles, ~290 KB,
        diferido para no inflar el bundle principal; cache para cargar a lo sumo una vez por sesion.
    logica:
      - Cache e inflight a nivel modulo evitan descargas duplicadas entre instancias del hook.
      - Retorna { planteles, loading }.

  FN findPlantel(planteles, cct): busqueda exacta de un plantel por su CCT (clave del catalogo).
    logica:
      - Normaliza cct: trim + toUpperCase.
      - Si longitud < 5, retorna null (CCT minimo).
      - Retorna el plantel cuyo p.cct === valor, o null si no existe.

  DATOS:
    Ninguna coleccion Firestore. Solo fetch del asset estatico /planteles.json.
  DEPENDENCIAS:
    Internos: ninguno.
    Externos: react (useState, useEffect).


===== COMPONENTES PRINCIPALES Y MODALES =====

ARCHIVO: src/components/Layout.jsx
LINEAS: ~265
OBJETIVO: TeacherLayout, el contenedor visual de todas las paginas protegidas del docente; sidebar de escritorio + barra superior/nav inferior en movil. Carga la lista de asignaturas en tiempo real y muestra el banner de prueba que abre la comparacion de planes.
EXPORTA: componente default TeacherLayout({ children })

  FN TeacherLayout({ children }): renderiza el layout completo del docente y monta el contenido de la pagina dentro de <main>.
    estado:
      subjects: lista completa de asignaturas del docente (activas + archivadas), poblada por onSnapshot.
      loadingSidebar: bool, true mientras llega el primer snapshot de asignaturas (muestra Spinner en la lista lateral).
      showArchived: bool, alterna la visibilidad del subgrupo de asignaturas archivadas en el sidebar.
      showPlanCompare: bool, controla si se muestra el modal PlanCompareModal.
    efectos:
      useEffect([currentUser]): si hay currentUser, suscribe onSnapshot a subjects where docenteId == currentUser.uid; en cada cambio setea subjects y apaga loadingSidebar; en error solo apaga loadingSidebar; cleanup llama unsub(). Esto hace que crear/editar/archivar/duplicar/eliminar una asignatura se refleje al instante en el sidebar sin refrescar.
    datos:
      Firestore lectura: collection 'subjects' con query where('docenteId','==',currentUser.uid) via onSnapshot (tiempo real).
      Indirecto via hook useSubscription(): lee 'plans', 'subscriptions', 'payments' (getDocs) para obtener subscription y plans usados por el banner y el modal de planes.
    logica:
      Deriva activeSubjects = subjects sin archived y archivedSubjects = subjects con archived (filtrado en memoria).
      Calcula trialDays: si subscription?.status === 'trial' usa calcDaysRemaining(subscription.fechaVencimiento), si no null.
      displayName = userProfile.nombreMostrar || username || nombre || 'Docente'; initials = primer caracter en mayuscula.
      Render movil (md:hidden): top bar con logo y boton LogOut directo; nav inferior fijo con enlaces a /dashboard (Asignaturas) y /profile (Perfil).
      Render escritorio (sidebar w-280, plano color accent): logo, boton de perfil (NavLink a /profile con foto o iniciales y schoolName), banner de prueba, encabezado "Asignaturas" (NavLink a /dashboard), lista de asignaturas activas (NavLink a /subject/:id con SubjectIcon y subjectDisplayName), boton "Nueva asignatura…", bloque de archivadas plegable, y boton "Cerrar sesion".
      Banner de prueba: solo se muestra si trialDays !== null && trialDays > 0; es un boton que al hacer click setShowPlanCompare(true); texto "Te quedan N dia(s) de prueba".
      Boton "Nueva asignatura…": navigate('/dashboard', { state: { openCreate: true } }) para que el dashboard abra el modal de creacion (la asignatura no se crea aqui).
      Bloque archivadas: solo si archivedSubjects.length > 0; boton toggle setShowArchived; cuando showArchived es true lista las archivadas como NavLink a /subject/:id.
      handleLogout(): signOut(auth) y navigate('/'). Usado por el boton LogOut del top bar movil, el de Cerrar sesion del sidebar.
      Al final, si showPlanCompare, monta PlanCompareModal con props plans (de useSubscription), trialDays (?? 0) y onClose=()=>setShowPlanCompare(false). Asi el banner de prueba se conecta a la comparacion de planes.
    FN handleLogout(): cierra sesion de Firebase y redirige al inicio.
      datos: firebase/auth signOut(auth).
      logica: await signOut, luego navigate('/').
  DATOS: lee 'subjects' en tiempo real (onSnapshot, where docenteId==uid). Via useSubscription lee 'plans','subscriptions','payments' (getDocs). No escribe Firestore directamente.
  DEPENDENCIAS: ../firebase (auth, db), ../context/AuthContext (useAuth), ./Spinner, ../hooks/useSubscription (useSubscription), ../utils/subscriptionHelpers (calcDaysRemaining), ../utils/subjectName (subjectDisplayName), ./SubjectIcon, ./PlanCompareModal. Externas: react-router-dom (NavLink, useNavigate), lucide-react (iconos), firebase/auth, firebase/firestore.

ARCHIVO: src/components/AdminLayout.jsx
LINEAS: ~122
OBJETIVO: Layout del panel de administracion; sidebar con pestañas (Resumen, Suscripciones, Pagos, Cobros, Usuarios, Planes) y manejo responsive (drawer en movil). Controla la navegacion por pestañas via props, no por rutas.
EXPORTA: componente default AdminLayout({ activeTab, onTabChange, children }); constante interna TABS (no exportada).

  CONST TABS: arreglo de pestañas del panel admin, cada una { id, label, icon } con iconos lucide. ids: resumen, suscripciones, pagos, cobros, usuarios, planes.

  FN AdminLayout({ activeTab, onTabChange, children }): renderiza el chrome del panel admin y resalta la pestaña activa.
    props:
      activeTab: id de la pestaña actualmente seleccionada (controlado por el padre).
      onTabChange(id): callback que el padre usa para cambiar de pestaña al hacer click en un boton del sidebar.
      children: contenido de la pestaña activa que se monta dentro de <main>.
    estado:
      mobileOpen: bool, abre/cierra el sidebar como drawer en movil.
    efectos: (ninguno)
    datos: (no toca Firestore; solo lee userProfile del contexto para mostrar el email).
    logica:
      displayName = userProfile?.email || 'Administrador' (se muestra en el sidebar).
      Top bar movil (md:hidden): logo "AD"/"Admin" y boton que alterna mobileOpen (icono Menu/X).
      Sidebar (w-64, fixed en movil cuando mobileOpen, sticky en escritorio): encabezado de marca, fila con el email, nav con los TABS, y boton "Cerrar sesion".
      Cada boton de TAB: onClick llama onTabChange(id) y cierra el drawer (setMobileOpen(false)); estilo activo si activeTab === id (bg-blue-50, blue-700).
      Overlay oscuro detras del drawer cuando mobileOpen (click cierra).
      Tematica admin en azul (blue-600), distinta del accent del docente.
    FN handleLogout(): cierra sesion admin y redirige al inicio.
      datos: firebase/auth signOut(auth).
      logica: await signOut(auth), luego navigate('/').
  DATOS: ninguno en Firestore. Solo consume userProfile del AuthContext.
  DEPENDENCIAS: ../firebase (auth), ../context/AuthContext (useAuth). Externas: react-router-dom (useNavigate), lucide-react (iconos), firebase/auth.

ARCHIVO: src/components/Toast.jsx
LINEAS: ~41
OBJETIVO: Sistema global de notificaciones tipo toast (exito/error) via Context; expone una funcion show(msg, type) por el hook useToast y renderiza la pila de toasts apilada arriba a la derecha.
EXPORTA: componente ToastProvider({ children }); hook useToast(); (ToastContext es interno, no exportado).

  FN ToastProvider({ children }): provee el contexto del toast y renderiza la pila de toasts.
    estado:
      toasts: arreglo de { id, msg, type } actualmente visibles.
    efectos: (no usa useEffect; usa setTimeout dentro de show).
    datos: (ninguno).
    logica:
      Provee como valor del contexto la funcion show.
      Renderiza children y debajo un contenedor fijo (top-4 right-4, z-50) con cada toast; color rojo si type==='error', verde (emerald) en otro caso; icono XCircle/CheckCircle segun tipo; boton X para cerrar manualmente (filtra ese id).
    FN show(msg, type='success'): agrega un toast y lo auto-elimina a los 3500 ms.
      logica: id = Date.now(); agrega { id, msg, type } a toasts; setTimeout 3500 ms para filtrar ese id. Memoizada con useCallback([]).

  FN useToast(): devuelve la funcion show del contexto (useContext(ToastContext)) para que cualquier componente dispare toasts. Si se usa fuera del provider devuelve null.
  DATOS: ninguno.
  DEPENDENCIAS: solo externas: react (useState, useCallback, createContext, useContext), lucide-react (CheckCircle, XCircle, X). Consumido por CheckoutModal y PaymentSimulationModal y demas paginas.

ARCHIVO: src/components/CheckoutModal.jsx
LINEAS: ~315
OBJETIVO: Modal de contratacion de plan con los tres metodos de pago (Mercado Pago via redireccion, PayPal via SDK, y transferencia bancaria manual). Lee la configuracion publica de pagos desde Firestore (config/payments) y llama a los endpoints serverless en /api.
EXPORTA: componente default CheckoutModal({ open, onClose, plans, subscription, onSuccess }); funcion auxiliar interna loadPaypalSdk (no exportada); const inputCls (no exportada).

  CONST inputCls: clases Tailwind reutilizadas para inputs/select del modal.

  FN loadPaypalSdk(clientId): carga el SDK de PayPal en MXN una sola vez y resuelve con window.paypal.
    logica: si ya existe window.paypal resuelve; si ya hay un <script id="paypal-sdk"> escucha sus eventos load/error; si no, inyecta el script con src del SDK (client-id + currency=MXN) y resuelve/rechaza en onload/onerror. Devuelve Promise.

  FN CheckoutModal({ open, onClose, plans, subscription, onSuccess }): el modal completo de checkout.
    props:
      open: bool, si false retorna null (no renderiza).
      onClose(): cierra el modal.
      plans: catalogo de planes de paga (de useSubscription, gestionado por admin) para el selector.
      subscription: suscripcion actual del docente (puede ser null); si existe se actualiza en lugar de crear una nueva en el flujo de transferencia.
      onSuccess(): callback opcional al completar/registrar un pago (el padre suele recargar suscripcion).
    estado:
      selectedPlanId: id del plan elegido en el select.
      method: metodo de pago activo ('mercadopago' | 'paypal' | 'transferencia' | null).
      referencia: texto del folio bancario para transferencia.
      submitting: bool, deshabilita botones mientras se procesa.
      paypalRef: ref al contenedor donde el SDK renderiza los botones de PayPal.
    efectos:
      useEffect([open, plans, selectedPlanId]): al abrir, si no hay plan seleccionado y hay planes, selecciona plans[0].id por defecto.
      useEffect([config, method]): cuando llega config y no hay metodo elegido, fija method al primer metodo habilitado (mercadoPago > paypal > transferencia).
      useEffect([open, method, config.paypal.clientId, selectedPlanId]): si esta abierto y method==='paypal' con clientId y plan, carga el SDK y renderiza paypal.Buttons (createOrder/onApprove/onError); usa flag cancelled en cleanup para evitar render tras desmontar.
    datos:
      Lectura via hook usePaymentConfig(): doc('config','payments') getDoc (config publica de pagos).
      fetch POST /api/mp/create-preference (Mercado Pago): cuerpo planPayload, espera data.init_point y redirige.
      fetch POST /api/paypal/create-order (PayPal createOrder): cuerpo planPayload, devuelve orderId.
      fetch POST /api/paypal/capture-order (PayPal onApprove): cuerpo { orderId }, espera d.ok.
      Firestore escritura (transferencia): 'subscriptions' updateDoc (si subscription.id existe) o addDoc (nueva, con createdAt); 'payments' addDoc (registro pendiente para aprobacion del admin).
    logica:
      selectedPlan = plans.find(p => p.id === selectedPlanId).
      authHeader(): obtiene currentUser.getIdToken() y arma headers JSON con Authorization Bearer para los fetch a /api.
      planPayload(): { planId, escuelaId, schoolName } tomados de userProfile.
      methods: arreglo derivado de config con los metodos habilitados (filtra los enabled); si vacio muestra mensaje de no disponibilidad.
      Render condicional: si configLoading muestra Spinner; si methods vacio mensaje; si no, select de plan + tabs de metodo + total + cuerpo segun method.
      Click en overlay (onClick=onClose) cierra; el panel hace stopPropagation.
    FN authHeader(): construye los headers autenticados para llamadas a /api.
      datos: currentUser.getIdToken().
      logica: devuelve { 'Content-Type':'application/json', Authorization:`Bearer <token>` }.
    FN planPayload(): arma el cuerpo de las peticiones de pago con plan y escuela.
      logica: { planId: selectedPlanId, escuelaId, schoolName } desde userProfile.
    FN payWithMercadoPago(): inicia el pago con Mercado Pago.
      datos: fetch POST /api/mp/create-preference.
      logica: valida selectedPlanId (toast error si falta); setSubmitting(true); POST con authHeader y planPayload; si ok y data.init_point hace window.location.href = init_point (redireccion al checkout MP); en error toast y reactiva el boton.
    FN submitTransfer(e): registra una transferencia bancaria manual pendiente de aprobacion.
      datos: Firestore 'subscriptions' updateDoc/addDoc y 'payments' addDoc.
      logica: previene default; valida plan y referencia; setSubmitting; arma subData (status 'pendiente_pago'); si subscription.id actualiza, si no crea nueva subscription; luego addDoc en 'payments' con metodo 'transferencia', referencia, monto = selectedPlan.precio, status 'pendiente'; toast de confirmacion, limpia referencia, llama onSuccess y onClose; finally apaga submitting.
    Logica PayPal embebida (en el useEffect): createOrder llama /api/paypal/create-order y devuelve orderId; onApprove llama /api/paypal/capture-order y si d.ok hace toast de exito, onSuccess y onClose; onError toast de error.
  DATOS: lee config/payments (getDoc via usePaymentConfig). Escribe 'subscriptions' (update o add) y 'payments' (add) solo en el flujo de transferencia. Mercado Pago y PayPal pasan por endpoints serverless /api/mp/* y /api/paypal/* (la escritura de suscripcion/pago la hace el backend).
  DEPENDENCIAS: ../firebase (db), ../context/AuthContext (useAuth), ./Toast (useToast), ./Spinner, ../hooks/usePaymentConfig (usePaymentConfig), ../utils/subscriptionHelpers (formatCurrency). Externas: react, firebase/firestore, lucide-react.

ARCHIVO: src/components/PaymentSimulationModal.jsx
LINEAS: ~152
OBJETIVO: Modal mas simple (version de simulacion / solo transferencia) para registrar un pago bancario manual; usa datos bancarios estaticos de config/billing en lugar de la config dinamica de Firestore. Crea/actualiza la suscripcion y un pago pendiente.
EXPORTA: componente default PaymentSimulationModal({ open, onClose, plans, subscription, onSuccess }); const inputCls (no exportada).

  CONST inputCls: clases Tailwind reutilizadas para inputs/select (mismas que CheckoutModal).

  FN PaymentSimulationModal({ open, onClose, plans, subscription, onSuccess }): modal de registro de pago por transferencia con datos bancarios fijos.
    props:
      open: bool, si false retorna null.
      onClose(): cierra el modal.
      plans: catalogo de planes para el select (default selecciona plans[0]).
      subscription: suscripcion actual (si existe se actualiza, si no se crea).
      onSuccess(): callback opcional tras registrar el pago.
    estado:
      selectedPlanId: id del plan elegido (inicial plans[0]?.id || '').
      referencia: folio bancario.
      submitting: bool durante el envio.
    efectos: (ninguno).
    datos:
      Firestore escritura: 'subscriptions' updateDoc (si subscription.id) o addDoc (nueva con createdAt); 'payments' addDoc (pago pendiente).
      Lectura: ninguna de Firestore; los datos bancarios vienen de la constante BANK_TRANSFER (config/billing).
    logica:
      selectedPlan = plans.find(p => p.id === selectedPlanId).
      Render: select de plan, recuadro con datos de transferencia (BANK_TRANSFER: banco, titular, cuenta, clabe, nota), monto a transferir = selectedPlan.precio formateado, input de referencia, boton "Registrar pago".
      Overlay onClick=onClose cierra; panel stopPropagation.
    FN handleSubmit(e): valida y registra el pago por transferencia.
      datos: 'subscriptions' update/add y 'payments' add.
      logica: previene default; valida plan y referencia (toast error si faltan); setSubmitting; arma subData status 'pendiente_pago'; actualiza subscription existente o crea nueva; addDoc en 'payments' (metodo 'transferencia', monto, referencia, status 'pendiente'); toast de confirmacion, limpia referencia, onSuccess, onClose; finally apaga submitting.
  DATOS: escribe 'subscriptions' (update/add) y 'payments' (add). No lee Firestore. Diferencia clave vs CheckoutModal: aqui los datos bancarios son estaticos (BANK_TRANSFER) y no hay flujos MP/PayPal ni endpoints /api; es solo transferencia/simulacion.
  DEPENDENCIAS: ../firebase (db), ../context/AuthContext (useAuth), ./Toast (useToast), ./Spinner, ../config/billing (BANK_TRANSFER), ../utils/subscriptionHelpers (formatCurrency). Externas: react, firebase/firestore, lucide-react.

ARCHIVO: src/components/PlanCompareModal.jsx
LINEAS: ~99
OBJETIVO: Modal de comparacion que se abre al tocar el banner de prueba en el sidebar (TeacherLayout); muestra la columna de prueba gratis vs los planes de paga del catalogo admin. No procesa pagos; redirige a /profile para administrar el plan.
EXPORTA: componente default PlanCompareModal({ plans = [], trialDays, onClose })

  FN PlanCompareModal({ plans = [], trialDays, onClose }): renderiza la comparacion prueba vs planes de paga.
    props:
      plans: catalogo de planes de paga (default []); proviene de useSubscription en TeacherLayout.
      trialDays: dias restantes de prueba (se muestra; >0 dice cuantos quedan, <=0 dice "Tu prueba termino").
      onClose(): cierra el modal.
    estado: (ninguno).
    efectos: (ninguno).
    datos: (ninguno; no toca Firestore ni /api).
    logica:
      paidPlans = copia de plans ordenada por plan.orden ascendente.
      Render: overlay oscuro (onClick=onClose), panel con titulo "Compara los planes" y texto de periodo de prueba.
      Grid de 2 columnas: tarjeta "Prueba gratis" (lista de funciones, dias restantes) y las tarjetas de planes de paga.
      Si paidPlans vacio muestra tarjeta "Planes proximamente"; si no, una tarjeta por plan con precio formateado, periodicidad (año/mes), descripcion opcional, limites (maxAsignaturas, maxAlumnos via limitLabel) y boton "Elegir <nombre>".
      Botones "Elegir <nombre>" y "Ver detalles y administrar mi plan" llaman goToPlans (no contratan en el modal).
    FN limitLabel(n): devuelve 'Sin limite' si n===-1 o n==null, en otro caso n. Usada para mostrar limites de asignaturas/alumnos.
    FN goToPlans(): cierra el modal y navega a /profile.
      logica: onClose?.() y navigate('/profile'). Asi el modal delega la contratacion real a la pagina de perfil (donde vive el checkout).
  DATOS: ninguno. Solo presentacion + navegacion a /profile.
  DEPENDENCIAS: ../utils/subscriptionHelpers (formatCurrency). Externas: react-router-dom (useNavigate), lucide-react (X, Check, Sparkles, Timer).

NOTAS DE INTERCONEXION (pagos / planes):
  Banner de prueba (TeacherLayout) -> setShowPlanCompare -> PlanCompareModal (comparacion) -> goToPlans -> /profile.
  En /profile (no en este set de archivos) vive la contratacion real con CheckoutModal (MP/PayPal/transferencia con config dinamica) o PaymentSimulationModal (solo transferencia con datos estaticos BANK_TRANSFER).
  useSubscription provee subscription + plans a TeacherLayout (banner/modal) y a los modales de pago.
  usePaymentConfig (solo CheckoutModal) provee la config publica de pagos desde config/payments; los secretos viven en variables de entorno de Vercel, no en Firestore.
  Estados de suscripcion relevantes: 'trial' (dispara el banner), 'pendiente_pago' (lo dejan los modales de pago al registrar transferencia, a la espera de aprobacion del admin).


===== COMPONENTES PEQUENOS Y PRIMITIVOS UI =====

ARCHIVO: src/components/Spinner.jsx
LINEAS: ~6
OBJETIVO: Indicador de carga circular giratorio con tres tamanos predefinidos.
EXPORTA: componente React por defecto Spinner (export default)
  FN Spinner({ size = 'md' }): renderiza un div circular animado que gira como spinner de carga.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      mapea el prop size a clases Tailwind de dimension: 'sm' -> h-4 w-4; 'lg' -> h-10 w-10; cualquier otro/'md' -> h-6 w-6.
      renderiza un div con clases: animate-spin rounded-full border-2 border-blue-600 border-t-transparent (borde azul con tope transparente para efecto de giro).
DATOS: (ninguna coleccion Firestore; componente puramente presentacional)
DEPENDENCIAS: (ninguna; sin imports internos del proyecto)


ARCHIVO: src/components/PasswordInput.jsx
LINEAS: ~23
OBJETIVO: Input de contrasena con boton de ojo para alternar visibilidad del texto.
EXPORTA: componente React por defecto PasswordInput (export default)
  FN PasswordInput({ className = '', ...props }): input controlado por el padre que permite mostrar/ocultar la contrasena.
    estado: show (boolean, useState, inicial false) -> controla si el input muestra texto plano o puntos.
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      reenvia todos los props restantes (...props) al elemento input (value, onChange, placeholder, etc. los controla el padre).
      type del input = 'text' si show, si no 'password'.
      anade pr-11 al className recibido para dejar espacio al boton del ojo.
      boton tipo button con tabIndex -1 (no recibe foco por tab); onClick alterna show con setShow((v) => !v).
      icono: EyeOff (size 17) cuando show es true, Eye (size 17) cuando es false.
DATOS: (ninguna coleccion Firestore; componente de formulario)
DEPENDENCIAS:
  lucide-react: Eye, EyeOff (iconos)
  (sin imports internos del proyecto)


ARCHIVO: src/components/FileTypeSelect.jsx
LINEAS: ~74
OBJETIVO: Selector tipo dropdown (texto gris que se expande en menu) para que el docente elija que tipos de archivo pueden subir los alumnos en una actividad; incluye opcion "Personalizado" con extensiones propias.
EXPORTA: componente React por defecto FileTypeSelect (export default)
  FN FileTypeSelect({ value, onChange, customExts = '', onCustomChange }): dropdown de tipos de archivo permitidos para una actividad, con opcion personalizada.
    estado: open (boolean, useState, inicial false) -> controla si el menu desplegable esta abierto.
    refs: ref (useRef, null) -> apunta al contenedor div raiz; usado para detectar clics fuera y cerrar el menu.
    efectos:
      useEffect (deps []): registra listener 'mousedown' en document; si el clic ocurre fuera de ref.current cierra el menu (setOpen(false)). Limpia el listener al desmontar.
    datos: (ninguno; no toca Firestore)
    logica:
      current = getFileType(value, customExts) -> obtiene el objeto del tipo actual (con su label) desde la config.
      isCustom = value === CUSTOM_FILE_TYPE -> indica si la seleccion actual es la opcion personalizada.
      boton principal muestra "Archivos permitidos:" + el label del tipo actual (current.label) + chevron que rota 180deg cuando open.
      al abrir, mapea FILE_TYPE_OPTIONS a botones; cada uno llama onChange(o.key) y cierra el menu; resalta en azul (text-blue-600) el que coincide con value.
      boton adicional "Personalizado (escribe las extensiones)" que llama onChange(CUSTOM_FILE_TYPE); se resalta cuando isCustom.
      si isCustom es true, renderiza un input de texto controlado (value=customExts) que llama onCustomChange?.(e.target.value); placeholder "Ej: pptx, zip, psd"; autoComplete off, spellCheck false.
DATOS: (ninguna coleccion Firestore; consume configuracion estatica de tipos de archivo)
DEPENDENCIAS:
  ../config/fileTypes: FILE_TYPE_OPTIONS, getFileType, CUSTOM_FILE_TYPE
  lucide-react: ChevronDown (icono)


ARCHIVO: src/components/IconSelect.jsx
LINEAS: ~24
OBJETIVO: Cuadricula de iconos de asignatura para que el docente elija el icono de una materia.
EXPORTA: componente React por defecto IconSelect (export default)
  FN IconSelect({ value = 'book', onChange }): renderiza una grilla de 8 columnas con todos los iconos de asignatura seleccionables.
    estado: (ninguno; componente controlado por el padre via value/onChange)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      itera SUBJECT_ICON_KEYS (lista de claves de iconos disponibles).
      por cada key obtiene el componente Icon con getSubjectIcon(key).
      selected = (value || 'book') === key -> determina el icono activo (fallback a 'book').
      cada boton llama onChange(key) al clic; aria-label = key.
      estilo seleccionado: bg-accent text-white; no seleccionado: bg-surface-container text-muted con hover bg-surface-dim.
      renderiza Icon con size 17.
DATOS: (ninguna coleccion Firestore; usa catalogo estatico de iconos)
DEPENDENCIAS:
  ../utils/subjectIcons: SUBJECT_ICON_KEYS, getSubjectIcon


ARCHIVO: src/components/PaletteSelect.jsx
LINEAS: ~36
OBJETIVO: Fila de muestras de color (swatches) para elegir la paleta de acento de una asignatura.
EXPORTA:
  PALETTES (constante con array de paletas; export nombrado)
  componente React por defecto PaletteSelect (export default)
  CONSTANTE PALETTES: array de objetos { key, label, color } con 6 paletas predefinidas:
    default/Azul (#2563eb), orange/Naranja (#f97316), purple/Morado (#9333ea), green/Verde (#16a34a), rose/Rosa (#e11d48), teal/Teal (#14b8a6).
    Nota del codigo: las keys deben coincidir con las reglas [data-subject-palette="..."] en src/index.css.
  FN PaletteSelect({ value = 'default', onChange }): renderiza una fila de circulos de color seleccionables.
    estado: (ninguno; controlado por el padre)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      itera PALETTES; selected = (value || 'default') === p.key (fallback a 'default').
      cada boton circular (w-9 h-9 rounded-full) usa style backgroundColor = p.color; title y aria-label = p.label.
      seleccionado: ring-2 ring-offset-2 ring-slate-400 scale-105 y muestra icono Check (size 16, blanco) dentro.
      no seleccionado: solo hover:scale-105.
      onClick llama onChange(p.key).
DATOS: (ninguna coleccion Firestore; paletas estaticas)
DEPENDENCIAS:
  lucide-react: Check (icono)


ARCHIVO: src/components/SubjectIcon.jsx
LINEAS: ~7
OBJETIVO: Renderiza el icono elegido de una asignatura (con fallback a libro).
EXPORTA: componente React por defecto SubjectIcon (export default)
  FN SubjectIcon({ iconKey, size = 20, className = '' }): resuelve y renderiza el componente de icono asociado a una clave de asignatura.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      Icon = getSubjectIcon(iconKey) -> obtiene el componente de icono (la utilidad aplica el fallback a 'book' si la clave no existe).
      renderiza Icon con size y className recibidos.
DATOS: (ninguna coleccion Firestore; usa catalogo estatico de iconos)
DEPENDENCIAS:
  ../utils/subjectIcons: getSubjectIcon


ARCHIVO: src/components/ui/Button.jsx
LINEAS: ~14
OBJETIVO: Boton primitivo reutilizable con variantes de estilo (primary, ghost, danger).
EXPORTA: componente React por defecto Button (export default)
  FN Button({ variant = 'primary', className = '', children, ...props }): boton estilizado segun variante de acento.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      base: inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors disabled:opacity-60.
      mapa styles por variante:
        primary -> bg-accent text-white hover:bg-accent-hover px-5 py-3 (solido de acento).
        ghost -> text-accent hover:bg-accent-light px-4 py-2 (texto de acento).
        danger -> bg-error text-white hover:opacity-90 px-5 py-3.
      usa styles[variant] con fallback a styles.primary si la variante no existe.
      reenvia ...props al <button> (onClick, type, disabled, etc.).
DATOS: (ninguna coleccion Firestore; primitivo UI)
DEPENDENCIAS: (ninguno; sin imports internos del proyecto)


ARCHIVO: src/components/ui/Card.jsx
LINEAS: ~8
OBJETIVO: Tarjeta primitiva luminosa (superficie blanca, radio grande, sombra ambiental).
EXPORTA: componente React por defecto Card (export default)
  FN Card({ as: Tag = 'div', className = '', children, ...props }): contenedor tipo tarjeta con etiqueta HTML configurable.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      prop polimorfico as renombrado a Tag (por defecto 'div') -> permite renderizar como otro elemento/componente.
      aplica clases bg-surface-card rounded-card shadow-card mas el className recibido.
      reenvia ...props al elemento Tag.
DATOS: (ninguna coleccion Firestore; primitivo UI)
DEPENDENCIAS: (ninguno; sin imports internos del proyecto)


ARCHIVO: src/components/ui/EmptyState.jsx
LINEAS: ~15
OBJETIVO: Estado vacio luminoso: icono atenuado en circulo tintado de acento, con titulo, subtitulo y accion opcionales.
EXPORTA: componente React por defecto EmptyState (export default)
  FN EmptyState({ icon: Icon, title, subtitle, action, className = '' }): bloque centrado para listas/secciones sin contenido.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      prop icon renombrado a Icon; si existe, renderiza un circulo (w-16 h-16 rounded-full bg-accent-light) con el icono dentro (size 28, text-accent).
      title (si existe): parrafo text-title-md text-on-surface.
      subtitle (si existe): parrafo text-body-sm text-muted.
      action (si existe): contenedor con margen superior (mt-5) que envuelve el nodo de accion (p. ej. un boton).
      contenedor raiz centrado: text-center py-12 px-6 + className recibido.
DATOS: (ninguna coleccion Firestore; primitivo UI)
DEPENDENCIAS: (ninguno; el icono se pasa como prop, tipicamente un icono de lucide-react)


ARCHIVO: src/components/ui/Field.jsx
LINEAS: ~17
OBJETIVO: Envoltorio de campo de formulario luminoso: label en mayusculas arriba y estilo de input en pildora reutilizable via constante exportada.
EXPORTA:
  inputClass (constante string con clases Tailwind; export nombrado)
  componente React por defecto Field (export default)
  CONSTANTE inputClass: cadena de clases Tailwind para inputs (w-full px-4 py-3 rounded border border-outline-variant bg-surface-card text-on-surface text-body-md focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-muted). Se aplica al input que renderiza el propio llamador (Field no incluye su input).
  FN Field({ label, htmlFor, children }): envuelve un campo de formulario con su etiqueta opcional.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno)
    logica:
      contenedor div con className recibido.
      label (si existe): <label htmlFor> con clases block text-label-caps text-muted uppercase mb-1.5.
      renderiza children debajo del label (el input/control lo provee el llamador, normalmente usando la constante inputClass).
DATOS: (ninguna coleccion Firestore; primitivo UI de formulario)
DEPENDENCIAS: (ninguno; sin imports internos del proyecto)


===== PAGINA DOCENTE: SubjectPage (la mas grande, ~1939 lineas) =====

ARCHIVO: src/pages/teacher/SubjectPage.jsx
LINEAS: ~1939
OBJETIVO: Pagina central del docente para una asignatura. Muestra y administra todo lo de
  una materia mediante 3 pestañas (Actividades, Calificaciones, Alumnos) y numerosos modales:
  CRUD de la asignatura (editar, duplicar, archivar, restaurar, eliminar), CRUD de actividades
  (crear, editar, eliminar, visibilidad/programacion), gestion de alumnos (alta manual, import
  Excel, reordenar, reset password, eliminar), exportes (Excel y PDF de calificaciones, PDF de
  lista, PDF de credenciales), descarga ZIP de entregas y generacion de codigo/QR/link de acceso.
EXPORTA:
  default = componente React SubjectPage (sin props; lee :subjectId de la URL via useParams)
  No exporta nada nombrado. Define ademas 3 helpers de modulo (no exportados): fetchSubmissionsForActivities, gradeColor, y la constante EMPTY_FORM.

----------------------------------------------------------------------
HELPERS DE MODULO (fuera del componente)
----------------------------------------------------------------------

FN fetchSubmissionsForActivities(actIds): trae todas las entregas (submissions) de una lista de actividades en lotes de 30 ids.
  datos: lee 'submissions' con getDocs + query where('actividadId','in', chunk). Firestore limita 'in' a 30 valores, por eso parte actIds en chunks de 30 y hace Promise.all; devuelve el flat de docs (snapshots, no .data()).
  logica: si actIds vacio devuelve []; usado por loadAll, loadGrades, handleArchiveConfirm, handleExport, handleExportGradesPDF.

CONST EMPTY_FORM: estado inicial del formulario de actividad.
  valor: { nombre:'', maxCalif:'10', instrucciones:'', fechaLimite:'', tiposArchivo: DEFAULT_FILE_TYPE, extensionesCustom:'', oculta:false, publishAt:'' }

FN gradeColor(norm): devuelve clase Tailwind de color segun la calificacion normalizada (0-10).
  logica: null -> text-slate-300 (gris, sin dato); >=8 -> emerald-700 (verde); >=6 -> amber-600 (ambar); resto -> red-500 (rojo).

----------------------------------------------------------------------
COMPONENTE: SubjectPage()
----------------------------------------------------------------------

estado (useState relevantes):
  subject: doc de la asignatura cargado (o null).
  activities: array de actividades de la asignatura.
  submissionCounts: { [actId]: { delivered, graded } } conteos por actividad.
  openParcial: numero de parcial actualmente expandido en el acordeon (1 por defecto; 0 = cerrado).
  showModal, modalMode ('create'|'edit'), modalParcial, editActivityId, form, saving: modal de actividad.
  deleteConfirm (activity|null), deleting: confirmacion de borrar actividad.
  archiving: en proceso de archivar/restaurar.
  loading, exporting, exportingPdf, exportingGradesPdf, generatingCredentials, showCredentialsModal: flags de carga/export.
  zipDownloading, zipProgress {done,total}: progreso de descarga ZIP de entregas.
  activateModal (activity|null), activateMode ('now'|'schedule'), activateDate: modal de activar/programar visibilidad.
  showEditSubjectModal, editSubjectForm, editingSubject: modal editar asignatura.
  showDeleteSubjectConfirm, deleteSubjectConfirmText, deletingSubject: modal eliminar asignatura (requiere teclear el nombre).
  showCopyModal, copyForm, copyFechas, copyingSubject: modal duplicar asignatura.
  showUnarchiveModal, unarchiveStudents ('keep'|'reset'), unarchiveActivities ('keep'|'show'|'hide'), unarchiveEdits, unarchivedSaving: modal restaurar (desarchivar).
  showArchiveModal, archiveExportChoice ('save'|'skip'): modal archivar (elige si descarga ZIP de entregas).
  activeTab ('actividades'|'calificaciones'|'alumnos'): pestaña activa.
  groupStudents, groupStudentsLoaded: lista de alumnos compartida entre pestañas Calificaciones y Alumnos (lazy).
  copiedLink, copiedCode: feedback temporal (2s) tras copiar link/codigo de acceso.
  showAddStudent, showQR, studentToDelete, studentToReset, resetPwdResult ({student,tempPwd}), copiedTempPwd, newStudent ({apellidoPaterno,apellidoMaterno,nombre}), savingStudent, searchAlumnos: gestion de alumnos en pestaña Alumnos.
  gradeSubMap ({ "alumnoId-actividadId": submissionData }), gradesLoaded, loadingGrades, searchGrade: pestaña Calificaciones.

efectos:
  useEffect(() => loadAll(), [subjectId]): al montar o cambiar subjectId carga la asignatura, actividades y conteos.

DATOS (resumen global de colecciones tocadas):
  subjects: getDoc (cargar), updateDoc (auto-asignar accessCode, archivar/restaurar, editar). Borrado via util deleteSubjectCascade.
  activities: getDocs (cargar por asignaturaId), addDoc (crear), updateDoc (editar/visibilidad), deleteDoc (eliminar), writeBatch (cambiar visibilidad masiva al restaurar).
  submissions: getDocs via fetchSubmissionsForActivities (conteos, calificaciones, export, ZIP). Borrado via utils deleteSubjectSubmissions / deleteSubjectStudents.
  students: getDocs (por asignaturaId y por escuelaId para usernames unicos), addDoc (alta manual), writeBatch (import Excel masivo, reordenar, generar credenciales), updateDoc (reset password individual), deleteDoc (eliminar alumno).
  No usa onSnapshot (todo es lectura puntual getDoc/getDocs). No hace fetch a /api/... directamente en este archivo.

----------------------------------------------------------------------
FUNCIONES / HANDLERS (en orden del archivo)
----------------------------------------------------------------------

FN loadAll(): carga inicial completa de la asignatura.
  estado: setLoading, setSubject, setActivities, setSubmissionCounts.
  datos: getDoc subjects/{subjectId} + getDocs activities where asignaturaId==subjectId (en Promise.all); luego fetchSubmissionsForActivities para contar entregas.
  logica: si la asignatura no tiene accessCode, genera uno aleatorio (6 chars base36 mayusc.) y lo guarda con updateDoc. Construye counts por actividad: delivered = entregas con estado != 'pendiente'; graded = entregas con calificacion != null. Errores -> toast 'error'.

FN ensureGroupStudents(): carga (una sola vez, lazy) la lista de alumnos de la asignatura.
  estado: setGroupStudents, setGroupStudentsLoaded.
  datos: getDocs students where asignaturaId==subjectId.
  logica: si ya esta cargado devuelve el cache (groupStudents). Ordena por campo 'orden' (a.orden ?? 0). Devuelve el array para uso inmediato por otros handlers.

FN loadGrades(): carga la matriz de calificaciones de la pestaña Calificaciones.
  estado: setLoadingGrades, setGradeSubMap, setGradesLoaded.
  datos: ensureGroupStudents() + fetchSubmissionsForActivities(todas las actividades).
  logica: arma gradeSubMap indexado por `${alumnoId}-${actividadId}`. Errores -> toast.

FN switchTab(tab): cambia de pestaña y dispara carga perezosa segun la pestaña.
  estado: setActiveTab.
  logica: si tab=='calificaciones' y aun no cargado -> loadGrades(); si tab=='alumnos' y aun no cargado -> ensureGroupStudents().

FN fetchSchoolUsernames(): obtiene el Set de usernames ya usados en toda la escuela.
  datos: getDocs students where escuelaId==userProfile.escuelaId.
  logica: devuelve Set de usernames para evitar colisiones al generar nuevos.

FN uniqueUsername(base, taken): asegura un username unico añadiendo sufijo numerico.
  logica: si base no esta en el Set lo devuelve; si no, prueba base2, base3, ... hasta encontrar libre.

FN addStudent(e): alta manual de un alumno (submit del modal Agregar alumno).
  estado: setSavingStudent, setNewStudent (reset), setShowAddStudent(false), setGroupStudents.
  datos: fetchSchoolUsernames -> addDoc students con {apellidos, nombre, username unico, resetPassword (clave temporal), escuelaId, asignaturaId, activado:false, orden = groupStudents.length+1, createdAt: serverTimestamp}. Luego getDocs students para refrescar la lista ordenada.
  logica: genera username via generateUsername() + uniqueUsername(); toast 'Alumno agregado'.

FN handleExcelImport(e): importacion masiva de alumnos desde un Excel.
  estado: setSavingStudent, setGroupStudents; al final limpia e.target.value para permitir re-subir.
  datos: parseStudentExcel(file) -> rows; fetchSchoolUsernames; writeBatch con batch.set por cada fila (mismos campos que addStudent, orden incremental nextOrden). batch.commit(). Luego getDocs para refrescar.
  logica: si rows vacio -> toast error ('no tiene alumnos con los 3 campos'). Va acumulando los nuevos usernames en el Set 'taken' para evitar duplicados dentro del mismo lote. toast '{n} alumnos importados'.

FN generateResetPassword(): genera clave temporal de 4 chars (base36 mayusc.).
  logica: Math.random().toString(36).slice(2,6).toUpperCase(). Usada en addStudent, import, reset password y generar credenciales. (Nota: existe ademas un util generateResetPassword homonimo, pero aqui se define una version local que se usa internamente.)

FN confirmResetStudentPassword(): restablece la contraseña de un alumno (studentToReset).
  estado: setGroupStudents (marca activado:false + nuevo resetPassword), setResetPwdResult ({student,tempPwd}), setStudentToReset(null).
  datos: updateDoc students/{id} { activado:false, resetPassword: tempPwd }.
  logica: pone activado:false para forzar reactivacion; muestra modal con la clave temporal generada.

FN confirmDeleteStudent(): elimina un alumno (studentToDelete) y reordena el resto.
  estado: setSavingStudent, setStudentToDelete(null), setGroupStudents (con orden recalculado).
  datos: deleteDoc students/{id}; luego writeBatch.update sobre los restantes para reasignar orden 1..n; batch.commit().
  logica: toast '{username} eliminado'.

FN moveStudent(index, direction): sube/baja un alumno en el orden manual (direction -1 o +1).
  estado: setGroupStudents con nuevo orden.
  datos: writeBatch.update orden de TODOS los alumnos tras el swap; batch.commit().
  logica: respeta limites (no mueve fuera de rango). Nota: en la UI estos botones solo se muestran cuando no hay busqueda activa (searchAlumnos vacio).

FN copyActivationLink(): copia al portapapeles la URL de activacion (activationUrl).
  estado: setCopiedLink(true) y lo revierte a false a los 2s.
  logica: navigator.clipboard.writeText(activationUrl).

FN copyAccessCode(): copia al portapapeles el codigo de acceso (subject.accessCode).
  estado: setCopiedCode(true) y revierte a 2s.
  logica: no hace nada si no hay accessCode.

FN openAdd(parcial): abre el modal de actividad en modo 'create' para un parcial.
  estado: setModalMode('create'), setModalParcial, setEditActivityId(null), setForm(EMPTY_FORM), setShowModal(true).

FN openEdit(activity): abre el modal en modo 'edit' precargando datos de la actividad.
  estado: setModalMode('edit'), setModalParcial, setEditActivityId, setForm con los valores de la actividad (nombre, maxCalif como String, instrucciones, fechaLimite, tiposArchivo, extensionesCustom, oculta, publishAt), setShowModal(true).

FN handleSaveActivity(e): crea o actualiza una actividad (submit del modal).
  estado: setSaving, setActivities, setSubmissionCounts (solo create), setShowModal(false), setForm(EMPTY_FORM).
  datos: create -> addDoc activities con payload + {tipo:'archivo', parcial:modalParcial, asignaturaId, docenteId:currentUser.uid, createdAt}. edit -> updateDoc activities/{editActivityId} con payload.
  logica: payload normaliza maxCalif a parseFloat (default 10), fechaLimite a null si vacio, extensionesCustom solo si tiposArchivo==CUSTOM_FILE_TYPE, oculta = form.oculta || !!form.publishAt (programar implica oculta), publishAt null si vacio. Actualiza el estado local en memoria (no recarga). toast 'Actividad creada/actualizada'.

FN handleDeleteActivity(): elimina la actividad de deleteConfirm.
  estado: setDeleting, setActivities (filtra), setDeleteConfirm(null).
  datos: deleteDoc activities/{id}.
  logica: toast 'Actividad eliminada'. (No borra las submissions asociadas explicitamente aqui.)

FN handleToggleArchive(): decide el flujo segun si la asignatura esta archivada.
  estado: si archived -> prepara unarchiveStudents/unarchiveActivities/unarchiveEdits desde subject y abre showUnarchiveModal. Si no -> setArchiveExportChoice('save') y abre showArchiveModal.
  logica: solo orquesta que modal mostrar; el guardado real lo hacen handleArchiveConfirm / handleUnarchiveConfirm.

FN handleArchiveConfirm(): archiva la asignatura (conserva esqueleto, elimina entregas; opcionalmente ZIP).
  estado: setArchiving, setZipDownloading, setZipProgress, setSubject (archived:true), setGradeSubMap({}), setGradesLoaded(false), setShowArchiveModal(false).
  datos: si archiveExportChoice=='save' -> ensureGroupStudents + fetchSubmissionsForActivities -> buildJobsForSubject(util) -> downloadSubmissionsZip(util) con onProgress. Luego deleteSubjectSubmissions(subjectId) (util) y updateDoc subjects/{id} {archived:true}.
  logica: el ZIP se nombra con subjectDisplayName(subject); si no hay jobs no descarga. Siempre elimina las entregas tras (o sin) descargar. toast distinto segun si descargo o no.

FN handleUnarchiveConfirm(): restaura (desarchiva) la asignatura aplicando ediciones y opciones.
  estado: setUnarchivedSaving, opcional reset de groupStudents/gradeSubMap/grades*, setActivities (si cambia visibilidad), setSubject (con updates), setShowUnarchiveModal(false).
  datos: si unarchiveStudents=='reset' -> deleteSubjectStudents(subjectId) (util). Si unarchiveActivities!='keep' -> writeBatch sobre activities {oculta: (=='hide'), publishAt:null} + commit. updateDoc subjects/{id} con {archived:false, nombre, grupo, fechaInicio, fechaFin, parciales, colorPalette, icon}.
  logica: VALIDA que no existan actividades en parciales > newParciales; si las hay, toast error y aborta. nombre vacio cae al nombre actual. toast 'Asignatura restaurada'.

FN hideActivity(a): oculta una actividad para los alumnos.
  estado: setActivities (oculta:true, publishAt:null).
  datos: updateDoc activities/{a.id} { oculta:true, publishAt:null }.

FN handleActivateConfirm(): activa o programa la visibilidad de la actividad en activateModal.
  estado: setActivities (segun modo), setActivateModal(null).
  datos: updateDoc activities/{id}. modo 'now' -> {oculta:false, publishAt:null}. modo 'schedule' -> {oculta:true, publishAt: activateDate}.
  logica: en modo schedule requiere activateDate (si no, toast error y no continua). toast 'Actividad visible' / 'Activacion programada'.

FN openEditSubject(): abre modal editar asignatura precargando editSubjectForm desde subject.
  estado: setEditSubjectForm (nombre, grupo, fechaInicio, fechaFin, parciales String, colorPalette, icon), setShowEditSubjectModal(true).

FN handleEditSubject(e): guarda cambios de los datos de la asignatura (submit del modal).
  estado: setEditingSubject, setSubject (merge), setShowEditSubjectModal(false).
  datos: updateDoc subjects/{id} con {nombre, grupo, fechaInicio, fechaFin, parciales, colorPalette, icon}.
  logica: VALIDA que no haya actividades en parciales > newParciales (si las hay, toast error y aborta). toast 'Asignatura actualizada'.

FN handleDeleteSubject(): elimina la asignatura completa con cascada.
  estado: setDeletingSubject; navega a /dashboard al exito.
  datos: deleteSubjectCascade(subjectId) (util que borra subject + activities + students + submissions).
  logica: REQUIERE que deleteSubjectConfirmText coincida exactamente con subject.nombre; si no, toast 'El nombre no coincide' y aborta. toast 'Asignatura eliminada' + navigate.

FN openCopyModal(): abre modal duplicar precargando nombre/grupo/fechas/palette/icon desde subject.
  estado: setCopyForm (keepStudents:false por defecto), setCopyFechas, setShowCopyModal(true).

FN handleCopySubject(e): duplica la asignatura (submit del modal Duplicar).
  estado: setCopyingSubject, setShowCopyModal(false); navega a /subject/{newId}.
  datos: copySubject(util) con {sourceSubjectId, nombre, grupo, fechaInicio, fechaFin, parciales (del original), colorPalette, icon, keepStudents, docenteId:currentUser.uid, escuelaId}. El util duplica actividades; si keepStudents copia alumnos con nuevas credenciales; NO copia calificaciones ni entregas.
  logica: toast 'Asignatura duplicada' y navega a la copia.

FN handleExport(): exporta calificaciones a Excel.
  estado: setExporting; carga lazy students/grades si faltan (setGroupStudents/setGradeSubMap + flags loaded).
  datos: si falta groupStudentsLoaded -> getDocs students; si falta gradesLoaded -> fetchSubmissionsForActivities. Luego exportSubjectGrades(util) con {subject, activities, students, submissions: Object.values(subMap)}.
  logica: garantiza tener datos aunque la pestaña Calificaciones no se haya abierto. toast error si falla.

FN handleExportListPDF(): exporta la lista de alumnos a PDF (con QR/URL de activacion).
  estado: setExportingPdf; carga lazy students si faltan.
  datos: getDocs students si no cargado; exportStudentListPDF(util) con {subject, students, activationUrl}.

FN handleExportGradesPDF(): exporta calificaciones a PDF (R12, mismos datos que el Excel).
  estado: setExportingGradesPdf; carga lazy students/grades si faltan.
  datos: getDocs students y/o fetchSubmissionsForActivities si faltan; exportSubjectGradesPDF(util) con {subject, activities, students, submissions}.

FN handleGenerateCredentials(): genera claves temporales faltantes y descarga PDF de credenciales (R16).
  estado: setGeneratingCredentials, setGroupStudents (si genero claves), setShowCredentialsModal(false).
  datos: getDocs students si no cargado; para alumnos sin resetPassword (needCode) escribe en writeBatch (en lotes de 490) {activado:false, resetPassword: tempPwd}; commit. Luego exportCredentialsPDF(util) con {subject, students, activationUrl}.
  logica: si no hay alumnos -> toast error. A quien ya activo (resetPassword:null) se le regenera clave y se marca activado:false. Limite 490 por batch (margen bajo el limite de 500 de Firestore). toast con conteo de claves generadas.

----------------------------------------------------------------------
VALORES COMPUTADOS (en el render, no son funciones con efectos)
----------------------------------------------------------------------

PARCIALES: array [1..subject.parciales] (default 3). Usado para el acordeon de Actividades y encabezados.
filteredGradeStudents: groupStudents filtrados por searchGrade (apellidos+nombre, lowercase includes).
tableParcials: por cada parcial con actividades, { p, acts } (solo parciales que tienen actividades).
gradeRows: por cada alumno filtrado calcula, por parcial: grades[] (calificacion normalizada a base 10 = calificacion/maxCalif*10, 1 decimal, o null), avg del parcial (promedio de las no-null), y finalAvg (promedio de los promedios de parcial). Alimenta la tabla de la pestaña Calificaciones.
activationUrl: `${window.location.origin}/activate/${subject.accessCode}`.
filteredAlumnos: groupStudents filtrados por searchAlumnos (apellidos+nombre+username).

----------------------------------------------------------------------
RENDER / UI: PESTAÑAS Y MODALES
----------------------------------------------------------------------

Si loading -> Spinner dentro de TeacherLayout.
Wrapper raiz tiene data-subject-palette={subject.colorPalette} para aplicar el tema de color por asignatura via CSS vars.

HEADER (siempre visible):
  Boton volver (navigate /dashboard), icono de asignatura (SubjectIcon), titulo (subjectDisplayName) + badge "Archivada" si aplica, periodo (subjectPeriodLabel).
  Botones de accion: QR (abre showQR), copiar link (copyActivationLink), copiar codigo (copyAccessCode, muestra el accessCode), editar (openEditSubject), duplicar (openCopyModal), archivar/restaurar (handleToggleArchive), eliminar (abre showDeleteSubjectConfirm).
  Selector de pestañas: actividades / calificaciones / alumnos -> switchTab.

PESTAÑA ACTIVIDADES:
  Acordeon por parcial (PARCIALES). Cada parcial abre/cierra (openParcial). Lista las actividades del parcial con: nombre, max, fechaLimite, estado de visibilidad (visible/hidden/scheduled via activityVisibilityState + formatPublishAt), badges de entregas/calificadas (submissionCounts). Click en la fila -> navigate /activity/{id}.
  Botones por actividad: toggle visibilidad (si oculta -> abre activateModal en modo 'now'; si visible -> hideActivity), editar (openEdit), eliminar (setDeleteConfirm).
  Boton "Agregar actividad" por parcial -> openAdd(p).

PESTAÑA CALIFICACIONES:
  Buscador (searchGrade). Estados: cargando (Spinner), sin actividades, sin alumnos, o tabla.
  Tabla con scroll horizontal: columna sticky Alumno; por cada tableParcials columnas de cada actividad + "Prom." del parcial; columna final "Prom." global. Celdas coloreadas con gradeColor. Boton "Exportar calificaciones a Excel" (handleExport).

PESTAÑA ALUMNOS:
  Bloque 1: agregar con Excel (descargar plantilla via downloadStudentTemplate; subir via input file -> handleExcelImport).
  Bloque 2: descargar calificaciones (Excel -> handleExport; PDF -> handleExportGradesPDF).
  Bloque 3: boton "Generar credenciales de acceso" -> abre showCredentialsModal.
  Bloque 4: buscador (searchAlumnos) + boton agregar manual (abre showAddStudent).
  Lista de alumnos (filteredAlumnos): orden, nombre completo, username, badge activo/sin activar; botones subir/bajar (moveStudent, solo sin busqueda), reset password (setStudentToReset), eliminar (setStudentToDelete).

MODALES (renderizados condicionalmente al final):
  showModal: crear/editar actividad. Form con nombre, instrucciones, maxCalif, FileTypeSelect (tiposArchivo + extensionesCustom), Visibilidad (radios Mostrar ahora / Ocultar / Programar + datetime-local publishAt), fecha limite. Submit -> handleSaveActivity.
  deleteConfirm: confirmar eliminar actividad -> handleDeleteActivity.
  showAddStudent: form 3 campos (apellidoPaterno, apellidoMaterno, nombre) -> addStudent.
  showQR: 3 formas de acceso (QRCode con activationUrl, copiar link, copiar codigo, descargar lista PDF via handleExportListPDF).
  studentToReset: confirmar reset de contraseña -> confirmResetStudentPassword.
  showCredentialsModal: confirmar generar credenciales -> handleGenerateCredentials.
  resetPwdResult: muestra la clave temporal generada (clickeable para copiar, copiedTempPwd feedback).
  studentToDelete: confirmar eliminar alumno -> confirmDeleteStudent.
  activateModal: activar actividad (radios Mostrar ahora / Programar + datetime-local) -> handleActivateConfirm.
  showEditSubjectModal: editar asignatura (nombre, grupo, fechas, parciales, PaletteSelect, IconSelect) -> handleEditSubject.
  showCopyModal: duplicar (nombre, grupo, fechas, palette, icon, checkbox keepStudents) -> handleCopySubject.
  showDeleteSubjectConfirm: eliminar asignatura, requiere teclear el nombre exacto -> handleDeleteSubject.
  showArchiveModal: archivar, radios save/skip (descargar ZIP de entregas o no) -> handleArchiveConfirm (muestra progreso zipProgress).
  showUnarchiveModal: desarchivar/restaurar, editar datos + opciones de alumnos (keep/reset) y actividades (keep/show/hide) -> handleUnarchiveConfirm.

----------------------------------------------------------------------
DEPENDENCIAS (imports internos del proyecto)
----------------------------------------------------------------------
  ../../firebase: db (instancia Firestore).
  ../../context/AuthContext: useAuth -> { currentUser, userProfile }.
  ../../components/Toast: useToast -> toast(msg, tipo).
  ../../components/Layout: TeacherLayout (envoltura de toda la pagina).
  ../../components/Spinner: Spinner.
  ../../components/PaletteSelect: PaletteSelect (selector de color de asignatura).
  ../../components/IconSelect: IconSelect (selector de icono).
  ../../components/SubjectIcon: SubjectIcon (renderiza el icono por iconKey).
  ../../components/FileTypeSelect: FileTypeSelect (tipo de archivo permitido + extensiones custom).
  ../../config/fileTypes: DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE.
  ../../utils/excel: exportSubjectGrades, parseStudentExcel, downloadStudentTemplate.
  ../../utils/pdf: exportStudentListPDF, exportSubjectGradesPDF, exportCredentialsPDF.
  ../../utils/downloadSubmissions: buildJobsForSubject, downloadSubmissionsZip.
  ../../utils/deleteSubjectCascade: deleteSubjectCascade, deleteSubjectStudents, deleteSubjectSubmissions.
  ../../utils/copySubject: copySubject.
  ../../utils/activityVisibility: activityVisibilityState, formatPublishAt.
  ../../utils/subjectName: subjectDisplayName.
  ../../utils/dateRange: subjectPeriodLabel.
  ../../utils/generate: generateUsername. (Nota: tambien existe en utils un generateResetPassword, pero este componente define su propio helper local del mismo nombre y usa el local.)
  Externos: react (useState, useEffect), react-router-dom (useNavigate, useParams), firebase/firestore (collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch), lucide-react (iconos), qrcode.react (QRCodeSVG como QRCode).

----------------------------------------------------------------------
NOTAS / OBSERVACIONES
----------------------------------------------------------------------
  Patron de carga perezosa: groupStudents y gradeSubMap se cargan bajo demanda (al abrir pestaña o al exportar) y se cachean con flags *Loaded; varios exportes incluyen fallback que carga los datos si la pestaña no se abrio.
  Respeta el constraint de Firestore: solo queries por igualdad (where '=='), sin orderBy ni rangos; el ordenamiento (por 'orden') se hace en memoria. Las consultas 'in' a submissions se parten en lotes de 30; los writeBatch de credenciales se parten en lotes de 490.
  Archivar conserva el esqueleto (subject + activities + students) y SIEMPRE elimina las submissions (opcionalmente exportadas como ZIP antes).
  Edicion/restauracion de asignatura validan que no queden actividades en parciales superiores al nuevo numero de parciales.
  El borrado de asignatura exige teclear el nombre exacto como confirmacion.


===== PAGINAS DOCENTE: ActivityPage y Dashboard =====

ARCHIVO: src/pages/teacher/ActivityPage.jsx
LINEAS: ~676
OBJETIVO: Pagina del docente para una actividad/tarea concreta. Lista los alumnos de la asignatura, muestra el estado de su entrega (pendiente/entregado/calificado), permite calificar cada entrega, ver/descargar archivos, extender la fecha de entrega por alumno, editar la actividad y descargar todas las entregas en ZIP.
EXPORTA: componente por defecto ActivityPage (React). Tambien define helpers a nivel de modulo: isImageFile (funcion), STATUS_COLORS (constante), STATUS_LABELS (constante).

  FN isImageFile(name, url): detecta si un archivo es imagen por su extension.
    estado: (no aplica, helper de modulo)
    efectos: (no aplica)
    datos: (no aplica)
    logica: concatena name+url en minusculas y aplica regex contra .jpg/.jpeg/.png/.gif/.webp; tambien valida la extension solo del nombre. Devuelve booleano. Se usa para decidir si se muestra preview de imagen en el modal.

  CONST STATUS_COLORS: mapa estado -> clases Tailwind de color (pendiente, entregado, calificado).
  CONST STATUS_LABELS: mapa estado -> etiqueta en espanol (Pendiente, Entregado, Calificado).

  FN ActivityPage(): componente principal de la pagina de actividad.
    estado:
      activity: objeto de la actividad cargada (doc activities), null inicial
      subject: objeto de la asignatura padre (doc subjects), null inicial
      students: arreglo de alumnos de la asignatura
      submissions: objeto/mapa alumnoId -> entrega (doc submissions)
      filter: filtro de lista, valor 'todos' por defecto (o pendiente/entregado/calificado)
      selected: alumno+entrega seleccionados para el modal de calificacion ({ student, sub }), null inicial
      gradeForm: { calificacion, comentario } del formulario de calificacion
      saving: boolean, guardando calificacion
      loading: boolean, carga inicial (true)
      showEditModal: boolean, visibilidad del modal de editar actividad
      editForm: { nombre, maxCalif, instrucciones, fechaLimite, tiposArchivo, extensionesCustom } por defecto maxCalif '10' y tiposArchivo DEFAULT_FILE_TYPE
      editSaving: boolean, guardando edicion
      searchStudents: texto de busqueda de alumnos
      sortAlpha: boolean, ordenar alfabeticamente
      extendMode: boolean, modo extension de fecha por alumno (dentro del modal)
      extendDate: string fecha de la extension
      savingExtension: boolean, guardando extension
      zipDownloading: boolean, descarga ZIP en curso
      zipProgress: { done, total } progreso de la descarga ZIP
    efectos:
      useEffect(loadAll, [activityId]): al montar y cuando cambia activityId, carga toda la data.
      useEffect navegacion teclado [selected, filtered]: si hay modal abierto (selected), registra listener keydown global; ArrowLeft/ArrowRight navegan al alumno anterior/siguiente de la lista filtrada llamando openGrade. Limpia el listener al desmontar/cambiar deps.
    datos:
      activities: getDoc(doc activities/{activityId}) lectura; updateDoc en handleEditActivity y saveExtension (campo dot-path extensiones.{studentId})
      subjects: getDoc(doc subjects/{asignaturaId}) lectura
      students: getDocs(query where asignaturaId == ...) lectura
      submissions: getDocs(query where actividadId == ...) lectura; updateDoc(doc submissions/{id}) en saveGrade
      fetch /api: (no aplica) ; descarga ZIP usa utils descargando archivos remotos (Cloudinary) via downloadSubmissions
    logica: encabezado con boton volver a /subject/{asignaturaId}, titulo, parcial; tarjetas de conteo; tabs de filtro; busqueda y orden; boton ZIP; lista de alumnos; modal de calificacion y modal de edicion.

    FN loadAll(): carga actividad, asignatura, alumnos y entregas.
      estado: setLoading(true/false), setActivity, setSubject, setStudents, setSubmissions
      efectos: invocada desde useEffect [activityId]
      datos: getDoc activities/{activityId}; getDoc subjects/{actData.asignaturaId}; Promise.all de getDocs students (where asignaturaId ==) y getDocs submissions (where actividadId ==)
      logica: ordena alumnos por campo orden (a.orden ?? 0 - b.orden ?? 0); construye subsMap indexado por alumnoId. Errores -> toast error. Cumple constraint Firestore (solo where ==).

    FN openEditModal(): precarga editForm con datos actuales de activity y abre el modal de edicion.
      estado: setEditForm, setShowEditModal(true)
      logica: copia nombre, maxCalif (String), instrucciones, fechaLimite, tiposArchivo (o DEFAULT_FILE_TYPE), extensionesCustom desde activity.

    FN handleEditActivity(e): guarda los cambios de la actividad.
      estado: setEditSaving(true/false), setShowEditModal(false)
      datos: updateDoc(doc activities/{activityId}) con nombre (trim), maxCalif (parseFloat o 10), instrucciones (trim), fechaLimite (o null), tiposArchivo (o DEFAULT_FILE_TYPE), extensionesCustom (solo si tiposArchivo === CUSTOM_FILE_TYPE, trim; si no, cadena vacia)
      logica: previene submit por defecto; toast exito; recarga con loadAll(); errores -> toast.

    FN getStatus(studentId): deriva el estado de un alumno segun su entrega.
      logica: si no hay submission -> 'pendiente'; si submission.calificacion != null -> 'calificado'; en otro caso -> 'entregado'. Usada para conteos, filtros, etiquetas y colores.

    FN openGrade(student): abre el modal de calificacion para un alumno.
      estado: setSelected({ student, sub }), setGradeForm (calificacion como String o '' y comentario), setExtendMode(false), setExtendDate(extension actual del alumno si existe en activity.extensiones)
      logica: lee la entrega del alumno desde submissions[student.id]; prepara el formulario.

    FN closeModal(): cierra el modal de calificacion.
      estado: setSelected(null), setExtendMode(false), setExtendDate('')

    FN saveGrade(e): guarda la calificacion de la entrega seleccionada.
      estado: setSaving(true/false)
      datos: updateDoc(doc submissions/{selected.sub.id}) con calificacion (parseFloat), comentario (trim), estado: 'calificado'
      logica: previene default; retorna temprano si no hay selected.sub; toast exito; closeModal(); loadAll(); errores -> toast. (Es decir, calificar requiere que exista entrega.)

    FN saveExtension(): guarda una fecha limite individual (extension) para el alumno seleccionado.
      estado: setSavingExtension(true/false), setExtendMode(false), actualiza activity local (extensiones)
      datos: updateDoc(doc activities/{activityId}) con dot-path [`extensiones.${selected.student.id}`] = extendDate
      logica: retorna si no hay selected o extendDate; actualiza optimisticamente el estado activity en memoria fusionando extensiones; toast; errores -> toast. La extension se muestra como icono CalendarDays naranja en la fila del alumno.

    FN handleZipDownload(): descarga todas las entregas con archivo en un ZIP.
      estado: setZipDownloading(true/false), setZipProgress({done,total})
      datos: lee submissions (memoria); usa buildJobsForActivity({students, submissions}) y downloadSubmissionsZip({zipName, jobs, onProgress}) de utils/downloadSubmissions (descarga archivos remotos, p.ej. Cloudinary)
      logica: si no hay jobs -> toast informativo y retorna; al terminar muestra toast con conteo de escritos y errores; resetea progreso en finally.

    FN goToOffset(off): navega al alumno en la posicion actual +off dentro de la lista filtrada.
      logica: usa curIdx (indice del alumno actual en filtered) y llama openGrade(next) si existe. Usado por botones Anterior/Siguiente del modal.

    Variables/derivados clave (en el cuerpo del render, no funciones nombradas):
      counts: objeto con conteos pendiente/entregado/calificado calculados con getStatus sobre students.
      filtered: lista de alumnos tras aplicar filter, busqueda searchStudents (compara apellidoPaterno+apellidoMaterno+nombre en minusculas) y orden sortAlpha (localeCompare 'es' por apellidoPaterno+nombre).
      curIdx: indice del alumno seleccionado dentro de filtered (-1 si no hay seleccion).

    Render / UI relevante:
      Lista de alumnos: cada fila muestra orden, nombre completo, fecha de entrega (sub.fechaEntrega.seconds -> Date local es-MX), icono de extension (CalendarDays naranja si hay activity.extensiones[s.id]), calificacion (Star, X/maxCalif) si calificada, y badge de estado.
      Modal de calificacion (selected): titulo con nombre; subtitulo segun entrega (Completada sin archivo / nombreArchivo / Sin entrega aun); navegacion Anterior/Siguiente con contador; preview de imagen si isImageFile; enlace Ver/Descargar entrega (archivoURL, target _blank) cuando hay archivo y no es completadoSinArchivo; historial de versiones anteriores (sub.historial invertido, con fecha y enlace de descarga o "sin archivo"); formulario de calificacion (input number con min 0, max maxCalif, step 0.1, requerido; textarea comentario opcional) solo si existe entrega; si no hay entrega muestra texto "El alumno aun no ha entregado esta tarea."; seccion inferior para Modificar fecha de entrega (extendMode con input date + Guardar/Cancelar).
      Modal de edicion (showEditModal): formulario con nombre (requerido), calificacion maxima (number min 1 max 100 requerido), instrucciones (opcional), fecha limite (date opcional), FileTypeSelect (tiposArchivo + extensiones personalizadas).
      Visibilidad: el boton de descarga ZIP solo se muestra si existe al menos una submission con archivoURL y sin completadoSinArchivo. El estado calificado/entregado/pendiente controla badges y conteos.

  DATOS: lee activities/{id} (getDoc) y subjects/{id} (getDoc); lee students (getDocs where asignaturaId ==) y submissions (getDocs where actividadId ==). Escribe submissions/{id} (updateDoc: calificacion, comentario, estado) al calificar; activities/{id} (updateDoc) al editar actividad y al guardar extension por alumno (campo mapa extensiones.{studentId}). Descarga de archivos de entrega via utils (recursos remotos). Respeta el constraint Firestore (solo igualdad ==, sin orderBy; orden en memoria).
  DEPENDENCIAS: ../../firebase (db); ../../components/Toast (useToast); ../../components/Layout (TeacherLayout, default); ../../components/Spinner; ../../components/FileTypeSelect; ../../config/fileTypes (DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE); ../../utils/downloadSubmissions (buildJobsForActivity, downloadSubmissionsZip); ../../utils/subjectName (subjectDisplayName); react-router-dom (useNavigate, useParams); firebase/firestore; lucide-react (iconos).


ARCHIVO: src/pages/teacher/Dashboard.jsx
LINEAS: ~429
OBJETIVO: Panel principal del docente tras iniciar sesion. Carga y lista las asignaturas del docente, permite crear nuevas asignaturas via modal (con fechas inicio/fin opcionales, grupo, parciales, paleta de color e icono), alterna el orden de visualizacion del nombre (Asignatura-Grupo vs Grupo-Asignatura), y muestra los modales de bienvenida (post-registro) y de periodo de prueba.
EXPORTA: componente por defecto TeacherDashboard (React). Tambien define helper de modulo generateAccessCode.

  FN generateAccessCode(): genera un codigo de acceso aleatorio de 6 caracteres en mayusculas.
    logica: Math.random().toString(36).slice(2,8).toUpperCase(). Usado al crear una asignatura (campo accessCode).

  FN TeacherDashboard(): componente principal del dashboard del docente.
    estado:
      subjects: arreglo de asignaturas del docente
      loading: boolean, carga inicial (true)
      showWelcomeModal: boolean; inicial = (location.state.newAccount === true) -> se muestra una vez tras registro
      welcomeUsername: string desde location.state.createdUsername (no es estado, constante derivada)
      trialDismissed: boolean; inicial leido de sessionStorage 'trialDismissed' === '1'
      subscription, subLoading: del hook useSubscription
      isTrial: derivado subscription?.status === 'trial'
      daysLeft: derivado con calcDaysRemaining(subscription.fechaVencimiento) si isTrial, si no 0
      showSubjectModal: boolean; inicial = (location.state.openCreate === true)
      newSubjectName: string nombre de la asignatura
      newSubjectGrupo: string grupo
      newSubjectParciales: numero de parciales, por defecto 3
      newSubjectPalette: paleta de color, por defecto 'default'
      newSubjectIcon: icono, por defecto 'book'
      newSubjectFechaInicio: string fecha inicio (opcional)
      newSubjectFechaFin: string fecha fin (opcional)
      creatingSubject: boolean, creando asignatura
      nameOrder: 'normal' | 'reverse'; inicial leido de localStorage 'subjectNameOrder' (default 'normal'); controla el orden de despliegue del nombre
    efectos:
      useEffect([currentUser]): si hay currentUser, llama loadAll() para cargar asignaturas.
      useEffect([location.key]): si location.state.openCreate, abre el modal de creacion (setShowSubjectModal(true)) y limpia el state navegando con replace al mismo pathname con state vacio. Soluciona el caso de abrir el modal cuando YA estas en /dashboard (boton del sidebar), donde el inicializador de useState no se re-ejecuta; location.key cambia en cada navegacion.
    datos:
      subjects: getDocs(query where docenteId == currentUser.uid) lectura en loadAll; addDoc(collection subjects) al crear
      fetch /api: (no aplica directamente; el estado de suscripcion viene del hook useSubscription)
    logica: saludo con nombreMostrar/username y schoolName; spinner si loading; seccion "Mis asignaturas" con toggle de orden y conteo; lista o estado vacio; FAB de creacion (solo movil); modal de nueva asignatura; modal de bienvenida; modal de prueba.

    FN toggleNameOrder(): alterna y persiste el orden de visualizacion del nombre de asignatura.
      estado: setNameOrder
      datos: localStorage.setItem('subjectNameOrder', next)
      logica: 'normal' <-> 'reverse'. 'normal' muestra Asignatura-Grupo; 'reverse' muestra Grupo-Asignatura (subjectDisplayName(s, nameOrder === 'reverse')).

    FN loadAll(): carga las asignaturas del docente.
      estado: setLoading(true/false), setSubjects
      efectos: invocada desde useEffect [currentUser]
      datos: getDocs(query collection subjects where docenteId == currentUser.uid)
      logica: mapea docs; ordena en memoria por nombre (localeCompare 'es') y, en empate, por grupo. Errores -> toast error. (Respeta constraint Firestore: solo where ==, sin orderBy.)

    FN handleCreateSubject(e): crea una nueva asignatura desde el modal.
      estado: setCreatingSubject(true/false); al exito limpia todos los campos del formulario (nombre, grupo, parciales->3, palette->default, icon->book, fechas) y cierra el modal (setShowSubjectModal(false)); actualiza subjects en memoria
      datos: addDoc(collection subjects) con: nombre (trim), grupo (trim), docenteId (currentUser.uid), escuelaId (userProfile.escuelaId), parciales, fechaInicio (o ''), fechaFin (o ''), colorPalette, icon, accessCode (generateAccessCode()), archived: false, createdAt: serverTimestamp()
      logica: previene default; valida que nombre y grupo no esten vacios (retorna si faltan); inserta el nuevo subject en la lista y la re-ordena (mismo criterio nombre->grupo); toast "Asignatura creada"; navega a /subject/{ref.id}; errores -> toast.

    Render / UI relevante:
      Saludo: muestra userProfile.nombreMostrar || userProfile.username || 'Docente' y userProfile.schoolName.
      Mis asignaturas: cabecera con boton toggleNameOrder (icono ArrowUpDown, texto "Asignatura · Grupo" / "Grupo · Asignatura") y conteo de asignaturas. Estado vacio con icono BookOpen e instruccion de usar el boton +.
      Tarjeta de asignatura: data-subject-palette segun colorPalette; icono via SubjectIcon; nombre via subjectDisplayName(s, nameOrder === 'reverse'); badge "archivada" si s.archived; etiqueta de periodo via subjectPeriodLabel(s) si existe; navega a /subject/{id} al click.
      FAB (md:hidden): boton flotante + para crear asignatura, solo en movil; en web se usa el boton "Nueva asignatura" del sidebar (Layout).
      Modal Nueva asignatura (showSubjectModal): formulario con Asignatura (requerido, autoFocus), Grupo (requerido), Fechas inicio/fin (inputs date opcionales, lado a lado), Calificaciones parciales (botones 1..6, por defecto 3), Color de la asignatura (PaletteSelect), Icono (IconSelect, contenedor con data-subject-palette del palette elegido para preview), boton Crear asignatura (spinner mientras creatingSubject).
      Modal de bienvenida (showWelcomeModal): se muestra una vez tras registro (location.state.newAccount); destaca el nombre de usuario welcomeUsername en grande, avisa que se envio el usuario y un enlace de verificacion al correo; boton "Entrar al dashboard" cierra el modal.
      Modal de periodo de prueba (isTrial && !trialDismissed && !subLoading): muestra dias restantes (daysLeft) o "periodo terminado"; tarjeta Plan Pro $100/mes; boton "Contratar Plan Pro" navega a /profile y marca trialDismissed; boton/X "Recordармelo despues" marca sessionStorage 'trialDismissed'='1' y oculta el modal en la sesion.

  DATOS: lee subjects (getDocs where docenteId == currentUser.uid). Escribe subjects (addDoc) al crear asignatura. La suscripcion (trial) se obtiene via hook useSubscription. Ordenamiento siempre en memoria (constraint Firestore). Persistencia local: localStorage 'subjectNameOrder' (orden del nombre), sessionStorage 'trialDismissed' (modal de prueba descartado en la sesion).
  DEPENDENCIAS: ../../firebase (db); ../../context/AuthContext (useAuth -> currentUser, userProfile); ../../components/Toast (useToast); ../../components/Layout (TeacherLayout, default; ademas el sidebar de Layout dispara este dashboard con location.state.openCreate); ../../components/Spinner; ../../utils/subjectName (subjectDisplayName); ../../utils/dateRange (subjectPeriodLabel); ../../components/PaletteSelect; ../../components/IconSelect; ../../components/SubjectIcon; ../../hooks/useSubscription (useSubscription); ../../utils/subscriptionHelpers (calcDaysRemaining); react-router-dom (useNavigate, useLocation); firebase/firestore; lucide-react (iconos).


===== PAGINAS DOCENTE: Profile, Register, RegisterSchool =====

NOTA GENERAL SOBRE ESCUELAS Y USERNAME (aplica a los 3 archivos):
  Catalogo de planteles:
    Se carga con el hook usePlanteles() (lazy, cacheado a nivel de modulo).
    Cada plantel del catalogo tiene campos: nombre, short, cct, sub, mun, edo.
    Busqueda en memoria por nombre/short/cct/mun; se recorta a 60 (sin query) u 80 (con query) resultados.
  Tipos de escuela que el docente puede elegir:
    1) Plantel del catalogo: se busca/crea school por claveSEP == plantel.cct.
    2) Escuela personalizada (custom): la teclea el docente (ej. Telesecundaria no listada); se busca/crea school por nombre == name.
    3) Sin escuela: usa school sentinela con id fijo "sin-escuela" (shortName "EF", flag sinEscuela: true).
  Generacion de username docente:
    Funcion generateTeacherUsername(shortName, count) => `${PREFIX}-${NN}` donde PREFIX = shortName en mayusculas sin espacios y NN = (count+1) con padding a 2 digitos.
    count = numero de docentes ya existentes en esa escuela (se cuentan con where('escuelaId','==',schoolId)).
    Resultado tipico: CBTIS255-01, EF-01, etc.

-------------------------------------------------------------------------------

ARCHIVO: src/pages/teacher/Profile.jsx
LINEAS: ~528
OBJETIVO: Pagina de perfil del docente; permite ver/gestionar plan-suscripcion, foto de avatar, nombre visible, escuela y acceso (usuario/correo solo lectura + cambio de contrasena).
EXPORTA: componente por defecto Profile (ademas helper interno uploadAvatar y constante inputCls no exportados).

  FN uploadAvatar(file): sube una imagen a Cloudinary y devuelve la URL segura.
    datos: fetch POST a https://api.cloudinary.com/v1_1/{cloudName}/image/upload (no Firestore); usa env VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET; carpeta evalua-facil/avatars.
    logica: arma FormData con file + upload_preset + folder; si res no ok lanza Error('Error al subir imagen'); retorna res.json().secure_url.

  const inputCls: clase Tailwind reutilizable para inputs de la pagina (no es funcion).

  FN Profile(): componente principal de la pagina de perfil.
    estado:
      nombre (init userProfile.nombreMostrar) + savingNombre — campo nombre visible.
      photoUploading — flag de subida de foto.
      showSchoolPicker, schoolSearch, savingSchool — overlay selector de escuela.
      showPwdForm, currentPwd, newPwd, confirmPwd, savingPwd — formulario cambio de contrasena.
      confirm ({title,message,onConfirm} | null) + confirming — modal de confirmacion generico.
      showPaymentModal — abre CheckoutModal.
    efectos: no usa useEffect directo; depende de hooks externos (useAuth, useSubscription, usePlanteles) que internamente cargan datos.
    datos:
      lee planteles via usePlanteles (fetch a /public/planteles.json a traves del hook).
      lee suscripcion/planes/pagos via useSubscription (subscription, currentPlan, plans, recentPayments).
      escribe users/{uid} con updateDoc en: foto (photoURL), nombre (nombreMostrar), escuela (escuelaId+schoolName).
      escribe schools con setDoc (sentinela sin-escuela merge, custom nuevo, o plantel catalogo nuevo) y getDocs para buscar existentes.
      Auth: reautenticacion + updatePassword (no Firestore).
    logica: renderiza tarjetas Mi plan, Foto/identidad, Nombre, Escuela, Acceso; ademas modal de confirmacion y overlay selector de escuela; usa TeacherLayout como contenedor.

    Variables derivadas dentro de Profile():
      filteredPlanteles (useMemo): filtra planteles por schoolSearch (nombre/short/cct/mun); recorta a 60/80 (igual patron que Register).
      hasEmailProvider: true si currentUser.providerData incluye providerId 'password' (controla si se muestra el cambio de contrasena).
      displayName: userProfile.nombreMostrar || username || 'Docente'.
      initials: primera letra de displayName en mayuscula (avatar fallback).
      daysRemaining: calcDaysRemaining(subscription.fechaVencimiento) o null.
      canRenew: true si no hay suscripcion, o status en (vencida, pendiente_pago, trial), o (activa y daysRemaining <= 7). Controla si se muestra boton Contratar/Renovar.

    FN updateSchool(plantel): cambia la escuela del docente segun el plantel elegido (o null = sin escuela).
      estado: setSavingSchool(true/false); al exito cierra el picker (setShowSchoolPicker(false)).
      datos:
        Caso null: setDoc(schools/'sin-escuela', {nombre:'Sin escuela', shortName:'EF', sinEscuela:true}, merge); escuelaId='sin-escuela'.
        Caso plantel.custom: getDocs(schools where nombre==name); si existe usa su id, si no setDoc(nuevo school {nombre, shortName:name, custom:true}).
        Caso catalogo: getDocs(schools where claveSEP==plantel.cct); si existe usa su id, si no setDoc(nuevo school {claveSEP, nombre, shortName, subsistema, municipio, estado}).
        Siempre: updateDoc(users/{uid}, {escuelaId, schoolName}).
      logica: tras escribir actualiza setUserProfile en memoria; toast informando que el cambio solo aplica a asignaturas y alumnos nuevos; captura errores con toast 'Error: ...'.

    FN resetPwdForm(): limpia los tres campos de contrasena y oculta el formulario (setShowPwdForm(false)).

    FN reauth(password): reautentica al usuario con email+password antes de operaciones sensibles.
      datos: EmailAuthProvider.credential(currentUser.email, password) + reauthenticateWithCredential (Firebase Auth, no Firestore).

    FN handlePhotoChange(e): sube y guarda una nueva foto de avatar.
      estado: setPhotoUploading(true/false).
      datos: uploadAvatar(file) -> Cloudinary; updateDoc(users/{uid}, {photoURL:url}); setUserProfile en memoria.
      logica: toma e.target.files[0]; si no hay archivo retorna; toast exito/error.

    FN handleSaveNombre(e): guarda el nombre visible del docente.
      estado: setSavingNombre(true/false).
      datos: updateDoc(users/{uid}, {nombreMostrar: nombre.trim()}); setUserProfile en memoria.
      logica: preventDefault; toast 'Nombre actualizado' / error.

    FN requestPwdChange(e): valida el formulario de contrasena y dispara el modal de confirmacion.
      logica: preventDefault; valida newPwd >= 6 chars, newPwd === confirmPwd, currentPwd no vacio (toast error en cada fallo); si pasa, setConfirm({title:'Cambiar contraseña', message:'¿Está seguro...?', onConfirm: executePwdChange}).

    FN executePwdChange(): ejecuta el cambio de contrasena tras confirmar.
      estado: setSavingPwd(true/false).
      datos: reauth(currentPwd) + updatePassword(currentUser, newPwd) (Firebase Auth).
      logica: en exito toast + resetPwdForm; si err.code es invalid-credential o wrong-password toast 'Contraseña actual incorrecta', si no toast 'Error: ...'.

    FN handleConfirm(): handler del boton Confirmar del modal generico.
      estado: setConfirming(true/false); al final setConfirm(null).
      logica: await confirm.onConfirm() (p.ej. executePwdChange); siempre cierra el modal.

  DATOS:
    users/{uid}: updateDoc para photoURL, nombreMostrar, escuelaId+schoolName.
    schools: getDocs (buscar por nombre o claveSEP) y setDoc (crear sentinela sin-escuela, custom o de catalogo).
    subscriptions / plans / pagos: lectura indirecta via hook useSubscription.
    planteles.json: lectura indirecta via usePlanteles.
    Cloudinary: fetch POST para avatar (externo, no Firestore).
    Firebase Auth: reauthenticateWithCredential + updatePassword.
  DEPENDENCIAS:
    ../../firebase (db)
    ../../context/AuthContext (useAuth: currentUser, userProfile, setUserProfile)
    ../../components/Toast (useToast)
    ../../components/Layout (TeacherLayout)
    ../../components/Spinner
    ../../components/PasswordInput
    ../../components/CheckoutModal
    ../../data/usePlanteles (usePlanteles)
    ../../hooks/useSubscription (useSubscription)
    ../../utils/subscriptionHelpers (calcDaysRemaining, formatCurrency, formatDate, formatLimit, getDaysLabel, getPaymentStatusColor, getSubscriptionStatusColor)
    lucide-react (iconos), firebase/auth, firebase/firestore
    NOTA: El texto de UI dice "Período de prueba — 60 días gratuitos" pero Register crea el trial a 45 dias reales (ver Register.jsx). Discrepancia copy vs logica.

-------------------------------------------------------------------------------

ARCHIVO: src/pages/teacher/Register.jsx
LINEAS: ~315
OBJETIVO: Pagina publica de alta de docente con correo+contrasena; selecciona/crea escuela (catalogo, personalizada o "sin escuela"), crea cuenta Auth, perfil Firestore, suscripcion trial y envia correo de bienvenida.
EXPORTA: componente por defecto Register (ademas helper interno generateTeacherUsername no exportado).

  FN generateTeacherUsername(shortName, count): genera username docente PREFIX-NN (ver NOTA GENERAL arriba).

  FN Register(): componente principal del formulario de registro.
    estado:
      email, password, confirmPassword — credenciales.
      selectedPlantel (objeto plantel | {custom,...} | null) — escuela elegida.
      skipSchool (bool) — casilla "prefiero no elegir ahora" (=> sin-escuela).
      showPicker, search — overlay selector de escuela.
      loading — flag de envio.
    efectos: no usa useEffect propio; usePlanteles carga el catalogo bajo demanda.
    datos: usePlanteles (catalogo); en submit escribe schools, users, subscriptions y opcionalmente correo via EmailJS.
    logica derivada:
      filtered (useMemo): filtra planteles por search (nombre/short/cct/mun), recorta 60/80.

    FN handleSubmit(e): crea la cuenta de docente completa.
      estado: setLoading(true/false).
      datos:
        Auth: createUserWithEmailAndPassword(auth, email, password) + updateProfile(displayName=username).
        schools: segun caso (ver abajo) getDocs/setDoc.
        users/{uid}: setDoc {role:'docente', username, email(lower trim), escuelaId, schoolName, photoURL:null}.
        subscriptions: addDoc {docenteId, planId:'', escuelaId, schoolName, status:'trial', fechaInicio, fechaVencimiento, createdAt, updatedAt} (Timestamps).
        correo: sendWelcomeEmail({email, username, school}) best-effort (.catch(()=>{})).
      logica (validaciones y ramas):
        preventDefault; valida: si no skipSchool y no selectedPlantel -> toast 'Selecciona tu escuela'; password === confirmPassword; password.length >= 6.
        Determinacion de escuela:
          skipSchool: schoolId='sin-escuela', shortForUsername='EF', schoolNombre='Sin escuela'; setDoc(schools/'sin-escuela', {nombre,'shortName':'EF', sinEscuela:true}, merge).
          selectedPlantel.custom: name = nombre.trim(); getDocs(schools where nombre==name); si existe usa id, si no setDoc nuevo {nombre, shortName:name, custom:true}; shortForUsername = primera palabra de name recortada a 8 chars o 'ESC'; schoolNombre = name.
          catalogo: getDocs(schools where claveSEP==selectedPlantel.cct); si existe usa id, si no setDoc nuevo {claveSEP, nombre, shortName, subsistema, municipio, estado}; shortForUsername y schoolNombre = short || nombre.
        Genera username: getDocs(users where escuelaId==schoolId), username = generateTeacherUsername(shortForUsername, teacherSnap.size).
        Trial: trialStart = ahora; trialEnd = trialStart + 45 dias (setDate +45). [El comentario del codigo dice "60-day trial" pero el calculo es 45 dias].
        Navegacion: navigate('/dashboard', { state:{ newAccount:true, createdUsername: username } }).
        Manejo de errores: si err.code === 'auth/email-already-in-use' toast 'Este correo ya tiene cuenta. Inicia sesión.'; si no toast 'Error: ...'.

  DATOS:
    schools: getDocs (where nombre / where claveSEP) + setDoc (sentinela sin-escuela merge, custom, o catalogo nuevo).
    users/{uid}: setDoc del perfil docente.
    subscriptions: addDoc del trial (45 dias).
    users where escuelaId: getDocs para contar docentes y armar el username.
    EmailJS: envio de correo de bienvenida (best-effort).
  DEPENDENCIAS:
    ../../firebase (auth, db)
    ../../components/Toast (useToast)
    ../../utils/welcomeEmail (sendWelcomeEmail)
    ../../components/Spinner
    ../../components/PasswordInput
    ../../data/usePlanteles (usePlanteles)
    react-router-dom (Link, useNavigate)
    firebase/auth (createUserWithEmailAndPassword, updateProfile)
    firebase/firestore (Timestamp, addDoc, collection, doc, getDocs, query, setDoc, where)
    lucide-react (iconos)
    UI extra: overlay picker con buscador, opcion "Agregar «texto»" para escuela custom, casilla skipSchool, aviso al llegar a 80 resultados.

-------------------------------------------------------------------------------

ARCHIVO: src/pages/teacher/RegisterSchool.jsx
LINEAS: ~257
OBJETIVO: Paso de completado de perfil para docentes que entraron con Google (sin perfil aun); pide plantel (solo catalogo) y contrasena, vincula credencial email/password a la cuenta de Google y crea el perfil Firestore.
EXPORTA: componente por defecto RegisterSchool (ademas helper interno generateTeacherUsername no exportado).

  FN generateTeacherUsername(shortName, count): genera username docente PREFIX-NN (identico al de Register; ver NOTA GENERAL).

  FN RegisterSchool(): componente principal del paso "Un último paso".
    estado:
      selectedPlantel — escuela elegida (solo plantel de catalogo, no soporta custom ni sin-escuela aqui).
      showPicker, search — overlay selector de escuela.
      password, confirmPassword — contrasena del sistema a vincular.
      saving — flag de envio.
    variable: user = auth.currentUser (la sesion de Google ya activa). Si !user el componente retorna null.
    efectos: no usa useEffect propio; usePlanteles carga el catalogo.
    datos: usePlanteles (catalogo); en submit escribe schools y users; Auth linkWithCredential.
    logica derivada:
      filtered (useMemo): filtra planteles por search (mismo patron que Register).

    FN handleSubmit(e): completa el perfil del docente de Google.
      estado: setSaving(true/false).
      datos:
        schools: getDocs(where claveSEP==selectedPlantel.cct); si existe usa id, si no setDoc nuevo {claveSEP, nombre, shortName, subsistema, municipio, estado}.
        users where escuelaId: getDocs para contar docentes -> username = generateTeacherUsername(short||nombre, teacherSnap.size).
        Auth: EmailAuthProvider.credential(user.email, password) + linkWithCredential(user, credential) para permitir login tambien con usuario/contrasena.
        users/{user.uid}: setDoc profile {role:'docente', username, email:user.email, escuelaId:schoolId, photoURL:user.photoURL||null}.
      logica (validaciones y ramas):
        preventDefault; si !user -> navigate('/', replace) y return; si !selectedPlantel toast 'Selecciona tu escuela'; password===confirmPassword; password.length >= 6.
        El try/catch de linkWithCredential ignora error 'auth/provider-already-linked' (ya vinculado) y relanza cualquier otro.
        setUserProfile en memoria con {...profile, schoolName: selectedPlantel.nombre, claveSEP: selectedPlantel.cct}.
        navigate('/dashboard').
        Errores generales: toast 'Error: ...'.
      Nota diferencia vs Register: aqui el perfil NO crea suscripcion trial ni envia correo de bienvenida, NO guarda schoolName en el doc users (solo en memoria), y solo admite escuelas del catalogo (sin custom ni "sin escuela").

  DATOS:
    schools: getDocs (where claveSEP) + setDoc (crear de catalogo).
    users where escuelaId: getDocs para contar y armar username.
    users/{uid}: setDoc del perfil docente.
    Firebase Auth: linkWithCredential (vincula email/password a cuenta Google).
  DEPENDENCIAS:
    ../../firebase (auth, db)
    ../../context/AuthContext (useAuth: setUserProfile)
    ../../components/Toast (useToast)
    ../../components/Spinner
    ../../components/PasswordInput
    ../../data/usePlanteles (usePlanteles)
    react-router-dom (useNavigate)
    firebase/auth (EmailAuthProvider, linkWithCredential)
    firebase/firestore (collection, doc, getDocs, query, setDoc, where)
    lucide-react (iconos)


===== PAGINAS DOCENTE/PUBLICAS: Login, VerifyEmail, PagoResultado, Landing =====

ARCHIVO: src/pages/teacher/Login.jsx
LINEAS: ~121
OBJETIVO: Pantalla de inicio de sesion del docente. Acepta nombre de usuario (o correo) + contrasena y autentica contra Firebase Auth.
EXPORTA: componente por defecto TeacherLogin (React component)

  FN TeacherLogin(): renderiza el formulario de login del docente y maneja la autenticacion
    estado:
      username (string): valor del campo Usuario; inicia ''
      password (string): valor del campo Contrasena; inicia ''
      loading (boolean): true mientras corre el login; deshabilita el boton y muestra Spinner; inicia false
    efectos: (no usa useEffect)
    datos:
      colección users: getDocs con query where('username','==',input) para resolver el correo real a partir del nombre de usuario (solo si el input no contiene '@')
      Firebase Auth: signInWithEmailAndPassword(auth, userEmail, password)
    logica:
      lee location.state via useLocation; si location.state.showEmailReminder es true, toma emailReminderEmail = location.state.email para mostrar un banner azul "Tu nombre de usuario fue enviado a {email}"
      handleLogin(e): e.preventDefault() -> setLoading(true) -> input = username.trim()
        si input incluye '@' -> userEmail = input (se asume correo directo)
        si no -> consulta users por username; si snap.empty muestra toast('Usuario o contraseña incorrectos','error') y retorna (sin desactivar loading explicito antes de finally); en otro caso userEmail = snap.docs[0].data().email
        signInWithEmailAndPassword(auth, userEmail, password) -> navigate('/dashboard')
        catch err: toast con 'Usuario o contraseña incorrectos' si err.code === 'auth/invalid-credential', si no 'Error al iniciar sesión'
        finally: setLoading(false)
      UI: logo GraduationCap, titulo "Evalúa Fácil", subtitulo "Evidencias y calificaciones. Sin complicaciones."
      formulario: input texto Usuario (autoComplete username, placeholder "Ej. 110010-01") + PasswordInput Contrasena (autoComplete current-password) + boton "Entrar"/"Entrando…" con Spinner cuando loading
      enlaces: Link a /register ("Crear cuenta") y Link a /alumno ("Acceso de alumnos")
    DATOS: solo lee colección users (getDocs por username para mapear a email). Autenticacion via Firebase Auth (signInWithEmailAndPassword). No escribe Firestore.
    DEPENDENCIAS:
      ../../firebase (auth, db)
      ../../components/Toast (useToast)
      ../../components/Spinner (Spinner)
      ../../components/PasswordInput (PasswordInput)
      lucide-react (GraduationCap)
      react-router-dom (Link, useNavigate, useLocation)
      firebase/auth (signInWithEmailAndPassword)
      firebase/firestore (collection, getDocs, query, where)


ARCHIVO: src/pages/teacher/VerifyEmail.jsx
LINEAS: ~128
OBJETIVO: Pagina que procesa el enlace de verificacion de correo del docente (uid + token por query string) y marca la cuenta como activada en Firestore.
EXPORTA: componente por defecto VerifyEmail (React component)

  FN VerifyEmail(): valida el token del enlace de verificacion, actualiza el doc del usuario y muestra estado (loading/success/error/wrongUser)
    estado:
      status (string): 'loading' | 'success' | 'error' | 'wrongUser'; inicia 'loading'
    efectos:
      useEffect con deps [authLoading, currentUser]:
        si authLoading -> return (espera a que AuthContext termine)
        lee searchParams.get('uid') y searchParams.get('token')
        si falta uid o token -> setStatus('error') y return
        si no hay currentUser -> guarda { uid, token } en localStorage clave 'pendingVerify', navigate('/docente', { replace:true }) y return (el usuario debe iniciar sesion primero)
        si currentUser.uid !== uid -> setStatus('wrongUser') y return
        en otro caso -> llama verify(uid, token)
    datos:
      colección users: getDoc(doc(db,'users',uid)) para leer el doc y su verifyToken
      colección users: updateDoc(doc(db,'users',uid), { cuentaActivada:true, verifyToken:null }) al validar
    logica:
      obtiene de useAuth: { currentUser, loading:authLoading, setUserProfile }
      navegacion via useNavigate; query via useSearchParams
    FN verify(uid, token): comprueba el token contra Firestore y activa la cuenta
      datos: getDoc users/{uid}; updateDoc users/{uid} con cuentaActivada:true, verifyToken:null
      logica:
        si el doc no existe -> setStatus('error') y return
        si data.verifyToken !== token -> setStatus('error') y return (token invalido o ya usado)
        si coincide -> updateDoc para activar; setUserProfile(prev => ({...prev, cuentaActivada:true, verifyToken:null})) para refrescar el perfil en memoria; setStatus('success'); setTimeout 2500ms -> navigate('/dashboard',{replace:true})
        catch -> setStatus('error')
      UI por status:
        loading: Spinner lg + "Verificando tu enlace…"
        success: check verde + "¡Cuenta activada!" + redireccion
        error: icono rojo + "Enlace no válido" + boton "Ir al dashboard" (navigate /dashboard)
        wrongUser: icono ambar + "Cuenta incorrecta" + boton "Iniciar sesión" (navigate /docente)
    DATOS: colección users -> getDoc (leer verifyToken) y updateDoc (cuentaActivada:true, verifyToken:null). Usa localStorage 'pendingVerify' cuando no hay sesion activa.
    DEPENDENCIAS:
      ../../firebase (db)
      ../../context/AuthContext (useAuth)
      ../../components/Spinner (Spinner)
      react-router-dom (useNavigate, useSearchParams)
      firebase/firestore (doc, getDoc, updateDoc)


ARCHIVO: src/pages/teacher/PagoResultado.jsx
LINEAS: ~52
OBJETIVO: Pantalla de retorno tras un pago (MercadoPago/PayPal). Muestra resultado segun el query param status y ofrece volver al perfil.
EXPORTA: componente por defecto PagoResultado (React component)

  CONSTANTES (modulo):
    VARIANTS: objeto con tres claves de estado, cada una con { icon, color, bg, title, text }
      success: CheckCircle2, emerald, "¡Pago recibido!" / "Tu suscripción se activará en unos segundos..."
      pending: Clock, amber, "Pago pendiente" / "Tu pago está en proceso..."
      failure: XCircle, red, "Pago no completado" / "No se concretó el pago..."

  FN PagoResultado(): renderiza tarjeta de resultado de pago segun status de la URL
    estado: (sin useState)
    efectos: (sin useEffect)
    datos: (no lee/escribe Firestore ni llama fetch; el alta de suscripcion la hace el backend serverless via webhook, fuera de esta vista)
    logica:
      lee params via useSearchParams; status = params.get('status') || 'pending'
      v = VARIANTS[status] || VARIANTS.pending (fallback a pending si el status no coincide; nota: el query 'failure' mapea a la variante failure)
      Icon = v.icon
      UI: tarjeta centrada con icono coloreado segun variante, titulo v.title, texto v.text y boton "Ir a mi perfil" -> navigate('/profile',{replace:true})
    DATOS: ninguna coleccion Firestore ni llamada /api directa. Solo lee el query param status.
    DEPENDENCIAS:
      react-router-dom (useNavigate, useSearchParams)
      lucide-react (CheckCircle2, Clock, XCircle)


ARCHIVO: src/pages/Landing.jsx
LINEAS: ~53
OBJETIVO: Pagina publica de entrada que permite elegir rol (Docente o Alumno) y dirige al login correspondiente.
EXPORTA: componente por defecto Landing (React component)

  FN Landing(): muestra dos tarjetas de seleccion de rol (Docente azul / Alumno naranja)
    estado: (sin useState)
    efectos: (sin useEffect)
    datos: (no lee/escribe Firestore ni llama fetch)
    logica:
      tarjeta Docente: Link a /docente, icono GraduationCap, fondo azul (bg-blue-600), "Soy Docente" / "Administra y evalúa tus asignaturas" + "Entrar" con ChevronRight
      tarjeta Alumno: Link a /alumno, icono BookOpen, fondo naranja (bg-orange-500), "Soy Alumno" / "Entra a tus asignaturas y entregas" + "Entrar"
      pie: Link a /register ("Crear cuenta") para docentes sin cuenta
      comentario en codigo: theming por rol, Docente=azul, Alumno=naranja, sin contenido mezclado
    DATOS: ninguna coleccion Firestore ni llamada /api. Pagina puramente de navegacion.
    DEPENDENCIAS:
      react-router-dom (Link)
      lucide-react (GraduationCap, BookOpen, ChevronRight)


===== PAGINAS DE ALUMNO =====

CONTEXTO GENERAL DEL FLUJO DE ACCESO DEL ALUMNO
  emails_falsos:
    Los alumnos nunca tienen email real. Firebase Auth usa un email sintetico
    construido por studentEmail(username, escuelaId) -> `${username.toLowerCase()}.${escuelaId}@evalua.local`.
    El email se deriva siempre del par (username, escuelaId), por eso un mismo alumno
    inscrito en varias asignaturas de la misma escuela comparte el mismo email y el mismo uid.
  identidad_vs_inscripcion:
    Cada inscripcion del alumno a una asignatura es un doc separado en la coleccion `students`
    (un doc por asignatura), pero todos comparten el mismo uid de auth. La identidad
    (nombre/username) es compartida entre inscripciones; lo que cambia es asignaturaId / id de doc.
    La resolucion de "que doc students corresponde a esta asignatura" se hace via utils/studentLookup
    (getEnrollments, getEnrollmentForSubject), no rediseñando el esquema.
  doc_users_alumno:
    Al activar/loguear se crea/mergea tambien un doc users/{uid} con role:'alumno' y los datos
    de identidad (username, escuelaId, studentId, nombre, apellidos). studentId apunta a UNA de
    las inscripciones (no necesariamente todas).
  estados_inscripcion (campos en students):
    activado: boolean (true = cuenta de auth ya vinculada para esta inscripcion)
    uid: uid de auth una vez vinculado
    resetPassword: contraseña temporal emitida por el docente; al activar/loguear se limpia (null)
  tres_vias_de_primer_acceso:
    1. Login.jsx: activacion inline (sin paso aparte) escribiendo username + contraseña deseada.
    2. Activation.jsx: activacion por codigo de acceso / QR (/activate/:accessCode).
    3. Reset de contraseña del docente: Login detecta resetPassword y enruta a /activate.
  multi_materia:
    Un alumno con cuenta existente que recibe codigo de otra asignatura termina en el paso
    'link_existing' de Activation (solo confirma su contraseña actual) para sumar la inscripcion.


ARCHIVO: src/pages/student/Login.jsx
LINEAS: ~213
OBJETIVO: Pantalla de acceso del alumno. Login normal para cuentas ya activadas y activacion
  inline (sin paso aparte) en el primer ingreso; tambien ofrece una seccion plegable para
  activar con codigo de acceso / QR.
EXPORTA: componente por defecto StudentLogin

  FN StudentLogin(): componente de pagina de login del alumno.
    estado:
      username (string, se fuerza a mayusculas)
      password (string)
      error (string, mensaje de error visible)
      loading (boolean, deshabilita boton e indica "Entrando…")
      showCodeSection (boolean, expande/colapsa la seccion de activacion por codigo)
      codeInput (string, codigo de acceso tecleado, solo A-Z0-9, mayusculas)
    efectos: (ninguno; sin useEffect)
    datos:
      lee students via getDocs(query(where('username','==',uname))) para localizar la inscripcion
      por username (mayusculas).
    logica:
      Render con tema accent (no azul fijo). Form principal (handleLogin), seccion plegable de
      activacion por codigo (handleActivateWithCode) y enlace a /docente.

  FN finishAccess(docId, student, authUser): marca la inscripcion como activada y entra al panel.
    datos:
      escribe users/{authUser.uid} con setDoc merge:true (role:'alumno', username, escuelaId,
      studentId:docId, nombre, apellidoPaterno, apellidoMaterno).
      escribe students/{docId} con updateDoc { activado:true, uid:authUser.uid, resetPassword:null }.
      ambas escrituras en Promise.all.
    logica:
      navega a /alumno/dashboard al terminar.

  FN handleLogin(e): maneja el submit del form de acceso; resuelve login normal o activacion inline.
    estado: setError(''), setLoading(true) al inicio; setLoading(false) en finally.
    datos:
      getDocs sobre students filtrando por username (mayusculas) para obtener docId + data.
      signInWithEmailAndPassword (Firebase Auth) si ya esta activado.
      createUserWithEmailAndPassword (Firebase Auth) si es primer acceso.
      en catch auth/email-already-in-use: signInWithEmailAndPassword.
    logica:
      1. uname = username.trim().toUpperCase(); busca students por username.
      2. Si snapshot vacio -> error "Usuario no encontrado…" y return.
      3. Construye email = studentEmail(uname, student.escuelaId).
      4. Si student.activado -> signIn normal y navega a /alumno/dashboard.
      5. Si NO activado (activacion inline): valida password.length >= 6 (si no, error y return);
         intenta createUserWithEmailAndPassword; al lograrlo llama finishAccess.
      6. Si createUser lanza auth/email-already-in-use (la cuenta ya existe, p.ej. inscrito en
         otra asignatura) -> signIn con esa misma contraseña y finishAccess.
      7. Cualquier otro error de createUser se re-lanza al catch externo.
      8. Catch externo: auth/invalid-credential o auth/wrong-password -> "Contraseña incorrecta.";
         resto -> "Error al iniciar sesion. Intenta de nuevo.".
      Nota: la contraseña tecleada en el primer acceso SE CONVIERTE en la contraseña definitiva.

  FN handleActivateWithCode(e): navega a la pantalla de activacion por codigo.
    logica:
      code = codeInput.trim().toUpperCase(); si vacio return.
      navega a `/activate/${code}`.

  DATOS:
    students: lectura por username (getDocs) para resolver inscripcion; escritura en finishAccess
      (updateDoc activado/uid/resetPassword).
    users: escritura del doc del alumno en finishAccess (setDoc merge).
    Firebase Auth: signIn / createUser (no Firestore pero parte del flujo).
  DEPENDENCIAS:
    ../../firebase (auth, db)
    ../../components/Spinner
    ../../utils/generate (studentEmail)
    ../../components/PasswordInput
    react-router-dom (Link, useNavigate), firebase/auth, firebase/firestore, lucide-react


ARCHIVO: src/pages/student/Activation.jsx
LINEAS: ~406
OBJETIVO: Activacion de cuenta por codigo de acceso / QR (/activate/:accessCode). Resuelve la
  asignatura por su accessCode, pide username, deja elegir contraseña y crea/vincula la cuenta
  de auth. Soporta reset de contraseña del docente y el caso multi-materia (cuenta ya existente).
EXPORTA: componente por defecto StudentActivation

  FN StudentActivation(): componente de pagina de activacion.
    params/router: accessCode (useParams), location (useLocation; location.state?.prefillUsername),
      navigate (useNavigate), toast (useToast).
    estado:
      subject (asignatura resuelta por accessCode | null)
      student (inscripcion students encontrada | null)
      step ('username' | 'password' | 'link_existing'; controla el formulario mostrado)
      username (prefill desde location.state?.prefillUsername o '')
      password, confirmPassword (eleccion de contraseña en paso 'password')
      passwordError (mensaje de error de contraseña)
      linkPassword (contraseña en paso 'link_existing')
      loading (boolean, accion en curso)
      initLoading (boolean, carga inicial de la asignatura)
      loadError (string, error al cargar la asignatura)
      submitting (useRef boolean; guarda contra doble submit por taps rapidos)
    efectos:
      useEffect [accessCode]: llama loadSubject() (carga la asignatura por codigo).
      useEffect [subject]: si hay prefillUsername y subject, autoFind() busca la inscripcion y
        salta directo al paso 'password' (flujo de reset del docente).
    datos:
      subjects: getDocs(query(where('accessCode','==',accessCode))) en loadSubject.
      students: getDocs filtrando por asignaturaId + username en autoFind y handleFindStudent.
    logica:
      Renderiza distintos formularios segun step; pantallas de carga y de "Codigo no valido".

  FN loadSubject(): resuelve la asignatura a partir del codigo de la URL.
    estado: setLoadError en fallos; setSubject con la asignatura; setInitLoading(false) en finally.
    datos: subjects getDocs por accessCode.
    logica:
      Si snapshot vacio -> loadError "No encontramos ninguna asignatura con ese codigo…".
      Si error de red -> loadError "No pudimos cargar la asignatura…".
      Si encuentra -> setSubject({id, ...data}).

  FN autoFind() (interna del useEffect de prefill): busca la inscripcion del alumno y salta a paso password.
    datos: students getDocs(query(where('asignaturaId','==',subject.id), where('username','==',pre))).
    logica:
      Si encuentra inscripcion -> setStudent y setStep('password'). Si falla, cae a entrada manual.
      Sirve al flujo de reset del docente (prefillUsername viene de StudentLogin).

  FN handleFindStudent(e): busca al alumno por username dentro de la asignatura (paso 'username').
    estado: setLoading(true)/false.
    datos: students getDocs por asignaturaId + username (mayusculas).
    logica:
      Si subject no cargado return. Si snapshot vacio -> toast "Username no encontrado en esta
      asignatura". Si data.activado -> toast "Esta asignatura ya esta en tu cuenta. Inicia sesion."
      y navega a /alumno. En otro caso setStudent(data) y setStep('password').

  FN finishActivation(authUser): vincula la inscripcion a la cuenta de auth y entra al panel.
    datos:
      users/{authUser.uid} setDoc merge:true (role:'alumno', username, escuelaId, studentId:student.id,
      nombre, apellidoPaterno, apellidoMaterno).
      students/{student.id} updateDoc { activado:true, uid:authUser.uid, resetPassword:null }.
      ambas en Promise.all.
    logica: navega a /alumno/dashboard.

  FN handleActivate(e): crea la cuenta de auth con la contraseña elegida (paso 'password').
    estado: guard submitting.current; setPasswordError; setLoading.
    datos:
      createUserWithEmailAndPassword (Firebase Auth) con email=studentEmail(username, escuelaId).
      en catch email-already-in-use: signInWithEmailAndPassword (varios intentos) y posible updatePassword.
      finishActivation (escrituras users + students).
    logica (validaciones y resolucion de cuenta existente):
      1. Si submitting.current ya activo, return (anti doble-tap).
      2. Valida password.length >= 6 -> "La contraseña debe tener al menos 6 caracteres".
      3. Valida password === confirmPassword -> "Las contraseñas no coinciden".
      4. Intenta createUser; si exito -> finishActivation + toast "¡Cuenta activada! Bienvenido/a".
      5. Si error distinto de auth/email-already-in-use -> passwordError "Error al activar…" y return.
      6. Si email-already-in-use (la cuenta de auth ya existe), intenta resolver si es de ESTE alumno:
         a) signIn con la contraseña recien tecleada (cubre doble-tap que ya creo la cuenta, o alumno
            que reuso su contraseña real).
         b) si no, y existe student.resetPassword, signIn con esa temporal y updatePassword a la nueva.
         c) si logra credencial -> finishActivation + toast "¡Listo! Bienvenido/a".
         d) si no logra credencial -> es alumno que regresa con otra contraseña: setStep('link_existing'),
            limpia password/confirmPassword/passwordError.
      7. finally: submitting.current=false, setLoading(false).

  FN handleLinkExisting(e): vincula una cuenta existente confirmando la contraseña actual (multi-materia).
    estado: guard submitting.current; setPasswordError; setLoading.
    datos:
      signInWithEmailAndPassword con linkPassword; finishActivation (escrituras users + students).
    logica:
      Si linkPassword vacio return. signIn con email del alumno + linkPassword; al lograrlo
      finishActivation + toast "¡Asignatura agregada a tu cuenta!".
      Errores wrong-password / invalid-credential -> "Contraseña incorrecta. Intenta de nuevo.";
      resto -> "Error al conectar. Intenta de nuevo.".

  RENDER (resumen): initLoading -> Spinner. Sin subject -> pantalla "Codigo no valido" con loadError
    y boton "Volver al inicio". Con subject: cabecera con subjectDisplayName(subject) y
    subjectPeriodLabel(subject); segun step muestra form 'link_existing' (confirmar contraseña),
    'username' (introducir username) o 'password' (elegir + confirmar contraseña). Botones usan
    onClick + onMouseDown preventDefault + touchAction:'manipulation' (robustez tactil).

  DATOS:
    subjects: lectura por accessCode (getDocs) para resolver la asignatura.
    students: lectura por asignaturaId+username (getDocs); escritura en finishActivation
      (updateDoc activado/uid/resetPassword).
    users: escritura del doc del alumno en finishActivation (setDoc merge).
    Firebase Auth: createUser / signIn / updatePassword.
  DEPENDENCIAS:
    ../../firebase (auth, db)
    ../../components/Toast (useToast)
    ../../components/Spinner
    ../../utils/generate (studentEmail)
    ../../components/PasswordInput
    ../../utils/subjectName (subjectDisplayName)
    ../../utils/dateRange (subjectPeriodLabel)
    react-router-dom, firebase/auth, firebase/firestore, lucide-react


ARCHIVO: src/pages/student/Dashboard.jsx
LINEAS: ~267
OBJETIVO: Panel principal del alumno. Lista todas sus asignaturas (multi-materia) con el docente
  y el promedio calculado, permite entrar a cada materia y unirse a otra por codigo/QR.
EXPORTA: componente por defecto StudentDashboard

  FN fetchActivitiesForSubjects(subjectIds) (helper de modulo): trae todas las actividades de un
    conjunto de asignaturas en pocas idas a Firestore.
    datos: activities getDocs(query(where('asignaturaId','in', ids))) por chunks de 30, en paralelo.
    logica:
      Si subjectIds vacio -> []. Particiona en chunks de 30 (limite de `in`), ejecuta en Promise.all
      y devuelve flatMap de los docs.

  FN fetchSubmissionsForStudents(studentDocIds) (helper de modulo): trae todas las entregas de un
    conjunto de docs de inscripcion del alumno.
    datos: submissions getDocs(query(where('alumnoId','in', ids))) por chunks de 30, en paralelo.
    logica: igual que el anterior (chunks de 30 + flatMap).

  FN StudentDashboard(): componente del panel.
    estado:
      student (inscripcion[0], usada como identidad nombre/username | null)
      subjects (array de asignaturas enriquecidas con teacherName y avg)
      loading (boolean)
      showJoin (boolean, modal "unirme a otra asignatura")
      joinCode (string, codigo a unir; solo A-Z0-9 mayusculas)
    contexto: useAuth -> { currentUser, userProfile }; useToast; useNavigate.
    efectos:
      useEffect [currentUser]: si hay currentUser llama loadData().
    datos: lee students (via getEnrollments), subjects, users, activities, submissions.
    logica: cabecera con identidad + logout; grid de asignaturas; boton/modal para unirse.

  FN handleJoinSubject(e): navega a activacion para unirse a otra asignatura.
    logica: code = joinCode.trim().toUpperCase(); si vacio return; navega a `/activate/${code}`.

  FN loadData(): carga todas las inscripciones del alumno, sus asignaturas, docentes y promedios.
    estado: setLoading(true)/false; setStudent; setSubjects.
    datos:
      getEnrollments(currentUser, userProfile) -> todas las inscripciones students del alumno.
      subjects: getDoc por cada asignaturaId (Promise.all).
      users: getDoc por cada docenteId (Promise.all) para nombres de docente.
      activities: fetchActivitiesForSubjects (chunked `in`).
      submissions: fetchSubmissionsForStudents (chunked `in` sobre los doc ids de inscripcion).
    logica:
      1. Carga inscripciones; si 0 -> toast "No se encontro tu perfil de alumno", subjects=[] y return.
      2. setStudent(enrollments[0]) (identidad compartida entre inscripciones).
      3. Construye docIdBySubject { asignaturaId -> doc id de inscripcion }; asignaturaIds = sus claves.
         Si 0 -> subjects=[] y return.
      4. getDoc de cada subject; filtra existentes. Si 0 -> subjects=[] y return.
      5. En un batch paralelo: nombres de docentes, todas las actividades, todas mis entregas.
      6. teachers[id] = nombreMostrar || username || nombre || '—'.
      7. Agrupa actividades por asignatura SOLO si isActivityPublished(a) (oculta no publicadas/agendadas).
      8. gradeByActivity[actividadId] = calificacion (solo si calificacion != null).
      9. Promedio por materia en memoria: por cada actividad calificada, normaliza
         (calificacion / (maxCalif || 10)) * 10; avg = media a 1 decimal; null si no hay calificadas.
      10. setSubjects(enriched) con teacherName y avg.
      Errores -> toast "Error: " + mensaje.

  FN handleLogout(): cierra sesion.
    datos: signOut(auth) (Firebase Auth).
    logica: navega a /alumno.

  RENDER (resumen): loading -> Spinner. Cabecera con nombre+username (color accent) y boton logout.
    Titulo "Mis asignaturas" + conteo. Si 0 asignaturas -> estado vacio con CTA. Si hay, tarjetas
    por asignatura (data-subject-palette, SubjectIcon, subjectDisplayName, teacherName, promedio)
    que navegan a /alumno/materia/:id. Boton "Unirme a otra asignatura" abre modal (showJoin) con
    input de codigo (handleJoinSubject).

  DATOS:
    students: lectura via getEnrollments (multi-inscripcion del alumno).
    subjects: getDoc por id.
    users: getDoc por docenteId (nombres de docente).
    activities: getDocs `in` chunked (solo se muestran las publicadas).
    submissions: getDocs `in` chunked (entregas del alumno) para promedios.
    Firebase Auth: signOut.
  DEPENDENCIAS:
    ../../firebase (auth, db)
    ../../context/AuthContext (useAuth)
    ../../components/Toast (useToast)
    ../../components/Spinner
    ../../components/SubjectIcon
    ../../utils/activityVisibility (isActivityPublished)
    ../../utils/subjectName (subjectDisplayName)
    ../../utils/studentLookup (getEnrollments)
    react-router-dom, firebase/firestore, firebase/auth, lucide-react


ARCHIVO: src/pages/student/SubjectPage.jsx
LINEAS: ~191
OBJETIVO: Vista de una asignatura para el alumno. Muestra las actividades publicadas agrupadas por
  parcial (acordeon), con el estado de cada entrega (pendiente/entregado/calificado) y el promedio
  por parcial.
EXPORTA: componente por defecto StudentSubjectPage

  FN StudentSubjectPage(): componente de la pagina de asignatura.
    params/contexto: subjectId (useParams); useAuth -> { currentUser, userProfile }; useToast; useNavigate.
    estado:
      subject (asignatura | null)
      activities (array de actividades publicadas)
      submissions (mapa { actividadId -> entrega })
      openParcial (numero de parcial abierto en el acordeon; 1 por defecto, 0 = todos cerrados)
      loading (boolean)
    efectos:
      useEffect [subjectId]: llama loadAll().
    datos: subjects, students (via getEnrollmentForSubject), activities, submissions.
    logica: cabecera + acordeon de parciales (1..subject.parciales || 3) con estados y promedios.

  FN loadAll(): carga la asignatura, la inscripcion del alumno, sus actividades y entregas.
    estado: setLoading(true)/false; setSubject; setActivities; setSubmissions.
    datos:
      En Promise.all: getDoc(subjects/{subjectId}); getEnrollmentForSubject(currentUser, userProfile,
      subjectId) (resuelve la inscripcion students del alumno para ESTA asignatura);
      getDocs(query(activities where('asignaturaId','==',subjectId))).
      Luego submissions: getDocs(query(where('alumnoId','==',studData.id))).
    logica:
      1. setSubject con el doc de la asignatura.
      2. acts = actividades filtradas por isActivityPublished (solo publicadas); setActivities(acts).
      3. Si no hay studData (sin inscripcion) -> return (sin entregas).
      4. Trae TODAS las entregas del alumno en una sola query y las mapea en memoria a las actividades
         de esta asignatura: subsMap[actividadId] = { id, ...data } solo si actividadId pertenece a acts.
      5. setSubmissions(subsMap). Errores -> toast "Error: " + mensaje.

  FN calcParcialAvg(parcial): promedio (a 1 decimal) del parcial dado.
    logica:
      Toma actividades del parcial, mapea a su entrega, filtra calificacion != null, normaliza
      (calificacion / (maxCalif || 10)) * 10, devuelve media a 1 decimal; null si no hay calificadas.

  CONST PARCIALES: Array.from({length: subject?.parciales || 3}) -> [1..N] parciales a renderizar.

  RENDER (resumen): loading -> Spinner. Contenedor con data-subject-palette. Cabecera con back a
    /alumno/dashboard, SubjectIcon, subjectDisplayName(subject) y "{N} parciales". Por cada parcial:
    boton de acordeon (toggle openParcial) con numero, conteo de actividades y promedio; al abrir,
    lista de actividades. Estado por actividad: graded (calificacion!=null) -> CheckCircle verde +
    Star + calificacion/maxCalif; delivered (entrega sin calificar) -> Clock + badge "Entregado";
    sin entrega -> Circle + badge "Pendiente". Muestra sub.comentario si existe. Cada actividad
    navega a /alumno/actividad/:id.

  DATOS:
    subjects: getDoc por id.
    students: lectura via getEnrollmentForSubject (inscripcion del alumno para esta asignatura).
    activities: getDocs por asignaturaId (solo se muestran publicadas).
    submissions: getDocs por alumnoId (id de la inscripcion) y mapeo en memoria.
  DEPENDENCIAS:
    ../../firebase (db)
    ../../context/AuthContext (useAuth)
    ../../components/Toast (useToast)
    ../../components/Spinner
    ../../utils/activityVisibility (isActivityPublished)
    ../../utils/subjectName (subjectDisplayName)
    ../../utils/studentLookup (getEnrollmentForSubject)
    ../../components/SubjectIcon
    react-router-dom, firebase/firestore, lucide-react


ARCHIVO: src/pages/student/ActivityPage.jsx
LINEAS: ~390
OBJETIVO: Detalle de una actividad para el alumno. Muestra estado/calificacion/comentario/
  instrucciones/fecha limite (con extension por alumno) y permite subir la entrega (validando tipos
  de archivo y tamaño), reentregar correcciones o marcar como completada sin archivo.
EXPORTA: componente por defecto StudentActivityPage

  FN uploadToCloudinary(file) (helper de modulo): sube un archivo a Cloudinary y devuelve la URL.
    datos:
      fetch POST a https://api.cloudinary.com/v1_1/{cloudName}/auto/upload con FormData (file,
      upload_preset, folder='evalua-facil/submissions').
      cloudName = VITE_CLOUDINARY_CLOUD_NAME; uploadPreset = VITE_CLOUDINARY_UPLOAD_PRESET.
    logica: si !res.ok lanza Error "Error al subir archivo a Cloudinary"; devuelve secure_url.

  FN fmtDate(dateStr) (helper de modulo): formatea una fecha YYYY-MM-DD a texto en es-MX.
    logica: si vacio -> ''. Appende 'T00:00:00' para forzar hora local (evita el corrimiento por
    UTC midnight) y formatea con toLocaleDateString es-MX (dia, mes largo, año).

  FN StudentActivityPage(): componente de detalle de actividad.
    params/contexto: activityId (useParams); useAuth -> { currentUser, userProfile }; useToast; useNavigate.
    estado:
      activity (actividad | null)
      subject (asignatura | null)
      student (inscripcion del alumno para la asignatura | null)
      submission (entrega del alumno para esta actividad | null)
      file (File seleccionado para subir | null)
      uploading (boolean, accion de subida/marcado en curso)
      loading (boolean, carga inicial)
    efectos:
      useEffect [activityId]: onSnapshot en tiempo real de activities/{activityId}; mantiene la
        actividad fresca cuando el docente guarda cambios (extensiones, ediciones). Cleanup unsub.
      useEffect [activityId, userProfile?.studentId]: llama loadOther() (carga inicial del resto).
    datos: activities, subjects, students (via getEnrollmentForSubject), submissions; fetch a Cloudinary.
    logica: gating de actividad publicada; render de estado/calificacion/instrucciones/info/subida.

  FN loadOther(): carga actividad (validando visibilidad), inscripcion, asignatura y entrega existente.
    estado: setLoading(true)/false; setActivity; setStudent; setSubject; setSubmission.
    datos:
      getDoc(activities/{activityId}); getEnrollmentForSubject(currentUser, userProfile,
      actData.asignaturaId); getDoc(subjects/{asignaturaId}); getDocs(submissions where
      actividadId==activityId AND alumnoId==studData.id) (solo si hay studData).
    logica:
      1. Si la actividad no existe -> toast "Actividad no encontrada" y navega a /alumno/dashboard.
      2. Si !isActivityPublished(actData) -> toast "Esta actividad no esta disponible" y navega a
         dashboard (impide acceso por URL directa a actividades ocultas/agendadas).
      3. setActivity; resuelve studData (inscripcion del alumno para la asignatura de la actividad).
      4. En Promise.all carga subject y la entrega existente (si hay studData); setSubject y, si la
         consulta no esta vacia, setSubmission con el primer doc.
      Errores -> toast "Error: " + mensaje.

  FN buildHistoryEntry(): construye una entrada de historial con la version actual de la entrega.
    logica:
      Devuelve { archivoURL, nombreArchivo, completadoSinArchivo, fechaEntrega } tomados de la
      submission actual (con defaults null/false). Se usa con arrayUnion al reentregar para conservar
      la version previa.

  FN handleUpload(): sube el archivo seleccionado como entrega (nueva o correccion).
    estado: setUploading(true)/false; setFile(null) al exito.
    datos:
      uploadToCloudinary(file) (fetch).
      Si ya hay submission: updateDoc(submissions/{id}) con archivoURL, nombreArchivo,
        completadoSinArchivo:false, fechaEntrega:serverTimestamp(), calificacion:null, comentario:'',
        estado:'entregado', historial:arrayUnion(buildHistoryEntry()).
      Si no: addDoc(submissions) con alumnoId:student.id, actividadId, archivoURL, nombreArchivo,
        completadoSinArchivo:false, fechaEntrega:serverTimestamp(), calificacion:null, comentario:'',
        estado:'entregado', historial:[].
    logica (validaciones, en orden):
      1. Si !file return.
      2. Si !student -> toast "No se encontro tu perfil. Cierra sesion y vuelve a entrar." y return.
      3. Validacion de tipo: isFileAllowed(file, activity.tiposArchivo || 'todos',
         activity.extensionesCustom). Si no -> toast con los tipos permitidos via
         getFileType(...).accept (incluye extensiones personalizadas) y return.
      4. Validacion de tamaño: si file.size > 5 MB -> toast "El archivo no puede superar 5 MB" y return.
      5. Sube a Cloudinary; reentrega (archiva version previa en historial) o crea entrega nueva.
      6. toast "Version corregida entregada" o "Tarea entregada"; setFile(null); recarga loadOther().
      Errores -> toast "Error al subir: " + mensaje.

  FN handleMarkComplete(): marca la actividad como completada SIN archivo.
    estado: setUploading(true)/false.
    datos:
      Si hay submission: updateDoc(submissions/{id}) con archivoURL:null, nombreArchivo:null,
        completadoSinArchivo:true, fechaEntrega:serverTimestamp(), calificacion:null, comentario:'',
        estado:'entregado', historial:arrayUnion(buildHistoryEntry()).
      Si no: addDoc(submissions) con alumnoId:student.id, actividadId, los mismos campos y historial:[].
    logica:
      Si !student -> toast de perfil y return. Crea/actualiza la entrega sin archivo; toast
      "Version corregida marcada como completada" o "Tarea marcada como completada"; recarga loadOther().
      Errores -> toast "Error: " + mensaje.

  DERIVADOS DE RENDER (calculo en cuerpo del componente):
    isGraded = submission?.calificacion != null
    isDelivered = !!submission && !isGraded
    noFile = submission?.completadoSinArchivo
    extendedDate = activity?.extensiones?.[student?.id] (fecha limite extendida para ESTE alumno)
    displayDate = extendedDate || activity?.fechaLimite
    canResubmit = !!extendedDate && !isGraded && !!submission (reentrega solo con extension y sin calificar)

  RENDER (resumen): loading -> Spinner. data-subject-palette. Cabecera con back a /alumno/materia/:asignaturaId,
    nombre de actividad y subjectDisplayName + "Parcial N". Tarjeta de estado (Calificado /
    Entregado-pendiente / Pendiente de entrega; muestra nombreArchivo o "Completada sin archivo").
    Enlace de descarga de la entrega si hay archivoURL. Bloque de calificacion (calificacion/maxCalif
    + comentario) si isGraded. Instrucciones (whitespace-pre-wrap) si existen. Bloque info con
    calificacion maxima y fecha limite (normal o extendida en naranja). Bloque de subida visible si
    (!submission || canResubmit): input file con accept = getFileType(...).accept, boton "Entregar"
    (handleUpload) y boton "Marcar como completada sin archivo" (handleMarkComplete). Botones usan
    onMouseDown preventDefault + touchAction:'manipulation'.

  VALIDACION DE TIPOS DE ARCHIVO (detalle):
    Se apoya en config/fileTypes: getFileType(tiposArchivo, extensionesCustom) devuelve el descriptor
    con .accept (lista de extensiones/MIME para el input y los mensajes) e isFileAllowed(file,
    tiposArchivo, extensionesCustom) valida el archivo elegido. tiposArchivo proviene de la actividad
    (default 'todos'); cuando es el tipo "Personalizado", extensionesCustom define las extensiones
    propias permitidas. El input <input type=file accept=...> y el texto de ayuda se derivan del mismo
    descriptor, y el limite duro de tamaño es 5 MB.

  DATOS:
    activities: onSnapshot en tiempo real (refresca extensiones/ediciones del docente) + getDoc inicial.
    subjects: getDoc por id.
    students: lectura via getEnrollmentForSubject (inscripcion del alumno para la asignatura).
    submissions: getDocs (entrega existente del alumno para la actividad); addDoc (nueva entrega) /
      updateDoc (reentrega o completada sin archivo) con serverTimestamp y arrayUnion para historial.
    Cloudinary: fetch POST de subida de archivo (no Firestore).
  DEPENDENCIAS:
    ../../firebase (db)
    ../../context/AuthContext (useAuth)
    ../../components/Toast (useToast)
    ../../components/Spinner
    ../../config/fileTypes (getFileType, isFileAllowed)
    ../../utils/subjectName (subjectDisplayName)
    ../../utils/activityVisibility (isActivityPublished)
    ../../utils/studentLookup (getEnrollmentForSubject)
    react-router-dom, firebase/firestore, lucide-react


NOTAS TRANSVERSALES
  rutas_alumno:
    /alumno (StudentLogin), /activate/:accessCode (StudentActivation),
    /alumno/dashboard (StudentDashboard), /alumno/materia/:subjectId (StudentSubjectPage),
    /alumno/actividad/:activityId (StudentActivityPage).
  visibilidad_actividades:
    isActivityPublished (utils/activityVisibility) filtra actividades no publicadas/agendadas en
    Dashboard y SubjectPage, y bloquea el acceso por URL directa en ActivityPage.
  resolucion_inscripcion:
    utils/studentLookup centraliza el caso multi-materia: getEnrollments (todas las inscripciones del
    alumno, usado en Dashboard) y getEnrollmentForSubject (la inscripcion concreta para una asignatura,
    usado en SubjectPage y ActivityPage); reciben currentUser y userProfile.
  promedios:
    Siempre normalizados a base 10 con (calificacion / (maxCalif || 10)) * 10 y promediados solo sobre
    actividades con calificacion != null; resultado a 1 decimal o null.
  robustez_tactil:
    Botones de accion usan onClick + onMouseDown preventDefault + style touchAction:'manipulation';
    Activation ademas usa un ref submitting para evitar doble submit por taps rapidos.


===== PAGINAS DE ADMIN =====

Resumen de la seccion:
  Panel de administracion de "Evalua Facil". Vive bajo src/pages/admin/.
  Dashboard.jsx es el contenedor con pestanas (tabs): Resumen, Suscripciones, Pagos,
  Configuracion de cobros, Usuarios, Planes. Cada pestana renderiza un componente de
  src/pages/admin/components/.
  Los datos globales (KPIs, listas de docentes/suscripciones/pagos/planes/escuelas) se
  cargan UNA sola vez con el hook useAdminStats() (lee todas las colecciones via getDocs)
  y se pasan por props "stats" hacia abajo. Las escrituras (aprobar/rechazar pago, CRUD de
  planes y suscripciones, guardar config de cobros) se hacen directamente con Firestore
  updateDoc/addDoc/deleteDoc/setDoc y luego llaman onRefresh()/refresh() para recargar.
  No usa onSnapshot ni fetch a /api en esta seccion (el panel admin trabaja contra
  Firestore directo; los /api de pagos los consume el lado docente).


ARCHIVO: src/pages/admin/Dashboard.jsx
LINEAS: ~76
OBJETIVO: Contenedor del panel admin con sistema de pestanas; carga estadisticas globales
  y enruta cada pestana al componente correspondiente.
EXPORTA: default function AdminDashboard (componente React, ruta /admin/dashboard segun App)

  CONST TAB_TITLES: mapa tabKey -> titulo legible del header.
    resumen->Resumen, suscripciones->Suscripciones, pagos->Pagos,
    cobros->"Configuracion de cobros", usuarios->Usuarios, planes->Planes.

  FN AdminDashboard(): pinta layout admin, header con titulo dinamico y boton Actualizar,
    y el cuerpo segun la pestana activa.
    estado:
      activeTab (useState 'resumen'): pestana seleccionada; la cambia AdminLayout via onTabChange.
      refreshing (useState false): true mientras corre handleRefresh (anima el icono).
      stats, loading, refresh: vienen del hook useAdminStats() (no son useState locales aqui).
    efectos: (ninguno propio; los efectos de carga viven en useAdminStats).
    datos: indirecto via useAdminStats (lee users, students, subscriptions, payments, plans,
      schools, subjects con getDocs). Dashboard en si no toca Firestore directo.
    logica:
      - Render con <AdminLayout activeTab onTabChange={setActiveTab}>.
      - Header muestra TAB_TITLES[activeTab] + subtitulo "Panel de administracion".
      - Boton "Actualizar": deshabilitado si refreshing || loading; icono RefreshCw gira si refreshing.
      - Si loading && !stats -> muestra <Spinner/> centrado (primera carga).
      - Sino, render condicional por activeTab:
          resumen -> <StatsCards kpis={stats?.kpis}/> y <ResumenCharts stats={stats}/>.
          suscripciones -> <SubscriptionsTable stats onRefresh={refresh}/>.
          pagos -> <PaymentsTable stats onRefresh={refresh}/>.
          cobros -> <PaymentConfig/> (no recibe stats; usa su propio hook).
          usuarios -> <UsersTable stats/> (solo lectura, sin onRefresh).
          planes -> <PlansManager stats onRefresh={refresh}/>.

    FN handleRefresh() (interna async): vuelve a cargar las estadisticas.
      logica: setRefreshing(true) -> await refresh() (= load del hook) -> setRefreshing(false).

  DATOS: ninguna escritura directa. Lectura indirecta via useAdminStats.
  DEPENDENCIAS:
    components/AdminLayout (layout con barra de pestanas del admin)
    components/Spinner
    hooks/useAdminStats
    ./components/StatsCards (default StatsCards + named ResumenCharts)
    ./components/SubscriptionsTable
    ./components/PaymentsTable
    ./components/PaymentConfig
    ./components/UsersTable
    ./components/PlansManager
    lucide-react (RefreshCw)


ARCHIVO: src/pages/admin/components/StatsCards.jsx
LINEAS: ~102
OBJETIVO: Tarjetas de KPI (8 metricas) y, aparte, dos graficas de barras del Resumen
  (docentes por escuela y estado de suscripciones).
EXPORTA:
  default function StatsCards (tarjetas KPI)
  named function ResumenCharts (graficas de barras)
  (BarChart es interno, no exportado)

  CONST KPI_CONFIG: arreglo de 8 KPIs con {key, label, icon, format}:
    teacherCount->Docentes, activeStudentCount->Alumnos activos,
    activeSubCount->Suscripciones activas, trialCount->En periodo trial,
    totalRevenue->Ingresos totales (formatCurrency), monthRevenue->Ingresos del mes (formatCurrency),
    pendingPaymentCount->Pagos pendientes, conversionRate->Tasa conversion (v.toFixed(1)+"%").

  FN StatsCards({ kpis }): grilla responsiva (2 col movil / 4 col lg) de tarjetas KPI.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno; recibe kpis ya calculados por useAdminStats)
    logica:
      - Si !kpis -> return null.
      - Mapea KPI_CONFIG; por cada uno muestra icono+label y format(kpis[key] ?? 0).

  FN BarChart({ items, labelKey, valueKey, maxBars=10 }) (interno): grafica de barras horizontal simple.
    estado: (ninguno)
    logica:
      - data = items.slice(0, maxBars); max = Math.max(...valores, 1) (evita /0).
      - Si data vacio -> "Sin datos".
      - Por item: label truncado + barra azul con width = (valor/max)*100% + valor numerico a la derecha.

  FN ResumenCharts({ stats }): dos paneles con BarChart (top escuelas y estado de subs).
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguno directo; usa stats.teachersBySchool y stats.subscriptions ya cargados)
    logica:
      - Si !stats -> return null.
      - statusItems: cuenta subscriptions por status para 5 estados
        (trial, activa, vencida, pendiente_pago, cancelada) -> [{name,count}].
      - Panel 1 "Docentes por escuela (top 10)": BarChart items=teachersBySchool labelKey=school valueKey=count.
      - Panel 2 "Estado de suscripciones": BarChart items=statusItems labelKey=name valueKey=count.

  DATOS: ninguno (componente de solo presentacion).
  DEPENDENCIAS:
    utils/subscriptionHelpers (formatCurrency)
    lucide-react (Users, GraduationCap, CreditCard, DollarSign, Clock, AlertTriangle, TrendingUp, Timer)


ARCHIVO: src/pages/admin/components/SubscriptionsTable.jsx
LINEAS: ~338
OBJETIVO: Tabla CRUD de suscripciones. Crear/editar via modal, cancelar (soft) y eliminar (hard).
EXPORTA: default function SubscriptionsTable

  CONST inputCls: clases tailwind reutilizadas para inputs/selects del modal.

  FN StatusBadge({ status }) (interno): pildora de color segun estado de suscripcion.
    logica: usa getSubscriptionStatusColor(status); muestra status con '_' reemplazado por espacio.

  FN SubscriptionsTable({ stats, onRefresh }): renderiza tabla + modal de alta/edicion.
    estado:
      modal (useState null): null = cerrado; objeto { mode:'create'|'edit', id?, form } cuando abierto.
      saving (useState false): true mientras guarda en Firestore.
    efectos: (ninguno)
    datos:
      lee de stats: subscriptions, teachers, plans, schoolsMap.
      escribe Firestore:
        addDoc(collection 'subscriptions') al crear
        updateDoc(doc 'subscriptions/{id}') al editar, cancelar
        deleteDoc(doc 'subscriptions/{id}') al eliminar
    logica:
      - Si !stats -> return null.
      - teachersMap y plansMap = indices por id (Object.fromEntries) para join en memoria.
      - rows = copia de subscriptions ordenada por updatedAt descendente (orden en memoria; Firestore no ordena).
      - Tabla: Docente (username||email||docenteId.slice(0,8)), Escuela (schoolName), Plan
        (plansMap[planId].nombre o "Trial" si status trial, sino "—"), Estado (StatusBadge),
        Vencimiento (formatDate), Dias (calcDaysRemaining), Acciones.
      - Acciones por fila: editar (lapiz), cancelar (Ban, solo si status != cancelada), eliminar (Trash2).
      - Modal: selects de Docente (lista teachers), Plan (incluye opcion "— Sin plan (trial) —"),
        Estado (SUBSCRIPTION_STATUSES) e inputs date Inicio/Vencimiento.

    FN openCreate() (interna): abre modal en modo create con valores por defecto
      (primer docente, primer plan, status 'activa', fechaInicio = hoy ISO yyyy-mm-dd, vencimiento '').

    FN openEdit(sub) (interna): abre modal en modo edit precargando docenteId, planId, status y
      fechas convertidas de Timestamp a 'yyyy-mm-dd' (sub.fechaInicio.toDate()/.fechaVencimiento.toDate()).

    FN handleSave(e) (interna async): crea o actualiza la suscripcion.
      logica:
        - e.preventDefault(); setSaving(true).
        - Resuelve teacher = teachersMap[form.docenteId] y school = schoolsMap[teacher.escuelaId]
          para denormalizar escuelaId y schoolName (nombre de escuela) en el doc.
        - Convierte fechaInicio/fechaVencimiento (string) a Timestamp.fromDate solo si tienen valor.
        - create -> addDoc 'subscriptions' con createdAt+updatedAt serverTimestamp, toast "Suscripcion creada".
        - edit -> updateDoc 'subscriptions/{id}' con updatedAt serverTimestamp, toast "Suscripcion actualizada".
        - cierra modal, onRefresh(); en catch toast error; finally setSaving(false).

    FN handleCancel(sub) (interna async): cancela (soft) una suscripcion.
      logica: confirm() -> updateDoc status:'cancelada' + updatedAt -> toast -> onRefresh().

    FN handleDelete(sub) (interna async): elimina (hard, irreversible) una suscripcion.
      logica: confirm("No se puede deshacer") -> deleteDoc 'subscriptions/{id}' -> toast -> onRefresh().

  DATOS: subscriptions (addDoc/updateDoc/deleteDoc). Lee teachers/plans/schoolsMap de stats; denormaliza
    escuelaId y schoolName en el doc de suscripcion.
  DEPENDENCIAS:
    firebase (db)
    components/Toast (useToast)
    components/Spinner
    utils/subscriptionHelpers (calcDaysRemaining, formatDate, getSubscriptionStatusColor, SUBSCRIPTION_STATUSES)
    lucide-react (Plus, Pencil, Ban, Trash2, X)


ARCHIVO: src/pages/admin/components/PaymentsTable.jsx
LINEAS: ~205
OBJETIVO: Tabla de pagos con aprobacion/rechazo manual. Aprobar activa la suscripcion asociada;
  rechazar guarda nota para el docente.
EXPORTA: default function PaymentsTable

  FN StatusBadge({ status }) (interno): pildora de color del estado del pago via getPaymentStatusColor.

  FN PaymentsTable({ stats, onRefresh }): tabla de pagos + modal de rechazo.
    estado:
      processing (useState null): id del pago en proceso (deshabilita botones de esa fila).
      rejectModal (useState null): el pago a rechazar (objeto) o null.
      notasAdmin (useState ''): texto de la nota de rechazo.
    efectos: (ninguno)
    datos:
      lee de stats: payments, teachers, plans.
      escribe Firestore:
        updateDoc(doc 'payments/{id}') al aprobar (status 'completado') y al rechazar (status 'rechazado' + notasAdmin)
        updateDoc(doc 'subscriptions/{subscriptionId}') al aprobar (activa la suscripcion)
    logica:
      - Si !stats -> return null.
      - teachersMap, plansMap = indices por id.
      - rows = copia de payments ordenada por createdAt descendente (en memoria).
      - Columnas: Docente, Monto (formatCurrency), Referencia (mono, payment.referencia), Estado (StatusBadge),
        Fecha (formatDate(createdAt)), Acciones.
      - Acciones solo si status == 'pendiente': botones Aprobar (verde) y Rechazar (rojo); si hay notasAdmin se muestra debajo.

    FN handleApprove(payment) (interna async): aprueba el pago y activa la suscripcion.
      logica:
        - setProcessing(payment.id).
        - plan = plansMap[payment.planId]; fechaInicio = hoy.
        - fechaVencimiento = calcVencimientoTimestamp(fechaInicio, plan?.periodicidad || 'mensual').
        - updateDoc 'payments/{id}' status:'completado' + updatedAt.
        - Si payment.subscriptionId: updateDoc 'subscriptions/{subscriptionId}' status:'activa',
          planId=payment.planId, fechaInicio (Timestamp.fromDate), fechaVencimiento, updatedAt.
        - toast "Pago aprobado y suscripcion activada"; onRefresh(); catch toast error; finally setProcessing(null).

    FN handleReject() (interna async): rechaza el pago abierto en rejectModal.
      logica:
        - Si !rejectModal -> return. setProcessing(rejectModal.id).
        - updateDoc 'payments/{rejectModal.id}' status:'rechazado', notasAdmin (trim), updatedAt.
        - toast "Pago rechazado"; cierra modal y limpia notasAdmin; onRefresh(); catch toast error; finally setProcessing(null).

  DATOS: payments (updateDoc para aprobar/rechazar) y subscriptions (updateDoc al aprobar). Lee teachers/plans de stats.
  DEPENDENCIAS:
    firebase (db)
    components/Toast (useToast)
    components/Spinner
    utils/subscriptionHelpers (calcVencimientoTimestamp, formatCurrency, formatDate, getPaymentStatusColor)
    lucide-react (Check, X)
    firebase/firestore (Timestamp usado en handleApprove)


ARCHIVO: src/pages/admin/components/PlansManager.jsx
LINEAS: ~327
OBJETIVO: CRUD del catalogo de planes (precio, periodicidad, limites de asignaturas/alumnos,
  visibilidad y orden). Crear/editar via modal, eliminar con confirm.
EXPORTA: default function PlansManager

  CONST inputCls: clases tailwind de inputs del modal.
  CONST EMPTY_PLAN: plantilla de plan nuevo
    { nombre:'', descripcion:'', precio:199, periodicidad:'mensual', maxAsignaturas:-1, maxAlumnos:-1, activo:true, orden:1 }.
    Convencion: -1 en limites = ilimitado (se muestra como simbolo infinito).

  FN PlansManager({ stats, onRefresh }): tabla de planes + modal de alta/edicion.
    estado:
      modal (useState null): null o { mode:'create'|'edit', id?, form }.
      saving (useState false): true mientras guarda.
    efectos: (ninguno)
    datos:
      lee de stats: plans.
      escribe Firestore:
        addDoc(collection 'plans') al crear
        updateDoc(doc 'plans/{id}') al editar
        deleteDoc(doc 'plans/{id}') al eliminar
    logica:
      - Si !stats -> return null.
      - plans = copia de stats.plans ordenada por campo orden ascendente (en memoria).
      - Tabla: Nombre (+descripcion truncada), Precio (formatCurrency + "/mes" o "/año"),
        Limites (maxAsignaturas/maxAlumnos, -1 -> infinito), Activo (pildora Si/No), Orden, Acciones (editar/eliminar).
      - Estado vacio sugiere ejecutar seed-plans.js o crear uno.
      - Modal con campos: Nombre (required), Descripcion, Precio (number, required), Periodicidad (mensual/anual),
        Max asignaturas (-1=∞), Max alumnos (-1=∞), Orden, checkbox "Visible para compra" (= activo).

    FN openCreate() (interna): abre modal modo create con {...EMPTY_PLAN, orden: plans.length+1}.

    FN openEdit(plan) (interna): abre modal modo edit precargando el form desde el plan
      (con valores por defecto si faltan campos; activo = plan.activo !== false).

    FN handleSave(e) (interna async): crea o actualiza un plan.
      logica:
        - e.preventDefault(); setSaving(true).
        - Normaliza tipos: precio, maxAsignaturas, maxAlumnos, orden con Number(); agrega updatedAt serverTimestamp.
        - create -> addDoc 'plans' con createdAt serverTimestamp, toast "Plan creado".
        - edit -> updateDoc 'plans/{id}', toast "Plan actualizado".
        - cierra modal, onRefresh(); catch toast error; finally setSaving(false).

    FN handleDelete(plan) (interna async): elimina un plan.
      logica: confirm(`¿Eliminar el plan "..."?`) -> deleteDoc 'plans/{id}' -> toast "Plan eliminado" -> onRefresh().

  DATOS: plans (addDoc/updateDoc/deleteDoc). Solo lee stats.plans.
  DEPENDENCIAS:
    firebase (db)
    components/Toast (useToast)
    components/Spinner
    utils/subscriptionHelpers (formatCurrency)
    lucide-react (Plus, Pencil, Trash2, X)


ARCHIVO: src/pages/admin/components/UsersTable.jsx
LINEAS: ~120
OBJETIVO: Tabla de SOLO LECTURA de docentes con su escuela, plan actual, estado de suscripcion
  y ultimo pago. No edita nada.
EXPORTA: default function UsersTable

  FN UsersTable({ stats }): construye joins en memoria y pinta la tabla de docentes.
    estado: (ninguno)
    efectos: (ninguno)
    datos: (ninguna escritura ni lectura directa de Firestore; todo viene de stats)
      lee de stats: teachers, subscriptions, payments, schoolsMap, plans.
    logica:
      - Si !stats -> return null.
      - plansMap = indice por id.
      - subsByTeacher: por cada docenteId guarda la suscripcion mas reciente (mayor updatedAt).
      - lastPaymentByTeacher: por cada docenteId guarda el pago mas reciente (mayor createdAt).
      - rows = copia de teachers ordenada alfabeticamente por username||email (localeCompare).
      - Columnas: Usuario (mono, username), Correo, Escuela (schoolsMap[escuelaId].nombre o schoolName),
        Plan actual (si sub.status trial -> "Trial"; sino plan.nombre; sino "—"),
        Estado (pildora getSubscriptionStatusColor o "Sin plan"),
        Ultimo pago (formatCurrency(monto) — formatDate(createdAt) o "—").

  DATOS: ninguno (solo lectura desde stats; no toca Firestore).
  DEPENDENCIAS:
    utils/subscriptionHelpers (formatCurrency, formatDate, getSubscriptionStatusColor)
    (no usa lucide-react)


ARCHIVO: src/pages/admin/components/PaymentConfig.jsx
LINEAS: ~249
OBJETIVO: Formulario de configuracion de cobros (datos PUBLICOS): habilitar/configurar
  Mercado Pago (Public Key), PayPal (Client ID) y Transferencia bancaria. Las llaves secretas
  NO van aqui (van en variables de entorno de Vercel).
EXPORTA: default function PaymentConfig

  CONST inputCls: clases tailwind de los inputs.

  FN Toggle({ checked, onChange }) (interno): interruptor on/off estilizado; llama onChange(!checked).

  FN Field({ label, value, onChange, placeholder, hint }) (interno): input de texto con label
    y hint opcional; onChange recibe e.target.value.

  FN PaymentConfig(): formulario con 3 tarjetas (Mercado Pago / PayPal / Transferencia) + boton guardar.
    estado:
      form (useState DEFAULT_PAYMENT_CONFIG): copia editable de la config.
      saving (useState false): true mientras guarda.
      config, loading: vienen de usePaymentConfig() (no useState locales).
    efectos:
      useEffect([config]): cuando llega config del hook, setForm(config) para precargar el formulario.
    datos:
      lee Firestore: doc 'config/payments' via hook usePaymentConfig (getDoc).
      escribe Firestore: setDoc(doc 'config/payments', {...}, { merge:true }) en handleSave.
    logica:
      - Si loading -> Spinner.
      - Aviso ambar: "Las llaves secretas NO van aqui"; Access Token de MP y Secret de PayPal van en Vercel.
      - Tarjeta Mercado Pago: Toggle enabled; si enabled muestra Field Public Key + nota (MP_ACCESS_TOKEN en Vercel).
      - Tarjeta PayPal: Toggle enabled; si enabled muestra Field Client ID + nota (PAYPAL_SECRET en Vercel).
      - Tarjeta Transferencia: Toggle enabled; si enabled muestra Banco, Titular, Numero de cuenta, CLABE, Nota.
      - Boton "Guardar configuracion" llama handleSave.

    FN patch(section, key, val) (interna): actualiza form[section][key] inmutablemente
      (setForm con spread de seccion).

    FN handleSave() (interna async): persiste la config en Firestore.
      logica:
        - setSaving(true).
        - setDoc 'config/payments' con merge:true, escribiendo solo datos publicos:
          moneda (default 'MXN'); mercadoPago {enabled, publicKey trim}; paypal {enabled, clientId trim};
          transferencia {enabled, banco, titular, cuenta, clabe, nota (todos trim)}; updatedAt serverTimestamp.
        - toast "Configuracion de cobros guardada"; catch toast error; finally setSaving(false).

  DATOS: config/payments (getDoc via hook para leer, setDoc merge para guardar). Solo guarda datos publicos;
    secretos viven en env vars de Vercel (MP_ACCESS_TOKEN, PAYPAL_SECRET).
  DEPENDENCIAS:
    firebase (db)
    components/Toast (useToast)
    components/Spinner
    hooks/usePaymentConfig (usePaymentConfig, DEFAULT_PAYMENT_CONFIG)
    lucide-react (Wallet, Landmark, Save, ExternalLink, AlertTriangle)


APENDICE: HOOKS Y HELPERS DE SOPORTE (consumidos por esta seccion)

  hooks/useAdminStats.js (~179 lineas)
    OBJETIVO: cargar TODAS las colecciones en paralelo y derivar KPIs y agregados para el panel.
    EXPORTA: useAdminStats() -> { stats, loading, refresh }.
    FN useAdminStats():
      estado: stats (useState null), loading (useState true).
      efectos: useEffect([load]) llama load() al montar; refresh = load (mismo useCallback).
      datos: getDocs en paralelo (Promise.all) de users, students, subscriptions, payments, plans, schools, subjects.
      logica clave (todo calculado en memoria, sin orderBy/where compuestos):
        - teachers = users con role 'docente'; activeStudents = students activado===true; activeSubs = status 'activa'.
        - completedPayments = status 'completado'; pendingPayments = status 'pendiente'.
        - totalRevenue = suma monto de completados; monthRevenue = idem filtrando isThisMonth(createdAt).
        - expiringSoon = activas que vencen dentro de 7 dias y dias restantes >= 0.
        - conversionRate = activeSubs/teachers*100.
        - subsByPlan, revenueByPlan: agregados por plan. teachersBySchool: top 10 escuelas por # docentes
          (etiqueta = shortName||claveSEP||id). schoolsMap = indice de schools por id.
        - trialCount, expiredCount, cancelledCount, churnCount (canceladas en ultimos 30 dias),
          newTeachersThisMonth, avgSubjects, avgStudents, subsistemaDist.
        - setStats({ teachers, students, subscriptions, payments, plans, schools, schoolsMap, kpis{...},
          subsByPlan, teachersBySchool, revenueByPlan, subsistemaDist, pendingPayments }).
      helpers internos: isThisMonth(date), isWithinDays(date,days), isWithinLastDays(date,days).

  hooks/usePaymentConfig.js (~56 lineas)
    OBJETIVO: leer el doc config/payments con valores por defecto (deep-merge).
    EXPORTA: usePaymentConfig() -> { config, loading, refresh }; const DEFAULT_PAYMENT_CONFIG.
    FN usePaymentConfig():
      estado: config (useState null), loading (useState true).
      efectos: useEffect([load]) carga al montar.
      datos: getDoc(doc 'config','payments'). Si existe, hace merge profundo con DEFAULT_PAYMENT_CONFIG
        (mercadoPago, paypal, transferencia); si no, usa DEFAULT_PAYMENT_CONFIG. En catch, default.

  utils/subscriptionHelpers.js (~83 lineas)
    OBJETIVO: utilidades de fechas/moneda/colores y constante de estados, compartidas por todos
      los componentes admin (y el lado docente de suscripciones).
    EXPORTA (funciones):
      toDate(value): normaliza Date | Timestamp(.toDate) | string a Date (o null).
      calcDaysRemaining(fechaVencimiento): dias enteros restantes hasta vencimiento (puede ser negativo).
      calcVencimiento(fechaInicio, periodicidad): Date sumando 1 año (anual) o 1 mes (default).
      calcVencimientoTimestamp(fechaInicio, periodicidad): lo anterior como Firestore Timestamp.
      formatPlanLabel(plan): "Nombre — $precio/(mes|año)".
      formatLimit(value, label): "ilimitados" si -1, sino "value label".
      formatCurrency(amount): formato MXN es-MX.
      formatDate(value): "dd mmm yyyy" es-MX, o "—".
      getSubscriptionStatusColor(status): clases tailwind por estado (activa/vencida/cancelada/pendiente_pago/trial).
      getPaymentStatusColor(status): clases por estado de pago (pendiente/completado/rechazado).
      getDaysLabel(days): texto humano "Te quedan N dias" / "Vence hoy" / "Vencio hace N dias".
    EXPORTA (constante): SUBSCRIPTION_STATUSES = ['activa','vencida','cancelada','pendiente_pago','trial'].


NOTAS TRANSVERSALES (para la IA lectora)
  Patron de datos: el panel admin NO usa onSnapshot ni /api; lee todo via getDocs (useAdminStats)
    y escribe via Firestore directo (updateDoc/addDoc/deleteDoc/setDoc), luego onRefresh()/refresh()
    para recargar el snapshot completo.
  Joins en memoria: docentes/planes/escuelas se indexan con Object.fromEntries y se relacionan
    en el cliente; los ordenamientos son en memoria (Firestore no admite orderBy ni where compuestos aqui).
  Colecciones Firestore tocadas en la seccion:
    users (lectura, filtra role==docente), students (lectura), subscriptions (lectura + CRUD),
    payments (lectura + aprobar/rechazar), plans (lectura + CRUD), schools (lectura),
    subjects (lectura para agregados), config/payments (lectura + setDoc merge).
  Convencion de limites en planes: -1 = ilimitado (UI muestra simbolo infinito).
  Seguridad de cobros: en config/payments solo se guardan datos publicos; los secretos
    (MP_ACCESS_TOKEN, PAYPAL_SECRET) viven como variables de entorno en Vercel.


===== UTILIDADES: exportes y operaciones masivas =====

ARCHIVO: src/utils/excel.js
LINEAS: ~187
OBJETIVO: Genera y parsea archivos Excel (.xlsx) con la libreria SheetJS (xlsx): plantilla de
  alta de alumnos, parseo de Excel subido por el docente, exporte de lista de alumnos y exporte
  de hoja de calificaciones con parciales y promedios.
EXPORTA: funciones (downloadStudentTemplate, parseStudentExcel, exportStudentListExcel,
  exportSubjectGrades); ademas funcion interna no exportada splitFullName.

  FN downloadStudentTemplate(): descarga una plantilla Excel vacia para que el docente capture alumnos.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno (no toca Firestore); escribe archivo local plantilla-alumnos.xlsx via XLSX.writeFile.
    logica:
      Construye hoja con aoa_to_sheet: encabezado ['#', 'Nombre completo (Apellido Paterno Apellido Materno Nombre)']
        y dos filas de ejemplo (1 Garcia Lopez Juan Carlos, 2 Hernandez Ruiz Maria Fernanda).
      Fija anchos de columna (!cols wch 6 y 46), crea libro, agrega hoja 'Alumnos' y descarga el .xlsx.
      Diseño: columna 1 = numero de lista; columna 2 = nombre completo en UNA sola celda en orden
        Apellido Paterno, Apellido Materno, Nombre(s) separados por espacios.

  FN splitFullName(full): (interna, no exportada) divide un nombre completo en partes por espacios.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica:
      Trim + split por /\s+/ filtrando vacios.
      0 partes -> null; 1 parte -> {apellidoPaterno=parts[0], apellidoMaterno='', nombre=''};
      2 partes -> {paterno=parts[0], materno=parts[1], nombre=''};
      3+ -> {paterno=parts[0], materno=parts[1], nombre=resto unido con espacios}.

  FN parseStudentExcel(file): lee un archivo Excel del docente y devuelve un arreglo de alumnos.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno (lectura local con FileReader, no Firestore).
    logica:
      Devuelve una Promise. Usa FileReader.readAsArrayBuffer; en onload: XLSX.read type 'array',
        toma la primera hoja, convierte a filas con sheet_to_json {header:1}.
      Quita la primera fila (encabezado) con slice(1); por cada fila lee c0, c1, c2 (string trim).
      Retrocompatibilidad: si c0,c1,c2 tienen texto y c0 NO es numero -> formato viejo de 3 columnas
        (Paterno|Materno|Nombre) y retorna {apellidoPaterno:c0, apellidoMaterno:c1, nombre:c2}.
      Formato nuevo: full = c1, o si c0 no es numero usa c0; aplica splitFullName(full).
      Filtra resultados nulos y los que no tengan apellidoPaterno ni nombre. resolve(students).
      onerror/try-catch hace reject(err).

  FN exportStudentListExcel(students): exporta una lista simple de alumnos con credenciales a Excel.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno (escribe archivo local lista_alumnos.xlsx via XLSX.writeFile).
    logica:
      Encabezado ['#','Apellido Paterno','Apellido Materno','Nombre','Username','Contraseña Reset'].
      Mapea cada alumno a [s.orden, s.apellidoPaterno, s.apellidoMaterno, s.nombre, s.username, s.passwordReset].
      aoa_to_sheet, crea libro, hoja 'Lista', writeFile.

  FN exportSubjectGrades({subject, activities, students, submissions}): exporta hoja de calificaciones
    con parciales, promedios por parcial y promedio final, con encabezados combinados.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno directamente (recibe datos ya cargados; escribe archivo local
      calificaciones_<nombre>.xlsx via XLSX.writeFile).
    logica:
      PARCIALES = arreglo 1..subject.parciales (default 3). FIXED=4 columnas fijas (#, paterno, materno, nombre).
      parcialMeta: por cada parcial filtra activities por a.parcial===p; cols = numero de actividades + 1
        (la columna de promedio del parcial).
      gradeCols = FIXED + suma de cols + 1 (columna Promedio Final). totalCols = gradeCols.
      Fila 0 titulo: nombre via subjectDisplayName(subject), agregando "(periodo)" si subjectPeriodLabel
        devuelve algo.
      Fila 2 seccionRow: escribe 'PARCIAL p' en la columna inicial de cada bloque y 'FINAL' al final;
        guarda parcialRanges {start,end} por parcial para los merges.
      Fila 3 nameRow: '#','Apellido Paterno','Apellido Materno','Nombre(s)', luego por parcial el nombre
        de cada actividad y 'Prom. Pp', y al final 'Promedio Final'.
      Filas de datos: ordena alumnos por s.orden asc. Por alumno: por cada actividad busca submission
        (alumnoId y actividadId). Si tiene calificacion: normaliza a base 10 con
        (calificacion / (maxCalif||10))*10 redondeado a 2 decimales, lo agrega a la fila y a parGrades;
        si no, agrega celda vacia ''.
      Promedio parcial = media de parGrades a 2 decimales (o '' si vacio); se agrega a la fila y, si no
        es vacio, a finalGrades. Promedio final = media de finalGrades a 2 decimales (o '').
      allRows = [titulo, fila vacia, seccion, nombres, ...datos]; aoa_to_sheet.
      Merges: titulo abarca todas las columnas; cada 'PARCIAL p' combina su rango start..end en la fila 2.
      Ajusta !cols (anchos: 4, 20, 20, 22, resto 13) y !rows (alturas de titulo/seccion/nombres).
      Nombre de archivo: subjectDisplayName saneado (solo alfanumerico+acentos+ñ, espacios -> _).

  DATOS: No toca Firestore. Opera sobre datos ya cargados (subject, activities, students, submissions)
    y produce/lee archivos .xlsx locales. Normaliza calificaciones a base 10 usando maxCalif por actividad.

  DEPENDENCIAS:
    import * as XLSX from 'xlsx' (libreria externa SheetJS).
    ./subjectName (subjectDisplayName).
    ./dateRange (subjectPeriodLabel).


ARCHIVO: src/utils/pdf.js
LINEAS: ~189
OBJETIVO: Genera PDFs para el docente cargando jsPDF + jspdf-autotable (+ qrcode) de forma diferida
  (dynamic import) para no inflar el bundle principal: lista de alumnos con QR, reporte de
  calificaciones por parcial, y hoja de credenciales con claves temporales.
EXPORTA: funciones async (exportStudentListPDF, exportSubjectGradesPDF, exportCredentialsPDF);
  ademas helpers internos no exportados fullName y safeFile.

  FN fullName(s): (interna) arma el nombre completo "Paterno Materno Nombre" filtrando partes vacias.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica: [apellidoPaterno, apellidoMaterno, nombre].filter(Boolean).join(' ').trim().

  FN safeFile(subject): (interna) genera nombre de archivo seguro a partir del nombre de la asignatura.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica: subjectDisplayName(subject) o 'asignatura'; quita caracteres no alfanumericos
      (conserva acentos y ñ), trim, reemplaza espacios por _.

  FN exportStudentListPDF({subject, students, activationUrl}): PDF con lista de alumnos (nombre +
    usuario) y un codigo QR de activacion arriba a la derecha.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno en Firestore; lazy import de 'jspdf', 'jspdf-autotable', 'qrcode'; descarga
      archivo local lista_<nombre>.pdf via doc.save.
    logica:
      Promise.all importa jsPDF (named), autoTable (default), QRCode (default).
      Crea doc, lee ancho de pagina; genera QR dataURL desde activationUrl (240px, margin 1).
      Encabezado: titulo subjectDisplayName (16 bold), 'Periodo: ...' si subjectPeriodLabel (10),
        'Código de clase: {accessCode||—}' (13 bold).
      Inserta QR PNG arriba-derecha (38x38) + texto 'Escanea para activar'.
      Tabla autoTable startY 62, head ['Nombre completo','Usuario'], body por alumno [fullName, username].
        Estilos: fontSize 10; header azul (37,99,235) blanco; filas alternas gris; columna usuario en courier bold.
      Guarda con nombre saneado lista_<safe>.pdf (mismo saneo que safeFile pero inline).

  FN exportSubjectGradesPDF({subject, activities, students, submissions}): reporte PDF (apaisado) con
    una fila por alumno, promedio por parcial y promedio final.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno en Firestore; lazy import de 'jspdf' y 'jspdf-autotable'; descarga archivo local
      calificaciones_<nombre>.pdf via doc.save.
    logica:
      Importa jsPDF + autoTable. Crea doc orientation 'landscape'.
      PARCIALES = 1..subject.parciales (default 3).
      Encabezado: titulo (15 bold), periodo (subjectPeriodLabel) en gris si existe.
      Ordena alumnos por s.orden asc. Por alumno arma fila [orden, fullName]; por cada parcial
        filtra actividades por a.parcial===p, busca submission por alumnoId+actividadId y si tiene
        calificacion la normaliza a base 10 (calificacion/(maxCalif||10))*10; promedio del parcial =
        media (1 decimal) o '—'; agrega promedio a finals si existe. Final = media de finals (1 decimal) o '—'.
      autoTable head ['#','Alumno', 'Prom. Pp'... , 'Final']; estilos fontSize 9, header azul,
        columnas centradas, columna Final en bold. Guarda calificaciones_<safeFile>.pdf.

  FN exportCredentialsPDF({subject, students, activationUrl}): PDF con credenciales (usuario + clave
    temporal de primer ingreso) y QR de activacion opcional.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno en Firestore; lazy import de 'jspdf', 'jspdf-autotable', 'qrcode'; descarga
      archivo local credenciales_<nombre>.pdf via doc.save.
    logica:
      Importa jsPDF + autoTable + QRCode. Crea doc.
      Encabezado: titulo (16 bold), subtitulo 'Credenciales de acceso de los alumnos' (10),
        'Código de clase: {accessCode||—}' (13 bold).
      Si hay activationUrl: genera y coloca QR arriba-derecha (38x38) + 'Escanea para activar'.
      Ordena alumnos por orden asc. Fila por alumno: [orden, fullName, username,
        resetPassword || (activado ? '(ya activó)' : '—')].
      autoTable head ['#','Nombre completo','Usuario','Clave temporal']; estilos fontSize 10, header azul,
        columna usuario courier bold, columna clave temporal courier bold en color ambar (180,83,9).
      Nota al pie (8, gris): la clave temporal solo se usa en el primer ingreso; el alumno define su
        contraseña al entrar. Guarda credenciales_<safeFile>.pdf.

  DATOS: No toca Firestore. Opera sobre datos cargados (subject, students, activities, submissions,
    activationUrl). Normaliza calificaciones a base 10 con maxCalif. Genera QR a partir de activationUrl.
    Produce archivos .pdf locales.

  DEPENDENCIAS:
    Lazy imports externos: jspdf (jsPDF), jspdf-autotable (autoTable default), qrcode (QRCode default).
    ./subjectName (subjectDisplayName).
    ./dateRange (subjectPeriodLabel).


ARCHIVO: src/utils/copySubject.js
LINEAS: ~113
OBJETIVO: Copia una asignatura existente a un documento nuevo, duplicando sus actividades (visibles,
  sin entregas) y opcionalmente la lista de alumnos (con nueva activacion y nuevas claves temporales).
EXPORTA: funcion async copySubject; ademas helper interno no exportado generateAccessCode.

  FN generateAccessCode(): (interna) genera un codigo de acceso aleatorio de 6 caracteres en mayusculas.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica: Math.random().toString(36).slice(2,8).toUpperCase().

  FN copySubject({sourceSubjectId, nombre, grupo='', fechaInicio='', fechaFin='', parciales,
    colorPalette='default', icon='book', keepStudents, docenteId, escuelaId}): crea una asignatura nueva
    copiando actividades y, opcionalmente, alumnos; devuelve el ID de la nueva asignatura.
    estado: (no aplica)
    efectos: (no aplica)
    datos:
      subjects: addDoc (crea el nuevo documento de asignatura).
      activities: getDocs (lee actividades origen con where asignaturaId == sourceSubjectId);
        writeBatch.set (crea cada actividad nueva apuntando a newSubjectId).
      students (solo si keepStudents): getDocs (lee alumnos origen);
        writeBatch.set (crea cada alumno nuevo apuntando a newSubjectId).
      Usa writeBatch con commits por lotes (LIMIT 490 operaciones) via helper flush().
    logica:
      1) addDoc en 'subjects' con: nombre, grupo, docenteId, escuelaId, parciales (Number||3),
         fechaInicio, fechaFin, colorPalette, icon, accessCode (generateAccessCode), archived:false,
         createdAt (serverTimestamp). Guarda newSubjectId.
      2) getDocs de actividades origen (where asignaturaId == sourceSubjectId).
      3) flush(): si ops>0 hace batch.commit() y crea un batch nuevo, ops=0.
      4) Copia cada actividad como nuevo doc en 'activities' con nombre, maxCalif, instrucciones,
         fechaLimite (||null), tiposArchivo (||'imagenes'), extensionesCustom (||''), tipo (||'archivo'),
         parcial, asignaturaId=newSubjectId, docenteId, oculta:false, publishAt:null,
         createdAt (serverTimestamp). Incrementa ops; si ops>=LIMIT hace flush().
      5) Si keepStudents: getDocs alumnos origen; los ordena por s.orden asc; mantiene Set 'taken'
         para usernames unicos. Por alumno genera username con generateUsername(paterno,materno,nombre);
         si colisiona, usa base de 3 chars + sufijo numerico (2,3,...) hasta que sea unico.
         Crea doc nuevo en 'students' con apellidos, nombre, username, resetPassword (generateResetPassword),
         escuelaId, asignaturaId=newSubjectId, activado:false, orden=i+1, createdAt (serverTimestamp).
         Incrementa ops; si ops>=LIMIT llama flush() (nota: aqui flush() se invoca sin await dentro
         del forEach).
      6) await flush() final; return newSubjectId.
      Reglas clave: actividades se copian visibles (oculta:false) y SIN entregas/calificaciones;
        alumnos copiados quedan activado:false con nueva resetPassword (deben reactivar); el nuevo
        documento tiene su propio accessCode.

  DATOS: subjects (addDoc), activities (getDocs lectura origen + writeBatch.set destino),
    students (getDocs + writeBatch.set, solo si keepStudents). Escrituras agrupadas en lotes <=490 ops.

  DEPENDENCIAS:
    firebase/firestore (collection, query, where, getDocs, addDoc, doc, writeBatch, serverTimestamp).
    ../firebase (db).
    ./generate (generateUsername, generateResetPassword).


ARCHIVO: src/utils/deleteSubjectCascade.js
LINEAS: ~73
OBJETIVO: Borrados masivos relacionados con una asignatura, en lotes para respetar limites de Firestore:
  borrado en cascada completo, borrado de solo entregas (al archivar) y borrado de solo alumnos
  (flujo "empezar desde 0" al desarchivar).
EXPORTA: funciones async (deleteSubjectCascade, deleteSubjectSubmissions, deleteSubjectStudents);
  ademas helpers internos no exportados fetchSubmissionsForActivities y batchDeleteDocs.

  FN fetchSubmissionsForActivities(actIds): (interna) trae todas las entregas de un conjunto de
    actividades sorteando el limite de 'in' (max 30 valores).
    estado: (no aplica)
    efectos: (no aplica)
    datos: submissions: getDocs con where('actividadId','in', ids) por cada chunk.
    logica: si actIds vacio devuelve []; parte actIds en chunks de 30; Promise.all de getDocs por chunk;
      flatMap de los docs resultantes.

  FN batchDeleteDocs(refs): (interna) borra una lista de referencias en lotes <=490 con writeBatch.
    estado: (no aplica)
    efectos: (no aplica)
    datos: borra documentos via writeBatch.delete + commit (coleccion segun cada ref).
    logica: LIMIT=490; itera refs en pasos de LIMIT; por bloque crea writeBatch, agrega batch.delete
      de cada ref y await batch.commit().

  FN deleteSubjectCascade(subjectId): borra por completo una asignatura y todo lo relacionado.
    estado: (no aplica)
    efectos: (no aplica)
    datos:
      activities: getDocs (where asignaturaId == subjectId).
      students: getDocs (where asignaturaId == subjectId).
      submissions: getDocs via fetchSubmissionsForActivities.
      Borra submissions + activities + students con batchDeleteDocs (writeBatch.delete).
      subjects: deleteDoc del documento de la asignatura.
    logica:
      Promise.all carga actsSnap y studsSnap. actIds = ids de actividades. subsDocs = entregas
        de esas actividades. Arma refs combinando doc(db,'submissions',id), doc(db,'activities',id),
        doc(db,'students',id). batchDeleteDocs(refs) y luego deleteDoc del subject.
      Nota explicita en codigo: NO borra las cuentas de Firebase Auth de los alumnos.

  FN deleteSubjectSubmissions(subjectId): borra SOLO las entregas, conservando actividades y alumnos.
    estado: (no aplica)
    efectos: (no aplica)
    datos:
      activities: getDocs (where asignaturaId == subjectId).
      submissions: getDocs via fetchSubmissionsForActivities; batchDeleteDocs (writeBatch.delete).
    logica: usado al archivar; el curso queda como "esqueleto" (actividades + alumnos) sin entregas
      (que opcionalmente se exportan en ZIP antes). Carga actividades, obtiene sus entregas y las borra.

  FN deleteSubjectStudents(subjectId): borra SOLO los alumnos y sus entregas (flujo "empezar desde 0"
    al desarchivar).
    estado: (no aplica)
    efectos: (no aplica)
    datos:
      activities: getDocs (where asignaturaId == subjectId).
      students: getDocs (where asignaturaId == subjectId).
      submissions: getDocs via fetchSubmissionsForActivities; borra submissions + students con batchDeleteDocs.
    logica: Promise.all carga actividades y alumnos; obtiene entregas de las actividades; arma refs de
      submissions + students y los borra en lotes (las actividades se conservan).

  DATOS: activities, students, submissions (lecturas getDocs + borrados writeBatch.delete) y subjects
    (deleteDoc en el caso cascada). Sortea limite 'in' de 30 por chunk y limite de 500 ops por batch (usa 490).

  DEPENDENCIAS:
    firebase/firestore (collection, query, where, getDocs, deleteDoc, doc, writeBatch).
    ../firebase (db).


ARCHIVO: src/utils/downloadSubmissions.js
LINEAS: ~129
OBJETIVO: Construye la lista de descargas y arma un archivo ZIP con las entregas de los alumnos,
  cargando JSZip de forma diferida; soporta ZIP por actividad (una carpeta por alumno) y ZIP de toda
  la asignatura (estructura Asignatura/Parcial/Actividad).
EXPORTA: funciones (buildJobsForActivity, buildJobsForSubject, downloadSubmissionsZip async);
  ademas helpers internos no exportados fullName y sanitize.

  FN fullName(s): (interna) arma nombre completo "Paterno Materno Nombre" filtrando vacios.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica: [apellidoPaterno, apellidoMaterno, nombre].filter(Boolean).join(' ').trim().

  FN sanitize(name): (interna) limpia un nombre para usarlo como ruta/archivo dentro del ZIP.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno.
    logica: reemplaza caracteres invalidos de ruta (/ \ ? % * : | " < >) por espacio, colapsa
      espacios multiples y hace trim.

  FN buildJobsForActivity({students, submissions}): (pura, sin Firestore) arma los "jobs" de descarga
    para UNA actividad: una carpeta por alumno con su(s) archivo(s) y el nombre original.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno (funcion pura sobre arreglos recibidos).
    logica:
      studentMap por id. Por cada submission: omite si no tiene archivoURL o si completadoSinArchivo;
        omite si el alumno no esta en el map. folder = sanitize(fullName(student)) o username/id.
      Conserva el nombre original (nombreArchivo o 'entrega'); separa base sin extension (lastIndexOf('.')).
      Empuja job {path:[folder], fileBaseName: sanitize(base)||'entrega', url: archivoURL, nombreArchivo}.

  FN buildJobsForSubject({subject, activities, submissions, students}): (pura) arma los jobs de toda la
    asignatura con estructura de carpetas Asignatura/Parcial N/Actividad.
    estado: (no aplica)
    efectos: (no aplica)
    datos: ninguno (funcion pura).
    logica:
      folderBase = sanitize(subjectDisplayName(subject)). studentMap por id.
      byAct: agrupa submissions por actividadId. byParcial: agrupa activities por parcial.
      Recorre parciales ordenados; folder 'Parcial N'. Por actividad (folder = sanitize(act.nombre))
        recorre sus entregas: omite sin archivoURL o completadoSinArchivo y alumnos no encontrados.
        baseName = sanitize(fullName(student)); si ya se uso, agrega ' (username|id)' para evitar
        colisiones (Set usedNames por actividad).
      Empuja job {path:[folderBase, folderParcial, folderAct], fileBaseName: baseName, url, nombreArchivo}.

  FN downloadSubmissionsZip({zipName, jobs, onProgress}): descarga los archivos de cada job y los empaqueta
    en un ZIP que se descarga en el navegador; reporta progreso y conteo de errores.
    estado: (no aplica)
    efectos: (no aplica)
    datos: realiza fetch(job.url) por cada archivo (URLs externas de Cloudinary/almacenamiento);
      NO toca Firestore. Genera y descarga el ZIP localmente.
    logica:
      Si jobs vacio retorna {total:0, escritos:0, errores:0}.
      Lazy import de 'jszip'; crea instancia JSZip. Mantiene usedPaths (Set) para rutas unicas.
      resolvePath(job): deduce extension desde nombreArchivo o url (split '.', quita query '?', minusculas);
        base = path.join('/') + '/' + fileBaseName; candidate con o sin extension; si ya existe agrega
        sufijo _2, _3... hasta ser unica; registra en usedPaths.
      Procesa en lotes de BATCH=6 (Promise.all) para no saturar la red: por cada job hace fetch; si !res.ok
        lanza error; agrega el blob al zip (zip.file) e incrementa escritos; en catch incrementa errores;
        llama onProgress(escritos+errores, total).
      Genera blob con zip.generateAsync({type:'blob'}); crea URL.createObjectURL, anchor <a> con
        download = sanitize(zipName)+'.zip', click programatico, lo remueve y revoca la URL tras 5s.
      Retorna {total, escritos, errores}.

  DATOS: No toca Firestore. Los builders son funciones puras sobre datos ya cargados (students, submissions,
    activities, subject). El descargador hace fetch HTTP a las URLs de los archivos (entregas) y produce un
    .zip local. Maneja entregas sin archivo (completadoSinArchivo) omitiendolas.

  DEPENDENCIAS:
    Lazy import externo: jszip (JSZip default).
    ./subjectName (subjectDisplayName).


===== UTILIDADES: generacion, ayudantes y config =====

ARCHIVO: src/utils/generate.js
LINEAS: 26
OBJETIVO: Genera identificadores derivados de datos del alumno: username de 4 letras, contrasena temporal de reseteo y el correo falso de Firebase Auth para alumnos.
EXPORTA: 3 funciones (generateUsername, generateResetPassword, studentEmail)
  FN generateUsername(apPaterno, apMaterno, nombre): construye un username de 4 caracteres con las iniciales del alumno.
    estado: (no aplica)
    efectos: (no aplica)
    datos: (no aplica; pura)
    logica:
      Helper interno clean(s): normaliza (NFD), elimina diacriticos via regex de rango Unicode combinante, quita todo lo que no sea letra a-zA-Z, pasa a mayusculas. Si s es null/undefined usa ''.
      p = clean(apPaterno), m = clean(apMaterno), n = clean(nombre).
      Resultado = primera letra de p + segunda letra de p + primera letra de m + primera letra de n.
      Cada posicion usa 'X' como relleno si falta el caracter: (p[0]||'X') + (p[1]||'X') + (m[0]||'X') + (n[0]||'X').
      Siempre devuelve exactamente 4 caracteres en mayusculas.
  FN generateResetPassword(): genera una contrasena temporal alfanumerica de 6 caracteres.
    estado: (no aplica)
    efectos: (no aplica)
    datos: (no aplica; pura)
    logica:
      Alfabeto chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' (omite caracteres ambiguos: I, O, 0, 1).
      Itera 6 veces y concatena un caracter aleatorio con Math.floor(Math.random()*chars.length).
      Nota: el comentario del CLAUDE.md menciona "4-char" pero el codigo real genera 6 caracteres.
      Devuelve la cadena de 6 caracteres.
  FN studentEmail(username, escuelaId): construye el correo ficticio que usa Firebase Auth para alumnos.
    estado: (no aplica)
    efectos: (no aplica)
    datos: (no aplica; pura)
    logica:
      Devuelve `${username.toLowerCase()}.${escuelaId}@evalua.local`.
      Formato critico para el login/activacion de alumnos (no tienen correo real).
  DATOS: ninguna coleccion Firestore; funciones puras de generacion de cadenas.
  DEPENDENCIAS: ninguna (sin imports internos ni externos).

ARCHIVO: src/utils/dateRange.js
LINEAS: 27
OBJETIVO: Formatea el rango de fechas legible (fechaInicio/fechaFin) de una asignatura, con respaldo al campo legado ciclo para materias creadas antes de R6.
EXPORTA: 2 funciones (formatDateRange, subjectPeriodLabel). fmt es interna (no exportada).
  FN fmt(d) [interna, no exportada]: convierte una cadena 'YYYY-MM-DD' a etiqueta corta "mes ano" en es-MX.
    estado: (no aplica)
    efectos: (no aplica)
    datos: (no aplica; pura)
    logica:
      Si d es falsy devuelve ''.
      Crea Date con sufijo 'T00:00:00' para forzar parseo en hora local y evitar el off-by-one de medianoche UTC.
      Si la fecha es invalida (isNaN) devuelve ''.
      Devuelve date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }), p.ej. "feb 2026".
  FN formatDateRange(fechaInicio, fechaFin): arma un rango "feb 2026 – jul 2026", un solo extremo, o '' si no hay fechas.
    estado: (no aplica)
    efectos: (no aplica)
    datos: (no aplica; pura)
    logica:
      a = fmt(fechaInicio), b = fmt(fechaFin).
      Si ambos existen devuelve `${a} – ${b}` (separador es un guion largo en-dash).
      Si no, devuelve a || b || '' (el extremo disponible o vacio).
  FN subjectPeriodLabel(subject): decide la etiqueta a mostrar bajo el nombre de la asignatura.
    estado: (no aplica)
    efectos: (no aplica)
    datos: lee campos de un objeto subject (fechaInicio, fechaFin, ciclo); no consulta Firestore directamente.
    logica:
      Si subject es falsy devuelve ''.
      Devuelve formatDateRange(subject.fechaInicio, subject.fechaFin) o, si esta vacio, el legado subject.ciclo, o '' .
  DATOS: ninguna coleccion Firestore; opera sobre campos ya cargados del doc subject (fechaInicio, fechaFin, ciclo).
  DEPENDENCIAS: ninguna (sin imports).

ARCHIVO: src/utils/studentLookup.js
LINEAS: 41
OBJETIVO: Resuelve los docs de inscripcion (students) de un alumno autenticado, que puede estar en varias materias (un mismo uid con un doc students por materia), para que cada pagina use el registro correcto por asignatura.
EXPORTA: 2 funciones async (getEnrollments, getEnrollmentForSubject)
  FN getEnrollments(currentUser, userProfile): devuelve TODOS los docs de inscripcion del alumno (uno por materia).
    estado: (no aplica)
    efectos: (no aplica; funcion async, no hook)
    datos:
      Lee coleccion 'students' por currentUser.uid: getDocs(query(collection(db,'students'), where('uid','==',currentUser.uid))).
      Fallback lee un solo doc: getDoc(doc(db,'students', userProfile.studentId)).
      Ultimo recurso lee 'students' por username: getDocs(query(collection(db,'students'), where('username','==',username))).
    logica:
      Estrategia primaria: si hay currentUser.uid consulta por uid; si el snapshot no esta vacio mapea docs a { id, ...data() } y devuelve.
      Fallback: si hay userProfile.studentId obtiene ese unico doc; si existe devuelve [{ id, ...data() }].
      Ultimo recurso: si hay currentUser.email, parsea el correo falso local 'username.escuelaId' (split por '@', luego indexOf('.')): username = parte antes del punto en MAYUSCULAS, escuelaId = parte despues del punto (o null). Consulta por username y, si hay escuelaId, filtra en memoria por escuelaId para que usernames identicos en escuelas distintas no colisionen. Si quedan docs los devuelve.
      Si nada aplica devuelve [] (arreglo vacio).
  FN getEnrollmentForSubject(currentUser, userProfile, asignaturaId): devuelve el doc de inscripcion para una materia concreta, o null.
    estado: (no aplica)
    efectos: (no aplica; async)
    datos: reutiliza getEnrollments (que lee 'students').
    logica:
      Llama await getEnrollments(currentUser, userProfile) para obtener todos.
      Devuelve all.find(s => s.asignaturaId === asignaturaId) o null si no esta inscrito.
  DATOS: coleccion 'students' (solo lectura): getDocs por where uid o where username, y getDoc por id. Filtrado por escuelaId en memoria. Cumple la restriccion Firestore (solo igualdades, sin range ni orderBy).
  DEPENDENCIAS:
    firebase/firestore: collection, query, where, getDocs, getDoc, doc.
    ../firebase: db.

ARCHIVO: src/utils/subjectIcons.js
LINEAS: 27
OBJETIVO: Banco curado de iconos de asignatura tomados de lucide-react (~32 iconos, tree-shaken); mapea claves estables guardadas en el doc subject.icon a componentes de icono.
EXPORTA: 3 constantes (SUBJECT_ICONS, SUBJECT_ICON_KEYS, DEFAULT_SUBJECT_ICON) y 1 funcion (getSubjectIcon)
  CONST SUBJECT_ICONS: objeto que mapea clave string -> componente lucide-react.
    Claves y su icono: book->BookOpen, calculator->Calculator, flask->FlaskConical, atom->Atom, globe->Globe2, languages->Languages, music->Music, palette->Palette, dumbbell->Dumbbell, code->Code2, pen->PenTool, microscope->Microscope, landmark->Landmark, map->Map, leaf->Leaf, brain->Brain, camera->Camera, film->Film, hammer->Hammer, wrench->Wrench, cpu->Cpu, database->Database, sigma->Sigma, ruler->Ruler, compass->Compass, rocket->Rocket, lightbulb->Lightbulb, graduation->GraduationCap, library->Library, pencil->Pencil, trophy->Trophy, star->Star.
  CONST SUBJECT_ICON_KEYS: Object.keys(SUBJECT_ICONS) -> arreglo con todas las claves disponibles (para pintar el selector de iconos).
  CONST DEFAULT_SUBJECT_ICON: 'book' -> icono por defecto cuando no hay clave valida.
  FN getSubjectIcon(key): resuelve el componente de icono por clave, con respaldo al default.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica: devuelve SUBJECT_ICONS[key] o, si no existe, SUBJECT_ICONS[DEFAULT_SUBJECT_ICON] (BookOpen).
  DATOS: ninguna coleccion Firestore; las claves se almacenan en subject.icon (lectura/escritura ocurre en otros componentes).
  DEPENDENCIAS:
    lucide-react: BookOpen, Calculator, FlaskConical, Atom, Globe2, Languages, Music, Palette, Dumbbell, Code2, PenTool, Microscope, Landmark, Map, Leaf, Brain, Camera, Film, Hammer, Wrench, Cpu, Database, Sigma, Ruler, Compass, Rocket, Lightbulb, GraduationCap, Library, Pencil, Trophy, Star.
    Sin imports internos del proyecto.

ARCHIVO: src/utils/subjectName.js
LINEAS: 11
OBJETIVO: Devuelve el nombre de despliegue de una asignatura combinando nombre y grupo, en orden normal o invertido; compatible con materias sin grupo.
EXPORTA: 1 funcion (subjectDisplayName)
  FN subjectDisplayName(subject, reverse = false): construye el texto a mostrar de la asignatura.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: lee campos subject.nombre y subject.grupo (no consulta Firestore).
    logica:
      Si subject es falsy devuelve ''.
      nombre = subject.nombre || '', grupo = subject.grupo || ''.
      Si no hay grupo devuelve solo nombre (retrocompatible con materias antiguas sin grupo).
      Con grupo: reverse=true -> `${grupo} ${nombre}` (p.ej. "1A Matematicas"); reverse=false (default) -> `${nombre} ${grupo}` (p.ej. "Matematicas 1A").
  DATOS: ninguna coleccion Firestore; opera sobre campos del doc subject ya cargado.
  DEPENDENCIAS: ninguna (sin imports).

ARCHIVO: src/utils/subscriptionHelpers.js
LINEAS: 83
OBJETIVO: Ayudantes de suscripcion/pagos: conversion de fechas, dias restantes, calculo de vencimiento, formateo de planes/limites/moneda/fechas, y clases de color por estado de suscripcion/pago.
EXPORTA: 11 funciones (toDate, calcDaysRemaining, calcVencimiento, calcVencimientoTimestamp, formatPlanLabel, formatLimit, formatCurrency, formatDate, getSubscriptionStatusColor, getPaymentStatusColor, getDaysLabel) y 1 constante (SUBSCRIPTION_STATUSES)
  FN toDate(value): normaliza distintas representaciones de fecha a un objeto Date (o null).
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: maneja Firestore Timestamp via value.toDate().
    logica:
      Si value es falsy devuelve null.
      Si ya es instancia de Date la devuelve tal cual.
      Si tiene metodo toDate (Firestore Timestamp) devuelve value.toDate().
      En otro caso devuelve new Date(value).
  FN calcDaysRemaining(fechaVencimiento): calcula dias enteros que faltan (o pasaron) hasta el vencimiento.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      end = toDate(fechaVencimiento); si null devuelve null.
      now = ahora con horas puestas a 0,0,0,0; end tambien a medianoche.
      Devuelve Math.ceil((end - now) / milisegundos-por-dia). Positivo = faltan dias, 0 = vence hoy, negativo = vencido.
  FN calcVencimiento(fechaInicio, periodicidad): calcula la fecha de vencimiento sumando un periodo a la fecha de inicio.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      start = toDate(fechaInicio) o new Date() (hoy) si no hay inicio.
      end = copia de start; si periodicidad === 'anual' suma 1 ano (setFullYear +1), de lo contrario suma 1 mes (setMonth +1) -> mensual por defecto.
      Devuelve el Date end.
  FN calcVencimientoTimestamp(fechaInicio, periodicidad): igual que calcVencimiento pero envuelto en Firestore Timestamp.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: produce un Timestamp de Firestore (para escribir en docs).
    logica: devuelve Timestamp.fromDate(calcVencimiento(fechaInicio, periodicidad)).
  FN formatPlanLabel(plan): etiqueta legible de un plan, "Nombre — $precio/mes|ano".
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: lee plan.periodicidad, plan.nombre, plan.precio.
    logica:
      Si plan es falsy devuelve '—'.
      period = 'ano' si plan.periodicidad === 'anual', si no 'mes'.
      Devuelve `${plan.nombre} — $${plan.precio}/${period}`.
  FN formatLimit(value, label): formatea un limite numerico o "ilimitado".
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Si value === -1 devuelve `${label} ilimitados` (convencion: -1 = sin limite).
      Si no, devuelve `${value} ${label}`.
  FN formatCurrency(amount): formatea un monto como moneda MXN.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica: usa Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(amount || 0).
  FN formatDate(value): formatea una fecha como "dd mes ano" en es-MX.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: usa toDate(value) (acepta Timestamp/Date/string).
    logica:
      d = toDate(value); si null devuelve '—'.
      Devuelve d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }).
  FN getSubscriptionStatusColor(status): devuelve clases Tailwind de color segun el estado de la suscripcion.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Mapa: activa -> bg-emerald-100 text-emerald-700; vencida -> bg-red-100 text-red-700; cancelada -> bg-slate-100 text-slate-600; pendiente_pago -> bg-amber-100 text-amber-700; trial -> bg-blue-100 text-blue-700.
      Default si no coincide: 'bg-slate-100 text-slate-600'.
  FN getPaymentStatusColor(status): devuelve clases Tailwind de color segun el estado del pago.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Mapa: pendiente -> bg-amber-100 text-amber-700; completado -> bg-emerald-100 text-emerald-700; rechazado -> bg-red-100 text-red-700.
      Default: 'bg-slate-100 text-slate-600'.
  FN getDaysLabel(days): texto humano de dias restantes/vencidos.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Si days es null/undefined devuelve ''.
      days > 0 -> `Te quedan ${days} dia(s)` (pluraliza segun === 1).
      days === 0 -> 'Vence hoy'.
      days < 0 -> `Venció hace ${Math.abs(days)} dia(s)` (pluraliza).
  CONST SUBSCRIPTION_STATUSES: ['activa', 'vencida', 'cancelada', 'pendiente_pago', 'trial'] -> lista canonica de estados de suscripcion.
  DATOS: ninguna coleccion Firestore se lee/escribe aqui; sin embargo calcVencimientoTimestamp y toDate producen/consumen valores Timestamp para que otros modulos los escriban en docs de suscripcion/pago.
  DEPENDENCIAS:
    firebase/firestore: Timestamp.
    Sin imports internos del proyecto.

ARCHIVO: src/utils/welcomeEmail.js
LINEAS: 132
OBJETIVO: Genera el HTML del correo de bienvenida al docente y lo envia via EmailJS tras el registro (best-effort, sin romper si faltan credenciales).
EXPORTA: 1 funcion async (sendWelcomeEmail). buildHtml es interna (no exportada).
  CONST SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY: leen import.meta.env.VITE_EMAILJS_SERVICE_ID / VITE_EMAILJS_TEMPLATE_ID / VITE_EMAILJS_PUBLIC_KEY (credenciales publicas de cliente).
  FN buildHtml({ username, school }) [interna, no exportada]: construye el cuerpo HTML completo del correo.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Devuelve un string HTML de email basado en tablas (compatible con clientes de correo), con tema azul (gradiente #1e40af a #2563eb), logo "EF", saludo "Hola, ${username}", caja destacada con el username (fuente monospace, espaciado) y "Escuela: ${school}", boton CTA hacia https://evalua-facil.vercel.app, y pie de pagina "Sistema de gestion de calificaciones SEP · Mexico".
      Interpola username y school directamente en el HTML (este HTML viaja como variable html_content que la plantilla EmailJS renderiza con triple llave {{{html_content}}} sin escapar).
  FN sendWelcomeEmail({ email, username, school }): envia el correo de bienvenida via EmailJS.
    estado: (no aplica)
    efectos: (no aplica; async)
    datos: NO toca Firestore. Llama a emailjs.send(...) (servicio externo EmailJS), no a /api/...
    logica:
      Si falta cualquiera de SERVICE_ID, TEMPLATE_ID o PUBLIC_KEY hace return temprano (no envia; envio opcional/best-effort).
      Llama await emailjs.send(SERVICE_ID, TEMPLATE_ID, params, PUBLIC_KEY) con params { to_email: email, to_name: username, html_content: buildHtml({ username, school }) }.
      No captura errores internamente; el caller (Register) envuelve la llamada en try/catch para ignorar fallos y no romper el registro.
  DATOS: ninguna coleccion Firestore; integra con EmailJS (servicio externo). El cuerpo de la plantilla EmailJS es solo {{{html_content}}}.
  DEPENDENCIAS:
    @emailjs/browser: emailjs (default import).
    Sin imports internos del proyecto.

ARCHIVO: src/utils/activityVisibility.js
LINEAS: 26
OBJETIVO: Fuente unica de verdad para la visibilidad de actividades: decide si una actividad esta publicada (filtrado en vistas de alumno) y su estado de despliegue (estilos en vistas de docente). Retrocompatible: actividades sin campo oculta se consideran visibles.
EXPORTA: 3 funciones (isActivityPublished, activityVisibilityState, formatPublishAt)
  FN isActivityPublished(a): indica si una actividad ya esta visible para el alumno.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: lee campos a.oculta y a.publishAt del objeto actividad (no consulta Firestore).
    logica:
      Si !a?.oculta (no oculta o sin el campo) devuelve true (publicada).
      Si tiene publishAt: devuelve true cuando new Date(a.publishAt).getTime() <= Date.now() (ya llego la fecha programada).
      Si esta oculta sin publishAt devuelve false.
  FN activityVisibilityState(a): devuelve el estado de despliegue para la UI del docente.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: lee a.oculta y a.publishAt.
    logica:
      Si !a?.oculta devuelve 'visible'.
      Si tiene publishAt y la fecha ya paso (<= Date.now()) devuelve 'visible'.
      Si tiene publishAt (futuro) devuelve 'scheduled'.
      En otro caso (oculta, sin publishAt) devuelve 'hidden'.
      Valores posibles: 'visible' | 'scheduled' | 'hidden'.
  FN formatPublishAt(publishAt): etiqueta legible de la fecha/hora programada de publicacion.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Si publishAt es falsy devuelve ''.
      Devuelve new Date(publishAt).toLocaleDateString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).
  DATOS: ninguna coleccion Firestore; opera sobre campos del doc activities (oculta, publishAt) ya cargado en memoria.
  DEPENDENCIAS: ninguna (sin imports).

ARCHIVO: src/config/billing.js
LINEAS: 8
OBJETIVO: Datos estaticos de la cuenta bancaria para transferencia/pago manual de la suscripcion (fuente unica de verdad para mostrar en la UI de pagos).
EXPORTA: 1 constante (BANK_TRANSFER)
  CONST BANK_TRANSFER: objeto con los datos bancarios.
    Campos: banco: 'BBVA'; titular: 'Evalúa Fácil'; cuenta: '0123456789'; clabe: '012345678901234567'; nota: 'Indica tu usuario o correo en el concepto de la transferencia.'.
    Nota: los valores parecen marcadores de posicion (placeholders), no una cuenta real.
  DATOS: ninguna coleccion Firestore; constante estatica.
  DEPENDENCIAS: ninguna (sin imports).

ARCHIVO: src/config/fileTypes.js
LINEAS: 92
OBJETIVO: Define los presets de tipos de archivo que un docente puede permitir por actividad (incluida una opcion personalizada con extensiones propias) y valida archivos subidos por el alumno contra ese preset.
EXPORTA: 2 constantes (FILE_TYPE_OPTIONS, DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE) y 3 funciones (parseCustomExts, getFileType, isFileAllowed)
  CONST FILE_TYPE_OPTIONS: arreglo de presets, cada uno { key, label, accept, mimes[], exts[] }.
    Presets:
      imagenes -> 'Imágenes (JPG, PNG)', accept '.jpg,.jpeg,.png', mimes [image/jpeg, image/jpg, image/png], exts [jpg, jpeg, png].
      pdf -> 'PDF', accept '.pdf', mimes [application/pdf], exts [pdf].
      imagenes_pdf -> 'Imágenes y PDF', accept '.jpg,.jpeg,.png,.pdf', mimes [image/jpeg, image/jpg, image/png, application/pdf], exts [jpg, jpeg, png, pdf].
      documentos -> 'Word y PDF', accept '.doc,.docx,.pdf', mimes [application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document], exts [doc, docx, pdf].
      todos -> 'Cualquier archivo', accept '.doc,.docx,.pdf,.jpg,.jpeg,.png', mimes [application/pdf, application/msword, application/vnd...wordprocessingml.document, image/jpeg, image/jpg, image/png], exts [doc, docx, pdf, jpg, jpeg, png]. (Pese al label "Cualquier archivo", solo admite estos tipos.)
  CONST DEFAULT_FILE_TYPE: 'imagenes' -> preset por defecto (solo imagenes).
  CONST CUSTOM_FILE_TYPE: 'personalizado' -> clave especial para extensiones definidas por el docente.
  FN parseCustomExts(raw): normaliza un texto libre de extensiones en un arreglo limpio en minusculas.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Si raw es falsy usa ''.
      Divide por espacios, comas o punto y coma (regex /[\s,;]+/).
      Para cada token: trim, toLowerCase, quita el punto inicial (replace /^\./).
      filter(Boolean) elimina vacios. Ej: "PSD, .ai zip" -> ['psd','ai','zip'].
  FN getFileType(key, customExts): resuelve la definicion de tipo de archivo activa.
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      Si key === CUSTOM_FILE_TYPE ('personalizado'): construye la definicion al vuelo con exts = parseCustomExts(customExts); label = lista de exts en MAYUSCULAS unidas por ", " o 'Personalizado' si no hay; accept = exts mapeadas a '.ext' unidas por coma; mimes = [] (vacio, valida solo por extension); exts.
      Si no, busca en FILE_TYPE_OPTIONS por o.key === key; si no encuentra cae al preset DEFAULT_FILE_TYPE ('imagenes').
  FN isFileAllowed(file, key, customExts): valida un objeto File contra el preset (o extensiones personalizadas).
    estado: (no aplica)
    efectos: (no aplica; pura)
    datos: (no aplica)
    logica:
      ft = getFileType(key, customExts).
      Si ft.exts.length === 0 devuelve true (personalizado sin extensiones -> permite cualquier archivo).
      Si file.type existe y esta en ft.mimes devuelve true (valida primero por MIME).
      Fallback por extension: ext = ultima parte de file.name tras '.' en minusculas; devuelve ft.exts.includes(ext).
  DATOS: ninguna coleccion Firestore; los valores (key, customExts) se guardan en el doc activities por otros componentes (formularios de actividad) y se usan al validar la subida del alumno.
  DEPENDENCIAS: ninguna (sin imports).


===== BACKEND SERVERLESS (api/) — PAGOS =====

RESUMEN GENERAL
  Plataforma: funciones serverless de Vercel (cada archivo bajo api/ exporta un handler default(req, res)).
  Proposito: cobrar suscripciones del docente via MercadoPago y PayPal sin exponer secretos al cliente.
  Patron de seguridad de precio: el precio SIEMPRE se lee del documento plans/{planId} en Firestore (server-side), NUNCA del body del cliente; asi el usuario no puede pagar menos manipulando la request (ver billing.getPlan).
  Patron de confirmacion: nunca se confia en la notificacion/respuesta del cliente; el estado "aprobado" se re-verifica contra la API de la pasarela con el token secreto (webhook MP re-consulta el pago; capture PayPal lee custom_id de la respuesta de PayPal).
  Autenticacion del cliente: las rutas de creacion de pago exigen un Firebase ID token (Bearer) verificado con Admin SDK (verifyRequest). El webhook de MP NO verifica token (lo llama MP server-to-server) y en su lugar re-consulta el pago.
  Donde viven los secretos: variables de entorno en Vercel (process.env.*), nunca en el cliente ni en Firestore. Variables usadas:
    FIREBASE_SERVICE_ACCOUNT (JSON o base64 de la service account del Admin SDK)
    MP_ACCESS_TOKEN (token secreto de MercadoPago)
    PAYPAL_CLIENT_ID, PAYPAL_SECRET (credenciales PayPal)
    PAYPAL_ENV (sandbox | produccion; controla la URL base de PayPal)
    APP_URL (URL publica de la app; default https://evalua-facil.vercel.app)
  Colecciones Firestore tocadas por el backend: plans (solo lectura), subscriptions (lectura/escritura), payments (lectura/escritura).


ARCHIVO: api/_lib/firebaseAdmin.js
LINEAS: ~48
OBJETIVO: Inicializa el Firebase Admin SDK (singleton perezoso) y expone helpers de Firestore, Auth y verificacion del ID token del cliente.
EXPORTA: funciones getDb, getAuth, verifyRequest; re-exporta el objeto admin (named exports, no default).
  FN init(): inicializa el Admin SDK una sola vez (idempotente).
    estado: variable de modulo initialized (boolean) que actua como bandera singleton.
    efectos: (no aplica; serverless, no React).
    datos: ninguna lectura Firestore directa; configura credenciales.
    logica: si initialized true retorna; lee process.env.FIREBASE_SERVICE_ACCOUNT y si falta lanza Error ("FIREBASE_SERVICE_ACCOUNT no esta configurado en Vercel"); intenta JSON.parse del raw y si falla lo trata como base64 (Buffer.from(raw,'base64') -> utf8 -> JSON.parse); si admin.apps.length es 0 llama admin.initializeApp con admin.credential.cert(json); marca initialized=true.
  FN getDb(): retorna instancia de Firestore lista para usar.
    logica: llama init() y devuelve admin.firestore().
  FN getAuth(): retorna instancia de Firebase Auth (Admin).
    logica: llama init() y devuelve admin.auth().
  FN verifyRequest(req): verifica el Firebase ID token enviado por el cliente y devuelve el token decodificado.
    datos: usa getAuth().verifyIdToken(token) (Admin Auth, no Firestore).
    logica: lee header Authorization (o variante 'Authorization'); extrae token si empieza con "Bearer " (slice 7); si no hay token lanza Error "No autenticado" con err.status=401; retorna el resultado de verifyIdToken (contiene uid).
  DATOS: no escribe Firestore; provee acceso a Firestore/Auth para los demas modulos; valida identidad del docente via ID token.
  DEPENDENCIAS: importa el paquete externo firebase-admin. Es consumido por billing.js (admin, getDb) y por todos los handlers de creacion/captura (verifyRequest).


ARCHIVO: api/_lib/billing.js
LINEAS: ~114
OBJETIVO: Logica de negocio de facturacion compartida: leer planes, iniciar un pago pendiente (subscription+payment) y completar/activar la suscripcion de forma idempotente.
EXPORTA: funciones getPlan, completePayment, startPayment (named exports). addPeriod es interna (no exportada).
  FN getPlan(planId): lee un plan de Firestore; el precio siempre proviene de aqui (server-side), nunca del cliente.
    datos: getDb().collection('plans').doc(planId).get() (lectura getDoc/Admin).
    logica: si el doc no existe lanza Error "Plan no encontrado" con err.status=400; retorna { id, ...data } (incluye precio, nombre, periodicidad, etc.).
  FN addPeriod(date, periodicidad): calcula la fecha de vencimiento sumando un periodo a una fecha (interna).
    logica: clona la fecha; si periodicidad === 'anual' suma 1 anio (setFullYear+1); de lo contrario suma 1 mes (setMonth+1); retorna el Date.
  FN completePayment(paymentId, gatewayData={}): marca un pago como completado y activa su suscripcion; idempotente.
    datos: lee payments/{paymentId} (get); actualiza payments/{paymentId} (update: status='completado', gateway=gatewayData, updatedAt=serverTimestamp); si payment.subscriptionId existe, actualiza subscriptions/{subscriptionId} (update: status='activa', planId, fechaInicio=Timestamp.fromDate(inicio), fechaVencimiento=Timestamp.fromDate(vencimiento), updatedAt=serverTimestamp); internamente llama getPlan(payment.planId) (lectura plans).
    logica: si el pago no existe lanza Error "Pago no encontrado" con err.status=404; si payment.status === 'completado' retorna { alreadyDone: true } SIN hacer nada (idempotencia para webhooks y captures que pueden disparar dos veces); inicio = new Date(), vencimiento = addPeriod(inicio, plan.periodicidad || 'mensual'); retorna { alreadyDone: false }.
  FN startPayment({ uid, planId, escuelaId, schoolName, metodo }): crea (o reutiliza) una suscripcion pendiente + un pago pendiente para el docente.
    datos: getPlan(planId) (lectura plans); consulta subscriptions where('docenteId','==',uid).get() (getDocs); si hay resultados ordena en memoria por updatedAt desc y reutiliza la mas reciente con update (planId, status='pendiente_pago', updatedAt=serverTimestamp); si no hay, add a subscriptions (docenteId, planId, escuelaId, schoolName, status='pendiente_pago', createdAt, updatedAt); add a payments (docenteId, subscriptionId, planId, escuelaId, monto=plan.precio||0, metodo, status='pendiente', createdAt).
    logica: el ordenamiento es en memoria (Firestore del proyecto no permite orderBy en query); el monto guardado proviene del plan, no del cliente; retorna { subscriptionId, paymentId, plan }.
  DATOS: plans (lectura), subscriptions (getDocs/add/update), payments (add/get/update). serverTimestamp y Timestamp.fromDate via admin.firestore.FieldValue / admin.firestore.Timestamp.
  DEPENDENCIAS: importa admin y getDb de ./firebaseAdmin.js. Consumido por create-preference.js, mp/webhook.js, paypal/create-order.js, paypal/capture-order.js.


ARCHIVO: api/_lib/paypal.js
LINEAS: ~36
OBJETIVO: Helpers de PayPal: URL base segun entorno y obtencion del access token OAuth2 con credenciales secretas.
EXPORTA: funciones paypalBase, getPaypalToken (named exports). Constante de modulo BASE (interna).
  Constante BASE: URL base de la API de PayPal; 'https://api-m.sandbox.paypal.com' si process.env.PAYPAL_ENV === 'sandbox', de lo contrario 'https://api-m.paypal.com' (produccion).
  FN paypalBase(): retorna la constante BASE (la URL base activa).
  FN getPaypalToken(): obtiene un access token OAuth2 de PayPal (client_credentials).
    datos: fetch POST a `${BASE}/v1/oauth2/token` con header Authorization Basic (base64 de `${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`), Content-Type x-www-form-urlencoded, body 'grant_type=client_credentials'.
    logica: si faltan PAYPAL_CLIENT_ID o PAYPAL_SECRET lanza Error con err.status=500; si la respuesta no es ok lanza Error "No se pudo autenticar con PayPal" con err.status=502 y err.detail=data; retorna data.access_token.
  DATOS: no toca Firestore; solo llamadas HTTP a PayPal.
  DEPENDENCIAS: ninguna interna del proyecto (solo process.env y fetch global). Consumido por paypal/create-order.js y paypal/capture-order.js.


ARCHIVO: api/mp/create-preference.js
LINEAS: ~70
OBJETIVO: Endpoint que crea un pago pendiente y una preferencia de checkout en MercadoPago, devolviendo el init_point para redirigir al docente.
EXPORTA: handler default (funcion serverless de Vercel).
  Metodo HTTP: POST (cualquier otro -> 405 "Metodo no permitido").
  Entrada: header Authorization Bearer (Firebase ID token); body JSON { planId (requerido), escuelaId?, schoolName? }.
  Salida (200): { paymentId, preferenceId, init_point }. Errores: 401 no autenticado, 400 falta planId, 500 MP_ACCESS_TOKEN no configurado, 502 error de MercadoPago (con detail), 500 generico.
  FN handler(req, res): orquesta verificacion, creacion de pago y creacion de preferencia MP.
    datos: verifyRequest(req) (Admin Auth); startPayment(...) -> escribe subscriptions/payments en Firestore (via billing); fetch POST a https://api.mercadopago.com/checkout/preferences con Authorization Bearer MP_ACCESS_TOKEN.
    logica: valida metodo POST; lee MP_ACCESS_TOKEN de env (si falta -> 500); decodifica token y obtiene uid; valida planId; llama startPayment con metodo='mercadopago' obteniendo { paymentId, plan }; arma prefBody con items (title=plan.nombre, quantity 1, unit_price=Number(plan.precio)||0, currency_id 'MXN'), external_reference=paymentId (clave para enlazar el webhook al pago), back_urls success/failure/pending hacia `${APP_URL}/pago-resultado?status=...`, auto_return 'approved', notification_url `${APP_URL}/api/mp/webhook`, metadata { paymentId, uid }; si la respuesta MP no es ok -> 502 con detail; responde 200 con preferenceId e init_point; cualquier excepcion -> res.status(err.status||500).json({ error: err.message }).
  INTEGRACION MERCADOPAGO: crea Checkout Preference; el monto sale del plan (server-side). El enlace pago<->webhook se hace por external_reference = paymentId.
  SECRETOS: MP_ACCESS_TOKEN (Vercel env). APP_URL (Vercel env, default produccion).
  DATOS: subscriptions y payments (escritura via startPayment); plans (lectura via startPayment->getPlan).
  DEPENDENCIAS: importa verifyRequest de ../_lib/firebaseAdmin.js y startPayment de ../_lib/billing.js.


ARCHIVO: api/mp/webhook.js
LINEAS: ~45
OBJETIVO: Webhook server-to-server de MercadoPago; al cambiar el estado de un pago, re-verifica contra la API de MP y completa/activa la suscripcion.
EXPORTA: handler default (funcion serverless de Vercel).
  Metodo HTTP: invocado por MercadoPago (no restringe metodo; lee query y body). No verifica Firebase ID token (es llamada de servidor de MP).
  Entrada: query y/o body de MP con el id del pago en formatos variables (q['data.id'], q.id, body.data.id, o body.id cuando type==='payment') y un tipo (q.type || q.topic || body.type).
  Salida: siempre responde con res.end() sin cuerpo. 200 cuando se procesa o se ignora un evento; 500 cuando falta token, la re-consulta a MP falla, o hay excepcion (para que MP reintente).
  FN handler(req, res): valida y re-verifica el pago, luego completa.
    datos: fetch GET a https://api.mercadopago.com/v1/payments/{mpPaymentId} con Authorization Bearer MP_ACCESS_TOKEN; si aprobado, completePayment(...) -> actualiza payments y subscriptions en Firestore.
    logica: si falta MP_ACCESS_TOKEN -> 500.end(); deriva type y mpPaymentId de query/body; si type !== 'payment' o no hay mpPaymentId -> 200.end() (ignora eventos no relevantes y evita reintentos de MP); re-consulta el pago en MP (NUNCA confia en el body de la notificacion); si la re-consulta no es ok -> 500.end() (transitorio, MP reintenta); si payment.status === 'approved' && payment.external_reference, llama completePayment(payment.external_reference, { provider:'mercadopago', mpPaymentId:String(mpPaymentId), status }); siempre cierra con 200.end() salvo errores; catch -> 500.end() para que MP reintente.
  INTEGRACION MERCADOPAGO: confirmacion segura por re-fetch del pago con token secreto; usa external_reference (= paymentId) para localizar el pago local. Idempotencia garantizada por completePayment (no re-activa si ya 'completado').
  SECRETOS: MP_ACCESS_TOKEN (Vercel env).
  DATOS: payments (lectura/actualizacion via completePayment), subscriptions (actualizacion via completePayment), plans (lectura via completePayment->getPlan).
  DEPENDENCIAS: importa completePayment de ../_lib/billing.js. (No importa firebaseAdmin directamente; no verifica token porque es server-to-server.)


ARCHIVO: api/paypal/create-order.js
LINEAS: ~55
OBJETIVO: Endpoint que crea un pago pendiente y una orden de PayPal (intent CAPTURE), devolviendo el orderId para el flujo de PayPal en el cliente.
EXPORTA: handler default (funcion serverless de Vercel).
  Metodo HTTP: POST (otro -> 405 "Metodo no permitido").
  Entrada: header Authorization Bearer (Firebase ID token); body JSON { planId (requerido), escuelaId?, schoolName? }.
  Salida (200): { orderId, paymentId }. Errores: 401 no autenticado, 400 falta planId, 500/502 PayPal (getPaypalToken puede lanzar 500/502), 502 error de PayPal al crear orden (con detail), 500 generico.
  FN handler(req, res): verifica usuario, crea pago pendiente y crea la orden PayPal.
    datos: verifyRequest(req) (Admin Auth); startPayment(...) -> escribe subscriptions/payments; getPaypalToken() (OAuth PayPal); fetch POST a `${paypalBase()}/v2/checkout/orders` con Authorization Bearer accessToken.
    logica: valida metodo POST; decodifica token y obtiene uid; valida planId; startPayment con metodo='paypal' -> { paymentId, plan }; obtiene accessToken; arma body { intent:'CAPTURE', purchase_units:[{ custom_id: paymentId (clave para enlazar al capture), description: plan.nombre, amount:{ currency_code:'MXN', value:(Number(plan.precio)||0).toFixed(2) } }] }; si la respuesta no es ok -> 502 con detail; responde 200 con { orderId: data.id, paymentId }; catch -> res.status(err.status||500).json({ error: err.message, detail: err.detail }).
  INTEGRACION PAYPAL: crea orden CAPTURE; el monto sale del plan (server-side) formateado a 2 decimales; el enlace pago<->capture se hace por custom_id = paymentId en el purchase_unit.
  SECRETOS: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV (via getPaypalToken/paypalBase, Vercel env).
  DATOS: subscriptions y payments (escritura via startPayment); plans (lectura via startPayment->getPlan).
  DEPENDENCIAS: importa verifyRequest de ../_lib/firebaseAdmin.js, startPayment de ../_lib/billing.js, getPaypalToken y paypalBase de ../_lib/paypal.js.


ARCHIVO: api/paypal/capture-order.js
LINEAS: ~48
OBJETIVO: Endpoint que captura una orden de PayPal y, si quedo COMPLETED, completa/activa la suscripcion del docente.
EXPORTA: handler default (funcion serverless de Vercel).
  Metodo HTTP: POST (otro -> 405 "Metodo no permitido").
  Entrada: header Authorization Bearer (Firebase ID token, se verifica pero no se usa el uid); body JSON { orderId (requerido) }.
  Salida (200): { ok:true, status } si COMPLETED y se ubico el paymentId; { ok:false, status } si no. Errores: 401 no autenticado, 400 falta orderId, 500/502 PayPal (getPaypalToken), 502 no se pudo capturar (con detail), 500 generico.
  FN handler(req, res): verifica usuario, captura la orden y completa el pago si procede.
    datos: verifyRequest(req) (Admin Auth, sin usar uid); getPaypalToken(); fetch POST a `${paypalBase()}/v2/checkout/orders/${orderId}/capture`; si COMPLETED, completePayment(...) -> actualiza payments y subscriptions.
    logica: valida metodo POST; verifica token; valida orderId; obtiene accessToken y captura; si la respuesta no es ok -> 502 "No se pudo capturar el pago" con detail; extrae paymentId desde la respuesta de PayPal (unit.custom_id o unit.payments.captures[0].custom_id) — se lee de la respuesta de PayPal, NO del cliente, para que no pueda falsear cual pago es; si data.status === 'COMPLETED' && paymentId, llama completePayment(paymentId, { provider:'paypal', orderId, status }) y responde 200 { ok:true, status }; de lo contrario 200 { ok:false, status }; catch -> res.status(err.status||500).json({ error: err.message, detail: err.detail }).
  INTEGRACION PAYPAL: captura la orden; confirmacion segura leyendo custom_id (= paymentId) de la respuesta de PayPal. Idempotencia garantizada por completePayment (no re-activa si ya 'completado'; cubre el caso de doble disparo con eventuales webhooks).
  SECRETOS: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV (via getPaypalToken/paypalBase, Vercel env).
  DATOS: payments (lectura/actualizacion via completePayment), subscriptions (actualizacion via completePayment), plans (lectura via completePayment->getPlan).
  DEPENDENCIAS: importa verifyRequest de ../_lib/firebaseAdmin.js, completePayment de ../_lib/billing.js, getPaypalToken y paypalBase de ../_lib/paypal.js.


NOTAS TRANSVERSALES
  Flujo MercadoPago: cliente (autenticado) -> POST /api/mp/create-preference -> crea payment 'pendiente' + subscription 'pendiente_pago' y preferencia MP -> redirige a init_point -> usuario paga -> MP llama POST /api/mp/webhook -> re-verifica pago -> completePayment activa subscription y marca payment 'completado'.
  Flujo PayPal: cliente -> POST /api/paypal/create-order -> crea payment 'pendiente' + subscription 'pendiente_pago' + orden PayPal -> usuario aprueba en PayPal -> cliente -> POST /api/paypal/capture-order -> captura -> completePayment activa subscription y marca payment 'completado'.
  Enlace pago<->pasarela: external_reference (MP) y custom_id (PayPal) llevan siempre el paymentId de Firestore.
  Estados de payments: 'pendiente' -> 'completado'. Estados de subscriptions: 'pendiente_pago' -> 'activa' (con fechaInicio y fechaVencimiento calculadas en server).
  Restriccion Firestore del proyecto respetada: startPayment usa where('==') y ordena la suscripcion mas reciente en memoria (sin orderBy en query).


===== SCRIPTS DE BASE DE DATOS (seeds-db/) =====

NOTA GENERAL DEL DIRECTORIO:
  Coleccion de scripts CLI (Node.js + bash) para administrar Firestore y Firebase Auth del proyecto
  evalua-facil-app: limpiar BD, sembrar datos demo, crear/promover admin, migrar usernames, cambiar
  contraseñas, corregir datos puntuales y verificar conteos.
  Dos familias de autenticacion conviven:
    1) firebase-admin SDK (Admin SDK) con credencial OAuth tomada de
       ~/.config/configstore/firebase-tools.json (token de firebase-cli). Algunos scripts caen a
       Application Default Credentials si no hay token.
    2) REST puro (modulo https) contra identitytoolkit.googleapis.com (Identity Toolkit / Auth) y
       firestore.googleapis.com (Firestore REST), usando una API_KEY publica y, en varios casos,
       una "cuenta temporal" creada al vuelo para obtener un idToken con el cual escribir Firestore
       bajo reglas permisivas temporales (allow write if auth != null).
  PROJECT_ID en todos: evalua-facil-app.
  API_KEY publica embebida en los scripts REST: AIzaSyBn-gcF3PioP5Z3C4pN42fzh8Vlrjrggug
  Email admin objetivo recurrente: alannicanor62@gmail.com (ADMIN_UID Z16jetZX0PMAijVBCYS64rVSprd2).


ARCHIVO: seeds-db/clear-db.js
LINEAS: ~113
OBJETIVO: Borrar DESTRUCTIVAMENTE todas las colecciones principales de Firestore via Admin SDK, con confirmacion interactiva.
EXPORTA: nada (script ejecutable CLI; usa shebang node).
  DESTRUCTIVO: SI (elimina documentos sin undo).
  REQUIERE: firebase-admin SDK; credencial via GOOGLE_APPLICATION_CREDENTIALS (Service Account) o autenticacion automatica de firebase-cli (ADC).
  CONSTANTES: COLLECTIONS_TO_DELETE = ['users','students','subjects','activities','submissions','schools'] (no incluye attendance ni groups).
  FN deleteCollection(collectionName): borra hasta 1000 docs de una coleccion en un solo batch.
    datos: Firestore Admin: db.collection(name).limit(1000).get() (lectura) y batch.delete + batch.commit() (escritura/borrado).
    logica: si la coleccion esta vacia avisa y retorna 0; si hay error lo captura y retorna 0; cuenta y retorna documentos borrados. Limite de 1000 por corrida (no itera mas alla del primer batch).
  FN prompt(question): pregunta interactiva en consola.
    logica: usa readline sobre stdin/stdout; devuelve la respuesta en minusculas como Promise.
  FN main(): orquesta el borrado.
    datos: invoca deleteCollection por cada coleccion (Firestore Admin batch delete).
    logica: imprime advertencia; pide confirmacion (debe escribirse exactamente "yes"); si no, cancela y sale; suma total borrado; cierra app admin y exit(0).
  DATOS: Firestore (Admin SDK) — lee y borra en batch users, students, subjects, activities, submissions, schools.
  DEPENDENCIAS: externas firebase-admin, readline, path. Sin imports internos del proyecto.


ARCHIVO: seeds-db/clear-db-firebase-cli.sh
LINEAS: ~53
OBJETIVO: Borrar DESTRUCTIVAMENTE colecciones de Firestore usando el comando firebase firestore:delete (Firebase CLI), con confirmacion.
EXPORTA: nada (script bash).
  DESTRUCTIVO: SI.
  REQUIERE: firebase-cli instalado + firebase login. No usa Admin SDK.
  CONSTANTES: PROJECT_ID=evalua-facil-app; COLLECTIONS=(users students groups subjects activities submissions schools) (incluye groups; NO incluye attendance).
  logica: set -e; imprime advertencia; read -p pide confirmacion ("yes"); si no coincide cancela y exit 0; por cada coleccion ejecuta firebase firestore:delete --project=... --recursive --yes "$collection" silenciando stderr; si falla o esta vacia imprime "Collection deleted or was empty".
  DATOS: Firestore via Firebase CLI (firestore:delete --recursive) sobre las 7 colecciones listadas.
  DEPENDENCIAS: comando externo firebase (firebase-tools). Sin imports internos.


ARCHIVO: seeds-db/clear-all.sh
LINEAS: ~20
OBJETIVO: Forzar el borrado de TODAS las colecciones (incluida attendance) via Firebase CLI, sin pedir confirmacion.
EXPORTA: nada (script bash).
  DESTRUCTIVO: SI — y a diferencia de los otros NO pide confirmacion (borra directo).
  REQUIERE: firebase-cli + firebase login.
  CONSTANTES: PROJECT=evalua-facil-app; COLLECTIONS=(users students groups subjects activities submissions schools attendance) (la lista mas completa; es la unica que incluye attendance).
  logica: set -e; itera cada coleccion ejecutando firebase firestore:delete --project=... --recursive --yes "$col", filtra lineas vacias con grep y duerme 1s entre cada una (sleep 1) para evitar rate limit.
  DATOS: Firestore via Firebase CLI (firestore:delete --recursive) sobre 8 colecciones.
  DEPENDENCIAS: comando externo firebase. Sin imports internos.


ARCHIVO: seeds-db/create-admin.js
LINEAS: ~130
OBJETIVO: Promover un usuario existente a admin, o crear una cuenta admin nueva, via Admin SDK (Auth + Firestore).
EXPORTA: nada (script CLI con flags).
  DESTRUCTIVO: NO (solo crea/actualiza un doc users y opcionalmente una cuenta Auth).
  REQUIERE: firebase-admin SDK; credencial OAuth de firebase-tools.json (refreshToken) o ADC.
  FLAGS: --email <correo> (requerido), --create (crear cuenta nueva si no existe), --password <clave>, --help/-h.
  FN parseArgs(argv): parsea los flags de linea de comando a un objeto args.
    logica: recorre process.argv desde indice 2; mapea --email/--password (consumen siguiente token), --create y --help (booleanos).
  FN printUsage(): imprime ayuda de uso en consola.
  FN promoteToAdmin(uid, email, existingData={}): escribe el doc users/{uid} con role admin.
    datos: Firestore Admin: db.collection('users').doc(uid).set({...existingData, role:'admin', email, updatedAt: serverTimestamp()}, {merge:true}) (escritura merge).
  FN main(): flujo principal.
    datos: Auth Admin: auth.getUserByEmail(email), auth.createUser({email,password,emailVerified:true}). Firestore: lee users/{uid}, escribe via promoteToAdmin.
    logica: si falta email o --help muestra uso y sale; busca usuario por email; si existe y ya es admin avisa y sale; si existe lo promueve; si no existe y no hay --create error y sale(1); con --create exige password >=6 chars; crea cuenta Auth verificada y la promueve. Cierra app admin y exit.
  DATOS: Firebase Auth (getUserByEmail/createUser) + Firestore users (get/set merge).
  DEPENDENCIAS: externas firebase-admin, os, path. Sin imports internos.


ARCHIVO: seeds-db/set-admin.js
LINEAS: ~87
OBJETIVO: Promover alannicanor62@gmail.com a admin via REST (Identity Toolkit + Firestore REST) creando una cuenta temporal para autenticar la escritura.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (solo escribe users/{ADMIN_UID}); crea y borra una cuenta Auth temporal.
  REQUIERE: solo Node + acceso de red; usa API_KEY publica. Requiere reglas Firestore TEMPORALMENTE permisivas (allow write if auth != null) para que la cuenta temporal pueda escribir.
  CONSTANTES: API_KEY, PROJECT_ID, ADMIN_EMAIL=alannicanor62@gmail.com, ADMIN_UID=Z16jetZX0PMAijVBCYS64rVSprd2, TEMP_EMAIL/TEMP_PASS generados con Date.now().
  FN idtPost(endpoint, body): POST a identitytoolkit.googleapis.com/v1/{endpoint}?key=API_KEY.
    datos: REST Auth (Identity Toolkit) — usado para accounts:signUp y accounts:delete.
    logica: arma request https, parsea JSON de respuesta, resuelve {status, body}.
  FN fsPatch(idToken, collection, docId, fields): PATCH a firestore.googleapis.com documents/{collection}/{docId}.
    datos: Firestore REST (escritura con campos tipados {stringValue:...}); Authorization Bearer idToken.
  FN main(): flujo.
    datos: REST: accounts:signUp (crea cuenta temporal), fsPatch sobre users/{ADMIN_UID} con role=admin, email, username=admin; accounts:delete (borra cuenta temporal en finally).
    logica: crea cuenta temporal -> escribe doc admin -> siempre borra la cuenta temporal aunque falle; imprime resultado.
  DATOS: Firebase Auth REST (cuenta temporal efimera) + Firestore REST users/{ADMIN_UID}.
  DEPENDENCIAS: externa https. Sin imports internos.


ARCHIVO: seeds-db/setup-admin-data.js
LINEAS: ~103
OBJETIVO: Crear/actualizar Plan Pro y promover admin (alannicanor62@gmail.com) via Admin SDK usando credencial OAuth de firebase-tools.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (solo set merge sobre plans/pro y users/{uid}).
  REQUIERE: firebase-admin SDK; tokens de firebase-tools.json (refresh_token). Construye credencial authorized_user con client_id/secret publicos del Firebase CLI.
  CONSTANTES: FIREBASE_CLI_CLIENT_ID y FIREBASE_CLI_CLIENT_SECRET (credenciales OAuth publicas del Firebase CLI); ADMIN_EMAIL.
  FN getOrCreateFirebaseUser(email): busca usuario Auth por email.
    datos: Auth Admin: auth.getUserByEmail; retorna null si auth/user-not-found, relanza otros errores.
  FN makeAdmin(email): promueve a admin si la cuenta Auth existe.
    datos: lee users/{uid} (get) y escribe role:'admin', email, updatedAt via set merge.
    logica: si no existe cuenta Auth avisa que el usuario debe loguear con Google primero y retorna null.
  FN seedPlan(): crea/actualiza Plan Pro $100/mes.
    datos: Firestore Admin: plans/pro set merge con nombre, descripcion, precio:100, periodicidad:'mensual', maxAsignaturas:-1, maxAlumnos:-1, activo:true, orden:1, timestamps.
  FN main(): ejecuta seedPlan() y luego makeAdmin(ADMIN_EMAIL); cierra app y exit. En el catch detecta errores de red (getaddrinfo/ENOTFOUND) y sugiere firebase login --reauth.
  DATOS: Firestore plans/pro (set merge) + users/{uid} (get/set merge); Firebase Auth (getUserByEmail).
  DEPENDENCIAS: externas firebase-admin, os, path. Sin imports internos.


ARCHIVO: seeds-db/setup-final.js
LINEAS: ~175
OBJETIVO: Setup "final" via REST: crear Plan Pro $100 y promover admin, usando cuenta Auth temporal y reglas permisivas; sin Service Account.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (escribe plans/pro y users/{adminUid}); crea/borra cuenta temporal.
  REQUIERE: Node + red + API_KEY publica; reglas Firestore TEMPORALMENTE permisivas. Comentario indica restaurar firestore.rules y redeploy despues.
  FN idtPost(endpoint, body, authHeader): POST a identitytoolkit (signUp, accounts:lookup, accounts:delete); soporta header Authorization opcional.
    datos: REST Auth (Identity Toolkit).
  FN fsPatch(urlPath, idToken, body): PATCH generico a firestore.googleapis.com en urlPath dado.
    datos: Firestore REST (escritura).
  FN fsFields(obj): convierte objeto JS a formato tipado de Firestore REST.
    logica: string->stringValue, number entero->integerValue(string)/decimal->doubleValue, boolean->booleanValue.
  FN fsSet(idToken, collection, docId, data): helper que arma URL y hace fsPatch; lanza error si status fuera de 2xx.
    datos: Firestore REST PATCH documents/{collection}/{docId}.
  FN getUidByEmail(idToken, email): obtiene uid via Identity Toolkit accounts:lookup (endpoint projects/{PROJECT_ID}/accounts:lookup con Bearer).
    datos: REST Auth lookup; retorna localId del primer usuario o null.
  FN main(): flujo.
    datos: signUp cuenta temporal; fsSet plans/pro ($100, periodicidad mensual, limites -1, activo, orden 1); getUidByEmail(ADMIN_EMAIL); si existe fsSet users/{adminUid} con role admin/email/username; finally accounts:delete cuenta temporal.
    logica: si no hay cuenta del admin avisa que inicie sesion con Google primero; al final sugiere restaurar reglas y redeploy.
  DATOS: Firebase Auth REST (cuenta temporal + lookup) + Firestore REST plans/pro y users/{adminUid}.
  DEPENDENCIAS: externa https. Sin imports internos.


ARCHIVO: seeds-db/setup-rest.js
LINEAS: ~171
OBJETIVO: Setup via REST igual que setup-final pero autenticando con el refresh_token de firebase-tools (sin cuenta temporal): crea Plan Pro y promueve admin.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (set sobre plans/pro y users/{uid}).
  REQUIERE: Node + red; tokens de firebase-tools.json (refresh_token). Usa CLIENT_ID/CLIENT_SECRET publicos del Firebase CLI para intercambiar refresh_token por access_token. No requiere reglas permisivas porque escribe con un access token real (no cuenta temporal anonima).
  FN request(options, body): wrapper https generico que resuelve {status, body} (JSON parseado o texto).
  FN refreshAccessToken(refreshToken): intercambia refresh_token por access_token en oauth2.googleapis.com/token.
    datos: OAuth Google (grant_type refresh_token); rechaza si json.error.
  FN getUidByEmail(token, email): Identity Toolkit accounts:lookup con Bearer access_token; retorna localId o null.
  FN firestoreValue(val): convierte un valor JS a tipo Firestore (string/integer/boolean/null; fallback a stringValue). Nota: numeros siempre como integerValue (Math.round).
  FN buildFirestoreDoc(obj): mapea objeto completo a {fields:...} usando firestoreValue.
  FN firestoreSet(token, collection, docId, data): PATCH a firestore.googleapis.com documents/{...}; lanza error si status no 2xx.
    datos: Firestore REST (escritura con Bearer access_token).
  FN main(): flujo.
    datos: lee ~/.config/configstore/firebase-tools.json (require) para refresh_token; refreshAccessToken; firestoreSet plans/pro ($100); getUidByEmail(ADMIN_EMAIL) y firestoreSet users/{uid} con role admin/email/username.
    logica: si no hay refresh_token error pidiendo firebase login; si no existe la cuenta del admin avisa loguear con Google primero.
  DATOS: OAuth token exchange + Firebase Auth REST lookup + Firestore REST plans/pro y users/{uid}.
  DEPENDENCIAS: externas https, os, path. Sin imports internos.


ARCHIVO: seeds-db/seed-plans.js
LINEAS: ~67
OBJETIVO: Sembrar (upsert idempotente) los planes de suscripcion por defecto en Firestore via Admin SDK.
EXPORTA: nada (script CLI; npm script "clear" en package.json apunta a clear-db, no a este).
  DESTRUCTIVO: NO (idempotente; usa IDs fijos y set merge).
  REQUIERE: firebase-admin SDK; tokens de firebase-tools.json (refreshToken) o ADC.
  CONSTANTES: DEFAULT_PLANS = [{ id:'pro', nombre:'Plan Pro', descripcion, precio:100, periodicidad:'mensual', maxAsignaturas:-1, maxAlumnos:-1, activo:true, orden:1 }] (solo el plan pro).
  FN main(): upsert de planes.
    datos: Firestore Admin: por cada plan db.collection('plans').doc(id).set({...data, updatedAt, createdAt}, {merge:true}) dentro de un batch; batch.commit().
    logica: separa id del resto; agrega serverTimestamp en updatedAt/createdAt; imprime cada plan; cierra app y exit(0).
  DATOS: Firestore plans/{id} (set merge en batch).
  DEPENDENCIAS: externas firebase-admin, os, path. Sin imports internos.


ARCHIVO: seeds-db/seed-demo.js
LINEAS: ~249
OBJETIVO: Sembrar suscripciones y pagos de demo (para que el dashboard admin tenga datos) sobre docentes ya existentes en Auth, via REST + cuenta temporal.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO en el sentido de borrar, pero CREA muchos documentos demo en subscriptions y payments (no idempotente: cada corrida agrega docs nuevos con addDoc/POST).
  REQUIERE: Node + red + API_KEY publica; reglas Firestore TEMPORALMENTE permisivas. Los UIDs de TEACHERS provienen de un firebase auth:export previo (hardcodeados).
  CONSTANTES: TEACHERS (8 docentes hardcodeados con uid/email/school/name reales del export), TEMP_EMAIL/TEMP_PASS.
  FN randomId(): genera id hex aleatorio (crypto.randomBytes 10). (definido; uso menor.)
  FN daysAgo(n) / daysFrom(n): fechas ISO desplazadas n dias hacia atras/adelante.
  FN idtPost(endpoint, body): POST a Identity Toolkit (signUp/delete de cuenta temporal).
  FN fsPost(idToken, collection, data): POST a firestore.googleapis.com/.../{collection} (crea doc con ID autogenerado).
    datos: Firestore REST (creacion de documento, equivalente addDoc).
  FN fsPatch(idToken, collection, docId, data): PATCH a documents/{collection}/{docId} (upsert por ID).
  FN fsFields(obj): convierte objeto a tipos Firestore; detecta strings ISO de fecha (regex) y los guarda como timestampValue; numeros integer/double; booleanos; null.
  FN createDoc(idToken, collection, data): helper que hace fsPost y devuelve el ID generado; lanza error si status no 2xx.
  FN main(): flujo.
    datos: signUp cuenta temporal; crea 8 docs en subscriptions (escenarios trial/activa/pendiente_pago/vencida con docenteId, planId/planName, escuelaId/schoolName, status, fechaInicio/fechaVencimiento, precio, createdAt/updatedAt); para los escenarios con precio>0 crea docs en payments con status variado (aprobado/pendiente/rechazado), referencia REF aleatoria, banco BBVA, notas, reviewedAt; finally borra cuenta temporal.
    logica: define array scenarios (8); subscriptions una por escenario; payments solo para precio>0; el status del pago se asigna por indice (0 aprobado, 1 pendiente, 2 aprobado, 3 rechazado, resto pendiente).
  DATOS: Firebase Auth REST (cuenta temporal) + Firestore REST subscriptions (crea 8) y payments (crea para los de pago).
  DEPENDENCIAS: externas https, crypto. Sin imports internos.


ARCHIVO: seeds-db/seed-fresh.js
LINEAS: ~311
OBJETIVO: Seed COMPLETO de datos demo (escuelas, docentes con cuentas Auth, asignaturas, alumnos, suscripciones, pagos, Plan Pro y admin) via REST + cuenta temporal.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO borra por si mismo, pero la cabecera indica correr antes "firebase firestore:delete --all-collections -f" (borrado total) y reglas permisivas. CREA cuentas Firebase Auth reales para docentes y alumnos activados (efecto persistente en Auth).
  REQUIERE: Node + red + API_KEY publica; reglas Firestore TEMPORALMENTE permisivas. ADMIN_UID hardcodeado.
  CONSTANTES de datos: SCHOOLS (3: CBTIS 255, CETIS 115, CBTIS 198 con id CCT, shortName, nombre, municipio, estado), TEACHERS (6, password comun 'Evalua2024!', mix verified true/false, cada uno con sub de status trial/activa/vencida/pendiente_pago y fechas), SUBJECTS_BY_TEACHER (2 asignaturas por docente), STUDENTS_BY_TEACHER (3-4 alumnos por docente, mix activado true/false). CICLO='AGO 2024-ENE 2025'.
  FN rnd(n) / ago(days) / from(days) / now(): helpers de id aleatorio (crypto, uppercase) y fechas ISO.
  FN call(hostname, path, method, headers, body): wrapper https generico que resuelve {s:status, b:body}.
  FN idt(ep, body): helper para Identity Toolkit (signUp/update/delete).
  FN fsUrl(col, id): construye path REST de Firestore (con o sin docId).
  FN fsPatch(tok, col, id, fields) / fsPost(tok, col, fields): escritura Firestore REST por ID (PATCH/upsert) o autogenerado (POST/create).
  FN fsF(obj): convierte objeto a tipos Firestore; ISO date -> timestampValue; numeros integer/double; boolean; null.
  FN signUp(email, password): crea cuenta Auth via accounts:signUp; retorna {uid, idToken}; lanza error si falla.
    datos: REST Auth (crea cuentas reales de docentes y alumnos).
  FN setVerified(idToken): marca emailVerified:true via accounts:update.
  FN writeDoc(tok, col, id, data): si hay id hace fsPatch (upsert), si no fsPost (create); lanza error si status>=300; devuelve el id generado.
  FN main(): flujo completo.
    datos:
      - signUp cuenta temporal (tok) para escribir Firestore.
      - plans/pro (writeDoc PATCH) Plan Pro $100.
      - schools/{id} (PATCH) por cada escuela.
      - users/{ADMIN_UID} (PATCH) role admin.
      - Por cada docente: signUp cuenta Auth (uid), setVerified si corresponde; users/{uid} (PATCH) role docente con nombrePropio/nombreMostrar/escuelaId/schoolName; subscriptions (POST) con status/precio/fechas.
      - payments (POST) 1 aprobado para CBTIS198-01 (Ana) y 1 pendiente para CBTIS198-02 (Carlos).
      - Por cada docente: subjects (POST) por asignatura (nombre, docenteId, escuelaId, parciales:3, ciclo, accessCode=rnd(6), archived:false); students (POST) por alumno; para alumnos activado crea cuenta Auth con email fake {username}.{escuelaId}@evalua.local y password 'Alumno2024!', guarda uid; doc student con username/nombre/email/escuelaId/asignaturaId(primera)/docenteId/activado/uid/resetPassword:null.
      - finally: accounts:delete de la cuenta temporal.
    logica: imprime resumen final (conteo docentes/alumnos, passwords demo). Asigna todos los alumnos a la primera asignatura del docente.
  DATOS: Firebase Auth REST (cuenta temporal + docentes + alumnos activados) + Firestore REST plans, schools, users, subscriptions, payments, subjects, students.
  DEPENDENCIAS: externas https, crypto. Sin imports internos.


ARCHIVO: seeds-db/migrate-usernames.js
LINEAS: ~89
OBJETIVO: Migrar usernames de docentes del formato basado en CCT (ej "110020-01") al formato shortName (ej "CBTIS255-01") via Admin SDK.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: PARCIAL — actualiza el campo username de docs users en batch (modifica datos, no borra). Idempotente: si ya coinciden no actualiza.
  REQUIERE: firebase-admin SDK; tokens de firebase-tools.json (refreshToken) o ADC.
  FN buildPrefix(shortName, nombre): genera el prefijo en MAYUSCULAS sin espacios a partir de shortName (o nombre como fallback).
  FN main(): migracion.
    datos: Firestore Admin: lee todas las schools (get); por cada escuela query users where escuelaId==id and role=='docente' (get); batch.update sobre users con nuevo username; batch.commit().
    logica: carga schools en mapa; por escuela calcula prefijo (skip si vacio); ordena docentes por username actual (localeCompare) para conservar orden relativo; asigna {prefix}-{NN} con padStart(2,'0'); solo agrega al batch si cambia; si no hay cambios sale; commitea y termina.
  DATOS: Firestore schools (lectura) + users (lectura por query de igualdad y update en batch del campo username).
  DEPENDENCIAS: externas firebase-admin, os, path. Sin imports internos.


ARCHIVO: seeds-db/change-passwords.js
LINEAS: ~130
OBJETIVO: Cambiar TODAS las contraseñas demo (docentes y alumnos activados) a "123456" y resetear la del admin via REST + token OAuth.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: PARCIAL — cambia contraseñas de cuentas Auth (no borra docs, pero invalida las claves anteriores).
  REQUIERE: Node + red + API_KEY publica para docentes/alumnos (login con clave vieja). Para el admin: token OAuth de firebase-tools (lo lee de /opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js -> getGlobalDefaultAccount). Ruta de firebase-tools hardcodeada (homebrew, macOS).
  CONSTANTES: NEW_PASS='123456'; ADMIN_UID/ADMIN_EMAIL; ACTIVATED_STUDENTS (9, con username+escuelaId para construir email fake); TEACHERS (6 emails). Claves viejas asumidas: docentes 'Evalua2024!', alumnos 'Alumno2024!'.
  FN post(hostname, path, headers, body): wrapper https POST que resuelve {s, b}.
  FN idt(ep, body, extraHeaders): helper Identity Toolkit con API_KEY.
  FN changePasswordViaLogin(email, oldPwd, label): inicia sesion con clave vieja y actualiza a NEW_PASS.
    datos: REST Auth: accounts:signInWithPassword luego accounts:update (password). Retorna true/false segun exito; loguea fallos.
  FN changePasswordAdmin(uid, email, accessToken): cambia la clave del admin usando endpoint privilegiado.
    datos: REST Auth: POST projects/evalua-facil-app/accounts:update con Bearer accessToken, body {localId, password, emailVerified:true}.
  FN getFirebaseAccessToken(): obtiene access_token leyendo el modulo interno de firebase-tools (getGlobalDefaultAccount); retorna null si falla.
  FN main(): cambia claves de docentes (login), luego alumnos activados (login con email fake construido), luego admin (via OAuth si hay token; si no, instruye cambio manual en Firebase Console).
  DATOS: Firebase Auth REST exclusivamente (signIn + update password). No toca Firestore.
  DEPENDENCIAS: externa https + modulo interno de firebase-tools (auth.js) por ruta absoluta. Sin imports internos del proyecto.


ARCHIVO: seeds-db/fix-alan-data.js
LINEAS: ~97
OBJETIVO: Corregir el perfil de Alan Daniel cambiando su escuela de ITCELAYA a CBTIS 255 (cct 11DCT0020A) y crear/actualizar el doc de esa escuela, via REST + cuenta temporal.
EXPORTA: nada (script CLI puntual / one-off).
  DESTRUCTIVO: NO (PATCH sobre users/{ALAN_UID} y schools/{cct}); crea/borra cuenta temporal.
  REQUIERE: Node + red + API_KEY publica; reglas Firestore TEMPORALMENTE permisivas (allow write if auth != null). ALAN_UID hardcodeado (DV9X0bLR2YYtlhRFa5XCoITL5vv2).
  CONSTANTES: ALAN_UID, SCHOOL_CCT='11DCT0020A', SCHOOL_SHORT='CBTIS 255', TEMP_EMAIL/TEMP_PASS.
  FN idtPost(endpoint, body): POST a Identity Toolkit (signUp/delete cuenta temporal).
  FN fsPatch(idToken, collection, docId, fields): PATCH Firestore REST con campos ya tipados.
  FN main(): flujo.
    datos: signUp cuenta temporal; fsPatch users/{ALAN_UID} (escuelaId=CCT, schoolName=CBTIS 255); fsPatch schools/{CCT} (claveSEP, shortName, nombre largo, municipio TARIMORO, estado GUANAJUATO); finally accounts:delete.
    logica: lanza error si algun PATCH retorna >=300; recuerda restaurar firestore.rules al final.
  DATOS: Firebase Auth REST (cuenta temporal) + Firestore REST users/{ALAN_UID} y schools/{CCT}.
  DEPENDENCIAS: externa https. Sin imports internos.


ARCHIVO: seeds-db/update-email-template.js
LINEAS: ~159
OBJETIVO: Actualizar la plantilla HTML del correo de verificacion de Firebase Auth (verifyEmail) con un diseño personalizado de Evalúa Fácil, via Identity Platform Admin REST.
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (modifica configuracion del proyecto Auth, no datos de Firestore).
  REQUIERE: token OAuth de firebase-tools (getGlobalDefaultAccount desde /opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js — ruta homebrew hardcodeada). Llama al Admin v2 config endpoint, que requiere permisos de admin del proyecto.
  CONSTANTES: PROJECT_ID; HTML_BODY (plantilla completa de correo con placeholders %DISPLAY_NAME% y %LINK%, branding azul EF).
  FN getAccessToken(): obtiene access_token de firebase-tools; sale(1) si no lo encuentra.
  FN apiRequest(method, urlPath, token, body): wrapper https contra identitytoolkit.googleapis.com con Bearer token; resuelve {status, body}.
  FN main(): construye updateMask (subject, body, bodyFormat, senderDisplayName de notification.sendEmail.verifyEmail); hace PATCH a /admin/v2/projects/{PROJECT_ID}/config?updateMask=... con subject, senderDisplayName 'Evalúa Fácil', bodyFormat 'HTML' y body=HTML_BODY; imprime exito o el error con cuerpo.
  DATOS: No toca Firestore. Modifica la configuracion de Identity Platform / Firebase Auth (plantilla de email de verificacion) via REST Admin v2.
  DEPENDENCIAS: externa https + modulo interno de firebase-tools (auth.js) por ruta absoluta. Sin imports internos del proyecto.


ARCHIVO: seeds-db/verify.js
LINEAS: ~31
OBJETIVO: Verificar el estado de la BD imprimiendo el conteo de documentos por coleccion (utilidad de chequeo, no destructiva).
EXPORTA: nada (script CLI).
  DESTRUCTIVO: NO (solo lecturas/conteos).
  REQUIERE: firebase-admin SDK; credenciales ADC (initializeApp solo con projectId, sin credencial explicita).
  CONSTANTES: COLLECTIONS = ['users','students','subjects','activities','submissions','schools'].
  FN verify(): por cada coleccion hace limit(1).get() (chequeo de existencia) y count().get() (conteo agregado); imprime "{coleccion} : N documents"; suma total y muestra el gran total; cierra app admin.
    datos: Firestore Admin: collection(col).limit(1).get() y collection(col).count().get() (lectura/aggregation count).
  DATOS: Firestore (Admin SDK) — solo lecturas de conteo sobre las 6 colecciones listadas.
  DEPENDENCIAS: externa firebase-admin. Sin imports internos.


ARCHIVO: seeds-db/package.json
LINEAS: ~13
OBJETIVO: Manifiesto npm del directorio seeds-db; declara la dependencia firebase-admin y un script de conveniencia.
EXPORTA: configuracion npm (no codigo).
  CONTENIDO: name "evalua-facil-seeds", version 1.0.0, main "clear-db.js".
  SCRIPTS: "clear": "node clear-db.js" (unico script npm; el resto se corren con node <archivo> directamente).
  DEPENDENCIAS: firebase-admin ^12.0.0 (unica dependencia declarada). Nota: los scripts REST (set-admin, setup-final, seed-demo, seed-fresh, fix-alan-data, change-passwords, update-email-template) solo usan modulos nativos (https, crypto, os, path) y no requieren esta dependencia.
  DATOS: n/a.
  DEPENDENCIAS: n/a (archivo de configuracion).


ARCHIVO: seeds-db/README.md
LINEAS: ~55
OBJETIVO: Documentacion humana del proposito de los scripts de limpieza de BD (enfocado en clear-db) con advertencias y modos de uso.
EXPORTA: documentacion (markdown).
  CONTENIDO: describe que borra TODAS las colecciones (users, students, groups, subjects, activities, submissions, schools); dos opciones de uso: (1) Firebase CLI con bash clear-db-firebase-cli.sh (requiere firebase-cli + firebase login), (2) Node + Admin SDK con npm install && node clear-db.js (requiere credenciales Admin SDK / Service Account). Advierte DESTRUCTIVO sin undo, pide confirmacion "yes". Indica cuando usar (testing, reset, pruebas de flujo) y que tras limpiar la app sigue funcionando. Creado 2026-06-12. (No documenta los scripts de seed/admin/migracion; esta desfasado respecto al contenido real del directorio.)
  DATOS: n/a.
  DEPENDENCIAS: n/a (documentacion).


RESUMEN DE COLECCIONES FIRESTORE TOCADAS EN EL DIRECTORIO:
  users        — clear-db (borra), verify (conteo), create-admin/setup-admin-data/set-admin/setup-final/setup-rest/seed-fresh (escribe role), migrate-usernames (update username), fix-alan-data (PATCH escuela).
  students     — clear-db (borra), verify (conteo), seed-fresh (crea).
  subjects     — clear-db (borra), verify (conteo), seed-fresh (crea).
  activities   — clear-db (borra), verify (conteo).
  submissions  — clear-db (borra), verify (conteo).
  schools      — clear-db (borra), verify (conteo), seed-fresh (crea), fix-alan-data (PATCH), migrate-usernames (lee).
  groups       — solo borrado por los scripts bash (clear-db-firebase-cli.sh, clear-all.sh); coleccion legacy, no usada por la app actual.
  attendance   — solo borrado por clear-all.sh.
  plans        — seed-plans, setup-admin-data, setup-final, setup-rest, seed-fresh (crea/upsert Plan Pro).
  subscriptions— seed-demo (crea 8), seed-fresh (crea por docente).
  payments     — seed-demo (crea varios), seed-fresh (crea 2).

CONFIGURACION DE AUTH/EMAIL (no Firestore):
  update-email-template.js — modifica la plantilla del correo de verificacion (Identity Platform Admin v2 config).
  change-passwords.js      — modifica contraseñas de cuentas Firebase Auth.


===== MODELO DE DATOS (Firestore) =====

NOTA_GENERAL:
  Backend: Firebase Firestore (sin Storage activo para datos; storage.rules existe pero el codigo
    sube archivos a Cloudinary, no a Firebase Storage). Sin Cloud Functions.
  Toda escritura desde el cliente (src/) usa el SDK web firebase/firestore.
  Escrituras desde el servidor (api/) usan firebase-admin (api/_lib/firebaseAdmin.js) y saltan las reglas.
  Tipos "inferidos": deducidos de los sitios de escritura en el codigo; cuando no es claro se marca (no determinado).

RESTRICCION_DE_QUERIES (critica):
  Solo se permiten filtros de igualdad: where(campo, "==", valor) y where(campo, "in", [valores]).
  PROHIBIDO en queries: operadores de rango (<, >, <=, >=, !=), y orderBy.
  El ordenamiento se hace en memoria (Array.sort) tras getDocs.
  where(..., "in", ...) acepta como maximo 10 valores; el codigo trocea ids en grupos (chunks)
    cuando puede haber mas de 10 (ej. src/utils/deleteSubjectCascade.js, src/pages/teacher/SubjectPage.jsx,
    src/pages/student/Dashboard.jsx).
  Los indices compuestos desplegados estan en firestore.indexes.json; no agregar indices multi-campo
    sin desplegarlos primero (firebase deploy --only firestore).

INDICES_COMPUESTOS_DESPLEGADOS (firestore.indexes.json):
  students:      (escuelaId ASC, username ASC)
  students:      (asignaturaId ASC, username ASC)
  submissions:   (actividadId ASC, alumnoId ASC)
  activities:    (asignaturaId ASC, parcial ASC)
  subscriptions: (docenteId ASC, status ASC)
  payments:      (docenteId ASC, status ASC)
  fieldOverrides: (vacio)

REGLAS_HELPERS (firestore.rules):
  isAdmin():   request.auth != null AND users/{uid}.role == 'admin'
  isDocente(): request.auth != null AND users/{uid}.role == 'docente'

-------------------------------------------------------------------------------
COLECCION: schools
  PROPOSITO:
    Catalogo de escuelas/planteles SEP. Se crea el doc al registrarse el primer docente de esa escuela.
    Existe un doc sentinela con id fijo "sin-escuela" para docentes sin plantel real.
  ID_DOC:
    autogenerado (doc(collection(db,'schools'))) para escuelas reales/custom; id fijo "sin-escuela" para el sentinela.
  CAMPOS (tipo inferido):
    nombre: string  (nombre completo del plantel)
    shortName: string  (nombre corto; usado para generar usernames de docentes)
    claveSEP: string  (CCT del plantel; solo escuelas del catalogo)
    subsistema: string  (solo escuelas del catalogo; ej. CBTIS/CETIS)
    municipio: string  (solo catalogo)
    estado: string  (solo catalogo)
    custom: boolean true  (escuela agregada manualmente, fuera del catalogo)
    sinEscuela: boolean true  (solo en el doc "sin-escuela")
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if request.auth != null  (autenticado)
    create: if request.auth != null
    update: if request.auth != null
    delete: (no permitido; no hay regla delete)
  LECTURA_PUBLICA: NO (requiere autenticacion).
  RELACIONES (FKs logicas por id):
    users.escuelaId -> schools/{id}
    students.escuelaId -> schools/{id}
    subjects.escuelaId -> schools/{id}
    subscriptions.escuelaId / payments.escuelaId -> schools/{id}
  INDICES_COMPUESTOS: (ninguno)
  SE_ESCRIBE_EN:
    src/pages/teacher/Register.jsx (setDoc create / merge 'sin-escuela')
    src/pages/teacher/RegisterSchool.jsx (create)
    src/pages/teacher/Profile.jsx (create + merge 'sin-escuela')
  SE_LEE_EN:
    src/context/AuthContext.jsx (getDoc por escuelaId para enriquecer perfil)
    Register/RegisterSchool/Profile (query por nombre o claveSEP para evitar duplicados)
    src/hooks/useAdminStats.js (getDocs total)

-------------------------------------------------------------------------------
COLECCION: users
  PROPOSITO:
    Perfiles de docentes y administradores. Tambien recibe un doc por ALUMNO al activarse
    (role 'alumno'), aunque el dato principal del alumno vive en students.
  ID_DOC:
    = uid de Firebase Auth (doc id == auth.uid).
  CAMPOS (tipo inferido):
    role: string enum  ('docente' | 'admin' | 'alumno')
    username: string  (docente: SHORT-## ; alumno: codigo de 4 chars)
    email: string  (real para docente/admin; ausente para alumno)
    escuelaId: string  (FK -> schools)
    schoolName: string  (denormalizado; docentes)
    photoURL: string|null  (docentes; foto Cloudinary)
    nombreMostrar: string  (docente; nombre visible editable en Perfil)
    cuentaActivada: boolean  (docente; marcada al verificar correo via VerifyEmail)
    verifyToken: string|null  (docente; token de verificacion, se limpia a null al verificar)
    studentId: string  (solo role 'alumno'; FK -> students/{id})
    nombre, apellidoPaterno, apellidoMaterno: string  (solo role 'alumno')
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if true  (LECTURA PUBLICA total; necesaria para login por username y activacion)
    create: if request.auth.uid == userId AND request.resource.data.role == 'docente'
            (solo puedes crear TU propio doc y solo como docente; admin se asigna manualmente)
    update: if isAdmin() OR (request.auth.uid == userId AND no cambia el role)
    delete: if isAdmin()
  LECTURA_PUBLICA: SI (read: if true).
  RELACIONES (FKs logicas por id):
    users.uid (doc id) <- subjects.docenteId, activities.docenteId, subscriptions.docenteId,
                          payments.docenteId, students.uid (alumno activado)
    users.escuelaId -> schools/{id}
    users.studentId -> students/{id} (solo alumno)
  INDICES_COMPUESTOS: (ninguno; queries por un solo campo: username, escuelaId)
  SE_ESCRIBE_EN:
    src/pages/teacher/Register.jsx (setDoc create docente)
    src/pages/teacher/RegisterSchool.jsx (setDoc create docente con Google)
    src/pages/student/Activation.jsx (setDoc merge role 'alumno')
    src/pages/student/Login.jsx (setDoc, alta de doc alumno si falta)
    src/pages/teacher/Profile.jsx (updateDoc: photoURL, nombreMostrar, escuelaId/schoolName)
    src/pages/teacher/VerifyEmail.jsx (updateDoc: cuentaActivada, verifyToken)
    src/context/AuthContext.jsx (updateDoc: migracion de username legado)
  SE_LEE_EN:
    src/context/AuthContext.jsx (getDoc del perfil al loguear)
    src/pages/teacher/Login.jsx (query where username == input)
    src/pages/student/Dashboard.jsx (getDoc de docentes por id)
    src/hooks/useAdminStats.js (getDocs total)

-------------------------------------------------------------------------------
COLECCION: students
  PROPOSITO:
    Registro de cada alumno DENTRO de una asignatura. Un mismo alumno en varias materias
    son varios docs students con el mismo uid (ver memory: multi-materia). Lectura publica
    para permitir activacion por QR/codigo.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    apellidoPaterno: string
    apellidoMaterno: string
    nombre: string
    username: string  (codigo de 4 chars derivado de iniciales; unico por escuela)
    resetPassword: string|null  (contrasena temporal de 4 chars; null tras activar/login)
    escuelaId: string  (FK -> schools)
    asignaturaId: string  (FK -> subjects)
    activado: boolean  (false hasta primera activacion; se pone false en reset de contrasena)
    uid: string  (FK -> auth/users; se asigna al activar la cuenta Firebase Auth)
    orden: number  (posicion en la lista del grupo; reindexado en batch al borrar/reordenar)
    createdAt: serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if true  (LECTURA PUBLICA total; necesaria para QR/activacion)
    create: if request.auth != null
    update: if request.auth != null
    delete: if request.auth != null
  LECTURA_PUBLICA: SI (read: if true).
  RELACIONES (FKs logicas por id):
    students.escuelaId -> schools/{id}
    students.asignaturaId -> subjects/{id}
    students.uid -> auth uid (== users/{uid} role 'alumno')
    students.id <- submissions.alumnoId (ojo: submissions.alumnoId guarda el id del DOC student,
                   no el uid; ver detalle en submissions)
  INDICES_COMPUESTOS:
    (escuelaId ASC, username ASC)
    (asignaturaId ASC, username ASC)
  SE_ESCRIBE_EN:
    src/pages/teacher/SubjectPage.jsx (addDoc alta manual; writeBatch import Excel; updateDoc reset
      contrasena; deleteDoc + reindex orden; batch reset masivo activado/resetPassword)
    src/utils/copySubject.js (writeBatch copia de alumnos a nueva materia)
    src/utils/deleteSubjectCascade.js (delete en cascada)
    src/pages/student/Activation.jsx (updateDoc: activado, uid, resetPassword)
    src/pages/student/Login.jsx (updateDoc: activado, uid, resetPassword null)
  SE_LEE_EN:
    src/context/AuthContext.jsx (query username), src/utils/studentLookup.js (query uid/username, getDoc id)
    src/pages/student/Login.jsx, src/pages/teacher/SubjectPage.jsx (query asignaturaId / escuelaId),
    src/pages/teacher/ActivityPage.jsx (query asignaturaId), src/hooks/useAdminStats.js (getDocs total)

-------------------------------------------------------------------------------
COLECCION: subjects
  PROPOSITO:
    Asignaturas (materias) creadas por un docente. Lectura publica para activacion por QR/codigo.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    nombre: string
    grupo: string
    docenteId: string  (FK -> users/auth uid; dueno)
    escuelaId: string  (FK -> schools)
    parciales: number  (cantidad de parciales; default 3)
    fechaInicio: string  (formato fecha 'YYYY-MM-DD' o '' ; opcional)
    fechaFin: string  ('' opcional)
    colorPalette: string  (tema de color; default 'default')
    icon: string  (icono; default 'book')
    accessCode: string  (codigo de acceso para QR/activacion de alumnos; regenerable)
    archived: boolean  (archivada; default false)
    createdAt: serverTimestamp
    NOTA: en CLAUDE.md se mencionan parciales/ciclo; en el codigo actual se usan parciales,
      fechaInicio/fechaFin (no 'ciclo'). 'ciclo' (no determinado en el codigo vigente).
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if true  (LECTURA PUBLICA total; necesaria para QR/activacion)
    create: if request.auth != null
    update: if request.auth != null AND request.auth.uid == resource.data.docenteId
    delete: if request.auth != null AND request.auth.uid == resource.data.docenteId
  LECTURA_PUBLICA: SI (read: if true).
  RELACIONES (FKs logicas por id):
    subjects.docenteId -> users/{uid}
    subjects.escuelaId -> schools/{id}
    subjects.id <- activities.asignaturaId, students.asignaturaId
  INDICES_COMPUESTOS: (ninguno; queries por docenteId o accessCode, un solo campo)
  SE_ESCRIBE_EN:
    src/pages/teacher/Dashboard.jsx (addDoc create)
    src/utils/copySubject.js (addDoc duplicar materia)
    src/pages/teacher/SubjectPage.jsx (updateDoc: accessCode, archived, edicion campos, restaurar)
    src/utils/deleteSubjectCascade.js (deleteDoc)
  SE_LEE_EN:
    src/components/Layout.jsx (query docenteId, lista lateral)
    src/pages/teacher/Dashboard.jsx (query docenteId)
    src/pages/teacher/SubjectPage.jsx / ActivityPage.jsx (getDoc por id)
    src/pages/student/Activation.jsx (query accessCode), src/pages/student/Dashboard.jsx (getDoc id),
    src/hooks/useAdminStats.js (getDocs total)

-------------------------------------------------------------------------------
COLECCION: activities
  PROPOSITO:
    Actividades/tareas de una asignatura, agrupadas por parcial. Entregables por los alumnos.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    nombre: string
    maxCalif: number  (calificacion maxima; default 10)
    instrucciones: string
    fechaLimite: string|null  (fecha limite 'YYYY-MM-DD' o null)
    tiposArchivo: string  (tipo de archivo permitido; default 'imagenes'/DEFAULT_FILE_TYPE)
    extensionesCustom: string  (extensiones propias cuando tiposArchivo == 'Personalizado'/CUSTOM_FILE_TYPE)
    tipo: string  ('archivo')
    parcial: number  (a que parcial pertenece)
    asignaturaId: string  (FK -> subjects)
    docenteId: string  (FK -> users/auth uid; dueno)
    oculta: boolean  (oculta para alumnos)
    publishAt: string|null  (fecha programada de publicacion; null si no aplica)
    extensiones: map  (mapa { studentDocId: 'YYYY-MM-DD' } con prorrogas por alumno;
                       se escribe con campo anidado extensiones.{studentId})
    createdAt: serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if request.auth != null  (autenticado; NO publica)
    create: if request.auth != null
    update: if request.auth != null AND request.auth.uid == resource.data.docenteId
    delete: if request.auth != null AND request.auth.uid == resource.data.docenteId
  LECTURA_PUBLICA: NO.
  RELACIONES (FKs logicas por id):
    activities.asignaturaId -> subjects/{id}
    activities.docenteId -> users/{uid}
    activities.id <- submissions.actividadId
  INDICES_COMPUESTOS:
    (asignaturaId ASC, parcial ASC)
  SE_ESCRIBE_EN:
    src/pages/teacher/SubjectPage.jsx (addDoc create; updateDoc editar; deleteDoc; batch oculta/publishAt)
    src/pages/teacher/ActivityPage.jsx (updateDoc: extensiones.{studentId})
    src/utils/copySubject.js (writeBatch copia)
    src/utils/deleteSubjectCascade.js (delete en cascada)
  SE_LEE_EN:
    src/pages/teacher/SubjectPage.jsx / ActivityPage.jsx, src/pages/student/SubjectPage.jsx,
    src/pages/student/Dashboard.jsx (query asignaturaId / asignaturaId in [...]),
    src/pages/student/ActivityPage.jsx (onSnapshot + getDoc por id),
    src/hooks (indirecto). Borrado lee via where actividadId in chunks.

-------------------------------------------------------------------------------
COLECCION: submissions
  PROPOSITO:
    Entregas de alumnos por actividad: archivo o "completado sin archivo", con calificacion y comentario.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    alumnoId: string  (FK -> students/{id} DOC id; ver nota en regla delete que compara con auth.uid)
    actividadId: string  (FK -> activities/{id})
    archivoURL: string|null  (URL Cloudinary del archivo entregado)
    nombreArchivo: string|null
    completadoSinArchivo: boolean
    fechaEntrega: serverTimestamp
    calificacion: number|null
    comentario: string
    estado: string enum  ('entregado' | 'calificado')
    historial: array  (entradas de versiones previas; arrayUnion al reenviar)
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if request.auth != null
    create: if request.auth != null
    update: if request.auth != null
    delete: if request.auth != null AND (
              auth.uid == activities/{resource.data.actividadId}.docenteId  (docente dueno)
              OR resource.data.alumnoId == auth.uid  (el alumno que entrego)
            )
            NOTA: la regla compara alumnoId con auth.uid, pero el codigo escribe alumnoId = student.id
              (id del doc students), que puede NO coincidir con el uid. (posible inconsistencia, no determinado
              si en algun flujo alumnoId guarda uid).
  LECTURA_PUBLICA: NO.
  RELACIONES (FKs logicas por id):
    submissions.alumnoId -> students/{id}
    submissions.actividadId -> activities/{id}
  INDICES_COMPUESTOS:
    (actividadId ASC, alumnoId ASC)
  SE_ESCRIBE_EN:
    src/pages/student/ActivityPage.jsx (addDoc entregar; updateDoc reenviar/marcar completado)
    src/pages/teacher/ActivityPage.jsx (updateDoc: calificacion, comentario, estado 'calificado')
    src/utils/deleteSubjectCascade.js (delete en cascada via where actividadId in chunks)
  SE_LEE_EN:
    src/pages/teacher/SubjectPage.jsx (where actividadId in [...]), src/pages/teacher/ActivityPage.jsx
      (where actividadId), src/pages/student/SubjectPage.jsx (where alumnoId), src/pages/student/Dashboard.jsx
      (where alumnoId in [...]), src/pages/student/ActivityPage.jsx, src/hooks/useAdminStats.js (no; ver hook)

-------------------------------------------------------------------------------
COLECCION: plans
  PROPOSITO:
    Catalogo de planes de suscripcion (precio, limites). Gestionado solo por admin.
    El precio SIEMPRE se lee del servidor (api/_lib/billing.js getPlan) para evitar manipulacion del cliente.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    nombre: string
    descripcion: string
    precio: number
    periodicidad: string enum  ('mensual' | 'anual')
    maxAsignaturas: number  (-1 = ilimitado)
    maxAlumnos: number  (-1 = ilimitado)
    activo: boolean  (visible/seleccionable)
    orden: number
    createdAt: serverTimestamp
    updatedAt: serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if request.auth != null
    create: if isAdmin()
    update: if isAdmin()
    delete: if isAdmin()
  LECTURA_PUBLICA: NO (autenticado).
  RELACIONES (FKs logicas por id):
    plans.id <- subscriptions.planId, payments.planId
  INDICES_COMPUESTOS: (ninguno; query where activo == true, un solo campo)
  SE_ESCRIBE_EN:
    src/pages/admin/components/PlansManager.jsx (addDoc create; updateDoc; deleteDoc)
  SE_LEE_EN:
    src/hooks/useSubscription.js (query activo == true), src/hooks/useAdminStats.js (getDocs total),
    api/_lib/billing.js getPlan (admin SDK, doc por id)

-------------------------------------------------------------------------------
COLECCION: subscriptions
  PROPOSITO:
    Suscripcion de cada docente a un plan: estado, vigencia (trial / pago / activa / cancelada).
    Trial de 45 dias se crea al registrarse el docente.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    docenteId: string  (FK -> users/auth uid)
    planId: string  (FK -> plans; '' mientras en trial)
    escuelaId: string  (FK -> schools)
    schoolName: string  (denormalizado)
    status: string enum  ('trial' | 'pendiente_pago' | 'activa' | 'cancelada')
    fechaInicio: Timestamp
    fechaVencimiento: Timestamp
    createdAt: Timestamp / serverTimestamp
    updatedAt: Timestamp / serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if auth != null AND (isAdmin() OR resource.data.docenteId == auth.uid)
    create: if isAdmin() OR (isDocente() AND request.resource.data.docenteId == auth.uid
                            AND status in ['pendiente_pago','trial'])
    update: if isAdmin() OR (isDocente() AND resource.data.docenteId == auth.uid
                            AND no cambia docenteId AND request.resource.data.status == 'pendiente_pago')
            (un docente solo puede dejar su sub en 'pendiente_pago'; activarla la hace admin o el servidor)
    delete: if isAdmin()
  LECTURA_PUBLICA: NO.
  RELACIONES (FKs logicas por id):
    subscriptions.docenteId -> users/{uid}
    subscriptions.planId -> plans/{id}
    subscriptions.escuelaId -> schools/{id}
    subscriptions.id <- payments.subscriptionId
  INDICES_COMPUESTOS:
    (docenteId ASC, status ASC)
  SE_ESCRIBE_EN:
    src/pages/teacher/Register.jsx (addDoc trial al registrarse)
    src/components/CheckoutModal.jsx y PaymentSimulationModal.jsx (addDoc/updateDoc -> 'pendiente_pago')
    src/pages/admin/components/SubscriptionsTable.jsx (addDoc; updateDoc; cancelar; deleteDoc)
    src/pages/admin/components/PaymentsTable.jsx (updateDoc -> 'activa' al aprobar pago)
    api/_lib/billing.js startPayment/completePayment (admin SDK: crea/reusa y activa)
  SE_LEE_EN:
    src/hooks/useSubscription.js (query docenteId), src/hooks/useAdminStats.js (getDocs total),
    api/_lib/billing.js (where docenteId)

-------------------------------------------------------------------------------
COLECCION: payments
  PROPOSITO:
    Registro de cada intento/movimiento de pago (transferencia, MercadoPago, PayPal).
    El admin aprueba/rechaza transferencias; las pasarelas confirman via servidor.
  ID_DOC:
    autogenerado.
  CAMPOS (tipo inferido):
    docenteId: string  (FK -> users/auth uid)
    subscriptionId: string  (FK -> subscriptions)
    planId: string  (FK -> plans)
    escuelaId: string  (FK -> schools)
    monto: number  (= plan.precio al crear)
    metodo: string enum  ('transferencia' | mp/paypal segun flujo)
    referencia: string  (referencia de transferencia; solo metodo transferencia)
    status: string enum  ('pendiente' | 'completado' | 'rechazado')
    notasAdmin: string  (al rechazar)
    gateway: map  (datos crudos de la pasarela; lo escribe el servidor al completar)
    createdAt: serverTimestamp
    updatedAt: serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules):
    read:   if auth != null AND (isAdmin() OR resource.data.docenteId == auth.uid)
    create: if isAdmin() OR (isDocente() AND request.resource.data.docenteId == auth.uid
                            AND status == 'pendiente')
    update: if isAdmin()  (solo admin; o el servidor via admin SDK)
    delete: if isAdmin()
  LECTURA_PUBLICA: NO.
  RELACIONES (FKs logicas por id):
    payments.docenteId -> users/{uid}
    payments.subscriptionId -> subscriptions/{id}
    payments.planId -> plans/{id}
    payments.escuelaId -> schools/{id}
  INDICES_COMPUESTOS:
    (docenteId ASC, status ASC)
  SE_ESCRIBE_EN:
    src/components/CheckoutModal.jsx y PaymentSimulationModal.jsx (addDoc 'pendiente')
    src/pages/admin/components/PaymentsTable.jsx (updateDoc: aprobar -> 'completado'; rechazar -> 'rechazado' + notasAdmin)
    api/_lib/billing.js startPayment (add 'pendiente') / completePayment (update 'completado' + gateway)
  SE_LEE_EN:
    src/hooks/useSubscription.js (query docenteId), src/hooks/useAdminStats.js (getDocs total),
    api/_lib/billing.js completePayment (doc por id)

-------------------------------------------------------------------------------
COLECCION: config   (doc unico id: "payments")
  PROPOSITO:
    Configuracion PUBLICA de pagos para mostrar en la UI: moneda, claves PUBLICAS de pasarela,
    datos bancarios para transferencia. Los SECRETOS (access token MP, client secret PayPal) viven
    en variables de entorno de Vercel, NUNCA aqui.
  ID_DOC:
    fijo: "payments" (config/payments). En el codigo CONFIG_REF = ['config','payments'].
  CAMPOS (tipo inferido):
    moneda: string  (default 'MXN')
    mercadoPago: map { enabled: boolean, publicKey: string }
    paypal: map { enabled: boolean, clientId: string }
    transferencia: map { enabled: boolean, banco, titular, cuenta, clabe, nota: string }
    updatedAt: serverTimestamp
  REGLAS_DE_ACCESO (firestore.rules, match /config/{docId}):
    read:  if true  (LECTURA PUBLICA total)
    write: if isAdmin()
  LECTURA_PUBLICA: SI (read: if true).
  RELACIONES: (ninguna; doc de configuracion singleton)
  INDICES_COMPUESTOS: (ninguno)
  SE_ESCRIBE_EN:
    src/pages/admin/components/PaymentConfig.jsx (setDoc config/payments)
  SE_LEE_EN:
    src/hooks/usePaymentConfig.js (getDoc config/payments; default DEFAULT_PAYMENT_CONFIG si no existe)

-------------------------------------------------------------------------------
COLECCION: attendance  (declarada en CLAUDE.md)
  ESTADO: (no determinado / probablemente no usada en el codigo actual)
  Grep en src/ y api/ no encontro ninguna referencia a la coleccion 'attendance' ni operaciones sobre ella.
  No aparece en firestore.rules (sin match) ni en firestore.indexes.json.
  CLAUDE.md la lista con campos (asignaturaId, docenteId, fecha) pero el codigo vigente no la lee ni escribe.
  Sin match en reglas: bajo Firestore con reglas por defecto deny, lecturas/escrituras a esta coleccion
    estarian DENEGADAS desde el cliente. (no determinado: posible feature retirada o planeada).

-------------------------------------------------------------------------------
STORAGE (storage.rules)
  PROPOSITO_DECLARADO: ruta submissions/{activityId}/{alumnoId}/{fileName} para archivos de entregas.
  REGLAS:
    read:  if request.auth != null
    write: if request.auth != null
           AND request.resource.size < 10 MB
           AND contentType matches (application/pdf | application/msword | openxmlformats* | image/jpeg | image/png)
  NOTA_IMPORTANTE:
    El codigo de la app sube archivos a Cloudinary (submissions.archivoURL es URL Cloudinary), NO a Firebase
    Storage. CLAUDE.md indica "no Storage". Estas reglas existen pero (no determinado si Firebase Storage
    esta realmente en uso en produccion).

-------------------------------------------------------------------------------
RESUMEN_RELACIONES (FKs logicas, por id):
  schools(id) <- users.escuelaId, students.escuelaId, subjects.escuelaId, subscriptions.escuelaId, payments.escuelaId
  users(uid)  <- subjects.docenteId, activities.docenteId, subscriptions.docenteId, payments.docenteId, students.uid
  users(uid)  -> users.studentId -> students(id)  (caso alumno)
  subjects(id) <- activities.asignaturaId, students.asignaturaId
  activities(id) <- submissions.actividadId
  students(id) <- submissions.alumnoId
  plans(id) <- subscriptions.planId, payments.planId
  subscriptions(id) <- payments.subscriptionId
  config/payments: singleton, sin relaciones.

RESUMEN_LECTURAS_PUBLICAS (read: if true):
  users, students, subjects, config/payments.
RESUMEN_LECTURAS_AUTENTICADAS (read: if auth != null, posiblemente con dueno/admin):
  schools, activities, submissions, plans (autenticado), subscriptions (admin o dueno), payments (admin o dueno).


===== DIAGRAMA DE CASOS DE USO (texto plano para IA) =====

ALCANCE Y FUENTE
  Fuente principal de rutas y guards: src/App.jsx.
  Acciones por rol derivadas de las paginas: src/pages/teacher/*, src/pages/student/*,
    src/pages/admin/* y componentes (CheckoutModal) + backend api/* (pagos).
  Notacion:
    "Actor --> Caso de uso" indica que el actor ejecuta/inicia ese caso de uso.
    "Caso A --> [include] Caso B" indica inclusion obligatoria (B siempre ocurre dentro de A).
    "Caso A --> [extend] Caso B" indica extension condicional (B ocurre solo si se cumple una condicion).
    "Caso --> (Sistema externo)" indica que el caso depende de un sistema externo.

-------------------------------------------------------------------------------
ACTORES
-------------------------------------------------------------------------------

  Actor primario: Docente
    descripcion: usuario con cuenta real (users/{uid}, role 'docente'); gestiona asignaturas,
      actividades, alumnos, calificaciones y su propia suscripcion/pago.
    rutas protegidas: ProtectedTeacher -> /dashboard, /subject/:subjectId, /activity/:activityId, /profile.
    rutas publicas que usa: / (Landing), /docente (login), /register, /register/school (alta Google),
      /verify-email, /pago-resultado.

  Actor primario: Alumno
    descripcion: usuario sin correo real (students/{id} + users/{uid} role 'alumno'); email sintetico
      {username}.{escuelaId}@evalua.local. Multi-materia: una inscripcion por asignatura, mismo uid.
    rutas protegidas: ProtectedStudent -> /alumno/dashboard, /alumno/materia/:subjectId, /alumno/actividad/:activityId.
    rutas publicas que usa: /alumno (login/activacion inline), /activate/:accessCode (activacion por codigo/QR).

  Actor primario: Administrador
    descripcion: usuario con cuenta real (users/{uid}, role 'admin'); panel de administracion global.
    rutas protegidas: ProtectedAdmin -> /Admin (AdminDashboard con pestanas).

  Actor de soporte / sistema externo: Firebase Auth
    rol: autenticacion (signIn, createUser, updatePassword, reauth, linkWithCredential, signOut)
      y verificacion de ID token en el backend (Admin SDK verifyIdToken).

  Actor de soporte / sistema externo: Cloud Firestore
    rol: base de datos (colecciones users, students, subjects, activities, submissions, schools,
      subscriptions, payments, plans, config/payments). Toda lectura/escritura de datos.

  Actor de soporte / sistema externo: Cloudinary
    rol: almacenamiento de archivos (avatar del docente y archivos de entrega del alumno).

  Actor de soporte / sistema externo: EmailJS
    rol: envio del correo de bienvenida al docente tras el registro (best-effort).

  Actor de soporte / sistema externo: MercadoPago
    rol: pasarela de pago (Checkout Preference + webhook server-to-server).

  Actor de soporte / sistema externo: PayPal
    rol: pasarela de pago (orden CAPTURE + captura desde el cliente).

  Nota sobre el Administrador como actor de los pagos:
    El Administrador NO usa las pasarelas; confirma/aprueba o rechaza pagos manualmente (incl. transferencia)
      contra Firestore. Las pasarelas (MP/PayPal) las dispara el Docente desde CheckoutModal.

-------------------------------------------------------------------------------
CASOS DE USO POR ACTOR: DOCENTE
-------------------------------------------------------------------------------

  CUENTA Y SESION
    Docente --> Registrarse con correo y contrasena (src/pages/teacher/Register.jsx)
      Registrarse --> [include] Elegir o crear escuela
        sub-opcion: elegir plantel del catalogo (planteles.json)
        sub-opcion: crear escuela personalizada (custom)
        sub-opcion: omitir escuela (sentinela "sin-escuela")
      Registrarse --> [include] Generar username de docente (PREFIX-NN)
      Registrarse --> [include] Crear cuenta de autenticacion --> (Firebase Auth)
      Registrarse --> [include] Crear perfil + suscripcion trial (45 dias) --> (Cloud Firestore)
      Registrarse --> [extend] Enviar correo de bienvenida --> (EmailJS)  (best-effort, falla silenciosa)
    Docente --> Iniciar sesion con usuario o correo + contrasena (src/pages/teacher/Login.jsx)
      Iniciar sesion --> [include] Resolver correo a partir del username --> (Cloud Firestore: users)
      Iniciar sesion --> [include] Autenticar --> (Firebase Auth)
    Docente --> Completar perfil tras login con Google (src/pages/teacher/RegisterSchool.jsx)
      Completar perfil --> [include] Elegir escuela (solo catalogo)
      Completar perfil --> [include] Vincular credencial usuario/contrasena --> (Firebase Auth linkWithCredential)
    Docente --> Verificar correo electronico (src/pages/teacher/VerifyEmail.jsx)
      Verificar correo --> [include] Validar token y activar cuenta --> (Cloud Firestore: users)
      nota: verificacion OPCIONAL; solo banner en la app, no bloquea el acceso.
    Docente --> Cerrar sesion --> (Firebase Auth signOut)

  PERFIL Y SUSCRIPCION (src/pages/teacher/Profile.jsx, CheckoutModal.jsx)
    Docente --> Cambiar foto de avatar
      Cambiar foto --> [include] Subir imagen --> (Cloudinary)
      Cambiar foto --> [include] Guardar photoURL --> (Cloud Firestore: users)
    Docente --> Editar nombre visible --> (Cloud Firestore: users)
    Docente --> Cambiar de escuela --> (Cloud Firestore: schools + users)
    Docente --> Cambiar contrasena
      Cambiar contrasena --> [include] Reautenticarse --> (Firebase Auth)
      Cambiar contrasena --> [include] Confirmar en modal
    Docente --> Ver mi plan y dias restantes --> (Cloud Firestore via useSubscription)
    Docente --> Contratar o renovar plan (abre CheckoutModal)
      Contratar plan --> [extend] Pagar con MercadoPago
        Pagar con MercadoPago --> [include] POST /api/mp/create-preference --> (MercadoPago + Firestore)
        Pagar con MercadoPago --> [include] Redirigir a init_point --> (MercadoPago)
      Contratar plan --> [extend] Pagar con PayPal
        Pagar con PayPal --> [include] POST /api/paypal/create-order --> (PayPal + Firestore)
        Pagar con PayPal --> [include] POST /api/paypal/capture-order --> (PayPal + Firestore)
      Contratar plan --> [extend] Registrar pago por transferencia (referencia)
        Registrar transferencia --> [include] Crear payment 'pendiente' + subscription 'pendiente_pago' --> (Cloud Firestore)
        nota: la transferencia queda pendiente hasta que el Administrador la aprueba.
    Docente --> Ver resultado del pago (src/pages/teacher/PagoResultado.jsx) (success/pending/failure por query param)

  ASIGNATURAS (src/pages/teacher/Dashboard.jsx, SubjectPage.jsx)
    Docente --> Ver mis asignaturas --> (Cloud Firestore: subjects where docenteId)
    Docente --> Alternar orden del nombre (Asignatura-Grupo / Grupo-Asignatura) (localStorage)
    Docente --> Crear asignatura (nombre, grupo, fechas, parciales, paleta, icono) --> (Cloud Firestore: subjects)
      Crear asignatura --> [include] Generar accessCode
    Docente --> Ver detalle de una asignatura (3 pestanas: Actividades / Calificaciones / Alumnos)
    Docente --> Editar asignatura (nombre, grupo, fechas, parciales, paleta, icono) --> (Cloud Firestore: subjects)
      Editar asignatura --> [include] Validar que no haya actividades en parciales eliminados
    Docente --> Duplicar asignatura (opcional copiar alumnos) --> (Cloud Firestore: copySubject util)
    Docente --> Archivar asignatura (conserva esqueleto, elimina entregas)
      Archivar --> [extend] Descargar entregas en ZIP antes de borrar --> (Cloudinary)
      Archivar --> [include] Eliminar submissions --> (Cloud Firestore)
    Docente --> Restaurar/desarchivar asignatura (editar datos + opciones de alumnos y actividades) --> (Cloud Firestore)
    Docente --> Eliminar asignatura en cascada (requiere teclear el nombre exacto)
      Eliminar asignatura --> [include] Borrar subject + activities + students + submissions --> (Cloud Firestore)
    Docente --> Generar y compartir codigo/QR/link de acceso de la asignatura
      Compartir acceso --> [extend] Copiar link de activacion
      Compartir acceso --> [extend] Copiar codigo de acceso
      Compartir acceso --> [extend] Mostrar QR (qrcode.react)
      Compartir acceso --> [extend] Descargar lista de alumnos en PDF (con QR/URL)

  ACTIVIDADES (src/pages/teacher/SubjectPage.jsx, ActivityPage.jsx)
    Docente --> Crear actividad en un parcial (nombre, max, instrucciones, fecha limite, tipos de archivo, visibilidad) --> (Cloud Firestore: activities)
    Docente --> Editar actividad --> (Cloud Firestore: activities)
    Docente --> Eliminar actividad --> (Cloud Firestore: activities)
    Docente --> Mostrar/ocultar actividad (visibilidad) --> (Cloud Firestore: activities)
    Docente --> Programar visibilidad de actividad (publishAt) --> (Cloud Firestore: activities)
    Docente --> Ver detalle de actividad (lista de alumnos + estado de entrega)
    Docente --> Extender fecha limite individual por alumno --> (Cloud Firestore: activities.extensiones)
    Docente --> Descargar todas las entregas de una actividad en ZIP --> (Cloudinary)

  CALIFICACIONES (src/pages/teacher/ActivityPage.jsx, SubjectPage.jsx)
    Docente --> Calificar entrega de un alumno (calificacion + comentario) --> (Cloud Firestore: submissions)
      nota: calificar requiere que exista una entrega del alumno.
    Docente --> Ver/descargar archivo de entrega de un alumno --> (Cloudinary)
    Docente --> Ver historial de versiones de una entrega
    Docente --> Ver matriz de calificaciones (promedios por parcial y global)
    Docente --> Exportar calificaciones a Excel --> (utils/excel)
    Docente --> Exportar calificaciones a PDF --> (utils/pdf)

  ALUMNOS (src/pages/teacher/SubjectPage.jsx)
    Docente --> Agregar alumno manualmente (apellidos + nombre)
      Agregar alumno --> [include] Generar username unico en la escuela --> (Cloud Firestore: students)
    Docente --> Importar alumnos desde Excel (writeBatch) --> (Cloud Firestore: students)
      Importar alumnos --> [include] Descargar plantilla de Excel (opcional, previo)
    Docente --> Buscar alumnos (en memoria)
    Docente --> Reordenar alumnos (subir/baja) --> (Cloud Firestore: students.orden)
    Docente --> Restablecer contrasena de un alumno (genera clave temporal) --> (Cloud Firestore: students)
    Docente --> Eliminar alumno (y reordenar el resto) --> (Cloud Firestore: students)
    Docente --> Generar credenciales de acceso en PDF (claves temporales faltantes) --> (Cloud Firestore + utils/pdf)

-------------------------------------------------------------------------------
CASOS DE USO POR ACTOR: ALUMNO
-------------------------------------------------------------------------------

  ACCESO Y ACTIVACION (src/pages/student/Login.jsx, Activation.jsx)
    Alumno --> Iniciar sesion (cuenta ya activada) (src/pages/student/Login.jsx)
      Iniciar sesion --> [include] Resolver inscripcion por username --> (Cloud Firestore: students)
      Iniciar sesion --> [include] Autenticar --> (Firebase Auth)
    Alumno --> Activar cuenta en linea desde el login (primer acceso, define contrasena)
      Activar inline --> [include] Crear cuenta de auth --> (Firebase Auth)
      Activar inline --> [include] Marcar inscripcion activada + crear doc users alumno --> (Cloud Firestore)
    Alumno --> Activar cuenta con codigo de acceso / QR (/activate/:accessCode) (src/pages/student/Activation.jsx)
      Activar por codigo --> [include] Resolver asignatura por accessCode --> (Cloud Firestore: subjects)
      Activar por codigo --> [include] Buscar inscripcion por username + asignatura --> (Cloud Firestore: students)
      Activar por codigo --> [include] Crear/vincular cuenta de auth --> (Firebase Auth)
      Activar por codigo --> [extend] Reset de contrasena del docente (signIn con temporal + updatePassword) --> (Firebase Auth)
      Activar por codigo --> [extend] Vincular cuenta existente (multi-materia, confirmar contrasena actual) --> (Firebase Auth)
    Alumno --> Cerrar sesion --> (Firebase Auth signOut)

  ASIGNATURAS Y ACTIVIDADES (src/pages/student/Dashboard.jsx, SubjectPage.jsx, ActivityPage.jsx)
    Alumno --> Ver mis asignaturas con docente y promedio (multi-materia) --> (Cloud Firestore: students/subjects/users/activities/submissions)
    Alumno --> Unirse a otra asignatura por codigo/QR (navega a /activate)
    Alumno --> Ver actividades de una asignatura por parcial (solo publicadas) --> (Cloud Firestore)
      nota: isActivityPublished oculta no publicadas/agendadas y bloquea acceso por URL directa.
    Alumno --> Ver detalle de una actividad (estado, calificacion, comentario, instrucciones, fecha limite/extension)
    Alumno --> Ver promedio por parcial (calculado en memoria, base 10)

  ENTREGAS (src/pages/student/ActivityPage.jsx)
    Alumno --> Subir entrega con archivo
      Subir entrega --> [include] Validar tipo de archivo permitido (config/fileTypes)
      Subir entrega --> [include] Validar tamano (limite 5 MB)
      Subir entrega --> [include] Subir archivo --> (Cloudinary)
      Subir entrega --> [include] Crear submission 'entregado' --> (Cloud Firestore: submissions)
    Alumno --> Marcar actividad como completada sin archivo --> (Cloud Firestore: submissions)
    Alumno --> Reentregar version corregida (solo con extension y sin calificar)
      Reentregar --> [include] Archivar version previa en historial (arrayUnion) --> (Cloud Firestore)
    Alumno --> Descargar su propio archivo de entrega --> (Cloudinary)

-------------------------------------------------------------------------------
CASOS DE USO POR ACTOR: ADMINISTRADOR
-------------------------------------------------------------------------------

  ACCESO (App.jsx ProtectedAdmin)
    Administrador --> Iniciar sesion (misma pantalla docente; redirige a /Admin segun role) --> (Firebase Auth)
    Administrador --> Acceder al panel /Admin (AdminDashboard, pestanas) --> (Cloud Firestore via useAdminStats)

  PANEL Y METRICAS (src/pages/admin/Dashboard.jsx, components/StatsCards.jsx)
    Administrador --> Ver resumen/KPIs (docentes, alumnos activos, suscripciones, ingresos, conversion) --> (Cloud Firestore: useAdminStats)
    Administrador --> Ver graficas (docentes por escuela, estado de suscripciones)
    Administrador --> Refrescar estadisticas globales --> (Cloud Firestore: recarga de todas las colecciones)

  SUSCRIPCIONES (src/pages/admin/components/SubscriptionsTable.jsx)
    Administrador --> Ver lista de suscripciones --> (Cloud Firestore)
    Administrador --> Crear suscripcion --> (Cloud Firestore: subscriptions addDoc)
    Administrador --> Editar suscripcion --> (Cloud Firestore: subscriptions updateDoc)
    Administrador --> Cancelar suscripcion (soft) --> (Cloud Firestore: subscriptions updateDoc status cancelada)
    Administrador --> Eliminar suscripcion (hard) --> (Cloud Firestore: subscriptions deleteDoc)

  PAGOS (src/pages/admin/components/PaymentsTable.jsx)
    Administrador --> Ver lista de pagos --> (Cloud Firestore)
    Administrador --> Aprobar pago manualmente
      Aprobar pago --> [include] Marcar payment 'completado' + activar suscripcion --> (Cloud Firestore: payments + subscriptions)
      nota: aplica a pagos pendientes, p.ej. de transferencia bancaria.
    Administrador --> Rechazar pago (con nota para el docente) --> (Cloud Firestore: payments updateDoc status rechazado)

  PLANES (src/pages/admin/components/PlansManager.jsx)
    Administrador --> Ver catalogo de planes --> (Cloud Firestore)
    Administrador --> Crear plan (precio, periodicidad, limites, visibilidad, orden) --> (Cloud Firestore: plans addDoc)
    Administrador --> Editar plan --> (Cloud Firestore: plans updateDoc)
    Administrador --> Eliminar plan --> (Cloud Firestore: plans deleteDoc)

  USUARIOS (src/pages/admin/components/UsersTable.jsx)
    Administrador --> Ver lista de docentes (escuela, plan, estado, ultimo pago) (solo lectura) --> (Cloud Firestore via stats)

  CONFIGURACION DE COBROS (src/pages/admin/components/PaymentConfig.jsx)
    Administrador --> Configurar Mercado Pago (habilitar + Public Key) --> (Cloud Firestore: config/payments)
    Administrador --> Configurar PayPal (habilitar + Client ID) --> (Cloud Firestore: config/payments)
    Administrador --> Configurar transferencia bancaria (banco, titular, cuenta, CLABE, nota) --> (Cloud Firestore: config/payments)
      nota: solo datos PUBLICOS; los secretos (MP_ACCESS_TOKEN, PAYPAL_SECRET) viven en env de Vercel.

-------------------------------------------------------------------------------
CASOS DE USO POR ACTOR: SISTEMAS EXTERNOS (vista server-to-server)
-------------------------------------------------------------------------------

  MercadoPago --> Notificar cambio de estado de pago (webhook) (api/mp/webhook.js)
    Notificar webhook --> [include] Re-verificar el pago contra la API de MP (token secreto)
    Notificar webhook --> [extend] Completar pago y activar suscripcion (si aprobado, idempotente) --> (Cloud Firestore: payments + subscriptions)
    nota: el webhook NO verifica ID token (es llamada de servidor de MP); se enlaza por external_reference = paymentId.

  PayPal --> (no inicia llamadas a la app) ; la captura la dispara el Docente (capture-order) y la app
    lee custom_id = paymentId de la respuesta de PayPal para identificar el pago. (api/paypal/capture-order.js)

  Firebase Auth --> Verificar Firebase ID token (Admin SDK) en endpoints de creacion de pago (api/_lib/firebaseAdmin.js verifyRequest)
    nota: caso de uso de soporte; protege POST /api/mp/create-preference, /api/paypal/create-order y /api/paypal/capture-order.

-------------------------------------------------------------------------------
RELACIONES TRANSVERSALES Y NOTAS
-------------------------------------------------------------------------------

  Autenticacion compartida:
    "Iniciar sesion" (Docente, Alumno, Administrador) --> [include] Autenticar --> (Firebase Auth).
    El destino post-login lo decide RootRedirect/ProtectedX segun role (admin -> /Admin, docente -> /dashboard,
      alumno/@evalua.local -> /alumno/dashboard).

  Guard por rol (src/App.jsx):
    ProtectedAdmin exige role 'admin'; ProtectedTeacher rechaza admin (-> /Admin) y no-docente (-> /alumno);
      ProtectedStudent solo exige sesion. Ruta desconocida "*" --> redirige a "/".

  Enlace pago<->pasarela:
    "Pagar con MercadoPago/PayPal" del Docente --> crea payment 'pendiente' + subscription 'pendiente_pago';
      la activacion real (status 'activa') la hace el backend al confirmar (webhook MP o capture PayPal) o
      el Administrador al "Aprobar pago" (transferencia). external_reference (MP) y custom_id (PayPal) = paymentId.

  Precio seguro:
    El monto SIEMPRE se lee de plans/{planId} en el servidor (billing.getPlan), nunca del cliente.

  Discrepancia conocida (copy vs logica):
    El UI menciona prueba de 60 dias en algunos textos, pero Register crea el trial a 45 dias reales.


===== DIAGRAMA ENTIDAD-RELACION (texto plano para IA) =====

NOTA GENERAL:
  Firestore es NoSQL: no hay claves foraneas reales, ni JOINs, ni integridad referencial.
  Las "relaciones" son IDs guardados como campos de tipo string que apuntan al doc id de
  otra coleccion. La app las resuelve en memoria con queries de igualdad
  (where('campo','==',valor)) y luego ordena/filtra en cliente.
  Restriccion del proyecto: solo igualdad (==) o varias igualdades; NO hay range (<,>,!=)
  ni orderBy en queries. El ordenamiento se hace en memoria.
  Cardinalidades expresadas como: (1)---<(N) = uno a muchos; (N)>---<(N) = muchos a muchos.

-----------------------------------------------------------------
ENTIDADES (colecciones Firestore)
-----------------------------------------------------------------

ENTIDAD: schools
  OBJETIVO: catalogo de escuelas/planteles donde trabaja cada docente.
  PK: doc id autogenerado por Firestore. Casos especiales de id fijo:
    'sin-escuela' = escuela centinela para docentes que no eligieron plantel (sinEscuela:true)
  ATRIBUTOS:
    nombre: string (nombre largo del plantel)
    shortName: string (nombre corto, ej "CBTIS255"; usado para prefijo de username docente)
    claveSEP: string (CCT, ej "110020"; solo en escuelas del catalogo) (no determinado si siempre presente)
    subsistema: string (opcional, del catalogo)
    municipio: string (opcional)
    estado: string (opcional)
    custom: boolean (opcional; true si la agrego manualmente un docente)
    sinEscuela: boolean (opcional; true solo en doc 'sin-escuela')
  ORIGEN: creada/merge en Register.jsx (al registrarse el primer docente del plantel)
          y editable en Profile.jsx.

ENTIDAD: users
  OBJETIVO: cuentas de DOCENTE y ADMIN (NO alumnos). Doc por usuario de Firebase Auth.
  PK: doc id == uid de Firebase Auth (users/{uid}).
  ATRIBUTOS COMUNES:
    role: string ('docente' | 'admin' | 'alumno') (los alumnos legacy tambien
          pueden tener doc aqui con role 'alumno', ver mas abajo)
    username: string (docente: "{shortName}-{seq}" ej "CBTIS255-01")
    email: string (correo real)
    escuelaId: string -> schools.id  (RELACION)
    schoolName: string (denormalizado, copia del nombre de la escuela)
    photoURL: string|null
    nombreMostrar: string (opcional, nombre a mostrar)
  ATRIBUTOS SOLO EN DOC DE ALUMNO (creado en Activation.finishActivation):
    role: 'alumno'
    studentId: string -> students.id (apunta a UNA inscripcion del alumno) (RELACION)
    nombre, apellidoPaterno, apellidoMaterno: string (denormalizados del students)
  ORIGEN: Register.jsx (docente), seeds-db/create-admin.js o set-admin.js (admin),
          Activation.jsx (doc de alumno con merge).
  NOTA: el admin es un users con role:'admin'. No hay coleccion separada de admins.

ENTIDAD: students
  OBJETIVO: INSCRIPCION de un alumno en UNA asignatura. Es la entidad de union
            alumno<->asignatura: un alumno real con varias materias tiene VARIOS
            docs students (uno por materia) que comparten el mismo uid de Auth.
  PK: doc id autogenerado.
  ATRIBUTOS:
    nombre: string
    apellidoPaterno: string
    apellidoMaterno: string
    username: string (4 chars derivados de iniciales; unico por escuela)
    escuelaId: string -> schools.id  (RELACION)
    asignaturaId: string -> subjects.id  (RELACION; la materia de esta inscripcion)
    uid: string -> users.id / Firebase Auth uid (se setea al activar)  (RELACION)
    activado: boolean (false hasta que el alumno crea/vincula su cuenta)
    resetPassword: string|null (password temporal de 6 chars emitido por el docente;
                   se pone null al activar)
    orden: number (posicion en la lista del grupo, para ordenar en memoria)
    createdAt: timestamp
  ORIGEN: SubjectPage.jsx (alta manual o import Excel, en batch),
          copySubject.js (al copiar materia con keepStudents).
  LECTURA PUBLICA (rules: read if true) para permitir activacion por QR.

ENTIDAD: subjects
  OBJETIVO: asignatura/materia que imparte un docente. Contiene config de parciales,
            fechas, apariencia y codigo de acceso para alumnos.
  PK: doc id autogenerado.
  ATRIBUTOS:
    nombre: string
    grupo: string
    docenteId: string -> users.id (uid del docente dueno)  (RELACION)
    escuelaId: string -> schools.id  (RELACION)
    parciales: number (cantidad de parciales, default 3)
    fechaInicio: string 'YYYY-MM-DD' (opcional, '')
    fechaFin: string 'YYYY-MM-DD' (opcional, '')
    ciclo: string (LEGACY; fallback si no hay fechaInicio/fechaFin)
    colorPalette: string (clave de paleta de color)
    icon: string (clave de icono)
    accessCode: string (codigo corto para activacion/QR de alumnos; unico de facto)
    archived: boolean (archivada = esqueleto, default false)
    createdAt: timestamp
  ORIGEN: Dashboard.jsx handleCreateSubject, copySubject.js.
  LECTURA PUBLICA (rules: read if true) para que /activate/:code resuelva por accessCode.

ENTIDAD: activities
  OBJETIVO: actividad/tarea dentro de una asignatura, asociada a un parcial.
  PK: doc id autogenerado.
  ATRIBUTOS:
    nombre: string
    asignaturaId: string -> subjects.id  (RELACION)
    docenteId: string -> users.id (uid del docente)  (RELACION; usado por las rules)
    parcial: number (a que parcial pertenece)
    maxCalif: number (calificacion maxima, default 10)
    instrucciones: string
    fechaLimite: string|null
    tipo: string ('archivo')
    tiposArchivo: string (clave de tipo de archivo permitido; default segun fileTypes)
    extensionesCustom: string (extensiones propias si tiposArchivo es 'personalizado')
    oculta: boolean (visibilidad: oculta para alumnos)
    publishAt: string|null (fecha/hora de publicacion programada)
    createdAt: timestamp
  ORIGEN: SubjectPage.jsx handleSaveActivity, copySubject.js.

ENTIDAD: submissions
  OBJETIVO: entrega de UN alumno (inscripcion) a UNA actividad, con su calificacion.
  PK: doc id autogenerado.
  ATRIBUTOS:
    alumnoId: string -> students.id (la INSCRIPCION del alumno, NO su uid)  (RELACION)
    actividadId: string -> activities.id  (RELACION)
    archivoURL: string|null (URL del archivo subido, Cloudinary)
    nombreArchivo: string|null
    completadoSinArchivo: boolean (entrega marcada como hecha sin subir archivo)
    fechaEntrega: timestamp
    calificacion: number|null (null = sin calificar)
    comentario: string (retro del docente)
    estado: string ('entregado' | 'calificado')
    historial: array (entradas de versiones previas en reentregas)
  ORIGEN: alumno -> student/ActivityPage.jsx (addDoc/updateDoc);
          docente -> teacher/ActivityPage.jsx (updateDoc al calificar:
          calificacion, comentario, estado:'calificado').
  NOTA CLAVE: alumnoId apunta al doc students (la inscripcion por-materia),
              no al uid; por eso las entregas quedan correctamente separadas
              cuando un mismo uid esta en varias materias.

ENTIDAD: plans
  OBJETIVO: planes de suscripcion (catalogo de precios). Doc id fijo (ej 'pro').
  PK: doc id fijo definido en seed (ej 'pro').
  ATRIBUTOS:
    nombre: string (ej "Plan Pro")
    descripcion: string
    precio: number (MXN)
    periodicidad: string ('mensual' | 'anual')
    maxAsignaturas: number (-1 = ilimitado)
    maxAlumnos: number (-1 = ilimitado)
    activo: boolean
    orden: number
    createdAt, updatedAt: timestamp
  ORIGEN: seeds-db/seed-plans.js; gestionable en admin PlansManager.jsx.

ENTIDAD: subscriptions
  OBJETIVO: suscripcion de un docente (trial o de pago) y su vigencia.
  PK: doc id autogenerado.
  ATRIBUTOS:
    docenteId: string -> users.id (uid del docente)  (RELACION)
    planId: string -> plans.id ('' durante trial)  (RELACION)
    planName: string (denormalizado, opcional)
    escuelaId: string -> schools.id  (RELACION)
    schoolName: string (denormalizado)
    status: string ('trial' | 'pendiente_pago' | 'activa' | 'vencida')
    precio: number (opcional)
    fechaInicio: timestamp
    fechaVencimiento: timestamp
    createdAt, updatedAt: timestamp
  ORIGEN: Register.jsx (crea trial de 45 dias al registrarse),
          CheckoutModal.jsx (transferencia -> pendiente_pago),
          api/_lib/billing.js startPayment/completePayment (activa al pagar).

ENTIDAD: payments
  OBJETIVO: pago individual de un docente hacia una suscripcion (su estado y metodo).
  PK: doc id autogenerado.
  ATRIBUTOS:
    docenteId: string -> users.id (uid del docente)  (RELACION)
    subscriptionId: string -> subscriptions.id  (RELACION)
    planId: string -> plans.id  (RELACION)
    escuelaId: string -> schools.id (opcional)  (RELACION)
    monto: number
    metodo: string ('transferencia' | 'mercadopago' | 'paypal')
    referencia: string (referencia de transferencia, opcional)
    banco: string (opcional)
    notas: string (opcional)
    status: string ('pendiente' | 'aprobado'/'completado' | 'rechazado')
            (cliente/seed usan 'pendiente'/'aprobado'/'rechazado';
             api/billing.js marca 'completado' al confirmar gateway)
    gateway: map (datos crudos del gateway, MP/PayPal) (opcional)
    createdAt, updatedAt: timestamp
    reviewedAt: timestamp|null
  ORIGEN: CheckoutModal.jsx (transferencia), api/_lib/billing.js (MP/PayPal),
          seeds-db/seed-demo.js (demo).

ENTIDAD: config (doc unico 'config/payments')
  OBJETIVO: configuracion PUBLICA de pagos mostrable (NO secretos).
            Los secretos (access token MP, secret PayPal) viven en env vars de Vercel.
  PK: doc id fijo 'payments'.
  ATRIBUTOS:
    moneda: string ('MXN')
    mercadoPago: map { enabled: boolean, publicKey: string }
    paypal: map { enabled: boolean, clientId: string }
    transferencia: map { enabled, banco, titular, cuenta, clabe, nota }
  ORIGEN: admin PaymentConfig.jsx (setDoc), lectura via usePaymentConfig.js.
  RELACION: ninguna (config global, sin FKs).

ENTIDAD: attendance (ELIMINADA / OBSOLETA)
  ESTADO: el modulo de asistencia fue eliminado (ver docs/PLAN_CAMBIOS.md R12).
          Ya no hay codigo en src/ que lea o escriba esta coleccion ni reglas para ella.
          Se menciona en CLAUDE.md por historico, pero NO modelar relaciones con ella.
          (no determinado si quedan datos residuales en produccion)

-----------------------------------------------------------------
RELACIONES (con cardinalidad y como se resuelven en codigo)
-----------------------------------------------------------------

R1: SCHOOL (1) ---< (N) USER(docente/admin)
  via users.escuelaId == schools.id
  Una escuela tiene muchos docentes; cada docente pertenece a una escuela.
  Resolucion: AuthContext.jsx lee schools/{escuelaId} para enriquecer el perfil;
              Register.jsx cuenta docentes where escuelaId==schoolId para el seq del username.

R2: SCHOOL (1) ---< (N) STUDENT
  via students.escuelaId == schools.id
  Una escuela tiene muchas inscripciones de alumnos.
  Resolucion: usado para email falso del alumno y para unicidad de username por escuela.

R3: SCHOOL (1) ---< (N) SUBJECT
  via subjects.escuelaId == schools.id
  Una escuela tiene muchas asignaturas.

R4: USER(docente) (1) ---< (N) SUBJECT
  via subjects.docenteId == users.id (uid)
  Un docente crea muchas asignaturas; cada asignatura pertenece a un docente.
  Resolucion: Dashboard.jsx y Layout.jsx hacen where docenteId==currentUser.uid.

R5: USER(docente) (1) ---< (N) ACTIVITY
  via activities.docenteId == users.id (uid)
  Relacion DIRECTA y denormalizada (ademas de la indirecta via subject) que existe
  porque las reglas de seguridad de activities/submissions comprueban docenteId.

R6: SUBJECT (1) ---< (N) ACTIVITY
  via activities.asignaturaId == subjects.id
  Una asignatura tiene muchas actividades; cada actividad pertenece a una asignatura.
  Resolucion: SubjectPage.jsx where asignaturaId==subjectId.
  Indice compuesto desplegado: activities(asignaturaId, parcial).

R7: SUBJECT (1) ---< (N) STUDENT(inscripcion)
  via students.asignaturaId == subjects.id
  Una asignatura tiene muchas inscripciones de alumnos.
  Indice compuesto desplegado: students(asignaturaId, username).

R8: ACTIVITY (1) ---< (N) SUBMISSION
  via submissions.actividadId == activities.id
  Una actividad recibe muchas entregas; cada entrega es de una actividad.
  Indice compuesto desplegado: submissions(actividadId, alumnoId).

R9: STUDENT(inscripcion) (1) ---< (N) SUBMISSION
  via submissions.alumnoId == students.id
  Una inscripcion tiene muchas entregas (una por actividad de su materia).
  IMPORTANTE: alumnoId apunta al doc students (inscripcion), NO al uid de Auth.

R10: USER (1) ---< (N) STUDENT(inscripcion)   [un alumno real -> varias inscripciones]
  via students.uid == users.id / Auth uid (poblado al activar)
  Un mismo uid de alumno puede estar en VARIOS docs students (uno por materia).
  Resolucion: utils/studentLookup.js getEnrollments() junta todas las inscripciones
              del uid; getEnrollmentForSubject() elige la correcta por asignaturaId.
  Tambien users(alumno).studentId apunta a UNA de esas inscripciones (parcial).

R11: STUDENT (N) >---< (N) SUBJECT   [muchos a muchos LOGICO via inscripcion]
  La relacion alumno<->asignatura es N:M, MATERIALIZADA como una fila por inscripcion
  en la coleccion students (cada doc = 1 alumno-uid en 1 asignatura).
  Es el patron clasico de tabla de union, pero "desnormalizado": cada doc students
  repite nombre/apellidos del alumno por cada materia en que esta inscrito.
  La identidad del alumno real se reconstruye agrupando por uid (ver R10).

R12: USER(docente) (1) ---< (N) SUBSCRIPTION
  via subscriptions.docenteId == users.id (uid)
  Un docente puede tener varias suscripciones a lo largo del tiempo (trial + pagos),
  aunque en la practica se reutiliza la mas reciente (api/billing.startPayment).
  Indice compuesto desplegado: subscriptions(docenteId, status).

R13: PLAN (1) ---< (N) SUBSCRIPTION
  via subscriptions.planId == plans.id ('' mientras es trial -> sin plan)
  Un plan puede estar referenciado por muchas suscripciones.

R14: SCHOOL (1) ---< (N) SUBSCRIPTION   (denormalizado)
  via subscriptions.escuelaId == schools.id (+ schoolName copiado)

R15: USER(docente) (1) ---< (N) PAYMENT
  via payments.docenteId == users.id (uid)
  Indice compuesto desplegado: payments(docenteId, status).

R16: SUBSCRIPTION (1) ---< (N) PAYMENT
  via payments.subscriptionId == subscriptions.id
  Una suscripcion puede acumular varios intentos/registros de pago.
  Al confirmarse un pago (status completado), api/billing.completePayment actualiza
  la suscripcion a status 'activa' con nuevas fechaInicio/fechaVencimiento.

R17: PLAN (1) ---< (N) PAYMENT
  via payments.planId == plans.id

R18: USER(alumno) (1) ---- (1) STUDENT   [enlace parcial 1:1]
  via users(alumno).studentId == students.id  Y  students.uid == users.id
  El doc users de un alumno guarda UN studentId (una inscripcion de referencia).
  Es un puntero parcial: la lista completa de inscripciones se obtiene por uid (R10),
  no por este campo.

-----------------------------------------------------------------
MAPA RESUMIDO (cadena principal de datos academicos)
-----------------------------------------------------------------
  SCHOOL (1)---<(N) USER(docente) (1)---<(N) SUBJECT (1)---<(N) ACTIVITY (1)---<(N) SUBMISSION
  SUBJECT (1)---<(N) STUDENT(inscripcion) (1)---<(N) SUBMISSION
  USER(alumno uid) (1)---<(N) STUDENT(inscripcion)          [un alumno, varias materias]
  STUDENT (N)>---<(N) SUBJECT  via doc students por inscripcion (tabla de union)

MAPA RESUMIDO (facturacion / pagos)
  USER(docente) (1)---<(N) SUBSCRIPTION ---- PLAN (N:1)
  SUBSCRIPTION (1)---<(N) PAYMENT ---- PLAN (N:1) ---- USER(docente) (N:1)
  config/payments = doc global de configuracion (sin relaciones)

NOTAS DE INTEGRIDAD (porque no hay FKs):
  - Borrado en cascada manual: utils/deleteSubjectCascade.js borra actividades,
    entregas y alumnos de una asignatura por separado (Firestore no cascada solo).
  - Muchos campos estan denormalizados (schoolName, planName, nombre del alumno
    repetido por inscripcion) para evitar lecturas extra; pueden quedar desfasados.
  - Las "FKs" pueden quedar colgadas si se borra el destino sin limpiar las referencias.


===== DIAGRAMA RELACIONAL / ESQUEMA (texto plano para IA) =====

NOTA GENERAL:
  Firestore NO es relacional; aqui se modela "como si" fuera relacional para lectura de una IA.
  PK = id del documento (autogenerado por Firestore salvo se indique).
  FK = campo que guarda el id de un documento de otra coleccion (referencia logica, NO enforced por Firestore).
  Todos los IDs son strings. Las fechas pueden ser Firestore Timestamp o strings 'YYYY-MM-DD' (se indica por campo).
  Constraint Firestore del proyecto: solo igualdad (where '=='), sin rangos ni orderBy; el ordenamiento se hace en memoria.
  Colecciones detectadas: schools, users, students, subjects, activities, submissions, plans, subscriptions, payments, config.
  Coleccion attendance: aparece mencionada en CLAUDE.md pero NO se usa en el codigo actual (sin lecturas ni escrituras). Se documenta como (no usada actualmente).

-----------------------------------------------------------------
TABLA schools(id PK)
  id PK
    docId. Puede ser autogenerado, o el id fijo 'sin-escuela' (escuela centinela para docentes "Sin escuela").
  CAMPOS:
    nombre               string. Nombre completo de la escuela. (siempre presente)
    shortName            string. Nombre corto (se usa para prefijo de username de docente).
    claveSEP             string. CCT del plantel (solo si proviene del catalogo public/planteles.json). (opcional)
    subsistema           string. Subsistema/sub del catalogo (CBTIS/CETIS/etc.). (opcional, solo catalogo)
    municipio            string. Municipio del catalogo. (opcional, solo catalogo)
    estado               string. Estado del catalogo. (opcional, solo catalogo)
    custom               boolean. true si la escuela fue agregada manualmente (no esta en el catalogo). (opcional)
    sinEscuela           boolean. true solo en el doc 'sin-escuela' centinela. (opcional)
  PK: id
  FK: (ninguna; schools es raiz)
  REFERENCIADA POR (FK entrantes): users.escuelaId, students.escuelaId, subjects.escuelaId, subscriptions.escuelaId, payments.escuelaId
  ORIGEN/ESCRITURA: Register.jsx, RegisterSchool.jsx, Profile.jsx (setDoc al crear/reutilizar escuela). Lectura por claveSEP o por nombre para evitar duplicados.

-----------------------------------------------------------------
TABLA users(id PK)
  id PK
    docId = uid de Firebase Auth (no autogenerado; es el uid del usuario).
    Contiene DOCENTES y ADMINS. Tambien se crea un doc users/{uid} para ALUMNOS al activar (perfil espejo), pero el doc maestro del alumno vive en students.
  CAMPOS:
    role                 string. 'docente' | 'admin' | 'alumno'. (siempre presente)
    username             string. Docente: '{shortName}-{seq}' p.ej. 'CBTIS255-01' o 'EF-01'. Admin: 'admin'. Alumno: copia de students.username.
    email                string. Correo real (docente/admin) en minusculas. Para alumno NO se guarda email real (usa email falso solo en Auth).
    escuelaId            FK->schools.id. Escuela del usuario. (docente/alumno; admin puede no tenerla)
    schoolName           string. Nombre de la escuela cacheado al registrar (denormalizado). (opcional)
    photoURL             string|null. URL de avatar en Cloudinary. (opcional)
    nombreMostrar        string. Nombre para mostrar editable por el docente en Perfil. (opcional)
    nombre               string. Solo en perfil espejo de alumno (copiado de students.nombre). (opcional)
    apellidoPaterno      string. Solo en perfil espejo de alumno. (opcional)
    apellidoMaterno      string. Solo en perfil espejo de alumno. (opcional)
    studentId            FK->students.id. Solo en perfil espejo de alumno: id del doc students vinculado. (opcional)
    updatedAt            Timestamp. Solo al promover a admin via seed. (opcional)
  PK: id (=uid Auth)
  FK: escuelaId -> schools.id ; studentId -> students.id (solo alumno)
  REFERENCIADA POR (FK entrantes): subjects.docenteId, activities.docenteId, students.uid, submissions.alumnoId (=uid del alumno), subscriptions.docenteId, payments.docenteId
  NOTA: submissions.alumnoId NO apunta a users.id sino a students.id (ver submissions). El uid del alumno se guarda en students.uid y en users.studentId.
  ORIGEN/ESCRITURA: Register.jsx/RegisterSchool.jsx (setDoc al registrar docente), Profile.jsx (updateDoc nombre/foto/escuela), Activation.jsx + student/Login.jsx (setDoc perfil espejo alumno), seeds-db/create-admin.js/set-admin.js (admin).
  ENRIQUECIMIENTO EN MEMORIA: AuthContext agrega schoolName y claveSEP leyendo schools/{escuelaId} (no se persiste).

-----------------------------------------------------------------
TABLA students(id PK)
  id PK
    docId autogenerado. Es el doc MAESTRO del alumno por asignatura.
    Multi-materia: un mismo alumno (mismo uid) tiene VARIOS docs students, uno por asignatura, todos con el mismo uid. Resolver via utils/studentLookup.
  CAMPOS:
    apellidoPaterno      string. (siempre presente)
    apellidoMaterno      string. (siempre presente)
    nombre               string. Nombre(s) del alumno. (siempre presente)
    username             string. Codigo de 4 chars por iniciales (generateUsername). Unico por escuela.
    resetPassword        string|null. Password temporal de 4 chars. null cuando el alumno ya activo y fijo su propia clave.
    escuelaId            FK->schools.id. (siempre presente)
    asignaturaId         FK->subjects.id. Asignatura/grupo al que pertenece este registro. (siempre presente)
    activado             boolean. true cuando el alumno creo/uso su cuenta de Auth; false al crear o tras reset.
    uid                  FK->users.id. uid de Firebase Auth del alumno; se setea al activar. (opcional hasta activar)
    orden                number. Posicion del alumno en la lista del grupo (orden manual/import).
    createdAt            Timestamp (serverTimestamp).
  PK: id
  FK: escuelaId -> schools.id ; asignaturaId -> subjects.id ; uid -> users.id
  REFERENCIADA POR (FK entrantes): submissions.alumnoId -> students.id
  ACCESO: read publico (regla allow read: true) para permitir activacion por QR sin sesion.
  ORIGEN/ESCRITURA: SubjectPage.jsx teacher (addStudent, import Excel writeBatch, reset password updateDoc, generacion de codigos batch), copySubject.js (copia con keepStudents), Activation.jsx + student/Login.jsx (updateDoc activado/uid/resetPassword).

-----------------------------------------------------------------
TABLA subjects(id PK)
  id PK
    docId autogenerado. Representa una asignatura-grupo de un docente.
  CAMPOS:
    nombre               string. Nombre de la asignatura. (siempre presente)
    grupo                string. Grupo (p.ej. '1A'). (presente al crear; opcional '' en copia)
    docenteId            FK->users.id. Docente dueño. (siempre presente)
    escuelaId            FK->schools.id. Escuela. (siempre presente)
    parciales            number. Cantidad de parciales (default 3).
    fechaInicio          string 'YYYY-MM-DD' o ''. Fecha de inicio opcional.
    fechaFin             string 'YYYY-MM-DD' o ''. Fecha de fin opcional.
    ciclo                string. Campo LEGACY de ciclo escolar; usado solo como fallback en utils/dateRange.js. (opcional, no se escribe en creacion actual)
    colorPalette         string. Clave de paleta de color de la tarjeta (default 'default').
    icon                 string. Clave de icono (default 'book').
    accessCode           string. Codigo de acceso de 6 chars para activacion por QR/codigo. Unico de busqueda para alumnos.
    archived             boolean. true si la asignatura esta archivada. (default false)
    createdAt            Timestamp (serverTimestamp).
  PK: id
  FK: docenteId -> users.id ; escuelaId -> schools.id
  REFERENCIADA POR (FK entrantes): students.asignaturaId, activities.asignaturaId
  ACCESO: read publico (allow read: true) para activacion por accessCode. update/delete solo el docente dueño.
  ORIGEN/ESCRITURA: teacher/Dashboard.jsx (handleCreateSubject addDoc), Layout.jsx (lectura sidebar), copySubject.js (addDoc nueva copia), deleteSubjectCascade.js (borrado en cascada).

-----------------------------------------------------------------
TABLA activities(id PK)
  id PK
    docId autogenerado. Actividad/tarea de una asignatura, dentro de un parcial.
  CAMPOS:
    nombre               string. Nombre de la actividad. (siempre presente)
    maxCalif             number. Calificacion maxima (default 10).
    instrucciones        string. Instrucciones de la actividad. (puede ser '')
    fechaLimite          string 'YYYY-MM-DD' | null. Fecha limite de entrega.
    tiposArchivo         string. Tipo de archivo permitido (clave de fileTypes; default 'todos'/'imagenes' segun origen).
    extensionesCustom    string. Extensiones personalizadas cuando tiposArchivo = 'personalizado'. ('' si no aplica)
    tipo                 string. Tipo de actividad; siempre 'archivo' en el codigo actual.
    parcial              number. Numero de parcial al que pertenece (1..parciales).
    asignaturaId         FK->subjects.id. Asignatura dueña. (siempre presente)
    docenteId            FK->users.id. Docente dueño. (siempre presente)
    oculta               boolean. true si la actividad esta oculta a los alumnos (o tiene publishAt programado).
    publishAt            string 'YYYY-MM-DD'|null. Fecha de publicacion programada. (opcional)
    extensiones          map<studentId, 'YYYY-MM-DD'>. Mapa de extensiones de fecha por alumno (key = students.id). (opcional, se crea con dot-path)
    createdAt            Timestamp (serverTimestamp).
  PK: id
  FK: asignaturaId -> subjects.id ; docenteId -> users.id ; (keys de extensiones -> students.id)
  REFERENCIADA POR (FK entrantes): submissions.actividadId
  ACCESO: read solo autenticados. update/delete solo el docente dueño.
  ORIGEN/ESCRITURA: teacher/SubjectPage.jsx (handleSaveActivity create/update, delete), teacher/ActivityPage.jsx (handleEditActivity, saveExtension dot-path 'extensiones.{studentId}'), copySubject.js (copia actividades visibles).

-----------------------------------------------------------------
TABLA submissions(id PK)
  id PK
    docId autogenerado. Entrega de un alumno para una actividad.
  CAMPOS:
    alumnoId             FK->students.id. ATENCION: apunta a students.id (no a users.id). (siempre presente)
    actividadId          FK->activities.id. Actividad a la que corresponde. (siempre presente)
    archivoURL           string|null. URL del archivo entregado en Cloudinary.
    nombreArchivo        string|null. Nombre original del archivo.
    completadoSinArchivo boolean. true si el alumno marco "completado" sin subir archivo.
    fechaEntrega         Timestamp (serverTimestamp) | null. Fecha de la ultima entrega.
    calificacion         number|null. Calificacion asignada por el docente (null = sin calificar).
    comentario           string. Comentario/retroalimentacion del docente. (puede ser '')
    estado               string. 'entregado' | 'calificado'. (estado logico de la entrega)
    historial            array<obj>. Versiones previas; cada item: { archivoURL, nombreArchivo, completadoSinArchivo, fechaEntrega }. Se acumula con arrayUnion al recorregir.
  PK: id
  FK: alumnoId -> students.id ; actividadId -> activities.id
  REFERENCIADA POR (FK entrantes): (ninguna)
  ACCESO: read/create autenticados; update autenticados; delete solo el docente dueño de la actividad (via lookup activities.docenteId) o el alumno dueño (alumnoId == uid). NOTA: la regla de delete compara resource.data.alumnoId con request.auth.uid, pero alumnoId guarda students.id; ver utils/studentLookup para la relacion uid<->studentId. (posible inconsistencia, no determinado si intencional)
  ORIGEN/ESCRITURA: student/ActivityPage.jsx (handleUpload, handleMarkComplete: addDoc/updateDoc + arrayUnion historial), teacher/ActivityPage.jsx (saveGrade updateDoc calificacion/comentario/estado), deleteSubjectCascade.js (borrado en cascada por actividad).

-----------------------------------------------------------------
TABLA plans(id PK)
  id PK
    docId autogenerado. Catalogo de planes de suscripcion (administrado por admin).
  CAMPOS:
    nombre               string. Nombre del plan. (siempre presente)
    descripcion          string. Descripcion del plan. (opcional)
    precio               number. Precio del plan (autoridad de precio en backend; el cliente nunca lo fija).
    periodicidad         string. 'mensual' | 'anual'. Define el periodo que suma billing.addPeriod.
    maxAsignaturas       number. Limite de asignaturas; -1 = ilimitado.
    maxAlumnos           number. Limite de alumnos; -1 = ilimitado.
    activo               boolean. true si el plan esta disponible para contratar.
    orden                number. Orden de despliegue en la UI.
    createdAt            Timestamp (serverTimestamp).
    updatedAt            Timestamp (serverTimestamp).
  PK: id
  FK: (ninguna)
  REFERENCIADA POR (FK entrantes): subscriptions.planId, payments.planId
  ACCESO: read autenticados; create/update/delete solo admin.
  ORIGEN/ESCRITURA: admin/components/PlansManager.jsx (addDoc/updateDoc/deleteDoc), seeds-db/seed-plans.js. Lectura backend api/_lib/billing.js getPlan() (autoridad de precio).

-----------------------------------------------------------------
TABLA subscriptions(id PK)
  id PK
    docId autogenerado. Suscripcion de un docente (1 docente puede tener varias historicas; se reutiliza la mas reciente).
  CAMPOS:
    docenteId            FK->users.id. Docente dueño. (siempre presente)
    planId               FK->plans.id. Plan contratado; '' en trial sin plan.
    escuelaId            FK->schools.id. Escuela (denormalizada). (opcional)
    schoolName           string. Nombre de escuela (denormalizado). (opcional)
    status               string. 'trial' | 'pendiente_pago' | 'activa' | (otros admin). Estados de la suscripcion.
    fechaInicio          Timestamp. Inicio de vigencia. (presente en trial/activa)
    fechaVencimiento     Timestamp. Fin de vigencia (trial = inicio+45 dias; activa = inicio + periodo del plan).
    createdAt            Timestamp.
    updatedAt            Timestamp.
  PK: id
  FK: docenteId -> users.id ; planId -> plans.id ; escuelaId -> schools.id
  REFERENCIADA POR (FK entrantes): payments.subscriptionId
  ACCESO: read admin o dueño (docenteId == uid). create docente (solo status 'pendiente_pago'/'trial') o admin. update docente (solo a 'pendiente_pago') o admin. delete solo admin.
  ORIGEN/ESCRITURA: Register.jsx (addDoc trial 45 dias al registrar), CheckoutModal.jsx / PaymentSimulationModal.jsx (addDoc/updateDoc pendiente_pago), admin/components/SubscriptionsTable.jsx (addDoc/updateDoc admin), api/_lib/billing.js startPayment (reutiliza/crea, pone pendiente_pago) y completePayment (pone 'activa' con fechas).

-----------------------------------------------------------------
TABLA payments(id PK)
  id PK
    docId autogenerado. Registro de un pago (transferencia manual, MercadoPago o PayPal).
  CAMPOS:
    docenteId            FK->users.id. Docente que paga. (siempre presente)
    subscriptionId       FK->subscriptions.id. Suscripcion asociada. (siempre presente)
    planId               FK->plans.id. Plan que se paga. (siempre presente)
    escuelaId            FK->schools.id. Escuela (denormalizada). (opcional)
    monto                number. Monto del pago (tomado de plan.precio en servidor / plan seleccionado en cliente).
    metodo               string. 'transferencia' | (mp/paypal segun gateway). Metodo de pago.
    referencia           string. Referencia/concepto de transferencia (solo flujo de transferencia). (opcional)
    status               string. 'pendiente' | 'completado'. Estado del pago.
    gateway              map. Datos crudos devueltos por la pasarela (MP/PayPal) al completar. (opcional)
    createdAt            Timestamp.
    updatedAt            Timestamp. (al completar)
  PK: id
  FK: docenteId -> users.id ; subscriptionId -> subscriptions.id ; planId -> plans.id ; escuelaId -> schools.id
  REFERENCIADA POR (FK entrantes): (ninguna)
  ACCESO: read admin o dueño. create docente (solo status 'pendiente') o admin. update/delete solo admin (y backend admin SDK).
  ORIGEN/ESCRITURA: CheckoutModal.jsx / PaymentSimulationModal.jsx (addDoc pendiente, transferencia), api/_lib/billing.js startPayment (add pendiente) y completePayment (update completado + gateway, idempotente). Webhooks: api/mp/webhook.js, api/paypal/capture-order.js disparan completePayment.

-----------------------------------------------------------------
TABLA config(id PK = nombre fijo)
  id PK
    docId con id FIJO. Documento conocido: config/'payments'. Configuracion publica de pagos (solo datos mostrables, sin secretos).
  CAMPOS (doc 'payments'):
    moneda               string. Moneda, default 'MXN'.
    mercadoPago          map { enabled:boolean, publicKey:string }. Datos publicos de MercadoPago.
    paypal               map { enabled:boolean, clientId:string }. Datos publicos de PayPal.
    transferencia        map { enabled:boolean, banco:string, titular:string, cuenta:string, clabe:string, nota:string }. Datos bancarios para transferencia.
    updatedAt            Timestamp. (al guardar)
  PK: id (='payments')
  FK: (ninguna)
  ACCESO: read publico (allow read: true); write solo admin. Los secretos (access tokens / client secrets) NO viven aqui, estan en env vars de Vercel.
  ORIGEN/ESCRITURA: admin/components/PaymentConfig.jsx (setDoc merge). Lectura: hooks/usePaymentConfig.js (getDoc).

-----------------------------------------------------------------
TABLA attendance(id PK)   (NO USADA ACTUALMENTE)
  Mencionada en CLAUDE.md con campos sugeridos: asignaturaId FK->subjects.id, docenteId FK->users.id, fecha.
  No hay lecturas ni escrituras en el codigo (src/ ni api/). Se documenta solo por completitud; el rediseño elimino la asistencia. (no usada)

-----------------------------------------------------------------
RESUMEN DE RELACIONES (FK -> destino):
  users.escuelaId            -> schools.id
  users.studentId            -> students.id        (solo perfil espejo de alumno)
  students.escuelaId         -> schools.id
  students.asignaturaId      -> subjects.id
  students.uid               -> users.id           (uid Auth del alumno)
  subjects.docenteId         -> users.id
  subjects.escuelaId         -> schools.id
  activities.asignaturaId    -> subjects.id
  activities.docenteId       -> users.id
  activities.extensiones[k]  -> students.id         (keys del mapa)
  submissions.alumnoId       -> students.id         (OJO: students.id, no users.id)
  submissions.actividadId    -> activities.id
  subscriptions.docenteId    -> users.id
  subscriptions.planId       -> plans.id
  subscriptions.escuelaId    -> schools.id
  payments.docenteId         -> users.id
  payments.subscriptionId    -> subscriptions.id
  payments.planId            -> plans.id
  payments.escuelaId         -> schools.id

CARDINALIDADES (logicas, no enforced):
  schools 1 -- N users        (una escuela tiene muchos docentes/alumnos)
  schools 1 -- N subjects
  users(docente) 1 -- N subjects
  subjects 1 -- N students    (un alumno = un doc students por asignatura; multi-materia = N docs con mismo uid)
  subjects 1 -- N activities
  activities 1 -- N submissions
  students 1 -- N submissions
  users(docente) 1 -- N subscriptions (historicas; se usa la mas reciente)
  subscriptions 1 -- N payments
  plans 1 -- N subscriptions ; plans 1 -- N payments

INDICES COMPUESTOS DESPLEGADOS (firestore.indexes.json) que reflejan consultas multi-campo:
  students (escuelaId ASC, username ASC)
  students (asignaturaId ASC, username ASC)
  submissions (actividadId ASC, alumnoId ASC)
  activities (asignaturaId ASC, parcial ASC)
  subscriptions (docenteId ASC, status ASC)
  payments (docenteId ASC, status ASC)


