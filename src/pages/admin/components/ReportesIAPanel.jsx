// Reportes de respuestas de la IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// Lo que docentes y alumnos reportan con «Reportar» (components/ReportarIA)
// llega aquí. Google Play pide que el reporte exista y que alguien lo
// atienda: un reporte de contenido inapropiado se revisa y, si hace falta,
// se ajusta el prompt de esa operación en functions/ia.js.
//
// Desde el 24-oct-2026 cada reporte dice, cuando se sabe: la operación con su
// nombre legible, el módulo y la pantalla, la ruta, y la asignatura,
// actividad y alumno de la entrega (los resuelve el servidor en
// functions/avisosReportes.js, que también avisa por correo). Los reportes
// anteriores no traen esos datos y se muestran como antes.
//
// `PanelDeCasos` es la lista que comparten esta sección y «Sugerencias a
// Evalúa Fácil» (SugerenciasPanel.jsx): filtros, estados y el caso que abre
// el enlace del correo (`/Admin?tab=…&caso=<id>`).
import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Flag } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import { Badge, Button, Disclosure, EmptyState, SkeletonTable, SubTabs } from '../../../components/ui'
import {
  describirUbicacionIA, etiquetaEstadoReporte, etiquetaMotivoIA, nombreOperacionIA,
} from '../../../utils/catalogoReportes'

const FILTROS = [
  { value: 'nuevo', label: 'Nuevos' },
  { value: 'revisado', label: 'Revisados' },
  { value: 'todos', label: 'Todos' },
]
const TONO_MOTIVO = { inapropiado: 'danger', incorrecto: 'warning', otro: 'neutral' }
const TONO_ESTADO = { nuevo: 'accent', revisado: 'neutral', resuelto: 'success', descartado: 'neutral' }

// revisado = alguien lo leyó · resuelto = se corrigió o se atendió.
const ACCIONES = {
  nuevo: [
    { estado: 'descartado', etiqueta: 'Descartar', variante: 'quiet' },
    { estado: 'revisado', etiqueta: 'Marcar revisado', variante: 'secondary' },
    { estado: 'resuelto', etiqueta: 'Marcar resuelto', variante: 'secondary' },
  ],
  revisado: [
    { estado: 'descartado', etiqueta: 'Descartar', variante: 'quiet' },
    { estado: 'resuelto', etiqueta: 'Marcar resuelto', variante: 'secondary' },
  ],
}

