// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
// Genera una PROPUESTA en Excel para los parciales reales de la asignatura;
// el docente la revisa, puede regenerarla y descargarla — nunca se aplica
// sola a ningún otro módulo de Evalúa Fácil.
import { useEffect, useRef, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { updateDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import EFDateTimePicker from '../EFDateTimePicker'
import ParcialesFechas, { addOneDay, normalizeParcialesFechas } from '../ParcialesFechas'
import useCreditosIA from '../../hooks/useCreditosIA'
import useDiagnosticoEstado from '../../hooks/useDiagnosticoEstado'
import { descargarPlaneacionExcel } from '../../utils/planeacionExcel'
import { leerCuadriculaExcel, leerTablasWord, llenarPlantillaExcel, llenarPlantillaWord, aplanarCuadricula } from '../../utils/plantillaOficial'
import { renderAsync as renderDocxAsync } from 'docx-preview'
import { useSubscription } from '../../hooks/useSubscription'
import useIsDesktop from '../../hooks/useIsDesktop'
import CheckoutModal from '../CheckoutModal'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp, ThumbsUp, Eye, Lock, FileCheck2, X, Monitor, Save, AlertTriangle } from 'lucide-react'

// Nombres de columnas para la vista previa en pantalla — mismo orden y
// etiquetas que planeacionExcel.js, pero en tarjetas apiladas (no tabla),
// porque una tabla de 8 columnas no cabe en un celular sin scroll horizontal
// (ver PlanComparisonTable.jsx, mismo problema encontrado ahí el 13-ago-2026).
const CAMPOS_VISTA_PREVIA = [
  ['contenidosTemas', 'Contenidos / temas'],
  ['proposito', 'Propósito / aprendizaje esperado'],
  ['actividades', 'Actividades de aprendizaje'],
  ['estrategia', 'Estrategia / metodología'],
  ['recursos', 'Recursos'],
  ['evidencias', 'Evidencias'],
  ['evaluacion', 'Evaluación'],
  ['observaciones', 'Observaciones / ajustes'],
  ['fechaEstimada', 'Fecha estimada'],
]

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
        Tu Perfil IA y el programa de estudios (Fuentes) siempre se usan. Los demás se marcan arriba, en la
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

function millisDe(ts) {
  return ts?.toMillis?.() || 0
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
      {lista ? 'Lista para generar' : 'Falta el programa de estudios'}
    </span>
  )
}

// Celda editable "en su lugar" — sin borde propio hasta que se toca, para
// que la tabla se vea como el documento real y no como un formulario con
// cajas (Opción C elegida por Kike, 15-ago-2026: editar directo sobre la
// tabla, no en una lista aparte). Crece con el contenido (auto-resize en
// cada cambio, incluso el primer render) para que SIEMPRE se vea el texto
// completo, sin scroll interno ni recorte (pedido de Kike, 15-ago-2026).
function CeldaEditable({ value, onChange, resaltada, placeholder }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className={`w-full min-w-[140px] min-h-[3.5rem] px-1.5 py-1 text-xs bg-transparent border border-dashed rounded-none resize-none overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus:bg-surface-card ${
        resaltada ? 'border-accent/50 bg-[var(--accent-tint)]' : 'border-transparent hover:border-outline-variant'
      }`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      maxLength={400}
    />
  )
}

