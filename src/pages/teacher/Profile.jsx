import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  signOut,
  sendPasswordResetEmail,
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
import { Camera, Check, LogOut, Lock, User, Link as LinkIcon, Unlink } from 'lucide-react'

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

export default function Profile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const fileRef = useRef(null)

  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  const [savingNombre, setSavingNombre] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)

  const isGoogleLinked = currentUser?.providerData?.some((p) => p.providerId === 'google.com')

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
      await updateDoc(doc(db, 'users', currentUser.uid), {
        nombreMostrar: nombre.trim(),
      })
      setUserProfile((p) => ({ ...p, nombreMostrar: nombre.trim() }))
      toast('Nombre actualizado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingNombre(false)
    }
  }

  async function handleResetPassword() {
    try {
      await sendPasswordResetEmail(auth, currentUser.email)
      setResetSent(true)
      toast('Correo enviado para cambiar contraseña')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
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
      } else if (err.code === 'auth/popup-closed-by-user') {
        // dismissed
      } else {
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

  const displayName =
    userProfile?.nombreMostrar || userProfile?.username || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  const inputCls =
    'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-slate-50'

  return (
    <TeacherLayout>
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
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
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoUploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md disabled:opacity-60"
            >
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
            <User size={17} className="text-slate-400" />
            Nombre
          </h2>
          <form onSubmit={handleSaveNombre} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre completo
              </label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className={inputCls}
                placeholder="Ej. Profa. García Pérez"
              />
              <p className="text-xs text-slate-400 mt-1">Así te verán tus alumnos</p>
            </div>
            <button
              type="submit"
              disabled={savingNombre}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingNombre ? <Spinner size="sm" /> : null}
              {savingNombre ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </form>
        </div>

        {/* Acceso */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Lock size={17} className="text-slate-400" />
            Acceso
          </h2>
          <div className="space-y-4">
            {/* Username — read only */}
            <div className="flex items-center gap-3 py-2 border-b border-slate-100">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 mb-0.5">Usuario</p>
                <p className="text-sm font-semibold font-mono text-slate-900">
                  {userProfile?.username || '—'}
                </p>
              </div>
            </div>

            {/* Email + verification */}
            <div className="flex items-center gap-3 py-2 border-b border-slate-100">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 mb-0.5">Correo</p>
                <p className="text-sm text-slate-900 truncate">{currentUser?.email}</p>
                {currentUser?.emailVerified ? (
                  <p className="text-xs text-emerald-500 flex items-center gap-1 mt-0.5">
                    <Check size={10} /> Verificado
                  </p>
                ) : (
                  <p className="text-xs text-amber-500 mt-0.5">Sin verificar</p>
                )}
              </div>
            </div>

            {/* Password reset */}
            <div className="flex items-start gap-3 py-2 border-b border-slate-100">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Contraseña</p>
                <p className="text-xs text-slate-400 mt-0.5">Recibirás un correo para cambiarla</p>
              </div>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetSent}
                className="text-blue-600 text-sm font-semibold hover:underline disabled:opacity-50 flex-shrink-0"
              >
                {resetSent ? 'Enviado ✓' : 'Cambiar'}
              </button>
            </div>

            {/* Google linking */}
            <div className="flex items-center gap-3 py-2">
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
                <button
                  type="button"
                  onClick={handleUnlinkGoogle}
                  className="flex items-center gap-1.5 text-slate-400 hover:text-red-500 text-xs font-medium transition-colors flex-shrink-0"
                >
                  <Unlink size={13} /> Desvincular
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLinkGoogle}
                  disabled={linkingGoogle}
                  className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-xs font-semibold transition-colors disabled:opacity-60 flex-shrink-0"
                >
                  {linkingGoogle ? <Spinner size="sm" /> : <LinkIcon size={13} />}
                  Vincular
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full py-3 border border-red-200 text-red-500 rounded-xl font-semibold hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={18} /> Cerrar sesión
        </button>
      </div>
    </TeacherLayout>
  )
}
