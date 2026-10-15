// Errores de la app (docs/PLAN_GOOGLE_PLAY.md, O3).
//
// Lo que truena en la web o en la app de Android llega aquí agrupado
// (api/error-report.js): un renglón por error distinto, con cuántas veces
// pasó, dónde, en qué versión y en qué plataforma. «Resuelto» lo borra; si el
// error vuelve a pasar, reaparece con el contador desde 1.
import { useEffect, useState } from 'react'
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore'
import { Bug } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import { Badge, Button, Disclosure, EmptyState, SkeletonTable } from '../../../components/ui'

const TIPO = { render: 'Pantalla', error: 'Evento', promesa: 'Promesa' }

function fecha(ts) {
  const d = ts?.toDate?.()
  return d ? d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export default function ErroresPanel() {
  const toast = useToast()
  const [errores, setErrores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [borrando, setBorrando] = useState(null)

  useEffect(() => {
    getDocs(collection(db, 'erroresCliente'))
      .then((snap) => {
        // Sin orderBy en la consulta (CLAUDE.md): se ordena en memoria.
        setErrores(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.ultimo?.toMillis?.() || 0) - (a.ultimo?.toMillis?.() || 0)))
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setCargando(false))
  }, [toast])

  async function resolver(id) {
    setBorrando(id)
    try {
      await deleteDoc(doc(db, 'erroresCliente', id))
      setErrores((lista) => lista.filter((e) => e.id !== id))
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBorrando(null)
    }
  }

  if (cargando) return <SkeletonTable rows={6} cols={3} className="py-6" />

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Errores que tuvieron docentes y alumnos en la web o en la app. Cada renglón es un error distinto con cuántas veces pasó; márcalo como resuelto cuando se corrija.
      </p>
      {errores.length === 0 ? (
        <EmptyState icon={Bug} title="No hay errores registrados" />
      ) : (
        <ul className="space-y-2">
          {errores.map((e) => (
            <li key={e.id} className="p-4 rounded-card border border-outline-variant bg-surface-card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.cuenta >= 10 ? 'danger' : 'warning'}>{e.cuenta} {e.cuenta === 1 ? 'vez' : 'veces'}</Badge>
                <Badge>{TIPO[e.tipo] || e.tipo}</Badge>
                <span className="text-xs text-muted">
                  {e.ruta || '—'} · {e.plataforma} · {e.navegador} · {e.rol} · v{e.version} · último {fecha(e.ultimo)}
                </span>
              </div>
              <p className="text-sm font-medium text-on-surface break-words">{e.mensaje}</p>
              <Disclosure summary="Ver la pila" buttonClassName="text-sm">
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-on-surface bg-surface rounded-card p-3">
                  {e.pila || '(sin pila)'}
                </pre>
                <p className="mt-1 text-xs text-hint">Primera vez: {fecha(e.primero)}</p>
              </Disclosure>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" busy={borrando === e.id} onClick={() => resolver(e.id)}>
                  Resuelto
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
