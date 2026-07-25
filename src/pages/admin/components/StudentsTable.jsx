import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
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

// Columnas visibles. `alta` y `hora` salen del MISMO campo (createdAt) y por
// eso comparten criterio de ordenamiento: ordenar por hora sin la fecha
// mezclaría días distintos, que no es lo que nadie espera de un padrón.
// `sort` ausente = el encabezado no ordena al hacer clic. N.º es la posición
// en la tabla, no un dato del alumno; Nombre y Código no ordenan desde el
// encabezado por pedido explícito (no aporta nada útil en un padrón que se
// consulta por fecha o por grupo). Ambos siguen disponibles en las listas de
// "Ordenar por" para quien sí los quiera.
const COLS = [
  { key: 'num', label: 'N.º', w: 56, align: 'right' },
  { key: 'nombre', label: 'Nombre', w: 200 },
  { key: 'codigo', label: 'Código', w: 110 },
  { key: 'escuela', label: 'Escuela', sort: 'escuela', w: 130 },
  { key: 'profesor', label: 'Profesor', sort: 'profesor', w: 160 },
  { key: 'asignatura', label: 'Asignatura', sort: 'asignatura', w: 170 },
  { key: 'alta', label: 'Fecha de alta', sort: 'alta', w: 120 },
  { key: 'hora', label: 'Hora de alta', sort: 'alta', w: 105 },
  { key: 'activado', label: 'Activado', sort: 'activado', w: 95 },
]

// v2: la versión anterior guardaba píxeles; ahora se guardan proporciones
// (ver useColumnWidths). Clave nueva para no leer los píxeles viejos como si
// fueran fracciones.
const WIDTHS_KEY = 'admin-estudiantes-cols-v2'

// Cada criterio dice en español llano qué hace cada dirección, en vez de
// "ascendente/descendente" — que obliga a traducir mentalmente qué significa
// "ascendente" para una fecha o para un Sí/No.
const SORT_FIELDS = {
  clase: {
    label: 'Clase (asignatura y docente)',
    asc: 'De la más antigua a la más reciente',
    desc: 'De la más reciente a la más antigua',
    // Mantiene juntas las inscripciones de una misma clase y ordena las
    // clases por su alta más reciente. El desempate por docente y asignatura
    // evita que dos clases del mismo instante se entrelacen.
    cmp: (a, b) =>
      a.loteMs - b.loteMs ||
      a.profesor.localeCompare(b.profesor, 'es') ||
      a.asignatura.localeCompare(b.asignatura, 'es'),
  },
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
  codigo: {
    label: 'Código', asc: 'De la A a la Z', desc: 'De la Z a la A',
    cmp: (a, b) => a.codigo.localeCompare(b.codigo, 'es'),
  },
}

// Orden por defecto: hasta arriba el último estudiante dado de alta, activado
// o no. Un solo criterio a propósito — antes el primer renglón decía "Clase
// (asignatura y docente)", que aunque daba el mismo resultado no comunicaba
// "el más nuevo primero". El estado de activación NO participa en el orden.
// Los estudiantes cargados en lote comparten el mismo instante exacto; el
// desempate final por nombre los deja en orden alfabético dentro del lote.
const DEFAULT_SORT = [{ key: 'alta', dir: 'desc' }]

const MAX_NIVELES = 3

// El profesor se muestra por su nombre real; `teacherDisplayName` no sirve
// aquí porque antepone el prefijo pensado para los alumnos ("Profe X").
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

