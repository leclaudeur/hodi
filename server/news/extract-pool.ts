import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Piscina } from 'piscina'
import type { ExtractedArticle } from './extract.ts'

// Turns an article's page into its text: 50 ms for a usual page, up to a second for a heavy one.
export type ExtractPage = (html: string, url: string) => Promise<ExtractedArticle | null>

// One thread, which stops after a minute without a page: an idle server keeps its memory.
const IDLE_MS = 60_000

// The worker as tests run it (TypeScript) or as the build ships it (JavaScript).
const workerFile = () => {
  const here = fileURLToPath(import.meta.url)
  return path.join(path.dirname(here), `extract-worker${path.extname(here)}`)
}

// Readability runs on a thread of its own: on the main one, every request would wait while it reads a page, and the
// background checks read hundreds of them.
export const createExtractPool = () => {
  const pool = new Piscina({ filename: workerFile(), minThreads: 0, maxThreads: 1, idleTimeout: IDLE_MS })
  const extract: ExtractPage = (html, url) => pool.run({ html, url })
  return { extract, close: () => pool.close() }
}
