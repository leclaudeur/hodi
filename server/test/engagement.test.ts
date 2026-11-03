import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHANNEL_LIMITS, sourceEngagement } from '../news/engagement.ts'

describe('source engagement', () => {
  const articles = new Map([
    ['lesoir', 60],
    ['rtbf', 80],
    ['lemonde', 40],
    ['quiet', 10],
    ['skipped', 50]
  ])

  it('flags the sources read far less than the others, once there is enough to judge', () => {
    const reads = new Map([
      ['lesoir', 12],
      ['rtbf', 16],
      ['lemonde', 8],
      ['quiet', 0],
      ['skipped', 0]
    ])
    const rows = sourceEngagement([...articles.keys()], articles, reads)
    assert.deepEqual(
      rows.filter(row => row.low).map(row => row.id),
      // "quiet" listed too few articles to say.
      ['skipped']
    )
    assert.deepEqual(
      rows.find(row => row.id === 'rtbf'),
      { id: 'rtbf', articles: 80, read: 16, low: false }
    )
  })

  it('judges channels on their own, smaller numbers', () => {
    const videos = new Map([
      ['kurzgesagt', 4],
      ['underscore', 8],
      ['skipped', 6]
    ])
    const views = new Map([
      ['kurzgesagt', 3],
      ['underscore', 4]
    ])
    assert.deepEqual(
      sourceEngagement([...articles.keys()], videos, views).filter(row => row.low),
      []
    )
    assert.deepEqual(
      sourceEngagement([...videos.keys()], videos, views, CHANNEL_LIMITS)
        .filter(row => row.low)
        .map(row => row.id),
      ['skipped']
    )
  })

  it('says nothing for a profile that has barely read', () => {
    const reads = new Map([['lesoir', 5]])
    assert.ok(sourceEngagement([...articles.keys()], articles, reads).every(row => !row.low))
  })
})
