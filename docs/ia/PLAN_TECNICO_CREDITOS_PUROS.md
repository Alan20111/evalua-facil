# Plan técnico: migración a modelo de créditos puros sin caducidad

_Preparado antes de implementación, a solicitud del Product Owner. No se ha tocado código de producto._

## 1. Resumen de la arquitectura actual

Evalúa Fácil monetiza hoy con dos ejes acoplados:

- **Suscripción por tiempo** (`subscriptions/{uid}`, planes `basico`/`pro`/`anual`/`mayor`), que gatea TODA la escritura del docente (`docenteActivo()` en `firestore.rules`, replicado en cliente por `src/utils/firestoreGuard.js`). El plan `basico` ($99) hoy **no incluye IA en absoluto**.
- **Créditos IA mensuales** (`iaCreditos/{uid}`), un solo campo `saldo` que mezcla dos bolsas: (a) `capacidad` por plan que se resetea cada ciclo (créditos no usados se pierden), y (b) `creditosAdicionalesVigentes`, comprados aparte, que **ya no caducan hoy** — esta es la pieza que más se parece al modelo objetivo.

El ledger (`functions/creditosLedger.js`) es transaccional e idempotente (reservar → liquidar/reembolsar), con limpieza de reservas huérfanas y renovación de ciclo tanto perezosa (en `reservar`) como por cron (`renovarCiclosVencidos`). Las tarifas y modelos de IA viven centralizados en `config/iaTarifas` (Firestore), sembrado por `seeds-db/seed-ia-tarifas.js`, todo apuntando a `claude-haiku-4-5`.

Los pagos son 100% por transferencia (`payments` para suscripción, `creditPurchases` para créditos adicionales), cada uno con su propio flujo de aprobación admin.

## 2. Arquitectura objetivo

- Se elimina el candado por tiempo de suscripción (`docenteActivo()` deja de bloquear nada relacionado con IA; **todo lo que no es IA queda gratis y sin candado para todos los docentes**).
- Un único documento `iaCreditos/{uid}` con **un solo campo `saldo`**, sin `capacidad`, sin `plan`, sin ciclo mensual, sin reseteo. Los créditos se acreditan (aprobación de compra o regalo de bienvenida) y se descuentan (consumo de IA); nunca expiran, nunca se resetean.
- `config/iaTarifas` sigue siendo la fuente única de tarifas por operación y de los paquetes de créditos — pero los paquetes cambian a los 6 definitivos del PO.
- Asistencias tiene su propia regla de gateo, independiente de todo lo demás: `saldo > 0` en `iaCreditos/{uid}` (no consume créditos, exige saldo positivo para estar habilitada).
- Pagos: se mantiene solo el flujo de depósito/transferencia para comprar créditos (`creditPurchases`); se elimina el flujo de pago de suscripción (`payments`, `CheckoutModal.jsx`, `PaymentsTable.jsx`).

## 3. Cambios de base de datos

**CONSERVAR:**
- `iaConsumos/{idempotencyKey}` — sin cambios (idempotencia, `estado`, `creditosReservados/Reales`). Campo `plan` se deja `null` o se retira.
- `iaConsumosInterno`, `iaTrialRegistro` — se conservan para telemetría; `iaTrialRegistro` pasa a registrar el regalo inicial de 30 créditos.
- `creditPurchases/{id}` — mismo esquema, cambia la tabla de precios oficiales validada por `montoOficialCredito()`.
- `config/iaTarifas` — mismo doc, cambian subcampos (§12).

**MIGRAR (script de una sola corrida):**
- `iaCreditos/{uid}`: `saldoNuevo = saldo_actual` (mismo número, no hay conversión de unidades). Se retiran `capacidad`, `plan`, `planSiguiente`, `consumidoCiclo`, `consumoPorCategoria`, `cicloInicio`, `cicloFin`, `creditosAdicionalesVigentes`, `creditosAdicionalesComprados`.
- `users/{uid}.suscripcionHasta` — deja de tener efecto; puede conservarse sin usar.

