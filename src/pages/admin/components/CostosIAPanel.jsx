// Costos de IA — cuánto cuesta operar la IA cada día y cuánto entra por venta
// de créditos (3-sep-2026).
//
// La pregunta que este apartado existe para responder de un vistazo es
// "¿estoy gastando más de lo que ingreso?", así que la gráfica compara las
// dos barras del mismo día lado a lado y la tabla las repite con el detalle.
//
// De dónde salen los números: del callable `resumenCostosIA`, que agrega en
// el SERVIDOR. Este componente nunca lee `iaConsumosInterno` — esa colección
// sigue cerrada a todo cliente porque cada documento lleva el uid del
// docente. Aquí solo llegan totales por día, sin una sola referencia a
// ninguna persona.
//
// Dos honestidades que la interfaz repite a propósito y no deben quitarse:
//   · el costo es ESTIMADO (nuestros registros de tokens × la tarifa
//     configurada), no la factura de Anthropic;
//   · el margen es sobre el costo de IA ÚNICAMENTE — no incluye Firebase,
//     Vercel, Cloudinary ni comisiones de cobro, así que no es ganancia neta.
import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { RefreshCw, Info } from 'lucide-react'
import { db, functions } from '../../../firebase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import Table from '../../../components/ui/Table'
import Input from '../../../components/ui/Input'
import { formatCurrency } from '../../../utils/creditosHelpers'
import { RANGOS_DIAS, diasEstimadosRestantes } from '../../../utils/costosIA'

const SALDO_REF = ['adminConfig', 'anthropicSaldo']

const num = (n) => (typeof n === 'number' ? n.toLocaleString('es-MX') : '—')
const dinero = (n) => (typeof n === 'number' ? formatCurrency(n) : '—')

// "2026-09-03" → "3 sep". Se parte la cadena en vez de pasarla por `new Date`:
// la clave YA viene resuelta en la zona del negocio desde el servidor, y
// `new Date('2026-09-03')` la interpretaría como UTC y restaría un día.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function diaCorto(clave) {
  const [, m, d] = String(clave).split('-')
  return `${Number(d)} ${MESES[Number(m) - 1] || ''}`
}

