import { useSyncExternalStore } from 'react'
import { FRONT_PAGE_HREF } from './use-hash-route.ts'

// The guided tour ("ajouter une source pas à pas"): the step shown, or null. Shown once to a profile just added, the
// first time it is opened, on any device (Profile.tourPending); again from Réglages > Ton profil.

let step: number | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useTourStep = () => useSyncExternalStore(subscribe, () => step)

export const goToTourStep = (next: number | null) => {
  if (next === step) return
  step = next
  listeners.forEach(listener => listener())
}

// From Le fil, whatever was open.
export const startTour = () => {
  window.location.hash = FRONT_PAGE_HREF
  goToTourStep(0)
}

export const endTour = () => goToTourStep(null)
