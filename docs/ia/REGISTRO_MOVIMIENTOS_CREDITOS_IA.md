# Registro de movimientos de créditos IA del docente (`iaMovimientos`)

Autorizada por Kike (19-oct-2026). En la interfaz se llama «Registro de movimientos»; `iaMovimientos` y los nombres técnicos no cambian. Este registro de movimientos es para que el docente entienda su
historial de créditos; no es un registro de costos internos de API.

## Qué es

Una colección, `iaMovimientos/{id}`, con **un documento por movimiento de créditos**.
La escribe **solo el ledger** (`functions/creditosLedger.js`), dentro de la **misma
transacción** que mueve el saldo: o se aplican las dos cosas o ninguna, y
`saldoDespues` es el saldo real que dejó esa transacción. El cliente solo lee lo suyo
(`firestore.rules`): `allow read` si `resource.data.uid == request.auth.uid`,
`allow write: if false`.

| Movimiento | Se escribe en | ID del documento | `delta` |
|---|---|---|---|
| Consumo de IA | `reservar` → `liquidar` / `reembolsar` | la clave de idempotencia | `-reserva` (en proceso) → `-cobro real` (aplicado) → `0` (sin cobro) |
| Compra aprobada | `acreditarCompraCreditos` | `compra_{purchaseId}` | `+créditos` |
| Bienvenida | `activarCreditosBienvenida` | `bienvenida_{uid}` | `+monto` |
| Ajuste del admin | `ajustarSaldoManual` | `ajuste_{id aleatorio}` | lo que de verdad cambió el saldo (si se recorta en cero, solo el recorte; si no cambia nada, no hay movimiento) |

Un consumo es **una fila por operación**: nace `en_proceso` (reserva ya descontada) y se
cierra `aplicado` (cobro real) o `sin_cobro` (`motivoCodigo`: `fallido`, `expirado`,
`cancelado`; saldo devuelto, **no se descontó nada**).

Campos: `uid`, `periodo` (`AAAA-MM`, hora de México), `tipo`, `operacion`, `categoria`,
`delta`, `estado`, `motivoCodigo`, `saldoDespues`, `ref`, `fecha`, `actualizadoEn`,
`origen` (`ledger` | `historico`) y, solo en «Calificar con IA» de entregables (oct-2026),
`detalle`.

### `detalle` de «Calificación de evidencias» (oct-2026)

La tarifa de «Calificar con IA» es **por entrega** según el **contenido** de lo que
entregó el estudiante (regla definitiva de Kike, oct-2026): **0.25** si solo hay texto
procesable; **0.50** si hay al menos una imagen o texto escaneado —foto, PDF escaneado
(aunque traiga capa de texto), PDF o Word con fotografías, dibujo con poco texto—, una
sola vez por entrega. Si no se puede clasificar con fiabilidad (archivo dañado o
inaccesible, imagen sin medida, escaneo de más de 10 páginas), la entrega **no se
califica ni se cobra**: en el lote se excluye y se lista con su motivo; individual se
bloquea antes de reservar. Umbrales: 200 caracteres por página y 200 px por lado (medidos
sobre 305 PDF reales). Igual en la calificación individual y en el lote (reglas puras en
`src/utils/tarifaCalificacionEvidencias.js`, copiadas al servidor; la lectura de PDF/Word
en `functions/evidenciasEntrega.js`, que reutiliza `docExtract.clasificarBytes`). El servidor calcula
el costo, la pantalla lo muestra antes de confirmar y el ledger reserva **exactamente**
ese importe. El ledger guarda en el movimiento (y en `iaConsumos/{id}`), dentro de la
misma transacción:

| Campo | Qué es |
|---|---|
| `modo` | `individual` o `lote` |
| `entregas`, `conImagenes`, `soloDocumentos` | al reservar: las confirmadas; al liquidar: las que **de verdad** se evaluaron |
| `tarifaImagenes`, `tarifaDocumentos` | tarifas vigentes con las que se calculó |
| `reservado`, `cobrado`, `devuelto` | importe reservado, cobrado y devuelto (fallos parciales o totales) |
| `noProcesadas` | entregas confirmadas que no se pudieron evaluar (no se cobran) |

Los movimientos anteriores no tienen `detalle`: la pantalla muestra solo lo que su
consumo permite comprobar (entregas evaluadas × la tarifa única que se cobró), sin decir
si eran imágenes o documentos, porque ese dato nunca se guardó.

Categoría: si la clave efectiva (`…_imagenes`) no tiene categoría propia en
`config/iaTarifas`, el ledger usa la de la operación base («Calificación de evidencias»).
Los cobros anteriores que quedaron en «Otros» (en `iaCreditos.consumoPorCategoria` y en
cada movimiento) no se tocan.

**Nunca se copia aquí**: el `motivo` técnico de un error del proveedor, el `resultado` de
la IA, el `motivo` ni el `adminUid` de un ajuste. La interfaz muestra textos fijos
(«Ajuste de Evalúa Fácil», «La operación no se completó · No se descontó nada»).