function fecha(ts) {
  const d = ts?.toDate?.()
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

const ETIQUETA_ROL = { docente: 'Docente', alumno: 'Estudiante', admin: 'Administrador' }

// Quién lo envió: lo que resolvió el servidor; en los registros de antes,
// solo el rol y el uid.
function remitente(r) {
  const p = r.contexto?.reportante
  if (p?.nombre || p?.correo || p?.usuario) {
    return [p.nombre || 'Sin nombre registrado', ETIQUETA_ROL[p.rol || r.rol] || r.rol, p.correo || (p.usuario && `usuario ${p.usuario}`)]
      .filter(Boolean).join(' · ')
  }
  return `${ETIQUETA_ROL[r.rol] || r.rol || 'Rol desconocido'} · uid ${r.uid}`
}

const TEXTO_AVISO = {
  enviado: 'enviado',
  enviando: 'enviándose',
  fallido: 'falló; se reintenta solo',
  agotado: 'no se pudo enviar después de varios intentos',
  omitido: 'no se envió',
}
const MOTIVO_OMITIDO = {
  duplicado: 'era igual a otro de la misma persona',
  limite_por_persona: 'la misma persona envió demasiados en una hora',
  tope_diario: 'se llegó al tope de correos del día',
}

// Sin `notificacion` no se dice nada: los registros de antes de los avisos
// nunca se mandaron por correo, y uno recién creado aún no lo atiende el servidor.
function textoAviso(n) {
  if (!n?.estado) return ''
  let t = `Aviso por correo: ${TEXTO_AVISO[n.estado] || n.estado}`
  if (n.estado === 'omitido' && n.motivo) t += ` (${MOTIVO_OMITIDO[n.motivo] || n.motivo})`
  if ((n.estado === 'fallido' || n.estado === 'agotado') && n.ultimoError) t += ` · ${n.ultimoError}`
  return t
}

// Fila «Etiqueta: valor» del detalle. Sin valor no se pinta.
export function Dato({ etiqueta, children }) {
  if (!children) return null
  return (
    <p className="text-sm">
      <span className="text-muted">{etiqueta}: </span>
      <span className="text-on-surface">{children}</span>
    </p>
  )
}

export function PanelDeCasos({ coleccion, descripcion, icono, vacioNuevos, vacioTodos, caso, onCambio, renderCaso }) {
  const toast = useToast()
  const [registros, setRegistros] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('nuevo')
  const [guardando, setGuardando] = useState(null)
  const casoRef = useRef(null)

  useEffect(() => {
    getDocs(collection(db, coleccion))
      .then((snap) => {
        // Sin orderBy en la consulta (CLAUDE.md): se ordena en memoria.
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0))
        setRegistros(lista)
        if (caso) {
          const hallado = lista.find((r) => r.id === caso)
          if (!hallado) toast('No se encontró el caso del enlace; puede que se haya borrado.', 'error')
          else if (hallado.estado !== 'nuevo') setFiltro('todos')
        }
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setCargando(false))
  }, [coleccion, caso, toast])

  useEffect(() => {
    if (!cargando && casoRef.current) casoRef.current.scrollIntoView({ block: 'center' })
  }, [cargando, filtro])

  async function marcar(id, estado) {
    setGuardando(id)
    try {
      const sello = estado === 'resuelto' ? { resueltoEn: serverTimestamp() } : { revisadoEn: serverTimestamp() }
      await updateDoc(doc(db, coleccion, id), { estado, ...sello })
      setRegistros((lista) => lista.map((r) => (r.id === id ? { ...r, estado } : r)))
      onCambio?.()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setGuardando(null)
    }
  }

  if (cargando) return <SkeletonTable rows={6} cols={3} className="py-6" />

  const visibles = filtro === 'todos' ? registros : registros.filter((r) => r.estado === filtro)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{descripcion}</p>
      <SubTabs options={FILTROS} value={filtro} onChange={setFiltro} label="Filtrar por estado" />
      {visibles.length === 0 ? (
        <EmptyState icon={icono} title={filtro === 'todos' ? vacioTodos : vacioNuevos} />
      ) : (
        <ul className="space-y-2">
          {visibles.map((r) => {
            const esCaso = r.id === caso
            return (
              <li
                key={r.id}
                ref={esCaso ? casoRef : undefined}
                className={`p-4 rounded-card border bg-surface-card space-y-2 ${esCaso ? 'border-accent ring-2 ring-accent' : 'border-outline-variant'}`}
              >
                {renderCaso(r)}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONO_ESTADO[r.estado] || 'neutral'}>{etiquetaEstadoReporte(r.estado)}</Badge>
                  {textoAviso(r.notificacion) && <span className="text-xs text-muted">{textoAviso(r.notificacion)}</span>}
                </div>
                {ACCIONES[r.estado] && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {ACCIONES[r.estado].map((a) => (
                      <Button
                        key={a.estado}
                        variant={a.variante}
                        size="sm"
                        disabled={guardando === r.id}
                        onClick={() => marcar(r.id, a.estado)}
                      >
                        {a.etiqueta}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CasoReporteIA({ r }) {
  const ubicacion = describirUbicacionIA(r.ubicacion)
  const c = r.contexto || {}
  const asignatura = c.asignatura ? [c.asignatura.nombre, c.asignatura.grupo && `Grupo ${c.asignatura.grupo}`].filter(Boolean).join(' · ') : ''
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONO_MOTIVO[r.motivo] || 'neutral'}>{etiquetaMotivoIA(r.motivo)}</Badge>
        <span className="text-sm font-semibold text-on-surface">{nombreOperacionIA(r.operacion)}</span>
        <span className="text-xs text-muted">{fecha(r.creadoEn)}</span>
      </div>
      <Dato etiqueta="Módulo">{ubicacion?.modulo}</Dato>
      <Dato etiqueta="Pantalla">{ubicacion?.pantalla}</Dato>
      <Dato etiqueta="Ruta">{r.ruta}</Dato>
      <Dato etiqueta="Asignatura">{asignatura}</Dato>
      <Dato etiqueta="Actividad">{c.actividad?.nombre}</Dato>
      <Dato etiqueta="Entrega de">{c.entrega?.alumno}</Dato>
      <Dato etiqueta="Enviado por">{remitente(r)}</Dato>
      {r.comentario && <p className="text-sm text-on-surface">«{r.comentario}»</p>}
      {c.aviso && <p className="text-xs text-hint">{c.aviso}</p>}
      <Disclosure summary="Ver la respuesta reportada" buttonClassName="text-sm">
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-on-surface bg-surface rounded-card p-3">
          {r.texto || '(sin texto)'}
        </pre>
        <p className="mt-1 text-xs text-hint">
          Operación: {r.operacion} · Usuario: {r.uid}
          {r.contextoId ? ` · Contexto: ${r.contextoId}` : ''}
          {r.asignaturaId ? ` · Asignatura: ${r.asignaturaId}` : ''}
          {r.actividadId ? ` · Actividad: ${r.actividadId}` : ''}
          {r.entregaId ? ` · Entrega: ${r.entregaId}` : ''}
        </p>
      </Disclosure>
    </>
  )
}

export default function ReportesIAPanel({ caso, onCambio }) {
  return (
    <PanelDeCasos
      coleccion="reportesIA"
      icono={Flag}
      caso={caso}
      onCambio={onCambio}
      descripcion="Respuestas de la IA que docentes y alumnos reportaron. Revisa cada una; si el problema viene de cómo se le pide a la IA, ajusta el prompt de esa operación."
      vacioNuevos="No hay reportes en este estado"
      vacioTodos="Todavía no hay reportes"
      renderCaso={(r) => <CasoReporteIA r={r} />}
    />
  )
}
