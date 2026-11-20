import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { migrate, versionBefore } from '../db/migrations.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { YoungAccountStore } from '../db/young-account-store.ts'
import { CREATES_PER_MINUTE, MAX_CHILDREN, youngAccountRoutes } from '../http/young-account-routes.ts'
import { ADMIN_PASSWORD, SAM_PASSWORD, cookiesFrom, startHousehold } from './helpers/household-env.ts'

const MIGRATION = 'CREATE TABLE account_parents'

describe('the young accounts migration', () => {
  // A household as it was: Alex and Sam with accounts, Kim an adult with none, Zoé a teen and Léo a child.
  const before = () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore(MIGRATION))
    db.exec(`
      INSERT INTO users (id, email, password_hash, password_changed_at, created_at, name)
        VALUES (1, 'alex@example.com', 'x', 0, 0, 'Alex'), (2, 'sam@example.com', 'x', 0, 0, 'Sam');
      INSERT INTO profiles (id, account_id, name, color, position, created_at, user_id, kind) VALUES
        (10, 1, 'Alex', 'tech', 0, 0, 1, 'adult'),
        (11, 1, 'Sam', 'world', 1, 0, 2, 'adult'),
        (12, 1, 'Kim', 'sport', 2, 0, NULL, 'adult'),
        (13, 1, 'Zoé', 'science', 3, 5, NULL, 'teen'),
        (14, 1, 'Léo', 'culture', 4, 6, NULL, 'child');
      INSERT INTO user_devices (user_id, created_at, last_seen_at) VALUES (1, 0, 0);
      INSERT INTO readings (owner, article_id, source_id, source_name, minutes, read_at) VALUES ('p13', 'a1', 's', 'S', 3, 1);
    `)
    migrate(db)
    return db
  }

  it('makes an account of every young profile, with no e-mail and no password yet', () => {
    const db = before()
    const young = db
      .prepare(
        `SELECT p.name, u.email, u.has_password, u.password_hash, u.name AS account_name, u.created_at
         FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.kind != 'adult' ORDER BY p.id`
      )
      .all()
    assert.deepEqual(
      young.map(row => ({ ...row })),
      [
        { name: 'Zoé', email: null, has_password: 0, password_hash: '', account_name: 'Zoé', created_at: 5 },
        { name: 'Léo', email: null, has_password: 0, password_hash: '', account_name: 'Léo', created_at: 6 }
      ]
    )
    // Kim, an adult with no account, stays as she was.
    assert.equal((db.prepare('SELECT user_id FROM profiles WHERE id = 12').get() as { user_id: null }).user_id, null)
  })

  it('gives them the adults who have an account as parents, and hands over what they read', () => {
    const db = before()
    const zoe = (db.prepare('SELECT user_id FROM profiles WHERE id = 13').get() as { user_id: number }).user_id
    const parents = db.prepare('SELECT parent_id FROM account_parents WHERE child_id = ? ORDER BY parent_id').all(zoe)
    assert.deepEqual(
      parents.map(row => row.parent_id),
      [1, 2]
    )
    assert.equal((db.prepare('SELECT owner FROM readings').get() as { owner: string }).owner, `a${zoe}`)
  })

  it('keeps every row that pointed to an account, and its foreign keys on', () => {
    const db = before()
    assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_devices').get() as { n: number }).n, 1)
    // Deleting an account still takes its devices, its parent links and what it read with it.
    db.prepare('DELETE FROM users WHERE id = 1').run()
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_devices').get() as { n: number }).n, 0)
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM account_parents WHERE parent_id = 1').get() as { n: number }).n,
      0
    )
    // Two accounts may have no e-mail; two may not share one.
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO users (email, password_hash, password_changed_at, created_at) VALUES ('SAM@example.com', 'x', 0, 0)"
        )
        .run()
    )
  })
})

interface Child {
  accountId: number
  profileId: number
  name: string
  kind: string
  handle: string
  hasPassword: boolean
  parents: string[]
}

