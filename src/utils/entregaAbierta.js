// ¿Puede ESTE estudiante entregar (o volver a entregar) ahora mismo?
//
// Es el espejo en el cliente de `actividadVencidaParaAlumno` en
// firestore.rules, la regla que autoriza crear una entrega. La pantalla del
// estudiante usa esta sola respuesta tanto para mostrar el formulario de
// entrega como para ofrecer "Anular entrega" (anular = poder volver a
// entregar), así que no pueden contradecirse con el servidor:
//
//  · Cierre manual del docente → cerrada, SIEMPRE: una prórroga individual no
//    lo reabre (la regla comprueba `cerradaManual` antes que cualquier fecha).
//  · Si no, el límite del estudiante es su prórroga o, sin ella, la fecha
//    límite del grupo (no se suman), y vence al llegar a ese instante salvo que
//    la actividad reciba tarde.
//
// El instante sale de los espejos en Timestamp (`fechaLimiteTS`,
// `extensionesTS`) — lo mismo que compara el servidor. Las actividades
// anteriores a esos campos solo tienen las cadenas `fechaLimite` /
// `extensiones`; para ellas se usa la cadena (una fecha sin hora cierra al
// final del día), igual que siempre.
const ms = (t) => (t == null ? null : typeof t.toMillis === 'function' ? t.toMillis() : typeof t.seconds === 'number' ? t.seconds * 1000 : null)

function limiteDeCadena(activity, alumnoId) {
  const fecha = activity?.fechaLimite
  if (!fecha) return null
  const d = activity?.extensiones?.[alumnoId] || fecha
  return new Date(d.includes('T') ? d : `${d}T23:59:59`).getTime()
}

export function entregaAbiertaParaAlumno(activity, alumnoId, ahora = Date.now()) {
  if (!activity) return false
  if (activity.cerradaManual === true) return false
  let limite = ms(activity.extensionesTS?.[alumnoId]) ?? ms(activity.fechaLimiteTS)
  if (limite == null && activity.fechaLimiteTS == null && activity.extensionesTS == null) {
    limite = limiteDeCadena(activity, alumnoId)
  }
  return !(limite != null && ahora >= limite && activity.recibirTarde !== true)
}
