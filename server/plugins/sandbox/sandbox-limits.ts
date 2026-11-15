import { DEFAULT_MEMORY_MB, MAX_MEMORY_MB } from '../manifest.ts'
import { SQLITE_HEAP_BYTES } from './sqlite-wasm.ts'

// The sandbox's limits and its errors, apart from the thread's bookkeeping (sandbox.ts).

export { DEFAULT_MEMORY_MB, MAX_MEMORY_MB }
// What a plugin's database file may hold.
export const DEFAULT_DATABASE_MB = 256
export const DEFAULT_TIMEOUT_MS = 10_000
export const MAX_RESULT_BYTES = 1024 * 1024
export const IDLE_MS = 60_000
// The thread stops its own code at the time limit, but not a query deep in SQLite or a chain of tiny promise jobs: past
// this much more, the main thread ends it.
export const GRACE_MS = 500
// A plugin whose thread dies this often (it cannot start, or crashes) is not started again until Hodi restarts.
export const MAX_DEATHS = 3
export const DEATHS_WINDOW_MS = 10 * 60_000

// What a thread may use at worst, measured: Node's own thread (~40 MiB), the engine's memory (16 MiB to start with,
// plus what the plugin may take) and its SQLite heap.
const THREAD_MB = 40
const ENGINE_START_MB = 16
export const threadCostMb = (memoryMb: number) => THREAD_MB + ENGINE_START_MB + memoryMb + SQLITE_HEAP_BYTES / 2 ** 20
// What every plugin thread together may use: Hodi runs in a 256 MiB container (compose.yaml) and needs the rest.
// Tests lower it.
export const sandboxBudget = { mb: 128 }
// Calls waiting for one plugin, beyond the one running: routes, then onArticle (dropped first, never ahead of routes).
export const MAX_WAITING_CALLS = 8
export const MAX_WAITING_HOOKS = 4
// Sign-ins (checkSignIn) wait in a lane of their own, ahead of the routes and apart from their count: public routes
// filling the queue must never refuse everyone's sign-in (checkSignIn fails closed). They wait a short while at most.
export const MAX_WAITING_SIGN_INS = 8
export const SIGN_IN_WAIT_MS = 3000
// A copy of someone's data (exportData) has a small lane of its own, after the sign-ins and before the routes: a
// person waits for it, but copies asked in a row must never hold up a sign-in.
export const MAX_WAITING_EXPORTS = 2

export class SandboxError extends Error {
  readonly code: 'failed' | 'plugin_error' | 'timeout' | 'out_of_memory' | 'stopped' | 'crashed' | 'busy'

  constructor(code: SandboxError['code'], detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

// What the plugin's code may ask of Hodi (ctx.fetchText, ctx.articles…), by name. A request missing here is refused:
// the caller builds this list from what the plugin's manifest allows. context is what the call that led to the request
// was given (the household it runs for).
export type SandboxRequest = (args: unknown[], context: unknown) => Promise<unknown>

export interface SandboxHost {
  requests: Record<string, SandboxRequest>
  log: (line: string) => void
  settings: () => Record<string, unknown>
}

export interface SandboxOptions {
  id: string
  source: string
  dbFile: string
  host: SandboxHost
  memoryMb?: number
  databaseMb?: number
  timeoutMs?: number
  idleMs?: number
  // How long a call may wait for its turn, or for room to start the thread.
  maxWaitMs?: number
}
