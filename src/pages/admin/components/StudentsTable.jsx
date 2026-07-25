import { useState, useMemo } from 'react'
import { RotateCcw, X } from 'lucide-react'
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
const ALTO_TABLA = 'calc(100vh - 290px)'

// Columnas. `filtro` = tipo de caja que lleva debajo del título:
//   'texto'  → se escribe y va filtrando, con sugerencias de los valores que
//              todavía cumplen (sirve aunque haya cientos de escuelas)
//   'fecha'  → selector de día
//   'sino'   → tres botones (Todos / Sí / No), un solo clic cada uno
// La tabla NO se puede reordenar: va siempre del alta más nueva a la más
// antigua. Antes había un control de orden y se quitó por pedido explícito.
const COLS = [
  { key: 'num', label: 'Hallazgos', w: 100, align: 'right' },
  { key: 'nombre', label: 'Nombre', w: 200 },
  { key: 'codigo', label: 'Código', w: 110 },
  { key: 'escuela', label: 'Escuela', filtro: 'texto', w: 150 },
  { key: 'profesor', label: 'Profesor', filtro: 'texto', w: 165 },
  { key: 'asignatura', label: 'Asignatura', filtro: 'texto', w: 175 },
  { key: 'alta', label: 'Fecha de alta', filtro: 'fecha', w: 145 },
  { key: 'hora', label: 'Hora de alta', w: 105 },
  { key: 'activado', label: 'Activado', filtro: 'sino', w: 130 },
]

const CAMPOS_TEXTO = ['escuela', 'profesor', 'asignatura']
const CAMPOS_FILTRO = COLS.filter((c) => c.filtro).map((c) => c.key)
const SIN_FILTROS = Object.fromEntries(CAMPOS_FILTRO.map((k) => [k, '']))

// v4: cambian los anchos por defecto al quitar la fila de orden y ensanchar
// Activado. Clave nueva para no arrastrar proporciones viejas.
const WIDTHS_KEY = 'admin-estudiantes-cols-v4'

// El profesor se muestra por su nombre real; `teacherDisplayName` no sirve
// aquí porque antepone el prefijo pensado para los alumnos ("Profe X").
function teacherName(teacher) {
  return teacher?.nombreMostrar || teacher?.nombre || teacher?.username || ''
}

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ¿Esta fila pasa los filtros? `excepto` deja fuera un campo a propósito: sirve
// para calcular qué valores sugerir en ESA columna sin que su propio texto a
// medio escribir recorte la lista.
function pasaFiltros(r, filtros, search, excepto) {
  const t = (k) => (k === excepto ? '' : filtros[k].trim().toLowerCase())
  // Coincidencia por texto contenido y sin distinguir mayúsculas: escribir
  // "cultura" alcanza a la vez "Cultura digital" y "Cultura Digital".
  if (t('escuela') && !r.escuela.toLowerCase().includes(t('escuela'))) return false
  if (t('profesor') && !r.profesor.toLowerCase().includes(t('profesor'))) return false
  if (t('asignatura') && !r.asignatura.toLowerCase().includes(t('asignatura'))) return false
  if (excepto !== 'alta' && filtros.alta && r.altaISO !== filtros.alta) return false
  if (excepto !== 'activado' && filtros.activado && r.activado !== (filtros.activado === 'si')) return false
  const q = search.trim().toLowerCase()
  if (q && ![r.nombre, r.codigo].some((v) => v.toLowerCase().includes(q))) return false
  return true
}