**DEPRECAR (dejar de escribir, conservar histórico):**
- `subscriptions/{id}`, `payments/{id}` — valor contable/histórico, no se borran.
- `plans/{basico|pro|anual|mayor}` — dejan de leerse por el candado.

**ELIMINAR:**
- Campos `plan`/`cortesia`/`trialLegado` dentro de `config/iaTarifas`.
- Lógica de "PLAN_SIN_IA" (bloqueo de IA para `basico`).

## 4. Cambios en Cloud Functions

### `functions/creditosLedger.js`

| Función | Actual | Nuevo | Riesgo |
|---|---|---|---|
| `reservar()` | Bloquea por `SUSCRIPCION_VENCIDA`/`PLAN_SIN_IA`; crea `iaCreditos` con `capacidad` por plan; renueva ciclo si venció. | Elimina chequeos de suscripción/plan y toda lógica de ciclo. Si no existe `iaCreditos/{uid}`, se crea con `saldo:0` (el saldo real llega por evento de acreditación aparte). Se mantiene idempotencia y `SALDO_INSUFICIENTE`. | ALTO |
| `liquidar()` | Ajusta `consumidoCiclo`/`creditosAdicionalesVigentes`. | Solo ajusta `saldo`; `consumidoCiclo` pasa a acumulador histórico total sin reseteo. | MEDIO |
| `reembolsar()` | Sin cambios. | Igual. | BAJO |
| `limpiarReservasHuerfanas()` | Sin cambios. | Igual. | BAJO |
| `renovarCiclosVencidos()` | Cron de renovación mensual. | **Eliminar** (ya no hay ciclos). | BAJO |
| `cerrarTrialsVencidos()` | Cierra trials de 30 días. | **Eliminar** (regalo único, no ventana de tiempo). | BAJO |
| `sincronizarPlan()` | Sincroniza capacidad al cambiar de plan. | **Eliminar** (ya no hay plan que sincronizar). | BAJO |
| `resetearAhora()` | Reset admin a capacidad total. | Reemplazar por `ajustarSaldoManual({uid, delta, motivo, adminUid})`. | MEDIO |
| `acreditarCompraCreditos()` | Incrementa `saldo` + buckets de adicionales. | Solo incrementa `saldo`; se mantiene idempotencia. | BAJO |
| `capacidadTrialPara()`, `camposRenovados()`, `unMesDespues()`, `nivelDeSuscripcion()` | Lógica de ciclo/plan. | **Eliminar.** | BAJO |
| Nueva: `otorgarCreditosBienvenida({uid, ahora})` | No existe. | Acredita una sola vez (idempotente) 30 créditos al activarse la cuenta, disparado desde `onDocenteCreado`. | MEDIO |

### `functions/index.js`

- `onSuscripcionEscrita` — eliminar bloque que llama `sincronizarPlan` y mirrorea `suscripcionHasta`.
- `sincronizarCandadoSuscripcion` (cron 60min) — eliminar.
- `crearPruebaSiFalta` — eliminar, reemplazado por `otorgarCreditosBienvenida`.
- `onDocenteCreado` — se conserva el trigger, cambia el cuerpo.
- `resetearCreditosIA` → renombrar/reimplementar como `ajustarSaldoCreditosIA`.
- `aprobarCompraCreditos` — sin cambios estructurales, cambia tabla de paquetes validada.
### `functions/ia.js` — auditoría realizada (ya no es "pendiente")

Se encontró lógica de plan/suscripción que debe eliminarse o reescribirse:

