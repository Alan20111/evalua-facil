import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { getEnrollments } from '../utils/studentLookup'
import { subjectDisplayName } from '../utils/subjectName'
import { teacherDisplayName } from '../utils/studentSearch'
import { lecturaDocId, avisosDesde } from '../utils/avisos'
import { IS_NATIVE_APP } from '../utils/platform'
import AvisoLecturaModal from './subject/AvisoLecturaModal'

// Lectura obligatoria de avisos — GLOBAL, no por asignatura. Pedido explícito:
// un aviso debe bloquear al estudiante "aunque no esté navegando dentro de
// una asignatura" (el Dashboard, la Agenda, donde sea). Montado una sola vez
// en StudentLayout, que envuelve todas las pantallas del alumno, en vez de
// vivir dentro de SubjectPage.jsx (que solo se monta al entrar a ESA materia
// — un aviso de otra materia nunca llegaba a bloquear nada).
//
// Tope de 30 asignaturas: un solo `where(..., 'in', ids)` por colección, sin
// wave de multi-chunk — ningún alumno real tiene más de 30 materias a la vez.
const MAX_SUBJECTS = 30

export default function AvisosGate() {
  const { currentUser, userProfile } = useAuth()
  const toast = useToast()
  // Inscripciones activas (asignatura no archivada) — [{ id, asignaturaId }]
  const [enrollments, setEnrollments] = useState([])
  const [avisos, setAvisos] = useState([])
  const [lecturas, setLecturas] = useState({}) // { [avisoId]: true }
  const [teacherNames, setTeacherNames] = useState({}) // { [docenteId]: nombre }
  const [subjectNames, setSubjectNames] = useState({}) // { [asignaturaId]: nombre }
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    getEnrollments(currentUser, userProfile)
      .then(async (list) => {
        if (cancelled || list.length === 0) return
        const ids = list.slice(0, MAX_SUBJECTS)
        const subjSnaps = await Promise.all(ids.map((e) => getDoc(doc(db, 'subjects', e.asignaturaId))))
        if (cancelled) return
        const names = {}
        const active = ids.filter((e, i) => {
          if (!subjSnaps[i].exists()) return false
          const d = subjSnaps[i].data()
          names[e.asignaturaId] = subjectDisplayName(d)
          return !d.archived
        })
        setSubjectNames(names)
        setEnrollments(active)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentUser, userProfile])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia al quedarse sin inscripciones activas, antes de (no) suscribirse
    if (enrollments.length === 0) { setAvisos([]); return undefined }
    const subjectIds = enrollments.map((e) => e.asignaturaId)
    const unsub = onSnapshot(
      query(collection(db, 'avisos'), where('asignaturaId', 'in', subjectIds)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.activo !== false)
        setAvisos(list)
        // Nombres de docente — solo se piden los que todavía no se conocen.
        const faltantes = [...new Set(list.map((a) => a.docenteId))].filter((id) => id && !teacherNames[id])
        if (faltantes.length) {
          Promise.all(faltantes.map((id) => getDoc(doc(db, 'users', id))))
            .then((snaps) => {
              const nuevos = {}
              snaps.forEach((s, i) => { if (s.exists()) nuevos[faltantes[i]] = teacherDisplayName(s.data()) })
              setTeacherNames((prev) => ({ ...prev, ...nuevos }))
            })
            .catch(() => {})
        }
      },
      () => {}
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- teacherNames se lee para deduplicar, no para re-suscribir
  }, [enrollments])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia al quedarse sin inscripciones activas, antes de (no) suscribirse
    if (enrollments.length === 0) { setLecturas({}); return undefined }
    const enrollmentIds = enrollments.map((e) => e.id)
    const unsub = onSnapshot(
      query(collection(db, 'avisoLecturas'), where('estudianteId', 'in', enrollmentIds)),
      (snap) => {
        const map = {}
        snap.docs.forEach((d) => { map[d.data().avisoId] = true })
        setLecturas(map)
      },
      () => {}
    )
    return unsub
  }, [enrollments])

  const avisosPendientes = avisos
    .filter((a) => !lecturas[a.id])
    // Solo avisos publicados a partir de que la asignatura quedó activa para
    // este alumno (ver avisosDesde) — uno anterior no le corresponde, aunque
    // siga activo. Si no fuera así, quien activa su cuenta a mitad del curso
    // se llevaría de golpe TODOS los avisos previos, uno por uno, sin poder
    // salir del modal hasta confirmarlos todos.
    .filter((a) => {
      const enr = enrollments.find((e) => e.asignaturaId === a.asignaturaId)
      const since = avisosDesde(enr)
      return since == null || (a.fechaCreacion?.seconds ?? 0) >= since
    })
    .sort((a, b) => (a.fechaCreacion?.seconds ?? 0) - (b.fechaCreacion?.seconds ?? 0))

  async function confirmarLectura(aviso) {
    const enr = enrollments.find((e) => e.asignaturaId === aviso.asignaturaId)
    if (!enr) return
    setConfirming(true)
    try {
      await setDoc(doc(db, 'avisoLecturas', lecturaDocId(aviso.id, enr.id)), {
        avisoId: aviso.id,
        asignaturaId: aviso.asignaturaId,
        estudianteId: enr.id,
        fechaHoraLectura: serverTimestamp(),
        dispositivo: `${IS_NATIVE_APP ? 'app' : 'web'} · ${navigator.userAgent}`,
      })
    } catch (err) {
      toast('Error al confirmar el aviso: ' + err.message, 'error')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <AvisoLecturaModal
      avisos={avisosPendientes}
      teacherNames={teacherNames}
      subjectNames={subjectNames}
      onConfirm={confirmarLectura}
      confirming={confirming}
    />
  )
}
