import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { startOfWeekMon, addDays } from '../../utils/calendarGrid'

// Asistencias del estudiante organizadas por semana (sep-2026). SOLO
// presentación: recibe los registros y los totales YA calculados en
// pages/student/SubjectPage.jsx (misma regla de siempre — ver
// utils/asistenciaResumen.js) y no calcula porcentajes ni denominadores.
//
// La unidad sigue siendo la sesión: cada registro (fecha + slot) se dibuja como
// su propia marca "Clase N" dentro de su día; nunca se fusionan. No hay tope
// de clases por día: las marcas se apilan hacia abajo y la fila crece.

const LETRAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function etiquetaSemana(lunes) {
  const domingo = addDays(lunes, 6)
  const mesL = MESES_CORTO[lunes.getMonth()]
  const mesD = MESES_CORTO[domingo.getMonth()]
  return mesL === mesD
    ? `${lunes.getDate()} – ${domingo.getDate()} ${mesD}`
    : `${lunes.getDate()} ${mesL} – ${domingo.getDate()} ${mesD}`
}

function fmtDia(fecha) {
  const d = new Date(`${fecha}T12:00:00`)
  return `${DIAS_CORTO[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`
}

// Semanas (lunes→domingo) que tienen al menos un registro, de la más reciente
// a la más antigua. Dentro de cada día, las clases en orden de slot.
function agruparPorSemana(registros) {
  const semanas = new Map()
  for (const r of registros) {
    const lunes = startOfWeekMon(new Date(`${r.fecha}T12:00:00`))
    const key = isoLocal(lunes)
    if (!semanas.has(key)) semanas.set(key, { key, lunes, dias: {} })
    const s = semanas.get(key)
    ;(s.dias[r.fecha] ||= []).push(r)
  }
  const lista = [...semanas.values()].sort((a, b) => b.key.localeCompare(a.key))
  for (const s of lista) {
    for (const f of Object.keys(s.dias)) s.dias[f].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1))
  }
  return lista
}

function Stat({ valor, etiqueta, className }) {
  return (
    <div className="rounded-card bg-surface-container px-2 py-2.5 text-center min-w-0">
      <p className={`text-2xl sm:text-3xl font-bold leading-none tabular-nums ${className}`}>{valor}</p>
      <p className="text-xs text-muted mt-1 leading-tight">{etiqueta}</p>
    </div>
  )
}

const ESTILO = {
  presente: { chip: 'bg-emerald-100 text-emerald-800', nombre: 'Presente' },
  justificada: { chip: 'bg-amber-100 text-amber-800', nombre: 'Justificada' },
  falta: { chip: 'bg-red-100 text-red-700', nombre: 'Falta' },
}

function Marca({ r, seleccionada, onToggle }) {
  const e = ESTILO[r.estado] || ESTILO.presente
  const slot = r.slot ?? 1
  const simbolo = r.estado === 'falta'
    ? <X size={10} strokeWidth={3} className="flex-shrink-0" />
    : r.estado === 'justificada'
      ? <span className="font-bold leading-none">J</span>
      : <Check size={10} strokeWidth={3} className="flex-shrink-0" />
  // Sin ancho fijo: ocupa la columna del día y cabe "12✓" aun a 320 px de pantalla.
  const base = `w-full flex items-center justify-center gap-px rounded px-0.5 py-0.5 text-[10px] sm:text-[11px] leading-none font-semibold tabular-nums whitespace-nowrap ${e.chip}`
  const conMotivo = r.estado === 'justificada' && !!r.motivo
  const titulo = `Clase ${slot}: ${e.nombre}`
  if (!conMotivo) {
    return <span className={base} aria-label={titulo} title={titulo}>{slot}{simbolo}</span>
  }
  // Justificada con motivo: se consulta con el cursor (tooltip) o tocándola
  // (abre la línea del motivo al pie de la semana).
  return (
    <button type="button" onClick={onToggle}
      data-tooltip={r.motivo}
      aria-label={`${titulo}. Ver motivo`}
      aria-expanded={seleccionada}
      className={`${base} ring-1 ring-amber-500 ${seleccionada ? 'ring-2' : ''} cursor-pointer`}>
      {slot}{simbolo}
    </button>
  )
}

