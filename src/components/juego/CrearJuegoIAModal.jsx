// Crucigrama / Sopa de letras — modal de creación con IA (22-ago-2026).
//
// Mismo patrón que CrearActividadIAModal (OP-05): la actividad nace oculta
// (borrador) con un cascarón vacío; la IA solo propone `juego.contenido`
// (generar_contenido_juego, tarifa fija — cubre la actividad interactiva
// completa, ver config/iaTarifas). La construcción de la
// cuadrícula (construirJuego) es un paso APARTE, gratis, que el docente
// dispara desde ContenidoJuegoEditor una vez que revisa/edita el contenido.
//
// `tipoJuego` llega fijo desde quien abre el modal ('crucigrama' | 'sopa_letras').

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import useCreditosIA from '../../hooks/useCreditosIA'
import { resolverFuentes } from '../../utils/fuentesIA'
import FuentesIAInput from '../ia/FuentesIAInput'
import useFuentesAsignatura from '../../hooks/useFuentesAsignatura'
import { EVALUACION_DEFAULTS } from '../../utils/evaluacionDefaults'
import Modal from '../ui/Modal'

const MIN_CANTIDAD = 5
const MAX_CANTIDAD = 20

export default function CrearJuegoIAModal({
  open, onClose, tipoJuego, asignaturaId, asignaturaNombre, parcial, docenteId,
  existingActivitiesCountInParcial = 0, onCreated,
}) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const [contexto, setContexto] = useState('')
  const [archivos, setArchivos] = useState([])
  const [modalidad, setModalidad] = useState('palabra')
  const [cantidad, setCantidad] = useState(10)
  const [trabajando, setTrabajando] = useState(false)
  const fuentesGuardadas = useFuentesAsignatura(asignaturaId, docenteId)

  if (!open) return null

  const tipoLabel = tipoJuego === 'sopa_letras' ? 'Sopa de letras' : 'Crucigrama'
  const costo = creditosIA.estimar('generar_contenido_juego') ?? 3

  async function handleGenerar() {
    setTrabajando(true)
    try {
      const urls = await resolverFuentes(archivos)

      const orden = existingActivitiesCountInParcial + 1
      const ref = await addDoc(collection(db, 'activities'), {
        nombre: '',
        categoria: 'juego',
        tipoJuego,
        instrucciones: '',
        oculta: true, // nace oculta: se publica hasta juego_confirmado (ver firestore.rules)
        publishAt: null,
        publishedAt: null,
        maxCalif: 10,
        notificarDocente: false,
        parcial, orden, asignaturaId, docenteId,
        juego: {
          modalidad,
          cantidadPalabras: cantidad,
          contenido: [],
          estado: null,
          estructura: null,
          origenDocumento: urls[0] ? { url: urls[0], nombre: archivos[0]?.name || archivos[0]?.nombre || '' } : null,
        },
        evaluacion: EVALUACION_DEFAULTS.juego,
        createdAt: serverTimestamp(),
      })

      await creditosIA.ejecutar('generar_contenido_juego', {
        actividadId: ref.id,
        asignaturaNombre: asignaturaNombre || '',
        modalidad,
        cantidadPalabras: cantidad,
        contexto,
        fuentes: urls,
      }, 1)

      toast(`${tipoLabel} generado con IA`)
      onCreated?.(ref.id)
    } catch (err) {
      toast(err.message || 'No se pudo generar el contenido', 'error')
      // El cascarón ya se creó (sin contenido) aunque la IA falle — se deja
      // como borrador oculto, el docente puede reintentar o llenarlo a mano
      // MÁS TARDE desde su lista de actividades. A propósito NO navegamos
      // aquí (`onCreated?.(ref.id)`): hacerlo aterrizaba al docente en
      // ContenidoJuegoEditor (0/20 palabras, "este paso no consume
      // créditos") con el toast de esta falla todavía visible encima —
      // parecía que "Confirmar contenido y construir juego" exigiera
      // créditos, cuando construirJuego nunca los toca. Nos quedamos en
      // el modal para que el error se lea en el contexto correcto (la
      // generación con IA, la única operación que sí cuesta créditos).
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} busy={trabajando} size="md"
      title={<span className="flex items-center gap-2"><Sparkles size={18} className="text-accent flex-shrink-0" />{tipoLabel} con IA</span>}>
      <div>
        <p className="text-sm text-muted mb-3">
          El asistente propone las palabras {modalidad === 'descripcion' ? 'y sus pistas ' : ''}
          del tema que describas. Podrás editarlas antes de armar {tipoJuego === 'sopa_letras' ? 'la sopa de letras' : 'el crucigrama'}.
        </p>

        <div className="space-y-2.5">
          <div>
            <label htmlFor="ia-juego-contexto" className="block text-sm text-on-surface mb-1">Tema / contexto</label>
            <textarea id="ia-juego-contexto" value={contexto} disabled={trabajando} rows={3}
              onChange={(e) => setContexto(e.target.value)}
              placeholder="Describe el tema del que quieres las palabras (opcional si adjuntas un documento)."
              className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="ia-juego-modalidad" className="block text-sm text-on-surface mb-1">Modalidad</label>
              <select id="ia-juego-modalidad" value={modalidad} disabled={trabajando}
                onChange={(e) => setModalidad(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <option value="palabra">Solo palabra</option>
                <option value="descripcion">Palabra + pista</option>
              </select>
            </div>
            <div className="w-28">
              <label htmlFor="ia-juego-cantidad" className="block text-sm text-on-surface mb-1">Palabras</label>
              <input id="ia-juego-cantidad" type="number" min={MIN_CANTIDAD} max={MAX_CANTIDAD} value={cantidad}
                disabled={trabajando}
                onChange={(e) => setCantidad(Math.min(MAX_CANTIDAD, Math.max(MIN_CANTIDAD, Number(e.target.value) || MIN_CANTIDAD)))}
                className="w-full px-2.5 py-1.5 text-sm border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            </div>
          </div>

          <FuentesIAInput files={archivos} onChange={setArchivos} disabled={trabajando} fuentesGuardadas={fuentesGuardadas} />
        </div>

        <p className="text-sm text-on-surface mt-3 mb-1">
          Esta acción utilizará <span className="font-semibold">{costo}</span> {costo === 1 ? 'crédito' : 'créditos'} de IA.
        </p>
        <p className="text-sm text-muted mb-4">
          Tienes <span className="font-semibold tabular-nums">{creditosIA.saldo}</span> créditos disponibles.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { if (!trabajando) onClose?.() }} disabled={trabajando}
            className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleGenerar} disabled={trabajando}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
            {trabajando ? 'Generando…' : 'Generar con IA'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
