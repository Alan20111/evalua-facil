import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../../components/Spinner'
import { ArrowLeft } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'

// Pantalla mínima a propósito (pedida así): solo un botón para regresar y la
// lista de avisos que de verdad se mandaron — fecha, hora y descripción. Sin
// filtros, sin acciones, sin nada más. Se alimenta de `notificationLog`
// (functions/index.js, enviarPushDirecto) — un registro por cada push que
// realmente se envió al docente, sin importar la categoría.
//
// Solo cubre las notificaciones que pasan por el servidor (nuevas entregas,
// estudiante activado): los recordatorios de clase/evento son locales,
// programados por el propio teléfono sin que la app se entere de si de
// verdad se mostraron, así que no hay forma confiable de registrarlos aquí.
function fmtFechaHora(ts) {
  const d = ts?.toDate ? ts.toDate() : null
  if (!d) return { fecha: '—', hora: '' }
  const fecha = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
  return { fecha, hora }
}

export default function NotificationLog() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [entradas, setEntradas] = useState([])

  const goBack = () => navigate('/notificaciones')
  useBackHandler(goBack)

  // Firestore aquí solo admite igualdad simple y no permite orderBy en la
  // query (ver CLAUDE.md) — se trae todo lo del docente y se ordena en
  // memoria, más reciente primero.
  useEffect(() => {
    if (!currentUser) return
    getDocs(query(collection(db, 'notificationLog'), where('uid', '==', currentUser.uid)))
      .then((snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        setEntradas(rows)
      })
      .finally(() => setLoading(false))
  }, [currentUser])

  return (
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      <header className="sticky top-0 z-10 bg-accent text-white shadow-lg safe-top">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={goBack} aria-label="Regresar" className="p-2 -ml-2 rounded hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-lg font-bold truncate">Registro de notificaciones</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : entradas.length === 0 ? (
          <p className="text-center text-muted text-sm py-16">Aún no tienes notificaciones registradas</p>
        ) : (
          <ul className="space-y-2">
            {entradas.map((e) => {
              const { fecha, hora } = fmtFechaHora(e.createdAt)
              return (
                <li key={e.id} className="p-3 rounded-card border border-outline-variant bg-surface-card">
                  <p className="text-xs text-muted">{fecha} · {hora}</p>
                  <p className="text-sm text-on-surface mt-0.5">{e.descripcion || e.titulo || 'Notificación'}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