export default function AsistenciaSemanal({
  parcial, registros, stat, pct, pctInasist, riesgo, denominador, cerrado, umbralInasistencia, todayISO,
}) {
  const [motivoAbierto, setMotivoAbierto] = useState(null) // `${fecha}-${slot}`
  const semanas = agruparPorSemana(registros)
  const presentes = stat.asist - stat.justif
  const enRiesgo = pctInasist != null && pctInasist >= umbralInasistencia

  return (
    <div className="space-y-2">
      {/* ── Resumen del parcial ── */}
      <div className="bg-surface-card rounded-card shadow-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
            <span className="text-accent font-bold">{parcial}</span>
          </div>
          <p className="font-semibold text-lg text-on-surface flex-1 min-w-0">Parcial {parcial}</p>
          {riesgo && <span className="text-xl flex-shrink-0" aria-hidden="true">{riesgo}</span>}
        </div>

        {/* Los dos porcentajes son sobre las sesiones del PERIODO (el denominador
            que calcula SubjectPage), no sobre las clases registradas — por eso
            la etiqueta lo dice y el total de sesiones va pegado a ellos. */}
        {pct != null && (
          <div className="mt-3">
            <div className="flex items-end flex-wrap gap-x-5 gap-y-1.5">
              <p className="leading-none">
                <span className={`text-4xl font-bold tabular-nums ${enRiesgo ? 'text-red-500' : 'text-accent'}`}>{pct}%</span>
                <span className="text-sm text-muted ml-1.5">asistencia del periodo</span>
              </p>
              {pctInasist != null && (
                <p className="leading-none">
                  <span className={`text-2xl font-bold tabular-nums ${enRiesgo ? 'text-red-500' : 'text-slate-500'}`}>{pctInasist}%</span>
                  <span className="text-sm text-muted ml-1.5">inasistencia del periodo</span>
                </p>
              )}
            </div>
            {!cerrado && denominador != null && (
              <p className="text-xs text-muted mt-1.5">{denominador} sesiones del periodo</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat valor={stat.total} etiqueta="Clases registradas" className="text-on-surface" />
          <Stat valor={presentes} etiqueta={`Presente${presentes !== 1 ? 's' : ''}`} className="text-emerald-700" />
          <Stat valor={stat.justif} etiqueta={`Justificada${stat.justif !== 1 ? 's' : ''}`} className="text-amber-700" />
          <Stat valor={stat.inasist} etiqueta={`Falta${stat.inasist !== 1 ? 's' : ''}`} className="text-red-600" />
        </div>

        {/* Sin porcentajes (sin denominador válido) el total va aquí, como antes. */}
        {pct == null && !cerrado && denominador != null && (
          <p className="text-xs text-muted mt-2">{denominador} sesiones del periodo</p>
        )}

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><span className="inline-flex items-center justify-center w-5 h-4 rounded bg-emerald-100 text-emerald-800"><Check size={11} strokeWidth={3} /></span>Presente</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex items-center justify-center w-5 h-4 rounded bg-amber-100 text-amber-800 text-[11px] font-bold">J</span>Justificada</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex items-center justify-center w-5 h-4 rounded bg-red-100 text-red-700"><X size={11} strokeWidth={3} /></span>Falta</span>
          <span>· El número es la clase del día</span>
        </div>
      </div>

      {/* ── Semanas (más reciente primero; solo las que tienen clases) ── */}
      {semanas.map((s) => {
        const regsSemana = Object.values(s.dias).flat()
        const asistSemana = regsSemana.filter((r) => r.estado !== 'falta').length
        const faltasSemana = regsSemana.length - asistSemana
        const abierto = regsSemana.find((r) => `${r.fecha}-${r.slot ?? 1}` === motivoAbierto)
        return (
          <div key={s.key} className="bg-surface-card rounded-card shadow-card px-2 sm:px-3 py-2.5" data-semana={s.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 mb-2">
              <p className="text-sm font-semibold text-on-surface">Semana {etiquetaSemana(s.lunes)}</p>
              <p className="text-xs text-muted tabular-nums">
                {regsSemana.length} clase{regsSemana.length !== 1 ? 's' : ''} · {asistSemana} asistencia{asistSemana !== 1 ? 's' : ''} · <span className={faltasSemana > 0 ? 'text-red-600 font-semibold' : ''}>{faltasSemana} falta{faltasSemana !== 1 ? 's' : ''}</span>
              </p>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {LETRAS.map((l, i) => {
                const dia = addDays(s.lunes, i)
                const fecha = isoLocal(dia)
                const regs = s.dias[fecha] || []
                const finde = i >= 5
                const hoy = fecha === todayISO
                return (
                  <div key={i} className={`min-w-0 rounded flex flex-col items-center gap-1 px-0.5 pt-1 pb-1.5 ${finde ? 'bg-surface-container' : ''} ${hoy ? 'ring-1 ring-accent' : ''}`}>
                    <span className="text-[11px] font-semibold text-muted leading-none">{l}</span>
                    <span className={`text-sm leading-none tabular-nums ${regs.length ? 'font-semibold text-on-surface' : 'text-slate-400'}`}>{dia.getDate()}</span>
                    {/* Una semana puede cruzar de mes (lun–dom sin cortar): el día 1
                        lleva su mes para que el cambio se lea sin pensar. */}
                    {dia.getDate() === 1 && (
                      <span className="text-[10px] font-semibold uppercase text-accent leading-none -mt-0.5">{MESES_CORTO[dia.getMonth()]}</span>
                    )}
                    {regs.map((r) => {
                      const k = `${r.fecha}-${r.slot ?? 1}`
                      return (
                        <Marca key={k} r={r} seleccionada={motivoAbierto === k}
                          onToggle={() => setMotivoAbierto((cur) => (cur === k ? null : k))} />
                      )
                    })}
                  </div>
                )
              })}
            </div>
            {abierto && (
              <p className="mt-2 mx-1 rounded bg-amber-50 text-amber-900 text-xs px-2 py-1.5 break-words" data-motivo>
                <span className="font-semibold">{fmtDia(abierto.fecha)} · Clase {abierto.slot ?? 1} — </span>{abierto.motivo}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
