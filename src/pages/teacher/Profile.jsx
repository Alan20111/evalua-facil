import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import ConfirmModal from '../../components/ConfirmModal'
import PasswordInput from '../../components/PasswordInput'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { Camera, Lock, User, Sparkles, School, Trash2 } from 'lucide-react'
import SchoolPicker from '../../components/SchoolPicker'
import useCreditosIA from '../../hooks/useCreditosIA'
import ComprarCreditosModal from '../../components/ComprarCreditosModal'
import ActivarCreditosModal from '../../components/ActivarCreditosModal'
import { useBackHandler } from '../../hooks/useBackHandler'
import AvatarCropModal from '../../components/AvatarCropModal'
import { useScrollLock } from '../../hooks/useScrollLock'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'
import { errorCodigoPostal, soloDigitosCP } from '../../utils/codigoPostal'
import { useUbicacionCP } from '../../data/useCodigoPostal'
import CodigoPostalField from '../../components/CodigoPostalField'
import EliminarCuentaModal from '../../components/EliminarCuentaModal'
import { PREFIJOS } from '../../utils/prefijos'
import { capitalizarNombre } from '../../utils/nombres'
import Select from '../../components/ui/Select'
import InfoDisclosure from '../../components/ui/InfoDisclosure'

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
  'w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface'

// El espacio para subir la foto mide distinto en la web y en la app — pedido
// explícito, y por eso el perfil (que es la misma pantalla en las dos) tiene
// que preguntar por IS_NATIVE_APP igual que ya lo hacen los dashboards.
// Mismos números que en el perfil del estudiante (student/Profile.jsx).
const FOTO = IS_NATIVE_APP ? 'w-24 h-24' : 'w-16 h-16'       // 96px en app, 64px en web
const FOTO_INICIAL = IS_NATIVE_APP ? 'text-3xl' : 'text-2xl'

