// Reportes de respuestas de la IA (docs/PLAN_GOOGLE_PLAY.md, B2).
//
// Lo que docentes y alumnos reportan con «Reportar» (components/ReportarIA)
// llega aquí. Google Play pide que el reporte exista y que alguien lo
// atienda: un reporte de contenido inapropiado se revisa y, si hace falta,
// se ajusta el prompt de esa operación en functions/ia.js.
import { useEffect, useState } from 'react'
import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Flag } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import { Badge, Button, Disclosure, EmptyState, SkeletonTable, SubTabs } from '../../../components/ui'
import { MOTIVOS_REPORTE_IA } from '../../../utils/reportesIA'

const FILTROS = [
  { value: 'nuevo', label: 'Nuevos' },
  { value: 'todos', label: 'Todos' },
]
const ETIQUETA_MOTIVO = Object.fromEntries(MOTIVOS_REPORTE_IA.map((m) => [m.value, m.label]))
const TONO_MOTIVO = { inapropiado: 'danger', incorrecto: 'warning', otro: 'neutral' }
const ETIQUETA_ESTADO = { nuevo: 'Nuevo', revisado: 'Revisado', descartado: 'Descartado' }

function fecha(ts) {
  const d = ts?.toDate?.()
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export default function ReportesIAPanel() {
  const toast = useToast()
  const [reportes, setReportes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('nuevo')
  const [guardando, setGuardando] = useState(null)

  useEffect(() => {
    getDocs(collection(db, 'reportesIA'))
      .then((snap) => {
        // Sin orderBy en la consulta (CLAUDE.md): se ordena en memoria.
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0))
        setReportes(lista)
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setCargando(false))
  }, [toast])

  async function marcar(id, estado) {
    setGuardando(id)
    try {
      await updateDoc(doc(db, 'reportesIA', id), { estado, revisadoEn: serverTimestamp() })
      setReportes((lista) => lista.map((r) => (r.id === id ? { ...r, estado } : r)))
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setGuardando(null)
    }
  }

  if (cargando) return <SkeletonTable rows={6} cols={3} className="py-6" />

  const visibles = filtro === 'nuevo' ? reportes.filter((r) => r.estado === 'nuevo') : reportes

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Respuestas de la IA que docentes y alumnos reportaron. Revisa cada una; si el problema viene de cómo se le pide a la IA, ajusta el prompt de esa operación.
      </p>
      <SubTabs options={FILTROS} value={filtro} onChange={setFiltro} label="Filtrar reportes" />
      {visibles.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={filtro === 'nuevo' ? 'No hay reportes nuevos' : 'Todavía no hay reportes'}
        />
      ) : (
        <ul className="space-y-2">
          {visibles.map((r) => (
            <li key={r.id} className="p-4 rounded-card border border-outline-variant bg-surface-card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONO_MOTIVO[r.motivo] || 'neutral'}>{ETIQUETA_MOTIVO[r.motivo] || r.motivo}</Badge>
                <Badge>{ETIQUETA_ESTADO[r.estado] || r.estado}</Badge>
                <span className="text-xs text-muted">
                  {r.operacion} · {r.rol} · {fecha(r.creadoEn)}
                </span>
              </div>
              {r.comentario && <p className="text-sm text-on-surface">«{r.comentario}»</p>}
              <Disclosure summary="Ver la respuesta reportada" buttonClassName="text-sm">
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-on-surface bg-surface rounded-card p-3">
                  {r.texto || '(sin texto)'}
                </pre>
                <p className="mt-1 text-xs text-hint">
                  Usuario: {r.uid}{r.contextoId ? ` · Contexto: ${r.contextoId}` : ''}
                </p>
              </Disclosure>
              {r.estado === 'nuevo' && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="quiet" size="sm" disabled={guardando === r.id} onClick={() => marcar(r.id, 'descartado')}>
                    Descartar
                  </Button>
                  <Button variant="secondary" size="sm" busy={guardando === r.id} onClick={() => marcar(r.id, 'revisado')}>
                    Marcar revisado
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
