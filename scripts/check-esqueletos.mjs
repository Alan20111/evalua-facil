#!/usr/bin/env node
// Candado: los esqueletos de carga NO pueden desfasarse de su pantalla real.
//
// Contrato: los elementos clave de una pantalla real y su esqueleto
// (src/components/esqueletos/) se marcan con el MISMO `data-esq="id"`. Este
// script compara las MEDIDAS de cada pareja —padding, márgenes, separaciones,
// anchos/altos, esquinas, bordes y tamaño de letra— y falla si no coinciden.
// Los colores y la lógica no cuentan: solo la geometría.
//
// Regla de comparación (por cada marca del esqueleto):
//   medidas fijas de la pantalla real  ⊆  medidas del esqueleto  ⊆  todas las
//   que la pantalla real puede tener (las que viven dentro de condicionales).
// Un ancho propio del esqueleto (w-56, max-w-[60%]) se permite: es el largo de
// la barra, no una medida de la pantalla.
//
// Además falla si:
//   · una marca existe solo de un lado (pantalla renombrada o borrada);
//   · un `export function Esqueleto…` no tiene ninguna marca (sin contrato).
//
// Uso: node scripts/check-esqueletos.mjs   (lo llama `npm run check:design`)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const DIR_ESQ = path.join(RAIZ, 'components', 'esqueletos') + path.sep

function archivos(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) archivos(p, salida)
    else if (p.endsWith('.jsx')) salida.push(p)
  }
  return salida
}

// Índice del '>' que cierra la etiqueta que abre en `i` (respeta {} y comillas).
function finEtiqueta(s, i) {
  let d = 0, q = null
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]
    if (q) {
      if (c === '\\') { j++; continue }
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { if (d > 0 || c === '"') q = c; continue }
    if (c === '{') d++
    else if (c === '}') d--
    else if (c === '>' && d === 0) return j
  }
  return -1
}

// Valor de un atributo (texto crudo) o null.
function atributo(tag, nombre) {
  const m = new RegExp(`\\s${nombre}=`).exec(tag)
  if (!m) return null
  const k = m.index + m[0].length
  if (tag[k] === '"') return tag.slice(k + 1, tag.indexOf('"', k + 1))
  if (tag[k] === '{') {
    let d = 0, q = null, j = k
    for (; j < tag.length; j++) {
      const c = tag[j]
      if (q) { if (c === '\\') { j++; continue } if (c === q) q = null; continue }
      if (c === '"' || c === "'" || c === '`') q = c
      else if (c === '{') d++
      else if (c === '}') { d--; if (d === 0) break }
    }
    return tag.slice(k, j + 1)
  }
  return null
}

// Separa un valor de atributo en { fijas, todas }: tokens fijos y tokens
// posibles (incluye los que viven dentro de ${…}, ternarios y cn()).
// Una constante compartida (`${SB_FILA}`, `className={SB_FILA}`) cuenta como
// el token «{SB_FILA}»: si pantalla y esqueleto usan la MISMA constante, no
// pueden desfasarse — es la forma preferida de mantenerlos juntos.
function tokens(valor) {
  const fijas = new Set(), todas = new Set()
  if (valor == null) return { fijas, todas }
  const agrega = (txt, fijo) => {
    for (const t of txt.split(/\s+/).filter(Boolean)) { todas.add(t); if (fijo) fijas.add(t) }
  }
  const cadenas = (txt) => { for (const m of txt.matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)) agrega(m[2], false) }
  if (!valor.startsWith('{')) { agrega(valor, true); return { fijas, todas } }
  const id = /^\{\s*([A-Za-z_][\w.]*)\s*\}$/.exec(valor)
  if (id) { fijas.add(`{${id[1]}}`); todas.add(`{${id[1]}}`); return { fijas, todas } }
  // plantilla con ${…}: la primera `…` del valor (sola o dentro de una flecha)
  const ini = valor.indexOf('`')
  if (ini === -1) { cadenas(valor); return { fijas, todas } }
  let i = ini + 1, estatico = ''
  while (i < valor.length && valor[i] !== '`') {
    if (valor[i] === '$' && valor[i + 1] === '{') {
      let d = 1, j = i + 2
      while (j < valor.length && d > 0) { if (valor[j] === '{') d++; else if (valor[j] === '}') d--; j++ }
      const expr = valor.slice(i + 2, j - 1).trim()
      if (/^[A-Za-z_][\w.]*$/.test(expr)) { fijas.add(`{${expr}}`); todas.add(`{${expr}}`) }
      else cadenas(expr)
      estatico += ' '
      i = j
    } else { estatico += valor[i]; i++ }
  }
  agrega(estatico, true)
  cadenas(valor.slice(i + 1))
  return { fijas, todas }
}

