// ─── Horario: programación de bloques de clases por asignatura ───────────────
//
// Modelo de datos: colección `horarioBloques`. Cada documento es una instancia
// materializada (una clase en una fecha concreta), lo que permite mover,
// editar o eliminar bloques de forma individual.
//
//   {
//     docenteId,
//     programacionId,   // agrupa todos los bloques generados juntos
//     asignaturaId,
//     fecha,            // 'YYYY-MM-DD'
//     horaInicio,       // 'HH:MM'
//     horaFin,          // 'HH:MM'  (calculado: horas × duracionMin)
//     horas,            // nº de horas/bloques consecutivos
//     lugar,            // 'Aula 3', 'Centro de cómputo', … (opcional)
//     color,            // clave de BLOQUE_COLORS
//     alarma: { activa, sonido, minutosAntes },
//     movido,           // true si el docente lo arrastró manualmente
//     createdAt,
//   }

// ─── Paleta de fondos suaves (texto legible encima) ──────────────────────────

export const BLOQUE_COLORS = [
  { id: 'blue',   bg: '#dbeafe', text: '#1e40af', label: 'Azul' },
  { id: 'teal',   bg: '#ccfbf1', text: '#0f766e', label: 'Verde agua' },
  { id: 'green',  bg: '#dcfce7', text: '#166534', label: 'Verde' },
  { id: 'lime',   bg: '#ecfccb', text: '#4d7c0f', label: 'Lima' },
  { id: 'amber',  bg: '#fef3c7', text: '#92400e', label: 'Ámbar' },
  { id: 'orange', bg: '#ffedd5', text: '#9a3412', label: 'Naranja' },
  { id: 'rose',   bg: '#ffe4e6', text: '#9f1239', label: 'Rosa' },
  { id: 'purple', bg: '#f3e8ff', text: '#6b21a8', label: 'Morado' },
  { id: 'indigo', bg: '#e0e7ff', text: '#3730a3', label: 'Índigo' },
  { id: 'slate',  bg: '#f1f5f9', text: '#334155', label: 'Gris' },
]

export function bloqueColor(id) {
  return BLOQUE_COLORS.find(c => c.id === id) || BLOQUE_COLORS[0]
}

// ─── Sonidos de alarma (sintetizados con WebAudio, sin archivos externos) ─────
// Cada sonido es una secuencia de notas [frecuencia Hz, duración s].

export const ALARMA_SONIDOS = [
  { id: 'campana',  label: 'Campana',   notas: [[880, 0.15], [660, 0.15], [880, 0.3]] },
  { id: 'timbre',   label: 'Timbre',    notas: [[1046, 0.12], [1046, 0.12], [1046, 0.12]] },
  { id: 'suave',    label: 'Suave',     notas: [[523, 0.25], [659, 0.25], [784, 0.4]] },
  { id: 'digital',  label: 'Digital',   notas: [[1200, 0.08], [900, 0.08], [1200, 0.08], [900, 0.08]] },
  { id: 'marimba',  label: 'Marimba',   notas: [[659, 0.2], [784, 0.2], [988, 0.2], [1319, 0.35]] },
]

export function reproducirSonido(sonidoId) {
  const def = ALARMA_SONIDOS.find(s => s.id === sonidoId) || ALARMA_SONIDOS[0]
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    let t = ctx.currentTime
    def.notas.forEach(([freq, dur]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
      t += dur
    })
    // Cierra el contexto tras terminar para no acumular instancias.
    setTimeout(() => ctx.close().catch(() => {}), (t - ctx.currentTime + 0.2) * 1000)
  } catch { /* sin audio disponible */ }
}

// ─── Helpers de tiempo ───────────────────────────────────────────────────────

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Suma minutos a una hora 'HH:MM' y devuelve 'HH:MM' (acotado a 00:00–23:59).
export function addMinutesToTime(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number)
  let total = h * 60 + m + minutes
  if (total < 0) total = 0
  if (total > 23 * 60 + 59) total = 23 * 60 + 59
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// 'HH:MM' → minutos desde medianoche.
export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Día de la semana lunes=0 … domingo=6 a partir de un Date.
export function diaSemanaLunes(d) {
  return (d.getDay() + 6) % 7
}

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

// ─── Generación de bloques ───────────────────────────────────────────────────
//
// Recorre día a día el rango [fechaInicio, fechaFin], omitiendo los asuetos, y
// por cada patrón que coincida con el día de la semana genera UN bloque (un
// rectángulo) de `duracionMin`. Cada patrón = un bloque colocado en la zona
// semanal: si el docente quiere varias horas seguidas coloca varios patrones
// (07:00, 08:00…), y el número de bloques por semana coincide con el número de
// patrones (2 horas seguidas = 2 unidades de BS).
//
// Cada patrón puede traer su propio `color`, `lugar` y `alarma` (se definen al
// colocarlo en la zona semanal). Si no los trae, se usan los valores por
// defecto que recibe la función (`color`, `alarma`).
//
// La alarma queda activa solo en el PRIMER bloque de cada corrida de bloques
// consecutivos del mismo día (los siguientes sonarían en plena clase anterior).
//
// Devuelve un array de bloques SIN docenteId/programacionId/createdAt (esos los
// añade el llamador al persistir).

export function generarBloques({ fechaInicio, fechaFin, diasAsueto = [], duracionMin, patrones, color, alarma }) {
  const bloques = []
  if (!fechaInicio || !fechaFin || !patrones?.length) return bloques

  const asueto = new Set(diasAsueto)
  const inicio = new Date(fechaInicio + 'T12:00:00')
  const fin = new Date(fechaFin + 'T12:00:00')
  if (fin < inicio) return bloques

  // Índice de patrones por día de la semana.
  const porDia = {}
  patrones.forEach(p => {
    (porDia[p.diaSemana] ||= []).push(p)
  })

  const cur = new Date(inicio)
  let guard = 0
  while (cur <= fin && guard < 2000) {
    guard++
    const fecha = toDateStr(cur)
    if (!asueto.has(fecha)) {
      const dia = diaSemanaLunes(cur)
      ;(porDia[dia] || []).forEach(p => {
        bloques.push({
          fecha,
          diaSemana: dia,
          horaInicio: p.horaInicio,
          horaFin: addMinutesToTime(p.horaInicio, p.duracionMin || duracionMin),
          horas: 1,
          lugar: (p.lugar || '').trim(),
          color: p.color || color,
          alarma: { ...(p.alarma || alarma) },
          movido: false,
        })
      })
    }
    cur.setDate(cur.getDate() + 1)
  }

  // Alarma solo en el primer bloque de cada corrida consecutiva del mismo día:
  // si un bloque empieza justo cuando termina otro del mismo día, es "seguido"
  // y su alarma se apaga (sonaría durante la clase previa).
  if (alarma?.activa) {
    const finPorDia = {}
    ;[...bloques]
      .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio))
      .forEach(b => {
        if (finPorDia[b.fecha] === b.horaInicio) {
          b.alarma = { ...b.alarma, activa: false }
        }
        finPorDia[b.fecha] = b.horaFin
      })
  }

  return bloques
}
