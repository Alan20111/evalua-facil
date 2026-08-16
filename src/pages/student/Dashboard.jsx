import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  getDoc,
  doc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import {
  BookOpen, ChevronRight, ChevronDown, Plus, X, Hash, Archive, Trash2, Download,
  ArrowUp, ArrowDown, GripVertical, Globe, Smartphone,
} from 'lucide-react'
import SubjectIcon from '../../components/SubjectIcon'
import { isActivityPublished, cuentaParaCalificacion } from '../../utils/activityVisibility'
import { subjectDisplayName } from '../../utils/subjectName'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import { getEnrollments, updateAllEnrollments, visibleEnrollments } from '../../utils/studentLookup'
import { uploadToCloudinary } from '../../utils/cloudinary'
import StudentLayout from '../../components/StudentLayout'
import AvatarCropModal from '../../components/AvatarCropModal'
import { promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../../utils/ponderacion'
import { STUDENT_CONTAINER } from '../../config/layout'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import { teacherDisplayName } from '../../utils/studentSearch'
import { capitalizarNombre } from '../../utils/nombres'
import { IS_NATIVE_APP } from '../../utils/platform'
import { APP_DOWNLOAD_URL, APP_DOWNLOAD_READY } from '../../config/appDownload'

// All activities for a set of subjects in as few round trips as possible.
// Firestore `in` takes up to 30 values, so chunk and run chunks in parallel.
async function fetchActivitiesForSubjects(subjectIds) {
  if (subjectIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'activities'), where('asignaturaId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

// All submissions belonging to a set of student enrollment docs — one `==` query
// per enrollment, in parallel. NO `in` chunks here: the submissions read rule
// verifies ownership per alumnoId with a get() on the enrollment doc, and an
// `in` disjunction multiplies those get()s past Firestore's per-query limit.
// A student has a handful of enrollments, so this stays cheap.
async function fetchSubmissionsForStudents(studentDocIds) {
  const snaps = await Promise.all(
    studentDocIds.map((id) =>
      getDocs(query(collection(db, 'submissions'), where('alumnoId', '==', id)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

export default function StudentDashboard() {
  const { currentUser, userProfile, setUserProfile } = useAuth()
  // Arriba de los useState: el de showJoin lee location.state en su inicializador.
  const location = useLocation()
  const [subjects, setSubjects] = useState([])
  const [studentInfo, setStudentInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showJoin, setShowJoin] = useState(location.state?.openJoin === true)
  const [joinCode, setJoinCode] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // Recordatorio de la versión web (solo App): arranca colapsado, se ve nada
  // más el título hasta que el estudiante lo abre.
  const [showWebInfo, setShowWebInfo] = useState(false)

  // Su espejo en la web: recordatorio de que también existe la app.
  const [showAppInfo, setShowAppInfo] = useState(false)
  // Incrementa después de cada reorden confirmado — se lo pasa a StudentLayout
  // como `refreshKey` para que la barra lateral recargue su propia lista, que
  // vive en un componente aparte y de otro modo no se enteraría del cambio
  // mientras el alumno se queda en esta misma pantalla.
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  // Quitar una materia archivada de SU lista (ver handleRemoveArchived).
  const [subjectToRemove, setSubjectToRemove] = useState(null)
  const [removing, setRemoving] = useState(false)
  // Pedido explícito: en la App (no en la web), poder cambiar la foto tocándola
  // aquí directamente, sin entrar al perfil.
  const [cropFile, setCropFile] = useState(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file || !currentUser) return
    setCropFile(file)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function handleCropConfirm(croppedFile) {
    setUploadingPhoto(true)
    try {
      const url = await uploadToCloudinary(croppedFile, 'evalua-facil/profiles')
      await updateAllEnrollments(currentUser.uid, { photoURL: url })
      setUserProfile((prev) => ({ ...prev, photoURL: url }))
      setStudentInfo((prev) => (prev ? { ...prev, photoURL: url } : prev))
      setCropFile(null)
      toast('Foto actualizada')
    } catch {
      toast('No se pudo subir la foto', 'error')
    } finally {
      setUploadingPhoto(false)
    }
  }
  const navigate = useNavigate()
  const toast = useToast()

  useBackHandler(() => setShowJoin(false), showJoin)
  useScrollLock(showJoin)
  useBackHandler(() => !removing && setSubjectToRemove(null), !!subjectToRemove)
  useScrollLock(!!subjectToRemove)

  // Quitar de "Asignaturas archivadas" una materia que el docente ya cerró.
  //
  // Es un ocultamiento del ALUMNO, no un borrado: se marca `ocultaPorAlumno` en
  // su doc de inscripción y las listas dejan de traerla (visibleEnrollments).
  // A propósito no borra nada — sus entregas y calificaciones son parte del
  // expediente del docente, que archivó justamente para conservarlo completo.
  // Las reglas de Firestore tampoco lo permitirían: borrar un doc de `students`
  // es solo del docente dueño de la asignatura; el alumno únicamente puede
  // actualizar el suyo.
  async function handleRemoveArchived() {
    if (!subjectToRemove?.enrollmentId) return
    setRemoving(true)
    try {
      await updateDoc(doc(db, 'students', subjectToRemove.enrollmentId), { ocultaPorAlumno: true, ocultaPorAlumnoAt: serverTimestamp() })
      setSubjects((prev) => prev.filter((s) => s.id !== subjectToRemove.id))
      setSubjectToRemove(null)
      toast('Se quitó de tus asignaturas archivadas')
    } catch (err) {
      toast('No se pudo quitar: ' + err.message, 'error')
    } finally {
      setRemoving(false)
    }
  }

  function handleJoinSubject(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    navigate(`/activate/${code}`)
  }

  useEffect(() => {
    if (currentUser) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-doctor/exhaustive-deps -- mount-only intencional
  }, [currentUser])

  // Abre "Unirme a otra asignatura" cuando se llega con openJoin desde el botón
  // del sidebar — incluye el caso de YA estar en el dashboard, donde el
  // inicializador del useState no se vuelve a ejecutar. location.key cambia en
  // cada navegación, así que esto dispara siempre. Mismo patrón que el
  // openCreate del docente.
  useEffect(() => {
    if (location.state?.openJoin) {
      openJoinModal()
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  function openJoinModal() {
    setJoinCode('')
    setShowJoin(true)
  }

  // Reordenar sus asignaturas — mismo patrón que el docente en su propio
  // Dashboard.jsx (flechas subir/bajar en la web, arrastrar en la App).
  // Pedido explícito: el alumno también puede tener varias asignaturas y
  // hasta ahora no había forma de acomodarlas a su gusto. Solo opera sobre
  // las activas — las archivadas no se reordenan, viven aparte.
  // `alumnoOrden` vive en SU inscripción (students/{enrollmentId}); no es lo
  // mismo que `orden` en ese mismo doc, que es la posición del docente en su
  // lista de grupo.
  async function moveSubject(index, direction) {
    const active = subjects.filter((s) => !s.archived)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= active.length) return
    ;[active[index], active[targetIndex]] = [active[targetIndex], active[index]]
    const reordered = active.map((s, i) => ({ ...s, alumnoOrden: i + 1 }))
    // El orden visual sale de recorrer `subjects` filtrando — no basta con
    // actualizar el campo `alumnoOrden` de cada elemento, hay que reacomodar
    // el array mismo, o la lista se quedaba viéndose igual aunque el campo
    // sí cambiara.
    setSubjects((prev) => [...reordered, ...prev.filter((s) => s.archived)])
    try {
      const batch = writeBatch(db)
      reordered.forEach((s) => batch.update(doc(db, 'students', s.enrollmentId), { alumnoOrden: s.alumnoOrden }))
      await batch.commit()
      setSidebarRefreshKey((k) => k + 1)
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  // Arrastrar — solo en la App, mismo motivo que el docente: en la web ya
  // están las flechas, que funcionan bien con mouse; en la App no hay forma
  // de arrastrar con el dedo sin esto.
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragCardRefs = useRef([])
  const dragStateRef = useRef({ dragIndex: null, overIndex: null })

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
    const active = subjects.filter((s) => !s.archived)
    const [item] = active.splice(from, 1)
    active.splice(to, 0, item)
    const reordered = active.map((s, i) => ({ ...s, alumnoOrden: i + 1 }))
    // El orden visual sale de recorrer `subjects` filtrando — no basta con
    // actualizar el campo `alumnoOrden` de cada elemento, hay que reacomodar
    // el array mismo, o la lista se quedaba viéndose igual aunque el campo
    // sí cambiara.
    setSubjects((prev) => [...reordered, ...prev.filter((s) => s.archived)])
    try {
      const batch = writeBatch(db)
      reordered.forEach((s) => batch.update(doc(db, 'students', s.enrollmentId), { alumnoOrden: s.alumnoOrden }))
      await batch.commit()
      setSidebarRefreshKey((k) => k + 1)
    } catch (err) {
      toast('No se pudo reordenar: ' + err.message, 'error')
    }
  }

  async function loadData() {
    setLoading(true)
    try {
      // A student account can be enrolled in several subjects (one `students` doc per
      // subject, all sharing the same auth uid). Load every enrollment.
      const enrollments = await getEnrollments(currentUser, userProfile)
      if (enrollments.length === 0) {
        toast('No se encontró tu perfil de estudiante', 'error')
        setSubjects([])
        return
      }
      // studentInfo sale de TODAS las inscripciones (nombre y foto del alumno);
      // las listas, solo de las visibles — las que quitó de sus archivadas ya no
      // aparecen, pero su perfil sigue existiendo aunque las haya quitado todas.
      setStudentInfo(enrollments[0])
      // Map each subject → the enrollment doc id (used as alumnoId for submissions).
      const docIdBySubject = {}
      visibleEnrollments(enrollments).forEach((s) => { if (s.asignaturaId) docIdBySubject[s.asignaturaId] = s.id })
      const asignaturaIds = Object.keys(docIdBySubject)
      if (asignaturaIds.length === 0) { setSubjects([]); return }

      const subjSnaps = await Promise.all(asignaturaIds.map((id) => getDoc(doc(db, 'subjects', id))))
      const subs = subjSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
      if (subs.length === 0) { setSubjects([]); return }
      const subjectById = {}
      subs.forEach((s) => { subjectById[s.id] = s })

      // Everything else in ONE parallel batch — a constant number of round trips:
      //  · teacher names  · all activities (chunked `in`)  · all my submissions (chunked `in`)
      const teacherIds = [...new Set(subs.map((s) => s.docenteId).filter(Boolean))]
      const subjectIds = subs.map((s) => s.id)
      const myDocIds = Object.values(docIdBySubject)
      const [teacherSnaps, actDocs, mySubmissions] = await Promise.all([
        Promise.all(teacherIds.map((tid) => getDoc(doc(db, 'users', tid)))),
        fetchActivitiesForSubjects(subjectIds),
        fetchSubmissionsForStudents(myDocIds),
      ])

      const teachers = {}
      teacherSnaps.forEach((t) => {
        if (!t.exists()) return
        const td = t.data()
        teachers[t.id] = teacherDisplayName(td) || '—'
      })

      // Group activities by subject and index this student's grade per activity
      // (activities are subject-unique, so keying by activity id never collides).
      const actsBySubject = {}
      actDocs.forEach((d) => {
        const a = { id: d.id, ...d.data() }
        const parcialesOcultos = subjectById[a.asignaturaId]?.parcialesOcultos || []
        if (!isActivityPublished(a, parcialesOcultos.includes(a.parcial))) return
        if (!actsBySubject[a.asignaturaId]) actsBySubject[a.asignaturaId] = []
        actsBySubject[a.asignaturaId].push(a)
      })
      const gradeByActivity = {}
      mySubmissions.forEach((d) => {
        const data = d.data()
        if (data.calificacion != null) gradeByActivity[data.actividadId] = data.calificacion
      })

      // Compute each subject's average in memory.
      const enriched = subs.map((s) => {
        const acts = actsBySubject[s.id] || []
        // A09 · MISMO criterio que la pantalla del docente (SubjectPage.jsx),
        // número por número: excluye lo que no cuenta para calificación
        // (`cuentaParaCalificacion` — antes solo isActivityPublished, así que
        // un diagnóstico marcado "sin calificación" DESPUÉS de tener nota
        // seguía metiéndose aquí) y redondea CADA actividad a 1 decimal antes
        // de promediar el parcial — antes promediaba los números crudos y
        // redondeaba solo el Final, lo que podía dar un Final distinto al de
        // la pantalla del docente por el orden del redondeo.
        const PARC = Array.from({ length: s.parciales || 3 }, (_, i) => i + 1)
        const parcAvgs = PARC.map((p) => {
          const pacts = acts.filter((a) => a.parcial === p && cuentaParaCalificacion(a))
          const grades = pacts.map((a) => normalizeGrade(gradeByActivity[a.id], a.maxCalif, { decimals: 1 }))
          const raw = promedioParcial(pacts, grades, ponderacionActivaEnParcial(s, p))
          return raw !== null ? parseFloat(raw.toFixed(1)) : null
        }).filter((v) => v !== null)
        const avg = parcAvgs.length
          ? (parcAvgs.reduce((x, y) => x + y, 0) / parcAvgs.length).toFixed(1)
          : null
        // enrollmentId: el doc de `students` de ESTA materia — lo necesita
        // "quitar de archivadas" y también reordenar (alumnoOrden vive ahí,
        // en SU inscripción — el `orden` de ese mismo doc ya es del docente,
        // la posición en SU lista de grupo, un campo distinto).
        const enrollment = enrollments.find((e) => e.asignaturaId === s.id)
        return { ...s, enrollmentId: docIdBySubject[s.id], teacherName: teachers[s.docenteId] || '—', avg, alumnoOrden: enrollment?.alumnoOrden }
      })
      // Mismo patrón de auto-sanado que el Dashboard del docente (Dashboard.jsx):
      // la primera vez que se ve una inscripción sin alumnoOrden, se asigna uno
      // por posición alfabética actual y se persiste, para que desde ahí el
      // alumno ya tenga un orden estable que reacomodar a mano.
      let ordered = enriched
      if (ordered.some((s) => s.alumnoOrden == null)) {
        ordered = [...ordered].sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b), 'es'))
        const batch = writeBatch(db)
        ordered = ordered.map((s, i) => {
          const alumnoOrden = i + 1
          if (s.alumnoOrden !== alumnoOrden) batch.update(doc(db, 'students', s.enrollmentId), { alumnoOrden })
          return { ...s, alumnoOrden }
        })
        batch.commit().catch(() => {}) // best-effort; el orden en memoria ya es correcto
      } else {
        ordered = [...ordered].sort((a, b) => (a.alumnoOrden ?? 0) - (b.alumnoOrden ?? 0))
      }
      setSubjects(ordered)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <StudentLayout refreshKey={sidebarRefreshKey}>
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    </StudentLayout>
  )

  // El username va SIN capitalizar (es identificador, no nombre).
  const displayName =
    [userProfile?.nombre, userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')
    || [studentInfo?.nombre, studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')
    || userProfile?.username
    || studentInfo?.username
    || 'Estudiante'
  const initials = displayName.charAt(0).toUpperCase()
  const photoURL = userProfile?.photoURL || studentInfo?.photoURL
  // Solo el/los nombre(s) de pila — los apellidos van en un segundo renglón aparte.
  const firstName = capitalizarNombre(userProfile?.nombre || studentInfo?.nombre) || displayName
  const apellidos =
    [userProfile?.apellidoPaterno, userProfile?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')
    || [studentInfo?.apellidoPaterno, studentInfo?.apellidoMaterno].map(capitalizarNombre).filter(Boolean).join(' ')

  const activeSubjects = subjects.filter((s) => !s.archived)
  const archivedSubjects = subjects.filter((s) => s.archived)

  // Lista mostrada mientras se arrastra: el elemento arrastrado ya aparece
  // en su posición "de prueba" (overIndex), aunque todavía no se guardó
  // nada — el commit real solo pasa al soltar. Mismo patrón que el docente.
  const displayActiveSubjects = dragIndex == null ? activeSubjects : (() => {
    const arr = [...activeSubjects]
    const [item] = arr.splice(dragIndex, 1)
    arr.splice(overIndex ?? dragIndex, 0, item)
    return arr
  })()

  return (
    <StudentLayout refreshKey={sidebarRefreshKey}>
      <div className={`px-4 py-6 ${STUDENT_CONTAINER}`}>
        {/* Foto/nombre — solo móvil, informativo (el logo tocable ya vive en la
            barra superior). Ya NO navega al perfil: la barra inferior tiene su
            propio botón "Perfil" — dos caminos al mismo destino desde la misma
            pantalla era la redundancia que Don't Make Me Think prohíbe. */}
        <div className="md:hidden bg-surface-card rounded-card shadow-card overflow-hidden mb-4">
          <div className="w-full flex items-center gap-3 px-4 py-4">
            {/* Pedido explícito: en la App se puede tocar la foto para
                cambiarla al vuelo, sin entrar al perfil (en la web sigue
                viviendo solo dentro del perfil). */}
            {IS_NATIVE_APP ? (
              // Pedido explícito: sin ícono encima (ni siquiera en la esquina).
              // 80px = el 75% de los 106px que medía. Solo en la app — la web,
              // abajo, se queda como estaba.
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                aria-label="Cambiar foto de perfil"
                className="w-20 h-20 rounded-full bg-accent-tint overflow-hidden flex items-center justify-center flex-shrink-0"
              >
                {photoURL ? (
                  <img src={photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-accent">{initials}</span>
                )}
              </button>
            ) : (
              // En la web también al doble: 44px → 88px.
              <div className="w-[5.5rem] h-[5.5rem] rounded-full bg-accent-tint overflow-hidden flex items-center justify-center flex-shrink-0">
                {photoURL ? (
                  <img src={photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-accent">{initials}</span>
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-on-surface truncate">{firstName}</p>
              {apellidos && <p className="text-sm text-muted truncate">{apellidos}</p>}
            </div>
          </div>
        </div>
        {IS_NATIVE_APP && (
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoChange}
          />
        )}
        {cropFile && (
          <AvatarCropModal
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onConfirm={handleCropConfirm}
            saving={uploadingPhoto}
          />
        )}

        <h1 className="text-xl font-bold text-on-surface mb-1">Mis asignaturas</h1>
        <p className="text-slate-400 text-sm mb-5">{activeSubjects.length} asignatura{activeSubjects.length !== 1 ? 's activas' : ' activa'}</p>

        {activeSubjects.length === 0 ? (
          <div className="bg-surface-card rounded-card border border-outline-variant p-10 text-center">
            <BookOpen size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-muted mb-1">Aún no tienes asignaturas</p>
            <p className="text-slate-400 text-sm">Usa el botón de abajo para unirte a una.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayActiveSubjects.map((s, i) => (
              <div
                key={s.id}
                ref={(el) => { dragCardRefs.current[i] = el }}
                {...subjectPaletteProps(s.colorPalette)}
                className={`w-full bg-surface-card rounded-card p-1.5 shadow-card hover:shadow-md transition-all duration-200 flex items-center gap-1 ${dragIndex === i ? 'opacity-60 shadow-lg' : ''}`}
              >
                {/* Reordenar: flechas en la web, arrastrar en la App — solo si
                    hay más de una asignatura (con una sola no hay nada que
                    reordenar). Mismo patrón que el docente en su Dashboard. */}
                {activeSubjects.length > 1 && (
                  IS_NATIVE_APP ? (
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
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSubject(i, 1)}
                        disabled={i === activeSubjects.length - 1}
                        data-tooltip="Bajar"
                        aria-label="Bajar"
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-tint)] disabled:opacity-40 rounded"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  )
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/alumno/materia/${s.id}`)}
                  className="flex-1 min-w-0 text-left flex items-center gap-3 p-1.5"
                >
                  <div className="w-12 h-12 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                    <SubjectIcon iconKey={s.icon} size={22} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-on-surface truncate">{subjectDisplayName(s)}</p>
                    <p className="text-slate-500 text-sm font-medium mt-0.5 truncate">{s.teacherName}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.avg != null && (
                      <div className="text-right">
                        <p className="text-lg font-bold text-accent">{s.avg}</p>
                        <p className="text-sm text-slate-500">promedio</p>
                      </div>
                    )}
                    <ChevronRight size={18} className="text-slate-300" />
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Join another subject */}
        <button
          type="button"
          onClick={openJoinModal}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-card border border-dashed border-accent text-accent text-sm font-semibold hover:bg-accent-light transition-colors"
        >
          <Plus size={18} /> Unirme a otra asignatura
        </button>

        {/* Asignaturas archivadas — SOLO si el docente ya archivó alguna.
            Archivar es decisión del maestro: el estudiante no archiva nada, así
            que antes del primer archivado esta sección no le dice nada útil —
            solo era una gaveta vacía con un "No tienes asignaturas archivadas"
            adentro. Aparece sola en cuanto llega la primera, y vuelve a
            desaparecer si el maestro las restaura todas.
            Ya no es `md:hidden`: en la web también le toca. El sidebar solo
            lleva a ellas (como el del docente); quitarlas de su lista se hace
            aquí, que es donde vive esa acción, en móvil y en escritorio. */}
        {archivedSubjects.length > 0 && (
          <div className="mt-4 bg-surface-card rounded-card shadow-card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-muted hover:bg-accent-tint transition-colors"
            >
              <Archive size={16} className="flex-shrink-0" />
              <span className="flex-1 text-left">Asignaturas archivadas ({archivedSubjects.length})</span>
              <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
            </button>
            {showArchived && (
              <div className="px-2 pb-2 space-y-1">
                {/* Dos botones hermanos, NO uno dentro de otro: un <button> anidado
                    en otro <button> es HTML inválido y el clic de la papelera
                    terminaría abriendo también la asignatura. */}
                {archivedSubjects.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/alumno/materia/${s.id}`)}
                      className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded text-sm text-muted hover:bg-accent-tint transition-colors text-left"
                    >
                      <SubjectIcon iconKey={s.icon} size={17} className="flex-shrink-0" />
                      <span className="truncate">{subjectDisplayName(s)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubjectToRemove(s)}
                      aria-label={`Quitar ${subjectDisplayName(s)} de mis asignaturas archivadas`}
                      className="p-2 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recordatorio de la versión web — solo en la App. Igual que el del
            docente en su Dashboard: informativo, NO navega (tocarlo solo abre
            y cierra) y deja la dirección a la vista. Usa ChevronDown/rotate-180
            porque ese es el lenguaje de desplegable del módulo del estudiante,
            no el ChevronRight/rotate-90 del docente. */}
        {IS_NATIVE_APP && (
          <div className="mt-4 bg-surface-card rounded-card shadow-card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowWebInfo((v) => !v)}
              aria-expanded={showWebInfo}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-accent-tint transition-colors text-left"
            >
              <Globe size={17} className="text-accent flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm font-semibold text-on-surface">También puedes entrar desde tu computadora</span>
              <ChevronDown size={15} className={`text-slate-400 flex-shrink-0 transition-transform ${showWebInfo ? 'rotate-180' : ''}`} />
            </button>
            {showWebInfo && (
              <div className="px-4 pb-4 pt-0.5">
                <p className="text-sm text-muted">Tus asignaturas, tus entregas, tus exámenes y tus calificaciones también están en la versión web. Es útil cuando necesitas subir un trabajo desde la computadora o presentar un examen en pantalla grande.</p>
                <p className="text-sm text-muted mt-1.5">Es tu misma cuenta: inicia sesión con el mismo usuario y contraseña. Todo lo que hagas en la app se refleja en la versión web, y viceversa.</p>
                <p className="text-sm font-semibold text-accent mt-1.5">www.evaluafacil.mx</p>
              </div>
            )}
          </div>
        )}

        {/* El espejo del anterior: en la WEB se recuerda que también hay app.
            El botón de descarga aparece solo cuando ya hay URL oficial
            (config/appDownload.js); mientras tanto se dice que está por
            publicarse, en vez de dejar un enlace muerto. */}
        {!IS_NATIVE_APP && (
          <div className="mt-4 bg-surface-card rounded-card shadow-card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAppInfo((v) => !v)}
              aria-expanded={showAppInfo}
              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-accent-tint transition-colors text-left"
            >
              <Smartphone size={17} className="text-accent flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm font-semibold text-on-surface">También puedes usar la app en tu celular</span>
              <ChevronDown size={15} className={`text-slate-400 flex-shrink-0 transition-transform ${showAppInfo ? 'rotate-180' : ''}`} />
            </button>
            {showAppInfo && (
              <div className="px-4 pb-4 pt-0.5">
                <p className="text-sm text-muted">Con la app puedes revisar tus asignaturas, entregar tus trabajos y ver tus calificaciones desde donde estés, y recibir avisos cuando tu maestro publique algo nuevo.</p>
                <p className="text-sm text-muted mt-1.5">Es una sola app para estudiantes y docentes: al abrirla eliges con cuál perfil entras, igual que aquí.</p>
                <p className="text-sm text-muted mt-1.5">Es tu misma cuenta: inicia sesión con el mismo usuario y contraseña. Todo lo que hagas en la versión web se refleja en la app, y viceversa.</p>
                {APP_DOWNLOAD_READY ? (
                  <a
                    href={APP_DOWNLOAD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-accent hover:underline"
                  >
                    <Download size={15} /> Descargar la app
                  </a>
                ) : (
                  <p className="text-sm text-slate-400 mt-2">La descarga estará disponible muy pronto.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Join-subject modal ── */}
      {showJoin && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => setShowJoin(false)}
            aria-label="Cerrar"
          />
          {/* El código de acceso es lo único que se pide aquí, así que manda en
              la ventana: campo grande, monoespaciado y centrado, con el botón a
              todo lo ancho debajo. Antes iban input y botón apretados en una
              sola fila, y ese "# Ir" diminuto no parecía la acción principal de
              nada. Los 6 caracteres los genera el docente
              (Math.random().toString(36).slice(2, 8)), de ahí la ayuda de abajo. */}
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card drop-shadow-2xl overflow-hidden">
            <div className="flex items-start gap-3 p-5 pb-4">
              <div className="w-11 h-11 rounded-full bg-accent-light flex items-center justify-center flex-shrink-0">
                <Hash size={22} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-on-surface leading-tight">Unirme a otra asignatura</h3>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  Escribe el código que te dio tu maestro.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setShowJoin(false)}
                className="p-2 -mt-1 -mr-1 text-slate-400 hover:text-muted hover:bg-surface-container rounded transition-colors flex-shrink-0"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleJoinSubject} className="px-5 pb-5">
              <label htmlFor="joinCode" className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Código de acceso
              </label>
              {/* indent compensa el espacio que `tracking` agrega DESPUÉS de la
                  última letra: sin él el texto se ve descentrado a la izquierda. */}
              <input
                id="joinCode"
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                placeholder="A3B7K2"
                className="w-full px-4 py-3.5 rounded-card border-2 border-outline-variant focus:border-accent focus:outline-none text-2xl font-mono font-bold tracking-[0.25em] indent-[0.25em] text-center bg-surface text-on-surface placeholder:text-slate-300 placeholder:font-normal transition-colors"
              />
              <p className="text-xs text-slate-400 mt-2 text-center">
                Son 6 caracteres, entre letras y números
              </p>
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="mt-4 w-full py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-card transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                Continuar <ChevronRight size={18} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Quitar una asignatura archivada de MI lista ──
          El aviso de arriba es el punto entero de este modal: la descarga de sus
          entregas vive DENTRO de la asignatura, así que si la quita de la lista
          se queda sin camino para llegar a sus archivos. Por eso el paso de
          guardar va primero y con su propio botón, y el de quitar hasta abajo. */}
      {subjectToRemove && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 border-none cursor-default"
            onClick={() => !removing && setSubjectToRemove(null)}
            aria-label="Cerrar"
          />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-on-surface truncate">Quitar de mis archivadas</h3>
              <button type="button" aria-label="Cerrar" onClick={() => !removing && setSubjectToRemove(null)} className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3 leading-relaxed">
              <strong className="text-on-surface">{subjectDisplayName(subjectToRemove)}</strong> desaparecerá
              de tus asignaturas y ya no podrás volver a abrirla — <strong>ni para descargar tus archivos</strong>.
            </p>
            <div className="rounded border border-amber-200 bg-amber-50 p-3 mb-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">Primero guarda tu trabajo</p>
              <p className="text-xs text-amber-700 leading-relaxed mb-2">
                Abre la asignatura y usa <strong>Descargar mis entregas</strong> para bajar todos tus archivos.
                Es tu trabajo y es tu única oportunidad de llevártelo.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/alumno/materia/${subjectToRemove.id}`)}
                className="w-full py-2 rounded border border-amber-400 text-amber-800 text-sm font-semibold hover:bg-amber-100 transition-colors flex items-center justify-center gap-2"
              >
                <Download size={16} /> Abrir y descargar mis entregas
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSubjectToRemove(null)}
                disabled={removing}
                className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-surface-container transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRemoveArchived}
                disabled={removing}
                className="flex-1 py-2.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {removing ? <Spinner size="sm" /> : <Trash2 size={16} />} Quitar
              </button>
            </div>
          </div>
        </div>
      )}

    </StudentLayout>
  )
}
