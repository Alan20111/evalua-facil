import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { useToast } from './Toast'
import Spinner from './Spinner'
import { subjectDisplayName } from '../utils/subjectName'
import { calcularEstadisticasGrupo } from '../utils/evaluacionGrading'
import { ArrowLeft, Plus, Trash2, Library, Star, Users } from 'lucide-react'

const OPCION_IDS = ['a', 'b', 'c', 'd']
const EMPTY_PREGUNTA = { enunciado: '', opciones: { a: '', b: '', c: '', d: '' }, respuestaCorrecta: 'a', ponderacion: 1, guardarEnBanco: false }

const TABS = [
  { key: 'preguntas', label: 'Preguntas' },
  { key: 'config', label: 'Configuración' },
  { key: 'resultados', label: 'Resultados' },
]

// Manages everything specific to `activity.tipo === 'evaluacion'`: questions,
// the question bank, evaluación settings, and group results. Lives outside
// teacher/ActivityPage.jsx (already very large) and is rendered in its place
// whenever the activity is an evaluación.
export default function EvaluacionManager({ activity, subject, activityId, students, submissions, onActivityChange }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('preguntas')
  const [preguntas, setPreguntas] = useState([])
  const [loadingPreguntas, setLoadingPreguntas] = useState(true)
  const [showPreguntaForm, setShowPreguntaForm] = useState(false)
  const [preguntaForm, setPreguntaForm] = useState(EMPTY_PREGUNTA)
  const [saving, setSaving] = useState(false)
  const [banco, setBanco] = useState([])
  const [bancoLoaded, setBancoLoaded] = useState(false)
  const [showBanco, setShowBanco] = useState(false)
  const [configForm, setConfigForm] = useState(activity.evaluacion)
  const [savingConfig, setSavingConfig] = useState(false)

  async function loadPreguntas() {
    setLoadingPreguntas(true)
    try {
      const snap = await getDocs(collection(db, 'activities', activityId, 'preguntas'))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setPreguntas(list)
    } catch (err) {
      toast('Error al cargar preguntas: ' + err.message, 'error')
    } finally {
      setLoadingPreguntas(false)
    }
  }

  useEffect(() => { loadPreguntas() }, [activityId])
  useEffect(() => { setConfigForm(activity.evaluacion) }, [activity.evaluacion])

  async function loadBanco() {
    if (bancoLoaded) return
    try {
      const snap = await getDocs(query(collection(db, 'bancoReactivos'), where('docenteId', '==', auth.currentUser.uid)))
      setBanco(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setBancoLoaded(true)
    } catch (err) {
      toast('Error al cargar tu banco: ' + err.message, 'error')
    }
  }

  async function syncNumPreguntas(nuevoTotal) {
    const nextEvaluacion = { ...activity.evaluacion, numPreguntas: nuevoTotal }
    await updateDoc(doc(db, 'activities', activityId), { evaluacion: nextEvaluacion })
    onActivityChange((prev) => ({ ...prev, evaluacion: nextEvaluacion }))
  }

  async function handleAddPregunta(e) {
    e.preventDefault()
    const enunciado = preguntaForm.enunciado.trim()
    if (!enunciado) { toast('Escribe el enunciado de la pregunta', 'error'); return }
    if (OPCION_IDS.some((id) => !preguntaForm.opciones[id].trim())) { toast('Completa las 4 opciones', 'error'); return }
    setSaving(true)
    try {
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
      const data = {
        tipo: 'opcion_multiple',
        enunciado,
        opciones: OPCION_IDS.map((id) => ({ id, texto: preguntaForm.opciones[id].trim() })),
        respuestaCorrecta: preguntaForm.respuestaCorrecta,
        ponderacion: parseFloat(preguntaForm.ponderacion) || 1,
        orden,
        origenBancoId: null,
      }
      const ref = await addDoc(collection(db, 'activities', activityId, 'preguntas'), data)
      setPreguntas((prev) => [...prev, { id: ref.id, ...data }])
      await syncNumPreguntas(preguntas.length + 1)
      if (preguntaForm.guardarEnBanco) {
        await addDoc(collection(db, 'bancoReactivos'), {
          docenteId: auth.currentUser.uid, tipo: 'opcion_multiple', enunciado,
          opciones: data.opciones, respuestaCorrecta: data.respuestaCorrecta,
          materia: subjectDisplayName(subject), createdAt: serverTimestamp(),
        })
      }
      setPreguntaForm(EMPTY_PREGUNTA)
      setShowPreguntaForm(false)
      toast('Pregunta agregada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddFromBanco(item) {
    setSaving(true)
    try {
      const orden = preguntas.length === 0 ? 0 : Math.max(...preguntas.map((p) => p.orden ?? 0)) + 1
      const data = {
        tipo: 'opcion_multiple', enunciado: item.enunciado, opciones: item.opciones,
        respuestaCorrecta: item.respuestaCorrecta, ponderacion: 1, orden, origenBancoId: item.id,
      }
      const ref = await addDoc(collection(db, 'activities', activityId, 'preguntas'), data)
      setPreguntas((prev) => [...prev, { id: ref.id, ...data }])
      await syncNumPreguntas(preguntas.length + 1)
      toast('Pregunta agregada desde tu banco')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePregunta(id) {
    if (!confirm('¿Eliminar esta pregunta?')) return
    try {
      await deleteDoc(doc(db, 'activities', activityId, 'preguntas', id))
      setPreguntas((prev) => prev.filter((p) => p.id !== id))
      await syncNumPreguntas(Math.max(0, preguntas.length - 1))
      toast('Pregunta eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function handleSaveConfig(e) {
    e.preventDefault()
    setSavingConfig(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: configForm })
      onActivityChange((prev) => ({ ...prev, evaluacion: configForm }))
      toast('Configuración guardada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  async function handlePublicarResultados() {
    const nextEvaluacion = { ...activity.evaluacion, resultadosPublicados: true }
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: nextEvaluacion })
      onActivityChange((prev) => ({ ...prev, evaluacion: nextEvaluacion }))
      toast('Resultados publicados a tus estudiantes')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  const calificaciones = Object.values(submissions)
    .filter((s) => s.estadoEvaluacion === 'finalizado' && s.calificacion != null)
    .map((s) => s.calificacion)
  const stats = calcularEstadisticasGrupo(calificaciones, activity.maxCalif || 10)

  return (
    <div>
      <div className="bg-surface-card border-b border-outline-variant px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/subject/${activity.asignaturaId}`)} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded">
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-on-surface">{activity.nombre}</h1>
            <p className="text-slate-400 text-xs">{subjectDisplayName(subject)} · Parcial {activity.parcial} · {activity.categoria === 'examen' ? 'Examen' : 'Cuestionario'}</p>
          </div>
        </div>
        <div className="flex gap-1 mt-2 bg-surface-container p-1 rounded">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'preguntas') loadBanco() }}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${tab === t.key ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {tab === 'preguntas' && (
          <div>
            {loadingPreguntas ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <div className="space-y-2 mb-3">
                {preguntas.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Aún no hay preguntas</p>}
                {preguntas.map((p, i) => (
                  <div key={p.id} className="bg-surface-card rounded-card shadow-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-on-surface flex-1">{i + 1}. {p.enunciado}</p>
                      <button onClick={() => handleDeletePregunta(p.id)} className="p-1 text-slate-400 hover:text-error rounded flex-shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {p.opciones.map((o) => (
                        <p key={o.id} className={`text-xs px-2 py-1 rounded ${o.id === p.respuestaCorrecta ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-muted'}`}>
                          {o.id.toUpperCase()}) {o.texto}
                        </p>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Ponderación: {p.ponderacion}</p>
                  </div>
                ))}
              </div>
            )}

            {!showPreguntaForm ? (
              <div className="flex gap-2">
                <button onClick={() => setShowPreguntaForm(true)} className="flex-1 flex items-center justify-center gap-1 py-2 bg-accent text-white text-sm font-medium rounded">
                  <Plus size={17} /> Agregar pregunta
                </button>
                <button onClick={() => setShowBanco(true)} className="flex items-center justify-center gap-1 px-3 py-2 border border-accent text-accent text-sm font-medium rounded">
                  <Library size={17} /> Mi banco
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddPregunta} className="bg-surface-card rounded-card shadow-card p-3 space-y-2">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Enunciado</label>
                  <textarea value={preguntaForm.enunciado} onChange={(e) => setPreguntaForm((f) => ({ ...f, enunciado: e.target.value }))}
                    rows={2} required autoFocus
                    className="w-full px-3 py-2 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                </div>
                {OPCION_IDS.map((id) => (
                  <div key={id} className="flex items-center gap-2">
                    <input type="radio" name="respuestaCorrecta" checked={preguntaForm.respuestaCorrecta === id}
                      onChange={() => setPreguntaForm((f) => ({ ...f, respuestaCorrecta: id }))} className="accent-[var(--accent)] flex-shrink-0" />
                    <input type="text" value={preguntaForm.opciones[id]}
                      onChange={(e) => setPreguntaForm((f) => ({ ...f, opciones: { ...f.opciones, [id]: e.target.value } }))}
                      placeholder={`Opción ${id.toUpperCase()}`} required
                      className="flex-1 px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                  </div>
                ))}
                <p className="text-xs text-slate-400">Selecciona el radio de la opción correcta.</p>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">Ponderación</label>
                  <input type="number" min="0.1" step="0.1" value={preguntaForm.ponderacion}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, ponderacion: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded border border-outline-variant focus:outline-none focus:ring-2 focus:ring-accent text-sm bg-surface" />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={preguntaForm.guardarEnBanco}
                    onChange={(e) => setPreguntaForm((f) => ({ ...f, guardarEnBanco: e.target.checked }))} className="accent-[var(--accent)]" />
                  Guardar también en mi banco de reactivos
                </label>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowPreguntaForm(false); setPreguntaForm(EMPTY_PREGUNTA) }}
                    className="flex-1 py-2 text-sm text-muted">Cancelar</button>
                  <button type="submit" disabled={saving} className="flex-1 py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
                    {saving ? 'Guardando…' : 'Agregar'}
                  </button>
                </div>
              </form>
            )}

            {showBanco && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                <div className="absolute inset-0 bg-black/40" onClick={() => setShowBanco(false)} />
                <div className="relative bg-surface-card w-full max-w-lg rounded-t-card sm:rounded-card p-4 shadow-2xl max-h-[80vh] overflow-y-auto">
                  <h3 className="text-base font-semibold mb-2">Mi banco de reactivos</h3>
                  {banco.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">Aún no tienes preguntas guardadas en tu banco</p>
                  ) : (
                    <div className="space-y-1.5">
                      {banco.map((item) => (
                        <button key={item.id} onClick={() => handleAddFromBanco(item)} disabled={saving}
                          className="w-full text-left px-3 py-2 rounded border border-outline-variant hover:bg-[var(--accent-tint)] transition-colors text-sm disabled:opacity-50">
                          {item.enunciado}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setShowBanco(false)} className="w-full mt-3 py-2 text-sm text-muted">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'config' && configForm && (
          <form onSubmit={handleSaveConfig} className="bg-surface-card rounded-card shadow-card p-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Orden de las preguntas</label>
              <select value={configForm.ordenPreguntas} onChange={(e) => setConfigForm((f) => ({ ...f, ordenPreguntas: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="creacion">Orden de creación</option>
                <option value="aleatorio">Aleatorio</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Navegación</label>
              <select value={configForm.navegacion} onChange={(e) => setConfigForm((f) => ({ ...f, navegacion: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="libre">Libre — puede regresar</option>
                <option value="secuencial">Secuencial — no puede regresar</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Tiempo límite (minutos)</label>
              <input type="number" min="1" value={configForm.tiempoLimiteMin ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, tiempoLimiteMin: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Sin límite" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Intentos permitidos</label>
              <input type="number" min="1" value={configForm.intentosPermitidos ?? ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, intentosPermitidos: e.target.value ? parseInt(e.target.value, 10) : null }))}
                placeholder="Ilimitados" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Si hay varios intentos, conservar</label>
              <select value={configForm.conservar} onChange={(e) => setConfigForm((f) => ({ ...f, conservar: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="mejor">La calificación más alta</option>
                <option value="ultimo">El último intento</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Publicar resultados</label>
              <select value={configForm.publicarResultados} onChange={(e) => setConfigForm((f) => ({ ...f, publicarResultados: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface">
                <option value="inmediato">Inmediatamente al terminar</option>
                <option value="fecha">En una fecha específica</option>
                <option value="manual">Manualmente (yo decido cuándo)</option>
              </select>
            </div>
            {configForm.publicarResultados === 'fecha' && (
              <input type="datetime-local" value={configForm.publicarResultadosFecha || ''}
                onChange={(e) => setConfigForm((f) => ({ ...f, publicarResultadosFecha: e.target.value }))}
                className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
            )}
            <button type="submit" disabled={savingConfig} className="w-full py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
              {savingConfig ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </form>
        )}

        {tab === 'resultados' && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[
                { label: 'Promedio', value: stats.promedio },
                { label: 'Máxima', value: stats.maxima },
                { label: 'Mínima', value: stats.minima },
                { label: '% Aprobados', value: `${stats.porcentajeAprobados}%` },
              ].map((s) => (
                <div key={s.label} className="bg-accent-light rounded p-3 text-center">
                  <Star size={18} className="text-accent mx-auto mb-1" />
                  <p className="text-xl font-bold text-on-surface">{s.value}</p>
                  <p className="text-xs text-muted">{s.label}</p>
                </div>
              ))}
            </div>
            {configForm?.publicarResultados === 'manual' && !configForm.resultadosPublicados && (
              <button onClick={handlePublicarResultados} className="w-full mb-3 py-2 bg-accent text-white text-sm font-medium rounded">
                Publicar resultados a tus estudiantes
              </button>
            )}
            <div className="bg-surface-card rounded-card shadow-card overflow-hidden">
              {students.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8 flex items-center justify-center gap-2"><Users size={16} /> Sin estudiantes</p>
              ) : (
                students.map((s, i) => {
                  const sub = submissions[s.id]
                  return (
                    <div key={s.id} className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-outline-variant' : ''}`}>
                      <p className="flex-1 text-sm text-on-surface truncate">{s.apellidoPaterno} {s.apellidoMaterno} {s.nombre}</p>
                      <span className="text-xs text-muted">
                        {!sub ? 'Sin iniciar' : sub.estadoEvaluacion === 'finalizado' ? `${sub.calificacion}/${activity.maxCalif || 10}` : 'En progreso'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