- **`precheckChatAsistente`** (~línea 3674-3698): llama `ledger.nivelDeSuscripcion(sub)` y bloquea con `codigo: 'PLAN_SIN_IA'` si `nivel === 'basico'` ("Tu plan actual no incluye el Chat con Asistente IA"). Debe eliminarse — Chat sigue con costo 0 créditos, gated solo por el límite diario de interacciones, sin ninguna condición de plan.
- **Repetido en `precheckPlaneacionInicial`** (~línea 3835) y en otro precheck (~línea 3775): mismo bloqueo `nivel === 'basico'` → `PLAN_SIN_IA`. Eliminar las tres ocurrencias.
- **Tope de reactivos por plan** (~línea 1489-1495, comentario "Tope de reactivos según el plan del docente"): usa `ledger.nivelDeSuscripcion(sub)` para variar el máximo de reactivos generables (hasta 100 en "planes de pago"). Debe convertirse en un límite único para todos los docentes (mismo tope, sin diferenciar por nivel) — **valor a confirmar**, no inventar un número nuevo sin indicarlo (razonable: usar el tope más alto ya vigente, a validar con Kike).
- **System prompt del Chat/Asistente General** (~línea 3747-3759): arma texto dinámico leyendo `tarifas.capacidadPorPlan`/`tarifas.planes` para explicarle al docente los planes `basico $99`/`pro $199`/`mayor $299` y "Suscribirse/pagar la suscripción mensual... por transferencia". Esto debe reescribirse por completo para explicar el modelo de créditos (50 de bienvenida, paquetes de compra, sin mención de planes mensuales).
- **Mapeo de códigos de error** (~línea 4572-4576): `SUSCRIPCION_VENCIDA` y `PLAN_SIN_IA` mapeados a `permission-denied`. Se elimina `SUSCRIPCION_VENCIDA` (ya no existe ese estado) y `PLAN_SIN_IA` (ya no aplica); se conserva `SALDO_INSUFICIENTE`.
- El resto del archivo (ejecución de operaciones, prompts de Planeación/Diagnóstico/Reactivos, etc.) no tiene lógica de plan — no requiere cambios funcionales, solo se ve afectado indirectamente por los cambios de `creditosLedger.js`.

## 5. Cambios en Firestore Rules

- `suscripcionHasta()`/`docenteActivo()` — se retiran de toda escritura de docente no-IA (activities, subjects, submissions, horario, asuetos, vacaciones, chatMensajes, eventos...). `allow write: if docenteActivo() && ...` → `allow write: if isDocente() && ...`.
- **Excepción Asistencias**: `attendance`/`attendanceSummaries` pasan a usar nueva función `saldoIAPositivo(uid)` que lee `iaCreditos/{uid}.saldo > 0` — **doc ausente = bloqueado** (a diferencia del patrón de `suscripcionHasta()`, aquí ausencia de créditos equivale a 0).
- `iaCreditos`, `iaConsumos`, `iaConsumosInterno`, `iaTrialRegistro` — reglas de escritura cliente sin cambios (`allow write: if false`).
- `creditPurchases/{id}` — se conserva validación de monto oficial, cambia tabla de precios referenciada.
- Desplegar rules **después** del backfill de `iaCreditos` (mismo patrón "functions → backfill → rules" ya documentado en `CLAUDE.md`).

## 6. Cambios en Frontend (archivo por archivo)

