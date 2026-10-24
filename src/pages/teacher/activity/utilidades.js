// Constantes y funciones de ActivityPage.jsx (fase 5 de PLAN_NORMALIZACION_UI).
import { ALL_FILES_KEY, LINK_KEY } from '../../../config/fileTypes'
import { parseFechaLimite } from '../../../utils/activityVisibility'
import { esEvidenciaSoportada } from '../../../utils/tarifaCalificacionEvidencias.js'
import { useEffect } from 'react'

// La evaluación con rúbrica de un alumno "no existe" hasta que se elige algún
// nivel — un arreglo todo-null equivale a no tener rúbrica evaluada (permite
// comparar contra submissions calificadas antes de agregar la rúbrica).
export function normRubricaEval(arr) {
  return Array.isArray(arr) && arr.some((v) => v != null) ? arr : null
}

// How late a submission was, relative to that student's effective deadline
// (their extension if any, otherwise the activity deadline).
export function formatLateness(sub, student, activity) {
  if (!sub?.tarde) return null
  const dl = activity?.extensiones?.[student?.id] || activity?.fechaLimite
  const submitMs = sub.fechaEntrega?.seconds ? sub.fechaEntrega.seconds * 1000 : null
  if (!dl || !submitMs) return 'Entrega tarde'
  const dlMs = parseFechaLimite(dl).getTime()
  const diff = submitMs - dlMs
  if (diff <= 60000) return 'Entrega tarde'
  const mins = Math.floor(diff / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rem = mins % 60
  const parts = []
  if (days) parts.push(`${days} día${days !== 1 ? 's' : ''}`)
  if (hours) parts.push(`${hours} h`)
  if (!days && rem) parts.push(`${rem} min`)
  return `Entrega tarde — ${parts.join(' ') || 'menos de 1 min'}`
}

// Short display names for the accepted file-type chips
export const FILE_TYPE_SHORT_LABELS = {
  imagenes: 'Imágenes (JPG, PNG) — hasta 5', pdf: 'PDF', word: 'Word',
  powerpoint: 'PowerPoint', excel: 'Excel', zip: 'ZIP/RAR',
  [ALL_FILES_KEY]: 'Cualquier tipo de archivo',
  [LINK_KEY]: 'Enlace',
}

export function isImageFile(name, url) {
  const s = `${name || ''} ${url || ''}`.toLowerCase()
  return /\.(jpg|jpeg|png|gif|webp)(\?|$|\s)/.test(s) || /\.(jpg|jpeg|png|gif|webp)$/.test((name || '').toLowerCase())
}

// Formatos que "Calificar con IA" (OP-11) puede analizar: la MISMA regla que
// usa el servidor (src/utils/tarifaCalificacionEvidencias.js — JPG/PNG
// imagen, PDF, DOCX; la extensión se lee del nombre y, si no hay, de la URL).
// Solo decide si el botón se MUESTRA y el conteo previo — el costo y la
// validación final los hace el servidor desde Firestore.
export function isEvidenciaSoportada(name, url) {
  return esEvidenciaSoportada(name, url)
}

// All files of a submission: `archivos[]` when present (multi-photo uploads),
// falling back to the legacy single archivoURL/nombreArchivo pair.
export function submissionFiles(sub) {
  if (!sub || sub.completadoSinArchivo) return []
  if (sub.archivos?.length) return sub.archivos.map((f) => ({ url: f.url, nombre: f.nombre }))
  return sub.archivoURL ? [{ url: sub.archivoURL, nombre: sub.nombreArchivo }] : []
}

export const STATUS_COLORS = {
  noentregado: 'bg-red-100 text-red-700',
  prorroga: 'bg-orange-100 text-orange-700',
  entregado: 'bg-blue-100 text-blue-700',
  calificado: 'bg-emerald-100 text-emerald-700',
}

export const STATUS_LABELS = {
  noentregado: 'No entregado',
  prorroga: 'En prórroga',
  entregado: 'Por calificar',
  calificado: 'Calificado',
}

// Filter-tab labels (plural, aligned with the badges). Los cuatro estados son
// excluyentes (utils/estadoEntrega.js), así que suman el total de "Todos".
export const FILTER_LABELS = {
  todos: 'Todos',
  noentregado: 'No entregados',
  prorroga: 'En prórroga',
  entregado: 'Por calificar',
  calificado: 'Calificados',
}
export const FILTROS_ENTREGAS = ['todos', 'noentregado', 'prorroga', 'entregado', 'calificado']

// Mientras el overlay de evaluar está abierto en nativo, el viewport background
// (el área fuera del layout viewport) coincide con el fondo del overlay (blanco),
// así la franja a la derecha en dispositivos Samsung queda invisible.
export function NativeEvalBgFix() {
  useEffect(() => {
    const prev = document.documentElement.style.backgroundColor
    document.documentElement.style.backgroundColor = 'white'
    document.body.style.backgroundColor = 'white'
    return () => {
      document.documentElement.style.backgroundColor = prev
      document.body.style.backgroundColor = ''
    }
  }, [])
  return null
}
