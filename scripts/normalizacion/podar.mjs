// Quita de un archivo los imports que ya no se usan (tras mover código).
import fs from 'node:fs'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default || _traverse
for (const archivo of process.argv.slice(2)) {
  let src = fs.readFileSync(archivo, 'utf8')
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const quitar = []
  traverse(ast, {
    ImportDeclaration(p) {
      const specs = p.get('specifiers')
      if (!specs.length) return // import de efecto
      const vivos = specs.filter((s) => {
        const b = p.scope.getBinding(s.node.local.name)
        return b && b.referenced
      })
      if (vivos.length === specs.length) return
      if (!vivos.length) { quitar.push([p.node.start, p.node.end, '']); return }
      const def = vivos.find((s) => s.isImportDefaultSpecifier())
      const ns = vivos.find((s) => s.isImportNamespaceSpecifier())
      const nom = vivos.filter((s) => s.isImportSpecifier()).map((s) => {
        const imp = s.node.imported.name, loc = s.node.local.name
        return imp === loc ? loc : `${imp} as ${loc}`
      })
      const partes = []
      if (def) partes.push(def.node.local.name)
      if (ns) partes.push(`* as ${ns.node.local.name}`)
      if (nom.length) partes.push(`{ ${nom.join(', ')} }`)
      quitar.push([p.node.start, p.node.end, `import ${partes.join(', ')} from '${p.node.source.value}'`])
    },
  })
  quitar.sort((a, b) => b[0] - a[0])
  for (const [a, z, t] of quitar) src = src.slice(0, a) + t + src.slice(z).replace(t === '' ? /^\n/ : /^$/, '')
  fs.writeFileSync(archivo, src)
  console.log(archivo, 'imports ajustados:', quitar.length)
}
