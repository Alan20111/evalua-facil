import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut, sendPasswordResetEmail } from 'firebase/auth'
import { doc, updateDoc, getDocs, query, collection, where, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { Camera, Check, LogOut, Mail, Lock, School, User } from 'lucide-react'
import { usePlanteles, findPlantel } from '../../data/usePlanteles'

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

  const [username, setUsername] = useState(
    userProfile?.username || userProfile?.nombre || ''
  )
  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  const [savingInfo, setSavingInfo] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [cct, setCct] = useState(userProfile?.claveSEP || '')
  const [savingPlantel, setSavingPlantel] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()

  const cctMatch = useMemo(() => findPlantel(planteles, cct), [planteles, cct])

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

  async function handleSaveInfo(e) {
    e.preventDefault()
    if (!username.trim()) {
      toast('El nombre de usuario es requerido', 'error')
      return
    }
    setSavingInfo(true)
    try {
      const updates = {
        username: username.trim(),
        nombre: username.trim(),
      }
      if (nombre.trim()) updates.nombreMostrar = nombre.trim()
      await updateDoc(doc(db, 'users', currentUser.uid), updates)
      setUserProfile((p) => ({ ...p, ...updates }))
      toast('Perfil actualizado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingInfo(false)
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

  async function handleSavePlantel(e) {
    e.preventDefault()
    if (!cctMatch) {
      toast('CCT no encontrado en el catálogo', 'error')
      return
    }
    setSavingPlantel(true)
    try {
      const schoolSnap = await getDocs(
        query(collection(db, 'schools'), where('claveSEP', '==', cctMatch.cct))
      )
      let schoolId
      if (!schoolSnap.empty) {
        schoolId = schoolSnap.docs[0].id
      } else {
        const newRef = doc(collection(db, 'schools'))
        await setDoc(newRef, {
          claveSEP: cctMatch.cct,
          nombre: cctMatch.nombre,
          shortName: cctMatch.short,
          subsistema: cctMatch.sub,
          municipio: cctMatch.mun,
          estado: cctMatch.edo,
        })
        schoolId = newRef.id
      }
      await updateDoc(doc(db, 'users', currentUser.uid), { escuelaId: schoolId })
      setUserProfile((p) => ({
        ...p,
        escuelaId: schoolId,
        schoolName: cctMatch.nombre,
        claveSEP: cctMatch.cct,
      }))
      toast('Plantel actualizado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingPlantel(false)
    }
  }

  const handleLogout = async () => {
    await signOut(auth)
    navigate('/')
  }

  const displayName =
    userProfile?.nombreMostrar || userProfile?.username || userProfile?.nombre || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  const inputCls =
    'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50'

  return (
    <TeacherLayout>
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        {/* Photo + identity */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-indigo-100 overflow-hidden flex items-center justify-center">
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-indigo-600">{initials}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoUploading}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-md disabled:opacity-60"
            >
              {photoUploading ? <Spinner size="sm" /> : <Camera size={13} />}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoChange}
          />
          <div className="text-center">
            <p className="font-bold text-slate-900">{displayName}</p>
            <p className="text-sm text-slate-400">{currentUser?.email}</p>
            {userProfile?.schoolName && (
              <p className="text-xs text-slate-400 mt-0.5">{userProfile.schoolName}</p>
            )}
          </div>
        </div>

        {/* Información personal */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <User size={17} className="text-slate-400" />
            Información personal
          </h2>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre de usuario <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className={inputCls}
                placeholder="Ej. García Pérez Juan"
              />
              <p className="text-xs text-slate-400 mt-1">
                Así aparecerás para tus alumnos
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre visible{' '}
                <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className={inputCls}
                placeholder="Ej. Profa. García"
              />
            </div>
            <button
              type="submit"
              disabled={savingInfo}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingInfo ? <Spinner size="sm" /> : null}
              {savingInfo ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </form>
        </div>

        {/* Seguridad */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Lock size={17} className="text-slate-400" />
            Seguridad
          </h2>
          <div className="space-y-4">
            {/* Email */}
            <div className="flex items-center gap-3">
              <Mail size={18} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {currentUser?.email}
                </p>
                {currentUser?.emailVerified ? (
                  <p className="text-xs text-emerald-500 flex items-center gap-1">
                    <Check size={10} /> Verificado
                  </p>
                ) : (
                  <p className="text-xs text-amber-500">Sin verificar</p>
                )}
              </div>
            </div>

            {/* Password reset */}
            <div className="border-t border-slate-100 pt-4 flex items-start gap-3">
              <Lock size={18} className="text-slate-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Contraseña</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Recibirás un correo para crear una nueva contraseña
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetSent}
                className="text-indigo-600 text-sm font-semibold hover:underline disabled:opacity-50 flex-shrink-0"
              >
                {resetSent ? 'Enviado ✓' : 'Cambiar'}
              </button>
            </div>
          </div>
        </div>

        {/* Plantel */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <School size={17} className="text-slate-400" />
            Plantel
          </h2>
          <form onSubmit={handleSavePlantel} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                CCT del plantel
              </label>
              <input
                type="text"
                value={cct}
                onChange={(e) => setCct(e.target.value.toUpperCase())}
                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 text-sm font-mono transition-colors ${
                  cctMatch
                    ? 'border-emerald-300 focus:ring-emerald-500 bg-emerald-50'
                    : 'border-slate-200 focus:ring-indigo-500 bg-slate-50'
                }`}
                placeholder="Ej. 11ECT0001X"
              />
              {cctMatch ? (
                <p className="text-emerald-600 text-xs mt-1.5 flex items-start gap-1">
                  <Check size={12} className="mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>{cctMatch.short}</strong> · {cctMatch.nombre} — {cctMatch.mun}, {cctMatch.edo}
                  </span>
                </p>
              ) : catalogLoading && cct.length >= 5 ? (
                <p className="text-slate-400 text-xs mt-1.5">Cargando catálogo de planteles…</p>
              ) : cct.length >= 5 ? (
                <p className="text-amber-600 text-xs mt-1.5">
                  CCT no encontrado en el catálogo
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={savingPlantel || !cctMatch}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingPlantel ? <Spinner size="sm" /> : null}
              {savingPlantel ? 'Guardando…' : 'Guardar plantel'}
            </button>
          </form>
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
