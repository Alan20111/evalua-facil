// Apartado 3 de "Asistente IA": Planeación Didáctica Inicial (FASE 2-BIS del
// Plan Maestro de IA). Se habilita solo cuando ya existen fuentes generales
// y AMBOS diagnósticos (contexto y conocimientos) — la secuencia completa.
//
// Estructura propia de Evalúa Fácil (decisión de Kike, 16-ago-2026) que
// reproduce EXACTAMENTE el formato visual del Word de referencia que Kike
// proporcionó (Planeacion_Didactica_Universal.docx, analizado 16-ago-2026):
// tabla de datos de identificación institucional, luego cada Secuencia
// Didáctica con su identidad y sus TRES momentos (Apertura/Desarrollo/
// Cierre, cada uno con su propio juego de actividades/recursos/evaluación),
// y una tabla de fuentes de información al final — pero la CANTIDAD de
// Secuencias es dinámica, ya NO depende de ningún formato institucional que
// el docente tenga que subir. El docente elige, antes de generar, si
// define él mismo cuántas Secuencias Didácticas quiere por parcial o si
// deja que la IA decida. La revisión y edición ocurren sobre el documento
// Word REAL renderizado (pedido explícito de Kike, 16-ago-2026: "DEBE
// VERSE COMO SE VEIA, COMO UN WORD EN EL CUAL SE ESTA EDITANDO") — nunca en
// un panel aparte.
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
import {
  CAMPOS_IDENTIFICACION, CAMPOS_IDENTIDAD_SECUENCIA, MOMENTOS, CAMPOS_MOMENTO, CAMPOS_VALIDACION,
  validacionVacia, construirDocumentoPlaneacion,
} from '../../utils/planeacionDocx'
import { renderAsync as renderDocxAsync } from 'docx-preview'
import { useSubscription } from '../../hooks/useSubscription'
import useIsDesktop from '../../hooks/useIsDesktop'
import CheckoutModal from '../CheckoutModal'
import { CheckCircle2, Circle, Sparkles, RotateCcw, Download, ThumbsUp, Eye, Lock, X, Monitor, Save, AlertTriangle } from 'lucide-react'

const CLAVES_MOMENTO = MOMENTOS.map((m) => m.clave)
const FUENTES_VACIAS = ['', '', '', '', '']

function millisDe(ts) {
  return ts?.toMillis?.() || 0
}

function nuevoMomentoVacio() {
  const m = {}
  for (const { clave } of CAMPOS_MOMENTO) m[clave] = ''
  return m
}

function nuevaSecuenciaVacia() {
  const s = { id: crypto.randomUUID() }
  for (const { clave } of CAMPOS_IDENTIDAD_SECUENCIA) s[clave] = ''
  for (const clave of CLAVES_MOMENTO) s[clave] = nuevoMomentoVacio()
  return s
}

