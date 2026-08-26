// Chat de Administración — "Inteligencia de Evalúa Fácil" (19-ago-2026).
//
// Distinto del Chat con Asistente del docente (functions/ia.js,
// ejecutarChatAsistente): este es exclusivo del admin, solo lectura, NO
// cobra créditos (no hay un docente al que cobrarle), y su trabajo es
// responder preguntas de negocio con DATOS REALES leídos por el servidor —
// nunca inventados. Arquitectura de "tool use": el modelo NUNCA ve la base
// de datos completa. Decide qué herramienta llamar (contar_usuarios,
// ingresos_pagos, consumo_ia, etc.), el servidor ejecuta esa consulta
// ACOTADA contra Firestore, y le regresa solo ese resultado — así una
// pregunta simple ("¿cuántos docentes tenemos?") nunca dispara una lectura
// de conversaciones, créditos ni operaciones de IA que no pidió nadie.
//
// Seguridad: el rol se valida SIEMPRE server-side (igual que
// resetearCreditosIA/aprobarCompraCreditos en functions/index.js) — nunca
// se confía en nada que mande el cliente. Un docente que llame a este
// callable directo (saltándose la UI) recibe 'permission-denied' antes de
// que se ejecute una sola consulta.
//
// Primera versión SOLO LECTURA (pedido explícito, 19-ago-2026): ninguna
// herramienta escribe Firestore. Si el admin pide una acción ("borra este
// usuario"), el system prompt le instruye al modelo que debe decir que esta
// versión del chat es de consulta — no hay ninguna herramienta de escritura
// que pudiera ejecutar aunque quisiera.
//
// Costo real de Anthropic (19-ago-2026, pedido explícito de Kike): la
// tarifa oficial de Anthropic (USD por millón de tokens de entrada/salida,
// más los multiplicadores de caché) vive en
// config/iaTarifas.costosAnthropicUSD, junto con un tipo de cambio fijo
// (tipoCambioUsdMxn) — es un PARÁMETRO DE SISTEMA en Firestore, no una
// constante en código: se actualiza ahí (o en seeds-db/seed-ia-tarifas.js y
// re-corriendo el seed) cuando Anthropic cambie precios, sin tocar ni
// redesplegar este archivo. `calcularCostoUSD` (más abajo) es la única
// función que hace esa cuenta, y las herramientas `consumo_ia`,
// `costo_por_docente` y `rentabilidad_creditos` la usan — ninguna otra parte
// del código calcula esto por su cuenta.

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
// Solo por CREDITOS_BIENVENIDA (el tamaño del regalo de bienvenida) — misma
// razón que el resto de este archivo repite constantes de negocio: no puede
// importar src/, y este SÍ puede importar otro módulo de functions/.
const { CREDITOS_BIENVENIDA } = require('./creditosLedger')

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')
const MODELO = 'claude-haiku-4-5'
const MAX_TOKENS = 4096
const MAX_VUELTAS_HERRAMIENTAS = 6 // tope duro contra un loop descontrolado de tool-use

// ── Reglas de negocio fijas (conocimiento del PRODUCTO, no datos actuales) ──
// CORREGIDO 26-ago-2026: hasta esa fecha este bloque describía un modelo de
// planes de pago mensuales ($99/$199/$299, créditos por mes, límite de Chat
// por plan) que YA NO EXISTE — Evalúa Fácil es GRATUITA y el único ingreso
// son créditos de IA prepagados. La versión vieja hizo que este mismo Chat
// le diera al administrador cifras de "ingreso mensual estimado" y "margen"
// calculadas sobre precios de planes fantasma (ver `plans/*` en Firestore y
// `PRECIOS_PLAN`, ambos código muerto — [[project_modelo_precios_ia_complemento]]).
//
// Estos números SÍ son reales y estables (no se duplican para el CLIENTE,
// pero este archivo de Cloud Functions no puede importar src/, así que se
// repiten aquí a propósito). Si cambian en config/iaTarifas, hay que
// actualizarlos aquí también.
const CONOCIMIENTO_PRODUCTO = `
Modelo de negocio de Evalúa Fácil (esto es una REGLA DE NEGOCIO fija, no un dato que cambie — nunca la confundas con una métrica actual):
- La plataforma es GRATUITA. No hay planes, ni suscripción, ni mensualidad de ningún monto. Asignaturas, estudiantes, actividades, calificaciones, asistencia y descargas son gratis para cualquier docente, sin límite.
- El ÚNICO ingreso son créditos de IA PREPAGADOS: 1 crédito = $1 MXN de referencia, en paquetes de 50 a 1,600 créditos con descuento por volumen (hasta $0.90/crédito). Los créditos no caducan.
- Los créditos cubren ÚNICAMENTE operaciones de IA (calificar, generar cuestionarios, planeación, Chat con Asistente, etc. — cada una con su tarifa en config/iaTarifas). NO cubren asistencias, descargas ni actividades interactivas: esas nunca han consumido créditos.
- Toda cuenta nueva recibe 30 créditos de bienvenida (activación voluntaria del docente, no automática) — es el único costo de adquisición que existe hoy, y se puede consultar con \`rentabilidad_creditos\`.
- Existen registros HISTÓRICOS de un modelo de suscripción anterior (colecciones \`subscriptions\`, \`payments\`, \`plans/*\`) que YA NO GATEA nada ni genera ingreso — si una herramienta los muestra, es información heredada, nunca facturación actual.
`.trim()

