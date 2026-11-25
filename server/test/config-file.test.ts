import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { stringify, parse } from 'yaml'
import { parseConfig } from '../../shared/config-file.ts'
import { CONFIG_SCHEMA } from '../../shared/config-schema.ts'
import { WEB_GROUPS, webShare } from '../../shared/config-web.ts'
import { CONFIG } from '../fixed-config.ts'

const realText = readFileSync(path.resolve('config.yml'), 'utf8')
const real = () => parse(realText) as Record<string, Record<string, unknown>>

describe('config.yml', () => {
  it('holds every setting of the schema, read as the code uses it', () => {
    for (const [group, keys] of Object.entries(CONFIG_SCHEMA)) {
      for (const key of Object.keys(keys)) {
        const value = (CONFIG as unknown as Record<string, Record<string, unknown>>)[group]?.[key]
        assert.notEqual(value, undefined, `${group}.${key}`)
      }
    }
    assert.equal(CONFIG.signIn.failureWindow, 15 * 60_000)
    assert.equal(CONFIG.sourceIcons.maxSize, 256 * 1024)
    assert.equal(CONFIG.passwords.minLength, 8)
    assert.ok(CONFIG.blocks.sharedHosts.some(host => host === 'youtube.com'))
  })

  it('stops at a missing setting, naming it', () => {
    const raw = real()
    delete raw.sign_in.failure_window
    assert.throws(() => parseConfig(stringify(raw)), /sign_in\.failure_window must be a duration/)
  })

  it('stops at a value of the wrong kind', () => {
    const raw = real()
    raw.source_icons.max_size = 256
    assert.throws(() => parseConfig(stringify(raw)), /source_icons\.max_size must be a size/)
    const counted = real()
    counted.passwords.min_length = 7.5
    assert.throws(() => parseConfig(stringify(counted)), /passwords\.min_length must be a whole number/)
    const timed = real()
    timed.sign_in.failure_window = '15 minutes'
    assert.throws(() => parseConfig(stringify(timed)), /sign_in\.failure_window must be a duration/)
  })

  it('stops at a setting or a group it does not know', () => {
    const raw = real()
    raw.sign_in.failure_windw = '15m'
    assert.throws(() => parseConfig(stringify(raw)), /sign_in\.failure_windw is not a setting/)
    const grouped = real()
    grouped.sign_inn = {}
    assert.throws(() => parseConfig(stringify(grouped)), /sign_inn is not a group of settings/)
  })

  it('stops at an empty file', () => {
    assert.throws(() => parseConfig(''), /config\.yml is empty/)
  })

  it('gives the web app only the groups it reads', () => {
    const share = webShare(CONFIG)
    assert.deepEqual(Object.keys(share).sort(), [...WEB_GROUPS].sort())
    assert.equal('signIn' in share, false)
    assert.equal('pluginSandbox' in share, false)
    assert.equal(share.app.searchMinLength, CONFIG.app.searchMinLength)
  })
})
