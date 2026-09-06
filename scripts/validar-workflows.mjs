#!/usr/bin/env node
// Comprueba que los workflows de .github/workflows/ sean YAML válido y tengan
// nombre y pasos.
//
// Existe por un fallo real y silencioso: un texto multilínea mal indentado
// dentro de un `run: |` rompió release-apk.yml entero. El archivo seguía ahí,
// GitHub no marcó ningún error visible, pero dejó de reconocer el workflow por
// su nombre — y con eso el botón del panel de admin y `gh workflow run`
// dejaron de encontrarlo. Se descubrió por casualidad al intentar lanzarlo.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const DIR = '.github/workflows'
let fallos = 0

for (const archivo of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const ruta = join(DIR, archivo)
  try {
    const doc = yaml.load(readFileSync(ruta, 'utf8'))
    if (!doc?.name) throw new Error('sin `name`')
    if (!doc?.jobs || Object.keys(doc.jobs).length === 0) throw new Error('sin `jobs`')
    for (const [id, job] of Object.entries(doc.jobs)) {
      if (!Array.isArray(job.steps) || job.steps.length === 0) {
        throw new Error(`el job "${id}" no tiene pasos`)
      }
    }
    console.log(`✓ ${archivo} — "${doc.name}"`)
  } catch (err) {
    console.error(`✗ ${archivo} — ${err.message}`)
    fallos++
  }
}

if (fallos > 0) {
  console.error(`\n${fallos} workflow(s) con problemas.`)
  process.exit(1)
}
console.log('\n✅ Workflows válidos.')
