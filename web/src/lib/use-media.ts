import { useSyncExternalStore } from 'react'

// Three columns from this width (tablets across included); below it, the phone and tablet layout.
export const DESKTOP_QUERY = '(min-width: 1024px)'

export const useMedia = (query: string) =>
  useSyncExternalStore(
    listener => {
      const media = window.matchMedia(query)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    () => window.matchMedia(query).matches
  )

export const useIsDesktop = () => useMedia(DESKTOP_QUERY)

// A phone, not a tablet held upright: the same width as the CSS's phone rules.
export const PHONE_QUERY = '(max-width: 600px)'

export const useIsPhone = () => useMedia(PHONE_QUERY)

// Tablets held across (and small computers): the sidebar, then one panel showing the tablet lists
// or the desktop reader in turn, instead of a list and a reader side by side.
export const TABLET_ACROSS_QUERY = '(min-width: 1024px) and (max-width: 1279px)'

export const useIsTabletAcross = () => useMedia(TABLET_ACROSS_QUERY)

// A mouse and, most likely, a keyboard. On a touch screen a field focused on its own opens the on-screen keyboard,
// which hides half of what a modal says: there, the finger chooses the field.
export const typesAtOnce = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
