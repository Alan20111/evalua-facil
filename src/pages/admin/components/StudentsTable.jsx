import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react'
import SearchInput from '../../../components/SearchInput'
import { formatDate, toDate } from '../../../utils/subscriptionHelpers'
import { formatHora12FromDate } from '../../../utils/formatHora'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'
import { useColumnWidths } from '../../../hooks/useColumnWidths'

// Cuántas filas se pintan de golpe. El padrón de estudiantes crece sin techo
// (uno por alumno por asignatura), así que renderizarlo entero congelaría la
// pestaña; se amplía de PAGE en PAGE con el botón del pie.
const PAGE = 100

// Alto de la zona con scroll propio de la tabla. En vez de crecer y empujar
// toda la página, la tabla se queda de este alto y su interior se desplaza,
// con los encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 340px)'

// Columnas. `filtro` marca las que se pueden filtrar desde su encabezado;
// `sort` las que ordenan al hacer clic en el título.
// `alta` y `hora` salen del MISMO campo (createdAt) y por eso comparten
// criterio de orden: ordenar por hora sin la fecha mezclaría días distintos.
// Nombre y Código no ordenan desde el encabezado por pedido explícito — la
// caja de búsqueda ya cubre esos dos campos.
const COLS = [
  { key: 'num', label: 'N.º', w: 60, align: 'right' },
  { key: 'nombre', label: 'Nombre', w: 210 },
  { key: 'codigo', label: 'Código', w: 115 },
  { key: 'escuela', label: 'Escuela', sort: 'escuela', filtro: 'escuela', w: 140 },
  { key: 'profesor', label: 'Profesor', sort: 'profesor', filtro: 'profesor', w: 170 },
  { key: 'asignatura', label: 'Asignatura', sort: 'asignatura', filtro: 'asignatura', w: 180 },
  { key: 'alta', label: 'Fecha de alta', sort: 'alta', w: 125 },
  { key: 'hora', label: 'Hora de alta', sort: 'alta', w: 110 },
  { key: 'activado', label: 'Activado', sort: 'activado', filtro: 'activado', w: 105 },
]

const FILTRABLES = COLS.filter((c) => c.filtro).map((c) => c.filtro)
const SIN_FILTROS = Object.fromEntries(FILTRABLES.map((f) => [f, '']))

// v2: la versión anterior guardaba píxeles; ahora se guardan proporciones
// (ver useColumnWidths). Clave nueva para no leer los píxeles viejos como si
// fueran fracciones.
const WIDTHS_KEY = 'admin-estudiantes-cols-v2'

// Cada criterio dice en español llano qué hace cada dirección, en vez de
// "ascendente/descendente" — que obliga a traducir mentalmente qué significa
// "ascendente" para una fecha o para un Sí/No.
const SORT_FIELDS = {
  alta: {
    label: 'Fecha y hora de alta',
    asc: 'Del más antiguo al más nuevo',
    desc: 'Del más nuevo al más antiguo',
    cmp: (a, b) => a.altaMs - b.altaMs,
  },
  clase: {
    label: 'Clase (asignatura y docente)',
    asc: 'De la más antigua a la más reciente',
    desc: 'De la más reciente a la más antigua',
    cmp: (a, b) =>
      a.loteMs - b.loteMs ||
      a.profesor.localeCompare(b.profesor, 'es') ||
      a.asignatura.localeCompare(b.asignatura, 'es'),
  },
  profesor: {
    label: 'Profesor', asc: 'De la A a la Z', desc: 'De la Z a la A',
    cmp: (a, b) => a.profesor.localeCompare(b.profesor, 'es'),
  },
  escuela: {
    label: 'Escuela', asc: 'De la A a la Z', desc: 'De la Z a la A',
    cmp: (a, b) => a.escuela.localeCompare(b.escuela, 'es'),
  },
  asignatura: {
    label: 'Asignatura', asc: 'De la A a la Z', desc: 'De la Z a la A',
    cmp: (a, b) => a.asignatura.localeCompare(b.asignatura, 'es'),
  },
  activado: {
    label: 'Activado', asc: 'Primero los que NO han activado', desc: 'Primero los que SÍ activaron',
    cmp: (a, b) => Number(a.activado) - Number(b.activado),
  },
  nombre: {
    label: 'Nombre', asc: 'De la A a la Z', desc: 'De la Z a la A',
    cmp: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  },
}

