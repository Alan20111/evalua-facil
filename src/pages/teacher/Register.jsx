import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'
import { useToast } from '../../components/Toast'
import { createTeacherAccount } from '../../utils/teacherAccount'
import { createTeacherAccountIfNew, signInWithGoogle, googleErrorInfo } from '../../utils/googleAuth'
import Spinner from '../../components/Spinner'
import GoogleIcon from '../../components/GoogleIcon'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { useBackHandler } from '../../hooks/useBackHandler'
import { errorCodigoPostal, soloDigitosCP } from '../../utils/codigoPostal'
import { useUbicacionCP } from '../../data/useCodigoPostal'
import CodigoPostalField from '../../components/CodigoPostalField'
import { PREFIJOS } from '../../utils/prefijos'

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
    if (buscando) { toast('Espera un momento, estamos buscando tu código postal', 'warning'); return }
    const errorCP = errorCodigoPostal(codigoPostal, ubicacion)
    if (errorCP) { toast(errorCP, 'error'); return }
    setSaving(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      const prefijo = prefijoOption === '__otro__' ? prefijoCustom.trim() : prefijoOption
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
        profileComplete: true,
      })
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
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
            <h1 className="text-2xl font-bold text-on-surface">Un último dato</h1>
            <p className="text-muted text-sm mt-1">Cuéntanos quién eres</p>
          </div>

          <div className="bg-surface-card rounded-card shadow-card p-5">
            <form onSubmit={finish} className="space-y-3">
              <div>
                <label htmlFor="register-real-nombre" className="block text-sm font-medium text-muted mb-1">Nombre(s)</label>
                <input
                  id="register-real-nombre"
                  type="text"
                  value={realNombre}
                  onChange={(e) => setRealNombre(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej. Laura"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="register-apellido-paterno" className="block text-sm font-medium text-muted mb-1">Apellido paterno</label>
                  <input
                    id="register-apellido-paterno"
                    type="text"
                    value={apellidoPaterno}
                    onChange={(e) => setApellidoPaterno(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Ej. García"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="register-apellido-materno" className="block text-sm font-medium text-muted mb-1">Apellido materno</label>
                  <input
                    id="register-apellido-materno"
                    type="text"
                    value={apellidoMaterno}
                    onChange={(e) => setApellidoMaterno(e.target.value)}
                    className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Ej. Pérez"
                  />
                  <p className="text-xs text-slate-400 mt-1">(opcional)</p>
                </div>
              </div>
              <CodigoPostalField
                id="register-cp"
                value={codigoPostal}
                onChange={setCodigoPostal}
                labelClassName="block text-sm font-medium text-muted mb-1"
                inputClassName="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
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
                      <input
                        type="text"
                        value={prefijoCustom}
                        onChange={(e) => setPrefijoCustom(e.target.value)}
                        className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface mt-2"
                        placeholder="Escribe el prefijo"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label htmlFor="register-nombre-mostrar" className="block text-xs font-medium text-muted mb-1">Nombre</label>
                    <input
                      id="register-nombre-mostrar"
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                      placeholder="Ej. Laura García"
                    />
                  </div>
                </div>
                <p className="text-sm text-muted mt-1">Puede ser distinto a tu nombre real — un apodo, un título, como prefieras.</p>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : null}
                {saving ? 'Creando tu cuenta…' : 'Entrar al panel'}
              </button>
            </form>
          </div>

          <button
            type="button"
            onClick={() => setStep('cuenta')}
            disabled={saving}
            className="w-full text-center text-sm text-muted hover:text-accent mt-4 transition-colors disabled:opacity-60"
          >
            ← Atrás
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <EFLogo className="mx-auto w-52 sm:w-60 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Crear cuenta</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5 space-y-3">
          <Button variant="secondary" fullWidth onClick={handleGoogleSignUp} disabled={googleLoading}>
            {googleLoading ? <Spinner size="sm" /> : <GoogleIcon />}
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
              placeholder="nombre@correo.com"
            />

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-muted mb-1">Contraseña</label>
              <PasswordInput
                id="register-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label htmlFor="register-confirm-password" className="block text-sm font-medium text-muted mb-1">Confirmar contraseña</label>
              <PasswordInput
                id="register-confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                placeholder="Repite la contraseña"
              />
            </div>

            <Button type="submit" fullWidth>
              Continuar
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/docente" className="text-accent font-semibold hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  )
}
