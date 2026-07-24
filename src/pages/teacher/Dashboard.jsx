import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { Plus, BookOpen, ChevronRight, X, ArrowUp, ArrowDown, GripVertical } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPeriodLabel } from '../../utils/dateRange'
import PaletteSelect from '../../components/PaletteSelect'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import { useSubscription } from '../../hooks/useSubscription'
import { canCreateContent } from '../../utils/subscriptionHelpers'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { IS_NATIVE_APP } from '../../utils/platform'
import { TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { teacherDisplayName } from '../../utils/studentSearch'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const location = useLocation()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  // Whether the trial (or subscription) is expired — only gates NEW creation;
  // everything already in the account stays fully visible/exportable.
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)

  // Subject creation modal
  const [showSubjectModal, setShowSubjectModal] = useState(location.state?.openCreate === true)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectGrupo, setNewSubjectGrupo] = useState('')
  const [newSubjectParciales, setNewSubjectParciales] = useState(3)
  const [newSubjectPalette, setNewSubjectPalette] = useState('default')
  const [newSubjectIcon, setNewSubjectIcon] = useState('book')
  const [newSubjectFechaInicio, setNewSubjectFechaInicio] = useState('')
  const [newSubjectFechaFin, setNewSubjectFechaFin] = useState('')
  const [creatingSubject, setCreatingSubject] = useState(false)

  const navigate = useNavigate()
  const toast = useToast()

  // Dashboard es raíz (sin flecha "Volver") — el botón físico atrás solo debe
  // cerrar el modal "Nueva asignatura" cuando está abierto; si no hay nada
  // abierto, cae al comportamiento default (doble tap para salir).
  useBackHandler(() => setShowSubjectModal(false), showSubjectModal)
  useScrollLock(showSubjectModal)

  // Datos en vivo — mismo mecanismo (onSnapshot) que usa el sidebar en
  // Layout.jsx, en vez de una carga única propia: antes ambos podían
  // mostrar un orden distinto hasta que se recargaba la página (archivar
  // desde SubjectPage, por ejemplo, actualizaba el sidebar al instante pero
  // el Dashboard se quedaba con la lista vieja hasta el siguiente montaje).
  useEffect(() => {
    if (!currentUser) return
    // Sin setLoading(true) aquí — arranca en true por el useState de arriba
    // (mismo patrón que el sidebar en Layout.jsx); llamarlo de forma
    // síncrona dentro del efecto dispara react-hooks/set-state-in-effect.
    const q = query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
    const unsub = onSnapshot(
      q,
      (snap) => {
        let subList = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Subjects predate manual ordering — the first time we see one without an
        // `orden`, assign one from its current alphabetical position and persist it,
        // so the list has a stable order the teacher can then rearrange by hand.
        if (subList.some((s) => s.orden == null)) {
          subList = subList.sort((a, b) => {
            const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
            if (nc !== 0) return nc
            return (a.grupo || '').localeCompare(b.grupo || '', 'es')
          })
          const batch = writeBatch(db)
          subList = subList.map((s, i) => {
            const orden = i + 1
            if (s.orden !== orden) batch.update(doc(db, 'subjects', s.id), { orden })
            return { ...s, orden }
          })
          batch.commit().catch(() => {}) // best-effort; the in-memory order is already correct
        } else {
          subList = subList.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        }
        setSubjects(subList)
        setLoading(false)
      },
      (err) => { toast('Error al cargar: ' + err.message, 'error'); setLoading(false) }
    )
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  // Open the "Nueva asignatura" modal when navigated here with openCreate — including
  // when ALREADY on /dashboard (sidebar button), where the useState initializer above
  // does not re-run. location.key changes on every navigation, so this fires each time.
  useEffect(() => {
    if (location.state?.openCreate) {
      openSubjectModal()
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  function openSubjectModal() {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setShowSubjectModal(true)
  }

  // moveSubject/dragPointerUp SÍ hacen su propio setSubjects optimista (para
  // que no haya un parpadeo visible antes de que llegue la confirmación),
  // pero ya no llaman a un loadAll() de respaldo si el commit falla: el
  // listener onSnapshot de arriba es ahora la única fuente de verdad y se
  // vuelve a disparar solo con el estado real en cuanto Firestore resuelve
  // la escritura (exitosa o no).
  async function moveSubject(index, direction) {
    const newList = [...subjects]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newList.length) return
    ;[newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]]
    setSubjects(newList.map((s, i) => ({ ...s, orden: i + 1 })))
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'subjects', s.id), { orden: i + 1 }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  // Reordenar arrastrando — SOLO en la App (pedido explícito: en la web ya
  // están las flechas subir/bajar, que ahí funcionan bien con mouse; en la
  // App no había NINGUNA forma de reordenar, las flechas quedaban ocultas).
  // Reusa el mismo commit por lotes que moveSubject, solo cambia cómo se
  // arma la lista nueva (mover un elemento a cualquier posición, no solo
  // intercambiar con el vecino).
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragCardRefs = useRef([])
  const dragStateRef = useRef({ dragIndex: null, overIndex: null })

  // Lista mostrada mientras se arrastra: el elemento arrastrado ya aparece
  // en su posición "de prueba" (overIndex), aunque todavía no se guardó
  // nada — el commit real solo pasa al soltar.
  const displaySubjects = dragIndex == null ? subjects : (() => {
    const arr = [...subjects]
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
    const newList = [...subjects]
    const [item] = newList.splice(from, 1)
    newList.splice(to, 0, item)
    setSubjects(newList.map((s, i) => ({ ...s, orden: i + 1 })))
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'subjects', s.id), { orden: i + 1 }))
      await batch.commit()
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault()
    if (!newSubjectName.trim() || !newSubjectGrupo.trim()) return
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCreatingSubject(true)
    try {
      const subData = {
        nombre: newSubjectName.trim(),
        grupo: newSubjectGrupo.trim(),
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId || 'sin-escuela',
        parciales: newSubjectParciales,
        // Al crearla ningún parcial tiene contenido todavía — el primero
        // queda visible para el estudiante desde el inicio, los demás
        // ocultos por defecto (pedido explícito) hasta que el docente
        // decida mostrarlos con el ojo del encabezado del parcial.
        parcialesOcultos: Array.from({ length: Math.max(0, newSubjectParciales - 1) }, (_, i) => i + 2),
        fechaInicio: newSubjectFechaInicio || '',
        fechaFin: newSubjectFechaFin || '',
        colorPalette: newSubjectPalette,
        icon: newSubjectIcon,
        accessCode: generateAccessCode(),
        archived: false,
        orden: subjects.length + 1,
        createdAt: serverTimestamp(),
      }
      // Sin append optimista aquí: el onSnapshot de arriba (única fuente de
      // verdad, mismo criterio que moveSubject/dragPointerUp) ya recibe esta
      // asignatura nueva por su cuenta — casi siempre ANTES de que este
      // await se resuelva, porque Firestore refleja la escritura local de
      // inmediato. Un append manual sobre `prev` corría el riesgo real de
      // sumarla otra vez sobre un estado que el snapshot ya había
      // actualizado, duplicando la key en el sidebar (bug real observado:
      // "Encountered two children with the same key").
      const ref = await addDoc(collection(db, 'subjects'), subData)
      setShowSubjectModal(false)
      setNewSubjectName('')
      setNewSubjectGrupo('')
      setNewSubjectParciales(3)
      setNewSubjectPalette('default')
      setNewSubjectIcon('book')
      setNewSubjectFechaInicio('')
      setNewSubjectFechaFin('')
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCreatingSubject(false)
    }
  }

  const teacherGreetingName = teacherDisplayName(userProfile) || 'Docente'

  return (
    <>
      <div className={`px-4 sm:px-5 lg:px-6 py-4 ${TEACHER_CONTAINER_NARROW}`}>

        {/* Greeting — dos renglones, cada uno truncate (nunca se parte en dos
            líneas): "Bienvenido" y, debajo, "{prefijo} {nombre visible}" — el
            mismo prefijo + Nombre visible de Perfil que ven los alumnos
            (teacherDisplayName, misma fuente de verdad que en las pantallas
            de alumno). */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-on-surface truncate">Bienvenido</h1>
          <p className="text-lg font-bold text-on-surface truncate">{teacherGreetingName}</p>
          {userProfile?.schoolName && (
            <p className="text-slate-400 text-xs mt-0.5 truncate">{userProfile.schoolName}</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* ── Mis asignaturas ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
              <h2 className="text-lg font-semibold text-on-surface">Mis asignaturas</h2>
              <span className="text-sm text-slate-500">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''}</span>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-surface-card rounded-card border border-outline-variant p-8 text-center mb-4">
                <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
                  <BookOpen size={28} className="text-accent" />
                </div>
                <p className="text-muted font-medium mb-2">Aún no tienes asignaturas</p>
                <button
                  type="button"
                  onClick={openSubjectModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded transition-colors"
                >
                  <Plus size={18} />
                  Crear mi primera asignatura
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {displaySubjects.map((s, i) => (
                  <div
                    key={s.id}
                    ref={(el) => { dragCardRefs.current[i] = el }}
                    {...subjectPaletteProps(s.colorPalette)}
                    className={`w-full bg-surface-card rounded-card p-1.5 shadow-card hover:shadow-md hover:bg-[var(--accent-tint)] transition-all duration-200 flex items-center gap-1 ${dragIndex === i ? 'opacity-60 shadow-lg' : ''}`}
                  >
                    {/* Reordenar: flechas en la web, arrastrar en la App
                        (pedido explícito — antes no había forma de
                        reordenar desde el celular). */}
                    {IS_NATIVE_APP ? (
                      <button
                        type="button"
                        onPointerDown={(e) => dragPointerDown(e, i)}
                        aria-label="Arrastrar para reordenar"
                        data-tooltip="Mantén y arrastra para reordenar"
                        className="p-2 -m-1 text-slate-400 hover:text-accent flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                      >
                        <GripVertical size={18} />
                      </button>
                    ) : (
                      <div className="flex flex-col flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => moveSubject(i, -1)}
                          disabled={i === 0}
                          data-tooltip="Subir"
                          aria-label="Subir"
                          className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSubject(i, 1)}
                          disabled={i === subjects.length - 1}
                          data-tooltip="Bajar"
                          aria-label="Bajar"
                          className="p-1 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/subject/${s.id}`)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2"
                    >
                      <div className="w-11 h-11 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                        <SubjectIcon iconKey={s.icon} size={21} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
                          {s.archived && (
                            <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              archivada
                            </span>
                          )}
                        </div>
                        {subjectPeriodLabel(s) && (
                          <p className="text-sm text-slate-500 mt-0.5">{subjectPeriodLabel(s)}</p>
                        )}
                      </div>
                      <ChevronRight size={20} className="text-slate-300 flex-shrink-0" />
                    </button>
                  </div>
                ))}
              </div>
            )}

          </>
        )}
      </div>

      {/* FAB — create subject (mobile only; on web use the sidebar's "Nueva asignatura") */}
      <button
        type="button"
        onClick={openSubjectModal}
        aria-label="Nueva asignatura"
        className="md:hidden fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 w-14 h-14 bg-accent hover:bg-accent-hover text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
      >
        <Plus size={26} />
      </button>

      {/* ── Nueva asignatura modal ── */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowSubjectModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[92vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-on-surface">Nueva asignatura</h3>
              <button type="button" onClick={() => setShowSubjectModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 hover:text-muted rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateSubject} className="space-y-2">
              {/* Nombre de la asignatura */}
              <div>
                <label htmlFor="dash-asignatura" className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input
                  id="dash-asignatura"
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas, Física, Historia"
                />
              </div>
              {/* Grupo */}
              <div>
                <label htmlFor="dash-grupo" className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input
                  id="dash-grupo"
                  type="text"
                  value={newSubjectGrupo}
                  onChange={(e) => setNewSubjectGrupo(e.target.value)}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C"
                />
              </div>

              {/* Fechas (opcionales) */}
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-slate-400 font-normal text-xs">(opcional)</span>
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={newSubjectFechaInicio} onChange={setNewSubjectFechaInicio} />
                  </div>
                  <div className="flex-1">
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={newSubjectFechaFin} onChange={setNewSubjectFechaFin} />
                  </div>
                </div>
              </div>

              {/* Parciales */}
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Calificaciones parciales <span className="text-slate-400 font-normal text-xs">(por defecto 3)</span>
                </p>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewSubjectParciales(n)}
                      className={`py-2 rounded text-sm font-bold transition-colors ${
                        newSubjectParciales === n
                          ? 'bg-accent text-white'
                          : 'bg-surface-container text-muted hover:bg-[var(--accent-tint)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Paleta de color */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">
                  Color de la asignatura <span className="text-slate-400 font-normal text-xs">(elige el color base que identificará a la asignatura)</span>
                </p>
                <PaletteSelect value={newSubjectPalette} onChange={setNewSubjectPalette} />
              </div>

              {/* Icono */}
              <div {...subjectPaletteProps(newSubjectPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">
                  Icono de la asignatura
                </p>
                <IconSelect value={newSubjectIcon} onChange={setNewSubjectIcon} />
              </div>

              <button
                type="submit"
                disabled={creatingSubject}
                className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creatingSubject ? <Spinner size="sm" /> : <Plus size={18} />}
                {creatingSubject ? 'Creando…' : 'Crear asignatura'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
