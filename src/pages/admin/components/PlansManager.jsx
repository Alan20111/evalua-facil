import { useState } from 'react'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { db } from '../../../firebase'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { formatCurrency } from '../../../utils/subscriptionHelpers'

const inputCls =
  'w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm bg-slate-50'

const EMPTY_PLAN = {
  nombre: '',
  descripcion: '',
  precio: 199,
  periodicidad: 'mensual',
  maxAsignaturas: 3,
  maxAlumnos: 50,
  activo: true,
  orden: 1,
}

export default function PlansManager({ stats, onRefresh }) {
  const toast = useToast()
  const [modal, setModal] = useState(null)
  const [saving, setSaving] = useState(false)

  if (!stats) return null

  const plans = [...stats.plans].sort((a, b) => (a.orden || 0) - (b.orden || 0))

  function openCreate() {
    setModal({ mode: 'create', form: { ...EMPTY_PLAN, orden: plans.length + 1 } })
  }

  function openEdit(plan) {
    setModal({
      mode: 'edit',
      id: plan.id,
      form: {
        nombre: plan.nombre || '',
        descripcion: plan.descripcion || '',
        precio: plan.precio || 0,
        periodicidad: plan.periodicidad || 'mensual',
        maxAsignaturas: plan.maxAsignaturas ?? 3,
        maxAlumnos: plan.maxAlumnos ?? 50,
        activo: plan.activo !== false,
        orden: plan.orden || 1,
      },
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const data = {
        ...modal.form,
        precio: Number(modal.form.precio),
        maxAsignaturas: Number(modal.form.maxAsignaturas),
        maxAlumnos: Number(modal.form.maxAlumnos),
        orden: Number(modal.form.orden),
        updatedAt: serverTimestamp(),
      }

      if (modal.mode === 'create') {
        await addDoc(collection(db, 'plans'), { ...data, createdAt: serverTimestamp() })
        toast('Plan creado')
      } else {
        await updateDoc(doc(db, 'plans', modal.id), data)
        toast('Plan actualizado')
      }
      setModal(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(plan) {
    if (!confirm(`¿Eliminar el plan "${plan.nombre}"?`)) return
    try {
      await deleteDoc(doc(db, 'plans', plan.id))
      toast('Plan eliminado')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Catálogo de planes</h2>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700"
        >
          <Plus size={14} /> Nuevo plan
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Precio</th>
              <th className="px-4 py-3">Límites</th>
              <th className="px-4 py-3">Activo</th>
              <th className="px-4 py-3">Orden</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Sin planes. Ejecuta <code className="text-xs bg-slate-100 px-1 rounded">seed-plans.js</code> o crea uno.
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{plan.nombre}</p>
                    <p className="text-xs text-slate-400 truncate max-w-[200px]">{plan.descripcion}</p>
                  </td>
                  <td className="px-4 py-3">
                    {formatCurrency(plan.precio)}/{plan.periodicidad === 'anual' ? 'año' : 'mes'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {plan.maxAsignaturas === -1 ? '∞' : plan.maxAsignaturas} asig. /{' '}
                    {plan.maxAlumnos === -1 ? '∞' : plan.maxAlumnos} alumnos
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        plan.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {plan.activo ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{plan.orden}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(plan)}
                        className="p-1.5 text-slate-400 hover:text-violet-600 rounded-lg"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(plan)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900">
                {modal.mode === 'create' ? 'Nuevo plan' : 'Editar plan'}
              </h3>
              <button type="button" onClick={() => setModal(null)}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label>
                <input
                  value={modal.form.nombre}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, nombre: e.target.value } })}
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Descripción</label>
                <textarea
                  value={modal.form.descripcion}
                  onChange={(e) => setModal({ ...modal, form: { ...modal.form, descripcion: e.target.value } })}
                  className={`${inputCls} h-16 resize-none`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Precio (MXN)</label>
                  <input
                    type="number"
                    min="0"
                    value={modal.form.precio}
                    onChange={(e) => setModal({ ...modal, form: { ...modal.form, precio: e.target.value } })}
                    required
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Periodicidad</label>
                  <select
                    value={modal.form.periodicidad}
                    onChange={(e) => setModal({ ...modal, form: { ...modal.form, periodicidad: e.target.value } })}
                    className={inputCls}
                  >
                    <option value="mensual">Mensual</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Máx. asignaturas (-1 = ∞)</label>
                  <input
                    type="number"
                    value={modal.form.maxAsignaturas}
                    onChange={(e) => setModal({ ...modal, form: { ...modal.form, maxAsignaturas: e.target.value } })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Máx. alumnos (-1 = ∞)</label>
                  <input
                    type="number"
                    value={modal.form.maxAlumnos}
                    onChange={(e) => setModal({ ...modal, form: { ...modal.form, maxAlumnos: e.target.value } })}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Orden</label>
                  <input
                    type="number"
                    value={modal.form.orden}
                    onChange={(e) => setModal({ ...modal, form: { ...modal.form, orden: e.target.value } })}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modal.form.activo}
                      onChange={(e) => setModal({ ...modal, form: { ...modal.form, activo: e.target.checked } })}
                      className="rounded"
                    />
                    Visible para compra
                  </label>
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-violet-600 text-white font-semibold rounded-xl text-sm disabled:opacity-60 flex items-center justify-center gap-2"
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
