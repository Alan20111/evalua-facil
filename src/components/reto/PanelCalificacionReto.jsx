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
//
// Estado de la asignación (6-nov-2026): cada entrega escrita aquí lleva `retoAplicacion: { sesionId, aplicadaEn }` (hora
// del servidor). El estado (pendiente / completada / incompleta) se deduce SOLO de lo guardado (estadoAplicacionReto),
// así que se ve igual al recargar. No hay duplicados posibles: el id de la entrega es fijo y crear falla si ya existe.
// Las escrituras van de POR_TANDA en POR_TANDA, cada una con tiempo límite, y el botón siempre se libera (finally).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import { collection, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import { Badge, Button, Checkbox, Input } from '../ui'
import Spinner from '../Spinner'
import { ICONO } from '../../config/iconos'
import { estadoAplicacionReto, propuestasCalificacionReto } from '../../utils/retoExpres'
import { studentFullName } from '../../utils/studentSearch'
import { submissionDocId } from '../../utils/submissionId'
import { crearSiNoExiste, actualizarSiNoCambio } from '../../utils/submissionGuard'
import { ORIGEN_DOCENTE } from '../../utils/evaluacionGrading'

const POR_TANDA = 5 // escrituras a la vez
const LIMITE_MS = 20000 // por estudiante: pasado esto se reporta y se puede reintentar
const AVISO_LENTO_MS = 10000 // «Sigue en proceso…»

const fechaHora = (ms) => new Date(ms).toLocaleString('es-MX', {
  day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
})

function conLimite(promesa) {
  let id
  const limite = new Promise((_, no) => { id = setTimeout(() => no(Object.assign(new Error('tiempo'), { code: 'tiempo-agotado' })), LIMITE_MS) })
  return Promise.race([promesa, limite]).finally(() => clearTimeout(id))
}

function motivoError(e) {
  if (e?.code === 'permission-denied') return 'el parcial está cerrado o no tienes permiso'
  if (e?.code === 'tiempo-agotado') return 'no respondió a tiempo (pudo guardarse: revisa y reintenta)'
  if (e?.code === 'unavailable') return 'sin conexión con el servidor'
  if (e?.name === 'EntregaCambio') return e.message.toLowerCase()
  return e?.message || 'no se pudo guardar'
}

