// Reto Exprés · pantalla del docente para ARMAR el reto (etapa 2): datos, y las 10 preguntas — con IA (operación
// `reactivos`, 1 crédito por reactivo entregado), desde el banco o desde cuestionarios y exámenes de la asignatura, o
// a mano. Etapa 4: «Iniciar competencia» (con las 10 preguntas) abre la pantalla en vivo, y «Competencias» guarda las
// sesiones jugadas con sus resultados. Especificación: docs/RETO_EXPRES.md.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { ArrowDown, ArrowLeft, ArrowUp, Library, Pencil, Play, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Checkbox, IconButton, Input, RadioGroup, Select, Switch, Textarea } from '../../components/ui'
import ConfirmModal from '../../components/ConfirmModal'
import ConfirmacionCreditosModal from '../../components/ConfirmacionCreditosModal'
import ReactivosIAReview from '../../components/evaluacion/ReactivosIAReview'
import FuentesIAInput from '../../components/ia/FuentesIAInput'
import EditorPreguntaReto from '../../components/reto/EditorPreguntaReto'
import { OPCIONES_TIEMPO_RETO } from '../../components/reto/opcionesReto'
import ImportarReactivosReto from '../../components/reto/ImportarReactivosReto'
import HistorialRetoSesiones from '../../components/reto/HistorialRetoSesiones'
import { EsqueletoRetoDocente } from '../../components/esqueletos'
import useCreditosIA from '../../hooks/useCreditosIA'
import useFuentesAsignatura from '../../hooks/useFuentesAsignatura'
import { avisarFuentesOmitidas, resolverFuentes } from '../../utils/fuentesIA'
import { reactivosDesdePropuesta } from '../../utils/reactivosIA'
import { subjectDisplayName } from '../../utils/subjectName'
import { TEACHER_CONTAINER } from '../../config/layout'
import {
  MODALIDADES_RETO, MOTIVOS_INCOMPATIBLE, RETO_CFG, TIEMPO_POR_OMISION_SEG, duracionTotalMs, duracionValida, duracionesIguales, estadoPreguntasReto,
  preguntaRetoDesdePropuestaIA, puedeFinalizar, preguntaRetoDesdeReactivo, reactivoCompatibleReto, textoDuracion, tiempoRespuestaMs,
} from '../../utils/retoExpres'
import {
  agregarPreguntas, aplicarTiempoATodas, cargarReto, controlarReto, crearSesionReto, editarPregunta, guardarDatosReto, intercambiarOrden, quitarPregunta, sesionesDeReto,
} from '../../utils/retoExpresDb'

// Tiempo por omisión del reto: el guardado si es válido; si no (retos anteriores a esta opción), 20 s.
const tiempoDelReto = (actividad) => (duracionValida(actividad?.reto?.tiempoSeg) ? actividad.reto.tiempoSeg : TIEMPO_POR_OMISION_SEG)

const MIN_QUIERE_EVALUAR = 40 // mismo mínimo que exige el servidor para `reactivos`
const TIPOS_IA = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
]
const OPCIONES_IDENTIDAD = [
  { value: 'nombre', label: 'Nombre real' },
  { value: 'alias', label: 'Alias' },
]

function siguienteOrden(preguntas) {
  return preguntas.reduce((m, p) => Math.max(m, Number.isInteger(p.orden) ? p.orden : 0), 0) + 1
}

function TarjetaPregunta({ p, i, total, onEditar, onQuitar, onMover }) {
  const compat = reactivoCompatibleReto(p)
  return (
    <li className="rounded-card border border-outline-variant p-3">
      <div className="flex items-start gap-2">
        <span className="text-sm font-semibold text-accent flex-shrink-0">{i + 1}.</span>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-base text-on-surface break-words">{p.enunciado}</p>
          <p className="text-xs text-hint">Tiempo: {textoDuracion(tiempoRespuestaMs(p) / 1000)}</p>
          <ul className="text-sm text-muted space-y-0.5">
            {(p.opciones || []).map((o) => (
              <li key={o.id} className={o.id === p.respuestaCorrecta ? 'text-emerald-700 font-medium' : undefined}>
                {o.id === p.respuestaCorrecta ? '✓ ' : '· '}{o.texto}
              </li>
            ))}
          </ul>
          {!compat.ok && <p role="alert" className="text-sm text-red-600">{MOTIVOS_INCOMPATIBLE[compat.motivo] || 'Revisa esta pregunta'}</p>}
        </div>
        <div className="flex items-center flex-shrink-0">
          <IconButton icon={ArrowUp} label="Subir" disabled={i === 0} onClick={() => onMover(i, -1)} />
          <IconButton icon={ArrowDown} label="Bajar" disabled={i === total - 1} onClick={() => onMover(i, 1)} />
          <IconButton icon={Pencil} label="Editar pregunta" onClick={onEditar} />
          <IconButton icon={Trash2} label="Quitar pregunta" onClick={onQuitar} />
        </div>
      </div>
    </li>
  )
}

