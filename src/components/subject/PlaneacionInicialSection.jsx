// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
// Genera una PROPUESTA llenando una plantilla Word/Excel real, UNA VEZ POR
// CADA PARCIAL de la asignatura (decisión de Kike, 15-ago-2026): la
// genérica usa la plantilla bundleada de la app (public/plantillas/
// planeacion-generica.docx) y el formato oficial usa la que subió el
// docente — mismo mecanismo para las dos (leer la cuadrícula de celdas,
// mandarla a la IA, escribir solo las celdas vacías que decidió llenar).
// El docente la revisa, puede regenerarla y descargarla — nunca se aplica
// sola a ningún otro módulo de Evalúa Fácil.
import { useEffect, useRef, useState } from 'react'
import { collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { updateDoc } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useToast } from '../Toast'
import Spinner from '../Spinner'
import ConfirmModal from '../ConfirmModal'
import ConfirmacionCreditosModal from '../ConfirmacionCreditosModal'
import useCreditosIA from '../../hooks/useCreditosIA'
import useDiagnosticoEstado from '../../hooks/useDiagnosticoEstado'
import { leerCuadriculaExcel, leerTablasWord, llenarPlantillaExcel, llenarPlantillaWord, aplanarCuadricula } from '../../utils/plantillaOficial'
import { renderAsync as renderDocxAsync } from 'docx-preview'
import { useSubscription } from '../../hooks/useSubscription'
import useIsDesktop from '../../hooks/useIsDesktop'
import CheckoutModal from '../CheckoutModal'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ChevronDown, ChevronUp, ThumbsUp, Eye, Lock, FileCheck2, X, Monitor, Save, AlertTriangle, Trash2, Plus } from 'lucide-react'

// La plantilla genérica de la app — vacía, sin datos de ninguna escuela en
// particular. Vive en public/ (Vite la sirve tal cual, sin procesar) para
// que cualquier asignatura pueda usarla sin que el docente suba nada.
const PLANTILLA_GENERICA_URL = '/plantillas/planeacion-generica.docx'
const PLANTILLA_GENERICA_NOMBRE = 'Planeación didáctica.docx'

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

function RequisitoItem({ ok, texto }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-700' : 'text-muted'}`}>
      {ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      {texto}
    </li>
  )
}

// Señal visual del estado real de Planeación — discreta, junto al título.
// "Lista" exige los dos diagnósticos con análisis real (mismo criterio que
// habilita el botón, sin contar fuentes — ver spec de Kike, 13-ago-2026).
function EstadoPlaneacionBadge({ lista }) {
  const className = lista
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {lista ? 'Lista para generar' : 'Falta la Fuente Principal'}
    </span>
  )
}

// Resumen de insumos a incluir, de solo lectura — cada uno se marca en SU
// PROPIA tarjeta arriba (Comentarios, Autoanálisis, Consideraciones,
// Diagnóstico de contexto, Diagnóstico de conocimientos), decisión de
// Kike, 14-ago-2026: no duplicar el control aquí, solo mostrar lo que ya
// se marcó ahí para que el docente confirme antes de generar. El Perfil IA
// NO aparece aquí (decisión de Kike, 15-ago-2026): ya es obligatorio para
// poder ver esta pestaña siquiera, así que siempre se incluye, sin
// casilla.
function InsumosOpcionales({
  hayContexto, hayConocimientos,
  incluirComentarios, incluirAutoanalisis, incluirConsideraciones, incluirDiagContexto, incluirDiagConocimientos,
}) {
  const resumen = [
    ['Comentarios generales del grupo', incluirComentarios],
    ['Autoanálisis docente', incluirAutoanalisis],
    ['Consideraciones', incluirConsideraciones],
    [`Diagnóstico de contexto${hayContexto ? '' : ' (sin resultados todavía)'}`, incluirDiagContexto],
    [`Diagnóstico de conocimientos${hayConocimientos ? '' : ' (sin resultados todavía)'}`, incluirDiagConocimientos],
  ]
  return (
    <fieldset className="mb-2 p-2.5 rounded border border-outline-variant">
      <legend className="text-sm text-on-surface px-1">Insumos a incluir</legend>
      <p className="text-xs text-muted mb-1.5">
        Tu Perfil IA y la Fuente Principal (programa de estudios) siempre se usan. Los demás se marcan arriba, en la
        tarjeta de cada uno — entre más insumos incluyas y tengas listos, mejor planeación obtendrás.
      </p>
      {resumen.map(([texto, checked]) => (
        <div key={texto} className="flex items-center gap-2 py-0.5 text-sm text-on-surface">
          {checked ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" /> : <Circle size={14} className="text-muted flex-shrink-0" />}
          <span className={checked ? '' : 'text-muted'}>{texto}</span>
        </div>
      ))}
    </fieldset>
  )
}

// Celda editable "en su lugar" — sin borde propio hasta que se toca, para
// que la tabla se vea como el documento real y no como un formulario con
// cajas (Opción C elegida por Kike, 15-ago-2026: editar directo sobre la
// tabla, no en una lista aparte). Crece con el contenido (auto-resize en
// cada cambio, incluso el primer render) para que SIEMPRE se vea el texto
// completo, sin scroll interno ni recorte (pedido de Kike, 15-ago-2026).
function CeldaEditable({ value, onChange, placeholder }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className="w-full min-w-[140px] min-h-[3.5rem] px-1.5 py-1 text-xs bg-transparent border border-dashed rounded-none resize-none overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus:bg-surface-card border-accent/50 bg-[var(--accent-tint)]"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      maxLength={4000}
    />
  )
}

// Celdas que quedaron VACÍAS en la plantilla original y la IA no propuso
// llenar (campos administrativos como "Nombre del Docente", "Plantel",
// "Entidad federativa" — a propósito: la IA no los inventa, no los sabe).
// Kike pidió (15-ago-2026) que el docente SÍ las pueda llenar a mano, así
// que se agregan al conjunto editable con texto vacío — mismo criterio que
// una celda propuesta por la IA, solo que el docente la escribe él mismo.
function conCeldasVaciasEditables(celdasOriginales, celdasPropuestas) {
  const clave = (c) => `${c.tablaIndex ?? ''}_${c.fila}_${c.columna}`
  const yaPropuestas = new Set((celdasPropuestas || []).map(clave))
  const vacias = (celdasOriginales || [])
    .filter((c) => !c.texto && !yaPropuestas.has(clave(c)))
    .map((c) => ({ fila: c.fila, columna: c.columna, tablaIndex: c.tablaIndex, texto: '' }))
  return [...(celdasPropuestas || []), ...vacias]
}

