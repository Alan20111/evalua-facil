import { CANAL_YOUTUBE_URL } from '../config/canalYouTube'
import { IS_NATIVE_APP } from '../utils/platform'

// Enlace al canal oficial de YouTube. EXCLUSIVO DEL DOCENTE: solo se coloca en
// pantallas del docente (login, menú lateral, panel y Centro de ayuda) — nunca
// en StudentLayout ni en pages/student/.
//
// El componente no decide el aspecto: cada pantalla le pasa las clases de su
// propio lenguaje visual (renglón del sidebar, tarjeta, enlace de texto). Lo
// único que fija es el destino y cómo se abre — pestaña nueva, con el mismo
// patrón de enlace externo del resto de la plataforma.
//
// En la app nativa no se pinta: esta etapa es solo web, y la interfaz de la
// app se queda exactamente como estaba.
export default function CanalYouTubeLink({ className, children }) {
  if (IS_NATIVE_APP) return null
  return (
    <a href={CANAL_YOUTUBE_URL} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  )
}
