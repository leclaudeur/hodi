import { parentPort, workerData } from 'node:worker_threads'
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle } from 'quickjs-emscripten'
import type { FromSandbox, SandboxData, ToSandbox } from './protocol.ts'
import { type PluginDatabase, openDatabase, readBytes, runMigrations, snapshotDatabase } from './worker-database.ts'
import { installBridge } from './worker-bridge.ts'
import { type Clock, Fatal, errorText, jobsOf, loadPlugin, newEngine } from './worker-engine.ts'

// One plugin's server code, in a QuickJS engine compiled to WebAssembly, in a thread of its own. The plugin sees
// standard JavaScript and the ctx that the prelude builds (worker-scripts.ts), nothing else: no Node module, no
// process, no network, no file. Its database is a SQLite file of its own, opened here in a SQLite compiled to
// WebAssembly too (sqlite-wasm.ts), which its SQL reaches through the guard.

const data = workerData as SandboxData
const port = parentPort!
const send = (message: FromSandbox) => port.postMessage(message)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// A value the core reads for a zip it builds, sent straight to the main thread without entering the engine.
const read = (database: PluginDatabase, id: number, sql: string, params: string) => {
  try {
    const copy = readBytes(database, sql, params)
    port.postMessage({ type: 'read-result', id, ok: true, bytes: copy } satisfies FromSandbox, [copy.buffer])
  } catch (error) {
    send({ type: 'read-result', id, ok: false, error: messageOf(error) })
  }
}

// A backup's copy runs between calls, in one go: the copy is whole, whatever the plugin's code does next.
const snapshot = (database: PluginDatabase, id: number) => {
  try {
    snapshotDatabase(database, data)
    send({ type: 'result', id, ok: true, value: 'null' })
  } catch (error) {
    send({ type: 'result', id, ok: false, value: messageOf(error) })
  }
}

interface Engine {
  vm: QuickJSContext
  clock: Clock
  pump: () => void
  settle: (promise: QuickJSHandle) => Promise<string>
}

// Calls into the plugin, one at a time, each with its own deadline.
const callerOf = ({ vm, clock, settle }: Engine) => {
  const state = { calling: false }
  const run = async (kind: string, name: string, argument: string, settings: string, body?: Uint8Array) => {
    state.calling = true
    const fn = vm.getProp(vm.global, '__hodiRun')
    const handles = [kind, name, argument, settings].map(text => vm.newString(text))
    if (body) handles.push(vm.newArrayBuffer(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)))
    clock.deadline = Date.now() + data.timeoutMs
    clock.interrupted = false
    try {
      const called = vm.callFunction(fn, vm.undefined, ...handles)
      if (called.error) {
        const message = errorText(vm, called.error)
        if (clock.interrupted) throw new Fatal('timeout')
        throw new Error(message)
      }
      const text = await settle(called.value)
      if (text.length > data.maxResultBytes) throw new Error('result_too_large')
      return text
    } finally {
      fn.dispose()
      handles.forEach(handle => handle.dispose())
      clock.deadline = Number.POSITIVE_INFINITY
      state.calling = false
    }
  }
  return { run, state }
}

// The main thread's answer to a request of the plugin's code: its promise settles, and the jobs it wakes run.
const answerHost = (
  { vm, clock, pump }: Engine,
  pendingHost: Map<number, QuickJSDeferredPromise>,
  message: Extract<ToSandbox, { type: 'host-reply' }>,
  calling: boolean
) => {
  const deferred = pendingHost.get(message.id)
  if (!deferred) return
  pendingHost.delete(message.id)
  if (message.ok) vm.newString(message.value).consume(value => deferred.resolve(value))
  else vm.newError(message.value).consume(error => deferred.reject(error))
  deferred.dispose()
  // An answer that comes after its call is over (work a hook left running) gets a time limit of its own.
  const background = !calling
  if (background) {
    clock.deadline = Date.now() + data.timeoutMs
    clock.interrupted = false
  }
  try {
    pump()
    send({ type: 'idle', id: message.id })
  } catch (error) {
    send({ type: 'fatal', error: messageOf(error) })
  } finally {
    if (background) clock.deadline = Number.POSITIVE_INFINITY
  }
}

const start = async () => {
  const clock: Clock = { deadline: Number.POSITIVE_INFINITY, interrupted: false }
  const { runtime, vm } = await newEngine(data, clock)
  const database = openDatabase(data)
  const pendingHost = installBridge(vm, { data, database, send })
  const engine: Engine = { vm, clock, ...jobsOf(runtime, vm, clock) }
  const shape = await loadPlugin(vm, { data, clock, settle: engine.settle })
  runMigrations(database, shape.migrations)

  const { run, state } = callerOf(engine)
  let calls: Promise<void> = Promise.resolve()
  port.on('message', (message: ToSandbox) => {
    if (message.type === 'host-reply') return answerHost(engine, pendingHost, message, state.calling)
    if (message.type === 'read') return read(database, message.id, message.sql, message.params)
    if (message.type === 'snapshot') return snapshot(database, message.id)
    calls = calls.then(() =>
      run(message.kind, message.name, message.argument, message.settings, message.body).then(
        value => send({ type: 'result', id: message.id, ok: true, value }),
        (error: unknown) => {
          const text = messageOf(error)
          if (error instanceof Fatal) send({ type: 'fatal', error: text })
          else send({ type: 'result', id: message.id, ok: false, value: text })
        }
      )
    )
  })

  send({ type: 'ready', shape: { ...shape, migrations: shape.migrations.length } })
}

start().catch((error: unknown) => send({ type: 'failed', error: messageOf(error) }))
