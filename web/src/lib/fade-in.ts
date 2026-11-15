import type { SyntheticEvent } from 'react'

const markLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.loaded = ''
}

// Spread on a picture: it fades in once loaded (see base.css), where it would otherwise appear line by line.
export const fadeIn = (className?: string) => ({
  className: className ? `${className} fade-in` : 'fade-in',
  onLoad: markLoaded
})
