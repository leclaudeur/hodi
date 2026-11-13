import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { AccountDataStore, deletionPlan } from '../db/account-data.ts'
import { type Database, openDatabase } from '../db/database.ts'
import { FORGET_MARGIN_MS, ForgetLog, replayForgotten, setForgetLog } from '../db/forget-log.ts'
import {
  applyPendingRestore,
  backupNow,
  copyTimeOf,
  oldestRestorable,
  readRestoreTime,
  restoreTimeFile,
  stageRestore
} from '../db/maintenance.ts'
import { PluginHouseholdStore } from '../db/plugin-household-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'

const HOUR = 60 * 60 * 1000
let clock = Date.UTC(2026, 10, 5, 2, 0)

const folder = () => mkdtempSync(path.join(tmpdir(), 'hodi-forget-'))

// Hodi's database in a file, with the log beside it, as start.ts sets it up.
const server = (oldestCopy: () => number | null = () => 0) => {
  const dir = folder()
  const db = openDatabase(path.join(dir, 'hodi.db'))
  const logs: string[] = []
  const log = new ForgetLog(path.join(dir, 'forgotten.jsonl'), {
    now: () => clock,
    oldestCopy,
    log: line => logs.push(line)
  })
  setForgetLog(log)
  return { dir, db, log, logs }
}
afterEach(() => setForgetLog(null))

// A copy of the database as it is now, as Serveur › Sauvegardes makes it.
const copyOf = (db: Database, dir: string) => {
  const file = path.join(dir, `copy-${clock}.db`)
  db.prepare('VACUUM INTO ?').run(file)
  return { file, at: clock }
}

const count = (db: Database, sql: string, ...params: (number | string)[]) =>
  (db.prepare(sql).get(...params) as { n: number }).n

// The household of the Dupont family: Marie (admin, her account) and Paul (his account), and Léa, a child.
const dupont = (db: Database) => {
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  db.prepare("UPDATE accounts SET name = 'Dupont', set_up_at = ? WHERE id = 1").run(clock)
  const [admin] = profiles.list()
  const marie = accounts.create('marie@example.com', 'hash', clock)!
  accounts.linkProfile(marie.id, admin!.id)
  clock += 1000
  const paulProfile = profiles.create('Paul', 'tech', clock)!
  const paul = accounts.create('paul@example.com', 'hash', clock)!
  accounts.linkProfile(paul.id, paulProfile.id)
  clock += 1000
  const lea = profiles.create('Léa', 'world', clock, { kind: 'child' })!
  return { profiles, accounts, admin: admin!, marie, paul, paulProfile, lea }
}

