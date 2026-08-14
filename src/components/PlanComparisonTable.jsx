import { Check } from 'lucide-react'
import { TRIAL_DURATION_DAYS, MONTHLY_PRICE_MXN, MAYOR_PRICE_MXN, formatCurrency } from '../utils/subscriptionHelpers'

// Tabla comercial — lo único que el docente necesita para decidir en pocos
// segundos: qué obtiene, cuánto cuesta y qué le conviene. A propósito NO
// muestra nada interno (planId, nombres de documentos/colecciones): los
// encabezados son los nombres comerciales, no `pro`/`mayor`/`trial`.
//
// `creditosGratuito`/`creditosPro`/`creditosMayor` vienen de
// config/iaTarifas (vía useCreditosIA en quien la use) para no duplicar esos
// números — todo lo demás (precio, duración, filas de función) es fijo y
// comercial, no cambia con la tarifa.
//
// `table-layout: fixed` con anchos porcentuales fijos (en vez del ancho
// mínimo anterior de 420px): en un celular normal (~360-390px de ancho útil
// dentro del modal) esa tabla se salía del contenedor y obligaba a un
// scroll horizontal que dejaba la columna "Asistente IA Pro" —el plan que
// se está evaluando— cortada fuera de la vista por default (encontrado en
// revisión visual real, 13-ago-2026). Con columnas fijas y las etiquetas
// largas envolviendo en dos líneas, las tres columnas caben siempre sin
// scroll, aunque las filas de nombre de función queden un poco más altas.
const FILAS_FUNCIONES = [
  'Diagnóstico de contexto',
  'Diagnóstico de conocimientos',
  'Planeación didáctica con IA',
  'Creación de actividades con IA',
  'Creación de cuestionarios y exámenes con IA',
  'Creación de rúbricas y listas de cotejo con IA',
]

function Celda({ children, destacada = false }) {
  return (
    <td className={`px-1 py-2 text-center border-l border-outline-variant text-[11px] ${destacada ? 'font-bold text-on-surface' : 'text-on-surface'}`}>
      {children}
    </td>
  )
}

function CeldaSi() {
  return (
    <td className="px-1 py-2 text-center border-l border-outline-variant">
      <Check size={15} className="inline-block text-accent" aria-label="Sí" />
    </td>
  )
}

function CeldaNo() {
  return <td className="px-1 py-2 text-center border-l border-outline-variant text-slate-300">—</td>
}

// Dos palomitas: acento visual de "más capacidad" para Asistente IA Pro —
// la función es la MISMA que en Asistente IA (calificar y analizar con IA),
// no hay una segunda función exclusiva; el "más" real ya está en los
// créditos (1,750 vs 350). Confirmado con Kike, 13-ago-2026.
function CeldaSiDoble() {
  return (
    <td className="px-1 py-2 text-center border-l border-outline-variant whitespace-nowrap">
      <Check size={15} className="inline-block text-accent" aria-label="Sí" />
      <Check size={15} className="inline-block text-accent -ml-1.5" aria-hidden="true" />
    </td>
  )
}

// Distinto de CeldaNo: aquí la pregunta SÍ aplica al plan (paga, pero no
// tiene descuento) — "No" es una respuesta, no "no aplica". El guion queda
// reservado para cuando el plan Gratuito ni siquiera participa de la fila
// (no paga, así que "meses"/"descuento" no le corresponden).
function CeldaRespuestaNo() {
  return <td className="px-1 py-2 text-center border-l border-outline-variant text-[11px] text-muted">No</td>
}

export default function PlanComparisonTable({ mostrarMayor = true, creditosGratuito, creditosPro, creditosMayor }) {
  const nCols = mostrarMayor ? 4 : 3
  const colValorPct = (100 - 34) / (nCols - 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '34%' }} />
          {Array.from({ length: nCols - 1 }).map((_, i) => (
            <col key={i} style={{ width: `${colValorPct}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-outline-variant">
            <th className="px-1 py-2 text-left font-semibold text-muted">Plan</th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Gratuito</p>
              <p className="text-[10px] text-muted font-normal">$0</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA</p>
              <p className="text-[10px] text-accent font-semibold">{formatCurrency(MONTHLY_PRICE_MXN)}/mes</p>
            </th>
            {mostrarMayor && (
              <th className="px-1 py-2 text-center border-l border-outline-variant">
                <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA Pro</p>
                <p className="text-[10px] text-accent font-semibold">{formatCurrency(MAYOR_PRICE_MXN)}/mes</p>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {/* Filas que SÍ distinguen un plan de otro — resaltadas, van primero
              después del precio (ya en el encabezado) para que salten a la
              vista antes que la lista de funciones (idénticas en los tres). */}
          {/* Gratuito NO descarga archivos (decisión de Kike, 13-ago-2026):
              a propósito, para que nadie se registre solo a generar su
              Planeación Didáctica Inicial y se vaya sin usar la plataforma.
              Va primero — es el diferenciador más fuerte de todos. */}
          <tr className="border-b border-outline-variant bg-accent-light/40">
            <td className="px-1.5 py-2 font-medium text-muted">Descarga de archivos</td>
            <CeldaRespuestaNo />
            <CeldaSi />
            {mostrarMayor && <CeldaSi />}
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Créditos de IA</td>
            <Celda destacada>{creditosGratuito ?? '—'}</Celda>
            <Celda destacada>{creditosPro != null ? creditosPro.toLocaleString('es-MX') : '—'}</Celda>
            {mostrarMayor && <Celda destacada>{creditosMayor != null ? creditosMayor.toLocaleString('es-MX') : '—'}</Celda>}
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Duración</td>
            <Celda>{TRIAL_DURATION_DAYS} días</Celda>
            <Celda>Mensual</Celda>
            {mostrarMayor && <Celda>Mensual</Celda>}
          </tr>
          {/* Calificar respuestas abiertas y analizar resultados con IA
              (C-02/OP-10) — no está en Gratuito. Igual en ambos planes
              pagados; la doble palomita en Pro es solo acento visual (ver
              CeldaSiDoble), el "más" real ya está en los créditos. */}
          <tr className="border-b border-outline-variant bg-accent-light/40">
            <td className="px-1.5 py-2 font-medium text-muted">Evaluación con apoyo de IA</td>
            <CeldaNo />
            <CeldaSi />
            {mostrarMayor && <CeldaSiDoble />}
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Pago de varios meses</td>
            <CeldaNo />
            <Celda destacada>1-6 meses</Celda>
            {mostrarMayor && <Celda destacada>Solo 1</Celda>}
          </tr>
          <tr className="border-b border-outline-variant bg-accent-light/40">
            <td className="px-1.5 py-2 font-medium text-muted">Descuentos por prepago</td>
            <CeldaNo />
            <CeldaSi />
            {mostrarMayor && <CeldaRespuestaNo />}
          </tr>

          {/* Funciones de IA: iguales en los tres planes — se agrupan al
              final, en gris claro, para no competir visualmente con las
              filas de arriba (que sí cambian de un plan a otro). */}
          <tr className="border-b border-t-2 border-outline-variant">
            <td className="px-1.5 py-2 font-semibold text-slate-400 text-[11px] uppercase" colSpan={nCols}>
              Funciones de IA incluidas en los tres planes
            </td>
          </tr>
          {FILAS_FUNCIONES.map((fila) => (
            <tr key={fila} className="border-b border-outline-variant">
              <td className="px-1.5 py-2 text-muted text-[11px]">{fila}</td>
              <CeldaSi /><CeldaSi />{mostrarMayor && <CeldaSi />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