// Reconstruye la cuadrícula real de la plantilla (una por tabla, para Word
// con varias tablas) combinando las celdas originales (encabezados, solo
// lectura) con las que quedaron editables (propuestas por la IA + vacías
// que el docente llena a mano) — para mostrar y editar la tabla tal cual
// es, no una lista de campos sueltos.
function construirGridPlantilla(celdasOriginales, celdasPropuestas) {
  const porTabla = new Map()
  const clave = (t) => (t ?? null)
  const celda = (t, f, c) => `${clave(t)}_${f}_${c}`

  for (const c of celdasOriginales) {
    const t = clave(c.tablaIndex)
    if (!porTabla.has(t)) porTabla.set(t, new Map())
    porTabla.get(t).set(celda(t, c.fila, c.columna), { fila: c.fila, columna: c.columna, texto: c.texto, editable: false, colSpan: c.colSpan || 1 })
  }
  celdasPropuestas.forEach((c, idx) => {
    const t = clave(c.tablaIndex)
    if (!porTabla.has(t)) porTabla.set(t, new Map())
    const previa = porTabla.get(t).get(celda(t, c.fila, c.columna))
    // Apertura/Desarrollo/Cierre con varias Secuencias Didácticas llegan
    // como ARRAY (una fila real por elemento en el documento final, ver
    // duplicarFilaWord) — esta tabla de respaldo solo muestra UNA fila por
    // celda de la plantilla, así que se unen para poder verlas y editarlas
    // aquí sin romper la estructura (el documento descargado/vista previa
    // real sí las separa en filas de verdad).
    const texto = Array.isArray(c.texto) ? c.texto.join('\n\n') : c.texto
    porTabla.get(t).set(celda(t, c.fila, c.columna), { fila: c.fila, columna: c.columna, texto, editable: true, idx, colSpan: previa?.colSpan || 1 })
  })

  return Array.from(porTabla.entries()).map(([t, cellsMap]) => {
    const cells = Array.from(cellsMap.values())
    const filas = [...new Set(cells.map((c) => c.fila))].sort((a, b) => a - b)
    const columnas = [...new Set(cells.map((c) => c.columna))].sort((a, b) => a - b)
    const grid = filas.map((f) => columnas.map((c) => cellsMap.get(celda(t, f, c)) || null))
    return { tablaIndex: t, grid }
  })
}

