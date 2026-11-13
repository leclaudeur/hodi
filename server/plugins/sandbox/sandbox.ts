import type { Worker } from 'node:worker_threads'
import type { FromSandbox, SandboxCallKind, SandboxShape, ToSandbox } from './protocol.ts'
import {
  DEATHS_WINDOW_MS,
  DEFAULT_DATABASE_MB,
  DEFAULT_MEMORY_MB,
  DEFAULT_TIMEOUT_MS,
  GRACE_MS,
  IDLE_MS,
  MAX_DEATHS,
  MAX_MEMORY_MB,
  SandboxError,
  type SandboxHost,
  type SandboxOptions,
  sandboxBudget,
  threadCostMb
} from './sandbox-limits.ts'
import { CallLanes, type Job } from './call-lanes.ts'
import {
  type Pending,
  answerRequest,
  postJob,
  settle,
  roomFreed,
  running,
  runningThreads,
  startThread,
  threadData,
  waitForRoom
} from './sandbox-thread.ts'

// A plugin's server code, run apart (worker.ts): Hodi's main thread only sends it calls and answers its few requests.
// A call that takes too long, or an engine out of memory, ends the thread; the next call starts it again.
// Threads run within one memory budget across all plugins, counted at what each may use at worst: one left unused for
// IDLE_MS is ended, the one used least recently and idle makes room for another, and a call that finds no room in time
// is refused. Calls to one plugin go one at a time, with only a few waiting; onArticle waits apart, behind routes.

export {
  MAX_WAITING_CALLS,
  MAX_WAITING_EXPORTS,
  MAX_WAITING_HOOKS,
  SIGN_IN_WAIT_MS,
  SandboxError,
  sandboxBudget,
  threadCostMb
} from './sandbox-limits.ts'
export type { SandboxHost, SandboxOptions, SandboxRequest } from './sandbox-limits.ts'

export { runningThreads }

export class PluginSandbox {
  readonly #options: Required<Omit<SandboxOptions, 'host'>> & { host: SandboxHost }
  // Calls go one at a time: each one's time limit starts when the thread takes it.
  readonly #lanes = new CallLanes()
  #calling = false
  #starting = false
  // What the running call was given, for the requests its code makes. Work it leaves running after it returns gets
  // null: it no longer acts for anyone.
  #context: unknown = null
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #worker: Worker | null = null
  #ready: Promise<SandboxShape> | null = null
  #nextCall = 0
  readonly #pending = new Map<number, Pending>()
  readonly #watchdogs = new Map<number, ReturnType<typeof setTimeout>>()
  #stopped = false
  readonly #deaths: number[] = []

