# Seeds DB — Database Management Scripts

Scripts para limpiar, sembrar y gestionar la base de datos de Firestore de Evalúa Fácil.

## Colecciones gestionadas

| Colección | Descripción |
|-----------|-------------|
| `plans` | Catálogo de planes de suscripción |
| `subscriptions` | Suscripciones por docente |
| `payments` | Historial de pagos |
| `users` | Docentes, alumnos y administradores |
| `students` | Alumnos |
| `groups` | Grupos |
| `subjects` | Asignaturas |
| `activities` | Tareas/actividades |
| `submissions` | Entregas |
| `schools` | Planteles |

## Requisitos

```bash
cd seeds-db
npm install
```

Credenciales: variable `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una service account, o sesión activa de `firebase login` (los scripts usan los tokens del Firebase CLI cuando están disponibles).

---

## Sembrar planes por defecto

Inserta tres planes de suscripción (idempotente — se pueden volver a ejecutar):

| Plan | Precio | Límites |
|------|--------|---------|
| Básico | $199/mes | 3 asignaturas, 50 alumnos |
| Pro | $399/mes | 10 asignaturas, 200 alumnos |
| Institucional | $799/mes | ilimitado |

```bash
cd seeds-db
node seed-plans.js
# o
npm run seed-plans
```

---

## Crear o promover administrador

Asigna `role: admin` en `users/{uid}`. Solo ejecutable con Firebase Admin SDK (no desde el cliente).

**Promover usuario existente** (ya registrado en la app):

```bash
cd seeds-db
node create-admin.js --email admin@ejemplo.com
```

**Crear cuenta admin nueva**:

```bash
cd seeds-db
node create-admin.js --email admin@ejemplo.com --create --password MiClave123
```

---

## Limpiar base de datos

Borra **todas** las colecciones listadas arriba (incluye `plans`, `subscriptions` y `payments`).

### Opción 1: Firebase CLI (recomendado)

```bash
cd seeds-db
bash clear-db-firebase-cli.sh
```

Requiere: `firebase-cli` instalado y `firebase login` hecho.

### Opción 2: Node.js + Firebase Admin SDK

```bash
cd seeds-db
node clear-db.js
# o
npm run clear
```

### Opción 3: Borrado forzado sin confirmación

```bash
cd seeds-db
bash clear-all.sh
```

---

## Verificar estado de la BD

```bash
cd seeds-db
node verify.js
```

Muestra el conteo de documentos por colección.

---

## Flujo típico de prueba (billing)

```bash
cd seeds-db
npm install
node seed-plans.js
node create-admin.js --email admin@ejemplo.com
# (opcional) node clear-db.js   # solo si necesitas reset completo
```

Luego en la app: un docente simula un pago desde su perfil y el admin lo aprueba en `/Admin`.

---

## ⚠️ Advertencias

- **DESTRUCTIVO**: Los scripts de limpieza borran todos los documentos. No hay undo.
- **Confirmación**: `clear-db.js` y `clear-db-firebase-cli.sh` piden escribir `yes` antes de borrar.
- **Admin**: El rol `admin` solo debe asignarse vía estos scripts, nunca desde el cliente.

---

**Proyecto**: Evalúa Fácil (`evalua-facil-app`)
