import { useEffect, useState } from 'react'

// Whether the page has scrolled under a sticky header: true once the sentinel, an empty element just
// above the header, has left its scroller. Watched, not computed on every scroll.
export const useStuck = () => {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => setStuck(entry ? !entry.isIntersecting : false))
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel])

  return [setSentinel, stuck] as const
}
