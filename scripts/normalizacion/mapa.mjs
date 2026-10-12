// Mapa de las declaraciones de nivel superior de un archivo JSX: nombre,
// tipo (componente / función / constante), líneas y de qué otros nombres
// del mismo archivo depende. Lo usa la fase 5 (dividir monolitos).
import fs from 'node:fs'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default || _traverse

const archivo = process.argv[2]
const src = fs.readFileSync(archivo, 'utf8')
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
const top = []
for (const n of ast.program.body) {
  let decl = n, exportado = null
  if (n.type === 'ExportNamedDeclaration' && n.declaration) { decl = n.declaration; exportado = 'named' }
  if (n.type === 'ExportDefaultDeclaration') { decl = n.declaration; exportado = 'default' }
  let nombres = []
  if (decl.type === 'FunctionDeclaration' && decl.id) nombres = [decl.id.name]
  else if (decl.type === 'VariableDeclaration') nombres = decl.declarations.map((d) => d.id.name).filter(Boolean)
  else if (decl.type === 'ClassDeclaration' && decl.id) nombres = [decl.id.name]
  if (!nombres.length) continue
  top.push({ nombres, ini: n.loc.start.line, fin: n.loc.end.line, start: n.start, end: n.end, exportado })
}
const todos = new Set(top.flatMap((t) => t.nombres))
for (const t of top) {
  const usa = new Set()
  const nodo = ast.program.body.find((n) => n.start === t.start)
  traverse(ast, {
    Identifier(p) {
      if (p.node.start < t.start || p.node.end > t.end) return
      if (todos.has(p.node.name) && !t.nombres.includes(p.node.name) && p.isReferencedIdentifier()) usa.add(p.node.name)
    },
    JSXIdentifier(p) {
      if (p.node.start < t.start || p.node.end > t.end) return
      if (todos.has(p.node.name) && !t.nombres.includes(p.node.name)) usa.add(p.node.name)
    },
  })
  t.usa = [...usa]
  t.jsx = /<[A-Za-z]/.test(src.slice(t.start, t.end)) && /return\s*\(?\s*</.test(src.slice(t.start, t.end))
  t.lineas = t.fin - t.ini + 1
  delete t.start; delete t.end; void nodo
}
console.log(JSON.stringify(top))
