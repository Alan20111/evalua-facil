import { AlertTriangle } from 'lucide-react'
import { formatCurrency } from '../../../utils/creditosHelpers'
import { ICONO } from '../../../config/iconos'

// «2026-10» → «octubre de 2026» / «oct 2026». El mes ya viene calculado en la
// zona de México; aquí solo se escribe, así que se formatea en UTC para que la
// zona del navegador no lo mueva de mes.
function fechaDeMes(clave) {
  const [y, m] = String(clave || '').split('-').map(Number)
  if (!y || !m) return null
  return new Date(Date.UTC(y, m - 1, 1, 12))
}
function nombreMes(clave) {
  const d = fechaDeMes(clave)
  if (!d) return 'este mes'
  return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function mesCorto(clave) {
  const d = fechaDeMes(clave)
  if (!d) return String(clave)
  return d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '')
}

const entero = (v) => Number(v).toLocaleString('es-MX')

// Un renglón por indicador, en el orden en que se leen: cuánta gente hay, cuántos
// estudiantes y cuánto se vendió. Todo sale de los cálculos de utils/resumenAdmin.js
// (compras SOLO de `creditPurchases`; estudiantes como PERSONAS; registros desde la
// fecha de creación de Firebase Authentication). Un valor `null` es «todavía sin
// dato confirmado» y se muestra «—», nunca un 0.
function filasDe(k) {
  const mes = nombreMes(k.mes)
  return [
    { key: 'docentes', label: 'Docentes registrados', valor: k.docentes, format: entero },
    {
      key: 'registrosMes',
      label: `Registros de ${mes}`,
      valor: k.delMes.registros,
      format: entero,
      ayuda: 'Docentes que crearon su cuenta en el mes, según la fecha de creación en Firebase Authentication (mes en hora de México).',
    },
    {
      key: 'estudiantes',
      label: 'Estudiantes',
      valor: k.estudiantes.personas,
      format: entero,
      ayuda: 'Personas distintas (usuario + escuela). Quien está inscrito en varias asignaturas cuenta una sola vez; no es el número de inscripciones.',
    },
    {
      key: 'activados',
      label: 'Estudiantes activados',
      valor: k.estudiantes.activadas,
      format: entero,
      ayuda: 'Personas con al menos una inscripción activada. Si una persona está activada en unas asignaturas y en otras no, cuenta como activada.',
    },
    {
      key: 'sinActivar',
      label: 'Estudiantes sin activar',
      valor: k.estudiantes.sinActivar,
      format: entero,
      ayuda: 'Personas sin ninguna inscripción activada: nunca entraron o su docente les puso contraseña temporal.',
    },
    {
      key: 'creditosVendidos',
      label: 'Créditos vendidos',
      valor: k.ventas.creditosVendidos,
      format: entero,
      ayuda: 'Créditos de las compras completadas. No incluye los créditos de regalo ni los ajustes manuales, y no es el saldo disponible.',
    },
    { key: 'compras', label: 'Compras completadas', valor: k.ventas.completadas, format: entero },
    {
      key: 'ingresos',
      label: 'Ingresos por compra de créditos',
      valor: k.ventas.ingresosMXN,
      format: formatCurrency,
      ayuda: 'Pesos de las compras completadas (montoMXN). No son créditos ni saldo, y no incluyen los pagos del modelo anterior de suscripciones.',
    },
    { key: 'ingresosMes', label: `Ingresos de ${mes}`, valor: k.delMes.ingresosMXN, format: formatCurrency, ayuda: 'Compras completadas cuya aprobación ocurrió en el mes (hora de México).' },
    { key: 'comprasMes', label: `Compras de ${mes}`, valor: k.delMes.compras, format: entero },
    { key: 'pendientes', label: 'Compras pendientes de revisión', valor: k.ventas.pendientes, format: entero, ayuda: 'No suman a los ingresos hasta que se aprueban.' },
    { key: 'rechazadas', label: 'Compras rechazadas', valor: k.ventas.rechazadas, format: entero, ayuda: 'No suman a los ingresos.' },
  ]
}

// Solo se pinta cuando hay algo que revisar. Nada de lo señalado se descartó
// de las cifras en silencio: aquí se dice qué pasó.
const ESTILO_AVISO = {
  revisar: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-surface border-outline-variant text-muted',
}

