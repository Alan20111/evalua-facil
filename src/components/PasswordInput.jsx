// Campo de contraseña = ui/Input con un botón de ojo a la derecha. El ojo es
// un botón real (enfocable, con nombre y aria-pressed) que parpadea al
// alternar. Acepta las mismas props que Input (label, hint, error…); el
// `className` que pasen las pantallas viejas se suma sin cambiar la altura.
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Animado, IconButton, Input } from './ui'
import { ICONO } from '../config/iconos'

export default function PasswordInput({ className = '', ...props }) {
  const [show, setShow] = useState(false)
  const Icono = show ? EyeOff : Eye
  return (
    <Input
      {...props}
      type={show ? 'text' : 'password'}
      className={className}
      suffix={(
        <IconButton
          label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          tooltip={false}
          size="sm"
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          <Animado efecto="parpadeo" cuando="una" disparador={show}><Icono size={ICONO.md} /></Animado>
        </IconButton>
      )}
    />
  )
}
