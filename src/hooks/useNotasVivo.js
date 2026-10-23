// Notas del docente de UNA sesión en vivo: carga, borrador local, guardado con control de versión y conflicto.
//
//   · El texto en pantalla vive aquí (no en la tarjeta) para que el «Informe en PDF» incluya exactamente lo que el docente ve.
//   · Borrador local (por navegador): Escape o «Salir» cierran la presentación; lo escrito y no guardado se recupera al volver.
//   · Guardar solo procede si nadie más guardó mientras tanto (versión). Si sí, se avisa y el docente decide; nada se pisa.
import { useCallback, useEffect, useState } from 'react'
import { guardarNotasVivo, leerNotasVivo } from '../utils/participacionVivoDb'

const claveBorrador = (codigo) => `ef-vivo-notas-borrador-${codigo}`
function leerBorrador(codigo) {
  try { return localStorage.getItem(claveBorrador(codigo)) } catch { return null }
}
function escribirBorrador(codigo, texto) {
  try { if (texto == null) localStorage.removeItem(claveBorrador(codigo)); else localStorage.setItem(claveBorrador(codigo), texto) } catch { /* sin almacenamiento: solo se pierde el respaldo local */ }
}

export function useNotasVivo(sesion) {
  const codigo = sesion?.codigo
  const [cargando, setCargando] = useState(true)
  const [texto, setTexto] = useState('')
  const [guardado, setGuardado] = useState('')
  const [version, setVersion] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [guardadoEn, setGuardadoEn] = useState(null)
  const [error, setError] = useState('')
  const [conflicto, setConflicto] = useState(null) // { texto, version } de lo que guardó otra pestaña
  const [recuperado, setRecuperado] = useState(false)

  useEffect(() => {
    if (!codigo) return undefined
    let vivo = true // una presentación muestra UNA sesión: el código no cambia mientras el componente vive
    leerNotasVivo(codigo)
      .then((r) => {
        if (!vivo) return
        const borrador = leerBorrador(codigo)
        setGuardado(r.texto); setVersion(r.version)
        const hayBorrador = borrador != null && borrador !== r.texto
        setTexto(hayBorrador ? borrador : r.texto)
        setRecuperado(hayBorrador)
      })
      .catch(() => { if (vivo) setError('No se pudieron cargar tus notas. Revisa tu conexión y vuelve a abrir los resultados.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [codigo])

  const sucio = !cargando && texto !== guardado
  // El borrador local acompaña a los cambios sin guardar y desaparece al guardar.
  useEffect(() => {
    if (!codigo || cargando) return
    escribirBorrador(codigo, texto !== guardado ? texto : null)
  }, [codigo, cargando, texto, guardado])

  const guardar = useCallback(async (versionBase = version) => {
    if (!sesion) return
    setGuardando(true); setError(''); setConflicto(null)
    try {
      const nueva = await guardarNotasVivo({ sesion, texto, versionEsperada: versionBase })
      setVersion(nueva); setGuardado(texto); setGuardadoEn(new Date()); setRecuperado(false)
    } catch (e) {
      if (e?.code === 'conflicto') setConflicto(e.remoto)
      else setError('No se pudieron guardar tus notas. Siguen en pantalla: intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }, [sesion, texto, version])

  // Conflicto: o se toman las que ya estaban guardadas, o se guardan las propias encima (decisión explícita del docente).
  const usarGuardadas = useCallback(() => {
    if (!conflicto) return
    setTexto(conflicto.texto); setGuardado(conflicto.texto); setVersion(conflicto.version); setConflicto(null)
  }, [conflicto])
  const conservarMias = useCallback(() => conflicto && guardar(conflicto.version), [conflicto, guardar])

  return { cargando, texto, setTexto, sucio, guardando, guardadoEn, error, conflicto, recuperado, guardar: () => guardar(), usarGuardadas, conservarMias }
}