// Orden por defecto: hasta arriba el último dado de alta, activado o no.
const DEFAULT_SORT = [{ key: 'alta', dir: 'desc' }]
const MAX_NIVELES = 2

// El profesor se muestra por su nombre real; `teacherDisplayName` no sirve
// aquí porque antepone el prefijo pensado para los alumnos ("Profe X").
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

export default function StudentsTable({ stats }) {
  const [search, setSearch] = useState('')
  const [filtros, setFiltros] = useState(SIN_FILTROS)
  const [sortLevels, setSortLevels] = useState(DEFAULT_SORT)
  const [limit, setLimit] = useState(PAGE)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

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

  // Valores disponibles en cada filtro, sacados de los datos reales (no de una
  // lista fija): solo se ofrece lo que de verdad existe en el padrón.
  const opciones = useMemo(() => {
    const o = { escuela: new Set(), profesor: new Set(), asignatura: new Set() }
    rows.forEach((r) => {
      o.escuela.add(r.escuela)
      o.profesor.add(r.profesor)
      o.asignatura.add(r.asignatura)
    })
    return Object.fromEntries(
      Object.entries(o).map(([k, set]) => [k, [...set].sort((a, b) => a.localeCompare(b, 'es'))])
    )
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = rows.filter((r) => {
      if (filtros.escuela && r.escuela !== filtros.escuela) return false
      if (filtros.profesor && r.profesor !== filtros.profesor) return false
      if (filtros.asignatura && r.asignatura !== filtros.asignatura) return false
      if (filtros.activado && r.activado !== (filtros.activado === 'si')) return false
      if (!q) return true
      return [r.nombre, r.codigo, r.escuela, r.profesor, r.asignatura].some((v) =>
        v.toLowerCase().includes(q)
      )
    })
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
  }, [rows, search, filtros, sortLevels])

  const visible = filtered.slice(0, limit)

  // `students` guarda una inscripción por asignatura, no una persona: quien
  // cursa 3 materias tiene 3 documentos, todos con el MISMO código (así
  // comparten una sola cuenta — ver createEnrollment en teacher/SubjectPage).
  const personas = useMemo(() => new Set(rows.map((r) => r.codigo)).size, [rows])
  const personasFiltradas = useMemo(
    () => new Set(filtered.map((r) => r.codigo)).size,
    [filtered]
  )

  const hayFiltro = search.trim() !== '' || FILTRABLES.some((f) => filtros[f])

  function setFiltro(campo, valor) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
    setLimit(PAGE)
  }

  function limpiarTodo() {
    setFiltros(SIN_FILTROS)
    setSearch('')
    setLimit(PAGE)
  }

  function setNivelCampo(i, key) {
    setSortLevels((ls) => {
      if (!key) return ls.slice(0, i)
      const next = ls.slice(0, i + 1)
      next[i] = { key, dir: ls[i]?.key === key ? ls[i].dir : (key === 'alta' || key === 'clase' ? 'desc' : 'asc') }
      return [...next, ...ls.slice(i + 1).filter((l) => l.key !== key)]
    })
    setLimit(PAGE)
  }

  function setNivelDir(i, dir) {
    setSortLevels((ls) => ls.map((l, j) => (j === i ? { ...l, dir } : l)))
    setLimit(PAGE)
  }

  function sortByColumn(key) {
    if (!key) return
    setSortLevels((ls) =>
      ls[0]?.key === key
        ? [{ key, dir: ls[0].dir === 'asc' ? 'desc' : 'asc' }]
        : [{ key, dir: key === 'alta' || key === 'clase' ? 'desc' : 'asc' }]
    )
    setLimit(PAGE)
  }

  const esOrdenDefault =
    sortLevels.length === DEFAULT_SORT.length &&
    sortLevels.every((l, i) => l.key === DEFAULT_SORT[i].key && l.dir === DEFAULT_SORT[i].dir)

  if (!stats) return null

  const nivelesVisibles = Math.min(sortLevels.length + 1, MAX_NIVELES)

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-on-surface">Estudiantes</h2>
          {/* Lo que se busca al filtrar es CUÁNTOS cumplen; por eso el dato va
              grande y en guinda, no escondido en una línea de detalle. */}
          {hayFiltro ? (
            <p className="text-sm mt-0.5">
              <span className="font-bold text-accent">
                {personasFiltradas} estudiante{personasFiltradas !== 1 ? 's' : ''}
              </span>
              <span className="text-muted"> de {personas} · </span>
              <span className="font-bold text-accent">{filtered.length}</span>
              <span className="text-muted"> de {rows.length} inscripciones</span>
            </p>
          ) : (
            <p className="text-sm text-muted mt-0.5">
              {personas} estudiantes · {rows.length} inscripciones
            </p>
          )}
        </div>
        <div className="w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            placeholder="Buscar nombre, código, escuela…"
          />
        </div>
      </div>

      {/* Orden — separado de los filtros a propósito: ordenar reacomoda a
          TODOS, filtrar deja solo a los que cumplen. Son cosas distintas y
          antes se confundían por estar juntas. */}
      <div className="px-5 py-2.5 border-b border-outline-variant bg-surface space-y-2">
        {Array.from({ length: nivelesVisibles }, (_, i) => {
          const nivel = sortLevels[i]
          const campo = nivel ? SORT_FIELDS[nivel.key] : null
          const usados = sortLevels.filter((_, j) => j !== i).map((l) => l.key)
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted w-28 flex-shrink-0">
                {i === 0 ? 'Ordenar por' : 'Y después por'}
              </span>
              <select
                value={nivel?.key || ''}
                onChange={(e) => setNivelCampo(i, e.target.value)}
                className="text-sm rounded border border-outline-variant bg-surface-card px-2 py-1.5 text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">— Sin orden —</option>
                {Object.entries(SORT_FIELDS)
                  .filter(([k]) => !usados.includes(k))
                  .map(([k, f]) => (
                    <option key={k} value={k}>{f.label}</option>
                  ))}
              </select>
              {campo && (
                <select
                  value={nivel.dir}
                  onChange={(e) => setNivelDir(i, e.target.value)}
                  className="text-sm rounded border border-outline-variant bg-surface-card px-2 py-1.5 text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="asc">{campo.asc}</option>
                  <option value="desc">{campo.desc}</option>
                </select>
              )}
              {i === 0 && !esOrdenDefault && (
                <button
                  type="button"
                  onClick={() => { setSortLevels(DEFAULT_SORT); setLimit(PAGE) }}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
                >
                  <RotateCcw size={13} /> Restablecer orden
                </button>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-4 pt-0.5">
          {hayFiltro && (
            <button
              type="button"
              onClick={limpiarTodo}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <X size={13} /> Quitar todos los filtros
            </button>
          )}
          <button
            type="button"
            onClick={resetWidths}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
          >
            <RotateCcw size={13} /> Restablecer ancho de columnas
          </button>
          <span className="text-xs text-slate-400">
            Filtra desde las listas de cada encabezado. Arrastra su borde para repartir el ancho (se recuerda).
          </span>
        </div>
      </div>

      {/* Scroll propio, vertical y horizontal, con los encabezados fijos: la
          tabla ya no empuja el largo de la página completa. */}
      <div ref={containerRef} className="overflow-auto" style={{ maxHeight: ALTO_TABLA }}>
        {/* table-fixed + <colgroup> es lo que hace que los anchos arrastrados
            se respeten; sin ellos el navegador reparte el espacio a su gusto. */}
        <table className="text-sm table-fixed" style={{ width: total }}>
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] }} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-left text-xs uppercase">
              {COLS.map(({ key, label, sort, filtro, align }) => {
                const nivel = sort ? sortLevels.findIndex((l) => l.key === sort) : -1
                // El color del encabezado señala FILTRO aplicado (no orden):
                // al poner el filtro en "Todas" vuelve solo a su color normal.
                const filtrada = filtro && filtros[filtro]
                return (
                  <th
                    key={key}
                    aria-sort={nivel === 0 ? (sortLevels[0].dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-muted'
                    }`}
                  >
                    {sort ? (
                      <button
                        type="button"
                        onClick={() => sortByColumn(sort)}
                        title="Ordenar por esta columna"
                        className="flex items-center gap-1 uppercase hover:text-accent transition-colors max-w-full"
                      >
                        <span className="truncate">{label}</span>
                        {nivel >= 0 && (sortLevels[nivel].dir === 'asc'
                          ? <ChevronUp size={13} className="flex-shrink-0" />
                          : <ChevronDown size={13} className="flex-shrink-0" />)}
                      </button>
                    ) : (
                      <span className={`block truncate ${align === 'right' ? 'text-right' : ''}`}>
                        {label}
                      </span>
                    )}

                    {/* Filtro de la columna. "Todas" = sin filtro, y con eso el
                        encabezado recupera su color normal. */}
                    {filtro && (
                      <select
                        value={filtros[filtro]}
                        onChange={(e) => setFiltro(filtro, e.target.value)}
                        aria-label={`Filtrar por ${label}`}
                        className={`mt-1 w-full text-xs normal-case rounded border px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          filtrada
                            ? 'border-accent bg-surface-card text-accent font-semibold'
                            : 'border-outline-variant bg-surface-card text-muted'
                        }`}
                      >
                        <option value="">
                          {filtro === 'activado' ? 'Todos' : 'Todas'}
                        </option>
                        {filtro === 'activado' ? (
                          <>
                            <option value="si">Sí</option>
                            <option value="no">No</option>
                          </>
                        ) : (
                          opciones[filtro].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))
                        )}
                      </select>
                    )}

                    {/* Tirador de ancho: lo que gana esta columna lo cede la
                        de su derecha, así el total nunca se pasa del área. */}
                    {esRedimensionable(key) && (
                      <span
                        onPointerDown={(e) => startResize(e, key)}
                        onDoubleClick={() => resetColumn(key)}
                        title="Arrastra para cambiar el ancho (doble clic para restablecer)"
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize flex justify-center group"
                      >
                        <span
                          className={`h-full transition-colors ${
                            dragKey === key
                              ? 'w-[2px] bg-accent'
                              : 'w-px bg-outline-variant group-hover:bg-accent'
                          }`}
                        />
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-8 text-center text-slate-400">
                  {rows.length === 0
                    ? 'Sin estudiantes registrados'
                    : 'Ningún estudiante cumple con lo que se está filtrando'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-[var(--accent-tint)]">
                  {/* Contador de la vista, de mayor a menor: arriba va el total
                      de los que cumplen y abajo el 1. No es un dato del alumno
                      —los estudiantes no tienen número— sino la cuenta de lo
                      que se está viendo. */}
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                    {filtered.length - i}
                  </td>
                  <td className="px-3 py-2 font-medium text-on-surface truncate" title={r.nombre}>{r.nombre}</td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-on-surface truncate">{r.codigo}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.escuela}>{r.escuela}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.profesor}>{r.profesor}</td>
                  <td className="px-3 py-2 text-muted truncate" title={r.asignatura}>{r.asignatura}</td>
                  <td className="px-3 py-2 text-muted truncate">{r.alta}</td>
                  <td className="px-3 py-2 text-muted truncate tabular-nums">{r.hora}</td>
                  <td className="px-3 py-2">
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
