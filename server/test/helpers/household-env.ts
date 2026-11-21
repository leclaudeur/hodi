import { AccountAiStore } from '../../db/account-ai-store.ts'
import type { AiProvider } from '../../news/ai-providers.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../../app.ts'
import { LoginThrottle } from '../../auth/login-throttle.ts'
import { hashPassword } from '../../auth/password.ts'
import type { Config } from '../../config.ts'
import { AccountDataStore } from '../../db/account-data.ts'
import { openDatabase } from '../../db/database.ts'
import { HouseholdStore } from '../../db/household-store.ts'
import { ProfileStore } from '../../db/profile-store.ts'
import { SignInCodeStore } from '../../db/sign-in-code-store.ts'
import { UserAccountStore } from '../../db/user-account-store.ts'
import { ProfileDeviceStore } from '../../db/profile-device-store.ts'
import { UserDeviceStore } from '../../db/user-device-store.ts'
import { UserStore } from '../../db/user-store.ts'
import { parseCatalog } from '../../news/catalog.ts'
import { NewsService } from '../../news/news-service.ts'
import { fakeFetch } from './news.ts'

export const ADMIN_PASSWORD = 'une phrase de passe assez longue'
export const SAM_PASSWORD = 'la phrase de Sam'
const FAST = { N: 2 ** 10, r: 8, p: 1 }

export const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// A provider whose only good key is sk-test-good…, and that never calls anything.
export const FAKE_AI: AiProvider = {
  id: 'fake',
  name: 'Fausse IA',
  defaultModel: 'fake-1',
  keysUrl: 'https://example.com/keys',
  keyPattern: /^sk-test-\w{8,}$/,
  checkKey: async key => (key.startsWith('sk-test-good') ? 'ok' : 'invalid'),
  tools: () => {
    throw new Error('not used')
  }
}

// « Chez nous »: Antho, its admin and the server's, Sam, an adult with an account, and Léa, a child.
export const startHousehold = async () => {
  const db = openDatabase(':memory:')
  const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    sessionSecret: Buffer.alloc(32, 5),
    webDir,
    sourcesFile: 'unused.yml',
    databaseFile: ':memory:',
    backupDir: 'unused-backups',
    timeZone: 'UTC',
    vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
  }
  const accounts = new UserAccountStore(db)
  const profiles = new ProfileStore(db)
  const accountAi = new AccountAiStore(db)
  const server = createApp(config, {
    news: new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
      fetchText: fakeFetch({}).fetchText,
      log: () => {}
    }),
    profiles,
    household: new HouseholdStore(db),
    accounts,
    accountAi,
    aiProviders: [FAKE_AI],
    devices: new UserDeviceStore(db),
    profileDevices: new ProfileDeviceStore(db),
    accountData: new AccountDataStore(db),
    codes: new SignInCodeStore(db, config.sessionSecret),
    throttle: new LoginThrottle(5, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  const session = cookiesFrom(
    await call('/setup/account', '', 'POST', { email: 'antho@example.com', password: ADMIN_PASSWORD })
  )
  const setup = await call('/setup', session, 'POST', {
    name: 'Chez nous',
    profile: { name: 'Antho', color: 'tech' },
    timeZone: 'Europe/Brussels',
    country: 'BE',
    ai: null
  })
  const admin = `${session}; ${cookiesFrom(setup)}`
  const { id: samId } = (await (
    await call('/profiles', admin, 'POST', { name: 'Sam', color: 'monde', kind: 'adult' })
  ).json()) as { id: number }
  const samAccount = accounts.create('sam@example.com', await hashPassword(SAM_PASSWORD, FAST), 0)!
  accounts.linkProfile(samAccount.id, samId)
  const { id: leaId } = (await (
    await call('/profiles', admin, 'POST', { name: 'Léa', color: 'sport', kind: 'child' })
  ).json()) as { id: number }
  const sam = cookiesFrom(await call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD }))
  const anthoAccount = accounts.byEmail('antho@example.com')!
  return {
    db,
    call,
    admin,
    sam,
    samId,
    samAccount,
    leaId,
    anthoAccount,
    accounts,
    accountAi,
    profiles,
    users: (id: number) => new UserStore(db, id),
    close: () => server.close()
  }
}
