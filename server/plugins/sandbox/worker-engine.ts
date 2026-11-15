import {
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  RELEASE_SYNC,
  newQuickJSWASMModuleFromVariant,
  newVariant
} from 'quickjs-emscripten'
import type { SandboxData, SandboxShape } from './protocol.ts'
import { PRELUDE, RUNTIME } from './worker-scripts.ts'

// The QuickJS engine a plugin's code runs in (worker.ts): its memory, its clock, the modules it may import, and
// settling what the plugin's code returns.

export class Fatal extends Error {}

// What the engine's WebAssembly build starts with.
const ENGINE_BASE_BYTES = 16 * 1024 * 1024
// The server's TypeScript settings leave out the DOM library, where WebAssembly's types live.
type WasmMemoryConstructor = new (descriptor: { initial: number; maximum: number }) => object

// When the running code must stop, and whether the engine stopped it for that.
export interface Clock {
  deadline: number
  interrupted: boolean
}

export const errorText = (vm: QuickJSContext, handle: QuickJSHandle) => {
  const dumped: unknown = vm.dump(handle)
  handle.dispose()
  if (typeof dumped === 'object' && dumped !== null && 'message' in dumped) return String(dumped.message)
  return String(dumped)
}

export const newEngine = async (data: SandboxData, clock: Clock) => {
  // The engine's own memory limit counts each allocation but not what it keeps (its build cannot measure a block), so
  // the real ceiling is the WebAssembly memory itself: the engine starts with 16 MiB and may grow by the plugin's budget.
  // Past it, an allocation fails and the plugin's code gets "out of memory".
  const pages = (bytes: number) => Math.ceil(bytes / 65_536)
  const wasmMemory = new (
    globalThis as unknown as { WebAssembly: { Memory: WasmMemoryConstructor } }
  ).WebAssembly.Memory({
    initial: pages(ENGINE_BASE_BYTES),
    maximum: pages(ENGINE_BASE_BYTES + data.memoryBytes)
  })
  const QuickJS = await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmMemory }))
  const runtime: QuickJSRuntime = QuickJS.newRuntime()
  runtime.setMemoryLimit(data.memoryBytes)
  runtime.setMaxStackSize(512 * 1024)
  runtime.setInterruptHandler(() => {
    if (Date.now() <= clock.deadline) return false
    clock.interrupted = true
    return true
  })
  runtime.setModuleLoader(
    name => {
      if (name === 'plugin') return data.source
      if (name === 'hodi:prelude') return PRELUDE
      if (name === 'hodi:runtime') return RUNTIME
      // A plugin bundles what it uses: nothing else can be imported.
      throw new Error(`cannot import ${name}`)
    },
    (base, requested) => {
      // Hodi's own modules are for Hodi's code: the plugin reaches what they hold through its ctx only.
      if (base === 'plugin' && requested.startsWith('hodi:')) return { error: new Error(`cannot import ${requested}`) }
      return requested
    }
  )
  return { runtime, vm: runtime.newContext() }
}

// Running the engine's pending jobs, and settling a promise handle of the plugin as host answers come in.
export const jobsOf = (runtime: QuickJSRuntime, vm: QuickJSContext, clock: Clock) => {
  const pump = () => {
    const done = runtime.executePendingJobs()
    if (done.error) {
      const message = errorText(vm, done.error)
      if (clock.interrupted) throw new Fatal('timeout')
      if (/out of memory/i.test(message)) throw new Fatal('out_of_memory')
    }
  }

  const settle = async (promise: QuickJSHandle): Promise<string> => {
    const native = vm.resolvePromise(promise)
    promise.dispose()
    pump()
    const result = await native
    if (result.error) {
      const message = errorText(vm, result.error)
      if (clock.interrupted) throw new Fatal('timeout')
      if (/out of memory/i.test(message)) throw new Fatal('out_of_memory')
      throw new Error(message)
    }
    const text = vm.typeof(result.value) === 'string' ? vm.getString(result.value) : 'null'
    result.value.dispose()
    return text
  }

  return { pump, settle }
}

export type PluginShape = Omit<SandboxShape, 'migrations'> & { migrations: string[] }

// The prelude first, on its own: it takes the bridge off globalThis before any line of the plugin runs, so that the
// plugin only ever holds the ctx built over it. Then the plugin's module, and the runtime that reaches into it.
export const loadPlugin = async (
  vm: QuickJSContext,
  { data, clock, settle }: { data: SandboxData; clock: Clock; settle: (promise: QuickJSHandle) => Promise<string> }
): Promise<PluginShape> => {
  clock.deadline = Date.now() + data.timeoutMs
  const prelude = vm.evalCode(`import 'hodi:prelude'`, 'hodi-prelude.js', { type: 'module' })
  if (prelude.error) throw new Error(errorText(vm, prelude.error))
  await settle(prelude.value)
  const loaded = vm.evalCode(`import 'hodi:runtime'`, 'hodi-start.js', { type: 'module' })
  if (loaded.error) throw new Error(errorText(vm, loaded.error))
  await settle(loaded.value)
  clock.deadline = Number.POSITIVE_INFINITY

  const describe = vm.getProp(vm.global, '__hodiDescribe')
  const described = vm.callFunction(describe, vm.undefined)
  describe.dispose()
  if (described.error) throw new Error(errorText(vm, described.error))
  const shape = JSON.parse(vm.getString(described.value)) as PluginShape
  described.value.dispose()
  return shape
}
