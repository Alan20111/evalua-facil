#!/usr/bin/env node

/**
 * Siembra la configuración del sistema de créditos IA (una sola vez).
 *
 *   · config/iaTarifas — tarifas en créditos por operación (valores APROBADOS
 *     por el PO el 9-ago-2026), capacidades por plan, modelo provisional por
 *     operación y datos de exhibición de los planes. Es la ÚNICA fuente de
 *     estos valores: servidor y cliente la leen; nada de esto se duplica en
 *     código.
 *   · plans/mayor — el Plan Mayor con `activo: false`: NO debe aparecer en
 *     ningún flujo de contratación todavía (decisión del PO); solo se muestra
 *     como referencia informativa en el panel de créditos.
 *
 * NOTA: el plan cortesía queda deliberadamente SIN capacidad — la IA se
 * rechaza para ese plan hasta que el PO decida sus créditos.
 *
 * Uso:
 *   cd seeds-db && npm install
 *   node seed-ia-tarifas.js --dry-run   # solo muestra qué escribiría
 *   node seed-ia-tarifas.js             # escribe
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

const TARIFAS = {
  version: 1,
  actualizadoEl: '2026-08-09',
  // Créditos por uso — valores aprobados. Solo 'aviso' está CONECTADA (piloto
  // C-03); las demás tarifas viven aquí desde ya para que haya una sola
  // fuente cuando se conecten sus operaciones.
  tarifas: {
    aviso: 1,
    calificar_abierta: 1,
    retroalimentacion: 1,
    actividad: 1,
    cotejo: 1,
    guia_observacion: 1,
    reactivos_lote: 1,
    instrucciones: 1,
    mejorar_instrucciones: 1,
    modificar_planeacion: 1,
    plan_clase: 1,
    interpretar_resultados: 1,
    resumen_alumno: 1,
    resumen_grupo: 1,
    rubrica: 3,
    examen: 10,
    cuestionario: 10,
    analisis_apoyo: 20,
    analisis_programa: 45,
    planeacion_tronco: 12,
    planeacion_bloque: 8,
  },
  // Para el resumen del panel ("Calificación de evidencias: 32", etc.).
  categorias: {
    aviso: 'Avisos',
    calificar_abierta: 'Calificación de evidencias',
    retroalimentacion: 'Calificación de evidencias',
    actividad: 'Actividades',
    cotejo: 'Actividades',
    guia_observacion: 'Actividades',
    reactivos_lote: 'Evaluaciones',
    instrucciones: 'Actividades',
    mejorar_instrucciones: 'Actividades',
    modificar_planeacion: 'Planeación',
    plan_clase: 'Planeación',
    interpretar_resultados: 'Evaluaciones',
    resumen_alumno: 'Seguimiento',
    resumen_grupo: 'Seguimiento',
    rubrica: 'Actividades',
    examen: 'Evaluaciones',
    cuestionario: 'Evaluaciones',
    analisis_apoyo: 'Planeación',
    analisis_programa: 'Planeación',
    planeacion_tronco: 'Planeación',
    planeacion_bloque: 'Planeación',
  },
  // Capacidad mensual por nivel de plan. Cortesía: PENDIENTE a propósito.
  capacidadPorPlan: { trial: 350, pro: 350, anual: 350, mayor: 1750 },
  // Modelo PROVISIONAL por operación (M3 sigue abierta: cambiar aquí no toca
  // código). Solo la piloto por ahora.
  modeloPorOperacion: { aviso: 'claude-haiku-4-5' },
  // Datos de exhibición para el panel de créditos (sin costos internos).
  planes: {
    pro: { nombre: 'Plan Docente', precioMXN: 99, creditos: 350 },
    mayor: { nombre: 'Plan Mayor', precioMXN: 199, creditos: 1750 },
  },
}

const PLAN_MAYOR = {
  nombre: 'Plan Mayor',
  descripcion: 'Para el docente que utiliza intensivamente la IA',
  precio: 199,
  periodicidad: 'mensual',
  maxAsignaturas: -1,
  maxAlumnos: -1,
  activo: false, // NO aparece en ningún flujo de contratación todavía
  orden: 3,
}

async function main() {
  console.log(dryRun ? '— DRY RUN (no escribe nada) —' : '— Escribiendo —')
  console.log('config/iaTarifas →', JSON.stringify(TARIFAS, null, 2).slice(0, 400) + ' …')
  console.log('plans/mayor →', JSON.stringify(PLAN_MAYOR))
  if (dryRun) return
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc('plans/mayor').set(PLAN_MAYOR, { merge: true })
  console.log('Listo. config/iaTarifas y plans/mayor (activo:false) sembrados.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
