// Convierte el Catálogo Nacional de Códigos Postales (CPdescarga.xls de
// Correos de México) en archivos JSON por prefijo de 2 dígitos.
//
// Del catálogo solo se conserva lo que la app necesita: por cada CP, el
// estado, el municipio y la ciudad. Las colonias (que son las que hacen que
// el catálogo pese 72 MB) se descartan.
//
// Se corre a mano cuando Correos publique una versión nueva del catálogo
// (https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx),
// no en cada build — los JSON generados van versionados en public/cp/:
//
//   node --max-old-space-size=10240 scripts/extraer-cp.cjs <ruta-al-xls> public/cp
//
// El --max-old-space-size no es opcional: el XLS son 72 MB de BIFF y con el
// límite de memoria que trae Node por omisión el proceso se muere a media
// lectura.
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2]
const OUT = process.argv[3]

if (!SRC || !OUT) {
  console.error('Uso: node --max-old-space-size=10240 scripts/extraer-cp.cjs <CPdescarga.xls> <carpeta-salida>')
  process.exit(1)
}

console.log('Leyendo XLS…')
const t0 = Date.now()
const wb = XLSX.readFile(SRC, { raw: true })
console.log(`  ${wb.SheetNames.length} hojas en ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// Cada CP corresponde a un solo municipio (verificado sobre el catálogo
// completo: 0 casos de municipios distintos para un mismo CP). Lo único que
// varía entre renglones del mismo CP es que unos traen ciudad y otros no
// —los asentamientos rurales la dejan vacía— así que se toma la primera
// ciudad no vacía que aparezca.
// cp -> { estado, municipio, ciudad }
const porCP = new Map()
let filas = 0

for (const hoja of wb.SheetNames) {
  if (hoja === 'Nota') continue
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { raw: true, defval: '' })
  for (const r of rows) {
    const cp = String(r.d_codigo || '').trim()
    if (!/^\d{5}$/.test(cp)) continue
    const estado = String(r.d_estado || '').trim()
    const municipio = String(r.D_mnpio || r.d_mnpio || '').trim()
    const ciudad = String(r.d_ciudad || '').trim()
    if (!estado) continue
    filas++
    const previo = porCP.get(cp)
    if (!previo) porCP.set(cp, { estado, municipio, ciudad })
    else {
      if (!previo.ciudad && ciudad) previo.ciudad = ciudad
      if (previo.municipio !== municipio) {
        console.warn(`  ¡CP con dos municipios! ${cp}: ${previo.municipio} / ${municipio}`)
      }
    }
  }
  delete wb.Sheets[hoja] // libera memoria conforme avanza
}

console.log(`  ${filas.toLocaleString('es-MX')} filas → ${porCP.size.toLocaleString('es-MX')} CP únicos`)

const sinCiudad = [...porCP.values()].filter((o) => !o.ciudad).length
console.log(`  CP sin ciudad (manda el municipio): ${sinCiudad}`)

// ¿Cada prefijo de 2 dígitos pertenece a un solo estado?
const estadosPorPrefijo = new Map()
for (const [cp, o] of porCP) {
  const p = cp.slice(0, 2)
  if (!estadosPorPrefijo.has(p)) estadosPorPrefijo.set(p, new Set())
  estadosPorPrefijo.get(p).add(o.estado)
}
const prefijosMixtos = [...estadosPorPrefijo.entries()].filter(([, s]) => s.size > 1)
console.log(`  prefijos que cruzan estados: ${prefijosMixtos.length}`,
  prefijosMixtos.map(([p, s]) => `${p}=${[...s].join('+')}`).join(' '))

// ── Generación de archivos por prefijo ────────────────────────────────────
// Formato por archivo (diccionario para no repetir cadenas):
//   { e: estado, m: [municipios], c: [ciudades], cp: { "20000": [mIdx, cIdx] } }
// cIdx = -1 cuando el catálogo no trae ciudad (zona rural: manda el municipio).
fs.mkdirSync(OUT, { recursive: true })
const porPrefijo = new Map()
for (const [cp, o] of porCP) {
  const p = cp.slice(0, 2)
  if (!porPrefijo.has(p)) porPrefijo.set(p, new Map())
  porPrefijo.get(p).set(cp, o)
}

const indice = {} // prefijo -> estado (para saber el estado sin descargar nada)
let total = 0
for (const [prefijo, mapa] of [...porPrefijo.entries()].sort()) {
  const municipios = []
  const ciudades = []
  const idx = (arr, val) => {
    if (!val) return -1
    let i = arr.indexOf(val)
    if (i === -1) { arr.push(val); i = arr.length - 1 }
    return i
  }
  const cp = {}
  const estados = new Set()
  for (const [codigo, o] of [...mapa.entries()].sort()) {
    cp[codigo] = [idx(municipios, o.municipio), idx(ciudades, o.ciudad)]
    estados.add(o.estado)
  }
  const estado = [...estados].sort().join(' / ')
  indice[prefijo] = estado
  const json = JSON.stringify({ e: estado, m: municipios, c: ciudades, cp })
  fs.writeFileSync(path.join(OUT, `${prefijo}.json`), json)
  total += json.length
  console.log(`  ${prefijo}.json  ${(json.length / 1024).toFixed(1)} KB  ${Object.keys(cp).length} CP  ${indice[prefijo]}`)
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(indice))
console.log(`\nTotal: ${(total / 1024 / 1024).toFixed(2)} MB en ${porPrefijo.size} archivos`)
console.log(`Promedio por archivo: ${(total / porPrefijo.size / 1024).toFixed(1)} KB`)
