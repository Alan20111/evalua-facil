// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
//
// Estructura propia de Evalúa Fácil (decisión de Kike, 16-ago-2026): la
// Planeación es una lista de Secuencias Didácticas (`secuenciasDidacticas[]`,
// ver CAMPOS_SECUENCIA en utils/planeacionDocx.js), UNA VEZ POR CADA PARCIAL
// de la asignatura — ya NO depende de ningún formato institucional que el
// docente tenga que subir, ni de una plantilla Word que haya que "llenar".
// El docente elige, antes de generar, si define él mismo cuántas Secuencias
// Didácticas quiere por parcial o si deja que la IA decida. La revisión y
// edición ocurren en una vista con apariencia de documento (fondo de
// página, tipografía de texto corrido) — pero es React puro, editable en su
// lugar, NUNCA en un panel aparte (regla permanente). El .docx solo se
// genera al descargar, como una REPRESENTACIÓN de estos mismos datos —
// nunca su estructura interna.
import { useEffect, useRef, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { updateDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import useDiagnosticoEstado from '../../hooks/useDiagnosticoEstado'
import { CAMPOS_SECUENCIA, construirDocumentoPlaneacion } from '../../utils/planeacionDocx'
import { useSubscription } from '../../hooks/useSubscription'
import useIsDesktop from '../../hooks/useIsDesktop'
import CheckoutModal from '../CheckoutModal'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp, ThumbsUp, Eye, Lock, X, Monitor, Save, AlertTriangle, Plus, Trash2 } from 'lucide-react'

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

function nuevaSecuenciaVacia() {
  const s = { id: crypto.randomUUID() }
  for (const { clave } of CAMPOS_SECUENCIA) s[clave] = ''
  return s
}

function RequisitoItem({ ok, texto }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-700' : 'text-muted'}`}>
      {ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      {texto}
    </li>
  )
}

// Señal visual del estado real de Planeación — discreta, junto al título.
// "Lista" exige los dos diagnósticos con análisis real (mismo criterio que
// habilita el botón, sin contar fuentes — ver spec de Kike, 13-ago-2026).
function EstadoPlaneacionBadge({ lista }) {
  const className = lista
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {lista ? 'Lista para generar' : 'Falta la Fuente Principal'}
    </span>
  )
}

