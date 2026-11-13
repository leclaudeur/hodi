import type express from 'express'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { reserveIo } from './io-budget.ts'
import { MAX_READ_BYTES } from './sandbox/protocol.ts'

// A zip a plugin's route answers with: the plugin lists its files, and Hodi builds the archive and sends it. A file is
// text the plugin gives, or a value Hodi reads from the plugin's database (a SELECT whose first column is the file), so
// that big files (screenshots) never pass through the plugin's engine. Hodi writes every header: the type is always a
// zip and the name is cleaned, so nothing the plugin says can make the browser run it.

type SqlParam = string | number | null

export type ZipEntry = { path: string; text: string } | { path: string; blob: { sql: string; params: SqlParam[] } }

export interface PluginZip {
  filename: string
  entries: ZipEntry[]
}

export const MAX_ZIP_ENTRIES = 2_000
// Zips being sent at once across the server, the slice written before waiting for the client, and how long a client
// that stops reading keeps its download (tests change these).
export const zipLimits = { running: 2, sliceBytes: 1024 * 1024, idleMs: 30_000 }
let sending = 0

// Takes a place to send a zip, and room in the plugins' I/O budget for its biggest file and a slice; null when there
// is none (the caller answers 503). The returned function gives both back.
export const takeZipRoom = (): (() => void) | null => {
  if (sending >= zipLimits.running) return null
  const release = reserveIo(MAX_READ_BYTES + zipLimits.sliceBytes)
  if (!release) return null
  sending += 1
  let done = false
  return () => {
    if (done) return
    done = true
    sending -= 1
    release()
  }
}
// What a whole archive may hold, its files counted before compression.
export const MAX_ZIP_BYTES = 256 * 1024 * 1024
// A path inside the archive: up to five folders, plain names, nothing that climbs out or starts at the root.
const ZIP_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\/){0,4}[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/

// The name the browser saves: letters, digits, dot, dash and underscore only, ending in .zip.
export const zipFileName = (name: unknown) => {
  const plain = (typeof name === 'string' ? name : '')
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 100)
  return `${plain || 'export'}.zip`
}

const isParam = (value: unknown) => value === null || ['string', 'number'].includes(typeof value)

// The zip a handler answered with, checked; null when it is not a valid one.
export const zipOf = (value: unknown): PluginZip | null => {
  if (typeof value !== 'object' || value === null) return null
  const { filename, entries } = value as { filename?: unknown; entries?: unknown }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) return null
  const paths = new Set<string>()
  const checked: ZipEntry[] = []
  for (const entry of entries as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null
    const { path, text, blob } = entry as { path?: unknown; text?: unknown; blob?: unknown }
    if (typeof path !== 'string' || !ZIP_PATH.test(path) || path.split('/').includes('..') || paths.has(path)) {
      return null
    }
    paths.add(path)
    if (typeof text === 'string' && blob === undefined) {
      checked.push({ path, text })
      continue
    }
    if (text !== undefined || typeof blob !== 'object' || blob === null) return null
    const { sql, params = [] } = blob as { sql?: unknown; params?: unknown }
    if (typeof sql !== 'string' || !Array.isArray(params) || !params.every(isParam)) return null
    checked.push({ path, blob: { sql, params: params as SqlParam[] } })
  }
  return { filename: zipFileName(filename), entries: checked }
}

// Sends the archive as it is built, one file at a time. read() gets a database value from the plugin's thread. A
// failure once bytes have left ends the download, which the browser shows as failed.
export const sendZip = async (
  response: express.Response,
  zip: PluginZip,
  read: (sql: string, params: SqlParam[]) => Promise<Uint8Array>,
  // From takeZipRoom(): given back once the zip is sent or dropped.
  release: () => void
) => {
  response.status(200)
  response.set('Content-Type', 'application/zip')
  response.set('Content-Disposition', `attachment; filename="${zip.filename}"`)
  response.set('Cache-Control', 'no-store')
  let failed = false
  const archive = new Zip((error, chunk, final) => {
    if (error || failed) {
      failed = true
      return
    }
    response.write(chunk)
    if (final) response.end()
  })
  // What was written leaves before more is: a client that stops reading holds one slice, and loses its download
  // after idleMs.
  const drained = async () => {
    if (response.destroyed) throw new Error('closed')
    if (!response.writableNeedDrain) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        response.off('drain', done)
        reject(new Error('client_idle'))
      }, zipLimits.idleMs)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      response.once('drain', done)
    })
  }
  let total = 0
  try {
    for (const entry of zip.entries) {
      const bytes =
        'text' in entry ? new TextEncoder().encode(entry.text) : await read(entry.blob.sql, entry.blob.params)
      total += bytes.byteLength
      if (total > MAX_ZIP_BYTES) throw new Error('zip_too_large')
      // Text compresses; pictures and the like are stored as they are.
      const file = 'text' in entry ? new ZipDeflate(entry.path, { level: 6 }) : new ZipPassThrough(entry.path)
      archive.add(file)
      if (bytes.byteLength === 0) file.push(bytes, true)
      for (let at = 0; at < bytes.byteLength; at += zipLimits.sliceBytes) {
        const end = Math.min(at + zipLimits.sliceBytes, bytes.byteLength)
        file.push(bytes.subarray(at, end), end === bytes.byteLength)
        await drained()
      }
    }
    archive.end()
  } catch (error) {
    failed = true
    archive.terminate()
    // The connection itself goes: a client that stopped reading keeps nothing open on Hodi's side.
    response.socket?.destroy()
    response.destroy()
    throw error
  } finally {
    release()
  }
}
