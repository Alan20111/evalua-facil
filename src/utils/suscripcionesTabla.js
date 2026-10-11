// Reglas de presentación de la tabla «Suscripciones (histórico)» del panel de
// administración. Son funciones puras para poder probarlas sin navegador.
import { capitalizarNombre } from './nombres.js'
import { estadoRegaloIA } from './creditosHelpers.js'

const limpio = (v) => String(v ?? '').trim()

// Nombre del docente tal como lo registró en su perfil. Cadena de respaldo:
//   1. nombre + apellido paterno (+ materno, si lo hay) — el nombre completo.
//      Cada parte se capitaliza POR SEPARADO: capturados en campos distintos,
//      uno puede venir en mayúsculas y otro no ("Laura" + "GARCÍA"), y unidos
//      parecerían escritos a propósito y se respetarían tal cual.
//   2. nombreMostrar (el alias libre que escribió al registrarse).
//   3. nombre suelto (es lo único que guardan las constancias de baja).
//   4. username, que es identificador y no se capitaliza.
// Nunca se deduce nada del correo ni se escribe en el perfil.
export function nombreCompletoDocente(teacher) {
  const nombre = limpio(teacher?.nombre)
  const paterno = limpio(teacher?.apellidoPaterno)
  const materno = limpio(teacher?.apellidoMaterno)
  if (nombre && paterno) {
    return [nombre, paterno, materno].map(capitalizarNombre).filter(Boolean).join(' ')
  }
  return (
    capitalizarNombre(teacher?.nombreMostrar) ||
    capitalizarNombre(teacher?.nombre) ||
    limpio(teacher?.username)
  )
}

// Qué mostrar en «Saldo IA». Devuelve el número a pintar o `null` (= guion).
//
// El guion significa «no hay saldo que afirmar»: la cuenta aún no activó sus
// créditos, o todavía no se sabe. Un 0 solo se pinta cuando está confirmado.
// Un saldo positivo nunca se oculta.
export function saldoIAVisible({
  uid,
  cuentaEliminada = false,
  creditosListos = false,
  regaloListo = false,
  regaloSinPermiso = false,
  registro,
  creditos,
  tieneComprasAcreditadas = false,
} = {}) {
  if (!uid || cuentaEliminada) return null
  // Sin la lectura de iaCreditos no hay nada confirmado.
  if (!creditosListos) return null
  const saldo = typeof creditos?.saldo === 'number' ? creditos.saldo : 0
  if (saldo > 0) return saldo
  // Sin la lectura del registro de regalo (y sin haber sido negada) todavía no
  // se puede saber si el cero es un cero real o una cuenta sin activar.
  if (!regaloListo && !regaloSinPermiso) return null
  if (!regaloSinPermiso && registro) {
    if (estadoRegaloIA({ registro, creditos, tieneComprasAcreditadas }).estado === 'sin_activar') return null
  }
  return saldo
}

// Comparador numérico con valores desconocidos (`null`) siempre al final,
// sea cual sea el sentido. `dir`: 'asc' (0, 1, 2…) o 'desc'.
export function compararNumerico(a, b, dir) {
  const aNulo = a === null || a === undefined
  const bNulo = b === null || b === undefined
  if (aNulo || bNulo) return aNulo === bNulo ? 0 : aNulo ? 1 : -1
  return dir === 'desc' ? b - a : a - b
}

// Ciclo del clic en un encabezado: sin orden → ascendente → descendente → sin
// orden (vuelve al predeterminado). Pulsar otra columna empieza de nuevo.
export function siguienteOrden(actual, key) {
  if (!actual || actual.key !== key) return { key, dir: 'asc' }
  if (actual.dir === 'asc') return { key, dir: 'desc' }
  return null
}
