import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import boundaries from 'eslint-plugin-boundaries'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `android` es el proyecto nativo de Capacitor: contiene código Java y, tras
  // `npx cap sync`, una COPIA del bundle web minificado en
  // android/app/src/main/assets/public. Lintarlo no aporta nada y ESLint se
  // queda sin memoria (OOM) intentando parsear esos JS de varios MB en una
  // sola línea. Igual que `dist`, se ignora por completo.
  // .claude/worktrees: copias temporales del repo que crean los agentes para
  // trabajar en aislamiento (ver EnterWorktree). Lintarlas duplica cada
  // hallazgo real y, si quedan huérfanas tras una sesión vieja, ESLint las
  // sigue escaneando igual que si fuera código vivo.
  globalIgnores(['dist', 'android', '.claude/worktrees']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.strict,
      // Solo 'correctness' (clases desconocidas/conflictivas/concatenadas),
      // como warn — no 'stylistic' (orden/wrapping de clases). Medido: las 2
      // reglas de estilo destapan 6,659 hallazgos autofixeables de golpe —
      // el mismo reformateo masivo que prettier-plugin-tailwindcss (ver
      // .prettierrc.json), pendiente de una pasada dedicada y aprobada
      // aparte, no algo para un PR de "candados de arquitectura". Los 102
      // de no-unknown-classes son mezcla de falsos positivos (safe-top/
      // safe-bottom del plugin de Capacitor, ef-* definidas en index.css)
      // y algunos genuinamente sospechosos (bg-accent-tint, text-on-surface-
      // variant no están en tailwind.config.js) — quedan en warn para
      // revisar en Fase 2, no bloquean nada todavía.
      betterTailwindcss.configs['correctness-warn'],
    ],
    languageOptions: {
      // Globals inyectados por vite.config.js (define) en build time.
      // __BUILD_ID__: para UpdateChecker — ver src/components/UpdateChecker.jsx.
      // __BUILD_TIMESTAMP__ / __BUILD_COMMIT__: para AppVersionInfo y sidebars.
      globals: {
        ...globals.browser,
        __BUILD_ID__: 'readonly',
        __BUILD_TIMESTAMP__: 'readonly',
        __BUILD_COMMIT__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      // Versión fijada a mano: el auto-detect ('detect') de eslint-plugin-react
      // llama a context.getFilename(), método que ESLint 10 eliminó -> crash.
      react: { version: '19.2.6' },
      // Tailwind v3 (config JS, no v4 CSS @theme): la clave es tailwindConfig, no entryPoint.
      'better-tailwindcss': { tailwindConfig: 'tailwind.config.js' },
    },
    rules: {
      // Proyecto JS puro sin PropTypes en ningún lado (ni TypeScript) — la regla
      // no encaja con la práctica real del código, solo generaría boilerplate.
      'react/prop-types': 'off',
      // `strict` de jsx-a11y NO añade reglas sobre `recommended` (de hecho tiene
      // una menos) — solo le quita las escapatorias (allowExpressionValues,
      // allowlists) a las reglas que ya estaban activas. Estas 5 reglas están
      // 'off' en AMBAS configs y se activan aquí a mano porque atrapan huecos
      // reales medidos en el código (ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md
      // B-02..B-05): 27 icon-buttons sin nombre accesible, 6 `role="button"` que
      // deberían ser `<button>`, 1 `aria-hidden` sobre elemento enfocable.
      'jsx-a11y/control-has-associated-label': 'error',
      'jsx-a11y/prefer-tag-over-role': 'error',
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      // strict() QUITA esta respecto a recommended — se reactiva a mano.
      'jsx-a11y/anchor-ambiguous-text': 'error',
      'jsx-a11y/lang': 'error',
      // Candados de docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1 (paso 1.2) —
      // los mismos 4 patrones que scripts/check-ui-standards.sh, pero en el editor
      // en vez de solo al correr el script. Los 56 archivos con deuda YA existente
      // (37+15+23+17, algunos se repiten) están exceptuados más abajo — igual que
      // el script bash, esta regla bloquea que la deuda CREZCA, no exige arreglar
      // hoy lo viejo (eso es Fase 3/5). Re-generar la lista de excepciones con los
      // comandos de la Fase 1 del plan si se agrega/quita algún archivo.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/fixed inset-0/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/fixed inset-0/]",
          message:
            'Modal a mano (fixed inset-0) — usa components/ui/Modal.jsx en vez de reimplementar el patrón. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 3.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\bh-screen\\b/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\bh-screen\\b/]",
          message:
            'h-screen se rompe con la barra de URL de Chrome Android — usa h-[100dvh]. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 5.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/[0-9]+vh\\b/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/[0-9]+vh\\b/]",
          message:
            'vh crudo no considera la barra de direcciones móvil — usa dvh/svh/lvh. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 5.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(min-)?[wh]-\\[[0-9]+px\\]/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/(min-)?[wh]-\\[[0-9]+px\\]/]",
          message:
            'Ancho/alto en píxeles duros — usa los tokens de src/config/layout.js o unidades relativas de Tailwind.',
        },
      ],
    },
  },
  // components/ui/Modal.jsx es la implementación canónica del patrón "fixed
  // inset-0" (docs/DESIGN_SYSTEM.md §6.7) — excepción permanente, no deuda.
  // Va DESPUÉS del bloque general para ganarle en la cascada de flat config.
  {
    files: ['src/components/ui/Modal.jsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\bh-screen\\b/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\bh-screen\\b/]",
          message:
            'h-screen se rompe con la barra de URL de Chrome Android — usa h-[100dvh]. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 5.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/[0-9]+vh\\b/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/[0-9]+vh\\b/]",
          message:
            'vh crudo no considera la barra de direcciones móvil — usa dvh/svh/lvh. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 5.',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(min-)?[wh]-\\[[0-9]+px\\]/], JSXAttribute[name.name='className'] TemplateElement[value.raw=/(min-)?[wh]-\\[[0-9]+px\\]/]",
          message:
            'Ancho/alto en píxeles duros — usa los tokens de src/config/layout.js o unidades relativas de Tailwind.',
        },
      ],
    },
  },
  // Deuda ya existente de los 4 patrones de arriba (medida en
  // docs/BASELINE_A11Y.md / PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1) —
  // se apaga la regla completa por archivo en vez de arreglar todo de golpe.
  // scripts/check-ui-standards.sh sigue siendo la fuente de verdad (cuenta
  // ocurrencias, no archivos, y sube de severidad si el número CRECE); esta
  // lista solo evita ruido en el editor mientras se migra en Fase 3/5.
  // Los 7 archivos "Creditos*/CrearActividadIA*/CrearEvaluacionIA*/
  // AnalisisResultadosIA/ReactivosIAReview/PlaneacionInicialSection/
  // MexicoMap" se sumaron al mergear main (feature de IA/Planeación
  // desarrollada en paralelo, 234 commits) — mismo patrón, deuda nueva de
  // ESE trabajo, no de este plan.
  {
    files: [
      'src/components/AdminLayout.jsx',
      'src/components/ConfirmacionCreditosModal.jsx',
      'src/components/CrearActividadIAModal.jsx',
      'src/components/CrearEvaluacionIAModal.jsx',
      'src/components/CreditosPanel.jsx',
      'src/components/admin/MexicoMap.jsx',
      'src/components/evaluacion/AnalisisResultadosIA.jsx',
      'src/components/evaluacion/ReactivosIAReview.jsx',
      'src/components/subject/PlaneacionInicialSection.jsx',
      'src/components/AttachmentList.jsx',
      'src/components/AvatarCropModal.jsx',
      'src/components/CheckoutModal.jsx',
      'src/components/EntregableEditor.jsx',
      'src/components/EvaluacionEditor.jsx',
      'src/components/EvaluacionGraficas.jsx',
      'src/components/EvaluacionManager.jsx',
      'src/components/Fireworks.jsx',
      'src/components/IconSelect.jsx',
      'src/components/Layout.jsx',
      'src/components/NotificationLog.jsx',
      'src/components/NuevaFechaEntregaModal.jsx',
      'src/components/PdfCanvasPreview.jsx',
      'src/components/PushPermissionPrimer.jsx',
      'src/components/RichTextEditor.jsx',
      'src/components/StudentLayout.jsx',
      'src/components/SuscripcionVencidaModal.jsx',
      'src/components/ZoomableImage.jsx',
      'src/components/agenda/StudentEventEditor.jsx',
      'src/components/calendar/EventEditor.jsx',
      'src/components/calendar/ProgramarBloquesModal.jsx',
      'src/components/calendar/ProgramarZonaSemanal.jsx',
      'src/components/rubrica/ListaCotejoEditor.jsx',
      'src/components/rubrica/RubricaEditor.jsx',
      'src/components/rubrica/RubricaPicker.jsx',
      'src/components/subject/AvisoLecturaModal.jsx',
      'src/components/subject/AvisosTab.jsx',
      'src/components/ui/Select.jsx',
      'src/pages/Landing.jsx',
      'src/pages/Privacidad.jsx',
      'src/pages/admin/components/PaymentsTable.jsx',
      'src/pages/admin/components/StudentsTable.jsx',
      'src/pages/admin/components/SubscriptionsTable.jsx',
      'src/pages/student/Activation.jsx',
      'src/pages/student/Agenda.jsx',
      'src/pages/student/Dashboard.jsx',
      'src/pages/student/EvaluacionRevision.jsx',
      'src/pages/student/EvaluacionRunner.jsx',
      'src/pages/student/Login.jsx',
      'src/pages/student/NotificationSettings.jsx',
      'src/pages/student/SubjectPage.jsx',
      'src/pages/teacher/ActivityPage.jsx',
      'src/pages/teacher/CalendarPage.jsx',
      'src/pages/teacher/Dashboard.jsx',
      'src/pages/teacher/Login.jsx',
      'src/pages/teacher/NotificationSettings.jsx',
      'src/pages/teacher/Onboarding.jsx',
      'src/pages/teacher/PagoResultado.jsx',
      'src/pages/teacher/Profile.jsx',
      'src/pages/teacher/ProtectAccount.jsx',
      'src/pages/teacher/Register.jsx',
      'src/pages/teacher/ResetPassword.jsx',
      'src/pages/teacher/SubjectPage.jsx',
      'src/pages/teacher/VerifyEmail.jsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // pages/ no debe declarar <input>/<select>/<table> crudos — debe importar
  // de components/ui/ (Input, Select, Table). eslint-plugin-boundaries NO
  // sirve para esto: gobierna el grafo de imports entre carpetas, y aquí no
  // hay ningún import que interceptar — <input> es una etiqueta JSX nativa.
  // no-restricted-syntax sí puede mirar el AST de JSX directamente.
  // Ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1, paso 1.3.
  {
    files: ['src/pages/**/*.jsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='input']",
          message:
            'Usa <Input> de components/ui en vez de <input> crudo. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 3, paso 3.5.',
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            'Usa <Select> de components/ui en vez de <select> crudo. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 3, paso 3.5.',
        },
        {
          selector: "JSXOpeningElement[name.name='table']",
          message:
            'Usa <Table> de components/ui en vez de <table> crudo. Ver PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 3, paso 3.6.',
        },
      ],
    },
  },
  // Deuda ya existente de <input>/<select>/<table> crudos en pages/ (medida
  // en la Fase 1 con el AST real de ESLint — un grep de línea se queda
  // corto en elementos JSX con atributos en varias líneas) — se apaga la
  // regla completa por archivo, igual que el bloque de arriba, mientras se
  // migra en Fase 3.
  {
    files: [
      'src/pages/admin/components/PaymentConfig.jsx',
      'src/pages/admin/components/PaymentsTable.jsx',
      'src/pages/admin/components/StatsCards.jsx',
      'src/pages/admin/components/StudentsTable.jsx',
      'src/pages/admin/components/SubscriptionsTable.jsx',
      'src/pages/student/Activation.jsx',
      'src/pages/student/ActivityPage.jsx',
      'src/pages/student/Dashboard.jsx',
      'src/pages/student/EvaluacionRunner.jsx',
      'src/pages/student/Login.jsx',
      'src/pages/student/NotificationSettings.jsx',
      'src/pages/student/Profile.jsx',
      'src/pages/teacher/ActivityPage.jsx',
      'src/pages/teacher/CalendarPage.jsx',
      'src/pages/teacher/Dashboard.jsx',
      'src/pages/teacher/NotificationSettings.jsx',
      'src/pages/teacher/Onboarding.jsx',
      'src/pages/teacher/Profile.jsx',
      'src/pages/teacher/Register.jsx',
      'src/pages/teacher/SubjectPage.jsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Candado arquitectónico real (este sí es un problema de grafo de
  // imports, el caso de uso correcto de eslint-plugin-boundaries): la
  // librería compartida components/ui/ es la base de todo el sistema de
  // diseño — si empieza a importar de pages/, deja de ser reutilizable y
  // cualquier cambio ahí puede romper páginas sin relación aparente. Solo
  // se define 'ui' vs 'pages' (no un tipo genérico 'components') porque
  // 'src/components/**' incluiría a 'src/components/ui/**' por estar
  // anidado — evita depender de un orden de resolución de patrones no
  // documentado por el plugin. Sintaxis v7 (policies), no la v5/v6 (rules)
  // que generaba warnings de deprecación.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'ui', pattern: 'src/components/ui/**' },
        { type: 'pages', pattern: 'src/pages/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'ui' } },
              disallow: { to: { element: { type: 'pages' } } },
              message:
                'components/ui/ no puede importar de pages/ — rompe la reutilización del sistema de diseño.',
            },
          ],
        },
      ],
    },
  },
  // Cloud Functions — paquete Node CommonJS aparte (su propio package.json),
  // no el SPA de React: globals de Node (require/exports/module), sin las
  // reglas de React/JSX que no aplican aquí.
  {
    files: ['functions/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  // seeds-db — otro paquete Node aparte (su propio package.json, sin
  // "type": "module", así que es CommonJS pese a que el root sí es ESM).
  // Scripts de un solo uso para poblar/limpiar Firestore vía Admin SDK.
  {
    files: ['seeds-db/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  // api/ (funciones serverless de Vercel), Avatar/ (scripts CLI) y los
  // archivos sueltos de config/tooling en la raíz: Node vía ESM, heredan
  // "type": "module" del package.json raíz.
  {
    files: ['api/**/*.js', 'Avatar/**/*.js', 'vite.config.js', 'voice-pipeline.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
  },
])