// Vista de la Planeación genérica como tabla real (una por parcial), no
// como tarjetas apiladas — se ve más parecida a cómo va a quedar. Editable
// mientras no esté aceptada (pedido de Kike, 14-ago-2026): la Planeación es
// la columna vertebral de las actividades que la IA propone después, así
// que lo que quede como "aceptada" debe ser exactamente lo que el docente
// revisó y corrigió aquí — no un Excel editado por fuera que Evalúa Fácil
// nunca ve. Con `onChange` se edita en el navegador; sin él, solo lectura
// (versión ya aceptada).
function VistaPreviaPlaneacion({ resultado, onChange }) {
  if (!resultado?.parciales?.length) return null
  const editable = typeof onChange === 'function'

  function actualizarCampo(numeroParcial, filaIdx, campo, valor) {
    const parciales = resultado.parciales.map((p) => {
      if (p.numero !== numeroParcial) return p
      const filas = p.filas.map((f, i) => (i === filaIdx ? { ...f, [campo]: valor } : f))
      return { ...p, filas }
    })
    onChange({ ...resultado, parciales })
  }

  return (
    <div className="space-y-6">
      {resultado.parciales.map((parcial) => (
        <div key={parcial.numero}>
          <p className="text-sm font-semibold text-on-surface mb-1.5">
            Parcial {parcial.numero}{parcial.periodo ? ` — ${parcial.periodo}` : ''}
          </p>
          {!parcial.filas?.length ? (
            <p className="text-xs text-muted">La IA no generó una propuesta para este parcial con las fuentes disponibles.</p>
          ) : (
            <div className="space-y-3">
              {parcial.filas.map((fila, i) => (
                <div key={i} className="border border-outline-variant overflow-hidden">
                  <p className="text-xs font-semibold text-on-surface bg-surface-container px-2 py-1 border-b border-outline-variant">
                    Tema {i + 1}
                  </p>
                  <table className="border-collapse w-full table-fixed">
                    <tbody>
                      {CAMPOS_VISTA_PREVIA.map(([campo, etiqueta]) => (
                        <tr key={campo}>
                          <th className="border border-outline-variant bg-[var(--accent-tint)] px-2 py-1.5 text-xs font-semibold text-on-surface text-left align-top w-40 sm:w-52 whitespace-normal">
                            {etiqueta}
                          </th>
                          <td className="border border-outline-variant p-0 align-top w-auto">
                            {editable ? (
                              <CeldaEditable
                                value={fila[campo] || ''}
                                onChange={(valor) => actualizarCampo(parcial.numero, i, campo, valor)}
                              />
                            ) : (
                              <p className="text-xs text-on-surface px-2 py-1.5">{fila[campo] || ''}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Reconstruye la cuadrícula real del formato oficial (una por tabla, para
// Word con varias tablas) combinando las celdas originales (encabezados,
// solo lectura) con las que la IA propuso llenar (editables) — para
// mostrar y editar la tabla tal cual es, no una lista de campos sueltos.
function construirGridOficial(celdasOriginales, celdasPropuestas) {
  const porTabla = new Map()
  const clave = (t) => (t ?? null)
  const celda = (t, f, c) => `${clave(t)}_${f}_${c}`

  for (const c of celdasOriginales) {
    const t = clave(c.tablaIndex)
    if (!porTabla.has(t)) porTabla.set(t, new Map())
    porTabla.get(t).set(celda(t, c.fila, c.columna), { fila: c.fila, columna: c.columna, texto: c.texto, editable: false, colSpan: c.colSpan || 1 })
  }
  celdasPropuestas.forEach((c, idx) => {
    const t = clave(c.tablaIndex)
    if (!porTabla.has(t)) porTabla.set(t, new Map())
    // Si esta celda ya existía en la cuadrícula original (celda combinada
    // vacía, con colSpan > 1), se conserva su colSpan — si no, se
    // sobreescribiría con 1 y la celda dejaría de verse combinada.
    const previa = porTabla.get(t).get(celda(t, c.fila, c.columna))
    porTabla.get(t).set(celda(t, c.fila, c.columna), { fila: c.fila, columna: c.columna, texto: c.texto, editable: true, idx, colSpan: previa?.colSpan || 1 })
  })

  return Array.from(porTabla.entries()).map(([t, cellsMap]) => {
    const cells = Array.from(cellsMap.values())
    const filas = [...new Set(cells.map((c) => c.fila))].sort((a, b) => a - b)
    const columnas = [...new Set(cells.map((c) => c.columna))].sort((a, b) => a - b)
    const grid = filas.map((f) => columnas.map((c) => cellsMap.get(celda(t, f, c)) || null))
    return { tablaIndex: t, grid }
  })
}

// Tabla real y editable del formato oficial — reemplaza la lista de campos
// sueltos: se ve la tabla completa (encabezados incluidos, de solo
// lectura) y solo las celdas que la IA propuso llenar se editan, en su
// lugar (Opción C, pedido de Kike, 15-ago-2026).
// Sin `onChangeCelda` (versión ya aceptada, solo para ver) las celdas
// propuestas se muestran como texto — mismo criterio que VistaPreviaPlaneacion.
function TablaOficialEditable({ celdasOriginales, celdasPropuestas, onChangeCelda }) {
  const editable = typeof onChangeCelda === 'function'
  const tablas = construirGridOficial(celdasOriginales, celdasPropuestas)
  return (
    <div className="space-y-4">
      {tablas.map(({ tablaIndex, grid }) => (
        <div key={String(tablaIndex)} className="overflow-x-auto border border-outline-variant">
          <table className="border-collapse w-full">
            <tbody>
              {grid.map((fila, fi) => (
                <tr key={fi}>
                  {fila.map((c, ci) => (
                    // Sin celda en esta posición = la cubre el colSpan de la
                    // celda anterior en la misma fila (celda combinada) — no
                    // se renderiza un <td> aparte, lo dejaría desalineado.
                    !c ? null : (
                      <td key={ci} colSpan={c.colSpan} className="border border-outline-variant p-0 align-top">
                        {c.editable && editable ? (
                          <CeldaEditable
                            value={c.texto}
                            resaltada
                            onChange={(valor) => onChangeCelda(c.idx, valor)}
                          />
                        ) : (
                          <p className={`text-xs px-1.5 py-1 min-w-[140px] ${c.editable ? 'text-on-surface' : 'font-medium text-on-surface bg-surface-container'}`}>{c.texto}</p>
                        )}
                      </td>
                    )
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// A pantalla completa salvo el sidebar azul (pedido de Kike, 15-ago-2026) —
// la revisión de la Planeación necesita todo el ancho posible para verse
// como el documento real, no como una lista angosta. Solo en escritorio: en
// celular no hay espacio para una tabla así, así que ni se intenta mostrar
// (ver useIsDesktop) — el docente revisa desde una computadora.
function RevisionPantallaCompleta({ titulo, onCerrar, acciones, children }) {
  return (
    <div className="fixed inset-0 md:left-[300px] z-40 bg-surface-card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant flex-shrink-0">
        <h2 className="font-bold text-on-surface">{titulo}</h2>
        <div className="flex items-center gap-2">
          {acciones}
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="p-1.5 rounded text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </div>
  )
}

// Aviso cuando la pantalla es angosta (celular/tablet chica) — la revisión
// no se intenta mostrar ahí, ni la genérica ni la del formato oficial
// (pedido explícito de Kike, 15-ago-2026).
function AvisoRevisionDesktop() {
  return (
    <div className="mt-3 pt-2 border-t border-outline-variant flex items-start gap-2 text-xs text-amber-700">
      <Monitor size={16} className="flex-shrink-0 mt-0.5" />
      <p>Ya se generó — para revisarla, corregirla y aceptarla/descargarla, abre Evalúa Fácil desde una computadora.</p>
    </div>
  )
}

export default function PlaneacionInicialSection({ subjectId, subject, asignaturaNombre, hayFuentesGenerales, watermark = false }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const { subscription, refresh: refreshSubscription } = useSubscription()
  // Mismo criterio que exportGuard.js: bloqueado mientras nunca hubo un pago
  // aprobado, sin importar si la suscripción sigue vigente o no.
  const nuncaAprobado = !subscription?.planId
  const [verPreview, setVerPreview] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [formato, setFormato] = useState('simple')
  // Fechas para la extendida cuando la asignatura todavía no las tiene
  // (decisión de Kike, 13-ago-2026: la extendida reparte los temas en el
  // tiempo real del curso, así que si no hay fechas se piden aquí mismo,
  // antes de generar — se guardan en la asignatura, no solo en esta
  // generación, para que ya queden puestas de una vez).
  const [fechaInicioForm, setFechaInicioForm] = useState('')
  const [fechaFinForm, setFechaFinForm] = useState('')
  const [parcialesFechasForm, setParcialesFechasForm] = useState([])
  const [generando, setGenerando] = useState(false)
  const [descargandoId, setDescargandoId] = useState(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [confirmarAceptar, setConfirmarAceptar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  // Copia editable del resultado mientras no está aceptada — lo que el
  // docente corrija aquí es lo que se guarda al aceptar (ver `aceptar()`),
  // no el `resultado` original de la IA. Se reinicia cada vez que cambia
  // `actual.id` (nueva generación o recarga de la página) — a partir de lo
  // último guardado como borrador si existe (subjects/{id}.planeacionBorrador,
  // pedido de Kike, 15-ago-2026: un docente entra varias veces a corregir
  // antes de aceptar, así que el avance debe sobrevivir a cerrar la pestaña,
  // no solo a cerrar y reabrir el modal en la misma sesión).
  const [edicion, setEdicion] = useState(null)
  const [edicionDeId, setEdicionDeId] = useState(null)
  const [plantillaOficial, setPlantillaOficial] = useState(null)
  const [generandoOficial, setGenerandoOficial] = useState(false)
  const [confirmandoOficial, setConfirmandoOficial] = useState(false)
  // Controla si la revisión a pantalla completa está abierta (Opción C,
  // pedido de Kike, 15-ago-2026) — se abre sola justo después de generar, y
  // el docente la puede volver a abrir/cerrar sin perder el avance (la
  // Planeación sigue "sin aceptar" hasta que de verdad la acepte).
  const [revisandoGenerica, setRevisandoGenerica] = useState(false)
  // Formato oficial: mismo ciclo editar → aceptar → ver/descargar que la
  // Planeación genérica de arriba (decisión de Kike, 15-ago-2026 — antes
  // era una edición de una sola sesión en memoria, sin "aceptar", que se
  // perdía al cerrar la pestaña). `historialOficial` viene de
  // planeacionesOficialesIA (bitácora append-only, la escribe el propio
  // servidor — ver ejecutarPlaneacionFormatoOficial en functions/ia.js).
  const [historialOficial, setHistorialOficial] = useState([])
  const [histOficialLoaded, setHistOficialLoaded] = useState(false)
  const [edicionOficial, setEdicionOficial] = useState(null)
  const [edicionOficialDeId, setEdicionOficialDeId] = useState(null)
  const [revisandoOficial, setRevisandoOficial] = useState(false)
  // Vista previa en imagen de cómo se imprimiría el formato oficial YA
  // ACEPTADO — con sus logos y todo lo que traiga la plantilla real (pedido
  // de Kike, 15-ago-2026). Solo para Word: docx-preview renderiza el .docx
  // real (relleno con las celdas aceptadas) tal cual, imágenes incluidas.
  // Excel no tiene un renderizador confiable en el navegador — para ese caso
  // se avisa que hay que descargar para verlo con su formato real.
  const [verVistaPreviaOficial, setVerVistaPreviaOficial] = useState(false)
  const [cargandoVistaPrevia, setCargandoVistaPrevia] = useState(false)
  const [blobVistaPrevia, setBlobVistaPrevia] = useState(null)
  const vistaPreviaRef = useRef(null)
  const [verHistorialOficial, setVerHistorialOficial] = useState(false)
  const [aceptandoOficial, setAceptandoOficial] = useState(false)
  const [confirmarAceptarOficial, setConfirmarAceptarOficial] = useState(false)
  const [guardandoOficial, setGuardandoOficial] = useState(false)
  const [descargandoOficial, setDescargandoOficial] = useState(false)
  // Deshacer la aceptación (pedido de Kike, 15-ago-2026): antes, una vez
  // aceptada no había forma de volver atrás desde la pantalla. Esto NO borra
  // la bitácora (planeacionesIA/planeacionesOficialesIA son inmutables,
  // firestore.rules lo impide a propósito) — solo quita la aceptación y
  // cualquier borrador, para que los botones "Generar de nuevo" reaparezcan
  // y el docente arranque una Planeación Inicial nueva y editable.
  const [confirmarReiniciar, setConfirmarReiniciar] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const isDesktop = useIsDesktop()
  // Único requisito indispensable: fuentes generales (programa de estudios) —
  // el Perfil IA ya es obligatorio para llegar a esta pestaña (se oculta
  // entera sin él, ver SubjectPage.jsx), así que siempre se incluye, sin
  // casilla (decisión de Kike, 15-ago-2026). Los otros cuatro se marcan cada
  // uno en SU PROPIA tarjeta (Comentarios, Autoanálisis, Consideraciones,
  // Diagnóstico de contexto/conocimientos) y se leen de
  // config.incluirEnPlaneacion — decisión de Kike, 14-ago-2026: no duplicar
  // el control en un modal aparte.
  const [incluirEnPlaneacion, setIncluirEnPlaneacion] = useState({})
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

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setIncluirEnPlaneacion(snap.exists() ? (snap.data().incluirEnPlaneacion || {}) : {})
      setPlantillaOficial(snap.exists() ? (snap.data().plantillaOficial || null) : null)
    }, () => { setIncluirEnPlaneacion({}); setPlantillaOficial(null) })
    return unsub
  }, [subjectId])

  // El diagnóstico "real" (Tandas 1 y 2) vive en `activities` — no en la
  // vieja `subjects/{id}/diagnosticosIA` (reporte simulado, descartado).
  // Mismo hook que usa DiagnosticoGrupoSection para su propia señal visual —
  // 'completado' es exactamente lo que ya validaba este componente (existe
  // un análisis real en activities/{id}/analisisIA), igual que el servidor
  // en analisisDiagnosticoMasReciente.
  const { estado: estadoContexto, cargado: contextoCargado } = useDiagnosticoEstado(subjectId, 'contexto')
  const { estado: estadoConocimientos, cargado: conocimientosCargado } = useDiagnosticoEstado(subjectId, 'conocimientos')
  const hayContexto = estadoContexto === 'completado'
  const hayConocimientos = estadoConocimientos === 'completado'
  const diagLoaded = contextoCargado && conocimientosCargado

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, 'planeacionesIA'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Sin orderBy en la consulta (restricción del proyecto) — se ordena en
      // memoria, más recientes primero.
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setHistLoaded(true)
    }, () => setHistLoaded(true))
    return unsub
  }, [subjectId])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, 'planeacionesOficialesIA'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorialOficial(items)
      setHistOficialLoaded(true)
    }, () => setHistOficialLoaded(true))
    return unsub
  }, [subjectId])

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // nueva (o al recargar la página) — nunca pisa ediciones en curso del
  // mismo `actual.id` (por eso compara contra `edicionDeId`, no re-copia en
  // cada render). Ajuste de estado durante el render, NO en un efecto —
  // patrón oficial de React para "resetear estado cuando cambia una prop"
  // (evita el aviso de cascading renders de un setState dentro de un
  // useEffect).
  const actualIdParaEdicion = historial[0]?.id || null
  if (actualIdParaEdicion !== edicionDeId) {
    const borrador = subject?.planeacionBorrador?.planeacionId === actualIdParaEdicion
      ? subject.planeacionBorrador.resultado : null
    setEdicion(actualIdParaEdicion ? (borrador || historial[0].resultado) : null)
    setEdicionDeId(actualIdParaEdicion)
  }
  const actualOficialIdParaEdicion = historialOficial[0]?.id || null
  if (actualOficialIdParaEdicion !== edicionOficialDeId) {
    const borradorOficial = subject?.planeacionOficialBorrador?.planeacionId === actualOficialIdParaEdicion
      ? subject.planeacionOficialBorrador.celdas : null
    setEdicionOficial(actualOficialIdParaEdicion ? (borradorOficial || historialOficial[0].celdasPropuestas) : null)
    setEdicionOficialDeId(actualOficialIdParaEdicion)
  }

  // Único requisito indispensable: fuentes generales — el resto de insumos
  // (perfil, comentarios, autoanálisis, diagnósticos) son opcionales, el
  // docente los palomea antes de generar (decisión de Kike, 14-ago-2026).
  const habilitado = hayFuentesGenerales

  // La extendida reparte temas en el tiempo real del curso — exige fechas.
  const numParciales = Math.max(1, Number(subject?.parciales) || 1)
  const fechasCompletas = Array.isArray(subject?.parcialesFechas)
    && subject.parcialesFechas.length >= numParciales
    && subject.parcialesFechas.slice(0, numParciales).every((f) => f?.inicio && f?.fin)
  const esExtendida = formato === 'extendida'
  const faltanFechas = esExtendida && !fechasCompletas
  const parcialesFechasCompletasForm = fechaInicioForm && fechaFinForm
    && parcialesFechasForm.length >= numParciales
    && parcialesFechasForm.slice(0, numParciales).every((f) => f?.inicio && f?.fin)

  async function generar() {
    // La extendida necesita fechas reales del curso — si la asignatura no
    // las tiene, se piden aquí mismo y se guardan en la asignatura antes de
    // generar (no solo en esta generación, para que ya queden puestas).
    if (faltanFechas) {
      if (!parcialesFechasCompletasForm) {
        toast('Completa la fecha de inicio, fin y el fin de cada parcial antes de generar', 'error')
        return
      }
      try {
        await updateDoc(doc(db, 'subjects', subjectId), {
          fechaInicio: fechaInicioForm,
          fechaFin: fechaFinForm,
          parcialesFechas: parcialesFechasForm,
        })
      } catch (err) {
        toast('No se pudieron guardar las fechas: ' + err.message, 'error')
        return
      }
    }
    setGenerando(true)
    try {
      // La función misma guarda el resultado en planeacionesIA (ver
      // ejecutarPlaneacionDidacticaInicial en functions/ia.js) — una llamada
      // por parcial puede tardar más que el timeout por omisión del SDK
      // (70 s), y sin timeoutMs aquí el cliente se rendía antes de que el
      // servidor terminara, aunque el trabajo YA se hubiera cobrado y
      // guardado. El listener onSnapshot de abajo la recibe en cuanto se
      // guarda, así que no hace falta escribirla otra vez desde aquí —
      // hacerlo duplicaría la entrada en la bitácora.
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, formato, incluir: incluirInsumos,
      }, 1, { timeoutMs: 240000 })
      setConfirmando(false)
      if (data?.resultado) {
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Planeación generada — revísala y acéptala cuando estés conforme')
        setRevisandoGenerica(true)
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') toast('No tienes suficientes créditos de IA para esta acción', 'error')
      else if (err.codigo === 'PERFIL_IA_INCOMPLETO') toast('Marcaste incluir tu Perfil IA, pero todavía no lo completas — complétalo o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_FUENTES_GENERALES') toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONTEXTO') toast('Marcaste incluir el Diagnóstico de contexto, pero todavía no tiene resultados analizados — genera y analiza el instrumento, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONOCIMIENTOS') toast('Marcaste incluir el Diagnóstico de conocimientos, pero todavía no tiene resultados analizados — genera y analiza el cuestionario, o desmarca esa casilla', 'error')
      else toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
    } finally {
      setGenerando(false)
    }
  }

  // Fija la Planeación PARA SIEMPRE (decisión de Kike, 13-ago-2026): a
  // partir de aquí ya no se ofrece "Generar de nuevo" — la IA usa esta
  // versión para todo lo que genere después. Se guarda en `subjects/{id}`
  // (no en el doc de planeacionesIA, que es una bitácora inmutable/
  // append-only — ver firestore.rules) para no necesitar tocar esa regla.
  // Guarda `edicion` (lo que el docente corrigió en pantalla), NO
  // `actual.resultado` (lo que la IA propuso sin tocar) — decisión de Kike,
  // 14-ago-2026: la Planeación aceptada es la columna vertebral de las
  // actividades del curso, así que debe ser exactamente lo que el docente
  // revisó y aprobó, campo por campo, no un archivo editado por fuera que
  // Evalúa Fácil nunca llega a ver.
  // Guarda el avance de la corrección SIN aceptar — pedido de Kike,
  // 15-ago-2026: un docente entra varias veces a corregir antes de aceptar
  // (calculó ~10), así que debe poder guardar y seguir después sin perder lo
  // ya hecho. Se guarda en `subjects/{id}.planeacionBorrador` (mutable, a
  // diferencia de la bitácora planeacionesIA) — solo mientras no está
  // aceptada; una vez aceptada, `aceptar()` la limpia.
  async function guardar() {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionBorrador: { planeacionId: actual.id, resultado: edicion, actualizadoEn: serverTimestamp() },
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
        planeacionAceptada: { planeacionId: actual.id, aceptadaEn: serverTimestamp(), resultado: edicion || actual.resultado },
        planeacionBorrador: null,
      })
      toast('Planeación aceptada — a partir de aquí la usa la IA para todo lo demás')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // A diferencia de "Descargar Excel" (gratis, a partir de un resultado ya
  // guardado), generar en el formato oficial SÍ es una operación de IA
  // nueva (tarifa fija): la IA lee la estructura completa de la plantilla
  // (todas las celdas, con sus encabezados) y decide sola qué casillas
  // están vacías y deben llenarse — el docente no marca nada para generar,
  // pero SÍ revisa y corrige cada celda propuesta antes de aceptarla (ver
  // `aceptarOficial`) — mismo principio que la Planeación
  // genérica: no se descarga nada sin que el docente lo haya revisado.
  async function generarFormatoOficial() {
    if (nuncaAprobado) {
      setShowPaymentModal(true)
      return
    }
    setGenerandoOficial(true)
    try {
      const resPlantilla = await fetch(plantillaOficial.url)
      const bufferOriginal = await resPlantilla.arrayBuffer()
      const tablas = plantillaOficial.tipo === 'docx'
        ? await leerTablasWord(bufferOriginal)
        : [(await leerCuadriculaExcel(bufferOriginal))].map((c) => ({ filas: c.filas }))
      const celdas = aplanarCuadricula(tablas)
      if (!celdas.length) {
        toast('No se pudo leer la estructura de tu plantilla', 'error')
        return
      }

      // La función misma guarda el resultado en planeacionesOficialesIA (ver
      // ejecutarPlaneacionFormatoOficial en functions/ia.js) — el listener
      // onSnapshot de arriba la recibe en cuanto se guarda, así que no hace
      // falta guardar nada más desde aquí.
      const data = await creditosIA.ejecutar('planeacion_formato_oficial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, incluir: incluirInsumos,
        celdas: celdas.map((c) => ({ f: c.fila, c: c.columna, t: c.tablaIndex, x: c.texto, s: c.colSpan || 1 })),
      }, 1, { timeoutMs: 240000 })
      setConfirmandoOficial(false)
      if (data?.resultado?.celdas?.length) {
        toast(
          data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional) — revísala y acéptala cuando estés conforme.'
            : 'Planeación generada en el formato de tu escuela — revísala y acéptala cuando estés conforme.',
          'info'
        )
        setRevisandoOficial(true)
      }
    } catch (err) {
      setConfirmandoOficial(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') toast('No tienes suficientes créditos de IA para esta acción', 'error')
      else if (err.codigo === 'PERFIL_IA_INCOMPLETO') toast('Marcaste incluir tu Perfil IA, pero todavía no lo completas — complétalo o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_FUENTES_GENERALES') toast('Agrega primero un documento en Fuentes para todo el curso', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONTEXTO') toast('Marcaste incluir el Diagnóstico de contexto, pero todavía no tiene resultados analizados — genera y analiza el instrumento, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONOCIMIENTOS') toast('Marcaste incluir el Diagnóstico de conocimientos, pero todavía no tiene resultados analizados — genera y analiza el cuestionario, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_PLANTILLA_OFICIAL') toast('Sube primero la plantilla oficial de tu escuela', 'error')
      else toast(err.message || 'No se pudo generar el archivo', 'error')
    } finally {
      setGenerandoOficial(false)
    }
  }

  // Fija el formato oficial PARA SIEMPRE, igual que `aceptar()` de la
  // genérica (decisión de Kike, 15-ago-2026): a partir de aquí ya no se
  // ofrece "Generar de nuevo" — queda visible y descargable con las
  // correcciones del docente, sin importar cuántas veces vuelva.
  async function aceptarOficial() {
    setAceptandoOficial(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionOficialAceptada: {
          planeacionId: actualOficial.id,
          aceptadaEn: serverTimestamp(),
          celdas: edicionOficial || actualOficial.celdasPropuestas,
        },
        planeacionOficialBorrador: null,
      })
      toast('Planeación Inicial aceptada — ya puedes verla y descargarla')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptandoOficial(false)
      setConfirmarAceptarOficial(false)
    }
  }

  // Mismo "Guardar" que la genérica (ver `guardar()` de arriba) — guarda el
  // avance sin aceptar, para que sobreviva a cerrar la pestaña.
  async function guardarOficial() {
    setGuardandoOficial(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionOficialBorrador: { planeacionId: actualOficial.id, celdas: edicionOficial, actualizadoEn: serverTimestamp() },
      })
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardandoOficial(false)
    }
  }

  // Quita la aceptación (cualquiera de las dos, la que esté) y sus
  // borradores — irreversible: no hay forma de recuperar cuál era la
  // aceptada una vez hecho esto. Los botones "Generar de nuevo" de arriba
  // reaparecen solos en cuanto `aceptadaInicial` vuelve a false.
  async function reiniciarPlaneacionInicial() {
    setReiniciando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: null,
        planeacionBorrador: null,
        planeacionOficialAceptada: null,
        planeacionOficialBorrador: null,
      })
      toast('Planeación Inicial eliminada — ya puedes generar una nueva')
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setReiniciando(false)
      setConfirmarReiniciar(false)
    }
  }

  // Se descarga cualquier cantidad de veces después de aceptar (no solo la
  // primera) — vuelve a bajar la plantilla en blanco y la llena con las
  // celdas que quedaron aceptadas, nunca con lo que la IA propuso sin
  // revisar.
  async function descargarOficial() {
    if (nuncaAprobado) {
      setShowPaymentModal(true)
      return
    }
    if (!actualOficial || !plantillaOficial?.url) return
    setDescargandoOficial(true)
    try {
      const resPlantilla = await fetch(plantillaOficial.url)
      const bufferOriginal = await resPlantilla.arrayBuffer()
      const tipo = actualOficial.tipo || plantillaOficial.tipo
      const nombreOriginal = actualOficial.nombreOriginal || plantillaOficial.nombre
      const celdasFinal = celdasOficialAceptadas || actualOficial.celdasPropuestas
      const blob = tipo === 'docx'
        ? await llenarPlantillaWord(bufferOriginal, celdasFinal)
        : await llenarPlantillaExcel(bufferOriginal, celdasFinal)
      const nombreSalida = nombreOriginal.replace(/\.(docx?|xlsx?)$/i, '') +
        ' (llenada por IA)' + (tipo === 'docx' ? '.docx' : '.xlsx')

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
      setDescargandoOficial(false)
    }
  }

  // Rellena la plantilla real con las celdas aceptadas (mismo insumo que
  // descargarOficial) y la renderiza con docx-preview — se ve el documento
  // TAL CUAL, con sus logos e imágenes reales, no una tabla nuestra. Solo
  // Word: no hay forma confiable de reproducir un .xlsx (con sus imágenes y
  // formato) fiel en el navegador — ahí solo se avisa que hay que descargar.
  async function abrirVistaPreviaOficial() {
    if (!actualOficial || !plantillaOficial?.url) return
    const tipo = actualOficial.tipo || plantillaOficial.tipo
    if (tipo !== 'docx') {
      toast('La vista previa en imagen solo está disponible para Word por ahora — descarga el archivo para verlo con tu formato de Excel', 'info')
      return
    }
    setCargandoVistaPrevia(true)
    setVerVistaPreviaOficial(true)
    try {
      const resPlantilla = await fetch(plantillaOficial.url)
      const bufferOriginal = await resPlantilla.arrayBuffer()
      const celdasFinal = celdasOficialAceptadas || actualOficial.celdasPropuestas
      const blob = await llenarPlantillaWord(bufferOriginal, celdasFinal)
      setBlobVistaPrevia(blob)
    } catch (err) {
      toast('No se pudo generar la vista previa: ' + err.message, 'error')
      setVerVistaPreviaOficial(false)
    } finally {
      setCargandoVistaPrevia(false)
    }
  }

  function cerrarVistaPreviaOficial() {
    setVerVistaPreviaOficial(false)
    setBlobVistaPrevia(null)
  }

  // El contenedor de docx-preview solo existe una vez el modal ya está
  // montado — por eso renderiza en un efecto (que se dispara cuando ya hay
  // blob Y el ref existe), no directo dentro de abrirVistaPreviaOficial.
  useEffect(() => {
    if (!verVistaPreviaOficial || !blobVistaPrevia || !vistaPreviaRef.current) return
    vistaPreviaRef.current.innerHTML = ''
    renderDocxAsync(blobVistaPrevia, vistaPreviaRef.current, undefined, { inWrapper: true })
      .catch((err) => toast('No se pudo mostrar la vista previa: ' + err.message, 'error'))
  }, [verVistaPreviaOficial, blobVistaPrevia])

  // La descarga NUNCA pasa por el servidor ni por créditos: el .xlsx se
  // arma en el navegador a partir del `resultado` ya guardado. `resultado`
  // se pasa explícito (en vez de usar siempre `entry.resultado`) porque la
  // versión aceptada puede traer ediciones del docente que ya no coinciden
  // con lo que la IA generó originalmente — ver `aceptar()`.
  async function descargar(entry, resultado) {
    if (nuncaAprobado) {
      setShowPaymentModal(true)
      return
    }
    setDescargandoId(entry.id)
    try {
      await descargarPlaneacionExcel({ subject, resultado: resultado || entry.resultado, watermark, formato: entry.formato || 'simple' })
    } catch (err) {
      toast('No se pudo generar el Excel: ' + err.message, 'error')
    } finally {
      setDescargandoId(null)
    }
  }

  const actual = historial[0] || null
  const anteriores = historial.slice(1)
  // Aceptada = fija para siempre — ya no se ofrece "Generar de nuevo". Se
  // guarda en subjects/{id}.planeacionAceptada (no en el doc de
  // planeacionesIA, inmutable/append-only). Si el docente generó otra
  // versión sin aceptar la anterior, esa aceptación queda "huérfana"
  // apuntando a un id que ya no es `actual` — se trata como no aceptada,
  // nunca se hereda a una generación distinta de la que de verdad se aceptó.
  const aceptada = !!actual && subject?.planeacionAceptada?.planeacionId === actual.id
  const fechaAceptada = aceptada ? subject.planeacionAceptada.aceptadaEn : null
  // Lo que de verdad quedó aceptado — con las ediciones del docente si las
  // hizo (planeacionAceptada.resultado) o el resultado original si se
  // aceptó antes de que existiera la edición en pantalla (14-ago-2026).
  const resultadoAceptado = aceptada ? (subject.planeacionAceptada.resultado || actual.resultado) : null
  // Lo ya guardado (borrador si hay uno para esta generación, si no el
  // resultado original) — compara contra `edicion` para saber si hay algo
  // sin guardar y así habilitar el botón "Guardar".
  const guardadoResultado = actual && subject?.planeacionBorrador?.planeacionId === actual.id
    ? subject.planeacionBorrador.resultado : actual?.resultado
  const sinGuardar = !!actual && JSON.stringify(edicion) !== JSON.stringify(guardadoResultado)

  // Mismo criterio, para la versión en el formato oficial de la escuela —
  // guardado en subjects/{id}.planeacionOficialAceptada (campo aparte, no
  // pisa planeacionAceptada de arriba: son dos aceptaciones independientes).
  const actualOficial = historialOficial[0] || null
  const anterioresOficial = historialOficial.slice(1)
  const aceptadaOficial = !!actualOficial && subject?.planeacionOficialAceptada?.planeacionId === actualOficial.id
  const fechaAceptadaOficial = aceptadaOficial ? subject.planeacionOficialAceptada.aceptadaEn : null
  const celdasOficialAceptadas = aceptadaOficial
    ? (subject.planeacionOficialAceptada.celdas || actualOficial.celdasPropuestas)
    : null
  const guardadoOficialCeldas = actualOficial && subject?.planeacionOficialBorrador?.planeacionId === actualOficial.id
    ? subject.planeacionOficialBorrador.celdas : actualOficial?.celdasPropuestas
  const sinGuardarOficial = !!actualOficial && JSON.stringify(edicionOficial) !== JSON.stringify(guardadoOficialCeldas)

  // La Planeación Inicial es UNA sola (decisión de Kike, 15-ago-2026,
  // corrigiendo el diseño anterior que trataba genérica y formato oficial
  // como dos aceptaciones independientes): aceptar cualquiera de los dos
  // formatos bloquea el otro — ya no se puede generar ni aceptar, solo se
  // ve/descarga el que sí se aceptó.
  const aceptadaInicial = aceptada || aceptadaOficial

  if (!diagLoaded || !histLoaded || !histOficialLoaded) {
    return (
      <div className="bg-surface-card rounded-card shadow-card p-3 flex justify-center py-6">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-on-surface">Planeación Didáctica Inicial</h2>
        <EstadoPlaneacionBadge lista={hayFuentesGenerales} />
      </div>
      <p className="text-sm text-muted mt-0.5 mb-2">
        La IA puede generar tu Planeación Didáctica Inicial en dos formatos: un Excel genérico (una hoja
        por parcial) y, si subiste arriba el formato oficial de tu escuela, ese mismo llenado por la IA.
        Puedes probar y corregir los dos antes de decidir, pero solo aceptas UNO — ese es tu Planeación
        Inicial, y al aceptarlo el otro formato deja de estar disponible.
      </p>

      {!habilitado && (
        <ul className="space-y-1 mb-1">
          <RequisitoItem ok={hayFuentesGenerales} texto="Fuentes para todo el curso (programa de estudios)" />
        </ul>
      )}

      {habilitado && (
        <>
          {aceptada ? (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Aceptada — es tu Planeación Inicial, la usa la IA para todo lo demás</span>
              {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          ) : aceptadaOficial ? (
            <p className="text-xs text-muted mb-2">
              Tu Planeación Inicial ya quedó aceptada en el formato oficial de tu escuela (abajo) — no hace
              falta, ni se puede, aceptar también esta versión en Excel genérico.
            </p>
          ) : !actual ? (
            <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generada</span></p>
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
              {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              . Revísala y corrígela abajo, campo por campo, antes de aceptarla — no se puede descargar hasta que
              la aceptes. Una vez que la aceptes, queda fija: la IA la usa tal cual para todo lo demás.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!aceptadaInicial && (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                disabled={generando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {generando ? <Spinner size="sm" /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
                {actual ? 'Generar de nuevo (Excel genérico, con IA)' : 'Generar planeación (Excel genérico, con IA)'}
              </button>
            )}
            {actual && aceptada && (
              <button
                type="button"
                onClick={() => setVerPreview((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm text-on-surface hover:bg-[var(--accent-tint)]"
              >
                <Eye size={14} />
                {verPreview ? 'Ocultar vista previa' : 'Ver planeación'}
              </button>
            )}
            {actual && aceptada && (
              <button
                type="button"
                onClick={() => descargar(actual, resultadoAceptado)}
                disabled={descargandoId === actual.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
              >
                {descargandoId === actual.id ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : <Download size={14} />}
                Descargar Excel
              </button>
            )}
            {actual && !aceptadaInicial && isDesktop && (
              <button
                type="button"
                onClick={() => setRevisandoGenerica(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50"
              >
                <ThumbsUp size={14} />
                Revisar la planeación inicial y aceptarla
              </button>
            )}
            {plantillaOficial && !aceptadaInicial && (
              <button
                type="button"
                onClick={() => (nuncaAprobado ? setShowPaymentModal(true) : setConfirmandoOficial(true))}
                disabled={generandoOficial}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {generandoOficial ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : actualOficial ? <RotateCcw size={14} /> : <FileCheck2 size={14} />}
                {actualOficial ? 'Generar de nuevo mi formato oficial (con IA)' : 'Generar en el formato de mi escuela (con IA)'}
              </button>
            )}
            {actualOficial && aceptadaOficial && (
              <button
                type="button"
                onClick={abrirVistaPreviaOficial}
                disabled={cargandoVistaPrevia}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm text-on-surface hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {cargandoVistaPrevia ? <Spinner size="sm" /> : <Eye size={14} />}
                Vista previa
              </button>
            )}
            {actualOficial && aceptadaOficial && (
              <button
                type="button"
                onClick={descargarOficial}
                disabled={descargandoOficial}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
              >
                {descargandoOficial ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : <Download size={14} />}
                Descargar {actualOficial.tipo === 'docx' ? 'Word' : 'Excel'}
              </button>
            )}
            {actualOficial && !aceptadaInicial && isDesktop && (
              <button
                type="button"
                onClick={() => setRevisandoOficial(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50"
              >
                <ThumbsUp size={14} />
                Revisar la planeación inicial y aceptarla
              </button>
            )}
            {aceptadaInicial && (
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

          {plantillaOficial && (
            aceptadaOficial ? (
              <p className="text-xs text-muted mt-1.5">
                Planeación Inicial (formato oficial): <span className="font-medium text-green-700">Aceptada</span>
                {fechaAceptadaOficial?.toDate && ` · ${fechaAceptadaOficial.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              </p>
            ) : aceptada ? (
              <p className="text-xs text-muted mt-1.5">
                Tu Planeación Inicial ya quedó aceptada en el Excel genérico (arriba) — no hace falta, ni se
                puede, aceptar también esta versión en el formato oficial.
              </p>
            ) : !actualOficial ? (
              <p className="text-xs text-muted mt-1.5">
                El archivo en el formato de tu escuela es una propuesta de IA — la revisas y corriges en pantalla,
                y no se puede descargar hasta que la aceptes.
              </p>
            ) : (
              <p className="text-xs text-amber-700 mt-1.5">
                Planeación Inicial en el formato oficial generada, sin aceptar todavía — revísala y corrígela
                antes de aceptarla; no se puede descargar hasta entonces.
              </p>
            )
          )}

          {/* Revisión editable del formato oficial ANTES de aceptarla — mismo
              ciclo que la Planeación genérica de arriba (decisión de Kike,
              15-ago-2026): se guarda como bitácora, se puede editar y
              regenerar mientras no se acepte, y una vez aceptada queda fija
              (visible y descargable), ya no editable. Solo en escritorio.
              Aceptar CUALQUIERA de los dos formatos bloquea el otro por
              completo (15-ago-2026, corrección de Kike: la Planeación
              Inicial es UNA sola) — por eso todo aquí compara contra
              `aceptadaInicial`, no solo `aceptadaOficial`. */}
          {actualOficial && !aceptadaInicial && !isDesktop && <AvisoRevisionDesktop />}
          {actualOficial && !aceptadaInicial && isDesktop && revisandoOficial && (
            <RevisionPantallaCompleta
              titulo="Revisa la Planeación Inicial (formato oficial de tu escuela) y corrígela antes de aceptarla"
              onCerrar={() => setRevisandoOficial(false)}
              acciones={(
                <>
                  <button
                    type="button"
                    onClick={guardarOficial}
                    disabled={!sinGuardarOficial || guardandoOficial}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm text-on-surface hover:bg-[var(--accent-tint)] disabled:opacity-50"
                  >
                    {guardandoOficial ? <Spinner size="sm" /> : <Save size={14} />}
                    {sinGuardarOficial ? 'Guardar cambios' : 'Guardado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmarAceptarOficial(true)}
                    disabled={aceptandoOficial}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
                  >
                    {aceptandoOficial ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                    Aceptar esta planeación como mi Planeación Inicial
                  </button>
                </>
              )}
            >
              <TablaOficialEditable
                celdasOriginales={actualOficial.celdasOriginales || []}
                celdasPropuestas={edicionOficial || actualOficial.celdasPropuestas}
                onChangeCelda={(idx, texto) => setEdicionOficial((prev) => prev.map((x, j) => (j === idx ? { ...x, texto } : x)))}
              />
            </RevisionPantallaCompleta>
          )}

          {verVistaPreviaOficial && (
            <RevisionPantallaCompleta
              titulo="Vista previa — así se imprimiría"
              onCerrar={cerrarVistaPreviaOficial}
            >
              {cargandoVistaPrevia && !blobVistaPrevia ? (
                <div className="flex justify-center py-10"><Spinner /></div>
              ) : (
                <div className="flex justify-center overflow-x-auto">
                  <div ref={vistaPreviaRef} />
                </div>
              )}
            </RevisionPantallaCompleta>
          )}

          {anterioresOficial.length > 0 && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setVerHistorialOficial((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted hover:text-on-surface"
              >
                {verHistorialOficial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {anterioresOficial.length} generación{anterioresOficial.length > 1 ? 'es' : ''} anterior{anterioresOficial.length > 1 ? 'es' : ''} del formato oficial (sin aceptar, no descargable)
              </button>
              {verHistorialOficial && (
                <div className="mt-2 space-y-1.5">
                  {anterioresOficial.map((h) => (
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

          {/* Sin aceptar: revisión a pantalla completa (Opción C) — es el
              paso obligatorio antes de poder aceptar y descargar (pedido de
              Kike, 14/15-ago-2026). Solo en escritorio. Contra
              `aceptadaInicial` (no solo `aceptada`): aceptar el formato
              oficial bloquea esta también — la Planeación Inicial es UNA
              sola. */}
          {actual && !aceptadaInicial && !isDesktop && <AvisoRevisionDesktop />}
          {actual && !aceptadaInicial && isDesktop && revisandoGenerica && (
            <RevisionPantallaCompleta
              titulo="Revisa la Planeación Inicial y corrígela antes de aceptarla"
              onCerrar={() => setRevisandoGenerica(false)}
              acciones={(
                <>
                  <button
                    type="button"
                    onClick={guardar}
                    disabled={!sinGuardar || guardando}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-sm text-on-surface hover:bg-[var(--accent-tint)] disabled:opacity-50"
                  >
                    {guardando ? <Spinner size="sm" /> : <Save size={14} />}
                    {sinGuardar ? 'Guardar cambios' : 'Guardado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmarAceptar(true)}
                    disabled={aceptando}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
                  >
                    {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                    Aceptar esta planeación como mi Planeación Inicial
                  </button>
                </>
              )}
            >
              <VistaPreviaPlaneacion resultado={edicion || actual.resultado} onChange={setEdicion} />
            </RevisionPantallaCompleta>
          )}

          {verPreview && aceptada && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
              <VistaPreviaPlaneacion resultado={resultadoAceptado} />
            </div>
          )}

          {anteriores.length > 0 && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
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
        </>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Generar Planeación Didáctica Inicial"
          descripcion="La IA usa tu Perfil IA, tus fuentes ya guardadas y los diagnósticos del grupo — genera todos los parciales en una sola operación."
          costoMin={creditosIA.estimar('planeacion_didactica_inicial') ?? 20}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <InsumosOpcionales
            disabled={generando}
            hayContexto={hayContexto}
            hayConocimientos={hayConocimientos}
            incluirComentarios={incluirComentarios}
            incluirAutoanalisis={incluirAutoanalisis}
            incluirConsideraciones={incluirConsideraciones}
            incluirDiagContexto={incluirDiagContexto}
            incluirDiagConocimientos={incluirDiagConocimientos}
          />

          <fieldset className="mb-2">
            <legend className="text-sm text-on-surface mb-1">Formato</legend>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name="planeacion-formato"
                aria-label="Simple"
                checked={formato === 'simple'}
                disabled={generando}
                onChange={() => setFormato('simple')}
                className="mt-0.5"
              />
              <span className="text-sm text-on-surface">
                <strong>Simple</strong>
                <span className="block text-xs text-muted">Hasta 8 bloques agrupados por parcial — vista rápida.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name="planeacion-formato"
                aria-label="Extendida"
                checked={esExtendida}
                disabled={generando}
                onChange={() => setFormato('extendida')}
                className="mt-0.5"
              />
              <span className="text-sm text-on-surface">
                <strong>Extendida</strong>
                <span className="block text-xs text-muted">Una fila por cada tema real de tus fuentes, con fecha estimada dentro del curso — más detallado, más filas.</span>
              </span>
            </label>
          </fieldset>

          {faltanFechas && (
            <div className="mb-2 p-2.5 rounded border border-amber-200 bg-amber-50 space-y-2">
              <p className="text-xs text-amber-800">
                La extendida reparte los temas en fechas reales — esta asignatura todavía no tiene fechas de inicio/fin. Ponlas aquí (se guardan en la asignatura).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-xs text-muted mb-1">Inicio del curso</span>
                  <EFDateTimePicker
                    mode="date"
                    value={fechaInicioForm}
                    disabled={generando}
                    onChange={(v) => {
                      setFechaInicioForm(v)
                      setParcialesFechasForm((prev) => normalizeParcialesFechas(v, fechaFinForm, numParciales, prev))
                    }}
                  />
                </div>
                <div>
                  <span className="block text-xs text-muted mb-1">Fin del curso</span>
                  <EFDateTimePicker
                    mode="date"
                    value={fechaFinForm}
                    disabled={generando || !fechaInicioForm}
                    minDateTime={fechaInicioForm ? addOneDay(fechaInicioForm) : undefined}
                    onChange={(v) => {
                      setFechaFinForm(v)
                      setParcialesFechasForm((prev) => normalizeParcialesFechas(fechaInicioForm, v, numParciales, prev))
                    }}
                  />
                </div>
              </div>
              {fechaInicioForm && fechaFinForm && numParciales > 1 && (
                <ParcialesFechas
                  fechaInicio={fechaInicioForm}
                  fechaFin={fechaFinForm}
                  numParciales={numParciales}
                  value={parcialesFechasForm}
                  onChange={setParcialesFechasForm}
                />
              )}
            </div>
          )}
        </ConfirmacionCreditosModal>
      )}

      {confirmandoOficial && (
        <ConfirmacionCreditosModal
          titulo="Generar en el formato de mi escuela"
          descripcion="La IA analiza tu plantilla, decide qué casillas llenar y redacta el texto de cada una, usando tu Perfil IA, tus fuentes y los diagnósticos del grupo. Revisa el archivo antes de usarlo — puede contener errores."
          costoMin={creditosIA.estimar('planeacion_formato_oficial') ?? 20}
          ejecutando={generandoOficial}
          onCancelar={() => { if (!generandoOficial) setConfirmandoOficial(false) }}
          onContinuar={generarFormatoOficial}
        >
          <InsumosOpcionales
            disabled={generandoOficial}
            hayContexto={hayContexto}
            hayConocimientos={hayConocimientos}
            incluirComentarios={incluirComentarios}
            incluirAutoanalisis={incluirAutoanalisis}
            incluirConsideraciones={incluirConsideraciones}
            incluirDiagContexto={incluirDiagContexto}
            incluirDiagConocimientos={incluirDiagConocimientos}
          />
        </ConfirmacionCreditosModal>
      )}

      {confirmarAceptar && (
        <ConfirmModal
          title="¿Aceptar esta Planeación Didáctica Inicial?"
          message="Se guarda con las correcciones que hayas hecho arriba. A partir de aquí queda fija, con la fecha de hoy, y es la que usará el Asistente IA para todo lo demás. Ya no podrás generar otra versión desde aquí."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptando}
          onConfirm={aceptar}
          onCancel={() => { if (!aceptando) setConfirmarAceptar(false) }}
        />
      )}

      {confirmarAceptarOficial && (
        <ConfirmModal
          title="¿Aceptar esta Planeación Didáctica Inicial (formato oficial de tu escuela)?"
          message="Se guarda con las correcciones que hayas hecho arriba. A partir de aquí queda fija, con la fecha de hoy — ya no podrás editarla, pero sí verla y descargarla (si tu suscripción está pagada) las veces que quieras. Ya no podrás generar otra versión desde aquí."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptandoOficial}
          onConfirm={aceptarOficial}
          onCancel={() => { if (!aceptandoOficial) setConfirmarAceptarOficial(false) }}
        />
      )}

      {confirmarReiniciar && (
        <ConfirmModal
          title="¿Generar una Planeación Inicial nueva?"
          message="Tu Planeación Inicial aceptada se eliminará de forma automática e irreversible — no se puede recuperar después. En su lugar podrás generar y editar una completamente nueva, en cualquiera de los dos formatos."
          confirmLabel="Eliminar y empezar de nuevo"
          confirmingLabel="Eliminando…"
          busy={reiniciando}
          onConfirm={reiniciarPlaneacionInicial}
          onCancel={() => { if (!reiniciando) setConfirmarReiniciar(false) }}
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