const SYSTEM_PROMPT = `Eres el Chat de Inteligencia de Evalúa Fácil, para uso EXCLUSIVO del equipo administrador — no eres el Chat con Asistente que usan los docentes, y el administrador con el que hablas no es un docente.

${CONOCIMIENTO_PRODUCTO}

REGLAS ABSOLUTAS:
1. NUNCA inventes una cifra. Si necesitas un dato (usuarios, ingresos, consumo, etc.), usa las herramientas disponibles — no calcules ni asumas de memoria.
2. Si una herramienta no cubre lo que te preguntan, dilo con claridad: "No tengo ese dato disponible actualmente" — nunca lo estimes como si fuera real.
3. Distingue SIEMPRE tres tipos de cifra en tu respuesta:
   - DATO REAL: viene directo de una herramienta (ej. "Dato registrado: 127 docentes").
   - ESTIMACIÓN: un cálculo tuyo a partir de datos reales (ej. usuarios × precio = ingreso potencial). Dilo explícitamente como estimación y aclara qué NO incluye.
   - No hay una tercera categoría "inferencia" separada de estimación — si no es un dato directo de una herramienta, es una estimación y se marca como tal.
4. INGRESO REAL (créditos vendidos, herramienta \`compras_creditos\` o \`rentabilidad_creditos\`) NO es lo mismo que GANANCIA. El sistema SÍ tiene configurado el costo real de Anthropic (USD por millón de tokens, en config/iaTarifas) y las herramientas de consumo/costo/rentabilidad lo usan para calcular el costo REAL en USD y MXN — pero eso sigue sin ser toda la operación: NO incluye Firebase, Vercel, Cloudinary ni la pasarela de pago (ninguno de esos está disponible como dato en el sistema). Si te preguntan "¿cuánto ganamos?" o "margen neto", usa el ingreso real de créditos y el costo real de Anthropic que sí tienes, pero deja explícito que es "margen sobre el costo de IA únicamente" — NUNCA lo llames "ganancia neta" ni "utilidad real" sin esa aclaración.
5. Esta es la PRIMERA VERSIÓN del Chat de Administración y es SOLO DE CONSULTA. No existe ninguna herramienta que modifique datos. Si el administrador pide una acción (borrar, cambiar, cancelar, modificar algo), responde que este chat todavía es solo de consulta y no puede ejecutar esa acción.
6. No existe ningún registro de errores de la plataforma consultable desde aquí — si te preguntan por errores o "algo raro", dilo explícitamente en vez de adivinar.
7. Responde en español, ejecutivo y directo — como para alguien que dirige el negocio, no un reporte técnico. Cuando haya varios puntos, usa viñetas ("- punto"), cada una en su propio renglón. Cuando una comparación se entienda mejor como tabla, usa una tabla Markdown simple — no abuses de las tablas. NUNCA muestres JSON crudo, ni encabezados Markdown (#, ##, ###) sin razón, ni el texto "{"respuesta"" en tu respuesta — texto limpio, directo.
8. Mantén el contexto de la conversación: "¿y de esos cuántos pagan?" se refiere a la cifra que acabas de dar.
9. Cuando el administrador diga "hoy", "esta semana", "este mes", "ayer", usa la fecha real que te doy en el contexto de la herramienta — nunca inventes qué día es hoy.`

// ── Herramientas: cada una hace UNA consulta acotada, nunca un volcado ─────

const HOY_ISO = () => new Date().toISOString().slice(0, 10)

// Costo real de Anthropic (19-ago-2026, pedido explícito de Kike) — la
// tarifa vive en config/iaTarifas.costosAnthropicUSD/tipoCambioUsdMxn (ver
// seeds-db/seed-ia-tarifas.js), NUNCA hardcodeada aquí: así se puede
// actualizar sin tocar ni redesplegar este archivo cuando Anthropic cambie
// precios. Se lee UNA vez por invocación del callable (ver exports.chatAdmin
// más abajo) y se pasa a las herramientas que la necesiten — a propósito NO
// es una caché a nivel de módulo: una Cloud Function puede quedar "tibia" y
// atender llamadas de sesiones distintas reusando la misma instancia, así
// que cachear ahí serviría precios viejos a admins distintos hasta el
// siguiente cold start.
async function obtenerConfigCostos(db) {
  const snap = await db.doc('config/iaTarifas').get()
  const data = snap.data() || {}
  return {
    costosPorModelo: data.costosAnthropicUSD || {},
    tipoCambioUsdMxn: typeof data.tipoCambioUsdMxn === 'number' ? data.tipoCambioUsdMxn : null,
  }
}

