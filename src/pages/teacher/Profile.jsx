import { useState, useRef, useMemo } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import { usePlanteles } from '../../data/usePlanteles'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { Camera, Lock, User, X, CreditCard, School, Search, ChevronDown, Plus } from 'lucide-react'
import { useSubscription } from '../../hooks/useSubscription'
import CheckoutModal from '../../components/CheckoutModal'
import {
  calcDaysRemaining,
  formatCurrency,
  formatDate,
  formatLimit,
  getDaysLabel,
  getPaymentStatusColor,
  getSubscriptionStatusColor,
} from '../../utils/subscriptionHelpers'

async function uploadAvatar(file) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const preset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  const fd = new FormData()
  fd.append('file', file)
  fd.append('upload_preset', preset)
  fd.append('folder', 'evalua-facil/avatars')
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: fd }
  )
  if (!res.ok) throw new Error('Error al subir imagen')
  return (await res.json()).secure_url
}

const inputCls =
  'w-full px-4 py-3 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface'

export default function Profile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  // Display name
  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  const [savingNombre, setSavingNombre] = useState(false)

  // Photo
  const [photoUploading, setPhotoUploading] = useState(false)

  // School
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const [schoolSearch, setSchoolSearch] = useState('')
  const [savingSchool, setSavingSchool] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()
  const filteredPlanteles = useMemo(() => {
    const q = schoolSearch.trim().toLowerCase()
    if (!q) return planteles.slice(0, 60)
    return planteles.filter((p) =>
      p.nombre?.toLowerCase().includes(q) || p.short?.toLowerCase().includes(q) ||
      p.cct?.toLowerCase().includes(q) || p.mun?.toLowerCase().includes(q)
    ).slice(0, 80)
  }, [planteles, schoolSearch])

  async function updateSchool(plantel) {
    setSavingSchool(true)
    try {
      const { escuelaId, schoolName } = await resolveSchoolSelection(plantel)
      await updateDoc(doc(db, 'users', currentUser.uid), { escuelaId, schoolName })
      setUserProfile((p) => ({ ...p, escuelaId, schoolName }))
      toast('Escuela actualizada — solo aplica a asignaturas y alumnos nuevos')
      setShowSchoolPicker(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingSchool(false) }
  }

  // Password change
  const [showPwdForm, setShowPwdForm] = useState(false)
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  // Confirmation modal
  const [confirm, setConfirm] = useState(null) // { title, message, onConfirm }
  const [confirming, setConfirming] = useState(false)

  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const { subscription, currentPlan, plans, recentPayments, loading: subLoading, refresh: refreshSub } = useSubscription()
  const hasEmailProvider = currentUser?.providerData?.some((p) => p.providerId === 'password')

  // ── helpers ──────────────────────────────────────────────────────────────
  function resetPwdForm() {
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    setShowPwdForm(false)
  }
  async function reauth(password) {
    const credential = EmailAuthProvider.credential(currentUser.email, password)
    await reauthenticateWithCredential(currentUser, credential)
  }

  // ── actions ──────────────────────────────────────────────────────────────
  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    try {
      const url = await uploadAvatar(file)
      await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url })
      setUserProfile((p) => ({ ...p, photoURL: url }))
      toast('Foto actualizada')
    } catch (err) {
      toast('Error al subir foto: ' + err.message, 'error')
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handleSaveNombre(e) {
    e.preventDefault()
    setSavingNombre(true)
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { nombreMostrar: nombre.trim() })
      setUserProfile((p) => ({ ...p, nombreMostrar: nombre.trim() }))
      toast('Nombre actualizado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingNombre(false)
    }
  }

  function requestPwdChange(e) {
    e.preventDefault()
    if (newPwd.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'error'); return }
    if (newPwd !== confirmPwd) { toast('Las contraseñas no coinciden', 'error'); return }
    if (!currentPwd) { toast('Ingresa tu contraseña actual', 'error'); return }
    setConfirm({
      title: 'Cambiar contraseña',
      message: '¿Está seguro de que desea cambiar su contraseña?',
      onConfirm: executePwdChange,
    })
  }

  async function executePwdChange() {
    setSavingPwd(true)
    try {
      await reauth(currentPwd)
      await updatePassword(currentUser, newPwd)
      toast('Contraseña actualizada correctamente')
      resetPwdForm()
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        toast('Contraseña actual incorrecta', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingPwd(false)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      await confirm.onConfirm()
    } finally {
      setConfirming(false)
      setConfirm(null)
    }
  }

  const displayName = userProfile?.nombreMostrar || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()
  const daysRemaining = subscription ? calcDaysRemaining(subscription.fechaVencimiento) : null
  const canRenew =
    !subscription ||
    subscription.status === 'vencida' ||
    subscription.status === 'pendiente_pago' ||
    subscription.status === 'trial' ||
    (subscription.status === 'activa' && daysRemaining !== null && daysRemaining <= 7)

  return (
    <TeacherLayout>
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">

        {/* Mi plan */}
        <div className="bg-surface-card rounded-card shadow-card p-5">
          <h2 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
            <CreditCard size={17} className="text-slate-400" /> Mi plan
          </h2>
          {subLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : subscription ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {subscription.status === 'trial' ? (
                    <>
                      <p className="font-bold text-on-surface">Período de prueba</p>
                      <p className="text-sm text-muted">60 días gratuitos</p>
                    </>
                  ) : currentPlan ? (
                    <>
                      <p className="font-bold text-on-surface">{currentPlan.nombre}</p>
                      <p className="text-sm text-muted">
                        {formatCurrency(currentPlan.precio)}/
                        {currentPlan.periodicidad === 'anual' ? 'año' : 'mes'}
                      </p>
                      {(currentPlan.maxAsignaturas !== undefined || currentPlan.maxAlumnos !== undefined) && (
                        <p className="text-xs text-slate-400 mt-1">
                          {formatLimit(currentPlan.maxAsignaturas, 'asignaturas')} ·{' '}
                          {formatLimit(currentPlan.maxAlumnos, 'alumnos')}
                        </p>
                      )}
                    </>
                  ) : null}
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${getSubscriptionStatusColor(subscription.status)}`}
                >
                  {subscription.status?.replace('_', ' ')}
                </span>
              </div>
              {daysRemaining !== null && subscription.status !== 'cancelada' && (
                <p
                  className={`text-sm font-medium ${
                    daysRemaining <= 7
                      ? 'text-amber-600'
                      : subscription.status === 'vencida'
                      ? 'text-red-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {getDaysLabel(daysRemaining)}
                </p>
              )}
              {subscription.status === 'pendiente_pago' && (
                <p className="text-sm text-amber-600">Tu pago está en revisión por el administrador.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No tienes un plan activo.</p>
          )}
          {canRenew && plans.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-sm transition-colors"
            >
              {subscription && subscription.status !== 'trial' ? 'Contratar / Renovar' : 'Contratar Plan Pro'}
            </button>
          )}
          {recentPayments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-outline-variant">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Últimos pagos</p>
              <ul className="space-y-2">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{formatDate(p.createdAt)}</span>
                    <span className="font-medium">{formatCurrency(p.monto)}</span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(p.status)}`}
                    >
                      {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <CheckoutModal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          plans={plans}
          subscription={subscription}
          onSuccess={refreshSub}
        />

        {/* Photo + identity */}
        <div className="bg-surface-card rounded-card shadow-card p-6 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-blue-100 overflow-hidden flex items-center justify-center">
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-blue-600">{initials}</span>
              )}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoUploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md disabled:opacity-60">
              {photoUploading ? <Spinner size="sm" /> : <Camera size={13} />}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
          <div className="text-center">
            <p className="font-bold text-on-surface">{displayName}</p>
            {userProfile?.schoolName && (
              <p className="text-xs text-slate-400 mt-1">{userProfile.schoolName}</p>
            )}
          </div>
        </div>

        {/* Nombre visible */}
        <div className="bg-surface-card rounded-card shadow-card p-5">
          <h2 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
            <User size={17} className="text-slate-400" /> Nombre
          </h2>
          <form onSubmit={handleSaveNombre} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Nombre completo</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
                className={inputCls} placeholder="Ej. Profa. García Pérez" />
              <p className="text-sm text-muted mt-1">Así te verán tus alumnos</p>
            </div>
            <button type="submit" disabled={savingNombre}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingNombre ? <Spinner size="sm" /> : null}
              {savingNombre ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </div>

        {/* Escuela */}
        <div className="bg-surface-card rounded-card shadow-card p-5">
          <h2 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
            <School size={17} className="text-slate-400" /> Escuela
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{userProfile?.schoolName || 'Sin escuela'}</p>
              <p className="text-xs text-slate-400 mt-0.5">Cambiarla solo afecta a las asignaturas y alumnos nuevos.</p>
            </div>
            <button type="button" onClick={() => { setSchoolSearch(''); setShowSchoolPicker(true) }}
              className="text-blue-600 text-sm font-semibold hover:underline flex-shrink-0">Cambiar</button>
          </div>
        </div>

        {/* Acceso */}
        <div className="bg-surface-card rounded-card shadow-card p-5">
          <h2 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Lock size={17} className="text-slate-400" /> Acceso
          </h2>
          <div className="space-y-1">

            {/* ── Correo (solo lectura) ── */}
            <div className="py-3 border-b border-outline-variant">
              <p className="text-xs text-slate-400 mb-0.5">Correo electrónico</p>
              <p className="text-sm text-on-surface truncate">{currentUser?.email}</p>
            </div>

            {/* ── Contraseña ── */}
            <div className="py-3 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">Contraseña</p>
                  {!hasEmailProvider && (
                    <p className="text-xs text-slate-400 mt-0.5">Solo disponible si tu cuenta usa correo y contraseña</p>
                  )}
                </div>
                {hasEmailProvider && (
                  <button type="button" onClick={() => setShowPwdForm((v) => !v)}
                    className="text-blue-600 text-sm font-semibold hover:underline flex-shrink-0">
                    {showPwdForm ? 'Cancelar' : 'Cambiar'}
                  </button>
                )}
              </div>

              {showPwdForm && (
                <form onSubmit={requestPwdChange} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Contraseña actual</label>
                    <PasswordInput value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)}
                      required autoComplete="current-password" className={inputCls} placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Nueva contraseña</label>
                    <PasswordInput value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Confirmar nueva contraseña</label>
                    <PasswordInput value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Repite la contraseña" />
                  </div>
                  <button type="submit" disabled={savingPwd}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingPwd ? <Spinner size="sm" /> : <Lock size={15} />}
                    {savingPwd ? 'Actualizando…' : 'Cambiar contraseña'}
                  </button>
                </form>
              )}
            </div>

          </div>
        </div>

      </div>

      {/* ── Confirmation modal ── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !confirming && setConfirm(null)} />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-6">
            <button onClick={() => !confirming && setConfirm(null)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-muted rounded">
              <X size={18} />
            </button>
            <h3 className="text-base font-semibold text-on-surface mb-2 pr-6">{confirm.title}</h3>
            <p className="text-sm text-muted mb-5 leading-relaxed">{confirm.message}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirm(null)} disabled={confirming}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-surface transition-colors disabled:opacity-60">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirm} disabled={confirming}
                className="flex-1 py-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {confirming ? <Spinner size="sm" /> : null}
                {confirming ? 'Procesando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* School picker overlay */}
      {showSchoolPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !savingSchool && setShowSchoolPicker(false)} />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center gap-2 p-3 border-b border-outline-variant">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input autoFocus type="text" value={schoolSearch} onChange={(e) => setSchoolSearch(e.target.value)}
                  placeholder="Nombre, CCT o municipio…"
                  className="w-full pl-8 pr-3 py-2.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <button onClick={() => setShowSchoolPicker(false)} className="p-2 text-slate-400 hover:text-muted rounded"><X size={17} /></button>
            </div>
            <button type="button" onClick={() => updateSchool(null)} disabled={savingSchool}
              className="flex items-center gap-2 px-4 py-3 text-left border-b border-outline-variant hover:bg-surface disabled:opacity-60">
              <ChevronDown size={15} className="text-slate-400 rotate-0" />
              <span className="text-sm font-medium text-muted">Sin escuela</span>
            </button>
            {catalogLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <ul className="overflow-y-auto flex-1 divide-y divide-slate-100">
                {filteredPlanteles.length === 0 && (
                  <li className="text-center text-slate-400 text-sm py-10">Sin resultados</li>
                )}
                {filteredPlanteles.map((p) => (
                  <li key={p.cct}>
                    <button type="button" onClick={() => updateSchool(p)} disabled={savingSchool}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors disabled:opacity-60">
                      <p className="text-sm font-medium text-on-surface leading-tight">{p.short || p.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{p.cct} · {p.mun}, {p.edo}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {schoolSearch.trim() && (
              <div className="border-t border-outline-variant p-2">
                <button
                  type="button"
                  disabled={savingSchool}
                  onClick={() => updateSchool({ custom: true, nombre: schoolSearch.trim(), short: schoolSearch.trim() })}
                  className="w-full flex items-center gap-2 px-4 py-3 rounded text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-60"
                >
                  <Plus size={16} className="flex-shrink-0" />
                  <span className="truncate">¿No la encuentras? Agregar «{schoolSearch.trim()}»</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
