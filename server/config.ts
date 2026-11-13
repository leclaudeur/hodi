import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'

export interface Config {
  host: string
  port: number
  // Signs the session cookies: made on the first start and kept next to the database.
  sessionSecret: Buffer
  webDir: string
  sourcesFile: string
  // SQLite database and its daily backups.
  databaseFile: string
  backupDir: string
  // The server's own time zone, the household's until it picks one.
  timeZone: string
  // The key pair that signs notifications: made on the first start and kept next to the database.
  vapid: { publicKey: string; privateKey: string; subject: string }
}

// Push services want a way to reach whoever sends: the project's page will do.
const VAPID_SUBJECT = 'https://github.com/leclaudeur/hodi'

const DATABASE_NAME = 'hodi.db'

// Written once, readable by the server only; a second start reads it back.
const keptFile = (file: string, make: () => string) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, make(), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return fs.readFileSync(file, 'utf8').trim()
}

const loadVapid = (file: string): Config['vapid'] => {
  const stored = JSON.parse(keptFile(file, () => JSON.stringify(webpush.generateVAPIDKeys()))) as {
    publicKey?: unknown
    privateKey?: unknown
  }
  if (typeof stored.publicKey !== 'string' || typeof stored.privateKey !== 'string') {
    throw new Error(`${file} must hold a publicKey and a privateKey`)
  }
  return { publicKey: stored.publicKey, privateKey: stored.privateKey, subject: VAPID_SUBJECT }
}

// Removing the file signs out every device.
const loadSessionSecret = (file: string) => {
  const stored = keptFile(file, () => randomBytes(32).toString('hex'))
  if (!/^[0-9a-f]{64,}$/i.test(stored)) throw new Error(`${file} must hold at least 64 hex characters`)
  return Buffer.from(stored, 'hex')
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const port = Number(env.PORT ?? 3000)
  const dataDir = env.DATA_DIR?.trim() || 'data'

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port')
  }

  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    sessionSecret: loadSessionSecret(path.resolve(dataDir, 'session-secret')),
    webDir: env.WEB_DIR ?? path.resolve(import.meta.dirname, '../web'),
    sourcesFile: path.resolve(env.SOURCES_FILE ?? 'sources.yml'),
    databaseFile: path.resolve(dataDir, DATABASE_NAME),
    backupDir: path.resolve(dataDir, 'backups'),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    vapid: loadVapid(path.resolve(dataDir, 'vapid.json'))
  }
}
