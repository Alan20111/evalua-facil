import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react'
import SearchInput from '../../../components/SearchInput'
import { formatDate, toDate } from '../../../utils/subscriptionHelpers'
import { formatHora12FromDate } from '../../../utils/formatHora'
import { studentFullName } from '../../../utils/studentSearch'
import { subjectDisplayName } from '../../../utils/subjectName'
import { useColumnWidths } from '../../../hooks/useColumnWidths'

// Cuántas filas se pintan de golpe. El padrón crece sin techo (un registro por
// alumno por asignatura), así que renderizarlo entero congelaría la pestaña.
const PAGE = 100

// Alto de la zona con scroll propio de la tabla: en vez de estirar la página,
// la tabla se queda de este alto y su interior se desplaza con los
// encabezados fijos arriba.
const ALTO_TABLA = 'calc(100vh - 330px)'

// Columnas. `filtro` = tipo de caja que lleva debajo del título:
//   'texto' → se escribe y va filtrando (sirve aunque haya cientos de valores,
//             que es justo el caso de escuelas/profesores/asignaturas)
//   'fecha' → selector de día
//   'lista' → lista corta y cerrada (solo Activado: Sí/No)
// Los encabezados NO ordenan al hacer clic: el orden se maneja arriba, en
// "Ordenar por". Mezclar ambas cosas en el mismo lugar confundía.
const COLS = [
  { key: 'num', label: 'Hallazgos', w: 100, align: 'right' },
  { key: 'nombre', label: 'Nombre', w: 200 },
  { key: 'codigo', label: 'Código', w: 110 },
  { key: 'escuela', label: 'Escuela', filtro: 'texto', w: 150 },
  { key: 'profesor', label: 'Profesor', filtro: 'texto', w: 170 },
  { key: 'asignatura', label: 'Asignatura', filtro: 'texto', w: 180 },
  { key: 'alta', label: 'Fecha de alta', filtro: 'fecha', w: 145 },
  { key: 'hora', label: 'Hora de alta', w: 110 },
  { key: 'activado', label: 'Activado', filtro: 'lista', w: 110 },
]

const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

