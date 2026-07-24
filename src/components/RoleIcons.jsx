// Íconos de la pantalla "Elige cómo quieres entrar" (src/pages/Landing.jsx) —
// uno por rol, a pedido explícito (antes ambas tarjetas usaban el mismo
// logotipo). Trazo tipo lucide (stroke, esquinas redondeadas) para que
// combinen con el resto de los íconos de la app.

export function DocenteIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Documento con dos líneas (checklist) */}
      <path d="M10 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <line x1="10.5" y1="6" x2="15.5" y2="6" />
      <line x1="10.5" y1="8" x2="15.5" y2="8" />
      {/* Persona con palomita — asignar/aprobar */}
      <circle cx="5.5" cy="11" r="2.5" />
      <path d="M2 20.5c0-2.2 1.75-4 3.5-4s3.5 1.8 3.5 4" />
    </svg>
  )
}

// Simplificado a propósito — mismo criterio que DocenteIcon (circle + curve):
// solo una cabeza (círculo) sobre un libro.
export function EstudianteIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="7" r="2.5" />
      <path d="M6 15c2 -2 4.5 -2 6 0c1.5 -2 4 -2 6 0" />
      <line x1="6" y1="18.5" x2="18" y2="18.5" />
    </svg>
  )
}
