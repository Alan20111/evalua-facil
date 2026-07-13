import { useEffect, useRef } from 'react'

// Celebración de "ya entregaste" — una tanda breve de fuegos artificiales que
// se dibuja sobre toda la pantalla y desaparece sola. No usa ninguna librería
// (canvas 2D simple) para no agregar dependencias nuevas al bundle.
//
// Uso: <Fireworks active={showFireworks} onDone={() => setShowFireworks(false)} />
// `active` dispara la animación; al terminar (o si el usuario tiene
// prefers-reduced-motion) se llama a `onDone` para que el padre la desmonte.

const COLORS = ['#ff5e5e', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f72585']

export default function Fireworks({ active, onDone, duration = 2600 }) {
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

    let rockets = []
    let particles = []
    let rafId
    const start = performance.now()
    let nextLaunch = 0
    // Con reduced-motion no lanzamos cohetes (nada de movimiento vertical
    // largo): solo un par de estallidos instantáneos y cortos.
    const LAUNCH_WINDOW = prefersReduced ? 0 : 1400
    const totalMs = prefersReduced ? 900 : duration

    function explode(x, y, color) {
      const count = 46 + Math.floor(Math.random() * 20)
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3
        const speed = 2 + Math.random() * 3.2
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 55 + Math.random() * 25,
          color,
          size: 1.6 + Math.random() * 1.6,
        })
      }
    }

    function spawnRocket() {
      const w = window.innerWidth, h = window.innerHeight
      const x = w * (0.15 + Math.random() * 0.7)
      const targetY = h * (0.18 + Math.random() * 0.28)
      rockets.push({
        x, y: h + 10, targetY,
        vy: -(6 + Math.random() * 2.5),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      })
    }

    let seededReducedBurst = false

    function frame(now) {
      const elapsed = now - start
      const w = window.innerWidth, h = window.innerHeight
      ctx.clearRect(0, 0, w, h)

      if (!prefersReduced && elapsed < LAUNCH_WINDOW && elapsed >= nextLaunch) {
        spawnRocket()
        nextLaunch = elapsed + 260 + Math.random() * 220
      }
      if (prefersReduced && !seededReducedBurst) {
        seededReducedBurst = true
        explode(w * 0.35, h * 0.32, COLORS[1])
        explode(w * 0.65, h * 0.38, COLORS[3])
      }

      rockets = rockets.filter((r) => {
        r.y += r.vy
        ctx.beginPath()
        ctx.fillStyle = r.color
        ctx.arc(r.x, r.y, 2.4, 0, Math.PI * 2)
        ctx.fill()
        if (r.y <= r.targetY) {
          explode(r.x, r.y, r.color)
          return false
        }
        return true
      })

      particles = particles.filter((p) => {
        p.life++
        p.vy += 0.045
        p.vx *= 0.985
        p.vy *= 0.99
        p.x += p.vx
        p.y += p.vy
        const t = p.life / p.maxLife
        if (t >= 1) return false
        ctx.globalAlpha = Math.max(0, 1 - t)
        ctx.beginPath()
        ctx.fillStyle = p.color
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        return true
      })

      if (elapsed < totalMs) {
        rafId = requestAnimationFrame(frame)
      } else {
        onDoneRef.current?.()
      }
    }
    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [active, duration])

  if (!active) return null
  return <canvas ref={canvasRef} className="fixed inset-0 z-[100] pointer-events-none" aria-hidden="true" />
}
