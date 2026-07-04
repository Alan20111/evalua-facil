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

  const showBubble = (input, text) => {
    const r = input.getBoundingClientRect()
    const z = zoomFactor()
    bubble.textContent = text
    bubble.style.left = `${(r.left + r.width / 2) / z}px`
    bubble.style.top = `${r.top / z - 8}px`
    bubble.style.opacity = '1'
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { bubble.style.opacity = '0' }, 1100)
  }

  document.addEventListener('wheel', (e) => {
    const input = e.target.closest?.('input[data-wheel-step]')
    if (!input) return
    e.preventDefault() // keep the page still — only the number moves
    e.stopPropagation() // and nobody else gets to interpret this wheel

    const step = parseFloat(input.getAttribute('data-wheel-step')) || 1
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity
    // Effective ceiling (e.g. the points still available in the parcial);
    // falls back to the static max attribute
    const dynMax = parseFloat(input.getAttribute('data-wheel-max'))
    const max = !isNaN(dynMax) ? dynMax : (input.max !== '' ? parseFloat(input.max) : Infinity)

    // Normalized direction — trackpads emit tiny/jittery deltas whose sign
    // can flip; ignore anything without a clear direction
    const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0
    if (dir === 0) return

    let next
    if (input.value === '') {
      // First wheel on an empty box lands on the suggested remainder
      const suggested = parseFloat(input.placeholder)
      next = isNaN(suggested) ? (dir > 0 ? step : 0) : suggested
    } else {
      // Wheel DOWN increases, wheel UP decreases
      next = (parseFloat(input.value) || 0) + dir * step
    }
    next = parseFloat(next.toFixed(2))
    // Wrap around: past the max jumps to the min and vice versa (10 → 0, 0 → 10)
    if (next > max) next = isFinite(min) ? min : max
    else if (next < min) next = isFinite(max) ? max : min

    nativeSetter.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // Show the value above the box while wheeling
    showBubble(input, String(next))
  }, { passive: false, capture: true })
}
