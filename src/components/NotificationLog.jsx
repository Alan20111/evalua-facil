// Bitácora de notificaciones — la caja con la tabla del historial, compartida
// por la pantalla de Notificaciones del DOCENTE y la del ESTUDIANTE. Estaba
// escrita completa dentro de la del docente; el alumno necesitaba exactamente
// la misma tabla (mismo orden, mismo resaltado de la más nueva, mismo borrado
// con confirmación), así que vive aquí y cada pantalla solo aporta cómo se
// leen sus propias categorías (`describeEntry`).
//
// Los datos salen de `notificationLog` filtrando por `uid`: las reglas de
// Firestore ya dejan que cada quien lea y borre SOLO los suyos, sea docente o
// estudiante (ver firestore.rules).
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDocsFromServer, doc, writeBatch, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import ConfirmModal from './ConfirmModal'
import { History, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { IS_NATIVE_APP } from '../utils/platform'
import { useBackHandler } from '../hooks/useBackHandler'
import { useScrollLock } from '../hooks/useScrollLock'
import { formatHora12FromDate } from '../utils/formatHora'

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// Un solo punto de verdad para "cuándo pasó esto" — usado tanto para ordenar
// la Bitácora como para las columnas Día/Fecha/Hora. `disparadoEn` es la hora
// exacta en que sonó el aviso local; `createdAt` puede quedar minutos atrás si
// el teléfono estaba en segundo plano y el registro se escribió hasta el
// siguiente resume de la app. Los push del servidor no traen `disparadoEn`:
// ahí `createdAt` ya es preciso (se escribe en el servidor en el momento).
function entryTimestamp(e) {
  return e.disparadoEn?.seconds ?? e.createdAt?.seconds ?? null
}
function entryDate(e) {
  const ts = entryTimestamp(e)
  return ts != null ? new Date(ts * 1000) : new Date()
}

function fmtDDMMAA(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aa = String(d.getFullYear()).slice(-2)
  return `${dd}/${mm}/${aa}`
}

/**
 * @param {string} uid              dueño de las notificaciones (docente o estudiante)
 * @param {(e, navigate) => {notificacion: node, detalles: node}} describeEntry
 *        cómo se leen las columnas "Notificación" y "Detalles" de ESA categoría
 * @param {string} [emptyLabel]     texto cuando todavía no hay nada registrado
 */
export default function NotificationLog({ uid, describeEntry, emptyLabel = 'Aún no tienes notificaciones registradas' }) {
  const navigate = useNavigate()
  const toast = useToast()

  // Se carga sola al entrar a la pantalla — no hace falta darle clic para
  // verla. `logOpen` solo deja colapsarla si estorba, no controla si se carga.
  const [logOpen, setLogOpen] = useState(true)
  const [logLoading, setLogLoading] = useState(true)
  const [logEntries, setLogEntries] = useState(null)
  // Renglón que se está por borrar (pide confirmación antes) — borrar fácil,
  // tanto en la app como en la web.
  const [entryToDelete, setEntryToDelete] = useState(null)
  const [deletingEntry, setDeletingEntry] = useState(false)
  useBackHandler(() => setEntryToDelete(null), !!entryToDelete)
  useScrollLock(!!entryToDelete)
  // Borrar TODA la bitácora de un golpe — confirmación aparte de la de un
  // solo renglón.
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  useBackHandler(() => setConfirmDeleteAll(false), confirmDeleteAll)
  useScrollLock(confirmDeleteAll)
  // Renglón tocado en la app (color distinto del verde de "más nueva", para
  // enfocar el que se acaba de tocar) — solo aplica en la app, con toque; en
  // la web el mismo color sale con hover (puro CSS, sin necesitar estado).
  const [tappedEntryId, setTappedEntryId] = useState(null)

  useEffect(() => {
    if (!uid) return
    setLogLoading(true)
    const q = query(collection(db, 'notificationLog'), where('uid', '==', uid))
    // getDocsFromServer, no getDocs: al tocar el globo de una notificación
    // recién llegada y entrar aquí, un getDocs() normal puede servir la caché
    // local con la escritura de esa MISMA notificación todavía pendiente de
    // confirmar (createdAt aparece null hasta que el servidor la reconoce) —
    // se veía como un renglón con fecha/hora en blanco que parecía "la
    // anterior" en vez de la que se acababa de recibir. Si de verdad no hay
    // red, cae a getDocs (tolera caché) para no dejar la pantalla sin nada.
    getDocsFromServer(q).catch(() => getDocs(q))
      .then((snap) => {
        // Más nueva arriba — no se puede pedir orderBy en la query (regla del
        // proyecto: solo igualdad en Firestore), así que se ordena en memoria.
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (entryTimestamp(b) ?? Date.now() / 1000) - (entryTimestamp(a) ?? Date.now() / 1000))
        setLogEntries(rows)
      })
      .catch(() => toast('No se pudo cargar la bitácora de notificaciones', 'error'))
      .finally(() => setLogLoading(false))
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmDeleteEntry() {
    if (!entryToDelete) return
    setDeletingEntry(true)
    try {
      await deleteDoc(doc(db, 'notificationLog', entryToDelete.id))
      setLogEntries((prev) => prev?.filter((e) => e.id !== entryToDelete.id) ?? prev)
      setEntryToDelete(null)
    } catch (err) {
      toast('No se pudo borrar: ' + err.message, 'error')
    } finally {
      setDeletingEntry(false)
    }
  }

  // Batched writes tienen un tope de 500 operaciones — se parte en tandas de
  // 450 (mismo margen que usa el resto de la app, ver CalendarPage.jsx).
  async function confirmDeleteAllEntries() {
    if (!logEntries?.length) return
    setDeletingAll(true)
    try {
      for (let i = 0; i < logEntries.length; i += 450) {
        const batch = writeBatch(db)
        logEntries.slice(i, i + 450).forEach((e) => batch.delete(doc(db, 'notificationLog', e.id)))
        await batch.commit()
      }
      setLogEntries([])
      setConfirmDeleteAll(false)
    } catch (err) {
      toast('No se pudo borrar la bitácora: ' + err.message, 'error')
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    <>
      <div className="rounded-card border border-outline-variant overflow-hidden bg-surface-card shadow-card">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left"
          >
            <History size={16} className="flex-shrink-0 text-accent" />
            <span className="flex-1 text-left truncate">Bitácora de notificaciones</span>
            {logOpen ? <ChevronUp size={16} className="text-muted flex-shrink-0" /> : <ChevronDown size={16} className="text-muted flex-shrink-0" />}
          </button>
          {/* "Borrar todo" con su nombre escrito, no solo el bote de basura:
              un ícono suelto en la esquina no se lee como "esto borra TODO
              el historial", y era justo lo que había que encontrar. */}
          {!!logEntries?.length && (
            <button
              type="button"
              onClick={() => setConfirmDeleteAll(true)}
              aria-label="Borrar todo el historial de notificaciones"
              data-tooltip="Borrar todo el historial"
              data-tooltip-pos="bottom"
              className="flex items-center gap-1 px-2 py-1.5 mr-2 text-xs font-semibold text-muted hover:text-error rounded transition-colors flex-shrink-0"
            >
              <Trash2 size={15} /> Borrar todo
            </button>
          )}
        </div>
        {logOpen && (
          <div className="border-t border-outline-variant">
            {logLoading ? (
              <div className="flex justify-center py-6"><Spinner size="sm" /></div>
            ) : !logEntries?.length ? (
              <p className="text-center text-muted text-sm py-6">{emptyLabel}</p>
            ) : (
              // Toda la bitácora vive en UNA caja con scroll, en formato tabla,
              // la notificación más nueva hasta arriba. El formato compacto
              // (Fecha apilada en una sola columna, texto más chico, sin scroll
              // horizontal) es SOLO para la app nativa — en la web se queda
              // Día semana/Fecha/Hora por separado.
              IS_NATIVE_APP ? (
              <div className="max-h-[28rem] overflow-y-auto">
                <table className="w-full table-fixed text-[10.2px] border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-1 py-1.5 font-semibold text-accent w-[24%]">Fecha</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-1.5 py-1.5 font-semibold text-accent text-left w-[38%]">Notificación</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-1.5 py-1.5 font-semibold text-accent text-left w-[28%]">Detalles</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light w-[10%]" aria-label="Borrar" />
                    </tr>
                  </thead>
                  <tbody>
                    {logEntries.map((e, i) => {
                      const d = entryDate(e)
                      const { notificacion, detalles } = describeEntry(e, navigate)
                      // logEntries ya viene ordenado con la más nueva primero — el
                      // renglón 0 es la última notificación recibida. Se resalta en
                      // verde para identificar de inmediato cuál acaba de sonar.
                      const esUltima = i === 0
                      const tocado = e.id === tappedEntryId
                      const filaClase = tocado ? 'bg-accent-light' : esUltima ? 'bg-green-100' : i % 2 === 0 ? 'bg-surface' : 'bg-surface-card'
                      return (
                        <tr key={e.id} onClick={() => setTappedEntryId(e.id)} className={`${filaClase} transition-colors`}>
                          <td className="border border-outline-variant px-1 py-1.5 text-center align-top text-on-surface break-words">
                            <div>{d ? DIAS_SEMANA[d.getDay()] : '—'}</div>
                            <div>{d ? fmtDDMMAA(d) : '—'}</div>
                            <div>{d ? formatHora12FromDate(d) : '—'}</div>
                          </td>
                          <td className="border border-outline-variant px-1.5 py-1.5 align-top text-on-surface break-words">{notificacion}</td>
                          <td className="border border-outline-variant px-1.5 py-1.5 align-top text-on-surface break-words">{detalles}</td>
                          <td className="border border-outline-variant text-center align-top">
                            <button type="button" onClick={() => setEntryToDelete(e)} aria-label="Borrar notificación"
                              className="p-1 text-muted hover:text-error rounded transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              ) : (
              <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2 font-semibold text-accent whitespace-nowrap">Día semana</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2 font-semibold text-accent whitespace-nowrap">Fecha</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2 font-semibold text-accent whitespace-nowrap">Hora</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2 font-semibold text-accent text-left">Notificación</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2 font-semibold text-accent text-left">Detalles</th>
                      <th className="sticky top-0 z-10 border border-outline-variant bg-accent-light px-2 py-2" aria-label="Borrar" />
                    </tr>
                  </thead>
                  <tbody>
                    {logEntries.map((e, i) => {
                      const d = entryDate(e)
                      const { notificacion, detalles } = describeEntry(e, navigate)
                      const esUltima = i === 0
                      return (
                        <tr key={e.id} className={`${esUltima ? 'bg-green-100' : i % 2 === 0 ? 'bg-surface' : 'bg-surface-card'} hover:bg-accent-light transition-colors`}>
                          <td className="border border-outline-variant px-2 py-1.5 text-center whitespace-nowrap text-on-surface">{d ? DIAS_SEMANA[d.getDay()] : '—'}</td>
                          <td className="border border-outline-variant px-2 py-1.5 text-center whitespace-nowrap text-on-surface">{d ? fmtDDMMAA(d) : '—'}</td>
                          <td className="border border-outline-variant px-2 py-1.5 text-center whitespace-nowrap text-on-surface">{d ? formatHora12FromDate(d) : '—'}</td>
                          <td className="border border-outline-variant px-2 py-1.5 text-on-surface">{notificacion}</td>
                          <td className="border border-outline-variant px-2 py-1.5 text-on-surface">{detalles}</td>
                          <td className="border border-outline-variant px-2 py-1.5 text-center">
                            <button type="button" onClick={() => setEntryToDelete(e)} aria-label="Borrar notificación" data-tooltip="Borrar"
                              className="p-1 text-muted hover:text-error rounded transition-colors">
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Borrar renglón de la Bitácora — pide confirmación primero ── */}
      {entryToDelete && (
        <ConfirmModal
          title="¿Borrar esta notificación?"
          message={<>&ldquo;<strong>{describeEntry(entryToDelete, navigate).notificacion}</strong>&rdquo; se borrará de tu bitácora permanentemente.</>}
          confirmLabel="Borrar"
          confirmingLabel="Borrando…"
          confirmIcon={<Trash2 size={16} />}
          danger
          busy={deletingEntry}
          showClose={false}
          onConfirm={confirmDeleteEntry}
          onCancel={() => setEntryToDelete(null)}
        />
      )}

      {/* ── Borrar TODA la Bitácora — confirmación aparte ── */}
      {confirmDeleteAll && (
        <ConfirmModal
          title="¿Borrar toda tu bitácora?"
          message={<>Se borrarán las <strong>{logEntries?.length ?? 0}</strong> notificaciones registradas, permanentemente.</>}
          confirmLabel="Borrar todo"
          confirmingLabel="Borrando…"
          confirmIcon={<Trash2 size={16} />}
          danger
          busy={deletingAll}
          showClose={false}
          onConfirm={confirmDeleteAllEntries}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}
    </>
  )
}
