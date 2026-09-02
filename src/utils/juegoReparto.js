// A25 — Las tres decisiones PURAS del reparto público/privado de un juego.
//
// Viven aparte de src/utils/juegoClave.js (que es quien habla con Firestore)
// por el mismo motivo que crucigramaBackspace.js: son lógica sin red ni DOM y
// se prueban en test/unidad.test.mjs, que corre en Node sin emulador. El
// contexto completo del reparto está en juegoClave.js y en
// DOCUMENTACION/INVENTARIO_DEL_SISTEMA.md § A25.
//
// Las tres formas que conviven durante la transición:
//
//   A) Heredado — respuestas dentro de la estructura pública, sin clave.
//   B) Migrado  — estructura pública sin respuestas + clave privada.
//   C) Nuevo con `compatibilidadLegacy: true` — las dos cosas a la vez.

/**
 * ¿La estructura pública todavía trae las respuestas dentro?
 *
 * Es la pregunta que distingue un juego heredado de uno migrado, y se responde
 * mirando el dato, NO una bandera: el frontend no tiene por qué saber en qué
 * fase de la transición está. En el crucigrama migrado el `grid` es una máscara
 * booleana; en el heredado son letras.
 */
export function esEstructuraHeredada(estructura) {
  const filas = estructura?.grid || []
  for (const fila of filas) {
    for (const celda of (fila?.row || [])) {
      if (typeof celda === 'string' && celda) return true
    }
  }
  return false
}

/**
 * Vuelve a juntar las dos mitades. Devuelve un objeto con la MISMA forma que
 * tenía `juego.estructura` antes del reparto, para que los tableros y
 * `correccionesCrucigrama` sigan funcionando sin cambiar su algoritmo.
 *
 * Espejo exacto de `estructuraEfectiva` en functions/juego.js. Si cambia una,
 * cambia la otra.
 *
 * Sin clave (juego heredado) devuelve la pública tal cual: ahí las respuestas
 * siguen dentro, que es justo el caso que el fallback cubre.
 */
export function estructuraConClave(publica, clave) {
  if (!publica) return null
  if (!clave) return publica
  const porIndice = new Map((clave.palabras || []).map((p) => [p.index, p]))
  return {
    ...publica,
    grid: clave.grid || publica.grid,
    palabras: (publica.palabras || []).map((p) => ({ ...p, ...(porIndice.get(p.index) || {}) })),
  }
}

/**
 * ¿Hay que seguir escribiendo la copia embebida `juego.contenido`?
 *
 * Solo si YA EXISTÍA. Esta única regla es la que hace que la transición
 * funcione sin flags en el cliente y sin un segundo despliegue:
 *
 *   · Juego heredado → el campo existe → se mantiene sincronizado, y el APK
 *     viejo lo sigue leyendo como siempre.
 *   · Juego migrado o nacido limpio → el campo no existe → NUNCA se vuelve a
 *     crear. Es lo que blinda la migración: reeditar un juego ya migrado no le
 *     re-planta las respuestas encima.
 */
export function debeEscribirContenidoEmbebido(activity) {
  return Array.isArray(activity?.juego?.contenido)
}

