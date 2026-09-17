// Observaciones de Asistencias — piezas PURAS (sin Firebase) para poder
// probarlas en test/unidad.test.mjs: id de la observación, orden y etiqueta de
// la bitácora, y el documento HTML que se imprime.
//
// Una observación es un registro escrito por el docente sobre una CELDA de
// asistencia (estudiante + fecha + hora de clase). Vive en su propia colección
// (`observacionesAsistencia`), nunca dentro de `attendance`: así no la lee
// ningún otro docente, no despierta onAttendanceEscrita y sobrevive cuando se
// elimina o se restaura el día (ver src/utils/observacionesAsistencia.js).

export const MAX_TEXTO_OBSERVACION = 2000

// Id determinista armado con lo que IDENTIFICA a la celda (asignatura, fecha,
// hora y estudiante) y no con el id del documento de asistencia: la mayoría de
// los documentos viejos de `attendance` tienen id aleatorio (medido el
// 17-sep-2026: 853 de 865), y un día eliminado y restaurado recibe otro. Así
// la observación vuelve a aparecer sola en su celda.
export function observacionId(asignaturaId, fecha, slot, alumnoId) {
  return `${asignaturaId}_${fecha}_${slot}_${alumnoId}`
}

// Llave de la celda dentro de UNA asignatura (la tabla no necesita repetirla).
export function llaveCeldaObservacion(fecha, slot, alumnoId) {
  return `${fecha}_${slot}_${alumnoId}`
}

// La más reciente primero: fecha descendente y, dentro del mismo día, la hora
// de clase más tardía arriba.
export function ordenarBitacora(observaciones) {
  return [...observaciones].sort((a, b) =>
    a.fecha === b.fecha ? (b.slot || 0) - (a.slot || 0) : b.fecha.localeCompare(a.fecha))
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// 'YYYY-MM-DD' → 'miércoles 29/sep/2026'. En hora local a propósito: armar la
// fecha desde la cadena la tomaría como UTC y en México correría un día.
export function fechaObservacion(fecha) {
  const [y, m, d] = String(fecha || '').split('-').map(Number)
  if (!y || !m || !d) return String(fecha || '')
  return `${DIAS[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${MESES[m - 1]}/${y}`
}

// La hora solo se escribe cuando hace falta para distinguir sesiones del mismo
// día: si ese día tiene (o tuvo) más de una hora de clase, o si hay más de una
// observación en esa fecha, o si no es la primera hora.
//   fechasVariasHoras: Set de fechas con más de una hora en la asistencia actual.
export function etiquetaFechaObservacion(obs, { fechasVariasHoras, observaciones } = {}) {
  const base = fechaObservacion(obs.fecha)
  const variasObs = (observaciones || []).filter((o) => o.fecha === obs.fecha).length > 1
  const conHora = (obs.slot || 1) > 1 || variasObs || !!fechasVariasHoras?.has(obs.fecha)
  return conHora ? `${base} · ${obs.slot || 1}ª hora` : base
}

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Documento independiente de la interfaz: solo título, estudiante, asignatura,
// docente y la tabla Fecha | Observación. Sin botones ni navegación.
//   filas: [{ fecha: 'etiqueta ya formateada', texto }]
export function htmlBitacoraImprimible({ estudiante, asignatura, docente, filas }) {
  const cuerpo = filas.length
    ? filas.map((f) => `<tr><td class="fecha">${escaparHtml(f.fecha)}</td><td class="texto">${escaparHtml(f.texto)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="vacio">Sin observaciones registradas.</td></tr>'
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escaparHtml(`Bitácora de observaciones - ${estudiante}`)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; }
  h1 { font-size: 16pt; margin: 0 0 10pt; }
  .datos { margin: 0 0 14pt; }
  .datos p { margin: 0 0 3pt; }
  .datos strong { display: inline-block; min-width: 72pt; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10pt; }
  td.fecha { width: 32%; white-space: nowrap; }
  td.texto { white-space: pre-wrap; overflow-wrap: anywhere; }
  td.vacio { text-align: center; color: #555; }
</style>
</head>
<body>
<h1>Bitácora de observaciones</h1>
<div class="datos">
  <p><strong>Estudiante:</strong> ${escaparHtml(estudiante)}</p>
  <p><strong>Asignatura:</strong> ${escaparHtml(asignatura)}</p>
  <p><strong>Docente:</strong> ${escaparHtml(docente)}</p>
</div>
<table>
  <thead><tr><th>Fecha</th><th>Observación</th></tr></thead>
  <tbody>${cuerpo}</tbody>
</table>
</body>
</html>`
}
