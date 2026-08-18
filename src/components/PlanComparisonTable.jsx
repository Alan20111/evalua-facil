import { Check } from 'lucide-react'
import { BASICO_PRICE_MXN, MONTHLY_PRICE_MXN, MAYOR_PRICE_MXN } from '../utils/subscriptionHelpers'

// Tabla comercial — lo único que el docente necesita para decidir en pocos
// segundos: qué obtiene, cuánto cuesta y qué le conviene. A propósito NO
// muestra nada interno (planId, nombres de documentos/colecciones): los
// encabezados son los nombres comerciales, no `basico`/`pro`/`mayor`.
//
// Reestructuración de precios (18-ago-2026): esta tabla representa los TRES
// PLANES DE PAGO — Básico ($99, sin IA), Asistente IA ($199, 350 créditos,
// Chat hasta 50 interacciones/día) y Asistente IA Pro ($299, 1,000 créditos,
// Chat hasta 50 interacciones/día). El periodo de PRUEBA GRATUITO (trial) es
// una cosa aparte, NO una cuarta columna aquí — se explica en el texto que
// va junto a esta tabla (CheckoutModal/Profile.jsx), nunca mezclado con los
// planes de pago.
//
// `creditosPro`/`creditosMayor` vienen de config/iaTarifas (vía
// useCreditosIA en quien la use) para no duplicar esos números — todo lo
// demás (precio, filas de función) es fijo y comercial, no cambia con la
// tarifa.
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
// créditos (1,000 vs 350). Confirmado con Kike, 13-ago-2026.
function CeldaSiDoble() {
  return (
    <td className="px-1 py-2 text-center border-l border-outline-variant whitespace-nowrap">
      <Check size={15} className="inline-block text-accent" aria-label="Sí" />
      <Check size={15} className="inline-block text-accent -ml-1.5" aria-hidden="true" />
    </td>
  )
}

// Distinto de CeldaNo: aquí la pregunta SÍ aplica al plan (paga, pero no
// tiene descuento) — "No" es una respuesta, no "no aplica".
function CeldaRespuestaNo() {
  return <td className="px-1 py-2 text-center border-l border-outline-variant text-[11px] text-muted">No</td>
}

