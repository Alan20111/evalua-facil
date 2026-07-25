// Tabla canónica (variante "admin/presentacional") — extraída literal de
// docs/DESIGN_SYSTEM.md §6.6. Para las tablas de datos con cabecera + filas
// con hover + estado vacío. La tabla de calificaciones sticky del docente es
// un caso especial (columnas sticky, edición por celda) y NO usa esto.
//
// Props:
//   columns   [{ key, header, className, headerClassName, align, render }]
//             - render(row, index) → contenido de la celda (default: row[key]).
//   data      array de filas.
//   rowKey    (row, index) → key de React (default: index).
//   onRowClick(row) opcional — hace la fila clicable.
//   emptyMessage  texto cuando data está vacío.
//   minWidth  ancho mínimo de la tabla para el scroll horizontal (default 720px).
import { cn } from './cn'

const alignCls = { right: 'text-right', center: 'text-center', left: 'text-left' }

export default function Table({
  columns,
  data,
  rowKey = (_row, i) => i,
  onRowClick,
  emptyMessage = 'Sin datos',
  minWidth = 720,
  className = '',
}) {
  return (
    <div className={cn('bg-surface-card rounded-card shadow-card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="table w-full text-sm" style={{ minWidth }}>
          <thead className="bg-surface text-left text-xs text-muted uppercase">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn('px-4 py-2 font-medium', alignCls[c.align], c.headerClassName)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'hover:bg-slate-50/50 cursor-pointer' : 'hover:bg-slate-50/50'}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-2', alignCls[c.align], c.className)}>
                      {c.render ? c.render(row, i) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
