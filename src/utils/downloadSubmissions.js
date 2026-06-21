// Lazy-loads JSZip only when the teacher actually exports,
// keeping it out of the main bundle.
import { subjectDisplayName } from './subjectName'

function fullName(s) {
  return [s.apellidoPaterno, s.apellidoMaterno, s.nombre].filter(Boolean).join(' ').trim()
}

function sanitize(name) {
  return (name || '').replace(/[/\\?%*:|"<>]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Job builders (pure functions, no Firestore) ──────────────────────────

// Per-activity ZIP: one folder per student (named with their full name), and
// inside it the student's submitted file(s) keeping the ORIGINAL filename.
// submissions: flat array of submission objects { alumnoId, archivoURL, nombreArchivo, completadoSinArchivo }
export function buildJobsForActivity({ students, submissions }) {
  const studentMap = Object.fromEntries(students.map((s) => [s.id, s]))
  const jobs = []

  for (const sub of submissions) {
    if (!sub.archivoURL || sub.completadoSinArchivo) continue
    const student = studentMap[sub.alumnoId]
    if (!student) continue
    const folder = sanitize(fullName(student)) || (student.username || student.id)
    // Keep the original filename the student gave (resolvePath re-adds the extension).
    const original = sub.nombreArchivo || 'entrega'
    const dot = original.lastIndexOf('.')
    const base = dot > 0 ? original.slice(0, dot) : original
    jobs.push({ path: [folder], fileBaseName: sanitize(base) || 'entrega', url: sub.archivoURL, nombreArchivo: sub.nombreArchivo })
  }
  return jobs
}

// submissions: flat array of ALL submissions for all activities in the subject
export function buildJobsForSubject({ subject, activities, submissions, students }) {
  const folderBase = sanitize(subjectDisplayName(subject))
  const studentMap = Object.fromEntries(students.map((s) => [s.id, s]))
  const byAct = {}
  submissions.forEach((sub) => {
    if (!byAct[sub.actividadId]) byAct[sub.actividadId] = []
    byAct[sub.actividadId].push(sub)
  })

  // group activities by parcial for folder structure
  const byParcial = {}
  activities.forEach((a) => {
    if (!byParcial[a.parcial]) byParcial[a.parcial] = []
    byParcial[a.parcial].push(a)
  })

  const jobs = []
  for (const [parcialNum, acts] of Object.entries(byParcial).sort(([a], [b]) => a - b)) {
    const folderParcial = `Parcial ${parcialNum}`
    for (const act of acts) {
      const subs = byAct[act.id] || []
      const folderAct = sanitize(act.nombre)
      const usedNames = new Set()
      for (const sub of subs) {
        if (!sub.archivoURL || sub.completadoSinArchivo) continue
        const student = studentMap[sub.alumnoId]
        if (!student) continue
        let baseName = sanitize(fullName(student))
        if (usedNames.has(baseName)) baseName = `${baseName} (${student.username || student.id})`
        usedNames.add(baseName)
        jobs.push({ path: [folderBase, folderParcial, folderAct], fileBaseName: baseName, url: sub.archivoURL, nombreArchivo: sub.nombreArchivo })
      }
    }
  }
  return jobs
}

// ── Core ZIP download ────────────────────────────────────────────────────

export async function downloadSubmissionsZip({ zipName, jobs, onProgress }) {
  if (jobs.length === 0) return { total: 0, escritos: 0, errores: 0 }

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  let escritos = 0
  let errores = 0
  const total = jobs.length
  const usedPaths = new Set()

  // Build unique file path for a job
  function resolvePath(job) {
    const ext = (job.nombreArchivo || job.url || '').split('.').pop()?.split('?')[0]?.toLowerCase() || ''
    const base = `${job.path.join('/')}/${job.fileBaseName}`
    let candidate = ext ? `${base}.${ext}` : base
    if (!usedPaths.has(candidate)) { usedPaths.add(candidate); return candidate }
    let i = 2
    do { candidate = ext ? `${base}_${i}.${ext}` : `${base}_${i}`; i++ } while (usedPaths.has(candidate))
    usedPaths.add(candidate)
    return candidate
  }

  // Process in batches of 6 to avoid saturating the network
  const BATCH = 6
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(
      jobs.slice(i, i + BATCH).map(async (job) => {
        const filePath = resolvePath(job)
        try {
          const res = await fetch(job.url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          zip.file(filePath, await res.blob())
          escritos++
        } catch {
          errores++
        }
        onProgress?.(escritos + errores, total)
      })
    )
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitize(zipName)}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)

  return { total, escritos, errores }
}
