import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, X, RotateCcw } from 'lucide-react'
import SearchInput from '../../../components/SearchInput'
import { formatDate, toDate } from '../../../utils/subscriptionHelpers'
import { formatHora12FromDate } from '../../../utils/formatHora'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'

// Cuántas filas se pintan de golpe. El padrón de estudiantes crece sin techo
// (uno por alumno por asignatura), así que renderizarlo entero congelaría la
// pestaña; se amplía de PAGE en PAGE con el botón del pie.
const PAGE = 100

// Columnas visibles. `alta` y `hora` salen del MISMO campo (createdAt) y por
// eso comparten criterio de ordenamiento: ordenar por hora sin la fecha
// mezclaría días distintos, que no es lo que nadie espera de un padrón.
const COLS = [
  { key: 'nombre', label: 'Nombre', sort: 'nombre' },
  { key: 'codigo', label: 'Código', sort: 'codigo' },
  { key: 'escuela', label: 'Escuela', sort: 'escuela' },
  { key: 'profesor', label: 'Profesor', sort: 'profesor' },
  { key: 'asignatura', label: 'Asignatura', sort: 'asignatura' },
  { key: 'alta', label: 'Fecha de alta', sort: 'alta' },
  { key: 'hora', label: 'Hora de alta', sort: 'alta' },
  { key: 'activado', label: 'Activado', sort: 'activado' },
]

// Criterios disponibles en el constructor de orden. `cmp` compara SIEMPRE en
// ascendente; la dirección se aplica afuera multiplicando por -1.
const SORT_FIELDS = {
  lote: {
    label: 'Clase (misma asignatura y docente)',
    // Mantiene juntas las inscripciones de una misma clase y coloca primero
    // la clase dada de alta más recientemente. El desempate por docente y
    // asignatura evita que dos clases con el mismo instante se entrelacen.
    cmp: (a, b) =>
      a.loteMs - b.loteMs ||
      a.profesor.localeCompare(b.profesor, 'es') ||
      a.asignatura.localeCompare(b.asignatura, 'es'),
  },
  alta: { label: 'Fecha y hora de alta', cmp: (a, b) => a.altaMs - b.altaMs },
  profesor: { label: 'Profesor', cmp: (a, b) => a.profesor.localeCompare(b.profesor, 'es') },
  escuela: { label: 'Escuela', cmp: (a, b) => a.escuela.localeCompare(b.escuela, 'es') },
  asignatura: { label: 'Asignatura', cmp: (a, b) => a.asignatura.localeCompare(b.asignatura, 'es') },
  activado: { label: 'Activado', cmp: (a, b) => Number(a.activado) - Number(b.activado) },
  nombre: { label: 'Nombre', cmp: (a, b) => a.nombre.localeCompare(b.nombre, 'es') },
  codigo: { label: 'Código', cmp: (a, b) => a.codigo.localeCompare(b.codigo, 'es') },
}

// Orden por defecto: la clase dada de alta más recientemente arriba, con sus
// estudiantes juntos y el más nuevo primero dentro de cada una. El estado de
// activación NO participa — un alumno recién dado de alta debe aparecer
// arriba aunque todavía no active su cuenta.
const DEFAULT_SORT = [
  { key: 'lote', dir: 'desc' },
  { key: 'alta', dir: 'desc' },
]

// El profesor se muestra por su nombre real; `teacherDisplayName` no sirve
// aquí porque antepone el prefijo pensado para los alumnos ("Profe X").
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

