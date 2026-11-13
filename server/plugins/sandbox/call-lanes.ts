import type { SandboxCallKind } from './protocol.ts'
import {
  MAX_WAITING_CALLS,
  MAX_WAITING_EXPORTS,
  MAX_WAITING_HOOKS,
  MAX_WAITING_SIGN_INS,
  SIGN_IN_WAIT_MS,
  SandboxError
} from './sandbox-limits.ts'

// The calls waiting for a plugin's thread, in lanes: a few in each and not for long, past that they are refused.

// A call into the plugin, or a value the core reads from its database (read()).
export type Job =
  | { kind: SandboxCallKind; name: string; argument: unknown; context: unknown; body?: Uint8Array }
  | { kind: 'read'; sql: string; params: (string | number | null)[] }
  | { kind: 'snapshot' }

export interface Waiting {
  job: Job
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

type Lane = 'signIn' | 'copy' | 'call' | 'hook'

// A sign-in goes first, in its own lane: someone is waiting at Connexion. A scheduled task waits with the hooks,
// behind the requests of people, and so does a feed's read.
const laneOf = (job: Job): Lane => {
  if (job.kind === 'hook' && job.name === 'checkSignIn') return 'signIn'
  if (job.kind === 'hook' && job.name === 'exportData') return 'copy'
  if (job.kind === 'hook' || job.kind === 'task' || job.kind === 'feed' || job.kind === 'snapshot') return 'hook'
  return 'call'
}

const MOST: Record<Lane, number> = {
  signIn: MAX_WAITING_SIGN_INS,
  copy: MAX_WAITING_EXPORTS,
  call: MAX_WAITING_CALLS,
  hook: MAX_WAITING_HOOKS
}

// The order calls are taken in: sign-ins first, then copies, then routes, then hooks.
const ORDER: Lane[] = ['signIn', 'copy', 'call', 'hook']

export class CallLanes {
  readonly #lanes: Record<Lane, Waiting[]> = { signIn: [], copy: [], call: [], hook: [] }

  // Whether one more route call may wait now.
  hasRoomForCall() {
    return this.#lanes.call.length < MAX_WAITING_CALLS
  }

  hasRoomFor(job: Job) {
    const lane = laneOf(job)
    return this.#lanes[lane].length < MOST[lane]
  }

  // A sign-in waits a short while at most; the others as long as the sandbox lets a call wait.
  add(job: Job, maxWaitMs: number, resolve: Waiting['resolve'], reject: Waiting['reject']) {
    const lane = laneOf(job)
    const queue = this.#lanes[lane]
    const waiting: Waiting = {
      job,
      resolve,
      reject,
      timer: setTimeout(
        () => {
          const at = queue.indexOf(waiting)
          if (at < 0) return
          queue.splice(at, 1)
          reject(new SandboxError('busy', 'waited too long'))
        },
        lane === 'signIn' ? Math.min(SIGN_IN_WAIT_MS, maxWaitMs) : maxWaitMs
      )
    }
    queue.push(waiting)
  }

  next(): Waiting | undefined {
    for (const lane of ORDER) {
      const waiting = this.#lanes[lane].shift()
      if (waiting) return waiting
    }
    return undefined
  }

  // Every waiting call, taken out of the lanes.
  drain(): Waiting[] {
    return ORDER.flatMap(lane => this.#lanes[lane].splice(0))
  }
}
