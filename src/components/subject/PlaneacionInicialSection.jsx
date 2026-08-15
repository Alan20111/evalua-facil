// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
// Genera una PROPUESTA en Excel para los parciales reales de la asignatura;
// el docente la revisa, puede regenerarla y descargarla — nunca se aplica
// sola a ningún otro módulo de Evalúa Fácil.
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { addDoc, updateDoc } from '../../utils/firestoreGuard'
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
import { useSubscription } from '../../hooks/useSubscription'
import CheckoutModal from '../CheckoutModal'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp, ThumbsUp, Eye, Lock, FileCheck2 } from 'lucide-react'

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

// Resumen de insumos a incluir — de solo lectura salvo el Perfil IA (que no
// tiene tarjeta propia en esta pestaña, vive en /perfil-ia). Los otros
// cuatro se marcan cada uno en SU PROPIA tarjeta arriba (Comentarios,
// Autoanálisis, Diagnóstico de contexto, Diagnóstico de conocimientos) —
// decisión de Kike, 14-ago-2026: no duplicar el control aquí, solo mostrar
// lo que ya se marcó ahí para que el docente confirme antes de generar.
function InsumosOpcionales({
  disabled, hayContexto, hayConocimientos,
  incluirPerfil, setIncluirPerfil,
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
        Solo el programa de estudios (Fuentes) es obligatorio. Los demás se marcan arriba, en la tarjeta de
        cada uno — entre más insumos incluyas y tengas listos, mejor planeación obtendrás.
      </p>
      <label className="flex items-center gap-2 py-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={incluirPerfil}
          disabled={disabled}
          onChange={(e) => setIncluirPerfil(e.target.checked)}
        />
        <span className="text-sm text-on-surface">Perfil IA del docente</span>
      </label>
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

// Vista previa en pantalla — apilada por tarjetas, un parcial a la vez.
// Existe para que un docente en trial (nunca pagó, ver exportGuard.js) SÍ
// pueda ver el contenido real de su Planeación aunque no pueda descargarla:
// la publicidad promete "Planeación didáctica" en trial, así que negarle
// también la vista dejaría esa promesa vacía (pedido explícito de Kike,
// 13-ago-2026).
//
// EDITABLE mientras no esté aceptada (pedido de Kike, 14-ago-2026): la
// Planeación es la columna vertebral de las actividades que la IA propone
// después, así que lo que quede como "aceptada" debe ser exactamente lo que
// el docente revisó y corrigió aquí mismo — no un Excel editado por fuera
// que Evalúa Fácil nunca ve. Con `onChange` se edita en el propio navegador
// (sin re-parsear ningún archivo); sin él, se muestra de solo lectura (caso
// de la versión ya aceptada, o del historial de generaciones anteriores).
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
    <div className="space-y-3">
      {resultado.parciales.map((parcial) => (
        <div key={parcial.numero} className="border border-outline-variant rounded p-2">
          <p className="text-sm font-semibold text-on-surface mb-1.5">
            Parcial {parcial.numero}{parcial.periodo ? ` — ${parcial.periodo}` : ''}
          </p>
          {!parcial.filas?.length ? (
            <p className="text-xs text-muted">La IA no generó una propuesta para este parcial con las fuentes disponibles.</p>
          ) : (
            <div className="space-y-2">
              {parcial.filas.map((fila, i) => (
                <div key={i} className="bg-surface rounded border border-outline-variant p-2 space-y-1.5">
                  {CAMPOS_VISTA_PREVIA.map(([campo, etiqueta]) => (
                    editable ? (
                      <div key={campo}>
                        <label className="block text-xs font-medium text-muted mb-0.5">{etiqueta}</label>
                        <textarea
                          className="w-full px-2 py-1 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-xs bg-surface-card resize-y"
                          rows={campo === 'fechaEstimada' ? 1 : 2}
                          value={fila[campo] || ''}
                          onChange={(e) => actualizarCampo(parcial.numero, i, campo, e.target.value)}
                          maxLength={400}
                        />
                      </div>
                    ) : (
                      fila[campo] ? (
                        <p key={campo} className="text-xs">
                          <span className="font-medium text-muted">{etiqueta}: </span>
                          <span className="text-on-surface">{fila[campo]}</span>
                        </p>
                      ) : null
                    )
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function PlaneacionInicialSection({ subjectId, docenteId, subject, asignaturaNombre, hayFuentesGenerales, watermark = false }) {
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
  // Copia editable del resultado mientras no está aceptada — lo que el
  // docente corrija aquí es lo que se guarda al aceptar (ver `aceptar()`),
  // no el `resultado` original de la IA. Se reinicia cada vez que cambia
  // `actual.id` (nueva generación o recarga de la página).
  const [edicion, setEdicion] = useState(null)
  const [edicionDeId, setEdicionDeId] = useState(null)
  const [plantillaOficial, setPlantillaOficial] = useState(null)
  const [generandoOficial, setGenerandoOficial] = useState(false)
  const [confirmandoOficial, setConfirmandoOficial] = useState(false)
  // Único requisito indispensable: fuentes generales (programa de estudios).
  // Todo lo demás lo palomea el docente antes de generar. El Perfil IA no
  // tiene tarjeta propia en esta pestaña (vive en /perfil-ia), así que su
  // casilla se queda aquí; los otros cuatro se marcan cada uno en SU PROPIA
  // tarjeta (Comentarios, Autoanálisis, Diagnóstico de contexto/
  // conocimientos) y se leen de config.incluirEnPlaneacion — decisión de
  // Kike, 14-ago-2026: no duplicar el control en un modal aparte.
  const [incluirPerfil, setIncluirPerfil] = useState(true)
  const [incluirEnPlaneacion, setIncluirEnPlaneacion] = useState({})
  const incluirComentarios = incluirEnPlaneacion.comentarios !== false
  const incluirAutoanalisis = incluirEnPlaneacion.autoanalisis !== false
  const incluirConsideraciones = incluirEnPlaneacion.consideraciones !== false
  const incluirDiagContexto = incluirEnPlaneacion.diagContexto !== false
  const incluirDiagConocimientos = incluirEnPlaneacion.diagConocimientos !== false
  const incluirInsumos = {
    perfil: incluirPerfil,
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

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // nueva (o al recargar la página) — nunca pisa ediciones en curso del
  // mismo `actual.id` (por eso compara contra `edicionDeId`, no re-copia en
  // cada render). Ajuste de estado durante el render, NO en un efecto —
  // patrón oficial de React para "resetear estado cuando cambia una prop"
  // (evita el aviso de cascading renders de un setState dentro de un
  // useEffect).
  const actualIdParaEdicion = historial[0]?.id || null
  if (actualIdParaEdicion !== edicionDeId) {
    setEdicion(actualIdParaEdicion ? historial[0].resultado : null)
    setEdicionDeId(actualIdParaEdicion)
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
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, formato, incluir: incluirInsumos,
      })
      setConfirmando(false)
      if (data?.resultado) {
        await addDoc(collection(db, 'subjects', subjectId, 'planeacionesIA'), {
          resultado: data.resultado,
          docenteId,
          formato,
          generadoEn: serverTimestamp(),
        })
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional)' : 'Planeación generada — revísala y acéptala cuando estés conforme')
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
  async function aceptar() {
    setAceptando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: { planeacionId: actual.id, aceptadaEn: serverTimestamp(), resultado: edicion || actual.resultado },
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
  // están vacías y deben llenarse — el docente no marca nada.
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

      const data = await creditosIA.ejecutar('planeacion_formato_oficial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, incluir: incluirInsumos,
        celdas: celdas.map((c) => ({ f: c.fila, c: c.columna, t: c.tablaIndex, x: c.texto })),
      })
      setConfirmandoOficial(false)
      const celdasLlenar = data?.resultado?.celdas
      if (!celdasLlenar?.length) {
        toast('El asistente de IA no encontró casillas que llenar en tu plantilla', 'error')
        return
      }

      const celdasParaEscribir = celdasLlenar.map((c) => ({ fila: c.f, columna: c.c, tablaIndex: c.t, texto: c.x }))
      const blob = plantillaOficial.tipo === 'docx'
        ? await llenarPlantillaWord(bufferOriginal, celdasParaEscribir)
        : await llenarPlantillaExcel(bufferOriginal, celdasParaEscribir)
      const nombreSalida = plantillaOficial.nombre.replace(/\.(docx?|xlsx?)$/i, '') +
        ' (llenada por IA)' + (plantillaOficial.tipo === 'docx' ? '.docx' : '.xlsx')

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreSalida
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast(
        (data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional). ' : 'Planeación generada en el formato de tu escuela. ') +
        'Es una propuesta de IA — revísala antes de usarla, puede contener errores.',
        'info'
      )
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

  if (!diagLoaded || !histLoaded) {
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
        La IA genera tu Planeación Didáctica Inicial en dos formatos, cada uno por separado: un Excel
        genérico (una hoja por parcial, para que copies lo que te sirva) y, si subiste arriba el formato
        oficial de tu escuela, ese mismo llenado por la IA. Ambos son generados por IA — revísalos siempre.
      </p>

      {!habilitado && (
        <ul className="space-y-1 mb-1">
          <RequisitoItem ok={hayFuentesGenerales} texto="Fuentes para todo el curso (programa de estudios)" />
        </ul>
      )}

      {habilitado && (
        <>
          {!actual ? (
            <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generada</span></p>
          ) : aceptada ? (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Aceptada — la usa la IA para todo lo demás</span>
              {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
              {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              . Revísala y corrígela abajo, campo por campo, antes de aceptarla — no se puede descargar hasta que
              la aceptes. Si prefieres que la IA la vuelva a intentar, edita los Comentarios generales del grupo
              (arriba) y genera de nuevo.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!aceptada && (
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
            {actual && !aceptada && (
              <button
                type="button"
                onClick={() => setConfirmarAceptar(true)}
                disabled={aceptando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50 disabled:opacity-60"
              >
                {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                Aceptar planeación
              </button>
            )}
            {plantillaOficial && (
              <button
                type="button"
                onClick={() => (nuncaAprobado ? setShowPaymentModal(true) : setConfirmandoOficial(true))}
                disabled={generandoOficial}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {generandoOficial ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : <FileCheck2 size={14} />}
                Generar en el formato de mi escuela (con IA)
              </button>
            )}
          </div>

          {plantillaOficial && (
            <p className="text-xs text-amber-700 mt-1.5">
              El archivo que se descarga en el formato de tu escuela es una propuesta de IA — revísalo antes de
              usarlo, puede contener errores.
            </p>
          )}

          {/* Sin aceptar: la vista editable va SIEMPRE visible, no detrás de
              un "Ver planeación" — es el paso obligatorio de revisión antes
              de poder aceptar y descargar (pedido de Kike, 14-ago-2026). */}
          {actual && !aceptada && (
            <div className="mt-3 pt-2 border-t border-outline-variant">
              <p className="text-xs font-medium text-on-surface mb-2">
                Revisa y corrige lo que necesites en cada campo antes de aceptar:
              </p>
              <VistaPreviaPlaneacion resultado={edicion || actual.resultado} onChange={setEdicion} />
            </div>
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
            incluirPerfil={incluirPerfil} setIncluirPerfil={setIncluirPerfil}
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
            incluirPerfil={incluirPerfil} setIncluirPerfil={setIncluirPerfil}
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

      <CheckoutModal
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        subscription={subscription}
        onSuccess={refreshSubscription}
      />
    </div>
  )
}