- `src/utils/firestoreGuard.js` — quitar bloqueo por suscripción vencida; reutilizar patrón para el candado de Asistencia por saldo.
- `src/components/Layout.jsx` — quitar bloqueo global; añadir gateo específico de Asistencia.
- `src/components/SuscripcionVencidaModal.jsx` — eliminar o reconvertir a "Asistencia bloqueada por saldo".
- `src/utils/subscriptionHelpers.js` — eliminar `MONTHLY_PRICE_MXN`, `ANNUAL_PRICE_MXN`, `BASICO_PRICE_MXN`, `MAYOR_PRICE_MXN`, `MESES_DESCUENTO`, `TRIAL_DURATION_DAYS`, `TRIAL_WARNING_DAYS`, `isSubscriptionExpired`, `canCreateContent`, `canRenew`, `effectiveVencimiento`, `getTrialBannerMessage`, `montoOficialDe`, `datosDePagoTransferencia`. Conservar `datosDeCompraCreditos`, `PAYMENT_STATUS`. Renombrar a `creditosHelpers.js`.
- `src/hooks/useCreditosIA.js` — simplificar: expone solo `saldo`, `tarifas`, `paquetesCreditos`, `estimar()`, `ejecutar()`. `pct` (barra por %) pierde sentido sin `capacidad` — decidir semáforo por umbrales absolutos.
- `src/components/CreditosPanel.jsx` — quitar referencias a plan/ciclo.
- `src/components/CreditosBar.jsx` — `UMBRALES` pasa de % de `capacidad` a valores absolutos de `saldo`.
- `src/components/ComprarCreditosModal.jsx` — solo cambia la fuente de paquetes, sin cambio estructural.
- `src/components/ConfirmacionCreditosModal.jsx` — quitar rama "trial insuficiente → suscribirse"; siempre CTA de comprar créditos.
- `src/components/PlanComparisonTable.jsx` — eliminar (redundante con `ComprarCreditosModal`).
- `src/components/CheckoutModal.jsx` — eliminar.
- `src/pages/teacher/PagoResultado.jsx` — revisar y eliminar/reconvertir.
- `src/pages/Profile.jsx` — quitar sección "mi plan"/renovación; conservar/ampliar sección de créditos.
- `src/pages/admin/components/SubscriptionsTable.jsx` — eliminar o reducir a histórico de solo lectura; botón "resetear créditos" → ajuste manual de saldo.
- `src/pages/admin/components/PaymentsTable.jsx` — eliminar.
- `src/pages/admin/components/CreditPurchasesTable.jsx` — sin cambios estructurales.
- `src/pages/admin/AdminLayout.jsx` — quitar entradas de menú a Suscripciones/Pagos si se eliminan esas pantallas.

## 7. Migración del modelo de suscripción

**Actualizado — no hay docentes reales ni clientes pagadores todavía.** No se diseña estrategia de migración/compensación de usuarios. El modelo de suscripciones mensuales queda descartado como modelo operativo por completo, sin caso especial que preservar:

- "Suscripción" deja de ser candado. Todo lo no-IA queda abierto para cualquier docente autenticado, desde ya.
- El trial de 30 días desaparece como ventana de tiempo; se reemplaza por el regalo único de 30 créditos sin caducidad.
- No existen suscripciones de pago reales que compensar — cualquier registro de `subscriptions`/`payments` existente es dato técnico de prueba de desarrollo, no una obligación comercial. Se puede limpiar libremente o dejar como esté; no bloquea el diseño.
- No se requiere comunicación a docentes por el cambio de modelo (no hay a quién comunicarle todavía).
- `subscriptions`, `payments` y `plans` se conservan como colecciones (útiles como histórico/infraestructura futura) pero **dejan de controlar acceso** a partir de esta implementación — se retiran de rules y de todo candado funcional.

## 8. Migración del sistema de créditos

**Actualizado — sin usuarios reales, no hace falta un script de migración de datos "en caliente".** En vez de migrar saldos existentes con cuidado transaccional, el camino limpio es:

- Reseedar/limpiar `iaCreditos` de cualquier dato de prueba de desarrollo (no son saldos que deban preservarse por obligación).
- El trial legado de 350 créditos queda descartado por completo — no existe ya en el modelo nuevo, ni como concepto ni como código (`capacidadTrialPara`, `cap.trial`, etc. se eliminan, no se migran).
- El nuevo trial es de 30 créditos, otorgados una sola vez por cuenta (`otorgarCreditosBienvenida`), sin caducidad. Se aplica a toda cuenta nueva desde la implementación; no hace falta decidir qué pasa con quien "ya usó" el trial legado porque ese trial deja de existir junto con el modelo que lo definía.
- Paquetes: reemplazar los 5 actuales ($0.50/crédito lineal) por los 6 definitivos en `config/iaTarifas.paquetesCreditos`. No hay compras pendientes reales que reconciliar contra precios viejos — se reseedea directo.
- Se elimina la lógica de "capacidad por plan" y "capacidad cortesía" sin reemplazo de compatibilidad; el ajuste manual admin (`ajustarSaldoCreditosIA`) cubre cualquier caso de cortesía futuro.

