// Eliminar una asignatura completa (F-09, nov-2026). El borrado lo hace el SERVIDOR
// (/api/subject/eliminar-asignatura, api/_lib/eliminarAsignatura.js) por partes: cada llamada trabaja unos segundos,
// guarda su avance y responde `en_curso` o `completa`. Aquí solo se llama otra vez hasta que el servidor confirme que
// terminó. Si algo falla (red, servidor), se lanza un Error: volver a llamar continúa donde se quedó, sin repetir ni
// borrar nada ajeno.
import { auth } from '../firebase'
import { fetchApi } from './apiBase'

const MAX_LLAMADAS = 500 // tope de seguridad (una asignatura enorme necesita decenas, no cientos)
const MAX_ESPERAS_EN_CURSO = 40 // «ya está en curso en otra ventana»: se espera y se reintenta
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function llamar(subjectId, confirmacion) {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetchApi('/api/subject/eliminar-asignatura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ subjectId, confirmacion }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json?.error || 'No se pudo completar. Vuelve a intentarlo.'), { status: res.status, codigo: json?.codigo || null })
  return json
}

/**
 * Elimina la asignatura en el servidor. `confirmacion` = el nombre exacto que escribió el docente.
 * `onProgreso({ fase, etiqueta, avance })` se llama tras cada parte. Resuelve solo cuando el servidor responde
 * `completa`; si no, lanza un Error con el mensaje para el docente.
 */
export async function eliminarAsignaturaEnServidor(subjectId, confirmacion, onProgreso) {
  let enCurso = 0
  for (let i = 0; i < MAX_LLAMADAS; i++) {
    let r
    try {
      r = await llamar(subjectId, confirmacion)
    } catch (e) {
      if (e.codigo === 'EN_CURSO' && enCurso < MAX_ESPERAS_EN_CURSO) { enCurso += 1; await esperar(3000); continue }
      throw e
    }
    onProgreso?.(r)
    if (r.estado === 'completa') return r
    if (r.esperaMs) await esperar(Math.min(r.esperaMs, 15_000))
  }
  throw new Error('La eliminación está tardando más de lo normal. Vuelve a intentarlo: continuará donde se quedó.')
}
