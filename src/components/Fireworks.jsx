import { useEffect, useRef } from 'react'

// Celebración de "ya entregaste" — una tanda de fuegos artificiales (más
// luces de fiesta: cohetes densos con destello + una capa de lucecitas que
// titilan de fondo) que se dibuja sobre toda la pantalla y desaparece sola.
// No usa ninguna librería (canvas 2D simple) para no agregar dependencias
// nuevas al bundle.
//
// Uso: <Fireworks active={showFireworks} onDone={() => setShowFireworks(false)} />
// `active` dispara la animación; al terminar (o si el usuario tiene
// prefers-reduced-motion) se llama a `onDone` para que el padre la desmonte.

const COLORS = ['#ff5e5e', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9f1c', '#f72585', '#ffffff', '#7bf1a8']

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
      const count = prefersReduced ? 0 : Math.round((w * h) / 26000) // más luces en pantallas grandes
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

    function explode(x, y, color) {
      // Ráfagas más grandes y notorias.
      const count = 80 + Math.floor(Math.random() * 45)
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3
        const speed = 2.2 + Math.random() * 3.8
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 60 + Math.random() * 35,
          color,
          size: 1.8 + Math.random() * 2.1,
        })
      }
      // Un puñado de chispas centrales más brillantes, para dar "pop".
      for (let i = 0; i < 10; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          life: 0,
          maxLife: 20 + Math.random() * 12,
          color: '#ffffff',
          size: 2.6 + Math.random() * 1.6,
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

      // Lucecitas de fondo tipo "luces de fiesta", titilando toda la duración.
      twinkles.forEach((t) => {
        const alpha = 0.25 + 0.6 * Math.abs(Math.sin(elapsed * t.speed + t.phase))
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.fillStyle = t.color
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.globalAlpha = 1

      // Lanza cohetes densamente durante la ventana de lanzamiento; a veces
      // dos a la vez, para que se sienta más lleno de luces.
      if (!prefersReduced && elapsed < LAUNCH_WINDOW && elapsed >= nextLaunch) {
        spawnRocket()
        if (Math.random() < 0.35) spawnRocket()
        nextLaunch = elapsed + 150 + Math.random() * 160
      }
      if (prefersReduced && !seededReducedBurst) {
        seededReducedBurst = true
        explode(w * 0.3, h * 0.3, COLORS[1])
        explode(w * 0.5, h * 0.4, COLORS[4])
        explode(w * 0.7, h * 0.32, COLORS[3])
      }

      rockets = rockets.filter((r) => {
        r.trail.push({ x: r.x, y: r.y })
        if (r.trail.length > 6) r.trail.shift()
        r.y += r.vy
        // Estela breve del cohete subiendo.
        ctx.strokeStyle = r.color
        ctx.lineWidth = 1.6
        ctx.beginPath()
        r.trail.forEach((p, i) => {
          ctx.globalAlpha = i / r.trail.length
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.fillStyle = r.color
        ctx.arc(r.x, r.y, 2.6, 0, Math.PI * 2)
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
        ctx.shadowBlur = 7
        ctx.shadowColor = p.color
        ctx.beginPath()
        ctx.fillStyle = p.color
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
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