// Pura — nada de Firestore aquí, para poder probarla aislada. Cache write
// SIEMPRE se cobra como el breakpoint de 5 minutos: es el ÚNICO que usa
// Evalúa Fácil (bloqueConCache en functions/ia.js y functions/adminChat.js
// nunca piden el de 1 hora). Si el modelo de la operación no tiene tarifa
// configurada, devuelve null — nunca inventa un número ni asume la tarifa
// de otro modelo.
function calcularCostoUSD({ modelo, tokensEntrada, tokensSalida, tokensCacheEscritura, tokensCacheLectura }, costosPorModelo) {
  const t = costosPorModelo?.[modelo]
  if (!t) return null
  const entrada = (tokensEntrada || 0) * t.entradaPorMTok / 1e6
  const salida = (tokensSalida || 0) * t.salidaPorMTok / 1e6
  const cacheEscritura = (tokensCacheEscritura || 0) * t.cacheEscritura5mPorMTok / 1e6
  const cacheLectura = (tokensCacheLectura || 0) * t.cacheLecturaPorMTok / 1e6
  return entrada + salida + cacheEscritura + cacheLectura
}

function rangoOCorriente({ desde, hasta }) {
  // Sin fechas explícitas del modelo: el mes calendario actual — el caso más
  // común ("este mes", "hoy" se resuelve aparte con rangos de un solo día).
  const hoy = new Date()
  const d = desde ? new Date(desde) : new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const h = hasta ? new Date(hasta) : hoy
  h.setHours(23, 59, 59, 999)
  return { desde: d, hasta: h }
}

// Clasificación por ESTADO DE SUSCRIPCIÓN HEREDADO — la colección
// `subscriptions` sigue existiendo (dato histórico del modelo anterior,
// nunca se borró) pero desde el 20-ago-2026 no gatea nada: cualquier
// docente autenticado usa toda la plataforma gratis, tenga el estado que
// tenga aquí. `PRECIOS_PLAN` se retiró (26-ago-2026): esos precios no
// existen — es lo que alimentaba `rentabilidad_plan`, retirada por lo
// mismo, ver `rentabilidad_creditos` más abajo — así que `distribucion_planes`
// ya no reporta ingreso, solo el conteo por estado.
const NOMBRES_ESTADO_SUSCRIPCION = {
  basico: 'Básico (heredado)', pro: 'Asistente IA (heredado)', anual: 'Asistente IA (heredado, prepago)', mayor: 'Asistente IA Pro (heredado)',
  cortesia: 'Cortesía', trial: 'Periodo de prueba', cancelada_o_vencida: 'Cancelada o vencida',
}
async function mapaPlanPorDocente(db) {
  const [subsSnap, teachersSnap] = await Promise.all([
    db.collection('subscriptions').get(),
    db.collection('users').where('role', '==', 'docente').get(),
  ])
  const ultimaSubPorDocente = new Map()
  subsSnap.docs.forEach((d) => {
    const s = d.data()
    const prev = ultimaSubPorDocente.get(s.docenteId)
    const ms = (x) => x.updatedAt?.toMillis?.() || 0
    if (!prev || ms(s) > ms(prev)) ultimaSubPorDocente.set(s.docenteId, s)
  })
  const planPorDocente = new Map()
  teachersSnap.docs.forEach((t) => {
    const sub = ultimaSubPorDocente.get(t.id)
    let clave
    if (!sub || sub.status === 'trial') clave = 'trial'
    else if (sub.status === 'cancelada' || sub.status === 'vencida') clave = 'cancelada_o_vencida'
    else if (sub.planId === 'cortesia') clave = 'cortesia'
    else clave = sub.planId || 'trial'
    planPorDocente.set(t.id, clave)
  })
  return { planPorDocente, docentesTotal: teachersSnap.size }
}

