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
`origen` (`ledger` | `historico`).

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
(«Mes anterior / siguiente») y se ordena en memoria. Se oculta por defecto el Chat con
Asistente que no cuesta nada (casilla para mostrarlo).

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
