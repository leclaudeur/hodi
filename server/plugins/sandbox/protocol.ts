// The messages between Hodi's main thread and a plugin's sandbox thread (worker.ts). Everything crosses as text, but
// bytes: a request's raw body, and a BLOB the core reads for a zip.

// The most one value read for a zip may hold.
export const MAX_READ_BYTES = 16 * 1024 * 1024

export interface SandboxData {
  id: string
  // The plugin's server.js, an ES module that bundles what it uses.
  source: string
  // Its own SQLite file.
  dbFile: string
  memoryBytes: number
  // The most its database file may hold.
  databaseBytes: number
  timeoutMs: number
  maxResultBytes: number
  // The ctx objects its manifest gives it (mail…): one it was not given does not exist in its ctx at all.
  objects: string[]
}

// What the plugin exports, as the sandbox found it.
export interface SandboxShape {
  migrations: number
  routes: string[]
  serverRoutes: string[]
  publicRoutes: string[]
  hooks: string[]
  // Its scheduled tasks, each with how many minutes apart it runs.
  tasks: Record<string, number>
  // Its feeds, by key: what each lists for « Sources proposées » (manifest.feeds).
  feeds: string[]
  // Its actions behind an AiButton, by name (ctx.ai works only in them).
  aiActions: string[]
  // The routes that take a raw body (an image…), with the most bytes each accepts.
  rawRoutes: Record<string, number>
  // The routes Hodi runs only once the person typed their own password (and code) on that very request, as
  // '<group> <METHOD> <path>'.
  proofRoutes: string[]
}

export type SandboxCallKind = 'routes' | 'serverRoutes' | 'publicRoutes' | 'hook' | 'task' | 'feed' | 'aiAction'

export type ToSandbox =
  | {
      type: 'call'
      id: number
      kind: SandboxCallKind
      name: string
      argument: string
      settings: string
      // A raw request body, handed to the handler as request.body (a Uint8Array).
      body?: Uint8Array
    }
  // One value the core reads from the plugin's database for a zip: a SELECT whose first column is the file.
  | { type: 'read'; id: number; sql: string; params: string }
  // A consistent copy of the plugin's database for a backup, written beside it (SNAPSHOT_SUFFIX).
  | { type: 'snapshot'; id: number }
  | { type: 'host-reply'; id: number; ok: boolean; value: string }

export type FromSandbox =
  | { type: 'ready'; shape: SandboxShape }
  | { type: 'failed'; error: string }
  | { type: 'result'; id: number; ok: boolean; value: string }
  | { type: 'read-result'; id: number; ok: boolean; bytes?: Uint8Array; error?: string }
  | { type: 'host'; id: number; method: string; args: string }
  | { type: 'log'; line: string }
  // The jobs that a host reply woke have all run.
  | { type: 'idle'; id: number }
  // The engine ran out of time or memory: its state cannot be trusted, the thread is ended and started again.
  | { type: 'fatal'; error: string }