// Resumen de insumos a incluir, de solo lectura — cada uno se marca en SU
// PROPIA tarjeta arriba (Comentarios, Autoanálisis, Consideraciones,
// Diagnóstico de contexto, Diagnóstico de conocimientos), decisión de
// Kike, 14-ago-2026: no duplicar el control aquí, solo mostrar lo que ya
// se marcó ahí para que el docente confirme antes de generar. El Perfil IA
// NO aparece aquí (decisión de Kike, 15-ago-2026): ya es obligatorio para
// poder ver esta pestaña siquiera, así que siempre se incluye, sin
// casilla.
function InsumosOpcionales({
  hayContexto, hayConocimientos,
  incluirComentarios, incluirAutoanalisis, incluirConsideraciones, incluirDiagContexto, incluirDiagConocimientos,
}) {
  const resumen = [
    ['Comentarios generales del grupo', incluirComentarios],
    ['Autoanálisis docente', incluirAutoanalisis],
    ['Consideraciones', incluirConsideraciones],
    [`Diagnóstico de contexto${hayContexto ? '' : ' (sin resultados todavía)'}`, incluirDiagContexto],
    [`Diagnóstico de conocimientos${hayConocimientos ? '' : ' (sin resultados todavía)'}`, incluirDiagConocimientos],
  ]
  return (
    <fieldset className="mb-2 p-2.5 rounded border border-outline-variant">
      <legend className="text-sm text-on-surface px-1">Insumos a incluir</legend>
      <p className="text-xs text-muted mb-1.5">
        Tu Perfil IA y la Fuente Principal (programa de estudios) siempre se usan. Los demás se marcan arriba, en la
        tarjeta de cada uno — entre más insumos incluyas y tengas listos, mejor planeación obtendrás.
      </p>
      {resumen.map(([texto, checked]) => (
        <div key={texto} className="flex items-center gap-2 py-0.5 text-sm text-on-surface">
          {checked ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" /> : <Circle size={14} className="text-muted flex-shrink-0" />}
          <span className={checked ? '' : 'text-muted'}>{texto}</span>
        </div>
      ))}
    </fieldset>
  )
}

// Antes de generar, el docente decide cuántas Secuencias Didácticas quiere
// por parcial — o deja que la IA lo decida (regla permanente de Kike,
// 16-ago-2026: "la decisión debe ser previa a la generación", nunca al
// revés). "Que la IA decida" es la opción por default: la mayoría de los
// docentes no tiene por qué saber de antemano cuántas Secuencias hacen
// falta.
function SelectorCantidadSecuencias({ modo, onCambiarModo, cantidad, onCambiarCantidad, disabled }) {
  return (
    <fieldset className="mb-2 p-2.5 rounded border border-outline-variant" disabled={disabled}>
      <legend className="text-sm text-on-surface px-1">¿Cuántas Secuencias Didácticas quieres por parcial?</legend>
      <label className="flex items-center gap-2 py-0.5 text-sm text-on-surface cursor-pointer">
        <input type="radio" name="modoCantidadSecuencias" checked={modo === 'ia'} onChange={() => onCambiarModo('ia')} />
        Que la IA decida (recomendado)
      </label>
      <label className="flex items-center gap-2 py-0.5 text-sm text-on-surface cursor-pointer">
        <input type="radio" name="modoCantidadSecuencias" checked={modo === 'manual'} onChange={() => onCambiarModo('manual')} />
        Yo decido:
        <input
          type="number" min={1} max={12} value={cantidad}
          onChange={(e) => onCambiarCantidad(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          onFocus={() => onCambiarModo('manual')}
          className="w-16 px-1.5 py-0.5 rounded border border-outline-variant text-sm bg-transparent"
        />
      </label>
    </fieldset>
  )
}

// Campo de texto "de documento" — sin borde propio hasta que se toca, crece
// con el contenido, tipografía de texto corrido (para que la Vista previa y
// edición se sienta como editar el documento, no como llenar un formulario
// de cajitas — pedido de Kike, 16-ago-2026).
function CampoDocumento({ etiqueta, value, onChange, placeholder, grande = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  const SERIF = { fontFamily: 'Georgia, "Times New Roman", serif' }
  return (
    <p className="mb-3 leading-relaxed">
      <span className="italic text-neutral-500" style={SERIF}>{etiqueta}: </span>
      <textarea
        ref={ref}
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2000}
        rows={1}
        className={`w-[calc(100%-2px)] align-top bg-transparent border-0 rounded-sm resize-none overflow-hidden focus:outline-none focus:bg-amber-50 text-neutral-900 ${grande ? 'text-base' : 'text-[15px]'}`}
        style={SERIF}
      />
    </p>
  )
}

// Una Secuencia Didáctica completa, integrada en el flujo continuo del
// documento — nunca como tarjeta independiente. El encabezado (nombre/tema)
// es editable en su lugar; los controles de reordenar/eliminar son
// discretos, solo visibles al pasar el cursor sobre la Secuencia (pedido de
// Kike, 16-ago-2026: "no deben dominar visualmente el documento").
function SecuenciaDocumento({ secuencia, numero, total, onCambiarCampo, onMover, onEliminar }) {
  return (
    <section className="group relative mt-8 first:mt-0">
      <div className="flex items-baseline gap-2 pr-16">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent flex-shrink-0">Secuencia {numero}</span>
        <textarea
          value={secuencia.nombre || ''}
          placeholder="Nombre o tema de esta Secuencia"
          onChange={(e) => onCambiarCampo('nombre', e.target.value)}
          maxLength={200}
          rows={1}
          className="flex-1 bg-transparent border-0 resize-none overflow-hidden focus:outline-none focus:bg-amber-50 text-neutral-900 text-lg font-bold leading-snug"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        />
      </div>
      <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button type="button" onClick={() => onMover(-1)} disabled={numero === 1} aria-label="Mover antes"
          className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-0">
          <ChevronUp size={14} />
        </button>
        <button type="button" onClick={() => onMover(1)} disabled={numero === total} aria-label="Mover después"
          className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-0">
          <ChevronDown size={14} />
        </button>
        <button type="button" onClick={onEliminar} disabled={total <= 1} aria-label="Eliminar esta Secuencia Didáctica"
          className="p-1 rounded text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-0">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 pl-1 border-l-2 border-neutral-100">
        <div className="pl-3">
          {CAMPOS_SECUENCIA.filter((c) => c.clave !== 'nombre').map(({ clave, etiqueta }) => (
            <CampoDocumento key={clave} etiqueta={etiqueta} value={secuencia[clave]} onChange={(v) => onCambiarCampo(clave, v)} />
          ))}
        </div>
      </div>
    </section>
  )
}

// La Planeación completa de UN parcial, con apariencia de página de
// documento — todas las Secuencias Didácticas viven aquí, en flujo
// continuo, nunca en un panel aparte (regla permanente de Kike,
// 16-ago-2026).
function DocumentoPlaneacionEditable({ secuencias, onCambiarCampo, onMover, onEliminar, onAgregar }) {
  return (
    <div className="bg-white rounded shadow-card mx-auto max-w-3xl p-6 sm:p-10">
      {secuencias.map((s, i) => (
        <SecuenciaDocumento
          key={s.id}
          secuencia={s}
          numero={i + 1}
          total={secuencias.length}
          onCambiarCampo={(campo, valor) => onCambiarCampo(i, campo, valor)}
          onMover={(direccion) => onMover(i, direccion)}
          onEliminar={() => onEliminar(i)}
        />
      ))}
      <button
        type="button"
        onClick={onAgregar}
        className="mt-6 flex items-center gap-1.5 text-sm text-accent hover:underline"
      >
        <Plus size={14} /> Agregar Secuencia Didáctica
      </button>
    </div>
  )
}

// A pantalla completa salvo el sidebar azul (pedido de Kike, 15-ago-2026) —
// la revisión de la Planeación necesita todo el ancho posible para verse
// como el documento real, no como una lista angosta. Solo en escritorio: en
// celular no hay espacio para esto, así que ni se intenta mostrar (ver
// useIsDesktop) — el docente revisa desde una computadora.
function RevisionPantallaCompleta({ titulo, onCerrar, cerrarTexto = null, acciones, tabs, children }) {
  return (
    <div className="fixed inset-0 md:left-[300px] z-40 bg-surface-card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant flex-shrink-0">
        <h2 className="font-bold text-on-surface truncate">{titulo}</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {acciones}
          {cerrarTexto ? (
            <button
              type="button"
              onClick={onCerrar}
              className="flex-shrink-0 px-3 py-1.5 rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface"
            >
              {cerrarTexto}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="p-1.5 rounded text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      {tabs && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-outline-variant flex-shrink-0 overflow-x-auto">
          {tabs}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </div>
  )
}

// Aviso cuando la pantalla es angosta (celular/tablet chica) — la revisión
// no se intenta mostrar ahí (pedido explícito de Kike, 15-ago-2026).
function AvisoRevisionDesktop() {
  return (
    <div className="mt-3 pt-2 border-t border-outline-variant flex items-start gap-2 text-xs text-amber-700">
      <Monitor size={16} className="flex-shrink-0 mt-0.5" />
      <p>Ya se generó — para revisarla, corregirla y aceptarla/descargarla, abre Evalúa Fácil desde una computadora.</p>
    </div>
  )
}

// Selector de parcial — un botón por cada documento (uno por parcial, ver
// arriba). Compartido por la revisión editable y la vista previa.
function SelectorParcial({ porParcial, activo, onCambiar }) {
  if (!porParcial || porParcial.length <= 1) return null
  return (
    <>
      {porParcial.map((p) => (
        <button
          key={p.numero}
          type="button"
          onClick={() => onCambiar(p.numero)}
          className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0 ${
            activo === p.numero ? 'bg-accent text-white' : 'border border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
          }`}
        >
          Parcial {p.numero}{p.periodo ? ` — ${p.periodo}` : ''}
        </button>
      ))}
    </>
  )
}

export default function PlaneacionInicialSection({ subjectId, asignaturaNombre, hayFuentesGenerales }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const { subscription, refresh: refreshSubscription } = useSubscription()
  // Mismo criterio que exportGuard.js: bloqueado mientras nunca hubo un pago
  // aprobado, sin importar si la suscripción sigue vigente o no.
  const nuncaAprobado = !subscription?.planId
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const isDesktop = useIsDesktop()

  // `subject` (prop) lo carga SubjectPage con un getDoc de una sola vez, no
  // con onSnapshot — así que cuando ESTE componente escribe en
  // subjects/{id} (aceptar/guardar/reiniciar), la página padre nunca se
  // entera y el docente veía los botones equivocados hasta recargar (bug
  // encontrado por Kike, 15-ago-2026). Se escucha aparte, solo para los
  // campos de Planeación.
  const [subjectPlaneacion, setSubjectPlaneacion] = useState(null)
  const [subjectPlaneacionLoaded, setSubjectPlaneacionLoaded] = useState(false)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId), (snap) => {
      setSubjectPlaneacion(snap.exists() ? snap.data() : null)
      setSubjectPlaneacionLoaded(true)
    }, () => setSubjectPlaneacionLoaded(true))
    return unsub
  }, [subjectId])

  const [incluirEnPlaneacion, setIncluirEnPlaneacion] = useState({})
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setIncluirEnPlaneacion(snap.exists() ? (snap.data().incluirEnPlaneacion || {}) : {})
    }, () => setIncluirEnPlaneacion({}))
    return unsub
  }, [subjectId])

  // El diagnóstico "real" (Tandas 1 y 2) vive en `activities` — no en la
  // vieja `subjects/{id}/diagnosticosIA` (reporte simulado, descartado).
  const { estado: estadoContexto, cargado: contextoCargado } = useDiagnosticoEstado(subjectId, 'contexto')
  const { estado: estadoConocimientos, cargado: conocimientosCargado } = useDiagnosticoEstado(subjectId, 'conocimientos')
  const hayContexto = estadoContexto === 'completado'
  const hayConocimientos = estadoConocimientos === 'completado'
  const diagLoaded = contextoCargado && conocimientosCargado

  const incluirComentarios = incluirEnPlaneacion.comentarios !== false
  const incluirAutoanalisis = incluirEnPlaneacion.autoanalisis !== false
  const incluirConsideraciones = incluirEnPlaneacion.consideraciones !== false
  const incluirDiagContexto = incluirEnPlaneacion.diagContexto !== false
  const incluirDiagConocimientos = incluirEnPlaneacion.diagConocimientos !== false
  const incluirInsumos = {
    comentarios: incluirComentarios,
    autoanalisis: incluirAutoanalisis,
    consideraciones: incluirConsideraciones,
    diagContexto: incluirDiagContexto,
    diagConocimientos: incluirDiagConocimientos,
  }
  const habilitado = hayFuentesGenerales

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-on-surface">Planeación Didáctica Inicial</h2>
        <EstadoPlaneacionBadge lista={hayFuentesGenerales} />
      </div>
      <p className="text-sm text-muted mt-0.5 mb-2">
        La IA genera una propuesta inicial de planeación — revísala, edítala y acéptala para continuar. Genera un
        documento POR CADA PARCIAL real de la asignatura.
      </p>

      {subjectPlaneacionLoaded && !subjectPlaneacion?.planeacionAceptada && (
        <p className="text-sm font-semibold text-red-600 mb-2">
          Haz que tu IA tenga la mejor congruencia ACEPTANDO tu planeación didáctica INICIAL.
        </p>
      )}

      {!habilitado && (
        <ul className="space-y-1 mb-1">
          <RequisitoItem ok={hayFuentesGenerales} texto="Fuente Principal (programa de estudios)" />
        </ul>
      )}

      {habilitado && !diagLoaded && (
        <div className="flex justify-center py-6"><Spinner size="sm" /></div>
      )}

      {habilitado && diagLoaded && subjectPlaneacionLoaded && (
        <Planeacion
          subjectId={subjectId}
          asignaturaNombre={asignaturaNombre}
          isDesktop={isDesktop}
          nuncaAprobado={nuncaAprobado}
          onPago={() => setShowPaymentModal(true)}
          subjectPlaneacion={subjectPlaneacion}
          incluirInsumos={incluirInsumos}
          hayContexto={hayContexto}
          hayConocimientos={hayConocimientos}
          creditosIA={creditosIA}
          toast={toast}
        />
      )}

      <CheckoutModal
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        subscription={subscription}
        onSuccess={refreshSubscription}
      />
    </div>
  )
}

// La Planeación Didáctica Inicial — generar, revisar/editar por parcial,
// guardar avance, aceptar, ver y descargar.
function Planeacion({
  subjectId, asignaturaNombre, isDesktop, nuncaAprobado, onPago,
  subjectPlaneacion, incluirInsumos, hayContexto, hayConocimientos, creditosIA, toast,
}) {
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [modoCantidad, setModoCantidad] = useState('ia')
  const [cantidadManual, setCantidadManual] = useState(3)
  const [generando, setGenerando] = useState(false)
  const [parcialActivo, setParcialActivo] = useState(1)
  const [edicion, setEdicion] = useState(null) // [{numero, periodo, secuencias}] mientras no está aceptada
  const [edicionDeId, setEdicionDeId] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [confirmarAceptar, setConfirmarAceptar] = useState(false)
  const [confirmarReiniciar, setConfirmarReiniciar] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [descargandoParcial, setDescargandoParcial] = useState(null)
  const [verRevision, setVerRevision] = useState(false)
  const [abrirTrasGenerar, setAbrirTrasGenerar] = useState(false)
  // Copia editable de la planeación YA ACEPTADA — separada de `edicion`
  // (que es la copia previa a aceptar) porque una vez aceptada vive en otro
  // campo de Firestore (`planeacionAceptada`, no `planeacionBorrador`).
  // Pedido de Kike, 16-ago-2026: la planeación aceptada también debe poder
  // corregirse sin tener que "Generar de nuevo" (que la borra por completo).
  const [edicionAceptada, setEdicionAceptada] = useState(null)
  const [edicionAceptadaDeId, setEdicionAceptadaDeId] = useState(null)
  const [guardandoAceptada, setGuardandoAceptada] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, 'planeacionesIA'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setHistLoaded(true)
    }, () => setHistLoaded(true))
    return unsub
  }, [subjectId])

  const actual = historial[0] || null
  const anteriores = historial.slice(1)
  const aceptada = !!actual && subjectPlaneacion?.planeacionAceptada?.planeacionId === actual.id
  const fechaAceptada = aceptada ? subjectPlaneacion.planeacionAceptada.aceptadaEn : null
  const porParcialAceptado = aceptada
    ? (subjectPlaneacion.planeacionAceptada.porParcial?.length
      ? subjectPlaneacion.planeacionAceptada.porParcial : actual.porParcial)
    : null

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // nueva (o al recargar la página) — nunca pisa ediciones en curso del
  // mismo `actual.id`. A partir de lo último guardado como borrador si
  // existe (pedido de Kike, 15-ago-2026: el docente entra varias veces a
  // corregir antes de aceptar, así que el avance debe sobrevivir a cerrar
  // la pestaña).
  const actualIdParaEdicion = actual?.id || null
  if (actualIdParaEdicion !== edicionDeId) {
    const borrador = subjectPlaneacion?.planeacionBorrador?.planeacionId === actualIdParaEdicion
      ? subjectPlaneacion.planeacionBorrador.porParcial : null
    setEdicion(actualIdParaEdicion ? (borrador?.length ? borrador : actual.porParcial) : null)
    setEdicionDeId(actualIdParaEdicion)
    setParcialActivo(actual?.porParcial?.[0]?.numero || 1)
  }

  if (aceptada && actualIdParaEdicion !== edicionAceptadaDeId) {
    setEdicionAceptada(porParcialAceptado || [])
    setEdicionAceptadaDeId(actualIdParaEdicion)
  }

  const guardadoRaw = !!actual && subjectPlaneacion?.planeacionBorrador?.planeacionId === actual.id
    ? subjectPlaneacion.planeacionBorrador?.porParcial : null
  const guardado = guardadoRaw?.length ? guardadoRaw : actual?.porParcial
  const sinGuardar = !!actual && JSON.stringify(edicion) !== JSON.stringify(guardado)
  const sinGuardarAceptada = aceptada && JSON.stringify(edicionAceptada) !== JSON.stringify(porParcialAceptado || [])

  async function generar() {
    if (nuncaAprobado) { onPago(); return }
    setGenerando(true)
    try {
      // La función misma guarda el resultado (ver ejecutarPlaneacionDidacticaInicial
      // en functions/ia.js) — el listener onSnapshot de arriba la recibe en
      // cuanto se guarda.
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, incluir: incluirInsumos,
        cantidadSecuencias: modoCantidad === 'manual' ? cantidadManual : null,
      }, 1, { timeoutMs: 240000 })
      setConfirmando(false)
      if (data?.resultado?.porParcial?.length) {
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional) — revísala y acéptala cuando estés conforme.'
          : 'Planeación generada — revísala y acéptala cuando estés conforme.', 'info')
        // No se abre aquí mismo: `actual`/`edicion` todavía son del ciclo
        // ANTERIOR (el listener de Firestore no ha recibido la nueva
        // generación) — se marca pendiente y un efecto la abre en cuanto
        // `actual` de verdad cambie.
        setAbrirTrasGenerar(true)
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') toast('No tienes suficientes créditos de IA para esta acción', 'error')
      else if (err.codigo === 'PERFIL_IA_INCOMPLETO') toast('Marcaste incluir tu Perfil IA, pero todavía no lo completas — complétalo o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_PROGRAMA_ESTUDIOS') toast('Sube primero la Fuente Principal (programa de estudios)', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONTEXTO') toast('Marcaste incluir el Diagnóstico de contexto, pero todavía no tiene resultados analizados — genera y analiza el instrumento, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONOCIMIENTOS') toast('Marcaste incluir el Diagnóstico de conocimientos, pero todavía no tiene resultados analizados — genera y analiza el cuestionario, o desmarca esa casilla', 'error')
      else toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
    } finally {
      setGenerando(false)
    }
  }

  async function guardar() {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionBorrador: { planeacionId: actual.id, porParcial: edicion, actualizadoEn: serverTimestamp() },
      })
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function aceptar() {
    setAceptando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: { planeacionId: actual.id, aceptadaEn: serverTimestamp(), porParcial: edicion || actual.porParcial },
        planeacionBorrador: null,
      })
      toast('Planeación Inicial aceptada — ya puedes verla y descargarla')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // Guarda correcciones sobre la planeación YA ACEPTADA, en su lugar — no
  // cambia `planeacionId` ni `aceptadaEn`, solo el contenido de las
  // Secuencias (pedido de Kike, 16-ago-2026).
  async function guardarAceptada() {
    setGuardandoAceptada(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: { ...subjectPlaneacion.planeacionAceptada, porParcial: edicionAceptada },
      })
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardandoAceptada(false)
    }
  }

  // Quita la aceptación y sus borradores — irreversible: no hay forma de
  // recuperar cuál era la aceptada una vez hecho esto (pedido de Kike,
  // 15-ago-2026). No borra la bitácora (planeacionesIA es inmutable por
  // regla, a propósito).
  async function reiniciar() {
    setReiniciando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: null,
        planeacionBorrador: null,
      })
      toast('Planeación Inicial eliminada — ya puedes generar una nueva')
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setReiniciando(false)
      setConfirmarReiniciar(false)
    }
  }

  function secuenciasDeParcial(numero, fuente) {
    return (fuente || []).find((x) => x.numero === numero)?.secuencias || []
  }

  async function descargarParcial(numero) {
    if (nuncaAprobado) { onPago(); return }
    setDescargandoParcial(numero)
    try {
      const p = (porParcialAceptado || []).find((x) => x.numero === numero)
      const titulo = `Planeación Didáctica Inicial — Parcial ${numero}${p?.periodo ? ` (${p.periodo})` : ''}`
      const blob = await construirDocumentoPlaneacion(secuenciasDeParcial(numero, porParcialAceptado), titulo)
      const nombreSalida = `Planeación Didáctica Inicial - Parcial ${numero}.docx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreSalida
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast('Descargado — es una propuesta de IA revisada por ti, pero vuelve a checarla antes de usarla.', 'info')
    } catch (err) {
      toast('No se pudo generar el archivo: ' + err.message, 'error')
    } finally {
      setDescargandoParcial(null)
    }
  }

  // Se llama en cuanto `actual` de verdad refleja la generación recién
  // hecha (ver `generar()` — no se puede abrir en el mismo instante porque
  // el listener de Firestore todavía trae los datos del ciclo anterior).
  useEffect(() => {
    if (abrirTrasGenerar && actual) {
      setAbrirTrasGenerar(false)
      setVerRevision(true)
    }
  }, [abrirTrasGenerar, actual])

  if (!histLoaded) {
    return <div className="flex justify-center py-6"><Spinner size="sm" /></div>
  }

  const fuenteEditableActivo = aceptada ? edicionAceptada : edicion
  const secuenciasActivo = secuenciasDeParcial(parcialActivo, fuenteEditableActivo)

  // Escribe una corrección de campo en la copia editable que corresponda
  // (aceptada o en revisión).
  function cambiarCampo(indiceSecuencia, campo, valor) {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : {
        ...p,
        secuencias: p.secuencias.map((s, j) => (j === indiceSecuencia ? { ...s, [campo]: valor } : s)),
      }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  // Agregar/eliminar/mover una Secuencia Didáctica COMPLETA.
  function moverSecuencia(indice, direccion) {
    const actualizador = (prev) => prev.map((p) => {
      if (p.numero !== parcialActivo) return p
      const destino = indice + direccion
      if (destino < 0 || destino >= p.secuencias.length) return p
      const secuencias = [...p.secuencias]
      ;[secuencias[indice], secuencias[destino]] = [secuencias[destino], secuencias[indice]]
      return { ...p, secuencias }
    })
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  function eliminarSecuencia(indice) {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : { ...p, secuencias: p.secuencias.filter((_, j) => j !== indice) }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  function agregarSecuencia() {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : { ...p, secuencias: [...p.secuencias, nuevaSecuenciaVacia()] }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  function cambiarParcialRevision(numero) {
    setParcialActivo(numero)
  }

  function cerrarRevision() {
    setVerRevision(false)
  }

  return (
    <div>
      {aceptada ? (
        <p className="text-xs text-muted mb-2">
          Estado: <span className="font-medium text-green-700">Aceptada — es tu Planeación Inicial, la usa la IA para todo lo demás</span>
          {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
        </p>
      ) : !actual ? (
        <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generada</span></p>
      ) : (
        <p className="text-xs text-muted mb-2">
          Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
          {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
          . Revísala y corrígela antes de aceptarla — no se puede descargar hasta que la aceptes.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!aceptada && (
          <button
            type="button"
            onClick={() => (nuncaAprobado ? onPago() : setConfirmando(true))}
            disabled={generando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {generando ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
            {actual ? 'Generar de nuevo (con IA)' : 'Generar planeación (con IA)'}
          </button>
        )}
        {actual && !aceptada && isDesktop && (
          <button
            type="button"
            onClick={() => setVerRevision(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50"
          >
            <ThumbsUp size={14} />
            Vista previa y edición
          </button>
        )}
        {actual && aceptada && (
          <button
            type="button"
            onClick={() => setVerRevision(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm ${
              isDesktop ? 'border-green-600 text-green-700 hover:bg-green-50' : 'border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
            }`}
          >
            {isDesktop ? <ThumbsUp size={14} /> : <Eye size={14} />}
            {isDesktop ? 'Vista previa y edición' : 'Vista previa'}
          </button>
        )}
        {aceptada && (
          <button
            type="button"
            onClick={() => setConfirmarReiniciar(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-300 text-red-700 text-sm hover:bg-red-50"
          >
            <AlertTriangle size={14} />
            Generar de nuevo
          </button>
        )}
      </div>

      {aceptada && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-muted">Descargar por parcial:</span>
          {(porParcialAceptado || []).map((p) => (
            <button
              key={p.numero}
              type="button"
              onClick={() => descargarParcial(p.numero)}
              disabled={descargandoParcial === p.numero}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent text-white text-xs hover:bg-accent-hover disabled:opacity-60"
            >
              {descargandoParcial === p.numero ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={12} /> : <Download size={12} />}
              Parcial {p.numero}
            </button>
          ))}
        </div>
      )}

      {/* Sin aceptar, "Revisar y aceptar" y "Vista previa" son la MISMA
          pantalla — se edita directo sobre la Planeación, con apariencia de
          documento. Solo en escritorio (celular no tiene espacio para
          esto). */}
      {actual && !aceptada && !isDesktop && <AvisoRevisionDesktop />}
      {verRevision && (isDesktop || aceptada) && (
        <RevisionPantallaCompleta
          titulo={
            aceptada
              ? (isDesktop ? 'Corrige y guarda tu Planeación Inicial ya aceptada' : 'Vista previa — Planeación Inicial')
              : 'Corrige y guarda antes de aceptarla'
          }
          onCerrar={cerrarRevision}
          cerrarTexto={!aceptada ? 'Salir y aceptar luego' : null}
          tabs={<SelectorParcial porParcial={actual?.porParcial} activo={parcialActivo} onCambiar={cambiarParcialRevision} />}
          acciones={isDesktop && (
            <>
              <button
                type="button"
                onClick={aceptada ? guardarAceptada : guardar}
                disabled={aceptada ? (!sinGuardarAceptada || guardandoAceptada) : (!sinGuardar || guardando)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm disabled:opacity-60 ${
                  (aceptada ? sinGuardarAceptada : sinGuardar)
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'border border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
                }`}
              >
                {(aceptada ? guardandoAceptada : guardando) ? <Spinner size="sm" /> : <Save size={14} />}
                {(aceptada ? sinGuardarAceptada : sinGuardar) ? 'Guardar cambios' : 'Guardado'}
              </button>
              {!aceptada && (
                <button
                  type="button"
                  onClick={() => setConfirmarAceptar(true)}
                  disabled={aceptando}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
                >
                  {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                  Aceptar esta planeación como mi Planeación Inicial
                </button>
              )}
            </>
          )}
        >
          {isDesktop ? (
            <DocumentoPlaneacionEditable
              secuencias={secuenciasActivo}
              onCambiarCampo={cambiarCampo}
              onMover={moverSecuencia}
              onEliminar={eliminarSecuencia}
              onAgregar={agregarSecuencia}
            />
          ) : (
            // Solo lectura en celular (aceptada) — sin controles de edición.
            <div className="bg-white rounded shadow-card mx-auto max-w-3xl p-6 space-y-4">
              {secuenciasActivo.map((s, i) => (
                <div key={s.id} className="pb-3 border-b border-neutral-200 last:border-b-0">
                  <p className="text-lg font-bold text-neutral-900" style={{ fontFamily: 'Georgia, serif' }}>
                    Secuencia Didáctica {i + 1}{s.nombre ? ` — ${s.nombre}` : ''}
                  </p>
                  {CAMPOS_SECUENCIA.filter((c) => c.clave !== 'nombre').map(({ clave, etiqueta }) => (
                    s[clave] ? (
                      <div key={clave} className="mt-1">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{etiqueta}</p>
                        <p className="text-sm text-neutral-900 whitespace-pre-wrap" style={{ fontFamily: 'Georgia, serif' }}>{s[clave]}</p>
                      </div>
                    ) : null
                  ))}
                </div>
              ))}
            </div>
          )}
        </RevisionPantallaCompleta>
      )}

      {anteriores.length > 0 && (
        <div className="mt-2 pt-2 border-t border-outline-variant">
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted hover:text-on-surface"
          >
            {verHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {anteriores.length} generación{anteriores.length > 1 ? 'es' : ''} anterior{anteriores.length > 1 ? 'es' : ''} (sin aceptar, no descargable)
          </button>
          {verHistorial && (
            <div className="mt-2 space-y-1.5">
              {anteriores.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">
                    {h.generadoEn?.toDate && h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  <span className="text-muted italic">Reemplazada — no se puede descargar</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Generar tu Planeación Inicial"
          descripcion="La IA usa tu Perfil IA, tus fuentes ya guardadas y los diagnósticos del grupo — genera un documento por cada parcial real de la asignatura en una sola operación."
          costoMin={creditosIA.estimar('planeacion_didactica_inicial') ?? 20}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <SelectorCantidadSecuencias
            modo={modoCantidad}
            onCambiarModo={setModoCantidad}
            cantidad={cantidadManual}
            onCambiarCantidad={setCantidadManual}
            disabled={generando}
          />
          <InsumosOpcionales
            disabled={generando}
            hayContexto={hayContexto}
            hayConocimientos={hayConocimientos}
            incluirComentarios={incluirInsumos.comentarios}
            incluirAutoanalisis={incluirInsumos.autoanalisis}
            incluirConsideraciones={incluirInsumos.consideraciones}
            incluirDiagContexto={incluirInsumos.diagContexto}
            incluirDiagConocimientos={incluirInsumos.diagConocimientos}
          />
        </ConfirmacionCreditosModal>
      )}

      {confirmarAceptar && (
        <ConfirmModal
          title="¿Aceptar esta Planeación Didáctica Inicial?"
          message="Se guarda con las correcciones que hayas hecho, en TODOS los parciales. Cuando la aceptes queda fija como tu Planeación Inicial, con la fecha de hoy — podrás seguir corrigiéndola desde una computadora, y verla y descargarla las veces que quieras (si tu suscripción está pagada)."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptando}
          onConfirm={aceptar}
          onCancel={() => { if (!aceptando) setConfirmarAceptar(false) }}
        />
      )}

      {confirmarReiniciar && (
        <ConfirmModal
          title="¿Generar una Planeación Inicial nueva?"
          message="Tu Planeación Inicial aceptada se eliminará de forma automática e irreversible — no se puede recuperar después. En su lugar podrás generar y editar una completamente nueva."
          confirmLabel="Eliminar y empezar de nuevo"
          confirmingLabel="Eliminando…"
          busy={reiniciando}
          onConfirm={reiniciar}
          onCancel={() => { if (!reiniciando) setConfirmarReiniciar(false) }}
        />
      )}
    </div>
  )
}
