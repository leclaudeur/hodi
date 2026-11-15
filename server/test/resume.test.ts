import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { UserStore } from '../db/user-store.ts'

const NOW = Date.UTC(2026, 9, 27, 12)
const DAY = 24 * 60 * 60 * 1000
const tracked = (id: string, at: number) => ({
  id,
  sourceId: 'alpha',
  sourceName: 'Alpha',
  topicId: 'world',
  minutes: 0,
  at,
  kind: 'article' as const,
  done: false,
  progress: 0,
  position: 0,
  estimate: 6
})

describe('Reprendre', () => {
  it('offers the articles started lately and left before their end, newest first', () => {
    const users = new UserStore(openDatabase(':memory:'))
    users.addReadings(
      [
        tracked('started', NOW - 2 * DAY),
        tracked('newer', NOW - DAY),
        tracked('skimmed', NOW),
        tracked('finished', NOW),
        // Scrolled to its end too fast to count as read.
        tracked('raced', NOW),
        { ...tracked('video', NOW - DAY / 2), kind: 'video' as const },
        tracked('old', NOW - 4 * DAY),
        tracked('set-aside', NOW),
        // From before it was tracked: read.
        { ...tracked('legacy', NOW), done: undefined }
      ],
      NOW
    )
    const progress = (id: string, share: number, done = false) =>
      users.updateReading(id, { minutes: 1, progress: share, position: share, done }, NOW)
    progress('started', 0.4)
    progress('newer', 0.2)
    progress('skimmed', 0.05)
    progress('finished', 0.9, true)
    progress('raced', 1)
    progress('video', 0.9)
    progress('old', 0.5)
    progress('set-aside', 0.5)
    users.setAside('set-aside', NOW)

    const offered = users.resumable(NOW - 3 * DAY, 0.15, 0.8, 20)
    assert.deepEqual(
      offered.map(entry => entry.id),
      ['video', 'newer', 'started']
    )
    assert.deepEqual(offered[2], { id: 'started', kind: 'article', progress: 0.4, position: 0.4, estimate: 6 })
  })
})
