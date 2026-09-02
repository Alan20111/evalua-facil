#!/usr/bin/env node

/**
 * A25 — Siembra la bandera de compatibilidad de la transición de juegos.
 *
 *   config/juegos.compatibilidadLegacy = true
 *
 * ¿Qué hace esa bandera? Decide si `construirJuego` y `generar_contenido_juego`
 * (functions/) siguen escribiendo las respuestas del juego DENTRO del documento
 * público de la actividad, además de en la clave privada:
 *
 *   true  → se escribe en los dos sitios. Nada se rompe y nada se arregla
 *           todavía. Es la fase en la que estamos.
 *   false → se deja de escribir en el público. AHÍ aterriza la seguridad, y
 *           ahí es donde un APK viejo empieza a mostrar mal la revisión de
 *           entregas y la solución.
 *
 * ¿Por qué existe? La app de Android empaqueta su propia copia de `dist`
 * (capacitor.config.json no tiene `server.url`) y no hay candado de versión
 * mínima: un APK instalado ejecuta para siempre el frontend con el que se
 * compiló. No hay un momento en que se pueda dar por hecho que ya no queda
 * frontend viejo, así que el corte tiene que ser una decisión explícita del PO,
 * no el efecto colateral de un despliegue.
 *
 * NO apagues la bandera desde aquí. El corte lo hace el script de migración
 * (PR 3), que la apaga como su PRIMER paso y solo entonces limpia los
 * crucigramas existentes — así el orden queda impuesto por la herramienta y no
 * depende de que nadie se acuerde.
 *
 * El código YA trata "ausente" como compatible, así que correr esto no cambia
 * ningún comportamiento: deja el valor escrito y visible para que se pueda
 * consultar y para que el corte sea un cambio de `true` a `false`, no la
 * aparición de un campo de la nada.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node seed-juegos-compatibilidad.js --dry-run   # solo muestra qué escribiría
 *   node seed-juegos-compatibilidad.js             # escribe
 *
 * Requiere credenciales del Admin SDK (GOOGLE_APPLICATION_CREDENTIALS o
 * `firebase login`), igual que el resto de scripts de esta carpeta.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ projectId: 'evalua-facil-app' })
} catch {
  // ya inicializado
}
const db = admin.firestore()
const dryRun = process.argv.includes('--dry-run')

const CONFIG = {
  compatibilidadLegacy: true,
  actualizadoEl: '2026-09-01',
  nota: 'A25 - true: las respuestas del juego se siguen escribiendo tambien en el documento publico para no romper frontends viejos (APK instalados). El corte a false lo hace seeds-db/migrar-clave-juegos.js.',
}

async function main() {
  const ref = db.doc('config/juegos')
  const previo = await ref.get()

  console.log(`config/juegos — ${previo.exists ? 'ya existe' : 'no existe todavía'}`)
  if (previo.exists) {
    console.log(`  compatibilidadLegacy actual: ${previo.data()?.compatibilidadLegacy}`)
  }
  console.log(`  compatibilidadLegacy a escribir: ${CONFIG.compatibilidadLegacy}`)

  if (dryRun) {
    console.log('\n(simulacro — no se escribió nada)')
    return
  }

  // merge: si algún día este documento guarda algo más de juegos, esto no lo
  // borra. Solo toca la bandera y su nota.
  await ref.set(CONFIG, { merge: true })

  const despues = await ref.get()
  const ok = despues.data()?.compatibilidadLegacy === true
  console.log(`\n${ok ? '✔' : '✗'} config/juegos.compatibilidadLegacy = ${despues.data()?.compatibilidadLegacy}`)
  if (!ok) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e); process.exit(1) })
