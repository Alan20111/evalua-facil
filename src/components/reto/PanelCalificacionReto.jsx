// Reto Exprés · etapa 5: aplicar los resultados de UNA competencia como calificación (solo retos de inscritos marcados
// «Calificable»). No inventa un camino nuevo: es el mismo de Participación en vivo (PanelCalificacionVivo).
//
//   · La nota propuesta sale de propuestasCalificacionReto (D7): aciertos ÷ preguntas realizadas × calificación máxima.
//   · El docente revisa, puede corregir cada nota y confirma. Nada se registra sin su confirmación y, por omisión, una
//     nota que ya existe NO se toca (casilla «Reemplazar»).
//   · Escribe en `submissions/{actividad}_{inscripción}` con el guardián de entregas y los mismos campos que la
//     calificación manual de una actividad sin entrega (Observación). Las reglas siguen decidiendo: parcial cerrado,
//     rango de la nota y que el reto sea calificable.
//   · Quien no participó o fue retirado no recibe documento: queda sin nota, como en cualquier actividad.
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import { Button, Checkbox, Input } from '../ui'
import Spinner from '../Spinner'
import { propuestasCalificacionReto } from '../../utils/retoExpres'
import { studentFullName } from '../../utils/studentSearch'
import { submissionDocId } from '../../utils/submissionId'
import { crearSiNoExiste, actualizarSiNoCambio } from '../../utils/submissionGuard'
import { ORIGEN_DOCENTE } from '../../utils/evaluacionGrading'

export default function PanelCalificacionReto({ actividad, resultados, participantes }) {
  const toast = useToast()
  const [estudiantes, setEstudiantes] = useState(null)
  const [entregas, setEntregas] = useState({})
  const [valores, setValores] = useState({})
  const [reemplazar, setReemplazar] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [fallidas, setFallidas] = useState([])
  const maxCalif = actividad?.maxCalif || 10

  const leerEntregas = () => getDocs(query(collection(db, 'submissions'), where('actividadId', '==', actividad.id)))
    .then((sub) => setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }]))))

  useEffect(() => {
    let vivo = true
    Promise.all([
      getDocs(query(collection(db, 'students'), where('asignaturaId', '==', actividad.asignaturaId))),
      getDocs(query(collection(db, 'submissions'), where('actividadId', '==', actividad.id))),
    ]).then(([est, sub]) => {
      if (!vivo) return
      setEstudiantes(Object.fromEntries(est.docs.map((d) => [d.id, { id: d.id, ...d.data() }])))
      setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }])))
    }).catch(() => { if (vivo) { setEstudiantes({}); toast('No se pudieron cargar los estudiantes', 'error') } })
    return () => { vivo = false }
  }, [actividad.id, actividad.asignaturaId, toast])

  const filas = useMemo(() => {
    if (!estudiantes) return []
    return propuestasCalificacionReto({ reto: actividad.reto, maxCalif, resultados, participantes })
      .filter((p) => estudiantes[p.alumnoId]) // dado de baja después de jugar: ya no tiene inscripción
      .map((p) => ({ ...p, estudiante: estudiantes[p.alumnoId], entrega: entregas[p.alumnoId] || null }))
      .sort((a, b) => studentFullName(a.estudiante).localeCompare(studentFullName(b.estudiante), 'es'))
  }, [estudiantes, entregas, actividad.reto, maxCalif, resultados, participantes])

  if (!estudiantes) return <div className="py-4 flex justify-center"><Spinner /></div>

  const valorDe = (f) => valores[f.alumnoId] ?? f.calificacion
  const bloqueada = (f) => f.entrega?.calificacion != null && !reemplazar
  const aplicables = filas.filter((f) => !bloqueada(f) && valorDe(f) !== '' && Number.isFinite(Number(valorDe(f))))

  async function aplicar() {
    setAplicando(true)
    const errores = []
    let hechas = 0
    for (const f of aplicables) {
      const cal = Math.min(maxCalif, Math.max(0, Math.round(Number(valorDe(f)) * 10) / 10))
      try {
        const ref = doc(db, 'submissions', submissionDocId(actividad.id, f.alumnoId))
        if (f.entrega) {
          await actualizarSiNoCambio(db, ref, f.entrega, { calificacion: cal, estado: 'calificado', ultimaCalificacionPor: ORIGEN_DOCENTE })
        } else {
          await crearSiNoExiste(db, ref, {
            actividadId: actividad.id, alumnoId: f.alumnoId, calificacion: cal, comentario: '', estado: 'calificado',
            ultimaCalificacionPor: ORIGEN_DOCENTE, sinEntrega: true, fechaEntrega: serverTimestamp(),
          })
        }
        hechas += 1
      } catch (e) {
        errores.push(`${studentFullName(f.estudiante)}: ${e?.code === 'permission-denied' ? 'el parcial está cerrado o no tienes permiso' : (e?.message || 'no se pudo guardar')}`)
      }
    }
    setAplicando(false)
    setFallidas(errores)
    if (hechas) toast(`${hechas} ${hechas === 1 ? 'calificación aplicada' : 'calificaciones aplicadas'}`)
    leerEntregas().catch(() => {})
  }

  return (
    <section aria-labelledby="reto-calif" className="border-t border-outline-variant pt-4">
      <h3 id="reto-calif" className="text-base font-semibold text-on-surface">Calificación</h3>
      <p className="text-sm text-muted mb-3">
        Propuesta: aciertos entre {resultados.realizadas} {resultados.realizadas === 1 ? 'pregunta realizada' : 'preguntas realizadas'}, sobre {maxCalif}.
        Revisa, corrige si hace falta y confirma. Quien no participó o fue retirado queda sin nota.
      </p>
      {!filas.length ? (
        <p className="text-sm text-muted">Ningún estudiante inscrito tiene resultado en esta competencia.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-medium">Estudiante</th>
                <th className="py-1 pr-3 font-medium">Aciertos</th>
                <th className="py-1 pr-3 font-medium">Nota a aplicar</th>
                <th className="py-1 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.alumnoId} className="border-t border-outline-variant">
                  <td className="py-1.5 pr-3 text-on-surface">{studentFullName(f.estudiante)}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-on-surface">{f.aciertos} / {f.realizadas}</td>
                  <td className="py-1.5 pr-3">
                    <Input size="sm" type="number" min={0} max={maxCalif} step="0.1" inputMode="decimal" aria-label={`Nota de ${studentFullName(f.estudiante)}`}
                      wrapperClassName="w-24" disabled={bloqueada(f)} value={valorDe(f)}
                      onChange={(e) => setValores((v) => ({ ...v, [f.alumnoId]: e.target.value }))} />
                  </td>
                  <td className="py-1.5 text-muted">{f.entrega?.calificacion != null ? `Ya calificada (${f.entrega.calificacion})` : 'Sin nota'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Checkbox id="reto-reemplazar" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} label="Reemplazar notas que ya existen" />
        <Button onClick={aplicar} busy={aplicando} disabled={!aplicables.length || aplicando}>
          {aplicables.length ? `Aplicar ${aplicables.length} ${aplicables.length === 1 ? 'calificación' : 'calificaciones'}` : 'Aplicar calificaciones'}
        </Button>
      </div>
      {fallidas.length > 0 && (
        <ul role="alert" className="mt-3 text-sm text-red-700 list-disc pl-5">
          {fallidas.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </section>
  )
}
