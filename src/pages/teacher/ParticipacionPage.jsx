// Participación en vivo · pantalla del docente: revisar y ajustar la dinámica generada, elegir el acceso,
// decidir si es calificable e iniciar la sesión (que se proyecta en PresentacionVivo).
//
//   · Las preguntas las propone la IA y aquí el docente las EDITA (enunciado, opciones, respuesta correcta,
//     criterios, puntos) o las quita. No se crean desde cero: la dinámica siempre se genera con IA.
//   · Las respuestas correctas y los criterios se guardan en `clave/` (el estudiante no las puede leer).
//   · «Calificable» se fija ANTES de iniciar y queda bloqueado cuando ya hubo una sesión. Por defecto no
//     califica, no lleva número ni cuenta en el promedio (sinCalificacion).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'
import { ArrowDown, ArrowLeft, ArrowUp, Play, Presentation, Save, Trash2 } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Button, Card, IconButton, Input, Radio, Select, Switch, Textarea } from '../../components/ui'
import Spinner from '../../components/Spinner'
import ConfirmModal from '../../components/ConfirmModal'
import PresentacionVivo from '../../components/participacion/PresentacionVivo'
import { TEACHER_CONTAINER } from '../../config/layout'
import { ACCESOS_VIVO, PROPOSITOS_VIVO, TIPOS_PREGUNTA_VIVO, VIVO_CFG, sanearPreguntasVivo } from '../../utils/participacionVivo'
import { crearSesionVivo, sesionesDeActividad } from '../../utils/participacionVivoDb'
import { deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { subjectDisplayName } from '../../utils/subjectName'
import { nowIsoLocal } from '../../utils/nowIso'

// Pregunta pública + clave privada → modelo de edición.
function aModeloEdicion(p, clave = {}) {
  return {
    id: p.id, tipo: p.tipo, enunciado: p.enunciado, puntos: p.puntos ?? 1,
    opciones: p.opciones || [], correcta: clave.correcta ?? null,
    criterios: clave.criterios || '', esperada: clave.esperada || '', conceptosTexto: (clave.conceptos || []).join(', '),
  }
}
function deModeloEdicion(m) {
  return {
    id: m.id, tipo: m.tipo, enunciado: m.enunciado, puntos: m.puntos, opciones: m.opciones, correcta: m.correcta,
    criterios: m.criterios, esperada: m.esperada, conceptos: m.conceptosTexto.split(',').map((c) => c.trim()).filter(Boolean),
  }
}

function EditorPregunta({ m, indice, total, bloqueado, onCambio, onMover, onQuitar }) {
  const set = (campo, valor) => onCambio({ ...m, [campo]: valor })
  const setOpcion = (i, texto) => set('opciones', m.opciones.map((o, j) => (j === i ? { ...o, texto } : o)))
  return (
    <Card as="section" aria-label={`Pregunta ${indice + 1}`} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">Pregunta {indice + 1} · {TIPOS_PREGUNTA_VIVO[m.tipo]}</span>
        <span className="ml-auto flex items-center">
          <IconButton size="sm" icon={ArrowUp} label="Subir" disabled={indice === 0} onClick={() => onMover(-1)} />
          <IconButton size="sm" icon={ArrowDown} label="Bajar" disabled={indice === total - 1} onClick={() => onMover(1)} />
          <IconButton size="sm" variant="danger" icon={Trash2} label="Quitar pregunta" disabled={total <= 1} onClick={onQuitar} />
        </span>
      </div>
      <Textarea label="Enunciado" rows={2} autoResize maxLength={VIVO_CFG.MAX_ENUNCIADO} value={m.enunciado} onChange={(e) => set('enunciado', e.target.value)} />

      {m.tipo === 'opcion_unica' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-on-surface mb-1">Opciones <span className="font-normal text-hint">(marca la correcta{bloqueado ? '' : ' si quieres mostrarla o calificar'})</span></legend>
          {m.opciones.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <Radio name={`correcta-${m.id}`} checked={m.correcta === o.id} onChange={() => set('correcta', o.id)} aria-label={`Opción ${i + 1} es la correcta`} />
              <Input aria-label={`Opción ${i + 1}`} wrapperClassName="flex-1" value={o.texto} maxLength={VIVO_CFG.MAX_OPCION} onChange={(e) => setOpcion(i, e.target.value)} />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <Textarea label="Criterios para evaluar las respuestas" rows={2} autoResize maxLength={VIVO_CFG.MAX_CRITERIOS} value={m.criterios} onChange={(e) => set('criterios', e.target.value)}
            hint="La IA evalúa cada respuesta con estos criterios y con tu contenido." />
          <Textarea label="Respuesta esperada (ideas clave)" rows={2} autoResize maxLength={VIVO_CFG.MAX_ESPERADA} value={m.esperada} onChange={(e) => set('esperada', e.target.value)} />
          <Input label="Conceptos a identificar" value={m.conceptosTexto} onChange={(e) => set('conceptosTexto', e.target.value)} hint="Separados por comas. La IA solo clasifica las respuestas con estos conceptos." />
        </>
      )}
      <Input label="Puntos" type="number" min={0.5} max={100} step="0.5" wrapperClassName="max-w-[8rem]" value={m.puntos} onChange={(e) => set('puntos', e.target.value)}
        hint="Solo cuentan si la actividad es calificable." />
    </Card>
  )
}

export default function TeacherParticipacionPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { currentUser } = useAuth()
  const [cargando, setCargando] = useState(true)
  const uid = currentUser?.uid
  const [actividad, setActividad] = useState(null)
  const [asignatura, setAsignatura] = useState(null)
  const [claves, setClaves] = useState({})
  const [sesiones, setSesiones] = useState([])
  const [nombre, setNombre] = useState('')
  const [modelo, setModelo] = useState([])
  const [acceso, setAcceso] = useState('grupo')
  const [calificable, setCalificable] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const [presentando, setPresentando] = useState(null)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)

  const cargar = useCallback(async () => {
    const snap = await getDoc(doc(db, 'activities', activityId))
    if (!snap.exists() || snap.data().categoria !== VIVO_CFG.CATEGORIA || snap.data().docenteId !== uid) {
      navigate('/dashboard', { replace: true }); return
    }
    const act = { id: snap.id, ...snap.data() }
    const [clavesSnap, subjSnap, ses] = await Promise.all([
      getDocs(collection(db, 'activities', activityId, 'clave')),
      getDoc(doc(db, 'subjects', act.asignaturaId)),
      sesionesDeActividad(activityId, uid),
    ])
    const mapa = Object.fromEntries(clavesSnap.docs.filter((d) => d.id !== 'contexto').map((d) => [d.id, d.data()]))
    setActividad(act); setClaves(mapa); setSesiones(ses)
    setAsignatura(subjSnap.exists() ? { id: subjSnap.id, ...subjSnap.data() } : null)
    setNombre(act.nombre || '')
    setModelo((act.participacion?.preguntas || []).map((p) => aModeloEdicion(p, mapa[p.id])))
    setAcceso(act.participacion?.acceso || 'grupo')
    setCalificable(act.participacion?.calificable === true)
  }, [activityId, uid, navigate])

  useEffect(() => {
    if (!uid) return undefined
    let vivo = true
    Promise.resolve().then(cargar)
      .catch(() => { if (vivo) toast('No se pudo cargar la dinámica', 'error') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [uid, cargar, toast])

  const hayActiva = sesiones.find((s) => s.estado === 'activa')
  const yaHuboSesion = sesiones.length > 0
  const sinPreguntas = !modelo.length

  const original = useMemo(() => JSON.stringify({
    n: actividad?.nombre || '', a: actividad?.participacion?.acceso || 'grupo', c: actividad?.participacion?.calificable === true,
    p: (actividad?.participacion?.preguntas || []).map((p) => aModeloEdicion(p, claves[p.id])),
  }), [actividad, claves])
  const sucio = actividad && JSON.stringify({ n: nombre, a: acceso, c: calificable, p: modelo }) !== original

  async function guardar() {
    const norm = sanearPreguntasVivo(modelo.map(deModeloEdicion), { exigirCorrecta: calificable })
    if (!nombre.trim()) { toast('Escribe el nombre de la actividad', 'error'); return false }
    if (!norm.ok) { toast(norm.errores[0], 'error'); return false }
    setGuardando(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'activities', activityId), {
        nombre: nombre.trim(),
        'participacion.preguntas': norm.publicas,
        'participacion.acceso': acceso,
        'participacion.calificable': calificable,
        // No calificable = sin número, fuera del promedio y del acta. Calificable = entra a la numeración normal.
        sinCalificacion: !calificable,
      })
      Object.entries(norm.claves).forEach(([id, c]) => batch.set(doc(db, 'activities', activityId, 'clave', id), c))
      Object.keys(claves).filter((id) => !norm.claves[id]).forEach((id) => batch.delete(doc(db, 'activities', activityId, 'clave', id)))
      await batch.commit()
      await cargar()
      toast('Cambios guardados')
      return true
    } catch (e) {
      toast(e?.code === 'permission-denied' ? 'El parcial está cerrado: no se puede cambiar si cuenta en la calificación' : (e.message || 'No se pudo guardar'), 'error')
      return false
    } finally {
      setGuardando(false)
    }
  }

  async function iniciar() {
    if (sinPreguntas) return
    setIniciando(true)
    try {
      if (sucio && !(await guardar())) return
      // Con acceso «grupo» los estudiantes la encuentran en su lista: una actividad en borrador no se vería.
      if (acceso === 'grupo' && actividad.oculta) {
        await updateDoc(doc(db, 'activities', activityId), { oculta: false, publishAt: null, publishedAt: nowIsoLocal() })
        toast('La actividad se publicó para tus estudiantes')
      }
      const act = (await getDoc(doc(db, 'activities', activityId))).data()
      const codigo = await crearSesionVivo({
        actividadId: activityId, asignaturaId: act.asignaturaId, docenteId: currentUser.uid, titulo: act.nombre,
        proposito: act.participacion.proposito, acceso, calificable, preguntas: act.participacion.preguntas,
      })
      await cargar()
      setPresentando(codigo)
    } catch (e) {
      toast(e?.code === 'permission-denied' ? 'No se pudo iniciar. Si es calificable, revisa que el parcial no esté cerrado.' : (e.message || 'No se pudo iniciar la sesión'), 'error')
    } finally {
      setIniciando(false)
    }
  }

  async function borrar() {
    setConfirmandoBorrar(false)
    try {
      await deleteSubmissionsByActivity(activityId)
      await deleteDoc(doc(db, 'activities', activityId)) // el servidor limpia sesiones, respuestas y claves
      toast('Actividad eliminada')
      navigate(`/subject/${actividad.asignaturaId}`, { replace: true })
    } catch (e) {
      toast(e?.code === 'permission-denied' ? 'El parcial está cerrado: no se puede eliminar una actividad que cuenta' : (e.message || 'No se pudo eliminar'), 'error')
    }
  }

  if (cargando) return <div className="py-16 flex justify-center"><Spinner /></div>
  if (!actividad) return null

  const mover = (i, d) => setModelo((ms) => { const c = [...ms]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c })

  return (
    <div className={`${TEACHER_CONTAINER} px-4 py-4 space-y-4`}>
      <div className="flex items-center gap-2">
        <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(`/subject/${actividad.asignaturaId}`)}>{asignatura ? subjectDisplayName(asignatura) : 'Asignatura'}</Button>
        <Button variant="danger-outline" size="sm" icon={Trash2} className="ml-auto" onClick={() => setConfirmandoBorrar(true)}>Eliminar</Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-on-surface">Participación en vivo</h1>
        <p className="text-sm text-muted">{PROPOSITOS_VIVO[actividad.participacion?.proposito] || ''} · Generada con IA · Revisa y ajusta antes de iniciar</p>
      </div>

      {hayActiva && (
        <Card className="flex flex-wrap items-center gap-3 border border-accent">
          <p className="text-sm text-on-surface flex-1">Hay una sesión en curso.</p>
          <Button icon={Presentation} onClick={() => setPresentando(hayActiva.codigo)}>Volver a proyectar</Button>
        </Card>
      )}

      <Input label="Nombre de la actividad" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />

      {sinPreguntas ? (
        <Card>
          <p className="text-sm text-on-surface">Esta dinámica no tiene preguntas: la generación no se completó. Elimínala y crea una nueva con IA; si ya se habían descontado créditos, recarga esta página en un minuto.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {modelo.map((m, i) => (
            <EditorPregunta key={m.id} m={m} indice={i} total={modelo.length} bloqueado={calificable}
              onCambio={(nuevo) => setModelo((ms) => ms.map((x, j) => (j === i ? nuevo : x)))}
              onMover={(d) => mover(i, d)} onQuitar={() => setModelo((ms) => ms.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      <Card className="space-y-4">
        <Select label="¿Quién participa?" options={Object.entries(ACCESOS_VIVO).map(([value, label]) => ({ value, label }))} value={acceso} onChange={setAcceso}
          hint={acceso === 'grupo'
            ? 'Tus estudiantes inscritos entran con su cuenta desde su asignatura. Las respuestas quedan ligadas a cada estudiante.'
            : 'Cualquier persona entra con un QR o enlace, sin cuenta (incluidos tus estudiantes, pero sin asociarse a su cuenta). Los resultados son anónimos.'} />
        <Switch label="Calificable" checked={calificable} disabled={yaHuboSesion || guardando} onChange={setCalificable}
          hint={yaHuboSesion
            ? 'Ya hubo una sesión: este ajuste quedó fijo para que todas las respuestas se evalúen con el mismo criterio.'
            : 'Desactivado: solo participación, sin nota ni número. Activado: se registra como actividad evaluable de la asignatura y la nota la confirmas tú.'} />
        {calificable && acceso === 'externo' && (
          <p role="note" className="text-sm text-amber-800 bg-amber-50 rounded p-3">
            En modalidad externa los participantes no se identifican con su cuenta, así que <strong>no se asignan notas a estudiantes</strong>: solo tendrás resultados colectivos.
            No cambiamos la modalidad por ti; para calificar elige «Grupo inscrito».
          </p>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-6">
        <Button variant="secondary" icon={Save} disabled={!sucio || guardando || sinPreguntas} busy={guardando} onClick={guardar}>Guardar cambios</Button>
        <Button icon={Play} busy={iniciando} disabled={sinPreguntas || iniciando || !!hayActiva} onClick={iniciar}>Iniciar participación</Button>
      </div>

      {yaHuboSesion && (
        <section aria-label="Sesiones anteriores" className="space-y-2 pb-8">
          <h2 className="text-base font-semibold text-on-surface">Sesiones</h2>
          {sesiones.map((s) => (
            <Card key={s.codigo} padding="sm" className="flex items-center gap-3">
              <span className="text-sm text-on-surface flex-1">
                {s.creadaEn?.toDate?.().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) || '—'} · {ACCESOS_VIVO[s.acceso]} · {s.estado === 'activa' ? 'En curso' : 'Finalizada'}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPresentando(s.codigo)}>{s.estado === 'activa' ? 'Proyectar' : 'Ver resultados'}</Button>
            </Card>
          ))}
        </section>
      )}

      {presentando && (
        <PresentacionVivo codigo={presentando} actividad={actividad} claves={claves} docenteId={currentUser.uid}
          asignaturaNombre={asignatura ? subjectDisplayName(asignatura) : ''}
          onCerrar={() => { setPresentando(null); cargar().catch(() => {}) }} />
      )}
      {confirmandoBorrar && (
        <ConfirmModal title="¿Eliminar esta actividad?" message="Se borrarán sus preguntas, sesiones, respuestas y calificaciones. No se puede deshacer."
          confirmLabel="Eliminar" danger onConfirm={borrar} onCancel={() => setConfirmandoBorrar(false)} />
      )}
    </div>
  )
}
