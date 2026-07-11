// Maps subject palette key → {bg, text} CSS color pair.
// Mirrors the CSS variables in index.css — keep in sync if palette changes.
export const SUBJECT_PALETTE = {
  default: { bg: '#dbeafe', text: '#1d4ed8' },
  orange:  { bg: '#ffedd5', text: '#c2410c' },
  purple:  { bg: '#f3e8ff', text: '#7e22ce' },
  green:   { bg: '#dcfce7', text: '#15803d' },
  rose:    { bg: '#ffe4e6', text: '#be123c' },
  teal:    { bg: '#ccfbf1', text: '#0d9488' },
  slate:   { bg: '#e2e8f0', text: '#334155' },
}

// ── Custom color support ─────────────────────────────────────────────
// A subject's colorPalette can be a preset key OR "custom:#rrggbb".

export function isCustomPalette(value) {
  return typeof value === 'string' && value.startsWith('custom:#')
}

export function customPaletteHex(value) {
  return isCustomPalette(value) ? value.slice('custom:'.length) : null
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

// Mix `hex` toward `target` ([r,g,b]) by `weight` (0..1).
function mixToward(hex, target, weight) {
  const rgb = hexToRgb(hex)
  return rgbToHex(rgb.map((v, i) => v + (target[i] - v) * weight))
}

const mixWithWhite = (hex, w) => mixToward(hex, [255, 255, 255], w)
const mixWithBlack = (hex, w) => mixToward(hex, [0, 0, 0], w)

// WCAG relative luminance (0 = black, 1 = white).
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Custom colors live on white cards/forms — darken overly light picks
// (yellows, pastels) until they read clearly against white.
export function ensureVisibleOnWhite(hex) {
  let h = hex
  let guard = 0
  while (luminance(h) > 0.45 && guard++ < 12) h = mixWithBlack(h, 0.12)
  return h
}

export function subjectColors(subject) {
  const value = subject?.colorPalette || subject?.palette || 'default'
  if (isCustomPalette(value)) {
    const hex = customPaletteHex(value)
    return { bg: mixWithWhite(hex, 0.85), text: mixWithBlack(hex, 0.15) }
  }
  return SUBJECT_PALETTE[value] ?? SUBJECT_PALETTE.default
}

// Props for the wrapper that themes a subtree with the subject's color.
// Preset keys resolve through the [data-subject-palette=...] rules in
// index.css; custom colors inject the same CSS variables inline (the
// derived --accent-tint/-medium tiers follow automatically via color-mix).
export function subjectPaletteProps(value) {
  const v = value || 'default'
  if (isCustomPalette(v)) {
    const hex = customPaletteHex(v)
    return {
      'data-subject-palette': 'custom',
      style: {
        '--accent': hex,
        '--accent-hover': mixWithBlack(hex, 0.18),
        '--accent-light': mixWithWhite(hex, 0.85),
      },
    }
  }
  return { 'data-subject-palette': v }
}
