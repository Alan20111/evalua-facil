// Fase 5 de PLAN_NORMALIZACION_UI: dividir monolitos SIN cambio visual.
//
//   node dividir.mjs mover   <archivo.jsx> <dir>
//     Saca las declaraciones de nivel superior (todo menos el export default)
//     a <dir>/piezas.jsx (componentes) y <dir>/utilidades.js (lo demás), con
//     sus imports recalculados. Los export con nombre se re-exportan.
//
//   node dividir.mjs extraer <archivo.jsx> <dir> <Contexto> Nombre:ini-fin [...]
//     Cada rango (líneas de un bloque {…} del render, o de varios hermanos
//     seguidos) pasa a <dir>/Nombre.jsx. Lo que el bloque usa del componente
//     principal le llega por un contexto (<dir>/contexto.js); lo que usa del
//     módulo, por imports. El componente principal envuelve su render en el
//     Provider y deja <Nombre /> en el lugar del bloque.
import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default || _traverse

const [cmd, archivo, dir, ...resto] = process.argv.slice(2)
const src = fs.readFileSync(archivo, 'utf8')
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
const origDir = path.dirname(archivo)
fs.mkdirSync(dir, { recursive: true })

// ── utilidades comunes ──────────────────────────────────────────────────
function rutaDesde(nuevoDir, fuente) {
  if (!fuente.startsWith('.')) return fuente
  let r = path.relative(nuevoDir, path.resolve(origDir, fuente))
  if (!r.startsWith('.')) r = './' + r
  return r
}
// imports del archivo: nombre local → { fuente, texto del especificador }
const imports = new Map()
for (const n of ast.program.body) {
  if (n.type !== 'ImportDeclaration') continue
  for (const s of n.specifiers) {
    let espec
    if (s.type === 'ImportDefaultSpecifier') espec = { def: s.local.name }
    else if (s.type === 'ImportNamespaceSpecifier') espec = { ns: s.local.name }
    else espec = { nom: s.imported.name === s.local.name ? s.local.name : `${s.imported.name} as ${s.local.name}` }
    imports.set(s.local.name, { fuente: n.source.value, ...espec })
  }
}
function textoImports(nombres, nuevoDir, extra = new Map()) {
  const porFuente = new Map()
  for (const nombre of [...nombres].sort()) {
    const imp = imports.get(nombre) || extra.get(nombre)
    if (!imp) continue
    const f = imp.fijo ? imp.fuente : rutaDesde(nuevoDir, imp.fuente)
    if (!porFuente.has(f)) porFuente.set(f, { def: null, ns: null, nom: [] })
    const g = porFuente.get(f)
    if (imp.def) g.def = imp.def
    else if (imp.ns) g.ns = imp.ns
    else g.nom.push(imp.nom)
  }
  const lineas = []
  for (const [f, g] of porFuente) {
    if (g.ns) lineas.push(`import * as ${g.ns} from '${f}'`)
    const partes = []
    if (g.def) partes.push(g.def)
    if (g.nom.length) partes.push(`{ ${g.nom.join(', ')} }`)
    if (partes.length) lineas.push(`import ${partes.join(', ')} from '${f}'`)
  }
  return lineas.join('\n')
}
function referenciasPrograma(nodoPath, excluir = new Set()) {
  // nombres ligados al ámbito del programa que usa el nodo
  const usados = new Set()
  const programa = nodoPath.scope.getProgramParent()
  nodoPath.traverse({
    Identifier(q) {
      if (!q.isReferencedIdentifier()) return
      const b = q.scope.getBinding(q.node.name)
      if (b && b.scope === programa && !excluir.has(q.node.name)) usados.add(q.node.name)
    },
    JSXIdentifier(q) {
      if (!/^[A-Z]/.test(q.node.name) || q.parentPath.isJSXAttribute()) return
      if (q.parentPath.isJSXMemberExpression() && q.parentPath.node.property === q.node) return
      const b = q.scope.getBinding(q.node.name)
      if (b && b.scope === programa && !excluir.has(q.node.name)) usados.add(q.node.name)
    },
  })
  return usados
}

