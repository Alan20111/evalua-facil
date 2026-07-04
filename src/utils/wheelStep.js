// Mouse-wheel stepping for numeric inputs marked with `data-wheel-step="0.5"`
// WITHOUT scrolling the page. One delegated non-passive listener (React's
// onWheel can't call preventDefault reliably), installed once from App.jsx.
// The new value is written through the native setter + an 'input' event so
// React's controlled onChange picks it up.
//
// Extras:
// - An empty input starts from its placeholder (the suggested remainder to
//   reach 10) instead of stepping blindly from 0.
// - A value bubble appears ABOVE the input while wheeling, so the mouse
//   pointer never covers the number being adjusted.
let installed = false

export function installWheelStep() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

  // Floating value readout — the pointer sits over the input, this doesn't
  const bubble = document.createElement('div')
  bubble.style.cssText = [
    'position:fixed', 'z-index:99999', 'pointer-events:none',
    'background:#1e293b', 'color:#fff', 'font-size:13px', 'font-weight:700',
    'padding:2px 10px', 'border-radius:8px', 'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    'transform:translate(-50%,-100%)', 'opacity:0', 'transition:opacity .1s',
  ].join(';')
  document.body.appendChild(bubble)
  let hideTimer = null

  const zoomFactor = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1

  document.addEventListener('wheel', (e) => {
    const input = e.target.closest?.('input[data-wheel-step]')
    if (!input) return
    e.preventDefault() // keep the page still — only the number moves

    const step = parseFloat(input.getAttribute('data-wheel-step')) || 1
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity
    const max = input.max !== '' ? parseFloat(input.max) : Infinity

    let next
    if (input.value === '') {
      // First wheel on an empty box lands on the suggested remainder
      const suggested = parseFloat(input.placeholder)
      next = isNaN(suggested) ? (e.deltaY < 0 ? step : 0) : suggested
    } else {
      next = (parseFloat(input.value) || 0) + (e.deltaY < 0 ? step : -step)
    }
    next = Math.min(max, Math.max(min, parseFloat(next.toFixed(2))))

    nativeSetter.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (document.activeElement !== input) input.focus({ preventScroll: true })

    // Show the value above the box while wheeling
    const r = input.getBoundingClientRect()
    const z = zoomFactor()
    bubble.textContent = String(next)
    bubble.style.left = `${(r.left + r.width / 2) / z}px`
    bubble.style.top = `${r.top / z - 8}px`
    bubble.style.opacity = '1'
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { bubble.style.opacity = '0' }, 900)
  }, { passive: false })
}
