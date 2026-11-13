import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { LoginThrottle } from '../auth/login-throttle.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { SIGN_IN_CODE_LIFETIME, SignInCodeStore } from '../db/sign-in-code-store.ts'
import { PROFILE_DEVICE_IDLE, ProfileDeviceStore } from '../db/profile-device-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { createUserSessionToken, userSessionKey } from '../auth/session.ts'
import type { AiProvider } from '../news/ai-providers.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'
const CODE = 'K7PM2QXR'

// A provider whose only good key is sk-test-good…, and that never calls anything.
const fakeAi: AiProvider = {
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

// An install of its own, with personal accounts.
const startInstall = async ({ now = Date.now }: { now?: () => number } = {}) => {
  const db = openDatabase(':memory:')
  const household = new HouseholdStore(db)
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    sessionSecret: Buffer.alloc(32, 2),
    webDir,
    sourcesFile: 'unused.yml',
    databaseFile: ':memory:',
    backupDir: 'unused-backups',
    timeZone: 'UTC',
    vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
  }
  const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
  const server = createApp(config, {
    news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
    profiles,
    household,
    accounts,
    devices: new UserDeviceStore(db),
    profileDevices: new ProfileDeviceStore(db),
    accountData: new AccountDataStore(db),
    codes: new SignInCodeStore(db, config.sessionSecret),
    setupCode: CODE,
    now: () => now(),
    aiProviders: [fakeAi],
    onHouseholdChange: () => {
      changes += 1
    },
    throttle: new LoginThrottle(5, 60_000)
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
    household,
    profiles,
    accounts,
    db
  }
}

let changes = 0
let install: Awaited<ReturnType<typeof startInstall>>
let baseUrl: string
let household: HouseholdStore
let profiles: ProfileStore

const post = (url: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

const EMAIL = 'antho@example.com'
const ACCOUNT = { email: EMAIL, password: PASSWORD }

const SETUP = {
  name: 'Chez nous',
  profile: { name: 'Antho', color: 'tech' },
  timeZone: 'Europe/Brussels',
  country: 'BE',
  ai: null
}

// Through a reverse proxy, as on a server on the internet.
const PROXIED = { 'X-Forwarded-For': '203.0.113.7' }

const login = (body: unknown) => post('/login', body)
const signIn = async () => cookiesFrom(await login(ACCOUNT))

describe('household', () => {
  before(async () => {
    install = await startInstall()
    ;({ baseUrl, household, profiles } = install)
  })
  after(() => install.close())

  it('waits for its first-run screens: no login, no API', async () => {
    const state = await (await fetch(`${baseUrl}/api/setup`)).json()
    assert.equal(state.needed, true)
    assert.equal(state.stage, 'account')
    assert.equal(state.codeRequired, false)
    assert.deepEqual(state.providers, [{ id: 'fake', name: 'Fausse IA', keysUrl: 'https://example.com/keys' }])

    const proxied = await (await fetch(`${baseUrl}/api/setup`, { headers: PROXIED })).json()
    assert.equal(proxied.codeRequired, true)

    assert.equal((await login({ password: PASSWORD })).status, 400)
    assert.equal((await login(ACCOUNT)).status, 401)
    const api = await fetch(`${baseUrl}/api/session`)
    assert.equal(api.status, 401)
    assert.deepEqual(await api.json(), { error: 'setup_required' })
  })

  it('asks for the code away from the server, and checks a key only on demand', async () => {
    // Eight letters and digits (six digits are never it), typed in any case and spacing. Wrong ones share the
    // throttle with the other tests here: few of them.
    assert.equal((await post('/setup/code', { code: '123456' }, PROXIED)).status, 403)
    assert.equal((await post('/setup/code', { code: 'k7pm 2qxr' }, PROXIED)).status, 204)
    assert.equal((await post('/setup/code', { code: CODE }, PROXIED)).status, 204)
    assert.equal((await post('/setup/account', { ...ACCOUNT, code: 'K7PM2QXS' }, PROXIED)).status, 403)

    const good = await post('/setup/ai-check', { provider: 'fake', key: 'sk-test-good1234' })
    assert.deepEqual(await good.json(), { result: 'ok' })
    const bad = await post('/setup/ai-check', { provider: 'fake', key: 'sk-test-wrong1234' })
    assert.deepEqual(await bad.json(), { result: 'invalid' })
    const pasted = await post('/setup/ai-check', { provider: 'fake', key: 'not a key' })
    assert.deepEqual(await pasted.json(), { result: 'invalid' })
  })

  it('refuses a short password or an address that cannot be one', async () => {
    assert.equal((await post('/setup/account', { ...ACCOUNT, password: 'court' })).status, 400)
    assert.equal((await post('/setup/account', { ...ACCOUNT, email: 'antho' })).status, 400)
    assert.equal((await post('/setup/account', { password: PASSWORD })).status, 400)
    assert.equal(install.accounts.any(), false)
  })

  it('makes the server admin’s account first, signed in on this device, once', async () => {
    // The household waits for it.
    assert.equal((await post('/setup', SETUP)).status, 401)

    const response = await post('/setup/account', { ...ACCOUNT, email: '  Antho@Example.com ' }, PROXIED)
    assert.equal(response.status, 403)
    const made = await post('/setup/account', { ...ACCOUNT, email: '  Antho@Example.com ' })
    assert.equal(made.status, 204)
    const cookie = cookiesFrom(made)
    assert.match(cookie, /hodi_session=v3\./)
    const account = install.accounts.byEmail(EMAIL)
    assert.equal(account?.serverAdmin, true)
    assert.notEqual(account?.passwordHash, PASSWORD)

    assert.equal((await post('/setup/account', { email: 'autre@example.com', password: PASSWORD })).status, 409)

    // Its device goes on with the household; another one signs in first, without the code.
    assert.deepEqual(await (await fetch(`${baseUrl}/api/setup`, { headers: { cookie } })).json(), {
      needed: true,
      stage: 'household',
      signedIn: true,
      email: EMAIL,
      providers: [{ id: 'fake', name: 'Fausse IA', keysUrl: 'https://example.com/keys' }]
    })
    const elsewhere = await (await fetch(`${baseUrl}/api/setup`, { headers: PROXIED })).json()
    assert.equal(elsewhere.signedIn, false)
    assert.equal((await post('/setup', SETUP, PROXIED)).status, 401)
    const signedIn = await post('/login', ACCOUNT, PROXIED)
    assert.equal(signedIn.status, 204)
    // Away from the server, its session stands for the code.
    const key = await post(
      '/setup/ai-check',
      { provider: 'fake', key: 'sk-test-good1234' },
      {
        ...PROXIED,
        cookie: cookiesFrom(signedIn)
      }
    )
    assert.deepEqual(await key.json(), { result: 'ok' })

    // Nothing else answers before the household exists.
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).status, 401)
  })

  it('refuses a household without a name or with a wrong region', async () => {
    const cookie = await signIn()
    assert.equal((await post('/setup', { ...SETUP, name: ' ' }, { cookie })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, timeZone: 'Mars/Olympus' }, { cookie })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, country: 'Belgique' }, { cookie })).status, 400)
    assert.equal((await post('/setup', { ...SETUP, language: 'nl' }, { cookie })).status, 400)
    assert.equal(household.isSetUp(), false)
  })

  it('sets up the household with the admin’s profile, which is its own, once', async () => {
    const cookie = await signIn()
    const response = await post('/setup', { ...SETUP, ai: { provider: 'fake', key: 'sk-test-good1234' } }, { cookie })
    assert.equal(response.status, 200)
    const profileCookie = cookiesFrom(response)
    assert.match(profileCookie, /hodi_profile=/)
    const signedIn = `${cookie}; ${profileCookie}`

    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie: signedIn } })).json()
    assert.deepEqual(session, { authenticated: true, profileChosen: true, language: 'fr', hourCycle: 24 })
    const [admin] = profiles.list()
    assert.equal(admin?.name, 'Antho')
    assert.equal(admin?.color, 'tech')
    assert.equal(admin?.tourPending, false)
    assert.equal(install.accounts.profileOf(install.accounts.byEmail(EMAIL)!.id), admin?.id)
    assert.equal(changes, 1)

    const view = await (await fetch(`${baseUrl}/api/household`, { headers: { cookie: signedIn } })).json()
    assert.equal(view.name, 'Chez nous')
    // The household has no password of its own: everyone has their own.
    assert.equal('sharedPassword' in view, false)
    assert.equal(view.timeZone, 'Europe/Brussels')
    assert.equal(view.country, 'BE')
    assert.deepEqual(view.ai, {
      provider: 'fake',
      providerName: 'Fausse IA',
      model: 'fake-1',
      keyHint: 'sk-test-••••1234'
    })

    assert.equal((await post('/setup', SETUP, { cookie })).status, 409)
    assert.equal((await post('/setup/account', ACCOUNT)).status, 409)
    assert.deepEqual(await (await fetch(`${baseUrl}/api/setup`)).json(), {
      needed: false,
      name: 'Chez nous',
      language: 'fr',
      // No mail server here: Connexion offers no « Mot de passe oublié ».
      resetByMail: false
    })
  })

  it('signs in with the e-mail and the password, opening its own profile', async () => {
    const response = await login({ email: 'ANTHO@example.com', password: PASSWORD })
    assert.equal(response.status, 204)
    const cookie = cookiesFrom(response)
    assert.match(cookie, /hodi_session=v3\./)
    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()
    assert.equal(session.profileChosen, true)

    // The same answer for an address no one has as for a wrong password.
    const wrong = await login({ ...ACCOUNT, password: 'pas le bon mot de passe' })
    const nobody = await login({ email: 'personne@example.com', password: PASSWORD })
    assert.equal(wrong.status, 401)
    assert.deepEqual(await nobody.json(), await wrong.json())
    assert.equal((await login({ email: 'pas une adresse', password: PASSWORD })).status, 400)
    // A password alone, with no e-mail, signs nobody in.
    assert.deepEqual(await (await login({ password: PASSWORD })).json(), { error: 'invalid_request' })
  })

  it('keeps the language chosen at setup, which the admin can change', async () => {
    const cookie = await signIn()
    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()
    assert.equal(session.language, 'fr')
    assert.equal((await (await fetch(`${baseUrl}/api/setup`)).json()).language, 'fr')

    const patch = (body: unknown) => post('/household', body, { cookie }, 'PATCH')
    assert.equal((await (await patch({ language: 'en' })).json()).language, 'en')
    assert.equal((await patch({ language: 'nl' })).status, 400)

    // The time of day, for every device: 24 h until the admin picks 12 h.
    assert.equal((await (await patch({ hourCycle: 12 })).json()).hourCycle, 12)
    assert.equal((await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()).hourCycle, 12)
    assert.equal((await patch({ hourCycle: 13 })).status, 400)
    assert.equal(household.get().language, 'en')
    assert.equal((await (await fetch(`${baseUrl}/api/setup`)).json()).language, 'en')
    await patch({ language: 'fr' })
  })

  it('lets the admin rename it, move it and change or drop its AI', async () => {
    const cookie = await signIn()
    const patch = (body: unknown) => post('/household', body, { cookie }, 'PATCH')

    assert.equal((await (await patch({ name: '  La   maison ' })).json()).name, 'La maison')
    assert.equal((await patch({ name: '' })).status, 400)
    const moved = await (await patch({ timeZone: 'America/Montreal', country: null })).json()
    assert.equal(moved.timeZone, 'America/Montreal')
    assert.equal(moved.country, null)
    assert.equal(changes, 2)

    const refused = await post('/household/ai', { provider: 'fake', key: 'sk-test-wrong1234' }, { cookie }, 'PUT')
    assert.equal(refused.status, 422)
    assert.equal(household.get().ai?.key, 'sk-test-good1234')
    const dropped = await (await fetch(`${baseUrl}/api/household/ai`, { method: 'DELETE', headers: { cookie } })).json()
    assert.equal(dropped.ai, null)
    assert.equal(changes, 3)
  })

  it('is the admin’s only', async () => {
    // The session alone: the device then picks the profile it reads with.
    const cookie = (await signIn())
      .split('; ')
      .filter(part => part.startsWith('hodi_session='))
      .join('; ')
    const member = profiles.create('Léa', 'world', 0)!
    const chosen = await post(`/profiles/current`, { id: member.id }, { cookie }, 'PUT')
    const asMember = `${cookie}; ${cookiesFrom(chosen)}`
    assert.equal((await fetch(`${baseUrl}/api/household`, { headers: { cookie: asMember } })).status, 403)
  })
})

