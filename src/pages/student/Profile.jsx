import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, verifyBeforeUpdateEmail,
} from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import PasswordInput from '../../components/PasswordInput'
import StudentLayout from '../../components/StudentLayout'
import { getEnrollments, updateAllEnrollments } from '../../utils/studentLookup'
import { maskEmail } from '../../utils/generate'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { STUDENT_CONTAINER_NARROW } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { Camera, Copy, Check, KeyRound, Mail, ShieldCheck } from 'lucide-react'

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
  const [copied, setCopied] = useState(false)
  // Cambio de contraseña
  const [passActual, setPassActual] = useState('')
  const [passNueva, setPassNueva] = useState('')
  const [passConfirm, setPassConfirm] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  // Correo de recuperación
  const [correoNuevo, setCorreoNuevo] = useState('')
  const [correoPass, setCorreoPass] = useState('')
  const [savingCorreo, setSavingCorreo] = useState(false)
  const [correoEnviadoA, setCorreoEnviadoA] = useState('')
  const [showCorreoForm, setShowCorreoForm] = useState(false)
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

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file || !currentUser) return
    setUploadingPhoto(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/profiles')
      await updateAllEnrollments(currentUser.uid, { photoURL: url })
      setUserProfile((prev) => ({ ...prev, photoURL: url }))
      setStudentInfo((prev) => (prev ? { ...prev, photoURL: url } : prev))
      toast('Foto actualizada')
    } catch {
      toast('No se pudo subir la foto', 'error')
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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

  async function handleRegistrarCorreo(e) {
    e.preventDefault()
    const email = correoNuevo.trim().toLowerCase()
    if (!email || !email.includes('@')) { toast('Escribe un correo válido', 'error'); return }
    if (email.endsWith('@evalua.local')) { toast('Ese correo no es válido', 'error'); return }
    setSavingCorreo(true)
    try {
      // Reautenticación: confirmar el correo lo convierte en la llave de la
      // cuenta, así que exigimos la contraseña actual antes de iniciarlo.
      const cred = EmailAuthProvider.credential(currentUser.email, correoPass)
      await reauthenticateWithCredential(currentUser, cred)
      auth.languageCode = 'es'
      // Firebase manda el enlace de verificación al correo NUEVO; hasta que el
      // estudiante lo abra, la cuenta no cambia. Al confirmarlo, ese correo se
      // vuelve el de la cuenta → sirve para entrar y para restablecer contraseña.
      await verifyBeforeUpdateEmail(currentUser, email)
      // En `students` (lectura pública) solo la máscara — nunca el correo completo.
      await updateAllEnrollments(currentUser.uid, { correoMask: maskEmail(email), correoVerificado: false })
      setStudentInfo((prev) => (prev ? { ...prev, correoMask: maskEmail(email), correoVerificado: false } : prev))
      setCorreoEnviadoA(email)
      setCorreoNuevo(''); setCorreoPass(''); setShowCorreoForm(false)
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        toast('La contraseña no es correcta', 'error')
      } else if (err.code === 'auth/email-already-in-use') {
        toast('Ese correo ya está vinculado a otra cuenta', 'error')
      } else if (err.code === 'auth/invalid-email') {
        toast('Escribe un correo válido', 'error')
      } else if (err.code === 'auth/too-many-requests') {
        toast('Demasiados intentos. Espera unos minutos e intenta de nuevo.', 'error')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSavingCorreo(false)
    }
  }

  const displayName =
    [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].filter(Boolean).join(' ')
    || [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].filter(Boolean).join(' ')
    || studentInfo?.username || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  const username = studentInfo?.username || userProfile?.username || ''
  // El correo de la CUENTA dejó de ser el @evalua.local falso → el estudiante ya
  // confirmó su correo de recuperación desde el enlace.
  const correoVerificado = !!currentUser?.email && !currentUser.email.endsWith('@evalua.local')

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

      <div className={`px-4 py-6 ${STUDENT_CONTAINER_NARROW}`}>
        <h1 className="text-xl font-bold text-on-surface mb-4">Mi perfil</h1>

        {/* ── Identidad ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-16 h-16 rounded-full flex-shrink-0 group focus:outline-none"
            data-tooltip="Cambiar foto"
            aria-label="Cambiar foto"
          >
            <div className="w-16 h-16 rounded-full bg-accent-tint overflow-hidden flex items-center justify-center">
              {uploadingPhoto ? (
                <Spinner size="sm" />
              ) : photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-bold text-accent">{initials}</span>
              )}
            </div>
            <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <Camera size={18} className="text-white" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-on-surface leading-snug">{displayName}</p>
            {schoolName && <p className="text-sm text-muted truncate mt-0.5">{schoolName}</p>}
            <p className="text-xs text-slate-400 mt-1">Toca la foto para cambiarla</p>
          </div>
        </div>

        {/* ── Datos de acceso ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5 mb-4">
          <h2 className="text-sm font-semibold text-on-surface mb-3">Datos de acceso</h2>
          <p className="text-xs text-muted mb-1.5">Tu usuario para entrar a Evalúa Fácil:</p>
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
        </div>

        {/* ── Correo de recuperación ── */}
        <div className="bg-surface-card rounded-card shadow-card p-5">
          <h2 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-2">
            <Mail size={16} className="text-accent" /> Correo de recuperación
          </h2>
          {correoVerificado ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 px-3 py-2 rounded bg-surface border border-outline-variant text-sm font-mono text-on-surface truncate">
                  {currentUser.email}
                </code>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-xs font-semibold flex-shrink-0">
                  <ShieldCheck size={13} /> Verificado
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Con este correo <strong>inicias sesión</strong> y, si un día olvidas tu contraseña,
                puedes restablecerla tú mismo desde «¿Olvidaste tu contraseña?» en la pantalla de entrada
                — sin pedirle nada a tu maestro.
              </p>
            </>
          ) : correoEnviadoA || (studentInfo?.correoMask && studentInfo?.correoVerificado === false) ? (
            <>
              <p className="text-sm text-muted leading-relaxed mb-3">
                Te enviamos un enlace a <strong>{correoEnviadoA || studentInfo?.correoMask}</strong>.
                Ábrelo para confirmar tu correo. Al confirmarlo, entrarás a Evalúa Fácil <strong>con ese
                correo</strong> y tu misma contraseña (puede que te pida iniciar sesión de nuevo).
              </p>
              <button
                type="button"
                onClick={() => setShowCorreoForm(true)}
                className="text-sm text-accent font-medium hover:underline"
              >
                ¿No te llegó? Volver a intentar
              </button>
            </>
          ) : !showCorreoForm ? (
            <>
              <p className="text-sm text-muted leading-relaxed mb-3">
                Registra un correo tuyo (Gmail, Outlook…). Si un día olvidas tu contraseña, podrás
                restablecerla tú mismo desde ese correo, sin pedirle nada a tu maestro. Después de
                confirmarlo, entrarás a Evalúa Fácil con tu correo.
              </p>
              <button
                type="button"
                onClick={() => setShowCorreoForm(true)}
                className="w-full py-2.5 rounded border border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors"
              >
                Registrar mi correo
              </button>
            </>
          ) : null}
          {showCorreoForm && !correoVerificado && (
            <form onSubmit={handleRegistrarCorreo} className="space-y-3 mt-3">
              <input
                type="email"
                value={correoNuevo}
                onChange={(e) => setCorreoNuevo(e.target.value)}
                placeholder="tucorreo@gmail.com"
                autoComplete="email"
                required
                className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
              />
              <PasswordInput
                value={correoPass}
                onChange={(e) => setCorreoPass(e.target.value)}
                placeholder="Tu contraseña actual (para confirmar que eres tú)"
                autoComplete="current-password"
                required
                className="w-full px-3 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCorreoForm(false); setCorreoNuevo(''); setCorreoPass('') }}
                  className="flex-1 py-2.5 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingCorreo || !correoNuevo || !correoPass}
                  className="flex-1 py-2.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {savingCorreo ? <Spinner size="sm" /> : 'Enviarme el enlace'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </StudentLayout>
  )
}
