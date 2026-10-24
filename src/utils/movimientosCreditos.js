// Registro de movimientos de créditos IA del docente — lógica pura (sin Firebase ni React).
//
// Los movimientos (`iaMovimientos/{id}`) los escribe SOLO el ledger del
// servidor (functions/creditosLedger.js) dentro de la transacción que mueve el
// saldo. Aquí solo se interpretan para mostrarlos: texto, orden, filtros y
// paginación por mes. Nada de esto calcula ni toca saldos.
//
// Tipos: consumo · compra · bienvenida · ajuste.
// Estados: en_proceso · aplicado · sin_cobro (con `motivoCodigo`).
// `saldoDespues` puede faltar (registros importados del historial anterior,
// que nunca lo guardaron): entonces no se muestra, no se inventa.

import { textoDesgloseCalificacion } from './tarifaCalificacionEvidencias.js'

const ZONA = 'America/Mexico_City'

// Nombre de cada operación para el docente. Si llega una operación nueva que
// aún no está aquí, se usa su categoría (ya pensada para el docente).
const OPERACIONES = {
  aviso: 'Aviso con IA',
  rubrica: 'Rúbrica con IA',
  cotejo: 'Lista de cotejo con IA',
  reactivos: 'Reactivos con IA',
  crear_evaluacion_ia: 'Evaluación creada con IA',
  calificar_abierta: 'Calificación de respuesta abierta',
  calificar_entregable_ia: 'Calificación de entregable con IA',
  calificar_entregable_ia_imagenes: 'Calificación de entregable (imágenes) con IA',
  calificar_entregable_ia_lote: 'Calificación de entregables en lote',
  calificar_entregable_ia_lote_imagenes: 'Calificación de entregables (imágenes) en lote',
  crear_actividad_ia: 'Actividad creada con IA',
  generar_preguntas_video: 'Preguntas de video con IA',
  generar_dinamica_vivo: 'Participación en vivo con IA',
  activar_analisis_vivo: 'Análisis de resultados con IA (participación)',
  generar_contenido_juego: 'Crucigrama o sopa de letras',
  planeacion_didactica_inicial: 'Planeación didáctica con IA',
  planeacion_formato_oficial: 'Planeación en formato oficial',
  analizar_resultados: 'Análisis de resultados',
  analizar_entregable: 'Análisis de entregable',
  analizar_asignatura: 'Análisis de asignatura',
  diagnostico_contexto: 'Diagnóstico de contexto',
  diagnostico_conocimientos: 'Diagnóstico de conocimientos',
}

const TIPOS = {
  compra: 'Compra de créditos',
  bienvenida: 'Créditos de bienvenida',
  ajuste: 'Ajuste de Evalúa Fácil',
}

const MOTIVOS_SIN_COBRO = {
  fallido: 'La operación no se completó',
  expirado: 'La operación expiró',
  cancelado: 'La operación se canceló',
}

// "Calificar con IA" de entregables (individual o lote, con cualquiera de sus
// claves de tarifa): un solo concepto para el docente. El modo y el cálculo
// van en el desglose (ver desgloseMovimiento).
const OPERACIONES_CALIFICACION_EVIDENCIAS = new Set([
  'calificar_entregable_ia', 'calificar_entregable_ia_imagenes',
  'calificar_entregable_ia_lote', 'calificar_entregable_ia_lote_imagenes',
])

export function esCalificacionEvidencias(m) {
  return m?.tipo === 'consumo' && OPERACIONES_CALIFICACION_EVIDENCIAS.has(m.operacion)
}

export function tituloMovimiento(m) {
  if (esCalificacionEvidencias(m)) return 'Calificación de evidencias'
  if (m.tipo === 'consumo') return OPERACIONES[m.operacion] || m.categoria || 'Operación de IA'
  return TIPOS[m.tipo] || 'Movimiento de créditos'
}

