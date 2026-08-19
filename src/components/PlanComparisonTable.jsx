import { Check } from 'lucide-react'
import {
  BASICO_PRICE_MXN, MONTHLY_PRICE_MXN, MAYOR_PRICE_MXN,
  TRIAL_DURATION_DAYS, TRIAL_CHAT_INTERACCIONES_LIMITE,
} from '../utils/subscriptionHelpers'

// Tabla comercial — lo único que el docente necesita para decidir en pocos
// segundos: qué obtiene, cuánto cuesta y qué le conviene. A propósito NO
// muestra nada interno (planId, nombres de documentos/colecciones): los
// encabezados son los nombres comerciales, no `basico`/`pro`/`mayor`.
//
// Reestructuración de precios (18-ago-2026): TRES PLANES DE PAGO — Básico
// ($99, sin IA), Asistente IA ($199, 350 créditos, Chat hasta 50
// interacciones/día) y Asistente IA Pro ($299, 1,000 créditos, Chat hasta 50
// interacciones/día).
//
// Prueba gratuita como CUARTA columna, primera de la tabla (19-ago-2026,
// pedido explícito) — antes se explicaba solo en el texto aparte debajo de
// la tabla; ahora también se compara función por función igual que los
// planes de pago. $0, dura TRIAL_DURATION_DAYS (30) días, 50 créditos de IA
// y Chat con Asistente hasta TRIAL_CHAT_INTERACCIONES_LIMITE (10)
// interacciones TOTALES durante todo el periodo — NO por día, a propósito
// distinto de "Hasta 50/día" de los planes de pago para no confundir los dos
// límites. El texto explicativo debajo de la tabla ("Prueba gratis con IA")
// se mantiene tal cual — esta columna lo complementa, no lo reemplaza.
//
// `creditosPro`/`creditosMayor`/`creditosTrial` vienen de config/iaTarifas
// (vía useCreditosIA en quien la use) para no duplicar esos números — todo
// lo demás (precio, filas de función) es fijo y comercial, no cambia con la
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

// Distinto de CeldaNo: la función SÍ existe en Básico, pero sin apoyo de IA
// — el docente la hace a mano (calificar sin sugerencias de IA, crear
// reactivos uno por uno). "Sí, manual" ≠ "no disponible". La palabra sola
// "Manual" al lado de un nombre de fila con "IA" leía como contradictorio
// (revisión UX, 18-ago-2026) — de ahí el "Sí," al frente y el renombre de
// las filas (quitarles "con IA" del título, ver más abajo).
function CeldaManual() {
  return <td className="px-1 py-2 text-center border-l border-outline-variant text-[11px] text-muted">Sí, manual</td>
}

