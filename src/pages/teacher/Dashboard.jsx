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
import { Plus, Users, BookOpen, ChevronRight, X } from 'lucide-react'

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [newGroup, setNewGroup] = useState({ nombre: '', ciclo: '' })
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (!currentUser) return
    loadGroups()
  }, [currentUser])

  async function loadGroups() {
    setLoading(true)
    try {
      const q = query(
        collection(db, 'groups'),
        where('docenteId', '==', currentUser.uid)
      )
      const snap = await getDocs(q)
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Fetch student and subject counts
      const enriched = await Promise.all(
        data.map(async (g) => {
          const [sqSnap, studSnap] = await Promise.all([
            getDocs(query(collection(db, 'subjects'), where('grupoId', '==', g.id))),
            getDocs(query(collection(db, 'students'), where('grupoId', '==', g.id))),
          ])
          return { ...g, subjectCount: sqSnap.size, studentCount: studSnap.size }
        })
      )
      setGroups(enriched)
    } catch (err) {
      toast('Error al cargar grupos: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateGroup(e) {
    e.preventDefault()
    if (!newGroup.nombre.trim() || !newGroup.ciclo.trim()) return
    setCreating(true)
    try {
      const ref = await addDoc(collection(db, 'groups'), {
        nombre: newGroup.nombre.trim().toUpperCase(),
        ciclo: newGroup.ciclo.trim(),
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId,
        accessCode: generateAccessCode(),
        createdAt: serverTimestamp(),
      })
      setShowModal(false)
      setNewGroup({ nombre: '', ciclo: '' })
      toast('Grupo creado exitosamente')
      navigate(`/group/${ref.id}`)
    } catch (err) {
      toast('Error al crear grupo: ' + err.message, 'error')
    } finally {
      setCreating(false)
    }
  }

  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <TeacherLayout>
      <div className="px-4 py-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <p className="text-slate-500 text-sm">{saludo},</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {userProfile?.nombre?.split(' ')[0] ?? 'Docente'}
          </h1>
          {userProfile?.schoolName && (
            <p className="text-slate-400 text-xs mt-0.5">{userProfile.schoolName}</p>
          )}
        </div>

        {/* Grupos */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Mis grupos</h2>
          <span className="text-xs text-slate-400">{groups.length} grupo{groups.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
              <BookOpen size={28} className="text-indigo-400" />
            </div>
            <p className="text-slate-600 font-medium mb-1">Aún no tienes grupos</p>
            <p className="text-slate-400 text-sm mb-4">Crea tu primer grupo para comenzar</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Crear grupo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/group/${g.id}`)}
                className="w-full bg-white rounded-2xl border border-slate-100 p-4 text-left shadow-sm hover:shadow-md transition-shadow flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-700 font-bold text-sm">{g.nombre.slice(0, 2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{g.nombre}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{g.ciclo}</p>
                  <div className="flex gap-3 mt-1.5">
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Users size={11} /> {g.studentCount} alumnos
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <BookOpen size={11} /> {g.subjectCount} materias
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-20 right-4 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-20"
      >
        <Plus size={24} />
      </button>

      {/* Create group modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo grupo</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre del grupo
                </label>
                <input
                  type="text"
                  value={newGroup.nombre}
                  onChange={(e) => setNewGroup((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Ej: 6A, 4B, 5C"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Ciclo escolar
                </label>
                <input
                  type="text"
                  value={newGroup.ciclo}
                  onChange={(e) => setNewGroup((f) => ({ ...f, ciclo: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50"
                  placeholder="Ej: 2025-A, 2025-B"
                />
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creating ? <Spinner size="sm" /> : <Plus size={16} />}
                {creating ? 'Creando…' : 'Crear grupo'}
              </button>
            </form>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
