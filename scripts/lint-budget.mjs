// Candado de presupuesto para `npm run lint` — mismo principio que el
// ratchet() de scripts/check-ui-standards.sh, aplicado al conteo TOTAL de
// problemas de ESLint en vez de a un puñado de patrones grep.
//
// Por qué existe: al activar jsx-a11y strict + las reglas opt-in de la
// Fase 0/1 (docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md), `eslint .` pasó de
// 87 a 128 problemas — 63 de ellos deuda de accesibilidad ya documentada
// como backlog de Fase 2 (docs/BASELINE_A11Y.md), no algo que se arregla en
// una sesión de "candados de arquitectura". Si CI exigiera `eslint .` limpio
// de golpe, el pipeline nacería en rojo y todo el mundo aprendería a
// ignorarlo. Este script dejar pasar la deuda de HOY pero bloquea que CREZCA.
//
// Para bajar el presupuesto (progreso real): arreglar problemas y correr
// `node scripts/lint-budget.mjs --write` para grabar el nuevo número.
//
// Nota de plataforma: el conteo puede variar ±1 entre Windows (dev local) y
// Ubuntu (CI) — visto en la práctica al mergear fix/a11y-fase-1 (253 local,
// 254 en CI). El número grabado en .eslint-budget.json es siempre el que
// reporta CI (ubuntu-latest), no el de la máquina de desarrollo — es la
// corrida que de verdad bloquea el merge.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const baselineFile = path.join(root, '.eslint-budget.json')
const write = process.argv.includes('--write')

let raw
try {
  // execSync (no execFileSync): en Windows npx es un .cmd y execFileSync no
  // lo lanza sin pasar por una shell. El comando es un literal fijo sin
  // input externo interpolado, así que no hay riesgo de inyección.
  raw = execSync('npx eslint . -f json', { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 })
} catch (err) {
  // ESLint sale con código 1 cuando encuentra problemas — es esperado, el
  // JSON sigue en stdout. Solo re-lanzar si de plano no hay salida (crash real).
  raw = err.stdout
  if (!raw) {
    console.error(err.stderr || err.message)
    process.exit(1)
  }
}

const results = JSON.parse(raw)
const count = results.reduce((sum, f) => sum + f.messages.length, 0)

if (write) {
  writeFileSync(baselineFile, JSON.stringify({ maxProblems: count }, null, 2) + '\n')
  console.log(`✅ Presupuesto grabado: ${count} problemas (.eslint-budget.json)`)
  process.exit(0)
}

if (!existsSync(baselineFile)) {
  console.error(`❌ No existe ${baselineFile}. Corre "node scripts/lint-budget.mjs --write" para crearlo.`)
  process.exit(1)
}

const { maxProblems } = JSON.parse(readFileSync(baselineFile, 'utf8'))

if (count > maxProblems) {
  console.error(`❌ ESLint: ${count} problemas — supera el presupuesto de ${maxProblems}.`)
  console.error(`   Corre "npm run lint" para ver el detalle. No agregues código nuevo con errores de lint.`)
  process.exit(1)
}

if (count < maxProblems) {
  console.log(`✅ ESLint: ${count} problemas (¡bajó de ${maxProblems}!). Corre "node scripts/lint-budget.mjs --write" para grabar el nuevo presupuesto y que el candado no se relaje.`)
} else {
  console.log(`✅ ESLint: ${count} problemas (presupuesto: ${maxProblems}, sin crecer).`)
}