const HERRAMIENTAS = [
  {
    name: 'contar_usuarios',
    description: 'Cuenta docentes y alumnos totales, y activos/inactivos. Úsala para "¿cuántos docentes/alumnos tenemos?".',
    input_schema: { type: 'object', properties: {} },
    async run(db) {
      const [usersSnap, studentsSnap] = await Promise.all([
        db.collection('users').where('role', '==', 'docente').get(),
        db.collection('students').get(),
      ])
      const alumnosActivos = studentsSnap.docs.filter((d) => d.data().activado === true).length
      return {
        docentesTotal: usersSnap.size,
        alumnosTotal: studentsSnap.size,
        alumnosActivos,
        alumnosNoActivados: studentsSnap.size - alumnosActivos,
      }
    },
  },
  {
    name: 'distribucion_planes',
    description: 'Cuenta docentes por ESTADO DE SUSCRIPCIÓN HEREDADO (trial, cortesía, cancelada/vencida, o el nombre del plan de pago que tenían asignado). Es información histórica: desde el 20-ago-2026 la plataforma es gratuita y ningún estado de estos gatea nada ni genera ingreso — para eso usa `compras_creditos` o `rentabilidad_creditos`. Úsala solo para "¿cuántos siguen con un estado heredado de X?" o preguntas de archivo, nunca para facturación.',
    input_schema: { type: 'object', properties: {} },
    async run(db) {
      const { planPorDocente, docentesTotal } = await mapaPlanPorDocente(db)
      const conteo = {}
      planPorDocente.forEach((clave) => { conteo[clave] = (conteo[clave] || 0) + 1 })
      return {
        docentesTotal,
        distribucionEstadoHeredado: Object.fromEntries(Object.entries(conteo).map(([k, v]) => [NOMBRES_ESTADO_SUSCRIPCION[k] || k, v])),
        nota: 'Esto es un estado HEREDADO de `subscriptions`, un modelo de negocio retirado el 20-ago-2026 — no representa ningún ingreso ni gatea ninguna función hoy. La plataforma es gratuita para todo docente autenticado; el único ingreso real son los créditos de IA (ver compras_creditos / rentabilidad_creditos).',
      }
    },
  },
  {
    name: 'ingresos_pagos',
    description: 'Suma REAL de pagos completados (transferencias de suscripción) en un rango de fechas. Úsala para "¿cuánto hemos vendido/facturado?". Parámetros opcionales desde/hasta en formato YYYY-MM-DD; sin parámetros usa el mes calendario actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args) {
      const { desde, hasta } = rangoOCorriente(args || {})
      const snap = await db.collection('payments').where('status', '==', 'completado').get()
      const enRango = snap.docs.filter((d) => {
        const t = d.data().createdAt?.toDate?.()
        return t && t >= desde && t <= hasta
      })
      const total = enRango.reduce((a, d) => a + (d.data().monto || 0), 0)
      return {
        desde: desde.toISOString().slice(0, 10),
        hasta: hasta.toISOString().slice(0, 10),
        pagosCompletados: enRango.length,
        totalMXN: total,
      }
    },
  },
  {
    name: 'compras_creditos',
    description: 'Suma REAL de compras de créditos de IA adicionales completadas en un rango de fechas. Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args) {
      const { desde, hasta } = rangoOCorriente(args || {})
      const snap = await db.collection('creditPurchases').where('status', '==', 'completado').get()
      const enRango = snap.docs.filter((d) => {
        const t = d.data().createdAt?.toDate?.()
        return t && t >= desde && t <= hasta
      })
      const totalMXN = enRango.reduce((a, d) => a + (d.data().montoMXN || 0), 0)
      const totalCreditos = enRango.reduce((a, d) => a + (d.data().creditos || 0), 0)
      return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10), comprasCompletadas: enRango.length, totalMXN, totalCreditosVendidos: totalCreditos }
    },
  },
  {
    name: 'docentes_nuevos',
    description: 'Cuenta docentes nuevos registrados en un rango de fechas. Úsala para "¿cuántos usuarios nuevos esta semana/mes?". Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args) {
      const { desde, hasta } = rangoOCorriente(args || {})
      const snap = await db.collection('users').where('role', '==', 'docente').get()
      const nuevos = snap.docs.filter((d) => {
        const t = d.data().createdAt?.toDate?.()
        return t && t >= desde && t <= hasta
      }).length
      return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10), docentesNuevos: nuevos }
    },
  },
  {
    name: 'cancelaciones',
    description: 'Cuenta suscripciones canceladas (status cancelada o vencida) actualizadas en un rango de fechas. Úsala para "¿cuántos cancelaron?". Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args) {
      const { desde, hasta } = rangoOCorriente(args || {})
      const snap = await db.collection('subscriptions').where('status', 'in', ['cancelada', 'vencida']).get()
      const enRango = snap.docs.filter((d) => {
        const t = d.data().updatedAt?.toDate?.()
        return t && t >= desde && t <= hasta
      }).length
      return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10), cancelaciones: enRango }
    },
  },
  {
    name: 'consumo_ia',
    description: 'Agrega el consumo REAL de IA (tokens y costo real de Anthropic en USD/MXN) por operación y modelo en un rango de fechas, y cuántas respuestas se truncaron por max_tokens. Úsala para "¿qué operación de IA consume/cuesta más?", "¿cuánto se truncó?", "¿cuánto nos cuesta el Chat?", "¿cuánto gastamos en Anthropic?". Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args, costos) {
      const { desde, hasta } = rangoOCorriente(args || {})
      // iaConsumosInterno no tiene índice por fecha con rango — se filtra en
      // memoria tras traer los docs del rango más amplio posible (createdAt
      // es un Timestamp de servidor). Para no descargar TODO el histórico se
      // acota con un where de fecha en el propio campo `createdAt`.
      const snap = await db.collection('iaConsumosInterno')
        .where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get()
      const porOperacion = {}
      let truncadas = 0
      let costoTotalUSD = 0
      const modelosSinTarifa = new Set()
      snap.docs.forEach((d) => {
        const c = d.data()
        const k = c.operacion || 'desconocida'
        if (!porOperacion[k]) porOperacion[k] = { llamadas: 0, tokensEntrada: 0, tokensSalida: 0, costoUSD: 0 }
        porOperacion[k].llamadas++
        porOperacion[k].tokensEntrada += c.tokensEntrada || 0
        porOperacion[k].tokensSalida += c.tokensSalida || 0
        if (c.stopReason === 'max_tokens') truncadas++
        const costo = calcularCostoUSD(c, costos?.costosPorModelo)
        if (costo == null) { if (c.modelo) modelosSinTarifa.add(c.modelo); return }
        porOperacion[k].costoUSD += costo
        costoTotalUSD += costo
      })
      Object.values(porOperacion).forEach((o) => { o.costoUSD = Number(o.costoUSD.toFixed(4)) })
      const tc = costos?.tipoCambioUsdMxn
      return {
        desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10),
        llamadasTotal: snap.size, porOperacion, respuestasTruncadasPorLimiteDeSalida: truncadas,
        costoTotalUSD: Number(costoTotalUSD.toFixed(4)),
        costoTotalMXN: tc != null ? Number((costoTotalUSD * tc).toFixed(2)) : null,
        tipoCambioUsdMxnUsado: tc,
        modelosSinTarifaConfigurada: modelosSinTarifa.size ? [...modelosSinTarifa] : undefined,
        nota: 'costoUSD/costoTotalUSD es el costo REAL pagado a Anthropic (config/iaTarifas.costosAnthropicUSD), calculado sobre los tokens reales registrados — NO incluye Firebase, Vercel, Cloudinary ni pasarela de pago. costoTotalMXN usa el tipo de cambio fijo configurado (tipoCambioUsdMxnUsado); si es null, no hay tipo de cambio configurado y esa conversión no se puede hacer.',
      }
    },
  },
  {
    name: 'costo_por_docente',
    description: 'Costo REAL de Anthropic por docente en un rango de fechas (tokens reales × tarifa real, sumados por uid) — los docentes más caros de servir. Úsala para "¿cuánto nos cuesta atender a X docente?", "¿quién nos cuesta más?". Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args, costos) {
      const { desde, hasta } = rangoOCorriente(args || {})
      const snap = await db.collection('iaConsumosInterno')
        .where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get()
      const costoPorUid = new Map()
      let sinTarifa = 0
      snap.docs.forEach((d) => {
        const c = d.data()
        const costo = calcularCostoUSD(c, costos?.costosPorModelo)
        if (costo == null) { sinTarifa++; return }
        costoPorUid.set(c.uid, (costoPorUid.get(c.uid) || 0) + costo)
      })
      const top = [...costoPorUid.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([docenteId, costoUSD]) => ({ docenteId, costoUSD: Number(costoUSD.toFixed(4)) }))
      const tc = costos?.tipoCambioUsdMxn
      return {
        desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10),
        docentesConConsumo: costoPorUid.size,
        topDocentesPorCosto: tc != null ? top.map((t) => ({ ...t, costoMXN: Number((t.costoUSD * tc).toFixed(2)) })) : top,
        llamadasSinTarifaConfigurada: sinTarifa || undefined,
        nota: 'Costo REAL de Anthropic por docente, no incluye otros costos de infraestructura (Firebase, Vercel, etc.).',
      }
    },
  },
  {
    name: 'rentabilidad_creditos',
    description: 'Rentabilidad REAL del unico negocio que existe hoy: creditos de IA prepagados. Cruza el ingreso real (creditPurchases completadas) contra el costo real de Anthropic (iaConsumosInterno) en un rango de fechas, calcula el margen POR CREDITO, desglosa el margen por OPERACION, y reporta el costo de adquisicion (creditos de bienvenida activados). Usala para "el credito que vendemos cubre lo que cuesta?", "que operacion de IA deja mas margen?", "cuanto nos cuesta regalar creditos de bienvenida?". Parametros opcionales desde/hasta (YYYY-MM-DD); sin parametros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args, costos) {
      const { desde, hasta } = rangoOCorriente(args || {})

      const [comprasSnapCompleto, consumoSnap, bienvenidaSnap, tarifasSnap] = await Promise.all([
        // Solo la igualdad va a Firestore — combinarla con el rango de fecha
        // en la MISMA consulta exige un índice compuesto que no existe (regla
        // del proyecto, CLAUDE.md: "Only single-field equality queries...
        // Sort results in memory"). Mismo patrón exacto que `compras_creditos`,
        // sin tocar, un poco más arriba en este archivo — el bug real
        // (26-ago-2026): esta consulta SÍ combinaba equality+rango, tiraba
        // FAILED_PRECONDITION en producción, y el catch de correrConversacion
        // lo convertía en "no se pudo consultar este dato ahora mismo" — la
        // herramienta parecía "no disponible" cuando en realidad reventaba.
        db.collection('creditPurchases').where('status', '==', 'completado').get(),
        db.collection('iaConsumosInterno').where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get(),
        // iaTrialRegistro no tiene indice por activadaEn - se filtra en
        // memoria (mismo patron que interacciones_chat mas abajo); a esta
        // escala (un doc por docente que alguna vez tuvo la cuenta) es barato.
        db.collection('iaTrialRegistro').where('bienvenidaActivada', '==', true).get(),
        db.doc('config/iaTarifas').get(),
      ])

      // -- Ingreso real: lo que de verdad se cobro por creditos --------------
      // Rango de fecha filtrado en MEMORIA (mismo patrón que compras_creditos,
      // ver comentario de arriba) — comprasSnapCompleto ya trae SOLO las
      // completadas, filtradas por status en Firestore.
      const comprasSnap = comprasSnapCompleto.docs.filter((d) => {
        const t = d.data().createdAt?.toDate?.()
        return t && t >= desde && t <= hasta
      })
      const ingresoRealMXN = comprasSnap.reduce((a, d) => a + (d.data().montoMXN || 0), 0)
      const creditosVendidos = comprasSnap.reduce((a, d) => a + (d.data().creditos || 0), 0)
      // Precio EFECTIVO del credito en este rango (no el de lista): distintos
      // paquetes tienen distinto descuento, asi que esto es un promedio
      // ponderado real, no una constante.
      const precioEfectivoPorCreditoMXN = creditosVendidos > 0 ? Number((ingresoRealMXN / creditosVendidos).toFixed(4)) : null

      // -- Costo real de Anthropic, total y por operacion ---------------------
      const tc = costos?.tipoCambioUsdMxn
      let costoTotalUSD = 0
      let creditosConsumidosTotal = 0
      let llamadasSinCreditosReales = 0
      const porOperacion = {}
      consumoSnap.docs.forEach((d) => {
        const c = d.data()
        const k = c.operacion || 'desconocida'
        if (!porOperacion[k]) porOperacion[k] = { llamadas: 0, costoUSD: 0, creditosCobrados: 0, llamadasSinCreditosReales: 0 }
        const o = porOperacion[k]
        o.llamadas++
        const costo = calcularCostoUSD(c, costos?.costosPorModelo)
        if (costo != null) { o.costoUSD += costo; costoTotalUSD += costo }
        // `creditosReales` existe desde el 26-ago-2026 (ver ejecutarOperacionIA
        // en functions/ia.js) - registros anteriores, o del camino diferido
        // de generar_contenido_juego mientras no se confirma/cancela, no lo
        // tienen. Se cuentan aparte para que el margen no se calcule sobre
        // una cobertura parcial sin decirlo.
        if (typeof c.creditosReales === 'number') {
          o.creditosCobrados += c.creditosReales
          creditosConsumidosTotal += c.creditosReales
        } else {
          o.llamadasSinCreditosReales++
          llamadasSinCreditosReales++
        }
      })

      const costoTotalMXN = tc != null ? Number((costoTotalUSD * tc).toFixed(2)) : null
      const costoPorCreditoConsumidoMXN = tc != null && creditosConsumidosTotal > 0
        ? Number((costoTotalMXN / creditosConsumidosTotal).toFixed(4))
        : null
      const margenPorCreditoMXN = precioEfectivoPorCreditoMXN != null && costoPorCreditoConsumidoMXN != null
        ? Number((precioEfectivoPorCreditoMXN - costoPorCreditoConsumidoMXN).toFixed(4))
        : null
      const margenPorCreditoPct = margenPorCreditoMXN != null && precioEfectivoPorCreditoMXN
        ? Number((100 * margenPorCreditoMXN / precioEfectivoPorCreditoMXN).toFixed(1))
        : null

      // Margen por operacion: creditos cobrados en ESTA operacion, valorados
      // al mismo precio efectivo del credito de arriba (no hay un precio de
      // venta "por operacion" - el credito es fungible), contra su costo real.
      const porOperacionArr = Object.entries(porOperacion).map(([operacion, o]) => {
        const costoUSD = Number(o.costoUSD.toFixed(4))
        const costoMXN = tc != null ? Number((costoUSD * tc).toFixed(2)) : null
        const ingresoAtribuidoMXN = precioEfectivoPorCreditoMXN != null
          ? Number((o.creditosCobrados * precioEfectivoPorCreditoMXN).toFixed(2))
          : null
        const margenMXN = ingresoAtribuidoMXN != null && costoMXN != null ? Number((ingresoAtribuidoMXN - costoMXN).toFixed(2)) : null
        return {
          operacion, llamadas: o.llamadas,
          creditosCobrados: Number(o.creditosCobrados.toFixed(2)),
          costoRealUSD: costoUSD, costoRealMXN: costoMXN,
          ingresoAtribuidoMXN, margenMXN,
          margenPct: margenMXN != null && ingresoAtribuidoMXN ? Number((100 * margenMXN / ingresoAtribuidoMXN).toFixed(1)) : null,
          llamadasSinCreditosReales: o.llamadasSinCreditosReales || undefined,
        }
      }).sort((a, b) => (b.costoRealMXN || 0) - (a.costoRealMXN || 0))

      // -- Costo de adquisicion: creditos de bienvenida activados en el rango --
      const bienvenidasEnRango = bienvenidaSnap.docs.filter((d) => {
        const t = d.data().activadaEn?.toDate?.()
        return t && t >= desde && t <= hasta
      })
      const creditosRegalados = bienvenidasEnRango.length * CREDITOS_BIENVENIDA
      // Valorados al precio de LISTA (el paquete mas chico, sin descuento -
      // mismo criterio que PRECIO_REFERENCIA_MXN en ComprarCreditosModal.jsx),
      // leido en vivo de config/iaTarifas - nunca hardcodeado.
      const paquetes = tarifasSnap.data()?.paquetesCreditos || []
      const paqueteMasChico = paquetes.reduce((a, p) => (!a || p.creditos < a.creditos ? p : a), null)
      const precioListaMXN = paqueteMasChico ? paqueteMasChico.precioMXN / paqueteMasChico.creditos : null
      const valorDeListaCreditosRegaladosMXN = precioListaMXN != null ? Number((creditosRegalados * precioListaMXN).toFixed(2)) : null

      return {
        desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10),
        ingresoRealMXN, creditosVendidos, comprasCompletadas: comprasSnap.length, precioEfectivoPorCreditoMXN,
        costoTotalAnthropicUSD: Number(costoTotalUSD.toFixed(4)), costoTotalAnthropicMXN: costoTotalMXN,
        creditosConsumidosConDato: Number(creditosConsumidosTotal.toFixed(2)), costoPorCreditoConsumidoMXN,
        margenPorCreditoMXN, margenPorCreditoPct,
        porOperacion: porOperacionArr,
        llamadasSinCreditosReales: llamadasSinCreditosReales || undefined,
        costoAdquisicion: {
          bienvenidasActivadas: bienvenidasEnRango.length,
          creditosRegalados,
          valorDeListaMXN: valorDeListaCreditosRegaladosMXN,
        },
        nota: 'ingresoRealMXN/creditosVendidos son de creditPurchases (status completado) - dinero que de verdad entro. precioEfectivoPorCreditoMXN es el promedio ponderado REAL del rango (paquetes con descuento incluidos), no el precio de lista. costoTotalAnthropicMXN es el costo REAL pagado a Anthropic - NO incluye Firebase, Vercel, Cloudinary ni pasarela de pago, asi que margenPorCreditoMXN es margen sobre el costo de IA UNICAMENTE, nunca "ganancia neta". creditosConsumidosConDato puede ser menor al consumo real: llamadasSinCreditosReales cuenta cuantos registros de iaConsumosInterno no tienen ese campo (anteriores al 26-ago-2026, o del camino diferido de generar_contenido_juego mientras no se confirma/cancela) - el margen se calcula SOLO sobre lo que si tiene dato, nunca extrapolado. porOperacion.ingresoAtribuidoMXN es una atribucion (creditos cobrados x precio efectivo del credito), no un precio de venta propio de cada operacion - el credito es fungible. costoAdquisicion.valorDeListaMXN es lo que esos creditos hubieran costado al precio de lista - una estimacion del costo de adquisicion, no dinero que salio de una cuenta.',
      }
    },
  },
  {
    name: 'interacciones_chat',
    description: 'Cuenta interacciones REALES del Chat con Asistente (docente) en un día específico, sumando Chat General + por asignatura de TODOS los docentes. Úsala para "¿cuántas interacciones de Chat tuvimos hoy/ayer?". Parámetro opcional fecha (YYYY-MM-DD, por omisión hoy).',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'YYYY-MM-DD, opcional, por omisión hoy' } },
    },
    async run(db, args) {
      const fecha = args?.fecha || HOY_ISO()
      // No hay índice por fecha en chatInteraccionesDiarias (el id del doc es
      // `${uid}_${fecha}`) — se filtra por sufijo del id tras listar la
      // colección. A esta escala (un doc por docente activo ESE día) es
      // barato; si la base crece mucho esto necesitará un campo `fecha`
      // indexado en el propio documento.
      const snap = await db.collection('chatInteraccionesDiarias').get()
      const deEseDia = snap.docs.filter((d) => d.id.endsWith(`_${fecha}`))
      const total = deEseDia.reduce((a, d) => a + (d.data().contador || 0), 0)
      const topDocentes = deEseDia
        .map((d) => ({ docenteId: d.id.slice(0, -(fecha.length + 1)), interacciones: d.data().contador || 0 }))
        .sort((a, b) => b.interacciones - a.interacciones)
        .slice(0, 5)
      return { fecha, docentesConActividad: deEseDia.length, interaccionesTotal: total, topDocentesPorInteracciones: topDocentes }
    },
  },
  {
    name: 'consumo_creditos_docentes',
    description: 'Consulta saldos y consumo REAL de créditos de IA de todos los docentes: saldo total disponible, consumido acumulado total, y los docentes que más créditos han consumido. Úsala para "¿cuántos créditos se han consumido?", "¿quién usa más créditos?".',
    input_schema: { type: 'object', properties: {} },
    async run(db) {
      const snap = await db.collection('iaCreditos').get()
      let saldoTotal = 0
      let consumidoTotal = 0
      // CORREGIDO 26-ago-2026: esta herramienta seguía leyendo `plan` y
      // `capacidad`, campos del modelo de créditos POR MES que se retiró el
      // 20-ago-2026 (ver creditosLedger.js: "Sin capacidad, sin plan, sin
      // ciclo mensual, sin reseteo"). En créditos puros esos campos nunca
      // existen, así que `capacidadTotal` siempre daba 0 y `masConsumido`
      // siempre salía vacío — rota en silencio desde que se migró el modelo.
      // `consumidoTotal` (acumulado real, ver creditosLedger.js) es el campo
      // correcto.
      const docs = snap.docs.map((d) => {
        const c = d.data()
        saldoTotal += c.saldo || 0
        consumidoTotal += c.consumidoTotal || 0
        return { docenteId: d.id, saldo: c.saldo || 0, consumidoTotal: c.consumidoTotal || 0 }
      })
      const masConsumido = docs
        .filter((d) => d.consumidoTotal > 0)
        .sort((a, b) => b.consumidoTotal - a.consumidoTotal)
        .slice(0, 5)
      return {
        docentesConCreditos: snap.size,
        saldoTotalDisponible: saldoTotal,
        consumidoTotal,
        docentesConMayorConsumo: masConsumido,
      }
    },
  },
]