// ── mover ───────────────────────────────────────────────────────────────
if (cmd === 'mover') {
  const progPaths = []
  traverse(ast, { Program(p) { for (const b of p.get('body')) progPaths.push(b) } })
  const tops = []
  for (const b of progPaths) {
    const n = b.node
    if (n.type === 'ImportDeclaration' || n.type === 'ExportDefaultDeclaration') continue
    let decl = n, exportado = false
    if (n.type === 'ExportNamedDeclaration' && n.declaration) { decl = n.declaration; exportado = true }
    let nombres = []
    if (decl.type === 'FunctionDeclaration' && decl.id) nombres = [decl.id.name]
    else if (decl.type === 'VariableDeclaration') nombres = decl.declarations.map((d) => d.id.name).filter(Boolean)
    else continue
    const texto = src.slice(decl.start, decl.end)
    const esComp = /^[A-Z]/.test(nombres[0]) && /return\s*\(?\s*</.test(texto)
    // comentarios pegados arriba
    const comentarios = (n.leadingComments || []).map((c) => src.slice(c.start, c.end)).join('\n')
    tops.push({ b, n, decl, nombres, exportado, esComp, texto, comentarios })
  }
  const nombresTop = new Set(tops.flatMap((t) => t.nombres))
  const destino = new Map()
  for (const t of tops) for (const nm of t.nombres) destino.set(nm, t.esComp ? 'piezas' : 'utilidades')
  // utilidades no puede depender de piezas (evita ciclos y mezcla de exports)
  for (const t of tops) {
    if (t.esComp) continue
    const usa = referenciasPrograma(t.b)
    for (const u of usa) if (destino.get(u) === 'piezas') { for (const nm of t.nombres) destino.set(nm, 'piezas') }
  }
  const archivos = { piezas: [], utilidades: [] }
  for (const t of tops) archivos[destino.get(t.nombres[0])].push(t)
  const extra = new Map()
  for (const [nm, d] of destino) extra.set(nm, { fuente: d === 'piezas' ? './piezas' : './utilidades', fijo: true, nom: nm })
  for (const [clave, lista] of Object.entries(archivos)) {
    if (!lista.length) continue
    const usados = new Set()
    for (const t of lista) for (const u of referenciasPrograma(t.b)) if (!lista.some((x) => x.nombres.includes(u))) usados.add(u)
    const cabecera = clave === 'piezas'
      ? `// Piezas de ${path.basename(archivo)} que viven fuera del componente principal.\n// Salieron tal cual en la fase 5 de PLAN_NORMALIZACION_UI (sin cambio visual).\n`
      : `// Constantes y funciones de ${path.basename(archivo)} (fase 5 de PLAN_NORMALIZACION_UI).\n`
    const cuerpo = lista.map((t) => (t.comentarios ? t.comentarios + '\n' : '') + 'export ' + t.texto).join('\n\n')
    const ext = clave === 'piezas' ? '.jsx' : '.js'
    fs.writeFileSync(path.join(dir, clave + ext), cabecera + textoImports(usados, dir, extra) + '\n\n' + cuerpo + '\n')
  }
  // archivo original: quitar las declaraciones, importar lo que siga usando
  let out = src
  const cortes = tops.map((t) => [t.n.leadingComments?.[0]?.start ?? t.n.start, t.n.end]).sort((a, b) => b[0] - a[0])
  for (const [a, z] of cortes) out = out.slice(0, a) + out.slice(z).replace(/^\n+/, '\n')
  const ast2 = parse(out, { sourceType: 'module', plugins: ['jsx'] })
  const libres = new Set()
  traverse(ast2, {
    Identifier(q) { if (q.isReferencedIdentifier() && !q.scope.hasBinding(q.node.name) && nombresTop.has(q.node.name)) libres.add(q.node.name) },
    JSXIdentifier(q) { if (nombresTop.has(q.node.name) && !q.scope.hasBinding(q.node.name)) libres.add(q.node.name) },
  })
  const reexport = tops.filter((t) => t.exportado).flatMap((t) => t.nombres)
  const relDir = './' + path.relative(origDir, dir)
  const porMod = { piezas: [], utilidades: [] }
  for (const nm of libres) porMod[destino.get(nm)].push(nm)
  let nuevas = ''
  for (const [m, l] of Object.entries(porMod)) if (l.length) nuevas += `import { ${l.sort().join(', ')} } from '${relDir}/${m}'\n`
  const reexPorMod = { piezas: [], utilidades: [] }
  for (const nm of reexport) reexPorMod[destino.get(nm)].push(nm)
  for (const [m, l] of Object.entries(reexPorMod)) if (l.length) nuevas += `export { ${l.join(', ')} } from '${relDir}/${m}'\n`
  const ultImport = [...out.matchAll(/^import\b[\s\S]*?from\s*'[^']+'\s*$/gm)].pop()
  const pos = ultImport ? ultImport.index + ultImport[0].length + 1 : 0
  out = out.slice(0, pos) + nuevas + out.slice(pos)
  fs.writeFileSync(archivo, out)
  console.log(`movidas ${tops.length} declaraciones → piezas: ${archivos.piezas.length}, utilidades: ${archivos.utilidades.length}`)
}

// ── extraer ─────────────────────────────────────────────────────────────
if (cmd === 'extraer') {
  const [ctxNombre, ...objetivos] = resto
  let principal = null
  traverse(ast, { ExportDefaultDeclaration(p) { principal = p.get('declaration') } })
  const fnScope = principal.scope
  const programa = principal.scope.getProgramParent()
  const usoCtx = new Set()
  const reemplazos = []
  for (const obj of objetivos) {
    const [nombre, rango] = obj.split(':')
    const [ini, fin] = rango.split('-').map(Number)
    // nodos hijos JSX (contenedores/elementos) que caen exactamente en el rango
    const nodos = []
    principal.traverse({
      'JSXExpressionContainer|JSXElement|JSXFragment'(p) {
        const a = p.node.loc.start.line, z = p.node.loc.end.line
        if (a >= ini && z <= fin && p.parentPath && (p.parentPath.isJSXElement() || p.parentPath.isJSXFragment())) {
          if (!nodos.some((x) => x.node.start <= p.node.start && x.node.end >= p.node.end)) nodos.push(p)
          p.skip()
        }
      },
    })
    if (!nodos.length) { console.error('sin nodos para', obj); process.exit(1) }
    nodos.sort((a, b) => a.node.start - b.node.start)
    // Todos los bloques deben ser HERMANOS (mismo padre): si el rango cruza el
    // cierre de un contenedor, el corte rompería el JSX.
    const padres = new Set(nodos.map((p) => p.parentPath.node))
    if (padres.size > 1) {
      const cortes = nodos.filter((p, i) => i && p.parentPath.node !== nodos[i - 1].parentPath.node).map((p) => p.node.loc.start.line)
      console.error(`${nombre}: el rango cruza contenedores; divídelo en las líneas ${cortes.join(', ')}`); process.exit(1)
    }
    const start = nodos[0].node.start, end = nodos[nodos.length - 1].node.end
    const libresCtx = new Set(), modulo = new Set(), problemas = new Set()
    for (const p of nodos) {
      p.traverse({
        Identifier(q) {
          if (!q.isReferencedIdentifier()) return
          const b = q.scope.getBinding(q.node.name)
          if (!b) return
          if (b.scope === fnScope) libresCtx.add(q.node.name)
          else if (b.scope === programa) modulo.add(q.node.name)
          else if (!(b.path.node.start >= start && b.path.node.end <= end)) problemas.add(q.node.name)
        },
        JSXIdentifier(q) {
          if (!/^[A-Z]/.test(q.node.name) || q.parentPath.isJSXAttribute()) return
          if (q.parentPath.isJSXMemberExpression() && q.parentPath.node.property === q.node) return
          const b = q.scope.getBinding(q.node.name)
          if (!b) return
          if (b.scope === fnScope) libresCtx.add(q.node.name)
          else if (b.scope === programa) modulo.add(q.node.name)
        },
      })
    }
    if (problemas.size) { console.error(`${nombre}: usa variables de ámbitos intermedios: ${[...problemas].join(', ')}`); process.exit(1) }
    for (const v of libresCtx) usoCtx.add(v)
    const extra = new Map()
    // lo que sea de nivel superior del propio archivo (no import) se importa desde él… no debe pasar tras «mover»
    const sinImport = [...modulo].filter((m) => !imports.has(m))
    if (sinImport.length) { console.error(`${nombre}: usa declaraciones de nivel superior sin mover: ${sinImport.join(', ')}`); process.exit(1) }
    const cuerpo = src.slice(start, end)
    const ctxImport = `import { use${ctxNombre} } from './contexto'`
    const desestructura = [...libresCtx].sort()
    const archivoNuevo = `// Parte del render de ${path.basename(archivo)} (fase 5 de PLAN_NORMALIZACION_UI:
// dividir sin cambio visual). Recibe lo que usa del componente principal por
// el contexto ${ctxNombre}.
${textoImports(modulo, dir, extra)}
${ctxImport}

export default function ${nombre}() {
  const {
${desestructura.map((d) => '    ' + d + ',').join('\n')}
  } = use${ctxNombre}()
  return (
    <>
      ${cuerpo}
    </>
  )
}
`
    fs.writeFileSync(path.join(dir, nombre + '.jsx'), archivoNuevo)
    reemplazos.push({ start, end, texto: `<${nombre} />`, nombre })
    console.log(`${nombre}: ${cuerpo.split('\n').length} líneas, ${libresCtx.size} valores del contexto`)
  }
  // contexto
  fs.writeFileSync(path.join(dir, 'contexto.js'), `// Contexto del componente principal de ${path.basename(archivo)}: lo que las
// partes extraídas (fase 5 de PLAN_NORMALIZACION_UI) leen de él.
import { createContext, useContext } from 'react'

export const Contexto${ctxNombre} = createContext(null)
export const use${ctxNombre} = () => useContext(Contexto${ctxNombre})
`)
  // Provider alrededor del return que contiene los bloques
  let retorno = null
  principal.traverse({
    ReturnStatement(p) {
      if (p.getFunctionParent() !== principal) return
      const a = p.node.argument
      if (a && a.start <= reemplazos[0].start && a.end >= reemplazos[reemplazos.length - 1].end) retorno = p
    },
  })
  if (!retorno) { console.error('no encontré el return principal'); process.exit(1) }
  const arg = retorno.node.argument
  let out = src
  const cambios = [...reemplazos]
  const valor = [...usoCtx].sort().join(', ')
  cambios.push({ start: arg.end, end: arg.end, texto: `\n    </Contexto${ctxNombre}.Provider>` })
  cambios.push({ start: arg.start, end: arg.start, texto: `<Contexto${ctxNombre}.Provider value={{ ${valor} }}>\n    ` })
  cambios.sort((a, b) => b.start - a.start || b.end - a.end)
  for (const c of cambios) out = out.slice(0, c.start) + c.texto + out.slice(c.end)
  const relDir = './' + path.relative(origDir, dir)
  const nuevas = reemplazos.map((r) => `import ${r.nombre} from '${relDir}/${r.nombre}'`).join('\n') + `\nimport { Contexto${ctxNombre} } from '${relDir}/contexto'\n`
  const ultImport = [...out.matchAll(/^import\b[\s\S]*?from\s*'[^']+'\s*$/gm)].pop()
  const pos = ultImport.index + ultImport[0].length + 1
  out = out.slice(0, pos) + nuevas + out.slice(pos)
  fs.writeFileSync(archivo, out)
}
