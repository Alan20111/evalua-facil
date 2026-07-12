import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
      globals: globals.browser,
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
])