## 9. Asistencias

- Nueva función de rules `saldoIAPositivo()`: lee `iaCreditos/{uid}.saldo`, compara `> 0`. Doc ausente = bloqueado (a diferencia de `suscripcionHasta()`).
- No depende de compra histórica, solo del saldo actual.
- El otorgamiento de 30 créditos de bienvenida debe ocurrir antes o en el mismo instante que el docente pueda usar Asistencia, para evitar bloqueo por carrera de escritura en cuentas nuevas.
- Frontend: tab/ruta de Asistencia refleja el estado en tiempo real vía `onSnapshot` de `useCreditosIA()`; se re-habilita automáticamente sin recargar tras una compra aprobada.
- El candado real está en rules (server-side); la UI es solo la capa amable.

## 10. Inventario de funciones IA

Fuente única: `config/iaTarifas.tarifas` (Firestore), todas en `claude-haiku-4-5`.

| Operación | Créditos | Nota |
|---|---|---|
| aviso | 1 | |
| calificar_abierta | 1 | |
| retroalimentacion | 1 | |
| actividad | 1 | |
| cotejo | 1 | |
| guia_observacion | 1 | |
| reactivos_lote | 1 | |
| instrucciones | 1 | |
| mejorar_instrucciones | 1 | |
| modificar_planeacion | 1 | |
| plan_clase | 1 | |
| interpretar_resultados | 1 | |
| resumen_alumno | 1 | |
| resumen_grupo | 1 | |
| rubrica | 3 | |
| reactivos | 1 | |
| crear_evaluacion_ia | 1/reactivo | |
| crear_actividad_ia | 1 | |
| analizar_resultados | 5 | |
| diagnostico_contexto | 5 | |
| diagnostico_conocimientos | 10 | |
| planeacion_didactica_inicial | 20 | |
| chat_asistente | 0 | gratis, gated por límite diario, no por saldo |
| chat_crear_actividad | 4 | |
| chat_crear_examen | 8–16 según tramo de reactivos | |
| examen, cuestionario, analisis_apoyo, analisis_programa, planeacion_tronco, planeacion_bloque | 10/10/20/45/12/8 | tarifas sembradas, no conectadas a UI hoy |

Sin saldo suficiente: todas se bloquean antes de ejecutar, sin excepción salvo `chat_asistente` (no usa créditos, pero hoy tiene un bloqueo adicional `PLAN_SIN_IA` que se elimina — ver §4). El único límite por plan detectado (tope de reactivos generables, §4) pasa a ser un límite único para todos.

## 11. Pagos (depósito/transferencia)

1. Docente elige paquete en `ComprarCreditosModal.jsx`, sube comprobante (Cloudinary).
2. Se crea `creditPurchases/{id}` con `status:'pendiente'`, `metodo:'transferencia'`.
3. Rules validan `montoMXN == montoOficialCredito(creditos)` contra la tabla oficial nueva.
4. Admin aprueba en `CreditPurchasesTable.jsx` → callable `aprobarCompraCreditos` → `creditosLedger.acreditarCompraCreditos` (transaccional, idempotente) → incrementa `saldo`.
5. Se elimina el flujo paralelo de pago de suscripción.

## 12. Precios y configuración (centralización)

Todo vive solo en `config/iaTarifas` (Firestore), sembrado por `seeds-db/seed-ia-tarifas.js`:

```js
paquetesCreditos: [
  { creditos: 50,   precioMXN: 100  },  // Inicial
  { creditos: 100,  precioMXN: 175  },  // Básico
  { creditos: 200,  precioMXN: 350  },  // Mediano
  { creditos: 400,  precioMXN: 700  },  // Grande
  { creditos: 800,  precioMXN: 1400 },  // Pro
  { creditos: 1600, precioMXN: 2800 },  // Máximo
]
```

Se eliminan `capacidadPorPlan`, `trialLegado`, `planes` de `config/iaTarifas`. Se conservan `tarifas`, `categorias`, `modeloPorOperacion`, `costosAnthropicUSD`, `tipoCambioUsdMxn`, `version`, `actualizadoEl`.

