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

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')
const MODELO = 'claude-haiku-4-5'
const MAX_TOKENS = 4096
const MAX_VUELTAS_HERRAMIENTAS = 6 // tope duro contra un loop descontrolado de tool-use

// ── Reglas de negocio fijas (conocimiento del PRODUCTO, no datos actuales) ──
// Mismos números que subscriptionHelpers.js (precios) y
// seed-ia-tarifas.js/creditosLedger.js (créditos, límites de Chat) — no se
// duplican como fuente de verdad para el CLIENTE, pero este es un archivo de
// Cloud Functions que no puede importar src/, así que se repiten aquí a
// propósito, con el mismo valor. Si esos números cambian, hay que
// actualizarlos aquí también.
const CONOCIMIENTO_PRODUCTO = `
Estructura de planes de pago de Evalúa Fácil (esto es una REGLA DE NEGOCIO fija, no un dato que cambie — nunca la confundas con una métrica actual):
- Básico ($99 MXN/mes): plataforma completa (calificaciones, actividades, asistencia) SIN IA.
- Asistente IA ($199 MXN/mes): todo lo del Básico + IA. 350 créditos de IA/mes + Chat con Asistente hasta 50 interacciones/día.
- Asistente IA Pro ($299 MXN/mes): todo lo del Asistente IA + 1,000 créditos de IA/mes (mismo límite de Chat: 50 interacciones/día).
- Periodo de prueba (trial, gratis): 50 créditos de IA + 10 interacciones de Chat TOTALES durante todo el periodo (no por día). Al terminar, el docente elige un plan o se queda en Básico sin IA.
1 interacción de Chat = 1 mensaje enviado por el docente. El límite de interacciones es CONJUNTO entre el Chat General y el Chat de cada asignatura — no se reinicia al cambiar de conversación.
El Chat con Asistente NO cobra créditos por mensaje — solo las operaciones de IA con tarifa (calificar, generar cuestionarios, planeación, etc.) consumen créditos, con su propia tarifa fija en config/iaTarifas.
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
4. FACTURACIÓN (usuarios × precio) NO es lo mismo que GANANCIA. Si te preguntan "¿cuánto ganamos?" y no tienes todos los costos (Firebase, Vercel, Cloudinary, pasarela de pago — hoy NINGUNO de esos está disponible como dato en el sistema), dilo explícitamente: no puedes calcular ganancia neta, solo ingresos y, cuando exista el dato, el costo estimado de Anthropic en TOKENS (no en pesos: el sistema no tiene configurada una tarifa de USD/token de Anthropic, así que nunca conviertas tokens a dinero — solo reporta el conteo de tokens como dato real).
5. Esta es la PRIMERA VERSIÓN del Chat de Administración y es SOLO DE CONSULTA. No existe ninguna herramienta que modifique datos. Si el administrador pide una acción (borrar, cambiar, cancelar, modificar algo), responde que este chat todavía es solo de consulta y no puede ejecutar esa acción.
6. No existe ningún registro de errores de la plataforma consultable desde aquí — si te preguntan por errores o "algo raro", dilo explícitamente en vez de adivinar.
7. Responde en español, ejecutivo y directo — como para alguien que dirige el negocio, no un reporte técnico. Cuando haya varios puntos, usa viñetas ("- punto"), cada una en su propio renglón. Cuando una comparación se entienda mejor como tabla, usa una tabla Markdown simple — no abuses de las tablas. NUNCA muestres JSON crudo, ni encabezados Markdown (#, ##, ###) sin razón, ni el texto "{"respuesta"" en tu respuesta — texto limpio, directo.
8. Mantén el contexto de la conversación: "¿y de esos cuántos pagan?" se refiere a la cifra que acabas de dar.
9. Cuando el administrador diga "hoy", "esta semana", "este mes", "ayer", usa la fecha real que te doy en el contexto de la herramienta — nunca inventes qué día es hoy.`

// ── Herramientas: cada una hace UNA consulta acotada, nunca un volcado ─────

const HOY_ISO = () => new Date().toISOString().slice(0, 10)