// Contraparte de CeldaManual en la misma fila: mismo patrón "Con IA [·
// detalle]" para que la comparación manual/IA se lea de un vistazo sin
// tener que descifrar símbolos.
function CeldaConIA({ detalle }) {
  return (
    <td className="px-1 py-2 text-center border-l border-outline-variant text-[11px] font-semibold text-accent">
      Con IA{detalle && <><br /><span className="font-normal text-muted">{detalle}</span></>}
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

export default function PlanComparisonTable({ creditosTrial, creditosPro, creditosMayor, paquetesCreditos }) {
  const nCols = 4
  const colEtiquetaPct = 24
  const colValorPct = (100 - colEtiquetaPct) / nCols

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse table-fixed">
        <colgroup>
          <col style={{ width: `${colEtiquetaPct}%` }} />
          {Array.from({ length: nCols }).map((_, i) => (
            <col key={i} style={{ width: `${colValorPct}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-outline-variant">
            <th className="px-1 py-2 text-left font-semibold text-muted">Plan</th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Prueba gratuita</p>
              <p className="text-[10px] text-muted font-normal">$0<br />{TRIAL_DURATION_DAYS} días</p>
              <p className="text-[9px] text-muted leading-tight mt-0.5">Con IA, de prueba</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Básico</p>
              <p className="text-[10px] text-muted font-normal">${BASICO_PRICE_MXN}<br />/mes</p>
              <p className="text-[9px] text-muted leading-tight mt-0.5">Sin IA, trabajo manual</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA</p>
              <p className="text-[10px] text-accent font-semibold leading-tight">${MONTHLY_PRICE_MXN}<br />/mes</p>
              <p className="text-[9px] text-muted leading-tight mt-0.5">Todo + IA</p>
            </th>
            <th className="px-1 py-2 text-center border-l border-outline-variant">
              <p className="font-bold text-on-surface leading-tight text-[11px]">Asistente IA Pro</p>
              <p className="text-[10px] text-accent font-semibold leading-tight">${MAYOR_PRICE_MXN}<br />/mes</p>
              <p className="text-[9px] text-muted leading-tight mt-0.5">Todo + IA, más créditos</p>
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Descarga de archivos: función de plan PAGADO (no de IA) — los
              tres planes de pago la tienen. La Prueba gratuita NO la tiene
              (especificación explícita, 19-ago-2026). */}
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Descarga de archivos</td>
            <CeldaNo />
            <CeldaSi />
            <CeldaSi />
            <CeldaSi />
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Créditos de IA</td>
            <Celda destacada>{creditosTrial != null ? creditosTrial.toLocaleString('es-MX') : '—'}</Celda>
            <CeldaNo />
            <Celda destacada>{creditosPro != null ? creditosPro.toLocaleString('es-MX') : '—'}</Celda>
            <Celda destacada>{creditosMayor != null ? creditosMayor.toLocaleString('es-MX') : '—'}</Celda>
          </tr>
          {/* Calificar respuestas abiertas y analizar resultados con IA
              (C-02/OP-10). Nombre de fila sin "con IA" a propósito (revisión
              UX, 18-ago-2026): así "Sí, manual" en Básico no lee como
              contradictorio junto al título. Igual en ambos planes con IA —
              el "más" real de Pro ya está en los créditos, no aquí. La
              Prueba gratuita también incluye IA aquí (especificación
              explícita, 19-ago-2026). */}
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Evaluación</td>
            <CeldaConIA />
            <CeldaManual />
            <CeldaConIA />
            <CeldaConIA />
          </tr>
          {/* Chat con Asistente IA (reestructuración de precios, 18-ago-2026):
              Básico NO lo tiene — es de los planes con IA. No consume
              créditos por mensaje (solo confirmar una acción de creación
              cobra, con el costo real de esa operación); el candado real es
              el límite de interacciones (fila de abajo). La Prueba gratuita
              SÍ tiene Chat (especificación explícita, 19-ago-2026). */}
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Chat con Asistente IA</td>
            <CeldaSi />
            <CeldaNo />
            <CeldaSi />
            <CeldaSi />
          </tr>
          {/* El límite del trial es TOTAL para todo el periodo, no diario —
              texto distinto a propósito de "Hasta 50/día" para no dar a
              entender que también se reinicia cada día. */}
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Interacciones con el Chat</td>
            <Celda destacada>Hasta {TRIAL_CHAT_INTERACCIONES_LIMITE} (todo el periodo)</Celda>
            <CeldaNo />
            <Celda destacada>Hasta 50/día</Celda>
            <Celda destacada>Hasta 50/día</Celda>
          </tr>
          {/* Cuestionarios y exámenes (18-ago-2026). Nombre de fila sin "con
              IA" por la misma razón que "Evaluación" arriba. Mismo tope de
              reactivos por corrida en ambos planes de pago con IA
              (functions/ia.js: MAX_REACTIVOS_EVALUACION_PAGO=100). La Prueba
              gratuita también tiene IA aquí, sin un tope de reactivos
              específico en la especificación — se muestra sin ese detalle. */}
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Cuestionarios y exámenes</td>
            <CeldaConIA />
            <CeldaManual />
            <CeldaConIA detalle="hasta 100 reactivos" />
            <CeldaConIA detalle="hasta 100 reactivos" />
          </tr>
          <tr className="border-b border-outline-variant bg-accent-light">
            <td className="px-1.5 py-2 font-medium text-muted">Pago de varios meses</td>
            <CeldaNo />
            <CeldaRespuestaNo />
            <Celda destacada>1-6 meses</Celda>
            <Celda destacada>Solo 1</Celda>
          </tr>
          <tr className="border-b border-outline-variant">
            <td className="px-1.5 py-2 font-medium text-muted">Descuentos por prepago</td>
            <CeldaNo />
            <CeldaRespuestaNo />
            <CeldaSi />
            <CeldaRespuestaNo />
          </tr>

          {/* Funciones de IA: iguales en Prueba gratuita, Asistente IA y
              Asistente IA Pro (especificación explícita, 19-ago-2026) — se
              agrupan al final, en gris claro. Básico no las tiene (sin IA). */}
          <tr className="border-b border-t-2 border-outline-variant">
            <td className="px-1.5 py-2 font-semibold text-slate-400 text-[11px] uppercase" colSpan={nCols + 1}>
              Funciones de IA — Prueba gratuita, Asistente IA y Asistente IA Pro
            </td>
          </tr>
          {FILAS_FUNCIONES.map((fila) => (
            <tr key={fila} className="border-b border-outline-variant">
              <td className="px-1.5 py-2 text-muted text-[11px]">{fila}</td>
              <CeldaSi />
              <CeldaNo />
              <CeldaSi />
              <CeldaSi />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 pt-3 border-t border-outline-variant">
        <p className="text-xs font-semibold text-on-surface mb-1">Prueba gratis con IA</p>
        <p className="text-[11px] text-muted">
          Todo docente nuevo puede probar Evalúa Fácil durante su periodo de prueba. Incluye 50 créditos de IA y 10 interacciones con el Chat durante TODO el periodo de prueba. Al terminar, puedes continuar con el Plan Básico sin IA (${BASICO_PRICE_MXN}) o elegir un plan con IA.
        </p>
      </div>
      <SeccionCreditosAdicionales paquetes={paquetesCreditos} />
    </div>
  )
}
