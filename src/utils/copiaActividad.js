// Copiar una actividad — la ÚNICA definición de QUÉ campos viajan a la copia.
//
// Había tres listas blancas paralelas, escritas a mano y mantenidas por
// separado (traer de otra asignatura, duplicar asignatura completa, duplicar
// dentro de la misma asignatura). Cuando llegaron Crucigrama/Sopa de letras
// (22-ago-2026) nadie actualizó ninguna de las tres: la copia perdía
// `tipoJuego` y el objeto `juego` entero, así que llegaba al destino como una
// actividad de categoría 'juego' SIN juego — sin nombre, sin palabras, sin
// tablero, imposible de construir (construirJuego exige `tipoJuego`) e
// imposible de publicar (firestore.rules exige `juego.estado`).
//
// De aquí en adelante los tres caminos comparten este archivo: agregar un
// campo nuevo a una actividad se hace en UN lugar o no se hace.

// Etiqueta legible del tipo de juego. Mismo ternario que ya vivía suelto en
// JuegoManager, SubjectPage y la ActivityPage del estudiante.
export function etiquetaJuego(a) {
  return a?.tipoJuego === 'sopa_letras' ? 'Sopa de letras' : 'Crucigrama'
}

export function esJuego(a) {
  return a?.categoria === 'juego'
}

// Un juego SOLO se puede copiar cuando ya está confirmado.
//
// No es una restricción cosmética: `confirmarJuego` (functions/juego.js) exige
// una reserva de créditos viva (`juego.idempotencyKeyReserva`) para liquidar, y
// esa clave JAMÁS se copia — es del original. Una copia que naciera en
// 'juego_generado' quedaría por tanto imposible de confirmar, y sin confirmar
// no se puede publicar: un callejón sin salida. Un juego ya confirmado no
// tiene ese problema, porque su contenido ya se cobró en el original y la
// copia nace lista, sin volver a tocar el ledger.
export function esCopiable(a) {
  if (!esJuego(a)) return true
  return a?.juego?.estado === 'juego_confirmado'
}

// Los juegos nacen sin nombre (CrearJuegoIAModal los crea con `nombre: ''` y
// la IA tampoco se lo pone), así que la copia de un juego que el docente nunca
// nombró se queda con la etiqueta de su tipo en vez de una fila en blanco.
export function nombreParaCopia(a) {
  return a?.nombre || (esJuego(a) ? etiquetaJuego(a) : '')
}

// Lo que hace que un juego siga siendo un juego en el destino: su tipo y su
// objeto `juego` completo (modalidad, cantidadPalabras, tamanoSopa, contenido,
// estado y estructura).
//
// MENOS `idempotencyKeyReserva`, que se descarta a propósito y nunca debe
// viajar: apunta a la reserva de créditos del juego ORIGINAL. Copiarla haría
// que confirmar la copia liquidara la reserva del original, y que cancelar la
// copia la anulara — una actividad rompiendo el cobro de otra. La copia no
// necesita reserva alguna: nace ya confirmada (esCopiable lo garantiza) y no
// vuelve a pasar por confirmarJuego.
export function camposJuegoCopia(src) {
  if (!esJuego(src) || !src.juego) return {}
  const juego = { ...src.juego }
  delete juego.idempotencyKeyReserva
  return { tipoJuego: src.tipoJuego, juego }
}

// Campos comunes a los tres caminos de copia. Lo que NO va aquí porque cada
// camino lo decide por su cuenta: `nombre`, `parcial`, `orden`,
// `asignaturaId`, `docenteId`, `createdAt` y la visibilidad
// (oculta/publishAt/publishedAt).
//
// `fechaLimite: null` siempre — la del ciclo anterior casi siempre ya pasó, y
// la copia nacería vencida.
export function camposComunesCopia(src) {
  const juegoDeVerdad = esJuego(src)
  return {
    categoria: src.categoria || 'entregable',
    maxCalif: src.maxCalif ?? 10,
    instrucciones: src.instrucciones || '',
    archivosAdjuntos: src.archivosAdjuntos || [],
    fechaLimite: null,
    // Un juego no se entrega como archivo: no tiene `tipo` ni `tiposArchivo`
    // ni `extensionesCustom`, y la copia no debe inventárselos — tiene que
    // quedar con la MISMA forma que el original.
    ...(juegoDeVerdad ? {} : {
      tiposArchivo: src.tiposArchivo || 'imagenes',
      extensionesCustom: src.extensionesCustom || '',
      tipo: src.tipo || 'archivo',
    }),
    // La rúbrica vive como COPIA embebida en la actividad (rubrica.js:
    // snapshotRubrica), no como referencia; `rubricaId` solo apunta al origen
    // en bancoRubricas para que el picker marque "Usando ✓".
    rubrica: src.rubrica || null,
    rubricaId: src.rubricaId || null,
    // La ponderación es configuración del docente sobre ESTA actividad, no
    // estado del ciclo anterior.
    pesoCalificacion: src.pesoCalificacion ?? null,
    // `resultadosPublicados`/`respuestasPublicadas`/`solucionPublicada` son
    // ESTADO del ciclo anterior, no configuración: la copia no debe enseñar
    // calificaciones, respuestas correctas ni la solución de entrada.
    ...(src.evaluacion ? {
      evaluacion: {
        ...src.evaluacion,
        resultadosPublicados: false,
        respuestasPublicadas: false,
        solucionPublicada: false,
      },
    } : {}),
    ...camposJuegoCopia(src),
  }
}
