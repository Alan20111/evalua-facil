import { useState } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../Toast'
import EFDateTimePicker from '../EFDateTimePicker'
import Select from '../ui/Select'
import { Trash2, Copy } from 'lucide-react'
import { useBackHandler } from '../../hooks/useBackHandler'
import { refreshTeacherReminders } from '../../utils/localReminders'
import { subjectDisplayName } from '../../utils/subjectName'
import { Input, Button, IconButton, Modal, MotivoApagado, Tabs, Textarea } from '../ui'

export const EVENT_COLORS = [
  { id: 'slate',  bg: '#f1f5f9', text: '#475569', label: 'Gris' },
  { id: 'blue',   bg: '#dbeafe', text: '#1d4ed8', label: 'Azul' },
  { id: 'green',  bg: '#dcfce7', text: '#15803d', label: 'Verde' },
  { id: 'orange', bg: '#ffedd5', text: '#c2410c', label: 'Naranja' },
  { id: 'purple', bg: '#f3e8ff', text: '#7e22ce', label: 'Morado' },
  { id: 'rose',   bg: '#ffe4e6', text: '#be123c', label: 'Rojo' },
  { id: 'teal',   bg: '#ccfbf1', text: '#0f766e', label: 'Turquesa' },
]

// Contenido de UN tipo de evento. Personal y académico son tipos distintos, no
// dos etiquetas del mismo borrador: cada uno guarda su propio título,
// descripción y notas, y solo el académico tiene `asignaturaId` — así un evento
// personal no puede arrastrar una asignatura ni siquiera en memoria.
function nuevoBorrador(tipo, ev) {
  const base = {
    titulo: ev?.titulo || '',
    descripcion: ev?.descripcion || '',
    notas: ev?.notas || '',
  }
  return tipo === 'academico' ? { ...base, asignaturaId: ev?.asignaturaId || '' } : base
}

