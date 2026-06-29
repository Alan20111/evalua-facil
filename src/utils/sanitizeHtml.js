import DOMPurify from 'dompurify'

// Used wherever rich-text content (RichTextEditor output) is rendered with
// dangerouslySetInnerHTML — defends against a teacher's stored `instrucciones`
// being tampered with outside the editor's own constrained schema (e.g. a
// direct Firestore write) and then executing in a student's browser.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'span', 'ul', 'ol', 'li', 'a', 'img']
const ALLOWED_ATTR = ['style', 'href', 'target', 'rel', 'src', 'alt']

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', { ALLOWED_TAGS, ALLOWED_ATTR })
}

// Activities created before the rich-text editor stored `instrucciones` as
// plain text (line breaks via `\n`, rendered with `whitespace-pre-wrap`).
// Detect that case and convert it to the equivalent HTML so old activities
// still display (and remain editable) correctly under the new HTML renderer.
export function toRichHtml(raw) {
  if (!raw) return ''
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`
}

// Plain-text rendering of rich-text HTML — used for validation (is the
// editor actually empty?) and for compact single-line previews (activity
// list row) where markup doesn't apply.
export function htmlToPlainText(html) {
  const div = document.createElement('div')
  div.innerHTML = sanitizeHtml(html)
  return (div.textContent || '').replace(/\s+/g, ' ').trim()
}

// Shared styling for wherever sanitized rich-text HTML is rendered (no
// @tailwindcss/typography plugin installed, so this is hand-rolled instead
// of `prose`) — keeps RichTextEditor's own content/preview panes visually
// identical to the read-only views (ActivityPage, future modules).
export const richTextContentClass =
  '[&_img]:max-w-full [&_img]:rounded [&_a]:text-accent [&_a]:underline ' +
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0'
