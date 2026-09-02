// Modal de solución POST-ENTREGA — solo para el alumno.
//
// Solo se monta cuando el alumno YA AGOTÓ todos sus intentos (lo decide
// ActivityPage: estadoEvaluacion === 'finalizado' + sin intentos restantes).
// Nunca se muestra durante la resolución activa (en_progreso) ni mientras al
// alumno le quede una oportunidad.
//
// Crucigrama: es LA MISMA cuadrícula del juego, rellenada con todas las
//   letras correctas. No se reconstruye desde lo que escribió el alumno ni se
//   pinta correcto/incorrecto: es el crucigrama resuelto. Va con `readOnly`,
//   así que las casillas están deshabilitadas — no se puede escribir ni
//   generar intento.
//
//   A25 — Esas letras YA NO están en el navegador del alumno: se piden al
//   callable `obtenerSolucionJuego`, que comprueba EN EL SERVIDOR las dos
//   condiciones que antes decidía esta pantalla (intentos agotados y
//   "Publicar solución"). Antes el grid resuelto venía descargado desde el
//   primer render y estas dos condiciones solo vivían en el navegador, que es
//   como decir que no existían.
//
//   Fallback heredado: un crucigrama todavía sin migrar SÍ trae las letras en
//   su estructura pública. Ahí se arma en local como siempre, para que la
//   pantalla no dependa de haber migrado ya. Es transitorio: se retira con el
//   corte (ver § A25).
// Sopa de letras: muestra la cuadrícula completa con palabras encontradas
//   en azul (accent) y palabras no encontradas en verde esmeralda para que
//   el alumno vea dónde estaban ocultas.

import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase'
import { formatTiempo } from '../../utils/formatTiempo'
import { solucionCrucigrama } from '../../utils/correccionesJuego'
import { esEstructuraHeredada } from '../../utils/juegoClave'
import Modal from '../ui/Modal'
import Spinner from '../Spinner'
import CrucigramaBoard from './CrucigramaBoard'
import SopaDeLetrasBoard from './SopaDeLetrasBoard'

export default function SolucionJuegoModal({ open, onClose, actividadId, estructura, submission }) {
  // El crucigrama migrado no tiene las letras en el cliente: hay que pedirlas.
  // La sopa de letras no pasa por aquí — su cuadrícula con letras ES el juego y
  // siempre fue pública.
  //
  // Un solo objeto de estado, escrito ÚNICAMENTE dentro de las promesas: nada
  // de `setState` síncrono al entrar al efecto (dispara renders en cascada).
  // `esperando` se deduce de que todavía no ha llegado nada.
  const [solucion, setSolucion] = useState({ id: null, celdas: null, error: null })

  const esSopaJuego = estructura?.tipo === 'sopa_letras'
  const heredado = !!estructura && esEstructuraHeredada(estructura)
  const hayQuePedir = !!open && !!estructura && !esSopaJuego && !heredado && !!actividadId
  const llegada = solucion.id === actividadId ? solucion : null
  const esperando = hayQuePedir && !llegada

  useEffect(() => {
    if (!hayQuePedir) return undefined
    let vivo = true
    httpsCallable(functions, 'obtenerSolucionJuego')({ actividadId })
      .then(({ data }) => {
        if (vivo) setSolucion({ id: actividadId, celdas: data?.celdas || {}, error: null })
      })
      .catch((err) => {
        if (vivo) setSolucion({ id: actividadId, celdas: null, error: err.message || 'No se pudo obtener la solución' })
      })
    return () => { vivo = false }
  }, [hayQuePedir, actividadId])

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
      ) : esperando ? (
        <Spinner />
      ) : llegada?.error ? (
        <p className="text-sm text-error py-6 text-center">{llegada.error}</p>
      ) : (
        <CrucigramaBoard
          estructura={estructura}
          celdas={heredado ? solucionCrucigrama(estructura) : (llegada?.celdas || {})}
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
