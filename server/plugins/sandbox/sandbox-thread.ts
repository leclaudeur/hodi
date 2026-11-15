import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { FromSandbox, SandboxData, ToSandbox } from './protocol.ts'
import { MAX_RESULT_BYTES, SandboxError, type SandboxRequest } from './sandbox-limits.ts'
import type { Job } from './call-lanes.ts'
import type { PluginSandbox } from './sandbox.ts'

// The threads of every plugin's sandbox: which run now, starting one, and answering its requests.

// The threads running now, across all plugins, with when each was last used.
export const running = new Map<PluginSandbox, number>()
// How many threads run now (tests).
export const runningThreads = () => running.size
// Who waits for room in the budget: told when a thread ends or a call does.
const roomWaiters = new Set<() => void>()

export const roomFreed = () => {
  for (const wake of roomWaiters) wake()
  roomWaiters.clear()
}

// Until room may have been freed, or a quarter of a second at most.
export const waitForRoom = (left: number) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, Math.min(left, 250))
    roomWaiters.add(() => {
      clearTimeout(timer)
      resolve()
    })
  })

// The worker as tests run it (TypeScript) or as the build ships it (JavaScript).
const workerFile = () => {
  const here = fileURLToPath(import.meta.url)
  return path.join(path.dirname(here), `worker${path.extname(here)}`)
}

interface ThreadOptions {
  id: string
  source: string
  dbFile: string
  memoryMb: number
  databaseMb: number
  timeoutMs: number
  host: { requests: Record<string, SandboxRequest> }
}

export const threadData = ({
  id,
  source,
  dbFile,
  memoryMb,
  databaseMb,
  timeoutMs,
  host
}: ThreadOptions): SandboxData => ({
  id,
  source,
  dbFile,
  memoryBytes: memoryMb * 1024 * 1024,
  databaseBytes: databaseMb * 1024 * 1024,
  timeoutMs,
  maxResultBytes: MAX_RESULT_BYTES,
  objects: [
    ...new Set(
      Object.keys(host.requests)
        .filter(name => name.includes('.'))
        .map(name => name.split('.')[0]!)
    )
  ]
})

export const startThread = (data: SandboxData) =>
  new Worker(workerFile(), {
    workerData: data,
    // The thread's own heap, beside the engine's memory: what the bridge holds stays small.
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
    // Nothing of Hodi's environment (keys, settings) reaches the thread.
    env: {},
    stdout: true,
    stderr: true
  })

// The requests a plugin may make of Hodi, and nothing else.
export const answerRequest = async (
  requests: Record<string, SandboxRequest>,
  method: string,
  args: string,
  context: unknown
) => {
  try {
    const request = Object.prototype.hasOwnProperty.call(requests, method) ? requests[method] : undefined
    if (!request) throw new Error('not_allowed')
    const parsed: unknown = JSON.parse(args)
    const result = await request(Array.isArray(parsed) ? parsed : [], context)
    return { ok: true, value: JSON.stringify(result ?? null) }
  } catch (error) {
    return { ok: false, value: error instanceof Error ? error.message : String(error) }
  }
}

export interface Pending {
  resolve: (value: string | Uint8Array) => void
  reject: (error: SandboxError) => void
}

// A call's answer from the thread: its result as JSON, or the bytes read() asked for.
export const settle = (
  pending: Map<number, Pending>,
  message: Extract<FromSandbox, { type: 'result' } | { type: 'read-result' }>
) => {
  const waiting = pending.get(message.id)
  pending.delete(message.id)
  if (message.type === 'result') {
    if (message.ok) waiting?.resolve(message.value)
    else waiting?.reject(new SandboxError('plugin_error', message.value))
    return
  }
  if (message.ok && message.bytes) waiting?.resolve(message.bytes)
  else waiting?.reject(new SandboxError('plugin_error', message.error ?? 'not_found'))
}

// Hands a job to the thread. A call's body is copied into a buffer of its own, handed over to the thread.
export const postJob = (worker: Worker, id: number, job: Job, settings: () => Record<string, unknown>) => {
  if (job.kind === 'read') {
    worker.postMessage({ type: 'read', id, sql: job.sql, params: JSON.stringify(job.params) } satisfies ToSandbox)
    return
  }
  if (job.kind === 'snapshot') {
    worker.postMessage({ type: 'snapshot', id } satisfies ToSandbox)
    return
  }
  const body = job.body ? new Uint8Array(job.body) : undefined
  worker.postMessage(
    {
      type: 'call',
      id,
      kind: job.kind,
      name: job.name,
      argument: JSON.stringify(job.argument ?? null),
      settings: JSON.stringify(settings()),
      ...(body ? { body } : {})
    } satisfies ToSandbox,
    body ? [body.buffer] : []
  )
}
