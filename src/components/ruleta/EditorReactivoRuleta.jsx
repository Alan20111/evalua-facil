// La Ruleta del Destino · agregar o editar UN reactivo (fase 2): enunciado, 4 opciones y la correcta. Se valida aquí
// con la misma regla que el servidor (validarReactivo) y se avisa de un enunciado que ya está en el banco; quien
// decide es el servidor, que vuelve a validar y rechaza los duplicados.
import { useState } from 'react'
import { Button, Input, Modal, Radio, Textarea } from '../ui'
import { MOTIVOS_REACTIVO, RULETA_CFG, normalizarTexto, validarReactivo } from '../../utils/ruletaDestino'

const LETRAS = ['A', 'B', 'C', 'D']

function inicial(reactivo) {
  if (reactivo) return { enunciado: reactivo.enunciado || '', opciones: [...(reactivo.opciones || [])], correcta: reactivo.correcta ?? 0 }
  return { enunciado: '', opciones: ['', '', '', ''], correcta: 0 }
}

// `enunciadosEnUso`: enunciados normalizados de los DEMÁS reactivos del banco (para avisar de un duplicado).
export default function EditorReactivoRuleta({ open, reactivo = null, enunciadosEnUso = new Set(), onClose, onGuardar }) {
  const [f, setF] = useState(() => inicial(reactivo))
  const [guardando, setGuardando] = useState(false)
  const [tocado, setTocado] = useState(false)

  const validez = validarReactivo({ id: 'borrador', ...f })
  const duplicado = f.enunciado.trim() !== '' && enunciadosEnUso.has(normalizarTexto(f.enunciado))
  const primerError = validez.errores.find((e) => e !== 'id')
  const setOpcion = (i, texto) => setF((s) => ({ ...s, opciones: s.opciones.map((o, j) => (j === i ? texto : o)) }))

  async function guardar() {
    setTocado(true)
    if (!validez.ok || duplicado) return
    setGuardando(true)
    try {
      await onGuardar({ enunciado: f.enunciado, opciones: f.opciones, correcta: f.correcta })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={guardando ? undefined : onClose} title={reactivo ? 'Editar reactivo' : 'Nuevo reactivo'} size="lg" busy={guardando}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} busy={guardando}>Guardar reactivo</Button>
        </div>
      )}>
      <div className="space-y-4">
        <Textarea label="Pregunta" value={f.enunciado} rows={3} autoResize maxLength={RULETA_CFG.MAX_ENUNCIADO}
          onChange={(e) => setF((s) => ({ ...s, enunciado: e.target.value }))}
          error={duplicado ? 'Ya hay un reactivo con esta pregunta en el banco.' : tocado && !f.enunciado.trim() ? MOTIVOS_REACTIVO.enunciado : undefined} />
        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-muted mb-1">Opciones (marca la correcta)</legend>
          {f.opciones.map((o, i) => (
            <div key={LETRAS[i]} className="flex items-center gap-2">
              <Radio name="ruleta-correcta" checked={f.correcta === i} onChange={() => setF((s) => ({ ...s, correcta: i }))}
                aria-label={`La opción ${LETRAS[i]} es la correcta`} />
              <span className="w-5 text-sm font-semibold text-muted flex-shrink-0" aria-hidden="true">{LETRAS[i]}</span>
              <Input aria-label={`Opción ${LETRAS[i]}`} value={o} maxLength={RULETA_CFG.MAX_OPCION}
                onChange={(e) => setOpcion(i, e.target.value)} wrapperClassName="flex-1" />
            </div>
          ))}
        </fieldset>
        {tocado && primerError && primerError !== 'enunciado' && (
          <p role="alert" className="text-sm text-red-600">{MOTIVOS_REACTIVO[primerError] || 'Revisa el reactivo.'}</p>
        )}
      </div>
    </Modal>
  )
}
