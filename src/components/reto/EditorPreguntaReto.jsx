// Reto Exprés · agregar o editar UNA pregunta (opción múltiple o verdadero/falso). Sin imágenes (S3) ni opción
// «Otra». La validación es la misma que se usa al importar (reactivoCompatibleReto).
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, Modal, Radio, RadioGroup, Select, Textarea } from '../ui'
import { MOTIVOS_INCOMPATIBLE, RETO_LIMITES, TIEMPO_POR_OMISION_SEG, duracionValida, nuevoIdOpcion, reactivoCompatibleReto } from '../../utils/retoExpres'
import { OPCIONES_TIEMPO_RETO } from './opcionesReto'

const TIPOS = [
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
]

function inicial(pregunta) {
  if (pregunta?.tipo === 'verdadero_falso') {
    return { tipo: 'verdadero_falso', enunciado: pregunta.enunciado || '', opciones: [nuevaOpcion(), nuevaOpcion()], correctaOM: null, correctaVF: pregunta.respuestaCorrecta === 'f' ? 'f' : 'v' }
  }
  if (pregunta?.tipo === 'opcion_multiple') {
    const opciones = (pregunta.opciones || []).map((o) => ({ id: o.id, texto: o.texto || '' }))
    return { tipo: 'opcion_multiple', enunciado: pregunta.enunciado || '', opciones, correctaOM: pregunta.respuestaCorrecta ?? opciones[0]?.id ?? null, correctaVF: 'v' }
  }
  const opciones = [nuevaOpcion(), nuevaOpcion(), nuevaOpcion(), nuevaOpcion()]
  return { tipo: 'opcion_multiple', enunciado: '', opciones, correctaOM: opciones[0].id, correctaVF: 'v' }
}
function nuevaOpcion() {
  return { id: nuevoIdOpcion(), texto: '' }
}

// `tiempoPorOmision`: el del reto, con el que nace una pregunta nueva (o una vieja sin tiempo propio).
export default function EditorPreguntaReto({ open, pregunta = null, tiempoPorOmision = TIEMPO_POR_OMISION_SEG, onClose, onGuardar }) {
  const [f, setF] = useState(() => inicial(pregunta))
  const [tiempoSeg, setTiempoSeg] = useState(() => (duracionValida(pregunta?.tiempoSeg) ? pregunta.tiempoSeg
    : duracionValida(tiempoPorOmision) ? tiempoPorOmision : TIEMPO_POR_OMISION_SEG))
  const [guardando, setGuardando] = useState(false)
  const [tocado, setTocado] = useState(false)

  const datos = f.tipo === 'verdadero_falso'
    ? { tipo: 'verdadero_falso', enunciado: f.enunciado, respuestaCorrecta: f.correctaVF, opciones: [{ id: 'v', texto: 'Verdadero' }, { id: 'f', texto: 'Falso' }] }
    : { tipo: 'opcion_multiple', enunciado: f.enunciado, opciones: f.opciones.filter((o) => o.texto.trim()), respuestaCorrecta: f.correctaOM }
  const validez = reactivoCompatibleReto(datos)
  const largo = f.enunciado.trim().length

  const setOpcion = (id, texto) => setF((s) => ({ ...s, opciones: s.opciones.map((o) => (o.id === id ? { ...o, texto } : o)) }))
  const quitarOpcion = (id) => setF((s) => {
    const opciones = s.opciones.filter((o) => o.id !== id)
    return { ...s, opciones, correctaOM: s.correctaOM === id ? (opciones[0]?.id ?? null) : s.correctaOM }
  })

  async function guardar() {
    setTocado(true)
    if (!validez.ok) return
    setGuardando(true)
    try {
      await onGuardar({ ...datos, tiempoSeg })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title={pregunta ? 'Editar pregunta' : 'Nueva pregunta'} size="lg" busy={guardando}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} busy={guardando}>Guardar pregunta</Button>
        </div>
      )}>
      <div className="space-y-4">
        <RadioGroup label="Tipo" name="reto-pregunta-tipo" options={TIPOS} value={f.tipo} onChange={(tipo) => setF((s) => ({ ...s, tipo }))} />
        <div>
          <Textarea label="Enunciado" value={f.enunciado} rows={3} autoResize maxLength={RETO_LIMITES.MAX_ENUNCIADO}
            onChange={(e) => setF((s) => ({ ...s, enunciado: e.target.value }))}
            hint={`${largo} caracteres · se recomiendan ${RETO_LIMITES.ENUNCIADO_RECOMENDADO} como máximo para leerla rápido en el celular`}
            error={tocado && !largo ? 'Escribe el enunciado.' : undefined} />
        </div>
        {f.tipo === 'opcion_multiple' ? (
          <fieldset className="space-y-2">
            <legend className="block text-sm font-medium text-muted mb-1">Opciones (marca la correcta)</legend>
            {f.opciones.map((o, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <Radio name="reto-correcta" checked={f.correctaOM === o.id} onChange={() => setF((s) => ({ ...s, correctaOM: o.id }))}
                  aria-label={`Opción ${String.fromCharCode(65 + i)} es la correcta`} />
                <Input aria-label={`Opción ${String.fromCharCode(65 + i)}`} value={o.texto} maxLength={RETO_LIMITES.MAX_OPCION}
                  onChange={(e) => setOpcion(o.id, e.target.value)} wrapperClassName="flex-1" />
                <IconButton icon={Trash2} label={`Quitar opción ${String.fromCharCode(65 + i)}`} disabled={f.opciones.length <= RETO_LIMITES.MIN_OPCIONES}
                  onClick={() => quitarOpcion(o.id)} />
              </div>
            ))}
            {f.opciones.length < RETO_LIMITES.MAX_OPCIONES && (
              <Button variant="quiet" size="sm" icon={Plus} onClick={() => setF((s) => ({ ...s, opciones: [...s.opciones, nuevaOpcion()] }))}>Agregar opción</Button>
            )}
          </fieldset>
        ) : (
          <RadioGroup label="Respuesta correcta" name="reto-vf" value={f.correctaVF} onChange={(v) => setF((s) => ({ ...s, correctaVF: v }))}
            options={[{ value: 'v', label: 'Verdadero' }, { value: 'f', label: 'Falso' }]} />
        )}
        <Select label="Tiempo para responder" value={tiempoSeg} onChange={(v) => setTiempoSeg(Number(v))} options={OPCIONES_TIEMPO_RETO}
          hint="Empieza a contar cuando aparece la pregunta; al terminar, se cierra sola." />
        {tocado && !validez.ok && largo > 0 && (
          <p role="alert" className="text-sm text-red-600">{MOTIVOS_INCOMPATIBLE[validez.motivo] || 'Revisa la pregunta.'}</p>
        )}
      </div>
    </Modal>
  )
}
