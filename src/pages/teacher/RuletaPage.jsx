// La Ruleta del Destino · pantalla del docente: CONFIGURAR la actividad (nombre, tema, instrucciones para el
// estudiante, visibilidad y fecha límite, con los mismos componentes del Entregable; decisión 22, 14-nov-2026),
// preparar y aprobar el banco de reactivos (a mano o con IA) y ver los resultados.
// Publicar exige instrucciones y el banco completo y aprobado; guardar el borrador, no. El banco lo escribe SOLO el
// servidor (R1): cada cambio pasa por /api/subject/ruleta-banco.
// Especificación: docs/RULETA_DESTINO.md.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { ArrowLeft, Pencil } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Input, MotivoApagado, RadioGroup, Select, Textarea } from '../../components/ui'
import ConfirmModal from '../../components/ConfirmModal'
import RichTextEditor from '../../components/RichTextEditor'
import VisibilitySelect from '../../components/VisibilitySelect'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import { activityVisibilityState, isDraftActivity, resolveVisibilidad } from '../../utils/activityVisibility'
import { isoLocalFromDate, minDeadline } from '../../utils/nowIso'
import { mensajeParcialCerrado, parcialCerrado } from '../../utils/ponderacion'
import { IS_NATIVE_APP } from '../../utils/platform'
import BancoRuleta from '../../components/ruleta/BancoRuleta'
import EditorReactivoRuleta from '../../components/ruleta/EditorReactivoRuleta'
import GenerarBancoIA from '../../components/ruleta/GenerarBancoIA'
import ResultadosRuleta from '../../components/ruleta/ResultadosRuleta'
import { EsqueletoRuletaDocente } from '../../components/esqueletos'
import { subjectDisplayName } from '../../utils/subjectName'
import { TEACHER_CONTAINER } from '../../config/layout'
import { ACCESOS_RULETA, MODALIDADES_RULETA, ORIGENES_BANCO, RULETA_CFG, normalizarTexto, origenBanco, requisitosPublicarRuleta, tamanoBanco, textoDeInstrucciones } from '../../utils/ruletaDestino'
import { cargarRuleta, guardarConfiguracionRuleta, operacionBanco } from '../../utils/ruletaDestinoDb'

// El formulario de configuración a partir de la actividad guardada. Una ruleta creada antes de esta configuración no
// tiene instrucciones ni fecha: nace con esos campos vacíos y no pierde nada.
const formularioDe = (a) => ({
  nombre: a.nombre || '', tema: a.tema || '', instrucciones: a.instrucciones || '', fechaLimite: a.fechaLimite || '',
  visibilidadMode: !a.oculta ? 'published' : a.publishAt ? 'schedule' : 'hide',
  publishAt: a.publishAt || '', publishedAt: a.publishedAt || '',
})
const ETIQUETA_VISIBILIDAD = { visible: 'Publicada', scheduled: 'Programada', hidden: 'Oculta' }

// Cantidad EXACTA del banco para cada tamaño de partida (5→25, 10→50), manual o con IA.
const OPCIONES_PREGUNTAS = RULETA_CFG.PREGUNTAS_POR_PARTIDA.map((n) => ({
  value: String(n), label: `${n} preguntas (banco de ${tamanoBanco(n)} reactivos)`,
}))

// Las dos formas de preparar el banco (solo mientras está vacío: la IA genera el banco completo, nunca lo completa).
const MODOS_BANCO = [
  { value: 'manual', label: 'Captura manual', hint: 'Escribes cada pregunta con sus 4 opciones y la correcta.' },
  { value: 'ia', label: 'Generar con IA', hint: 'Adjuntas de 1 a 3 archivos de apoyo y la IA genera el banco completo.' },
]

