// Contextual alerts: a colored notice anchored NEXT TO the element where the
// problem happened (instead of the far top-right toast), plus a short alert
// sound. Use for validation/adjustment messages tied to a specific control:
//
//   import { showNear, playAlertSound } from '../utils/notify'
//   showNear(inputEl, 'El peso se ajustó a 2.5 — la suma no puede pasar de 10')
//
// kind: 'warning' (amber, default) | 'error' (red)

let el = null
let hideTimer = null

const zoomFactor = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1

export function playAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = playAlertSound._ctx || (playAlertSound._ctx = new Ctx())
    const beep = (freq, at, dur = 0.09) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.12, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + dur)
    }
    beep(740, 0)
    beep(554, 0.11)
  } catch { /* audio unavailable — the visual notice still shows */ }
}

export function showNear(target, text, kind = 'warning') {
  if (typeof document === 'undefined' || !target?.getBoundingClientRect) return
  if (!el) {
    el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'z-index:99999', 'pointer-events:none',
      'font-size:12px', 'font-weight:600', 'line-height:1.35',
      'padding:6px 12px', 'border-radius:8px', 'max-width:300px', 'width:max-content',
      'box-shadow:0 4px 14px rgba(0,0,0,.18)', 'transform:translate(-50%,-100%)',
      'opacity:0', 'transition:opacity .15s',
    ].join(';')
    document.body.appendChild(el)
  }
  const colors = kind === 'error'
    ? { bg: '#fef2f2', fg: '#b91c1c', bd: '#fca5a5' }
    : { bg: '#fffbeb', fg: '#b45309', bd: '#fcd34d' }
  el.style.background = colors.bg
  el.style.color = colors.fg
  el.style.border = `1px solid ${colors.bd}`
  el.textContent = text

  const r = target.getBoundingClientRect()
  const z = zoomFactor()
  el.style.left = `${(r.left + r.width / 2) / z}px`
  el.style.top = `${r.top / z - 10}px`
  el.style.opacity = '1'

  playAlertSound()
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { el.style.opacity = '0' }, 2600)
}
