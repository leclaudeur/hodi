import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { migrate, versionBefore } from '../db/migrations.ts'
import { GameStore } from '../db/game-store.ts'
import { loadRules } from '../game/rules.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { startHousehold } from './helpers/household-env.ts'

describe('an account’s region', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  before(async () => {
    household = await startHousehold()
  })
  after(() => household.close())

  it('starts with the one chosen in the first-run screens', async () => {
    const view = (await (await household.call('/account', household.admin)).json()) as Record<string, unknown>
    assert.equal(view.timeZone, 'Europe/Brussels')
    assert.equal(view.country, 'BE')
  })

  it('takes the household’s while the person chose none', async () => {
    const view = (await (await household.call('/account', household.sam)).json()) as Record<string, unknown>
    assert.equal(view.timeZone, 'Europe/Brussels')
    assert.equal(view.country, null)
  })

  it('changes for that account alone', async () => {
    const response = await household.call('/account/region', household.sam, 'PUT', {
      timeZone: 'America/Montreal',
      country: 'CA'
    })
    assert.equal(response.status, 200)
    const view = (await response.json()) as Record<string, unknown>
    assert.equal(view.timeZone, 'America/Montreal')
    assert.equal(view.country, 'CA')
    assert.equal(household.accounts.timeZoneOfProfile(household.samId), 'America/Montreal')
    const admin = (await (await household.call('/account', household.admin)).json()) as Record<string, unknown>
    assert.equal(admin.timeZone, 'Europe/Brussels')
  })

  it('lets the country go but never the time zone', async () => {
    const cleared = await household.call('/account/region', household.sam, 'PUT', { country: null })
    assert.equal(((await cleared.json()) as Record<string, unknown>).country, null)
    for (const body of [{ timeZone: null }, { timeZone: 'Mars/Olympus' }, { country: 'belgium' }, {}]) {
      const response = await household.call('/account/region', household.sam, 'PUT', body)
      assert.equal(response.status, 400, JSON.stringify(body))
    }
  })

  it('needs a session', async () => {
    const response = await household.call('/account/region', '', 'PUT', { timeZone: 'Europe/Paris' })
    assert.equal(response.status, 401)
  })
})

describe('the region migration', () => {
  it('gives each account its household’s', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('ALTER TABLE users ADD COLUMN time_zone'))
    db.exec("UPDATE accounts SET time_zone = 'Asia/Tokyo', country = 'JP' WHERE id = 1")
    db.exec(
      "INSERT INTO users (id, email, password_hash, password_changed_at, created_at) VALUES (7, 'a@b.c', 'x', 0, 0)"
    )
    db.exec(
      "INSERT INTO users (id, email, password_hash, password_changed_at, created_at) VALUES (8, 'd@e.f', 'x', 0, 0)"
    )
    db.exec(
      "INSERT INTO profiles (account_id, name, color, position, created_at, user_id) VALUES (1, 'A', 'tech', 0, 0, 7)"
    )
    migrate(db)
    const accounts = new UserAccountStore(db as never)
    assert.deepEqual([accounts.get(7)?.timeZone, accounts.get(7)?.country], ['Asia/Tokyo', 'JP'])
    assert.deepEqual([accounts.get(8)?.timeZone, accounts.get(8)?.country], [null, null])
  })
})

describe('a reader’s days', () => {
  it('follow its own time zone', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const zones: Record<number, string> = { 1: 'Pacific/Kiritimati', 2: 'Pacific/Pago_Pago' }
    const asked: (number | undefined)[] = []
    const game = new GameStore(db as never, loadRules(path.resolve('gamification.yml')), profileId => {
      asked.push(profileId)
      return profileId === undefined ? 'UTC' : zones[profileId]!
    })
    game.summary(2, Date.UTC(2026, 10, 20, 12))
    assert.deepEqual(asked, [2])
  })
})

describe('a reader’s Résumé du jour', () => {
  it('lasts until midnight in its own time zone', async () => {
    const { DailySummaries } = await import('../news/daily-summaries.ts')
    const { AiLedger } = await import('../news/ai-ledger.ts')
    let now = Date.UTC(2026, 10, 20, 9, 0)
    const zones: Record<number, string> = { 1: 'UTC', 2: 'Pacific/Kiritimati' }
    const ledger = new AiLedger({ now })
    const summaries = new DailySummaries({
      ledger,
      languageOf: () => 'fr',
      timeZone: profileId => zones[profileId]!,
      now: () => now,
      log: () => {}
    })
    const write = async () => [{ topic: 'Monde', text: 'Un point' }]
    // Both written at 09:00 UTC: 23:00 in Kiritimati.
    const page = [
      {
        id: 'monde',
        label: 'Monde',
        checking: 0,
        items: [{ title: 'Un sommet', sourceName: 'Alpha', summary: '', related: [] }]
      }
    ]
    for (const profileId of [1, 2]) await summaries.write(profileId, write as never, async () => page as never)
    // 10:30 UTC is already the next day in Kiritimati (UTC+14).
    now = Date.UTC(2026, 10, 20, 10, 30)
    assert.equal(summaries.latest(1).status, 'ok')
    assert.equal(summaries.latest(2).status, 'none')
  })
})
