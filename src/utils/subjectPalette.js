// Maps subject palette key → {bg, text} CSS color pair.
// Mirrors the CSS variables in index.css — keep in sync if palette changes.
export const SUBJECT_PALETTE = {
  default: { bg: '#dbeafe', text: '#1d4ed8' },
  orange:  { bg: '#ffedd5', text: '#c2410c' },
  purple:  { bg: '#f3e8ff', text: '#7e22ce' },
  green:   { bg: '#dcfce7', text: '#15803d' },
  rose:    { bg: '#ffe4e6', text: '#be123c' },
  teal:    { bg: '#ccfbf1', text: '#0d9488' },
}

export function subjectColors(subject) {
  return SUBJECT_PALETTE[subject?.palette || 'default'] ?? SUBJECT_PALETTE.default
}
