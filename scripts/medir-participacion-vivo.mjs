#!/usr/bin/env node
// Mide con el MODELO REAL cuánto tarda y cuánto cuesta Participación en vivo.
//
// Usa el MISMO código de producción (functions/ia.js → pedirJSON y los prompts de functions/participacionVivo.js),
// pero NO toca Firestore, créditos ni datos: solo llama al modelo con un contenido de ejemplo y escribe un informe.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/medir-participacion-vivo.mjs [--respuestas=6] [--modelo=claude-haiku-4-5]
//
// · La llave va por variable de entorno TEMPORAL (nunca en un archivo ni en el repo). Debe ser de PRUEBA: CLAUDE.md
//   prohíbe usar o crear llaves de prueba en el Secret Manager de producción.
// · Costo estimado: 1 generación + N evaluaciones (por omisión 6) + una ráfaga de N en paralelo ≈ centavos de dólar.
// · Precios por millón de tokens (los de config/iaTarifas.costosAnthropicUSD al 21-oct-2026; cámbialos con
//   --precio-entrada=1 --precio-salida=5 si cambiaron).
import { createRequire } from 'node:module'

const require = createRequire(new URL('../functions/index.js', import.meta.url))
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d
const N = Math.min(12, Math.max(1, Number(arg('respuestas', 6))))
const MODELO = arg('modelo', 'claude-haiku-4-5')
const P_IN = Number(arg('precio-entrada', 1))
const P_OUT = Number(arg('precio-salida', 5))
const CLAVE = process.env.ANTHROPIC_API_KEY
if (!CLAVE || !/^sk-ant-[\x21-\x7E]{20,}$/.test(CLAVE)) {
  console.error('Falta ANTHROPIC_API_KEY (de PRUEBA) en el entorno, o tiene una forma inválida. No se hizo ninguna llamada.')
  process.exit(2)
}

// pedirJSON vive dentro de ia.js, que declara secretos de Firebase al cargarse: se les da un valor ficticio.
process.env.ANTHROPIC_API_KEY_PROD = CLAVE
process.env.GCLOUD_PROJECT = 'demo-medicion'
const { initializeApp } = require('firebase-admin/app')
initializeApp({ projectId: 'demo-medicion' })
const Anthropic = require('@anthropic-ai/sdk')
const ia = require('../functions/ia.js')
const PV = require('../functions/participacionVivo.js')._pruebas
const cliente = new Anthropic({ apiKey: CLAVE, timeout: 25000, maxRetries: 0 })

const costo = (i) => ((i.tokensEntrada || 0) * P_IN + (i.tokensSalida || 0) * P_OUT) / 1e6
const f = (n, d = 4) => (typeof n === 'number' ? n.toFixed(d) : 'n/d')
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(p * arr.length) - 1)]

const CONTEXTO = 'La fotosíntesis es el proceso por el cual las plantas, algas y algunas bacterias convierten la energía de la luz solar en energía química. ' +
  'Ocurre en los cloroplastos, donde la clorofila absorbe la luz. Las plantas toman agua por las raíces y dióxido de carbono del aire; con la luz producen glucosa y liberan oxígeno. La glucosa es el alimento de la planta.'
const RESPUESTAS = [
  'Las plantas usan la luz del sol para fabricar glucosa, que es su alimento',
  'La convierten en energía química que guardan como azúcar',
  'Para que la clorofila de las hojas se ponga verde',
  'La luz les da calor y por eso crecen',
  'No sé, creo que respiran el oxígeno del aire gracias al sol',
  'Transforman la energía de la luz en glucosa usando agua y dióxido de carbono',
  'Se la comen', 'Hacen fotosíntesis para producir su comida a partir de la luz', 'Nada, solo la reciben', 'Producen oxígeno y azúcar con la luz y el agua',
  'La absorben con la clorofila y la usan como energía', 'Les sirve para florecer',
]

const medir = async (etiqueta, fn) => {
  const t0 = Date.now()
  try { const { datos, interno } = await fn(); return { etiqueta, ok: true, ms: Date.now() - t0, interno, datos } } catch (e) { return { etiqueta, ok: false, ms: Date.now() - t0, error: e.message } }
}

console.log(`Modelo ${MODELO} · precios $${P_IN}/MTok entrada, $${P_OUT}/MTok salida\n`)

