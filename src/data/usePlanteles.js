import { useState, useEffect } from 'react'

// The CCT catalog (~1700 CBT/CETIS/CBTIS/CECYTE… campuses, ~290 KB) is served as a
// static asset from /public and fetched lazily ONLY on the pages that need it
// (register / profile), so it never bloats the main app bundle every user downloads.
// The result is cached at module level so it loads at most once per session.
let cache = null
let inflight = null

export function usePlanteles() {
  const [planteles, setPlanteles] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (cache) return
    if (!inflight) {
      inflight = fetch('/planteles.json').then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo')
        return r.json()
      })
    }
    let active = true
    inflight
      .then((data) => {
        cache = data
        if (active) {
          setPlanteles(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return { planteles, loading }
}

// Exact-match lookup by CCT (the catalog key). Returns the campus record or null.
export function findPlantel(planteles, cct) {
  const val = (cct || '').trim().toUpperCase()
  if (val.length < 5) return null
  return planteles.find((p) => p.cct === val) || null
}
