import { useState, useEffect } from 'react'
import { buscarCodigoPostal, soloDigitosCP } from '../utils/codigoPostal'

// Resuelve un CP a { estado, municipio, ciudad } conforme el docente escribe.
//
// El resultado se guarda junto con el CP que lo produjo (`{ cp, ubicacion }`)
// y no como dos estados sueltos: así, mientras se está descargando el
// fragmento del CP nuevo, no se alcanza a ver un instante la ubicación del CP
// anterior. Además todos los setState quedan dentro del .then() —fuera del
// cuerpo del efecto— que es lo que pide react-hooks/set-state-in-effect.
export function useUbicacionCP(cp) {
  const [resuelto, setResuelto] = useState(null) // { cp, ubicacion }

  useEffect(() => {
    const limpio = soloDigitosCP(cp)
    if (limpio.length !== 5) return
    let activo = true
    buscarCodigoPostal(limpio).then((ubicacion) => {
      if (activo) setResuelto({ cp: limpio, ubicacion })
    })
    return () => { activo = false }
  }, [cp])

  const limpio = soloDigitosCP(cp)
  const completo = limpio.length === 5
  const acertado = resuelto && resuelto.cp === limpio
  return {
    ubicacion: acertado ? resuelto.ubicacion : null,
    buscando: completo && !acertado,
    // true solo cuando ya se buscó y el catálogo no lo tiene — para no marcar
    // error mientras el docente va escribiendo o mientras baja el fragmento.
    noEncontrado: completo && acertado && !resuelto.ubicacion,
  }
}
