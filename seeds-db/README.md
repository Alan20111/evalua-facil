# Seeds DB — Database Management Scripts

Scripts para limpiar y gestionar la base de datos de Firestore de Evalúa Fácil.

## ¿Qué hace?

Borra TODAS las colecciones de Firestore:
- `users` (docentes)
- `students` (alumnos)
- `groups` (grupos)
- `subjects` (asignaturas)
- `activities` (tareas/actividades)
- `submissions` (entregas)
- `schools` (planteles)

## Uso

### Opción 1: Firebase CLI (recomendado)
```bash
cd seeds-db
bash clear-db-firebase-cli.sh
```

Requiere: `firebase-cli` instalado y `firebase login` hecho.

### Opción 2: Node.js + Firebase Admin SDK
```bash
cd seeds-db
npm install
node clear-db.js
```

Requiere: credenciales de Firebase Admin SDK (descárgatelo de Firebase Console → Project Settings → Service Accounts).

## ⚠️ Advertencias

- **DESTRUCTIVO**: Borra TODOS los documentos. No hay undo.
- **DATOS PERDIDOS**: Después de ejecutar, toda la información de usuarios, tareas y entregas desaparece.
- **Confirmación**: El script pide confirmación (escribe "yes").

## Cuándo usar

- 🧪 **Testing**: Para empezar la app desde cero con una BD limpia
- 🔄 **Reset**: Para limpiar datos de prueba antes de entregar a producción
- 📊 **Pruebas del flujo completo**: Para validar que el registro y uso de la app funciona de punta a punta

## Después de limpiar

La app funciona normalmente. Los nuevos usuarios que se registren crearán nuevos documentos en Firestore.

---

**Creado**: 2026-06-12  
**Proyecto**: Evalúa Fácil (evalua-facil-app)
