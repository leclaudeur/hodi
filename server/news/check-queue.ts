// Readability checks run a few at a time. What the reader waits for goes first; the periodic pass over every topic
// leaves room for it.
const CHECK_CONCURRENCY = 4
const BACKGROUND_CONCURRENCY = 2

interface Pass {
  startedAt: number
  listing: boolean
  checked: number
  extracted: number
  extractMs: number
  slowestMs: number
}

export class CheckQueue {
  readonly #check: (itemId: string) => Promise<unknown>
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #queue: string[] = []
  // Checks of the periodic pass, started only when nothing the reader asked for waits.
  readonly #background: string[] = []
  readonly #queued = new Set<string>()
  #active = 0
  // What the current periodic pass has checked so far, logged when it is done.
  #pass: Pass | null = null
  #idleWaiters: (() => void)[] = []

  constructor(check: (itemId: string) => Promise<unknown>, now: () => number, log: (message: string) => void) {
    this.#check = check
    this.#now = now
    this.#log = log
  }

  add(itemId: string, background = false) {
    if (this.#queued.has(itemId)) {
      // The reader now waits for an article the periodic pass had queued: it goes first.
      const index = background ? -1 : this.#background.indexOf(itemId)
      if (index >= 0) {
        this.#background.splice(index, 1)
        this.#queue.push(itemId)
        this.#pump()
      }
      return
    }
    this.#queued.add(itemId)
    ;(background ? this.#background : this.#queue).push(itemId)
    this.#pump()
  }

  // Resolves once every queued check has finished.
  whenIdle() {
    if (this.#isIdle()) return Promise.resolve()
    return new Promise<void>(resolve => this.#idleWaiters.push(resolve))
  }

  // A periodic pass lists every topic, queueing its checks, then ends once the last one is done.
  async pass(listAll: () => Promise<unknown>) {
    const pass = (this.#pass ??= {
      startedAt: this.#now(),
      listing: true,
      checked: 0,
      extracted: 0,
      extractMs: 0,
      slowestMs: 0
    })
    pass.listing = true
    try {
      await listAll()
    } finally {
      pass.listing = false
      this.#endPassIfDone()
    }
  }

  // How long one article's extraction took, during a pass.
  recordExtraction(ms: number) {
    if (!this.#pass) return
    this.#pass.extracted++
    this.#pass.extractMs += ms
    this.#pass.slowestMs = Math.max(this.#pass.slowestMs, ms)
  }

  #isIdle() {
    return this.#active === 0 && this.#queue.length === 0 && this.#background.length === 0
  }

  #next() {
    if (this.#active < CHECK_CONCURRENCY && this.#queue.length > 0) return this.#queue
    if (this.#active < BACKGROUND_CONCURRENCY && this.#background.length > 0) return this.#background
    return null
  }

  #pump() {
    for (let queue = this.#next(); queue; queue = this.#next()) {
      const itemId = queue.shift() as string
      const background = queue === this.#background
      this.#active++
      void this.#check(itemId).finally(() => {
        this.#active--
        this.#queued.delete(itemId)
        if (background && this.#pass) this.#pass.checked++
        this.#pump()
      })
    }
    if (this.#isIdle()) this.#idleWaiters.splice(0).forEach(resolve => resolve())
    this.#endPassIfDone()
  }

  // Logs what the pass cost once its last check is done: the extraction time tells whether it needs its own thread.
  #endPassIfDone() {
    const pass = this.#pass
    if (!pass || pass.listing || this.#background.length > 0 || this.#active > 0) return
    this.#pass = null
    if (pass.checked === 0) return
    const seconds = Math.round((this.#now() - pass.startedAt) / 1000)
    const average = pass.extracted > 0 ? Math.round(pass.extractMs / pass.extracted) : 0
    this.#log(
      `Background checks: ${pass.checked} articles in ${seconds} s, extraction ${average} ms on average, ${Math.round(pass.slowestMs)} ms at most`
    )
  }
}
