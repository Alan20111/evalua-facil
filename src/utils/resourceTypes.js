import { FileText, FileSpreadsheet, Presentation, Image as ImageIcon, File as FileIcon, Music, Video, FileArchive, Link2 } from 'lucide-react'

// One entry per supported resource format — adding a new format later (e.g.
// .zip, .mp4) is a single new entry here, used by both the upload <input
// accept> attribute and the list's per-resource icon/color. Any extension
// NOT listed here still works (getResourceIcon falls back to a generic file
// icon) — this map only improves the icon/color, it never blocks an upload.
export const RESOURCE_FILE_TYPES = {
  pdf: { mime: 'application/pdf', icon: FileText, color: 'text-red-500' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', icon: FileText, color: 'text-blue-500' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', icon: FileSpreadsheet, color: 'text-emerald-600' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', icon: Presentation, color: 'text-orange-500' },
  jpg: { mime: 'image/jpeg', icon: ImageIcon, color: 'text-purple-500' },
  jpeg: { mime: 'image/jpeg', icon: ImageIcon, color: 'text-purple-500' },
  png: { mime: 'image/png', icon: ImageIcon, color: 'text-purple-500' },
  mp3: { mime: 'audio/mpeg', icon: Music, color: 'text-pink-500' },
  wav: { mime: 'audio/wav', icon: Music, color: 'text-pink-500' },
  mp4: { mime: 'video/mp4', icon: Video, color: 'text-indigo-500' },
  mov: { mime: 'video/quicktime', icon: Video, color: 'text-indigo-500' },
  zip: { mime: 'application/zip', icon: FileArchive, color: 'text-amber-600' },
  rar: { mime: 'application/x-rar-compressed', icon: FileArchive, color: 'text-amber-600' },
}

// The "Recursos" tab (course-wide, single attachment) only accepts this
// original subset — kept separate from RESOURCE_FILE_TYPES above so adding
// audio/video/zip icons for "Material de apoyo" (which allows ANY file type)
// doesn't silently loosen what Recursos accepts.
const RECURSOS_TAB_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png']
export const RESOURCE_ACCEPT = RECURSOS_TAB_EXTS.map((ext) => `.${ext}`).join(',')

export function resourceExtension(filename) {
  return (filename || '').split('.').pop()?.toLowerCase() || ''
}

// Icon + color for a resource's file extension, falling back to a generic
// file icon for any format not in the map above (keeps the list resilient
// to legacy/unexpected extensions instead of crashing).
export function getResourceIcon(filename) {
  const ext = resourceExtension(filename)
  return RESOURCE_FILE_TYPES[ext] || { icon: FileIcon, color: 'text-slate-400' }
}

export function isResourceFileAllowed(file) {
  const ext = resourceExtension(file.name)
  if (RECURSOS_TAB_EXTS.includes(ext)) return true
  return RECURSOS_TAB_EXTS.some((e) => RESOURCE_FILE_TYPES[e].mime === file.type)
}

const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com']

// "Recursos" can also be a plain link instead of an uploaded file (a video,
// an external site, a Drive folder…). Video hosts get the Video icon so they
// stand out from a generic link; everything else falls back to Link2.
export function getLinkResourceIcon(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { icon: Video, color: 'text-indigo-500' }
    }
  } catch {
    // not a valid absolute URL — fall through to the generic link icon
  }
  return { icon: Link2, color: 'text-cyan-600' }
}
