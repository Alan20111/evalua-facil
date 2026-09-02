// Crucigrama / Sopa de letras — panel del docente en ActivityPage (22-ago-2026).
//
// Vive fuera de EvaluacionManager.jsx a propósito: ese componente está
// construido alrededor de reactivos (preguntas, banco, orden de preguntas,
// barajar respuestas) que no aplican a un juego. Lo que SÍ se reutiliza es
// el modelo de datos (`activity.evaluacion`, mismo shape que
// EVALUACION_DEFAULTS.juego) y los mismos subcomponentes de configuración
// (VisibilitySelect, PublicacionScheduler, EFDateTimePicker) para que se
// vea y se comporte igual que examen/cuestionario.
//
// Tres estados de `activity.juego.estado`:
//   null | 'contenido_generado' | 'contenido_editado' → ContenidoJuegoEditor
//   'juego_generado'                                  → RevisionJuegoBorrador
//   'juego_confirmado'                                → configuración + resultados
//
// El candado de publicación real vive en firestore.rules (docenteActivo +
// juego.estado === 'juego_confirmado'); aquí solo evitamos MOSTRAR el
// control de publicar antes de tiempo (capa amable, igual que
// firestoreGuard.js).

import { useState } from 'react'
import { ArrowLeft, Pencil, Trash2, XCircle } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { updateDoc } from '../../utils/firestoreGuard'
import { db, functions } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import VisibilitySelect from '../VisibilitySelect'
import PublicacionScheduler from '../PublicacionScheduler'
import EFDateTimePicker from '../EFDateTimePicker'
import Select from '../ui/Select'
import { subjectDisplayName } from '../../utils/subjectName'
import { etiquetaJuego } from '../../utils/copiaActividad'
import useCreditosIA from '../../hooks/useCreditosIA'
import { withDefaultTime } from '../../utils/activityVisibility'
import { nowIsoLocal } from '../../utils/nowIso'
import { studentFullName } from '../../utils/studentSearch'
import { EVALUACION_DEFAULTS } from '../../utils/evaluacionDefaults'
import { formatTiempo } from '../../utils/formatTiempo'
import ContenidoJuegoEditor from './ContenidoJuegoEditor'
import RevisionJuegoBorrador from './RevisionJuegoBorrador'
import ResolucionJuegoModal from './ResolucionJuegoModal'