export default function StudentsTable({ stats }) {
  const [search, setSearch] = useState('')
  const [sortLevels, setSortLevels] = useState(DEFAULT_SORT)
  const [limit, setLimit] = useState(PAGE)

  // Cada estudiante se "aplana" una sola vez a las columnas visibles: así el
  // filtro y el ordenamiento trabajan sobre texto ya resuelto en vez de
  // volver a cruzar escuela/asignatura/docente en cada tecla.
  const rows = useMemo(() => {
    if (!stats) return []
    const { students = [], schoolsMap = {}, subjectsMap = {}, teachersMap = {} } = stats
    const base = students.map((s) => {
      const subject = subjectsMap[s.asignaturaId]
      // students no guarda docenteId: el profesor sale de la asignatura. El
      // campo suelto `s.docenteId` existe en documentos viejos y se usa como
      // respaldo cuando la asignatura ya no está.
      const docenteId = subject?.docenteId || s.docenteId || ''
      const teacher = teachersMap[docenteId]
      const school = schoolsMap[s.escuelaId]
      const alta = toDate(s.createdAt)
      return {
        id: s.id,
        nombre: studentFullName(s) || '—',
        codigo: s.username || '—',
        escuela: school?.shortName || school?.nombre || school?.claveSEP || '—',
        profesor: teacherName(teacher) || '—',
        asignatura: subjectDisplayName(subject) || '—',
        alta: formatDate(s.createdAt), // ya devuelve '—' si no hay fecha
        hora: alta ? formatHora12FromDate(alta) : '—',
        altaMs: alta ? alta.getTime() : 0,
        loteKey: `${docenteId}|${s.asignaturaId || ''}`,
        activado: s.activado === true,
      }
    })
    // El "lote" de una clase se fecha por su alta MÁS RECIENTE: si el docente
    // agrega un alumno tardío al grupo, la clase entera sube con él en vez de
    // quedar anclada a la carga original.
    const loteMs = {}
    base.forEach((r) => {
      loteMs[r.loteKey] = Math.max(loteMs[r.loteKey] ?? 0, r.altaMs)
    })
    return base.map((r) => ({ ...r, loteMs: loteMs[r.loteKey] }))
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
    return [...base].sort((a, b) => {
      for (const { key, dir } of sortLevels) {
        const field = SORT_FIELDS[key]
        if (!field) continue
        const r = field.cmp(a, b) * (dir === 'asc' ? 1 : -1)
        if (r !== 0) return r
      }
      // Desempate final fijo: sin él, dos filas "iguales" según los criterios
      // elegidos podrían intercambiarse entre renders.
      return a.nombre.localeCompare(b.nombre, 'es')
    })
  }, [rows, search, sortLevels])

  const visible = filtered.slice(0, limit)

  // `students` guarda una inscripción por asignatura, no una persona: quien
  // cursa 3 materias tiene 3 documentos, todos con el MISMO código (así
  // comparten una sola cuenta — ver createEnrollment en teacher/SubjectPage).
  // Sin este segundo conteo el total se lee como "número de alumnos" y queda
  // inflado; contar códigos distintos da las personas reales.
  const personas = useMemo(() => new Set(rows.map((r) => r.codigo)).size, [rows])

  const sinUsar = Object.keys(SORT_FIELDS).filter(
    (k) => !sortLevels.some((l) => l.key === k)
  )

  function addLevel(key) {
    if (!key) return
    setSortLevels((ls) => [...ls, { key, dir: key === 'alta' || key === 'lote' ? 'desc' : 'asc' }])
    setLimit(PAGE)
  }

  function toggleDir(i) {
    setSortLevels((ls) =>
      ls.map((l, j) => (j === i ? { ...l, dir: l.dir === 'asc' ? 'desc' : 'asc' } : l))
    )
  }

  function removeLevel(i) {
    setSortLevels((ls) => (ls.length === 1 ? ls : ls.filter((_, j) => j !== i)))
  }

  // Clic en el encabezado: asciende esa columna al primer criterio SIN borrar
  // los demás (si ya era el primero, solo invierte). Así una combinación que
  // el usuario armó a mano no se pierde por tocar un encabezado.
  function sortByColumn(key) {
    setSortLevels((ls) => {
      if (ls[0]?.key === key) {
        return ls.map((l, j) => (j === 0 ? { ...l, dir: l.dir === 'asc' ? 'desc' : 'asc' } : l))
      }
      const dir = key === 'alta' ? 'desc' : 'asc'
      return [{ key, dir }, ...ls.filter((l) => l.key !== key)]
    })
    setLimit(PAGE)
  }

  const esDefault =
    sortLevels.length === DEFAULT_SORT.length &&
    sortLevels.every((l, i) => l.key === DEFAULT_SORT[i].key && l.dir === DEFAULT_SORT[i].dir)

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

      {/* Constructor de orden — los criterios se aplican en cadena: el primero
          manda y los siguientes solo desempatan. El número de la pastilla
          hace visible esa jerarquía, que si no es invisible. */}
      <div className="px-5 py-2.5 border-b border-outline-variant bg-surface flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-muted">Ordenar por</span>

        {sortLevels.map((lv, i) => (
          <span
            key={lv.key}
            className="inline-flex items-center rounded-pill border border-accent bg-[var(--accent-tint)] text-accent text-xs font-semibold overflow-hidden"
          >
            <span className="px-1.5 py-1 bg-accent text-white">{i + 1}</span>
            <button
              type="button"
              onClick={() => toggleDir(i)}
              title={lv.dir === 'asc' ? 'Ascendente — clic para invertir' : 'Descendente — clic para invertir'}
              className="flex items-center gap-1 px-2 py-1 hover:bg-[var(--accent-tint-strong)] transition-colors"
            >
              {SORT_FIELDS[lv.key].label}
              {lv.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {sortLevels.length > 1 && (
              <button
                type="button"
                onClick={() => removeLevel(i)}
                aria-label={`Quitar criterio ${SORT_FIELDS[lv.key].label}`}
                className="px-1.5 py-1 hover:bg-[var(--accent-tint-strong)] transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </span>
        ))}

        {sinUsar.length > 0 && (
          <select
            value=""
            onChange={(e) => addLevel(e.target.value)}
            aria-label="Agregar criterio de orden"
            className="text-xs rounded border border-outline-variant bg-surface-card px-2 py-1.5 text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">+ Agregar criterio…</option>
            {sinUsar.map((k) => (
              <option key={k} value={k}>{SORT_FIELDS[k].label}</option>
            ))}
          </select>
        )}

        {!esDefault && (
          <button
            type="button"
            onClick={() => { setSortLevels(DEFAULT_SORT); setLimit(PAGE) }}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
          >
            <RotateCcw size={13} /> Restablecer
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1020px]">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              {/* El consecutivo es la posición en la tabla, no un dato del
                  alumno — por eso no ordena. */}
              <th className="px-4 py-2 w-12 text-right">N.º</th>
              {COLS.map(({ key, label, sort }) => {
                const nivel = sortLevels.findIndex((l) => l.key === sort)
                return (
                  <th key={key} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => sortByColumn(sort)}
                      title="Ordenar por esta columna (pasa al primer criterio)"
                      className="flex items-center gap-1 uppercase hover:text-accent transition-colors"
                    >
                      {label}
                      {nivel === 0 &&
                        (sortLevels[0].dir === 'asc'
                          ? <ChevronUp size={13} />
                          : <ChevronDown size={13} />)}
                      {nivel > 0 && (
                        <span className="text-[10px] font-bold text-accent">{nivel + 1}</span>
                      )}
                    </button>
                  </th>
                )
              })}
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
                  <td className="px-4 py-2 text-muted whitespace-nowrap tabular-nums">{r.hora}</td>
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