function rangoOCorriente({ desde, hasta }) {
  // Sin fechas explícitas del modelo: el mes calendario actual — el caso más
  // común ("este mes", "hoy" se resuelve aparte con rangos de un solo día).
  const hoy = new Date()
  const d = desde ? new Date(desde) : new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const h = hasta ? new Date(hasta) : hoy
  h.setHours(23, 59, 59, 999)
  return { desde: d, hasta: h }
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
    description: 'Cuenta docentes por plan actual (trial, básico $99, asistente IA $199, asistente IA pro $299, cortesía, cancelada) y calcula el ingreso mensual ESTIMADO (usuarios × precio de lista — no es facturación real cobrada). Úsala para "¿cuántos tienen el plan de $X?", "¿cómo se distribuyen por plan?", "¿cuánto facturaríamos con la base actual?".',
    input_schema: { type: 'object', properties: {} },
    async run(db) {
      const PRECIOS = { basico: 99, pro: 199, anual: 199, mayor: 299 }
      const NOMBRES = {
        basico: 'Básico ($99)', pro: 'Asistente IA ($199)', anual: 'Asistente IA ($199, prepago)', mayor: 'Asistente IA Pro ($299)',
        cortesia: 'Cortesía', trial: 'Periodo de prueba', cancelada_o_vencida: 'Cancelada o vencida',
      }
      const [subsSnap, teachersSnap] = await Promise.all([
        db.collection('subscriptions').get(),
        db.collection('users').where('role', '==', 'docente').get(),
      ])
      const porDocente = new Map()
      subsSnap.docs.forEach((d) => {
        const s = d.data()
        const prev = porDocente.get(s.docenteId)
        const ms = (x) => x.updatedAt?.toMillis?.() || 0
        if (!prev || ms(s) > ms(prev)) porDocente.set(s.docenteId, s)
      })
      const conteo = {}
      let ingresoEstimadoMensual = 0
      teachersSnap.docs.forEach((t) => {
        const sub = porDocente.get(t.id)
        let clave
        if (!sub || sub.status === 'trial') clave = 'trial'
        else if (sub.status === 'cancelada' || sub.status === 'vencida') clave = 'cancelada_o_vencida'
        else if (sub.planId === 'cortesia') clave = 'cortesia'
        else clave = sub.planId || 'trial'
        conteo[clave] = (conteo[clave] || 0) + 1
        if (PRECIOS[clave]) ingresoEstimadoMensual += PRECIOS[clave]
      })
      return {
        docentesTotal: teachersSnap.size,
        distribucion: Object.fromEntries(Object.entries(conteo).map(([k, v]) => [NOMBRES[k] || k, v])),
        ingresoMensualEstimadoMXN: ingresoEstimadoMensual,
        nota: 'ingresoMensualEstimadoMXN es usuarios × precio de lista actual, NO facturación real cobrada (usa ingresos_pagos para eso).',
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
    description: 'Agrega el consumo REAL de IA (tokens, no dinero) por operación y modelo en un rango de fechas, y cuántas respuestas se truncaron por max_tokens. Úsala para "¿qué operación de IA consume más?", "¿cuánto se truncó?", "¿cuántos tokens usamos?". NO da un costo en pesos: el sistema no tiene configurada una tarifa de USD/token de Anthropic. Parámetros opcionales desde/hasta (YYYY-MM-DD); sin parámetros usa el mes actual.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, opcional' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, opcional' },
      },
    },
    async run(db, args) {
      const { desde, hasta } = rangoOCorriente(args || {})
      // iaConsumosInterno no tiene índice por fecha con rango — se filtra en
      // memoria tras traer los docs del rango más amplio posible (createdAt
      // es un Timestamp de servidor). Para no descargar TODO el histórico se
      // acota con un where de fecha en el propio campo `createdAt`.
      const snap = await db.collection('iaConsumosInterno')
        .where('createdAt', '>=', desde).where('createdAt', '<=', hasta).get()
      const porOperacion = {}
      let truncadas = 0
      snap.docs.forEach((d) => {
        const c = d.data()
        const k = c.operacion || 'desconocida'
        if (!porOperacion[k]) porOperacion[k] = { llamadas: 0, tokensEntrada: 0, tokensSalida: 0 }
        porOperacion[k].llamadas++
        porOperacion[k].tokensEntrada += c.tokensEntrada || 0
        porOperacion[k].tokensSalida += c.tokensSalida || 0
        if (c.stopReason === 'max_tokens') truncadas++
      })
      return {
        desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10),
        llamadasTotal: snap.size, porOperacion, respuestasTruncadasPorLimiteDeSalida: truncadas,
        nota: 'Tokens reales. No incluye costo en pesos ni dólares — esa tarifa no está configurada en el sistema.',
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
    description: 'Consulta saldos y consumo REAL de créditos de IA de todos los docentes: saldo total disponible, capacidad total asignada, y los docentes con menor saldo restante (mayor consumo relativo). Úsala para "¿cuántos créditos se han consumido?", "¿quién usa más créditos?".',
    input_schema: { type: 'object', properties: {} },
    async run(db) {
      const snap = await db.collection('iaCreditos').get()
      let saldoTotal = 0
      let capacidadTotal = 0
      const docs = snap.docs.map((d) => {
        const c = d.data()
        saldoTotal += c.saldo || 0
        capacidadTotal += c.capacidad || 0
        return { docenteId: d.id, plan: c.plan || null, saldo: c.saldo || 0, capacidad: c.capacidad || 0 }
      })
      const masConsumido = docs
        .filter((d) => d.capacidad > 0)
        .sort((a, b) => (a.saldo / a.capacidad) - (b.saldo / b.capacidad))
        .slice(0, 5)
        .map((d) => ({ docenteId: d.docenteId, plan: d.plan, saldoRestante: d.saldo, capacidad: d.capacidad, porcentajeConsumido: Math.round((1 - d.saldo / d.capacidad) * 100) }))
      return {
        docentesConCreditos: snap.size,
        saldoTotalDisponible: saldoTotal,
        capacidadTotalAsignada: capacidadTotal,
        consumidoTotal: capacidadTotal - saldoTotal,
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

async function correrConversacion({ client, db, historial, mensaje }) {
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
        content = herramienta ? JSON.stringify(await herramienta.run(db, llamada.input)) : JSON.stringify({ error: 'herramienta desconocida' })
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

    const inicio = Date.now()
    const { texto, stopReason, usage } = await correrConversacion({ client, db, historial, mensaje })

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
exports.__test = { herramientas: HERRAMIENTAS_POR_NOMBRE, rangoOCorriente }