// "J'ai un code": an adult invites a new adult, or the admin gives an adult profile its person, who makes their own
// account from a device signed in with nothing.
describe('joining the household with a code', () => {
  let clock = Date.UTC(2026, 10, 6, 9)
  let admin: string

  before(async () => {
    install = await startInstall({ now: () => clock })
    ;({ baseUrl, household, profiles } = install)
    const account = await post('/setup/account', ACCOUNT)
    admin = cookiesFrom(account)
    const done = await post('/setup', SETUP, { cookie: admin })
    admin = `${admin}; ${cookiesFrom(done)}`
  })
  after(() => install.close())

  const makeCode = async (cookie: string, body: unknown = {}) => post('/codes', body, { cookie })
  const JOINER = { email: 'sam@example.com', password: PASSWORD, ageConfirmed: true }

  it('invites a new adult, once and for a day', async () => {
    const made = await makeCode(admin)
    assert.equal(made.status, 201)
    const { code, expiresAt } = (await made.json()) as { code: string; expiresAt: number }
    assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/)
    assert.equal(expiresAt, clock + SIGN_IN_CODE_LIFETIME)

    const checked = await post('/codes/check', { code })
    assert.deepEqual(await checked.json(), {
      kind: 'invite',
      household: 'Chez nous',
      invitedBy: { id: profiles.list()[0]!.id, name: 'Antho', color: 'tech', kind: 'adult', avatar: null },
      full: false
    })

    // The age is the person's word, the profile's name and colour theirs to choose.
    assert.equal((await post('/codes/join', { ...JOINER, code, ageConfirmed: false })).status, 400)
    assert.equal((await post('/codes/join', { ...JOINER, code })).status, 400)
    const taken = await post('/codes/join', { ...JOINER, email: EMAIL, code, profile: { name: 'Sam', color: 'world' } })
    assert.deepEqual(await taken.json(), { error: 'email_taken' })

    const joined = await post('/codes/join', { ...JOINER, code, profile: { name: 'Sam', color: 'world' } })
    assert.equal(joined.status, 200)
    const sam = profiles.list().find(profile => profile.name === 'Sam')!
    assert.deepEqual(await joined.json(), { profileId: sam.id })
    assert.equal(sam.role, 'member')
    assert.equal(sam.hasAccount, true)
    const cookie = cookiesFrom(joined)
    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).json()
    assert.equal(session.profileChosen, true)
    assert.equal(install.accounts.profileOf(install.accounts.byEmail('sam@example.com')!.id), sam.id)

    // Used: it opens nothing any more, and the new account signs in with its own password.
    assert.equal((await post('/codes/check', { code })).status, 403)
    assert.equal((await login({ email: 'sam@example.com', password: PASSWORD })).status, 204)
  })

  it('reads a code typed in small letters or with a dash, and no longer one of six digits', async () => {
    const { code } = (await (await makeCode(admin)).json()) as { code: string }
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`
    assert.equal((await post('/codes/check', { code: typed })).status, 200)
    assert.equal((await post('/codes/check', { code: ` ${code} ` })).status, 200)
    // Each wrong one counts as a wrong password, from a client of its own here; more cases in sign-in-code.test.ts.
    const elsewhere = { 'X-Forwarded-For': '203.0.113.9' }
    assert.equal((await post('/codes/check', { code: '123456' }, elsewhere)).status, 403)
    assert.equal((await post('/codes/check', { code: code.slice(1) }, elsewhere)).status, 403)
  })

  it('gives an adult profile without an account its person, from the admin only', async () => {
    const sophie = profiles.create('Sophie', 'music', clock)!
    const asSam = cookiesFrom(await login({ email: 'sam@example.com', password: PASSWORD }))
    assert.equal((await makeCode(asSam, { profileId: sophie.id })).status, 403)
    const admins = profiles.list()[0]!
    assert.equal((await makeCode(admin, { profileId: admins.id })).status, 400)

    const first = (await (await makeCode(admin, { profileId: sophie.id })).json()) as { code: string }
    const { code } = (await (await makeCode(admin, { profileId: sophie.id })).json()) as { code: string }
    // A new code for the same profile replaces the one before.
    assert.equal((await post('/codes/check', { code: first.code })).status, 403)
    const checked = (await (await post('/codes/check', { code })).json()) as { kind: string; profile: { name: string } }
    assert.equal(checked.kind, 'profile')
    assert.equal(checked.profile.name, 'Sophie')

    const joined = await post('/codes/join', { ...JOINER, email: 'sophie@example.com', code })
    assert.deepEqual(await joined.json(), { profileId: sophie.id })
    assert.equal(profiles.get(sophie.id)?.hasAccount, true)
    assert.equal(profiles.list().length, 3)
  })

  it('gives an adult who forgot their password a new one, with a code from the admin only', async () => {
    const sophie = profiles.list().find(profile => profile.name === 'Sophie')!
    const asSam = cookiesFrom(await login({ email: 'sam@example.com', password: PASSWORD }))
    assert.equal((await makeCode(asSam, { profileId: sophie.id })).status, 403)
    // The admin's own password changes in Compte et données, with the current one.
    assert.equal((await makeCode(admin, { profileId: profiles.list()[0]!.id })).status, 400)
    const before = cookiesFrom(await login({ email: 'sophie@example.com', password: PASSWORD }))

    // The code opens Sophie's account: it takes the admin's own password, which a device left open does not know.
    const unproven = await makeCode(admin, { profileId: sophie.id })
    assert.equal(unproven.status, 403)
    assert.deepEqual(await unproven.json(), { error: 'invalid_password' })
    const made = await makeCode(admin, { profileId: sophie.id, password: PASSWORD })
    assert.equal(made.status, 201)
    const { code } = (await made.json()) as { code: string }
    const checked = (await (await post('/codes/check', { code })).json()) as { kind: string; profile: { name: string } }
    assert.equal(checked.kind, 'reset')
    assert.equal(checked.profile.name, 'Sophie')
    // It makes no account, and the new password is a real one.
    assert.equal((await post('/codes/join', { ...JOINER, email: 'other@example.com', code })).status, 400)
    assert.equal((await post('/codes/reset', { code, password: 'court' })).status, 400)

    const NEW_PASSWORD = 'une toute nouvelle phrase de passe'
    const reset = await post('/codes/reset', { code, password: NEW_PASSWORD })
    assert.deepEqual(await reset.json(), { profileId: sophie.id })
    const session = await (await fetch(`${baseUrl}/api/session`, { headers: { cookie: cookiesFrom(reset) } })).json()
    assert.equal(session.profileChosen, true)

    // Every other device of hers signs in again, with the new password only; the code works no more.
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: before } })).status, 401)
    assert.equal((await login({ email: 'sophie@example.com', password: PASSWORD })).status, 401)
    assert.equal((await login({ email: 'sophie@example.com', password: NEW_PASSWORD })).status, 204)
    assert.equal((await post('/codes/check', { code })).status, 403)
    assert.equal((await post('/codes/reset', { code, password: NEW_PASSWORD })).status, 403)
  })

  it('stops after a day, and with a full household', async () => {
    const { code } = (await (await makeCode(admin)).json()) as { code: string }
    clock += SIGN_IN_CODE_LIFETIME
    assert.equal((await post('/codes/check', { code })).status, 403)

    const late = (await (await makeCode(admin)).json()) as { code: string }
    profiles.create('Lou', 'sport', clock)
    profiles.create('Noé', 'science', clock)
    const full = (await (await post('/codes/check', { code: late.code })).json()) as { full: boolean }
    assert.equal(full.full, true)
    const refused = await post('/codes/join', {
      ...JOINER,
      email: 'lou@example.com',
      code: late.code,
      profile: { name: 'Lou', color: 'sport' }
    })
    assert.deepEqual(await refused.json(), { error: 'household_full' })
    assert.equal((await makeCode(admin)).status, 409)
  })

  it('counts wrong codes as wrong passwords', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/codes/check', { code: '000000' }, PROXIED)
    }
    assert.equal((await post('/codes/check', { code: '000000' }, PROXIED)).status, 429)
  })
})

// A young profile's own device: a parent's code links it, it opens that profile only, for 90 days from its last use
// or until a parent removes it.
describe('an account with no password of its own (« Se connecter avec Google »)', () => {
  let clock = Date.now()
  let antho = ''

  before(async () => {
    install = await startInstall({ now: () => clock })
    ;({ baseUrl, household, profiles } = install)
    antho = cookiesFrom(await post('/setup/account', ACCOUNT))
    antho = `${antho}; ${cookiesFrom(await post('/setup', SETUP, { cookie: antho }))}`
    // As if a plugin had made it with a login alone.
    install.db.prepare('UPDATE users SET has_password = 0').run()
  })
  after(() => install.close())

  const view = async () =>
    (await (await fetch(`${baseUrl}/api/account`, { headers: { cookie: antho } })).json()) as {
      email: string
      loginOnly: boolean
      recentSignIn: boolean
    }

  it('says so in « Qui lit ? », where its profile opens through the plugin', async () => {
    const list = (await (await fetch(`${baseUrl}/api/profiles`, { headers: { cookie: antho } })).json()) as {
      profiles: { name: string; locked: boolean; loginOnly?: boolean }[]
    }
    assert.deepEqual(
      list.profiles.map(({ name, locked, loginOnly }) => ({ name, locked, loginOnly })),
      [{ name: 'Antho', locked: true, loginOnly: true }]
    )
  })

  it('changes its e-mail without a password only within 5 minutes of a sign-in on this device', async () => {
    const { loginOnly, recentSignIn } = await view()
    assert.deepEqual({ loginOnly, recentSignIn }, { loginOnly: true, recentSignIn: true })
    const changed = await post('/account/email', { email: 'antho@example.org' }, { cookie: antho }, 'PUT')
    assert.equal(changed.status, 200)
    clock += 6 * 60 * 1000
    assert.equal((await view()).recentSignIn, false)
    const late = await post('/account/email', { email: 'antho@example.net' }, { cookie: antho }, 'PUT')
    assert.deepEqual([late.status, await late.json()], [403, { error: 'sign_in_again' }])
    // A password typed is no way around it: there is none to check.
    const typed = await post(
      '/account/email',
      { email: 'antho@example.net', password: PASSWORD },
      { cookie: antho },
      'PUT'
    )
    assert.equal(typed.status, 403)
  })

  it('chooses a password right after a sign-in, and is then an ordinary account', async () => {
    const late = await post('/account/password', { next: 'une toute nouvelle phrase' }, { cookie: antho }, 'PUT')
    assert.equal(late.status, 403)
    clock -= 6 * 60 * 1000
    const chosen = await post('/account/password', { next: 'une toute nouvelle phrase' }, { cookie: antho }, 'PUT')
    assert.equal(chosen.status, 200)
    antho = `${cookiesFrom(chosen)}; ${antho.split('; ').find(part => part.startsWith('hodi_profile='))}`
    assert.equal((await view()).loginOnly, false)
    assert.equal((await login({ email: 'antho@example.org', password: 'une toute nouvelle phrase' })).status, 204)
  })
})

describe("a young profile's own device", () => {
  let clock = Date.UTC(2026, 10, 6, 9)
  let admin: string
  let lea: number

  before(async () => {
    install = await startInstall({ now: () => clock })
    ;({ baseUrl, household, profiles } = install)
    const account = await post('/setup/account', ACCOUNT)
    admin = cookiesFrom(account)
    const done = await post('/setup', SETUP, { cookie: admin })
    admin = `${admin}; ${cookiesFrom(done)}`
    lea = profiles.create('Léa', 'music', clock, { kind: 'teen' })!.id
  })
  after(() => install.close())

  const get = (url: string, cookie: string) => fetch(`${baseUrl}/api${url}`, { headers: { cookie } })
  const codeFor = async (cookie: string, profileId: number) =>
    ((await (await post('/codes', { profileId }, { cookie })).json()) as { code: string }).code

  it('links the device a parent gives a code to, which opens that profile only', async () => {
    const code = await codeFor(admin, lea)
    const checked = (await (await post('/codes/check', { code })).json()) as { kind: string; profile: { id: number } }
    assert.equal(checked.kind, 'device')
    assert.equal(checked.profile.id, lea)
    // It makes no account.
    assert.equal(
      (await post('/codes/join', { email: 'lea@example.com', password: PASSWORD, ageConfirmed: true, code })).status,
      400
    )

    const linked = await post('/codes/link', { code }, { 'User-Agent': 'Mozilla/5.0 (iPad) Safari/605.1.15' })
    assert.deepEqual(await linked.json(), { profileId: lea })
    const cookie = cookiesFrom(linked)
    assert.match(cookie, /hodi_session=y2\.\d+\.\d+\./)
    const session = await (await get('/session', cookie)).json()
    assert.equal(session.profileChosen, true)
    assert.equal(session.linkedDevice, true)
    const own = (await (await get('/profiles', cookie)).json()) as { current: number }
    assert.equal(own.current, lea)

    // Used once: nothing more. And a linked device never changes profile, nor makes codes.
    assert.equal((await post('/codes/link', { code })).status, 403)
    const admins = profiles.list()[0]!.id
    assert.equal((await post('/profiles/current', { id: admins }, { cookie }, 'PUT')).status, 403)
    assert.equal((await post('/codes', {}, { cookie })).status, 403)
    assert.equal((await get(`/profiles/${lea}/devices`, cookie)).status, 403)

    const devices = (await (await get(`/profiles/${lea}/devices`, admin)).json()) as {
      devices: { id: number; userAgent: string }[]
    }
    assert.equal(devices.devices.length, 1)
    assert.match(devices.devices[0]!.userAgent, /iPad/)
  })

  it('is removed by a parent, and signs out on its own only once', async () => {
    const cookie = cookiesFrom(await post('/codes/link', { code: await codeFor(admin, lea) }))
    const listed = (await (await get(`/profiles/${lea}/devices`, admin)).json()) as { devices: { id: number }[] }
    assert.equal(listed.devices.length, 2)
    const removed = await post(`/profiles/${lea}/devices/${listed.devices[0]!.id}`, {}, { cookie: admin }, 'DELETE')
    assert.equal(removed.status, 204)
    assert.equal((await get('/session', cookie)).status, 401)

    // The first device signs out: it is no longer linked either.
    const first = listed.devices[1]!.id
    const other = cookiesFrom(await post('/codes/link', { code: await codeFor(admin, lea) }))
    assert.equal((await post('/logout', {}, { cookie: other })).status, 204)
    const left = (await (await get(`/profiles/${lea}/devices`, admin)).json()) as { devices: { id: number }[] }
    assert.deepEqual(
      left.devices.map(device => device.id),
      [first]
    )
  })

  it('stays linked for 90 days from its last use', async () => {
    const cookie = cookiesFrom(await post('/codes/link', { code: await codeFor(admin, lea) }))
    clock += PROFILE_DEVICE_IDLE - 60_000
    const used = await get('/session', cookie)
    assert.equal(used.status, 200)
    // Its cookie comes again, for 90 more days.
    assert.match(cookiesFrom(used), /hodi_session=y2\./)
    clock += PROFILE_DEVICE_IDLE - 60_000
    assert.equal((await get('/session', cookie)).status, 200)
    clock += PROFILE_DEVICE_IDLE
    assert.equal((await get('/session', cookie)).status, 401)
  })

  it('goes with its profile', async () => {
    // Months later: the admin signs in again.
    admin = await signIn()
    const tom = profiles.create('Tom', 'sport', clock, { kind: 'child' })!.id
    const cookie = cookiesFrom(await post('/codes/link', { code: await codeFor(admin, tom) }))
    assert.equal((await get('/session', cookie)).status, 200)
    assert.equal((await post(`/profiles/${tom}`, {}, { cookie: admin }, 'DELETE')).status, 204)
    assert.equal((await get('/session', cookie)).status, 401)
  })
})

// Réglages > Compte et données: the account's e-mail and password, its devices, a copy, and deleting it.
describe('the account and its data', () => {
  let antho: string

  before(async () => {
    install = await startInstall()
    ;({ baseUrl, household, profiles } = install)
    const account = await post('/setup/account', ACCOUNT)
    antho = cookiesFrom(account)
    antho = `${antho}; ${cookiesFrom(await post('/setup', SETUP, { cookie: antho }))}`
  })
  after(() => install.close())

  const get = async (cookie: string, url = '/account') => fetch(`${baseUrl}/api${url}`, { headers: { cookie } })
  const sessionOf = async (cookie: string) => (await get(cookie, '/session')).status
  const SAM = {
    email: 'sam@example.com',
    password: PASSWORD,
    ageConfirmed: true,
    profile: { name: 'Sam', color: 'world' }
  }

  it('lists the devices signed in, and signs one out', async () => {
    const other = cookiesFrom(await login(ACCOUNT))
    const view = (await (await get(antho)).json()) as {
      email: string
      devices: { id: number; current: boolean }[]
    }
    assert.equal(view.email, EMAIL)
    assert.equal(view.devices.length, 2)
    const elsewhere = view.devices.find(device => !device.current)!
    assert.equal((await post(`/account/devices/${elsewhere.id}`, {}, { cookie: antho }, 'DELETE')).status, 200)
    assert.equal(await sessionOf(other), 401)
    assert.equal(await sessionOf(antho), 200)
    const current = view.devices.find(device => device.current)!
    assert.equal((await post(`/account/devices/${current.id}`, {}, { cookie: antho }, 'DELETE')).status, 404)
  })

  it('moves a session from before devices to one of its own', async () => {
    const account = install.accounts.byEmail(EMAIL)!
    const key = userSessionKey(Buffer.alloc(32, 2), account.id, account.sessionGeneration)
    const old = `hodi_session=${createUserSessionToken(account.id, key, Date.now())}`
    const answer = await get(old, '/session')
    assert.equal(answer.status, 200)
    assert.match(cookiesFrom(answer), /hodi_session=v3\./)
  })

  it('changes the e-mail after the password', async () => {
    assert.equal(
      (
        await post(
          '/account/email',
          { email: 'a@example.com', password: 'faux mot de passe' },
          { cookie: antho },
          'PUT'
        )
      ).status,
      403
    )
    const changed = await post(
      '/account/email',
      { email: 'Antho@Example.org', password: PASSWORD },
      { cookie: antho },
      'PUT'
    )
    assert.equal(((await changed.json()) as { email: string }).email, 'antho@example.org')
    assert.equal((await login(ACCOUNT)).status, 401)
    assert.equal((await login({ email: 'antho@example.org', password: PASSWORD })).status, 204)
  })

  it('changes the password: this device goes on, the others sign in again', async () => {
    const other = cookiesFrom(await login({ email: 'antho@example.org', password: PASSWORD }))
    const next = 'une toute nouvelle phrase'
    const changed = await post('/account/password', { current: PASSWORD, next }, { cookie: antho }, 'PUT')
    assert.equal(changed.status, 200)
    antho = `${cookiesFrom(changed)}; ${antho.split('; ').find(part => part.startsWith('hodi_profile='))}`
    assert.equal(await sessionOf(antho), 200)
    assert.equal(await sessionOf(other), 401)
    assert.equal((await login({ email: 'antho@example.org', password: next })).status, 204)
    // Back to the first one, for what follows.
    await post('/account/password', { current: next, next: PASSWORD }, { cookie: antho }, 'PUT').then(response => {
      antho = `${cookiesFrom(response)}; ${antho.split('; ').find(part => part.startsWith('hodi_profile='))}`
    })
  })

  it('downloads a copy of what Hodi keeps', async () => {
    const copy = await get(antho, '/account/copy')
    assert.match(copy.headers.get('content-disposition') ?? '', /attachment; filename="hodi-\d{4}-\d{2}-\d{2}\.json"/)
    const body = (await copy.json()) as {
      account: { email: string; devices: unknown[] }
      household: { name: string; profiles: { name: string }[] }
      you: { profile: { name: string }; saved_articles: unknown[] }
    }
    assert.equal(body.account.email, 'antho@example.org')
    assert.equal(body.household.name, 'Chez nous')
    assert.equal(body.you.profile.name, 'Antho')
    assert.deepEqual(body.you.saved_articles, [])
    assert.doesNotMatch(JSON.stringify(body), /passwordHash|password_hash|scrypt|ai_key/)
  })

  it('deletes an account: another adult takes over the household and the server', async () => {
    const { code } = (await (await post('/codes', {}, { cookie: antho })).json()) as { code: string }
    const sam = cookiesFrom(await post('/codes/join', { ...SAM, code }))
    const plan = (await (await get(antho)).json()) as { deletion: { householdGoes: boolean } }
    assert.equal(plan.deletion.householdGoes, false)

    // The red confirmation is not enough: a device left open, or a stolen cookie, does not know the password.
    const unproven = await post('/account', {}, { cookie: antho }, 'DELETE')
    assert.equal(unproven.status, 403)
    assert.deepEqual(await unproven.json(), { error: 'invalid_password' })
    assert.equal((await post('/account', { password: 'pas le bon' }, { cookie: antho }, 'DELETE')).status, 403)
    assert.equal(await sessionOf(antho), 200)
    const deleted = await post('/account', { password: PASSWORD }, { cookie: antho }, 'DELETE')
    assert.equal(deleted.status, 204)
    assert.equal(await sessionOf(antho), 401)
    assert.equal((await login({ email: 'antho@example.org', password: PASSWORD })).status, 401)
    assert.deepEqual(
      profiles.list().map(profile => [profile.name, profile.role]),
      [['Sam', 'admin']]
    )
    assert.equal(install.accounts.byEmail('sam@example.com')?.serverAdmin, true)

    // The last adult: the household goes with Sam's account, and the install waits for its first-run screens.
    const last = (await (await get(sam)).json()) as { deletion: { householdGoes: boolean; household: string } }
    assert.deepEqual(last.deletion, { householdGoes: true, household: 'Chez nous', others: [] })
    assert.equal((await post('/account', { password: PASSWORD }, { cookie: sam }, 'DELETE')).status, 204)
    const setup = (await (await fetch(`${baseUrl}/api/setup`)).json()) as { needed: boolean; stage: string }
    assert.deepEqual([setup.needed, setup.stage], [true, 'account'])
    assert.equal(install.accounts.any(), false)
  })
})
