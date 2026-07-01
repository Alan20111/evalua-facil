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