## 13. UX (estados A–H)

| Estado | Comportamiento |
|---|---|
| A. Nuevo, 50cr | Otorgado automáticamente al crear cuenta, una sola vez, sin caducidad. |
| B. Con créditos | Todo funciona normal; saldo absoluto visible. |
| C. Pocos créditos | Aviso por umbral absoluto sugiriendo comprar más; sigue operando. |
| D. Saldo cero | Funciones IA siguen visibles, se bloquean al intentar ejecutar. |
| E. Intenta usar IA sin saldo | Mensaje claro + CTA directo a comprar créditos. |
| F. Saldo cero, entra a Asistencia | Tab deshabilitado/banner "Compra créditos para habilitar Asistencia"; rules rechazan escritura como defensa en profundidad. |
| G. Compra créditos | Sube comprobante → pendiente → espera aprobación admin. |
| H. Vuelve a saldo>0 | Saldo se refleja en vivo (onSnapshot); Asistencia se re-habilita automáticamente. |

## 14. Riesgos

**ALTO**: orden de despliegue incorrecto (rules antes de backfill/seed de `iaCreditos`) bloquearía Asistencia para todos. Carrera entre creación de cuenta y primer acceso a Asistencia si el otorgamiento de 30 créditos no es síncrono con la creación del docente.

**MEDIO**: reportes de consumo por categoría dependían de reseteo mensual — pasan a ser históricos totales (aceptable, sin usuarios reales que pierdan histórico real). Eliminar componentes de suscripción sin verificar enlaces internos rotos (menús, imports). Tope de reactivos por plan (§4) requiere que Kike confirme el valor único a usar.

**BAJO**: renombrar `subscriptionHelpers.js` (mecánico). Eliminar crons de renovación/sincronización (sin efecto en datos).

## 15. Plan de pruebas

1. `test/ia-creditos.test.mjs`: reescribir bloques de ciclo/plan/trial legado; añadir casos de no-reseteo, idempotencia del regalo de bienvenida, idempotencia de aprobación de compra.
2. `test/firestore-rules.test.mjs`: eliminar bloques de `docenteActivo()` para colecciones ya no gateadas; añadir bloque de `saldoIAPositivo()` sobre `attendance` (saldo>0 permite, saldo=0 bloquea, doc ausente bloquea); cubrir `creditPurchases` con tabla de precios nueva.
3. E2E manual: cuenta nueva → 30 créditos automáticos → gastar hasta 0 → Asistencia bloqueada → comprar → aprobar como admin → saldo y Asistencia se actualizan en vivo.
4. Regresión: docente con `basico` histórico puede usar IA con solo comprar créditos.
5. Prueba de orden de despliegue en staging: functions → backfill → rules, sin bloqueo intermedio.

## 16. Orden de implementación

_Simplificado: sin usuarios reales, no hace falta ventana de migración cuidadosa ni comunicación — se puede ir directo al modelo definitivo._

1. ~~Auditar `functions/ia.js`~~ — hecho (§4).
2. Actualizar `config/iaTarifas` en `seed-ia-tarifas.js` (nuevos paquetes, quitar `capacidadPorPlan`/`trialLegado`/`planes`).
3. Reescribir `functions/creditosLedger.js`.
4. Actualizar `functions/index.js` y `functions/ia.js` (quitar los 3 bloqueos `PLAN_SIN_IA`, el tope de reactivos por plan, y reescribir el system prompt del Chat).
5. Actualizar y correr tests contra emulador (`test:rules`, `ia-creditos.test.mjs`).
6. Desplegar Cloud Functions.
7. Reseedear `config/iaTarifas` (nuevos paquetes/tarifas) y limpiar/reseedear `iaCreditos` de datos de prueba.
8. Desplegar `firestore.rules` (quitar `docenteActivo()` de escritura general no-IA, añadir `saldoIAPositivo()` en Asistencia).
9. Desplegar frontend.
10. Verificación E2E.

