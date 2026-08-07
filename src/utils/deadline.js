import { Timestamp } from 'firebase/firestore'

// Mirrors a `fechaLimite` string (or a per-student `extensiones` date, same
// format) into a real Firestore Timestamp, computed HERE on the client with a
// real JS Date — so it captures the browser's own timezone correctly. This is
// what firestore.rules compares `request.time` against (A12 H3): the rules
// language can't safely parse an arbitrary ISO string itself (no timezone-aware
// string parser), so the server needs the already-resolved instant, not the
// string.
//
// Same "legacy date-only closes at end of day" rule the client already uses
// to compute `isPastDeadline` (see ActivityPage.jsx) — keep both in sync.
export function fechaLimiteTimestamp(fechaLimiteStr) {
  if (!fechaLimiteStr) return null
  const iso = fechaLimiteStr.includes('T') ? fechaLimiteStr : `${fechaLimiteStr}T23:59:59`
  return Timestamp.fromDate(new Date(iso))
}
