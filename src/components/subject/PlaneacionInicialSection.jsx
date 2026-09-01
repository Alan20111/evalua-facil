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
import { auth, db } from '../../firebase'
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
import useIsDesktop from '../../hooks/useIsDesktop'
import { planeacionVigente, PLANEACION_CARPETA, extensionPlaneacion } from '../../utils/planeacionVigente'
import PlaneacionPropiaCard, { SelectorArchivoPlaneacion } from './PlaneacionPropiaCard'
import AvisoPerfilIA from './AvisoPerfilIA'
import { uploadToCloudinary } from '../../utils/cloudinary'
import { apiUrl } from '../../utils/apiBase'
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

// Señal visual del estado REAL de la Planeación — discreta, junto al título.
//
// Antes del 1-sep-2026 recibía `hayFuentesGenerales`, que le llegaba como el
// literal `true`, así que siempre decía "Lista para generar": encuadraba la
// sección como si el único camino fuera la IA. Ahora dice cuál es la
// planeación vigente y de dónde salió, que es lo que el docente necesita
// saber de un vistazo.
function EstadoPlaneacionBadge({ vigente }) {
  const { texto, className } = !vigente
    ? { texto: 'Sin planeación', className: 'bg-amber-50 text-amber-700 border-amber-200' }
    : vigente.origen === 'archivo'
      ? { texto: 'Vigente: tu planeación', className: 'bg-green-50 text-green-700 border-green-200' }
      : { texto: 'Vigente: generada por Evalúa Fácil', className: 'bg-green-50 text-green-700 border-green-200' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {texto}
    </span>
  )
}

// Resumen de insumos a incluir, de solo lectura — cada uno se marca en SU
// PROPIA tarjeta, más abajo en la pestaña, bajo "Información adicional para
// generar con IA" (Comentarios, Autoanálisis, Consideraciones,
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
        Tu Perfil IA y la Fuente Principal (programa de estudios) siempre se usan. Los demás se marcan más abajo,
        en &ldquo;Información adicional para generar con IA&rdquo;, en la tarjeta de cada uno — entre más insumos incluyas y
        tengas listos, mejor planeación obtendrás.
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

export default function PlaneacionInicialSection({ subjectId, asignaturaNombre, hayFuentesGenerales, perfilIACompleto = false }) {
  const toast = useToast()
  const creditosIA = useCreditosIA()
  // Modelo de créditos puros (20-ago-2026): generar/descargar Planeación ya
  // no depende de historial de pago — solo del saldo de créditos (gate
  // aparte, vía ConfirmacionCreditosModal/creditosIA).
  const nuncaAprobado = false
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
        <h2 className="font-bold text-on-surface">Planeación Didáctica</h2>
        <EstadoPlaneacionBadge vigente={planeacionVigente(subjectPlaneacion)} />
      </div>
      <p className="text-sm text-muted mt-0.5 mb-2">
        Cada asignatura tiene una sola planeación vigente: la que genera Evalúa Fácil, o la tuya en PDF o Word.
      </p>

      <p className="text-xs text-muted mb-2">
        💡 Es una guía de trabajo, no un guion. Puedes adaptarla, cambiar o sustituir actividades según las
        necesidades de tu grupo.
      </p>

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
          onPago={() => {}}
          perfilIACompleto={perfilIACompleto}
          subjectPlaneacion={subjectPlaneacion}
          incluirInsumos={incluirInsumos}
          hayContexto={hayContexto}
          hayConocimientos={hayConocimientos}
          creditosIA={creditosIA}
          toast={toast}
        />
      )}

    </div>
  )
}

