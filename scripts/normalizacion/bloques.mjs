// Lista los bloques JSX grandes del componente principal de un archivo:
// {cond && (…)} / {cond ? … : …} / elementos con muchas líneas, con su
// condición y cuántas variables libres del componente usan.
import fs from 'node:fs'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default || _traverse
const [archivo, minLineas = '120'] = process.argv.slice(2)
const src = fs.readFileSync(archivo, 'utf8')
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
let principal = null
traverse(ast, {
  ExportDefaultDeclaration(p) { principal = p.get('declaration') },
})
const fnScope = principal.scope
const res = []
principal.traverse({
  JSXExpressionContainer(p) {
    const e = p.node.expression
    const ini = p.node.loc.start.line, fin = p.node.loc.end.line
    if (fin - ini + 1 < +minLineas) return
    // ¿variables libres ligadas a scopes intermedios (no al del componente)?
    let intermedias = new Set(), libres = new Set()
    p.traverse({
      Identifier(q) {
        if (!q.isReferencedIdentifier()) return
        const b = q.scope.getBinding(q.node.name)
        if (!b) return
        if (b.scope === fnScope) libres.add(q.node.name)
        else if (!isInside(b.path, p) && b.scope !== b.scope.getProgramParent()) intermedias.add(q.node.name)
      },
    })
    const cond = e.type === 'LogicalExpression' ? src.slice(e.left.start, e.left.end) : e.type === 'ConditionalExpression' ? src.slice(e.test.start, e.test.end) + ' ?:' : e.type
    res.push({ ini, fin, lineas: fin - ini + 1, cond: cond.slice(0, 70), libres: libres.size, intermedias: [...intermedias].slice(0, 6) })
  },
})
function isInside(path, ancestor) { let x = path; while (x) { if (x === ancestor) return true; x = x.parentPath } return false }
for (const r of res) console.log(`${String(r.ini).padStart(5)}-${String(r.fin).padEnd(5)} ${String(r.lineas).padStart(5)}  libres:${String(r.libres).padStart(3)}  ${r.intermedias.length ? 'INTERMEDIAS:' + r.intermedias.join(',') + '  ' : ''}${r.cond}`)