// Créditos adicionales (18-ago-2026) — solo aclara que existen y sus 5
// paquetes; NO es un plan de suscripción nuevo, por eso va aparte de la
// tabla. `paquetes` viene de config/iaTarifas.paquetesCreditos (vía
// useCreditosIA), la MISMA fuente que usa ComprarCreditosModal — nada de
// precios repetidos aquí. Solo aplican a Asistente IA / Asistente IA Pro —
// Básico no tiene créditos que ampliar.
function SeccionCreditosAdicionales({ paquetes }) {
  if (!paquetes || paquetes.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-outline-variant">
      <p className="text-xs font-semibold text-on-surface mb-1">Créditos adicionales</p>
      <p className="text-[11px] text-muted mb-2">
        Si se te acaban tus créditos del mes (Asistente IA o Asistente IA Pro), puedes comprar más — se suman a tu saldo y no se pierden al renovarse tu periodo.
      </p>
      <div className="grid grid-cols-5 gap-1">
        {paquetes.map((p) => (
          <span key={p.creditos} className="text-[10px] px-1 py-1 rounded-full bg-surface border border-outline-variant text-on-surface tabular-nums text-center whitespace-nowrap">
            {p.creditos.toLocaleString('es-MX')}·${p.precioMXN}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function PlanComparisonTable({ creditosPro, creditosMayor, paquetesCreditos }) {
  const nCols = 3
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
              <p className="font-bold text-on-surface leading-tight text-[11px]">Básico</p>
              <p className="text-[10px] text-muted font-normal">${BASICO_PRICE_MXN}<br />/mes</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA</p>
              <p className="text-[10px] text-accent font-semibold leading-tight">${MONTHLY_PRICE_MXN}<br />/mes</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA Pro</p>
              <p className="text-[10px] text-accent font-semibold leading-tight">${MAYOR_PRICE_MXN}<br />/mes</p>
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Descarga de archivos: función de plan PAGADO (no de IA) — los
              tres planes de esta tabla ya son de pago, así que los tres la
              tienen. Distinto del periodo de prueba gratuito, que NO la
              tiene (ver el texto aparte sobre el trial). */}
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Descarga de archivos</td>
            <CeldaSi />
            <CeldaSi />
            <CeldaSi />
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Créditos de IA</td>
            <CeldaNo />
            <Celda destacada>{creditosPro != null ? creditosPro.toLocaleString('es-MX') : '—'}</Celda>
            <Celda destacada>{creditosMayor != null ? creditosMayor.toLocaleString('es-MX') : '—'}</Celda>
          </tr>
          {/* Calificar respuestas abiertas y analizar resultados con IA
              (C-02/OP-10) — no está en Básico (sin IA). Igual en ambos
              planes con IA; la doble palomita en Pro es solo acento visual
              (ver CeldaSiDoble), el "más" real ya está en los créditos. */}
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Evaluación con apoyo de IA</td>
            <CeldaNo />
            <CeldaSi />
            <CeldaSiDoble />
          </tr>
          {/* Chat con Asistente IA (reestructuración de precios, 18-ago-2026):
              Básico NO lo tiene — es de los planes con IA. No consume
              créditos por mensaje (solo confirmar una acción de creación
              cobra, con el costo real de esa operación); el candado real es
              el límite de interacciones (fila de abajo). */}
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Chat con Asistente IA</td>
            <CeldaNo />
            <CeldaSi />
            <CeldaSi />
          </tr>
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Interacciones con el Chat</td>
            <CeldaNo />
            <Celda destacada>Hasta 50/día</Celda>
            <Celda destacada>Hasta 50/día</Celda>
          </tr>
          {/* Creación de cuestionarios y exámenes con IA (18-ago-2026): los
              dos planes con IA tienen acceso, pero con distinto tope de
              reactivos por corrida (functions/ia.js:
              MAX_REACTIVOS_EVALUACION_PAGO=100 para ambos desde la
              reestructuración — ya no hay un nivel "trial" en esta tabla). */}
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Creación de cuestionarios y exámenes con IA</td>
            <CeldaNo />
            <Celda>Hasta 100 reactivos</Celda>
            <Celda>Hasta 100 reactivos</Celda>
          </tr>
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Pago de varios meses</td>
            <CeldaRespuestaNo />
            <Celda destacada>1-6 meses</Celda>
            <Celda destacada>Solo 1</Celda>
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Descuentos por prepago</td>
            <CeldaRespuestaNo />
            <CeldaSi />
            <CeldaRespuestaNo />
          </tr>

          {/* Funciones de IA: iguales en Asistente IA / Asistente IA Pro — se
              agrupan al final, en gris claro. Básico no las tiene (sin IA). */}
          <tr className="border-b border-t-2 border-outline-variant">
            <td className="px-1.5 py-2 font-semibold text-slate-400 text-[11px] uppercase" colSpan={nCols + 1}>
              Funciones de IA — Asistente IA y Asistente IA Pro
            </td>
          </tr>
          {FILAS_FUNCIONES.map((fila) => (
            <tr key={fila} className="border-b border-outline-variant">
              <td className="px-1.5 py-2 text-muted text-[11px]">{fila}</td>
              <CeldaNo />
              <CeldaSi />
              <CeldaSi />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 pt-3 border-t border-outline-variant text-[11px] text-muted">
        Todo docente nuevo empieza con un <strong className="text-on-surface font-semibold">periodo de prueba gratuito</strong> — incluye IA (50 créditos) y hasta 10 interacciones con el Chat con Asistente durante TODA la prueba (no por día). Al terminar, elige uno de los planes de arriba.
      </p>
      <SeccionCreditosAdicionales paquetes={paquetesCreditos} />
    </div>
  )
}