export default function JuegoManager({
  activity, subject, activityId, activityLabel, students, submissions,
  onActivityChange, onDeleteActivity, goBack,
}) {
  const [regresando, setRegresando] = useState(false)
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const estado = activity.juego?.estado || null
  const tipoLabel = etiquetaJuego(activity)
  // Cuántos créditos se apartan al generar el contenido con IA. Sale de
  // `config/iaTarifas` (la MISMA fuente que usa el servidor), nunca de una
  // constante escrita aquí: si la tarifa cambia, este número cambia solo. Si
  // las tarifas aún no cargaron es `null` y el diálogo simplemente no da una
  // cifra, en vez de inventarse una.
  const creditosApartados = creditosIA.estimar('generar_contenido_juego')
  // Antes de 'juego_confirmado' esto sigue siendo un borrador — puede tener
  // un apartado de créditos vivo (generar_contenido_juego) que hay que cerrar
  // al eliminarlo, no solo borrar el documento (ver cancelarBorradorJuego,
  // functions/juego.js). Ya confirmado, esto ya no aplica — se elimina como
  // cualquier otra actividad (onDeleteActivity).
  const esBorrador = estado !== 'juego_confirmado'

  async function refetchActivity() {
    try {
      const snap = await getDoc(doc(db, 'activities', activityId))
      if (snap.exists()) onActivityChange({ id: snap.id, ...snap.data() })
    } catch { /* la vista sigue con los datos previos */ }
  }

  async function handleConstruido() {
    setRegresando(false)
    await refetchActivity()
  }
  async function handleConfirmado() {
    await refetchActivity()
  }

  // El aviso final dice EXACTAMENTE lo que ocurrió con el apartado de
  // créditos, según lo que responde el servidor (`reserva`) — no una frase
  // fija. Antes se afirmaba siempre un movimiento de créditos, incluso cuando
  // no había ningún apartado que cerrar o ya se había cerrado por tiempo.
  function mensajeCierre({ reserva, creditos }) {
    if (reserva === 'cancelada') {
      return creditos != null
        ? `Actividad eliminada. Se habían apartado ${creditos} ${creditos === 1 ? 'crédito' : 'créditos'}: el cobro de los créditos apartados no se aplica.`
        : 'Actividad eliminada. El cobro de los créditos apartados no se aplica.'
    }
    if (reserva === 'expirada') return 'Actividad eliminada. El apartado de créditos ya se había cerrado antes por tiempo.'
    if (reserva === 'ya_cerrada') return 'Actividad eliminada. El apartado de créditos ya estaba cerrado.'
    if (reserva === 'ya_cobrada') return 'Actividad eliminada. El cobro de esa generación ya se había aplicado.'
    return 'Actividad eliminada.'
  }

  async function handleEliminarBorrador() {
    setCancelando(true)
    try {
      const cancelarBorradorJuego = httpsCallable(functions, 'cancelarBorradorJuego')
      const { data } = await cancelarBorradorJuego({ actividadId: activityId })
      toast(mensajeCierre(data || {}))
      goBack?.()
    } catch (err) {
      // Si el servidor no pudo cerrar el apartado de créditos, la actividad
      // SIGUE ahí (no se borra) — el error se muestra tal cual y la vista se
      // queda donde está para que el docente pueda reintentar.
      toast(err.message || 'No se pudo eliminar el borrador', 'error')
      setCancelando(false)
      setConfirmandoCancelar(false)
    }
  }

  const mostrandoContenido = regresando || estado == null || estado === 'contenido_generado' || estado === 'contenido_editado'
  const mostrandoRevision = !mostrandoContenido && (estado === 'juego_generado' || estado === 'juego_confirmado')

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={goBack} aria-label="Volver" className="p-2 -ml-2 text-slate-400 hover:text-muted rounded">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[1.75rem] leading-tight font-bold uppercase tracking-wide text-accent truncate">{tipoLabel}</p>
          <h1 className="text-xl font-bold text-on-surface truncate">
            {activityLabel && <span className="text-accent">{activityLabel} </span>}
            {activity.nombre || tipoLabel}
          </h1>
          <p className="text-base font-medium text-muted">Parcial {activity.parcial} · {subjectDisplayName(subject)}</p>
        </div>
        {esBorrador && (
          <button type="button" onClick={() => setConfirmandoCancelar(true)} aria-label="Eliminar este borrador"
            data-tooltip="Eliminar este borrador"
            className="p-2 text-slate-400 hover:text-error hover:bg-red-50 rounded transition-colors flex-shrink-0">
            <XCircle size={18} />
          </button>
        )}
        {!esBorrador && onDeleteActivity && (
          <button type="button" onClick={onDeleteActivity} aria-label="Eliminar actividad"
            className="p-2 text-slate-400 hover:text-error hover:bg-red-50 rounded transition-colors flex-shrink-0">
            <Trash2 size={18} />
          </button>
        )}
      </div>

      {/* Lo irreversible aquí es que se BORRA la actividad con todo y las
          palabras generadas — el aviso anterior no lo decía, y en cambio
          presentaba el cierre del apartado de créditos como si el docente
          ganara algo. La cifra sale de config/iaTarifas, nunca escrita a mano. */}
      {confirmandoCancelar && (
        <div className="mb-3 p-3 rounded-card bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <p className="text-sm text-error">
            ¿Eliminar este borrador de {tipoLabel.toLowerCase()}? Se eliminan de forma permanente la actividad
            y las palabras generadas: no se podrán recuperar.{' '}
            {creditosApartados != null && (
              <>Al generar el contenido se apartaron {creditosApartados} {creditosApartados === 1 ? 'crédito' : 'créditos'}. </>
            )}
            El cobro de los créditos apartados no se aplica.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button type="button" onClick={() => setConfirmandoCancelar(false)} disabled={cancelando}
              className="px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-container rounded transition-colors disabled:opacity-60">
              No, seguir editando
            </button>
            <button type="button" onClick={handleEliminarBorrador} disabled={cancelando}
              className="px-3 py-1.5 bg-error text-white text-sm font-medium rounded hover:opacity-90 transition-colors disabled:opacity-60">
              {cancelando ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </div>
      )}

      {/* El nombre se puede poner DESDE EL BORRADOR, no solo cuando el juego
          ya está confirmado: el docente acaba de crear el crucigrama y quiere
          identificarlo en su lista desde ese momento. Vive aquí arriba —fuera
          de las tres etapas— para que esté disponible en todas ellas y para
          que haya UNA sola casa donde se edita (antes estaba metido en el
          formulario de Configuración, que solo existe ya confirmado). */}
      <NombreJuego
        activity={activity}
        activityId={activityId}
        tipoLabel={tipoLabel}
        onActivityChange={onActivityChange}
      />

      <div className="rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
        <div className="px-4 py-3 bg-accent-light border-b border-accent">
          <h2 className="font-semibold text-accent">
            {mostrandoContenido ? 'Contenido' : mostrandoRevision ? 'Vista previa' : 'Configuración y resultados'}
          </h2>
        </div>
        <div className="p-4">
          {mostrandoContenido && (
            <ContenidoJuegoEditor activity={activity} onConstruido={handleConstruido} />
          )}
          {mostrandoRevision && (
            <RevisionJuegoBorrador
              activity={activity}
              onConfirmado={handleConfirmado}
              onRegresar={() => setRegresando(true)}
            />
          )}
        </div>
      </div>

      {estado === 'juego_confirmado' && !regresando && (
        <JuegoConfiguracion
          activity={activity}
          activityId={activityId}
          students={students}
          submissions={submissions}
          onActivityChange={onActivityChange}
        />
      )}
    </div>
  )
}