export default function StudentsTable({ stats }) {
  const [search, setSearch] = useState('')
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

  // Y lo mismo para el resultado de la búsqueda: lo que se quiere saber al
  // buscar es a cuántos ESTUDIANTES se llegó, no a cuántos renglones.
  const personasFiltradas = useMemo(
    () => new Set(filtered.map((r) => r.codigo)).size,
    [filtered]
  )

  // Cambiar el criterio del nivel `i`. Elegir "Sin orden" corta ahí: los
  // niveles siguientes dejan de tener sentido, así que se descartan.
  function setNivelCampo(i, key) {
    setSortLevels((ls) => {
      if (!key) return ls.slice(0, i)
      const next = ls.slice(0, i + 1)
      next[i] = { key, dir: ls[i]?.key === key ? ls[i].dir : (key === 'alta' || key === 'clase' ? 'desc' : 'asc') }
      // Un mismo campo dos veces no ordena nada nuevo: se quita del resto.
      return [...next, ...ls.slice(i + 1).filter((l) => l.key !== key)]
    })
    setLimit(PAGE)
  }

  function setNivelDir(i, dir) {
    setSortLevels((ls) => ls.map((l, j) => (j === i ? { ...l, dir } : l)))
    setLimit(PAGE)
  }

  // Clic en el encabezado: ordena por esa columna, y un segundo clic invierte.
  // Es el atajo que todo el mundo espera de una tabla; deja el orden en un
  // solo criterio, que es justo lo que alguien quiere al hacer clic ahí.
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

  // Se muestra una fila de orden por cada nivel elegido, más una vacía al
  // final para agregar el siguiente (hasta MAX_NIVELES).
  const nivelesVisibles = Math.min(sortLevels.length + 1, MAX_NIVELES)

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-on-surface">
          Estudiantes
          <span className="ml-2 text-sm font-normal text-muted">
            {search ? (
              <>
                Coinciden{' '}
                <span className="font-semibold text-accent">
                  {personasFiltradas} de {personas} estudiante{personas !== 1 ? 's' : ''}
                </span>
                {' · '}{filtered.length} inscripcion{filtered.length !== 1 ? 'es' : ''}
              </>
            ) : (
              `${personas} estudiante${personas !== 1 ? 's' : ''} · ${rows.length} inscripcion${rows.length !== 1 ? 'es' : ''}`
            )}
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

      {/* Orden en dos listas por renglón, como el cuadro "Ordenar" de una hoja
          de cálculo: qué columna y, en palabras, en qué sentido. La versión
          anterior usaba pastillas numeradas encadenadas y resultó ilegible. */}
      <div className="px-5 py-3 border-b border-outline-variant bg-surface space-y-2">
        {Array.from({ length: nivelesVisibles }, (_, i) => {
          const nivel = sortLevels[i]
          const campo = nivel ? SORT_FIELDS[nivel.key] : null
          // Un campo ya usado en otro renglón no se ofrece de nuevo.
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
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          {!esOrdenDefault && (
            <button
              type="button"
              onClick={() => { setSortLevels(DEFAULT_SORT); setLimit(PAGE) }}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              <RotateCcw size={13} /> Restablecer orden
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
            Arrastra el borde de un encabezado para repartir el ancho entre esa columna y la siguiente (se recuerda).
          </span>
        </div>
      </div>

      {/* El ancho de este contenedor es el que la tabla llena exactamente. Solo
          aparece scroll cuando el área es más angosta que el mínimo de todas
          las columnas juntas (ventana muy chica). */}
      <div ref={containerRef} className="overflow-x-auto">
        {/* table-fixed + <colgroup> es lo que hace que los anchos arrastrados
            se respeten; sin ellos el navegador reparte el espacio a su gusto. */}
        <table className="text-sm table-fixed" style={{ width: total }}>
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={{ width: widths[c.key] }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              {COLS.map(({ key, label, sort, align }) => {
                const activo = sortLevels[0]?.key === sort && sort
                return (
                  <th key={key} className="relative px-4 py-2 select-none">
                    {sort ? (
                      <button
                        type="button"
                        onClick={() => sortByColumn(sort)}
                        title="Ordenar por esta columna"
                        className="flex items-center gap-1 uppercase hover:text-accent transition-colors max-w-full"
                      >
                        <span className="truncate">{label}</span>
                        {activo && (sortLevels[0].dir === 'asc'
                          ? <ChevronUp size={13} className="flex-shrink-0" />
                          : <ChevronDown size={13} className="flex-shrink-0" />)}
                      </button>
                    ) : (
                      <span className={`block truncate ${align === 'right' ? 'text-right' : ''}`}>
                        {label}
                      </span>
                    )}
                    {/* Tirador de ancho: lo que gana esta columna lo cede la
                        de su derecha, así el total nunca se pasa del área.
                        Por eso la última no lleva tirador — es la que absorbe
                        el sobrante. Doble clic restablece esta columna. */}
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
                  {rows.length === 0 ? 'Sin estudiantes registrados' : 'Ningún estudiante coincide con la búsqueda'}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-[var(--accent-tint)]">
                  <td className="px-4 py-2 text-right text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-on-surface truncate" title={r.nombre}>{r.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-on-surface truncate">{r.codigo}</td>
                  <td className="px-4 py-2 text-muted truncate" title={r.escuela}>{r.escuela}</td>
                  <td className="px-4 py-2 text-muted truncate" title={r.profesor}>{r.profesor}</td>
                  <td className="px-4 py-2 text-muted truncate" title={r.asignatura}>{r.asignatura}</td>
                  <td className="px-4 py-2 text-muted truncate">{r.alta}</td>
                  <td className="px-4 py-2 text-muted truncate tabular-nums">{r.hora}</td>
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
