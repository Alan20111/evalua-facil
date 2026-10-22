// Contador de la pregunta en curso: el MISMO en el proyector y en el celular (misma sesión, mismo reloj de servidor).
//   · abierta con tiempo → minutos:segundos, en rojo oscuro los últimos 5 s;
//   · abierta manual     → «Abierta · la cierra tu docente»;
//   · cerrada            → «Tiempo agotado» (por tiempo) o «Pregunta cerrada».
// `tam` es la letra en px (el contrato de legibilidad del proyector exige ≥ 28 px).
import { formatoTiempo } from '../../utils/proyeccionVivo'

export default function Temporizador({ estado, restanteMs, sesion, tam = 32, className = '' }) {
  let texto
  let tono = 'text-slate-900'
  if (estado === 'abierta' && restanteMs != null) {
    texto = formatoTiempo(restanteMs)
    if (restanteMs <= 5000) tono = 'text-red-800'
  } else if (estado === 'abierta') {
    texto = 'Abierta · la cierra tu docente'
  } else if (estado === 'cerrada') {
    texto = sesion?.cerradaMs == null && sesion?.cierraMs != null ? 'Tiempo agotado' : 'Pregunta cerrada'
    tono = 'text-slate-700'
  } else {
    return null
  }
  const conTiempo = estado === 'abierta' && restanteMs != null
  return (
    <output aria-live="off" aria-label={conTiempo ? `Tiempo restante ${formatoTiempo(restanteMs)}` : texto}
      className={`font-bold tabular-nums leading-none ${tono} ${className}`} style={{ fontSize: conTiempo ? Math.round(tam * 1.6) : tam }}>
      {texto}
    </output>
  )
}
