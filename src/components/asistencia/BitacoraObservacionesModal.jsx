import { Pencil, Printer } from 'lucide-react'
import Modal from '../ui/Modal'

// Bitácora de observaciones de UN estudiante, en ventana superpuesta encima de
// Asistencias (sin navegar). Encabezado con estudiante, asignatura y docente
// para que se entienda como registro independiente, y una tabla de solo dos
// columnas: Fecha | Observación, de la más reciente a la más antigua.
//
// El lápiz de cada renglón permite editar (con teclado o con el dedo) sin buscar
// la celda en la tabla; no aparece en la impresión (ver imprimirBitacora).
//
// Props:
//   estudiante, asignatura, docente   textos del encabezado
//   filas     [{ id, fecha (etiqueta), texto }] ya ordenadas
//   onEditar  (id) => void
//   onImprimir () => void
//   mostrarImprimir  false en la app nativa: su WebView no abre el diálogo de
//                    impresión del sistema, así que ahí el botón no se muestra
//   onClose   () => void
//   z         z-index del Modal (en Tomar lista del teléfono va sobre su capa z-[70])
export default function BitacoraObservacionesModal({ estudiante, asignatura, docente, filas, onEditar, onImprimir, onClose, z = 50, mostrarImprimir = true }) {
  return (
    <Modal open onClose={onClose} variant="centered" size="3xl" z={z} title="Bitácora de observaciones">
      <dl className="text-sm space-y-0.5 mb-4">
        <div className="flex gap-2"><dt className="font-semibold text-on-surface w-24 flex-shrink-0">Estudiante:</dt><dd className="text-on-surface">{estudiante}</dd></div>
        <div className="flex gap-2"><dt className="font-semibold text-on-surface w-24 flex-shrink-0">Asignatura:</dt><dd className="text-on-surface">{asignatura}</dd></div>
        <div className="flex gap-2"><dt className="font-semibold text-on-surface w-24 flex-shrink-0">Docente:</dt><dd className="text-on-surface">{docente}</dd></div>
      </dl>

      {filas.length === 0 ? (
        <p className="text-sm text-muted text-center py-8 border border-dashed border-outline-variant rounded-card">
          Todavía no hay observaciones para este estudiante.
        </p>
      ) : (
        <div className="border border-outline-variant rounded-card overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-accent-light">
              <tr>
                <th scope="col" className="w-1/3 px-3 py-2 text-left text-xs font-bold text-muted uppercase tracking-wide">Fecha</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-bold text-muted uppercase tracking-wide">Observación</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-outline-variant align-top">
                  {/* En pantalla angosta (teléfono) la fecha puede partirse en dos renglones. */}
                  <td className="px-3 py-2 text-on-surface sm:whitespace-nowrap">{f.fecha}</td>
                  <td className="px-3 py-2 text-on-surface">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 min-w-0 whitespace-pre-wrap break-words">{f.texto}</p>
                      <button type="button" onClick={() => onEditar(f.id)}
                        aria-label={`Editar la observación del ${f.fecha}`}
                        data-tooltip="Editar observación" data-tooltip-pos="left"
                        className="flex-shrink-0 p-2 -m-2 rounded text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors">
                        <Pencil size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2 mt-4 justify-end">
        <button type="button" onClick={onClose}
          className="px-5 py-2.5 rounded border border-outline-variant text-muted text-base font-semibold hover:bg-[var(--accent-tint)] transition-colors">
          Cerrar
        </button>
        {mostrarImprimir && (
          <button type="button" onClick={onImprimir} disabled={filas.length === 0}
            className="px-5 py-2.5 rounded bg-accent text-white text-base font-semibold hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
            <Printer size={17} /> Imprimir
          </button>
        )}
      </div>
    </Modal>
  )
}
