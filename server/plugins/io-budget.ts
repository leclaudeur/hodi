// The bytes Hodi's main thread holds for plugins at once: raw request bodies on their way into a sandbox. A body
// reserves its room before it is read; when there is none, the request is refused at once (503) rather than held in
// memory. Tests change the size.
export const ioBudget = { bytes: 32 * 1024 * 1024 }

let used = 0

// Takes the room, and gives the way to free it (once); null when it does not fit.
export const reserveIo = (bytes: number): (() => void) | null => {
  if (used + bytes > ioBudget.bytes) return null
  used += bytes
  let freed = false
  return () => {
    if (freed) return
    freed = true
    used -= bytes
  }
}
