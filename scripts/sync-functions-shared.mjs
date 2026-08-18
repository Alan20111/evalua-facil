// Copia lógica PURA de src/utils/ (calendario/sesiones y, desde el
// Asistente General, promedios de calificación) hacia functions/_shared/
// como CommonJS, para que Cloud Functions tenga su propia copia desplegable
// sin duplicar el código a mano.
//
// Por qué existe: Cloud Functions (functions/) es un proyecto npm aparte,
// CommonJS, Node 20 fijo (functions/package.json → engines.node), y
// `firebase deploy --only functions` empaqueta SOLO el contenido de esa
// carpeta — nada de src/ se sube. Y src/utils/ es ESM pensado para Vite
// (algunos archivos vecinos, como attendanceAuto.js, importan
// import.meta.env vía src/firebase.js y no cargan fuera del navegador). Las
// funciones de ESTA lista sí son 100% puras (verificado: cargan bajo Node
// plano sin Firebase), así que se pueden convertir a CommonJS de forma
// mecánica y servir como la copia real de Cloud Functions.
//
// `require(esm)` síncrono existe en Node reciente pero no es confiable en
// Node 20 (el runtime real declarado en functions/package.json) — por eso la
// copia se genera en CommonJS y no como .mjs (ver docs/… si se documenta la
// decisión; de momento el porqué vive aquí).
//
// La fuente de verdad SIGUE siendo src/utils/*.js. Esta carpeta generada
// (functions/_shared/) nunca se edita a mano ni se commitea (.gitignore) —
// se regenera aquí, en cada predeploy de functions (ver firebase.json).
//
// Uso: node scripts/sync-functions-shared.mjs

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const srcDir = path.join(root, 'src', 'utils')
const outDir = path.join(root, 'functions', '_shared')

// Únicamente los módulos puros que ya verificamos que cargan sin Firebase.
// Si algún día uno de estos archivos gana un import fuera de esta lista, el
// script debe fallar (ver validarImports) en vez de sincronizar algo roto.
const ARCHIVOS = [
  'horarioBloques.js', 'parciales.js', 'sesionesReales.js', 'asuetos.js', 'vacaciones.js', 'ponderacion.js',
  // Chat con Acciones (18-ago-2026): la creación de actividades/exámenes
  // confirmada desde el chat pasa a ejecutarse en el servidor (para que el
  // cobro y la creación sean atómicos) — resolveVisibilidad es la misma
  // máquina de estados de "publicar de inmediato por default" que ya usan
  // los editores manuales, no una reimplementación.
  'formatHora.js', 'nowIso.js', 'activityVisibility.js',
  // Defaults de configuración de examen (EvaluacionEditor.jsx) — el mismo
  // objeto que usa el editor manual, para que un examen creado desde el
  // chat quede con la misma configuración que uno creado a mano.
  'evaluacionDefaults.js',
  // Tarifa escalonada del examen del chat (18-ago-2026) — MISMA función que
  // usa el cliente para mostrar el costo antes de confirmar; el servidor
  // vuelve a calcularla aquí desde el número real de reactivos, nunca
  // confía en lo que mostró la tarjeta.
  'tarifaExamen.js',
]

function fallar(mensaje) {
  console.error(`\n✗ sync-functions-shared: ${mensaje}\n`)
  process.exit(1)
}

