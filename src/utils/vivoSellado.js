// Participación en vivo — SELLADO de las preguntas cerradas (lógica única).
//
// Lo usan el control del docente (api/_lib/vivoControl.js) y el barrido programado de functions
// (`recuperarAnalisisVivo`), que lo copia a functions/_shared con scripts/sync-functions-shared.mjs. Recibe `db`
// (Firestore Admin) como parámetro: no importa nada.
//
// Sellar una ventana ya cerrada registra cuántos respondieron y, en la modalidad de grupo, quiénes NO (sin respuesta), y
// apaga `aceptando` de la pregunta vigente (lo que despierta su diagnóstico). NO crea ni modifica respuestas ni notas, y
// NO toca la hora límite: el cierre lo decide siempre `estadoPreguntaVivo`. Es idempotente: la decisión se toma dentro de
// una transacción que comprueba `sellada`, así que ejecuciones simultáneas escriben una sola vez.

// ¿La ventana ya cerró (por tiempo o de forma anticipada) a la hora `ahora`?
export function ventanaCerrada(v, ahora) {
  return !!v && ((v.cerradaMs != null && ahora >= v.cerradaMs) || (v.cierraMs != null && ahora >= v.cierraMs))
}

export const sellarVentana = async (db, codigo, ses, preguntaId, ahora) => {
  const ref = db.doc(`vivoSesiones/${codigo}`)
  const v = (ses.ventanas || {})[preguntaId]
  if (!v || v.sellada || !ventanaCerrada(v, ahora)) return false
  const resp = await db.collection('vivoRespuestas').where('sesionId', '==', codigo).where('preguntaId', '==', preguntaId).get()
  const respondieron = new Set(resp.docs.map((d) => d.data().alumnoId).filter(Boolean))
  let sinRespuesta = null
  let esperados = null
  if (ses.acceso === 'grupo') {
    const roster = await db.collection('students').where('asignaturaId', '==', ses.asignaturaId).get()
    const ids = roster.docs.map((d) => d.id)
    esperados = ids.length
    sinRespuesta = ids.filter((id) => !respondieron.has(id)).slice(0, 500)
  }
  return db.runTransaction(async (tx) => {
    const actual = (await tx.get(ref)).data()
    const vigente = (actual?.ventanas || {})[preguntaId]
    // Otra ejecución ya selló, o la ventana ya no está cerrada: no se escribe nada.
    if (!actual || vigente?.sellada || !ventanaCerrada(vigente, ahora)) return false
    const esVigente = (actual.preguntas || [])[actual.preguntaIndex]?.id === preguntaId
    tx.update(ref, {
      // Cerrar la pregunta vigente por tiempo no escribía nada: aquí se apaga `aceptando` (lo que despierta el diagnóstico de la pregunta).
      ...(esVigente ? { aceptando: false } : {}),
      [`ventanas.${preguntaId}.sellada`]: true,
      [`ventanas.${preguntaId}.selladaMs`]: ahora,
      [`ventanas.${preguntaId}.motivo`]: vigente.motivo || (vigente.cerradaMs != null ? 'manual' : 'tiempo'),
      [`ventanas.${preguntaId}.cerradaMs`]: vigente.cerradaMs ?? vigente.cierraMs,
      [`ventanas.${preguntaId}.respondieron`]: resp.size,
      [`ventanas.${preguntaId}.esperados`]: esperados,
      [`ventanas.${preguntaId}.sinRespuesta`]: sinRespuesta,
    })
    return true
  })
}

/**
 * Sella todas las ventanas cerradas y sin sellar de una sesión. `graciaMs`: solo se sellan las que cerraron hace al menos
 * ese tiempo (el barrido automático lo usa como margen entre relojes); NO altera cuándo cierra una pregunta ni qué
 * respuestas se aceptan: eso lo decide el servidor al recibirlas. Devuelve cuántas selló.
 */
export const sellarVentanasVencidas = async (db, codigo, ahora, graciaMs = 0) => {
  const ses = (await db.doc(`vivoSesiones/${codigo}`).get()).data()
  let selladas = 0
  for (const [id, v] of Object.entries(ses?.ventanas || {})) {
    if (v.sellada || !ventanaCerrada(v, ahora - graciaMs)) continue
    if (await sellarVentana(db, codigo, ses, id, ahora)) selladas += 1
  }
  return selladas
}
