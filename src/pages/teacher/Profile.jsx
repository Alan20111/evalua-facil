import { useState, useRef, useMemo, useEffect } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import { usePlanteles } from '../../data/usePlanteles'
import { resolveSchoolSelection, normalizeName, findSimilarSchools } from '../../utils/schoolSelection'
import { Camera, Lock, User, X, CreditCard, School, Search, ChevronDown, Plus } from 'lucide-react'
import { useSubscription } from '../../hooks/useSubscription'
import CheckoutModal from '../../components/CheckoutModal'
import {
  TRIAL_DURATION_DAYS,
  MONTHLY_PRICE_MXN,
  SUBSCRIPTION_NAME,
  calcDaysRemaining,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  getDaysLabel,
  getPaymentStatusColor,
  getSubscriptionStatusColor,
} from '../../utils/subscriptionHelpers'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'

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
  'w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface'

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
  const [addingCustomSchool, setAddingCustomSchool] = useState(false)
  // 'form' (typing the data) → 'similar' (possible matches found, asking if
  // it's one of them) → 'confirm' (final review before actually saving).
  const [customSchoolStep, setCustomSchoolStep] = useState('form')
  const [similarSchools, setSimilarSchools] = useState([])
  const [customSchoolName, setCustomSchoolName] = useState('')
  const [customSchoolCCT, setCustomSchoolCCT] = useState('')
  const [customSchoolCity, setCustomSchoolCity] = useState('')
  const [customSchoolState, setCustomSchoolState] = useState('')
  const [customSchools, setCustomSchools] = useState([])
  const [customSchoolsLoaded, setCustomSchoolsLoaded] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()

  // Schools added by hand (not in the static catalog) live in Firestore — load
  // them once the picker opens so they're searchable too, not just the catalog.
  useEffect(() => {
    if (!showSchoolPicker || customSchoolsLoaded) return
    getDocs(query(collection(db, 'schools'), where('custom', '==', true)))
      .then((snap) => setCustomSchools(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setCustomSchoolsLoaded(true))
  }, [showSchoolPicker, customSchoolsLoaded])

  const filteredPlanteles = useMemo(() => {
    const q = normalizeName(schoolSearch)
    if (!q) return []
    return planteles.filter((p) =>
      normalizeName(p.nombre || '').includes(q) || normalizeName(p.short || '').includes(q) ||
      normalizeName(p.cct || '').includes(q) || normalizeName(p.mun || '').includes(q)
    ).slice(0, 80)
  }, [planteles, schoolSearch])

  const filteredCustomSchools = useMemo(() => {
    const q = normalizeName(schoolSearch)
    if (!q) return []
    return customSchools.filter((s) => normalizeName(s.nombre || '').includes(q))
  }, [customSchools, schoolSearch])

  function openCustomSchoolForm() {
    setCustomSchoolName(schoolSearch.trim())
    setCustomSchoolCCT('')
    setCustomSchoolCity('')
    setCustomSchoolState('')
    setCustomSchoolStep('form')
    setSimilarSchools([])
    setAddingCustomSchool(true)
  }

  // Catches obvious junk (empty, too short, no letters at all) without
  // blocking real names the static catalog wouldn't recognize — it can't
  // verify the school is real, just that what was typed looks like a name.
  function looksLikeText(value, minLen) {
    const v = value.trim()
    return v.length >= minLen && /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(v)
  }

  function reviewCustomSchool(e) {
    e.preventDefault()
    if (!looksLikeText(customSchoolName, 4)) {
      toast('Escribe el nombre completo de la escuela', 'error')
      return
    }
    if (!looksLikeText(customSchoolCity, 2)) {
      toast('Escribe la ciudad o municipio', 'error')
      return
    }
    if (!looksLikeText(customSchoolState, 2)) {
      toast('Escribe el estado', 'error')
      return
    }
    if (customSchoolCCT.trim() && !/^[a-zA-Z0-9]+$/.test(customSchoolCCT.trim())) {
      toast('La clave del centro de trabajo solo debe tener letras y números', 'error')
      return
    }

    const name = customSchoolName.trim()
    const mun = customSchoolCity.trim()
    const edo = customSchoolState.trim()
    const candidates = [
      ...customSchools.map((s) => ({
        kind: 'custom', id: s.id, nombre: s.nombre, municipio: s.municipio, estado: s.estado, claveSEP: s.claveSEP,
      })),
      ...planteles.map((p) => ({
        kind: 'catalog', plantel: p, nombre: p.nombre || p.short, municipio: p.mun, estado: p.edo, claveSEP: p.cct,
      })),
    ]
    const matches = findSimilarSchools(name, mun, edo, candidates)
    if (matches.length) {
      setSimilarSchools(matches.slice(0, 5))
      setCustomSchoolStep('similar')
    } else {
      setCustomSchoolStep('confirm')
    }
  }

  async function chooseSimilarSchool(candidate) {
    if (candidate.kind === 'custom') {
      await updateSchool({ existingId: candidate.id, nombre: candidate.nombre })
    } else {
      await updateSchool(candidate.plantel)
    }
    setAddingCustomSchool(false)
  }

  async function submitCustomSchool() {
    await updateSchool({
      custom: true,
      nombre: customSchoolName.trim(),
      short: customSchoolName.trim(),
      cct: customSchoolCCT.trim(),
      mun: customSchoolCity.trim(),
      edo: customSchoolState.trim(),
    })
    setAddingCustomSchool(false)
  }

  async function updateSchool(plantel) {
    setSavingSchool(true)
    try {
      const { escuelaId, schoolName } = await resolveSchoolSelection(plantel, currentUser.uid)
      await updateDoc(doc(db, 'users', currentUser.uid), { escuelaId, schoolName })
      setUserProfile((p) => ({ ...p, escuelaId, schoolName }))
      toast('Escuela actualizada — solo aplica a asignaturas y estudiantes nuevos')
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

  const { subscription, recentPayments, loading: subLoading, refresh: refreshSub } = useSubscription()
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
  const daysRemaining = subscription ? calcDaysRemaining(effectiveVencimiento(subscription)) : null
  const canRenew =
    !subscription ||
    subscription.status === 'vencida' ||
    subscription.status === 'pendiente_pago' ||
    subscription.status === 'trial' ||
    (subscription.status === 'activa' && daysRemaining !== null && daysRemaining <= 7)

  return (
    <TeacherLayout>
      <div className={`px-4 py-4 space-y-4 ${TEACHER_CONTAINER_NARROW}`}>

        {/* Mi plan */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <CreditCard size={19} className="text-slate-400" /> Mi plan
          </h2>
          {subLoading ? (
            <div className="flex justify-center py-2"><Spinner /></div>
          ) : subscription ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {subscription.status === 'trial' ? (
                    <>
                      <p className="font-bold text-on-surface">Período de prueba</p>
                      <p className="text-sm text-muted">{TRIAL_DURATION_DAYS} días gratuitos</p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-on-surface">{SUBSCRIPTION_NAME}</p>
                      <p className="text-sm text-muted">{formatCurrency(MONTHLY_PRICE_MXN)}/mes</p>
                    </>
                  )}
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
          {canRenew && (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-sm transition-colors"
            >
              {subscription && subscription.status !== 'trial' ? 'Renovar suscripción mensual' : 'Activar suscripción mensual'}
            </button>
          )}
          {recentPayments.length > 0 && (
            <div className="mt-2 pt-4 border-t border-outline-variant">
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
          subscription={subscription}
          onSuccess={refreshSub}
        />

        {/* Photo + identity */}
        <div className="bg-surface-card rounded-card shadow-card p-4 flex flex-col items-center gap-2">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-blue-100 overflow-hidden flex items-center justify-center">
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-blue-600">{initials}</span>
              )}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoUploading} aria-label="Cambiar foto"
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md disabled:opacity-60">
              {photoUploading ? <Spinner size="sm" /> : <Camera size={15} />}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
          <div className="text-center">
            <p className="font-bold text-on-surface">{displayName}</p>
            {userProfile?.schoolName && (
              <p className="text-sm text-slate-500 mt-1">{userProfile.schoolName}</p>
            )}
          </div>
        </div>

        {/* Nombre visible */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <User size={19} className="text-slate-400" /> Nombre
          </h2>
          <form onSubmit={handleSaveNombre} className="space-y-2">
            <div>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
                className={inputCls} placeholder="Ej. Profa. García Pérez" />
              <p className="text-sm text-muted mt-1">Así te verán tus estudiantes</p>
            </div>
            <button type="submit" disabled={savingNombre}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingNombre ? <Spinner size="sm" /> : null}
              {savingNombre ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </div>

        {/* Escuela */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <School size={19} className="text-slate-400" /> Escuela
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{userProfile?.schoolName || 'Sin escuela'}</p>
              <p className="text-sm text-slate-500 mt-0.5">Las escuelas con el mismo nombre pueden tener grupos en común.</p>
            </div>
            <button type="button" onClick={() => { setSchoolSearch(''); setAddingCustomSchool(false); setCustomSchoolStep('form'); setShowSchoolPicker(true) }}
              className="text-blue-600 text-sm font-semibold hover:underline flex-shrink-0">Cambiar</button>
          </div>
        </div>

        {/* Acceso */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <Lock size={19} className="text-slate-400" /> Acceso
          </h2>
          <div className="space-y-1">

            {/* ── Correo (solo lectura) ── */}
            <div className="py-2 border-b border-outline-variant">
              <p className="text-sm text-slate-500 mb-0.5">Correo electrónico</p>
              <p className="text-sm text-on-surface truncate">{currentUser?.email}</p>
            </div>

            {/* ── Contraseña ── */}
            <div className="py-2 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium text-on-surface">Contraseña</p>
                  {!hasEmailProvider && (
                    <p className="text-sm text-slate-500 mt-0.5">Solo disponible si tu cuenta usa correo y contraseña</p>
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
                <form onSubmit={requestPwdChange} className="mt-2 space-y-2">
                  <div>
                    <label htmlFor="prof-pwd-actual" className="block text-xs font-medium text-muted mb-1">Contraseña actual</label>
                    <PasswordInput id="prof-pwd-actual" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)}
                      required autoComplete="current-password" className={inputCls} placeholder="••••••••" />
                  </div>
                  <div>
                    <label htmlFor="prof-pwd-nueva" className="block text-xs font-medium text-muted mb-1">Nueva contraseña</label>
                    <PasswordInput id="prof-pwd-nueva" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <div>
                    <label htmlFor="prof-pwd-confirmar" className="block text-xs font-medium text-muted mb-1">Confirmar nueva contraseña</label>
                    <PasswordInput id="prof-pwd-confirmar" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Repite la contraseña" />
                  </div>
                  <button type="submit" disabled={savingPwd}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingPwd ? <Spinner size="sm" /> : <Lock size={17} />}
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
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4">
            <button type="button" onClick={() => !confirming && setConfirm(null)} aria-label="Cerrar"
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-muted rounded">
              <X size={20} />
            </button>
            <h3 className="text-base font-semibold text-on-surface mb-2 pr-6">{confirm.title}</h3>
            <p className="text-sm text-muted mb-4 leading-relaxed">{confirm.message}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirm(null)} disabled={confirming}
                className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirm} disabled={confirming}
                className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {confirming ? <Spinner size="sm" /> : null}
                {confirming ? 'Procesando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* School picker overlay */}
      {showSchoolPicker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !savingSchool && setShowSchoolPicker(false)} />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-sm rounded-card shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center gap-2 p-3 border-b border-outline-variant">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input autoFocus type="text" value={schoolSearch} onChange={(e) => setSchoolSearch(e.target.value)}
                  placeholder="Nombre, CCT o municipio…"
                  className="w-full pl-8 pr-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <button type="button" onClick={() => setShowSchoolPicker(false)} aria-label="Cerrar" className="p-2 text-slate-400 hover:text-muted rounded"><X size={19} /></button>
            </div>
            {addingCustomSchool && customSchoolStep === 'similar' ? (
              <div className="p-3 space-y-2 overflow-y-auto">
                <p className="text-sm text-muted">
                  Encontramos escuelas parecidas — ¿es alguna de estas la misma que quieres agregar?
                </p>
                <ul className="space-y-2">
                  {similarSchools.map((c, i) => (
                    <li key={`${c.claveSEP || c.nombre}-${i}`}>
                      <button type="button" onClick={() => chooseSimilarSchool(c)} disabled={savingSchool}
                        className="w-full text-left px-3 py-2 rounded border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                        <p className="text-sm font-medium text-on-surface leading-tight">{c.nombre}</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {[c.claveSEP, [c.municipio, c.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomSchoolStep('form')} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Volver
                  </button>
                  <button type="button" onClick={() => setCustomSchoolStep('confirm')} disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
                    Ninguna, es nueva
                  </button>
                </div>
              </div>
            ) : addingCustomSchool && customSchoolStep === 'confirm' ? (
              <div className="p-3 space-y-2">
                <p className="text-sm text-muted">¿Confirmas que la escuela a agregar es esta?</p>
                <div className="bg-surface rounded p-3 border border-outline-variant space-y-1">
                  <p className="text-sm font-semibold text-on-surface">{customSchoolName.trim()}</p>
                  {customSchoolCCT.trim() && <p className="text-sm text-slate-500">CCT: {customSchoolCCT.trim()}</p>}
                  <p className="text-sm text-slate-500">{customSchoolCity.trim()}, {customSchoolState.trim()}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomSchoolStep(similarSchools.length ? 'similar' : 'form')} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Volver
                  </button>
                  <button type="button" onClick={submitCustomSchool} disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingSchool ? <Spinner size="sm" /> : null}
                    {savingSchool ? 'Guardando…' : 'Confirmar y agregar'}
                  </button>
                </div>
              </div>
            ) : addingCustomSchool ? (
              <form onSubmit={reviewCustomSchool} className="p-3 space-y-2 overflow-y-auto">
                <div>
                  <label htmlFor="prof-escuela-nombre" className="block text-sm font-medium text-muted mb-1">Nombre oficial de la escuela</label>
                  <input
                    id="prof-escuela-nombre"
                    autoFocus
                    type="text"
                    value={customSchoolName}
                    onChange={(e) => setCustomSchoolName(e.target.value)}
                    required
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                    placeholder="Ej. Escuela Secundaria Técnica N.° 12"
                  />
                </div>
                <div>
                  <label htmlFor="prof-escuela-cct" className="block text-sm font-medium text-muted mb-1">
                    Clave del centro de trabajo (CCT) <span className="text-slate-500 font-normal text-xs">(opcional)</span>
                  </label>
                  <input
                    id="prof-escuela-cct"
                    type="text"
                    value={customSchoolCCT}
                    onChange={(e) => setCustomSchoolCCT(e.target.value)}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                    placeholder="Ej. 15ECT0001H"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label htmlFor="prof-escuela-ciudad" className="block text-sm font-medium text-muted mb-1">Ciudad / municipio</label>
                    <input
                      id="prof-escuela-ciudad"
                      type="text"
                      value={customSchoolCity}
                      onChange={(e) => setCustomSchoolCity(e.target.value)}
                      required
                      className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                      placeholder="Ej. Celaya"
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="prof-escuela-estado" className="block text-sm font-medium text-muted mb-1">Estado</label>
                    <input
                      id="prof-escuela-estado"
                      type="text"
                      value={customSchoolState}
                      onChange={(e) => setCustomSchoolState(e.target.value)}
                      required
                      className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-surface"
                      placeholder="Ej. Guanajuato"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddingCustomSchool(false)} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Cancelar
                  </button>
                  <button type="submit" disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    Continuar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button type="button" onClick={() => updateSchool(null)} disabled={savingSchool}
                  className="flex items-center gap-2 px-4 py-2 text-left border-b border-outline-variant hover:bg-[var(--accent-tint)] disabled:opacity-60">
                  <ChevronDown size={17} className="text-slate-400 rotate-0" />
                  <span className="text-sm font-medium text-muted">Sin escuela</span>
                </button>
                {schoolSearch.trim() && (
                  catalogLoading ? (
                    <div className="flex justify-center py-10"><Spinner /></div>
                  ) : (
                    <ul className="overflow-y-auto flex-1 divide-y divide-slate-100">
                      {filteredPlanteles.length === 0 && filteredCustomSchools.length === 0 && (
                        <li className="text-center text-slate-500 text-sm py-10">Sin resultados</li>
                      )}
                      {filteredCustomSchools.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => updateSchool({ existingId: s.id, nombre: s.nombre })} disabled={savingSchool}
                            className="w-full text-left px-4 py-2 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                            <p className="text-sm font-medium text-on-surface leading-tight">{s.nombre}</p>
                            {(s.claveSEP || s.municipio || s.estado) && (
                              <p className="text-sm text-slate-500 mt-0.5">
                                {[s.claveSEP, [s.municipio, s.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </button>
                        </li>
                      ))}
                      {filteredPlanteles.map((p) => (
                        <li key={p.cct}>
                          <button type="button" onClick={() => updateSchool(p)} disabled={savingSchool}
                            className="w-full text-left px-4 py-2 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                            <p className="text-sm font-medium text-on-surface leading-tight">{p.short || p.nombre}</p>
                            <p className="text-sm text-slate-500 mt-0.5">{p.cct} · {p.mun}, {p.edo}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                )}
                {schoolSearch.trim() && (
                  <div className="border-t border-outline-variant p-2">
                    <button
                      type="button"
                      disabled={savingSchool}
                      onClick={openCustomSchoolForm}
                      className="w-full flex items-center gap-2 px-4 py-2 rounded text-sm font-medium text-blue-600 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60"
                    >
                      <Plus size={18} className="flex-shrink-0" />
                      <span className="truncate">¿No la encuentras? Agregar «{schoolSearch.trim()}»</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
