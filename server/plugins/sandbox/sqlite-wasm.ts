import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Database as WasmDatabase } from 'node-sqlite3-wasm'

// A plugin's SQLite runs in WebAssembly, not in Node's native node:sqlite: a native query cannot be stopped from
// JavaScript (worker.terminate() waits for it, forever for an endless WITH RECURSIVE), while WebAssembly stops when the
// thread is ended. The package's loader is run here, not imported, for two reasons:
// - its heap may grow to 2 GiB; the loader runs with a lower ceiling, so a query that asks for more fails with "out of
//   memory" in the plugin's code instead of taking Hodi's memory;
// - its files go through node:fs, which could reach any file; the loader gets an fs that opens only the plugin's
//   database and the files SQLite keeps beside it, so even SQL past the guard (an ATTACH) cannot open another file.

// Where a backup's copy of the database is written, beside it (« Sauvegardes »).
export const SNAPSHOT_SUFFIX = '.backup'

// The build starts with 16 MiB; this is the most it may grow to.
export const SQLITE_HEAP_BYTES = 32 * 1024 * 1024

// The loader that was read and changed here (node-sqlite3-wasm 0.8.61, pinned): another one does not run.
const LOADER_SHA256 = 'c69e2d5015a19ba98a073cda9a4c01a112064fc4bcb3d220f9dd1f53b96b1998'
const WASM_SHA256 = '5ce628dcb9bbb6cf7d22a5ed44685607c657e56eeeb51635e1c8ba18df1e22d4'
const MARKER = 'getHeapMax=()=>2147483648'

export type { WasmDatabase }

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

// node:fs as the loader uses it, with every path it names checked first. Calls on an open file (by descriptor) pass:
// the only descriptors it has come from openSync, which allows only the database's own files.
const confinedFs = (allowed: Set<string>, wasmFile: string) => {
  const check = (target: unknown) => {
    const resolved = path.resolve(String(target))
    if (!allowed.has(resolved)) throw Object.assign(new Error(`EACCES: ${resolved}`), { code: 'EACCES' })
    return resolved
  }
  return {
    constants: fs.constants,
    openSync: (target: string, flags: number, mode?: number) =>
      // A symbolic link in place of the database is not followed.
      fs.openSync(check(target), flags | fs.constants.O_NOFOLLOW, mode),
    accessSync: (target: string, mode?: number) => fs.accessSync(check(target), mode),
    unlinkSync: (target: string) => fs.unlinkSync(check(target)),
    mkdirSync: (target: string) => fs.mkdirSync(check(target)),
    rmdirSync: (target: string) => fs.rmdirSync(check(target)),
    // The loader reads its own .wasm file, and nothing else.
    readFileSync: (target: string | URL, encoding?: BufferEncoding) => {
      const file = target instanceof URL ? target.pathname : target
      if (path.resolve(file) !== wasmFile) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return encoding ? fs.readFileSync(wasmFile, encoding) : fs.readFileSync(wasmFile)
    },
    readSync: fs.readSync,
    writeSync: fs.writeSync,
    closeSync: fs.closeSync,
    fstatSync: fs.fstatSync,
    fsyncSync: fs.fsyncSync,
    ftruncateSync: fs.ftruncateSync
  }
}

export const loadSqliteWasm = (dbFile: string, heapBytes = SQLITE_HEAP_BYTES): { Database: typeof WasmDatabase } => {
  const require = createRequire(import.meta.url)
  const file = require.resolve('node-sqlite3-wasm')
  const wasmFile = path.join(path.dirname(file), 'node-sqlite3-wasm.wasm')
  const source = fs.readFileSync(file, 'utf8')
  if (sha256(source) !== LOADER_SHA256 || sha256(fs.readFileSync(wasmFile)) !== WASM_SHA256) {
    throw new Error('sqlite_wasm_unexpected_build')
  }
  // The database's own files: the file, its journals, the lock folder the package makes beside it, and the copy a
  // backup asks for (snapshot, then moved out by the main thread). The folder is resolved through its links once,
  // here, so that the names SQLite uses match.
  const database = databasePath(dbFile)
  const allowed = new Set(
    [
      '',
      '-journal',
      '-wal',
      '-shm',
      '.lock',
      SNAPSHOT_SUFFIX,
      `${SNAPSHOT_SUFFIX}-journal`,
      `${SNAPSHOT_SUFFIX}.lock`
    ].map(suffix => `${database}${suffix}`)
  )
  const nodeRequire = createRequire(file)
  const loaderRequire = (name: string) => {
    if (name === 'node:fs') return confinedFs(allowed, wasmFile)
    if (name === 'node:path' || name === 'node:crypto') return nodeRequire(name) as unknown
    throw new Error(`cannot require ${name}`)
  }
  const module = { exports: {} as { Database: typeof WasmDatabase } }
  // The loader is the package's own CommonJS file, run as Node would run it, with one constant changed.
  const load = new Function(
    'module',
    'exports',
    'require',
    '__dirname',
    '__filename',
    source.replace(MARKER, `getHeapMax=()=>${heapBytes}`)
  )
  load(module, module.exports, loaderRequire, path.dirname(file), file)
  return module.exports
}

// The path the database must be opened with, so that it matches what the confined fs allows.
export const databasePath = (dbFile: string) =>
  path.join(fs.realpathSync(path.dirname(path.resolve(dbFile))), path.basename(dbFile))
