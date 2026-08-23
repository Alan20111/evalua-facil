import { useEffect, useRef, useState } from 'react'
import { collection, query, where, onSnapshot, doc, serverTimestamp } from 'firebase/firestore'
import { addDoc, updateDoc, deleteDoc, writeBatch } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import InfoDisclosure from '../ui/InfoDisclosure'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { Plus, MoreVertical, Pencil, Trash2, Megaphone, Settings, ChevronUp, ChevronDown, X, CheckCircle2, Circle, ArrowLeft, Bookmark, GripVertical, RotateCcw } from 'lucide-react'
import useCreditosIA from '../../hooks/useCreditosIA'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import { PLANTILLAS_SEED, EMOJI_PALETTE, avisoEmoji, formatAvisoFecha, avisosDesde } from '../../utils/avisos'
import { studentFullName } from '../../utils/studentSearch'
import { IS_NATIVE_APP } from '../../utils/platform'

const EMPTY_FORM = { id: null, emoji: '', titulo: '', mensaje: '' }
const EMPTY_PLANTILLA = { id: null, emoji: '✏️', label: '', mensaje: '' }

// Barra de progreso de lectura — pedido explícito: "████████░░ 80% · 24 de
// 30 estudiantes han confirmado la lectura". Barra real con CSS (no
// caracteres de bloque literales — no se ven parejos entre fuentes/tamaños).
function ProgressoLectura({ leidos, total }) {
  const pct = total > 0 ? Math.round((leidos / total) * 100) : 0
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-surface-container overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-semibold text-accent flex-shrink-0">{pct}%</span>
      </div>
      <p className="text-xs text-slate-400 mt-1">
        {total === 0 ? 'Sin estudiantes inscritos aún' : `${leidos} de ${total} estudiantes han confirmado la lectura.`}
      </p>
    </div>
  )
}

