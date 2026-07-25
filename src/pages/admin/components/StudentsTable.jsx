import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import SearchInput from '../../../components/SearchInput'
import { formatDate } from '../../../utils/subscriptionHelpers'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'

// Cuántas filas se pintan de golpe. El padrón de estudiantes crece sin techo
// (uno por alumno por asignatura), así que renderizarlo entero congelaría la
// pestaña; se amplía de PAGE en PAGE con el botón del pie.
const PAGE = 100

const COLS = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'codigo', label: 'Código' },
  { key: 'escuela', label: 'Escuela' },
  { key: 'profesor', label: 'Profesor' },
  { key: 'asignatura', label: 'Asignatura' },
  { key: 'alta', label: 'Fecha de alta' },
  { key: 'activado', label: 'Activado' },
]

// El profesor se muestra por su nombre real; `teacherDisplayName` no sirve
// aquí porque antepone el prefijo pensado para los alumnos ("Profe X").
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

export default function StudentsTable({ stats }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'nombre', dir: 'asc' })
  const [limit, setLimit] = useState(PAGE)

  // Cada estudiante se "aplana" una sola vez a las columnas visibles: así el
  // filtro y el ordenamiento trabajan sobre texto ya resuelto en vez de
  // volver a cruzar escuela/asignatura/docente en cada tecla.
  const rows = useMemo(() => {
    if (!stats) return []
    const { students = [], schoolsMap = {}, subjectsMap = {}, teachersMap = {} } = stats
    return students.map((s) => {
      const subject = subjectsMap[s.asignaturaId]
      // students no guarda docenteId: el profesor sale de la asignatura. El
      // campo suelto `s.docenteId` existe en documentos viejos y se usa como
      // respaldo cuando la asignatura ya no está.
      const teacher = teachersMap[subject?.docenteId || s.docenteId]
      const school = schoolsMap[s.escuelaId]
      return {
        id: s.id,
        nombre: studentFullName(s) || '—',
        codigo: s.username || '—',
        escuela: school?.shortName || school?.nombre || school?.claveSEP || '—',
        profesor: teacherName(teacher) || '—',
        asignatura: subjectDisplayName(subject) || '—',
        alta: formatDate(s.createdAt), // ya devuelve '—' si no hay fecha
        altaMs: s.createdAt?.toMillis?.() ?? 0,
        activado: s.activado === true,
      }
    })
  }, [stats])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? rows.filter((r) =>
          [r.nombre, r.codigo, r.escuela, r.profesor, r.asignatura].some((v) =>
            v.toLowerCase().includes(q)
          )
        )
      : rows
    const { key, dir } = sort
    const mult = dir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => {
      // Fecha ordena por su valor real, no por el texto "12 ene 2026";
      // Activado agrupa Sí/No; el resto es alfabético con reglas del español.
      if (key === 'alta') return (a.altaMs - b.altaMs) * mult
      if (key === 'activado') return (Number(a.activado) - Number(b.activado)) * mult
      return a[key].localeCompare(b[key], 'es') * mult
    })
  }, [rows, search, sort])

  const visible = filtered.slice(0, limit)

  // `students` guarda una inscripción por asignatura, no una persona: quien
  // cursa 3 materias tiene 3 documentos, todos con el MISMO código (así
  // comparten una sola cuenta — ver createEnrollment en teacher/SubjectPage).
  // Sin este segundo conteo el total se lee como "número de alumnos" y queda
  // inflado; contar códigos distintos da las personas reales.
  const personas = useMemo(() => new Set(rows.map((r) => r.codigo)).size, [rows])

  function toggleSort(key) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
    setLimit(PAGE) // reordenar y quedarse en la página 5 desorienta
  }

  if (!stats) return null

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-on-surface">
          Estudiantes
          <span className="ml-2 text-sm font-normal text-muted">
            {search
              ? `${filtered.length} de ${rows.length} inscripciones`
              : `${rows.length} inscripcion${rows.length !== 1 ? 'es' : ''} · ${personas} estudiante${personas !== 1 ? 's' : ''}`}
          </span>
        </h2>
        <div className="w-full sm:w-72">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            placeholder="Buscar nombre, código, escuela…"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              {/* El consecutivo es la posición en la tabla, no un dato del
                  alumno — por eso no ordena. */}
              <th className="px-4 py-2 w-12 text-right">N.º</th>
              {COLS.map(({ key, label }) => (
                <th key={key} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="flex items-center gap-1 uppercase hover:text-accent transition-colors"
                  >
                    {label}
                    {sort.key === key &&
                      (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 1} className="px-4 py-8 text-center text-slate-400">
                  {rows.length === 0 ? 'Sin estudiantes registrados' : 'Ningún estudiante coincide con la búsqueda'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-[var(--accent-tint)]">
                  <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-on-surface">{r.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-on-surface">{r.codigo}</td>
                  <td className="px-4 py-2 text-muted truncate max-w-[140px]">{r.escuela}</td>
                  <td className="px-4 py-2 text-muted truncate max-w-[160px]">{r.profesor}</td>
                  <td className="px-4 py-2 text-muted truncate max-w-[180px]">{r.asignatura}</td>
                  <td className="px-4 py-2 text-muted whitespace-nowrap">{r.alta}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.activado ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.activado ? 'Sí' : 'No'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > visible.length && (
        <div className="px-5 py-3 border-t border-outline-variant flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            Mostrando {visible.length} de {filtered.length}
          </p>
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="px-3 py-1.5 text-sm font-semibold text-accent border border-accent rounded hover:bg-[var(--accent-tint)] transition-colors"
          >
            Mostrar {Math.min(PAGE, filtered.length - visible.length)} más
          </button>
        </div>
      )}
    </div>
  )
}
