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

import { normalizarPalabra } from '../../utils/normalizarPalabra'
import Modal from '../ui/Modal'
import CrucigramaBoard from './CrucigramaBoard'
import SopaDeLetrasBoard from './SopaDeLetrasBoard'

// Espejo de calificarCrucigrama (functions/index.js) — aquí solo para pintar
// verde/rojo cada celda, nunca para escribir una calificación.
function correccionesCrucigrama(estructura, celdasAlumno) {
  const mapa = {}
  for (let r = 0; r < estructura.size; r++) {
    for (let c = 0; c < estructura.size; c++) {
      const letraCorrecta = estructura.grid?.[r]?.row?.[c]
      if (!letraCorrecta) continue
      const respuesta = normalizarPalabra(celdasAlumno[`${r}-${c}`] || '')
      mapa[`${r}-${c}`] = !!respuesta && respuesta === letraCorrecta
    }
  }
  return mapa
}

export default function ResolucionJuegoModal({ open, onClose, estudianteNombre, estructura, submission }) {
  const respuestas = submission?.respuestasJuego || {}
  const calificacion = submission?.calificacion

  return (
    <Modal open={open} onClose={onClose} title={`Resolución de ${estudianteNombre}`} variant="centered" size="lg">
      <p className="text-sm font-semibold text-on-surface mb-3">
        Calificación obtenida: <span className="text-accent">{calificacion != null ? calificacion : '—'}</span>
      </p>

      {estructura.tipo === 'sopa_letras' ? (
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

      <div className="flex justify-end mt-4">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
          Cerrar
        </button>
      </div>
    </Modal>
  )
}
