import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  collection, query, where, getDocs, getDoc,
  doc, serverTimestamp, deleteField, arrayUnion, arrayRemove,
} from 'firebase/firestore'
// Las escrituras pasan por el candado de suscripción vencida (mismos nombres y
// firmas que 'firebase/firestore'); leer sigue siendo directo.
import { addDoc, updateDoc, deleteDoc, writeBatch } from '../../utils/firestoreGuard'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/Spinner'
import { exportSubjectGrades, exportParcialGrades, exportRankingExcel, exportSubjectAttendance, exportParcialAttendance, parseStudentExcel, downloadStudentTemplate } from '../../utils/excel'
import { importActivitiesToSubject } from '../../utils/importActivities'
import { exportSubjectGradesPDF, exportParcialGradesPDF, exportRankingPDF, exportCredentialsPDF } from '../../utils/pdf'
import { buildJobsForSubject, downloadSubmissionsZip } from '../../utils/downloadSubmissions'
import { deleteSubjectCascade, deleteSubjectStudents, deleteSubmissionsByStudent, deleteSubmissionsByActivity } from '../../utils/deleteSubjectCascade'
import { copySubject } from '../../utils/copySubject'
import { fmtAttDateParts, fmtAttDateLong, fmtAttMonth, loadAttendanceRecords, createAttendanceDay, attendanceState, nextAttendanceState, setAttendanceState, countPresence, deleteAttendanceDay, enrolledFromDate } from '../../utils/attendance'
import { syncAutoAttendanceDays, loadAsuetoVacacionDiasClase, fetchClaseDiasSemana } from '../../utils/attendanceAuto'
import { diaSemanaLunes, DIAS_SEMANA, derivarPatrones, tramosFaltantes, generarBloques } from '../../utils/horarioBloques'
import { buildAsuetoMap, esAsuetoPara } from '../../utils/asuetos'
import { buildVacacionMap, fechasVacacionParaClases } from '../../utils/vacaciones'
import { lockLandscape, lockPortrait } from '../../utils/orientation'
import { hideStatusBar, showStatusBar } from '../../utils/statusBar'
import { activityVisibilityState, formatDeadline, formatPublishAt, withDefaultTime, isDraftActivity } from '../../utils/activityVisibility'
import { pesoDe, promedioParcial, ponderacionActivaEnParcial, normalizeGrade } from '../../utils/ponderacion'
import { showNear, playAlertSound } from '../../utils/notify'
import { subjectDisplayName } from '../../utils/subjectName'
import { formatShortDate, formatShortDateRange } from '../../utils/dateRange'
import { IS_NATIVE_APP } from '../../utils/platform'
import { descargaSoloWeb } from '../../utils/descargaSoloWeb'
import PaletteSelect from '../../components/PaletteSelect'
import { subjectPaletteProps } from '../../utils/subjectPalette'
import IconSelect from '../../components/IconSelect'
import SubjectIcon from '../../components/SubjectIcon'
import FileTypeSelect from '../../components/FileTypeSelect'
import RichTextEditor from '../../components/RichTextEditor'
import VisibilitySelect from '../../components/VisibilitySelect'
import EFDateTimePicker from '../../components/EFDateTimePicker'
import ParcialesFechas, { normalizeParcialesFechas, addOneDay } from '../../components/ParcialesFechas'
import { minDeadline } from '../../utils/nowIso'
import FileDropzone from '../../components/FileDropzone'
import { htmlToPlainText, sanitizeHtml, toRichHtml, richTextContentClass } from '../../utils/sanitizeHtml'
import { DEFAULT_FILE_TYPE, CUSTOM_FILE_TYPE, normalizeFileTypeKeys, parseCustomExts } from '../../config/fileTypes'
import { TEACHER_CONTAINER, TEACHER_CONTAINER_NARROW } from '../../config/layout'
import { uploadToCloudinary, downloadUrl, isImageDeliveredPdf, pdfPageImageUrl } from '../../utils/cloudinary'
import { RESOURCE_ACCEPT, getResourceIcon, getLinkResourceIcon, isResourceFileAllowed } from '../../utils/resourceTypes'
import { formatFileSize } from '../../utils/formatBytes'
import AttachmentList, { FilePreviewModal, canPreviewFile } from '../../components/AttachmentList'
import SearchInput from '../../components/SearchInput'
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, FileText, Clock,
  CheckCircle, X, Pencil, Trash2, Archive, ArchiveRestore,
  FileSpreadsheet,
  ArrowUpDown, UserPlus, RotateCcw, Upload, Download, ChevronRight,
  Check as CheckIcon, KeyRound, Copy,
  Eye, EyeOff, FileSearch, ExternalLink, BookOpen, Paperclip, FileCheck2, Timer,
  ListChecks, GraduationCap, ClipboardCheck, MoreVertical, Lock, CalendarPlus,
  AlertTriangle, ArrowUp, ArrowDown,
} from 'lucide-react'
import { generateUsername } from '../../utils/generate'
import { findStudentIdentity, studentNameKey } from '../../utils/studentIdentity'
import { matchesStudentSearch, studentFullName } from '../../utils/studentSearch'
import { useSubscription } from '../../hooks/useSubscription'
import { useBackHandler } from '../../hooks/useBackHandler'
import { useScrollLock } from '../../hooks/useScrollLock'
import EvaluacionEditor from '../../components/EvaluacionEditor'
import EntregableEditor from '../../components/EntregableEditor'
import NuevaFechaEntregaModal from '../../components/NuevaFechaEntregaModal'
import AvisosTab from '../../components/subject/AvisosTab'
import { canCreateContent, hasCleanExports } from '../../utils/subscriptionHelpers'
import ConfirmModal from '../../components/ConfirmModal'

async function fetchSubmissionsForActivities(actIds) {
  if (actIds.length === 0) return []
  const chunks = []
  for (let i = 0; i < actIds.length; i += 30) chunks.push(actIds.slice(i, i + 30))
  const snaps = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, 'submissions'), where('actividadId', 'in', ids)))
    )
  )
  return snaps.flatMap((s) => s.docs)
}

const EMPTY_FORM = { nombre: '', categoria: 'entregable', instrucciones: '', fechaLimite: '', recibirTarde: false, tiposArchivo: [DEFAULT_FILE_TYPE], extensionesCustom: '', oculta: false, publishAt: '', publishedAt: '', visibilidadMode: 'show', esEvaluacion: false }

// Defaults for a new evaluación's config — Cuestionario favors repeated
// practice (unlimited attempts, keep best); Examen favors a single formal
// attempt (1 try, keep last). The teacher can change all of this afterward.
const EVALUACION_DEFAULTS = {
  cuestionario: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'libre',
    tiempoLimiteMin: null, intentosPermitidos: null, conservar: 'mejor',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
  examen: {
    numPreguntas: 0, ordenPreguntas: 'creacion', navegacion: 'secuencial',
    tiempoLimiteMin: 30, intentosPermitidos: 1, conservar: 'ultimo',
    publicarResultados: 'inmediato', publicarResultadosFecha: null, resultadosPublicados: false,
    mostrarRetroalimentacion: true, mostrarRespuestasCorrectas: false, mostrarPorcentaje: true, barajarRespuestas: false,
  },
}