describe('Mon compte › Mes enfants', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  let zoe: Child
  before(async () => {
    household = await startHousehold()
  })
  after(() => household.close())

  const children = async (cookie: string) =>
    ((await (await household.call('/account/children', cookie)).json()) as { children: Child[] }).children

  it('lists a parent’s own children only: Léa, made before, has an account and no password yet', async () => {
    const mine = await children(household.admin)
    assert.deepEqual(
      mine.map(child => [child.name, child.kind, child.hasPassword, child.parents]),
      [['Léa', 'child', false, ['Antho']]]
    )
    assert.match(mine[0]!.handle, /^lea/)
    assert.deepEqual(await children(household.sam), [])
  })

  it('makes a teen’s account with its @identifier and the password its parent chose', async () => {
    const made = await household.call('/account/children', household.admin, 'POST', {
      kind: 'teen',
      name: 'Zoé',
      color: 'science',
      handle: 'zoe',
      password: 'le mot de passe de Zoé'
    })
    assert.equal(made.status, 201)
    zoe = (await made.json()) as Child
    assert.deepEqual([zoe.name, zoe.handle, zoe.hasPassword, zoe.parents], ['Zoé', 'zoe', true, ['Antho']])
    assert.equal(household.accounts.get(zoe.accountId)?.email, null)
    // The identifier is taken now, and a part that cannot be is refused.
    const again = { kind: 'teen', name: 'Zoé', color: 'science', handle: 'zoe', password: 'un autre mot de passe' }
    assert.equal((await household.call('/account/children', household.admin, 'POST', again)).status, 409)
    for (const wrong of [
      { ...again, handle: undefined, kind: 'adult' },
      { ...again, handle: undefined, password: 'court' },
      { ...again, handle: 'Z' }
    ]) {
      const response = await household.call('/account/children', household.admin, 'POST', wrong)
      assert.equal(response.status, 400, JSON.stringify(wrong))
    }
  })

  it('signs the teen in with its @identifier, and its own account changes nothing of itself', async () => {
    const login = await household.call('/login', '', 'POST', { email: '@zoe', password: 'le mot de passe de Zoé' })
    assert.equal(login.status, 204)
    const own = cookiesFrom(login)
    assert.equal((await household.call('/account', own)).status, 200)
    const region = await household.call('/account/region', own, 'PUT', { timeZone: 'Europe/Paris' })
    assert.equal(region.status, 403)
    // Its lost phone it may still sign out.
    const phone = await household.call('/login', '', 'POST', { email: '@zoe', password: 'le mot de passe de Zoé' })
    const view = (await (await household.call('/account', own)).json()) as {
      devices: { id: number; current: boolean }[]
    }
    const other = view.devices.find(device => !device.current)!
    assert.equal((await household.call(`/account/devices/${other.id}`, own, 'DELETE')).status, 200)
    assert.equal((await household.call('/account', cookiesFrom(phone))).status, 401)
    assert.equal((await household.call('/account/children', own)).status, 403)
    // Léa, with no password yet, opens nowhere on her own.
    const lea = (await children(household.admin))[0]!
    const none = await household.call('/login', '', 'POST', { email: lea.handle, password: 'nimporte quoi du tout' })
    assert.equal(none.status, 401)
  })

  it('gives a new password and deletes, for its parents only, after their own password', async () => {
    const path = `/account/children/${zoe.accountId}`
    const body = { newPassword: 'un tout nouveau mot de passe', password: SAM_PASSWORD }
    assert.equal((await household.call(`${path}/password`, household.sam, 'PUT', body)).status, 404)
    assert.equal((await household.call(`${path}/password`, household.admin, 'PUT', body)).status, 403)
    const changed = await household.call(`${path}/password`, household.admin, 'PUT', {
      ...body,
      password: ADMIN_PASSWORD
    })
    assert.equal(changed.status, 200)
    const login = await household.call('/login', '', 'POST', { email: 'zoe', password: body.newPassword })
    assert.equal(login.status, 204)

    assert.equal((await household.call(path, household.sam, 'DELETE', { password: SAM_PASSWORD })).status, 404)
    assert.equal((await household.call(path, household.admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 204)
    assert.equal(household.accounts.get(zoe.accountId), null)
    assert.equal(household.profiles.get(zoe.profileId), null)
  })

  it('lets only a young one’s parents change it, the server’s admin not when another adult made it', async () => {
    const made = await household.call('/account/children', household.sam, 'POST', {
      kind: 'teen',
      name: 'Noa',
      color: 'world',
      password: 'le mot de passe de Noa'
    })
    const noa = (await made.json()) as Child
    assert.deepEqual(noa.parents, ['Sam'])
    const rename = (cookie: string) => household.call(`/profiles/${noa.profileId}`, cookie, 'PATCH', { name: 'Noah' })
    assert.equal((await rename(household.sam)).status, 200)
    assert.equal((await rename(household.admin)).status, 403)
    const deleted = await household.call(`/profiles/${noa.profileId}`, household.admin, 'DELETE')
    assert.equal(deleted.status, 403)
  })
})

describe('Créer un compte, against filling the server', () => {
  // A parent who already has as many children as allowed: only the route's own checks run.
  const start = async () => {
    const parent = { id: 1 } as UserAccount
    const app = express()
    app.use(express.json())
    app.use((_request, response, next) => {
      response.locals.profileId = 7
      next()
    })
    app.use(
      '/children',
      youngAccountRoutes({
        accounts: { profileOf: () => 7, isHandleFree: () => true } as unknown as UserAccountStore,
        profiles: {} as ProfileStore,
        young: {
          isYoung: () => false,
          childrenOf: () => Array.from({ length: MAX_CHILDREN }, (_, index) => ({ accountId: index }))
        } as unknown as YoungAccountStore,
        sessionOf: () => ({ account: parent, device: null }),
        checkProof: async () => true,
        now: () => 0
      })
    )
    const server = app.listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/children`
    return {
      server,
      create: () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
  }

  it('refuses an account over the limit, and a parent making them in a loop', async () => {
    const { server, create } = await start()
    try {
      for (let attempt = 0; attempt < CREATES_PER_MINUTE; attempt++) {
        const response = await create()
        assert.equal(response.status, 409)
        assert.deepEqual(await response.json(), { error: 'limit' })
      }
      assert.equal((await create()).status, 429)
    } finally {
      server.close()
    }
  })
})
