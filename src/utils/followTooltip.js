// Cursor-following tooltip for WIDE triggers (e.g. a full activity row) where
// the CSS [data-tooltip] variant — centered over the whole element — would
// appear far from the pointer. Mark elements with `data-tooltip-follow="text"`.
// One delegated listener set, installed once from App.jsx.
let installed = false

export function installFollowTooltips() {
  if (installed || typeof document === 'undefined') return
  // Touch devices (mobile web + Capacitor Android) have no real hover — a
  // synthetic mouseover after a tap can leave this stuck on-screen with no
  // clean way to dismiss it, so it only installs on true mouse/trackpad pointers.
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
  installed = true

  const tip = document.createElement('div')
  tip.style.cssText = [
    'position:fixed', 'z-index:99999', 'pointer-events:none',
    'background:#f5f5f5', 'color:#111111', 'border:1px solid #c0c0c0',
    'box-shadow:0 1px 3px rgba(0,0,0,.12)', 'font-size:11px', 'line-height:1.3',
    'padding:3px 8px', 'border-radius:2px', 'width:max-content', 'max-width:340px',
    'opacity:0',
    // Centered above the cursor with a comfortable gap, like the others
    'transform:translate(-50%, -100%)',
  ].join(';')
  document.body.appendChild(tip)

  // The app scales everything with `zoom` on <html>; fixed-position
  // coordinates live in the zoomed space, so divide the client coords back
  const zoomFactor = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1

  let target = null
  const move = (e) => {
    const z = zoomFactor()
    tip.style.left = `${e.clientX / z}px`
    tip.style.top = `${e.clientY / z - 14}px`
  }

  const resolveTarget = (e) => {
    const el = e.target.closest?.('[data-tooltip-follow]') || null
    if (!el) return null
    // Elements with their own CSS tooltip (badges, dates) win over this one
    const content = e.target.closest?.('[data-tooltip]')
    if (content && el.contains(content)) return null
    return el
  }

  const apply = (el, e) => {
    if (el === target) return
    target = el
    if (el) {
      tip.textContent = el.getAttribute('data-tooltip-follow')
      move(e)
      // Slightly slower to appear than the CSS tooltips (.25s), instant to hide
      tip.style.transition = 'opacity .12s ease .35s'
      tip.style.opacity = '1'
    } else {
      tip.style.transition = 'opacity .06s ease 0s'
      tip.style.opacity = '0'
    }
  }

  document.addEventListener('mouseover', (e) => apply(resolveTarget(e), e))
  document.addEventListener('mousemove', (e) => {
    const el = resolveTarget(e)
    if (el !== target) apply(el, e)
    else if (target) move(e)
  })
  document.addEventListener('mousedown', () => { tip.style.opacity = '0'; target = null })
}
