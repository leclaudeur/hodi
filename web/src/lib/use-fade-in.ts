import { type RefObject, useLayoutEffect, useRef } from 'react'

const FADE_IN_MS = 220

// A new screen eases in rather than appearing at once: what `target` picks in the element fades from nothing
// each time the key changes (not on the first render, which the app's own load covers). Only its opacity:
// a transform would move the fixed bars and pills inside it. Skipped when the system asks for less motion.
export const useFadeIn = (
  element: RefObject<HTMLElement | null>,
  key: string,
  target: (element: HTMLElement) => Element | null = element => element
) => {
  const first = useRef(true)

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const faded = element.current && target(element.current)
    faded?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN_MS,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    })
  }, [element, key, target])
}