export default function RetoPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const creditosIA = useCreditosIA()

  const [cargando, setCargando] = useState(true)
  const [actividad, setActividad] = useState(null)
  const [asignatura, setAsignatura] = useState(null)
  const [preguntas, setPreguntas] = useState([])
  const [datos, setDatos] = useState({ nombre: '', instrucciones: '', modoIdentidad: 'nombre', calificable: false, tiempoSeg: TIEMPO_POR_OMISION_SEG, aleatorizar: false })
  const [aplicandoTiempo, setAplicandoTiempo] = useState(false)
  const [guardandoDatos, setGuardandoDatos] = useState(false)
  const [editor, setEditor] = useState(null) // { pregunta } | { pregunta: null } para nueva
  const [importando, setImportando] = useState(false)
  const [quitando, setQuitando] = useState(null)
  const [iaConfig, setIaConfig] = useState(null) // { quiereEvaluar, cantidad, tipos, mismoTema }
  const [iaTrabajando, setIaTrabajando] = useState(false)
  const [iaPropuesta, setIaPropuesta] = useState(null)
  const [iaArchivos, setIaArchivos] = useState([]) // material de referencia (PDF o Word), como en crear examen
  const [sesiones, setSesiones] = useState(null) // null = cargando
  const [iniciando, setIniciando] = useState(false)
  const [versionSesiones, setVersionSesiones] = useState(0)

  const uid = currentUser?.uid
  // Archivos ya guardados en Fuentes de la Asignatura: se reutilizan sin subir otra copia (FuentesIAInput).
  const fuentesGuardadas = useFuentesAsignatura(actividad?.asignaturaId, uid)
  useEffect(() => {
    if (!uid) return undefined
    let vigente = true
    sesionesDeReto(activityId, uid)
      .then(async (lista) => {
        // Una competencia que terminó sola sin nadie mirando sigue «en curso» hasta que alguien pide su registro
        // definitivo (T7). Se pide aquí; el servidor decide con su reloj (si aún no toca, responde que sigue en curso).
        const pendientes = lista.filter((s) => s.estado !== 'finalizada' && puedeFinalizar(s, Date.now()))
        if (!pendientes.length) return lista
        await Promise.all(pendientes.map((s) => controlarReto(s.codigo, 'finalizar').catch(() => null)))
        return sesionesDeReto(activityId, uid)
      })
      .then((s) => { if (vigente) setSesiones(s) })
      .catch(() => { if (vigente) setSesiones([]) })
    return () => { vigente = false }
  }, [activityId, uid, versionSesiones])

  useEffect(() => {
    let vigente = true
    cargarReto(activityId)
      .then((r) => {
        if (!vigente) return
        if (r?.noEsReto) { navigate(`/activity/${activityId}`, { replace: true }); return }
        if (r) {
          setActividad(r.actividad)
          setPreguntas(r.preguntas)
          setDatos({
            nombre: r.actividad.nombre || '', instrucciones: r.actividad.instrucciones || '',
            modoIdentidad: r.actividad.reto?.modoIdentidad || 'nombre', calificable: r.actividad.reto?.calificable === true,
            tiempoSeg: tiempoDelReto(r.actividad), aleatorizar: r.actividad.reto?.aleatorizar === true,
          })
          getDoc(doc(db, 'subjects', r.actividad.asignaturaId))
            .then((s) => { if (vigente) setAsignatura(s.exists() ? { id: s.id, ...s.data() } : null) })
            .catch(() => {})
        }
        setCargando(false)
      })
      .catch((e) => {
        if (!vigente) return
        toast(e.message || 'No se pudo cargar el reto', 'error')
        setCargando(false)
      })
    return () => { vigente = false }
  }, [activityId, navigate, toast])

  if (cargando) return <EsqueletoRetoDocente />
  if (!actividad) {
    return <div className={`${TEACHER_CONTAINER} px-4 py-4`}><p className="text-base text-muted">Este reto no existe o ya fue eliminado.</p></div>
  }

  const externo = actividad.reto?.modalidad === 'externo'
  const estado = estadoPreguntasReto(preguntas)
  const original = { nombre: actividad.nombre || '', instrucciones: actividad.instrucciones || '', modoIdentidad: actividad.reto?.modoIdentidad || 'nombre', calificable: actividad.reto?.calificable === true, tiempoSeg: tiempoDelReto(actividad), aleatorizar: actividad.reto?.aleatorizar === true }
  const tiempoReto = tiempoDelReto(actividad)
  // ¿Alguna pregunta tiene un tiempo distinto del elegido? Entonces tiene sentido «Aplicar a todas».
  const tiemposDistintos = preguntas.some((p) => tiempoRespuestaMs(p) !== datos.tiempoSeg * 1000)
  // Orden aleatorio (6-nov-2026): solo con TODAS las preguntas del mismo tiempo (el servidor lo vuelve a comprobar).
  const mismoTiempo = duracionesIguales(preguntas)
  const duracionAprox = preguntas.length ? Math.ceil(duracionTotalMs({ totalPreguntas: preguntas.length, preguntas }) / 60000) : 0
  const sucio = JSON.stringify(datos) !== JSON.stringify(original)

  async function guardarDatos() {
    setGuardandoDatos(true)
    try {
      const cambios = externo
        ? { nombre: datos.nombre, instrucciones: datos.instrucciones, tiempoSeg: datos.tiempoSeg, aleatorizar: datos.aleatorizar }
        : { nombre: datos.nombre, instrucciones: datos.instrucciones, modoIdentidad: datos.modoIdentidad, calificable: datos.calificable, tiempoSeg: datos.tiempoSeg, aleatorizar: datos.aleatorizar }
      const patch = await guardarDatosReto(actividad, cambios)
      setActividad((a) => ({
        ...a, ...('nombre' in patch && { nombre: patch.nombre }), ...('instrucciones' in patch && { instrucciones: patch.instrucciones }),
        ...('sinCalificacion' in patch && { sinCalificacion: patch.sinCalificacion }),
        reto: { ...a.reto, ...('reto.modoIdentidad' in patch && { modoIdentidad: patch['reto.modoIdentidad'] }), ...('reto.calificable' in patch && { calificable: patch['reto.calificable'] }),
          ...('reto.tiempoSeg' in patch && { tiempoSeg: patch['reto.tiempoSeg'] }), ...('reto.aleatorizar' in patch && { aleatorizar: patch['reto.aleatorizar'] }) },
      }))
      toast('Datos del reto guardados')
    } catch (e) {
      toast(e?.code === 'permission-denied' ? 'No se pudo guardar: revisa que el parcial no esté cerrado.' : (e.message || 'No se pudieron guardar los datos'), 'error')
    } finally {
      setGuardandoDatos(false)
    }
  }

  // «Aplicar a todas»: el tiempo elegido en Datos del reto pasa a todas las preguntas que ya tiene.
  async function aplicarTiempo() {
    setAplicandoTiempo(true)
    try {
      await aplicarTiempoATodas(activityId, preguntas, datos.tiempoSeg)
      setPreguntas((ps) => ps.map((p) => ({ ...p, tiempoSeg: datos.tiempoSeg })))
      toast(`Todas las preguntas tienen ${textoDuracion(datos.tiempoSeg)} para responder`)
    } catch (e) {
      toast(e.message || 'No se pudo cambiar el tiempo', 'error')
    } finally {
      setAplicandoTiempo(false)
    }
  }

  async function guardarPregunta(datosPregunta) {
    try {
      if (editor?.pregunta) {
        const base = preguntaRetoDesdeReactivo(datosPregunta, { orden: editor.pregunta.orden, tiempoSeg: datosPregunta.tiempoSeg })
        await editarPregunta(activityId, editor.pregunta.id, base)
        setPreguntas((ps) => ps.map((p) => (p.id === editor.pregunta.id ? { ...p, ...base } : p)))
      } else {
        const nueva = preguntaRetoDesdeReactivo(datosPregunta, { orden: siguienteOrden(preguntas), tiempoSeg: datosPregunta.tiempoSeg })
        setPreguntas(await agregarPreguntas(activityId, preguntas, [nueva]))
      }
      setEditor(null)
      toast('Pregunta guardada')
    } catch (e) {
      toast(e.message || 'No se pudo guardar la pregunta', 'error')
    }
  }

  async function confirmarQuitar() {
    const p = quitando
    setQuitando(null)
    try {
      const restantes = preguntas.filter((x) => x.id !== p.id)
      await quitarPregunta(activityId, p.id, restantes.length)
      setPreguntas(restantes)
    } catch (e) {
      toast(e.message || 'No se pudo quitar la pregunta', 'error')
    }
  }

  async function mover(i, d) {
    const a = preguntas[i]
    const b = preguntas[i + d]
    if (!a || !b) return
    const ordenA = Number.isInteger(a.orden) ? a.orden : i + 1
    const ordenB = Number.isInteger(b.orden) ? b.orden : i + d + 1
    try {
      await intercambiarOrden(activityId, { ...a, orden: ordenA }, { ...b, orden: ordenB })
      setPreguntas((ps) => {
        const c = [...ps]
        c[i] = { ...b, orden: ordenA }
        c[i + d] = { ...a, orden: ordenB }
        return c
      })
    } catch (e) {
      toast(e.message || 'No se pudo cambiar el orden', 'error')
    }
  }

  async function importar(seleccion) {
    let orden = siguienteOrden(preguntas)
    const nuevas = seleccion.map(({ reactivo, deBanco }) => preguntaRetoDesdeReactivo(reactivo, { orden: orden++, origenBancoId: deBanco ? reactivo.id : null, tiempoSeg: tiempoReto })).filter(Boolean)
    try {
      setPreguntas(await agregarPreguntas(activityId, preguntas, nuevas))
      setImportando(false)
      toast(`${nuevas.length} ${nuevas.length === 1 ? 'reactivo agregado' : 'reactivos agregados'} al reto`)
    } catch (e) {
      toast(e.message || 'No se pudieron agregar los reactivos', 'error')
    }
  }

  function abrirIA() {
    setIaConfig({ quiereEvaluar: '', cantidad: estado.faltan, tipos: TIPOS_IA.map((t) => t.value), mismoTema: preguntas.length > 0 })
    setIaArchivos([])
  }
  const usarMismoTema = !!iaConfig?.mismoTema && preguntas.length > 0
  const iaValida = !!iaConfig && iaConfig.tipos.length > 0 && iaConfig.cantidad >= 1 && iaConfig.cantidad <= estado.faltan &&
    // Texto, archivos o ambos: con al menos un archivo, describir el contenido es opcional.
    (usarMismoTema || iaArchivos.length > 0 || iaConfig.quiereEvaluar.trim().length >= MIN_QUIERE_EVALUAR)

  async function generarConIA() {
    setIaTrabajando(true)
    try {
      // Los archivos se suben ANTES de llamar a la IA: si la subida falla, no hay llamada ni cobro.
      const fuentes = iaArchivos.length ? await resolverFuentes(iaArchivos) : []
      const r = await creditosIA.ejecutar('reactivos', {
        actividadId: activityId,
        asignaturaId: actividad.asignaturaId,
        asignaturaNombre: asignatura ? subjectDisplayName(asignatura) : '',
        tema: '',
        quiereEvaluar: usarMismoTema ? '' : iaConfig.quiereEvaluar,
        cantidad: iaConfig.cantidad,
        tipos: iaConfig.tipos,
        mismoTema: usarMismoTema,
        reactivosExistentes: usarMismoTema ? preguntas.map((p) => ({ tipo: p.tipo, enunciado: p.enunciado })) : [],
        ...(fuentes.length ? { fuentes } : {}),
      }, iaConfig.cantidad, fuentes.length ? { timeoutMs: 240000 } : undefined) // leer documentos tarda más (como crear examen)
      // Un documento que no se pudo usar no detiene la generación, pero se avisa.
      avisarFuentesOmitidas(toast, r?.resultado?.avisos)
      setIaPropuesta(reactivosDesdePropuesta(r?.resultado, iaConfig.cantidad))
      setIaConfig(null)
      setIaArchivos([])
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setIaTrabajando(false)
    }
  }

  // Una sola competencia sin finalizar por reto (T6): si hay una, se continúa; si no, se crea con las 10 preguntas.
  const abierta = (sesiones || []).find((s) => s.estado !== 'finalizada') || null
  async function iniciarCompetencia() {
    if (abierta) { navigate(`/reto/${activityId}/en-vivo/${abierta.codigo}`); return }
    setIniciando(true)
    try {
      const { codigo } = await crearSesionReto(activityId)
      navigate(`/reto/${activityId}/en-vivo/${codigo}`)
    } catch (e) {
      toast(e.message || 'No se pudo iniciar la competencia', 'error')
      if (e.codigo === 'SESION_ABIERTA') setVersionSesiones((v) => v + 1)
    } finally {
      setIniciando(false)
    }
  }

  async function guardarPropuesta(items) {
    let orden = siguienteOrden(preguntas)
    const nuevas = items.map((it) => preguntaRetoDesdePropuestaIA(it, { orden: orden++, tiempoSeg: tiempoReto })).filter(Boolean)
    const omitidas = items.length - nuevas.length
    const caben = nuevas.slice(0, Math.max(0, RETO_CFG.TOTAL_PREGUNTAS - preguntas.length))
    try {
      setPreguntas(await agregarPreguntas(activityId, preguntas, caben))
      setIaPropuesta(null)
      toast(`${caben.length} ${caben.length === 1 ? 'pregunta agregada' : 'preguntas agregadas'}${omitidas ? ` · ${omitidas} sin una opción correcta con texto no se agregaron` : ''}`)
    } catch (e) {
      toast(e.message || 'No se pudieron agregar las preguntas', 'error')
    }
  }

  return (
    <>
      <div data-esq="reto-contenedor" className={`${TEACHER_CONTAINER} px-4 py-4 space-y-4`}>
        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(`/subject/${actividad.asignaturaId}`)}>
            {asignatura ? subjectDisplayName(asignatura) : 'Asignatura'}
          </Button>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-on-surface">{actividad.nombre || 'Reto Exprés'}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge tone="accent">Reto Exprés</Badge>
            <Badge>{externo ? MODALIDADES_RETO.externo : MODALIDADES_RETO.inscritos}</Badge>
            {!externo && <Badge>{actividad.reto?.calificable ? 'Calificable' : 'Sin calificación'}</Badge>}
          </div>
        </div>

        <section data-esq="reto-datos" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="reto-datos">
          <h2 id="reto-datos" className="text-lg font-semibold text-on-surface">Datos del reto</h2>
          <Input label="Nombre" value={datos.nombre} maxLength={120} onChange={(e) => setDatos((d) => ({ ...d, nombre: e.target.value }))} required />
          <Textarea label="Instrucciones para los participantes" optional rows={2} autoResize maxLength={1000} value={datos.instrucciones}
            onChange={(e) => setDatos((d) => ({ ...d, instrucciones: e.target.value }))} />
          {externo ? (
            <p role="note" className="text-sm text-muted">
              Reto externo: entran con un código QR, siempre con alias, y nunca cuenta como calificación. No se muestra a tus estudiantes inscritos.
            </p>
          ) : (
            <>
              <RadioGroup label="¿Cómo se identifican?" name="reto-identidad-edicion" options={OPCIONES_IDENTIDAD} value={datos.modoIdentidad}
                onChange={(v) => setDatos((d) => ({ ...d, modoIdentidad: v }))} />
              {RETO_CFG.CALIFICABLE_DISPONIBLE && (
                <Switch label="Calificable" checked={datos.calificable} onChange={(v) => setDatos((d) => ({ ...d, calificable: v }))}
                  hint={datos.calificable ? 'Podrás aplicar el resultado como calificación al terminar; nada se registra sin tu confirmación.' : 'Solo práctica: sin número ni promedio.'} />
              )}
            </>
          )}
          <div className="space-y-2">
            <Select label="Tiempo por pregunta" value={datos.tiempoSeg} onChange={(v) => setDatos((d) => ({ ...d, tiempoSeg: Number(v) }))}
              options={OPCIONES_TIEMPO_RETO} hint="Las preguntas nuevas nacen con este tiempo. Cada una puede tener el suyo desde su editor." />
            {preguntas.length > 0 && tiemposDistintos && (
              <Button variant="secondary" size="sm" busy={aplicandoTiempo} onClick={aplicarTiempo}>
                Aplicar {textoDuracion(datos.tiempoSeg)} a todas las preguntas
              </Button>
            )}
          </div>
          <Switch label="Orden aleatorio por participante" checked={datos.aleatorizar && mismoTiempo} disabled={!mismoTiempo}
            onChange={(v) => setDatos((d) => ({ ...d, aleatorizar: v }))}
            hint={!mismoTiempo
              ? 'Solo disponible cuando todas las preguntas tienen el mismo tiempo. Con tiempos distintos, todos reciben tu orden.'
              : datos.aleatorizar
                ? 'Cada participante recibe las mismas preguntas en otro orden, fijo durante toda su competencia. El proyector solo muestra el número de pregunta, el tiempo y cuántos respondieron.'
                : 'Todos reciben las preguntas en tu orden.'} />
          <p className="text-xs text-hint">La modalidad no se puede cambiar. Para usar la otra, crea otro reto.</p>
          <div className="flex justify-end">
            <Button icon={Save} onClick={guardarDatos} busy={guardandoDatos} disabled={!sucio || !datos.nombre.trim()}>Guardar datos</Button>
          </div>
        </section>

        <section data-esq="reto-preguntas" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="reto-preguntas">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="reto-preguntas" className="text-lg font-semibold text-on-surface">Preguntas</h2>
            <Badge tone={estado.completo ? 'success' : 'warning'}>{estado.total} de {RETO_CFG.TOTAL_PREGUNTAS}</Badge>
          </div>
          <p className="text-sm text-muted">
            {estado.completo ? 'El reto tiene sus 10 preguntas.'
              : estado.sobran ? `${estado.sobran === 1 ? 'Sobra' : 'Sobran'} ${estado.sobran}: quita las que no vayas a usar.`
                : `${estado.faltan === 1 ? 'Falta' : 'Faltan'} ${estado.faltan} para completar las 10.`}
            {duracionAprox > 0 && ` Duración aproximada: ${duracionAprox} min${estado.faltan ? ' con las preguntas actuales' : ''}.`}
          </p>
          {preguntas.length > 0 && (
            <ol className="space-y-2">
              {preguntas.map((p, i) => (
                <TarjetaPregunta key={p.id} p={p} i={i} total={preguntas.length}
                  onEditar={() => setEditor({ pregunta: p })} onQuitar={() => setQuitando(p)} onMover={mover} />
              ))}
            </ol>
          )}
          {estado.faltan > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button icon={Sparkles} iconEffect="varita" onClick={abrirIA}>Generar con IA</Button>
              <Button variant="secondary" icon={Library} onClick={() => setImportando(true)}>Del banco o mis evaluaciones</Button>
              <Button variant="secondary" icon={Plus} onClick={() => setEditor({ pregunta: null })}>Escribir una</Button>
            </div>
          )}
        </section>

        <section className="bg-surface-card rounded-card shadow-card p-4 space-y-3" aria-labelledby="reto-competencias">
          <h2 id="reto-competencias" className="text-lg font-semibold text-on-surface">Competencias</h2>
          {sesiones === null
            ? <p className="text-sm text-muted">Cargando…</p>
            : <HistorialRetoSesiones activityId={activityId} actividad={actividad} asignatura={asignatura} docenteId={uid} sesiones={sesiones} onCambio={() => setVersionSesiones((v) => v + 1)} />}
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 pb-6">
          {!abierta && !estado.completo && <p className="text-sm text-muted">Completa las {RETO_CFG.TOTAL_PREGUNTAS} preguntas para iniciar.</p>}
          <Button icon={Play} busy={iniciando} disabled={sesiones === null || (!abierta && !estado.completo)} onClick={iniciarCompetencia}>
            {abierta ? 'Continuar competencia' : 'Iniciar competencia'}
          </Button>
        </div>
      </div>

      {editor && <EditorPreguntaReto open pregunta={editor.pregunta} tiempoPorOmision={tiempoReto} onClose={() => setEditor(null)} onGuardar={guardarPregunta} />}
      {importando && (
        <ImportarReactivosReto open asignaturaId={actividad.asignaturaId} docenteId={currentUser?.uid} faltan={estado.faltan}
          onClose={() => setImportando(false)} onImportar={importar} />
      )}
      {quitando && (
        <ConfirmModal title="Quitar pregunta" message="La pregunta se quitará de este reto. El reactivo original del banco o de tus evaluaciones no cambia."
          confirmLabel="Quitar" danger onConfirm={confirmarQuitar} onCancel={() => setQuitando(null)} />
      )}
      {iaConfig && (
        <ConfirmacionCreditosModal
          titulo="Generar preguntas con IA"
          descripcion="El asistente redacta preguntas breves de opción múltiple o verdadero/falso; tú las revisas y decides cuáles agregar. Se cobra 1 crédito por reactivo entregado."
          costoMin={creditosIA.estimar('reactivos', iaConfig.cantidad) ?? iaConfig.cantidad}
          ejecutando={iaTrabajando}
          continuarDeshabilitado={!iaValida}
          onCancelar={() => { if (!iaTrabajando) setIaConfig(null) }}
          onContinuar={generarConIA}
        >
          <div className="space-y-3">
            {preguntas.length > 0 && (
              <Checkbox checked={iaConfig.mismoTema} onChange={(e) => setIaConfig((c) => ({ ...c, mismoTema: e.target.checked }))}
                label="Mismo tema que las preguntas que ya tiene el reto" />
            )}
            {!usarMismoTema && (
              <Textarea label="¿Qué quieres evaluar?" rows={3} autoResize maxLength={4000} value={iaConfig.quiereEvaluar}
                onChange={(e) => setIaConfig((c) => ({ ...c, quiereEvaluar: e.target.value }))}
                optional={iaArchivos.length > 0}
                hint={iaArchivos.length
                  ? 'Opcional: con archivos adjuntos, la IA puede generar solo a partir de ellos.'
                  : `Describe el contenido con detalle (mínimo ${MIN_QUIERE_EVALUAR} caracteres), o adjunta archivos.`} />
            )}
            <FuentesIAInput files={iaArchivos} onChange={setIaArchivos} disabled={iaTrabajando} fuentesGuardadas={fuentesGuardadas}
              mostrarLimiteVisual titulo="Archivos de referencia (opcional)"
              descripcion="Adjunta hasta 3 documentos (PDF o Word) para que la IA genere las preguntas a partir de ellos, solos o junto con lo que describas." />
            <Select label="¿Cuántas?" value={iaConfig.cantidad} onChange={(v) => setIaConfig((c) => ({ ...c, cantidad: Number(v) }))}
              options={Array.from({ length: estado.faltan }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
            <fieldset className="space-y-2">
              <legend className="block text-sm font-medium text-muted mb-1">Tipos</legend>
              {TIPOS_IA.map((t) => (
                <Checkbox key={t.value} label={t.label} checked={iaConfig.tipos.includes(t.value)}
                  onChange={(e) => setIaConfig((c) => ({ ...c, tipos: e.target.checked ? [...c.tipos, t.value] : c.tipos.filter((x) => x !== t.value) }))} />
              ))}
            </fieldset>
          </div>
        </ConfirmacionCreditosModal>
      )}
      {iaPropuesta && <ReactivosIAReview reactivos={iaPropuesta} onClose={() => setIaPropuesta(null)} onGuardar={guardarPropuesta} />}
      <span className="sr-only" aria-live="polite">{estado.total} de {RETO_CFG.TOTAL_PREGUNTAS} preguntas</span>
    </>
  )
}
