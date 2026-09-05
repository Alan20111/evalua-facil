import { useRef, useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'

// Wraps content that needs horizontal scrolling. Shows a fade-gradient + chevron
// on the right edge when there is more content to reveal, and hides it once the
// user scrolls to the end. Self-contained: no state in the parent needed.
//
// The overflow-x-auto container is sized by its parent, so callers must ensure
// the parent has a definite width (e.g. flex-1, w-full, or a block element that
// fills its container). The children may be wider than the container — that is
// the whole point — but the page layout never overflows.
//
// Props:
//   className  — extra classes on the overflow-x-auto inner container (default '')
export default function ScrollHintX({ children, className = '' }) {
  const containerRef = useRef(null)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function check() {
      // +2 px tolerance for subpixel rounding across different browsers/devices
      const overflows = el.scrollWidth > el.clientWidth + 2
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
      setShowHint(overflows && !atEnd)
    }

    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="relative">
      <div ref={containerRef} className={`overflow-x-auto ${className}`}>
        {children}
      </div>
      {showHint && (
        <div
          aria-hidden="true"
          className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none bg-gradient-to-l from-surface-card via-surface-card to-transparent pl-8 pr-1"
        >
          <ChevronRight size={16} className="text-accent animate-pulse flex-shrink-0" />
        </div>
      )}
    </div>
  )
}
