import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import StudentLayout from '../../components/StudentLayout'
import { getEnrollments, updateAllEnrollments } from '../../utils/studentLookup'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { ArrowLeft, Camera, Copy, Check, KeyRound, Trash2, UserMinus, AlertTriangle } from 'lucide-react'
import AvatarCropModal from '../../components/AvatarCropModal'
import ConfirmModal from '../../components/ConfirmModal'
import EliminarCuentaAlumnoModal from '../../components/EliminarCuentaAlumnoModal'
import { IS_NATIVE_APP } from '../../utils/platform'

// El espacio para subir la foto mide distinto en la web y en la app — pedido
// explícito, y por eso esta pantalla (que es la misma en las dos) tiene que
// preguntar por IS_NATIVE_APP igual que ya lo hace el dashboard. Mismos
// números que en el perfil del docente (teacher/Profile.jsx).
const FOTO = IS_NATIVE_APP ? 'w-24 h-24' : 'w-16 h-16'       // 96px en app, 64px en web
const FOTO_INICIAL = IS_NATIVE_APP ? 'text-3xl' : 'text-2xl'
const FOTO_CAMARA = IS_NATIVE_APP ? 24 : 18

// Perfil del estudiante — SOLO lo que no vive en otra pantalla (filosofía
// Don't Make Me Think: cero redundancia): identidad + foto, usuario, cambio de
// contraseña y correo de recuperación. Las asignaturas, notificaciones y
// agenda tienen su casa en el dashboard; cerrar sesión, en el layout.
export default function StudentProfile() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const [studentInfo, setStudentInfo] = useState(null)
  const [schoolName, setSchoolName] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [cropFile, setCropFile] = useState(null) // File recién elegido, pendiente de recortar
  const [copied, setCopied] = useState(false)
  // Cambio de contraseña
  const [passActual, setPassActual] = useState('')
  const [passNueva, setPassNueva] = useState('')
  const [passConfirm, setPassConfirm] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  // Mi cuenta
  const [enrollments, setEnrollments] = useState([])
  const [quitandoFoto, setQuitandoFoto] = useState(false)
  const [showEliminar, setShowEliminar] = useState(false)
  const [confirm, setConfirm] = useState(null) // { title, message, confirmLabel, danger, onConfirm }
  const [confirming, setConfirming] = useState(false)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()
  const toast = useToast()
  useBackHandler(() => navigate('/alumno/dashboard'))

  useEffect(() => {
    if (currentUser) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [currentUser])

  async function loadAll() {
    setLoading(true)
    try {
      // Refresca el User de Auth: si el estudiante acaba de confirmar su correo
      // de recuperación desde el enlace, currentUser.email ya trae el real.
      await currentUser.reload().catch(() => {})
      const enrollments = await getEnrollments(currentUser, userProfile)
      setStudentInfo(enrollments[0] || null)
      setEnrollments(enrollments)

      // Nombre de la escuela: igual que StudentLayout, a través del docente de
      // la primera asignatura (refleja SU escuela actual); si no, el doc schools.
      const firstSubjectId = enrollments.find((e) => e.asignaturaId)?.asignaturaId
      const subjSnap = firstSubjectId ? await getDoc(doc(db, 'subjects', firstSubjectId)).catch(() => null) : null
      const docenteId = subjSnap?.exists() ? subjSnap.data().docenteId : null
      if (docenteId) {
        getDoc(doc(db, 'users', docenteId))
          .then((snap) => { if (snap.exists()) setSchoolName(snap.data().schoolName || '') })
          .catch(() => {})
      } else if (enrollments[0]?.escuelaId) {
        getDoc(doc(db, 'schools', enrollments[0].escuelaId))
          .then((snap) => { if (snap.exists()) setSchoolName(snap.data().shortName || snap.data().nombre || '') })
          .catch(() => {})
      }
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Pedido explícito: en vez de subir el archivo tal cual, se abre el
  // recortador (acercar/alejar con la rueda, arrastrar) y solo se sube lo
  // que quede dentro del círculo — ver AvatarCropModal.jsx.
  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file || !currentUser) return
    setCropFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleCropConfirm(croppedFile) {
    setUploadingPhoto(true)
    try {
      const url = await uploadToCloudinary(croppedFile, 'evalua-facil/profiles')
      await updateAllEnrollments(currentUser.uid, { photoURL: url })
      setUserProfile((prev) => ({ ...prev, photoURL: url }))
      setStudentInfo((prev) => (prev ? { ...prev, photoURL: url } : prev))
      setCropFile(null)
      toast('Foto actualizada')
    } catch {
      toast('No se pudo subir la foto', 'error')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handleCopyUsername() {
    const username = studentInfo?.username || userProfile?.username
    if (!username) return
    try {
      await navigator.clipboard.writeText(username)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (passNueva.length < 6) { toast('La contraseña nueva debe tener al menos 6 caracteres', 'error'); return }
    if (passNueva !== passConfirm) { toast('Las contraseñas nuevas no coinciden', 'error'); return }
    setSavingPass(true)
    try {
      // Reautenticación con la contraseña actual — updatePassword la exige si
      // la sesión no es reciente, y de paso confirma que quien cambia la clave
      // es el dueño de la cuenta (no alguien que agarró un teléfono abierto).
      const cred = EmailAuthProvider.credential(currentUser.email, passActual)
      await reauthenticateWithCredential(currentUser, cred)
      await updatePassword(currentUser, passNueva)
      setPassActual(''); setPassNueva(''); setPassConfirm('')
      toast('Contraseña actualizada. Úsala la próxima vez que entres.')
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        toast('La contraseña actual no es correcta', 'error')
      } else if (err.code === 'auth/weak-password') {
        toast('La contraseña nueva es demasiado débil', 'error')
      } else if (err.code === 'auth/too-many-requests') {
        toast('Demasiados intentos. Espera unos minutos e intenta de nuevo.', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingPass(false)
    }
  }

  async function authHeader() {
    const token = await currentUser.getIdToken()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  // ── Sin foto ────────────────────────────────────────────────────────────
  // Se hace en el servidor y no aquí: limpiar el campo solo la quitaría de la
  // vista, el archivo seguiría vivo en Cloudinary con su URL. Ver
  // api/student/remove-photo.js.
  async function quitarFoto() {
    setQuitandoFoto(true)
    try {
      const res = await fetch('/api/student/remove-photo', { method: 'POST', headers: await authHeader() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo quitar la foto')
      setStudentInfo((prev) => (prev ? { ...prev, photoURL: null } : prev))
      setUserProfile((p) => (p ? { ...p, photoURL: null } : p))
      toast('Listo, ya no tienes foto')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setQuitandoFoto(false)
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

  const displayName =
    [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].filter(Boolean).join(' ')
    || [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
    || studentInfo?.username || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  const username = studentInfo?.username || userProfile?.username || ''

  if (loading) return (
    <StudentLayout>
      <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
    </StudentLayout>
  )

  return (
    <StudentLayout>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={handleCropConfirm}
          saving={uploadingPhoto}
        />
      )}

      <div className={`px-4 py-6 ${STUDENT_CONTAINER_NARROW}`}>
        {/* Flechita de regreso visible — respaldo para móviles donde el botón
            físico/gesto de atrás no responde (el hardware ya lo cubre
            useBackHandler arriba). */}
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => navigate('/alumno/dashboard')}
            className="p-2 -ml-2 rounded hover:bg-accent-tint text-muted hover:text-accent transition-colors flex-shrink-0"
            aria-label="Regresar"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-on-surface">Mi perfil</h1>
        </div>

        {/* ── Identidad ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`relative ${FOTO} rounded-full flex-shrink-0 group focus:outline-none`}
            data-tooltip="Cambiar foto"
            aria-label="Cambiar foto"
          >
            <div className={`${FOTO} rounded-full bg-accent-tint overflow-hidden flex items-center justify-center`}>
              {uploadingPhoto ? (
                <Spinner size="sm" />
              ) : photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className={`${FOTO_INICIAL} font-bold text-accent`}>{initials}</span>
              )}
            </div>
            <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <Camera size={FOTO_CAMARA} className="text-white" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-on-surface leading-snug">{displayName}</p>
            {schoolName && <p className="text-sm text-muted truncate mt-0.5">{schoolName}</p>}
            <p className="text-xs text-slate-400 mt-1">Toca la foto para cambiarla</p>
            {/* "Sin foto" solo aparece si hay foto que quitar — un botón para
                borrar algo que no existe nomás hace dudar. */}
            {photoURL && (
              <button
                type="button"
                onClick={() => setConfirm({
                  title: 'Quedarte sin foto',
                  message: 'Se borra tu foto del sistema — no queda guardada en ningún lado. Vas a aparecer con tu inicial, y puedes subir otra cuando quieras. ¿La quitamos?',
                  confirmLabel: 'Sí, quitar mi foto',
                  danger: true,
                  onConfirm: quitarFoto,
                })}
                disabled={quitandoFoto}
                className="mt-1 text-xs font-semibold text-accent hover:underline disabled:opacity-60"
              >
                {quitandoFoto ? 'Quitando…' : 'Sin foto'}
              </button>
            )}
          </div>
        </div>

        {/* ── Datos de acceso ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">Datos de acceso</h2>
          <p className="text-xs text-muted mb-1.5">
            Entras a Evalúa Fácil con este usuario, y <strong>solo con este</strong>. Te lo dio tu
            maestro y no cambia nunca:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded bg-surface border border-outline-variant text-sm font-mono text-on-surface truncate">
              {username}
            </code>
            <button
              type="button"
              onClick={handleCopyUsername}
              className="p-2.5 rounded border border-outline-variant text-muted hover:bg-accent-tint hover:text-accent transition-colors flex-shrink-0"
              aria-label="Copiar usuario"
              data-tooltip={copied ? 'Copiado' : 'Copiar'}
            >
              {copied ? <Check size={17} className="text-green-600" /> : <Copy size={17} />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Tu nombre lo administra tu maestro — si hay un error, pídele que lo corrija.
          </p>
        </div>

        {/* ── Cambiar contraseña ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-2">
            <KeyRound size={16} className="text-accent" /> Cambiar contraseña
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <PasswordInput
              value={passActual}
              onChange={(e) => setPassActual(e.target.value)}
              placeholder="Contraseña actual"
              autoComplete="current-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <PasswordInput
              value={passNueva}
              onChange={(e) => setPassNueva(e.target.value)}
              placeholder="Contraseña nueva (mínimo 6 caracteres)"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <PasswordInput
              value={passConfirm}
              onChange={(e) => setPassConfirm(e.target.value)}
              placeholder="Repite la contraseña nueva"
              autoComplete="new-password"
              required
              className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />
            <button
              type="submit"
              disabled={savingPass || !passActual || !passNueva || !passConfirm}
              className="w-full py-2.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingPass ? <Spinner size="sm" /> : 'Guardar contraseña nueva'}
            </button>
          </form>
          {/* Aquí vivía "Correo de recuperación". Se quitó: guardar el correo
              de un menor solo se justifica si de verdad le sirve para
              recuperar su cuenta, y esa recuperación por correo no existe. El
              único camino es su maestro — y como la contraseña es lo único que
              lo deja entrar, el aviso va con peso visual, no como nota al pie. */}
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 flex items-start gap-2">
            <AlertTriangle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-on-surface leading-relaxed">
              <strong className="text-red-700">SUGERENCIA MUY IMPORTANTE:</strong>{' '}
              Anota tu contraseña en un lugar seguro, es tu responsabilidad cuidarla.
              En caso extremo de que la pierdas, puedes pedirle a tu Maestra o Maestro
              que te habilite la recuperación, para que tú dando clic en «Recuperar
              contraseña» puedas crear una nueva, y puedas volver a entrar a Evalúa Fácil.
            </p>
          </div>
        </div>

        {/* ── Mi cuenta ──
            Toda la sección aparece SOLO si ya no está inscrito en ninguna
            asignatura. Mientras tenga clases no hay nada que ofrecerle aquí ni
            nada que explicarle: no tiene que pedirle la baja a nadie, y si
            solo quiere dejar de usar Evalúa Fácil, desinstala la app como
            cualquier otra. Contarle por qué "todavía no puede" era hacerlo
            pensar en un problema que no tiene. */}
        {enrollments.length === 0 && (
          <div className="bg-surface-card rounded-card shadow-card p-5 mt-4">
            <h2 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-2">
              <UserMinus size={16} className="text-accent" /> Mi cuenta
            </h2>
            <p className="text-xs text-muted mb-2 leading-relaxed">
              Ya no estás inscrito en ninguna asignatura, así que puedes eliminar tu cuenta.
              Se borra tu usuario, tu foto y tus notificaciones, y no se puede deshacer.
            </p>
            <button
              type="button"
              onClick={() => setShowEliminar(true)}
              className="w-full py-2.5 rounded border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={16} /> Eliminar mi cuenta
            </button>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={confirming}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showEliminar && (
        <EliminarCuentaAlumnoModal photoURL={photoURL} onClose={() => setShowEliminar(false)} />
      )}
    </StudentLayout>
  )
}