// 1. Generación (6 cr): 4 preguntas con un contenido corto
const ctxGen = { proposito: 'previos', cantidad: 4, contexto: CONTEXTO, bloqueFuentes: '', fuentesBloques: [] }
const gen = await medir('generación', () => ia._pruebas.pedirJSON({ client: cliente, modelo: MODELO, maxTokens: 3500, system: PV.SISTEMA_GENERAR, prompt: PV.promptGenerar(ctxGen, 'Biología') }))
console.log(`GENERACIÓN: ${gen.ok ? 'ok' : 'FALLÓ ' + gen.error} · ${gen.ms} ms` + (gen.ok ? ` · ${gen.interno.tokensEntrada} tok entrada / ${gen.interno.tokensSalida} salida · $${f(costo(gen.interno))}` : ''))
const preguntas = gen.ok ? (gen.datos.preguntas || []) : []
const abierta = preguntas.find((p) => p.tipo === 'abierta_extensa') || preguntas.find((p) => p.tipo === 'abierta_breve') ||
  { enunciado: '¿Qué hacen las plantas con la luz del sol?', criterios: 'Debe mencionar la conversión en glucosa', esperada: 'Convierten la luz en glucosa', conceptos: ['glucosa', 'energía química', 'clorofila'] }
const resumen = gen.ok ? gen.datos.resumenContenido : CONTEXTO

const evaluar = (texto) => ia._pruebas.pedirJSON({
  client: cliente, modelo: MODELO, maxTokens: 350, system: PV.SISTEMA_EVALUAR,
  prompt: PV.promptEvaluar({ resumen, pregunta: abierta, clave: abierta, texto, proposito: 'previos' }),
})

// 2. Evaluación una por una (latencia de una respuesta aislada)
const textos = RESPUESTAS.slice(0, N)
const secuencial = []
for (const t of textos) secuencial.push(await medir('evaluación', () => evaluar(t)))
// 3. Ráfaga: todas a la vez (lo que pasa cuando el grupo contesta al mismo tiempo)
const t0 = Date.now()
const rafaga = await Promise.all(textos.map((t) => medir('ráfaga', () => evaluar(t))))
const msRafaga = Date.now() - t0

const resumenGrupo = (nombre, filas) => {
  const ok = filas.filter((x) => x.ok)
  const ms = ok.map((x) => x.ms)
  const tin = ok.reduce((a, x) => a + x.interno.tokensEntrada, 0)
  const tout = ok.reduce((a, x) => a + x.interno.tokensSalida, 0)
  const usd = ok.reduce((a, x) => a + costo(x.interno), 0)
  console.log(`${nombre}: ${ok.length}/${filas.length} ok · latencia mediana ${pct(ms, 0.5)} ms, p95 ${pct(ms, 0.95)} ms, máx ${Math.max(...ms)} ms` +
    ` · por respuesta ≈ ${Math.round(tin / ok.length)} tok entrada / ${Math.round(tout / ok.length)} salida · $${f(usd / ok.length, 5)} c/u`)
  return { usd, n: ok.length, usdPorRespuesta: usd / ok.length }
}
const s = resumenGrupo('EVALUACIÓN (una por una)', secuencial)
const r = resumenGrupo(`RÁFAGA de ${N} a la vez`, rafaga)
console.log(`  la ráfaga completa terminó en ${msRafaga} ms (la última respuesta esperó ese tiempo)`)
const niveles = rafaga.filter((x) => x.ok).map((x) => x.datos.nivel)
console.log(`  niveles devueltos: ${niveles.join(', ')}`)

// 4. Márgen de la cuota: 10 créditos por sesión con tope de 40 respuestas
const peor = (gen.ok ? costo(gen.interno) : 0)
const tope40 = r.usdPorRespuesta * 40
console.log(`\nCUOTA DE 10 CRÉDITOS (tope 40 respuestas): costo del modelo ≈ $${f(tope40)} USD en el peor caso de la sesión; generación ≈ $${f(peor)} USD (6 créditos).`)
console.log('Compara contra lo que cobras por crédito (config/iaTarifas / docs) para el margen real. Los precios usados son los pasados por parámetro.')
const fallos = [...secuencial, ...rafaga, gen].filter((x) => !x.ok)
if (fallos.length) { console.log(`\nFALLAS: ${fallos.map((x) => `${x.etiqueta}: ${x.error}`).join(' | ')}`); process.exit(1) }
