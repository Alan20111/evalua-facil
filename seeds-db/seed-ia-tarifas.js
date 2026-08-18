#!/usr/bin/env node

/**
 * Siembra la configuración del sistema de créditos IA (una sola vez).
 *
 *   · config/iaTarifas — tarifas en créditos por operación (valores APROBADOS
 *     por el PO el 9-ago-2026), capacidades por plan, modelo provisional por
 *     operación y datos de exhibición de los planes. Es la ÚNICA fuente de
 *     estos valores: servidor y cliente la leen; nada de esto se duplica en
 *     código.
 *   · plans/mayor — Asistente IA Pro (id interno `mayor`, sin cambios).
 *     `activo: true` (Bloque 5, 13-ago-2026): activación comercial
 *     intencional — el checkout (Bloque 4) ya sabe ofrecerlo y cobrarlo
 *     correctamente, y las reglas ya lo aceptan.
 *
 * Nombres comerciales (13-ago-2026): "Plan Docente"→"Asistente IA" (`pro`),
 * "Plan Mayor"→"Asistente IA Pro" (`mayor`) — solo el texto que ve el
 * docente cambió; los identificadores internos `pro`/`anual`/`mayor`/`trial`
 * siguen siendo los mismos en todo el proyecto.
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
    reactivos: 1,
    // OP-03/OP-04 (11-ago-2026): crear examen/cuestionario completo con IA —
    // 1 crédito por REACTIVO realmente generado (unidadesReales), igual que
    // 'reactivos'; no confundir con 'examen'/'cuestionario' de abajo, que son
    // tarifas de una fase distinta aún no conectada.
    crear_evaluacion_ia: 1,
    // OP-05 (11-ago-2026): crear entregable/observación completo con IA —
    // mismo valor unitario que crear_evaluacion_ia (1 crédito por operación).
    crear_actividad_ia: 1,
    analizar_resultados: 5,
    // Diagnóstico del grupo (FASE 2-BIS, apartado 2 de Asistente IA) — dos
    // operaciones independientes, decisión de Kike el 12-ago-2026: tarifa
    // FIJA por generación (no por reactivo), sin importar cuántos reactivos
    // salgan en el de conocimientos.
    diagnostico_contexto: 5,
    diagnostico_conocimientos: 10,
    // Planeación Didáctica Inicial (FASE 2-BIS, apartado 3 de Asistente IA) —
    // decisión de Kike el 12-ago-2026: tarifa FIJA por generación, cubre
    // TODOS los parciales reales de la asignatura en una sola operación. NO
    // reutiliza planeacion_tronco/planeacion_bloque (arquitectura descartada
    // de Planeación Viva, ver más abajo).
    planeacion_didactica_inicial: 20,
    // Chat con Asistente (17-ago-2026, NUEVO MODELO 18-ago-2026, decisión
    // definitiva de Kike): la conversación deja de cobrar por mensaje — el
    // único candado contra abuso es el límite de 100 interacciones/día por
    // contexto (functions/ia.js, verificarLimiteChat), no créditos. Lo que
    // SÍ cobra es confirmar una acción (ver chat_crear_actividad/
    // chat_crear_examen abajo) — un único cobro que ya representa toda la
    // conversación que llevó a ella, nunca mensaje + propuesta + creación.
    chat_asistente: 0,
    // Actividad Entregable u Observación creada/confirmada desde el chat —
    // tarifa fija, 18-ago-2026, decisión definitiva de Kike (misma para
    // ambas categorías, igual que el editor manual las trata como una sola
    // acción con `categoria` distinta).
    chat_crear_actividad: 4,
    // Examen creado/confirmado desde el chat — tarifa por TRAMOS de 10
    // reactivos (18-ago-2026, decisión definitiva de Kike): 1–10→8,
    // 11–20→10, 21–30→12, 31–40→14, 41–50→16 créditos. Aquí el valor es la
    // UNIDAD base (1 crédito) — el número real de créditos lo fija
    // `unidadesMinimas` en precheckChatCrearExamen (functions/ia.js,
    // calcularTarifaExamen), a partir de los reactivos reales de la
    // propuesta ya saneada — el cliente nunca puede bajarlo.
    chat_crear_examen: 1,
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
    reactivos: 'Evaluaciones',
    crear_evaluacion_ia: 'Evaluaciones',
    crear_actividad_ia: 'Actividades',
    analizar_resultados: 'Evaluaciones',
    diagnostico_contexto: 'Diagnóstico',
    diagnostico_conocimientos: 'Diagnóstico',
    planeacion_didactica_inicial: 'Planeación',
    chat_asistente: 'Chat con Asistente',
    chat_crear_actividad: 'Chat con Asistente',
    chat_crear_examen: 'Chat con Asistente',
    examen: 'Evaluaciones',
    cuestionario: 'Evaluaciones',
    analisis_apoyo: 'Planeación',
    analisis_programa: 'Planeación',
    planeacion_tronco: 'Planeación',
    planeacion_bloque: 'Planeación',
  },
  // Capacidad mensual por nivel de plan. Cortesía: PENDIENTE a propósito.
  // Trial bajó de 350 a 50 (decisión de Kike, 13-ago-2026) — ver
  // `trialLegado` abajo para que esto NO le recorte nada a quien ya estaba
  // en trial antes del cambio (functions/creditosLedger.js: capacidadTrialPara).
  capacidadPorPlan: { trial: 50, pro: 350, anual: 350, mayor: 1750 },
  // Trials con `subscriptions.fechaInicio` ANTERIOR a `corte` conservan
  // `capacidad` (el valor de antes del cambio) en vez del nuevo
  // `capacidadPorPlan.trial` — decisión de Kike, 13-ago-2026: no se le quita
  // nada a nadie que ya estuviera en trial. `corte` se fija la PRIMERA vez
  // que se corre este seed con este bloque y luego se preserva tal cual en
  // cada re-siembra (ver main() abajo) — si se recalculara "ahora" en cada
  // corrida, un trial creado ENTRE dos corridas quedaría mal clasificado.
  trialLegado: { capacidad: 350, corte: null }, // `corte` real lo pone main()
  // Modelo PROVISIONAL por operación (M3 sigue abierta: cambiar aquí no toca
  // código). Solo las pilotos conectadas.
  modeloPorOperacion: {
    aviso: 'claude-haiku-4-5',
    calificar_abierta: 'claude-haiku-4-5',
    // OP-06 / OP-07 (10-ago-2026): rúbrica y lista de cotejo derivadas de una
    // actividad padre. El plan maestro las ubica en el nivel Económico.
    rubrica: 'claude-haiku-4-5',
    cotejo: 'claude-haiku-4-5',
    // OP-09 (10-ago-2026): reactivos de un cuestionario o examen.
    reactivos: 'claude-haiku-4-5',
    // OP-03/OP-04 (11-ago-2026): crear examen/cuestionario completo con IA.
    crear_evaluacion_ia: 'claude-haiku-4-5',
    // OP-05 (11-ago-2026): crear entregable/observación completo con IA.
    crear_actividad_ia: 'claude-haiku-4-5',
    // OP-10 (11-ago-2026): análisis de resultados de un cuestionario o examen.
    analizar_resultados: 'claude-haiku-4-5',
    // Diagnóstico del grupo (FASE 2-BIS, 12-ago-2026): contexto y conocimientos.
    diagnostico_contexto: 'claude-haiku-4-5',
    diagnostico_conocimientos: 'claude-haiku-4-5',
    planeacion_didactica_inicial: 'claude-haiku-4-5',
    // Chat con Asistente (17-ago-2026): conversación breve, modelo económico.
    chat_asistente: 'claude-haiku-4-5',
    // chat_crear_actividad/chat_crear_examen (18-ago-2026) NO llaman a
    // Anthropic — la propuesta ya se generó gratis dentro de chat_asistente;
    // confirmar solo escribe Firestore. El campo es obligatorio igual
    // (ejecutarOperacionIA lo exige para cualquier operación registrada),
    // aunque el ejecutor nunca lo use.
    chat_crear_actividad: 'claude-haiku-4-5',
    chat_crear_examen: 'claude-haiku-4-5',
  },
  // Datos de exhibición para el panel de créditos (sin costos internos).
  // Nombre comercial, no identificador — `pro`/`mayor` (las claves) no cambian.
  planes: {
    pro: { nombre: 'Asistente IA', precioMXN: 99, creditos: 350 },
    mayor: { nombre: 'Asistente IA Pro', precioMXN: 199, creditos: 1750 },
  },
}

const PLAN_MAYOR = {
  nombre: 'Asistente IA Pro',
  descripcion: 'Para el docente que utiliza intensivamente la IA',
  precio: 199,
  periodicidad: 'mensual',
  maxAsignaturas: -1,
  maxAlumnos: -1,
  activo: true, // Bloque 5 (13-ago-2026): activación comercial intencional
  orden: 3,
}

async function main() {
  // El `corte` de trialLegado se fija UNA sola vez, la primera vez que se
  // corre este seed con el bloque nuevo — si ya existe en Firestore (de una
  // corrida anterior), se conserva tal cual en vez de recalcularse a "ahora".
  // Sin esto, re-correr el script para cambiar cualquier otra tarifa movería
  // el corte hacia adelante y reclasificaría mal a los trials creados entre
  // una corrida y otra.
  const actual = await db.doc('config/iaTarifas').get()
  const corteExistente = actual.exists ? actual.data()?.trialLegado?.corte : null
  TARIFAS.trialLegado.corte = corteExistente || admin.firestore.Timestamp.now()

  console.log(dryRun ? '— DRY RUN (no escribe nada) —' : '— Escribiendo —')
  console.log('config/iaTarifas →', JSON.stringify(TARIFAS, null, 2).slice(0, 400) + ' …')
  console.log('trialLegado.corte →', TARIFAS.trialLegado.corte.toDate().toISOString(), corteExistente ? '(preservado)' : '(recién fijado)')
  console.log('plans/mayor →', JSON.stringify(PLAN_MAYOR))
  if (dryRun) return
  await db.doc('config/iaTarifas').set(TARIFAS)
  await db.doc('plans/mayor').set(PLAN_MAYOR, { merge: true })
  console.log(`Listo. config/iaTarifas y plans/mayor (activo:${PLAN_MAYOR.activo}) sembrados.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
