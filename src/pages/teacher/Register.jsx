import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useToast } from '../../components/Toast'
import { createTeacherAccount } from '../../utils/teacherAccount'
import { createTeacherAccountIfNew, signInWithGoogle, googleErrorInfo } from '../../utils/googleAuth'
import GoogleIcon from '../../components/GoogleIcon'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import Select from '../../components/ui/Select'
import { useBackHandler } from '../../hooks/useBackHandler'
import { errorCodigoPostal, soloDigitosCP } from '../../utils/codigoPostal'
import { useUbicacionCP } from '../../data/useCodigoPostal'
import CodigoPostalField from '../../components/CodigoPostalField'
import { PREFIJOS } from '../../utils/prefijos'
import SchoolPicker from '../../components/SchoolPicker'
import BotonEscuela from '../../components/BotonEscuela'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { ArrowLeft } from 'lucide-react'
import { PUEDE_AUTOFOCUS } from '../../utils/platform'
import { Input, Button } from '../../components/ui'

// Registro en dos pasos, SIN crear ninguna cuenta hasta el paso final.
//
// Antes "Crear cuenta" creaba la cuenta de Firebase Auth + el perfil en
// Firestore de inmediato, y solo DESPUÉS pedía el resto de los datos
// ("Un último paso", pantalla /onboarding) — así que quien no terminaba de
// llenarlos ya tenía una cuenta registrada, sin haber dado nunca el paso
// final. Aquí el correo/contraseña del Paso 1 se guardan solo en memoria
// (este componente) hasta que se confirma el Paso 2 con "Entrar al panel":
// recién ahí se crea la cuenta de Auth y se escribe el perfil completo de un
// solo golpe (profileComplete: true desde el principio). Si alguien se
// arrepiente a medio Paso 2, "Atrás" regresa al Paso 1 sin haber tocado nada
// en el servidor.
//
// "Continuar con Google" es la excepción: Firebase crea la cuenta de Auth en
// el momento mismo de autenticar con Google, antes de que este componente
// pueda intervenir. Ese camino sigue llevando a /onboarding (ver
// Onboarding.jsx), que conserva su propio botón "No continuar" para cuando
// alguien se arrepiente después de entrar con Google.
export default function Register() {
  const [step, setStep] = useState('cuenta') // 'cuenta' | 'perfil'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)

  const [realNombre, setRealNombre] = useState('')
  const [apellidoPaterno, setApellidoPaterno] = useState('')
  const [apellidoMaterno, setApellidoMaterno] = useState('')
  const [nombre, setNombre] = useState('')
  const [prefijoOption, setPrefijoOption] = useState('')
  const [prefijoCustom, setPrefijoCustom] = useState('')
  const [codigoPostal, setCodigoPostal] = useState('')
  const { ubicacion, buscando } = useUbicacionCP(codigoPostal)
  const [saving, setSaving] = useState(false)
  // Escuela — OBLIGATORIA (ver utils/escuela.js). Aquí solo se guarda lo
  // ELEGIDO, sin tocar Firestore todavía: en este paso la cuenta aún no
  // existe, y las reglas de `schools` solo dejan escribir a un docente ya
  // registrado. Se resuelve al final de finish(), con la sesión ya creada.
  const [plantel, setPlantel] = useState(null)
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const plantelLabel = plantel ? (plantel.short || plantel.nombre || '') : ''

  const navigate = useNavigate()
  const toast = useToast()

  // Botón físico de Android: en el Paso 1 sale del registro (como antes); en
  // el Paso 2 solo regresa al Paso 1 — no hay ninguna cuenta que limpiar.
  useBackHandler(() => (step === 'perfil' ? setStep('cuenta') : navigate('/docente')))

  async function handleGoogleSignUp() {
    setGoogleLoading(true)
    try {
      const user = await signInWithGoogle()
      await createTeacherAccountIfNew(user)
      navigate('/dashboard')
    } catch (err) {
      const { cancelled, message } = googleErrorInfo(err)
      if (!cancelled) toast(message, 'error')
    } finally {
      setGoogleLoading(false)
    }
  }

  function handleContinuar(e) {
    e.preventDefault()
    if (password !== confirmPassword) { toast('Las contraseñas no coinciden', 'error'); return }
    if (password.length < 6) { toast('Mínimo 6 caracteres', 'error'); return }
    setStep('perfil')
  }

  async function finish(e) {
    e.preventDefault()
    if (!realNombre.trim() || !apellidoPaterno.trim()) { toast('Escribe tu nombre y apellido paterno', 'error'); return }
    if (!nombre.trim()) { toast('Escribe cómo quieres que te vean tus estudiantes', 'error'); return }
    if (!plantel) { toast('Elige tu escuela para continuar', 'error'); return }
    if (buscando) { toast('Espera un momento, estamos buscando tu código postal', 'warning'); return }
    const errorCP = errorCodigoPostal(codigoPostal, ubicacion)
    if (errorCP) { toast(errorCP, 'error'); return }
    setSaving(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      const prefijo = prefijoOption === '__otro__' ? prefijoCustom.trim() : prefijoOption
      // Dos escrituras, no una, y en este orden a propósito: `schools` solo
      // acepta escrituras de un docente YA registrado (ver firestore.rules),
      // así que el perfil tiene que existir antes de poder resolver o dar de
      // alta la escuela. Nace incompleto para que, si la segunda escritura no
      // aterriza (red caída), el guard de rutas lo mande a /onboarding a
      // terminar de elegirla — nunca a operar sin escuela.
      await createTeacherAccount(cred.user.uid, email, null, 'password', true, {
        nombre: realNombre.trim(),
        apellidoPaterno: apellidoPaterno.trim(),
        apellidoMaterno: apellidoMaterno.trim(),
        nombreMostrar: nombre.trim(),
        prefijo,
        codigoPostal: soloDigitosCP(codigoPostal),
        estado: ubicacion.estado,
        municipio: ubicacion.municipio,
        ciudad: ubicacion.ciudad,
        profileComplete: false,
      })
      const { escuelaId, schoolName } = await resolveSchoolSelection(plantel, cred.user.uid)
      await updateDoc(doc(db, 'users', cred.user.uid), { escuelaId, schoolName, profileComplete: true })
      navigate('/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        toast('Este correo ya tiene cuenta (quizá con Google). Inicia sesión.', 'error')
        setStep('cuenta')
      } else {
        toast('Error: ' + err.message, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  if (step === 'perfil') {
    return (
      <div data-forma="acceso" className="min-h-dvh flex flex-col items-center justify-center px-4 bg-surface py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <EFLogo className="mx-auto w-56 sm:w-64 h-auto mb-3" />
            <h1 className="text-2xl font-bold text-on-surface">Un último dato</h1>
            <p className="text-muted text-sm mt-1">Cuéntanos quién eres</p>
          </div>

          <div className="bg-surface-card rounded-card shadow-card p-5">
            <form onSubmit={finish} className="space-y-3">
              <Input
                label="Nombre(s)"
                id="register-real-nombre"
                type="text"
                value={realNombre}
                onChange={(e) => setRealNombre(e.target.value)}
                required
                autoFocus={PUEDE_AUTOFOCUS}
              />
              <div className="flex gap-2">
                <Input
                  label="Apellido paterno"
                  wrapperClassName="flex-1"
                  id="register-apellido-paterno"
                  type="text"
                  value={apellidoPaterno}
                  onChange={(e) => setApellidoPaterno(e.target.value)}
                  required
                />
                <Input
                  label="Apellido materno"
                  wrapperClassName="flex-1"
                  optional
                  id="register-apellido-materno"
                  type="text"
                  value={apellidoMaterno}
                  onChange={(e) => setApellidoMaterno(e.target.value)}
                />
              </div>
              <CodigoPostalField
                id="register-cp"
                value={codigoPostal}
                onChange={setCodigoPostal}
              />

              <div>
                <label className="block text-sm font-medium text-muted mb-1">¿Cómo quieres que te vean tus estudiantes?</label>
                <div className="flex gap-2 items-start">
                  <div className="w-32 sm:w-36 flex-shrink-0">
                    <Select
                      id="register-prefijo"
                      label="Prefijo"
                      hint="(opcional)"
                      value={prefijoOption}
                      onChange={setPrefijoOption}
                      options={[
                        { value: '', label: 'Sin prefijo' },
                        ...PREFIJOS.map((p) => ({ value: p, label: p })),
                        { value: '__otro__', label: 'Otro… (escríbelo)' },
                      ]}
                    />
                    {prefijoOption === '__otro__' && (
                      <Input
                        type="text"
                        value={prefijoCustom}
                        onChange={(e) => setPrefijoCustom(e.target.value)}
                        className="mt-2"
                        aria-label="Escribe el prefijo"
                      />
                    )}
                  </div>
                  <Input
                    label="Nombre"
                    wrapperClassName="flex-1 min-w-0"
                    id="register-nombre-mostrar"
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </div>
                <p className="text-sm text-muted mt-1">Puede ser distinto a tu nombre real — un apodo, un título, como prefieras.</p>
              </div>

              {/* Escuela: obligatoria. No hay opción de seguir sin una — si la
                  suya no está en el catálogo, la da de alta desde el mismo
                  selector, sin necesidad de saberse la Clave del Centro de
                  Trabajo. */}
              <BotonEscuela etiqueta={plantelLabel} onClick={() => setShowSchoolPicker(true)} disabled={saving} />

              <Button type="submit" size="lg" fullWidth busy={saving} disabled={saving || !plantel}>
                {saving ? 'Creando tu cuenta…' : 'Entrar al panel'}
              </Button>
            </form>
          </div>

          <Button variant="quiet" icon={ArrowLeft} fullWidth className="mt-4" onClick={() => setStep('cuenta')} disabled={saving}>
            Atrás
          </Button>
        </div>

        {showSchoolPicker && (
          <SchoolPicker
            titulo="Busca tu escuela por nombre, municipio o CCT."
            onSelect={(p) => { setPlantel(p); setShowSchoolPicker(false) }}
            onClose={() => setShowSchoolPicker(false)}
          />
        )}
      </div>
    )
  }

  return (
    <div data-forma="acceso" className="min-h-dvh flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <EFLogo className="mx-auto w-56 sm:w-64 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Crear cuenta</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5 space-y-3">
          <Button variant="secondary" size="lg" fullWidth onClick={handleGoogleSignUp} busy={googleLoading}>
            {!googleLoading && <GoogleIcon />}
            {googleLoading ? 'Conectando…' : 'Continuar con Google'}
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-outline-variant" />
            <span className="text-sm text-slate-500">o</span>
            <div className="flex-1 h-px bg-outline-variant" />
          </div>

          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Crear cuenta con correo electrónico</p>

          <form onSubmit={handleContinuar} className="space-y-3">
            <Input
              label="Correo electrónico"
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            <PasswordInput
              label="Contraseña"
              id="register-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Confirmar contraseña"
              id="register-confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />

            <Button type="submit" size="lg" fullWidth>
              Continuar
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          <Link to="/docente" className="text-accent font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full px-1">¿Ya tienes cuenta?</Link>
        </p>
      </div>
    </div>
  )
}