export default function Profile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  // Display name
  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  const [savingNombre, setSavingNombre] = useState(false)

  // Prefijo del nombre visible (opcional) — el <select> guarda uno de los
  // valores predefinidos, '' (sin prefijo) o '__otro__' (texto libre en
  // prefijoCustom). Si el prefijo guardado no está en la lista, se carga
  // como "Otro…" con su texto ya escrito.
  const initialPrefijo = userProfile?.prefijo || ''
  const [prefijoOption, setPrefijoOption] = useState(
    initialPrefijo === '' || PREFIJOS.includes(initialPrefijo) ? initialPrefijo : '__otro__'
  )
  const [prefijoCustom, setPrefijoCustom] = useState(
    initialPrefijo && !PREFIJOS.includes(initialPrefijo) ? initialPrefijo : ''
  )

  // Datos personales (nombre real, distinto del nombre visible/alias)
  const [realNombre, setRealNombre] = useState(userProfile?.nombre || '')
  const [apellidoPaterno, setApellidoPaterno] = useState(userProfile?.apellidoPaterno || '')
  const [apellidoMaterno, setApellidoMaterno] = useState(userProfile?.apellidoMaterno || '')
  const [codigoPostal, setCodigoPostal] = useState(userProfile?.codigoPostal || '')
  const { ubicacion: ubicacionCP, buscando: buscandoCP } = useUbicacionCP(codigoPostal)
  const [savingDatosPersonales, setSavingDatosPersonales] = useState(false)

  // Photo
  const [photoUploading, setPhotoUploading] = useState(false)
  const [cropFile, setCropFile] = useState(null) // File recién elegido, pendiente de recortar

  // School — el selector completo (catálogo, escuelas parecidas, alta manual)
  // vive en components/SchoolPicker.jsx: es el MISMO que usan el registro y el
  // onboarding, para no mantener tres copias del mismo flujo. Ya no ofrece
  // "Sin escuela": todo docente pertenece a una escuela (ver utils/escuela.js).
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const [savingSchool, setSavingSchool] = useState(false)

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
  useBackHandler(() => setConfirm(null), !!confirm)
  useScrollLock(!!confirm)

  // Cancelar suscripción / eliminar cuenta
  const [showEliminarCuenta, setShowEliminarCuenta] = useState(false)
  useBackHandler(() => setShowEliminarCuenta(false), showEliminarCuenta)

  // Créditos IA (modelo de créditos puros, 20-ago-2026) — ver CreditosPanel
  // para el detalle completo; aquí solo un resumen con acceso a comprar más.
  const creditosIA = useCreditosIA()
  const [showComprarCreditos, setShowComprarCreditos] = useState(false)
  const [showActivarCreditos, setShowActivarCreditos] = useState(false)

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
  // Pedido explícito: en vez de subir el archivo tal cual, se abre el
  // recortador (acercar/alejar con la rueda, arrastrar) y solo se sube lo
  // que quede dentro del círculo — ver AvatarCropModal.jsx.
  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCropFile(file)
    e.target.value = '' // permite volver a elegir el MISMO archivo después de cancelar
  }

  async function handleCropConfirm(croppedFile) {
    setPhotoUploading(true)
    try {
      const url = await uploadAvatar(croppedFile)
      await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url })
      setUserProfile((p) => ({ ...p, photoURL: url }))
      setCropFile(null)
      toast('Foto actualizada')
    } catch (err) {
      toast('Error al subir foto: ' + err.message, 'error')
    } finally {
      setPhotoUploading(false)
    }
  }

  // Ambos botones de guardar se apagan cuando no hay nada distinto a lo ya
  // guardado — comparar contra `userProfile` en vivo (no una copia tomada al
  // montar) hace que, justo después de guardar, el botón vuelva a apagarse
  // solo: userProfile ya trae el valor nuevo, así que "sin cambios" vuelve a
  // ser cierto hasta que el docente edite algo de nuevo.
  const prefijoActual = prefijoOption === '__otro__' ? prefijoCustom.trim() : prefijoOption
  const nombreChanged =
    nombre.trim() !== (userProfile?.nombreMostrar || '') ||
    prefijoActual !== (userProfile?.prefijo || '')
  const datosPersonalesChanged =
    realNombre.trim() !== (userProfile?.nombre || '') ||
    apellidoPaterno.trim() !== (userProfile?.apellidoPaterno || '') ||
    apellidoMaterno.trim() !== (userProfile?.apellidoMaterno || '') ||
    codigoPostal !== (userProfile?.codigoPostal || '')

  async function handleSaveNombre(e) {
    e.preventDefault()
    setSavingNombre(true)
    const prefijo = prefijoOption === '__otro__' ? prefijoCustom.trim() : prefijoOption
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { nombreMostrar: nombre.trim(), prefijo })
      setUserProfile((p) => ({ ...p, nombreMostrar: nombre.trim(), prefijo }))
      toast('Nombre actualizado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingNombre(false)
    }
  }

  async function handleSaveDatosPersonales(e) {
    e.preventDefault()
    if (!realNombre.trim() || !apellidoPaterno.trim()) { toast('Escribe tu nombre y apellido paterno', 'error'); return }
    // El código postal se puede cambiar (mudanza), pero no se puede dejar
    // vacío ni inventado — mismo criterio que en el registro.
    if (buscandoCP) { toast('Espera un momento, estamos buscando tu código postal', 'warning'); return }
    const errorCP = errorCodigoPostal(codigoPostal, ubicacionCP)
    if (errorCP) { toast(errorCP, 'error'); return }
    setSavingDatosPersonales(true)
    try {
      const updates = {
        nombre: realNombre.trim(),
        apellidoPaterno: apellidoPaterno.trim(),
        apellidoMaterno: apellidoMaterno.trim(),
        codigoPostal: soloDigitosCP(codigoPostal),
        estado: ubicacionCP.estado,
        municipio: ubicacionCP.municipio,
        ciudad: ubicacionCP.ciudad,
      }
      await updateDoc(doc(db, 'users', currentUser.uid), updates)
      setUserProfile((p) => ({ ...p, ...updates }))
      toast('Datos personales actualizados')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingDatosPersonales(false)
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

  const displayName = capitalizarNombre(userProfile?.nombreMostrar) || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()

  return (
    <>
      <div className={`px-4 py-4 space-y-4 ${TEACHER_CONTAINER_NARROW}`}>

        {/* Créditos IA — modelo de créditos puros sin caducidad (20-ago-2026).
            Todo lo demás de la plataforma es gratis para cualquier docente;
            aquí solo vive lo relacionado con IA. */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <Sparkles size={19} className="text-slate-400" /> Créditos de IA
          </h2>
          {!creditosIA.listo ? (
            <div className="flex justify-center py-2"><Spinner /></div>
          ) : (
            <div className="space-y-2">
              <p className="text-2xl font-bold text-accent tabular-nums">{creditosIA.saldo}</p>
              <p className="text-sm text-muted">
                Usa tus créditos para las funciones de Inteligencia Artificial. Los créditos adquiridos no caducan ni se resetean.
              </p>
              {creditosIA.mostrarCTAActivarBienvenida && (
                <p className="text-sm text-accent font-medium">
                  🎁 Tienes 30 créditos de IA de regalo disponibles.
                </p>
              )}
            </div>
          )}
          {creditosIA.mostrarCTAActivarBienvenida && (
            <button
              type="button"
              onClick={() => setShowActivarCreditos(true)}
              className="mt-3 w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded text-sm transition-colors"
            >
              Activar mis 30 créditos de regalo
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowComprarCreditos(true)}
            className={`mt-2 w-full py-2 font-semibold rounded text-sm transition-colors ${
              creditosIA.mostrarCTAActivarBienvenida
                ? 'border border-outline-variant text-muted hover:bg-surface'
                : 'bg-accent hover:bg-accent-hover text-white'
            }`}
          >
            Comprar créditos
          </button>
        </div>

        <ComprarCreditosModal open={showComprarCreditos} onClose={() => setShowComprarCreditos(false)} />
        <ActivarCreditosModal open={showActivarCreditos} onClose={() => setShowActivarCreditos(false)} />

        {cropFile && (
          <AvatarCropModal
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onConfirm={handleCropConfirm}
            saving={photoUploading}
          />
        )}

        {/* Photo + identity */}
        <div className="bg-surface-card rounded-card shadow-card p-4 flex flex-col items-center gap-2">
          <div className="relative">
            {/* Mismo tamaño que en el perfil del estudiante. Si aquí se viera
                más grande que allá, el docente daría por hecho que así de
                grande lo ven sus alumnos, y no es cierto: en la pantalla del
                alumno su foto mide 48px. */}
            <div className={`${FOTO} rounded-full bg-accent-light overflow-hidden flex items-center justify-center`}>
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className={`${FOTO_INICIAL} font-bold text-accent`}>{initials}</span>
              )}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoUploading} aria-label="Cambiar foto"
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-accent rounded-full flex items-center justify-center text-white shadow-md disabled:opacity-60">
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
          {/* Ausente/true = visible (opt-out), igual criterio que el resto de
              interruptores de la app — para que no aparezca "apagada" por
              defecto en cuentas viejas que nunca tocaron este ajuste. */}
          <label className="flex items-center gap-2 mt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={userProfile?.mostrarFotoAlumnos !== false}
              onChange={(e) => {
                const checked = e.target.checked
                setUserProfile((p) => ({ ...p, mostrarFotoAlumnos: checked }))
                updateDoc(doc(db, 'users', currentUser.uid), { mostrarFotoAlumnos: checked })
                  .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
              }}
            />
            <span className="text-sm text-on-surface">Los estudiantes pueden ver mi foto de perfil</span>
          </label>
        </div>

        {/* Acceso — correo y contraseña, cerca de arriba: es lo que más se
            busca (cambiar la contraseña) y antes quedaba hasta el fondo. */}
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
                    className="text-accent text-sm font-semibold hover:underline flex-shrink-0">
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
                  {/* No hay "original" con qué comparar una contraseña (vive
                      hasheada) — aquí "nada que guardar" es que los campos
                      todavía no formen una combinación válida para enviar,
                      las mismas reglas que ya revisa requestPwdChange al
                      hacer clic. */}
                  <button type="submit" disabled={savingPwd || !currentPwd || newPwd.length < 6 || newPwd !== confirmPwd}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingPwd ? <Spinner size="sm" /> : <Lock size={17} />}
                    {savingPwd ? 'Actualizando…' : 'Cambiar contraseña'}
                  </button>
                </form>
              )}
            </div>

          </div>
        </div>

        {/* Datos personales — nombre real, distinto del nombre visible/alias */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <User size={19} className="text-slate-400" /> Datos personales
          </h2>
          <form onSubmit={handleSaveDatosPersonales} className="space-y-2">
            <div>
              <label htmlFor="prof-real-nombre" className="block text-xs font-medium text-muted mb-1">Nombre(s)</label>
              <input id="prof-real-nombre" type="text" value={realNombre} onChange={(e) => setRealNombre(e.target.value)}
                className={inputCls} placeholder="Ej. Laura" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="prof-apellido-paterno" className="block text-xs font-medium text-muted mb-1">Apellido paterno</label>
                <input id="prof-apellido-paterno" type="text" value={apellidoPaterno} onChange={(e) => setApellidoPaterno(e.target.value)}
                  className={inputCls} placeholder="Ej. García" />
              </div>
              <div className="flex-1">
                <label htmlFor="prof-apellido-materno" className="block text-xs font-medium text-muted mb-1">Apellido materno</label>
                <input id="prof-apellido-materno" type="text" value={apellidoMaterno} onChange={(e) => setApellidoMaterno(e.target.value)}
                  className={inputCls} placeholder="Ej. Pérez" />
              </div>
            </div>
            <CodigoPostalField
              id="prof-cp"
              value={codigoPostal}
              onChange={setCodigoPostal}
            />
            <button type="submit" disabled={savingDatosPersonales || !datosPersonalesChanged}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingDatosPersonales ? <Spinner size="sm" /> : null}
              {savingDatosPersonales ? 'Guardando…' : 'Guardar datos personales'}
            </button>
          </form>
        </div>

        {/* Nombre visible */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <User size={19} className="text-slate-400" /> Nombre visible
          </h2>
          <p className="text-sm text-muted -mt-1 mb-2">Así te verán tus estudiantes — puede ser distinto a tu nombre real.</p>
          <form onSubmit={handleSaveNombre} className="space-y-2">
            <div className="flex gap-2 items-start">
              <div className="w-32 sm:w-36 flex-shrink-0">
                <Select
                  id="prof-prefijo"
                  label="Prefijo"
                  hint="(opcional)"
                  value={prefijoOption}
                  onChange={setPrefijoOption}
                  options={[
                    { value: '', label: 'Sin prefijo (predeterminado)' },
                    ...PREFIJOS.map((p) => ({ value: p, label: p })),
                    { value: '__otro__', label: 'Otro… (escríbelo)' },
                  ]}
                />
                {prefijoOption === '__otro__' && (
                  <input type="text" value={prefijoCustom} onChange={(e) => setPrefijoCustom(e.target.value)}
                    className={`${inputCls} mt-2`} placeholder="Escribe el prefijo" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <label htmlFor="prof-nombre" className="block text-xs font-medium text-muted mb-1">Nombre</label>
                <input id="prof-nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
                  className={inputCls} placeholder="Ej. Profa. García Pérez" />
              </div>
            </div>
            <button type="submit" disabled={savingNombre || !nombreChanged}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
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
              <InfoDisclosure className="mt-0.5">
                <p className="text-sm text-slate-500">Los docentes de la misma escuela comparten el mismo registro — pero cada quien da de alta a sus propios alumnos por separado.</p>
              </InfoDisclosure>
            </div>
            <button type="button" onClick={() => setShowSchoolPicker(true)}
              className="text-accent text-sm font-semibold hover:underline flex-shrink-0">Cambiar</button>
          </div>
        </div>

        {/* Aviso de privacidad */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <Link to="/privacidad" className="text-sm text-accent font-semibold hover:underline">
            Aviso de privacidad
          </Link>
          <p className="text-xs text-muted mt-1">v.1.0.1</p>
        </div>

        {/* Eliminar cuenta — hasta el fondo y en rojo, la única parte de la
            app que no usa el azul del docente: es lo que la separa de todo lo
            demás que se puede tocar sin miedo. */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <Trash2 size={19} className="text-slate-400" /> Eliminar mi cuenta
          </h2>
          <InfoDisclosure className="mb-2">
            <p className="text-sm text-muted">
              Borra para siempre tu cuenta y todo tu trabajo: asignaturas, estudiantes, actividades,
              calificaciones y asistencias. No se puede deshacer.
            </p>
          </InfoDisclosure>
          <button
            type="button"
            onClick={() => setShowEliminarCuenta(true)}
            className="w-full py-2 rounded border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
          >
            Eliminar mi cuenta
          </button>
        </div>

      </div>

      {showEliminarCuenta && <EliminarCuentaModal onClose={() => setShowEliminarCuenta(false)} />}

      {/* ── Confirmation modal ── */}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          busy={confirming}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Selector de escuela — componente compartido con Register/Onboarding */}
      {showSchoolPicker && (
        <SchoolPicker
          saving={savingSchool}
          onSelect={updateSchool}
          onClose={() => !savingSchool && setShowSchoolPicker(false)}
        />
      )}
    </>
  )
}
