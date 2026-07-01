import { useState } from 'react'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { Plus, Pencil, Ban, Trash2, X } from 'lucide-react'
import EFDateTimePicker from '../../../components/EFDateTimePicker'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import {
  calcDaysRemaining,
  formatDate,
  getSubscriptionStatusColor,
  SUBSCRIPTION_STATUSES,
} from '../../../utils/subscriptionHelpers'

const inputCls =
  'w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface'

function StatusBadge({ status }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getSubscriptionStatusColor(status)}`}
    >
      {status?.replace('_', ' ')}
    </span>
  )
}

export default function SubscriptionsTable({ stats, onRefresh }) {
  const toast = useToast()
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)

  if (!stats) return null

  const { subscriptions, teachers, plans, schoolsMap } = stats
  const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))
  const plansMap = Object.fromEntries(plans.map((p) => [p.id, p]))

  const rows = [...subscriptions].sort((a, b) => {
    const ta = a.updatedAt?.toMillis?.() || 0
    const tb = b.updatedAt?.toMillis?.() || 0
    return tb - ta
  })

  function openCreate() {
    setModal({
      mode: 'create',
      form: {
        docenteId: teachers[0]?.id || '',
        planId: plans[0]?.id || '',
        status: 'activa',
        fechaInicio: new Date().toISOString().slice(0, 10),
        fechaVencimiento: '',
      },
    })
  }

  function openEdit(sub) {
    const fi = sub.fechaInicio?.toDate?.()
    const fv = sub.fechaVencimiento?.toDate?.()
    setModal({
      mode: 'edit',
      id: sub.id,
      form: {
        docenteId: sub.docenteId,
        planId: sub.planId || '',
        status: sub.status,
        fechaInicio: fi ? fi.toISOString().slice(0, 10) : '',
        fechaVencimiento: fv ? fv.toISOString().slice(0, 10) : '',
      },
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const teacher = teachersMap[modal.form.docenteId]
      const school = schoolsMap[teacher?.escuelaId]
      const data = {
        docenteId: modal.form.docenteId,
        planId: modal.form.planId,
        escuelaId: teacher?.escuelaId || '',
        schoolName: school?.nombre || teacher?.schoolName || '',
        status: modal.form.status,
        updatedAt: serverTimestamp(),
      }
      const toTimestamp = (val) => {
        if (!val) return null
        const d = new Date(val)
        return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d)
      }
      const tsInicio = toTimestamp(modal.form.fechaInicio)
      const tsVencimiento = toTimestamp(modal.form.fechaVencimiento)
      if (tsInicio) data.fechaInicio = tsInicio
      if (tsVencimiento) data.fechaVencimiento = tsVencimiento

      if (modal.mode === 'create') {
        await addDoc(collection(db, 'subscriptions'), { ...data, createdAt: serverTimestamp() })
        toast('Suscripción creada')
      } else {
        await updateDoc(doc(db, 'subscriptions', modal.id), data)
        toast('Suscripción actualizada')
      }
      setModal(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(sub) {
    if (!confirm('¿Cancelar esta suscripción?')) return
    try {
      await updateDoc(doc(db, 'subscriptions', sub.id), {
        status: 'cancelada',
        updatedAt: serverTimestamp(),
      })
      toast('Suscripción cancelada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDelete(sub) {
    if (!confirm('¿Eliminar esta suscripción? No se puede deshacer.')) return
    try {
      await deleteDoc(doc(db, 'subscriptions', sub.id))
      toast('Suscripción eliminada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant flex items-center justify-between">
        <h2 className="font-semibold text-on-surface">Suscripciones</h2>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700"
        >
          <Plus size={16} /> Nueva
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-surface text-left text-xs text-muted uppercase">
              <th className="px-4 py-2">Docente</th>
              <th className="px-4 py-2">Escuela</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Vencimiento</th>
              <th className="px-4 py-2">Días</th>
              <th className="px-4 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Sin suscripciones
                </td>
              </tr>
            ) : (
              rows.map((sub) => {
                const teacher = teachersMap[sub.docenteId]
                const plan = plansMap[sub.planId]
                const days = calcDaysRemaining(sub.fechaVencimiento)
                return (
                  <tr key={sub.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2">
                      <p className="font-medium text-on-surface">
                        {teacher?.username || teacher?.email || sub.docenteId.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-muted truncate max-w-[140px]">
                      {sub.schoolName || '—'}
                    </td>
                    <td className="px-4 py-2">{plan?.nombre || (sub.status === 'trial' ? 'Trial' : '—')}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={sub.status} />
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(sub.fechaVencimiento)}</td>
                    <td className="px-4 py-2 text-muted">{days !== null ? days : '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(sub)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded"
                          data-tooltip="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        {sub.status !== 'cancelada' && (
                          <button
                            type="button"
                            onClick={() => handleCancel(sub)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 rounded"
                            data-tooltip="Cancelar"
                          >
                            <Ban size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(sub)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                          data-tooltip="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-on-surface">
                {modal.mode === 'create' ? 'Nueva suscripción' : 'Editar suscripción'}
              </h3>
              <button type="button" onClick={() => setModal(null)}>
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Docente</label>
                <select
                  value={modal.form.docenteId}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, docenteId: e.target.value } })
                  }
                  required
                  className={inputCls}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.username || t.email} — {t.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Plan</label>
                <select
                  value={modal.form.planId}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, planId: e.target.value } })
                  }
                  className={inputCls}
                >
                  <option value="">— Sin plan (trial) —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Estado</label>
                <select
                  value={modal.form.status}
                  onChange={(e) =>
                    setModal({ ...modal, form: { ...modal.form, status: e.target.value } })
                  }
                  className={inputCls}
                >
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Inicio</label>
                  <EFDateTimePicker
                    mode="date"
                    value={modal.form.fechaInicio}
                    onChange={v => setModal({ ...modal, form: { ...modal.form, fechaInicio: v } })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Vencimiento</label>
                  <EFDateTimePicker
                    mode="date"
                    value={modal.form.fechaVencimiento}
                    onChange={v => setModal({ ...modal, form: { ...modal.form, fechaVencimiento: v } })}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 bg-blue-600 text-white font-semibold rounded text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : null}
                Guardar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