describe('deletions done again after a restore', () => {
  it('deletes again a profile and an account deleted after the copy, and tells who took over', async () => {
    const { dir, db, log } = server()
    const { profiles, accounts, marie, paul, paulProfile, lea } = dupont(db)
    const copy = copyOf(db, dir)

    clock += HOUR
    assert.ok(profiles.delete(lea.id))
    // Marie deletes her account: Paul takes over the household and the server.
    db.prepare('UPDATE users SET server_admin = 1 WHERE id = ?').run(marie.id)
    const data = new AccountDataStore(db)
    const marieNow = accounts.get(marie.id)!
    data.delete(marieNow, deletionPlan(marieNow, accounts, profiles, 'Dupont'), clock)
    assert.deepEqual(
      log.all().map(entry => entry.kind),
      ['profile', 'admin', 'profile', 'serverAdmin', 'account']
    )

    // The copy comes back: Léa and Marie are in it.
    const restored = openDatabase(copy.file)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM profiles WHERE id = ?', lea.id), 1)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM users WHERE id = ?', marie.id), 1)
    replayForgotten(restored, log.since(copy.at), clock)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM profiles WHERE id = ?', lea.id), 0)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM users WHERE id = ?', marie.id), 0)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM users WHERE email = ?', 'marie@example.com'), 0)
    // Paul holds the roles Marie handed over.
    assert.equal(
      count(restored, "SELECT count(*) AS n FROM profiles WHERE id = ? AND role = 'admin'", paulProfile.id),
      1
    )
    assert.equal(count(restored, 'SELECT server_admin AS n FROM users WHERE id = ?', paul.id), 1)
  })

  it('empties the household again when its last adult’s account went', () => {
    const { dir, db, log } = server()
    const { profiles, accounts, marie, paul } = dupont(db)
    const copy = copyOf(db, dir)
    clock += HOUR
    const data = new AccountDataStore(db)
    // Paul goes first, then Marie, the last adult with an account: the household goes with her.
    const paulNow = accounts.get(paul.id)!
    data.delete(paulNow, deletionPlan(paulNow, accounts, profiles, 'Dupont'), clock)
    const marieNow = accounts.get(marie.id)!
    const plan = deletionPlan(marieNow, accounts, profiles, 'Dupont')
    assert.ok(plan.householdGoes)
    data.delete(marieNow, plan, clock)

    const restored = openDatabase(copy.file)
    replayForgotten(restored, log.since(copy.at), clock)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM users'), 0)
    // As a new install's: one first profile, no name, not set up.
    assert.deepEqual(
      restored
        .prepare('SELECT name, role FROM profiles')
        .all()
        .map(row => ({ ...row })),
      [{ name: 'Admin', role: 'admin' }]
    )
    assert.deepEqual(
      { ...(restored.prepare('SELECT name, set_up_at FROM accounts WHERE id = 1').get() as object) },
      { name: 'Foyer', set_up_at: null }
    )
  })

  it('removes again a household a plugin removed', () => {
    const { dir, db, log } = server()
    const households = new PluginHouseholdStore(db)
    const { household } = households.create(
      { name: 'Martin', language: 'fr', plugin: 'village', admin: { name: 'Jo', accountId: null } },
      clock
    )
    const copy = copyOf(db, dir)
    clock += HOUR
    assert.ok(households.remove(household.id, 'village'))
    // Another plugin's household, or the core's, is not its to remove: nothing is written down.
    assert.equal(households.remove(1, 'village'), false)
    assert.deepEqual(
      log.all().map(entry => entry.kind),
      ['household']
    )
    const restored = openDatabase(copy.file)
    replayForgotten(restored, log.since(copy.at), clock)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM accounts WHERE id = ?', household.id), 0)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM profiles WHERE account_id = ?', household.id), 0)
  })

  it('never deletes a new row that got a deleted one’s id', () => {
    const { dir, db, log } = server()
    const { profiles, lea } = dupont(db)
    clock += HOUR
    profiles.delete(lea.id)
    // Later, a new child gets Léa's id again (SQLite reuses the highest id), and a copy is made.
    clock += HOUR
    const tom = profiles.create('Tom', 'world', clock, { kind: 'child' })!
    assert.equal(tom.id, lea.id)
    const copy = copyOf(db, dir)
    // A copy from just after Léa went still gets her deletion again (the margin): Tom stays.
    const restored = openDatabase(copy.file)
    replayForgotten(restored, log.since(copy.at - HOUR + FORGET_MARGIN_MS / 2), clock)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM profiles WHERE id = ? AND name = ?', tom.id, 'Tom'), 1)
  })

  it('takes a copy’s time from its name, at the earliest, never from the file', () => {
    assert.equal(copyTimeOf('hodi-2026-11-05.db'), Date.UTC(2026, 10, 5))
    assert.equal(copyTimeOf('hodi-2026-11-05-153012.db'), Date.UTC(2026, 10, 5, 15, 30, 12))
    assert.equal(copyTimeOf('restore-pending.db'), null)
  })

  it('keeps an account deleted even when the copy restored was pushed out of the list, or copied again', async () => {
    let pending = ''
    let backups = ''
    const { dir, db, log } = server(() => oldestRestorable(backups, pending))
    backups = path.join(dir, 'backups')
    pending = path.join(dir, 'restore-pending.db')
    const { profiles, accounts, paul } = dupont(db)
    const copy = await backupNow(db, backups, clock, 1)
    // Copied again later (a disk moved): the file's time is now, not the copy's.
    utimesSync(path.join(backups, copy), new Date(clock + 5 * HOUR), new Date(clock + 5 * HOUR))
    clock += HOUR
    const paulNow = accounts.get(paul.id)!
    new AccountDataStore(db).delete(paulNow, deletionPlan(paulNow, accounts, profiles, 'Dupont'), clock)

    // « Restaurer » as the route does it: set aside with its time, then a copy of now, which pushes it out (1 kept).
    clock += HOUR
    stageRestore(path.join(backups, copy), pending)
    writeFileSync(restoreTimeFile(pending), JSON.stringify({ at: copyTimeOf(copy) }))
    await backupNow(db, backups, clock, 1)
    // The nightly maintenance runs before the restart: what the waiting copy needs stays.
    log.prune()
    db.close()
    assert.ok(applyPendingRestore(path.join(dir, 'hodi.db'), pending))
    const restored = openDatabase(path.join(dir, 'hodi.db'))
    replayForgotten(restored, log.since(readRestoreTime(pending)!), clock)
    assert.equal(count(restored, 'SELECT count(*) AS n FROM users WHERE id = ?', paul.id), 0)
  })

  it('keeps only ids and times, skips a line it cannot read, and forgets what no copy can bring back', () => {
    let oldest: number | null = clock
    const { db, log, logs, dir } = server(() => oldest)
    const { profiles, lea, paulProfile } = dupont(db)
    clock += HOUR
    profiles.delete(lea.id)
    const file = path.join(dir, 'forgotten.jsonl')
    // Nothing that says who the person was.
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Léa|example\.com/)
    appendFileSync(file, '{"kind":"profile","id":"1 OR 1=1","createdAt":1,"householdId":1,"at":1}\n{"kind":"sql"\n')
    assert.equal(log.all().length, 1)
    assert.deepEqual(logs, [
      'A line of forgotten.jsonl cannot be read: it is skipped',
      'A line of forgotten.jsonl cannot be read: it is skipped'
    ])
    clock += 2 * HOUR
    profiles.delete(paulProfile.id)
    // The oldest copy is now from between the two: only the second can come back.
    oldest = clock - HOUR
    log.prune()
    assert.deepEqual(
      log.all().map(entry => entry.id),
      [paulProfile.id]
    )
    // No copy at all: nothing to keep.
    oldest = null
    log.prune()
    assert.deepEqual(log.all(), [])
  })
})
