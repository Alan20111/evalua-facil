import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
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
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      // __BUILD_ID__: inyectado por vite.config.js (define) en build time —
      // ver src/components/UpdateChecker.jsx.
      globals: { ...globals.browser, __BUILD_ID__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      // Versión fijada a mano: el auto-detect ('detect') de eslint-plugin-react
      // llama a context.getFilename(), método que ESLint 10 eliminó -> crash.
      react: { version: '19.2.6' },
    },
    rules: {
      // Proyecto JS puro sin PropTypes en ningún lado (ni TypeScript) — la regla
      // no encaja con la práctica real del código, solo generaría boilerplate.
      'react/prop-types': 'off',
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