const HERRAMIENTAS_ANTHROPIC = HERRAMIENTAS.map(({ name, description, input_schema }) => ({ name, description, input_schema }))
const HERRAMIENTAS_POR_NOMBRE = Object.fromEntries(HERRAMIENTAS.map((h) => [h.name, h]))

// Prompt-caching (mismo patrón que ejecutarChatAsistente en functions/ia.js:
// bloqueConCache) — el system prompt es idéntico en cada turno de la MISMA
// conversación, así que se marca como breakpoint cacheable.
function bloqueConCache(texto) {
  return [{ type: 'text', text: texto, cache_control: { type: 'ephemeral' } }]
}

async function correrConversacion({ client, db, historial, mensaje, costos }) {
  const messages = [...historial, { role: 'user', content: mensaje }]
  let vueltas = 0

  for (;;) {
    vueltas++
    if (vueltas > MAX_VUELTAS_HERRAMIENTAS) {
      return { texto: 'No pude terminar de reunir los datos para esta pregunta (demasiadas consultas encadenadas) — intenta preguntarlo de forma más específica.', messages }
    }
    const msg = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: bloqueConCache(SYSTEM_PROMPT),
      tools: HERRAMIENTAS_ANTHROPIC,
      messages,
    })
    messages.push({ role: 'assistant', content: msg.content })

    const llamadas = msg.content.filter((b) => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || llamadas.length === 0) {
      const texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
      return { texto, messages, stopReason: msg.stop_reason, usage: msg.usage }
    }

    const resultados = await Promise.all(llamadas.map(async (llamada) => {
      const herramienta = HERRAMIENTAS_POR_NOMBRE[llamada.name]
      let content
      try {
        content = herramienta ? JSON.stringify(await herramienta.run(db, llamada.input, costos)) : JSON.stringify({ error: 'herramienta desconocida' })
      } catch (e) {
        logger.error(`adminChat herramienta ${llamada.name}:`, e)
        content = JSON.stringify({ error: 'No se pudo consultar este dato ahora mismo.' })
      }
      return { type: 'tool_result', tool_use_id: llamada.id, content }
    }))
    messages.push({ role: 'user', content: resultados })
  }
}

