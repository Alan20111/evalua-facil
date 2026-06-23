// Allowed file-type presets a teacher can pick per activity.
// Default is images only; the teacher can widen it from the activity form.
export const FILE_TYPE_OPTIONS = [
  {
    key: 'imagenes',
    label: 'Imágenes (JPG, PNG)',
    accept: '.jpg,.jpeg,.png',
    mimes: ['image/jpeg', 'image/jpg', 'image/png'],
    exts: ['jpg', 'jpeg', 'png'],
  },
  {
    key: 'pdf',
    label: 'PDF',
    accept: '.pdf',
    mimes: ['application/pdf'],
    exts: ['pdf'],
  },
  {
    key: 'imagenes_pdf',
    label: 'Imágenes y PDF',
    accept: '.jpg,.jpeg,.png,.pdf',
    mimes: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
    exts: ['jpg', 'jpeg', 'png', 'pdf'],
  },
  {
    key: 'documentos',
    label: 'Word y PDF',
    accept: '.doc,.docx,.pdf',
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    exts: ['doc', 'docx', 'pdf'],
  },
  {
    key: 'todos',
    label: 'Cualquier archivo',
    accept: '.doc,.docx,.pdf,.jpg,.jpeg,.png',
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/jpg',
      'image/png',
    ],
    exts: ['doc', 'docx', 'pdf', 'jpg', 'jpeg', 'png'],
  },
]

export const DEFAULT_FILE_TYPE = 'imagenes'
export const CUSTOM_FILE_TYPE = 'personalizado'

// Normalize a free-text list of extensions ("PSD, .ai zip") into a clean array
// ['psd', 'ai', 'zip'].
export function parseCustomExts(raw) {
  return (raw || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
}

// Resolve the active file-type definition. For the 'personalizado' key it is built
// on the fly from the teacher's custom extensions; otherwise it's a preset.
export function getFileType(key, customExts) {
  if (key === CUSTOM_FILE_TYPE) {
    const exts = parseCustomExts(customExts)
    return {
      key: CUSTOM_FILE_TYPE,
      label: exts.length ? exts.map((e) => e.toUpperCase()).join(', ') : 'Personalizado',
      accept: exts.map((e) => `.${e}`).join(','),
      mimes: [],
      exts,
    }
  }
  return (
    FILE_TYPE_OPTIONS.find((o) => o.key === key) ||
    FILE_TYPE_OPTIONS.find((o) => o.key === DEFAULT_FILE_TYPE)
  )
}

// Validate a File against a preset key (and optional custom extensions), by MIME
// first and extension as fallback.
export function isFileAllowed(file, key, customExts) {
  const ft = getFileType(key, customExts)
  if (ft.exts.length === 0) return true // custom with no exts set → allow anything
  if (file.type && ft.mimes.includes(file.type)) return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return ft.exts.includes(ext)
}
