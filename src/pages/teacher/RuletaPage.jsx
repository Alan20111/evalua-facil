// La Ruleta del Destino · pantalla del docente para PREPARAR la ruleta (fase 2): datos (nombre, tema y preguntas por
// partida) y el banco de reactivos, capturado a mano o generado con IA desde 1 a 3 archivos de apoyo (9-nov-2026).
// Todavía no se publica ni se juega: la actividad sigue oculta (F2-9). El banco lo escribe SOLO el servidor (R1): cada cambio pasa por /api/subject/ruleta-banco.
// Especificación: docs/RULETA_DESTINO.md.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { ArrowLeft, Save } from 'lucide-react'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Input, RadioGroup, Select, Textarea } from '../../components/ui'
import ConfirmModal from '../../components/ConfirmModal'
import BancoRuleta from '../../components/ruleta/BancoRuleta'
import EditorReactivoRuleta from '../../components/ruleta/EditorReactivoRuleta'
import GenerarBancoIA from '../../components/ruleta/GenerarBancoIA'
import ResultadosRuleta from '../../components/ruleta/ResultadosRuleta'
import { EsqueletoRuletaDocente } from '../../components/esqueletos'
import { subjectDisplayName } from '../../utils/subjectName'
import { TEACHER_CONTAINER } from '../../config/layout'
import { ACCESOS_RULETA, MODALIDADES_RULETA, ORIGENES_BANCO, RULETA_CFG, normalizarTexto, origenBanco, tamanoBanco } from '../../utils/ruletaDestino'
import { cargarRuleta, guardarDatosRuleta, operacionBanco } from '../../utils/ruletaDestinoDb'

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
  const [datos, setDatos] = useState({ nombre: '', tema: '' })
  const [guardandoDatos, setGuardandoDatos] = useState(false)
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
          setDatos({ nombre: r.actividad.nombre || '', tema: r.actividad.tema || '' })
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
  const datosCambiaron = datos.nombre.trim() !== (actividad.nombre || '') || datos.tema.trim() !== (actividad.tema || '')

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

  async function guardarDatos() {
    if (!datos.nombre.trim() || !datos.tema.trim()) { toast('Escribe el nombre y el tema', 'error'); return }
    setGuardandoDatos(true)
    try {
      await guardarDatosRuleta(actividad.id, datos)
      setActividad((a) => ({ ...a, nombre: datos.nombre.trim(), tema: datos.tema.trim() }))
      toast('Datos guardados')
    } catch (e) {
      toast(e.message || 'No se pudieron guardar los datos', 'error')
    } finally {
      setGuardandoDatos(false)
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
            {externa && <Badge>Sin calificación</Badge>}
          </div>
          <p className="text-sm text-muted mt-2">Por ahora preparas el banco: la ruleta todavía no se publica ni se juega.</p>
        </div>

        <section data-esq="ruleta-datos" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="ruleta-datos-titulo">
          <h2 id="ruleta-datos-titulo" className="text-lg font-semibold text-on-surface">Datos de la ruleta</h2>
          <Input label="Nombre" value={datos.nombre} maxLength={RULETA_CFG.MAX_NOMBRE} onChange={(e) => setDatos((d) => ({ ...d, nombre: e.target.value }))} />
          <Textarea label="Tema o contenido a evaluar" value={datos.tema} rows={2} autoResize maxLength={RULETA_CFG.MAX_TEMA}
            onChange={(e) => setDatos((d) => ({ ...d, tema: e.target.value }))} />
          {datosCambiaron && (
            <Button icon={Save} onClick={guardarDatos} busy={guardandoDatos} disabled={!datos.nombre.trim() || !datos.tema.trim()}>Guardar datos</Button>
          )}

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

        <section data-esq="ruleta-banco" className="bg-surface-card rounded-card shadow-card p-4 space-y-4" aria-labelledby="ruleta-banco-titulo">
          <h2 id="ruleta-banco-titulo" className="text-lg font-semibold text-on-surface">Banco de reactivos</h2>
          {reactivos.length === 0 && !congeladas && (
            <RadioGroup label="¿Cómo quieres preparar el banco?" name="ruleta-modo-banco" options={MODOS_BANCO}
              value={modoBanco} onChange={setModoBanco} />
          )}
          {reactivos.length === 0 && !congeladas && modoBanco === 'ia' ? (
            <GenerarBancoIA actividadId={actividad.id} asignaturaId={actividad.asignaturaId} preguntasPorPartida={n}
              disabled={Boolean(ocupado)} onGenerado={recargarBanco} />
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
      {porBorrar && (
        <ConfirmModal title="Eliminar reactivo" danger busy={ocupado === 'borrar'} confirmLabel="Eliminar" confirmingLabel="Eliminando…"
          message={`Se eliminará «${porBorrar.enunciado}». Si el banco estaba aprobado, tendrás que aprobarlo de nuevo.`}
          onConfirm={borrarReactivo} onCancel={() => setPorBorrar(null)} />
      )}
    </>
  )
}
