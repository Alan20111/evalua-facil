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
  version: 2,
  actualizadoEl: '2026-08-23',
  // Créditos por uso (conversión de unidad 23-ago-2026, decisión PO: 1
  // crédito = $1 MXN; antes la referencia comercial era ~$2 MXN/crédito —
  // ver docs/ia/PLAN_MAESTRO_IA_EVALUA_FACIL.md y el hilo de auditoría de
  // esa fecha). El valor MONETARIO de cada operación se conserva exacto;
  // solo cambia el número nominal de créditos. 'aviso' se deja congelada
  // (sin convertir) porque dejó de ofrecerse en la UI ese mismo día — ver
  // AvisosTab.jsx, botón "Redactar con IA" retirado.
  //
  // Huérfanas retiradas en esta conversión (nunca tuvieron ejecutor
  // conectado en functions/ia.js — confirmado por auditoría 23-ago-2026):
  // guia_observacion (la actividad de Observación con IA vive dentro de
  // crear_actividad_ia) y modificar_planeacion (no usa IA hoy). Las demás
  // tarifas "reservadas para cuando se conecten" (retroalimentacion,
  // actividad, reactivos_lote, instrucciones, mejorar_instrucciones,
  // plan_clase, interpretar_resultados, resumen_alumno, resumen_grupo,
  // examen, cuestionario, analisis_apoyo, analisis_programa,
  // planeacion_tronco, planeacion_bloque) NO se tocan en esta conversión —
  // no fueron parte de la auditoría de esta ronda, se quedan como estaban.
  tarifas: {
    aviso: 1,
    calificar_abierta: 0.5,
    retroalimentacion: 1,
    actividad: 1,
    cotejo: 1,
    reactivos_lote: 1,
    instrucciones: 1,
    mejorar_instrucciones: 1,
    plan_clase: 1,
    interpretar_resultados: 1,
    resumen_alumno: 1,
    resumen_grupo: 1,
    rubrica: 4,
    // Generar reactivos (banco de un cuestionario/examen ya guardado) —
    // 23-ago-2026: pasa de tarifa fija por llamada a 0.5 crédito por
    // REACTIVO realmente generado (unidadesReales en ejecutarReactivos,
    // functions/ia.js) — mismo criterio unitario que crear_evaluacion_ia.
    reactivos: 0.5,
    // OP-11 (21-ago-2026): calificar una entrega con IA contra su
    // rúbrica/lista de cotejo a partir de las evidencias (JPG, PNG, PDF o
    // Word), sin importar cuántas evidencias trajo (tope de 5, ver
    // evidenciasEntrega.js). 0.5 crédito por entrega — valor monetario sin
    // cambio en la conversión de unidad (0.5 × $1 = $0.5, igual que antes).
    // Costo real verificado en docs/ia/COSTO_CALIFICAR_ENTREGABLE_IA.md.
    calificar_entregable_ia: 0.5,
    // Lote "Calificar todas con IA" — MISMA tarifa por entrega realmente
    // evaluada, sin importar si se pidió una por una o en lote. NUNCA una
    // tarifa fija por pulsar "Calificar todas".
    calificar_entregable_ia_lote: 0.5,
    // Crear examen/cuestionario completo con IA — 23-ago-2026: 0.5 crédito
    // por REACTIVO realmente generado (unidadesReales), misma tarifa
    // comercial por unidad que 'reactivos'. Sin cobro adicional por
    // instrucciones/configuración del examen — eso va incluido.
    crear_evaluacion_ia: 0.5,
    // Crear entregable/observación completa con IA — incluye la actividad
    // de Observación con IA (no existe "guía de observación" aparte).
    crear_actividad_ia: 2,
    analizar_resultados: 10,
    // Diagnóstico del grupo — tarifa FIJA por generación (no por reactivo),
    // sin importar cuántos reactivos salgan en el de conocimientos.
    diagnostico_contexto: 6,
    diagnostico_conocimientos: 10,
    // Planeación Didáctica Inicial — tarifa FIJA por generación, cubre
    // TODOS los parciales reales de la asignatura en una sola operación.
    // Cada regeneración que pida el docente vuelve a cobrar completo — no
    // existe regeneración gratuita.
    planeacion_didactica_inicial: 40,
    // Chat con Asistente — la conversación NO cobra por mensaje; el único
    // candado contra abuso es el límite diario de interacciones
    // (functions/ia.js, LIMITE_CHAT_DIARIO = 50), no créditos. Lo que SÍ
    // cobra es confirmar una acción (chat_crear_actividad/chat_crear_examen
    // abajo) — un único cobro que ya representa toda la conversación que
    // llevó a ella.
    chat_asistente: 0,
    // Actividad Entregable u Observación creada/confirmada desde el chat —
    // tarifa fija (misma para ambas categorías). Esta confirmación NO llama
    // a Anthropic (la propuesta ya se generó gratis dentro de
    // chat_asistente) — solo escribe Firestore; el callable comprueba que
    // la actividad quede realmente creada antes de dar el cobro por bueno.
    chat_crear_actividad: 8,
    // Examen creado/confirmado desde el chat — tarifa por TRAMOS de 10
    // reactivos, escala duplicada en la conversión de unidad (mismo valor
    // monetario: 16→$16, 20→$20, 24→$24, 28→$28, 32→$32). Aquí el valor es
    // la UNIDAD base — el número real de créditos lo fija
    // `unidadesMinimas` en precheckChatCrearExamen (functions/ia.js,
    // calcularTarifaExamen, src/utils/tarifaExamen.js), a partir de los
    // reactivos reales de la propuesta ya saneada — el cliente nunca puede
    // bajarlo. Tampoco llama a Anthropic en este paso.
    chat_crear_examen: 1,
    examen: 10,
    cuestionario: 10,
    analisis_apoyo: 20,
    analisis_programa: 45,
    planeacion_tronco: 12,
    planeacion_bloque: 8,
    // Crucigrama / Sopa de letras — 23-ago-2026: tarifa FIJA que cubre la
    // ACTIVIDAD INTERACTIVA COMPLETA (generación del contenido con IA +
    // construcción algorítmica de la cuadrícula), sin importar cantidad de
    // palabras, modalidad ni si trae documento. La construcción
    // (construirJuego) sigue siendo un callable aparte, gratis, fuera de
    // este ledger — NO se cobra por separado.
    generar_contenido_juego: 6,
  },
  // Para el resumen del panel ("Calificación de evidencias: 32", etc.).
  categorias: {
    aviso: 'Avisos',
    calificar_abierta: 'Calificación de evidencias',
    retroalimentacion: 'Calificación de evidencias',
    actividad: 'Actividades',
    cotejo: 'Actividades',
    reactivos_lote: 'Evaluaciones',
    instrucciones: 'Actividades',
    mejorar_instrucciones: 'Actividades',
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
  // definitivos, única fuente de precios, leída por el cliente
  // (useCreditosIA/ComprarCreditosModal) y por firestore.rules
  // (montoOficialCredito).
  //
  // Conversión de unidad 23-ago-2026 (decisión PO): 1 crédito = $1 MXN.
  // Los precios monetarios NO cambiaron — solo la cantidad nominal de
  // créditos, para que créditos × $1 = mismo precio de siempre (antes la
  // referencia era ~$1.75–$2.00 MXN/crédito según el paquete). Cero
  // reducción de ingreso: $100→100cr, $175→175cr, $350→350cr, $700→700cr,
  // $1400→1400cr, $2800→2800cr. montoOficialCredito() en firestore.rules
  // debe espejar estos mismos 6 pares (creditos, precioMXN) — si cambian
  // aquí, cambian ahí también.
  paquetesCreditos: [
    { creditos: 100, precioMXN: 100 },
    { creditos: 175, precioMXN: 175 },
    { creditos: 350, precioMXN: 350 },
    { creditos: 700, precioMXN: 700 },
    { creditos: 1400, precioMXN: 1400 },
    { creditos: 2800, precioMXN: 2800 },
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
