import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { SUBJECT_ICON_KEYS, getSubjectIcon } from '../utils/subjectIcons'
import { uploadToCloudinary } from '../utils/cloudinary'
import { useToast } from './Toast'

const MAX_ICON_BYTES = 1024 * 1024 // 1 MB

// Delivery-time resize: the stored URL already serves a small square, so the
// sidebar/cards never download the original at full size.
function iconDeliveryUrl(url) {
  return url.replace('/image/upload/', '/image/upload/w_128,h_128,c_fit,f_auto,q_auto/')
}

// Grid of subject icons. `value` is an icon key OR the https URL of an
// uploaded custom icon; `onChange(keyOrUrl)`. The last cell lets the teacher
// upload their own icon (stored in Cloudinary).
export default function IconSelect({ value = 'book', onChange }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const toast = useToast()
  const isCustom = /^https?:\/\//.test(value || '')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('El ícono debe ser una imagen (PNG, JPG, WebP o SVG)', 'error'); return }
    if (file.size > MAX_ICON_BYTES) { toast('La imagen del ícono debe pesar menos de 1 MB', 'error'); return }
    setUploading(true)
    try {
      const url = await uploadToCloudinary(file, 'evalua-facil/subject-icons')
      onChange(iconDeliveryUrl(url))
    } catch {
      toast('No se pudo subir el ícono. Intenta de nuevo.', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
      {SUBJECT_ICON_KEYS.map((key) => {
        const Icon = getSubjectIcon(key)
        const selected = !isCustom && (value || 'book') === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={key}
            className={`aspect-square rounded flex items-center justify-center transition-colors ${selected ? 'bg-accent text-white' : 'bg-surface-container text-muted hover:bg-[var(--accent-tint)]'}`}
          >
            <Icon size={19} />
          </button>
        )
      })}
      {/* Custom icon upload — always the last cell */}
      <button
        type="button"
        onClick={() => !uploading && fileRef.current?.click()}
        data-tooltip="Ícono propio · sube una imagen cuadrada de 64×64 px (PNG, JPG, WebP o SVG, máx. 1 MB)"
        aria-label="Subir ícono propio"
        className={`aspect-square rounded flex items-center justify-center transition-colors ${isCustom ? 'ring-2 ring-accent bg-[var(--accent-tint)]' : 'bg-surface-container text-muted hover:bg-[var(--accent-tint)]'}`}
      >
        {uploading
          ? <Loader2 size={19} className="animate-spin" />
          : isCustom
            ? <img src={value} alt="Ícono propio" className="w-[21px] h-[21px] object-contain" />
            : <ImagePlus size={19} />}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleFile}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