// Nombre de la actividad — el campo NORMAL `activity.nombre`, el mismo que
// usan todas las demás actividades. No hay un nombre "de juego" aparte.
//
// Guardarlo es una escritura suelta sobre ese único campo: no toca
// `juego.estado`, no reconstruye el tablero, no confirma nada y no pasa por
// ningún callable de IA, así que no mueve créditos ni el apartado de la
// generación. Por eso puede usarse mientras el juego sigue en borrador.
function NombreJuego({ activity, activityId, tipoLabel, onActivityChange }) {
  const toast = useToast()
  const guardado = activity.nombre || ''
  const [valor, setValor] = useState(guardado)
  const [guardando, setGuardando] = useState(false)
  const cambio = valor.trim() !== guardado

  async function handleGuardar() {
    const limpio = valor.trim()
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), { nombre: limpio })
      onActivityChange((prev) => ({ ...prev, nombre: limpio }))
      setValor(limpio)
      toast(limpio ? 'Nombre guardado' : 'Nombre quitado')
    } catch (err) {
      toast(err.message || 'No se pudo guardar el nombre', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mb-3 rounded-card bg-surface-card shadow-card border border-outline-variant p-3">
      <label htmlFor="juego-nombre" className="block text-sm font-medium text-muted mb-1">
        Nombre de la actividad
      </label>
      <div className="flex gap-2">
        <input
          id="juego-nombre"
          type="text"
          maxLength={120}
          value={valor}
          disabled={guardando}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && cambio && !guardando) { e.preventDefault(); handleGuardar() } }}
          placeholder={`Sin nombre — se mostrará como "${tipoLabel}"`}
          className="flex-1 min-w-0 px-3 py-2 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {/* Solo aparece cuando de verdad hay algo distinto que guardar, para
            no invitar a reguardar lo mismo (mismo criterio que los botones de
            Configuración/Disponibilidad de abajo). */}
        {cambio && (
          <button type="button" onClick={handleGuardar} disabled={guardando}
            className="px-3 py-2 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors disabled:opacity-60 flex-shrink-0">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </div>
  )
}

