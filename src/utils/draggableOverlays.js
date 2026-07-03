// Global drag support for every popup in the app — modals (marked by the
// shared `shadow-2xl` card class) and the EFDateTimePicker popover
// (`ef-pop-in` / `ef-pop-in-up`). One delegated listener set, installed once
// from App.jsx: press on any non-interactive area of a popup and drag to
// reposition it. Mouse only — on touch, dragging must keep scrolling content.
let installed = false

const CARD_SELECTOR = '.shadow-2xl, .ef-pop-in, .ef-pop-in-up'
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, label, [contenteditable="true"], [role="listbox"], .ef-nodrag'

export function installDraggableOverlays() {
  if (installed || typeof document === 'undefined') return
  installed = true

  let drag = null

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return
    if (e.target.closest(INTERACTIVE_SELECTOR)) return
    const card = e.target.closest(CARD_SELECTOR)
    if (!card) return
    drag = {
      card,
      startX: e.clientX,
      startY: e.clientY,
      dx0: parseFloat(card.dataset.dragX || '0'),
      dy0: parseFloat(card.dataset.dragY || '0'),
      moved: false,
    }
  }, true)

  document.addEventListener('pointermove', (e) => {
    if (!drag) return
    const mx = e.clientX - drag.startX
    const my = e.clientY - drag.startY
    // Small threshold so plain clicks (and double-click text selection) survive
    if (!drag.moved && Math.abs(mx) + Math.abs(my) < 4) return
    if (!drag.moved) {
      drag.moved = true
      // pop-in keyframes animate transform with fill 'both' — must be
      // disabled or the translate below is overridden
      drag.card.style.animation = 'none'
      document.body.style.userSelect = 'none'
    }
    const dx = drag.dx0 + mx
    const dy = drag.dy0 + my
    drag.card.dataset.dragX = String(dx)
    drag.card.dataset.dragY = String(dy)
    drag.card.style.transform = `translate(${dx}px, ${dy}px)`
    e.preventDefault()
  }, true)

  const end = () => {
    if (!drag) return
    document.body.style.userSelect = ''
    drag = null
  }
  document.addEventListener('pointerup', end, true)
  document.addEventListener('pointercancel', end, true)
}
