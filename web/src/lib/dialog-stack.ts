import { useSyncExternalStore } from 'react'

// The dialogs open now, oldest first. A dialog opened from another one does not replace it: it is drawn as the
// same card changing its content, with a way back to the one under it. Only the top one shows; the others wait
// under it, as they were.

interface Layer {
  id: string
  // Closes it the way its cross does: its onClose follows.
  close: () => void
}

let stack: Layer[] = []
const listeners = new Set<() => void>()

const set = (next: Layer[]) => {
  stack = next
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const openLayer = (layer: Layer) => set([...stack.filter(entry => entry.id !== layer.id), layer])

export const closeLayer = (id: string) => {
  if (stack.some(entry => entry.id === id)) set(stack.filter(entry => entry.id !== id))
}

// The cross and a click outside close them all, the top one first.
export const closeAllLayers = () => [...stack].reverse().forEach(entry => entry.close())

// Where a dialog stands: covered by another, or over one it can go back to.
export const useLayer = (id: string) => {
  const index = useSyncExternalStore(subscribe, () => stack.findIndex(entry => entry.id === id))
  const count = useSyncExternalStore(subscribe, () => stack.length)
  return { covered: index !== -1 && index < count - 1, hasPrevious: index > 0 }
}