// Tres botones en vez de una lista desplegable: cambiar entre Todos / Sí / No
// es un solo clic, no abrir-buscar-elegir.
function BotonesSiNo({ valor, onChange }) {
  const OPCIONES = [['', 'Todos'], ['si', 'Sí'], ['no', 'No']]
  return (
    <div className="mt-1 flex rounded border border-outline-variant overflow-hidden normal-case">
      {OPCIONES.map(([v, etiqueta]) => (
        <button
          key={v || 'todos'}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={`flex-1 text-[11px] py-1 transition-colors ${
            valor === v
              ? 'bg-accent text-white font-bold'
              : 'bg-surface-card text-muted hover:bg-[var(--accent-tint)]'
          }`}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  )
}

// Caja de filtro de una columna, con su "x" para quitarlo al instante.
function CeldaFiltro({ col, valor, onChange, sugerencias }) {
  const activo = valor !== ''
  if (col.filtro === 'sino') return <BotonesSiNo valor={valor} onChange={onChange} />

  const base = `w-full text-xs normal-case rounded border px-1.5 py-1 pr-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    activo
      ? 'border-accent bg-surface-card text-accent font-semibold'
      : 'border-outline-variant bg-surface-card text-muted'
  }`
  const listId = `sug-${col.key}`
  return (
    <div className="relative mt-1">
      {col.filtro === 'fecha' ? (
        <input
          type="date" value={valor} onChange={(e) => onChange(e.target.value)}
          aria-label={`Filtrar por ${col.label}`} className={base}
        />
      ) : (
        <>
          {/* <datalist> nativo: al escribir, el navegador va mostrando los
              valores que todavía cumplen. Se alimenta de los datos reales y ya
              filtrados por las OTRAS columnas, así que elegir un profesor
              reduce las escuelas que se sugieren. */}
          <input
            type="text" value={valor} onChange={(e) => onChange(e.target.value)}
            list={listId} placeholder="Buscar…" autoComplete="off"
            aria-label={`Filtrar por ${col.label}`} className={base}
          />
          <datalist id={listId}>
            {sugerencias.map((v) => <option key={v} value={v} />)}
          </datalist>
        </>
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
  const [limit, setLimit] = useState(PAGE)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

  // Cada estudiante se "aplana" una sola vez a las columnas visibles: así el
  // filtro trabaja sobre texto ya resuelto en vez de volver a cruzar
  // escuela/asignatura/docente en cada tecla.
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

  // Orden fijo: el último dado de alta hasta arriba, activado o no. Los
  // cargados en lote comparten el mismo instante, así que dentro del lote
  // desempata el nombre.
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => pasaFiltros(r, filtros, search, null))
        .sort((a, b) => b.altaMs - a.altaMs || a.nombre.localeCompare(b.nombre, 'es')),
    [rows, filtros, search]
  )

  // Sugerencias por columna: los valores que TODAVÍA cumplen con lo demás que
  // ya está filtrado, no el catálogo completo.
  const sugerencias = useMemo(() => {
    const res = {}
    CAMPOS_TEXTO.forEach((campo) => {
      const set = new Set()
      rows.forEach((r) => {
        if (pasaFiltros(r, filtros, search, campo)) set.add(r[campo])
      })
      res[campo] = [...set].sort((a, b) => a.localeCompare(b, 'es'))
    })
    return res
  }, [rows, filtros, search])

  const visible = filtered.slice(0, limit)
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

  if (!stats) return null

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-on-surface">Estudiantes</h2>
          <p className="text-sm mt-0.5">
            {hayFiltro ? (
              <>
                <span className="font-bold text-accent">{filtered.length}</span>
                <span className="text-muted"> de {rows.length} registros</span>
              </>
            ) : (
              <span className="text-muted">{rows.length} registros</span>
            )}
          </p>
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
                const filtrada = filtro && filtros[key] !== ''
                return (
                  <th
                    key={key}
                    className={`sticky top-0 z-10 relative px-3 py-2 align-top select-none transition-colors ${
                      filtrada ? 'bg-accent-light text-accent' : 'bg-surface text-muted'
                    }`}
                  >
                    <span className={`block truncate ${align === 'right' ? 'text-right' : ''}`}>
                      {label}
                    </span>

                    {filtro && (
                      <CeldaFiltro
                        col={col}
                        valor={filtros[key]}
                        onChange={(v) => setFiltro(key, v)}
                        sugerencias={sugerencias[key] || []}
                      />
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

      <div className="px-5 py-2.5 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={resetWidths}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
        >
          <RotateCcw size={13} /> Restablecer ancho de columnas
        </button>
        {filtered.length > visible.length && (
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted">Mostrando {visible.length} de {filtered.length}</p>
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
    </div>
  )
}
