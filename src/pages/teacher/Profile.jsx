import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
  GoogleAuthProvider,
  linkWithPopup,
  unlink,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import { Camera, Check, LogOut, Lock, User, Link as LinkIcon, Unlink, X, Mail, CreditCard } from 'lucide-react'
import { useSubscription } from '../../hooks/useSubscription'
import PaymentSimulationModal from '../../components/PaymentSimulationModal'
import {
  calcDaysRemaining,
  formatCurrency,
  formatDate,
  formatLimit,
  getDaysLabel,
  getPaymentStatusColor,
  getSubscriptionStatusColor,
} from '../../utils/subscriptionHelpers'

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

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
  'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50'

export default function Profile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const fileRef = useRef(null)

  // Display name
  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  const [savingNombre, setSavingNombre] = useState(false)

  // Photo
  const [photoUploading, setPhotoUploading] = useState(false)

  // Password change
  const [showPwdForm, setShowPwdForm] = useState(false)
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  // Email change
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPwd, setEmailPwd] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  // Confirmation modal
  const [confirm, setConfirm] = useState(null) // { title, message, onConfirm }
  const [confirming, setConfirming] = useState(false)

  // Google linking
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)

  const { subscription, currentPlan, plans, recentPayments, loading: subLoading, refresh: refreshSub } = useSubscription()
  const isGoogleLinked = currentUser?.providerData?.some((p) => p.providerId === 'google.com')
  const hasEmailProvider = currentUser?.providerData?.some((p) => p.providerId === 'password')

  // ── helpers ──────────────────────────────────────────────────────────────
  function resetPwdForm() {
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    setShowPwdForm(false)
  }
  function resetEmailForm() {
    setNewEmail(''); setEmailPwd('')
    setShowEmailForm(false)
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

  function requestEmailChange(e) {
    e.preventDefault()
    if (!newEmail.trim()) { toast('Ingresa el nuevo correo', 'error'); return }
    if (!emailPwd) { toast('Ingresa tu contraseña actual', 'error'); return }
    if (newEmail.trim().toLowerCase() === currentUser.email) {
      toast('El nuevo correo es igual al actual', 'error'); return
    }
    setConfirm({
      title: 'Cambiar correo',
      message: `¿Está seguro de cambiar el correo a "${newEmail.trim()}"? Se enviará un enlace de verificación a ese correo.`,
      onConfirm: executeEmailChange,
    })
  }

  async function executeEmailChange() {
    setSavingEmail(true)
    try {
      await reauth(emailPwd)
      await verifyBeforeUpdateEmail(currentUser, newEmail.trim().toLowerCase())
      await updateDoc(doc(db, 'users', currentUser.uid), { email: newEmail.trim().toLowerCase() })
      toast('Correo de verificación enviado a ' + newEmail.trim())
      resetEmailForm()
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        toast('Contraseña incorrecta', 'error')
      } else if (err.code === 'auth/email-already-in-use') {
        toast('Ese correo ya está registrado', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingEmail(false)
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

  async function handleLinkGoogle() {
    setLinkingGoogle(true)
    try {
      await linkWithPopup(currentUser, new GoogleAuthProvider())
      toast('Cuenta de Google vinculada correctamente')
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use') {
        toast('Esta cuenta de Google ya está vinculada a otro usuario', 'error')
      } else if (err.code !== 'auth/popup-closed-by-user') {
        toast('Error al vincular: ' + err.message, 'error')
      }
    } finally {
      setLinkingGoogle(false)
    }
  }

  async function handleUnlinkGoogle() {
    const providers = currentUser?.providerData || []
    if (providers.length <= 1) {
      toast('No puedes desvincular el único método de acceso', 'error')
      return
    }
    try {
      await unlink(currentUser, 'google.com')
      toast('Cuenta de Google desvinculada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const displayName = userProfile?.nombreMostrar || userProfile?.username || 'Docente'
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
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
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
                      <p className="font-bold text-slate-900">Período de prueba</p>
                      <p className="text-sm text-slate-500">60 días gratuitos</p>
                    </>
                  ) : currentPlan ? (
                    <>
                      <p className="font-bold text-slate-900">{currentPlan.nombre}</p>
                      <p className="text-sm text-slate-500">
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
            <p className="text-sm text-slate-500">No tienes un plan activo.</p>
          )}
          {canRenew && plans.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
            >
              {subscription && subscription.status !== 'trial' ? 'Contratar / Renovar' : 'Contratar Plan Pro'}
            </button>
          )}
          {recentPayments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Últimos pagos</p>
              <ul className="space-y-2">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{formatDate(p.createdAt)}</span>
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

        <PaymentSimulationModal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          plans={plans}
          subscription={subscription}
          onSuccess={refreshSub}
        />

        {/* Photo + identity */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col items-center gap-4">
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
            <p className="font-bold text-slate-900">{displayName}</p>
            {userProfile?.username && (
              <p className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded mt-1 inline-block">
                {userProfile.username}
              </p>
            )}
            {userProfile?.schoolName && (
              <p className="text-xs text-slate-400 mt-1">{userProfile.schoolName}</p>
            )}
          </div>
        </div>

        {/* Nombre visible */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <User size={17} className="text-slate-400" /> Nombre
          </h2>
          <form onSubmit={handleSaveNombre} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
                className={inputCls} placeholder="Ej. Profa. García Pérez" />
              <p className="text-xs text-slate-400 mt-1">Así te verán tus alumnos</p>
            </div>
            <button type="submit" disabled={savingNombre}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingNombre ? <Spinner size="sm" /> : null}
              {savingNombre ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </div>

        {/* Acceso */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Lock size={17} className="text-slate-400" /> Acceso
          </h2>
          <div className="space-y-1">

            {/* Username — read only */}
            <div className="flex items-center gap-3 py-3 border-b border-slate-100">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 mb-0.5">Usuario</p>
                <p className="text-sm font-semibold font-mono text-slate-900">{userProfile?.username || '—'}</p>
              </div>
            </div>

            {/* ── Correo ── */}
            <div className="py-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 mb-0.5">Correo electrónico</p>
                  <p className="text-sm text-slate-900 truncate">{currentUser?.email}</p>
                  {currentUser?.emailVerified
                    ? <p className="text-xs text-emerald-500 flex items-center gap-1 mt-0.5"><Check size={10} /> Verificado</p>
                    : <p className="text-xs text-amber-500 mt-0.5">Sin verificar</p>}
                </div>
                {hasEmailProvider && (
                  <button type="button" onClick={() => { setShowEmailForm((v) => !v); resetPwdForm() }}
                    className="text-blue-600 text-sm font-semibold hover:underline flex-shrink-0">
                    {showEmailForm ? 'Cancelar' : 'Cambiar'}
                  </button>
                )}
              </div>

              {showEmailForm && (
                <form onSubmit={requestEmailChange} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nuevo correo</label>
                    <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                      required autoComplete="off" className={inputCls} placeholder="nuevo@correo.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña actual</label>
                    <PasswordInput value={emailPwd} onChange={(e) => setEmailPwd(e.target.value)}
                      required autoComplete="current-password" className={inputCls} placeholder="Tu contraseña actual" />
                  </div>
                  <button type="submit" disabled={savingEmail}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingEmail ? <Spinner size="sm" /> : <Mail size={15} />}
                    {savingEmail ? 'Procesando…' : 'Cambiar correo'}
                  </button>
                </form>
              )}
            </div>

            {/* ── Contraseña ── */}
            <div className="py-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">Contraseña</p>
                  {!hasEmailProvider && (
                    <p className="text-xs text-slate-400 mt-0.5">Solo disponible con acceso por usuario/contraseña</p>
                  )}
                </div>
                {hasEmailProvider && (
                  <button type="button" onClick={() => { setShowPwdForm((v) => !v); resetEmailForm() }}
                    className="text-blue-600 text-sm font-semibold hover:underline flex-shrink-0">
                    {showPwdForm ? 'Cancelar' : 'Cambiar'}
                  </button>
                )}
              </div>

              {showPwdForm && (
                <form onSubmit={requestPwdChange} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña actual</label>
                    <PasswordInput value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)}
                      required autoComplete="current-password" className={inputCls} placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nueva contraseña</label>
                    <PasswordInput value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Mínimo 6 caracteres" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Confirmar nueva contraseña</label>
                    <PasswordInput value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                      required autoComplete="new-password" className={inputCls} placeholder="Repite la contraseña" />
                  </div>
                  <button type="submit" disabled={savingPwd}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingPwd ? <Spinner size="sm" /> : <Lock size={15} />}
                    {savingPwd ? 'Actualizando…' : 'Cambiar contraseña'}
                  </button>
                </form>
              )}
            </div>

            {/* Google linking */}
            <div className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <GoogleIcon />
                  <p className="text-sm font-medium text-slate-900">Google</p>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isGoogleLinked ? 'Vinculado — puedes entrar con tu cuenta de Google' : 'No vinculado'}
                </p>
              </div>
              {isGoogleLinked ? (
                <button type="button" onClick={handleUnlinkGoogle}
                  className="flex items-center gap-1.5 text-slate-400 hover:text-red-500 text-xs font-medium transition-colors flex-shrink-0">
                  <Unlink size={13} /> Desvincular
                </button>
              ) : (
                <button type="button" onClick={handleLinkGoogle} disabled={linkingGoogle}
                  className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-xs font-semibold transition-colors disabled:opacity-60 flex-shrink-0">
                  {linkingGoogle ? <Spinner size="sm" /> : <LinkIcon size={13} />}
                  Vincular
                </button>
              )}
            </div>

          </div>
        </div>

        {/* Logout */}
        <button type="button" onClick={handleLogout}
          className="w-full py-3 border border-red-200 text-red-500 rounded-xl font-semibold hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
          <LogOut size={18} /> Cerrar sesión
        </button>
      </div>

      {/* ── Confirmation modal ── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !confirming && setConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <button onClick={() => !confirming && setConfirm(null)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 rounded-lg">
              <X size={18} />
            </button>
            <h3 className="text-base font-semibold text-slate-900 mb-2 pr-6">{confirm.title}</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">{confirm.message}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirm(null)} disabled={confirming}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirm} disabled={confirming}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {confirming ? <Spinner size="sm" /> : null}
                {confirming ? 'Procesando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
