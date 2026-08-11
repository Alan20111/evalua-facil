// OP-09 · Reactivos de un cuestionario o examen, generados con IA.
//
// Mismo principio que utils/rubrica.js: el servidor (functions/ia.js) ya
// normaliza la propuesta y fuerza el tipo exacto por posición — aquí solo se
// vuelve a acotar la cantidad (por si acaso) y se da forma al reactivo que
// espera el editor de evaluaciones (EvaluacionEditor.jsx), que es quien luego
// arma las opciones con id y llama a crearPreguntasEnLote.

export const MIN_REACTIVOS = 2
export const MAX_REACTIVOS = 10
export const DEFAULT_REACTIVOS = 5

export const TIPOS_REACTIVO_IA = [
  { value: 'mixto', label: 'Mixto' },
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'verdadero_falso', label: 'Verdadero / Falso' },
  { value: 'respuesta_corta', label: 'Respuesta corta' },
  { value: 'subir_archivo', label: 'Subir documento' },
]

const limpiar = (v, max) => String(v ?? '').trim().slice(0, max)

// `propuesta` = { reactivos: [{ tipo, enunciado, opciones?, correcta?, respuestaEsperada? }] }
export function reactivosDesdePropuesta(propuesta, cantidad = DEFAULT_REACTIVOS) {
  const n = Math.min(MAX_REACTIVOS, Math.max(MIN_REACTIVOS, cantidad))
  const lista = (Array.isArray(propuesta?.reactivos) ? propuesta.reactivos : []).slice(0, n)
  return lista.map((r) => {
    const tipo = r?.tipo || 'opcion_multiple'
    const base = { tipo, enunciado: limpiar(r?.enunciado, 500), incluir: true }
    if (tipo === 'opcion_multiple') {
      const opciones = Array.from({ length: 4 }, (_, i) => limpiar(r?.opciones?.[i], 300))
      const idx = Number.isInteger(r?.correcta) ? Math.min(3, Math.max(0, r.correcta)) : 0
      return { ...base, opciones, correcta: idx }
    }
    if (tipo === 'verdadero_falso') {
      return { ...base, correcta: r?.correcta === 'f' ? 'f' : 'v' }
    }
    if (tipo === 'respuesta_corta') {
      return { ...base, respuestaEsperada: limpiar(r?.respuestaEsperada, 300) }
    }
    return base // subir_archivo
  })
}

// Un reactivo de la propuesta es válido para guardarse si tiene enunciado y,
// para opción múltiple, al menos 2 opciones con texto.
export function reactivoValido(r) {
  if (!r?.enunciado?.trim()) return false
  if (r.tipo === 'opcion_multiple') {
    return (r.opciones || []).filter((o) => o?.trim()).length >= 2
  }
  return true
}
