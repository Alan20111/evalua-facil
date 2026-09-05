// Aritmética del costo de IA y de la serie diaria del panel de admin.
//
// Vive en src/utils/ (y NO en functions/) porque scripts/sync-functions-shared.mjs
// la copia a functions/_shared/costosIA.js como CommonJS: así el servidor y el
// cliente comparten una sola fórmula de precios en vez de dos que se van
// separando con el tiempo. Es 100% pura — sin Firestore, sin red, sin
// `import.meta` — que es justo el requisito de esa lista.
//
// Qué NO vive aquí: leer `config/iaTarifas` (eso es Firestore, se queda en
// obtenerConfigCostos) y decidir quién puede ver estos números (eso es la
// verificación de rol del callable).

// ── Costo real de una llamada a Anthropic ──────────────────────────────────
// Movida TAL CUAL desde functions/adminChat.js (19-ago-2026) para que el
// apartado nuevo del panel y la herramienta `consumo_ia` del Chat de
// Administración no puedan dar cifras distintas para el mismo día: es
// literalmente la misma función.
//
// Cache write SIEMPRE se cobra como el breakpoint de 5 minutos: es el ÚNICO
// que usa Evalúa Fácil (bloqueConCache en functions/ia.js y
// functions/adminChat.js nunca piden el de 1 hora). Si el modelo del registro
// no tiene tarifa configurada, devuelve null — nunca inventa un número ni
// asume la tarifa de otro modelo.
export function calcularCostoUSD({ modelo, tokensEntrada, tokensSalida, tokensCacheEscritura, tokensCacheLectura }, costosPorModelo) {
  const t = costosPorModelo?.[modelo]
  if (!t) return null
  const entrada = (tokensEntrada || 0) * t.entradaPorMTok / 1e6
  const salida = (tokensSalida || 0) * t.salidaPorMTok / 1e6
  const cacheEscritura = (tokensCacheEscritura || 0) * t.cacheEscritura5mPorMTok / 1e6
  const cacheLectura = (tokensCacheLectura || 0) * t.cacheLecturaPorMTok / 1e6
  return entrada + salida + cacheEscritura + cacheLectura
}

// ── El día al que pertenece cada gasto ─────────────────────────────────────
// Los timestamps de Firestore son instantes UTC, pero Cloud Functions corre
// en UTC y quien lee el panel está en México: agrupar por el día UTC metería
// todo lo gastado después de las 18:00 hora local en el día SIGUIENTE. Para
// un reporte de dinero "por día" eso es sencillamente incorrecto, así que el
// corte del día se hace en la zona del negocio, no en la del servidor.
//
// Se usa Intl (no un desplazamiento fijo de -6) porque el catálogo de
// planteles abarca todo el país y la regla horaria la sabe la plataforma, no
// nosotros. Node 20 y todos los navegadores traen los datos de zona horaria.
const ZONA = 'America/Mexico_City'

// 'en-CA' formatea como YYYY-MM-DD, que además ordena alfabéticamente igual
// que cronológicamente — por eso se usa como clave.
const FORMATO_CLAVE = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
})

export function claveDia(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  if (Number.isNaN(d.getTime())) return null
  return FORMATO_CLAVE.format(d)
}

// Minutos que la zona va por delante de UTC en ESE instante (México: -360).
const FORMATO_PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function offsetMinutos(fecha) {
  const p = {}
  for (const parte of FORMATO_PARTES.formatToParts(fecha)) p[parte.type] = parte.value
  // 'hour' puede venir como '24' a medianoche en algunos entornos.
  const hora = p.hour === '24' ? 0 : Number(p.hour)
  const comoSiFueraUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hora, Number(p.minute), Number(p.second))
  return (comoSiFueraUTC - fecha.getTime()) / 60000
}

// El instante UTC en que empieza (00:00) ese día en México.
export function inicioDelDia(clave) {
  const [y, m, d] = String(clave).split('-').map(Number)
  const tentativo = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  return new Date(tentativo - offsetMinutos(new Date(tentativo)) * 60000)
}

// Rangos que ofrece el panel. Array (no string suelto) a propósito: el
// smoke test de sync-functions-shared.mjs exige que todo export sea función
// u objeto.
export const RANGOS_DIAS = [7, 30, 90]

// Las claves de los últimos `dias` días, la más vieja primero y HOY incluido.
// Se devuelven TODAS, también las de los días sin una sola llamada: un hueco
// en la serie se leería como "ese día no se midió", cuando lo que pasó es que
// no se gastó nada. Un cero es información; una ausencia, no.
export function clavesDeDias(dias, ahora = new Date()) {
  const n = Math.max(1, Math.floor(dias))
  const hoy = claveDia(ahora)
  const inicioHoy = inicioDelDia(hoy)
  const claves = []
  for (let i = n - 1; i >= 0; i--) {
    claves.push(claveDia(new Date(inicioHoy.getTime() - i * 24 * 60 * 60 * 1000)))
  }
  return claves
}

// Ventana [desde, hasta] en instantes UTC para consultar Firestore, más las
// claves que la tabla debe pintar.
export function rangoDeDias(dias, ahora = new Date()) {
  const claves = clavesDeDias(dias, ahora)
  return {
    claves,
    desde: inicioDelDia(claves[0]),
    // El final es AHORA, no el fin del día: pedir el futuro no aporta nada y
    // deja fuera cualquier reloj adelantado.
    hasta: ahora instanceof Date ? ahora : new Date(ahora),
  }
}

// ── Cuentas del panel ──────────────────────────────────────────────────────
// Centavos: por debajo de eso el redondeo de punto flotante es ruido.
const redondear2 = (n) => Math.round(n * 100) / 100

export function margenSobreCostoIA(ingresos, costoIA) {
  return redondear2((ingresos || 0) - (costoIA || 0))
}

// El promedio se divide entre TODOS los días del periodo, no solo entre los
// que tuvieron actividad: para saber cuánto dura un saldo, un domingo sin
// consumo también es un día que pasó.
export function costoPromedioDiario(costoTotal, numeroDeDias) {
  if (!numeroDeDias || numeroDeDias <= 0) return 0
  return redondear2((costoTotal || 0) / numeroDeDias)
}

// Cuánto duraría el saldo que el admin capturó A MANO de la consola de
// Anthropic, al ritmo de gasto del periodo. Devuelve null cuando la pregunta
// no tiene respuesta —sin saldo capturado, o sin gasto que proyectar— en vez
// de un Infinity o un 0 que se leerían como datos reales.
//
// Anthropic NO expone el saldo por API (no existe tal endpoint), así que este
// número JAMÁS puede presentarse como consultado: es una proyección sobre un
// dato que capturó una persona, y la interfaz debe decirlo.
export function diasEstimadosRestantes(saldoCapturado, promedioDiario) {
  if (typeof saldoCapturado !== 'number' || !Number.isFinite(saldoCapturado) || saldoCapturado <= 0) return null
  if (typeof promedioDiario !== 'number' || !Number.isFinite(promedioDiario) || promedioDiario <= 0) return null
  return Math.floor(saldoCapturado / promedioDiario)
}