export default function EventEditor({ event, defaultDate, subjects = [], onClose, onSaved, onDeleted }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const isNew = !event?.id
  const tipoOriginal = event?.tipo || 'personal'

  const [tipo, setTipo] = useState(tipoOriginal)

  // Un borrador por tipo, independientes entre sí. Solo se precarga el del tipo
  // que el evento tiene guardado; el otro nace vacío, así cambiar de pestaña no
  // copia, conserva ni reutiliza nada del otro tipo. Volver a un tipo ya editado
  // devuelve su contenido tal como se dejó (es su borrador, no una copia).
  const [borradores, setBorradores] = useState(() => ({
    personal:  nuevoBorrador('personal',  tipoOriginal === 'personal'  ? event : null),
    // Con una sola asignatura activa no hay nada que elegir: ya viene puesta.
    academico: nuevoBorrador('academico', tipoOriginal === 'academico' ? event : (subjects.length === 1 ? { asignaturaId: subjects[0].id } : null)),
  }))

  // Compartidos entre ambos tipos a propósito: la fecha/hora es la ranura que
  // el docente eligió al abrir el modal (perderla al cambiar de pestaña sería
  // una regresión) y el color es una elección visual, no información del evento.
  const [fechas, setFechas] = useState({
    inicio: event?.inicio || defaultDate || '',
    fin: event?.fin || '',
  })
  const [color, setColor] = useState(event?.color || 'blue')

  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Lo que ve y edita la pantalla: SIEMPRE el borrador del tipo activo.
  const contenido = borradores[tipo]
  const patchContenido = (patch) => setBorradores(b => ({ ...b, [tipo]: { ...b[tipo], ...patch } }))

  // "Guardar cambios" se apaga sin cambios — compara contra `event`, que no
  // cambia mientras el modal sigue montado (lo abre/cierra el padre). Crear
  // siempre debe poder enviarse, y cambiar de tipo ya es un cambio de por sí
  // (el evento se mueve de colección).
  const eventChanged = isNew || tipo !== tipoOriginal || (
    contenido.titulo.trim() !== (event?.titulo || '') ||
    contenido.descripcion.trim() !== (event?.descripcion || '') ||
    contenido.notas.trim() !== (event?.notas || '') ||
    (contenido.asignaturaId || '') !== (event?.asignaturaId || '') ||
    fechas.inicio !== (event?.inicio || '') ||
    fechas.fin !== (event?.fin || '') ||
    color !== (event?.color || 'blue')
  )

  // Lo obligatorio que falta (PLAN_NORMALIZACION_UI §5.2, regla 6): el botón
  // se apaga y lo dice, en vez de esperar al aviso de faltaAlgo().
  const faltan = [
    !contenido.titulo.trim() && 'el título',
    !fechas.inicio && 'la fecha de inicio',
    tipo === 'academico' && !contenido.asignaturaId && 'la asignatura',
  ].filter(Boolean)

  // Botón atrás físico (Android): si está pidiendo confirmación de borrado,
  // solo la cancela (no cierra todo el editor).
  useBackHandler(() => setConfirmDelete(false), confirmDelete)


  // Personal y académico viven en colecciones DISTINTAS — ver el comentario
  // en firestore.rules sobre por qué `academicEvents` no puede ser solo un
  // campo `tipo` dentro de `events`: Firestore no puede autorizar un `list`
  // por asignaturaId si la regla depende de otro campo (docenteId/tipo) que
  // no es parte del filtro de la consulta.
  const collectionFor = (t) => (t === 'academico' ? 'academicEvents' : 'events')
  const originalCollection = event ? collectionFor(tipoOriginal) : null

  // Solo viaja a Firestore el borrador del tipo activo: el del otro tipo se
  // queda en pantalla y nunca se escribe.
  function construirPayload() {
    return {
      titulo: contenido.titulo.trim(),
      descripcion: contenido.descripcion.trim(),
      notas: contenido.notas.trim(),
      inicio: fechas.inicio,
      fin: fechas.fin || fechas.inicio,
      color,
      docenteId: currentUser.uid,
      tipo,
      asignaturaId: tipo === 'academico' ? contenido.asignaturaId : null,
    }
  }

  // Título e inicio son obligatorios; la asignatura solo en el tipo académico.
  function faltaAlgo() {
    if (!contenido.titulo.trim()) { toast('Escribe un título', 'error'); return true }
    if (!fechas.inicio) { toast('Selecciona la fecha de inicio', 'error'); return true }
    if (tipo === 'academico' && !contenido.asignaturaId) { toast('Elige la asignatura para el evento académico', 'error'); return true }
    return false
  }

  async function handleSave(e) {
    e.preventDefault()
    if (faltaAlgo()) return
    setSaving(true)
    try {
      const payload = construirPayload()
      const targetCollection = collectionFor(tipo)
      if (isNew) {
        const ref = await addDoc(collection(db, targetCollection), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento creado')
      } else if (targetCollection === originalCollection) {
        await updateDoc(doc(db, targetCollection, event.id), payload)
        onSaved?.({ id: event.id, ...payload })
        toast('Evento actualizado')
      } else {
        // Cambió de tipo (personal ↔ académico): hay que moverlo de colección
        // — no hay una forma atómica de "renombrar" la colección de un doc.
        await deleteDoc(doc(db, originalCollection, event.id))
        const ref = await addDoc(collection(db, targetCollection), { ...payload, createdAt: serverTimestamp() })
        onSaved?.({ id: ref.id, ...payload })
        toast('Evento actualizado')
      }
      // Reprograma los recordatorios locales YA — si no, el aviso de "empieza
      // en X min" de este evento no se programa hasta el próximo login o
      // resume de la app (refreshTeacherReminders no se disparaba nunca al
      // crear/editar un evento, solo en esos otros momentos).
      refreshTeacherReminders(currentUser.uid)
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await deleteDoc(doc(db, originalCollection, event.id))
      onDeleted?.(event.id)
      toast('Evento eliminado')
      refreshTeacherReminders(currentUser.uid)
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Duplicar: crea una copia con lo que está en pantalla (mismo horario) —
  // el docente después la arrastra o la edita para acomodarla.
  async function handleDuplicate() {
    if (faltaAlgo()) return
    setSaving(true)
    try {
      await addDoc(collection(db, collectionFor(tipo)), {
        ...construirPayload(),
        createdAt: serverTimestamp(),
      })
      toast('Evento duplicado — arrástralo o edítalo para cambiar su horario')
      refreshTeacherReminders(currentUser.uid)
      onClose()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} variant="centered" size="sm" busy={saving} title={isNew ? 'Nuevo evento' : 'Editar evento'}>
        <form onSubmit={handleSave} className="space-y-3">
          {/* Color: lo elegido es el aro con separación (PLAN_NORMALIZACION_UI
              §5.1); la bolita ya no crece, así nada se mueve ni se recorta. */}
          <fieldset className="grid grid-cols-7 gap-1 justify-items-center p-1">
            <legend className="sr-only">Color del evento</legend>
            {EVENT_COLORS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setColor(c.id)}
                aria-pressed={color === c.id}
                className={`size-control-sm rounded-full border border-outline-variant transition ${color === c.id ? 'ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-105'}`}
                style={{ background: c.bg }}
                data-tooltip={c.label}
                aria-label={c.label}
              />
            ))}
          </fieldset>

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted">Tipo de evento</p>
            <Tabs
              label="Tipo de evento"
              value={tipo}
              onChange={setTipo}
              options={[{ value: 'personal', label: 'Personal' }, { value: 'academico', label: 'Académico' }]}
            />
            {tipo === 'academico' && (
              <>
                <p className="text-sm text-muted">Los estudiantes de esta asignatura lo verán en su Agenda.</p>
                <Select
                  id="event-asignatura"
                  label="Asignatura"
                  value={contenido.asignaturaId}
                  onChange={(v) => patchContenido({ asignaturaId: v })}
                  options={subjects.map(s => ({ value: s.id, label: subjectDisplayName(s) }))}
                />
              </>
            )}
          </div>

          <Input
            label="Título"
            id="event-titulo"
            type="text"
            value={contenido.titulo}
            onChange={e => patchContenido({ titulo: e.target.value })}
            /* Sin autoFocus: en Android (edge-to-edge) enfocar un input y abrir
               el teclado justo al montar el modal deja el WebView con un
               frame en blanco hasta que algo más fuerza un repintado (p. ej.
               el botón físico de atrás) — bug conocido de Chromium/WebView
               con edge-to-edge + insets del teclado cambiando a mitad de la
               animación de entrada del modal. */
            required
          />

          <Textarea
            label="Descripción"
            id="event-descripcion"
            optional
            value={contenido.descripcion}
            onChange={e => patchContenido({ descripcion: e.target.value })}
            rows={2}
          />

          <Textarea
            label="Notas"
            id="event-notas"
            optional
            value={contenido.notas}
            onChange={e => patchContenido({ notas: e.target.value })}
            rows={3}
          />

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted">Inicio</p>
            <EFDateTimePicker
              mode="datetime"
              value={fechas.inicio}
              onChange={v => setFechas(f => ({ ...f, inicio: v, fin: f.fin && f.fin < v ? v : f.fin }))}
              etiqueta="Fecha y hora de inicio"
              clearable={false}
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted">Fin <span className="font-normal text-hint">(opcional)</span></p>
            <EFDateTimePicker
              mode="datetime"
              value={fechas.fin}
              onChange={v => setFechas(f => ({ ...f, fin: v }))}
              etiqueta="Fecha y hora de fin (opcional)"
              clearable
            />
          </div>

          <div className="pie-hoja">
            <div className="flex gap-2">
              {!isNew && (
                confirmDelete ? (
                  <Button variant="danger" onClick={handleDelete} busy={saving}>
                    Confirmar eliminación
                  </Button>
                ) : (
                  <IconButton icon={Trash2} label="Eliminar" variant="danger" onClick={() => setConfirmDelete(true)} />
                )
              )}
              {!isNew && !confirmDelete && (
                <IconButton icon={Copy} label="Duplicar" onClick={handleDuplicate} disabled={saving} />
              )}
              <Button className="flex-1" type="submit" busy={saving} disabled={faltan.length > 0 || !eventChanged}>
                {isNew ? 'Crear evento' : 'Guardar cambios'}
              </Button>
            </div>
            <MotivoApagado faltan={faltan} sinCambios={!eventChanged} />
          </div>
        </form>
    </Modal>
  )
}