  constructor({
    memoryMb = DEFAULT_MEMORY_MB,
    databaseMb = DEFAULT_DATABASE_MB,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    idleMs = IDLE_MS,
    maxWaitMs = timeoutMs,
    ...options
  }: SandboxOptions) {
    this.#options = {
      ...options,
      memoryMb: Math.min(Math.max(memoryMb, 1), MAX_MEMORY_MB),
      databaseMb,
      timeoutMs,
      idleMs,
      maxWaitMs
    }
  }

  // Starts the thread if it is not running, and says what the plugin exports.
  start(): Promise<SandboxShape> {
    if (this.#stopped) return Promise.reject(new SandboxError('stopped'))
    const since = Date.now() - DEATHS_WINDOW_MS
    if (this.#deaths.filter(at => at > since).length >= MAX_DEATHS) {
      return Promise.reject(new SandboxError('failed', `stopped after ${MAX_DEATHS} failures`))
    }
    this.#ready ??= this.#spawn()
    return this.#ready
  }

  // Waits until this thread fits in the budget, ending idle threads (the one used least recently first).
  async #makeRoom() {
    const cost = threadCostMb(this.#options.memoryMb)
    if (cost > sandboxBudget.mb) throw new SandboxError('failed', 'needs more memory than plugins may use')
    const deadline = Date.now() + this.#options.maxWaitMs
    for (;;) {
      const used = () =>
        [...running.keys()].reduce(
          (sum, sandbox) => sum + (sandbox === this ? 0 : threadCostMb(sandbox.#options.memoryMb)),
          0
        )
      while (used() + cost > sandboxBudget.mb) {
        const idle = [...running.entries()]
          .filter(([sandbox]) => sandbox !== this && !sandbox.#inUse())
          .sort((a, b) => a[1] - b[1])[0]?.[0]
        if (!idle) break
        idle.#retire()
      }
      // The room is taken in the same tick as the check: another waiter woken with this one sees it gone.
      if (used() + cost <= sandboxBudget.mb) {
        running.set(this, Date.now())
        this.#starting = true
        return
      }
      const left = deadline - Date.now()
      if (left <= 0) throw new SandboxError('busy')
      await waitForRoom(left)
      if (this.#stopped) throw new SandboxError('stopped')
    }
  }

  // A thread starting, or running a call, is not ended to make room.
  #inUse() {
    return this.#starting || this.#calling || this.#pending.size > 0
  }

  // Ends an idle thread to free its memory; the next call starts it again.
  #retire() {
    const worker = this.#worker
    if (worker) this.#end(worker, new SandboxError('stopped'))
  }

  async #spawn(): Promise<SandboxShape> {
    try {
      await this.#makeRoom()
    } catch (error) {
      this.#ready = null
      throw error instanceof SandboxError ? error : new SandboxError('busy')
    }
    // #makeRoom took the room: this thread counts as starting from now on.
    let worker: Worker
    try {
      worker = startThread(threadData(this.#options))
    } catch (error) {
      running.delete(this)
      this.#starting = false
      this.#ready = null
      throw new SandboxError('crashed', error instanceof Error ? error.message : String(error))
    }
    // A plugin's thread never keeps Hodi running by itself: a call holds the process with its own timer.
    worker.unref()
    this.#worker = worker
    running.set(this, Date.now())
    this.#starting = true
    return new Promise<SandboxShape>((resolve, reject) => {
      // The start (the engine, the plugin's module and its migrations) gets its own time limit too.
      const startTimer = setTimeout(() => {
        reject(new SandboxError('timeout', 'start'))
        this.#end(worker, new SandboxError('timeout'))
      }, this.#options.timeoutMs + 5_000)
      worker.on('message', (message: FromSandbox) => {
        switch (message.type) {
          case 'ready':
            clearTimeout(startTimer)
            this.#starting = false
            resolve(message.shape)
            break
          case 'failed':
            clearTimeout(startTimer)
            reject(new SandboxError('failed', message.error))
            this.#end(worker, new SandboxError('failed', message.error))
            break
          case 'result':
          case 'read-result':
            settle(this.#pending, message)
            break
          case 'host':
            void this.#answer(worker, message.id, message.method, message.args)
            break
          case 'log':
            this.#options.host.log(message.line)
            break
          case 'idle':
            clearTimeout(this.#watchdogs.get(message.id))
            this.#watchdogs.delete(message.id)
            break
          case 'fatal':
            this.#end(worker, new SandboxError(message.error === 'out_of_memory' ? 'out_of_memory' : 'timeout'))
            break
        }
      })
      worker.on('error', error => {
        clearTimeout(startTimer)
        reject(new SandboxError('crashed', error.message))
        this.#end(worker, new SandboxError('crashed', error.message))
      })
      worker.on('exit', () => {
        clearTimeout(startTimer)
        reject(new SandboxError('crashed', 'exited'))
        this.#end(worker, new SandboxError('crashed', 'exited'))
      })
    })
  }

  // The requests a plugin may make of Hodi, and nothing else.
  async #answer(worker: Worker, id: number, method: string, args: string) {
    const reply = (ok: boolean, value: string) => {
      if (this.#worker !== worker) return
      worker.postMessage({ type: 'host-reply', id, ok, value } satisfies ToSandbox)
      // The jobs the answer wakes run with a time limit in the thread; a thread that does not say it is done in time
      // is stuck, and ended from here.
      this.#watchdogs.set(
        id,
        setTimeout(() => this.#end(worker, new SandboxError('timeout')), this.#options.timeoutMs + GRACE_MS)
      )
    }
    const { ok, value } = await answerRequest(this.#options.host.requests, method, args, this.#context)
    reply(ok, value)
  }

  // A thread that is done for: every call waiting on it fails, and the next call starts a new one.
  #end(worker: Worker, error: SandboxError) {
    if (this.#worker !== worker) return
    this.#worker = null
    this.#ready = null
    this.#starting = false
    if (error.code === 'failed' || error.code === 'crashed') this.#deaths.push(Date.now())
    running.delete(this)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = null
    void worker.terminate()
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    for (const timer of this.#watchdogs.values()) clearTimeout(timer)
    this.#watchdogs.clear()
    roomFreed()
  }

  // One call into the plugin, JSON in and out. context goes to the requests its code makes meanwhile; body is a raw
  // request body. Calls wait their turn, a few at most and not for long: past that they are refused (busy).
  call(
    kind: SandboxCallKind,
    name: string,
    argument: unknown,
    context: unknown = null,
    body?: Uint8Array
  ): Promise<unknown> {
    return this.#enqueue({ kind, name, argument, context, body })
  }

  // Whether one more route call may wait now: Hodi asks before it reads a raw body for one.
  hasRoom() {
    return !this.#stopped && this.#lanes.hasRoomForCall()
  }

  // The first column of one row of a SELECT in the plugin's database, as bytes: what a zip the core builds holds. The
  // query runs in the plugin's thread, under its time limit, and the bytes never enter the plugin's engine.
  read(sql: string, params: (string | number | null)[]): Promise<Uint8Array> {
    return this.#enqueue({ kind: 'read', sql, params }) as Promise<Uint8Array>
  }

  // A copy of the plugin's database for a backup, written beside it (SNAPSHOT_SUFFIX): it waits with the hooks, and
  // runs between calls, so the copy is whole.
  async snapshot(): Promise<void> {
    await this.#enqueue({ kind: 'snapshot' })
  }

  #enqueue(job: Job): Promise<unknown> {
    if (this.#stopped) return Promise.reject(new SandboxError('stopped'))
    if (!this.#lanes.hasRoomFor(job)) return Promise.reject(new SandboxError('busy', 'too many calls waiting'))
    return new Promise((resolve, reject) => {
      this.#lanes.add(job, this.#options.maxWaitMs, resolve, reject)
      this.#next()
    })
  }

  // Runs the next waiting call when none is running: sign-ins first, then copies, then routes, then hooks.
  #next() {
    if (this.#calling) return
    const waiting = this.#lanes.next()
    if (!waiting) return
    clearTimeout(waiting.timer)
    this.#calling = true
    this.#callNow(waiting.job)
      .then(waiting.resolve, waiting.reject)
      .finally(() => {
        this.#calling = false
        this.#next()
      })
  }

  async #callNow(job: Job): Promise<unknown> {
    await this.start()
    const worker = this.#worker
    if (!worker) throw new SandboxError('crashed')
    this.#context = job.kind === 'read' || job.kind === 'snapshot' ? null : job.context
    running.set(this, Date.now())
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = null
    const id = this.#nextCall++
    const value = await new Promise<string | Uint8Array>((resolve, reject) => {
      // The thread checks its own time, but a stuck thread is ended from here too.
      const timer = setTimeout(() => this.#end(worker, new SandboxError('timeout')), this.#options.timeoutMs + GRACE_MS)
      this.#pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
      postJob(worker, id, job, () => this.#options.host.settings())
    }).finally(() => {
      this.#context = null
      roomFreed()
      if (this.#worker !== worker) return
      running.set(this, Date.now())
      this.#idleTimer = setTimeout(() => this.#retire(), this.#options.idleMs)
      this.#idleTimer.unref()
    })
    return typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  }

  async stop() {
    this.#stopped = true
    for (const waiting of this.#lanes.drain()) {
      clearTimeout(waiting.timer)
      waiting.reject(new SandboxError('stopped'))
    }
    const worker = this.#worker
    if (worker) this.#end(worker, new SandboxError('stopped'))
  }
}
