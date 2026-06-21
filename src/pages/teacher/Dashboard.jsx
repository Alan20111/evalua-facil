import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
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
import { Plus, BookOpen, ChevronRight, X, CreditCard, ArrowUpDown } from 'lucide-react'
import { subjectDisplayName } from '../../utils/subjectName'
import { useSubscription } from '../../hooks/useSubscription'
import { calcDaysRemaining } from '../../utils/subscriptionHelpers'

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
  const location = useLocation()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  // Welcome modal (shown once after registration)
  const [showWelcomeModal, setShowWelcomeModal] = useState(location.state?.newAccount === true)
  const welcomeUsername = location.state?.createdUsername ?? ''

  // Trial period modal
  const [trialDismissed, setTrialDismissed] = useState(() => sessionStorage.getItem('trialDismissed') === '1')
  const { subscription, loading: subLoading } = useSubscription()
  const isTrial = subscription?.status === 'trial'
  const daysLeft = isTrial ? calcDaysRemaining(subscription.fechaVencimiento) : 0

  // Subject creation modal
  const [showSubjectModal, setShowSubjectModal] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectGrupo, setNewSubjectGrupo] = useState('')
  const [newSubjectParciales, setNewSubjectParciales] = useState(3)
  const [inlineCicloMode, setInlineCicloMode] = useState('current')
  const [creatingSubject, setCreatingSubject] = useState(false)

  // Subject list display order toggle (persists across sessions)
  const [nameOrder, setNameOrder] = useState(() => localStorage.getItem('subjectNameOrder') || 'normal')
  function toggleNameOrder() {
    const next = nameOrder === 'normal' ? 'reverse' : 'normal'
    setNameOrder(next)
    localStorage.setItem('subjectNameOrder', next)
  }

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
      const subSnap = await getDocs(
        query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid))
      )
      const subList = subSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
          if (nc !== 0) return nc
          return (a.ciclo || '').localeCompare(b.ciclo || '', 'es')
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
    if (!newSubjectName.trim() || !newSubjectGrupo.trim()) return
    setCreatingSubject(true)
    try {
      const subData = {
        nombre: newSubjectName.trim(),
        grupo: newSubjectGrupo.trim(),
        docenteId: currentUser.uid,
        escuelaId: userProfile.escuelaId,
        parciales: newSubjectParciales,
        ciclo: inlineSelectedCiclo,
        accessCode: generateAccessCode(),
        archived: false,
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'subjects'), subData)
      setSubjects((prev) =>
        [...prev, { id: ref.id, ...subData }]
          .sort((a, b) => {
            const nc = (a.nombre || '').localeCompare(b.nombre || '', 'es')
            if (nc !== 0) return nc
            return (a.ciclo || '').localeCompare(b.ciclo || '', 'es')
          })
      )
      setShowSubjectModal(false)
      setNewSubjectName('')
      setNewSubjectGrupo('')
      setNewSubjectParciales(3)
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
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleNameOrder}
                  title={nameOrder === 'normal' ? 'Mostrar Grupo + Asignatura' : 'Mostrar Asignatura + Grupo'}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50"
                >
                  <ArrowUpDown size={13} />
                  {nameOrder === 'normal' ? 'Asignatura · Grupo' : 'Grupo · Asignatura'}
                </button>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs text-slate-400">{subjects.length} asignatura{subjects.length !== 1 ? 's' : ''}</span>
              </div>
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
                        <p className="font-semibold text-slate-900 truncate">{subjectDisplayName(s, nameOrder === 'reverse')}</p>
                        {s.archived && (
                          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            archivada
                          </span>
                        )}
                      </div>
                      {s.ciclo && (
                        <p className="text-xs text-slate-400 mt-0.5">{s.ciclo}</p>
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Asignatura</label>
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
              {/* Grupo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
                <input
                  type="text"
                  value={newSubjectGrupo}
                  onChange={(e) => setNewSubjectGrupo(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-slate-50"
                  placeholder="Ej: 1A, 2B, 3C"
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

      {/* Welcome modal — shown once after registration */}
      {showWelcomeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <h2 className="text-lg font-bold text-slate-900">¡Bienvenido/a!</h2>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-4">
              <p className="text-xs text-blue-500 mb-1 font-semibold uppercase tracking-wide">Tu nombre de usuario</p>
              <p className="text-3xl font-black font-mono text-blue-700 tracking-widest">{welcomeUsername}</p>
              <p className="text-xs text-slate-500 mt-2">Úsalo cada vez que inicies sesión</p>
            </div>

            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-left">
              <span className="text-amber-500 mt-0.5 text-base">✉</span>
              <p className="text-sm text-amber-700 leading-relaxed">
                Enviamos tu usuario y un <strong>enlace de verificación</strong> a tu correo.
              </p>
            </div>

            <button
              onClick={() => setShowWelcomeModal(false)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              Entrar al dashboard
            </button>
          </div>
        </div>
      )}

      {/* Trial period modal */}
      {isTrial && !trialDismissed && !subLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <CreditCard size={20} className="text-blue-600" />
              </div>
              <button onClick={() => { sessionStorage.setItem('trialDismissed','1'); setTrialDismissed(true) }}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Período de prueba</h3>
              <p className="text-sm text-slate-500 mt-1">
                {daysLeft > 0
                  ? <>Te quedan <strong className="text-blue-600">{daysLeft} días</strong> de prueba gratuita.</>
                  : 'Tu período de prueba ha terminado.'}
              </p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-700 mb-0.5">Plan Pro</p>
              <p className="text-2xl font-black text-blue-800">$100 <span className="text-sm font-normal text-blue-500">/mes</span></p>
              <p className="text-xs text-blue-600 mt-1">Acceso completo sin límites</p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => { navigate('/profile'); sessionStorage.setItem('trialDismissed','1'); setTrialDismissed(true) }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm">
                Contratar Plan Pro →
              </button>
              <button onClick={() => { sessionStorage.setItem('trialDismissed','1'); setTrialDismissed(true) }}
                className="w-full py-2 text-slate-400 hover:text-slate-600 text-sm transition-colors">
                Recordármelo después
              </button>
            </div>
          </div>
        </div>
      )}

    </TeacherLayout>
  )
}