// Regla única de ponderación (Kike, 16-ago-2026): la escala es el PARCIAL
// completo = 100%, no cada Secuencia por separado — Apertura/Desarrollo/
// Cierre nunca tienen porcentaje propio, lo que se pondera es la evidencia
// que cada momento produce. "0%"/"No aplica"/vacío cuentan como 0.
function numeroPonderacion(v) {
  const m = String(v || '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

function sumaPonderacionesParcial(secuencias) {
  return (Array.isArray(secuencias) ? secuencias : []).reduce((total, s) => (
    total + CLAVES_MOMENTO.reduce((sub, momento) => sub + numeroPonderacion(s?.[momento]?.ponderacion), 0)
  ), 0)
}

// Extrae solo el CONTENIDO editable de un doc de Firestore (generación,
// borrador o aceptada) — sin `planeacionId`/`aceptadaEn`/`actualizadoEn`,
// para poder comparar "lo editado" contra "lo guardado" con JSON.stringify
// sin que esos metadatos ensucien la comparación.
function extraerContenido(obj) {
  if (!obj) return null
  return {
    datosIdentificacion: obj.datosIdentificacion || null,
    fuentesInformacion: obj.fuentesInformacion || FUENTES_VACIAS,
    validacion: obj.validacion || validacionVacia(),
    porParcial: obj.porParcial || [],
  }
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

// Antes de generar, el docente decide cuántas Secuencias Didácticas quiere
// por parcial — o deja que la IA lo decida (regla permanente de Kike,
// 16-ago-2026: "la decisión debe ser previa a la generación", nunca al
// revés). "Que la IA decida" es la opción por default: la mayoría de los
// docentes no tiene por qué saber de antemano cuántas Secuencias hacen
// falta.
function SelectorCantidadSecuencias({ modo, onCambiarModo, cantidad, onCambiarCantidad, disabled }) {
  return (
    <fieldset className="mb-2 p-2.5 rounded border border-outline-variant" disabled={disabled}>
      <legend className="text-sm text-on-surface px-1">¿Cuántas Secuencias Didácticas quieres por parcial?</legend>
      <label className="flex items-center gap-2 py-0.5 text-sm text-on-surface cursor-pointer">
        <input type="radio" name="modoCantidadSecuencias" checked={modo === 'ia'} onChange={() => onCambiarModo('ia')} />
        Que la IA decida (recomendado)
      </label>
      <label className="flex items-center gap-2 py-0.5 text-sm text-on-surface cursor-pointer">
        <input type="radio" name="modoCantidadSecuencias" checked={modo === 'manual'} onChange={() => onCambiarModo('manual')} />
        Yo decido:
        <input
          type="number" min={1} max={12} value={cantidad}
          onChange={(e) => onCambiarCantidad(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          onFocus={() => onCambiarModo('manual')}
          className="w-16 px-1.5 py-0.5 rounded border border-outline-variant text-sm bg-transparent"
        />
      </label>
    </fieldset>
  )
}

// ── Edición directa sobre el documento Word REAL renderizado (pedido de
// Kike, 16-ago-2026, tras dos vueltas: "DEBE VERSE COMO SE VEIA, COMO UN
// WORD EN EL CUAL SE ESTA EDITANDO") ────────────────────────────────────
// El .docx lo genera la propia app (construirDocumentoPlaneacion) — nunca
// una plantilla ajena — así que su estructura es 100% predecible: primero
// la tabla de identificación institucional, luego 4 tablas por Secuencia
// (identidad + Apertura + Desarrollo + Cierre) en ese orden fijo, y al
// final la tabla de fuentes de información. La fila y columna de cada
// campo dentro de cada tabla también son fijas (mismo orden que
// planeacionDocx.js) — no hace falta ningún mecanismo de verificación de
// mapeo (el que sí hacía falta antes de hoy, cuando el documento podía ser
// cualquier plantilla subida por el docente).
function pintarTextoConSaltos(td, texto) {
  td.textContent = ''
  String(texto || '').split('\n').forEach((linea, i) => {
    if (i > 0) td.appendChild(document.createElement('br'))
    td.appendChild(document.createTextNode(linea))
  })
}

function leerTextoConSaltos(td) {
  let texto = ''
  td.childNodes.forEach((n) => {
    if (n.nodeName === 'BR') texto += '\n'
    else texto += n.textContent || ''
  })
  return texto
}

function filasDe(tabla) {
  return Array.from(tabla.querySelectorAll('tr'))
}

function celdasDe(tr) {
  return tr ? Array.from(tr.children).filter((td) => td.tagName === 'TD' || td.tagName === 'TH') : []
}

function hacerEditable(td, valorInicial, onCambio) {
  if (!td) return
  td.contentEditable = 'true'
  td.style.outline = '2px dashed var(--accent)'
  td.style.outlineOffset = '-2px'
  td.style.background = 'var(--accent-tint)'
  td.style.minHeight = '1.2em'
  td.style.whiteSpace = 'pre-wrap'
  pintarTextoConSaltos(td, valorInicial)
  td.addEventListener('input', () => onCambio(leerTextoConSaltos(td)))
}

// Tabla "DATOS DE IDENTIFICACIÓN INSTITUCIONAL" — fila 0 encabezado, filas
// 1-5 pares etiqueta|valor (2 por fila), fila 6 "Competencias" con el
// valor solo (misma estructura que tablaIdentificacion en planeacionDocx.js).
function activarTablaIdentificacion(tabla, datos, actualizar) {
  const filas = filasDe(tabla)
  for (let i = 0; i < 5; i++) {
    const celdas = celdasDe(filas[i + 1])
    const a = CAMPOS_IDENTIFICACION[i * 2]
    const b = CAMPOS_IDENTIFICACION[i * 2 + 1]
    hacerEditable(celdas[1], datos?.[a.clave], (v) => actualizar(a.clave, v))
    hacerEditable(celdas[3], datos?.[b.clave], (v) => actualizar(b.clave, v))
  }
  const competencias = CAMPOS_IDENTIFICACION[10]
  const celdasComp = celdasDe(filas[6])
  hacerEditable(celdasComp[1], datos?.[competencias.clave], (v) => actualizar(competencias.clave, v))
}

// Tabla de identidad de UNA Secuencia — fila 0 encabezado, filas 1-5 una
// por campo de CAMPOS_IDENTIDAD_SECUENCIA.
function activarTablaIdentidadSecuencia(tabla, secuencia, actualizar) {
  const filas = filasDe(tabla)
  CAMPOS_IDENTIDAD_SECUENCIA.forEach(({ clave }, i) => {
    const celdas = celdasDe(filas[i + 1])
    hacerEditable(celdas[1], secuencia?.[clave], (v) => actualizar(clave, v))
  })
}

// Tabla de UN momento (Apertura/Desarrollo/Cierre) — misma estructura de
// filas que tablaMomento en planeacionDocx.js: fila2 = actividades|recursos,
// fila4 = estrategia de evaluación, fila6 = evidencias|tipo|ponderación.
function activarTablaMomento(tabla, datosMomento, actualizar) {
  const filas = filasDe(tabla)
  const f2 = celdasDe(filas[2])
  hacerEditable(f2[0], datosMomento?.actividades, (v) => actualizar('actividades', v))
  hacerEditable(f2[1], datosMomento?.recursos, (v) => actualizar('recursos', v))
  const f4 = celdasDe(filas[4])
  hacerEditable(f4[0], datosMomento?.estrategiaEvaluacion, (v) => actualizar('estrategiaEvaluacion', v))
  const f6 = celdasDe(filas[6])
  hacerEditable(f6[0], datosMomento?.evidencias, (v) => actualizar('evidencias', v))
  hacerEditable(f6[1], datosMomento?.tipoInstrumento, (v) => actualizar('tipoInstrumento', v))
  hacerEditable(f6[2], datosMomento?.ponderacion, (v) => actualizar('ponderacion', v))
}

// Tabla "FUENTES DE INFORMACIÓN / BIBLIOGRAFÍA" — fila 0 encabezado, filas
// 1-5 numeradas.
function activarTablaBibliografia(tabla, fuentes, actualizarFuente) {
  const filas = filasDe(tabla)
  for (let i = 0; i < 5; i++) {
    const celdas = celdasDe(filas[i + 1])
    hacerEditable(celdas[1], fuentes?.[i], (v) => actualizarFuente(i, v))
  }
}

// Tabla "VALIDACIÓN" — fila 0 encabezado, fila 1 etiquetas (fijas, no se
// editan), fila 2 espacio de firma (nunca editable, se queda en blanco),
// fila 3 = 3 celdas editables (nombre + cargo, mismo campo, separados por
// salto de línea real).
function activarTablaValidacion(tabla, validacion, actualizarValidacion) {
  const filas = filasDe(tabla)
  const celdas = celdasDe(filas[3])
  CAMPOS_VALIDACION.forEach((campo, i) => {
    hacerEditable(celdas[i], validacion?.[campo.clave], (v) => actualizarValidacion(campo.clave, v))
  })
}

// Recorre las tablas del documento renderizado EN EL MISMO ORDEN en que
// planeacionDocx.js las genera y activa la edición directa en cada una.
// Además inyecta, junto a la etiqueta "SECUENCIA DIDÁCTICA N" que ya trae
// el documento, los controles de reordenar/eliminar — dentro del propio
// documento, nunca en un panel aparte — y un botón para agregar una
// Secuencia al final.
function activarEdicionDocumento(
  container, datosIdentificacion, secuencias, fuentesInformacion, validacion,
  actualizarIdentificacion, actualizarFuente, actualizarCampoSecuencia, cambiarGrupoSecuencias, actualizarValidacion,
) {
  const tablas = Array.from(container.querySelectorAll('table'))
  let idx = 0
  activarTablaIdentificacion(tablas[idx++], datosIdentificacion, actualizarIdentificacion)
  secuencias.forEach((s, si) => {
    activarTablaIdentidadSecuencia(tablas[idx++], s, (clave, v) => actualizarCampoSecuencia(si, clave, v))
    for (const clave of CLAVES_MOMENTO) {
      activarTablaMomento(tablas[idx++], s[clave], (sub, v) => actualizarCampoSecuencia(si, `${clave}.${sub}`, v))
    }
  })
  activarTablaBibliografia(tablas[idx++], fuentesInformacion, actualizarFuente)
  activarTablaValidacion(tablas[idx++], validacion, actualizarValidacion)

  const total = secuencias.length
  // docx-preview envuelve el texto de cada run en su propio <span> — no se
  // puede exigir "sin hijos", solo que el texto completo del párrafo sea
  // exactamente la etiqueta (el contenedor se limpia con innerHTML='' antes
  // de cada render, así que no hace falta cuidar la doble inyección).
  const etiquetas = Array.from(container.querySelectorAll('p')).filter((el) => (
    /^SECUENCIA DIDÁCTICA \d+$/.test(el.textContent?.trim() || '')
  ))
  const boton = (texto, aria, disabled, onClick) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = texto
    b.setAttribute('aria-label', aria)
    b.disabled = disabled
    b.style.cssText = `font-size:11px;line-height:1;padding:2px 6px;margin-left:6px;border-radius:4px;border:1px solid #ccc;background:${disabled ? 'transparent' : '#fff'};color:${disabled ? '#bbb' : '#333'};cursor:${disabled ? 'default' : 'pointer'};`
    if (!disabled) b.addEventListener('click', onClick)
    return b
  }
  etiquetas.forEach((etiqueta, i) => {
    etiqueta.appendChild(boton('▲', 'Mover esta Secuencia antes', i === 0, () => cambiarGrupoSecuencias('mover', i, -1)))
    etiqueta.appendChild(boton('▼', 'Mover esta Secuencia después', i === total - 1, () => cambiarGrupoSecuencias('mover', i, 1)))
    etiqueta.appendChild(boton('✕ eliminar', 'Eliminar esta Secuencia Didáctica', total <= 1, () => {
      if (window.confirm(`¿Eliminar la Secuencia Didáctica ${i + 1}?`)) cambiarGrupoSecuencias('eliminar', i)
    }))
  })
  const agregar = document.createElement('button')
  agregar.type = 'button'
  agregar.textContent = '+ Agregar Secuencia Didáctica'
  agregar.style.cssText = 'margin-top:14px;font-size:13px;padding:6px 12px;border-radius:4px;border:1px dashed #bbb;background:transparent;color:var(--accent);cursor:pointer;'
  agregar.addEventListener('click', () => cambiarGrupoSecuencias('agregar'))
  container.appendChild(agregar)
}

// A pantalla completa salvo el sidebar azul (pedido de Kike, 15-ago-2026) —
// la revisión de la Planeación necesita todo el ancho posible para verse
// como el documento real, no como una lista angosta. Solo en escritorio: en
// celular no hay espacio para esto, así que ni se intenta mostrar (ver
// useIsDesktop) — el docente revisa desde una computadora.
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

export default function PlaneacionInicialSection({ subjectId, asignaturaNombre, hayFuentesGenerales }) {
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
  // campos de Planeación.
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
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'subjects', subjectId, 'asistenteIA', 'config'), (snap) => {
      setIncluirEnPlaneacion(snap.exists() ? (snap.data().incluirEnPlaneacion || {}) : {})
    }, () => setIncluirEnPlaneacion({}))
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
        La IA ha generado una propuesta de planeación para cada parcial de la asignatura.
      </p>

      <p className="text-xs text-muted mb-2">
        💡 Es una guía de trabajo, no un guion. Puedes adaptarla, cambiar o sustituir actividades según las
        necesidades de tu grupo. La IA la tomará como base para proponerte actividades congruentes con tu
        planeación.
      </p>

      {subjectPlaneacionLoaded && !subjectPlaneacion?.planeacionAceptada && (
        <p className="text-sm font-semibold text-red-600 mb-2">
          Revísala y acéptala para continuar.
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
        <Planeacion
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
        />
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

// La Planeación Didáctica Inicial — generar, revisar/editar por parcial,
// guardar avance, aceptar, ver y descargar.
function Planeacion({
  subjectId, asignaturaNombre, isDesktop, nuncaAprobado, onPago,
  subjectPlaneacion, incluirInsumos, hayContexto, hayConocimientos, creditosIA, toast,
}) {
  const [historial, setHistorial] = useState([])
  const [histLoaded, setHistLoaded] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [modoCantidad, setModoCantidad] = useState('ia')
  const [cantidadManual, setCantidadManual] = useState(3)
  const [generando, setGenerando] = useState(false)
  const [parcialActivo, setParcialActivo] = useState(1)
  // Copia editable — solo existe/importa ANTES de aceptar (una vez
  // aceptada, la Planeación queda bloqueada, ver `contenidoActivo` más
  // abajo). { datosIdentificacion, fuentesInformacion, validacion, porParcial }
  const [edicion, setEdicion] = useState(null)
  const [edicionDeId, setEdicionDeId] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [confirmarAceptar, setConfirmarAceptar] = useState(false)
  const [confirmarReiniciar, setConfirmarReiniciar] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)
  const [descargandoParcial, setDescargandoParcial] = useState(null)
  const [verRevision, setVerRevision] = useState(false)
  const [cargandoVistaPrevia, setCargandoVistaPrevia] = useState(false)
  const [blobVistaPrevia, setBlobVistaPrevia] = useState(null)
  // Agregar/eliminar/mover una Secuencia Didáctica cambia cuántas tablas
  // trae el documento — hay que regenerar el .docx y volver a renderizarlo
  // (ver cambiarGrupoSecuencias / el efecto que consume esta bandera).
  const [recargarVistaPreviaPendiente, setRecargarVistaPreviaPendiente] = useState(false)
  const vistaPreviaRef = useRef(null)
  const fuenteActivaRef = useRef({ datosIdentificacion: null, fuentesInformacion: FUENTES_VACIAS, validacion: null, secuencias: [] })
  const [abrirTrasGenerar, setAbrirTrasGenerar] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'subjects', subjectId, 'planeacionesIA'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => millisDe(b.generadoEn) - millisDe(a.generadoEn))
      setHistorial(items)
      setHistLoaded(true)
    }, () => setHistLoaded(true))
    return unsub
  }, [subjectId])

  // Solo la generación MÁS RECIENTE es "la" Planeación Inicial, desde la
  // perspectiva del docente — regla permanente de Kike: en todo momento
  // debe existir una sola Planeación Inicial vigente, nunca un historial de
  // generaciones visible. `planeacionesIA` sigue siendo append-only por
  // dentro (bitácora técnica), pero solo `historial[0]` se muestra.
  const actual = historial[0] || null
  const aceptada = !!actual && subjectPlaneacion?.planeacionAceptada?.planeacionId === actual.id
  const fechaAceptada = aceptada ? subjectPlaneacion.planeacionAceptada.aceptadaEn : null
  const contenidoAceptado = aceptada
    ? (subjectPlaneacion.planeacionAceptada.porParcial?.length
      ? extraerContenido(subjectPlaneacion.planeacionAceptada) : extraerContenido(actual))
    : null
  const porParcialAceptado = contenidoAceptado?.porParcial || null

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // nueva (o al recargar la página) — nunca pisa ediciones en curso del
  // mismo `actual.id`. A partir de lo último guardado como borrador si
  // existe (pedido de Kike, 15-ago-2026: el docente entra varias veces a
  // corregir antes de aceptar, así que el avance debe sobrevivir a cerrar
  // la pestaña).
  const actualIdParaEdicion = actual?.id || null
  if (actualIdParaEdicion !== edicionDeId) {
    const borrador = subjectPlaneacion?.planeacionBorrador?.planeacionId === actualIdParaEdicion
      ? extraerContenido(subjectPlaneacion.planeacionBorrador) : null
    setEdicion(actualIdParaEdicion ? (borrador?.porParcial?.length ? borrador : extraerContenido(actual)) : null)
    setEdicionDeId(actualIdParaEdicion)
    setParcialActivo(actual?.porParcial?.[0]?.numero || 1)
  }

  const guardadoRaw = !!actual && subjectPlaneacion?.planeacionBorrador?.planeacionId === actual.id
    ? extraerContenido(subjectPlaneacion.planeacionBorrador) : null
  const guardado = guardadoRaw?.porParcial?.length ? guardadoRaw : (actual ? extraerContenido(actual) : null)
  const sinGuardar = !!actual && JSON.stringify(edicion) !== JSON.stringify(guardado)

  async function generar() {
    if (nuncaAprobado) { onPago(); return }
    setGenerando(true)
    try {
      // La función misma guarda el resultado (ver ejecutarPlaneacionDidacticaInicial
      // en functions/ia.js) — el listener onSnapshot de arriba la recibe en
      // cuanto se guarda.
      const data = await creditosIA.ejecutar('planeacion_didactica_inicial', {
        subjectId, asignaturaId: subjectId, asignaturaNombre, incluir: incluirInsumos,
        cantidadSecuencias: modoCantidad === 'manual' ? cantidadManual : null,
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
      else toast(err.message || 'El asistente de IA no está disponible en este momento', 'error')
    } finally {
      setGenerando(false)
    }
  }

  async function guardar() {
    setGuardando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionBorrador: { planeacionId: actual.id, ...edicion, actualizadoEn: serverTimestamp() },
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
        planeacionAceptada: { planeacionId: actual.id, aceptadaEn: serverTimestamp(), ...(edicion || extraerContenido(actual)) },
        planeacionBorrador: null,
      })
      toast('Planeación Inicial aceptada — ya puedes verla y descargarla')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // Quita la aceptación y sus borradores — irreversible: no hay forma de
  // recuperar cuál era la aceptada una vez hecho esto (pedido de Kike,
  // 15-ago-2026). No borra la bitácora (planeacionesIA es inmutable por
  // regla, a propósito).
  async function reiniciar() {
    setReiniciando(true)
    try {
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: null,
        planeacionBorrador: null,
      })
      toast('Planeación Inicial eliminada — ya puedes generar una nueva')
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setReiniciando(false)
      setConfirmarReiniciar(false)
    }
  }

  function secuenciasDeParcial(numero, porParcial) {
    return (porParcial || []).find((x) => x.numero === numero)?.secuencias || []
  }

  async function descargarParcial(numero) {
    if (nuncaAprobado) { onPago(); return }
    setDescargandoParcial(numero)
    try {
      const p = (porParcialAceptado || []).find((x) => x.numero === numero)
      const titulo = `Planeación Didáctica Inicial — Parcial ${numero}${p?.periodo ? ` (${p.periodo})` : ''}`
      const blob = await construirDocumentoPlaneacion(
        contenidoAceptado?.datosIdentificacion, secuenciasDeParcial(numero, porParcialAceptado),
        contenidoAceptado?.fuentesInformacion, titulo, contenidoAceptado?.validacion,
      )
      const nombreSalida = `Planeación Didáctica Inicial - Parcial ${numero}.docx`
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

  // Una vez aceptada, la Planeación queda BLOQUEADA — de solo lectura,
  // nunca editable (regla permanente de Kike). Por eso ya no hay una copia
  // "editable de la aceptada": la vista de solo lectura usa directamente
  // `contenidoAceptado`.
  const contenidoActivo = aceptada ? contenidoAceptado : edicion
  const secuenciasActivo = secuenciasDeParcial(parcialActivo, contenidoActivo?.porParcial)
  const sumaParcialActivo = sumaPonderacionesParcial(secuenciasActivo)
  // Antes de aceptar, TODOS los parciales deben sumar exactamente 100% —
  // no solo el que se esté viendo en ese momento (Kike, 16-ago-2026: "no
  // permitir aceptar una Planeación cuya suma de ponderaciones no sea
  // exactamente 100%").
  const parcialesConPonderacionMal = !aceptada
    ? (edicion?.porParcial || []).filter((p) => Math.abs(sumaPonderacionesParcial(p.secuencias) - 100) > 0.5)
    : []
  // El efecto de render (más abajo) corre en un callback async — para
  // cuando termina, el estado de ESTE render puede ya no ser el más
  // reciente si hubo un cambio entremedio; un ref siempre trae el valor
  // actual sin tener que declarar el efecto de nuevo en cada render.
  useEffect(() => {
    fuenteActivaRef.current = {
      datosIdentificacion: contenidoActivo?.datosIdentificacion,
      fuentesInformacion: contenidoActivo?.fuentesInformacion,
      validacion: contenidoActivo?.validacion,
      secuencias: secuenciasActivo,
    }
  })

  // Escribe una corrección en la copia editable — solo se llama antes de
  // aceptar (una vez aceptada, `activarEdicionDocumento` ya ni siquiera se
  // activa, ver el useEffect que renderiza la vista previa).
  function actualizarIdentificacion(clave, valor) {
    setEdicion((prev) => ({ ...prev, datosIdentificacion: { ...prev.datosIdentificacion, [clave]: valor } }))
  }

  function actualizarFuente(indice, valor) {
    setEdicion((prev) => ({
      ...prev,
      fuentesInformacion: (prev.fuentesInformacion || FUENTES_VACIAS).map((f, i) => (i === indice ? valor : f)),
    }))
  }

  // Sección VALIDACIÓN (Elaborado por / Avalado por ×2) — pertenece a
  // PERSONALIZAR, pero se edita aquí mismo, igual que cualquier otro campo
  // de la Planeación (regla general: todo lo que genera la IA es editable
  // en el propio documento, MIENTRAS no se haya aceptado).
  function actualizarValidacion(clave, valor) {
    setEdicion((prev) => ({ ...prev, validacion: { ...(prev.validacion || validacionVacia()), [clave]: valor } }))
  }

  // `ruta` es la clave del campo de identidad de la Secuencia (p. ej.
  // "nombre") o "momento.campo" (p. ej. "apertura.actividades").
  function actualizarCampoSecuencia(indiceSecuencia, ruta, valor) {
    const partes = ruta.split('.')
    setEdicion((prev) => ({
      ...prev,
      porParcial: prev.porParcial.map((p) => (
        p.numero !== parcialActivo ? p : {
          ...p,
          secuencias: p.secuencias.map((s, j) => {
            if (j !== indiceSecuencia) return s
            if (partes.length === 1) return { ...s, [partes[0]]: valor }
            const [momento, sub] = partes
            return { ...s, [momento]: { ...s[momento], [sub]: valor } }
          }),
        }
      )),
    }))
  }

  // Agregar/eliminar/mover una Secuencia Didáctica COMPLETA — cambia cuántas
  // tablas trae el documento, así que regenera y vuelve a renderizar la
  // vista previa completa (ver el useEffect de recargarVistaPreviaPendiente).
  function cambiarGrupoSecuencias(accion, indice, direccion) {
    setEdicion((prev) => ({
      ...prev,
      porParcial: prev.porParcial.map((p) => {
        if (p.numero !== parcialActivo) return p
        if (accion === 'agregar') return { ...p, secuencias: [...p.secuencias, nuevaSecuenciaVacia()] }
        if (accion === 'eliminar') return { ...p, secuencias: p.secuencias.filter((_, j) => j !== indice) }
        if (accion === 'mover') {
          const destino = indice + direccion
          if (destino < 0 || destino >= p.secuencias.length) return p
          const secuencias = [...p.secuencias]
          ;[secuencias[indice], secuencias[destino]] = [secuencias[destino], secuencias[indice]]
          return { ...p, secuencias }
        }
        return p
      }),
    }))
    setRecargarVistaPreviaPendiente(true)
  }

  // Abre la Vista previa y edición — genera el .docx desde los datos
  // actuales (sin fetch, sin plantilla) y lo renderiza; el efecto de abajo
  // activa la edición directa en cuanto termina de pintarse.
  async function abrirVistaPrevia(numeroParcial) {
    if (!actual) return
    setCargandoVistaPrevia(true)
    setVerRevision(true)
    try {
      const numero = numeroParcial ?? parcialActivo
      const contenido = aceptada ? contenidoAceptado : (edicion || extraerContenido(actual))
      const secuencias = secuenciasDeParcial(numero, contenido?.porParcial)
      const p = (contenido?.porParcial || []).find((x) => x.numero === numero)
      const titulo = `Planeación Didáctica Inicial — Parcial ${numero}${p?.periodo ? ` (${p.periodo})` : ''}`
      const blob = await construirDocumentoPlaneacion(contenido?.datosIdentificacion, secuencias, contenido?.fuentesInformacion, titulo, contenido?.validacion)
      setBlobVistaPrevia(blob)
    } catch (err) {
      toast('No se pudo generar la vista previa: ' + err.message, 'error')
      setVerRevision(false)
    } finally {
      setCargandoVistaPrevia(false)
    }
  }

  // Se llama en cuanto `actual` de verdad refleja la generación recién
  // hecha (ver `generar()` — no se puede abrir en el mismo instante porque
  // el listener de Firestore todavía trae los datos del ciclo anterior).
  useEffect(() => {
    if (abrirTrasGenerar && actual) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- solo apaga la bandera que disparó este mismo efecto, no encadena renders externos
      setAbrirTrasGenerar(false)
      abrirVistaPrevia()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abrirVistaPrevia se redefine cada render, no es una dependencia real
  }, [abrirTrasGenerar, actual])

  // Tras agregar/eliminar/mover una Secuencia Didáctica (ver
  // cambiarGrupoSecuencias) — el estado y esta bandera se actualizan en el
  // MISMO evento, así que React los aplica juntos en el siguiente render:
  // para cuando este efecto corre, el estado ya refleja el cambio.
  useEffect(() => {
    if (recargarVistaPreviaPendiente) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- solo apaga la bandera que disparó este mismo efecto, no encadena renders externos
      setRecargarVistaPreviaPendiente(false)
      abrirVistaPrevia()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abrirVistaPrevia se redefine cada render, no es una dependencia real
  }, [recargarVistaPreviaPendiente, edicion])

  useEffect(() => {
    if (!verRevision || !blobVistaPrevia || !vistaPreviaRef.current) return
    vistaPreviaRef.current.innerHTML = ''
    renderDocxAsync(blobVistaPrevia, vistaPreviaRef.current, undefined, { inWrapper: true })
      .then(() => {
        // La edición NUNCA se activa una vez aceptada (queda bloqueada, de
        // solo lectura) — y solo se activa en escritorio mientras no se ha
        // aceptado (en celular la Vista previa se deja de solo lectura, ver
        // AvisoRevisionDesktop).
        if (aceptada || !isDesktop || !vistaPreviaRef.current) return
        const { datosIdentificacion, fuentesInformacion, validacion, secuencias } = fuenteActivaRef.current
        activarEdicionDocumento(
          vistaPreviaRef.current, datosIdentificacion, secuencias, fuentesInformacion, validacion,
          actualizarIdentificacion, actualizarFuente, actualizarCampoSecuencia, cambiarGrupoSecuencias, actualizarValidacion,
        )
      })
      .catch((err) => toast('No se pudo mostrar la vista previa: ' + err.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe re-ejecutar al cambiar de blob, no en cada render
  }, [verRevision, blobVistaPrevia])

  if (!histLoaded) {
    return <div className="flex justify-center py-6"><Spinner size="sm" /></div>
  }

  function cambiarParcialRevision(numero) {
    setParcialActivo(numero)
    abrirVistaPrevia(numero)
  }

  function cerrarRevision() {
    setVerRevision(false)
    setBlobVistaPrevia(null)
  }

  return (
    <div>
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
          . No podrás descargarla hasta aceptarla.
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
            {generando ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : actual ? <RotateCcw size={14} /> : <Sparkles size={14} />}
            {actual ? 'Generar de nuevo (con IA)' : 'Generar planeación (con IA)'}
          </button>
        )}
        {actual && !aceptada && isDesktop && (
          <button
            type="button"
            onClick={() => abrirVistaPrevia()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50"
          >
            <ThumbsUp size={14} />
            Vista previa y edición
          </button>
        )}
        {actual && aceptada && (
          <button
            type="button"
            onClick={() => abrirVistaPrevia()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)]"
          >
            <Eye size={14} />
            Vista previa
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
          pantalla — se edita directo sobre el documento Word real
          renderizado. Solo en escritorio (celular no tiene espacio para
          esto). */}
      {actual && !aceptada && !isDesktop && <AvisoRevisionDesktop />}
      {verRevision && (isDesktop || aceptada) && (
        <RevisionPantallaCompleta
          titulo={aceptada ? 'Planeación Inicial aceptada (solo lectura)' : 'Corrige y guarda antes de aceptarla'}
          onCerrar={cerrarRevision}
          cerrarTexto={!aceptada ? 'Salir y aceptar luego' : null}
          tabs={(
            <>
              <SelectorParcial porParcial={actual?.porParcial} activo={parcialActivo} onCambiar={cambiarParcialRevision} />
              {!aceptada && (
                <span
                  className={`ml-auto flex-shrink-0 text-xs font-medium px-2 py-1 rounded ${
                    Math.abs(sumaParcialActivo - 100) <= 0.5 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                  }`}
                >
                  Ponderación del parcial: {sumaParcialActivo}%
                </span>
              )}
            </>
          )}
          acciones={isDesktop && !aceptada && (
            <>
              <button
                type="button"
                onClick={guardar}
                disabled={!sinGuardar || guardando}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm disabled:opacity-60 ${
                  sinGuardar
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'border border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
                }`}
              >
                {guardando ? <Spinner size="sm" /> : <Save size={14} />}
                {sinGuardar ? 'Guardar cambios' : 'Guardado'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (parcialesConPonderacionMal.length) {
                    const lista = parcialesConPonderacionMal.map((p) => `Parcial ${p.numero} (${sumaPonderacionesParcial(p.secuencias)}%)`).join(', ')
                    toast(`La ponderación de cada parcial debe sumar exactamente 100% antes de aceptar: ${lista}`, 'error')
                    return
                  }
                  setConfirmarAceptar(true)
                }}
                disabled={aceptando}
                title={parcialesConPonderacionMal.length ? 'Corrige la ponderación de cada parcial a exactamente 100% antes de aceptar' : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm disabled:opacity-60 ${
                  parcialesConPonderacionMal.length
                    ? 'border border-outline-variant text-muted hover:bg-[var(--accent-tint)]'
                    : 'bg-accent text-white hover:bg-accent-hover'
                }`}
              >
                {aceptando ? <Spinner size="sm" /> : <ThumbsUp size={14} />}
                Aceptar esta planeación como mi Planeación Inicial
              </button>
            </>
          )}
        >
          {cargandoVistaPrevia && !blobVistaPrevia ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <div className="flex justify-center overflow-x-auto">
              <div ref={vistaPreviaRef} />
            </div>
          )}
        </RevisionPantallaCompleta>
      )}

      {confirmando && (
        <ConfirmacionCreditosModal
          titulo="Generar tu Planeación Inicial"
          descripcion="La IA usa tu Perfil IA, tus fuentes ya guardadas y los diagnósticos del grupo — genera un documento por cada parcial real de la asignatura en una sola operación."
          costoMin={creditosIA.estimar('planeacion_didactica_inicial') ?? 20}
          ejecutando={generando}
          onCancelar={() => { if (!generando) setConfirmando(false) }}
          onContinuar={generar}
        >
          <SelectorCantidadSecuencias
            modo={modoCantidad}
            onCambiarModo={setModoCantidad}
            cantidad={cantidadManual}
            onCambiarCantidad={setCantidadManual}
            disabled={generando}
          />
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
          message="Se guarda con las correcciones que hayas hecho, en TODOS los parciales. Cuando la aceptes queda fija como tu Planeación Inicial, con la fecha de hoy, en modo de solo lectura — ya no podrás editarla directamente. Podrás verla y descargarla las veces que quieras (si tu suscripción está pagada), o generar una nueva si necesitas cambiarla."
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
          message="Tu Planeación Inicial aceptada se eliminará de forma automática e irreversible — no se puede recuperar después. En su lugar podrás generar y editar una completamente nueva."
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