// v3: cambian los anchos por defecto (la columna de conteo pasó de "N.º" a
// "Hallazgos"). Clave nueva para no arrastrar proporciones viejas.
const WIDTHS_KEY = 'admin-estudiantes-cols-v3'

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

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Caja de filtro de una columna, con su "x" para quitarlo al instante.
function CeldaFiltro({ col, valor, onChange }) {
  const activo = valor !== ''
  const base = `w-full text-xs normal-case rounded border px-1.5 py-1 pr-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    activo
      ? 'border-accent bg-surface-card text-accent font-semibold'
      : 'border-outline-variant bg-surface-card text-muted'
  }`
  return (
    <div className="relative mt-1">
      {col.filtro === 'lista' ? (
        <select value={valor} onChange={(e) => onChange(e.target.value)} aria-label={`Filtrar por ${col.label}`} className={base}>
          <option value="">Todos</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      ) : col.filtro === 'fecha' ? (
        <input type="date" value={valor} onChange={(e) => onChange(e.target.value)} aria-label={`Filtrar por ${col.label}`} className={base} />
      ) : (
        <input
          type="text"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Buscar…"
          aria-label={`Filtrar por ${col.label}`}
          className={base}
        />
      )}
      {activo && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Quitar filtro de ${col.label}`}
          title="Quitar este filtro"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-accent hover:text-accent-hover"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
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
    return students.map((s) => {
      const subject = subjectsMap[s.asignaturaId]
      // students no guarda docenteId: el profesor sale de la asignatura. El
      // campo suelto `s.docenteId` existe en documentos viejos y se usa como
      // respaldo cuando la asignatura ya no está.
      const docenteId = subject?.docenteId || s.docenteId || ''
      const teacher = teachersMap[docenteId]
      const school = schoolsMap[s.escuelaId]
      const fecha = toDate(s.createdAt)
      return {
        id: s.id,
        nombre: studentFullName(s) || '—',
        codigo: s.username || '—',
        escuela: school?.shortName || school?.nombre || school?.claveSEP || '—',
        profesor: teacherName(teacher) || '—',
        asignatura: subjectDisplayName(subject) || '—',
        alta: formatDate(s.createdAt), // ya devuelve '—' si no hay fecha
        altaISO: fecha ? isoLocal(fecha) : '',
        hora: fecha ? formatHora12FromDate(fecha) : '—',
        altaMs: fecha ? fecha.getTime() : 0,
        activado: s.activado === true,
      }
    })
  }, [stats])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const txt = (campo) => filtros[campo].trim().toLowerCase()
    const base = rows.filter((r) => {
      // Coincidencia por texto contenido y sin distinguir mayúsculas: escribir
      // "cultura" alcanza tanto a "Cultura digital" como a "Cultura Digital".
      if (txt('escuela') && !r.escuela.toLowerCase().includes(txt('escuela'))) return false
      if (txt('profesor') && !r.profesor.toLowerCase().includes(txt('profesor'))) return false
      if (txt('asignatura') && !r.asignatura.toLowerCase().includes(txt('asignatura'))) return false
      if (filtros.alta && r.altaISO !== filtros.alta) return false
      if (filtros.activado && r.activado !== (filtros.activado === 'si')) return false
      if (!q) return true
      return [r.nombre, r.codigo].some((v) => v.toLowerCase().includes(q))
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

  // Un mismo alumno tiene un registro POR ASIGNATURA, todos con el mismo
  // código (así comparten una sola cuenta — ver createEnrollment en
  // teacher/SubjectPage). Contar códigos distintos da las personas reales.
  const personas = useMemo(() => new Set(rows.map((r) => r.codigo)).size, [rows])
  const personasFiltradas = useMemo(
    () => new Set(filtered.map((r) => r.codigo)).size,
    [filtered]
  )

  const hayFiltro = search.trim() !== '' || CAMPOS_FILTRO.some((k) => filtros[k])

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
      next[i] = { key, dir: ls[i]?.key === key ? ls[i].dir : (key === 'alta' ? 'desc' : 'asc') }
      return [...next, ...ls.slice(i + 1).filter((l) => l.key !== key)]
    })
    setLimit(PAGE)
  }

  function setNivelDir(i, dir) {
    setSortLevels((ls) => ls.map((l, j) => (j === i ? { ...l, dir } : l)))
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
        <div className="min-w-0">
          <h2 className="font-semibold text-on-surface">Estudiantes</h2>
          {hayFiltro ? (
            <p className="text-sm mt-0.5">
              <span className="font-bold text-accent">{filtered.length}</span>
              <span className="text-muted"> de {rows.length} registros · </span>
              <span className="font-bold text-accent">{personasFiltradas}</span>
              <span className="text-muted"> de {personas} estudiantes distintos</span>
            </p>
          ) : (
            <p className="text-sm text-muted mt-0.5">
              {rows.length} registros · {personas} estudiantes distintos
            </p>
          )}
          {/* Sin esta aclaración los dos números parecen contradecirse. */}
          <p className="text-xs text-slate-400 mt-0.5">
            Cada renglón es un estudiante en una asignatura: quien cursa varias aparece una vez por cada una.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 w-full sm:w-80">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setLimit(PAGE) }}
            placeholder="Buscar por nombre o código…"
          />
          {/* Arriba a la derecha, junto al buscador: es donde se mira cuando se
              quiere deshacer lo que se acaba de filtrar. */}
          <button
            type="button"
            onClick={limpiarTodo}
            disabled={!hayFiltro}
            className="self-end inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent text-accent hover:bg-[var(--accent-tint)]"
          >
            <X size={15} /> Quitar todos los filtros
          </button>
        </div>
      </div>

      {/* Orden — aparte de los filtros a propósito: ordenar reacomoda a TODOS,
          filtrar deja solo a los que cumplen. */}
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
          <button
            type="button"
            onClick={resetWidths}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
          >
            <RotateCcw size={13} /> Restablecer ancho de columnas
          </button>
          <span className="text-xs text-slate-400">
            Escribe en las cajas de los encabezados para filtrar. Arrastra su borde para repartir el ancho (se recuerda).
          </span>
        </div>
      </div>

      {/* Scroll propio, vertical y horizontal, con los encabezados fijos. */}
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
              {COLS.map((col) => {
                const { key, label, filtro, align } = col
                const nivel = sortLevels.findIndex((l) => l.key === key)
                const filtrada = filtro && filtros[key] !== ''
                return (
                  <th
                    key={key}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-muted'
                    }`}
                  >
                    {/* Solo texto: el título ya no ordena al hacer clic. La
                        flechita indica —sin ser botón— por cuál columna está
                        ordenada la tabla en este momento. */}
                    <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                      <span className="truncate">{label}</span>
                      {nivel >= 0 && (sortLevels[nivel].dir === 'asc'
                        ? <ChevronUp size={13} className="flex-shrink-0" />
                        : <ChevronDown size={13} className="flex-shrink-0" />)}
                    </span>

                    {filtro && (
                      <CeldaFiltro col={col} valor={filtros[key]} onChange={(v) => setFiltro(key, v)} />
                    )}

                    {/* Tirador de ancho: lo que gana esta columna lo cede la de
                        su derecha, así el total nunca se pasa del área. */}
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
                  {/* Cuenta de lo que se está viendo, de mayor a menor: arriba
                      el total de los que cumplen y abajo el 1. No es un dato
                      del alumno — los estudiantes no tienen número. */}
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
