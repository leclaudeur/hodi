import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isMainThread } from 'node:worker_threads'

// Loaded with --import before the tests: every folder a test makes with tmpdir() lands in one folder of this run,
// removed when the process exits, so test runs never pile up in the system's temp folder. The plugin sandbox's
// worker threads load it too, and leave the folder to the process that made it.
if (isMainThread) {
  const runDir = mkdtempSync(path.join(tmpdir(), 'hodi-test-'))
  process.env.TMPDIR = runDir
  process.env.TEMP = runDir
  process.env.TMP = runDir
  process.on('exit', () => rmSync(runDir, { recursive: true, force: true }))
}
