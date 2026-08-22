#!/usr/bin/env node

/**
 * Siembra la configuración del sistema de créditos IA (modelo de créditos
 * puros, 20-ago-2026 — ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md).
 *
 *   · config/iaTarifas — tarifas en créditos por operación, modelo por
 *     operación (Claude Haiku 4.5, único modelo) y los 6 paquetes de compra
 *     definitivos (`paquetesCreditos`). Es la ÚNICA fuente de estos
 *     valores: servidor y cliente la leen; nada de esto se duplica en
 *     código. `set()` (no merge) purga cualquier campo legado del modelo de
 *     suscripciones mensuales (`capacidadPorPlan`/`trialLegado`/`planes`).
 *
 * `plans/mayor` y `plans/basico` YA NO se siembran aquí — ver
 * seeds-db/seed-plans.js (deprecado, solo histórico: esas colecciones se
 * conservan pero ya no controlan ningún acceso).
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
    // OP-11 (21-ago-2026, decisión de Kike): calificar una entrega con IA
    // contra su rúbrica/lista de cotejo a partir de las evidencias (JPG,
    // PNG, PDF o Word), sin importar cuántas evidencias trajo (tope de 5,
    // ver evidenciasEntrega.js). Tarifa FIJA de 0.5 crédito por entrega —
    // corregido el mismo día: con 1 crédito = $0.50 MXN (100 créditos =
    // $50 MXN de costo interno), 1 crédito íntegro por entrega se pasaba
    // del objetivo comercial de ~$0.25 MXN/entrega; 0.5 lo alcanza EXACTO
    // sin inventar un tipo de crédito especial — sigue siendo la misma
    // moneda de créditos IA de todo el proyecto, solo que esta tarifa es
    // fraccionaria (ver creditosLedger.js: el ledger ya soportaba
    // fracciones de saldo sin cambios, se le agregó round2() como blindaje
    // contra deriva de punto flotante para esta y cualquier tarifa
    // fraccionaria futura). Costo real verificado en
    // docs/ia/COSTO_CALIFICAR_ENTREGABLE_IA.md (promedio ~$0.17 MXN de
    // costo real de API, bien dentro de lo que cubre el 0.5 crédito).
    calificar_entregable_ia: 0.5,
    // Lote "Calificar todas con IA" (mismo día) — MISMA tarifa por entrega
    // realmente evaluada, sin importar si se pidió una por una o en lote.
    calificar_entregable_ia_lote: 0.5,
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
    // Crucigrama / Sopa de letras (22-ago-2026, decisión de producto #2
    // aprobada): tarifa FIJA 0.5 crédito por ejecución de
    // generar_contenido_juego, sin importar cantidad de palabras, modalidad
    // ni si trae documento — cada ejecución cobra igual, sin cortesías. La
    // construcción de la cuadrícula (construirJuego) es un callable aparte,
    // gratis, fuera de este ledger.
    generar_contenido_juego: 0.5,
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
    // Misma categoría que calificar_abierta/retroalimentacion: es la MISMA
    // función de valor (calificar con IA), solo que ahora también contra
    // evidencia fotográfica/PDF/Word en vez de solo texto.
    calificar_entregable_ia: 'Calificación de evidencias',
    calificar_entregable_ia_lote: 'Calificación de evidencias',
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
    generar_contenido_juego: 'Actividades',
  },
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
    // OP-11 (21-ago-2026): calificar entrega con IA — mismo modelo que el
    // resto, es el más barato con visión disponible (ver
    // docs/ia/COSTO_CALIFICAR_ENTREGABLE_IA.md).
    calificar_entregable_ia: 'claude-haiku-4-5',
    calificar_entregable_ia_lote: 'claude-haiku-4-5',
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
    generar_contenido_juego: 'claude-haiku-4-5',
  },
  // Créditos puros sin caducidad (20-ago-2026, migración a modelo de
  // créditos puros — ver docs/ia/PLAN_TECNICO_CREDITOS_PUROS.md §12): ya no
  // hay planes mensuales que exhibir aquí (`planes` se elimina). Paquetes
  // definitivos, 6 tramos con descuento por volumen creciente — única fuente
  // de precios, leída por el cliente (useCreditosIA/ComprarCreditosModal) y
  // por firestore.rules (montoOficialCredito).
  paquetesCreditos: [
    { creditos: 50, precioMXN: 100 },
    { creditos: 100, precioMXN: 175 },
    { creditos: 200, precioMXN: 350 },
    { creditos: 400, precioMXN: 700 },
    { creditos: 800, precioMXN: 1400 },
    { creditos: 1600, precioMXN: 2800 },
  ],
  // Tarifa REAL de Anthropic (19-ago-2026, pedido explícito de Kike) — USD
  // por millón de tokens, confirmada contra la documentación oficial
  // (platform.claude.com/docs/en/about-claude/pricing) el mismo día. Sirve
  // para que el Chat de Administración calcule el costo real de cada
  // operación de IA a partir de los tokens que ya registra
  // iaConsumosInterno — NO son las tarifas de créditos que le cobran al
  // docente (esas son `tarifas` arriba), son lo que Evalúa Fácil le paga a
  // Anthropic. Parámetro de sistema, no una constante en código: cambia
  // aquí (o directo en Firestore) cuando Anthropic actualice precios, sin
  // tocar ni redesplegar functions/adminChat.js.
  //
  // `cacheEscritura5mPorMTok`/`cacheLecturaPorMTok`: multiplicadores 1.25x y
  // 0.1x del precio de entrada — el único breakpoint que usa Evalúa Fácil es
  // el de 5 minutos (ver bloqueConCache en functions/ia.js y
  // functions/adminChat.js), nunca el de 1 hora, así que no hace falta esa
  // tercera tarifa.
  costosAnthropicUSD: {
    'claude-haiku-4-5': {
      entradaPorMTok: 1, salidaPorMTok: 5, cacheEscritura5mPorMTok: 1.25, cacheLecturaPorMTok: 0.10,
    },
  },
  // Tipo de cambio FIJO (no se actualiza solo) — se ajusta a mano aquí
  // cuando se quiera refrescar. Referencia usada en el proyecto para estas
  // cuentas desde antes (docs/ia/PLAN_MAESTRO_IA_EVALUA_FACIL.md, "TC ref.
  // 18.50") — no es un número nuevo inventado para esto.
  tipoCambioUsdMxn: 18.50,
}

async function main() {
  console.log(dryRun ? '— DRY RUN (no escribe nada) —' : '— Escribiendo —')
  console.log('config/iaTarifas →', JSON.stringify(TARIFAS, null, 2).slice(0, 400) + ' …')
  if (dryRun) return
  // `set` (no merge) a propósito: purga cualquier campo legado
  // (capacidadPorPlan/trialLegado/planes) que haya quedado del modelo de
  // suscripciones mensuales — config/iaTarifas ahora es solo lo de arriba.
  await db.doc('config/iaTarifas').set(TARIFAS)
  console.log('Listo. config/iaTarifas sembrado (modelo de créditos puros). plans/mayor y plans/basico ya NO se siembran aquí — ver seeds-db/seed-plans.js (deprecado, solo histórico).')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
