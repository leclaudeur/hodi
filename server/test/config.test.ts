import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadConfig } from '../config.ts'

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATA_DIR: mkdtempSync(path.join(tmpdir(), 'hodi-config-')),
  ...extra
})

describe('config', () => {
  it('starts with nothing set, making its secrets on the first start and keeping them', () => {
    const first = env()
    const config = loadConfig(first)
    assert.equal(config.sessionSecret.length, 32)

    const file = path.join(first.DATA_DIR!, 'session-secret')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(readFileSync(file, 'utf8'), config.sessionSecret.toString('hex'))

    const vapid = path.join(first.DATA_DIR!, 'vapid.json')
    assert.equal(statSync(vapid).mode & 0o777, 0o600)
    assert.match(config.vapid.subject, /^https:\/\//)

    const again = loadConfig(first)
    assert.deepEqual(again.sessionSecret, config.sessionSecret)
    assert.deepEqual(again.vapid, config.vapid)
  })
})
