import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Underline as UnderlineIcon, Baseline, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Link2, Image as ImageIcon,
  RemoveFormatting, Paperclip,
} from 'lucide-react'
import { uploadToCloudinary } from '../utils/cloudinary'
import { richTextContentClass } from '../utils/sanitizeHtml'
import AttachmentList from './AttachmentList'

// Reusable rich-text editor: a deliberately small toolbar (bold, italic,
// underline, text color, bullet/numbered lists, alignment, link, image, clear
// formatting, preview) — no headings, tables, fonts or source-code editing.
// Built once here so any future module that needs formatted text (anuncios,
// retroalimentación, comentarios…) can reuse it via `value`/`onChange` (HTML
// string in, HTML string out) without depending on this modal or feature.

// hover lives in each button's "not active" branch below, never in this base
// constant — TOOLBAR_BTN_ACTIVE already supplies its own background, and a
// shared hover here would visibly tint an already-active button on rollover.
const TOOLBAR_BTN = 'p-1.5 rounded transition-colors disabled:opacity-40'
const TOOLBAR_BTN_HOVER = 'hover:bg-[var(--accent-tint)]'
const TOOLBAR_BTN_ACTIVE = 'bg-accent-light text-accent'

async function insertImageFile(editor, file) {
  if (!file || !file.type?.startsWith('image/')) return
  try {
    const url = await uploadToCloudinary(file, 'evalua-facil/instrucciones')
    editor.chain().focus().setImage({ src: url }).run()
  } catch {
    // Best-effort — the editor stays usable even if an upload fails.
  }
}

// `attachments`/`onAttachFiles`/`onRemoveAttachment` are all optional — when
// omitted (e.g. the "Material de apoyo" description, which has its own
// dedicated file dropzone) the attach button and the "Archivos adjuntos"
// block simply don't render, so this stays a no-op for every other caller.
export default function RichTextEditor({ value, onChange, placeholder, attachments, onAttachFiles, onRemoveAttachment }) {

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        strike: false,
        blockquote: false,
        horizontalRule: false,
        // Provided separately below with our own config (autolink off, etc).
        link: false,
        underline: false,
      }),
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['paragraph'] }),
      Link.configure({ openOnClick: false, autolink: false }),
      Image.configure({ HTMLAttributes: { class: 'max-w-full rounded' } }),
      Placeholder.configure({ placeholder: placeholder || 'Escribe aquí…' }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: `focus:outline-none min-h-[160px] ${richTextContentClass}` },
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files?.[0]
        if (file && file.type.startsWith('image/')) {
          event.preventDefault()
          insertImageFile(editor, file)
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.items || [])
          .find((it) => it.type.startsWith('image/'))?.getAsFile()
        if (file) {
          event.preventDefault()
          insertImageFile(editor, file)
          return true
        }
        return false
      },
    },
  })

  // Keep the editor in sync if `value` is reset from outside (e.g. opening
  // the modal in "create" mode after it was used for "edit").
  useEffect(() => {
    if (editor && value !== editor.getHTML() && (value || !editor.getText())) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) return null

  function setLink() {
    const url = window.prompt('Pega la URL del enlace:', editor.getAttributes('link').href || '')
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function pickImageFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => insertImageFile(editor, input.files?.[0])
    input.click()
  }

  // Attached files are NOT inserted into the document (unlike images) — they
  // stay out of `editor`/`value` entirely and are rendered as a separate
  // block below, per the "no incrustar en el texto" requirement.
  function pickAttachFiles() {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => { if (input.files?.length) onAttachFiles(Array.from(input.files)) }
    input.click()
  }

  return (
    <div className="border border-outline-variant rounded bg-surface-card overflow-hidden">
      <div className="flex items-center gap-0.5 flex-wrap p-1.5 border-b border-outline-variant bg-surface">
        <button type="button" data-tooltip="Negrita"
          className={`${TOOLBAR_BTN} ${editor.isActive('bold') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </button>
        <button type="button" data-tooltip="Cursiva"
          className={`${TOOLBAR_BTN} ${editor.isActive('italic') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </button>
        <button type="button" data-tooltip="Subrayado"
          className={`${TOOLBAR_BTN} ${editor.isActive('underline') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={16} />
        </button>
        <label data-tooltip="Color de texto" className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_HOVER} text-muted cursor-pointer relative`}>
          <Baseline size={16} />
          <input
            type="color"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>

        <span className="w-px h-5 bg-outline-variant mx-1" />

        <button type="button" data-tooltip="Lista con viñetas"
          className={`${TOOLBAR_BTN} ${editor.isActive('bulletList') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </button>
        <button type="button" data-tooltip="Lista numerada"
          className={`${TOOLBAR_BTN} ${editor.isActive('orderedList') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </button>

        <span className="w-px h-5 bg-outline-variant mx-1" />

        <button type="button" data-tooltip="Alinear a la izquierda"
          className={`${TOOLBAR_BTN} ${editor.isActive({ textAlign: 'left' }) ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <AlignLeft size={16} />
        </button>
        <button type="button" data-tooltip="Centrar"
          className={`${TOOLBAR_BTN} ${editor.isActive({ textAlign: 'center' }) ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <AlignCenter size={16} />
        </button>
        <button type="button" data-tooltip="Alinear a la derecha"
          className={`${TOOLBAR_BTN} ${editor.isActive({ textAlign: 'right' }) ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <AlignRight size={16} />
        </button>

        <span className="w-px h-5 bg-outline-variant mx-1" />

        <button type="button" data-tooltip="Insertar enlace"
          className={`${TOOLBAR_BTN} ${editor.isActive('link') ? TOOLBAR_BTN_ACTIVE : `text-muted ${TOOLBAR_BTN_HOVER}`}`}
          onClick={setLink}>
          <Link2 size={16} />
        </button>
        <button type="button" data-tooltip="Insertar imagen" className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_HOVER} text-muted`} onClick={pickImageFile}>
          <ImageIcon size={16} />
        </button>
        <button type="button" data-tooltip="Eliminar formato" className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_HOVER} text-muted`}
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
          <RemoveFormatting size={16} />
        </button>

        {onAttachFiles && (
          <>
            <span className="w-px h-5 bg-outline-variant mx-1" />
            <button type="button" data-tooltip="Adjuntar archivo" className={`${TOOLBAR_BTN} ${TOOLBAR_BTN_HOVER} text-muted`} onClick={pickAttachFiles}>
              <Paperclip size={16} />
            </button>
          </>
        )}

      </div>

      <EditorContent editor={editor} className="p-3 max-h-[40vh] overflow-y-auto" />

      {onAttachFiles && (
        <div className="px-3 pb-3">
          <AttachmentList files={attachments} onRemove={onRemoveAttachment} />
        </div>
      )}
    </div>
  )
}
