// Modal de solución POST-ENTREGA — solo para el alumno.
//
// Solo se monta cuando el alumno YA AGOTÓ todos sus intentos (lo decide
// ActivityPage: estadoEvaluacion === 'finalizado' + sin intentos restantes).
// Nunca se muestra durante la resolución activa (en_progreso) ni mientras al
// alumno le quede una oportunidad.
//
// Crucigrama: es LA MISMA cuadrícula del juego, rellenada con todas las
//   letras correctas (solucionCrucigrama, leída de `estructura.grid` — la
//   misma fuente de verdad que usa el servidor para calificar). No se
//   reconstruye desde lo que escribió el alumno ni se pinta correcto/
//   incorrecto: es el crucigrama resuelto. Va con `readOnly`, así que las
//   casillas están deshabilitadas — no se puede escribir ni generar intento.
// Sopa de letras: muestra la cuadrícula completa con palabras encontradas
//   en azul (accent) y palabras no encontradas en verde esmeralda para que
//   el alumno vea dónde estaban ocultas.

import { formatTiempo } from '../../utils/formatTiempo'
import { solucionCrucigrama } from '../../utils/correccionesJuego'
import Modal from '../ui/Modal'
import CrucigramaBoard from './CrucigramaBoard'
import SopaDeLetrasBoard from './SopaDeLetrasBoard'

export default function SolucionJuegoModal({ open, onClose, estructura, submission }) {
  if (!open || !estructura || !submission) return null

  const respuestas = submission.respuestasJuego || {}
  const calificacion = submission.calificacion
  const tiempoSegundos = submission.tiempoSegundos
  const intentos = Array.isArray(submission.intentos) ? submission.intentos : []
  const ultimoIntento = intentos[intentos.length - 1] || null
  const esSopa = estructura.tipo === 'sopa_letras'

  return (
    <Modal open={open} onClose={onClose} title="Solución" variant="centered" size="lg">
      {/* ─── Resumen del intento ─────────────────────────────────────────── */}
      <div className="mb-4 pb-4 border-b border-outline-variant flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {calificacion != null && (
          <span className="font-semibold text-on-surface">
            Calificación: <span className="text-accent">{calificacion}</span>
          </span>
        )}
        {tiempoSegundos != null && (
          <span className="text-muted tabular-nums">
            ⏱ {formatTiempo(tiempoSegundos)}
          </span>
        )}
        {ultimoIntento && intentos.length > 1 && (
          <span className="text-muted text-xs self-end">
            Intento #{ultimoIntento.numero} de {intentos.length}
          </span>
        )}
      </div>

      {/* ─── Tablero resuelto ────────────────────────────────────────────── */}
      {esSopa ? (
        <SopaDeLetrasBoard
          estructura={estructura}
          encontradas={Array.isArray(respuestas.encontradas) ? respuestas.encontradas : []}
          mostrarSolucion
          readOnly
        />
      ) : (
        <CrucigramaBoard
          estructura={estructura}
          celdas={solucionCrucigrama(estructura)}
          readOnly
          modoDocente
        />
      )}

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
