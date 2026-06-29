import { FileText, FileSpreadsheet, Presentation, Image as ImageIcon, File as FileIcon } from 'lucide-react'

// One entry per supported resource format — adding a new format later (e.g.
// .zip, .mp4) is a single new entry here, used by both the upload <input
// accept> attribute and the list's per-resource icon/color.
export const RESOURCE_FILE_TYPES = {
  pdf: { mime: 'application/pdf', icon: FileText, color: 'text-red-500' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', icon: FileText, color: 'text-blue-500' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', icon: FileSpreadsheet, color: 'text-emerald-600' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', icon: Presentation, color: 'text-orange-500' },
  jpg: { mime: 'image/jpeg', icon: ImageIcon, color: 'text-purple-500' },
  jpeg: { mime: 'image/jpeg', icon: ImageIcon, color: 'text-purple-500' },
  png: { mime: 'image/png', icon: ImageIcon, color: 'text-purple-500' },
}

export const RESOURCE_ACCEPT = Object.keys(RESOURCE_FILE_TYPES).map((ext) => `.${ext}`).join(',')

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
  if (ext in RESOURCE_FILE_TYPES) return true
  return Object.values(RESOURCE_FILE_TYPES).some((t) => t.mime === file.type)
}
