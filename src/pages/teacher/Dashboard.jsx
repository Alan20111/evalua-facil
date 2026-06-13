import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { Plus, Users, BookOpen, ChevronRight, ChevronLeft, X } from 'lucide-react'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function getCicloInfo() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 8) {
    return { current: `AGO ${year}-ENE ${year + 1}`, next: `FEB ${year + 1}-JUL ${year + 1}` }
  }
  return { current: `FEB ${year}-JUL ${year}`, next: `AGO ${year}-ENE ${year + 1}` }
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const [subjects, setSubjects] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)

  // Subject creation modal
  const [showSubjectModal, setShowSubjectModal] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectParciales, setNewSubjectParciales] = useState(3)
  const [inlineGroupName, setInlineGroupName] = useState('')
  const [inlineCicloMode, setInlineCicloMode] = useState('current')
  const [creatingSubject, setCreatingSubject] = useState(false)

  const cicloInfo = getCicloInfo()
  const inlineSelectedCiclo = inlineCicloMode === 'current' ? cicloInfo.current : cicloInfo.next

  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (!currentUser) return
    loadAll()
  }, [currentUser])

  async function loadAll() {
    setLoading(true)
    try {
      const [subSnap, grpSnap] = await Promise.all([
        getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'groups'), where('docenteId', '==', currentUser.uid))),
      ])
      const grpMap = {}
      const grpList = grpSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      grpList.forEach((g) => { grpMap[g.id] = g })
      setGroups(grpList)

      const subList = subSnap.docs
        .map((d) => ({ id: d.id, ...d.data(), group: grpMap[d.data().grupoId] || null }))
        .sort((a, b) => {
          const nc = a.nombre.localeCompare(b.nombre, 'es')
          if (nc !== 0) return nc
          return (a.group?.nombre || '').localeCompare(b.group?.nombre || '', 'es')
        })
      setSubjects(subList)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault()
    if (!newSubjectName.trim() || !inlineGroupName.trim()) return
    setCreatingSubject(true)
    try {
      const grpRef = await addDoc(collection(db, 'groups'), {
        nombre: inlineGroupName.trim().toUpperCase(),
        ciclo: inlineSelectedCiclo,
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId,
        accessCode: generateAccessCode(),
        createdAt: serverTimestamp(),
      })
      const grp = { id: grpRef.id, nombre: inlineGroupName.trim().toUpperCase(), ciclo: inlineSelectedCiclo }
      setGroups((prev) => [...prev, grp])

      const ref = await addDoc(collection(db, 'subjects'), {
        nombre: newSubjectName.trim(),
        docenteId: currentUser.uid,
        grupoId: grpRef.id,
        escuelaId: userProfile.escuelaId,
        parciales: newSubjectParciales,
        archived: false,
        createdAt: serverTimestamp(),
      })
      setSubjects((prev) =>
        [...prev, { id: ref.id, nombre: newSubjectName.trim(), grupoId: grpRef.id, group: grp, parciales: newSubjectParciales, archived: false }]
          .sort((a, b) => {
            const nc = a.nombre.localeCompare(b.nombre, 'es')
            if (nc !== 0) return nc
            return (a.group?.nombre || '').localeCompare(b.group?.nombre || '', 'es')
          })
      )
      setShowSubjectModal(false)
      setNewSubjectName('')
      setNewSubjectParciales(3)
      setInlineGroupName('')
      setInlineCicloMode('current')
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setCreatingSubject(false)
    }
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <TeacherLayout>
      <div className="px-4 py-6 max-w-2xl mx-auto">
        {/* Greeting */}
        <div className="mb-6">
          <p className="text-slate-500 text-sm">{saludo},</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {userProfile?.nombrePropio?.split(' ')[0] ||
              userProfile?.username ||
              userProfile?.nombre ||
              'Docente'}
          </h1>
          {userProfile?.schoolName && (
            <p className="text-slate-400 text-xs mt-0.5">{userProfile.schoolName}</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* ── Mis asignaturas ── */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Mis asignaturas</h2>
              <span className="text-xs text-slate-400">
                {subjects.length} asignatura{subjects.length !== 1 ? 's' : ''}
              </span>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center mb-6">
                <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
                  <BookOpen size={28} className="text-blue-400" />
                </div>
                <p className="text-slate-600 font-medium mb-1">Aún no tienes asignaturas</p>
                <p className="text-slate-400 text-sm">Toca el botón <strong>+</strong> para crear tu primera asignatura</p>
              </div>
            ) : (
              <div className="space-y-2 mb-8">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/subject/${s.id}`)}
                    className="w-full bg-white rounded-2xl border border-slate-100 p-4 text-left shadow-sm hover:shadow-md transition-shadow flex items-center gap-4"
                  >
                    <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <BookOpen size={19} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 truncate">
                          {s.nombre}{s.group ? `: ${s.group.nombre}` : ''}
                        </p>
                        {s.archived && (
                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            archivada
                          </span>
                        )}
                      </div>
                      {s.group && (
                        <p className="text-xs text-slate-400 mt-0.5">{s.group.ciclo}</p>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}

          </>
        )}
      </div>

      {/* FAB — create subject (or group if no groups yet) */}
      <button
        onClick={() => setShowSubjectModal(true)}
        className="fixed bottom-20 right-4 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
      >
        <Plus size={24} />
      </button>

      {/* ── Nueva asignatura modal ── */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSubjectModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-900">Nueva asignatura</h3>
              <button onClick={() => setShowSubjectModal(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateSubject} className="space-y-4">
              {/* Nombre de la asignatura */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de la asignatura</label>
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: Matemáticas, Física, Historia"
                />
              </div>

              {/* Grupo (siempre nuevo — 1 grupo por asignatura) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del grupo</label>
                <input
                  type="text"
                  value={inlineGroupName}
                  onChange={(e) => setInlineGroupName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: 6A, 4B, 5C"
                />
              </div>

              {/* Período */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Período escolar</label>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {[
                    { label: 'Período actual', mode: 'current', value: cicloInfo.current },
                    { label: 'Siguiente', mode: 'next', value: cicloInfo.next },
                  ].map(({ label, mode, value }, i) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setInlineCicloMode(mode)}
                      className={`flex-1 py-2.5 px-2 text-center transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
                        inlineCicloMode === mode ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className={`block text-xs mb-0.5 ${inlineCicloMode === mode ? 'text-blue-200' : 'text-slate-400'}`}>{label}</span>
                      <span className="block text-sm font-semibold">{value}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview ASIGNATURA: GRUPO */}
              {newSubjectName && inlineGroupName && (
                <p className="text-xs text-slate-500 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  {newSubjectName.trim().toUpperCase()}: {inlineGroupName.trim().toUpperCase()}
                </p>
              )}

              {/* Parciales */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Calificaciones parciales <span className="text-slate-400 font-normal text-xs">(por defecto 3)</span>
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewSubjectParciales(n)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                        newSubjectParciales === n
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={creatingSubject}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creatingSubject ? <Spinner size="sm" /> : <Plus size={16} />}
                {creatingSubject ? 'Creando…' : 'Crear asignatura'}
              </button>
            </form>
          </div>
        </div>
      )}

    </TeacherLayout>
  )
}
