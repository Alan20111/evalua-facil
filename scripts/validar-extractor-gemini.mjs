// VALIDACIÓN REAL del extractor de contenido de video (functions/extraccionVideoGemini.js).
// Herramienta de diagnóstico AISLADA: invoca el módulo directamente, en este proceso. No usa
// ejecutarOperacionIA, no llama a Claude, no toca Firestore ni créditos, no crea documentos.
// Hace UNA llamada real a Gemini por video (con los reintentos normales del extractor).
//
// La clave llega por la variable de entorno GEMINI_API_KEY de ESTE proceso y nunca se imprime.
// Con el secreto definitivo ya cargado no hace falta ningún archivo con claves:
//
//   GEMINI_API_KEY="$(firebase functions:secrets:access GEMINI_API_KEY)" \
//     node scripts/validar-extractor-gemini.mjs <url-de-youtube> <duracion-según-YouTube-en-segundos>
//
// La duración de YouTube se escribe a mano, mirando el reproductor: es la única fuente fiable
// para medir cuánto se equivoca `duracionSeg`. Sin ese dato, la comparación queda «no verificada».
import { createRequire } from 'node:module'

const [url, duracionYoutube] = process.argv.slice(2)
if (!url) {
  console.error('uso: GEMINI_API_KEY=… node scripts/validar-extractor-gemini.mjs <url-youtube> [duracion-youtube-seg]')
  process.exit(2)
}
if (!process.env.GEMINI_API_KEY) {
  console.error('Falta la variable de entorno GEMINI_API_KEY (ver el encabezado de este archivo).')
  process.exit(2)
}
process.env.GCLOUD_PROJECT ||= 'demo-validacion'

const require = createRequire(import.meta.url)
const EX = require('../functions/extraccionVideoGemini.js')

const t0 = Date.now()
let c
try {
  c = await EX.extraerContenidoVideo(url)
} catch (e) {
  console.log(JSON.stringify({ RESULTADO: 'ERROR', codigo: e.codigo, transitorio: e.transitorio, detalle: e.detalle, mensaje: e.message, ms: Date.now() - t0 }, null, 1))
  process.exit(1)
}
const ms = Date.now() - t0
const real = Number(duracionYoutube) || null
const marcas = c.segmentos.map((s) => s.inicioSeg)
const resumen = {
  RESULTADO: 'OK', videoId: c.videoId, modelo: c.modelo, intentos: c.uso.intentos, latenciaTotalMs: ms,
  tokens: { entrada: c.uso.tokensEntrada, video: c.uso.tokensVideo, salida: c.uso.tokensSalida, pensamiento: c.uso.tokensPensamiento },
  idioma: c.idioma, habla: c.habla,
  segmentos: c.segmentos.length, caracteres: c.caracteres, descartados: c.descartados,
  caracteresPorSegmento: Math.round(c.caracteres / Math.max(1, c.segmentos.length)),
  marcas: {
    numericas: marcas.every(Number.isFinite),
    ordenadas: marcas.every((m, i) => i === 0 || m >= marcas[i - 1]),
    primera: marcas[0],
    ultima: marcas[marcas.length - 1],
    dentroDeLaDuracionReal: real ? marcas.every((m) => m <= real) : 'no verificado (falta la duración de YouTube)',
  },
  cobertura: c.cobertura,
  duracion: {
    extractor: c.duracionSeg, fuente: c.duracionFuente, confiable: c.duracionConfiable, youtube: real,
    diferenciaSeg: real ? c.duracionSeg - real : null,
    diferenciaPct: real ? Math.round(((c.duracionSeg - real) / real) * 1000) / 10 : null,
  },
  suficiencia: Object.fromEntries([3, 5, 10, 15, 20].map((n) => {
    const e = EX.evaluarSuficiencia(c, n)
    return [`para_${n}`, e.suficiente ? 'sí' : `no (${e.motivo})`]
  })),
  maximoPreguntasQueRespalda: EX.evaluarSuficiencia(c, 1).maximoPreguntas,
}
console.log(JSON.stringify(resumen, null, 1))
console.log('\n--- CONTENIDO EXTRAÍDO (de un video público; para revisar su calidad) ---')
console.log(c.texto)
