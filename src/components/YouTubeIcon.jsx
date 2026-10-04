// Logotipo de YouTube (botón de reproducir rojo). lucide-react ya no trae
// íconos de marca, así que va como SVG propio. Es decorativo: el texto que lo
// acompaña ("Tutoriales") ya nombra el enlace.
export default function YouTubeIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true" focusable="false" className={className}>
      <path fill="#FF0000" d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z" />
      <path fill="#FFFFFF" d="m11.2 14.3 7.2-4.3-7.2-4.3v8.6Z" />
    </svg>
  )
}
