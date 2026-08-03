import { useState, useRef, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { collection, doc, getDocs, query, updateDoc, where, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import ConfirmModal from '../../components/ConfirmModal'
import PasswordInput from '../../components/PasswordInput'
import { usePlanteles } from '../../data/usePlanteles'
import { resolveSchoolSelection, normalizeName, findSimilarSchools } from '../../utils/schoolSelection'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { Camera, Lock, User, X, CreditCard, School, ChevronDown, Plus, Trash2, Upload, ImagePlus } from 'lucide-react'
import SearchInput from '../../components/SearchInput'
import { useSubscription } from '../../hooks/useSubscription'
import CheckoutModal from '../../components/CheckoutModal'
import { useBackHandler } from '../../hooks/useBackHandler'
import AvatarCropModal from '../../components/AvatarCropModal'
import { useScrollLock } from '../../hooks/useScrollLock'
import {
  TRIAL_DURATION_DAYS,
  ANNUAL_PLAN_ID,
  ANNUAL_PRICE_MXN,
  ANNUAL_SUBSCRIPTION_NAME,
  MONTHLY_PLAN_ID,
  MONTHLY_PRICE_MXN,
  SUBSCRIPTION_NAME,
  calcDaysRemaining,
  calcTrialEnd,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  getDaysLabel,
  getPaymentStatusColor,
  getPaymentStatusLabel,
  getSubscriptionStatusColor,
  canRenew as canRenewSubscription,
  isSubscriptionExpired,
  diasParaEliminacion,
  fechaEliminacion,
} from '../../utils/subscriptionHelpers'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { IS_NATIVE_APP } from '../../utils/platform'
import { errorCodigoPostal, soloDigitosCP } from '../../utils/codigoPostal'
import { useUbicacionCP } from '../../data/useCodigoPostal'
import CodigoPostalField from '../../components/CodigoPostalField'
import EliminarCuentaModal from '../../components/EliminarCuentaModal'
import { sendSubscriptionCancelledEmail } from '../../utils/accountEmails'
import { apiUrl } from '../../utils/apiBase'
import { PREFIJOS } from '../../utils/prefijos'

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

  // School
  const [showSchoolPicker, setShowSchoolPicker] = useState(false)
  useBackHandler(() => setShowSchoolPicker(false), showSchoolPicker)
  useScrollLock(showSchoolPicker)
  const [schoolSearch, setSchoolSearch] = useState('')
  const [savingSchool, setSavingSchool] = useState(false)
  const [addingCustomSchool, setAddingCustomSchool] = useState(false)
  // 'form' (typing the data) → 'similar' (possible matches found, asking if
  // it's one of them) → 'confirm' (final review before actually saving).
  const [customSchoolStep, setCustomSchoolStep] = useState('form')
  const [similarSchools, setSimilarSchools] = useState([])
  const [customSchoolName, setCustomSchoolName] = useState('')
  const [customSchoolCCT, setCustomSchoolCCT] = useState('')
  const [customSchoolCity, setCustomSchoolCity] = useState('')
  const [customSchoolState, setCustomSchoolState] = useState('')
  const [customSchools, setCustomSchools] = useState([])
  const [customSchoolsLoaded, setCustomSchoolsLoaded] = useState(false)
  const { planteles, loading: catalogLoading } = usePlanteles()

  // Schools added by hand (not in the static catalog) live in Firestore — load
  // them once the picker opens so they're searchable too, not just the catalog.
  useEffect(() => {
    if (!showSchoolPicker || customSchoolsLoaded) return
    getDocs(query(collection(db, 'schools'), where('custom', '==', true)))
      .then((snap) => setCustomSchools(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setCustomSchoolsLoaded(true))
  }, [showSchoolPicker, customSchoolsLoaded])

  const filteredPlanteles = useMemo(() => {
    const q = normalizeName(schoolSearch)
    if (!q) return []
    return planteles.filter((p) =>
      normalizeName(p.nombre || '').includes(q) || normalizeName(p.short || '').includes(q) ||
      normalizeName(p.cct || '').includes(q) || normalizeName(p.mun || '').includes(q)
    ).slice(0, 80)
  }, [planteles, schoolSearch])

  const filteredCustomSchools = useMemo(() => {
    const q = normalizeName(schoolSearch)
    if (!q) return []
    return customSchools.filter((s) => normalizeName(s.nombre || '').includes(q))
  }, [customSchools, schoolSearch])

  function openCustomSchoolForm() {
    setCustomSchoolName(schoolSearch.trim())
    setCustomSchoolCCT('')
    setCustomSchoolCity('')
    setCustomSchoolState('')
    setCustomSchoolStep('form')
    setSimilarSchools([])
    setAddingCustomSchool(true)
  }

  // Catches obvious junk (empty, too short, no letters at all) without
  // blocking real names the static catalog wouldn't recognize — it can't
  // verify the school is real, just that what was typed looks like a name.
  function looksLikeText(value, minLen) {
    const v = value.trim()
    return v.length >= minLen && /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(v)
  }

  function reviewCustomSchool(e) {
    e.preventDefault()
    if (!looksLikeText(customSchoolName, 4)) {
      toast('Escribe el nombre completo de la escuela', 'error')
      return
    }
    if (!looksLikeText(customSchoolCity, 2)) {
      toast('Escribe la ciudad o municipio', 'error')
      return
    }
    if (!looksLikeText(customSchoolState, 2)) {
      toast('Escribe el estado', 'error')
      return
    }
    if (customSchoolCCT.trim() && !/^[a-zA-Z0-9]+$/.test(customSchoolCCT.trim())) {
      toast('La clave del centro de trabajo solo debe tener letras y números', 'error')
      return
    }

    const name = customSchoolName.trim()
    const mun = customSchoolCity.trim()
    const edo = customSchoolState.trim()
    const candidates = [
      ...customSchools.map((s) => ({
        kind: 'custom', id: s.id, nombre: s.nombre, municipio: s.municipio, estado: s.estado, claveSEP: s.claveSEP,
      })),
      ...planteles.map((p) => ({
        kind: 'catalog', plantel: p, nombre: p.nombre || p.short, municipio: p.mun, estado: p.edo, claveSEP: p.cct,
      })),
    ]
    const matches = findSimilarSchools(name, mun, edo, candidates)
    if (matches.length) {
      setSimilarSchools(matches.slice(0, 5))
      setCustomSchoolStep('similar')
    } else {
      setCustomSchoolStep('confirm')
    }
  }

  async function chooseSimilarSchool(candidate) {
    if (candidate.kind === 'custom') {
      await updateSchool({ existingId: candidate.id, nombre: candidate.nombre })
    } else {
      await updateSchool(candidate.plantel)
    }
    setAddingCustomSchool(false)
  }

  async function submitCustomSchool() {
    await updateSchool({
      custom: true,
      nombre: customSchoolName.trim(),
      short: customSchoolName.trim(),
      cct: customSchoolCCT.trim(),
      mun: customSchoolCity.trim(),
      edo: customSchoolState.trim(),
    })
    setAddingCustomSchool(false)
  }

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

  const [showPaymentModal, setShowPaymentModal] = useState(false)

  // Cancelar suscripción / eliminar cuenta
  const [cancelandoSub, setCancelandoSub] = useState(false)
  const [showEliminarCuenta, setShowEliminarCuenta] = useState(false)
  useBackHandler(() => setShowEliminarCuenta(false), showEliminarCuenta)

  // Reenviar un pago por transferencia que el admin rechazó — pedido
  // explícito: adjuntar foto del comprobante (con el folio visible) y
  // volver a mandarlo a revisión. Las reglas de Firestore solo dejan al
  // docente CREAR pagos, no actualizar uno existente (ver
  // firestore.rules match /payments/{paymentId}), así que reenviar crea un
  // documento nuevo — nunca se toca el rechazado, que queda como historial.
  const [resendPayment, setResendPayment] = useState(null) // el pago rechazado que se está reenviando
  const [resendFolio, setResendFolio] = useState('')
  const [resendFile, setResendFile] = useState(null)
  const [resendSubmitting, setResendSubmitting] = useState(false)
  useBackHandler(() => setResendPayment(null), !!resendPayment)
  useScrollLock(!!resendPayment)

  const {
    subscription,
    recentPayments,
    transferenciaEnRevision,
    pagoLiquidando,
    loading: subLoading,
    refresh: refreshSub,
  } = useSubscription()

  function openResend(payment) {
    setResendFolio(payment.referencia || '')
    setResendFile(null)
    setResendPayment(payment)
  }

  async function submitResend(e) {
    e.preventDefault()
    if (!resendFolio.trim()) return toast('Ingresa la referencia', 'error')
    if (!resendFile) return toast('Adjunta la foto de tu comprobante', 'error')
    setResendSubmitting(true)
    try {
      const comprobanteUrl = await uploadToCloudinary(resendFile, 'evalua-facil/comprobantes')
      const batch = writeBatch(db)
      batch.set(doc(collection(db, 'payments')), {
        docenteId: currentUser.uid,
        subscriptionId: subscription?.id || resendPayment.subscriptionId || null,
        planId: resendPayment.planId || MONTHLY_PLAN_ID,
        escuelaId: userProfile?.escuelaId || '',
        monto: resendPayment.monto ?? MONTHLY_PRICE_MXN,
        metodo: 'transferencia',
        referencia: resendFolio.trim(),
        comprobanteUrl,
        reenvioDePagoId: resendPayment.id,
        status: 'pendiente',
        createdAt: serverTimestamp(),
      })
      if (subscription?.id) {
        batch.update(doc(db, 'subscriptions', subscription.id), {
          status: 'pendiente_pago',
          updatedAt: serverTimestamp(),
        })
      }
      await batch.commit()
      toast('Reenviado. Lo revisamos dentro de las próximas 12 horas.')
      setResendPayment(null)
      refreshSub()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setResendSubmitting(false)
    }
  }
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

  // ── Cancelar suscripción ────────────────────────────────────────────────
  // No borra nada: el acceso sigue hasta la fecha ya cubierta y solo deja de
  // renovarse. El cambio de estado lo hace el servidor (ver
  // api/account/cancel-subscription.js); aquí solo se pide confirmación,
  // se refresca la tarjeta y se manda el correo.
  function requestCancelSub() {
    const hasta = formatDate(effectiveVencimiento(subscription))
    const hastaBorrado = formatDate(fechaEliminacion(subscription))
    setConfirm({
      title: 'Cancelar mi suscripción',
      message: `Luego de ${hasta}, podrás seguir teniendo acceso a toda la información que hayas creado hasta ese momento, hasta por 90 días más (${hastaBorrado}). Al renovar podrás seguir usando Evalúa Fácil de forma normal. ¿Confirmas?`,
      onConfirm: executeCancelSub,
    })
  }

  async function executeCancelSub() {
    setCancelandoSub(true)
    try {
      const token = await currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/account/cancel-subscription'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo cancelar la suscripción')

      // El correo es lo último y no puede tumbar la cancelación, que ya está
      // hecha en el servidor — si falla, el docente igual ve el estado nuevo.
      sendSubscriptionCancelledEmail({
        email: currentUser.email,
        accesoHasta: formatDate(effectiveVencimiento(subscription)),
        eraTrial: data.eraTrial,
      }).catch(() => {})

      await refreshSub()
      toast('Suscripción cancelada. Te mandamos un correo de confirmación.')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCancelandoSub(false)
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

  const displayName = userProfile?.nombreMostrar || 'Docente'
  const initials = displayName.charAt(0).toUpperCase()
  const daysRemaining = subscription ? calcDaysRemaining(effectiveVencimiento(subscription)) : null
  const canRenew = canRenewSubscription(subscription, {
    transferenciaEnRevision: !!transferenciaEnRevision,
  })
  // planId solo se pone al aprobar un pago de verdad (ver PaymentsTable.jsx
  // handleApprove) — createTeacherAccount crea la prueba con planId: ''. Si
  // sigue vacío, este docente NUNCA tuvo un pago aprobado, sin importar qué
  // tan lejos haya llegado el status (pendiente_pago, cancelada…): sus
  // fechaInicio/fechaVencimiento siguen siendo los de su prueba original.
  const nuncaAprobado = !subscription?.planId
  // Cuando SÍ hubo un pago real aprobado pero todavía quedaban días de
  // prueba en ese momento, el plan pagado arranca hasta que esos días se
  // agoten (política de "no se recorta nada" — ver handleApprove en el
  // admin). Mientras tanto el docente sigue literalmente en su prueba, así
  // que sus fechas no deben desaparecer solo porque ya haya un plan pagado
  // esperando turno. `createdAt` es el único campo que handleApprove NUNCA
  // toca — sigue siendo la fecha real de alta, de ahí se recalcula la
  // prueba sin importar qué le haya pasado después a fechaInicio.
  const finDePrueba = subscription?.createdAt ? calcTrialEnd(subscription.createdAt) : null
  const siguePrueba = !nuncaAprobado && finDePrueba && (calcDaysRemaining(finDePrueba) ?? -1) >= 0
  // Solo se ofrece cancelar cuando hay algo que cancelar. En período de
  // prueba no aparece: no hay ningún cobro que detener, y un botón
  // "cancelar" ahí solo haría dudar a quien apenas está probando.
  const puedeCancelar = subscription?.status === 'activa' || subscription?.status === 'pendiente_pago'
  // Vencida por cualquier motivo (no pagó, o él la canceló y ya se le acabaron
  // los días cubiertos): mismo mensaje terminal en ambos casos.
  const expirada = subscription ? isSubscriptionExpired(subscription) : false
  // Canceló pero todavía le quedan días pagados: sigue viendo su plan con
  // normalidad — no se le anuncia "cancelada" antes de tiempo — solo se le
  // avisa que no se va a renovar.
  const enGraciaCancelada = subscription?.status === 'cancelada' && !expirada

  return (
    <>
      <div className={`px-4 py-4 space-y-4 ${TEACHER_CONTAINER_NARROW}`}>

        {/* Mi plan */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <CreditCard size={19} className="text-slate-400" /> Mi plan
          </h2>
          {subLoading ? (
            <div className="flex justify-center py-2"><Spinner /></div>
          ) : subscription ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {subscription.status === 'trial' || nuncaAprobado ? (
                    <>
                      <p className="font-bold text-on-surface">Período de prueba</p>
                      <p className="text-sm text-muted">
                        {TRIAL_DURATION_DAYS} días gratuitos
                        {subscription.fechaInicio && <> · empieza el {formatDate(subscription.fechaInicio)}</>}
                        {' '}· termina el {formatDate(effectiveVencimiento(subscription))}
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Anual es siempre pago único (nunca domiciliado, ver
                          CheckoutModal). Entre los dos mensuales: domiciliada
                          (Mercado Pago cobra solo cada mes) sigue llamándose
                          "Suscripción mensual"; un pago manual (transferencia
                          o PayPal de una sola exhibición) es literal un mes
                          ya pagado, no una suscripción en curso — mismo
                          criterio que en el admin (ver situacionSuscripcion.js). */}
                      <p className="font-bold text-on-surface">
                        {subscription.planId === ANNUAL_PLAN_ID
                          ? ANNUAL_SUBSCRIPTION_NAME
                          : subscription.mpPreapprovalId ? SUBSCRIPTION_NAME : 'Mes pagado'}
                      </p>
                      <p className="text-sm text-muted">
                        {subscription.planId === ANNUAL_PLAN_ID
                          ? `${formatCurrency(ANNUAL_PRICE_MXN)}/año`
                          : `${formatCurrency(MONTHLY_PRICE_MXN)}/mes`}
                      </p>
                    </>
                  )}
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    expirada ? 'bg-slate-100 text-slate-600' : getSubscriptionStatusColor(subscription.status)
                  }`}
                >
                  {expirada ? 'Suscripción cancelada' : subscription.status?.replace('_', ' ')}
                </span>
              </div>
              {/* Pedido explícito: que cualquiera entienda de un vistazo que
                  con Mercado Pago no hay nada que aprobar — el cobro se repite
                  solo cada mes. Solo aplica a la domiciliada YA activa; una
                  transferencia o un PayPal de una sola exhibición ("Mes
                  pagado") si requieren que el docente vuelva a pagar cada mes. */}
              {subscription.mpPreapprovalId && subscription.status === 'activa' && !expirada && (
                <p className="text-xs text-emerald-600 font-medium">
                  Pago automático: se cobra solo cada mes desde tu tarjeta — no tienes que volver a
                  pagar ni esperar aprobación de nadie.
                </p>
              )}
              <p className="text-xs text-slate-400">Hoy: {formatDate(new Date())}</p>
              {/* nuncaAprobado: nunca hubo un pago aprobado por el admin — el
                  status pudo cambiar (pendiente_pago, cancelada) pero
                  fechaInicio/fechaVencimiento siguen siendo los de SU
                  PRUEBA (createTeacherAccount los deja ahí desde el
                  registro; solo handleApprove en el admin los reescribe con
                  fechas reales). Mostrar "Pagaste el X" aquí sería afirmar
                  un pago que nunca se aprobó — bug real detectado con una
                  cuenta de prueba (chary560@gmail.com, 2026-08-02). */}
              {/* "Tu plan cubre del X al Y", no "Pagaste el X": cuando aún
                  quedaban días vigentes al aprobar, el periodo pagado
                  arranca cuando esos días se agotan (política de "no se
                  recorta nada"), y esa fecha puede ser futura — "Pagaste el
                  [fecha futura]" no tenía sentido con la fecha de hoy al
                  lado. Mismo lenguaje que ya usa CheckoutModal ("Este pago
                  cubre del X al Y") para la promesa antes de pagar. */}
              {subscription.status !== 'trial' && !nuncaAprobado && subscription.fechaInicio && (
                <p className="text-xs text-slate-400">
                  Tu plan cubre del {formatDate(subscription.fechaInicio)} al{' '}
                  {formatDate(effectiveVencimiento(subscription))}
                </p>
              )}
              {/* Sigue disfrutando su prueba aunque ya haya un pago real
                  aprobado esperando turno — pedido explícito, sus fechas de
                  prueba no deben desaparecer solo por eso. */}
              {siguePrueba && (
                <p className="text-xs text-emerald-600">
                  Todavía estás en tu período de prueba: empezó el {formatDate(subscription.createdAt)} y
                  termina el {formatDate(finDePrueba)}.
                </p>
              )}
              {daysRemaining !== null && !expirada && (
                <p
                  className={`text-sm font-medium ${
                    daysRemaining <= 7 && !enGraciaCancelada ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {getDaysLabel(daysRemaining)}
                </p>
              )}
              {enGraciaCancelada && (
                <p className="text-sm text-muted">
                  Cancelaste tu suscripción — sigues usando todo con normalidad hasta el{' '}
                  {formatDate(effectiveVencimiento(subscription))}, cuando tu cuenta pasará a “Suscripción cancelada”.
                </p>
              )}
              {subscription.status === 'activa' && !expirada && daysRemaining !== null && daysRemaining <= 7 && (
                <p className="text-sm text-amber-600">
                  Si no renuevas, el {formatDate(effectiveVencimiento(subscription))} tu cuenta pasará a
                  “Suscripción cancelada” (conservas todo, solo no puedes seguir creando).
                </p>
              )}
              {/* Solo se anuncian estados en los que el dinero SÍ se movió.
                  Antes bastaba con `status === 'pendiente_pago'`, que el
                  servidor ponía nomás abrir la pasarela: con solo presionar
                  "Pagar con Mercado Pago" —sin pagar nada— esto ya decía que
                  el pago estaba en revisión y prometía una aprobación en 12
                  horas que, para tarjeta, ni siquiera existe (esos cobros los
                  confirma el webhook, no una persona). */}
              {transferenciaEnRevision && (
                <p className="text-sm text-amber-600">
                  Tu transferencia está en revisión. La aprobamos dentro de las 12 horas siguientes a
                  que la registraste — vuelve a checar aquí.
                </p>
              )}
              {pagoLiquidando && (
                <p className="text-sm text-amber-600">
                  Tu pago todavía no se acredita. Tu suscripción se activará sola en cuanto se
                  confirme — no hace falta que vuelvas a pagar ni que nadie lo apruebe.
                </p>
              )}
              {expirada && (
                <p className="text-sm text-red-600">
                  Tus grupos, estudiantes, actividades, entregas y calificaciones siguen disponibles. Solo no puedes
                  crear ni editar hasta que actives tu suscripción.
                </p>
              )}
              {expirada && (
                <p className="text-sm text-red-600">
                  {(() => {
                    const dias = diasParaEliminacion(subscription)
                    const fecha = formatDate(fechaEliminacion(subscription))
                    return dias > 0
                      ? `Guardamos toda tu información hasta el ${fecha} (${dias} día${dias === 1 ? '' : 's'} más) por si decides volver. Después de esa fecha se elimina definitivamente.`
                      : 'Está a punto de eliminarse definitivamente. Reactiva para conservarla.'
                  })()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No tienes un plan activo.</p>
          )}
          {canRenew && (
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="mt-2 w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded text-sm transition-colors"
            >
              {subscription?.status === 'trial' || nuncaAprobado
                ? 'Suscripción mensual'
                : subscription && !expirada
                  ? 'Renovar suscripción mensual'
                  : 'Activar suscripción mensual'}
            </button>
          )}
          {puedeCancelar && (
            <button
              type="button"
              onClick={requestCancelSub}
              disabled={cancelandoSub}
              className="mt-2 w-full py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60"
            >
              {cancelandoSub ? 'Cancelando…' : 'Cancelar suscripción'}
            </button>
          )}
          {recentPayments.length > 0 && (
            <div className="mt-2 pt-4 border-t border-outline-variant">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Últimos pagos</p>
              <ul className="space-y-2">
                {recentPayments.map((p) => (
                  <li key={p.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">{formatDate(p.createdAt)}</span>
                      <span className="font-medium">{formatCurrency(p.monto)}</span>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(p.status)}`}
                      >
                        {getPaymentStatusLabel(p.status)}
                      </span>
                    </div>
                    {/* Antes un pago rechazado quedaba mudo — ni el motivo ni
                        forma de corregirlo. Pedido explícito: mostrar por qué
                        y dejar adjuntar el comprobante para reenviarlo. */}
                    {p.status === 'rechazado' && (
                      <div className="mt-1 pl-1 border-l-2 border-red-200 space-y-1">
                        {p.notasAdmin && <p className="text-xs text-red-600">{p.notasAdmin}</p>}
                        <button
                          type="button"
                          onClick={() => openResend(p)}
                          className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                        >
                          <ImagePlus size={13} /> Adjuntar comprobante que tenga el folio y reenviar, por favor
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Reenviar pago rechazado con foto del comprobante */}
        {resendPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !resendSubmitting && setResendPayment(null)} aria-label="Cerrar" />
            <form onSubmit={submitResend} className="relative bg-surface-card rounded-card p-5 w-full max-w-sm shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-on-surface">Reenviar pago</h3>
                <button type="button" onClick={() => setResendPayment(null)} className="text-slate-400 hover:text-muted">
                  <X size={20} />
                </button>
              </div>
              {resendPayment.notasAdmin && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  Motivo del rechazo: {resendPayment.notasAdmin}
                </p>
              )}
              <div>
                <label htmlFor="resend-folio" className="block text-sm font-medium text-muted mb-1">Folio de operación / folio bancario</label>
                <input
                  id="resend-folio"
                  type="text"
                  value={resendFolio}
                  onChange={(e) => setResendFolio(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Folio de operación / folio bancario"
                />
              </div>
              <div>
                <label htmlFor="resend-file" className="block text-sm font-medium text-muted mb-1">Foto de tu comprobante (donde se vea el folio)</label>
                <input
                  id="resend-file"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setResendFile(e.target.files?.[0] || null)}
                  required
                  className="w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:font-semibold file:text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={resendSubmitting}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {resendSubmitting ? <Spinner size="sm" /> : <Upload size={18} />}
                {resendSubmitting ? 'Enviando…' : 'Reenviar a revisión'}
              </button>
              <p className="text-xs text-slate-500 text-center">
                Lo revisamos dentro de las 12 horas siguientes a tu reenvío.
              </p>
            </form>
          </div>
        )}

        <CheckoutModal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          subscription={subscription}
          onSuccess={refreshSub}
        />

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
              labelClassName="block text-xs font-medium text-muted mb-1"
              inputClassName={inputCls}
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
                <label htmlFor="prof-prefijo" className="block text-xs font-medium text-muted mb-1">
                  Prefijo <span className="text-slate-400 font-normal hidden sm:inline">(opcional)</span>
                </label>
                <select id="prof-prefijo" value={prefijoOption} onChange={(e) => setPrefijoOption(e.target.value)}
                  className={inputCls}>
                  <option value="">Sin prefijo (predeterminado)</option>
                  {PREFIJOS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  <option value="__otro__">Otro… (escríbelo)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1 sm:hidden">(opcional)</p>
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
              <p className="text-sm text-slate-500 mt-0.5">Los docentes de la misma escuela comparten el mismo registro — pero cada quien da de alta a sus propios alumnos por separado.</p>
            </div>
            <button type="button" onClick={() => { setSchoolSearch(''); setAddingCustomSchool(false); setCustomSchoolStep('form'); setShowSchoolPicker(true) }}
              className="text-accent text-sm font-semibold hover:underline flex-shrink-0">Cambiar</button>
          </div>
        </div>

        {/* Aviso de privacidad */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <Link to="/privacidad" className="text-sm text-accent font-semibold hover:underline">
            Aviso de privacidad
          </Link>
        </div>

        {/* Eliminar cuenta — hasta el fondo y en rojo, la única parte de la
            app que no usa el azul del docente: es lo que la separa de todo lo
            demás que se puede tocar sin miedo. */}
        <div className="bg-surface-card rounded-card shadow-card p-3">
          <h2 className="font-semibold text-on-surface mb-2 flex items-center gap-2">
            <Trash2 size={19} className="text-slate-400" /> Eliminar mi cuenta
          </h2>
          <p className="text-sm text-muted mb-2">
            Borra para siempre tu cuenta y todo tu trabajo: asignaturas, estudiantes, actividades,
            calificaciones y asistencias. No se puede deshacer.
          </p>
          <button
            type="button"
            onClick={() => setShowEliminarCuenta(true)}
            className="w-full py-2 rounded border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
          >
            Eliminar mi cuenta
          </button>
        </div>

        <p className="text-center text-xs text-muted">Evalúa Fácil versión 1.0.1</p>

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

      {/* School picker overlay */}
      {showSchoolPicker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !savingSchool && setShowSchoolPicker(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-sm rounded-card shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center gap-2 p-3 border-b border-outline-variant">
              <div className="flex-1">
                <SearchInput
                  value={schoolSearch}
                  onChange={setSchoolSearch}
                  placeholder="Nombre, CCT o municipio…"
                />
              </div>
              <button type="button" onClick={() => setShowSchoolPicker(false)} aria-label="Cerrar" className="p-2 text-slate-400 hover:text-muted rounded"><X size={19} /></button>
            </div>
            {addingCustomSchool && customSchoolStep === 'similar' ? (
              <div className="p-3 space-y-2 overflow-y-auto">
                <p className="text-sm text-muted">
                  Encontramos escuelas parecidas — ¿es alguna de estas la misma que quieres agregar?
                </p>
                <ul className="space-y-2">
                  {similarSchools.map((c, i) => (
                    <li key={`${c.claveSEP || c.nombre}-${i}`}>
                      <button type="button" onClick={() => chooseSimilarSchool(c)} disabled={savingSchool}
                        className="w-full text-left px-3 py-2 rounded border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                        <p className="text-sm font-medium text-on-surface leading-tight">{c.nombre}</p>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {[c.claveSEP, [c.municipio, c.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomSchoolStep('form')} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Volver
                  </button>
                  <button type="button" onClick={() => setCustomSchoolStep('confirm')} disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60">
                    Ninguna, es nueva
                  </button>
                </div>
              </div>
            ) : addingCustomSchool && customSchoolStep === 'confirm' ? (
              <div className="p-3 space-y-2">
                <p className="text-sm text-muted">¿Confirmas que la escuela a agregar es esta?</p>
                <div className="bg-surface rounded p-3 border border-outline-variant space-y-1">
                  <p className="text-sm font-semibold text-on-surface">{customSchoolName.trim()}</p>
                  {customSchoolCCT.trim() && <p className="text-sm text-slate-500">CCT: {customSchoolCCT.trim()}</p>}
                  <p className="text-sm text-slate-500">{customSchoolCity.trim()}, {customSchoolState.trim()}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomSchoolStep(similarSchools.length ? 'similar' : 'form')} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Volver
                  </button>
                  <button type="button" onClick={submitCustomSchool} disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingSchool ? <Spinner size="sm" /> : null}
                    {savingSchool ? 'Guardando…' : 'Confirmar y agregar'}
                  </button>
                </div>
              </div>
            ) : addingCustomSchool ? (
              <form onSubmit={reviewCustomSchool} className="p-3 space-y-2 overflow-y-auto">
                <div>
                  <label htmlFor="prof-escuela-nombre" className="block text-sm font-medium text-muted mb-1">Nombre oficial de la escuela</label>
                  <input
                    id="prof-escuela-nombre"
                    type="text"
                    value={customSchoolName}
                    onChange={(e) => setCustomSchoolName(e.target.value)}
                    required
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Ej. Escuela Secundaria Técnica N.° 12"
                  />
                </div>
                <div>
                  <label htmlFor="prof-escuela-cct" className="block text-sm font-medium text-muted mb-1">
                    Clave del centro de trabajo (CCT) <span className="text-slate-500 font-normal text-xs">(opcional)</span>
                  </label>
                  <input
                    id="prof-escuela-cct"
                    type="text"
                    value={customSchoolCCT}
                    onChange={(e) => setCustomSchoolCCT(e.target.value)}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="Ej. 15ECT0001H"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label htmlFor="prof-escuela-ciudad" className="block text-sm font-medium text-muted mb-1">Ciudad / municipio</label>
                    <input
                      id="prof-escuela-ciudad"
                      type="text"
                      value={customSchoolCity}
                      onChange={(e) => setCustomSchoolCity(e.target.value)}
                      required
                      className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                      placeholder="Ej. Celaya"
                    />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="prof-escuela-estado" className="block text-sm font-medium text-muted mb-1">Estado</label>
                    <input
                      id="prof-escuela-estado"
                      type="text"
                      value={customSchoolState}
                      onChange={(e) => setCustomSchoolState(e.target.value)}
                      required
                      className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                      placeholder="Ej. Guanajuato"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddingCustomSchool(false)} disabled={savingSchool}
                    className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    Cancelar
                  </button>
                  <button type="submit" disabled={savingSchool}
                    className="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    Continuar
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button type="button" onClick={() => updateSchool(null)} disabled={savingSchool}
                  className="flex items-center gap-2 px-4 py-2 text-left border-b border-outline-variant hover:bg-[var(--accent-tint)] disabled:opacity-60">
                  <ChevronDown size={17} className="text-slate-400 rotate-0" />
                  <span className="text-sm font-medium text-muted">Sin escuela</span>
                </button>
                {schoolSearch.trim() && (
                  catalogLoading ? (
                    <div className="flex justify-center py-10"><Spinner /></div>
                  ) : (
                    <ul className="overflow-y-auto flex-1 divide-y divide-slate-100">
                      {filteredPlanteles.length === 0 && filteredCustomSchools.length === 0 && (
                        <li className="text-center text-slate-500 text-sm py-10">Sin resultados</li>
                      )}
                      {filteredCustomSchools.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => updateSchool({ existingId: s.id, nombre: s.nombre })} disabled={savingSchool}
                            className="w-full text-left px-4 py-2 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                            <p className="text-sm font-medium text-on-surface leading-tight">{s.nombre}</p>
                            {(s.claveSEP || s.municipio || s.estado) && (
                              <p className="text-sm text-slate-500 mt-0.5">
                                {[s.claveSEP, [s.municipio, s.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </button>
                        </li>
                      ))}
                      {filteredPlanteles.map((p) => (
                        <li key={p.cct}>
                          <button type="button" onClick={() => updateSchool(p)} disabled={savingSchool}
                            className="w-full text-left px-4 py-2 hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                            <p className="text-sm font-medium text-on-surface leading-tight">{p.short || p.nombre}</p>
                            <p className="text-sm text-slate-500 mt-0.5">{p.cct} · {p.mun}, {p.edo}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                )}
                {schoolSearch.trim() && (
                  <div className="border-t border-outline-variant p-2">
                    <button
                      type="button"
                      disabled={savingSchool}
                      onClick={openCustomSchoolForm}
                      className="w-full flex items-center gap-2 px-4 py-2 rounded text-sm font-medium text-accent hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60"
                    >
                      <Plus size={18} className="flex-shrink-0" />
                      <span className="truncate">¿No la encuentras? Agregar «{schoolSearch.trim()}»</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
