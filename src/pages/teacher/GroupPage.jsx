import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import TeacherLayout from '../../components/Layout'
import Spinner from '../../components/Spinner'
import { QRCodeSVG as QRCode } from 'qrcode.react'
import {
  ArrowLeft, Plus, Search, Users, BookOpen, QrCode,
  RotateCcw, Upload, Download, X, ChevronRight, ArrowUp, ArrowDown,
  UserPlus, Trash2,
} from 'lucide-react'
import { generateUsername, generateResetPassword } from '../../utils/generate'
import { parseStudentExcel, exportStudentListExcel } from '../../utils/excel'

export default function GroupPage() {
  const { groupId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const [group, setGroup] = useState(null)
  const [students, setStudents] = useState([])
  const [subjects, setSubjects] = useState([])
  const [tab, setTab] = useState('alumnos')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [newStudent, setNewStudent] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
  const [newSubject, setNewSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    loadAll()
  }, [groupId])

  async function loadAll() {
    setLoading(true)
    try {
      const [gSnap, studs, subs] = await Promise.all([
        getDoc(doc(db, 'groups', groupId)),
        getDocs(query(collection(db, 'students'), where('grupoId', '==', groupId))),
        getDocs(query(collection(db, 'subjects'), where('grupoId', '==', groupId))),
      ])
      setGroup({ id: gSnap.id, ...gSnap.data() })
      const studList = studs.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.orden - b.orden)
      setStudents(studList)
      setSubjects(subs.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function addStudent(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const taken = await fetchSchoolUsernames()
      const username = uniqueUsername(
        generateUsername(
          newStudent.apellidoPaterno,
          newStudent.apellidoMaterno,
          newStudent.nombre
        ),
        taken
      )
      const passwordReset = generateResetPassword()
      await addDoc(collection(db, 'students'), {
        apellidoPaterno: newStudent.apellidoPaterno.trim(),
        apellidoMaterno: newStudent.apellidoMaterno.trim(),
        nombre: newStudent.nombre.trim(),
        username,
        passwordReset,
        escuelaId: userProfile.escuelaId,
        grupoId: groupId,
        activado: false,
        orden: students.length + 1,
        createdAt: serverTimestamp(),
      })
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      toast('Alumno agregado')
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Fetch every username already used in this school with a single equality filter.
  // A range query (>=, <=) would need a deployed composite index; this avoids that
  // dependency entirely and lets us guarantee uniqueness client-side.
  async function fetchSchoolUsernames() {
    const snap = await getDocs(
      query(collection(db, 'students'), where('escuelaId', '==', userProfile.escuelaId))
    )
    return new Set(snap.docs.map((d) => d.data().username))
  }

  function uniqueUsername(base, taken) {
    if (!taken.has(base)) return base
    let i = 2
    while (taken.has(`${base}${i}`)) i++
    return `${base}${i}`
  }

  async function handleExcelImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setSaving(true)
    try {
      const rows = await parseStudentExcel(file)
      if (rows.length === 0) {
        toast('El archivo no tiene alumnos con los 3 campos requeridos', 'error')
        return
      }
      const taken = await fetchSchoolUsernames()
      const batch = writeBatch(db)
      let nextOrden = students.length + 1
      for (const row of rows) {
        const username = uniqueUsername(
          generateUsername(row.apellidoPaterno, row.apellidoMaterno, row.nombre),
          taken
        )
        taken.add(username) // reserve so the next row in this batch can't reuse it
        const ref = doc(collection(db, 'students'))
        batch.set(ref, {
          ...row,
          username,
          passwordReset: generateResetPassword(),
          escuelaId: userProfile.escuelaId,
          grupoId: groupId,
          activado: false,
          orden: nextOrden++,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      toast(`${rows.length} alumnos importados`)
      loadAll()
    } catch (err) {
      toast('Error importando Excel: ' + err.message, 'error')
    } finally {
      setSaving(false)
      e.target.value = ''
    }
  }

  async function resetPassword(student) {
    try {
      await updateDoc(doc(db, 'students', student.id), { activado: false })
      toast(`Contraseña de ${student.username} restablecida`)
      loadAll()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function confirmDeleteStudent() {
    if (!studentToDelete) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'students', studentToDelete.id))
      // Keep "orden" contiguous (1..n) for the remaining students.
      const remaining = students.filter((s) => s.id !== studentToDelete.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      toast(`${studentToDelete.username} eliminado`)
      setStudentToDelete(null)
      loadAll()
    } catch (err) {
      toast('Error al eliminar: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function moveStudent(index, direction) {
    const newList = [...students]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= newList.length) return
    ;[newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]]
    const batch = writeBatch(db)
    newList.forEach((s, i) => {
      batch.update(doc(db, 'students', s.id), { orden: i + 1 })
    })
    await batch.commit()
    setStudents(newList.map((s, i) => ({ ...s, orden: i + 1 })))
  }

  async function addSubject(e) {
    e.preventDefault()
    if (!newSubject.trim()) return
    setSaving(true)
    try {
      const ref = await addDoc(collection(db, 'subjects'), {
        nombre: newSubject.trim(),
        docenteId: currentUser.uid,
        grupoId: groupId,
        escuelaId: userProfile.escuelaId,
        createdAt: serverTimestamp(),
      })
      setNewSubject('')
      setShowAddSubject(false)
      toast('Asignatura creada')
      navigate(`/subject/${ref.id}`)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const filtered = students.filter(
    (s) =>
      `${s.apellidoPaterno} ${s.apellidoMaterno} ${s.nombre} ${s.username}`
        .toLowerCase()
        .includes(search.toLowerCase())
  )

  const activationUrl = `${window.location.origin}/activate/${group?.accessCode}`

  if (loading) return (
    <TeacherLayout>
      <div className="flex justify-center py-20"><Spinner size="lg" /></div>
    </TeacherLayout>
  )

  return (
    <TeacherLayout>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-900">{group?.nombre}</h1>
              <p className="text-slate-400 text-xs">{group?.ciclo}</p>
            </div>
            <button
              onClick={() => setShowQR(true)}
              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
            >
              <QrCode size={22} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 bg-slate-100 p-1 rounded-xl">
            {['alumnos', 'asignaturas'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  tab === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'alumnos' ? `Alumnos (${students.length})` : `Asignaturas (${subjects.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Alumnos tab */}
        {tab === 'alumnos' && (
          <div className="px-4 py-4 space-y-3">
            {/* Search + actions */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar alumno…"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                />
              </div>
              <button
                onClick={() => setShowAddStudent(true)}
                className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors"
              >
                <UserPlus size={18} />
              </button>
            </div>

            {/* Excel actions */}
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors">
                <Upload size={15} /> Importar Excel
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelImport} />
              </label>
              <button
                onClick={() => exportStudentListExcel(students)}
                disabled={students.length === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                <Download size={15} /> Exportar
              </button>
            </div>

            {/* Student list */}
            {filtered.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">
                {search ? 'Sin resultados' : 'No hay alumnos en este grupo'}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((s, i) => (
                  <div
                    key={s.id}
                    className="bg-white rounded-xl border border-slate-100 px-3 py-3 flex items-center gap-3 shadow-sm"
                  >
                    {/* Order */}
                    <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-slate-500">{s.orden}</span>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono text-indigo-600 font-semibold">{s.username}</span>
                        <span className="text-xs text-slate-400">• {s.passwordReset}</span>
                        {s.activado ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">activo</span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">sin activar</span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!search && (
                        <>
                          <button
                            onClick={() => moveStudent(i, -1)}
                            disabled={i === 0}
                            className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            onClick={() => moveStudent(i, 1)}
                            disabled={i === filtered.length - 1}
                            className="p-1.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => resetPassword(s)}
                        className="p-1.5 text-amber-500 hover:text-amber-700 rounded"
                        title="Resetear contraseña"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => setStudentToDelete(s)}
                        className="p-1.5 text-slate-300 hover:text-red-500 rounded"
                        title="Eliminar alumno"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Asignaturas tab */}
        {tab === 'asignaturas' && (
          <div className="px-4 py-4 space-y-3">
            <button
              onClick={() => setShowAddSubject(true)}
              className="w-full py-3 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Nueva asignatura
            </button>
            {subjects.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">
                No hay asignaturas creadas
              </div>
            ) : (
              <div className="space-y-2">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/subject/${s.id}`)}
                    className="w-full bg-white rounded-xl border border-slate-100 px-4 py-3.5 text-left shadow-sm hover:shadow-md transition-shadow flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                      <BookOpen size={18} className="text-indigo-500" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{s.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">3 parciales</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add student modal */}
      {showAddStudent && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddStudent(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Agregar alumno</h3>
              <button onClick={() => setShowAddStudent(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={addStudent} className="space-y-3">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={newStudent[field]}
                  onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                  placeholder={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : <Plus size={16} />}
                Agregar alumno
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add subject modal */}
      {showAddSubject && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddSubject(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold">Nueva asignatura</h3>
              <button onClick={() => setShowAddSubject(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <form onSubmit={addSubject} className="space-y-4">
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                required
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50"
                placeholder="Ej: Programación Web, Matemáticas"
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : <Plus size={16} />}
                Crear asignatura
              </button>
            </form>
          </div>
        </div>
      )}

      {/* QR modal */}
      {showQR && group && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowQR(false)} />
          <div className="relative bg-white w-full max-w-xs rounded-2xl p-6 shadow-2xl text-center">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">QR de acceso</h3>
              <button onClick={() => setShowQR(false)} className="p-2 text-slate-400 rounded-lg"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Proyecta este QR en clase para que tus alumnos activen su cuenta.
            </p>
            <div className="flex justify-center p-4 bg-white rounded-xl border border-slate-100 mb-3">
              <QRCode value={activationUrl} size={180} />
            </div>
            <p className="text-xs text-slate-400 font-mono break-all">{activationUrl}</p>
            <p className="text-xs text-slate-400 mt-1">Código: <strong>{group.accessCode}</strong></p>
          </div>
        </div>
      )}

      {/* Delete student confirmation */}
      {studentToDelete && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setStudentToDelete(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-slate-900">¿Eliminar alumno?</h3>
            <p className="text-sm text-slate-500 text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentToDelete.apellidoPaterno} {studentToDelete.nombre}</strong>{' '}
              ({studentToDelete.username}) de este grupo. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStudentToDelete(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteStudent}
                disabled={saving}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : <Trash2 size={16} />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  )
}
