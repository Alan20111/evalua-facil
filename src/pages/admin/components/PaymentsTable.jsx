import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { Bell, BellOff, Check, X, RefreshCw, Archive, ArchiveRestore, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { db } from '../../../firebase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../components/Toast'
import Spinner from '../../../components/Spinner'
import { useBackHandler } from '../../../hooks/useBackHandler'
import { useScrollLock } from '../../../hooks/useScrollLock'
import { useColumnWidths } from '../../../hooks/useColumnWidths'
import SituacionBadge from './StatusBadge'
import { planDe } from '../../../utils/situacionSuscripcion'
import {
  calcVencimiento,
  calcVencimientoTimestamp,
  effectiveVencimiento,
  formatCurrency,
  formatDate,
  formatDateTime,
  getPaymentStatusColor,
  getPaymentStatusLabel,
  montoCoincideConTarifa,
  montoOficialDe,
  toDate,
} from '../../../utils/subscriptionHelpers'

// Igual patrón que Suscripciones: anchos ajustables y recordados por
// separado (storage key propia), con la última columna absorbiendo el
// sobrante para que el total siga llenando el área.
const WIDTHS_KEY = 'admin-pagos-cols-v1'
const COLS = [
  { key: 'transaccion', label: 'Transacción', w: 90 },
  { key: 'correo', label: 'Correo', w: 190 },
  { key: 'monto', label: 'Monto', w: 100 },
  { key: 'medio', label: 'Medio', w: 130 },
  { key: 'folio', label: 'Folio bancario', w: 150 },
  // Mismo Plan que en Suscripciones (Prueba, 1 a 6 meses, Cortesía,
  // Cancelada por fin de prueba/por el usuario/por fin de pago) — no
  // confundir con Verificación, que es del PAGO, no de la suscripción.
  { key: 'situacion', label: 'Plan', w: 150 },
  { key: 'verificacion', label: 'Verificación', w: 130 },
  { key: 'fecha', label: 'Fecha', w: 150 },
  { key: 'comentarios', label: 'Comentarios', w: 170 },
  { key: 'acciones', label: 'Acciones', w: 180 },
]

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getPaymentStatusColor(status)}`}>
      {getPaymentStatusLabel(status)}
    </span>
  )
}

const METODO_LABELS = {
  mercadopago: 'Mercado Pago',
  paypal: 'PayPal',
  transferencia: 'Transferencia',
}

// Comentario editable de la transacción — solo escribe al perder el foco y
// si cambió, para no disparar un update por cada tecla.
function ComentarioCell({ payment, onSaved }) {
  const toast = useToast()
  const [value, setValue] = useState(payment.comentarios || '')

  async function handleBlur() {
    if (value === (payment.comentarios || '')) return
    try {
      await updateDoc(doc(db, 'payments', payment.id), { comentarios: value.trim() })
      toast('Comentario guardado')
      onSaved?.()
    } catch (err) {
      toast('Error al guardar el comentario: ' + err.message, 'error')
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="—"
      className="w-full min-w-[140px] px-2 py-1 rounded border border-transparent bg-transparent text-sm hover:border-outline-variant focus:border-accent focus:bg-surface focus:outline-none"
    />
  )
}

// Interruptor de "Pago nuevo" — push al admin cuando un docente registra un
// pago (ver onPagoCreado en functions/index.js). Opt-out: default activado,
// se guarda en notificationSettings/{uid} (misma colección que docente/
// alumno) apenas se carga, para que el gate del servidor tenga algo que leer
// incluso si el admin nunca toca el interruptor (ausente/true = notifica).
function PagoNotifToggle() {
  const { currentUser } = useAuth()
  const toast = useToast()
  const [habilitado, setHabilitado] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    getDoc(doc(db, 'notificationSettings', currentUser.uid))
      .then((snap) => setHabilitado(snap.exists() ? snap.data().pagoNuevo?.habilitado !== false : true))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [currentUser])

  async function toggle() {
    if (!currentUser) return
    const next = !habilitado
    setHabilitado(next)
    try {
      await setDoc(
        doc(db, 'notificationSettings', currentUser.uid),
        { pagoNuevo: { habilitado: next }, updatedAt: serverTimestamp() },
        { merge: true }
      )
    } catch (err) {
      setHabilitado(!next)
      toast('No se pudo guardar: ' + err.message, 'error')
    }
  }

  if (!loaded) return null
  return (
    <button
      type="button"
      onClick={toggle}
      data-tooltip={habilitado ? 'Avisarme de pagos nuevos: activado' : 'Avisarme de pagos nuevos: apagado'}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors ${
        habilitado
          ? 'border-accent text-accent bg-[var(--accent-tint)]'
          : 'border-outline-variant text-muted hover:bg-[var(--accent-tint)]'
      }`}
    >
      {habilitado ? <Bell size={13} /> : <BellOff size={13} />}
      Aviso de pagos
    </button>
  )
}