exports.chatAdmin = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar')

    const db = getFirestore()
    // Verificación SERVER-SIDE del rol — nunca se confía en el cliente
    // (mismo patrón que resetearCreditosIA/aprobarCompraCreditos en
    // functions/index.js). Un docente que llame este callable directo,
    // saltándose la UI, recibe este rechazo ANTES de que se ejecute
    // cualquier consulta de datos administrativos.
    const perfil = await db.doc(`users/${uid}`).get()
    if (!perfil.exists || perfil.data().role !== 'admin') {
      throw new HttpsError('permission-denied', 'El Chat de Administración es exclusivo del equipo administrador')
    }

    const mensaje = String(request.data?.mensaje || '').trim().slice(0, 2000)
    if (!mensaje) throw new HttpsError('invalid-argument', 'Falta el mensaje')
    // Historial ya acotado por el cliente (últimos 10 turnos) — se valida el
    // tamaño aquí también, nunca se confía en el límite del cliente solo.
    const historialCliente = Array.isArray(request.data?.historial) ? request.data.historial.slice(-10) : []
    const historial = historialCliente
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
      .map((h) => ({ role: h.role, content: h.content }))

    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
    const costos = await obtenerConfigCostos(db)

    const inicio = Date.now()
    const { texto, stopReason, usage } = await correrConversacion({ client, db, historial, mensaje, costos })

    if (!texto) throw new HttpsError('internal', 'El Chat de Administración no generó una respuesta utilizable')

    // Métricas internas — mismo criterio que iaConsumosInterno del chat de
    // docente, para poder auditar costo/uso de este chat también.
    db.collection('adminChatConsumosInterno').add({
      uid, modelo: MODELO, stopReason: stopReason ?? null,
      tokensEntrada: usage?.input_tokens ?? null, tokensSalida: usage?.output_tokens ?? null,
      tokensCacheEscritura: usage?.cache_creation_input_tokens ?? null, tokensCacheLectura: usage?.cache_read_input_tokens ?? null,
      ms: Date.now() - inicio, createdAt: FieldValue.serverTimestamp(),
    }).catch((err) => logger.error('adminChatConsumosInterno:', err))

    return { respuesta: texto }
  }
)

// Ganchos de prueba (19-ago-2026) — solo exponen las herramientas puras de
// consulta para poder probarlas contra un Firestore falso sin llamar a
// Anthropic ni desplegar. No los usa `exports.chatAdmin` ni ningún código de
// producción.
exports.__test = { herramientas: HERRAMIENTAS_POR_NOMBRE, rangoOCorriente, calcularCostoUSD, mapaPlanPorDocente }
