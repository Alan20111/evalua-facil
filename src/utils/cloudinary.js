const NON_IMAGE_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'txt', 'csv']

function fileExt(file) {
  return file.name.split('.').pop().toLowerCase()
}

// Shared Cloudinary upload helper. Centralizes the upload request so every
// feature that needs to store a user-provided file (rich-text editor images,
// submissions, avatars, etc.) hits the same endpoint/credentials handling.
export async function uploadToCloudinary(file, folder = 'evalua-facil/uploads') {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  const isRaw = NON_IMAGE_EXTS.includes(fileExt(file))
  const resourceType = isRaw ? 'raw' : 'auto'

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', uploadPreset)
  formData.append('folder', folder)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: 'POST', body: formData }
  )
  if (!res.ok) throw new Error('Error al subir el archivo')
  return (await res.json()).secure_url
}

// Turn a Cloudinary delivery URL into a forced-download URL by injecting the
// `fl_attachment` flag right after `/upload/`. This makes Cloudinary respond
// with `Content-Disposition: attachment`, so clicking the link saves the file
// directly instead of navigating the browser to the raw URL (which fails to
// render for xlsx/docx/zip and shows a broken page). Works on Mac and Windows,
// any file type. Non-Cloudinary URLs are returned unchanged.
export function downloadUrl(url, filename) {
  if (!url || !url.includes('/upload/')) return url
  let flag = 'fl_attachment'
  if (filename) {
    const base = filename
      .replace(/\.[^.]+$/, '')                       // drop extension (Cloudinary re-adds it)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      // Only letters/digits/underscore/hyphen: a DOT inside fl_attachment makes
      // Cloudinary return HTTP 400 (e.g. WhatsApp's "at 5.50.26 PM" filenames)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')                       // trim underscores
    if (base) flag = `fl_attachment:${base}`
  }
  return url.replace('/upload/', `/upload/${flag}/`)
}