// La Planeación Didáctica Inicial — generar, revisar/editar por parcial,
// guardar avance, aceptar, ver y descargar.
function Planeacion({
  subjectId, asignaturaNombre, isDesktop, nuncaAprobado, onPago, perfilIACompleto,
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
  // Planeación propia del docente: el archivo ya validado que espera
  // confirmación (nunca se sube antes de que el docente confirme) y la
  // bandera de "subiendo".
  const [archivoPorConfirmar, setArchivoPorConfirmar] = useState(null)
  const [subiendoArchivo, setSubiendoArchivo] = useState(false)
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

  // ── Planeación VIGENTE vs GENERACIÓN IA PENDIENTE ─────────────────────
  // Dos conceptos distintos (1-sep-2026, ver src/utils/planeacionVigente.js).
  // La vigencia sale ÚNICAMENTE del resolver: `planeacionesIA` ya no decide
  // cuál es la planeación de la asignatura, solo si quedó una generación de
  // IA esperando revisión. Antes de hoy la vigencia se derivaba comparando
  // `planeacionAceptada.planeacionId` contra `historial[0].id`, lo que ataba
  // la existencia de una planeación a haber venido de la IA — con la
  // planeación propia del docente eso ya no se sostiene.
  const vigente = planeacionVigente(subjectPlaneacion)
  const vigenteIA = vigente?.origen === 'ia'
  const vigenteArchivo = vigente?.origen === 'archivo'
  const fechaAceptada = vigente?.aceptadaEn || null

  // La generación IA pendiente de aceptación SOLO cuenta mientras no haya
  // planeación vigente: en cuanto hay una (venga de donde venga), nada más
  // puede mostrarse ni usarse como planeación de la asignatura. Sigue
  // guardada en la bitácora, no se pierde — pero no es "otra planeación".
  const pendiente = vigente ? null : (historial[0] || null)

  // Contenido de la vigente cuando es de IA. Los registros más viejos
  // guardaban solo el puntero, sin el contenido: ahí se cae al documento de
  // la bitácora que ese puntero señala (antes se usaba historial[0], que era
  // lo mismo porque solo se podía aceptar la generación más reciente).
  const generacionVigente = vigenteIA
    ? (historial.find((h) => h.id === vigente.planeacionId) || null)
    : null
  const contenidoAceptado = vigenteIA
    ? (vigente.porParcial?.length ? extraerContenido(vigente) : extraerContenido(generacionVigente))
    : null
  const porParcialAceptado = contenidoAceptado?.porParcial || null

  // Inicializa/reinicia la copia editable cuando aparece una generación
  // pendiente nueva (o al recargar la página) — nunca pisa ediciones en
  // curso de la misma generación. A partir de lo último guardado como
  // borrador si existe (pedido de Kike, 15-ago-2026: el docente entra varias
  // veces a corregir antes de aceptar, así que el avance debe sobrevivir a
  // cerrar la pestaña). La clave incluye la planeación vigente para que al
  // cambiar de origen la copia editable se descarte, en vez de quedarse
  // colgando de un estado que ya no existe.
  const claveEdicion = vigente
    ? `vigente:${vigente.origen}:${vigente.planeacionId || vigente.archivo?.url || ''}`
    : (pendiente?.id || null)
  if (claveEdicion !== edicionDeId) {
    const borrador = pendiente && subjectPlaneacion?.planeacionBorrador?.planeacionId === pendiente.id
      ? extraerContenido(subjectPlaneacion.planeacionBorrador) : null
    setEdicion(pendiente ? (borrador?.porParcial?.length ? borrador : extraerContenido(pendiente)) : null)
    setEdicionDeId(claveEdicion)
    setParcialActivo((contenidoAceptado?.porParcial || pendiente?.porParcial)?.[0]?.numero || 1)
  }

  const guardadoRaw = !!pendiente && subjectPlaneacion?.planeacionBorrador?.planeacionId === pendiente.id
    ? extraerContenido(subjectPlaneacion.planeacionBorrador) : null
  const guardado = guardadoRaw?.porParcial?.length ? guardadoRaw : (pendiente ? extraerContenido(pendiente) : null)
  const sinGuardar = !!pendiente && JSON.stringify(edicion) !== JSON.stringify(guardado)

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
        planeacionBorrador: { planeacionId: pendiente.id, ...edicion, actualizadoEn: serverTimestamp() },
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
        planeacionAceptada: {
          ...(edicion || extraerContenido(pendiente)),
          origen: 'ia',
          planeacionId: pendiente.id,
          aceptadaEn: serverTimestamp(),
        },
        planeacionBorrador: null,
      })
      toast('Planeación aceptada — ya puedes verla y descargarla')
    } catch (err) {
      toast('No se pudo aceptar: ' + err.message, 'error')
    } finally {
      setAceptando(false)
      setConfirmarAceptar(false)
    }
  }

  // Pide al servidor que borre de Cloudinary el archivo que quedó marcado
  // como "por borrar" en la propia asignatura (ver sustituirPorArchivo /
  // quitarPlaneacion). Nunca revierte la planeación vigente si falla: la
  // prioridad es que la vigente quede correcta — un archivo huérfano se
  // registra y se puede limpiar después, una planeación equivocada no.
  async function limpiarArchivoAnterior() {
    try {
      const token = await auth.currentUser.getIdToken()
      const res = await fetch(apiUrl('/api/subject/delete-planeacion-archivo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subjectId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
    } catch (err) {
      console.warn(`[planeación ${subjectId}] no se pudo borrar el archivo anterior de Cloudinary:`, err.message)
    }
  }

  // La planeación propia del docente pasa a ser la ÚNICA vigente. El orden
  // importa: primero se sube el archivo nuevo (si eso falla no se toca nada),
  // después una sola escritura atómica que deja la vigente y marca la
  // anterior para borrar, y hasta el final el borrado en Cloudinary. En
  // ningún instante hay dos planeaciones vigentes.
  async function sustituirPorArchivo(file) {
    setSubiendoArchivo(true)
    try {
      const url = await uploadToCloudinary(file, PLANEACION_CARPETA)
      const anterior = vigenteArchivo ? vigente.archivo : null
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: {
          origen: 'archivo',
          aceptadaEn: serverTimestamp(),
          archivo: {
            nombre: file.name,
            tipo: extensionPlaneacion(file.name),
            url,
            tamano: file.size,
            subidoEn: serverTimestamp(),
          },
        },
        // La copia editable de una generación de IA deja de tener sentido en
        // cuanto la vigente es un archivo del docente.
        planeacionBorrador: null,
        // Tumba para el recolector: el servidor lee de AQUÍ la URL real que
        // debe borrar, nunca de lo que mande el cliente. No es una segunda
        // planeación — el resolver ni la mira.
        planeacionArchivoPorBorrar: anterior || null,
      })
      setArchivoPorConfirmar(null)
      toast('Ya es tu planeación vigente')
      if (anterior) limpiarArchivoAnterior()
    } catch (err) {
      toast('No se pudo subir la planeación: ' + err.message, 'error')
    } finally {
      setSubiendoArchivo(false)
    }
  }

  // Quita la planeación vigente y sus borradores — sea de IA o un archivo
  // propio. Irreversible desde aquí: no hay forma de recuperar cuál era
  // (pedido de Kike, 15-ago-2026). No borra la bitácora `planeacionesIA`,
  // que es inmutable por regla, a propósito.
  async function quitarPlaneacion() {
    setReiniciando(true)
    try {
      const anterior = vigenteArchivo ? vigente.archivo : null
      await updateDoc(doc(db, 'subjects', subjectId), {
        planeacionAceptada: null,
        planeacionBorrador: null,
        planeacionArchivoPorBorrar: anterior || null,
      })
      toast(anterior
        ? 'Tu archivo se quitó — ya puedes generar la planeación con Evalúa Fácil'
        : 'Planeación eliminada — ya puedes generar una nueva')
      if (anterior) limpiarArchivoAnterior()
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error')
    } finally {
      setReiniciando(false)
      setConfirmarReiniciar(false)
    }
  }

  // El archivo ya viene validado (formato, tamaño, no vacío) desde
  // SelectorArchivoPlaneacion. Solo se pide confirmación cuando hay algo que
  // sustituir: si la asignatura no tiene nada, subirlo es la acción misma y
  // un modal de más solo estorbaría.
  function elegirArchivo(file) {
    if (vigente || pendiente) setArchivoPorConfirmar(file)
    else sustituirPorArchivo(file)
  }

  // Qué se pierde exactamente al sustituir. Se dice con precisión: la
  // bitácora `planeacionesIA` es inmutable y NO se borra, así que no se
  // afirma que "se elimina" lo que en realidad sigue guardado — lo que sí se
  // pierde son las correcciones que el docente hizo al aceptar.
  function mensajeConfirmarArchivo() {
    const nuevo = `"${archivoPorConfirmar?.name}"`
    if (vigenteArchivo) {
      return `El archivo "${vigente.archivo?.nombre}" dejará de ser tu planeación y se eliminará de Evalúa Fácil. `
        + `En su lugar, ${nuevo} quedará como la única planeación vigente de esta asignatura.`
    }
    if (vigenteIA) {
      return `${nuevo} pasará a ser la única planeación vigente de esta asignatura. La planeación que generó `
        + 'Evalúa Fácil dejará de estar vigente y no se usará en ningún otro flujo; las correcciones que le hiciste '
        + 'al aceptarla se pierden y no se pueden recuperar. Subir tu archivo no consume créditos.'
    }
    return `${nuevo} pasará a ser la única planeación vigente de esta asignatura. La planeación que Evalúa Fácil `
      + 'generó y que está pendiente de tu revisión dejará de mostrarse mientras tu archivo sea la vigente. '
      + 'No se te vuelven a cobrar créditos por esto.'
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

  // Una vez vigente, la Planeación queda BLOQUEADA — de solo lectura,
  // nunca editable (regla permanente de Kike). Por eso ya no hay una copia
  // "editable de la vigente": la vista de solo lectura usa directamente
  // `contenidoAceptado`.
  const contenidoActivo = vigenteIA ? contenidoAceptado : edicion
  const secuenciasActivo = secuenciasDeParcial(parcialActivo, contenidoActivo?.porParcial)
  const sumaParcialActivo = sumaPonderacionesParcial(secuenciasActivo)
  // Antes de aceptar, TODOS los parciales deben sumar exactamente 100% —
  // no solo el que se esté viendo en ese momento (Kike, 16-ago-2026: "no
  // permitir aceptar una Planeación cuya suma de ponderaciones no sea
  // exactamente 100%").
  const parcialesConPonderacionMal = !vigente
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
    if (!vigenteIA && !pendiente) return
    setCargandoVistaPrevia(true)
    setVerRevision(true)
    try {
      const numero = numeroParcial ?? parcialActivo
      const contenido = vigenteIA ? contenidoAceptado : (edicion || extraerContenido(pendiente))
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

  // Se llama en cuanto `pendiente` de verdad refleja la generación recién
  // hecha (ver `generar()` — no se puede abrir en el mismo instante porque
  // el listener de Firestore todavía trae los datos del ciclo anterior).
  useEffect(() => {
    if (abrirTrasGenerar && pendiente) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- solo apaga la bandera que disparó este mismo efecto, no encadena renders externos
      setAbrirTrasGenerar(false)
      abrirVistaPrevia()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abrirVistaPrevia se redefine cada render, no es una dependencia real
  }, [abrirTrasGenerar, pendiente])

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
        // La edición NUNCA se activa una vez que la planeación es vigente
        // (queda bloqueada, de solo lectura) — y solo se activa en escritorio
        // mientras no se ha aceptado (en celular la Vista previa se deja de
        // solo lectura, ver AvisoRevisionDesktop).
        if (vigente || !isDesktop || !vistaPreviaRef.current) return
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
      {/* Una sola planeación vigente, siempre: lo que se muestra depende de
          su ORIGEN, y los dos bloques son excluyentes — nunca se ven dos
          planeaciones como alternativas activas. */}
      {vigenteArchivo ? (
        <PlaneacionPropiaCard
          archivo={vigente.archivo}
          aceptadaEn={vigente.aceptadaEn}
          subiendo={subiendoArchivo}
          onElegirReemplazo={elegirArchivo}
          onArchivoInvalido={(mensaje) => toast(mensaje, 'error')}
          onGenerarIA={() => setConfirmarReiniciar(true)}
        />
      ) : (
        <>
          {vigenteIA ? (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-green-700">Vigente: generada por Evalúa Fácil — la usa la IA para todo lo demás</span>
              {fechaAceptada?.toDate && ` · ${fechaAceptada.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </p>
          ) : !pendiente ? (
            <p className="text-sm text-on-surface mb-2">
              <span className="font-medium">¿Cómo quieres trabajar tu planeación?</span>{' '}
              <span className="text-muted">Elige una de las dos — esta asignatura tendrá una sola planeación.</span>
            </p>
          ) : (
            <p className="text-xs text-muted mb-2">
              Estado: <span className="font-medium text-amber-700">Generada, sin aceptar todavía</span>
              {pendiente.generadoEn?.toDate && ` · ${pendiente.generadoEn.toDate().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}
              . No podrás descargarla hasta aceptarla.
              <span className="block font-semibold text-red-600 mt-1">Revísala y acéptala para continuar.</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* El camino de IA es el ÚNICO que pide Perfil IA. Sin él el
                botón se deshabilita y el aviso de abajo dice por qué — antes
                esto escondía la pestaña entera, y con ella el camino de subir
                la planeación propia, que no usa IA para nada. */}
            {!vigenteIA && (
              <button
                type="button"
                onClick={() => (nuncaAprobado ? onPago() : setConfirmando(true))}
                disabled={generando || !perfilIACompleto}
                title={!perfilIACompleto ? 'Completa tu Perfil para IA del docente para generar con Evalúa Fácil' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-outline-variant text-sm text-accent hover:bg-[var(--accent-tint)] disabled:opacity-60"
              >
                {generando ? <Spinner size="sm" /> : nuncaAprobado ? <Lock size={14} /> : pendiente ? <RotateCcw size={14} /> : <Sparkles size={14} />}
                {pendiente ? 'Generar de nuevo (con IA)' : 'Que Evalúa Fácil la genere'}
              </button>
            )}
            {/* Subir la planeación propia: siempre disponible mientras la
                vigente no sea ya un archivo (ese caso lo cubre
                PlaneacionPropiaCard con "Reemplazar archivo"). */}
            <SelectorArchivoPlaneacion
              label={vigenteIA || pendiente ? 'Usar mi propia planeación' : 'Ya tengo mi planeación'}
              ocupado={subiendoArchivo}
              onElegido={elegirArchivo}
              onInvalido={(mensaje) => toast(mensaje, 'error')}
            />
            {pendiente && isDesktop && (
              <button
                type="button"
                onClick={() => abrirVistaPrevia()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-green-600 text-green-700 text-sm hover:bg-green-50"
              >
                <ThumbsUp size={14} />
                Vista previa y edición
              </button>
            )}
            {vigenteIA && (
              <button
                type="button"
                onClick={() => abrirVistaPrevia()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface text-sm hover:bg-[var(--accent-tint)]"
              >
                <Eye size={14} />
                Vista previa
              </button>
            )}
            {vigenteIA && (
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

          {!vigenteIA && !perfilIACompleto && (
            <div className="mt-2">
              <AvisoPerfilIA que="generar la planeación con Evalúa Fácil" />
            </div>
          )}

          {!vigente && !pendiente && (
            <p className="text-xs text-muted mt-2">
              Generarla con Evalúa Fácil consume créditos de IA. Subir la tuya es gratis: se guarda tal como está,
              no se analiza y no necesita tu Perfil para IA.
            </p>
          )}

          {vigenteIA && (
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
          {pendiente && !isDesktop && <AvisoRevisionDesktop />}
        </>
      )}
      {verRevision && (isDesktop || vigenteIA) && (
        <RevisionPantallaCompleta
          titulo={`Planeación — ${asignaturaNombre}${vigenteIA ? ' (vigente, solo lectura)' : ''}`}
          onCerrar={cerrarRevision}
          cerrarTexto={!vigente ? 'Salir y aceptar luego' : null}
          tabs={(
            <>
              <SelectorParcial porParcial={contenidoActivo?.porParcial} activo={parcialActivo} onCambiar={cambiarParcialRevision} />
              {!vigente && (
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
          acciones={isDesktop && !vigente && (
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
                Aceptar esta planeación como la de mi asignatura
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
          title="¿Aceptar esta Planeación Didáctica?"
          message="Se guarda con las correcciones que hayas hecho, en TODOS los parciales. Cuando la aceptes queda fija como la planeación de esta asignatura, con la fecha de hoy, en modo de solo lectura — ya no podrás editarla directamente. Podrás verla y descargarla las veces que quieras, generar una nueva, o sustituirla por tu propio archivo si prefieres."
          confirmLabel="Aceptar"
          confirmingLabel="Aceptando…"
          busy={aceptando}
          onConfirm={aceptar}
          onCancel={() => { if (!aceptando) setConfirmarAceptar(false) }}
        />
      )}

      {/* Sustituir la planeación vigente por el archivo del docente. El
          archivo TODAVÍA no se ha subido: primero confirma, después se sube y
          hasta entonces se escribe la vigente (ver sustituirPorArchivo). */}
      {archivoPorConfirmar && (
        <ConfirmModal
          title={vigenteArchivo ? '¿Reemplazar tu planeación?' : '¿Usar tu propia planeación?'}
          message={mensajeConfirmarArchivo()}
          confirmLabel={vigenteArchivo ? 'Reemplazar' : 'Sí, usar la mía'}
          confirmingLabel="Subiendo…"
          busy={subiendoArchivo}
          onConfirm={() => sustituirPorArchivo(archivoPorConfirmar)}
          onCancel={() => { if (!subiendoArchivo) setArchivoPorConfirmar(null) }}
        />
      )}

      {confirmarReiniciar && (
        <ConfirmModal
          title={vigenteArchivo ? '¿Quitar tu planeación y generar una con Evalúa Fácil?' : '¿Generar una planeación nueva?'}
          message={vigenteArchivo
            ? `Tu archivo "${vigente.archivo?.nombre}" dejará de ser la planeación vigente y se eliminará de Evalúa Fácil — asegúrate de tenerlo guardado en tu computadora, porque desde aquí no se puede recuperar. Después podrás generar la planeación con Evalúa Fácil, que sí consume créditos de IA.`
            : 'La planeación vigente de esta asignatura dejará de serlo de forma irreversible — no podrás volver a ella desde aquí. En su lugar podrás generar y editar una completamente nueva.'}
          confirmLabel={vigenteArchivo ? 'Quitar mi archivo' : 'Eliminar y empezar de nuevo'}
          confirmingLabel="Quitando…"
          busy={reiniciando}
          onConfirm={quitarPlaneacion}
          onCancel={() => { if (!reiniciando) setConfirmarReiniciar(false) }}
        />
      )}
    </div>
  )
}