// Solo se permite importar, dentro de este grupo, a otro archivo de la MISMA
// lista — así nunca se cuela un import a Firebase/Vite sin que el script lo
// note. Cualquier otro import (paquete de npm, ruta fuera de src/utils, un
// archivo de src/utils que no esté en ARCHIVOS, o cualquier sintaxis de
// import que no sea exactamente "import { A, B } from './archivo.js'") hace
// fallar la sincronización en vez de intentar adivinar cómo convertirlo.
function validarImports(nombre, codigo) {
  const permitidos = new Set(ARCHIVOS)
  const lineaEsperada = /^import\s+\{([^}]+)\}\s+from\s+'\.\/([\w.]+)'$/
  const todasLasLineasDeImport = codigo.match(/^import\s+.+$/gm) || []
  const specs = []
  for (const linea of todasLasLineasDeImport) {
    const m = linea.match(lineaEsperada)
    if (!m) fallar(`${nombre} tiene un import que el script no sabe convertir: "${linea}". Solo se admite "import { A, B } from './archivo.js'".`)
    const archivoImportado = m[2].endsWith('.js') ? m[2] : `${m[2]}.js`
    if (!permitidos.has(archivoImportado)) {
      fallar(`${nombre} importa '${m[2]}', que no está en la lista de módulos puros compartidos (${ARCHIVOS.join(', ')}). No se sincroniza — revísalo antes de agregarlo aquí.`)
    }
    specs.push({ nombres: m[1].split(',').map((s) => s.trim()).filter(Boolean), archivo: archivoImportado })
  }
  return specs
}

// export function nombre(...)  →  function nombre(...)
// export const NOMBRE = ...    →  const NOMBRE = ...
// Devuelve el código transformado y la lista de nombres exportados.
function transformarAExportsCJS(codigo) {
  const nombres = []
  let out = codigo.replace(/^export\s+function\s+(\w+)/gm, (_, nombre) => {
    nombres.push(nombre)
    return `function ${nombre}`
  })
  out = out.replace(/^export\s+const\s+(\w+)/gm, (_, nombre) => {
    nombres.push(nombre)
    return `const ${nombre}`
  })
  if (nombres.length === 0) fallar('un archivo no tiene ningún "export function"/"export const" reconocible — revisa el patrón de exportación.')
  return { codigo: out, nombres }
}

function transformarImports(codigo, specs) {
  let out = codigo
  for (const { nombres, archivo } of specs) {
    const linea = new RegExp(`^import\\s+\\{[^}]+\\}\\s+from\\s+'\\./${archivo.replace('.js', '')}(\\.js)?'\\s*$`, 'm')
    out = out.replace(linea, `const { ${nombres.join(', ')} } = require('./${archivo}')`)
  }
  return out
}

function generar() {
  if (!existsSync(srcDir)) fallar(`no existe ${srcDir}`)

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  for (const nombre of ARCHIVOS) {
    const rutaOrigen = path.join(srcDir, nombre)
    if (!existsSync(rutaOrigen)) fallar(`falta el archivo fuente ${rutaOrigen}`)

    const original = readFileSync(rutaOrigen, 'utf8')
    const specs = validarImports(nombre, original)
    const conImportsConvertidos = transformarImports(original, specs)
    const { codigo, nombres } = transformarAExportsCJS(conImportsConvertidos)

    const cabecera = `// GENERADO por scripts/sync-functions-shared.mjs a partir de src/utils/${nombre}.\n` +
      `// No editar a mano — los cambios se pierden en el próximo predeploy.\n\n`
    const pie = `\nmodule.exports = { ${nombres.join(', ')} }\n`

    writeFileSync(path.join(outDir, nombre), cabecera + codigo + pie, 'utf8')
  }

  // Smoke test: requerir cada archivo generado de verdad (no solo revisar
  // que el texto se escribió) — si alguna transformación produjo JS
  // inválido, o algún export quedó vacío/undefined, esto revienta aquí y no
  // en medio de un deploy.
  const require = createRequire(import.meta.url)
  for (const nombre of ARCHIVOS) {
    const ruta = path.join(outDir, nombre)
    let mod
    try {
      mod = require(ruta)
    } catch (err) {
      fallar(`el archivo generado ${nombre} no carga con require(): ${err.message}`)
    }
    const claves = Object.keys(mod)
    if (claves.length === 0) fallar(`el archivo generado ${nombre} no exporta nada`)
    for (const clave of claves) {
      if (typeof mod[clave] !== 'function' && typeof mod[clave] !== 'object') {
        fallar(`${nombre}: el export '${clave}' no es una función ni un objeto/array (¿transformación incompleta?)`)
      }
    }
  }

  console.log(`✓ functions/_shared/ generado (${ARCHIVOS.length} archivos): ${ARCHIVOS.join(', ')}`)
}

generar()
