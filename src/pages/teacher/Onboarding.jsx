import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { GraduationCap, Trash2 } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { errorCodigoPostal, soloDigitosCP } from '../../utils/codigoPostal'
import { useUbicacionCP } from '../../data/useCodigoPostal'
import CodigoPostalField from '../../components/CodigoPostalField'
import { PREFIJOS } from '../../utils/prefijos'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import ConfirmModal from '../../components/ConfirmModal'
import { apiUrl } from '../../utils/apiBase'
import SchoolPicker from '../../components/SchoolPicker'
import { resolveSchoolSelection } from '../../utils/schoolSelection'
import { escuelaValida } from '../../utils/escuela'
import { School } from 'lucide-react'

// Ventana para el "presiona de nuevo" de abajo — la misma que usa
// AndroidBackButton para salir de la app desde la pantalla raíz.
const SALIR_PRESS_WINDOW_MS = 2000

export default function Onboarding() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  // Los campos arrancan con lo que el perfil YA tenga. Esta pantalla dejó de
  // ser solo el último paso de "Continuar con Google": también es a donde
  // llega un docente de antes (cuenta completa, pero sin escuela real) a
  // elegirla — y a ese no se le puede pedir que vuelva a capturar su nombre y
  // su código postal desde cero.
  const [realNombre, setRealNombre] = useState(userProfile?.nombre || '')
  const [apellidoPaterno, setApellidoPaterno] = useState(userProfile?.apellidoPaterno || '')
  const [apellidoMaterno, setApellidoMaterno] = useState(userProfile?.apellidoMaterno || '')
  const [nombre, setNombre] = useState(userProfile?.nombreMostrar || '')
  // Prefijo del nombre visible (opcional) — mismo patrón que Profile.jsx:
  // el <select> guarda uno de los valores predefinidos, '' (sin prefijo) o
  // '__otro__' (texto libre en prefijoCustom).
  const [prefijoOption, setPrefijoOption] = useState(userProfile?.prefijo && PREFIJOS.includes(userProfile.prefijo) ? userProfile.prefijo : '')
  const [prefijoCustom, setPrefijoCustom] = useState('')
  const [codigoPostal, setCodigoPostal] = useState(userProfile?.codigoPostal || '')
  const { ubicacion, buscando } = useUbicacionCP(codigoPostal)
  const [saving, setSaving] = useState(false)
  // Escuela — OBLIGATORIA (ver utils/escuela.js). `plantel` es lo elegido en
  // el selector; se resuelve a un doc de `schools` al guardar. Un perfil que
  // YA tiene escuela real no vuelve a pasar por aquí (el guard de rutas solo
  // manda a los que les falta), así que arranca siempre vacío.
  const [plantel, setPlantel] = useState(null)
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  const plantelLabel = plantel ? (plantel.short || plantel.nombre || '') : ''
  const ultimaSalidaRef = useRef(0)

  // "No continuar" — pedido explícito: hasta este paso la cuenta ya existe en
  // Firebase Auth + Firestore (users/{uid} + subscriptions), aunque el
  // docente todavía no vio ni usó nada. Sin esta salida quedaba atrapado:
  // "Un último paso" era falso, porque el registro YA había quedado hecho
  // antes de llegar aquí, y ni cerrar la pestaña servía — al volver a
  // evaluafacil.mx la sesión seguía viva y rebotaba aquí de nuevo. Reutiliza
  // /api/account/delete (el mismo borrado sin residuos del perfil) y regresa
  // a Crear cuenta, para que quien se arrepintió del correo pueda intentar
  // con otro.
  const [showNoContinuar, setShowNoContinuar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  useBackHandler(() => setShowNoContinuar(false), showNoContinuar)
  useScrollLock(showNoContinuar)

  async function noContinuar() {
    setCancelando(true)
    try {
      const token = await currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/account/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmacion: 'ELIMINAR' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo cancelar el registro')
      await signOut(auth).catch(() => {})
      navigate('/register', { replace: true })
      toast('No quedó ninguna cuenta registrada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      setCancelando(false)
    }
  }

  // Botón físico de Android. Esta pantalla no tiene "atrás" posible: la ruta
  // protegida rebota aquí mientras el perfil esté incompleto, y cerrar la app
  // tampoco ayuda porque al reabrirla la sesión sigue viva y vuelve a caer
  // aquí — sin ninguna salida a la vista. Así que atrás cierra la sesión y
  // regresa al inicio; la cuenta YA está creada, al entrar de nuevo se retoma
  // justo en este paso. Se pide dos veces para que un toque distraído no
  // saque a nadie de su cuenta.
  async function salirDelRegistro() {
    const ahora = Date.now()
    if (ahora - ultimaSalidaRef.current >= SALIR_PRESS_WINDOW_MS) {
      ultimaSalidaRef.current = ahora
      toast('Presiona de nuevo para salir de tu cuenta', 'warning')
      return
    }
    try {
      await signOut(auth)
      navigate('/', { replace: true })
      toast('Tu cuenta ya está creada — entra de nuevo cuando quieras terminar este paso')
    } catch (err) {
      toast('No se pudo cerrar la sesión: ' + err.message, 'error')
    }
  }
  useBackHandler(salirDelRegistro)

  async function finish(e) {
    e.preventDefault()
    if (!realNombre.trim() || !apellidoPaterno.trim()) { toast('Escribe tu nombre y apellido paterno', 'error'); return }
    if (!nombre.trim()) { toast('Escribe cómo quieres que te vean tus estudiantes', 'error'); return }
    // Escuela obligatoria: ni con una elección previa inválida (el centinela
    // histórico) se deja pasar — a esta pantalla solo llega quien no tiene una
    // escuela real, así que aquí SIEMPRE hay que elegirla.
    if (!plantel && !escuelaValida(userProfile?.escuelaId)) { toast('Elige tu escuela para continuar', 'error'); return }
    if (buscando) { toast('Espera un momento, estamos buscando tu código postal', 'warning'); return }
    const errorCP = errorCodigoPostal(codigoPostal, ubicacion)
    if (errorCP) { toast(errorCP, 'error'); return }
    setSaving(true)
    try {
      const prefijo = prefijoOption === '__otro__' ? prefijoCustom.trim() : prefijoOption
      // La escuela se resuelve (o se da de alta) ANTES de marcar el perfil
      // como completo: así nunca queda un docente operativo sin escuela, ni
      // siquiera por un instante ni por una escritura a medias.
      const escuela = plantel ? await resolveSchoolSelection(plantel, currentUser.uid) : null
      const updates = {
        ...(escuela ? { escuelaId: escuela.escuelaId, schoolName: escuela.schoolName } : {}),
        nombre: realNombre.trim(),
        apellidoPaterno: apellidoPaterno.trim(),
        apellidoMaterno: apellidoMaterno.trim(),
        nombreMostrar: nombre.trim(),
        prefijo,
        // Estado, municipio y ciudad se guardan resueltos junto al CP para
        // poder agrupar por zona sin volver a cargar el catálogo.
        codigoPostal: soloDigitosCP(codigoPostal),
        estado: ubicacion.estado,
        municipio: ubicacion.municipio,
        ciudad: ubicacion.ciudad,
        profileComplete: true,
      }
      await updateDoc(doc(db, 'users', currentUser.uid), updates)
      setUserProfile((p) => ({ ...p, ...updates }))
      navigate('/dashboard')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-surface py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-card bg-accent flex items-center justify-center mx-auto mb-3">
            <GraduationCap size={32} className="text-white" />
          </div>
          {/* Un solo título para los dos casos (perfil nuevo o cuenta vieja a
              la que le falta la escuela): el formulario es el mismo y los
              campos ya dicen qué se pide. El párrafo que explicaba por qué se
              necesita la escuela se quitó — nadie lo lee y empujaba el
              formulario fuera de pantalla en móvil. */}
          <h1 className="text-2xl font-bold text-on-surface">Completa tu perfil</h1>
        </div>

        <div className="bg-surface-card rounded-card shadow-card p-5">
          {/* space-y-4: un solo ritmo vertical para todo el formulario. Antes
              era space-y-3 y algunos campos añadían su propio <p> debajo, así
              que la separación real cambiaba de campo a campo. */}
          <form onSubmit={finish} className="space-y-4">
            <Input
              id="onboarding-real-nombre"
              label="Nombre(s)"
              type="text"
              value={realNombre}
              onChange={(e) => setRealNombre(e.target.value)}
              required
              // Primer campo del último paso del alta: el docente llega con la
              // intención de escribir, no de explorar la pantalla. Es el caso
              // que la propia regla admite como excepción razonable.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Ej. Laura"
            />
            {/* Las dos etiquetas tienen que caber en UN renglón para que los
                dos campos empiecen a la misma altura. En una tarjeta max-w-sm
                cada columna mide ~180 px: "Apellido materno (opcional)" se
                parte en dos y baja su campo. Por eso el "(opcional)" va como
                `hint`, que el componente pinta DEBAJO del campo y por tanto no
                puede mover nada de la fila. */}
            <div className="flex gap-2">
              <Input
                id="onboarding-apellido-paterno"
                label="Apellido paterno"
                type="text"
                value={apellidoPaterno}
                onChange={(e) => setApellidoPaterno(e.target.value)}
                required
                placeholder="Ej. García"
                wrapperClassName="flex-1 min-w-0"
              />
              <Input
                id="onboarding-apellido-materno"
                label="Apellido materno"
                optional
                type="text"
                value={apellidoMaterno}
                onChange={(e) => setApellidoMaterno(e.target.value)}
                placeholder="Ej. Pérez"
                wrapperClassName="flex-1 min-w-0"
              />
            </div>
            {/* Sin marca de "obligatorio": se pide igual que los demás datos y
                simplemente no se avanza sin él (validado en finish()). */}
            <CodigoPostalField
              id="onboarding-cp"
              value={codigoPostal}
              onChange={setCodigoPostal}
              labelClassName="block text-sm font-medium text-muted mb-1"
              inputClassName="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
            />

            {/* El párrafo que explicaba que este nombre puede ser un apodo se
                quitó: el ejemplo del placeholder ya lo dice, y ocupaba tres
                renglones a media pantalla. Las etiquetas de los dos campos
                usan la misma escala (text-sm del Input/Select), no una text-xs
                suelta como antes. */}
            <div>
              <p className="block text-sm font-medium text-muted mb-2">¿Cómo quieres que te vean tus estudiantes?</p>
              <div className="flex gap-2 items-start">
                <div className="w-32 sm:w-36 flex-shrink-0">
                  <Select
                    id="onboarding-prefijo"
                    label="Prefijo"
                    optional
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
                      placeholder="Escribe el prefijo"
                      wrapperClassName="mt-2"
                    />
                  )}
                </div>
                <Input
                  id="onboarding-nombre"
                  label="Nombre"
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  placeholder="Ej. Profa. Laura"
                  wrapperClassName="flex-1 min-w-0"
                />
              </div>
            </div>

            {/* Escuela: obligatoria. No hay opción de seguir sin una — si la
                suya no está en el catálogo, la da de alta desde el mismo
                selector, sin necesidad de saberse la Clave del Centro de
                Trabajo. */}
            <div>
              <span className="block text-sm font-medium text-muted mb-1">Tu escuela</span>
              <button
                type="button"
                onClick={() => setShowSchoolPicker(true)}
                disabled={saving}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-60"
              >
                <School size={17} className="text-accent flex-shrink-0" />
                <span className={`text-sm truncate flex-1 ${plantelLabel ? 'text-on-surface font-medium' : 'text-slate-500'}`}>
                  {plantelLabel || 'Elige tu escuela'}
                </span>
                <span className="text-xs text-accent font-semibold flex-shrink-0">{plantelLabel ? 'Cambiar' : 'Buscar'}</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={saving || (!plantel && !escuelaValida(userProfile?.escuelaId))}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Guardando…' : 'Entrar al panel'}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setShowNoContinuar(true)}
          disabled={saving}
          className="w-full text-center text-sm text-muted hover:text-error mt-4 transition-colors disabled:opacity-60"
        >
          No continuar
        </button>
      </div>

      {showSchoolPicker && (
        <SchoolPicker
          onSelect={(p) => { setPlantel(p); setShowSchoolPicker(false) }}
          onClose={() => setShowSchoolPicker(false)}
        />
      )}

      {showNoContinuar && (
        <ConfirmModal
          title="¿No quieres continuar?"
          message="No quedará ninguna cuenta registrada con este correo: la borraremos por completo y regresarás a Crear cuenta, donde puedes intentar con otro correo o con Google."
          confirmLabel="No continuar"
          confirmingLabel="Un momento…"
          confirmIcon={<Trash2 size={16} />}
          danger
          busy={cancelando}
          onConfirm={noContinuar}
          onCancel={() => !cancelando && setShowNoContinuar(false)}
        />
      )}
    </div>
  )
}
