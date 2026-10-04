import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../firebase'
import Spinner from '../../components/Spinner'
import { studentEmail } from '../../utils/generate'
import { Hash, ChevronRight, ArrowLeft, KeyRound, UserPlus } from 'lucide-react'
import EFLogo from '../../components/EFLogo'
import PasswordInput from '../../components/PasswordInput'
import { useBackHandler } from '../../hooks/useBackHandler'
import { apiUrl } from '../../utils/apiBase'
import { PUEDE_AUTOFOCUS } from '../../utils/platform'

export default function StudentLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Tres vistas, una a la vez: entrar (por defecto), restablecer contraseña y
  // activar cuenta. Viven en la URL (?vista=…) para que el botón atrás del
  // navegador y el de Android regresen a "entrar" en vez de salir de la app,
  // y para poder compartir el enlace directo a una vista.
  const [searchParams, setSearchParams] = useSearchParams()
  const vista = ['recuperar', 'activar'].includes(searchParams.get('vista')) ? searchParams.get('vista') : 'entrar'
  const tituloVistaRef = useRef(null)
  const botonOrigenRef = useRef({})
  const vistaAnterior = useRef(vista)

  // Manual access-code entry for first-time activation
  const [codeInput, setCodeInput] = useState('')
  const [avisoActivar, setAvisoActivar] = useState('')

  // Self-service password recovery
  const [resetUsername, setResetUsername] = useState('')
  const [resetNewPwd, setResetNewPwd] = useState('')
  const [resetConfirmPwd, setResetConfirmPwd] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const navigate = useNavigate()
  const submitting = useRef(false) // guards against double-submit (rapid taps)
  const submittingReset = useRef(false)

  const irA = (nueva) => {
    if (nueva === vista) return
    if (nueva === 'entrar') setSearchParams({})
    else setSearchParams({ vista: nueva })
  }

  // En "entrar" no se registra nada: cae al fallback global de "presiona de
  // nuevo para salir". En las otras dos, el atrás de Android regresa a entrar.
  useBackHandler(() => irA('entrar'), vista !== 'entrar')

  // Foco: al abrir una vista va a su título (el lector de pantalla anuncia en
  // dónde quedó); al volver, regresa al botón que la abrió.
  useEffect(() => {
    if (vistaAnterior.current === vista) return
    const de = vistaAnterior.current
    vistaAnterior.current = vista
    if (vista === 'entrar') botonOrigenRef.current[de]?.focus()
    else tituloVistaRef.current?.focus()
  }, [vista])

  const handleLogin = async (e) => {
    e.preventDefault()
    if (submitting.current) return
    setError(''); submitting.current = true; setLoading(true)
    try {
      // El estudiante entra SOLO con el usuario que le dio su maestro. Nunca
      // con un correo: el correo de recuperación es un dato aparte, no una
      // segunda llave (ver Profile.jsx del estudiante). Si escribe un correo
      // aquí es porque se confundió, y hay que decírselo con todas sus letras
      // en vez de dejarlo intentando.
      const tecleado = username.trim()
      if (tecleado.includes('@')) {
        setError('Tu usuario no es un correo. Es el que te dio tu maestro (por ejemplo ABCD).')
        return
      }
      if (!tecleado) {
        setError('Escribe tu usuario.')
        return
      }

      // La búsqueda y el fallo de RED se atrapan aquí, no en el catch de
      // abajo: un internet caído no es "usuario no encontrado", y confundir
      // las dos cosas mandaba al alumno a activar una cuenta que ya tenía.
      let lookupData
      try {
        const resp = await fetch(apiUrl('/api/student/lookup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: tecleado }),
        })
        if (!resp.ok) {
          if (resp.status === 429) {
            setError('Demasiadas solicitudes. Espera un momento y vuelve a intentar.')
          } else if (resp.status >= 500) {
            setError('El servidor no respondió bien. No es tu usuario: espera un momento y vuelve a intentar.')
          } else {
            setError('No pudimos verificar tu usuario. Espera un momento y vuelve a intentar.')
          }
          return
        }
        lookupData = await resp.json()
      } catch {
        setError('No pudimos conectar. Revisa tu conexión a internet y vuelve a intentar.')
        return
      }

      const stuDocs = lookupData.students || []
      if (stuDocs.length === 0) {
        // Ahora sí significa exactamente eso: el servidor buscó y no existe
        // ninguna cuenta con ese usuario, ni escrito con ñ ni con acentos.
        // Se le repite lo que escribió, que es lo que caza un dedazo de un
        // vistazo ("patino.evenlin" en vez de "patino.evelin").
        setError(`No encontramos el usuario "${tecleado}". Revísalo con calma —debe estar escrito igual que te lo dio tu maestro—, o usa "¿Primera vez? Activa tu cuenta" más abajo.`)
        return
      }
      const uname = stuDocs[0].username
      // Lo encontramos porque le normalizamos la ñ o los acentos: que vea cómo
      // se escribe su usuario en lugar de entrar sin enterarse. Se corrige el
      // campo en pantalla —sin pantallas nuevas ni un paso más— y la próxima
      // vez ya lo escribe bien.
      if (lookupData.coincidencia === 'normalizada' && lookupData.canonico) {
        setUsername(lookupData.canonico)
      }

      // A username can repeat across schools, so each school is a different account/email.
      // For already-activated accounts, try sign-in against each school's email — the correct
      // password authenticates exactly one of them.
      const activatedSchools = [...new Set(stuDocs.filter((d) => d.cuentaExiste).map((d) => d.escuelaId))]
      if (activatedSchools.length > 0) {
        let signedInEscuelaId = null
        // El último error se guarda en vez de tirarse: este bucle se traga
        // también las caídas de red y los bloqueos por reintentos, y darlos
        // todos por "contraseña incorrecta" mandaba al alumno a pedir un
        // restablecimiento que no necesitaba.
        let ultimoError = null
        for (const esc of activatedSchools) {
          try {
            await signInWithEmailAndPassword(auth, studentEmail(uname, esc), password)
            signedInEscuelaId = esc
            break
          } catch (e) { ultimoError = e /* contraseña de otra escuela — se prueba la siguiente */ }
        }
        if (!signedInEscuelaId) {
          if (ultimoError?.code === 'auth/network-request-failed') {
            setError('No pudimos conectar. Revisa tu conexión a internet y vuelve a intentar.')
          } else if (ultimoError?.code === 'auth/too-many-requests') {
            setError('Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.')
          } else {
            setError('Contraseña incorrecta. Si el maestro ya restableció tu acceso, usa "¿Olvidaste tu contraseña?" más abajo.')
          }
          return
        }
        // Si el alumno entró con la contraseña de reset (activado: false),
        // el backup path lo lleva a Perfil para que establezca una contraseña.
        const conReset = stuDocs.find((d) => d.escuelaId === signedInEscuelaId && !d.activado)
        if (conReset) {
          navigate('/alumno/perfil', { state: { debeEstablecerContrasena: true } })
        } else {
          navigate('/alumno/dashboard')
        }
        return
      }

      // No activated account yet: this form is only for students who already
      // activated. First-time access happens exclusively via "¿Primera vez?
      // Activa tu cuenta" below (código/QR/link) → /activate/:code.
      setAvisoActivar('Todavía no activas tu cuenta. Actívala aquí con el código de tu asignatura.')
      irA('activar')
    } catch (err) {
      // Red de seguridad: los casos de arriba ya cubren usuario, contraseña,
      // activación y red. Lo que llegue aquí es un fallo inesperado, y se dice
      // así — nunca como si el usuario estuviera mal.
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Contraseña incorrecta. Si el maestro ya restableció tu acceso, usa "¿Olvidaste tu contraseña?" más abajo.')
      } else if (err.code === 'auth/network-request-failed') {
        setError('No pudimos conectar. Revisa tu conexión a internet y vuelve a intentar.')
      } else {
        setError('Algo falló de nuestro lado al iniciar sesión. No es tu usuario: vuelve a intentar en un momento.')
      }
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const handleRecover = async (e) => {
    e.preventDefault()
    if (submittingReset.current) return
    setResetError('')
    if (resetNewPwd.length < 8) {
      setResetError('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (resetNewPwd !== resetConfirmPwd) {
      setResetError('Las contraseñas nuevas no coinciden')
      return
    }
    submittingReset.current = true; setResetLoading(true)
    try {
      let resp, data
      try {
        resp = await fetch(apiUrl('/api/student/recover-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: resetUsername.trim(),
            newPassword: resetNewPwd,
          }),
        })
        data = await resp.json()
      } catch {
        setResetError('No pudimos conectar. Revisa tu conexión a internet y vuelve a intentar.')
        return
      }
      if (!resp.ok) {
        // Mismo criterio que el login: un 429 o un 500 no son culpa de lo que
        // escribió el alumno y no se le pueden contar como si lo fueran.
        if (resp.status === 429) {
          setResetError('Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.')
        } else if (resp.status >= 500) {
          setResetError('El servidor no respondió bien. Espera un momento y vuelve a intentar.')
        } else {
          setResetError(data?.error || 'No se pudo restablecer la contraseña.')
        }
        return
      }
      // Autenticar con la nueva contraseña y entrar al dashboard.
      await signInWithEmailAndPassword(auth, data.email, resetNewPwd)
      navigate('/alumno/dashboard')
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setResetError('No se pudo autenticar con la nueva contraseña. Intenta de nuevo.')
      } else {
        setResetError('Error: ' + err.message)
      }
    } finally {
      submittingReset.current = false
      setResetLoading(false)
    }
  }

  const handleActivateWithCode = (e) => {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  return (
    <div data-forma="acceso" className="min-h-dvh flex flex-col items-center justify-center px-4 py-8 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <EFLogo className="mx-auto w-56 sm:w-64 h-auto mb-3" />
          <h1 className="text-2xl font-bold text-on-surface">Acceso Estudiantes</h1>
        </div>

        {vista === 'entrar' && (
          <>
            {/* ── Login form ── */}
            <div className="bg-surface-card rounded-card shadow-card p-5">
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label htmlFor="login-username" className="block text-sm font-medium text-muted mb-1">Usuario</label>
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); setError('') }}
                    required
                    // autoFocus intencional (solo en escritorio): primer campo del formulario de login,
                    // pantalla de entrada única — no es un modal reabrible.
                    autoFocus={PUEDE_AUTOFOCUS}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-wide "
                    maxLength={40}
                  />
                </div>
                <div>
                  <label htmlFor="login-password" className="block text-sm font-medium text-muted mb-1">Contraseña</label>
                  <PasswordInput
                    id="login-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    required
                    className="w-full px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-full transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : null}
                  {loading ? 'Entrando…' : 'Iniciar sesión'}
                </button>
              </form>
            </div>

            {/* Las otras dos tareas son botones píldora: cada uno abre SOLO su
                pantalla, en vez de acordeones que apilaban todo en una. */}
            <nav aria-label="Otras opciones de acceso" className="mt-3 space-y-2">
              <BotonVista
                refBoton={(el) => { botonOrigenRef.current.recuperar = el }}
                icono={KeyRound}
                onClick={() => {
                  if (username && !resetUsername) setResetUsername(username)
                  irA('recuperar')
                }}
              >
                ¿Olvidaste tu contraseña?
              </BotonVista>
              <BotonVista
                refBoton={(el) => { botonOrigenRef.current.activar = el }}
                icono={UserPlus}
                onClick={() => irA('activar')}
              >
                ¿Primera vez? Activa tu cuenta
              </BotonVista>
            </nav>
          </>
        )}

        {vista === 'recuperar' && (
          <PanelVista titulo="Restablece tu contraseña" tituloRef={tituloVistaRef} onVolver={() => irA('entrar')}>
            <p className="text-sm text-muted mb-4 leading-relaxed">
              Tu maestro debe haber pulsado &ldquo;Restablecer contraseña&rdquo; primero.
              Luego escribe tu usuario y la nueva contraseña que quieres usar.
            </p>
            <form onSubmit={handleRecover} className="space-y-3">
              <div>
                <label htmlFor="recover-username" className="block text-sm font-medium text-muted mb-1">Usuario</label>
                <input
                  id="recover-username"
                  type="text"
                  value={resetUsername}
                  onChange={(e) => { setResetUsername(e.target.value); setResetError('') }}
                  required
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-wide "
                  maxLength={40}
                />
              </div>
              <div>
                <label htmlFor="recover-new-pwd" className="block text-sm font-medium text-muted mb-1">Nueva contraseña</label>
                <PasswordInput
                  id="recover-new-pwd"
                  value={resetNewPwd}
                  onChange={(e) => { setResetNewPwd(e.target.value); setResetError('') }}
                  required
                  className="w-full px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                />
              </div>
              <div>
                <label htmlFor="recover-confirm-pwd" className="block text-sm font-medium text-muted mb-1">Confirmar nueva contraseña</label>
                <PasswordInput
                  id="recover-confirm-pwd"
                  value={resetConfirmPwd}
                  onChange={(e) => { setResetConfirmPwd(e.target.value); setResetError('') }}
                  required
                  className="w-full px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                />
              </div>
              {resetError && (
                <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2.5">
                  {resetError}
                </p>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-full transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {resetLoading ? <Spinner size="sm" /> : null}
                {resetLoading ? 'Restableciendo…' : 'Restablecer contraseña'}
              </button>
            </form>
          </PanelVista>
        )}

        {vista === 'activar' && (
          <PanelVista titulo="Activa tu cuenta" tituloRef={tituloVistaRef} onVolver={() => { setAvisoActivar(''); irA('entrar') }}>
            {avisoActivar && (
              <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-4 py-2.5 mb-4">
                {avisoActivar}
              </p>
            )}
            <ol className="text-sm text-muted mb-4 leading-relaxed list-decimal pl-5 space-y-1">
              <li>Asegúrate de que tu maestro(a) te haya agregado a su grupo.</li>
              <li>Pídele que te comparta tu usuario.</li>
              <li>Pídele el <strong className="text-on-surface">código de su asignatura</strong> y escríbelo aquí.</li>
            </ol>
            <label htmlFor="activar-codigo" className="block text-sm font-medium text-muted mb-1">Código de la asignatura</label>
            <form onSubmit={handleActivateWithCode} className="flex gap-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                id="activar-codigo"
                className="flex-1 min-w-0 px-4 py-2.5 rounded-full border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface font-mono tracking-widest "
              />
              <button
                type="submit"
                disabled={!codeInput.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-full transition-colors disabled:opacity-60 flex items-center gap-1.5 flex-shrink-0"
              >
                <Hash size={18} />
                Ir
              </button>
            </form>
          </PanelVista>
        )}

        <p className="text-center text-sm text-muted mt-6 px-2">
          Tu maestro te otorgará tus datos de acceso.
        </p>
        <p className="text-center text-sm text-muted mt-2 px-2">
          <Link to="/docente" className="text-accent font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full px-1">¿Eres Docente?</Link>
        </p>
      </div>
    </div>
  )
}

// Botón píldora que abre una de las vistas secundarias (restablecer, activar).
function BotonVista({ icono: Icono, onClick, refBoton, children }) {
  return (
    <button
      ref={refBoton}
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-5 py-3 rounded-full bg-surface-card shadow-card hover:shadow-card-hover hover:bg-[var(--accent-tint)] text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Icono size={19} className="text-accent flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 text-sm font-semibold text-on-surface">{children}</span>
      <ChevronRight size={19} className="text-hint flex-shrink-0" aria-hidden="true" />
    </button>
  )
}

// Tarjeta de una vista secundaria: botón Volver + título que recibe el foco.
function PanelVista({ titulo, tituloRef, onVolver, children }) {
  return (
    <section aria-labelledby="vista-titulo" className="bg-surface-card rounded-card shadow-card p-5">
      <div className="flex items-center gap-2 mb-3 -ml-2">
        <button
          type="button"
          onClick={onVolver}
          aria-label="Volver a iniciar sesión"
          className="p-2 rounded-full text-hint hover:text-accent hover:bg-[var(--accent-tint)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h2 id="vista-titulo" ref={tituloRef} tabIndex={-1} className="text-lg font-bold text-on-surface focus:outline-none">
          {titulo}
        </h2>
      </div>
      {children}
    </section>
  )
}
