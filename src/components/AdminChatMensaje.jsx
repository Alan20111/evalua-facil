// Renderizador de un mensaje del Chat de Administración — separado de
// src/pages/admin/components/AdminChat.jsx porque usa una tabla Markdown
// (<table> crudo), y el repo prohíbe elementos HTML crudos dentro de
// src/pages/**/*.jsx (deben venir de components/ui) — ver eslint.config.js,
// "no-restricted-syntax" (Fase 3, paso 3.6).
//
// Mismo parser base que MensajeFormateado del Chat del docente
// (src/pages/teacher/ChatAsistente.jsx: encabezados #/##/###, separadores
// ---, viñetas, numeradas, **negritas**, líneas vacías que NO cierran listas
// en curso), con soporte de tablas Markdown agregado — el system prompt de
// este chat SÍ puede usarlas para comparaciones (el del docente no las pedía).

function formatearNegritas(texto, keyPrefix) {
  return texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((parte, i) => {
    const m = parte.match(/^\*\*([^*]+)\*\*$/)
    return m ? <strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong> : <span key={`${keyPrefix}-t${i}`}>{parte}</span>
  })
}

function bloquesDeTexto(texto) {
  const lineas = texto.replace(/\\r\\n|\\n/g, '\n').replace(/\\r/g, '').split('\n')
  const bloques = []
  let listaActual = null
  let tablaActual = null
  const cerrarLista = () => { if (listaActual) { bloques.push(listaActual); listaActual = null } }
  const cerrarTabla = () => { if (tablaActual) { bloques.push(tablaActual); tablaActual = null } }
  lineas.forEach((linea) => {
    const limpia = linea.trim()
    const encabezado = limpia.match(/^#{1,6}\s+(.*)/)
    const separador = /^([-*_])\1{2,}$/.test(limpia)
    const filaTabla = limpia.match(/^\|(.+)\|$/)
    const viñeta = limpia.match(/^[-*•]\s+(.*)/)
    const numerada = limpia.match(/^\d+[.)]\s+(.*)/)
    if (filaTabla) {
      const celdas = filaTabla[1].split('|').map((c) => c.trim())
      const esSeparadorTabla = celdas.every((c) => /^:?-+:?$/.test(c))
      if (esSeparadorTabla) return // fila `|---|---:|` — no se dibuja, solo marcaba alineación
      cerrarLista()
      if (!tablaActual) tablaActual = { tipo: 'tabla', filas: [] }
      tablaActual.filas.push(celdas)
    } else if (encabezado) {
      cerrarLista(); cerrarTabla()
      bloques.push({ tipo: 'h', texto: encabezado[1] })
    } else if (separador) {
      cerrarLista(); cerrarTabla()
      bloques.push({ tipo: 'hr' })
    } else if (viñeta) {
      cerrarTabla()
      if (!listaActual || listaActual.tipo !== 'ul') { cerrarLista(); listaActual = { tipo: 'ul', items: [] } }
      listaActual.items.push(viñeta[1])
    } else if (numerada) {
      cerrarTabla()
      if (!listaActual || listaActual.tipo !== 'ol') { cerrarLista(); listaActual = { tipo: 'ol', items: [] } }
      listaActual.items.push(numerada[1])
    } else if (limpia) {
      cerrarLista(); cerrarTabla()
      bloques.push({ tipo: 'p', texto: limpia })
    }
    // línea vacía: no cierra listas en curso (misma corrección que el chat
    // del docente, 18-ago-2026 — evita reiniciar la numeración en 1,1,1)
  })
  cerrarLista(); cerrarTabla()
  return bloques
}

export default function AdminChatMensaje({ texto }) {
  return bloquesDeTexto(texto).map((b, i) => {
    if (b.tipo === 'ul') {
      return (
        <ul key={i} className="list-disc pl-5 space-y-0.5 my-1 first:mt-0 last:mb-0">
          {b.items.map((it, j) => <li key={j}>{formatearNegritas(it, `${i}-${j}`)}</li>)}
        </ul>
      )
    }
    if (b.tipo === 'ol') {
      return (
        <ol key={i} className="list-decimal pl-5 space-y-0.5 my-1 first:mt-0 last:mb-0">
          {b.items.map((it, j) => <li key={j}>{formatearNegritas(it, `${i}-${j}`)}</li>)}
        </ol>
      )
    }
    if (b.tipo === 'h') return <p key={i} className="font-semibold text-on-surface mt-2 mb-0.5 first:mt-0">{formatearNegritas(b.texto, `${i}`)}</p>
    if (b.tipo === 'hr') return <hr key={i} className="my-2 border-outline-variant" />
    if (b.tipo === 'tabla') {
      const [encabezado, ...filas] = b.filas
      return (
        <div key={i} className="my-2 overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="border-b border-outline-variant">
                {encabezado.map((c, j) => <th key={j} className="px-2 py-1 text-left font-semibold text-on-surface">{formatearNegritas(c, `${i}h${j}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, j) => (
                <tr key={j} className="border-b border-outline-variant">
                  {f.map((c, k) => <td key={k} className="px-2 py-1 text-muted">{formatearNegritas(c, `${i}${j}${k}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return <p key={i} className="my-1 first:mt-0 last:mb-0">{formatearNegritas(b.texto, `${i}`)}</p>
  })
}
