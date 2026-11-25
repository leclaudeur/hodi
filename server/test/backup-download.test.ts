import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { downloadLinks } from '../http/backup-download.ts'
import { CONFIG } from '../fixed-config.ts'

describe('backup download links', () => {
  it('works once, for the account that gave its password, and not after its time', () => {
    let clock = 1_000
    const links = downloadLinks(() => clock)

    const token = links.make('hodi-2026-11-25.db', 1)
    assert.match(token, /^[\w-]{43}$/)
    // Another account, even a server admin, gets nothing, and the link is gone.
    assert.equal(links.take(token, 2), null)
    assert.equal(links.take(token, 1), null)

    const again = links.make('hodi-2026-11-25.db', 1)
    assert.equal(links.take(again, 1), 'hodi-2026-11-25.db')
    assert.equal(links.take(again, 1), null)

    const late = links.make('hodi-2026-11-25.db', 1)
    clock += CONFIG.backups.downloadLink
    assert.equal(links.take(late, 1), null)
  })

  it('keeps few links waiting: the oldest goes first', () => {
    const links = downloadLinks(() => 0)
    const first = links.make('hodi-2026-11-25.db', 1)
    for (let index = 0; index < 20; index += 1) links.make('hodi-2026-11-25.db', 1)
    assert.equal(links.take(first, 1), null)
  })
})
