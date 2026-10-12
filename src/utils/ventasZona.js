// Ventas por zona del administrador: agrupa docentes y compras de créditos por
// estado y municipio. Funciones puras (sin Firebase ni red).
//
//   node test/ventas-zona.test.mjs
//
// Las compras salen de `comprasContables` (resumenAdmin.js), que aplica el MISMO
// criterio de validez que el resumen general. Por eso, para un mismo periodo:
//
//   ingresos atribuidos a zonas + ingresos no atribuibles = total del resumen
//
// y esa igualdad se prueba. Lo que no se puede ubicar NO se reparte ni se
// descarta: se informa aparte, con su motivo.

import { comprasContables, resumenCompras } from './resumenAdmin.js'
import { claveDia } from './costosIA.js'

// Motivos por los que una venta válida no se puede atribuir a una zona.
export const MOTIVO_ZONA = Object.freeze({
  DOCENTE_INEXISTENTE: 'docente_inexistente',
  ESTADO_FALTANTE: 'estado_faltante',
})

const textoLimpio = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/**
 * Clave de comparación de un nombre de estado o municipio: sin acentos, sin
 * mayúsculas y con los espacios normalizados. «MÉXICO», «México» y « mexico »
 * son la misma zona. Solo sirve para AGRUPAR; nunca se muestra.
 */
export function claveZona(texto) {
  return textoLimpio(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const esTodoMayusculas = (t) => t === t.toLocaleUpperCase('es-MX') && t !== t.toLocaleLowerCase('es-MX')

/**
 * Nombre que se muestra para un grupo de variantes: la más usada; si empatan,
 * la que no está TODA en mayúsculas; y si aún empatan, la primera por orden
 * alfabético. Es una de las variantes que existen: no se inventa un nombre.
 */
export function nombreCanonico(variantes) {
  const cuenta = new Map()
  variantes.forEach((v) => {
    const t = textoLimpio(v)
    if (t) cuenta.set(t, (cuenta.get(t) || 0) + 1)
  })
  const orden = [...cuenta.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    const ma = esTodoMayusculas(a[0])
    const mb = esTodoMayusculas(b[0])
    if (ma !== mb) return ma ? 1 : -1
    return a[0].localeCompare(b[0], 'es-MX')
  })
  return orden.length ? orden[0][0] : ''
}

const aPesos = (centavos) => centavos / 100

/** Mes 'AAAA-MM' (hora de México) de una fecha, o null. */
function mesMX(fecha) {
  if (!(fecha instanceof Date)) return null
  const dia = claveDia(fecha)
  return dia ? dia.slice(0, 7) : null
}

export const esMesValido = (mes) => typeof mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)

/**
 * Meses (más reciente primero) en los que hay ventas contables con fecha
 * válida, más el mes de `ahora` para que siempre exista una opción vigente.
 */
export function mesesConVentas(compras, ahora) {
  const meses = new Set()
  comprasContables(compras).forEach((c) => { const m = mesMX(c.fecha); if (m) meses.add(m) })
  const actual = ahora instanceof Date || typeof ahora === 'number' ? mesMX(new Date(ahora)) : null
  if (actual) meses.add(actual)
  return [...meses].sort().reverse()
}

/**
 * @param {object} p
 * @param {Array<object>} p.docentes  usuarios docentes (con `id`, `estado`, `municipio`)
 * @param {Array<object>} p.compras   documentos de `creditPurchases` (con `id`)
 * @param {string|null} [p.mes]       'AAAA-MM' (hora de México) o null = «Todo el tiempo»
 */
