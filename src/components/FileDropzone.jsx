import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

// Generic drag-and-drop + click-to-browse multi-file picker. Purely
// presentational: it just hands the picked/dropped files to `onFilesSelected`
// and lets the caller decide how to store/preview/upload them — keeps it
// reusable for any future feature that needs file intake, not just materials.
export default function FileDropzone({ onFilesSelected, multiple = true, accept, hint }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (files.length) onFilesSelected(files)
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={`w-full border-2 border-dashed rounded p-4 text-center cursor-pointer transition-colors block ${
        dragOver ? 'border-accent bg-[var(--accent-tint)]' : 'border-outline-variant hover:bg-[var(--accent-tint)]'
      }`}
    >
      <Upload size={22} className="mx-auto text-accent mb-1" />
      <p className="text-sm font-medium text-on-surface">Arrastra tus archivos aquí o haz clic para seleccionarlos</p>
      <p className="text-xs text-slate-400 mt-0.5">{hint || 'Puedes agregar uno o varios archivos'}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        className="hidden"
      />
    </label>
  )
}
