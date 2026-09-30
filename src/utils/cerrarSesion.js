import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { IS_NATIVE_APP } from './platform'

// Claves de sessionStorage que pertenecen a la sesión que se cierra: si el
// siguiente usuario de la misma pestaña las heredara, se saltaría el aviso de
// proteger su cuenta (protectAccountSkipped) o vería la búsqueda/scroll de
// calificaciones del anterior (ef-calif-state-*). `vite_reload` NO va aquí:
// es del deploy, no de la persona.
const CLAVES_DE_SESION = ['protectAccountSkipped']
const PREFIJOS_DE_SESION = ['ef-calif-state-']

function limpiarSessionStorage() {
  try {
    CLAVES_DE_SESION.forEach((k) => sessionStorage.removeItem(k))
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && PREFIJOS_DE_SESION.some((p) => k.startsWith(p))) sessionStorage.removeItem(k)
    }
  } catch { /* almacenamiento bloqueado — no impide el cierre */ }
}

// Único punto de "Cerrar sesión" (docente, alumno y admin). No navega: cada
// pantalla decide a dónde va después. Lanza si la sesión no quedó cerrada,
// para que quien la llama lo diga en pantalla en vez de fingir que salió.
//
// La persistencia NO se toca: cerrar la pestaña sin pulsar este botón deja la
// sesión viva, como siempre. Lo que garantiza esto es que, al pulsarlo, el
// usuario desaparece de la persistencia de Firebase de este origen.
export async function cerrarSesion() {
  await signOut(auth)
  if (auth.currentUser !== null) throw new Error('La sesión no se cerró')

  // En la app nativa, "Continuar con Google" pasa por el plugin, que recuerda
  // la cuenta de Google por su lado; sin esto, el siguiente toque entra de
  // nuevo con la misma cuenta sin preguntar. Best-effort: la sesión de
  // Firebase (la que da acceso a los datos) ya quedó cerrada arriba.
  if (IS_NATIVE_APP) {
    try {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
      await FirebaseAuthentication.signOut()
    } catch { /* sin sesión nativa que cerrar */ }
  }

  limpiarSessionStorage()
}
