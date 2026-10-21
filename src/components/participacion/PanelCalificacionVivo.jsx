// Calificación formal de una sesión de Participación en vivo (solo si el docente la marcó «Calificable»
// ANTES de iniciar). NO inventa un método de calificación: usa el que ya existe.
//
//   · La propuesta de cada estudiante sale de calificacionPropuestaVivo: opción única contra la clave;
//     abiertas según el puntaje que la IA propuso para su respuesta; cada pregunta vale sus `puntos`.
//   · Como en «Calificar con IA», la IA solo PROPONE: el docente revisa, edita y confirma. Aplicar
//     escribe en `submissions/{actividad}_{inscripción}` por el mismo camino y con las mismas
//     reglas que la calificación manual de una observación (parcial cerrado incluido).
//   · Solo se propone nota a quien se identificó con su sesión de estudiante (modalidad «grupo»).
//     En una sesión externa los resultados son colectivos y aquí no se califica a nadie.
//   · Quien no participó no recibe documento: cuenta como sin nota igual que en cualquier actividad.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import { Button, Checkbox, Input } from '../ui'
import Spinner from '../Spinner'
import { calificacionPropuestaVivo } from '../../utils/participacionVivo'
import { studentFullName } from '../../utils/studentSearch'
import { submissionDocId } from '../../utils/submissionId'
import { crearSiNoExiste, actualizarSiNoCambio } from '../../utils/submissionGuard'
import { ORIGEN_DOCENTE } from '../../utils/evaluacionGrading'

