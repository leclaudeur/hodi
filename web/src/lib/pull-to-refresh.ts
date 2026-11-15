import { useEffect, useRef, useState } from 'react'

// How far to pull, once slowed down, before letting go refreshes.
export const PULL_THRESHOLD = 64
const MAX_PULL = 96
// The indicator follows the finger at a fraction of its distance, like native lists.
const RESISTANCE = 0.45

// Whether the touched content is scrolled down: the page, or the panel it sits in (a tablet held across).
const scrolledAt = (target: EventTarget | null) => {
  if (window.scrollY > 0) return true
  for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
    if (element.scrollTop > 0) return true
  }
  return false
}

// Pulling down from the top of the page, then letting go, calls onRefresh.
// The browser's own pull-to-refresh (a full reload) is turned off in base.css.
export const usePullToRefresh = (onRefresh: () => void) => {
  const [pull, setPull] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const distance = useRef(0)
  const refresh = useRef(onRefresh)

  useEffect(() => {
    refresh.current = onRefresh
  })

  useEffect(() => {
    const handleStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      // Not under anything laid over the page (a story, the Résumé du jour, a dialog): its own scroll is not a pull.
      const covered =
        document.documentElement.hasAttribute('data-story') ||
        document.querySelector('dialog[open]') !== null ||
        (event.target instanceof Element && event.target.closest('[role="dialog"]') !== null)
      start.current =
        touch && event.touches.length === 1 && !covered && !scrolledAt(event.target)
          ? { x: touch.clientX, y: touch.clientY }
          : null
    }

    const handleMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!start.current || !touch) return

      const dy = touch.clientY - start.current.y
      const dx = touch.clientX - start.current.x

      // A sideways move is a swipe between tabs, an upward one a scroll.
      if (dy <= 0 || Math.abs(dx) > dy) {
        if (distance.current === 0) start.current = null
        return
      }

      distance.current = Math.min(MAX_PULL, dy * RESISTANCE)
      setPull(distance.current)
    }

    const handleEnd = () => {
      if (distance.current >= PULL_THRESHOLD) refresh.current()
      start.current = null
      distance.current = 0
      setPull(0)
    }

    window.addEventListener('touchstart', handleStart, { passive: true })
    window.addEventListener('touchmove', handleMove, { passive: true })
    window.addEventListener('touchend', handleEnd)
    window.addEventListener('touchcancel', handleEnd)

    return () => {
      window.removeEventListener('touchstart', handleStart)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [])

  return pull
}

// Pull to refresh with an async action: refreshing stays true until it is done.
export const usePullRefresh = (action: () => Promise<unknown>) => {
  const [refreshing, setRefreshing] = useState(false)
  const busy = useRef(false)
  const pull = usePullToRefresh(() => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    void action().finally(() => {
      busy.current = false
      setRefreshing(false)
    })
  })

  return { pull, refreshing }
}
