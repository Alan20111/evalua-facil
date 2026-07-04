// Mouse-wheel stepping for numeric inputs marked with `data-wheel-step="0.5"`
// WITHOUT scrolling the page. One delegated non-passive listener (React's
// onWheel can't call preventDefault reliably), installed once from App.jsx.
// The new value is written through the native setter + an 'input' event so
// React's controlled onChange picks it up.
let installed = false

export function installWheelStep() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set

  document.addEventListener('wheel', (e) => {
    const input = e.target.closest?.('input[data-wheel-step]')
    if (!input) return
    e.preventDefault() // keep the page still — only the number moves

    const step = parseFloat(input.getAttribute('data-wheel-step')) || 1
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity
    const max = input.max !== '' ? parseFloat(input.max) : Infinity
    const cur = parseFloat(input.value)
    const base = isNaN(cur) ? 0 : cur
    let next = base + (e.deltaY < 0 ? step : -step)
    next = Math.min(max, Math.max(min, parseFloat(next.toFixed(2))))

    nativeSetter.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (document.activeElement !== input) input.focus({ preventScroll: true })
  }, { passive: false })
}