// Línea secundaria: el estado cuando no es un cobro normal. «Sin cobro» deja
// claro que NO se descontó nada (la operación falló o expiró).
export function detalleMovimiento(m) {
  if (m.estado === 'en_proceso') return 'En proceso'
  if (m.estado === 'sin_cobro') return `${MOTIVOS_SIN_COBRO[m.motivoCodigo] || 'La operación no se completó'} · No se descontó nada`
  return null
}

const f2 = (n) => (Number(n) || 0).toFixed(2)

// Desglose verificable de una calificación de evidencias, p. ej.
// «Lote · 10 entregas · 4 × 0.50 + 6 × 0.25 = 3.50 créditos».
//   · Movimientos nuevos: el `detalle` que guardó el ledger en la misma
//     transacción. Tras liquidar, cuenta SOLO lo que de verdad se evaluó y
//     cobró; las entregas que fallaron y lo devuelto se dicen aparte.
//   · Movimientos anteriores (sin `detalle`): solo lo que su consumo
//     (`iaConsumos/{id}`, el mismo id) permite comprobar — cuántas entregas se
//     evaluaron y la tarifa única que se aplicó. NO se dice si eran imágenes o
//     documentos: antes la tarifa salía del tipo de actividad, no de lo
//     entregado, y ese dato nunca se guardó.
// Sin cobro (falló, expiró) no lleva desglose: ya dice que no se descontó nada.
export function desgloseMovimiento(m, consumo = null) {
  if (!esCalificacionEvidencias(m) || m.estado === 'sin_cobro') return null
  const d = m.detalle
  if (d && Number.isInteger(d.entregas)) {
    const partes = [textoDesgloseCalificacion(d)]
    if (d.noProcesadas > 0) {
      partes.push(d.noProcesadas === 1 ? '1 no se pudo procesar (sin cobro)' : `${d.noProcesadas} no se pudieron procesar (sin cobro)`)
    }
    if (m.estado === 'aplicado' && d.devuelto > 0) partes.push(`reservados ${f2(d.reservado)}, devueltos ${f2(d.devuelto)}`)
    return partes.join(' · ')
  }
  return desgloseHistorico(m, consumo)
}

export function desgloseHistorico(m, consumo) {
  if (!consumo || m.estado !== 'aplicado') return null
  const lote = String(m.operacion || '').includes('_lote')
  const n = lote
    ? (Number.isInteger(consumo.resultado?.generadas) ? consumo.resultado.generadas : null)
    : 1
  const cobrado = Number(consumo.creditosReales)
  if (!n || !(cobrado > 0)) return null
  const tarifa = Math.round((cobrado / n) * 100) / 100
  // Solo si la cuenta cierra exacta: si no, no se muestra nada (nunca se adivina).
  if (Math.abs(tarifa * n - cobrado) > 0.001) return null
  return `${lote ? 'Lote' : 'Individual'} · ${n} ${n === 1 ? 'entrega' : 'entregas'} × ${f2(tarifa)} = ${f2(cobrado)} créditos`
}

// Movimientos que necesitan leer su consumo para mostrar el desglose histórico.
export function necesitaConsumoHistorico(m) {
  return esCalificacionEvidencias(m) && m.estado === 'aplicado' && !m.detalle
}

// Chat con Asistente: función retirada. NUNCA se muestra, ni en el registro de
// movimientos ni en el consumo por categoría, tenga costo o sea gratuita. Son
// las tres operaciones del chat (todas de la categoría «Chat con Asistente» en
// config/iaTarifas; solo se lanzaban desde ChatAsistente.jsx). Es solo
// presentación: los datos históricos y los saldos no se tocan.
const OPERACIONES_OCULTAS = new Set(['chat_asistente', 'chat_crear_actividad', 'chat_crear_examen'])
const CATEGORIA_OCULTA = 'Chat con Asistente'

export function esOperacionOculta(m) {
  return OPERACIONES_OCULTAS.has(m.operacion)
}

