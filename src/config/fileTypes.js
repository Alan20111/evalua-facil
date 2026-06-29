// Allowed file-type categories a teacher can pick per activity (multi-select —
// the teacher can check several at once, at least one must stay checked).
export const FILE_TYPE_BASE_OPTIONS = [
  {
    key: 'imagenes',
    label: 'Imágenes (JPG, PNG)',
    mimes: ['image/jpeg', 'image/jpg', 'image/png'],
    exts: ['jpg', 'jpeg', 'png'],
  },
  {
    key: 'pdf',
    label: 'PDF',
    mimes: ['application/pdf'],
    exts: ['pdf'],
  },
  {
    key: 'word',
    label: 'Word',
    mimes: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    exts: ['doc', 'docx'],
  },
]

export const ALL_FILES_KEY = 'todos'
export const CUSTOM_FILE_TYPE = 'personalizado'
export const DEFAULT_FILE_TYPE = 'imagenes'

// `tiposArchivo` used to be a single preset key before multi-select existed.
// Map each legacy value to its equivalent array of base keys.
const LEGACY_KEY_MAP = {
  imagenes: ['imagenes'],
  pdf: ['pdf'],
  imagenes_pdf: ['imagenes', 'pdf'],
  documentos: ['word', 'pdf'],
  todos: [ALL_FILES_KEY],
  personalizado: [CUSTOM_FILE_TYPE],
}

// Normalize either shape (legacy single string or current array) into a clean,
// non-empty array of keys.
export function normalizeFileTypeKeys(value) {
  if (Array.isArray(value)) return value.length ? value : [DEFAULT_FILE_TYPE]
  if (typeof value === 'string' && value) return LEGACY_KEY_MAP[value] || [DEFAULT_FILE_TYPE]
  return [DEFAULT_FILE_TYPE]
}

// Normalize a free-text list of extensions ("PSD, .ai zip") into a clean array
// ['psd', 'ai', 'zip'].
export function parseCustomExts(raw) {
  return (raw || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
}

// Human label for the current selection, e.g. "Imágenes (JPG, PNG), PDF" or
// "Cualquier archivo".
export function fileTypesLabel(value, customExts) {
  const keys = normalizeFileTypeKeys(value)
  if (keys.includes(ALL_FILES_KEY)) return 'Cualquier archivo'
  const parts = keys
    .filter((k) => k !== CUSTOM_FILE_TYPE)
    .map((k) => FILE_TYPE_BASE_OPTIONS.find((o) => o.key === k)?.label)
    .filter(Boolean)
  if (keys.includes(CUSTOM_FILE_TYPE)) {
    const exts = parseCustomExts(customExts)
    parts.push(exts.length ? exts.map((e) => e.toUpperCase()).join(', ') : 'Personalizado')
  }
  return parts.length ? parts.join(', ') : FILE_TYPE_BASE_OPTIONS[0].label
}

// Combined accept/mime/ext set for the current selection — used for the upload
// <input accept> attribute and to validate an uploaded file.
export function resolveFileTypes(value, customExts) {
  const keys = normalizeFileTypeKeys(value)
  if (keys.includes(ALL_FILES_KEY)) {
    const mimes = FILE_TYPE_BASE_OPTIONS.flatMap((o) => o.mimes)
    const exts = FILE_TYPE_BASE_OPTIONS.flatMap((o) => o.exts)
    return { mimes, exts, accept: exts.map((e) => `.${e}`).join(',') }
  }
  const mimes = []
  const exts = []
  keys.forEach((k) => {
    if (k === CUSTOM_FILE_TYPE) {
      exts.push(...parseCustomExts(customExts))
      return
    }
    const base = FILE_TYPE_BASE_OPTIONS.find((o) => o.key === k)
    if (base) { mimes.push(...base.mimes); exts.push(...base.exts) }
  })
  return {
    mimes: [...new Set(mimes)],
    exts: [...new Set(exts)],
    accept: [...new Set(exts)].map((e) => `.${e}`).join(','),
  }
}

// Validate a File against the current selection, by MIME first and extension
// as fallback.
export function isFileAllowed(file, value, customExts) {
  const { mimes, exts } = resolveFileTypes(value, customExts)
  if (exts.length === 0) return true // only "personalizado" selected with no extensions typed → allow anything
  if (file.type && mimes.includes(file.type)) return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return exts.includes(ext)
}
