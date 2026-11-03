import { useSyncExternalStore } from 'react'
import { loadSonner } from './deferred.ts'
import { t } from './i18n.ts'

// Short messages over the app (Sonner): what failed, what was done and can be undone, what waits for the
// network, and that a setting reached the server.

// Sonner is not in the code the first screen waits for (lib/deferred.ts). The toaster is placed once the app has
// shown, or by the first toast; a toast waits until it is there, a fraction of a second at most.
let wanted = false
const listeners = new Set<() => void>()
let mounted: () => void = () => {}
const ready = new Promise<void>(resolve => (mounted = resolve))

const want = () => {
  if (wanted) return
  wanted = true
  listeners.forEach(listener => listener())
}

window.addEventListener('load', () => window.setTimeout(want, 3000), { once: true })

export const useToasterWanted = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => wanted
  )

export const toasterMounted = () => mounted()

const toast = async () => {
  want()
  const [{ toast: sonner }] = await Promise.all([loadSonner(), ready])
  return sonner
}

const DURATION_MS = 4000
// Long enough to reach the button.
const ACTION_DURATION_MS = 6000
// A setting kept: read in a glance.
const SAVED_DURATION_MS = 2000

interface ToastAction {
  label: string
  onClick: () => void
}

// Something done, with "Annuler" when it can be.
export const showDone = (message: string, undo?: () => void) =>
  void toast().then(sonner =>
    sonner.success(message, {
      duration: undo ? ACTION_DURATION_MS : DURATION_MS,
      action: undo ? { label: t('common.cancel'), onClick: undo } : undefined
    })
  )

// A setting the server has kept. One of a kind: ten switches flipped in a row show one message.
export const showSaved = (message = t('toast.saved')) =>
  void toast().then(sonner => sonner.success(message, { id: 'saved', duration: SAVED_DURATION_MS }))

// Something failed: what to do next goes in the message, or in the button. `id` keeps one of a kind.
export const showError = (message: string, action?: ToastAction, id?: string) =>
  void toast().then(sonner =>
    sonner.error(message, { id, duration: action ? ACTION_DURATION_MS : DURATION_MS, action })
  )

// Neither done nor failed: the server's voice is missing, the device is offline.
export const showInfo = (message: string, id?: string) =>
  void toast().then(sonner => sonner.info(message, { id, duration: DURATION_MS }))
