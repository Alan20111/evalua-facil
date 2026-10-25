// «Sugerencias a Evalúa Fácil» (24-oct-2026): lo que docentes y estudiantes
// envían desde «Sugerencia a Evalúa Fácil» (components/SugerenciaEF.jsx).
// Va aparte de los Reportes de IA: aquí no hay respuesta de la IA de por
// medio. Misma lista, filtros y estados que esa sección (PanelDeCasos).
import { MessageSquarePlus } from 'lucide-react'
import { Badge } from '../../../components/ui'
import { etiquetaCategoriaSugerencia } from '../../../utils/catalogoReportes'
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
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONO_CATEGORIA[s.categoria] || 'neutral'}>{etiquetaCategoriaSugerencia(s.categoria)}</Badge>
        <span className="text-xs text-muted">{fecha(s.creadoEn)}</span>
      </div>
      <p className="text-sm text-on-surface whitespace-pre-wrap break-words">{s.descripcion}</p>
      <Dato etiqueta="Módulo">{s.modulo}</Dato>
      <Dato etiqueta="Pantalla">{s.pantalla}</Dato>
      <Dato etiqueta="Ruta">{s.ruta}</Dato>
      <Dato etiqueta="Enviada por">{remitente(s)}</Dato>
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
      descripcion="Errores, problemas de uso e ideas que docentes y estudiantes enviaron desde «Sugerencia a Evalúa Fácil». La pantalla se registra sola."
      vacioNuevos="No hay sugerencias en este estado"
      vacioTodos="Todavía no hay sugerencias"
      renderCaso={(s) => <CasoSugerencia s={s} />}
    />
  )
}
