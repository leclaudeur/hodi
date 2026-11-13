import { randomBytes } from 'node:crypto'
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle } from 'quickjs-emscripten'
import { SqlRefused, checkPluginSql } from './sql-guard.ts'
import type { FromSandbox, SandboxData } from './protocol.ts'
import { type PluginDatabase, plainParams } from './worker-database.ts'

// The bridge the prelude takes off globalThis (worker-scripts.ts): the few functions through which the plugin's code
// reaches its database, its log, Hodi's main thread and random bytes.

const LOG_LINES = 200

// The values going in and out of the engine, for one plugin's engine and database.
const valuesOf = (vm: QuickJSContext) => {
  const stringArgument = (handle: QuickJSHandle | undefined) => {
    if (!handle || vm.typeof(handle) !== 'string') throw new SqlRefused('invalid_argument')
    return vm.getString(handle)
  }
  // The values of a statement: JSON, then the places of its BLOBs and their bytes (the prelude's pack()).
  const paramsOf = (handle: QuickJSHandle | undefined, places: QuickJSHandle | undefined, buffers: QuickJSHandle[]) => {
    const params = plainParams(stringArgument(handle))
    const at: unknown = JSON.parse(stringArgument(places))
    if (!Array.isArray(at) || at.length !== buffers.length) throw new SqlRefused('invalid_params')
    at.forEach((place: unknown, index) => {
      if (!Number.isInteger(place) || (place as number) < 0 || (place as number) >= params.length) {
        throw new SqlRefused('invalid_params')
      }
      const buffer = buffers[index]!
      if (vm.typeof(buffer) !== 'object') throw new SqlRefused('invalid_params')
      const bytes = vm.getArrayBuffer(buffer)
      params[place as number] = bytes.value.slice()
      bytes.dispose()
    })
    return params
  }
  return { stringArgument, paramsOf }
}

// Rows go back as JSON, and their BLOBs apart (unpack() in the prelude puts them back). A big integer becomes a
// number when it fits, text otherwise.
const rowsOut = (vm: QuickJSContext, rows: Record<string, unknown>[]) => {
  const places: [number, string][] = []
  const buffers: Uint8Array[] = []
  rows.forEach((row, index) => {
    for (const [column, value] of Object.entries(row)) {
      if (!(value instanceof Uint8Array)) continue
      places.push([index, column])
      buffers.push(value)
      row[column] = null
    }
  })
  const text = JSON.stringify(rows, (_key, value: unknown) =>
    typeof value === 'bigint' ? (Number.isSafeInteger(Number(value)) ? Number(value) : String(value)) : value
  )
  const out = vm.newArray()
  vm.newString(text).consume(handle => vm.setProp(out, 0, handle))
  vm.newString(JSON.stringify(places)).consume(handle => vm.setProp(out, 1, handle))
  buffers.forEach((bytes, index) =>
    vm
      .newArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      .consume(handle => vm.setProp(out, index + 2, handle))
  )
  return out
}

// A plugin logs at most LOG_LINES lines a minute; what it logs beyond is counted and said once the minute is over.
// The minute starts at its first line, not on the clock's minute: a flood across 12:00:00 would otherwise keep
// twice as many.
const logLimiter = (send: (message: FromSandbox) => void) => {
  let logWindow = 0
  let logged = 0
  let dropped = 0
  return (line: () => string) => {
    const now = Date.now()
    if (now - logWindow >= 60_000) {
      if (dropped > 0) send({ type: 'log', line: `(${dropped} lines not kept: more than ${LOG_LINES} a minute)` })
      logWindow = now
      logged = 0
      dropped = 0
    }
    if (logged >= LOG_LINES) {
      dropped += 1
      return
    }
    logged += 1
    send({ type: 'log', line: line() })
  }
}

const addDatabase = (vm: QuickJSContext, bridge: QuickJSHandle, database: PluginDatabase) => {
  const { stringArgument, paramsOf } = valuesOf(vm)
  // A plugin's own mistake (a refused statement, a bad table) becomes an exception in its code, never Hodi's.
  const guarded = (work: () => QuickJSHandle) => {
    try {
      return work()
    } catch (error) {
      return { error: vm.newError(error instanceof Error ? error.message : String(error)) }
    }
  }
  vm.newFunction('dbQuery', (sql, params, places, ...buffers) =>
    guarded(() =>
      rowsOut(
        vm,
        database.all(checkPluginSql(stringArgument(sql)), paramsOf(params, places, buffers)) as Record<
          string,
          unknown
        >[]
      )
    )
  ).consume(fn => vm.setProp(bridge, 'dbQuery', fn))
  vm.newFunction('dbRun', (sql, params, places, ...buffers) =>
    guarded(() => {
      const { changes, lastInsertRowid } = database.run(
        checkPluginSql(stringArgument(sql)),
        paramsOf(params, places, buffers)
      )
      return vm.newString(JSON.stringify({ changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) }))
    })
  ).consume(fn => vm.setProp(bridge, 'dbRun', fn))
}

// Puts the bridge on globalThis. Calls that Hodi's main thread answers (the network) are promises in the plugin,
// settled when the answer comes: they wait in the map returned.
export const installBridge = (
  vm: QuickJSContext,
  { data, database, send }: { data: SandboxData; database: PluginDatabase; send: (message: FromSandbox) => void }
) => {
  const { stringArgument } = valuesOf(vm)
  const bridge = vm.newObject()
  vm.newString(data.id).consume(id => vm.setProp(bridge, 'id', id))
  vm.newString(JSON.stringify(data.objects)).consume(objects => vm.setProp(bridge, 'objects', objects))
  addDatabase(vm, bridge, database)
  const log = logLimiter(send)
  vm.newFunction('log', message => {
    if (!message || vm.typeof(message) !== 'string') return
    log(() => vm.getString(message).slice(0, 2000))
  }).consume(fn => vm.setProp(bridge, 'log', fn))

  let nextHostCall = 0
  const pendingHost = new Map<number, QuickJSDeferredPromise>()
  vm.newFunction('host', (method, argumentsText) => {
    const deferred = vm.newPromise()
    const id = nextHostCall++
    pendingHost.set(id, deferred)
    send({ type: 'host', id, method: stringArgument(method), args: stringArgument(argumentsText) })
    return deferred.handle
  }).consume(fn => vm.setProp(bridge, 'host', fn))
  // Bytes for crypto.getRandomValues in the prelude, which checks the length first.
  vm.newFunction('randomBytes', length => {
    const size = Math.min(Math.max(Math.trunc(vm.typeof(length) === 'number' ? vm.getNumber(length) : 0), 0), 65536)
    const bytes = randomBytes(size)
    return vm.newArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }).consume(fn => vm.setProp(bridge, 'randomBytes', fn))
  vm.setProp(vm.global, '__hodi', bridge)
  bridge.dispose()
  return pendingHost
}
