// «Sugerencias a Evalúa Fácil» (24-oct-2026): lo que docentes y estudiantes
// envían desde «Sugerencia a Evalúa Fácil» (components/SugerenciaEF.jsx).
// Va aparte de los Reportes de IA: aquí no hay respuesta de la IA de por
// medio. Misma lista, filtros y estados que esa sección (PanelDeCasos).
//
// Moderación (PR 3): si el detector del servidor retuvo una sugerencia
// (posible insulto, grosería, amenaza o acoso) o no pudo revisarla, su texto
// queda oculto hasta pulsar «Mostrar mensaje» y el admin da su dictamen:
// «Es legítima» (se lee como cualquier otra) o «Confirmar ofensiva». Ninguno de
// los dos borra nada ni sanciona a nadie.
import { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { MessageSquarePlus, ShieldAlert } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import { Badge, Button } from '../../../components/ui'
import { etiquetaCategoriaSugerencia, sugerenciaRetenida, textoMotivosModeracion } from '../../../utils/catalogoReportes'
import { Dato, PanelDeCasos } from './ReportesIAPanel'

const TONO_CATEGORIA = { error_tecnico: 'danger', funcionamiento: 'warning', visualizacion: 'warning', dificultad: 'accent', mejora: 'success', otro: 'neutral' }
const ETIQUETA_ROL = { docente: 'Docente', alumno: 'Estudiante', admin: 'Administrador' }

function fecha(ts) {
  const d = ts?.toDate?.()
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function remitente(s) {
  const p = s.contexto?.reportante
  const rol = ETIQUETA_ROL[p?.rol || s.rol] || s.rol
  if (p?.nombre || p?.correo || p?.usuario) {
    return [p.nombre || 'Sin nombre registrado', rol, p.correo || (p.usuario && `usuario ${p.usuario}`)].filter(Boolean).join(' · ')
  }
  return `${rol || 'Rol desconocido'} · uid ${s.uid}`
}

function CasoSugerencia({ s }) {
  const toast = useToast()
  const [dictamen, setDictamen] = useState(s.revisionModeracion || null)
  const [mostrar, setMostrar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const retenida = sugerenciaRetenida(s)
  const oculta = retenida && dictamen !== 'legitima' && !mostrar

  async function dictaminar(valor) {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'sugerencias', s.id), { revisionModeracion: valor, revisionModeracionEn: serverTimestamp() })
      setDictamen(valor)
      setMostrar(false)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONO_CATEGORIA[s.categoria] || 'neutral'}>{etiquetaCategoriaSugerencia(s.categoria)}</Badge>
        {retenida && !dictamen && (
          <Badge tone="danger" icon={ShieldAlert}>Retenida: {textoMotivosModeracion(s.moderacion)}</Badge>
        )}
        {dictamen === 'legitima' && <Badge tone="success">Revisada: legítima</Badge>}
        {dictamen === 'ofensiva' && <Badge tone="danger">Revisada: ofensiva</Badge>}
        <span className="text-xs text-muted">{fecha(s.creadoEn)}</span>
      </div>
      {oculta ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">El mensaje está oculto porque la revisión automática lo retuvo.</p>
          <Button variant="quiet" size="sm" onClick={() => setMostrar(true)}>Mostrar mensaje</Button>
        </div>
      ) : (
        <p className="text-sm text-on-surface whitespace-pre-wrap break-words">{s.descripcion}</p>
      )}
      <Dato etiqueta="Módulo">{s.modulo}</Dato>
      <Dato etiqueta="Pantalla">{s.pantalla}</Dato>
      <Dato etiqueta="Ruta">{s.ruta}</Dato>
      <Dato etiqueta="Enviada por">{remitente(s)}</Dato>
      {retenida && !dictamen && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={guardando} onClick={() => dictaminar('legitima')}>Es legítima</Button>
          <Button variant="secondary" size="sm" disabled={guardando} onClick={() => dictaminar('ofensiva')}>Confirmar ofensiva</Button>
        </div>
      )}
    </>
  )
}

export default function SugerenciasPanel({ caso, onCambio }) {
  return (
    <PanelDeCasos
      coleccion="sugerencias"
      icono={MessageSquarePlus}
      caso={caso}
      onCambio={onCambio}
      descripcion="Errores, problemas de uso e ideas que docentes y estudiantes enviaron desde «Sugerencia a Evalúa Fácil». La pantalla se registra sola. Las que la revisión automática retuvo muestran su texto solo a petición."
      vacioNuevos="No hay sugerencias en este estado"
      vacioTodos="Todavía no hay sugerencias"
      renderCaso={(s) => <CasoSugerencia s={s} />}
    />
  )
}