export default function PaymentsTable({ stats, onRefresh }) {
  const toast = useToast()
  const [processing, setProcessing] = useState(null)
  const [rejectModal, setRejectModal] = useState(null)
  const [notasAdmin, setNotasAdmin] = useState('')
  const [soloArchivadas, setSoloArchivadas] = useState(false)
  const [deleteArchivado, setDeleteArchivado] = useState(null)
  const { containerRef, widths, total, dragKey, startResize, resetWidths, resetColumn, esRedimensionable } =
    useColumnWidths(WIDTHS_KEY, COLS)

  function closeRejectModal() {
    setRejectModal(null)
    setNotasAdmin('')
  }

  useBackHandler(() => {
    if (deleteArchivado) setDeleteArchivado(null)
    else closeRejectModal()
  }, !!rejectModal || !!deleteArchivado)
  useScrollLock(!!rejectModal || !!deleteArchivado)

  if (!stats) return null

  const { payments, teachers, plans, subscriptions } = stats
  const teachersMap = Object.fromEntries(teachers.map((t) => [t.id, t]))
  const plansMap = Object.fromEntries(plans.map((p) => [p.id, p]))
  const subscriptionsMap = Object.fromEntries((subscriptions || []).map((s) => [s.id, s]))

  // Número de transacción — folio fijo y legible (a diferencia del id de
  // Firestore), asignado por orden cronológico de creación sobre TODOS los
  // pagos (archivados incluidos) para que nunca cambie al archivar/restaurar.
  const porAntiguedad = [...payments].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return ta - tb
  })
  const numeroPorId = Object.fromEntries(porAntiguedad.map((p, i) => [p.id, i + 1]))

  // Folio bancario repetido — el mismo número de operación declarado en dos
  // transacciones distintas. Un folio solo puede corresponder a UN movimiento
  // del banco, así que verlo dos veces significa o un doble registro por
  // accidente, o un intento de cobrar dos meses con una sola transferencia.
  // No se bloquea (el admin sigue mandando: puede ser un tecleo repetido de
  // buena fe), solo se marca donde se decide.
  //
  // Un reenvío repite el folio del pago rechazado A PROPÓSITO — es el mismo
  // movimiento, con la foto que faltaba —, así que no cuenta como repetición.
  const folioDe = (p) => (p.referencia || '').trim().toLowerCase()
  const pagosPorId = Object.fromEntries(payments.map((p) => [p.id, p]))
  const conteoFolio = {}
  payments.forEach((p) => {
    const folio = folioDe(p)
    if (!folio) return
    const original = p.reenvioDePagoId ? pagosPorId[p.reenvioDePagoId] : null
    if (original && folioDe(original) === folio) return
    conteoFolio[folio] = (conteoFolio[folio] || 0) + 1
  })
  const folioRepetido = (p) => !!folioDe(p) && conteoFolio[folioDe(p)] > 1

  // Aviso rojo, mismo texto en tarjeta y tabla.
  function Alerta({ children }) {
    return (
      <span className="inline-flex items-start gap-1 text-xs font-semibold text-red-600">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {children}
      </span>
    )
  }

  function AvisoMonto({ payment }) {
    if (montoCoincideConTarifa(payment) !== false) return null
    return (
      <Alerta>
        No coincide con la tarifa de {payment.mesesPagados} {payment.mesesPagados === 1 ? 'mes' : 'meses'} ({formatCurrency(montoOficialDe(payment.mesesPagados, payment.planId))})
      </Alerta>
    )
  }

  const todas = [...payments].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0
    const tb = b.createdAt?.toMillis?.() || 0
    return tb - ta
  })
  const archivadas = todas.filter((p) => p.archivado)
  // Archivar se comporta como "mover", no como etiqueta: en cuanto una
  // transacción se archiva, deja de aparecer en "Pagos" — mismo criterio que
  // "Guardado" en Avisos.
  const rows = soloArchivadas ? archivadas : todas.filter((p) => !p.archivado)

  async function handleArchivar(payment) {
    try {
      await updateDoc(doc(db, 'payments', payment.id), { archivado: true })
      toast('Transacción archivada')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleRestaurar(payment) {
    try {
      await updateDoc(doc(db, 'payments', payment.id), { archivado: false })
      toast('Transacción restaurada a Pagos')
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleEliminarDefinitivo() {
    if (!deleteArchivado) return
    try {
      await deleteDoc(doc(db, 'payments', deleteArchivado.id))
      toast('Transacción eliminada definitivamente')
      setDeleteArchivado(null)
      onRefresh?.()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // Aprobar y rechazar son la única puerta por la que se activa una
  // suscripción, así que las dos corren dentro de una TRANSACCIÓN que primero
  // relee el pago y aborta si ya no está "en revisión".
  //
  // Lo que esto arregla, todo real con dos pestañas abiertas o dos
  // administradores trabajando a la vez:
  //   · Aprobar dos veces el mismo folio (la pantalla vieja todavía muestra el
  //     botón) sumaba OTRO mes por un pago que ya se había cobrado una vez.
  //   · Aprobar y rechazar el mismo pago dejaba la suscripción activa con el
  //     pago marcado "rechazado", o al revés.
  //   · Las fechas se calculaban con la suscripción que se cargó al abrir el
  //     panel: aprobar dos pagos seguidos del mismo docente partía los dos del
  //     mismo día y el segundo mes se perdía. Ahora se relee dentro de la
  //     transacción, así que el segundo pago se apila sobre el primero.
  //   · Las dos escrituras (pago y suscripción) eran independientes: si la
  //     segunda fallaba, quedaba un pago cobrado sin suscripción activada.
  async function enTransaccion(paymentId, aplicar) {
    return runTransaction(db, async (tx) => {
      const payRef = doc(db, 'payments', paymentId)
      const paySnap = await tx.get(payRef)
      if (!paySnap.exists()) throw new Error('Este pago ya no existe. Actualiza la pantalla.')
      const pago = paySnap.data()
      if (pago.status !== 'pendiente') {
        throw new Error(
          `Este pago ya está como "${getPaymentStatusLabel(pago.status)}" — alguien lo resolvió antes. Actualiza la pantalla.`
        )
      }
      return aplicar(tx, payRef, pago)
    })
  }

  async function handleApprove(payment) {
    const subPrevia = payment.subscriptionId ? subscriptionsMap[payment.subscriptionId] : null
    // Lo pagado cubre desde HOY o, si todavía le quedaban días de prueba (o de
    // un plan previo vigente), desde que esos días se agoten — nunca se le
    // recortan días ya en curso. calcVencimiento suma el mes/año a partir de
    // esa fecha efectiva. (Esto es solo la vista previa del diálogo: la fecha
    // que de verdad se guarda se recalcula dentro de la transacción, con la
    // suscripción releída.)
    const vigenteHasta = subPrevia ? toDate(effectiveVencimiento(subPrevia)) : null
    const ahora = new Date()
    // Folios de transferencia de v1.0.1 en adelante declaran cuántos meses
    // pagaron (ver selector de meses en CheckoutModal.jsx) — pagos de antes
    // de ese cambio no traen el campo y siguen siendo de 1 mes, como siempre.
    const meses = payment.mesesPagados || 1
    const avisoMeses = meses > 1 ? ` (${meses} meses)` : ''
    const avisoContinuidad =
      vigenteHasta && vigenteHasta > ahora
        ? ` Como aún le quedaban días vigentes, la nueva suscripción arranca el ${formatDate(vigenteHasta)} (no se le recortó nada) y corre ${meses > 1 ? `${meses} meses completos` : 'un mes completo'} desde ahí.`
        : ''
    // El monto es el único dato del pago que el servidor no puede validar (la
    // tarifa cambia), así que la advertencia va donde se decide.
    const esperado = montoOficialDe(meses, payment.planId)
    const avisoMonto =
      montoCoincideConTarifa(payment) === false
        ? `\n\nATENCIÓN: declaró ${formatCurrency(payment.monto)} pero la tarifa de ${meses} ${meses === 1 ? 'mes' : 'meses'} es ${formatCurrency(esperado)}. Verifica en el estado de cuenta antes de aprobar.`
        : ''
    const avisoSinSuscripcion = payment.subscriptionId
      ? ''
      : '\n\nATENCIÓN: este pago no está ligado a ninguna suscripción, así que solo se marcará como pagado; no activará nada.'
    if (!confirm(`¿Confirmas que este pago${avisoMeses} fue recibido y quieres activar la suscripción?${avisoContinuidad}${avisoMonto}${avisoSinSuscripcion}`)) return
    setProcessing(payment.id)
    try {
      const hasta = await enTransaccion(payment.id, async (tx, payRef, pago) => {
        const subRef = pago.subscriptionId ? doc(db, 'subscriptions', pago.subscriptionId) : null
        const subSnap = subRef ? await tx.get(subRef) : null
        if (subRef && !subSnap.exists()) {
          throw new Error('La suscripción de este pago ya no existe. Revísala antes de aprobar.')
        }
        // Todas las lecturas de la transacción van arriba; de aquí para abajo
        // solo escrituras (lo exige Firestore).
        tx.update(payRef, { status: 'completado', updatedAt: serverTimestamp() })
        if (!subRef) return null
        const subActual = { id: subSnap.id, ...subSnap.data() }
        const vigente = toDate(effectiveVencimiento(subActual))
        const desde = new Date()
        const fechaInicio = vigente && vigente > desde ? vigente : desde
        const mesesPagados = pago.mesesPagados || 1
        const periodicidad = plansMap[pago.planId]?.periodicidad || 'mensual'
        tx.update(subRef, {
          status: 'activa',
          planId: pago.planId,
          fechaInicio: Timestamp.fromDate(fechaInicio),
          fechaVencimiento: calcVencimientoTimestamp(fechaInicio, periodicidad, mesesPagados),
          updatedAt: serverTimestamp(),
        })
        return calcVencimiento(fechaInicio, periodicidad, mesesPagados)
      })
      toast(hasta ? `Pago aprobado — suscripción vigente hasta el ${formatDate(hasta)}` : 'Pago aprobado (sin suscripción ligada)')
      onRefresh?.()
    } catch (err) {
      toast(err.message, 'error')
      onRefresh?.()
    } finally {
      setProcessing(null)
    }
  }

  async function handleReject() {
    if (!rejectModal) return
    setProcessing(rejectModal.id)
    try {
      await enTransaccion(rejectModal.id, (tx, payRef) => {
        tx.update(payRef, {
          status: 'rechazado',
          notasAdmin: notasAdmin.trim(),
          updatedAt: serverTimestamp(),
        })
      })
      toast('Pago rechazado')
      setRejectModal(null)
      setNotasAdmin('')
      onRefresh?.()
    } catch (err) {
      toast(err.message, 'error')
      onRefresh?.()
    } finally {
      setProcessing(null)
    }
  }

  // Acciones — se muestran igual en la tarjeta (móvil) y en la tabla
  // (escritorio), así que viven en un solo lugar.
  function Acciones({ payment }) {
    if (soloArchivadas) {
      return (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => handleRestaurar(payment)}
            data-tooltip="Restaurar a Pagos"
            className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold hover:bg-emerald-200"
          >
            <ArchiveRestore size={13} /> Restaurar
          </button>
          <button
            type="button"
            onClick={() => setDeleteArchivado(payment)}
            data-tooltip="Eliminar definitivamente"
            className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200"
          >
            <Trash2 size={13} /> Eliminar
          </button>
        </div>
      )
    }
    return (
      <>
        {payment.status === 'pendiente' && (
          <div className="flex items-center gap-1 mb-1 flex-wrap">
            <button
              type="button"
              onClick={() => handleApprove(payment)}
              disabled={processing === payment.id}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold hover:bg-emerald-200 disabled:opacity-60"
            >
              {processing === payment.id ? <Spinner size="sm" /> : <Check size={14} />}
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => setRejectModal(payment)}
              disabled={processing === payment.id}
              className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold hover:bg-red-200 disabled:opacity-60"
            >
              <X size={14} /> Rechazar
            </button>
          </div>
        )}
        {payment.notasAdmin && (
          <p className="text-xs text-slate-400 mt-1">{payment.notasAdmin}</p>
        )}
        <button
          type="button"
          onClick={() => handleArchivar(payment)}
          data-tooltip="Archivar"
          className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded text-xs font-medium transition-colors"
        >
          <Archive size={13} /> Archivar
        </button>
      </>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-on-surface">Pagos</h2>
          <PagoNotifToggle />
        </div>
        {/* Pagos / Archivadas — mismo patrón que Todos / Guardados en Avisos */}
        <div className="flex gap-1 bg-surface-container p-1 rounded w-fit">
          <button type="button" onClick={() => setSoloArchivadas(false)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${!soloArchivadas ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
            Pagos
          </button>
          <button type="button" onClick={() => setSoloArchivadas(true)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${soloArchivadas ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
            <Archive size={13} /> Archivadas{archivadas.length > 0 ? ` (${archivadas.length})` : ''}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-slate-400 text-sm">
          {soloArchivadas ? 'No hay transacciones archivadas' : 'Sin pagos registrados'}
        </p>
      ) : (
        <>
          {/* ── Tarjetas — móvil/tablet: una transacción por bloque, todo el
              detalle apilado y legible sin desplazar la pantalla de lado.
              Mismo criterio de scroll propio que la tabla de escritorio. */}
          <div className="md:hidden max-h-[70vh] overflow-y-auto p-3 space-y-2.5 bg-surface">
            {rows.map((payment) => {
              const teacher = teachersMap[payment.docenteId]
              const subscription = subscriptionsMap[payment.subscriptionId]
              const domiciliado = payment.metodo === 'mercadopago' && !!subscription?.mpPreapprovalId
              return (
                <div key={payment.id} className="p-3 space-y-2 bg-surface-card border border-outline-variant rounded-card shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted">#{numeroPorId[payment.id]}</p>
                      <p className="font-medium text-on-surface truncate">{teacher?.email || '—'}</p>
                    </div>
                    <StatusBadge status={payment.status} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-lg">{formatCurrency(payment.monto)}</span>
                      {payment.mesesPagados > 1 && (
                        <span className="text-xs text-muted ml-1">({payment.mesesPagados} meses)</span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm">{METODO_LABELS[payment.metodo] || payment.metodo || '—'}</p>
                      {domiciliado && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                          <RefreshCw size={11} /> Domiciliado
                        </span>
                      )}
                    </div>
                  </div>
                  <AvisoMonto payment={payment} />
                  <p className="text-xs text-muted">{formatDateTime(payment.createdAt)}</p>
                  {payment.referencia && (
                    <p className="text-xs font-mono text-muted">Folio bancario: {payment.referencia}</p>
                  )}
                  {folioRepetido(payment) && (
                    <Alerta>Este folio bancario ya aparece en otra transacción</Alerta>
                  )}
                  {payment.reenvioDePagoId && (
                    <p className="text-xs text-amber-600">Reenvío de un pago rechazado anteriormente</p>
                  )}
                  {payment.comprobanteUrl && (
                    <a href={payment.comprobanteUrl} target="_blank" rel="noreferrer" className="inline-block">
                      <img src={payment.comprobanteUrl} alt="Comprobante" className="h-16 w-16 object-cover rounded border border-outline-variant" />
                    </a>
                  )}
                  <ComentarioCell key={`${payment.id}:${payment.comentarios || ''}`} payment={payment} onSaved={onRefresh} />
                  <div className="pt-1">
                    <Acciones payment={payment} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Tabla — escritorio. Scroll propio: la lista no debe empujar el
              resto del panel hacia abajo conforme crezca (mismo criterio que
              la caja de historial en Avisos). table-fixed + <colgroup> es lo
              que hace que los anchos arrastrados se respeten — mismo patrón
              que Suscripciones. */}
          <div ref={containerRef} className="hidden md:block overflow-x-auto overflow-y-auto max-h-[60vh]">
            <table className="text-sm table-fixed" style={{ width: total }}>
              <colgroup>
                {COLS.map((c) => (
                  <col key={c.key} style={{ width: widths[c.key] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface text-left text-xs text-muted uppercase">
                  {COLS.map((col) => (
                    <th key={col.key} className="relative px-4 py-2 select-none">
                      <span className="block truncate">{col.label}</span>
                      {esRedimensionable(col.key) && (
                        <span
                          onPointerDown={(e) => startResize(e, col.key)}
                          onDoubleClick={() => resetColumn(col.key)}
                          title="Arrastra para cambiar el ancho (doble clic para restablecer)"
                          className="absolute top-0 right-0 h-full w-2 cursor-col-resize flex justify-center group"
                        >
                          <span
                            className={`h-full transition-colors ${
                              dragKey === col.key
                                ? 'w-[2px] bg-accent'
                                : 'w-px bg-outline-variant group-hover:bg-accent'
                            }`}
                          />
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((payment) => {
                  const teacher = teachersMap[payment.docenteId]
                  const subscription = subscriptionsMap[payment.subscriptionId]
                  const domiciliado = payment.metodo === 'mercadopago' && !!subscription?.mpPreapprovalId
                  return (
                    <tr key={payment.id} className="hover:bg-[var(--accent-tint)]">
                      <td className="px-4 py-2 font-mono text-xs text-muted truncate">#{numeroPorId[payment.id]}</td>
                      <td className="px-4 py-2 truncate">
                        <p className="font-medium text-on-surface truncate">
                          {teacher?.email || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-2 font-semibold">
                        <span className="block truncate">
                          {formatCurrency(payment.monto)}
                          {payment.mesesPagados > 1 && (
                            <span className="text-xs text-muted font-normal ml-1">({payment.mesesPagados}m)</span>
                          )}
                        </span>
                        <AvisoMonto payment={payment} />
                      </td>
                      <td className="px-4 py-2 truncate">
                        <p className="text-sm truncate">{METODO_LABELS[payment.metodo] || payment.metodo || '—'}</p>
                        {domiciliado && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-semibold mt-0.5">
                            <RefreshCw size={11} /> Domiciliado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">
                        <span className="block truncate">{payment.referencia || '—'}</span>
                        {payment.comprobanteUrl && (
                          <a href={payment.comprobanteUrl} target="_blank" rel="noreferrer" className="block text-accent hover:underline mt-0.5" data-tooltip="Ver comprobante">
                            Ver foto
                          </a>
                        )}
                        {folioRepetido(payment) && <Alerta>Folio repetido</Alerta>}
                      </td>
                      <td className="px-4 py-2">
                        <SituacionBadge situacion={planDe(subscription)} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="px-4 py-2 text-muted truncate">{formatDateTime(payment.createdAt)}</td>
                      <td className="px-4 py-2">
                        <ComentarioCell key={`${payment.id}:${payment.comentarios || ''}`} payment={payment} onSaved={onRefresh} />
                      </td>
                      <td className="px-4 py-2">
                        <Acciones payment={payment} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="hidden md:flex px-4 py-2 border-t border-outline-variant">
            <button
              type="button"
              onClick={resetWidths}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              <RotateCcw size={13} /> Restablecer ancho de columnas
            </button>
          </div>
        </>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-surface-card rounded-card p-5 w-[calc(100%-2rem)] max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-on-surface mb-2">Rechazar pago</h3>
            <p className="text-sm text-muted mb-3">
              Folio: {rejectModal.referencia} — {formatCurrency(rejectModal.monto)}
            </p>
            <textarea
              value={notasAdmin}
              onChange={(e) => setNotasAdmin(e.target.value)}
              placeholder="Notas para el docente (opcional)"
              className="w-full px-3 py-2 rounded border border-outline-variant text-sm mb-3 h-20 resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeRejectModal}
                className="flex-1 py-2 border border-outline-variant rounded text-sm font-semibold text-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={!!processing}
                className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-semibold disabled:opacity-60"
              >
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmación de borrado definitivo ── */}
      {deleteArchivado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteArchivado(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">¿Eliminar esta transacción?</h3>
            <p className="text-sm text-muted mb-4">
              Se borrará permanentemente el registro #{numeroPorId[deleteArchivado.id]}. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteArchivado(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleEliminarDefinitivo}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors">
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
