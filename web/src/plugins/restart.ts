// Hodi restarts after a plugin is installed, updated or removed. Each start has its own boot id (/health): the app
// waits for a new one, then reloads on the new plugins.

const healthBoot = async (): Promise<string | null> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    if (!response.ok) return null
    const { boot } = (await response.json()) as { boot?: unknown }
    return typeof boot === 'string' ? boot : null
  } catch {
    return null
  }
}

export const currentBoot = healthBoot

// Resolves true once Hodi answers from a new start, false after `timeout` ms without one. onStopped is called once,
// the first time Hodi doesn't answer: the old start is gone.
export const waitForRestart = async (
  before: string | null,
  {
    interval = 1000,
    timeout = 60_000,
    now = Date.now,
    onStopped
  }: { interval?: number; timeout?: number; now?: () => number; onStopped?: () => void } = {}
): Promise<boolean> => {
  const until = now() + timeout
  let stopped = false
  while (now() < until) {
    await new Promise(resolve => setTimeout(resolve, interval))
    const boot = await healthBoot()
    if (boot && boot !== before) return true
    if (!boot && !stopped) {
      stopped = true
      onStopped?.()
    }
  }
  return false
}

// The restart's steps, as a share of the way: the change sent, the old start stopped, the new one answering.
export type RestartStep = 'sent' | 'stopped' | 'back'

const STEPS: Record<RestartStep, [from: number, to: number]> = { sent: [0, 45], stopped: [45, 90], back: [100, 100] }

// The percentage shown: each step moves towards its end, slower and slower, and never passes it before the next
// step really comes. ms: the time since the step began.
export const restartPercent = (step: RestartStep, ms: number) => {
  const [from, to] = STEPS[step]
  if (from === to) return to
  return Math.min(to - 1, Math.floor(from + (to - from) * (1 - Math.exp(-ms / 2500))))
}
