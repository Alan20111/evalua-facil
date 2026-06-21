/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Role/subject accent — resolved from CSS variables (see src/index.css).
        // Default is blue (docente); [data-role="alumno"] switches it to orange;
        // [data-subject-palette="..."] overrides it inside a subject's pages.
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          light: 'var(--accent-light)',
        },
      },
    },
  },
  plugins: [],
}
