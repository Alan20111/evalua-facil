#!/usr/bin/env node
// Renderiza los 5 sonidos de ALARMA_SONIDOS (src/utils/horarioBloques.js) a
// archivos .wav reales — Android necesita un archivo de audio de verdad para
// usarlo como sonido de canal de notificación; no puede reproducir Web Audio
// en segundo plano. Replica a mano (sin dependencias nuevas) la misma onda
// senoidal + envolvente de ganancia que reproducirSonido() usa en el navegador,
// para que suenen IDÉNTICOS a los tonos que ya escucha el docente.
//
// Uso: node scripts/generar-sonidos-notificacion.js
// Salida: android/app/src/main/res/raw/notif_<id>.wav (PCM 16-bit mono, 44.1kHz)

const fs = require('fs')
const path = require('path')

// ── Mismo catálogo que ALARMA_SONIDOS en src/utils/horarioBloques.js ────────
const ALARMA_SONIDOS = [
  { id: 'campana', notas: [[880, 0.15], [660, 0.15], [880, 0.3]] },
  { id: 'timbre', notas: [[1046, 0.12], [1046, 0.12], [1046, 0.12]] },
  { id: 'suave', notas: [[523, 0.25], [659, 0.25], [784, 0.4]] },
  { id: 'digital', notas: [[1200, 0.08], [900, 0.08], [1200, 0.08], [900, 0.08]] },
  { id: 'marimba', notas: [[659, 0.2], [784, 0.2], [988, 0.2], [1319, 0.35]] },
]

const SAMPLE_RATE = 44100
const PEAK = 0.3 // mismo pico que reproducirSonido() en horarioBloques.js
const RAMP_UP = 0.02

// Misma matemática que gain.gain.exponentialRampToValueAtTime(): interpolación
// exponencial entre startValue y endValue a lo largo de [t0, t1].
function expRamp(t, t0, t1, startValue, endValue) {
  if (t <= t0) return startValue
  if (t >= t1) return endValue
  const frac = (t - t0) / (t1 - t0)
  return startValue * Math.pow(endValue / startValue, frac)
}

function envelopeAt(t, dur) {
  if (t < RAMP_UP) return expRamp(t, 0, RAMP_UP, 0.0001, PEAK)
  return expRamp(t, RAMP_UP, dur, PEAK, 0.0001)
}

function renderSonido({ notas }) {
  const totalSamples = notas.reduce((sum, [, dur]) => sum + Math.round(dur * SAMPLE_RATE), 0)
  const pcm = new Int16Array(totalSamples)
  let offset = 0
  notas.forEach(([freq, dur]) => {
    const n = Math.round(dur * SAMPLE_RATE)
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE
      const gain = envelopeAt(t, dur)
      const sample = Math.sin(2 * Math.PI * freq * t) * gain
      pcm[offset + i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }
    offset += n
  })
  return pcm
}

// Header RIFF/WAVE mínimo para PCM 16-bit mono.
function wavBuffer(pcm) {
  const dataSize = pcm.length * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2)
  return buf
}

const outDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw')
fs.mkdirSync(outDir, { recursive: true })

ALARMA_SONIDOS.forEach((sonido) => {
  const pcm = renderSonido(sonido)
  const buf = wavBuffer(pcm)
  const outPath = path.join(outDir, `notif_${sonido.id}.wav`)
  fs.writeFileSync(outPath, buf)
  console.log(`${outPath} — ${(buf.length / 1024).toFixed(1)} KB, ${(pcm.length / SAMPLE_RATE).toFixed(2)}s`)
})