function JuegoConfiguracion({ activity, activityId, students, submissions, onActivityChange }) {
  const toast = useToast()
  const evalDefaults = EVALUACION_DEFAULTS.juego
  const [form, setForm] = useState({
    // El nombre NO vive aquí: se edita arriba (NombreJuego), disponible desde
    // el borrador. Tenerlo también en este formulario significaba dos campos
    // para el mismo dato, y este —congelado en useState al montar— pisaba con
    // el valor viejo lo que se acabara de guardar arriba.
    tiempoLimiteMin: activity.evaluacion?.tiempoLimiteMin ?? evalDefaults.tiempoLimiteMin,
    intentosPermitidos: activity.evaluacion?.intentosPermitidos ?? evalDefaults.intentosPermitidos,
    conservar: activity.evaluacion?.conservar ?? evalDefaults.conservar,
    publicarResultados: activity.evaluacion?.publicarResultados || 'inmediato',
    publicarResultadosFecha: activity.evaluacion?.publicarResultadosFecha || null,
    resultadosPublicados: activity.evaluacion?.resultadosPublicados || false,
    // Publicar solución — independiente de la calificación: el docente decide
    // CUÁNDO se libera el juego resuelto. El alumno solo la ve si además ya
    // agotó todos sus intentos (ver ActivityPage del alumno).
    publicarSolucion: activity.evaluacion?.publicarSolucion || 'inmediato',
    publicarSolucionFecha: activity.evaluacion?.publicarSolucionFecha || null,
    solucionPublicada: activity.evaluacion?.solucionPublicada || false,
  })
  const [visForm, setVisForm] = useState({
    visibilidadMode: activity.publishedAt ? 'published' : (activity.publishAt ? 'schedule' : 'hide'),
    publishAt: activity.publishAt || '',
    fechaLimite: activity.fechaLimite ? withDefaultTime(activity.fechaLimite, '00:00') : '',
  })
  const [saving, setSaving] = useState(false)
  const [savingVis, setSavingVis] = useState(false)
  // Resolución de un estudiante (26-ago-2026) — solo lectura, ver
  // ResolucionJuegoModal. null = cerrada; si no, { nombre, sub }.
  const [resolucionAbierta, setResolucionAbierta] = useState(null)
  // Línea base para saber si el docente de verdad cambió algo — "Guardar
  // configuración"/"Guardar disponibilidad" solo se activan si hay una
  // diferencia real contra lo último guardado (23-ago-2026, pedido de Kike:
  // no reguardar lo mismo sin que nada haya cambiado).
  const [formInicial, setFormInicial] = useState(form)
  const [visFormInicial, setVisFormInicial] = useState(visForm)
  const formCambio = JSON.stringify(form) !== JSON.stringify(formInicial)
  const visFormCambio = JSON.stringify(visForm) !== JSON.stringify(visFormInicial)

  async function handleSaveConfig(e) {
    e.preventDefault()
    if (form.publicarResultados === 'fecha') {
      if (!form.publicarResultadosFecha) { toast('Elige la fecha de publicación de resultados', 'error'); return }
      if (form.publicarResultadosFecha <= nowIsoLocal()) { toast('La fecha debe ser posterior a este momento', 'error'); return }
    }
    if (form.publicarSolucion === 'fecha') {
      if (!form.publicarSolucionFecha) { toast('Elige la fecha de publicación de la solución', 'error'); return }
      if (form.publicarSolucionFecha <= nowIsoLocal()) { toast('La fecha debe ser posterior a este momento', 'error'); return }
    }
    const toSave = { ...activity.evaluacion, ...form }
    if (toSave.publicarResultados === 'ahora') toSave.resultadosPublicados = true
    if (toSave.publicarSolucion === 'ahora') toSave.solucionPublicada = true
    setSaving(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), { evaluacion: toSave })
      onActivityChange((prev) => ({ ...prev, evaluacion: toSave }))
      setFormInicial(form)
      toast('Configuración guardada')
    } catch (err) {
      toast(err.message || 'No se pudo guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveVisibilidad(e) {
    e.preventDefault()
    const mode = visForm.visibilidadMode
    const nowIso = new Date().toISOString()
    const payload = {
      oculta: mode !== 'show' && mode !== 'published',
      publishAt: mode === 'schedule' ? (visForm.publishAt || null) : null,
      publishedAt: activity.publishedAt || (mode === 'show' ? nowIso : null),
      fechaLimite: visForm.fechaLimite || null,
    }
    setSavingVis(true)
    try {
      await updateDoc(doc(db, 'activities', activityId), payload)
      onActivityChange((prev) => ({ ...prev, ...payload }))
      setVisFormInicial(visForm)
      toast('Disponibilidad guardada')
    } catch (err) {
      toast(err.message || 'No se pudo guardar', 'error')
    } finally {
      setSavingVis(false)
    }
  }

  const isDraft = !activity.publishedAt && !activity.publishAt

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
        <div className="px-4 py-3 bg-accent-light border-b border-accent">
          <h2 className="font-semibold text-accent">Disponibilidad</h2>
        </div>
        <form onSubmit={handleSaveVisibilidad} className="p-4 space-y-3">
          <VisibilitySelect
            mode={visForm.visibilidadMode}
            publishAt={visForm.publishAt}
            publishedAt={activity.publishedAt}
            isDraft={isDraft}
            onModeChange={(mode) => setVisForm((f) => ({ ...f, visibilidadMode: mode }))}
            onPublishAtChange={(v) => setVisForm((f) => ({ ...f, publishAt: v }))}
          />
          <div>
            <label htmlFor="juego-fecha-limite" className="block text-sm font-medium text-muted mb-1">
              Fecha límite <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <EFDateTimePicker
              mode="datetime"
              headerLabel="Fecha y hora límite"
              value={visForm.fechaLimite}
              onChange={(v) => setVisForm((f) => ({ ...f, fechaLimite: v }))}
              placeholder="Sin fecha límite…"
              clearable
            />
          </div>
          <button type="submit" disabled={savingVis || !visFormCambio}
            className="w-full py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60 flex items-center justify-center gap-2">
            {savingVis ? <Spinner size="sm" /> : <Pencil size={16} />}
            {savingVis ? 'Guardando…' : 'Guardar disponibilidad'}
          </button>
        </form>
      </div>

      <div className="rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
        <div className="px-4 py-3 bg-accent-light border-b border-accent">
          <h2 className="font-semibold text-accent">Configuración</h2>
        </div>
        <form onSubmit={handleSaveConfig} className="p-4 space-y-3">
          <div>
            <label htmlFor="juego-tiempo" className="block text-sm font-medium text-muted mb-1">Tiempo límite (minutos)</label>
            <input id="juego-tiempo" type="number" min="1" value={form.tiempoLimiteMin ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, tiempoLimiteMin: e.target.value ? parseInt(e.target.value, 10) : null }))}
              placeholder="Sin límite" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
          </div>
          <div>
            <label htmlFor="juego-intentos" className="block text-sm font-medium text-muted mb-1">Intentos permitidos</label>
            <input id="juego-intentos" type="number" min="1" value={form.intentosPermitidos ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, intentosPermitidos: e.target.value ? parseInt(e.target.value, 10) : null }))}
              placeholder="Ilimitados" className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface" />
          </div>
          {form.intentosPermitidos !== 1 && (
            <Select
              id="juego-conservar"
              label="Si hay varios intentos, conservar"
              value={form.conservar}
              onChange={(v) => setForm((f) => ({ ...f, conservar: v }))}
              options={[
                { value: 'primero', label: 'El primer intento' },
                { value: 'ultimo', label: 'El último intento' },
                { value: 'mejor', label: 'La calificación más alta' },
                { value: 'promedio', label: 'El promedio de todos los intentos' },
              ]}
            />
          )}
          <PublicacionScheduler
            id="juego-publicar-resultados"
            label="Publicar resultados (calificación)"
            mode={form.publicarResultados}
            fecha={form.publicarResultadosFecha}
            onModeChange={(v) => setForm((f) => ({ ...f, publicarResultados: v }))}
            onFechaChange={(v) => setForm((f) => ({ ...f, publicarResultadosFecha: v }))}
          />
          <PublicacionScheduler
            id="juego-publicar-solucion"
            label="Publicar solución"
            hint="El alumno solo puede verla cuando ya agotó todos sus intentos."
            mode={form.publicarSolucion}
            fecha={form.publicarSolucionFecha}
            onModeChange={(v) => setForm((f) => ({ ...f, publicarSolucion: v }))}
            onFechaChange={(v) => setForm((f) => ({ ...f, publicarSolucionFecha: v }))}
          />
          <button type="submit" disabled={saving || !formCambio}
            className="w-full py-2 bg-accent text-white text-sm font-medium rounded disabled:opacity-60">
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </form>
      </div>

      <div className="rounded-card overflow-hidden bg-surface-card shadow-card border border-accent">
        <div className="px-4 py-3 bg-accent-light border-b border-accent">
          <h2 className="font-semibold text-accent">Resultados</h2>
        </div>
        <div className="divide-y divide-outline-variant">
          {students.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Sin estudiantes en esta asignatura</p>
          )}
          {students.map((st) => {
            const sub = submissions?.[st.id]
            // Solo hay resolución que consultar cuando el intento ya fue
            // calificado por el servidor (onJuegoFinalizado) — un intento
            // 'en_progreso' o sin entregar nunca llega a este estado, así
            // que se mantiene igual que antes (fila no interactiva).
            const consultable = sub?.estado === 'calificado'
            const nombre = studentFullName(st)
            return consultable ? (
              <button
                key={st.id}
                type="button"
                onClick={() => setResolucionAbierta({ nombre, sub })}
                data-tooltip="Ver la resolución de este estudiante"
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--accent-tint)] transition-colors"
              >
                <p className="text-sm text-accent underline decoration-dotted truncate">{nombre}</p>
                <span className="flex items-center gap-3 flex-shrink-0">
                  {sub.tiempoSegundos != null && (
                    <span className="text-xs text-muted tabular-nums">⏱ {formatTiempo(sub.tiempoSegundos)}</span>
                  )}
                  <span className="text-sm font-semibold text-accent tabular-nums">{sub.calificacion}</span>
                </span>
              </button>
            ) : (
              <div key={st.id} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-sm text-on-surface truncate">{nombre}</p>
                <p className="text-sm font-semibold text-accent tabular-nums">
                  {sub?.calificacion != null ? sub.calificacion : '—'}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {resolucionAbierta && (
        <ResolucionJuegoModal
          open
          onClose={() => setResolucionAbierta(null)}
          estudianteNombre={resolucionAbierta.nombre}
          estructura={activity.juego?.estructura}
          submission={resolucionAbierta.sub}
        />
      )}
    </div>
  )
}