function formatResourceDate(ts) {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Resources are course material (PDFs, decks, spreadsheets), typically
// heavier than a single submission file — a higher cap than the 5 MB used
// for student deliveries (src/pages/student/ActivityPage.jsx).
const MAX_RESOURCE_SIZE = 15 * 1024 * 1024
// Shared by "Material de apoyo" files AND activity-instruction attachments:
// both allow any file type (no extension whitelist, unlike the Recursos tab)
// and any number of files — only the per-file size is capped, same ceiling
// already proven for the Recursos tab's Cloudinary preset.
const MAX_ATTACHMENT_FILE_SIZE = 15 * 1024 * 1024
const EMPTY_MATERIAL_FORM = { nombre: '', descripcion: '', oculta: false, publishAt: '', visibilidadMode: 'show' }

function gradeColor(norm) {
  if (norm === null) return 'text-slate-300'
  if (norm >= 8) return 'text-emerald-700'
  if (norm >= 6) return 'text-amber-600'
  return 'text-red-500'
}

// Tabla de asistencias compartida por la vista web y la vista horizontal de la
// app. En la app se ocultan las columnas de Totales (esos se ven en la web) y
// el encabezado queda fijo (sticky) para que solo scrolleen los datos.
//
// Extraída a un componente propio (con React.memo) a propósito: envolver el
// JSX en useMemo() DENTRO de SubjectPage NO bastaba — medido con datos reales
// (52 alumnos × 36 columnas), abrir/cerrar el modal de Justificación seguía
// tardando 500-950ms porque React igual reconciliaba el árbol completo de la
// tabla en cada cambio de estado no relacionado (reasonModal, reasonText).
// Solo un componente separado envuelto en memo() logra que React se salte
// por completo esa reconciliación cuando sus props no cambian. Para que el
// memo funcione de verdad, los callbacks que recibe deben tener identidad
// ESTABLE entre renders (ver useCallback en SubjectPage) — si no, memo()
// vería "props nuevas" en cada render y el problema seguiría igual.
const AttendanceTable = memo(function AttendanceTable({
  attendanceParciales, filteredAttendanceStudents, attendanceAllRecords,
  onCellClick,
  onDeleteDay, onBack, onAddDay, addDayLabel, // addDayLabel null = ya no hace falta (todo automático y sin días faltantes) → botón oculto
  lastEditedCell, // "recordId:studentId" — la última celda revisada/modificada, resaltada de forma persistente
  parcialesFechas, // subject.parcialesFechas — fecha corta bajo "Parcial N", si existe
}) {
  // Nodos DOM cacheados por columna/día para el efecto de cruz (fila+columna)
  // — resaltado con classList directo, sin state ni CSS :has() (ambos
  // resultaron más lentos: state re-renderiza toda la tabla, :has(:hover)
  // obliga al navegador a re-evaluarla completa en cada pixel de movimiento).
  const attColElsRef = useRef(new Map())
  const attDayElRef = useRef(new Map())
  const attLastHoverRef = useRef({ col: null, day: null })
  const attActiveCellRef = useRef(null)

  const dayColW = IS_NATIVE_APP ? 'w-[74px]' : 'w-9'   // columnas de asistencia más anchas en la app — pedido explícito, +15% sobre los 64px anteriores
  const cellPadY = IS_NATIVE_APP ? 'py-[4.8px]' : 'py-1' // renglones 20% menos altos que antes (52px→41.6px) sin achicar el ícono de 32px — pedido explícito
  const cellIconSize = IS_NATIVE_APP ? 'w-8 h-8' : 'w-6 h-6' // símbolo más grande en la app, a juego con la celda más ancha
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const attColIndexById = {}
  const attColToDay = {}
  let _attCol = 0
  attendanceParciales.forEach((g) => {
    g.days.forEach(({ fecha, records }) => {
      records.forEach((r) => { attColIndexById[r.id] = _attCol; attColToDay[_attCol] = fecha; _attCol++ })
    })
  })
  const addAttColEl = (col) => (el) => {
    if (!el) return
    const arr = attColElsRef.current.get(col) || []
    arr.push(el)
    attColElsRef.current.set(col, arr)
  }
  const setAttDayEl = (fecha) => (el) => { if (el) attDayElRef.current.set(fecha, el) }
  const clearAttHighlight = () => {
    const { col, day } = attLastHoverRef.current
    if (col != null) (attColElsRef.current.get(col) || []).forEach((el) => el.classList.remove('att-col-hover'))
    if (day != null) attDayElRef.current.get(day)?.classList.remove('att-day-hover')
    attActiveCellRef.current?.classList.remove('att-cell-active')
    attActiveCellRef.current = null
    attLastHoverRef.current = { col: null, day: null }
  }
  // La celda exacta (fila+columna) se rastrea por identidad de nodo, no solo
  // por columna, para que el resaltado "fuerte" se mueva también al cambiar
  // de fila dentro de la misma columna.
  const handleAttHover = (e) => {
    const cellEl = e.target.closest('[data-col]')
    if (cellEl === attActiveCellRef.current) return
    const col = cellEl ? Number(cellEl.getAttribute('data-col')) : null
    if (col !== attLastHoverRef.current.col) {
      if (attLastHoverRef.current.col != null) (attColElsRef.current.get(attLastHoverRef.current.col) || []).forEach((el) => el.classList.remove('att-col-hover'))
      if (attLastHoverRef.current.day != null) attDayElRef.current.get(attLastHoverRef.current.day)?.classList.remove('att-day-hover')
      const day = col != null ? (attColToDay[col] ?? null) : null
      if (col != null) (attColElsRef.current.get(col) || []).forEach((el) => el.classList.add('att-col-hover'))
      if (day != null) attDayElRef.current.get(day)?.classList.add('att-day-hover')
      attLastHoverRef.current = { col, day }
    }
    attActiveCellRef.current?.classList.remove('att-cell-active')
    attActiveCellRef.current = cellEl?.classList.contains('att-cell') ? cellEl : null
    attActiveCellRef.current?.classList.add('att-cell-active')
  }

  // Precalienta el hover: recorre cada columna/día en tiempo ocioso
  // (add+remove inmediato, invisible) para que el navegador ya haya resuelto
  // estilo/paint de esas celdas ANTES de que el docente mueva el mouse de
  // verdad — si no, cada columna nueva paga ese costo la primera vez que se
  // toca en vivo, sintiéndose como una pausa a mitad del recorrido.
  useEffect(() => {
    const warmUp = () => {
      attColElsRef.current.forEach((els) => {
        els.forEach((el) => { el.classList.add('att-col-hover'); el.classList.remove('att-col-hover') })
      })
      attDayElRef.current.forEach((el) => { el.classList.add('att-day-hover'); el.classList.remove('att-day-hover') })
    }
    const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 200)
    const cic = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout
    const id = ric(warmUp)
    return () => cic(id)
  }, [attendanceParciales, filteredAttendanceStudents])

  return (
  <table onMouseOver={handleAttHover} onFocus={handleAttHover} onMouseLeave={clearAttHighlight}
    className={`${IS_NATIVE_APP ? 'text-[11px]' : 'text-xs'} border-collapse table-fixed`}>
    <colgroup>
      <col className="w-8" />
      <col className="w-[210px]" />
      {attendanceParciales.flatMap((g) => [
        ...g.days.flatMap(({ records }) => records.map((r) => <col key={r.id} className={dayColW} />)),
        <col key={`ca-${g.parcial}`} className="w-10" />,
        <col key={`ci-${g.parcial}`} className="w-10" />,
      ])}
      {!IS_NATIVE_APP && <col className="w-10" />}
      {!IS_NATIVE_APP && <col className="w-10" />}
    </colgroup>
    <thead className="sticky top-0 z-30 bg-accent-light">
      {/* Fila de parcial — nivel superior, abarca sus días + su resumen */}
      <tr className="bg-accent-light border-b border-outline-variant">
        {IS_NATIVE_APP ? (
          /* Esquina fija: Regresar + ASISTENCIAS + Agregar día en UNA sola celda
             (sin línea divisoria), para darle más ancho al botón de regresar. */
          <th colSpan={2} rowSpan={2} className="sticky left-0 z-30 bg-accent-light px-2 align-middle border-r border-outline-variant">
            <div className="flex items-center gap-2">
              {/* Verde fosforescente con flecha negra — que se note dónde se
                  regresa (pedido explícito) */}
              <button type="button" onClick={onBack} aria-label="Regresar"
                className="flex-none px-2.5 py-1 -ml-1 rounded bg-[#39FF14] text-black hover:bg-[#2ee510] transition-colors">
                <ArrowLeft size={20} />
              </button>
              <span className="text-xs font-bold text-on-surface uppercase tracking-wide">Asistencias</span>
              {addDayLabel && (
                <button type="button" onClick={onAddDay}
                  className="ml-auto flex items-center gap-1 px-2 py-1 bg-accent text-white text-[11px] font-medium rounded hover:bg-accent-hover transition-colors">
                  <CalendarPlus size={13} /> {addDayLabel}
                </button>
              )}
            </div>
          </th>
        ) : (
          <>
            <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant" />
            <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-1 border-r border-outline-variant" />
          </>
        )}
        {attendanceParciales.map((g) => (
          <th key={g.parcial} colSpan={g.slotCount + 2}
            className="px-1 py-1 font-bold text-accent text-center text-[11px] uppercase tracking-wide border-l-2 border-outline whitespace-nowrap">
            Parcial {g.parcial}
            {parcialesFechas?.[g.parcial - 1] && (
              <span className="block text-[9px] font-normal text-slate-400 normal-case tabular-nums">
                ({formatShortDate(parcialesFechas[g.parcial - 1].inicio)}–{formatShortDate(parcialesFechas[g.parcial - 1].fin)})
              </span>
            )}
          </th>
        ))}
        {!IS_NATIVE_APP && (
          <th colSpan={2}
            className="px-1 py-1 font-bold text-accent text-center text-[11px] uppercase tracking-wide border-l-2 border-outline whitespace-nowrap">
            Totales
          </th>
        )}
      </tr>
      {/* Fila de mes — celda "Mes Año" que abarca sus días */}
      <tr className="bg-accent-light/70 border-b border-outline-variant">
        {!IS_NATIVE_APP && (
          <>
            <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant" />
            <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-1 border-r border-outline-variant" />
          </>
        )}
        {attendanceParciales.flatMap((g) => [
          ...g.months.map((mo) => (
            <th key={`m-${g.parcial}-${mo.ym}`} colSpan={mo.days.reduce((n, d) => n + d.records.length, 0)}
              className="px-1 py-0.5 font-semibold text-accent text-center text-[10px] border-l border-outline-variant whitespace-nowrap">
              {fmtAttMonth(mo.ym)}
            </th>
          )),
          <th key={`res-${g.parcial}`} colSpan={2}
            className="px-0.5 py-0.5 text-center text-[9px] font-semibold text-muted uppercase border-l-2 border-outline">
            Resumen
          </th>,
        ])}
        {!IS_NATIVE_APP && <th colSpan={2} className="border-l-2 border-outline" />}
      </tr>
      {/* Fila de día — número de cada día + encabezados de las columnas de conteo */}
      <tr className="bg-accent-light/60 border-b border-outline-variant">
        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1 border-r border-outline-variant" />
        <th className={`sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-1 ${IS_NATIVE_APP ? 'text-left' : 'text-right'} text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant truncate`}>
          {IS_NATIVE_APP ? 'Estudiante / Día:' : 'Día:'}
        </th>
        {attendanceParciales.flatMap((g) => [
          ...g.days.map(({ fecha, records }) => {
            const { dia, mes, anio } = fmtAttDateParts(fecha)
            return (
              <th key={fecha} colSpan={records.length}
                ref={setAttDayEl(fecha)}
                onClick={() => onDeleteDay(fecha)}
                data-tooltip={IS_NATIVE_APP
                  ? `Eliminar la asistencia del ${dia}/${mes}/${anio}`
                  : `Eliminar la asistencia del ${fmtAttDateLong(fecha)}`}
                className={`px-0.5 py-1 font-semibold text-center border-l border-outline-variant cursor-pointer transition-colors tabular-nums ${fecha === todayISO ? 'bg-accent text-white' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
                {dia}
              </th>
            )
          }),
          <th key={`ha-${g.parcial}`} data-tooltip="Asistencias del parcial"
            className="px-0.5 py-1 text-center border-l-2 border-outline">
            <CheckIcon size={13} className="inline text-green-600" />
          </th>,
          <th key={`hi-${g.parcial}`} data-tooltip="Faltas del parcial"
            className="px-0.5 py-1 text-center">
            <X size={13} className="inline text-red-500" />
          </th>,
        ])}
        {!IS_NATIVE_APP && (
          <>
            <th data-tooltip="Total de asistencias" className="px-0.5 py-1 text-center border-l-2 border-outline">
              <CheckIcon size={13} className="inline text-green-600" />
            </th>
            <th data-tooltip="Total de faltas" className="px-0.5 py-1 text-center">
              <X size={13} className="inline text-red-500" />
            </th>
          </>
        )}
      </tr>
      {/* Renglón de sesión — solo web; en la app se oculta para ganar espacio.
          La etiqueta "Estudiante" pasa al renglón de Día (Estudiante / Día:). */}
      {!IS_NATIVE_APP && (
        <tr className="bg-accent-light/50 border-b border-outline-variant">
          <th className="sticky left-0 z-10 bg-accent-light w-8 border-r border-outline-variant" />
          <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-0.5 text-left text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant truncate">
            Estudiante / Número de la sesión
          </th>
          {attendanceParciales.flatMap((g) => [
            ...g.days.flatMap(({ fecha, records }) => records.map((r) => (
              <th key={r.id} data-col={attColIndexById[r.id]} ref={addAttColEl(attColIndexById[r.id])} className={`w-9 px-0.5 py-0.5 text-center text-[10px] font-medium text-muted border-l border-outline-variant ${fecha === todayISO ? 'bg-accent-light' : ''}`}>
                {records.length > 1 ? r.slot : ''}
              </th>
            ))),
            <th key={`sa-${g.parcial}`} className="border-l-2 border-outline" />,
            <th key={`si-${g.parcial}`} />,
          ])}
          <th className="border-l-2 border-outline" />
          <th />
        </tr>
      )}
    </thead>
    <tbody>
      {filteredAttendanceStudents.map((s, i) => {
        const enrolledFrom = enrolledFromDate(s)
        const total = countPresence(attendanceAllRecords, s.id, enrolledFrom)
        return (
        <tr key={s.id} className={`group border-t border-outline-variant transition-colors duration-200 hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? '' : 'bg-slate-50'}`}>
          <td className={`sticky left-0 z-10 w-8 px-1 py-1 text-center text-slate-400 border-r border-outline-variant transition-colors duration-200 group-hover:bg-[var(--accent-tint-solid)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50'}`}>
            {s.orden}
          </td>
          <td className={`sticky left-8 z-10 w-[210px] px-2 py-1 ${IS_NATIVE_APP ? 'text-[12px]' : 'text-sm'} font-medium text-on-surface border-r border-outline-variant truncate transition-colors duration-200 group-hover:bg-[var(--accent-tint-solid)] ${i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50'}`}>
            {studentFullName(s)}
          </td>
          {attendanceParciales.flatMap((g) => {
            const { asist, inasist } = countPresence(g.records, s.id, enrolledFrom)
            return [
              ...g.days.flatMap(({ fecha, records }) => records.map((r) => {
                // Día anterior a que el alumno se inscribiera: ni presente ni
                // falta, no aplica — sin esto, isPresente() lo contaba como
                // asistencia (trata como presente cualquier alumno sin llave
                // en `presentes`) para clases a las que nunca pudo faltar
                // porque todavía no era parte de la asignatura.
                const esAntesDeInscribirse = enrolledFrom && fecha < enrolledFrom
                const estado = esAntesDeInscribirse ? null : attendanceState(r, s.id)
                const motivo = estado === 'justificada' ? (r.motivos?.[s.id] || '') : ''
                const ui = {
                  presente: { cls: 'bg-green-100 text-green-600', icon: <CheckIcon size={14} /> },
                  falta: { cls: 'bg-red-100 text-red-500', icon: <X size={14} /> },
                  justificada: { cls: 'bg-amber-100 text-amber-600', icon: <span className="text-[12px] font-bold leading-none">J</span> },
                }[estado]
                const esFuturo = fecha > todayISO
                // Sin tooltip por celda: la leyenda de abajo ya dice qué es cada
                // símbolo, y aquí se repetía en CADA cuadrito de la cuadrícula —
                // con el ratón cruzando la tabla, el globito no paraba de
                // aparecer justo encima de lo que se quería leer. Los días que
                // aún no llegan se distinguen solos: van atenuados y no se
                // pueden tocar.
                if (esAntesDeInscribirse) {
                  return (
                    <td key={r.id}
                      data-col={attColIndexById[r.id]}
                      ref={addAttColEl(attColIndexById[r.id])}
                      data-tooltip="Aún no estaba inscrito"
                      className={`att-cell ${dayColW} px-0.5 ${cellPadY} text-center border-l border-outline-variant select-none opacity-40 cursor-not-allowed`}>
                      <span className={`relative inline-flex items-center justify-center ${cellIconSize} rounded text-slate-300`}>—</span>
                    </td>
                  )
                }
                return (
                  <td key={r.id}
                    data-col={attColIndexById[r.id]}
                    ref={addAttColEl(attColIndexById[r.id])}
                    onClick={() => onCellClick(r, s)}
                    className={`att-cell ${dayColW} px-0.5 ${cellPadY} text-center border-l border-outline-variant select-none ${esFuturo ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${lastEditedCell === `${r.id}:${s.id}` ? 'ring-2 ring-inset ring-accent bg-[var(--accent-medium)]' : fecha === todayISO ? 'bg-accent-light' : ''}`}>
                    <span className={`relative inline-flex items-center justify-center ${cellIconSize} rounded ${ui.cls}`}>
                      {ui.icon}
                      {motivo && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </span>
                  </td>
                )
              })),
              <td key={`a-${g.parcial}`} className="px-0.5 py-1 text-center font-semibold text-green-600 tabular-nums bg-green-50 border-l-2 border-outline">
                {asist}
              </td>,
              <td key={`i-${g.parcial}`} className="px-0.5 py-1 text-center font-semibold text-red-500 tabular-nums bg-red-50">
                {inasist}
              </td>,
            ]
          })}
          {!IS_NATIVE_APP && (
            <>
              <td className="px-0.5 py-1 text-center font-bold text-green-600 tabular-nums bg-green-100/60 border-l-2 border-outline">
                {total.asist}
              </td>
              <td className="px-0.5 py-1 text-center font-bold text-red-500 tabular-nums bg-red-100/60">
                {total.inasist}
              </td>
            </>
          )}
        </tr>
        )
      })}
    </tbody>
  </table>
  )
})

// Botón partido "Excel/PDF" + ⋮ para exportar por parcial — rehecho desde
// cero. La versión anterior cerraba el menú con un botón invisible
// `fixed inset-0` puesto encima de TODA la pantalla al abrirse, compitiendo
// por el mismo gesto de clic que lo abría; reportado en producción como "no
// hace nada" sin ningún error en consola, y no se pudo reproducir de forma
// consistente para aislar la causa exacta. Ahora cada botón maneja su propio
// estado y usa el patrón estándar de "clic afuera cierra": un listener de
// `mousedown` en `document` que solo se instala mientras el menú está
// abierto y revisa si el clic cayó fuera de su propia caja — sin ningún
// elemento de pantalla completa de por medio.
function ExportSplitButton({ label, Icon, onMain, mainDisabled, mainTooltip, menuTooltip, menuLabel, parciales, onPickParcial }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onDocMouseDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    // capture:true — se entera del clic ANTES de que otro handler en el
    // camino (p. ej. otro menú cerrándose) pueda detener su propagación.
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [open])

  useBackHandler(() => setOpen(false), open)

  return (
    <div ref={boxRef} className="flex-1 min-w-0 relative flex">
      <button type="button"
        onClick={onMain}
        disabled={mainDisabled}
        data-tooltip={mainTooltip}
        className="flex-1 flex items-center justify-center gap-2 py-2 bg-[var(--accent-light)] border border-accent rounded-l text-sm font-semibold text-accent hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
      >
        {mainDisabled ? <Spinner size="sm" /> : <Icon size={17} />} {label}
      </button>
      <button type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} por parcial`}
        aria-expanded={open}
        data-tooltip={menuTooltip}
        className="px-2 bg-[var(--accent-light)] border border-l-0 border-accent rounded-r text-accent hover:bg-[var(--accent-medium)] transition-colors">
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute z-40 top-full mt-1 right-0 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">{menuLabel}</div>
          {parciales.map((p) => (
            <button key={p} type="button"
              onClick={() => { setOpen(false); onPickParcial(p) }}
              className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors">
              Parcial {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SubjectPage() {
  const { subjectId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const { subscription } = useSubscription()
  const canCreate = canCreateContent(subscription)
  // Sin suscripción activa (trial, vencida, cancelada, pendiente_pago) todas
  // las exportaciones PDF/Excel llevan marca de agua — pedido explícito.
  const exportsWatermarked = !hasCleanExports(subscription)
  // Resuelve la promesa de confirmExportNotice() — no-null mientras el aviso
  // está en pantalla. Un solo modal reutilizado por las 8 funciones de
  // exportación de este archivo, en vez de un estado por cada una.
  const [watermarkNoticeResolve, setWatermarkNoticeResolve] = useState(null)
  function confirmExportNotice() {
    if (!exportsWatermarked) return Promise.resolve(true)
    return new Promise((resolve) => setWatermarkNoticeResolve(() => resolve))
  }
  const [subject, setSubject] = useState(null)
  const [activities, setActivities] = useState([])
  const [submissionCounts, setSubmissionCounts] = useState({})
  // Conteo de estudiantes que trajo loadAll(). No se usa directo: ver
  // `totalStudents` más abajo, que es el que manda una vez cargada la lista.
  const [studentCountAtLoad, setStudentCountAtLoad] = useState(0)
  const [openParcial, setOpenParcial] = useState(1)

  // Activity modal
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState('create')
  const [modalParcial, setModalParcial] = useState(1)
  const [editActivityId, setEditActivityId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  // null = showing the tipo picker, 'entregable'|'cuestionario'|'examen' = form visible
  const [tipoActividad, setTipoActividad] = useState(null)
  // Full-screen evaluación editor (cuestionario / examen)
  const [evalEditor, setEvalEditor] = useState(null) // null | { activityId, categoria, parcial }
  // Full-screen entregable editor
  const [entregableEditor, setEntregableEditor] = useState(null) // null | { activityId, parcial, categoria, activityLabel, initialForm, initialExistingFiles }
  // "Nueva fecha de entrega" modal, offered from within entregableEditor once published
  const [newDateOpen, setNewDateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishDraftConfirm, setPublishDraftConfirm] = useState(null) // draft activity | null
  const [duplicateConfirm, setDuplicateConfirm] = useState(null) // activity | null
  const [duplicating, setDuplicating] = useState(false)
  // Cambiar de lugar una actividad dentro de su parcial: null | { a, newList, changes }
  // `changes` = actividades cuyo número (1.2., 1.3.…) cambia con el movimiento.
  const [moveConfirm, setMoveConfirm] = useState(null)
  const [moving, setMoving] = useState(false)
  // PONDERACIÓN: in-progress weight edits per activity id (committed on blur)
  const [pesoEdits, setPesoEdits] = useState({})
  // Anchored confirmation panel for reverting to simple average
  const [confirmRevertPonderacion, setConfirmRevertPonderacion] = useState(false)
  const [confirmRevertParcial, setConfirmRevertParcial] = useState(null) // parcial number | null
  // Cerrar parcial: null | { p, missing: [{s, a}], ungraded }
  const [closeParcialConfirm, setCloseParcialConfirm] = useState(null)
  const [closingParcial, setClosingParcial] = useState(false)
  // Grade applied to all no-entregas when closing a parcial (default 5)
  const [closeParcialGrade, setCloseParcialGrade] = useState('5')
  const [revertParcialConfirm, setRevertParcialConfirm] = useState(null) // parcial number | null
  const [revertingParcial, setRevertingParcial] = useState(false)
  // Kebab menu per parcial header: null | { p, x, y } (fixed coords from the ⋮ button)
  const [parcialMenu, setParcialMenu] = useState(null)
  // Asistencia — Excel split-button ⋮ dropdown (por parcial): boolean
  const [attExportMenu, setAttExportMenu] = useState(false)
  const [exportingAttendance, setExportingAttendance] = useState(false)
  // Activity-name tooltip over the grades-table number headers: null | { text, x, y }
  const [actTip, setActTip] = useState(null)
  // Per-activity ⋮ menu (Duplicar / Eliminar): null | { a, x, y }
  const [activityMenu, setActivityMenu] = useState(null)
  // "Traer actividad de otra asignatura" flow
  const [importFor, setImportFor] = useState(null)        // target parcial | null (modal open)
  const [importSubjects, setImportSubjects] = useState([]) // teacher's other subjects
  const [importSrc, setImportSrc] = useState(null)         // chosen source subject
  const [importSrcActs, setImportSrcActs] = useState([])   // that subject's activities
  const [importSel, setImportSel] = useState(new Set())    // selected activity ids
  const [importLoading, setImportLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  // Files attached to the activity's instructions (RichTextEditor's "Adjuntar
  // archivo" button) — support material for the alumno, NOT evidence: kept
  // entirely separate from `submissions`, never required, never graded.
  const [activityExistingFiles, setActivityExistingFiles] = useState([]) // [{url,nombre,tamano}]
  const [activityNewFiles, setActivityNewFiles] = useState([]) // File[] pending upload

  // Materials ("Material de apoyo") — independent of Activity: scoped per
  // parcial like activities, but never creates a submission/grade. Loaded
  // together with activities in loadAll() (not lazily, since it lives
  // inline in the Actividades tab, not behind its own tab).
  const [materials, setMaterials] = useState([])
  const [showMaterialModal, setShowMaterialModal] = useState(false)
  const [materialModalMode, setMaterialModalMode] = useState('create')
  const [materialParcial, setMaterialParcial] = useState(1)
  const [editMaterialId, setEditMaterialId] = useState(null)
  const [materialForm, setMaterialForm] = useState(EMPTY_MATERIAL_FORM)
  const [materialNewFiles, setMaterialNewFiles] = useState([]) // File[] pending upload
  const [materialExistingFiles, setMaterialExistingFiles] = useState([]) // [{url,nombre,tamano}] kept on edit
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [deleteMaterialConfirm, setDeleteMaterialConfirm] = useState(null)
  const [deletingMaterial, setDeletingMaterial] = useState(false)
  const [expandedMaterialId, setExpandedMaterialId] = useState(null)

  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportingGradesPdf, setExportingGradesPdf] = useState(false)
  const [generatingCredentials, setGeneratingCredentials] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [zipDownloading, setZipDownloading] = useState(false)
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 })

  // Activity visibility

  // Navigation state: puede pedir una pestaña concreta (al volver de calificar)
  // o abrir el modal de editar asignatura (al venir de "Programar bloques").
  const routerLocation = useLocation()

  // Subject CRUD
  // Arranca abierto si se llegó con `openEditSubject`: "Programar bloques" de
  // una asignatura SIN fechas ya no las pide allá, manda aquí, que es donde
  // viven (y de donde salen los periodos de cada parcial). Se inicializa aquí
  // y no en un efecto para no encadenar un render de más.
  const [showEditSubjectModal, setShowEditSubjectModal] = useState(
    () => !!routerLocation.state?.openEditSubject,
  )
  const [editSubjectForm, setEditSubjectForm] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [editingSubject, setEditingSubject] = useState(false)
  const [showDeleteSubjectConfirm, setShowDeleteSubjectConfirm] = useState(false)
  const [deleteSubjectConfirmText, setDeleteSubjectConfirmText] = useState('')
  const [deletingSubject, setDeletingSubject] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyForm, setCopyForm] = useState({ nombre: '', grupo: '', keepStudents: false, colorPalette: 'default', icon: 'book' })
  const [copyFechas, setCopyFechas] = useState({ fechaInicio: '', fechaFin: '' })
  const [copyingSubject, setCopyingSubject] = useState(false)

  // Unarchive modal
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [unarchiveStudents, setUnarchiveStudents] = useState('keep') // 'keep' | 'reset'
  const [unarchiveActivities, setUnarchiveActivities] = useState('keep') // 'keep' | 'show' | 'hide'
  const [unarchiveEdits, setUnarchiveEdits] = useState({ nombre: '', grupo: '', fechaInicio: '', fechaFin: '', parciales: '3', colorPalette: 'default', icon: 'book' })
  const [unarchivedSaving, setUnarchivedSaving] = useState(false)
  // Archive flow
  const [showArchiveModal, setShowArchiveModal] = useState(false)
  // Respaldo ZIP al archivar: opcional y apagado por omisión. Antes era una
  // disyuntiva obligada ("guardar" o "sin guardar") porque las entregas se
  // borraban; ya no se borran, así que dejarla sería preguntar por nada.
  const [archiveConZip, setArchiveConZip] = useState(false)

  const [activeTab, setActiveTab] = useState(routerLocation.state?.tab || 'actividades')

  // Pista de que la barra de pestañas se puede deslizar — en la App, con 6
  // pestañas angostas, algunas quedan fuera de vista sin ningún indicio de
  // que hay más a la derecha (pedido explícito, mismo criterio que la barra
  // del alumno).
  const tabsScrollRef = useRef(null)
  const [tabsOverflow, setTabsOverflow] = useState(false)
  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el) return undefined
    function check() {
      setTabsOverflow(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [])

  // Shared students (used by calificaciones + alumnos tab)
  const [groupStudents, setGroupStudents] = useState([])
  const [groupStudentsLoaded, setGroupStudentsLoaded] = useState(false)

  // Cuántos estudiantes tiene la asignatura AHORA MISMO. Derivado, no estado:
  // mientras no se haya abierto la pestaña Estudiantes vale el conteo que trajo
  // loadAll(); en cuanto esa lista existe en memoria, manda ella. Antes esto era
  // un useState que solo se llenaba en loadAll(), así que agregar estudiantes
  // (a mano o por Excel) actualizaba la lista pero NO el conteo: el aviso de
  // "aún no tienes estudiantes" seguía ahí hasta recargar la página.
  const totalStudents = groupStudentsLoaded ? groupStudents.length : studentCountAtLoad

  // Copy feedback
  const [copiedCode, setCopiedCode] = useState(false)

  // Student management (Alumnos tab)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [studentToEdit, setStudentToEdit] = useState(null)
  const [editStudentForm, setEditStudentForm] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '', comentarios: '' })
  const [studentToReset, setStudentToReset] = useState(null)
  const [resetPwdResult, setResetPwdResult] = useState(null) // { student }
  const [linkCandidate, setLinkCandidate] = useState(null) // { person, identity, schoolDocs }
  const [newStudent, setNewStudent] = useState({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
  const [savingStudent, setSavingStudent] = useState(false)
  const [searchAlumnos, setSearchAlumnos] = useState('')
  // Vista previa antes de importar el Excel de estudiantes — pedido
  // explícito: antes se subía directo a Firestore sin mostrar qué se iba a
  // crear ni avisar de filas mal capturadas.
  const [excelPreview, setExcelPreview] = useState(null) // { rows, invalid, schoolDocs, taken }
  const [parsingExcel, setParsingExcel] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)
  useBackHandler(() => !importingExcel && setExcelPreview(null), !!excelPreview)
  useScrollLock(!!excelPreview)

  // Resources (Recursos tab) — independent entity scoped by asignaturaId,
  // not tied to activities (see the `resources` collection in firestore.rules).
  const [resources, setResources] = useState([])
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const [previewResourceId, setPreviewResourceId] = useState(null)
  const [loadingResources, setLoadingResources] = useState(false)
  const [showResourceModal, setShowResourceModal] = useState(false)
  const [resourceModalMode, setResourceModalMode] = useState('create') // 'create' | 'edit'
  // tipo: 'archivo' | 'link' — origTipo remembers what the doc was when the
  // edit modal opened, so we know a file is still required if the teacher
  // switches a link-type resource back to an uploaded file.
  const [resourceForm, setResourceForm] = useState({ id: null, nombre: '', descripcion: '', tipo: 'archivo', enlace: '', origTipo: 'archivo' })
  const [resourceFile, setResourceFile] = useState(null)
  const [savingResource, setSavingResource] = useState(false)
  const [deleteResourceConfirm, setDeleteResourceConfirm] = useState(null)
  const [deletingResource, setDeletingResource] = useState(false)

  // Calificaciones
  const [gradeSubMap, setGradeSubMap] = useState({})
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [loadingGrades, setLoadingGrades] = useState(false)
  // Clic derecho en una celda YA calificada: popover pegado al cursor para
  // corregir el número sin navegar a la actividad (clic izquierdo sigue
  // llevando ahí — necesario para calificar por primera vez / revisar la
  // entrega). { x, y, subId, activityId, studentId, maxCalif, value }
  const [gradeQuickEdit, setGradeQuickEdit] = useState(null)
  const [savingQuickGrade, setSavingQuickGrade] = useState(false)
  // Calificaciones view state persists across the round-trip to a student's
  // activity/review (which fully navigates away and remounts this page). Saved
  // to sessionStorage on navigate-away, restored here so search + scroll survive.
  const califStateKey = `ef-calif-state-${subjectId}`
  const [searchGrade, setSearchGrade] = useState(() => {
    // Only rehydrate when we actually returned from a student's activity/review
    // (backState carries tab: 'calificaciones'); a fresh visit starts clean.
    if (routerLocation.state?.tab !== 'calificaciones') return ''
    try { return JSON.parse(sessionStorage.getItem(`ef-calif-state-${subjectId}`) || '{}').search || '' } catch { return '' }
  })
  const califScrollRestored = useRef(false)
  // Column/row hover tracking for the grades table cross-highlight — set via
  // event delegation on the table (see handleGradeTableHover below) instead
  // of one handler per cell.
  const [hoverGradeCell, setHoverGradeCell] = useState({ row: null, col: null })

  // Asistencias — un documento por hora de clase (fecha + slot), ver utils/attendance.js
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [attendanceLoaded, setAttendanceLoaded] = useState(false)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [searchAttendance, setSearchAttendance] = useState('')
  const [showAddAttendance, setShowAddAttendance] = useState(false)
  const [newAttendanceForm, setNewAttendanceForm] = useState({ fecha: '', duracion: 1, parcial: 1 })
  // Asuetos/vacaciones del docente — se cargan solo al abrir "Agregar día"
  // (alta manual; con fechas de curso configuradas este modal ni se usa, ver
  // autoAttendanceReady) para avisar sin bloquear si el día elegido coincide
  // con uno marcado, en vez de importar en silencio a un día "sin clases".
  const [attAsuetoMaps, setAttAsuetoMaps] = useState(null)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [deleteAttendanceConfirm, setDeleteAttendanceConfirm] = useState(null) // { fecha }
  const [deletingAttendance, setDeletingAttendance] = useState(false)
  // Motivo de justificación — { recordId, studentId, fecha, studentName }
  const [reasonModal, setReasonModal] = useState(null)
  const [reasonText, setReasonText] = useState('')
  // "recordId:studentId" de la última celda de asistencia revisada/modificada
  // — se resalta persistente en la tabla hasta que se toque otra.
  const [lastEditedAttCell, setLastEditedAttCell] = useState(null)
  // Días dentro del periodo del curso sin clase por asueto/vacaciones (solo
  // informativo, no genera filas de asistencia) — ver utils/attendanceAuto.js
  const [attendanceNoClaseDias, setAttendanceNoClaseDias] = useState([])
  // Horario de ESTA asignatura: { porFecha, diasSemana }. Lo llena
  // loadAttendance y sirve para no dejar agregar un día sin clase.
  const [claseDias, setClaseDias] = useState(null)
  // Días de clase automáticos que el docente borró a propósito (quedan en
  // subject.attendanceExcluded para que la sincronización no los regenere
  // solos) y siguen siendo válidos — se pueden restaurar uno por uno.
  const [attendanceMissingAutoDias, setAttendanceMissingAutoDias] = useState([]) // [{fecha, duracion, parcial}]
  const [showRestoreAttendance, setShowRestoreAttendance] = useState(false)
  const [restoringFecha, setRestoringFecha] = useState(null)

  const navigate = useNavigate()
  const toast = useToast()

  // Same reference used by the header's back arrow AND the physical Android
  // back button (useBackHandler below) — must stay the exact same function.
  function goBack() {
    navigate('/dashboard')
  }

  // Botón físico "atrás" (Android/Capacitor): la pila global en useBackHandler
  // siempre ejecuta el handler de más arriba — el modal/menú abierto más
  // reciente, o si no hay ninguno, la flecha "Volver" de la pantalla (goBack).
  // Cada línea replica exactamente el cierre que ya usa el botón Cancelar/X/backdrop
  // de ese modal (mismos guards de "saving en progreso" donde aplica).
  useBackHandler(() => setShowModal(false), showModal)
  useBackHandler(() => setDuplicateConfirm(null), !!duplicateConfirm)
  useBackHandler(() => !moving && setMoveConfirm(null), !!moveConfirm)
  useBackHandler(() => setPublishDraftConfirm(null), !!publishDraftConfirm)
  useBackHandler(() => setDeleteConfirm(null), !!deleteConfirm)
  useBackHandler(() => setShowMaterialModal(false), showMaterialModal)
  useBackHandler(() => setDeleteMaterialConfirm(null), !!deleteMaterialConfirm)
  useBackHandler(() => setShowAddStudent(false), showAddStudent)
  useBackHandler(() => setStudentToEdit(null), !!studentToEdit)
  useBackHandler(() => setStudentToReset(null), !!studentToReset)
  useBackHandler(() => !generatingCredentials && setShowCredentialsModal(false), showCredentialsModal)
  useBackHandler(() => setActivityMenu(null), !!activityMenu)
  useBackHandler(() => !importing && setImportFor(null), !!importFor)
  useBackHandler(() => setParcialMenu(null), !!parcialMenu)
  useBackHandler(() => setConfirmRevertPonderacion(false), confirmRevertPonderacion)
  useBackHandler(() => setConfirmRevertParcial(null), !!confirmRevertParcial)
  useBackHandler(() => !closingParcial && setCloseParcialConfirm(null), !!closeParcialConfirm)
  useBackHandler(() => !revertingParcial && setRevertParcialConfirm(null), !!revertParcialConfirm)
  useBackHandler(() => !savingStudent && setLinkCandidate(null), !!linkCandidate)
  useBackHandler(() => setResetPwdResult(null), !!resetPwdResult)
  useBackHandler(() => setStudentToDelete(null), !!studentToDelete)
  useBackHandler(() => setShowEditSubjectModal(false), showEditSubjectModal)
  useBackHandler(() => setShowCopyModal(false), showCopyModal)
  useBackHandler(() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }, showDeleteSubjectConfirm)
  useBackHandler(() => !archiving && setShowArchiveModal(false), showArchiveModal)
  useBackHandler(() => setShowUnarchiveModal(false), showUnarchiveModal)
  useBackHandler(() => setShowResourceModal(false), showResourceModal)
  useBackHandler(() => setDeleteResourceConfirm(null), !!deleteResourceConfirm)
  useBackHandler(() => setEntregableEditor(null), !!entregableEditor)
  useBackHandler(() => setEvalEditor(null), !!evalEditor)
  useBackHandler(() => setNewDateOpen(false), !!(entregableEditor && newDateOpen))
  // Screen-level: only runs when no modal/menu above is open.
  useBackHandler(goBack)

  // Scroll lock — this page never unmounts while a modal/confirm overlay is
  // open, so each overlay needs its own lock tied to the same condition that
  // controls its render below (one call per overlay, not a blanket lock).
  useScrollLock(showModal)
  useScrollLock(duplicateConfirm)
  useScrollLock(moveConfirm)
  useScrollLock(publishDraftConfirm)
  useScrollLock(deleteConfirm)
  useScrollLock(showMaterialModal)
  useScrollLock(deleteMaterialConfirm)
  useScrollLock(showAddStudent)
  useScrollLock(studentToEdit)
  useScrollLock(studentToReset)
  useScrollLock(showCredentialsModal)
  useScrollLock(importFor != null)
  useScrollLock(confirmRevertPonderacion)
  useScrollLock(confirmRevertParcial != null)
  useScrollLock(closeParcialConfirm)
  useScrollLock(revertParcialConfirm != null)
  useScrollLock(linkCandidate)
  useScrollLock(resetPwdResult)
  useScrollLock(studentToDelete)
  useScrollLock(showEditSubjectModal)
  useScrollLock(showCopyModal)
  useScrollLock(showDeleteSubjectConfirm)
  useScrollLock(showArchiveModal)
  useScrollLock(showUnarchiveModal)
  useScrollLock(showResourceModal)
  useScrollLock(deleteResourceConfirm)

  // Snapshot the calificaciones search + scroll right before leaving to a student's
  // activity, so returning (backState { tab: 'calificaciones' }) restores them.
  function saveCalifState() {
    try { sessionStorage.setItem(califStateKey, JSON.stringify({ search: searchGrade, scrollY: window.scrollY })) } catch { /* ignore quota */ }
  }
  function goToActivityFromGrades(path, state) {
    saveCalifState()
    navigate(path, state)
  }

  // Clic derecho sobre cualquier celda de Calificaciones: abre el popover de
  // calificación rápida, sin salir a la actividad. El clic izquierdo sigue
  // llevando ahí (necesario para revisar la entrega). Funciona tanto para
  // corregir una ya puesta como para calificar directo a quien no entregó
  // nada (mismo caso que "sin entrega" en la pantalla de la actividad).
  function openGradeQuickEdit(e, sub, activity, student) {
    e.preventDefault()
    if (subject?.parcialesCerrados?.[activity.parcial]) {
      toast('El parcial está cerrado — revierte el cierre para editar calificaciones', 'error')
      return
    }
    if (!sub && !canCreate) {
      toast('Activa tu suscripción mensual para registrar calificaciones — toda tu información sigue disponible')
      return
    }
    const popW = 200, popH = 130
    setGradeQuickEdit({
      x: Math.min(e.clientX, window.innerWidth - popW - 8),
      y: Math.min(e.clientY, window.innerHeight - popH - 8),
      subId: sub?.id || null,
      activityId: activity.id,
      studentId: student.id,
      maxCalif: activity.maxCalif || 10,
      value: sub?.calificacion != null ? String(sub.calificacion) : '',
    })
  }

  async function saveGradeQuickEdit() {
    if (!gradeQuickEdit) return
    const { subId, activityId, studentId, maxCalif, value } = gradeQuickEdit
    const n = parseFloat(value)
    if (isNaN(n) || n < 0 || n > maxCalif) {
      toast(`La calificación debe estar entre 0 y ${maxCalif}`, 'error')
      return
    }
    setSavingQuickGrade(true)
    try {
      const key = `${studentId}-${activityId}`
      if (subId) {
        await updateDoc(doc(db, 'submissions', subId), { calificacion: n })
        setGradeSubMap((prev) => ({ ...prev, [key]: { ...prev[key], calificacion: n } }))
      } else {
        // Igual que "Calificar sin entrega" en la actividad: crea la
        // submission directo. NO cierreParcial — queda como calificación
        // manual, no como las asignadas al cerrar el parcial en bloque.
        const data = {
          actividadId: activityId,
          alumnoId: studentId,
          calificacion: n,
          comentario: '',
          motivoSinEntrega: '',
          estado: 'calificado',
          sinEntrega: true,
          fechaEntrega: serverTimestamp(),
        }
        const ref = await addDoc(collection(db, 'submissions'), data)
        setGradeSubMap((prev) => ({ ...prev, [key]: { id: ref.id, ...data } }))
      }
      toast('Calificación guardada')
      setGradeQuickEdit(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingQuickGrade(false)
    }
  }

  // Guard on currentUser + depend on it: on a cold load the Firestore reads in loadAll()
  // (activities, students, submissions, materials) must not fire before Firebase Auth
  // restores the session, or the rules reject them and the effect never retries — the same
  // auth race that hid activities from students. Re-runs once currentUser is ready.
  useEffect(() => { if (currentUser) loadAll() }, [subjectId, currentUser])

  // Restore the calificaciones scroll position once, after the grades table has
  // rendered on return from a student's activity. Search is restored via initial state.
  useEffect(() => {
    if (califScrollRestored.current) return
    if (routerLocation.state?.tab !== 'calificaciones') return
    if (activeTab !== 'calificaciones' || !gradesLoaded) return
    califScrollRestored.current = true
    try {
      const saved = JSON.parse(sessionStorage.getItem(califStateKey) || '{}')
      if (saved.scrollY != null) requestAnimationFrame(() => window.scrollTo(0, saved.scrollY))
      // Consume it so a later plain visit to this subject doesn't jump unexpectedly.
      sessionStorage.removeItem(califStateKey)
    } catch { /* ignore */ }
  }, [activeTab, gradesLoaded, califStateKey, routerLocation.state])

  async function loadAll() {
    setLoading(true)
    // Navigating from one subject straight to another (e.g. via the sidebar) re-renders
    // this same component with a new subjectId instead of remounting it — without this,
    // the Alumnos/Calificaciones tabs would keep showing the PREVIOUS subject's roster,
    // since `groupStudentsLoaded`/`gradesLoaded` would already be true.
    setGroupStudents([])
    setGroupStudentsLoaded(false)
    setGradeSubMap({})
    setGradesLoaded(false)
    setResources([])
    setResourcesLoaded(false)
    // Default view for every subject: only the first parcial expanded. This same
    // component is reused (not remounted) when switching subjects, so reset it here
    // — otherwise the previously-open parcial would carry over to the new subject.
    setOpenParcial(1)
    try {
      // `materials` is fetched separately (not inside this Promise.all): if its
      // Firestore rules aren't deployed yet, getDocs() rejects with
      // permission-denied — that must never take down the subject/activities
      // load with it (it did once: the whole page fell back to defaults —
      // generic icon, blue palette, 3 parciales — because setSubject() was
      // never reached).
      const [subSnap, actsSnap] = await Promise.all([
        getDoc(doc(db, 'subjects', subjectId)),
        getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', subjectId))),
      ])
      // Una asignatura ajena jamás se muestra: subjects es de lectura pública
      // (activación por QR) así que sin este guard cualquier cuenta con la URL
      // vería el grupo completo con sus calificaciones.
      if (!subSnap.exists() || subSnap.data().docenteId !== currentUser.uid) {
        toast('Esta asignatura no pertenece a tu cuenta', 'error')
        navigate('/dashboard')
        return
      }
      const matsSnap = await getDocs(query(collection(db, 'materials'), where('asignaturaId', '==', subjectId))).catch(() => ({ docs: [] }))
      let subData = { id: subSnap.id, ...subSnap.data() }
      if (!subData.accessCode) {
        const newCode = Math.random().toString(36).slice(2, 8).toUpperCase()
        await updateDoc(doc(db, 'subjects', subjectId), { accessCode: newCode })
        subData = { ...subData, accessCode: newCode }
      }
      setSubject(subData)
      // Firestore doesn't guarantee document order without orderBy (not allowed
      // per this project's query constraints), so `orden` is the only thing that
      // determines display order. Activities created before this field existed
      // self-heal here: fall back to `createdAt`/id for a stable order, assign
      // `orden` from that position, and persist it — same pattern already used
      // for subjects/students.
      let acts = actsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      if (acts.some((a) => a.orden == null)) {
        const byParcial = {}
        acts.forEach((a) => { (byParcial[a.parcial] ||= []).push(a) })
        const batch = writeBatch(db)
        acts = Object.values(byParcial).flatMap((list) => {
          list.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) || a.id.localeCompare(b.id))
          return list.map((a, i) => {
            const orden = i + 1
            if (a.orden !== orden) batch.update(doc(db, 'activities', a.id), { orden })
            return { ...a, orden }
          })
        })
        batch.commit().catch(() => {}) // best-effort; in-memory order is already correct
      }
      acts = acts.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setActivities(acts)

      setMaterials(
        matsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      )

      const [subDocs, studSnap] = await Promise.all([
        fetchSubmissionsForActivities(acts.map((a) => a.id)),
        getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId))),
      ])
      setStudentCountAtLoad(studSnap.size)

      const counts = {}
      acts.forEach((a) => { counts[a.id] = { delivered: 0, graded: 0 } })
      subDocs.forEach((d) => {
        const data = d.data()
        const c = counts[data.actividadId]
        if (!c) return
        if (data.estado !== 'pendiente') c.delivered++
        if (data.calificacion != null) c.graded++
      })
      setSubmissionCounts(counts)

      // Re-fetch whichever tab is currently open for the NEW subject — `force: true`
      // because groupStudentsLoaded was just reset above but this function's own
      // closure still has the stale value from before that reset took effect.
      if (activeTab === 'alumnos') await ensureGroupStudents(true)
      if (activeTab === 'calificaciones') await loadGrades(true, acts)
      if (activeTab === 'recursos') await ensureResources(true)
      if (activeTab === 'asistencia') await loadAttendance(true)
    } catch (err) {
      toast('Error al cargar: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Students (shared) ──────────────────────────────────────────────
  // `force` bypasses the groupStudentsLoaded cache check — needed right after loadAll()
  // resets it, since this function's own closure (captured at the start of the same
  // render that triggered loadAll) still holds the PREVIOUS subject's stale `true`.
  async function ensureGroupStudents(force = false) {
    if (groupStudentsLoaded && !force) return groupStudents
    const snap = await getDocs(
      query(collection(db, 'students'), where('asignaturaId', '==', subjectId))
    )
    const students = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    setGroupStudents(students)
    setGroupStudentsLoaded(true)
    return students
  }

  // ── Resources (Recursos tab) ───────────────────────────────────────
  async function ensureResources(force = false) {
    if (resourcesLoaded && !force) return resources
    setLoadingResources(true)
    try {
      const snap = await getDocs(query(collection(db, 'resources'), where('asignaturaId', '==', subjectId)))
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        // Most-recent-first by publish date — sorted in memory since this
        // project's Firestore queries can't use orderBy (see CLAUDE.md).
        .sort((a, b) => (b.fechaPublicacion?.seconds ?? 0) - (a.fechaPublicacion?.seconds ?? 0))
      setResources(list)
      setResourcesLoaded(true)
      return list
    } catch (err) {
      toast('Error al cargar recursos: ' + err.message, 'error')
      return []
    } finally {
      setLoadingResources(false)
    }
  }

  function openAddResource() {
    setResourceModalMode('create')
    setResourceForm({ id: null, nombre: '', descripcion: '', tipo: 'archivo', enlace: '', origTipo: 'archivo' })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  function openEditResource(r) {
    setResourceModalMode('edit')
    const tipo = r.tipo === 'link' ? 'link' : 'archivo'
    setResourceForm({ id: r.id, nombre: r.nombre, descripcion: r.descripcion || '', tipo, enlace: tipo === 'link' ? (r.url || '') : '', origTipo: tipo })
    setResourceFile(null)
    setShowResourceModal(true)
  }

  // "Guardar recurso" se apaga sin cambios, solo en modo edit. El enlace se
  // compara ya normalizado (con https:// al frente) porque el guardado se lo
  // agrega solo si falta — sin esto, escribir la misma URL sin "https://"
  // se veía como un cambio aunque el recurso guardado fuera a quedar igual.
  const editingResource = resourceModalMode === 'edit' ? resources.find((r) => r.id === resourceForm.id) : null
  const resourceEnlaceNormalizado = resourceForm.enlace.trim() && !/^https?:\/\//i.test(resourceForm.enlace.trim())
    ? `https://${resourceForm.enlace.trim()}`
    : resourceForm.enlace.trim()
  const resourceChanged = resourceModalMode === 'create' || (
    resourceForm.nombre.trim() !== (editingResource?.nombre || '') ||
    resourceForm.descripcion.trim() !== (editingResource?.descripcion || '') ||
    resourceForm.tipo !== resourceForm.origTipo ||
    !!resourceFile ||
    (resourceForm.tipo === 'link' && resourceEnlaceNormalizado !== (editingResource?.url || ''))
  )

  async function handleSaveResource(e) {
    e.preventDefault()
    if (!resourceForm.nombre.trim()) { toast('Escribe un nombre', 'error'); return }
    const isLink = resourceForm.tipo === 'link'
    let enlaceUrl = ''
    if (isLink) {
      enlaceUrl = resourceForm.enlace.trim()
      if (!enlaceUrl) { toast('Escribe un enlace', 'error'); return }
      if (!/^https?:\/\//i.test(enlaceUrl)) enlaceUrl = `https://${enlaceUrl}`
    } else {
      const needsFile = resourceModalMode === 'create' || resourceForm.origTipo === 'link'
      if (needsFile && !resourceFile) { toast('Selecciona un archivo', 'error'); return }
      if (resourceFile) {
        if (!isResourceFileAllowed(resourceFile)) { toast('Tipo de archivo no permitido', 'error'); return }
        if (resourceFile.size > MAX_RESOURCE_SIZE) { toast('El archivo no puede superar 15 MB', 'error'); return }
      }
    }
    setSavingResource(true)
    try {
      if (resourceModalMode === 'create') {
        if (isLink) {
          await addDoc(collection(db, 'resources'), {
            asignaturaId: subjectId,
            docenteId: currentUser.uid,
            nombre: resourceForm.nombre.trim(),
            descripcion: resourceForm.descripcion.trim(),
            tipo: 'link',
            url: enlaceUrl,
            fechaPublicacion: serverTimestamp(),
          })
        } else {
          const url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
          await addDoc(collection(db, 'resources'), {
            asignaturaId: subjectId,
            docenteId: currentUser.uid,
            nombre: resourceForm.nombre.trim(),
            descripcion: resourceForm.descripcion.trim(),
            tipo: 'archivo',
            url,
            nombreArchivo: resourceFile.name,
            tamano: resourceFile.size,
            fechaPublicacion: serverTimestamp(),
          })
        }
        toast('Recurso agregado')
      } else {
        const patch = {
          nombre: resourceForm.nombre.trim(),
          descripcion: resourceForm.descripcion.trim(),
          tipo: isLink ? 'link' : 'archivo',
        }
        if (isLink) {
          patch.url = enlaceUrl
          patch.nombreArchivo = deleteField()
          patch.tamano = deleteField()
        } else if (resourceFile) {
          patch.url = await uploadToCloudinary(resourceFile, 'evalua-facil/recursos')
          patch.nombreArchivo = resourceFile.name
          patch.tamano = resourceFile.size
        }
        await updateDoc(doc(db, 'resources', resourceForm.id), patch)
        toast('Recurso actualizado')
      }
      setShowResourceModal(false)
      await ensureResources(true)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingResource(false)
    }
  }

  async function handleDeleteResource() {
    if (!deleteResourceConfirm) return
    setDeletingResource(true)
    try {
      await deleteDoc(doc(db, 'resources', deleteResourceConfirm.id))
      setDeleteResourceConfirm(null)
      await ensureResources(true)
      toast('Recurso eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingResource(false)
    }
  }

  // ── Calificaciones ─────────────────────────────────────────────────
  // `actsOverride` lets loadAll() pass the just-fetched activities directly — the
  // component's own `activities` state hasn't re-rendered yet inside that same call,
  // so reading it here would still see the PREVIOUS subject's activities.
  async function loadGrades(force = false, actsOverride = null) {
    setLoadingGrades(true)
    try {
      await ensureGroupStudents(force)
      const subDocs = await fetchSubmissionsForActivities((actsOverride || activities).map((a) => a.id))
      const map = {}
      subDocs.forEach((d) => {
        const data = { id: d.id, ...d.data() }
        map[`${data.alumnoId}-${data.actividadId}`] = data
      })
      setGradeSubMap(map)
      setGradesLoaded(true)
    } catch (err) {
      toast('Error al cargar calificaciones: ' + err.message, 'error')
    } finally {
      setLoadingGrades(false)
    }
  }

  function switchTab(tab) {
    setActiveTab(tab)
    if (tab === 'calificaciones' && !gradesLoaded) loadGrades()
    if (tab === 'alumnos' && !groupStudentsLoaded) ensureGroupStudents()
    if (tab === 'recursos' && !resourcesLoaded) ensureResources()
    if (tab === 'asistencia' && !attendanceLoaded) loadAttendance()
  }

  // En la app nativa, la pestaña Asistencias se ve en HORIZONTAL (para caber más
  // columnas); el resto de la app queda en vertical.
  //
  // Antes, mover el teléfono de vuelta a vertical (sin que el docente lo
  // pidiera) sacaba solo de esta vista — la pantalla está BLOQUEADA en
  // horizontal (lockLandscape), pero un listener nativo aparte
  // (MainActivity.java, OrientationEventListener → CustomEvent
  // "fisicaorientacion") detectaba la orientación FÍSICA del teléfono e
  // igual navegaba fuera. Pedido explícito: tomar asistencia con el
  // teléfono en la mano implica moverlo — eso no debe regresar a vertical.
  // Única salida ahora: el botón "Regresar" (ver onBack/stableAttBack) o el
  // botón físico atrás de Android.
  useEffect(() => {
    if (!IS_NATIVE_APP || activeTab !== 'asistencia') return undefined
    lockLandscape()
    return () => { lockPortrait() }
  }, [activeTab])

  // Oculta los íconos del sistema (barra de estado) mientras se agrega un día,
  // para que no estorben en el modal de la vista horizontal (app).
  useEffect(() => {
    if (!IS_NATIVE_APP || !showAddAttendance) return undefined
    hideStatusBar()
    return () => { showStatusBar() }
  }, [showAddAttendance])

  useEffect(() => {
    if (!showAddAttendance || attAsuetoMaps) return
    (async () => {
      const [asuetosSnap, vacacionesSnap] = await Promise.all([
        getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid))),
      ])
      setAttAsuetoMaps({
        asuetoMap: buildAsuetoMap(asuetosSnap.docs.map((d) => d.data())),
        vacacionMap: buildVacacionMap(vacacionesSnap.docs.map((d) => d.data())),
      })
    })()
  }, [showAddAttendance, attAsuetoMaps, currentUser.uid])

  // ── Asistencias ────────────────────────────────────────────────────
  // `subjectOverride`: cuando el llamador acaba de escribir un cambio en
  // `subjects/{id}` (p. ej. attendanceExcluded) y llama a loadAttendance en
  // la misma función, el `subject` del estado de React TODAVÍA no lo
  // refleja (setState es asíncrono) — pasar el valor ya actualizado evita
  // que esta sincronización lea el dato viejo y deshaga ese cambio.
  async function loadAttendance(force = false, subjectOverride = null) {
    const subj = subjectOverride || subject
    setLoadingAttendance(true)
    try {
      // Antes esto era 5-6 lecturas de Firestore EN SECUENCIA (estudiantes →
      // asistencia → bloques → [reintento de asistencia] → asuetos/
      // vacaciones), cada una pagando su propio round-trip — la causa real de
      // la lentitud al abrir la pestaña, no el volumen de datos. Las tres
      // primeras no dependen entre sí, así que corren en paralelo.
      // El horario se consulta SIEMPRE, no solo cuando el curso tiene fechas
      // de parciales: además de generar los días automáticos, es con lo que se
      // valida que no se agregue un día en el que esta asignatura no tiene
      // clase (ver motivoSinClase más abajo). Antes venía null justo en el
      // caso del alta manual, que es donde hace falta.
      const [students, records, bloquesInfo] = await Promise.all([
        ensureGroupStudents(force),
        loadAttendanceRecords(subjectId),
        fetchClaseDiasSemana({ subjectId, docenteId: subj.docenteId }).catch(() => null),
      ])
      setClaseDias(bloquesInfo)
      let finalRecords = records
      if (subj?.parcialesFechas?.length && bloquesInfo) {
        // Crear los días faltantes y buscar asuetos/vacaciones tampoco
        // dependen entre sí (solo comparten diasSemana, ya calculado arriba)
        // — también en paralelo.
        const [{ created, missing, nuevos }, noClase] = await Promise.all([
          syncAutoAttendanceDays({
            subjectId,
            docenteId: subj.docenteId,
            parcialesFechas: subj.parcialesFechas,
            existingFechas: new Set(records.map((r) => r.fecha)),
            excludedFechas: subj.attendanceExcluded || [],
            studentIds: (students || groupStudents).map((s) => s.id),
            porFecha: bloquesInfo.porFecha,
          }),
          loadAsuetoVacacionDiasClase({
            docenteId: subj.docenteId,
            fechaInicio: subj.fechaInicio,
            fechaFin: subj.fechaFin,
            diasSemana: bloquesInfo.diasSemana,
          }),
        ])
        // Los recién creados se agregan en memoria — ya no se vuelve a
        // descargar TODA la asistencia por segunda vez para incluirlos.
        if (created > 0) {
          finalRecords = [...records, ...nuevos].sort((a, b) =>
            a.fecha === b.fecha ? a.slot - b.slot : a.fecha.localeCompare(b.fecha))
        }
        setAttendanceMissingAutoDias(missing)
        setAttendanceNoClaseDias(noClase)
      }
      setAttendanceRecords(finalRecords)
      setAttendanceLoaded(true)
    } catch (err) {
      toast('Error al cargar asistencias: ' + err.message, 'error')
    } finally {
      setLoadingAttendance(false)
    }
  }

  // ¿Por qué NO se puede pasar lista ese día? null = sí se puede.
  //
  // Deliberadamente conservadora: solo bloquea cuando hay certeza de que ese
  // día de la semana no lleva clase de esta asignatura. Si no hay horario
  // capturado no hay con qué comparar, y si la fecha exacta sí tiene bloque
  // (aunque sea de reposición) se permite. Bloquear de más sería peor que el
  // problema: dejaría al docente sin poder registrar una clase que sí dio.
  function motivoSinClase(fecha) {
    if (!fecha) return null
    const diasConClase = claseDias?.diasSemana
    if (!diasConClase || diasConClase.size === 0) return null
    if (claseDias.porFecha?.[fecha]) return null
    const [anio, mes, dia] = fecha.split('-').map(Number)
    const diaSemana = diaSemanaLunes(new Date(anio, mes - 1, dia))
    if (diasConClase.has(diaSemana)) return null
    const conClase = [...diasConClase].sort().map((d) => DIAS_SEMANA[d]).join(', ')
    return `Los ${DIAS_SEMANA[diaSemana].toLowerCase()} no tienes clase de ${subjectDisplayName(subject)} — la das ${conClase}. Si de verdad hubo clase ese día, agrégala primero a tu horario.`
  }
  const avisoSinClase = motivoSinClase(newAttendanceForm.fecha)
  // Aviso aparte (no bloquea, a diferencia de avisoSinClase): el docente
  // marcó ese día como asueto/vacaciones, pero a diferencia de crear un
  // evento (que sí se bloquea del todo, ver bloqueadoPorAsueto en
  // CalendarPage.jsx), pasar lista es documentar algo que YA pasó — una
  // reposición de clase en un día de asueto es legítima y debe poder
  // registrarse, solo con el aviso de que es inusual. Chequeo directo por
  // fecha (no depende de diasSemana/fechas de curso, a diferencia de
  // loadAsuetoVacacionDiasClase) — este modal solo existe precisamente
  // cuando la asignatura NO tiene fechas de curso configuradas.
  const avisoAsueto = newAttendanceForm.fecha && attAsuetoMaps && (
    // Por 'asistencias' y no por 'clases': el docente puede marcar un día sin
    // clases pero en el que sí se pasa lista, y ahí el aviso sobra.
    esAsuetoPara(attAsuetoMaps.asuetoMap, newAttendanceForm.fecha, 'asistencias') ? 'asueto'
      : esAsuetoPara(attAsuetoMaps.vacacionMap, newAttendanceForm.fecha, 'asistencias') ? 'vacaciones'
        : null
  )

  async function handleCreateAttendanceDay(e) {
    e.preventDefault()
    if (!newAttendanceForm.fecha) return
    // Se revisa otra vez aquí y no solo en el botón: el formulario también se
    // envía con Enter.
    const aviso = motivoSinClase(newAttendanceForm.fecha)
    if (aviso) { toast(aviso, 'error'); return }
    setSavingAttendance(true)
    try {
      await createAttendanceDay({
        subjectId,
        docenteId: currentUser.uid,
        fecha: newAttendanceForm.fecha,
        duracion: Number(newAttendanceForm.duracion),
        parcial: Number(newAttendanceForm.parcial),
        studentIds: groupStudents.map((s) => s.id),
      })
      setShowAddAttendance(false)
      setNewAttendanceForm({ fecha: '', duracion: 1, parcial: Number(newAttendanceForm.parcial) })
      await loadAttendance(true)
      toast('Asistencia agregada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingAttendance(false)
    }
  }

  // Un toque/clic cicla el estado: Presente → Falta → Justificada → Presente.
  // Igual en web y app (pedido explícito): el tercer toque (el que saldría de
  // Justificada) NO vuelve a Presente directo — abre la ventana de motivo.
  // Mismo camino para revisar/editar una falta que YA tenía motivo (un clic
  // más sobre su "J con puntito") — ya no hay clic derecho ni mantener
  // presionado como atajo aparte (pedido explícito, se quitaron por
  // completo). Cancelar se comporta distinto según de dónde venía:
  //  · sin motivo todavía (se estaba completando la justificación por
  //    primera vez) → Cancelar completa el ciclo, vuelve a Presente.
  //  · ya tenía motivo (solo se estaba revisando/editando) → Cancelar no
  //    toca nada, se queda en Justificada con el motivo que ya tenía.
  // La última celda revisada/modificada queda resaltada de forma persistente
  // (anillo azul + fondo) hasta que se toque otra celda — el foco del teclado
  // se pierde al mover el mouse, así que esto va por estado, no por :focus
  // (pedido explícito: que se NOTE cuál fue la que se acaba de ver).
  async function handleCycleAttendance(record, student) {
    const now = new Date()
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (record.fecha > todayISO) {
      toast('Este día aún no llega — la asistencia se generó automáticamente y se podrá editar cuando llegue la fecha', 'error')
      return
    }
    const studentId = student.id
    setLastEditedAttCell(`${record.id}:${studentId}`)
    if (attendanceState(record, studentId) === 'justificada') {
      const yaTieneMotivo = !!(record.motivos?.[studentId] || '').trim()
      openReasonModal(record, student, { revertOnCancel: !yaTieneMotivo })
      return
    }
    const next = nextAttendanceState(attendanceState(record, studentId))
    setAttendanceRecords((prev) => prev.map((r) => {
      if (r.id !== record.id) return r
      return {
        ...r,
        presentes: { ...r.presentes, [studentId]: next === 'presente' },
        justificadas: { ...(r.justificadas || {}), [studentId]: next === 'justificada' },
      }
    }))
    try {
      await setAttendanceState(record.id, studentId, next)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }

  // `revertOnCancel` decide qué hace Cancelar en el modal — ver el comentario
  // de handleCycleAttendance arriba, la única que ahora abre esta ventana.
  function openReasonModal(record, student, { revertOnCancel = false } = {}) {
    const current = record.motivos?.[student.id] || ''
    setReasonText(current)
    setReasonModal({ recordId: record.id, studentId: student.id, fecha: record.fecha, studentName: studentFullName(student), original: current, revertOnCancel })
  }
  async function cancelReasonModal() {
    const modal = reasonModal
    setReasonModal(null)
    if (!modal?.revertOnCancel) return
    await markPresenteFrom(modal)
  }
  // Botón "Salir": cierra el modal sin tocar nada — para solo ver el motivo
  // guardado y no hacer nada más (pedido explícito).
  function closeReasonModal() {
    setReasonModal(null)
  }
  // Botón "Asistencia" del modal: siempre deja la celda en Presente
  // (palomita), venga de donde venga — completa el ciclo J → Presente sin
  // pasos extra (pedido explícito, reemplaza al viejo "Cancelar").
  async function markPresenteFromModal() {
    const modal = reasonModal
    setReasonModal(null)
    await markPresenteFrom(modal)
  }
  async function markPresenteFrom(modal) {
    if (!modal) return
    const { recordId, studentId } = modal
    setAttendanceRecords((prev) => prev.map((r) => r.id === recordId ? {
      ...r,
      presentes: { ...r.presentes, [studentId]: true },
      justificadas: { ...(r.justificadas || {}), [studentId]: false },
      motivos: { ...(r.motivos || {}), [studentId]: '' },
    } : r))
    try {
      await setAttendanceState(recordId, studentId, 'presente')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }
  function cellClick(record, student) {
    handleCycleAttendance(record, student)
  }

  // Wrapper de identidad ESTABLE para AttendanceTable (React.memo): cierra
  // sobre `subjectId`/`attendanceRecords` (vía handleCycleAttendance/
  // loadAttendance) que SÍ cambian si el docente pasa a otra asignatura sin
  // recargar la página (useParams no desmonta el componente) — congelarlo
  // con useCallback([]) directamente sería incorrecto (clausura obsoleta).
  // Este patrón de "ref a la última implementación" da una función que NUNCA
  // cambia de identidad (lo que React.memo necesita para saltarse el
  // re-render) pero siempre ejecuta la versión más reciente.
  const cellClickRef = useRef(); cellClickRef.current = cellClick
  const stableCellClick = useCallback((record, student) => cellClickRef.current(record, student), [])
  // setDeleteAttendanceConfirm/setActiveTab/setShowAddAttendance son setters
  // de useState — React los garantiza estables, así que estos SÍ pueden
  // llevar deps vacías sin riesgo de obsolescencia.
  const stableDeleteDay = useCallback((fecha) => setDeleteAttendanceConfirm({ fecha }), [])
  const stableAttBack = useCallback(() => setActiveTab('actividades'), [])
  // Botón físico "atrás" de Android: única forma de salir de Asistencias en
  // la app nativa (además del botón "Regresar" en pantalla) — pedido
  // explícito, ya no se sale solo por mover el teléfono a vertical (ver el
  // efecto de lockLandscape/lockPortrait más arriba).
  useBackHandler(stableAttBack, IS_NATIVE_APP && activeTab === 'asistencia')
  // Con fechas de curso configuradas, todo es automático: "Agregar día" pasa
  // a ser "Restaurar día" (solo fechas que el docente borró y siguen siendo
  // válidas) — sin fechas de curso, sigue siendo el alta manual de siempre.
  const autoAttendanceReady = !!(subject?.fechaInicio && subject?.fechaFin)
  const addDayLabel = !autoAttendanceReady
    ? 'Agregar día'
    : (attendanceMissingAutoDias.length > 0 ? 'Restaurar día' : null)
  function handleAddDayClick() {
    if (!autoAttendanceReady) { setShowAddAttendance(true); return }
    setShowRestoreAttendance(true)
  }
  const addDayClickRef = useRef(); addDayClickRef.current = handleAddDayClick
  const stableAddDay = useCallback(() => addDayClickRef.current(), [])

  // Guarda el motivo y deja la celda en "justificada".
  async function handleSaveReason() {
    if (!reasonModal) return
    const { recordId, studentId } = reasonModal
    const motivo = reasonText.trim()
    setAttendanceRecords((prev) => prev.map((r) => r.id === recordId ? {
      ...r,
      presentes: { ...r.presentes, [studentId]: false },
      justificadas: { ...(r.justificadas || {}), [studentId]: true },
      motivos: { ...(r.motivos || {}), [studentId]: motivo },
    } : r))
    setReasonModal(null)
    try {
      await setAttendanceState(recordId, studentId, 'justificada', motivo)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
      await loadAttendance(true)
    }
  }

  async function handleDeleteAttendanceDay() {
    if (!deleteAttendanceConfirm) return
    const fecha = deleteAttendanceConfirm.fecha
    setDeletingAttendance(true)
    try {
      await deleteAttendanceDay(attendanceRecords, fecha)
      // Si el curso ya tiene fechas configuradas, este día pudo haberse
      // generado solo (horarioBloques) — sin esto, loadAttendance(true) de
      // abajo lo volvería a crear de inmediato al re-sincronizar. Se pasa
      // el subject YA actualizado (subjectOverride): setSubject es
      // asíncrono, así que el `subject` del estado todavía no lo refleja
      // en este mismo tick.
      let subjectForSync = subject
      if (subject?.fechaInicio && subject?.fechaFin) {
        subjectForSync = { ...subject, attendanceExcluded: [...(subject.attendanceExcluded || []), fecha] }
        await updateDoc(doc(db, 'subjects', subjectId), { attendanceExcluded: arrayUnion(fecha) })
        setSubject(subjectForSync)
      }
      setDeleteAttendanceConfirm(null)
      await loadAttendance(true, subjectForSync)
      toast('Día de asistencia eliminado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setDeletingAttendance(false)
    }
  }

  // Restaura UN día que el docente había borrado (sigue siendo válido según
  // el horario y las fechas del curso) — lo quita de attendanceExcluded y
  // vuelve a crear sus columnas, igual que uno agregado a mano.
  async function handleRestoreAttendanceDay(dia) {
    setRestoringFecha(dia.fecha)
    try {
      await createAttendanceDay({
        subjectId,
        docenteId: subject.docenteId,
        fecha: dia.fecha,
        duracion: dia.duracion,
        parcial: dia.parcial,
        studentIds: groupStudents.map((s) => s.id),
      })
      const subjectForSync = { ...subject, attendanceExcluded: (subject.attendanceExcluded || []).filter((f) => f !== dia.fecha) }
      await updateDoc(doc(db, 'subjects', subjectId), { attendanceExcluded: arrayRemove(dia.fecha) })
      setSubject(subjectForSync)
      setShowRestoreAttendance(false)
      await loadAttendance(true, subjectForSync)
      toast('Día de asistencia restaurado')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setRestoringFecha(null)
    }
  }

  // ── Student management (Alumnos tab) ──────────────────────────────
  // All `students` docs of the school (every enrollment of every person). Used both to
  // dedupe usernames for brand-new people and to detect existing identities (same person
  // re-enrolled) so we can reuse their username/uid instead of forking a second account.
  // Bug real reproducido en producción: esto buscaba por escuelaId del
  // DOCENTE — pero cambiar de escuela en Profile.jsx dice explícitamente
  // "solo aplica a asignaturas y estudiantes nuevos" (no migra lo ya
  // existente). Un docente que dio de alta alumnos ANTES de elegir su
  // escuela (escuelaId caía en el 'sin-escuela' de abajo) y luego sí la
  // eligió, dejaba esos alumnos viejos invisibles para este detector de
  // identidad — al volver a inscribir a la MISMA persona, no se
  // encontraba coincidencia y se le creaba una cuenta nueva en paralelo
  // (mismo alumno con dos cuentas de Firebase Auth, una huérfana). El
  // docenteId nunca cambia, así que buscar por TODAS sus asignaturas es
  // estable ante cualquier cambio de escuela.
  async function fetchSchoolStudents() {
    const subjSnap = await getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
    const subjectIds = subjSnap.docs.map((d) => d.id)
    if (!subjectIds.length) return []
    const chunks = []
    for (let i = 0; i < subjectIds.length; i += 30) chunks.push(subjectIds.slice(i, i + 30))
    const snaps = await Promise.all(chunks.map((ids) =>
      getDocs(query(collection(db, 'students'), where('asignaturaId', 'in', ids)))
    ))
    return snaps.flatMap((s) => s.docs).map((d) => ({ id: d.id, ...d.data() }))
  }

  function uniqueFrom(person, schoolDocs) {
    const taken = new Set(schoolDocs.map((d) => d.username))
    return uniqueUsername(
      generateUsername(person.apellidoPaterno, person.apellidoMaterno, person.nombre),
      taken
    )
  }

  async function refreshGroupStudents() {
    const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
    setGroupStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
    // La lista recién traída es la buena: marcarla como cargada es lo que hace
    // que `totalStudents` deje de usar el conteo viejo de loadAll().
    setGroupStudentsLoaded(true)
  }

  // Al agregar estudiantes a una asignatura con parciales YA cerrados
  // (confirmCloseParcial más abajo), sus actividades de esos parciales
  // quedan bloqueadas para calificar (mismo candado que usa parcialCerrado)
  // y promedioParcial las excluye en silencio en vez de tratarlas como "sin
  // entrega" igual que a sus compañeros — un alta tardía nunca recibía esa
  // misma cobertura. Esto la replica para los estudiantes recién agregados,
  // con la MISMA calificación que ya se usó para el resto del grupo en ese
  // cierre (0 si ese parcial se cerró sin ninguna falta que rellenar).
  async function backfillClosedParcialesFor(studentIds) {
    const parcialesCerrados = subject?.parcialesCerrados || {}
    const closedParciales = Object.keys(parcialesCerrados).map(Number)
    if (closedParciales.length === 0 || studentIds.length === 0) return
    const entries = []
    for (const p of closedParciales) {
      const acts = activities.filter((a) => a.parcial === p && !isDraftActivity(a))
      if (acts.length === 0) continue
      const subDocs = await fetchSubmissionsForActivities(acts.map((a) => a.id))
      const cierreDoc = subDocs.find((d) => d.data().cierreParcial === true)
      const grade = cierreDoc ? cierreDoc.data().calificacion : 0
      acts.forEach((a) => entries.push({ a, grade }))
    }
    if (entries.length === 0) return
    const pairs = []
    studentIds.forEach((sid) => entries.forEach(({ a, grade }) => pairs.push({ sid, a, grade })))
    for (let i = 0; i < pairs.length; i += 400) {
      const batch = writeBatch(db)
      pairs.slice(i, i + 400).forEach(({ sid, a, grade }) => {
        const ref = doc(collection(db, 'submissions'))
        batch.set(ref, {
          alumnoId: sid,
          actividadId: a.id,
          calificacion: grade,
          comentario: '',
          estado: 'calificado',
          sinEntrega: true,
          cierreParcial: true,
          fechaEntrega: serverTimestamp(),
        })
      })
      await batch.commit()
    }
  }

  // Creates one enrollment doc. If `identity` is given (re-enrolling an existing person),
  // the new doc inherits that person's username/uid/activado so all their subjects share a
  // single account — and an already-activated student gets the new subject instantly.
  async function createEnrollment(person, identity, schoolDocs) {
    const username = identity ? identity.username : uniqueFrom(person, schoolDocs)
    const ref = await addDoc(collection(db, 'students'), {
      apellidoPaterno: person.apellidoPaterno.trim(),
      apellidoMaterno: person.apellidoMaterno.trim(),
      nombre: person.nombre.trim(),
      username,
      resetPassword: null,
      // Identidad ya conocida → su MISMA escuela (ver identity.escuelaId en
      // studentIdentity.js), no la escuela actual del docente.
      escuelaId: identity ? identity.escuelaId : (userProfile.escuelaId || 'sin-escuela'),
      asignaturaId: subjectId,
      activado: identity ? identity.activado : false,
      uid: identity ? (identity.uid || null) : null,
      orden: groupStudents.length + 1,
      createdAt: serverTimestamp(),
    })
    await backfillClosedParcialesFor([ref.id])
  }

  // Duplicate names get a zero-padded suffix: garcia.juan, garcia.juan01,
  // garcia.juan02… (dedupe is school-wide — usernames are the account id)
  function uniqueUsername(base, taken) {
    if (!taken.has(base)) return base
    let i = 1
    while (taken.has(`${base}${String(i).padStart(2, '0')}`)) i++
    return `${base}${String(i).padStart(2, '0')}`
  }

  async function addStudent(e) {
    e.preventDefault()
    setSavingStudent(true)
    try {
      const schoolDocs = await fetchSchoolStudents()
      const identity = findStudentIdentity(schoolDocs, newStudent)
      // Already enrolled in THIS subject → don't create a duplicate.
      if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
        toast('Ese estudiante ya está en esta asignatura', 'error')
        return
      }
      // Same full name elsewhere in the school → ask the teacher if it's the same person
      // before reusing (linking) their account.
      if (identity) {
        setLinkCandidate({ person: { ...newStudent }, identity, schoolDocs })
        return
      }
      await createEnrollment(newStudent, null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast('Estudiante agregado')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Resolves the "same name found" confirmation: link to the existing account or create new.
  async function resolveLinkCandidate(isSamePerson) {
    if (!linkCandidate) return
    const { person, identity, schoolDocs } = linkCandidate
    setSavingStudent(true)
    try {
      await createEnrollment(person, isSamePerson ? identity : null, schoolDocs)
      setNewStudent({ apellidoPaterno: '', apellidoMaterno: '', nombre: '' })
      setShowAddStudent(false)
      toast(isSamePerson ? 'Asignatura vinculada a su cuenta' : 'Estudiante agregado (cuenta nueva)')
      await refreshGroupStudents()
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
      setLinkCandidate(null)
    }
  }

  // Paso 1: leer el archivo y armar la vista previa — pedido explícito, NO
  // se escribe nada en Firestore todavía. Cada fila se clasifica (nueva /
  // vinculada a una cuenta existente / ya inscrita) para que el docente vea
  // exactamente qué va a pasar, y las filas que no se pudieron leer se
  // muestran aparte con su número de fila real de Excel para poder
  // corregirlas — antes desaparecían en silencio.
  async function handleExcelFileSelected(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setParsingExcel(true)
    try {
      const { valid, invalid } = await parseStudentExcel(file)
      if (valid.length === 0 && invalid.length === 0) {
        toast('El archivo está vacío', 'error')
        return
      }
      const schoolDocs = await fetchSchoolStudents()
      const taken = new Set(schoolDocs.map((d) => d.username))
      const rows = valid.map((row) => {
        const identity = findStudentIdentity(schoolDocs, row)
        if (identity && identity.matches.some((m) => m.asignaturaId === subjectId)) {
          return { row, status: 'skip', identity }
        }
        // decision: la propuesta del clasificador, pero el docente la puede
        // voltear en la vista previa (ver toggleImportLinkDecision) — antes
        // una coincidencia de nombre se vinculaba de una vez, sin preguntar,
        // a diferencia del alta manual (arriba), que SIEMPRE pregunta "¿es
        // el mismo estudiante?" antes de reutilizar una cuenta. Con nombres
        // comunes (dos "Juan Pérez García" distintos en la misma escuela) eso
        // fusionaba en silencio a dos personas reales en una sola cuenta.
        if (identity) return { row, status: 'link', decision: 'link', identity }
        return { row, status: 'new', decision: 'new' }
      })
      // Dos filas del MISMO archivo con el mismo nombre (captura repetida,
      // copiar-pegar de más) antes generaban dos cuentas nuevas para la misma
      // persona. Solo la primera aparición se procesa normal; las siguientes
      // se marcan aparte y se omiten al confirmar.
      const seenKeys = new Set()
      rows.forEach((item) => {
        const key = studentNameKey(item.row)
        if (seenKeys.has(key)) { item.status = 'duplicate' }
        else seenKeys.add(key)
      })
      setExcelPreview({ rows, invalid, schoolDocs, taken })
    } catch (err) {
      toast('Error leyendo el Excel: ' + err.message, 'error')
    } finally {
      setParsingExcel(false)
    }
  }

  // El docente voltea la decisión de una fila "coincide con alguien más" en
  // la vista previa: de vincularla a esa cuenta, a crearle una cuenta nueva
  // (es una persona distinta que solo comparte el nombre). Solo aplica a
  // filas 'link' — 'skip' (ya inscrito en ESTA asignatura) y 'new' (nadie
  // coincide) no tienen nada que decidir.
  function toggleImportLinkDecision(i) {
    setExcelPreview((prev) => {
      if (!prev) return prev
      const rows = prev.rows.map((item, idx) => {
        if (idx !== i || item.status !== 'link') return item
        return { ...item, decision: item.decision === 'link' ? 'new' : 'link' }
      })
      return { ...prev, rows }
    })
  }

  // Paso 2: el docente ya revisó la vista previa y confirma — aquí sí se
  // escribe en Firestore, igual que antes.
  async function confirmExcelImport() {
    if (!excelPreview) return
    setImportingExcel(true)
    try {
      const { rows, taken } = excelPreview
      const batch = writeBatch(db)
      let nextOrden = groupStudents.length + 1
      let created = 0
      let linked = 0
      let skipped = 0
      let duplicated = 0
      const newIds = []
      for (const item of rows) {
        if (item.status === 'skip') { skipped++; continue }
        if (item.status === 'duplicate') { duplicated++; continue }
        const row = item.row
        let username, uid = null, activado = false, escuelaId = userProfile.escuelaId || 'sin-escuela'
        if (item.status === 'link' && item.decision === 'link') {
          // Same person elsewhere, y el docente lo confirmó en la vista previa
          // (o lo dejó tal cual, que es la propuesta por default) → se vincula
          // a su cuenta existente. Su MISMA escuela, no la actual del docente
          // (ver identity.escuelaId en studentIdentity.js).
          username = item.identity.username; uid = item.identity.uid || null; activado = item.identity.activado
          escuelaId = item.identity.escuelaId
          linked++
        } else {
          username = uniqueUsername(generateUsername(row.apellidoPaterno, row.apellidoMaterno, row.nombre), taken)
          taken.add(username)
          created++
        }
        const ref = doc(collection(db, 'students'))
        newIds.push(ref.id)
        batch.set(ref, {
          ...row,
          username,
          resetPassword: null,
          uid,
          escuelaId,
          asignaturaId: subjectId,
          activado,
          orden: nextOrden++,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      await backfillClosedParcialesFor(newIds)
      const parts = [`${created} estudiantes importados`]
      if (linked) parts.push(`${linked} vinculados a cuentas existentes`)
      if (skipped) parts.push(`${skipped} ya estaban en la asignatura`)
      if (duplicated) parts.push(`${duplicated} repetidos en el archivo — se omitieron`)
      toast(parts.join(' · '))
      setExcelPreview(null)
      await refreshGroupStudents()
    } catch (err) {
      toast('Error importando Excel: ' + err.message, 'error')
    } finally {
      setImportingExcel(false)
    }
  }

  // Enables password recovery for a student: sets the `resetPassword` field to `true` (an
  // opaque enable-marker, NOT a password) that the student-side "Recuperar contraseña" flow
  // checks. The student then chooses a new password (the actual reset runs server-side via
  // Admin SDK, which clears the marker). We do NOT dictate any temp password to the teacher.
  async function confirmResetStudentPassword() {
    if (!studentToReset) return
    try {
      await updateDoc(doc(db, 'students', studentToReset.id), {
        resetPassword: true,
      })
      setGroupStudents((prev) =>
        prev.map((s) => s.id === studentToReset.id ? { ...s, resetPassword: true } : s)
      )
      setResetPwdResult({ student: studentToReset })
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setStudentToReset(null)
    }
  }

  async function confirmDeleteStudent() {
    if (!studentToDelete) return
    setSavingStudent(true)
    try {
      // Remove this enrollment's submissions first so none are orphaned.
      await deleteSubmissionsByStudent(studentToDelete.id)
      // Igual para sus prórrogas por actividad — sin esto, activities.extensiones
      // se quedaba con la llave del estudiante borrado para siempre (dato
      // muerto, nunca vuelve a leerse porque ningún id nuevo la reutiliza,
      // pero se acumula sin necesidad).
      const conExtension = activities.filter((a) =>
        a.extensiones?.[studentToDelete.id] !== undefined || a.extensionesMotivo?.[studentToDelete.id] !== undefined)
      if (conExtension.length > 0) {
        const extBatch = writeBatch(db)
        conExtension.forEach((a) => {
          extBatch.update(doc(db, 'activities', a.id), {
            [`extensiones.${studentToDelete.id}`]: deleteField(),
            [`extensionesMotivo.${studentToDelete.id}`]: deleteField(),
          })
        })
        await extBatch.commit()
        setActivities((prev) => prev.map((a) => {
          if (!conExtension.some((c) => c.id === a.id)) return a
          const extensiones = { ...a.extensiones }; delete extensiones[studentToDelete.id]
          const extensionesMotivo = { ...a.extensionesMotivo }; delete extensionesMotivo[studentToDelete.id]
          return { ...a, extensiones, extensionesMotivo }
        }))
      }
      await deleteDoc(doc(db, 'students', studentToDelete.id))
      const remaining = groupStudents.filter((s) => s.id !== studentToDelete.id)
      const batch = writeBatch(db)
      remaining.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      toast(`${studentToDelete.username} eliminado`)
      setStudentToDelete(null)
      setGroupStudents(remaining.map((s, i) => ({ ...s, orden: i + 1 })))
    } catch (err) {
      toast('Error al eliminar: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  function openEditStudent(s) {
    setStudentToEdit(s)
    setEditStudentForm({
      apellidoPaterno: s.apellidoPaterno || '',
      apellidoMaterno: s.apellidoMaterno || '',
      nombre: s.nombre || '',
      comentarios: s.comentarios || '',
    })
  }

  // "Guardar cambios" de Editar estudiante se apaga sin cambios — compara
  // contra studentToEdit, el mismo registro con el que openEditStudent llenó
  // el formulario.
  const editStudentChanged =
    editStudentForm.apellidoPaterno.trim() !== (studentToEdit?.apellidoPaterno || '') ||
    editStudentForm.apellidoMaterno.trim() !== (studentToEdit?.apellidoMaterno || '') ||
    editStudentForm.nombre.trim() !== (studentToEdit?.nombre || '') ||
    editStudentForm.comentarios.trim() !== (studentToEdit?.comentarios || '')

  async function handleDeleteStudentPhoto() {
    if (!studentToEdit?.photoURL) return
    try {
      await updateDoc(doc(db, 'students', studentToEdit.id), { photoURL: deleteField() })
      setGroupStudents((prev) => prev.map((s) => (s.id === studentToEdit.id ? { ...s, photoURL: null } : s)))
      setStudentToEdit((s) => (s ? { ...s, photoURL: null } : s))
      toast('Foto eliminada')
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    }
  }

  async function saveEditStudent(e) {
    e.preventDefault()
    if (!studentToEdit) return
    setSavingStudent(true)
    try {
      const updated = {
        apellidoPaterno: editStudentForm.apellidoPaterno.trim(),
        apellidoMaterno: editStudentForm.apellidoMaterno.trim(),
        nombre: editStudentForm.nombre.trim(),
        comentarios: editStudentForm.comentarios.trim(),
      }
      await updateDoc(doc(db, 'students', studentToEdit.id), updated)
      setGroupStudents((prev) => prev.map((s) => (s.id === studentToEdit.id ? { ...s, ...updated } : s)))
      toast('Estudiante actualizado')
      setStudentToEdit(null)
    } catch (err) {
      toast('Error: ' + err.message, 'error')
    } finally {
      setSavingStudent(false)
    }
  }

  // Hands off to the existing reset-password / delete-confirmation modals, kept out of
  // the row itself (the teacher kept clicking it by accident, prompting students to ask
  // for a reset they didn't need) so the cascade-delete and orden re-index stay in one place.
  function requestResetFromEdit() {
    setStudentToReset(studentToEdit)
    setStudentToEdit(null)
  }

  function requestDeleteFromEdit() {
    setStudentToDelete(studentToEdit)
    setStudentToEdit(null)
  }

  async function sortStudentsAlphabetically() {
    const newList = [...groupStudents].sort((a, b) =>
      studentFullName(a).localeCompare(studentFullName(b), 'es')
    )
    try {
      const batch = writeBatch(db)
      newList.forEach((s, i) => batch.update(doc(db, 'students', s.id), { orden: i + 1 }))
      await batch.commit()
      setGroupStudents(newList.map((s, i) => ({ ...s, orden: i + 1 })))
      toast('Estudiantes ordenados alfabéticamente')
    } catch (err) {
      toast('No se pudo ordenar: ' + err.message, 'error')
    }
  }

  function copyAccessCode() {
    if (!subject?.accessCode) return
    navigator.clipboard.writeText(subject.accessCode).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    })
  }

  // ── Activity actions ───────────────────────────────────────────────
  function openAdd(parcial) {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    setModalMode('create'); setModalParcial(parcial); setEditActivityId(null)
    setForm(EMPTY_FORM)
    setActivityExistingFiles([]); setActivityNewFiles([])
    setTipoActividad(null)
    setShowModal(true)
  }

  // ── Traer actividad de otra asignatura ─────────────────────────────
  async function openImport(parcial) {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    setImportFor(parcial)
    setImportSrc(null); setImportSrcActs([]); setImportSel(new Set())
    setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'subjects'), where('docenteId', '==', currentUser.uid)))
      const subs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.id !== subjectId)
        .sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b), 'es'))
      setImportSubjects(subs)
    } catch (err) {
      toast('Error al cargar tus asignaturas: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  async function pickImportSubject(sub) {
    setImportSrc(sub)
    setImportSel(new Set())
    setImportLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'activities'), where('asignaturaId', '==', sub.id)))
      const acts = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => !isDraftActivity(a))
        .sort((a, b) => (a.parcial - b.parcial) || ((a.orden ?? 0) - (b.orden ?? 0)))
      setImportSrcActs(acts)
    } catch (err) {
      toast('Error al cargar las actividades: ' + err.message, 'error')
    } finally {
      setImportLoading(false)
    }
  }

  function toggleImportSel(id) {
    setImportSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function confirmImport() {
    if (!importSel.size) return
    setImporting(true)
    try {
      const chosen = importSrcActs.filter((a) => importSel.has(a.id))
      const startOrden = activities.filter((a) => a.parcial === importFor).length + 1
      const created = await importActivitiesToSubject({
        sourceActivities: chosen,
        targetSubjectId: subjectId,
        targetParcial: importFor,
        docenteId: currentUser.uid,
        startOrden,
      })
      setActivities((prev) => [...prev, ...created])
      created.forEach((a) => setSubmissionCounts((prev) => ({ ...prev, [a.id]: { delivered: 0, graded: 0 } })))
      toast(`${created.length} actividad${created.length !== 1 ? 'es' : ''} traída${created.length !== 1 ? 's' : ''} como borrador al Parcial ${importFor}`)
      setImportFor(null)
    } catch (err) {
      toast('Error al traer las actividades: ' + err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  function openEdit(activity, labelOverride) {
    if (activity.tipo === 'evaluacion') {
      setEvalEditor({ activityId: activity.id, categoria: activity.categoria, parcial: activity.parcial, activityLabel: labelOverride || null })
      return
    }
    // Roster for the editor's read-only "prórrogas" list (Nueva fecha límite → Para
    // algunos) — load it now instead of waiting for the teacher to visit Alumnos first.
    ensureGroupStudents()
    // Entregable (and legacy actividad/tarea) → full-screen editor
    const cat = ['actividad', 'tarea'].includes(activity.categoria) ? 'entregable' : (activity.categoria || 'entregable')
    setEntregableEditor({
      activityId: activity.id,
      parcial: activity.parcial,
      categoria: cat,
      activityLabel: labelOverride || null,
      initialExistingFiles: activity.archivosAdjuntos || [],
      initialForm: {
        nombre: activity.nombre || '',
        instrucciones: toRichHtml(activity.instrucciones || ''),
        fechaLimite: activity.fechaLimite ? withDefaultTime(activity.fechaLimite, '00:00') : '',
        tiposArchivo: normalizeFileTypeKeys(activity.tiposArchivo),
        extensionesCustom: activity.extensionesCustom || '',
        oculta: activity.oculta || false,
        publishAt: activity.publishAt || '',
        publishedAt: activity.publishedAt || '',
        visibilidadMode: !activity.oculta ? 'published' : activity.publishAt ? 'schedule' : 'hide',
        // Checkbox reads the positive framing ("cerrar en fecha"); the real DB field
        // (recibirTarde) is the inverse — see EntregableEditor's save payload.
        cerrarEntregasEnFecha: !activity.recibirTarde,
        rubrica: activity.rubrica || null,
        rubricaId: activity.rubricaId || null,
        notificarDocente: activity.notificarDocente || false,
      },
    })
  }

  // Published entregable being edited? Only then does the editor offer "Nueva
  // fecha límite de entrega" — same group/per-student extension ActivityPage uses.
  const editorIsPublished = !!entregableEditor?.initialForm?.publishedAt
    && new Date(withDefaultTime(entregableEditor.initialForm.publishedAt, '00:00:00')).getTime() <= Date.now()

  // Live copy of the activity being edited — used to show its current
  // extensiones/extensionesMotivo (per-student prórrogas) in the editor,
  // since entregableEditor.initialForm doesn't carry those fields.
  const editingActivityData = activities.find((a) => a.id === entregableEditor?.activityId)

  // "Para algunos" needs the group roster — load it if the teacher never
  // visited the Alumnos tab this session.
  async function openNewDateForEditor() {
    await ensureGroupStudents()
    setNewDateOpen(true)
  }

  // Merges the modal's result into the activities list AND the currently open
  // editor's form (so its own fecha límite field reflects the change right away).
  function applyNewDateResult(result) {
    setActivities((prev) => prev.map((a) => {
      if (a.id !== entregableEditor?.activityId) return a
      if (result.mode === 'todos') return { ...a, fechaLimite: result.date, cerradaManual: false }
      const ext = { ...(a.extensiones || {}) }
      const em = { ...(a.extensionesMotivo || {}) }
      result.ids.forEach((id) => { ext[id] = result.date; em[id] = result.motivo })
      return { ...a, extensiones: ext, extensionesMotivo: em }
    }))
    if (result.mode === 'todos') {
      setEntregableEditor((prev) => prev && ({ ...prev, initialForm: { ...prev.initialForm, fechaLimite: result.date } }))
    }
  }

  function addInstructionFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setActivityNewFiles((prev) => [...prev, ...files])
  }

  // `index` is into the combined [existing..., new...] list rendered by
  // RichTextEditor's AttachmentList — split it back into the two arrays.
  function removeInstructionFile(index) {
    if (index < activityExistingFiles.length) {
      setActivityExistingFiles((prev) => prev.filter((_, i) => i !== index))
    } else {
      const newIndex = index - activityExistingFiles.length
      setActivityNewFiles((prev) => prev.filter((_, i) => i !== newIndex))
    }
  }

  async function handleSaveActivity(e, asDraft = false) {
    e.preventDefault()
    if (modalMode === 'create' && !canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas actividades — toda tu información sigue disponible')
      return
    }
    const tiposArchivo = normalizeFileTypeKeys(form.tiposArchivo)
    if (tiposArchivo.includes(CUSTOM_FILE_TYPE) && parseCustomExts(form.extensionesCustom).length === 0) {
      toast('Escribe al menos una extensión para "Personalizado"', 'error')
      return
    }
    if (!htmlToPlainText(form.instrucciones)) {
      toast('Escribe las instrucciones de la actividad', 'error')
      return
    }
    // fechaLimite must be strictly after the effective publish datetime
    const now = new Date()
    const nowIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    if (!asDraft) {
      // A scheduled publication must be in the future
      if (form.visibilidadMode === 'schedule') {
        if (!form.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
        if (form.publishAt <= nowIso) {
          toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
        }
      }
      const effectivePublishAt =
        form.visibilidadMode === 'show'     ? nowIso :
        form.visibilidadMode === 'schedule' ? (form.publishAt || null) :
        (form.publishedAt || null)
      if (form.fechaLimite && effectivePublishAt && form.fechaLimite <= effectivePublishAt) {
        toast('La fecha límite debe ser posterior a la fecha de publicación', 'error')
        return
      }
    }
    setSaving(true)
    try {
      const uploaded = await Promise.all(
        activityNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/instrucciones-adjuntos'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const payload = {
        nombre: form.nombre.trim(),
        categoria: form.categoria,
        maxCalif: 10,
        instrucciones: sanitizeHtml(form.instrucciones),
        archivosAdjuntos: [...activityExistingFiles, ...uploaded],
        fechaLimite: form.fechaLimite || null,
        // Keep receiving submissions after the deadline (marked as "tarde")
        recibirTarde: form.fechaLimite ? !!form.recibirTarde : false,
        tiposArchivo,
        extensionesCustom: tiposArchivo.includes(CUSTOM_FILE_TYPE) ? (form.extensionesCustom || '').trim() : '',
        oculta: asDraft ? true : form.visibilidadMode !== 'show',
        publishAt: !asDraft && form.visibilidadMode === 'schedule' ? (form.publishAt || null) : null,
        // publishedAt is permanent once set; only 'Publicar ahora' stamps it
        publishedAt: !asDraft && form.visibilidadMode === 'show' ? nowIso : (form.publishedAt || null),
      }
      if (modalMode === 'create') {
        // `orden` is only a sort key (Firestore gives no ordering guarantee
        // without it). The "Actividad" label (1.1, 1.2…) is presentation —
        // computed fresh from position within the parcial wherever it's shown
        // (see `activityLabelById` below) — never stored, so it can't drift.
        const orden = activities.filter((a) => a.parcial === modalParcial).length + 1
        const esEvaluacion = tipoActividad === 'cuestionario' || tipoActividad === 'examen'
        const tipo = esEvaluacion ? 'evaluacion' : 'archivo'
        const extra = esEvaluacion ? { evaluacion: EVALUACION_DEFAULTS[form.categoria] } : {}
        const ref = await addDoc(collection(db, 'activities'), {
          ...payload, ...extra, tipo, parcial: modalParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setActivities((prev) => [...prev, { id: ref.id, ...payload, ...extra, tipo, parcial: modalParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
        if (esEvaluacion) {
          toast('Evaluación creada — agrega tus preguntas')
          setShowModal(false); setForm(EMPTY_FORM)
          setActivityExistingFiles([]); setActivityNewFiles([])
          navigate(`/activity/${ref.id}`)
          return
        }
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad creada')
      } else {
        await updateDoc(doc(db, 'activities', editActivityId), payload)
        setActivities((prev) => prev.map((a) => a.id === editActivityId ? { ...a, ...payload } : a))
        toast(asDraft ? 'Borrador guardado — oculto para estudiantes' : 'Actividad actualizada')
      }
      setShowModal(false); setForm(EMPTY_FORM)
      setActivityExistingFiles([]); setActivityNewFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSaving(false) }
  }

  async function handleDeleteActivity() {
    if (!deleteConfirm) return; setDeleting(true)
    try {
      // Remove this activity's submissions first so none are orphaned.
      await deleteSubmissionsByActivity(deleteConfirm.id)
      await deleteDoc(doc(db, 'activities', deleteConfirm.id))
      // Re-index `orden` for the remaining activities of the SAME parcial so the
      // sort key stays contiguous (1, 2, 3…) — the displayed "Actividad" label
      // is derived from this position wherever it's shown, never stored.
      const remaining = activities
        .filter((a) => a.id !== deleteConfirm.id && a.parcial === deleteConfirm.parcial)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      const batch = writeBatch(db)
      const renumbered = remaining.map((a, i) => {
        const orden = i + 1
        batch.update(doc(db, 'activities', a.id), { orden })
        return { ...a, orden }
      })
      await batch.commit()
      setActivities((prev) => {
        const others = prev.filter((a) => a.id !== deleteConfirm.id && a.parcial !== deleteConfirm.parcial)
        return [...others, ...renumbered]
      })
      toast('Actividad eliminada'); setDeleteConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeleting(false) }
  }

  // ── Material de apoyo actions ───────────────────────────────────────
  // Independent entity from Activity: no maxCalif, no tiposArchivo, no
  // fechaLimite, no submissions — only a name, an optional rich-text
  // description and one or more downloadable files. Reuses the same
  // visibilidadMode/oculta/publishAt shape (and VisibilitySelect component)
  // as activities so the "show now / hide / schedule" behavior is identical.
  function openAddMaterial(parcial) {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    setMaterialModalMode('create'); setMaterialParcial(parcial); setEditMaterialId(null)
    setMaterialForm(EMPTY_MATERIAL_FORM)
    setMaterialNewFiles([]); setMaterialExistingFiles([])
    setShowMaterialModal(true)
  }

  function openEditMaterial(material) {
    setMaterialModalMode('edit'); setMaterialParcial(material.parcial); setEditMaterialId(material.id)
    setMaterialForm({
      nombre: material.nombre || '',
      descripcion: material.descripcion || '',
      oculta: material.oculta || false,
      publishAt: material.publishAt || '',
      visibilidadMode: !material.oculta ? 'show' : material.publishAt ? 'schedule' : 'hide',
    })
    setMaterialNewFiles([])
    setMaterialExistingFiles(material.archivos || [])
    setShowMaterialModal(true)
  }

  // "Guardar cambios" de Editar material se apaga sin cambios. Solo aplica en
  // modo edit — crear siempre debe poder enviarse (no hay original con qué
  // comparar). visibilidadMode se compara aparte de oculta/publishAt: pasar
  // de "Oculto" a "Programado" sin elegir fecha todavía deja oculta=true y
  // publishAt='' en AMBOS casos — sin este campo aparte, ese cambio de modo
  // pasaría desapercibido.
  const editingMaterial = materialModalMode === 'edit' ? materials.find((m) => m.id === editMaterialId) : null
  const materialChanged = materialModalMode === 'create' || (
    materialForm.nombre.trim() !== (editingMaterial?.nombre || '') ||
    materialForm.descripcion !== (editingMaterial?.descripcion || '') ||
    materialForm.visibilidadMode !== (!editingMaterial?.oculta ? 'show' : editingMaterial?.publishAt ? 'schedule' : 'hide') ||
    materialForm.publishAt !== (editingMaterial?.publishAt || '') ||
    materialNewFiles.length > 0 ||
    JSON.stringify(materialExistingFiles) !== JSON.stringify(editingMaterial?.archivos || [])
  )

  function addMaterialFiles(files) {
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_FILE_SIZE)
    if (tooBig) { toast(`"${tooBig.name}" supera el máximo de 15 MB`, 'error'); return }
    setMaterialNewFiles((prev) => [...prev, ...files])
  }

  async function handleSaveMaterial(e) {
    e.preventDefault()
    if (materialModalMode === 'create' && !canCreate) {
      toast('Activa tu suscripción mensual para crear nuevo material de apoyo — toda tu información sigue disponible')
      return
    }
    if (!materialForm.nombre.trim()) { toast('Escribe un nombre para el material', 'error'); return }
    if (materialExistingFiles.length === 0 && materialNewFiles.length === 0) {
      toast('Agrega al menos un archivo', 'error'); return
    }
    // Misma regla que las actividades (handleSaveActivity más arriba): sin
    // esto, "Programar publicación" sin elegir fecha se guardaba con
    // oculta=true y publishAt=null — un material oculto para siempre sin
    // ningún aviso.
    if (materialForm.visibilidadMode === 'schedule') {
      if (!materialForm.publishAt) { toast('Elige la fecha y hora de publicación', 'error'); return }
      const now = new Date()
      const nowIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (materialForm.publishAt <= nowIso) {
        toast('La fecha de publicación programada debe ser posterior a este momento', 'error'); return
      }
    }
    setSavingMaterial(true)
    try {
      const uploaded = await Promise.all(
        materialNewFiles.map(async (file) => ({
          url: await uploadToCloudinary(file, 'evalua-facil/materiales'),
          nombre: file.name,
          tamano: file.size,
        }))
      )
      const archivos = [...materialExistingFiles, ...uploaded]
      const payload = {
        nombre: materialForm.nombre.trim(),
        descripcion: sanitizeHtml(materialForm.descripcion),
        archivos,
        oculta: materialForm.oculta || !!materialForm.publishAt,
        publishAt: materialForm.publishAt || null,
      }
      if (materialModalMode === 'create') {
        const orden = materials.filter((m) => m.parcial === materialParcial).length + 1
        const ref = await addDoc(collection(db, 'materials'), {
          ...payload, parcial: materialParcial, orden,
          asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
        })
        setMaterials((prev) => [...prev, { id: ref.id, ...payload, parcial: materialParcial, orden, asignaturaId: subjectId, docenteId: currentUser.uid }])
        toast('Material agregado')
      } else {
        await updateDoc(doc(db, 'materials', editMaterialId), payload)
        setMaterials((prev) => prev.map((m) => m.id === editMaterialId ? { ...m, ...payload } : m))
        toast('Material actualizado')
      }
      setShowMaterialModal(false); setMaterialForm(EMPTY_MATERIAL_FORM)
      setMaterialNewFiles([]); setMaterialExistingFiles([])
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setSavingMaterial(false) }
  }

  async function handleDeleteMaterial() {
    if (!deleteMaterialConfirm) return; setDeletingMaterial(true)
    try {
      await deleteDoc(doc(db, 'materials', deleteMaterialConfirm.id))
      setMaterials((prev) => prev.filter((m) => m.id !== deleteMaterialConfirm.id))
      toast('Material eliminado'); setDeleteMaterialConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingMaterial(false) }
  }

  // Same visibility toggle activities already have ("Activar para alumnos" /
  // "Ocultar para alumnos" without opening the full edit form).
  async function hideMaterial(m) {
    const payload = { oculta: true, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }
  async function showMaterialNow(m) {
    const payload = { oculta: false, publishAt: null }
    await updateDoc(doc(db, 'materials', m.id), payload)
    setMaterials((prev) => prev.map((x) => x.id === m.id ? { ...x, ...payload } : x))
  }

  function handleToggleArchive() {
    if (!subject) return
    if (subject.archived) {
      // Unarchiving → open restore modal (edit data + palette + options)
      setUnarchiveStudents('keep')
      setUnarchiveActivities('keep')
      setUnarchiveEdits({
        nombre: subject.nombre || '',
        grupo: subject.grupo || '',
        fechaInicio: subject.fechaInicio || '',
        fechaFin: subject.fechaFin || '',
        parcialesFechas: subject.parcialesFechas || [],
        parciales: String(subject.parciales || 3),
        colorPalette: subject.colorPalette || 'default',
        icon: subject.icon || 'book',
      })
      setShowUnarchiveModal(true)
    } else {
      // Archivar ya no borra nada, así que el respaldo ZIP viene apagado:
      // es una comodidad, no un rescate.
      setArchiveConZip(false)
      setShowArchiveModal(true)
    }
  }

  // Archiva la asignatura SIN borrar nada.
  //
  // Antes, archivar borraba las entregas de todos los estudiantes (por espacio)
  // y solo dejaba el esqueleto. Se quitó: borraba el trabajo del alumno —lo
  // único de aquí que de verdad es suyo— y ni siquiera ahorraba el espacio que
  // pretendía, porque los archivos seguían en Cloudinary con su URL viva; solo
  // se destruía el documento que apuntaba a ellos. Lo peor de los dos mundos.
  //
  // Ahora archivar es un cambio de estado y nada más: la asignatura sale de las
  // activas del docente y se va a "Asignaturas archivadas" del estudiante, con
  // todo completo. El ZIP sigue disponible como respaldo opcional.
  async function handleArchiveConfirm() {
    setArchiving(true)
    try {
      if (archiveConZip) {
        setZipDownloading(true)
        setZipProgress({ done: 0, total: 0 })
        try {
          const students = await ensureGroupStudents()
          const rawDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
          const submissions = rawDocs.map((d) => ({ id: d.id, ...d.data() }))
          const jobs = buildJobsForSubject({ subject, activities, submissions, students })
          if (jobs.length > 0) {
            await downloadSubmissionsZip({
              zipName: subjectDisplayName(subject),
              jobs,
              onProgress: (done, total) => setZipProgress({ done, total }),
            })
          }
        } finally {
          setZipDownloading(false)
          setZipProgress({ done: 0, total: 0 })
        }
      }
      await updateDoc(doc(db, 'subjects', subjectId), { archived: true })
      setSubject((s) => ({ ...s, archived: true }))
      setShowArchiveModal(false)
      toast(archiveConZip ? 'Asignatura archivada (respaldo descargado)' : 'Asignatura archivada')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setArchiving(false) }
  }

  async function handleUnarchiveConfirm() {
    const newParciales = parseInt(unarchiveEdits.parciales) || 3
    if (activities.some((a) => a.parcial > newParciales)) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setUnarchivedSaving(true)
    try {
      if (unarchiveStudents === 'reset') {
        await deleteSubjectStudents(subjectId)
        setGroupStudents([])
        setGroupStudentsLoaded(false)
        setGradesLoaded(false)
        setGradeSubMap({})
      }
      const updates = {
        archived: false,
        nombre: unarchiveEdits.nombre.trim() || subject.nombre,
        grupo: unarchiveEdits.grupo.trim(),
        fechaInicio: unarchiveEdits.fechaInicio || '',
        fechaFin: unarchiveEdits.fechaFin || '',
        parcialesFechas: (unarchiveEdits.fechaInicio && unarchiveEdits.fechaFin)
          ? normalizeParcialesFechas(unarchiveEdits.fechaInicio, unarchiveEdits.fechaFin, newParciales, unarchiveEdits.parcialesFechas)
          : [],
        parciales: newParciales,
        colorPalette: unarchiveEdits.colorPalette || 'default',
        icon: unarchiveEdits.icon || 'book',
      }
      if (unarchiveActivities !== 'keep') {
        const batch = writeBatch(db)
        activities.forEach((a) => batch.update(doc(db, 'activities', a.id), {
          oculta: unarchiveActivities === 'hide',
          publishAt: null,
        }))
        await batch.commit()
        setActivities((prev) => prev.map((a) => ({ ...a, oculta: unarchiveActivities === 'hide', publishAt: null })))
      }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      setSubject((s) => ({ ...s, ...updates }))
      toast('Asignatura restaurada')
      setShowUnarchiveModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setUnarchivedSaving(false) }
  }

  // ── Activity visibility ────────────────────────────────────────────
  async function hideActivity(a) {
    try {
      await updateDoc(doc(db, 'activities', a.id), { oculta: true, publishAt: null })
      setActivities((prev) => prev.map((act) => act.id === a.id ? { ...act, oculta: true, publishAt: null } : act))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Parcial visibility (hides every activity in it from students at once) ──
  async function toggleParcialVisibility(p) {
    const hidden = subject?.parcialesOcultos || []
    const next = hidden.includes(p) ? hidden.filter((x) => x !== p) : [...hidden, p]
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { parcialesOcultos: next })
      setSubject((s) => ({ ...s, parcialesOcultos: next }))
      toast(next.includes(p) ? `Parcial ${p} oculto para estudiantes` : `Parcial ${p} visible para estudiantes`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Eye toggle: show a hidden (already published) activity immediately —
  // no modal, mirror of hideActivity.
  async function showActivityNow(act) {
    try {
      await updateDoc(doc(db, 'activities', act.id), { oculta: false, publishAt: null })
      setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, oculta: false, publishAt: null } : a))
      // If the whole parcial is hidden, publishing the activity isn't enough —
      // students still won't see it until the parcial is shown.
      const parcialOculto = (subject?.parcialesOcultos || []).includes(act.parcial)
      toast(parcialOculto
        ? `Actividad publicada, pero el Parcial ${act.parcial} está oculto a estudiantes — muéstralo para que la vean`
        : 'Actividad visible para estudiantes')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Duplicate an activity as a DRAFT copy: same instructions, file types,
  // attachments and evaluación config/preguntas — but hidden, unpublished,
  // unnumbered and without deadline, ready to rename and publish later.
  async function handleDuplicateActivity() {
    if (!duplicateConfirm) return
    setDuplicating(true)
    try {
      const src = duplicateConfirm
      const orden = activities.filter((a) => a.parcial === src.parcial).length + 1
      const copy = {
        nombre: `${src.nombre} (copia)`,
        categoria: src.categoria || 'entregable',
        maxCalif: src.maxCalif ?? 10,
        instrucciones: src.instrucciones || '',
        archivosAdjuntos: src.archivosAdjuntos || [],
        fechaLimite: null,
        tiposArchivo: src.tiposArchivo || [],
        extensionesCustom: src.extensionesCustom || '',
        tipo: src.tipo || 'archivo',
        ...(src.evaluacion ? { evaluacion: src.evaluacion } : {}),
        oculta: true, publishAt: null, publishedAt: null,
        parcial: src.parcial, orden,
        asignaturaId: subjectId, docenteId: currentUser.uid, createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'activities'), copy)
      // Evaluaciones: also clone the question bank of this activity
      if (src.tipo === 'evaluacion') {
        const snap = await getDocs(collection(db, 'activities', src.id, 'preguntas'))
        await Promise.all(snap.docs.map((d) => addDoc(collection(db, 'activities', ref.id, 'preguntas'), d.data())))
      }
      setActivities((prev) => [...prev, { id: ref.id, ...copy, createdAt: null }])
      setSubmissionCounts((prev) => ({ ...prev, [ref.id]: { delivered: 0, graded: 0 } }))
      toast('Copia creada como borrador — edítala para cambiarle el nombre')
      setDuplicateConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDuplicating(false) }
  }

  // ── Cambiar de lugar una actividad dentro de su parcial ─────────────
  // El número visible (1.2., 1.3.…) SIEMPRE se deriva de la posición, nunca se
  // guarda — así que mover una actividad renumera también a las que quedan en
  // medio. Los estudiantes ya vieron esos números en lo que está publicado, por
  // eso el docente confirma primero, viendo exactamente qué números cambian.
  // Solo en la web: el ⋮ de la actividad no existe en la app nativa.
  function activityLabelsFor(list, parcial) {
    const map = {}
    list.filter((x) => !isDraftActivity(x)).forEach((x, i) => { map[x.id] = `${parcial}.${i + 1}.` })
    return map
  }

  function requestMoveActivity(a, direction) {
    const list = activities
      .filter((x) => x.parcial === a.parcial)
      .sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0))
    const from = list.findIndex((x) => x.id === a.id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= list.length) return
    const newList = [...list]
    ;[newList[from], newList[to]] = [newList[to], newList[from]]
    const before = activityLabelsFor(list, a.parcial)
    const after = activityLabelsFor(newList, a.parcial)
    const changes = newList
      .filter((x) => before[x.id] !== after[x.id])
      .map((x) => ({ id: x.id, nombre: x.nombre, de: before[x.id], hacia: after[x.id], publicada: !!x.publishedAt }))
    // Intercambiar con un borrador (que todavía no lleva número) no renumera
    // nada y no hay nada que avisarle al grupo: se mueve directo.
    if (changes.length === 0) { applyMoveActivities(a.parcial, newList); return }
    setMoveConfirm({ a, newList, changes })
  }

  async function applyMoveActivities(parcial, newList) {
    const prevActivities = activities
    const renumbered = newList.map((x, i) => ({ ...x, orden: i + 1 }))
    // Optimista: el orden nuevo se pinta de inmediato y se revierte si falla el commit.
    setActivities((prev) => [...prev.filter((x) => x.parcial !== parcial), ...renumbered])
    setMoving(true)
    try {
      const batch = writeBatch(db)
      renumbered.forEach((x) => batch.update(doc(db, 'activities', x.id), { orden: x.orden }))
      await batch.commit()
      setMoveConfirm(null)
      toast('Actividad movida')
    } catch (err) {
      setActivities(prevActivities)
      toast('No se pudo mover: ' + err.message, 'error')
    } finally { setMoving(false) }
  }

  // First publication of a draft (no publishedAt yet): the eye asks for
  // confirmation and stamps the publication datetime.
  async function publishDraftNow() {
    if (!publishDraftConfirm) return
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    try {
      await updateDoc(doc(db, 'activities', publishDraftConfirm.id), { oculta: false, publishAt: null, publishedAt: iso })
      setActivities((prev) => prev.map((a) => a.id === publishDraftConfirm.id ? { ...a, oculta: false, publishAt: null, publishedAt: iso } : a))
      toast('Actividad publicada para estudiantes')
      setPublishDraftConfirm(null)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // ── Subject CRUD ───────────────────────────────────────────────────
  // "Guardar cambios" de Editar asignatura se apaga sin cambios — compara
  // contra `subject` en vivo, que es exactamente de donde openEditSubject()
  // rellena el formulario cada vez que se abre, así que no hace falta guardar
  // una copia aparte. parciales es string en el form y number en el doc;
  // parcialesFechas es un arreglo de objetos, se compara por JSON.
  const editSubjectChanged =
    editSubjectForm.nombre.trim() !== (subject?.nombre || '') ||
    editSubjectForm.grupo.trim() !== (subject?.grupo || '') ||
    editSubjectForm.fechaInicio !== (subject?.fechaInicio || '') ||
    editSubjectForm.fechaFin !== (subject?.fechaFin || '') ||
    editSubjectForm.parciales !== String(subject?.parciales || 3) ||
    editSubjectForm.colorPalette !== (subject?.colorPalette || 'default') ||
    editSubjectForm.icon !== (subject?.icon || 'book') ||
    JSON.stringify(editSubjectForm.parcialesFechas || []) !== JSON.stringify(subject?.parcialesFechas || [])

  function openEditSubject() {
    setEditSubjectForm({
      nombre: subject?.nombre || '',
      grupo: subject?.grupo || '',
      fechaInicio: subject?.fechaInicio || '',
      fechaFin: subject?.fechaFin || '',
      parcialesFechas: subject?.parcialesFechas || [],
      parciales: String(subject?.parciales || 3),
      colorPalette: subject?.colorPalette || 'default',
      icon: subject?.icon || 'book',
    })
    setShowEditSubjectModal(true)
  }

  async function handleEditSubject(e) {
    e.preventDefault()
    const newParciales = parseInt(editSubjectForm.parciales) || 3
    const hasActsAbove = activities.some((a) => a.parcial > newParciales)
    if (hasActsAbove) {
      toast(`Hay actividades en parciales superiores a ${newParciales}. Elimínalas primero.`, 'error')
      return
    }
    setEditingSubject(true)
    try {
      const subjUpdates = {
        nombre: editSubjectForm.nombre.trim(),
        grupo: editSubjectForm.grupo.trim(),
        fechaInicio: editSubjectForm.fechaInicio || '',
        fechaFin: editSubjectForm.fechaFin || '',
        parcialesFechas: (editSubjectForm.fechaInicio && editSubjectForm.fechaFin)
          ? normalizeParcialesFechas(editSubjectForm.fechaInicio, editSubjectForm.fechaFin, newParciales, editSubjectForm.parcialesFechas)
          : [],
        parciales: newParciales,
        colorPalette: editSubjectForm.colorPalette || 'default',
        icon: editSubjectForm.icon || 'book',
      }
      await updateDoc(doc(db, 'subjects', subjectId), subjUpdates)
      setSubject((s) => ({ ...s, ...subjUpdates }))
      const fechasCambiaron = subjUpdates.fechaInicio !== (subject?.fechaInicio || '')
        || subjUpdates.fechaFin !== (subject?.fechaFin || '')
      if (fechasCambiaron && subjUpdates.fechaInicio && subjUpdates.fechaFin) {
        await sincronizarBloquesConFechas(subjUpdates.fechaInicio, subjUpdates.fechaFin)
      }
      toast('Asignatura actualizada')
      setShowEditSubjectModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setEditingSubject(false) }
  }

  // Las fechas del curso (Editar asignatura) son ahora la única fuente de
  // verdad: si se alargan, esto extiende el patrón semanal ya programado para
  // cubrir el tramo nuevo — así los bloques (y con ellos la asistencia
  // automática, que sale de los bloques) nunca se quedan atrás de la fecha que
  // el docente acaba de poner. No borra ni toca bloques existentes; solo
  // rellena huecos, igual que "Faltan clases" en el calendario, pero sin que
  // el docente tenga que ir a buscarlo.
  async function sincronizarBloquesConFechas(fechaInicio, fechaFin) {
    try {
      const bloquesSnap = await getDocs(query(
        collection(db, 'horarioBloques'),
        where('docenteId', '==', currentUser.uid),
        where('asignaturaId', '==', subjectId),
      ))
      const bloquesAsignatura = bloquesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const tramos = tramosFaltantes(bloquesAsignatura, fechaInicio, fechaFin)
      if (tramos.length === 0) return
      const patrones = derivarPatrones(bloquesAsignatura)
      if (patrones.length === 0) return

      const [asuetosSnap, vacacionesSnap] = await Promise.all([
        getDocs(query(collection(db, 'asuetos'), where('docenteId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'vacaciones'), where('docenteId', '==', currentUser.uid))),
      ])
      const diasAsueto = [
        ...asuetosSnap.docs.map(d => d.data()).filter(a => a.clases).map(a => a.fecha),
        ...fechasVacacionParaClases(vacacionesSnap.docs.map(d => d.data())),
      ]
      const nuevos = tramos.flatMap(t => generarBloques({
        fechaInicio: t.desde,
        fechaFin: t.hasta,
        diasAsueto,
        duracionMin: patrones[0].duracionMin || 60,
        patrones,
        color: patrones[0].color,
        alarma: patrones[0].alarma,
      }))
      if (nuevos.length === 0) return

      const meta = {
        docenteId: currentUser.uid,
        programacionId: crypto.randomUUID(),
        asignaturaId: subjectId,
        createdAt: serverTimestamp(),
      }
      for (let i = 0; i < nuevos.length; i += 450) {
        const batch = writeBatch(db)
        nuevos.slice(i, i + 450).forEach(b => batch.set(doc(collection(db, 'horarioBloques')), { ...b, ...meta }))
        await batch.commit()
      }
      toast(`Se extendieron ${nuevos.length} bloque(s) de clase para cubrir las nuevas fechas`)
    } catch (err) {
      toast('La asignatura se guardó, pero no se pudieron extender los bloques de clase: ' + err.message, 'warning')
    }
  }

  async function handleDeleteSubject() {
    if (deleteSubjectConfirmText !== subject?.nombre) {
      toast('El nombre no coincide', 'error'); return
    }
    setDeletingSubject(true)
    try {
      await deleteSubjectCascade(subjectId, subject?.docenteId)
      toast('Asignatura eliminada')
      navigate('/dashboard')
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setDeletingSubject(false) }
  }

  function openCopyModal() {
    if (!canCreate) {
      toast('Activa tu suscripción mensual para crear nuevas asignaturas — toda tu información sigue disponible')
      return
    }
    setCopyForm({ nombre: subject?.nombre || '', grupo: subject?.grupo || '', keepStudents: false, colorPalette: subject?.colorPalette || 'default', icon: subject?.icon || 'book' })
    setCopyFechas({ fechaInicio: subject?.fechaInicio || '', fechaFin: subject?.fechaFin || '' })
    setShowCopyModal(true)
  }

  async function handleCopySubject(e) {
    e.preventDefault()
    setCopyingSubject(true)
    try {
      const newId = await copySubject({
        sourceSubjectId: subjectId,
        nombre: copyForm.nombre.trim(),
        grupo: copyForm.grupo.trim(),
        fechaInicio: copyFechas.fechaInicio || '',
        fechaFin: copyFechas.fechaFin || '',
        parciales: subject?.parciales || 3,
        colorPalette: copyForm.colorPalette || 'default',
        icon: copyForm.icon || 'book',
        keepStudents: copyForm.keepStudents,
        docenteId: currentUser.uid,
        escuelaId: userProfile?.escuelaId || 'sin-escuela',
      })
      toast('Asignatura duplicada')
      setShowCopyModal(false)
      navigate(`/subject/${newId}`)
    } catch (err) { toast('Error al duplicar: ' + err.message, 'error') }
    finally { setCopyingSubject(false) }
  }

  // PONDERACIÓN gate: while capturing, partial sums are fine — but grades
  // can only be GENERATED when every weighted parcial adds up to exactly 10.
  // Only parciales where the teacher already assigned some weight are
  // validated; untouched parciales fall back to simple average.
  function ponderacionIncompleta() {
    const PARC = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
    for (const p of PARC) {
      if (!ponderacionActivaEnParcial(subject, p)) continue
      const acts = activities.filter((a) => a.parcial === p && !isDraftActivity(a))
      if (!acts.length || !acts.some((a) => pesoDe(a) > 0)) continue
      const total = parseFloat(acts.reduce((t, a) => t + pesoDe(a), 0).toFixed(2))
      if (total !== 10) return { p, total }
    }
    return null
  }

  async function handleExport() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    const falta = ponderacionIncompleta()
    if (falta) {
      toast(`La ponderación del Parcial ${falta.p} suma ${falta.total} de 10 — complétala antes de generar las calificaciones`, 'warning')
      return
    }
    if (!(await confirmExportNotice())) return
    setExporting(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      await exportSubjectGrades({
        subject, activities, students,
        submissions: Object.values(subMap),
        watermark: exportsWatermarked,
      })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }

  // ── CERRAR PARCIAL ──
  // To close, EVERYTHING must be graded. The dialog then adapts:
  //  · ponderación that doesn't sum 10 blocks closing (shown in the dialog; a
  //    tooltip on the "Cerrar" menu item previews it — no fleeting toast)
  //  · delivered-but-ungraded submissions block closing (grade them manually first)
  //  · no-entregas (no submission) are set to 0 only if the teacher proceeds
  function requestCloseParcial(p) {
    const acts = activities.filter((a) => a.parcial === p && !isDraftActivity(a))
    let pondError = null
    if (ponderacionActivaEnParcial(subject, p)) {
      const total = pesoTotalVivo(acts)
      if (Math.abs(total - 10) > 0.001) pondError = { total }
    }
    const missing = []
    let ungraded = 0
    groupStudents.forEach((s) => {
      acts.forEach((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        if (!sub) missing.push({ s, a })
        else if (sub.calificacion == null) ungraded++
      })
    })
    playAlertSound()
    setCloseParcialGrade('5')
    setCloseParcialConfirm({ p, missing, ungraded, pondError })
  }

  // Revert a close: delete the 0-grades created by the close (cierreParcial=true)
  // so those no-entregas go back to just "sin entrega". Manual grades are kept.
  async function revertCloseParcial() {
    if (revertParcialConfirm == null) return
    const p = revertParcialConfirm
    setRevertingParcial(true)
    try {
      const acts = activities.filter((a) => a.parcial === p && !isDraftActivity(a))
      const snaps = await fetchSubmissionsForActivities(acts.map((a) => a.id))
      const toDelete = snaps.filter((d) => d.data().cierreParcial === true)
      const removedKeys = []
      for (let i = 0; i < toDelete.length; i += 400) {
        const batch = writeBatch(db)
        toDelete.slice(i, i + 400).forEach((d) => {
          batch.delete(doc(db, 'submissions', d.id))
          const data = d.data()
          removedKeys.push(`${data.alumnoId}-${data.actividadId}`)
        })
        await batch.commit()
      }
      setGradeSubMap((prev) => {
        const next = { ...prev }
        removedKeys.forEach((k) => delete next[k])
        return next
      })
      const nextClosed = { ...(subject?.parcialesCerrados || {}) }
      delete nextClosed[p]
      await updateDoc(doc(db, 'subjects', subjectId), { parcialesCerrados: nextClosed })
      setSubject((s) => ({ ...s, parcialesCerrados: nextClosed }))
      toast(`Cierre del Parcial ${p} revertido — ${removedKeys.length} no entrega${removedKeys.length !== 1 ? 's volvieron' : ' volvió'} a quedar sin calificar`)
      setRevertParcialConfirm(null)
    } catch (err) {
      toast('Error al revertir el cierre: ' + err.message, 'error')
    } finally {
      setRevertingParcial(false)
    }
  }

  async function confirmCloseParcial() {
    if (!closeParcialConfirm) return
    const { p, missing } = closeParcialConfirm
    // Grade to assign to every no-entrega (default 0 if the field is left blank)
    const grade = Math.max(0, parseFloat(closeParcialGrade) || 0)
    setClosingParcial(true)
    try {
      // Batched creates (Firestore caps batches at 500 writes)
      const newSubs = []
      for (let i = 0; i < missing.length; i += 400) {
        const batch = writeBatch(db)
        missing.slice(i, i + 400).forEach(({ s, a }) => {
          const ref = doc(collection(db, 'submissions'))
          const data = {
            alumnoId: s.id,
            actividadId: a.id,
            calificacion: grade,
            comentario: '',
            estado: 'calificado',
            sinEntrega: true,
            cierreParcial: true,
            fechaEntrega: serverTimestamp(),
          }
          batch.set(ref, data)
          newSubs.push({ key: `${s.id}-${a.id}`, data: { id: ref.id, ...data } })
        })
        await batch.commit()
      }
      setGradeSubMap((prev) => {
        const next = { ...prev }
        newSubs.forEach(({ key, data }) => { next[key] = data })
        return next
      })
      await updateDoc(doc(db, 'subjects', subjectId), {
        [`parcialesCerrados.${p}`]: new Date().toISOString(),
      })
      setSubject((s) => ({ ...s, parcialesCerrados: { ...(s.parcialesCerrados || {}), [p]: new Date().toISOString() } }))
      toast(`Parcial ${p} cerrado — ${missing.length} no entrega${missing.length !== 1 ? 's quedaron' : ' quedó'} en ${grade}`)
      setCloseParcialConfirm(null)
    } catch (err) {
      toast('Error al cerrar el parcial: ' + err.message, 'error')
    } finally {
      setClosingParcial(false)
    }
  }

  // Loads students + grades if not already in state, returns them for export.
  async function ensureGradesData() {
    let students = groupStudents
    let subMap = gradeSubMap
    if (!groupStudentsLoaded) {
      const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
      students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      setGroupStudents(students); setGroupStudentsLoaded(true)
    }
    if (!gradesLoaded) {
      const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
      subMap = {}
      subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
      setGradeSubMap(subMap); setGradesLoaded(true)
    }
    return { students, submissions: Object.values(subMap) }
  }

  // Ungated per-parcial exports (used by the top Excel/PDF ⋮ menus for a
  // "progress" print at any time).
  async function doExportParcialExcel(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    if (!(await confirmExportNotice())) return
    setExporting(true)
    try {
      const { students, submissions } = await ensureGradesData()
      await exportParcialGrades({ subject, activities, students, submissions, parcial: p, watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExporting(false) }
  }
  async function doExportParcialPDF(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    if (!(await confirmExportNotice())) return
    setExportingGradesPdf(true)
    try {
      const { students, submissions } = await ensureGradesData()
      await exportParcialGradesPDF({ subject, activities, students, submissions, parcial: p, watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar PDF: ' + err.message, 'error') }
    finally { setExportingGradesPdf(false) }
  }

  // Asistencia — TODO y por parcial (⋮), mismo patrón que Calificaciones. Sin
  // PDF: en una hoja de asistencia (muchas columnas angostas por día) no
  // tiene caso, Excel es el formato natural. groupStudents/attendanceParciales
  // ya están cargados porque el botón solo se ve con la pestaña abierta.
  async function handleExportAttendance() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    if (!(await confirmExportNotice())) return
    setExportingAttendance(true)
    try {
      // Exportar SIEMPRE es del curso completo, sin importar el interruptor
      // "Parcial actual / Todo el curso" (ese es solo para lo que se pinta
      // en pantalla) — por eso usa attendanceParcialesAll, no la variable
      // filtrada attendanceParciales.
      await exportSubjectAttendance({ subject, students: groupStudents, attendanceParciales: attendanceParcialesAll, watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExportingAttendance(false) }
  }
  async function doExportParcialAttendance(p) {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    if (!(await confirmExportNotice())) return
    setExportingAttendance(true)
    try {
      await exportParcialAttendance({ subject, students: groupStudents, attendanceParciales: attendanceParcialesAll, parcial: p, watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
    finally { setExportingAttendance(false) }
  }


  // R12: grades as PDF (same data as the Excel export).
  async function handleExportGradesPDF() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    const falta = ponderacionIncompleta()
    if (falta) {
      toast(`La ponderación del Parcial ${falta.p} suma ${falta.total} de 10 — complétala antes de generar las calificaciones`, 'warning')
      return
    }
    if (!(await confirmExportNotice())) return
    setExportingGradesPdf(true)
    try {
      let students = groupStudents
      let subMap = gradeSubMap
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (!gradesLoaded) {
        const subDocs = await fetchSubmissionsForActivities(activities.map((a) => a.id))
        subMap = {}
        subDocs.forEach((d) => { const data = { id: d.id, ...d.data() }; subMap[`${data.alumnoId}-${data.actividadId}`] = data })
        setGradeSubMap(subMap); setGradesLoaded(true)
      }
      await exportSubjectGradesPDF({ subject, activities, students, submissions: Object.values(subMap), watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar PDF: ' + err.message, 'error') }
    finally { setExportingGradesPdf(false) }
  }

  // R16: download the access list (#, name, username + the class access code). No temp
  // passwords — each student sets their own password on first sign-in.
  async function handleGenerateCredentials() {
    if (descargaSoloWeb(toast)) return
    if (!subject) return
    if (!(await confirmExportNotice())) return
    setGeneratingCredentials(true)
    try {
      let students = groupStudents
      if (!groupStudentsLoaded) {
        const snap = await getDocs(query(collection(db, 'students'), where('asignaturaId', '==', subjectId)))
        students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setGroupStudents(students); setGroupStudentsLoaded(true)
      }
      if (students.length === 0) { toast('No hay estudiantes en esta asignatura', 'error'); return }

      const docenteNombre = userProfile?.nombreMostrar || userProfile?.nombre || ''
      await exportCredentialsPDF({ subject, students, docenteNombre, watermark: exportsWatermarked })
      toast('Lista de acceso descargada')
      setShowCredentialsModal(false)
    } catch (err) { toast('Error: ' + err.message, 'error') }
    finally { setGeneratingCredentials(false) }
  }

  // ── Computed ───────────────────────────────────────────────────────
  const PARCIALES = useMemo(() => Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1), [subject?.parciales])

  // "Actividad" labels (1.1, 1.2…) are presentation, not stored data — always
  // derived from each activity's position within its parcial in the current
  // `activities` list (kept sorted by `orden`). Computing this fresh on every
  // render means the displayed sequence can never drift out of order/gapped,
  // regardless of creation order, deletions, or stale stored values.
  // Drafts (hidden, never published, not scheduled) get NO number until they
  // are published — the sequence belongs to published activities only, so a
  // deleted publication's number passes to the next thing published.
  const activityLabelById = {}
  PARCIALES.forEach((p) => {
    activities.filter((a) => a.parcial === p && !isDraftActivity(a)).forEach((a, i) => {
      // Trailing dot is part of the label everywhere: "1.2." (project-wide convention)
      activityLabelById[a.id] = `${p}.${i + 1}.`
    })
  })

  // Posición de la actividad del ⋮ abierto dentro de su parcial — para
  // deshabilitar "Subir"/"Bajar" cuando ya está en un extremo.
  const activityMenuSiblings = activityMenu ? activities.filter((x) => x.parcial === activityMenu.a.parcial) : []
  const activityMenuIdx = activityMenu ? activityMenuSiblings.findIndex((x) => x.id === activityMenu.a.id) : -1

  // Preview of the auto-assigned "Actividad" label shown (read-only) in the modal.
  const previewActividad = modalMode === 'create'
    ? `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial && !isDraftActivity(a)).length + 1}.`
    : (activityLabelById[editActivityId] || '—')

  const filteredGradeStudents = groupStudents.filter((s) => matchesStudentSearch(s, searchGrade))
  // Memoizados: la tabla de Asistencias puede tener miles de celdas, y sin
  // esto se recalculaba (y la tabla completa se reconstruía) en CADA cambio
  // de estado del componente — incluyendo escribir en el modal de
  // Justificación o cerrarlo, lo que se sentía como el propio modal
  // trabado. Ahora solo se recalcula cuando sus datos de verdad cambian.
  const filteredAttendanceStudents = useMemo(
    () => groupStudents.filter((s) => matchesStudentSearch(s, searchAttendance)),
    [groupStudents, searchAttendance]
  )
  // Un "día" agrupa sus slots consecutivos (1..duracion) — usado tanto para el
  // encabezado (mostrar la fecha una sola vez, con su duración) como para borrar
  // el día completo de una sola vez.
  // Cada "día" (fecha) agrupa sus slots; su parcial es el de sus registros
  // (todos se crean juntos). Registros viejos sin parcial → Parcial 1.
  const attendanceDays = useMemo(() => [...new Set(attendanceRecords.map((r) => r.fecha))]
    .map((fecha) => {
      const records = attendanceRecords.filter((r) => r.fecha === fecha)
      return { fecha, parcial: records[0]?.parcial || 1, records }
    }), [attendanceRecords])

  // Agrupa días consecutivos por mes (YYYY-MM) → celda "Mes Año" que abarca sus días.
  const groupDaysByMonth = (days) => days.reduce((acc, day) => {
    const ym = day.fecha.slice(0, 7)
    const last = acc[acc.length - 1]
    if (last && last.ym === ym) last.days.push(day)
    else acc.push({ ym, days: [day] })
    return acc
  }, [])

  // Agrupa por parcial (nivel superior, arriba del mes). Cada grupo lleva sus meses,
  // todos sus registros (para contar asistencias) y cuántas columnas de día ocupa.
  // TODOS los parciales con días — la tabla real solo pinta un subconjunto
  // de esto (ver attendanceParciales abajo), pero se necesita completo para
  // calcular cuál es "el parcial actual".
  const attendanceParcialesAll = useMemo(() => PARCIALES
    .map((p) => ({ parcial: p, days: attendanceDays.filter((d) => d.parcial === p) }))
    .filter((g) => g.days.length > 0)
    .map((g) => ({
      ...g,
      months: groupDaysByMonth(g.days),
      records: g.days.flatMap((d) => d.records),
      slotCount: g.days.reduce((n, d) => n + d.records.length, 0),
    })), [PARCIALES, attendanceDays])

  // El parcial "actual" — el que contiene la fecha de hoy según
  // subject.parcialesFechas. Si el curso no tiene fechas configuradas, o hoy
  // cae fuera de todos los rangos (antes de empezar / ya terminó), cae al
  // primero o último parcial CON días de asistencia (nunca a uno vacío).
  const attendanceParcialActual = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10)
    const pf = subject?.parcialesFechas
    if (pf?.length) {
      const idx = pf.findIndex((r) => r?.inicio && r?.fin && hoy >= r.inicio && hoy <= r.fin)
      if (idx >= 0) return idx + 1
      if (pf[0]?.inicio && hoy < pf[0].inicio) return 1
      return pf.length
    }
    if (!attendanceParcialesAll.length) return 1
    return attendanceParcialesAll[attendanceParcialesAll.length - 1].parcial
  }, [subject?.parcialesFechas, attendanceParcialesAll])

  // Pedido explícito: por defecto (y siempre en la App) solo se pinta el
  // parcial actual — antes se armaba TODA la tabla del curso completo de
  // una sola vez, la causa real de que la pestaña se sintiera pesada con un
  // semestre entero de días. En la web, un interruptor deja ver el curso
  // completo cuando de verdad se necesita.
  const [showAllParciales, setShowAllParciales] = useState(false)
  const attendanceParciales = useMemo(() => (
    !IS_NATIVE_APP && showAllParciales
      ? attendanceParcialesAll
      : attendanceParcialesAll.filter((g) => g.parcial === attendanceParcialActual)
  ), [attendanceParcialesAll, attendanceParcialActual, showAllParciales])

  // Registros mostrados (unión de los parciales visibles) — base de los totales.
  const attendanceAllRecords = useMemo(() => attendanceParciales.flatMap((g) => g.records), [attendanceParciales])

  // Drafts don't grade anything — keep them out of the Calificaciones table
  const tableParcials = PARCIALES.map((p) => ({
    p, acts: activities.filter((a) => a.parcial === p && !isDraftActivity(a)),
  })).filter((pd) => pd.acts.length > 0)

  // Sequential index per real grade column (activities + parcial averages +
  // final average), shared by header and body cells via data-col so
  // handleGradeTableHover can tell which column is under the cursor.
  let _colIdx = 0
  const colIndexByKey = {}
  tableParcials.forEach(({ p, acts }) => {
    acts.forEach((a) => { colIndexByKey[`act-${a.id}`] = _colIdx++ })
    colIndexByKey[`avg-${p}`] = _colIdx++
  })
  colIndexByKey.final = _colIdx++

  // Event delegation: one listener on the table instead of one per cell.
  // Reads data-row/data-col off the hovered element (or its closest
  // ancestor that has them) and only updates state when they actually
  // change, so moving within the same cell doesn't re-render.
  const handleGradeTableHover = (e) => {
    const cell = e.target.closest('[data-col]')
    const row = e.target.closest('[data-row]')
    const col = cell ? Number(cell.getAttribute('data-col')) : null
    const rowIdx = row ? Number(row.getAttribute('data-row')) : null
    setHoverGradeCell((prev) => (prev.row === rowIdx && prev.col === col ? prev : { row: rowIdx, col }))
  }
  const handleGradeTableLeave = () => setHoverGradeCell({ row: null, col: null })
  const gradeHeaderColBg = (colIdx) => (hoverGradeCell.col === colIdx ? 'bg-[var(--accent-tint)]' : '')
  const gradeBodyCellBg = (colIdx, rowIdx) => {
    if (hoverGradeCell.col !== colIdx) return ''
    return hoverGradeCell.row === rowIdx
      ? 'bg-[var(--accent-tint-strong)] ring-1 ring-inset ring-[var(--accent)]'
      : 'bg-[var(--accent-tint)]'
  }

  // ── PONDERACIÓN (optional per-activity weights, per PARCIAL) ────────
  // A teacher may weight only some parciales (e.g. simple average in P1,
  // weighted in P2). `ponderacionParciales` holds the per-parcial switches;
  // the legacy subject-wide flag is the fallback for old subjects.
  const pondParcial = (p) => ponderacionActivaEnParcial(subject, p)
  const ALL_PARCIALES = Array.from({ length: subject?.parciales || 3 }, (_, i) => i + 1)
  const anyPonderacionOn = ALL_PARCIALES.some(pondParcial)
  // Parciales that actually have activities — offered in the per-parcial export menus
  const parcialesConActividades = ALL_PARCIALES.filter((p) => activities.some((a) => a.parcial === p && !isDraftActivity(a)))

  // Global button: turns EVERY parcial on/off at once
  function togglePonderacion() {
    const next = !anyPonderacionOn
    // Going BACK to simple average when weights already exist needs an
    // explicit confirmation — shown in a panel anchored to the button
    // (the browser's native confirm() always appears top-center)
    const conPeso = activities.filter((a) => pesoDe(a) > 0)
    if (!next && conPeso.length > 0) {
      setConfirmRevertPonderacion(true)
      playAlertSound()
      return
    }
    applyPonderacion(next)
  }

  async function applyPonderacion(next) {
    setConfirmRevertPonderacion(false)
    const conPeso = activities.filter((a) => pesoDe(a) > 0)
    try {
      const map = {}
      ALL_PARCIALES.forEach((p) => { map[p] = next })
      // Activation always starts with weights HIDDEN from students; the
      // teacher's later choice (eye toggle) persists across visits
      const updates = next
        ? { ponderacionActivada: true, ponderacionParciales: map, ponderacionVisibleAlumnos: false }
        : { ponderacionActivada: false, ponderacionParciales: map }
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      // On activation weights start at 0 — the teacher types them. Only clear
      // existing weights when going back to simple average.
      if (!next && conPeso.length > 0) {
        const batch = writeBatch(db)
        conPeso.forEach((a) => batch.update(doc(db, 'activities', a.id), { pesoCalificacion: null }))
        await batch.commit()
        setActivities((prev) => prev.map((x) => x.pesoCalificacion != null ? { ...x, pesoCalificacion: null } : x))
        setPesoEdits({})
      }
      setSubject((s) => ({ ...s, ...updates }))
      toast(next
        ? 'Ponderación activada — escribe el peso de cada actividad (deben sumar 10 para exportar)'
        : 'Promedio simple activado — los pesos se borraron')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Per-parcial switch (the button in the amber weights row)
  function toggleParcialPonderacion(p) {
    const next = !pondParcial(p)
    const conPeso = activities.filter((a) => a.parcial === p && pesoDe(a) > 0)
    if (!next && conPeso.length > 0) {
      setConfirmRevertParcial(p)
      playAlertSound()
      return
    }
    applyParcialPonderacion(p, next)
  }

  async function applyParcialPonderacion(p, next) {
    setConfirmRevertParcial(null)
    try {
      // Materialize the whole map so every parcial's state is explicit from now on
      const map = {}
      ALL_PARCIALES.forEach((pp) => { map[pp] = pp === p ? next : pondParcial(pp) })
      const any = Object.values(map).some(Boolean)
      const updates = { ponderacionParciales: map, ponderacionActivada: any }
      if (next && !anyPonderacionOn) updates.ponderacionVisibleAlumnos = false
      await updateDoc(doc(db, 'subjects', subjectId), updates)
      // On activation weights start at 0 — the teacher types them. Only clear
      // this parcial's weights when going back to simple average.
      if (!next) {
        const conPeso = activities.filter((a) => a.parcial === p && pesoDe(a) > 0)
        if (conPeso.length) {
          const batch = writeBatch(db)
          conPeso.forEach((a) => batch.update(doc(db, 'activities', a.id), { pesoCalificacion: null }))
          await batch.commit()
          setActivities((prev) => prev.map((x) => x.parcial === p && x.pesoCalificacion != null ? { ...x, pesoCalificacion: null } : x))
        }
      }
      setSubject((s) => ({ ...s, ...updates }))
      toast(next
        ? `Ponderación activada en el Parcial ${p} — escribe los pesos (deben sumar 10 para exportar)`
        : `Parcial ${p} con promedio simple — sus pesos se borraron`)
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Whether STUDENTS see the weights. The weighted average is always the
  // official one; this only controls showing "Vale X de 10" on their view —
  // some teachers weight privately for servicios escolares, others announce it.
  async function togglePonderacionVisible() {
    const next = !subject?.ponderacionVisibleAlumnos
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { ponderacionVisibleAlumnos: next })
      setSubject((s) => ({ ...s, ponderacionVisibleAlumnos: next }))
      toast(next
        ? 'Los estudiantes ahora ven el peso de cada actividad'
        : 'Pesos ocultos para los estudiantes — solo tú los ves')
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Aviso push cuando un estudiante se activa (o se reactiva tras un reinicio
  // de contraseña) en ESTA asignatura — a diferencia de otras categorías, no
  // vive en Ajustes > Notificaciones (un ajuste global), sino aquí: es una
  // decisión por asignatura. La Cloud Function (onEstudianteActivado) lee
  // este campo directo del documento de la asignatura. Activado por
  // defecto (campo ausente = true) — este checkbox es para APAGARLO en una
  // asignatura puntual, no para prenderlo.
  async function toggleNotificarActivacion() {
    const next = subject?.notificarActivacion === false
    try {
      await updateDoc(doc(db, 'subjects', subjectId), { notificarActivacion: next })
      setSubject((s) => ({ ...s, notificarActivacion: next }))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }


  // Points still available in the parcial (10 − sum of the OTHER activities),
  // using in-progress edits. Used ONLY to cap each box so the total can never
  // exceed 10 — NOT to pre-fill or suggest a value (the teacher types freely,
  // any sum ≤ 10 is fine; exactly 10 is required only to export).
  function pesoRestante(acts, exceptId) {
    const sum = acts.reduce((t, x) => {
      if (x.id === exceptId) return t
      const edit = pesoEdits[x.id]
      const v = edit !== undefined ? parseFloat(edit) : parseFloat(x.pesoCalificacion)
      return t + (isNaN(v) || v < 0 ? 0 : v)
    }, 0)
    return Math.max(0, parseFloat((10 - sum).toFixed(2)))
  }

  // Live parcial total: includes the in-progress edits (typing), so the 10
  // indicator reacts on every keystroke, not only after blur
  function pesoTotalVivo(acts) {
    const sum = acts.reduce((t, x) => {
      const edit = pesoEdits[x.id]
      const v = edit !== undefined ? parseFloat(edit) : parseFloat(x.pesoCalificacion)
      return t + (isNaN(v) || v < 0 ? 0 : v)
    }, 0)
    return parseFloat(sum.toFixed(2))
  }

  // Auto-commit: wheel adjustments never blur the input, so pending edits
  // are clamped+saved shortly after the last change (typing still commits
  // on blur immediately). This is what guarantees the parcial can't stay
  // above 10.
  useEffect(() => {
    const ids = Object.keys(pesoEdits)
    if (!ids.length) return
    const t = setTimeout(() => {
      ids.forEach((id) => {
        const act = activities.find((x) => x.id === id)
        if (act) savePeso(act)
      })
    }, 800)
    return () => clearTimeout(t)
  }, [pesoEdits]) // eslint-disable-line react-hooks/exhaustive-deps

  async function savePeso(a) {
    const raw = pesoEdits[a.id]
    if (raw === undefined) return
    let num = parseFloat(raw)
    if (isNaN(num) || num < 0) num = null
    // Cap so the parcial total can NEVER exceed 10 (the teacher can go under —
    // exactly 10 is only required to export). No auto-fill or suggestions.
    if (num !== null) {
      const actsParcial = activities.filter((x) => x.parcial === a.parcial && !isDraftActivity(x))
      const restante = pesoRestante(actsParcial, a.id)
      if (num > restante) num = restante
    }
    setPesoEdits((f) => { const n = { ...f }; delete n[a.id]; return n })
    if ((a.pesoCalificacion ?? null) === num) return
    try {
      await updateDoc(doc(db, 'activities', a.id), { pesoCalificacion: num })
      setActivities((prev) => prev.map((x) => x.id === a.id ? { ...x, pesoCalificacion: num } : x))
    } catch (err) { toast('Error: ' + err.message, 'error') }
  }

  // Pre-compute grade rows
  // Orden por promedio (mayor a menor) con columna LUGAR — opcional, por parcial
  // o general. El número de lista del estudiante (No.) NO cambia; LUGAR es su
  // posición en el ranking.
  const [gradeSortOn, setGradeSortOn] = useState(false)
  const [gradeSortParcial, setGradeSortParcial] = useState(null) // null = general
  const [gradeSortMenuOpen, setGradeSortMenuOpen] = useState(false)
  const [rankingExportMenu, setRankingExportMenu] = useState(null) // null | 'excel' | 'pdf'

  const gradeRows = filteredGradeStudents.map((s) => {
    const parcialData = tableParcials.map(({ p, acts }) => {
      const grades = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return normalizeGrade(sub?.calificacion, a.maxCalif, { decimals: 1 })
      })
      // Which grades were auto-assigned by closing the parcial (shown in red)
      const gradesCierre = acts.map((a) => {
        const sub = gradeSubMap[`${s.id}-${a.id}`]
        return !!(sub && sub.cierreParcial)
      })
      const rawAvg = promedioParcial(acts, grades, pondParcial(p))
      const avg = rawAvg !== null ? parseFloat(rawAvg.toFixed(1)) : null
      return { p, grades, gradesCierre, avg }
    })
    const validAvgs = parcialData.map((pd) => pd.avg).filter((a) => a !== null)
    const finalAvg = validAvgs.length
      ? parseFloat((validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length).toFixed(1))
      : null
    return { s, parcialData, finalAvg }
  })

  // Valor por el que se ordena (promedio del parcial elegido o el general).
  const gradeSortValue = (row) => gradeSortParcial == null
    ? row.finalAvg
    : (row.parcialData.find((pd) => pd.p === gradeSortParcial)?.avg ?? null)
  const sortedGradeRows = gradeSortOn
    ? [...gradeRows].sort((a, b) => {
        const av = gradeSortValue(a)
        const bv = gradeSortValue(b)
        if (av == null && bv == null) return 0
        if (av == null) return 1      // sin promedio → al final
        if (bv == null) return -1
        return bv - av                // mayor a menor
      })
    : gradeRows

  // Al ordenar por un parcial específico, se ocultan los demás parciales y el
  // Final (queda solo LUGAR, Nombre y ese parcial). Con "General" se ven todos.
  const soloParcial = gradeSortOn && gradeSortParcial != null
  const visibleParcials = soloParcial ? tableParcials.filter((tp) => tp.p === gradeSortParcial) : tableParcials
  const showFinalCol = !soloParcial

  // Al ordenar: n = PARTE ENTERA del 20% del total. Los n PRIMEROS del ranking
  // (mayor promedio) → verde; los n ÚLTIMOS (menor desempeño; los que no han
  // entregado nada quedan al final) → naranja. Sin ordenar, n = 0 y no se
  // resalta nada (ojo: slice(-0) devolvería TODO, por eso el guard de n > 0).
  const gradeHlCount = gradeSortOn ? Math.floor(sortedGradeRows.length * 0.2) : 0
  const gradeTopIds = new Set(gradeHlCount > 0 ? sortedGradeRows.slice(0, gradeHlCount).map((r) => r.s.id) : [])
  // El naranja excluye a quienes ya son verdes (grupos chicos donde se traslapan).
  const gradeBottomIds = new Set(
    gradeHlCount > 0
      ? sortedGradeRows.slice(-gradeHlCount).map((r) => r.s.id).filter((id) => !gradeTopIds.has(id))
      : []
  )

  // Filas del ranking (LUGAR, Nombre, Promedio) ordenadas por el parcial
  // elegido (null = general) — para exportar a Excel/PDF.
  function rankingRowsFor(parcial) {
    const list = gradeRows.map(({ s, parcialData, finalAvg }) => ({
      orden: s.orden,
      nombre: studentFullName(s),
      promedio: parcial == null ? finalAvg : (parcialData.find((pd) => pd.p === parcial)?.avg ?? null),
    }))
    list.sort((a, b) => {
      if (a.promedio == null && b.promedio == null) return 0
      if (a.promedio == null) return 1
      if (b.promedio == null) return -1
      return b.promedio - a.promedio
    })
    return list.map((r, i) => ({ lugar: i + 1, ...r }))
  }
  async function doExportRanking(kind, parcial) {
    if (descargaSoloWeb(toast)) return
    setRankingExportMenu(null)
    if (!(await confirmExportNotice())) return
    const rows = rankingRowsFor(parcial)
    const label = parcial == null ? 'Promedio final' : `Parcial ${parcial}`
    try {
      if (kind === 'excel') await exportRankingExcel({ subject, rows, label, watermark: exportsWatermarked })
      else await exportRankingPDF({ subject, rows, label, watermark: exportsWatermarked })
    } catch (err) { toast('Error al exportar: ' + err.message, 'error') }
  }

  const filteredAlumnos = groupStudents.filter((s) =>
    matchesStudentSearch(s, searchAlumnos) ||
    (s.username || '').toLowerCase().includes(searchAlumnos.trim().toLowerCase())
  )

  // Tabla de asistencias — ver componente AttendanceTable (memo) arriba.
  const attendanceTableJsx = (
    <AttendanceTable
      attendanceParciales={attendanceParciales}
      filteredAttendanceStudents={filteredAttendanceStudents}
      attendanceAllRecords={attendanceAllRecords}
      onCellClick={stableCellClick}
      onDeleteDay={stableDeleteDay}
      onBack={stableAttBack}
      onAddDay={stableAddDay}
      addDayLabel={addDayLabel}
      lastEditedCell={lastEditedAttCell}
      parcialesFechas={subject?.parcialesFechas}
    />
  )

  // Leyenda de estados de asistencia (compartida web/app) — en la web el
  // texto queda solo un poco más grande que los nombres de la tabla (text-sm),
  // y los íconos del mismo tamaño que tienen en las celdas (w-6 h-6, 14px);
  // la app se queda como estaba. Ya no hay clic derecho/mantener presionado
  // como atajo aparte (se quitó por completo) — un clic/toque más sobre la
  // "J con puntito" abre lo mismo para revisar/editar el motivo.
  const attendanceLegend = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 px-1 text-muted ${IS_NATIVE_APP ? 'text-[11px]' : 'text-base'}`}>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-green-100 text-green-600 ${IS_NATIVE_APP ? 'w-4 h-4' : 'w-6 h-6'}`}><CheckIcon size={IS_NATIVE_APP ? 11 : 14} /></span>
        Asistencia
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-red-100 text-red-500 ${IS_NATIVE_APP ? 'w-4 h-4' : 'w-6 h-6'}`}><X size={IS_NATIVE_APP ? 11 : 14} /></span>
        Falta
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`inline-flex items-center justify-center rounded bg-amber-100 text-amber-600 font-bold leading-none ${IS_NATIVE_APP ? 'w-4 h-4 text-[10px]' : 'w-6 h-6 text-[12px]'}`}>J</span>
        Justificada sin motivo (cuenta como asistencia)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={`relative inline-flex items-center justify-center rounded bg-amber-100 text-amber-600 font-bold leading-none ${IS_NATIVE_APP ? 'w-4 h-4 text-[10px]' : 'w-6 h-6 text-[12px]'}`}>
          J
          <span className={`absolute -top-0.5 -right-0.5 rounded-full bg-amber-500 ${IS_NATIVE_APP ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} />
        </span>
        Justificada con motivo
      </span>
      <span className="text-slate-400">· Toca para cambiar el estado</span>
    </div>
  )

  // Motivos rápidos para justificar una falta (botones de un toque).
  const QUICK_MOTIVOS = [
    { emoji: '🤒', label: 'Salud' },
    { emoji: '👨‍👩‍👧', label: 'Familiar' },
    { emoji: '🏫', label: 'Escolar' },
    { emoji: '📅', label: 'Cita o trámite' },
  ]
  // compact = tamaño de la app (columna angosta de 16rem); la web usa texto e
  // iconos más grandes porque ahí sobra espacio horizontal de sobra.
  const renderQuickMotivo = (compact) => (
    <div className="grid grid-cols-2 gap-2">
      {QUICK_MOTIVOS.map((m) => (
        <button key={m.label} type="button" onClick={() => setReasonText(m.label)}
          className={`rounded border font-medium whitespace-nowrap transition-colors ${compact ? 'px-1.5 py-2 text-[10px]' : 'px-3 py-2.5 text-sm'} ${
            reasonText.trim() === m.label
              ? 'border-amber-500 bg-amber-50 text-amber-700'
              : 'border-outline-variant text-on-surface hover:bg-[var(--accent-tint)]'
          }`}>
          <span className={compact ? '' : 'text-base'}>{m.emoji}</span> {m.label}
        </button>
      ))}
    </div>
  )
  const quickMotivoButtons = renderQuickMotivo(true)
  const quickMotivoButtonsLg = renderQuickMotivo(false)

  // Barra simple para la vista horizontal (app) SOLO en estados sin tabla
  // (cargando / sin alumnos / sin días). Con datos, los controles van en la
  // esquina superior izquierda de la tabla (ver attendanceTableJsx).
  const nativeAttBar = (
    <div className="flex items-center gap-2 px-2 py-1 bg-accent-light border-b border-outline-variant">
      {/* Mismo botón verde fosforescente que en la tabla con datos — igual
          color y tamaño en cualquier asignatura */}
      <button type="button" onClick={() => switchTab('actividades')} aria-label="Regresar"
        className="flex-none px-2.5 py-1 rounded bg-[#39FF14] text-black hover:bg-[#2ee510] transition-colors">
        <ArrowLeft size={20} />
      </button>
      <span className="text-sm font-bold text-on-surface uppercase tracking-wide">Asistencias</span>
      {addDayLabel && (
        <button type="button" onClick={handleAddDayClick}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-accent text-white text-xs font-medium rounded hover:bg-accent-hover transition-colors">
          <CalendarPlus size={14} /> {addDayLabel}
        </button>
      )}
    </div>
  )

  if (loading) return (
    <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  )

  // Botones de acción del encabezado, en dos grupos reutilizables (izquierda:
  // QR/link/código — derecha: editar/duplicar/archivar/eliminar). Se renderizan
  // en DOS layouts distintos más abajo (móvil apilado / escritorio en fila) en
  // vez de un solo flex-wrap responsivo: varios intentos de hacerlo con un
  // único contenedor (spacer flex-1, flex-shrink-0, basis-full, w-max — todos
  // fallaron) tropezaron con una ambigüedad conocida de flexbox cuando un div
  // es a la vez flex-item de la fila exterior Y flex-container con su propio
  // wrap para sus botones — el navegador terminaba encogiéndolo por debajo de
  // su contenido real (o reportando un scrollWidth "fantasma"), desbordando
  // toda la página. Con display:none/flex (hidden/flex) en vez de shrink/basis
  // no hay ambigüedad posible: cada layout es una fila plana normal.
  // Solo el CÓDIGO. El QR y el link de activación se quitaron a propósito: le
  // resolvían al alumno el paso de escribir el código, y así nunca se enteraba
  // de que su asignatura tiene uno. Eso lo dejaba varado después, cuando en la
  // app —que no trae lector de QR— unirse a otra materia exige teclearlo. Una
  // sola forma de entrar, la misma en web y en app.
  const subjectHeaderLeftIcons = (
    <>
      <button type="button" onClick={copyAccessCode}
        data-tooltip="Copiar código de acceso para estudiantes"
        className={`flex items-center gap-2 px-2 py-1.5 rounded transition-all duration-200 flex-shrink-0 font-mono font-bold text-2xl ${copiedCode ? 'text-emerald-600 bg-emerald-50' : 'text-accent hover:bg-[var(--accent-medium)]'}`}>
        {copiedCode
          ? <><CheckIcon size={22} className="animate-bounce flex-shrink-0" /><span>Copiado</span></>
          : <span>{subject?.accessCode}</span>}
      </button>
    </>
  )
  // Los cuatro (editar, duplicar, archivar, eliminar) van igual en web y en
  // app. Duplicar/archivar/eliminar estaban solo en la web por falta de
  // espacio en el renglón; al quitarse el QR y el link ya caben. Sus modales
  // nunca estuvieron restringidos, así que funcionaban desde el primer día.
  const subjectHeaderRightIcons = (
    <>
      {/* ml-auto en el PRIMER botón de este grupo: empuja editar/duplicar/
          archivar/eliminar hasta la orilla derecha del renglón, comiéndose
          todo el espacio libre. Va en un botón suelto (hijo plano del
          flex-wrap), no en un div contenedor — así se conserva la fila plana
          que evita el desbordamiento descrito arriba. Si la fila envuelve,
          el grupo simplemente queda alineado a la derecha del renglón nuevo. */}
      <button type="button" onClick={openEditSubject}
        aria-label="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
        data-tooltip="Editar los datos de la asignatura (nombre, grupo, color, icono…)"
        className="p-2 ml-auto text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
        <Pencil size={21} />
      </button>
      <button type="button" onClick={openCopyModal}
        aria-label="Duplicar esta asignatura (con o sin la lista de estudiantes)"
        data-tooltip="Duplicar esta asignatura (con o sin la lista de estudiantes)"
        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
        <Copy size={21} />
      </button>
      <button type="button" onClick={handleToggleArchive} disabled={archiving}
        aria-label={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (la guarda completa; sale de tus asignaturas activas)'}
        data-tooltip={subject?.archived ? 'Restaurar asignatura (vuelve a tus asignaturas activas)' : 'Archivar asignatura (la guarda completa; sale de tus asignaturas activas)'}
        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors disabled:opacity-40 flex-shrink-0">
        {subject?.archived ? <ArchiveRestore size={21} /> : <Archive size={21} />}
      </button>
      <button type="button" onClick={() => { setDeleteSubjectConfirmText(''); setShowDeleteSubjectConfirm(true) }}
        aria-label="Eliminar la asignatura permanentemente (no se puede deshacer)"
        data-tooltip="Eliminar la asignatura permanentemente (no se puede deshacer)"
        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
        <Trash2 size={21} />
      </button>
    </>
  )

  return (
    <>
      <div {...subjectPaletteProps(subject?.colorPalette)}>
      <div className={TEACHER_CONTAINER}>

        {/* ── Header ──
            Esquinas de ABAJO redondeadas (arriba no: ahí topa con la barra
            superior). Con el lienzo azul, este bloque blanco pasó a leerse como
            una tarjeta, y una tarjeta que termina en canto recto se ve cortada,
            no terminada. */}
        <div className="bg-surface-card border-b border-outline-variant rounded-b-card px-4 py-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goBack} className="p-2 -ml-2 text-slate-400 hover:text-muted rounded flex-shrink-0">
              <ArrowLeft size={22} />
            </button>
            <div className="w-9 h-9 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
              <SubjectIcon iconKey={subject?.icon} size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl font-bold text-on-surface truncate min-w-0">
                  {subjectDisplayName(subject)}
                  {subject?.fechaInicio && subject?.fechaFin && (
                    <span className="text-xs font-medium text-slate-400 ml-1.5 tabular-nums align-middle">
                      ({formatShortDateRange(subject.fechaInicio, subject.fechaFin)})
                    </span>
                  )}
                </h1>
                {subject?.archived && (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">Archivada</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons — UNA sola fila plana con flex-wrap, sin grupos
              anidados: cada intento de agrupar visualmente "izquierda" y
              "derecha" (spacer flex-1, flex-shrink-0, basis-full, w-max,
              incluso dos layouts hidden/flex separados) fallaba en algún
              ancho de pantalla por una ambigüedad de flexbox anidado — un div
              que es a la vez flex-item de la fila exterior Y flex-container
              con su propio wrap terminaba encogiéndose por debajo de su
              contenido real (o reportando un scrollWidth "fantasma"),
              desbordando toda la página. Con los botones como hijos PLANOS de
              un solo flex-wrap no hay nada anidado que ambigüe: el navegador
              envuelve la fila en tantos renglones como haga falta, en
              cualquier ancho, sin excepción. Se pierde el espacio extra entre
              el grupo de "compartir" y el de "administrar", pero la fila
              nunca vuelve a desbordar la página. */}
          {/* SIN overflow-hidden: los tooltips de estos botones se dibujan
              ARRIBA del botón, o sea fuera de esta caja, y con overflow-hidden
              quedaban recortados — invisibles. Antes no se notaba porque la
              fila traía dos botones más (QR y link) y se partía en dos
              renglones: los del segundo sí tenían espacio arriba, dentro de la
              caja. Al quedar todo en un renglón se recortaron todos.
              Quitarlo es seguro para el desbordamiento que arreglaba el #499:
              lo que de verdad lo resolvió fue que estos botones sean hijos
              PLANOS de un solo flex-wrap (ver el comentario de arriba), no el
              recorte. */}
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {subjectHeaderLeftIcons}
            {subjectHeaderRightIcons}
          </div>

          {/* Aún sin estudiantes: aviso debajo del código de acceso. totalStudents
              se calcula al cargar la materia (no depende de haber visitado la
              pestaña Estudiantes), así que está listo desde el primer render. */}
          {totalStudents === 0 && (
            <p className="text-xs text-red-500 mt-1">
              Antes de compartir estos datos, agrega estudiantes manualmente o mediante la
              plantilla de Excel en la pestaña Estudiantes{IS_NATIVE_APP ? ' en la web' : ''}.
            </p>
          )}

          {/* Tabs — Calificaciones/Estudiantes solo en la web; Asistencia en ambos
              (en nativo va entre Actividades y Recursos, único hueco disponible). */}
          {/* overflow-x-auto + sin flex-1 forzado en móvil (mismo patrón que
              la barra de pestañas del alumno): 5 pestañas a ancho igual no
              caben legibles en 375px ("Calificaciones"/"Estudiantes" se
              recortaban), forzando overflow de TODA la página en vez de solo
              esta fila. sm:flex-1 restaura el ancho igual de siempre en
              escritorio, donde sí caben cómodas. */}
          <div className="relative">
            <div ref={tabsScrollRef} className="flex gap-1 mt-2 bg-surface-container p-1 rounded overflow-x-auto">
              {(IS_NATIVE_APP
                ? ['actividades', 'asistencia', 'alumnos', 'recursos', 'avisos']
                : ['actividades', 'calificaciones', 'asistencia', 'alumnos', 'recursos', 'avisos']
              ).map((t) => (
                <button type="button" key={t} onClick={() => switchTab(t)}
                  className={`flex-shrink-0 sm:flex-1 whitespace-nowrap px-3 sm:px-0 py-2 text-xs sm:text-sm font-medium rounded transition-colors ${
                    activeTab === t ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'
                  }`}>
                  {t === 'actividades' ? 'Actividades' : t === 'calificaciones' ? 'Calificaciones' : t === 'asistencia' ? 'Asistencias' : t === 'alumnos' ? 'Estudiantes' : t === 'recursos' ? 'Recursos' : 'Avisos'}
                </button>
              ))}
            </div>
            {/* Desvanecido + flecha: mismo indicio que la barra del alumno,
                solo aparece si de verdad hay pestañas fuera de vista y
                desaparece en cuanto el docente ya deslizó hasta el final. */}
            {tabsOverflow && (
              <div className="absolute right-0 top-2 bottom-0 flex items-center pointer-events-none bg-gradient-to-l from-surface-container via-surface-container to-transparent pl-6 pr-1 rounded-r">
                <ChevronRight size={16} className="text-accent animate-pulse" />
              </div>
            )}
          </div>
          {/* Aviso simple y permanente (no solo cuando no hay estudiantes,
              ver arriba) de por qué Calificaciones no aparece en la App —
              pedido explícito: es un área compleja para usar en móvil,
              mejor decirlo claro que dejarla sin explicación. Estudiantes sí
              aparece en la App, pero en versión simplificada (ver abajo). */}
          {IS_NATIVE_APP && (
            <p className="text-[11px] text-muted mt-1.5 text-center">
              Para ver Calificaciones, usa la web.
            </p>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            TAB: ACTIVIDADES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'actividades' && (
          <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
            {PARCIALES.map((p) => {
              const acts = activities.filter((a) => a.parcial === p)
              const mats = materials.filter((m) => m.parcial === p)
              const isOpen = openParcial === p
              const parcialOculto = (subject?.parcialesOcultos || []).includes(p)
              return (
                // Open parcial gets the same accent container treatment as the
                // Preguntas/Configuración sections — it's obvious you're inside it
                <div key={p} className={`bg-surface-card rounded-card overflow-hidden shadow-card ${isOpen ? 'border border-accent' : ''}`}>
                  <div className={`w-full flex items-center gap-1 ${isOpen ? 'bg-accent-light border-b border-accent' : ''}`}>
                    <button type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)}
                      className="flex-1 min-w-0 px-4 py-2 flex items-center gap-2 hover:bg-[var(--accent-medium)] transition-colors text-left">
                      <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${parcialOculto ? 'bg-surface-container' : 'bg-accent-light'}`}>
                        <span className={`font-bold text-sm ${parcialOculto ? 'text-slate-400' : 'text-accent'}`}>{p}</span>
                      </div>
                      <div className="text-left min-w-0">
                        <p className={`font-semibold text-base leading-tight truncate ${parcialOculto ? 'text-slate-400' : 'text-on-surface'}`}>
                          Parcial {p}{parcialOculto && <span className="text-xs font-normal text-slate-400"> · oculto a estudiantes</span>}
                          {subject?.parcialesFechas?.[p - 1] && (
                            <span className="text-xs font-medium text-slate-400 tabular-nums"> ({formatShortDate(subject.parcialesFechas[p - 1].inicio)} – {formatShortDate(subject.parcialesFechas[p - 1].fin)})</span>
                          )}
                        </p>
                        <p className="text-sm text-slate-500 leading-tight -mt-0.5">{acts.length} actividad{acts.length !== 1 ? 'es' : ''}</p>
                      </div>
                    </button>
                    <button type="button"
                      onClick={() => toggleParcialVisibility(p)}
                      aria-label={parcialOculto ? 'Mostrar este parcial a los estudiantes' : 'Ocultar este parcial a los estudiantes'}
                      data-tooltip={parcialOculto ? 'Mostrar este parcial a los estudiantes' : 'Ocultar este parcial a los estudiantes'}
                      data-tooltip-pos="left"
                      className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                    >
                      {parcialOculto ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    <button type="button" onClick={() => setOpenParcial(isOpen ? 0 : p)} className="p-2 mr-2 flex-shrink-0">
                      {isOpen ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-outline-variant pr-4 py-2">
                      <div className="ml-3 pl-3 border-l-2 border-accent space-y-1.5">
                      {acts.length === 0 && (
                        <p className="text-slate-400 text-sm text-center py-2">Sin actividades</p>
                      )}
                      {acts.map((a) => {
                        const counts = submissionCounts[a.id] || {}
                        const visState = activityVisibilityState(a, parcialOculto)
                        const isHidden = visState !== 'visible'
                        // Distinct icon per activity type so they're recognizable at a glance
                        const ActIcon = a.categoria === 'examen' ? GraduationCap
                          : a.categoria === 'cuestionario' ? ListChecks
                          : a.categoria === 'observacion' ? ClipboardCheck
                          : FileText
                        return (
                          <div key={a.id} className={`flex items-center gap-1 w-full rounded border bg-surface-card transition-colors duration-200 ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)]'}`}>
                            {/* A draft has nothing to grade — its row opens the editor instead
                                (igual en web y en la app nativa). */}
                            <button type="button"
                              onClick={() => {
                                if (isDraftActivity(a)) {
                                  openEdit(a, activityLabelById[a.id])
                                } else {
                                  navigate(`/activity/${a.id}`)
                                }
                              }}
                              data-tooltip-follow={isDraftActivity(a) ? 'Editar borrador' : a.tipo === 'evaluacion' ? 'Evaluación' : 'Evaluar'}
                              className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left">
                              <ActIcon size={20} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : a.categoria === 'examen' ? 'text-accent' : a.categoria === 'cuestionario' ? 'text-emerald-600' : a.categoria === 'observacion' ? 'text-amber-600' : 'text-slate-400'}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-slate-400' : 'text-on-surface'}`}>
                                  {activityLabelById[a.id] && <span className="text-accent font-semibold">{activityLabelById[a.id]} </span>}
                                  {a.nombre}
                                  <span className={`text-xs font-normal ${isHidden ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {' '}({a.categoria === 'examen' ? 'Examen' : a.categoria === 'cuestionario' ? 'Cuestionario' : a.categoria === 'observacion' ? 'Observación' : 'Entregable'})
                                  </span>
                                </p>
                                {((!IS_NATIVE_APP && (a.publishedAt || a.fechaLimite || a.publishAt)) || visState === 'hidden') && (
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {/* Fechas de publicación/cierre: solo en la web */}
                                    {!IS_NATIVE_APP && a.publishedAt && (
                                      <span data-tooltip="Publicado" className="text-xs text-emerald-600 flex items-center gap-0.5">
                                        <Clock size={14} /> {formatPublishAt(a.publishedAt)}
                                      </span>
                                    )}
                                    {!IS_NATIVE_APP && a.publishAt && (
                                      <span data-tooltip="Publicación programada" className="text-xs text-accent flex items-center gap-0.5">
                                        <Clock size={14} /> {formatPublishAt(a.publishAt)}
                                      </span>
                                    )}
                                    {!IS_NATIVE_APP && a.fechaLimite && (
                                      <span data-tooltip="Cierre" className="text-xs text-amber-600 flex items-center gap-0.5">
                                        <Clock size={14} /> {formatDeadline(a.fechaLimite)}
                                      </span>
                                    )}
                                    {visState === 'hidden' && (
                                      <span
                                        data-tooltip={parcialOculto ? 'La actividad está publicada, pero el Parcial completo está oculto a estudiantes. Muéstralo con el ojo del encabezado del parcial.' : undefined}
                                        className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${parcialOculto ? 'bg-amber-100 text-amber-700' : 'bg-surface-container text-muted'}`}>
                                        <EyeOff size={13} /> {parcialOculto ? 'Parcial oculto' : (!a.publishedAt && a.oculta && !a.publishAt) ? 'Borrador' : 'Oculta'}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {!IS_NATIVE_APP && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span
                                    data-tooltip="Entregados"
                                    className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <FileCheck2 size={11} /> {counts.delivered}/{totalStudents}
                                  </span>
                                  <span
                                    data-tooltip="Calificados"
                                    className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <CheckCircle size={11} /> {counts.graded}/{counts.delivered}
                                  </span>
                                  <span
                                    data-tooltip="Por calificar"
                                    className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <Timer size={11} /> {counts.delivered - counts.graded}/{counts.delivered}
                                  </span>
                                </div>
                              )}
                            </button>
                            {/* Visibility toggle. Published → direct show/hide.
                                Draft (no publishedAt) → confirm first publication. */}
                            {isHidden ? (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); a.publishedAt ? showActivityNow(a) : setPublishDraftConfirm(a) }}
                                aria-label={a.publishedAt ? 'Mostrar a estudiantes' : 'Publicar para estudiantes'}
                                data-tooltip={a.publishedAt ? 'Mostrar a estudiantes' : 'Publicar para estudiantes'}
                                className="p-2 text-slate-300 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                              >
                                <EyeOff size={16} />
                              </button>
                            ) : (
                              <button type="button"
                                onClick={(e) => { e.stopPropagation(); hideActivity(a) }}
                                aria-label="Ocultar para estudiantes"
                                data-tooltip="Ocultar para estudiantes"
                                className="p-2 text-slate-400 hover:text-muted hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0"
                              >
                                <Eye size={16} />
                              </button>
                            )}
                            {/* El menú ⋮ (Duplicar/Eliminar) sigue solo en la web; el lápiz de
                                editar ya se muestra también en Android. */}
                            <button type="button" onClick={() => openEdit(a, activityLabelById[a.id])} aria-label="Editar" data-tooltip="Editar"
                              className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
                              <Pencil size={16} />
                            </button>
                            {!IS_NATIVE_APP && (
                              // Less-used actions (Duplicar / Eliminar) tucked into a ⋮ menu
                              <button type="button"
                                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setActivityMenu((m) => m?.a?.id === a.id ? null : { a, x: r.right, y: r.bottom }) }}
                                aria-label="Más acciones"
                                data-tooltip="Más acciones"
                                className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-1">
                                <MoreVertical size={16} />
                              </button>
                            )}
                          </div>
                        )
                      })}

                      {/* Materiales de apoyo — visually distinct from activities (book
                          icon, no submission/grade badges): independent entity, not an
                          "actividad sin calificación". */}
                      {mats.length > 0 && (
                        <>
                          <div className="pt-1">
                            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Material de apoyo</p>
                            <p className="text-xs text-slate-400 mb-1">Vas agregando esto sobre la marcha de este parcial — no genera entrega ni número de actividad.</p>
                          </div>
                          {mats.map((m) => {
                            const visState = activityVisibilityState(m, parcialOculto)
                            const isHidden = visState !== 'visible'
                            const isExpanded = expandedMaterialId === m.id
                            return (
                              <div key={m.id} className={`w-full rounded border bg-surface-card transition-colors duration-200 ${isHidden ? 'border-outline-variant opacity-60' : 'border-outline-variant hover:border-accent'}`}>
                                <div className="flex items-center gap-1">
                                  <button type="button" onClick={() => setExpandedMaterialId(isExpanded ? null : m.id)}
                                    className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left hover:bg-[var(--accent-tint)] rounded transition-colors">
                                    <BookOpen size={20} className={`flex-shrink-0 ${isHidden ? 'text-slate-300' : 'text-amber-500'}`} />
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-base font-medium leading-tight truncate ${isHidden ? 'text-slate-400' : 'text-on-surface'}`}>{m.nombre}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-xs text-slate-500 flex items-center gap-0.5">
                                          <Paperclip size={12} /> {(m.archivos || []).length} archivo{(m.archivos || []).length !== 1 ? 's' : ''}
                                        </span>
                                        {m.publishAt && (
                                          <span data-tooltip="Fecha de publicación" className="text-xs text-accent flex items-center gap-0.5">
                                            <Clock size={14} /> {formatPublishAt(m.publishAt)}
                                          </span>
                                        )}
                                        {visState === 'hidden' && (
                                          <span className="text-xs bg-surface-container text-muted px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                            <EyeOff size={13} /> Oculto
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {isExpanded ? <ChevronUp size={18} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />}
                                  </button>
                                  {isHidden ? (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); showMaterialNow(m) }} aria-label="Mostrar a estudiantes" data-tooltip="Mostrar a estudiantes"
                                      className="p-2 text-slate-300 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                                      <EyeOff size={16} />
                                    </button>
                                  ) : (
                                    <button type="button" onClick={(e) => { e.stopPropagation(); hideMaterial(m) }} aria-label="Ocultar a estudiantes" data-tooltip="Ocultar a estudiantes"
                                      className="p-2 text-slate-400 hover:text-muted hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                                      <Eye size={16} />
                                    </button>
                                  )}
                                  <button type="button" onClick={() => openEditMaterial(m)} aria-label="Editar" data-tooltip="Editar"
                                    className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0 mr-0.5">
                                    <Pencil size={16} />
                                  </button>
                                  <button type="button" onClick={() => setDeleteMaterialConfirm(m)} aria-label="Eliminar" data-tooltip="Eliminar"
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 mr-1">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-outline-variant px-3 py-2 ml-9">
                                    {m.descripcion && (
                                      <div className={`text-sm text-on-surface mb-2 ${richTextContentClass}`}
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.descripcion) }} />
                                    )}
                                    <AttachmentList files={m.archivos} title={null} />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}

                      <button type="button" onClick={() => openAdd(p)}
                        data-tooltip={canCreate ? undefined : 'Activa tu suscripción mensual para crear nuevas actividades'}
                        className={`w-full py-2 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-slate-400 hover:bg-[var(--accent-medium)]'
                        }`}>
                        <Plus size={17} /> Agregar actividad
                      </button>
                      <button type="button" onClick={() => openAddMaterial(p)}
                        data-tooltip={canCreate ? undefined : 'Activa tu suscripción mensual para crear nuevo material de apoyo'}
                        className={`w-full py-2 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-slate-400 hover:bg-[var(--accent-medium)]'
                        }`}>
                        <BookOpen size={17} /> Agregar material de apoyo
                      </button>
                      <button type="button" onClick={() => openImport(p)}
                        data-tooltip="Copia actividades de otra de tus asignaturas a este parcial"
                        className={`w-full py-2 border-2 border-dashed rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          canCreate ? 'border-accent text-accent hover:bg-[var(--accent-medium)]' : 'border-outline-variant text-slate-400 hover:bg-[var(--accent-medium)]'
                        }`}>
                        <Copy size={17} /> Traer de otra asignatura
                      </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            TAB: CALIFICACIONES
        ══════════════════════════════════════════════════════════ */}
        {activeTab === 'calificaciones' && (
          <div className="px-4 py-2 space-y-2">
            {/* 1 — Descargar calificaciones. El botón grande baja TODO; el ⋮
                 ofrece una descarga por parcial (progreso, sin cerrar). */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Calificaciones</p>
              {/* min-w-0 en cada split-button, SIN overflow-hidden en la fila
                  (bug real reportado en producción: "los tres puntitos no
                  hacen nada" — el menú SÍ se abría, pero este overflow-hidden
                  lo recortaba por completo porque se despliega hacia abajo,
                  fuera de la caja de la fila; solo se notaba mirando la
                  pantalla, no leyendo el HTML, que seguía mostrando el menú
                  "presente" aunque invisible). min-w-0 por sí solo ya evita
                  que los dos flex-1 fuercen scroll horizontal, sin necesidad
                  de recortar overflow. */}
              <div className="flex gap-2">
                {/* Excel y PDF: relleno de tinte de acento + borde, no borde
                    solo (se perdían sobre la tarjeta blanca) ni acento sólido
                    (probado y descartado: quedaba demasiado gritón para un
                    botón secundario de una pantalla de trabajo). Es el mismo
                    tratamiento que usan los chips seleccionados en el resto de
                    la app. Los tres botones de descarga de la pantalla (Excel y
                    PDF aquí, Excel en Asistencias) lo comparten. */}
                <ExportSplitButton
                  label="Excel" Icon={FileSpreadsheet}
                  onMain={handleExport} mainDisabled={exporting}
                  mainTooltip="Descarga TODAS las calificaciones en una hoja de Excel"
                  menuTooltip="Excel por parcial" menuLabel="Excel de un parcial"
                  parciales={parcialesConActividades} onPickParcial={doExportParcialExcel}
                />
                <ExportSplitButton
                  label="PDF" Icon={FileText}
                  onMain={handleExportGradesPDF} mainDisabled={exportingGradesPdf}
                  mainTooltip="Descarga TODAS las calificaciones en un PDF imprimible"
                  menuTooltip="PDF por parcial" menuLabel="PDF de un parcial"
                  parciales={parcialesConActividades} onPickParcial={doExportParcialPDF}
                />
              </div>
            </div>

            <SearchInput
              value={searchGrade}
              onChange={setSearchGrade}
              placeholder="Buscar por nombre o por número de lista…"
              autoFocus
            />

            {loadingGrades ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : activities.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay actividades en esta asignatura</p>
            ) : groupStudents.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-12">No hay estudiantes en este grupo</p>
            ) : (
              <>
                {/* Action bar above the table — ponderación toggle lives here now
                    (moved out of the crowded table header) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={togglePonderacion}
                    data-tooltip={anyPonderacionOn ? 'Quitar la ponderación de todos los parciales' : 'Cada actividad vale un peso — se activa en todos los parciales; luego puedes apagarla por parcial'}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${anyPonderacionOn
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-accent text-white hover:bg-accent-hover'}`}>
                    {anyPonderacionOn ? 'Volver a promedio simple' : 'Activar ponderación'}
                  </button>
                  {anyPonderacionOn && (
                    <span className="text-xs text-muted">Asigna un peso a cada actividad (deben sumar 10 por parcial para exportar).</span>
                  )}
                  {/* Bloque derecho: (en modo ordenar) exportar Excel/PDF del
                      ranking, y el botón "Ordenar de mayor a menor". */}
                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    {/* Exportar el ranking — solo en modo ordenar. Clic directo =
                        Promedio final; los 3 puntitos eligen el parcial. */}
                    {gradeSortOn && ['excel', 'pdf'].map((kind) => (
                      <div key={kind} className="order-2 flex items-center relative">
                        <button type="button" onClick={() => doExportRanking(kind, null)}
                          data-tooltip={`${kind === 'excel' ? 'Excel' : 'PDF'} del ranking (Promedio final)`}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-l text-xs font-semibold border border-accent text-accent hover:bg-[var(--accent-medium)] transition-colors">
                          {kind === 'excel' ? <FileSpreadsheet size={14} /> : <FileText size={14} />}
                          {kind === 'excel' ? 'Excel' : 'PDF'}
                        </button>
                        <button type="button" onClick={() => setRankingExportMenu((m) => (m === kind ? null : kind))}
                          aria-label="Elegir parcial del documento" data-tooltip="Elegir parcial (o general)"
                          className="px-1 py-1.5 rounded-r border border-l-0 border-accent text-accent hover:bg-[var(--accent-medium)] transition-colors">
                          <MoreVertical size={14} />
                        </button>
                        {rankingExportMenu === kind && (
                          <div className="absolute right-0 top-full mt-1 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[180px]">
                            <button type="button" onClick={() => doExportRanking(kind, null)}
                              className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-[var(--accent-tint)]">
                              General (promedio final)
                            </button>
                            {tableParcials.map(({ p }) => (
                              <button key={p} type="button" onClick={() => doExportRanking(kind, p)}
                                className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-[var(--accent-tint)]">
                                Parcial {p}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Ordenar de mayor a menor por promedio (con columna LUGAR).
                        Los 3 puntitos eligen el parcial; sin elegir, es el general. */}
                    <div className="order-1 flex items-center gap-1 relative">
                      <button type="button" onClick={() => setGradeSortOn((v) => !v)}
                        data-tooltip={gradeSortOn ? 'Ordenado de mayor a menor' : 'Ordenar por promedio, de mayor a menor'}
                        className={`px-3 py-1.5 rounded-l text-xs font-bold uppercase tracking-wide transition-colors ${gradeSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                        Ordenar de mayor a menor{gradeSortOn ? ` · ${gradeSortParcial == null ? 'General' : `P${gradeSortParcial}`}` : ''}
                      </button>
                      <button type="button" onClick={() => setGradeSortMenuOpen((v) => !v)}
                        aria-label="Elegir parcial para ordenar" data-tooltip="Elegir parcial (o general)"
                        className={`px-1.5 py-1.5 rounded-r transition-colors ${gradeSortOn ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-container text-muted hover:text-accent'}`}>
                        <MoreVertical size={15} />
                      </button>
                      {gradeSortOn && (
                        <button type="button" onClick={() => { setGradeSortOn(false); setGradeSortMenuOpen(false) }}
                          aria-label="Volver al orden normal" data-tooltip="Volver al orden normal"
                          className="p-1 text-slate-400 hover:text-red-500 rounded">
                          <X size={16} />
                        </button>
                      )}
                      {gradeSortMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-30 bg-surface-card border border-outline-variant rounded-card shadow-lg py-1 min-w-[170px]">
                          <button type="button" onClick={() => { setGradeSortParcial(null); setGradeSortOn(true); setGradeSortMenuOpen(false) }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent-tint)] ${gradeSortParcial == null ? 'font-bold text-accent' : 'text-on-surface'}`}>
                            General (promedio final)
                          </button>
                          {tableParcials.map(({ p }) => (
                            <button key={p} type="button" onClick={() => { setGradeSortParcial(p); setGradeSortOn(true); setGradeSortMenuOpen(false) }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--accent-tint)] ${gradeSortParcial === p ? 'font-bold text-accent' : 'text-on-surface'}`}>
                              Parcial {p}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {gradeSortOn && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded bg-green-100 border border-green-300 flex-shrink-0" />
                      20% con mayor promedio — destacan (p. ej. concursos)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded bg-orange-100 border border-orange-300 flex-shrink-0" />
                      20% con menor promedio — requieren atención especial
                    </span>
                  </div>
                )}

                <div className="overflow-auto max-h-[65vh] rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                  {/* table-fixed + explicit narrow per-column widths (no forced
                      min-w on the table itself) — the table only takes the
                      width its columns actually need, so the wrapper's
                      overflow-x-auto only scrolls once real content overflows,
                      never just because of an arbitrary minimum.
                      overflow-auto + max-h = inmovilizadores estilo Excel: la
                      rueda del mouse baja/sube ~13-15 estudiantes por pantalla y
                      la barra horizontal muestra las columnas; encabezado (thead
                      sticky top) y columnas No./Nombre (sticky left) fijos. */}
                  <table
                    className="grades-table text-xs border-collapse table-fixed"
                    onMouseOver={handleGradeTableHover}
                    onMouseLeave={handleGradeTableLeave}
                    onFocus={handleGradeTableHover}
                    onBlur={handleGradeTableLeave}
                  >
                    {/* table-fixed reads column widths from the first row, but
                        that row has colSpan'd "Parcial" headers — an explicit
                        colgroup is the only reliable way to size each real
                        column regardless of the header's rowspan/colspan. */}
                    <colgroup>
                      <col className="w-8" />
                      <col className="w-[210px]" />
                      {visibleParcials.map(({ p, acts }) => [
                        ...acts.map((a) => <col key={a.id} className="w-9" />),
                        <col key={`avgcol-${p}`} className="w-14" />,
                      ])}
                      {showFinalCol && <col className="w-14" />}
                    </colgroup>
                    <thead className="sticky top-0 z-30">
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className="sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 border-r border-outline-variant" />
                        <th className="sticky left-8 z-20 bg-accent-light w-[210px] px-2 py-1.5 text-left text-[10px] font-bold text-muted uppercase tracking-wide border-r border-outline-variant" />
                        {visibleParcials.map(({ p, acts }) => (
                          <th key={p} colSpan={acts.length + 1}
                            className="px-1.5 py-1 font-semibold text-accent text-center border-l border-outline-variant whitespace-nowrap">
                            {/* Clean header: "Parcial N" + a ⋮ menu (Exportar / Cerrar),
                                so 2-3-activity parciales never crowd. A lock shows the
                                closed state at a glance. */}
                            <div className="flex items-center justify-center gap-1">
                              {subject?.parcialesCerrados?.[p] && (
                                <Lock size={12} className="text-emerald-600 flex-shrink-0" data-tooltip="Parcial cerrado" />
                              )}
                              <span>
                                Parcial {p}
                                {subject?.parcialesFechas?.[p - 1] && (
                                  <span className="block text-[9px] font-normal text-slate-400 normal-case tabular-nums">
                                    ({formatShortDate(subject.parcialesFechas[p - 1].inicio)}–{formatShortDate(subject.parcialesFechas[p - 1].fin)})
                                  </span>
                                )}
                              </span>
                              <button type="button" id={`parcial-menu-${p}`}
                                onClick={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect()
                                  setParcialMenu((m) => m?.p === p ? null : { p, x: r.right, y: r.bottom })
                                }}
                                aria-label="Acciones del parcial"
                                data-tooltip-follow="Acciones del parcial"
                                className="p-0.5 rounded text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] transition-colors flex-shrink-0">
                                <MoreVertical size={15} />
                              </button>
                            </div>
                          </th>
                        ))}
                        {showFinalCol && (
                          <th className="w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap">
                            Final
                          </th>
                        )}
                      </tr>
                      {/* PONDERACIÓN row — weights per activity, per PARCIAL.
                          Active parciales show their weight inputs (with an ✕
                          to turn just that parcial off); inactive ones show an
                          "Activar" button instead. */}
                      {anyPonderacionOn && (
                        <tr className="bg-amber-50 border-b border-amber-200">
                          <th className="sticky left-0 z-10 bg-amber-50 w-8 px-1 py-1 border-r border-outline-variant" />
                          <th className="sticky left-8 z-10 bg-amber-50 w-[210px] px-2 py-1 border-r border-outline-variant">
                            <div className="flex items-center justify-end gap-1.5">
                              <button type="button" onClick={togglePonderacionVisible}
                                aria-label={subject?.ponderacionVisibleAlumnos
                                  ? 'Los estudiantes VEN los pesos — clic para ocultárselos'
                                  : 'Los estudiantes NO ven los pesos — clic para mostrárselos'}
                                data-tooltip-follow={subject?.ponderacionVisibleAlumnos
                                  ? 'Los estudiantes VEN los pesos — clic para ocultárselos'
                                  : 'Los estudiantes NO ven los pesos — clic para mostrárselos'}
                                className={`p-0.5 rounded transition-colors ${subject?.ponderacionVisibleAlumnos ? 'text-amber-700 hover:text-amber-900' : 'text-amber-400 hover:text-amber-700'}`}>
                                {subject?.ponderacionVisibleAlumnos ? <Eye size={14} /> : <EyeOff size={14} />}
                              </button>
                              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Ponderación</span>
                            </div>
                          </th>
                          {visibleParcials.map(({ p, acts }) => pondParcial(p) ? [
                            ...acts.map((a) => (
                              <th key={a.id} className="w-9 px-0.5 py-1 border-l border-outline-variant bg-amber-50">
                                {/* Typing only — no wheel, no auto-fill, no forced
                                    sum: the teacher writes the weights they want;
                                    "must sum 10" is asked only when exporting. */}
                                <input id={`peso-${a.id}`} type="text" inputMode="decimal" min="0" max="10"
                                  autoComplete="off"
                                  value={pesoEdits[a.id] ?? (a.pesoCalificacion ?? '')}
                                  placeholder="0"
                                  onChange={(e) => {
                                    let raw = e.target.value
                                    const n = parseFloat(raw)
                                    if (!isNaN(n)) {
                                      // Cap to what's left so the parcial never passes 10;
                                      // show a message right on the box when they try more
                                      const maxAllowed = pesoRestante(acts, a.id)
                                      if (n > maxAllowed) {
                                        raw = String(maxAllowed)
                                        showNear(e.target, 'La suma del parcial debe ser 10 — no puedes poner más aquí')
                                      }
                                      else if (n < 0) raw = '0'
                                      else {
                                        const m = raw.match(/^(\d+\.\d)\d+$/)
                                        if (m) raw = m[1]
                                      }
                                    }
                                    setPesoEdits((f) => ({ ...f, [a.id]: raw }))
                                  }}
                                  onFocus={(e) => { try { e.target.select() } catch { /* algunos navegadores */ } }}
                                  onBlur={() => savePeso(a)}
                                  data-tooltip={`Peso de la actividad ${activityLabelById[a.id] || ''}`}
                                  className="no-spinner w-full px-0 py-0.5 text-center text-[11px] font-semibold rounded border border-amber-300 bg-white text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                              </th>
                            )),
                            <th key={`pw-${p}`} className={`w-14 px-1 py-1 text-center text-[11px] font-bold border-l border-outline-variant bg-amber-50 ${pesoTotalVivo(acts) === 10 ? 'text-emerald-600' : 'text-amber-700'}`}>
                              <div className="flex items-center justify-center gap-0.5">
                                <span data-tooltip={pesoTotalVivo(acts) === 10 ? 'Los pesos suman 10' : 'Suma libre — para exportar este parcial deberá sumar 10'}>{pesoTotalVivo(acts)}</span>
                                <button type="button" onClick={() => toggleParcialPonderacion(p)}
                                  aria-label={`Quitar la ponderación solo del Parcial ${p}`}
                                  data-tooltip={`Quitar la ponderación solo del Parcial ${p}`}
                                  className="p-0.5 text-amber-400 hover:text-amber-800 rounded transition-colors">
                                  <X size={12} />
                                </button>
                              </div>
                            </th>,
                          ] : (
                            <th key={`pond-off-${p}`} colSpan={acts.length + 1} className="px-1 py-1 text-center border-l border-outline-variant bg-amber-50/50">
                              <button type="button" onClick={() => toggleParcialPonderacion(p)}
                                data-tooltip-follow={`Ponderar solo el Parcial ${p} — este parcial usa promedio simple`}
                                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors whitespace-nowrap">
                                Activar en P{p}
                              </button>
                            </th>
                          ))}
                          {showFinalCol && <th className="w-14 bg-amber-50 border-l border-outline-variant" />}
                        </tr>
                      )}
                      <tr className="bg-accent-light border-b border-outline-variant">
                        <th className={`sticky left-0 z-10 bg-accent-light w-8 px-1 py-1.5 text-center border-r border-outline-variant whitespace-nowrap ${gradeSortOn ? 'font-bold text-accent' : 'font-medium text-muted'}`}>
                          {gradeSortOn ? 'LUGAR' : 'No.'}
                        </th>
                        <th className="sticky left-8 z-10 bg-accent-light w-[210px] px-2 py-1.5 text-left font-medium text-muted border-r border-outline-variant whitespace-nowrap">
                          Estudiante / Actividad
                        </th>
                        {visibleParcials.map(({ p, acts }) => [
                          ...acts.map((a) => (
                            <th
                              key={a.id}
                              data-col={colIndexByKey[`act-${a.id}`]}
                              onClick={() => goToActivityFromGrades(`/activity/${a.id}`, { state: { returnTo: 'calificaciones' } })}
                              onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setActTip({ text: a.nombre, x: r.left + r.width / 2, y: r.top }) }}
                              onMouseLeave={() => setActTip(null)}
                              className={`w-9 px-0.5 py-1.5 font-semibold text-on-surface text-center border-l border-outline-variant transition-colors duration-200 cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[var(--accent)] ${gradeHeaderColBg(colIndexByKey[`act-${a.id}`])}`}>
                              {/* Tooltip is a fixed-positioned element (below), so the
                                  table's scroll container can't clip it — always ABOVE. */}
                              <span className="block truncate">{activityLabelById[a.id] || a.nombre}</span>
                            </th>
                          )),
                          <th key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-200 ${gradeHeaderColBg(colIndexByKey[`avg-${p}`])}`}>
                            Prom.
                          </th>,
                        ])}
                        {showFinalCol && (
                          <th data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1.5 font-semibold text-muted text-center border-l border-outline-variant whitespace-nowrap transition-colors duration-200 ${gradeHeaderColBg(colIndexByKey.final)}`}>
                            Prom.
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGradeRows.map(({ s, parcialData, finalAvg }, i) => {
                        // Fondo de resaltado del ranking (verde mejores / naranja peores).
                        const hl = gradeTopIds.has(s.id) ? 'bg-green-100' : gradeBottomIds.has(s.id) ? 'bg-orange-100' : ''
                        const stripeBg = i % 2 === 0 ? 'bg-surface-card' : 'bg-slate-50/50'
                        return (
                        <tr key={s.id} data-row={i} className={`group border-t border-outline-variant transition-colors duration-200 hover:bg-[var(--accent-tint)] ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className={`sticky left-0 z-10 w-8 px-1 py-1 text-center border-r border-outline-variant transition-colors duration-200 group-hover:bg-[var(--accent-tint-solid)] ${gradeSortOn ? 'font-bold text-accent' : 'text-slate-400'} ${hl || stripeBg}`}>
                            {gradeSortOn ? i + 1 : s.orden}
                          </td>
                          {/* data-tooltip goes on an INNER span, never on this td:
                              [data-tooltip] forces position:relative, which would
                              override `sticky` and let left-8 shove the cell right */}
                          <td className={`sticky left-8 z-10 w-[210px] px-2 py-1 text-sm font-medium text-on-surface border-r border-outline-variant transition-colors duration-200 group-hover:bg-[var(--accent-tint-solid)] ${hl || stripeBg}`}>
                            <span
                              className="block truncate"
                              data-tooltip={!s.activado ? 'Este estudiante aún no ha activado su cuenta — no puede entrar ni entregar' : undefined}
                            >
                              {studentFullName(s)}
                              {!s.activado && <span className="text-red-500 text-[10px] font-semibold"> (no se ha activado)</span>}
                            </span>
                          </td>
                          {visibleParcials.map(({ p, acts }) => {
                            const pd = parcialData.find((x) => x.p === p)
                            const grades = pd?.grades || []
                            const gradesCierre = pd?.gradesCierre || []
                            return [
                              ...acts.map((a, ai) => (
                                <td
                                  key={a.id}
                                  data-col={colIndexByKey[`act-${a.id}`]}
                                  data-tooltip={
                                    gradesCierre[ai] ? 'Calificación asignada al cerrar el parcial (no entregó) — revierte el cierre para corregirla'
                                    : grades[ai] != null ? `${a.tipo === 'evaluacion' ? 'Ver resultado' : 'Ver entrega'} · clic derecho para corregir rápido`
                                    : `${a.tipo === 'evaluacion' ? 'Ver resultado' : 'Ver entrega'} · clic derecho para calificar rápido`
                                  }
                                  onClick={() => goToActivityFromGrades(`/activity/${a.id}`, { state: { openStudentId: s.id, returnTo: 'calificaciones' } })}
                                  onContextMenu={(e) => openGradeQuickEdit(e, gradeSubMap[`${s.id}-${a.id}`], a, s)}
                                  className={`w-9 px-0.5 py-1 text-center font-semibold border-l border-outline-variant transition-colors duration-200 cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[var(--accent)] ${gradesCierre[ai] ? 'text-red-500' : grades[ai] == null ? 'text-slate-300' : 'text-on-surface'} ${hl || gradeBodyCellBg(colIndexByKey[`act-${a.id}`], i)}`}
                                >
                                  {grades[ai] != null ? grades[ai] : '—'}
                                </td>
                              )),
                              <td key={`avg-${p}`} data-col={colIndexByKey[`avg-${p}`]} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-200 ${gradeColor(pd?.avg ?? null)} ${hl || gradeBodyCellBg(colIndexByKey[`avg-${p}`], i)}`}>
                                {pd?.avg != null ? pd.avg : '—'}
                              </td>,
                            ]
                          })}
                          {showFinalCol && (
                            <td data-col={colIndexByKey.final} className={`w-14 px-1.5 py-1 text-center font-bold border-l border-outline-variant transition-colors duration-200 ${gradeColor(finalAvg)} ${hl || gradeBodyCellBg(colIndexByKey.final, i)}`}>
                              {finalAvg !== null ? finalAvg : '—'}
                            </td>
                          )}
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredGradeStudents.length === 0 && searchGrade && (
                  <p className="text-center text-sm text-slate-400">Sin resultados para &ldquo;{searchGrade}&rdquo;</p>
                )}
              </>
            )}
          </div>
        )}

      {/* ══════════════════════════════════════════════════════════
          TAB: ASISTENCIA
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'asistencia' && (IS_NATIVE_APP ? (
        /* ── Vista HORIZONTAL de pantalla completa (solo app) ──────────────
           Overlay que tapa la nav y el chrome. Con datos, los controles
           (Regresar/ASISTENCIAS/Agregar día) van en la esquina superior
           izquierda de la tabla para no gastar un renglón propio; los estados
           vacíos usan una barra simple. Sin Buscar y sin Totales; encabezado y
           nombre inmovilizados, solo scrollean los datos. */
        <div className="fixed inset-0 z-[70] bg-surface flex flex-col safe-top">
          {loadingAttendance ? (
            <>{nativeAttBar}<div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div></>
          ) : groupStudents.length === 0 ? (
            <>{nativeAttBar}<p className="flex-1 grid place-items-center text-slate-400 text-sm px-6 text-center">No hay estudiantes en esta asignatura</p></>
          ) : attendanceRecords.length === 0 ? (
            <>{nativeAttBar}<p className="flex-1 grid place-items-center text-slate-400 text-sm px-6 text-center">Aún no hay días de asistencia — toca &quot;Agregar día&quot; para empezar.</p></>
          ) : attendanceParciales.length === 0 ? (
            <>{nativeAttBar}<p className="flex-1 grid place-items-center text-slate-400 text-sm px-6 text-center">Sin días de asistencia en el parcial actual.</p></>
          ) : (
            <div className="flex-1 overflow-auto bg-surface-card">
              {attendanceTableJsx}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Asistencias</p>
            {addDayLabel && (
              <button type="button" onClick={handleAddDayClick}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
                <CalendarPlus size={16} /> {addDayLabel}
              </button>
            )}
          </div>

          {/* Por defecto solo se pinta el parcial actual — pedido explícito,
              antes se armaba TODA la tabla del curso completo de una sola
              vez, la causa real de que la pestaña se sintiera pesada con un
              semestre entero de días. Este interruptor solo existe en la
              web; en la App siempre es el parcial actual, sin opción. */}
          <div className="flex bg-surface-container p-1 rounded w-fit">
            <button type="button" onClick={() => setShowAllParciales(false)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${!showAllParciales ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
              Parcial actual
            </button>
            <button type="button" onClick={() => setShowAllParciales(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${showAllParciales ? 'bg-surface-card text-on-surface shadow-card' : 'text-muted hover:bg-[var(--accent-medium)]'}`}>
              Todo el curso
            </button>
          </div>

          {attendanceNoClaseDias.length > 0 && (
            <div className="text-xs text-muted bg-surface-container border border-outline-variant rounded px-3 py-2">
              <span className="font-semibold">Sin clase por asueto/vacaciones dentro del curso:</span>{' '}
              {attendanceNoClaseDias.map((d, i) => {
                const [, m, dd] = d.fecha.split('-')
                return (
                  <span key={d.fecha}>
                    {i > 0 && ', '}
                    <span className={d.tipo === 'vacaciones' ? 'text-purple-600 font-medium' : 'text-amber-600 font-medium'}>
                      {dd}/{m} ({d.tipo})
                    </span>
                  </span>
                )
              })}
            </div>
          )}

          {/* Excel split-button — mismo patrón que Calificaciones. Sin PDF:
              con una columna angosta por cada día de asistencia no tiene
              caso imprimirlo. */}
          {attendanceParcialesAll.length > 0 && (
            <div className="relative flex">
              <button type="button"
                onClick={handleExportAttendance}
                disabled={exportingAttendance}
                data-tooltip="Descarga TODA la asistencia en una hoja de Excel"
                className="flex-1 flex items-center justify-center gap-2 py-2 bg-[var(--accent-light)] border border-accent rounded-l text-sm font-semibold text-accent hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
              >
                {exportingAttendance ? <Spinner size="sm" /> : <FileSpreadsheet size={17} />} Excel
              </button>
              <button type="button"
                onClick={() => setAttExportMenu((m) => !m)}
                aria-label="Excel por parcial"
                data-tooltip="Excel por parcial"
                className="px-2 bg-[var(--accent-light)] border border-l-0 border-accent rounded-r text-accent hover:bg-[var(--accent-medium)] transition-colors">
                <MoreVertical size={16} />
              </button>
              {attExportMenu && (
                <>
                  <button type="button" className="fixed inset-0 z-30 border-none cursor-default bg-transparent" onClick={() => setAttExportMenu(false)} aria-label="Cerrar menú" />
                  <div className="absolute z-40 top-full mt-1 right-0 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">Excel de un parcial</div>
                    {attendanceParcialesAll.map((g) => (
                      <button key={g.parcial} type="button"
                        onClick={() => { setAttExportMenu(false); doExportParcialAttendance(g.parcial) }}
                        className="w-full text-left px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors">
                        Parcial {g.parcial}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <SearchInput
            value={searchAttendance}
            onChange={setSearchAttendance}
            placeholder="Buscar por nombre o por número de lista…"
            autoFocus
          />

          {loadingAttendance ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : groupStudents.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12">No hay estudiantes en esta asignatura</p>
          ) : attendanceRecords.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12">Aún no hay días de asistencia — toca &quot;Agregar día&quot; para empezar.</p>
          ) : attendanceParciales.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12">Sin días de asistencia en el parcial actual — toca &quot;Todo el curso&quot; para ver los demás.</p>
          ) : (
            <>
              <div className="overflow-auto max-h-[65vh] rounded-card shadow-card bg-surface-card -mx-4 sm:mx-0">
                {attendanceTableJsx}
              </div>
              {attendanceLegend}
              {filteredAttendanceStudents.length === 0 && searchAttendance && (
                <p className="text-center text-sm text-slate-400">Sin resultados para &quot;{searchAttendance}&quot;</p>
              )}
            </>
          )}
        </div>
      ))}

      {/* Agregar día de asistencia — el nº de sesiones crea esa misma cantidad
          de columnas (una asistencia por sesión de clase). */}
      {showAddAttendance && (
        <div className={`fixed inset-0 z-[80] flex justify-center px-4 ${IS_NATIVE_APP ? 'items-start pt-1' : 'items-center'}`}>
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowAddAttendance(false)} aria-label="Cerrar" />
          <form onSubmit={handleCreateAttendanceDay} className={`relative bg-surface-card rounded-card shadow-2xl w-full ${IS_NATIVE_APP ? 'max-w-3xl p-3 space-y-2' : 'max-w-sm p-4 space-y-3'}`}>
            <h3 className={`font-semibold text-on-surface ${IS_NATIVE_APP ? 'text-sm' : 'text-base'}`}>Agregar día de asistencia</h3>
            {/* En la app: campos en fila y modal pegado arriba, así el calendario
                del selector de día tiene espacio para abrirse sin recortarse. */}
            <div className={IS_NATIVE_APP ? 'flex items-start gap-3' : 'space-y-3'}>
              <div className={IS_NATIVE_APP ? 'flex-1 min-w-0' : undefined}>
                <label htmlFor="att-parcial" className="block text-xs font-medium text-muted mb-1">Parcial</label>
                <select id="att-parcial" value={newAttendanceForm.parcial}
                  onChange={(e) => setNewAttendanceForm((f) => ({ ...f, parcial: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {PARCIALES.map((p) => <option key={p} value={p}>Parcial {p}</option>)}
                </select>
              </div>
              <div className={IS_NATIVE_APP ? 'flex-1 min-w-0' : undefined}>
                <label htmlFor="att-fecha" className="block text-xs font-medium text-muted mb-1">Día</label>
                <EFDateTimePicker mode="date" value={newAttendanceForm.fecha}
                  onChange={(v) => setNewAttendanceForm((f) => ({ ...f, fecha: v }))}
                  placeholder="Elige el día…" clearable={false}
                  shortcutLabels={IS_NATIVE_APP ? ['Hoy', 'Mañana', 'Pasado mañana'] : undefined} />
              </div>
              <div className={IS_NATIVE_APP ? 'flex-1 min-w-0' : undefined}>
                <label htmlFor="att-sesiones" className="block text-xs font-medium text-muted mb-1">Número de sesiones</label>
                <select id="att-sesiones" value={newAttendanceForm.duracion}
                  onChange={(e) => setNewAttendanceForm((f) => ({ ...f, duracion: Number(e.target.value) }))}
                  className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n !== 1 ? 'sesiones' : 'sesión'} ({n} asistencia{n !== 1 ? 's' : ''})</option>)}
                </select>
              </div>
            </div>
            {/* Se avisa al elegir el día, no al intentar guardar: enterarse
                después de darle a "Agregar" obliga a volver a empezar. */}
            {avisoSinClase && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2.5 flex items-start gap-2">
                <AlertTriangle size={17} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">{avisoSinClase}</p>
              </div>
            )}
            {!avisoSinClase && avisoAsueto && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2.5 flex items-start gap-2">
                <AlertTriangle size={17} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Ese día lo marcaste como {avisoAsueto === 'asueto' ? 'día de asueto' : 'periodo vacacional'} — si hubo clase de reposición, puedes seguir y agregarlo de todas formas.
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowAddAttendance(false)}
                className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={savingAttendance || !newAttendanceForm.fecha || !!avisoSinClase}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
                {savingAttendance ? <Spinner size="sm" /> : <CalendarPlus size={16} />} Agregar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Restaurar día(s) de asistencia borrados — solo aparece cuando el
          curso ya tiene fechas (todo automático) y hay días que el docente
          quitó pero siguen siendo válidos según el horario. */}
      {showRestoreAttendance && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowRestoreAttendance(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4">
            <h3 className="text-base font-semibold text-on-surface mb-1">Restaurar día de asistencia</h3>
            <p className="text-sm text-muted mb-3">
              Estos días se generan solos según el horario y las fechas del curso — los borraste antes, pero siguen siendo válidos. Elige cuál restaurar.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {attendanceMissingAutoDias.map((dia) => {
                const { dia: d, mes, anio } = fmtAttDateParts(dia.fecha)
                return (
                  <button key={dia.fecha} type="button" onClick={() => handleRestoreAttendanceDay(dia)}
                    disabled={restoringFecha === dia.fecha}
                    className="w-full flex items-center justify-between px-3 py-2 rounded border border-outline-variant text-sm hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                    <span>{d}/{mes}/{anio} — Parcial {dia.parcial}</span>
                    {restoringFecha === dia.fecha ? <Spinner size="sm" /> : <CalendarPlus size={16} className="text-accent" />}
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={() => setShowRestoreAttendance(false)}
              className="w-full mt-3 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Confirmar borrado de un día completo (todas sus horas/slots) */}
      {deleteAttendanceConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteAttendanceConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card shadow-2xl w-full max-w-sm p-4">
            <h3 className="text-base font-semibold text-on-surface mb-2">¿Eliminar este día de asistencia?</h3>
            <p className="text-sm text-muted mb-4">
              Se borrará permanentemente la asistencia del{' '}
              <strong>{(() => { const { dia, mes, anio } = fmtAttDateParts(deleteAttendanceConfirm.fecha); return `${dia}/${mes}/${anio}` })()}</strong>
              {' '}y todas sus horas. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteAttendanceConfirm(null)}
                className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDeleteAttendanceDay} disabled={deletingAttendance}
                className="flex-1 py-2 rounded bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
                {deletingAttendance ? <Spinner size="sm" /> : <Trash2 size={16} />} Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Motivo de la justificación — se abre con un clic/toque más sobre una
          celda ya en "J" (mismo camino sin motivo o con motivo ya puesto).
          Cancelar: si no tenía motivo, completa el ciclo y vuelve a Presente;
          si ya tenía motivo (se estaba revisando/editando), no toca nada,
          se queda en Justificada con su motivo. Igual en web y app. En la
          app va ANCHO y pegado arriba para seguir usable con el teclado (que
          en horizontal tapa la mitad inferior). */}
      {reasonModal && (
        <div className={`fixed inset-0 z-[80] flex justify-center ${IS_NATIVE_APP ? 'items-start safe-top px-2' : 'items-center px-4'}`}>
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={cancelReasonModal} aria-label="Cerrar" />
          <div className={`relative bg-surface-card rounded-card shadow-2xl w-full ${IS_NATIVE_APP ? 'max-w-none p-3 space-y-1.5' : 'max-w-lg p-5 space-y-4'}`}>
            {IS_NATIVE_APP ? null : (
              // Web: nombre del estudiante en su propio renglón (evita truncar
              // nombres largos) y textos más grandes que en la app, donde el
              // modal comparte columna angosta con el teclado en horizontal.
              <div>
                <h3 className="text-lg font-semibold text-on-surface">Justificar falta</h3>
                <p className="text-sm text-muted mt-0.5">
                  {reasonModal.studentName} ·{' '}
                  {(() => { const { dia, mes, anio } = fmtAttDateParts(reasonModal.fecha); return `${dia}/${mes}/${anio}` })()}
                </p>
              </div>
            )}
            {IS_NATIVE_APP ? (
              /* App horizontal: columna izquierda (título + nombre a la
                 izquierda, motivos rápidos, motivo) y columna derecha con los
                 3 botones apilados — Guardar / Asistencia / Salir. El nombre
                 va pegado a la izquierda para dejarle ese espacio a los
                 botones (pedido explícito). */
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-base font-semibold text-on-surface whitespace-nowrap">Justificar falta</h3>
                    <p className="text-xs text-muted truncate">
                      {reasonModal.studentName} ·{' '}
                      {(() => { const { dia, mes, anio } = fmtAttDateParts(reasonModal.fecha); return `${dia}/${mes}/${anio}` })()}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-64 flex-none">
                      <p className="text-[9px] font-medium text-muted mb-1">Motivo rápido</p>
                      {quickMotivoButtons}
                    </div>
                    <div className="flex-1 min-w-0">
                      <label htmlFor="att-motivo" className="block text-[9px] font-medium text-muted mb-1">Motivo ✍️</label>
                      <textarea id="att-motivo" value={reasonText} rows={2}
                        onChange={(e) => setReasonText(e.target.value)}
                        placeholder="Escribe el motivo…"
                        className="w-full px-3 py-2 rounded border border-outline-variant text-sm bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none" />
                    </div>
                  </div>
                </div>
                <div className="w-32 flex-none flex flex-col gap-2">
                  <button type="button" onClick={handleSaveReason}
                    disabled={reasonText.trim() === (reasonModal.original || '').trim()}
                    className="py-2 rounded bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                    Guardar
                  </button>
                  <button type="button" onClick={markPresenteFromModal}
                    className="py-2 rounded bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-1">
                    <CheckIcon size={15} /> Asistencia
                  </button>
                  <button type="button" onClick={closeReasonModal}
                    className="py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                    Salir
                  </button>
                </div>
              </div>
            ) : (
              /* Web: vertical — motivos rápidos, luego caja de motivo, luego acciones */
              <>
                <div>
                  <p className="text-sm font-medium text-muted mb-1.5">Motivo rápido</p>
                  {quickMotivoButtonsLg}
                </div>
                <div>
                  <label htmlFor="att-motivo" className="block text-sm font-medium text-muted mb-1.5">Motivo ✍️</label>
                  <textarea id="att-motivo" value={reasonText} rows={3}
                    onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Escribe el motivo…"
                    className="w-full px-3 py-2.5 rounded border border-outline-variant text-base bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closeReasonModal}
                    className="flex-1 py-2.5 rounded border border-outline-variant text-muted text-base font-semibold hover:bg-[var(--accent-tint)] transition-colors">
                    Salir
                  </button>
                  <button type="button" onClick={markPresenteFromModal}
                    className="flex-1 py-2.5 rounded bg-green-600 text-white text-base font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5">
                    <CheckIcon size={17} /> Asistencia
                  </button>
                  <button type="button" onClick={handleSaveReason}
                    disabled={reasonText.trim() === (reasonModal.original || '').trim()}
                    className="flex-1 py-2.5 rounded bg-amber-500 text-white text-base font-semibold hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                    Guardar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: ALUMNOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'alumnos' && (
        <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
          {/* En la App esta pestaña se simplifica a propósito (pedido
              explícito): solo buscar y ver/editar — sin plantilla de Excel,
              sin PDF de códigos, sin el interruptor de notificación, y sin
              poder agregar un estudiante nuevo. Todo eso sigue disponible en
              la web. */}
          {!IS_NATIVE_APP && <>
          {/* Agregar alumnos — compact 3-step strip: template → upload → activation codes.
              Each step shows just a number + icon + short label; the full instructions
              live in the title tooltip instead of wrapping across two lines like before. */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Agregar estudiantes</p>
            {/* Prominent 3-step cards — everything starts here. No overflow-hidden
                wrapper so the tooltips render above without clipping. */}
            <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
              <button
                type="button"
                onClick={downloadStudentTemplate}
                data-tooltip="Descargar plantilla en Excel para pegar datos de estudiantes"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">1</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><Download size={16} className="flex-shrink-0" /> Plantilla Excel</p>
                  <p className="text-xs text-muted truncate">Descárgala y pega los datos</p>
                </div>
              </button>
              <ChevronRight size={18} className="hidden sm:block text-slate-300 flex-shrink-0 self-center" />
              <label
                data-tooltip="Sube exactamente el archivo de nuestra plantilla de Excel del paso 1"
                data-tooltip-nowrap=""
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors cursor-pointer"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">2</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5">{parsingExcel ? <Spinner size="sm" /> : <Upload size={16} className="flex-shrink-0" />} Subir plantilla</p>
                  <p className="text-xs text-muted truncate">El archivo del paso 1, ya llenado</p>
                </div>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelFileSelected} disabled={parsingExcel} />
              </label>
              <ChevronRight size={18} className="hidden sm:block text-slate-300 flex-shrink-0 self-center" />
              <button
                type="button"
                onClick={() => setShowCredentialsModal(true)}
                className="flex-1 min-w-0 flex items-center gap-3 py-3 px-4 rounded-card border border-accent bg-surface-card shadow-card hover:bg-[var(--accent-light)] transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center flex-shrink-0">3</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent flex items-center gap-1.5"><KeyRound size={16} className="flex-shrink-0" /> Generar PDF con códigos</p>
                  <p className="text-xs text-muted truncate">Accesos para tus estudiantes</p>
                </div>
              </button>
            </div>
          </div>

          {/* Por asignatura (no un ajuste global de Ajustes > Notificaciones):
              la Cloud Function lee este campo directo del documento de la
              asignatura. El push solo llega al celular donde esté instalada
              la app — se puede activar desde aquí o desde ahí. */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-outline-variant">
            <input
              type="checkbox"
              id="notificar-activacion"
              checked={subject?.notificarActivacion !== false}
              onChange={toggleNotificarActivacion}
              className="mt-1"
            />
            <label htmlFor="notificar-activacion" className="text-sm font-medium text-on-surface cursor-pointer flex-1">
              Notificarme cuando un estudiante se active a esta asignatura
              <span className="text-muted text-xs block mt-0.5">Aviso para el celular donde tengas instalada la app Evalúa Fácil, cada vez que un estudiante se active, según lo que tengas activado en Notificaciones</span>
            </label>
          </div>
          </>}

          {/* Ordenar alfabéticamente — visible en web y App.
              Botón con borde y color de acento, no el texto gris de 12 px de
              antes: era una acción real escondida detrás de la apariencia de
              una nota al pie, y nadie la encontraba. */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={sortStudentsAlphabetically}
              disabled={groupStudents.length < 2}
              data-tooltip="Ordena la lista por apellido y nombre"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent text-sm font-medium text-accent hover:bg-[var(--accent-medium)] transition-colors disabled:opacity-60"
            >
              <ArrowUpDown size={16} />
              Ordenar alfabéticamente
            </button>
          </div>

          {/* 3 — Buscar alumno + agregar manualmente */}
          {/* overflow-hidden en la fila: min-w-0 (abajo) ya corrige el ancho
              VISUAL, pero el navegador seguía reportando un scrollWidth
              "fantasma" mayor al contenido realmente visible (quirk conocido
              de flex-basis con inputs) — eso solo, sin verse nada distinto,
              bastaba para forzar scroll horizontal en toda la página. */}
          <div className="flex gap-2 overflow-hidden">
            {/* min-w-0: sin esto, un flex item se niega a encoger por debajo
                del ancho mínimo intrínseco de su <input> hijo (el gotcha
                clásico de flexbox) — en móvil desbordaba esta fila y con
                ella toda la página, aunque el input ya tenía w-full. */}
            <div className="flex-1 min-w-0">
              <SearchInput
                value={searchAlumnos}
                onChange={setSearchAlumnos}
                placeholder="Buscar por nombre o por número de lista…"
                autoFocus
              />
            </div>
            {/* data-tooltip-follow, no data-tooltip: esta fila lleva overflow-hidden
                (arriba) para tapar un ancho fantasma del input, y ese overflow
                recortaba el tooltip normal — se dibuja ARRIBA del botón, fuera de
                la caja de la fila. El que sigue al cursor se pinta en el body,
                fuera de cualquier contenedor, así que nunca lo recorta nada. */}
            <button type="button"
              onClick={() => setShowAddStudent(true)}
              aria-label="Agregar manualmente"
              data-tooltip-follow="Agregar manualmente"
              className="p-2.5 bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            >
              <UserPlus size={20} />
            </button>
          </div>
          {/* En la App no hay botón de editar por renglón — se toca el
              renglón completo (ver más abajo), así que se avisa aquí. */}
          {IS_NATIVE_APP && (
            <p className="text-xs text-muted text-center">Presiona para editar</p>
          )}

          {/* Student list */}
          {!groupStudentsLoaded ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : filteredAlumnos.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              {searchAlumnos ? 'Sin resultados' : 'No hay estudiantes en esta asignatura'}
            </div>
          ) : (
            <div className="bg-surface-card rounded-card overflow-y-auto max-h-[65vh] shadow-card">
              <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-surface-container">
                {!IS_NATIVE_APP && <span className="w-12 flex-shrink-0" />}
                {!IS_NATIVE_APP && <span className="w-5 flex-shrink-0" />}
                {!IS_NATIVE_APP && (
                  <p className="flex-1 min-w-0 text-xs font-semibold text-muted uppercase tracking-wide">Nombre del estudiante</p>
                )}
                {IS_NATIVE_APP && (
                  <p className="w-7 flex-shrink-0 text-[9px] font-semibold text-muted uppercase tracking-wide">No.</p>
                )}
                <p className={`font-semibold text-muted uppercase tracking-wide ${IS_NATIVE_APP ? 'flex-1 text-[9px]' : 'flex-shrink-0 w-44 text-xs'}`}>Código</p>
                <p className={`flex-shrink-0 font-semibold text-muted uppercase tracking-wide ${IS_NATIVE_APP ? 'w-14 text-[9px]' : 'w-24 text-xs'}`}>Estado</p>
                {!IS_NATIVE_APP && <span className="w-9 flex-shrink-0" />}
              </div>
              {filteredAlumnos.map((s, i) => (
                <div
                  key={s.id}
                  onClick={IS_NATIVE_APP ? () => openEditStudent(s) : undefined}
                  className={`flex items-center gap-2 px-3 py-0.5 leading-tight transition-colors duration-200 hover:bg-[var(--accent-tint-strong)] ${i > 0 ? 'border-t border-outline-variant' : ''} ${IS_NATIVE_APP ? 'cursor-pointer' : ''}`}
                >
                  {!IS_NATIVE_APP && (
                    <div className="w-12 h-12 rounded-full bg-accent-light overflow-hidden flex items-center justify-center flex-shrink-0">
                      {s.photoURL ? (
                        <img src={s.photoURL} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-accent">{(s.nombre || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  {!IS_NATIVE_APP && (
                    <span className="text-sm text-accent flex-shrink-0 whitespace-nowrap">{s.orden}.&nbsp;</span>
                  )}
                  {!IS_NATIVE_APP && (
                    <p className="flex-1 min-w-0 text-sm font-medium text-on-surface truncate">
                      {studentFullName(s)}
                    </p>
                  )}
                  {IS_NATIVE_APP && (
                    <span className="w-7 flex-shrink-0 text-[11px] text-accent font-semibold">{s.orden}</span>
                  )}
                  <span className={`font-mono text-accent font-semibold truncate ${IS_NATIVE_APP ? 'flex-1 text-[10px]' : 'flex-shrink-0 w-44 text-xs'}`}>{s.username}</span>
                  <span className={`flex-shrink-0 flex items-center ${IS_NATIVE_APP ? 'w-14' : 'w-24'}`}>
                    {s.activado ? (
                      <span className={`leading-none bg-emerald-100 text-emerald-700 rounded-full ${IS_NATIVE_APP ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-0.5'}`}>activo</span>
                    ) : (
                      <span className={`leading-none bg-amber-100 text-amber-700 rounded-full ${IS_NATIVE_APP ? 'text-[9px] px-1 py-0.5' : 'text-[11px] px-1.5 py-0.5'}`}>sin activar</span>
                    )}
                  </span>
                  {!IS_NATIVE_APP && (
                    <button type="button"
                      onClick={() => openEditStudent(s)}
                      className="w-9 flex-shrink-0 p-1 flex items-center justify-center text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors duration-200"
                      aria-label="Editar estudiante"
                      data-tooltip="Editar estudiante"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: RECURSOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'recursos' && (
        <div className={`px-4 py-2 space-y-2 ${TEACHER_CONTAINER_NARROW}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted leading-relaxed">
              Materiales permanentes de toda la asignatura (programa, reglamento, guías, presentaciones, enlaces, videos…), disponibles para tus estudiantes durante todo el semestre. No generan entrega ni calificación.
            </p>
            <button type="button" onClick={openAddResource}
              data-tooltip="Agregar recurso"
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded hover:bg-accent-hover transition-colors">
              <Plus size={16} /> Agregar recurso
            </button>
          </div>

          {!resourcesLoaded || loadingResources ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : resources.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              Aún no hay recursos en esta asignatura
            </div>
          ) : (
            <div className="space-y-1.5">
              {resources.map((r) => {
                const isLink = r.tipo === 'link'
                const { icon: Icon, color } = isLink ? getLinkResourceIcon(r.url) : getResourceIcon(r.nombreArchivo)
                const isPreviewOpen = previewResourceId === r.id
                return (
                  <div key={r.id} className="bg-surface-card border border-outline-variant rounded-card shadow-card">
                    <div className="flex items-center gap-3 px-3 py-2">
                      <Icon size={28} className={`flex-shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{r.nombre}</p>
                        {r.descripcion && (
                          <p className="text-xs text-slate-500 truncate">{r.descripcion}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          {isLink ? 'Enlace · ' : `${formatFileSize(r.tamano)}${r.tamano ? ' · ' : ''}`}{formatResourceDate(r.fechaPublicacion)}
                        </p>
                      </div>
                      {!isLink && canPreviewFile(r.nombreArchivo || r.nombre) && (
                        <button type="button" onClick={() => setPreviewResourceId(isPreviewOpen ? null : r.id)}
                          aria-label="Vista previa"
                          data-tooltip="Vista previa"
                          className={`p-2 rounded transition-colors flex-shrink-0 ${isPreviewOpen ? 'text-accent bg-[var(--accent-medium)]' : 'text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)]'}`}>
                          <FileSearch size={18} />
                        </button>
                      )}
                      <a href={isLink ? r.url : (isImageDeliveredPdf(r.url) ? pdfPageImageUrl(r.url, 1) : r.url)} target="_blank" rel="noreferrer"
                        aria-label={isLink ? 'Abrir enlace' : (isImageDeliveredPdf(r.url) ? 'Abrir página 1 en pestaña nueva' : 'Abrir en pestaña nueva')}
                        data-tooltip={isLink ? 'Abrir enlace' : (isImageDeliveredPdf(r.url) ? 'Abrir página 1 en pestaña nueva' : 'Abrir en pestaña nueva')}
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <ExternalLink size={18} />
                      </a>
                      {!isLink && (
                        <a href={downloadUrl(r.url, r.nombreArchivo || r.nombre)} download={r.nombreArchivo || r.nombre} rel="noreferrer" aria-label="Descargar" data-tooltip="Descargar"
                          className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                          <Download size={18} />
                        </a>
                      )}
                      <button type="button" onClick={() => openEditResource(r)} aria-label="Editar" data-tooltip="Editar"
                        className="p-2 text-slate-400 hover:text-accent hover:bg-[var(--accent-medium)] rounded transition-colors flex-shrink-0">
                        <Pencil size={18} />
                      </button>
                      <button type="button" onClick={() => setDeleteResourceConfirm(r)} aria-label="Eliminar" data-tooltip="Eliminar"
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {isPreviewOpen && !isLink && (
                      <FilePreviewModal
                        url={r.url}
                        nombre={r.nombreArchivo || r.nombre}
                        onClose={() => setPreviewResourceId(null)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: AVISOS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'avisos' && (
        <div className={TEACHER_CONTAINER_NARROW}>
          <AvisosTab
            subjectId={subjectId}
            docenteId={currentUser.uid}
            canCreate={canCreate && totalStudents > 0}
            blockedTooltip={!canCreate ? 'Activa tu suscripción mensual para publicar avisos' : 'Necesitas al menos un estudiante inscrito para publicar un aviso'}
            onBlockedCreate={() => toast(
              !canCreate
                ? 'Activa tu suscripción mensual para publicar avisos'
                : 'Necesitas al menos un estudiante inscrito para publicar un aviso',
              'error'
            )}
          />
        </div>
      )}
      </div>

      {/* ── Activity create/edit modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {modalMode === 'create' && !tipoActividad
                  ? `Nueva actividad — Parcial ${modalParcial}`
                  : modalMode === 'create'
                    ? `${tipoActividad === 'entregable' ? 'Entregable' : tipoActividad === 'cuestionario' ? 'Cuestionario' : 'Examen'} — Parcial ${modalParcial}`
                    : 'Editar actividad'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>

            {/* ── Tipo picker (only on create, before choosing type) ── */}
            {modalMode === 'create' && !tipoActividad ? (
              <div className="space-y-2 py-2">
                <p className="text-sm text-muted mb-3">¿Qué tipo de actividad quieres crear?</p>
                {[
                  { key: 'entregable', label: 'Entregable', desc: 'El alumno sube uno o varios archivos.', Icon: FileText, iconColor: 'text-slate-400', iconBg: 'bg-slate-100' },
                  { key: 'cuestionario', label: 'Cuestionario', desc: 'Preguntas con calificación automática, abiertas o con archivo. Ideal para práctica o aprendizaje.', Icon: ListChecks, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-100' },
                  { key: 'examen', label: 'Examen', desc: 'Preguntas con calificación automática, abiertas o con archivo. Para evaluación formal.', Icon: GraduationCap, iconColor: 'text-accent', iconBg: 'bg-[var(--accent-light)]' },
                  { key: 'observacion', label: 'Observación', desc: 'Sin entrega del alumno: tú observas y calificas. Ej.: actitud, exposición de tema, realización de ejercicio.', Icon: ClipboardCheck, iconColor: 'text-amber-600', iconBg: 'bg-amber-100' },
                ].map((opt) => (
                  <button key={opt.key} type="button"
                    onClick={() => {
                      setShowModal(false)
                      if (opt.key === 'entregable' || opt.key === 'observacion') {
                        setEntregableEditor({ activityId: null, parcial: modalParcial, categoria: opt.key, activityLabel: null, initialForm: null, initialExistingFiles: null })
                      } else {
                        setEvalEditor({ activityId: null, categoria: opt.key, parcial: modalParcial, activityLabel: `${modalParcial}.${activities.filter((a) => a.parcial === modalParcial).length + 1}.` })
                      }
                    }}
                    className="w-full flex items-start gap-3 p-4 rounded-card border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-left">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${opt.iconBg}`}>
                      <opt.Icon size={20} className={opt.iconColor} />
                    </div>
                    <div>
                      <p className="font-semibold text-on-surface">{opt.label}</p>
                      <p className="text-xs text-muted mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {modalMode === 'create' && (
                  <div className="flex items-center gap-2 -mt-2 mb-3">
                    <button type="button" onClick={() => setTipoActividad(null)}
                      className="text-xs text-accent hover:underline">← Cambiar tipo</button>
                  </div>
                )}
                <p className="text-base text-on-surface mb-2">
                  Actividad <strong className="text-accent">{previewActividad}</strong>
                </p>
            <form onSubmit={handleSaveActivity} className="space-y-2">
              <div>
                <label htmlFor="act-nombre" className="block text-sm font-medium text-muted mb-1">Nombre de la actividad</label>
                <input id="act-nombre" type="text" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Tarea 1, Examen parcial" />
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-1">Instrucciones</p>
                <RichTextEditor
                  value={form.instrucciones}
                  onChange={(html) => setForm((f) => ({ ...f, instrucciones: html }))}
                  placeholder="Describe la tarea para tus estudiantes…"
                  attachments={[
                    ...activityExistingFiles,
                    ...activityNewFiles.map((f) => ({ nombre: f.name, tamano: f.size })),
                  ]}
                  onAttachFiles={addInstructionFiles}
                  onRemoveAttachment={removeInstructionFile}
                  simple={IS_NATIVE_APP}
                />
              </div>
              {form.categoria !== 'cuestionario' && form.categoria !== 'examen' && (
                <div className="pt-1">
                  <FileTypeSelect
                    value={form.tiposArchivo}
                    onChange={(v) => setForm((f) => ({ ...f, tiposArchivo: v }))}
                    customExts={form.extensionesCustom}
                    onCustomChange={(v) => setForm((f) => ({ ...f, extensionesCustom: v }))}
                  />
                </div>
              )}

              {/* Visibilidad */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
                <VisibilitySelect
                  mode={form.visibilidadMode}
                  publishAt={form.publishAt}
                  onModeChange={(mode) => setForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                    fechaLimite: mode === 'hide' ? '' : f.fechaLimite,
                  }))}
                  onPublishAtChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              {/* Fecha límite — solo visible si no está oculta */}
              {form.visibilidadMode !== 'hide' && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1">
                    {form.fechaLimite ? 'Modificar fecha límite' : <>Fecha límite <span className="text-slate-400 font-normal">(opcional)</span></>}
                  </label>
                  {form.visibilidadMode === 'schedule' && !form.publishAt ? (
                    <p className="text-xs text-slate-400 px-1">Primero elige la fecha de publicación arriba.</p>
                  ) : (
                    <>
                      <EFDateTimePicker
                        mode="datetime"
                        headerLabel="Fecha y hora límite"
                        value={form.fechaLimite}
                        onChange={v => setForm(f => ({ ...f, fechaLimite: v }))}
                        placeholder="Sin fecha límite…"
                        clearable
                        minDateTime={minDeadline(
                          form.visibilidadMode === 'schedule' ? form.publishAt : form.publishedAt
                        )}
                      />
                      {form.fechaLimite ? (
                        <label className="flex items-start gap-2 mt-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!form.recibirTarde}
                            onChange={e => setForm(f => ({ ...f, recibirTarde: e.target.checked }))}
                            className="w-4 h-4 mt-0.5 accent-[var(--accent)] flex-shrink-0"
                          />
                          <span className="text-xs text-muted leading-snug">
                            Seguir recibiendo entregas después de la fecha límite
                            <span className="text-slate-400"> (se marcarán como <strong>entrega tarde</strong>). Si no la marcas, al pasar la fecha ya no se reciben.</span>
                          </span>
                        </label>
                      ) : (
                        <p className="text-xs text-slate-400 mt-1">
                          Luego de esta fecha y hora ya no se reciben entregas.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <button type="submit" disabled={saving}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Spinner size="sm" /> : modalMode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}
                {saving ? 'Guardando…' : modalMode === 'create'
                  ? (tipoActividad === 'cuestionario' || tipoActividad === 'examen') ? 'Crear y agregar preguntas' : 'Crear actividad'
                  : 'Guardar cambios'}
              </button>
              {!form.publishedAt && (
                <button type="button" disabled={saving} onClick={(e) => handleSaveActivity(e, true)}
                  className="w-full py-2 mt-2 border border-accent text-accent font-medium rounded transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-60">
                  Guardar como borrador
                </button>
              )}
            </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Duplicate activity confirmation ── */}
      {duplicateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDuplicateConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">Duplicar actividad</h3>
            <p className="text-sm text-muted mb-4">
              Se creará una copia de &ldquo;<strong>{duplicateConfirm.nombre}</strong>&rdquo; como <strong>borrador</strong>, con el nombre &ldquo;{duplicateConfirm.nombre} (copia)&rdquo;.
              Quedará oculta para estudiantes y sin número hasta que la publiques. Edítala para cambiarle el nombre.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDuplicateConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDuplicateActivity} disabled={duplicating}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {duplicating ? <Spinner size="sm" /> : <Copy size={16} />}
                {duplicating ? 'Duplicando…' : 'Duplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move activity confirmation (renumbering + aviso al grupo) ── */}
      {moveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !moving && setMoveConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Cambiar de lugar la actividad?</h3>
            <p className="text-sm text-muted mb-3">
              &quot;<strong>{moveConfirm.a.nombre}</strong>&quot; cambiará de lugar dentro del Parcial {moveConfirm.a.parcial}.
              El número de una actividad depende de su lugar, así que estas quedarán con otro número:
            </p>
            <ul className="text-sm text-on-surface bg-surface-container rounded px-3 py-2 mb-3 space-y-1">
              {moveConfirm.changes.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted tabular-nums flex-shrink-0">{c.de}</span>
                  <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="text-accent font-semibold tabular-nums flex-shrink-0">{c.hacia}</span>
                  <span className="truncate">{c.nombre}</span>
                </li>
              ))}
            </ul>
            {moveConfirm.changes.some((c) => c.publicada) && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3 flex gap-1.5">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Ya están publicadas: tus estudiantes las conocen con el número que tienen hoy.
                  Avísale al grupo del cambio para que no entreguen en la actividad equivocada.
                </span>
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setMoveConfirm(null)} disabled={moving}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={() => applyMoveActivities(moveConfirm.a.parcial, moveConfirm.newList)} disabled={moving}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {moving ? <Spinner size="sm" /> : <ArrowUpDown size={16} />}
                {moving ? 'Moviendo…' : 'Mover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish draft confirmation ── */}
      {publishDraftConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setPublishDraftConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Publicar actividad?</h3>
            <p className="text-sm text-muted mb-2">
              &ldquo;<strong>{publishDraftConfirm.nombre}</strong>&rdquo; es un borrador. Al publicarla, los estudiantes podrán verla y se registrará la fecha y hora de publicación.
            </p>
            {/(\(copia\))\s*$/i.test(publishDraftConfirm.nombre || '') && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5 mb-3">
                Aún tiene el nombre de copia — conviene editarla antes de publicar.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPublishDraftConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              {/* Editar is the primary path — a draft usually still needs changes
                  (esp. duplicates); Publicar stays available as secondary */}
              <button type="button" onClick={publishDraftNow}
                className="flex-1 py-1.5 rounded border border-accent text-accent text-sm font-medium hover:bg-[var(--accent-medium)] flex items-center justify-center gap-1.5">
                <Eye size={14} /> Publicar
              </button>
              <button type="button"
                onClick={() => { const a = publishDraftConfirm; setPublishDraftConfirm(null); openEdit(a, activityLabelById[a.id]) }}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover flex items-center justify-center gap-2">
                <Pencil size={16} /> Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete activity confirmation ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar actividad?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteActivity} disabled={deleting}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Material de apoyo create/edit modal ── */}
      {showMaterialModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowMaterialModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-3xl rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {materialModalMode === 'create' ? `Nuevo material de apoyo — Parcial ${materialParcial}` : 'Editar material de apoyo'}
              </h3>
              <button type="button" onClick={() => setShowMaterialModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-xs text-slate-400 -mt-2 mb-3">Este material queda solo en el Parcial {materialParcial} y no genera entrega ni número de actividad. Para materiales de toda la asignatura usa la pestaña Recursos.</p>
            <form onSubmit={handleSaveMaterial} className="space-y-2">
              <div>
                <label htmlFor="material-nombre" className="block text-sm font-medium text-muted mb-1">Nombre del material</label>
                <input id="material-nombre" type="text" value={materialForm.nombre} onChange={(e) => setMaterialForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Libro de texto, Video introductorio, Guía de laboratorio" />
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-1">Descripción <span className="text-slate-400 font-normal">(opcional)</span></p>
                <RichTextEditor
                  value={materialForm.descripcion}
                  onChange={(html) => setMaterialForm((f) => ({ ...f, descripcion: html }))}
                  placeholder="Explica brevemente este material para tus estudiantes…"
                />
              </div>

              <div>
                <p className="block text-sm font-medium text-muted mb-1">Recursos</p>
                <FileDropzone
                  onFilesSelected={addMaterialFiles}
                  hint="Cualquier tipo de archivo (PDF, Word, Excel, PowerPoint, imágenes, audio, video, ZIP, RAR…) · máximo 15 MB por archivo"
                />
                {(materialExistingFiles.length > 0 || materialNewFiles.length > 0) && (
                  <div className="space-y-1 mt-2">
                    {materialExistingFiles.map((f, i) => (
                      <div key={f.url || `existing-${f.nombre}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-outline-variant">
                        <Paperclip size={16} className="text-slate-400 flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.nombre}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.tamano)}</span>
                        <button type="button" onClick={() => setMaterialExistingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="Quitar archivo"
                          className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    {materialNewFiles.map((f, i) => (
                      <div key={`new-${f.name}-${f.size}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded border border-accent bg-[var(--accent-tint)]">
                        <Paperclip size={16} className="text-accent flex-shrink-0" />
                        <span className="text-sm text-on-surface truncate flex-1">{f.name}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.size)}</span>
                        <button type="button" onClick={() => setMaterialNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="Quitar archivo"
                          className="p-1 text-slate-400 hover:text-red-500 rounded flex-shrink-0">
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visibilidad */}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Visibilidad</p>
                <VisibilitySelect
                  // Si el material YA es visible para los estudiantes, se
                  // bloquea a la vista "Publicada" (igual que las
                  // actividades) — sin esto, reabrir "Editar" y tocar de más
                  // en "Programar publicación"/"Ocultar" apagaba en
                  // silencio un material que ya estaban viendo. Mostrar/
                  // ocultar sigue siendo trabajo del ojito en la tarjeta,
                  // nunca de este formulario.
                  mode={(editingMaterial && !editingMaterial.oculta) ? 'published' : materialForm.visibilidadMode}
                  publishAt={materialForm.publishAt}
                  onModeChange={(mode) => setMaterialForm((f) => ({
                    ...f, visibilidadMode: mode,
                    oculta: mode !== 'show',
                    publishAt: mode === 'schedule' ? f.publishAt : '',
                  }))}
                  onPublishAtChange={(v) => setMaterialForm((f) => ({ ...f, publishAt: v }))}
                />
              </div>

              <button type="submit" disabled={savingMaterial || !materialChanged}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {savingMaterial ? <Spinner size="sm" /> : materialModalMode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}
                {savingMaterial ? 'Guardando…' : materialModalMode === 'create' ? 'Crear material' : 'Guardar cambios'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete material confirmation ── */}
      {deleteMaterialConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteMaterialConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar material de apoyo?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteMaterialConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteMaterialConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteMaterial} disabled={deletingMaterial}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingMaterial ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingMaterial ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add student modal ── */}
      {showAddStudent && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowAddStudent(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Agregar estudiante</h3>
              <button type="button" onClick={() => setShowAddStudent(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={addStudent} className="space-y-3">
              {/* Antes solo tenían placeholder ("Prueba", "No tengo", "Pepito"
                  en los ejemplos que se ven en pantalla) — en cuanto se
                  escribía algo, no quedaba ninguna pista de a cuál apellido o
                  nombre correspondía cada campo. Con label fijo arriba, el
                  campo se sigue identificando aunque ya tenga texto. */}
              {[
                { field: 'apellidoPaterno', label: 'Apellido paterno', placeholder: 'Ej: García' },
                { field: 'apellidoMaterno', label: 'Apellido materno', placeholder: 'Ej: López' },
                { field: 'nombre', label: 'Nombre(s)', placeholder: 'Ej: Juan Carlos' },
              ].map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label htmlFor={`add-student-${field}`} className="block text-sm font-medium text-muted mb-1">{label}</label>
                  <input
                    id={`add-student-${field}`}
                    type="text"
                    value={newStudent[field]}
                    onChange={(e) => setNewStudent((f) => ({ ...f, [field]: e.target.value }))}
                    required
                    // autoFocus intencional: primer campo del modal, se abre
                    // una sola vez por apertura — no hay nada más que esperar.
                    autoFocus={field === 'apellidoPaterno'}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder={placeholder}
                  />
                </div>
              ))}
              {IS_NATIVE_APP && (
                <p className="text-xs text-muted text-center">Para subir a todo el grupo usa la plantilla de excel en la web</p>
              )}
              <button
                type="submit"
                disabled={savingStudent}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Plus size={18} />}
                Agregar estudiante
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit student modal ── */}
      {studentToEdit && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStudentToEdit(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Editar estudiante</h3>
              <button type="button" onClick={() => setStudentToEdit(null)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            {/* Foto de perfil del estudiante — la sube el propio estudiante desde su cuenta;
                el docente solo puede eliminarla (por si sube algo inapropiado), no reemplazarla */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-16 h-16 rounded-full bg-accent-light overflow-hidden flex items-center justify-center flex-shrink-0">
                {studentToEdit.photoURL ? (
                  <img src={studentToEdit.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-accent">{(studentToEdit.nombre || '?').charAt(0).toUpperCase()}</span>
                )}
              </div>
              {studentToEdit.photoURL ? (
                <div className="flex flex-col items-start gap-1">
                  <p className="text-xs text-muted">Foto de perfil que subió el estudiante.</p>
                  <button type="button" onClick={handleDeleteStudentPhoto}
                    className="text-xs font-semibold text-red-500 hover:text-red-600 hover:underline">
                    Eliminar foto
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted">El estudiante aún no ha subido una foto de perfil.</p>
              )}
            </div>
            <form onSubmit={saveEditStudent} className="space-y-2">
              {['apellidoPaterno', 'apellidoMaterno', 'nombre'].map((field) => (
                <input
                  key={field}
                  type="text"
                  value={editStudentForm[field]}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, [field]: e.target.value }))}
                  required={field !== 'apellidoMaterno'}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder={
                    field === 'apellidoPaterno' ? 'Apellido paterno'
                      : field === 'apellidoMaterno' ? 'Apellido materno'
                      : 'Nombre(s)'
                  }
                />
              ))}
              <div>
                <label htmlFor="edit-student-comentarios" className="block text-xs font-medium text-muted mb-1">Comentarios (solo para ti, el estudiante no los ve)</label>
                <textarea
                  id="edit-student-comentarios"
                  value={editStudentForm.comentarios}
                  onChange={(e) => setEditStudentForm((f) => ({ ...f, comentarios: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                  placeholder="Ej: necesita apoyo extra, cambió de grupo, etc."
                />
              </div>
              <button
                type="submit"
                disabled={savingStudent || !editStudentChanged}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Pencil size={18} />}
                Guardar cambios
              </button>
              <button
                type="button"
                onClick={requestResetFromEdit}
                disabled={savingStudent}
                className="w-full py-1.5 rounded border border-amber-200 text-amber-600 text-sm font-semibold hover:bg-amber-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RotateCcw size={17} />
                Habilitar recuperación de contraseña
              </button>
              <button
                type="button"
                onClick={requestDeleteFromEdit}
                disabled={savingStudent}
                className="w-full py-1.5 rounded border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Trash2 size={17} />
                Eliminar estudiante
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Reset password confirmation ── */}
      {studentToReset && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStudentToReset(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Habilitar recuperación de contraseña?</h3>
            <p className="text-sm text-muted text-center mt-2">
              <strong>{studentFullName(studentToReset)}</strong>{' '}
              ({studentToReset.username}) podrá elegir una <strong>nueva contraseña</strong> desde
              «Recuperar contraseña» en su pantalla de acceso. No necesitas darle ninguna clave.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setStudentToReset(null)}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={confirmResetStudentPassword}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded transition-colors flex items-center justify-center gap-2"
              >
                <KeyRound size={18} />
                Habilitar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate credentials modal (R16) ── */}
      {showCredentialsModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !generatingCredentials && setShowCredentialsModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Descargar lista de acceso</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se descargará un PDF con el <strong>usuario</strong> de cada estudiante y el
              <strong> código de la clase</strong> para que puedan entrar por primera vez.
            </p>
            <p className="text-xs text-muted text-center mt-2">
              Cada estudiante elige su propia contraseña la primera vez que entra. No se generan claves temporales.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setShowCredentialsModal(false)}
                disabled={generatingCredentials}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={handleGenerateCredentials}
                disabled={generatingCredentials}
                className="flex-1 py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {generatingCredentials ? <Spinner size="sm" /> : <Download size={18} />}
                {generatingCredentials ? 'Descargando…' : 'Descargar lista'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Activity-name tooltip ABOVE the number header (fixed → never clipped) ── */}
      {actTip && (
        <div
          className="fixed z-[9999] -translate-x-1/2 -translate-y-full px-2 py-1 rounded border border-[#c0c0c0] bg-[#f5f5f5] text-[#111] text-[11px] whitespace-nowrap shadow pointer-events-none"
          style={{ left: actTip.x, top: actTip.y - 6 }}
        >
          {actTip.text}
        </div>
      )}

      {/* ── Per-activity ⋮ menu: Subir / Bajar / Duplicar / Eliminar (fixed → never clipped) ── */}
      {activityMenu && (
        <>
          <button type="button" className="fixed inset-0 z-40 border-none cursor-default bg-transparent" onClick={() => setActivityMenu(null)} aria-label="Cerrar menú" />
          <div
            className="fixed z-50 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl overflow-hidden"
            style={{ top: activityMenu.y + 4, left: Math.max(8, activityMenu.x - 208) }}
          >
            {/* Cambiar de lugar dentro del parcial. El número (1.2., 1.3.…) va
                con la posición, así que mover renumera — de ahí la confirmación. */}
            <button type="button"
              disabled={activityMenuIdx <= 0}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); requestMoveActivity(a, -1) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <ArrowUp size={16} className="text-slate-400 flex-shrink-0" /> Subir un lugar
            </button>
            <button type="button"
              disabled={activityMenuIdx < 0 || activityMenuIdx >= activityMenuSiblings.length - 1}
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); requestMoveActivity(a, 1) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left border-b border-outline-variant disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default">
              <ArrowDown size={16} className="text-slate-400 flex-shrink-0" /> Bajar un lugar
            </button>
            <button type="button"
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); setDuplicateConfirm(a) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left">
              <Copy size={16} className="text-slate-400 flex-shrink-0" /> Duplicar como borrador
            </button>
            <button type="button"
              onClick={() => { const a = activityMenu.a; setActivityMenu(null); setDeleteConfirm(a) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left border-t border-outline-variant">
              <Trash2 size={16} className="flex-shrink-0" /> Eliminar
            </button>
          </div>
        </>
      )}

      {/* ── Corrección rápida de calificación (clic derecho en la celda) ──
          Mismo patrón que el menú ⋮ de arriba: backdrop invisible + tarjeta
          fija pegada al punto donde se hizo clic. */}
      {gradeQuickEdit && (
        <>
          <button type="button" className="fixed inset-0 z-40 border-none cursor-default bg-transparent" onClick={() => setGradeQuickEdit(null)} aria-label="Cerrar" />
          <div
            className="fixed z-50 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl p-3 space-y-2"
            style={{ top: gradeQuickEdit.y, left: gradeQuickEdit.x }}
          >
            <p className="text-xs font-medium text-muted">{gradeQuickEdit.subId ? 'Corregir calificación' : 'Calificar (sin entrega)'}</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} max={gradeQuickEdit.maxCalif} step="0.1"
                ref={(el) => el?.focus()}
                value={gradeQuickEdit.value}
                onChange={(e) => setGradeQuickEdit((g) => ({ ...g, value: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveGradeQuickEdit(); if (e.key === 'Escape') setGradeQuickEdit(null) }}
                className="w-16 px-2 py-1.5 text-center text-sm font-bold border border-outline-variant rounded bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="text-xs text-muted">/ {gradeQuickEdit.maxCalif}</span>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setGradeQuickEdit(null)} disabled={savingQuickGrade}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-xs font-medium hover:bg-surface transition-colors disabled:opacity-60">
                Cancelar
              </button>
              <button type="button" onClick={saveGradeQuickEdit} disabled={savingQuickGrade}
                className="flex-1 py-1.5 rounded bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                {savingQuickGrade ? <Spinner size="sm" /> : <CheckIcon size={13} />} Guardar
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Traer actividad de otra asignatura ── */}
      {importFor != null && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !importing && setImportFor(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-md rounded-t-card sm:rounded-card shadow-2xl max-h-[85vh] flex flex-col">
            <div className="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
              {importSrc && (
                <button type="button" onClick={() => { setImportSrc(null); setImportSrcActs([]); setImportSel(new Set()) }}
                  aria-label="Volver"
                  className="p-1 -ml-1 text-slate-400 hover:text-accent rounded flex-shrink-0"><ArrowLeft size={18} /></button>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-on-surface truncate">Traer al Parcial {importFor}</h3>
                <p className="text-xs text-slate-500 truncate">
                  {importSrc ? `De: ${subjectDisplayName(importSrc)}` : 'Elige de cuál de tus asignaturas'}
                </p>
              </div>
              <button type="button" onClick={() => !importing && setImportFor(null)} aria-label="Cerrar" className="p-2 text-slate-400 rounded flex-shrink-0"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {importLoading ? (
                <div className="flex justify-center py-10"><Spinner size="lg" /></div>
              ) : !importSrc ? (
                importSubjects.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-8">No tienes otras asignaturas de dónde traer.</p>
                ) : (
                  <div className="space-y-1.5">
                    {importSubjects.map((s) => (
                      <button key={s.id} type="button" onClick={() => pickImportSubject(s)}
                        className="w-full flex items-center gap-3 p-3 rounded border border-outline-variant hover:border-accent hover:bg-[var(--accent-tint)] transition-colors text-left">
                        <div className="w-8 h-8 rounded bg-accent-light flex items-center justify-center flex-shrink-0">
                          <SubjectIcon iconKey={s.icon} size={18} className="text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-on-surface truncate">{subjectDisplayName(s)}</p>
                          {s.archived && <p className="text-xs text-amber-600">Archivada</p>}
                        </div>
                        <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )
              ) : (
                importSrcActs.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-8">Esta asignatura no tiene actividades publicadas para traer.</p>
                ) : (
                  <div className="space-y-3">
                    {[...new Set(importSrcActs.map((a) => a.parcial))].sort((a, b) => a - b).map((pp) => (
                      <div key={pp}>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Parcial {pp}</p>
                        <div className="space-y-1">
                          {importSrcActs.filter((a) => a.parcial === pp).map((a) => {
                            const tipoLbl = a.categoria === 'examen' ? 'Examen' : a.categoria === 'cuestionario' ? 'Cuestionario' : a.categoria === 'observacion' ? 'Observación' : 'Entregable'
                            const checked = importSel.has(a.id)
                            return (
                              <label key={a.id} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${checked ? 'border-accent bg-[var(--accent-tint)]' : 'border-outline-variant hover:border-accent'}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleImportSel(a.id)} className="w-4 h-4 accent-[var(--accent)] flex-shrink-0" />
                                <span className="flex-1 min-w-0 text-sm text-on-surface truncate">{a.nombre}</span>
                                <span className="text-xs text-slate-400 flex-shrink-0">{tipoLbl}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {importSrc && importSrcActs.length > 0 && (
              <div className="px-4 py-3 border-t border-outline-variant flex items-center gap-2">
                <span className="text-xs text-muted flex-1">{importSel.size} seleccionada{importSel.size !== 1 ? 's' : ''}</span>
                <button type="button" onClick={confirmImport} disabled={!importSel.size || importing}
                  className="px-4 py-2 rounded bg-accent text-white text-sm font-semibold disabled:opacity-60 hover:bg-accent-hover transition-colors flex items-center gap-2">
                  {importing ? <Spinner size="sm" /> : <Copy size={16} />}
                  {importing ? 'Trayendo…' : 'Traer como borrador'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Kebab menu per parcial (Exportar / Cerrar) — fixed-positioned so the
          table's overflow container can't clip it ── */}
      {parcialMenu && (
        <>
          <button type="button" className="fixed inset-0 z-40 border-none cursor-default bg-transparent" onClick={() => setParcialMenu(null)} aria-label="Cerrar menú" />
          {/* No overflow-hidden here: the "Cerrar" item's tooltip must be able to
              escape the menu box when ponderación doesn't sum 10 */}
          <div
            className="fixed z-50 w-52 bg-surface-card border border-outline-variant rounded-card shadow-2xl"
            style={{ top: parcialMenu.y + 4, left: Math.max(8, parcialMenu.x - 208) }}
          >
            <div className="px-3 py-2 text-xs font-semibold text-muted border-b border-outline-variant">Parcial {parcialMenu.p}</div>
            {/* 1 — Cerrar / Revertir cierre (habilita Exportar a Excel) */}
            {subject?.parcialesCerrados?.[parcialMenu.p] ? (
              <button type="button"
                onClick={() => { const p = parcialMenu.p; setParcialMenu(null); setRevertParcialConfirm(p) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left rounded-card">
                <RotateCcw size={16} className="text-amber-600 flex-shrink-0" /> Revertir cierre del Parcial {parcialMenu.p}
              </button>
            ) : (() => {
              const p = parcialMenu.p
              const pondOn = ponderacionActivaEnParcial(subject, p)
              const total = pondOn ? pesoTotalVivo(activities.filter((a) => a.parcial === p && !isDraftActivity(a))) : 10
              const sumOk = !pondOn || Math.abs(total - 10) <= 0.001
              return (
                <button type="button"
                  onClick={() => { setParcialMenu(null); requestCloseParcial(p) }}
                  data-tooltip={!sumOk ? `La ponderación del Parcial ${p} suma ${total} de 10 — ajústala hasta llegar a 10 para poder cerrar` : undefined}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-[var(--accent-tint)] transition-colors text-left rounded-card">
                  <Lock size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="flex-1">Cerrar Parcial {p}</span>
                  {!sumOk && <span className="text-[10px] font-semibold text-amber-600">{total}/10</span>}
                </button>
              )
            })()}
          </div>
        </>
      )}

      {/* ── Revertir ponderación (todos los parciales) ── */}
      {confirmRevertPonderacion && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setConfirmRevertPonderacion(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Volver a promedio simple?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Al menos una actividad ya tiene ponderación. Los pesos capturados se borrarán y todas las actividades valdrán lo mismo.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setConfirmRevertPonderacion(false)}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={() => applyPonderacion(false)}
                className="flex-1 py-2 rounded bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors">
                Sí, promedio simple
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Revertir ponderación de UN parcial ── */}
      {confirmRevertParcial != null && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setConfirmRevertParcial(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Parcial {confirmRevertParcial} con promedio simple?</h3>
            <p className="text-sm text-muted text-center mt-2">
              El Parcial {confirmRevertParcial} ya tiene pesos capturados. Se borrarán y ese parcial usará promedio simple.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setConfirmRevertParcial(null)}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={() => applyParcialPonderacion(confirmRevertParcial, false)}
                className="flex-1 py-2 rounded bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors">
                Sí, promedio simple
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cerrar parcial: requires everything graded; no-entregas → 0 on proceed ── */}
      {closeParcialConfirm && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !closingParcial && setCloseParcialConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-center text-on-surface">Cerrar el Parcial {closeParcialConfirm.p}</h3>
            <p className="text-sm text-muted text-center mt-2">
              Para cerrar el parcial, <strong>todas las calificaciones deben estar puestas</strong>.
            </p>
            {closeParcialConfirm.pondError ? (
              <>
                {/* Blocker: ponderación must sum exactly 10 */}
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3 leading-relaxed">
                  La ponderación del Parcial {closeParcialConfirm.p} suma <strong>{closeParcialConfirm.pondError.total} de 10</strong>.
                  Ajusta los pesos hasta que sumen 10 y vuelve a cerrar.
                </p>
                <button type="button" onClick={() => setCloseParcialConfirm(null)}
                  className="w-full py-2 mt-4 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
                  Entendido
                </button>
              </>
            ) : closeParcialConfirm.ungraded > 0 ? (
              <>
                {/* Blocker: real deliveries need a manual grade, can't be auto-zeroed.
                    Se menciona también el total sin entrega (aunque esas SÍ se
                    autocalifican en 0 al cerrar, y no son las que bloquean) — pedido
                    explícito: antes, con ungraded>0, esta pantalla ocultaba por
                    completo el conteo de "sin entrega" (solo aparecía en la
                    siguiente, una vez resuelto lo de arriba), y "solo 3 sin
                    calificar" confundía a quien veía muchas más celdas en blanco
                    en la tabla — la mayoría de esas son "sin entrega", no entregas
                    reales pendientes de nota. */}
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 mt-3 leading-relaxed">
                  Hay <strong>{closeParcialConfirm.ungraded} entrega{closeParcialConfirm.ungraded !== 1 ? 's' : ''} sin calificar</strong>.
                  Como son entregas reales, califícalas tú antes de cerrar. Cancela, ponles calificación y vuelve a cerrar.
                  {closeParcialConfirm.missing.length > 0 && (
                    <> (Las {closeParcialConfirm.missing.length} celdas sin entrega no cuentan aquí — esas se ponen en 0 solas al cerrar.)</>
                  )}
                </p>
                <button type="button" onClick={() => setCloseParcialConfirm(null)}
                  className="w-full py-2 mt-4 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
                  Entendido
                </button>
              </>
            ) : (
              <>
                {closeParcialConfirm.missing.length > 0 ? (
                  <>
                    <p className="text-sm text-muted text-center mt-2">
                      Faltan <strong>{closeParcialConfirm.missing.length} entrega{closeParcialConfirm.missing.length !== 1 ? 's' : ''}</strong> o
                      asigna desde aquí una misma calificación a todas juntas.
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-3">
                      <label htmlFor="close-parcial-grade" className="text-sm text-muted">Calificación para todas:</label>
                      <input
                        id="close-parcial-grade"
                        type="number"
                        min="0"
                        step="0.1"
                        value={closeParcialGrade}
                        onChange={(e) => setCloseParcialGrade(e.target.value)}
                        disabled={closingParcial}
                        className="w-20 px-3 py-1.5 rounded border border-outline-variant text-center text-sm font-semibold text-on-surface bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted text-center mt-2">Todo está calificado. Puedes cerrar el parcial.</p>
                )}
                <div className="flex gap-2 mt-4">
                  <button type="button" onClick={() => setCloseParcialConfirm(null)} disabled={closingParcial}
                    className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={confirmCloseParcial} disabled={closingParcial}
                    className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 transition-colors">
                    {closingParcial ? 'Cerrando…' : (closeParcialConfirm.missing.length > 0 ? `Cerrar y poner ${Math.max(0, parseFloat(closeParcialGrade) || 0)}` : 'Cerrar parcial')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Revertir cierre del parcial: borra las calificaciones del cierre ── */}
      {revertParcialConfirm != null && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !revertingParcial && setRevertParcialConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Revertir el cierre del Parcial {revertParcialConfirm}?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Las calificaciones que se pusieron al cerrar se eliminarán: esas no entregas volverán a quedar <strong>solo sin entrega</strong>, como antes de cerrar. Las calificaciones que pusiste a mano no se tocan.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setRevertParcialConfirm(null)} disabled={revertingParcial}
                className="flex-1 py-2 rounded border border-outline-variant text-sm text-muted hover:bg-surface transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={revertCloseParcial} disabled={revertingParcial}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 transition-colors">
                {revertingParcial ? 'Revirtiendo…' : 'Revertir cierre'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Same-name found: link to existing account or create new ── */}
      {linkCandidate && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !savingStudent && setLinkCandidate(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-[calc(100%-2rem)] max-w-sm rounded-t-card sm:rounded-card p-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-accent-light flex items-center justify-center mx-auto mb-2">
              <UserPlus size={24} className="text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Es el mismo estudiante?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Ya hay un estudiante llamado{' '}
              <strong>{studentFullName(linkCandidate.person)}</strong>{' '}
              en esta escuela
              {(() => {
                const n = new Set(linkCandidate.identity.matches.map((m) => m.asignaturaId)).size
                return n ? ` (inscrito en ${n} asignatura${n !== 1 ? 's' : ''})` : ''
              })()}.
            </p>
            <p className="text-xs text-muted text-center mt-2">
              Si es la <strong>misma persona</strong>, se agrega esta asignatura a su cuenta (mismo usuario
              <span className="font-mono"> {linkCandidate.identity.username}</span>). Si es <strong>otra persona</strong> con el mismo nombre, se crea una cuenta nueva.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <button type="button"
                onClick={() => resolveLinkCandidate(true)}
                disabled={savingStudent}
                className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {savingStudent ? <Spinner size="sm" /> : <CheckIcon size={18} />}
                Sí, es el mismo estudiante
              </button>
              <button type="button"
                onClick={() => resolveLinkCandidate(false)}
                disabled={savingStudent}
                className="w-full py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors disabled:opacity-60"
              >
                No, es otro estudiante (cuenta nueva)
              </button>
              <button type="button"
                onClick={() => setLinkCandidate(null)}
                disabled={savingStudent}
                className="w-full py-2 text-sm text-muted hover:text-on-surface transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vista previa antes de importar el Excel de estudiantes ── pedido
          explícito: revisar y confirmar antes de escribir en Firestore, y
          avisar de filas que no se pudieron leer en vez de que
          desaparezcan en silencio. */}
      {excelPreview && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !importingExcel && setExcelPreview(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full sm:w-[calc(100%-2rem)] max-w-lg rounded-t-card sm:rounded-card shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-outline-variant flex-shrink-0 flex items-center justify-between">
              <h3 className="text-base font-semibold text-on-surface">Revisa antes de importar</h3>
              <button type="button" onClick={() => !importingExcel && setExcelPreview(null)} aria-label="Cerrar" className="p-1 text-slate-400 hover:text-muted rounded"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {excelPreview.invalid.length > 0 && (
                <div className="rounded-card border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle size={16} className="flex-shrink-0" /> {excelPreview.invalid.length} fila{excelPreview.invalid.length !== 1 ? 's' : ''} no se {excelPreview.invalid.length !== 1 ? 'pudieron' : 'pudo'} leer
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
                    {excelPreview.invalid.map((inv) => (
                      <li key={inv.fila}>Fila {inv.fila} del Excel: “{inv.texto || '(vacía)'}”</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-amber-700">Estas filas se van a omitir. Corrígelas en el archivo y vuelve a subirlo si quieres incluirlas.</p>
                </div>
              )}
              {excelPreview.rows.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                    {excelPreview.rows.filter((r) => r.status !== 'skip' && r.status !== 'duplicate').length} estudiante{excelPreview.rows.filter((r) => r.status !== 'skip' && r.status !== 'duplicate').length !== 1 ? 's' : ''} se van a agregar
                  </p>
                  {/* Aviso UNA sola vez, no por fila: antes una coincidencia de
                      nombre se vinculaba a la cuenta existente sin preguntar —
                      distinto al alta manual, que siempre pregunta "¿es el
                      mismo estudiante?". Con nombres comunes eso fusionaba en
                      silencio a dos personas reales en una sola cuenta. Ahora
                      "Cuenta existente" es el badge por default (la propuesta
                      más probable), pero se puede voltear por fila. */}
                  {excelPreview.rows.some((r) => r.status === 'link') && (
                    <p className="text-xs text-muted bg-surface-container rounded px-2.5 py-1.5 mb-1.5">
                      Los marcados <strong>Cuenta existente</strong> coinciden con un nombre que ya está en la
                      escuela y se van a unir a esa cuenta. Si alguno es <strong>otra persona</strong> que solo
                      comparte el nombre, tócalo para darle una cuenta nueva.
                    </p>
                  )}
                  {/* 'duplicate': mismo nombre repetido dos veces en ESTE
                      archivo (fila copiada de más) — solo la primera se
                      procesa, las demás se omiten para no crear dos cuentas
                      de la misma persona. */}
                  {excelPreview.rows.some((r) => r.status === 'duplicate') && (
                    <p className="text-xs text-muted bg-surface-container rounded px-2.5 py-1.5 mb-1.5">
                      Los marcados <strong>Repetido</strong> tienen el mismo nombre que otra fila de este mismo
                      archivo — solo se agrega la primera, el resto se omite.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {excelPreview.rows.map((item, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm px-2.5 py-1.5 rounded bg-surface border border-outline-variant">
                        <span className="text-on-surface truncate">{studentFullName(item.row)}</span>
                        {item.status === 'new' && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">Nuevo</span>}
                        {item.status === 'link' && (
                          <button
                            type="button"
                            onClick={() => toggleImportLinkDecision(i)}
                            data-tooltip={item.decision === 'link'
                              ? 'Toca si es otra persona que solo comparte el nombre'
                              : 'Toca si en realidad es la misma persona'}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 transition-colors ${
                              item.decision === 'link'
                                ? 'text-accent bg-accent-light hover:bg-[var(--accent-tint)]'
                                : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                            }`}
                          >
                            {item.decision === 'link' ? 'Cuenta existente ✎' : 'Cuenta nueva ✎'}
                          </button>
                        )}
                        {item.status === 'skip' && <span className="text-[10px] font-semibold text-muted bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">Ya inscrito — se omite</span>}
                        {item.status === 'duplicate' && <span className="text-[10px] font-semibold text-muted bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">Repetido — se omite</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted text-center py-6">No hay estudiantes válidos para importar.</p>
              )}
            </div>
            <div className="p-3 border-t border-outline-variant flex-shrink-0 flex gap-2">
              <button type="button" onClick={() => setExcelPreview(null)} disabled={importingExcel}
                className="flex-1 py-2 rounded border border-outline-variant text-muted text-sm font-semibold hover:bg-[var(--accent-tint)] transition-colors disabled:opacity-60">
                Cancelar
              </button>
              <button type="button" onClick={confirmExcelImport}
                disabled={importingExcel || excelPreview.rows.every((r) => r.status === 'skip' || r.status === 'duplicate')}
                className="flex-1 py-2 rounded bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {importingExcel ? <Spinner size="sm" /> : <CheckIcon size={16} />}
                {importingExcel ? 'Importando…' : 'Confirmar e importar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recovery enabled confirmation ── */}
      {resetPwdResult && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setResetPwdResult(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
              <KeyRound size={24} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">Recuperación habilitada</h3>
            <p className="text-sm text-muted text-center mt-2 mb-4">
              <strong>{resetPwdResult.student.nombre}</strong> ya puede entrar a la pantalla de acceso
              de estudiantes, tocar <strong>«Recuperar contraseña»</strong>, escribir su usuario y elegir una
              nueva contraseña.
            </p>
            <button type="button"
              onClick={() => setResetPwdResult(null)}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ── Delete student confirmation ── */}
      {studentToDelete && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setStudentToDelete(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-center text-on-surface">¿Eliminar estudiante?</h3>
            <p className="text-sm text-muted text-center mt-2">
              Se eliminará a{' '}
              <strong>{studentFullName(studentToDelete)}</strong>{' '}
              ({studentToDelete.username}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button"
                onClick={() => setStudentToDelete(null)}
                className="flex-1 py-2 bg-surface-container hover:bg-[var(--accent-tint)] text-muted font-semibold rounded transition-colors"
              >
                Cancelar
              </button>
              <button type="button"
                onClick={confirmDeleteStudent}
                disabled={savingStudent}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingStudent ? <Spinner size="sm" /> : <Trash2 size={18} />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Edit subject modal ── */}
      {showEditSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowEditSubjectModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-md rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Editar asignatura</h3>
              <button type="button" onClick={() => setShowEditSubjectModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleEditSubject} className="space-y-2">
              <div>
                <label htmlFor="edit-subject-nombre" className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input id="edit-subject-nombre" type="text" value={editSubjectForm.nombre} onChange={(e) => setEditSubjectForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas I" />
              </div>
              <div>
                <label htmlFor="edit-subject-grupo" className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input id="edit-subject-grupo" type="text" value={editSubjectForm.grupo} onChange={(e) => setEditSubjectForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-accent font-normal text-xs">(recomendado)</span>
                </p>
                <p className="text-xs text-muted mb-1.5">Con fechas de inicio y fin, los días para marcar asistencia se generan de forma automática y cada parcial queda organizado por periodo. Si tu escuela aún no define calendario, puedes dejarlo así y elegirlas después.</p>
                <div className="space-y-2">
                  <div>
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={editSubjectForm.fechaInicio} onChange={v => setEditSubjectForm(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div>
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={editSubjectForm.fechaFin} onChange={v => setEditSubjectForm(f => ({ ...f, fechaFin: v }))}
                      minDateTime={editSubjectForm.fechaInicio ? addOneDay(editSubjectForm.fechaInicio) : undefined}
                      disabled={!editSubjectForm.fechaInicio} />
                  </div>
                </div>
              </div>
              <div>
                <label htmlFor="edit-subject-parciales" className="block text-sm font-medium text-muted mb-1">Número de parciales</label>
                <select id="edit-subject-parciales" value={editSubjectForm.parciales} onChange={(e) => setEditSubjectForm((f) => ({ ...f, parciales: e.target.value }))}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface">
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'parcial' : 'parciales'}</option>)}
                </select>
              </div>
              {editSubjectForm.fechaInicio && editSubjectForm.fechaFin && (
                <ParcialesFechas
                  fechaInicio={editSubjectForm.fechaInicio}
                  fechaFin={editSubjectForm.fechaFin}
                  numParciales={parseInt(editSubjectForm.parciales) || 3}
                  value={editSubjectForm.parcialesFechas}
                  onChange={(v) => setEditSubjectForm((f) => ({ ...f, parcialesFechas: v }))}
                />
              )}
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Color de la asignatura <span className="text-slate-400 font-normal text-xs">(elige el color base que identificará a la asignatura)</span></p>
                <PaletteSelect value={editSubjectForm.colorPalette} onChange={(p) => setEditSubjectForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div {...subjectPaletteProps(editSubjectForm.colorPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</p>
                <IconSelect value={editSubjectForm.icon} onChange={(ic) => setEditSubjectForm((f) => ({ ...f, icon: ic }))} />
              </div>
              <button type="submit" disabled={editingSubject || !editSubjectChanged}
                className="w-full py-2 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
                {editingSubject ? <Spinner size="sm" /> : <Pencil size={18} />}
                {editingSubject ? 'Guardando…' : 'Guardar cambios'}
              </button>
              {/* Aire bajo el botón: como hoja inferior en móvil quedaba pegado
                  al borde de la pantalla (y bajo el gesto de inicio). */}
              <div className="h-6 safe-bottom" />
            </form>
          </div>
        </div>
      )}

      {/* ── Copy subject modal ── */}
      {showCopyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowCopyModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-md rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Duplicar asignatura</h3>
              <button type="button" onClick={() => setShowCopyModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleCopySubject} className="space-y-2">
              <div>
                <label htmlFor="copy-subject-nombre" className="block text-sm font-medium text-muted mb-1">Asignatura</label>
                <input id="copy-subject-nombre" type="text" value={copyForm.nombre} onChange={(e) => setCopyForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Matemáticas II" />
              </div>
              <div>
                <label htmlFor="copy-subject-grupo" className="block text-sm font-medium text-muted mb-1">Grupo</label>
                <input id="copy-subject-grupo" type="text" value={copyForm.grupo} onChange={(e) => setCopyForm((f) => ({ ...f, grupo: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: 1A, 2B, 3C" />
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-1">
                  Fechas <span className="text-accent font-normal text-xs">(recomendado)</span>
                </p>
                <p className="text-xs text-muted mb-1.5">Con fechas de inicio y fin, los días para marcar asistencia se generan de forma automática y cada parcial queda organizado por periodo. Si tu escuela aún no define calendario, puedes dejarlo así y elegirlas después.</p>
                <div className="space-y-2">
                  <div>
                    <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                    <EFDateTimePicker mode="date" value={copyFechas.fechaInicio} onChange={v => setCopyFechas(f => ({ ...f, fechaInicio: v }))} />
                  </div>
                  <div>
                    <span className="block text-sm text-slate-500 mb-1">Fin</span>
                    <EFDateTimePicker mode="date" value={copyFechas.fechaFin} onChange={v => setCopyFechas(f => ({ ...f, fechaFin: v }))}
                      minDateTime={copyFechas.fechaInicio ? addOneDay(copyFechas.fechaInicio) : undefined}
                      disabled={!copyFechas.fechaInicio} />
                  </div>
                </div>
              </div>
              <div>
                <p className="block text-sm font-medium text-muted mb-2">Color de la asignatura <span className="text-slate-400 font-normal text-xs">(elige el color base que identificará a la asignatura)</span></p>
                <PaletteSelect value={copyForm.colorPalette} onChange={(p) => setCopyForm((f) => ({ ...f, colorPalette: p }))} />
              </div>
              <div {...subjectPaletteProps(copyForm.colorPalette)}>
                <p className="block text-sm font-medium text-muted mb-2">Icono de la asignatura</p>
                <IconSelect value={copyForm.icon} onChange={(ic) => setCopyForm((f) => ({ ...f, icon: ic }))} />
              </div>
              <label aria-label="Copiar lista de estudiantes" className="flex items-center gap-2 p-3 rounded border border-outline-variant cursor-pointer hover:bg-[var(--accent-tint)] transition-colors">
                <input type="checkbox" checked={copyForm.keepStudents} onChange={(e) => setCopyForm((f) => ({ ...f, keepStudents: e.target.checked }))}
                  className="accent-[var(--accent)] w-4 h-4" />
                <div>
                  <p className="text-sm font-medium text-on-surface">Copiar lista de estudiantes</p>
                  <p className="text-sm text-slate-500">Conservan su mismo usuario y cuenta; quienes ya activaron verán esta asignatura al instante</p>
                </div>
              </label>
              <p className="text-sm text-slate-500">Se duplicarán todas las actividades. Las calificaciones y entregas no se copian.</p>
              <button type="submit" disabled={copyingSubject}
                className="w-full py-2 bg-accent text-white font-semibold rounded disabled:opacity-60 flex items-center justify-center gap-2">
                {copyingSubject ? <Spinner size="sm" /> : <Copy size={18} />}
                {copyingSubject ? 'Duplicando…' : 'Duplicar asignatura'}
              </button>
              <div className="h-6 safe-bottom" />
            </form>
          </div>
        </div>
      )}

      {/* ── Delete subject confirm modal ── */}
      {showDeleteSubjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-2">
              <Trash2 size={24} className="text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-on-surface text-center mb-1">¿Eliminar asignatura?</h3>
            <p className="text-sm text-muted text-center mb-2">
              Se borrarán permanentemente todas las actividades, entregas, asistencias y estudiantes de{' '}
              <strong>{subject?.nombre}</strong>. Esta acción <strong>no se puede deshacer</strong>.
            </p>
            <p className="text-xs text-muted mb-2">Escribe <strong>{subject?.nombre}</strong> para confirmar:</p>
            <input
              type="text"
              value={deleteSubjectConfirmText}
              onChange={(e) => setDeleteSubjectConfirmText(e.target.value)}
              className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 text-sm bg-surface mb-2"
              placeholder={subject?.nombre}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowDeleteSubjectConfirm(false); setDeleteSubjectConfirmText('') }}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteSubject}
                disabled={deletingSubject || deleteSubjectConfirmText !== subject?.nombre}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingSubject ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingSubject ? 'Eliminando…' : 'Eliminar todo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unarchive modal ── */}
      {/* ── Archive modal ── */}
      {showArchiveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => !archiving && setShowArchiveModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Archivar asignatura</h3>
              <button type="button" onClick={() => !archiving && setShowArchiveModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-3">
              Archivar solo la saca de tus asignaturas activas. <strong>No se borra nada</strong>:
              actividades, estudiantes, entregas y calificaciones se quedan completas, y puedes
              desarchivarla cuando quieras.
            </p>
            {/* Lo que pasa del lado del ESTUDIANTE — el modal antes solo hablaba
                de lo que veía el docente. Es literal lo que hace el código: su
                dashboard filtra por `archived` y la manda a la sección
                "Asignaturas archivadas", desde donde la puede seguir abriendo. */}
            <div className="rounded border border-outline-variant bg-surface p-3 mb-3">
              <p className="text-sm font-semibold text-on-surface mb-1">Qué van a ver tus estudiantes</p>
              <ul className="text-sm text-muted space-y-0.5">
                <li>• <strong>{subject?.nombre}</strong> sale de sus asignaturas y se va a «Asignaturas archivadas».</li>
                <li>• Ahí la pueden seguir abriendo, con sus entregas y calificaciones completas.</li>
              </ul>
            </div>
            {/* El respaldo ZIP es solo de la web: bajar un paquete con TODAS
                las entregas es trabajo de computadora, y ahí el archivo queda
                donde el docente lo va a encontrar. Archivar sí se puede desde
                la app; en vez de esconder la opción sin explicación, se le
                dice dónde está — si la necesita, todavía está a tiempo de ir
                por ella antes de archivar. */}
            {IS_NATIVE_APP ? (
              <div className="flex items-start gap-2 p-3 mb-4 rounded border border-amber-200 bg-amber-50">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">¿Quieres el respaldo ZIP de las entregas?</p>
                  <p className="text-sm text-amber-800">Archiva desde la versión web para descargarlo. Aquí puedes archivar, pero el ZIP solo se guarda desde la computadora.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                <label className="flex items-start gap-2 p-3 rounded border border-outline-variant cursor-pointer hover:bg-[var(--accent-tint)] transition-colors">
                  <input type="checkbox" checked={archiveConZip} onChange={(e) => setArchiveConZip(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <div>
                    <p className="text-sm font-medium text-on-surface">Descargar también un respaldo ZIP</p>
                    <p className="text-sm text-slate-500">Opcional — las entregas no se van a borrar</p>
                  </div>
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowArchiveModal(false)} disabled={archiving}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)] disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={handleArchiveConfirm} disabled={archiving}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {archiving ? <Spinner size="sm" /> : <Archive size={16} />}
                {archiving
                  ? (zipDownloading
                      ? `Descargando ${zipProgress.done}/${zipProgress.total}…`
                      : 'Archivando…')
                  : 'Archivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unarchive (restore) modal ── */}
      {showUnarchiveModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowUnarchiveModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-md rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Desarchivar asignatura</h3>
              <button type="button" onClick={() => setShowUnarchiveModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <p className="text-sm text-muted mb-2">Puedes editar los datos y elegir cómo restaurar:</p>

            <div className="space-y-2 mb-4">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Datos</p>
                <div className="space-y-2">
                  <input type="text" value={unarchiveEdits.nombre} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, nombre: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" placeholder="Asignatura" />
                  <input type="text" value={unarchiveEdits.grupo} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, grupo: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface" placeholder="Grupo (ej: 1A)" />
                  <div className="space-y-2">
                    <div>
                      <span className="block text-sm text-slate-500 mb-1">Inicio</span>
                      <EFDateTimePicker mode="date" value={unarchiveEdits.fechaInicio} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaInicio: v }))} />
                    </div>
                    <div>
                      <span className="block text-sm text-slate-500 mb-1">Fin</span>
                      <EFDateTimePicker mode="date" value={unarchiveEdits.fechaFin} onChange={v => setUnarchiveEdits(f => ({ ...f, fechaFin: v }))}
                        minDateTime={unarchiveEdits.fechaInicio ? addOneDay(unarchiveEdits.fechaInicio) : undefined}
                        disabled={!unarchiveEdits.fechaInicio} />
                    </div>
                  </div>
                  <select value={unarchiveEdits.parciales} onChange={(e) => setUnarchiveEdits((f) => ({ ...f, parciales: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface">
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'parcial' : 'parciales'}</option>)}
                  </select>
                  {unarchiveEdits.fechaInicio && unarchiveEdits.fechaFin && (
                    <ParcialesFechas
                      fechaInicio={unarchiveEdits.fechaInicio}
                      fechaFin={unarchiveEdits.fechaFin}
                      numParciales={parseInt(unarchiveEdits.parciales) || 3}
                      value={unarchiveEdits.parcialesFechas}
                      onChange={(v) => setUnarchiveEdits((f) => ({ ...f, parcialesFechas: v }))}
                    />
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Color de la asignatura <span className="normal-case font-normal text-slate-400">(el color base que la identificará)</span></p>
                <PaletteSelect value={unarchiveEdits.colorPalette} onChange={(p) => setUnarchiveEdits((f) => ({ ...f, colorPalette: p }))} />
              </div>

              <div {...subjectPaletteProps(unarchiveEdits.colorPalette)}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Icono de la asignatura</p>
                <IconSelect value={unarchiveEdits.icon} onChange={(ic) => setUnarchiveEdits((f) => ({ ...f, icon: ic }))} />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Lista de estudiantes</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar lista', desc: 'Estudiantes y calificaciones se mantienen' },
                    { val: 'reset', label: 'Borrar y empezar de cero', desc: 'Se eliminan estudiantes y sus entregas' },
                  ].map(({ val, label, desc }) => (
                    <label key={val} aria-label={label} className={`flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors ${unarchiveStudents === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`}>
                      <input type="radio" name="unarchiveStudents" value={val} checked={unarchiveStudents === val} onChange={() => setUnarchiveStudents(val)} className="accent-[var(--accent)]" />
                      <div>
                        <p className="text-sm font-medium text-on-surface">{label}</p>
                        <p className="text-sm text-slate-500">{desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Actividades</p>
                <div className="space-y-1.5">
                  {[
                    { val: 'keep', label: 'Conservar visibilidad actual' },
                    { val: 'show', label: 'Mostrar todas' },
                    { val: 'hide', label: 'Ocultar todas' },
                  ].map(({ val, label }) => (
                    <label key={val} className={`flex items-center gap-2 p-3 rounded border cursor-pointer transition-colors ${unarchiveActivities === val ? 'border-accent bg-accent-light' : 'border-outline-variant hover:bg-[var(--accent-tint)]'}`}>
                      <input type="radio" name="unarchiveActivities" value={val} checked={unarchiveActivities === val} onChange={() => setUnarchiveActivities(val)} className="accent-[var(--accent)]" />
                      <p className="text-sm font-medium text-on-surface">{label}</p>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setShowUnarchiveModal(false)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleUnarchiveConfirm} disabled={unarchivedSaving}
                className="flex-1 py-2 rounded bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60 flex items-center justify-center gap-2">
                {unarchivedSaving ? <Spinner size="sm" /> : null}
                {unarchivedSaving ? 'Guardando…' : 'Desarchivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit resource modal ── */}
      {showResourceModal && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setShowResourceModal(false)} aria-label="Cerrar" />
          <div className="relative bg-surface-card w-full max-w-sm rounded-t-card sm:rounded-card p-4 drop-shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{resourceModalMode === 'create' ? 'Agregar recurso' : 'Editar recurso'}</h3>
              <button type="button" onClick={() => setShowResourceModal(false)} aria-label="Cerrar" className="p-2 text-slate-400 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveResource} className="space-y-2">
              <div>
                <label htmlFor="resource-nombre" className="block text-xs font-medium text-muted mb-1">Nombre del recurso</label>
                <input
                  id="resource-nombre"
                  type="text"
                  value={resourceForm.nombre}
                  onChange={(e) => setResourceForm((f) => ({ ...f, nombre: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                  placeholder="Ej: Programa de la asignatura"
                />
              </div>
              <div>
                <label htmlFor="resource-descripcion" className="block text-xs font-medium text-muted mb-1">Descripción (opcional)</label>
                <textarea
                  id="resource-descripcion"
                  value={resourceForm.descripcion}
                  onChange={(e) => setResourceForm((f) => ({ ...f, descripcion: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface resize-none"
                  placeholder="Ej: Consulta este documento antes del primer parcial"
                />
              </div>
              <div>
                <p className="block text-xs font-medium text-muted mb-1">Tipo de recurso</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setResourceForm((f) => ({ ...f, tipo: 'archivo' }))}
                    className={`flex-1 py-1.5 rounded border text-sm font-medium transition-colors ${resourceForm.tipo === 'archivo' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted'}`}>
                    Archivo
                  </button>
                  <button type="button" onClick={() => setResourceForm((f) => ({ ...f, tipo: 'link' }))}
                    className={`flex-1 py-1.5 rounded border text-sm font-medium transition-colors ${resourceForm.tipo === 'link' ? 'border-accent bg-[var(--accent-tint)] text-accent' : 'border-outline-variant text-muted'}`}>
                    Enlace o video
                  </button>
                </div>
              </div>
              {resourceForm.tipo === 'archivo' ? (
                <div>
                  <label htmlFor="resource-archivo" className="block text-xs font-medium text-muted mb-1">
                    Archivo {resourceModalMode === 'edit' && resourceForm.origTipo === 'archivo' && '(déjalo vacío para conservar el actual)'}
                  </label>
                  <input
                    id="resource-archivo"
                    type="file"
                    accept={RESOURCE_ACCEPT}
                    onChange={(e) => setResourceFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent-light file:text-accent file:text-sm file:font-medium"
                  />
                  <p className="text-xs text-slate-400 mt-1">PDF, Word, Excel, Power Point, JPG o PNG · máximo 15 MB</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="resource-enlace" className="block text-xs font-medium text-muted mb-1">Enlace</label>
                  <input
                    id="resource-enlace"
                    type="text"
                    value={resourceForm.enlace}
                    onChange={(e) => setResourceForm((f) => ({ ...f, enlace: e.target.value }))}
                    className="w-full px-4 py-2 rounded border border-outline-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-sm bg-surface"
                    placeholder="https://..."
                  />
                  <p className="text-xs text-slate-400 mt-1">Video de YouTube, documento de Google Drive, sitio externo, etc.</p>
                </div>
              )}
              <button
                type="submit"
                disabled={savingResource || !resourceChanged}
                className="w-full py-2 bg-accent text-white font-semibold rounded transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {savingResource ? <Spinner size="sm" /> : <Upload size={18} />}
                {savingResource ? 'Guardando…' : 'Guardar recurso'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete resource confirm ── */}
      {deleteResourceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-black/40 border-none cursor-default" onClick={() => setDeleteResourceConfirm(null)} aria-label="Cerrar" />
          <div className="relative bg-surface-card rounded-card p-4 shadow-2xl w-full max-w-sm">
            <h3 className="text-base font-semibold text-on-surface mb-1">¿Eliminar recurso?</h3>
            <p className="text-sm text-muted mb-4">
              &ldquo;<strong>{deleteResourceConfirm.nombre}</strong>&rdquo; se eliminará permanentemente.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteResourceConfirm(null)}
                className="flex-1 py-1.5 rounded border border-outline-variant text-muted text-sm font-medium hover:bg-[var(--accent-tint)]">Cancelar</button>
              <button type="button" onClick={handleDeleteResource} disabled={deletingResource}
                className="flex-1 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingResource ? <Spinner size="sm" /> : <Trash2 size={16} />}
                {deletingResource ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ── Full-screen entregable editor ── */}
      {entregableEditor && (
        <EntregableEditor
          activityId={entregableEditor.activityId}
          parcial={entregableEditor.parcial}
          categoria={entregableEditor.categoria}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          existingActivities={activities}
          activityLabel={entregableEditor.activityLabel}
          contextLine={subjectDisplayName(subject)}
          initialForm={entregableEditor.initialForm}
          initialExistingFiles={entregableEditor.initialExistingFiles}
          onClose={() => setEntregableEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
          onNuevaFecha={editorIsPublished ? openNewDateForEditor : undefined}
          externalFechaLimite={entregableEditor.initialForm?.fechaLimite || ''}
          students={groupStudents}
          extensiones={editingActivityData?.extensiones || {}}
          extensionesMotivo={editingActivityData?.extensionesMotivo || {}}
        />
      )}

      {/* "Nueva fecha de entrega" opened from within the entregable editor above —
          z-[60] so it renders on top of the editor's z-50. */}
      {entregableEditor && newDateOpen && (
        <NuevaFechaEntregaModal
          activityId={entregableEditor.activityId}
          students={groupStudents}
          onClose={() => setNewDateOpen(false)}
          onSaved={applyNewDateResult}
        />
      )}

      {/* ── Full-screen evaluación editor (Cuestionario / Examen) ── */}
      {evalEditor && (
        <EvaluacionEditor
          activityId={evalEditor.activityId}
          parcial={evalEditor.parcial}
          categoria={evalEditor.categoria}
          activityLabel={evalEditor.activityLabel}
          contextLine={subjectDisplayName(subject)}
          subjectId={subjectId}
          docenteId={currentUser?.uid}
          subject={subject}
          existingActivities={activities}
          students={groupStudents}
          onClose={() => setEvalEditor(null)}
          onActivityCreated={(act) => {
            setActivities((prev) => [...prev, act])
            setSubmissionCounts((prev) => ({ ...prev, [act.id]: { delivered: 0, graded: 0 } }))
          }}
          onActivityUpdated={(act) => {
            setActivities((prev) => prev.map((a) => a.id === act.id ? { ...a, ...act } : a))
          }}
        />
      )}

      {/* Aviso previo a exportar en periodo de prueba — pedido explícito: se
          puede continuar, no es un bloqueo. Un solo modal para las 8
          funciones de exportación de este archivo (confirmExportNotice). */}
      {watermarkNoticeResolve && (
        <ConfirmModal
          title="Exportación en periodo de prueba"
          message="Los documentos generados durante el periodo de prueba incluyen una marca de agua de Evalúa Fácil. Al activar tu suscripción, todas las exportaciones se generarán sin marca de agua."
          confirmLabel="Continuar"
          onConfirm={() => { watermarkNoticeResolve(true); setWatermarkNoticeResolve(null) }}
          onCancel={() => { watermarkNoticeResolve(false); setWatermarkNoticeResolve(null) }}
        />
      )}
    </>
  )
}
