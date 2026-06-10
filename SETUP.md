# Evalúa Fácil — Setup Guide

## 1. Crear proyecto en Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Crear nuevo proyecto → pon el nombre que quieras
3. Desactiva Google Analytics (opcional)

## 2. Habilitar servicios en Firebase

### Authentication
- Authentication → Sign-in method → Email/Password → **Habilitar**

### Firestore
- Firestore Database → Crear base de datos → **Modo de prueba** (para desarrollo)
- Copia las reglas de `firestore.rules` en la pestaña "Reglas" de Firestore

### Storage
- Storage → Comenzar → **Modo de prueba**

## 3. Obtener credenciales

1. Configuración del proyecto (ícono ⚙️) → **Tus apps** → Agregar app → Web (`</>`)
2. Registra la app
3. Copia el objeto `firebaseConfig`

## 4. Crear archivo `.env`

Copia `.env.example` como `.env` y llena los valores del firebaseConfig:

```
cp .env.example .env
```

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=mi-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=mi-proyecto
VITE_FIREBASE_STORAGE_BUCKET=mi-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

## 5. Correr la app

```bash
npm run dev
```

Abre `http://localhost:5173`

## 6. Primer uso

1. Ve a `/register` para crear tu cuenta de docente
2. Ingresa tu nombre, correo, contraseña y **clave SEP** de tu escuela
3. Si la escuela no existe, se crea automáticamente
4. Crea un grupo y comparte el QR con tus alumnos

## Estructura de datos en Firestore

| Colección | Descripción |
|-----------|-------------|
| `schools` | Escuelas por clave SEP |
| `users` | Docentes (UID = Firebase Auth UID) |
| `groups` | Grupos por docente |
| `students` | Alumnos con username auto-generado |
| `subjects` | Asignaturas por grupo |
| `activities` | Actividades por parcial |
| `submissions` | Entregas de alumnos |

## Username de alumnos

Se genera automáticamente: 2 letras AP + 1 AM + 1 Nombre  
Ejemplo: **Mendez Reyes Karla** → `MERK`  
Si ya existe: `MERK2`, `MERK3`, etc.

## Login de alumnos

Los alumnos inician sesión con:
- **Clave SEP** de su escuela
- **Username** (ej: MERK)
- **Contraseña** (la que pusieron al activar)