// Tabla real y editable de la plantilla — reemplaza la lista de campos
// sueltos: se ve la tabla completa (encabezados incluidos, de solo
// lectura) y solo las celdas editables (propuestas por la IA + vacías
// que el docente llena) se editan, en su lugar (Opción C, Kike, 15-ago-2026).
// Sin `onChangeCelda` (versión ya aceptada, solo para ver) se muestran
// como texto.
function TablaPlantillaEditable({ celdasOriginales, celdasPropuestas, onChangeCelda }) {
  const editable = typeof onChangeCelda === 'function'
  const tablas = construirGridPlantilla(celdasOriginales, celdasPropuestas)
  return (
    <div className="space-y-4">
      {tablas.map(({ tablaIndex, grid }) => (
        <div key={String(tablaIndex)} className="overflow-x-auto border border-outline-variant">
          <table className="border-collapse w-full">
            <tbody>
              {grid.map((fila, fi) => (
                <tr key={fi}>
                  {fila.map((c, ci) => (
                    !c ? null : (
                      <td key={ci} colSpan={c.colSpan} className="border border-outline-variant p-0 align-top">
                        {c.editable && editable ? (
                          <CeldaEditable value={c.texto} onChange={(valor) => onChangeCelda(c.idx, valor)} />
                        ) : (
                          <p className={`text-xs px-1.5 py-1 min-w-[140px] ${c.editable ? 'text-on-surface' : 'font-medium text-on-surface bg-surface-container'}`}>{c.texto}</p>
                        )}
                      </td>
                    )
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Edición directa sobre la Vista previa (pedido de Kike, 15-ago-2026:
// "por lo que veo la vista previa podría editarse y nos ahorraríamos la
// vista de edición") ──────────────────────────────────────────────────────
// docx-preview solo RENDERIZA el .docx a HTML — no sabe qué celda nuestra
// (tablaIndex/fila/columna) es cuál <td> del DOM. Se reconstruye esa
// correspondencia recorriendo las tablas renderizadas en el MISMO orden y
// con la MISMA lógica de columna (arrastrando colSpan) que usa
// leerTablasWord en plantillaOficial.js — y ANTES de confiar en ella, se
// verifica contra una muestra de celdas que YA tenían texto en el original
// (encabezados): si lo que hay en el DOM en esa posición no coincide con lo
// esperado, la correspondencia no es confiable y se cae a la tabla de
// respaldo (TablaPlantillaEditable) en vez de arriesgarse a guardar una
// corrección en la celda equivocada sin que el docente se entere.
function celdaClave(t, f, c) {
  return `${t ?? ''}_${f}_${c}`
}

function mapearCeldasDom(container) {
  const mapa = new Map()
  Array.from(container.querySelectorAll('table')).forEach((tabla, tablaIndex) => {
    Array.from(tabla.querySelectorAll('tr')).forEach((tr, fila) => {
      let columna = 0
      Array.from(tr.children).forEach((td) => {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') return
        mapa.set(celdaClave(tablaIndex, fila, columna), td)
        columna += td.colSpan || 1
      })
    })
  })
  return mapa
}

function verificarMapeoDom(mapa, celdasOriginales) {
  const conTexto = (celdasOriginales || []).filter((c) => c.texto?.trim()).slice(0, 30)
  if (!conTexto.length) return false
  let coincide = 0
  for (const c of conTexto) {
    const td = mapa.get(celdaClave(c.tablaIndex, c.fila, c.columna))
    const esperado = c.texto.trim().slice(0, 12).toLowerCase()
    if (td && td.textContent.trim().toLowerCase().startsWith(esperado)) coincide++
  }
  return coincide / conTexto.length >= 0.7
}

// Convierte "\n" reales (una viñeta por Sesión, ver promptPlantillaParcial)
// en <br> del DOM — textContent los ignora y todo saldría corrido en una
// sola línea visual (Kike lo detectó en producción, 15-ago-2026).
function pintarTextoConSaltos(td, texto) {
  td.textContent = ''
  String(texto || '').split('\n').forEach((linea, i) => {
    if (i > 0) td.appendChild(document.createElement('br'))
    td.appendChild(document.createTextNode(linea))
  })
}

// Lee de vuelta el texto de una celda contentEditable respetando los <br>
// como "\n" — el textContent plano los pierde.
function leerTextoConSaltos(td) {
  let texto = ''
  td.childNodes.forEach((n) => {
    if (n.nodeName === 'BR') texto += '\n'
    else texto += n.textContent || ''
  })
  return texto
}

// Vuelve editables (contentEditable) las celdas del DOM que corresponden a
// celdas propuestas por la IA o vacías que el docente llena a mano —
// devuelve `false` sin tocar nada si el mapeo no pasó la verificación.
function activarEdicionDirecta(container, celdasOriginales, celdasEditables, onChangeCelda) {
  const mapa = mapearCeldasDom(container)
  if (!verificarMapeoDom(mapa, celdasOriginales)) return false
  celdasEditables.forEach((c, idx) => {
    // Apertura/Desarrollo/Cierre con varias Secuencias Didácticas generan
    // FILAS NUEVAS reales en el documento (ver duplicarFilaWord) — la
    // posición original (tablaIndex/fila/columna) ya no corresponde a un
    // único <td> del render, así que no se activa edición directa ahí (se
    // vería bien pero editarla guardaría en el lugar equivocado). Se deja
    // de solo lectura en esta vista; para corregirla, la tabla de respaldo
    // (TablaPlantillaEditable) sí las puede editar como texto unido.
    if (Array.isArray(c.texto)) return
    const td = mapa.get(celdaClave(c.tablaIndex, c.fila, c.columna))
    if (!td) return
    td.contentEditable = 'true'
    td.style.outline = '2px dashed var(--accent)'
    td.style.background = 'var(--accent-tint)'
    td.style.minHeight = '1.2em'
    td.style.whiteSpace = 'pre-wrap'
    pintarTextoConSaltos(td, c.texto)
    td.addEventListener('input', () => onChangeCelda(idx, leerTextoConSaltos(td)))
  })
  return true
}

// Busca el encabezado de columna más cercano (misma tabla, misma columna,
// una fila arriba con texto) para dar contexto a una celda multi-sesión —
// p. ej. "Evidencias" o "Tipo de evaluación / instrumento".
function etiquetaColumna(celdasOriginales, tablaIndex, columna, filaCelda) {
  let mejor = null
  for (const c of celdasOriginales || []) {
    if (c.tablaIndex !== tablaIndex || c.columna !== columna || c.fila >= filaCelda || !c.texto) continue
    if (!mejor || c.fila > mejor.fila) mejor = c
  }
  return mejor?.texto || null
}

// Corrige, agrega, elimina y reordena las Secuencias Didácticas completas
// (Apertura/Desarrollo/Cierre con varias secuencias) — quedan fuera de la
// edición directa sobre el documento (ver activarEdicionDirecta) porque su
// posición real ya no corresponde a un único <td> tras duplicarse las
// filas, así que sin esto no había NINGUNA forma de corregirlas una vez que
// el resto del documento sí se pudo editar directo (bug encontrado por
// Kike, 16-ago-2026: "aun hay muchas partes que no permite editar").
// Siempre visible, no solo como respaldo del mapeo fallido.
//
// Cualquier celda cuyo `texto` sea un arreglo es, por construcción del
// servidor (ver llenarPlantillaPorParciales en functions/ia.js), parte del
// MISMO grupo sincronizado de Secuencias Didácticas — Apertura, Desarrollo y
// Cierre siempre traen el mismo número de elementos, en el mismo orden. Por
// eso agregar/eliminar/reordenar se aplica IGUAL a TODAS esas celdas a la
// vez (`onCambiarGrupo`), sin necesidad de saber cuál celda es cuál campo.
function SecuenciasDidacticasEditable({ celdasOriginales, celdas, onChangeSesion, onCambiarGrupo }) {
  const conSecuencias = celdas
    .map((c, idx) => ({ ...c, idx }))
    .filter((c) => Array.isArray(c.texto))
  if (!conSecuencias.length) return null
  const total = Math.max(0, ...conSecuencias.map((c) => c.texto.length))
  return (
    <div className="mt-4 pt-3 border-t border-outline-variant space-y-4">
      <p className="text-xs font-semibold text-amber-700">
        Secuencias Didácticas — corrige, agrega, elimina o reordena las que hagan falta:
      </p>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="p-2.5 rounded border border-outline-variant space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-on-surface">Secuencia Didáctica {i + 1}</p>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => onCambiarGrupo('mover', i, -1)}
                disabled={i === 0}
                aria-label="Mover antes"
                className="p-1 rounded text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface disabled:opacity-30"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => onCambiarGrupo('mover', i, 1)}
                disabled={i === total - 1}
                aria-label="Mover después"
                className="p-1 rounded text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface disabled:opacity-30"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => onCambiarGrupo('eliminar', i)}
                disabled={total <= 1}
                aria-label="Eliminar esta Secuencia Didáctica"
                className="p-1 rounded text-red-600 hover:bg-red-50 disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {conSecuencias.map((c) => (
            <div key={c.idx} className="space-y-1">
              <p className="text-xs font-medium text-on-surface">
                {etiquetaColumna(celdasOriginales, c.tablaIndex, c.columna, c.fila) || `Celda (fila ${c.fila}, columna ${c.columna})`}
              </p>
              <CeldaEditable value={c.texto[i] || ''} onChange={(v) => onChangeSesion(c.idx, i, v)} />
            </div>
          ))}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCambiarGrupo('agregar')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)]"
      >
        <Plus size={14} /> Agregar Secuencia Didáctica
      </button>
    </div>
  )
}

// A pantalla completa salvo el sidebar azul (pedido de Kike, 15-ago-2026) —
// la revisión de la Planeación necesita todo el ancho posible para verse
// como el documento real, no como una lista angosta. Solo en escritorio: en
// celular no hay espacio para una tabla así, así que ni se intenta mostrar
// (ver useIsDesktop) — el docente revisa desde una computadora.
function RevisionPantallaCompleta({ titulo, onCerrar, cerrarTexto = null, acciones, tabs, children }) {
  return (
    <div className="fixed inset-0 md:left-[300px] z-40 bg-surface-card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant flex-shrink-0">
        <h2 className="font-bold text-on-surface truncate">{titulo}</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {acciones}
          {cerrarTexto ? (
            <button
              type="button"
              onClick={onCerrar}
              className="flex-shrink-0 px-3 py-1.5 rounded border border-outline-variant text-sm text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface"
            >
              {cerrarTexto}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="p-1.5 rounded text-muted hover:bg-[var(--accent-tint)] hover:text-on-surface"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      {tabs && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-outline-variant flex-shrink-0 overflow-x-auto">
          {tabs}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </div>
  )
}

// Aviso cuando la pantalla es angosta (celular/tablet chica) — la revisión
// no se intenta mostrar ahí (pedido explícito de Kike, 15-ago-2026).
function AvisoRevisionDesktop() {
  return (
    <div className="mt-3 pt-2 border-t border-outline-variant flex items-start gap-2 text-xs text-amber-700">
      <Monitor size={16} className="flex-shrink-0 mt-0.5" />
      <p>Ya se generó — para revisarla, corregirla y aceptarla/descargarla, abre Evalúa Fácil desde una computadora.</p>
    </div>
  )
}

// Selector de parcial — un botón por cada documento (uno por parcial, ver
// arriba). Compartido por la revisión editable y la vista previa.
function SelectorParcial({ porParcial, activo, onCambiar }) {
  if (!porParcial || porParcial.length <= 1) return null
  return (
    <>
      {porParcial.map((p) => (
        <button
          key={p.numero}
          type="button"
          onClick={() => onCambiar(p.numero)}
          className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap flex-shrink-0 ${
            activo === p.numero ? 'bg-accent text-white' : 'border border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
          }`}
        >
          Parcial {p.numero}{p.periodo ? ` — ${p.periodo}` : ''}
        </button>
      ))}
    </>
  )
}

// Lee la cuadrícula de UNA plantilla (bundleada o subida) — mismo mecanismo
// para la genérica y la del formato oficial.
async function leerCeldasDePlantilla(url, tipo) {
  const res = await fetch(url)
  const buffer = await res.arrayBuffer()
  const tablas = tipo === 'docx'
    ? await leerTablasWord(buffer)
    : [(await leerCuadriculaExcel(buffer))].map((c) => ({ filas: c.filas }))
  const celdas = aplanarCuadricula(tablas)
  return { buffer, celdas }
}

async function llenarPlantilla(buffer, tipo, celdas) {
  return tipo === 'docx' ? llenarPlantillaWord(buffer, celdas) : llenarPlantillaExcel(buffer, celdas)
}

export default function PlaneacionInicialSection({ subjectId, subject, asignaturaNombre, hayFuentesGenerales, watermark = false }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  const { subscription, refresh: refreshSubscription } = useSubscription()
  // Mismo criterio que exportGuard.js: bloqueado mientras nunca hubo un pago
  // aprobado, sin importar si la suscripción sigue vigente o no.
  const nuncaAprobado = !subscription?.planId
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const isDesktop = useIsDesktop()

  // `subject` (prop) lo carga SubjectPage con un getDoc de una sola vez, no
  // con onSnapshot — así que cuando ESTE componente escribe en
  // subjects/{id} (aceptar/guardar/reiniciar), la página padre nunca se
  // entera y el docente veía los botones equivocados hasta recargar (bug
  // encontrado por Kike, 15-ago-2026). Se escucha aparte, solo para los
  // campos de Planeación — el resto del `subject` sigue viniendo del prop.
  const [subjectPlaneacion, setSubjectPlaneacion] = useState(null)
  const [subjectPlaneacionLoaded, setSubjectPlaneacionLoaded] = useState(false)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId), (snap) => {
      setSubjectPlaneacion(snap.exists() ? snap.data() : null)
      setSubjectPlaneacionLoaded(true)
    }, () => setSubjectPlaneacionLoaded(true))
    return unsub
  }, [subjectId])

  const [incluirEnPlaneacion, setIncluirEnPlaneacion] = useState({})
  const [plantillaOficial, setPlantillaOficial] = useState(null)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setIncluirEnPlaneacion(snap.exists() ? (snap.data().incluirEnPlaneacion || {}) : {})
      setPlantillaOficial(snap.exists() ? (snap.data().plantillaOficial || null) : null)
    }, () => { setIncluirEnPlaneacion({}); setPlantillaOficial(null) })
    return unsub
  }, [subjectId])

  // El diagnóstico "real" (Tandas 1 y 2) vive en `activities` — no en la
  // vieja `subjects/{id}/diagnosticosIA` (reporte simulado, descartado).
  const { estado: estadoContexto, cargado: contextoCargado } = useDiagnosticoEstado(subjectId, 'contexto')
  const { estado: estadoConocimientos, cargado: conocimientosCargado } = useDiagnosticoEstado(subjectId, 'conocimientos')
  const hayContexto = estadoContexto === 'completado'
  const hayConocimientos = estadoConocimientos === 'completado'
  const diagLoaded = contextoCargado && conocimientosCargado

  const incluirComentarios = incluirEnPlaneacion.comentarios !== false
  const incluirAutoanalisis = incluirEnPlaneacion.autoanalisis !== false
  const incluirConsideraciones = incluirEnPlaneacion.consideraciones !== false
  const incluirDiagContexto = incluirEnPlaneacion.diagContexto !== false
  const incluirDiagConocimientos = incluirEnPlaneacion.diagConocimientos !== false
  const incluirInsumos = {
    comentarios: incluirComentarios,
    autoanalisis: incluirAutoanalisis,
    consideraciones: incluirConsideraciones,
    diagContexto: incluirDiagContexto,
    diagConocimientos: incluirDiagConocimientos,
  }
  const habilitado = hayFuentesGenerales

  return (
    <div className="bg-surface-card rounded-card shadow-card p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-on-surface">Planeación Didáctica Inicial</h2>
        <EstadoPlaneacionBadge lista={hayFuentesGenerales} />
      </div>
      <p className="text-sm text-muted mt-0.5 mb-2">
        La IA puede generar tu Planeación Didáctica Inicial en dos formatos: uno genérico (con la plantilla de
        Evalúa Fácil) y, si subiste arriba el formato oficial de tu escuela, ese mismo llenado por la IA — un
        documento POR CADA PARCIAL real de la asignatura. Puedes probar y corregir los dos antes de decidir,
        pero solo aceptas UNO — ese es tu Planeación Inicial, y al aceptarlo el otro formato deja de estar
        disponible.
      </p>

      {subjectPlaneacionLoaded && !subjectPlaneacion?.planeacionAceptada && !subjectPlaneacion?.planeacionOficialAceptada && (
        <p className="text-sm font-semibold text-red-600 mb-2">
          Haz que tu IA tenga la mejor congruencia ACEPTANDO tu planeación didáctica INICIAL.
        </p>
      )}

      {!habilitado && (
        <ul className="space-y-1 mb-1">
          <RequisitoItem ok={hayFuentesGenerales} texto="Fuente Principal (programa de estudios)" />
        </ul>
      )}

      {habilitado && !diagLoaded && (
        <div className="flex justify-center py-6"><Spinner size="sm" /></div>
      )}

      {habilitado && diagLoaded && subjectPlaneacionLoaded && (
        <FormatoSection
          subjectId={subjectId}
          asignaturaNombre={asignaturaNombre}
          isDesktop={isDesktop}
          nuncaAprobado={nuncaAprobado}
          onPago={() => setShowPaymentModal(true)}
          subjectPlaneacion={subjectPlaneacion}
          incluirInsumos={incluirInsumos}
          hayContexto={hayContexto}
          hayConocimientos={hayConocimientos}
          creditosIA={creditosIA}
          toast={toast}
          coleccion="planeacionesIA"
          operacion="planeacion_didactica_inicial"
          campoAceptada="planeacionAceptada"
          campoBorrador="planeacionBorrador"
          titulo="Genérica"
          plantillaUrl={PLANTILLA_GENERICA_URL}
          plantillaTipo="docx"
          plantillaNombre={PLANTILLA_GENERICA_NOMBRE}
        />
      )}

      {habilitado && diagLoaded && subjectPlaneacionLoaded && plantillaOficial && (
        <div className="mt-4 pt-3 border-t border-outline-variant">
          <FormatoSection
            subjectId={subjectId}
            asignaturaNombre={asignaturaNombre}
            isDesktop={isDesktop}
            nuncaAprobado={nuncaAprobado}
            onPago={() => setShowPaymentModal(true)}
            subjectPlaneacion={subjectPlaneacion}
            incluirInsumos={incluirInsumos}
            hayContexto={hayContexto}
            hayConocimientos={hayConocimientos}
            creditosIA={creditosIA}
            toast={toast}
            coleccion="planeacionesOficialesIA"
            operacion="planeacion_formato_oficial"
            campoAceptada="planeacionOficialAceptada"
            campoBorrador="planeacionOficialBorrador"
            titulo="Formato oficial de tu escuela"
            plantillaUrl={plantillaOficial.url}
            plantillaTipo={plantillaOficial.tipo}
            plantillaNombre={plantillaOficial.nombre}
          />
        </div>
      )}

      <CheckoutModal
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        subscription={subscription}
        onSuccess={refreshSubscription}
      />
    </div>
  )
}

// Un formato completo (genérico u oficial) — generar, revisar/editar por
// parcial, guardar avance, aceptar, ver y descargar. Los dos formatos usan
// EXACTAMENTE el mismo mecanismo (llenar una plantilla real por parcial),
// solo cambia de dónde sale la plantilla y en qué campo se guarda la
// aceptación — de ahí que sea un solo componente parametrizado en vez de
// dos copias casi idénticas.
function FormatoSection({
  subjectId, asignaturaNombre, isDesktop, nuncaAprobado, onPago,
  subjectPlaneacion, incluirInsumos, hayContexto, hayConocimientos, creditosIA, toast,
  coleccion, operacion, campoAceptada, campoBorrador, titulo,
  plantillaUrl, plantillaTipo, plantillaNombre,
}) {
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [parcialActivo, setParcialActivo] = useState(1)
  const [edicion, setEdicion] = useState(null) // [{numero, periodo, celdas}] mientras no está aceptada
  const [edicionDeId, setEdicionDeId] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [confirmarAceptar, setConfirmarAceptar] = useState(false)
  const [confirmarReiniciar, setConfirmarReiniciar] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [descargandoParcial, setDescargandoParcial] = useState(null)
  const [verVistaPrevia, setVerVistaPrevia] = useState(false)
  const [cargandoVistaPrevia, setCargandoVistaPrevia] = useState(false)
  const [blobVistaPrevia, setBlobVistaPrevia] = useState(null)
  // null = todavía sin determinar (justo después de renderizar); true = se
  // pudo activar la edición directa sobre la vista previa; false = el
  // mapeo no fue confiable, se cae a TablaPlantillaEditable (respaldo).
  const [edicionDirectaOk, setEdicionDirectaOk] = useState(null)
  const [abrirTrasGenerar, setAbrirTrasGenerar] = useState(false)
  const vistaPreviaRef = useRef(null)
  // Copia editable de la planeación YA ACEPTADA — separada de `edicion`
  // (que es la copia previa a aceptar) porque una vez aceptada vive en otro
  // campo de Firestore (`campoAceptada`, no `campoBorrador`). Pedido de
  // Kike, 16-ago-2026: la planeación aceptada también debe poder corregirse
  // sin tener que "Generar de nuevo" (que la borra por completo).
  const [edicionAceptada, setEdicionAceptada] = useState(null)
  const [edicionAceptadaDeId, setEdicionAceptadaDeId] = useState(null)
  const [guardandoAceptada, setGuardandoAceptada] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, coleccion), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setHistLoaded(true)
    }, () => setHistLoaded(true))
    return unsub
  }, [subjectId, coleccion])

  // Datos de ANTES del 15-ago-2026 (un solo documento por generación, sin
  // parciales) traen `celdas`/`celdasPropuestas` planas en vez de
  // `porParcial` — se normalizan aquí, en un solo lugar, para que el resto
  // del componente nunca tenga que saber que existió ese formato viejo.
  // Sin esto, `.map` sobre un `porParcial` inexistente tronaba la pestaña
  // entera (mismo tipo de bug ya encontrado y corregido antes hoy).
  function normalizarPorParcial(obj) {
    if (!obj) return null
    if (Array.isArray(obj.porParcial)) return obj.porParcial
    const celdas = obj.celdas || obj.celdasPropuestas
    return Array.isArray(celdas) ? [{ numero: 1, periodo: null, celdasPropuestas: celdas, celdas }] : []
  }

  const actualRaw = historial[0] || null
  const actual = actualRaw ? { ...actualRaw, porParcial: normalizarPorParcial(actualRaw) } : null
  const anteriores = historial.slice(1)
  const aceptada = !!actual && subjectPlaneacion?.[campoAceptada]?.planeacionId === actual.id
  const fechaAceptada = aceptada ? subjectPlaneacion[campoAceptada].aceptadaEn : null
  const porParcialAceptado = aceptada
    ? (normalizarPorParcial(subjectPlaneacion[campoAceptada]).length
      ? normalizarPorParcial(subjectPlaneacion[campoAceptada]) : actual.porParcial)
    : null

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // nueva (o al recargar la página) — nunca pisa ediciones en curso del
  // mismo `actual.id`. A partir de lo último guardado como borrador si
  // existe (pedido de Kike, 15-ago-2026: el docente entra varias veces a
  // corregir antes de aceptar, así que el avance debe sobrevivir a cerrar
  // la pestaña).
  const actualIdParaEdicion = actual?.id || null
  if (actualIdParaEdicion !== edicionDeId) {
    const borrador = subjectPlaneacion?.[campoBorrador]?.planeacionId === actualIdParaEdicion
      ? normalizarPorParcial(subjectPlaneacion[campoBorrador]) : null
    setEdicion(actualIdParaEdicion
      ? (borrador?.length ? borrador : actual.porParcial.map((p) => ({
        numero: p.numero, periodo: p.periodo,
        celdas: conCeldasVaciasEditables(actual.celdasOriginales, p.celdasPropuestas),
      })))
      : null)
    setEdicionDeId(actualIdParaEdicion)
    setParcialActivo(actual?.porParcial?.[0]?.numero || 1)
  }

  if (aceptada && actualIdParaEdicion !== edicionAceptadaDeId) {
    setEdicionAceptada((porParcialAceptado || []).map((p) => ({
      numero: p.numero, periodo: p.periodo,
      celdas: p.celdas || conCeldasVaciasEditables(actual.celdasOriginales, p.celdasPropuestas || []),
    })))
    setEdicionAceptadaDeId(actualIdParaEdicion)
  }

  const guardadoRaw = subjectPlaneacion?.[campoBorrador]?.planeacionId === actual?.id
    ? normalizarPorParcial(subjectPlaneacion[campoBorrador]) : null
  const guardado = guardadoRaw?.length ? guardadoRaw : actual?.porParcial?.map((p) => ({
    numero: p.numero, periodo: p.periodo,
    celdas: conCeldasVaciasEditables(actual.celdasOriginales, p.celdasPropuestas),
  }))
  const sinGuardar = !!actual && JSON.stringify(edicion) !== JSON.stringify(guardado)
  const porParcialAceptadoNormalizado = aceptada
    ? (porParcialAceptado || []).map((p) => ({
      numero: p.numero, periodo: p.periodo,
      celdas: p.celdas || conCeldasVaciasEditables(actual.celdasOriginales, p.celdasPropuestas || []),
    }))
    : null
  const sinGuardarAceptada = aceptada && JSON.stringify(edicionAceptada) !== JSON.stringify(porParcialAceptadoNormalizado)

  async function generar() {
    if (nuncaAprobado) { onPago(); return }
    setGenerando(true)
    try {
      const { celdas } = await leerCeldasDePlantilla(plantillaUrl, plantillaTipo)
      if (!celdas.length) {
        toast('No se pudo leer la estructura de la plantilla', 'error')
        return
      }
      // La función misma guarda el resultado (ver ejecutarPlaneacionDidacticaInicial
      // / ejecutarPlaneacionFormatoOficial en functions/ia.js) — el listener
      // onSnapshot de arriba la recibe en cuanto se guarda.
      const data = await creditosIA.ejecutar(operacion, {
        subjectId, asignaturaId: subjectId, asignaturaNombre, incluir: incluirInsumos,
        celdas: celdas.map((c) => ({ f: c.fila, c: c.columna, t: c.tablaIndex, x: c.texto, s: c.colSpan || 1 })),
      }, 1, { timeoutMs: 240000 })
      setConfirmando(false)
      if (data?.resultado?.porParcial?.length) {
        toast(data.repetida ? 'Se recuperó la generación ya hecha (sin costo adicional) — revísala y acéptala cuando estés conforme.'
          : 'Planeación generada — revísala y acéptala cuando estés conforme.', 'info')
        // No se abre aquí mismo: `actual`/`edicion` todavía son del ciclo
        // ANTERIOR (el listener de Firestore no ha recibido la nueva
        // generación) — se marca pendiente y un efecto la abre en cuanto
        // `actual` de verdad cambie.
        setAbrirTrasGenerar(true)
      }
    } catch (err) {
      setConfirmando(false)
      if (err.codigo === 'SALDO_INSUFICIENTE') toast('No tienes suficientes créditos de IA para esta acción', 'error')
      else if (err.codigo === 'PERFIL_IA_INCOMPLETO') toast('Marcaste incluir tu Perfil IA, pero todavía no lo completas — complétalo o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_PROGRAMA_ESTUDIOS') toast('Sube primero la Fuente Principal (programa de estudios)', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONTEXTO') toast('Marcaste incluir el Diagnóstico de contexto, pero todavía no tiene resultados analizados — genera y analiza el instrumento, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_DIAGNOSTICO_CONOCIMIENTOS') toast('Marcaste incluir el Diagnóstico de conocimientos, pero todavía no tiene resultados analizados — genera y analiza el cuestionario, o desmarca esa casilla', 'error')
      else if (err.codigo === 'SIN_PLANTILLA_OFICIAL') toast('Sube primero la plantilla oficial de tu escuela', 'error')
      else toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
    } finally {
      setGenerando(false)
    }
  }

  async function guardar() {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        [campoBorrador]: { planeacionId: actual.id, porParcial: edicion, actualizadoEn: serverTimestamp() },
      })
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function aceptar() {
    setAceptando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        [campoAceptada]: { planeacionId: actual.id, aceptadaEn: serverTimestamp(), porParcial: edicion || actual.porParcial },
        [campoBorrador]: null,
      })
      toast('Planeación Inicial aceptada — ya puedes verla y descargarla')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // Guarda correcciones sobre la planeación YA ACEPTADA, en su lugar — no
  // cambia `planeacionId` ni `aceptadaEn`, solo el contenido de las celdas
  // (pedido de Kike, 16-ago-2026).
  async function guardarAceptada() {
    setGuardandoAceptada(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        [campoAceptada]: { ...subjectPlaneacion[campoAceptada], porParcial: edicionAceptada },
      })
      toast('Cambios guardados')
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'error')
    } finally {
      setGuardandoAceptada(false)
    }
  }

  // Quita la aceptación y sus borradores — irreversible: no hay forma de
  // recuperar cuál era la aceptada una vez hecho esto (pedido de Kike,
  // 15-ago-2026). No borra la bitácora (planeacionesIA/planeacionesOficialesIA
  // son inmutables por regla, a propósito).
  async function reiniciar() {
    setReiniciando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: null,
        planeacionBorrador: null,
        planeacionOficialAceptada: null,
        planeacionOficialBorrador: null,
      })
      toast('Planeación Inicial eliminada — ya puedes generar una nueva')
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setReiniciando(false)
      setConfirmarReiniciar(false)
    }
  }

  function celdasDeParcial(numero, fuente) {
    const p = (fuente || []).find((x) => x.numero === numero)
    return p?.celdas || p?.celdasPropuestas || []
  }

  async function descargarParcial(numero) {
    if (nuncaAprobado) { onPago(); return }
    setDescargandoParcial(numero)
    try {
      const resPlantilla = await fetch(plantillaUrl)
      const bufferOriginal = await resPlantilla.arrayBuffer()
      const celdas = celdasDeParcial(numero, porParcialAceptado)
      const blob = await llenarPlantilla(bufferOriginal, plantillaTipo, celdas)
      const base = (plantillaNombre || 'planeacion').replace(/\.(docx?|xlsx?)$/i, '')
      const nombreSalida = `${base} - Parcial ${numero}${plantillaTipo === 'docx' ? '.docx' : '.xlsx'}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreSalida
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast('Descargado — es una propuesta de IA revisada por ti, pero vuelve a checarla antes de usarla.', 'info')
    } catch (err) {
      toast('No se pudo generar el archivo: ' + err.message, 'error')
    } finally {
      setDescargandoParcial(null)
    }
  }

  // Abre la Vista previa — sin aceptar, ES la revisión: si el mapeo al DOM
  // resulta confiable, se edita directo sobre el documento renderizado; si
  // no, cae a TablaPlantillaEditable (ver el efecto de render, abajo). Ya
  // aceptada, es de solo lectura.
  async function abrirVistaPrevia(numeroParcial) {
    if (!actual) return
    if (plantillaTipo !== 'docx') {
      toast('La vista previa en imagen solo está disponible para Word por ahora — descarga el archivo para verlo con tu formato de Excel', 'info')
      return
    }
    setCargandoVistaPrevia(true)
    setEdicionDirectaOk(null)
    setVerVistaPrevia(true)
    try {
      const resPlantilla = await fetch(plantillaUrl)
      const bufferOriginal = await resPlantilla.arrayBuffer()
      const fuente = aceptada ? (edicionAceptada || porParcialAceptado) : edicion
      const celdas = celdasDeParcial(numeroParcial ?? parcialActivo, fuente)
      const blob = await llenarPlantillaWord(bufferOriginal, celdas)
      setBlobVistaPrevia(blob)
    } catch (err) {
      toast('No se pudo generar la vista previa: ' + err.message, 'error')
      setVerVistaPrevia(false)
    } finally {
      setCargandoVistaPrevia(false)
    }
  }

  // Se llama en cuanto `actual` de verdad refleja la generación recién
  // hecha (ver `generar()` — no se puede abrir en el mismo instante porque
  // el listener de Firestore todavía trae los datos del ciclo anterior).
  useEffect(() => {
    if (abrirTrasGenerar && actual) {
      setAbrirTrasGenerar(false)
      abrirVistaPrevia()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abrirVistaPrevia se redefine cada render, no es una dependencia real
  }, [abrirTrasGenerar, actual])

  function cerrarVistaPrevia() {
    setVerVistaPrevia(false)
    setBlobVistaPrevia(null)
    setEdicionDirectaOk(null)
  }

  function cambiarParcialVistaPrevia(numero) {
    setParcialActivo(numero)
    if (verVistaPrevia) abrirVistaPrevia(numero)
  }

  useEffect(() => {
    if (!verVistaPrevia || !blobVistaPrevia || !vistaPreviaRef.current) return
    vistaPreviaRef.current.innerHTML = ''
    renderDocxAsync(blobVistaPrevia, vistaPreviaRef.current, undefined, { inWrapper: true })
      .then(() => {
        // La edición (aceptada o no) solo se intenta en escritorio — en
        // celular la vista previa de la aceptada se deja de solo lectura
        // (ver AvisoRevisionDesktop / botón "Vista previa y edición").
        if (!isDesktop) return
        const ok = activarEdicionDirecta(
          vistaPreviaRef.current,
          actual?.celdasOriginales || [],
          celdasEditablesActivo,
          actualizarCelda,
        )
        setEdicionDirectaOk(ok)
      })
      .catch((err) => toast('No se pudo mostrar la vista previa: ' + err.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe re-ejecutar al cambiar de blob, no en cada render
  }, [verVistaPrevia, blobVistaPrevia])

  if (!histLoaded) {
    return <div className="flex justify-center py-6"><Spinner size="sm" /></div>
  }

  const fuenteEditableActivo = aceptada ? edicionAceptada : edicion
  const parcialEditableActivo = fuenteEditableActivo?.find((p) => p.numero === parcialActivo)
  const celdasEditablesActivo = parcialEditableActivo?.celdas || []

  // Escribe una corrección de celda en la copia editable que corresponda
  // (aceptada o en revisión) — mismo handler para la edición directa sobre
  // la vista previa y para la tabla de respaldo (TablaPlantillaEditable).
  function actualizarCelda(idx, texto) {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : { ...p, celdas: p.celdas.map((x, j) => (j === idx ? { ...x, texto } : x)) }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  // Igual que actualizarCelda, pero para una celda con VARIAS Secuencias
  // Didácticas (texto es un array, una entrada por Secuencia) — ver
  // SecuenciasDidacticasEditable.
  function actualizarCeldaSesion(idx, secuenciaIdx, valor) {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : {
        ...p,
        celdas: p.celdas.map((x, j) => (j === idx ? { ...x, texto: x.texto.map((t, k) => (k === secuenciaIdx ? valor : t)) } : x)),
      }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  // Agregar/eliminar/mover una Secuencia Didáctica COMPLETA — se aplica a
  // TODAS las celdas cuyo texto sea un arreglo a la vez (Apertura, Desarrollo,
  // Cierre...), para que nunca queden desincronizadas en largo u orden.
  function cambiarGrupoSecuencias(accion, indice, direccion) {
    const actualizador = (prev) => prev.map((p) => (
      p.numero !== parcialActivo ? p : {
        ...p,
        celdas: p.celdas.map((x) => {
          if (!Array.isArray(x.texto)) return x
          if (accion === 'agregar') return { ...x, texto: [...x.texto, ''] }
          if (accion === 'eliminar') return { ...x, texto: x.texto.filter((_, k) => k !== indice) }
          if (accion === 'mover') {
            const destino = indice + direccion
            if (destino < 0 || destino >= x.texto.length) return x
            const texto = [...x.texto]
            ;[texto[indice], texto[destino]] = [texto[destino], texto[indice]]
            return { ...x, texto }
          }
          return x
        }),
      }
    ))
    if (aceptada) setEdicionAceptada(actualizador)
    else setEdicion(actualizador)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-on-surface">{titulo}</h3>
      </div>

      {aceptada ? (
        <p className="text-xs text-muted mb-2">
          Estado: <span className="font-medium text-green-700">Aceptada — es tu Planeación Inicial, la usa la IA para todo lo demás</span>
          {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
        </p>
      ) : !actual ? (
        <p className="text-xs text-muted mb-2">Estado: <span className="font-medium">No generada</span></p>
      ) : (
        <p className="text-xs text-muted mb-2">
          Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
          {actual.generadoEn?.toDate && ` · ${actual.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
          . Revísala y corrígela antes de aceptarla — no se puede descargar hasta que la aceptes.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!aceptada && (
          <button
            type="button"
            onClick={() => (nuncaAprobado ? onPago() : setConfirmando(true))}
            disabled={generando}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
          >
            {generando ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : actual ? <RotateCcw size={14} /> : (coleccion === 'planeacionesIA' ? <Sparkles size={14} /> : <FileCheck2 size={14} />)}
            {actual ? 'Generar de nuevo (con IA)' : 'Generar planeación (con IA)'}
          </button>
        )}
        {actual && !aceptada && isDesktop && (
          <button
            type="button"
            onClick={() => abrirVistaPrevia()}
            disabled={cargandoVistaPrevia}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50 disabled:opacity-60"
          >
            {cargandoVistaPrevia ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
            Vista previa y edición
          </button>
        )}
        {actual && aceptada && (
          <button
            type="button"
            onClick={() => abrirVistaPrevia()}
            disabled={cargandoVistaPrevia}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm disabled:opacity-60 ${
              isDesktop ? 'border-green-600 text-green-700 hover:bg-green-50' : 'border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
            }`}
          >
            {cargandoVistaPrevia ? <Spinner size="sm" /> : isDesktop ? <ThumbsUp size={14} /> : <Eye size={14} />}
            {isDesktop ? 'Vista previa y edición' : 'Vista previa'}
          </button>
        )}
        {aceptada && (
          <button
            type="button"
            onClick={() => setConfirmarReiniciar(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-300 text-red-700 text-sm hover:bg-red-50"
          >
            <AlertTriangle size={14} />
            Generar de nuevo
          </button>
        )}
      </div>

      {aceptada && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-muted">Descargar por parcial:</span>
          {(porParcialAceptado || []).map((p) => (
            <button
              key={p.numero}
              type="button"
              onClick={() => descargarParcial(p.numero)}
              disabled={descargandoParcial === p.numero}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent text-white text-xs hover:bg-accent-hover disabled:opacity-60"
            >
              {descargandoParcial === p.numero ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={12} /> : <Download size={12} />}
              Parcial {p.numero}
            </button>
          ))}
        </div>
      )}

      {/* Sin aceptar, "Revisar y aceptar" y "Vista previa" son la MISMA
          pantalla (pedido de Kike, 15-ago-2026: "por lo que veo la vista
          previa podría editarse y nos ahorraríamos la vista de edición") —
          se edita directo sobre el documento real renderizado. Si el
          mapeo entre ese render y nuestras celdas no resulta confiable
          (edicionDirectaOk === false), cae a TablaPlantillaEditable en vez
          de arriesgar guardar una corrección en la celda equivocada sin
          que el docente se entere. Solo en escritorio. */}
      {actual && !aceptada && !isDesktop && <AvisoRevisionDesktop />}
      {verVistaPrevia && (isDesktop || aceptada) && (
        <RevisionPantallaCompleta
          titulo={
            aceptada
              ? (isDesktop ? 'Corrige y guarda tu Planeación Inicial ya aceptada' : 'Vista previa — así se imprimiría')
              : 'Corrige y guarda antes de aceptarla (también podrás editar tu archivo descargado)'
          }
          onCerrar={cerrarVistaPrevia}
          cerrarTexto={!aceptada ? 'Salir y aceptar luego' : null}
          tabs={<SelectorParcial porParcial={actual?.porParcial} activo={parcialActivo} onCambiar={cambiarParcialVistaPrevia} />}
          acciones={isDesktop && (
            <>
              <button
                type="button"
                onClick={aceptada ? guardarAceptada : guardar}
                disabled={aceptada ? (!sinGuardarAceptada || guardandoAceptada) : (!sinGuardar || guardando)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm disabled:opacity-50 ${
                  (aceptada ? sinGuardarAceptada : sinGuardar)
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'border border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
                }`}
              >
                {(aceptada ? guardandoAceptada : guardando) ? <Spinner size="sm" /> : <Save size={14} />}
                {(aceptada ? sinGuardarAceptada : sinGuardar) ? 'Guardar cambios' : 'Guardado'}
              </button>
              {!aceptada && (
                <button
                  type="button"
                  onClick={() => setConfirmarAceptar(true)}
                  disabled={aceptando}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-60"
                >
                  {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                  Aceptar esta planeación como mi Planeación Inicial
                </button>
              )}
            </>
          )}
        >
          {cargandoVistaPrevia && !blobVistaPrevia ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (isDesktop && edicionDirectaOk === false) ? (
            <>
              <p className="text-xs text-amber-700 mb-3">
                No se pudo activar la edición directa sobre esta plantilla — corrígela aquí abajo, campo por
                campo.
              </p>
              <TablaPlantillaEditable
                celdasOriginales={actual?.celdasOriginales || []}
                celdasPropuestas={celdasEditablesActivo}
                onChangeCelda={actualizarCelda}
              />
            </>
          ) : (
            <div className="flex justify-center overflow-x-auto">
              <div ref={vistaPreviaRef} />
            </div>
          )}
          {isDesktop && !(cargandoVistaPrevia && !blobVistaPrevia) && (
            <SecuenciasDidacticasEditable
              celdasOriginales={actual?.celdasOriginales || []}
              celdas={celdasEditablesActivo}
              onChangeSesion={actualizarCeldaSesion}
              onCambiarGrupo={cambiarGrupoSecuencias}
            />
          )}
        </RevisionPantallaCompleta>
      )}

      {anteriores.length > 0 && (
        <div className="mt-2 pt-2 border-t border-outline-variant">
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted hover:text-on-surface"
          >
            {verHistorial ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {anteriores.length} generación{anteriores.length > 1 ? 'es' : ''} anterior{anteriores.length > 1 ? 'es' : ''} (sin aceptar, no descargable)
          </button>
          {verHistorial && (
            <div className="mt-2 space-y-1.5">
              {anteriores.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">
                    {h.generadoEn?.toDate && h.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  <span className="text-muted italic">Reemplazada — no se puede descargar</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo={`Generar Planeación Inicial (${titulo})`}
          descripcion="La IA usa tu Perfil IA, tus fuentes ya guardadas y los diagnósticos del grupo — genera un documento por cada parcial real de la asignatura en una sola operación."
          costoMin={creditosIA.estimar(operacion) ?? 20}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <InsumosOpcionales
            disabled={generando}
            hayContexto={hayContexto}
            hayConocimientos={hayConocimientos}
            incluirComentarios={incluirInsumos.comentarios}
            incluirAutoanalisis={incluirInsumos.autoanalisis}
            incluirConsideraciones={incluirInsumos.consideraciones}
            incluirDiagContexto={incluirInsumos.diagContexto}
            incluirDiagConocimientos={incluirInsumos.diagConocimientos}
          />
        </ConfirmacionCreditosModal>
      )}

      {confirmarAceptar && (
        <ConfirmModal
          title="¿Aceptar esta Planeación Didáctica Inicial?"
          message="Se guarda con las correcciones que hayas hecho, en TODOS los parciales. Cuando la aceptes queda fija como tu Planeación Inicial, con la fecha de hoy — podrás seguir corrigiéndola desde una computadora, y verla y descargarla las veces que quieras (si tu suscripción está pagada)."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptando}
          onConfirm={aceptar}
          onCancel={() => { if (!aceptando) setConfirmarAceptar(false) }}
        />
      )}

      {confirmarReiniciar && (
        <ConfirmModal
          title="¿Generar una Planeación Inicial nueva?"
          message="Tu Planeación Inicial aceptada se eliminará de forma automática e irreversible — no se puede recuperar después. En su lugar podrás generar y editar una completamente nueva, en cualquiera de los dos formatos."
          confirmLabel="Eliminar y empezar de nuevo"
          confirmingLabel="Eliminando…"
          busy={reiniciando}
          onConfirm={reiniciar}
          onCancel={() => { if (!reiniciando) setConfirmarReiniciar(false) }}
        />
      )}
    </div>
  )
}