## 17. Archivos a modificar

- `functions/creditosLedger.js`
- `functions/index.js`
- `functions/ia.js` (pendiente auditoría)
- `seeds-db/seed-ia-tarifas.js`
- `firestore.rules`
- `src/utils/firestoreGuard.js`
- `src/utils/subscriptionHelpers.js` → `creditosHelpers.js` (+ imports)
- `src/hooks/useCreditosIA.js`
- `src/components/Layout.jsx`
- `src/components/CreditosPanel.jsx`
- `src/components/CreditosBar.jsx`
- `src/components/ComprarCreditosModal.jsx`
- `src/components/ConfirmacionCreditosModal.jsx`
- `src/pages/Profile.jsx`
- `src/pages/admin/components/SubscriptionsTable.jsx`
- `src/pages/admin/components/CreditPurchasesTable.jsx`
- `src/pages/admin/AdminLayout.jsx`
- Componente/utilidad de gateo de asistencia
- `test/ia-creditos.test.mjs`
- `test/firestore-rules.test.mjs`
- `seeds-db/backfill-suscripcion.js` (revisar vigencia)
- Nuevo: `seeds-db/migrar-creditos-puros.js`

## 18. Archivos a eliminar o deprecar

- `src/components/CheckoutModal.jsx`
- `src/components/PlanComparisonTable.jsx`
- `src/components/SuscripcionVencidaModal.jsx` (o reconvertir)
- `src/pages/admin/components/PaymentsTable.jsx`
- `src/pages/teacher/PagoResultado.jsx` (revisar primero)
- `seeds-db/seed-plans.js` (deprecar)
- Ledger: `renovarCiclosVencidos`, `cerrarTrialsVencidos`, `sincronizarPlan`, `nivelDeSuscripcion`, `capacidadTrialPara`, `camposRenovados`, `unMesDespues`
- Cloud Functions: `onSuscripcionEscrita` (o vaciar), `sincronizarCandadoSuscripcion`, `crearPruebaSiFalta`

## 19. Criterios de aceptación

- [ ] Docente sin créditos puede usar todo lo no-IA (incluida Asistencia con saldo>0) sin candado de suscripción.
- [ ] Cuenta nueva recibe 30 créditos automáticos, una sola vez, sin caducidad.
- [ ] El saldo nunca disminuye por el paso del tiempo.
- [ ] Cada operación de IA descuenta exactamente el costo configurado, nunca más ni menos.
- [ ] Nunca se ejecuta IA con saldo insuficiente; nunca hay saldo negativo.
- [ ] Asistencia se bloquea exactamente en `saldo==0` y se rehabilita exactamente en `saldo>0`, sin depender de historial de compras.
- [ ] Comprar cualquiera de los 6 paquetes acredita el número exacto tras aprobación, con precio validado contra la tabla oficial.
- [ ] Ningún precio/paquete hardcodeado fuera de `config/iaTarifas`.
- [ ] Migración conserva el saldo exacto (1:1) de cada docente.
- [ ] Rules bloquean de forma independiente del cliente cualquier gasto sin saldo o escritura de Asistencia con saldo 0.
- [ ] Ningún test referencia planes de suscripción/ciclo mensual tras la migración.

## 20. Decisiones pendientes

Sin usuarios reales, la mayoría de lo anterior deja de aplicar. Queda solo esto:

1. **Tope único de reactivos generables por operación** (§4, hoy variaba hasta 100 en "planes de pago" vs. un tope menor en trial/básico) — ¿qué valor único usar para todos los docentes en el modelo nuevo? No se inventa un número sin tu confirmación.
2. **Vida de `subscriptions`/`payments`/`plans`** — quedan como colecciones/infraestructura sin controlar acceso (regla 7 del PO); no requieren decisión adicional salvo que en el futuro quieras borrarlas del todo.

Todo lo demás (compensación de usuarios, trial legado, comunicación, migración de saldos reales) queda descartado como no aplicable, según tus reglas 1-6 y 9.