export default function RuletaPage() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid

  const [cargando, setCargando] = useState(true)
  const [actividad, setActividad] = useState(null)
  const [asignatura, setAsignatura] = useState(null)
  const [reactivos, setReactivos] = useState([])
  const [aprobado, setAprobado] = useState(false)
  // Origen del banco tal como lo guardó el servidor; se actualiza con cada respuesta del servidor y nunca se envía.
  const [origen, setOrigen] = useState(ORIGENES_BANCO.manual)
  const [form, setForm] = useState(() => formularioDe({ oculta: true }))
  const [guardandoConfig, setGuardandoConfig] = useState(false)
  const [confirmarBorrador, setConfirmarBorrador] = useState(false)
  const [preguntasNuevas, setPreguntasNuevas] = useState('10')
  const [ocupado, setOcupado] = useState(null) // 'guardar' | 'borrar' | 'aprobar' | 'config'
  const [editor, setEditor] = useState(null) // { reactivo } (null en reactivo = nuevo)
  const [porBorrar, setPorBorrar] = useState(null)
  const [modoBanco, setModoBanco] = useState('manual') // 'manual' | 'ia' (solo con el banco vacío)

  useEffect(() => {
    if (!uid) return undefined
    let vigente = true
    cargarRuleta(activityId, uid)
      .then((r) => {
        if (!vigente) return
        if (r?.noEsRuleta) { navigate(`/activity/${activityId}`, { replace: true }); return }
        if (r) {
          setActividad(r.actividad)
          setReactivos(r.reactivos)
          setAprobado(r.banco.aprobado)
          setOrigen(origenBanco(r.banco))
          setForm(formularioDe(r.actividad))
          setPreguntasNuevas(String(r.actividad.ruleta?.preguntasPorPartida || 10))
          getDoc(doc(db, 'subjects', r.actividad.asignaturaId))
            .then((s) => { if (vigente) setAsignatura(s.exists() ? { id: s.id, ...s.data() } : null) })
            .catch(() => {})
        }
        setCargando(false)
      })
      .catch((e) => {
        if (!vigente) return
        toast(e.message || 'No se pudo cargar la ruleta', 'error')
        setCargando(false)
      })
    return () => { vigente = false }
  }, [activityId, uid, navigate, toast])

  // Enunciados de los DEMÁS reactivos (para avisar de un duplicado en el editor).
  const enunciadosEnUso = useMemo(() => new Set(
    reactivos.filter((r) => r.id !== editor?.reactivo?.id).map((r) => normalizarTexto(r.enunciado)),
  ), [reactivos, editor])

  if (cargando) return <EsqueletoRuletaDocente />
  if (!actividad) {
    return <div className={`${TEACHER_CONTAINER} px-4 py-4`}><p className="text-base text-muted">Esta ruleta no existe o ya fue eliminada.</p></div>
  }

  const ruleta = actividad.ruleta || {}
  const n = ruleta.preguntasPorPartida
  const externa = ruleta.acceso === 'externo'
  const congeladas = ruleta.preguntasCongeladas === true
  // Configuración de la actividad: mismos estados y botones que el Entregable (borrador / publicada / programada).
  const eraBorrador = isDraftActivity(actividad)
  const cambio = JSON.stringify(form) !== JSON.stringify(formularioDe(actividad))
  const bancoCompleto = reactivos.length === tamanoBanco(n)
  const requisitos = requisitosPublicarRuleta({
    acceso: ruleta.acceso, instrucciones: form.instrucciones, preguntasPorPartida: n, bancoTotal: reactivos.length, bancoAprobado: aprobado,
  })
  // El botón principal publica cuando la ruleta es un borrador y no se eligió «Borrador»; ahí sí aplican los requisitos.
  const botonPublica = !externa && eraBorrador && form.visibilidadMode !== 'hide'
  const faltan = [
    !form.nombre.trim() && 'el nombre de la actividad',
    !form.tema.trim() && 'el tema',
    !externa && !eraBorrador && !textoDeInstrucciones(form.instrucciones) && 'las instrucciones',
    botonPublica && requisitos.faltan.includes('instrucciones') && 'las instrucciones',
    botonPublica && requisitos.faltan.includes('banco') && (bancoCompleto ? 'aprobar el banco de reactivos' : `completar y aprobar el banco (${reactivos.length} de ${tamanoBanco(n)} reactivos)`),
  ].filter(Boolean)
  const visibilidad = activityVisibilityState(actividad)

  // Después de generar con IA: el banco se vuelve a leer tal como lo guardó el servidor.
  async function recargarBanco() {
    try {
      const r = await cargarRuleta(activityId, uid)
      if (r?.actividad) {
        setReactivos(r.reactivos)
        setAprobado(r.banco.aprobado)
        setOrigen(origenBanco(r.banco))
      }
    } catch (e) {
      toast(e.message || 'No se pudo cargar el banco', 'error')
    }
    setModoBanco('manual')
  }

  // Guarda la configuración. `comoBorrador`: se queda (o regresa) oculta y sin publicar; no exige instrucciones ni banco.
  async function guardarConfiguracion(comoBorrador = false) {
    if (!form.nombre.trim() || !form.tema.trim()) { toast('Escribe el nombre y el tema', 'error'); return }
    let visible = null
    if (!externa) {
      const r = resolveVisibilidad({
        visibilidadMode: form.visibilidadMode, publishedAt: form.publishedAt, publishAt: form.publishAt,
        fechaLimite: form.fechaLimite, asDraft: comoBorrador,
      })
      if (!r.ok) { toast(r.error, 'error'); return }
      visible = r
      // ¿Queda publicada (ahora, programada o ya publicada y oculta con el ojo)? Entonces lleva instrucciones; y si
      // apenas se publica, el banco completo y aprobado.
      const quedaPublicada = !(r.oculta && !r.publishedAt && !r.publishAt)
      if (quedaPublicada && !textoDeInstrucciones(form.instrucciones)) { toast('Escribe las instrucciones para tus estudiantes', 'error'); return }
      // Las reglas exigen el banco listo cada vez que cambia la visibilidad o la hora programada (publicar,
      // programar o reprogramar); aquí se dice antes, con el motivo.
      const cambiaVisibilidad = r.oculta !== (actividad.oculta === true) || (r.publishAt || null) !== (actividad.publishAt || null)
      if (quedaPublicada && cambiaVisibilidad && !requisitos.ok) { toast(requisitos.error, 'error'); return }
      // Parcial cerrado definitivamente: no se publica un borrador ni se regresa a borrador (cambia si cuenta).
      if (parcialCerrado(asignatura, actividad.parcial) && quedaPublicada !== !eraBorrador) {
        toast(mensajeParcialCerrado(actividad.parcial), 'error'); return
      }
    }
    setGuardandoConfig(true)
    try {
      const guardado = await guardarConfiguracionRuleta(actividad.id, {
        nombre: form.nombre, tema: form.tema, instrucciones: form.instrucciones, interna: !externa,
        // Un borrador que nunca se publicó no conserva fecha límite (igual que el Entregable).
        fechaLimite: visible && !(visible.oculta && !visible.publishedAt && !visible.publishAt) ? form.fechaLimite : '',
        oculta: visible?.oculta, publishAt: visible?.publishAt, publishedAt: visible?.publishedAt,
      })
      const nueva = { ...actividad, ...guardado }
      setActividad(nueva)
      setForm(formularioDe(nueva))
      setConfirmarBorrador(false)
      const quedoBorrador = !externa && isDraftActivity(nueva)
      let aviso = 'Cambios guardados'
      if (quedoBorrador) aviso = 'Borrador guardado — oculto para estudiantes'
      else if (!externa && eraBorrador) aviso = activityVisibilityState(nueva) === 'scheduled' ? 'Ruleta programada' : 'Ruleta publicada: tus estudiantes ya pueden jugar'
      toast(aviso)
    } catch (e) {
      toast(e.message || 'No se pudo guardar la configuración', 'error')
    } finally {
      setGuardandoConfig(false)
    }
  }

  async function cambiarPreguntas() {
    setOcupado('config')
    try {
      const r = await operacionBanco('config', { actividadId: actividad.id, preguntasPorPartida: Number(preguntasNuevas) })
      setActividad((a) => ({ ...a, ruleta: { ...a.ruleta, preguntasPorPartida: r.preguntasPorPartida } }))
      setAprobado(r.banco.aprobado)
      setOrigen(origenBanco(r.banco))
      toast(`Ahora cada partida tiene ${r.preguntasPorPartida} preguntas`)
    } catch (e) {
      toast(e.message, 'error')
      setPreguntasNuevas(String(n))
    } finally {
      setOcupado(null)
    }
  }

  async function guardarReactivo(datosReactivo) {
    const existente = editor?.reactivo
    setOcupado('guardar')
    try {
      const r = existente
        ? await operacionBanco('editar', { actividadId: actividad.id, reactivoId: existente.id, reactivo: datosReactivo })
        : await operacionBanco('guardar', { actividadId: actividad.id, reactivo: datosReactivo })
      setReactivos((lista) => (existente
        ? lista.map((x) => (x.id === existente.id ? { ...x, ...r.reactivo } : x))
        : [...lista, { ...r.reactivo, creadoEn: Date.now() }]))
      setAprobado(r.banco.aprobado)
      setOrigen(origenBanco(r.banco))
      setEditor(null)
      toast(existente ? 'Reactivo actualizado' : 'Reactivo agregado')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  async function borrarReactivo() {
    const r = porBorrar
    setOcupado('borrar')
    try {
      const res = await operacionBanco('borrar', { actividadId: actividad.id, reactivoId: r.id })
      setReactivos((lista) => lista.filter((x) => x.id !== r.id))
      setAprobado(res.banco.aprobado)
      setOrigen(origenBanco(res.banco))
      setPorBorrar(null)
      toast('Reactivo eliminado')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  async function aprobarBanco() {
    setOcupado('aprobar')
    try {
      const r = await operacionBanco('aprobar', { actividadId: actividad.id })
      setAprobado(r.banco.aprobado)
      setOrigen(origenBanco(r.banco))
      toast('Banco aprobado')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <div data-esq="ruleta-contenedor" className={`${TEACHER_CONTAINER} px-4 py-4 space-y-4`}>
        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => navigate(`/subject/${actividad.asignaturaId}`)}>
            {asignatura ? subjectDisplayName(asignatura) : 'Asignatura'}
          </Button>
        </div>

        <div>
          <h1 className="text-xl font-semibold text-on-surface">{actividad.nombre || 'La Ruleta del Destino'}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge tone="accent">La Ruleta del Destino</Badge>
            <Badge>{MODALIDADES_RULETA[ruleta.modalidad] || '—'}</Badge>
            <Badge>{externa ? 'Con enlace o QR' : 'Mis estudiantes'}</Badge>
            {externa ? <Badge>Sin calificación</Badge> : <Badge>{eraBorrador ? 'Borrador' : ETIQUETA_VISIBILIDAD[visibilidad]}</Badge>}
          </div>
          <p className="text-sm text-muted mt-2">
            {externa
              ? 'Una ruleta con enlace o QR siempre queda oculta y no cuenta como calificación.'
              : eraBorrador
                ? 'Configura la actividad, completa y aprueba el banco, y publícala para que tus estudiantes puedan jugar.'
                : visibilidad === 'scheduled'
                  ? 'Se publicará sola en la fecha y hora programadas; hasta entonces nadie puede iniciar una partida.'
                  : aprobado && bancoCompleto
                    ? 'Tus estudiantes juegan una sola partida cada uno; su calificación se registra sola al terminar.'
                  : 'El banco no está aprobado: nadie puede iniciar una partida hasta que lo apruebes de nuevo.'}
          </p>
        </div>

        <section data-esq="ruleta-datos" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="ruleta-datos-titulo">
          <h2 id="ruleta-datos-titulo" className="text-lg font-semibold text-on-surface">Configuración de la actividad</h2>
          <Input label="Nombre de la actividad" value={form.nombre} maxLength={RULETA_CFG.MAX_NOMBRE} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
          <Textarea label="Tema o contenido a evaluar" value={form.tema} rows={2} autoResize maxLength={RULETA_CFG.MAX_TEMA}
            onChange={(e) => setForm((f) => ({ ...f, tema: e.target.value }))}
            hint="Es para ti y para generar el banco con IA; tus estudiantes no lo ven." />
          <div>
            <p className="block text-sm font-medium text-muted mb-1">Instrucciones para el estudiante</p>
            <RichTextEditor value={form.instrucciones} onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
              etiqueta="Explica qué va a evaluar esta ruleta y qué debe repasar antes de jugar…" simple={IS_NATIVE_APP} />
            <p className="text-xs text-hint mt-1">Tus estudiantes las leen antes de comenzar su partida. Son obligatorias para publicar.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-muted">Asignatura</p>
              <p className="text-base text-on-surface">{asignatura ? subjectDisplayName(asignatura) : '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted">Parcial</p>
              <p className="text-base text-on-surface">Parcial {actividad.parcial}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted">Calificación</p>
              <p className="text-base text-on-surface">{externa ? 'Sin calificación' : `Sobre ${RULETA_CFG.CALIFICACION_MAXIMA}, automática al terminar`}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted">Modalidad</p>
              <p className="text-base text-on-surface">{MODALIDADES_RULETA[ruleta.modalidad]}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted">¿Quién participa?</p>
              <p className="text-base text-on-surface">{externa ? `${ACCESOS_RULETA.externo}: con enlace o QR, sin cuenta` : `${ACCESOS_RULETA.interno}: tus estudiantes con su cuenta`}</p>
            </div>
          </div>
          <p className="text-xs text-hint">La modalidad y quién participa no cambian. Para usar otros, crea otra ruleta.</p>

          {congeladas ? (
            <p className="text-sm text-muted">Cada partida tiene {n} preguntas. Ya no cambia porque la ruleta tiene partidas.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Preguntas por partida" value={preguntasNuevas} onChange={(v) => setPreguntasNuevas(String(v))}
                options={OPCIONES_PREGUNTAS} wrapperClassName="flex-1 min-w-[16rem]"
                hint="El banco debe quedar con la cantidad exacta del nuevo número. Cambiarlo quita la aprobación." />
              {Number(preguntasNuevas) !== n && (
                <Button variant="secondary" onClick={cambiarPreguntas} busy={ocupado === 'config'} disabled={Boolean(ocupado)}>Cambiar</Button>
              )}
            </div>
          )}

        </section>

        {/* Visibilidad, fecha límite y guardado: los mismos componentes y botones del Entregable. */}
        <section data-esq="ruleta-publicacion" className="bg-surface-card rounded-card shadow-card p-4 space-y-3" aria-labelledby="ruleta-publicacion-titulo">
          <h2 id="ruleta-publicacion-titulo" className="text-lg font-semibold text-on-surface">Publicación</h2>
          {externa ? (
            <p className="text-sm text-muted">Esta ruleta no se publica en la asignatura: se compartirá con enlace o QR.</p>
          ) : (
            <>
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
                <VisibilitySelect
                  mode={form.visibilidadMode} publishAt={form.publishAt} publishedAt={form.publishedAt}
                  wasScheduled={Boolean(actividad.publishAt) && !actividad.publishedAt} isDraft={eraBorrador}
                  onModeChange={(mode) => setForm((f) => ({
                    ...f, visibilidadMode: mode,
                    publishAt: mode === 'schedule' ? (f.publishAt || isoLocalFromDate(new Date(Date.now() + 2 * 60 * 60 * 1000))) : '',
                    fechaLimite: mode === 'hide' && !f.publishedAt ? '' : f.fechaLimite,
                  }))}
                  onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>
              {(form.visibilidadMode !== 'hide' || form.publishedAt) && (
                <div>
                  <p className="block text-sm font-medium text-muted mb-1">{form.fechaLimite ? 'Fecha límite para iniciar la partida' : 'Fecha límite (opcional)'}</p>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-sm text-hint px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <EFDateTimePicker
                      mode="datetime" headerLabel="Fecha y hora límite" value={form.fechaLimite}
                      onChange={(v) => setForm((f) => ({ ...f, fechaLimite: v }))}
                      valorVacio="Sin fecha límite" clearable defaultTime="23:59"
                      defaultDate={(form.publishAt || form.publishedAt || '').split('T')[0] || undefined}
                      minDateTime={minDeadline(form.visibilidadMode === 'schedule' ? form.publishAt : form.publishedAt)}
                    />
                  )}
                  <p className="text-xs text-hint mt-1">Después de esa fecha ya no se puede iniciar una partida. Quien la empezó antes puede terminarla.</p>
                </div>
              )}
            </>
          )}

          {!externa && eraBorrador && form.visibilidadMode === 'hide' ? (
            <Button fullWidth icon={Pencil} busy={guardandoConfig} onClick={() => guardarConfiguracion(true)}
              disabled={guardandoConfig || !cambio || !form.nombre.trim() || !form.tema.trim()}>
              Guardar borrador
            </Button>
          ) : (
            <>
              <div>
                <Button fullWidth icon={Pencil} busy={guardandoConfig} onClick={() => guardarConfiguracion(false)}
                  disabled={guardandoConfig || faltan.length > 0 || (!botonPublica && !cambio)}>
                  {botonPublica ? (form.visibilidadMode === 'schedule' ? 'Guardar con la fecha programada' : 'Guardar y publicar ahora') : 'Guardar cambios'}
                </Button>
                <MotivoApagado faltan={faltan} sinCambios={!botonPublica && !cambio} />
              </div>
              {!externa && (eraBorrador ? cambio : true) && (
                <Button variant="outline-accent" fullWidth disabled={guardandoConfig || !form.nombre.trim() || !form.tema.trim()}
                  onClick={() => { if (actividad.publishedAt) setConfirmarBorrador(true); else guardarConfiguracion(true) }}>
                  Guardar como borrador
                </Button>
              )}
            </>
          )}
        </section>

        <section data-esq="ruleta-banco" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="ruleta-banco-titulo">
          <h2 id="ruleta-banco-titulo" className="text-lg font-semibold text-on-surface">Banco de reactivos</h2>
          <p className="text-sm text-muted">
            Son las preguntas de la ruleta: en cada partida salen {n} al azar, sin repetirse. Necesitas
            exactamente {tamanoBanco(n)} reactivos y aprobar el banco para que se pueda jugar.
          </p>
          {reactivos.length === 0 && !congeladas && (
            <RadioGroup label="¿Cómo quieres preparar el banco?" name="ruleta-modo-banco" options={MODOS_BANCO}
              value={modoBanco} onChange={setModoBanco} />
          )}
          {reactivos.length === 0 && !congeladas && modoBanco === 'ia' ? (
            <GenerarBancoIA actividadId={actividad.id} asignaturaId={actividad.asignaturaId} preguntasPorPartida={n}
              temaRuleta={actividad.tema} disabled={Boolean(ocupado)} onGenerado={recargarBanco} />
          ) : (
            <BancoRuleta
              reactivos={reactivos} preguntasPorPartida={n} origen={origen} aprobado={aprobado} ocupado={ocupado}
              onAgregar={() => setEditor({ reactivo: null })}
              onEditar={(r) => setEditor({ reactivo: r })}
              onBorrar={(r) => setPorBorrar(r)}
              onAprobar={aprobarBanco}
            />
          )}
        </section>

        {/* Paso 2: resultados de la partida individual interna (el acceso externo todavía no se juega). */}
        {!externa && (
          <section data-esq="ruleta-resultados" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="ruleta-resultados-titulo">
            <ResultadosRuleta actividad={actividad} uid={uid} />
          </section>
        )}
      </div>

      {editor && (
        <EditorReactivoRuleta open reactivo={editor.reactivo} enunciadosEnUso={enunciadosEnUso}
          onClose={() => setEditor(null)} onGuardar={guardarReactivo} />
      )}
      {confirmarBorrador && (
        <ConfirmModal title="¿Regresar esta ruleta a borrador?" busy={guardandoConfig} confirmLabel="Regresar a borrador" confirmingLabel="Guardando…"
          message="Dejará de verse para tus estudiantes y nadie podrá iniciar una partida. Las partidas y calificaciones que ya existen se conservan."
          onConfirm={() => guardarConfiguracion(true)} onCancel={() => setConfirmarBorrador(false)} />
      )}
      {porBorrar && (
        <ConfirmModal title="Eliminar reactivo" danger busy={ocupado === 'borrar'} confirmLabel="Eliminar" confirmingLabel="Eliminando…"
          message={`Se eliminará «${porBorrar.enunciado}». Si el banco estaba aprobado, tendrás que aprobarlo de nuevo.`}
          onConfirm={borrarReactivo} onCancel={() => setPorBorrar(null)} />
      )}
    </>
  )
}
