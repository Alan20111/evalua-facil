// Piezas del calendario con el patrón del Calendario de Apple (oct-2026):
//   · VistaAnio   — los 12 meses en miniatura; tocar un mes abre su vista Mes.
//   · TiraSemana  — la semana del día elegido (L…D) con el día en un círculo de
//                   acento; deslizar o las flechas cambian de semana.
// Viven aparte de CalendarPage.jsx (no lo importan) para no crear un ciclo:
// CalendarPage es quien las usa. La semana empieza en lunes, igual que el
// resto del calendario de la app.
import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const LETRAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const sumaDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const lunesDe = (d) => sumaDias(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7))

// Celdas de un mes (lunes primero) con huecos al inicio; solo días del mes.
function celdasMes(anio, mes) {
  const hueco = (new Date(anio, mes, 1).getDay() + 6) % 7
  const total = new Date(anio, mes + 1, 0).getDate()
  return [...Array.from({ length: hueco }, () => null), ...Array.from({ length: total }, (_, i) => i + 1)]
}

// ── Vista Año ────────────────────────────────────────────────────────────
// 3 columnas en el teléfono, 4 en la laptop. El mes actual va en acento y hoy
// en un círculo de acento (la app no usa el rojo de Apple: rojo = atención).
export function VistaAnio({ anio, onElegirMes }) {
  const hoy = new Date()
  return (
    <div className="grid grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6 p-4">
      {MESES_CORTO.map((nombre, mes) => {
        const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() === mes
        return (
          <button
            key={nombre}
            type="button"
            onClick={() => onElegirMes(new Date(anio, mes, 1))}
            aria-label={`Ver ${MESES[mes]} de ${anio}`}
            className="self-start text-left rounded-card p-2 -m-2 hover:bg-[var(--accent-tint)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className={`block text-lg font-bold mb-1 ${esMesActual ? 'text-accent' : 'text-on-surface'}`}>{nombre}</span>
            <span aria-hidden="true" className="grid grid-cols-7 gap-y-0.5 text-[0.65rem] font-semibold tabular-nums">
              {celdasMes(anio, mes).map((dia, i) => {
                const esHoy = dia && esMesActual && hoy.getDate() === dia
                return (
                  <span key={i} className="flex items-center justify-center h-4">
                    {dia && (
                      <span className={`w-4 h-4 flex items-center justify-center rounded-full ${esHoy ? 'bg-accent text-white' : i % 7 >= 5 ? 'text-hint' : 'text-on-surface'}`}>
                        {dia}
                      </span>
                    )}
                  </span>
                )
              })}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Tira de la semana (vista Día en el teléfono) ─────────────────────────
export function TiraSemana({ fecha, onElegir }) {
  const lunes = lunesDe(fecha)
  const dias = Array.from({ length: 7 }, (_, i) => sumaDias(lunes, i))
  const hoy = new Date()
  const inicio = useRef(null)

  // Deslizar a los lados cambia de semana (como en Apple); un toque normal no.
  const alSoltar = (e) => {
    if (inicio.current == null) return
    const dx = e.clientX - inicio.current
    inicio.current = null
    if (Math.abs(dx) > 50) onElegir(sumaDias(fecha, dx < 0 ? 7 : -7))
  }

  return (
    <div
      className="select-none"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(e) => { inicio.current = e.clientX }}
      onPointerUp={alSoltar}
      onPointerCancel={() => { inicio.current = null }}
    >
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onElegir(sumaDias(fecha, -7))} aria-label="Semana anterior"
          className="p-2 rounded-full text-hint hover:text-accent hover:bg-[var(--accent-tint)] transition-colors flex-shrink-0">
          <ChevronLeft size={18} />
        </button>
        <div className="grid grid-cols-7 flex-1 min-w-0" role="group" aria-label="Días de la semana">
          {dias.map((d, i) => {
            const elegido = mismoDia(d, fecha)
            const esHoy = mismoDia(d, hoy)
            return (
              <button
                key={i}
                type="button"
                onClick={() => onElegir(d)}
                aria-label={`${DIAS_LARGO[i]} ${d.getDate()} de ${MESES[d.getMonth()]}`}
                aria-pressed={elegido}
                className="flex flex-col items-center gap-1 py-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className={`text-[0.7rem] font-semibold ${i >= 5 ? 'text-hint' : 'text-muted'}`}>{LETRAS[i]}</span>
                <span className={`w-9 h-9 flex items-center justify-center rounded-full text-base font-semibold tabular-nums transition-colors ${
                  elegido ? 'bg-accent text-white' : esHoy ? 'text-accent' : i >= 5 ? 'text-hint' : 'text-on-surface'
                }`}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => onElegir(sumaDias(fecha, 7))} aria-label="Semana siguiente"
          className="p-2 rounded-full text-hint hover:text-accent hover:bg-[var(--accent-tint)] transition-colors flex-shrink-0">
          <ChevronRight size={18} />
        </button>
      </div>
      <p className="text-center text-sm font-semibold text-on-surface mt-2">
        {DIAS_LARGO[(fecha.getDay() + 6) % 7]}, {fecha.getDate()} {MESES_CORTO[fecha.getMonth()].toLowerCase()} {fecha.getFullYear()}
      </p>
    </div>
  )
}