// ¿Es una MEDIDA (afecta tamaño, espacio o forma)? Colores y lógica no cuentan.
const MEDIDA = /^(?:[a-z0-9]+:)*(?:-?(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy]|w|h|size)-[^\s]+|rounded(?:-[a-z]+)*(?:-[^\s]+)?|border(?:-[xytblr])?(?:-[0-9]+)?|text-(?:xs|sm|base|lg|[2-9]?xl|\[[^\]]+\]|body-sm|metadata)|leading-[^\s]+|\{[A-Za-z_][\w.]*\})$/
const esMedida = (t) => MEDIDA.test(t) && !/^(?:[a-z0-9]+:)*(?:hover|focus|group-hover|disabled|active)/.test(t) && !/^(?:[a-z0-9]+:)*(?:border-(?:accent|outline|white|red|emerald|amber|transparent|dashed|solid)|rounded-none)/.test(t)
const esAnchoPropio = (t) => /^(?:[a-z0-9]+:)*(?:max-|min-)?w-/.test(t)

// 300px y 20.833rem son la misma medida (raíz de 14.4px): se comparan en rem.
const aRem = (t) => t.replace(/^h-screen$/, 'h-dvh').replace(/\[(-?[\d.]+)px\]/g, (_, n) => `[${+(n / 14.4).toFixed(3)}rem]`)
  .replace(/\[(-?[\d.]+)rem\]/g, (_, n) => `[${+(+n).toFixed(3)}rem]`)

const marcas = new Map() // id -> { esq: [], real: [] }
const sinMarca = []
for (const f of archivos(RAIZ)) {
  const s = fs.readFileSync(f, 'utf8')
  const esEsq = (f + path.sep).startsWith(DIR_ESQ) || f.startsWith(DIR_ESQ)
  for (const m of s.matchAll(/data-esq="([^"]+)"/g)) {
    const ini = s.lastIndexOf('<', m.index)
    const fin = finEtiqueta(s, ini)
    const tag = s.slice(ini, fin + 1)
    const linea = s.slice(0, ini).split('\n').length
    const A = tokens(atributo(tag, 'className'))
    const B = tokens(atributo(tag, 'texto'))
    const fijas = new Set([...A.fijas, ...B.fijas].filter(esMedida).map(aRem))
    const todas = new Set([...A.todas, ...B.todas].filter(esMedida).map(aRem))
    const lado = esEsq ? 'esq' : 'real'
    if (!marcas.has(m[1])) marcas.set(m[1], { esq: [], real: [] })
    marcas.get(m[1])[lado].push({ f: path.relative(path.dirname(RAIZ), f), linea, fijas, todas })
  }
  if (esEsq) {
    for (const m of s.matchAll(/export function (Esqueleto\w+)\b/g)) {
      const resto = s.slice(m.index)
      const sig = resto.slice(1).search(/\nexport function /)
      const cuerpo = sig === -1 ? resto : resto.slice(0, sig + 1)
      if (!/data-esq="/.test(cuerpo)) sinMarca.push(m[1])
    }
  }
}

let fallas = 0
const falla = (msg) => { fallas++; console.log(`   ✖ ${msg}`) }
console.log('=== Candado de esqueletos — deben medir lo mismo que su pantalla ===')
for (const [id, { esq, real }] of [...marcas].sort()) {
  if (!esq.length) { falla(`«${id}» está en la pantalla (${real[0].f}:${real[0].linea}) pero NO en components/esqueletos/`); continue }
  if (!real.length) { falla(`«${id}» está en el esqueleto (${esq[0].f}:${esq[0].linea}) pero la pantalla ya no lo tiene — ¿la renombraste?`); continue }
  for (const e of esq) {
    const mejor = real.map((r) => {
      const faltan = [...r.fijas].filter((t) => !e.todas.has(t))
      const sobran = [...e.todas].filter((t) => !r.todas.has(t) && !esAnchoPropio(t))
      return { r, faltan, sobran, d: faltan.length + sobran.length }
    }).sort((a, b) => a.d - b.d)[0]
    if (mejor.d > 0) {
      falla(`«${id}» NO coincide\n       pantalla : ${mejor.r.f}:${mejor.r.linea}\n       esqueleto: ${e.f}:${e.linea}` +
        (mejor.faltan.length ? `\n       le faltan al esqueleto: ${mejor.faltan.join(' ')}` : '') +
        (mejor.sobran.length ? `\n       sobran en el esqueleto: ${mejor.sobran.join(' ')}` : ''))
    }
  }
}
for (const n of sinMarca) falla(`${n} no tiene ningún data-esq: sin contrato con su pantalla`)
if (fallas) {
  console.log(`\n❌ ${fallas} desfase(s). Cambia el esqueleto (src/components/esqueletos/) para que mida lo mismo que la pantalla — o viceversa. Ver docs/DESIGN_SYSTEM.md §6.9.`)
  process.exit(1)
}
console.log(`✅ ${marcas.size} marcas de esqueleto coinciden con su pantalla.`)