export default function AvisosTab({ subjectId, docenteId, canCreate = true, blockedTooltip = 'Activa tu suscripción mensual para publicar avisos', onBlockedCreate }) {
  const toast = useToast()
  const [avisos, setAvisos] = useState([])
  const [avisosLoaded, setAvisosLoaded] = useState(false)
  const [students, setStudents] = useState([])
  const [lecturasByAviso, setLecturasByAviso] = useState({}) // { [avisoId]: { [estudianteId]: Timestamp } }
  const [plantillas, setPlantillas] = useState([])
  const [plantillasLoaded, setPlantillasLoaded] = useState(false)
  const seedingRef = useRef(false)

  const [step, setStep] = useState(null) // null | 'picker' | 'form' | 'plantillas' | 'plantilla-form'
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Piloto de IA (C-03): redactar el aviso con el asistente. SIEMPRE con
  // estimación + confirmación previa; el resultado llena el editor y el
  // docente lo revisa y publica como siempre — la IA nunca publica.
  const creditosIA = useCreditosIA()
  const [iaConfirmando, setIaConfirmando] = useState(false)
  const [iaTrabajando, setIaTrabajando] = useState(false)

  async function redactarConIA() {
    setIaTrabajando(true)
    try {
      const r = await creditosIA.ejecutar('aviso', {
        tipo: form.titulo || 'OTRO',
        // Lo que el docente ya escribió sirve de insumo; si no hay nada, el
        // tipo/título del aviso es el punto de partida.
        datos: form.mensaje.trim() || form.titulo || 'Aviso general para el grupo',
        asignaturaId: subjectId,
      })
      setForm((f) => ({ ...f, mensaje: r.resultado?.mensaje || f.mensaje, titulo: f.titulo || r.resultado?.titulo || '' }))
      setIaConfirmando(false)
      toast(r.repetida ? 'Se recuperó el borrador ya generado (sin costo adicional)' : 'Borrador listo — revísalo y ajústalo antes de publicar')
    } catch (e) {
      setIaConfirmando(false)
      if (e.codigo === 'SALDO_INSUFICIENTE') {
        toast('No tienes suficientes créditos de IA para esta acción')
      } else {
        toast(e.message || 'El asistente de IA no está disponible en este momento')
      }
    } finally {
      setIaTrabajando(false)
    }
  }

  const [plantillaForm, setPlantillaForm] = useState(EMPTY_PLANTILLA)
  const [savingPlantilla, setSavingPlantilla] = useState(false)
  const [deletePlantillaConfirm, setDeletePlantillaConfirm] = useState(null)

  // Reordenar plantillas arrastrando — SOLO en la App (mismo criterio que el
  // Dashboard del docente: en la web las flechas ya funcionan bien con
  // mouse; en la App, antes, no había forma de reordenar sin escritorio).
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragCardRefs = useRef([])
  const dragStateRef = useRef({ dragIndex: null, overIndex: null })

  const [openMenuId, setOpenMenuId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [detailAviso, setDetailAviso] = useState(null)
  // "Todos" o solo los que el docente marcó para encontrar rápido después
  // (ej. el aviso de bienvenida que reutiliza cada ciclo) — pedido explícito:
  // poder guardarlos y ver los guardados aparte.
  const [soloGuardados, setSoloGuardados] = useState(false)

  const modalOpen = step != null || !!deleteConfirm || !!deletePlantillaConfirm || !!detailAviso
  useBackHandler(() => {
    if (deleteConfirm) setDeleteConfirm(null)
    else if (deletePlantillaConfirm) setDeletePlantillaConfirm(null)
    else if (detailAviso) setDetailAviso(null)
    else if (step === 'plantilla-form') setStep('plantillas')
    else setStep(null)
  }, modalOpen)
  useScrollLock(modalOpen)

  // Avisos — en vivo: la barra de progreso de cada tarjeta se actualiza sola
  // conforme los estudiantes confirman, sin que el docente recargue nada.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'avisos'), where('asignaturaId', '==', subjectId)),
      (snap) => {
        setAvisos(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .filter((a) => a.activo !== false)
            // Más reciente primero — orden en memoria porque este proyecto no
            // usa orderBy en Firestore (ver CLAUDE.md).
            .sort((a, b) => (b.fechaCreacion?.seconds ?? 0) - (a.fechaCreacion?.seconds ?? 0))
        )
        setAvisosLoaded(true)
      },
      () => { toast('Error al cargar avisos', 'error'); setAvisosLoaded(true) }
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast estable, no hace falta re-suscribir por él
  }, [subjectId])

  // Roster de la asignatura — el "total de estudiantes inscritos" de la barra.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'students'), where('asignaturaId', '==', subjectId)),
      (snap) => setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [subjectId])

  // Todas las confirmaciones de lectura de la asignatura, en un solo listener
  // (una consulta `==` por `asignaturaId`, no una por aviso) — agrupadas por
  // avisoId en memoria para alimentar cada barra de progreso.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'avisoLecturas'), where('asignaturaId', '==', subjectId)),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => {
          const l = d.data()
          ;(map[l.avisoId] ||= {})[l.estudianteId] = l.fechaHoraLectura
        })
        setLecturasByAviso(map)
      }
    )
    return unsub
  }, [subjectId])

  // Banco de plantillas del docente — su propia colección, no depende de la
  // asignatura (se reutiliza en todas sus materias).
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'avisoPlantillas'), where('docenteId', '==', docenteId)),
      (snap) => {
        setPlantillas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
        setPlantillasLoaded(true)
      },
      () => setPlantillasLoaded(true)
    )
    return unsub
  }, [docenteId])

  // La primera vez que un docente abre "Nuevo aviso" y su banco está vacío,
  // le copiamos los 12 predefinidos como punto de partida editable — pedido
  // explícito: "una forma de optimizar sería editar los que ya están", en vez
  // de arrancar de cero. `seedingRef` evita duplicar la siembra si el
  // snapshot todavía no refleja los docs recién creados.
  async function ensurePlantillasSeed() {
    if (plantillas.length > 0 || seedingRef.current) return
    seedingRef.current = true
    try {
      await Promise.all(PLANTILLAS_SEED.map((p) => addDoc(collection(db, 'avisoPlantillas'), { ...p, docenteId })))
    } catch {
      // Best-effort: si falla, el picker simplemente se queda vacío con el
      // botón de "Nueva plantilla" disponible para armar el banco a mano.
    } finally {
      seedingRef.current = false
    }
  }

  function openAdd() {
    if (!canCreate) { onBlockedCreate?.(); return }
    setForm(EMPTY_FORM)
    setStep('picker')
    if (plantillasLoaded) ensurePlantillasSeed()
  }

  function pickPlantilla(p) {
    setForm({ id: null, emoji: p.emoji, titulo: p.label, mensaje: p.mensaje || '' })
    setStep('form')
  }

  // Publicar es la única acción — ya no se edita un aviso ya enviado (pedido
  // explícito: no tenía sentido, quedaba un registro de lectura sobre un
  // texto que ya no era el que los estudiantes confirmaron). Para corregir
  // algo, se elimina y se publica uno nuevo.
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await addDoc(collection(db, 'avisos'), {
        asignaturaId: subjectId,
        docenteId,
        titulo: form.titulo,
        emoji: form.emoji,
        mensaje: form.mensaje.trim(),
        tipo: 'OTRO',
        activo: true,
        fechaCreacion: serverTimestamp(),
        fechaActualizacion: serverTimestamp(),
      })
      toast('Aviso publicado')
      setStep(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleGuardado(a) {
    try {
      await updateDoc(doc(db, 'avisos', a.id), { guardado: !a.guardado })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'avisos', deleteConfirm.id))
      setDeleteConfirm(null)
      toast('Aviso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  // ── Plantillas (mensajes rápidos personalizables) ──────────────────────
  function openPlantillaForm(p) {
    setPlantillaForm(p ? { id: p.id, emoji: p.emoji, label: p.label, mensaje: p.mensaje || '' } : EMPTY_PLANTILLA)
    setStep('plantilla-form')
  }

  async function savePlantilla(e) {
    e.preventDefault()
    if (!plantillaForm.label.trim()) { toast('Escribe un nombre para la plantilla', 'error'); return }
    setSavingPlantilla(true)
    try {
      if (plantillaForm.id) {
        await updateDoc(doc(db, 'avisoPlantillas', plantillaForm.id), {
          emoji: plantillaForm.emoji, label: plantillaForm.label.trim(), mensaje: plantillaForm.mensaje.trim(),
        })
        toast('Plantilla actualizada')
      } else {
        await addDoc(collection(db, 'avisoPlantillas'), {
          docenteId, emoji: plantillaForm.emoji, label: plantillaForm.label.trim(), mensaje: plantillaForm.mensaje.trim(),
          orden: plantillas.length,
        })
        toast('Plantilla creada')
      }
      setStep('plantillas')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingPlantilla(false)
    }
  }

  async function handleDeletePlantilla() {
    if (!deletePlantillaConfirm) return
    try {
      await deleteDoc(doc(db, 'avisoPlantillas', deletePlantillaConfirm.id))
      setDeletePlantillaConfirm(null)
      toast('Plantilla eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  // Swap de `orden` con el vecino — misma idea que reordenar asignaturas con
  // flechas (ver SubjectPage del docente), sin arrastrar.
  async function movePlantilla(index, delta) {
    const target = index + delta
    if (target < 0 || target >= plantillas.length) return
    const a = plantillas[index], b = plantillas[target]
    try {
      await Promise.all([
        updateDoc(doc(db, 'avisoPlantillas', a.id), { orden: b.orden ?? target }),
        updateDoc(doc(db, 'avisoPlantillas', b.id), { orden: a.orden ?? index }),
      ])
    } catch (err) {
      toast('Error al reordenar: ' + err.message, 'error')
    }
  }

  // Lista mostrada mientras se arrastra: el elemento ya aparece en su
  // posición "de prueba" (overIndex); el commit real (batch con el orden de
  // TODAS, no solo un swap) pasa hasta soltar. Mismo patrón que el Dashboard
  // del docente (reordenar asignaturas arrastrando en la App).
  const displayPlantillas = dragIndex == null ? plantillas : (() => {
    const arr = [...plantillas]
    const [item] = arr.splice(dragIndex, 1)
    arr.splice(overIndex ?? dragIndex, 0, item)
    return arr
  })()

  function dragPointerDown(e, index) {
    e.preventDefault()
    setDragIndex(index)
    setOverIndex(index)
    dragStateRef.current = { dragIndex: index, overIndex: index }
    window.addEventListener('pointermove', dragPointerMove)
    window.addEventListener('pointerup', dragPointerUp)
    window.addEventListener('pointercancel', dragPointerUp)
  }
  function dragPointerMove(e) {
    const y = e.clientY
    let newOver = dragStateRef.current.overIndex
    dragCardRefs.current.forEach((el, i) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) newOver = i
    })
    if (newOver !== dragStateRef.current.overIndex) {
      dragStateRef.current.overIndex = newOver
      setOverIndex(newOver)
    }
  }
  async function dragPointerUp() {
    window.removeEventListener('pointermove', dragPointerMove)
    window.removeEventListener('pointerup', dragPointerUp)
    window.removeEventListener('pointercancel', dragPointerUp)
    const { dragIndex: from, overIndex: to } = dragStateRef.current
    setDragIndex(null)
    setOverIndex(null)
    if (from == null || to == null || from === to) return
    const newList = [...plantillas]
    const [item] = newList.splice(from, 1)
    newList.splice(to, 0, item)
    try {
      const batch = writeBatch(db)
      newList.forEach((p, i) => batch.update(doc(db, 'avisoPlantillas', p.id), { orden: i }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  const totalEstudiantes = students.length

  // A un aviso solo le tocan los estudiantes que ya tenían la asignatura
  // activa cuando se publicó — es el MISMO corte que aplica la app del alumno
  // (avisosDesde en utils/avisos.js), que a los que entraron después ni
  // siquiera se lo muestra. Contarlos aquí como "Pendiente" dejaba barras que
  // nunca podían llegar al 100% y una lista de supuestos morosos a los que
  // jamás se les pidió nada.
  //
  // Recién publicado, `fechaCreacion` todavía viene nulo en el eco local del
  // snapshot (serverTimestamp se resuelve en el servidor). Ese instante cuenta
  // como "acabo de publicarlo": le toca a todo el grupo inscrito, y así la
  // barra no parpadea un "0 de 0" antes de que llegue la fecha del servidor.
  function destinatarios(a) {
    const publicado = a.fechaCreacion?.seconds
    if (publicado == null) return students
    return students.filter((s) => {
      const since = avisosDesde(s)
      return since == null || publicado >= since
    })
  }
  const avisosGuardados = avisos.filter((a) => a.guardado)
  // Guardado se comporta como "mover", no como etiqueta: en cuanto un aviso
  // se guarda, deja de aparecer en "Todos" — pedido explícito.
  const avisosMostrados = soloGuardados ? avisosGuardados : avisos.filter((a) => !a.guardado)

  return (
    <div className="px-4 py-2 space-y-2">
      {totalEstudiantes === 0 ? (
        <p className="text-center text-slate-400 text-sm py-12">Necesitas al menos un estudiante inscrito para poder acceder a este apartado</p>
      ) : (
      <>
      <div className="flex items-start justify-between gap-3">
        {/* La explicación se pliega detrás de "¿Qué es esto?" — mismo patrón
            que Recursos y las otras pantallas: el docente que ya la leyó no
            tiene que volver a pasar por ella cada vez que entra. */}
        <InfoDisclosure className="min-w-0">
          <p className="text-sm text-muted leading-relaxed">
            Comunicados para todo el grupo — sin respuestas ni comentarios, solo para informar.
          </p>
        </InfoDisclosure>
        <button type="button" onClick={openAdd}
          data-tooltip={canCreate ? 'Nuevo aviso' : blockedTooltip}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
          <Plus size={16} /> Nuevo aviso
        </button>
      </div>

      {/* Todos / Guardados — pedido explícito: poder guardar avisos y ver los
          guardados aparte. */}
      <div className="flex gap-1 bg-surface-container p-1 rounded w-fit">
        <button type="button" onClick={() => setSoloGuardados(false)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${!soloGuardados ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
          Todos ({avisos.length - avisosGuardados.length})
        </button>
        <button type="button" onClick={() => setSoloGuardados(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${soloGuardados ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
          <Bookmark size={13} /> Guardados ({avisosGuardados.length})
        </button>
      </div>

      {!avisosLoaded ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : avisosMostrados.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm flex flex-col items-center gap-2">
          <Megaphone size={28} className="text-slate-300" />
          {soloGuardados ? 'No has guardado ningún aviso' : 'Aún no hay avisos en esta asignatura'}
        </div>
      ) : (
        // Caja con scroll propio — pedido explícito: el historial completo
        // no debe empujar el resto de la pestaña hacia abajo. overflow-x-hidden:
        // sin él, Chrome mostraba una barra de desplazamiento horizontal aquí
        // por un desbordamiento fantasma de ~10px (redondeo de line-clamp +
        // flex) que no recorta nada visible — mismo parche ya usado en los
        // modales de Editar/Duplicar/Desarchivar asignatura.
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto overflow-x-hidden pr-1 border border-outline-variant rounded-card p-2 bg-surface">
          {avisosMostrados.map((a) => {
            const leidosMap = lecturasByAviso[a.id] || {}
            const alcance = destinatarios(a)
            const leidos = alcance.filter((s) => leidosMap[s.id]).length
            return (
              <div key={a.id} className="bg-surface-card border border-outline-variant rounded-card shadow-card px-3 py-2.5">
                <div className="flex items-start gap-3">
                  {/* El cuerpo de la tarjeta abre "Ver lecturas" — pedido
                      explícito: clic sobre el aviso o el ítem del menú, las
                      dos rutas llevan al mismo detalle. */}
                  <button type="button" onClick={() => setDetailAviso(a)} className="flex-1 min-w-0 flex items-start gap-3 text-left">
                    <span className="text-xl leading-none flex-shrink-0 mt-0.5" aria-hidden="true">{avisoEmoji(a)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400">{formatAvisoFecha(a.fechaCreacion)}</p>
                      {/* Sin línea de título aparte — el mensaje ya lo dice
                          todo, mostrar los dos era repetir la misma idea dos
                          veces y le hacía perder tiempo al docente. El
                          mensaje es opcional: si el docente lo deja vacío,
                          se cae al título (ej. "No habrá clase" ya se
                          explica solo). */}
                      <p className="text-sm font-medium text-on-surface mt-0.5 whitespace-pre-wrap line-clamp-3">{a.mensaje || a.titulo}</p>
                      <ProgressoLectura leidos={leidos} total={alcance.length} />
                    </div>
                  </button>
                  {/* En "Guardados" el ícono cambia a una flecha de "regresar"
                      — antes era un bote de basura y se confundía con
                      "esto lo elimina" (el borrado real vive aparte, en el
                      menú de los tres puntos). En "Todos" solo llegan avisos
                      sin guardar (ver avisosMostrados), así que el marcador
                      siempre significa "Guardar". */}
                  {soloGuardados ? (
                    <button type="button" onClick={() => toggleGuardado(a)} aria-label="Regresar a Todos" data-tooltip="Regresar a Todos" data-tooltip-pos="bottom"
                      className="p-2 rounded transition-colors flex-shrink-0 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]">
                      <RotateCcw size={18} />
                    </button>
                  ) : (
                    <button type="button" onClick={() => toggleGuardado(a)} aria-label="Guardar" data-tooltip="Guardar" data-tooltip-pos="bottom"
                      className="p-2 rounded transition-colors flex-shrink-0 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]">
                      <Bookmark size={18} />
                    </button>
                  )}
                  <div className="relative flex-shrink-0">
                    <button type="button" onClick={() => setOpenMenuId((id) => (id === a.id ? null : a.id))}
                      aria-label="Más opciones" data-tooltip="Más opciones" data-tooltip-pos="bottom"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === a.id && (
                      <>
                        <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Cerrar menú" onClick={() => setOpenMenuId(null)} />
                        <div className="absolute right-0 top-full mt-1 z-40 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[160px]">
                          <button type="button" onClick={() => { setOpenMenuId(null); setDetailAviso(a) }}
                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-on-surface hover:bg-[var(--accent-tint)]">
                            <CheckCircle2 size={14} /> Ver lecturas
                          </button>
                          <button type="button" onClick={() => { setOpenMenuId(null); setDeleteConfirm(a) }}
                            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                            <Trash2 size={14} /> Eliminar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      </>
      )}

      {/* ── Nuevo / editar aviso ── */}
      {step && (step === 'picker' || step === 'form') && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStep(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            {step === 'picker' ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">¿Qué deseas comunicar?</h3>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setStep('plantillas')}
                      data-tooltip="Editar tus plantillas"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                      <Settings size={18} />
                    </button>
                    <button type="button" onClick={() => setStep(null)} aria-label="Cerrar" data-tooltip="Cerrar"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                </div>
                {!plantillasLoaded ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : plantillas.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted">
                    <p className="mb-3">Aún no tienes plantillas.</p>
                    <button type="button" onClick={() => openPlantillaForm(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                      <Plus size={16} /> Crear tu primera plantilla
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {plantillas.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickPlantilla(p)}
                        className="flex flex-col items-center gap-1.5 p-4 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-center">
                        <span className="text-2xl" aria-hidden="true">{p.emoji}</span>
                        <span className="text-sm font-medium text-on-surface">{p.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={handleSave}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl flex-shrink-0" aria-hidden="true">{form.emoji}</span>
                  <h3 className="text-lg font-semibold flex-1">{form.titulo || 'Nuevo aviso'}</h3>
                  <button type="button" onClick={() => setStep(null)} aria-label="Cerrar" data-tooltip="Cerrar"
                    className="p-2 -mr-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                    <X size={18} />
                  </button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="aviso-mensaje" className="block text-sm font-medium text-on-surface">Mensaje <span className="font-normal text-muted">(opcional)</span></label>
                  </div>
                  <textarea id="aviso-mensaje" value={form.mensaje} onChange={(e) => setForm((f) => ({ ...f, mensaje: e.target.value }))}
                    rows={5} placeholder="Deja este campo vacío si el título ya lo dice todo"
                    className="w-full px-3 py-2 border border-outline-variant rounded-card bg-surface text-sm resize-none" />
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setStep(null)}
                    className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={saving}
                    className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
                    {saving ? 'Guardando…' : 'Publicar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Confirmación de créditos IA (estimación previa, nunca descuenta) ── */}
      {iaConfirmando && (
        <ConfirmacionCreditosModal
          titulo="Redactar el aviso con IA"
          descripcion="El asistente redactará un borrador con lo que ya escribiste; tú lo revisas y publicas."
          costoMin={creditosIA.estimar('aviso') ?? 1}
          ejecutando={iaTrabajando}
          onCancelar={() => { if (!iaTrabajando) setIaConfirmando(false) }}
          onContinuar={redactarConIA}
        />
      )}

      {/* ── Gestionar plantillas ── */}
      {(step === 'plantillas' || step === 'plantilla-form') && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStep(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            {step === 'plantillas' ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <button type="button" onClick={() => setStep('picker')} aria-label="Regresar" className="p-2 -ml-1 text-muted hover:text-accent rounded">
                    <ArrowLeft size={18} />
                  </button>
                  <h3 className="text-lg font-semibold flex-1">Tus plantillas</h3>
                  <button type="button" onClick={() => openPlantillaForm(null)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-accent text-white text-xs font-medium rounded hover:bg-accent-hover transition-colors">
                    <Plus size={14} /> Nueva
                  </button>
                  <button type="button" onClick={() => setStep(null)} aria-label="Cerrar" data-tooltip="Cerrar"
                    className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                    <X size={18} />
                  </button>
                </div>
                <p className="text-xs text-muted mb-3">
                  Edítalas, cámbiales el ícono, {IS_NATIVE_APP ? 'mantén y arrastra para reordenar' : 'reordénalas'} o crea las tuyas — son tuyas, se usan en todas tus asignaturas.
                </p>
                <div className="space-y-1.5">
                  {displayPlantillas.map((p, i) => (
                    <div key={p.id}
                      ref={(el) => { dragCardRefs.current[i] = el }}
                      className={`flex items-center gap-2 bg-surface-container rounded-card px-2 py-1.5 transition-opacity ${dragIndex === i ? 'opacity-60 shadow-lg' : ''}`}>
                      {/* Reordenar: flechas en la web, arrastrar en la App —
                          mismo criterio que la lista de asignaturas del
                          Dashboard del docente. */}
                      {IS_NATIVE_APP ? (
                        <button type="button" onPointerDown={(e) => dragPointerDown(e, i)} aria-label="Arrastrar para reordenar"
                          data-tooltip="Mantén y arrastra para reordenar"
                          className="p-2 -m-0.5 text-slate-400 hover:text-accent flex-shrink-0 cursor-grab active:cursor-grabbing touch-none">
                          <GripVertical size={16} />
                        </button>
                      ) : (
                        <div className="flex flex-col flex-shrink-0">
                          <button type="button" onClick={() => movePlantilla(i, -1)} disabled={i === 0} aria-label="Subir"
                            className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-40 disabled:hover:text-slate-400">
                            <ChevronUp size={14} />
                          </button>
                          <button type="button" onClick={() => movePlantilla(i, 1)} disabled={i === plantillas.length - 1} aria-label="Bajar"
                            className="p-0.5 text-slate-400 hover:text-accent disabled:opacity-40 disabled:hover:text-slate-400">
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      )}
                      <span className="text-xl flex-shrink-0" aria-hidden="true">{p.emoji}</span>
                      <span className="flex-1 min-w-0 text-sm text-on-surface truncate">{p.label}</span>
                      <button type="button" onClick={() => openPlantillaForm(p)} aria-label="Editar" data-tooltip="Editar"
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => setDeletePlantillaConfirm(p)} aria-label="Eliminar" data-tooltip="Eliminar"
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {plantillas.length === 0 && (
                    <p className="text-center text-sm text-muted py-6">Aún no tienes plantillas.</p>
                  )}
                </div>
              </>
            ) : (
              <form onSubmit={savePlantilla}>
                <div className="flex items-center gap-2 mb-4">
                  <button type="button" onClick={() => setStep('plantillas')} aria-label="Regresar" className="p-2 -ml-1 text-muted hover:text-accent rounded">
                    <ArrowLeft size={18} />
                  </button>
                  <h3 className="text-lg font-semibold flex-1">{plantillaForm.id ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
                  <button type="button" onClick={() => setStep(null)} aria-label="Cerrar" data-tooltip="Cerrar"
                    className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors">
                    <X size={18} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="block text-sm font-medium text-on-surface mb-1">Ícono</span>
                    <div className="grid grid-cols-8 gap-1.5">
                      {EMOJI_PALETTE.map((em) => (
                        <button key={em} type="button" onClick={() => setPlantillaForm((f) => ({ ...f, emoji: em }))}
                          aria-label={`Ícono ${em}`}
                          className={`aspect-square rounded flex items-center justify-center text-lg transition-colors ${
                            plantillaForm.emoji === em ? 'bg-accent text-white' : 'bg-surface-container hover:bg-[var(--accent-tint)]'
                          }`}>
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="plantilla-label" className="block text-sm font-medium text-on-surface mb-1">Nombre</label>
                    <input id="plantilla-label" type="text" value={plantillaForm.label} onChange={(e) => setPlantillaForm((f) => ({ ...f, label: e.target.value }))}
                      placeholder="Ej. No habrá clase" className="w-full px-3 py-2 border border-outline-variant rounded-card bg-surface text-sm" />
                  </div>
                  <div>
                    <label htmlFor="plantilla-mensaje" className="block text-sm font-medium text-on-surface mb-1">Mensaje sugerido (opcional)</label>
                    <textarea id="plantilla-mensaje" value={plantillaForm.mensaje} onChange={(e) => setPlantillaForm((f) => ({ ...f, mensaje: e.target.value }))}
                      rows={3} placeholder="Se precarga al elegir esta plantilla — puedes ajustarlo cada vez"
                      className="w-full px-3 py-2 border border-outline-variant rounded-card bg-surface text-sm resize-none" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setStep('plantillas')}
                    className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={savingPlantilla}
                    className="px-4 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60">
                    {savingPlantilla ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Ver lecturas ── */}
      {detailAviso && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDetailAviso(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span aria-hidden="true">{avisoEmoji(detailAviso)}</span> Lecturas
              </h3>
              <button type="button" onClick={() => setDetailAviso(null)} aria-label="Cerrar" className="p-2 text-muted hover:text-accent rounded">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-on-surface mb-3 line-clamp-2">{detailAviso.mensaje || detailAviso.titulo}</p>
            {/* Solo los destinatarios reales del aviso: quien se activó
                después nunca lo vio, listarlo como "Pendiente" era acusarlo
                de algo que la app no le pidió. */}
            <ProgressoLectura
              leidos={destinatarios(detailAviso).filter((s) => (lecturasByAviso[detailAviso.id] || {})[s.id]).length}
              total={destinatarios(detailAviso).length}
            />
            <div className="mt-3 space-y-1">
              {destinatarios(detailAviso)
                .slice()
                .sort((a, b) => studentFullName(a).localeCompare(studentFullName(b), 'es'))
                .map((s) => {
                  const leidoAt = (lecturasByAviso[detailAviso.id] || {})[s.id]
                  return (
                    <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-outline-variant last:border-0">
                      <span className="flex-1 min-w-0 text-sm text-on-surface truncate">{studentFullName(s)}</span>
                      {leidoAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium flex-shrink-0">
                          <CheckCircle2 size={13} /> Leído · {formatAvisoFecha(leidoAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium flex-shrink-0">
                          <Circle size={11} /> Pendiente
                        </span>
                      )}
                    </div>
                  )
                })}
              {destinatarios(detailAviso).length === 0 && (
                <p className="text-center text-sm text-muted py-6">
                  {students.length === 0
                    ? 'Sin estudiantes inscritos aún.'
                    : 'Ningún estudiante estaba activo en la asignatura cuando se publicó este aviso.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmación de borrado de aviso ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">¿Deseas eliminar este aviso?</h3>
            <p className="text-sm text-muted mb-4">Se eliminará permanentemente, junto con el avance de lectura registrado.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors disabled:opacity-60">
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmación de borrado de plantilla ── */}
      {deletePlantillaConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeletePlantillaConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">¿Eliminar esta plantilla?</h3>
            <p className="text-sm text-muted mb-4">&ldquo;<strong>{deletePlantillaConfirm.label}</strong>&rdquo; ya no aparecerá al crear un aviso nuevo. Los avisos ya publicados con ella no cambian.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeletePlantillaConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDeletePlantilla}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