function Avisos({ avisos }) {
  if (!avisos?.length) return null
  return (
    <section
      aria-label="Avisos para revisar"
      /* w-0 min-w-full: el bloque toma el ancho de la tabla de indicadores y no
         la ensancha con sus textos largos. */
      className="w-0 min-w-full space-y-2"
    >
      {avisos.map((a) => (
        <div key={a.id} className={`rounded-card border px-3 py-2 text-sm ${ESTILO_AVISO[a.nivel] || ESTILO_AVISO.info}`}>
          <p className="flex items-start gap-2">
            {a.nivel === 'revisar' && <AlertTriangle size={ICONO.sm} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
            <span>{a.texto}</span>
          </p>
          {a.detalle?.length > 0 && (
            <details className="mt-1 ml-6 text-xs">
              <summary className="cursor-pointer">Ver detalle</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5 break-all">
                {a.detalle.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </details>
          )}
        </div>
      ))}
    </section>
  )
}

export default function StatsCards({ kpis }) {
  if (!kpis) return null
  const filas = filasDe(kpis)

  return (
    <div className="flex flex-col gap-3 w-fit max-w-full">
      {/* w-fit: la tabla mide lo que miden sus datos y se queda a la izquierda,
          en vez de estirarse de lado a lado con las cifras perdidas al fondo. */}
      <div className="bg-surface-card rounded-card shadow-card overflow-hidden w-fit max-w-full">
        <table className="w-auto text-sm">
          <thead>
            <tr className="text-left text-[11.5px] tracking-wide uppercase text-accent bg-surface">
              <th className="px-4 py-2 font-normal">Indicador</th>
              <th className="px-4 py-2 font-normal text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ key, label, ayuda, valor, format }) => (
              <tr key={key} className="border-t border-outline-variant">
                <td className="px-4 py-2.5 text-on-surface">
                  <span
                    title={ayuda}
                    className={ayuda ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}
                  >
                    {label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-on-surface whitespace-nowrap">
                  {valor === null || valor === undefined ? (
                    <span className="text-hint" title="Todavía sin dato confirmado">&mdash;</span>
                  ) : format(valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Avisos avisos={kpis.avisos} />
    </div>
  )
}

function BarChart({ items, labelKey, valueKey, maxBars = 10, format = (v) => v }) {
  const data = items.slice(0, maxBars)
  const max = Math.max(...data.map((d) => d[valueKey]), 1)

  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-hint">Sin datos</p>
      ) : (
        data.map((item) => (
          <div key={item[labelKey]} className="flex items-center gap-3">
            <span className="text-xs text-muted w-28 md:w-40 truncate flex-shrink-0">
              {item[labelKey]}
            </span>
            <div className="flex-1 h-6 bg-surface-container rounded overflow-hidden">
              <div
                className="h-full bg-accent rounded transition-all"
                style={{ width: `${(item[valueKey] / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-muted min-w-[2.5rem] text-right tabular-nums">
              {format(item[valueKey])}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

export function ResumenCharts({ stats }) {
  if (!stats) return null

  const { teachersBySchool, kpis, authInfo } = stats
  // Las dos series cubren los últimos seis meses; los meses sin movimiento valen
  // 0 de verdad (dato confirmado). Los registros dependen de Auth: mientras no
  // haya dato, la gráfica lo dice en vez de dibujar ceros.
  const meses = (serie) => (serie || []).map(({ mes, valor }) => ({ name: mesCorto(mes), valor }))
  const registros = kpis?.series?.registros ? meses(kpis.series.registros) : null
  const ingresos = meses(kpis?.series?.ingresos)

  return (
    /* Una encima de otra y del mismo ancho, ocupando lo que la tabla de
       indicadores deja libre a su derecha. */
    <div className="flex-1 min-w-0 w-full space-y-3">
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Docentes por escuela (top 10)</h3>
        <BarChart items={teachersBySchool} labelKey="school" valueKey="count" />
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Registros por mes (últimos 6)</h3>
        {registros ? (
          <BarChart items={registros} labelKey="name" valueKey="valor" maxBars={6} />
        ) : (
          <p className="text-sm text-hint">
            {authInfo?.estado === 'cargando' ? 'Cargando…' : 'No disponible: no se pudo consultar Firebase Authentication.'}
          </p>
        )}
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Ingresos por compra de créditos por mes (últimos 6)</h3>
        <BarChart items={ingresos} labelKey="name" valueKey="valor" maxBars={6} format={formatCurrency} />
      </div>
    </div>
  )
}
