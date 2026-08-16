// Formaliza el estilo que el repo ya usa en la práctica (ver `git log`:
// "fix(a11y): ...", "docs(calidad): ...", "chore(admin): ..."). No cambia
// ninguna convención, solo la hace obligatoria.
// Ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md Fase 1, paso 1.4 (H-10).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // El default de config-conventional exige subject en minúscula/no-Title-Case.
    // El historial real del repo mezcla ambos ("docs(calidad): las llaves..."
    // en minúscula, pero también "docs(calidad): A17 ejecutada y documentada",
    // "fix(a11y): Fase 0 del plan..." con sustantivo propio en mayúscula) —
    // formalizar el patrón existente significa no romper commits que ya
    // encajan con la práctica real del equipo.
    'subject-case': [0],
  },
}