// «Utilizados en total» para mostrar: lo consumido menos lo de la categoría
// oculta, así el total visible es coherente con el desglose. Resta, no suma las
// categorías: el consumo que no está atribuido a una categoría (cuentas del
// modelo anterior) sigue contando. No modifica ningún dato.
export function consumoTotalVisible(consumidoTotal, consumoPorCategoria) {
  const oculto = Number((consumoPorCategoria || {})[CATEGORIA_OCULTA]) || 0
  return Math.round(Math.max(0, (Number(consumidoTotal) || 0) - oculto) * 100) / 100
}

// Consumo por categoría para mostrar: sin la categoría retirada, de mayor a
// menor. No modifica el mapa original (los totales de iaCreditos siguen igual).
export function categoriasVisibles(consumoPorCategoria) {
  return Object.entries(consumoPorCategoria || {})
    .filter(([nombre]) => nombre !== CATEGORIA_OCULTA)
    .sort((a, b) => b[1] - a[1])
}

// Créditos con dos decimales fijos (21.50, 200.00): el docente compara importes
// y saldos columna contra columna, así que todos llevan el mismo formato.
function formatoCreditos(n) {
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Columna «Créditos»: el tono sale del SIGNO real del movimiento, nunca del
// concepto. Consumo y ajuste negativo restan (rojo); compra, bienvenida y
// ajuste positivo suman (verde); sin cobro es 0.00 (neutro) — un reembolso del
// ledger no crea un abono aparte: deja el mismo movimiento en 0.
export function importeMovimiento(delta) {
  const valor = Number(delta) || 0
  if (!valor) return { texto: formatoCreditos(0), tono: 'neutro' }
  const n = formatoCreditos(Math.abs(valor))
  return valor > 0 ? { texto: `+${n}`, tono: 'abono' } : { texto: `−${n}`, tono: 'cargo' }
}

// Columna «Saldo»: el saldo que dejó el movimiento, tal como lo escribió el
// ledger en la misma transacción (`saldoDespues`). Si no está (registros
// importados del historial anterior), se muestra «—»: nunca se reconstruye ni
// se inventa.
export function saldoMovimiento(m) {
  return typeof m?.saldoDespues === 'number' && Number.isFinite(m.saldoDespues)
    ? formatoCreditos(m.saldoDespues)
    : '—'
}

export const FILTROS = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'consumos', etiqueta: 'Consumos' },
  { id: 'recargas', etiqueta: 'Recargas y ajustes' },
]

export function millisDe(t) {
  if (!t) return 0
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

// Más reciente primero. Sin orderBy en Firestore (regla del proyecto): se
// ordena aquí.
export function prepararMovimientos(movs, { filtro = 'todos' } = {}) {
  return movs
    .filter((m) => !esOperacionOculta(m))
    .filter((m) => (filtro === 'consumos' ? m.tipo === 'consumo' : filtro === 'recargas' ? m.tipo !== 'consumo' : true))
    .sort((a, b) => millisDe(b.fecha) - millisDe(a.fecha))
}

// ── Periodos «AAAA-MM» en hora de México (misma llave que escribe el ledger) ──
export function periodoDe(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).formatToParts(fecha)
  return `${partes.find((p) => p.type === 'year').value}-${partes.find((p) => p.type === 'month').value}`
}

export function desplazarPeriodo(periodo, meses) {
  const [a, m] = periodo.split('-').map(Number)
  const total = a * 12 + (m - 1) + meses
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function etiquetaPeriodo(periodo) {
  const [a, m] = periodo.split('-').map(Number)
  const texto = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// Columna «Fecha»: día arriba y hora abajo (cabe en pantallas chicas).
export function partesFechaMovimiento(t) {
  const ms = millisDe(t)
  if (!ms) return { dia: '', hora: '' }
  const f = new Date(ms)
  return {
    dia: f.toLocaleDateString('es-MX', { timeZone: ZONA, day: 'numeric', month: 'short' }),
    hora: f.toLocaleTimeString('es-MX', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }),
  }
}