export default function PanelCalificacionReto({ actividad, resultados, participantes, sesionId }) {
  const toast = useToast()
  const [estudiantes, setEstudiantes] = useState(null)
  const [entregas, setEntregas] = useState({})
  const [valores, setValores] = useState({})
  const [reemplazar, setReemplazar] = useState(false)
  const [progreso, setProgreso] = useState(null) // { hechas, total, lento } mientras se aplica
  const [fallidas, setFallidas] = useState([])
  const vivo = useRef(true)
  const enCurso = useRef(false) // un doble clic llega antes del siguiente render
  const maxCalif = actividad?.maxCalif || 10
  const codigo = sesionId || resultados?.sesionId || null

  const leerEntregas = useCallback(() => getDocs(query(collection(db, 'submissions'), where('actividadId', '==', actividad.id)))
    .then((sub) => { if (vivo.current) setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }]))) }), [actividad.id])

  useEffect(() => {
    vivo.current = true
    Promise.all([
      getDocs(query(collection(db, 'students'), where('asignaturaId', '==', actividad.asignaturaId))),
      getDocs(query(collection(db, 'submissions'), where('actividadId', '==', actividad.id))),
    ]).then(([est, sub]) => {
      if (!vivo.current) return
      setEstudiantes(Object.fromEntries(est.docs.map((d) => [d.id, { id: d.id, ...d.data() }])))
      setEntregas(Object.fromEntries(sub.docs.map((d) => [d.data().alumnoId, { id: d.id, ...d.data() }])))
    }).catch(() => { if (vivo.current) { setEstudiantes({}); toast('No se pudieron cargar los estudiantes', 'error') } })
    return () => { vivo.current = false }
  }, [actividad.id, actividad.asignaturaId, toast])

  const filas = useMemo(() => {
    if (!estudiantes) return []
    return propuestasCalificacionReto({ reto: actividad.reto, maxCalif, resultados, participantes })
      .filter((p) => estudiantes[p.alumnoId]) // dado de baja después de jugar: ya no tiene inscripción
      .map((p) => ({ ...p, estudiante: estudiantes[p.alumnoId], entrega: entregas[p.alumnoId] || null }))
      .sort((a, b) => studentFullName(a.estudiante).localeCompare(studentFullName(b.estudiante), 'es'))
  }, [estudiantes, entregas, actividad.reto, maxCalif, resultados, participantes])

  if (!estudiantes) return <div className="py-4 flex justify-center"><Spinner /></div>

  const aplicando = progreso != null
  const valorDe = (f) => valores[f.alumnoId] ?? f.calificacion
  const bloqueada = (f) => f.entrega?.calificacion != null && !reemplazar
  const aplicables = filas.filter((f) => !bloqueada(f) && valorDe(f) !== '' && Number.isFinite(Number(valorDe(f))))
  const registro = estadoAplicacionReto({ filas, sesionId: codigo })
  const conError = fallidas.length > 0
  const deEstaSesion = (f) => codigo && f.entrega?.retoAplicacion?.sesionId === codigo

  async function aplicarUna(f) {
    const cal = Math.min(maxCalif, Math.max(0, Math.round(Number(valorDe(f)) * 10) / 10))
    const marca = { sesionId: codigo, aplicadaEn: serverTimestamp() }
    const ref = doc(db, 'submissions', submissionDocId(actividad.id, f.alumnoId))
    if (f.entrega) {
      await actualizarSiNoCambio(db, ref, f.entrega, { calificacion: cal, estado: 'calificado', ultimaCalificacionPor: ORIGEN_DOCENTE, retoAplicacion: marca })
    } else {
      await crearSiNoExiste(db, ref, {
        actividadId: actividad.id, alumnoId: f.alumnoId, calificacion: cal, comentario: '', estado: 'calificado',
        ultimaCalificacionPor: ORIGEN_DOCENTE, sinEntrega: true, fechaEntrega: serverTimestamp(), retoAplicacion: marca,
      })
    }
  }

  async function aplicar() {
    if (enCurso.current || !aplicables.length) return
    enCurso.current = true
    const lista = [...aplicables]
    const errores = []
    let hechas = 0
    setFallidas([])
    setProgreso({ hechas: 0, total: lista.length, lento: false })
    const aviso = setTimeout(() => { if (vivo.current) setProgreso((p) => (p ? { ...p, lento: true } : p)) }, AVISO_LENTO_MS)
    try {
      for (let i = 0; i < lista.length; i += POR_TANDA) {
        await Promise.all(lista.slice(i, i + POR_TANDA).map(async (f) => {
          try {
            await conLimite(aplicarUna(f))
            hechas += 1
          } catch (e) {
            errores.push(`${studentFullName(f.estudiante)}: ${motivoError(e)}`)
          }
          if (vivo.current) setProgreso((p) => (p ? { ...p, hechas: p.hechas + 1 } : p))
        }))
      }
    } finally {
      clearTimeout(aviso)
      enCurso.current = false
      // Lo que se muestra después sale de lo guardado, no de lo que creímos escribir.
      await leerEntregas().catch(() => {})
      if (vivo.current) {
        setProgreso(null)
        setFallidas(errores)
        if (hechas && !errores.length) toast(`${hechas} ${hechas === 1 ? 'calificación aplicada' : 'calificaciones aplicadas'}`)
        if (errores.length) toast(`${errores.length} ${errores.length === 1 ? 'calificación no se pudo aplicar' : 'calificaciones no se pudieron aplicar'}`, 'error')
      }
    }
  }

  let aviso = null
  if (aplicando) {
    aviso = (
      <output className="flex items-center gap-2 rounded-card bg-surface px-3 py-2 text-sm text-on-surface">
        <Spinner size="sm" />
        <span>Aplicando calificaciones: {progreso.hechas} de {progreso.total}.{progreso.lento ? ' Sigue en proceso, no cierres esta ventana.' : ''}</span>
      </output>
    )
  } else if (conError || registro.estado === 'incompleta') {
    aviso = (
      <div role="alert" className="rounded-card bg-red-50 px-3 py-2 text-sm text-red-800 space-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={ICONO.sm} aria-hidden="true" />
          {conError
            ? `Error en la asignación: ${fallidas.length} ${fallidas.length === 1 ? 'no se pudo aplicar' : 'no se pudieron aplicar'}.`
            : `Asignación incompleta: se aplicaron ${registro.aplicadas} y ${registro.pendientes === 1 ? 'falta 1' : `faltan ${registro.pendientes}`} sin nota.`}
        </p>
        {fallidas.length > 0 && (
          <ul className="list-disc pl-5">{fallidas.map((m) => <li key={m}>{m}</li>)}</ul>
        )}
        <p>Al reintentar solo se aplican las que faltan; las ya guardadas no se duplican.</p>
      </div>
    )
  } else if (registro.estado === 'completada') {
    aviso = (
      <output className="flex items-start gap-2 rounded-card bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 size={ICONO.sm} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
        <span>
          <strong>Asignación completada</strong>: {registro.aplicadas} {registro.aplicadas === 1 ? 'calificación' : 'calificaciones'}
          {registro.aplicadaEnMs != null ? ` el ${fechaHora(registro.aplicadaEnMs)}` : ''}{registro.aplicadaEnMs != null && fechaHora(registro.aplicadaEnMs).endsWith('.') ? '' : '.'}
          {registro.conNotaPrevia > 0 ? ` ${registro.conNotaPrevia} ya tenían nota y no se tocaron.` : ''}
        </span>
      </output>
    )
  }

  const estadoBadge = aplicando ? <Badge tone="accent">Aplicando…</Badge>
    : conError || registro.estado === 'incompleta' ? <Badge tone="danger">Error en la asignación</Badge>
      : registro.estado === 'completada' ? <Badge tone="success">Asignación completada</Badge>
        : <Badge>Pendiente</Badge>

  return (
    <section aria-labelledby="reto-calif" className="border-t border-outline-variant pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="reto-calif" className="text-base font-semibold text-on-surface">Calificación</h3>
        {estadoBadge}
      </div>
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
                      wrapperClassName="w-24" disabled={bloqueada(f) || aplicando} value={valorDe(f)}
                      onChange={(e) => setValores((v) => ({ ...v, [f.alumnoId]: e.target.value }))} />
                  </td>
                  <td className="py-1.5 text-muted">
                    {f.entrega?.calificacion != null
                      ? (deEstaSesion(f) ? `Aplicada (${f.entrega.calificacion})` : `Ya calificada (${f.entrega.calificacion})`)
                      : 'Sin nota'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aviso && <div className="mt-3">{aviso}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Checkbox id="reto-reemplazar" checked={reemplazar} disabled={aplicando} onChange={(e) => setReemplazar(e.target.checked)} label="Reemplazar notas que ya existen" />
        <Button onClick={aplicar} busy={aplicando} disabled={!aplicables.length || aplicando}
          icon={!aplicando && (conError || registro.estado === 'incompleta') ? RotateCcw : undefined}>
          {aplicando ? 'Aplicando…'
            : (conError || registro.estado === 'incompleta') && aplicables.length ? `Reintentar ${aplicables.length} ${aplicables.length === 1 ? 'calificación' : 'calificaciones'}`
              : aplicables.length ? `Aplicar ${aplicables.length} ${aplicables.length === 1 ? 'calificación' : 'calificaciones'}` : 'Aplicar calificaciones'}
        </Button>
      </div>
    </section>
  )
}
