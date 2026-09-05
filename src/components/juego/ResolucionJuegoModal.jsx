// Crucigrama / Sopa de letras — resolución de UN estudiante, para el docente
// (26-ago-2026). Estrictamente de SOLO LECTURA: reutiliza CrucigramaBoard/
// SopaDeLetrasBoard con readOnly, muestra los datos YA guardados en
// submissions/{id}.respuestasJuego contra activities/{id}.juego.estructura
// (la misma fuente de verdad que usa el servidor para calificar), y nunca
// escribe nada — la calificación que se muestra es la que ya dejó guardada
// onJuegoFinalizado (functions/index.js), jamás se recalcula aquí.
//
// El cálculo de "qué celda quedó correcta" (crucigrama) es un espejo mínimo
// de calificarCrucigrama (functions/index.js) — mismo criterio
// (normalizarPalabra, comparación celda por celda) pero SOLO para pintar la
// cuadrícula; no produce ningún valor que se guarde en ningún lado.

import { formatTiempo } from '../../utils/formatTiempo'
import { correccionesCrucigrama } from '../../utils/correccionesJuego'
import Modal from '../ui/Modal'
import CrucigramaBoard from './CrucigramaBoard'
import SopaDeLetrasBoard from './SopaDeLetrasBoard'

export default function ResolucionJuegoModal({ open, onClose, estudianteNombre, estructura, submission, navCount = 0, onAnterior, onSiguiente }) {
  const respuestas = submission?.respuestasJuego || {}
  const calificacion = submission?.calificacion
  const intentos = Array.isArray(submission?.intentos) ? submission.intentos : []
  const sinRealizacion = submission?.sinEntrega === true && !submission?.respuestasJuego

  return (
    <Modal open={open} onClose={onClose} title={`Resolución de ${estudianteNombre}`} variant="centered" size="lg">
      {intentos.length > 1 ? (
        <table className="w-full text-sm mb-3 border-collapse">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-outline-variant">
              <th className="pb-1 pr-4 font-medium">Intento</th>
              <th className="pb-1 pr-4 font-medium text-right">Calificación</th>
              <th className="pb-1 font-medium text-right">Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {intentos.map((it) => (
              <tr key={it.numero} className="border-b border-outline-variant">
                <td className="py-1 pr-4 text-on-surface">{it.numero}</td>
                <td className="py-1 pr-4 text-right font-semibold text-accent tabular-nums">{it.calificacion}</td>
                <td className="py-1 text-right text-muted tabular-nums">{formatTiempo(it.tiempoSegundos) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm font-semibold text-on-surface mb-3">
          Calificación obtenida: <span className="text-accent">{calificacion != null ? calificacion : '—'}</span>
          {submission?.tiempoSegundos != null && (
            <span className="ml-3 text-xs font-normal text-muted tabular-nums">
              ⏱ {formatTiempo(submission.tiempoSegundos)}
            </span>
          )}
        </p>
      )}
      {intentos.length > 1 && (
        <p className="text-sm font-semibold text-on-surface mb-3">
          Calificación conservada: <span className="text-accent">{calificacion != null ? calificacion : '—'}</span>
        </p>
      )}

      {sinRealizacion ? (
        <p className="text-sm text-muted text-center py-4">
          Sin realización — la calificación fue asignada manualmente por el docente.
        </p>
      ) : estructura.tipo === 'sopa_letras' ? (
        <SopaDeLetrasBoard
          estructura={estructura}
          encontradas={Array.isArray(respuestas.encontradas) ? respuestas.encontradas : []}
          readOnly
        />
      ) : (
        <CrucigramaBoard
          estructura={estructura}
          celdas={respuestas.celdas || {}}
          estadoCorrecto={correccionesCrucigrama(estructura, respuestas.celdas || {})}
          readOnly
        />
      )}

      <div className="flex items-center justify-between mt-4">
        {navCount > 1 ? (
          <div className="flex gap-2">
            <button type="button" onClick={onAnterior}
              className="px-3 py-2 text-sm font-medium text-muted border border-outline-variant hover:bg-surface-container rounded transition-colors">
              ← Anterior
            </button>
            <button type="button" onClick={onSiguiente}
              className="px-3 py-2 text-sm font-medium text-muted border border-outline-variant hover:bg-surface-container rounded transition-colors">
              Siguiente →
            </button>
          </div>
        ) : <div />}
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
