import { useEffect, useRef } from 'react'

// Celebración de "ya entregaste" — una tanda de fuegos artificiales que se
// dibuja sobre toda la pantalla. No usa ninguna librería (canvas 2D simple)
// para no agregar dependencias nuevas al bundle.
//
// Uso: <Fireworks active={showFireworks} onDone={() => setShowFireworks(false)} />
// `active` dispara la animación; al terminar sola, o si el usuario mueve el
// mouse (web) o toca la pantalla (móvil) — con una breve gracia inicial para
// no confundir el propio toque que originó la entrega — se apaga con un
// desvanecido corto y se llama a `onDone` para que el padre la desmonte.
// También respeta prefers-reduced-motion.

const COLORS = ['#ff5e5e', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f72585', '#ffffff', '#7bf1a8']

// Aclara/oscurece un color hex un poco, para variar el tono dentro de una
// misma ráfaga (chispas más ricas, no todas del mismo tono plano).
function jitterColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp(((n >> 16) & 255) + amt)
  const g = clamp(((n >> 8) & 255) + amt)
  const b = clamp((n & 255) + amt)
  return `rgb(${r},${g},${b})`
}

export default function Fireworks({ active, onDone, duration = 7800 }) {
  const canvasRef = useRef(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    function resize() {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // ── Cierre por interacción: mueve el mouse (web) o toca la pantalla
    // (móvil) y se apaga. Gracia inicial para que el propio tap/click que
    // originó la entrega no la cierre de inmediato.
    const GRACE_MS = 400
    const FADE_MS = 250
    let dismissing = false
    let dismissStart = 0
    let listenersOn = false
    function onInteract() {
      if (dismissing) return
      dismissing = true
      dismissStart = performance.now()
      removeListeners()
    }
    function addListeners() {
      window.addEventListener('mousemove', onInteract, { passive: true })
      window.addEventListener('touchstart', onInteract, { passive: true })
      listenersOn = true
    }
    function removeListeners() {
      if (!listenersOn) return
      window.removeEventListener('mousemove', onInteract)
      window.removeEventListener('touchstart', onInteract)
      listenersOn = false
    }
    const graceTimer = setTimeout(addListeners, GRACE_MS)

    let rockets = []
    let particles = []
    let twinkles = []
    let rafId
    const start = performance.now()
    let nextLaunch = 0
    // Cohetes lanzándose durante la mayor parte de la animación, dejando los
    // últimos ~2.2s solo para que las últimas partículas caigan y se apaguen.
    const totalMs = prefersReduced ? 1400 : duration
    const LAUNCH_WINDOW = prefersReduced ? 0 : Math.max(800, totalMs - 2200)

    function makeTwinkles(w, h) {
      const count = prefersReduced ? 0 : Math.round((w * h) / 26000)
      const arr = []
      for (let i = 0; i < count; i++) {
        arr.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.9,
          r: 1.6 + Math.random() * 2.4,
          phase: Math.random() * Math.PI * 2,
          speed: 0.0025 + Math.random() * 0.0035,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        })
      }
      return arr
    }
    twinkles = makeTwinkles(window.innerWidth, window.innerHeight)

    // Chispas como trazos cortos (no círculos rellenos) + mezcla aditiva al
    // dibujarlas: así una ráfaga de 80+ partículas se ve como luces
    // radiando, no como una bola borrosa de estambre.
    function explode(x, y, color) {
      const count = 70 + Math.floor(Math.random() * 40)
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3
        const speed = 2.6 + Math.random() * 4.4
        particles.push({
          x, y, px: x, py: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 55 + Math.random() * 30,
          color: jitterColor(color, (Math.random() - 0.5) * 70),
          size: 1.1 + Math.random() * 0.9,
        })
      }
      // Chispas centrales blancas, más brillantes, para el "pop" inicial.
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.6 + Math.random() * 1.2
        particles.push({
          x, y, px: x, py: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 16 + Math.random() * 10,
          color: '#ffffff',
          size: 1.8 + Math.random() * 1.2,
        })
      }
    }

    function spawnRocket() {
      const w = window.innerWidth, h = window.innerHeight
      const x = w * (0.1 + Math.random() * 0.8)
      const targetY = h * (0.14 + Math.random() * 0.32)
      rockets.push({
        x, y: h + 10, targetY,
        vy: -(6.2 + Math.random() * 2.8),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        trail: [],
      })
    }

    let seededReducedBurst = false

    function frame(now) {
      const elapsed = now - start
      const w = window.innerWidth, h = window.innerHeight
      ctx.clearRect(0, 0, w, h)

      // Factor de desvanecido cuando el usuario ya interactuó — corta la
      // animación en ~FADE_MS en vez de un corte seco.
      let fadeFactor = 1
      if (dismissing) {
        const fadeElapsed = now - dismissStart
        fadeFactor = Math.max(0, 1 - fadeElapsed / FADE_MS)
        if (fadeElapsed >= FADE_MS) {
          clearTimeout(graceTimer)
          removeListeners()
          onDoneRef.current?.()
          return // no programar otro frame — ya terminó
        }
      }

      // Lucecitas de fondo tipo "luces de fiesta", titilando toda la duración.
      twinkles.forEach((t) => {
        const alpha = (0.25 + 0.6 * Math.abs(Math.sin(elapsed * t.speed + t.phase))) * fadeFactor
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.fillStyle = t.color
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalAlpha = 1

      if (!dismissing && !prefersReduced && elapsed < LAUNCH_WINDOW && elapsed >= nextLaunch) {
        spawnRocket()
        if (Math.random() < 0.35) spawnRocket()
        nextLaunch = elapsed + 150 + Math.random() * 160
      }
      if (!dismissing && prefersReduced && !seededReducedBurst) {
        seededReducedBurst = true
        explode(w * 0.3, h * 0.3, COLORS[1])
        explode(w * 0.5, h * 0.4, COLORS[4])
        explode(w * 0.7, h * 0.32, COLORS[3])
      }

      rockets = rockets.filter((r) => {
        r.trail.push({ x: r.x, y: r.y })
        if (r.trail.length > 6) r.trail.shift()
        r.y += r.vy
        ctx.strokeStyle = r.color
        ctx.lineWidth = 1.6
        ctx.lineCap = 'round'
        ctx.beginPath()
        r.trail.forEach((p, i) => {
          ctx.globalAlpha = (i / r.trail.length) * fadeFactor
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()
        ctx.globalAlpha = fadeFactor
        ctx.beginPath()
        ctx.fillStyle = r.color
        ctx.arc(r.x, r.y, 2.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        if (r.y <= r.targetY) {
          explode(r.x, r.y, r.color)
          return false
        }
        return true
      })

      // Mezcla aditiva SOLO para las chispas: donde se traslapan se ven más
      // brillantes (como luz real), en vez de pintarse unas sobre otras como
      // un disco opaco — es lo que evita el efecto "bola de estambre".
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      particles = particles.filter((p) => {
        p.life++
        p.px = p.x
        p.py = p.y
        p.vy += 0.045
        p.vx *= 0.985
        p.vy *= 0.99
        p.x += p.vx
        p.y += p.vy
        const t = p.life / p.maxLife
        if (t >= 1) return false
        ctx.globalAlpha = Math.max(0, 1 - t) * fadeFactor
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size
        ctx.beginPath()
        ctx.moveTo(p.px, p.py)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        return true
      })
      ctx.restore()
      ctx.globalAlpha = 1

      if (elapsed < totalMs) {
        rafId = requestAnimationFrame(frame)
      } else {
        clearTimeout(graceTimer)
        removeListeners()
        onDoneRef.current?.()
      }
    }
    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(graceTimer)
      removeListeners()
      window.removeEventListener('resize', resize)
    }
  }, [active, duration])

  if (!active) return null
  return <canvas ref={canvasRef} className="fixed inset-0 z-[100] pointer-events-none" aria-hidden="true" />
}
