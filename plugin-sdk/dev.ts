import { readFileSync, watch } from 'node:fs'
import path from 'node:path'
import { type BuiltPlugin, buildPlugin } from './build.ts'

// hodi-plugin dev [plugin folder] --server <Hodi's address> --code <code>: builds the plugin, sends it to a Hodi whose
// server admin turned on Serveur › Plugins › Mode développeur, waits for Hodi to restart with it, then prints its log.
// Each save in the folder does it again. The code may come from HODI_DEV_CODE instead, to keep it out of the shell's
// history.

export interface DevOptions {
  folder: string
  server: string
  code: string
}

const usage = 'Usage: hodi-plugin dev [plugin folder] --server http://localhost:3000 --code <code>'

export const devOptions = (args: string[], env: Record<string, string | undefined> = process.env): DevOptions => {
  const valueOf = (flag: string) => {
    const at = args.indexOf(flag)
    if (at === -1) return undefined
    const value = args[at + 1]
    if (!value || value.startsWith('-')) throw new Error(usage)
    return value
  }
  const server = valueOf('--server')
  const code = valueOf('--code') ?? env.HODI_DEV_CODE
  const folders = args.filter(
    (arg, index) => !arg.startsWith('-') && !['--server', '--code'].includes(args[index - 1] ?? '')
  )
  if (!server || !code || folders.length > 1) throw new Error(usage)
  let url: URL
  try {
    url = new URL(server)
  } catch {
    throw new Error(usage)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(usage)
  return { folder: path.resolve(folders[0] ?? '.'), server: url.origin, code }
}

type Fetch = typeof fetch

const errorOf = async (response: Response) => {
  const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null
  const reasons: Record<string, string> = {
    dev_mode_off: 'Hodi refused the code: turn on Serveur › Plugins › Mode développeur and use its new code.',
    replaces_verified: 'A verified plugin has this id on that Hodi: give yours another id.',
    too_many_requests: 'Too many requests: wait a minute.'
  }
  const error = body?.error ?? `HTTP ${response.status}`
  return new Error(reasons[error] ?? [error, body?.detail].filter(Boolean).join(': '))
}

// One round: build, send, wait for the restart. Answers what was installed.
export const sendBuild = async (
  options: DevOptions,
  { fetch: fetchTo = fetch, build = buildPlugin, wait = (ms: number) => new Promise(done => setTimeout(done, ms)) } = {}
): Promise<BuiltPlugin> => {
  const built = await build(options.folder)
  const boot = await bootOf(options.server, fetchTo)
  const response = await fetchTo(`${options.server}/api/dev/plugins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.code}`, 'Content-Type': 'application/octet-stream' },
    body: readFileSync(built.file)
  })
  if (!response.ok) throw await errorOf(response)
  // Hodi restarts to load it (Docker starts it again): ready once /health answers with another boot.
  for (let tries = 0; tries < 120; tries++) {
    await wait(500)
    const now = await bootOf(options.server, fetchTo).catch(() => null)
    if (now && now !== boot) return built
  }
  throw new Error('Hodi did not come back after a minute: is it started with a restart policy (Docker), or by hand?')
}

const bootOf = async (server: string, fetchTo: Fetch) => {
  const response = await fetchTo(`${server}/health`, { cache: 'no-store' })
  const body = (await response.json()) as { boot?: string }
  return body.boot ?? ''
}

// Prints the plugin's log lines as Hodi writes them, until stopped.
const followLog = (options: DevOptions, id: () => string | null, fetchTo: Fetch) => {
  let after = 0
  let following: string | null = null
  const timer = setInterval(() => {
    const current = id()
    if (!current) return
    if (current !== following) {
      following = current
      after = 0
    }
    fetchTo(`${options.server}/api/dev/plugins/${encodeURIComponent(current)}/log?after=${after}`, {
      headers: { Authorization: `Bearer ${options.code}` }
    })
      .then(async response => {
        if (!response.ok) return
        const body = (await response.json()) as { lines: string[]; next: number }
        // A restart starts the count again.
        if (body.next < after) after = 0
        for (const line of body.lines) console.log(`  │ ${line}`)
        after = body.next
      })
      .catch(() => {})
  }, 2000)
  return () => clearInterval(timer)
}

export const runDev = async (args: string[]) => {
  const options = devOptions(args)
  let installed: string | null = null
  let running = false
  let again = false

  const round = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    const started = Date.now()
    try {
      const built = await sendBuild(options)
      installed = built.id
      console.log(
        `✓ ${built.id} ${built.version} in Hodi (${((Date.now() - started) / 1000).toFixed(1)} s): reload the page`
      )
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
      if (again) {
        again = false
        void round()
      }
    }
  }

  await round()
  followLog(options, () => installed, fetch)

  // A save often writes several files at once: one build for them all.
  let pending: ReturnType<typeof setTimeout> | null = null
  watch(options.folder, { recursive: true }, (_event, file) => {
    if (!file || /(^|[/\\])(dist|node_modules|\.git)([/\\]|$)/.test(file)) return
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => void round(), 400)
  })
  console.log(`Watching ${path.relative(process.cwd(), options.folder) || '.'}; Ctrl+C to stop.`)
}
