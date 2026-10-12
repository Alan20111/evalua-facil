import { useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { syncPublicProfile } from '../../utils/publicProfile'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import ConfirmModal from '../../components/ConfirmModal'
import PasswordInput from '../../components/PasswordInput'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { Camera, Lock, User, Sparkles, School, Trash2, Settings, Bell, BookOpen, ShieldCheck } from 'lucide-react'
import { Tabs, SubTabs, ListRow, ListGroup, FlechaFila, FILA_LISTA, Button, Checkbox, Input } from '../../components/ui'
import AppQRButton from '../../components/AppQRButton'
import CanalYouTubeLink from '../../components/CanalYouTubeLink'
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
import { uploadToCloudinary } from '../../utils/cloudinary'
import EliminarCuentaModal from '../../components/EliminarCuentaModal'
import AppVersionInfo from '../../components/AppVersionInfo'
import { PREFIJOS } from '../../utils/prefijos'
import { capitalizarNombre } from '../../utils/nombres'
import Select from '../../components/ui/Select'
import InfoDisclosure from '../../components/ui/InfoDisclosure'
import { SkeletonText } from '../../components/ui'
import YouTubeIcon from '../../components/YouTubeIcon'
import { ICONO } from '../../config/iconos'


// El espacio para subir la foto mide distinto en la web y en la app — pedido
// explícito, y por eso el perfil (que es la misma pantalla en las dos) tiene
// que preguntar por IS_NATIVE_APP igual que ya lo hacen los dashboards.
// Mismos números que en el perfil del estudiante (student/Profile.jsx).
const FOTO = IS_NATIVE_APP ? 'w-24 h-24' : 'w-16 h-16'       // 96px en app, 64px en web
const FOTO_INICIAL = IS_NATIVE_APP ? 'text-3xl' : 'text-2xl'

const SECCIONES = [
  { value: 'perfil', label: 'Perfil', icon: User },
  { value: 'ia', label: 'Créditos IA', icon: Sparkles },
  { value: 'ajustes', label: 'Ajustes', icon: Settings },
]
const SUBSECCIONES = [
  { value: 'datos', label: 'Datos' },
  { value: 'escuela', label: 'Escuela' },
  { value: 'cuenta', label: 'Cuenta' },
]
// Enlaces de la versión anterior (cinco pestañas sueltas) siguen sirviendo.
const ANTIGUAS = { escuela: ['perfil', 'escuela'], cuenta: ['perfil', 'cuenta'], acerca: ['ajustes'] }

export default function Profile() {
  const [params, setParams] = useSearchParams()
  const [secURL, subURL] = ANTIGUAS[params.get('seccion')] || [params.get('seccion'), params.get('sub')]
  const seccion = SECCIONES.some((x) => x.value === secURL) ? secURL : 'perfil'
  const sub = SUBSECCIONES.some((x) => x.value === subURL) ? subURL : 'datos'
  const elegir = (sec, sb = 'datos') => setParams(
    sec === 'perfil' ? (sb === 'datos' ? {} : { sub: sb }) : { seccion: sec },
    { replace: true },
  )
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
      const url = await uploadToCloudinary(croppedFile, 'evalua-facil/avatars')
      await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: url })
      await syncPublicProfile(currentUser.uid, { photoURL: url })
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
      await syncPublicProfile(currentUser.uid, { nombreMostrar: nombre.trim(), prefijo })
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
      // nombre is the public fallback name — sync to publicProfiles
      await syncPublicProfile(currentUser.uid, { nombre: updates.nombre })
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

        {/* Tres pestañas (oct-2026): Perfil reúne quién eres, tu escuela y tu
            acceso, separados por subpestañas; Créditos IA aparte; y Ajustes
            junta lo que antes solo estaba en el submenú «Ajustes y ayuda» de
            la barra lateral. Viven en la URL (?seccion=&sub=). */}
        <Tabs options={SECCIONES} value={seccion} onChange={(id) => elegir(id)} label="Secciones de la cuenta" />

        <div key={seccion} role="tabpanel" className="space-y-4 animate-pagina motion-reduce:animate-none">
          {seccion === 'perfil' && (<>
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
                  className="absolute -bottom-1 -right-1 size-7 bg-accent rounded-full flex items-center justify-center text-white shadow-lg transition active:scale-[0.94] disabled:opacity-60">
                  {photoUploading ? <Spinner size="sm" current /> : <Camera size={ICONO.xs} />}
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
              <div className="text-center">
                <p className="font-bold text-on-surface">{displayName}</p>
                {userProfile?.schoolName && (
                  <p className="text-sm text-muted mt-1">{userProfile.schoolName}</p>
                )}
              </div>
              {/* Ausente/true = visible (opt-out), igual criterio que el resto de
                  interruptores de la app — para que no aparezca "apagada" por
                  defecto en cuentas viejas que nunca tocaron este ajuste. */}
              <Checkbox
                wrapperClassName="mt-1"
                label="Los estudiantes pueden ver mi foto de perfil"
                checked={userProfile?.mostrarFotoAlumnos !== false}
                onChange={(e) => {
                    const checked = e.target.checked
                    setUserProfile((p) => ({ ...p, mostrarFotoAlumnos: checked }))
                    updateDoc(doc(db, 'users', currentUser.uid), { mostrarFotoAlumnos: checked })
                      .then(() => syncPublicProfile(currentUser.uid, { mostrarFotoAlumnos: checked }))
                      .catch(() => toast('No se pudo guardar: intenta de nuevo', 'error'))
                  }}
              />
            </div>

            <SubTabs options={SUBSECCIONES} value={sub} onChange={(id) => elegir('perfil', id)} label="Partes del perfil" />

            <div key={sub} role="tabpanel" className="space-y-4 animate-aparece motion-reduce:animate-none">
              {sub === 'datos' && (<>
              {/* Nombre visible */}
              <div className="bg-surface-card rounded-card shadow-card p-3">
                <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <User size={ICONO.md} className="text-hint" /> Nombre visible
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
                        <Input type="text" value={prefijoCustom} onChange={(e) => setPrefijoCustom(e.target.value)}
                          className="mt-2" aria-label="Escribe el prefijo" />
                      )}
                    </div>
                    <Input label="Nombre" wrapperClassName="flex-1 min-w-0" id="prof-nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                  </div>
                  <Button type="submit" fullWidth busy={savingNombre} disabled={savingNombre || !nombreChanged}>
                    {savingNombre ? 'Guardando…' : 'Guardar nombre'}
                  </Button>
                </form>
              </div>


              {/* Datos personales — nombre real, distinto del nombre visible/alias */}
              <div className="bg-surface-card rounded-card shadow-card p-3">
                <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <User size={ICONO.md} className="text-hint" /> Datos personales
                </h2>
                <form onSubmit={handleSaveDatosPersonales} className="space-y-2">
                  <Input label="Nombre(s)" id="prof-real-nombre" type="text" value={realNombre} onChange={(e) => setRealNombre(e.target.value)} />
                  <div className="flex gap-2">
                    <Input label="Apellido paterno" wrapperClassName="flex-1" id="prof-apellido-paterno" type="text" value={apellidoPaterno} onChange={(e) => setApellidoPaterno(e.target.value)} />
                    <Input label="Apellido materno" wrapperClassName="flex-1" id="prof-apellido-materno" type="text" value={apellidoMaterno} onChange={(e) => setApellidoMaterno(e.target.value)} />
                  </div>
                  <CodigoPostalField
                    id="prof-cp"
                    value={codigoPostal}
                    onChange={setCodigoPostal}
                  />
                  <Button type="submit" fullWidth busy={savingDatosPersonales} disabled={savingDatosPersonales || !datosPersonalesChanged}>
                    {savingDatosPersonales ? 'Guardando…' : 'Guardar datos personales'}
                  </Button>
                </form>
              </div>
              </>)}
              {sub === 'escuela' && (<>
              {/* Escuela */}
              <div className="bg-surface-card rounded-card shadow-card p-3">
                <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <School size={ICONO.md} className="text-hint" /> Escuela
                </h2>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{userProfile?.schoolName || 'Sin escuela'}</p>
                    <InfoDisclosure className="mt-0.5">
                      <p className="text-sm text-muted">Los docentes de la misma escuela comparten el mismo registro — pero cada quien da de alta a sus propios alumnos por separado.</p>
                    </InfoDisclosure>
                  </div>
                  <Button variant="link" className="flex-shrink-0 font-semibold" onClick={() => setShowSchoolPicker(true)}>Cambiar</Button>
                </div>
              </div>
              </>)}
              {sub === 'cuenta' && (<>
              {/* Acceso — correo y contraseña, cerca de arriba: es lo que más se
                  busca (cambiar la contraseña) y antes quedaba hasta el fondo. */}
              <div className="bg-surface-card rounded-card shadow-card p-3">
                <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <Lock size={ICONO.md} className="text-hint" /> Acceso
                </h2>
                <div className="space-y-1">

                  {/* ── Correo (solo lectura) ── */}
                  <div className="py-2 border-b border-outline-variant">
                    <p className="text-sm text-muted mb-0.5">Correo electrónico</p>
                    <p className="text-sm text-on-surface truncate">{currentUser?.email}</p>
                  </div>

                  {/* ── Contraseña ── */}
                  <div className="py-2 border-b border-outline-variant">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-on-surface">Contraseña</p>
                        {!hasEmailProvider && (
                          <p className="text-sm text-muted mt-0.5">Solo disponible si tu cuenta usa correo y contraseña</p>
                        )}
                      </div>
                      {hasEmailProvider && (
                        <Button variant="link" className="flex-shrink-0 font-semibold" aria-expanded={showPwdForm} onClick={() => setShowPwdForm((v) => !v)}>
                          {showPwdForm ? 'Cancelar' : 'Cambiar'}
                        </Button>
                      )}
                    </div>

                    {showPwdForm && (
                      <form onSubmit={requestPwdChange} className="mt-2 space-y-2 animate-aparece motion-reduce:animate-none">
                        <PasswordInput
                          label="Contraseña actual" id="prof-pwd-actual" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)}
                          required autoComplete="current-password" />
                        <PasswordInput
                          label="Nueva contraseña" id="prof-pwd-nueva" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                          required autoComplete="new-password" />
                        <PasswordInput
                          label="Confirmar nueva contraseña" id="prof-pwd-confirmar" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                          required autoComplete="new-password" />
                        {/* No hay "original" con qué comparar una contraseña (vive
                            hasheada) — aquí "nada que guardar" es que los campos
                            todavía no formen una combinación válida para enviar,
                            las mismas reglas que ya revisa requestPwdChange al
                            hacer clic. */}
                        <Button fullWidth icon={Lock} busy={savingPwd} type="submit" disabled={savingPwd || !currentPwd || newPwd.length < 6 || newPwd !== confirmPwd}>
                          
                          {savingPwd ? 'Actualizando…' : 'Cambiar contraseña'}
                        </Button>
                      </form>
                    )}
                  </div>

                </div>
              </div>


              {/* Eliminar cuenta — hasta el fondo y en rojo, la única parte de la
                  app que no usa el azul del docente: es lo que la separa de todo lo
                  demás que se puede tocar sin miedo. */}
              <div className="bg-surface-card rounded-card shadow-card p-3">
                <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                  <Trash2 size={ICONO.md} className="text-hint" /> Eliminar mi cuenta
                </h2>
                <InfoDisclosure className="mb-2">
                  <p className="text-sm text-muted">
                    Borra para siempre tu cuenta y todo tu trabajo: asignaturas, estudiantes, actividades,
                    calificaciones y asistencias. No se puede deshacer.
                  </p>
                </InfoDisclosure>
                <Button variant="danger-outline" fullWidth
                  onClick={() => setShowEliminarCuenta(true)}
                 
                >
                  Eliminar mi cuenta
                </Button>
              </div>
              </>)}
            </div>
          </>)}
          {seccion === 'ia' && (<>
            {/* Créditos IA — modelo de créditos puros sin caducidad (20-ago-2026).
                Todo lo demás de la plataforma es gratis para cualquier docente;
                aquí solo vive lo relacionado con IA. */}
            <div className="bg-surface-card rounded-card shadow-card p-3">
              <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
                <Sparkles size={ICONO.md} className="text-hint" /> Créditos de IA
              </h2>
              {!creditosIA.listo ? (
                <SkeletonText lines={2} className="py-2" />
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
                <Button fullWidth className="mt-3"
                  onClick={() => setShowActivarCreditos(true)}
                 
                >
                  Activar mis 30 créditos de regalo
                </Button>
              )}
              <Button
                variant={creditosIA.mostrarCTAActivarBienvenida ? 'secondary' : 'primary'}
                fullWidth
                icon={Sparkles}
                iconEffect="destello"
                className="mt-2"
                onClick={() => setShowComprarCreditos(true)}
              >
                Comprar créditos
              </Button>
            </div>
          </>)}
          {seccion === 'ajustes' && (<>
            <ListGroup title="Herramientas">
              <ListRow to="/perfil-ia" icon={Sparkles} title="Perfil para IA del docente" detail="Necesario para generar planeación y diagnósticos con IA" />
              <AppQRButton className={`group ${FILA_LISTA} [&>svg:first-child]:text-accent`} iconSize={20}>
                <span className="flex-1 font-semibold">QR de Evalúa Fácil</span>
                <FlechaFila />
              </AppQRButton>
              <ListRow to="/notificaciones" icon={Bell} title="Notificaciones" />
            </ListGroup>
            <ListGroup title="Ayuda">
              <ListRow to="/ayuda" icon={BookOpen} title="Ayuda para comenzar" />
              <CanalYouTubeLink className={`group ${FILA_LISTA}`}>
                <YouTubeIcon className="w-5 h-auto flex-shrink-0" />
                <span className="flex-1 font-semibold">Canal de YouTube</span>
                <FlechaFila external />
              </CanalYouTubeLink>
            </ListGroup>
            <ListGroup title="Acerca de">
              <ListRow to="/privacidad" icon={ShieldCheck} title="Aviso de privacidad" />
              <div className="px-3 py-3">
                <AppVersionInfo />
              </div>
            </ListGroup>
          </>)}
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
