import { auth } from '../firebase'
import { apiUrl } from './apiBase'

// Raw-delivered types. PDF is intentionally NOT here: we upload PDFs as the
// `image` resource type so Cloudinary can rasterize their pages to JPG. That
// lets us preview PDFs (page by page) even when the account has "PDF and ZIP
// delivery" disabled — delivering a JPG of a page is allowed, delivering the
// .pdf itself is not.
const NON_IMAGE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'txt', 'csv', 'apk']

function fileExt(file) {
  return file.name.split('.').pop().toLowerCase()
}

// True when a stored URL is a PDF delivered as an image resource (so its pages
// can be rendered as JPGs). Old PDFs uploaded as `raw` won't match.
export function isImageDeliveredPdf(url) {
  return !!url && url.includes('/image/upload/') && /\.pdf(\?|$)/i.test(url)
}

// Build a Cloudinary URL that renders a single PDF page as a JPG. Only valid
// for image-delivered PDFs (see isImageDeliveredPdf). Returns null otherwise.
export function pdfPageImageUrl(url, page = 1) {
  if (!isImageDeliveredPdf(url)) return null
  return url
    .replace('/image/upload/', `/image/upload/pg_${page},f_jpg,q_auto/`)
    .replace(/\.pdf(\?|$)/i, '.jpg$1')
}

// Shared Cloudinary upload helper — F-08 (2026-09-06): signed uploads.
//
// El cliente ya NO usa upload_preset ni cloudName embebidos en el bundle.
// En su lugar pide una firma al servidor (/api/subject/sign-upload), que usa
// CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET (server-side) para generarla.
// Cloudinary valida la firma en su extremo; sin ella rechaza la subida.
// La firma cubre { folder, timestamp } y Cloudinary la acepta hasta 1 hora
// después del timestamp (ventana fija de su API; no existe forma oficial de
// acortarla sin almacenar nonces).
export async function uploadToCloudinary(file, folder = 'evalua-facil/uploads') {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No autenticado')

  const sigRes = await fetch(apiUrl('/api/subject/sign-upload'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ folder }),
  })
  if (!sigRes.ok) {
    const motivo = await sigRes.json().then((j) => j?.error).catch(() => null)
    throw new Error(motivo || 'No se pudo iniciar la subida')
  }
  const { cloudName, apiKey, timestamp, signature } = await sigRes.json()

  const isRaw = NON_IMAGE_EXTS.includes(fileExt(file))
  const resourceType = isRaw ? 'raw' : 'auto'

  const formData = new FormData()
  formData.append('file', file)
  formData.append('api_key', String(apiKey))
  formData.append('timestamp', String(timestamp))
  formData.append('signature', signature)
  formData.append('folder', folder)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: 'POST', body: formData }
  )
  if (!res.ok) {
    const motivo = await res.json().then((j) => j?.error?.message).catch(() => null)
    throw new Error(motivo ? `Error al subir el archivo: ${motivo}` : 'Error al subir el archivo')
  }
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