// ── Gráfica: dos barras por día, costo y ingreso ───────────────────────────
// SVG a mano y no una librería nueva: el proyecto no tiene ninguna (el
// BarChart de StatsCards también es artesanal) y traer una entera para dos
// series de barras no se paga.
function GraficaDiaria({ dias }) {
  const max = Math.max(...dias.map((d) => Math.max(d.costoIAMXN || 0, d.ingresosMXN || 0)), 0.01)
  const ALTO = 170
  const anchoDia = 100 / dias.length

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(360, dias.length * 26) }}>
        <svg viewBox={`0 0 100 ${ALTO}`} preserveAspectRatio="none" className="w-full" style={{ height: ALTO }}
          aria-labelledby="titulo-grafica-costos">
          <title id="titulo-grafica-costos">
            {`Costo de IA e ingresos por día durante ${dias.length} días`}
          </title>
          {/* Base */}
          <line x1="0" y1={ALTO - 18} x2="100" y2={ALTO - 18} stroke="currentColor" strokeWidth="0.2" className="text-outline-variant" />
          {dias.map((d, i) => {
            const x = i * anchoDia
            const ancho = anchoDia * 0.34
            const hCosto = ((d.costoIAMXN || 0) / max) * (ALTO - 26)
            const hIngreso = ((d.ingresosMXN || 0) / max) * (ALTO - 26)
            // Rojo cuando ese día costó más de lo que entró: es la lectura
            // que se busca de un vistazo. Si no costó nada, no hay nada que
            // marcar en rojo.
            const enPerdida = (d.costoIAMXN || 0) > (d.ingresosMXN || 0) && (d.costoIAMXN || 0) > 0
            return (
              <g key={d.fecha}>
                <title>
                  {`${d.fecha} · costo ${dinero(d.costoIAMXN)} · ingresos ${dinero(d.ingresosMXN)} · ${d.llamadas} llamadas`}
                </title>
                <rect
                  x={x + anchoDia * 0.14} y={ALTO - 18 - hCosto} width={ancho} height={hCosto}
                  className={enPerdida ? 'fill-red-500' : 'fill-slate-400'}
                />
                <rect
                  x={x + anchoDia * 0.52} y={ALTO - 18 - hIngreso} width={ancho} height={hIngreso}
                  className="fill-emerald-500"
                />
              </g>
            )
          })}
        </svg>
        {/* Etiquetas fuera del SVG: dentro se estirarían con
            preserveAspectRatio="none" y saldrían deformadas. */}
        <div className="flex text-[10px] text-slate-400 -mt-3">
          {dias.map((d, i) => (
            <div key={d.fecha} className="text-center truncate" style={{ width: `${anchoDia}%` }}>
              {dias.length <= 31 || i % 3 === 0 ? diaCorto(d.fecha) : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-400 inline-block" /> Costo IA estimado</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Ingresos</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Día en que el costo superó al ingreso</span>
      </div>
    </div>
  )
}

function Indicador({ etiqueta, valor, ayuda, tono = '' }) {
  return (
    <div className="bg-surface-card rounded-card shadow-card p-4 min-w-0">
      <div className="text-xs text-muted flex items-center gap-1">
        <span className="truncate">{etiqueta}</span>
        {ayuda && <Info size={12} className="text-slate-400 flex-shrink-0 cursor-help" aria-hidden />}
      </div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${tono}`} title={ayuda}>{valor}</div>
    </div>
  )
}

export default function CostosIAPanel() {
  const toast = useToast()
  const { currentUser } = useAuth()
  const [dias, setDias] = useState(30)
  // Contador de recargas manuales: cambiarlo vuelve a disparar el efecto sin
  // tener que cambiar el rango.
  const [recarga, setRecarga] = useState(0)
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [saldo, setSaldo] = useState(null)
  const [capturando, setCapturando] = useState(false)
  const [borrador, setBorrador] = useState('')

  // El estado de carga se enciende en el MANEJADOR del clic y se apaga en la
  // respuesta — nunca de forma síncrona dentro del efecto, que dispara
  // renders en cascada (react-hooks/set-state-in-effect). El efecto solo pide
  // los datos y escribe cuando llegan.
  useEffect(() => {
    let cancelado = false
    const llamar = httpsCallable(functions, 'resumenCostosIA')
    llamar({ dias })
      .then(({ data }) => {
        if (cancelado) return
        setDatos(data)
        setError(null)
        setCargando(false)
      })
      .catch((e) => {
        if (cancelado) return
        setError(e?.message || 'No se pudo cargar el resumen')
        setDatos(null)
        setCargando(false)
      })
    return () => { cancelado = true }
  }, [dias, recarga])

  function pedirRango(n) {
    if (n === dias) return
    setCargando(true)
    setDias(n)
  }

  function recargar() {
    setCargando(true)
    setRecarga((r) => r + 1)
  }

  useEffect(() => {
    let cancelado = false
    getDoc(doc(db, ...SALDO_REF))
      .then((s) => { if (!cancelado) setSaldo(s.exists() ? s.data() : null) })
      .catch(() => { if (!cancelado) setSaldo(null) })
    return () => { cancelado = true }
  }, [])

  async function guardarSaldo(e) {
    e.preventDefault()
    const monto = Number(borrador)
    if (!Number.isFinite(monto) || monto < 0) {
      toast('Escribe el saldo como un número, sin signo de pesos', 'error')
      return
    }
    setCapturando(true)
    try {
      const datosSaldo = {
        saldoMXN: monto,
        capturadoEn: serverTimestamp(),
        capturadoPor: currentUser?.uid || null,
        capturadoPorCorreo: currentUser?.email || null,
      }
      await setDoc(doc(db, ...SALDO_REF), datosSaldo)
      // Se relee del servidor para que la fecha mostrada sea la que quedó
      // guardada, no una que arme el navegador.
      const s = await getDoc(doc(db, ...SALDO_REF))
      setSaldo(s.exists() ? s.data() : null)
      setBorrador('')
      toast('Saldo capturado')
    } catch {
      toast('No se pudo guardar el saldo', 'error')
    } finally {
      setCapturando(false)
    }
  }

  const t = datos?.totales
  const promedio = t?.costoPromedioDiarioMXN
  const saldoMXN = typeof saldo?.saldoMXN === 'number' ? saldo.saldoMXN : null
  const diasRestantes = diasEstimadosRestantes(saldoMXN, promedio)
  const fechaCaptura = saldo?.capturadoEn?.toDate
    ? saldo.capturadoEn.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  const columnas = [
    { key: 'fecha', header: 'Día', render: (r) => <span className="tabular-nums">{diaCorto(r.fecha)}</span> },
    { key: 'llamadas', header: 'Llamadas', align: 'right', render: (r) => <span className="tabular-nums">{num(r.llamadas)}</span> },
    { key: 'tokensEntrada', header: 'Tokens entrada', align: 'right', render: (r) => <span className="tabular-nums text-muted">{num(r.tokensEntrada)}</span> },
    { key: 'tokensSalida', header: 'Tokens salida', align: 'right', render: (r) => <span className="tabular-nums text-muted">{num(r.tokensSalida)}</span> },
    {
      key: 'costoIAMXN', header: 'Costo IA estimado', align: 'right',
      render: (r) => <span className="tabular-nums">{dinero(r.costoIAMXN)}</span>,
    },
    { key: 'ingresosMXN', header: 'Ingresos', align: 'right', render: (r) => <span className="tabular-nums">{dinero(r.ingresosMXN)}</span> },
    {
      key: 'margenMXN', header: 'Margen sobre costo de IA', align: 'right',
      render: (r) => (
        <span className={`tabular-nums font-semibold ${
          r.margenMXN == null ? 'text-slate-400' : r.margenMXN < 0 ? 'text-red-600' : 'text-emerald-700'
        }`}>
          {dinero(r.margenMXN)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Rango */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex items-center gap-1.5 border-0 p-0 m-0">
          <legend className="sr-only">Rango de días</legend>
          {RANGOS_DIAS.map((n) => (
            <button
              key={n} type="button" onClick={() => pedirRango(n)}
              aria-pressed={dias === n}
              className={`px-3 py-1.5 text-sm font-semibold rounded border transition-colors ${
                dias === n
                  ? 'border-accent bg-[var(--accent-tint)] text-accent'
                  : 'border-outline-variant text-muted hover:border-accent hover:text-accent'
              }`}
            >
              {n} días
            </button>
          ))}
        </fieldset>
        <button
          type="button" onClick={recargar} disabled={cargando}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted border border-outline-variant rounded hover:bg-[var(--accent-tint)] hover:border-accent hover:text-accent transition-colors disabled:opacity-60"
        >
          <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {error && (
        <div className="bg-surface-card rounded-card shadow-card p-4 text-sm">
          <p className="font-medium text-red-600">No se pudo cargar el resumen.</p>
          <p className="text-muted mt-1">{error}</p>
        </div>
      )}

      {cargando && !datos ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : datos ? (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Indicador
              etiqueta="Costo IA estimado del periodo"
              valor={dinero(t.costoIAMXN)}
              ayuda="Calculado con los tokens que registramos y la tarifa de config/iaTarifas. NO es la factura de Anthropic."
            />
            <Indicador etiqueta="Ingresos del periodo" valor={dinero(t.ingresosMXN)}
              ayuda="Solo compras de créditos aprobadas (status completado), fechadas el día en que se aprobaron." />
            <Indicador
              etiqueta="Margen sobre costo de IA"
              valor={dinero(t.margenMXN)}
              tono={t.margenMXN < 0 ? 'text-red-600' : 'text-emerald-700'}
              ayuda="Ingresos menos costo de IA. NO es ganancia neta: no incluye Firebase, Vercel, Cloudinary ni comisiones de cobro."
            />
            <Indicador etiqueta="Costo promedio diario" valor={dinero(promedio)}
              ayuda={`Costo del periodo dividido entre sus ${t.diasDelPeriodo} días, incluyendo los días sin actividad.`} />
          </div>

          {/* Saldo capturado a mano */}
          <div className="bg-surface-card rounded-card shadow-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-on-surface text-sm">Saldo capturado</h3>
                <p className="text-xs text-muted mt-0.5 max-w-xl">
                  Anthropic no publica el saldo disponible por API, así que este dato no se consulta:
                  lo capturas tú de su consola. Sirve para estimar cuánto durará al ritmo de gasto actual.
                </p>
                {saldoMXN != null ? (
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-xl font-bold tabular-nums text-on-surface">{dinero(saldoMXN)}</span>
                    <span className="text-xs text-muted">Capturado el {fechaCaptura || '—'}</span>
                    {diasRestantes != null ? (
                      <span className="text-sm font-semibold text-accent">
                        ≈ {diasRestantes} días
                        <span className="font-normal text-muted"> (estimación basada en el saldo capturado y el costo promedio diario)</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">
                        Sin gasto en el periodo: no hay ritmo con el cual estimar los días restantes.
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Todavía no has capturado ningún saldo.</p>
                )}
              </div>
              <form onSubmit={guardarSaldo} className="flex items-end gap-2">
                <Input
                  id="saldo-anthropic" label="Saldo en MXN"
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={borrador} onChange={(e) => setBorrador(e.target.value)}
                  placeholder="0.00"
                  wrapperClassName="w-32"
                />
                <button
                  type="submit" disabled={capturando || borrador === ''}
                  className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors disabled:opacity-60"
                >
                  {capturando ? 'Guardando…' : 'Capturar'}
                </button>
              </form>
            </div>
          </div>

          {/* Gráfica */}
          <div className="bg-surface-card rounded-card shadow-card p-4">
            <h3 className="font-semibold text-on-surface text-sm mb-3">Costo de IA e ingresos por día</h3>
            <GraficaDiaria dias={datos.dias} />
          </div>

          {/* Tabla */}
          <Table
            columns={columnas}
            data={datos.dias}
            rowKey={(r) => r.fecha}
            emptyMessage="Sin actividad en el periodo"
            minWidth={760}
          />

          <p className="text-xs text-slate-400">
            <strong>Costo IA estimado</strong>: sale de los tokens que registramos por la tarifa configurada
            {datos.tipoCambioUsdMxnUsado != null ? ` (tipo de cambio ${datos.tipoCambioUsdMxnUsado} MXN/USD)` : ''} —
            no es la factura de Anthropic. <strong>Margen sobre costo de IA</strong>: no es ganancia neta,
            no incluye Firebase, Vercel, Cloudinary ni comisiones de cobro.
            {t.llamadasSinTarifa > 0 && (
              <> Hay <strong>{t.llamadasSinTarifa}</strong> llamada(s) cuyo modelo no tiene tarifa configurada:
                están contadas, pero su costo no pudo calcularse y no está sumado.</>
            )}
          </p>
        </>
      ) : null}
    </div>
  )
}
