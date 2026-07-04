// Cursor-following tooltip for WIDE triggers (e.g. a full activity row) where
// the CSS [data-tooltip] variant — centered over the whole element — would
// appear far from the pointer. Mark elements with `data-tooltip-follow="text"`.
// One delegated listener set, installed once from App.jsx.
let installed = false

export function installFollowTooltips() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const tip = document.createElement('div')
  tip.style.cssText = [
    'position:fixed', 'z-index:99999', 'pointer-events:none',
    'background:#f5f5f5', 'color:#111111', 'border:1px solid #c0c0c0',
    'box-shadow:0 1px 3px rgba(0,0,0,.12)', 'font-size:11px', 'line-height:1.3',
    'padding:3px 8px', 'border-radius:2px', 'width:max-content', 'max-width:340px',
    'opacity:0', 'transition:opacity .12s ease .25s',
  ].join(';')
  document.body.appendChild(tip)

  // The app scales everything with `zoom` on <html>; fixed-position
  // coordinates live in the zoomed space, so divide the client coords back
  const zoomFactor = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1

  let target = null
  const move = (e) => {
    const z = zoomFactor()
    tip.style.left = `${e.clientX / z + 14}px`
    tip.style.top = `${e.clientY / z + 18}px`
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-tooltip-follow]') || null
    if (el === target) return
    target = el
    if (el) {
      tip.textContent = el.getAttribute('data-tooltip-follow')
      move(e)
      tip.style.opacity = '1'
    } else {
      tip.style.opacity = '0'
    }
  })
  document.addEventListener('mousemove', (e) => { if (target) move(e) })
  document.addEventListener('mousedown', () => { tip.style.opacity = '0'; target = null })
}