## Integridad

- IDs deterministas: un reintento reescribe el mismo documento, no duplica.
- Las escrituras del registro de movimientos van en la transacción del ledger: concurrencia cubierta por
  las mismas transacciones que ya protegen el saldo.
- Una reserva anterior al registro de movimientos (sin movimiento) que se liquida después crea su
  movimiento completo (la escritura es `merge`).
- Invariante probada: el `saldoDespues` del movimiento más reciente es igual a
  `iaCreditos.saldo`.
- No cambia tarifas, saldos, bienvenida ni la lógica de consumo.

## Consulta del cliente

`where('uid','==',uid)` + `where('periodo','==','AAAA-MM')`: dos igualdades, sin
`orderBy` (regla del proyecto) y **sin índice compuesto**. Se pagina por mes
(«Mes anterior / siguiente») y se ordena en memoria.

## Presentación

Una tabla de cuatro columnas —**Fecha**, **Saldo**, **Concepto** y **Créditos**— con los
filtros «Todos / Consumos / Recargas y ajustes» (oct-2026; antes eran tres, sin Saldo).

- **Saldo**: el `saldoDespues` que escribió el ledger en la misma transacción, en el
  color del texto principal y con dos decimales. Si falta (registros importados), «—»:
  nunca se reconstruye.
- **Créditos**: dos decimales y el tono sale del **signo real** del movimiento, no del
  concepto: negativo en rojo (`−21.50`), positivo en verde (`+200.00`), cero neutro
  (`0.00`). Un reembolso del ledger no crea un abono aparte: deja el mismo movimiento en
  «Sin cobro», 0.00.
- **Concepto**: las cuatro claves de «Calificar con IA» de entregables se muestran como
  «Calificación de evidencias», con el desglose debajo (p. ej. «Lote · 10 entregas ·
  4 × 0.50 + 6 × 0.25 = 3.50 créditos»).

Un mes sin movimientos muestra su mensaje dentro de la tabla.

**Chat con Asistente (función retirada):** es solo presentación. Las operaciones
`chat_asistente`, `chat_crear_actividad` y `chat_crear_examen` nunca aparecen en el
registro, tengan costo o no, y la categoría «Chat con Asistente» nunca aparece en
«Consumo por categoría». «Utilizados en total» muestra el total real menos lo de esa
categoría, para que cuadre con el desglose. Los datos históricos, los saldos y el ledger
no se tocan (`iaCreditos.consumidoTotal` sigue incluyéndolo).

## Historial anterior (backfill)

`seeds-db/backfill-movimientos.js` — **simulación por defecto**; escribir exige
`--ejecutar` y la autorización expresa de Kike. Importa solo lo demostrable, con
`origen:'historico'` y **sin `saldoDespues`** (nunca se guardó): consumos de
`iaConsumos`, bienvenidas activadas (con el monto guardado en el registro), compras
completadas y el último ajuste manual si fue positivo. No importa reservas en vuelo,
ajustes negativos, la devolución manual de `iaConsumos.devolucion`, ni registros de
cuentas que ya no existen. Usa los mismos IDs que el ledger y `create()`, así que nunca
pisa un movimiento del ledger.

## Hallazgo de seguridad aparte (NO corregido en este cambio)

`iaCreditos/{uid}` lo puede leer su dueño, y `ajustarSaldoManual` guarda en ese mismo
documento `ultimoAjusteManual = { delta, motivo, adminUid, en }`. Por lo tanto **el
docente puede leer hoy la nota interna que escribió el administrador y el `uid` del
administrador**. Las reglas de Firestore no pueden ocultar campos de un documento que sí
se puede leer.

- **Alcance:** el último ajuste de cada cuenta que alguna vez recibió uno (4 cuentas al
  momento del análisis). Solo lo ve el propio docente (no otros docentes). No hay
  tokens ni claves.
- **Parecido, mismo origen:** `iaConsumos` también es legible por su dueño y trae
  `resultado` (contenido completo generado por la IA) y `motivo` (hubo errores crudos del
  proveedor: `401 …`, `Connection error`), y un registro tiene una `devolucion` manual
  con texto interno. El registro de movimientos nuevo no los expone, pero siguen siendo legibles en esos
  documentos.
- **Corrección propuesta (requiere autorización, toca permisos/datos):**
  1. Dejar de escribir `motivo` y `adminUid` en `iaCreditos`; registrarlos en una
     colección solo para el servidor (p. ej. `iaAjustesInterno`, `read, write: if false`),
     como ya se hace con `iaConsumosInterno`.
  2. Borrar `ultimoAjusteManual` de las 4 cuentas existentes (cambio de datos; se
     simula primero y se ejecuta solo con tu visto bueno).
  3. Para `iaConsumos`: mover `motivo`/`devolucion` a `iaConsumosInterno` y dejar solo un
     código; evaluar si `resultado` debe seguir en un documento legible por el cliente
     (hoy `generar_preguntas_video` lo usa para recuperar el resultado tras un reintento).