export default function PanelCalificacionVivo({ sesion, actividad, claves, respuestas, asignaturaId }) {
  const toast = useToast()
  const [estudiantes, setEstudiantes] = useState(null)
  const [entregas, setEntregas] = useState({})
  const [valores, setValores] = useState({})
  const [reemplazar, setReemplazar] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const maxCalif = actividad?.maxCalif || 10
  const esGrupo = sesion?.acceso === 'grupo'

  useEffect(() => {
    if (!esGrupo || !asignaturaId) return undefined
    let vivo = true
    Promise.all([
      getDocs(query(collection(db, 'students'), where('asignaturaId', '==', asignaturaId))),
      getDocs(query(collection(db, 'submissions'), where('actividadId', '==', sesion.actividadId))),
    ]).then(([est, sub]) => {
      if (!vivo) return
      setEstudiantes(est.docs.map((d) => ({ id: d.id, ...d.data() })))
      setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }])))
    }).catch(() => { if (vivo) { setEstudiantes([]); toast('No se pudieron cargar los estudiantes', 'error') } })
    return () => { vivo = false }
  }, [esGrupo, asignaturaId, sesion?.actividadId, toast])

  const filas = useMemo(() => {
    if (!estudiantes) return []
    const preguntas = sesion.preguntas || []
    return estudiantes
      .map((e) => {
        const propias = respuestas.filter((r) => r.alumnoId === e.id)
        if (!propias.length) return null
        const p = calificacionPropuestaVivo({ preguntas, claves, respuestas: propias, maxCalif })
        return { estudiante: e, respondidas: propias.length, ...p, entrega: entregas[e.id] || null }
      })
      .filter(Boolean)
      .sort((a, b) => studentFullName(a.estudiante).localeCompare(studentFullName(b.estudiante), 'es'))
  }, [estudiantes, respuestas, sesion, claves, maxCalif, entregas])

  if (!esGrupo) {
    return (
      <section className="rounded-card bg-white/10 border border-white/10 p-4 text-white">
        <h2 className="text-lg font-semibold mb-1">Calificación</h2>
        <p className="text-sm text-white/80">
          Esta sesión fue <strong>externa</strong>: los resultados son colectivos y no se asigna calificación a ningún estudiante,
          porque los participantes no se identificaron con su cuenta. Para calificar, inicia la sesión con acceso «Grupo inscrito».
        </p>
      </section>
    )
  }
  if (!estudiantes) return <div className="py-6 flex justify-center"><Spinner /></div>

  const valorDe = (f) => valores[f.estudiante.id] ?? (f.calificacion ?? '')
  const bloqueadaPorNota = (f) => f.entrega?.calificacion != null && !reemplazar
  const aplicables = filas.filter((f) => !bloqueadaPorNota(f) && valorDe(f) !== '' && Number.isFinite(Number(valorDe(f))))
  const pendientesIA = filas.reduce((a, f) => a + f.sinEvaluar, 0)

  async function aplicar() {
    setAplicando(true)
    const fallidas = []
    let hechas = 0
    for (const f of aplicables) {
      const cal = Math.min(maxCalif, Math.max(0, Math.round(Number(valorDe(f)) * 10) / 10))
      try {
        const ref = doc(db, 'submissions', submissionDocId(sesion.actividadId, f.estudiante.id))
        if (f.entrega) {
          await actualizarSiNoCambio(db, ref, f.entrega, { calificacion: cal, estado: 'calificado', ultimaCalificacionPor: ORIGEN_DOCENTE })
        } else {
          // Mismos campos que la calificación manual de una actividad sin entrega (Observación).
          await crearSiNoExiste(db, ref, {
            actividadId: sesion.actividadId, alumnoId: f.estudiante.id, calificacion: cal, comentario: '', estado: 'calificado',
            ultimaCalificacionPor: ORIGEN_DOCENTE, sinEntrega: true, fechaEntrega: serverTimestamp(),
          })
        }
        hechas += 1
      } catch (e) {
        fallidas.push(`${studentFullName(f.estudiante)}: ${e?.code === 'permission-denied' ? 'el parcial está cerrado o no tienes permiso' : (e?.message || 'no se pudo guardar')}`)
      }
    }
    setAplicando(false)
    setResultado({ hechas, fallidas })
    if (hechas) toast(`${hechas} ${hechas === 1 ? 'calificación aplicada' : 'calificaciones aplicadas'}`)
    // Releer las entregas para que la tabla muestre lo guardado.
    getDocs(query(collection(db, 'submissions'), where('actividadId', '==', sesion.actividadId)))
      .then((sub) => setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }]))))
      .catch(() => {})
  }

  return (
    <section className="rounded-card bg-white/10 border border-white/10 p-4 text-white" aria-label="Calificación propuesta">
      <h2 className="text-lg font-semibold">Calificación propuesta</h2>
      <p className="text-sm text-white/80 mb-3">
        Suma de los puntos de cada respuesta sobre {maxCalif}. La IA solo propone: revisa, edita y confirma. Quien no participó queda sin nota.
      </p>
      {pendientesIA > 0 && (
        <output className="block text-sm text-amber-200 mb-3">
          {pendientesIA} {pendientesIA === 1 ? 'respuesta abierta aún no tiene' : 'respuestas abiertas aún no tienen'} análisis de la IA: esa parte cuenta 0 en la propuesta.
        </output>
      )}
      {!filas.length ? (
        <p className="text-sm text-white/80">Ningún estudiante inscrito respondió en esta sesión.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/80">
                <th className="py-1 pr-3 font-medium">Estudiante</th>
                <th className="py-1 pr-3 font-medium">Respondió</th>
                <th className="py-1 pr-3 font-medium">Propuesta</th>
                <th className="py-1 pr-3 font-medium">Nota a aplicar</th>
                <th className="py-1 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.estudiante.id} className="border-t border-white/10">
                  <td className="py-1.5 pr-3">{studentFullName(f.estudiante)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{f.respondidas}/{sesion.preguntas.length}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{f.calificacion ?? '—'}{!f.completa && <span title="Hay respuestas sin analizar" className="text-amber-300"> *</span>}</td>
                  <td className="py-1.5 pr-3">
                    <Input size="sm" type="number" min={0} max={maxCalif} step="0.1" inputMode="decimal" aria-label={`Nota de ${studentFullName(f.estudiante)}`}
                      wrapperClassName="w-24" disabled={bloqueadaPorNota(f)} value={valorDe(f)}
                      onChange={(e) => setValores((v) => ({ ...v, [f.estudiante.id]: e.target.value }))} />
                  </td>
                  <td className="py-1.5 text-white/80">{f.entrega?.calificacion != null ? `Ya calificada (${f.entrega.calificacion})` : 'Sin nota'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {/* El panel es oscuro: la casilla usa los tokens de texto, así que se le dan los claros solo aquí. */}
        <div style={{ '--on-surface': '#ffffff' }}>
          <Checkbox id="vivo-reemplazar" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} label="Reemplazar notas que ya existen" />
        </div>
        <Button onClick={aplicar} busy={aplicando} disabled={!aplicables.length || aplicando}>
          Aplicar {aplicables.length || ''} {aplicables.length === 1 ? 'calificación' : 'calificaciones'}
        </Button>
      </div>
      {resultado?.fallidas.length > 0 && (
        <ul role="alert" className="mt-3 text-sm text-rose-200 list-disc pl-5">
          {resultado.fallidas.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </section>
  )
}