export function ventasPorZona({ docentes, compras, mes = null }) {
  if (mes !== null && !esMesValido(mes)) throw new Error(`mes inválido: ${String(mes)}`)
  const lista = (Array.isArray(docentes) ? docentes : []).filter((d) => d && typeof d.id === 'string' && d.id)
  const porId = new Map(lista.map((d) => [d.id, d]))

  // ── Nombres canónicos (de todos los docentes, no solo de los compradores) ──
  const variantesEstado = new Map() // claveEstado -> [texto]
  const variantesMuni = new Map() // `${claveEstado}|${claveMuni}` -> [texto]
  lista.forEach((d) => {
    const e = claveZona(d.estado)
    if (!e) return
    ;(variantesEstado.get(e) || variantesEstado.set(e, []).get(e)).push(d.estado)
    const m = claveZona(d.municipio)
    if (m) (variantesMuni.get(`${e}|${m}`) || variantesMuni.set(`${e}|${m}`, []).get(`${e}|${m}`)).push(d.municipio)
  })

  const estados = new Map() // claveEstado -> acumulador
  const acumEstado = (claveE) => {
    let z = estados.get(claveE)
    if (!z) {
      z = {
        clave: claveE, estado: nombreCanonico(variantesEstado.get(claveE) || []),
        docentes: 0, compradoresSet: new Set(), compras: 0, centavos: 0, creditos: 0, municipios: new Map(),
      }
      estados.set(claveE, z)
    }
    return z
  }
  const acumMuni = (z, claveM, claveE) => {
    let m = z.municipios.get(claveM)
    if (!m) {
      m = { clave: claveM, municipio: nombreCanonico(variantesMuni.get(`${claveE}|${claveM}`) || []), docentes: 0, compradoresSet: new Set(), compras: 0, centavos: 0, creditos: 0 }
      z.municipios.set(claveM, m)
    }
    return m
  }

  // ── Docentes registrados: cada uno cuenta una vez (no depende del periodo) ──
  let docentesSinEstado = 0
  let docentesSinMunicipio = 0
  lista.forEach((d) => {
    const e = claveZona(d.estado)
    if (!e) { docentesSinEstado++; return }
    const z = acumEstado(e)
    z.docentes++
    const m = claveZona(d.municipio)
    if (!m) { docentesSinMunicipio++; return }
    acumMuni(z, m, e).docentes++
  })

  // ── Compras contables del periodo ──
  const contables = comprasContables(compras)
  const enPeriodo = []
  let sinFecha = { compras: 0, centavos: 0, creditos: 0 }
  contables.forEach((c) => {
    if (mes === null) { enPeriodo.push(c); return }
    if (c.fecha === null) {
      // Sin fecha válida: no se le asigna un mes. Cuenta en «Todo el tiempo».
      sinFecha = { compras: sinFecha.compras + 1, centavos: sinFecha.centavos + c.centavos, creditos: sinFecha.creditos + c.creditos }
      return
    }
    if (mesMX(c.fecha) === mes) enPeriodo.push(c)
  })

  const noAtribuible = {
    [MOTIVO_ZONA.DOCENTE_INEXISTENTE]: { compras: 0, centavos: 0, creditos: 0 },
    [MOTIVO_ZONA.ESTADO_FALTANTE]: { compras: 0, centavos: 0, creditos: 0 },
  }
  const sinMunicipio = { compras: 0, centavos: 0, creditos: 0 } // atribuidas al estado, sin municipio
  let totalCentavos = 0
  let totalCreditos = 0
  let atribCentavos = 0
  let atribCompras = 0
  const compradoresAtribuidos = new Set()

  enPeriodo.forEach((c) => {
    totalCentavos += c.centavos
    totalCreditos += c.creditos
    const d = porId.get(c.docenteId)
    const motivo = !d ? MOTIVO_ZONA.DOCENTE_INEXISTENTE : !claveZona(d.estado) ? MOTIVO_ZONA.ESTADO_FALTANTE : null
    if (motivo) {
      const n = noAtribuible[motivo]
      n.compras++
      n.centavos += c.centavos
      n.creditos += c.creditos
      return
    }
    const e = claveZona(d.estado)
    const z = acumEstado(e)
    z.compras++
    z.centavos += c.centavos
    z.creditos += c.creditos
    z.compradoresSet.add(d.id)
    atribCentavos += c.centavos
    atribCompras++
    compradoresAtribuidos.add(d.id)
    const m = claveZona(d.municipio)
    if (!m) {
      sinMunicipio.compras++
      sinMunicipio.centavos += c.centavos
      sinMunicipio.creditos += c.creditos
      return
    }
    const mu = acumMuni(z, m, e)
    mu.compras++
    mu.centavos += c.centavos
    mu.creditos += c.creditos
    mu.compradoresSet.add(d.id)
  })

  const cerrar = (x) => ({ compras: x.compras, ingresosMXN: aPesos(x.centavos), creditos: x.creditos })
  const porEstado = [...estados.values()].map((z) => ({
    clave: z.clave,
    estado: z.estado,
    docentes: z.docentes,
    compradores: z.compradoresSet.size,
    compras: z.compras,
    ingresosMXN: aPesos(z.centavos),
    creditos: z.creditos,
    municipios: [...z.municipios.values()].map((m) => ({
      clave: m.clave, municipio: m.municipio, docentes: m.docentes, compradores: m.compradoresSet.size,
      compras: m.compras, ingresosMXN: aPesos(m.centavos), creditos: m.creditos,
    })),
  }))

  const noAtribuibleCentavos = Object.values(noAtribuible).reduce((a, x) => a + x.centavos, 0)
  const noAtribuibleCompras = Object.values(noAtribuible).reduce((a, x) => a + x.compras, 0)
  const resumen = resumenCompras(compras)

  return {
    mes,
    docentes: { total: lista.length, sinEstado: docentesSinEstado, conEstadoSinMunicipio: docentesSinMunicipio },
    // Todas las ventas contables del periodo, ubicadas o no.
    total: { compras: enPeriodo.length, ingresosMXN: aPesos(totalCentavos), creditos: totalCreditos },
    atribuido: { compras: atribCompras, ingresosMXN: aPesos(atribCentavos), compradores: compradoresAtribuidos.size },
    noAtribuible: {
      compras: noAtribuibleCompras,
      ingresosMXN: aPesos(noAtribuibleCentavos),
      porMotivo: {
        [MOTIVO_ZONA.DOCENTE_INEXISTENTE]: cerrar(noAtribuible[MOTIVO_ZONA.DOCENTE_INEXISTENTE]),
        [MOTIVO_ZONA.ESTADO_FALTANTE]: cerrar(noAtribuible[MOTIVO_ZONA.ESTADO_FALTANTE]),
      },
    },
    // Atribuidas a su estado, pero sin municipio: ya están en `atribuido`.
    sinMunicipio: cerrar(sinMunicipio),
    // Solo en vista mensual: ventas válidas sin fecha. NO están en `total`.
    sinFechaValida: cerrar(sinFecha),
    porEstado,
    posiblesDuplicados: resumen.posiblesDuplicados.filter((g) => g.requiereRevision).length,
    inconsistencias: resumen.inconsistencias.length,
  }
}

/**
 * Índice de coordenadas por clave normalizada: «MÉXICO|LERMA» encuentra
 * «México|Lerma» si el catálogo lo trae. Devuelve la clave ORIGINAL del catálogo
 * (con la que el mapa busca la mancha urbana) y sus coordenadas.
 */
export function indiceCoordenadas(coords) {
  const idx = new Map()
  Object.entries(coords || {}).forEach(([clave, c]) => {
    const [e, m] = clave.split('|')
    idx.set(`${claveZona(e)}|${claveZona(m)}`, { clave, ...c })
  })
  return idx
}
