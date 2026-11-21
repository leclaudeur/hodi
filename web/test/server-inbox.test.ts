import { describe, expect, it } from 'vitest'
import { inboxItemOf, inboxKindOf, isWaiting, reviewedSourceOf, sortInbox } from '../src/lib/server-inbox.ts'

const item = (
  id: number,
  type: string,
  extra: { important?: boolean; handledAt?: number | null; url?: string } = {}
) => ({
  id,
  type,
  important: extra.important ?? false,
  handledAt: extra.handledAt ?? null,
  createdAt: id * 10,
  url: extra.url ?? '#/server/overview'
})

describe('À traiter', () => {
  it('sorts each notice into its kind, a plugin’s own as plugin', () => {
    expect(inboxKindOf(item(1, 'core:source-review'))).toBe('source')
    expect(inboxKindOf(item(1, 'core:code-request'))).toBe('code')
    expect(inboxKindOf(item(1, 'core:weekly-report'))).toBe('report')
    expect(inboxKindOf(item(1, 'plugin:village:signup'))).toBe('plugin')
  })

  it('puts the requests still waiting first, then the newest', () => {
    const items = [
      item(1, 'core:code-request', { important: true }),
      item(2, 'core:weekly-report'),
      item(3, 'core:code-request', { important: true, handledAt: 40 }),
      item(4, 'core:source-review', { important: true })
    ]
    expect(isWaiting(items[0]!)).toBe(true)
    expect(isWaiting(items[2]!)).toBe(false)
    expect(sortInbox(items).map(entry => entry.id)).toEqual([4, 1, 3, 2])
  })

  it('opens an item by its id, or by a notice’s address, the newest with it', () => {
    const url = '#/server/inbox/source-p1-gamma'
    const items = [item(5, 'core:source-review', { url }), item(2, 'core:source-review', { url })]
    expect(inboxItemOf(items, '2')?.id).toBe(2)
    expect(inboxItemOf(items, 'source-p1-gamma')?.id).toBe(5)
    expect(inboxItemOf(items, 'source-nope')).toBeNull()
    expect(reviewedSourceOf(items[0]!)).toBe('p1-gamma')
    expect(reviewedSourceOf(item(1, 'core:code-request', { url: '#/server/accounts/3' }))).toBeNull()
  })
})
