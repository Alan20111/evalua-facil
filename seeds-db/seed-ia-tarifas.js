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
  version: 6,
  actualizadoEl: '2026-08-25',
  // Flag de sistema: false = endpoint rechaza ANTES de llamar a Anthropic.
  // true (o campo ausente) = activo. Cambia aquí y re-corre el seed.
  chatAsistenteActivo: false,
  // Créditos por uso — tabla comercial DEFINITIVA (corrección del PO,
  // 23-ago-2026, sobre una tabla anterior del mismo día que quedó
  // descartada). El crédito representa USO DEL ENTORNO Evalúa Fácil, NO se
  // deriva del costo técnico de la IA ni de ninguna conversión histórica de
  // unidad — 1 crédito = $1 MXN, y estos son los valores finales. 'aviso'
  // se deja congelada (sin tocar) porque dejó de ofrecerse en la UI — ver
  // AvisosTab.jsx, botón "Redactar con IA" retirado.
  //
  // Huérfanas retiradas (nunca tuvieron ejecutor conectado en
  // functions/ia.js — confirmado por auditoría 23-ago-2026):
  // guia_observacion (la actividad de Observación con IA vive dentro de
  // crear_actividad_ia) y modificar_planeacion (no usa IA hoy). Las demás
  // tarifas "reservadas para cuando se conecten" (retroalimentacion,
  // actividad, reactivos_lote, instrucciones, mejorar_instrucciones,
  // plan_clase, interpretar_resultados, resumen_alumno, resumen_grupo,
  // examen, cuestionario, analisis_apoyo, analisis_programa,
  // planeacion_tronco, planeacion_bloque) NO se tocan en esta corrección —
  // no fueron parte de la auditoría de esta ronda, se quedan como estaban.
  tarifas: {
    aviso: 1,
    // Tabla comercial DEFINITIVA (23-ago-2026, corrección del PO sobre la
    // tabla anterior del mismo día): el crédito representa USO DEL ENTORNO,
    // NO se deriva del costo técnico de la IA ni de ninguna conversión
    // histórica de unidad — estos son los valores finales, punto.
    calificar_abierta: 0.25,
    retroalimentacion: 1,
    actividad: 1,
    cotejo: 0.5,
    reactivos_lote: 1,
    instrucciones: 1,
    mejorar_instrucciones: 1,
    plan_clase: 1,
    interpretar_resultados: 1,
    resumen_alumno: 1,
    resumen_grupo: 1,
    rubrica: 2,
    // Generar reactivos (banco de un cuestionario/examen ya guardado) —
    // 0.25 crédito por REACTIVO realmente generado (unidadesReales en
    // ejecutarReactivos, functions/ia.js) — mismo criterio unitario que
    // crear_evaluacion_ia.
    reactivos: 0.25,
    // OP-11: calificar una entrega con IA. Tarifa diferenciada por tipo de
    // evidencia (tope 3 archivos, ver evidenciasEntrega.js):
    //   · Documentos (PDF o Word): 0.25 créditos
    //   · Imágenes (JPG/PNG):      0.5 créditos
    // La clave efectiva la determina el servidor en precheckCalificarEntregable
    // según tipoEvidenciaTarifa; el cliente la elige por tiposArchivo.
    calificar_entregable_ia: 0.25,
    calificar_entregable_ia_imagenes: 0.5,
    // Lote "Calificar todas con IA" — misma bifurcación que el individual.
    // La clave efectiva la determina el servidor en precheckCalificarEntregableLote.
    calificar_entregable_ia_lote: 0.25,
    calificar_entregable_ia_lote_imagenes: 0.5,
    // Crear examen/cuestionario completo con IA — 0.25 crédito por
    // REACTIVO realmente generado (unidadesReales), misma tarifa
    // comercial por unidad que 'reactivos'. Sin cobro adicional por
    // instrucciones/configuración del examen — eso va incluido.
    crear_evaluacion_ia: 0.25,
    // Crear entregable/observación completa con IA — incluye la actividad
    // de Observación con IA (no existe "guía de observación" aparte).
    crear_actividad_ia: 1,
    analizar_resultados: 5,
    // Diagnóstico del grupo — tarifa FIJA por generación (no por reactivo),
    // sin importar cuántos reactivos salgan en el de conocimientos.
    diagnostico_contexto: 3,
    diagnostico_conocimientos: 5,
    // Planeación Didáctica Inicial — tarifa FIJA por generación, cubre
    // TODOS los parciales reales de la asignatura en una sola operación.
    // Cada regeneración que pida el docente vuelve a cobrar completo — no
    // existe regeneración gratuita.
    planeacion_didactica_inicial: 20,
    // Chat con Asistente — 0.5 créditos por mensaje (25-ago-2026, decisión
    // de Kike: el chat ya está desactivado vía chatAsistenteActivo=false, pero
    // la tarifa queda definida para cuando se reactive sin necesitar otro seed).
    // El candado adicional contra abuso es el límite diario de interacciones
    // (functions/ia.js, LIMITE_CHAT_DIARIO = 50). Lo que cobra la confirmación
    // de una acción es aparte (chat_crear_actividad / chat_crear_examen abajo).
    chat_asistente: 0.5,
    // Actividad Entregable u Observación creada/confirmada desde el chat —
    // tarifa fija (misma para ambas categorías). Esta confirmación NO llama
    // a Anthropic (la propuesta ya se generó gratis dentro de
    // chat_asistente) — solo escribe Firestore; el callable comprueba que
    // la actividad quede realmente creada antes de dar el cobro por bueno.
    chat_crear_actividad: 4,
    // Examen creado/confirmado desde el chat — tarifa por TRAMOS de 10
    // reactivos: 1–10→8, 11–20→10, 21–30→12, 31–40→14, 41–50→16 créditos.
    // Aquí el valor es la UNIDAD base — el número real de créditos lo fija
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
    // Crucigrama / Sopa de letras — tarifa FIJA que cubre la ACTIVIDAD
    // INTERACTIVA COMPLETA (generación del contenido con IA + construcción
    // algorítmica de la cuadrícula), sin importar cantidad de palabras,
    // modalidad ni si trae documento. La construcción (construirJuego)
    // sigue siendo un callable aparte, gratis, fuera de
    // este ledger — NO se cobra por separado.
    generar_contenido_juego: 3,
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
  // Tabla comercial DEFINITIVA de paquetes (corrección del PO, 23-ago-2026,
  // sobre una tabla anterior del mismo día que quedó descartada). Descuento
  // por volumen creciente contra la referencia de $1 MXN/crédito (1 crédito
  // = $1 MXN de uso del entorno — esa regla es sobre el CONSUMO, no implica
  // que todos los paquetes cuesten exactamente créditos×$1; el paquete de
  // 50 es el único sin descuento). montoOficialCredito() en firestore.rules
  // debe espejar estos mismos 6 pares (creditos, precioMXN) — si cambian
  // aquí, cambian ahí también. El "Ahorras $X" que muestra
  // ComprarCreditosModal.jsx se calcula en el cliente contra
  // PRECIO_REFERENCIA_MXN = 1 (creditos×1 − precioMXN), no se guarda aquí.
  paquetesCreditos: [
    { creditos: 50, precioMXN: 50 },
    { creditos: 100, precioMXN: 90 },
    { creditos: 200, precioMXN: 180 },
    { creditos: 400, precioMXN: 360 },
    { creditos: 800, precioMXN: 720 },
    { creditos: 1600, precioMXN: 1440 },
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
